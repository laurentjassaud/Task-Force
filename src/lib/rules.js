// ═══════════════════════════════════════════════════════════════════════════
// rules — paramètres des règles GÉNÉRIQUES, déclarés par le module
// ═══════════════════════════════════════════════════════════════════════════
//
// Le moteur applique les mêmes règles à tous les modules (véhicules et
// terrains interdits, empilement...), mais LEURS VALEURS sont celles de la
// boîte de jeu : elles viennent de `module.rules` (cf. public/modules/*.json,
// README "Anatomie d'un module"). Ce fichier les lit, les assainit et
// complète ce qui manque par des défauts raisonnables — un module sans
// `rules` joue donc exactement comme avant leur introduction.
//
// Les clés que le moteur ne connaît pas sont conservées telles quelles : ce
// sont celles des RÈGLES PARTICULIÈRES d'un module (cf. lib/moduleRules.js —
// ex. `airborneArrivalSpentMp`), qui n'ont pas
// besoin d'être listées ici pour être déclarées dans le JSON.

export const DEFAULT_RULES = Object.freeze({
  // Types d'unité (`counter.type`) motorisées/blindées, auxquelles le terrain
  // accidenté est interdit et qui ne franchissent ni ruisseau à gué ni
  // rivière par bac (cf. lib/useAssisted.js::canEnterTerrain).
  vehicleTypes: ['armor', 'reconnaissance', 'mechanized', 'self-propelled arty'],
  // Types de terrain (clés de `terrain.grid`) fermés à ces véhicules, sauf
  // par une route, une piste ou un pont.
  impassableForVehicles: ['rough', 'broken', 'woods'],
  // Nombre maximal d'unités AMIES par hex à la fin d'un mouvement (cf.
  // lib/useAssisted.js, section "Empilement"). `"none"` : le jeu n'a pas de
  // règle d'empilement (mer de Corail), résolu en `Infinity`.
  stackingLimit: 1,
  // Zones de contrôle (cf. lib/useAssisted.js, section "ZOC") :
  //   - `lockIfStarting` : une unité qui COMMENCE son mouvement en ZOC
  //     ennemie ne peut pas bouger ;
  //   - `stopOnEntry` : une unité qui ENTRE en ZOC ennemie doit s'y arrêter ;
  //   - `blocksRetreat` : une retraite ne peut pas entrer en ZOC ennemie.
  zoc: Object.freeze({ lockIfStarting: true, stopOnEntry: true, blocksRetreat: true }),
  // Congestion des hex d'entrée de renfort (cf. lib/useAssisted.js, section
  // "Congestion") : 'multiply' — la N-ième entrée par un même hex, le même
  // tour, coûte N fois le coût de base ; 'none' — toujours le coût de base.
  entryCongestion: 'multiply',
  // Sortie de carte (cf. HexMap.vue, section "Sortie de carte") : `null` —
  // aucune unité ne peut quitter la carte. Un module qui l'autorise déclare
  // `{ side, zones: [{ id, label, hexes }] }` (cf. `resolveMapExit`).
  mapExit: null,
  // Démolition des ponts (cf. lib/useBridges.js) : `null` — aucun pont
  // n'est démolissable. Un module qui la connaît déclare
  // `{ layers, trigger, by, destroyOn, reveals, fallback }` (cf.
  // `resolveBridgeDemolition`).
  bridgeDemolition: null,
  // Réparation des ponts (cf. lib/useBridges.js) : `null` — un pont démoli
  // le reste. Un module qui la connaît déclare `{ layers, by, unitTypes,
  // undisturbedSide }` (cf. `resolveBridgeRepair`).
  bridgeRepair: null,
  // Lignes de communication (cf. lib/useSupplyLine.js) : `null` — le module
  // n'en a pas. Un module qui les connaît déclare `{ side, excludeFactions,
  // blockingKinds, bridgeKinds, ground: { sources, stages }, airborne:
  // { range } }` (cf. `resolveSupplyLine`).
  supplyLine: null,
  // Points de victoire (cf. lib/useVictoryPoints.js) : `null` — le module
  // n'en compte pas. Un module qui les connaît déclare `{ sides,
  // elimination, unsupplied, zones, zoneBarriers }` (cf.
  // `resolveVictoryPoints`).
  victoryPoints: null,
})

