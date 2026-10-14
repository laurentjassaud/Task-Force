// ═══════════════════════════════════════════════════════════════════════════
// useAssisted — logique du mode "Assisté" vs mode "Libre"
// ═══════════════════════════════════════════════════════════════════════════
//
// Ce composable centralise TOUTES les règles qui différencient les deux
// modes de partie proposés dans LocalGameSetup.vue (paramètre `party`) :
//
//   • Mode "Libre"   (assisted = false, valeur PAR DÉFAUT)
//       → un vrai bac à sable, sans aucun garde-fou :
//         - la grille hexagonale est toujours masquée,
//         - les pions ne sont sélectionnables qu'au glisser-déposer
//           (un simple clic ne les sélectionne pas),
//         - aucune restriction de tour : n'importe quel camp peut
//           déplacer n'importe quel pion à tout moment.
//       C'est le mode pensé pour rejouer une partie librement, sans que
//       l'appli n'impose les règles du jeu.
//
//   • Mode "Assisté" (assisted = true)
//       → l'appli ajoute des garde-fous, mais ils restent OPT-IN
//         (l'utilisateur peut les activer/désactiver au fil de la partie) :
//         - la grille peut être affichée/masquée via une case à cocher,
//         - les pions deviennent sélectionnables au clic (affichage d'un
//           contour vert autour du pion sélectionné),
//         - le déplacement d'un pion est restreint au camp dont c'est le
//           tour, en s'appuyant sur le composant TurnTracker.vue (le
//           tracker de tour affiché dans HexMap.vue) qui sait quelles
//           factions sont "actives" au pas courant,
//         - CHAQUE camp actif joue en 2 PHASES successives, Mouvement puis
//           Combat (cf. section "Phases" plus bas), matérialisées par 2
//           marqueurs sous la piste de tour dans TurnTracker.vue,
//         - chaque pion ne peut entrer dans un hex que s'il lui reste assez
//           de POINTS DE MOUVEMENT (MP) pour payer le COÛT DE TERRAIN (COT)
//           de cet hex (cf. section "Points de mouvement" plus bas),
//         - les HEXSIDES (côtés d'hex) portent des routes, pistes, ponts,
//           bacs, rivières, ruisseaux... dont l'effet est DÉCLARÉ par le
//           module (`terrain.edges`, cf. lib/edges.js) : coût fixe (route,
//           piste), surcoût (gué, bac), arête infranchissable (rivière sans
//           pont), arête interdite aux véhicules ou au contraire qui leur
//           ouvre un terrain interdit — cf. `edgeKind`/`terrainCost`/
//           `canEnterTerrain`, section "Points de mouvement". Par exemple :
//           une RIVIÈRE est infranchissable sauf par un PONT (sans surcoût)
//           ou, pour les unités NON motorisées/blindées, par un BAC (+3 MP,
//           comme un gué de ruisseau) ; les véhicules (cf. `rules.
//           vehicleTypes`) n'entrent dans un hex rough/broken/woods que par
//           une route/piste/pont et ne franchissent ni ruisseau à gué ni
//           rivière par bac,
//         - ZONE DE CONTRÔLE (ZOC, cf. section dédiée plus bas) : un pion
//           qui commence son tour dans la ZOC d'un pion ennemi ne peut pas
//           bouger du tout ; un pion qui ENTRE dans une ZOC ennemie doit s'y
//           arrêter (aucun déplacement supplémentaire ce tour-ci),
//         - CONGESTION DES HEX D'ENTRÉE (cf. section dédiée plus bas) : un
//           renfort qui entre sur un hex de bord de carte (`setup` "ref
//           seule" ou "plage", jamais "+adj") paie le coût de cet hex ; si un
//           AUTRE renfort entre par ce MÊME hex ce MÊME tour, le coût
//           double, triple, etc. — cf. `entryCost`/`spendEntryCost`,
//         - PHASE AIRBORNE (cf. section "Phase Airborne" plus bas) : un camp
//           qui a des unités aéroportées à faire entrer en jeu (ce tour-ci
//           ou restées des tours précédents) commence son tour par une
//           phase dédiée à leur placement, AVANT le Mouvement.
//
// Une SEULE famille de règles du mode Assisté ne vit pas dans ce fichier :
// le COMBAT (désignation d'un défenseur et de ses attaquants en phase
// Combat, table de combat, jet de dé), qui forme un bloc autonome et a son
// propre fichier, lib/useCombat.js — il ne partage avec le mouvement que
// `canControl` (à quel camp appartient ce pion) et `combatEdgeKind` (nature
// d'un hexside), que ce fichier lui exporte.
//
// Pourquoi un composable séparé plutôt que de mettre ce code directement
// dans HexMap.vue ? Pour que toute la logique de bascule Libre/Assisté
// reste au même endroit, facile à relire et à faire évoluer, sans polluer
// le composant HexMap (déjà volumineux) avec des `if (assisted.value)`
// éparpillés un peu partout.
//
// Paramètres reçus par le composable :
//   - `assisted` : ref/computed booléen réactif (ex. `toRef(props, 'assisted')`
//     côté HexMap.vue) qui indique si la partie tourne en mode Assisté.
//   - `turnTrackerRef` : ref pointant vers l'INSTANCE du composant enfant
//     TurnTracker.vue. On l'utilise pour appeler ses méthodes/valeurs
//     exposées :
//       • `canControl(counter)` fait autorité sur "quel camp peut jouer ce
//         pion maintenant" (cf. TurnTracker.vue). Si le module de jeu ne
//         définit pas de config de tours, TurnTracker.canControl() autorise
//         tout par défaut — donc même en mode Assisté, l'absence de config
//         de tour ne bloque rien.
//       • `nextTurn()` fait avancer le pas courant (camp suivant, et donc
//         éventuellement tour suivant) — normalement déclenché par un clic
//         dans TurnTracker.vue, mais qu'on doit pouvoir déclencher NOUS
//         MÊMES depuis ce composable (cf. section "Phases" plus bas) quand
//         la phase Combat se termine.
//       • `currentStep` / `isLastSideOfTurn` sont des valeurs exposées en
//         lecture, utilisées respectivement pour détecter un changement de
//         camp/tour (remise à zéro de la phase — et, cf. plus bas, des MP de
//         TOUTES les unités) et pour choisir le libellé du bouton "suivant".
//       • `currentTurn` (numéro de tour) sert à remettre à zéro la
//         congestion des hex d'entrée (cf. section dédiée plus bas) à chaque
//         NOUVEAU TOUR — contrairement à `spentMp`, PAS à chaque changement
//         de camp (`currentStep`) : "le même tour" y couvre les deux camps.
//   - `terrain` : `module.terrain` (JSON du module, ex. coral-sea.json) —
//     `{ types: { [clé]: { label, mp } }, grid: { [id d'hex "CCRR"]: clé },
//     edges: { layers, kinds, movementPriority, combatPriority }, <couches>
//     }`. Les couches (`roads`, `rivers`...) sont des listes
//     d'ARÊTES (paires d'hex adjacents précises, pas juste "cet hex est une
//     route/un cours d'eau") ; `edges` déclare ce que chacune veut dire (cf.
//     lib/edges.js, et section "Points de mouvement" plus bas pour leur
//     usage). Peut être absent (modules pas encore enrichis en terrain) :
//     dans ce cas, tout hex coûte 1 MP par défaut, sans bonus/malus
//     d'aucune sorte.
//   - `counters` : ref/computed du tableau des pions actuellement POSÉS sur
//     la carte (cf. HexMap.vue::counters — pas les renforts pas encore
//     posés, ni les pions éliminés). Sert à la ZOC (section dédiée plus bas)
//     pour savoir où se trouvent les pions ennemis, et à l'empilement
//     (section dédiée aussi) pour savoir où se trouvent les pions AMIS.
//   - `sides` : `module.sides` (ex. { german: ["german"], allies:
//     ["commonwealth","us","pol"] }) — même regroupement camp/factions que
//     celui donné à TurnTracker.vue. Sert à déterminer si deux pions sont
//     ennemis (camps différents) ou amis (même camp), pour la ZOC ET
//     l'empilement. Peut être absent (repli sur une simple comparaison de
//     faction, cf. `isEnemyOf`).
//   - `hexOnMap` : fonction `(col, row) => bool` (cf. HexMap.vue::hexOnMap)
//     — un hex existe-t-il bien sur la carte à cette position ? Sert
//     uniquement à `canLeaveAfterEntering` (section "Empilement" plus bas)
//     pour ignorer les voisins hors carte lors de la recherche d'une case de
//     repli.
//   - `getReinforcements` : fonction `() => [pions]` (cf.
//     HexMap.vue::reinforcements) — renforts PAS ENCORE posés ni éliminés.
//     Une FONCTION (et non la liste elle-même) parce que HexMap.vue la
//     calcule APRÈS avoir appelé ce composable : elle n'est lue qu'au moment
//     où on en a besoin (début du tour d'un camp, cf. `airbornePending`).
//     Sert uniquement à la phase Airborne.
import { computed, ref, watch } from 'vue'
import { hexId } from './calibration.js'
import { neighborsOf } from './hex.js'
import { isFighter } from './units.js'
import { isAirborneEntry } from './setup.js'
import { resolveRules, resolveTurnStructure } from './rules.js'
import { resolveEdges } from './edges.js'
import { resolvePassages } from './passages.js'
import { t, mt } from '../i18n/index.js'

// Les types d'unité motorisées/blindées, les terrains qui leur sont
// interdits et la limite d'empilement ne sont plus codés ici : ils viennent
// de `module.rules` (cf. lib/rules.js, paramètre `rules` ci-dessous —
// `vehicleTypes`, `impassableForVehicles`, `stackingLimit`).

// De même, ce que valent les HEXSIDES (routes, rivières, ponts, bacs...) :
// coûts, surcoûts et interdictions sont déclarés par le module
// (`terrain.edges`, cf. lib/edges.js) — y compris le surcoût d'un gué ou
// d'un bac (ex. "Stream +3 MP" / "Ferry +3 MP" sur la table de mouvement),
// autrefois codé ici.

