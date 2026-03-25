/**
 * CarScanner.ts — Orchestrator for DGNS Vehicle Scanner
 *
 * Lightweight entry point that wires all specialized modules together.
 * Does NOT contain business logic — delegates to:
 *   - VehicleScanner: image capture + OpenAI vehicle identification
 *   - VehicleCardUI: results display, stat bars, close button
 *   - VehicleNarrator: description + TTS + text scroll
 *   - BrandLogoLoader: brand logo loading from the internet
 *   - CollectionManager: save/load/delete cards, carousel, persistence
 *   - CardInteraction: hand tracking, grab/release, carousel auto-rotation
 *   - XPManager: XP, levels, prestige, daily streak, user card
 *   - WelcomeManager: welcome screen, mode selection (Solo / Connected Lens)
 *   - ConnectedLensManager: multiplayer session, remote players, carousel sync
 *
 * Each module is a @component attached to a SceneObject in the scene.
 * Connect them in the Inspector via @input references.
 *
 * @author DGNS
 * @license MIT
 */

import { VehicleData, SavedVehicleData, UserProfile, TradeHistoryEntry } from './VehicleTypes';
import { VehicleScanner } from './VehicleScanner';
import { VehicleCardUI } from './VehicleCardUI';
import { VehicleNarrator } from './VehicleNarrator';
import { BrandLogoLoader } from './BrandLogoLoader';
import { CollectionManager } from './CollectionManager';
import { CardInteraction } from './CardInteraction';
import { XPManager } from './XPManager';
import { WelcomeManager } from './WelcomeManager';
import { ConnectedLensManager } from './ConnectedLensManager';
import { CloudManager } from './CloudManager';
import { AnalyticsManager } from './AnalyticsManager';
import { MusicPlayer } from './MusicPlayer';
import { t, tf, getCheatMessages, getIdlePhrases, Lang } from './Localization';

// Declare coarse location permission (required by Spectacles for city-level location)
require('LensStudio:ProcessedLocationModule');

@component
export class CarScanner extends BaseScriptComponent {

    // =====================================================================
    // INPUTS — Module references (assign in Inspector)
    // =====================================================================
    @input
    @hint('VehicleScanner script — handles image capture + OpenAI analysis')
    vehicleScanner: VehicleScanner;

    @input
    @hint('VehicleCardUI script — handles Vehicle Card display + close button')
    vehicleCardUI: VehicleCardUI;

    @input
    @hint('VehicleNarrator script — handles description + TTS + text scroll')
    vehicleNarrator: VehicleNarrator;

    @input
    @hint('BrandLogoLoader script — handles brand logo loading')
    brandLogoLoader: BrandLogoLoader;

    @input
    @hint('CollectionManager script — handles save/load/delete, carousel, persistence')
    collectionManager: CollectionManager;

    @input
    @hint('CardInteraction script — handles hand tracking, grab/release, carousel auto-rotation')
    cardInteraction: CardInteraction;

    @input
    @allowUndefined
    @hint('XPManager script — handles XP, levels, prestige, daily streak, user card')
    xpManager: XPManager;

    @input
    @allowUndefined
    @hint('WelcomeManager script — handles welcome screen, mode selection')
    welcomeManager: WelcomeManager;

    @input
    @allowUndefined
    @hint('ConnectedLensManager script — handles multiplayer session, remote players, carousel sync')
    connectedLensManager: ConnectedLensManager;

    @input
    @allowUndefined
    @hint('CloudManager script — handles Snap Cloud / Supabase integration (auth, sync, leaderboard, async trades)')
    cloudManager: CloudManager;

    @input
    @allowUndefined
    @hint('AnalyticsManager script — lightweight session metrics, timing, and error tracking')
    analyticsManager: AnalyticsManager;

    @input
    @allowUndefined
    @hint('MusicPlayer script — background music ducking while narrator speaks')
    musicPlayer: MusicPlayer;

    // =====================================================================
    // INPUTS — Scene elements managed by orchestrator
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Scan Vehicle" button SceneObject (with RectangleButton)')
    scanButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Car Scan Interface" root SceneObject — hidden until Solo mode starts')
    carScanInterface: SceneObject;

    @input
    @allowUndefined
    @hint('"Scanner Button" on the left hand — reopens Car Scan Interface if closed via (x)')
    scannerButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Open Collection Debug" button under Camera — opens carousel in front of camera for preview testing')
    openCollectionDebugButton: SceneObject;

    // =====================================================================
    // INPUTS — SFX (assign in Inspector)
    // =====================================================================
    @input
    @allowUndefined
    @hint('Shared SFX AudioComponent used to play one-shot UI/game sounds')
    sfxAudio: AudioComponent;

    @input
    @allowUndefined
    @hint('SFX: scan waiting (between button press and vehicle card results)')
    sfxScanWaiting: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: vehicle card displayed')
    sfxVehicleCardShown: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: card generation waiting')
    sfxCardGenerationWaiting: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: card generation success')
    sfxCardGenerationSuccess: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: generated card flies back to inventory')
    sfxCardFlyToInventory: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: card generation failed')
    sfxCardGenerationFailed: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: review audio/text generation waiting')
    sfxReviewGenerationWaiting: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: cheat attempt detected')
    sfxCheatDetected: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: cheat reprimand message')
    sfxCheatReprimand: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: XP+/Trust+ (same sound)')
    sfxPositiveProgress: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: XP-/Trust- (same sound)')
    sfxNegativeProgress: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: profile shared successfully')
    sfxShareProfileSuccess: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: profile share failed / cloud not connected')
    sfxShareProfileFailed: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('SFX: level up')
    sfxLevelUp: AudioTrackAsset;

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private scanInterfaceCloseButtonConnected: boolean = false;
    private scannerButtonTextComp: Text | null = null;
    private isScanInProgress: boolean = false;
    private sfxMuted: boolean = false;
    private activeSfxState: 'none' | 'scan_wait' | 'card_wait' | 'review_wait' | 'oneshot' = 'none';
    private activeSfxTrack: AudioTrackAsset | null = null;
    private oneShotQueue: AudioTrackAsset[] = [];
    private suppressNextNegativeProgressSfx: boolean = false;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        print('CarScanner: Initializing orchestrator...');

