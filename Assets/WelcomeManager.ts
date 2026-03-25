/**
 * WelcomeManager.ts — Welcome screen, language selection & mode selection
 *
 * Flow:
 *   1. Language Container shows first (FR / EN / ES flags + Accept button)
 *   2. Clicking a flag sets the language and updates Accept button text live
 *   3. Clicking Accept hides Language Container, shows Welcome Container in selected language
 *   4. Solo / Connected Lens buttons start the appropriate mode
 *
 * @author DGNS
 * @license MIT
 */

import { setLanguage, t, getLanguage, Lang } from './Localization';

@component
export class WelcomeManager extends BaseScriptComponent {

    // =====================================================================
    // INPUTS — Language Container
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Language Container" SceneObject — shown first at launch for language selection')
    languageContainer: SceneObject;

    @input
    @allowUndefined
    @hint('"Accept CapsuleButton" SceneObject inside Language Container')
    acceptButton: SceneObject;

    @input
    @allowUndefined
    @hint('Text component of the Accept button label (child of Accept CapsuleButton)')
    acceptButtonText: Text;

    @input
    @allowUndefined
    @hint('"Language Button FR" SceneObject')
    languageButtonFR: SceneObject;

    @input
    @allowUndefined
    @hint('"Language Button EN" SceneObject')
    languageButtonEN: SceneObject;

    @input
    @allowUndefined
    @hint('"Language Button ES" SceneObject')
    languageButtonES: SceneObject;

    // =====================================================================
    // INPUTS — Welcome Container
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Welcome Container" root SceneObject — shown after language is accepted')
    welcomeContainer: SceneObject;

    @input
    @allowUndefined
    @hint('Title Text component in Welcome Container ("DGNS Pocket Garage")')
    welcomeTitleText: Text;

    @input
    @allowUndefined
    @hint('Description Text component in Welcome Container')
    welcomeDescriptionText: Text;

    @input
    @allowUndefined
    @hint('Text component inside Solo CapsuleButton')
    soloButtonText: Text;

    @input
    @allowUndefined
    @hint('Text component inside Connected Lens CapsuleButton')
    connectedLensButtonText: Text;

    @input
    @allowUndefined
    @hint('"Solo CapsuleButton" SceneObject — starts solo mode')
    soloButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Connected Lens CapsuleButton" SceneObject — starts connected lens mode (Phase 2)')
    connectedLensButton: SceneObject;

    // =====================================================================
    // CALLBACKS — Set by orchestrator
    // =====================================================================
    onSoloModeSelected: (() => void) | null = null;
    onConnectedLensModeSelected: (() => void) | null = null;
    onShowMessage: ((text: string) => void) | null = null;
    onConnectButton: ((obj: SceneObject, cb: () => void, name: string) => boolean) | null = null;
    onLanguageSelected: ((lang: Lang) => void) | null = null;

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private buttonsConnected: boolean = false;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        if (this.languageContainer) this.languageContainer.enabled = true;
        if (this.welcomeContainer) this.welcomeContainer.enabled = false;

        this.createEvent('OnStartEvent').bind(() => {
            this.setupButtons();
            print('WelcomeManager: Language selection screen ready');
        });
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    show(): void {
        if (this.languageContainer) this.languageContainer.enabled = true;
        if (this.welcomeContainer) this.welcomeContainer.enabled = false;
        print('WelcomeManager: Language selection shown');
    }

    hide(): void {
        if (this.languageContainer) this.languageContainer.enabled = false;
        if (this.welcomeContainer) this.welcomeContainer.enabled = false;
        print('WelcomeManager: All containers hidden');
    }

    // =====================================================================
    // LANGUAGE SELECTION
    // =====================================================================

    private selectLanguage(lang: Lang): void {
        setLanguage(lang);
        if (this.acceptButtonText) {
            this.acceptButtonText.text = t('accept_button');
        }
        print('WelcomeManager: Language selected — ' + lang + ' → Accept="' + t('accept_button') + '"');
    }

