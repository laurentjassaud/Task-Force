// ═══════════════════════════════════════════════════════════════════════════
// useArtillery — règles de l'ARTILLERIE du mode "Assisté"
// ═══════════════════════════════════════════════════════════════════════════
//
// Une artillerie (cf. lib/units.js::isArtillery) porte, à la place d'un
// facteur d'attaque, trois valeurs de tir (cf. module, table `counters`) :
//   - `bar` : facteur de BARRAGE — sa force quand elle ATTAQUE ;
//   - `fpf` : facteur de "FINAL PROTECTIVE FIRE" (FPF) — ce qu'elle ajoute à
//     la DÉFENSE d'une unité amie attaquée, pendant le tour adverse ;
//   - `range` : sa PORTÉE, en hex.
// Elle se DÉFEND avec son facteur de défense (`def`), comme toute unité.
// Elle peut donc servir DEUX fois par tour de jeu : une fois par tour de
// joueur — en attaque (barrage) pendant la phase de Combat de son camp, en
// défense (FPF) pendant la phase de Combat adverse.
//
// ─── ADJACENCE ("AU CONTACT") ────────────────────────────────────────────────
// Deux hex voisins ne sont PAS adjacents au sens du combat quand l'hexside
// qui les sépare interdit l'attaque (rivière sans pont pour Arnhem, cf.
// useAssisted.js::edgeBlocksAttack). Une unité est "AU CONTACT" si elle est
// adjacente, en ce sens, à au moins une unité ennemie (cf. `inContact`).
//
// ─── BARRAGE (attaque) ───────────────────────────────────────────────────────
//   - AU CONTACT, l'artillerie se comporte comme une unité ordinaire : elle
//     ne peut attaquer que des hex ADJACENTS, elle est OBLIGÉE d'attaquer
//     (mêmes obligations que les autres, cf. useCombat.js::strandedUnits),
//     avec son facteur de barrage, et elle SUBIT le résultat du combat ;
//   - PAS AU CONTACT, elle tire À DISTANCE (cf. `canBombard`) : sur tout hex
//     ennemi DANS SA PORTÉE et ADJACENT à une unité amie (qui l'observe) —
//     seule ou avec d'autres unités. Elle n'est jamais obligée de tirer et
//     n'est JAMAIS affectée par le résultat : ni retraite, ni élimination,
//     ni avance après combat. Elle ne remplit pas non plus les obligations
//     de combat (choix validé : "tout ennemi au contact doit être attaqué"
//     ne se solde que par des unités adjacentes) ;
//   - une artillerie REFOULÉE par une retraite amie (cf. useRetreat.js) ne
//     peut plus tirer jusqu'à la fin de la phase de Combat en cours — POINT
//     ORANGE sur le pion (cf. `isDisplaced`) ;
//   - [8.62] une unité attaquée UNIQUEMENT par de l'artillerie et/ou des
//     pions de soutien ne profite que du terrain de SON HEX, jamais de
//     l'hexside — dès qu'une unité non artilleur participe à l'attaque,
//     l'hexside compte de nouveau (cf. useCombat.js::rowForTargetHex).
//
// ─── FINAL PROTECTIVE FIRE (défense) ─────────────────────────────────────────
// Pendant la phase de Combat ADVERSE, le défenseur peut ajouter le facteur
// FPF d'une artillerie amie à la défense d'un combat (cf. `canProvideFpf`)
// si :
//   - l'un des hex attaqués est dans sa portée ;
//   - elle n'est pas au contact d'une unité ennemie ;
//   - elle n'a pas déjà fait un FPF pendant cette phase de Combat ;
//   - elle n'a subi aucun résultat de combat pendant cette phase de Combat,
//     ni pendant la précédente — POINT ROUGE sur le pion (cf. `isDisrupted`) ;
//   - elle n'a pas été refoulée pendant cette phase (point orange) ;
//   - [8.45] l'attaque n'est pas faite UNIQUEMENT par de l'artillerie et/ou
//     des pions de soutien (cf. useCombat.js::supportBarred, qui applique la
//     même règle aux pions de soutien du défenseur).
// Elle n'est jamais affectée par le résultat du combat qu'elle soutient.
//
// Tout l'état tenu ici (résultats subis, refoulements, FPF déjà faits) se
// déduit du journal : au rejeu (cf. HexMap.vue::applyReplayEntry), l'entrée
// `combat` repasse par `applyCombat`, l'entrée `retreat` d'un refoulement par
// `markDisplaced`.
//
// Paramètres reçus :
//   - `phase` : computed de la phase courante (cf. useAssisted.js::phase) —
//     à chaque changement, refoulements et FPF de la phase écoulée sont
//     oubliés.
//   - `step` : computed du PAS courant de la piste de tour (cf.
//     TurnTracker.vue::currentStep — un pas par camp et par tour) : la phase
//     de Combat "précédente" est celle du pas d'avant.
//   - `counters` : ref du tableau des pions posés sur la carte.
//   - `isEnemyOf`, `edgeBlocksAttack` : cf. useAssisted.js.
//   - `resultEffect` : `(code) => effet | null` — ce que fait un résultat de
//     la table (cf. lib/combatTable.js, `module.combat.effects`).
//   - `moduleRules` : règles PARTICULIÈRES au module joué (cf.
//     lib/moduleRules.js), dont ce fichier n'utilise que `engineerAssaultEdge`
//     — un hexside que le combat fermerait, mais qu'une règle du module
//     ouvre à telle unité (la passerelle du génie d'Arnhem, cf.
//     `adjacentForCombat`).
import { ref, watch } from 'vue'
import { hexDistance, neighborsOf } from './hex.js'
import { isArtillery, isFighter } from './units.js'