        this.createEvent('OnStartEvent').bind(() => {
            this.wireModules();
            this.setupScanButton();
            this.setupScannerButton();
            this.setupOpenCollectionDebugButton();
            this.setupScanInterfaceCloseButton();

            // Hide all hand buttons until the game actually starts
            this.setHandButtonsEnabled(false);

            // Check if launched via "Active Nearby" — skip menus and go directly to multiplayer
            let startedAsMultiplayer = false;
            try {
                startedAsMultiplayer = (global as any).launchParams && (global as any).launchParams.getBool('StartMultiplayer');
            } catch (e) { /* launchParams not available */ }

            if (startedAsMultiplayer && this.connectedLensManager) {
                print('CarScanner: Launched via Active Nearby — starting multiplayer directly');
                this.hideScanInterface();
                if (this.welcomeManager) this.welcomeManager.hide();
                if (!this.isInternetAvailable()) {
                    print('CarScanner: No internet — falling back to language selection');
                    if (this.welcomeManager) this.welcomeManager.show();
                } else {
                    this.connectedLensManager.startSession();
                }
            } else if (this.welcomeManager) {
                this.welcomeManager.show();
                this.hideScanInterface();
                print('CarScanner: Showing Language selection screen');
            } else {
                this.showScanInterface();
            }

            print('CarScanner: All modules wired and ready');
        });
    }

    // =====================================================================
    // MODULE WIRING — Connect callbacks between modules
    // =====================================================================

    /**
     * Connects all inter-module callbacks so modules can communicate
     * without direct references to each other.
     */
    private wireModules(): void {

        // --- VehicleCardUI callbacks ---
        if (this.vehicleCardUI) {
            this.vehicleCardUI.onCardClosed = () => {
                print('CarScanner: Vehicle Card closed');
                if (this.vehicleNarrator) this.vehicleNarrator.hideDescription();
                this.showScanInterface();
            };
            this.vehicleCardUI.onScanStarted = () => {
                if (this.vehicleNarrator) this.vehicleNarrator.startScanningMode();
            };
            this.vehicleCardUI.onScanEnded = () => {
                // Scanning finished — idle mode will restart when scan interface re-appears
            };
            this.vehicleCardUI.onShowError = (message: string) => {
                if (this.vehicleNarrator) this.vehicleNarrator.showStatusError(message);
            };
        }
        if (this.vehicleNarrator) {
            this.vehicleNarrator.onMuteStateChanged = (muted: boolean) => {
                this.setSfxMuted(muted);
            };
            this.vehicleNarrator.onReviewGenerationStarted = () => {
                this.startWaitingSfx(this.sfxReviewGenerationWaiting, 'review_wait');
            };
            this.vehicleNarrator.onReviewGenerationFinished = () => {
                this.stopWaitingSfx('review_wait');
            };
            this.vehicleNarrator.onTTSPlaybackStarted = () => {
                if (this.musicPlayer) this.musicPlayer.setNarrationDucked(true);
            };
            this.vehicleNarrator.onTTSPlaybackEnded = () => {
                if (this.musicPlayer) this.musicPlayer.setNarrationDucked(false);
            };
            this.setSfxMuted(this.vehicleNarrator.isMuted());
        }

        // --- CollectionManager callbacks ---
        if (this.collectionManager) {
            this.collectionManager.onShowDescription = (text: string) => {
                if (this.vehicleNarrator) this.vehicleNarrator.showDescriptionText(text);
            };
            this.collectionManager.onShowAnimatedDescription = (text: string) => {
                if (this.vehicleNarrator) this.vehicleNarrator.showAnimatedDescriptionText(text);
            };
            this.collectionManager.onHideDescriptionAfterDelay = (seconds: number) => {
                if (this.vehicleNarrator) this.vehicleNarrator.hideDescriptionAfterDelay(seconds);
            };
            this.collectionManager.onConnectButton = (obj: SceneObject, cb: () => void, name: string): boolean => {
                if (this.vehicleCardUI) return this.vehicleCardUI.connectButton(obj, cb, name);
                return false;
            };
            this.collectionManager.onReviewVehicle = (data: VehicleData, cardReviewText?: Text) => {
                if (this.vehicleNarrator) this.vehicleNarrator.triggerReview(data, cardReviewText);
            };
            this.collectionManager.onShowCardStatus = (text: string) => {
                if (this.vehicleCardUI) this.vehicleCardUI.showCardStatus(text);
            };
            this.collectionManager.onHideCardStatus = (seconds: number) => {
                if (this.vehicleCardUI) this.vehicleCardUI.hideCardStatusAfterDelay(seconds);
            };
            this.collectionManager.onCardGenerationStarted = () => {
                this.startWaitingSfx(this.sfxCardGenerationWaiting, 'card_wait');
            };
            this.collectionManager.onCardGenerationSuccess = () => {
                this.stopWaitingSfx('card_wait');
                this.playOneShotSfx(this.sfxCardGenerationSuccess);
            };
            this.collectionManager.onCardGenerationFailed = () => {
                this.stopWaitingSfx('card_wait');
                this.playOneShotSfx(this.sfxCardGenerationFailed);
            };
            this.collectionManager.onCardFlyToInventory = () => {
                this.playOneShotSfx(this.sfxCardFlyToInventory);
            };
            this.collectionManager.onGetTrustDisplayString = () => {
                if (this.xpManager) return this.xpManager.getTrustDisplayString();
                return 'Trust: Unknown';
            };

            // XP attribution when a card is successfully saved
            this.collectionManager.onCardSaved = (data: SavedVehicleData) => {
                if (this.xpManager) {
                    const rarity = data.rarity || 2;
                    print('CarScanner: Card saved — awarding XP for rarity ' + rarity);
                    this.xpManager.awardScanXP(rarity);
                    this.xpManager.rewardTrust();
                }
                if (this.analyticsManager) this.analyticsManager.logSave(0);
            };
        }

        // --- CardInteraction callbacks ---
        if (this.cardInteraction) {
            this.cardInteraction.onShowDescription = (text: string) => {
                if (this.vehicleNarrator) this.vehicleNarrator.showDescriptionText(text);
            };
            this.cardInteraction.onHideDescriptionAfterDelay = (seconds: number) => {
                if (this.vehicleNarrator) this.vehicleNarrator.hideDescriptionAfterDelay(seconds);
            };
            this.cardInteraction.onUpdateDeleteButtonVisibility = () => {
                if (this.collectionManager) this.collectionManager.updateDeleteButtonVisibility();
            };
            this.cardInteraction.onGetUserHeadTransform = () => {
                if (this.collectionManager) return this.collectionManager.getUserHeadTransformPublic();
                return null;
            };
            this.cardInteraction.onCardPlacedInWorld = (serial: string, pos: vec3, rot: quat, scale: number) => {
                if (this.connectedLensManager) {
                    this.connectedLensManager.broadcastCardPlaced(serial, pos, rot, scale);
                }
            };
            this.cardInteraction.onCardReturnedToCollection = (serial: string) => {
                if (this.vehicleNarrator) this.vehicleNarrator.hideDescription();
                if (this.connectedLensManager) {
                    this.connectedLensManager.broadcastCardReturned(serial);
                }
            };
            this.cardInteraction.onCardGrabbed = (serial: string, pos: vec3, rot: quat, scale: number) => {
                if (this.connectedLensManager) {
                    this.connectedLensManager.broadcastCardGrabbed(serial, pos, rot, scale);
                }
            };
            this.cardInteraction.onCardMoving = (serial: string, pos: vec3, rot: quat, scale: number) => {
                if (this.connectedLensManager) {
                    this.connectedLensManager.broadcastCardMoving(serial, pos, rot, scale);
                }
            };
        }

        // --- XPManager callbacks ---
        if (this.xpManager) {
            this.xpManager.onConnectButton = (obj: SceneObject, cb: () => void, name: string): boolean => {
                if (this.vehicleCardUI) return this.vehicleCardUI.connectButton(obj, cb, name);
                return false;
            };
            this.xpManager.onXPGained = (amount: number, newTotal: number) => {
                print('CarScanner: XP gained +' + amount + ' (total: ' + newTotal + ')');
            };
            this.xpManager.onLevelUp = (newLevel: number, levelName: string) => {
                print('CarScanner: LEVEL UP! ' + newLevel + ' — ' + levelName);
                this.playOneShotSfx(this.sfxLevelUp);
                if (this.vehicleNarrator) {
                    this.vehicleNarrator.showDescriptionText(tf('level_up', { level: newLevel, name: levelName }));
                    this.vehicleNarrator.hideDescriptionAfterDelay(5.0);
                }
            };
            this.xpManager.onPositiveProgress = () => {
                this.playOneShotSfx(this.sfxPositiveProgress);
            };
            this.xpManager.onNegativeProgress = () => {
                if (this.suppressNextNegativeProgressSfx) {
                    this.suppressNextNegativeProgressSfx = false;
                    return;
                }
                this.playOneShotSfx(this.sfxNegativeProgress);
            };

            this.xpManager.onUserCardOpened = () => {
                if (this.collectionManager) {
                    this.collectionManager.closeAllPopups();
                    this.collectionManager.setDeleteButtonForceDisabled(true);
                }
            };

            this.xpManager.onUserCardClosed = () => {
                if (this.collectionManager) {
                    this.collectionManager.setDeleteButtonForceDisabled(false);
                }
            };

            this.xpManager.onGetUserHeadTransform = () => {
                if (this.collectionManager) return this.collectionManager.getUserHeadTransformPublic();
                return null;
            };
        }

        // --- WelcomeManager callbacks ---
        if (this.welcomeManager) {
            this.welcomeManager.onConnectButton = (obj: SceneObject, cb: () => void, name: string): boolean => {
                if (this.vehicleCardUI) return this.vehicleCardUI.connectButton(obj, cb, name);
                return false;
            };
            this.welcomeManager.onLanguageSelected = (lang: Lang) => {
                print('CarScanner: Language selected — ' + lang);
                this.translateAllStaticUI();
            };
            this.welcomeManager.onSoloModeSelected = () => {
                print('CarScanner: Solo mode selected — starting game');
                this.showScanInterface();
            };
            this.welcomeManager.onConnectedLensModeSelected = () => {
                print('CarScanner: Connected Lens mode selected');
                if (!this.isInternetAvailable()) {
                    print('CarScanner: No internet — cannot start Connected Lens');
                    if (this.vehicleNarrator) {
                        this.vehicleNarrator.showDescriptionText(t('no_internet'));
                        this.vehicleNarrator.hideDescriptionAfterDelay(4.0);
                    }
                    return;
                }
                if (this.connectedLensManager) {
                    this.connectedLensManager.startSession();
                }
            };
            this.welcomeManager.onShowMessage = (text: string) => {
                if (this.vehicleNarrator) {
                    this.vehicleNarrator.showDescriptionText(text);
                    this.vehicleNarrator.hideDescriptionAfterDelay(3.0);
                }
            };
        }

        // --- ConnectedLensManager callbacks ---
        if (this.connectedLensManager) {
            // Wire wrist anchor for remote carousel positioning (broadcasts wrist pos to remote players)
            if (this.collectionManager && this.collectionManager.cardCollectionContainer) {
                this.connectedLensManager.wristAnchor = this.collectionManager.cardCollectionContainer;
                print('CarScanner: Wrist anchor wired to cardCollectionContainer');
            }

            this.connectedLensManager.onConnectButton = (obj: SceneObject, cb: () => void, name: string): boolean => {
                if (this.vehicleCardUI) return this.vehicleCardUI.connectButton(obj, cb, name);
                return false;
            };
            this.connectedLensManager.onSessionConnected = () => {
                print('CarScanner: Connected Lens session connected — waiting for colocation');
                // Do NOT show Car Scan Interface yet — wait for colocation to complete
                // Guidance messages are shown via onShowGuidance → XP Display
            };
            this.connectedLensManager.onSessionReady = () => {
                print('CarScanner: Connected Lens session fully ready (colocation complete) — showing scan interface');
                this.showScanInterface();
            };
            this.connectedLensManager.onSessionFailed = (reason: string) => {
                print('CarScanner: Connected Lens session FAILED — ' + reason);
                this.hideScanInterface();
                this.setHandButtonsEnabled(false);
                if (this.welcomeManager) {
                    this.welcomeManager.show();
                    print('CarScanner: Returned to Welcome screen after session failure');
                }
            };
            this.connectedLensManager.onSessionCancelled = () => {
                print('CarScanner: User cancelled session dialog — returning to Welcome');
                this.hideScanInterface();
                this.setHandButtonsEnabled(false);
                if (this.welcomeManager) {
                    this.welcomeManager.show();
                }
            };
            this.connectedLensManager.onSessionLost = () => {
                print('CarScanner: Session lost mid-game — showing message and returning to Welcome');
                if (this.xpManager && this.xpManager.xpDisplay) {
                    this.xpManager.enqueueCustomPopup(t('session_lost'), 1, 0.3, 0.1, 4.0, -1);
                }
                const returnDelay = this.createEvent('DelayedCallbackEvent');
                (returnDelay as any).bind(() => {
                    this.hideScanInterface();
                    this.setHandButtonsEnabled(false);
                    if (this.welcomeManager) {
                        this.welcomeManager.show();
                        print('CarScanner: Returned to Welcome screen after mid-game disconnect');
                    }
                });
                (returnDelay as any).reset(4.5);
            };
            this.connectedLensManager.onPlayerJoined = (name: string) => {
                print('CarScanner: Player joined — ' + name);
                if (this.vehicleNarrator) {
                    this.vehicleNarrator.showDescriptionText(name + ' joined the session!');
                    this.vehicleNarrator.hideDescriptionAfterDelay(3.0);
                }
            };
            this.connectedLensManager.onPlayerLeft = (name: string) => {
                print('CarScanner: Player left — ' + name);
                if (this.vehicleNarrator) {
                    this.vehicleNarrator.showDescriptionText(name + ' left the session');
                    this.vehicleNarrator.hideDescriptionAfterDelay(3.0);
                }
            };
            this.connectedLensManager.onShowMessage = (text: string) => {
                if (this.vehicleNarrator) {
                    this.vehicleNarrator.showDescriptionText(text);
                    this.vehicleNarrator.hideDescriptionAfterDelay(3.0);
                }
            };

            // Colocation guidance — use XP Display (camera-attached) as primary display
            // because the dedicated Colocated Guidance text is shared with SnapCloudRequirements
            this.connectedLensManager.onShowGuidance = (text: string) => {
                print('CarScanner: [GUIDANCE] ' + text.replace(/\n/g, ' | '));
                if (this.xpManager && this.xpManager.xpDisplay) {
                    const displayObj = this.xpManager.xpDisplay.getSceneObject();
                    if (displayObj) displayObj.enabled = true;
                    this.xpManager.xpDisplay.text = text;
                    try {
                        this.xpManager.xpDisplay.textFill.color = new vec4(1, 1, 1, 1);
                    } catch (e) { /* ignore */ }
                }
            };
            this.connectedLensManager.onHideGuidance = () => {
                if (this.xpManager && this.xpManager.xpDisplay) {
                    const displayObj = this.xpManager.xpDisplay.getSceneObject();
                    if (displayObj) displayObj.enabled = false;
                    this.xpManager.xpDisplay.text = '';
                }
            };

            // Card received from another player — add to persistent collection (with optional image)
            this.connectedLensManager.onCardReceived = (card: any, imageB64?: string) => {
                print('CarScanner: Received card from trade — ' + card.brand_model
                    + (imageB64 ? ' (with image)' : ' (no image)'));
                if (this.collectionManager) {
                    this.collectionManager.addReceivedCard(card, imageB64);
                    this.collectionManager.addTradeRecord({
                        timestamp: Date.now(),
                        type: 'received',
                        serial: card.serial || '',
                        brand_model: card.brand_model || '?',
                        rarity: card.rarity || 2,
                        partnerName: '',
                        method: 'colocated',
                    });
                }
                if (this.xpManager) {
                    this.xpManager.awardTradeXP(card.serial);
                }
                if (this.analyticsManager) this.analyticsManager.logTrade('received', 'colocated');
            };

            // Card given away — remove from persistent collection + award XP to giver
            this.connectedLensManager.onCardGivenAway = (serial: string) => {
                print('CarScanner: Card given away — serial: ' + serial);
                if (this.collectionManager) {
                    const vehicles = this.collectionManager.getSavedVehicles();
                    const v = vehicles.find((v: SavedVehicleData) => v.serial === serial);
                    this.collectionManager.addTradeRecord({
                        timestamp: Date.now(),
                        type: 'given',
                        serial: serial,
                        brand_model: v ? v.brand_model : '?',
                        rarity: v ? v.rarity : 2,
                        partnerName: '',
                        method: 'colocated',
                    });
                    this.collectionManager.removeCardBySerial(serial);
                }
                if (this.xpManager) {
                    this.xpManager.awardGiveXP(serial);
                }
                if (this.analyticsManager) this.analyticsManager.logTrade('given', 'colocated');
            };

            // Wire image retrieval callbacks for network image transmission
            if (this.collectionManager) {
                this.connectedLensManager.onGetCardImageBase64 = (savedAt: number) => {
                    return this.collectionManager!.getCardImageBase64(savedAt);
                };
                this.connectedLensManager.onGetSavedAtForSerial = (serial: string) => {
                    return this.collectionManager!.getSavedAtForSerial(serial);
                };
                this.connectedLensManager.onHasCardSerial = (serial: string) => {
                    if (!this.collectionManager) return false;
                    const vehicles = this.collectionManager.getSavedVehicles();
                    return vehicles.some((v: SavedVehicleData) => v.serial === serial);
                };

                this.connectedLensManager.onLoadBrandLogo = (logoObj: SceneObject, brand: string) => {
                    if (!this.collectionManager || !(this.collectionManager as any).brandLogoLoader) return;
                    const loader = (this.collectionManager as any).brandLogoLoader;
                    const url = loader.getBrandLogoUrl(brand);
                    if (url) loader.loadLogoOntoObject(logoObj, url);
                };
            }

            if (this.xpManager) {
                this.connectedLensManager.onGetLevelBadgeUrl = (level: number) => {
                    return this.xpManager ? this.xpManager.getLevelBadgeUrl(level) : '';
                };
            }

            // Wire CollectionManager carousel visibility to ConnectedLensManager (with angle for remote rotation)
            if (this.collectionManager) {
                this.collectionManager.onCarouselVisibilityChanged = (visible: boolean, cardData: any[], carouselAngle?: number) => {
                    if (this.connectedLensManager) {
                        this.connectedLensManager.setLocalCarouselVisible(visible, cardData, carouselAngle);
                    }
                };
            }

            // Sync local carousel rotation so remote player sees the same rotation
            this.connectedLensManager.onGetCarouselState = () => ({
                visible: this.collectionManager?.isCollectionOpen ?? false,
                angle: this.cardInteraction?.carouselAngleOffset ?? 0,
            });

            // Send local player stats to remote players whenever XP changes
            if (this.xpManager) {
                // Push initial stats once session connects
                this.connectedLensManager.onSessionConnected = ((prevCb) => {
                    return () => {
                        if (prevCb) prevCb();
                        this.pushLocalPlayerStats();
                    };
                })(this.connectedLensManager.onSessionConnected);

                // Push updated stats whenever XP is gained
                const prevOnXPGained = this.xpManager.onXPGained;
                this.xpManager.onXPGained = (amount: number, totalXP: number) => {
                    if (prevOnXPGained) prevOnXPGained(amount, totalXP);
                    this.pushLocalPlayerStats();
                };
            }
        }

        // --- CloudManager callbacks ---
        this.wireCloudManager();
    }

    // =====================================================================
    // CLOUD MANAGER WIRING
    // =====================================================================

    private wireCloudManager(): void {
        if (!this.cloudManager) {
            print('CarScanner: CloudManager not assigned — cloud features disabled');
            return;
        }

        // --- Auth callbacks ---
        this.cloudManager.onAuthenticated = (userId: string) => {
            print('CarScanner: [CLOUD] Authenticated — uid=' + userId.substring(0, 8) + '...');

            // Sync profile to cloud on auth
            if (this.xpManager) {
                const profile = this.xpManager.getProfile();
                this.cloudManager!.syncProfile(
                    profile,
                    profile.totalScans || 0,
                    profile.totalTrades || 0
                );
            }

            // Sync full collection to cloud on auth
            if (this.collectionManager) {
                const vehicles = this.collectionManager.getSavedVehicles();
                if (vehicles.length > 0) {
                    this.cloudManager!.syncFullCollection(vehicles);
                }
            }

            // Fetch leaderboard
            this.cloudManager!.fetchLeaderboard(10);
        };

        this.cloudManager.onAuthFailed = (error: string) => {
            print('CarScanner: [CLOUD] Auth failed — ' + error);
        };

        this.cloudManager.onProfileSynced = (cloudProfile) => {
            print('CarScanner: [CLOUD] Profile synced — LVL ' + cloudProfile.level);
        };

        this.cloudManager.onCollectionSynced = (count: number) => {
            print('CarScanner: [CLOUD] Collection synced — ' + count + ' vehicles');
        };

        this.cloudManager.onLeaderboardReady = (entries, myRank) => {
            print('CarScanner: [CLOUD] Leaderboard ready — '
                + entries.length + ' entries, my rank=#' + myRank);
            if (myRank > 0 && this.vehicleNarrator) {
                this.vehicleNarrator.showDescriptionText(tf('global_rank', { rank: myRank, total: entries.length }));
                this.vehicleNarrator.hideDescriptionAfterDelay(4.0);
            }
        };

        this.cloudManager.onTradeReceived = (trade) => {
            print('CarScanner: [CLOUD] Trade received — ' + trade.offered_brand_model);
            if (this.vehicleNarrator) {
                this.vehicleNarrator.showDescriptionText(
                    tf('trade_request_card', { name: trade.offered_brand_model, rarity: trade.offered_rarity })
                );
                this.vehicleNarrator.hideDescriptionAfterDelay(6.0);
            }
        };

        this.cloudManager.onShowMessage = (text: string) => {
            if (this.vehicleNarrator) {
                this.vehicleNarrator.showDescriptionText(text);
                this.vehicleNarrator.hideDescriptionAfterDelay(3.0);
            }
        };

        this.cloudManager.onAsyncTradeCompleted = (cloudVehicle: any) => {
            print('CarScanner: [CLOUD] Async trade completed — ' + cloudVehicle.brand_model);
            if (this.collectionManager) {
                const card = {
                    brand_model: cloudVehicle.brand_model || '?',
                    type: cloudVehicle.type || 'sedan',
                    rarity: cloudVehicle.rarity || 2,
                    rarity_label: cloudVehicle.rarity_label || '',
                    serial: cloudVehicle.serial || '',
                    top_speed: cloudVehicle.top_speed || 2,
                    acceleration: cloudVehicle.acceleration || 2,
                    braking: cloudVehicle.braking || 2,
                    traction: cloudVehicle.traction || 2,
                    comfort: cloudVehicle.comfort || 3,
                    year: cloudVehicle.year || '',
                    scene: cloudVehicle.scene || '',
                };
                this.collectionManager.addReceivedCard(card as any);
                this.collectionManager.addTradeRecord({
                    timestamp: Date.now(),
                    type: 'received',
                    serial: card.serial,
                    brand_model: card.brand_model,
                    rarity: card.rarity,
                    partnerName: '',
                    method: 'async',
                });
            }
            if (this.xpManager) {
                this.xpManager.awardTradeXP(cloudVehicle.serial);
            }
        };

        // --- CollectionManager → Cloud callbacks ---
        if (this.collectionManager) {
            this.collectionManager.onCloudSyncVehicle = (vehicle: SavedVehicleData) => {
                if (this.cloudManager && this.cloudManager.isReady()) {
                    this.cloudManager.syncVehicle(vehicle);
                }
            };

            this.collectionManager.onCloudUploadImage = (serial: string, base64: string) => {
                if (this.cloudManager && this.cloudManager.isReady()) {
                    this.cloudManager.uploadCardImage(serial, base64);
                }
            };

            this.collectionManager.onCloudDeleteVehicle = (serial: string) => {
                if (this.cloudManager && this.cloudManager.isReady()) {
                    this.cloudManager.deleteCloudVehicle(serial);
                }
            };

            this.collectionManager.onCloudSyncTradeHistory = (entry: TradeHistoryEntry) => {
                if (this.cloudManager && this.cloudManager.isReady()) {
                    this.cloudManager.syncTradeHistoryEntry(entry);
                }
            };

            this.collectionManager.onCloudSyncFullCollection = (vehicles: SavedVehicleData[]) => {
                if (this.cloudManager && this.cloudManager.isReady()) {
                    this.cloudManager.syncFullCollection(vehicles);
                }
            };

            this.collectionManager.onCloudResetCollection = () => {
                if (this.cloudManager && this.cloudManager.isReady()) {
                    this.cloudManager.resetCloudCollection();
                }
                if (this.xpManager) {
                    this.xpManager.fullReset();
                    print('CarScanner: [RESET] Local profile reset to level 1');
                }
            };

            this.collectionManager.onShareCollection = (callback: (url: string) => void) => {
                const doShare = () => {
                    this.cloudManager!.shareCollection().then((url) => {
                        callback(url);
                    }).catch((err) => {
                        print('CarScanner: [CLOUD] Share failed — ' + err);
                        this.playOneShotSfx(this.sfxShareProfileFailed);
                        callback(tf('share_failed_err', { error: err }));
                    });
                };
                if (this.cloudManager && this.cloudManager.isReady()) {
                    doShare();
                } else if (this.cloudManager) {
                    this.cloudManager.tryReconnect().then((ok) => {
                        if (ok) {
                            print('CarScanner: [CLOUD] Reconnected — sharing collection');
                            doShare();
                        } else {
                            this.playOneShotSfx(this.sfxShareProfileFailed);
                            callback(t('cloud_not_connected'));
                        }
                    }).catch(() => {
                        this.playOneShotSfx(this.sfxShareProfileFailed);
                        callback(t('cloud_not_connected'));
                    });
                } else {
                    this.playOneShotSfx(this.sfxShareProfileFailed);
                    callback(t('cloud_not_connected'));
                }
            };
        }

        // --- XPManager → Cloud profile sync ---
        if (this.xpManager) {
            this.xpManager.onCloudSyncProfile = (profile: UserProfile) => {
                if (this.cloudManager && this.cloudManager.isReady()) {
                    this.cloudManager.syncProfile(
                        profile,
                        profile.totalScans || 0,
                        profile.totalTrades || 0
                    );
                }
            };
        }

        // --- Share Gallery callbacks ---
        this.cloudManager.onGetProfile = () => {
            if (this.xpManager) return this.xpManager.getProfile();
            return { level: 1, totalXP: 0, prestige: 0, lastLoginDate: '', streakDays: 0, totalScans: 0, totalTrades: 0, trustScore: 80, consecutiveCheats: 0, totalCheats: 0, cardsGiven: 0, cardsReceived: 0 };
        };

        this.cloudManager.onGetCollection = () => {
            if (this.collectionManager) return this.collectionManager.getSavedVehicles();
            return [];
        };

        this.cloudManager.onGetUsername = () => {
            if (this.xpManager) return this.xpManager.getUsername();
            return '';
        };

        this.cloudManager.onGetAvatarUrl = () => {
            return this.cloudManager.getAvatarUrl();
        };

        this.cloudManager.onShareComplete = (url: string) => {
            print('CarScanner: [CLOUD] Gallery shared — ' + url);
            if (this.vehicleNarrator) {
                this.vehicleNarrator.showDescriptionText(tf('gallery_shared', { url: url }));
                this.vehicleNarrator.hideDescriptionAfterDelay(10.0);
            }
        };
        this.cloudManager.onShareSucceeded = () => {
            this.playOneShotSfx(this.sfxShareProfileSuccess);
        };
        this.cloudManager.onShareFailed = () => {
            this.playOneShotSfx(this.sfxShareProfileFailed);
        };

        this.cloudManager.onGetLocalImage = (savedAt: number) => {
            try {
                return global.persistentStorageSystem.store.getString('dgns_img_' + savedAt.toString());
            } catch (e) { return ''; }
        };

        print('CarScanner: CloudManager wired');
    }

    // =====================================================================
    // SCAN BUTTON
    // =====================================================================

    private setupScanButton(): void {
        if (!this.scanButton) {
            print('CarScanner: scanButton not assigned');
            return;
        }

        const btnScript = this.scanButton.getComponent('Component.ScriptComponent') as any;
        if (btnScript?.onTriggerUp && typeof btnScript.onTriggerUp.add === 'function') {
            btnScript.onTriggerUp.add(() => {
                print('CarScanner: Scan button pressed');
                this.onScanButtonPressed();
            });
            print('CarScanner: Scan button connected');
        } else {
            this.createEvent('TapEvent').bind(() => {
                this.onScanButtonPressed();
            });
        }
    }

    // =====================================================================
    // SCANNER BUTTON — Reopens Car Scan Interface if closed via (x)
    // =====================================================================

    private setupScannerButton(): void {
        if (!this.scannerButton) return;
        this.scannerButtonTextComp = this.findTextInHierarchy(this.scannerButton);
        if (this.vehicleCardUI) {
            if (this.vehicleCardUI.connectButton(this.scannerButton, () => {
                this.toggleScanInterface();
            }, 'ScannerButton')) {
                print('CarScanner: Scanner Button connected');
            }
        }
    }

    private toggleScanInterface(): void {
        if (this.carScanInterface && this.carScanInterface.enabled) {
            this.hideScanInterface();
        } else {
            this.showScanInterface();
        }
    }

    private findTextInHierarchy(obj: SceneObject): Text | null {
        try {
            const t = obj.getComponent('Component.Text') as Text;
            if (t) return t;
        } catch (e) { /* no text on this object */ }
        const count = obj.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = obj.getChild(i);
            if (!child) continue;
            const found = this.findTextInHierarchy(child);
            if (found) return found;
        }
        return null;
    }

    private updateScannerButtonLabel(): void {
        if (!this.scannerButtonTextComp) return;
        const isOpen = this.carScanInterface && this.carScanInterface.enabled;
        this.scannerButtonTextComp.text = isOpen ? t('close_scanner') : t('open_scanner');
    }

    // =====================================================================
    // DEBUG COLLECTION BUTTON — Opens carousel in front of camera (preview testing)
    // =====================================================================

    private setupOpenCollectionDebugButton(): void {
        if (!this.openCollectionDebugButton) return;
        if (this.vehicleCardUI) {
            if (this.vehicleCardUI.connectButton(this.openCollectionDebugButton, () => {
                print('CarScanner: Open Collection Debug pressed');
                if (this.collectionManager) {
                    // If collection is empty, create test cards for preview testing
                    if (this.collectionManager.collectionCardObjects.length === 0) {
                        print('CarScanner: Collection empty — creating debug cards for testing');
                        this.collectionManager.createDebugCards();
                    }
                    this.collectionManager.toggleCollection();
                }
            }, 'OpenCollectionDebug')) {
                print('CarScanner: Open Collection Debug button connected');
            }
        }
    }

    // =====================================================================
    // SCAN FLOW — Orchestrates the full scan pipeline
    // =====================================================================

    private async onScanButtonPressed(): Promise<void> {
        if (!this.vehicleScanner || this.vehicleScanner.getIsScanning() || this.isScanInProgress) return;
        this.isScanInProgress = true;
        this.startWaitingSfx(this.sfxScanWaiting, 'scan_wait');

        // Notify Connected Lens that we started scanning
        if (this.connectedLensManager) this.connectedLensManager.setLocalScanning(true);

        // Refresh city cache before each scan (async callback will update cache)
        if (this.collectionManager) this.collectionManager.prefetchCity();

        // Reset previous state
        if (this.vehicleNarrator) this.vehicleNarrator.hideDescription();
        if (this.vehicleCardUI) this.vehicleCardUI.setUIState('loading', () => this.hideScanInterface());

        const scanStartTime = Date.now();
        try {
            // Step 1+2+3: Capture, analyze, position (all inside VehicleScanner)
            const vehicleData = await this.vehicleScanner.scanVehicle();
            const scanDurationMs = Date.now() - scanStartTime;

            if (!vehicleData) {
                this.stopWaitingSfx('scan_wait');
                const reason = this.vehicleScanner.getLastRejectionReason();
                if (this.analyticsManager) {
                    this.analyticsManager.logScan(scanDurationMs, false);
                }
                if (reason === 'SCREEN_OR_PHOTO_DETECTED' && this.vehicleScanner.enableAntiCheat) {
                    if (this.analyticsManager) this.analyticsManager.logAntiCheatBlock();
                    this.showCheatSequence();
                }
                this.showNoCarDetected();
                return;
            }

            if (this.analyticsManager) this.analyticsManager.logScan(scanDurationMs, true);
            print('CarScanner: Vehicle identified: ' + vehicleData.brand_model);

            if (this.vehicleNarrator) this.vehicleNarrator.showStatusProcessing(t('car_detected'));

            // Pass data to narrator for "Fetch Info" feature
            if (this.vehicleNarrator) this.vehicleNarrator.setVehicleData(vehicleData);

            // Pass data to collection manager for "Save" feature
            if (this.collectionManager) this.collectionManager.setLastVehicleData(vehicleData);

            // Pass the compressed captured photo for Image Edit (gpt-image-1)
            if (this.collectionManager && this.vehicleScanner) {
                this.collectionManager.setLastCapturedImage(this.vehicleScanner.getLastCapturedBase64ForEdit());
            }

            // Display results on Vehicle Card
            if (this.vehicleCardUI) this.vehicleCardUI.displayResults(vehicleData);

            // Show Vehicle Card
            if (this.vehicleCardUI) this.vehicleCardUI.setUIState('results', () => this.hideScanInterface());
            this.stopWaitingSfx('scan_wait');
            this.playOneShotSfx(this.sfxVehicleCardShown);

            // Load brand logo (async, non-blocking). Use brand or first word of brand_model (e.g. "Tesla Model 3" -> "Tesla")
            const brandForLogo = vehicleData.brand || (vehicleData.brand_model ? vehicleData.brand_model.trim().split(/\s+/)[0] : '');
            if (brandForLogo && this.brandLogoLoader) {
                this.brandLogoLoader.loadLogo(brandForLogo);
            }

        } catch (error) {
            this.stopWaitingSfx('scan_wait');
            print('CarScanner: Scan error: ' + error);
            if (this.vehicleNarrator) this.vehicleNarrator.showStatusError(t('scan_failed'));
            if (this.analyticsManager) this.analyticsManager.logError('scan', String(error));
        } finally {
            this.isScanInProgress = false;
            if (this.connectedLensManager) this.connectedLensManager.setLocalScanning(false);
        }
    }

    private showNoCarDetected(): void {
        const reason = this.vehicleScanner ? this.vehicleScanner.getLastRejectionReason() : '';
        if (reason === 'SCREEN_OR_PHOTO_DETECTED') {
            if (this.vehicleNarrator) {
                const cheats = this.xpManager ? this.xpManager.getConsecutiveCheats() : 1;
                const messages = getCheatMessages();
                const idx = Math.min(cheats - 1, messages.length - 1);
                this.vehicleNarrator.showStatusError(messages[idx], 8.0);
            }
            print('CarScanner: ANTI-CHEAT blocked scan — screen/photo detected');
        } else {
            if (this.vehicleNarrator) this.vehicleNarrator.showStatusError(t('no_car_detected'));
        }
        if (this.vehicleScanner) this.vehicleScanner.restoreLiveCameraFeed();
        this.showScanInterface();
    }

    private showCheatSequence(): void {
        if (!this.xpManager) return;
        this.playOneShotSfx(this.sfxCheatDetected);
        this.playOneShotSfx(this.sfxCheatReprimand);
        const cheats = this.xpManager.getConsecutiveCheats();
        const messages = getCheatMessages();
        const idx = Math.min(cheats, messages.length - 1);
        this.xpManager.enqueueCustomPopup(messages[idx], 1, 0.3, 0.1, 4.0, 0);
        this.suppressNextNegativeProgressSfx = true;
        this.xpManager.penalizeTrust();
        this.playOneShotSfx(this.sfxNegativeProgress);
    }

    private setSfxMuted(muted: boolean): void {
        this.sfxMuted = muted;
        if (this.sfxAudio) {
            this.sfxAudio.volume = muted ? 0.0 : 1.0;
        }
        if (muted) this.stopAllSfx();
    }

    private stopAllSfx(): void {
        if (!this.sfxAudio) return;
        try {
            this.sfxAudio.stop(true);
            this.activeSfxState = 'none';
            this.activeSfxTrack = null;
            this.oneShotQueue = [];
            this.sfxAudio.setOnFinish(null);
        } catch (e) {
            print('CarScanner: SFX stop failed: ' + e);
        }
    }

    private startWaitingSfx(track: AudioTrackAsset | null | undefined, state: 'scan_wait' | 'card_wait' | 'review_wait'): void {
        this.oneShotQueue = [];
        this.playSfxInternal(track, state);
    }

    private stopWaitingSfx(state: 'scan_wait' | 'card_wait' | 'review_wait'): void {
        if (this.activeSfxState !== state) return;
        this.stopAllSfx();
    }

    private playOneShotSfx(track: AudioTrackAsset | null | undefined): void {
        if (!track || !this.sfxAudio || this.sfxMuted) return;
        this.oneShotQueue.push(track);

        // Already playing a one-shot: keep queue order.
        if (this.activeSfxState === 'oneshot') return;

        // Interrupt any waiting loop and start queued one-shots now.
        this.playNextQueuedOneShot();
    }

    private playSfxInternal(
        track: AudioTrackAsset | null | undefined,
        state: 'scan_wait' | 'card_wait' | 'review_wait' | 'oneshot'
    ): void {
        if (this.sfxMuted || !this.sfxAudio || !track) return;
        try {
            this.sfxAudio.stop(true);
        } catch (e) { /* ignore */ }
        try {
            this.sfxAudio.setOnFinish(() => this.onSfxFinished());
            this.sfxAudio.audioTrack = track;
            this.sfxAudio.play(1);
            this.activeSfxState = state;
            this.activeSfxTrack = track;
        } catch (e) {
            print('CarScanner: SFX playback failed: ' + e);
            this.activeSfxState = 'none';
            this.activeSfxTrack = null;
        }
    }

    private playNextQueuedOneShot(): void {
        if (this.sfxMuted || !this.sfxAudio) return;
        if (this.oneShotQueue.length === 0) return;
        const next = this.oneShotQueue.shift();
        if (!next) return;
        this.playSfxInternal(next, 'oneshot');
    }

    private onSfxFinished(): void {
        if (this.sfxMuted || !this.sfxAudio) return;

        // Waiting sounds loop until explicitly stopped/replaced.
        if (this.activeSfxState === 'scan_wait'
            || this.activeSfxState === 'card_wait'
            || this.activeSfxState === 'review_wait') {
            if (this.activeSfxTrack) {
                try {
                    this.sfxAudio.audioTrack = this.activeSfxTrack;
                    this.sfxAudio.play(1);
                } catch (e) {
                    this.activeSfxState = 'none';
                    this.activeSfxTrack = null;
                }
            }
            return;
        }

        if (this.oneShotQueue.length > 0) {
            this.playNextQueuedOneShot();
            return;
        }

        this.activeSfxState = 'none';
        this.activeSfxTrack = null;
    }

    private showOnXPDisplay(text: string, r: number, g: number, b: number, duration: number): void {
        if (!this.xpManager || !this.xpManager.xpDisplay) return;
        const displayObj = this.xpManager.xpDisplay.getSceneObject();
        if (!displayObj) return;
        displayObj.enabled = true;
        this.xpManager.xpDisplay.text = text;
        try {
            this.xpManager.xpDisplay.textFill.color = new vec4(r, g, b, 1);
        } catch (e) { /* ignore */ }
        const hideEvent = this.createEvent('DelayedCallbackEvent');
        (hideEvent as any).bind(() => {
            if (displayObj) displayObj.enabled = false;
        });
        (hideEvent as any).reset(duration);
    }

    // =====================================================================
    // CONNECTED LENS — Push local player stats to network
    // =====================================================================

    private pushLocalPlayerStats(): void {
        if (!this.connectedLensManager || !this.xpManager) return;
        const profile = this.xpManager.getProfile();
        if (!profile) return;
        this.connectedLensManager.setLocalPlayerStats(
            profile.level || 1,
            profile.prestige || 0,
            profile.totalXP || 0,
            this.xpManager.getTrustScore()
        );
    }

    // =====================================================================
    // SCAN INTERFACE MANAGEMENT
    // =====================================================================

    private showScanInterface(): void {
        if (this.carScanInterface) {
            this.positionInFrontOfUser(this.carScanInterface);
            this.carScanInterface.enabled = true;
            if (this.vehicleScanner) this.vehicleScanner.restoreLiveCameraFeed();
            if (this.vehicleNarrator && !this.vehicleNarrator.isShowingError()) {
                this.vehicleNarrator.startIdleMode();
            }
            if (!this.scanInterfaceCloseButtonConnected) {
                this.setupScanInterfaceCloseButton();
            }
            this.updateScannerButtonLabel();
            this.setHandButtonsEnabled(true);
            print('CarScanner: Scan interface shown');
        }
    }

    private positionInFrontOfUser(container: SceneObject): void {
        if (!this.collectionManager) return;
        const head = this.collectionManager.getUserHeadTransformPublic();
        if (!head) return;
        try {
            const spawnPos = head.position.add(head.forward.uniformScale(60));
            container.getTransform().setWorldPosition(spawnPos);
            container.getTransform().setWorldRotation(quat.quatIdentity());
        } catch (e) { /* ignore */ }
    }

    private hideScanInterface(): void {
        if (this.carScanInterface) {
            this.carScanInterface.enabled = false;
            if (this.vehicleNarrator) this.vehicleNarrator.stopStatusText();
            this.updateScannerButtonLabel();
            print('CarScanner: Scan interface hidden');
        }
    }

    private setupScanInterfaceCloseButton(): void {
        if (!this.carScanInterface || this.scanInterfaceCloseButtonConnected) return;

        let attempts = 0;
        const pollEvent = this.createEvent('UpdateEvent');
        pollEvent.bind(() => {
            if (this.scanInterfaceCloseButtonConnected) { pollEvent.enabled = false; return; }
            attempts++;
            if (attempts > 120) { pollEvent.enabled = false; return; }
            if (this.deepSearchCloseButton(this.carScanInterface)) {
                this.scanInterfaceCloseButtonConnected = true;
                pollEvent.enabled = false;
            }
        });
    }

    private deepSearchCloseButton(root: SceneObject): boolean {
        const count = root.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = root.getChild(i);
            if (!child) continue;
            if (child.name === 'FrameObject') {
                if (this.hookButtonIn(child)) return true;
            }
            if (this.deepSearchCloseButton(child)) return true;
        }
        return false;
    }

    // =====================================================================
    // STATIC UI TRANSLATION — Called after language selection
    // =====================================================================

    private translateAllStaticUI(): void {
        if (this.collectionManager) this.collectionManager.translateStaticTexts();
        if (this.connectedLensManager) this.connectedLensManager.translateStaticTexts();
        this.translateScanInterface();
        this.updateScannerButtonLabel();
        print('CarScanner: All static UI texts translated');
    }

    private translateScanInterface(): void {
        if (!this.carScanInterface) return;
        this.walkAndTranslateScanUI(this.carScanInterface);
    }

    private walkAndTranslateScanUI(obj: SceneObject): void {
        const name = obj.name;
        try {
            const textComp = obj.getComponent('Component.Text') as Text;
            if (textComp) {
                // Keep the scanner title text as authored in Inspector (no runtime override).
                if (name === 'Loading') {
                    textComp.text = t('loading_text');
                } else if (name.indexOf('Press the button') >= 0 || name.indexOf('front of a vehicle') >= 0) {
                    textComp.text = t('press_button_hint');
                } else if (name.indexOf('Scan vehicle button text') >= 0) {
                    textComp.text = t('scan_vehicle');
                } else if (name.indexOf('Find cars') >= 0 || name.indexOf('collect them all') >= 0) {
                    const phrases = getIdlePhrases();
                    textComp.text = phrases.length > 0 ? phrases[0] : '';
                }
            }
        } catch (e) { /* no text component */ }
        const count = obj.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = obj.getChild(i);
            if (child) this.walkAndTranslateScanUI(child);
        }
    }

    // =====================================================================
    // HAND BUTTONS — Enable/disable all hand-mounted UI buttons
    // =====================================================================

    private isInternetAvailable(): boolean {
        try {
            return (global as any).deviceInfoSystem && (global as any).deviceInfoSystem.isInternetAvailable();
        } catch (e) {
            return true;
        }
    }

    private setHandButtonsEnabled(enabled: boolean): void {
        if (this.scannerButton) this.scannerButton.enabled = enabled;
        if (this.collectionManager) {
            if (this.collectionManager.openCollectionButton) {
                this.collectionManager.openCollectionButton.enabled = enabled;
            }
        }
        if (this.xpManager) {
            if (this.xpManager.userCardButton) {
                this.xpManager.userCardButton.enabled = enabled;
            }
        }
        print('CarScanner: Hand buttons ' + (enabled ? 'ENABLED' : 'DISABLED'));
    }

    private hookButtonIn(parent: SceneObject): boolean {
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
                        s.onTriggerUp.add(() => this.hideScanInterface());
                        print('CarScanner: Scan interface close button hooked');
                        return true;
                    }
                    if (s.onButtonPinched && typeof s.onButtonPinched.add === 'function') {
                        s.onButtonPinched.add(() => this.hideScanInterface());
                        print('CarScanner: Scan interface close button hooked (pinch)');
                        return true;
                    }
                } catch (e) { /* ignore */ }
            }
            if (this.hookButtonIn(child)) return true;
        }
        return false;
    }
}
