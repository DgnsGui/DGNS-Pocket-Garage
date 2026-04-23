/**
 * CollectionManager.ts — Vehicle card collection for DGNS Vehicle Scanner
 *
 * The largest module, handling:
 *   - Saving vehicles to the collection and persistent storage
 *   - Loading collection from PersistentStorageSystem on startup
 *   - Card prefab instantiation and population (texts, stat bars, logos, images)
 *   - Show / hide / toggle collection carousel
 *   - Circular layout for the carousel
 *   - Per-frame update loop (delegates to CardInteraction)
 *   - Delete card flow (button → confirm dialog → remove from arrays + storage)
 *   - Reveal animation for newly saved cards
 *   - AI image generation for collector cards (gpt-image-1 Image Edit)
 *   - Card image loading/saving from/to persistent storage
 *
 * Owns the parallel arrays: savedVehicles[], collectionCardObjects[],
 * cardStates[], cardImageReady[], cardFrameHooked[].
 *
 * @author DGNS
 * @license MIT
 */

import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI';
import {
    VehicleData, SavedVehicleData, SimplifiedCard, TradeHistoryEntry,
    findChildByName, enableAllDescendants, formatCarType,
    getRarityLabel, formatRarityText, clampStat, generateSerial,
    formatScanDate, getTrustColor,
} from './VehicleTypes';
import { BrandLogoLoader } from './BrandLogoLoader';
import { t, tf } from './Localization';
import { CardInteraction } from './CardInteraction';

@component
export class CollectionManager extends BaseScriptComponent {

    // =====================================================================
    // MODULES
    // =====================================================================
    private remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule');
    private internetModule: InternetModule = require('LensStudio:InternetModule');
    private depthModule: DepthModule = require('LensStudio:DepthModule');

    // Declare location permissions for Spectacles (both required)
    // GPS - Precise (for LocationService lat/lon)
    private rawLocationModule = require('LensStudio:RawLocationModule');
    // Location - Coarse (for processed/city-level location data)
    private processedLocationModule = require('LensStudio:ProcessedLocationModule');

    // =====================================================================
    // INPUTS — Collection UI
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Save" button SceneObject on the Vehicle Card')
    saveButton: SceneObject;

    @input
    @allowUndefined
    @hint('ObjectPrefab for the Vertical Collector Card template')
    verticalCardPrefab: ObjectPrefab;

    @input
    @allowUndefined
    @hint('"Open Collection" PinchButton SceneObject on the wrist')
    openCollectionButton: SceneObject;

    @input
    @allowUndefined
    @hint('Text component on the Open Collection button (toggles "Open" / "Close")')
    openCollectionButtonText: Text;

    @input
    @allowUndefined
    @hint('Left palm anchor SceneObject (tracks the left palm center)')
    leftPalmAnchor: SceneObject;

    @input
    @allowUndefined
    @hint('Card Collection Container — SceneObject under Left Hand Wrist')
    cardCollectionContainer: SceneObject;

    // =====================================================================
    // INPUTS — Delete Card UI
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Share Collection" button on left hand (inside User Card Info)')
    shareCollectionButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Confirm Share Container" with confirmation text, URL text, Yes/Cancel buttons')
    confirmShareContainer: SceneObject;

    @input
    @allowUndefined
    @hint('"Yes CapsuleButton" inside Confirm Share Container')
    confirmShareYesButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Cancel CapsuleButton" inside Confirm Share Container')
    confirmShareCancelButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Collection Shared Confirmation" Text — displays the URL after sharing')
    shareConfirmationText: Text;

    @input
    @allowUndefined
    @hint('"Reset Profile" button inside User Card Info')
    resetCollectionButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Confirm Reset Profile" container with Yes/Cancel buttons')
    confirmResetProfileContainer: SceneObject;

    @input
    @allowUndefined
    @hint('"Yes" button inside Confirm Reset Profile Container')
    confirmResetYesButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Cancel" button inside Confirm Reset Profile Container')
    confirmResetCancelButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Delete Card" button on left hand')
    deleteCardButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Confirm Delete Card" container with Yes/Cancel buttons')
    confirmDeleteContainer: SceneObject;

    @input
    @allowUndefined
    @hint('"Yes" button inside Confirm Delete Container')
    confirmDeleteYesButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Cancel" button inside Confirm Delete Container')
    confirmDeleteCancelButton: SceneObject;

    // =====================================================================
    // INPUTS — Script references (set in Inspector)
    // =====================================================================
    @input
    @allowUndefined
    @hint('BrandLogoLoader script reference (for loading logos onto collector cards)')
    brandLogoLoader: BrandLogoLoader;

    @input
    @allowUndefined
    @hint('CardInteraction script reference (handles grab/release, auto-rotation, lerp)')
    cardInteraction: CardInteraction;

    @input
    @allowUndefined
    @hint('Maximum number of cards in collection. Default: 25. Increase for premium users.')
    maxCollectionSize: number = 25;

    // =====================================================================
    // CALLBACKS — Set by orchestrator
    // =====================================================================
    /** Called to show description text. */
    onShowDescription: ((text: string) => void) | null = null;
    /** Called to show animated description text. */
    onShowAnimatedDescription: ((text: string) => void) | null = null;
    /** Called to show card generation status on a separate text element (does not interrupt subtitles). */
    onShowCardStatus: ((text: string) => void) | null = null;
    /** Called to hide the card status text after a delay. */
    onHideCardStatus: ((seconds: number) => void) | null = null;
    /** Called to hide description after delay. */
    onHideDescriptionAfterDelay: ((seconds: number) => void) | null = null;
    /** Called to connect a button (utility from VehicleCardUI). */
    onConnectButton: ((obj: SceneObject, cb: () => void, name: string) => boolean) | null = null;
    /** Called when a collector card's "Review" button is pressed (triggers TopGear narration). */
    onReviewVehicle: ((data: SavedVehicleData, cardReviewText?: Text) => void) | null = null;
    /** Called when review generation starts (audio+text fetch begins). */
    onReviewGenerationStarted: (() => void) | null = null;
    /** Called when a card is successfully saved to the collection (for XP attribution). */
    onCardSaved: ((data: SavedVehicleData) => void) | null = null;
    /** Called when card image generation starts. */
    onCardGenerationStarted: (() => void) | null = null;
    /** Called when card image generation succeeds and card is ready. */
    onCardGenerationSuccess: (() => void) | null = null;
    /** Called when card image generation fails. */
    onCardGenerationFailed: (() => void) | null = null;
    /** Called when reveal card starts flying back to inventory. */
    onCardFlyToInventory: (() => void) | null = null;
    /** Called when the carousel visibility changes (for Connected Lens sync). angle in radians. */
    onCarouselVisibilityChanged: ((visible: boolean, cardData: SimplifiedCard[], carouselAngle?: number) => void) | null = null;
    /** Called to sync a single vehicle to cloud after save. */
    onCloudSyncVehicle: ((vehicle: SavedVehicleData) => void) | null = null;
    /** Called to upload a card image to cloud storage. */
    onCloudUploadImage: ((serial: string, base64: string) => void) | null = null;
    /** Called to delete a vehicle from cloud. */
    onCloudDeleteVehicle: ((serial: string) => void) | null = null;
    /** Called to sync full collection to cloud (on startup). */
    onCloudSyncFullCollection: ((vehicles: SavedVehicleData[]) => void) | null = null;
    /** Called to share the collection to the web gallery. Returns the gallery URL via callback. */
    onShareCollection: ((callback: (url: string) => void) => void) | null = null;
    /** Called to reset (delete all) vehicles from cloud + gallery. */
    onCloudResetCollection: (() => void) | null = null;
    /** Returns trust display string for populating cards (username + rank + trust%). */
    onGetTrustDisplayString: (() => string) | null = null;

    // =====================================================================
    // CONSTANTS
    // =====================================================================
    private readonly STORAGE_KEY: string = 'dgns_vehicle_collection';
    private readonly IMAGE_KEY_PREFIX: string = 'dgns_img_';
    private readonly TRADE_HISTORY_KEY: string = 'dgns_trade_history';
    private readonly HTTP_USER_AGENT: string = 'LensStudio/5.15 SnapSpectacles CarScanner/1.0';

    // Card states (mirrors CardInteraction constants)
    private readonly STATE_IN_COLLECTION: number = 0;
    private readonly STATE_PICKED: number = 1;
    private readonly STATE_PLACED_IN_WORLD: number = 2;

    // =====================================================================
    // COLLECTION STATE — Parallel arrays, all kept in sync
    // =====================================================================
    private savedVehicles: SavedVehicleData[] = [];
    collectionCardObjects: SceneObject[] = [];
    private cardStates: number[] = [];
    private cardImageReady: boolean[] = [];
    private cardFrameHooked: boolean[] = [];
    private reviewButtonHooked: boolean[] = [];

    isCollectionOpen: boolean = false;
    private isSavingCard: boolean = false;
    private lastVehicleData: VehicleData | null = null;

    // Last captured photo (Base64, compressed) — used for OpenAI Image Edit (gpt-image-1)
    private lastCapturedBase64: string = '';

    // Trade history — persistent log of all trades
    private tradeHistory: TradeHistoryEntry[] = [];
    /** Called to sync a trade history entry to cloud. */
    onCloudSyncTradeHistory: ((entry: TradeHistoryEntry) => void) | null = null;

    // Image generation queue — processes one at a time to avoid overwhelming OpenAI API
    private _imageQueue: Array<{
        data: SavedVehicleData;
        capturedBase64: string;
        resolve: (tex: Texture) => void;
        reject: (err: any) => void;
    }> = [];
    private _imageQueueProcessing: boolean = false;

    // Delete card state
    private deleteTargetCardIndex: number = -1;
    private deleteButtonConnected: boolean = false;
    private confirmDeleteConnected: boolean = false;

    // Share collection state
    private shareButtonConnected: boolean = false;
    private confirmShareConnected: boolean = false;
    private isSharing: boolean = false;

    // Reset profile state
    private resetButtonConnected: boolean = false;
    private confirmResetConnected: boolean = false;
    private confirmResetTextComp: Text | null = null;

    // Collection root (parented to left hand wrist)
    private collectionRoot: SceneObject | null = null;

    // Cached city (pre-fetched asynchronously via UserContextSystem.requestCity)
    private cachedCity: string = '';

    // Reveal animation
    private revealParent: SceneObject | null = null;
    private isRevealAnimating: boolean = false;
    private revealAnimEvent: SceneEvent | null = null;

    // Update loop
    private collectionUpdateEvent: SceneEvent | null = null;

    // Depth data for head transform (reveal animation positioning)
    private depthSession: DepthFrameSession;
    private latestDepthData: DepthFrameData | null = null;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        if (this.deleteCardButton) this.deleteCardButton.enabled = false;
        if (this.confirmDeleteContainer) this.confirmDeleteContainer.enabled = false;
        if (this.confirmShareContainer) this.confirmShareContainer.enabled = false;
        if (this.confirmResetProfileContainer) this.confirmResetProfileContainer.enabled = false;

        // Pre-fetch city as early as possible (async callback API)
        this.prefetchCity();