export function useArtillery({ phase, step, counters, isEnemyOf, edgeBlocksAttack, resultEffect = () => null, moduleRules = {} }) {
  // Pas (cf. `step`) où chaque artillerie a subi pour la dernière fois un
  // résultat de combat — id (chaîne) -> pas. Jamais vidé en cours de partie :
  // seul l'écart avec le pas courant compte (cf. `isDisrupted`).
  const hitSteps = ref(new Map())

  // Artilleries refoulées pendant la phase de Combat en cours (ids, chaînes).
  const displacedIds = ref(new Set())

  // Artilleries ayant déjà fait leur FPF pendant la phase en cours (ids).
  const fpfUsedIds = ref(new Set())

  // Changement de phase : refoulements et FPF ne valent que pour la phase de
  // Combat où ils ont eu lieu. `flush: 'sync'` : au rejeu d'un journal, les
  // entrées de la phase suivante arrivent dans le même élan (cf.
  // useCombat.js, même précaution).
  watch(phase, () => {
    displacedIds.value = new Set()
    fpfUsedIds.value = new Set()
  }, { flush: 'sync' })

  const at = (unit) => ({ c: unit.col, r: unit.row })

  /** `a` et `b` (`{ col, row }`) sont-ils ADJACENTS au sens du combat :
   *  voisins, et pas séparés par un hexside qui interdit l'attaque ?
   *
   *  Une règle du module peut ouvrir cet hexside-là à cette unité-là (cf.
   *  `moduleRules.engineerAssaultEdge` et lib/useArnhem.js : la passerelle du
   *  génie change la rivière en ruisseau pour l'aéroporté qui l'emprunte).
   *  `positionA` est alors l'unité qui attaque — c'est toujours un pion que
   *  les appelants passent ici, jamais une position nue. */
  function adjacentForCombat(positionA, positionB) {
    const neighbor = neighborsOf(positionA.col, positionA.row).some((hex) => hex.col === positionB.col && hex.row === positionB.row)
    if (!neighbor) return false
    if (!edgeBlocksAttack(at(positionA), at(positionB))) return true
    return moduleRules.engineerAssaultEdge?.(positionA, at(positionA), at(positionB)) != null
  }

  /** `unit` est-elle AU CONTACT d'une unité ennemie (cf. l'en-tête) ? */
  function inContact(unit) {
    return counters.value.some((other) => isFighter(other) && isEnemyOf(unit, other) && adjacentForCombat(unit, other))
  }

  /** L'hex `hex` est-il OBSERVÉ par le camp de `unit` : adjacent (au sens du
   *  combat) à au moins une unité amie de `unit` ? */
  function isSpotted(hex, unit) {
    return counters.value.some((other) => isFighter(other) && !isEnemyOf(unit, other) && adjacentForCombat(other, hex))
  }

  /** `hex` est-il dans la portée de l'artillerie `unit` ? */
  const inRange = (unit, hex) => hexDistance(unit, hex) <= (unit.range ?? 0)

  /** `unit` est-elle une artillerie qui tire À DISTANCE (pas au contact) ?
   *  Elle n'est alors jamais affectée par le résultat du combat. */
  function firesAtRange(unit) {
    return isArtillery(unit) && !inContact(unit)
  }

  /** L'artillerie `unit` peut-elle tirer à distance sur l'hex `hex` : pas au
   *  contact, `hex` dans sa portée et observé par une unité amie ? (Ne dit
   *  rien de "a déjà combattu" / "refoulée", vérifiés par useCombat.js.) */
  function canBombard(unit, hex) {
    return firesAtRange(unit) && inRange(unit, hex) && isSpotted(hex, unit)
  }

  /** Force d'attaque de `unit` : barrage pour une artillerie, attaque sinon. */
  function attackFactor(unit) {
    return (isArtillery(unit) ? unit.bar : unit.atk) ?? 0
  }

  /** L'artillerie `unit` a-t-elle été refoulée pendant la phase de Combat en
   *  cours (point orange) ? Elle ne peut alors plus tirer — ni barrage, ni
   *  FPF — jusqu'à la fin de cette phase. */
  function isDisplaced(unit) {
    return !!unit && displacedIds.value.has(String(unit.id))
  }

  /** L'artillerie `unit` a-t-elle subi un résultat de combat pendant cette
   *  phase de Combat ou la précédente (point rouge) ? Plus de FPF alors. */
  function isDisrupted(unit) {
    if (!isArtillery(unit)) return false
    const hit = hitSteps.value.get(String(unit.id))
    return hit != null && hit >= step.value - 1
  }

  /** L'artillerie `unit` peut-elle apporter son FPF au combat qui vise les
   *  hex `targets` (`{ col, row }`), attaqués par `attackers` et défendus par
   *  `defenders` ? Cf. l'en-tête pour les conditions. */
  function canProvideFpf(unit, { targets, attackers, defenders }) {
    if (!isArtillery(unit) || !(unit.fpf > 0) || defenders.length === 0) return false
    if (defenders.some((defender) => String(defender.id) === String(unit.id))) return false
    if (isEnemyOf(unit, defenders[0])) return false
    if (!attackers.some((attacker) => !isArtillery(attacker))) return false
    if (fpfUsedIds.value.has(String(unit.id)) || isDisrupted(unit) || isDisplaced(unit)) return false
    if (inContact(unit)) return false
    return targets.some((target) => inRange(unit, target))
  }

  /** Conséquences d'un combat résolu pour l'artillerie — en jeu comme au
   *  rejeu, à partir des données de l'entrée `combat` du journal :
   *   - les artilleries touchées par le résultat (défenseurs, ou attaquants
   *     au contact, du côté que le résultat fait retraiter) sont marquées
   *     pour le point rouge ;
   *   - les artilleries du FPF ont fait leur tir de la phase. */
  function applyCombat({ attackerIds = [], defenderIds = [], rangedIds = [], fpfIds = [], result } = {}) {
    const effect = resultEffect(result) ?? {}
    const ranged = new Set(rangedIds.map(String))
    const hitIds = [
      ...((effect.retreat?.defenders ?? 0) > 0 ? defenderIds : []),
      ...((effect.retreat?.attackers ?? 0) > 0 ? attackerIds.filter((id) => !ranged.has(String(id))) : []),
    ]
    const nextHits = new Map(hitSteps.value)
    for (const id of hitIds) {
      const unit = counters.value.find((counter) => String(counter.id) === String(id))
      if (isArtillery(unit)) nextHits.set(String(id), step.value)
    }
    hitSteps.value = nextHits
    if (fpfIds.length) fpfUsedIds.value = new Set([...fpfUsedIds.value, ...fpfIds.map(String)])
  }

  /** L'artillerie `id` vient d'être refoulée par une retraite amie (en jeu,
   *  ou entrée `retreat` avec `noFire` au rejeu). */
  function markDisplaced(id) {
    displacedIds.value = new Set(displacedIds.value).add(String(id))
  }

  /** Rechargement d'un journal : on repart de zéro. */
  function reset() {
    hitSteps.value = new Map()
    displacedIds.value = new Set()
    fpfUsedIds.value = new Set()
  }

  return {
    adjacentForCombat, inContact, inRange, firesAtRange, canBombard, attackFactor,
    isDisplaced, isDisrupted, canProvideFpf, applyCombat, markDisplaced, reset,
  }
}
