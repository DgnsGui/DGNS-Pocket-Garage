// @input SceneObject noInternetUI

// On s'assure que l'alerte est visible par défaut au cas où le script plante
if (script.noInternetUI) {
    script.noInternetUI.enabled = true;
}

script.createEvent("UpdateEvent").bind(function() {
    if (!script.noInternetUI) return;

    var status = -1;

    try {
        if (global.deviceInfoSystem && typeof global.deviceInfoSystem.getConnectivityStatus === "function") {
            status = global.deviceInfoSystem.getConnectivityStatus();
        }
    } catch (e) {
        // En cas d'erreur, on laisse l'alerte affichée par sécurité
        return;
    }

    // DEBUG : Décommente la ligne suivante pour voir le chiffre exact dans le Logger
    // print("Debug Statut : " + status);

    // LOGIQUE INVERSÉE :
    // Si le statut est 1 (Wifi) ou 2 (Mobile), on est sûr d'avoir internet -> On cache
    if (status === 1 || status === 2) {
        if (script.noInternetUI.enabled === true) {
            print("Internet OK (Statut " + status + ") -> Masquage alerte");
            script.noInternetUI.enabled = false;
        }
    } 
    // Sinon (si c'est 0, 3, -1 ou n'importe quoi d'autre), on affiche l'alerte
    else {
        if (script.noInternetUI.enabled === false) {
            print("Pas d'Internet (Statut " + status + ") -> Affichage alerte");
            script.noInternetUI.enabled = true;
        }
    }
});