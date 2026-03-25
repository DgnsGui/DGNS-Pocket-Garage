/**
 * BrandLogoLoader.ts — Brand logo loading for DGNS Vehicle Scanner
 *
 * Handles downloading and applying brand logos from the internet.
 * Contains the brand-to-URL mapping and two cascade loading methods:
 *   1) performHttpRequest + asResource + loadResourceAsImageTexture (official Snap approach)
 *   2) fetch + bytes + Base64.decodeTextureAsync (fallback)
 *
 * Used by both the Vehicle Card (main logo) and Collector Cards (per-card logos).
 *
 * @author DGNS
 * @license MIT
 */

@component
export class BrandLogoLoader extends BaseScriptComponent {

    // =====================================================================
    // MODULES
    // =====================================================================
    private remoteMediaModule: RemoteMediaModule = require('LensStudio:RemoteMediaModule');
    private internetModule: InternetModule = require('LensStudio:InternetModule');

    // =====================================================================
    // INPUTS
    // =====================================================================
    @input
    @allowUndefined
    @hint('"Car Brand Logo" SceneObject on the Vehicle Card (with Image component)')
    carBrandLogo: SceneObject;

    // =====================================================================
    // CONSTANTS
    // =====================================================================

    /** User-Agent required by Wikimedia Commons (anti-bot policy). */
    private readonly HTTP_USER_AGENT: string = 'LensStudio/5.15 SnapSpectacles CarScanner/1.0';

