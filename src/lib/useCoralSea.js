// ═══════════════════════════════════════════════════════════════════════════
// useCoralSea — règles PARTICULIÈRES au module "coral-sea"
// ═══════════════════════════════════════════════════════════════════════════
//
// Patron des règles particulières (cf. lib/moduleRules.js) : convention
// `null` = "pas de règle particulière", composable INERTE sur tout autre
// module.
//
// Bataille de la mer de Corail (7-8 mai 1942) : seuls les 12 leurres (Dummy)
// japonais sont sur la carte au coup d'envoi. Les Américains posent ensuite
// leurs task forces et autant de leurres qu'ils veulent pendant leur mise en
// place (`turnTrack.setup`, avant le tour 1). Task forces et marqueurs de
// recherche (Detected!, Contact Lost, Misdirect) attendent tous dans le
// panneau latéral, d'où les joueurs les posent sur la carte (zone d'entrée
// IJN en haut de la carte ; USN n'importe où, à la mise en place).
//
// IDENTITÉ SECRÈTE DES LEURRES JAPONAIS : au coup d'envoi, 5 des 12 leurres
// sont tirés au hasard pour porter en réalité une task force — les porte-
// avions TF 1, TF 2, TF 3 et les flottes de transport TF 7, TF 8. Les 7
// autres sont de vrais leurres, dont chacun se déplace, à pile ou face,
// comme une task force normale ou comme un transport (pour ne pas se trahir
// par son allure). Allures (cf. `movementAllowance`) :
//   - normale : celle de la piste de tour (2 hex de nuit, 1 de jour) ;
//   - transport (AK) : 1 hex de nuit, 1 hex aux tours de jour impairs, 0
//     aux tours de jour pairs — exactement les tours où la piste coche
//     "Mouvement AK" (`turnInfo.conditions.akMovement`, cf. coral-sea.json).
// Ce tirage est inscrit dans l'entrée `setup` du journal (cf. `setupSecrets`
// et HexMap.vue::logDeploymentOnce/startSharedJournal) : il survit donc au
// rejeu et est commun à tous les joueurs en ligne.
//
// GROUPES : chacun des 5 leurres porteurs d'une task force reçoit un leurre
// d'escorte, posé sur un hex adjacent de la zone de départ ; les 2 leurres
// restants forment un faux couple, posé au hasard, le second adjacent au
// premier (cf. `drawLeaders`, `arrangeInitialPositions`). Un suiveur suit
// son meneur en restant adjacent, à SON allure (cf. `followTarget`,
// `isTransport`) ; si le meneur disparaît, il reprend son hex-objectif.
//
// MOUVEMENTS PARTICULIERS (cf. `movementPlan`), qui REMPLACENT la marche
// vers l'hex-objectif : TF7/TF8 restent à plus de 6 hex de toute TF alliée
// repérée ; TF1/TF2 foncent à 5 hex d'une TF alliée vue comme porte-avions
// (en s'attendant l'une l'autre à 6 hex, 2 tours au plus), et, sans
// porte-avions allié repéré, s'écartent à plus de 6 hex de toute unité
// alliée dès qu'elles sont elles-mêmes repérées. Leurs suiveurs suivent.
//
// HEX-OBJECTIF : chaque MENEUR (leurre porteur, tête du faux couple) reçoit
// au coup d'envoi une destination tirée au hasard parmi les hex d'arrivée
// japonais (`terrain.ijnArrivalHexes`, cf. coral-sea.json). À chaque phase
// de Mouvement japonaise, le moteur les rapproche automatiquement de cet
// objectif, puis les suiveurs les rejoignent (cf. `autoMoveTarget` et
// HexMap.vue::runAutoMoves). Tirés avec l'identité des leurres, groupes et
// objectifs sont inscrits au journal de la même façon.
//
// RECONNAISSANCE JAPONAISE : pendant la phase de Reconnaissance du camp
// japonais (joué par le moteur), chaque SOURCE fait UN check, et un seul :
// les bases aériennes japonaises (Rabaul 0506, Buka 1004, Gasmata 0510, Lae
// 0115) et les task forces de porte-avions japonaises sur la carte (`role`
// "carrier", cf. coral-sea.json — vrais pions, ou leurres qui les portent en
// secret). Chacune tire au hasard UN hex à explorer parmi ceux, à 8 hex ou
// moins d'elle, où se trouve une task force ou un leurre allié pas encore
// exploré (cf. `reconChecks` et HexMap.vue::continueEngineRecon) — un
// porte-avions qui a trois leurres à portée n'en explore qu'un. Et
// seulement un hex COUVERT : assez d'unités japonaises (task forces,
// leurres et bases) à 8 hex ou moins de lui — 4 avec 12 task forces et
// leurres japonais en jeu, 3 de 8 à 11, 2 de 4 à 7, 1 en dessous (cf.
// `ijnCoverageFilter`). Les sources
// jouent une par une, dans un ordre tiré au hasard ; pour chacune, le
// joueur ouvre le rapport (clic droit sur l'unité) et un chit est tiré de
// la tasse de recherche (cf. `drawSearch`) : 30 Detected!, 12 Misdirect,
// 12 Contact Lost. Les chits tirés ne retournent pas dans la tasse : elle
// n'est remplie à nouveau qu'aux tours "Tous rendus" de la piste
// (`turnInfo.conditions.reconChits`, les tours de nuit), où les marqueurs
// quittent la carte et les task forces repérées redeviennent de simples
// drapeaux.
//
// RECONNAISSANCE ALLIÉE (camp du joueur, `manualReconSide`) : le joueur
// clique une task force de porte-avions alliée (`role` "carrier"), puis
// jusqu'à 2 hex DIFFÉRENTS à 8 hex ou moins d'elle où se trouve une task
// force ou un leurre japonais. Pas de base alliée dans ce scénario. Même
// tasse et mêmes résultats, mais le chit tiré lui reste caché : un pion
// "Search" générique est posé à la place, et un toast lui dit ce qu'il a vu.
// Un leurre japonais qui porte en secret une task force est jugé comme
// elle (cf. `roleOf`).
//
// RÉSULTAT D'UNE RECHERCHE (cf. `searchOutcome`) : chaque chit donne à
// l'unité explorée un ÉTAT DE REPÉRAGE, selon ce qu'elle est vraiment —
// leurre, task force de porte-avions ou de flotte (`role` des task forces,
// cf. coral-sea.json) :
//   - Contact Lost : "no contact", quelle que soit l'unité ;
//   - Misdirect : "no contact" sur un leurre ; sur une task force, elle est
//     prise pour l'autre sorte (porte-avions vu comme flotte, et
//     inversement), avec un pion "Sighted" de ce qu'on a cru voir ;
//   - Detected! : un leurre est démasqué ("no TF") et retiré du jeu ; une
//     task force est vue pour ce qu'elle est, avec son pion "Sighted".
// Sur la carte, les leurres sont des drapeaux de flotte ; le pion "Sighted"
// REMPLACE à l'affichage l'image de l'unité repérée, leurre ou task force —
// sauf les vraies task forces alliées, qui gardent leur pion et empilent
// tous les pions de repérage posés sur elles, chacun avec son tour de pose
// au survol (cf. HexMap.vue::keepsOwnLook, unitSrc).
//
// RENFORT DE LEURRES : au premier tour de chaque nuit (tours 11 et 23,
// `dummyReinforcement` de la piste), juste avant que les repérages ne
// tombent, les leurres japonais éliminés reviennent pour ramener à 12 les
// task forces japonaises sur la carte — sur les porte-avions repérés,
// sinon les flottes repérées, sinon au hasard (cf.
// `planDummyReinforcement`) : chacun posé SUR l'hex de l'unité qu'il
// suivra désormais, puis tous bougent (le suiveur s'en écarte à son
// mouvement, cf. HexMap.vue::runAutoMoves).
//
// Aux mêmes tours, le joueur US peut lui aussi poser des leurres, AVANT de
// bouger quoi que ce soit dans sa phase de Mouvement : chacun sur l'hex d'une
// de ses task forces, jusqu'à 12 task forces américaines (leurres compris)
// sur la carte ; puis il fait son mouvement (cf.
// `playerDummyReinforcement`).
//
// Un porte-avions repéré COMME porte-avions ("Sighted Carrier" sur un vrai
// porte-avions) n'a plus rien à cacher : il cherche sans règle de
// couverture.
//
// Le Japonais ne revient pas sur une task force alliée déjà repérée
// ("Sighted Carrier" ou "Sighted Fleet") tant qu'une source a à portée une
// autre unité alliée non repérée.
import { computed, ref, unref } from 'vue'
import { INERT_RULES } from './moduleRules.js'
import { hexDistance } from './hex.js'