export const ENTRY_CONGESTION_MODES = ['multiply', 'none']

// Structure du tour d'un camp (`module.turnStructure`, cf. lib/useAssisted.js,
// section "Phases") : quelles phases, en plus du Mouvement, il comporte.
export const DEFAULT_TURN_STRUCTURE = Object.freeze({
  // Phase Airborne AVANT le Mouvement, pour un camp qui a des aéroportés à
  // poser ; sans elle, les aéroportés se posent comme les autres renforts.
  airbornePhase: true,
  // Phase Combat APRÈS le Mouvement ; sans elle, aucun combat.
  combatPhase: true,
  // Phase "Fin de tour" après le dernier camp de l'ordre, avant le tour suivant.
  endOfTurnPhase: true,
})

// Pas (`phaseStep`, cf. lib/useAssisted.js) du 1er marqueur d'une liste de
// phases déclarée par le module (`turnStructure.phases`) qui n'est ni un
// Mouvement ni un Combat : 0/1/2 (Mouvement/Combat/Fin de tour) et -1
// (Airborne) gardent leur sens partout ailleurs, les phases propres au
// module se rangent donc à la suite (3, 4, 5...).
export const CUSTOM_PHASE_BASE = 3
const PHASE_KINDS = { movement: 0, combat: 1 }

/** `turnStructure.phases` → liste `[{ id, label, kind, step }]` vérifiée, ou
 *  `null` (le module garde les phases standard). Chaque entrée déclare :
 *   - `id`    : clé stable (journal, marqueur allumé) ;
 *   - `label` : libellé affiché, en français (traduit par le dictionnaire
 *               `i18n` du module, cf. src/i18n::mt) ;
 *   - `kind`  : facultatif — "movement" (règles de déplacement, MP, pas 0)
 *               ou "combat" (table de combat, pas 1). Sans `kind`, la phase
 *               est un simple jalon du tour : aucune règle automatique.
 *  Une liste sans phase "movement" n'autoriserait jamais aucun déplacement
 *  en mode Assisté : la 1re phase en tient alors lieu. */
function resolvePhases(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const phases = raw
    .filter((phase) => phase && typeof phase.id === 'string')
    .map((phase) => ({ id: phase.id, label: typeof phase.label === 'string' ? phase.label : phase.id, kind: PHASE_KINDS[phase.kind] != null ? phase.kind : null }))
  if (!phases.length) return null
  if (!phases.some((phase) => phase.kind === 'movement')) phases[0].kind = 'movement'
  const used = new Set()
  let custom = CUSTOM_PHASE_BASE
  for (const phase of phases) {
    // Une même nature déclarée deux fois : la seconde n'est qu'un jalon.
    if (phase.kind && used.has(phase.kind)) phase.kind = null
    if (phase.kind) used.add(phase.kind)
    phase.step = phase.kind ? PHASE_KINDS[phase.kind] : custom++
  }
  return phases
}

/** `module.turnStructure` → structure complète (booléens, défauts appliqués,
 *  `phases` : liste de phases propre au module, ou `null`). */
export function resolveTurnStructure(raw) {
  const structure = raw && typeof raw === 'object' ? raw : {}
  const flag = (key) => (typeof structure[key] === 'boolean' ? structure[key] : DEFAULT_TURN_STRUCTURE[key])
  return { airbornePhase: flag('airbornePhase'), combatPhase: flag('combatPhase'), endOfTurnPhase: flag('endOfTurnPhase'), phases: resolvePhases(structure.phases) }
}

/** `rules.mapExit` → `{ side, zones: [{ id, label, hexes }] }` vérifié, ou
 *  `null` (pas de sortie de carte dans ce module).
 *
 *  `side` est une clé de `module.sides` : SEUL ce camp peut faire sortir ses
 *  unités. Chaque zone est une BANDE DE BORD au format `setup` "CCRR-CCRR"
 *  (cf. lib/setup.js) — une unité ne peut sortir que depuis l'une d'elles, et
 *  ne rentrera que par la MÊME (cf. HexMap.vue, section "Sortie de carte").
 *  `id` identifie la zone dans le journal (elle doit donc rester stable d'une
 *  partie à l'autre), `label` sert aux messages. */