    /** Brand name (lowercase) -> logo image URL. */
    private readonly BRAND_LOGO_URLS: { [key: string]: string } = {
        'citroën': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Citroen-logo-2048x2048-grand.png',
        'dacia': 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Dacia-logo.png',
        'volkswagen': 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Volkswagen_logo.png',
        'toyota': 'https://1000logos.net/wp-content/uploads/2018/02/Toyota-logo.png',
        'bmw': 'https://freepngimg.com/download/bmw/60127-mini-car-bmw-vehicle-logo-luxury.png',
        'tesla': 'https://cdn.freebiesupply.com/logos/large/2x/tesla-motors-logo-png-transparent.png',
        'smart': 'https://upload.wikimedia.org/wikipedia/commons/2/24/Logo_smart.png',
        'ford': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/ford-logo-2017-grand.png',
        'audi': 'https://freepngimg.com/download/audi/29748-2-audi-logo-with-transparent-background.png',
        'kia': 'https://upload.wikimedia.org/wikipedia/commons/1/13/Kia-logo.png',
        'fiat': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Logo-Fiat.png',
        'chevrolet': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Chevrolet-logo-2560x1440-grand.png',
        'subaru': 'https://crystalpng.com/wp-content/uploads/2025/07/Subaru-Logo.png',
        'lexus': 'https://freepngimg.com/thumb/car_logo/15-lexus-car-logo-png-brand-image.png',
        'dodge': 'https://upload.wikimedia.org/wikipedia/commons/b/b2/Dodge_logo_2010.png',
        'renault': 'https://static.vecteezy.com/ti/vecteur-libre/p1/20500659-renault-symbole-marque-voiture-logo-blanc-conception-francais-voiture-vecteur-illustration-avec-noir-contexte-gratuit-vectoriel.jpg',
        'peugeot': 'https://upload.wikimedia.org/wikipedia/fr/b/b9/Peugeot_logo2009.png',
        'mercedes-benz': 'https://wallpapers.com/images/hd/mercedes-benz-logo-silver-j139sho6y9ltnkbh-j139sho6y9ltnkbh.jpg',
        'hyundai': 'https://e7.pngegg.com/pngimages/793/602/png-clipart-hyundai-motor-company-car-logo-emblem-hyundai-emblem-text.png',
        'skoda': 'https://upload.wikimedia.org/wikipedia/commons/0/09/%C5%A0koda_nieuw.png',
        'nissan': 'https://cdn.freebiesupply.com/logos/large/2x/nissan-2-logo-png-transparent.png',
        'suzuki': 'https://www.mt-moto.fr/wp-content/uploads/2016/05/logo-suzuki-png-sans-fond.png',
        'mini': 'https://www.pngplay.com/wp-content/uploads/13/MINI-Logo-Transparent-Background.png',
        'volvo': 'https://logowik.com/content/uploads/images/325_volvo.jpg',
        'honda': 'https://cdn.pixabay.com/photo/2016/08/15/18/18/honda-1596081_960_720.png',
        'gmc': 'https://logos-world.net/wp-content/uploads/2021/08/GMC-Emblem.png',
        'jeep': 'https://1000logos.net/wp-content/uploads/2018/04/Color-Jeep-logo.jpg',
        'polestar': 'https://logos-marques.com/wp-content/uploads/2022/03/Polestar-Logo-1996-1-500x371.png',
        'bugatti': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Bugatti-logo-1024x768-grand.png',
        'mclaren': 'https://cdn.vectorstock.com/i/1000v/89/71/mclaren-logo-symbol-white-vector-46088971.jpg',
        'rivian': 'https://1000logos.net/wp-content/uploads/2022/08/Rivian-Symbol.png',
        'Maserati': 'https://static.vecteezy.com/system/resources/previews/020/500/057/non_2x/maserati-symbol-brand-logo-with-name-white-design-italian-car-automobile-illustration-with-black-background-free-vector.jpg',
        'Ferrari': 'https://logo-marque.com/wp-content/uploads/2020/05/Ferrari-Logo.png',
        'Cadillac': 'https://mphclub.com/wp-content/uploads/2020/07/CADILLAC_LOGO-01-1024x1024.png',
        'Opel': 'https://icon2.cleanpng.com/20180401/ofw/kisspng-opel-astra-opel-insignia-car-opel-corsa-opel-5ac191f031c078.3661308415226352482038.jpg',
        'Alfa Romeo': 'https://i.pinimg.com/736x/0f/0e/23/0f0e2344e7ffb1ea0259f0a0f3438dc8.jpg',
        'Mazda': 'https://www.logo-voiture.com/wp-content/uploads/2023/02/Mazda-Logo-1024x576.png',
        'Seat': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/SEAT-logo-2012-6000x5000-grand.png',
        'Cupra': 'https://i.pinimg.com/736x/2f/56/a8/2f56a86723bfeee292ddd57e76fec275.jpg',
        'Daihatsu': 'https://i.pinimg.com/736x/1c/95/82/1c9582b3ca131666a0cccb319bc7be29.jpg',
        'Isuzu': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Isuzu-logo-1991-3840x2160-grand.png',
        'Chrysler': 'https://www.carlogos.org/car-logos/chrysler-logo-1998-download.png',
        'Buick': 'https://icon2.cleanpng.com/20180805/ity/kisspng-buick-lacrosse-general-motors-car-gmc-5b676f6f3954d9.9591598315335053912348.jpg',
        'Lincoln': 'https://crystalpng.com/wp-content/uploads/2025/07/LINCOLN.png',
        'RAM': 'https://logo-marque.com/wp-content/uploads/2022/01/Dodge-Ram-Logo-1993-2009.jpg',
        'Lancia': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Lancia-logo-2007-1920x1080-grand.png',
        'Saab': 'https://e7.pngegg.com/pngimages/82/288/png-clipart-saab-automobile-car-saab-ursaab-saab-9-3-saab-automobile-emblem-logo.png',
        'Daewoo': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Daewoo-logo-1920x1080-grand.png',
        'Porsche': 'https://e7.pngegg.com/pngimages/408/940/png-clipart-porsche-macan-car-logo-audi-rs-2-avant-porsche-emblem-label.png',
        'Aston Martin': 'https://www.shutterstock.com/image-photo/aston-martin-logo-their-car-600nw-2291702305.jpg',
        'Bentley': 'https://www.logo-voiture.com/wp-content/uploads/2023/03/logo-bentley-noir-blanc.jpeg',
        'Rolls-Royce': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Rolls-Royce-logo-2048x2048-grand.png',
        'Lamborghini': 'https://www.logo-voiture.com/wp-content/uploads/2023/08/lamborghini-logo-1998-640.png',
        'Maybach': 'https://marque-voiture.com/wp-content/uploads/2016/11/logo-Maybach.png',
        'Genesis': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Genesis-logo-4096x1638-grand.jpg',
        'DS Automobiles': 'https://cdn.abcmoteur.fr/wp-content/uploads/2015/03/DS-Logo-2015.jpg',
        'BYD': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/BYD-logo-2560x1440-grand.png',
        'Chery': 'https://marque-voiture.com/wp-content/uploads/2018/01/Chery-Logo-2013.png',
        'Xpeng': 'https://www.tla-automobiles-saint-etienne.fr/wp-content/uploads/2025/03/Logo-Fond-Blanc-1.png',
        'Lotus': 'https://seekvectorlogo.com/wp-content/uploads/2017/12/lotus-cars-vector-logo.png',
        'Pagani': 'https://www.logo-voiture.com/wp-content/uploads/2021/01/Logo-Pagani.png',
        'Koenigsegg': 'https://upload.wikimedia.org/wikipedia/commons/0/0a/Koenigsegg-logo-1994-2048x2048.png',
        'Man': 'https://1000logos.net/wp-content/uploads/2021/04/MAN-logo.png',
        'Scania': 'https://1000logos.net/wp-content/uploads/2020/03/Scania-Logo-1.png',
        'Iveco': 'https://www.carlogos.org/logo/Iveco-logo-silver-3840x2160.png',
        'UAZ': 'https://1000logos.net/wp-content/uploads/2021/01/UAZ-Logo.png',
    };

