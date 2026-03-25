/**
 * VehicleScanner.ts — Image capture + OpenAI vehicle analysis for DGNS Vehicle Scanner
 *
 * Handles:
 *   - High-resolution image capture via CameraModule
 *   - Camera frame freeze/restore for preview feedback
 *   - Base64 encoding of textures
 *   - OpenAI GPT-4o Vision API call with detailed vehicle identification prompt
 *   - Parsing and validating the JSON response into VehicleData
 *   - Depth-based 3D positioning of the Vehicle Card
 *
 * Exposes a single public method `scanVehicle()` returning VehicleData or null.
 *
 * @author DGNS
 * @license MIT
 */

import { OpenAI } from 'RemoteServiceGateway.lspkg/HostedExternal/OpenAI';
import { VehicleData, clampStat, getRarityLabel } from './VehicleTypes';
import { getLanguage } from './Localization';

@component
export class VehicleScanner extends BaseScriptComponent {

    // =====================================================================
    // MODULES
    // =====================================================================
    private cameraModule: CameraModule = require('LensStudio:CameraModule');
    private depthModule: DepthModule = require('LensStudio:DepthModule');

    // =====================================================================
    // INPUTS
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Camera Frame Photo" Image in Car Scan Interface (shows live preview + freeze frame)')
    cameraFrameImage: Image;

    @input
    @allowUndefined
    @hint('AudioTrackAsset for the camera shutter/capture sound effect')
    captureSoundAsset: AudioTrackAsset;

    @input
    @allowUndefined
    @hint('AudioComponent to play the capture sound')
    captureSoundPlayer: AudioComponent;

    @input
    @allowUndefined
    @hint('Vehicle Card SceneObject — used for depth-based 3D positioning')
    vehicleCard: SceneObject;

    // =====================================================================
    // INPUTS - Card positioning parameters
    // =====================================================================
    @input
    @hint('X offset from vehicle (cm)')
    cardOffsetX: number = 0;

    @input
    @hint('Y offset above vehicle (cm, height above roof)')
    cardOffsetY: number = 80;

    @input
    @hint('Z offset from vehicle (cm)')
    cardOffsetZ: number = 0;

    @input
    @hint('Base scale of Vehicle Card (recommended: 2)')
    cardBaseScale: number = 2;

    @input
    @hint('Minimum card scale (recommended: 1.5)')
    cardMinScale: number = 1.5;

    @input
    @hint('Maximum card scale (recommended: 4)')
    cardMaxScale: number = 4;

    @input
    @hint('Enable anti-cheat detection (rejects screens, photos, prints). Disable for testing with TV/monitor.')
    enableAntiCheat: boolean = true;

    // =====================================================================
    // INTERNAL STATE
    // =====================================================================
    private depthSession: DepthFrameSession;
    private latestDepthData: DepthFrameData | null = null;
    private cameraTexture: Texture;
    private isScanning: boolean = false;
    private _lastRejectionReason: string = '';

    // High quality base64 for GPT-4o analysis
    private lastCapturedBase64: string = '';
    // Medium quality base64 for gpt-image-1 editing (smaller payload, passes proxy limits)
    private lastCapturedBase64Edit: string = '';

    private readonly DEFAULT_BASE_SCALE: number = 2;
    private readonly DEFAULT_MIN_SCALE: number = 1.5;
    private readonly DEFAULT_MAX_SCALE: number = 4;
    private readonly NO_VEHICLE_MARKER: string = 'NO_VEHICLE';

    // =====================================================================
    // LIFECYCLE
    // =====================================================================
    onAwake(): void {
        this.createEvent('OnStartEvent').bind(() => {
            this.setupDepthTracking();
        });

        this.createEvent('OnDestroyEvent').bind(() => {
            if (this.depthSession) this.depthSession.stop();
        });
    }

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /**
     * Main entry point — captures an image, sends to OpenAI, returns VehicleData or null.
     * Also positions the Vehicle Card above the vehicle via depth data.
     * Throws on fatal errors. Returns null if no vehicle detected.
     */
    async scanVehicle(): Promise<VehicleData | null> {
        if (this.isScanning) {
            print('VehicleScanner: Scan already in progress');
            return null;
        }

        this.isScanning = true;
        this._lastRejectionReason = '';
        try {
            // Step 1: Capture image
            print('VehicleScanner: Capturing image...');
            const base64Image = await this.captureImage();

            // Store for CollectionManager (real photo for Image Edit)
            this.lastCapturedBase64 = base64Image;

            // Step 2: Send to OpenAI for identification
            print('VehicleScanner: Sending to GPT-4o Vision...');
            const vehicleData = await this.analyzeVehicle(base64Image);

            if (!vehicleData) {
                print('VehicleScanner: No vehicle detected');
                return null;
            }

            print('VehicleScanner: Vehicle identified: ' + vehicleData.brand_model);

            // Step 3: Position card above vehicle via depth
            this.positionCardAboveVehicle();

            return vehicleData;
        } finally {
            this.isScanning = false;
        }
    }

