/**
 * XPManager.ts — XP, Level & Profile system for DGNS Vehicle Scanner
 *
 * Handles:
 *   - User profile persistence (level, XP, prestige, daily streak)
 *   - XP calculation and attribution based on vehicle rarity
 *   - Level-up detection and notification
 *   - "+XP" popup animation on the camera-attached XP Display
 *   - User Card toggle (XP Container above head: level badge, XP bar, prestige)
 *   - Prestige reset (level 10 → level 1 + prestige star)
 *   - Daily login streak tracking with XP multiplier
 *
 * @author DGNS
 * @license MIT
 */

import {
    UserProfile, LevelDef,
    LEVEL_TABLE, XP_PER_RARITY,
    getLevelForXP, getXPForNextLevel, getStreakMultiplier,
    createDefaultProfile, formatPrestigeStars,
    TRUST_DEFAULT, getTrustRank, getTrustPenalty, TRUST_SCAN_REWARD,
    getTrustColor, formatTrustText,
} from './VehicleTypes';
import { t, tf } from './Localization';

@component
export class XPManager extends BaseScriptComponent {

    // =====================================================================
    // INPUTS — XP Container (above-head profile display)
    // =====================================================================
    @input
    @allowUndefined
    @hint('XP Container SceneObject (above head — contains Level Badge, Level Number, XP counter, XP Bar)')
    xpContainer: SceneObject;

    @input
    @allowUndefined
    @hint('"Level Number" Text component inside XP Container')
    levelNumberText: Text;

    @input
    @allowUndefined
    @hint('"XP counter" Text component inside XP Container')
    xpCounterText: Text;

    @input
    @allowUndefined
    @hint('"XP Bar" parent SceneObject inside XP Container (contains 5 Plane children)')
    xpBarParent: SceneObject;

    @input
    @allowUndefined
    @hint('"Level Badge" SceneObject inside XP Container')
    levelBadge: SceneObject;

    @input
    @hint('Public URL template for level badge PNG. Use {level}. Example: https://.../level-badges/lvl-{level}.png')
    levelBadgeUrlTemplate: string = '';

    @input
    @hint('Pad digits for {level} in badge URL template. Example: 2 => 01, 50')
    levelBadgePadDigits: number = 2;

    @input
    @allowUndefined
    @hint('Optional reveal badge object shown in front of camera on level-up (Image or RenderMeshVisual).')
    levelUpBadgeReveal: SceneObject;

    @input
    @allowUndefined
    @hint('Optional Level Up title text (e.g. LEVEL UP!).')
    levelUpTitleText: Text;

    @input
    @allowUndefined
    @hint('Optional Level Up body text (e.g. from level X to Y).')
    levelUpBodyText: Text;

    @input
    @hint('Level-up popup hold duration in seconds (excluding fade-in/out)')
    levelUpRevealHoldDuration: number = 2.6;

    // =====================================================================
    // INPUTS — XP Display (camera-attached floating popup)
    // =====================================================================
    @input
    @allowUndefined
    @hint('"XP Display" Text component attached to Camera Object (floating +XP popup)')
    xpDisplay: Text;

    // =====================================================================
    // INPUTS — User Card Info (hand-mounted profile card)
    // =====================================================================
    @input
    @allowUndefined
    @hint('"User Card Info" SceneObject on the hand (contains Level Badge, Level Number, XP counter, XP Bar)')
    userCardInfo: SceneObject;

    @input
    @allowUndefined
    @hint('"Acknowledge button" SceneObject inside User Card Info — closes the card')
    acknowledgeButton: SceneObject;

    // =====================================================================
    // INPUTS — User Card Button (on hand)
    // =====================================================================
    @input
    @allowUndefined
    @hint('"User Card Button" SceneObject on the hand (toggles User Card Info)')
    userCardButton: SceneObject;

    @input
    @allowUndefined
    @hint('"Prestige Button" SceneObject inside User Card Info — only visible at max level')
    prestigeButton: SceneObject;

    @input
    @allowUndefined
    @hint('"User Card" Text child inside User Card Button')
    userCardText: Text;

    // =====================================================================
    // CALLBACKS — Set by orchestrator
    // =====================================================================
    /** Called when XP is gained. Params: (amount, newTotalXP). */
    onXPGained: ((amount: number, newTotal: number) => void) | null = null;
    /** Called when the player levels up. Params: (newLevel, levelName). */
    onLevelUp: ((newLevel: number, levelName: string) => void) | null = null;
    /** Called to connect a button (utility from VehicleCardUI). */
    onConnectButton: ((obj: SceneObject, cb: () => void, name: string) => boolean) | null = null;
    /** Called to sync profile to cloud after XP changes. */
    onCloudSyncProfile: ((profile: UserProfile) => void) | null = null;
    /** Called when a positive XP/Trust popup is queued. */
    onPositiveProgress: (() => void) | null = null;
    /** Called when a negative Trust popup is queued. */
    onNegativeProgress: (() => void) | null = null;
    /** Called when the User Card is opened (so other UI can react). */
    onUserCardOpened: (() => void) | null = null;
    /** Called when the User Card is closed (so other UI can react). */
    onUserCardClosed: (() => void) | null = null;
    /** Called to get user head transform for positioning containers in front of gaze. */
    onGetUserHeadTransform: (() => { position: vec3; forward: vec3; rotation: quat } | null) | null = null;

    // =====================================================================
    // CONSTANTS
    // =====================================================================
    private readonly STORAGE_KEY: string = 'dgns_user_profile';
    private readonly MAX_LEVEL: number = 50;

    // =====================================================================
    // INPUTS — Username Text (inside XP Container, above head)
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Username" Text component inside XP Container (displays Snapchat display name)')
    usernameText: Text;

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private profile: UserProfile = createDefaultProfile();
    private isUserCardVisible: boolean = false;
    private userCardButtonConnected: boolean = false;
    private userCardChildrenResolved: boolean = false;
    private prestigeButtonConnected: boolean = false;
    private cachedUsername: string = '';

    // Trust score — stored inside profile (no separate key)

    // Auto-resolved from userCardInfo children
    private bonusInfoText: Text | null = null;
    private usernameInfoText: Text | null = null;
    private trustInfoText: Text | null = null;
    private userCardLevelBadge: SceneObject | null = null;

    private remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule');
    private internetModule: InternetModule = require('LensStudio:InternetModule');
    private badgeTextureCache: Map<number, Texture> = new Map();
    private badgeLoadingLevels: Set<number> = new Set();
    private badgePendingCallbacks: Map<number, Array<(tex: Texture) => void>> = new Map();
    private lastAppliedBadgeLevel: number = -1;
    private lastAppliedUserCardBadgeLevel: number = -1;
    private levelUpRevealQueue: Array<{ from: number; to: number; toName: string }> = [];
    private isShowingLevelUpReveal: boolean = false;
    private levelUpRevealAnimEvent: SceneEvent | null = null;

    

    // XP popup animation state
    private popupQueue: Array<{ text: string; r: number; g: number; b: number; hold?: number; drift?: number }> = [];
    private isShowingPopup: boolean = false;
    private popupAnimEvent: SceneEvent | null = null;

    // Welcome bonus popup state
    private welcomeBonusAnimEvent: SceneEvent | null = null;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        // Hide XP Display at startup (camera-attached popup)
        if (this.xpDisplay) {
            const displayObj = this.xpDisplay.getSceneObject();
            if (displayObj) displayObj.enabled = false;
        }
        if (this.xpContainer) this.xpContainer.enabled = false;
        if (this.levelUpBadgeReveal) this.levelUpBadgeReveal.enabled = false;
        if (this.levelUpTitleText) {
            const obj = this.levelUpTitleText.getSceneObject();
            if (obj) obj.enabled = false;
        }
        if (this.levelUpBodyText) {
            const obj = this.levelUpBodyText.getSceneObject();
            if (obj) obj.enabled = false;
        }

