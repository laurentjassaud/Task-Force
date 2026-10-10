// ═══════════════════════════════════════════════════════════════════════════
// edges — nature des HEXSIDES (arêtes entre deux hex), déclarée par le module
// ═══════════════════════════════════════════════════════════════════════════
//
// Une carte porte, en plus du terrain de chaque hex, des éléments posés SUR
// les côtés d'hex : routes, pistes, rivières, ponts, bacs, ruisseaux... Le
// module les liste en COUCHES (`terrain.roads`, `terrain.rivers`... — des
// paires "AAAA-BBBB" d'hex adjacents) et DÉCLARE ce que chaque couche veut
// dire dans `terrain.edges` ; le moteur (lib/useAssisted.js pour le
// mouvement et la ZOC, lib/useCombat.js pour le combat) n'interprète que
// cette déclaration :
//
//   "edges": {
//     "layers": { "roads": "road", "highwayBridges": "bridge", ... },
//     "kinds": {
//       "road":   { "mp": 0.5, "vehicles": true },
//       "ferry":  { "extraMp": 3, "vehicles": false },
//       "river":  { "impassable": true, "blocksZoc": true, "blocksAttack": true },
//       ...
//     },
//     "movementPriority": ["road", "trail", "bridge", "ferry", "river", "stream"],
//     "combatPriority": ["bridge", "river", "road", "trail", "stream"]
//   }
//
//   - `layers` : couche du JSON → NATURE d'arête (plusieurs couches peuvent
//     partager une nature : les trois sortes de pont d'Arnhem) ;
//   - `kinds` : propriétés de chaque nature, toutes facultatives —
//       • `mp` : coût FIXE pour entrer dans l'hex par cette arête (route,
//         piste), à la place du coût du terrain ; un hex touché par une telle
//         arête se paie aussi à ce coût à l'ENTRÉE EN JEU d'un renfort ;
//       • `extraMp` : surcoût AJOUTÉ au coût du terrain (gué, bac) ;
//       • `impassable` : arête infranchissable pour tout le monde ;
//       • `vehicles` : `false` = interdite aux véhicules (cf. `rules.
//         vehicleTypes`) ; `true` = ouvre aux véhicules un terrain qui leur
//         est autrement interdit (cf. `rules.impassableForVehicles`) ;
//       • `blocksZoc` : la zone de contrôle ne s'étend pas à travers ;
//       • `blocksAttack` : on ne peut pas attaquer à travers ;
//       • `severs` : natures que cet obstacle COUPE quand il n'est pas
//         enjambé (ruisseau d'Arnhem : `["road", "trail"]` — une route ou
//         une piste qui le traverse sans pont est sectionnée, l'arête ne vaut
//         plus que ruisseau : +3 MP sur le coût du terrain, pas de véhicule) ;
//       • `spans` : obstacles que cette nature ENJAMBE (pont d'Arnhem :
//         `["river", "stream"]`), qui ne coupent alors plus rien ;
//   - `movementPriority` : quand une arête porte PLUSIEURS natures (après
//     les coupures ci-dessus), celle qui fait foi pour le MOUVEMENT (coût,
//     franchissement) est la première de cette liste présente sur l'arête
//     (une route qui franchit un ruisseau SUR UN PONT : on suit la route) ;
//   - `combatPriority` : même principe pour tout ce qui "traverse" l'arête
//     sans s'y déplacer — COMBAT (attaque interdite, ligne de la table de
//     combat substituée, cf. `module.combat.edgeRows`) et ZOC. L'ordre peut
//     différer du mouvement (un pont d'Arnhem, souvent aussi route, doit
//     primer sur elle au combat).
//
// Sans `terrain.edges`, aucune arête n'a d'effet (les couches sont ignorées).
//
// ─── PONTS DÉMOLISSABLES ─────────────────────────────────────────────────────
// Un module peut déclarer que certaines couches de ponts peuvent SAUTER en
// cours de partie (`rules.bridgeDemolition`, cf. lib/rules.js et
// lib/useBridges.js, qui portent la règle). Ce fichier n'en retient que le
// versant "nature d'arête" :
//   - `demolishable(clé)` : cette arête porte-t-elle un pont démolissable ?
//   - `demolishableEdges` : la liste de ces arêtes (une entrée par arête, pas
//     deux), pour les marquer sur la carte ;
//   - `revealedKind(clé)` : la nature que l'arête prend une fois le pont
//     démoli — l'obstacle qu'il franchissait. C'est la première nature de
//     `reveals` que l'arête porte DÉJÀ (rivière avant ruisseau), ou
//     `fallback` si elle n'en porte aucune : à Arnhem, le canal n'existe pas
//     dans les données, seuls ses ponts y figurent, et un pont de canal
//     démoli doit quand même laisser un obstacle derrière lui.
// C'est l'APPELANT qui tient la liste des ponts effectivement démolis (cf.
// lib/useAssisted.js, paramètre `isDemolished`) : cet interprète-ci ne
// connaît que les natures, jamais l'état de la partie.

/** `module.terrain` → interprète des arêtes (cf. l'en-tête). `demolition` :
 *  `rules.bridgeDemolition` résolu (cf. lib/rules.js), ou `null`. */