        this.createEvent('OnStartEvent').bind(() => {
            this.setupDepthTracking();
            this.setupOpenCollectionButton();
            this.setupSaveButton();
            this.setupDeleteCardButton();
            this.setupShareButton();
            this.setupResetButton();
            this.loadCollectionFromStorage();
            this.loadTradeHistory();
            this.hookFrameCloseButtons();
        });
    }

    // =====================================================================
    // CITY PRE-FETCH — Dual strategy: UserContextSystem + GPS reverse geocoding
    // =====================================================================

    /**
     * Pre-fetches the user's city using two parallel strategies:
     *
     * 1) UserContextSystem.requestCity() — Snap's built-in callback API.
     *    May or may not fire depending on platform/permissions.
     *
     * 2) GPS LocationService + Nominatim reverse geocoding — Official Spectacles
     *    Location API (requires RawLocationModule). Gets lat/lon then resolves
     *    city name via OpenStreetMap's free Nominatim API.
     *
     * Whichever resolves first populates `cachedCity`. The second result
     * is ignored if a city is already cached.
     *
     * Called at startup (onAwake) and refreshed before each scan.
     */
    prefetchCity(): void {
        // Strategy 1: UserContextSystem.requestCity()
        this.tryUserContextSystemCity();

        // Strategy 2: GPS + Reverse Geocoding (Spectacles official Location API)
        this.tryGPSCity();
    }

    /** Returns the cached city name (populated asynchronously). */
    getCachedCity(): string {
        return this.cachedCity;
    }

    // ----- Strategy 1: UserContextSystem.requestCity() -----

    private tryUserContextSystemCity(): void {
        try {
            const ucs = (global as any).userContextSystem;
            if (ucs && typeof ucs.requestCity === 'function') {
                ucs.requestCity((city: string) => {
                    if (city && typeof city === 'string' && city.length > 0) {
                        // Reject results that start with a comma (missing city, region only)
                        const trimmed = city.trim();
                        if (trimmed.startsWith(',') || trimmed.startsWith(' ,')) {
                            print('CollectionManager: [UCS] Incomplete result (no city): "' + city + '"');
                            return;
                        }
                        this.cachedCity = trimmed;
                        print('CollectionManager: [UCS] City = "' + trimmed + '"');
                    } else {
                        print('CollectionManager: [UCS] requestCity callback returned empty');
                    }
                });
                print('CollectionManager: [UCS] requestCity() called...');
            } else {
                print('CollectionManager: [UCS] UserContextSystem not available');
            }
        } catch (e) {
            print('CollectionManager: [UCS] Error: ' + e);
        }
    }

    // ----- Strategy 2: GPS LocationService + Nominatim reverse geocoding -----

    private tryGPSCity(): void {
        try {
            const locationService = GeoLocation.createLocationService();
            locationService.accuracy = GeoLocationAccuracy.Navigation;

            locationService.getCurrentPosition(
                (geoPosition: GeoPosition) => {
                    const lat = geoPosition.latitude;
                    const lon = geoPosition.longitude;
                    print('CollectionManager: [GPS] Position: lat=' + lat.toFixed(5) + ', lon=' + lon.toFixed(5));

                    // Always attempt reverse geocoding — it gives precise city names.
                    // Will overwrite UCS if UCS result was incomplete or empty.
                    this.reverseGeocode(lat, lon);
                },
                (error: string) => {
                    print('CollectionManager: [GPS] LocationService error: ' + error);
                }
            );
            print('CollectionManager: [GPS] getCurrentPosition() called...');
        } catch (e) {
            print('CollectionManager: [GPS] GeoLocation unavailable: ' + e);
        }
    }

    /**
     * Reverse geocodes lat/lon to a city name via OpenStreetMap Nominatim API.
     * Free, no API key required, lightweight JSON response.
     */
    private reverseGeocode(lat: number, lon: number): void {
        try {
            const url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat='
                + lat + '&lon=' + lon + '&zoom=10&addressdetails=1';

            const request = RemoteServiceHttpRequest.create();
            request.url = url;
            request.setHeader('User-Agent', this.HTTP_USER_AGENT);
            request.setHeader('Accept', 'application/json');

            this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
                if (response.statusCode < 200 || response.statusCode >= 400) {
                    print('CollectionManager: [GEO] HTTP ' + response.statusCode);
                    return;
                }

                try {
                    const body = response.body;
                    const data = JSON.parse(body);

                    // Nominatim returns address.city, .town, .village, or .municipality
                    let city = '';
                    if (data && data.address) {
                        city = data.address.city
                            || data.address.town
                            || data.address.village
                            || data.address.municipality
                            || data.address.county
                            || '';
                    }

                    if (city.length > 0) {
                        // Always prefer Nominatim — it provides the actual city name
                        this.cachedCity = city;
                        print('CollectionManager: [GEO] City from Nominatim = "' + city + '"');
                    } else {
                        print('CollectionManager: [GEO] Nominatim returned no city. Address: '
                            + JSON.stringify(data.address || {}));
                    }
                } catch (parseErr) {
                    print('CollectionManager: [GEO] JSON parse error: ' + parseErr);
                }
            });
            print('CollectionManager: [GEO] Reverse geocoding request sent...');
        } catch (e) {
            print('CollectionManager: [GEO] Reverse geocode error: ' + e);
        }
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /** Sets the last scanned vehicle data (needed for save). */
    setLastVehicleData(data: VehicleData | null): void {
        this.lastVehicleData = data;
    }

    /**
     * Stores the compressed Base64 photo captured by VehicleScanner.
     * This image will be sent to OpenAI Image Edit (gpt-image-1) to create
     * a collector card using the actual vehicle photo.
     */
    setLastCapturedImage(base64: string): void {
        this.lastCapturedBase64 = base64;
    }

    /** Returns true if a save or reveal animation is in progress. */
    isBusy(): boolean {
        return this.isSavingCard || this.isRevealAnimating;
    }

    /** Toggles collection open/closed. */
    toggleCollection(): void {
        if (this.isCollectionOpen) {
            this.hideCollection();
        } else {
            this.showCollection();
        }
    }

    // =====================================================================
    // DEPTH TRACKING (for reveal animation head positioning)
    // =====================================================================
    private setupDepthTracking(): void {
        try {
            this.depthSession = this.depthModule.createDepthFrameSession();
            this.depthSession.onNewFrame.add((depthData: DepthFrameData) => {
                this.latestDepthData = depthData;
            });
            this.depthSession.start();
        } catch (e) {
            print('CollectionManager: Depth tracking unavailable: ' + e);
        }
    }

    /** Returns the user head transform from depth tracking (public for billboard). */
    getUserHeadTransformPublic(): { position: vec3; forward: vec3; rotation: quat } | null {
        return this.getUserHeadTransform();
    }

    private getUserHeadTransform(): { position: vec3; forward: vec3; rotation: quat } | null {
        if (!this.latestDepthData) return null;
        try {
            const worldFromDevice = this.latestDepthData.toWorldTrackingOriginFromDeviceRef;
            const headPos = new vec3(worldFromDevice.column3.x, worldFromDevice.column3.y, worldFromDevice.column3.z);
            const forward = new vec3(-worldFromDevice.column2.x, -worldFromDevice.column2.y, -worldFromDevice.column2.z).normalize();
            const toUser = forward.uniformScale(-1);
            const rotation = quat.lookAt(toUser, vec3.up());
            return { position: headPos, forward, rotation };
        } catch (e) {
            return null;
        }
    }

    // =====================================================================
    // BUTTON SETUP
    // =====================================================================

    private setupOpenCollectionButton(): void {
        if (!this.openCollectionButton) return;
        if (this.onConnectButton) {
            this.onConnectButton(this.openCollectionButton, () => {
                print('CollectionManager: Open Collection pressed');
                this.toggleCollection();
            }, 'OpenCollection');
        }
        this.updateCollectionButtonLabel();
    }

    updateCollectionButtonLabel(): void {
        if (!this.openCollectionButtonText) return;
        if (this.isCollectionOpen) {
            this.openCollectionButtonText.text = t('close_collection');
        } else if (this.collectionCardObjects.length === 0) {
            this.openCollectionButtonText.text = t('no_vehicles_collection');
        } else {
            this.openCollectionButtonText.text = t('open_collection');
        }
    }

    private setupSaveButton(): void {
        if (!this.saveButton) return;
        if (this.onConnectButton) {
            this.onConnectButton(this.saveButton, () => {
                print('CollectionManager: Save pressed');
                this.onSaveButtonPressed();
            }, 'Save');
        }
    }

    private setupDeleteCardButton(): void {
        if (this.deleteCardButton && !this.deleteButtonConnected && this.onConnectButton) {
            if (this.onConnectButton(this.deleteCardButton, () => this.onDeleteCardButtonPressed(), 'DeleteCard')) {
                this.deleteButtonConnected = true;
            }
        }
        if (this.confirmDeleteYesButton && !this.confirmDeleteConnected && this.onConnectButton) {
            if (this.onConnectButton(this.confirmDeleteYesButton, () => this.onConfirmDeleteYes(), 'ConfirmYes')) {
                this.confirmDeleteConnected = true;
            }
            if (this.confirmDeleteCancelButton) {
                this.onConnectButton(this.confirmDeleteCancelButton, () => this.onConfirmDeleteCancel(), 'ConfirmCancel');
            }
        }
    }

    private setupShareButton(): void {
        if (this.shareCollectionButton && !this.shareButtonConnected && this.onConnectButton) {
            if (this.onConnectButton(this.shareCollectionButton, () => this.onShareButtonPressed(), 'ShareCollection')) {
                this.shareButtonConnected = true;
            }
        }
        if (this.confirmShareYesButton && !this.confirmShareConnected && this.onConnectButton) {
            if (this.onConnectButton(this.confirmShareYesButton, () => this.onConfirmShareYes(), 'ShareYes')) {
                this.confirmShareConnected = true;
            }
            if (this.confirmShareCancelButton) {
                this.onConnectButton(this.confirmShareCancelButton, () => this.onConfirmShareCancel(), 'ShareCancel');
            }
        }
    }

    // =====================================================================
    // SHARE COLLECTION
    // =====================================================================

    private onShareButtonPressed(): void {
        if (this.isSharing) return;
        if (this.savedVehicles.length === 0) {
            if (this.onShowDescription) this.onShowDescription(t('no_vehicles_share'));
            return;
        }
        if (this.confirmShareContainer) {
            this.showContainer(this.confirmShareContainer, () => this.onConfirmShareCancel(), 'ConfirmShareClose');
        }
        if (this.shareConfirmationText) this.shareConfirmationText.text = t('share_confirm');
        if (this.onShowDescription) this.onShowDescription(t('share_collection_q'));
    }

    private onConfirmShareYes(): void {
        if (this.isSharing) return;
        this.isSharing = true;

        if (this.shareConfirmationText) this.shareConfirmationText.text = t('sharing');
        if (this.onShowDescription) this.onShowDescription(t('sharing_collection'));

        if (this.onShareCollection) {
            this.onShareCollection((url: string) => {
                this.isSharing = false;
                if (this.shareConfirmationText) this.shareConfirmationText.text = t('share_url') + url;
                if (this.onShowDescription) this.onShowDescription(t('collection_shared'));

                const hideDelay = this.createEvent('DelayedCallbackEvent');
                (hideDelay as any).reset(8.0);
                hideDelay.bind(() => {
                    if (this.confirmShareContainer) this.confirmShareContainer.enabled = false;
                });
            });
        } else {
            this.isSharing = false;
            if (this.shareConfirmationText) this.shareConfirmationText.text = t('share_unavailable');
            if (this.onShowDescription) this.onShowDescription(t('share_unavail_short'));

            const hideDelay = this.createEvent('DelayedCallbackEvent');
            (hideDelay as any).reset(4.0);
            hideDelay.bind(() => {
                if (this.confirmShareContainer) this.confirmShareContainer.enabled = false;
            });
        }
    }

    private onConfirmShareCancel(): void {
        this.isSharing = false;
        if (this.shareConfirmationText) this.shareConfirmationText.text = t('collection_not_shared');
        if (this.onShowDescription) this.onShowDescription(t('collection_not_shared'));

        const hideDelay = this.createEvent('DelayedCallbackEvent') as any;
        hideDelay.reset(3.0);
        hideDelay.bind(() => {
            if (this.confirmShareContainer) this.confirmShareContainer.enabled = false;
        });
    }

    // =====================================================================
    // RESET COLLECTION
    // =====================================================================

    private setupResetButton(): void {
        if (this.resetCollectionButton && !this.resetButtonConnected && this.onConnectButton) {
            if (this.onConnectButton(this.resetCollectionButton, () => this.onResetButtonPressed(), 'ResetProfile')) {
                this.resetButtonConnected = true;
            }
        }
        if (this.confirmResetYesButton && !this.confirmResetConnected && this.onConnectButton) {
            if (this.onConnectButton(this.confirmResetYesButton, () => this.onConfirmResetYes(), 'ResetYes')) {
                this.confirmResetConnected = true;
            }
            if (this.confirmResetCancelButton) {
                this.onConnectButton(this.confirmResetCancelButton, () => this.onConfirmResetCancel(), 'ResetCancel');
            }
        }
        this.resolveConfirmResetText();
    }

    private resolveConfirmResetText(): void {
        if (!this.confirmResetProfileContainer) return;
        const childCount = this.confirmResetProfileContainer.getChildrenCount();
        for (let i = 0; i < childCount; i++) {
            const child = this.confirmResetProfileContainer.getChild(i);
            if (!child) continue;
            try {
                const textComp = child.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.confirmResetTextComp = textComp;
                    break;
                }
            } catch (e) { /* ignore */ }
        }
    }

    private onResetButtonPressed(): void {
        if (this.confirmResetTextComp) {
            this.confirmResetTextComp.text = t('reset_confirm');
        }
        if (this.confirmResetProfileContainer) {
            this.showContainer(this.confirmResetProfileContainer, () => this.onConfirmResetCancel(), 'ConfirmResetClose');
        }
        if (this.onShowDescription) this.onShowDescription(t('reset_profile_q'));
    }

    private onConfirmResetYes(): void {
        if (this.confirmResetProfileContainer) this.confirmResetProfileContainer.enabled = false;
        this.executeResetCollection();
    }

    private onConfirmResetCancel(): void {
        if (this.confirmResetProfileContainer) this.confirmResetProfileContainer.enabled = false;
        if (this.onShowDescription) this.onShowDescription(t('reset_cancelled'));
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(1.5);
    }

    private executeResetCollection(): void {
        // Cancel all active operations before destroying data
        this._imageQueue = [];
        this._imageQueueProcessing = false;
        this.isSavingCard = false;
        this.isRevealAnimating = false;
        if (this.revealAnimEvent) {
            try { this.revealAnimEvent.enabled = false; } catch (e) { /* ignore */ }
            this.revealAnimEvent = null;
        }

        const count = this.savedVehicles.length;

        // Cloud reset: deletes vehicles, shared gallery, and storage images
        if (this.onCloudResetCollection) {
            print('CollectionManager: [RESET] Triggering cloud reset (' + count + ' vehicles + gallery + images)');
            this.onCloudResetCollection();
        } else {
            print('CollectionManager: [RESET] WARNING — no cloud reset callback wired');
        }

        // Destroy all card SceneObjects
        for (let i = 0; i < this.collectionCardObjects.length; i++) {
            const card = this.collectionCardObjects[i];
            if (card) {
                const parent = card.getParent();
                try { card.destroy(); } catch (e) { /* ignore */ }
                if (parent && parent.name && parent.name.indexOf('WorldCard_') >= 0) {
                    try { parent.destroy(); } catch (e) { /* ignore */ }
                }
            }
        }

        // Clear stored images
        for (let i = 0; i < this.savedVehicles.length; i++) {
            const savedAt = this.savedVehicles[i]?.savedAt;
            if (savedAt) {
                try {
                    global.persistentStorageSystem.store.putString(this.IMAGE_KEY_PREFIX + savedAt.toString(), '');
                } catch (e) { /* ignore */ }
            }
        }

        // Clear all parallel arrays
        this.savedVehicles = [];
        this.collectionCardObjects = [];
        this.cardStates = [];
        this.cardImageReady = [];
        this.cardFrameHooked = [];
        this.reviewButtonHooked = [];

        if (this.cardInteraction) this.cardInteraction.setGrabbedCardIndex(-1);

        this.saveCollectionToStorage();
        if (this.isCollectionOpen) this.hideCollection();
        this.updateDeleteButtonVisibility();
        this.updateCollectionButtonLabel();

        if (this.onShowDescription) this.onShowDescription(tf('profile_reset', { count: count }));
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(4.0);
        print('CollectionManager: Collection reset — ' + count + ' cards destroyed');
    }

    // =====================================================================
    // DELETE CARD
    // =====================================================================

    private onDeleteCardButtonPressed(): void {
        let targetIdx = this.cardInteraction ? this.cardInteraction.getGrabbedCardIndex() : -1;

        if (targetIdx < 0) {
            for (let i = 0; i < this.cardStates.length; i++) {
                if (this.cardStates[i] === this.STATE_PLACED_IN_WORLD) { targetIdx = i; break; }
            }
        }
        if (targetIdx < 0) {
            for (let i = 0; i < this.cardStates.length; i++) {
                if (this.cardStates[i] === this.STATE_PICKED) { targetIdx = i; break; }
            }
        }
        if (targetIdx < 0) {
            if (this.onShowDescription) this.onShowDescription(t('no_card_delete'));
            if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(2.0);
            return;
        }

        this.deleteTargetCardIndex = targetIdx;
        if (this.confirmDeleteContainer) {
            this.showContainer(this.confirmDeleteContainer, () => this.onConfirmDeleteCancel(), 'ConfirmDeleteClose');
        }
        if (this.onShowDescription) this.onShowDescription(tf('delete_confirm', { name: this.savedVehicles[targetIdx]?.brand_model || '?' }));
    }

    private onConfirmDeleteYes(): void {
        if (this.confirmDeleteContainer) this.confirmDeleteContainer.enabled = false;

        const idx = this.deleteTargetCardIndex;
        if (idx < 0 || idx >= this.collectionCardObjects.length) {
            this.deleteTargetCardIndex = -1;
            return;
        }

        const name = this.savedVehicles[idx]?.brand_model || '?';
        const savedAt = this.savedVehicles[idx]?.savedAt;
        const serial = this.savedVehicles[idx]?.serial;

        // Cloud delete (fire-and-forget)
        if (serial && this.onCloudDeleteVehicle) this.onCloudDeleteVehicle(serial);

        // Destroy SceneObject
        const card = this.collectionCardObjects[idx];
        if (card) {
            const parent = card.getParent();
            try { card.destroy(); } catch (e) { /* ignore */ }
            if (parent && parent.name && parent.name.indexOf('WorldCard_') >= 0) {
                try { parent.destroy(); } catch (e) { /* ignore */ }
            }
        }

        // Clear stored image
        if (savedAt) {
            try {
                global.persistentStorageSystem.store.putString(this.IMAGE_KEY_PREFIX + savedAt.toString(), '');
            } catch (e) { /* ignore */ }
        }

        // Remove from parallel arrays
        this.savedVehicles.splice(idx, 1);
        this.collectionCardObjects.splice(idx, 1);
        this.cardStates.splice(idx, 1);
        this.cardImageReady.splice(idx, 1);
        this.cardFrameHooked.splice(idx, 1);
        this.reviewButtonHooked.splice(idx, 1);

        // Adjust grabbed index
        if (this.cardInteraction) {
            const grabbed = this.cardInteraction.getGrabbedCardIndex();
            if (grabbed === idx) this.cardInteraction.setGrabbedCardIndex(-1);
            else if (grabbed > idx) this.cardInteraction.setGrabbedCardIndex(grabbed - 1);
        }

        this.saveCollectionToStorage();
        if (this.isCollectionOpen) this.layoutCircularCards();
        this.updateDeleteButtonVisibility();
        this.updateCollectionButtonLabel();
        this.deleteTargetCardIndex = -1;

        if (this.onShowDescription) this.onShowDescription(tf('card_deleted', { name: name }));
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(2.5);
    }

    private onConfirmDeleteCancel(): void {
        if (this.confirmDeleteContainer) this.confirmDeleteContainer.enabled = false;
        if (this.onShowDescription) this.onShowDescription(t('delete_cancelled'));
        this.deleteTargetCardIndex = -1;
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(1.5);
    }

    private _deleteButtonForceDisabled: boolean = false;

    updateDeleteButtonVisibility(): void {
        if (!this.deleteCardButton) return;
        if (this._deleteButtonForceDisabled) {
            this.deleteCardButton.enabled = false;
            return;
        }
        let hasCardOutside = false;
        for (let i = 0; i < this.cardStates.length; i++) {
            if (this.cardStates[i] === this.STATE_PICKED || this.cardStates[i] === this.STATE_PLACED_IN_WORLD) {
                hasCardOutside = true; break;
            }
        }
        this.deleteCardButton.enabled = hasCardOutside;
        if (!hasCardOutside && this.confirmDeleteContainer) {
            this.confirmDeleteContainer.enabled = false;
            this.deleteTargetCardIndex = -1;
        }
    }

    /**
     * Force-disable the delete button (e.g. when User Card is open).
     * Pass false to re-evaluate normal visibility.
     */
    setDeleteButtonForceDisabled(disabled: boolean): void {
        this._deleteButtonForceDisabled = disabled;
        this.updateDeleteButtonVisibility();
    }

    /**
     * Hooks Frame.ts close buttons (X) on containers so they trigger our dismiss logic.
     * Frame.ts creates close buttons dynamically but doesn't auto-hide the container.
     */
    private hookFrameCloseButtons(): void {
        // Close buttons are hooked lazily via showContainer() because Frame.ts
        // only creates its FrameObject + buttons after its OnStartEvent fires,
        // which requires the container to be enabled first.
    }

    private _closeHooked: Set<SceneObject> = new Set();

    /**
     * Shows a container: positions it in front of the user's gaze, enables it,
     * and lazily hooks the Frame.ts close button if not already done.
     */
    showContainer(container: SceneObject, closeCallback: () => void, debugName: string): void {
        this.positionInFrontOfUser(container);
        container.enabled = true;

        if (!this._closeHooked.has(container)) {
            let attempts = 0;
            const poll = this.createEvent('UpdateEvent');
            poll.bind(() => {
                attempts++;
                if (this._closeHooked.has(container) || attempts > 120) {
                    poll.enabled = false;
                    return;
                }
                if (this.deepSearchAndHookClose(container, closeCallback, debugName)) {
                    this._closeHooked.add(container);
                    poll.enabled = false;
                }
            });
        }
    }

    private deepSearchAndHookClose(root: SceneObject, callback: () => void, debugName: string): boolean {
        const count = root.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = root.getChild(i);
            if (!child) continue;
            if (child.name === 'FrameObject') {
                if (this.searchButtonsIn(child, callback, debugName)) return true;
            }
            if (this.deepSearchAndHookClose(child, callback, debugName)) return true;
        }
        return false;
    }

    private searchButtonsIn(parent: SceneObject, callback: () => void, debugName: string): boolean {
        const count = parent.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = parent.getChild(i);
            if (!child) continue;
            const scripts = child.getComponents('Component.ScriptComponent') as any[];
            for (let si = 0; si < scripts.length; si++) {
                try {
                    const s = scripts[si];
                    if (!s) continue;
                    if (s.onTriggerUp && typeof s.onTriggerUp.add === 'function') {
                        s.onTriggerUp.add(() => callback());
                        print('CollectionManager: Frame close button hooked — ' + debugName);
                        return true;
                    }
                    if (s.onButtonPinched && typeof s.onButtonPinched.add === 'function') {
                        s.onButtonPinched.add(() => callback());
                        print('CollectionManager: Frame close button hooked (pinch) — ' + debugName);
                        return true;
                    }
                } catch (e) { /* ignore */ }
            }
            if (this.searchButtonsIn(child, callback, debugName)) return true;
        }
        return false;
    }

    private readonly CONTAINER_SPAWN_DISTANCE: number = 60;

    private positionInFrontOfUser(container: SceneObject): void {
        const head = this.getUserHeadTransform();
        if (!head) return;
        try {
            const spawnPos = head.position.add(head.forward.uniformScale(this.CONTAINER_SPAWN_DISTANCE));
            const transform = container.getTransform();
            transform.setWorldPosition(spawnPos);
            transform.setWorldRotation(quat.quatIdentity());
        } catch (e) { /* ignore */ }
    }

    /**
     * Translates all static UI texts in containers (Yes/Cancel buttons, question texts, warnings).
     * Called once after language selection.
     */
    translateStaticTexts(): void {
        if (this.confirmDeleteContainer) this.walkAndTranslate(this.confirmDeleteContainer);
        if (this.confirmShareContainer) this.walkAndTranslate(this.confirmShareContainer);
        if (this.confirmResetProfileContainer) this.walkAndTranslate(this.confirmResetProfileContainer);
        this.updateCollectionButtonLabel();
        print('CollectionManager: Static UI texts translated');
    }

    private walkAndTranslate(obj: SceneObject): void {
        const name = obj.name;
        try {
            const textComp = obj.getComponent('Component.Text') as Text;
            if (textComp) {
                if (name === 'Yes') {
                    textComp.text = t('yes');
                } else if (name === 'Cancel') {
                    textComp.text = t('cancel_btn');
                } else if (name.indexOf('action cannot be undone') >= 0 || name.indexOf('This action') >= 0) {
                    textComp.text = t('action_undone');
                } else if (name.indexOf('delete this card') >= 0) {
                    textComp.text = t('delete_card_question');
                } else if (name.indexOf('share your collection') >= 0) {
                    textComp.text = t('share_question');
                } else if (name.indexOf('reset your profile') >= 0) {
                    textComp.text = t('reset_question');
                }
            }
        } catch (e) { /* no text component */ }
        const count = obj.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = obj.getChild(i);
            if (child) this.walkAndTranslate(child);
        }
    }

    /** Close all popup containers (confirm delete, confirm share, confirm reset). */
    closeAllPopups(): void {
        if (this.confirmDeleteContainer) {
            this.confirmDeleteContainer.enabled = false;
            this.deleteTargetCardIndex = -1;
        }
        if (this.confirmShareContainer) {
            this.confirmShareContainer.enabled = false;
        }
        if (this.confirmResetProfileContainer) {
            this.confirmResetProfileContainer.enabled = false;
        }
    }

    // =====================================================================
    // SAVE VEHICLE TO COLLECTION
    // =====================================================================

    private async onSaveButtonPressed(): Promise<void> {
        if (this.isSavingCard || this.isRevealAnimating) {
            if (this.onShowDescription) this.onShowDescription(t('save_in_progress'));
            return;
        }
        this.isSavingCard = true;
        if (!this.lastVehicleData) {
            if (this.onShowDescription) this.onShowDescription(t('scan_first_save'));
            this.isSavingCard = false;
            return;
        }
        if (!this.verticalCardPrefab) {
            if (this.onShowDescription) this.onShowDescription(t('error_prefab'));
            this.isSavingCard = false;
            return;
        }
        const maxSize = this.maxCollectionSize || 25;
        if (this.savedVehicles.length >= maxSize) {
            if (this.onShowAnimatedDescription) {
                this.onShowAnimatedDescription(tf('max_cards', { max: maxSize }));
            } else if (this.onShowDescription) {
                this.onShowDescription(tf('max_cards', { max: maxSize }));
            }
            this.isSavingCard = false;
            return;
        }

        try {
            const vehicleName = this.lastVehicleData.brand_model || 'Unknown';
            if (this.onShowDescription) this.onShowDescription(tf('saving', { name: vehicleName }));

            // Duplicate check
            const isDuplicate = this.savedVehicles.some(v => v.brand_model === this.lastVehicleData!.brand_model);
            if (isDuplicate) {
                if (this.onShowDescription) this.onShowDescription(tf('already_saved', { name: vehicleName }));
                this.isSavingCard = false;
                return;
            }

            const scanTimestamp = Date.now();
            const savedData: SavedVehicleData = {
                vehicle_found: this.lastVehicleData.vehicle_found,
                brand: this.lastVehicleData.brand,
                brand_model: this.lastVehicleData.brand_model,
                type: this.lastVehicleData.type,
                year: this.lastVehicleData.year,
                top_speed: this.lastVehicleData.top_speed,
                acceleration: this.lastVehicleData.acceleration,
                braking: this.lastVehicleData.braking,
                traction: this.lastVehicleData.traction,
                comfort: this.lastVehicleData.comfort,
                rarity: this.lastVehicleData.rarity || 2,
                rarity_label: this.lastVehicleData.rarity_label || getRarityLabel(this.lastVehicleData.rarity || 2),
                scene: this.lastVehicleData.scene || '',
                savedAt: scanTimestamp,
                imageGenerated: false,
                serial: generateSerial(),
                dateScanned: formatScanDate(scanTimestamp),
                cityScanned: this.cachedCity,
            };

            print('CollectionManager: Card saved — serial=' + savedData.serial
                + ' date="' + savedData.dateScanned + '" city="' + savedData.cityScanned + '"');
            this.savedVehicles.push(savedData);
            this.saveCollectionToStorage();

            // Cloud sync (fire-and-forget)
            if (this.onCloudSyncVehicle) this.onCloudSyncVehicle(savedData);

            const showStatus = this.onShowCardStatus || this.onShowAnimatedDescription;
            const hideStatus = this.onHideCardStatus || null;
            if (showStatus) showStatus(t('generating_card') + '...');
            if (this.onCardGenerationStarted) this.onCardGenerationStarted();

            this.queueImageGeneration(savedData).then((texture) => {
                const revealRoot = this.getOrCreateRevealParent();
                const cardObj = this.verticalCardPrefab.instantiate(revealRoot);
                if (!cardObj) {
                    if (showStatus) showStatus(t('card_instantiation_fail'));
                    if (hideStatus) hideStatus(4.0);
                    this.isSavingCard = false;
                    return;
                }

                this.populateCollectorCard(cardObj, savedData);

                if (texture) {
                    this.applyCardImage(cardObj, texture);
                    savedData.imageGenerated = true;
                    this.saveCollectionToStorage();
                    this.saveCardImageToStorage(vehicleName, savedData.savedAt, texture, savedData.serial);
                }

                if (showStatus) showStatus(tf('card_ready', { name: vehicleName }));
                if (this.onCardGenerationSuccess) this.onCardGenerationSuccess();

                this.playCardRevealAnimation(cardObj, vehicleName, () => {
                    this.ensureCollectionRoot();
                    if (this.collectionRoot) {
                        cardObj.setParent(this.collectionRoot);
                        const t = cardObj.getTransform();
                        t.setLocalPosition(vec3.zero());
                        t.setLocalRotation(quat.fromEulerAngles(0, 0, 0));
                        const s = this.cardInteraction ? this.cardInteraction.collectionCardScale : 0.18;
                        t.setLocalScale(new vec3(s, s, s));
                    }
                    cardObj.enabled = false;
                    this.collectionCardObjects.push(cardObj);
                    this.cardStates.push(this.STATE_IN_COLLECTION);
                    this.cardImageReady.push(texture != null);
                    this.cardFrameHooked.push(false);
                    this.reviewButtonHooked.push(false);
                    this.syncInteractionState();
                    if (this.cardInteraction) {
                        this.cardInteraction.hookCardFrameEvents(cardObj, this.collectionCardObjects.length - 1);
                    }
                    this.isSavingCard = false;
                    this.updateCollectionButtonLabel();
                    if (showStatus) showStatus(tf('added_to_collection', { name: vehicleName, count: this.savedVehicles.length }));
                    if (hideStatus) hideStatus(2.5);

                    // Notify orchestrator for XP attribution
                    if (this.onCardSaved) this.onCardSaved(savedData);
                });
            }).catch((err) => {
                const errMsg = typeof err === 'string' ? err : (err && err.message ? err.message : JSON.stringify(err));
                print('CollectionManager: [SAVE] Image generation FAILED: ' + errMsg);
                const idx = this.savedVehicles.indexOf(savedData);
                if (idx >= 0) {
                    this.savedVehicles.splice(idx, 1);
                    this.saveCollectionToStorage();
                }
                if (showStatus) showStatus(t('card_gen_failed'));
                if (hideStatus) hideStatus(6.0);
                if (this.onCardGenerationFailed) this.onCardGenerationFailed();
                this.isSavingCard = false;
            });
        } catch (error) {
            if (this.onShowDescription) this.onShowDescription(tf('save_error', { error: String(error) }));
            this.isSavingCard = false;
        }
    }

    // =====================================================================
    // COLLECTION DISPLAY
    // =====================================================================

    private showCollection(): void {
        if (this.isRevealAnimating) {
            if (this.onShowDescription) this.onShowDescription(t('wait_reveal'));
            return;
        }
        if (this.collectionCardObjects.length === 0) {
            if (this.onShowDescription) this.onShowDescription(t('collection_empty'));
            if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(3.0);
            return;
        }

        this.isCollectionOpen = true;
        this.updateCollectionButtonLabel();
        if (this.cardInteraction) {
            this.cardInteraction.setGrabbedCardIndex(-1);
            this.cardInteraction.carouselAngleOffset = 0;
        }

        this.ensureCollectionRoot();
        if (this.collectionRoot) this.collectionRoot.enabled = true;

        // Enable cards and re-apply stats
        for (let i = 0; i < this.collectionCardObjects.length; i++) {
            const card = this.collectionCardObjects[i];
            if (!card) continue;
            const state = this.cardStates[i] || this.STATE_IN_COLLECTION;
            if (state === this.STATE_PLACED_IN_WORLD) continue;

            card.enabled = true;
            enableAllDescendants(card);

            // Hide card images whose texture hasn't loaded yet (BUG 1 fix)
            if (!this.cardImageReady[i]) {
                const cardImageObj = findChildByName(card, 'Card Image');
                if (cardImageObj) cardImageObj.enabled = false;
            }

            // Re-apply stat bars after enableAllDescendants (stats fix)
            if (i < this.savedVehicles.length) {
                this.reapplyCardStatBars(card, this.savedVehicles[i]);
            }

            this.cardStates[i] = this.STATE_IN_COLLECTION;
        }

        this.layoutCircularCards();
        this.startCollectionUpdateLoop();

        // Hook Frame events for unhooked cards
        if (this.cardInteraction) {
            for (let i = 0; i < this.collectionCardObjects.length; i++) {
                if (!this.cardFrameHooked[i] && this.collectionCardObjects[i]) {
                    this.cardInteraction.hookCardFrameEvents(this.collectionCardObjects[i], i);
                }
            }
        }

        // Hook Review buttons (deferred — RectangleButton needs enabled frames to initialize)
        this.hookPendingReviewButtons();

        if (this.onShowDescription) this.onShowDescription(tf('collection_count', { count: this.collectionCardObjects.length }));
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(3.0);

        // Notify Connected Lens that carousel is now visible (with current angle so remote sees correct rotation)
        if (this.onCarouselVisibilityChanged) {
            const angle = this.cardInteraction ? this.cardInteraction.carouselAngleOffset : 0;
            this.onCarouselVisibilityChanged(true, this.getSimplifiedCardData(), angle);
        }
    }

    hideCollection(): void {
        this.isCollectionOpen = false;
        this.updateCollectionButtonLabel();
        if (this.cardInteraction) this.cardInteraction.setGrabbedCardIndex(-1);

        const cs = this.cardInteraction ? this.cardInteraction.collectionCardScale : 0.18;

        for (let i = 0; i < this.collectionCardObjects.length; i++) {
            const card = this.collectionCardObjects[i];
            if (!card) continue;
            const state = this.cardStates[i] || this.STATE_IN_COLLECTION;
            if (state === this.STATE_PLACED_IN_WORLD) continue;

            if (this.collectionRoot && card.getParent() !== this.collectionRoot) {
                const oldParent = card.getParent();
                card.setParent(this.collectionRoot);
                card.getTransform().setLocalPosition(vec3.zero());
                card.getTransform().setLocalScale(new vec3(cs, cs, cs));
                if (oldParent && oldParent.name && oldParent.name.indexOf('WorldCard_') >= 0) {
                    try { oldParent.destroy(); } catch (e) { /* ignore */ }
                }
            } else {
                card.getTransform().setLocalPosition(vec3.zero());
                card.getTransform().setLocalScale(new vec3(cs, cs, cs));
            }
            this.cardStates[i] = this.STATE_IN_COLLECTION;
            card.enabled = false;
        }

        if (this.collectionRoot) this.collectionRoot.enabled = false;
        this.stopCollectionUpdateLoop();
        this.updateDeleteButtonVisibility();

        if (this.onShowDescription) this.onShowDescription(t('collection_closed'));
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(1.5);

        // Notify Connected Lens that carousel is now hidden
        if (this.onCarouselVisibilityChanged) {
            this.onCarouselVisibilityChanged(false, []);
        }
    }

    // =====================================================================
    // CONNECTED LENS — Simplified card data for network transit
    // =====================================================================

    /**
     * Extracts simplified card data from the saved collection for network transfer.
     * Omits base64 images and other heavy fields — remote cards display text/stats only.
     */
    getSimplifiedCardData(): SimplifiedCard[] {
        const result: SimplifiedCard[] = [];
        for (let i = 0; i < this.savedVehicles.length; i++) {
            const v = this.savedVehicles[i];
            if (!v) continue;
            result.push({
                brand: v.brand || '',
                brand_model: v.brand_model || '?',
                type: v.type || 'unknown',
                year: v.year || '?',
                rarity: v.rarity || 2,
                rarity_label: v.rarity_label || 'Common',
                serial: v.serial || '',
                top_speed: v.top_speed || 1,
                acceleration: v.acceleration || 1,
                braking: v.braking || 1,
                traction: v.traction || 1,
                comfort: v.comfort || 1,
                savedAt: v.savedAt || 0,
                dateScanned: v.dateScanned || '',
                cityScanned: v.cityScanned || '',
            });
        }
        return result;
    }

    /**
     * Reads a card image base64 from persistent storage by savedAt key.
     * Returns null if no image exists.
     */
    getCardImageBase64(savedAt: number): string | null {
        if (!savedAt) return null;
        try {
            const storageKey = this.IMAGE_KEY_PREFIX + savedAt.toString();
            const b64 = global.persistentStorageSystem.store.getString(storageKey);
            if (!b64 || b64.length === 0) return null;
            return b64;
        } catch (e) {
            return null;
        }
    }

    /**
     * Returns the savedAt timestamp for a card identified by its serial.
     * Returns 0 if not found.
     */
    getSavedAtForSerial(serial: string): number {
        for (let i = 0; i < this.savedVehicles.length; i++) {
            if (this.savedVehicles[i] && this.savedVehicles[i].serial === serial) {
                return this.savedVehicles[i].savedAt || 0;
            }
        }
        return 0;
    }

    /**
     * Adds a card received from another player (Connected Lens trade/give).
     * Creates a SavedVehicleData from the SimplifiedCard, saves it, and instantiates the card.
     */
    addReceivedCard(card: SimplifiedCard, imageB64?: string): void {
        // Check for duplicates by serial
        for (let i = 0; i < this.savedVehicles.length; i++) {
            if (this.savedVehicles[i] && this.savedVehicles[i].serial === card.serial) {
                print('CollectionManager: Duplicate card ' + card.serial + ' — skipping');
                if (this.onShowDescription) this.onShowDescription(t('card_duplicate'));
                return;
            }
        }

        const now = Date.now();

        // Build a SavedVehicleData from the SimplifiedCard
        const savedData: SavedVehicleData = {
            brand: card.brand || '',
            brand_model: card.brand_model,
            type: card.type,
            year: card.year,
            top_speed: card.top_speed,
            acceleration: card.acceleration,
            braking: card.braking,
            traction: card.traction,
            comfort: card.comfort,
            rarity: card.rarity,
            rarity_label: card.rarity_label,
            savedAt: now,
            imageGenerated: !!imageB64,
            serial: card.serial,
            dateScanned: card.dateScanned || formatScanDate(now),
            cityScanned: card.cityScanned || 'Traded',
        };

        this.savedVehicles.push(savedData);

        // Save the traded image to persistent storage if provided
        if (imageB64 && imageB64.length > 0) {
            try {
                const storageKey = this.IMAGE_KEY_PREFIX + now.toString();
                global.persistentStorageSystem.store.putString(storageKey, imageB64);
                print('CollectionManager: Saved traded card image — ' + imageB64.length + ' chars');
            } catch (e) {
                print('CollectionManager: Failed to save traded image: ' + e);
            }
        }

        // Instantiate the card prefab
        if (this.verticalCardPrefab) {
            try {
                this.ensureCollectionRoot();
                const parent = this.collectionRoot || this.cardCollectionContainer || null;
                const cardObj = this.verticalCardPrefab.instantiate(parent);
                if (cardObj) {
                    cardObj.enabled = false;
                    this.collectionCardObjects.push(cardObj);
                    this.cardStates.push(this.STATE_IN_COLLECTION);
                    this.cardImageReady.push(!!imageB64);
                    this.cardFrameHooked.push(false);
                    this.reviewButtonHooked.push(false);
                    this.populateCollectorCard(cardObj, savedData);

                    // If image was provided, decode and apply it
                    if (imageB64 && imageB64.length > 0) {
                        Base64.decodeTextureAsync(
                            imageB64,
                            (texture: Texture) => { this.applyCardImage(cardObj, texture); },
                            () => { print('CollectionManager: Failed to decode traded card image'); }
                        );
                    }
                }
            } catch (e) {
                print('CollectionManager: Error instantiating received card: ' + e);
            }
        }

        this.saveCollectionToStorage();
        print('CollectionManager: Added received card — ' + card.brand_model + ' (serial: ' + card.serial + ')'
            + (imageB64 ? ' with image' : ' without image'));
        if (this.onShowDescription) this.onShowDescription(tf('card_added', { name: card.brand_model }));
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(3.0);
    }

    /**
     * Removes a card from the collection by serial number (Connected Lens give-away).
     * Handles both the data array and the instantiated SceneObject.
     */
    removeCardBySerial(serial: string): void {
        let idx = -1;
        for (let i = 0; i < this.savedVehicles.length; i++) {
            if (this.savedVehicles[i] && this.savedVehicles[i].serial === serial) {
                idx = i;
                break;
            }
        }
        if (idx < 0 || idx >= this.savedVehicles.length) {
            print('CollectionManager: Card serial ' + serial + ' not found — cannot remove');
            return;
        }

        const name = this.savedVehicles[idx].brand_model || '?';

        // Cloud delete (fire-and-forget)
        if (this.onCloudDeleteVehicle) this.onCloudDeleteVehicle(serial);

        // Destroy the SceneObject
        if (idx < this.collectionCardObjects.length && this.collectionCardObjects[idx]) {
            try { this.collectionCardObjects[idx].destroy(); } catch (e) { /* ignore */ }
        }

        // Remove from parallel arrays
        this.savedVehicles.splice(idx, 1);
        this.collectionCardObjects.splice(idx, 1);
        this.cardStates.splice(idx, 1);
        this.cardImageReady.splice(idx, 1);
        this.cardFrameHooked.splice(idx, 1);
        this.reviewButtonHooked.splice(idx, 1);

        this.saveCollectionToStorage();
        this.updateCollectionButtonLabel();
        print('CollectionManager: Removed card — ' + name + ' (serial: ' + serial + ')');
        if (this.onShowDescription) this.onShowDescription(tf('card_given_away', { name: name }));
        if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(3.0);
    }

    // =====================================================================
    // TRADE HISTORY — Persistent log of all trades
    // =====================================================================

    /** Records a trade event and persists it. */
    addTradeRecord(entry: TradeHistoryEntry): void {
        this.tradeHistory.push(entry);
        this.saveTradeHistory();
        if (this.onCloudSyncTradeHistory) this.onCloudSyncTradeHistory(entry);
        print('CollectionManager: Trade logged — ' + entry.type + ' ' + entry.brand_model
            + (entry.partnerName ? ' with ' + entry.partnerName : ''));
    }

    /** Returns the full trade history (read-only). */
    getTradeHistory(): TradeHistoryEntry[] {
        return this.tradeHistory;
    }

    private saveTradeHistory(): void {
        try {
            const store = global.persistentStorageSystem.store;
            const json = JSON.stringify(this.tradeHistory);
            store.putString(this.TRADE_HISTORY_KEY, json);
        } catch (e) {
            print('CollectionManager: Error saving trade history: ' + e);
        }
    }

    private loadTradeHistory(): void {
        try {
            const store = global.persistentStorageSystem.store;
            const json = store.getString(this.TRADE_HISTORY_KEY);
            if (json && json.length > 2) {
                this.tradeHistory = JSON.parse(json) as TradeHistoryEntry[];
                print('CollectionManager: Loaded ' + this.tradeHistory.length + ' trade history entries');
            }
        } catch (e) {
            print('CollectionManager: Error loading trade history: ' + e);
            this.tradeHistory = [];
        }
    }

    // =====================================================================
    // CIRCULAR LAYOUT
    // =====================================================================

    private layoutCircularCards(): void {
        const n = this.collectionCardObjects.length;
        if (n === 0) return;

        const carouselRadius = this.cardInteraction ? this.cardInteraction.carouselRadius : 2.5;
        const cs = this.cardInteraction ? this.cardInteraction.collectionCardScale : 0.18;
        const carouselAngle = this.cardInteraction ? this.cardInteraction.carouselAngleOffset : 0;

        let inCollectionCount = 0;
        for (let i = 0; i < n; i++) {
            if ((this.cardStates[i] || this.STATE_IN_COLLECTION) === this.STATE_IN_COLLECTION) inCollectionCount++;
        }
        if (inCollectionCount === 0) return;

        const radius = Math.max(carouselRadius, inCollectionCount * 0.7);
        const angleStep = (2 * Math.PI) / inCollectionCount;
        let circleIdx = 0;

        for (let i = 0; i < n; i++) {
            const card = this.collectionCardObjects[i];
            if (!card) continue;
            if ((this.cardStates[i] || this.STATE_IN_COLLECTION) !== this.STATE_IN_COLLECTION) continue;

            const angle = circleIdx * angleStep + carouselAngle;
            circleIdx++;
            const transform = card.getTransform();
            transform.setLocalPosition(new vec3(radius * Math.cos(angle), 0, radius * Math.sin(angle)));
            transform.setLocalRotation(quat.fromEulerAngles(0, 0, 0));
            transform.setLocalScale(new vec3(cs, cs, cs));
        }
    }

    // =====================================================================
    // UPDATE LOOP
    // =====================================================================

    private startCollectionUpdateLoop(): void {
        this.stopCollectionUpdateLoop();
        if (this.cardInteraction) {
            this.cardInteraction.initialize(
                this.collectionCardObjects, this.savedVehicles,
                this.cardStates, this.cardFrameHooked, this.collectionRoot
            );
        }
        this.collectionUpdateEvent = this.createEvent('UpdateEvent');
        this.collectionUpdateEvent.bind(() => {
            if (!this.isCollectionOpen) return;
            if (this.cardInteraction) this.cardInteraction.updateFrame();
        });
    }

    private stopCollectionUpdateLoop(): void {
        if (this.collectionUpdateEvent) {
            try { this.collectionUpdateEvent.enabled = false; } catch (e) { /* ignore */ }
            this.collectionUpdateEvent = null;
        }
    }

    /** Syncs internal state arrays to CardInteraction after modifications. */
    private syncInteractionState(): void {
        if (this.cardInteraction) {
            this.cardInteraction.initialize(
                this.collectionCardObjects, this.savedVehicles,
                this.cardStates, this.cardFrameHooked, this.collectionRoot
            );
        }
    }

    // =====================================================================
    // COLLECTION ROOT
    // =====================================================================

    private ensureCollectionRoot(): void {
        if (this.collectionRoot) return;
        if (this.cardCollectionContainer) {
            this.collectionRoot = global.scene.createSceneObject('CollectionRoot');
            this.collectionRoot.setParent(this.cardCollectionContainer);
            this.collectionRoot.getTransform().setLocalPosition(vec3.zero());
            this.collectionRoot.getTransform().setLocalScale(new vec3(1, 1, 1));
            this.collectionRoot.enabled = false;
        } else {
            this.collectionRoot = global.scene.createSceneObject('CollectionRoot');
            this.collectionRoot.getTransform().setWorldScale(new vec3(1, 1, 1));
            this.collectionRoot.enabled = false;
        }
        if (this.cardInteraction) this.cardInteraction.setCollectionRoot(this.collectionRoot);
    }

    // =====================================================================
    // CARD INSTANTIATION & POPULATION
    // =====================================================================

    /**
     * Creates debug/test cards for preview testing.
     * Only works when the collection is empty.
     */
    createDebugCards(): void {
        if (this.collectionCardObjects.length > 0) {
            print('CollectionManager: Debug cards not needed — collection already has cards');
            return;
        }
        if (!this.verticalCardPrefab) {
            print('CollectionManager: No card prefab — cannot create debug cards');
            return;
        }

        const debugCars: SavedVehicleData[] = [
            { brand_model: 'Ferrari F40', type: 'Supercar', year: '1987', rarity: 5, rarity_label: 'Legendary', serial: 'DGNS-DBG1-0001-0001', top_speed: 5, acceleration: 5, braking: 4, traction: 4, comfort: 2, cityScanned: 'Maranello', dateScanned: 'Feb 15, 2026', imageGenerated: false, savedAt: Date.now() },
            { brand_model: 'BMW M3 E30', type: 'Sports', year: '1990', rarity: 4, rarity_label: 'Epic', serial: 'DGNS-DBG2-0002-0002', top_speed: 4, acceleration: 4, braking: 3, traction: 4, comfort: 3, cityScanned: 'Munich', dateScanned: 'Feb 15, 2026', imageGenerated: false, savedAt: Date.now() + 1 },
            { brand_model: 'Peugeot 205 GTI', type: 'Hot Hatch', year: '1984', rarity: 3, rarity_label: 'Rare', serial: 'DGNS-DBG3-0003-0003', top_speed: 3, acceleration: 3, braking: 3, traction: 3, comfort: 3, cityScanned: 'Paris', dateScanned: 'Feb 15, 2026', imageGenerated: false, savedAt: Date.now() + 2 },
        ];

        for (let i = 0; i < debugCars.length; i++) {
            const data = debugCars[i];
            const cardObj = this.instantiateCollectorCard(data);
            if (cardObj) {
                cardObj.enabled = false;
                this.savedVehicles.push(data);
                this.collectionCardObjects.push(cardObj);
                this.cardStates.push(this.STATE_IN_COLLECTION);
                this.cardImageReady.push(false);
                this.cardFrameHooked.push(false);
                this.reviewButtonHooked.push(false);
            }
        }

        print('CollectionManager: Created ' + this.collectionCardObjects.length + ' debug cards');
    }

    private instantiateCollectorCard(data: SavedVehicleData): SceneObject | null {
        if (!this.verticalCardPrefab) return null;
        this.ensureCollectionRoot();
        const parent = this.collectionRoot || this.cardCollectionContainer || null;
        try {
            const cardObj = this.verticalCardPrefab.instantiate(parent);
            this.populateCollectorCard(cardObj, data);
            return cardObj;
        } catch (error) {
            print('CollectionManager: Card instantiation error: ' + error);
            return null;
        }
    }

    private populateCollectorCard(cardObj: SceneObject, data: SavedVehicleData): void {
        const set = (childName: string, text: string) => {
            const obj = findChildByName(cardObj, childName);
            if (obj) {
                const tc = obj.getComponent('Component.Text') as Text;
                if (tc) {
                    tc.text = text;
                } else {
                    print('CollectionManager: [WARN] "' + childName + '" found but has no Text component');
                }
            } else {
                print('CollectionManager: [WARN] Child "' + childName + '" NOT FOUND in card');
            }
        };

        set('Car Brand and model', data.brand_model || 'Unknown');
        set('Car Type', formatCarType(data.type));
        set('Car Year', data.year || '');
        set('Card Serial', data.serial || '');

        print('CollectionManager: Setting Date Scanned = "' + (data.dateScanned || '') + '"');
        print('CollectionManager: Setting City Scanned = "' + (data.cityScanned || '') + '"');
        set('Date Scanned', data.dateScanned || '');
        set('City Scanned', data.cityScanned || '');

        // Rarity
        const rarityObj = findChildByName(cardObj, 'Car Rarity');
        if (rarityObj) {
            const tc = rarityObj.getComponent('Component.Text') as Text;
            if (tc) {
                const rarity = data.rarity || 2;
                tc.text = formatRarityText(rarity, data.rarity_label || getRarityLabel(rarity));
            }
        }

        // Stat bars
        this.updateStatBar(findChildByName(cardObj, 'Top Speed Bar'), data.top_speed);
        this.updateStatBar(findChildByName(cardObj, 'Acceleration Bar'), data.acceleration);
        this.updateStatBar(findChildByName(cardObj, 'Braking Bar'), data.braking);
        this.updateStatBar(findChildByName(cardObj, 'Traction Bar'), data.traction);
        this.updateStatBar(findChildByName(cardObj, 'Comfort Bar'), data.comfort);

        // Brand logo
        if (data.brand && this.brandLogoLoader) {
            const logoObj = findChildByName(cardObj, 'Car Brand Logo');
            if (logoObj) {
                const logoUrl = this.brandLogoLoader.getBrandLogoUrl(data.brand);
                if (logoUrl) this.brandLogoLoader.loadLogoOntoObject(logoObj, logoUrl);
            }
        }

        // Trust / Scanned-by info
        const trustObj = findChildByName(cardObj, 'Scanned by: Username, rank, trust score');
        if (trustObj) {
            const tc = trustObj.getComponent('Component.Text') as Text;
            if (tc) {
                if (this.onGetTrustDisplayString) {
                    tc.text = this.onGetTrustDisplayString();
                } else {
                    tc.text = t('scanned_by_unknown');
                }
                this.applyTrustColorToText(tc);
            }
        }
    }

    private applyTrustColorToText(textComp: Text): void {
        if (!this.onGetTrustDisplayString) return;
        try {
            const trustStr = this.onGetTrustDisplayString();
            const match = trustStr.match(/Trust:\s*(\d+)%/);
            if (match) {
                const score = parseInt(match[1], 10);
                const hex = getTrustColor(score);
                const r = parseInt(hex.substring(0, 2), 16) / 255;
                const g = parseInt(hex.substring(2, 4), 16) / 255;
                const b = parseInt(hex.substring(4, 6), 16) / 255;
                textComp.textFill.color = new vec4(r, g, b, 1);
            }
        } catch (e) { /* ignore */ }
    }

    private reapplyCardStatBars(cardObj: SceneObject, data: SavedVehicleData): void {
        this.updateStatBar(findChildByName(cardObj, 'Top Speed Bar'), data.top_speed);
        this.updateStatBar(findChildByName(cardObj, 'Acceleration Bar'), data.acceleration);
        this.updateStatBar(findChildByName(cardObj, 'Braking Bar'), data.braking);
        this.updateStatBar(findChildByName(cardObj, 'Traction Bar'), data.traction);
        this.updateStatBar(findChildByName(cardObj, 'Comfort Bar'), data.comfort);

        const rarityObj = findChildByName(cardObj, 'Car Rarity');
        if (rarityObj) {
            const tc = rarityObj.getComponent('Component.Text') as Text;
            if (tc) {
                const rarity = data.rarity || 2;
                tc.text = formatRarityText(rarity, data.rarity_label || getRarityLabel(rarity));
            }
        }
    }

    // =====================================================================
    // REVIEW BUTTON HOOKING — Deferred until collection is opened
    // =====================================================================

    /**
     * Hooks the "Review Button" on all collector cards that haven't been hooked yet.
     * Called from showCollection() AFTER cards are enabled, with a short delay
     * to let the RectangleButton ScriptComponent initialize.
     *
     * The RectangleButton needs the card to be enabled for several frames
     * before its onTriggerUp event becomes available.
     */
    private hookPendingReviewButtons(): void {
        let waitFrames = 0;
        const pollEvent = this.createEvent('UpdateEvent');
        pollEvent.bind(() => {
            waitFrames++;
            // Wait 10 frames for RectangleButton scripts to initialize
            if (waitFrames < 10) return;
            pollEvent.enabled = false;

            for (let i = 0; i < this.collectionCardObjects.length; i++) {
                if (this.reviewButtonHooked[i]) continue;
                const card = this.collectionCardObjects[i];
                if (!card || !card.enabled) continue;
                if (i >= this.savedVehicles.length) continue;

                this.tryHookReviewButton(card, i);
            }
        });
    }

    /**
     * Review must only be available once a card is actually out of the carousel.
     * This prevents accidental narrator triggers while trying to grab cards.
     */
    private canTriggerReview(cardIndex: number): boolean {
        const state = this.cardStates[cardIndex] || this.STATE_IN_COLLECTION;
        return state === this.STATE_PLACED_IN_WORLD;
    }

    /**
     * Attempts to connect the "Review Button" on a specific collector card.
     * Finds the button and the "Car Review" Text child, then wires the button
     * to trigger the onReviewVehicle callback with the card's vehicle data
     * and the card's own Text component for displaying the narration.
     */
    private tryHookReviewButton(cardObj: SceneObject, cardIndex: number): void {
        const reviewBtnObj = findChildByName(cardObj, 'Review Button');
        if (!reviewBtnObj) {
            print('CollectionManager: [REVIEW] "Review Button" not found in card #' + cardIndex);
            return;
        }

        // Find the "Car Review" Text component on the card (for narration display)
        const carReviewObj = findChildByName(cardObj, 'Car Review');
        let carReviewText: Text | null = null;
        if (carReviewObj) {
            carReviewText = carReviewObj.getComponent('Component.Text') as Text;
        }

        const data = this.savedVehicles[cardIndex];

        // Strategy 1: Try connectButton utility (checks multiple event types)
        if (this.onConnectButton) {
            const connected = this.onConnectButton(reviewBtnObj, () => {
                if (!this.canTriggerReview(cardIndex)) {
                    print('CollectionManager: [REVIEW] Ignored — card must be placed in world first');
                    return;
                }
                print('CollectionManager: [REVIEW] Review pressed for ' + (data.brand_model || '?'));
                if (this.onReviewGenerationStarted) this.onReviewGenerationStarted();
                if (this.onReviewVehicle) this.onReviewVehicle(data, carReviewText || undefined);
            }, 'CardReview_' + cardIndex);
            if (connected) {
                this.reviewButtonHooked[cardIndex] = true;
                print('CollectionManager: [REVIEW] Button connected for ' + (data.brand_model || '?'));
                return;
            }
        }

        // Strategy 2: Direct ScriptComponent event search on button + child
        const objectsToCheck = [reviewBtnObj];
        const childCount = reviewBtnObj.getChildrenCount();
        for (let c = 0; c < childCount; c++) {
            const child = reviewBtnObj.getChild(c);
            if (child) objectsToCheck.push(child);
        }

        for (let o = 0; o < objectsToCheck.length; o++) {
            const obj = objectsToCheck[o];
            const scripts = obj.getComponents('Component.ScriptComponent') as any[];
            for (let s = 0; s < scripts.length; s++) {
                const script = scripts[s];
                if (!script) continue;

                if (script.onTriggerUp && typeof script.onTriggerUp.add === 'function') {
                    script.onTriggerUp.add(() => {
                        if (!this.canTriggerReview(cardIndex)) {
                            print('CollectionManager: [REVIEW] Ignored (direct) — card must be placed in world first');
                            return;
                        }
                        print('CollectionManager: [REVIEW] Review pressed (direct) for ' + (data.brand_model || '?'));
                        if (this.onReviewGenerationStarted) this.onReviewGenerationStarted();
                        if (this.onReviewVehicle) this.onReviewVehicle(data, carReviewText || undefined);
                    });
                    this.reviewButtonHooked[cardIndex] = true;
                    print('CollectionManager: [REVIEW] Button connected (direct/onTriggerUp) for ' + (data.brand_model || '?'));
                    return;
                }
                if (script.onButtonPinched && typeof script.onButtonPinched.add === 'function') {
                    script.onButtonPinched.add(() => {
                        if (!this.canTriggerReview(cardIndex)) {
                            print('CollectionManager: [REVIEW] Ignored (pinch) — card must be placed in world first');
                            return;
                        }
                        print('CollectionManager: [REVIEW] Review pressed (pinch) for ' + (data.brand_model || '?'));
                        if (this.onReviewVehicle) this.onReviewVehicle(data, carReviewText || undefined);
                    });
                    this.reviewButtonHooked[cardIndex] = true;
                    print('CollectionManager: [REVIEW] Button connected (direct/onButtonPinched) for ' + (data.brand_model || '?'));
                    return;
                }
            }
        }

        print('CollectionManager: [REVIEW] Could not hook review button for card #' + cardIndex
            + ' (' + (data.brand_model || '?') + ') — will retry next collection open');
    }

    private updateStatBar(barObject: SceneObject | null, value: number): void {
        if (!barObject) return;
        const clampedValue = Math.max(0, Math.min(5, Math.round(value)));
        const childCount = barObject.getChildrenCount();
        let planeIndex = 0;
        for (let i = 0; i < childCount; i++) {
            const child = barObject.getChild(i);
            if (!child) continue;
            if (!child.getComponent('Component.RenderMeshVisual')) continue;
            child.enabled = (planeIndex < clampedValue);
            planeIndex++;
        }
    }

    // =====================================================================
    // CARD IMAGE — Apply, save to storage, load from storage
    // =====================================================================

    private applyCardImage(cardObj: SceneObject, texture: Texture): void {
        const cardImageObj = findChildByName(cardObj, 'Card Image');
        if (!cardImageObj) return;

        let applied = false;
        const imgComp = cardImageObj.getComponent('Component.Image') as Image;
        if (imgComp) {
            imgComp.mainMaterial = imgComp.mainMaterial.clone();
            imgComp.mainPass.baseTex = texture;
            cardImageObj.enabled = true;
            applied = true;
        }
        if (!applied) {
            const meshComp = cardImageObj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
            if (meshComp) {
                meshComp.mainMaterial = meshComp.mainMaterial.clone();
                meshComp.mainPass.baseTex = texture;
                cardImageObj.enabled = true;
                applied = true;
            }
        }
        if (applied) {
            const idx = this.collectionCardObjects.indexOf(cardObj);
            if (idx >= 0) this.cardImageReady[idx] = true;
        }
    }

    private saveCardImageToStorage(vehicleName: string, savedAt: number, texture: Texture, serial?: string): void {
        try {
            const storageKey = this.IMAGE_KEY_PREFIX + savedAt.toString();
            Base64.encodeTextureAsync(
                texture,
                (b64: string) => {
                    try { global.persistentStorageSystem.store.putString(storageKey, b64); } catch (e) { /* ignore */ }
                    // Cloud upload (fire-and-forget)
                    if (serial && this.onCloudUploadImage) {
                        this.onCloudUploadImage(serial, b64);
                    }
                },
                () => { /* encode failed */ },
                CompressionQuality.LowQuality,
                EncodingType.Jpg
            );
        } catch (e) { /* ignore */ }
    }

    private loadCardImageFromStorage(vehicleName: string, savedAt: number, cardObj: SceneObject): boolean {
        try {
            const storageKey = this.IMAGE_KEY_PREFIX + savedAt.toString();
            const b64 = global.persistentStorageSystem.store.getString(storageKey);
            if (!b64 || b64.length === 0) return false;

            Base64.decodeTextureAsync(
                b64,
                (texture: Texture) => { this.applyCardImage(cardObj, texture); },
                () => { /* decode failed */ }
            );
            return true;
        } catch (e) { return false; }
    }

    // =====================================================================
    // BACKGROUND VARIETY — Professional automotive photography scenes
    // =====================================================================

    private readonly PHOTO_BACKGROUNDS: string[] = [
        'A sun-drenched Mediterranean coastal road winding along turquoise cliffs, golden hour light, professional automotive photography.',
        'A winding mountain pass at dawn, low mist rolling across the asphalt, dramatic peaks in the background, editorial car shoot style.',
        'A rain-slicked city street at twilight, neon reflections on wet asphalt, moody urban automotive photography.',
        'An endless straight road through golden wheat fields under dramatic skies, classic car magazine centerfold composition.',
        'A snowy Alpine village at dusk, warm lights from chalets, fresh powder on the road, luxury car brochure aesthetic.',
        'A tropical coastal road at sunset, palm trees silhouetted against warm orange sky, premium car catalog photography.',
        'An elegant tree-lined boulevard in autumn, golden leaves on the pavement, soft bokeh, high-end automotive press photo.',
        'A vast desert highway cutting through red rock canyon formations, deep blue sky, adventure car magazine style.',
        'A charming countryside lane in spring, wildflowers along the road, stone bridge in the background, classic motoring magazine shot.',
        'An underground parking garage with dramatic directional lighting, concrete pillars, cinematic automotive ad style.',
        'A coastal cliff road at sunset, ocean waves crashing below, warm side lighting, professional car review photoshoot.',
        'A steep city street with colorful Victorian houses, morning fog, editorial urban car photography.',
        'A rain-soaked European cobblestone street at night, warm street lamps reflecting in puddles, moody car ad aesthetic.',
        'A colorful colonial street in warm Caribbean light, long afternoon shadows, vibrant lifestyle car photography.',
        'A fjord-side road in summer, crystal-clear water reflecting mountains, pristine nature, Scandinavian car ad style.',
        'A desert oasis at golden hour, sand dunes glowing amber in the background, exotic automotive photoshoot.',
        'A tree-lined avenue in full spring bloom, petals drifting in the breeze, soft diffused light, luxury car brochure.',
        'A dramatic stormy sky over an open plain, the road ahead lit by a golden break in the clouds, cinematic car photography.',
        'A peaceful lakeside town at dawn, still water reflecting the sky, elegant automotive press release photo.',
        'A modern city skyline at blue hour, glass towers reflecting twilight, an elevated highway, futuristic car ad composition.',
        'An oceanfront promenade at sunset, pastel-colored buildings, warm pink sky, lifestyle car magazine editorial.',
        'A highland road through heather-covered moors, dramatic moody sky with sun patches, rugged car brochure aesthetic.',
        'A bamboo-lined forest road, tall green canopy, dappled sunlight, serene Japanese automotive photography.',
        'A classic roadside gas station in the American desert, vintage feel, endless highway, retro car magazine editorial.',
        'A frozen Nordic landscape at twilight, aurora borealis in the sky, snow-covered pines, premium winter car ad.',
    ];

    private pickRandomBackground(): string {
        const idx = Math.floor(Math.random() * this.PHOTO_BACKGROUNDS.length);
        return this.PHOTO_BACKGROUNDS[idx];
    }

    // =====================================================================
    // IMAGE GENERATION (gpt-image-1 Image Edit with real photo)
    // =====================================================================

    /**
     * Generates the collector card image using OpenAI Image Edit (gpt-image-1).
     *
     * Sends the REAL photo captured by the Spectacles camera (compressed version).
     * The model keeps the actual vehicle and replaces ONLY the background
     * with a professional automotive photography scene.
     *
     * Retry strategy:
     *   - 5 attempts: gpt-image-1 (x3) then dall-e-2 fallback (x2)
     *   - Increasing delay between attempts (2s, 3s, 4s, 5s)
     */
    private async generateVehicleCardImage(data: SavedVehicleData): Promise<Texture> {
        if (!this.lastCapturedBase64 || this.lastCapturedBase64.length === 0) {
            print('CollectionManager: [IMG-EDIT] No captured photo available — cannot create card');
            if (this.onShowDescription) this.onShowDescription(t('no_captured_photo'));
            if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(5.0);
            throw new Error('No captured photo available');
        }

        print('CollectionManager: [IMG-EDIT] START — base64 length = ' + this.lastCapturedBase64.length
            + ' (~' + Math.round((this.lastCapturedBase64.length * 0.75) / 1024) + ' KB)');

        const bgScene = this.pickRandomBackground();
        const editPrompt = 'Keep the vehicle in the foreground exactly as it appears in the photo — '
            + 'preserve body shape, paint, scratches, dents, dirt, and all non-plate details faithfully. '
            + 'Replace ONLY the background with a professional automotive photography scene: '
            + bgScene + ' '
            + 'Sharp focus on the car, cinematic depth of field on the background, natural lighting, magazine quality. '
            + 'MANDATORY LICENSE PLATE SAFETY: Do not reproduce any real license plate text. '
            + 'Replace all visible license plates with generic white plates. '
            + 'The main vehicle plate must read exactly "DGNS" in a bold geometric sans-serif style similar to Futura Bold, centered and legible. '
            + 'No other plate characters or numbers may remain anywhere in the image.';
        let imageBytes: Uint8Array;
        try {
            imageBytes = Base64.decode(this.lastCapturedBase64);
            print('CollectionManager: [IMG-EDIT] Base64.decode OK — '
                + imageBytes.length + ' bytes (' + Math.round(imageBytes.length / 1024) + ' KB)');
        } catch (decodeErr) {
            print('CollectionManager: [IMG-EDIT] ERROR Base64.decode failed: ' + decodeErr);
            throw new Error('Base64 decode failed: ' + String(decodeErr).substring(0, 100));
        }

        const attempts: Array<{ model: string; size: string }> = [
            { model: 'gpt-image-1', size: '1024x1024' },
            { model: 'gpt-image-1', size: '1024x1024' },
            { model: 'gpt-image-1', size: '1536x1024' },
            { model: 'gpt-image-1', size: '1024x1024' },
            { model: 'gpt-image-1', size: '1024x1024' },
        ];

        let response: any;
        let lastError = '';

        for (let i = 0; i < attempts.length; i++) {
            const { model, size } = attempts[i];
            const attempt = i + 1;

            try {
                print('CollectionManager: [IMG-EDIT] Attempt ' + attempt + '/' + attempts.length
                    + ' — model=' + model + ', size=' + size + ', input=' + Math.round(imageBytes.length / 1024) + 'KB');

                const statusCb = this.onShowCardStatus || this.onShowAnimatedDescription || this.onShowDescription;
                if (statusCb) {
                    statusCb(tf('generating_card_n', { n: attempt, total: attempts.length }) + '...');
                }

                response = await OpenAI.imagesEdit({
                    image: imageBytes,
                    prompt: editPrompt,
                    model: model,
                    n: 1,
                    size: size,
                });

                print('CollectionManager: [IMG-EDIT] Attempt ' + attempt + ' SUCCESS (model=' + model
                    + ') — data count = ' + (response?.data?.length || 0));

                return this.extractTextureFromResponse(response);

            } catch (err) {
                // Capture as much detail as possible from the error
                let errDetail = '';
                if (typeof err === 'string') {
                    errDetail = err.length > 0 ? err : '(empty string error)';
                } else if (err && typeof err === 'object') {
                    errDetail = (err as any).message || (err as any).error || JSON.stringify(err);
                    if (!errDetail || errDetail === '{}') errDetail = '(empty object error — proxy likely rejected payload)';
                } else {
                    errDetail = String(err) || '(unknown error)';
                }
                lastError = errDetail;

                print('CollectionManager: [IMG-EDIT] Attempt ' + attempt + '/' + attempts.length
                    + ' FAILED (model=' + model + '): ' + errDetail.substring(0, 400));

                if (i < attempts.length - 1) {
                    const delaySec = 2 + i;
                    print('CollectionManager: [IMG-EDIT] Waiting ' + delaySec + 's before retry...');
                    await this.delay(delaySec);
                }
            }
        }

        print('CollectionManager: [IMG-EDIT] ALL ' + attempts.length + ' ATTEMPTS FAILED — ' + lastError.substring(0, 400));
        throw new Error('Image edit failed after ' + attempts.length + ' attempts: ' + lastError.substring(0, 200));
    }

    /**
     * Extracts the generated texture from an OpenAI Image Edit response.
     */
    private async extractTextureFromResponse(response: any): Promise<Texture> {
        if (!response?.data?.length) {
            throw new Error('Image Edit returned empty response');
        }

        const imageData = response.data[0];
        print('CollectionManager: [IMG-EDIT] Response keys: ' + Object.keys(imageData).join(', '));

        if (imageData.b64_json) {
            print('CollectionManager: [IMG-EDIT] Got b64_json — length = ' + imageData.b64_json.length);
            return new Promise<Texture>((resolve, reject) => {
                Base64.decodeTextureAsync(
                    imageData.b64_json,
                    (tex: Texture) => {
                        print('CollectionManager: [IMG-EDIT] SUCCESS — texture decoded');
                        resolve(tex);
                    },
                    () => {
                        print('CollectionManager: [IMG-EDIT] ERROR decodeTextureAsync failed');
                        reject(new Error('Image Edit texture decode failed'));
                    }
                );
            });
        } else if (imageData.url) {
            print('CollectionManager: [IMG-EDIT] Got URL, downloading: ' + imageData.url.substring(0, 80) + '...');
            return this.downloadImageAsTexture(imageData.url);
        }

        throw new Error('Image Edit: no b64_json nor url in response');
    }

    /**
     * Promise-based delay for retry spacing.
     */
    private delay(seconds: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const ev = this.createEvent('DelayedCallbackEvent');
            ev.bind(() => resolve());
            ev.reset(seconds);
        });
    }

    /**
     * Queues an image generation request. Returns a Promise that resolves when
     * this item reaches the front of the queue and completes.
     */
    private readonly MAX_IMAGE_QUEUE: number = 5;

    private queueImageGeneration(data: SavedVehicleData): Promise<Texture> {
        if (this._imageQueue.length >= this.MAX_IMAGE_QUEUE) {
            print('CollectionManager: [QUEUE] Image queue full (' + this.MAX_IMAGE_QUEUE + ') — rejecting');
            if (this.onShowDescription) this.onShowDescription(t('image_gen_busy'));
            return Promise.reject(new Error('Image queue full'));
        }
        const capturedBase64 = this.lastCapturedBase64;
        return new Promise<Texture>((resolve, reject) => {
            this._imageQueue.push({ data, capturedBase64, resolve, reject });
            print('CollectionManager: [QUEUE] Added to image queue — depth=' + this._imageQueue.length);
            this.processImageQueue();
        });
    }

    private async processImageQueue(): Promise<void> {
        if (this._imageQueueProcessing || this._imageQueue.length === 0) return;
        this._imageQueueProcessing = true;

        while (this._imageQueue.length > 0) {
            const item = this._imageQueue.shift()!;
            print('CollectionManager: [QUEUE] Processing — ' + item.data.brand_model
                + ' (remaining=' + this._imageQueue.length + ')');
            const prevBase64 = this.lastCapturedBase64;
            this.lastCapturedBase64 = item.capturedBase64;
            try {
                const tex = await this.generateVehicleCardImage(item.data);
                item.resolve(tex);
            } catch (e) {
                item.reject(e);
            }
            this.lastCapturedBase64 = prevBase64;
        }

        this._imageQueueProcessing = false;
    }

    private async downloadImageAsTexture(url: string): Promise<Texture> {
        return new Promise<Texture>((resolve, reject) => {
            if (!this.internetModule) { reject(new Error('No InternetModule')); return; }
            const request = RemoteServiceHttpRequest.create();
            request.url = url;
            request.setHeader('User-Agent', this.HTTP_USER_AGENT);
            this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
                if (response.statusCode < 200 || response.statusCode >= 400) { reject(new Error('HTTP ' + response.statusCode)); return; }
                try {
                    const resource = response.asResource();
                    if (!resource || !this.remoteMediaModule) { reject(new Error('No resource')); return; }
                    this.remoteMediaModule.loadResourceAsImageTexture(resource,
                        (tex: Texture) => resolve(tex),
                        (err: string) => reject(new Error(err))
                    );
                } catch (e) { reject(e); }
            });
        });
    }

    // =====================================================================
    // PERSISTENT STORAGE
    // =====================================================================

    private saveCollectionToStorage(): void {
        try {
            const store = global.persistentStorageSystem.store;
            const serializable = this.savedVehicles.map(v => ({
                brand: v.brand || '', brand_model: v.brand_model, type: v.type,
                year: v.year || '', top_speed: v.top_speed, acceleration: v.acceleration,
                braking: v.braking, traction: v.traction, comfort: v.comfort,
                rarity: v.rarity || 2, rarity_label: v.rarity_label || getRarityLabel(v.rarity || 2),
                scene: v.scene || '',
                savedAt: v.savedAt, imageGenerated: v.imageGenerated || false,
                serial: v.serial || '',
                dateScanned: v.dateScanned || '',
                cityScanned: v.cityScanned || '',
            }));
            store.putString(this.STORAGE_KEY, JSON.stringify(serializable));
            print('CollectionManager: Saved ' + serializable.length + ' vehicles');
        } catch (e) {
            print('CollectionManager: Save error: ' + e);
        }
    }

    private loadCollectionFromStorage(): void {
        try {
            const jsonString = global.persistentStorageSystem.store.getString(this.STORAGE_KEY);
            if (!jsonString || jsonString.length === 0) return;

            const parsed = JSON.parse(jsonString) as SavedVehicleData[];
            if (!Array.isArray(parsed) || parsed.length === 0) return;

            this.savedVehicles = parsed;

            // Retroactive field generation for cards saved before serial/date/city system
            let needsResave = false;
            for (let i = 0; i < this.savedVehicles.length; i++) {
                const v = this.savedVehicles[i];
                if (!v.serial || v.serial.length === 0) {
                    v.serial = generateSerial();
                    needsResave = true;
                    print('CollectionManager: Retroactive serial for ' + v.brand_model + ': ' + v.serial);
                }
                if (!v.dateScanned || v.dateScanned.length === 0) {
                    // Derive date from savedAt timestamp
                    v.dateScanned = v.savedAt ? formatScanDate(v.savedAt) : '';
                    needsResave = true;
                }
                if (v.cityScanned === undefined || v.cityScanned === null) {
                    v.cityScanned = '';
                    needsResave = true;
                }
            }
            if (needsResave) this.saveCollectionToStorage();

            this.ensureCollectionRoot();

            for (let i = 0; i < this.savedVehicles.length; i++) {
                const vehicleData = this.savedVehicles[i];
                const cardObj = this.instantiateCollectorCard(vehicleData);
                if (cardObj) {
                    this.collectionCardObjects.push(cardObj);
                    this.cardStates.push(this.STATE_IN_COLLECTION);
                    this.cardImageReady.push(false);
                    this.cardFrameHooked.push(false);
                    this.reviewButtonHooked.push(false);
                    cardObj.enabled = false;

                    if (this.cardInteraction) {
                        this.cardInteraction.hookCardFrameEvents(cardObj, this.collectionCardObjects.length - 1);
                    }
                    if (vehicleData.imageGenerated && vehicleData.brand_model && vehicleData.savedAt) {
                        this.loadCardImageFromStorage(vehicleData.brand_model, vehicleData.savedAt, cardObj);
                    }
                }
            }
            print('CollectionManager: Loaded ' + this.collectionCardObjects.length + ' cards from storage');
            this.updateCollectionButtonLabel();

            // Cloud sync full collection (fire-and-forget, delayed to let auth complete)
            if (this.onCloudSyncFullCollection && this.savedVehicles.length > 0) {
                const vehiclesToSync = this.savedVehicles.slice();
                const delayEvent = this.createEvent('DelayedCallbackEvent') as any;
                delayEvent.bind(() => {
                    if (this.onCloudSyncFullCollection) this.onCloudSyncFullCollection(vehiclesToSync);
                });
                delayEvent.reset(5.0);
            }
        } catch (e) {
            print('CollectionManager: Load error: ' + e);
        }
    }

    /** Returns the saved vehicles array (for cloud sync). */
    getSavedVehicles(): SavedVehicleData[] {
        return this.savedVehicles;
    }

    // =====================================================================
    // REVEAL ANIMATION
    // =====================================================================

    private getOrCreateRevealParent(): SceneObject {
        if (!this.revealParent) {
            this.revealParent = global.scene.createSceneObject('RevealParent');
        }
        return this.revealParent;
    }

    private playCardRevealAnimation(cardObj: SceneObject, vehicleName: string, onComplete: () => void): void {
        this.isRevealAnimating = true;
        if (this.revealAnimEvent) {
            try { this.revealAnimEvent.enabled = false; } catch (e) { /* ignore */ }
            this.revealAnimEvent = null;
        }

        const cardTransform = cardObj.getTransform();
        let revealWorldPos = new vec3(0, 0, -55);
        let revealWorldRot = quat.fromEulerAngles(0, Math.PI, 0);

        const headData = this.getUserHeadTransform();
        if (headData) {
            revealWorldPos = headData.position.add(headData.forward.uniformScale(55));
            revealWorldPos.y -= 3;
            revealWorldRot = headData.rotation;
        }

        const targetScale = 0.7;
        cardTransform.setWorldPosition(revealWorldPos);
        cardTransform.setWorldRotation(revealWorldRot);
        cardTransform.setWorldScale(new vec3(0.001, 0.001, 0.001));
        cardObj.enabled = true;

        const PHASE1_DUR = 0.6;
        const PHASE2_DUR = 3.5;
        const baseRot = revealWorldRot;

        let phase: string = 'scale_in';
        let phaseStartTime = getTime();
        let isGrabbed = false;
        let frameHooked = false;
        // Gate flag: once reveal finishes, these callbacks become inert
        let revealActive = true;

        if (this.onShowDescription) this.onShowDescription(tf('card_sparkle', { name: vehicleName }));

        const hookFrameForReveal = (): void => {
            if (frameHooked) return;
            try {
                const scripts = cardObj.getComponents('Component.ScriptComponent') as any[];
                for (let si = 0; si < scripts.length; si++) {
                    const script = scripts[si];
                    if (!script) continue;
                    if (script.onTranslationStart && typeof script.onTranslationStart.add === 'function'
                        && script.onTranslationEnd && typeof script.onTranslationEnd.add === 'function') {

                        script.onTranslationStart.add(() => {
                            if (!revealActive) return;
                            if (phase === 'wobble' || phase === 'scale_in') {
                                isGrabbed = true;
                                phase = 'held';
                                print('CollectionManager: [REVEAL] Card grabbed by user');
                                if (this.onShowDescription) this.onShowDescription(tf('release_to_collect', { name: vehicleName }));
                            }
                        });

                        script.onTranslationEnd.add(() => {
                            if (!revealActive) return;
                            if (phase === 'held' && isGrabbed) {
                                isGrabbed = false;
                                revealActive = false;
                                this.startFlyToCollection(cardObj, cardTransform, onComplete);
                            }
                        });

                        frameHooked = true;
                        print('CollectionManager: [REVEAL] Frame events hooked for grab detection');
                        return;
                    }
                }
            } catch (e) { /* not ready yet */ }
        };

        this.revealAnimEvent = this.createEvent('UpdateEvent');
        this.revealAnimEvent.bind(() => {
            const elapsed = getTime() - phaseStartTime;

            if (!frameHooked) hookFrameForReveal();

            if (phase === 'scale_in') {
                if (elapsed < PHASE1_DUR) {
                    const t = elapsed / PHASE1_DUR;
                    const eased = 1.0 - Math.pow(1.0 - t, 3.0);
                    const s = eased * targetScale;
                    cardTransform.setWorldScale(new vec3(s, s, s));
                    cardTransform.setWorldPosition(revealWorldPos);
                    cardTransform.setWorldRotation(baseRot);
                } else {
                    phase = 'wobble';
                    phaseStartTime = getTime();
                    cardTransform.setWorldScale(new vec3(targetScale, targetScale, targetScale));
                }
            } else if (phase === 'wobble') {
                if (elapsed < PHASE2_DUR) {
                    const wobbleRad = Math.sin((elapsed / PHASE2_DUR) * Math.PI * 3.0) * 25.0 * (Math.PI / 180.0);
                    cardTransform.setWorldScale(new vec3(targetScale, targetScale, targetScale));
                    cardTransform.setWorldPosition(revealWorldPos);
                    cardTransform.setWorldRotation(baseRot.multiply(quat.fromEulerAngles(0, wobbleRad, 0)));
                } else {
                    revealActive = false;
                    this.startFlyToCollection(cardObj, cardTransform, onComplete);
                }
            } else if (phase === 'held') {
                // Frame.ts handles positioning — waiting for onTranslationEnd
            }
        });
    }

    private startFlyToCollection(
        cardObj: SceneObject,
        cardTransform: Transform,
        onComplete: () => void
    ): void {
        if (this.revealAnimEvent) {
            try { this.revealAnimEvent.enabled = false; } catch (e) { /* ignore */ }
            this.revealAnimEvent = null;
        }

        this.ensureCollectionRoot();
        let targetPos = vec3.zero();
        let targetRot = quat.quatIdentity();
        if (this.collectionRoot) {
            targetPos = this.collectionRoot.getTransform().getWorldPosition();
            targetRot = this.collectionRoot.getTransform().getWorldRotation();
        } else if (this.cardCollectionContainer) {
            targetPos = this.cardCollectionContainer.getTransform().getWorldPosition();
            targetRot = this.cardCollectionContainer.getTransform().getWorldRotation();
        }

        const startPos = cardTransform.getWorldPosition();
        const startRot = cardTransform.getWorldRotation();
        const startScale = cardTransform.getWorldScale().x;
        const endScale = this.cardInteraction ? this.cardInteraction.collectionCardScale : 0.18;

        const FLY_DUR = 0.8;
        const flyStartTime = getTime();

        if (this.onShowDescription) this.onShowDescription(t('card_collected'));
        if (this.onCardFlyToInventory) this.onCardFlyToInventory();

        this.revealAnimEvent = this.createEvent('UpdateEvent');
        this.revealAnimEvent.bind(() => {
            const elapsed = getTime() - flyStartTime;
            const t = Math.min(elapsed / FLY_DUR, 1.0);
            const eased = 1.0 - Math.pow(1.0 - t, 3.0);

            const pos = vec3.lerp(startPos, targetPos, eased);
            const rot = quat.slerp(startRot, targetRot, eased);
            const s = startScale + (endScale - startScale) * eased;

            cardTransform.setWorldPosition(pos);
            cardTransform.setWorldRotation(rot);
            cardTransform.setWorldScale(new vec3(s, s, s));

            if (t >= 1.0) {
                cardObj.enabled = false;
                this.isRevealAnimating = false;
                if (this.revealAnimEvent) {
                    try { this.revealAnimEvent.enabled = false; } catch (e) { /* ignore */ }
                    this.revealAnimEvent = null;
                }
                if (this.onHideDescriptionAfterDelay) this.onHideDescriptionAfterDelay(2.0);
                onComplete();
            }
        });
    }
}
