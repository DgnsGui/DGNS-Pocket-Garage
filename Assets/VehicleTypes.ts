/**
 * VehicleTypes.ts — Data layer for DGNS Vehicle Scanner
 *
 * Contains shared interfaces, type definitions, and pure utility functions
 * used across all modules. The @component class is a no-op placeholder
 * required by Lens Studio (all .ts files must have one).
 *
 * @author DGNS
 * @license MIT
 */

@component
export class VehicleTypes extends BaseScriptComponent {
    // No-op component — required by Lens Studio.
    // This file only provides exported interfaces and utility functions.
}

// =====================================================================
// INTERFACES
// =====================================================================

/**
 * Vehicle identification data returned by OpenAI GPT-4o Vision.
 * All stats are integers 1-5 relative to all production cars ever made.
 */
export interface VehicleData {
    vehicle_found?: boolean;
    brand?: string;
    brand_model: string;
    type: string;
    year?: string;
    top_speed: number;
    acceleration: number;
    braking: number;
    traction: number;
    comfort: number;
    rarity: number;          // 1-5 star rarity score
    rarity_label: string;    // e.g. "Common", "Rare", "Legendary"
    scene?: string;          // Brief description of the environment/setting where the vehicle was photographed
    rejection_reason?: string; // Set by GPT-4o if image is a screen/photo/print instead of a real vehicle
}

/**
 * Extended vehicle data for saved collection items.
 * Includes metadata for persistence, image state, and unique serial.
 */
export interface SavedVehicleData extends VehicleData {
    savedAt: number;           // Unix timestamp when saved
    imageGenerated: boolean;   // Whether an AI image was generated for this card
    serial: string;            // Unique card serial e.g. "DGNS-7F3A-B2C1-49E8"
    dateScanned: string;       // Formatted scan date e.g. "Feb 15, 2026"
    cityScanned: string;       // City where the vehicle was scanned (from device location)
}

// =====================================================================
// TRADE HISTORY
// =====================================================================

/**
 * Record of a single card trade event (colocated or async).
 * Persisted locally and synced to cloud.
 */
export interface TradeHistoryEntry {
    timestamp: number;                     // Unix ms
    type: 'given' | 'received';            // Direction of the trade
    serial: string;                        // Card serial traded
    brand_model: string;                   // Vehicle name for display
    rarity: number;                        // 1-5
    partnerName: string;                   // Display name of the other player
    method: 'colocated' | 'async';         // How the trade happened
}

// =====================================================================
// USER PROFILE — XP, Levels, Prestige
// =====================================================================

/**
 * User profile data persisted locally.
 * Tracks level progression, XP, prestige resets, and daily login streak.
 */
export interface UserProfile {
    level: number;            // 1-50
    totalXP: number;          // Cumulative XP across all levels (resets on prestige)
    prestige: number;         // Number of prestige resets (stars)
    lastLoginDate: string;    // ISO date "YYYY-MM-DD" of last session
    streakDays: number;       // Consecutive daily login count
    totalScans: number;       // Lifetime scan count
    totalTrades: number;      // Lifetime trade count
    trustScore: number;       // 0-100 anti-cheat reputation (default 80)
    consecutiveCheats: number; // Current cheat streak counter
    totalCheats: number;      // Lifetime cheat attempt count
    cardsGiven: number;       // Lifetime cards given via trade
    cardsReceived: number;    // Lifetime cards received via trade
}

/**
 * Level definition: name, cumulative XP threshold, and display label.
 */
export interface LevelDef {
    level: number;
    name: string;
    xpThreshold: number;      // Cumulative XP needed to reach this level
}