        this.fetchUsername();

        this.createEvent('OnStartEvent').bind(() => {
            // Hide User Card Info AFTER children have initialized (not in onAwake)
            if (this.userCardInfo) this.userCardInfo.enabled = false;
            this.resolveLevelUpRevealInputs();

            this.loadProfile();
            this.migrateOldTrust();
            this.updateDailyStreak();
            this.setupUserCardButton();
            this.setupAcknowledgeButton();
            this.setupPrestigeButton();
            this.refreshUserCardUI();
            this.hookFrameCloseButton();
            this.showWelcomeBonusPopup();

            print('XPManager: Profile loaded — LVL ' + this.profile.level
                + ' | XP ' + this.profile.totalXP
                + ' | Prestige ' + this.profile.prestige
                + ' | Streak ' + this.profile.streakDays + 'd'
                + ' | Trust ' + this.profile.trustScore + '%');
        });
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /**
     * Awards XP for scanning a vehicle with the given rarity (1-5).
     * Applies daily streak multiplier. Checks for level-up.
     * Shows the +XP popup on the camera display.
     */
    awardScanXP(rarity: number): void {
        const baseXP = XP_PER_RARITY[rarity] || XP_PER_RARITY[2];
        const multiplier = getStreakMultiplier(this.profile.streakDays);
        const finalXP = Math.round(baseXP * multiplier);

        this.profile.totalScans = (this.profile.totalScans || 0) + 1;

        print('XPManager: Award scan XP — rarity=' + rarity
            + ' base=' + baseXP + ' mult=' + multiplier.toFixed(1)
            + ' final=' + finalXP + ' totalScans=' + this.profile.totalScans);

        this.addXP(finalXP);
    }

    // =====================================================================
    // TRADE XP — Anti-farming safeguards
    // =====================================================================
    private tradedSerials: Set<string> = new Set();
    private tradeXPCount: number = 0;
    private lastTradeTime: number = 0;
    private readonly TRADE_XP_AMOUNT = 15;
    private readonly GIVE_XP_AMOUNT = 25;
    private readonly TRADE_COOLDOWN_MS = 60000; // 60 seconds between trade XP
    private readonly MAX_TRADE_XP_PER_SESSION = 10;

    /**
     * Awards XP for a card trade, with anti-farming safeguards:
     * - Fixed 15 XP (not affected by rarity or streak multiplier)
     * - 60 second cooldown between XP-eligible trades
     * - No XP for a card serial already received by trade
     * - Max 10 trade XP awards per session
     * @returns true if XP was awarded, false if blocked by safeguard
     */
    awardTradeXP(cardSerial?: string): boolean {
        const now = Date.now();

        // Check: serial already traded?
        if (cardSerial && this.tradedSerials.has(cardSerial)) {
            print('XPManager: Trade XP blocked — serial "' + cardSerial + '" already traded');
            return false;
        }

        // Check: session limit
        if (this.tradeXPCount >= this.MAX_TRADE_XP_PER_SESSION) {
            print('XPManager: Trade XP blocked — session limit reached (' + this.MAX_TRADE_XP_PER_SESSION + ')');
            return false;
        }

        // Check: cooldown
        if (now - this.lastTradeTime < this.TRADE_COOLDOWN_MS) {
            const remaining = Math.ceil((this.TRADE_COOLDOWN_MS - (now - this.lastTradeTime)) / 1000);
            print('XPManager: Trade XP blocked — cooldown (' + remaining + 's remaining)');
            return false;
        }

        // All checks passed — award XP
        if (cardSerial) this.tradedSerials.add(cardSerial);
        this.tradeXPCount++;
        this.lastTradeTime = now;
        this.profile.totalTrades = (this.profile.totalTrades || 0) + 1;
        this.profile.cardsReceived = (this.profile.cardsReceived || 0) + 1;

        print('XPManager: Trade XP awarded — +' + this.TRADE_XP_AMOUNT
            + ' (trade ' + this.tradeXPCount + '/' + this.MAX_TRADE_XP_PER_SESSION
            + ', totalTrades=' + this.profile.totalTrades + ')');
        this.addXP(this.TRADE_XP_AMOUNT);
        return true;
    }

    /**
     * Awards XP for GIVING a card (more generous than receiving).
     * Uses the same anti-farming safeguards as awardTradeXP.
     */
    awardGiveXP(cardSerial?: string): boolean {
        const now = Date.now();

        if (cardSerial && this.tradedSerials.has(cardSerial)) {
            print('XPManager: Give XP blocked — serial "' + cardSerial + '" already traded');
            return false;
        }
        if (this.tradeXPCount >= this.MAX_TRADE_XP_PER_SESSION) {
            print('XPManager: Give XP blocked — session limit reached');
            return false;
        }
        if (now - this.lastTradeTime < this.TRADE_COOLDOWN_MS) {
            return false;
        }

        if (cardSerial) this.tradedSerials.add(cardSerial);
        this.tradeXPCount++;
        this.lastTradeTime = now;
        this.profile.totalTrades = (this.profile.totalTrades || 0) + 1;
        this.profile.cardsGiven = (this.profile.cardsGiven || 0) + 1;

        print('XPManager: Give XP awarded — +' + this.GIVE_XP_AMOUNT
            + ' (trade ' + this.tradeXPCount + '/' + this.MAX_TRADE_XP_PER_SESSION + ')');
        this.addXP(this.GIVE_XP_AMOUNT);
        return true;
    }

    /** Returns the current user profile (read-only copy). */
    getProfile(): UserProfile {
        return {
            level: this.profile.level,
            totalXP: this.profile.totalXP,
            prestige: this.profile.prestige,
            lastLoginDate: this.profile.lastLoginDate,
            streakDays: this.profile.streakDays,
            totalScans: this.profile.totalScans || 0,
            totalTrades: this.profile.totalTrades || 0,
            trustScore: this.profile.trustScore,
            consecutiveCheats: this.profile.consecutiveCheats,
            totalCheats: this.profile.totalCheats || 0,
            cardsGiven: this.profile.cardsGiven || 0,
            cardsReceived: this.profile.cardsReceived || 0,
        };
    }

    /** Returns the current level definition. */
    getCurrentLevelDef(): LevelDef {
        return getLevelForXP(this.profile.totalXP);
    }

    getLevelBadgeUrl(level: number): string {
        if (!this.levelBadgeUrlTemplate || this.levelBadgeUrlTemplate.length < 8) return '';
        const clamped = Math.max(1, Math.min(this.MAX_LEVEL, Math.round(level)));
        let lvl = String(clamped);
        if (this.levelBadgePadDigits > 1) {
            lvl = lvl.padStart(this.levelBadgePadDigits, '0');
        }
        return this.levelBadgeUrlTemplate.replace('{level}', lvl);
    }

