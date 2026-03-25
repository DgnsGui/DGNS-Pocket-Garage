/**
 * ConnectedLensManager.ts — Colocated multiplayer manager for DGNS Vehicle Scanner
 *
 * Handles everything related to Connected Lens colocated multiplayer:
 *   - Session lifecycle via SessionController (from SpectaclesSyncKit)
 *   - Head position tracking via network messages (no SyncEntity dependency)
 *   - Remote player tracking (join/leave, head debug mesh, cam display)
 *   - Remote carousel rendering (read-only cards positioned in shared space)
 *   - Network messaging for carousel data + card exchange protocol
 *   - Card give flow: grab remote card → confirm dialog → transfer to requester
 *
 * NOTE: We intentionally avoid SyncEntity for head tracking because SyncEntity
 * waits for SessionController.notifyOnReady() which requires colocation to
 * complete. Instead, we use NetworkMessageWrapper which works immediately
 * after the session is connected.
 *
 * Colocated mode: players are face-to-face in the same physical space.
 * The SyncKit SessionControllerComponent handles shared coordinate alignment.
 * Ref: https://developers.snap.com/spectacles/about-spectacles-features/connected-lenses/building-connected-lenses
 *
 * @author DGNS
 * @license MIT
 */

import { SessionController } from 'SpectaclesSyncKit.lspkg/Core/SessionController';
import { NetworkMessageWrapper } from 'SpectaclesSyncKit.lspkg/Core/NetworkMessageWrapper';
import { NetworkMessage } from 'SpectaclesSyncKit.lspkg/Core/NetworkMessage';
import {
    SimplifiedCard,
    findChildByName,
    formatCarType, formatRarityText, clampStat,
    getLevelForXP, getXPForNextLevel,
    getTrustRank, formatTrustText, getTrustColor,
} from './VehicleTypes';
import { t, tf, getColocationGuidanceMessages } from './Localization';

// =====================================================================
// REMOTE PLAYER DATA — Tracked per-connection
// =====================================================================
interface RemotePlayerData {
    connectionId: string;
    displayName: string;
    /** Smoothly interpolated head position (displayed). */
    headPos: vec3;
    /** Smoothly interpolated head rotation (displayed). */
    headRot: quat;
    /** Target head position from latest network message. */
    targetHeadPos: vec3;
    /** Target head rotation from latest network message. */
    targetHeadRot: quat;
    /** Smoothly interpolated wrist position (displayed). */
    wristPos: vec3;
    /** Target wrist position from latest network message. */
    targetWristPos: vec3;
    /** Whether wrist data has been received at least once. */
    wristValid: boolean;
    /** Wrist/carousel container rotation (for orienting remote carousel). */
    targetWristRot: quat;
    /** Interpolated wrist rotation. */
    wristRot: quat;
    /** Whether wrist rotation has been received (so carousel follows hand orientation). */
    wristRotValid: boolean;
    /** Remote player's scanning state. */
    isScanning: boolean;
    /** Remote player's carousel visibility. */
    isCarouselVisible: boolean;
    /** Remote player level (from stats message). */
    playerLevel: number;
    /** Remote player prestige (from stats message). */
    playerPrestige: number;
    /** Remote player total XP (from stats message). */
    playerTotalXP: number;
    /** Remote player trust score 0-100 (from stats message). */
    playerTrustScore: number;
    headDebugObj: SceneObject | null;
    camDisplayObj: SceneObject | null;
    remoteCards: SceneObject[];
    remoteCardData: SimplifiedCard[];
    isCarouselShown: boolean;
    lastAppliedBadgeLevel: number;
    /** Carousel rotation angle (radians) from remote player — for positioning remote cards. */
    remoteCarouselAngleOffset: number;
}

// Card exchange request data sent over the network
interface CardGiveRequest {
    requesterConnId: string;
    requesterName: string;
    cardSerial: string;
    cardName: string;
}

@component
export class ConnectedLensManager extends BaseScriptComponent {

    // =====================================================================
    // INPUTS
    // =====================================================================
    @input
    @allowUndefined
    @hint('Cam Display object under Camera Object — shown to remote players when scanning')
    camDisplay: SceneObject;

    @input
    @allowUndefined
    @hint('Vertical Collector Card prefab — same as CollectionManager')
    verticalCardPrefab: ObjectPrefab;

    @input
    @allowUndefined
    @hint('Parent SceneObject for remote carousel cards (Remote Collection Root)')
    collectionRoot: SceneObject;

    @input
    @allowUndefined
    @hint('Head Debug Mesh — cube placed at remote player head position for testing')
    headDebugMesh: SceneObject;

    @input
    @allowUndefined
    @hint('Custom head mesh (e.g. different hat) — used only when local Snap username is GuillaumeDGNS')
    headDebugMeshCustom: SceneObject;

    @input
    @allowUndefined
    @hint('Height offset (cm) for Head Debug Mesh / hat above remote head. Positive = higher. Default: 0')
    headDebugHeightOffset: number = 0;

    @input
    @allowUndefined
    @hint('Depth offset (cm) for Head Debug Mesh / hat along head forward axis. Positive = forward, negative = backward. Default: 0')
    headDebugDepthOffset: number = 0;

    @input
    @allowUndefined
    @hint('Confirm Give Card container — shown when someone requests your card')
    confirmGiveContainer: SceneObject;

    @input
    @allowUndefined
    @hint('"Yes" button inside Confirm Give Card container')
    confirmGiveYesButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Cancel" button inside Confirm Give Card container')
    confirmGiveCancelButton: SceneObject;

    @input
    @allowUndefined
    @hint('Text component on Confirm Give Card — shows "Give [card] to [player]?"')
    confirmGiveText: Text;

    @input
    @allowUndefined
    @hint('Confirm Trade Card container — shown when a trade is proposed')
    confirmTradeContainer: SceneObject;

    @input
    @allowUndefined
    @hint('XP Container — positioned above remote player head to show their level/prestige')
    remotePlayerInfoContainer: SceneObject;

    @input
    @hint('Fallback public URL template for remote level badges. Use {level}. Example: https://.../level-badges/lvl-{level}.png')
    remoteLevelBadgeUrlTemplate: string = '';

    @input
    @hint('Pad digits for {level} in remote badge URL template. Example: 2 => 01, 50')
    remoteLevelBadgePadDigits: number = 2;

    @input
    @allowUndefined
    @hint('Height offset (cm) for the XP container above the remote player head. Default: 25. Lower = closer to head.')
    xpContainerHeightOffset: number = 25;

    @input
    @allowUndefined
    @hint('Left wrist anchor (Card Collection Container) — used to broadcast wrist position for remote carousel placement')
    wristAnchor: SceneObject;

    @input
    @allowUndefined
    @hint('World Mesh SceneObject — enabled during colocation scanning to visualize environment, disabled after')
    worldMesh: SceneObject;

    @input
    @allowUndefined
    @hint('Head rotation offset in degrees (X, Y, Z) — corrects mesh orientation vs camera. Default: (0, 180, 0). Adjust if hat appears upside down or sideways.')
    headRotationOffset: vec3;

    @input
    @allowUndefined
    @hint('Colocated Guidance Text — dedicated text element for colocation flow messages (child of Camera Object). Avoids conflicts with XP Display.')
    colocationGuidanceText: Text;

    // =====================================================================
    // CALLBACKS — Set by orchestrator (Car Scanner.ts)
    // =====================================================================
    onPlayerJoined: ((name: string) => void) | null = null;
    onPlayerLeft: ((name: string) => void) | null = null;
    /** Fires as soon as the session is connected (before colocation completes). */
    onSessionConnected: (() => void) | null = null;
    /** Fires when the full session is ready (colocation complete). */
    onSessionReady: (() => void) | null = null;
    /** Fires when the session fails (error or disconnect before ready). */
    onSessionFailed: ((reason: string) => void) | null = null;
    /** Fires when the session is lost mid-game (disconnect after ready). */
    onSessionLost: (() => void) | null = null;
    /** Fires when the user intentionally cancels the SnapOS session dialog. */
    onSessionCancelled: (() => void) | null = null;
    onShowMessage: ((text: string) => void) | null = null;
    /** Shows persistent colocation guidance (stays visible until hidden). */
    onShowGuidance: ((text: string) => void) | null = null;
    /** Hides the persistent colocation guidance. */
    onHideGuidance: (() => void) | null = null;
    onConnectButton: ((obj: SceneObject, cb: () => void, name: string) => boolean) | null = null;

    /** Called when a card is received from another player (with optional image). */
    onCardReceived: ((card: SimplifiedCard, imageB64?: string) => void) | null = null;
    /** Called when a card is given away — serial removed from persistent collection. */
    onCardGivenAway: ((serial: string) => void) | null = null;
    /** Called to retrieve a card image base64 from persistent storage. */
    onGetCardImageBase64: ((savedAt: number) => string | null) | null = null;
    /** Called to retrieve the savedAt timestamp for a card serial. */
    onGetSavedAtForSerial: ((serial: string) => number) | null = null;
    /** Called to check if local player owns a card serial (for give validation). */
    onHasCardSerial: ((serial: string) => boolean) | null = null;
    /** Called to load a brand logo onto a SceneObject (delegates to CollectionManager's BrandLogoLoader). */
    onLoadBrandLogo: ((logoObj: SceneObject, brand: string) => void) | null = null;
    /** Optional callback from XPManager to resolve level badge URL. */
    onGetLevelBadgeUrl: ((level: number) => string) | null = null;

    /** Returns local carousel visibility and angle (for syncing remote carousel rotation). */
    onGetCarouselState: (() => { visible: boolean; angle: number }) | null = null;
    /** Called when a local card is placed in world space (for network broadcast). */
    onCardPlacedInWorld: ((serial: string, pos: vec3, rot: quat, scale: number) => void) | null = null;
    /** Called when a local card is returned to the collection (for network broadcast). */
    onCardReturnedToCollection: ((serial: string) => void) | null = null;

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private sessionController: SessionController | null = null;
    private messaging: NetworkMessageWrapper<unknown> | null = null;

    private remotePlayers: Map<string, RemotePlayerData> = new Map();

    private _inSession: boolean = false;
    private _sessionReady: boolean = false;
    private _syncSetupDone: boolean = false;
    private _headSyncEvent: SceneEvent | null = null;
    private _frameCounter: number = 0;
    private _colocationGuidanceEvent: SceneEvent | null = null;
    private _colocationStage: string = 'waiting'; // waiting | scanning | anchor_found | aligning | ready | timeout
    private _colocationFallbackFired: boolean = false;
    // Phase system removed — colocation is handled by SessionController internally

    // Local player stats (broadcast to remote players)
    private _localLevel: number = 1;
    private _localPrestige: number = 0;
    private _localTotalXP: number = 0;
    private _localTrustScore: number = 80;

    // LocatedAt spatial alignment — set after colocation completes
    private _locatedAtComponent: LocatedAtComponent | null = null;

    // Pre-computed head rotation correction quaternion (built from headRotationOffset in onAwake)
    private _headRotCorrection: quat = quat.quatIdentity();

    // Card give state
    private pendingGiveRequest: CardGiveRequest | null = null;
    private giveButtonsConnected: boolean = false;
    private giveRequestTimestamp: number = 0;
    private readonly GIVE_REQUEST_TIMEOUT_MS = 30000; // 30 seconds

    // Network message IDs
    private readonly MESSAGE_NETWORK_ID = 'dgns_mp_msg';
    private readonly HEAD_UPDATE_EVENT = 'head_update';
    private readonly PLAYER_STATS_EVENT = 'player_stats';
    private readonly SCAN_STATE_EVENT = 'scan_state';
    private readonly CAROUSEL_DATA_EVENT = 'carousel_data';
    private readonly CAROUSEL_HIDE_EVENT = 'carousel_hide';
    private readonly CARD_GIVE_REQUEST_EVENT = 'card_give_request';
    private readonly CARD_GIVE_ACCEPTED_EVENT = 'card_give_accepted';
    private readonly CARD_GIVE_REJECTED_EVENT = 'card_give_rejected';
    private readonly CARD_IMAGE_EVENT = 'card_img';
    private readonly CARD_IMAGE_CHUNK_EVENT = 'card_img_chunk';
    private readonly CARD_IMAGE_TRANSFER_EVENT = 'card_img_xfer';
    private readonly CARD_IMAGE_CHUNK_XFER_EVENT = 'card_img_chunk_xfer';
    private readonly CARD_PLACED_EVENT = 'card_placed';
    private readonly CARD_RETURNED_EVENT = 'card_returned';
    private readonly CARD_GRAB_EVENT = 'card_grab';
    private readonly CARD_MOVE_EVENT = 'card_move';
    // COLOC_PHASE_EVENT removed — no custom phase protocol needed
    private readonly REMOTE_CAROUSEL_RADIUS = 3.5;
    private readonly REMOTE_CAROUSEL_RADIUS_WRIST = 3.5;
    private readonly REMOTE_CAROUSEL_HIDE_THRESHOLD = 0.5;
    private readonly REMOTE_CAROUSEL_TILT_DEG = 8;
    private readonly CUSTOM_HAT_SNAP_USERNAME = 'GuillaumeDGNS';
    private readonly HEAD_BROADCAST_INTERVAL = 3; // send every N frames
    private readonly HEAD_LERP_SPEED = 0.25; // interpolation factor per frame (0–1, higher = faster)
    private readonly IMAGE_CHUNK_SIZE = 85000; // chars per chunk (~85KB, within 100KB message limit)
    private readonly IMAGE_SEND_INTERVAL_MS = 60; // ms between image sends (rate limit safety)

    // Image chunk reassembly buffers (serial → chunks array + timestamp)
    private _imageChunkBuffers: Map<string, { total: number; chunks: string[]; ts: number }> = new Map();
    private _imageXferChunkBuffers: Map<string, { total: number; chunks: string[]; ts: number }> = new Map();
    private readonly CHUNK_TIMEOUT_MS: number = 30000;

    // Pending outgoing trade — holds the serial until the send is confirmed
    private _pendingOutgoingGiveSerial: string = '';
    private _pendingOutgoingGiveTimer: SceneEvent | null = null;

    // Remote card SceneObject → { ownerConnId, serial } mapping for trade interaction
    private _remoteCardMeta: Map<SceneObject, { connId: string; serial: string }> = new Map();

    // Pending image for a card trade (received from giver)
    private _pendingTradeImageB64: string = '';
    private _pendingTradeSerial: string = '';

    // Guard to prevent duplicate trade requests from the requester side
    private _pendingRequestSerial: string = '';

    // Remote world-placed cards: key = "connId_serial" → SceneObject clone
    private _remoteWorldCards: Map<string, SceneObject> = new Map();

