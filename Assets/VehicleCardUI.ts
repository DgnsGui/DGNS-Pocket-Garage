/**
 * VehicleCardUI.ts — Vehicle Card display & UI state for DGNS Vehicle Scanner
 *
 * Handles:
 *   - Displaying vehicle identification results (text, stat bars, rarity)
 *   - UI state machine (loading / error / results / idle)
 *   - Vehicle Card close button polling & connection (Frame component lifecycle)
 *   - Universal button connector utility
 *
 * Exposes public methods for the orchestrator to drive the UI.
 *
 * @author DGNS
 * @license MIT
 */

import { VehicleData, formatCarType, formatRarityText, findChildByName, enableAllDescendants } from './VehicleTypes';
import { t } from './Localization';

@component
export class VehicleCardUI extends BaseScriptComponent {

    // =====================================================================
    // INPUTS — Vehicle Card elements
    // =====================================================================
    @input
    @allowUndefined
    @hint('Vehicle Card SceneObject (3D card displayed above the vehicle)')
    vehicleCard: SceneObject;

    @input
    @allowUndefined
    @hint('Text component for brand and model')
    brandModelText: Text;

    @input
    @allowUndefined
    @hint('Text component for vehicle type')
    carTypeText: Text;

    @input
    @allowUndefined
    @hint('Text component for production year')
    carYearText: Text;

    @input
    @allowUndefined
    @hint('"Car Rarity" Text component (displays ★★★☆☆ Uncommon)')
    carRarityText: Text;

    @input
    @allowUndefined
    @hint('"Car Brand Logo" SceneObject (with Image component)')
    carBrandLogo: SceneObject;

    // =====================================================================
    // INPUTS — Stat bars
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Top Speed Bar" SceneObject containing 5 Planes + 1 Text')
    topSpeedBar: SceneObject;

    @input
    @allowUndefined
    @hint('"Acceleration Bar" SceneObject containing 5 Planes + 1 Text')
    accelerationBar: SceneObject;

    @input
    @allowUndefined
    @hint('"Braking Bar" SceneObject containing 5 Planes + 1 Text')
    brakingBar: SceneObject;

    @input
    @allowUndefined
    @hint('"Traction Bar" SceneObject containing 5 Planes + 1 Text')
    tractionBar: SceneObject;

    @input
    @allowUndefined
    @hint('"Comfort Bar" SceneObject containing 5 Planes + 1 Text')
    comfortBar: SceneObject;

    @input
    @allowUndefined
    @hint('Text label "Top Speed"')
    topSpeedText: Text;

    @input
    @allowUndefined
    @hint('Text label "Acceleration"')
    accelerationText: Text;

    @input
    @allowUndefined
    @hint('Text label "Braking"')
    brakingText: Text;

    @input
    @allowUndefined
    @hint('Text label "Traction"')
    tractionText: Text;

    @input
    @allowUndefined
    @hint('Text label "Comfort"')
    comfortText: Text;

    @input
    @allowUndefined
    @hint('"Debug card text" — used for card generation status messages (separate from subtitles)')
    cardStatusText: Text;

    // =====================================================================
    // CALLBACKS — Set by orchestrator
    // =====================================================================

    /** Called when the Vehicle Card close button is pressed. */
    onCardClosed: (() => void) | null = null;

    /** Called when scan starts (status text should show "Scanning..."). */
    onScanStarted: (() => void) | null = null;
    /** Called when scan ends / UI state leaves loading. */
    onScanEnded: (() => void) | null = null;
    /** Called to show an error on the status text. */
    onShowError: ((message: string) => void) | null = null;

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private closeButtonConnected: boolean = false;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    private cardStatusHideEvent: SceneEvent | null = null;

    onAwake(): void {
        if (this.vehicleCard) this.vehicleCard.enabled = false;
        if (this.carBrandLogo) this.carBrandLogo.enabled = false;
        if (this.cardStatusText) {
            const obj = this.cardStatusText.getSceneObject();
            if (obj) obj.enabled = false;
        }
    }

    showCardStatus(text: string): void {
        if (!this.cardStatusText) return;
        const obj = this.cardStatusText.getSceneObject();
        if (obj) obj.enabled = true;
        this.cardStatusText.text = text;
        if (this.cardStatusHideEvent) {
            try { this.cardStatusHideEvent.enabled = false; } catch (e) { /* ignore */ }
            this.cardStatusHideEvent = null;
        }
    }