export const CORAL_SEA_MODULE_ID = 'coral-sea'

/** Bases aériennes japonaises d'où partent les reconnaissances, rayon
 *  d'action en hex, et porte-avions qui en lancent aussi. */
const RECON_BASES = { '0506': 'Rabaul', '1004': 'Buka', '0510': 'Gasmata', '0115': 'Lae' }
const RECON_RANGE = 8
/** Hex que chaque source explore par phase. */
const BASE_CHECKS = 1
const CARRIER_CHECKS = { ijn: 1, usn: 2 }
const ENEMY = { ijn: 'usn', usn: 'ijn' }
/** Couverture des reconnaissances japonaises : `[task forces japonaises en
 *  jeu au moins, unités japonaises requises à 8 hex de l'hex exploré]`, du
 *  plus grand au plus petit (cf. `ijnCoverageFilter`). */
const COVERAGE_THRESHOLDS = [[12, 4], [8, 3], [4, 2], [1, 1]]
const RECON_PHASE = 'reconnaissance'
/** Raids aériens japonais (cf. `raidPlan`) : phase, task forces qui en
 *  lancent, rayon d'action, et pion posé sur la cible pour chacune. */
const RAID_PHASE = 'airOperations'
const RAID_RADIUS = 5
const RAID_MARKERS = {
  'ijn-tf1': { name: 'Raid TF1', src: '/modules/coral-sea/images/counters/markers/Marker_Raid-IJN-TF1.png' },
  'ijn-tf2': { name: 'Raid TF2', src: '/modules/coral-sea/images/counters/markers/Marker_Raid-IJN-TF2.png' },
  'ijn-tf3': { name: 'Raid TF3', src: '/modules/coral-sea/images/counters/markers/Marker_Raid-IJN-TF3.png' },
}
const hexOfId = (id) => ({ col: Number(id.slice(0, 2)) - 1, row: Number(id.slice(2)) })

/** Tasse de recherche pleine : nombre de chits par résultat, et pion posé
 *  sur l'hex exploré pour chacun. */