    // Remote cards currently being grabbed/dragged: key = "connId_serial" → SceneObject
    private _remoteGrabbedCards: Map<string, SceneObject> = new Map();
    // Local billboard loop for cards currently grabbed by this user.
    private _localGrabBillboardEvents: Map<SceneObject, SceneEvent> = new Map();
    private remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule');
    private internetModule: InternetModule = require('LensStudio:InternetModule');
    private _remoteBadgeTextureCache: Map<number, Texture> = new Map();
    private _remoteBadgeLoading: Set<number> = new Set();
    private _remoteBadgePending: Map<number, Array<(tex: Texture) => void>> = new Map();

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        if (this.camDisplay) this.camDisplay.enabled = false;
        if (this.headDebugMesh) this.headDebugMesh.enabled = false;
        if (this.headDebugMeshCustom) this.headDebugMeshCustom.enabled = false;
        if (this.confirmGiveContainer) this.confirmGiveContainer.enabled = false;
        if (this.confirmTradeContainer) this.confirmTradeContainer.enabled = false;
        if (this.remotePlayerInfoContainer) this.remotePlayerInfoContainer.enabled = false;
        if (this.worldMesh) this.worldMesh.enabled = false;

        // Hide colocated guidance text at startup
        if (this.colocationGuidanceText) {
            const obj = this.colocationGuidanceText.getSceneObject();
            if (obj) {
                obj.enabled = false;
                print('ConnectedLensManager: colocationGuidanceText wired OK — "' + obj.name + '"');
            }
        } else {
            print('ConnectedLensManager: WARNING — colocationGuidanceText NOT wired!');
        }

        // Unparent Head Debug Mesh (and custom) from Camera Object so setWorldPosition/setWorldRotation
        // work directly in world space without fighting the local camera's moving transform.
        for (const mesh of [this.headDebugMesh, this.headDebugMeshCustom]) {
            if (!mesh) continue;
            try {
                const parent = mesh.getParent();
                if (parent) {
                    print('ConnectedLensManager: Unparenting ' + mesh.name + ' from "' + parent.name + '" to scene root');
                    mesh.setParent(this.getSceneObject());
                }
            } catch (e) {
                print('ConnectedLensManager: Could not unparent ' + mesh.name + ': ' + e);
            }
        }

        // Build head rotation correction using explicit quaternion math (no fromEulerAngles ambiguity).
        if (this.headRotationOffset) {
            this._headRotCorrection = this.eulerDegreesToQuat(
                this.headRotationOffset.x,
                this.headRotationOffset.y,
                this.headRotationOffset.z
            );
            print('ConnectedLensManager: Head rotation offset = ('
                + this.headRotationOffset.x + ', '
                + this.headRotationOffset.y + ', '
                + this.headRotationOffset.z + ') deg');
        } else {
            // Default: 180° Y rotation — explicit quat(w=0, x=0, y=1, z=0)
            this._headRotCorrection = new quat(0, 0, 1, 0);
            print('ConnectedLensManager: Using default head rotation offset (0, 180, 0) — explicit quat');
        }