/** The 10 level definitions (TopGear theme). */
export const LEVEL_TABLE: LevelDef[] = [
    { level: 1,  name: 'Learner Driver',      xpThreshold: 0 },
    { level: 2,  name: 'Sunday Driver',       xpThreshold: 50 },
    { level: 3,  name: 'Road Tripper',        xpThreshold: 200 },
    { level: 4,  name: 'Street Racer',        xpThreshold: 500 },
    { level: 5,  name: 'Track Day Hero',      xpThreshold: 1000 },
    { level: 6,  name: 'Rally Champion',      xpThreshold: 1800 },
    { level: 7,  name: 'Le Mans Legend',      xpThreshold: 3000 },
    { level: 8,  name: 'F1 Contender',       xpThreshold: 4800 },
    { level: 9,  name: 'Stig\'s Cousin',      xpThreshold: 7300 },
    { level: 10, name: 'The Stig',            xpThreshold: 10800 },
    { level: 11, name: 'Drift King',          xpThreshold: 13000 },
    { level: 12, name: 'Night Rider',         xpThreshold: 15500 },
    { level: 13, name: 'Turbo Mechanic',      xpThreshold: 18500 },
    { level: 14, name: 'Circuit Breaker',     xpThreshold: 22000 },
    { level: 15, name: 'Pit Stop Pro',        xpThreshold: 26000 },
    { level: 16, name: 'Apex Predator',       xpThreshold: 30500 },
    { level: 17, name: 'Tarmac Titan',        xpThreshold: 35500 },
    { level: 18, name: 'Fuel Injected',       xpThreshold: 41000 },
    { level: 19, name: 'Burnout Artist',      xpThreshold: 47000 },
    { level: 20, name: 'Grand Tourer',        xpThreshold: 54000 },
    { level: 21, name: 'Redline Rider',       xpThreshold: 61500 },
    { level: 22, name: 'Chrome Collector',    xpThreshold: 69500 },
    { level: 23, name: 'Garage Boss',         xpThreshold: 78000 },
    { level: 24, name: 'Quarter Mile King',   xpThreshold: 87000 },
    { level: 25, name: 'Horsepower Hoarder',  xpThreshold: 97000 },
    { level: 26, name: 'Speed Demon',         xpThreshold: 108000 },
    { level: 27, name: 'Slipstream Ace',      xpThreshold: 120000 },
    { level: 28, name: 'Autobahn Cruiser',    xpThreshold: 133000 },
    { level: 29, name: 'Concours Judge',      xpThreshold: 147000 },
    { level: 30, name: 'Petrolhead Elite',    xpThreshold: 162000 },
    { level: 31, name: 'V12 Virtuoso',        xpThreshold: 178000 },
    { level: 32, name: 'Carbon Fiber Soul',   xpThreshold: 195000 },
    { level: 33, name: 'Monaco Royalty',      xpThreshold: 213000 },
    { level: 34, name: 'Paddock Legend',      xpThreshold: 232000 },
    { level: 35, name: 'Endurance Master',    xpThreshold: 252000 },
    { level: 36, name: 'Hypercar Hunter',     xpThreshold: 274000 },
    { level: 37, name: 'Nurburgring Ace',     xpThreshold: 297000 },
    { level: 38, name: 'Octane Oracle',       xpThreshold: 322000 },
    { level: 39, name: 'Aerodynamic Genius',  xpThreshold: 348000 },
    { level: 40, name: 'Racing Immortal',     xpThreshold: 376000 },
    { level: 41, name: 'Titanium Throttle',   xpThreshold: 406000 },
    { level: 42, name: 'Supercar Sage',       xpThreshold: 438000 },
    { level: 43, name: 'Track Phantom',       xpThreshold: 472000 },
    { level: 44, name: 'Engine Whisperer',    xpThreshold: 508000 },
    { level: 45, name: 'Velocity Vanguard',   xpThreshold: 546000 },
    { level: 46, name: 'Downforce Deity',     xpThreshold: 586000 },
    { level: 47, name: 'Piston Prodigy',      xpThreshold: 628000 },
    { level: 48, name: 'Automotive Architect', xpThreshold: 672000 },
    { level: 49, name: 'Living Legend',       xpThreshold: 720000 },
    { level: 50, name: 'Car God',             xpThreshold: 770000 },
];

/** XP awarded per vehicle rarity (1-5). */
export const XP_PER_RARITY: { [key: number]: number } = {
    1: 10,    // Rust Bucket
    2: 20,    // Common
    3: 50,    // Uncommon
    4: 100,   // Rare
    5: 250,   // Legendary
};

/** XP awarded for a card trade (future Connected Lens). */
export const XP_PER_TRADE: number = 15;

/** Streak multiplier by consecutive days. */
export function getStreakMultiplier(streakDays: number): number {
    if (streakDays <= 1) return 1.0;
    if (streakDays === 2) return 1.2;
    return 1.5;  // 3+ days
}

/** Returns the LevelDef for a given cumulative XP total. */
export function getLevelForXP(totalXP: number): LevelDef {
    let result = LEVEL_TABLE[0];
    for (let i = 0; i < LEVEL_TABLE.length; i++) {
        if (totalXP >= LEVEL_TABLE[i].xpThreshold) {
            result = LEVEL_TABLE[i];
        } else {
            break;
        }
    }
    return result;
}

