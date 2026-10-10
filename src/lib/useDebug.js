// ═══════════════════════════════════════════════════════════════════════════
// useDebug — mode "debug" de l'interface (case à cocher dédiée, cf. HexMap.vue)
// ═══════════════════════════════════════════════════════════════════════════
//
// Ce composable est le SEUL endroit où doit vivre la logique des affichages
// de debug de l'appli — au même titre que lib/useAssisted.js centralise toute
// la logique du mode "Assisté". Chaque nouvel affichage de debug (il y en
// aura d'autres à l'avenir) doit être ajouté ICI, sous la forme d'un
// `computed` de plus dans l'objet retourné, gardé par `debug.value` — jamais
// codé en dur directement dans HexMap.vue.
//
// Contrairement au mode Assisté/Libre (qui change les RÈGLES du jeu), le mode
// debug ne change QUE ce qui est affiché EN PLUS à l'écran, à titre
// d'information pour développer/tester l'appli — jamais le comportement du
// jeu lui-même (aucune des fonctions ci-dessous ne modifie quoi que ce soit,
// elles ne font QUE dériver de l'affichage à partir de l'état existant). En
// particulier, `isInRange` ci-dessous ÉLARGIT l'affichage du surlignage vert
// (portée complète au lieu du seul premier pas), mais ne rend cliquable AUCUN
// hex de plus : le clic reste géré par HexMap.vue::onHex, inchangé, qui ne
// permet toujours de se déplacer QUE vers un hex adjacent à la fois.
//
// Affichages de debug :
//   1. le COÛT DE TERRAIN (COT) de chaque hex adjacent au pion actuellement
//      sélectionné (cf. `adjacentCotLabels`) — utile pour vérifier au coup
//      par coup que la règle de MP de lib/useAssisted.js
//      (`canEnterHex`/`terrainCost`) applique le bon coût.
//   2. la PORTÉE DE DÉPLACEMENT complète du pion sélectionné (cf.
//      `isInRange`) : tous les hex qu'il peut atteindre avec les MP qu'il
//      lui reste, pas seulement ceux immédiatement adjacents (cf.
//      HexMap.vue::reachableSet/isReachable, qui ne couvre que le premier
//      pas et reste actif hors mode debug). Calculée par un plus court
//      chemin (Dijkstra, cf. `reachableHexes` plus bas) où le "poids" pour
//      entrer dans un hex est son COT — exactement la même notion de coût
//      que `canEnterHex`/`spendMp`, juste étendue à plusieurs pas d'un coup.
//      Les hex interdits à ce pion (cf. `canEnterTerrain`, ex. rough/broken/
//      woods pour un véhicule) sont exclus du graphe exploré, pas juste
//      comptés "chers" — un chemin ne peut jamais les traverser.
//   3. le SURCOÛT DE CONGESTION déjà accumulé sur les hex d'entrée de renfort
//      actuellement surlignés (cf. `entrySurchargeLabels`) — cf.
//      lib/useAssisted.js::entrySurcharge : un 2e renfort qui entre par le
//      même hex le même tour paie 2× son coût de base, un 3e 3×, etc. ; ce
//      surcoût ("+0.5", "+1"...) est ce que la PROCHAINE entrée sur cet hex
//      devra payer en plus du coût de base.
//   4. les TRACES des pions à hex-objectif (cf. `autoMoveTrailLines`, et
//      HexMap.vue::runAutoMoves) : une ligne par pion reliant le centre des
//      hex qu'il a parcourus depuis le début de la partie, un petit rond à
//      chaque début/fin de tour, et une croix sur son hex-objectif.
//
// Paramètres reçus (tous déjà calculés/définis côté HexMap.vue — ce
// composable ne fait QUE les recombiner, il ne récupère ni ne recalcule rien
// par lui-même en dehors de la portée de déplacement ci-dessus) :
//   - `hexes` : ref/computed de TOUS les hex de la grille, sous la forme
//     `{ id, c, r, cx, cy, pts }` (cf. HexMap.vue::hexes) — `cx`/`cy` sont
//     déjà les coordonnées PIXEL du centre de l'hex, prêtes à afficher un
//     texte dessus sans recalcul.
//   - `isAdjacent` : fonction `(h) => bool` (cf. HexMap.vue::isAdjacent) qui
//     répond "cet hex est-il adjacent au pion actuellement sélectionné ?" —
//     déjà `false` partout si aucun pion n'est sélectionné.
//   - `terrainCost` : fonction `(h) => nombre de MP` (cf.
//     lib/useAssisted.js::terrainCost, exportée pour être réutilisée ici SANS
//     dupliquer la logique de lecture de `module.terrain`).
//   - `selectedCounter` : ref/computed du pion actuellement sélectionné (objet
//     complet, avec `col`/`row`/`mov`), ou `null` (cf. HexMap.vue::selectedCounter).
//   - `remainingMp` : fonction `(pion) => nombre de MP restants, ou `null` si
//     ce pion n'a pas de MP déclarés (cf. lib/useAssisted.js::remainingMp).
//   - `canEnterTerrain` : fonction `(pion, hex, from) => bool` (cf.
//     lib/useAssisted.js::canEnterTerrain) — un hex rough/broken/woods
//     ("forest"), ou un ruisseau sans route/piste, est infranchissable pour
//     certains types de pion (véhicules) quel que soit leur MP ; le calcul
//     de portée doit l'exclure du graphe exploré, pas seulement le compter
//     "trop cher".
//   - `zocSet` : ref/computed du Set ("col,row") des hex sous ZOC ennemie du
//     pion sélectionné (cf. HexMap.vue::zocSet, lib/useAssisted.js::
//     enemyZocSet) — un pion qui ENTRE dans un tel hex doit s'y arrêter : le
//     calcul de portée l'inclut (atteignable) mais n'explore JAMAIS plus
//     loin depuis lui.
//   - `neighborsOf`, `hexOnMap` : fonctions de géométrie de grille (cf.
//     lib/hex.js et HexMap.vue::hexOnMap) — nécessaires pour explorer la
//     grille hex par hex lors du calcul de la portée de déplacement.
//   - `entryHexSet` : ref/computed du Set ("col,row") des hex d'entrée
//     actuellement valides pour le renfort sélectionné (cf.
//     HexMap.vue::entryHexSet) — sert à savoir SUR QUELS hex afficher le
//     surcoût de congestion (cf. `entrySurchargeLabels` plus bas), pas sur
//     toute la carte.
//   - `entrySurcharge` : fonction `(hex) => nombre de MP` (cf.
//     lib/useAssisted.js::entrySurcharge) — le surcoût de congestion déjà
//     accumulé sur un hex d'entrée ce tour-ci (0 si personne n'y est encore
//     entré).
//   - `wouldOverstack` : fonction `(pion, hex) => bool` (cf.
//     lib/useAssisted.js::wouldOverstack) — même règle d'empilement que
//     HexMap.vue::reachableSet (1er pas) appliquée ici à CHAQUE hex du
//     résultat de `reachableHexes` : un hex ami occupé n'est un point
//     d'ARRÊT valide (donc inclus dans la portée affichée) que si le pion
//     pourrait ensuite en repartir — le TRAVERSER pour aller plus loin reste
//     toujours permis, cf. `reachableHexes` pour le détail.
//   - `autoMoveTrails` : ref de la Map id -> segments `{ step, points }` (cf.
//     HexMap.vue::noteAutoMoveTrail), `autoMovers` : ref/computed des pions
//     à hex-objectif sur la carte, `{ id, target: { col, row } }`.
import { computed, ref } from 'vue'

