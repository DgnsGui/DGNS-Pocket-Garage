/**
 * CloudManager.ts — Centralized Snap Cloud / Supabase integration for DGNS Vehicle Scanner
 *
 * Handles:
 *   - Snapchat authentication via Supabase Auth
 *   - User profile sync (XP, level, prestige, streak) to cloud
 *   - Vehicle collection backup/restore to cloud database
 *   - Card images upload/download via Supabase Storage
 *   - Global leaderboard queries
 *   - Async trade requests (propose / accept / reject)
 *   - Realtime notifications for incoming trades
 *   - Global statistics
 *
 * Requires a SnapCloudRequirements component with a configured SupabaseProject.
 * All cloud operations are fire-and-forget with local-first fallback.
 *
 * @author DGNS
 * @license MIT
 */

import { createClient } from 'SupabaseClient.lspkg/supabase-snapcloud';
import { SnapCloudRequirements } from 'SnapCloudExamples.lspkg/SnapCloudRequirements';
import {
    SavedVehicleData, UserProfile, SimplifiedCard, TradeHistoryEntry,
    createDefaultProfile, getLevelForXP,
} from './VehicleTypes';
import { t, tf } from './Localization';

// =====================================================================
// CLOUD INTERFACES
// =====================================================================

export interface CloudUserProfile {
    user_id: string;
    display_name: string;
    level: number;
    total_xp: number;
    prestige: number;
    streak_days: number;
    total_scans: number;
    total_trades: number;
    trust_score: number;
    consecutive_cheats: number;
    total_cheats: number;
    cards_given: number;
    cards_received: number;
    last_login: string;
    created_at?: string;
    updated_at?: string;
}

export interface CloudVehicle {
    id?: number;
    user_id: string;
    serial: string;
    brand: string;
    brand_model: string;
    type: string;
    year: string;
    rarity: number;
    rarity_label: string;
    top_speed: number;
    acceleration: number;
    braking: number;
    traction: number;
    comfort: number;
    scene: string;
    city_scanned: string;
    date_scanned: string;
    image_url: string;
    saved_at: number;
    created_at?: string;
}

export interface CloudTradeRequest {
    id?: number;
    from_user: string;
    to_user: string;
    offered_serial: string;
    offered_brand_model: string;
    offered_rarity: number;
    status: 'pending' | 'accepted' | 'rejected' | 'expired';
    message: string;
    created_at?: string;
}

export interface LeaderboardEntry {
    user_id: string;
    display_name: string;
    level: number;
    total_xp: number;
    prestige: number;
    total_scans: number;
    rank?: number;
}

export interface GlobalStats {
    total_scans: number;
    total_users: number;
    most_scanned_brand: string;
    rarest_found: string;
    total_trades: number;
}

// =====================================================================
// COMPONENT
// =====================================================================

@component
export class CloudManager extends BaseScriptComponent {

    // =====================================================================
    // INPUTS
    // =====================================================================
    @input
    @hint('SnapCloudRequirements script reference (holds SupabaseProject config)')
    @allowUndefined
    snapCloudRequirements: SnapCloudRequirements;

    // =====================================================================
    // CALLBACKS — Set by orchestrator
    // =====================================================================
    onAuthenticated: ((userId: string) => void) | null = null;
    onAuthFailed: ((error: string) => void) | null = null;
    onProfileSynced: ((profile: CloudUserProfile) => void) | null = null;
    onCollectionSynced: ((count: number) => void) | null = null;
    onLeaderboardReady: ((entries: LeaderboardEntry[], myRank: number) => void) | null = null;
    onTradeReceived: ((trade: CloudTradeRequest) => void) | null = null;
    onTradeStatusChanged: ((tradeId: number, status: string) => void) | null = null;
    /** Called when an async trade is fully completed — card data for the receiver to add locally. */
    onAsyncTradeCompleted: ((card: CloudVehicle) => void) | null = null;
    onShowMessage: ((text: string) => void) | null = null;

    onGetProfile: (() => UserProfile) | null = null;
    onGetCollection: (() => SavedVehicleData[]) | null = null;
    onGetUsername: (() => string) | null = null;
    onGetAvatarUrl: (() => string) | null = null;
    onShareComplete: ((url: string) => void) | null = null;
    onShareSucceeded: (() => void) | null = null;
    onShareFailed: (() => void) | null = null;
    onGetLocalImage: ((savedAt: number) => string) | null = null;

