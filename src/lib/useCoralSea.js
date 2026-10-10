// ═══════════════════════════════════════════════════════════════════════════
// useCoralSea — règles PARTICULIÈRES au module "coral-sea"
// ═══════════════════════════════════════════════════════════════════════════
//
// Même patron que lib/useArnhem.js (convention `null` = "pas de règle
// particulière", composable INERTE sur tout autre module).
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
// HEX-OBJECTIF : chaque leurre et chaque task force japonaise reçoit au coup
// d'envoi une destination tirée au hasard parmi les hex d'arrivée japonais
// (`terrain.ijnArrivalHexes`, cf. coral-sea.json). À chaque phase de
// Mouvement japonaise, le moteur les rapproche automatiquement de cet
// objectif (cf. `autoMoveTarget` et HexMap.vue::runAutoMoves). Tiré avec
// l'identité des leurres, il est inscrit au journal de la même façon.
//
// RECONNAISSANCE JAPONAISE : pendant la phase de Reconnaissance du camp
// japonais (joué par le moteur), chaque SOURCE fait UN check, et un seul :
// les bases aériennes japonaises (Rabaul 0506, Buka 1004, Gasmata 0510, Lae
// 0115) et les task forces de porte-avions japonaises sur la carte (`role`
// "carrier", cf. coral-sea.json — vrais pions, ou leurres qui les portent en
// secret). Chacune tire au hasard UN hex à explorer parmi ceux, à 8 hex ou
// moins d'elle, où se trouve une task force ou un leurre allié pas encore
// exploré (cf. `reconChecks` et HexMap.vue::continueEngineRecon) — un
// porte-avions qui a trois leurres à portée n'en explore qu'un. Les sources
// jouent une par une, dans un ordre tiré au hasard ; pour chacune, le
// joueur ouvre le rapport (clic droit sur l'unité) et un chit est tiré de
// la tasse de recherche (cf. `drawSearch`) : 30 Detected!, 12 Misdirect,
// 12 Contact Lost. Les chits tirés ne retournent pas dans la tasse : elle
// n'est remplie à nouveau qu'aux tours "Tous rendus" de la piste
// (`turnInfo.conditions.reconChits`), où les marqueurs quittent la carte.
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
const RECON_PHASE = 'reconnaissance'
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

/** État de repérage, et pion "Sighted" posé sur l'unité pour une task
 *  force repérée. */
// Image par camp de l'unité repérée (pas encore de "Sighted Carrier" rouge :
// celle des Alliés sert aux deux).
export const SIGHTINGS = {
  noContact: {},
  noTF: {},
  carrierTF: { name: 'Sighted Carrier', src: { usn: `${MARKERS}Marker_Sighted-Carrier.png`, ijn: `${MARKERS}Marker_Sighted-Carrier.png` } },
  fleetTF: { name: 'Sighted Fleet', src: { usn: `${MARKERS}Marker_Sighted-Fleet.png`, ijn: `${MARKERS}Marker_Sighted-Fleet-IJN.png` } },
}

/** Task forces portées en secret par un leurre, avec leur allure. */
const HIDDEN_TASK_FORCES = [
  { tf: 'ijn-tf1', code: 'TF1', movement: 'normal' },
  { tf: 'ijn-tf2', code: 'TF2', movement: 'normal' },
  { tf: 'ijn-tf3', code: 'TF3', movement: 'normal' },
  { tf: 'ijn-tf7', code: 'TF7', movement: 'transport' },
  { tf: 'ijn-tf8', code: 'TF8', movement: 'transport' },
]
/** Task forces (vrais pions) qui se déplacent toujours en transport. */
const TRANSPORT_TASK_FORCES = new Set(HIDDEN_TASK_FORCES.filter((role) => role.movement === 'transport').map((role) => role.tf))

/** Une task force JAPONAISE (vrai pion) ou un leurre japonais : les pions
 *  qui marchent seuls vers leur hex-objectif. */
function isIjnTaskForce(counter) {
  return counter?.faction === 'ijn' && counter.type === 'task force'
}

/** Un leurre (Dummy) JAPONAIS : task force factice déployée d'office au coup
 *  d'envoi. Les leurres américains, eux, se posent à la mise en place US. */
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

/** Tirage des hex-objectifs : id de pion -> id d'hex "CCRR". */
function drawObjectives(counterIds, arrivalHexes) {
  const objectives = {}
  if (!arrivalHexes?.length) return objectives
  for (const id of counterIds) objectives[id] = arrivalHexes[Math.floor(Math.random() * arrivalHexes.length)]
  return objectives
}

export function useCoralSea(moduleId, ctx = {}) {
  const active = computed(() => unref(moduleId) === CORAL_SEA_MODULE_ID)

  const allCounters = ctx.allCounters?.() ?? []
  const dummyRoles = ref(active.value
    ? drawDummyRoles(allCounters.filter(isDummy).map((counter) => String(counter.id)))
    : {})
  const objectives = ref(active.value
    ? drawObjectives(allCounters.filter(isIjnTaskForce).map((counter) => String(counter.id)),
      ctx.terrain?.ijnArrivalHexes)
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

  /** Ce pion se déplace-t-il comme un transport ? */
  function isTransport(counter) {
    if (TRANSPORT_TASK_FORCES.has(String(counter?.id))) return true
    return dummyRole(counter)?.movement === 'transport'
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
    return role.movement === 'transport' ? 'Leurre AK' : 'Leurre'
  }

  /** Hex-objectif de ce pion (`{ col, row }`, col 0-based), ou `null`. */
  function autoMoveTarget(counter) {
    if (!active.value) return null
    const id = objectives.value[String(counter?.id)]
    if (!id) return null
    return { col: Number(id.slice(0, 2)) - 1, row: Number(id.slice(2)) }
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
    return reconSources(counters, side).map((source) => ({
      source,
      targets: [...enemies.values()].filter((hex) => hexDistance(source, hex) <= RECON_RANGE),
    }))
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

  /** Tirage secret à inscrire au journal avec le déploiement. */
  function setupSecrets() {
    return active.value ? { dummyRoles: dummyRoles.value, objectives: objectives.value } : null
  }

  /** Rétablit le tirage lu dans le journal (rejeu, partie en ligne). */
  function restoreSetupSecrets(secrets) {
    if (!active.value) return
    if (secrets?.dummyRoles) dummyRoles.value = secrets.dummyRoles
    if (secrets?.objectives) objectives.value = secrets.objectives
  }

  // Les autres règles : celles du composable inerte (aucune particularité).
  return {
    ...INERT_RULES, active, autoPlacesAtLoad, movementAllowance, privateLabel,
    privateLabelSide: 'ijn', setupSecrets, restoreSetupSecrets, autoMoveTarget, autoMoveSide: 'ijn',
    reconPhase: RECON_PHASE, reconChecks, reconTargetOf, manualReconSide: 'usn', searchBag, drawSearch, refillSearchBag, restoreSearchBag, searchChitsReturn,
    searchResults: SEARCH_RESULTS, searchOutcome, sightings: SIGHTINGS,
  }
}
