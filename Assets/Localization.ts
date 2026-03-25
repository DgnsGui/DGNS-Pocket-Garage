/**
 * Localization.ts — Centralized i18n for DGNS Pocket Garage
 *
 * Supports: English (en), French (fr), Spanish (es)
 * Default language: English
 *
 * Usage:
 *   import { t, tf, setLanguage, getLanguage } from './Localization';
 *   setLanguage('fr');
 *   t('scan_failed');             // "Scan échoué"
 *   tf('saving', { name: 'BMW' }) // "Sauvegarde de BMW..."
 *
 * @author DGNS
 * @license MIT
 */

export type Lang = 'en' | 'fr' | 'es';

let currentLang: Lang = 'en';

export function setLanguage(lang: Lang): void {
    currentLang = lang;
    print('Localization: language set to ' + lang);
}

export function getLanguage(): Lang {
    return currentLang;
}

// =====================================================================
// TRANSLATION TABLE
// =====================================================================

const S: { [key: string]: { en: string; fr: string; es: string } } = {

    // -----------------------------------------------------------------
    // Language Container
    // -----------------------------------------------------------------
    accept_button:          { en: 'Accept', fr: 'Accepter', es: 'Aceptar' },

    // -----------------------------------------------------------------
    // Welcome Container
    // -----------------------------------------------------------------
    welcome_title:          { en: 'DGNS Pocket Garage', fr: 'DGNS Pocket Garage', es: 'DGNS Pocket Garage' },
    welcome_description:    {
        en: 'Welcome, Scan cars, collect them all... Point your Spectacles at any vehicle in the real world and instantly identify it with AI. Each scan creates a unique holographic trading card with stats, rarity, and a professionally generated card image, all floating right above the car.',
        fr: 'Bienvenue, Scannez des voitures, collectionnez-les toutes... Pointez vos Spectacles vers n\'importe quel véhicule dans le monde réel et identifiez-le instantanément grâce à l\'IA. Chaque scan crée une carte de collection holographique unique avec des stats, une rareté et une image générée professionnellement, le tout flottant juste au-dessus de la voiture.',
        es: 'Bienvenido, Escanea coches, colecciónalos todos... Apunta tus Spectacles a cualquier vehículo en el mundo real e identifícalo al instante con IA. Cada escaneo crea una tarjeta coleccionable holográfica única con estadísticas, rareza y una imagen generada profesionalmente, todo flotando justo encima del coche.',
    },
    solo:                   { en: 'Solo', fr: 'Solo', es: 'Solo' },
    connected_lens:         { en: 'Connected Lens', fr: 'Connected Lens', es: 'Connected Lens' },

    // -----------------------------------------------------------------
    // Static Container Texts (Yes/Cancel/warnings)
    // -----------------------------------------------------------------
    yes:                    { en: 'Yes', fr: 'Oui', es: 'Sí' },
    cancel_btn:             { en: 'Cancel', fr: 'Annuler', es: 'Cancelar' },
    action_undone:          { en: '\u26A0 This action cannot be undone. \u26A0', fr: '\u26A0 Cette action est irréversible. \u26A0', es: '\u26A0 Esta acción no se puede deshacer. \u26A0' },
    delete_card_question:   { en: 'Are you sure you want to delete this card?', fr: 'Voulez-vous supprimer cette carte ?', es: '¿Quieres eliminar esta carta?' },
    share_question:         { en: 'Are you sure you want to share your collection?', fr: 'Voulez-vous partager votre collection ?', es: '¿Quieres compartir tu colección?' },
    reset_question:         { en: 'Are you sure you want to reset your profile?', fr: 'Voulez-vous réinitialiser votre profil ?', es: '¿Quieres reiniciar tu perfil?' },
    give_card_default:      { en: 'Do you want to allow username to take this card?', fr: 'Voulez-vous permettre le transfert de cette carte ?', es: '¿Quieres permitir la transferencia de esta carta?' },
    trade_card_default:     { en: 'Do you want to allow username to take this card?', fr: 'Voulez-vous permettre l\'échange de cette carte ?', es: '¿Quieres permitir el intercambio de esta carta?' },

    // -----------------------------------------------------------------
    // Car Scan Interface
    // -----------------------------------------------------------------
    dgns_title:             { en: 'DGNS Car Scanner', fr: 'DGNS Car Scanner', es: 'DGNS Car Scanner' },
    loading_text:           { en: 'Loading', fr: 'Chargement', es: 'Cargando' },
    press_button_hint:      { en: 'Press the button in front of a vehicle', fr: 'Appuyez sur le bouton devant un véhicule', es: 'Pulsa el botón frente a un vehículo' },

    // -----------------------------------------------------------------
    // Scanner UI
    // -----------------------------------------------------------------
    scan_vehicle:           { en: 'Scan Vehicle', fr: 'Scanner', es: 'Escanear' },
    close_scanner:          { en: 'Close Scanner', fr: 'Fermer Scanner', es: 'Cerrar Escáner' },
    open_scanner:           { en: 'Open Scanner', fr: 'Ouvrir Scanner', es: 'Abrir Escáner' },
    scanning:               { en: 'Scanning', fr: 'Scan en cours', es: 'Escaneando' },
    car_detected:           { en: 'Car detected, processing...', fr: 'Voiture détectée, analyse...', es: 'Coche detectado, procesando...' },
    scan_failed:            { en: 'Scan failed', fr: 'Scan échoué', es: 'Escaneo fallido' },
    no_car_detected:        { en: 'No car detected', fr: 'Aucune voiture détectée', es: 'Ningún coche detectado' },

    // -----------------------------------------------------------------
    // Vehicle Narrator
    // -----------------------------------------------------------------
    scan_vehicle_first:     { en: 'Scan a vehicle first!', fr: 'Scannez un véhicule d\'abord !', es: '¡Escanea un vehículo primero!' },
    loading_info:           { en: 'Loading info', fr: 'Chargement des infos', es: 'Cargando info' },
    no_info_available:      { en: 'No info available for this vehicle.', fr: 'Aucune info disponible pour ce véhicule.', es: 'No hay info disponible para este vehículo.' },
    generating_audio:       { en: 'Generating audio', fr: 'Génération audio', es: 'Generando audio' },
    error_loading_info:     { en: 'Error loading vehicle info.', fr: 'Erreur lors du chargement des infos.', es: 'Error al cargar la info del vehículo.' },
    review_in_progress:     { en: 'Review already in progress...', fr: 'Revue déjà en cours...', es: 'Revisión ya en curso...' },

    // -----------------------------------------------------------------
    // Stat Labels (Vehicle Card)
    // -----------------------------------------------------------------
    top_speed:              { en: 'Top Speed', fr: 'Vitesse Max', es: 'Vel. Máxima' },
    acceleration:           { en: 'Acceleration', fr: 'Accélération', es: 'Aceleración' },
    braking:                { en: 'Braking', fr: 'Freinage', es: 'Frenado' },
    traction:               { en: 'Traction', fr: 'Traction', es: 'Tracción' },
    comfort:                { en: 'Comfort', fr: 'Confort', es: 'Confort' },

    // -----------------------------------------------------------------
    // Collection Manager
    // -----------------------------------------------------------------
    close_collection:       { en: 'Close Collection', fr: 'Fermer Collection', es: 'Cerrar Colección' },
    no_vehicles_collection: { en: 'No Vehicles\nin Collection', fr: 'Pas de Véhicules\nen Collection', es: 'Sin Vehículos\nen Colección' },
    open_collection:        { en: 'Open Collection', fr: 'Ouvrir Collection', es: 'Abrir Colección' },
    share_confirm:          { en: 'Are you sure you want to share your collection?', fr: 'Voulez-vous partager votre collection ?', es: '¿Quieres compartir tu colección?' },
    sharing:                { en: 'Sharing...', fr: 'Partage en cours...', es: 'Compartiendo...' },
    share_url:              { en: 'Collection Shared to this URL:\n', fr: 'Collection partagée à cette URL :\n', es: 'Colección compartida en esta URL:\n' },
    share_unavailable:      { en: 'Share unavailable (cloud not connected)', fr: 'Partage indisponible (cloud non connecté)', es: 'Compartir no disponible (nube no conectada)' },
    collection_not_shared:  { en: "Collection not shared :'(", fr: "Collection non partagée :'(", es: "Colección no compartida :'(" },
    reset_confirm:          { en: 'Reset your entire profile?\nAll cards, XP, level and stats will be lost forever!', fr: 'Réinitialiser votre profil ?\nToutes les cartes, XP, niveaux et stats seront perdus !', es: '¿Reiniciar tu perfil completo?\n¡Todas las cartas, XP, niveles y stats se perderán!' },
    scanned_by_unknown:     { en: 'Scanned by: Unknown', fr: 'Scanné par : Inconnu', es: 'Escaneado por: Desconocido' },
    no_vehicles_share:      { en: 'No vehicles to share!', fr: 'Pas de véhicules à partager !', es: '¡No hay vehículos para compartir!' },
    share_collection_q:     { en: 'Share your collection?', fr: 'Partager votre collection ?', es: '¿Compartir tu colección?' },
    sharing_collection:     { en: 'Sharing collection...', fr: 'Partage de la collection...', es: 'Compartiendo colección...' },
    collection_shared:      { en: 'Collection shared!', fr: 'Collection partagée !', es: '¡Colección compartida!' },
    share_unavail_short:    { en: 'Share unavailable', fr: 'Partage indisponible', es: 'Compartir no disponible' },
    reset_profile_q:        { en: 'Reset profile?', fr: 'Réinitialiser le profil ?', es: '¿Reiniciar perfil?' },
    reset_cancelled:        { en: 'Reset cancelled', fr: 'Réinitialisation annulée', es: 'Reinicio cancelado' },
    profile_reset:          { en: 'Profile reset — {count} cards deleted', fr: 'Profil réinitialisé — {count} cartes supprimées', es: 'Perfil reiniciado — {count} tarjetas eliminadas' },
    no_card_delete:         { en: 'No card to delete', fr: 'Pas de carte à supprimer', es: 'No hay carta para eliminar' },
    delete_confirm:         { en: 'Delete {name}?', fr: 'Supprimer {name} ?', es: '¿Eliminar {name}?' },
    card_deleted:           { en: '{name} deleted', fr: '{name} supprimé', es: '{name} eliminado' },
    delete_cancelled:       { en: 'Delete cancelled', fr: 'Suppression annulée', es: 'Eliminación cancelada' },
    save_in_progress:       { en: 'Save already in progress...', fr: 'Sauvegarde déjà en cours...', es: 'Guardado ya en curso...' },
    scan_first_save:        { en: 'Scan a vehicle first!', fr: 'Scannez un véhicule d\'abord !', es: '¡Escanea un vehículo primero!' },
    error_prefab:           { en: 'ERROR: verticalCardPrefab not assigned', fr: 'ERREUR : verticalCardPrefab non assigné', es: 'ERROR: verticalCardPrefab no asignado' },
    max_cards:              { en: 'Max number of cards acquired! ({max}/{max})', fr: 'Nombre max de cartes atteint ! ({max}/{max})', es: '¡Número máximo de cartas alcanzado! ({max}/{max})' },
    saving:                 { en: 'Saving {name}...', fr: 'Sauvegarde de {name}...', es: 'Guardando {name}...' },
    already_saved:          { en: '{name} already saved!', fr: '{name} déjà sauvegardé !', es: '¡{name} ya guardado!' },
    generating_card:        { en: 'Generating collector card', fr: 'Génération de la carte', es: 'Generando carta coleccionable' },
    card_instantiation_fail:{ en: 'ERROR: Card instantiation failed', fr: 'ERREUR : Création de carte échouée', es: 'ERROR: Fallo al crear la carta' },
    card_ready:             { en: '{name} card ready!', fr: 'Carte {name} prête !', es: '¡Carta {name} lista!' },
    added_to_collection:    { en: '{name} added to collection! ({count} cards)', fr: '{name} ajouté à la collection ! ({count} cartes)', es: '¡{name} añadido a la colección! ({count} cartas)' },
    card_gen_failed:        { en: 'Could not generate card, please try again later...', fr: 'Impossible de générer la carte, réessayez plus tard...', es: 'No se pudo generar la carta, inténtalo más tarde...' },
    save_error:             { en: 'SAVE ERROR: {error}', fr: 'ERREUR SAUVEGARDE : {error}', es: 'ERROR DE GUARDADO: {error}' },
    wait_reveal:            { en: 'Wait for card reveal to finish...', fr: 'Attendez la fin de la révélation...', es: 'Espera a que termine la revelación...' },
    collection_empty:       { en: 'Collection empty — scan & save vehicles first!', fr: 'Collection vide — scannez et sauvegardez des véhicules !', es: '¡Colección vacía — escanea y guarda vehículos primero!' },
    collection_count:       { en: 'Collection: {count} cards', fr: 'Collection : {count} cartes', es: 'Colección: {count} cartas' },
    collection_closed:      { en: 'Collection closed', fr: 'Collection fermée', es: 'Colección cerrada' },
    card_duplicate:         { en: 'Card already in collection!', fr: 'Carte déjà en collection !', es: '¡Carta ya en la colección!' },
    card_added:             { en: '{name} added to collection!', fr: '{name} ajouté à la collection !', es: '¡{name} añadido a la colección!' },
    card_given_away:        { en: '{name} given away!', fr: '{name} donné !', es: '¡{name} regalado!' },
    no_captured_photo:      { en: 'No captured photo — scan a vehicle first', fr: 'Pas de photo — scannez un véhicule d\'abord', es: 'Sin foto — escanea un vehículo primero' },
    generating_card_n:      { en: 'Generating Card ({n}/{total})', fr: 'Génération Carte ({n}/{total})', es: 'Generando Carta ({n}/{total})' },
    image_gen_busy:         { en: 'Image generation busy, try again later', fr: 'Génération d\'image occupée, réessayez plus tard', es: 'Generación de imagen ocupada, inténtalo más tarde' },
    card_sparkle:           { en: '\u2728 {name} \u2728', fr: '\u2728 {name} \u2728', es: '\u2728 {name} \u2728' },
    release_to_collect:     { en: '{name} — release to collect', fr: '{name} — relâchez pour collecter', es: '{name} — suelta para coleccionar' },
    card_collected:         { en: 'Card collected!', fr: 'Carte collectée !', es: '¡Carta coleccionada!' },

    // -----------------------------------------------------------------
    // XP Manager
    // -----------------------------------------------------------------
    lvl_prefix:             { en: 'LVL ', fr: 'NIV ', es: 'NIV ' },
    xp_max:                 { en: 'XP {xp} / MAX', fr: 'XP {xp} / MAX', es: 'XP {xp} / MAX' },
    xp_progress:            { en: 'XP {xp}/{next}', fr: 'XP {xp}/{next}', es: 'XP {xp}/{next}' },
    streak_long:            { en: '\u2728 {days}-day streak! x{mult} XP \u2728', fr: '\u2728 Série de {days} jours ! x{mult} XP \u2728', es: '\u2728 ¡Racha de {days} días! x{mult} XP \u2728' },
    streak_short:           { en: '\u2B50 2-day streak! x{mult} XP', fr: '\u2B50 Série de 2 jours ! x{mult} XP', es: '\u2B50 ¡Racha de 2 días! x{mult} XP' },
    no_streak:              { en: 'No Streak...\nCome back tomorrow!', fr: 'Pas de série...\nRevenez demain !', es: 'Sin racha...\n¡Vuelve mañana!' },
    prestige_label:         { en: 'Prestige', fr: 'Prestige', es: 'Prestigio' },
    xp_popup:               { en: '+{amount} XP', fr: '+{amount} XP', es: '+{amount} XP' },
    trust_popup:            { en: '+{amount}% Trust', fr: '+{amount}% Confiance', es: '+{amount}% Confianza' },
    trust_penalty:          { en: '-{amount}% Trust', fr: '-{amount}% Confiance', es: '-{amount}% Confianza' },
    level_up:               { en: 'LEVEL UP! LVL {level}: {name}', fr: 'NIVEAU SUPÉRIEUR ! NIV {level} : {name}', es: '¡SUBIDA DE NIVEL! NIV {level}: {name}' },
    level_up_reveal_title:  { en: 'LEVEL UP!', fr: 'NIVEAU SUPÉRIEUR !', es: '¡SUBIDA DE NIVEL!' },
    level_up_reveal_body:   { en: 'You go from LVL {from} to LVL {to}: {name}. Congratulations!', fr: 'Vous passez de NIV {from} à NIV {to} : {name}. Félicitations !', es: 'Pasas de NIV {from} a NIV {to}: {name}. ¡Felicidades!' },
    prestige_up:            { en: 'Prestige {n}! Back to Learner Driver', fr: 'Prestige {n} ! Retour à Learner Driver', es: '¡Prestigio {n}! Vuelves a Learner Driver' },
    streak_bonus_long:      { en: '\u2728 {days}-day streak! \u2728\nx{mult} XP bonus!', fr: '\u2728 Série de {days} jours ! \u2728\nx{mult} XP bonus !', es: '\u2728 ¡Racha de {days} días! \u2728\n¡x{mult} XP bonus!' },
    streak_bonus_short:     { en: '\u2B50 2-day streak! \u2B50\nx{mult} XP bonus!', fr: '\u2B50 Série de 2 jours ! \u2B50\nx{mult} XP bonus !', es: '\u2B50 ¡Racha de 2 días! \u2B50\n¡x{mult} XP bonus!' },

    // -----------------------------------------------------------------
    // Cloud Manager
    // -----------------------------------------------------------------
    profile_collection_reset: { en: 'Profile & collection reset', fr: 'Profil & collection réinitialisés', es: 'Perfil y colección reiniciados' },
    trade_failed_card:      { en: 'Trade failed: card not found', fr: 'Échange échoué : carte introuvable', es: 'Intercambio fallido: carta no encontrada' },
    trade_complete:         { en: 'Trade complete! Card received.', fr: 'Échange terminé ! Carte reçue.', es: '¡Intercambio completado! Carta recibida.' },
    trade_transfer_failed:  { en: 'Trade transfer failed', fr: 'Transfert d\'échange échoué', es: 'Transferencia de intercambio fallida' },
    trade_request:          { en: 'Trade request: {name}', fr: 'Demande d\'échange : {name}', es: 'Solicitud de intercambio: {name}' },
    trade_accepted:         { en: 'Trade accepted! {name}', fr: 'Échange accepté ! {name}', es: '¡Intercambio aceptado! {name}' },
    not_connected:          { en: 'Not connected to cloud', fr: 'Non connecté au cloud', es: 'No conectado a la nube' },
    scan_vehicles_first:    { en: 'Scan some vehicles first!', fr: 'Scannez des véhicules d\'abord !', es: '¡Escanea algunos vehículos primero!' },
    share_failed:           { en: 'Share failed', fr: 'Partage échoué', es: 'Error al compartir' },
    collection_shared_n:    { en: 'Collection shared! {count} vehicles', fr: 'Collection partagée ! {count} véhicules', es: '¡Colección compartida! {count} vehículos' },
    gallery_shared:         { en: 'Gallery shared!\n{url}', fr: 'Galerie partagée !\n{url}', es: '¡Galería compartida!\n{url}' },
    global_rank:            { en: 'Global Rank: #{rank} of {total}', fr: 'Classement : #{rank} sur {total}', es: 'Ranking global: #{rank} de {total}' },
    trade_request_card:     { en: 'Trade request: {name} ({rarity}\u2605)', fr: 'Demande d\'échange : {name} ({rarity}\u2605)', es: 'Solicitud de intercambio: {name} ({rarity}\u2605)' },
    cloud_not_connected:    { en: 'Cloud not connected', fr: 'Cloud non connecté', es: 'Nube no conectada' },
    share_failed_err:       { en: 'Share failed: {error}', fr: 'Partage échoué : {error}', es: 'Error al compartir: {error}' },

    // -----------------------------------------------------------------
    // Connected Lens Manager
    // -----------------------------------------------------------------
    anchor_found:           { en: 'Anchor found!\nSpatial map detected', fr: 'Ancre trouvée !\nCarte spatiale détectée', es: '¡Ancla encontrada!\nMapa espacial detectado' },
    aligning:               { en: 'Aligning...\nSyncing coordinate spaces', fr: 'Alignement...\nSynchronisation des espaces', es: 'Alineando...\nSincronizando espacios' },
    all_synced:             { en: 'All good, in sync!\nSpaces aligned — starting...', fr: 'Tout est bon, synchronisé !\nEspaces alignés — démarrage...', es: '¡Todo listo, sincronizado!\nEspacios alineados — iniciando...' },
    look_at_player:         { en: 'Look at your friend\nFace them head-on, within 2 meters', fr: 'Regardez votre ami\nFaites-lui face, à moins de 2 mètres', es: 'Mira a tu amigo\nPonte frente a él, a menos de 2 metros' },
    scan_room:              { en: 'You\'re the Host!\nSlowly look around to create a 3D map', fr: 'Vous êtes l\'Hôte !\nRegardez lentement autour pour créer une carte 3D', es: '¡Eres el Anfitrión!\nMira lentamente alrededor para crear un mapa 3D' },
    keep_scanning:          { en: 'Keep scanning...\nMove your head around the room', fr: 'Continuez à scanner...\nBougez la tête dans la pièce', es: 'Sigue escaneando...\nMueve la cabeza por la sala' },
    mapping_env:            { en: 'Mapping environment\nLook at walls, floor, and ceiling', fr: 'Cartographie en cours\nRegardez murs, sol et plafond', es: 'Mapeando entorno\nMira paredes, suelo y techo' },
    almost_there:           { en: 'Almost there...\nKeep looking around slowly', fr: 'Presque terminé...\nContinuez à regarder lentement', es: 'Casi listo...\nSigue mirando lentamente' },
    keep_looking_friend:    { en: 'Keep looking at your friend\nBoth players must wear Spectacles', fr: 'Continuez à regarder votre ami\nLes deux joueurs doivent porter des Spectacles', es: 'Sigue mirando a tu amigo\nAmbos jugadores deben llevar Spectacles' },
    aligning_spaces:        { en: 'Aligning spaces...\nYour Spectacles are syncing with theirs', fr: 'Alignement des espaces...\nVos Spectacles se synchronisent avec les siennes', es: 'Alineando espacios...\nTus Spectacles se sincronizan con las suyas' },
    good_lighting:          { en: 'Good lighting helps!\nStay within 2m, face-to-face', fr: 'Un bon éclairage aide !\nRestez à moins de 2m, face à face', es: '¡Buena iluminación ayuda!\nQuédate a menos de 2m, cara a cara' },
    partial_sync:           { en: 'Partial sync\nAlignment may be imprecise', fr: 'Synchronisation partielle\nL\'alignement peut être imprécis', es: 'Sincronización parcial\nEl alineamiento puede ser impreciso' },
    sync_timeout:           { en: 'Sync timeout\nBoth players must wear Spectacles\nand face each other (<2m)', fr: 'Timeout de synchronisation\nLes deux joueurs doivent porter des Spectacles\net se faire face (<2m)', es: 'Tiempo de sincronización agotado\nAmbos jugadores deben llevar Spectacles\ny mirarse (<2m)' },
    anchor_found_short:     { en: '\nAnchor found!', fr: '\nAncre trouvée !', es: '\n¡Ancla encontrada!' },
    aligning_coords:        { en: '\nAligning coordinates...', fr: '\nAlignement des coordonnées...', es: '\nAlineando coordenadas...' },

    // Phase-specific keys removed — unified guidance used instead
    coloc_no_located_warn:  { en: 'Alignment incomplete\nPositions may not be accurate', fr: 'Alignement incomplet\nLes positions peuvent être imprécises', es: 'Alineación incompleta\nLas posiciones pueden ser imprecisas' },
    give_card_confirm:      { en: 'Give {card} to {player}?', fr: 'Donner {card} à {player} ?', es: '¿Dar {card} a {player}?' },
    requesting_card:        { en: 'Requesting {card} from {player}...', fr: 'Demande de {card} à {player}...', es: 'Solicitando {card} a {player}...' },
    card_no_longer:         { en: 'Card no longer in your collection!', fr: 'Carte plus dans votre collection !', es: '¡La carta ya no está en tu colección!' },
    card_given:             { en: 'Card given away!', fr: 'Carte donnée !', es: '¡Carta regalada!' },
    trade_cancelled_dc:     { en: 'Trade cancelled — player disconnected. Card restored.', fr: 'Échange annulé — joueur déconnecté. Carte restaurée.', es: 'Intercambio cancelado — jugador desconectado. Carta restaurada.' },
    connected_lens_unavail: { en: 'Connected Lens unavailable', fr: 'Connected Lens indisponible', es: 'Connected Lens no disponible' },
    session_error:          { en: 'Session error: {desc}', fr: 'Erreur de session : {desc}', es: 'Error de sesión: {desc}' },
    connection_failed:      { en: 'Connection failed\n{desc}', fr: 'Connexion échouée\n{desc}', es: 'Conexión fallida\n{desc}' },
    no_internet:            { en: 'No internet connection\nPlease check your WiFi', fr: 'Pas de connexion internet\nVérifiez votre WiFi', es: 'Sin conexión a internet\nRevisa tu WiFi' },
    session_lost:           { en: 'Session lost\nReturning to menu...', fr: 'Session perdue\nRetour au menu...', es: 'Sesión perdida\nVolviendo al menú...' },
    give_request_busy:      { en: 'Player is busy with another trade', fr: 'Le joueur est occupé avec un autre échange', es: 'El jugador está ocupado con otro intercambio' },
    disconnected:           { en: 'Disconnected from session', fr: 'Déconnecté de la session', es: 'Desconectado de la sesión' },
    player_joined:          { en: '{name} joined!', fr: '{name} a rejoint !', es: '¡{name} se unió!' },
    player_left:            { en: '{name} left', fr: '{name} est parti', es: '{name} se fue' },
    received_card:          { en: 'Received {name}!', fr: '{name} reçu !', es: '¡{name} recibido!' },
    request_declined:       { en: 'Request declined.', fr: 'Demande refusée.', es: 'Solicitud rechazada.' },
    trade_expired:          { en: 'Trade request expired.', fr: 'Demande d\'échange expirée.', es: 'Solicitud de intercambio expirada.' },

    // -----------------------------------------------------------------
    // Music Player
    // -----------------------------------------------------------------
    no_tracks:              { en: 'No tracks', fr: 'Aucun titre', es: 'Sin pistas' },
    track_n:                { en: 'Track {n}', fr: 'Piste {n}', es: 'Pista {n}' },

    // -----------------------------------------------------------------
    // GPT Prompts — Language instruction appended to system prompt
    // -----------------------------------------------------------------
    gpt_narrator_lang:      {
        en: '- Write in English',
        fr: '- Écris en français',
        es: '- Escribe en español',
    },
    gpt_narrator_prompt:    {
        en: 'Tell me the story of the {vehicle} ({type}), brand {brand}. Give me the TopGear/Clarkson version of this vehicle.',
        fr: 'Raconte-moi l\'histoire du {vehicle} ({type}), marque {brand}. Donne-moi la version TopGear/Clarkson de ce véhicule.',
        es: 'Cuéntame la historia del {vehicle} ({type}), marca {brand}. Dame la versión TopGear/Clarkson de este vehículo.',
    },
    tts_instruction:        {
        en: 'Speak in English with the passionate tone of an automotive commentator, like a Top Gear presenter. Enthusiastic, dramatic at times, with pauses for comedic effect. Channel your inner Jeremy Clarkson.',
        fr: 'Parle en français avec le ton passionné d\'un commentateur automobile, comme un présentateur de Top Gear. Enthousiaste, dramatique par moments, avec des pauses pour l\'effet comique. Canalise ton Jeremy Clarkson intérieur.',
        es: 'Habla en español con el tono apasionado de un comentarista de automoción, como un presentador de Top Gear. Entusiasta, dramático a veces, con pausas para efecto cómico. Canaliza tu Jeremy Clarkson interior.',
    },
};