/** Tous les hex atteignables par `unit` depuis `{ col, row }` avec au plus
 *  `budget` MP à dépenser, chaque hex traversé coûtant `terrainCost(hex,
 *  from)` — plus court chemin (Dijkstra), PAS un simple calcul "distance ×
 *  coût moyen", car le coût pour entrer dans un hex peut varier selon d'où
 *  l'on vient (cf. lib/useAssisted.js::terrainCost, route/piste : moins cher
 *  en suivant une route précise qu'en coupant à travers champs). Un hex où
 *  `canEnterTerrain(unit, hex, from)` répond faux (cf. lib/useAssisted.js —
 *  rough/broken/woods ou ruisseau sans route/piste, interdits à certains
 *  véhicules) est retiré du graphe exploré AVANT même de regarder son coût :
 *  infranchissable, pas juste "cher".
 *
 *  ZOC (`zocSet`, cf. lib/useAssisted.js::enemyZocSet) : un hex sous ZOC
 *  ennemie reste ATTEIGNABLE (on peut y entrer) mais on n'explore JAMAIS ses
 *  propres voisins depuis lui — un pion qui y entre doit s'y arrêter, cf.
 *  useAssisted.js::canEnterHex pour la même règle appliquée au clic. Si le
 *  hex de DÉPART (`{ col, row }`) est lui-même sous ZOC ennemie, ce même
 *  mécanisme s'applique dès la 1re itération : rien n'est exploré depuis
 *  lui, donc rien n'est trouvé -> portée vide, le pion est figé sur place.
 *
 *  La grille d'un module (~1000 hex pour Arnhem) est assez petite pour se
 *  passer d'un tas binaire : une simple recherche linéaire du nœud non
 *  visité le plus proche suffit très largement. Renvoie un Set de clés
 *  "col,row", SANS le hex de départ (`c` n'a pas besoin d'"entrer" dans son
 *  propre hex, quoi qu'il en soit du terrain qu'il occupe déjà). */