    // =====================================================================
    // CONSTANTS
    // =====================================================================
    private readonly STORAGE_BUCKET = 'card-images';
    private readonly TABLE_PROFILES = 'user_profiles';
    private readonly TABLE_VEHICLES = 'vehicles';
    private readonly TABLE_TRADES = 'trade_requests';
    private readonly TABLE_TRADE_HISTORY = 'trade_history';
    private readonly TABLE_GALLERIES = 'shared_galleries';
    private readonly GALLERY_BASE_URL = 'https://dgns-gallery-web.vercel.app/g/';

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private client: any = null;
    private userId: string = '';
    private isAuthenticated: boolean = false;
    private isInitializing: boolean = false;
    private tradeChannel: any = null;
    private internetModule: InternetModule = require('LensStudio:InternetModule');
    private remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule');
    private bitmojiModule: BitmojiModule = require('LensStudio:BitmojiModule');
    private cachedAvatarUrl: string = '';

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        this.createEvent('OnStartEvent').bind(() => {
            this.initialize();
        });
    }

    onDestroy(): void {
        if (this.client) {
            try { this.client.removeAllChannels(); } catch (e) { /* ignore */ }
        }
    }

    // =====================================================================
    // INITIALIZATION
    // =====================================================================

    private async initialize(): Promise<void> {
        if (this.isInitializing) return;
        this.isInitializing = true;

        if (!this.snapCloudRequirements || !this.snapCloudRequirements.isConfigured()) {
            print('CloudManager: SnapCloudRequirements not configured — cloud features disabled');
            this.isInitializing = false;
            return;
        }

        try {
            const supabaseProject = this.snapCloudRequirements.getSupabaseProject();
            this.client = createClient(supabaseProject.url, supabaseProject.publicToken, {
                realtime: { heartbeatIntervalMs: 2500 }
            });

            print('CloudManager: Supabase client created — authenticating...');
            await this.authenticate();
        } catch (e) {
            print('CloudManager: Init error: ' + e);
            this.isInitializing = false;
        }
    }

    // =====================================================================
    // AUTHENTICATION
    // =====================================================================

    private async authenticate(retryCount: number = 0): Promise<void> {
        const maxRetries = 3;

        try {
            const { data, error } = await this.client.auth.signInWithIdToken({
                provider: 'snapchat',
                token: ''
            });

            if (error) {
                const { data: sessionData } = await this.client.auth.getSession();
                if (sessionData?.session?.user?.id) {
                    this.userId = sessionData.session.user.id;
                    this.isAuthenticated = true;
                    print('CloudManager: Authenticated (existing session) — uid=' + this.userId.substring(0, 8) + '...');
                    this.onAuthSuccess();
                    return;
                }

                if (retryCount < maxRetries) {
                    print('CloudManager: Auth retry ' + (retryCount + 1) + '/' + maxRetries);
                    await this.delay(1.0);
                    return this.authenticate(retryCount + 1);
                }

                print('CloudManager: Auth failed after ' + maxRetries + ' retries: ' + JSON.stringify(error));
                if (this.onAuthFailed) this.onAuthFailed(JSON.stringify(error));
                return;
            }

            if (data?.user?.id) {
                this.userId = data.user.id;
                this.isAuthenticated = true;
                print('CloudManager: Authenticated — uid=' + this.userId.substring(0, 8) + '...');
                this.onAuthSuccess();
            }
        } catch (e) {
            if (retryCount < maxRetries) {
                print('CloudManager: Auth exception, retry ' + (retryCount + 1) + ': ' + e);
                await this.delay(1.0);
                return this.authenticate(retryCount + 1);
            }
            print('CloudManager: Auth exception final: ' + e);
            if (this.onAuthFailed) this.onAuthFailed(String(e));
        } finally {
            this.isInitializing = false;
        }
    }

    private onAuthSuccess(): void {
        if (this.onAuthenticated) this.onAuthenticated(this.userId);
        this.subscribeToTradeNotifications();
        this.fetchAndUploadBitmoji().catch(() => {});
    }

    // =====================================================================
    // PUBLIC API — Status
    // =====================================================================

    isReady(): boolean {
        return this.isAuthenticated && this.client !== null;
    }

    getUserId(): string {
        return this.userId;
    }

    /**
     * Tries to re-authenticate (e.g. after session expiry). Use when isReady() is false
     * but the user is trying to share or sync. Returns true if authenticated after the attempt.
     */
    async tryReconnect(): Promise<boolean> {
        if (!this.client) {
            print('CloudManager: tryReconnect — no client, cannot reconnect');
            return false;
        }
        print('CloudManager: tryReconnect — attempting to re-authenticate...');
        this.isInitializing = false;
        await this.authenticate(0);
        if (this.isAuthenticated) {
            print('CloudManager: tryReconnect — success, uid=' + this.userId.substring(0, 8) + '...');
        } else {
            print('CloudManager: tryReconnect — failed, still not authenticated');
        }
        return this.isAuthenticated;
    }

    // =====================================================================
    // PROFILE SYNC
    // =====================================================================

    async syncProfile(localProfile: UserProfile, totalScans: number, totalTrades: number): Promise<CloudUserProfile | null> {
        if (!this.isReady()) return null;

        try {
            const username = this.onGetUsername ? this.onGetUsername() : '';
            const profileData: any = {
                user_id: this.userId,
                display_name: username.length > 0 ? username : 'Driver_' + this.userId.substring(0, 6),
                level: localProfile.level,
                total_xp: localProfile.totalXP,
                prestige: localProfile.prestige,
                streak_days: localProfile.streakDays,
                total_scans: totalScans,
                total_trades: totalTrades,
                trust_score: typeof localProfile.trustScore === 'number' ? localProfile.trustScore : 80,
                consecutive_cheats: localProfile.consecutiveCheats || 0,
                total_cheats: localProfile.totalCheats || 0,
                cards_given: localProfile.cardsGiven || 0,
                cards_received: localProfile.cardsReceived || 0,
                last_login: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            const { data, error } = await this.client
                .from(this.TABLE_PROFILES)
                .upsert(profileData, { onConflict: 'user_id' })
                .select();

            if (error) {
                print('CloudManager: Profile sync error: ' + JSON.stringify(error));
                return null;
            }

            const result = data && data.length > 0 ? data[0] as CloudUserProfile : null;
            print('CloudManager: Profile synced — LVL ' + localProfile.level
                + ' | XP ' + localProfile.totalXP
                + ' | Prestige ' + localProfile.prestige);
            if (this.onProfileSynced && result) this.onProfileSynced(result);
            return result;
        } catch (e) {
            print('CloudManager: Profile sync exception: ' + e);
            return null;
        }
    }

    async fetchCloudProfile(): Promise<CloudUserProfile | null> {
        if (!this.isReady()) return null;

        try {
            const { data, error } = await this.client
                .from(this.TABLE_PROFILES)
                .select('*')
                .eq('user_id', this.userId)
                .limit(1);

            if (error || !data || data.length === 0) return null;
            return data[0] as CloudUserProfile;
        } catch (e) {
            print('CloudManager: Fetch profile exception: ' + e);
            return null;
        }
    }

    // =====================================================================
    // COLLECTION SYNC
    // =====================================================================

    async syncVehicle(vehicle: SavedVehicleData): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const vehicleData: any = {
                user_id: this.userId,
                serial: vehicle.serial,
                brand: vehicle.brand || '',
                brand_model: vehicle.brand_model,
                type: vehicle.type,
                year: vehicle.year || '',
                rarity: vehicle.rarity || 2,
                rarity_label: vehicle.rarity_label || 'Common',
                top_speed: vehicle.top_speed,
                acceleration: vehicle.acceleration,
                braking: vehicle.braking,
                traction: vehicle.traction,
                comfort: vehicle.comfort,
                scene: vehicle.scene || '',
                city_scanned: vehicle.cityScanned || '',
                date_scanned: vehicle.dateScanned || '',
                saved_at: vehicle.savedAt,
            };

            const { data: existing } = await this.client
                .from(this.TABLE_VEHICLES)
                .select('serial')
                .eq('serial', vehicle.serial)
                .limit(1);

            if (existing && existing.length > 0) {
                const { image_url, ...updateData } = vehicleData;
                const { error } = await this.client
                    .from(this.TABLE_VEHICLES)
                    .update(updateData)
                    .eq('serial', vehicle.serial);
                if (error) {
                    print('CloudManager: Vehicle update error (' + vehicle.brand_model + '): ' + JSON.stringify(error));
                    return false;
                }
            } else {
                vehicleData.image_url = '';
                const { error } = await this.client
                    .from(this.TABLE_VEHICLES)
                    .insert(vehicleData);
                if (error) {
                    print('CloudManager: Vehicle insert error (' + vehicle.brand_model + '): ' + JSON.stringify(error));
                    return false;
                }
            }

            print('CloudManager: Vehicle synced — ' + vehicle.brand_model + ' (' + vehicle.serial + ')');
            return true;
        } catch (e) {
            print('CloudManager: Vehicle sync exception: ' + e);
            return false;
        }
    }

    async syncFullCollection(vehicles: SavedVehicleData[]): Promise<number> {
        if (!this.isReady() || vehicles.length === 0) return 0;

        try {
            // Sync vehicles one by one to preserve existing image_url values
            let synced = 0;
            for (let i = 0; i < vehicles.length; i++) {
                const ok = await this.syncVehicle(vehicles[i]);
                if (ok) synced++;
            }
            print('CloudManager: Full collection sync OK — ' + synced + '/' + vehicles.length + ' vehicles');
            if (this.onCollectionSynced) this.onCollectionSynced(synced);
            return synced;
        } catch (e) {
            print('CloudManager: Full collection sync exception: ' + e);
            return 0;
        }
    }

    

    /**
     * Bidirectional merge: compares local and cloud collections, returns a merged result.
     * - Cloud-only vehicles are added to local
     * - Local-only vehicles are pushed to cloud
     * - Conflicts (same serial) resolved by most recent saved_at
     */
    async mergeCollections(localVehicles: SavedVehicleData[]): Promise<SavedVehicleData[]> {
        if (!this.isReady()) return localVehicles;

        const cloudVehicles = await this.fetchCloudCollection();
        if (cloudVehicles.length === 0 && localVehicles.length === 0) return localVehicles;

        const localBySerial = new Map<string, SavedVehicleData>();
        for (const v of localVehicles) {
            localBySerial.set(v.serial, v);
        }

        const merged: SavedVehicleData[] = [...localVehicles];
        const toSyncToCloud: SavedVehicleData[] = [];

        for (const cv of cloudVehicles) {
            const localV = localBySerial.get(cv.serial);
            if (!localV) {
                // Cloud-only → add locally
                const imported: SavedVehicleData = {
                    vehicle_found: true,
                    brand: cv.brand,
                    brand_model: cv.brand_model,
                    type: cv.type,
                    year: cv.year || '',
                    top_speed: cv.top_speed,
                    acceleration: cv.acceleration,
                    braking: cv.braking,
                    traction: cv.traction,
                    comfort: cv.comfort,
                    rarity: cv.rarity,
                    rarity_label: cv.rarity_label || '',
                    scene: cv.scene || '',
                    savedAt: cv.saved_at,
                    imageGenerated: false,
                    serial: cv.serial,
                    dateScanned: cv.date_scanned || '',
                    cityScanned: cv.city_scanned || '',
                };
                merged.push(imported);
                print('CloudManager: Merge — imported from cloud: ' + cv.brand_model);
            }
            // Same serial exists locally → local wins (already in merged)
        }

        // Local-only → push to cloud
        const cloudSerials = new Set(cloudVehicles.map(cv => cv.serial));
        for (const lv of localVehicles) {
            if (!cloudSerials.has(lv.serial)) {
                toSyncToCloud.push(lv);
            }
        }

        if (toSyncToCloud.length > 0) {
            print('CloudManager: Merge — pushing ' + toSyncToCloud.length + ' local-only vehicles to cloud');
            await this.syncFullCollection(toSyncToCloud);
        }

        print('CloudManager: Merge complete — ' + merged.length + ' total vehicles');
        return merged;
    }

    async fetchCloudCollection(): Promise<CloudVehicle[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.client
                .from(this.TABLE_VEHICLES)
                .select('*')
                .eq('user_id', this.userId)
                .order('saved_at', { ascending: false });

            if (error) {
                print('CloudManager: Fetch collection error: ' + JSON.stringify(error));
                return [];
            }

            print('CloudManager: Fetched ' + (data?.length || 0) + ' vehicles from cloud');
            return (data || []) as CloudVehicle[];
        } catch (e) {
            print('CloudManager: Fetch collection exception: ' + e);
            return [];
        }
    }

    async deleteCloudVehicle(serial: string): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const { error } = await this.client
                .from(this.TABLE_VEHICLES)
                .delete()
                .eq('user_id', this.userId)
                .eq('serial', serial);

            if (error) {
                print('CloudManager: Delete vehicle error: ' + JSON.stringify(error));
                return false;
            }

            print('CloudManager: Vehicle deleted from cloud — ' + serial);
            return true;
        } catch (e) {
            print('CloudManager: Delete vehicle exception: ' + e);
            return false;
        }
    }

    async resetCloudCollection(): Promise<void> {
        if (!this.isReady()) return;

        try {
            // 1. Delete shared gallery FIRST so the website stops showing old data
            const { error: galleryError } = await this.client
                .from(this.TABLE_GALLERIES)
                .delete()
                .eq('user_id', this.userId);

            if (galleryError) {
                print('CloudManager: [RESET] Gallery delete FAILED: ' + JSON.stringify(galleryError));
            } else {
                print('CloudManager: [RESET] Gallery deleted — website will show "not found"');
            }

            // 2. Delete all vehicles
            const { error: vehicleError } = await this.client
                .from(this.TABLE_VEHICLES)
                .delete()
                .eq('user_id', this.userId);

            if (vehicleError) {
                print('CloudManager: [RESET] Vehicles delete FAILED: ' + JSON.stringify(vehicleError));
            } else {
                print('CloudManager: [RESET] All vehicles deleted from cloud');
            }

            // 3. Delete user profile (AFTER vehicles due to FK constraint)
            const { error: profileError } = await this.client
                .from(this.TABLE_PROFILES)
                .delete()
                .eq('user_id', this.userId);

            if (profileError) {
                print('CloudManager: [RESET] Profile delete FAILED: ' + JSON.stringify(profileError));
            } else {
                print('CloudManager: [RESET] User profile deleted from cloud');
            }

            // 4. Clean up card images from storage bucket (best-effort)
            try {
                const { data: files } = await this.client.storage
                    .from(this.STORAGE_BUCKET)
                    .list(this.userId + '/');

                if (files && files.length > 0) {
                    const paths = files.map((f: any) => this.userId + '/' + f.name);
                    const { error: removeError } = await this.client.storage
                        .from(this.STORAGE_BUCKET)
                        .remove(paths);

                    if (removeError) {
                        print('CloudManager: [RESET] Storage cleanup error: ' + JSON.stringify(removeError));
                    } else {
                        print('CloudManager: [RESET] ' + files.length + ' card images removed from storage');
                    }
                }
            } catch (storageErr) {
                print('CloudManager: [RESET] Storage cleanup skipped: ' + storageErr);
            }

            print('CloudManager: [RESET] Full cloud reset complete (gallery + vehicles + profile + images)');
            if (this.onShowMessage) this.onShowMessage(t('profile_collection_reset'));
        } catch (e) {
            print('CloudManager: [RESET] Exception: ' + e);
        }
    }

    // =====================================================================
    // IMAGE STORAGE
    // =====================================================================

    async uploadCardImage(serial: string, base64Image: string): Promise<string> {
        if (!this.isReady() || !base64Image || base64Image.length === 0) return '';

        try {
            const imageBytes = Base64.decode(base64Image);
            const path = this.userId + '/' + serial + '.jpg';

            const { data, error } = await this.client.storage
                .from(this.STORAGE_BUCKET)
                .upload(path, imageBytes, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (error) {
                print('CloudManager: Image upload error: ' + JSON.stringify(error));
                return '';
            }

            const { data: urlData } = this.client.storage
                .from(this.STORAGE_BUCKET)
                .getPublicUrl(path);

            const publicUrl = urlData?.publicUrl || '';
            print('CloudManager: Image uploaded — ' + serial + ' → ' + (publicUrl ? publicUrl.substring(0, 80) + '...' : 'NO URL'));

            if (publicUrl) {
                const { error: updateErr } = await this.client
                    .from(this.TABLE_VEHICLES)
                    .update({ image_url: publicUrl })
                    .eq('user_id', this.userId)
                    .eq('serial', serial);
                if (updateErr) {
                    print('CloudManager: [WARN] Failed to set image_url in vehicles table: ' + JSON.stringify(updateErr));
                    print('CloudManager: [WARN] This is likely a missing UPDATE RLS policy on vehicles table');
                }
            }

            return publicUrl;
        } catch (e) {
            print('CloudManager: Image upload exception: ' + e);
            return '';
        }
    }

    async downloadCardImage(imageUrl: string): Promise<Texture | null> {
        if (!imageUrl || imageUrl.length === 0) return null;

        return new Promise<Texture | null>((resolve) => {
            try {
                const request = RemoteServiceHttpRequest.create();
                request.url = imageUrl;
                this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
                    if (response.statusCode < 200 || response.statusCode >= 400) {
                        resolve(null);
                        return;
                    }
                    try {
                        const resource = response.asResource();
                        if (!resource) { resolve(null); return; }
                        this.remoteMediaModule.loadResourceAsImageTexture(resource,
                            (tex: Texture) => resolve(tex),
                            () => resolve(null)
                        );
                    } catch (e) { resolve(null); }
                });
            } catch (e) { resolve(null); }
        });
    }

    // =====================================================================
    // BITMOJI AVATAR
    // =====================================================================

    /**
     * Fetches the user's Bitmoji 2D image on-device, uploads it to Supabase Storage,
     * and caches the public URL. Returns the public URL or '' on failure.
     * Only works on-device (not in Lens Studio editor).
     */
    async fetchAndUploadBitmoji(): Promise<string> {
        if (!this.isReady()) {
            print('CloudManager: [BITMOJI] Not ready, skipping');
            return '';
        }

        if (this.cachedAvatarUrl.length > 0) {
            print('CloudManager: [BITMOJI] Using cached avatar URL');
            return this.cachedAvatarUrl;
        }

        if (global.deviceInfoSystem.isEditor()) {
            print('CloudManager: [BITMOJI] Running in editor, Bitmoji 2D not available');
            return '';
        }

        try {
            const user = await this.getBitmojiUser();
            if (!user) {
                print('CloudManager: [BITMOJI] Could not get current user');
                return '';
            }

            const resource = await this.getBitmoji2DResource(user);
            if (!resource) {
                print('CloudManager: [BITMOJI] Could not get Bitmoji 2D resource');
                return '';
            }

            const bytes = await this.downloadBitmojiBytes(resource);
            if (!bytes || bytes.length === 0) {
                print('CloudManager: [BITMOJI] Could not download Bitmoji bytes');
                return '';
            }

            print('CloudManager: [BITMOJI] Got ' + bytes.length + ' bytes ('
                + Math.round(bytes.length / 1024) + ' KB)');

            const path = this.userId + '/avatar.png';
            const { data, error } = await this.client.storage
                .from(this.STORAGE_BUCKET)
                .upload(path, bytes, {
                    contentType: 'image/png',
                    upsert: true,
                });

            if (error) {
                print('CloudManager: [BITMOJI] Upload error: ' + JSON.stringify(error));
                return '';
            }

            const { data: urlData } = this.client.storage
                .from(this.STORAGE_BUCKET)
                .getPublicUrl(path);

            const publicUrl = urlData?.publicUrl || '';
            if (publicUrl) {
                this.cachedAvatarUrl = publicUrl;
                print('CloudManager: [BITMOJI] Avatar uploaded → ' + publicUrl.substring(0, 80) + '...');
            }

            return publicUrl;
        } catch (e) {
            print('CloudManager: [BITMOJI] Exception: ' + e);
            return '';
        }
    }

    /** Returns the cached avatar URL (empty string if not yet fetched). */
    getAvatarUrl(): string {
        return this.cachedAvatarUrl;
    }

    private getBitmojiUser(): Promise<any> {
        return new Promise((resolve) => {
            try {
                global.userContextSystem.getCurrentUser((user: any) => {
                    resolve(user);
                });
            } catch (e) {
                print('CloudManager: [BITMOJI] getCurrentUser error: ' + e);
                resolve(null);
            }
        });
    }

    private getBitmoji2DResource(user: any): Promise<any> {
        return new Promise((resolve) => {
            try {
                const options = Bitmoji2DOptions.create();
                options.user = user;
                this.bitmojiModule.requestBitmoji2DResource(options, (resource: any) => {
                    resolve(resource);
                });
            } catch (e) {
                print('CloudManager: [BITMOJI] requestBitmoji2DResource error: ' + e);
                resolve(null);
            }
        });
    }

    private downloadBitmojiBytes(resource: any): Promise<Uint8Array | null> {
        return new Promise((resolve) => {
            try {
                this.remoteMediaModule.loadResourceAsBytes(
                    resource,
                    (bytes: Uint8Array) => resolve(bytes),
                    (err: string) => {
                        print('CloudManager: [BITMOJI] loadResourceAsBytes failed: ' + err);
                        resolve(null);
                    }
                );
            } catch (e) {
                print('CloudManager: [BITMOJI] downloadBitmojiBytes error: ' + e);
                resolve(null);
            }
        });
    }

    // =====================================================================
    // LEADERBOARD
    // =====================================================================

    async fetchLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.client
                .from(this.TABLE_PROFILES)
                .select('user_id, display_name, level, total_xp, prestige, total_scans')
                .order('prestige', { ascending: false })
                .order('total_xp', { ascending: false })
                .limit(limit);

            if (error) {
                print('CloudManager: Leaderboard error: ' + JSON.stringify(error));
                return [];
            }

            const entries: LeaderboardEntry[] = (data || []).map((row: any, idx: number) => ({
                user_id: row.user_id,
                display_name: row.display_name || 'Driver',
                level: row.level || 1,
                total_xp: row.total_xp || 0,
                prestige: row.prestige || 0,
                total_scans: row.total_scans || 0,
                rank: idx + 1,
            }));

            let myRank = -1;
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].user_id === this.userId) {
                    myRank = i + 1;
                    break;
                }
            }

            print('CloudManager: Leaderboard fetched — ' + entries.length + ' entries, my rank=' + myRank);
            if (this.onLeaderboardReady) this.onLeaderboardReady(entries, myRank);
            return entries;
        } catch (e) {
            print('CloudManager: Leaderboard exception: ' + e);
            return [];
        }
    }

    async fetchMyRank(): Promise<number> {
        if (!this.isReady()) return -1;

        try {
            const { data, error } = await this.client
                .from(this.TABLE_PROFILES)
                .select('user_id')
                .order('prestige', { ascending: false })
                .order('total_xp', { ascending: false });

            if (error || !data) return -1;

            for (let i = 0; i < data.length; i++) {
                if (data[i].user_id === this.userId) return i + 1;
            }
            return -1;
        } catch (e) {
            return -1;
        }
    }

    // =====================================================================
    // ASYNC TRADING
    // =====================================================================

    async proposeTrade(toUserId: string, offeredSerial: string, offeredBrandModel: string,
                       offeredRarity: number, message: string = ''): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const tradeData: any = {
                from_user: this.userId,
                to_user: toUserId,
                offered_serial: offeredSerial,
                offered_brand_model: offeredBrandModel,
                offered_rarity: offeredRarity,
                status: 'pending',
                message: message || 'Trade request from ' + this.userId.substring(0, 6),
            };

            const { error } = await this.client
                .from(this.TABLE_TRADES)
                .insert(tradeData);

            if (error) {
                print('CloudManager: Trade propose error: ' + JSON.stringify(error));
                return false;
            }

            print('CloudManager: Trade proposed — ' + offeredBrandModel + ' to ' + toUserId.substring(0, 8));
            return true;
        } catch (e) {
            print('CloudManager: Trade propose exception: ' + e);
            return false;
        }
    }

    async respondToTrade(tradeId: number, accept: boolean): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const newStatus = accept ? 'accepted' : 'rejected';
            const { error } = await this.client
                .from(this.TABLE_TRADES)
                .update({ status: newStatus })
                .eq('id', tradeId)
                .eq('to_user', this.userId);

            if (error) {
                print('CloudManager: Trade respond error: ' + JSON.stringify(error));
                return false;
            }

            print('CloudManager: Trade ' + tradeId + ' ' + newStatus);
            if (this.onTradeStatusChanged) this.onTradeStatusChanged(tradeId, newStatus);

            if (accept) {
                await this.executeAsyncTradeTransfer(tradeId);
            }

            return true;
        } catch (e) {
            print('CloudManager: Trade respond exception: ' + e);
            return false;
        }
    }

    /**
     * Executes the full card transfer for an accepted async trade:
     * 1. Fetch the trade request to get from_user and serial
     * 2. Copy the vehicle row from from_user to this user
     * 3. Copy the card image in Storage
     * 4. Delete the vehicle from from_user
     * 5. Notify locally via onAsyncTradeCompleted
     */
    private async executeAsyncTradeTransfer(tradeId: number): Promise<void> {
        try {
            // 1. Fetch the trade details
            const { data: tradeData, error: tradeErr } = await this.client
                .from(this.TABLE_TRADES)
                .select('*')
                .eq('id', tradeId)
                .single();

            if (tradeErr || !tradeData) {
                print('CloudManager: Trade transfer — could not fetch trade: ' + JSON.stringify(tradeErr));
                return;
            }

            const fromUser: string = tradeData.from_user;
            const serial: string = tradeData.offered_serial;
            if (!fromUser || !serial) {
                print('CloudManager: Trade transfer — missing from_user or serial');
                return;
            }

            // 2. Fetch the vehicle from the giver's collection
            const { data: vehicleData, error: vErr } = await this.client
                .from(this.TABLE_VEHICLES)
                .select('*')
                .eq('user_id', fromUser)
                .eq('serial', serial)
                .single();

            if (vErr || !vehicleData) {
                print('CloudManager: Trade transfer — vehicle not found in giver collection: ' + JSON.stringify(vErr));
                if (this.onShowMessage) this.onShowMessage(t('trade_failed_card'));
                return;
            }

            // 3. Insert the vehicle into receiver's collection (with new user_id)
            const receiverVehicle = { ...vehicleData };
            delete receiverVehicle.id;
            receiverVehicle.user_id = this.userId;
            receiverVehicle.created_at = undefined;

            const { error: insertErr } = await this.client
                .from(this.TABLE_VEHICLES)
                .upsert(receiverVehicle, { onConflict: 'serial' })
                .select();

            if (insertErr) {
                print('CloudManager: Trade transfer — insert error: ' + JSON.stringify(insertErr));
                return;
            }

            // 4. Copy image in Storage (fire-and-forget)
            try {
                const srcPath = fromUser + '/' + serial + '.jpg';
                const dstPath = this.userId + '/' + serial + '.jpg';
                const { data: imgData } = await this.client.storage
                    .from(this.STORAGE_BUCKET)
                    .download(srcPath);
                if (imgData) {
                    await this.client.storage
                        .from(this.STORAGE_BUCKET)
                        .upload(dstPath, imgData, { upsert: true });
                    print('CloudManager: Trade transfer — image copied');
                }
            } catch (imgErr) {
                print('CloudManager: Trade transfer — image copy skipped: ' + imgErr);
            }

            // 5. Delete from giver's collection
            await this.client
                .from(this.TABLE_VEHICLES)
                .delete()
                .eq('user_id', fromUser)
                .eq('serial', serial);

            print('CloudManager: Trade transfer complete — ' + serial + ' from ' + fromUser.substring(0, 8));
            if (this.onShowMessage) this.onShowMessage(t('trade_complete'));

            // 6. Notify locally
            if (this.onAsyncTradeCompleted) {
                this.onAsyncTradeCompleted(vehicleData as CloudVehicle);
            }
        } catch (e) {
            print('CloudManager: Trade transfer exception: ' + e);
            if (this.onShowMessage) this.onShowMessage(t('trade_transfer_failed'));
        }
    }

    async fetchPendingTrades(): Promise<CloudTradeRequest[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.client
                .from(this.TABLE_TRADES)
                .select('*')
                .eq('to_user', this.userId)
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (error) {
                print('CloudManager: Fetch trades error: ' + JSON.stringify(error));
                return [];
            }

            print('CloudManager: ' + (data?.length || 0) + ' pending trades');
            return (data || []) as CloudTradeRequest[];
        } catch (e) {
            print('CloudManager: Fetch trades exception: ' + e);
            return [];
        }
    }

    async fetchMyOutgoingTrades(): Promise<CloudTradeRequest[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.client
                .from(this.TABLE_TRADES)
                .select('*')
                .eq('from_user', this.userId)
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) return [];
            return (data || []) as CloudTradeRequest[];
        } catch (e) {
            return [];
        }
    }

    // =====================================================================
    // TRADE HISTORY — Cloud sync
    // =====================================================================

    /** Syncs a single trade history entry to the cloud. */
    async syncTradeHistoryEntry(entry: TradeHistoryEntry): Promise<boolean> {
        if (!this.isReady()) return false;

        try {
            const row = {
                user_id: this.userId,
                timestamp: entry.timestamp,
                type: entry.type,
                serial: entry.serial,
                brand_model: entry.brand_model,
                rarity: entry.rarity,
                partner_name: entry.partnerName || '',
                method: entry.method || 'colocated',
            };
            const { error } = await this.client
                .from(this.TABLE_TRADE_HISTORY)
                .insert(row);

            if (error) {
                print('CloudManager: Trade history sync error: ' + JSON.stringify(error));
                return false;
            }
            print('CloudManager: Trade history synced — ' + entry.type + ' ' + entry.brand_model);
            return true;
        } catch (e) {
            print('CloudManager: Trade history sync exception: ' + e);
            return false;
        }
    }

    // =====================================================================
    // REALTIME — Trade notifications
    // =====================================================================

    private subscribeToTradeNotifications(): void {
        if (!this.client || !this.userId) return;

        try {
            this.tradeChannel = this.client.channel('trades-' + this.userId.substring(0, 12));

            this.tradeChannel.on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: this.TABLE_TRADES,
                filter: 'to_user=eq.' + this.userId
            }, (payload: any) => {
                print('CloudManager: [REALTIME] New trade request received!');
                if (payload?.new && this.onTradeReceived) {
                    this.onTradeReceived(payload.new as CloudTradeRequest);
                }
                if (this.onShowMessage) {
                    const trade = payload?.new;
                    this.onShowMessage(tf('trade_request', { name: trade?.offered_brand_model || '?' }));
                }
            });

            this.tradeChannel.on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: this.TABLE_TRADES,
                filter: 'from_user=eq.' + this.userId
            }, (payload: any) => {
                if (payload?.new) {
                    const trade = payload.new;
                    print('CloudManager: [REALTIME] Trade ' + trade.id + ' updated — ' + trade.status);
                    if (this.onTradeStatusChanged) {
                        this.onTradeStatusChanged(trade.id, trade.status);
                    }
                    if (this.onShowMessage && trade.status === 'accepted') {
                        this.onShowMessage(tf('trade_accepted', { name: trade.offered_brand_model || '' }));
                    }
                }
            });

            this.tradeChannel.subscribe((status: string) => {
                if (status === 'SUBSCRIBED') {
                    print('CloudManager: [REALTIME] Trade notifications active');
                }
            });

        } catch (e) {
            print('CloudManager: Realtime subscribe error: ' + e);
        }
    }

    // =====================================================================
    // GLOBAL STATS
    // =====================================================================

    async fetchGlobalStats(): Promise<GlobalStats | null> {
        if (!this.isReady()) return null;

        try {
            // Aggregate counts with limited queries instead of loading all rows
            const { count: totalUsers } = await this.client
                .from(this.TABLE_PROFILES)
                .select('*', { count: 'exact', head: true });

            const { data: profileData } = await this.client
                .from(this.TABLE_PROFILES)
                .select('total_scans, total_trades')
                .limit(1000);

            const { data: vehicleData } = await this.client
                .from(this.TABLE_VEHICLES)
                .select('brand, rarity')
                .limit(1000);

            let totalScans = 0;
            let totalTrades = 0;

            if (profileData) {
                for (let i = 0; i < profileData.length; i++) {
                    totalScans += profileData[i].total_scans || 0;
                    totalTrades += profileData[i].total_trades || 0;
                }
            }

            let mostScanned = 'N/A';
            let rarestFound = 'N/A';

            if (vehicleData && vehicleData.length > 0) {
                const brandCounts: { [key: string]: number } = {};
                let maxRarity = 0;
                for (let i = 0; i < vehicleData.length; i++) {
                    const brand = vehicleData[i].brand || 'Unknown';
                    brandCounts[brand] = (brandCounts[brand] || 0) + 1;
                    if (vehicleData[i].rarity > maxRarity) {
                        maxRarity = vehicleData[i].rarity;
                        rarestFound = brand;
                    }
                }
                let maxCount = 0;
                for (const brand in brandCounts) {
                    if (brandCounts[brand] > maxCount) {
                        maxCount = brandCounts[brand];
                        mostScanned = brand;
                    }
                }
            }

            const stats: GlobalStats = {
                total_scans: totalScans,
                total_users: totalUsers || 0,
                most_scanned_brand: mostScanned,
                rarest_found: rarestFound,
                total_trades: totalTrades,
            };

            print('CloudManager: Global stats — ' + (totalUsers || 0) + ' users, '
                + totalScans + ' scans, ' + totalTrades + ' trades');
            return stats;
        } catch (e) {
            print('CloudManager: Global stats exception: ' + e);
            return null;
        }
    }

    // =====================================================================
    // PLAYER SEARCH (for async trading)
    // =====================================================================

    async searchPlayers(query: string, limit: number = 10): Promise<CloudUserProfile[]> {
        if (!this.isReady() || !query || query.length < 2) return [];

        const sanitized = query.replace(/[^a-zA-Z0-9_ -]/g, '').substring(0, 30);
        if (sanitized.length < 2) return [];

        const escaped = sanitized.replace(/[%_\\]/g, (ch: string) => '\\' + ch);

        try {
            const { data, error } = await this.client
                .from(this.TABLE_PROFILES)
                .select('*')
                .ilike('display_name', '%' + escaped + '%')
                .neq('user_id', this.userId)
                .limit(limit);

            if (error) return [];
            return (data || []) as CloudUserProfile[];
        } catch (e) {
            return [];
        }
    }

    async fetchPlayerCollection(targetUserId: string): Promise<CloudVehicle[]> {
        if (!this.isReady()) return [];

        try {
            const { data, error } = await this.client
                .from(this.TABLE_VEHICLES)
                .select('serial, brand, brand_model, type, year, rarity, rarity_label, city_scanned, date_scanned')
                .eq('user_id', targetUserId)
                .order('rarity', { ascending: false });

            if (error) return [];
            return (data || []) as CloudVehicle[];
        } catch (e) {
            return [];
        }
    }

    // =====================================================================
    // SHARE GALLERY
    // =====================================================================

    async shareCollection(): Promise<string> {
        if (!this.isReady()) {
            print('CloudManager: Cannot share — not authenticated');
            if (this.onShowMessage) this.onShowMessage(t('not_connected'));
            if (this.onShareFailed) this.onShareFailed();
            return '';
        }

        try {
            const profile = this.onGetProfile ? this.onGetProfile() : null;
            const vehicles = this.onGetCollection ? this.onGetCollection() : [];

            if (!profile) {
                print('CloudManager: Cannot share — no profile data');
                if (this.onShareFailed) this.onShareFailed();
                return '';
            }

            if (vehicles.length === 0) {
                print('CloudManager: Cannot share — empty collection');
                if (this.onShowMessage) this.onShowMessage(t('scan_vehicles_first'));
                if (this.onShareFailed) this.onShareFailed();
                return '';
            }

            const levelDef = getLevelForXP(profile.totalXP);

            // Fetch and upload Bitmoji avatar (on-device only, cached after first call)
            await this.fetchAndUploadBitmoji();
            const avatarUrl = this.onGetAvatarUrl ? this.onGetAvatarUrl() : '';

            const profileSnapshot = {
                level: profile.level,
                level_name: levelDef.name,
                total_xp: profile.totalXP,
                prestige: profile.prestige,
                streak_days: profile.streakDays,
                total_scans: profile.totalScans || 0,
                total_trades: profile.totalTrades || 0,
                trust_score: typeof profile.trustScore === 'number' ? profile.trustScore : 80,
                avatar_url: avatarUrl,
                total_cheats: profile.totalCheats || 0,
                consecutive_cheats: profile.consecutiveCheats || 0,
                cards_given: profile.cardsGiven || 0,
                cards_received: profile.cardsReceived || 0,
                last_login: profile.lastLoginDate || '',
            };

            const vehiclesSnapshot = vehicles.map((v: SavedVehicleData) => ({
                serial: v.serial,
                brand: v.brand || '',
                brand_model: v.brand_model,
                type: v.type,
                year: v.year || '',
                rarity: v.rarity || 2,
                rarity_label: v.rarity_label || 'Common',
                top_speed: v.top_speed,
                acceleration: v.acceleration,
                braking: v.braking,
                traction: v.traction,
                comfort: v.comfort,
                scene: v.scene || '',
                city_scanned: v.cityScanned || '',
                date_scanned: v.dateScanned || '',
                saved_at: v.savedAt,
                image_url: '',
            }));

            const cloudVehicles = await this.fetchCloudCollection();
            let imagesFromCloud = 0;
            let imagesFromStorage = 0;
            let imagesFromLocal = 0;

            // Pre-fetch all storage file names for this user (single API call)
            const storageFileSet = new Set<string>();
            try {
                const { data: allFiles } = await this.client.storage
                    .from(this.STORAGE_BUCKET)
                    .list(this.userId + '/');
                if (allFiles) {
                    for (const f of allFiles) storageFileSet.add(f.name);
                }
                print('CloudManager: [SHARE] Storage bucket has ' + storageFileSet.size + ' files for user');
            } catch (e) {
                print('CloudManager: [SHARE] Storage list failed: ' + e);
            }

            for (let i = 0; i < vehiclesSnapshot.length; i++) {
                const serial = vehiclesSnapshot[i].serial;

                // Source 1: cloud vehicles table image_url
                const match = cloudVehicles.find((cv: CloudVehicle) => cv.serial === serial);
                if (match && match.image_url && match.image_url.length > 10) {
                    vehiclesSnapshot[i].image_url = match.image_url;
                    imagesFromCloud++;
                    continue;
                }

                // Source 2: construct URL from storage bucket (file uploaded during save)
                const fileName = serial + '.jpg';
                if (storageFileSet.has(fileName)) {
                    const storagePath = this.userId + '/' + fileName;
                    const { data: urlData } = this.client.storage
                        .from(this.STORAGE_BUCKET)
                        .getPublicUrl(storagePath);
                    if (urlData?.publicUrl) {
                        vehiclesSnapshot[i].image_url = urlData.publicUrl;
                        imagesFromStorage++;
                        print('CloudManager: [SHARE] ' + serial + ' → storage file');
                        this.client
                            .from(this.TABLE_VEHICLES)
                            .update({ image_url: urlData.publicUrl })
                            .eq('user_id', this.userId)
                            .eq('serial', serial)
                            .then(() => {});
                        continue;
                    }
                }

                // Source 3: upload from local device persistent storage
                if (this.onGetLocalImage) {
                    const localB64 = this.onGetLocalImage(vehiclesSnapshot[i].saved_at);
                    if (localB64 && localB64.length > 0) {
                        print('CloudManager: [SHARE] ' + serial + ' → uploading from local (' + localB64.length + ' chars)');
                        const url = await this.uploadCardImage(serial, localB64);
                        if (url) {
                            vehiclesSnapshot[i].image_url = url;
                            imagesFromLocal++;
                            continue;
                        }
                    }
                }

                print('CloudManager: [SHARE] ' + serial + ' → NO IMAGE (cloud/storage/local all empty)');
            }

            const totalImages = imagesFromCloud + imagesFromStorage + imagesFromLocal;
            print('CloudManager: [SHARE] Image resolution: ' + totalImages + '/' + vehiclesSnapshot.length
                + ' (cloud=' + imagesFromCloud + ', storage=' + imagesFromStorage + ', local=' + imagesFromLocal + ')');

            const username = this.onGetUsername ? this.onGetUsername() : '';
            const displayName = username.length > 0 ? username : 'Driver_' + this.userId.substring(0, 6);

            const galleryData: any = {
                user_id: this.userId,
                display_name: displayName,
                profile_snapshot: profileSnapshot,
                vehicles_snapshot: vehiclesSnapshot,
                shared_at: new Date().toISOString(),
                is_public: true,
            };

            const { error } = await this.client
                .from(this.TABLE_GALLERIES)
                .upsert(galleryData, { onConflict: 'user_id' });

            if (error) {
                print('CloudManager: Share gallery error: ' + JSON.stringify(error));
                if (this.onShowMessage) this.onShowMessage(t('share_failed'));
                if (this.onShareFailed) this.onShareFailed();
                return '';
            }

            const galleryUrl = this.GALLERY_BASE_URL + this.userId;
            print('CloudManager: Gallery shared — ' + galleryUrl
                + ' (' + vehiclesSnapshot.length + ' vehicles)');

            if (this.onShowMessage) {
                this.onShowMessage(tf('collection_shared_n', { count: vehiclesSnapshot.length }));
            }
            if (this.onShareComplete) {
                this.onShareComplete(galleryUrl);
            }
            if (this.onShareSucceeded) {
                this.onShareSucceeded();
            }

            return galleryUrl;

        } catch (e) {
            print('CloudManager: Share gallery exception: ' + e);
            if (this.onShowMessage) this.onShowMessage(t('share_failed'));
            if (this.onShareFailed) this.onShareFailed();
            return '';
        }
    }

    // =====================================================================
    // UTILITY
    // =====================================================================

    private delay(seconds: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const event = this.createEvent('DelayedCallbackEvent') as any;
            event.bind(() => resolve());
            event.reset(seconds);
        });
    }
}