export function resolveMapExit(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.side !== 'string' || !raw.side) return null
  const zones = (Array.isArray(raw.zones) ? raw.zones : [])
    .filter((zone) => zone && typeof zone.id === 'string' && zone.id && typeof zone.hexes === 'string' && zone.hexes)
    .map((zone) => ({ id: zone.id, label: typeof zone.label === 'string' && zone.label ? zone.label : zone.id, hexes: zone.hexes }))
  return zones.length ? { side: raw.side, zones } : null
}

/** `rules.bridgeDemolition` → `{ layers, trigger, by, destroyOn, reveals,
 *  fallback }` vérifié, ou `null` (aucun pont démolissable dans ce module).
 *
 *  La règle (cf. lib/useBridges.js) : un pont posé sur l'une des `layers`
 *  du module (couches d'arêtes, cf. lib/edges.js — ex. les ponts de canal
 *  et de chemin de fer, jamais les ponts routiers) peut être démoli dès
 *  qu'une unité du camp `trigger` occupe l'un des deux hex qu'il relie. C'est
 *  le camp `by` qui décide, une seule fois par pont : il lance un dé, et le
 *  pont saute si la face tirée est dans `destroyOn`.
 *
 *  Un pont démoli laisse l'obstacle qu'il franchissait : l'arête prend la
 *  première nature de `reveals` qu'elle porte déjà (rivière avant ruisseau),
 *  ou `fallback` si elle n'en porte aucune — cas d'un canal dont
 *  seuls les PONTS figurent dans les données du module.
 *
 *  `layers` et `by` sont indispensables : sans eux, rien à démolir ni
 *  personne pour le décider, et la règle entière est ignorée. */
export function resolveBridgeDemolition(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.by !== 'string' || !raw.by) return null
  const layers = (Array.isArray(raw.layers) ? raw.layers : []).filter((layer) => typeof layer === 'string' && layer)
  if (!layers.length) return null
  const destroyOn = (Array.isArray(raw.destroyOn) ? raw.destroyOn : []).filter((face) => Number.isInteger(face) && face >= 1)
  const reveals = (Array.isArray(raw.reveals) ? raw.reveals : []).filter((kind) => typeof kind === 'string' && kind)
  const labels = raw.labels && typeof raw.labels === 'object' ? raw.labels : {}
  return {
    layers,
    // Camp dont la présence ouvre l'occasion ; à défaut, n'importe quelle
    // unité ennemie du camp qui décide (cf. lib/useBridges.js).
    trigger: typeof raw.trigger === 'string' && raw.trigger ? raw.trigger : null,
    by: raw.by,
    // Nombre de faces du dé (6 à défaut) et faces qui font sauter le pont.
    faces: Number.isInteger(raw.faces) && raw.faces >= 2 ? raw.faces : 6,
    destroyOn: destroyOn,
    reveals,
    fallback: typeof raw.fallback === 'string' && raw.fallback ? raw.fallback : null,
    // Comment nommer un pont de chaque couche, pour la modale et le journal.
    labels: Object.fromEntries(layers.map((layer) => [layer,
      typeof labels[layer] === 'string' && labels[layer] ? labels[layer] : 'pont'])),
  }
}

/** `rules.bridgeRepair` → `{ layers, by, unitTypes, undisturbedSide }`
 *  vérifié, ou `null` (aucun pont ne se répare dans ce module).
 *
 *  La règle (cf. lib/useBridges.js) : une unité du camp `by` dont le type est
 *  dans `unitTypes` (le génie), postée dans un hex que borde un pont DÉMOLI
 *  d'une des `layers`, peut le remettre en état — à condition d'avoir passé
 *  TOUT le tour du camp `undisturbedSide` hors de ses zones de contrôle. La
 *  réparation se confirme pendant la phase de Fin de tour, et le pont
 *  redevient ce qu'il était : franchissable, et hors d'atteinte d'une
 *  nouvelle démolition.
 *
 *  `layers` est un SOUS-ENSEMBLE des couches démolissables : ex. le génie
 *  relève les ponts de canal, jamais ceux du chemin de fer. `by` et
 *  `unitTypes` sont indispensables — sans eux, personne pour réparer. */