// =====================================================================
// IDLE PHRASES — 20 per language
// =====================================================================

const IDLE_PHRASES_TABLE: { en: string[]; fr: string[]; es: string[] } = {
    en: [
        'Find cars, collect them all...',
        'Point at a car and press Scan!',
        'Some say this scanner is faster than a Stig lap...',
        'Looking for something with four wheels?',
        'Every car has a story. What\'s yours?',
        'Spotted a beauty? Scan it!',
        'How hard can it be? Press the button!',
        'Speed. Power. Scan button.',
        'Cars don\'t scan themselves... yet.',
        'Your collection awaits its next card.',
        'Is that a Lambo? Only one way to find out...',
        'Ambition. Speed. A phone camera. Let\'s go.',
        'On tonight\'s show... you scan a car!',
        'In the world... the best scanner...',
        'POWEEEEER! And also... scan.',
        'Ready to add some horsepower to your collection?',
        'That car looks lonely. Give it a card.',
        'Even a Reliant Robin deserves a card.',
        'Clarkson would approve. Scan that thing.',
        'This is not a drill. It\'s a scanner.',
    ],
    fr: [
        'Trouvez des voitures, collectionnez-les toutes...',
        'Pointez une voiture et appuyez sur Scanner !',
        'Certains disent que ce scanner est plus rapide qu\'un tour du Stig...',
        'Vous cherchez quelque chose à quatre roues ?',
        'Chaque voiture a une histoire. Quelle est la vôtre ?',
        'Vous avez repéré une beauté ? Scannez-la !',
        'C\'est pas si compliqué ! Appuyez sur le bouton !',
        'Vitesse. Puissance. Bouton Scanner.',
        'Les voitures ne se scannent pas toutes seules... pas encore.',
        'Votre collection attend sa prochaine carte.',
        'C\'est une Lambo ? Un seul moyen de le savoir...',
        'Ambition. Vitesse. Un appareil photo. C\'est parti.',
        'Ce soir dans l\'émission... vous scannez une voiture !',
        'Dans le monde... le meilleur scanner...',
        'PUISSAAANCE ! Et aussi... scanner.',
        'Prêt à ajouter des chevaux à votre collection ?',
        'Cette voiture a l\'air seule. Offrez-lui une carte.',
        'Même une Reliant Robin mérite sa carte.',
        'Clarkson approuverait. Scannez ce truc.',
        'Ceci n\'est pas un exercice. C\'est un scanner.',
    ],
    es: [
        'Encuentra coches, colecciónalos todos...',
        '¡Apunta a un coche y pulsa Escanear!',
        'Dicen que este escáner es más rápido que una vuelta del Stig...',
        '¿Buscas algo con cuatro ruedas?',
        'Cada coche tiene una historia. ¿Cuál es la tuya?',
        '¿Has visto una belleza? ¡Escanéala!',
        '¿Qué tan difícil puede ser? ¡Pulsa el botón!',
        'Velocidad. Potencia. Botón de escaneo.',
        'Los coches no se escanean solos... todavía.',
        'Tu colección espera su próxima carta.',
        '¿Es un Lambo? Solo hay una forma de saberlo...',
        'Ambición. Velocidad. Una cámara. ¡Vamos!',
        'En el programa de esta noche... ¡escaneas un coche!',
        'En el mundo... el mejor escáner...',
        '¡POTENCIAAAA! Y también... escanear.',
        '¿Listo para añadir caballos a tu colección?',
        'Ese coche parece solo. Dale una carta.',
        'Hasta un Reliant Robin merece una carta.',
        'Clarkson lo aprobaría. Escanea eso.',
        'Esto no es un simulacro. Es un escáner.',
    ],
};