    hideCardStatusAfterDelay(seconds: number): void {
        if (this.cardStatusHideEvent) {
            try { this.cardStatusHideEvent.enabled = false; } catch (e) { /* ignore */ }
        }
        const ev = this.createEvent('DelayedCallbackEvent');
        ev.bind(() => {
            if (this.cardStatusText) {
                const obj = this.cardStatusText.getSceneObject();
                if (obj) obj.enabled = false;
                this.cardStatusText.text = '';
            }
        });
        ev.reset(seconds);
        this.cardStatusHideEvent = ev;
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /**
     * Displays vehicle identification results on the Vehicle Card.
     * Updates all text, stat bars, and rarity display.
     */
    displayResults(data: VehicleData): void {
        print('VehicleCardUI: Displaying results...');

        if (this.vehicleCard) {
            this.vehicleCard.enabled = true;
            enableAllDescendants(this.vehicleCard);
        }

        // Hide logo until texture is loaded
        if (this.carBrandLogo) this.carBrandLogo.enabled = false;

        if (this.brandModelText) this.brandModelText.text = data.brand_model;
        if (this.carTypeText) this.carTypeText.text = formatCarType(data.type);
        if (this.carYearText) this.carYearText.text = data.year || '';

        // Rarity display (★★★☆☆ Uncommon)
        const rarityDisplay = formatRarityText(data.rarity, data.rarity_label);
        if (this.carRarityText) {
            this.carRarityText.text = rarityDisplay;
        } else if (this.vehicleCard) {
            const rarityObj = findChildByName(this.vehicleCard, 'Car Rarity');
            if (rarityObj) {
                const textComp = rarityObj.getComponent('Component.Text') as Text;
                if (textComp) textComp.text = rarityDisplay;
            }
        }

        // Stat bars
        this.updateStatBar(this.topSpeedBar, data.top_speed);
        this.updateStatBar(this.accelerationBar, data.acceleration);
        this.updateStatBar(this.brakingBar, data.braking);
        this.updateStatBar(this.tractionBar, data.traction);
        this.updateStatBar(this.comfortBar, data.comfort);

        // Stat labels
        if (this.topSpeedText) this.topSpeedText.text = t('top_speed');
        if (this.accelerationText) this.accelerationText.text = t('acceleration');
        if (this.brakingText) this.brakingText.text = t('braking');
        if (this.tractionText) this.tractionText.text = t('traction');
        if (this.comfortText) this.comfortText.text = t('comfort');

        print('VehicleCardUI: ' + data.brand_model + ' (' + formatCarType(data.type) + ') ' + (data.year || ''));
    }

    /**
     * Sets the main UI state (loading / error / results / idle).
     * Manages Vehicle Card visibility and delegates status text to callbacks.
     * Triggers close button setup when entering 'results' state.
     */
    setUIState(state: 'loading' | 'error' | 'results' | 'idle', hideScanInterface?: () => void): void {
        if (state === 'results') {
            if (this.vehicleCard) {
                this.vehicleCard.enabled = true;
                // Frame initializes when SceneObject is enabled — connect close button now
                if (!this.closeButtonConnected) {
                    let delayFrames = 0;
                    const delayEvent = this.createEvent('UpdateEvent');
                    delayEvent.bind(() => {
                        delayFrames++;
                        if (delayFrames >= 5) {
                            delayEvent.enabled = false;
                            this.setupCloseButton();
                        }
                    });
                }
            }
            if (hideScanInterface) hideScanInterface();
            if (this.onScanEnded) this.onScanEnded();
        } else if (state === 'idle') {
            if (this.vehicleCard) this.vehicleCard.enabled = false;
            if (this.onScanEnded) this.onScanEnded();
        } else if (state === 'loading') {
            if (this.vehicleCard) this.vehicleCard.enabled = false;
            if (this.onScanStarted) this.onScanStarted();
        } else if (state === 'error') {
            if (this.onScanEnded) this.onScanEnded();
        }
    }

    /** Shows an error message via the status text callback. */
    showErrorMessage(message: string): void {
        if (this.onShowError) this.onShowError(message);
    }

    /**
     * Universal button connector — tries multiple strategies to connect a button event.
     * Iterates all ScriptComponents looking for PinchButton, UIKit, or SIK events.
     * Returns true if successfully connected.
     */
    connectButton(buttonObj: SceneObject, callback: () => void, debugName: string): boolean {
        const scripts = buttonObj.getComponents('Component.ScriptComponent') as any[];
        for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            if (!script) continue;

            // PinchButton (SIK)
            if (script.onButtonPinched && typeof script.onButtonPinched.add === 'function') {
                script.onButtonPinched.add(() => callback());
                print('VehicleCardUI: [' + debugName + '] connected via onButtonPinched');
                return true;
            }
            // UIKit onTriggerUp
            if (script.onTriggerUp && typeof script.onTriggerUp.add === 'function') {
                script.onTriggerUp.add(() => callback());
                print('VehicleCardUI: [' + debugName + '] connected via onTriggerUp');
                return true;
            }
            // SIK onTriggerEnd
            if (script.onTriggerEnd && typeof script.onTriggerEnd.add === 'function') {
                script.onTriggerEnd.add(() => callback());
                print('VehicleCardUI: [' + debugName + '] connected via onTriggerEnd');
                return true;
            }
            // SIK onTriggerStart
            if (script.onTriggerStart && typeof script.onTriggerStart.add === 'function') {
                script.onTriggerStart.add(() => callback());
                print('VehicleCardUI: [' + debugName + '] connected via onTriggerStart');
                return true;
            }
            // Toggle onStateChanged
            if (script.onStateChanged && typeof script.onStateChanged.add === 'function') {
                script.onStateChanged.add(() => callback());
                print('VehicleCardUI: [' + debugName + '] connected via onStateChanged');
                return true;
            }
            // SIK onInteractorTriggerEnd
            if (script.onInteractorTriggerEnd && typeof script.onInteractorTriggerEnd.add === 'function') {
                script.onInteractorTriggerEnd.add(() => callback());
                print('VehicleCardUI: [' + debugName + '] connected via onInteractorTriggerEnd');
                return true;
            }
        }
        return false;
    }