function reachableHexes(unit, { col, row }, budget, neighborsOf, hexOnMap, terrainCost, canEnterTerrain, zocSet, wouldOverstack, zocStop) {
  const startKey = col + ',' + row
  const dist = new Map([[startKey, 0]])
  const visited = new Set()
  for (;;) {
    let currentKey = null
    let currentDist = Infinity
    for (const [key, distance] of dist) {
      if (!visited.has(key) && distance < currentDist) { currentKey = key; currentDist = distance }
    }
    if (currentKey == null) break // plus aucun nœud à traiter : exploration terminée
    visited.add(currentKey)
    // ZOC : ce hex force l'arrêt du pion qui y entre (ou qui y a commencé)
    // — il reste dans le résultat (atteint), mais on n'explore RIEN depuis
    // lui, cf. useAssisted.js::canEnterHex pour la même règle au clic.
    // Règle du module (cf. `zocStop`) : au départ, seulement si le pion y est
    // figé ; ailleurs, seulement si entrer en ZOC ennemie force l'arrêt.
    if (zocSet.has(currentKey) && (currentKey === startKey ? zocStop.start : zocStop.entry)) continue
    const [hexCol, hexRow] = currentKey.split(',').map(Number)
    for (const neighbor of neighborsOf(hexCol, hexRow)) {
      if (!hexOnMap(neighbor.col, neighbor.row)) continue
      // `from: { c, r }` (le nœud qu'on est en train d'étendre) est ce qui
      // permet à `terrainCost`/`canEnterTerrain` de détecter une arête
      // route/piste PRÉCISE entre ce nœud et son voisin `n` — sans lui, on
      // perdrait à la fois la règle de coût réduit ET l'exception route/
      // piste au terrain interdit (cf. useAssisted.js::terrainCost/
      // canEnterTerrain : une route reste praticable même à travers un
      // terrain autrement infranchissable pour un véhicule).
      if (!canEnterTerrain(unit, { c: neighbor.col, r: neighbor.row }, { c: hexCol, r: hexRow })) continue // infranchissable pour ce type de pion
      const next = currentDist + terrainCost({ c: neighbor.col, r: neighbor.row }, { c: hexCol, r: hexRow })
      if (next > budget) continue // trop cher pour arriver jusque-là : hors de portée
      const key = neighbor.col + ',' + neighbor.row
      if (next < (dist.get(key) ?? Infinity)) dist.set(key, next)
    }
  }
  dist.delete(startKey)
  // Empilement (cf. lib/useAssisted.js::wouldOverstack/
  // canLeaveAfterEntering, même règle qu'au 1er pas — HexMap.vue::
  // reachableSet) : un hex occupé par un pion AMI n'est un point d'ARRÊT
  // valide que si le pion pourrait ensuite continuer sa route (MP restants,
  // À CE POINT DU CHEMIN — `budget - dist`, pas le total du pion — pour
  // rejoindre au moins un voisin libre). On ne l'exclut du RÉSULTAT que si
  // c'est un cul-de-sac : rien n'empêche de le TRAVERSER pour atteindre plus
  // loin (déjà géré ci-dessus, l'exploration continue au travers).
  for (const [key, distance] of dist) {
    const [hexCol, hexRow] = key.split(',').map(Number)
    if (!wouldOverstack(unit, { c: hexCol, r: hexRow })) continue
    const remaining = budget - distance
    const canDepart = remaining > 0 && !(zocStop.entry && zocSet.has(key)) && neighborsOf(hexCol, hexRow).some((neighbor) => {
      if (!hexOnMap(neighbor.col, neighbor.row)) return false
      const nh = { c: neighbor.col, r: neighbor.row }
      return canEnterTerrain(unit, nh, { c: hexCol, r: hexRow }) && remaining >= terrainCost(nh, { c: hexCol, r: hexRow })
    })
    if (!canDepart) dist.delete(key)
  }
  return new Set(dist.keys())
}