    /** Returns true if a scan is currently in progress. */
    getIsScanning(): boolean {
        return this.isScanning;
    }

    /**
     * Returns the Base64-encoded image from the last scan (high quality, for GPT-4o).
     */
    getLastCapturedBase64(): string {
        return this.lastCapturedBase64;
    }

    /**
     * Returns a compressed version of the captured image for gpt-image-1 editing.
     * Smaller payload to pass through the Snap proxy reliably.
     */
    getLastCapturedBase64ForEdit(): string {
        return this.lastCapturedBase64Edit.length > 0 ? this.lastCapturedBase64Edit : this.lastCapturedBase64;
    }

    /** Returns the anti-cheat rejection reason from the last scan, or empty string if none. */
    getLastRejectionReason(): string {
        return this._lastRejectionReason;
    }

    /** Restores live camera feed on the preview image. */
    restoreLiveCameraFeed(): void {
        if (!this.cameraFrameImage || !this.cameraTexture) return;
        this.cameraFrameImage.mainPass.baseTex = this.cameraTexture;
        print('VehicleScanner: Live camera feed restored');
    }

    // =====================================================================
    // DEPTH & CAMERA SETUP
    // =====================================================================
    private setupDepthTracking(): void {
        try {
            const cameraRequest = CameraModule.createCameraRequest();
            cameraRequest.cameraId = CameraModule.CameraId.Default_Color;
            this.cameraTexture = this.cameraModule.requestCamera(cameraRequest);
            print('VehicleScanner: Camera stream started');

            if (this.cameraFrameImage) {
                this.cameraFrameImage.mainPass.baseTex = this.cameraTexture;
                print('VehicleScanner: Live camera preview enabled');
            }

            this.depthSession = this.depthModule.createDepthFrameSession();
            this.depthSession.onNewFrame.add((depthData: DepthFrameData) => {
                this.latestDepthData = depthData;
            });
            this.depthSession.start();
            print('VehicleScanner: Depth tracking started');
        } catch (error) {
            print('VehicleScanner: Setup ERROR: ' + error);
            print('VehicleScanner: Enable "Experimental APIs" in Project Settings > Permissions');
        }
    }

    // =====================================================================
    // IMAGE CAPTURE
    // =====================================================================
    private async captureImage(): Promise<string> {
        // Attempt 1: Still image capture (preferred to guarantee freeze frame)
        const stillTexture = await this.requestStillCaptureTexture(2);
        if (stillTexture) {
            this.freezeCameraFrame(stillTexture);
            const base64 = await this.textureToBase64(stillTexture);
            print('VehicleScanner: HD image (' + Math.round((base64.length * 0.75) / 1024) + ' KB)');

            // Encode a smaller JPEG for gpt-image-1 image editing (~300KB vs 1.3MB)
            try {
                const editBase64 = await this.textureToBase64ForEdit(stillTexture);
                this.lastCapturedBase64Edit = editBase64;
                print('VehicleScanner: Edit JPEG (' + Math.round((editBase64.length * 0.75) / 1024) + ' KB)');
            } catch (editErr) {
                print('VehicleScanner: Edit encode failed, using HD: ' + editErr);
                this.lastCapturedBase64Edit = base64;
            }

            return base64;
        }

        // Attempt 2: Fallback to continuous camera stream
        if (!this.cameraTexture) {
            throw new Error('No camera source available');
        }

        print('VehicleScanner: Still capture unavailable — fallback to live stream texture (freeze may look less stable)');
        this.freezeCameraFrame(this.cameraTexture);
        const base64 = await this.textureToBase64(this.cameraTexture);
        print('VehicleScanner: Camera stream image (' + Math.round((base64.length * 0.75) / 1024) + ' KB)');

        try {
            const editBase64 = await this.textureToBase64ForEdit(this.cameraTexture);
            this.lastCapturedBase64Edit = editBase64;
            print('VehicleScanner: Edit JPEG (' + Math.round((editBase64.length * 0.75) / 1024) + ' KB)');
        } catch (editErr) {
            this.lastCapturedBase64Edit = base64;
        }

        return base64;
    }

