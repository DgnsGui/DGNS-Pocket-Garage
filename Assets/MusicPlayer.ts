import { t, tf } from './Localization';

@component
export class MusicPlayer extends BaseScriptComponent {
    // =====================================================================
    // INPUTS
    // =====================================================================

    @input
    @hint('Array of AudioTrackAsset to use as playlist')
    tracks: AudioTrackAsset[];

    @input
    @hint('AudioComponent dedicated to music playback')
    audioPlayer: AudioComponent;

    @input
    @allowUndefined
    @hint('"Play/Pause Button" SceneObject (with RectangleButton/BaseButton)')
    playPauseButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Previous Track Button" SceneObject (with RectangleButton/BaseButton)')
    prevTrackButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Next Track Button" SceneObject (with RectangleButton/BaseButton)')
    nextTrackButton: SceneObject;

    @input
    @allowUndefined
    @hint('Text element under Play/Pause button to show play/pause emoji icon')
    playPauseText: Text;

    @input
    @allowUndefined
    @hint('Text element to display current track name (optional)')
    trackNameText: Text;

    @input
    @hint('Auto-play first track on start')
    autoPlay: boolean = true;

    @input
    @hint('Loop playlist when reaching the end')
    loopPlaylist: boolean = true;

    @input
    @hint('Music volume (0.0 to 1.0)')
    volume: number = 0.5;

    @input
    @hint('Volume multiplier while narrator speaks (0.5 = 50%)')
    narratorDuckMultiplier: number = 0.5;

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private currentTrackIndex: number = 0;
    private isPlaying: boolean = false;
    private isPaused: boolean = false;
    private suppressNextFinishCallback: boolean = false;
    private isNarrationDucked: boolean = false;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        print('MusicPlayer: Initializing...');

        if (!this.audioPlayer) {
            print('MusicPlayer: ERROR - audioPlayer not assigned!');
            return;
        }

        if (!this.tracks || this.tracks.length === 0) {
            print('MusicPlayer: WARNING - no tracks in playlist');
            return;
        }

        print('MusicPlayer: ' + this.tracks.length + ' tracks loaded');

        // Set initial output volume
        this.applyOutputVolume();

        // Register finish callback to auto-advance to next track
        this.audioPlayer.setOnFinish(() => {
            if (this.suppressNextFinishCallback) {
                this.suppressNextFinishCallback = false;
                print('MusicPlayer: onFinish ignored (manual pause/stop)');
                return;
            }
            if (this.isPaused) {
                print('MusicPlayer: onFinish ignored (currently paused)');
                return;
            }
            print('MusicPlayer: Track finished');
            this.onTrackFinished();
        });

