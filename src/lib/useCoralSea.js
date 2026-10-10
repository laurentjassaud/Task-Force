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
// ZONE INTERDITE : leurres et task forces japonais restent toujours à plus
// de 5 hex de l'aérodrome de Port Moresby (2203), pour échapper à ses
// reconnaissances — ni posés (placement initial, entrée depuis le panneau)
// ni déplacés (à la main comme seuls) à 5 hex ou moins (cf. `hexForbidden`).
import { computed, ref, unref } from 'vue'
import { INERT_RULES } from './moduleRules.js'
import { hexDistance } from './hex.js'

export const CORAL_SEA_MODULE_ID = 'coral-sea'

/** Aérodrome à éviter (col 0-based, ligne 1-based) et distance en hex à
 *  laquelle les pions japonais ne doivent jamais se trouver. */
const AIRFIELD = { col: 21, row: 3 }
const AIRFIELD_AVOID_RANGE = 5
const nearAirfield = (hex) => hexDistance(hex, AIRFIELD) <= AIRFIELD_AVOID_RANGE
const hexOfId = (id) => ({ col: Number(id.slice(0, 2)) - 1, row: Number(id.slice(2)) })

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
      (ctx.terrain?.ijnArrivalHexes ?? []).filter((id) => !nearAirfield(hexOfId(id))))
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

  /** Hex à 5 hex ou moins de l'aérodrome : interdit aux pions japonais. */
  function hexForbidden(counter, hex) {
    if (!active.value || !isIjnTaskForce(counter)) return null
    return nearAirfield(hex) ? true : null
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
    privateLabelSide: 'ijn', setupSecrets, restoreSetupSecrets, autoMoveTarget, autoMoveSide: 'ijn', hexForbidden,
  }
}