    private async requestStillCaptureTexture(maxAttempts: number): Promise<Texture | null> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                print('VehicleScanner: Still capture attempt #' + attempt + '...');
                const imageRequest = CameraModule.createImageRequest();
                const imageFrame = await this.cameraModule.requestImage(imageRequest);
                if (imageFrame && imageFrame.texture) {
                    return imageFrame.texture;
                }
            } catch (err) {
                print('VehicleScanner: Still capture failed #' + attempt + ': ' + err);
            }
            if (attempt < maxAttempts) {
                await this.delay(0.06);
            }
        }
        return null;
    }

    private delay(seconds: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const ev = this.createEvent('DelayedCallbackEvent') as any;
            ev.bind(() => resolve());
            ev.reset(seconds);
        });
    }

    private freezeCameraFrame(capturedTexture: Texture): void {
        if (!this.cameraFrameImage) return;
        this.cameraFrameImage.mainPass.baseTex = capturedTexture;
        this.playCaptureSound();
    }

    private playCaptureSound(): void {
        if (!this.captureSoundPlayer || !this.captureSoundAsset) return;
        try {
            this.captureSoundPlayer.audioTrack = this.captureSoundAsset;
            this.captureSoundPlayer.play(1);
        } catch (e) {
            print('VehicleScanner: Capture sound error: ' + e);
        }
    }

    // =====================================================================
    // IMAGE -> BASE64 ENCODING
    // =====================================================================
    private textureToBase64(texture: Texture): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            try {
                Base64.encodeTextureAsync(
                    texture,
                    (base64String: string) => resolve(base64String),
                    () => reject(new Error('Failed to encode texture to base64')),
                    CompressionQuality.HighQuality,
                    EncodingType.Jpg
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    private textureToBase64ForEdit(texture: Texture): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            try {
                Base64.encodeTextureAsync(
                    texture,
                    (base64String: string) => resolve(base64String),
                    () => reject(new Error('Failed to encode texture for edit')),
                    CompressionQuality.LowQuality,
                    EncodingType.Jpg
                );
            } catch (error) {
                reject(error);
            }
        });
    }

    // =====================================================================
    // OPENAI GPT-4o VISION ANALYSIS
    // =====================================================================
    private async analyzeVehicle(base64Image: string): Promise<VehicleData | null> {
        const antiCheatBlock = this.enableAntiCheat ? `
ANTI-CHEAT DETECTION:
Before identifying the vehicle, check if the image is a DIRECT capture of a real vehicle in the physical world.
REJECT the image (set vehicle_found to false) if you detect ANY of the following:
- SCREEN CAPTURE: The vehicle is displayed on a phone, tablet, monitor, TV, or any digital screen.
  Look for: visible pixels/subpixels, screen bezels/borders, moire patterns, screen glare/reflections,
  status bars, UI elements, watermarks, low viewing angles showing screen edges.
- PHOTO OF A PHOTO: The image shows a printed photograph, poster, magazine page, or billboard.
  Look for: paper edges/borders, paper texture/grain, glossy reflections on print surface,
  visible folds/creases, framing or matting around the image.
- PRINTED/ARTIFICIAL IMAGE: The vehicle appears on packaging, a toy box, an advertisement board,
  a book cover, a calendar, or any non-real-world flat surface.
  Look for: unnatural flatness, printed halftone dots, surrounding text/logos/branding.
- DIGITAL/RENDERED IMAGE: The vehicle is clearly a 3D render, video game screenshot, or AI-generated image.
  Look for: unnaturally perfect lighting, no real-world context, CGI artifacts.
If ANY of these are detected, return:
{
  "vehicle_found": false,
  "rejection_reason": "SCREEN_OR_PHOTO_DETECTED",
  "brand": "NO_VEHICLE",
  "brand_model": "NO_VEHICLE",
  "type": "sedan",
  "year": "",
  "top_speed": 0, "acceleration": 0, "braking": 0, "traction": 0, "comfort": 0,
  "rarity": 0, "rarity_label": "", "scene": ""
}
Only proceed with vehicle identification if the image appears to be a DIRECT capture from a camera
pointing at a REAL vehicle in the PHYSICAL world (street, parking lot, garage, showroom, etc.).
` : `
TESTING MODE: You MUST identify any vehicle visible in the image regardless of whether it appears on a screen,
in a photo, a poster, or any other medium. Treat ALL vehicles as real. Do NOT reject any image.
Always set vehicle_found to true if ANY vehicle is visible, even on screens or in photos.
`;

        const systemPrompt = `You are a vehicle identification AI. Analyze the image and respond ONLY with a JSON object.

If a vehicle (car, truck, SUV, motorcycle, etc.) is clearly visible in the image, identify it:
{
  "vehicle_found": true,
  "brand": "Brand",
  "brand_model": "Brand Model",
  "type": "sedan|sports|suv|truck|convertible|coupe|hatchback|minivan|wagon|pickup",
  "year": "YYYY-YYYY",
  "top_speed": 1-5,
  "acceleration": 1-5,
  "braking": 1-5,
  "traction": 1-5,
  "comfort": 1-5,
  "rarity": 1-5,
  "rarity_label": "label",
  "scene": "brief description of the environment/setting"
}

If NO vehicle is visible in the image:
{
  "vehicle_found": false,
  "brand": "NO_VEHICLE",
  "brand_model": "NO_VEHICLE",
  "type": "sedan",
  "year": "",
  "top_speed": 0,
  "acceleration": 0,
  "braking": 0,
  "traction": 0,
  "comfort": 0,
  "rarity": 0,
  "rarity_label": "",
  "scene": ""
}
${antiCheatBlock}
Rules:
- ALWAYS return valid JSON. Never refuse. Never add text outside JSON.
- "brand" is ONLY the manufacturer name (e.g. "Renault", "BMW", "Mercedes-Benz").
- "brand_model" is the brand + model name (e.g. "Renault Scenic", "BMW 320i", "Tesla Model 3").
- "year" is the approximate production period (e.g. "2018-2023", "2020-present", "2015"). Estimate based on the model generation visible.
- Stats are integers 1-5 rated relative to ALL production cars ever made:
  1 = very poor performance (city cars, micro cars, old economy cars like Fiat Panda, Smart ForTwo)
  2 = below average (family cars, minivans, basic hatchbacks like Renault Scenic, VW Touran, Dacia Sandero)
  3 = average (midrange sedans, standard SUVs like VW Golf GTI, BMW 320i, Toyota RAV4)
  4 = above average (sports sedans, performance cars like BMW M3, Porsche Cayenne, Audi RS models)
  5 = exceptional (supercars, hypercars only like Ferrari, Lamborghini, McLaren, Bugatti)
- "comfort" rates ride comfort, cabin noise, suspension softness, seat quality:
  1 = very basic (sports cars with stiff suspension, bare-bones economy cars)
  2 = below average (budget hatchbacks, older models)
  3 = average (most modern sedans, family SUVs)
  4 = above average (luxury sedans, premium SUVs like BMW 5 Series, Mercedes E-Class)
  5 = exceptional (Rolls-Royce, Bentley, Mercedes S-Class, top luxury only)
- "rarity" rates the collectibility of THIS specific sighting. It combines TWO factors:
  A) How rare is this MODEL on European streets today? (rarity of the model itself)
  B) What VISIBLE CONDITION is the vehicle in? (clean/mint vs dirty/rusty/damaged)
  The final score blends both factors. A common model in perfect condition scores higher
  than the same model in poor condition. A rare model in poor condition still scores high.
  Score 4 and 5 remain VERY hard to reach — reserved for genuinely rare/exceptional vehicles.
  1 = Rust Bucket — very common model AND in visibly poor/dirty/rusty/old condition.
      The car looks neglected, damaged, faded paint, dents, rust spots, or clearly worn out.
      Examples: beat-up Peugeot 206, rusty Fiat Punto, dented Opel Corsa, dirty old Clio II.
  2 = Common — mass-produced model that you see every day, in average/normal condition.
      The car is functional and ordinary-looking, neither impressive nor neglected.
      Examples: Renault Clio, VW Golf, Toyota Yaris, Peugeot 3008, Dacia Sandero, Ford Fiesta,
      Citroen C3, Hyundai Tucson, Seat Ibiza, Opel Corsa (recent), BMW Serie 1, Audi A3.
  3 = Uncommon — either a less common model OR a common model in visibly excellent/mint condition.
      The car stands out: either because the model itself is not seen often, or because it
      looks pristine, freshly washed, well-maintained, or is a special variant (CC, GT, sport pack).
      Examples: Peugeot 307 CC in clean condition, Alfa Romeo Giulia, Mazda MX-5, Ford Mustang,
      Audi TT, BMW Z4, Subaru BRZ, any classic car 20+ years old in good shape,
      a brand-new Tesla Model S, a shiny well-kept BMW M240i.
  4 = Rare — genuinely rare model; you'd stop and look. Seen a few times per YEAR at most.
      Examples: Porsche 911 GT3, Maserati GranTurismo, Aston Martin Vantage, Lotus Elise,
      Ferrari California, Lamborghini Huracan, AMG GT, McLaren 570S, Alpine A110,
      Nissan GT-R, Morgan, pre-1970 classic cars in good condition, any car over 100k€ new.
  5 = Legendary — once-in-a-lifetime sighting. Most people will NEVER see one in person.
      Examples: Bugatti Chiron, Pagani Huayra, Koenigsegg Agera, Ferrari LaFerrari, McLaren P1,
      Lamborghini Veneno, Porsche 918, Aston Martin Valkyrie, Mercedes 300SL Gullwing,
      Ferrari 250 GTO, Jaguar XJ220, any car worth over 1 million euros.
- "rarity_label" MUST match the rarity score EXACTLY:
  1 = "Rust Bucket", 2 = "Common", 3 = "Uncommon", 4 = "Rare", 5 = "Legendary"
- "scene" is a SHORT (10-20 words max) description of the ENVIRONMENT visible in the background
  of the photo. Describe the SETTING, not the car. Examples:
  "urban street with apartment buildings and parked cars"
  "suburban residential area with houses and trees"
  "highway with guardrails and open countryside"
  "shopping mall parking lot with other vehicles"
  "narrow European cobblestone alley with old facades"
  "gas station forecourt with pumps and canopy"
  "industrial area with warehouses and concrete"
  "coastal road with ocean view and cliffs"
  If the background is unclear or mostly sky, just write "open road" or "generic street".
- CRITICAL RARITY RULES:
  * VISIBLE CONDITION MATTERS: Look at the photo carefully. Is the car clean, shiny, well-maintained?
    Or is it dirty, scratched, rusty, faded? A clean well-kept car scores +1 vs a neglected one.
  * A Peugeot 307 CC that is clean and in good condition = 3 (Uncommon). Same car dirty/rusty = 1 (Rust Bucket).
  * A VW Golf in average condition = 2 (Common). Same Golf brand new and shiny = 2 still (too common even clean).
  * "Premium" brand alone does NOT mean rare. A BMW 320d in normal condition = 2 (Common).
  * MOST cars scanned will be rarity 2 or 3. Score 1 only for visibly damaged/neglected cars.
    Score 4-5 should be exceptional (genuinely rare models regardless of condition).
- IMPORTANT: Most family/economy cars should have stats between 1 and 2. Only sports cars reach 3-4. Only supercars reach 5.
- Be realistic and accurate. A Renault Scenic is a family minivan = stats around 2, comfort 3, rarity 2 (Common).
- If image is blurry but a vehicle IS visible, do your best guess.`;

        print('VehicleScanner: OpenAI call (image: ' + Math.round((base64Image.length * 0.75) / 1024) + ' KB)...');

        const response = await OpenAI.chatCompletions({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`,
                                detail: 'high',
                            },
                        },
                        {
                            type: 'text',
                            text: 'Analyze this image. Is there a vehicle? If yes, identify it and rate its performance stats accurately. Return JSON only.',
                        },
                    ],
                },
            ],
            temperature: 0.2,
            max_tokens: 800,
        });

        const content = response.choices[0].message.content;
        print('VehicleScanner: OpenAI response: ' + content);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            print('VehicleScanner: No JSON in response');
            return null;
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]) as VehicleData;

            if (this.enableAntiCheat && parsed.rejection_reason) {
                print('VehicleScanner: ANTI-CHEAT — ' + parsed.rejection_reason);
                this._lastRejectionReason = parsed.rejection_reason;
                return null;
            }

            // No vehicle found?
            if (
                parsed.vehicle_found === false ||
                parsed.brand_model === this.NO_VEHICLE_MARKER ||
                parsed.brand_model.toLowerCase().includes('no_vehicle') ||
                parsed.brand_model.toLowerCase().includes('no vehicle') ||
                parsed.brand_model.toLowerCase().includes('unknown')
            ) {
                return null;
            }

            // Validate and clamp stats
            parsed.top_speed = clampStat(parsed.top_speed);
            parsed.acceleration = clampStat(parsed.acceleration);
            parsed.braking = clampStat(parsed.braking);
            parsed.traction = clampStat(parsed.traction);
            parsed.comfort = clampStat(parsed.comfort);
            parsed.rarity = clampStat(parsed.rarity || 2);
            parsed.rarity_label = getRarityLabel(parsed.rarity);

            // Extract brand if not provided
            if (!parsed.brand && parsed.brand_model) {
                parsed.brand = parsed.brand_model.split(' ')[0];
            }

            print('VehicleScanner: Stats: Speed=' + parsed.top_speed +
                ' Accel=' + parsed.acceleration +
                ' Brake=' + parsed.braking +
                ' Traction=' + parsed.traction +
                ' Comfort=' + parsed.comfort +
                ' Rarity=' + parsed.rarity + ' (' + parsed.rarity_label + ')' +
                ' Year=' + (parsed.year || 'N/A'));

            return parsed;
        } catch (parseError) {
            print('VehicleScanner: JSON parse error: ' + parseError);
            return null;
        }
    }

    // =====================================================================
    // 3D CARD POSITIONING (via depth data)
    // =====================================================================
    private positionCardAboveVehicle(): void {
        if (!this.vehicleCard) return;

        const cardTransform = this.vehicleCard.getTransform();

        const effectiveBaseScale = this.cardBaseScale <= 1 ? this.DEFAULT_BASE_SCALE : this.cardBaseScale;
        const effectiveMinScale = this.cardMinScale <= 1 ? this.DEFAULT_MIN_SCALE : this.cardMinScale;
        const effectiveMaxScale = this.cardMaxScale <= 1 ? this.DEFAULT_MAX_SCALE : this.cardMaxScale;

        // No depth data -> fallback position
        if (!this.latestDepthData) {
            cardTransform.setWorldPosition(new vec3(0, 80, -200));
            const s = effectiveBaseScale;
            cardTransform.setWorldScale(new vec3(s, s, s));
            return;
        }

        try {
            const depthCamera = this.latestDepthData.deviceCamera;
            const resolution = depthCamera.resolution;

            const normalizedCoord = new vec2(0.5, 0.5);
            const pixelX = Math.floor(0.5 * resolution.x);
            const pixelY = Math.floor(0.5 * resolution.y);
            const depthFrameIdx = pixelX + pixelY * resolution.x;
            const depthValue = this.latestDepthData.depthFrame[depthFrameIdx];

            // Validate depth (50cm to 20m)
            if (!depthValue || depthValue <= 50 || depthValue > 2000) {
                cardTransform.setWorldPosition(new vec3(0, 80, -200));
                const s = effectiveBaseScale;
                cardTransform.setWorldScale(new vec3(s, s, s));
                return;
            }

            // Unproject to 3D
            const point3D = depthCamera.unproject(normalizedCoord, depthValue);
            const worldFromDevice = this.latestDepthData.toWorldTrackingOriginFromDeviceRef;
            const vehicleWorldPos = worldFromDevice.multiplyPoint(point3D);

            const cardPosition = new vec3(
                vehicleWorldPos.x + this.cardOffsetX,
                vehicleWorldPos.y + this.cardOffsetY,
                vehicleWorldPos.z + this.cardOffsetZ
            );
            cardTransform.setWorldPosition(cardPosition);

            // Adaptive scale based on distance
            const distanceFactor = depthValue / 200.0;
            const scale = Math.max(effectiveMinScale, Math.min(effectiveMaxScale, effectiveBaseScale * distanceFactor));
            cardTransform.setWorldScale(new vec3(scale, scale, scale));

            // Orient facing camera (billboard)
            const cameraWorldPos = new vec3(
                worldFromDevice.column3.x,
                worldFromDevice.column3.y,
                worldFromDevice.column3.z
            );
            const toCamera = cameraWorldPos.sub(cardPosition);
            if (toCamera.length > 0.01) {
                cardTransform.setWorldRotation(quat.lookAt(toCamera.normalize(), vec3.up()));
            }

            print('VehicleScanner: Card positioned at depth=' + depthValue.toFixed(0) + 'cm, scale=' + scale.toFixed(2));
        } catch (error) {
            print('VehicleScanner: Positioning error: ' + error);
            cardTransform.setWorldPosition(new vec3(0, 80, -200));
            const s = effectiveBaseScale;
            cardTransform.setWorldScale(new vec3(s, s, s));
        }
    }
}
