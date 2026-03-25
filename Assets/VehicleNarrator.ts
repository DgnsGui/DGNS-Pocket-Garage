/**
 * VehicleNarrator.ts — Narrative description + TTS + status text for DGNS Vehicle Scanner
 *
 * Handles:
 *   - "Fetch Info" GPT narrative + TTS readout
 *   - Scrolling subtitle text synchronized with audio
 *   - Mute toggle
 *   - Unified status text on Car Scan Interface ("Loading" element) for:
 *       • Idle mode: rotating fun phrases with typewriter animation
 *       • Scanning: animated "Scanning..." dots
 *       • Errors: brief error display, then back to idle
 *
 * @author DGNS
 * @license MIT
 */

import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI';
import { VehicleData } from './VehicleTypes';
import { t, tf, getIdlePhrases } from './Localization';

@component
export class VehicleNarrator extends BaseScriptComponent {

    // =====================================================================
    // INPUTS
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Get More Info Button" SceneObject (with RectangleButton)')
    fetchInfoButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Car Description Subtitles" Text for narrative description')
    carDescriptionText: Text;

    @input
    @allowUndefined
    @hint('AudioComponent for TTS playback')
    ttsAudioPlayer: AudioComponent;

    @input
    @allowUndefined
    @hint('"Mute Button" SceneObject (with RectangleButton/BaseButton)')
    muteButton: SceneObject;

    @input
    @allowUndefined
    @hint('Text element under Mute Button to display mute/unmute icon')
    muteButtonText: Text;

    @input
    @allowUndefined
    @hint('"Loading" Text component on Car Scan Interface — unified status text (idle phrases, scanning, errors)')
    statusText: Text;

    // =====================================================================
    // CALLBACKS — Set by orchestrator
    // =====================================================================
    /** Called when narrator mute state changes. */
    onMuteStateChanged: ((muted: boolean) => void) | null = null;
    /** Called when review/fetch generation starts (text + TTS generation phase). */
    onReviewGenerationStarted: (() => void) | null = null;
    /** Called when review/fetch generation ends (success or failure). */
    onReviewGenerationFinished: (() => void) | null = null;
    /** Called when audible TTS playback starts. */
    onTTSPlaybackStarted: (() => void) | null = null;
    /** Called when audible TTS playback ends/stops. */
    onTTSPlaybackEnded: (() => void) | null = null;

    // Idle phrases are loaded from Localization module at runtime

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private isFetchingInfo: boolean = false;
    private lastVehicleData: VehicleData | null = null;
    private isTtsMuted: boolean = false;
    private ttsIsPlaying: boolean = false;

    // Text scroll state
    private scrollSentences: string[] = [];
    private scrollIndex: number = 0;
    private scrollDelayEvent: SceneEvent | null = null;
    private readonly WORDS_PER_MINUTE: number = 155;

    // Dots animation state
    private subtitleDotsEvent: SceneEvent | null = null;

    // Card review override — temporarily swaps carDescriptionText for collector card reviews
    private savedDescriptionText: Text | null = null;
    private isReviewFromCard: boolean = false;

    // Status text state (idle typewriter + scanning + errors)
    private statusMode: 'idle' | 'scanning' | 'error' | 'off' = 'off';
    private idlePhraseIndex: number = 0;
    private typewriterCharIndex: number = 0;
    private typewriterEvent: SceneEvent | null = null;
    private idleCycleEvent: SceneEvent | null = null;
    private scanningDotsEvent: SceneEvent | null = null;
    private errorTimerEvent: SceneEvent | null = null;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        // Hide description at startup
        if (this.carDescriptionText) {
            const descParent = this.carDescriptionText.getSceneObject();
            if (descParent) descParent.enabled = false;
        }