/** Returns XP needed for the NEXT level, or -1 if already max. */
export function getXPForNextLevel(currentLevel: number): number {
    if (currentLevel >= LEVEL_TABLE.length) return -1;
    const nextIdx = currentLevel; // LEVEL_TABLE[0] = level 1, so LEVEL_TABLE[currentLevel] = next level
    if (nextIdx >= LEVEL_TABLE.length) return -1;
    return LEVEL_TABLE[nextIdx].xpThreshold;
}

/** Returns a default empty UserProfile. */
export function createDefaultProfile(): UserProfile {
    return {
        level: 1,
        totalXP: 0,
        prestige: 0,
        lastLoginDate: '',
        streakDays: 0,
        totalScans: 0,
        totalTrades: 0,
        trustScore: TRUST_DEFAULT,
        consecutiveCheats: 0,
        totalCheats: 0,
        cardsGiven: 0,
        cardsReceived: 0,
    };
}

/** Formats prestige stars: e.g. prestige=3 -> "⭐⭐⭐" */
export function formatPrestigeStars(prestige: number): string {
    if (prestige <= 0) return '';
    let stars = '';
    for (let i = 0; i < prestige; i++) {
        stars += '\u2B50';  // ⭐
    }
    return stars;
}

// =====================================================================
// TRUST SCORE — Anti-cheat reputation system
// =====================================================================

export interface TrustRankDef {
    minScore: number;
    name: string;
}

export const TRUST_RANKS: TrustRankDef[] = [
    { minScore: 95, name: 'Grand Tourer' },
    { minScore: 85, name: 'Trusted Driver' },
    { minScore: 70, name: 'Road Regular' },
    { minScore: 55, name: 'Suspect Driver' },
    { minScore: 40, name: 'Shady Dealer' },
    { minScore: 25, name: 'Fraud Runner' },
    { minScore: 10, name: 'Car Thief' },
    { minScore: 0,  name: 'Crook' },
];

export const TRUST_DEFAULT: number = 80;

export function getTrustRank(score: number): TrustRankDef {
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    for (let i = 0; i < TRUST_RANKS.length; i++) {
        if (clamped >= TRUST_RANKS[i].minScore) return TRUST_RANKS[i];
    }
    return TRUST_RANKS[TRUST_RANKS.length - 1];
}

/**
 * Penalty for a cheat attempt. Escalates with consecutive cheats.
 * First offense: -3, then -5, -8, -12, -17... (accelerating).
 */
export function getTrustPenalty(consecutiveCheats: number): number {
    const base = 3;
    const escalation = Math.min(consecutiveCheats, 10);
    return base + escalation * 2;
}

/** Reward for a legitimate successful scan: +2 (steady recovery). */
export const TRUST_SCAN_REWARD: number = 2;

/**
 * Returns a hex color string interpolated between red (0%) and green (100%).
 * Format: "rrggbb" (no # prefix — Lens Studio richtext uses <color=...>).
 */
export function getTrustColor(score: number): string {
    const t = Math.max(0, Math.min(100, score)) / 100;
    const r = Math.round(255 * (1 - t));
    const g = Math.round(255 * t);
    const rHex = r.toString(16).padStart(2, '0');
    const gHex = g.toString(16).padStart(2, '0');
    return rHex + gHex + '00';
}

export function formatTrustText(score: number): string {
    return 'Trust: ' + Math.round(Math.max(0, Math.min(100, score))) + '%';
}

// =====================================================================
// CONNECTED LENS — Simplified card data for network transit
// =====================================================================

/**
 * Lightweight card representation sent over the network in Connected Lens sessions.
 * Images are sent separately via dedicated CARD_IMAGE messages (chunked if >90KB).
 */
export interface SimplifiedCard {
    brand?: string;
    brand_model: string;
    type: string;
    year: string;
    rarity: number;
    rarity_label: string;
    serial: string;
    top_speed: number;
    acceleration: number;
    braking: number;
    traction: number;
    comfort: number;
    savedAt?: number;
    dateScanned?: string;
    cityScanned?: string;
}

// =====================================================================
// STAT UTILITIES
// =====================================================================

/** Clamps a stat value to the 1-5 integer range. Defaults to 1 if invalid. */
export function clampStat(value: number): number {
    if (!value || typeof value !== 'number') {
        return 1;
    }
    return Math.max(1, Math.min(5, Math.round(value)));
}