const SEARCH_CHITS = { detected: 30, misdirect: 12, contactLost: 12 }
export const SEARCH_RESULTS = {
  detected: { name: 'Detected!', src: '/modules/coral-sea/images/counters/markers/Marker_Detected.png' },
  misdirect: { name: 'Misdirect', src: '/modules/coral-sea/images/counters/markers/Marker_Misdirect.png' },
  contactLost: { name: 'Contact Lost', src: '/modules/coral-sea/images/counters/markers/Marker_Contact-Lost.png' },
  // Pion posé à la place du chit quand celui-ci reste caché au joueur.
  hidden: { name: 'Search', src: '/modules/coral-sea/images/counters/markers/Marker_Search.png' },
}
const MARKERS = '/modules/coral-sea/images/counters/markers/'

/** État de repérage, et pion "Sighted" qui remplace à l'affichage le
 *  drapeau de la task force repérée (vraie ou leurre), jusqu'au prochain
 *  retour des chits dans la tasse. */
// Image par camp de l'unité repérée.
export const SIGHTINGS = {
  noContact: {},
  noTF: {},
  carrierTF: { name: 'Sighted Carrier', src: { usn: `${MARKERS}Marker_Sighted-Carrier.png`, ijn: `${MARKERS}Marker_Sighted-Carrier-IJN.png` } },
  fleetTF: { name: 'Sighted Fleet', src: { usn: `${MARKERS}Marker_Sighted-Fleet.png`, ijn: `${MARKERS}Marker_Sighted-Fleet-IJN.png` } },
}

/** Task forces japonaises (leurres compris) ramenées sur la carte à chaque
 *  renfort de leurres (cf. `planDummyReinforcement`). */
const DUMMY_TOTAL = 12

/** Mouvements particuliers des task forces japonaises (cf. `movementPlan`) :
 *  celles qui restent à l'écart des Alliés, celles qui attaquent un
 *  porte-avions repéré, et leurs distances. */
const AVOIDING_TASK_FORCES = new Set(['ijn-tf7', 'ijn-tf8'])
const ATTACKING_TASK_FORCES = new Set(['ijn-tf1', 'ijn-tf2'])
const AVOID_RANGE = 6
const ATTACK_RADIUS = 5
const MAX_WAIT_TURNS = 2
/** Porte-avions dont les hex-objectifs sont tirés dans un même rayon (cf.
 *  `groupCarrierObjectives`). */
const GROUPED_TASK_FORCES = new Set(['ijn-tf1', 'ijn-tf2', 'ijn-tf3'])
const GROUPED_RADIUS = 5

/** Task forces portées en secret par un leurre, avec leur allure. */
const HIDDEN_TASK_FORCES = [
  { tf: 'ijn-tf1', code: 'TF1', movement: 'normal' },
  { tf: 'ijn-tf2', code: 'TF2', movement: 'normal' },
  { tf: 'ijn-tf3', code: 'TF3', movement: 'normal' },
  { tf: 'ijn-tf7', code: 'TF7', movement: 'transport' },
  { tf: 'ijn-tf8', code: 'TF8', movement: 'transport' },
  { tf: 'ijn-tf10', code: 'TF10', movement: 'transport' },
]
/** Task forces (vrais pions) qui se déplacent toujours en transport. */
const TRANSPORT_TASK_FORCES = new Set(HIDDEN_TASK_FORCES.filter((role) => role.movement === 'transport').map((role) => role.tf))

/** Une task force JAPONAISE (vrai pion) ou un leurre japonais : les pions
 *  qui marchent seuls vers leur hex-objectif. */
function isIjnTaskForce(counter) {
  return counter?.faction === 'ijn' && counter.type === 'task force'
}

/** Un leurre (Dummy) JAPONAIS : task force factice déployée d'office au coup
 *  d'envoi. Les leurres américains, eux, se posent à la mise en place US
 *  et aux renforts de leurres (cf. `playerDummyReinforcement`). */
function isDummy(counter) {
  return counter?.code === 'Dummy' && counter.faction === 'ijn'
}