export function resolveBridgeRepair(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.by !== 'string' || !raw.by) return null
  const layers = (Array.isArray(raw.layers) ? raw.layers : []).filter((layer) => typeof layer === 'string' && layer)
  const unitTypes = (Array.isArray(raw.unitTypes) ? raw.unitTypes : []).filter((type) => typeof type === 'string' && type)
  if (!layers.length || !unitTypes.length) return null
  return {
    layers,
    by: raw.by,
    unitTypes,
    // Camp dont le tour doit se passer sans que le réparateur entre dans ses
    // ZOC ; à défaut, aucune condition de ce genre.
    undisturbedSide: typeof raw.undisturbedSide === 'string' && raw.undisturbedSide ? raw.undisturbedSide : null,
  }
}

/** `rules.supplyLine` → règle des lignes de communication vérifiée, ou
 *  `null` (ce module n'en a pas).
 *
 *  La règle (cf. lib/useSupplyLine.js) : les unités du camp `side` — sauf
 *  celles des `excludeFactions` — tracent une suite continue d'hex depuis le
 *  leur jusqu'à une source. Les unités venues par les airs rejoignent la zone
 *  de largage de leur division en `airborne.range` hex au plus ; les autres
 *  rejoignent l'un des hex `ground.sources`, en respectant les `ground.stages`
 *  — les natures d'arête qui, une fois empruntées, tiennent la ligne au même
 *  réseau ou mieux pour tout le reste du trajet (piste, puis route).
 *
 *  `blockingKinds` sont les natures d'hexside qui coupent la ligne (cours
 *  d'eau), `bridgeKinds` celles qui la laissent passer malgré elles (ponts).
 *
 *  `side` est indispensable : sans lui, on ne sait pas qui trace. */
export function resolveSupplyLine(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.side !== 'string' || !raw.side) return null
  const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [])
  const ground = raw.ground && typeof raw.ground === 'object' ? raw.ground : {}
  const airborne = raw.airborne && typeof raw.airborne === 'object' ? raw.airborne : {}
  const range = Number.isInteger(airborne.range) && airborne.range >= 1 ? airborne.range : null
  return {
    side: raw.side,
    excludeFactions: strings(raw.excludeFactions),
    blockingKinds: strings(raw.blockingKinds),
    bridgeKinds: strings(raw.bridgeKinds),
    ground: { sources: strings(ground.sources), stages: strings(ground.stages) },
    airborne: { range: range ?? Infinity },
  }
}

/** `rules.victoryPoints` → règle des points de victoire vérifiée, ou `null`
 *  (ce module n'en compte pas).
 *
 *  La règle (cf. lib/useVictoryPoints.js) : `sides` sont les camps qui
 *  marquent ; `elimination` ce que chacun reçoit par unité ADVERSE perdue ;
 *  `unsupplied` ce qu'un camp reçoit par unité adverse coupée de ses arrières
 *  à la fin d'un tour ; `zones` les positions payées à qui les tient en
 *  traçant une ligne (chacune : `id`, `label`, `seed` — l'hex témoin —, `to`
 *  et `points`) ; `zoneBarriers` les couches d'arêtes qui délimitent ces
 *  zones (les rivières), et qu'un remplissage ne franchit jamais.
 *
 *  `outcome` (facultatif) : le RÉSULTAT de la partie d'après les totaux
 *  (cf. useVictoryPoints.js::outcome) — `ratio: { of, to }`, les deux camps
 *  dont on compare les points (`of` contre `to`, ramené à « N contre 1 »),
 *  et `levels`, les paliers de ce rapport du plus haut au plus bas : chacun
 *  `min` (rapport minimal, inclus ; absent sur le dernier, qui ramasse tout
 *  le reste), `winner` (camp vainqueur, `null` pour un match nul) et `level`
 *  ('strategic' | 'tactical').
 *
 *  `sides` est indispensable : sans camp, rien à compter. */
