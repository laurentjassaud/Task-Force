// ═══════════════════════════════════════════════════════════════════════════
// useRetreat — application des RÉSULTATS de combat du mode "Assisté"
// ═══════════════════════════════════════════════════════════════════════════
//
// lib/useCombat.js tire le dé et lit la table de combat ; CE composable-ci
// applique ensuite le résultat obtenu sur la carte (retraites, éliminations).
// Séparé de useCombat.js pour la même raison que celui-ci l'est de
// useAssisted.js : un bloc de règles autonome, qui ne reçoit du reste que
// les briques dont il a besoin (cf. paramètres plus bas).
//
// Ce que fait chaque résultat de la table est déclaré par le module
// (`module.combat.effects`, cf. lib/combatTable.js et le paramètre
// `resultEffect` ci-dessous) : `{ retreat: { defenders: n, attackers: n } }`
// et/ou `{ eliminate: 'defenders' | 'attackers' }`. Pour Arnhem :
//   - D1..D4 : chaque DÉFENSEUR retraite de 1 à 4 hex ;
//   - A1, A2 : chaque ATTAQUANT retraite de 1 ou 2 hex ;
//   - Br     : défenseurs PUIS attaquants retraitent d'1 hex chacun ;
//   - De     : tous les défenseurs sont éliminés ;
//   - Ae     : tous les attaquants sont éliminés.
//
// Règles d'une retraite, vérifiées à CHAQUE hex parcouru :
//   1. l'hex doit ÉLOIGNER l'unité de l'hex de combat — sa distance à
//      celui-ci doit augmenter d'1 à chaque pas (cf. `refDistance`) ;
//   2. on ne peut pas ENTRER dans une ZOC ennemie (cf.
//      useAssisted.js::enemyZocSet) — ni, a fortiori, dans un hex occupé par
//      un ennemi ;
//   3. on ne peut pas entrer dans un hex INTERDIT à l'unité (rivière sans
//      pont, terrain interdit aux véhicules... cf.
//      useAssisted.js::canEnterTerrain), ni sortir de la carte ;
//   4. SI POSSIBLE, on n'entre pas dans un hex occupé par une unité AMIE —
//      seulement si c'est la seule possibilité, et alors SANS S'EMPILER :
//      l'ami est REFOULÉ (cf. ci-dessous).
//
// ─── REFOULEMENT DES AMIS ────────────────────────────────────────────────────
// Quand les seuls pas de retraite possibles mènent dans des hex occupés par
// des unités AMIES, l'unité (ou la pile) qui "bloque" l'hex choisi est
// déplacée d'UN hex, comme si elle retraitait elle-même d'un hex, pour le
// libérer ; l'unité qui retraite entre ensuite dans l'hex laissé vacant.
//   - l'ami refoulé s'éloigne de SON PROPRE hex (et non de l'hex de combat
//     de l'unité qui retraite) : il va donc dans n'importe quel hex VOISIN
//     du sien. Sinon, mêmes règles qu'un pas de retraite (2 et 3
//     ci-dessus) : pas de ZOC ennemie, pas d'hex ennemi, pas de terrain
//     interdit, pas de sortie de carte ;
//   - jamais dans l'hex que QUITTE l'unité qui retraite (pas d'échange de
//     places), ni dans un hex déjà libéré plus haut dans la même chaîne
//     (pas de boucle) ;
//   - règle 4 aussi : un hex libre si possible ; sinon, l'ami qui occupe
//     l'hex visé est lui-même refoulé (d'un hex, à partir de SON hex), et
//     ainsi de suite (refoulement EN CHAÎNE, au plus `MAX_CHAIN` maillons —
//     filet de sécurité contre une explosion combinatoire dans un gros
//     paquet d'unités amies) ;
//   - en principe un hex ne contient qu'UNE unité (pas d'empilement en fin
//     de mouvement). Par sécurité, si plusieurs amis s'y trouvaient quand
//     même, ils seraient refoulés EN BLOC vers un même hex (chacun devant
//     pouvoir y entrer) ;
//   - si aucun refoulement n'est possible, c'est l'unité qui RETRAITE qui
//     est éliminée (jamais celle qui aurait dû se pousser) — le cas général
//     de la retraite impossible, ci-dessous ;
//   - c'est le JOUEUR qui choisit où va l'ami refoulé (cf. `pending`) :
//     après son clic sur l'hex ami, les hex où cet ami peut aller sont
//     surlignés en rouge à leur tour, et ainsi de suite le long de la
//     chaîne. Seuls sont proposés les choix qui laissent la retraite
//     possible jusqu'au bout (cf. `pushPlans`, `viableMoves`) ; s'il n'y en
//     a qu'un, il est appliqué d'office ;
//   - une ARTILLERIE refoulée ne peut plus tirer pendant la phase de Combat
//     en cours — ni barrage, ni "final protective fire" en défense : c'est
//     signalé par `displaceUnit` (`noFire`), et tenu par lib/useArtillery.js
//     (point orange sur le pion).
//
// "L'hex de combat" dont il faut s'éloigner (choix de règle) :
//   - pour un DÉFENSEUR : l'hex qu'il occupait pendant le combat ;
//   - pour un ATTAQUANT : les hex CIBLES du combat (le plus proche d'entre
//     eux, en cas de combat sur plusieurs hex).
//
// Retraite IMPOSSIBLE (choix de règle, classique dans les wargames) :
// l'unité qui ne peut pas effectuer TOUTE sa retraite est ÉLIMINÉE. Pour ne
// jamais piéger une unité par un mauvais choix de chemin, seuls sont
// proposés les hex à partir desquels la retraite peut encore être MENÉE À
// SON TERME (cf. `canComplete`, qui explore les chemins possibles — au plus
// 4 pas, c'est instantané — refoulements d'amis compris).
//
// Déroulé à l'écran (cf. HexMap.vue et CombatModal.vue) : une fois le
// résultat affiché, la modale de combat reste ouverte ; les unités
// retraitent UNE PAR UNE, UN HEX À LA FOIS. Les hex où l'unité en cours peut
// aller sont surlignés en ROUGE, le joueur clique sur l'un d'eux, et on
// recommence jusqu'à ce que chaque unité ait parcouru son nombre d'hex. Les
// autres actions de jeu sont bloquées pendant ce temps.
//
// ─── AVANCE APRÈS COMBAT ─────────────────────────────────────────────────────
// Chemin de retraite ("path of retreat", POR) : TOUS les hex qu'une unité
// quitte en retraitant (son hex de départ et chaque hex traversé — pas celui
// où elle s'arrête, qu'elle occupe encore), ainsi que l'hex d'une unité
// éliminée par le combat (De/Ae, ou retraite impossible). Il est surligné en
// VERT dès qu'un hex est libéré (cf. `isPorHex`).
//
// Une fois toutes les retraites faites, les unités VICTORIEUSES du combat
// peuvent avancer dans ce POR (cf. `victorIds`) :
//   - vainqueurs (choix de règle) : le camp que le résultat ÉPARGNE — les
//     ATTAQUANTS si seuls les défenseurs retraitent ou sont éliminés
//     (D1..D4/De), les DÉFENSEURS dans le cas inverse (A1/A2/Ae) ; PERSONNE
//     si les deux camps sont touchés (Br) ou si le module désactive l'avance
//     (`advanceAfterCombat`) ;
//   - seules les unités ayant PARTICIPÉ au combat, encore sur la carte ;
//   - UNE unité à la fois : on clique sur elle, puis sur un hex VERT VIF
//     voisin (cf. `advanceCandidates`), et on recommence tant qu'on veut ;
//     cliquer sur une autre unité victorieuse TERMINE l'avance de la
//     précédente (si elle a bougé : elle ne peut plus reprendre ensuite) ;
//   - hex par hex, en restant DANS le POR (chaque pas vers un hex du POR
//     voisin de l'unité, jamais vers un hex déjà visité par elle) ;
//   - PAS DE ZOC : les ZOC ennemies ne gênent pas l'avance ;
//   - PAS D'EMPILEMENT : jamais dans un hex occupé par une unité (amie ou
//     ennemie) — y compris par une unité qui vient d'y avancer.
// L'avance se termine par le bouton "Terminer l'avance" de la modale (cf.
// `endAdvance`), ou d'elle-même dès qu'aucune unité victorieuse ne peut plus
// avancer d'un hex (cf. `settleAdvance`) — y compris quand il n'y a rien à
// faire du tout (pas de POR, pas de vainqueur).
//
// Paramètres reçus :
//   - `phase` : computed de la phase courante (cf. useAssisted.js::phase) —
//     un changement de phase abandonne toute retraite en cours (filet de
//     sécurité : HexMap.vue refuse déjà de changer de phase pendant une
//     retraite).
//   - `counters` : ref du tableau des pions POSÉS sur la carte — on y
//     relit à chaque fois la position À JOUR des unités (une unité qui
//     vient de retraiter a bougé : la ZOC et l'occupation des hex changent).
//   - `hexOnMap` : `(col, row) => bool` — l'hex existe-t-il sur la carte ?
//   - `enemyZocSet`, `canEnterTerrain`, `isEnemyOf` : cf. useAssisted.js.
//   - `moveUnit` : `(unit, { col, row }, { done, total }) => void` — fait
//     effectivement avancer l'unité d'un hex (HexMap.vue : position,
//     synchro réseau, journal).
//   - `eliminateUnit` : `(unit, reason) => void` — retire l'unité de la
//     carte (HexMap.vue::eliminateCounter, qui journalise aussi).
//   - `advanceUnit` : `(unit, { col, row }) => void` — même chose que
//     `moveUnit`, pour un pas d'AVANCE après combat.
//   - `displaceUnit` : `(unit, { col, row }, { by, noFire }) => void` — même
//     chose, pour un ami REFOULÉ par l'unité `by` qui retraite (cf. l'en-tête).
//     `noFire` : c'est une artillerie, qui ne pourra plus tirer pendant
//     cette phase de Combat (cf. lib/useArtillery.js::markDisplaced).
//   - `resultEffect` : `(code) => effet | null` — ce que fait le résultat
//     `code` de la table (cf. `module.combat.effects`, en-tête). Un code
//     inconnu ne fait rien.
//   - `advanceAfterCombat` (vrai par défaut) : les vainqueurs peuvent-ils
//     avancer après combat ?
//   - `retreatReduction` (optionnel) : `(unit, { col, row }, { initial,
//     total, done }) => { total, reason } | null` — point d'accroche des
//     règles PARTICULIÈRES d'un module qui permettent de RACCOURCIR une
//     retraite (ex. lib/useArnhem.js::cityRetreatReduction). Le moteur n'en
//     connaît pas le contenu : il demande seulement, pour l'hex où se trouve
//     l'unité, si sa retraite peut passer à un nouveau `total`. `null` = pas
//     de réduction. La réduction est proposée au joueur (cf. `reduce`), et
//     appliquée d'office seulement si, sans elle, l'unité serait éliminée.
import { computed, ref, watch } from 'vue'
import { hexDistance, neighborsOf } from './hex.js'
import { isArtillery, isFighter } from './units.js'
import { t } from '../i18n/index.js'

