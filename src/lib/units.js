// ═══════════════════════════════════════════════════════════════════════════
// units — classification des pions : qu'est-ce qu'une "vraie unité" ?
// ═══════════════════════════════════════════════════════════════════════════
//
// Trois sortes de pions circulent dans le moteur (cf. public/modules/*.json
// et SupportTracker.vue) :
//   - les MARQUEURS (`type: "marker"`, ex. zones de largage "DZ") : posés sur
//     la carte pour l'information, ils n'occupent jamais un hex au sens du
//     jeu — n'importe combien de pions peuvent partager leur case, ils ne
//     bougent pas, ne combattent pas, ne projettent pas de ZOC ;
//   - les PIONS DE SOUTIEN (`kind: "support"`, cf. SupportTracker.vue) :
//     ressource commune sans camp, librement glissable ; comme les
//     marqueurs, ils n'occupent pas un hex et ne participent ni au
//     mouvement réglé ni au combat ;
//   - les UNITÉS COMBATTANTES : tout le reste — les seules à se déplacer
//     selon les règles, à s'empiler, à projeter une ZOC et à combattre.
//
// Ces trois tests vivent ICI, et nulle part ailleurs : avant ce fichier, la
// même question était posée sous trois formes différentes (HexMap.vue::
// isUnit, useCombat.js::isFighter, useRetreat.js::isFighter, plus des tests
// inline `type !== 'marker' && kind !== 'support'` dans useAssisted.js) —
// autant d'occasions de diverger le jour où une 4e sorte de pion apparaît.
// Tous acceptent `null`/`undefined` (réponse : faux), pour pouvoir être
// appelés sur le résultat d'un `find` sans garde.

/** Un marqueur (zone de largage...) — jamais une unité. */
export function isMarker(counter) {
  return counter?.type === 'marker'
}

/** Un pion de soutien (cf. SupportTracker.vue) — ressource commune, sans camp. */
export function isSupport(counter) {
  return counter?.kind === 'support'
}

/** Un vrai pion, par opposition à un marqueur : occupe une case, se déplace
 *  (ou se pose). Les pions de soutien sont typés marqueurs (cf.
 *  SupportTracker.vue) : ils n'en sont PAS. Sert au placement (répartition
 *  des pions de départ, empilement visuel) et au rendu (les marqueurs sont
 *  dessinés sous les unités, les pions de soutien par-dessus). */
export function isUnit(counter) {
  return !!counter && !isMarker(counter)
}

/** Une unité COMBATTANTE : ni marqueur, ni pion de soutien. La seule qui
 *  compte pour les règles — occupation d'un hex, empilement, ZOC, combat,
 *  retraite, entrée en jeu bloquée par un occupant. */
export function isFighter(counter) {
  return !!counter && !isMarker(counter) && !isSupport(counter)
}

/** Une ARTILLERIE : pion à valeurs de tir (`bar` — barrage, cf. README,
 *  table `counters`), ou dont le type la déclare comme telle ("arty",
 *  "airborne arty", "self-propelled arty"... à Arnhem). */
export function isArtillery(counter) {
  return isFighter(counter) && (counter.bar != null || /\barty\b|artill/i.test(counter.type ?? ''))
}