//   - `rules` : règles génériques paramétrées par le module (cf.
//     lib/rules.js::resolveRules — `vehicleTypes`, `impassableForVehicles`,
//     `stackingLimit`, `zoc`, `entryCongestion`). À défaut, les valeurs par
//     défaut du moteur.
//   - `structure` : structure du tour d'un camp (cf. lib/rules.js::
//     resolveTurnStructure — `airbornePhase`, `combatPhase`,
//     `endOfTurnPhase`), cf. section "Phases" plus bas. À défaut, toutes les
//     phases.
//   - `moduleRules` : règles PARTICULIÈRES au module joué (cf.
//     lib/moduleRules.js), dont ce fichier n'utilise que
//     les deux qui touchent au mouvement — `engineerCrossingAllows` (un
//     hexside que le terrain fermerait, mais qu'une règle du module ouvre :
//     ex. une passerelle du génie sur la rivière) et `stackingExempt`
//     (un pion qui ne compte pas dans la limite d'empilement). Chacune rend
//     `null` quand elle ne se prononce pas, y compris pour un module sans
//     règles particulières : la règle générique s'applique alors telle quelle.
//   - `isDemolished` : `(clé d'arête "CCRR-CCRR") => bool` — ce pont a-t-il
//     SAUTÉ (cf. lib/useBridges.js, qui tient la liste) ? Une arête dont
//     le pont est démoli ne vaut plus que par l'obstacle qu'il franchissait
//     (cf. `edgeKind`/`combatEdgeKind`, et lib/edges.js::revealedKind) : ni
//     la route qui l'empruntait, ni le pont lui-même ne comptent plus. À
//     défaut, aucun pont n'est démoli — un module sans cette règle joue donc
//     exactement comme avant.
export function useAssisted(assisted, turnTrackerRef, terrain, counters, sides, hexOnMap, getReinforcements, rules = resolveRules(null), structure = resolveTurnStructure(null), isDemolished = () => false, moduleRules = {}) {
  // --- Arêtes (hexsides) du module -------------------------------------------
  // Interprète des arêtes, construit UNE SEULE FOIS (cf. lib/edges.js) :
  // `terrain` ne change pas en cours de partie, inutile de reconstruire les
  // ensembles d'arêtes à chaque appel de `terrainCost`. Il répond à trois
  // questions, et c'est tout ce que ce fichier sait des arêtes :
  //   - `edges.movementKind(clé)` : quelle NATURE d'arête ("road", "river"...)
  //     fait foi pour un DÉPLACEMENT par cette arête (la première de
  //     `terrain.edges.movementPriority` présente) ;
  //   - `edges.combatKind(clé)` : même question pour le COMBAT et la ZOC
  //     (`combatPriority`, ordre qui peut différer — cf. `combatEdgeKind`) ;
  //   - `edges.entryKind("CCRR")` : l'hex est-il DESSERVI par une arête à
  //     coût fixe (route, piste), peu importe par où — pour l'entrée en jeu
  //     d'un renfort, qui n'a pas d'arête de provenance (cf. `entryBaseCost`).
  // Et `edges.kindOf(nature)` donne les propriétés déclarées d'une nature
  // (`mp`, `extraMp`, `impassable`, `vehicles`, `blocksZoc`, `blocksAttack`).
  // Plusieurs couches du JSON peuvent partager une nature : ex. trois sortes
  // de pont (canal, chemin de fer, route), toutes "bridge" —
  // peu importe LEQUEL, un pont se franchit sans surcoût, par tout le monde.
  const edges = resolveEdges(terrain, rules.bridgeDemolition)
  // Hex coupés par une île (cf. lib/passages.js) : dans un tel hex, on ne
  // ressort que par un côté de la couleur du côté d'entrée.
  const passages = resolvePassages(terrain)

  /** Clé "CCRR-CCRR" de l'arête `from` -> `h` (hex au format { c, r } de
   *  HexMap.vue), telle que l'attend l'interprète `edges` ci-dessus. */
  function edgeKeyOf(from, hex) {
    return hexId(from.c + 1, from.r) + '-' + hexId(hex.c + 1, hex.r)
  }

  // --- Affichage de la grille hexagonale -----------------------------------
  // `showGridPref` mémorise la PRÉFÉRENCE de l'utilisateur (case cochée ou
  // non), indépendamment du mode de partie. On la garde séparée de
  // `showGrid` pour ne pas perdre ce choix si jamais le mode passe de
  // Assisté à Libre puis repasse à Assisté (la préférence est conservée,
  // seul son EFFET est neutralisé hors mode Assisté).
  const showGridPref = ref(true)

  // `showGrid` est la valeur réellement utilisée par le template (HexMap.vue
  // l'utilise à la fois pour afficher/masquer la grille et pour piloter la
  // case à cocher correspondante, désactivée hors mode Assisté).
  const showGrid = computed({
    // Lecture : la grille n'est visible que si on est en mode Assisté ET
    // que l'utilisateur a coché la case. En mode Libre, on renvoie
    // toujours `false`, quelle que soit la préférence mémorisée : la
    // grille reste masquée sans exception.
    get: () => assisted.value && showGridPref.value,
    // Écriture : on ignore toute tentative de cocher/décocher la case si
    // on n'est pas en mode Assisté. Concrètement, HexMap.vue désactive déjà
    // la case à cocher (`:disabled="!assisted"`) hors mode Assisté, donc ce
    // garde-fou est une sécurité supplémentaire plutôt qu'un chemin normal.
    set: (visible) => { if (assisted.value) showGridPref.value = visible },
  })

  // --- Sélection des pions au clic ------------------------------------------
  // En mode Assisté, un clic sur un pion le sélectionne (contour vert).
  // En mode Libre, cette interaction est désactivée : seul le
  // glisser-déposer permet de déplacer un pion, pour rester au plus près
  // d'un vrai bac à sable sans "aide" de l'interface.
  const selectable = computed(() => assisted.value)

  // --- Glisser-déposer des UNITÉS (entrée en jeu et déplacement) -------------
  // Miroir exact de `selectable` ci-dessus, pour que les 2 modes restent
  // mutuellement exclusifs sur la façon de jouer un pion — jamais les deux
  // façons de faire disponibles en même temps :
  //   - Mode Libre   : `draggable` vrai, `selectable` faux — seul le
  //     glisser-déposer fonctionne (aucune sélection au clic).
  //   - Mode Assisté : `draggable` faux, `selectable` vrai — un pion (déjà
  //     sur la carte, ou un renfort pas encore posé) ne peut plus être
  //     glissé du tout ; la SEULE façon de le faire entrer en jeu ou de le
  //     déplacer est le clic (sélection au clic, puis clic sur l'hex de
  //     destination — cf. onHex/onCounterSelect/onReinforcementSelect dans
  //     HexMap.vue, déjà en place et inchangés par cette règle).
  //
  // Les pions de SOUTIEN (kind: 'support', cf. SupportTracker.vue) suivent la
  // même règle : glissés en mode Libre, posés au clic (tablette puis hex) en
  // mode Assisté, où ils obéissent alors à la règle du module — phase de
  // Combat, hex cible (cf. useCombat.js::canPlaceSupportHex). Ils restent en
  // revanche exemptés de `canControl` ci-dessus : ce ne sont pas des unités
  // d'un camp actif, mais une ressource que son camp propriétaire engage
  // aussi bien pendant SON tour (en attaque) que pendant le tour adverse (en
  // défense).
  const draggable = computed(() => !assisted.value)

  // --- Restriction de mouvement par camp actif -------------------------------
  // `canControl(c)` répond à la question : "le camp dont c'est le tour
  // a-t-il le droit de contrôler (sélectionner/déplacer) ce pion `c` ?"
  //
  // Cette fonction est appelée par HexMap.vue à chaque tentative de
  // sélection ou de déplacement (clic, début de glisser-déposer, drop).
  function canControl(counter) {
    // Hors mode Assisté (mode Libre), aucune restriction : tout pion est
    // contrôlable par n'importe qui, à tout moment.
    if (!assisted.value) return true

    // En mode Assisté, on délègue la décision à TurnTracker.vue, qui
    // connaît le camp actif du tour en cours et les factions qui lui sont
    // rattachées. Le `?? true` couvre le cas où `turnTrackerRef.value`
    // n'est pas encore monté (ex. tout premier rendu) : par défaut, on
    // n'empêche rien plutôt que de bloquer l'interface sur une ref pas
    // encore prête.
    return turnTrackerRef.value?.canControl(counter) ?? true
  }

  // --- Phases Mouvement / Combat / Fin de tour --------------------------------
  // Les phases qui composent le tour d'un camp sont DÉCLARÉES par le module
  // (`module.turnStructure`, cf. paramètre `structure` et lib/rules.js::
  // resolveTurnStructure) : le Mouvement existe toujours ; la phase Airborne
  // (avant lui), la phase Combat (après lui) et la Fin de tour (après le
  // dernier camp de l'ordre) sont chacune facultatives. Un module qui en
  // retire une voit simplement le bouton "suivant" la sauter (cf. `advance`,
  // `nextLabel`) et son marqueur disparaître (cf. `phaseLabels`).
  //
  // Avec toutes les phases, chaque camp actif (déterminé par
  // TurnTracker.vue) joue son tour en 2 PHASES successives et obligatoires :
  // d'abord Mouvement, puis Combat. Concrètement, ça se traduit par 2
  // marqueurs affichés sous la piste de tour (cf. TurnTracker.vue), et par UN
  // SEUL bouton "suivant" qui, selon où on en est, déclenche l'une de ces 4
  // actions :
  //
  //   1. Mouvement → Combat          (même camp, même tour)   — "Nouvelle phase"
  //   2. Combat → Mouvement          (camp SUIVANT, même tour) — "Autre joueur"
  //   3. Combat → Fin de tour        (camp = DERNIER de l'ordre, même tour) — "Fin de tour"
  //   4. Fin de tour → Mouvement     (1er camp de l'ordre → tour+1) — "Nouveau tour"
  //
  // Exemple concret (2 camps, ordre [allies, german], german DERNIER de
  // l'ordre) :
  //   Tour 1 Alliés Mouvement → Tour 1 Alliés Combat → Tour 1 Allemands
  //   Mouvement → Tour 1 Allemands Combat → Tour 1 FIN DE TOUR → Tour 2
  //   Alliés Mouvement → ...
  //
  // "Fin de tour" (cas 3-4 ci-dessus) n'existe donc QUE pour le DERNIER camp
  // de l'ordre (cf. `turnTrackerRef.value?.isLastSideOfTurn`) : c'est une
  // phase du TOUR entier (les deux camps confondus), pas
  // d'un camp en particulier — les camps qui ne sont pas derniers de l'ordre
  // passent directement de Combat au Mouvement du camp suivant (cas 2,
  // inchangé). C'est pour ça que `phaseLabels` ci-dessous n'affiche ce 3e
  // marqueur QUE pendant le tour du dernier camp — pas de marqueur "mort"
  // affiché sans effet pendant le tour des autres camps.
  //
  // Cas 2 et 4 ci-dessus correspondent tous les deux à un changement de
  // camp actif (le 2e boucle en plus sur l'ordre des camps, ce qui fait
  // mécaniquement avancer le numéro de tour, cf. TurnTracker.vue::
  // currentTurn, dérivé du pas courant) — le camp actif et le tour sont donc
  // TOUJOURS gérés par TurnTracker.vue (son `nextTurn()`, appelé ci-dessous)
  // ; ce composable ne fait QUE superposer une phase locale (0, 1 ou 2)
  // par-dessus ce pas.

  // 0 = Mouvement, 1 = Combat, 2 = Fin de tour (dernier camp de l'ordre
  // uniquement, cf. ci-dessus), et PHASE_AIRBORNE (-1) = phase Airborne, qui
  // PRÉCÈDE le Mouvement quand elle existe (cf. section suivante).
  const phaseStep = ref(0)

  // --- Phase Airborne (avant le Mouvement) -----------------------------------
  // Règle : si le camp actif a des unités AÉROPORTÉES à faire entrer en jeu
  // — celles de CE tour, ou celles restées hors carte des tours précédents —
  // son tour commence par une phase "Airborne", AVANT le Mouvement. Elle ne
  // sert qu'à POSER ces unités sur la carte (par clic, sur leur DZ ou un hex
  // voisin — `setup` "+adj", cf. HexMap.vue::entryHexSet) :
  //   - on n'y déplace AUCUNE unité : un pion déjà posé ne peut pas être
  //     sélectionné (cf. HexMap.vue::onCounterSelect) ;
  //   - une unité posée n'est PAS sélectionnée ensuite (contrairement à un
  //     renfort posé en phase Mouvement, qui l'est pour enchaîner sur son
  //     mouvement, cf. HexMap.vue::onHex) ;
  //   - un aéroporté n'atterrit que sur un hex VIDE de toute unité, amie ou
  //     ennemie — 1 unité par hex (cf. HexMap.vue::airborneLandingBlocked) ;
  //   - seuls les aéroportés y sont plaçables ; à l'inverse, un aéroporté ne
  //     peut plus être posé dans les autres phases — ceux qui restent hors
  //     carte attendent la phase Airborne du prochain tour de ce camp (cf.
  //     `canPlaceReinforcementNow`).
  // On passe au Mouvement par le bouton "suivant" (cf. `advance`), jamais
  // automatiquement — même une fois tous les aéroportés posés. Aucun
  // blocage : on peut passer au Mouvement en en laissant hors carte.
  //
  // Valeur NÉGATIVE (-1) plutôt que de décaler les autres phases : 0/1/2
  // gardent ainsi le sens qu'elles ont partout ailleurs (lib/useCombat.js,
  // HexMap.vue, entrées `phase` des journaux déjà enregistrés).
  const PHASE_AIRBORNE = -1

  // --- Mise en place (avant le tour 1) ---------------------------------------
  // Étape de la piste de tour déclarée par `turnTrack.setup` (cf.
  // lib/turnTrack.js) : un seul camp, une seule phase, où il pose ses pions
  // de tour 0 depuis le panneau, n'importe où sur la carte (`setup` "*").
  // Aucun déplacement (le Mouvement est la phase 0). Le bouton "suivant"
  // ouvre directement le tour 1.
  const PHASE_SETUP = -2

  // Vrai si le tour du camp actif a COMMENCÉ par une phase Airborne. Sert
  // uniquement à l'affichage (cf. `phaseLabels`/`phaseIndex`) : le marqueur
  // "Airborne" reste affiché (éteint) une fois passé au Mouvement.
  const airborneThisStep = ref(false)

  // --- Phases déclarées par le module (`turnStructure.phases`) ---------------
  // Un module peut remplacer le couple Mouvement/Combat par SA propre liste
  // de phases (ex. la mer de Corail : mouvement naval, combat naval,
  // opérations aériennes, reconnaissance, administrative — cf. lib/rules.js::
  // resolvePhases, qui attribue à chacune son pas). Le bouton "suivant" les
  // parcourt dans l'ordre déclaré ; après la dernière, le camp a fini (cf.
  // `endSide`). Airborne (avant) et Fin de tour (après le dernier camp)
  // restent gouvernées par leurs propres drapeaux.
  const customPhases = structure.phases

  /** Phases du module jouées CE tour-ci : la liste déclarée, moins celles que
   *  la piste de tour retire de ce tour (`turnInfo.skipPhases`, cf.
   *  lib/turnTrack.js — ex. pas d'opérations aériennes de nuit). La phase de
   *  Mouvement n'est jamais retirée. `null` sans liste propre au module. */
  function activePhases() {
    if (!customPhases) return null
    const skipped = turnTrackerRef.value?.currentTurnInfo?.skipPhases ?? []
    return customPhases.filter((entry) => entry.kind === 'movement' || !skipped.includes(entry.id))
  }

  /** Pas de la PREMIÈRE phase du tour d'un camp (hors Airborne). */
  function firstStep() {
    return customPhases ? activePhases()[0].step : 0
  }

  /** Position du pas `step` dans la liste du module (-1 hors liste). */
  function customIndexOf(step) {
    return customPhases ? customPhases.findIndex((entry) => entry.step === step) : -1
  }

  /** Position du pas `step` parmi les phases jouées ce tour-ci (-1 sinon). */
  function activeIndexOf(step) {
    return customPhases ? activePhases().findIndex((entry) => entry.step === step) : -1
  }

  /** Nom de la phase de pas `step` dans la langue courante (journal, rapport
   *  de bug). */
  function phaseNameOf(step) {
    if (step == null) return '—'
    const custom = customPhases?.[customIndexOf(step)]
    if (custom) return mt(custom.label)
    return t(`phases.${PHASE_KEY[step]}`)
  }

  // `c` est-il une unité AÉROPORTÉE ? Même critère que partout ailleurs :
  // son `setup` est un largage "+adj" (cf. lib/setup.js::isAirborneEntry).

  /** Le camp actif a-t-il au moins un aéroporté à poser ? Il faut qu'il ne
   *  soit ni sur la carte ni éliminé (cf. `getReinforcements`), qu'il soit à
   *  ce camp (cf. `canControl`) et que son tour d'arrivée soit atteint (ce
   *  tour-ci ou un tour précédent — `currentTurn` lu sur TurnTracker.vue, à
   *  jour immédiatement, contrairement à HexMap.vue::turnInfo). Toujours
   *  faux hors mode Assisté. */
  function airbornePending() {
    if (!assisted.value) return false
    const turn = turnTrackerRef.value?.currentTurn ?? 1
    return (getReinforcements?.() ?? []).some((counter) => isAirborneEntry(counter) && canControl(counter) && (counter.turn ?? 1) <= turn)
  }

  /** Début du tour d'un camp : phase Airborne s'il a des aéroportés à poser
   *  (cf. `airbornePending`), sinon directement Mouvement. Appelée :
   *   - à chaque changement de camp/tour (watcher de `currentStep` plus bas) ;
   *   - au lancement de la partie (cf. HexMap.vue, `onMounted` -> `initPhase`,
   *     aucun changement de pas n'ayant alors eu lieu) ;
   *   - au début d'un rejeu de journal (cf. `resetTurnState`).
   *  Au rejeu, le résultat est le même qu'en jeu : à l'entrée `turn`, les
   *  aéroportés posés PENDANT ce tour ne sont pas encore rejoués. */
  function startSidePhase() {
    // Module SANS phase Airborne (`structure.airbornePhase` faux) : on
    // commence toujours directement par le Mouvement.
    if (turnTrackerRef.value?.isSetupStep) {
      phaseStep.value = PHASE_SETUP
      airborneThisStep.value = false
      return
    }
    // Piste à phases entremêlées (cf. lib/turnTrack.js) : le pas désigne à
    // lui seul la phase jouée.
    const slot = turnTrackerRef.value?.currentSlot
    if (slot && customPhases) {
      phaseStep.value = customPhases.find((entry) => entry.id === slot.phase)?.step ?? firstStep()
      airborneThisStep.value = false
      return
    }
    phaseStep.value = structure.airbornePhase && airbornePending() ? PHASE_AIRBORNE : firstStep()
    airborneThisStep.value = phaseStep.value === PHASE_AIRBORNE
  }

  /** Le renfort `c` peut-il être posé DANS LA PHASE EN COURS ? En phase
   *  Airborne, uniquement les aéroportés ; dans toute autre phase,
   *  uniquement les NON aéroportés (cf. règle ci-dessus). Le tour d'arrivée
   *  et le camp sont vérifiés à part (cf. HexMap.vue::canEnterThisTurn/
   *  `canControl`). Toujours vrai hors mode Assisté — et pour un module SANS
   *  phase Airborne : ses aéroportés se posent alors comme n'importe quel
   *  renfort, sans quoi ils ne pourraient jamais entrer en jeu. */
  function canPlaceReinforcementNow(counter) {
    if (!assisted.value) return true
    // Les pions de tour 0 n'entrent en jeu qu'à la mise en place, et elle
    // n'accepte qu'eux.
    if (phaseStep.value === PHASE_SETUP) return (counter?.turn ?? 1) === 0
    if ((counter?.turn ?? 1) === 0) return false
    if (!structure.airbornePhase) return true
    return phaseStep.value === PHASE_AIRBORNE ? isAirborneEntry(counter) : !isAirborneEntry(counter)
  }

  // MP déjà dépensés ce tour-ci, par unité : Map id -> nombre de MP
  // consommés jusqu'ici. Déclaré ici (avant le watcher juste en dessous) car
  // ce même watcher le remet à zéro en même temps que la phase — cf. section
  // "Points de mouvement" plus bas pour son utilisation complète.
  const spentMp = ref(new Map())

  // `phase` n'existe (au sens de l'UI) qu'en mode Assisté : hors de ce
  // mode, on expose `null` pour que TurnTracker.vue sache qu'il doit
  // revenir à son affichage historique (pas de ligne "phases", bouton
  // "suivant" en bout de piste de tour, cf. TurnTracker.vue::props.phase).
  const phase = computed(() => (assisted.value ? phaseStep.value : null))

  // Libellés des marqueurs de la ligne "phases" (cf. TurnTracker.vue, qui ne
  // fait qu'afficher CETTE liste en surlignant l'entrée d'index `phaseIndex`,
  // sans connaître elle-même le sens de "Fin de tour"). Avec toutes les
  // phases : 2 marqueurs pour un camp qui n'est pas le dernier de l'ordre
  // (Mouvement/Combat) ; 3 pour le DERNIER camp de l'ordre, qui seul voit
  // sa phase Combat suivie d'une "Fin de tour" (cf.
  // section ci-dessus pour le détail des 4 transitions). Une phase que le
  // module ne déclare pas (cf. `structure`) n'a pas de marqueur.
  //
  // La liste est d'abord construite en CLÉS de phase (`phaseKeys`, stables),
  // puis traduite dans la langue de l'interface (`phaseLabels`, cf.
  // src/i18n, section `phases`) : le marqueur allumé se retrouve par sa clé
  // (cf. `phaseIndex`), jamais par son libellé, qui change avec la langue.
  const PHASE_KEY = { [PHASE_SETUP]: 'setup', [PHASE_AIRBORNE]: 'airborne', 0: 'movement', 1: 'combat', 2: 'endOfTurn' }
  const phaseKeys = computed(() => {
    if (!assisted.value) return []
    if (phaseStep.value === PHASE_SETUP) return ['setup']
    const keys = customPhases ? activePhases().map((entry) => entry.id) : ['movement']
    if (!customPhases && structure.combatPhase) keys.push('combat')
    if (structure.endOfTurnPhase && turnTrackerRef.value?.isLastSideOfTurn) keys.push('endOfTurn')
    // Tour commencé par une phase Airborne : son marqueur en tête.
    if (airborneThisStep.value) keys.unshift('airborne')
    return keys
  })
  const phaseLabels = computed(() => phaseKeys.value.map((key) => {
    const custom = customPhases?.find((entry) => entry.id === key)
    return custom ? mt(custom.label) : t(`phases.${key}`)
  }))

  // Index du marqueur ALLUMÉ dans `phaseLabels` (cf. TurnTracker.vue, prop
  // `phaseIndex`) : la position de la phase en cours dans cette liste (par
  // sa clé, cf. `phaseKeys`) — qui dépend des marqueurs présents (Airborne en tête décale tout
  // d'un cran ; une phase Combat absente fait remonter la Fin de tour).
  // `null` hors mode Assisté.
  const phaseIndex = computed(() => {
    if (!assisted.value) return null
    const custom = customPhases?.[customIndexOf(phaseStep.value)]
    return phaseKeys.value.indexOf(custom ? custom.id : PHASE_KEY[phaseStep.value])
  })

  // Dès que le camp/tour actif change — que ce soit via NOTRE propre appel
  // à `nextTurn()` plus bas, via une synchronisation multijoueur
  // (`applyRemoteTurn`, piloté par le serveur), ou via un rejeu de journal
  // — on repart forcément en phase Mouvement : une phase Combat n'a de
  // sens que pour le camp qui vient de jouer son Mouvement, jamais pour un
  // camp qui n'a pas encore agi à ce tour. Le même changement de pas remet
  // aussi à zéro les MP dépensés par TOUTES les unités (cf. `spentMp` plus
  // bas) : les points de mouvement ne se reportent jamais d'un tour/camp
  // sur l'autre, chacun reparties avec son plein potentiel de MP.
  //
  // Techniquement, on observe `turnTrackerRef.value?.currentStep` : Vue
  // traque cette dépendance à travers la ref du template ET la valeur
  // exposée par l'instance enfant, donc ce watcher se redéclenche bien à
  // chaque changement de pas, d'où qu'il vienne.
  //
  // `flush: 'sync'` : le watcher s'exécute IMMÉDIATEMENT au changement de
  // pas, et non plus "un peu plus tard" (au prochain cycle de rendu, le
  // comportement par défaut de Vue). Indispensable pour le REJEU du journal
  // (cf. HexMap.vue::fastForwardReplay) : l'avance rapide applique d'une
  // traite "changement de tour" PUIS "passage en phase Combat" PUIS "MP
  // dépensés"... Avec un watcher différé, cette remise à zéro serait arrivée
  // APRÈS coup et aurait écrasé la phase et les MP que le rejeu venait tout
  // juste de rétablir (cf. `setPhase`/`setSpentMp` plus bas).
  watch(() => turnTrackerRef.value?.currentStep, () => {
    // Phase Airborne si le nouveau camp actif a des aéroportés à poser,
    // sinon Mouvement (cf. `startSidePhase`).
    startSidePhase()
    spentMp.value = new Map()
  }, { flush: 'sync' })

  // Nombre d'unités déjà ENTRÉES EN JEU ce TOUR-CI par hex d'entrée ("col,row"
  // -> compteur) — cf. section "Congestion des hex d'entrée" plus bas. Remis
  // à zéro à chaque nouveau NUMÉRO DE TOUR (pas à chaque changement de camp
  // comme `spentMp` ci-dessus : "le même tour" au sens de cette règle couvre
  // les deux camps qui s'y relaient, cf. TurnTracker.vue::currentTurn).
  const entryCounts = ref(new Map())

  // Pour chaque pion actuellement compté dans `entryCounts` : par quel hex
  // il est entré (id du pion -> clé "col,row") — permet à `unspendEntryCost`
  // de décrémenter le BON compteur si ce pion est "replacé" aux renforts
  // avant la fin du tour (cf. HexMap.vue::returnCounterToReinforcements).
  // Remis à zéro EN MÊME TEMPS que `entryCounts` (même watcher juste
  // en-dessous) : un pion replacé un tour PLUS TARD ne doit rien
  // décrémenter, sa propre entrée ne comptait de toute façon plus dans la
  // congestion d'un tour aussi ancien.
  const entryHexByUnit = ref(new Map())

  // `flush: 'sync'` pour la même raison que le watcher de `currentStep`
  // plus haut : au rejeu rapide du journal, les entrées en jeu rejouées
  // juste après un changement de tour rétablissent la congestion (cf.
  // HexMap.vue::applyReplayEntry) — un watcher différé l'effacerait ensuite.
  watch(() => turnTrackerRef.value?.currentTurn, () => {
    entryCounts.value = new Map()
    entryHexByUnit.value = new Map()
  }, { flush: 'sync' })

  // Libellé affiché SUR le bouton "suivant" de la ligne "phases", pour que
  // l'utilisateur sache toujours à l'avance ce que le prochain clic va
  // déclencher (cf. les 3 cas listés plus haut). `null` hors mode Assisté :
  // TurnTracker.vue retombe alors sur son titre par défaut ("Tour suivant").
  // Libellés traduits dans la langue de l'interface (cf. src/i18n, section
  // `phaseButton`) : "Nouvelle phase", "Autre joueur", "Fin de tour",
  // "Nouveau tour".
  const nextLabel = computed(() => {
    if (!assisted.value) return null
    // Airborne -> Mouvement, ou Mouvement -> Combat : même camp, même tour.
    if (phaseStep.value === PHASE_SETUP) return t('phaseButton.newTurn')
    if (phaseStep.value === PHASE_AIRBORNE) return t('phaseButton.newPhase')
    // Phases entremêlées : même phase pour l'autre camp, phase suivante, ou
    // nouveau tour (cf. lib/turnTrack.js).
    const slot = turnTrackerRef.value?.currentSlot
    if (slot) {
      const next = turnTrackerRef.value?.nextSlot
      if (!next || next.turn !== slot.turn) return t('phaseButton.newTurn')
      return next.phase === slot.phase ? t('phaseButton.otherPlayer') : t('phaseButton.newPhase')
    }
    // Phases du module : "Nouvelle phase" jusqu'à la dernière de la liste.
    const phases = activePhases()
    const customIndex = activeIndexOf(phaseStep.value)
    if (customIndex >= 0) return customIndex < phases.length - 1 ? t('phaseButton.newPhase') : sideEndLabel()
    if (phaseStep.value === 0) return structure.combatPhase ? t('phaseButton.newPhase') : sideEndLabel()
    // Fin de la dernière phase du camp (Combat) : cf. `sideEndLabel`.
    if (phaseStep.value === 1) return sideEndLabel()
    // phaseStep === 2 : Fin de tour, uniquement atteignable pour le dernier
    // camp de l'ordre (cf. `advance` ci-dessous) — le clic suivant boucle
    // forcément sur le 1er camp de l'ordre, donc sur un nouveau tour.
    return t('phaseButton.newTurn')
  })

  /** Libellé du bouton quand le camp actif termine SA DERNIÈRE PHASE (le
   *  Combat, ou le Mouvement pour un module sans phase Combat) : le dernier
   *  camp de l'ordre ouvre la Fin de tour si le module
   *  en a une (cas 3 ci-dessus), sinon il fait directement commencer le tour
   *  suivant ; les autres camps rendent la main au camp suivant (cas 2). */
  function sideEndLabel() {
    if (!turnTrackerRef.value?.isLastSideOfTurn) return t('phaseButton.otherPlayer')
    return structure.endOfTurnPhase ? t('phases.endOfTurn') : t('phaseButton.newTurn')
  }

  /** Ce que fait le bouton quand le camp actif termine SA DERNIÈRE PHASE (cf.
   *  `sideEndLabel` pour les mêmes cas) : ouvrir la Fin de tour (dernier camp
   *  de l'ordre, module qui en a une) — le pas courant de TurnTracker.vue ne
   *  bouge PAS encore, c'est le clic SUIVANT qui le fera avancer — ou bien
   *  redemander directement à TurnTracker.vue d'avancer au camp suivant. */
  function endSide() {
    if (structure.endOfTurnPhase && turnTrackerRef.value?.isLastSideOfTurn) {
      phaseStep.value = 2
      return
    }
    turnTrackerRef.value?.nextTurn()
  }

  // Gestionnaire de clic pour le bouton "suivant" de la ligne "phases"
  // (branché sur l'évènement `phase-next` émis par TurnTracker.vue — cf.
  // ce fichier, qui n'implémente pas lui-même cette décision).
  function advance() {
    // Fin de la mise en place : tour 1 (le watcher de `currentStep` remet la
    // phase de départ du camp suivant).
    if (phaseStep.value === PHASE_SETUP) {
      turnTrackerRef.value?.nextTurn()
      return
    }
    // Phases entremêlées : chaque pas ne compte qu'une phase, on passe au
    // créneau suivant (l'autre camp, ou la phase suivante).
    if (turnTrackerRef.value?.currentSlot) {
      turnTrackerRef.value.nextTurn()
      return
    }
    if (phaseStep.value === PHASE_AIRBORNE) {
      // Fin de la phase Airborne : on passe au Mouvement du même camp — le
      // pas courant de TurnTracker.vue ne bouge pas.
      phaseStep.value = firstStep()
      return
    }
    // Phases du module : la suivante de la liste, ou fin du tour du camp.
    const phases = activePhases()
    const customIndex = activeIndexOf(phaseStep.value)
    if (customIndex >= 0) {
      if (customIndex < phases.length - 1) phaseStep.value = phases[customIndex + 1].step
      else endSide()
      return
    }
    if (phaseStep.value === 0) {
      // Cas 1 : on ne fait QUE passer à la phase Combat du même camp — le
      // pas courant de TurnTracker.vue ne bouge pas. Module SANS phase
      // Combat : le Mouvement était la dernière phase du camp (cf. `endSide`).
      if (structure.combatPhase) phaseStep.value = 1
      else endSide()
      return
    }
    if (phaseStep.value === 1) {
      // Cas 3 (dernier camp de l'ordre : on ouvre la Fin de tour, phase du
      // TOUR entier, avant de rendre la main) ou cas 2 (autre camp : on
      // avance directement au camp suivant, même tour) — cf. `endSide`.
      endSide()
      return
    }
    // Cas 4 (phaseStep === 2, Fin de tour) : elle se termine, on redemande
    // à TurnTracker.vue d'avancer au camp suivant — mécaniquement le 1er de
    // l'ordre, donc un nouveau tour. Le watcher ci-dessus se chargera de
    // remettre `phaseStep` à 0 en réaction à ce changement de pas — inutile
    // de le faire nous-mêmes ici, ce qui évite un double travail si jamais
    // `nextTurn()` ne fait rien (ex. dernier pas de la partie : il s'arrête
    // alors silencieusement, cf. TurnTracker.vue::nextTurn).
    turnTrackerRef.value?.nextTurn()
  }

  // --- Points de mouvement (MP) et coût de terrain (COT) ---------------------
  // En mode Assisté, un pion ne peut entrer dans un hex QUE s'il lui reste
  // assez de MP pour en payer le COT — sinon le clic sur cet hex (cf.
  // HexMap.vue::onHex, branche "pion sélectionné + hex adjacent") ne fait
  // rien, comme si l'hex n'était pas une destination valide. Concrètement :
  //   1. avant le déplacement, HexMap.vue appelle `canEnterHex(pion, hex)` —
  //      s'il répond `false`, HexMap.vue n'effectue PAS le déplacement ;
  //   2. si le déplacement a bien lieu, HexMap.vue appelle `spendMp(pion,
  //      hex)` juste après, pour déduire le COT de l'hex des MP du pion.
  // Un pion peut ainsi enchaîner plusieurs hex (cf. onHex, qui le laisse
  // sélectionné après chaque déplacement) tant qu'il lui reste assez de MP à
  // chaque nouvelle entrée — les MP non dépensés ne servent à rien d'autre
  // et sont remis à leur maximum au tour/camp suivant (cf. watcher plus haut,
  // qui vide `spentMp`).
  //
  // Chaque pion a un total de MP fixe déclaré dans le module JSON (`c.mov`,
  // ex. 7 pour une infanterie). Certains
  // pions (marqueurs, cf. lib/units.js::isUnit) n'ont pas de `mov` du tout :
  // dans ce cas, `remainingMp` ci-dessous répond systématiquement "illimité"
  // plutôt que "zéro MP", pour ne jamais bloquer un pion que le module ne
  // fait pas participer au système de MP.

  /** Nature ("road", "river"... — cf. `terrain.edges.kinds`) de l'ARÊTE
   *  précise entre `from` et `h` pour un DÉPLACEMENT — une connexion PRÉCISE
   *  entre deux hex donnés, jamais juste "cet hex touche une route/un cours
   *  d'eau". `null` si `from` est absent ou si cette paire d'hex précise
   *  n'est reliée par AUCUNE couche déclarée (même si l'un des deux, voire
   *  les deux, en touche une ailleurs, sur un autre de ses côtés).
   *
   *  Quand PLUSIEURS natures sont posées sur la même arête, c'est la
   *  première de `terrain.edges.movementPriority` qui fait foi. Par exemple,
   *  du plus fort au plus faible :
   *   0. AVANT toute priorité, un ruisseau/une rivière SANS pont COUPE la
   *      route ou la piste qui le traverse (`severs`/`spans`, cf.
   *      lib/edges.js) : l'arête ne vaut plus que ruisseau — +3 MP sur le
   *      coût du terrain de `h` (pas le coût de route), interdite aux
   *      véhicules. Ex. une piste qui franchit un ruisseau sans pont ;
   *   1. route > piste : une route/piste qui franchit un ruisseau SUR UN
   *      PONT -> on suit son coût, PAS le surcoût de ruisseau (cf.
   *      `terrainCost`) ;
   *   2. pont (canal/chemin de fer/route, peu importe lequel) — s'il n'y a ni
   *      route ni piste déclarée par-dessus (rare : la plupart des ponts
   *      routiers SONT aussi une route/piste, déjà couverts ci-dessus) ;
   *   3. bac — s'il n'y a ni route/piste ni pont ;
   *   4. rivière — s'il n'y a ni pont ni bac : arête infranchissable (cf.
   *      `canEnterTerrain`, "River Prohibited" du module) ;
   *   5. ruisseau — dernier recours, franchissable à gué par tout le monde
   *      sauf les véhicules (cf. `canEnterTerrain`).
   *
   *  Factorisé ici car utilisé à la fois par `terrainCost` (coût) et par
   *  `canEnterTerrain` plus bas (route/piste/pont = exception au terrain —
   *  et, pour les véhicules, au ruisseau/à la rivière — autrement
   *  infranchissable). */
  function edgeKind(from, hex) {
    if (!from) return null
    const key = edgeKeyOf(from, hex)
    // Pont DÉMOLI (cf. `isDemolished`) : il ne reste que l'obstacle qu'il
    // franchissait, et aucune des autres couches de l'arête ne tient plus —
    // la route qui l'empruntait est coupée avec lui.
    if (isDemolished(key)) return edges.revealedKind(key)
    return edges.movementKind(key)
  }

  /** TOUTES les natures de l'hexside `from` -> `h` (cf. lib/edges.js::
   *  kindsOf), et non la seule qui fait foi : une règle peut avoir besoin de
   *  savoir qu'une route franchit un ruisseau, ce que les priorités masquent.
   *  Un pont DÉMOLI ne laisse que l'obstacle qu'il franchissait (cf.
   *  `edgeKind`) : ni le pont, ni la route qui l'empruntait. Exportée pour
   *  lib/useSupplyLine.js. */
  function edgeKinds(from, hex) {
    if (!from) return []
    const key = edgeKeyOf(from, hex)
    if (isDemolished(key)) {
      const revealed = edges.revealedKind(key)
      return revealed ? [revealed] : []
    }
    return edges.kindsOf(key)
  }

  /** Nature de l'hexside `from` -> `h` DU POINT DE VUE DU COMBAT (cf.
   *  lib/useCombat.js) et de la ZOC (cf. `edgeBlocksZoc`) : la première de
   *  `terrain.edges.combatPriority` présente sur l'arête, ou `null`. Cet
   *  ordre peut différer de celui du mouvement (cf. `edgeKind`, pensé pour
   *  le COÛT). Par exemple :
   *   - 'bridge' : un pont enjambe l'obstacle. EN PREMIER, car la plupart des
   *     ponts sont AUSSI déclarés comme route, que `edgeKind` ferait alors
   *     passer d'abord ("road") ; au combat, sa ligne de table ("Grove,
   *     Bridge") remplace celle du terrain (cf. `module.combat.edgeRows`) ;
   *   - 'river' : rivière SANS pont — l'attaque à travers cet hexside est
   *     INTERDITE (`blocksAttack`, règle validée avec l'utilisateur,
   *     cohérente avec la ZOC qui ne s'y étend pas non plus, `blocksZoc`).
   *     Un BAC n'y change rien : ce n'est pas un pont (absent de la liste) ;
   *   - 'road' / 'trail' : passage aménagé, donc pas un obstacle — aucune
   *     propriété de combat, la ligne du terrain de l'hex s'applique. Une
   *     route/piste qui traverse un ruisseau SANS pont est coupée (cf.
   *     `edgeKind`) : c'est alors le ruisseau qui compte ;
   *   - 'stream' : ruisseau nu, qui remplace la ligne de terrain sur la
   *     table de combat si TOUS les attaquants le franchissent ;
   *   - `null` sinon (hexside ordinaire, sans particularité).
   *  Exportée (cf. `return` plus bas) pour lib/useCombat.js. */
  function combatEdgeKind(from, hex) {
    if (!from) return null
    const key = edgeKeyOf(from, hex)
    if (isDemolished(key)) return edges.revealedKind(key) // cf. `edgeKind`
    return edges.combatKind(key)
  }

  /** Peut-on ATTAQUER à travers l'hexside `from` -> `h` ? Non si sa nature
   *  de combat (cf. `combatEdgeKind`) est déclarée `blocksAttack` (ex.
   *  rivière sans pont). Exportée pour lib/useCombat.js. */
  function edgeBlocksAttack(from, hex) {
    return !!edges.kindOf(combatEdgeKind(from, hex))?.blocksAttack
  }

  /** Coût (en MP) pour ENTRER dans l'hex `h` ({ c, r }, 0-based/1-based comme
   *  partout dans HexMap.vue) en VENANT de l'hex `from` (même forme, optionnel).
   *
   *  Règle des arêtes (cf. `edgeKind` ci-dessus, qui choisit LA nature qui
   *  fait foi) : si cette nature déclare un coût fixe (`mp` — route 0.5,
   *  piste 1), c'est lui qui s'applique, À LA PLACE du coût du
   *  terrain ; sinon, coût normal de `h` PLUS son éventuel surcoût
   *  (`extraMp` — gué de ruisseau ou bac : ex. +3, soit 2 MP de
   *  terrain + 3 = 5). Un pont ("No add MP" sur une table de terrain) n'a
   *  ni l'un ni l'autre : coût normal de `h`. Une rivière sans
   *  pont ni bac donne le coût normal de `h`, valeur purement indicative
   *  (cf. `canEnterTerrain`, qui refuse de toute façon cette arête à TOUT LE
   *  MONDE — `impassable`). Sans `from` (ex. appel générique sans connaître
   *  la provenance), toujours le coût normal du terrain.
   *
   *  Coût normal (sans rien de tout ça) : lu dans `terrain.grid[hexId]` (le
   *  type de terrain de `h`) puis `terrain.types[type].mp`. 1 par défaut si
   *  le module ne déclare pas de `terrain` (pas encore enrichi) ou si cet
   *  hex précis n'a pas de type déclaré.
   *
   *  Exportée (cf. `return` plus bas) pour être réutilisée telle quelle par
   *  lib/useDebug.js (affichage du COT des hex adjacents et calcul de la
   *  portée de déplacement en mode debug) — seule source de vérité pour un
   *  coût de terrain, à ne jamais dupliquer ailleurs. */
  function terrainCost(hex, from) {
    const edge = edges.kindOf(edgeKind(from, hex))
    if (edge?.mp != null) return edge.mp
    return terrainAreaCost(hex) + (edge?.extraMp ?? 0)
  }

  /** Coût "de zone" de `h`, sans tenir compte d'une éventuelle arête
   *  empruntée pour y entrer — cf. `terrainCost` ci-dessus, qui applique
   *  cette valeur quand l'arête ne déclare pas de coût fixe. */
  function terrainAreaCost(hex) {
    const type = terrain?.grid?.[hexId(hex.c + 1, hex.r)]
    return terrain?.types?.[type]?.mp ?? 1
  }

  /** MP qu'il reste à `c` pour la suite de son mouvement ce tour-ci. `null`
   *  si le module ne déclare pas de MP pour ce pion (`c.mov` absent) — dans
   *  ce cas précis, `canEnterHex` ci-dessous n'impose AUCUNE restriction
   *  (mouvement illimité, comme avant l'ajout des MP), pour ne pas casser
   *  les modules qui ne modélisent pas encore ce système. Exportée (cf.
   *  `return` plus bas) pour être réutilisée par lib/useDebug.js (portée de
   *  déplacement en mode debug — jusqu'où `c` peut aller avec ce qu'il lui
   *  reste de MP), en plus de son usage interne par `canEnterHex`. */
  function remainingMp(counter) {
    const mov = movementAllowance(counter)
    if (mov == null) return null
    return mov - (spentMp.value.get(String(counter.id)) ?? 0)
  }

  /** Potentiel de mouvement (MP) de `counter` CE tour-ci : celui que la piste
   *  de tour impose à toute unité combattante (`turnInfo.movement`, cf.
   *  lib/turnTrack.js — ex. 2 hex de nuit, 1 de jour à la mer de Corail),
   *  sinon son `mov` propre ; `null` si aucun des deux (mouvement libre). */
  function movementAllowance(counter) {
    const special = moduleRules.movementAllowance?.(counter, turnTrackerRef.value?.currentTurnInfo)
    if (special != null) return special
    const turnMovement = turnTrackerRef.value?.currentTurnInfo?.movement
    if (turnMovement != null && isFighter(counter)) return turnMovement
    return counter?.mov ?? null
  }

  // --- Zone de Contrôle (ZOC) -------------------------------------------------
  // Règle : les 6 hex autour d'un pion constituent sa ZOC — SAUF à travers un
  // hexside dont la nature de combat est déclarée `blocksZoc` (cf.
  // `edgeBlocksZoc` plus bas). Ex. la RIVIÈRE sans pont : elle
  // coupe la ZOC tout comme elle coupe le mouvement (cf. `canEnterTerrain`),
  // un pont (canal/chemin de fer/route) la rétablit. Un hexside de RUISSEAU
  // ou de CANAL (pas de barrière propre dans les données du module : seuls
  // ses ponts, `canalBridges`, y sont déclarés) n'interrompt PAS la ZOC, qui
  // s'étend normalement à travers eux — seule une rivière SANS pont bloque. Un pion
  // qui COMMENCE sa phase de Mouvement dans la ZOC d'un pion ennemi ne peut pas
  // bouger DU TOUT ce tour-ci ; un pion qui ENTRE dans une ZOC ennemie (en
  // partant d'un hex hors ZOC) doit s'y arrêter — aucun déplacement
  // supplémentaire ce tour-ci, même s'il lui reste des MP.
  //
  // Ces deux règles sont déclarées par le module (`rules.zoc`, cf.
  // lib/rules.js) : `lockIfStarting` pour la 1re, `stopOnEntry` pour la 2e —
  // un module peut n'en garder qu'une. Pour les distinguer, on regarde si
  // l'unité a DÉJÀ BOUGÉ ce tour-ci (cf. `hasMovedThisTurn` : des MP ont
  // été dépensés — mouvement, entrée en jeu, atterrissage) : si non, elle
  // COMMENCE son mouvement là (1re règle) ; si oui, elle vient d'y ENTRER (2e
  // règle). Cf. `isZocFrozen`.
  //
  // Avec les deux règles, elles se ramènent en fait à UNE
  // SEULE, appliquée dans `canEnterHex` plus bas : "si l'hex QUITTÉ (`from`)
  // est sous ZOC ennemie, aucun déplacement n'est autorisé, quel que soit
  // `h`" :
  //   - en tout DÉBUT de tour, `from` = la position actuelle du pion (il n'a
  //     encore rien parcouru) -> s'il y est déjà en ZOC ennemie, ce test
  //     bloque IMMÉDIATEMENT tout déplacement (1re règle) ;
  //   - un pion qui vient de bouger et se retrouve maintenant dans une ZOC
  //     ennemie (le déplacement qui l'y a fait ENTRER reste autorisé : `from`
  //     de CE déplacement-là n'était pas encore en ZOC) verra son `from`
  //     passer à cette case pour tout nouveau déplacement -> bloqué au
  //     prochain clic (2e règle, "doit s'arrêter").
  //
  // Seules les vraies unités de combat projettent une ZOC (ni les marqueurs,
  // ni les pions de soutien, ressource commune sans "camp" au sens du jeu).

  /** Camp ("side", cf. `sides` — ex. { german: [...], allies: [...] })
   *  auquel appartient la faction `faction`, ou `null` si `sides` n'est pas
   *  déclaré par le module, ou si cette faction n'apparaît dans aucun camp
   *  déclaré (repli, cf. `isEnemyOf`). */
  function sideOfFaction(faction) {
    if (!sides) return null
    for (const key of Object.keys(sides)) {
      if (sides[key]?.includes(faction)) return key
    }
    return null
  }

  /** `a` et `b` (deux pions) sont-ils ennemis ? Basé sur `sides` (même
   *  regroupement camp/factions que TurnTracker.vue pour la restriction de
   *  tour) : ennemis si leurs camps diffèrent. Repli sur une simple
   *  comparaison de faction si `sides` n'est pas déclaré par le module.
   *  Exportée (cf. `return` plus bas) pour être réutilisée telle quelle par
   *  HexMap.vue (repli d'entrée en jeu d'un renfort — cf.
   *  entryHexSet/isEntryHexBlocked : un hex d'entrée occupé par un ennemi,
   *  ou par un ami figé dans une ZOC ennemie, redirige vers un hex voisin). */
  function isEnemyOf(counterA, counterB) {
    const sa = sideOfFaction(counterA?.faction)
    const sb = sideOfFaction(counterB?.faction)
    if (sa != null && sb != null) return sa !== sb
    return counterA?.faction !== counterB?.faction
  }

  /** Le hexside précis entre `a` et `b` ({ col, row } 0-based/1-based, ex.
   *  un pion et l'un de ses voisins) coupe-t-il la ZOC ? Vrai si sa nature
   *  de combat (cf. `combatEdgeKind` — même ordre de priorité) est déclarée
   *  `blocksZoc`. Ex. une arête de RIVIÈRE qui n'est PAS
   *  un pont (le pont, prioritaire, la rétablit) : un BAC n'en est pas un,
   *  une rivière traversée par bac coupe donc quand même la ZOC. Un hexside
   *  de ruisseau ou de canal (jamais lui-même dans les données du module,
   *  seuls ses ponts `canalBridges` le sont) n'est PAS concerné : la ZOC
   *  s'étend normalement à travers eux. */
  function edgeBlocksZoc(counterA, counterB) {
    const from = { c: counterA.col, r: counterA.row }
    return !!edges.kindOf(combatEdgeKind(from, { c: counterB.col, r: counterB.row }))?.blocksZoc
  }

  /** Ensemble ("col,row") de tous les hex sous ZOC ennemie de `c` — union
   *  des 6 hex VOISINS (jamais l'hex du pion ennemi lui-même) de chaque
   *  pion actuellement posé sur la carte (`counters`) qui est ennemi de `c`
   *  (cf. `isEnemyOf`) et qui projette une ZOC (pas un marqueur, pas un pion
   *  de soutien) — sauf à travers un hexside qui coupe la ZOC (cf.
   *  `edgeBlocksZoc` ci-dessus — ex. rivière sans pont). `c` lui-même et ses propres alliés n'y contribuent
   *  jamais. Set VIDE si `c` est `null`/absent.
   *
   *  Exportée (cf. `return` plus bas) pour être réutilisée telle quelle par
   *  HexMap.vue (surlignage des hex sous ZOC ennemie, visible en mode
   *  Assisté dès qu'un pion est sélectionné) et par lib/useDebug.js (calcul
   *  de portée : un hex sous ZOC ennemie ne laisse plus continuer le
   *  chemin au-delà de lui) — calculée UNE SEULE FOIS par ces appelants
   *  plutôt qu'à chaque hex testé individuellement. */
  /** `c` a-t-il déjà bougé ce tour-ci ? Oui dès qu'il a dépensé des MP
   *  (déplacement, coût d'entrée en jeu, MP d'atterrissage d'un aéroporté —
   *  cf. `spentMp`) ; "Annuler le mouvement" le remet à zéro (cf. `resetMp`).
   *  Sert à distinguer, pour la ZOC, une unité qui COMMENCE son mouvement en
   *  ZOC ennemie d'une unité qui vient d'y ENTRER (cf. `isZocFrozen`). Un pion
   *  sans MP déclarés (`mov` absent) n'en dépense jamais : il est toujours
   *  considéré comme "au départ". */
  function hasMovedThisTurn(counter) {
    return (spentMp.value.get(String(counter?.id)) ?? 0) > 0
  }

  /** La règle de ZOC du module fige-t-elle `c` dans l'hex `hexKey` ("col,row"),
   *  s'il y est sous ZOC ennemie ? `lockIfStarting` s'il n'a pas encore bougé
   *  ce tour-ci, `stopOnEntry` s'il vient d'y entrer (cf. en-tête de section). */
  function zocLocks(counter) {
    return hasMovedThisTurn(counter) ? rules.zoc.stopOnEntry : rules.zoc.lockIfStarting
  }

  /** `c` (DÉJÀ posé sur la carte) est-il FIGÉ sur place par une ZOC ennemie ?
   *  Il faut qu'il soit dans une ZOC ennemie ET que la règle du module l'y
   *  retienne (cf. `zocLocks`). Exportée pour HexMap.vue (un ami figé bloque
   *  l'hex d'entrée d'un renfort, cf. isEntryHexBlocked) et lib/useDebug.js
   *  (portée de déplacement : rien n'est exploré depuis un pion figé). */
  function isZocFrozen(counter) {
    if (!counter) return false
    return enemyZocSet(counter).has(counter.col + ',' + counter.row) && zocLocks(counter)
  }

  function enemyZocSet(counter) {
    const set = new Set()
    if (!counter) return set
    for (const other of counters.value) {
      if (!isFighter(other)) continue
      if (!isEnemyOf(counter, other)) continue
      for (const neighbor of neighborsOf(other.col, other.row)) {
        if (edgeBlocksZoc(other, neighbor)) continue
        set.add(neighbor.col + ',' + neighbor.row)
      }
    }
    return set
  }

  // --- Empilement (stacking) au mouvement normal -----------------------------
  // Une unité ne peut jamais TERMINER sa phase de Mouvement sur un hex occupé
  // par une unité AMIE. Comme on ne sait pas À L'AVANCE si tel hex sera la
  // dernière case du déplacement, la règle se vérifie à CHAQUE pas : entrer
  // dans un hex ami n'est autorisé QUE si l'unité peut ENSUITE en repartir ce
  // même tour (cf. `canLeaveAfterEntering`) — sinon, y entrer la "coincerait"
  // définitivement avec son amie. Ne concerne QUE le mouvement normal d'un
  // pion déjà sur la carte (cf. HexMap.vue::onHex) — pas l'entrée en jeu d'un
  // renfort, qui a ses propres règles de blocage (cf. HexMap.vue::
  // isEntryHexBlocked : ennemi, ou ami figé en ZOC).
  //
  // Exception (règle validée) : un ami qui N'A PAS ENCORE BOUGÉ dans cette
  // phase de Mouvement, et qui peut encore partir, ne compte pas — c'est LUI
  // qui libérera l'hex en jouant son mouvement ensuite (cf. `willMakeRoom`).
  // L'unité qui le rejoint peut donc s'y arrêter. Si l'ami ne bouge
  // finalement pas, le contrôle de fin de phase (cf. `stackedHexes`, qui
  // compte TOUTES les unités) refuse de quitter la phase.

  /** Nombre d'unités AMIES de `c` (même camp, cf. `isEnemyOf` — `c` lui-même
   *  exclu) déjà présentes dans `h`. Marqueurs et pions de soutien ignorés,
   *  ni amis ni ennemis au sens de cette règle — pas plus que les pions
   *  qu'une règle du module dispense de la limite (cf.
   *  `moduleRules.stackingExempt` : ex. une unité peut terminer sa phase
   *  dans l'hex d'un génie, qui ne l'encombre pas), ni
   *  les amis qui vont encore partir (cf. `willMakeRoom`). */
  function friendlyCount(counter, hex) {
    return counters.value.filter(
      (other) => other.col === hex.c && other.row === hex.r && other.id !== counter?.id && isFighter(other) && !isEnemyOf(counter, other)
        && moduleRules.stackingExempt?.(other) !== true && !willMakeRoom(other)
    ).length
  }

  /** `friend`, déjà posé sur la carte, libérera-t-il son hex plus tard dans
   *  la phase ? Il faut, dans l'ordre :
   *   1. être en phase de Mouvement (pas la phase Airborne : le contrôle de
   *      fin de phase, cf. `stackedHexes`, ne vaut que pour le Mouvement) ;
   *   2. appartenir au camp actif (cf. `canControl`) — lui seul joue ;
   *   3. N'AVOIR PAS ENCORE BOUGÉ cette phase (cf. `hasMovedThisTurn` — les
   *      MP sont remis à zéro à chaque changement de camp) ;
   *   4. ne pas être figé par une ZOC ennemie (cf. `isZocFrozen`) ;
   *   5. pouvoir faire au moins un pas avec ses MP (cf. `hasExitWithMp`) —
   *      un pion sans MP déclarés (`mov` absent) peut toujours partir. */
  function willMakeRoom(friend) {
    if (phaseStep.value !== 0 || !canControl(friend)) return false
    if (hasMovedThisTurn(friend) || isZocFrozen(friend)) return false
    const remaining = remainingMp(friend)
    if (remaining == null) return true
    return hasExitWithMp(friend, { c: friend.col, r: friend.row }, remaining)
  }

  /** `c` serait-il EN SURPLUS d'empilement en s'arrêtant dans `h` ? Oui si
   *  `h` contient déjà autant d'unités amies que la limite du module
   *  (`rules.stackingLimit`, 1 par défaut : "une unité ne peut jamais
   *  terminer sa phase de Mouvement sur un hex occupé par une unité amie").
   *  Exportée (cf. `return` plus bas) pour être réutilisée par HexMap.vue
   *  (surlignage vert du premier pas, clic de mouvement, entrée d'un
   *  renfort) et lib/useDebug.js (portée complète en mode debug) — même
   *  définition partout. */
  function wouldOverstack(counter, hex) {
    return friendlyCount(counter, hex) >= rules.stackingLimit
  }

  /** `c` peut-il, après être entré dans `h` en venant de `from` (et avoir
   *  payé le coût de terrain de `h`, cf. `terrainCost`), faire AU MOINS UN
   *  déplacement de plus ce tour-ci ? Il lui faut, dans l'ordre :
   *   1. encore des MP après avoir payé pour `h` (`remainingMp` ne suit pas
   *      de MP pour `c` -> jamais concerné par cette contrainte, cf. `null`) ;
   *   2. ne pas se retrouver figé en ZOC ennemie SUR `h` (cf. `enemyZocSet`
   *      — sinon, plus aucun mouvement n'est de toute façon possible, quels
   *      que soient ses MP) ;
   *   3. au moins un hex voisin de `h` qui soit à la fois franchissable (cf.
   *      `canEnterTerrain`) et abordable avec les MP qu'il lui resterait —
   *      peu importe si CE voisin est lui-même libre ou pas (on ne vérifie
   *      qu'UN pas en avant, pas tout un chemin jusqu'à la fin du tour).
   *  Exportée (cf. `return` plus bas), même raison que `wouldOverstack`. */
  function canLeaveAfterEntering(counter, hex, from) {
    const remaining = remainingMp(counter)
    if (remaining == null) return true
    return canLeaveWithMp(counter, hex, remaining - terrainCost(hex, from))
  }

  /** Même question que `canLeaveAfterEntering`, mais pour un RENFORT qui
   *  ENTRE EN JEU sur `h` (cf. HexMap.vue::entryHexSet) plutôt que pour un
   *  pion qui s'y déplace : ce qu'il paie pour arriver n'est pas le coût de
   *  terrain depuis un hex voisin (il vient de "hors carte"), mais :
   *   - le coût d'ENTRÉE de `h`, congestion comprise (cf. `entryCost`), si
   *     `paysEntry` est vrai (renfort de bord de carte) ;
   *   - rien du tout si `paysEntry` est faux (aéroporté "+adj", qui ne paie
   *     aucun coût d'entrée, cf. HexMap.vue::onHex).
   *  Règle validée : un renfort ne peut PAS entrer sur l'hex d'un ami s'il
   *  ne pourrait pas en repartir ensuite — sinon il y resterait coincé avec
   *  lui, ce que la fin de phase refuserait de toute façon (cf.
   *  `stackedHexes`). Toujours vrai hors mode Assisté. */
  function canLeaveAfterReinforcementEntry(counter, hex, paysEntry) {
    if (!assisted.value) return true
    const remaining = remainingMp(counter)
    if (remaining == null) return true
    return canLeaveWithMp(counter, hex, remaining - (paysEntry ? entryCost(hex) : 0))
  }

  /** Brique commune aux deux fonctions ci-dessus : `c`, posé sur `h` avec
   *  `afterEntry` MP restants, peut-il faire au moins un pas de plus ? Ce
   *  sont les étapes 1 à 3 décrites sur `canLeaveAfterEntering`. */
  function canLeaveWithMp(counter, hex, afterEntry) {
    if (afterEntry <= 0) return false
    // Une fois entré dans `h`, `c` AURA bougé : s'il s'y retrouve en ZOC
    // ennemie, c'est la règle `stopOnEntry` du module qui dit s'il est figé.
    if (rules.zoc.stopOnEntry && enemyZocSet(counter).has(hex.c + ',' + hex.r)) return false
    return hasExitWithMp(counter, hex, afterEntry)
  }

  /** `c`, sur `h` avec `mp` MP, a-t-il au moins un voisin franchissable (cf.
   *  `canEnterTerrain`) et abordable (cf. `terrainCost`) ? Étape 3 de
   *  `canLeaveAfterEntering`, partagée avec `willMakeRoom`. */
  function hasExitWithMp(counter, hex, mp) {
    if (mp <= 0) return false
    return neighborsOf(hex.c, hex.r).some((neighbor) => {
      if (!hexOnMap(neighbor.col, neighbor.row)) return false
      const nh = { c: neighbor.col, r: neighbor.row }
      return canEnterTerrain(counter, nh, hex) && mp >= terrainCost(nh, hex)
    })
  }

  /** `c` (DÉJÀ posé sur la carte) partage-t-il son hex avec au moins une
   *  AUTRE unité amie ? C'est la question "cette unité est-elle en
   *  SURPLUS D'EMPILEMENT (overstack) là où elle se trouve ?".
   *
   *  Différence avec `wouldOverstack(c, h)` : celle-ci regarde un hex `h` où
   *  `c` n'est PAS encore (avant un déplacement) ; ici, `c` est déjà dans
   *  l'hex examiné (sa propre position).
   *
   *  Sert à HexMap.vue::setSelectedCounter : on ne peut pas TERMINER le
   *  mouvement d'une unité (la désélectionner, ou passer à une autre unité /
   *  un renfort) tant qu'elle est en overstack — le joueur doit d'abord la
   *  déplacer ailleurs (ou annuler son mouvement). Marqueurs et pions de
   *  soutien ne comptent jamais (ni amis ni ennemis, cf.
   *  `wouldOverstack`), pas plus qu'un ami qui n'a pas encore bougé et
   *  libérera l'hex (cf. `willMakeRoom`). Toujours faux hors mode Assisté. */
  function isOverstacked(counter) {
    if (!assisted.value || !isFighter(counter)) return false
    return friendlyCount(counter, { c: counter.col, r: counter.row }) >= rules.stackingLimit
  }

  /** EMPILEMENTS EN ATTENTE — filet de sécurité de la même règle, vérifié
   *  cette fois au moment de QUITTER la phase de Mouvement (cf.
   *  HexMap.vue::onPhaseNext, qui refuse alors le changement de phase et
   *  ouvre PhaseBlockedModal.vue).
   *
   *  Pourquoi c'est nécessaire alors que `canLeaveAfterEntering` existe
   *  déjà : ce dernier ne garantit qu'une chose, que l'unité POURRAIT
   *  repartir de l'hex ami — pas qu'elle le fera. Rien n'empêche le joueur
   *  d'entrer sur un hex ami avec des MP de reste, puis de s'arrêter là et de
   *  cliquer "Nouvelle phase". Idem pour un renfort posé sur l'hex d'un ami
   *  (autorisé s'il peut en repartir, cf. `canLeaveAfterReinforcementEntry`)
   *  qui ne bouge plus ensuite. C'est ICI, en fin de phase, que ces cas sont
   *  rattrapés.
   *
   *  Ne comptent que les unités du camp ACTIF (cf. `canControl`) : c'est lui
   *  qui termine sa phase, et lui seul peut encore déplacer ses pions pour
   *  défaire l'empilement. Marqueurs et pions de soutien ignorés (ni amis ni
   *  ennemis, cf. `friendlyCount`). Un hex est listé dès qu'il y a plus
   *  d'unités que la limite d'empilement (`rules.stackingLimit`), AMIES entre
   *  elles (cf. `isEnemyOf`).
   *
   *  Liste vide hors mode Assisté ou hors phase Mouvement. Chaque entrée :
   *  `{ key, hex, units }` — numéro d'hex imprimé et noms des unités
   *  empilées, pour la modale d'avertissement. */
  const stackedHexes = computed(() => {
    if (!assisted.value || phaseStep.value !== 0) return []
    // Regroupement des unités du camp actif par hex ("col,row" -> pions).
    const byHex = new Map()
    for (const counter of counters.value) {
      if (!isFighter(counter) || !canControl(counter)) continue
      const key = counter.col + ',' + counter.row
      if (!byHex.has(key)) byHex.set(key, [])
      byHex.get(key).push(counter)
    }
    const list = []
    for (const [key, units] of byHex) {
      if (units.length <= rules.stackingLimit) continue
      // Au moins une paire AMIE dans l'hex (sans `sides` configurés, deux
      // pions "contrôlables" pourraient en théorie être de camps opposés).
      const friendly = units.some((unitA, unitIndex) => units.slice(unitIndex + 1).some((unitB) => !isEnemyOf(unitA, unitB)))
      if (!friendly) continue
      const [col, row] = key.split(',').map(Number)
      list.push({ key, hex: hexId(col + 1, row), units: units.map((unit) => unit.name) })
    }
    return list
  })

  /** `c`, en venant de `from` ({ c, r }, optionnel), peut-il PHYSIQUEMENT
   *  entrer dans `h` ? Indépendant des MP : même avec des MP à revendre,
   *  l'hex/l'arête reste hors d'atteinte dans les cas ci-dessous.
   *
   *  1. l'arête qui fait foi (cf. `edgeKind`) est déclarée `impassable` :
   *     infranchissable pour TOUT LE MONDE, véhicule ou pas. Ex. :
   *     RIVIÈRE SANS pont ni bac (si l'un des deux — ou une route/piste —
   *     est présent, il passe avant la rivière dans `movementPriority` : ce
   *     n'est plus une traversée "à la nage") — "River Prohibited" sur la
   *     table de terrain du module.
   *
   *  Les blocages restants ne concernent QUE les véhicules (cf.
   *  `rules.vehicleTypes`) — toute autre unité (infanterie, artillerie à pied...)
   *  répond toujours vrai au-delà du cas 1 ci-dessus :
   *
   *  2. l'arête est déclarée `vehicles: false` : ex. RUISSEAU À GUÉ
   *     ou RIVIÈRE PAR BAC — une route/piste qui les traverse sans pont y est
   *     coupée (cf. `edgeKind`) —, un véhicule ne peut les franchir,
   *     contrairement à l'infanterie et assimilés (cf. `terrainCost`,
   *     surcoût pour eux) ; il lui faut un PONT (jamais un simple bac).
   *  3. `h` est d'un terrain interdit aux véhicules (`rules.
   *     impassableForVehicles` — ex. rough/broken/woods) — sauf s'il
   *     y entre par une arête déclarée `vehicles: true` (route, piste ou
   *     pont précis), qui reste toujours praticable même à travers un tel
   *     terrain.
   *
   *  Exportée (cf. `return` plus bas) pour être réutilisée par
   *  lib/useDebug.js (portée de déplacement en mode debug : un hex/une
   *  arête interdit(e) ne doit pas apparaître comme "traversable", véhicule
   *  ou pas selon le cas, même en passant au travers sans s'y arrêter). */
  function canEnterTerrain(counter, hex, from) {
    const edge = edges.kindOf(edgeKind(from, hex))
    // Règle particulière du module : un hexside que le terrain ferme, mais
    // qu'elle ouvre à cette unité-là (cf.
    // lib/moduleRules.js::engineerCrossingAllows — ex. une passerelle du
    // génie sur la rivière). Elle n'ouvre jamais que l'arête : le coût d'entrée de
    // l'hex, lui, se paie normalement (cf. `terrainCost`).
    const bridged = moduleRules.engineerCrossingAllows?.(counter, from, hex) === true
    if (edge?.impassable && !bridged) return false
    // Hex interdit à ce pion par une règle du module (cf. lib/useCoralSea.js
    // — abords de l'aérodrome pour les pions japonais).
    if (moduleRules.hexForbidden?.(counter, { col: hex.c, row: hex.r }) === true) return false
    // Hex coupé (cf. lib/passages.js) : le côté par lequel `counter` est
    // entré dans `from` (`counter.enteredFrom`, tenu par HexMap.vue) doit
    // être de la même couleur que celui par lequel il en sort. Seulement
    // quand `from` est bien sa position actuelle : la portée du mode debug
    // explore d'autres départs, dont on ignore le côté d'entrée.
    if (from && passages.active && counter && from.c === counter.col && from.r === counter.row
      && !passages.allowsTransit(counter.enteredFrom, hexId(from.c + 1, from.r), hexId(hex.c + 1, hex.r))) return false
    if (!rules.vehicleTypes.has(counter?.type)) return true
    if (edge?.vehicles === false) return false
    if (rules.impassableForVehicles.has(terrain?.grid?.[hexId(hex.c + 1, hex.r)])) return edge?.vehicles === true
    return true
  }

  /** `c`, actuellement en `from` ({ c, r }, optionnel — cf. `terrainCost`
   *  pour la règle route/piste que ce paramètre active), peut-il entrer dans
   *  l'hex `h` ? Hors mode Assisté : toujours vrai (mode Libre = bac à
   *  sable, aucune règle de MP, de terrain ni de ZOC). En mode Assisté,
   *  DANS L'ORDRE :
   *   1. si `from` est fourni, sous ZOC ennemie (cf. `enemyZocSet`) ET que la
   *      règle du module l'y retient (cf. `zocLocks` — `lockIfStarting` s'il
   *      commence son tour là, `stopOnEntry` s'il vient d'y entrer), refusé
   *      — QUEL QUE SOIT `h` : ce pion est figé sur place ;
   *   2. faux si le terrain de `h` est interdit à `c` (cf. `canEnterTerrain`
   *      — sauf exception route/piste, qu'elle gère elle-même) ;
   *   3. sinon vrai si `c` ne déclare pas de MP (cf. `remainingMp`), sinon
   *      seulement s'il lui en reste au moins autant que le COT de `h`
   *      (route/piste/ruisseau compris). */
  function canEnterHex(counter, hex, from) {
    if (!assisted.value) return true
    if (from && enemyZocSet(counter).has(from.c + ',' + from.r) && zocLocks(counter)) return false
    if (!canEnterTerrain(counter, hex, from)) return false
    const remaining = remainingMp(counter)
    if (remaining == null) return true
    return remaining >= terrainCost(hex, from)
  }

  /** Déduit de `c` le COT de `h` EN VENANT de `from` (mêmes paramètres et
   *  même règle route/piste que `canEnterHex`/`terrainCost` — toujours
   *  passer le MÊME `from` qu'au `canEnterHex` qui a validé ce déplacement,
   *  sans quoi le coût déduit ne correspondrait pas à celui vérifié) — à
   *  appeler UNE FOIS, juste après que `c` a effectivement été déplacé dans
   *  `h` (jamais avant, et jamais si `canEnterHex` avait répondu `false`).
   *  Ne fait rien hors mode Assisté ni pour un pion sans `mov` déclaré (cf.
   *  `remainingMp`), pour rester cohérent avec ce que `canEnterHex` a
   *  autorisé. */
  function spendMp(counter, hex, from) {
    if (!assisted.value || movementAllowance(counter) == null) return
    const spent = (spentMp.value.get(String(counter.id)) ?? 0) + terrainCost(hex, from)
    spentMp.value = new Map(spentMp.value).set(String(counter.id), spent)
  }

  /** Inverse EXACT de `spendMp` : recrédite `c` du COT de `h` en venant de
   *  `from` — à appeler quand on annule le DERNIER déplacement de `c` (cf.
   *  HexMap.vue, "Retour arrière" de la barre d'outils, disponible en mode
   *  Assisté uniquement — ce bouton disparaît en mode Libre, cf. plus haut).
   *  `h`/`from` sont ici l'hex QUITTÉ par l'annulation et celui d'où `c`
   *  venait à l'époque de ce déplacement (`last.to`/`last.from` côté
   *  HexMap.vue) — PAS la position actuelle de `c` : passer le même couple
   *  qu'au `spendMp` d'origine est ce qui garantit un remboursement exact,
   *  route/piste comprise. Ne fait rien hors mode Assisté ni pour un pion
   *  sans `mov` (en miroir de `spendMp`) : ni l'un ni l'autre n'a jamais pu
   *  débiter de MP dans ces cas, il n'y a donc rien à recréditer.
   *  `Math.max(0, …)` par sécurité (ne devrait jamais aller sous zéro en
   *  usage normal, cf. `spendMp` toujours appelée après un `canEnterHex` qui
   *  a validé le coût). */
  function refundMp(counter, hex, from) {
    if (!assisted.value || movementAllowance(counter) == null) return
    const spent = Math.max(0, (spentMp.value.get(String(counter.id)) ?? 0) - terrainCost(hex, from))
    spentMp.value = new Map(spentMp.value).set(String(counter.id), spent)
  }

  /** Redonne à `c` la TOTALITÉ de ses MP pour ce tour-ci (par opposition à
   *  `refundMp`, qui ne recrédite qu'UN SEUL hex) — à appeler dans 2 cas :
   *   1. "Annuler le mouvement" (menu contextuel, cf. HexMap.vue), qui ramène
   *      directement `c` à sa position de tout début de tour, sans repasser
   *      hex par hex ;
   *   2. "Replacer le pion" (menu contextuel ou depuis "Unités éliminées",
   *      cf. HexMap.vue::returnCounterToReinforcements) — un pion renvoyé
   *      aux renforts doit repartir avec un plein potentiel de MP la
   *      prochaine fois qu'il entrera en jeu, pas avec ce qu'il lui restait
   *      au moment où il a quitté la carte.
   *  Même garde-fous que `spendMp`/`refundMp`. */
  function resetMp(counter) {
    if (!assisted.value || movementAllowance(counter) == null) return
    const next = new Map(spentMp.value)
    next.delete(String(counter.id))
    spentMp.value = next
  }

  // --- Restauration depuis le JOURNAL (rejeu d'une sauvegarde) ---------------
  // Le journal (cf. JournalPanel.vue) enregistre, en plus des positions :
  //   - la PHASE en cours (entrée `phase`, écrite par HexMap.vue::onPhaseNext
  //     à chaque passage en Combat ou en Fin de tour) ;
  //   - les MP DÉPENSÉS par une unité après chacun de ses déplacements
  //     (champ `mp` des entrées `move`/`place`).
  // Sans ça, une partie sauvegardée EN COURS de phase de Mouvement
  // repartirait, une fois rechargée, en phase Mouvement avec toutes les
  // unités à plein potentiel de MP — elles pourraient rejouer un mouvement
  // déjà effectué. Les 3 fonctions ci-dessous servent UNIQUEMENT au rejeu
  // (cf. HexMap.vue::applyReplayEntry/resetBoardForReplay) : elles écrivent
  // directement l'état, sans aucune vérification de règle, parce que l'état
  // rejoué a déjà été validé par les règles au moment où il a été joué.

  /** Rejeu : place la phase en cours (0 Mouvement, 1 Combat, 2 Fin de tour).
   *  Le changement de TOUR, lui, passe par TurnTracker.vue (entrée `turn`)
   *  et remet de lui-même la phase à 0 (cf. watcher de `currentStep`). */
  function setPhase(newPhase) {
    phaseStep.value = newPhase
  }

  /** Rejeu : fixe à `value` le total de MP déjà dépensés par l'unité `id`
   *  pendant ce tour-ci (valeur ABSOLUE lue dans le journal, pas un ajout :
   *  rejouer deux fois la même entrée donne donc toujours le même résultat). */
  function setSpentMp(id, value) {
    if (value == null) return
    spentMp.value = new Map(spentMp.value).set(String(id), value)
  }

  /** Rejeu : repart de zéro (aucun MP dépensé, aucune congestion, phase de
   *  départ du camp actif — Airborne ou Mouvement, cf. `startSidePhase`) —
   *  appelé au chargement d'un journal, avant de rejouer sa première ligne
   *  (pions déjà remis au déploiement initial par HexMap.vue). */
  function resetTurnState() {
    spentMp.value = new Map()
    entryCounts.value = new Map()
    entryHexByUnit.value = new Map()
    startSidePhase()
  }

  // --- Congestion des hex d'entrée de renfort ---------------------------------
  // Un renfort qui entre en jeu sur un hex de bord de carte défini par un
  // `setup` "ref seule" ou "plage" (PAS "+adj", réservé à l'aéroporté qui
  // n'est pas concerné) paie un coût d'entrée — et, si un AUTRE renfort
  // entre par ce MÊME hex précis ce MÊME tour, le coût grimpe : 1er = 1× le
  // coût de base, 2e = 2×, 3e = 3×, etc. (cf. `entryCost`/`spendEntryCost`).
  // Cette majoration est une règle du module (`rules.entryCongestion`,
  // cf. lib/rules.js) : 'multiply' ou 'none' — chaque entrée ne
  // paie alors que le coût de base, sans surcoût.
  // `entrySurcharge` expose la valeur à afficher sur l'hex en mode debug
  // (cf. lib/useDebug.js) : le SURCOÛT déjà accumulé, que la PROCHAINE unité
  // entrante devra payer en plus du coût de base (ex. "+0.5" après 1 entrée
  // sur un hex à 0.5 MP de base, "+1" après une 2e).

  /** Coût de BASE pour ENTRER EN JEU sur `h` (arrivée depuis "hors carte" —
   *  contrairement à `terrainCost`, il n'y a pas de "from", donc pas d'arête
   *  from->h précise à tester) : on demande seulement si `h` est DESSERVI,
   *  par au moins un de ses côtés, par une arête à coût fixe (cf.
   *  `edges.entryKind` — ex. d'abord une route, sinon une piste),
   *  et on paie alors ce coût ; sinon le coût de terrain normal de `h`. */
  function entryBaseCost(hex) {
    const kind = edges.entryKind(hexId(hex.c + 1, hex.r))
    return kind ? edges.kindOf(kind).mp : terrainAreaCost(hex)
  }

  /** Coût RÉEL pour que la PROCHAINE unité entre en jeu sur `h` ce tour-ci :
   *  coût de base (cf. `entryBaseCost`) × (nombre d'unités déjà entrées par
   *  ce hex ce tour-ci, cf. `entryCounts`, + 1 pour celle-ci). */
  function entryCost(hex) {
    const already = entryCounts.value.get(hex.c + ',' + hex.r) ?? 0
    return entryBaseCost(hex) * (rules.entryCongestion === 'multiply' ? already + 1 : 1)
  }

  /** Surcoût déjà accumulé sur `h` ce tour-ci (0 si personne n'y est encore
   *  entré) — exactement ce que `entryCost(h)` ajoute au coût de base pour
   *  la prochaine entrée. Exportée (cf. `return` plus bas) pour l'affichage
   *  debug ("+X" sur l'hex, cf. lib/useDebug.js) — ne modifie rien,
   *  contrairement à `spendEntryCost`. */
  function entrySurcharge(hex) {
    if (rules.entryCongestion !== 'multiply') return 0
    const already = entryCounts.value.get(hex.c + ',' + hex.r) ?? 0
    return entryBaseCost(hex) * already
  }

  /** Déduit `entryCost(h)` des MP de `c` ET incrémente le compteur de
   *  congestion de `h` — à appeler UNE FOIS, juste après qu'un renfort vient
   *  d'ENTRER EN JEU sur `h` (cf. HexMap.vue::onHex, branche renfort ; PAS un
   *  déplacement classique, pour ça cf. `spendMp`). Ne fait rien hors mode
   *  Assisté — en mode Libre, aucun garde-fou de MP n'existe. Peut faire
   *  passer les MP restants de `c` sous zéro si le coût (potentiellement
   *  multiplié par la congestion) dépasse ce qu'il lui reste : ce n'est PAS
   *  un blocage d'entrée (un renfort entre toujours, cf. `isEntryHexBlocked`
   *  dans HexMap.vue pour les VRAIS blocages), juste un mouvement ultérieur
   *  ce tour-ci qui devient impossible.
   *
   *  Renvoie ce qui vient d'être payé, pour le JOURNAL (cf. HexMap.vue::onHex,
   *  qui signale une entrée MAJORÉE par la congestion, c.-à-d. `cost` >
   *  `baseCost`) : `{ rank, baseCost, cost }` — `rank` = rang de cette entrée
   *  sur `h` ce tour-ci (1 = première), `baseCost` = coût de base de `h` (cf.
   *  `entryBaseCost`), `cost` = coût réellement payé (`baseCost × rank`, ou
   *  `baseCost` sans congestion — cf. `entryCost`).
   *  `null` hors mode Assisté (rien n'est payé ni compté). */
  function spendEntryCost(counter, hex) {
    if (!assisted.value) return null
    // Lus AVANT d'incrémenter le compteur : `entryCost` donne le coût de
    // CETTE entrée-ci, pas de la suivante.
    const baseCost = entryBaseCost(hex)
    const cost = entryCost(hex)
    if (movementAllowance(counter) != null) {
      const spent = (spentMp.value.get(String(counter.id)) ?? 0) + cost
      spentMp.value = new Map(spentMp.value).set(String(counter.id), spent)
    }
    const key = hex.c + ',' + hex.r
    const count = (entryCounts.value.get(key) ?? 0) + 1
    entryCounts.value = new Map(entryCounts.value).set(key, count)
    entryHexByUnit.value = new Map(entryHexByUnit.value).set(String(counter.id), key)
    return { rank: count, baseCost, cost }
  }

  /** Annule l'effet de `spendEntryCost` sur la CONGESTION (pas sur les MP de
   *  `c` lui-même : cf. `resetMp`, à appeler séparément, cf. HexMap.vue::
   *  returnCounterToReinforcements) — à appeler quand `c` est "replacé" aux
   *  renforts : décrémente d'UN le compteur de congestion du hex par lequel
   *  il était entré, comme si son entrée n'avait jamais eu lieu, pour que le
   *  PROCHAIN pion à entrer par ce même hex ce même tour ne paie pas pour
   *  une place que `c` n'occupe plus. Ne fait rien si `c` n'est plus suivi
   *  (jamais entré via `spendEntryCost` CE TOUR-CI, cf. `entryHexByUnit` —
   *  en particulier, un pion replacé un tour après son entrée ne touche à
   *  rien : sa congestion d'alors a de toute façon déjà été remise à zéro). */
  function unspendEntryCost(counter) {
    const key = entryHexByUnit.value.get(String(counter?.id))
    if (key == null) return
    const nextByUnit = new Map(entryHexByUnit.value)
    nextByUnit.delete(String(counter.id))
    entryHexByUnit.value = nextByUnit
    const count = Math.max(0, (entryCounts.value.get(key) ?? 0) - 1)
    entryCounts.value = new Map(entryCounts.value).set(key, count)
  }

  return { showGrid, selectable, draggable, canControl, phase, phaseLabels, phaseIndex, phaseNameOf, nextLabel, advance, movementAllowance,
    PHASE_AIRBORNE, PHASE_SETUP, initPhase: startSidePhase, canPlaceReinforcementNow, canEnterHex, canEnterTerrain, spendMp, refundMp, resetMp, terrainCost, terrainAreaCost, remainingMp, enemyZocSet, isEnemyOf, entrySurcharge, spendEntryCost, unspendEntryCost, wouldOverstack, canLeaveAfterEntering, canLeaveAfterReinforcementEntry, isOverstacked, stackedHexes, edgeKind, edgeKinds, combatEdgeKind, edgeBlocksAttack, isZocFrozen, setPhase, setSpentMp, resetTurnState }
}
