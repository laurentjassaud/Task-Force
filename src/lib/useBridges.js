// ═══════════════════════════════════════════════════════════════════════════
// useBridges — SORT DES PONTS du mode "Assisté" : démolition et réparation
// ═══════════════════════════════════════════════════════════════════════════
//
// Certains ponts d'une carte peuvent SAUTER en cours de partie, et certains
// de ceux-là peuvent ensuite être REMIS EN ÉTAT. Le module déclare les deux
// (`rules.bridgeDemolition` et `rules.bridgeRepair`, cf. lib/rules.js) ; ce
// fichier porte les deux règles et l'état qu'elles partagent, et lib/edges.js
// le versant "nature d'arête" (ce que laisse un pont démoli).
// Sans ces déclarations, tout ici reste INERTE : aucune occasion ne s'ouvre
// et `isDemolished` répond toujours faux — un module qui n'en a pas joue donc
// exactement comme avant.
//
// ─── LA RÈGLE (Arnhem) ───────────────────────────────────────────────────────
// « Tous les ponts de canal et de chemin de fer de la carte peuvent être
// détruits dès qu'une unité alliée occupe un hex que borde l'un d'eux, quelle
// que soit la phase et quel que soit le tour. C'est le joueur allemand qui
// décide, en validant une modale ; cela se fait IMMÉDIATEMENT, par un jet de
// dé : sur 1 ou 2 le pont est détruit. S'il ne souhaite pas tenter la
// destruction, ou si le jet ne détruit pas le pont, il ne pourra plus le
// faire : le pont restera intact pour tout le reste de la partie. »
//
// ─── LA RÈGLE DE RÉPARATION (Arnhem) ─────────────────────────────────────────
// « Le génie allié peut réparer les ponts de canal détruits. S'il se trouve
// dans un hex que borde un pont de canal détruit ET qu'il passe TOUT le tour
// allemand hors des zones de contrôle allemandes, une modale lui est
// présentée pendant la phase allemande de Fin de tour pour confirmer la
// réparation d'un pont. Un pont réparé vaut un pont jamais détruit — et il ne
// peut plus être démoli. »
//
// La réparation ramène donc le pont à l'état SCELLÉ ci-dessous : franchissable
// comme avant, et hors d'atteinte d'une nouvelle démolition (rond VERT).
//
// Trois états, donc, pour chaque pont démolissable :
//   - EN SURSIS : rien ne s'est encore passé. Tant qu'aucune unité du camp
//     `trigger` ne borde le pont, il n'y a pas d'occasion ; dès qu'il y en a
//     une, l'occasion s'ouvre et doit être tranchée (cf. `opportunities`) ;
//   - DÉTRUIT (`demolishedKeys`) : l'arête ne vaut plus que par l'obstacle
//     que le pont franchissait (cf. lib/edges.js::revealedKind) — rond ROUGE ;
//   - SCELLÉ (`sealedKeys`) : l'occasion a été tranchée sans destruction (dé
//     raté ou renoncement), OU le pont a été réparé ; il tient pour le reste
//     de la partie et ne sera plus jamais proposé — rond VERT.
// Les ponts en sursis ne portent aucune marque : la carte n'a pas à se
// couvrir de ronds pour quinze ponts dont rien n'est encore joué.
//
// ─── POURQUOI UN COMPUTED, ET PAS UN CROCHET SUR CHAQUE DÉPLACEMENT ─────────
// L'occasion naît « dès qu'une unité alliée DEVIENT ou EST dans un hex » que
// borde un pont : un mouvement, mais aussi une entrée en jeu, un largage, une
// retraite, un refoulement, une avance après combat, le déploiement initial,
// ou le déplacement d'un adversaire reçu par le réseau. Plutôt que
// d'instrumenter ces huit points d'appel (et d'en oublier un),
// `opportunities` DÉDUIT la liste des occasions ouvertes de l'état de la
// carte : elle se recalcule d'elle-même dès qu'un pion bouge, d'où qu'il
// vienne.
//
// ─── « TOUT LE TOUR HORS ZOC » : COMMENT ON LE SAIT ──────────────────────────
// Le réparateur, lui, ne bouge pas pendant le tour adverse — ce sont les
// ennemis qui viennent à lui, et qui peuvent tout aussi bien repartir. Une
// vérification faite à la seule Fin de tour manquerait donc l'ennemi qui est
// passé à côté au milieu de la phase de Mouvement. `watchUndisturbed` suit
// l'état de la carte pendant tout le pas du camp surveillé et retient, dès
// qu'elle se produit, l'entrée d'un réparateur en ZOC (cf. `disturbedIds`) ;
// la Fin de tour n'a plus qu'à lire cette mémoire, remise à zéro à chaque
// nouveau pas.
//
// ─── CE QUI EST JOURNALISÉ ───────────────────────────────────────────────────
// Chaque décision donne une entrée de journal — `demolition` (l'arête, le dé
// s'il a été lancé, si le pont est tombé) ou `repair` (l'arête, l'unité qui
// l'a relevé), cf. HexMap.vue. `applyReplay` les rejoue telles quelles : elles
// font autorité, jamais un nouveau tirage, sans quoi un journal rechargé
// raconterait une autre partie.
//
// Paramètres reçus :
//   - `assisted` : ref/computed booléen — hors mode Assisté, aucune règle.
//   - `terrain` : `module.terrain` — pour retrouver les arêtes des couches
//     démolissables (cf. lib/edges.js).
//   - `demolition` : `rules.bridgeDemolition` résolu, ou `null`.
//   - `repair` : `rules.bridgeRepair` résolu, ou `null`.
//   - `counters` : ref des pions posés sur la carte.
//   - `sideOf` : `(counter) => clé de camp | null` (cf. HexMap.vue::
//     sideOfCounter) — pour reconnaître le camp `trigger`.
//   - `isFighter` : cf. lib/units.js — ni marqueur, ni pion de soutien : une
//     zone de largage posée près d'un pont n'ouvre aucune occasion.
//   - `enemyZocSet` : `(counter) => Set("col,row")` (cf. lib/useAssisted.js)
//     — les hex sous ZOC ennemie, pour la condition « hors ZOC » de la
//     réparation. Passée en LAMBDA : HexMap.vue crée ce composable avant
//     useAssisted(), d'où elle vient.
//   - `activeSide` : ref/computed de la clé du camp qui a la main (cf.
//     HexMap.vue::turnInfo) — le pas surveillé est celui du camp
//     `undisturbedSide`.
//   - `step` : ref/computed du pas courant de la piste de tour (un par camp
//     et par tour, cf. TurnTracker.vue) — change de pas, et la mémoire du
//     « tour passé tranquille » repart de zéro.
import { computed, ref } from 'vue'
import { hexId, parseHexId } from './calibration.js'
import { resolveEdges } from './edges.js'