    // =====================================================================
    // PUBLIC API
    // =====================================================================

    /**
     * Loads and displays the brand logo on the Vehicle Card's carBrandLogo @input.
     * Tries Method 1 (performHttpRequest), then falls back to Method 2 (fetch+Base64).
     */
    loadLogo(brand: string): void {
        if (!this.carBrandLogo) {
            print('BrandLogoLoader: carBrandLogo not assigned');
            return;
        }
        if (!this.internetModule) {
            print('BrandLogoLoader: InternetModule not available');
            return;
        }

        const logoUrl = this.getBrandLogoUrl(brand);
        if (!logoUrl) {
            print('BrandLogoLoader: No known logo for "' + brand + '"');
            return;
        }

        print('BrandLogoLoader: Loading "' + brand + '" from ' + logoUrl);
        this.loadLogoMethod1(brand, logoUrl, this.carBrandLogo, false);
    }

    /**
     * Returns the logo URL for a given brand, or null if unknown.
     * Public so that CollectionManager can use it for collector card logos.
     */
    getBrandLogoUrl(brand: string): string | null {
        const brandLower = brand.toLowerCase().trim();

        // Exact match
        if (this.BRAND_LOGO_URLS[brandLower]) {
            return this.BRAND_LOGO_URLS[brandLower];
        }

        // Normalized match (lowercase + remove spaces/dashes)
        const brandNormalized = brandLower.replace(/[\s\-]+/g, '');
        for (const key in this.BRAND_LOGO_URLS) {
            if (key.toLowerCase().trim().replace(/[\s\-]+/g, '') === brandNormalized) {
                return this.BRAND_LOGO_URLS[key];
            }
        }

        print('BrandLogoLoader: Brand "' + brand + '" not in logo list');
        return null;
    }

    /**
     * Loads a logo onto an arbitrary SceneObject (used for collector card logos).
     * Clones the material before applying to prevent shared-material bugs.
     */
    loadLogoOntoObject(logoObj: SceneObject, logoUrl: string): void {
        if (!this.internetModule) return;
        this.loadLogoMethod1('card', logoUrl, logoObj, true);
    }

    // =====================================================================
    // PRIVATE — Loading methods
    // =====================================================================