        // Wait for SIK/UIKit to initialize
        this.createEvent('OnStartEvent').bind(() => {
            this.setupButtons();

            if (this.autoPlay) {
                this.playTrack(0);
            } else {
                this.updatePlayPauseIcon();
                this.updateTrackNameDisplay();
            }
        });
    }

    // =====================================================================
    // BUTTON SETUP
    // =====================================================================
    private setupButtons(): void {
        // Play/Pause button
        if (this.playPauseButton) {
            const ok = this.bindButtonEvent(this.playPauseButton, () => this.onPlayPausePressed(), 'Play/Pause');
            if (!ok) print('MusicPlayer: Play/Pause: no supported button event found');
        }

        // Previous Track button
        if (this.prevTrackButton) {
            const ok = this.bindButtonEvent(this.prevTrackButton, () => this.onPrevTrackPressed(), 'Prev Track');
            if (!ok) print('MusicPlayer: Prev Track: no supported button event found');
        }

        // Next Track button
        if (this.nextTrackButton) {
            const ok = this.bindButtonEvent(this.nextTrackButton, () => this.onNextTrackPressed(), 'Next Track');
            if (!ok) print('MusicPlayer: Next Track: no supported button event found');
        }
    }

    private bindButtonEvent(root: SceneObject, cb: () => void, label: string): boolean {
        const toCheck: SceneObject[] = [root];
        const childCount = root.getChildrenCount();
        for (let i = 0; i < childCount; i++) {
            const child = root.getChild(i);
            if (child) toCheck.push(child);
        }

        for (let i = 0; i < toCheck.length; i++) {
            const obj = toCheck[i];
            const scripts = obj.getComponents('Component.ScriptComponent') as any[];
            for (let j = 0; j < scripts.length; j++) {
                const s = scripts[j];
                if (!s) continue;
                if (s.onTriggerUp && typeof s.onTriggerUp.add === 'function') {
                    s.onTriggerUp.add(cb);
                    print('MusicPlayer: ' + label + ' button connected (trigger)');
                    return true;
                }
                if (s.onButtonPinched && typeof s.onButtonPinched.add === 'function') {
                    s.onButtonPinched.add(cb);
                    print('MusicPlayer: ' + label + ' button connected (pinch)');
                    return true;
                }
            }
        }
        return false;
    }

    // =====================================================================
    // PLAYBACK CONTROLS
    // =====================================================================

    /**
     * Plays the track at the given index.
     */
    private playTrack(index: number): void {
        if (!this.tracks || this.tracks.length === 0) return;
        if (!this.audioPlayer) return;

        // Clamp index
        if (index < 0) index = this.loopPlaylist ? this.tracks.length - 1 : 0;
        if (index >= this.tracks.length) index = this.loopPlaylist ? 0 : this.tracks.length - 1;

        this.currentTrackIndex = index;
        const track = this.tracks[this.currentTrackIndex];

        if (!track) {
            print('MusicPlayer: Track at index ' + index + ' is null');
            return;
        }

        try {
            this.audioPlayer.audioTrack = track;
            this.applyOutputVolume();
            this.audioPlayer.play(1);
            this.isPlaying = true;
            this.isPaused = false;
            print('MusicPlayer: Playing track ' + (this.currentTrackIndex + 1) + '/' + this.tracks.length);
        } catch (e) {
            print('MusicPlayer: Error playing track: ' + e);
        }

        this.updatePlayPauseIcon();
        this.updateTrackNameDisplay();
    }

    /**
     * Called when Play/Pause button is pressed.
     */
    private onPlayPausePressed(): void {
        if (!this.audioPlayer) return;

        if (this.isPlaying && !this.isPaused) {
            // Currently playing → pause
            try {
                this.suppressNextFinishCallback = true;
                this.audioPlayer.pause();
                this.isPaused = true;
                print('MusicPlayer: Paused');
            } catch (e) {
                print('MusicPlayer: Pause error: ' + e);
            }
        } else if (this.isPaused) {
            // Currently paused → resume
            try {
                this.audioPlayer.resume();
                this.applyOutputVolume();
                this.isPaused = false;
                print('MusicPlayer: Resumed');
            } catch (e) {
                print('MusicPlayer: Resume error: ' + e);
            }
        } else {
            // Not playing at all → start from current track
            this.playTrack(this.currentTrackIndex);
        }

        this.updatePlayPauseIcon();
    }

    /**
     * Lowers/restores music volume while narrator TTS is speaking.
     * true => duck to baseVolume * narratorDuckMultiplier
     * false => restore base volume
     */
    setNarrationDucked(ducked: boolean): void {
        this.isNarrationDucked = ducked;
        this.applyOutputVolume();
    }

    private applyOutputVolume(): void {
        if (!this.audioPlayer) return;
        const base = Math.max(0, Math.min(1, this.volume));
        const duck = Math.max(0, Math.min(1, this.narratorDuckMultiplier));
        this.audioPlayer.volume = this.isNarrationDucked ? base * duck : base;
    }

    /**
     * Called when Previous Track button is pressed.
     */
    private onPrevTrackPressed(): void {
        print('MusicPlayer: Previous track');
        // Stop current playback
        try {
            this.suppressNextFinishCallback = true;
            this.audioPlayer.stop(true);
        } catch (e) {
            // ignore
        }
        this.playTrack(this.currentTrackIndex - 1);
    }

    /**
     * Called when Next Track button is pressed.
     */
    private onNextTrackPressed(): void {
        print('MusicPlayer: Next track');
        // Stop current playback
        try {
            this.suppressNextFinishCallback = true;
            this.audioPlayer.stop(true);
        } catch (e) {
            // ignore
        }
        this.playTrack(this.currentTrackIndex + 1);
    }

    /**
     * Called when the current track finishes playing.
     * Auto-advances to the next track.
     */
    private onTrackFinished(): void {
        const nextIndex = this.currentTrackIndex + 1;

        if (nextIndex >= this.tracks.length) {
            if (this.loopPlaylist) {
                print('MusicPlayer: Playlist looping back to start');
                this.playTrack(0);
            } else {
                print('MusicPlayer: Playlist ended');
                this.isPlaying = false;
                this.isPaused = false;
                this.updatePlayPauseIcon();
            }
        } else {
            this.playTrack(nextIndex);
        }
    }

    // =====================================================================
    // UI UPDATES
    // =====================================================================

    /**
     * Updates the play/pause emoji icon.
     */
    private updatePlayPauseIcon(): void {
        if (!this.playPauseText) return;
        if (this.isPlaying && !this.isPaused) {
            this.playPauseText.text = '\u{23F8}'; // ⏸ pause icon
        } else {
            this.playPauseText.text = '\u{25B6}'; // ▶ play icon
        }
    }

    /**
     * Updates the track name display if a text element is assigned.
     */
    private updateTrackNameDisplay(): void {
        if (!this.trackNameText) return;
        if (!this.tracks || this.tracks.length === 0) {
            this.trackNameText.text = t('no_tracks');
            return;
        }
        const track = this.tracks[this.currentTrackIndex];
        if (track && track.name) {
            this.trackNameText.text = track.name;
        } else {
            this.trackNameText.text = tf('track_n', { n: this.currentTrackIndex + 1 });
        }
    }
}
