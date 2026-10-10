// ═══════════════════════════════════════════════════════════════════════════
// useArnhem — règles PARTICULIÈRES au module "arnhem"
// ═══════════════════════════════════════════════════════════════════════════
//
// POURQUOI CE FICHIER ?
// Le moteur (HexMap.vue + lib/useAssisted.js + lib/useCombat.js +
// lib/useRetreat.js) est GÉNÉRIQUE : il ne connaît que ce que le JSON d'un
// module lui déclare (carte, pions, terrain, camps, pistes de tour...).
// Mais chaque boîte de jeu a en plus des règles qui ne valent QUE pour elle
// et qu'aucun champ du JSON ne sait exprimer (ex. "au coup d'envoi, seules
// les zones de largage alliées sont posées sur la carte"). Ces règles-là
// vivent ICI, dans un fichier par module, et non éparpillées en `if` dans le
// moteur.
//
// QUAND SONT-ELLES APPLIQUÉES ?
// UNIQUEMENT quand la partie en cours utilise le module "arnhem" (cf.
// `ARNHEM_MODULE_ID` ci-dessous, comparé au `moduleId` reçu — celui de
// public/modules/index.json, passé à HexMap.vue par DemoPlay.vue et
// RoomLobby.vue). Sur tout autre module, le composable reste INERTE :
// `active` vaut false et CHAQUE règle renvoie `null`.
//
// LA CONVENTION `null` = "PAS DE RÈGLE PARTICULIÈRE"
// C'est le point clé de ce fichier. Une règle ne renvoie jamais un booléen
// "par défaut" : elle renvoie `null` quand elle n'a rien à dire, et
// l'appelant retombe alors sur le comportement générique du moteur :
//
//     const special = arnhem.autoPlacesAtLoad(c)   // true | false | null
//     if (special !== null) return special         // Arnhem tranche
//     ...suite = règle générique...                // sinon, moteur générique
//
// Un simple `false` ne conviendrait pas : il voudrait dire "Arnhem interdit",
// ce qui est une DÉCISION, alors que `null` veut dire "Arnhem ne se prononce
// pas". Sans ce troisième état, on ne pourrait pas distinguer les deux, et
// le composable inerte (autre module) imposerait ses réponses à tout le
// monde.
//
// AJOUTER UNE RÈGLE
//   1. écrire la fonction dans le `return` ci-dessous, en la faisant sortir
//      `null` dès que `!active.value` (ou dès que le cas ne la concerne pas) ;
//   2. l'appeler depuis le moteur au bon endroit, avec le motif `if (x !==
//      null) return x` ci-dessus ;
//   3. documenter ici D'OÙ vient la règle (livret de règles / carte / chart),
//      pour qu'on puisse la vérifier sans rouvrir la boîte.
// Pour un AUTRE module (hurtgen, bastogne...), on crée un `useHurtgen.js` sur
// ce même patron plutôt que d'élargir celui-ci.
//
// PARAMÈTRES
//   - `moduleId` : ref/computed OU chaîne simple — identifiant court du
//     module joué (ex. "arnhem"). Accepté sous les deux formes (cf. `unref`)
//     parce que HexMap.vue le reçoit en prop (donc `toRef(props,
//     'moduleId')`), mais qu'un appelant hors composant peut n'avoir qu'une
//     chaîne. Réactif : rien n'est figé à l'appel.
//   - `ctx` : ce que le moteur prête au module pour formuler ses règles —
//     volontairement MINIMAL, pour que ce fichier reste lisible et qu'on
//     voie d'un coup d'œil de quoi il dépend :
//       • `sides`  : `module.sides` (ex. { german: ["german"], allies:
//         ["commonwealth","us","pol"] }) — sert à reconnaître les factions
//         alliées SANS les lister en dur ici (le JSON reste la source de
//         vérité sur la composition des camps).
//       • `isUnit` : `(counter) => bool` (cf. lib/units.js::isUnit) — un vrai
//         pion combattant, par opposition à un MARQUEUR (type "marker", ex.
//         les zones de largage "DZ ..."). La distinction est au cœur de la
//         règle de déploiement ci-dessous.
//       • `assisted` : ref/computed booléen (ex. `toRef(props, 'assisted')`)
//         — la partie tourne-t-elle en mode Assisté ? Nécessaire aux règles
//         qui touchent aux POINTS DE MOUVEMENT : les MP n'existent QUE dans
//         ce mode (cf. lib/useAssisted.js — en mode Libre, `spendMp` et
//         consorts ne font rien). Une règle de MP doit donc rendre `null`
//         hors mode Assisté, sans quoi elle irait écrire un état que le
//         reste du moteur ignore.
//       • `terrain` : `module.terrain` (`grid` hexId → type, `types`) — pour
//         les règles liées au terrain (ex. retraite en ville).
//       • `counters` : FONCTION `() => pions actuellement posés sur la
//         carte` — pour les règles qui regardent la POSITION des unités
//         (ex. la portée du soutien au sol ci-dessous). Une fonction, et non
//         une ref, parce que HexMap.vue appelle ce composable AVANT de
//         déclarer ses `counters` (même raison que `reinforcements` dans
//         lib/useAssisted.js) ; appelée depuis un `computed` ou un rendu,
//         elle reste parfaitement réactive.
//       • `edgeKind` : `({ c, r }, { c, r }) => nature d'arête | null` (cf.
//         lib/useAssisted.js::edgeKind) — pour reconnaître un hexside de
//         RIVIÈRE, celui que la passerelle du génie fait franchir. Passée en
//         lambda pour la même raison que les suivantes.
//       • `phase` : ref/computed de la phase courante (0 Mouvement,
//         1 Combat, 2 Fin de tour, cf. lib/useAssisted.js) et `activeSide` :
//         ref/computed du camp qui a la main — la passerelle ne s'ouvre que
//         pendant le tour de son propre camp.
//       • `hexOnMap`, `canEnterTerrain`, `enemyZocSet`, `isEnemyOf`,
//         `isFighter` : les briques du moteur qui disent ce qu'une unité
//         peut atteindre autour d'elle (cf. HexMap.vue et
//         lib/useAssisted.js) — l'hex existe-t-il, son terrain est-il
//         franchissable, est-il sous ZOC ennemie, qui est l'ennemi de qui,
//         et quel pion est une vraie unité combattante. Elles servent à
//         reconnaître une unité ENCERCLÉE (cf. `isSurrounded`). Passées en
//         lambdas par HexMap.vue, qui ne les tient de useAssisted() qu'APRÈS
//         avoir appelé ce composable — elles ne sont donc appelables qu'en
//         cours de partie, jamais à l'initialisation.
//       • `rules` : `module.rules` résolues (cf. lib/rules.js) — les
//         VALEURS des règles particulières y sont déclarées par le module
//         (ex. `airborneArrivalSpentMp`), leur LOGIQUE reste ici.
import { computed, unref } from 'vue'
import { hexId } from './calibration.js'
import { hexDistance, neighborsOf } from './hex.js'
import { isAirborneEntry } from './setup.js'
import { isArtillery } from './units.js'
import { t } from '../i18n/index.js'