function shuffle(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Tirage des rôles : id de leurre -> `{ tf, code, movement }` (`tf`/`code`
 *  `null` pour un vrai leurre). */
function drawDummyRoles(dummyIds) {
  const roles = {}
  shuffle(dummyIds).forEach((id, index) => {
    roles[id] = HIDDEN_TASK_FORCES[index]
      ?? { tf: null, code: null, movement: Math.random() < 0.5 ? 'normal' : 'transport' }
  })
  return roles
}

/** Groupes de départ : chaque leurre qui porte une task force reçoit un
 *  leurre d'escorte, et les leurres restants forment un faux couple (le
 *  premier mène, le second le suit). Suiveur id -> meneur id. */
function drawLeaders(roles) {
  const plain = shuffle(Object.keys(roles).filter((id) => !roles[id].tf))
  const leaders = {}
  for (const id of Object.keys(roles).filter((id) => roles[id].tf)) {
    const escort = plain.shift()
    if (escort) leaders[escort] = id
  }
  const [pairLeader, ...others] = plain
  for (const id of others) leaders[id] = pairLeader
  return leaders
}

/** Tirage des hex-objectifs : id de pion -> id d'hex "CCRR", tous
 *  différents tant qu'il y a assez d'hex d'arrivée. */
function drawObjectives(counterIds, arrivalHexes) {
  const objectives = {}
  if (!arrivalHexes?.length) return objectives
  let pool = []
  for (const id of counterIds) {
    if (!pool.length) pool = shuffle(arrivalHexes)
    objectives[id] = pool.pop()
  }
  return objectives
}

/** Hex-objectifs GROUPÉS des porte-avions TF1, TF2, TF3 : un hex d'arrivée
 *  tiré au hasard sert de centre, et chacun reçoit un hex d'arrivée à 5 hex
 *  ou moins de lui (cf. `GROUPED_TASK_FORCES`). Concerne les leurres qui
 *  les portent (`roles`) comme les vrais pions. Remplace leur tirage dans
 *  `objectives`, renvoyé modifié. */
function groupCarrierObjectives(objectives, roles, arrivalHexes) {
  if (!arrivalHexes?.length) return objectives
  const center = hexOfId(arrivalHexes[Math.floor(Math.random() * arrivalHexes.length)])
  const carriers = Object.keys(objectives).filter((id) => GROUPED_TASK_FORCES.has(roles[id]?.tf ?? id))
  // Jamais deux task forces sur le même hex-objectif : ni entre elles, ni
  // avec un objectif déjà tiré pour une autre (tant qu'il reste de quoi).
  const taken = new Set(Object.keys(objectives).filter((id) => !carriers.includes(id)).map((id) => objectives[id]))
  const near = arrivalHexes.filter((id) => hexDistance(hexOfId(id), center) <= GROUPED_RADIUS)
  const free = shuffle(near.filter((id) => !taken.has(id)))
  const pool = free.length >= carriers.length ? free : shuffle(near)
  carriers.forEach((id, index) => { objectives[id] = pool[index % pool.length] })
  return objectives
}

export function useCoralSea(moduleId, ctx = {}) {
  const active = computed(() => unref(moduleId) === CORAL_SEA_MODULE_ID)

  const allCounters = ctx.allCounters?.() ?? []
  const dummyRoles = ref(active.value
    ? drawDummyRoles(allCounters.filter(isDummy).map((counter) => String(counter.id)))
    : {})
  // Suiveurs (escortes, second du faux couple, leurres d'un renfort de
  // nuit) : id -> id de leur meneur, qu'ils suivent en restant adjacents
  // (cf. `followTarget`). Pas d'hex-objectif à eux.
  const leaders = ref(active.value ? drawLeaders(dummyRoles.value) : {})
  const objectives = ref(active.value
    ? groupCarrierObjectives(drawObjectives(allCounters.filter(isIjnTaskForce).map((counter) => String(counter.id))
      .filter((id) => !leaders.value[id]), ctx.terrain?.ijnArrivalHexes), dummyRoles.value, ctx.terrain?.ijnArrivalHexes)
    : {})

  /** Au chargement, seuls les 12 leurres (Dummy) japonais sont posés, tirés
   *  au hasard dans leur plage `setup` (bord haut, 0601-2701, cf.
   *  coral-sea.json) ; tous les autres pions partent du panneau. */
  function autoPlacesAtLoad(counter) {
    if (!active.value) return null
    return isDummy(counter)
  }

  /** Rôle secret d'un leurre japonais, ou `null`. */
  function dummyRole(counter) {
    if (!active.value || !isDummy(counter)) return null
    return dummyRoles.value[String(counter.id)] ?? null
  }

  /** Tête du groupe de ce pion (id) : il en prend l'allure. */
  function headOf(id) {
    const seen = new Set([id])
    let head = id
    while (leaders.value[head] && !seen.has(leaders.value[head])) seen.add(head = leaders.value[head])
    return head
  }

  /** Ce pion se déplace-t-il comme un transport ? Un suiveur va à l'allure
   *  de la tête de son groupe. */
  function isTransport(counter) {
    const head = headOf(String(counter?.id))
    if (TRANSPORT_TASK_FORCES.has(head)) return true
    return dummyRoles.value[head]?.movement === 'transport'
  }

  /** Allure de transport : 1 hex aux tours "Mouvement AK" de la piste, 0
   *  sinon. `null` (allure de la piste) pour tout autre pion. */
  function movementAllowance(counter, turnInfo) {
    if (!active.value || !turnInfo || !isTransport(counter)) return null
    return turnInfo.conditions?.akMovement ? 1 : 0
  }

  /** Étiquette privée d'un leurre (rôle secret), réservée au joueur japonais. */
  function privateLabel(counter) {
    const role = dummyRole(counter)
    if (!role) return null
    if (role.code) return role.code
    return isTransport(counter) ? 'Leurre AK' : 'Leurre'
  }

  /** Task force que ce pion EST (id, ex. 'ijn-tf1') : celle que porte un
   *  leurre, ou le pion lui-même ; `null` pour un vrai leurre. */
  function taskForceOf(counter) {
    if (counter?.code === 'Dummy') return dummyRole(counter)?.tf ?? null
    return String(counter?.id)
  }

  // Attente de TF1/TF2 aux portes du rayon d'attaque (cf. `movementPlan`) :
  // task force -> tour où elle a commencé à attendre l'autre.
  const waitingSince = new Map()

  /** Mouvement PARTICULIER d'une task force japonaise, qui REMPLACE la
   *  marche vers son hex-objectif (cf. HexMap.vue::runAutoMoves) — ses
   *  suiveurs la suivent comme d'habitude :
   *   - TF7, TF8 : toujours à plus de 6 hex de toute TF alliée repérée ;
   *   - TF1, TF2, dès qu'une TF alliée est vue comme porte-avions ("Sighted
   *     Carrier", vrai ou faux) : foncent sur la plus proche pour entrer à 5
   *     hex ou moins d'elle. Ensemble, si possible : la première arrivée
   *     attend à 6 hex que l'autre puisse entrer au même tour, si ça ne lui
   *     coûte pas plus de 2 tours ;
   *   - TF1, TF2 partiellement repérées (un "Sighted" sur elles), sans
   *     porte-avions allié repéré : à plus de 6 hex de toute unité alliée.
   *  `{ kind: 'avoid', avoid: [hex], range }` (vers l'objectif, en restant à
   *  plus de `range` hex des `avoid`, ou en s'en éloignant), `{ kind:
   *  'attack', target: hex, radius, hold }` (`hold` : s'arrêter à `radius`
   *  + 1), ou `null` (marche ordinaire). `allowanceOf(pion)` : MP du tour. */
  function movementPlan(counter, counters, turn, allowanceOf) {
    if (!active.value) return null
    const tf = taskForceOf(counter)
    if (!AVOIDING_TASK_FORCES.has(tf) && !ATTACKING_TASK_FORCES.has(tf)) return null
    const allies = counters.filter((other) => other.faction === 'usn' && other.type === 'task force')
    const sightingsOf = (unit) => counters.filter((marker) => marker.sighted && marker.attachedTo === String(unit.id)).map((marker) => marker.sighted)
    const sightedAllies = allies.filter((unit) => sightingsOf(unit).some((sighting) => sighting === 'carrierTF' || sighting === 'fleetTF'))
    const hexOf = (unit) => ({ col: unit.col, row: unit.row })
    if (AVOIDING_TASK_FORCES.has(tf)) {
      return sightedAllies.length ? { kind: 'avoid', avoid: sightedAllies.map(hexOf), range: AVOID_RANGE } : null
    }
    const carriers = allies.filter((unit) => sightingsOf(unit).includes('carrierTF'))
    if (carriers.length) {
      const target = hexOf(carriers.reduce((best, unit) => (hexDistance(counter, unit) < hexDistance(counter, best) ? unit : best)))
      return { kind: 'attack', target, radius: ATTACK_RADIUS, hold: shouldHold(counter, tf, target, counters, turn, allowanceOf) }
    }
    waitingSince.delete(tf)
    const partlySeen = counters.some((marker) => marker.attachedTo === String(counter.id)
      && (marker.sighted === 'carrierTF' || marker.sighted === 'fleetTF'))
    return partlySeen && allies.length ? { kind: 'avoid', avoid: allies.map(hexOf), range: AVOID_RANGE } : null
  }

  /** TF1/TF2 qui pourrait entrer ce tour-ci dans le rayon d'attaque de
   *  `target` doit-elle plutôt attendre l'autre (à 6 hex) ? Oui si l'autre
   *  est sur la carte, n'y entrera pas ce tour-ci, mais y sera dans 2 tours
   *  au plus — et pas plus de 2 tours d'attente en tout. */
  function shouldHold(counter, tf, target, counters, turn, allowanceOf) {
    const steps = Math.max(1, allowanceOf(counter) ?? 1)
    const myGap = hexDistance(counter, target) - ATTACK_RADIUS
    if (myGap <= 0 || myGap > steps) { waitingSince.delete(tf); return false }
    const partnerTf = tf === 'ijn-tf1' ? 'ijn-tf2' : 'ijn-tf1'
    const partner = counters.find((other) => other.faction === 'ijn' && other.type === 'task force' && taskForceOf(other) === partnerTf)
    const partnerGap = partner ? hexDistance(partner, target) - ATTACK_RADIUS : 0
    const partnerSteps = Math.max(1, (partner && allowanceOf(partner)) || 1)
    if (partnerGap <= partnerSteps) { waitingSince.delete(tf); return false }
    const since = waitingSince.get(tf) ?? turn
    const wait = Math.ceil(partnerGap / partnerSteps) - 1
    if (wait > MAX_WAIT_TURNS || turn - since >= MAX_WAIT_TURNS) { waitingSince.delete(tf); return false }
    waitingSince.set(tf, since)
    return true
  }

  /** Raid aérien japonais de la phase "Opérations aériennes" : TF1, TF2 et
   *  TF3 frappent une TF alliée vue comme porte-avions ("Sighted Carrier",
   *  vrai ou faux) à 5 hex ou moins d'elles. Elles se CONCENTRENT : d'abord
   *  la cible que le plus de ces task forces peuvent atteindre (au hasard
   *  entre ex aequo), frappée par toutes celles qui l'atteignent ; celles
   *  qui ne l'atteignent pas recommencent entre elles sur les autres cibles.
   *  `[{ targetId, raiders: [{ tf, name, src }] }]`, vide sans cible à
   *  portée. */
  function raidPlan(counters) {
    if (!active.value) return []
    const raiders = counters.filter((counter) => counter.faction === 'ijn' && counter.type === 'task force' && RAID_MARKERS[taskForceOf(counter)])
    const seenAsCarrier = new Set(counters.filter((marker) => marker.sighted === 'carrierTF').map((marker) => marker.attachedTo))
    const targets = counters.filter((counter) => counter.faction === 'usn' && counter.type === 'task force' && seenAsCarrier.has(String(counter.id)))
    const raids = []
    let free = raiders
    let open = shuffle(targets)
    for (;;) {
      const options = open.map((target) => ({ target, inRange: free.filter((raider) => hexDistance(raider, target) <= RAID_RADIUS) }))
        .filter((option) => option.inRange.length)
      if (!options.length) return raids
      const best = options.reduce((top, option) => (option.inRange.length > top.inRange.length ? option : top))
      const tfs = [...new Set(best.inRange.map(taskForceOf))].sort()
      raids.push({ targetId: String(best.target.id), raiders: tfs.map((tf) => ({ tf, ...RAID_MARKERS[tf] })) })
      free = free.filter((raider) => !best.inRange.includes(raider))
      open = open.filter((target) => target !== best.target)
    }
  }

  /** Hex-objectif de ce pion (`{ col, row }`, col 0-based), ou `null`. */
  function autoMoveTarget(counter) {
    if (!active.value) return null
    const id = objectives.value[String(counter?.id)]
    if (!id) return null
    return { col: Number(id.slice(0, 2)) - 1, row: Number(id.slice(2)) }
  }

  /** Meneur que ce pion suit (pion de `counters`), ou `null` s'il n'en a
   *  pas. Un meneur disparu (leurre démasqué) est remplacé par le sien ;
   *  sans meneur restant, le suiveur reprend l'hex-objectif de son ancien
   *  meneur et mène à son tour (ses propres suiveurs le suivent toujours). */
  function followTarget(counter, counters) {
    if (!active.value) return null
    const id = String(counter?.id)
    let leaderId = leaders.value[id]
    if (!leaderId) return null
    const onMap = new Map(counters.map((other) => [String(other.id), other]))
    const seen = new Set([id])
    while (!onMap.has(leaderId)) {
      const above = leaders.value[leaderId]
      if (!above || seen.has(above)) { promote(id, leaderId); return null }
      seen.add(leaderId)
      leaderId = above
    }
    if (leaderId !== leaders.value[id]) leaders.value = { ...leaders.value, [id]: leaderId }
    return onMap.get(leaderId)
  }

  /** Le suiveur `id` perd son meneur `lostId` : il en reprend l'objectif. */
  function promote(id, lostId) {
    const next = { ...leaders.value }
    delete next[id]
    leaders.value = next
    const objective = objectives.value[lostId]
    if (objective) objectives.value = { ...objectives.value, [id]: objective }
  }

  /** Placement initial des groupes : chaque suiveur posé (`placed`, pions
   *  déjà tirés dans leur plage) va sur un hex adjacent à son meneur, au
   *  hasard parmi `adjacentHexes(pion, col, row)`, de préférence libre. */
  function arrangeInitialPositions(placed, adjacentHexes) {
    if (!active.value) return
    const byId = new Map(placed.map((counter) => [String(counter.id), counter]))
    for (const [followerId, leaderId] of Object.entries(leaders.value)) {
      const follower = byId.get(followerId)
      const leader = byId.get(leaderId)
      if (!follower || !leader) continue
      const around = adjacentHexes(follower, leader.col, leader.row)
      const free = around.filter((hex) => !placed.some((other) => other !== follower && other.col === hex.col && other.row === hex.row))
      const pool = free.length ? free : around
      if (!pool.length) continue
      const hex = pool[Math.floor(Math.random() * pool.length)]
      follower.col = hex.col
      follower.row = hex.row
    }
  }

  /** `role` déclaré de chaque pion (cf. coral-sea.json). */
  const declaredRoles = new Map(allCounters.map((counter) => [String(counter.id), counter.role ?? null]))

  /** Ce qu'est VRAIMENT un pion : 'carrier', 'fleet' ou 'dummy'. Un leurre
   *  japonais qui porte une task force est cette task force ; une task force
   *  sans `role` compte comme une flotte. */
  function roleOf(counter) {
    if (counter?.code !== 'Dummy') return counter?.role ?? declaredRoles.get(String(counter?.id)) ?? 'fleet'
    const tf = dummyRole(counter)?.tf
    return tf ? declaredRoles.get(tf) ?? 'fleet' : 'dummy'
  }

  /** Sources de reconnaissance du camp `side` : `{ key, base, name,
   *  unitId, checks, col, row }` — `base`, nom de la base aérienne (`null`
   *  pour un porte-avions) ; `checks`, hex qu'elle explore par phase. Les
   *  bases sont japonaises (aucune base alliée dans ce scénario). Un
   *  porte-avions japonais porté par un leurre part de l'hex du leurre, sous
   *  la clé de la task force (une seule source, même si le vrai pion est
   *  posé). */
  function reconSources(counters, side) {
    const sources = new Map(side !== 'ijn' ? [] : Object.entries(RECON_BASES)
      .map(([id, base]) => [`base:${id}`, { key: `base:${id}`, base, name: base, unitId: null, checks: BASE_CHECKS, ...hexOfId(id) }]))
    for (const counter of counters) {
      if (counter.faction !== side || counter.type !== 'task force' || roleOf(counter) !== 'carrier') continue
      const tf = counter.code === 'Dummy' ? dummyRole(counter).tf : String(counter.id)
      if (sources.has(`tf:${tf}`)) continue
      sources.set(`tf:${tf}`, { key: `tf:${tf}`, base: null, name: counter.name, unitId: String(counter.id),
        checks: CARRIER_CHECKS[side] ?? 1, col: counter.col, row: counter.row })
    }
    return [...sources.values()]
  }

  /** Ce pion est-il une cible de reconnaissance pour le camp `side` ? Une
   *  task force ou un leurre du camp adverse. */
  function reconTargetOf(counter, side) {
    return active.value && counter?.faction === ENEMY[side] && counter.type === 'task force'
  }

  /** Checks de reconnaissance possibles du camp `side` (japonais par
   *  défaut) : pour chaque source, les hex (`{ col, row }`) qu'elle peut
   *  explorer — une cible (cf. `reconTargetOf`) s'y trouve, à 8 hex ou
   *  moins, et aucun résultat de recherche n'y a été posé PENDANT CETTE
   *  PHASE (`step`, pas de la piste noté sur le pion — un hex marqué à une
   *  phase précédente peut être exploré à nouveau ; une même source
   *  n'explore jamais deux fois le même hex dans la phase). `[{ source,
   *  targets }]`, sources sans cible comprises ; `null` hors mer de Corail. */
  function reconChecks(counters, side = 'ijn', step = null) {
    if (!active.value) return null
    const searched = new Set(counters.filter((counter) => counter.searchResult && counter.step === step)
      .map((counter) => counter.col + ',' + counter.row))
    const enemies = new Map()
    for (const counter of counters) {
      if (!reconTargetOf(counter, side)) continue
      const key = counter.col + ',' + counter.row
      if (!searched.has(key)) enemies.set(key, { col: counter.col, row: counter.row })
    }
    const covered = side === 'ijn' ? ijnCoverageFilter(counters) : () => true
    // Porte-avions déjà repéré COMME porte-avions : plus rien à cacher, il
    // cherche quoi qu'il arrive (pas celui pris pour une flotte).
    const seenAsCarrier = new Set(counters.filter((counter) => counter.sighted === 'carrierTF').map((counter) => counter.attachedTo))
    // Hex dont une cible au moins n'est pas encore repérée (ni "Sighted
    // Carrier" ni "Sighted Fleet") : le Japonais y cherche d'abord, et ne
    // revient sur une task force déjà repérée que s'il n'a plus rien d'autre
    // à portée.
    const sighted = new Set(counters.filter((counter) => counter.sighted === 'carrierTF' || counter.sighted === 'fleetTF')
      .map((counter) => counter.attachedTo))
    const undetected = new Set(counters.filter((counter) => reconTargetOf(counter, side) && !sighted.has(String(counter.id)))
      .map((counter) => counter.col + ',' + counter.row))
    return reconSources(counters, side).map((source) => {
      const targets = [...enemies.values()].filter((hex) => hexDistance(source, hex) <= RECON_RANGE
        && (seenAsCarrier.has(source.unitId) || covered(hex)))
      if (side !== 'ijn') return { source, targets }
      const fresh = targets.filter((hex) => undetected.has(hex.col + ',' + hex.row))
      return { source, targets: fresh.length ? fresh : targets }
    })
  }

  /** Règle de couverture des reconnaissances JAPONAISES : un hex n'est
   *  exploré que si assez d'unités japonaises sont à 8 hex ou moins de lui
   *  — task forces et leurres sur la carte, plus les bases (cf.
   *  `RECON_BASES`). Le seuil suit le nombre de task forces et leurres
   *  japonais en jeu (cf. `COVERAGE_THRESHOLDS`). Filtre `hex -> booléen`. */
  function ijnCoverageFilter(counters) {
    const units = counters.filter(isIjnTaskForce)
    const needed = COVERAGE_THRESHOLDS.find(([minUnits]) => units.length >= minUnits)?.[1] ?? 1
    const anchors = [...units, ...Object.keys(RECON_BASES).map(hexOfId)]
    return (hex) => anchors.filter((anchor) => hexDistance(anchor, hex) <= RECON_RANGE).length >= needed
  }

  // Chits restant dans la tasse de recherche (cf. `drawSearch`).
  const searchBag = ref({ ...SEARCH_CHITS })

  /** Tire un chit de la tasse, sans remise : `{ result, bag }` (`bag` =
   *  contenu restant), ou `null` si la tasse est vide. */
  function drawSearch() {
    if (!active.value) return null
    const bag = { ...searchBag.value }
    const total = Object.values(bag).reduce((sum, count) => sum + count, 0)
    if (!total) return null
    let pick = Math.floor(Math.random() * total)
    const result = Object.keys(bag).find((key) => (pick -= bag[key]) < 0)
    bag[result] -= 1
    searchBag.value = bag
    return { result, bag }
  }

  /** Remet tous les chits dans la tasse. */
  function refillSearchBag() {
    if (active.value) searchBag.value = { ...SEARCH_CHITS }
  }

  /** Contenu de la tasse lu dans le journal (rejeu, partie en ligne). */
  function restoreSearchBag(bag) {
    if (active.value && bag) searchBag.value = { ...bag }
  }

  /** Ce que donne le chit `result` sur l'unité explorée : `{ sighting,
   *  removed }` — `sighting`, clé de `SIGHTINGS` ; `removed`, vrai pour un
   *  leurre démasqué, retiré du jeu. Une task force sans `role` compte
   *  comme une flotte. */
  function searchOutcome(result, counter) {
    if (!active.value) return null
    if (result === 'contactLost') return { sighting: 'noContact', removed: false }
    const role = roleOf(counter)
    if (role === 'dummy') {
      return result === 'detected' ? { sighting: 'noTF', removed: true } : { sighting: 'noContact', removed: false }
    }
    const carrier = role === 'carrier'
    const seenAsCarrier = result === 'detected' ? carrier : !carrier
    return { sighting: seenAsCarrier ? 'carrierTF' : 'fleetTF', removed: false }
  }

  /** Les chits reviennent-ils tous dans la tasse à ce tour de la piste ? */
  function searchChitsReturn(turnInfo) {
    return active.value && turnInfo?.conditions?.reconChits === 'Tous rendus'
  }

  /** Tour de renfort de leurres (`dummyReinforcement` de la piste : le
   *  premier tour de chaque nuit) ? */
  function dummyReinforcementTurn(turnInfo) {
    return active.value && !!turnInfo?.dummyReinforcement
  }

  /** Renfort de leurres japonais : de quoi ramener à `DUMMY_TOTAL` les task
   *  forces japonaises sur la carte, en reprenant les leurres éliminés
   *  (`freeDummyIds`). Où les poser, d'après les repérages alliés du jour
   *  (`sightings`, id -> clé de `SIGHTINGS`), avant qu'ils ne tombent :
   *    1. sur les hex des unités vues comme porte-avions ;
   *    2. sinon, sur ceux des unités vues comme flottes ;
   *    3. sinon, au hasard parmi les task forces japonaises.
   *  Répartis à tour de rôle entre les unités retenues, chacun SUR l'hex de
   *  l'unité qu'il SUIVRA désormais (pas d'hex-objectif à lui) : il s'en
   *  écarte au mouvement qui suit. Chaque leurre posé est un vrai leurre.
   *  `{ placements: [{ id, col, row }], roles, leaders }`, ou `null` s'il
   *  n'y a rien à poser. */
  function planDummyReinforcement(counters, sightings, freeDummyIds) {
    if (!active.value) return null
    const onMap = counters.filter(isIjnTaskForce)
    const missing = Math.min(DUMMY_TOTAL - onMap.length, freeDummyIds.length)
    if (missing <= 0) return null
    const seenAs = (sighting) => onMap.filter((counter) => sightings.get(String(counter.id)) === sighting)
    const anchors = shuffle([seenAs('carrierTF'), seenAs('fleetTF'), onMap].find((list) => list.length) ?? [])
    if (!anchors.length) return null
    const ids = freeDummyIds.slice(0, missing)
    const placements = ids.map((id, index) => {
      const anchor = anchors[index % anchors.length]
      return { id, col: anchor.col, row: anchor.row }
    })
    const roles = Object.fromEntries(ids.map((id) => [id, { tf: null, code: null, movement: 'normal' }]))
    const newLeaders = Object.fromEntries(ids.map((id, index) => [id, String(anchors[index % anchors.length].id)]))
    return { placements, roles, leaders: newLeaders }
  }

  /** Renfort de leurres du JOUEUR US, aux mêmes tours que le japonais (cf.
   *  `dummyReinforcementTurn`) : si `counter` est le leurre américain (pion
   *  en nombre illimité du panneau), `{ total, anchors }` — il se pose sur
   *  l'hex d'une task force américaine (`anchors(pion)`), tant qu'il y en a
   *  moins de `total` sur la carte, leurres compris. `null` sinon. Le moment
   *  (phase Mouvement US, avant tout mouvement) est vérifié par HexMap.vue. */
  function playerDummyReinforcement(counter, turnInfo) {
    if (!dummyReinforcementTurn(turnInfo) || counter?.code !== 'Dummy' || counter.faction !== 'usn') return null
    return { total: DUMMY_TOTAL, anchors: (other) => other.faction === 'usn' && other.type === 'task force' }
  }

  /** Rôles et hex-objectifs des leurres d'un renfort (en jeu comme au
   *  rejeu, cf. `planDummyReinforcement`). */
  function applyDummyReinforcement(plan) {
    if (!active.value || !plan) return
    // Leurres repris : ceux qui les suivaient encore les perdent d'abord
    // (cf. `promote`), puis ils quittent leurs anciens groupe et objectif.
    const reused = new Set((plan.placements ?? []).map((placement) => String(placement.id)))
    for (const [followerId, leaderId] of Object.entries(leaders.value)) {
      if (reused.has(leaderId) && !reused.has(followerId)) promote(followerId, leaderId)
    }
    const nextLeaders = { ...leaders.value }
    const nextObjectives = { ...objectives.value }
    for (const id of reused) { delete nextLeaders[id]; delete nextObjectives[id] }
    leaders.value = { ...nextLeaders, ...plan.leaders }
    objectives.value = { ...nextObjectives, ...plan.objectives }
    dummyRoles.value = { ...dummyRoles.value, ...plan.roles }
  }

  /** Tirage secret à inscrire au journal avec le déploiement. */
  function setupSecrets() {
    return active.value ? { dummyRoles: dummyRoles.value, objectives: objectives.value, leaders: leaders.value } : null
  }

  /** Rétablit le tirage lu dans le journal (rejeu, partie en ligne). */
  function restoreSetupSecrets(secrets) {
    if (!active.value) return
    if (secrets?.dummyRoles) dummyRoles.value = secrets.dummyRoles
    if (secrets?.objectives) objectives.value = secrets.objectives
    // Journal antérieur aux groupes : personne ne suit personne.
    leaders.value = secrets?.leaders ?? {}
  }

  // Les autres règles : celles du composable inerte (aucune particularité).
  return {
    ...INERT_RULES, active, autoPlacesAtLoad, movementAllowance, privateLabel,
    privateLabelSide: 'ijn', setupSecrets, restoreSetupSecrets, autoMoveTarget, autoMoveSide: 'ijn',
    reconPhase: RECON_PHASE, reconChecks, reconTargetOf, manualReconSide: 'usn', searchBag, searchBagFull: SEARCH_CHITS, drawSearch, refillSearchBag, restoreSearchBag, searchChitsReturn,
    searchResults: SEARCH_RESULTS, searchOutcome, sightings: SIGHTINGS,
    isReusableDummy: isDummy, dummyReinforcementTurn, planDummyReinforcement, applyDummyReinforcement, playerDummyReinforcement,
    followTarget, arrangeInitialPositions, movementPlan, raidPhase: RAID_PHASE, raidSide: 'ijn', raidPlan,
  }
}