export function useDebug(
  hexes, isAdjacent, terrainCost, selectedCounter, remainingMp, neighborsOf, hexOnMap, canEnterTerrain, zocSet,
  entryHexSet, entrySurcharge, wouldOverstack, isZocFrozen = () => true, stopsOnZocEntry = true,
  autoMoveTrails = ref(new Map()), autoMovers = ref([]),
) {
  // Unique interrupteur du mode debug (case à cocher "debug", cf. HexMap.vue)
  // — tous les affichages de ce composable, présents et futurs, doivent être
  // gardés par lui (`if (!debug.value) return ...`), jamais actifs par défaut.
  const debug = ref(false)

  // Un objet `{ id, cx, cy, cot }` par hex adjacent au pion sélectionné —
  // liste vide si le mode debug est désactivé OU si aucun pion n'est
  // sélectionné (les deux se traduisent par "rien à afficher", cf. HexMap.vue
  // qui n'a donc besoin que d'un `v-for` dessus, sans autre condition). Le
  // COT affiché tient compte d'une éventuelle route/piste PRÉCISE entre la
  // position actuelle du pion (`from`) et chaque hex adjacent (cf.
  // lib/useAssisted.js::terrainCost) — pas juste le coût de zone brut.
  const adjacentCotLabels = computed(() => {
    if (!debug.value) return []
    const counter = selectedCounter.value
    if (!counter) return []
    const from = { c: counter.col, r: counter.row }
    return hexes.value
      .filter((hex) => isAdjacent(hex))
      .map((hex) => ({ id: hex.id, cx: hex.cx, cy: hex.cy, cot: terrainCost({ c: hex.c, r: hex.r }, from) }))
  })

  // Ensemble des hex ("col,row") que le pion sélectionné peut atteindre avec
  // ses MP restants, au-delà du seul premier pas adjacent — vide si le mode
  // debug est désactivé ou si aucun pion n'est sélectionné. Si le pion ne
  // déclare pas de MP (`remainingMp` renvoie `null`, cf. lib/useAssisted.js),
  // budget "illimité" : en cohérence avec `canEnterHex`, qui ne restreint
  // alors rien non plus.
  const inRangeSet = computed(() => {
    if (!debug.value) return new Set()
    const counter = selectedCounter.value
    if (!counter) return new Set()
    const budget = remainingMp(counter)
    return reachableHexes(
      counter, { col: counter.col, row: counter.row },
      budget == null ? Infinity : budget,
      neighborsOf, hexOnMap, terrainCost, canEnterTerrain, zocSet.value, wouldOverstack,
      // Arrêts imposés par la ZOC, selon la règle du module (cf.
      // lib/useAssisted.js::isZocFrozen, `rules.zoc`) : au départ si le pion
      // y est figé, en cours de route si entrer en ZOC force l'arrêt.
      { start: isZocFrozen(counter), entry: stopsOnZocEntry },
    )
  })
  const isInRange = (hex) => inRangeSet.value.has(hex.c + ',' + hex.r)

  // Un objet `{ id, cx, cy, surcharge }` par hex d'entrée actuellement
  // surligné (cf. HexMap.vue::entryHexSet) dont le surcoût de congestion
  // (cf. lib/useAssisted.js::entrySurcharge) est déjà > 0 — vide si le mode
  // debug est désactivé, si aucun renfort n'est sélectionné, ou si personne
  // n'est encore entré par aucun de ses hex d'entrée ce tour-ci (rien à
  // signaler dans ce cas : la 1re entrée ne coûte que le tarif de base).
  const entrySurchargeLabels = computed(() => {
    if (!debug.value) return []
    return hexes.value
      .filter((hex) => entryHexSet.value.has(hex.c + ',' + hex.r))
      .map((hex) => ({ id: hex.id, cx: hex.cx, cy: hex.cy, surcharge: entrySurcharge({ c: hex.c, r: hex.r }) }))
      .filter((label) => label.surcharge > 0)
  })

  // Une entrée `{ id, color, points, dots, objective }` par pion à
  // hex-objectif : `points` = "x,y x,y..." (centres des hex parcourus, tous
  // tours confondus), `dots` = centres des hex de début/fin de chaque tour,
  // `objective` = centre de son hex-objectif. Une couleur par pion.
  const autoMoveTrailLines = computed(() => {
    if (!debug.value) return []
    const centers = new Map(hexes.value.map((hex) => [hex.c + ',' + hex.r, { x: hex.cx, y: hex.cy }]))
    const centerOf = (point) => centers.get(point.col + ',' + point.row)
    const movers = autoMovers.value
    return movers.map((mover, index) => {
      const trail = autoMoveTrails.value.get(String(mover.id)) ?? []
      const path = trail.flatMap((segment, rank) => (rank === 0 ? segment.points : segment.points.slice(1)))
      const ends = new Map()
      for (const segment of trail) {
        for (const point of [segment.points[0], segment.points[segment.points.length - 1]]) ends.set(point.col + ',' + point.row, point)
      }
      return {
        id: mover.id,
        color: `hsl(${Math.round((index * 360) / Math.max(movers.length, 1))}, 85%, 45%)`,
        points: path.map(centerOf).filter(Boolean).map((center) => center.x + ',' + center.y).join(' '),
        dots: [...ends.values()].map(centerOf).filter(Boolean),
        objective: centerOf(mover.target) ?? null,
      }
    })
  })

  return { debug, adjacentCotLabels, isInRange, entrySurchargeLabels, autoMoveTrailLines }
}