        this.createEvent('OnStartEvent').bind(() => {
            this.setupFetchInfoButton();
            this.setupMuteButton();
            // Start idle phrases immediately
            this.startIdleMode();
        });
    }

    // =====================================================================
    // PUBLIC API — Status text (unified Loading element)
    // =====================================================================

    /**
     * Starts idle mode — shows rotating fun phrases with typewriter animation.
     * Called at launch and whenever the scan interface re-appears.
     */
    startIdleMode(): void {
        this.stopAllStatusAnimations();
        this.statusMode = 'idle';
        // Shuffle starting phrase
        this.idlePhraseIndex = Math.floor(Math.random() * getIdlePhrases().length);
        this.typewriteNextPhrase();
    }

    /**
     * Starts scanning mode — shows animated "Scanning..." on the status text.
     */
    startScanningMode(): void {
        this.stopAllStatusAnimations();
        this.statusMode = 'scanning';
        if (!this.statusText) return;
        this.statusText.text = t('scanning') + '.';
        this.animateScanningDots(1);
    }

    /**
     * Shows an error message on the status text, then returns to idle after delay.
     */
    showStatusError(message: string, delaySec: number = 2.5): void {
        this.stopAllStatusAnimations();
        if (this.errorTimerEvent) {
            try { this.errorTimerEvent.enabled = false; } catch (e) { /* ignore */ }
            this.errorTimerEvent = null;
        }
        this.statusMode = 'error';
        if (this.statusText) this.statusText.text = message;

        const ev = this.createEvent('DelayedCallbackEvent');
        ev.bind(() => {
            if (this.statusMode === 'error') {
                this.errorTimerEvent = null;
                this.startIdleMode();
            }
        });
        ev.reset(delaySec);
        this.errorTimerEvent = ev;
    }

    /**
     * Returns true if the status text is currently displaying an error message.
     */
    isShowingError(): boolean {
        return this.statusMode === 'error';
    }

    /**
     * Shows a processing message on the status text (stays until replaced by another mode).
     */
    showStatusProcessing(message: string): void {
        this.stopAllStatusAnimations();
        this.statusMode = 'scanning';
        if (this.statusText) this.statusText.text = message;
    }

    /**
     * Stops all status text animations (used when scan interface hides).
     */
    stopStatusText(): void {
        this.stopAllStatusAnimations();
        this.statusMode = 'off';
        if (this.statusText) this.statusText.text = '';
    }

    // =====================================================================
    // PUBLIC API — Description text (subtitle area on Vehicle Card)
    // =====================================================================

    /** Sets the vehicle data to describe when "Fetch Info" is pressed. */
    setVehicleData(data: VehicleData | null): void {
        this.lastVehicleData = data;
    }

    /**
     * Triggers a vehicle review/narration with the given data.
     * Used by collector cards to launch a TopGear-style review for any saved vehicle.
     * Same logic as the "Fetch Info" button, but accepts data directly.
     *
     * @param data The vehicle data to narrate.
     * @param cardReviewText Optional Text component on the collector card ("Car Review").
     *   If provided, the narration text will display on this text instead of the Vehicle Card subtitle.
     */
    triggerReview(data: VehicleData, cardReviewText?: Text): void {
        if (this.isFetchingInfo) {
            if (cardReviewText) {
                const obj = cardReviewText.getSceneObject();
                if (obj) obj.enabled = true;
                cardReviewText.text = t('review_in_progress');
            } else {
                this.showDescriptionText(t('review_in_progress'));
            }
            return;
        }

        // Temporarily swap carDescriptionText to the card's review text
        if (cardReviewText) {
            this.savedDescriptionText = this.carDescriptionText;
            this.carDescriptionText = cardReviewText;
            this.isReviewFromCard = true;
            const obj = cardReviewText.getSceneObject();
            if (obj) obj.enabled = true;
            print('VehicleNarrator: Review target swapped to card text');
        }

        this.lastVehicleData = data;
        this.onFetchInfoPressed();
    }

    /**
     * Restores the original carDescriptionText after a card review finishes.
     * Called automatically when TTS finishes or narration ends.
     */
    private restoreCardReviewText(): void {
        if (this.isReviewFromCard && this.savedDescriptionText) {
            this.carDescriptionText = this.savedDescriptionText;
            this.savedDescriptionText = null;
            this.isReviewFromCard = false;
            print('VehicleNarrator: Review text target restored');
        }
    }

    /** Shows a simple static message in the description text area. */
    showDescriptionText(text: string): void {
        this.stopTextScroll();
        this.stopDotsAnimation();
        if (!this.carDescriptionText) return;
        const descObj = this.carDescriptionText.getSceneObject();
        if (descObj) descObj.enabled = true;
        this.carDescriptionText.text = text;
    }

    /** Hides the description text and stops scrolling + TTS. */
    hideDescription(): void {
        try {
            this.stopTextScroll();
            this.stopDotsAnimation();
            const wasTtsPlaying = this.ttsIsPlaying;
            this.ttsIsPlaying = false;

            if (this.carDescriptionText) {
                const descObj = this.carDescriptionText.getSceneObject();
                if (descObj) descObj.enabled = false;
                this.carDescriptionText.text = '';
            }

            if (this.ttsAudioPlayer) {
                try { this.ttsAudioPlayer.stop(true); } catch (e) { /* ignore */ }
            }
            if (wasTtsPlaying && this.onTTSPlaybackEnded) this.onTTSPlaybackEnded();
        } catch (err) {
            print('VehicleNarrator: hideDescription error: ' + err);
        }
    }

    /** Hides the description text immediately. */
    hideDescriptionText(): void {
        if (this.carDescriptionText) {
            const descObj = this.carDescriptionText.getSceneObject();
            if (descObj) descObj.enabled = false;
            this.carDescriptionText.text = '';
        }
    }

    /** Hides the description text after a delay (seconds). */
    hideDescriptionAfterDelay(seconds: number): void {
        const ev = this.createEvent('DelayedCallbackEvent');
        ev.bind(() => {
            if (this.carDescriptionText) {
                const descObj = this.carDescriptionText.getSceneObject();
                if (descObj) descObj.enabled = false;
                this.carDescriptionText.text = '';
            }
        });
        ev.reset(seconds);
    }

    /** Shows a message with animated dots: "text.", "text..", "text..." */
    showAnimatedDescriptionText(baseText: string): void {
        this.stopTextScroll();
        this.stopDotsAnimation();
        if (!this.carDescriptionText) return;
        const descObj = this.carDescriptionText.getSceneObject();
        if (descObj) descObj.enabled = true;
        this.carDescriptionText.text = baseText + '.';
        this.animateDescriptionDots(baseText, 1);
    }

    /** Stops the subtitle dots animation. */
    stopDotsAnimation(): void {
        if (this.subtitleDotsEvent) {
            try { this.subtitleDotsEvent.enabled = false; } catch (e) { /* ignore */ }
            this.subtitleDotsEvent = null;
        }
    }

    // =====================================================================
    // BUTTON SETUP
    // =====================================================================

    private setupFetchInfoButton(): void {
        if (!this.fetchInfoButton) return;
        const btnScript = this.fetchInfoButton.getComponent('Component.ScriptComponent') as any;
        if (btnScript && btnScript.onTriggerUp && typeof btnScript.onTriggerUp.add === 'function') {
            btnScript.onTriggerUp.add(() => { this.onFetchInfoPressed(); });
            print('VehicleNarrator: Fetch Info button connected');
        }
    }

    private setupMuteButton(): void {
        if (!this.muteButton) return;
        this.updateMuteIcon();
        const btnScript = this.muteButton.getComponent('Component.ScriptComponent') as any;
        if (btnScript && btnScript.onTriggerUp && typeof btnScript.onTriggerUp.add === 'function') {
            btnScript.onTriggerUp.add(() => { this.onMuteButtonPressed(); });
            print('VehicleNarrator: Mute button connected');
        }
    }

    private onMuteButtonPressed(): void {
        this.isTtsMuted = !this.isTtsMuted;
        if (this.ttsAudioPlayer) {
            this.ttsAudioPlayer.volume = this.isTtsMuted ? 0.0 : 1.0;
        }
        if (this.ttsIsPlaying) {
            if (this.isTtsMuted) {
                if (this.onTTSPlaybackEnded) this.onTTSPlaybackEnded();
            } else {
                if (this.onTTSPlaybackStarted) this.onTTSPlaybackStarted();
            }
        }
        this.updateMuteIcon();
        if (this.onMuteStateChanged) this.onMuteStateChanged(this.isTtsMuted);
    }

    private updateMuteIcon(): void {
        if (!this.muteButtonText) return;
        this.muteButtonText.text = this.isTtsMuted ? '\u{1F507}' : '\u{1F50A}';
    }

    // =====================================================================
    // FETCH INFO — GPT narrative + TTS
    // =====================================================================

    private async onFetchInfoPressed(): Promise<void> {
        if (this.isFetchingInfo) return;
        if (!this.lastVehicleData) {
            this.showDescriptionText(t('scan_vehicle_first'));
            return;
        }

        this.isFetchingInfo = true;
        if (this.onReviewGenerationStarted) this.onReviewGenerationStarted();
        this.showAnimatedDescriptionText(t('loading_info'));

        const vehicle = this.lastVehicleData;
        const vehicleName = vehicle.brand_model || 'Unknown';
        const vehicleType = vehicle.type || 'Unknown';
        const brand = vehicle.brand || '';

        try {
            const description = await this.fetchVehicleDescription(vehicleName, vehicleType, brand);
            if (!description || description.trim().length === 0) {
                this.showDescriptionText(t('no_info_available'));
                this.isFetchingInfo = false;
                return;
            }

            this.showAnimatedDescriptionText(t('generating_audio'));
            await this.speakDescription(description);
        } catch (error) {
            print('VehicleNarrator: Fetch info error: ' + error);
            this.showDescriptionText(t('error_loading_info'));
            this.restoreCardReviewText();
        } finally {
            this.isFetchingInfo = false;
            if (this.onReviewGenerationFinished) this.onReviewGenerationFinished();
        }
    }

    /** Returns whether narrator audio is currently muted. */
    isMuted(): boolean {
        return this.isTtsMuted;
    }

    private async fetchVehicleDescription(vehicleName: string, vehicleType: string, brand: string): Promise<string> {
        const langInstruction = t('gpt_narrator_lang');
        const systemPrompt = `You are a legendary automotive magazine narrator, a blend of Jeremy Clarkson, the Gran Turismo voiceover, and the dry wit of The Grand Tour.

YOUR STYLE:
- Passionate, enthusiastic but with sarcastic British humour
- Absurd metaphors and unexpected comparisons (Clarkson style)
- A tone that makes even a Renault Scenic sound like a Ferrari
- Mix of fascinating historical anecdotes and funny punchlines
- Speak directly to the listener as if telling the story at the pub

CONTENT TO COVER (150-200 words max):
1. A catchy intro about the vehicle (with a sarcastic comment if appropriate)
2. Anecdotes about its creation/development (why this model exists, who designed it, in what context)
3. Its commercialization period and critical reception
4. A surprising or little-known fact
5. A memorable conclusion (with punchline)

IMPORTANT RULES:
- Reply ONLY with the narrative text, no markdown formatting, no headings
- No bullet points or lists
${langInstruction}
- The text will be read aloud, so make it sound natural and flowing
- Maximum 200 words
- Start directly with the text, no "Here is..." or meta introduction`;

        const userPrompt = tf('gpt_narrator_prompt', { vehicle: vehicleName, type: vehicleType, brand: brand });

        const response = await OpenAI.chatCompletions({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            model: 'gpt-4o',
            max_tokens: 500,
            temperature: 0.9,
        });

        if (response?.choices?.length > 0 && response.choices[0].message?.content) {
            return response.choices[0].message.content.trim();
        }
        return '';
    }

    private async speakDescription(text: string): Promise<void> {
        if (!this.ttsAudioPlayer) {
            this.ttsIsPlaying = false;
            this.startTextScroll(text);
            // Restore card review text after scroll if applicable
            if (this.isReviewFromCard) {
                const restoreEv = this.createEvent('DelayedCallbackEvent');
                restoreEv.bind(() => this.restoreCardReviewText());
                restoreEv.reset(15.0);
            }
            return;
        }

        try {
            const audioTrack = await OpenAI.speech({
                model: 'gpt-4o-mini-tts',
                input: text,
                voice: 'onyx',
                speed: 1.0,
                instructions: t('tts_instruction'),
            });

            this.ttsAudioPlayer.setOnFinish(() => {
                this.ttsIsPlaying = false;
                if (this.onTTSPlaybackEnded) this.onTTSPlaybackEnded();
                this.stopTextScroll();
                if (this.isReviewFromCard) {
                    // Card review: keep last text visible, restore target after delay
                    const restoreEv = this.createEvent('DelayedCallbackEvent');
                    restoreEv.bind(() => this.restoreCardReviewText());
                    restoreEv.reset(3.0);
                } else {
                    this.hideDescriptionAfterDelay(1.5);
                }
            });

            this.ttsAudioPlayer.volume = this.isTtsMuted ? 0.0 : 1.0;
            this.ttsIsPlaying = true;
            this.ttsAudioPlayer.audioTrack = audioTrack;
            this.startTextScroll(text);
            this.ttsAudioPlayer.play(1);
            if (!this.isTtsMuted && this.onTTSPlaybackStarted) this.onTTSPlaybackStarted();
        } catch (error) {
            print('VehicleNarrator: TTS error: ' + error);
            if (this.ttsIsPlaying && this.onTTSPlaybackEnded) this.onTTSPlaybackEnded();
            this.ttsIsPlaying = false;
            this.startTextScroll(text);
            // Restore card review text after scroll if applicable
            if (this.isReviewFromCard) {
                const restoreEv = this.createEvent('DelayedCallbackEvent');
                restoreEv.bind(() => this.restoreCardReviewText());
                restoreEv.reset(15.0);
            }
        }
    }

    // =====================================================================
    // TEXT SCROLL
    // =====================================================================

    private startTextScroll(fullText: string): void {
        this.stopTextScroll();
        this.stopDotsAnimation();
        if (!this.carDescriptionText) return;

        const descObj = this.carDescriptionText.getSceneObject();
        if (descObj) descObj.enabled = true;

        const rawSentences = fullText.match(/[^.!?]+[.!?]+/g);
        if (!rawSentences || rawSentences.length === 0) {
            this.carDescriptionText.text = fullText;
            return;
        }

        this.scrollSentences = rawSentences.map((s) => s.trim());
        this.scrollIndex = 0;
        this.updateScrollDisplay();
        this.scheduleNextScroll();
    }

    private updateScrollDisplay(): void {
        if (!this.carDescriptionText) return;
        const start = Math.max(0, this.scrollIndex - 1);
        const end = Math.min(this.scrollSentences.length, this.scrollIndex + 2);
        this.carDescriptionText.text = this.scrollSentences.slice(start, end).join(' ');
    }

    private scheduleNextScroll(): void {
        if (this.scrollIndex >= this.scrollSentences.length - 1) {
            if (!this.ttsIsPlaying) this.hideDescriptionAfterDelay(3.0);
            return;
        }

        const currentSentence = this.scrollSentences[this.scrollIndex];
        const wordCount = currentSentence.split(/\s+/).length;
        const readingTimeSeconds = Math.max(2, (wordCount / this.WORDS_PER_MINUTE) * 60);

        const event = this.createEvent('DelayedCallbackEvent');
        event.bind(() => {
            this.scrollIndex++;
            if (this.scrollIndex < this.scrollSentences.length) {
                this.updateScrollDisplay();
                this.scheduleNextScroll();
            }
        });
        event.reset(readingTimeSeconds);
        this.scrollDelayEvent = event;
    }

    private stopTextScroll(): void {
        if (this.scrollDelayEvent) {
            try { this.scrollDelayEvent.enabled = false; } catch (e) { /* ignore */ }
            this.scrollDelayEvent = null;
        }
        this.scrollSentences = [];
        this.scrollIndex = 0;
    }

    // =====================================================================
    // SUBTITLE DOTS ANIMATION
    // =====================================================================

    private animateDescriptionDots(baseText: string, step: number): void {
        if (!this.carDescriptionText) return;
        const dotCount = (step % 3) + 1;
        const ev = this.createEvent('DelayedCallbackEvent');
        ev.bind(() => {
            try {
                this.carDescriptionText.text = baseText + '.'.repeat(dotCount);
                this.animateDescriptionDots(baseText, step + 1);
            } catch (e) { /* Text component destroyed */ }
        });
        ev.reset(0.45);
        this.subtitleDotsEvent = ev;
    }

    // =====================================================================
    // STATUS TEXT — Internal helpers
    // =====================================================================

    /** Stops all status text animations (typewriter, idle cycle, scanning dots). */
    private stopAllStatusAnimations(): void {
        if (this.typewriterEvent) {
            try { this.typewriterEvent.enabled = false; } catch (e) { /* ignore */ }
            this.typewriterEvent = null;
        }
        if (this.idleCycleEvent) {
            try { this.idleCycleEvent.enabled = false; } catch (e) { /* ignore */ }
            this.idleCycleEvent = null;
        }
        if (this.scanningDotsEvent) {
            try { this.scanningDotsEvent.enabled = false; } catch (e) { /* ignore */ }
            this.scanningDotsEvent = null;
        }
    }

    /**
     * Starts typewriting the current idle phrase, character by character.
     * Once finished, waits a pause, then moves to the next phrase.
     */
    private typewriteNextPhrase(): void {
        if (this.statusMode !== 'idle' || !this.statusText) return;
        const phrases = getIdlePhrases();
        const phrase = phrases[this.idlePhraseIndex % phrases.length];
        this.typewriterCharIndex = 0;
        this.statusText.text = '';
        this.typewriteStep(phrase);
    }

    /** Types one character at a time, then schedules the next. */
    private typewriteStep(phrase: string): void {
        if (this.statusMode !== 'idle' || !this.statusText) return;

        if (this.typewriterCharIndex >= phrase.length) {
            // Phrase fully typed — hold for a moment, then move to next
            this.statusText.text = phrase;
            const waitEv = this.createEvent('DelayedCallbackEvent');
            waitEv.bind(() => {
                if (this.statusMode !== 'idle') return;
                this.idlePhraseIndex = (this.idlePhraseIndex + 1) % getIdlePhrases().length;
                this.typewriteNextPhrase();
            });
            waitEv.reset(3.5);
            this.idleCycleEvent = waitEv;
            return;
        }

        this.typewriterCharIndex++;
        this.statusText.text = phrase.substring(0, this.typewriterCharIndex);

        const charDelay = this.createEvent('DelayedCallbackEvent');
        charDelay.bind(() => {
            this.typewriteStep(phrase);
        });
        // Slight variation in typing speed for a natural feel
        const speed = 0.04 + Math.random() * 0.03;
        charDelay.reset(speed);
        this.typewriterEvent = charDelay;
    }

    /** Animated "Scanning." -> "Scanning.." -> "Scanning..." loop. */
    private animateScanningDots(step: number): void {
        if (this.statusMode !== 'scanning' || !this.statusText) return;
        const dotCount = (step % 3) + 1;
        const ev = this.createEvent('DelayedCallbackEvent');
        ev.bind(() => {
            if (this.statusMode !== 'scanning') return;
            try {
                this.statusText.text = t('scanning') + '.'.repeat(dotCount);
                this.animateScanningDots(step + 1);
            } catch (e) { /* destroyed */ }
        });
        ev.reset(0.45);
        this.scanningDotsEvent = ev;
    }
}