        print('ConnectedLensManager: Initialized (colocated mode, waiting for startSession)');
    }

    /**
     * Converts Euler angles in degrees to a quaternion using explicit half-angle math.
     * Avoids any ambiguity with quat.fromEulerAngles (which may take degrees or radians).
     * Uses YXZ rotation order (standard for head/camera orientations).
     */
    private eulerDegreesToQuat(xDeg: number, yDeg: number, zDeg: number): quat {
        const xRad = xDeg * Math.PI / 180;
        const yRad = yDeg * Math.PI / 180;
        const zRad = zDeg * Math.PI / 180;
        const qx = new quat(Math.cos(xRad / 2), Math.sin(xRad / 2), 0, 0);
        const qy = new quat(Math.cos(yRad / 2), 0, Math.sin(yRad / 2), 0);
        const qz = new quat(Math.cos(zRad / 2), 0, 0, Math.sin(zRad / 2));
        return qy.multiply(qx).multiply(qz);
    }

    // =====================================================================
    // GUIDANCE — Internal methods using dedicated Colocated Guidance text
    // =====================================================================

    private showGuidance(text: string): void {
        if (this.colocationGuidanceText) {
            const obj = this.colocationGuidanceText.getSceneObject();
            if (obj) {
                obj.enabled = true;
                print('ConnectedLensManager: [GUIDANCE] Text SceneObject enabled');
            } else {
                print('ConnectedLensManager: [GUIDANCE] WARNING — getSceneObject() returned null');
            }
            this.colocationGuidanceText.text = text;
            try {
                this.colocationGuidanceText.textFill.color = new vec4(1, 1, 1, 1);
            } catch (e) { /* textFill not available */ }
            print('ConnectedLensManager: [GUIDANCE] Set text: "' + text.substring(0, 50) + '"');
        } else {
            print('ConnectedLensManager: [GUIDANCE] WARNING — colocationGuidanceText is null!');
        }
        if (this.onShowGuidance) this.onShowGuidance(text);
    }

    private hideGuidance(): void {
        if (this.colocationGuidanceText) {
            const obj = this.colocationGuidanceText.getSceneObject();
            if (obj) obj.enabled = false;
            this.colocationGuidanceText.text = '';
        }
        if (this.onHideGuidance) this.onHideGuidance();
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    startSession(): void {
        if (this._inSession) {
            print('ConnectedLensManager: Already in session');
            return;
        }
        this._inSession = true;
        print('ConnectedLensManager: Starting colocated session...');

        try {
            this.sessionController = SessionController.getInstance();
        } catch (e) {
            print('ConnectedLensManager: ERROR — SessionController not available: ' + e);
            if (this.onShowMessage) this.onShowMessage(t('connected_lens_unavail'));
            this._inSession = false;
            if (this.onSessionFailed) this.onSessionFailed('SessionController unavailable');
            return;
        }

        this.listenToSessionEvents();
        this.sessionController.init();
        print('ConnectedLensManager: SessionController.init() called — waiting for SnapOS session dialog');
    }

    /** Notifies the network that the local player is scanning. */
    setLocalScanning(isScanning: boolean): void {
        if (!this._syncSetupDone || !this.messaging) return;
        try {
            this.messaging.sendMessage(this.SCAN_STATE_EVENT, JSON.stringify({ scanning: isScanning }) as any, true);
        } catch (e) { /* session not ready yet */ }
    }

    /** Notifies the network that the local player's carousel is visible. Sends cards + angle so remote sees rotation. */
    setLocalCarouselVisible(visible: boolean, cardData?: SimplifiedCard[], carouselAngle?: number): void {
        if (!this._syncSetupDone || !this.messaging) return;

        if (visible && cardData && cardData.length > 0) {
            try {
                const payload = { cards: cardData, angle: typeof carouselAngle === 'number' ? carouselAngle : 0 };
                const jsonStr = JSON.stringify(payload);
                this.messaging.sendMessage(this.CAROUSEL_DATA_EVENT, jsonStr as any, true);
                print('ConnectedLensManager: Sent carousel data (' + cardData.length + ' cards, angle=' + (payload.angle.toFixed(2)) + ')');
            } catch (e) {
                print('ConnectedLensManager: Error sending carousel data: ' + e);
            }

            // Send card images progressively (one per IMAGE_SEND_INTERVAL_MS)
            this.sendCarouselImages(cardData);
        } else if (!visible) {
            try {
                this.messaging.sendMessage(this.CAROUSEL_HIDE_EVENT, '{}' as any, true);
                print('ConnectedLensManager: Sent carousel hide — remote collection should close');
            } catch (e) { /* ignore */ }
        }
    }

    /**
     * Sends card images progressively for the carousel.
     * For each card, reads the stored base64 and sends it via CARD_IMAGE or chunked.
     * Staggers sends to respect the 350 msg / 5s rate limit.
     */
    private sendCarouselImages(cards: SimplifiedCard[]): void {
        let sendIndex = 0;

        const sendNext = () => {
            if (sendIndex >= cards.length) return;
            if (!this.messaging || !this._syncSetupDone) return;

            const card = cards[sendIndex];
            sendIndex++;

            if (!card.savedAt) {
                // Schedule next send
                this.createEvent('DelayedCallbackEvent').bind(() => sendNext());
                return;
            }

            let b64: string | null = null;
            if (this.onGetCardImageBase64) {
                b64 = this.onGetCardImageBase64(card.savedAt);
            }

            if (!b64 || b64.length === 0) {
                this.createEvent('DelayedCallbackEvent').bind(() => sendNext());
                return;
            }

            this.sendCardImage(card.serial, b64, this.CARD_IMAGE_EVENT, this.CARD_IMAGE_CHUNK_EVENT);
            print('ConnectedLensManager: Sent image for ' + card.brand_model
                + ' (' + b64.length + ' chars)');

            // Delay next send
            const delayEvent = this.createEvent('DelayedCallbackEvent');
            (delayEvent as any).reset(this.IMAGE_SEND_INTERVAL_MS / 1000);
            delayEvent.bind(() => sendNext());
        };

        // Start with a tiny delay to let carousel metadata arrive first
        const startDelay = this.createEvent('DelayedCallbackEvent');
        (startDelay as any).reset(0.1);
        startDelay.bind(() => sendNext());
    }

    /**
     * Sends a single card's image over the network.
     * If it fits in one message (<IMAGE_CHUNK_SIZE), sends as a single event.
     * Otherwise, chunks it into multiple messages.
     */
    private sendCardImage(serial: string, b64: string, singleEvent: string, chunkEvent: string): void {
        if (!this.messaging) return;

        if (b64.length <= this.IMAGE_CHUNK_SIZE) {
            // Fits in one message
            try {
                const payload = JSON.stringify({ serial: serial, b64: b64 });
                this.messaging.sendMessage(singleEvent, payload as any, true);
            } catch (e) {
                print('ConnectedLensManager: Error sending card image: ' + e);
            }
        } else {
            // Chunk it
            const totalChunks = Math.ceil(b64.length / this.IMAGE_CHUNK_SIZE);
            for (let i = 0; i < totalChunks; i++) {
                try {
                    const chunk = b64.substring(i * this.IMAGE_CHUNK_SIZE, (i + 1) * this.IMAGE_CHUNK_SIZE);
                    const payload = JSON.stringify({
                        serial: serial,
                        idx: i,
                        total: totalChunks,
                        data: chunk,
                    });
                    this.messaging.sendMessage(chunkEvent, payload as any, true);
                } catch (e) {
                    print('ConnectedLensManager: Error sending chunk ' + i + '/' + totalChunks + ': ' + e);
                }
            }
            print('ConnectedLensManager: Sent image in ' + totalChunks + ' chunks for serial ' + serial);
        }
    }

    /** Updates the local player's stats broadcast to remote players. */
    setLocalPlayerStats(level: number, prestige: number, totalXP: number, trustScore?: number): void {
        this._localLevel = level;
        this._localPrestige = prestige;
        this._localTotalXP = totalXP;
        if (typeof trustScore === 'number') this._localTrustScore = trustScore;
        this.broadcastPlayerStats();
    }

    getConnectedPlayerCount(): number {
        return this.remotePlayers.size;
    }

    isInSession(): boolean {
        return this._inSession && this._syncSetupDone;
    }

    // =====================================================================
    // SESSION EVENTS
    // =====================================================================

    private listenToSessionEvents(): void {
        if (!this.sessionController) return;

        // Session connected — fires immediately, BEFORE colocation.
        // All sync infrastructure is set up here.
        this.sessionController.onConnected.add(
            (_session: MultiplayerSession, _connectionInfo: ConnectedLensModule.ConnectionInfo) => {
                print('ConnectedLensManager: Session connected — setting up messaging...');
                this.onSessionConnected_internal();
                if (this.onSessionConnected) this.onSessionConnected();
            }
        );

        // Colocation diagnostic events
        this.sessionController.notifyOnStartColocated(() => {
            print('ConnectedLensManager: [COLOCATION] Colocated setup STARTED — scanning environment');
            this._colocationStage = 'scanning';
        });

        this.sessionController.notifyOnMapExists(() => {
            print('ConnectedLensManager: [COLOCATION] Map exists — spatial anchor found (stage=' + this._colocationStage + ')');
            this._colocationStage = 'anchor_found';
        });

        this.sessionController.notifyOnLocatedAtFound(() => {
            print('ConnectedLensManager: [COLOCATION] Located At Found — aligning coordinate systems (stage=' + this._colocationStage + ')');
            this._colocationStage = 'aligning';
        });

        // Session fully ready (colocation handshake complete)
        this.sessionController.notifyOnReady(() => this.onSessionReady_internal());

        // User events
        this.sessionController.onUserJoinedSession.add(
            (_session: MultiplayerSession, userInfo: ConnectedLensModule.UserInfo) => {
                this.handleUserJoined(userInfo);
            }
        );

        this.sessionController.onUserLeftSession.add(
            (_session: MultiplayerSession, userInfo: ConnectedLensModule.UserInfo) => {
                this.handleUserLeft(userInfo);
            }
        );

        // Connection failed (pre-session) — includes CancelledByUser
        this.sessionController.onConnectionFailed.add(
            (code: string, description: string) => {
                if (code === 'CancelledByUser') {
                    print('ConnectedLensManager: User cancelled session dialog');
                    this._inSession = false;
                    if (this.onSessionCancelled) {
                        this.onSessionCancelled();
                    } else if (this.onSessionFailed) {
                        this.onSessionFailed('cancelled');
                    }
                } else {
                    print('ConnectedLensManager: Connection failed: ' + code + ' — ' + description);
                    if (this.onShowMessage) this.onShowMessage(tf('connection_failed', { desc: description }));
                    this._inSession = false;
                    if (this.onSessionFailed) {
                        this.onSessionFailed('connection_failed: ' + code + ' — ' + description);
                    }
                }
            }
        );

        // Errors (in-session)
        this.sessionController.onError.add(
            (_session: MultiplayerSession, code: string, description: string) => {
                print('ConnectedLensManager: Session error: ' + code + ' — ' + description);
                if (this.onShowMessage) this.onShowMessage(tf('session_error', { desc: description }));
                this.stopColocationGuidance();
                this.hideGuidance();
                if (!this._sessionReady && this.onSessionFailed) {
                    this.onSessionFailed('error: ' + code + ' — ' + description);
                }
            }
        );

        // Disconnect
        this.sessionController.onDisconnected.add(
            (_session: MultiplayerSession, disconnectInfo: string) => {
                print('ConnectedLensManager: Disconnected: ' + disconnectInfo);
                if (this.onShowMessage) this.onShowMessage(t('disconnected'));
                this.stopColocationGuidance();
                this.hideGuidance();
                this.cleanupRemotePlayers();
                const wasReady = this._sessionReady;
                this._sessionReady = false;
                this._inSession = false;
                this._syncSetupDone = false;
                if (wasReady) {
                    if (this.onSessionLost) this.onSessionLost();
                } else {
                    if (this.onSessionFailed) this.onSessionFailed('disconnected');
                }
            }
        );
    }

    // =====================================================================
    // SESSION CONNECTED — Set up messaging + head tracking (pre-colocation)
    // =====================================================================

    private onSessionConnected_internal(): void {
        if (this._syncSetupDone) return;
        this._syncSetupDone = true;

        print('ConnectedLensManager: Setting up message-based sync (no SyncEntity needed)...');

        this.setupMessaging();
        this.setupGiveButtons();
        this.startHeadSync();

        // Track players already in the session
        const users = this.sessionController.getUsers();
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            if (!this.sessionController.isLocalUserConnection(user)) {
                this.handleUserJoined(user);
            }
        }

        // Broadcast initial stats
        this.broadcastPlayerStats();

        // Start colocation guidance — remind user to scan the room
        this.startColocationGuidance();

        print('ConnectedLensManager: Sync setup complete — local user: '
            + (this.sessionController.getLocalUserName() || 'unknown'));
    }

    // =====================================================================
    // SESSION READY — Colocation complete
    // =====================================================================

    private onSessionReady_internal(): void {
        if (this._sessionReady) return; // Prevent double call if fallback already fired

        print('ConnectedLensManager: Session FULLY READY (colocated space aligned)');
        this._sessionReady = true;
        this._colocationStage = 'ready';

        // Grab the LocatedAtComponent for spatial alignment
        try {
            if (this.sessionController) {
                this._locatedAtComponent = this.sessionController.getLocatedAtComponent();
                if (this._locatedAtComponent) {
                    print('ConnectedLensManager: LocatedAtComponent acquired for spatial alignment');
                } else {
                    print('ConnectedLensManager: WARNING — No LocatedAtComponent available — positions will not be spatially aligned');
                    if (this.onShowMessage) this.onShowMessage(t('coloc_no_located_warn'));
                }
            }
        } catch (e) {
            print('ConnectedLensManager: Could not get LocatedAtComponent: ' + e);
            if (this.onShowMessage) this.onShowMessage(t('coloc_no_located_warn'));
        }

        // In case onConnected didn't fire yet (edge case), setup now
        this.onSessionConnected_internal();

        // Stop colocation guidance — show success
        this.stopColocationGuidance();
        this.showGuidance(t('all_synced'));

        // Hide the success message after 2.5 seconds, then trigger onSessionReady (shows Car Scan Interface)
        if (!this._colocationFallbackFired) {
            const readyEvent = this.createEvent('DelayedCallbackEvent');
            (readyEvent as any).bind(() => {
                this.hideGuidance();
                if (this.onSessionReady) this.onSessionReady();
            });
            (readyEvent as any).reset(2.5);
        } else {
            const hideEvent = this.createEvent('DelayedCallbackEvent');
            (hideEvent as any).bind(() => {
                this.hideGuidance();
            });
            (hideEvent as any).reset(2.5);
        }
    }

    // =====================================================================
    // LOCATEDAT SPATIAL CONVERSION
    // Converts between local world coordinates and the shared LocatedAt space.
    // Before colocation completes, passthrough (no conversion).
    // =====================================================================

    private worldPosToLocated(pos: vec3): vec3 {
        if (!this._locatedAtComponent) return pos;
        try {
            const invMat = this._locatedAtComponent.getTransform().getInvertedWorldTransform();
            return invMat.multiplyPoint(pos);
        } catch (e) { return pos; }
    }

    private locatedPosToWorld(pos: vec3): vec3 {
        if (!this._locatedAtComponent) return pos;
        try {
            const mat = this._locatedAtComponent.getTransform().getWorldTransform();
            return mat.multiplyPoint(pos);
        } catch (e) { return pos; }
    }

    private worldRotToLocated(r: quat): quat {
        if (!this._locatedAtComponent) return r;
        try {
            const invRot = this._locatedAtComponent.getTransform().getWorldRotation().invert();
            return invRot.multiply(r);
        } catch (e) { return r; }
    }

    private locatedRotToWorld(r: quat): quat {
        if (!this._locatedAtComponent) return r;
        try {
            const locRot = this._locatedAtComponent.getTransform().getWorldRotation();
            return locRot.multiply(r);
        } catch (e) { return r; }
    }

    // =====================================================================
    // COLOCATION GUIDANCE — Guide players through spatial calibration
    // Per Snap docs: "The first user establishes the shared coordinate space
    // automatically. Subsequent players are guided to look at a friend who
    // has already colocated to align their space with theirs."
    // https://developers.snap.com/spectacles/about-spectacles-features/connected-lenses/using-connected-lenses
    // =====================================================================

    private readonly COLOCATION_TIMEOUT_SEC = 60;
    private readonly GUIDANCE_INTERVAL_SEC = 10;

    private startColocationGuidance(): void {
        if (this._sessionReady) return;
        if (this._colocationGuidanceEvent) return;

        const isHost = this.sessionController ? this.sessionController.isHost() : null;
        print('ConnectedLensManager: Starting colocation guidance — isHost=' + isHost);

        if (this.worldMesh) {
            this.worldMesh.enabled = true;
            print('ConnectedLensManager: World Mesh enabled for colocation scanning');
        }

        const guidanceMessages = getColocationGuidanceMessages();
        this.showGuidance(guidanceMessages[0]);

        let reminderCount = 0;
        const startTime = getTime();
        let lastMessageTime = startTime;
        this._colocationGuidanceEvent = this.createEvent('UpdateEvent');
        (this._colocationGuidanceEvent as any).bind(() => {
            if (this._sessionReady) {
                this.stopColocationGuidance();
                return;
            }

            const now = getTime();
            const elapsedSec = Math.round(now - startTime);

            if (now - lastMessageTime >= this.GUIDANCE_INTERVAL_SEC) {
                lastMessageTime = now;
                reminderCount++;

                const msg = guidanceMessages[reminderCount % guidanceMessages.length];
                const remaining = Math.max(0, this.COLOCATION_TIMEOUT_SEC - elapsedSec);
                const countdown = remaining > 0 ? '\n(' + elapsedSec + 's / ' + this.COLOCATION_TIMEOUT_SEC + 's)' : '';
                this.showGuidance(msg + countdown);
                print('ConnectedLensManager: [COLOCATION] ' + msg + ' — stage=' + this._colocationStage + ' elapsed=' + elapsedSec + 's');
            }

            if (elapsedSec >= this.COLOCATION_TIMEOUT_SEC && !this._colocationFallbackFired) {
                this._colocationFallbackFired = true;
                print('ConnectedLensManager: [COLOCATION] Timeout reached (' + elapsedSec + 's)'
                    + ' — stage=' + this._colocationStage
                    + ' hasLocatedAt=' + (this._locatedAtComponent !== null));

                this.stopColocationGuidance();
                this.showGuidance(t('sync_timeout'));

                const fallbackEvent = this.createEvent('DelayedCallbackEvent');
                (fallbackEvent as any).bind(() => {
                    this.hideGuidance();
                    if (!this._sessionReady) {
                        if (!this._locatedAtComponent) {
                            print('ConnectedLensManager: [COLOCATION] Fallback WITHOUT LocatedAt — spatial alignment will be broken');
                            if (this.onShowMessage) this.onShowMessage(t('coloc_no_located_warn'));
                        }
                        if (this.onSessionReady) {
                            print('ConnectedLensManager: [COLOCATION] Fallback — triggering onSessionReady');
                            this.onSessionReady();
                        }
                    }
                });
                (fallbackEvent as any).reset(2.5);
            }
        });
    }

    private stopColocationGuidance(): void {
        if (this._colocationGuidanceEvent) {
            (this._colocationGuidanceEvent as any).enabled = false;
            this._colocationGuidanceEvent = null;
            print('ConnectedLensManager: Colocation guidance stopped');
        }
        if (this.worldMesh) {
            this.worldMesh.enabled = false;
            print('ConnectedLensManager: World Mesh disabled');
        }
    }

    // broadcastColocPhase and onRemoteColocPhase removed — colocation is handled
    // entirely by SessionController internally. No custom phase protocol needed.

    // =====================================================================
    // MESSAGING SETUP — All network events handled here
    // =====================================================================

    private setupMessaging(): void {
        this.messaging = new NetworkMessageWrapper(this.MESSAGE_NETWORK_ID);

        // Head position updates from remote players
        this.messaging.onRemoteEventReceived.getWrapper(this.HEAD_UPDATE_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteHeadUpdate(msg)
        );

        // Player stats from remote players
        this.messaging.onRemoteEventReceived.getWrapper(this.PLAYER_STATS_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemotePlayerStats(msg)
        );

        // Scan state from remote players
        this.messaging.onRemoteEventReceived.getWrapper(this.SCAN_STATE_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteScanState(msg)
        );

        // Carousel events
        this.messaging.onRemoteEventReceived.getWrapper(this.CAROUSEL_DATA_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCarouselData(msg)
        );
        this.messaging.onRemoteEventReceived.getWrapper(this.CAROUSEL_HIDE_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCarouselHide(msg)
        );

        // Card exchange events
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_GIVE_REQUEST_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onCardGiveRequestReceived(msg)
        );
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_GIVE_ACCEPTED_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onCardGiveAccepted(msg)
        );
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_GIVE_REJECTED_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onCardGiveRejected(msg)
        );

        // Card image events (carousel images sent individually per card)
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_IMAGE_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCardImage(msg)
        );
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_IMAGE_CHUNK_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCardImageChunk(msg)
        );

        // Card image transfer events (image sent after trade acceptance)
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_IMAGE_TRANSFER_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onCardImageTransfer(msg)
        );
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_IMAGE_CHUNK_XFER_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onCardImageChunkTransfer(msg)
        );

        // Card grab/move events (real-time card dragging visible to remote player)
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_GRAB_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCardGrabbed(msg)
        );
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_MOVE_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCardMoved(msg)
        );

        // World-placed card events (card taken from carousel and placed in space)
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_PLACED_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCardPlaced(msg)
        );
        this.messaging.onRemoteEventReceived.getWrapper(this.CARD_RETURNED_EVENT, true).add(
            (msg: NetworkMessage<unknown>) => this.onRemoteCardReturned(msg)
        );

        print('ConnectedLensManager: Messaging set up (head + stats + carousel + images + card exchange + world cards)');
    }

    // =====================================================================
    // HEAD SYNC — Broadcast local head position + update remote players
    // =====================================================================

    private startHeadSync(): void {
        if (this._headSyncEvent) return;

        this._headSyncEvent = this.createEvent('UpdateEvent');
        (this._headSyncEvent as any).bind(() => {
            this._frameCounter++;
            this.broadcastLocalHead();
            this.updateRemotePlayers();
            this.checkGiveRequestTimeout();
            if (this._frameCounter % 150 === 0) this.purgeStaleChunkBuffers();
        });
    }

    /** Broadcasts local head position/rotation + wrist position to all remote players (throttled). */
    private _headBroadcastLogOnce: boolean = false;
    private _headBroadcastWarnedOnce: boolean = false;
    private broadcastLocalHead(): void {
        if (this._frameCounter % this.HEAD_BROADCAST_INTERVAL !== 0) return;
        if (!this.messaging || !this.camDisplay) return;

        // Skip broadcasting if LocatedAtComponent is not yet available.
        // Without it, raw world positions are meaningless between devices.
        if (!this._locatedAtComponent) {
            if (!this._headBroadcastWarnedOnce && this._frameCounter > 30) {
                this._headBroadcastWarnedOnce = true;
                print('ConnectedLensManager: [HEAD] Skipping broadcast — LocatedAtComponent not available yet');
            }
            return;
        }

        try {
            const camParent = this.camDisplay.getParent();
            if (!camParent) return;

            const camTransform = camParent.getTransform();
            const worldPos = camTransform.getWorldPosition();
            const worldRot = camTransform.getWorldRotation();

            const pos = this.worldPosToLocated(worldPos);
            const rot = this.worldRotToLocated(worldRot);

            const payload: any = {
                px: pos.x, py: pos.y, pz: pos.z,
                rx: rot.x, ry: rot.y, rz: rot.z, rw: rot.w,
            };

            if (this.wristAnchor) {
                try {
                    const wristTransform = this.wristAnchor.getTransform();
                    const wristWorldPos = wristTransform.getWorldPosition();
                    const wristWorldRot = wristTransform.getWorldRotation();
                    const wristPos = this.worldPosToLocated(wristWorldPos);
                    const wristRot = this.worldRotToLocated(wristWorldRot);
                    payload.wx = wristPos.x;
                    payload.wy = wristPos.y;
                    payload.wz = wristPos.z;
                    payload.wrx = wristRot.x;
                    payload.wry = wristRot.y;
                    payload.wrz = wristRot.z;
                    payload.wrw = wristRot.w;
                } catch (e) { /* wrist not tracked */ }
            }

            if (this.onGetCarouselState) {
                const state = this.onGetCarouselState();
                payload.carouselVisible = state.visible;
                if (state.visible && typeof state.angle === 'number') {
                    payload.carouselAngle = state.angle;
                }
            }

            if (!this._headBroadcastLogOnce) {
                this._headBroadcastLogOnce = true;
                print('ConnectedLensManager: [DEBUG] First head broadcast — worldPos=('
                    + worldPos.x.toFixed(2) + ',' + worldPos.y.toFixed(2) + ',' + worldPos.z.toFixed(2)
                    + ') locatedPos=('
                    + pos.x.toFixed(2) + ',' + pos.y.toFixed(2) + ',' + pos.z.toFixed(2)
                    + ') hasLocatedAt=true');
            }

            const data = JSON.stringify(payload);
            this.messaging.sendMessage(this.HEAD_UPDATE_EVENT, data as any, true);
        } catch (e) {
            // Session might not be fully ready yet — ignore
        }
    }

    /** Broadcasts local player stats to remote players. */
    private broadcastPlayerStats(): void {
        if (!this.messaging) return;
        try {
            const data = JSON.stringify({
                level: this._localLevel,
                prestige: this._localPrestige,
                totalXP: this._localTotalXP,
                trustScore: this._localTrustScore,
            });
            this.messaging.sendMessage(this.PLAYER_STATS_EVENT, data as any, true);
        } catch (e) { /* not connected yet */ }
    }

    // =====================================================================
    // INCOMING MESSAGE HANDLERS
    // =====================================================================

    private _headUpdateLogCount: number = 0;
    private onRemoteHeadUpdate(msg: NetworkMessage<unknown>): void {
        const connId = msg.senderConnectionId;
        const player = this.remotePlayers.get(connId);
        if (!player) return;

        try {
            const d = JSON.parse(msg.data as string);

            // Data arrives in LocatedAt space — convert back to local world
            const locPos = new vec3(d.px, d.py, d.pz);
            const locRot = new quat(d.rw, d.rx, d.ry, d.rz);
            player.targetHeadPos = this.locatedPosToWorld(locPos);
            player.targetHeadRot = this.locatedRotToWorld(locRot);

            // Wrist position (backwards-compatible — only if present)
            if (d.wx !== undefined && d.wy !== undefined && d.wz !== undefined) {
                const locWrist = new vec3(d.wx, d.wy, d.wz);
                player.targetWristPos = this.locatedPosToWorld(locWrist);
                player.wristValid = true;
            }

            if (typeof d.carouselAngle === 'number') {
                player.remoteCarouselAngleOffset = d.carouselAngle;
            }
            if (d.carouselVisible === false) {
                player.isCarouselVisible = false;
            }

            if (d.wrx !== undefined && d.wry !== undefined && d.wrz !== undefined && d.wrw !== undefined) {
                const locWristRot = new quat(d.wrw, d.wrx, d.wry, d.wrz);
                player.targetWristRot = this.locatedRotToWorld(locWristRot);
                player.wristRotValid = true;
            }

            // Log first 3 head updates received for diagnostics
            if (this._headUpdateLogCount < 3) {
                this._headUpdateLogCount++;
                print('ConnectedLensManager: [DEBUG] Head update #' + this._headUpdateLogCount
                    + ' from ' + player.displayName
                    + ' locatedPos=(' + d.px.toFixed(2) + ',' + d.py.toFixed(2) + ',' + d.pz.toFixed(2) + ')'
                    + ' worldPos=(' + player.targetHeadPos.x.toFixed(2) + ',' + player.targetHeadPos.y.toFixed(2) + ',' + player.targetHeadPos.z.toFixed(2) + ')'
                    + ' hasLocatedAt=' + (this._locatedAtComponent !== null));
            }
        } catch (e) { /* bad data */ }
    }

    private onRemotePlayerStats(msg: NetworkMessage<unknown>): void {
        const connId = msg.senderConnectionId;
        const player = this.remotePlayers.get(connId);
        if (!player) return;

        try {
            const d = JSON.parse(msg.data as string);
            player.playerLevel = d.level || 1;
            player.playerPrestige = d.prestige || 0;
            player.playerTotalXP = d.totalXP || 0;
            player.playerTrustScore = typeof d.trustScore === 'number' ? d.trustScore : 80;
            print('ConnectedLensManager: Updated stats for ' + player.displayName
                + ' — LVL ' + player.playerLevel + ' P' + player.playerPrestige
                + ' Trust ' + player.playerTrustScore + '%');
        } catch (e) { /* bad data */ }
    }

    private onRemoteScanState(msg: NetworkMessage<unknown>): void {
        const connId = msg.senderConnectionId;
        const player = this.remotePlayers.get(connId);
        if (!player) return;

        try {
            const d = JSON.parse(msg.data as string);
            player.isScanning = !!d.scanning;
        } catch (e) { /* bad data */ }
    }

    // =====================================================================
    // REMOTE PLAYER MANAGEMENT
    // =====================================================================

    private handleUserJoined(userInfo: ConnectedLensModule.UserInfo): void {
        if (this.sessionController.isLocalUserConnection(userInfo)) return;

        const connId = userInfo.connectionId;
        if (this.remotePlayers.has(connId)) return;

        const displayName = userInfo.displayName || 'Player';
        print('ConnectedLensManager: Player joined: ' + displayName + ' (' + connId + ')');

        const playerData: RemotePlayerData = {
            connectionId: connId,
            displayName: displayName,
            headPos: vec3.zero(),
            headRot: quat.quatIdentity(),
            targetHeadPos: vec3.zero(),
            targetHeadRot: quat.quatIdentity(),
            wristPos: vec3.zero(),
            targetWristPos: vec3.zero(),
            wristValid: false,
            targetWristRot: quat.quatIdentity(),
            wristRot: quat.quatIdentity(),
            wristRotValid: false,
            isScanning: false,
            isCarouselVisible: false,
            playerLevel: 1,
            playerPrestige: 0,
            playerTotalXP: 0,
            playerTrustScore: 80,
            headDebugObj: null,
            camDisplayObj: null,
            remoteCards: [],
            remoteCardData: [],
            isCarouselShown: false,
            lastAppliedBadgeLevel: -1,
            remoteCarouselAngleOffset: 0,
        };

        this.remotePlayers.set(connId, playerData);
        this.assignHeadDebugMesh(playerData);

        // Broadcast our stats to the new player
        this.broadcastPlayerStats();

        if (this.onPlayerJoined) this.onPlayerJoined(displayName);
        if (this.onShowMessage) this.onShowMessage(tf('player_joined', { name: displayName }));
    }

    private handleUserLeft(userInfo: ConnectedLensModule.UserInfo): void {
        const connId = userInfo.connectionId;
        const player = this.remotePlayers.get(connId);
        if (!player) return;

        print('ConnectedLensManager: Player left: ' + player.displayName);

        // Cancel any pending card exchange with this player
        if (this.pendingGiveRequest && this.pendingGiveRequest.requesterConnId === connId) {
            print('ConnectedLensManager: Cancelling pending give request — requester disconnected');
            this.pendingGiveRequest = null;
            if (this.confirmGiveContainer) this.confirmGiveContainer.enabled = false;
        }

        // If we were giving a card to this player and they disconnected, cancel the removal
        if (this._pendingOutgoingGiveSerial.length > 0) {
            print('ConnectedLensManager: Receiver disconnected — cancelling card removal for ' + this._pendingOutgoingGiveSerial);
            if (this._pendingOutgoingGiveTimer) {
                try { this._pendingOutgoingGiveTimer.enabled = false; } catch (e) { /* ignore */ }
                this._pendingOutgoingGiveTimer = null;
            }
            if (this.onShowMessage) this.onShowMessage(t('trade_cancelled_dc'));
            this._pendingOutgoingGiveSerial = '';
        }

        this.destroyRemoteCarousel(player);
        if (player.camDisplayObj) {
            try { player.camDisplayObj.destroy(); } catch (e) { /* ignore */ }
        }
        if (player.headDebugObj) {
            player.headDebugObj.enabled = false;
            player.headDebugObj = null;
        }

        this.remotePlayers.delete(connId);

        if (this.onPlayerLeft) this.onPlayerLeft(player.displayName);
        if (this.onShowMessage) this.onShowMessage(tf('player_left', { name: player.displayName }));
    }

    private assignHeadDebugMesh(player: RemotePlayerData): void {
        const localName = (this.sessionController ? this.sessionController.getLocalUserName() || '' : '').toLowerCase();
        const useCustom = (localName === this.CUSTOM_HAT_SNAP_USERNAME.toLowerCase()) && this.headDebugMeshCustom;
        const mesh = useCustom ? this.headDebugMeshCustom : this.headDebugMesh;
        if (!mesh) return;
        if (this.headDebugMesh) this.headDebugMesh.enabled = false;
        if (this.headDebugMeshCustom) this.headDebugMeshCustom.enabled = false;
        player.headDebugObj = mesh;
        mesh.enabled = true;
        print('ConnectedLensManager: Head Debug Mesh' + (useCustom ? ' (custom)' : '') + ' assigned to ' + player.displayName);
    }

    // =====================================================================
    // PER-FRAME UPDATE — Position remote players from cached message data
    // =====================================================================

    private updateRemotePlayers(): void {
        let firstRemotePlayer: RemotePlayerData | null = null;
        const t = this.HEAD_LERP_SPEED;

        this.remotePlayers.forEach((player: RemotePlayerData, _key: string) => {
            // Smoothly interpolate towards the target received from network
            player.headPos = vec3.lerp(player.headPos, player.targetHeadPos, t);
            player.headRot = quat.slerp(player.headRot, player.targetHeadRot, t);

            // Interpolate wrist position and rotation
            if (player.wristValid) {
                player.wristPos = vec3.lerp(player.wristPos, player.targetWristPos, t);
            }
            if (player.wristRotValid) {
                player.wristRot = quat.slerp(player.wristRot, player.targetWristRot, t);
            }

            const remotePos = player.headPos;
            const remoteRot = player.headRot;

            // Periodic debug log for head/wrist tracking (every ~2 seconds)
            if (this._frameCounter % 60 === 0) {
                print('ConnectedLensManager: [DEBUG] ' + player.displayName
                    + ' head=(' + remotePos.x.toFixed(1) + ',' + remotePos.y.toFixed(1) + ',' + remotePos.z.toFixed(1) + ')'
                    + ' wrist=' + (player.wristValid
                        ? '(' + player.wristPos.x.toFixed(1) + ',' + player.wristPos.y.toFixed(1) + ',' + player.wristPos.z.toFixed(1) + ')'
                        : 'N/A')
                    + ' debugObj=' + (player.headDebugObj ? 'yes' : 'no'));
            }

            // Position head debug mesh with rotation correction
            if (player.headDebugObj && player.headDebugObj.enabled) {
                const debugTransform = player.headDebugObj.getTransform();
                const correctedRot = remoteRot.multiply(this._headRotCorrection);
                const headForward = correctedRot.multiplyVec3(vec3.forward()).normalize();
                const offsetPos = new vec3(
                    remotePos.x,
                    remotePos.y + this.headDebugHeightOffset,
                    remotePos.z
                ).add(headForward.uniformScale(this.headDebugDepthOffset));
                debugTransform.setWorldPosition(offsetPos);
                debugTransform.setWorldRotation(correctedRot);

                // Log rotation details every ~3 seconds for debugging hat orientation
                if (this._frameCounter % 90 === 1) {
                    print('ConnectedLensManager: [HEAD ROT] raw=('
                        + remoteRot.w.toFixed(3) + ',' + remoteRot.x.toFixed(3) + ','
                        + remoteRot.y.toFixed(3) + ',' + remoteRot.z.toFixed(3)
                        + ') corrected=('
                        + correctedRot.w.toFixed(3) + ',' + correctedRot.x.toFixed(3) + ','
                        + correctedRot.y.toFixed(3) + ',' + correctedRot.z.toFixed(3)
                        + ') correction=('
                        + this._headRotCorrection.w.toFixed(3) + ',' + this._headRotCorrection.x.toFixed(3) + ','
                        + this._headRotCorrection.y.toFixed(3) + ',' + this._headRotCorrection.z.toFixed(3) + ')');
                }
            }

            // Track first player with valid position for XP container
            if (!firstRemotePlayer && remotePos.length > 0.01) {
                firstRemotePlayer = player;
            }

            // Show/hide cam display when scanning
            if (this.camDisplay) {
                if (player.isScanning) {
                    this.camDisplay.enabled = true;
                    const camTransform = this.camDisplay.getTransform();
                    const forward = remoteRot.multiplyVec3(vec3.forward());
                    const camPos = remotePos.add(forward.uniformScale(0.3));
                    camTransform.setWorldPosition(camPos);
                    camTransform.setWorldRotation(remoteRot);
                } else {
                    this.camDisplay.enabled = false;
                }
            }

            // Handle carousel visibility changes
            if (player.isCarouselVisible && !player.isCarouselShown) {
                player.isCarouselShown = true;
            } else if (!player.isCarouselVisible && player.isCarouselShown) {
                player.isCarouselShown = false;
                this.destroyRemoteCarousel(player);
            }

            // Dynamic follow: reposition carousel cards as wrist/head moves
            if (player.isCarouselShown && player.remoteCards.length > 0) {
                this.repositionRemoteCarousel(player);
            }
        });

        // Position remote player info container above the first remote player
        this.updateRemotePlayerInfoContainer(firstRemotePlayer);
    }

    /** Positions the XP/level info container above a remote player's head. */
    private updateRemotePlayerInfoContainer(player: RemotePlayerData | null): void {
        if (!this.remotePlayerInfoContainer) return;

        if (!player || player.headPos.length < 0.01) {
            this.remotePlayerInfoContainer.enabled = false;
            return;
        }

        this.remotePlayerInfoContainer.enabled = true;

        const heightOffset = (this.xpContainerHeightOffset !== undefined && this.xpContainerHeightOffset !== null)
            ? this.xpContainerHeightOffset : 25;
        const aboveHead = new vec3(player.headPos.x, player.headPos.y + heightOffset, player.headPos.z);
        const containerTransform = this.remotePlayerInfoContainer.getTransform();
        containerTransform.setWorldPosition(aboveHead);

        // Billboard: face the local camera
        try {
            if (this.camDisplay) {
                const camParent = this.camDisplay.getParent();
                if (camParent) {
                    const camPos = camParent.getTransform().getWorldPosition();
                    const dir = new vec3(camPos.x - aboveHead.x, 0, camPos.z - aboveHead.z);
                    if (dir.length > 0.01) {
                        containerTransform.setWorldRotation(quat.lookAt(dir.normalize(), vec3.up()));
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Update text children (matches Remote XP Container hierarchy)
        const prestigeStr = player.playerPrestige > 0 ? ' ' + '★'.repeat(player.playerPrestige) : '';
        const levelDef = getLevelForXP(player.playerTotalXP);
        this.setRemoteInfoText(this.remotePlayerInfoContainer, 'Username', player.displayName);
        this.setRemoteInfoText(this.remotePlayerInfoContainer, 'Level Number',
            t('lvl_prefix') + player.playerLevel + ': ' + levelDef.name + prestigeStr);
        this.setRemoteInfoText(this.remotePlayerInfoContainer, 'Level Name', levelDef.name);
        this.setRemoteInfoText(this.remotePlayerInfoContainer, 'XP counter',
            'XP ' + player.playerTotalXP);

        // Trust score display
        const trustRank = getTrustRank(player.playerTrustScore);
        const trustText = trustRank.name + ' | ' + formatTrustText(player.playerTrustScore);
        this.setRemoteInfoText(this.remotePlayerInfoContainer, 'Scanned by: Username, rank, trust score', trustText);
        this.applyRemoteTrustColor(player.playerTrustScore);
        this.updateRemoteLevelBadge(player);

        // Update XP Bar (5 plane segments — same logic as XPManager.updateXPBar)
        this.updateRemoteXPBar(player.playerTotalXP);
    }

    private getRemoteLevelBadgeUrl(level: number): string {
        if (this.onGetLevelBadgeUrl) {
            const url = this.onGetLevelBadgeUrl(level);
            if (url && url.length > 0) return url;
        }
        if (!this.remoteLevelBadgeUrlTemplate || this.remoteLevelBadgeUrlTemplate.length < 8) return '';
        const clamped = Math.max(1, Math.min(50, Math.round(level)));
        let lvl = String(clamped);
        if (this.remoteLevelBadgePadDigits > 1) lvl = lvl.padStart(this.remoteLevelBadgePadDigits, '0');
        return this.remoteLevelBadgeUrlTemplate.replace('{level}', lvl);
    }

    private loadRemoteBadgeTexture(level: number, onReady: (tex: Texture) => void): void {
        const clamped = Math.max(1, Math.min(50, Math.round(level)));
        const cached = this._remoteBadgeTextureCache.get(clamped);
        if (cached) {
            onReady(cached);
            return;
        }

        const url = this.getRemoteLevelBadgeUrl(clamped);
        if (!url || !this.internetModule || !this.remoteMediaModule) return;

        if (!this._remoteBadgePending.has(clamped)) {
            this._remoteBadgePending.set(clamped, []);
        }
        this._remoteBadgePending.get(clamped)!.push(onReady);
        if (this._remoteBadgeLoading.has(clamped)) return;
        this._remoteBadgeLoading.add(clamped);

        try {
            const req = RemoteServiceHttpRequest.create();
            req.url = url;
            req.setHeader('User-Agent', 'LensStudio/5.15 DGNS/RemoteLevelBadge');
            this.internetModule.performHttpRequest(req, (res: RemoteServiceHttpResponse) => {
                if (res.statusCode < 200 || res.statusCode >= 400) {
                    this._remoteBadgeLoading.delete(clamped);
                    this._remoteBadgePending.delete(clamped);
                    return;
                }
                try {
                    const resource = res.asResource();
                    this.remoteMediaModule.loadResourceAsImageTexture(
                        resource,
                        (texture: Texture) => {
                            this._remoteBadgeTextureCache.set(clamped, texture);
                            this._remoteBadgeLoading.delete(clamped);
                            const cbs = this._remoteBadgePending.get(clamped) || [];
                            this._remoteBadgePending.delete(clamped);
                            for (let i = 0; i < cbs.length; i++) cbs[i](texture);
                        },
                        (_err: string) => {
                            this._remoteBadgeLoading.delete(clamped);
                            this._remoteBadgePending.delete(clamped);
                        }
                    );
                } catch (e) {
                    this._remoteBadgeLoading.delete(clamped);
                    this._remoteBadgePending.delete(clamped);
                }
            });
        } catch (e) {
            this._remoteBadgeLoading.delete(clamped);
            this._remoteBadgePending.delete(clamped);
        }
    }

    private applyTextureToBadgeObject(obj: SceneObject, texture: Texture): void {
        try {
            const img = obj.getComponent('Component.Image') as Image;
            if (img && img.mainMaterial && img.mainPass) {
                img.mainMaterial = img.mainMaterial.clone();
                img.mainPass.baseTex = texture;
                obj.enabled = true;
                return;
            }
            const mesh = obj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
            if (mesh && mesh.mainMaterial && mesh.mainPass) {
                mesh.mainMaterial = mesh.mainMaterial.clone();
                mesh.mainPass.baseTex = texture;
                obj.enabled = true;
            }
        } catch (e) { /* ignore */ }
    }

    private updateRemoteLevelBadge(player: RemotePlayerData): void {
        if (!this.remotePlayerInfoContainer) return;
        if (player.lastAppliedBadgeLevel === player.playerLevel) return;
        const badgeObj = findChildByName(this.remotePlayerInfoContainer, 'Level Badge');
        if (!badgeObj) return;
        player.lastAppliedBadgeLevel = player.playerLevel;
        this.loadRemoteBadgeTexture(player.playerLevel, (tex: Texture) => {
            this.applyTextureToBadgeObject(badgeObj, tex);
        });
    }

    private setRemoteInfoText(parent: SceneObject, childName: string, value: string): void {
        const child = findChildByName(parent, childName);
        if (!child) return;
        try {
            const textComp = child.getComponent('Component.Text') as Text;
            if (textComp) textComp.text = value;
        } catch (e) { /* ignore */ }
    }

    private applyRemoteTrustColor(score: number): void {
        if (!this.remotePlayerInfoContainer) return;
        const child = findChildByName(this.remotePlayerInfoContainer, 'Scanned by: Username, rank, trust score');
        if (!child) return;
        try {
            const textComp = child.getComponent('Component.Text') as Text;
            if (!textComp) return;
            const hex = getTrustColor(score);
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            textComp.textFill.color = new vec4(r, g, b, 1);
        } catch (e) { /* ignore */ }
    }

    /** Updates the XP Bar inside the remote player info container (5 plane segments). */
    private updateRemoteXPBar(totalXP: number): void {
        if (!this.remotePlayerInfoContainer) return;

        const xpBarObj = findChildByName(this.remotePlayerInfoContainer, 'XP Bar');
        if (!xpBarObj) return;

        const levelDef = getLevelForXP(totalXP);
        const currentThreshold = levelDef.xpThreshold;
        const nextThreshold = getXPForNextLevel(levelDef.level);

        let fillRatio = 1.0;
        if (nextThreshold > 0 && nextThreshold > currentThreshold) {
            const xpInLevel = totalXP - currentThreshold;
            const xpNeeded = nextThreshold - currentThreshold;
            fillRatio = Math.max(0, Math.min(1, xpInLevel / xpNeeded));
        }

        const segmentsFilled = Math.round(fillRatio * 5);
        const childCount = xpBarObj.getChildrenCount();
        let planeIndex = 0;
        for (let i = 0; i < childCount; i++) {
            const child = xpBarObj.getChild(i);
            if (!child) continue;
            if (!child.getComponent('Component.RenderMeshVisual')) continue;
            child.enabled = (planeIndex < segmentsFilled);
            planeIndex++;
        }
    }

    // =====================================================================
    // INCOMING CARD IMAGE HANDLERS — Carousel images
    // =====================================================================

    /** Handles a complete card image received in a single message. */
    private onRemoteCardImage(msg: NetworkMessage<unknown>): void {
        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            const b64: string = d.b64;
            if (!serial || !b64) return;
            this.applyRemoteCardImage(msg.senderConnectionId, serial, b64);
        } catch (e) {
            print('ConnectedLensManager: Error parsing card image: ' + e);
        }
    }

    /** Handles a chunked card image piece. Reassembles and applies when complete. */
    private onRemoteCardImageChunk(msg: NetworkMessage<unknown>): void {
        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            const idx: number = d.idx;
            const total: number = d.total;
            const chunk: string = d.data;
            if (!serial || idx === undefined || !total || !chunk) return;

            const key = msg.senderConnectionId + '_' + serial;
            if (!this._imageChunkBuffers.has(key)) {
                this._imageChunkBuffers.set(key, { total: total, chunks: new Array(total).fill(''), ts: Date.now() });
            }
            const buf = this._imageChunkBuffers.get(key)!;
            buf.chunks[idx] = chunk;

            // Check if all chunks received
            let complete = true;
            for (let i = 0; i < buf.total; i++) {
                if (!buf.chunks[i] || buf.chunks[i].length === 0) { complete = false; break; }
            }

            if (complete) {
                const fullB64 = buf.chunks.join('');
                this._imageChunkBuffers.delete(key);
                print('ConnectedLensManager: Reassembled image for ' + serial
                    + ' (' + fullB64.length + ' chars, ' + buf.total + ' chunks)');
                this.applyRemoteCardImage(msg.senderConnectionId, serial, fullB64);
            }
        } catch (e) {
            print('ConnectedLensManager: Error parsing card image chunk: ' + e);
        }
    }

    /**
     * Applies a received base64 image to the matching remote card.
     * Finds the card by owner connectionId + serial, decodes base64 to texture.
     */
    private applyRemoteCardImage(ownerConnId: string, serial: string, b64: string): void {
        const player = this.remotePlayers.get(ownerConnId);
        if (!player) return;

        // Find the matching card SceneObject
        let targetCard: SceneObject | null = null;
        for (let i = 0; i < player.remoteCardData.length; i++) {
            if (player.remoteCardData[i].serial === serial && i < player.remoteCards.length) {
                targetCard = player.remoteCards[i];
                break;
            }
        }

        if (!targetCard) {
            print('ConnectedLensManager: Remote card not found for image — serial ' + serial);
            return;
        }

        const cardObj = targetCard;
        try {
            Base64.decodeTextureAsync(
                b64,
                (texture: Texture) => {
                    this.applyImageToCard(cardObj, texture);
                    print('ConnectedLensManager: Applied remote image for ' + serial);
                },
                () => {
                    print('ConnectedLensManager: Failed to decode remote image for ' + serial);
                }
            );
        } catch (e) {
            print('ConnectedLensManager: Error decoding remote image: ' + e);
        }
    }

    /**
     * Applies a texture to the 'Card Image' child of a card SceneObject.
     * Shared utility — works for both remote carousel cards and traded cards.
     */
    private applyImageToCard(cardObj: SceneObject, texture: Texture): void {
        const cardImageObj = findChildByName(cardObj, 'Card Image');
        if (!cardImageObj) return;

        const imgComp = cardImageObj.getComponent('Component.Image') as Image;
        if (imgComp) {
            imgComp.mainMaterial = imgComp.mainMaterial.clone();
            imgComp.mainPass.baseTex = texture;
            cardImageObj.enabled = true;
            return;
        }

        const meshComp = cardImageObj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
        if (meshComp) {
            meshComp.mainMaterial = meshComp.mainMaterial.clone();
            meshComp.mainPass.baseTex = texture;
            cardImageObj.enabled = true;
        }
    }

    // =====================================================================
    // REMOTE CAROUSEL — Instantiate read-only cards from network data
    // =====================================================================

    private onRemoteCarouselData(msg: NetworkMessage<unknown>): void {
        const senderConnId = msg.senderConnectionId;
        const player = this.remotePlayers.get(senderConnId);
        if (!player) {
            print('ConnectedLensManager: Received carousel data from unknown player');
            return;
        }

        try {
            const jsonStr = msg.data as string;
            const parsed: unknown = JSON.parse(jsonStr);
            let cards: SimplifiedCard[];
            let angle = 0;
            if (Array.isArray(parsed)) {
                cards = parsed as SimplifiedCard[];
            } else if (parsed && typeof parsed === 'object' && 'cards' in parsed) {
                const obj = parsed as { cards?: SimplifiedCard[]; angle?: number };
                cards = Array.isArray(obj.cards) ? obj.cards : [];
                if (typeof obj.angle === 'number') angle = obj.angle;
            } else {
                cards = [];
            }
            print('ConnectedLensManager: Received ' + cards.length + ' cards from ' + player.displayName + ' (angle=' + angle.toFixed(2) + ')');

            this.destroyRemoteCarousel(player);
            player.remoteCardData = cards;
            player.remoteCarouselAngleOffset = angle;
            player.isCarouselVisible = true;
            this.buildRemoteCarousel(player, cards);
        } catch (e) {
            print('ConnectedLensManager: Error parsing carousel data: ' + e);
        }
    }

    private onRemoteCarouselHide(msg: NetworkMessage<unknown>): void {
        const senderConnId = msg.senderConnectionId;
        const player = this.remotePlayers.get(senderConnId);
        if (!player) return;

        print('ConnectedLensManager: ' + player.displayName + ' hid their carousel');
        player.isCarouselVisible = false;
        this.destroyRemoteCarousel(player);
        player.remoteCardData = [];
        player.isCarouselShown = false;
    }

    private buildRemoteCarousel(player: RemotePlayerData, cards: SimplifiedCard[]): void {
        if (!this.verticalCardPrefab) {
            print('ConnectedLensManager: No card prefab — cannot build remote carousel');
            return;
        }

        const n = cards.length;

        for (let i = 0; i < n; i++) {
            try {
                const cardObj = this.verticalCardPrefab.instantiate(
                    this.collectionRoot || this.getSceneObject()
                );
                if (!cardObj) continue;

                cardObj.name = 'RemoteCard_' + player.displayName + '_' + i;
                this.populateRemoteCard(cardObj, cards[i], player);

                // Disable card scripts but hook Frame for trade interaction
                this.setupRemoteCardInteraction(cardObj, player.connectionId, cards[i].serial);

                // Hide Card Image by default (will be shown when image arrives)
                const cardImageObj = findChildByName(cardObj, 'Card Image');
                if (cardImageObj) cardImageObj.enabled = false;

                cardObj.getTransform().setLocalScale(new vec3(0.15, 0.15, 0.15));
                player.remoteCards.push(cardObj);
            } catch (e) {
                print('ConnectedLensManager: Error instantiating remote card ' + i + ': ' + e);
            }
        }

        // Position cards around wrist (or fallback)
        this.repositionRemoteCarousel(player);

        player.isCarouselShown = true;
        print('ConnectedLensManager: Built remote carousel for ' + player.displayName
            + ' (' + player.remoteCards.length + ' cards)'
            + (player.wristValid ? ' at wrist' : ' in front of head'));
    }

    /**
     * Returns the best center position for a remote player's carousel.
     * Prefers wrist position; falls back to 50cm in front of the head.
     */
    private getRemoteCarouselCenter(player: RemotePlayerData): vec3 {
        if (player.wristValid && player.wristPos.length > 0.01) {
            return player.wristPos;
        }
        // Fallback: 50cm in front of the remote player's head
        const forward = player.headRot.multiplyVec3(vec3.forward());
        return player.headPos.add(forward.uniformScale(50));
    }

    /**
     * Repositions all remote cards for a player around the carousel center.
     * Called on build and every frame when the carousel is visible (dynamic follow).
     */
    private repositionRemoteCarousel(player: RemotePlayerData): void {
        const n = player.remoteCards.length;
        if (n === 0) return;

        const center = this.getRemoteCarouselCenter(player);
        const baseRadius = player.wristValid ? this.REMOTE_CAROUSEL_RADIUS_WRIST : this.REMOTE_CAROUSEL_RADIUS;
        const radius = Math.max(baseRadius, n * 0.7);

        const angleOffset = player.remoteCarouselAngleOffset ?? 0;
        const wristRot = player.wristRotValid ? player.wristRot : quat.quatIdentity();
        const hideThreshold = this.REMOTE_CAROUSEL_HIDE_THRESHOLD;

        for (let i = 0; i < n; i++) {
            const cardObj = player.remoteCards[i];
            if (!cardObj) continue;

            try {
                const angle = (i / n) * Math.PI * 2 + angleOffset;
                const sinVal = Math.sin(angle);

                if (hideThreshold > 0 && sinVal < -hideThreshold) {
                    cardObj.enabled = false;
                    continue;
                }

                cardObj.enabled = true;
                const localX = Math.cos(angle) * radius;
                const localZ = Math.sin(angle) * radius;
                const localOffset = new vec3(localX, 0, localZ);
                const worldOffset = wristRot.multiplyVec3(localOffset);
                const cardPos = new vec3(
                    center.x + worldOffset.x,
                    center.y + worldOffset.y,
                    center.z + worldOffset.z
                );

                const transform = cardObj.getTransform();
                transform.setWorldPosition(cardPos);

                const viewerPos = this.getLocalCameraWorldPosition();
                if (viewerPos && viewerPos.sub(cardPos).length > 0.01) {
                    const toViewer = viewerPos.sub(cardPos).normalize();
                    const billboardRot = quat.lookAt(toViewer, vec3.up());
                    const tiltRad = this.REMOTE_CAROUSEL_TILT_DEG * (Math.PI / 180);
                    const tiltQuat = quat.fromEulerAngles(-tiltRad, 0, 0);
                    transform.setWorldRotation(billboardRot.multiply(tiltQuat));
                } else {
                    const lookDir = cardPos.sub(center).normalize();
                    const up = wristRot.multiplyVec3(vec3.up());
                    transform.setWorldRotation(quat.lookAt(lookDir, up));
                }

                const rawOpacity = (sinVal + 1.0) * 0.5;
                const opacity = Math.max(0, Math.min(1, rawOpacity * rawOpacity * (3 - 2 * rawOpacity)));
                this.setRemoteCardOpacity(cardObj, opacity);
            } catch (e) { /* card may have been destroyed */ }
        }
    }

    private setRemoteCardOpacity(obj: SceneObject, opacity: number): void {
        const meshVisual = obj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
        if (meshVisual && meshVisual.mainPass) {
            try {
                const baseColor = meshVisual.mainPass.baseColor;
                meshVisual.mainPass.baseColor = new vec4(baseColor.r, baseColor.g, baseColor.b, opacity);
            } catch (e) { /* ignore */ }
        }
        const imageComp = obj.getComponent('Component.Image') as Image;
        if (imageComp && imageComp.mainPass) {
            try {
                const baseColor = imageComp.mainPass.baseColor;
                imageComp.mainPass.baseColor = new vec4(baseColor.r, baseColor.g, baseColor.b, opacity);
            } catch (e) { /* ignore */ }
        }
        const textComp = obj.getComponent('Component.Text') as Text;
        if (textComp) {
            try {
                const tc = textComp.textFill.color;
                textComp.textFill.color = new vec4(tc.r, tc.g, tc.b, opacity);
            } catch (e) { /* ignore */ }
        }
        const childCount = obj.getChildrenCount();
        for (let i = 0; i < childCount; i++) {
            const child = obj.getChild(i);
            if (child) this.setRemoteCardOpacity(child, opacity);
        }
    }

    /**
     * Sets up interaction on a remote card for trade requests.
     * Disables CardInteraction/carousel scripts, but keeps the Frame component
     * active so pinch/grab can trigger requestCard().
     */
    private setupRemoteCardInteraction(cardObj: SceneObject, ownerConnId: string, serial: string): void {
        // Store metadata for trade request lookup
        this._remoteCardMeta.set(cardObj, { connId: ownerConnId, serial: serial });

        // Poll for the Frame script component and hook onTranslationStart
        let attempts = 0;
        const maxAttempts = 300;
        const pollEvent = this.createEvent('UpdateEvent');
        pollEvent.bind(() => {
            attempts++;
            if (attempts > maxAttempts) { pollEvent.enabled = false; return; }

            // Safety: if card was destroyed, stop polling
            try {
                if (!cardObj || !cardObj.enabled) return;
                cardObj.getTransform(); // Will throw if destroyed
            } catch (e) {
                pollEvent.enabled = false;
                return;
            }

            // Search for Frame component on the card and its children
            const objectsToSearch = [cardObj];
            try {
                const childCount = cardObj.getChildrenCount();
                for (let ci = 0; ci < childCount; ci++) {
                    const child = cardObj.getChild(ci);
                    if (child) objectsToSearch.push(child);
                }
            } catch (e) { /* ignore */ }

            for (let oi = 0; oi < objectsToSearch.length; oi++) {
                try {
                    const scripts = objectsToSearch[oi].getComponents('Component.ScriptComponent') as any[];
                    for (let si = 0; si < scripts.length; si++) {
                        const script = scripts[si];
                        if (!script) continue;

                        if (script.onTranslationStart && typeof script.onTranslationStart.add === 'function'
                            && script.onTranslationEnd && typeof script.onTranslationEnd.add === 'function') {

                            // Hook grab start -> trigger trade request
                            script.onTranslationStart.add(() => {
                                this.startLocalGrabBillboard(cardObj);
                                const meta = this._remoteCardMeta.get(cardObj);
                                if (meta) {
                                    print('ConnectedLensManager: Remote card grabbed — requesting trade for ' + meta.serial);
                                    this.requestCard(meta.connId, meta.serial);
                                }
                            });

                            // Hook grab end -> stop local billboard and let remote carousel snap-back logic run.
                            script.onTranslationEnd.add(() => {
                                this.stopLocalGrabBillboard(cardObj);
                            });

                            pollEvent.enabled = false;
                            print('ConnectedLensManager: Trade interaction hooked for remote card ' + serial);
                            return;
                        }
                    }
                } catch (e) { /* polling */ }
            }
        });
    }

    private getLocalCameraWorldPosition(): vec3 | null {
        if (!this.camDisplay) return null;
        try {
            const camParent = this.camDisplay.getParent();
            if (!camParent) return null;
            return camParent.getTransform().getWorldPosition();
        } catch (e) {
            return null;
        }
    }

    private startLocalGrabBillboard(cardObj: SceneObject): void {
        this.stopLocalGrabBillboard(cardObj);
        const ev = this.createEvent('UpdateEvent');
        ev.bind(() => {
            try {
                const camPos = this.getLocalCameraWorldPosition();
                if (!camPos) return;
                const transform = cardObj.getTransform();
                const cardPos = transform.getWorldPosition();
                const dir = camPos.sub(cardPos);
                if (dir.length > 0.01) {
                    transform.setWorldRotation(quat.lookAt(dir.normalize(), vec3.up()));
                }
            } catch (e) {
                this.stopLocalGrabBillboard(cardObj);
            }
        });
        this._localGrabBillboardEvents.set(cardObj, ev);
    }

    private stopLocalGrabBillboard(cardObj: SceneObject): void {
        const ev = this._localGrabBillboardEvents.get(cardObj);
        if (ev) {
            try { ev.enabled = false; } catch (e) { /* ignore */ }
            this._localGrabBillboardEvents.delete(cardObj);
        }
    }

    private buildRemoteScannedByText(player: RemotePlayerData | null): string {
        if (!player) return t('scanned_by_unknown');
        const trustRank = getTrustRank(player.playerTrustScore);
        return player.displayName + '\n' + trustRank.name + ' | ' + formatTrustText(player.playerTrustScore);
    }

    private populateRemoteCard(cardObj: SceneObject, card: SimplifiedCard, owner: RemotePlayerData | null = null): void {
        const set = (childName: string, text: string) => {
            const obj = findChildByName(cardObj, childName);
            if (obj) {
                const tc = obj.getComponent('Component.Text') as Text;
                if (tc) tc.text = text;
            }
        };

        try {
            set('Car Brand and model', card.brand_model || '?');
            set('Car Type', formatCarType(card.type));
            set('Car Year', card.year || '?');
            set('Card Serial', card.serial || '');
            set('Date Scanned', card.dateScanned || '');
            set('City Scanned', card.cityScanned || '');

            const rarityObj = findChildByName(cardObj, 'Car Rarity');
            if (rarityObj) {
                const tc = rarityObj.getComponent('Component.Text') as Text;
                if (tc) tc.text = formatRarityText(card.rarity, card.rarity_label);
            }

            this.setRemoteStatBar(cardObj, 'Top Speed Bar', card.top_speed);
            this.setRemoteStatBar(cardObj, 'Acceleration Bar', card.acceleration);
            this.setRemoteStatBar(cardObj, 'Braking Bar', card.braking);
            this.setRemoteStatBar(cardObj, 'Traction Bar', card.traction);
            this.setRemoteStatBar(cardObj, 'Comfort Bar', card.comfort);

            const brandForLogo = card.brand || (card.brand_model ? card.brand_model.trim().split(/\s+/)[0] : '');
            if (brandForLogo && this.onLoadBrandLogo) {
                const logoObj = findChildByName(cardObj, 'Car Brand Logo');
                if (logoObj) this.onLoadBrandLogo(logoObj, brandForLogo);
            }

            const trustObj = findChildByName(cardObj, 'Scanned by: Username, rank, trust score');
            if (trustObj) {
                const tc = trustObj.getComponent('Component.Text') as Text;
                if (tc) {
                    tc.text = this.buildRemoteScannedByText(owner);
                    const hex = getTrustColor(owner ? owner.playerTrustScore : 80);
                    const r = parseInt(hex.substring(0, 2), 16) / 255;
                    const g = parseInt(hex.substring(2, 4), 16) / 255;
                    const b = parseInt(hex.substring(4, 6), 16) / 255;
                    tc.textFill.color = new vec4(r, g, b, 1);
                }
            }
        } catch (e) {
            print('ConnectedLensManager: Error populating remote card: ' + e);
        }
    }

    private setRemoteStatBar(cardObj: SceneObject, barName: string, value: number): void {
        const barObj = findChildByName(cardObj, barName);
        if (!barObj) return;
        const clamped = Math.max(0, Math.min(5, Math.round(value)));
        try {
            const childCount = barObj.getChildrenCount();
            let planeIndex = 0;
            for (let i = 0; i < childCount; i++) {
                const child = barObj.getChild(i);
                if (!child) continue;
                if (!child.getComponent('Component.RenderMeshVisual')) continue;
                child.enabled = (planeIndex < clamped);
                planeIndex++;
            }
        } catch (e) { /* ignore */ }
    }

    private destroyRemoteCarousel(player: RemotePlayerData): void {
        const cardsToDestroy: SceneObject[] = [];
        for (let i = 0; i < player.remoteCards.length; i++) {
            try {
                const card = player.remoteCards[i];
                if (card) {
                    this.stopLocalGrabBillboard(card);
                    this._remoteCardMeta.delete(card);
                    // Disable card and all children to prevent Frame.ts callbacks during destruction
                    card.enabled = false;
                    const childCount = card.getChildrenCount();
                    for (let c = 0; c < childCount; c++) {
                        try { card.getChild(c).enabled = false; } catch (e) { /* ignore */ }
                    }
                    cardsToDestroy.push(card);
                }
            } catch (e) {
                print('ConnectedLensManager: Error disabling remote card ' + i + ': ' + e);
            }
        }
        player.remoteCards = [];

        // Deferred destruction — let Frame.ts finish its current frame cycle
        if (cardsToDestroy.length > 0) {
            const destroyEvent = this.createEvent('DelayedCallbackEvent');
            (destroyEvent as any).bind(() => {
                for (let i = 0; i < cardsToDestroy.length; i++) {
                    try { cardsToDestroy[i].destroy(); } catch (e) { /* already destroyed */ }
                }
            });
            (destroyEvent as any).reset(0.1);
        }
    }

    // =====================================================================
    // CARD GIVE PROTOCOL — Request → Confirm → Transfer
    // =====================================================================

    requestCard(ownerConnectionId: string, cardSerial: string): void {
        if (!this.messaging || !this._syncSetupDone) return;

        if (this._pendingRequestSerial === cardSerial) {
            print('ConnectedLensManager: Already requesting card ' + cardSerial + ' — ignoring duplicate');
            return;
        }
        if (this._pendingRequestSerial.length > 0) {
            print('ConnectedLensManager: Another request pending (' + this._pendingRequestSerial + ') — ignoring');
            if (this.onShowMessage) this.onShowMessage(t('give_request_busy'));
            return;
        }

        const player = this.remotePlayers.get(ownerConnectionId);
        if (!player) return;

        this._pendingRequestSerial = cardSerial;

        let cardName = '?';
        for (let i = 0; i < player.remoteCardData.length; i++) {
            if (player.remoteCardData[i].serial === cardSerial) {
                cardName = player.remoteCardData[i].brand_model;
                break;
            }
        }

        const request: CardGiveRequest = {
            requesterConnId: this.sessionController.getLocalConnectionId(),
            requesterName: this.sessionController.getLocalUserName() || 'Someone',
            cardSerial: cardSerial,
            cardName: cardName,
        };

        this.messaging.sendMessage(this.CARD_GIVE_REQUEST_EVENT, JSON.stringify(request) as any, true);
        if (this.onShowMessage) this.onShowMessage(tf('requesting_card', { card: cardName, player: player.displayName }));
        print('ConnectedLensManager: Sent card give request for ' + cardSerial + ' to ' + player.displayName);
    }

    private onCardGiveRequestReceived(msg: NetworkMessage<unknown>): void {
        try {
            const request: CardGiveRequest = JSON.parse(msg.data as string);
            print('ConnectedLensManager: ' + request.requesterName + ' wants card ' + request.cardSerial);

            if (this.pendingGiveRequest) {
                print('ConnectedLensManager: Already have a pending give request — rejecting new one (busy)');
                if (this.messaging) {
                    this.messaging.sendMessage(
                        this.CARD_GIVE_REJECTED_EVENT,
                        JSON.stringify({ cardSerial: request.cardSerial, reason: 'busy' }) as any,
                        true
                    );
                }
                return;
            }

            this.pendingGiveRequest = request;
            this.giveRequestTimestamp = Date.now();

            if (this.confirmGiveContainer) {
                this.showContainer(this.confirmGiveContainer, () => this.rejectGiveRequest(), 'ConfirmGiveClose');
            }
            if (this.confirmGiveText) {
                this.confirmGiveText.text = tf('give_card_confirm', { card: request.cardName, player: request.requesterName });
            }
        } catch (e) {
            print('ConnectedLensManager: Error parsing give request: ' + e);
        }
    }

    private acceptGiveRequest(): void {
        if (!this.pendingGiveRequest || !this.messaging) return;

        const serial = this.pendingGiveRequest.cardSerial;

        if (this.onHasCardSerial && !this.onHasCardSerial(serial)) {
            print('ConnectedLensManager: Cannot give card ' + serial + ' — not in collection');
            if (this.onShowMessage) this.onShowMessage(t('card_no_longer'));
            if (this.confirmGiveContainer) this.confirmGiveContainer.enabled = false;
            this.pendingGiveRequest = null;
            return;
        }

        print('ConnectedLensManager: Accepted give for ' + serial);

        this._pendingOutgoingGiveSerial = serial;

        this.messaging.sendMessage(
            this.CARD_GIVE_ACCEPTED_EVENT,
            JSON.stringify({ cardSerial: serial }) as any,
            true
        );

        this.sendCardImageForTrade(serial);

        // Delay card removal to give the network message time to arrive.
        // If the receiver disconnects in the meantime, the card stays.
        if (this._pendingOutgoingGiveTimer) {
            try { this._pendingOutgoingGiveTimer.enabled = false; } catch (e) { /* ignore */ }
        }
        const giveTimer = this.createEvent('DelayedCallbackEvent');
        (giveTimer as any).reset(2.0);
        giveTimer.bind(() => {
            if (this._pendingOutgoingGiveSerial === serial) {
                if (this.onCardGivenAway) this.onCardGivenAway(serial);
                if (this.onShowMessage) this.onShowMessage(t('card_given'));
                this._pendingOutgoingGiveSerial = '';
                this._pendingOutgoingGiveTimer = null;
            }
        });
        this._pendingOutgoingGiveTimer = giveTimer;

        if (this.confirmGiveContainer) this.confirmGiveContainer.enabled = false;
        this.pendingGiveRequest = null;
    }

    /**
     * Sends a card's image to the requester after a trade is accepted.
     * Reads the image from persistent storage and sends via CARD_IMAGE_TRANSFER.
     */
    private sendCardImageForTrade(serial: string): void {
        if (!this.messaging) return;

        let savedAt = 0;
        if (this.onGetSavedAtForSerial) {
            savedAt = this.onGetSavedAtForSerial(serial);
        }
        if (!savedAt) {
            print('ConnectedLensManager: No savedAt found for traded card ' + serial + ' — no image to send');
            return;
        }

        let b64: string | null = null;
        if (this.onGetCardImageBase64) {
            b64 = this.onGetCardImageBase64(savedAt);
        }
        if (!b64 || b64.length === 0) {
            print('ConnectedLensManager: No image found for traded card ' + serial);
            return;
        }

        print('ConnectedLensManager: Sending image for traded card ' + serial
            + ' (' + b64.length + ' chars)');

        // Small delay so the ACCEPTED message arrives first
        const delayEvent = this.createEvent('DelayedCallbackEvent');
        (delayEvent as any).reset(0.15);
        delayEvent.bind(() => {
            this.sendCardImage(serial, b64!, this.CARD_IMAGE_TRANSFER_EVENT, this.CARD_IMAGE_CHUNK_XFER_EVENT);
        });
    }

    private rejectGiveRequest(): void {
        if (!this.pendingGiveRequest || !this.messaging) return;

        print('ConnectedLensManager: Rejected give for ' + this.pendingGiveRequest.cardSerial);

        this.messaging.sendMessage(
            this.CARD_GIVE_REJECTED_EVENT,
            JSON.stringify({ cardSerial: this.pendingGiveRequest.cardSerial }) as any,
            true
        );

        if (this.confirmGiveContainer) this.confirmGiveContainer.enabled = false;
        this.pendingGiveRequest = null;
    }

    private onCardGiveAccepted(msg: NetworkMessage<unknown>): void {
        try {
            const data = JSON.parse(msg.data as string);
            const serial = data.cardSerial as string;
            const senderConnId = msg.senderConnectionId;
            const player = this.remotePlayers.get(senderConnId);

            print('ConnectedLensManager: Card give accepted! Serial: ' + serial);

            // Clear the request guard
            if (this._pendingRequestSerial === serial) {
                this._pendingRequestSerial = '';
            }

            // Store pending trade serial — image will arrive shortly via CARD_IMAGE_TRANSFER
            this._pendingTradeSerial = serial;
            this._pendingTradeImageB64 = '';

            // Clean up world/grabbed clones for this traded card so they can't be re-grabbed
            this.cleanupRemoteCardClones(senderConnId, serial);

            if (player) {
                for (let i = 0; i < player.remoteCardData.length; i++) {
                    if (player.remoteCardData[i].serial === serial) {
                        const card = player.remoteCardData[i];
                        if (this.onShowMessage) this.onShowMessage(tf('received_card', { name: card.brand_model }));

                        const cardCopy = { ...card };
                        const timeoutEvent = this.createEvent('DelayedCallbackEvent');
                        (timeoutEvent as any).reset(3.0);
                        timeoutEvent.bind(() => {
                            const imgB64 = (this._pendingTradeSerial === serial) ? this._pendingTradeImageB64 : '';
                            if (this.onCardReceived) {
                                this.onCardReceived(cardCopy, imgB64.length > 0 ? imgB64 : undefined);
                            }
                            if (this._pendingTradeSerial === serial) {
                                this._pendingTradeSerial = '';
                                this._pendingTradeImageB64 = '';
                            }
                        });

                        // Remove from remote display
                        player.remoteCardData.splice(i, 1);
                        if (player.remoteCards[i]) {
                            this._remoteCardMeta.delete(player.remoteCards[i]);
                            try { player.remoteCards[i].destroy(); } catch (e) { /* ignore */ }
                            player.remoteCards.splice(i, 1);
                        }
                        break;
                    }
                }
            }
        } catch (e) {
            print('ConnectedLensManager: Error handling give accepted: ' + e);
        }
    }

    // =====================================================================
    // CARD IMAGE TRANSFER — Image sent after trade acceptance
    // =====================================================================

    /** Handles a complete card image transfer (fits in one message). */
    private onCardImageTransfer(msg: NetworkMessage<unknown>): void {
        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            const b64: string = d.b64;
            if (!serial || !b64) return;

            print('ConnectedLensManager: Received trade image for ' + serial
                + ' (' + b64.length + ' chars)');

            if (this._pendingTradeSerial === serial) {
                this._pendingTradeImageB64 = b64;
            }
        } catch (e) {
            print('ConnectedLensManager: Error parsing trade image: ' + e);
        }
    }

    /** Handles chunked card image transfer for trades. */
    private onCardImageChunkTransfer(msg: NetworkMessage<unknown>): void {
        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            const idx: number = d.idx;
            const total: number = d.total;
            const chunk: string = d.data;
            if (!serial || idx === undefined || !total || !chunk) return;

            const key = msg.senderConnectionId + '_xfer_' + serial;
            if (!this._imageXferChunkBuffers.has(key)) {
                this._imageXferChunkBuffers.set(key, { total: total, chunks: new Array(total).fill(''), ts: Date.now() });
            }
            const buf = this._imageXferChunkBuffers.get(key)!;
            buf.chunks[idx] = chunk;

            // Check if all chunks received
            let complete = true;
            for (let i = 0; i < buf.total; i++) {
                if (!buf.chunks[i] || buf.chunks[i].length === 0) { complete = false; break; }
            }

            if (complete) {
                const fullB64 = buf.chunks.join('');
                this._imageXferChunkBuffers.delete(key);
                print('ConnectedLensManager: Reassembled trade image for ' + serial
                    + ' (' + fullB64.length + ' chars, ' + buf.total + ' chunks)');

                if (this._pendingTradeSerial === serial) {
                    this._pendingTradeImageB64 = fullB64;
                }
            }
        } catch (e) {
            print('ConnectedLensManager: Error parsing trade image chunk: ' + e);
        }
    }

    private onCardGiveRejected(msg: NetworkMessage<unknown>): void {
        let reason = '';
        let serial = '';
        try {
            const data = JSON.parse(msg.data as string);
            reason = data.reason || '';
            serial = data.cardSerial || '';
        } catch (e) { /* no data */ }

        // Clear the request guard
        if (serial && this._pendingRequestSerial === serial) {
            this._pendingRequestSerial = '';
        } else {
            this._pendingRequestSerial = '';
        }

        print('ConnectedLensManager: Card give request was rejected — reason=' + (reason || 'declined'));
        if (reason === 'busy') {
            if (this.onShowMessage) this.onShowMessage(t('give_request_busy'));
        } else {
            if (this.onShowMessage) this.onShowMessage(t('request_declined'));
        }
    }

    /**
     * Cleans up all remote card clones (world + grabbed) for a given owner + serial.
     * Also removes associated _remoteCardMeta entries to prevent re-interaction.
     */
    private cleanupRemoteCardClones(ownerConnId: string, serial: string): void {
        const key = ownerConnId + '_' + serial;

        if (this._remoteGrabbedCards.has(key)) {
            const anchor = this._remoteGrabbedCards.get(key)!;
            try {
                const childCount = anchor.getChildrenCount();
                for (let i = 0; i < childCount; i++) {
                    try {
                        const child = anchor.getChild(i);
                        this.stopLocalGrabBillboard(child);
                        this._remoteCardMeta.delete(child);
                    } catch (e) { /* ignore */ }
                }
                anchor.destroy();
            } catch (e) { /* already destroyed */ }
            this._remoteGrabbedCards.delete(key);
            print('ConnectedLensManager: Cleaned up grabbed clone for traded card — ' + serial);
        }

        if (this._remoteWorldCards.has(key)) {
            const anchor = this._remoteWorldCards.get(key)!;
            try {
                const childCount = anchor.getChildrenCount();
                for (let i = 0; i < childCount; i++) {
                    try {
                        const child = anchor.getChild(i);
                        this.stopLocalGrabBillboard(child);
                        this._remoteCardMeta.delete(child);
                    } catch (e) { /* ignore */ }
                }
                anchor.destroy();
            } catch (e) { /* already destroyed */ }
            this._remoteWorldCards.delete(key);
            print('ConnectedLensManager: Cleaned up world clone for traded card — ' + serial);
        }
    }

    // =====================================================================
    // GIVE REQUEST TIMEOUT — Auto-cancel after 30s of no response
    // =====================================================================

    private checkGiveRequestTimeout(): void {
        if (!this.pendingGiveRequest) return;
        if (this._frameCounter % 30 !== 0) return;

        if (Date.now() - this.giveRequestTimestamp > this.GIVE_REQUEST_TIMEOUT_MS) {
            print('ConnectedLensManager: Give request timed out (30s) — auto-rejecting');
            this.rejectGiveRequest();
            if (this.onShowMessage) this.onShowMessage(t('trade_expired'));
        }
    }

    private purgeStaleChunkBuffers(): void {
        const now = Date.now();
        for (const [key, buf] of this._imageChunkBuffers) {
            if (now - buf.ts > this.CHUNK_TIMEOUT_MS) {
                print('ConnectedLensManager: Purging stale chunk buffer: ' + key);
                this._imageChunkBuffers.delete(key);
            }
        }
        for (const [key, buf] of this._imageXferChunkBuffers) {
            if (now - buf.ts > this.CHUNK_TIMEOUT_MS) {
                print('ConnectedLensManager: Purging stale xfer chunk buffer: ' + key);
                this._imageXferChunkBuffers.delete(key);
            }
        }
    }

    // =====================================================================
    // CONFIRM GIVE BUTTONS SETUP
    // =====================================================================

    private setupGiveButtons(): void {
        if (this.giveButtonsConnected) return;

        if (this.confirmGiveYesButton && this.onConnectButton) {
            this.onConnectButton(this.confirmGiveYesButton, () => {
                print('ConnectedLensManager: Give confirmed');
                this.acceptGiveRequest();
            }, 'ConfirmGiveYes');
        }

        if (this.confirmGiveCancelButton && this.onConnectButton) {
            this.onConnectButton(this.confirmGiveCancelButton, () => {
                print('ConnectedLensManager: Give cancelled');
                this.rejectGiveRequest();
            }, 'ConfirmGiveCancel');
        }

        this.hookContainerCloseButtons();
        this.giveButtonsConnected = true;
    }

    /**
     * Translates all static UI texts in Give/Trade containers (Yes/Cancel buttons, question texts).
     * Called once after language selection.
     */
    translateStaticTexts(): void {
        if (this.confirmGiveContainer) this.walkAndTranslate(this.confirmGiveContainer);
        if (this.confirmTradeContainer) this.walkAndTranslate(this.confirmTradeContainer);
        print('ConnectedLensManager: Static UI texts translated');
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
                } else if (name.indexOf('allow username') >= 0 || name.indexOf('Do you want to allow') >= 0) {
                    if (obj.getParent() && obj.getParent()!.name.indexOf('Trade') >= 0) {
                        textComp.text = t('trade_card_default');
                    } else {
                        textComp.text = t('give_card_default');
                    }
                }
            }
        } catch (e) { /* no text component */ }
        const count = obj.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = obj.getChild(i);
            if (child) this.walkAndTranslate(child);
        }
    }

    private hookContainerCloseButtons(): void {
        // Close buttons are hooked lazily via showContainer() because Frame.ts
        // only creates FrameObject + buttons after OnStartEvent on an enabled object.
    }

    private _closeHooked: Set<SceneObject> = new Set();

    private showContainer(container: SceneObject, closeCallback: () => void, debugName: string): void {
        this.positionContainerInFrontOfUser(container);
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

    private positionContainerInFrontOfUser(container: SceneObject): void {
        if (!this.camDisplay) return;
        try {
            const camParent = this.camDisplay.getParent();
            if (!camParent) return;
            const camTransform = camParent.getTransform();
            const camPos = camTransform.getWorldPosition();
            const camRot = camTransform.getWorldRotation();
            const forward = camRot.multiplyVec3(vec3.forward()).normalize();
            const spawnPos = camPos.add(forward.uniformScale(60));
            const transform = container.getTransform();
            transform.setWorldPosition(spawnPos);
            transform.setWorldRotation(quat.quatIdentity());
        } catch (e) { /* ignore */ }
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
                        print('ConnectedLensManager: Frame close button hooked — ' + debugName);
                        return true;
                    }
                    if (s.onButtonPinched && typeof s.onButtonPinched.add === 'function') {
                        s.onButtonPinched.add(() => callback());
                        print('ConnectedLensManager: Frame close button hooked (pinch) — ' + debugName);
                        return true;
                    }
                } catch (e) { /* ignore */ }
            }
            if (this.searchButtonsIn(child, callback, debugName)) return true;
        }
        return false;
    }

    // =====================================================================
    // WORLD-PLACED CARD SYNC — Broadcast when a card is placed/returned
    // =====================================================================

    /** Called by the orchestrator when a local card is placed in the world. */
    broadcastCardPlaced(serial: string, worldPos: vec3, worldRot: quat, scale: number): void {
        if (!this.messaging || !this._syncSetupDone) return;

        const locPos = this.worldPosToLocated(worldPos);
        const locRot = this.worldRotToLocated(worldRot);

        try {
            const payload = JSON.stringify({
                serial: serial,
                px: locPos.x, py: locPos.y, pz: locPos.z,
                rx: locRot.x, ry: locRot.y, rz: locRot.z, rw: locRot.w,
                s: scale,
            });
            this.messaging.sendMessage(this.CARD_PLACED_EVENT, payload as any, true);
            print('ConnectedLensManager: Broadcast card placed — ' + serial);
        } catch (e) {
            print('ConnectedLensManager: Error broadcasting card placed: ' + e);
        }
    }

    /** Called by the orchestrator when a local card is returned to collection. */
    broadcastCardReturned(serial: string): void {
        if (!this.messaging || !this._syncSetupDone) return;

        try {
            const payload = JSON.stringify({ serial: serial });
            this.messaging.sendMessage(this.CARD_RETURNED_EVENT, payload as any, true);
            print('ConnectedLensManager: Broadcast card returned — ' + serial);
        } catch (e) {
            print('ConnectedLensManager: Error broadcasting card returned: ' + e);
        }
    }

    /** Called by the orchestrator when a local card is grabbed from the carousel. */
    broadcastCardGrabbed(serial: string, worldPos: vec3, worldRot: quat, scale: number): void {
        if (!this.messaging || !this._syncSetupDone) return;

        const locPos = this.worldPosToLocated(worldPos);
        const locRot = this.worldRotToLocated(worldRot);

        try {
            const payload = JSON.stringify({
                serial: serial,
                px: locPos.x, py: locPos.y, pz: locPos.z,
                rx: locRot.x, ry: locRot.y, rz: locRot.z, rw: locRot.w,
                s: scale,
            });
            this.messaging.sendMessage(this.CARD_GRAB_EVENT, payload as any, false);
            print('ConnectedLensManager: Broadcast card grabbed — ' + serial);
        } catch (e) {
            print('ConnectedLensManager: Error broadcasting card grabbed: ' + e);
        }
    }

    /** Called by the orchestrator every few frames while a local card is being dragged. */
    broadcastCardMoving(serial: string, worldPos: vec3, worldRot: quat, scale: number): void {
        if (!this.messaging || !this._syncSetupDone) return;

        const locPos = this.worldPosToLocated(worldPos);
        const locRot = this.worldRotToLocated(worldRot);

        try {
            const payload = JSON.stringify({
                serial: serial,
                px: locPos.x, py: locPos.y, pz: locPos.z,
                rx: locRot.x, ry: locRot.y, rz: locRot.z, rw: locRot.w,
                s: scale,
            });
            this.messaging.sendMessage(this.CARD_MOVE_EVENT, payload as any, false);
        } catch (e) { /* throttled, ignore errors */ }
    }

    /** Handles a remote player grabbing a card from their carousel or world. */
    private onRemoteCardGrabbed(msg: NetworkMessage<unknown>): void {
        const senderConnId = msg.senderConnectionId;
        const player = this.remotePlayers.get(senderConnId);

        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            if (!serial) return;

            const locPos = new vec3(d.px, d.py, d.pz);
            const locRot = new quat(d.rw, d.rx, d.ry, d.rz);
            const scale: number = d.s || 0.36;
            const worldPos = this.locatedPosToWorld(locPos);
            const worldRot = this.locatedRotToWorld(locRot);

            const key = senderConnId + '_' + serial;

            // If already tracked as grabbed, just update position
            if (this._remoteGrabbedCards.has(key)) {
                const obj = this._remoteGrabbedCards.get(key)!;
                try {
                    obj.getTransform().setWorldPosition(worldPos);
                    obj.getTransform().setWorldRotation(worldRot);
                } catch (e) { /* destroyed */ }
                return;
            }

            // If this card was previously placed in world, transfer the existing
            // world clone to grabbed state instead of creating a duplicate
            if (this._remoteWorldCards.has(key)) {
                const worldAnchor = this._remoteWorldCards.get(key)!;
                try {
                    const child = worldAnchor.getChildrenCount() > 0 ? worldAnchor.getChild(0) : null;
                    if (child) {
                        child.getTransform().setWorldPosition(worldPos);
                        child.getTransform().setWorldRotation(worldRot);
                    }
                    worldAnchor.name = 'RemoteGrabAnchor_' + serial;
                    if (child) child.name = 'RemoteGrabbedCard_' + serial;
                } catch (e) { /* destroyed */ }
                this._remoteGrabbedCards.set(key, worldAnchor);
                this._remoteWorldCards.delete(key);
                print('ConnectedLensManager: World card transferred to grabbed state — ' + serial);
                return;
            }

            // Hide card from the remote carousel
            if (player) {
                for (let i = 0; i < player.remoteCardData.length; i++) {
                    if (player.remoteCardData[i].serial === serial && i < player.remoteCards.length) {
                        const carouselCard = player.remoteCards[i];
                        if (carouselCard) carouselCard.enabled = false;
                        break;
                    }
                }
            }

            // Instantiate a floating clone at the grabbed position
            if (!this.verticalCardPrefab) return;

            const clone = this.verticalCardPrefab.instantiate(
                this.collectionRoot || this.getSceneObject()
            );
            if (!clone) return;

            clone.name = 'RemoteGrabbedCard_' + serial;

            // Populate card data and image
            if (player) {
                for (let i = 0; i < player.remoteCardData.length; i++) {
                    if (player.remoteCardData[i].serial === serial) {
                        this.populateRemoteCard(clone, player.remoteCardData[i], player);
                        if (i < player.remoteCards.length && player.remoteCards[i]) {
                            try {
                                const imgObj = findChildByName(player.remoteCards[i], 'Card Image');
                                if (imgObj) {
                                    const imgComp = imgObj.getComponent('Component.Image') as Image;
                                    if (imgComp && imgComp.mainPass && imgComp.mainPass.baseTex) {
                                        this.applyImageToCard(clone, imgComp.mainPass.baseTex);
                                    }
                                }
                            } catch (e) { /* ignore */ }
                        }
                        break;
                    }
                }
            }

            // Position in world space
            const anchor = global.scene.createSceneObject('RemoteGrabAnchor_' + serial);
            clone.setParent(anchor);
            clone.getTransform().setWorldPosition(worldPos);
            clone.getTransform().setWorldRotation(worldRot);
            clone.getTransform().setLocalScale(new vec3(scale, scale, scale));

            this._remoteGrabbedCards.set(key, anchor);

            const playerName = player ? player.displayName : senderConnId;
            print('ConnectedLensManager: Remote card grabbed — ' + serial + ' from ' + playerName);
        } catch (e) {
            print('ConnectedLensManager: Error handling remote card grabbed: ' + e);
        }
    }

    /** Handles a remote player moving a grabbed card (real-time position update). */
    private onRemoteCardMoved(msg: NetworkMessage<unknown>): void {
        const senderConnId = msg.senderConnectionId;

        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            if (!serial) return;

            const key = senderConnId + '_' + serial;
            const anchor = this._remoteGrabbedCards.get(key);
            if (!anchor) return;

            const locPos = new vec3(d.px, d.py, d.pz);
            const locRot = new quat(d.rw, d.rx, d.ry, d.rz);
            const scale: number = d.s || 0.36;
            const worldPos = this.locatedPosToWorld(locPos);
            const worldRot = this.locatedRotToWorld(locRot);

            // Update the clone position with lerp for smoothness
            try {
                const t = anchor.getChildrenCount() > 0 ? anchor.getChild(0) : null;
                if (t) {
                    const curPos = t.getTransform().getWorldPosition();
                    const lerpedPos = new vec3(
                        curPos.x + (worldPos.x - curPos.x) * this.HEAD_LERP_SPEED,
                        curPos.y + (worldPos.y - curPos.y) * this.HEAD_LERP_SPEED,
                        curPos.z + (worldPos.z - curPos.z) * this.HEAD_LERP_SPEED
                    );
                    t.getTransform().setWorldPosition(lerpedPos);
                    t.getTransform().setWorldRotation(
                        quat.slerp(t.getTransform().getWorldRotation(), worldRot, this.HEAD_LERP_SPEED)
                    );
                    const curScale = t.getTransform().getLocalScale().x;
                    const newS = curScale + (scale - curScale) * this.HEAD_LERP_SPEED;
                    t.getTransform().setLocalScale(new vec3(newS, newS, newS));
                }
            } catch (e) { /* anchor may be destroyed */ }
        } catch (e) { /* throttled, ignore */ }
    }

    /** Handles a remote player placing a card in world space. */
    private onRemoteCardPlaced(msg: NetworkMessage<unknown>): void {
        const senderConnId = msg.senderConnectionId;
        const player = this.remotePlayers.get(senderConnId);

        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            if (!serial) return;

            const locPos = new vec3(d.px, d.py, d.pz);
            const locRot = new quat(d.rw, d.rx, d.ry, d.rz);
            const scale: number = d.s || 0.36;

            // Convert from LocatedAt to local world
            const worldPos = this.locatedPosToWorld(locPos);
            const worldRot = this.locatedRotToWorld(locRot);

            const key = senderConnId + '_' + serial;

            // If the card was being grabbed, promote the grab clone to a world card
            if (this._remoteGrabbedCards.has(key)) {
                const grabAnchor = this._remoteGrabbedCards.get(key)!;
                try {
                    const child = grabAnchor.getChildrenCount() > 0 ? grabAnchor.getChild(0) : null;
                    if (child) {
                        child.getTransform().setWorldPosition(worldPos);
                        child.getTransform().setWorldRotation(worldRot);
                        child.getTransform().setLocalScale(new vec3(scale, scale, scale));
                    }
                    // Rename anchor
                    grabAnchor.name = 'RemoteWorldAnchor_' + serial;
                    if (child) child.name = 'RemoteWorldCard_' + serial;
                } catch (e) { /* destroyed */ }

                if (player) {
                    const child = grabAnchor.getChildrenCount() > 0 ? grabAnchor.getChild(0) : null;
                    if (child) this.setupRemoteCardInteraction(child, senderConnId, serial);
                }

                this._remoteWorldCards.set(key, grabAnchor);
                this._remoteGrabbedCards.delete(key);

                const playerName = player ? player.displayName : senderConnId;
                print('ConnectedLensManager: Grabbed card promoted to world card — ' + serial + ' from ' + playerName);
                return;
            }

            // Destroy existing clone if any
            if (this._remoteWorldCards.has(key)) {
                try { this._remoteWorldCards.get(key)!.destroy(); } catch (e) { /* ignore */ }
                this._remoteWorldCards.delete(key);
            }

            // Find the card data from the player's carousel
            let cardData: SimplifiedCard | null = null;
            let cardImageTexture: Texture | null = null;
            if (player) {
                for (let i = 0; i < player.remoteCardData.length; i++) {
                    if (player.remoteCardData[i].serial === serial) {
                        cardData = player.remoteCardData[i];
                        // Try to grab the texture from the existing carousel card
                        if (i < player.remoteCards.length && player.remoteCards[i]) {
                            try {
                                const imgObj = findChildByName(player.remoteCards[i], 'Card Image');
                                if (imgObj && imgObj.enabled) {
                                    const imgComp = imgObj.getComponent('Component.Image') as Image;
                                    if (imgComp && imgComp.mainPass && imgComp.mainPass.baseTex) {
                                        cardImageTexture = imgComp.mainPass.baseTex;
                                    }
                                    if (!cardImageTexture) {
                                        const meshComp = imgObj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
                                        if (meshComp && meshComp.mainPass && meshComp.mainPass.baseTex) {
                                            cardImageTexture = meshComp.mainPass.baseTex;
                                        }
                                    }
                                }
                            } catch (e) { /* ignore */ }
                        }
                        break;
                    }
                }
            }

            if (!this.verticalCardPrefab) {
                print('ConnectedLensManager: No card prefab — cannot show remote world card');
                return;
            }

            // Instantiate a clone at the world position
            const clone = this.verticalCardPrefab.instantiate(
                this.collectionRoot || this.getSceneObject()
            );
            if (!clone) return;

            clone.name = 'RemoteWorldCard_' + serial;

            if (cardData) {
                this.populateRemoteCard(clone, cardData, player);
            }

            // Apply image if available
            if (cardImageTexture) {
                this.applyImageToCard(clone, cardImageTexture);
            } else {
                const cardImageObj = findChildByName(clone, 'Card Image');
                if (cardImageObj) cardImageObj.enabled = false;
            }

            // Unparent so it lives in world space
            const anchor = global.scene.createSceneObject('RemoteWorldAnchor_' + serial);
            clone.setParent(anchor);
            clone.getTransform().setWorldPosition(worldPos);
            clone.getTransform().setWorldRotation(worldRot);
            clone.getTransform().setLocalScale(new vec3(scale, scale, scale));

            // Set up trade interaction on this world-placed card
            if (player) {
                this.setupRemoteCardInteraction(clone, senderConnId, serial);
            }

            this._remoteWorldCards.set(key, anchor);

            const playerName = player ? player.displayName : senderConnId;
            print('ConnectedLensManager: Remote world card placed — ' + serial
                + ' from ' + playerName + ' at ('
                + worldPos.x.toFixed(1) + ',' + worldPos.y.toFixed(1) + ',' + worldPos.z.toFixed(1) + ')');
        } catch (e) {
            print('ConnectedLensManager: Error handling remote card placed: ' + e);
        }
    }

    /** Handles a remote player returning a card to their collection. */
    private onRemoteCardReturned(msg: NetworkMessage<unknown>): void {
        const senderConnId = msg.senderConnectionId;
        const player = this.remotePlayers.get(senderConnId);

        try {
            const d = JSON.parse(msg.data as string);
            const serial: string = d.serial;
            if (!serial) return;

            // Force-clean every remote clone state for this serial (grabbed/world).
            // This is intentionally aggressive to prevent any ghost-card desync.
            this.cleanupRemoteCardClones(senderConnId, serial);

            // Re-show card in the remote carousel
            if (player) {
                for (let i = 0; i < player.remoteCardData.length; i++) {
                    if (player.remoteCardData[i].serial === serial && i < player.remoteCards.length) {
                        const carouselCard = player.remoteCards[i];
                        if (carouselCard) carouselCard.enabled = true;
                        break;
                    }
                }
            }

            print('ConnectedLensManager: Remote card returned to carousel — ' + serial);
        } catch (e) {
            print('ConnectedLensManager: Error handling remote card returned: ' + e);
        }
    }

    // =====================================================================
    // CLEANUP
    // =====================================================================

    private cleanupRemotePlayers(): void {
        this.remotePlayers.forEach((player: RemotePlayerData, _key: string) => {
            this.destroyRemoteCarousel(player);
            if (player.camDisplayObj) {
                try { player.camDisplayObj.destroy(); } catch (e) { /* ignore */ }
            }
            if (player.headDebugObj) {
                player.headDebugObj.enabled = false;
            }
        });
        this.remotePlayers.clear();
        this._remoteCardMeta.clear();
        this._imageChunkBuffers.clear();
        this._imageXferChunkBuffers.clear();
        this._pendingTradeSerial = '';
        this._pendingTradeImageB64 = '';

        // Cancel any outgoing give that hasn't completed
        if (this._pendingOutgoingGiveSerial.length > 0) {
            if (this._pendingOutgoingGiveTimer) {
                try { this._pendingOutgoingGiveTimer.enabled = false; } catch (e) { /* ignore */ }
                this._pendingOutgoingGiveTimer = null;
            }
            this._pendingOutgoingGiveSerial = '';
        }

        // Destroy all remote grabbed cards
        this._remoteGrabbedCards.forEach((anchor: SceneObject, _key: string) => {
            try { anchor.destroy(); } catch (e) { /* ignore */ }
        });
        this._remoteGrabbedCards.clear();

        // Destroy all remote world-placed cards
        this._remoteWorldCards.forEach((anchor: SceneObject, _key: string) => {
            try { anchor.destroy(); } catch (e) { /* ignore */ }
        });
        this._remoteWorldCards.clear();

        // Stop any remaining local billboard loops
        this._localGrabBillboardEvents.forEach((ev: SceneEvent, _obj: SceneObject) => {
            try { ev.enabled = false; } catch (e) { /* ignore */ }
        });
        this._localGrabBillboardEvents.clear();

        // Cancel any pending card exchange
        if (this.pendingGiveRequest) {
            print('ConnectedLensManager: Cancelling pending give request — session cleanup');
            this.pendingGiveRequest = null;
            if (this.confirmGiveContainer) this.confirmGiveContainer.enabled = false;
        }

        if (this.headDebugMesh) this.headDebugMesh.enabled = false;
        if (this.headDebugMeshCustom) this.headDebugMeshCustom.enabled = false;
        if (this.remotePlayerInfoContainer) this.remotePlayerInfoContainer.enabled = false;
    }
}