    // =====================================================================
    // STAT BARS
    // =====================================================================
    private updateStatBar(barObject: SceneObject, value: number): void {
        if (!barObject) return;

        const clampedValue = Math.max(0, Math.min(5, Math.round(value)));
        const childCount = barObject.getChildrenCount();
        let planeIndex = 0;

        for (let i = 0; i < childCount; i++) {
            const child = barObject.getChild(i);
            if (!child) continue;

            // Skip Text children, only process Plane/mesh segments
            const visual = child.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
            if (!visual) continue;

            child.enabled = (planeIndex < clampedValue);
            planeIndex++;
        }
    }

    // =====================================================================
    // CLOSE BUTTON — Polling & connection
    // =====================================================================

    private setupCloseButton(): void {
        if (this.closeButtonConnected || !this.vehicleCard) return;
        if (!this.vehicleCard.enabled) return;

        let attempts = 0;
        const maxAttempts = 300;
        const pollEvent = this.createEvent('UpdateEvent');
        pollEvent.bind(() => {
            if (this.closeButtonConnected) { pollEvent.enabled = false; return; }
            attempts++;
            if (attempts > maxAttempts) {
                pollEvent.enabled = false;
                this.lastResortCloseButtonSearch();
                return;
            }

            // Primary: Frame.closeButton
            try {
                const scripts = this.vehicleCard.getComponents('Component.ScriptComponent') as any[];
                for (let si = 0; si < scripts.length; si++) {
                    const script = scripts[si];
                    if (!script) continue;

                    let closeBtn: any = null;
                    try { closeBtn = script.closeButton; } catch (e) { continue; }

                    if (closeBtn) {
                        if (closeBtn.onTriggerUp && typeof closeBtn.onTriggerUp.add === 'function') {
                            closeBtn.onTriggerUp.add(() => this.handleCardClosed());
                            this.closeButtonConnected = true;
                            pollEvent.enabled = false;
                            print('VehicleCardUI: Close button connected via onTriggerUp');
                            return;
                        }
                        if (closeBtn.onButtonPinched && typeof closeBtn.onButtonPinched.add === 'function') {
                            closeBtn.onButtonPinched.add(() => this.handleCardClosed());
                            this.closeButtonConnected = true;
                            pollEvent.enabled = false;
                            print('VehicleCardUI: Close button connected via onButtonPinched');
                            return;
                        }
                    }
                }
            } catch (e) { /* polling */ }

            // Fallback: search FrameObject children
            if (attempts % 30 === 0) {
                const frameObj = findChildByName(this.vehicleCard, 'FrameObject');
                if (frameObj && this.searchForCloseButtonIn(frameObj)) {
                    this.closeButtonConnected = true;
                    pollEvent.enabled = false;
                }
            }
        });
    }

    private handleCardClosed(): void {
        print('VehicleCardUI: Vehicle Card closed');
        if (this.vehicleCard) this.vehicleCard.enabled = false;
        if (this.onCardClosed) this.onCardClosed();
    }

    private lastResortCloseButtonSearch(): void {
        if (this.closeButtonConnected || !this.vehicleCard) return;
        this.deepSearchForButton(this.vehicleCard, 0);
    }

    private deepSearchForButton(parent: SceneObject, depth: number): void {
        if (this.closeButtonConnected || depth > 10) return;
        const count = parent.getChildrenCount();
        for (let i = 0; i < count; i++) {
            if (this.closeButtonConnected) return;
            const child = parent.getChild(i);
            if (!child) continue;
            const scripts = child.getComponents('Component.ScriptComponent') as any[];
            for (let si = 0; si < scripts.length; si++) {
                const script = scripts[si];
                if (!script) continue;
                if (script.onTriggerUp && typeof script.onTriggerUp.add === 'function') {
                    script.onTriggerUp.add(() => this.handleCardClosed());
                    this.closeButtonConnected = true;
                    print('VehicleCardUI: Close button found via deep search on "' + child.name + '"');
                    return;
                }
            }
            this.deepSearchForButton(child, depth + 1);
        }
    }

    private searchForCloseButtonIn(parent: SceneObject): boolean {
        const count = parent.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = parent.getChild(i);
            if (!child) continue;
            if (this.connectButton(child, () => this.handleCardClosed(), 'FrameClose')) {
                return true;
            }
            if (this.searchForCloseButtonIn(child)) return true;
        }
        return false;
    }
}