    private loadBadgeTexture(level: number, onReady: (tex: Texture) => void): void {
        const clamped = Math.max(1, Math.min(this.MAX_LEVEL, Math.round(level)));
        const cached = this.badgeTextureCache.get(clamped);
        if (cached) {
            onReady(cached);
            return;
        }

        const url = this.getLevelBadgeUrl(clamped);
        if (!url || !this.remoteMediaModule || !this.internetModule) return;

        if (!this.badgePendingCallbacks.has(clamped)) {
            this.badgePendingCallbacks.set(clamped, []);
        }
        this.badgePendingCallbacks.get(clamped)!.push(onReady);

        if (this.badgeLoadingLevels.has(clamped)) return;
        this.badgeLoadingLevels.add(clamped);

        try {
            const req = RemoteServiceHttpRequest.create();
            req.url = url;
            req.setHeader('User-Agent', 'LensStudio/5.15 DGNS/LevelBadge');
            this.internetModule.performHttpRequest(req, (res: RemoteServiceHttpResponse) => {
                if (res.statusCode < 200 || res.statusCode >= 400) {
                    this.badgeLoadingLevels.delete(clamped);
                    return;
                }
                try {
                    const resource = res.asResource();
                    this.remoteMediaModule.loadResourceAsImageTexture(
                        resource,
                        (texture: Texture) => {
                            this.badgeTextureCache.set(clamped, texture);
                            this.badgeLoadingLevels.delete(clamped);
                            const callbacks = this.badgePendingCallbacks.get(clamped) || [];
                            this.badgePendingCallbacks.delete(clamped);
                            for (let i = 0; i < callbacks.length; i++) {
                                callbacks[i](texture);
                            }
                        },
                        (_err: string) => {
                            this.badgeLoadingLevels.delete(clamped);
                            this.badgePendingCallbacks.delete(clamped);
                        }
                    );
                } catch (e) {
                    this.badgeLoadingLevels.delete(clamped);
                    this.badgePendingCallbacks.delete(clamped);
                }
            });
        } catch (e) {
            this.badgeLoadingLevels.delete(clamped);
            this.badgePendingCallbacks.delete(clamped);
        }
    }

    private applyBadgeTextureToObject(target: SceneObject | null, tex: Texture): void {
        if (!target) return;
        try {
            const imgComp = target.getComponent('Component.Image') as Image;
            if (imgComp && imgComp.mainMaterial && imgComp.mainPass) {
                imgComp.mainMaterial = imgComp.mainMaterial.clone();
                imgComp.mainPass.baseTex = tex;
                target.enabled = true;
                return;
            }
            const meshComp = target.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
            if (meshComp && meshComp.mainMaterial && meshComp.mainPass) {
                meshComp.mainMaterial = meshComp.mainMaterial.clone();
                meshComp.mainPass.baseTex = tex;
                target.enabled = true;
                return;
            }
        } catch (e) { /* ignore */ }
    }

    private updateLocalLevelBadges(level: number): void {
        if (level !== this.lastAppliedBadgeLevel) {
            this.lastAppliedBadgeLevel = level;
            this.loadBadgeTexture(level, (tex: Texture) => this.applyBadgeTextureToObject(this.levelBadge, tex));
        }
        if (this.userCardLevelBadge && level !== this.lastAppliedUserCardBadgeLevel) {
            this.lastAppliedUserCardBadgeLevel = level;
            this.loadBadgeTexture(level, (tex: Texture) => this.applyBadgeTextureToObject(this.userCardLevelBadge, tex));
        }
    }

    /**
     * Performs a prestige reset: level back to 1, XP to 0, prestige +1.
     * Only available at level 10.
     */
    prestigeReset(): void {
        if (this.profile.level < this.MAX_LEVEL) {
            print('XPManager: Prestige not available — not level ' + this.MAX_LEVEL);
            return;
        }

        this.profile.prestige++;
        this.profile.totalXP = 0;
        this.profile.level = 1;
        this.saveProfile();
        this.refreshUserCardUI();

        print('XPManager: PRESTIGE RESET — now prestige ' + this.profile.prestige);

        if (this.onLevelUp) {
            this.onLevelUp(1, tf('prestige_up', { n: this.profile.prestige }));
        }
    }

    /**
     * Full profile reset — wipes XP, level, streak, scans, trades back to zero.
     * Used when the user resets their entire profile & collection.
     */
    fullReset(): void {
        this.profile.level = 1;
        this.profile.totalXP = 0;
        this.profile.prestige = 0;
        this.profile.streakDays = 0;
        this.profile.totalScans = 0;
        this.profile.totalTrades = 0;
        this.profile.lastLoginDate = '';
        // trustScore, consecutiveCheats, totalCheats persist through reset (anti-cheat)
        this.profile.cardsGiven = 0;
        this.profile.cardsReceived = 0;
        this.saveProfile();
        this.refreshUserCardUI();
        print('XPManager: [RESET] Full profile reset — level 1, XP 0 (trust ' + this.profile.trustScore + '%, cheats ' + this.profile.totalCheats + ' preserved)');
    }

    /** Toggles the User Card Info visibility. */
    toggleUserCard(): void {
        this.isUserCardVisible = !this.isUserCardVisible;
        if (this.userCardInfo) {
            if (this.isUserCardVisible) {
                this.positionInFrontOfUser(this.userCardInfo);
            }
            this.userCardInfo.enabled = this.isUserCardVisible;
            if (this.isUserCardVisible) {
                this.enableAllChildren(this.userCardInfo);
                this.hookCloseButtonOnShow();
            }
        }
        if (this.isUserCardVisible) {
            this.refreshUserCardUI();
            if (this.onUserCardOpened) this.onUserCardOpened();
        } else {
            if (this.onUserCardClosed) this.onUserCardClosed();
        }
        print('XPManager: User Card ' + (this.isUserCardVisible ? 'shown' : 'hidden'));
    }

    /** Hides the User Card Info (called by Acknowledge button). */
    hideUserCard(): void {
        this.isUserCardVisible = false;
        if (this.userCardInfo) {
            this.userCardInfo.enabled = false;
        }
        if (this.onUserCardClosed) this.onUserCardClosed();
        print('XPManager: User Card hidden (acknowledged)');
    }

    private positionInFrontOfUser(container: SceneObject): void {
        if (!this.onGetUserHeadTransform) return;
        const head = this.onGetUserHeadTransform();
        if (!head) return;
        try {
            const spawnPos = head.position.add(head.forward.uniformScale(60));
            const transform = container.getTransform();
            transform.setWorldPosition(spawnPos);
            transform.setWorldRotation(quat.quatIdentity());
        } catch (e) { /* ignore */ }
    }