    private onAcceptPressed(): void {
        print('WelcomeManager: Accept pressed — language=' + getLanguage());

        if (this.languageContainer) this.languageContainer.enabled = false;

        this.applyWelcomeTranslations();

        if (this.welcomeContainer) this.welcomeContainer.enabled = true;

        if (this.onLanguageSelected) this.onLanguageSelected(getLanguage());
    }

    private applyWelcomeTranslations(): void {
        if (this.welcomeTitleText) this.welcomeTitleText.text = t('welcome_title');
        if (this.welcomeDescriptionText) this.welcomeDescriptionText.text = t('welcome_description');
        if (this.soloButtonText) this.soloButtonText.text = t('solo');
        if (this.connectedLensButtonText) this.connectedLensButtonText.text = t('connected_lens');
    }

    // =====================================================================
    // BUTTON SETUP
    // =====================================================================

    private setupButtons(): void {
        if (this.buttonsConnected) return;

        // Language flag buttons
        this.connectButtonWithPolling(this.languageButtonFR, () => {
            this.selectLanguage('fr');
        }, 'LangFR');

        this.connectButtonWithPolling(this.languageButtonEN, () => {
            this.selectLanguage('en');
        }, 'LangEN');

        this.connectButtonWithPolling(this.languageButtonES, () => {
            this.selectLanguage('es');
        }, 'LangES');

        // Accept button
        this.connectButtonWithPolling(this.acceptButton, () => {
            this.onAcceptPressed();
        }, 'AcceptButton');

        // Solo button
        this.connectButtonWithPolling(this.soloButton, () => {
            print('WelcomeManager: Solo mode selected');
            this.hide();
            if (this.onSoloModeSelected) this.onSoloModeSelected();
        }, 'SoloButton');

        // Connected Lens button
        this.connectButtonWithPolling(this.connectedLensButton, () => {
            print('WelcomeManager: Connected Lens mode selected');
            this.hide();
            if (this.onConnectedLensModeSelected) this.onConnectedLensModeSelected();
        }, 'ConnectedLensButton');

        this.buttonsConnected = true;
    }

    private connectButtonWithPolling(
        buttonObj: SceneObject | undefined,
        callback: () => void,
        debugName: string
    ): void {
        if (!buttonObj) {
            print('WelcomeManager: [' + debugName + '] button not assigned');
            return;
        }

        if (this.onConnectButton) {
            const connected = this.onConnectButton(buttonObj, callback, debugName);
            if (connected) {
                print('WelcomeManager: [' + debugName + '] connected via onConnectButton');
                return;
            }
        }

        let attempts = 0;
        const maxAttempts = 300;
        let hooked = false;
        const pollEvent = this.createEvent('UpdateEvent');
        pollEvent.bind(() => {
            if (hooked) { pollEvent.enabled = false; return; }
            attempts++;
            if (attempts > maxAttempts) { pollEvent.enabled = false; return; }

            try {
                const scripts = buttonObj.getComponents('Component.ScriptComponent') as any[];
                for (let i = 0; i < scripts.length; i++) {
                    const script = scripts[i];
                    if (!script) continue;
                    if (script.onButtonPinched && typeof script.onButtonPinched.add === 'function') {
                        script.onButtonPinched.add(() => callback());
                        hooked = true;
                        pollEvent.enabled = false;
                        print('WelcomeManager: [' + debugName + '] connected via onButtonPinched');
                        return;
                    }
                    if (script.onTriggerUp && typeof script.onTriggerUp.add === 'function') {
                        script.onTriggerUp.add(() => callback());
                        hooked = true;
                        pollEvent.enabled = false;
                        print('WelcomeManager: [' + debugName + '] connected via onTriggerUp');
                        return;
                    }
                }
            } catch (e) { /* polling */ }
        });
    }
}