// =====================================================================
// CHEAT MESSAGES — 15 per language
// =====================================================================

const CHEAT_MESSAGES_TABLE: { en: string[]; fr: string[]; es: string[] } = {
    en: [
        "That's not a real car, mate.\nGo outside and find one!\nYour legs work, presumably.",
        "Nice try, but I wasn't\nborn yesterday.\nScan a REAL car.",
        "A screen? Really?\nThat's like putting a photo\nof food on your plate.",
        "I've seen better cheating\nfrom a sat-nav.\nYour Trust score just dropped.",
        "Hammond would be\ndisappointed in you.\nActually no, he'd do the same.",
        "If you keep this up,\nyour reputation will be\nworse than a Reliant Robin.",
        "That's a photograph, you\ndonkey! Go find something\nwith actual wheels!",
        "Your Trust score is falling\nfaster than a caravan\noff a cliff. Stop cheating.",
        "Honestly, how hard is it\nto find a real car?\nThey're EVERYWHERE.",
        "Right. At this rate your\nTrust rank will read\n'Car Thief'. Just saying.",
        "This is a scanning game,\nnot a screenshot game.\nGet out there!",
        "Oh no. Anyway...\nYour Trust score just\ntook another hit.",
        "Some say you tried to cheat.\nAll we know is,\nyou've lost more Trust.",
        "Cheating in a car game?\nThat's like putting\na wig on a pig.",
        "On that bombshell...\nyour Trust score drops\nAGAIN. Scan real cars!",
    ],
    fr: [
        "C'est pas une vraie voiture, mon ami.\nSors dehors et trouve-en une !\nTes jambes fonctionnent, non ?",
        "Bien essayé, mais je ne suis pas\nné de la dernière pluie.\nScanne une VRAIE voiture.",
        "Un écran ? Sérieusement ?\nC'est comme mettre une photo\nde nourriture dans ton assiette.",
        "J'ai vu de meilleurs tricheurs\nqu'un GPS recalculant.\nTon score de Confiance vient de chuter.",
        "Hammond serait\ndéçu de toi.\nEn fait non, il ferait pareil.",
        "Si tu continues comme ça,\nta réputation sera pire\nqu'une Reliant Robin.",
        "C'est une photo, espèce\nd'âne ! Va trouver quelque\nchose avec de vraies roues !",
        "Ton score de Confiance chute\nplus vite qu'une caravane\nd'une falaise. Arrête de tricher.",
        "Franchement, c'est si dur\nde trouver une vraie voiture ?\nIl y en a PARTOUT.",
        "Bon. À ce rythme ton\nrang de Confiance affichera\n'Voleur de Voitures'. Je dis ça...",
        "C'est un jeu de scan,\npas un jeu de captures d'écran.\nSors de chez toi !",
        "Oh non. Bref...\nTon score de Confiance vient\nde prendre un autre coup.",
        "Certains disent que tu as triché.\nTout ce qu'on sait, c'est que\ntu as perdu plus de Confiance.",
        "Tricher dans un jeu de voitures ?\nC'est comme mettre\nune perruque à un cochon.",
        "Sur ce coup de théâtre...\nton score de Confiance baisse\nENCORE. Scanne de vraies voitures !",
    ],
    es: [
        "Eso no es un coche real, amigo.\n¡Sal afuera y encuentra uno!\nTus piernas funcionan, ¿no?",
        "Buen intento, pero no nací\nayer.\nEscanea un coche REAL.",
        "¿Una pantalla? ¿En serio?\nEso es como poner una foto\nde comida en tu plato.",
        "He visto mejores trampas\nde un GPS.\nTu puntuación de Confianza acaba de caer.",
        "Hammond estaría\ndecepcionado contigo.\nBueno, en realidad él haría lo mismo.",
        "Si sigues así,\ntu reputación será peor\nque un Reliant Robin.",
        "¡Eso es una foto, pedazo\nde burro! ¡Encuentra algo\ncon ruedas de verdad!",
        "Tu Confianza cae\nmás rápido que una caravana\npor un precipicio. Deja de hacer trampa.",
        "En serio, ¿tan difícil es\nencontrar un coche real?\n¡Están POR TODAS PARTES!",
        "Vale. A este ritmo tu\nrango de Confianza dirá\n'Ladrón de Coches'. Solo digo.",
        "Esto es un juego de escaneo,\nno de capturas de pantalla.\n¡Sal ahí fuera!",
        "Oh no. En fin...\nTu Confianza acaba\nde recibir otro golpe.",
        "Dicen que intentaste hacer trampa.\nLo único que sabemos es que\nperdiste más Confianza.",
        "¿Hacer trampa en un juego de coches?\nEso es como ponerle\nuna peluca a un cerdo.",
        "Con esta bomba...\ntu Confianza baja\nOTRA VEZ. ¡Escanea coches reales!",
    ],
};