// Identifiant du module concerné, tel qu'il figure dans
// public/modules/index.json. Exporté pour que l'appelant puisse, s'il le
// veut, tester l'appartenance sans instancier le composable.
export const ARNHEM_MODULE_ID = 'arnhem'

// Règle d'ARRIVÉE DES AÉROPORTÉS (cf. `airborneArrivalSpentMp` plus bas) —
// énoncé du livret : « Durant le Tour où des Renforts aéroportés arrivent
// sur la carte, ils disposent d'une Allocation de Mouvement de trois. Ils
// sont considérés comme ayant dépensé quatre Points de Mouvement à leur
// arrivée. Après leur Tour de Jeu initial sur la carte, les unités
// aéroportées peuvent utiliser leur pleine Allocation de Mouvement
// imprimée. »
//
// La règle est écrite en "MP DÉPENSÉS" (4) et non en "MP restants" (3),
// et c'est aussi ainsi qu'on l'implémente — la valeur vient du module
// (`rules.airborneArrivalSpentMp`, cf. arnhem.json ; 4 à défaut) — pour deux
// raisons :
//  1. c'est exactement la façon dont le moteur compte (cf.
//     lib/useAssisted.js::remainingMp = `c.mov - spentMp`) : il suffit
//     d'inscrire 4 dans les MP dépensés du pion, sans toucher à son `mov`
//     imprimé (7 pour TOUS les aéroportés d'Arnhem — 7 - 4 = 3, l'allocation
//     annoncée) ;
//  2. le livret distingue les deux formulations à dessein : "considérés
//     comme ayant dépensé 4" fait de l'atterrissage un mouvement DÉJÀ
//     entamé, ce qui compte pour toutes les règles qui regardent les MP
//     dépensés, pas seulement pour le reste disponible.
const DEFAULT_AIRBORNE_ARRIVAL_SPENT_MP = 4

// Règle du SOUTIEN AU SOL (cf. `supportHexAllowed` plus bas) — restriction
// propre à Arnhem : l'appui ne se guide que depuis le sol, et seules les
// troupes venues par la route en ont les moyens. Portée (en hex) entre l'hex
// visé et l'unité alliée qui le guide ; la valeur vient du module
// (`rules.groundSupportSpotterRange`, cf. arnhem.json ; 3 à défaut).
const DEFAULT_GROUND_SUPPORT_SPOTTER_RANGE = 3

// Unités alliées qui NE PEUVENT PAS guider le soutien : tout ce qui est
// arrivé par les airs. Test sur le `type` du pion (cf. arnhem.json) plutôt
// que sur une liste d'ids : "airborne infantry", "airborne arty" et "glider"
// sont ainsi tous écartés, et un type ajouté plus tard le sera aussi dès lors
// qu'il porte l'un des deux mots.
const AIRBORNE_TYPE = /airborne|glider/i

// Règle de CONCENTRATION DE L'ARTILLERIE (cf. `maxArtilleryPerCombat` plus
// bas) — nombre maximal d'artilleries qu'un même joueur peut faire tirer sur
// un même combat, barrage comme FPF. La valeur vient du module
// (`rules.maxArtilleryPerCombat`, cf. arnhem.json ; 2 à défaut).
const DEFAULT_MAX_ARTILLERY_PER_COMBAT = 2