    /** Recursively enables all children of a SceneObject. */
    private enableAllChildren(parent: SceneObject): void {
        const count = parent.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = parent.getChild(i);
            if (child) {
                child.enabled = true;
                this.enableAllChildren(child);
            }
        }
    }

    // =====================================================================
    // XP LOGIC
    // =====================================================================

    private readonly MAX_XP: number = 10000000;

    private addXP(amount: number): void {
        if (amount <= 0) return;
        const previousLevel = this.profile.level;
        this.profile.totalXP = Math.min(this.profile.totalXP + amount, this.MAX_XP);

        const newLevelDef = getLevelForXP(this.profile.totalXP);
        this.profile.level = newLevelDef.level;

        this.saveProfile();

        if (this.onCloudSyncProfile) this.onCloudSyncProfile(this.getProfile());

        this.enqueueXPPopup(amount);

        if (this.onXPGained) this.onXPGained(amount, this.profile.totalXP);

        // Notify each intermediate level-up
        if (this.profile.level > previousLevel) {
            for (let lvl = previousLevel + 1; lvl <= this.profile.level; lvl++) {
                const idx = Math.min(lvl - 1, LEVEL_TABLE.length - 1);
                const lvlDef = LEVEL_TABLE[idx];
                print('XPManager: LEVEL UP! ' + (lvl - 1) + ' -> ' + lvl + ' (' + lvlDef.name + ')');
                if (this.onLevelUp) this.onLevelUp(lvl, lvlDef.name);
                this.enqueueLevelUpReveal(lvl - 1, lvl, lvlDef.name);
            }
        }

        if (this.isUserCardVisible) {
            this.refreshUserCardUI();
        }
    }

    private enqueueLevelUpReveal(fromLevel: number, toLevel: number, toName: string): void {
        this.levelUpRevealQueue.push({ from: fromLevel, to: toLevel, toName: toName });
        if (!this.isShowingLevelUpReveal) {
            this.showNextLevelUpReveal();
        }
    }

    private showNextLevelUpReveal(): void {
        if (this.levelUpRevealQueue.length === 0) {
            this.isShowingLevelUpReveal = false;
            return;
        }
        this.isShowingLevelUpReveal = true;
        const item = this.levelUpRevealQueue.shift()!;
        this.resolveLevelUpRevealInputs();

        // Fallback text popup if reveal UI is not wired
        if (!this.levelUpBadgeReveal || !this.levelUpTitleText || !this.levelUpBodyText) {
            this.enqueueCustomPopup(
                tf('level_up_reveal_body', { from: item.from, to: item.to, name: item.toName }),
                1, 1, 1, 2.5, 1
            );
            this.showNextLevelUpReveal();
            return;
        }

        this.levelUpTitleText.text = t('level_up_reveal_title');
        this.levelUpBodyText.text = tf('level_up_reveal_body', { from: item.from, to: item.to, name: item.toName });
        this.levelUpBadgeReveal.enabled = true;
        const titleObj = this.levelUpTitleText.getSceneObject();
        const bodyObj = this.levelUpBodyText.getSceneObject();
        titleObj.enabled = true;
        bodyObj.enabled = true;
        // Use Inspector-authored transform values for position/scale on all reveal elements.
        const baseBadgeScale = this.levelUpBadgeReveal.getTransform().getLocalScale();
        this.setObjectOpacity(this.levelUpBadgeReveal, 0);
        this.setTextOpacity(this.levelUpTitleText, 0);
        this.setTextOpacity(this.levelUpBodyText, 0);
        this.levelUpBadgeReveal.getTransform().setLocalScale(new vec3(
            baseBadgeScale.x * 0.01,
            baseBadgeScale.y * 0.01,
            baseBadgeScale.z * 0.01
        ));

        this.loadBadgeTexture(item.to, (tex: Texture) => {
            this.applyBadgeTextureToObject(this.levelUpBadgeReveal, tex);
        });

        if (this.levelUpRevealAnimEvent) {
            try { this.levelUpRevealAnimEvent.enabled = false; } catch (e) { /* ignore */ }
            this.levelUpRevealAnimEvent = null;
        }

        const start = getTime();
        const IN = 0.35;
        const HOLD = Math.max(0.1, this.levelUpRevealHoldDuration);
        const OUT = 0.55;
        const TOTAL = IN + HOLD + OUT;
        this.levelUpRevealAnimEvent = this.createEvent('UpdateEvent');
        this.levelUpRevealAnimEvent.bind(() => {
            const e = getTime() - start;
            if (e < IN) {
                const tt = e / IN;
                const eased = 1.0 - Math.pow(1.0 - tt, 3.0);
                const mult = 1.12 * eased;
                this.levelUpBadgeReveal.getTransform().setLocalScale(new vec3(
                    baseBadgeScale.x * mult,
                    baseBadgeScale.y * mult,
                    baseBadgeScale.z * mult
                ));
                this.setObjectOpacity(this.levelUpBadgeReveal, eased);
                this.setTextOpacity(this.levelUpTitleText, eased);
                this.setTextOpacity(this.levelUpBodyText, eased);
            } else if (e < IN + 0.12) {
                const tt = (e - IN) / 0.12;
                const mult = 1.12 - 0.12 * tt;
                this.levelUpBadgeReveal.getTransform().setLocalScale(new vec3(
                    baseBadgeScale.x * mult,
                    baseBadgeScale.y * mult,
                    baseBadgeScale.z * mult
                ));
                this.setObjectOpacity(this.levelUpBadgeReveal, 1);
                this.setTextOpacity(this.levelUpTitleText, 1);
                this.setTextOpacity(this.levelUpBodyText, 1);
            } else if (e < IN + HOLD) {
                this.levelUpBadgeReveal.getTransform().setLocalScale(baseBadgeScale);
                this.setObjectOpacity(this.levelUpBadgeReveal, 1);
                this.setTextOpacity(this.levelUpTitleText, 1);
                this.setTextOpacity(this.levelUpBodyText, 1);
            } else if (e < TOTAL) {
                const tt = (e - IN - HOLD) / OUT;
                const fade = 1.0 - (tt * tt);
                this.setObjectOpacity(this.levelUpBadgeReveal, fade);
                this.setTextOpacity(this.levelUpTitleText, fade);
                this.setTextOpacity(this.levelUpBodyText, fade);
            } else {
                this.levelUpBadgeReveal.enabled = false;
                this.levelUpTitleText.getSceneObject().enabled = false;
                this.levelUpBodyText.getSceneObject().enabled = false;
                if (this.levelUpRevealAnimEvent) {
                    try { this.levelUpRevealAnimEvent.enabled = false; } catch (e2) { /* ignore */ }
                    this.levelUpRevealAnimEvent = null;
                }
                this.showNextLevelUpReveal();
            }
        });
    }

    private resolveLevelUpRevealInputs(): void {
        if (!this.levelUpBadgeReveal) {
            this.levelUpBadgeReveal = this.findSceneObjectByName('Badge Reveal');
            if (this.levelUpBadgeReveal) {
                print('XPManager: Auto-resolved levelUpBadgeReveal');
                this.levelUpBadgeReveal.enabled = false;
            }
        }
        if (!this.levelUpTitleText) {
            const titleObj = this.findSceneObjectByName('Level Up Title');
            if (titleObj) {
                const textComp = titleObj.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.levelUpTitleText = textComp;
                    print('XPManager: Auto-resolved levelUpTitleText');
                    titleObj.enabled = false;
                }
            }
        }
        if (!this.levelUpBodyText) {
            const bodyObj = this.findSceneObjectByName('Level Up Body text');
            if (bodyObj) {
                const textComp = bodyObj.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.levelUpBodyText = textComp;
                    print('XPManager: Auto-resolved levelUpBodyText');
                    bodyObj.enabled = false;
                }
            }
        }
    }

    private findSceneObjectByName(targetName: string): SceneObject | null {
        try {
            const count = global.scene.getRootObjectsCount();
            for (let i = 0; i < count; i++) {
                const root = global.scene.getRootObject(i);
                if (!root) continue;
                const found = this.findSceneObjectByNameRecursive(root, targetName.toLowerCase());
                if (found) return found;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    private findSceneObjectByNameRecursive(obj: SceneObject, targetLower: string): SceneObject | null {
        if (obj.name && obj.name.toLowerCase() === targetLower) return obj;
        const count = obj.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = obj.getChild(i);
            if (!child) continue;
            const found = this.findSceneObjectByNameRecursive(child, targetLower);
            if (found) return found;
        }
        return null;
    }

    // =====================================================================
    // USER CARD UI — User Card Info display
    // =====================================================================

    // =====================================================================
    // USERNAME — Snapchat display name via UserContextSystem
    // =====================================================================

    private fetchUsername(): void {
        try {
            const ucs = (global as any).userContextSystem;
            if (ucs && typeof ucs.requestDisplayName === 'function') {
                ucs.requestDisplayName((name: string) => {
                    if (name && typeof name === 'string' && name.trim().length > 0) {
                        this.cachedUsername = name.trim();
                        print('XPManager: Username = "' + this.cachedUsername + '"');
                        this.updateUsernameDisplay();
                    } else {
                        print('XPManager: requestDisplayName returned empty');
                    }
                });
                print('XPManager: requestDisplayName() called...');
            } else {
                print('XPManager: UserContextSystem.requestDisplayName not available');
            }
        } catch (e) {
            print('XPManager: Username fetch error: ' + e);
        }
    }

    /** Returns the cached Snapchat display name, or empty string if not yet available. */
    getUsername(): string {
        return this.cachedUsername;
    }

    // =====================================================================
    // TRUST SCORE — Anti-cheat reputation
    // =====================================================================

    getTrustScore(): number { return this.profile.trustScore; }
    getConsecutiveCheats(): number { return this.profile.consecutiveCheats; }

    /** Called when anti-cheat detects a cheat attempt. */
    penalizeTrust(): void {
        const penalty = getTrustPenalty(this.profile.consecutiveCheats);
        this.profile.consecutiveCheats++;
        this.profile.totalCheats = (this.profile.totalCheats || 0) + 1;
        this.profile.trustScore = Math.max(0, this.profile.trustScore - penalty);
        print('XPManager: Trust penalty -' + penalty
            + ' → ' + this.profile.trustScore + '% (streak ' + this.profile.consecutiveCheats + ')');
        this.enqueueTrustPenaltyPopup(penalty);
        this.saveProfile();
        this.updateTrustDisplays();
    }

    /** Called when a vehicle is successfully scanned and saved. */
    rewardTrust(): void {
        this.profile.consecutiveCheats = 0;
        if (this.profile.trustScore < 100) {
            this.profile.trustScore = Math.min(100, this.profile.trustScore + TRUST_SCAN_REWARD);
            print('XPManager: Trust reward +' + TRUST_SCAN_REWARD + ' → ' + this.profile.trustScore + '%');
            this.enqueueTrustPopup();
        }
        this.saveProfile();
        this.updateTrustDisplays();
    }

    /** Returns formatted trust info for display on cards. */
    getTrustDisplayString(): string {
        const rank = getTrustRank(this.profile.trustScore);
        const name = this.cachedUsername.length > 0 ? this.cachedUsername : 'Driver';
        return name + '\n' + rank.name + ' | ' + formatTrustText(this.profile.trustScore);
    }

    /** Returns a compact trust string for the User Card Info. */
    getTrustCardString(): string {
        const rank = getTrustRank(this.profile.trustScore);
        return rank.name + '\n' + formatTrustText(this.profile.trustScore);
    }

    private migrateOldTrust(): void {
        try {
            const json = global.persistentStorageSystem.store.getString('dgns_trust_score');
            if (json && json.length > 0) {
                const parsed = JSON.parse(json);
                if (typeof parsed.score === 'number') this.profile.trustScore = parsed.score;
                if (typeof parsed.cheats === 'number') this.profile.consecutiveCheats = parsed.cheats;
                global.persistentStorageSystem.store.putString('dgns_trust_score', '');
                print('XPManager: Migrated old trust data into profile');
                this.saveProfile();
            }
        } catch (e) {
            print('XPManager: Old trust migration skipped: ' + e);
        }
    }

    private updateTrustDisplays(): void {
        this.updateUsernameDisplay();
        this.refreshUserCardUI();
    }

    private updateUsernameDisplay(): void {
        if (this.usernameText && this.cachedUsername.length > 0) {
            this.usernameText.text = this.cachedUsername;
        }
        if (this.usernameInfoText && this.cachedUsername.length > 0) {
            this.usernameInfoText.text = this.cachedUsername;
        }
        if (this.trustInfoText) {
            this.trustInfoText.text = this.getTrustCardString();
            this.applyTrustColor(this.trustInfoText);
        }
    }

    private applyTrustColor(textComp: Text): void {
        try {
            const hex = getTrustColor(this.profile.trustScore);
            const r = parseInt(hex.substring(0, 2), 16) / 255;
            const g = parseInt(hex.substring(2, 4), 16) / 255;
            const b = parseInt(hex.substring(4, 6), 16) / 255;
            textComp.textFill.color = new vec4(r, g, b, 1);
        } catch (e) { /* ignore — some platforms don't support textFill */ }
    }

    /**
     * Auto-resolves child components from userCardInfo by name.
     * This ensures it works even if the @input text/bar references are not
     * manually assigned (or point to the wrong objects).
     */
    private resolveUserCardChildren(): void {
        if (this.userCardChildrenResolved || !this.userCardInfo) return;

        const childCount = this.userCardInfo.getChildrenCount();
        print('XPManager: Resolving User Card Info children (' + childCount + ' direct children)');

        for (let i = 0; i < childCount; i++) {
            const child = this.userCardInfo.getChild(i);
            if (!child) continue;
            const name = child.name.toLowerCase();

            if (name.indexOf('level number') >= 0 || name.indexOf('levelnumber') >= 0) {
                const textComp = child.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.levelNumberText = textComp;
                    print('XPManager: Auto-resolved levelNumberText from "' + child.name + '"');
                }
            }
            if (name.indexOf('xp counter') >= 0 || name.indexOf('xpcounter') >= 0 || name.indexOf('xp_counter') >= 0) {
                const textComp = child.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.xpCounterText = textComp;
                    print('XPManager: Auto-resolved xpCounterText from "' + child.name + '"');
                }
            }
            if (name.indexOf('xp bar') >= 0 || name.indexOf('xpbar') >= 0) {
                this.xpBarParent = child;
                print('XPManager: Auto-resolved xpBarParent from "' + child.name + '"');
            }
            if (name.indexOf('level badge') >= 0 || name.indexOf('levelbadge') >= 0) {
                this.userCardLevelBadge = child;
                print('XPManager: Auto-resolved userCardLevelBadge from "' + child.name + '"');
            }
            if (name.indexOf('bonus info') >= 0 || name.indexOf('bonusinfo') >= 0 || name.indexOf('bonus_info') >= 0) {
                const textComp = child.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.bonusInfoText = textComp;
                    print('XPManager: Auto-resolved bonusInfoText from "' + child.name + '"');
                }
            }
            if (name.indexOf('username') >= 0 && name.indexOf('scanned') < 0 && name.indexOf('trust') < 0) {
                const textComp = child.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.usernameInfoText = textComp;
                    print('XPManager: Auto-resolved usernameInfoText from "' + child.name + '"');
                    if (this.cachedUsername.length > 0) {
                        textComp.text = this.cachedUsername;
                    }
                }
            }
            if (name.indexOf('scanned by') >= 0 || name.indexOf('trust') >= 0) {
                const textComp = child.getComponent('Component.Text') as Text;
                if (textComp) {
                    this.trustInfoText = textComp;
                    print('XPManager: Auto-resolved trustInfoText from "' + child.name + '"');
                    textComp.text = this.getTrustCardString();
                    this.applyTrustColor(textComp);
                }
            }
        }

        this.userCardChildrenResolved = true;
    }

    private refreshUserCardUI(): void {
        // Auto-resolve children from userCardInfo on first call
        this.resolveUserCardChildren();

        const levelDef = getLevelForXP(this.profile.totalXP);
        const prestigeStr = formatPrestigeStars(this.profile.prestige);

        print('XPManager: refreshUI — LVL ' + levelDef.level + ' (' + levelDef.name + ')'
            + ' | XP ' + this.profile.totalXP
            + ' | inputs: levelText=' + !!this.levelNumberText
            + ' xpText=' + !!this.xpCounterText
            + ' xpBar=' + !!this.xpBarParent
            + ' badge=' + !!this.levelBadge);

        // Level Number: "LVL 5: Track Day Hero"
        if (this.levelNumberText) {
            let label = t('lvl_prefix') + levelDef.level + ': ' + levelDef.name;
            if (prestigeStr.length > 0) label = prestigeStr + ' ' + label;
            this.levelNumberText.text = label;
            const textObj = this.levelNumberText.getSceneObject();
            if (textObj) textObj.enabled = true;
        }

        // XP Counter: "XP 0/50"
        if (this.xpCounterText) {
            const nextThreshold = getXPForNextLevel(levelDef.level);
            if (nextThreshold < 0) {
                this.xpCounterText.text = tf('xp_max', { xp: this.profile.totalXP });
            } else {
                this.xpCounterText.text = tf('xp_progress', { xp: this.profile.totalXP, next: nextThreshold });
            }
            const textObj = this.xpCounterText.getSceneObject();
            if (textObj) textObj.enabled = true;
        }

        // XP Bar: fill 5 segments proportionally to progress within current level
        this.updateXPBar();

        // Level Badge: make sure it's visible
        if (this.levelBadge) {
            this.levelBadge.enabled = true;
        }
        if (this.userCardLevelBadge) {
            this.userCardLevelBadge.enabled = true;
        }
        this.updateLocalLevelBadges(levelDef.level);

        // Bonus Info: streak, multiplier
        if (this.bonusInfoText) {
            const mult = getStreakMultiplier(this.profile.streakDays);
            let bonusText = '';
            if (this.profile.streakDays >= 3) {
                bonusText = tf('streak_long', { days: this.profile.streakDays, mult: mult.toFixed(1) });
            } else if (this.profile.streakDays === 2) {
                bonusText = tf('streak_short', { mult: mult.toFixed(1) });
            } else {
                bonusText = t('no_streak');
            }
            if (this.profile.prestige > 0) {
                bonusText += '\n' + formatPrestigeStars(this.profile.prestige) + ' ' + t('prestige_label') + ' ' + this.profile.prestige;
            }
            this.bonusInfoText.text = bonusText;
            const textObj = this.bonusInfoText.getSceneObject();
            if (textObj) textObj.enabled = true;
        }

        // Username in XP Container (above head) and User Card Info
        this.updateUsernameDisplay();

        // Prestige button: only visible at max level
        this.updatePrestigeButtonVisibility();

        // User Card text on the hand button
        if (this.userCardText) {
            this.userCardText.text = t('lvl_prefix') + levelDef.level;
        }
    }

    private updateXPBar(): void {
        if (!this.xpBarParent) return;

        const levelDef = getLevelForXP(this.profile.totalXP);
        const currentThreshold = levelDef.xpThreshold;
        const nextThreshold = getXPForNextLevel(levelDef.level);

        let fillRatio = 1.0;
        if (nextThreshold > 0 && nextThreshold > currentThreshold) {
            const xpInLevel = this.profile.totalXP - currentThreshold;
            const xpNeeded = nextThreshold - currentThreshold;
            fillRatio = Math.max(0, Math.min(1, xpInLevel / xpNeeded));
        }

        // 5 segments: each represents 20% of the bar
        const segmentsFilled = Math.round(fillRatio * 5);
        const childCount = this.xpBarParent.getChildrenCount();
        let planeIndex = 0;
        for (let i = 0; i < childCount; i++) {
            const child = this.xpBarParent.getChild(i);
            if (!child) continue;
            if (!child.getComponent('Component.RenderMeshVisual')) continue;
            child.enabled = (planeIndex < segmentsFilled);
            planeIndex++;
        }
    }

    // =====================================================================
    // WELCOME BONUS POPUP — Shown at launch if the player has a streak
    // =====================================================================

    private showWelcomeBonusPopup(): void {
        const mult = getStreakMultiplier(this.profile.streakDays);

        // No bonus to show on day 1
        if (this.profile.streakDays <= 1) {
            print('XPManager: No streak bonus to show (day ' + this.profile.streakDays + ')');
            return;
        }

        if (!this.xpDisplay) {
            print('XPManager: No xpDisplay — cannot show welcome bonus');
            return;
        }

        const displayObj = this.xpDisplay.getSceneObject();
        if (!displayObj) return;

        // Build the bonus message
        let message = '';
        if (this.profile.streakDays >= 3) {
            message = tf('streak_bonus_long', { days: this.profile.streakDays, mult: mult.toFixed(1) });
        } else {
            message = tf('streak_bonus_short', { mult: mult.toFixed(1) });
        }

        print('XPManager: Showing welcome bonus — "' + message + '"');

        // Delay 2 seconds after launch so the user sees the welcome screen first
        const delayEvent = this.createEvent('DelayedCallbackEvent');
        (delayEvent as any).bind(() => {
            this.showWelcomePopupAnimation(message);
        });
        (delayEvent as any).reset(2.0);
    }

    private showWelcomePopupAnimation(message: string): void {
        if (!this.xpDisplay) return;
        const displayObj = this.xpDisplay.getSceneObject();
        if (!displayObj) return;

        // Setup text
        this.xpDisplay.text = message;
        displayObj.enabled = true;

        const transform = displayObj.getTransform();
        const startPos = transform.getLocalPosition();
        const startY = startPos.y;

        // Reset state
        transform.setLocalPosition(new vec3(startPos.x, startY, startPos.z));
        transform.setLocalScale(new vec3(0.01, 0.01, 0.01));
        this.setTextOpacity(this.xpDisplay, 0);

        // Cancel any previous welcome animation
        if (this.welcomeBonusAnimEvent) {
            try { this.welcomeBonusAnimEvent.enabled = false; } catch (e) { /* ignore */ }
            this.welcomeBonusAnimEvent = null;
        }

        const startTime = getTime();
        const FADE_IN = 0.5;
        const HOLD = 4.0;
        const FADE_OUT = 1.2;
        const TOTAL = FADE_IN + HOLD + FADE_OUT;

        this.welcomeBonusAnimEvent = this.createEvent('UpdateEvent');
        this.welcomeBonusAnimEvent.bind(() => {
            const elapsed = getTime() - startTime;

            if (elapsed < FADE_IN) {
                // Phase 1: Fade in + scale up (bounce effect)
                const t = elapsed / FADE_IN;
                const eased = 1.0 - Math.pow(1.0 - t, 3.0);
                const scale = eased * 1.1;
                transform.setLocalScale(new vec3(scale, scale, scale));
                this.setTextOpacity(this.xpDisplay, eased);
            } else if (elapsed < FADE_IN + 0.15) {
                // Bounce settle (overshoot → 1.0)
                const t = (elapsed - FADE_IN) / 0.15;
                const scale = 1.1 - 0.1 * t;
                transform.setLocalScale(new vec3(scale, scale, scale));
                this.setTextOpacity(this.xpDisplay, 1);
            } else if (elapsed < FADE_IN + HOLD) {
                // Phase 2: Hold at full visibility
                transform.setLocalScale(new vec3(1, 1, 1));
                this.setTextOpacity(this.xpDisplay, 1);
            } else if (elapsed < TOTAL) {
                // Phase 3: Fade out
                const t = (elapsed - FADE_IN - HOLD) / FADE_OUT;
                const eased = t * t;
                const opacity = 1.0 - eased;
                this.setTextOpacity(this.xpDisplay, opacity);
            } else {
                // Done
                displayObj.enabled = false;
                transform.setLocalPosition(new vec3(startPos.x, startY, startPos.z));
                transform.setLocalScale(new vec3(1, 1, 1));
                if (this.welcomeBonusAnimEvent) {
                    try { this.welcomeBonusAnimEvent.enabled = false; } catch (e) { /* ignore */ }
                    this.welcomeBonusAnimEvent = null;
                }
                print('XPManager: Welcome bonus popup finished');
            }
        });
    }

    // =====================================================================
    // XP POPUP ANIMATION — "+XX XP" floating text on camera
    // =====================================================================

    private readonly MAX_POPUP_QUEUE: number = 10;

    private enqueueXPPopup(amount: number): void {
        if (this.popupQueue.length >= this.MAX_POPUP_QUEUE) return;
        this.popupQueue.push({ text: tf('xp_popup', { amount: amount }), r: 1, g: 1, b: 1 });
        if (this.onPositiveProgress) this.onPositiveProgress();
        if (!this.isShowingPopup) {
            this.showNextPopup();
        }
    }

    private enqueueTrustPopup(): void {
        if (this.popupQueue.length >= this.MAX_POPUP_QUEUE) return;
        const hex = getTrustColor(this.profile.trustScore);
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        this.popupQueue.push({
            text: tf('trust_popup', { amount: TRUST_SCAN_REWARD }),
            r: r, g: g, b: b,
            hold: 2.5, drift: 1,
        });
        if (this.onPositiveProgress) this.onPositiveProgress();
        if (!this.isShowingPopup) {
            this.showNextPopup();
        }
    }

    private enqueueTrustPenaltyPopup(penalty: number): void {
        if (this.popupQueue.length >= this.MAX_POPUP_QUEUE) return;
        this.popupQueue.push({
            text: tf('trust_penalty', { amount: penalty }),
            r: 1, g: 0.15, b: 0.1,
            hold: 3.0, drift: -1,
        });
        if (this.onNegativeProgress) this.onNegativeProgress();
        if (!this.isShowingPopup) {
            this.showNextPopup();
        }
    }

    /**
     * Enqueues a custom message on the XP Display popup.
     * Used by Car Scanner for anti-cheat messages displayed before trust penalty.
     */
    enqueueCustomPopup(text: string, r: number, g: number, b: number, hold: number, drift: number): void {
        if (this.popupQueue.length >= this.MAX_POPUP_QUEUE) return;
        this.popupQueue.push({ text, r, g, b, hold, drift });
        if (!this.isShowingPopup) {
            this.showNextPopup();
        }
    }

    private showNextPopup(): void {
        if (this.popupQueue.length === 0) {
            this.isShowingPopup = false;
            return;
        }

        this.isShowingPopup = true;
        const entry = this.popupQueue.shift()!;

        if (!this.xpDisplay) {
            this.isShowingPopup = false;
            return;
        }

        const displayObj = this.xpDisplay.getSceneObject();
        if (!displayObj) {
            this.isShowingPopup = false;
            return;
        }

        // Setup text and color
        this.xpDisplay.text = entry.text;
        try { this.xpDisplay.textFill.color = new vec4(entry.r, entry.g, entry.b, 1); } catch (e) { /* ignore */ }
        displayObj.enabled = true;

        // Store initial position for drift animation
        const transform = displayObj.getTransform();
        const startPos = transform.getLocalPosition();
        const startY = startPos.y;

        // Reset
        transform.setLocalPosition(new vec3(startPos.x, startY, startPos.z));
        transform.setLocalScale(new vec3(0.01, 0.01, 0.01));
        this.setTextOpacity(this.xpDisplay, 0);

        // Cancel previous animation
        if (this.popupAnimEvent) {
            try { this.popupAnimEvent.enabled = false; } catch (e) { /* ignore */ }
            this.popupAnimEvent = null;
        }

        const startTime = getTime();
        const FADE_IN = 0.4;
        const HOLD = entry.hold || 2.0;
        const FADE_OUT = 1.0;
        const TOTAL = FADE_IN + HOLD + FADE_OUT;
        const DRIFT_DISTANCE = 3.0;
        const driftDir = entry.drift || 1;

        this.popupAnimEvent = this.createEvent('UpdateEvent');
        this.popupAnimEvent.bind(() => {
            const elapsed = getTime() - startTime;

            if (elapsed < FADE_IN) {
                const t = elapsed / FADE_IN;
                const eased = 1.0 - Math.pow(1.0 - t, 3.0);
                transform.setLocalScale(new vec3(eased, eased, eased));
                this.setTextOpacity(this.xpDisplay, eased);
            } else if (elapsed < FADE_IN + HOLD) {
                transform.setLocalScale(new vec3(1, 1, 1));
                this.setTextOpacity(this.xpDisplay, 1);
            } else if (elapsed < TOTAL) {
                const t = (elapsed - FADE_IN - HOLD) / FADE_OUT;
                const eased = t * t;
                const opacity = 1.0 - eased;
                const yOffset = eased * DRIFT_DISTANCE * driftDir;
                transform.setLocalPosition(new vec3(startPos.x, startY + yOffset, startPos.z));
                this.setTextOpacity(this.xpDisplay, opacity);
            } else {
                displayObj.enabled = false;
                transform.setLocalPosition(new vec3(startPos.x, startY, startPos.z));
                if (this.popupAnimEvent) {
                    try { this.popupAnimEvent.enabled = false; } catch (e) { /* ignore */ }
                    this.popupAnimEvent = null;
                }
                this.showNextPopup();
            }
        });
    }

    private setTextOpacity(textComp: Text, opacity: number): void {
        try {
            const color = textComp.textFill.color;
            textComp.textFill.color = new vec4(color.r, color.g, color.b, opacity);
        } catch (e) {
            // textFill may not be available in all Lens Studio versions
        }
    }

    private setObjectOpacity(obj: SceneObject, opacity: number): void {
        try {
            const imgComp = obj.getComponent('Component.Image') as Image;
            if (imgComp && imgComp.mainPass) {
                const c = imgComp.mainPass.baseColor;
                imgComp.mainPass.baseColor = new vec4(c.r, c.g, c.b, opacity);
            }
        } catch (e) { /* ignore */ }
        try {
            const meshComp = obj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
            if (meshComp && meshComp.mainPass) {
                const c = meshComp.mainPass.baseColor;
                meshComp.mainPass.baseColor = new vec4(c.r, c.g, c.b, opacity);
            }
        } catch (e) { /* ignore */ }
        const count = obj.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = obj.getChild(i);
            if (child) this.setObjectOpacity(child, opacity);
        }
    }

    // =====================================================================
    // USER CARD BUTTON
    // =====================================================================

    private setupUserCardButton(): void {
        if (!this.userCardButton) return;

        // Try immediate connection via orchestrator's connectButton utility
        if (this.onConnectButton) {
            const connected = this.onConnectButton(this.userCardButton, () => {
                print('XPManager: User Card Button pressed');
                this.toggleUserCard();
            }, 'UserCardButton');
            if (connected) {
                this.userCardButtonConnected = true;
                print('XPManager: User Card Button connected');
                return;
            }
        }

        // Fallback: polling for ScriptComponent events
        let attempts = 0;
        const maxAttempts = 300;
        const pollEvent = this.createEvent('UpdateEvent');
        pollEvent.bind(() => {
            if (this.userCardButtonConnected) { pollEvent.enabled = false; return; }
            attempts++;
            if (attempts > maxAttempts) { pollEvent.enabled = false; return; }

            try {
                const scripts = this.userCardButton.getComponents('Component.ScriptComponent') as any[];
                for (let i = 0; i < scripts.length; i++) {
                    const script = scripts[i];
                    if (!script) continue;
                    if (script.onButtonPinched && typeof script.onButtonPinched.add === 'function') {
                        script.onButtonPinched.add(() => {
                            print('XPManager: User Card Button pressed (pinch)');
                            this.toggleUserCard();
                        });
                        this.userCardButtonConnected = true;
                        pollEvent.enabled = false;
                        print('XPManager: User Card Button connected (pinch)');
                        return;
                    }
                    if (script.onTriggerUp && typeof script.onTriggerUp.add === 'function') {
                        script.onTriggerUp.add(() => {
                            print('XPManager: User Card Button pressed (trigger)');
                            this.toggleUserCard();
                        });
                        this.userCardButtonConnected = true;
                        pollEvent.enabled = false;
                        print('XPManager: User Card Button connected (trigger)');
                        return;
                    }
                }
            } catch (e) { /* polling */ }
        });
    }

    // =====================================================================
    // FRAME CLOSE BUTTON — Hooks Frame.ts close (X) button on User Card Info
    // =====================================================================

    // =====================================================================
    // PRESTIGE BUTTON — Only visible at max level
    // =====================================================================

    private setupPrestigeButton(): void {
        if (this.prestigeButton) this.prestigeButton.enabled = false;
        if (!this.prestigeButton || this.prestigeButtonConnected) return;

        if (this.onConnectButton) {
            const connected = this.onConnectButton(this.prestigeButton, () => {
                print('XPManager: Prestige button pressed');
                this.prestigeReset();
            }, 'PrestigeButton');
            if (connected) {
                this.prestigeButtonConnected = true;
                print('XPManager: Prestige button connected');
            }
        }
    }

    private updatePrestigeButtonVisibility(): void {
        if (!this.prestigeButton) return;
        this.prestigeButton.enabled = (this.profile.level >= this.MAX_LEVEL);
    }

    // =====================================================================
    // FRAME CLOSE BUTTON
    // =====================================================================

    private hookFrameCloseButton(): void {
        // Close button is hooked lazily when the container is first shown,
        // because Frame.ts only creates its buttons after OnStartEvent on an enabled object.
    }

    private _userCardCloseHooked: boolean = false;

    private hookCloseButtonOnShow(): void {
        if (this._userCardCloseHooked || !this.userCardInfo) return;
        let attempts = 0;
        const poll = this.createEvent('UpdateEvent');
        poll.bind(() => {
            attempts++;
            if (this._userCardCloseHooked || attempts > 120) { poll.enabled = false; return; }
            if (this.deepSearchAndHookClose(this.userCardInfo)) {
                this._userCardCloseHooked = true;
                poll.enabled = false;
            }
        });
    }

    private deepSearchAndHookClose(root: SceneObject): boolean {
        const count = root.getChildrenCount();
        for (let i = 0; i < count; i++) {
            const child = root.getChild(i);
            if (!child) continue;
            if (child.name === 'FrameObject') {
                if (this.searchCloseButtonIn(child)) return true;
            }
            if (this.deepSearchAndHookClose(child)) return true;
        }
        return false;
    }

    private searchCloseButtonIn(parent: SceneObject): boolean {
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
                        s.onTriggerUp.add(() => {
                            print('XPManager: Frame close button pressed');
                            this.hideUserCard();
                        });
                        print('XPManager: Frame close button hooked on User Card Info');
                        return true;
                    }
                    if (s.onButtonPinched && typeof s.onButtonPinched.add === 'function') {
                        s.onButtonPinched.add(() => {
                            print('XPManager: Frame close button pressed (pinch)');
                            this.hideUserCard();
                        });
                        print('XPManager: Frame close button hooked (pinch) on User Card Info');
                        return true;
                    }
                } catch (e) { /* ignore */ }
            }
            if (this.searchCloseButtonIn(child)) return true;
        }
        return false;
    }

    // =====================================================================
    // ACKNOWLEDGE BUTTON — Closes User Card Info
    // =====================================================================

    private acknowledgeButtonConnected: boolean = false;

    private setupAcknowledgeButton(): void {
        if (!this.acknowledgeButton) {
            print('XPManager: acknowledgeButton not assigned');
            return;
        }

        // Strategy 1: orchestrator's connectButton
        if (this.onConnectButton) {
            const connected = this.onConnectButton(this.acknowledgeButton, () => {
                print('XPManager: Acknowledge button pressed');
                this.hideUserCard();
            }, 'AcknowledgeButton');
            if (connected) {
                this.acknowledgeButtonConnected = true;
                print('XPManager: Acknowledge button connected');
                return;
            }
        }

        // Strategy 2: polling fallback
        let attempts = 0;
        const maxAttempts = 300;
        const pollEvent = this.createEvent('UpdateEvent');
        pollEvent.bind(() => {
            if (this.acknowledgeButtonConnected) { pollEvent.enabled = false; return; }
            attempts++;
            if (attempts > maxAttempts) { pollEvent.enabled = false; return; }

            try {
                const scripts = this.acknowledgeButton.getComponents('Component.ScriptComponent') as any[];
                for (let i = 0; i < scripts.length; i++) {
                    const script = scripts[i];
                    if (!script) continue;
                    if (script.onButtonPinched && typeof script.onButtonPinched.add === 'function') {
                        script.onButtonPinched.add(() => {
                            print('XPManager: Acknowledge pressed (pinch)');
                            this.hideUserCard();
                        });
                        this.acknowledgeButtonConnected = true;
                        pollEvent.enabled = false;
                        print('XPManager: Acknowledge connected (pinch)');
                        return;
                    }
                    if (script.onTriggerUp && typeof script.onTriggerUp.add === 'function') {
                        script.onTriggerUp.add(() => {
                            print('XPManager: Acknowledge pressed (trigger)');
                            this.hideUserCard();
                        });
                        this.acknowledgeButtonConnected = true;
                        pollEvent.enabled = false;
                        print('XPManager: Acknowledge connected (trigger)');
                        return;
                    }
                }
            } catch (e) { /* polling */ }
        });
    }

    // =====================================================================
    // DAILY STREAK
    // =====================================================================

    private updateDailyStreak(): void {
        const today = this.getTodayDateString();
        if (this.profile.lastLoginDate === today) {
            // Already logged in today — no streak change
            return;
        }

        const yesterday = this.getYesterdayDateString();
        if (this.profile.lastLoginDate === yesterday) {
            // Consecutive day
            this.profile.streakDays++;
            print('XPManager: Streak extended to ' + this.profile.streakDays + ' days');
        } else {
            // Streak broken (or first login)
            this.profile.streakDays = 1;
            print('XPManager: Streak reset to 1');
        }

        this.profile.lastLoginDate = today;
        this.saveProfile();
    }

    private getTodayDateString(): string {
        const d = new Date();
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
    }

    private getYesterdayDateString(): string {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
    }

    // =====================================================================
    // PERSISTENCE
    // =====================================================================

    private loadProfile(): void {
        try {
            const jsonStr = global.persistentStorageSystem.store.getString(this.STORAGE_KEY);
            if (jsonStr && jsonStr.length > 0) {
                const parsed = JSON.parse(jsonStr) as UserProfile;
                this.profile.level = parsed.level || 1;
                this.profile.totalXP = parsed.totalXP || 0;
                this.profile.prestige = parsed.prestige || 0;
                this.profile.lastLoginDate = parsed.lastLoginDate || '';
                this.profile.streakDays = parsed.streakDays || 0;
                this.profile.totalScans = parsed.totalScans || 0;
                this.profile.totalTrades = parsed.totalTrades || 0;
                this.profile.trustScore = typeof parsed.trustScore === 'number' ? parsed.trustScore : TRUST_DEFAULT;
                this.profile.consecutiveCheats = typeof parsed.consecutiveCheats === 'number' ? parsed.consecutiveCheats : 0;
                this.profile.totalCheats = typeof parsed.totalCheats === 'number' ? parsed.totalCheats : 0;
                this.profile.cardsGiven = typeof parsed.cardsGiven === 'number' ? parsed.cardsGiven : 0;
                this.profile.cardsReceived = typeof parsed.cardsReceived === 'number' ? parsed.cardsReceived : 0;

                // Validate level against XP
                const computed = getLevelForXP(this.profile.totalXP);
                if (computed.level !== this.profile.level) {
                    print('XPManager: Level mismatch — stored=' + this.profile.level
                        + ' computed=' + computed.level + ', correcting');
                    this.profile.level = computed.level;
                }
            }
        } catch (e) {
            print('XPManager: Load error: ' + e);
            this.profile = createDefaultProfile();
        }
    }

    private saveProfile(): void {
        try {
            const data = JSON.stringify({
                level: this.profile.level,
                totalXP: this.profile.totalXP,
                prestige: this.profile.prestige,
                lastLoginDate: this.profile.lastLoginDate,
                streakDays: this.profile.streakDays,
                totalScans: this.profile.totalScans || 0,
                totalTrades: this.profile.totalTrades || 0,
                trustScore: this.profile.trustScore,
                consecutiveCheats: this.profile.consecutiveCheats,
                totalCheats: this.profile.totalCheats || 0,
                cardsGiven: this.profile.cardsGiven || 0,
                cardsReceived: this.profile.cardsReceived || 0,
            });
            global.persistentStorageSystem.store.putString(this.STORAGE_KEY, data);
        } catch (e) {
            print('XPManager: Save error: ' + e);
        }
    }
}