// =====================================================================
// COLOCATION GUIDANCE ARRAYS
// =====================================================================

const COLOCATION_GUIDANCE_TABLE: { en: string[]; fr: string[]; es: string[] } = {
    en: [
        'Look around slowly\nScan the room to build a shared 3D map',
        'Face your friend, within 2 meters\nBoth Spectacles need to see each other',
        'Keep scanning...\nLook at walls, floor, ceiling, and objects',
        'Stay close to your friend\nFace-to-face helps alignment',
        'Good lighting helps!\nAvoid dark or featureless areas',
        'Aligning spaces...\nKeep looking around and stay within 2m',
        'Both players: look around slowly\nThe room is being mapped for shared AR',
        'Tip: stay within 2m of each other\nThe closer you are, the faster it syncs',
    ],
    fr: [
        'Regardez lentement autour de vous\nScannez la pièce pour créer une carte 3D partagée',
        'Faites face à votre ami, à moins de 2 mètres\nLes deux Spectacles doivent se voir',
        'Continuez à scanner...\nRegardez murs, sol, plafond et objets',
        'Restez proche de votre ami\nFace à face aide l\'alignement',
        'Un bon éclairage aide !\nÉvitez les zones sombres ou uniformes',
        'Alignement en cours...\nContinuez à regarder autour, restez à 2m',
        'Les deux joueurs : regardez autour lentement\nLa pièce est cartographiée pour l\'AR partagé',
        'Astuce : restez à moins de 2m l\'un de l\'autre\nPlus vous êtes proches, plus c\'est rapide',
    ],
    es: [
        'Mira lentamente a tu alrededor\nEscanea la sala para crear un mapa 3D compartido',
        'Mira a tu amigo, a menos de 2 metros\nAmbas Spectacles deben verse',
        'Sigue escaneando...\nMira paredes, suelo, techo y objetos',
        'Quédate cerca de tu amigo\nCara a cara ayuda a la alineación',
        '¡Buena iluminación ayuda!\nEvita zonas oscuras o sin rasgos',
        'Alineando espacios...\nSigue mirando alrededor, quédate a 2m',
        'Ambos jugadores: miren lentamente\nLa sala se mapea para AR compartido',
        'Consejo: quédense a menos de 2m\nMás cerca = sincronización más rápida',
    ],
};

// =====================================================================
// PUBLIC API
// =====================================================================

export function t(key: string): string {
    const entry = S[key];
    if (!entry) return key;
    return entry[currentLang] || entry['en'] || key;
}

export function tf(key: string, params: { [k: string]: string | number }): string {
    let text = t(key);
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const parts = text.split('{' + k + '}');
        text = parts.join(String(params[k]));
    }
    return text;
}

export function getIdlePhrases(): string[] {
    return IDLE_PHRASES_TABLE[currentLang] || IDLE_PHRASES_TABLE['en'];
}

export function getCheatMessages(): string[] {
    return CHEAT_MESSAGES_TABLE[currentLang] || CHEAT_MESSAGES_TABLE['en'];
}

export function getColocationGuidanceMessages(): string[] {
    return COLOCATION_GUIDANCE_TABLE[currentLang] || COLOCATION_GUIDANCE_TABLE['en'];
}
