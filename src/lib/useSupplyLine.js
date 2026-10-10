// ═══════════════════════════════════════════════════════════════════════════
// useSupplyLine — LIGNES DE COMMUNICATION du mode "Assisté"
// ═══════════════════════════════════════════════════════════════════════════
//
// Une unité est reliée à ses arrières par une LIGNE DE COMMUNICATION : une
// suite continue d'hex qui part de son propre hex et rejoint une source. Le
// module déclare tout ce qui la définit (`rules.supplyLine`, cf.
// lib/rules.js::resolveSupplyLine) ; sans cette déclaration, ce fichier reste
// INERTE et ne trace jamais rien.
//
// ─── LA RÈGLE (Arnhem) ───────────────────────────────────────────────────────
// Elle ne concerne que les unités ALLIÉES, Polonais exceptés, et se calcule
// de deux façons selon l'unité :
//
//   - unité NON AÉROPORTÉE : elle trace une ligne continue jusqu'à 0105 ou
//     0106 (« Non-airborne units must trace a Line of Communication off the
//     southern map edge at hex 0105 or 0106 »). C'est l'HEX traversé qui
//     engage la ligne, pas l'hexside emprunté :
//       « Once the line is traced into a trail hex, all remaining hexes must
//         be connected by road or trail hexsides. Once traced into a road
//         hex, all remaining hexes must be connected by Road hexsides. »
//     Tant que la ligne n'est entrée dans aucun hex de piste ou de route,
//     elle passe où elle veut ; dès qu'elle ENTRE DANS UN HEX DE PISTE (un hex
//     qu'une piste dessert, cf. `stageOfHex`) — même par un côté sans piste —,
//     chaque pas suivant doit franchir un hexside de piste ou de route ; dès
//     qu'elle ENTRE DANS UN HEX DE ROUTE, chaque pas suivant doit franchir un
//     hexside de route. La contrainte ne se relâche jamais — d'où les
//     "étages" du parcours ci-dessous (cf. `stepStage`), qui ne peuvent que
//     monter à mesure qu'on s'éloigne de l'unité et se rapproche de l'arrière.
//
//     L'hex de l'unité EST le premier hex de la ligne : une unité postée dans
//     un hex de piste a donc déjà sa ligne "sur la piste" et ne peut plus
//     couper à travers champs, même au premier pas. Une unité postée dans un
//     hex de route ne trace, elle, que par la route — c'est la même règle.
//
//     En pratique, une ligne entièrement "hors piste" est rare : un cours
//     d'eau ne se franchit que par un pont (cf. plus bas), et les hex qui
//     bordent un pont sont presque toujours des hex de piste ou de route ;
//
//   - unité AÉROPORTÉE : elle trace une ligne continue jusqu'à la ZONE DE
//     LARGAGE DE SA DIVISION, en sept hex au plus. Ni piste ni route n'y
//     changent quoi que ce soit : ce sont les avions qui ravitaillent, la
//     seule question est la distance à la DZ.
//
// Dans les deux cas, la ligne :
//   - ne traverse jamais un hex occupé par une unité ENNEMIE ;
//   - ne traverse jamais un hex sous ZOC ennemie — SAUF si une unité amie s'y
//     trouve : elle y annule la ZOC (une unité amie "tient" son hex) ;
//   - ne franchit jamais un hexside de rivière, de canal ou de ruisseau
//     SANS PONT. Un bac ne compte pas (il transporte des hommes, pas du
//     ravitaillement), et un pont DÉMOLI non plus — l'arête ne porte alors
//     plus que l'obstacle qu'il franchissait (cf. lib/useAssisted.js::
//     edgeKinds). Une route qui passe à gué ne suffit pas davantage : c'est
//     bien un PONT qu'il faut, d'où la lecture de TOUTES les natures de
//     l'arête et non de la seule qui fait foi ailleurs (une route masquerait
//     le ruisseau qu'elle traverse).
//
// ─── CE QU'ON EN FAIT ────────────────────────────────────────────────────────
// Pour l'instant, RIEN au sens des règles : aucune unité n'est pénalisée
// d'être hors ligne. Le calcul ne sert qu'à MONTRER la ligne (cf.
// HexMap.vue, surlignage vert en mode debug). Le jour où le ravitaillement
// aura des effets, ils s'appuieront sur `pathFor` / `hasSupply` sans rien
// changer ici.
//
// Paramètres reçus :
//   - `assisted` : ref/computed booléen — hors mode Assisté, aucune règle.
//   - `supply` : `rules.supplyLine` résolu, ou `null`.
//   - `counters` : FONCTION `() => pions posés sur la carte`.
//   - `sideOf` : `(counter) => clé de camp | null` (cf. HexMap.vue::
//     sideOfCounter).
//   - `isFighter`, `isAirborneEntry` : cf. lib/units.js et lib/setup.js —
//     qui occupe un hex, et qui est arrivé par les airs.
//   - `enemyZocSet` : `(counter) => Set("col,row")` (cf. lib/useAssisted.js).
//   - `edgeKinds` : `({ c, r }, { c, r }) => [natures]` (cf.
//     lib/useAssisted.js::edgeKinds) — TOUTES les natures de l'hexside.
//   - `hexOnMap` : `(col, row) => bool`.
import { computed } from 'vue'
import { hexId, parseHexId } from './calibration.js'
import { hexDistance, neighborsOf } from './hex.js'