// =====================================================================
// RARITY UTILITIES
// =====================================================================

/** Returns the rarity label for a score (1-5). */
export function getRarityLabel(rarity: number): string {
    switch (rarity) {
        case 1: return 'Rust Bucket';
        case 2: return 'Common';
        case 3: return 'Uncommon';
        case 4: return 'Rare';
        case 5: return 'Legendary';
        default: return 'Common';
    }
}

/** Returns a star string for the given rarity score. E.g. 3 -> "★★★☆☆" */
export function getRarityStars(rarity: number): string {
    const clamped = Math.max(1, Math.min(5, Math.round(rarity)));
    let stars = '';
    for (let i = 0; i < 5; i++) {
        stars += (i < clamped) ? '★' : '☆';
    }
    return stars;
}

/** Formats rarity as "★★★★☆ Rare" */
export function formatRarityText(rarity: number, label: string): string {
    return getRarityStars(rarity) + ' ' + label;
}

// =====================================================================
// CAR TYPE FORMATTING
// =====================================================================

/** Formats a vehicle type code into a display-friendly string. */
export function formatCarType(type: string): string {
    const typeMap: { [key: string]: string } = {
        sedan: 'Sedan',
        sports: 'Sports Car',
        suv: 'SUV',
        truck: 'Truck',
        convertible: 'Convertible',
        coupe: 'Coupé',
        hatchback: 'Hatchback',
        minivan: 'Minivan',
        wagon: 'Wagon',
        pickup: 'Pickup',
    };
    return typeMap[(type || '').toLowerCase()] || type || 'Unknown';
}

// =====================================================================
// SCAN CONTEXT — Date & City capture at scan time
// =====================================================================

/** Formats a timestamp into a readable date string: "Feb 15, 2026" */
export function formatScanDate(timestamp: number): string {
    try {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const d = new Date(timestamp);
        const month = d.getMonth();
        const day = d.getDate();
        const year = d.getFullYear();
        if (isNaN(month) || isNaN(day) || isNaN(year)) {
            print('VehicleTypes: Date parsing failed for timestamp ' + timestamp);
            return timestamp.toString();
        }
        return months[month] + ' ' + day + ', ' + year;
    } catch (e) {
        print('VehicleTypes: formatScanDate error: ' + e);
        return timestamp.toString();
    }
}

// =====================================================================
// SERIAL GENERATION
// =====================================================================

/**
 * Generates a unique card serial in format: DGNS-XXXX-XXXX-XXXX
 * Uses a combination of timestamp-derived hex and random hex to guarantee
 * uniqueness even across future connected lens / multiplayer sessions.
 *
 * Anatomy:
 *   DGNS — Fixed prefix (brand identifier)
 *   Block 1 — 4 hex chars derived from timestamp (low bits)
 *   Block 2 — 4 hex chars random
 *   Block 3 — 4 hex chars random
 *
 * Collision probability: ~1 in 4 billion per timestamp millisecond.
 */
export function generateSerial(): string {
    const HEX = '0123456789ABCDEF';

    // Block 1: timestamp-derived (last 16 bits of ms timestamp in hex)
    const ts = Date.now();
    const tsHex = ((ts & 0xFFFF) >>> 0).toString(16).toUpperCase().padStart(4, '0');

    // Block 2 & 3: random hex
    let block2 = '';
    let block3 = '';
    for (let i = 0; i < 4; i++) {
        block2 += HEX.charAt(Math.floor(Math.random() * 16));
        block3 += HEX.charAt(Math.floor(Math.random() * 16));
    }

    return 'DGNS-' + tsHex + '-' + block2 + '-' + block3;
}

// =====================================================================
// SCENE OBJECT HELPERS
// =====================================================================

/** Recursively searches for a child SceneObject by name. */
export function findChildByName(parent: SceneObject, name: string): SceneObject | null {
    const childCount = parent.getChildrenCount();
    for (let i = 0; i < childCount; i++) {
        const child = parent.getChild(i);
        if (!child) continue;
        if (child.name === name) return child;
        const found = findChildByName(child, name);
        if (found) return found;
    }
    return null;
}

/** Recursively enables all descendants of a SceneObject. */
export function enableAllDescendants(parent: SceneObject): void {
    const count = parent.getChildrenCount();
    for (let i = 0; i < count; i++) {
        const child = parent.getChild(i);
        if (child) {
            child.enabled = true;
            enableAllDescendants(child);
        }
    }
}