export function useArnhem(moduleId, ctx = {}) {
  // Vrai seulement si la partie en cours EST Arnhem. Toutes les règles
  // ci-dessous commencent par le consulter : c'est lui qui garantit
  // qu'aucune règle particulière ne fuite vers un autre module.
  const active = computed(() => unref(moduleId) === ARNHEM_MODULE_ID)

  // Factions du camp allié pour CE module (cf. `ctx.sides`). Recalculé à la
  // demande plutôt que figé : `sides` vient du JSON et ne change pas en
  // cours de partie, mais le composable peut être appelé avant que le
  // module ne soit chargé.
  const alliedFactions = computed(() => ctx.sides?.allies ?? [])

  /** Règle de DÉPLOIEMENT INITIAL — quels pions sont déjà sur la carte au
   *  chargement de la partie ?
   *
   *  Règle générique du moteur (cf. HexMap.vue::autoPlacesAtLoad) : tout
   *  pion qui a un `setup` (hex de départ) et qui arrive au tour 1 est posé
   *  d'office sur la carte.
   *
   *  Particularité d'Arnhem — le scénario commence AVANT le largage :
   *   - côté ALLIÉ, le déploiement initial EST l'opération aéroportée. Seuls
   *     les MARQUEURS de zone de largage ("DZ ...", cf. `ctx.isUnit`) sont
   *     posés au coup d'envoi ; les unités, elles, attendent dans le panneau
   *     "Renfort alliés" et c'est le joueur qui les largue lui-même sur leur
   *     DZ ou l'un de ses 6 hex voisins (cf. HexMap.vue, `setup` "CCRR+adj"
   *     et phase Airborne de lib/useAssisted.js) ;
   *   - côté ALLEMAND, les renforts du tour 1 arrivent bien PENDANT ce tour,
   *     mais ne sont pas déployés au coup d'envoi : ils restent dans le
   *     panneau "Renfort allemands", comme ceux de n'importe quel autre
   *     tour. Seule la garnison fixe (pions sans `turn`, donc hors du test
   *     `turn === 1` ci-dessous) est déjà en place.
   *
   *  @returns `false` pour les pions qu'Arnhem retient hors carte, `null`
   *    dans tous les autres cas — y compris hors module Arnhem — pour
   *    laisser le moteur appliquer sa règle générique. Ne renvoie jamais
   *    `true` : cette règle ne fait que RETENIR des pions, elle n'en pose
   *    jamais un que le moteur aurait laissé de côté. */
  function autoPlacesAtLoad(counter) {
    if (!active.value) return null
    // Les pions qui n'arrivent pas au tour 1 ne sont pas concernés : c'est le
    // moteur qui tranche.
    if ((counter.turn ?? 1) !== 1) return null
    // `turn === 1` STRICT (et non `turn ?? 1`) : la garnison allemande fixe
    // ne déclare AUCUN tour d'arrivée — elle tient déjà le terrain au coup
    // d'envoi et doit donc rester au placement générique. Seuls les RENFORTS
    // allemands, qui datent explicitement leur arrivée du tour 1, sont
    // retenus hors carte.
    if (counter.faction === 'german' && counter.turn === 1) return false
    if (ctx.isUnit?.(counter) && alliedFactions.value.includes(counter.faction)) return false
    return null
  }

  // --- Arrivée des aéroportés : mémoire du tour en cours ---------------------
  // Identifiants (en chaîne) des unités aéroportées ayant ATTERRI pendant le
  // tour de jeu en cours. Cet ensemble est ce qui distingue « leur Tour de
  // Jeu initial sur la carte » (allocation réduite) de tous les suivants
  // (pleine allocation) : le moteur le vide à chaque changement de camp/tour
  // (cf. `clearTurnState`, appelée depuis HexMap.vue::clearAllMoved), après
  // quoi les mêmes unités ne sont plus concernées par la règle.
  //
  // Un `Set` NU (non réactif) : il n'est jamais lu par un template ni par un
  // `computed`, seulement par les fonctions impératives ci-dessous, appelées
  // au moment précis d'une pose ou d'une annulation.
  const airborneArrivals = new Set()

  // Ce pion entre-t-il en jeu par LARGAGE/ATTERRISSAGE ? Critère : son
  // `setup` est un largage "+adj" (cf. lib/setup.js::isAirborneEntry) —
  // c'est le MODE D'ENTRÉE qui déclenche la règle, pas `c.type` ("airborne
  // infantry", "glider", "airborne arty").

  /** Valeur de la règle pour ce module (`rules.airborneArrivalSpentMp`,
   *  cf. arnhem.json), ou 4 à défaut. */
  function arrivalSpentMp() {
    const declared = ctx.rules?.airborneArrivalSpentMp
    return Number.isFinite(declared) ? declared : DEFAULT_AIRBORNE_ARRIVAL_SPENT_MP
  }

  /** À appeler juste APRÈS qu'une unité aéroportée a été posée sur la carte
   *  — en jeu (cf. HexMap.vue::onHex, branche "entrée d'un renfort") comme
   *  au rejeu d'un journal (cf. applyReplayEntry, entrée `place`, où seule
   *  cette mémoire est à rétablir : les MP dépensés, eux, sont relus du
   *  journal). Sans effet hors module Arnhem ou pour une unité qui n'arrive
   *  pas par largage. */
  function noteAirborneArrival(counter) {
    if (!active.value || !isAirborneEntry(counter)) return
    airborneArrivals.add(String(counter.id))
  }

  /** Combien de MP ce pion doit-il compter comme DÉJÀ DÉPENSÉS du seul fait
   *  de son arrivée ? `rules.airborneArrivalSpentMp` (4) s'il a atterri pendant
   *  le tour en cours (cf. `noteAirborneArrival`), `null` sinon — donc aussi
   *  bien pour une unité arrivée à un tour précédent (qui retrouve sa pleine
   *  allocation imprimée) que pour une unité terrestre, un autre module, ou
   *  le mode Libre, où les MP n'existent pas (cf. `ctx.assisted`).
   *
   *  Deux usages côté moteur, tous deux dans HexMap.vue :
   *   1. à la POSE de l'unité, pour inscrire ses 4 MP d'entrée (cf.
   *      lib/useAssisted.js::setSpentMp) ;
   *   2. après un `resetMp` (menu contextuel "Annuler le mouvement"), qui
   *      rend la TOTALITÉ des MP : sans cette seconde inscription, annuler
   *      le mouvement d'un aéroporté fraîchement largué lui rendrait 7 MP au
   *      lieu de 3 et permettrait de contourner la règle. */
  function airborneArrivalSpentMp(counter) {
    if (!active.value || !unref(ctx.assisted)) return null
    if (!airborneArrivals.has(String(counter?.id))) return null
    return arrivalSpentMp()
  }

  /** Oublie les arrivées aéroportées du tour écoulé — « Après leur Tour de
   *  Jeu initial sur la carte, les unités aéroportées peuvent utiliser leur
   *  pleine Allocation de Mouvement imprimée » : à partir de là, elles ne
   *  sont plus reconnues par `airborneArrivalSpentMp`, qui rend `null`, et
   *  le moteur leur redonne donc leurs MP complets comme à tout le monde.
   *  Appelée par HexMap.vue::clearAllMoved, c'est-à-dire à chaque changement
   *  de camp/tour ET à la remise à zéro du plateau pour un rejeu. */
  function clearTurnState() {
    airborneArrivals.clear()
  }

  /** Règle de CONCENTRATION DE L'ARTILLERIE — un joueur ne peut pas
   *  combiner plus de DEUX artilleries dans un même combat. La limite vaut
   *  PAR CAMP et PAR COMBAT, des deux côtés de la table :
   *   - en ATTAQUE, au plus deux artilleries y ajoutent leur barrage — au
   *     contact comme à distance (choix validé : une artillerie au contact
   *     tire elle aussi avec son facteur de barrage, cf.
   *     lib/useArtillery.js::attackFactor, elle compte donc comme les
   *     autres) ;
   *   - en DÉFENSE, au plus deux artilleries y apportent leur FPF.
   *  Les pions de SOUTIEN n'entrent pas dans ce décompte (choix validé) :
   *  [9.11] leur donne la valeur d'un point d'artillerie, pas le statut
   *  d'une unité d'artillerie, et [9.12] laisse leur répartition libre.
   *
   *  Appelée par lib/useCombat.js, qui en tire toutes les conséquences :
   *  une artillerie de trop ne peut plus être désignée attaquante ni cochée
   *  pour le FPF, et — c'est le point délicat — elle est DISPENSÉE de
   *  l'obligation d'attaquer qui pèse sur toute unité au contact (cf.
   *  `strandedUnits`), sans quoi trois artilleries au contact d'un même hex
   *  ennemi rendraient le combat impossible à résoudre ET la phase
   *  impossible à terminer.
   *
   *  @returns le nombre maximal (2), ou `null` quand la règle ne se prononce
   *    pas : hors module Arnhem, et hors mode Assisté — en mode Libre, aucun
   *    combat n'est composé par le moteur, c'est le joueur qui compte. */
  function maxArtilleryPerCombat() {
    if (!active.value || !unref(ctx.assisted)) return null
    const declared = ctx.rules?.maxArtilleryPerCombat
    return Number.isFinite(declared) ? declared : DEFAULT_MAX_ARTILLERY_PER_COMBAT
  }

  // --- Soutien au sol : qui peut le guider ? ---------------------------------

  /** Portée (en hex) de la règle ci-dessous, déclarée par le module
   *  (`rules.groundSupportSpotterRange`, cf. arnhem.json), ou 3 à défaut. */
  function groundSupportSpotterRange() {
    const declared = ctx.rules?.groundSupportSpotterRange
    return Number.isFinite(declared) ? declared : DEFAULT_GROUND_SUPPORT_SPOTTER_RANGE
  }

  /** L'unité `counter` peut-elle GUIDER le soutien au sol ? Il lui faut
   *  être une vraie unité (cf. `ctx.isUnit` : ni marqueur "DZ", ni pion de
   *  soutien, qui n'a d'ailleurs pas de faction), d'une faction ALLIÉE (cf.
   *  `ctx.sides` — le soutien d'Arnhem est allié, cf. `supportTrack.side`
   *  dans arnhem.json), et n'être arrivée NI par parachute NI par planeur
   *  (cf. `AIRBORNE_TYPE`). */
  function spotsGroundSupport(counter) {
    if (!ctx.isUnit?.(counter)) return false
    if (!alliedFactions.value.includes(counter.faction)) return false
    return !AIRBORNE_TYPE.test(counter.type ?? '')
  }

  /** Règle du SOUTIEN AU SOL (ground support) — RESTRICTION D'EMPLOI propre
   *  à Arnhem : un pion de soutien ne peut être engagé, EN ATTAQUE COMME EN
   *  DÉFENSE, que sur un hex situé à `groundSupportSpotterRange` hex (3) ou
   *  moins d'une unité alliée qui n'est ni aéroportée ni planeur (cf.
   *  `spotsGroundSupport`).
   *
   *  Pourquoi : l'appui se règle depuis le sol, et seules les unités venues
   *  par la route en ont les moyens — les aéroportés, eux, ont perdu leurs
   *  liaisons. La règle générique du moteur, elle, donne au soutien une
   *  portée ILLIMITÉE ([9.13], cf. lib/useCombat.js::canPlaceSupportHex) :
   *  c'est exactement ce que cette règle-ci vient borner.
   *
   *  Appelée par lib/useCombat.js::canPlaceSupportHex, pour chaque hex où le
   *  joueur pourrait poser un pion de soutien (surlignage de la carte compris,
   *  cf. HexMap.vue::isSupportTargetHex), et par HexMap.vue pour l'engagement
   *  EN LIGNE du soutien de défense (le défenseur n'a pas la main : ses pions
   *  sont posés par le client adverse sur le premier hex attaqué).
   *
   *  @param hex `{ col, row }` — l'hex où le pion serait posé, c.-à-d. l'hex
   *    attaqué (le soutien est toujours posé sur sa cible).
   *  @returns `false` pour INTERDIRE l'hex, `null` quand la règle ne se
   *    prononce pas — hors module Arnhem, hors mode Assisté (en mode Libre
   *    les pions se glissent librement, comme tout le reste), ou hex bien
   *    guidé. Ne renvoie jamais `true` : cette règle ne fait que retirer des
   *    hex, elle n'en ouvre aucun que le moteur aurait refusé. */
  function supportHexAllowed(hex) {
    if (!active.value || !unref(ctx.assisted)) return null
    const range = groundSupportSpotterRange()
    const guided = (ctx.counters?.() ?? []).some((counter) =>
      spotsGroundSupport(counter) && hexDistance(counter, hex) <= range)
    return guided ? null : false
  }

  // --- Encerclement (cf. `cityRetreatReduction`) -----------------------------

  /** Y a-t-il une unité ENNEMIE de `unit` dans l'hex `hex` (`{ col, row }`) ?
   *  Marqueurs et pions de soutien ne comptent pas (cf. `ctx.isFighter`). */
  function hasEnemyAt(unit, hex) {
    return (ctx.counters?.() ?? []).some((other) => ctx.isFighter?.(other)
      && other.col === hex.col && other.row === hex.row && ctx.isEnemyOf?.(unit, other))
  }

  /** `unit` serait-elle ENCERCLÉE dans l'hex `hex` (`{ col, row }`) : tous
   *  les hex voisins qu'elle pourrait ATTEINDRE depuis là — sur la carte
   *  (cf. `ctx.hexOnMap`) et dont le terrain lui est ouvert (cf.
   *  `ctx.canEnterTerrain` : rivière sans pont, terrain fermé aux
   *  véhicules...) — sont-ils tous occupés par une unité ennemie ou sous ZOC
   *  ennemie (cf. `ctx.enemyZocSet`) ?
   *
   *  Un hex voisin occupé par un AMI ne ferme rien : l'unité peut y être
   *  poussée et l'ami refoulé (cf. lib/useRetreat.js). Un hex qu'elle ne peut
   *  pas atteindre du tout (hors carte, terrain interdit) ne compte pas non
   *  plus comme une issue — une unité dont aucun voisin n'est atteignable est
   *  donc bien encerclée.
   *
   *  Mesuré sur `hex` et non sur la position actuelle de l'unité : pendant
   *  l'exploration des chemins de retraite (cf. lib/useRetreat.js::
   *  canComplete), c'est l'hex où elle ARRIVERAIT qu'il faut juger. Les ZOC,
   *  elles, se déduisent des positions réelles des ennemis et ne dépendent
   *  pas de celle de `unit`. */
  function isSurrounded(unit, hex) {
    const zoc = ctx.enemyZocSet?.(unit) ?? new Set()
    return neighborsOf(hex.col, hex.row)
      .filter((neighbor) => ctx.hexOnMap?.(neighbor.col, neighbor.row)
        && ctx.canEnterTerrain?.(unit, { c: neighbor.col, r: neighbor.row }, { c: hex.col, r: hex.row }))
      .every((neighbor) => zoc.has(neighbor.col + ',' + neighbor.row) || hasEnemyAt(unit, neighbor))
  }

  /** `unit` est-elle un AÉROPORTÉ ou un PLANEUR À PIED — parachutiste ou
   *  troupe de planeur, jamais leur ARTILLERIE (cf. `AIRBORNE_TYPE` et
   *  lib/units.js::isArtillery) ? Deux règles d'Arnhem distinguent ces
   *  unités-là : elles tiennent encerclées (cf. `cityRetreatReduction`) et
   *  elles seules franchissent la rivière sur la passerelle du génie (cf.
   *  `engineerCrossingAllows`). */
  function isAirborneFoot(unit) {
    return AIRBORNE_TYPE.test(unit?.type ?? '') && !isArtillery(unit)
  }

  /** `unit` tient-elle malgré l'encerclement ? Les AÉROPORTÉS et les
   *  PLANEURS, oui — combattre encerclé est leur métier, c'est même toute
   *  l'histoire d'Arnhem —, mais pas leur ARTILLERIE, que la règle de la
   *  ville écarte de toute façon. */
  const holdsWhenSurrounded = isAirborneFoot

  // --- Passerelle du génie (franchissement de rivière) -----------------------
  //
  // Énoncé : « Pendant la phase de Mouvement alliée, une unité du génie
  // adjacente à un hexside de rivière, hors de toute ZOC ennemie, ouvre un
  // passage : les unités aéroportées et de planeur alliées (jamais leur
  // artillerie) peuvent franchir la rivière DEPUIS ou VERS l'hex du génie,
  // par n'importe lequel de ses hexsides de rivière. Elles paient le coût
  // d'entrée de l'hex, sans surcoût de rivière, et peuvent entrer dans une
  // ZOC ennemie. »
  //
  // Sur le coût, il n'y a rien à faire : une arête de rivière ne déclare ni
  // `mp` ni `extraMp` (cf. arnhem.json), elle est simplement INFRANCHISSABLE
  // (`impassable`). Toute la règle tient donc à lever cette interdiction-là
  // — le coût d'entrée de l'hex, lui, s'applique de lui-même (cf.
  // lib/useAssisted.js::terrainCost).
  //
  // Le génie peut avoir REJOINT sa position ce tour-ci (choix validé) : le
  // passage s'ouvre dès qu'il est dans l'hex, et se referme s'il repart —
  // ce qui, en mode Assisté, se lit directement sur la carte, sans mémoire à
  // tenir.

  /** Paramètres de la règle déclarés par le module (`rules.engineerCrossing`,
   *  cf. arnhem.json), ou `null` : ce module n'a pas de passerelle. */
  const crossing = () => ctx.rules?.engineerCrossing ?? null

  /** `unit` est-elle un GÉNIE du camp de la règle ? */
  function isEngineer(unit) {
    const declared = crossing()
    if (!declared || !ctx.isUnit?.(unit)) return false
    if (!(declared.unitTypes ?? []).includes(unit.type)) return false
    return sideFactions(declared.side).includes(unit.faction)
  }

  /** Factions du camp `side` de `ctx.sides` (ex. "allies" → commonwealth, us,
   *  pol) — `alliedFactions` généralisé à n'importe quel camp. */
  function sideFactions(side) {
    return ctx.sides?.[side] ?? []
  }

  /** L'hexside entre `from` et `to` (`{ col, row }`) est-il une RIVIÈRE ?
   *  Lu par le moteur (cf. `ctx.edgeKind`), donc un pont démoli qui rend sa
   *  rivière à l'arête en fait bien partie. */
  function isRiverEdge(from, to) {
    return ctx.edgeKind?.({ c: from.col, r: from.row }, { c: to.col, r: to.row }) === 'river'
  }

  /** Le GÉNIE qui tient un passage sur l'hex `hex` (`{ col, row }`), ou
   *  `null`. Il lui faut : être sur cet hex, border au moins un hexside de
   *  rivière, et n'être dans AUCUNE ZOC ennemie (cf. `ctx.enemyZocSet`). */
  function engineerAt(hex) {
    const here = (ctx.counters?.() ?? []).filter((unit) => isEngineer(unit)
      && unit.col === hex.col && unit.row === hex.row)
    for (const engineer of here) {
      const zoc = ctx.enemyZocSet?.(engineer) ?? new Set()
      if (zoc.has(engineer.col + ',' + engineer.row)) continue
      if (neighborsOf(hex.col, hex.row).some((neighbor) => isRiverEdge(hex, neighbor))) return engineer
    }
    return null
  }

  /** Règle de FRANCHISSEMENT — `unit` peut-elle passer de `from` à `to`
   *  (tous deux `{ c, r }`, comme le moteur les manipule) alors que la
   *  rivière l'interdirait ?
   *
   *  Il faut que l'arête soit bien une rivière, que l'un des deux hex porte
   *  un génie en position (cf. `engineerAt`), que `unit` soit un aéroporté ou
   *  un planeur à pied du camp de la règle (cf. `isAirborneFoot`), et qu'on
   *  soit dans la phase de Mouvement de ce camp.
   *
   *  @returns `true` pour OUVRIR le passage, `null` quand la règle ne se
   *    prononce pas — elle n'interdit jamais rien que le moteur autorisait. */
  function engineerCrossingAllows(unit, from, to) {
    if (!active.value || !unref(ctx.assisted)) return null
    const declared = crossing()
    if (!declared || !from || !to) return null
    // Phase de Mouvement (0) du camp de la règle, et elle seule.
    if (unref(ctx.phase) !== 0 || unref(ctx.activeSide) !== declared.side) return null
    if (!isAirborneFoot(unit) || !sideFactions(declared.side).includes(unit.faction)) return null
    const fromHex = { col: from.c, row: from.r }
    const toHex = { col: to.c, row: to.r }
    if (!isRiverEdge(fromHex, toHex)) return null
    return engineerAt(fromHex) || engineerAt(toHex) ? true : null
  }

  /** Règle de RECONSTITUTION DU GÉNIE — « si l'unité d'ingénieur est
   *  éliminée, elle revient le tour suivant entre 0105-0106 ».
   *
   *  Le moteur n'a rien de particulier à apprendre : il sait déjà faire
   *  revenir en renfort une unité qui a quitté la carte, avec ses propres
   *  hex d'entrée et son propre tour d'arrivée (c'est ainsi qu'une unité
   *  sortie par une bande de bord rentre au tour suivant, cf. HexMap.vue,
   *  section "Sortie de carte"). Cette règle-ci ne fait que lui donner les
   *  deux valeurs, prises du module (`rules.engineerCrossing.rebuild`).
   *
   *  @param unit le pion qu'on vient d'éliminer
   *  @param turn le tour courant
   *  @returns `{ setup, turn }` — où et quand il se représente — ou `null`
   *    si ce pion-là ne revient pas (tous les autres). */
  function rebuiltReinforcement(unit, turn) {
    if (!active.value || !unref(ctx.assisted)) return null
    const rebuild = crossing()?.rebuild
    if (!rebuild?.hexes || !isEngineer(unit)) return null
    return { setup: rebuild.hexes, turn: (turn ?? 1) + (rebuild.turnDelay ?? 1) }
  }

  /** Règle d'ASSAUT DE RIVIÈRE — que vaut l'hexside `from` -> `to` (tous deux
   *  `{ c, r }`) AU COMBAT pour l'unité `unit` ?
   *
   *  Énoncé : « Une unité qui tient l'hex du génie DOIT attaquer l'unité
   *  adverse qui lui fait face de l'autre côté de la rivière. Le génie n'est
   *  jamais additionné à ce combat, qui se résout sur la ligne "stream". »
   *
   *  Tout tient dans une substitution : pour cette unité-là, à cet instant,
   *  la rivière VAUT UN RUISSEAU. Le moteur en tire de lui-même les deux
   *  conséquences, sans rien connaître de la règle :
   *   - un ruisseau ne bloque pas l'attaque (là où une rivière l'interdit,
   *     cf. lib/edges.js, `blocksAttack`) — l'assaut devient possible, et
   *     l'obligation de combat qui va avec s'impose comme partout ailleurs
   *     (cf. lib/useCombat.js::pendingEngagements) ;
   *   - la table de combat substitue à cette nature sa propre ligne (cf.
   *     `module.combat.edgeRows` : "stream" -> "Broken, Town, Woods,
   *     Stream"), qui est précisément celle que la règle demande.
   *
   *  Le GÉNIE, lui, n'est pas un aéroporté à pied : la règle ne se prononce
   *  pas pour lui, la rivière lui reste fermée, et il ne peut donc ni être
   *  désigné attaquant ni se voir reprocher de n'avoir pas attaqué.
   *
   *  La ZOC n'est PAS concernée (elle se lit sur `combatEdgeKind`, jamais
   *  par ici) : la rivière continue de la couper. Sans quoi l'ennemi d'en
   *  face figerait le génie, ce qui refermerait la passerelle, ce qui
   *  rouvrirait la ZOC — un état qui ne se stabilise jamais.
   *
   *  @returns la nature d'arête à substituer (`rules.engineerCrossing
   *    .combatRow`, "stream"), ou `null` quand la règle ne se prononce pas. */
  function engineerAssaultEdge(unit, from, to) {
    if (!active.value || !unref(ctx.assisted)) return null
    const declared = crossing()
    if (!declared?.combatRow || !from || !to) return null
    // Phase de Combat (1) du camp de la règle, et elle seule.
    if (unref(ctx.phase) !== 1 || unref(ctx.activeSide) !== declared.side) return null
    if (!isAirborneFoot(unit) || !sideFactions(declared.side).includes(unit.faction)) return null
    const fromHex = { col: from.c, row: from.r }
    const toHex = { col: to.c, row: to.r }
    if (!isRiverEdge(fromHex, toHex)) return null
    // L'assaut part de l'hex du génie — et de lui seul (choix validé).
    return engineerAt(fromHex) ? declared.combatRow : null
  }

  /** Règle d'EMPILEMENT — « une unité peut terminer sa phase dans un hex
   *  d'ingénieur » : le génie ne compte pas dans la limite du module (cf.
   *  lib/useAssisted.js::friendlyCount, `rules.stackingLimit` — une unité par
   *  hex à Arnhem). Une unité combattante peut donc s'arrêter avec lui, mais
   *  une seule : c'est ELLE qui occupe l'hex au sens de la limite.
   *
   *  @returns `true` pour le pion qui ne compte pas, `null` sinon. */
  function stackingExempt(unit) {
    if (!active.value || !unref(ctx.assisted)) return null
    return isEngineer(unit) ? true : null
  }

  /** Type de terrain de l'hex `hex` ({ col, row }, col 0-based comme les
   *  pions) — lu dans `ctx.terrain.grid`, même clé que
   *  lib/useAssisted.js::terrainAreaCost. `undefined` si non déclaré. */
  function terrainTypeAt(hex) {
    return ctx.terrain?.grid?.[hexId(hex.col + 1, hex.row)]
  }

  /** Règle des RETRAITES EN VILLE (City) — énoncé du livret :
   *  « Les unités occupant, entrant ou retraitant dans un hex de Ville
   *  peuvent réduire tous les résultats de retraite restants de deux hex.
   *  Ainsi une retraite restante de D1, D2 ou Br peut, au choix du joueur
   *  propriétaire, devenir un résultat "sans effet" ; A1 ou A2 peuvent aussi
   *  être traités comme "sans effet". Tous les résultats d'"élimination"
   *  sont traités normalement. Un D3 doit donner une retraite d'au moins un
   *  hex, et un D4 d'au moins deux hex. Pour tout le reste, les unités en
   *  hex de Ville sont traitées comme en hex de Town normal. [L'artillerie
   *  aéroportée ne bénéficie d'aucune réduction.] »
   *
   *  Deux précisions de la boîte, appliquées ici :
   *   - la réduction vaut aussi pour l'unité qui ENTRE dans la ville en
   *     cours de retraite : les 2 hex se retirent de ce qui lui RESTE à
   *     parcourir, elle peut donc s'ARRÊTER dans l'hex de ville qu'elle
   *     vient d'atteindre (cf. `task.done` dans le calcul plus bas) ;
   *   - une unité ENCERCLÉE (cf. `isSurrounded`) n'en bénéficie PAS : prise
   *     au piège, elle ne peut pas se mettre à l'abri derrière les murs. Les
   *     AÉROPORTÉS et les PLANEURS font exception (cf.
   *     `holdsWhenSurrounded`) — mais pas leur artillerie, déjà écartée.
   *
   *  (La dernière phrase, "traitées comme en Town", est déjà assurée par le
   *  moteur : cf. lib/useCombat.js, ligne de table "Broken, Town..." qui
   *  inclut "city". De/Ae ne sont pas des retraites : le moteur ne consulte
   *  jamais cette règle pour eux.)
   *
   *  Appelée par lib/useRetreat.js (paramètre générique `retreatReduction`)
   *  chaque fois qu'une unité en retraite se trouve dans un hex — au départ
   *  (« occupant ») comme après chaque pas (« entrant/retraitant ») — et
   *  aussi pendant l'exploration des chemins possibles, pour ne pas déclarer
   *  "impossible" une retraite qu'une ville rendrait faisable.
   *
   *  @param unit  le pion qui retraite
   *  @param hex   { col, row } — l'hex où il se trouve (ou se trouverait)
   *  @param task  { initial, total, done } — nombre d'hex du résultat tiré
   *               (`initial`, ex. 4 pour un D4), à parcourir actuellement
   *               (`total`) et déjà parcourus (`done`)
   *  @returns `{ total, reason }` — le NOUVEAU nombre total d'hex de la
   *    retraite et un libellé pour l'affichage — ou `null` si la règle ne
   *    s'applique pas (autre module, hex non City, artillerie aéroportée,
   *    unité encerclée qui n'est ni aéroportée ni planeur, réduction déjà
   *    prise, rien à réduire). La réduction reste
   *    FACULTATIVE : c'est le moteur qui la propose au joueur (bouton de la
   *    modale de combat), et ne l'impose que si, sans elle, l'unité serait
   *    éliminée faute de retraite possible. */
  function cityRetreatReduction(unit, hex, task) {
    if (!active.value || !unref(ctx.assisted)) return null
    if (terrainTypeAt(hex) !== 'city') return null
    // [Airborne artillery receive no reduction.]
    if (unit?.type === 'airborne arty') return null
    // Unité ENCERCLÉE : aucune réduction — sauf aéroporté ou planeur (cf.
    // l'énoncé ci-dessus). Testé APRÈS le terrain, qui est bien moins coûteux
    // que le parcours des 6 voisins : cette règle n'est consultée que pour
    // les hex de ville.
    if (!holdsWhenSurrounded(unit) && isSurrounded(unit, hex)) return null
    // UNE SEULE réduction par retraite : "réduire les retraites RESTANTES
    // de deux hex" s'applique à ce qui reste, une fois. La cumuler (départ
    // en ville PUIS entrée dans une autre ville) violerait les minimums
    // ci-dessous (ex. D4 : 4 → 2 → 0). Une retraite déjà réduite se
    // reconnaît à son total inférieur au résultat tiré.
    if (task.total < task.initial) return null
    // Minimums imposés par le livret : D3 → au moins 1 hex, D4 → au moins 2.
    // Pour D1/D2/A1/A2/Br (résultats de 1 ou 2 hex), aucun minimum : ils
    // peuvent devenir "sans effet". Seuls les D vont jusqu'à 3-4 hex, d'où
    // le test sur `initial` seul.
    const minimum = task.initial === 4 ? 2 : task.initial === 3 ? 1 : 0
    // Les hex déjà parcourus restent acquis (`done`) : on ne retire que du
    // RESTANT, au plus 2 hex.
    const total = Math.max(task.done, minimum, task.total - 2)
    if (total >= task.total) return null // rien à gagner
    return { total, reason: t('retreatNotes.cityRule') }
  }

  return {
    active, autoPlacesAtLoad, noteAirborneArrival, airborneArrivalSpentMp, clearTurnState,
    supportHexAllowed, maxArtilleryPerCombat, cityRetreatReduction,
    engineerCrossingAllows, engineerAssaultEdge, stackingExempt, engineerAt, isAirborneFoot,
    rebuiltReinforcement,
  }
}