    /**
     * Method 1: performHttpRequest + response.asResource() + loadResourceAsImageTexture.
     * Falls back to Method 2 on failure.
     * @param cloneMaterial If true, clones the material before applying (for prefab instances).
     */
    private loadLogoMethod1(brand: string, logoUrl: string, targetObj: SceneObject, cloneMaterial: boolean): void {
        try {
            const request = RemoteServiceHttpRequest.create();
            request.url = logoUrl;
            request.setHeader('User-Agent', this.HTTP_USER_AGENT);

            this.internetModule.performHttpRequest(request, (response: RemoteServiceHttpResponse) => {
                if (response.statusCode < 200 || response.statusCode >= 400) {
                    print('BrandLogoLoader: [M1] HTTP ' + response.statusCode + ' -> fallback M2');
                    this.loadLogoMethod2(brand, logoUrl, targetObj, cloneMaterial);
                    return;
                }

                try {
                    const resource = response.asResource();
                    if (!resource || !this.remoteMediaModule) {
                        this.loadLogoMethod2(brand, logoUrl, targetObj, cloneMaterial);
                        return;
                    }

                    this.remoteMediaModule.loadResourceAsImageTexture(
                        resource,
                        (texture: Texture) => {
                            print('BrandLogoLoader: [M1] Texture loaded for ' + brand);
                            this.applyTextureToObject(texture, targetObj, cloneMaterial);
                        },
                        (error: string) => {
                            print('BrandLogoLoader: [M1] Load failed: ' + error + ' -> fallback M2');
                            this.loadLogoMethod2(brand, logoUrl, targetObj, cloneMaterial);
                        }
                    );
                } catch (e) {
                    this.loadLogoMethod2(brand, logoUrl, targetObj, cloneMaterial);
                }
            });
        } catch (e) {
            this.loadLogoMethod2(brand, logoUrl, targetObj, cloneMaterial);
        }
    }

    /**
     * Method 2 (fallback): fetch + bytes + Base64.encode + Base64.decodeTextureAsync.
     */
    private async loadLogoMethod2(brand: string, logoUrl: string, targetObj: SceneObject, cloneMaterial: boolean): Promise<void> {
        try {
            print('BrandLogoLoader: [M2] fetch + Base64 for ' + brand);

            const response = await this.internetModule.fetch(logoUrl, {
                headers: { 'User-Agent': this.HTTP_USER_AGENT },
            });

            if (!response.ok) {
                print('BrandLogoLoader: [M2] HTTP ' + response.status + ' — aborting');
                return;
            }

            const bytes = await response.bytes();
            if (!bytes || bytes.length === 0) {
                print('BrandLogoLoader: [M2] 0 bytes — aborting');
                return;
            }

            const base64 = Base64.encode(bytes);

            Base64.decodeTextureAsync(
                base64,
                (texture: Texture) => {
                    print('BrandLogoLoader: [M2] Texture decoded for ' + brand);
                    this.applyTextureToObject(texture, targetObj, cloneMaterial);
                },
                () => {
                    print('BrandLogoLoader: [M2] Base64 decode failed');
                }
            );
        } catch (e) {
            print('BrandLogoLoader: [M2] Exception: ' + e);
        }
    }

    /**
     * Applies a texture to the Image or RenderMeshVisual component on a SceneObject.
     * Optionally clones the material first (needed for prefab instances to avoid shared-material bugs).
     */
    private applyTextureToObject(texture: Texture, targetObj: SceneObject, cloneMaterial: boolean): void {
        if (!targetObj) return;

        try {
            const imgComp = targetObj.getComponent('Component.Image') as Image;
            if (imgComp) {
                if (cloneMaterial) {
                    imgComp.mainMaterial = imgComp.mainMaterial.clone();
                }
                imgComp.mainPass.baseTex = texture;
                targetObj.enabled = true;
                return;
            }

            const meshComp = targetObj.getComponent('Component.RenderMeshVisual') as RenderMeshVisual;
            if (meshComp) {
                if (cloneMaterial) {
                    meshComp.mainMaterial = meshComp.mainMaterial.clone();
                }
                meshComp.mainPass.baseTex = texture;
                targetObj.enabled = true;
                return;
            }

            print('BrandLogoLoader: No visual component on target object');
        } catch (e) {
            print('BrandLogoLoader: Apply texture error: ' + e);
        }
    }
}