// Étage de départ d'une ligne terrestre : elle n'est encore entrée dans aucun
// hex de piste ni de route, et passe donc où elle veut. Les étages suivants
// sont ceux que le module déclare (`ground.stages`, cf. `stageOfEdge`) — pour
// Arnhem, la piste puis la route —, et un parcours ne peut que monter, jamais
// redescendre.
const STAGE_FREE = 0

const keyOf = (col, row) => `${col},${row}`

export function useSupplyLine({
  assisted, supply = null, counters = () => [], sideOf = () => null,
  isFighter = () => true, isAirborneEntry = () => false,
  enemyZocSet = () => new Set(), edgeKinds = () => [], hexOnMap = () => true,
}) {
  /** La règle s'applique-t-elle dans ce module ? */
  const active = computed(() => !!assisted.value && !!supply)

  /** L'unité `unit` a-t-elle une ligne de communication à tracer ? Il lui
   *  faut être une vraie unité du camp concerné, et d'une faction que le
   *  module n'a pas mise à part (les Polonais d'Arnhem, qui n'ont pas
   *  d'arrières à eux). */
  function concerns(unit) {
    if (!active.value || !isFighter(unit)) return false
    if (sideOf(unit) !== supply.side) return false
    return !(supply.excludeFactions ?? []).includes(unit.faction)
  }

  /** L'étage de l'hexside `kinds` : la meilleure voie qui le franchit. Les
   *  étages sont ceux du module, du moins contraignant au plus contraignant
   *  (`ground.stages` — pour Arnhem : piste, puis route) : on retient le plus
   *  élevé que l'arête porte. Une arête à la fois route et piste compte donc
   *  comme une route. Tout le reste (terrain nu, ruisseau, pont sans route)
   *  vaut STAGE_FREE. Un pas n'est permis que si l'étage de son hexside
   *  atteint celui de la ligne (cf. `stepStage`). */
  function stageOfEdge(kinds) {
    const stages = supply.ground?.stages ?? []
    for (let index = stages.length - 1; index >= 0; index -= 1) {
      if (kinds.includes(stages[index])) return index + 1
    }
    return STAGE_FREE
  }

  /** Tout ce qu'un parcours a besoin de savoir de la carte, préparé UNE fois
   *  pour toutes : la ZOC ennemie et l'occupation des hex ne dépendent que du
   *  CAMP, jamais de l'unité qui trace. Les relire pion par pion à chaque hex
   *  visité — ce que faisait la première version — revenait à parcourir la
   *  centaine de pions des dizaines de milliers de fois.
   *
   *  `edges` mémorise en plus le verdict de chaque hexside déjà examiné : un
   *  même hexside est regardé depuis ses deux hex, et souvent par plusieurs
   *  parcours. `hexStages` fait de même pour l'étage de chaque hex (cf.
   *  `stageOfHex`), relu à chaque pas. */
  function contextFor(side, sample) {
    const friendly = new Set()
    const enemy = new Set()
    for (const other of counters()) {
      if (!isFighter(other)) continue
      const key = keyOf(other.col, other.row)
      if (sideOf(other) === side) friendly.add(key)
      else enemy.add(key)
    }
    return { zoc: enemyZocSet(sample), friendly, enemy, edges: new Map(), hexStages: new Map() }
  }

  /** L'étage de l'HEX `hex` : celui de la meilleure voie qui le dessert (cf.
   *  `stageOfEdge`, sur ses six hexsides). Un hex qu'une piste traverse est
   *  un « trail hex », un hex qu'une route traverse un « road hex » — et
   *  c'est en y ENTRANT que la ligne monte d'étage (cf. `stepStage`). Vaut
   *  aussi pour le premier hex de la ligne, celui de l'unité. Mémorisé dans
   *  `context` quand il y en a un. */
  function stageOfHex(hex, context = null) {
    const key = keyOf(hex.col, hex.row)
    const known = context?.hexStages.get(key)
    if (known !== undefined) return known
    let best = STAGE_FREE
    for (const neighbor of neighborsOf(hex.col, hex.row)) {
      const stage = stageOfEdge(edgeKinds({ c: hex.col, r: hex.row }, { c: neighbor.col, r: neighbor.row }))
      if (stage > best) best = stage
    }
    context?.hexStages.set(key, best)
    return best
  }

  /** UN PAS de ligne terrestre, de `from` vers son voisin `to`, pour une
   *  ligne parvenue à l'étage `stage` : l'hexside franchi doit valoir au
   *  moins cet étage (route pour une ligne déjà entrée dans un hex de route,
   *  piste ou route pour une ligne entrée dans un hex de piste, n'importe
   *  lequel sinon). Renvoie l'étage de la ligne une fois ENTRÉE dans `to` —
   *  le plus haut de son étage et de celui de `to` (cf. `stageOfHex`) —, ou
   *  -1 si le pas est refusé. */
  function stepStage(context, stage, from, to) {
    const edge = stageOfEdge(edgeKinds({ c: from.col, r: from.row }, { c: to.col, r: to.row }))
    if (edge < stage) return -1
    return Math.max(stage, stageOfHex(to, context))
  }

  /** L'hexside `from` -> `to` (`{ col, row }`) laisse-t-il passer une ligne ?
   *  Non s'il porte un cours d'eau (`blockingKinds`) que ne franchit aucun
   *  pont (`bridgeKinds`) — cf. l'en-tête pour les bacs et les ponts démolis. */
  function edgeAllows(context, from, to) {
    const key = keyOf(from.col, from.row) + '>' + keyOf(to.col, to.row)
    const known = context.edges.get(key)
    if (known !== undefined) return known
    const kinds = edgeKinds({ c: from.col, r: from.row }, { c: to.col, r: to.row })
    const allowed = (supply.bridgeKinds ?? []).some((kind) => kinds.includes(kind))
      || !(supply.blockingKinds ?? []).some((kind) => kinds.includes(kind))
    context.edges.set(key, allowed)
    return allowed
  }

  /** L'hex `hex` peut-il porter la ligne ? Il doit être sur la carte, libre
   *  d'unité ennemie, et hors ZOC ennemie — à moins qu'une unité AMIE ne s'y
   *  trouve, auquel cas la ZOC y est annulée. */
  function hexAllows(context, hex) {
    if (!hexOnMap(hex.col, hex.row)) return false
    const key = keyOf(hex.col, hex.row)
    if (context.enemy.has(key)) return false
    return context.friendly.has(key) || !context.zoc.has(key)
  }

  /** Les hex SOURCES de `unit` : la zone de largage de sa division si elle
   *  est aéroportée (le marqueur qui porte son `division`, cf. arnhem.json),
   *  les hex déclarés par le module sinon. Liste vide quand il n'y en a
   *  aucune — une DZ retirée de la carte, par exemple. */
  function sourcesFor(unit) {
    if (isAirborneEntry(unit)) {
      // La DZ d'une division est le MARQUEUR posé sur la carte dont le `code`
      // est celui de la division de l'unité (cf. arnhem.json : "DZ 101" porte
      // le code "101", et chaque aéroporté porte sa `division`).
      if (unit.division == null) return []
      return counters()
        .filter((marker) => !isFighter(marker) && String(marker.code) === String(unit.division))
        .map((marker) => ({ col: marker.col, row: marker.row }))
    }
    return (supply.ground?.sources ?? []).map(parseHexId)
  }

  /** Portée maximale de la ligne, en nombre de pas : celle des aéroportés
   *  (7 à Arnhem), ou aucune limite pour les autres. */
  function rangeFor(unit) {
    return isAirborneEntry(unit) ? (supply.airborne?.range ?? Infinity) : Infinity
  }

  /** LA LIGNE DE COMMUNICATION de `unit` : la suite d'hex qui la relie à sa
   *  source, de son propre hex jusqu'à celle-ci, ou `null` si aucune ne peut
   *  être tracée.
   *
   *  Parcours en largeur sur des états `(hex, étage)` — deux dimensions, car
   *  un même hex peut être atteint libre (donc riche en possibilités) ou déjà
   *  tenu à la route (donc pauvre), et ces deux façons d'y être ne mènent pas
   *  aux mêmes suites. La largeur d'abord donne la ligne la PLUS COURTE, qui
   *  est aussi la plus lisible sur la carte.
   *
   *  @returns `{ hexes: [{ col, row }], source }` ou `null`. */
  function pathFor(unit) {
    if (!concerns(unit)) return null
    const sources = sourcesFor(unit)
    if (!sources.length) return null
    const goal = new Set(sources.map((source) => keyOf(source.col, source.row)))
    const start = { col: unit.col, row: unit.row }
    const context = contextFor(sideOf(unit), unit)
    const limit = rangeFor(unit)
    // Les étages (piste, puis route) ne valent QUE pour les lignes
    // terrestres : c'est un avion qui ravitaille un aéroporté, et la route
    // qu'il survole ne l'engage à rien.
    const staged = !isAirborneEntry(unit)
    // L'hex de l'unité elle-même ne se discute pas : elle y est.
    if (goal.has(keyOf(start.col, start.row))) return { hexes: [start], source: start }

    // …mais il compte comme premier hex de la ligne : posée dans un hex de
    // piste, l'unité y est déjà tenue (cf. `stageOfHex`).
    const first = staged ? stageOfHex(start, context) : STAGE_FREE
    const seen = new Set([keyOf(start.col, start.row) + '@' + first])
    let frontier = [{ hex: start, stage: first, path: [start] }]
    for (let step = 0; step < limit && frontier.length; step += 1) {
      const next = []
      for (const state of frontier) {
        for (const neighbor of neighborsOf(state.hex.col, state.hex.row)) {
          if (!edgeAllows(context, state.hex, neighbor)) continue
          if (!hexAllows(context, neighbor)) continue
          // L'étage ne peut que monter : une ligne entrée dans un hex de
          // route n'en repart plus que par la route (cf. l'en-tête).
          const stage = staged ? stepStage(context, state.stage, state.hex, neighbor) : STAGE_FREE
          if (stage < 0) continue
          const path = [...state.path, neighbor]
          if (goal.has(keyOf(neighbor.col, neighbor.row))) return { hexes: path, source: neighbor }
          const mark = keyOf(neighbor.col, neighbor.row) + '@' + stage
          if (seen.has(mark)) continue
          seen.add(mark)
          next.push({ hex: neighbor, stage, path })
        }
      }
      frontier = next
    }
    return null
  }

  /** LE TRACÉ DE DEBUG de `unit` (cf. HexMap.vue, mode debug, phase de Fin
   *  de tour) : la même recherche que `pathFor`, mais qui garde l'ÉTAGE de
   *  chaque pas et qui, faute de ligne complète, rend quand même la MEILLEURE
   *  ligne partielle et l'endroit où elle casse — c'est ce qu'il faut voir
   *  pour vérifier la règle sur la carte.
   *
   *  - ligne complète : `{ connected: true, steps }` ;
   *  - ligne coupée : `{ connected: false, steps, rupture }`, où `steps` va
   *    jusqu'à l'hex atteint le plus PROCHE d'une source (à distance égale, le
   *    chemin le plus court), et `rupture` dit ce qui empêche le pas suivant
   *    vers cette source : `{ hex, onEdge, reason }` — `hex` est le voisin
   *    refusé, `onEdge` vrai si c'est l'HEXSIDE qui bloque (la croix se pose
   *    alors sur le côté d'hex, pas au centre), `reason` l'une de 'edge'
   *    (cours d'eau sans pont), 'enemy', 'zoc', 'stage' (la ligne devrait
   *    redescendre d'étage, ex. quitter la route à travers champs), 'range'
   *    (portée des aéroportés épuisée), 'offMap', 'noSource' (aucune source
   *    sur la carte) ou 'detour' (pas suivant libre, mais qui ne mène nulle
   *    part au-delà).
   *
   *  Chaque pas : `{ col, row, stage }` — `stage` est l'étage de la ligne une
   *  fois ENTRÉE dans cet hex (0 libre, puis l'index+1 de `ground.stages` :
   *  1 piste, 2 route pour Arnhem — cf. `stepStage`), qui impose ce que
   *  devra valoir l'hexside du pas SUIVANT ; pour le premier hex, celui de
   *  l'hex de l'unité (cf. `stageOfHex`). Toujours 0 pour un aéroporté
   *  (`staged` faux). `null` si l'unité n'est pas concernée. */
  function traceFor(unit) {
    if (!concerns(unit)) return null
    const staged = !isAirborneEntry(unit)
    const start = { col: unit.col, row: unit.row }
    const context = contextFor(sideOf(unit), unit)
    const first = staged ? stageOfHex(start, context) : STAGE_FREE
    const origin = [{ ...start, stage: first }]
    const sources = sourcesFor(unit)
    if (!sources.length) return { connected: false, staged, steps: origin, rupture: { hex: start, onEdge: false, reason: 'noSource' } }
    const goal = new Set(sources.map((source) => keyOf(source.col, source.row)))
    if (goal.has(keyOf(start.col, start.row))) return { connected: true, staged, steps: origin }
    const limit = rangeFor(unit)
    const toSource = (hex) => Math.min(...sources.map((source) => hexDistance(hex, source)))

    // Même parcours en largeur que `pathFor`, en retenant au passage l'état le
    // plus proche d'une source (le premier trouvé à distance égale est le plus
    // court, la largeur d'abord le garantit).
    const seen = new Set([keyOf(start.col, start.row) + '@' + first])
    let frontier = [{ hex: start, stage: first, steps: origin }]
    let closest = frontier[0]
    let closestDistance = toSource(start)
    for (let step = 0; step < limit && frontier.length; step += 1) {
      const next = []
      for (const state of frontier) {
        for (const neighbor of neighborsOf(state.hex.col, state.hex.row)) {
          if (!edgeAllows(context, state.hex, neighbor)) continue
          if (!hexAllows(context, neighbor)) continue
          const stage = staged ? stepStage(context, state.stage, state.hex, neighbor) : STAGE_FREE
          if (stage < 0) continue
          const steps = [...state.steps, { ...neighbor, stage }]
          if (goal.has(keyOf(neighbor.col, neighbor.row))) return { connected: true, staged, steps }
          const mark = keyOf(neighbor.col, neighbor.row) + '@' + stage
          if (seen.has(mark)) continue
          seen.add(mark)
          const reached = { hex: neighbor, stage, steps }
          const distance = toSource(neighbor)
          if (distance < closestDistance) { closest = reached; closestDistance = distance }
          next.push(reached)
        }
      }
      frontier = next
    }
    return { connected: false, staged, steps: closest.steps, rupture: ruptureAfter(closest, { context, staged, limit, toSource }) }
  }

  /** Ce qui bloque la ligne partielle `state` au pas suivant (cf.
   *  `traceFor`) : on examine ses voisins du plus proche au plus éloigné d'une
   *  source, et l'on rend la raison du refus du PREMIER — c'est le pas que la
   *  ligne aurait voulu faire. */
  function ruptureAfter(state, { context, staged, limit, toSource }) {
    const from = state.hex
    const candidates = neighborsOf(from.col, from.row)
      .map((hex) => ({ hex, distance: hexOnMap(hex.col, hex.row) ? toSource(hex) : Infinity }))
      .sort((a, b) => a.distance - b.distance)
    const towards = candidates[0].hex
    if (state.steps.length - 1 >= limit) return { hex: towards, onEdge: false, reason: 'range' }
    if (!hexOnMap(towards.col, towards.row)) return { hex: towards, onEdge: false, reason: 'offMap' }
    if (!edgeAllows(context, from, towards)) return { hex: towards, onEdge: true, reason: 'edge' }
    const key = keyOf(towards.col, towards.row)
    if (context.enemy.has(key)) return { hex: towards, onEdge: false, reason: 'enemy' }
    if (!context.friendly.has(key) && context.zoc.has(key)) return { hex: towards, onEdge: false, reason: 'zoc' }
    if (staged) {
      const stage = stageOfEdge(edgeKinds({ c: from.col, r: from.row }, { c: towards.col, r: towards.row }))
      if (stage < state.stage) return { hex: towards, onEdge: true, reason: 'stage' }
    }
    return { hex: towards, onEdge: false, reason: 'detour' }
  }

  /** `unit` est-elle reliée à ses arrières ? Pour UNE unité : `unsuppliedIds`
   *  est bien plus rapide dès qu'il faut le savoir pour toute une armée. */
  function hasSupply(unit) {
    return pathFor(unit) != null
  }

  /** Tous les hex qu'une ligne peut atteindre EN PARTANT des `starts`, pour
   *  le camp `side`.
   *
   *  C'est le parcours de `pathFor` pris À L'ENVERS — depuis les arrières
   *  vers les unités, et non l'inverse —, ce qui permet de le faire UNE FOIS
   *  pour tout un camp au lieu d'une fois par unité. La règle s'y lit en
   *  miroir. À l'aller, chaque hexside franchi doit valoir au moins l'étage
   *  de TOUS les hex déjà traversés (cf. `stepStage`) ; au retour, on porte
   *  donc pour chaque hex le PLAFOND de la suite — l'étage le plus faible
   *  des hexsides qui le séparent de la source —, et un hex n'est atteint que
   *  si son propre étage (cf. `stageOfHex`) ne le dépasse pas. Le plafond ne
   *  peut que baisser en s'éloignant de la source ; pour un même hex, on ne
   *  garde que le plus haut, le plus permissif. Sans étages (`staged` faux —
   *  le ravitaillement aérien), seule la distance compte.
   *
   *  @returns `{ reached }`, un Set de clés "col,row" : les hex d'où une ligne
   *  peut partir (une unité qui s'y trouve est ravitaillée). */
  function reachFrom(starts, { context, staged, limit = Infinity }) {
    const reached = new Set()
    const best = new Map() // clé -> plus haut plafond déjà propagé
    let frontier = []
    for (const start of starts) {
      if (!hexAllows(context, start)) continue
      const key = keyOf(start.col, start.row)
      if (best.has(key)) continue
      // L'unité posée SUR la source est ravitaillée sans avoir à en partir :
      // aucun hexside ne la contraint encore.
      reached.add(key)
      best.set(key, Infinity)
      frontier.push({ hex: start, cap: Infinity })
    }
    for (let step = 0; step < limit && frontier.length; step += 1) {
      const next = []
      for (const state of frontier) {
        for (const neighbor of neighborsOf(state.hex.col, state.hex.row)) {
          if (!edgeAllows(context, neighbor, state.hex)) continue
          if (!hexAllows(context, neighbor)) continue
          let cap = Infinity
          if (staged) {
            const edge = stageOfEdge(edgeKinds({ c: neighbor.col, r: neighbor.row }, { c: state.hex.col, r: state.hex.row }))
            cap = Math.min(state.cap, edge)
            // Un hex de piste (ou de route) n'est permis que si toute la
            // suite jusqu'à la source passe par des hexsides de piste ou de
            // route (de route seulement).
            if (stageOfHex(neighbor, context) > cap) continue
          }
          const key = keyOf(neighbor.col, neighbor.row)
          if (cap <= (best.get(key) ?? -1)) continue
          best.set(key, cap)
          reached.add(key)
          next.push({ hex: neighbor, cap })
        }
      }
      frontier = next
    }
    return { reached }
  }

  /** Les unités de `units` qui N'ONT PAS de ligne — ids en chaînes.
   *
   *  Une seule passe pour toute l'armée : un parcours depuis les arrières
   *  terrestres, un par zone de largage utile, et la ZOC ennemie calculée une
   *  fois (elle ne dépend que du camp). Là où interroger chaque unité
   *  séparément refait la carte autant de fois qu'il y a d'unités, ceci la
   *  parcourt quatre fois pour Arnhem, quel que soit le nombre de pions. */
  function unsuppliedIds(units) {
    const out = new Set()
    if (!active.value) return out
    const concerned = (units ?? []).filter(concerns)
    if (!concerned.length) return out
    const context = contextFor(supply.side, concerned[0])
    const ground = concerned.filter((unit) => !isAirborneEntry(unit))
    const airborne = concerned.filter(isAirborneEntry)

    if (ground.length) {
      const sources = (supply.ground?.sources ?? []).map(parseHexId)
      const { reached } = reachFrom(sources, { context, staged: true })
      // L'étage de l'hex de l'unité est déjà vérifié par le parcours : une
      // unité dans un hex de piste n'est atteinte que par une ligne qui
      // repart par la piste ou la route (cf. `reachFrom`).
      for (const unit of ground) {
        if (!reached.has(keyOf(unit.col, unit.row))) out.add(String(unit.id))
      }
    }

    // Un parcours par division représentée sur la carte, pas par unité.
    const byDivision = new Map()
    for (const unit of airborne) {
      const division = String(unit.division ?? '')
      if (!byDivision.has(division)) byDivision.set(division, [])
      byDivision.get(division).push(unit)
    }
    for (const [division, members] of byDivision) {
      const zones = counters().filter((marker) => !isFighter(marker) && String(marker.code) === division)
        .map((marker) => ({ col: marker.col, row: marker.row }))
      const reached = zones.length
        ? reachFrom(zones, { context, staged: false, limit: supply.airborne?.range ?? Infinity }).reached
        : new Set()
      for (const unit of members) {
        if (!reached.has(keyOf(unit.col, unit.row))) out.add(String(unit.id))
      }
    }
    return out
  }

  /** Les hex de la ligne de `unit`, en clés "col,row" — pour le surlignage
   *  de la carte (cf. HexMap.vue). Ensemble vide s'il n'y a pas de ligne. */
  function pathKeys(unit) {
    const path = pathFor(unit)
    if (!path) return new Set()
    return new Set(path.hexes.map((hex) => keyOf(hex.col, hex.row)))
  }

  /** Les hex de la ligne, tels qu'imprimés ("0105"...) — pour le journal et
   *  les infobulles. */
  function pathLabels(unit) {
    const path = pathFor(unit)
    return path ? path.hexes.map((hex) => hexId(hex.col + 1, hex.row)) : []
  }

  return { active, concerns, pathFor, traceFor, hasSupply, unsuppliedIds, pathKeys, pathLabels }
}