export function resolveVictoryPoints(raw) {
  if (!raw || typeof raw !== 'object') return null
  const sides = (Array.isArray(raw.sides) ? raw.sides : []).filter((side) => typeof side === 'string' && side)
  if (!sides.length) return null
  const points = (value) => (Number.isInteger(value) && value >= 0 ? value : 0)
  const elimination = raw.elimination && typeof raw.elimination === 'object' ? raw.elimination : {}
  const unsupplied = raw.unsupplied && typeof raw.unsupplied === 'object' ? raw.unsupplied : {}
  const zones = (Array.isArray(raw.zones) ? raw.zones : [])
    .filter((zone) => zone && typeof zone.id === 'string' && typeof zone.seed === 'string' && sides.includes(zone.to))
    .map((zone) => ({
      id: zone.id,
      label: typeof zone.label === 'string' && zone.label ? zone.label : zone.id,
      seed: zone.seed,
      to: zone.to,
      points: points(zone.points),
    }))
  return {
    sides,
    elimination: Object.fromEntries(sides.map((side) => [side, points(elimination[side])])),
    unsupplied: sides.includes(unsupplied.to)
      ? { to: unsupplied.to, points: points(unsupplied.points) }
      : null,
    zones,
    zoneBarriers: (Array.isArray(raw.zoneBarriers) ? raw.zoneBarriers : []).filter((layer) => typeof layer === 'string' && layer),
    outcome: resolveOutcome(raw.outcome, sides),
  }
}

/** `victoryPoints.outcome` → paliers de résultat vérifiés, ou `null` (cf.
 *  `resolveVictoryPoints`). Un palier sans `min` vaut pour tout rapport. */
function resolveOutcome(raw, sides) {
  if (!raw || typeof raw !== 'object') return null
  const ratio = raw.ratio && typeof raw.ratio === 'object' ? raw.ratio : {}
  if (!sides.includes(ratio.of) || !sides.includes(ratio.to) || ratio.of === ratio.to) return null
  const levels = (Array.isArray(raw.levels) ? raw.levels : [])
    .filter((level) => level && typeof level === 'object' && (level.winner == null || sides.includes(level.winner)))
    .map((level) => ({
      min: typeof level.min === 'number' && Number.isFinite(level.min) ? level.min : -Infinity,
      winner: level.winner ?? null,
      level: level.winner == null ? null : (level.level === 'tactical' ? 'tactical' : 'strategic'),
    }))
    .sort((levelA, levelB) => levelB.min - levelA.min)
  return levels.length ? { ratio: { of: ratio.of, to: ratio.to }, levels } : null
}

/** `module.rules` (objet libre, éventuellement absent) → règles prêtes à
 *  l'emploi : listes converties en `Set`, entiers vérifiés, défauts
 *  appliqués, clés inconnues conservées. */
export function resolveRules(raw) {
  const rules = raw && typeof raw === 'object' ? raw : {}
  const stringList = (value, fallback) =>
    (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : fallback)
  const positiveInt = (value, fallback) => (Number.isInteger(value) && value >= 1 ? value : fallback)
  const zoc = rules.zoc && typeof rules.zoc === 'object' ? rules.zoc : {}
  const zocFlag = (key) => (typeof zoc[key] === 'boolean' ? zoc[key] : DEFAULT_RULES.zoc[key])
  return {
    ...rules,
    vehicleTypes: new Set(stringList(rules.vehicleTypes, DEFAULT_RULES.vehicleTypes)),
    impassableForVehicles: new Set(stringList(rules.impassableForVehicles, DEFAULT_RULES.impassableForVehicles)),
    stackingLimit: rules.stackingLimit === 'none' ? Infinity : positiveInt(rules.stackingLimit, DEFAULT_RULES.stackingLimit),
    zoc: { lockIfStarting: zocFlag('lockIfStarting'), stopOnEntry: zocFlag('stopOnEntry'), blocksRetreat: zocFlag('blocksRetreat') },
    entryCongestion: ENTRY_CONGESTION_MODES.includes(rules.entryCongestion) ? rules.entryCongestion : DEFAULT_RULES.entryCongestion,
    mapExit: resolveMapExit(rules.mapExit),
    bridgeDemolition: resolveBridgeDemolition(rules.bridgeDemolition),
    bridgeRepair: resolveBridgeRepair(rules.bridgeRepair),
    supplyLine: resolveSupplyLine(rules.supplyLine),
    victoryPoints: resolveVictoryPoints(rules.victoryPoints),
  }
}