export function resolveEdges(terrain, demolition = null) {
  const declaration = terrain?.edges ?? {}
  const kinds = declaration.kinds && typeof declaration.kinds === 'object' ? declaration.kinds : {}

  // Nature → ensemble des arêtes "AAAA-BBBB", stockées dans les DEUX sens (le
  // JSON ne liste chaque arête qu'une fois, dans un ordre arbitraire).
  const edgesByKind = new Map()
  for (const [layer, kind] of Object.entries(declaration.layers ?? {})) {
    if (!kinds[kind]) continue
    const set = edgesByKind.get(kind) ?? new Set()
    for (const edge of terrain?.[layer] ?? []) {
      const [hexA, hexB] = String(edge).split('-')
      set.add(hexA + '-' + hexB)
      set.add(hexB + '-' + hexA)
    }
    edgesByKind.set(kind, set)
  }

  const known = (list) => (Array.isArray(list) ? list : Object.keys(kinds)).filter((kind) => kinds[kind])
  const movementPriority = known(declaration.movementPriority)
  const combatPriority = known(declaration.combatPriority ?? declaration.movementPriority)
  const listOf = (value) => (Array.isArray(value) ? value : [])

  // Natures qui TIENNENT sur l'arête `edgeKey` (cf. l'en-tête, `severs` et
  // `spans`) : toutes celles qu'elle porte, moins celles qu'un obstacle non
  // enjambé coupe. Ex. Arnhem : piste + ruisseau sans pont -> seul le
  // ruisseau reste (la piste est sectionnée) ; route + pont + ruisseau -> le
  // pont enjambe le ruisseau, qui ne coupe donc plus rien : tout reste.
  function effectiveKinds(edgeKey) {
    const present = [...edgesByKind].filter(([, set]) => set.has(edgeKey)).map(([kind]) => kind)
    const spanned = new Set(present.flatMap((kind) => listOf(kinds[kind].spans)))
    const severed = new Set(present.filter((kind) => !spanned.has(kind)).flatMap((kind) => listOf(kinds[kind].severs)))
    return present.filter((kind) => !severed.has(kind))
  }
  const firstPresent = (priority, edgeKey) => {
    const present = effectiveKinds(edgeKey)
    return priority.find((kind) => present.includes(kind)) ?? null
  }

  // Hex ("CCRR") touchés par au moins une arête de chaque nature à coût fixe
  // (`mp`) — pour le coût d'ENTRÉE EN JEU, qui n'a pas d'arête de provenance.
  const touchedByKind = new Map()
  for (const kind of movementPriority) {
    if (kinds[kind].mp == null) continue
    touchedByKind.set(kind, new Set([...(edgesByKind.get(kind) ?? [])].map((edgeKey) => edgeKey.split('-')[0])))
  }

  // --- Ponts démolissables (cf. l'en-tête) ---------------------------------
  // Arêtes portant un pont qui peut sauter, dans les DEUX sens (comme
  // `edgesByKind`), et la même liste en un seul sens pour l'affichage.
  const demolishableSet = new Set()
  const demolishableEdges = []
  for (const layer of demolition?.layers ?? []) {
    for (const edge of terrain?.[layer] ?? []) {
      const [hexA, hexB] = String(edge).split('-')
      if (!hexA || !hexB || demolishableSet.has(hexA + '-' + hexB)) continue
      demolishableSet.add(hexA + '-' + hexB)
      demolishableSet.add(hexB + '-' + hexA)
      demolishableEdges.push({ key: hexA + '-' + hexB, layer, from: hexA, to: hexB })
    }
  }

  return {
    /** Propriétés d'une nature (cf. l'en-tête), `null` pour `null`/inconnue. */
    kindOf: (kind) => (kind ? kinds[kind] ?? null : null),
    /** TOUTES les natures qui tiennent sur l'arête `edgeKey` (cf.
     *  `effectiveKinds` : une route coupée par un ruisseau sans pont n'y
     *  figure plus), sans priorité — là où `movementKind`/`combatKind` n'en
     *  retiennent qu'une. Une règle peut avoir besoin de savoir qu'un pont
     *  franchit un ruisseau, ce que la priorité masque (cf.
     *  lib/useSupplyLine.js : la ligne s'arrête au ruisseau sans pont). */
    kindsOf: (edgeKey) => effectiveKinds(edgeKey),
    /** L'arête `edgeKey` porte-t-elle un pont DÉMOLISSABLE (cf. l'en-tête) ? */
    demolishable: (edgeKey) => demolishableSet.has(edgeKey),
    /** Les arêtes démolissables, une entrée par arête : `{ key, layer, from, to }`. */
    demolishableEdges,
    /** Nature de l'arête `edgeKey` une fois son pont DÉMOLI (cf. l'en-tête),
     *  ou `null` si le module n'en déclare aucune. */
    revealedKind: (edgeKey) => (demolition?.reveals ?? []).find((kind) => edgesByKind.get(kind)?.has(edgeKey))
      ?? demolition?.fallback ?? null,
    /** Nature qui fait foi pour le MOUVEMENT sur l'arête `edgeKey`, ou `null`. */
    movementKind: (edgeKey) => firstPresent(movementPriority, edgeKey),
    /** Nature qui fait foi pour le COMBAT et la ZOC sur l'arête `edgeKey`, ou `null`. */
    combatKind: (edgeKey) => firstPresent(combatPriority, edgeKey),
    /** Nature à coût fixe qui dessert l'hex `hexKey` ("CCRR") pour une entrée en jeu, ou `null`. */
    entryKind: (hexKey) => movementPriority.find((kind) => touchedByKind.get(kind)?.has(hexKey)) ?? null,
  }
}