// Seules les vraies unités comptent (occupation d'un hex, ennemis...) — ni
// les marqueurs (DZ...), ni les pions de soutien : cf. lib/units.js::isFighter.

const keyOf = (col, row) => `${col},${row}`

// Aucun ami déplacé : positions réelles de la carte (cf. `positionOf`).
const NO_MOVES = new Map()

// Nombre maximal d'amis refoulés en chaîne par un même pas de retraite (cf.
// l'en-tête, "Refoulement des amis").
const MAX_CHAIN = 6

export function useRetreat({ phase, counters, hexOnMap, enemyZocSet, canEnterTerrain, isEnemyOf, moveUnit, eliminateUnit, advanceUnit, displaceUnit, resultEffect = () => null, advanceAfterCombat = true, retreatReduction = null }) {
  // File des retraites À FAIRE, dans l'ordre. Chaque entrée :
  //   { id, side, initial, total, done, refHexes }
  //   - `id` : id de l'unité (on relit l'unité elle-même dans `counters`) ;
  //   - `side` : 'defender' | 'attacker' (pour l'affichage) ;
  //   - `total` / `done` : nombre d'hex à parcourir / déjà parcourus ;
  //   - `initial` : nombre d'hex du résultat tiré (= `total` tant qu'aucune
  //     réduction n'a été appliquée, cf. `retreatReduction`) ;
  //   - `refHexes` : l'"hex de combat" dont elle doit s'éloigner (liste de
  //     { col, row }, cf. l'en-tête).
  // La tête de file (`queue[0]`) est l'unité en train de retraiter.
  const queue = ref([])

  // Ce qui s'est passé pendant l'application du résultat (éliminations,
  // retraites terminées...), en phrases — affiché dans la modale de combat.
  const notes = ref([])

  // --- État de l'AVANCE après combat (cf. l'en-tête) ---
  // Chemin de retraite : clés "col,row" des hex libérés par ce combat.
  const por = ref(new Set())
  // Ids des unités victorieuses, qui PEUVENT avancer (cf. `start`).
  const victorIds = ref(new Set())
  // Phase d'avance ouverte (après les retraites, jusqu'à `endAdvance`).
  const advancing = ref(false)
  // Unité en train d'avancer (id), ou `null` tant qu'aucune n'est choisie.
  const advancerId = ref(null)
  // Pour chaque unité victorieuse ayant avancé : les hex (clés) qu'elle a
  // déjà occupés pendant son avance — elle ne revient jamais dessus.
  const visited = ref(new Map())
  // Unités dont l'avance est TERMINÉE (on est passé à une autre après
  // qu'elles ont bougé) : elles ne peuvent plus avancer.
  const doneIds = ref(new Set())

  // Refoulement EN ATTENTE du choix du joueur (cf. l'en-tête) : `null`, ou
  // `{ hex, chosen }` — `hex` : l'hex ami où l'unité en tête de file veut
  // entrer ; `chosen` : les hex déjà choisis le long de la chaîne, en
  // partant de `hex` (chosen[0] : où va l'ami de `hex`, chosen[1] : où va
  // l'ami de chosen[0] s'il était occupé, etc.).
  const pending = ref(null)

  /** Ajoute l'hex `h` ({ col, row }) au chemin de retraite. */
  function addPor(hex) {
    por.value = new Set(por.value).add(keyOf(hex.col, hex.row))
  }

  const unitOf = (id) => counters.value.find((counter) => String(counter.id) === String(id)) ?? null

  /** Distance de `h` à l'"hex de combat" de la retraite `task` — la plus
   *  courte, s'il y en a plusieurs (attaquant d'un combat multi-hex). */
  function refDistance(task, hex) {
    return Math.min(...task.refHexes.map((refHex) => hexDistance(hex, refHex)))
  }

  /** `h` contient-il au moins une unité ENNEMIE de `unit` ? */
  function hasEnemy(unit, hex) {
    return counters.value.some((otherCounter) => isFighter(otherCounter) && otherCounter.col === hex.col && otherCounter.row === hex.row && isEnemyOf(unit, otherCounter))
  }

  // --- Positions SIMULÉES des amis refoulés ------------------------------------
  // Pour explorer une retraite qui refoule des amis (cf. `canComplete`), on ne
  // touche pas aux vrais pions : on note à part où chaque ami refoulé SERAIT
  // (`moved` : Map id (chaîne) -> { col, row }). Seule l'occupation des hex
  // par des AMIS en dépend : les ennemis ne bougent pas, et la ZOC ennemie ne
  // dépend que d'eux (cf. useAssisted.js::enemyZocSet).

  /** Position de `counter` compte tenu des refoulements simulés `moved`. */
  const positionOf = (counter, moved) => moved.get(String(counter.id)) ?? counter

  /** Unités AMIES de `unit` (autres qu'elle) dans l'hex `hex`, compte tenu
   *  des refoulements simulés `moved`. `unit` elle-même est toujours exclue :
   *  pendant l'exploration, sa position réelle n'est plus à jour. */
  function friendsAt(unit, hex, moved) {
    return counters.value.filter((otherCounter) => {
      if (!isFighter(otherCounter) || String(otherCounter.id) === String(unit.id) || isEnemyOf(unit, otherCounter)) return false
      const position = positionOf(otherCounter, moved)
      return position.col === hex.col && position.row === hex.row
    })
  }

  /** `moved` + les déplacements du plan de refoulement `plan` (cf.
   *  `pushPlans`) — nouvelle Map, `moved` n'est pas modifiée. */
  function applyPlan(moved, plan) {
    const next = new Map(moved)
    for (const push of plan) for (const id of push.ids) next.set(id, { col: push.to.col, row: push.to.row })
    return next
  }

  /** Toutes les façons de LIBÉRER l'hex `hex` (occupé par des amis de
   *  `pusher`, l'unité qui retraite) en refoulant ses occupants d'un
   *  hex — cf. l'en-tête, "Refoulement des amis". Générateur (paresseux :
   *  l'appelant s'arrête au premier plan qui lui convient) de PLANS : listes
   *  de déplacements `{ ids, from, to }` à exécuter DANS L'ORDRE — le bout de
   *  la chaîne d'abord, pour que chaque hex visé soit libre quand on y entre.
   *  Aucun plan = refoulement impossible. `zoc` : ZOC ennemie du camp de
   *  `pusher` (le même que celui des amis refoulés). `chain` : clés des hex
   *  interdits aux amis refoulés — l'hex que quitte `pusher`, puis chaque
   *  hex déjà libéré dans la chaîne (dont `hex`). Terminaison garantie : un
   *  hex n'apparaît qu'une fois dans une chaîne, bornée à `MAX_CHAIN`. */
  function* pushPlans(pusher, hex, zoc, moved, chain) {
    const group = friendsAt(pusher, hex, moved)
    const push = (to) => ({ ids: group.map((friend) => String(friend.id)), from: hex, to })
    // L'ami s'éloigne de SON hex (tout voisin convient) ; règles 2 et 3 d'un
    // pas de retraite, pour CHAQUE pion de la pile.
    const destinations = neighborsOf(hex.col, hex.row).filter((neighbor) =>
      hexOnMap(neighbor.col, neighbor.row)
      && !chain.has(keyOf(neighbor.col, neighbor.row))
      && !zoc.has(keyOf(neighbor.col, neighbor.row))
      && !hasEnemy(pusher, neighbor)
      && group.every((friend) => canEnterTerrain(friend, { c: neighbor.col, r: neighbor.row }, { c: hex.col, r: hex.row })))
    // Règle 4 : un hex libre si possible...
    const free = destinations.filter((neighbor) => friendsAt(pusher, neighbor, moved).length === 0)
    if (free.length > 0) {
      for (const neighbor of free) yield [push(neighbor)]
      return
    }
    // ... sinon on refoule à son tour l'ami qui occupe l'hex visé (depuis
    // SON hex) — dans la limite de `MAX_CHAIN` maillons.
    if (chain.size > MAX_CHAIN) return
    for (const neighbor of destinations) {
      const nextChain = new Set(chain).add(keyOf(neighbor.col, neighbor.row))
      for (const subPlan of pushPlans(pusher, neighbor, zoc, moved, nextChain)) yield [...subPlan, push(neighbor)]
    }
  }

  /** Les hex où `unit`, actuellement en `from`, peut faire UN pas de
   *  retraite — règles 1 à 3 de l'en-tête (la règle 4, "pas chez un ami si
   *  possible", est une PRÉFÉRENCE, appliquée plus tard par `candidates`).
   *  `zoc` = `enemyZocSet(unit)`, calculé une seule fois par l'appelant.
   *
   *  IMPORTANT : cette ZOC est recalculée à CHAQUE proposition de retraite,
   *  à partir des positions ACTUELLES des pions (jamais mise en cache d'un
   *  combat à l'autre). Une unité qui vient d'avancer après combat (cf.
   *  `stepAdvance`, qui déplace le pion réel de la carte) projette donc
   *  aussitôt sa ZOC depuis sa NOUVELLE position : elle peut interdire des
   *  retraites dans les combats suivants. Idem pour une unité qui vient de
   *  retraiter (résultat Br : l'attaquant retraite après le défenseur). */
  function legalSteps(task, unit, from, zoc) {
    const currentDistance = refDistance(task, from)
    return neighborsOf(from.col, from.row).filter((neighbor) =>
      hexOnMap(neighbor.col, neighbor.row) // pas de sortie de carte
      && refDistance(task, neighbor) > currentDistance // règle 1 : on s'éloigne
      && !zoc.has(keyOf(neighbor.col, neighbor.row)) // règle 2 : pas d'entrée en ZOC ennemie
      && !hasEnemy(unit, neighbor) // règle 2 (bis) : ni dans un hex ennemi
      && canEnterTerrain(unit, { c: neighbor.col, r: neighbor.row }, { c: from.col, r: from.row })) // règle 3
  }

  /** Réduction de retraite offerte par le module (cf. `retreatReduction`)
   *  à `unit` dans l'hex `h`, pour l'état `task` — ou `null`. */
  function reductionAt(task, unit, hex) {
    return retreatReduction?.(unit, { col: hex.col, row: hex.row }, task) ?? null
  }

  /** Les pas que `unit`, en `from`, peut faire MAINTENANT pour la retraite
   *  `task` tout en pouvant la finir ensuite (cf. `canComplete`), compte tenu
   *  des refoulements déjà simulés `moved`. Chaque pas : `{ hex, plan,
   *  moved }` — `plan` : refoulement d'amis nécessaire pour y entrer (`[]` si
   *  l'hex est libre, cf. `pushPlans`), `moved` : les positions simulées
   *  APRÈS ce refoulement. Règle 4 : les hex libres d'abord ; les hex amis
   *  (avec refoulement) seulement s'il n'y a aucun hex libre viable. Pour un
   *  hex ami, on garde le PREMIER refoulement qui laisse la retraite possible
   *  jusqu'au bout. `firstOnly` : on s'arrête au premier pas trouvé (simple
   *  question "reste-t-il une possibilité ?"). */
  function viableMoves(task, unit, from, zoc, moved, firstOnly = false) {
    const steps = legalSteps(task, unit, from, zoc)
    const occupied = (neighbor) => friendsAt(unit, neighbor, moved).length > 0
    const found = []
    for (const neighbor of steps.filter((step) => !occupied(step))) {
      const move = { hex: neighbor, plan: [], moved }
      if (canCompleteVia(task, unit, move, zoc)) {
        found.push(move)
        if (firstOnly) return found
      }
    }
    if (found.length > 0) return found
    for (const neighbor of steps.filter(occupied)) {
      const chain = new Set([keyOf(from.col, from.row), keyOf(neighbor.col, neighbor.row)])
      for (const plan of pushPlans(unit, neighbor, zoc, moved, chain)) {
        const move = { hex: neighbor, plan, moved: applyPlan(moved, plan) }
        if (canCompleteVia(task, unit, move, zoc)) {
          found.push(move)
          break // un refoulement qui marche suffit pour cet hex
        }
      }
      if (firstOnly && found.length > 0) return found
    }
    return found
  }

  /** Depuis `from`, `unit` peut-elle encore finir la retraite `task` (dont
   *  `done` pas sont faits) ? Exploration de TOUS les chemins possibles
   *  (profondeur ≤ 4, au plus 6 voisins par pas — quelques centaines de cas
   *  au pire), refoulements d'amis compris (positions simulées `moved`, cf.
   *  `viableMoves`). À chaque hex atteint, on essaie AUSSI la variante
   *  "réduction prise" (cf. `retreatReduction`) : une retraite qu'un hex du
   *  chemin permet de raccourcir n'est pas impossible. Les ENNEMIS ne bougent
   *  pas pendant la retraite : la ZOC est la même à chaque pas du chemin. */
  function canComplete(task, unit, from, zoc, moved) {
    if (task.done >= task.total) return true
    return viableMoves(task, unit, from, zoc, moved, true).length > 0
  }

  /** Après le pas `move` (cf. `viableMoves`) de `task`, la retraite peut-elle
   *  être finie ? */
  function canCompleteVia(task, unit, move, zoc) {
    const next = { ...task, done: task.done + 1 }
    if (canComplete(next, unit, move.hex, zoc, move.moved)) return true
    const red = reductionAt(next, unit, move.hex)
    return !!red && canComplete({ ...next, total: red.total }, unit, move.hex, zoc, move.moved)
  }

  /** Pas proposés (hex en rouge) pour le PROCHAIN pas de l'unité en tête de
   *  file (cf. `viableMoves`, à partir des positions réelles). Liste vide =
   *  retraite impossible. */
  function candidatesFor(task) {
    const unit = unitOf(task.id)
    if (!unit) return []
    return viableMoves(task, unit, { col: unit.col, row: unit.row }, enemyZocSet(unit), NO_MOVES)
  }

  const current = computed(() => queue.value[0] ?? null)
  const candidates = computed(() => (current.value ? candidatesFor(current.value) : []))

  // --- Refoulement au choix du joueur (cf. `pending`) --------------------------

  const sameHex = (hexA, hexB) => hexA.col === hexB.col && hexA.row === hexB.row

  /** Refoulements encore possibles pour le refoulement en attente : les
   *  plans (cf. `pushPlans`) qui libèrent `pending.hex`, RESPECTENT les
   *  choix déjà faits (`pending.chosen`) et laissent la retraite possible
   *  jusqu'au bout (cf. `canCompleteVia`). Chaque plan est rendu sous forme
   *  de CHAÎNE, dans l'ordre des choix : chain[0] = déplacement de l'ami de
   *  `pending.hex`, chain[1] = celui de l'ami qu'il refoule à son tour... */
  function pendingChains() {
    const task = current.value
    const unit = task && unitOf(task.id)
    if (!pending.value || !unit) return []
    const { hex, chosen } = pending.value
    const zoc = enemyZocSet(unit)
    const chains = []
    const chain = new Set([keyOf(unit.col, unit.row), keyOf(hex.col, hex.row)])
    for (const plan of pushPlans(unit, hex, zoc, NO_MOVES, chain)) {
      const chain = [...plan].reverse()
      if (!chosen.every((choice, index) => chain[index] && sameHex(chain[index].to, choice))) continue
      if (!canCompleteVia(task, unit, { hex, plan, moved: applyPlan(NO_MOVES, plan) }, zoc)) continue
      chains.push(chain)
    }
    return chains
  }

  /** Hex proposés pour le PROCHAIN choix du refoulement en attente : où peut
   *  aller l'ami qu'il faut déplacer maintenant (sans doublons). */
  const pushChoices = computed(() => {
    if (!pending.value) return []
    const depth = pending.value.chosen.length
    const choices = []
    for (const chain of pendingChains()) {
      const to = chain[depth]?.to
      if (to && !choices.some((choice) => sameHex(choice, to))) choices.push(to)
    }
    return choices
  })

  /** Hex rouges, cliquables : les pas de retraite de l'unité en tête de
   *  file, ou, pendant un refoulement en attente, les hex où l'ami à
   *  déplacer peut aller. */
  const candidateKeys = computed(() => new Set(pending.value
    ? pushChoices.value.map((hex) => keyOf(hex.col, hex.row))
    : candidates.value.map((move) => keyOf(move.hex.col, move.hex.row))))

  /** Une retraite est-elle en cours ? */
  const retreating = computed(() => queue.value.length > 0)

  /** Le résultat d'un combat est-il en cours d'application (retraite OU
   *  avance) ? HexMap.vue bloque alors toute autre action de jeu. */
  const active = computed(() => retreating.value || advancing.value)

  /** Infos de la retraite en cours, pour la modale — `null` s'il n'y en a
   *  pas (ou plus). */
  const info = computed(() => {
    const task = current.value
    if (!task) return null
    const unit = unitOf(task.id)
    // Refoulement en attente : l'ami (ou les amis) à déplacer MAINTENANT —
    // celui de l'hex visé, ou, plus loin dans la chaîne, celui de l'hex
    // choisi en dernier.
    let pushing = null
    if (pending.value && unit) {
      const { hex, chosen } = pending.value
      const blocked = chosen.length > 0 ? chosen[chosen.length - 1] : hex
      pushing = friendsAt(unit, blocked, NO_MOVES).map((friend) => friend.name).join(', ')
    }
    return {
      name: unit?.name ?? String(task.id),
      side: task.side,
      step: task.done + 1,
      total: task.total,
      waiting: queue.value.length - 1, // unités qui retraiteront ensuite
      // Seuls des hex AMIS sont proposés : y entrer refoulera leur occupant.
      pushes: candidates.value.length > 0 && candidates.value.every((move) => move.plan.length > 0),
      // Nom de l'ami dont le joueur choisit maintenant l'hex de refoulement
      // (cf. `pending`), ou `null`.
      pushing,
      // Réduction proposée DANS l'hex actuel (cf. `reduce`) : `{ total,
      // reason }` ou `null`. Pas pendant un refoulement en attente.
      reduction: unit && !pending.value ? reductionAt(task, unit, unit) : null,
    }
  })

  /** Applique à l'unité en tête de file la réduction de retraite offerte
   *  dans son hex actuel (cf. `retreatReduction`). `auto` : appliquée
   *  d'office faute de retraite possible (cf. `settle`), pour la note.
   *  Renvoie `true` si une réduction a été appliquée. */
  function applyReduction(auto = false) {
    const task = queue.value[0]
    const unit = task && unitOf(task.id)
    const red = unit && reductionAt(task, unit, unit)
    if (!red) return false
    queue.value = [{ ...task, total: red.total }, ...queue.value.slice(1)]
    notes.value = [...notes.value,
      t('retreatNotes.reduced', { unit: unit.name, from: task.total, to: red.total, reason: red.reason + (auto ? `, ${t('retreatNotes.noOtherWay')}` : '') })]
    return true
  }

  /** Bouton de la modale : le joueur propriétaire PREND la réduction de
   *  retraite offerte dans l'hex actuel de l'unité en cours. */
  function reduce() {
    if (pending.value || !applyReduction()) return false
    settle()
    return true
  }

  /** Fait avancer la file jusqu'à une unité qui a VRAIMENT un pas à faire :
   *  on retire de la tête les retraites terminées, celles d'unités qui ne
   *  sont plus sur la carte, et celles devenues impossibles — l'unité est
   *  alors éliminée. Évalué au moment où vient le tour de chaque unité (et
   *  pas au lancement) : pour un résultat Br, l'attaquant retraite APRÈS le
   *  défenseur, dont la nouvelle position change sa ZOC. */
  function settle() {
    while (queue.value.length > 0) {
      const task = queue.value[0]
      const unit = unitOf(task.id)
      if (unit && task.done < task.total) {
        if (candidatesFor(task).length > 0) return
        // Mieux vaut une retraite raccourcie qu'une élimination : le joueur
        // prendrait forcément la réduction — on l'applique et on réévalue.
        if (applyReduction(true)) continue
        notes.value = [...notes.value, t('retreatNotes.cannotRetreat', { unit: unit.name })]
        addPor(unit) // l'hex qu'elle occupait est libéré
        eliminateUnit(unit, t('retreatNotes.noRetreat'))
      } else if (unit) {
        notes.value = [...notes.value, task.total === 0
          ? t('retreatNotes.stays', { unit: unit.name })
          : t('retreatNotes.retreated', { unit: unit.name, n: task.total })]
      }
      queue.value = queue.value.slice(1)
    }
    // Plus aucune retraite : place à l'avance après combat (s'il y a
    // quelque chose à faire, cf. `settleAdvance`).
    advancing.value = true
    settleAdvance()
  }

  /** Applique le résultat `code` d'un combat qui vient d'être résolu, selon
   *  l'effet que le module lui donne (cf. `resultEffect`). `attackers`/
   *  `defenders` : les pions du combat — attaquants AU CONTACT seulement :
   *  une artillerie qui tire à distance n'est jamais affectée par le
   *  résultat, ni ne compte parmi les vainqueurs qui avancent (cf.
   *  lib/useArtillery.js) ; `targetHexes` : ses hex cibles ({ col, row }). Les éliminations sont immédiates ; les retraites sont
   *  mises en file (défenseurs d'abord) et se jouent ensuite au clic (cf.
   *  `step`). */
  function start(code, attackers, defenders, targetHexes) {
    clear()
    const effect = resultEffect(code) ?? {}
    const defenderHexes = effect.retreat?.defenders ?? 0
    const attackerHexes = effect.retreat?.attackers ?? 0
    const hitsDefenders = effect.eliminate === 'defenders' || defenderHexes > 0
    const hitsAttackers = effect.eliminate === 'attackers' || attackerHexes > 0
    // Vainqueurs (cf. l'en-tête) : le camp épargné, qui pourra avancer ensuite.
    const winners = !advanceAfterCombat ? []
      : hitsDefenders && !hitsAttackers ? attackers
        : hitsAttackers && !hitsDefenders ? defenders
          : []
    victorIds.value = new Set(winners.map((unit) => String(unit.id)))
    const defTasks = (hexCount) => defenders.map((defender) => ({
      id: defender.id, side: 'defender', initial: hexCount, total: hexCount, done: 0, refHexes: [{ col: defender.col, row: defender.row }],
    }))
    const atkTasks = (hexCount) => attackers.map((attacker) => ({
      id: attacker.id, side: 'attacker', initial: hexCount, total: hexCount, done: 0, refHexes: targetHexes.map((targetHex) => ({ col: targetHex.col, row: targetHex.row })),
    }))
    const eliminated = effect.eliminate === 'defenders' ? defenders : effect.eliminate === 'attackers' ? attackers : []
    for (const unit of eliminated) {
      notes.value = [...notes.value, t('log.eliminated', { unit: unit.name })]
      addPor(unit) // l'hex qu'elle occupait est libéré
      eliminateUnit(unit, t('retreatNotes.result', { code }))
    }
    queue.value = [...(defenderHexes > 0 ? defTasks(defenderHexes) : []), ...(attackerHexes > 0 ? atkTasks(attackerHexes) : [])]
    settle()
  }

  /** Clic sur l'hex `h` ({ col, row }) pendant une retraite (hex rouge) :
   *   - hors refoulement : l'unité en cours y fait un pas de retraite — si
   *     l'hex est occupé par un ami, on passe d'abord au choix de son
   *     refoulement (cf. `pending`) ;
   *   - pendant un refoulement en attente : c'est l'hex choisi pour l'ami à
   *     déplacer.
   *  Renvoie `true` si le clic a été utilisé. */
  function step(hex) {
    const task = current.value
    if (!task) return false
    if (pending.value) {
      if (!pushChoices.value.some((choice) => sameHex(choice, hex))) return false
      pending.value = { ...pending.value, chosen: [...pending.value.chosen, { col: hex.col, row: hex.row }] }
      resolvePending()
      return true
    }
    const move = candidates.value.find((candidate) => sameHex(candidate.hex, hex))
    if (!move) return false
    if (move.plan.length === 0) {
      retreatInto(move.hex, [])
    } else {
      pending.value = { hex: { col: move.hex.col, row: move.hex.row }, chosen: [] }
      resolvePending()
    }
    return true
  }

  /** Fait progresser le refoulement en attente : dès que les choix faits
   *  forment une chaîne COMPLÈTE (le dernier ami refoulé arrive dans un hex
   *  libre), on l'exécute ; tant qu'il ne reste qu'UN choix possible, on le
   *  fait d'office ; sinon on attend le clic du joueur (cf. `pushChoices`). */
  function resolvePending() {
    while (pending.value) {
      const chains = pendingChains()
      const depth = pending.value.chosen.length
      const complete = chains.find((chain) => chain.length === depth)
      if (complete || chains.length === 0) {
        const { hex } = pending.value
        pending.value = null
        // Aucune chaîne (ne devrait pas arriver : le pas n'était proposé que
        // s'il en existait une) : on revient simplement au choix du pas.
        if (complete) retreatInto(hex, [...complete].reverse())
        return
      }
      const choices = pushChoices.value
      if (choices.length !== 1) return
      pending.value = { ...pending.value, chosen: [...pending.value.chosen, choices[0]] }
    }
  }

  /** Bouton de la modale : abandonne le refoulement en attente, pour choisir
   *  un autre pas de retraite. */
  function cancelPush() {
    pending.value = null
  }

  /** Pas de retraite de l'unité en tête de file vers `hex`, après avoir
   *  refoulé les amis selon `plan` (cf. `pushPlans` : bout de la chaîne
   *  d'abord, `[]` si l'hex est libre). */
  function retreatInto(hex, plan) {
    const task = current.value
    const unit = task && unitOf(task.id)
    if (!unit) return
    // Refoulement des amis qui occupent l'hex (cf. l'en-tête) : AVANT que
    // l'unité y entre, bout de la chaîne d'abord.
    for (const push of plan) {
      for (const id of push.ids) {
        const friend = unitOf(id)
        if (!friend) continue
        const silenced = isArtillery(friend)
        notes.value = [...notes.value,
          t('retreatNotes.pushed', { unit: friend.name, by: unit.name }) + (silenced ? ` ${t('log.noFire')}` : '')]
        displaceUnit(friend, push.to, { by: unit, noFire: silenced })
      }
    }
    // Nouvel objet (et nouvelle file) plutôt qu'une mutation en place : les
    // computed qui en dépendent (`candidates`, `info`) sont ainsi recalculés.
    const next = { ...task, done: task.done + 1 }
    queue.value = [next, ...queue.value.slice(1)]
    addPor(unit) // l'hex qu'elle QUITTE entre dans le chemin de retraite
    moveUnit(unit, hex, { done: next.done, total: next.total })
    settle()
  }

  // --- Avance après combat ----------------------------------------------------

  /** `h` ({ col, row }) contient-il une unité, quelle qu'elle soit ? (Pas
   *  d'empilement pendant l'avance.) */
  const isOccupied = (hex) => counters.value.some((otherCounter) => isFighter(otherCounter) && otherCounter.col === hex.col && otherCounter.row === hex.row)

  /** `unit` peut-elle encore avancer ? Victorieuse, sur la carte, avance
   *  pas encore terminée. */
  function canStillAdvance(unit) {
    return !!unit && victorIds.value.has(String(unit.id)) && !doneIds.value.has(String(unit.id))
  }

  /** Hex où `unit` peut faire un pas d'avance : voisins de sa position, dans
   *  le POR, libres de toute unité, pas déjà visités par elle. Aucune
   *  vérification de ZOC (cf. l'en-tête). */
  function advanceStepsFor(unit) {
    if (!canStillAdvance(unit)) return []
    const seen = visited.value.get(String(unit.id))
    return neighborsOf(unit.col, unit.row).filter((neighbor) => {
      const key = keyOf(neighbor.col, neighbor.row)
      return por.value.has(key) && !seen?.has(key) && !isOccupied(neighbor)
    })
  }

  /** Unités victorieuses qui ont au moins un pas d'avance possible. */
  const advancers = computed(() => (advancing.value ? counters.value.filter((unit) => advanceStepsFor(unit).length > 0) : []))

  const advancer = computed(() => (advancerId.value == null ? null : unitOf(advancerId.value)))

  /** Hex proposés (vert vif) pour le prochain pas de l'unité choisie. */
  const advanceCandidates = computed(() => (advancing.value && advancer.value ? advanceStepsFor(advancer.value) : []))
  const advanceKeys = computed(() => new Set(advanceCandidates.value.map((hex) => keyOf(hex.col, hex.row))))

  /** L'unité choisie a-t-elle déjà avancé d'au moins un hex ? */
  const hasAdvanced = (id) => (visited.value.get(String(id))?.size ?? 0) > 1

  /** Termine l'avance de l'unité choisie (si elle a bougé : elle ne pourra
   *  plus la reprendre) et la désélectionne. */
  function releaseAdvancer() {
    const id = advancerId.value
    if (id != null && hasAdvanced(id)) doneIds.value = new Set(doneIds.value).add(String(id))
    advancerId.value = null
  }

  /** Ferme l'avance dès que plus aucune unité ne peut avancer — sauf si
   *  l'unité choisie peut encore bouger. */
  function settleAdvance() {
    if (!advancing.value) return
    if (advanceCandidates.value.length > 0) return
    releaseAdvancer()
    if (advancers.value.length === 0) endAdvance()
  }

  /** Clic sur l'unité `unit` pendant l'avance : la choisit (ou la
   *  désélectionne si elle l'était déjà). Renvoie `true` si le clic a servi. */
  function selectAdvancer(unit) {
    if (!advancing.value || !unit) return false
    if (String(advancerId.value) === String(unit.id)) { releaseAdvancer(); settleAdvance(); return true }
    if (advanceStepsFor(unit).length === 0) return false
    releaseAdvancer()
    advancerId.value = unit.id
    // Point de départ de son avance : "visité", pour ne jamais y revenir.
    if (!visited.value.has(String(unit.id))) {
      visited.value = new Map(visited.value).set(String(unit.id), new Set([keyOf(unit.col, unit.row)]))
    }
    return true
  }

  /** Clic sur l'hex `h` ({ col, row }) pendant l'avance : l'unité choisie y
   *  avance d'un hex s'il fait partie des hex proposés. */
  function stepAdvance(hex) {
    const unit = advancer.value
    const key = keyOf(hex.col, hex.row)
    if (!unit || !advanceKeys.value.has(key)) return false
    const id = String(unit.id)
    visited.value = new Map(visited.value).set(id, new Set(visited.value.get(id)).add(key))
    advanceUnit(unit, hex)
    settleAdvance()
    return true
  }

  /** Fin de l'avance après combat (bouton de la modale, ou plus rien à
   *  faire). */
  function endAdvance() {
    const moved = [...visited.value.entries()].filter(([, visitedHexes]) => visitedHexes.size > 1)
    for (const [id, visitedHexes] of moved) {
      const unit = unitOf(id)
      if (unit) notes.value = [...notes.value, t('retreatNotes.advanced', { unit: unit.name, n: visitedHexes.size - 1 })]
    }
    advancing.value = false
    advancerId.value = null
    por.value = new Set()
  }

  /** Abandonne tout (nouveau combat, changement de phase, rechargement d'un
   *  journal). */
  function clear() {
    queue.value = []
    notes.value = []
    por.value = new Set()
    victorIds.value = new Set()
    advancing.value = false
    advancerId.value = null
    visited.value = new Map()
    doneIds.value = new Set()
    pending.value = null
  }

  watch(phase, clear, { flush: 'sync' })

  /** L'hex `h` ({ c, r }, format des hex de HexMap.vue) est-il proposé
   *  (rouge, cliquable) — pas de retraite, ou hex de refoulement d'un ami ? */
  const isRetreatHex = (hex) => candidateKeys.value.has(keyOf(hex.c, hex.r))

  /** L'hex `h` est-il celui de l'unité en train de retraiter ? */
  const isRetreatingHex = (hex) => {
    const unit = current.value && unitOf(current.value.id)
    return !!unit && unit.col === hex.c && unit.row === hex.r
  }

  /** Surlignages de l'avance (format { c, r } des hex de HexMap.vue) :
   *  chemin de retraite (vert), hex où l'unité choisie peut avancer (vert
   *  vif, cliquables), hex des unités qui peuvent avancer (contour vert). */
  const isPorHex = (hex) => por.value.has(keyOf(hex.c, hex.r))
  const isAdvanceHex = (hex) => advanceKeys.value.has(keyOf(hex.c, hex.r))
  const isAdvancerHex = (hex) => advancers.value.some((unit) => unit.col === hex.c && unit.row === hex.r)
    || (!!advancer.value && advancer.value.col === hex.c && advancer.value.row === hex.r)

  /** Infos de l'avance pour la modale — `null` hors phase d'avance. */
  const advanceInfo = computed(() => (advancing.value
    ? { name: advancer.value?.name ?? null, count: advancers.value.length }
    : null))

  return {
    start, step, reduce, cancelPush, clear, active, retreating, info, notes, isRetreatHex, isRetreatingHex,
    advancing, advanceInfo, selectAdvancer, stepAdvance, endAdvance, isPorHex, isAdvanceHex, isAdvancerHex,
  }
}