/** Les deux sens d'une arête "AAAA-BBBB" — le JSON ne la liste qu'une fois,
 *  dans un ordre arbitraire, et un appelant peut nommer l'un ou l'autre. */
function bothWays(edgeKey) {
  const [hexA, hexB] = String(edgeKey).split('-')
  return [hexA + '-' + hexB, hexB + '-' + hexA]
}

export function useBridges({
  assisted, terrain, demolition = null, repair = null, counters,
  sideOf = () => null, isFighter = () => true,
  enemyZocSet = () => new Set(), activeSide = { value: null }, step = { value: 0 },
}) {
  // Interprète des arêtes, reconstruit ICI plutôt que reçu de
  // lib/useAssisted.js : c'est un objet PUR (il ne dépend que de `terrain`,
  // qui ne change pas en cours de partie), et l'ordre d'appel l'impose —
  // HexMap.vue crée ce composable AVANT useAssisted(), à qui il fournit
  // justement `isDemolished`.
  const edges = resolveEdges(terrain, demolition)

  // Ponts DÉTRUITS et ponts dont le sort est SCELLÉ (cf. l'en-tête) — clés
  // d'arête dans les deux sens, pour être interrogeables quel que soit le
  // sens dans lequel l'appelant nomme l'arête.
  const demolishedKeys = ref(new Set())
  const sealedKeys = ref(new Set())

  /** La règle s'applique-t-elle en ce moment ? */
  const active = computed(() => !!assisted.value && !!demolition)

  /** Ce pont a-t-il sauté ? C'est LA question que pose le moteur à chaque
   *  lecture d'arête (cf. lib/useAssisted.js, paramètre `isDemolished`).
   *  Répond faux hors mode Assisté : en mode Libre, aucune règle d'arête
   *  n'est appliquée de toute façon, et une partie repassée en mode Libre ne
   *  doit pas s'y retrouver avec des ponts coupés. */
  function isDemolished(edgeKey) {
    return active.value && demolishedKeys.value.has(edgeKey)
  }

  /** Le sort de ce pont est-il déjà réglé (détruit ou scellé) ? */
  function isSettled(edgeKey) {
    return demolishedKeys.value.has(edgeKey) || sealedKeys.value.has(edgeKey)
  }

  /** Une unité du camp `trigger` occupe-t-elle l'hex `hexKey` ("CCRR") ?
   *  Sans `trigger` déclaré, n'importe quelle unité qui n'est pas du camp
   *  décideur fait l'affaire. */
  function triggeredAt(hexKey) {
    const { col, row } = parseHexId(hexKey)
    return counters.value.some((counter) => isFighter(counter) && counter.col === col && counter.row === row
      && (demolition.trigger ? sideOf(counter) === demolition.trigger : sideOf(counter) !== demolition.by))
  }

  /** OCCASIONS OUVERTES : les ponts démolissables dont le sort n'est pas
   *  encore réglé et que borde au moins une unité du camp `trigger` (cf.
   *  l'en-tête : déduit de la carte, jamais accroché aux déplacements).
   *  Chaque entrée : `{ key, layer, label, hexes }` — `hexes` : les deux hex
   *  imprimés que le pont relie, pour la modale et le journal. */
  const opportunities = computed(() => {
    if (!active.value) return []
    return edges.demolishableEdges
      .filter((edge) => !isSettled(edge.key) && (triggeredAt(edge.from) || triggeredAt(edge.to)))
      .map((edge) => ({
        key: edge.key,
        layer: edge.layer,
        label: demolition.labels?.[edge.layer] ?? 'pont',
        hexes: [edge.from, edge.to],
      }))
  })

  /** Le pont `edgeKey` tel que l'attend la modale — `{ key, layer, label,
   *  hexes }` — quel que soit le sens dans lequel l'arête est nommée, et
   *  qu'une occasion soit ouverte sur lui ou non. Sert EN LIGNE : le camp
   *  décideur reçoit une clé d'arête de l'autre écran (cf. HexMap.vue,
   *  section "Démolition des ponts") et doit pouvoir en parler sans dépendre
   *  de sa propre lecture des occasions. `null` si l'arête n'est pas un pont
   *  démolissable de ce module. */
  function bridgeAt(edgeKey) {
    const [forward, backward] = bothWays(edgeKey)
    const edge = edges.demolishableEdges.find((candidate) => candidate.key === forward || candidate.key === backward)
    if (!edge) return null
    return {
      key: edge.key,
      layer: edge.layer,
      label: demolition.labels?.[edge.layer] ?? 'pont',
      hexes: [edge.from, edge.to],
    }
  }

  /** L'occasion à trancher MAINTENANT — la première ouverte, `null` s'il n'y
   *  en a aucune. Les autres suivront d'elles-mêmes : chaque décision retire
   *  son pont de la liste (cf. `settle`), et la suivante prend sa place. */
  const current = computed(() => opportunities.value[0] ?? null)

  /** Enregistre le sort d'un pont — le seul chemin par lequel l'état change,
   *  en jeu comme au rejeu du journal. `destroyed` : le pont est tombé. */
  function settle(edgeKey, destroyed) {
    const keys = bothWays(edgeKey)
    const target = destroyed ? demolishedKeys : sealedKeys
    target.value = new Set([...target.value, ...keys])
  }

  /** Le camp décideur TENTE la destruction du pont `edgeKey` : un dé est
   *  lancé, le pont tombe si sa face est dans `destroyOn` (1 ou 2 à Arnhem).
   *  Dans les deux cas le sort du pont est réglé — réussi, il est détruit ;
   *  raté, il tient pour le reste de la partie.
   *  @param die face imposée (rejeu du journal, ou réponse reçue de l'autre
   *    écran) ; tirée ici quand elle n'est pas fournie.
   *  @returns `{ die, destroyed }`, ou `null` si la règle ne s'applique pas. */
  function attempt(edgeKey, die = null) {
    if (!active.value) return null
    const faces = demolition.faces ?? 6
    const rolled = Number.isInteger(die) ? die : Math.floor(Math.random() * faces) + 1
    const destroyed = demolition.destroyOn.includes(rolled)
    settle(edgeKey, destroyed)
    return { die: rolled, destroyed }
  }

  /** Le camp décideur RENONCE : le pont tient pour le reste de la partie
   *  (aucun dé n'est lancé, et il ne sera plus proposé). */
  function decline(edgeKey) {
    if (!active.value) return false
    settle(edgeKey, false)
    return true
  }

  /** Rejeu d'une entrée `demolition` du journal (cf. HexMap.vue) : c'est
   *  ELLE qui fait autorité, jamais un nouveau tirage. */
  function applyReplay({ edge, destroyed } = {}) {
    if (!edge) return
    settle(edge, !!destroyed)
  }

  // --- Réparation (cf. l'en-tête) --------------------------------------------

  /** La règle de réparation s'applique-t-elle dans ce module ? */
  const repairActive = computed(() => !!assisted.value && !!repair)

  // Pas de la piste de tour actuellement SURVEILLÉ (cf. l'en-tête), et
  // réparateurs qui y sont entrés en ZOC ennemie — ils ne pourront rien
  // relever à la Fin de ce tour-là. Repart de zéro à chaque nouveau pas.
  const watchedStep = ref(null)
  const disturbedIds = ref(new Set())

  // Réparateurs ayant DÉJÀ été employés (ou écartés) pendant le pas courant :
  // un pont par réparateur et par tour, et une occasion refusée ne revient pas
  // se proposer en boucle. Remis à zéro avec `disturbedIds`.
  const spentRepairerIds = ref(new Set())

  /** Les unités capables de réparer : celles du camp `by` dont le type figure
   *  dans `unitTypes` (le génie allié à Arnhem). */
  const repairers = computed(() => {
    if (!repairActive.value) return []
    return counters.value.filter((counter) => isFighter(counter)
      && sideOf(counter) === repair.by && repair.unitTypes.includes(counter.type))
  })

  /** Suit le pas surveillé et note les réparateurs dérangés (cf. l'en-tête).
   *  À appeler dès que la carte change — HexMap.vue le branche sur un
   *  `watchEffect` créé AU MONTAGE, parce que `enemyZocSet` lui vient d'un
   *  composable construit après celui-ci. */
  function watchUndisturbed() {
    if (!repairActive.value || !repair.undisturbedSide) return
    if (activeSide.value !== repair.undisturbedSide) return
    // Nouveau pas du camp surveillé : la mémoire du tour précédent ne vaut
    // plus rien.
    if (watchedStep.value !== step.value) {
      watchedStep.value = step.value
      disturbedIds.value = new Set()
      spentRepairerIds.value = new Set()
    }
    const disturbed = new Set(disturbedIds.value)
    for (const unit of repairers.value) {
      if (enemyZocSet(unit).has(unit.col + ',' + unit.row)) disturbed.add(String(unit.id))
    }
    if (disturbed.size !== disturbedIds.value.size) disturbedIds.value = disturbed
  }

  /** Ce réparateur a-t-il passé le tour surveillé tranquille — jamais en ZOC
   *  ennemie, et pas déjà employé ce tour-ci ? Sans camp surveillé déclaré, la
   *  condition tombe et seule la présence près du pont compte. */
  function isUndisturbed(unit) {
    const id = String(unit.id)
    if (spentRepairerIds.value.has(id)) return false
    if (!repair.undisturbedSide) return true
    // Le pas surveillé doit être CELUI-CI : une mémoire qui date d'un autre
    // pas ne prouve rien (page rechargée en pleine Fin de tour, par exemple).
    if (watchedStep.value !== step.value) return false
    return !disturbedIds.value.has(id)
  }

  /** OCCASIONS DE RÉPARATION ouvertes : pour chaque réparateur resté
   *  tranquille, les ponts DÉMOLIS d'une couche réparable que borde son hex.
   *  Chaque entrée : `{ key, layer, label, hexes, unit }` — `unit`, le pion
   *  qui relèverait ce pont, pour la modale et le journal.
   *
   *  C'est l'APPELANT qui décide QUAND les présenter (à Arnhem, pendant la
   *  phase de Fin de tour, cf. HexMap.vue) : ce composable ne connaît pas les
   *  phases. */
  const repairs = computed(() => {
    if (!repairActive.value) return []
    const list = []
    for (const unit of repairers.value) {
      if (!isUndisturbed(unit)) continue
      const here = hexId(unit.col + 1, unit.row)
      for (const edge of edges.demolishableEdges) {
        if (!repair.layers.includes(edge.layer)) continue
        if (edge.from !== here && edge.to !== here) continue
        if (!demolishedKeys.value.has(edge.key)) continue
        list.push({
          key: edge.key,
          layer: edge.layer,
          label: demolition?.labels?.[edge.layer] ?? 'pont',
          hexes: [edge.from, edge.to],
          unit: { id: unit.id, name: unit.name },
        })
      }
    }
    return list
  })

  /** L'occasion de réparation à présenter MAINTENANT, `null` s'il n'y en a
   *  aucune (cf. `repairs` : c'est l'appelant qui choisit le moment). */
  const currentRepair = computed(() => repairs.value[0] ?? null)

  /** Le pont `edgeKey` est REMIS EN ÉTAT : il redevient franchissable, et
   *  passe du même coup hors d'atteinte d'une nouvelle démolition (cf.
   *  `settle` : l'état SCELLÉ est exactement celui d'un pont qu'on ne peut
   *  plus faire sauter). `unitId` : le réparateur, qui a fini son tour.
   *  @returns `true` si la réparation a été enregistrée. */
  function repairBridge(edgeKey, unitId = null) {
    if (!repairActive.value) return false
    const keys = bothWays(edgeKey)
    const stillDown = new Set(demolishedKeys.value)
    for (const key of keys) stillDown.delete(key)
    demolishedKeys.value = stillDown
    settle(edgeKey, false)
    if (unitId != null) spentRepairerIds.value = new Set(spentRepairerIds.value).add(String(unitId))
    return true
  }

  /** Le camp réparateur RENONCE pour ce tour-ci : son unité ne relèvera rien
   *  avant le prochain (le pont, lui, reste démoli et réparable plus tard —
   *  c'est toute la différence avec un renoncement à démolir). */
  function declineRepair(unitId) {
    if (unitId == null) return false
    spentRepairerIds.value = new Set(spentRepairerIds.value).add(String(unitId))
    return true
  }

  /** Marques à peindre sur la carte (cf. HexMap.vue) : un rond par pont dont
   *  le sort est réglé — ROUGE s'il est détruit, VERT s'il tient. Les ponts
   *  en sursis n'en portent aucune (cf. l'en-tête). Chaque entrée :
   *  `{ key, destroyed, from, to }`, `from`/`to` étant les deux hex
   *  (`{ col, row }`, col 0-based) dont il faut prendre le milieu. */
  const marks = computed(() => {
    if (!active.value) return []
    return edges.demolishableEdges
      .filter((edge) => isSettled(edge.key))
      .map((edge) => ({
        key: edge.key,
        destroyed: demolishedKeys.value.has(edge.key),
        from: parseHexId(edge.from),
        to: parseHexId(edge.to),
      }))
  })

  /** Rejeu d'une entrée `repair` du journal (cf. HexMap.vue) : le pont est
   *  remis en état exactement comme il l'a été dans la partie d'origine. */
  function applyRepairReplay({ edge, unitId = null } = {}) {
    if (!edge) return
    repairBridge(edge, unitId)
  }

  /** Rechargement d'un journal : on repart de zéro (cf. HexMap.vue::
   *  resetBoardForReplay). */
  function reset() {
    demolishedKeys.value = new Set()
    sealedKeys.value = new Set()
    watchedStep.value = null
    disturbedIds.value = new Set()
    spentRepairerIds.value = new Set()
  }

  return {
    active, isDemolished, opportunities, current, bridgeAt, attempt, decline, applyReplay, marks, reset,
    repairActive, repairs, currentRepair, repairBridge, declineRepair, watchUndisturbed, applyRepairReplay,
  }
}
