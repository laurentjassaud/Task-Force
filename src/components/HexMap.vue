<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// HexMap.vue — carte hexagonale complète : toolbar, image + grille SVG
// cliquable, et panneau de calibration. Composant autonome : reçoit un
// `module` (la boîte de jeu — cf. public/modules/*.json) pour l'image et la
// géométrie de grille (cols/rows) et la calibration pixel de la grille
// (`map.calibration` — x0/y0/colStep/a/rowStep, complétée par
// DEFAULT_CALIBRATION de lib/calibration.js), ajustable en direct via
// CalibrationPanel.vue.
//
// SYSTÈME DE COORDONNÉES :
//  - "hex" (col, row) : coordonnées logiques de la grille, col 0-based,
//    row 1-based (cohérent avec le format imprimé sur la carte, ex. "0101").
//  - "pixel SVG" (x, y) : coordonnées dans le viewBox de l'image, calculées
//    via `calibration` (x0/y0 = centre du premier hex, colStep/rowStep = pas
//    entre hex, a = rayon horizontal). Colonnes IMPAIRES décalées de
//    +rowStep/2 vers le bas (grille flat-top, offset odd-q).
//  - Le zoom redimensionne le SVG en CSS ; le viewBox reste fixe en pixels
//    "image" — la mise à l'échelle est faite par le navigateur.
// ═══════════════════════════════════════════════════════════════════════════

import { reactive, ref, computed, toRef, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { t, mt } from '../i18n/index.js'
import { hexId, DEFAULT_CALIBRATION } from '../lib/calibration.js'
import { neighborsOf, hexDistance } from '../lib/hex.js'
import { pathToward } from '../lib/autoMove.js'
import { hexExists, removedHexSet } from '../lib/mapShape.js'
import { useAssisted } from '../lib/useAssisted.js'
import { useDebug } from '../lib/useDebug.js'
import { useCombat } from '../lib/useCombat.js'
import { useArtillery } from '../lib/useArtillery.js'
import { useRetreat } from '../lib/useRetreat.js'
import { useModuleRules } from '../lib/moduleRules.js'
import { isUnit, isFighter, isSupport } from '../lib/units.js'
import { useBridges } from '../lib/useBridges.js'
import { useSupplyLine } from '../lib/useSupplyLine.js'
import { useVictoryPoints } from '../lib/useVictoryPoints.js'
import { parseSetup, isAirborneEntry, deploymentCells, rangeCells, landingCells } from '../lib/setup.js'
import { resolveRules, resolveTurnStructure } from '../lib/rules.js'
import { sideOfStep, resolveTrack, sidesOfTurn } from '../lib/turnTrack.js'
import { resolveCombatTable } from '../lib/combatTable.js'
import CalibrationPanel from './CalibrationPanel.vue'
import Counter from './Counter.vue'
import TurnTracker from './TurnTracker.vue'
import SupportTracker from './SupportTracker.vue'
import JournalPanel from './JournalPanel.vue'
import SidePanel from './SidePanel.vue'
import ReinforcementsPanel from './ReinforcementsPanel.vue'
import EliminatedPanel from './EliminatedPanel.vue'
import ContextMenu from './ContextMenu.vue'
import Toast from './Toast.vue'
import StackPopup from './StackPopup.vue'
import RollModal from './RollModal.vue'
import MovementChartModal from './MovementChartModal.vue'
import CombatChartModal from './CombatChartModal.vue'
import CombatModal from './CombatModal.vue'
import BridgeModal from './BridgeModal.vue'
import VictoryPoints from './VictoryPoints.vue'
import VictoryModal from './VictoryModal.vue'
import GameEndModal from './GameEndModal.vue'
import PhaseBlockedModal from './PhaseBlockedModal.vue'
import BugReportModal from './BugReportModal.vue'
import InterfaceGuide, { guideSeen, markGuideSeen } from './InterfaceGuide.vue'
import { APP_VERSION, REPORT_ENTRIES } from '../lib/bugReport.js'
import MoveTimer from './MoveTimer.vue'
import LanguageSwitcher from './LanguageSwitcher.vue'

const props = defineProps({
  module: { type: Object, required: true }, // cf. src/modules/*.json — { boardGame, name, map: {...} }
  // Positions déjà déplacées depuis le setup du module (partie multijoueur en
  // cours) — { [counterId]: { col, row } }. Absent en solo/démo.
  initialPositions: { type: Object, default: () => ({}) },
  // Pas courant du suivi de tour déjà en cours (partie multijoueur reprise
  // en route) — cf. `turnTrack` ci-dessous. Absent (0) en solo/démo.
  initialTurnStep: { type: Number, default: 0 },
  // Phase déjà en cours (partie multijoueur reprise en route, cf.
  // server/src/rooms.js::recordPhase), ou `null` : phase de départ du camp
  // actif recalculée localement. Absent en solo/démo.
  initialPhase: { type: Number, default: null },
  // Temps déjà écoulé (ms) dans cette phase/ce pas côté serveur — reprise du
  // compteur du timing "Limité" (cf. MoveTimer.vue). 0 en solo/démo.
  initialPhaseElapsedMs: { type: Number, default: 0 },
  // Timing "Blitz" : temps de Mouvement déjà consommé par camp (ms) —
  // `{ [campKey]: ms }`, cf. server/src/rooms.js::recordPhase. {} en solo/démo.
  initialBlitzUsedMs: { type: Object, default: () => ({}) },
  // Timing "Blitz" : camp ayant déjà perdu au temps (partie en ligne
  // terminée, cf. server/src/rooms.js::recordGameOver), ou `null`.
  initialBlitzLoser: { type: String, default: null },
  // Ce qui a mis fin à la partie côté serveur : 'blitz' ou 'concede' (cf.
  // declareLoss).
  initialGameOverReason: { type: String, default: null },
  // Combat soumis au défenseur pour son FPF, en attente ou déjà répondu
  // (partie en ligne reprise en route, cf. server/src/rooms.js::
  // recordFpfRequest) — `{ id, targets, attackerIds, fpfIds }`, ou `null`.
  initialFpfRequest: { type: Object, default: null },
  // Décisions déjà prises sur les ponts, dans l'ordre (partie en ligne
  // reprise en route, cf. server/src/rooms.js::recordBridgeResult) —
  // `[{ edge, kind, die, destroyed, unitId }]`.
  initialBridgeLog: { type: Array, default: () => [] },
  // Occasion soumise au camp qui doit la trancher et restée sans réponse
  // (même reprise) — `{ id, edge, kind, unitId }`, ou `null`.
  initialBridgeRequest: { type: Object, default: null },
  // Camp du joueur sur ce navigateur (multijoueur, cf. RoomLobby.vue) :
  // l'alerte "Temps imparti terminé" n'est montrée qu'au joueur actif.
  // Vide en solo/démo (un seul navigateur pour tous les camps).
  localSide: { type: String, default: '' },
  // Partie EN LIGNE (cf. RoomLobby.vue) : le journal est PARTAGÉ entre les
  // joueurs et conservé par le serveur (cf. `log`, applyRemoteEntry). Faux
  // en solo/démo : journal local, sauvegarde auto et reprise inchangés.
  online: { type: Boolean, default: false },
  // En ligne : journal partagé déjà enregistré par le serveur (ordre
  // chronologique), rejoué au montage pour reconstituer la partie.
  initialJournal: { type: Array, default: () => [] },
  // Identifiant court du module (ex. "arnhem", cf. public/modules/index.json)
  // — sert uniquement à nommer les sauvegardes du journal (cf.
  // JournalPanel.vue::saveLabel). À défaut (non fourni par l'appelant), on
  // retombe sur `module.name`.
  moduleId: { type: String, default: '' },
  // Partie "Assistée" (cf. LocalGameSetup.vue, param `party`) : variante
  // opt-in avec garde-fous (grille, sélection au clic, restriction de tour
  // — cf. lib/useAssisted.js). Comportement PAR DÉFAUT (`false`) : "Libre",
  // bac à sable sans garde-fous.
  assisted: { type: Boolean, default: false },
  // Réglages de la partie (mode, scénario, météo, timing — cf.
  // lib/journalStorage.js), enregistrés avec le journal pour qu'une reprise
  // se rejoue dans les mêmes conditions. `null` si inconnus (multijoueur).
  settings: { type: Object, default: null },
})

// `phase` : `{ phase, step, blitzUsed }` — changement de phase LOCAL sans changement de
// pas (cf. onPhaseNext), à répercuter aux autres joueurs (multijoueur).
// `game-over` : `{ loser, text, t, reason }` — un camp a perdu : au temps
// (Blitz, `reason` 'blitz') ou en concédant ('concede') — cf. declareLoss, à
// répercuter aux autres joueurs (multijoueur).
// En ligne uniquement (journal partagé, cf. `log`) :
//  - `log` : `{ uid, t, kind, text, data }` — entrée ajoutée localement ;
//  - `unlog` : uid d'une entrée retirée (retour arrière) ;
//  - `deploy` : `{ setup, turn }` — entrées `setup` et `turn` de départ
//    proposées au lancement (cf. startSharedJournal).
// `restart-with` : `{ settings, entries, message }` — un journal à reprendre
// a été joué avec d'autres réglages : la page doit relancer la partie avec
// eux (cf. DemoPlay.vue, JournalPanel.vue::startReplay).
// FPF en ligne (cf. section "FPF en ligne") : `fpf-request` — `{ id, targets,
// attackerIds }`, combat soumis au défenseur ; `fpf-cancel` — id de la
// demande abandonnée ; `fpf-reply` — `{ requestId, fpfIds }`, choix du
// défenseur.
const emit = defineEmits(['move', 'turn', 'phase', 'game-over', 'log', 'unlog', 'deploy', 'restart-with',
  'fpf-request', 'fpf-cancel', 'fpf-reply', 'bridge-request', 'bridge'])

const map = computed(() => props.module.map)

// --- Journal de partie : historique de tout ce qui se passe (cf.
// JournalPanel.vue, onglet du panneau latéral — toute la logique y vit).
// HexMap.vue se contente d'appeler `log(kind, text)` à chaque évènement de
// jeu (tour, déplacement, entrée en jeu, élimination...).
const journalRef = ref(null)
function log(kind, text, data) {
  logDeploymentOnce()
  const journal = journalRef.value
  if (!journal) return undefined
  if (!props.online) return journal.log(kind, text, data)
  // En ligne : chaque entrée porte un identifiant unique (`uid`, commun à
  // tous les navigateurs) et part au serveur, qui la conserve et la
  // transmet aux autres joueurs (cf. applyRemoteEntry).
  const id = journal.log(kind, text, data, newUid())
  const { uid, t } = journal.getEntry(id)
  emit('log', { uid, t, kind, text, data })
  return id
}
function newUid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// --- Déploiement initial dans le journal : le placement de départ tire au
// hasard l'hex des unités à plage d'entrée (cf. `buildInitialCounters`). Sans
// trace de ce tirage, le rejeu en refaisait un autre et les unités jamais
// déplacées depuis changeaient de place. On l'enregistre donc, en PREMIÈRE
// entrée du journal (entrée `setup`, cf. applyReplayEntry) — au moment du
// premier évènement de la partie, et pas dès le chargement : écrire au
// chargement déclencherait l'auto-save et écraserait la sauvegarde qu'on
// propose justement de reprendre.
// En ligne, le déploiement est au contraire partagé DÈS le lancement (cf.
// onMounted, évènement `deploy`) : ce mécanisme-ci est alors désactivé.
let deploymentLogged = props.online
function logDeploymentOnce() {
  if (deploymentLogged || isReplaying.value || !journalRef.value) return
  deploymentLogged = true
  journalRef.value.log('setup', t('log.deployment'), deploymentData())
  // Puis le tour de départ (cf. `initialTurnEntry`) : TurnTracker.vue
  // l'annonce (évènement `change`) pendant son propre montage, AVANT que le
  // journal ne soit monté — onTurnChange ne peut donc pas l'inscrire, on le
  // rattrape ici, juste après le déploiement et avant le premier évènement.
  if (initialTurnEntry) journalRef.value.log(initialTurnEntry.kind, initialTurnEntry.text, initialTurnEntry.data)
}

/** Entrée de journal d'un changement de tour (cf. onTurnChange) — factorisée
 *  pour l'entrée du tour de DÉPART de la partie (cf. `initialTurnEntry`). */
function turnEntryOf(info) {
  // Piste à phases entremêlées (cf. lib/turnTrack.js) : chaque pas est une
  // phase d'un camp — dont le camp n'est pas encore connu si son ordre se
  // tire au dé (cf. `rollPhaseOrder`, qui l'inscrit juste après).
  const slot = turnTrackerRef.value?.currentSlot
  if (slot) {
    const phaseLabel = phaseNameOf(turnStructure.phases?.find((entry) => entry.id === slot.phase)?.step)
    const text = info.activeSideKey
      ? t('log.turnPhase', { turn: info.turn, phase: phaseLabel, side: sideLabel(info.activeSideKey) })
      : t('log.turnPhaseRoll', { turn: info.turn, phase: phaseLabel })
    return { kind: 'turn', text, data: { step: info.step } }
  }
  return { kind: 'turn', text: t('log.turn', { turn: info.turn, side: sideLabel(info.activeSideKey) }), data: { step: info.step } }
}
// Tour en cours au lancement de la partie, figé au montage (cf. onMounted —
// `turnInfo` est alors déjà renseigné par TurnTracker.vue), pour être inscrit
// au journal avec le déploiement (en local, cf. logDeploymentOnce) ou
// partagé avec lui (en ligne, cf. startSharedJournal). `null` sans piste de
// tour.
let initialTurnEntry = null

// --- Retour arrière : annule le dernier déplacement d'un pion déjà posé sur
// la carte (onHex / onCounterDragEnd ci-dessous) et efface son entrée de
// journal correspondante. Ne couvre volontairement que les déplacements —
// pas les entrées en jeu, éliminations, etc., qui ont leurs propres
// mécanismes de retour (menu contextuel "Replacer le pion").
// L'historique ne vaut que pour la phase de Mouvement EN COURS : il est vidé
// à chaque changement de phase (cf. watcher de `phase`) et de tour (cf.
// `clearAllMoved`). Sinon, en phase Combat, "Retour arrière" renvoyait à sa
// position d'avant mouvement une unité qui avait déjà combattu, voire avancé
// après combat — le journal la disait encore là où elle avait avancé, les
// règles la voyaient ailleurs, et les retraites suivantes passaient par
// l'hex qu'elle était censée tenir. Au tour suivant, l'adversaire pouvait de
// même annuler le dernier mouvement du joueur précédent.
const moveHistory = ref([])
function pushMoveHistory(counterId, from, to, journalId, enteredFrom = null) {
  if (journalId == null) return
  moveHistory.value.push({ counterId, from, to, journalId, enteredFrom })
}

// --- Côté d'entrée dans l'hex : `counter.enteredFrom` = id ("CCRR") de l'hex
// d'où le pion est entré dans son hex actuel, ou `null` (posé là, ou présent
// depuis le début). Gardé d'un tour sur l'autre jusqu'au mouvement suivant :
// dans un hex coupé par une île, il décide des côtés par lesquels le pion
// peut ressortir (cf. lib/passages.js, lib/useAssisted.js::canEnterTerrain).
// Tenu à jour au déplacement (cf. onHex), à son annulation (cf.
// undoLastMove/cancelMovement) et au rejeu (cf. applyRemoteMove).
function entryFromMove(from, to) {
  return from && hexDistance(from, to) === 1 ? hexId(from.col + 1, from.row) : null
}

// --- Liseré orange "a bougé ce tour" : un pion déplacé (clic ou glisser,
// cf. onHex / onCounterDragEnd / applyRemoteMove) rejoint `movedThisTurnIds`
// et sa position de départ (avant son PREMIER mouvement du tour) est gardée
// dans `turnStartPositions`, pour que "Annuler le mouvement" (menu
// contextuel, cf. onCounterContextMenu) puisse le ramener d'un coup à cette
// position quel que soit le nombre de déplacements intermédiaires. Les deux
// sont vidés à chaque changement de tour (cf. onTurnChange) : "à la fin du
// tour du joueur, tous les liserés sont enlevés".
const movedThisTurnIds = ref(new Set())
const turnStartPositions = new Map()
function markMoved(counterId, from, enteredFrom = null) {
  const key = String(counterId)
  noteAutoMoveTrail(counterId, from)
  // Le côté d'entrée d'avant le premier mouvement est gardé avec la position
  // de départ : "Annuler le mouvement" le rétablit (cf. cancelMovement).
  if (!turnStartPositions.has(key)) turnStartPositions.set(key, { ...from, enteredFrom })
  movedThisTurnIds.value.add(key)
  movedThisTurnIds.value = new Set(movedThisTurnIds.value)
}
// --- Traces des pions à hex-objectif (cf. `runAutoMoves`) : id (chaîne) ->
// liste de segments `{ step, points: [{ col, row }] }`, un segment par pas de
// la piste de tour où le pion a bougé. Gardées toute la partie, affichées en
// mode debug (cf. lib/useDebug.js::autoMoveTrailLines). Une position déjà
// présente dans le segment en cours (retour arrière, "Annuler le
// mouvement") le tronque jusqu'à elle.
const autoMoveTrails = ref(new Map())
function noteAutoMoveTrail(counterId, from) {
  const counter = counters.value.find((candidate) => String(candidate.id) === String(counterId))
  if (!counter || !moduleRules.autoMoveTarget(counter)) return
  const key = String(counterId)
  const step = turnTrackerRef.value?.currentStep ?? 0
  const position = { col: counter.col, row: counter.row }
  const same = (a, b) => a.col === b.col && a.row === b.row
  const trail = [...(autoMoveTrails.value.get(key) ?? [])]
  let segment = trail[trail.length - 1]
  if (!segment || segment.step !== step) {
    const start = segment ? segment.points[segment.points.length - 1] : (from ?? position)
    segment = { step, points: [start] }
    trail.push(segment)
  } else {
    segment = { step, points: [...segment.points] }
    trail[trail.length - 1] = segment
  }
  const seen = segment.points.findIndex((point) => same(point, position))
  if (seen >= 0) segment.points.splice(seen + 1)
  else segment.points.push(position)
  if (segment.points.length < 2) trail.pop()
  autoMoveTrails.value = new Map(autoMoveTrails.value).set(key, trail)
}

function clearMoved(counterId) {
  const key = String(counterId)
  turnStartPositions.delete(key)
  if (movedThisTurnIds.value.delete(key)) movedThisTurnIds.value = new Set(movedThisTurnIds.value)
  // Un pion dont le mouvement est entièrement annulé (cf. cancelMovement/
  // undoLastMove, seuls appelants) n'a, de fait, plus bougé ce tour-ci : le
  // verrou de sélection ci-dessous (cf. `lockedFromSelectionIds`, qui ne se
  // justifie QUE par un mouvement réellement effectué) ne tient plus non plus.
  if (lockedFromSelectionIds.value.delete(key)) lockedFromSelectionIds.value = new Set(lockedFromSelectionIds.value)
}
// Liseré AFFICHÉ seulement jusqu'à la fin de la phase Mouvement (Airborne,
// Mouvement, ou partie Libre sans phases : `phase` vaut `null`) : dès la
// phase Combat, il disparaît de la carte. `movedThisTurnIds` reste, lui,
// intact jusqu'au changement de tour (verrou de sélection, rejeu).
const showMovedRings = computed(() => phase.value === null || phase.value <= 0)
function clearAllMoved() {
  turnStartPositions.clear()
  movedThisTurnIds.value = new Set()
  lockedFromSelectionIds.value = new Set()
  // Nouveau tour/camp : plus rien à annuler du tour écoulé (cf. `moveHistory`).
  moveHistory.value = []
  // Les règles particulières du module qui ne valent que pour le tour écoulé
  // s'effacent au même moment (cf. lib/useArnhem.js::clearTurnState — les
  // aéroportés largués ce tour-ci, dont l'allocation de mouvement est
  // réduite jusqu'au tour suivant). Sans effet sur les autres modules.
  moduleRules.clearTurnState()
}

// --- Verrouillage d'une unité après désélection (mouvement normal) --------
// Une unité qui a bougé ce tour-ci (cf. `movedThisTurnIds`) et qui est
// ENSUITE désélectionnée — qu'on la reclique pour la désélectionner, ou
// qu'on sélectionne autre chose à sa place — ne peut PLUS être resélectionnée
// ce même tour : son mouvement est alors considéré comme définitivement
// terminé (cf. onCounterSelect). Remis à zéro en même temps que
// `movedThisTurnIds` (cf. `clearAllMoved` ci-dessus) : une unité verrouillée
// un tour redevient sélectionnable normalement au tour suivant.
const lockedFromSelectionIds = ref(new Set())

// Avertissement "mouvement non terminé" (cf. setSelectedCounter ci-dessous) :
// `{ key, hex, units }` de l'hex en overstack, ou `null` (modale fermée).
const unitStackBlock = ref(null)

/** SEUL point d'entrée pour changer `selectedCounterId` — verrouille au
 *  passage l'ANCIEN pion sélectionné (cf. `lockedFromSelectionIds` ci-dessus)
 *  s'il avait bougé ce tour-ci, avant de basculer la sélection sur `id` (ou
 *  `null`, pour une simple désélection sans rien sélectionner à la place).
 *
 *  REFUSE le changement (renvoie `false`, sélection inchangée, modale
 *  d'avertissement ouverte) si l'ancien pion est en OVERSTACK — il partage
 *  son hex avec une unité amie (cf. lib/useAssisted.js::isOverstacked) : on
 *  ne peut pas terminer son mouvement là, ni passer à une autre unité avant
 *  de l'avoir déplacé (ou d'avoir annulé son mouvement). Renvoie `true`
 *  sinon. */
function setSelectedCounter(id) {
  const previous = selectedCounterId.value
  if (previous != null && previous !== id) {
    const prev = counters.value.find((counter) => String(counter.id) === String(previous))
    if (isOverstacked(prev)) {
      const units = counters.value.filter((counter) => counter.col === prev.col && counter.row === prev.row && isFighter(counter))
      unitStackBlock.value = { key: prev.col + ',' + prev.row, hex: hexId(prev.col + 1, prev.row), units: units.map((unit) => unit.name) }
      return false
    }
  }
  if (previous != null && previous !== id && movedThisTurnIds.value.has(String(previous))) {
    lockedFromSelectionIds.value = new Set(lockedFromSelectionIds.value).add(String(previous))
  }
  selectedCounterId.value = id
  return true
}
/** Menu contextuel "Annuler le mouvement" (cf. onCounterContextMenu) : remet
 *  le pion à sa position de début de tour, en une seule fois. */
function cancelMovement(id) {
  const key = String(id)
  const start = turnStartPositions.get(key)
  if (!start) return
  const counter = counters.value.find((counter) => String(counter.id) === String(id))
  if (counter) {
    // cf. lib/useAssisted.js::resetMp — annule d'un coup TOUS les
    // déplacements du tour de `c` (pas hex par hex comme `undoLastMove`
    // ci-dessous), donc on lui redonne la TOTALITÉ de ses MP plutôt que de
    // recréditer un seul hex. Ne fait rien hors mode Assisté.
    resetMp(counter)
    // ...sauf ce que le module lui compte comme déjà dépensé À SON ARRIVÉE
    // (cf. lib/useArnhem.js::airborneArrivalSpentMp) : un aéroporté largué
    // ce tour-ci qui annule son mouvement retrouve ses 3 MP d'atterrissage,
    // pas les 7 de son allocation imprimée.
    const arrivalMp = moduleRules.airborneArrivalSpentMp(counter)
    if (arrivalMp !== null) setSpentMp(counter.id, arrivalMp)
    counter.col = start.col; counter.row = start.row
    counter.enteredFrom = start.enteredFrom ?? null
    noteAutoMoveTrail(counter.id)
    emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
    log('move', t('log.moveCancelled', { unit: counter.name, hex: hexId(counter.col + 1, counter.row) }) + mpText(counter),
      { counterId: counter.id, col: counter.col, row: counter.row, mp: spentMpOf(counter), enteredFrom: counter.enteredFrom })
  }
  clearMoved(id)
}

// --- Retour arrière (bouton de la barre d'outils) : disponible UNIQUEMENT
// en mode Assisté (cf. `v-if="assisted"` sur le bouton plus bas) — en mode
// Libre, aucun garde-fou de tour/MP n'existe, "annuler" un glisser-déposer
// libre n'aurait pas vraiment de sens dans un bac à sable — et seulement en
// phase Mouvement (cf. `moveHistory`) : passé cette phase, les déplacements
// sont acquis (combats, retraites et avances en dépendent).
function undoLastMove() {
  if (!props.assisted || inputLocked.value || phase.value !== 0) return
  const last = moveHistory.value.pop()
  if (!last) return
  const counter = counters.value.find((counter) => String(counter.id) === String(last.counterId))
  if (counter) {
    // cf. lib/useAssisted.js::refundMp — recrédite le COT de l'hex QUITTÉ
    // par cette annulation (`last.to`, celui que `c` avait payé pour y
    // entrer EN VENANT de `last.from`), avant même de replacer `c` : l'ordre
    // n'a pas d'importance ici (refundMp ne regarde que les hex passés en
    // paramètre, pas la position courante de `c`). `last.to`/`last.from`
    // sont au format `{ col, row }` (comme tout `moveHistory`/position de
    // pion) — `terrainCost` attend `{ c, r }` (comme les hex de clic, cf.
    // onHex/hexes) : conversion nécessaire, sans quoi `terrainCost` ne
    // trouve jamais le bon type de terrain (ni la bonne arête route/piste)
    // et retombe silencieusement sur son coût par défaut (1 MP) au lieu du
    // vrai coût. Passer `last.from` ici (le MÊME "from" qu'au `spendMp`
    // d'origine, cf. onHex) est ce qui garantit un remboursement exact,
    // route/piste comprise, même si `c` a depuis quitté cette position.
    refundMp(counter, { c: last.to.col, r: last.to.row }, { c: last.from.col, r: last.from.row })
    counter.col = last.from.col; counter.row = last.from.row
    counter.enteredFrom = last.enteredFrom ?? null
    noteAutoMoveTrail(counter.id)
    emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
    // Si l'annulation ramène le pion à sa position de tout début de tour,
    // il n'a plus "bougé ce tour" au sens du liseré orange.
    const start = turnStartPositions.get(String(counter.id))
    if (start && start.col === counter.col && start.row === counter.row) clearMoved(counter.id)
  }
  if (props.online) {
    const uid = journalRef.value?.getEntry(last.journalId)?.uid
    if (uid) emit('unlog', uid)
  }
  journalRef.value?.remove(last.journalId)
}

// --- Dé : widget flottant non-bloquant (cf. RollModal.vue), toujours monté
// (v-show, pas v-if, pour conserver sa position glissée et son état pendant
// qu'il est caché) — résultat journalisé à chaque lancer. Mode Libre
// UNIQUEMENT (widget et bouton "Cacher/Afficher le dé" absents en mode
// Assisté, cf. template) : en mode Assisté, les jets sont faits par l'appli
// elle-même là où la règle en demande un (cf. CombatModal.vue).
const showRollModal = ref(true)
function onDiceRoll(value) { log('dice', t('log.dice', { value })) }

// --- Table des mouvements : widget flottant du même genre (cf.
// MovementChartModal.vue), affiché uniquement si le module déclare l'image
// (`module.movementChart`) — modules pas encore illustrés : pas de bouton.
const showMovementChart = ref(false)
const movementChartSrc = computed(() => props.module.movementChart)

// --- Table de combat : même widget flottant, affiché uniquement si le
// module déclare l'image (`module.combatChart`).
const showCombatChart = ref(false)
const combatChartSrc = computed(() => props.module.combatChart)

// --- Lecteur de rejeu : rejoue sur la carte les actions d'un journal
// chargé (cf. JournalPanel.vue::onFileChosen, évènement `loaded`) — un
// bouton lecture façon lecteur audio avance d'une ligne à chaque clic,
// un bouton avance rapide saute directement à la fin. `isReplaying` coupe
// le ré-enregistrement le temps d'appliquer un pas (cf. onTurnChange plus
// haut) : les entrées rejouées existent déjà dans le fichier chargé, les
// rejouer ne doit faire bouger que la carte, pas dupliquer le journal. Le
// détail de l'application de chaque type d'entrée (`applyReplayEntry`) vit
// plus bas, une fois `applyRemoteMove`/`applyRemoteTurn` déclarées.
const replayEntries = ref([])   // [{ kind, text, data }] — ordre chronologique
const replayIndex = ref(0)      // nombre d'entrées déjà appliquées à la carte
const isReplaying = ref(false)  // vrai le temps d'appliquer un pas

// --- Suivi de tour : piste de `turns` tours, chacun joué par les camps de
// `order` dans cet ordre (ex. ["allies","german"] -> Tour 1 Alliés, Tour 1
// Allemands, Tour 2 Alliés, ...). Toute la logique (pas courant, camp actif,
// restriction de contrôle) vit dans TurnTracker.vue, autonome — HexMap.vue ne
// garde qu'un miroir léger (`turnInfo`, mis à jour via `change`) pour ses
// propres besoins ailleurs (régénération du soutien allié par tour) et
// délègue `canControl`/`applyRemoteTurn` au composant enfant (cf. ref
// `turnTrackerRef`).
const turnTrackerRef = ref(null)
const turnInfo = ref({ step: props.initialTurnStep, turn: 1, activeSideKey: null, activeFactions: null })
// Est-ce au joueur de CE navigateur de jouer ? Toujours vrai en solo/démo
// (`localSide` vide : un seul navigateur pour tous les camps). En ligne, les
// autres joueurs ne peuvent ni changer de phase ni passer au tour suivant
// (bouton de TurnTracker.vue désactivé, cf. template), et seul le joueur
// actif reçoit l'alerte "Temps imparti terminé" (cf. onMoveTimeUp).
const isLocalTurn = computed(() => !props.localSide || props.localSide === turnInfo.value.activeSideKey)
function onTurnChange(info) {
  turnInfo.value = info
  // Fin du tour du joueur précédent : tous les liserés "a bougé ce tour"
  // sont enlevés (cf. `movedThisTurnIds`). Pas pendant un rejeu : c'est
  // alors applyReplayEntry (entrée `turn`) qui s'en charge, de façon
  // SYNCHRONE — cet évènement-ci arrive en différé (watcher de
  // TurnTracker.vue), et, lors d'une avance rapide, il effacerait après coup
  // les mouvements du tour en cours que le rejeu vient de rétablir.
  if (!isReplaying.value) clearAllMoved()
  // Ne pas ré-écrire dans le journal un changement de tour provoqué par le
  // lecteur de rejeu (cf. plus bas) — l'entrée existe déjà dans le fichier
  // chargé, la rejouer ne doit que faire bouger la carte, pas dupliquer le
  // journal.
  if (isReplaying.value) return
  // Le tour de DÉPART n'est jamais inscrit ici mais avec le déploiement (cf.
  // `initialTurnEntry`) : au montage, le journal n'existe pas encore, et
  // l'inscrire plus tard déclencherait l'auto-save qui écraserait la
  // sauvegarde proposée en reprise (cf. logDeploymentOnce).
  if (info.step === props.initialTurnStep) return
  // En ligne, seul le navigateur qui a fait avancer le tour l'inscrit au
  // journal partagé ; les autres le reçoivent (cf. applyRemoteEntry).
  if (props.online && info.step !== localTurnStep) return
  if (info.step === lastLoggedTurnStep) return
  lastLoggedTurnStep = info.step
  const entry = turnEntryOf(info)
  log(entry.kind, entry.text, entry.data)
}
// Dernier pas inscrit au journal par onTurnChange : `change` repart aussi
// quand seul le camp actif change sur le même pas (ordre tiré au dé, cf.
// `rollPhaseOrder`), qui ne doit pas réinscrire le tour.
let lastLoggedTurnStep = null
// Dernier pas atteint par une avance LOCALE (cf. onTurnChange, en ligne).
let localTurnStep = null
function onTurnAdvance(step) {
  localTurnStep = step
  emit('turn', step)
}
function applyRemoteTurn(step) { turnTrackerRef.value?.applyRemoteTurn(step) }
// Un renfort ne peut entrer en jeu qu'à partir de son tour d'arrivée déclaré
// (`c.turn`, cf. module JSON) — jamais en avance. Par défaut (pas de `turn`
// déclaré), l'unité arrive dès le tour 1.
const canEnterThisTurn = (counter) => (counter?.turn ?? 1) <= turnInfo.value.turn

// --- Soutien allié : tablette autonome (cf. SupportTracker.vue, toute la
// logique — régénération par tour, tablette actuelle — y vit, déduite des
// pions sur la carte, cf. `placedIds`). HexMap.vue ne garde qu'une ref pour
// y résoudre un pion glissé depuis la tablette (cf. onCounterDragStart /
// onMapDrop plus bas).
const supportTrackerRef = ref(null)

// Pion de la tablette choisi au clic, en attente d'un clic sur un hex pour
// être posé (mode Assisté — cf. SupportTracker.vue, onSupportSelect et la
// branche "soutien" de onHex plus bas). `null` : aucun.
const selectedSupportId = ref(null)

// Calibration déclarée par le module (`map.calibration`), complétée par le
// repli du moteur — et base du bouton "réinitialiser défauts".
const moduleCalibration = { ...DEFAULT_CALIBRATION, ...(map.value.calibration ?? {}) }
const calibration = reactive({ ...moduleCalibration })
const gridStyle = reactive({ stroke: '#d11a1a', width: 1.5, opacity: 0 })
const mapConfig = reactive({ cols: map.value.cols, rows: map.value.rows })

const zoom = ref(0.5)
// `showGrid` vient de useAssisted() plus bas (verrouillé à false hors mode
// assisté).
const showLabels = ref(false)
const showCalib = ref(false)
const showCounters = ref(true)

// Forme réelle de la grille (colonnes décalées amputées d'une ligne, hexs
// ponctuels absents) — cf. lib/mapShape.js — recalculée seulement quand le
// module ou le nombre de cols/rows édité via CalibrationPanel change.
const mapShapeCfg = computed(() => ({
  cols: mapConfig.cols, rows: mapConfig.rows, evenColMinus: map.value.evenColMinus,
}))
const removed = computed(() => removedHexSet(map.value))
const hexOnMap = (col, row) => hexExists(col, row, mapShapeCfg.value, removed.value)

/** Liste des hex de la grille avec leur polygone SVG déjà calculé. */
const hexes = computed(() => {
  const { x0, y0, colStep, a: hexRadius, rowStep } = calibration
  const halfRowStep = rowStep / 2
  const out = []
  for (let col = 0; col < mapConfig.cols; col++) {
    const cx = x0 + col * colStep
    const yoff = col % 2 === 1 ? rowStep / 2 : 0
    for (let row = 1; row <= mapConfig.rows; row++) {
      if (!hexOnMap(col, row)) continue
      const cy = y0 + (row - 1) * rowStep + yoff
      const pts = [
        [cx - hexRadius, cy], [cx - hexRadius / 2, cy - halfRowStep], [cx + hexRadius / 2, cy - halfRowStep],
        [cx + hexRadius, cy], [cx + hexRadius / 2, cy + halfRowStep], [cx - hexRadius / 2, cy + halfRowStep],
      ].map((point) => point[0].toFixed(1) + ',' + point[1].toFixed(1)).join(' ')
      out.push({ id: hexId(col + 1, row), c: col, r: row, cx, cy, pts })
    }
  }
  return out
})

// Tous les pions déclarés par le module, toutes factions confondues (cf.
// public/modules/arnhem/arnhem.json -> counters.*) — sert à la fois au
// placement initial ci-dessous et à la liste des renforts pas encore posés
// (cf. `reinforcements`).
const allCounters = computed(() => Object.values(props.module.counters || {}).flat())

// --- Pions en nombre illimité (`multiple: true`, ex. leurres américains de
// la mer de Corail) : le pion du module n'est qu'un MODÈLE, qui reste dans le
// panneau ; chaque pose crée un exemplaire d'id "<id du modèle>#<n>". Le
// journal ne garde que cet id : `counterDefinition` retrouve le modèle pour
// recréer l'exemplaire au rejeu ou en ligne.
const INSTANCE_SEP = '#'
function counterDefinition(id) {
  const key = String(id)
  const declared = allCounters.value.find((counter) => String(counter.id) === key)
  if (declared) return declared
  const cut = key.lastIndexOf(INSTANCE_SEP)
  if (cut === -1) return null
  const template = allCounters.value.find((counter) => String(counter.id) === key.slice(0, cut))
  return template?.multiple ? { ...template, id: key, templateId: template.id } : null
}
/** Le pion à poser pour le renfort `reinforcement` : lui-même, ou un nouvel
 *  exemplaire s'il est en nombre illimité. */
function instanceOf(reinforcement) {
  if (!reinforcement?.multiple) return reinforcement
  const prefix = String(reinforcement.id) + INSTANCE_SEP
  const used = [...counters.value.map((counter) => String(counter.id)), ...eliminatedIds.value]
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)) || 0)
  return { ...reinforcement, id: prefix + (Math.max(0, ...used) + 1), templateId: reinforcement.id }
}

/** Un hex cible tiré au hasard parmi ceux du `setup` du pion (cf.
 *  lib/setup.js::deploymentCells — toute la plage pour un "CCRR-CCRR", l'hex
 *  de référence sinon) — utilisé uniquement pour le placement initial
 *  automatique au chargement (cf. `counters` ci-dessous), pas pour l'arrivée
 *  interactive d'un renfort (cf. plus bas : glisser-déposer libre ou choix
 *  explicite d'un hex surligné). Si `occupied` (Set "col,row" des hex déjà
 *  PLEINS, cf. `buildInitialCounters`) est fourni, le tirage se fait d'abord
 *  parmi les autres hex de la plage — sans quoi, avec une limite
 *  d'empilement de 1, plusieurs pions d'une même plage se percutaient et
 *  débordaient hors de la bande via `pickArrivalHex`. */
function resolveEntryTarget(setup, occupied = null, counter = null) {
  // Hex interdits à ce pion par une règle du module (cf.
  // `moduleRules.hexForbidden`) retirés de la plage, sauf s'il n'en reste
  // aucun.
  const cells = deploymentCells(parseSetup(setup), hexOnMap)
  const allowed = counter ? cells.filter((cell) => moduleRules.hexForbidden(counter, cell) !== true) : cells
  const pool = allowed.length ? allowed : cells
  const free = occupied ? pool.filter((cell) => !occupied.has(cell.col + ',' + cell.row)) : []
  const candidates = free.length ? free : pool
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/** Jamais de stacking : un pion qui arrive prend son hex d'entrée s'il est
 *  libre, sinon un des 6 hex adjacents libres tiré au hasard. `occupied` est
 *  le Set (clés "col,row") des hex déjà réservés dans le lot de placement en
 *  cours — mis à jour par l'appelant après chaque choix. Si les 7 emplacements
 *  sont pleins (cas limite), on stack quand même plutôt que de perdre le pion. */
function pickArrivalHex(col, row, occupied) {
  const key = (keyCol, keyRow) => keyCol + ',' + keyRow
  if (hexOnMap(col, row) && !occupied.has(key(col, row))) return { col, row }
  const free = neighborsOf(col, row).filter((neighbor) => hexOnMap(neighbor.col, neighbor.row) && !occupied.has(key(neighbor.col, neighbor.row)))
  if (free.length) return free[Math.floor(Math.random() * free.length)]
  return { col, row }
}

// Paramètres des règles génériques déclarés par le module (`module.rules`,
// cf. lib/rules.js) : véhicules, terrains interdits, empilement, ZOC...
const rules = resolveRules(props.module.rules)
// Structure du tour d'un camp : phases facultatives déclarées par le module
// (`module.turnStructure`, cf. lib/rules.js et lib/useAssisted.js, "Phases").
const turnStructure = resolveTurnStructure(props.module.turnStructure)

// Règles PARTICULIÈRES au module joué (cf. lib/moduleRules.js, registre par
// module — ex. lib/useArnhem.js) : tout ce qui ne vaut QUE pour une boîte de
// jeu précise et qu'aucun champ du JSON ne sait exprimer. Pour un module qui
// n'en déclare pas, chaque règle renvoie `null` et le moteur générique
// ci-dessous s'applique tel quel.
const moduleRules = useModuleRules(toRef(props, 'moduleId'), {
  sides: props.module.sides,
  isUnit,
  assisted: toRef(props, 'assisted'),
  terrain: props.module.terrain,
  rules,
  // Tous les pions du module (cf. lib/useCoralSea.js, tirage des leurres).
  allCounters: () => allCounters.value,
  // Pions posés sur la carte, passés en FONCTION : `counters` n'est déclaré
  // que plus bas (il dépend de `autoPlacesAtLoad`, donc de ce composable) —
  // même détour que `reinforcements` avec useAssisted().
  counters: () => counters.value,
  // De quoi juger ce qu'une unité peut atteindre autour d'elle (encerclement,
  // cf. lib/useArnhem.js::isSurrounded). Enveloppées dans des lambdas pour la
  // même raison : useAssisted() n'est appelé qu'ensuite, et ne fournit ses
  // fonctions qu'à ce moment-là. Aucune n'est appelée avant la première
  // retraite, bien après l'initialisation.
  hexOnMap,
  isFighter,
  canEnterTerrain: (counter, hex, from) => canEnterTerrain(counter, hex, from),
  enemyZocSet: (counter) => enemyZocSet(counter),
  isEnemyOf: (counterA, counterB) => isEnemyOf(counterA, counterB),
  // Nature d'un hexside, phase et camp actif : de quoi reconnaître une
  // rivière et le moment où la passerelle du génie s'ouvre (cf.
  // lib/useArnhem.js::engineerCrossingAllows).
  edgeKind: (from, hex) => edgeKind(from, hex),
  phase: computed(() => phase.value),
  activeSide: computed(() => turnInfo.value.activeSideKey),
})

// Étiquette secrète d'un pion (cf. `moduleRules.privateLabel` — ex. vraie
// identité d'un leurre japonais, lib/useCoralSea.js) : en mode debug
// seulement, et au seul camp qui la connaît — en ligne, à ce joueur-là ; en
// local (un seul écran), le temps de son tour seulement.
const privateLabelVisible = computed(() => {
  const side = moduleRules.privateLabelSide
  if (!side || !debug.value) return false
  return props.online ? props.localSide === side : turnInfo.value.activeSideKey === side
})
function privateLabelOf(counter) {
  return privateLabelVisible.value ? moduleRules.privateLabel(counter) : null
}

// Marqueurs / pions de soutien / unités combattantes : cf. lib/units.js
// (`isUnit`, `isFighter`, `isSupport`, importés plus haut) — seule
// définition de ce qu'est une "vraie unité" pour tout le moteur.

// Un pion est posé sur la carte au chargement s'il a un `setup` (hex de
// départ) ET arrive au tour 1 (ou sans `turn` — rétrocompatible avec les
// pions sans ce champ, ex. une garnison fixe). C'est la règle GÉNÉRIQUE,
// valable pour tout module.
// Un module peut la restreindre via ses règles particulières (cf.
// lib/useArnhem.js::autoPlacesAtLoad — Arnhem y retient hors carte les
// renforts allemands du tour 1 et toutes les UNITÉS alliées, dont seules les
// zones de largage "DZ" sont posées au coup d'envoi). La règle du module
// renvoie `null` quand elle ne se prononce pas — y compris, toujours, sur
// les autres modules — et on retombe alors sur la règle générique.
// Les renforts restants (tous tours/factions confondus) restent hors carte,
// glissables depuis le panneau "Renfort ..." (cf. `reinforcements`).
// Plusieurs pions peuvent partager le même hex d'entrée déclaré (ex. les 3
// bataillons d'un même régiment) : pickArrivalHex les répartit pour éviter
// le stacking (les marqueurs, eux, ignorent complètement cette logique — cf.
// isUnit).
function autoPlacesAtLoad(counter) {
  const special = moduleRules.autoPlacesAtLoad(counter)
  if (special !== null) return special
  return (counter.turn ?? 1) === 1
}
/** Placement initial du module — extrait en fonction pour être rejouable
 *  (cf. `resetBoardForReplay` plus bas), pas seulement au montage. Utilise
 *  `resolveEntryTarget`/`pickArrivalHex`, qui tirent au hasard un hex parmi
 *  la plage `setup` : rejouer ne reproduit donc pas exactement le tirage
 *  aléatoire d'origine pour les pions jamais déplacés depuis (non
 *  journalisé) — sans conséquence pour ceux qui bougent, puisque chaque
 *  `move`/`place` rejoué fixe une position absolue. */
function buildInitialCounters() {
  // Hex PLEINS au regard de la limite d'empilement du module
  // (`rules.stackingLimit` : 1 à Arnhem ; aucune à la mer de Corail, où
  // plusieurs leurres peuvent donc tomber dans le même hex) — seuls ceux-là
  // sont évités.
  const unitsPerHex = new Map()
  const occupied = new Set()
  const placed = []
  // Un pion à poser "n'importe où" (`setup` "*") ne l'est jamais d'office.
  for (const counter of allCounters.value.filter((counter) => parseSetup(counter.setup) && parseSetup(counter.setup).kind !== 'anywhere' && autoPlacesAtLoad(counter))) {
    const override = props.initialPositions[counter.id]
    const target = resolveEntryTarget(counter.setup, isUnit(counter) ? occupied : null, counter)
    const pos = override ?? (isUnit(counter) ? pickArrivalHex(target.col, target.row, occupied) : target)
    if (isUnit(counter)) {
      const key = pos.col + ',' + pos.row
      const count = (unitsPerHex.get(key) ?? 0) + 1
      unitsPerHex.set(key, count)
      if (count >= rules.stackingLimit) occupied.add(key)
    }
    placed.push({ ...counter, ...pos })
  }
  return placed
}
const counters = ref(buildInitialCounters())
// Positions de départ de CETTE partie (cf. `logDeploymentOnce`), capturées
// avant tout mouvement.
const initialDeployment = counters.value.map((counter) => ({ id: counter.id, col: counter.col, row: counter.row }))
/** Données de l'entrée `setup` du journal : positions de départ et, le cas
 *  échéant, tirage secret du module (cf. lib/useCoralSea.js, identité des
 *  leurres). */
function deploymentData() {
  const secrets = moduleRules.setupSecrets()
  return secrets ? { positions: initialDeployment, secrets } : { positions: initialDeployment }
}

// SORT DES PONTS (cf. lib/useBridges.js, qui porte les deux règles : quels
// ponts peuvent sauter, qui décide, ce que fait le dé — et quels ponts un
// génie peut ensuite relever). Appelé ICI, et pas plus bas : useAssisted() a
// besoin de son `isDemolished` pour lire les arêtes (un pont démoli ne laisse
// plus que l'obstacle qu'il franchissait), et lui n'a besoin que de
// `counters`, déjà déclaré juste au-dessus. Inerte pour un module qui ne
// déclare ni `rules.bridgeDemolition` ni `rules.bridgeRepair`.
const demolition = useBridges({
  assisted: toRef(props, 'assisted'),
  terrain: props.module.terrain,
  demolition: rules.bridgeDemolition,
  repair: rules.bridgeRepair,
  counters,
  sideOf: (counter) => sideOfCounter(counter),
  isFighter,
  // Tous trois n'existent que plus bas dans ce fichier (useAssisted() pour la
  // ZOC, la piste de tour pour le reste) : enveloppés, ils ne sont lus qu'à
  // l'usage, jamais à la construction.
  enemyZocSet: (counter) => enemyZocSet(counter),
  activeSide: computed(() => turnInfo.value.activeSideKey),
  step: computed(() => turnTrackerRef.value?.currentStep ?? 0),
})

// LIGNES DE COMMUNICATION (cf. lib/useSupplyLine.js, qui porte toute la
// règle : qui trace, jusqu'où, et ce qui coupe la ligne). Appelé APRÈS
// useAssisted() — dont il lit la ZOC et les hexsides — et avant tout usage,
// ci-dessous. Inerte pour un module qui ne déclare pas `rules.supplyLine`.
// Aucun effet de jeu pour l'instant : la ligne ne fait que s'AFFICHER, en
// mode debug (cf. `isSupplyLineHex`).
const supplyLine = useSupplyLine({
  assisted: toRef(props, 'assisted'),
  supply: rules.supplyLine,
  counters: () => counters.value,
  sideOf: (counter) => sideOfCounter(counter),
  isFighter,
  isAirborneEntry,
  enemyZocSet: (counter) => enemyZocSet(counter),
  edgeKinds: (from, hex) => edgeKinds(from, hex),
  hexOnMap,
})

// POINTS DE VICTOIRE (cf. lib/useVictoryPoints.js) : un total par camp, tenu
// par les joueurs en mode Libre et par le moteur en mode Assisté. Inerte pour
// un module qui ne déclare pas `rules.victoryPoints`.
const victory = useVictoryPoints({
  assisted: toRef(props, 'assisted'),
  victory: rules.victoryPoints,
  terrain: props.module.terrain,
  hexOnMap,
})

// cf. lib/useAssisted.js — toute la logique propre au mode "Assisté"
// (grille, sélection au clic, restriction de tour, phases Mouvement/Combat,
// MP/terrain/ZOC) y vit. Appelé ICI (et pas plus haut dans le fichier,
// comme dans les versions précédentes) parce qu'il a besoin de `counters`
// (cf. `enemyZocSet`, qui doit savoir où sont les pions ennemis) — lequel
// doit donc déjà être déclaré.
// Dernier paramètre : les renforts pas encore posés (phase Airborne, cf.
// lib/useAssisted.js::airbornePending), passés en FONCTION car
// `reinforcements` n'est déclaré que plus bas dans ce fichier.
const { showGrid, selectable, draggable, canControl, phase, phaseLabels, phaseIndex, phaseNameOf, nextLabel, advance, movementAllowance,
  PHASE_AIRBORNE, PHASE_SETUP, initPhase, canPlaceReinforcementNow, canEnterHex, canEnterTerrain, spendMp, refundMp, resetMp, terrainCost, terrainAreaCost, remainingMp, enemyZocSet, isEnemyOf, entrySurcharge, spendEntryCost, unspendEntryCost, wouldOverstack, canLeaveAfterEntering, canLeaveAfterReinforcementEntry, isOverstacked, stackedHexes, edgeKind, edgeKinds, combatEdgeKind, edgeBlocksAttack, isZocFrozen, setPhase, setSpentMp, resetTurnState } = useAssisted(toRef(props, 'assisted'), turnTrackerRef, props.module.terrain, counters, props.module.sides, hexOnMap, () => reinforcements.value, rules, turnStructure, demolition.isDemolished, moduleRules)

// Table de combat déclarée par le module (`module.combat`, cf.
// lib/combatTable.js) — `null` : module sans combat.
const combatTable = resolveCombatTable(props.module.combat)

// Règles de l'ARTILLERIE (cf. lib/useArtillery.js) : tir à distance, facteur
// de barrage, FPF, et la mémoire qui va avec — résultats subis (point rouge)
// et refoulements (point orange). Le pas courant de la piste de tour sert à
// reconnaître la phase de Combat "précédente".
const currentStep = computed(() => turnTrackerRef.value?.currentStep ?? 0)
const artillery = useArtillery({
  phase, step: currentStep, counters, isEnemyOf, edgeBlocksAttack,
  resultEffect: (code) => combatTable?.effects[code] ?? null,
  // Règles particulières du module qui ouvrent un hexside au combat (cf.
  // lib/useArnhem.js::engineerAssaultEdge) — inertes pour les autres modules.
  moduleRules,
})

// Combat du mode Assisté (cf. lib/useCombat.js, qui porte toute la règle :
// désignation défenseur/attaquants, lecture de la table, jet de dé). Ce
// composant ne fait que lui brancher les clics (cf. onCounterSelect/onHex
// plus bas), les surlignages orange/jaune de la carte et la modale (cf.
// template).
const {
  combatActive, combatAllowed, targetHexes: combatTargetHexes, targetHexLabels: combatTargetHexLabels, defenders: combatDefenders,
  attackers: combatAttackers, attackerDetails: combatAttackerDetails, rangedIds: combatRangedIds,
  toggleTarget, removeTargetHex, cancelCombat, toggleAttacker, hasFought, markFought, pendingEngagements,
  isCombatTargetHex, isCombatAttackerHex, isCombatFpfHex,
  fpfCandidates, fpfUnits, fpfStrength, fpfStatus, toggleFpf, requestFpf, cancelFpfRequest, answerFpf, openDefense, chosenFpfIds,
  artilleryLimit, attackArtilleryFull, fpfLimitReached,
  supportCounters, supportStrength, supportAttacking, supportFactor, supportBarred, canPlaceSupportHex,
  supportChoiceIds, toggleSupportChoice, chosenSupportIds,
  attackStrength, defenseStrength, differential, canResolve: combatCanResolve, strandedUnits: combatStrandedUnits,
  terrainRow: combatTerrainRow,
  column: combatColumn, resolveCombat, combatResult, crtRows, crtResults,
} = useCombat(toRef(props, 'assisted'), phase, counters, canControl, props.module.terrain, combatEdgeKind, combatTable, artillery,
  // Tablette de soutien du module (cf. SupportTracker.vue) et camp actif :
  // de quoi savoir ce que vaut un pion de soutien et s'il attaque ou défend.
  { track: props.module.supportTrack, activeSide: computed(() => turnInfo.value.activeSideKey) },
  // Règles particulières du module qui touchent au combat (cf.
  // lib/useArnhem.js) — inertes pour un module qui n'en déclare pas.
  moduleRules)

// Application du résultat d'un combat (retraites au clic, éliminations — cf.
// lib/useRetreat.js, qui porte toute la règle). HexMap.vue ne lui fournit que
// les deux actions concrètes sur la carte : avancer une unité d'un hex, et
// éliminer une unité.
const {
  start: startRetreat, step: stepRetreat, reduce: reduceRetreat, cancelPush, clear: clearRetreat, active: retreatActive,
  info: retreatInfo, notes: retreatNotes, isRetreatHex, isRetreatingHex,
  advanceInfo, selectAdvancer, stepAdvance, endAdvance, isPorHex, isAdvanceHex, isAdvancerHex,
} = useRetreat({
  phase, counters, hexOnMap, canEnterTerrain, isEnemyOf,
  // Retraite interdite en ZOC ennemie — sauf si la règle du module la lève
  // (`rules.zoc.blocksRetreat`, cf. lib/rules.js).
  enemyZocSet: (unit) => (rules.zoc.blocksRetreat ? enemyZocSet(unit) : new Set()),
  moveUnit: (unit, hex, { done, total }) => {
    unit.col = hex.col; unit.row = hex.row
    emit('move', { counterId: unit.id, col: unit.col, row: unit.row })
    // Entrée `retreat` (et non `move`) : une retraite n'est ni un mouvement
    // de la phase (pas de liseré, pas d'annulation possible), ni une
    // dépense de MP — cf. applyReplayEntry.
    log('retreat', t('log.retreat', { unit: unit.name, hex: hexId(unit.col + 1, unit.row), done, total }),
      { counterId: unit.id, col: unit.col, row: unit.row })
  },
  // Ami REFOULÉ d'un hex par une unité qui retraite : même traitement qu'un
  // pas de retraite (entrée `retreat`), avec `noFire` pour une artillerie
  // (qui ne peut plus tirer pendant cette phase de Combat — point orange, cf.
  // lib/useArtillery.js ; rétabli au rejeu, cf. applyReplayEntry).
  displaceUnit: (unit, hex, { by, noFire }) => {
    if (noFire) artillery.markDisplaced(unit.id)
    unit.col = hex.col; unit.row = hex.row
    emit('move', { counterId: unit.id, col: unit.col, row: unit.row })
    log('retreat', t('log.displaced', { unit: unit.name, hex: hexId(unit.col + 1, unit.row), by: by.name })
      + (noFire ? ` ${t('log.noFire')}` : ''),
      { counterId: unit.id, col: unit.col, row: unit.row, displaced: true, ...(noFire ? { noFire: true } : {}) })
  },
  eliminateUnit: (unit, reason) => eliminateCounter(unit.id, reason),
  // Effet de chaque résultat et avance après combat : déclarés par la table
  // du module (cf. lib/combatTable.js).
  resultEffect: (code) => combatTable?.effects[code] ?? null,
  advanceAfterCombat: combatTable?.advanceAfterCombat ?? true,
  // Réductions de retraite propres au module (cf.
  // lib/useArnhem.js::cityRetreatReduction) — `null` hors Arnhem.
  retreatReduction: (unit, hex, task) => moduleRules.cityRetreatReduction(unit, hex, task),
  // Avance après combat : même traitement qu'un pas de retraite, sous une
  // entrée `advance` (cf. applyReplayEntry).
  advanceUnit: (unit, hex) => {
    unit.col = hex.col; unit.row = hex.row
    emit('move', { counterId: unit.id, col: unit.col, row: unit.row })
    log('advance', t('log.advance', { unit: unit.name, hex: hexId(unit.col + 1, unit.row) }),
      { counterId: unit.id, col: unit.col, row: unit.row })
  },
})

// --- Assaut de rivière : prendre l'hex ou mourir (cf. lib/useArnhem.js) ------
// « Si l'unité alliée est incapable d'avancer après ce combat à travers la
// rivière, elle est éliminée. » Un assaut mené sur la passerelle du génie est
// un tout ou rien : l'unité qui ne tient pas l'hex d'en face une fois le
// résultat appliqué — parce qu'il n'a pas été vidé, parce qu'elle a renoncé à
// y avancer, ou parce que le résultat l'a fait reculer — est perdue. (Une
// retraite À TRAVERS la rivière, elle, reste simplement impossible : le
// moteur la refuse comme n'importe quel hexside infranchissable, et
// l'élimination qui s'ensuit est la règle standard.)
//
// Les unités concernées sont relevées AU MOMENT du jet, sur la photo du
// combat (positions d'avant), puis soldées quand l'application du résultat
// est terminée.
let riverAssaults = []

/** Relève les attaquants qui viennent de franchir la rivière à l'assaut, et
 *  l'hex que chacun devait prendre. */
function noteRiverAssaults() {
  riverAssaults = combatAttackers.value.flatMap((unit) => {
    const from = { c: unit.col, r: unit.row }
    const target = combatTargetHexes.value.find((targetHex) =>
      moduleRules.engineerAssaultEdge(unit, from, { c: targetHex.col, r: targetHex.row }) != null)
    return target ? [{ id: unit.id, col: target.col, row: target.row }] : []
  })
}

/** Solde les assauts relevés : qui ne tient pas son hex est éliminé. */
function settleRiverAssaults() {
  const pending = riverAssaults
  riverAssaults = []
  for (const assault of pending) {
    const unit = counters.value.find((counter) => String(counter.id) === String(assault.id))
    // Déjà éliminée par le résultat du combat : rien à ajouter.
    if (!unit) continue
    if (unit.col === assault.col && unit.row === assault.row) continue
    eliminateCounter(unit.id, t('log.riverAssaultFailed'))
  }
}

// L'application d'un résultat (retraites, refoulements, avance) vient de se
// terminer : c'est le moment de solder les assauts. Le cas où il n'y avait
// rien à appliquer est traité à la fin de `onCombatFight`, qui appelle
// directement — le watcher ne verrait rien passer.
watch(retreatActive, (running, wasRunning) => {
  if (wasRunning && !running) settleRiverAssaults()
})

/** Clic sur "Combattre" dans la modale : la règle (dé + lecture de la table)
 *  vit dans lib/useCombat.js, on ne fait ici qu'en journaliser le résultat
 *  (hex cibles et unités défenseuses, qui peuvent être plusieurs), puis
 *  lancer son application (cf. lib/useRetreat.js). */
function onCombatFight() {
  const combatOutcome = resolveCombat()
  if (!combatOutcome) return
  const diff = combatOutcome.diff > 0 ? '+' + combatOutcome.diff : String(combatOutcome.diff)
  const names = combatDefenders.value.map((defender) => defender.name).join(', ')
  const fpf = fpfUnits.value.map((unit) => `${unit.name} +${unit.fpf}`).join(', ')
  // `data` : de quoi restaurer le combat au rejeu du journal (cf.
  // applyReplayEntry, entrée `combat`) — les unités participantes y sont
  // remarquées "ayant combattu" (cf. lib/useCombat.js::markFought), et
  // l'artillerie retrouve ses FPF faits et ses résultats subis (cf.
  // lib/useArtillery.js::applyCombat) : `rangedIds` = artilleries qui ont
  // tiré à distance, `fpfIds` = artilleries du FPF.
  const data = {
    hexes: combatTargetHexLabels.value,
    attackerIds: combatAttackers.value.map((attacker) => attacker.id),
    defenderIds: combatDefenders.value.map((defender) => defender.id),
    rangedIds: [...combatRangedIds.value],
    fpfIds: fpfUnits.value.map((unit) => unit.id),
    // Pions de soutien engagés (cf. lib/useCombat.js) : au rejeu, ils sont
    // remarqués "ayant combattu" comme les unités, pour ne pas pouvoir
    // resservir dans un autre combat de la même phase.
    supportIds: supportCounters.value.map((counter) => counter.id),
    diff: combatOutcome.diff, row: combatOutcome.rowKey, die: combatOutcome.die, result: combatOutcome.result,
  }
  const supportText = supportCounters.value.length
    ? ` ; ${t(supportAttacking.value ? 'log.supportAttacking' : 'log.supportDefending')} `
      + (supportBarred.value ? t('log.supportNoEffect') : `+${supportStrength.value}`)
    : ''
  log('combat', t('log.combat', {
    hexes: combatTargetHexLabels.value.join(', '),
    forces: `${names}${fpf ? ` ; FPF ${fpf}` : ''}${supportText}`,
    diff, row: mt(combatOutcome.rowLabel), die: combatOutcome.die, result: combatOutcome.result,
    label: mt(combatOutcome.resultLabel),
  }), data)
  artillery.applyCombat(data)
  // APRÈS le journal du combat : les éliminations/retraites qui suivent s'y
  // inscrivent donc bien après lui. Une artillerie qui a tiré à distance
  // n'est jamais affectée par le résultat (cf. lib/useArtillery.js) : seuls
  // les attaquants AU CONTACT le subissent.
  const ranged = new Set(data.rangedIds.map(String))
  const contactAttackers = combatAttackers.value.filter((attacker) => !ranged.has(String(attacker.id)))
  // [8.15] Attaque faite uniquement d'artillerie et/ou de soutien : ce
  // résultat-là ne touche pas le défenseur (cf. lib/useCombat.js,
  // `defenderImmune`). On applique quand même la part qui vise les
  // ATTAQUANTS — une artillerie au contact encaisse ([8.33]) — en ne
  // passant simplement aucun défenseur à la résolution. Si le résultat ne
  // visait que le défenseur, il ne reste rien à appliquer.
  const effect = combatTable?.effects[combatOutcome.result] ?? {}
  const hitsAttackers = effect.eliminate === 'attackers' || (effect.retreat?.attackers ?? 0) > 0
  // Assauts de rivière de ce combat, relevés sur la photo (positions d'avant
  // les retraites) — cf. la section "Assaut de rivière" plus haut.
  noteRiverAssaults()
  if (!combatOutcome.defenderImmune) {
    startRetreat(combatOutcome.result, contactAttackers, [...combatDefenders.value], combatTargetHexes.value)
    if (!retreatActive.value) settleRiverAssaults()
    return
  }
  log('info', t('log.defenderImmune', { result: combatOutcome.result }))
  if (hitsAttackers) startRetreat(combatOutcome.result, contactAttackers, [], combatTargetHexes.value)
  if (!retreatActive.value) settleRiverAssaults()
}

// --- Démolition des ponts (cf. lib/useBridges.js) -------------------------
// La règle dit QUELS ponts peuvent sauter et QUAND l'occasion s'ouvre ; ce
// composant-ci ne fait que la présenter au camp qui décide (cf.
// BridgeModal.vue), journaliser sa décision et laisser le composable
// tenir l'état.
//
// L'occasion ouverte BLOQUE la saisie tant qu'elle n'est pas tranchée (cf.
// `inputLocked` plus bas) : la règle veut une décision immédiate, et rien
// d'autre ne doit pouvoir se faire entre-temps.

// Pont dont la modale affiche le RÉSULTAT du jet, figé le temps de montrer le
// dé : sans lui, la décision prise, `demolition.current` passerait aussitôt à
// l'occasion suivante et le joueur ne verrait jamais sa propre face de dé.
const demolitionShown = ref(null)
// Résultat du dernier jet (`{ die, destroyed }`), ou `null` — remis à `null`
// avec `demolitionShown` quand la modale passe à la suite.
const demolitionResult = ref(null)
let demolitionTimer = null

// Combien de temps le résultat du jet reste affiché avant que la modale ne
// passe au pont suivant (ou ne se ferme) — même principe que CombatModal.vue.
const DEMOLITION_RESULT_MS = 2200

// EN LIGNE, qui décide ? Le camp `by` de la règle (l'allemand à Arnhem), qui
// n'a pas toujours la main — c'est même le cas courant, les occasions
// naissant des mouvements alliés. On reprend alors le déroulé du FPF (cf. la
// section "FPF en ligne") : le joueur actif SOUMET l'occasion, son écran
// attend, le camp décideur tranche sur le sien et PUBLIE le sort du pont, que
// les deux appliquent. Quand le camp décideur a la main, il décide sans
// demande préalable et publie directement.

/** Camp qui décide du sort des ponts, ou `null` (module sans cette règle). */
const demolitionSide = rules.bridgeDemolition?.by ?? null

/** Ce navigateur est-il celui du camp décideur ? En partie locale, oui — un
 *  seul écran pour les deux joueurs. */
const demolitionMine = computed(() => !props.online || props.localSide === demolitionSide)

// En ligne : occasion SOUMISE par ce navigateur et dont il attend la réponse
// (joueur actif), et occasion REÇUE à trancher (camp décideur). Les deux
// restent `null` en partie locale.
const demolitionAsked = ref(null)
const demolitionIncoming = ref(null)
let demolitionRequestId = null

/** Une occasion peut-elle être présentée MAINTENANT ? Jamais pendant un rejeu
 *  de journal ni une partie terminée (cf. `actionsLocked`) : l'état y est
 *  rétabli par les entrées `demolition` rejouées, pas par une décision.
 *
 *  Jamais non plus pendant l'application d'un résultat de combat (cf.
 *  `retreatActive` — retraites, refoulements, avance après combat) : la
 *  modale FERME la saisie, et l'ouvrir alors qu'un joueur doit encore
 *  cliquer ses hex de retraite bloquerait la partie. L'occasion n'est pas
 *  perdue pour autant — elle est simplement présentée une fois la retraite
 *  terminée, puisque `demolition.opportunities` la déduit de la carte et ne
 *  l'oublie pas en chemin. */
const demolitionOpen = computed(() => !actionsLocked.value && !retreatActive.value && demolition.active.value)

/** Le pont dont la modale parle : celui dont on montre le résultat, sinon
 *  celui qu'on a reçu à trancher, sinon celui qu'on a soumis et qu'on attend,
 *  sinon — décision locale — la première occasion ouverte (cf.
 *  lib/useBridges.js::current). `null` = pas de modale. */
const demolitionBridge = computed(() => {
  if (demolitionShown.value) return demolitionShown.value
  if (demolitionIncoming.value) return demolitionIncoming.value
  if (demolitionAsked.value) return demolitionAsked.value
  if (!demolitionOpen.value) return null
  // En ligne, seul le camp décideur QUI A LA MAIN ouvre de lui-même : sans la
  // main, il attend que le joueur actif lui soumette l'occasion (c'est lui
  // qui mène le fil des évènements).
  if (props.online && !(isLocalTurn.value && demolitionMine.value)) return null
  return demolition.current.value
})

/** Cet écran ATTEND la décision de l'autre : rien à y cliquer. */
const demolitionWaiting = computed(() => !!demolitionAsked.value && !demolitionShown.value)

/** Soumet au camp décideur la première occasion ouverte, quand c'est ce
 *  navigateur qui a la main sans être celui qui décide. Idempotent, et appelé
 *  à chaque fois que l'un de ses ingrédients change : une occasion qui
 *  s'ouvre pendant qu'une autre se règle n'est ainsi jamais oubliée. */
function pumpDemolition() {
  if (!props.online || !demolitionOpen.value) return
  if (demolitionAsked.value || demolitionIncoming.value || demolitionShown.value) return
  if (!isLocalTurn.value || demolitionMine.value) return
  const bridge = demolition.current.value
  if (!bridge) return
  demolitionRequestId = newUid()
  demolitionAsked.value = bridge
  emit('bridge-request', { id: demolitionRequestId, edge: bridge.key, kind: 'demolition' })
}
/** Met `pumpDemolition` en veille sur ses ingrédients. Créé AU MONTAGE et non
 *  ici : `watch` évalue ses sources dès sa création, et `demolitionOpen` lit
 *  `actionsLocked`, déclaré bien plus bas dans ce fichier — l'évaluer
 *  maintenant lèverait une ReferenceError. Au montage, tout est en place. */
function startDemolitionWatch() {
  watch([demolitionOpen, () => demolition.current.value, demolitionAsked, demolitionIncoming, demolitionShown],
    pumpDemolition)
  watch([repairOpen, () => demolition.currentRepair.value, repairAsked, repairIncoming, repairShown],
    pumpRepair)
  // Condition « tout le tour hors ZOC » de la réparation (cf.
  // lib/useBridges.js::watchUndisturbed) : elle se juge en continu, puisque
  // ce sont les ennemis qui vont et viennent autour du génie. Sources
  // explicites (et non un `watchEffect`) : le suivi ÉCRIT dans les refs
  // qu'il lit, et un effet auto-suivi se relancerait sur sa propre écriture.
  watch([counters, () => turnInfo.value.activeSideKey, () => turnTrackerRef.value?.currentStep],
    () => demolition.watchUndisturbed(), { deep: true })
}

/** Le joueur actif nous soumet une occasion (cf. RoomLobby.vue,
 *  `game:bridge-request`) : elle s'affiche sur l'écran du camp décideur, et
 *  sur celui-là seul. Les deux décisions passent par le même canal, d'où
 *  l'aiguillage sur `kind`. */
function applyRemoteBridgeRequest(request) {
  if (request?.kind === 'repair') applyRemoteRepairRequest(request)
  else applyRemoteDemolitionRequest(request)
}

/** Le camp décideur a publié le sort d'un pont (cf. RoomLobby.vue,
 *  `game:bridge`) — démolition ou réparation. */
function applyRemoteBridge(result) {
  if (result?.kind === 'repair') applyRemoteRepair(result)
  else applyRemoteDemolition(result)
}

/** Démolition : le joueur actif nous soumet une occasion. */
function applyRemoteDemolitionRequest(request) {
  if (!props.online || !request?.edge || !demolitionMine.value) return
  const bridge = demolition.bridgeAt(request.edge)
  if (!bridge) return
  demolitionRequestId = request.id
  demolitionIncoming.value = bridge
}

/** Démolition : le camp décideur a publié le sort du pont ; on l'applique, et
 *  le navigateur qui attendait voit le résultat avant de reprendre la main. */
function applyRemoteDemolition({ edge, die = null, destroyed } = {}) {
  if (!edge) return
  const bridge = demolition.bridgeAt(edge)
  demolition.applyReplay({ edge, destroyed })
  if (demolitionAsked.value && bridge && demolitionAsked.value.key === bridge.key) demolitionAsked.value = null
  demolitionRequestId = null
  if (bridge) showDemolitionResult(bridge, { die, destroyed })
}

/** MARQUES DES PONTS dont le sort est réglé (cf. lib/useBridges.js::marks)
 *  — un rond posé au MILIEU de l'hexside, c'est-à-dire à mi-chemin entre les
 *  centres des deux hex qu'il relie : ROUGE si le pont est détruit, VERT s'il
 *  tient pour le reste de la partie. Les ponts encore en sursis n'en portent
 *  aucune (cf. lib/useBridges.js, en-tête). */
const demolitionMarks = computed(() => demolition.marks.value.map((mark) => {
  const from = hexCenterPx(mark.from.col, mark.from.row)
  const to = hexCenterPx(mark.to.col, mark.to.row)
  return { key: mark.key, destroyed: mark.destroyed, x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
}))

/** Journalise une décision — entrée `demolition`, relue au rejeu (cf.
 *  applyReplayEntry) et par l'autre joueur en ligne. `die` vaut `null` quand
 *  le camp décideur a renoncé sans lancer le dé. */
function logDemolition(bridge, { die = null, destroyed }) {
  const params = { bridge: mt(bridge.label), where: bridge.hexes.join('-'), die }
  const what = destroyed
    ? t('log.bridgeDestroyed', params)
    : die != null
      ? t('log.bridgeFailed', params)
      : t('log.bridgeSpared', params)
  log('demolition', what, { edge: bridge.key, die, destroyed })
}

/** Affiche le résultat d'une décision le temps qu'on le lise — sur l'écran
 *  qui a décidé comme sur celui qui attendait (cf. `applyRemoteDemolition`).
 *  Fige le pont concerné : sans cela, le sort réglé, `demolition.current`
 *  passerait aussitôt à l'occasion suivante et le joueur ne verrait jamais sa
 *  propre face de dé. */
function showDemolitionResult(bridge, outcome) {
  clearTimeout(demolitionTimer)
  demolitionShown.value = bridge
  demolitionResult.value = outcome
  demolitionTimer = setTimeout(closeDemolitionResult, DEMOLITION_RESULT_MS)
}

/** Une décision vient d'être prise sur CET écran : journal, puis diffusion
 *  aux autres joueurs (cf. RoomLobby.vue) — c'est le seul message qui change
 *  l'état d'un pont, et il part du navigateur qui a décidé. */
function publishDemolition(bridge, outcome) {
  logDemolition(bridge, outcome)
  demolitionIncoming.value = null
  demolitionRequestId = null
  if (props.online) emit('bridge', { edge: bridge.key, kind: 'demolition', die: outcome.die ?? null, destroyed: outcome.destroyed })
}

/** Le camp décideur tente la destruction : le dé est lancé par la règle (cf.
 *  lib/useBridges.js::attempt), le résultat reste affiché un instant, puis
 *  la modale passe à l'occasion suivante s'il y en a une. */
function onDemolitionAttempt() {
  const bridge = demolitionBridge.value
  if (!bridge || demolitionResult.value || demolitionWaiting.value) return
  const outcome = demolition.attempt(bridge.key)
  if (!outcome) return
  showDemolitionResult(bridge, outcome)
  publishDemolition(bridge, outcome)
}

/** Le camp décideur renonce : aucun dé, le pont tient pour le reste de la
 *  partie. Rien à figer — la modale enchaîne d'elle-même sur le pont suivant. */
function onDemolitionDecline() {
  const bridge = demolitionBridge.value
  if (!bridge || demolitionResult.value || demolitionWaiting.value) return
  if (!demolition.decline(bridge.key)) return
  publishDemolition(bridge, { die: null, destroyed: false })
}

/** Fin de l'affichage du résultat : la modale reprend le cours des occasions. */
function closeDemolitionResult() {
  clearTimeout(demolitionTimer)
  demolitionTimer = null
  demolitionShown.value = null
  demolitionResult.value = null
}

// --- Réparation des ponts (cf. lib/useBridges.js) ----------------------------
// Pendant la phase de FIN DE TOUR — la seule que le module place après le
// dernier camp de l'ordre, donc au bout du tour surveillé —, un génie resté
// tranquille peut relever un pont démoli qu'il borde. La décision revient au
// camp qui possède ce génie, et non à celui qui a la main.

// Phase "Fin de tour" (cf. lib/useAssisted.js : 0 Mouvement, 1 Combat, 2 Fin
// de tour — elle n'existe que pour le dernier camp de l'ordre).
const PHASE_END_OF_TURN = 2

// Mêmes rôles que pour la démolition (cf. la section précédente) : ce qu'on
// affiche après coup, ce qu'on a soumis, ce qu'on a reçu.
const repairShown = ref(null)
const repairResult = ref(null)
const repairAsked = ref(null)
const repairIncoming = ref(null)
let repairRequestId = null
let repairTimer = null

/** Ce navigateur est-il celui du camp qui répare ? En partie locale, oui. */
const repairMine = computed(() => !props.online || props.localSide === (rules.bridgeRepair?.by ?? null))

/** Une occasion de réparation peut-elle être présentée MAINTENANT ? Mêmes
 *  gardes que pour la démolition (ni rejeu, ni retraite en cours), plus la
 *  phase et le camp voulus : la Fin du tour que le génie devait passer au
 *  calme. Une démolition en cours passe devant — elle bloque déjà l'écran. */
const repairOpen = computed(() => !actionsLocked.value && !retreatActive.value
  && demolition.repairActive.value && !demolitionBridge.value
  && phase.value === PHASE_END_OF_TURN
  && (!rules.bridgeRepair?.undisturbedSide || turnInfo.value.activeSideKey === rules.bridgeRepair.undisturbedSide))

/** Le pont que la modale de réparation propose, `null` s'il n'y en a pas.
 *  Même découpage que pour la démolition : ce qu'on vient de décider (figé le
 *  temps de l'afficher), ce qu'on a reçu à trancher, ce qu'on a soumis, ou la
 *  première occasion ouverte quand la décision se prend ici. */
const repairTarget = computed(() => {
  if (repairShown.value) return repairShown.value
  if (repairIncoming.value) return repairIncoming.value
  if (repairAsked.value) return repairAsked.value
  if (!repairOpen.value) return null
  if (props.online && !(isLocalTurn.value && repairMine.value)) return null
  return demolition.currentRepair.value
})

/** Cet écran ATTEND la décision de l'autre : rien à y cliquer. */
const repairWaiting = computed(() => !!repairAsked.value && !repairShown.value)

/** Journalise une réparation — entrée `repair`, relue au rejeu (cf.
 *  applyReplayEntry) et par l'autre joueur en ligne. */
function logRepair(bridge) {
  log('repair', t('log.bridgeRepaired', { bridge: mt(bridge.label), where: bridge.hexes.join('-'), unit: bridge.unit?.name ?? t('log.engineers') }),
    { edge: bridge.key, unitId: bridge.unit?.id ?? null })
}

/** Affiche le résultat d'une réparation le temps qu'on le lise — sur l'écran
 *  qui a décidé comme sur celui qui attendait. */
function showRepairResult(bridge) {
  clearTimeout(repairTimer)
  repairShown.value = bridge
  repairResult.value = { die: null, destroyed: false }
  repairTimer = setTimeout(closeRepairResult, DEMOLITION_RESULT_MS)
}

function closeRepairResult() {
  clearTimeout(repairTimer)
  repairTimer = null
  repairShown.value = null
  repairResult.value = null
}

/** Le camp réparateur confirme : le pont redevient franchissable, et hors
 *  d'atteinte d'une nouvelle démolition. */
function onRepairAttempt() {
  const bridge = repairTarget.value
  if (!bridge || repairResult.value || repairWaiting.value) return
  if (!demolition.repairBridge(bridge.key, bridge.unit?.id)) return
  showRepairResult(bridge)
  logRepair(bridge)
  repairIncoming.value = null
  repairRequestId = null
  if (props.online) emit('bridge', { edge: bridge.key, kind: 'repair', unitId: bridge.unit?.id ?? null })
}

/** Le camp réparateur renonce POUR CE TOUR : son génie ne relève rien, mais
 *  le pont reste démoli — donc réparable à un tour suivant. Rien n'est
 *  journalisé : aucun état de la partie n'en garde trace au-delà du tour. */
function onRepairDecline() {
  const bridge = repairTarget.value
  if (!bridge || repairResult.value || repairWaiting.value) return
  demolition.declineRepair(bridge.unit?.id)
  repairIncoming.value = null
  repairRequestId = null
  if (props.online) emit('bridge', { edge: bridge.key, kind: 'repair', declined: true, unitId: bridge.unit?.id ?? null })
}

/** Soumet l'occasion au camp réparateur, quand c'est ce navigateur qui a la
 *  main sans être le sien (cf. `pumpDemolition`, même mécanique). */
function pumpRepair() {
  if (!props.online || !repairOpen.value) return
  if (repairAsked.value || repairIncoming.value || repairShown.value) return
  if (!isLocalTurn.value || repairMine.value) return
  const bridge = demolition.currentRepair.value
  if (!bridge) return
  repairRequestId = newUid()
  repairAsked.value = bridge
  emit('bridge-request', { id: repairRequestId, edge: bridge.key, kind: 'repair', unitId: bridge.unit?.id ?? null })
}

/** Le joueur actif nous soumet une occasion de réparation. */
function applyRemoteRepairRequest(request) {
  if (!props.online || !request?.edge || !repairMine.value) return
  const bridge = demolition.bridgeAt(request.edge)
  if (!bridge) return
  // L'unité vient de la demande : sur cet écran, c'est bien le génie du camp
  // réparateur, mais c'est l'autre client qui a lu l'occasion.
  const unit = counters.value.find((counter) => String(counter.id) === String(request.unitId))
  repairRequestId = request.id
  repairIncoming.value = { ...bridge, unit: unit ? { id: unit.id, name: unit.name } : null }
}

/** Le camp réparateur a publié sa décision. */
function applyRemoteRepair({ edge, unitId = null, declined = false } = {}) {
  if (!edge) return
  const bridge = demolition.bridgeAt(edge)
  if (declined) {
    demolition.declineRepair(unitId)
  } else {
    demolition.repairBridge(edge, unitId)
    if (bridge) showRepairResult({ ...bridge, unit: { id: unitId, name: '' } })
  }
  if (repairAsked.value && bridge && repairAsked.value.key === bridge.key) repairAsked.value = null
  repairRequestId = null
}

// --- FPF du défenseur (cf. lib/useCombat.js, section FPF) : ce que la modale
// de combat en montre (cf. CombatModal.vue, prop `fpf` — `mode` y est
// détaillé), `null` quand il n'y a rien à en dire.
const fpfView = computed(() => {
  const units = fpfUnits.value
  const view = {
    candidates: fpfCandidates.value,
    selectedIds: units.map((unit) => String(unit.id)),
    units,
    strength: fpfStrength.value,
  }
  if (combatResult.value) return units.length ? { ...view, mode: 'done' } : null
  // Négociation en ligne en cours (cf. section "FPF en ligne").
  if (fpfStatus.value === 'defending') return { ...view, mode: 'defender' }
  if (fpfStatus.value === 'waiting') return { ...view, mode: 'waiting' }
  if (fpfStatus.value === 'answered') return { ...view, mode: 'answered' }
  // Rien à demander au défenseur : ni artillerie éligible, ni pion de
  // soutien qu'il pourrait engager (cf. `defenderMaySupport`).
  if (fpfCandidates.value.length === 0 && !defenderMaySupport.value) return null
  // En ligne, le défenseur choisit sur son propre écran : l'attaquant doit
  // d'abord lui soumettre le combat.
  return { ...view, mode: props.online ? 'request' : 'local' }
})

// --- Plafond d'artilleries du module (cf. lib/useCombat.js, section "COMBIEN
// D'ARTILLERIES DANS UN COMBAT ?", et lib/useArnhem.js::maxArtilleryPerCombat)
// : ce que la modale en montre (cf. CombatModal.vue, prop `artilleryCap`),
// `null` pour un module qui n'en déclare pas — la modale n'en dit alors rien.
const artilleryCapView = computed(() => (artilleryLimit.value == null ? null : {
  max: artilleryLimit.value,
  attackFull: attackArtilleryFull.value,
  fpfFull: fpfLimitReached.value,
}))

// --- Pions de soutien engagés dans le combat en cours : ce que la modale en
// montre (cf. CombatModal.vue, prop `support`), `null` s'il n'y en a aucun.
// Côté ATTAQUE, ils s'affichent avec les attaquants (un pion de soutien vaut
// une unité de plus) ; côté DÉFENSE, avec les FPF (même rôle : un renfort de
// défense qui ne subit pas le résultat) — cf. lib/useCombat.js.
// En ligne, le défenseur choisit en plus ses pions dans la modale (cf.
// `defenderSupportTokens`), n'ayant pas la main pour les poser sur la carte.
const supportView = computed(() => {
  const choices = defenderSupportTokens.value
  if (!supportCounters.value.length && !choices.length) return null
  return {
    attacking: supportAttacking.value,
    counters: supportCounters.value,
    strength: supportStrength.value,
    factor: supportFactor,
    // [8.45] Soutien de défense privé d'effet : l'attaque ne comporte que de
    // l'artillerie et/ou du soutien (cf. lib/useCombat.js::supportBarred).
    barred: supportBarred.value,
    // Pions que le défenseur peut encore engager depuis son écran, et ceux
    // qu'il a cochés — vides hors de cet écran-là.
    choices,
    selectedIds: [...supportChoiceIds.value],
  }
})

/** Pions de soutien que le DÉFENSEUR peut engager depuis la modale : sa
 *  tablette du tour, sur SON écran, en ligne, pendant qu'il répond à un
 *  combat adverse (cf. lib/useCombat.js, section "FPF en ligne"). Vide
 *  partout ailleurs — en partie locale, il les pose au clic sur la carte. */
const defenderSupportTokens = computed(() => {
  if (!props.online || !props.module.supportTrack?.side || supportAttacking.value) return []
  if (fpfStatus.value !== 'defending' || supportBarred.value) return []
  if (!defenderSupportHexOk.value) return []
  return supportTrackerRef.value?.trayTokens() ?? []
})

/** L'hex où les pions de soutien du DÉFENSEUR seraient posés accepte-t-il le
 *  soutien ? En ligne, le défenseur n'a pas la main : il coche ses pions dans
 *  la modale et c'est le client de l'attaquant qui les pose, toujours sur le
 *  PREMIER hex cible (cf. `placeDefenderSupports`) — c'est donc cet hex-là
 *  qu'il faut soumettre à la règle de placement (cf.
 *  lib/useCombat.js::canPlaceSupportHex, et la restriction de portée du
 *  module, cf. lib/useArnhem.js::supportHexAllowed). Calculé à l'identique
 *  sur les deux écrans : celui du défenseur (pour lui proposer ses pions) et
 *  celui de l'attaquant (pour savoir s'il doit lui soumettre le combat). */
const defenderSupportHexOk = computed(() => {
  const target = combatTargetHexes.value[0]
  return !!target && canPlaceSupportHex({ c: target.col, r: target.row })
})

/** Le défenseur POURRAIT-il engager des pions de soutien contre ce combat ?
 *  Sur l'écran de l'ATTAQUANT en ligne : il doit alors lui soumettre le
 *  combat, même sans artillerie éligible au FPF (cf. `fpfView`). */
const defenderMaySupport = computed(() =>
  props.online && !!props.module.supportTrack?.side && combatActive.value && !supportAttacking.value
  && !supportBarred.value && defenderSupportHexOk.value && (supportTrackerRef.value?.trayTokens().length ?? 0) > 0)

/** Les artilleries éligibles au FPF se choisissent-elles sur CET écran ? */
const fpfChoosable = computed(() => fpfView.value?.mode === 'local' || fpfView.value?.mode === 'defender')

/** Surlignage (bleu pointillé) des artilleries éligibles, quand le FPF se
 *  choisit sur cet écran. */
const isFpfCandidateHex = (hex) => fpfChoosable.value
  && fpfCandidates.value.some((unit) => unit.col === hex.c && unit.row === hex.r)

/** Modale : le défenseur coche/décoche l'artillerie `id` pour son FPF. */
function onToggleFpf(id) {
  toggleFpf(counters.value.find((counter) => String(counter.id) === String(id)))
}

// --- FPF en ligne ------------------------------------------------------------
// Le défenseur joue sur un autre navigateur et n'a pas la main (cf.
// `inputLocked`) : l'attaquant lui SOUMET son combat (`onRequestFpf`), son
// écran l'affiche (`applyRemoteFpfRequest`), il choisit et valide
// (`onSendFpf`), l'attaquant reçoit ce choix (`applyRemoteFpfReply`) et lance
// le dé. Les messages passent par RoomLobby.vue et le serveur (cf.
// server/src/rooms.js, section FPF), qui garde la négociation en cours pour
// un joueur qui recharge sa page (cf. `restoreFpfRequest`). La règle —
// quelles artilleries sont éligibles, composition figée pendant l'attente —
// vit dans lib/useCombat.js (`requestFpf`, `answerFpf`, `openDefense`).

// Attaquant : id de la demande en cours. Défenseur : id de la demande affichée.
let fpfRequestId = null
let defendingRequestId = null

/** Camp (clé de `module.sides`) de l'unité `counter` — sa faction à défaut
 *  de `sides` (même repli que RoomLobby.vue). */
function sideOfCounter(counter) {
  const sides = props.module.sides
  if (!counter) return null
  if (!sides) return counter.faction ?? null
  return Object.keys(sides).find((side) => sides[side]?.includes(counter.faction)) ?? null
}

/** Attaquant : soumet le combat composé au défenseur. */
function onRequestFpf() {
  const payload = requestFpf()
  if (!payload) return
  fpfRequestId = newUid()
  emit('fpf-request', { id: fpfRequestId, ...payload })
}

/** Attaquant : renonce à la demande (réponse pas encore reçue). */
function onCancelFpfRequest() {
  if (cancelFpfRequest()) emit('fpf-cancel', fpfRequestId)
}

/** Croix de la modale : ferme le combat — en renonçant d'abord à une demande
 *  de FPF en attente (la croix est grisée une fois la réponse reçue). */
function onCombatClose() {
  if (fpfStatus.value === 'waiting') emit('fpf-cancel', fpfRequestId)
  cancelCombat()
}

/** Défenseur : valide son choix de FPF et de pions de soutien
 *  (éventuellement aucun des deux). */
function onSendFpf() {
  if (defendingRequestId == null) return
  emit('fpf-reply', { requestId: defendingRequestId, fpfIds: chosenFpfIds(), supportIds: chosenSupportIds() })
  defendingRequestId = null
  cancelCombat()
}

/** Combat soumis par l'attaquant (cf. RoomLobby.vue, `game:fpf-request`) :
 *  affiché sur l'écran du DÉFENSEUR seulement — le camp des unités attaquées. */
function applyRemoteFpfRequest(request) {
  if (!props.online || !request) return
  if (!openDefense(request)) return
  if (!combatDefenders.value.some((defender) => sideOfCounter(defender) === props.localSide)) {
    cancelCombat()
    return
  }
  defendingRequestId = request.id
}

/** Réponse du défenseur (cf. RoomLobby.vue, `game:fpf-reply`) : ses
 *  artilleries de FPF, et les pions de soutien qu'il engage — que SON écran
 *  ne peut pas poser sur la carte (il n'a pas la main), c'est donc celui-ci
 *  qui les pose, sur le premier hex attaqué. L'entrée de journal qui en
 *  résulte lui revient ensuite par le journal partagé, comme toute autre. */
function applyRemoteFpfReply(id, fpfIds, supportIds) {
  if (id !== fpfRequestId) return
  answerFpf(fpfIds)
  placeDefenderSupports(supportIds)
}

/** Pose les pions de soutien `ids` choisis par le défenseur sur le premier
 *  hex cible du combat en cours. */
function placeDefenderSupports(ids) {
  const target = combatTargetHexes.value[0]
  if (!target || !ids?.length) return
  for (const id of ids) {
    const token = supportTrackerRef.value?.findToken(id)
    if (!token) continue
    const placed = { ...token, col: target.col, row: target.row }
    counters.value.push(placed)
    emit('move', { counterId: placed.id, col: placed.col, row: placed.row })
    log('support', t('log.supportDefense', { unit: placed.name, hex: hexId(placed.col + 1, placed.row) }),
      { counterId: placed.id, col: placed.col, row: placed.row, counter: placed })
  }
}

/** Demande abandonnée par l'attaquant (cf. RoomLobby.vue, `game:fpf-cancel`). */
function applyRemoteFpfCancel(id) {
  if (fpfStatus.value !== 'defending' || id !== defendingRequestId) return
  defendingRequestId = null
  cancelCombat()
}

/** Page (re)chargée en pleine négociation (cf. `applyServerState`) :
 *  l'attaquant retrouve son combat soumis — en attente ou répondu —, le
 *  défenseur retrouve le combat auquel il n'a pas encore répondu. */
function restoreFpfRequest(request) {
  if (!props.online || !request?.attackerIds?.length || combatActive.value) return
  const firstAttacker = counters.value.find((counter) => String(counter.id) === String(request.attackerIds[0]))
  if (sideOfCounter(firstAttacker) === props.localSide) {
    if (openDefense(request, request.fpfIds ? 'answered' : 'waiting', request.fpfIds ?? [])) fpfRequestId = request.id
  } else if (!request.fpfIds) {
    applyRemoteFpfRequest(request)
  }
}

/** Total de MP déjà dépensés par `c` pendant ce tour-ci (cf.
 *  lib/useAssisted.js::remainingMp), ou `null` pour un pion sans potentiel
 *  de mouvement (ou hors mode Assisté). Enregistré dans le journal (champ
 *  `mp` des entrées `move`/`place`) pour qu'une partie sauvegardée en pleine
 *  phase de Mouvement retrouve ses MP au rejeu (cf. applyReplayEntry). */
function spentMpOf(counter) {
  const left = remainingMp(counter)
  return left == null ? null : movementAllowance(counter) - left
}

/** Suffixe "(MP 3/6)" ajouté au texte d'un déplacement dans le journal —
 *  vide pour un pion sans potentiel de mouvement. */
function mpText(counter) {
  const spent = spentMpOf(counter)
  return spent == null ? '' : ` (MP ${spent}/${movementAllowance(counter)})`
}

// Nom d'une phase dans la langue courante (cf. src/i18n, `phases`, ou les
// phases propres au module — useAssisted.js::phaseNameOf).
const phaseName = (step) => phaseNameOf(step)

// --- Signaler un bug (cf. BugReportModal.vue, lib/bugReport.js) : état du
// jeu capturé au clic sur le bouton — `{ snapshot, game, context }` — ou `null`
// (modale fermée). Toujours accessible, même pendant un rejeu ou le tour
// adverse : un bug peut se signaler à tout moment.
const bugReport = ref(null)

/** Export joint au rapport : de quoi comprendre, et si possible rejouer, la
 *  situation — pas, phase, position de chaque pion ("id@CCRR"), unités
 *  éliminées ou ayant combattu, et les `REPORT_ENTRIES` derniers coups du
 *  journal avec leurs données (cf. applyReplayEntry). */
function bugReportSnapshot() {
  const entries = journalRef.value?.toChronological() ?? []
  return {
    app: APP_VERSION,
    module: props.moduleId || props.module.name,
    settings: props.settings,
    online: props.online,
    localSide: props.localSide || null,
    step: turnInfo.value.step,
    turn: turnInfo.value.turn,
    side: turnInfo.value.activeSideKey,
    phase: phase.value,
    positions: counters.value.map((counter) => `${counter.id}@${hexId(counter.col + 1, counter.row)}`),
    eliminated: [...eliminatedIds.value],
    fought: counters.value.filter(hasFought).map((counter) => counter.id),
    entries: entries.slice(-REPORT_ENTRIES),
  }
}

/** Bouton "Signaler un bug" : capture l'état du jeu et ouvre la modale. */
function openBugReport() {
  const settings = Object.entries(props.settings ?? {})
    .filter(([, value]) => value !== '' && value != null)
    .map(([key, value]) => `${key} ${value}`).join(' · ')
  const currentPhaseName = phase.value == null ? '—' : phase.value === PHASE_AIRBORNE ? 'Airborne' : phaseName(phase.value)
  const side = turnInfo.value.activeSideKey
  bugReport.value = {
    snapshot: bugReportSnapshot(),
    game: journalRef.value?.gameFile() ?? null,
    context: [
      ['Module', `${props.module.name} (${props.moduleId || '?'})`],
      ['Réglages', settings || 'inconnus'],
      ['Situation', `tour ${turnInfo.value.turn}${side ? ` — ${sideLabel(side)}` : ''}, phase ${currentPhaseName}`],
      ['Partie', props.online ? `en ligne${props.localSide ? `, camp ${sideLabel(props.localSide)}` : ''}` : 'locale'],
      ['Page', `${location.pathname}${location.search}`],
    ],
  }
}
// --- Guide de l'interface (cf. InterfaceGuide.vue) : ouvert d'office la
// première fois qu'on arrive sur une partie sur ce navigateur, puis par le
// bouton "?" de la barre d'outils. Marqué comme vu dès sa fermeture.
const showGuide = ref(!guideSeen())

function closeGuide() {
  showGuide.value = false
  markGuideSeen()
}
// Avertissement "changement de phase refusé" (cf. PhaseBlockedModal.vue) —
// ouvert par onPhaseNext ci-dessous, qui refuse trois choses : quitter la
// phase Airborne en laissant une vague à terre, la phase Mouvement avec des
// unités empilées, la phase Combat avec un combat obligatoire en attente.
const showPhaseBlocked = ref(false)

/** Clic sur le bouton "suivant" de la ligne des phases (cf. TurnTracker.vue,
 *  évènement `phase-next`). Le changement de phase est refusé, et la modale
 *  d'avertissement ouverte, dans deux cas :
 *   - en phase Mouvement, s'il reste 2 unités amies ou plus sur un même hex
 *     (cf. lib/useAssisted.js::stackedHexes) ;
 *   - en phase Combat (vers Fin de tour ou Autre joueur), s'il reste des
 *     combats obligatoires en attente (cf. lib/useCombat.js::pendingEngagements).
 *  Sinon, la décision de ce que fait réellement le clic reste à
 *  lib/useAssisted.js::advance. */
/** Ce que la modale de refus montre, selon ce qui bloque (cf. `onPhaseNext`
 *  et PhaseBlockedModal.vue, qui affiche une liste d'hex et d'unités). */
const phaseBlockedView = computed(() => {
  if (airborneToDrop.value.length) {
    return {
      title: t('airborne.incompleteTitle'),
      stacks: airborneToDropByZone.value,
      stackMessage: t('airborne.incompleteMessage'),
    }
  }
  return { engagements: pendingEngagements.value, stacks: stackedHexes.value }
})

function onPhaseNext() {
  // Rejeu, partie terminée ou, en ligne, pas le tour de ce joueur (le
  // bouton est déjà désactivé dans ces cas, cf. `phaseControlsLocked` — et
  // NON `inputLocked`, qu'un temps de Mouvement écoulé ferme alors que c'est
  // précisément ce bouton-là qu'il faut pouvoir cliquer).
  if (phaseControlsLocked.value) return
  // Retraite en cours (cf. lib/useRetreat.js) : elle doit être terminée
  // avant de pouvoir changer de phase. De même, en ligne, un combat dont le
  // défenseur a déjà choisi son FPF est engagé : il doit être joué.
  if (retreatActive.value || fpfStatus.value === 'answered') return
  if (phase.value === PHASE_AIRBORNE && airborneToDrop.value.length > 0) {
    showPhaseBlocked.value = true
    return
  }
  if (phase.value === 0 && stackedHexes.value.length > 0) {
    showPhaseBlocked.value = true
    return
  }
  if (phase.value === 1 && pendingEngagements.value.length > 0) {
    showPhaseBlocked.value = true
    return
  }
  const before = phase.value
  const stepBefore = turnTrackerRef.value?.currentStep
  advance()
  // Piste à phases entremêlées (cf. lib/turnTrack.js) : "suivant" change de
  // PAS, et la nouvelle phase vient avec lui — déjà journalisée par
  // l'entrée `turn` (cf. onTurnChange).
  if (turnTrackerRef.value?.currentStep !== stepBefore) return
  // Journal : on enregistre le passage en Combat / Fin de tour, ET le
  // passage Airborne -> Mouvement (entrée `phase`, rejouée par
  // applyReplayEntry -> useAssisted.js::setPhase). Le retour en Mouvement
  // (ou Airborne) après un changement de camp n'a pas besoin d'entrée
  // propre : il accompagne toujours un changement de tour, déjà journalisé
  // (cf. onTurnChange), et la phase de départ y est recalculée d'office (cf.
  // useAssisted.js::startSidePhase, watcher de `currentStep`, synchrone —
  // d'où `phase` déjà à jour ici).
  const leftAirborne = before === PHASE_AIRBORNE && phase.value === 0
  if (phase.value != null && phase.value !== before && (phase.value > 0 || leftAirborne)) {
    // `blitzUsed` : pendules du timing "Blitz", déjà mises à jour par
    // `advance()` (fin de phase Mouvement, cf. syncMoveTimer, synchrone) —
    // rétablies au rejeu du journal et transmises aux autres joueurs.
    const blitzUsed = isBlitz.value ? { ...blitzUsedMs.value } : undefined
    log('phase', t('log.phase', { name: phaseName(phase.value) }), { phase: phase.value, step: turnInfo.value.step, blitzUsed })
    // Multijoueur : les autres joueurs suivent la phase (cf. applyRemotePhase).
    emit('phase', { phase: phase.value, step: turnInfo.value.step, blitzUsed })
  }
}

/** Multijoueur : un autre joueur a changé de phase (cf. RoomLobby.vue,
 *  évènement `game:phase`). Ignoré s'il vise un autre pas que le pas
 *  courant (message arrivé en retard). Pas de journalisation ici : l'entrée
 *  `phase` arrive par le journal partagé (cf. applyRemoteEntry). */
function applyRemotePhase(newPhase, step, blitzUsed) {
  if (step !== turnTrackerRef.value?.currentStep || newPhase === phase.value) return
  setPhase(newPhase)
  // Pendules "Blitz" : les valeurs du joueur actif font foi (elles
  // remplacent l'estimation que ce navigateur vient de faire lui-même).
  if (blitzUsed) blitzUsedMs.value = { ...blitzUsed }
}

const selectedCounterId = ref(null)

// Entrée en phase Combat : un pion resté sélectionné depuis la phase
// Mouvement est désélectionné — en phase Combat, une unité amie ne se
// sélectionne jamais (cf. onCounterSelect), elle ne peut qu'être désignée
// attaquante.
watch(phase, (newPhase) => {
  // Fin de la phase de Mouvement : plus aucun pion ne bouge.
  if (newPhase != null && newPhase > 0) selectedCounterId.value = null
  // Les déplacements de la phase qui s'achève sont acquis : plus rien à
  // annuler (cf. `moveHistory`).
  moveHistory.value = []
  // Tout changement de phase désélectionne un renfort choisi dans le
  // panneau : il n'est peut-être plus plaçable dans la nouvelle phase (cf.
  // lib/useAssisted.js::canPlaceReinforcementNow — un aéroporté choisi en
  // phase Airborne ne se pose plus en Mouvement).
  selectedReinforcementId.value = null
})

// Lancement de la partie : phase de départ du camp actif — Airborne s'il a
// des aéroportés à poser, sinon Mouvement (cf. lib/useAssisted.js::
// startSidePhase). Au montage, et pas plus tôt : TurnTracker.vue (camp
// actif, tour courant) doit déjà être monté.
onMounted(() => {
  initPhase()
  if (props.module.turnTrack) initialTurnEntry = turnEntryOf(turnInfo.value)
  if (props.online) startSharedJournal(props.initialJournal)
  // État de la partie côté serveur — pas, phase, pendules, fin de partie
  // (cf. applyServerState). En solo/démo, les props valent leurs défauts :
  // sans effet, hormis le démarrage des pendules.
  applyServerState({
    turnStep: props.initialTurnStep, phase: props.initialPhase, phaseElapsedMs: props.initialPhaseElapsedMs,
    blitzUsedMs: props.initialBlitzUsedMs, blitzLoser: props.initialBlitzLoser, gameOverReason: props.initialGameOverReason,
    fpfRequest: props.initialFpfRequest,
  })
  // Ponts déjà détruits, relevés ou définitivement épargnés (cf.
  // restoreBridges).
  restoreBridges(props.initialBridgeLog, props.initialBridgeRequest)
  // Une unité du camp déclencheur déjà en place au coup d'envoi borde peut-
  // être un pont : la première occasion s'examine donc dès maintenant, et les
  // suivantes par le watcher (cf. startDemolitionWatch, qui ne peut pas être
  // créé plus tôt).
  startDemolitionWatch()
  startVictoryWatch()
  demolition.watchUndisturbed()
  pumpDemolition()
  pumpRepair()
  // Partie relancée avec les réglages d'une sauvegarde (cf. DemoPlay.vue) :
  // on rejoue maintenant le journal mis de côté — APRÈS `initPhase`, que le
  // rejeu doit pouvoir corriger. Jamais en ligne (la reprise en attente
  // appartient à une partie locale).
  if (!props.online) journalRef.value?.resumePending()
})

/** En ligne : rejoue d'un coup le journal partagé `list` déjà enregistré par
 *  le serveur (rechargement de la page, reconnexion) pour reconstituer la
 *  partie — positions, éliminations, phase, MP, pendules... Le plateau est
 *  d'abord remis au déploiement (cf. onJournalLoaded), donc tout ce que ce
 *  navigateur aurait de plus que le serveur est abandonné. Partie qui
 *  démarre (journal vide) : propose son déploiement au serveur ; seul le
 *  PREMIER proposé est retenu et appliqué chez tous les joueurs (cf.
 *  RoomLobby.vue::onDeploy), pour que les unités tirées au hasard dans leur
 *  zone de départ soient au même endroit pour tout le monde. */
function startSharedJournal(list) {
  if (list.length) {
    journalRef.value?.loadShared(list)
    fastForwardReplay()
  } else {
    // Déploiement ET tour de départ (cf. `initialTurnEntry`), retenus ou
    // rejetés ensemble par le serveur (premier arrivé).
    const time = new Date().toLocaleTimeString('fr-FR')
    emit('deploy', {
      setup: { uid: newUid(), t: time, kind: 'setup', text: t('log.deployment'), data: deploymentData() },
      turn: initialTurnEntry ? { uid: newUid(), t: time, ...initialTurnEntry } : null,
    })
  }
}

// Pions retirés de la carte via "Éliminé" (menu contextuel, cf.
// onCounterContextMenu plus bas) — id -> true. Un pion éliminé n'est ni sur
// la carte (counters) ni dans les renforts tant qu'il n'est pas explicitement
// "replacé" depuis le panneau "Unités éliminées" (EliminatedPanel.vue).
const eliminatedIds = ref(new Set())
const eliminatedCounters = computed(() =>
  [...eliminatedIds.value].map(counterDefinition).filter(Boolean)
)

// --- Renforts : pions du module avec un hex d'entrée mais pas encore posés
// ni éliminés (typiquement arrivée tour 2+) — cf. ReinforcementsPanel.vue.
// Entrée en jeu SELON LE MODE (cf. lib/useAssisted.js::draggable) : en mode
// Libre, glissés sur la carte comme le déplacement d'un pion existant
// (onCounterDragStart / onMapDrop plus bas) ; en mode Assisté, uniquement
// par clic (onReinforcementSelect puis onHex, cf. plus bas — le glisser est
// désactivé pour laisser le clic comme seul chemin). Toujours possible, dans
// les deux modes, via le menu contextuel "Replacer le pion" (ils y
// retournent alors).
const placedIds = computed(() => new Set(counters.value.map((counter) => String(counter.id))))

// Unités SORTIES DE LA CARTE par un bord (cf. section "Sortie de carte" plus
// bas) : id (chaîne) -> `{ zone, turn }`, la bande par laquelle elle est
// sortie et le tour où elle l'a fait. Elles redeviennent des renforts, mais
// pas n'importe lesquels : elles ne rentrent que par CETTE bande et pas avant
// le tour SUIVANT. D'où la réécriture de leur `setup` et de leur `turn`
// ci-dessous — tout le mécanisme de renfort du moteur (panneau, hex d'entrée
// surlignés, coût d'entrée, congestion) s'applique ensuite sans rien savoir
// de cette règle.
const exitedUnits = ref(new Map())

// Unités ÉLIMINÉES qu'une règle du module fait revenir en renfort (cf.
// lib/useArnhem.js::rebuiltReinforcement — le génie d'Arnhem se reconstitue
// et se représente au tour suivant) : id -> `{ setup, turn }`, où et quand.
// Elles ne rejoignent PAS les "Unités éliminées" : elles sont attendues dans
// le panneau des renforts, ce que le journal dit d'ailleurs en toutes
// lettres au moment de leur perte.
const rebuiltUnits = ref(new Map())

/** Le renfort `counter` tel qu'il doit se présenter s'il a déjà quitté la
 *  carte : mêmes pion et facteurs, mais les hex d'entrée et le tour d'arrivée
 *  de son retour — ceux de sa bande de sortie (cf. `exitedUnits`), ou ceux
 *  que la règle du module lui donne après élimination (cf. `rebuiltUnits`).
 *  Inchangé pour tous les autres. */
function withMapExit(counter) {
  const rebuilt = rebuiltUnits.value.get(String(counter.id))
  if (rebuilt) return { ...counter, setup: rebuilt.setup, turn: rebuilt.turn }
  const exit = exitedUnits.value.get(String(counter.id))
  const zone = exit && mapExitZones.value.find((candidate) => candidate.id === exit.zone)
  if (!zone) return counter
  return { ...counter, setup: zone.hexes, turn: exit.turn + 1 }
}

/** Retire `id` de la carte et le range là où il doit l'être : dans les
 *  renforts si une règle du module le fait revenir (cf.
 *  `moduleRules.rebuiltReinforcement`), dans les "Unités éliminées" sinon.
 *  Commun au jeu (cf. `eliminateCounter`) et au rejeu du journal. */
function noteElimination(id) {
  const key = String(id)
  const counterIndex = counters.value.findIndex((counter) => String(counter.id) === key)
  const counter = counterIndex !== -1 ? counters.value[counterIndex] : null
  const rebuilt = moduleRules.rebuiltReinforcement(counter, turnInfo.value.turn)
  if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
  if (rebuilt) {
    rebuiltUnits.value = new Map(rebuiltUnits.value).set(key, rebuilt)
    return rebuilt
  }
  eliminatedIds.value = new Set(eliminatedIds.value).add(key)
  return null
}

const reinforcements = computed(() =>
  allCounters.value
    .filter((counter) => counter.setup && !placedIds.value.has(String(counter.id)) && !eliminatedIds.value.has(String(counter.id)))
    .map(withMapExit)
)

// Un onglet de renforts par camp déclaré dans module.sides (ex. {"german":
// ["german"], "allies": ["commonwealth","us","pol"]}) — chacun ne liste que
// les renforts des factions de son camp. Repli sur un onglet unique si le
// module n'a pas encore ce champ. Plus un onglet fixe "Unités éliminées",
// commun à tous les camps (regroupé par nationalité à l'intérieur).
// Libellé de l'onglet d'un camp : "Renfort " + le nom du camp tel que la
// piste de tour l'affiche (`turnTrack.sides[side].label`, ex. "Renfort
// alliés") — la clé brute du camp à défaut.
// Le module peut traduire l'intitulé complet (ex. "Renfort alliés" ->
// "Allied reinforcements", cf. son dictionnaire `i18n`) ; sinon, il est
// composé à partir du nom du camp traduit.
const sideTabLabel = (side) => {
  const frLabel = props.module.turnTrack?.sides?.[side]?.label
  const frTab = frLabel ? `Renfort ${frLabel.toLowerCase()}` : null
  const translated = mt(frTab)
  if (frTab && translated !== frTab) return translated
  const label = mt(frLabel) ?? side
  return t('tabs.sideReinforcements', { side: label.toLowerCase(), Side: label })
}
const sidePanelTabs = computed(() => {
  const sides = props.module.sides
  const base = !sides
    ? [{ key: 'reinforcements', label: t('tabs.reinforcements') }]
    : Object.keys(sides).map((side) => ({ key: side, label: sideTabLabel(side) }))
  return [...base, { key: 'eliminated', label: t('tabs.eliminated') }, { key: 'journal', label: t('tabs.journal') }]
})
function reinforcementsForTab(key) {
  const sides = props.module.sides
  if (!sides) return reinforcements.value
  const factions = sides[key] ?? []
  return reinforcements.value.filter((counter) => factions.includes(counter.faction))
}
const openTab = ref(null)
const draggedCounterId = ref(null)

// --- Points de victoire (cf. lib/useVictoryPoints.js) ------------------------
// En mode LIBRE, les joueurs tiennent le compte eux-mêmes et chaque
// modification part au journal. En mode ASSISTÉ, le moteur seul marque :
//   - à chaque unité éliminée, pour son adversaire ;
//   - à chaque Fin de tour, pour les positions tenues au-delà des fleuves par
//     une unité ravitaillée, et pour chaque unité alliée coupée de ses
//     arrières.
// Une modale annonce ce qui vient d'être marqué (cf. VictoryModal.vue).
//
// Tout passe par une entrée de journal `victory`, ce qui suffit à la partie
// en ligne : les entrées reçues des autres joueurs sont appliquées au plateau
// comme au rejeu (cf. applyRemoteEntry), sans canal réseau dédié.

/** Camps à afficher, dans l'ordre du module, avec le libellé de la piste de
 *  tour (« Alliés », « Allemands »). */
const victorySides = computed(() => (rules.victoryPoints?.sides ?? [])
  .map((side) => ({ key: side, label: sideLabel(side) })))

// Totaux et saisie, pour le template (cf. VictoryPoints.vue).
const victoryScores = computed(() => victory.scores.value)
const victoryEditable = computed(() => victory.editable.value)
// Points marqués tour par tour, pour la modale de fin de partie.
const victoryByTurn = computed(() => victory.byTurn.value)

// Attributions à annoncer (cf. VictoryModal.vue), vidées à l'acquittement.
const victoryNotice = ref([])
// Clé du titre de la modale (cf. src/i18n), traduite à l'affichage.
const victoryNoticeTitle = ref('victory.title')

/** Tour en cours (1 sans piste de tour) — lu sur TurnTracker.vue, à jour
 *  dès qu'un pas change, rejeu compris (contrairement à `turnInfo`, différé). */
const currentTurnNumber = () => turnTrackerRef.value?.currentTurn ?? 1

/** Inscrit `points` au camp `side` et le journalise, avec le tour en cours
 *  (récapitulatif par tour, cf. GameEndModal.vue). `reason` paraît dans le
 *  journal et dans la modale ; `endOfTurn` marque un compte de Fin de tour
 *  (cf. `scoreEndOfTurn`). Renvoie la ligne à annoncer, ou `null`. */
function awardVictory(side, points, reason, { endOfTurn = false } = {}) {
  const result = victory.award(side, points)
  if (!result) return null
  const turn = currentTurnNumber()
  victory.record(turn, side, result.delta)
  log('victory', t('log.victoryAward', { side: sideLabel(side), n: points, reason, total: result.total }, points),
    { side, points, total: result.total, reason, turn, ...(endOfTurn ? { endOfTurn: true } : {}) })
  return { side, label: sideLabel(side), points, total: result.total, reason }
}

/** Mode Libre : le joueur fixe un total à la main (cf. VictoryPoints.vue). */
function onVictoryChange({ side, value }) {
  if (!victory.editable.value || inputLocked.value) return
  const result = victory.set(side, value)
  if (!result) return
  const turn = currentTurnNumber()
  victory.record(turn, side, result.delta)
  const sign = result.delta > 0 ? `+${result.delta}` : String(result.delta)
  log('victory', t('log.victorySet', { side: sideLabel(side), n: sign, total: result.total }, Math.abs(result.delta)),
    { side, points: result.delta, total: result.total, reason: 'saisie', turn })
}

/** Mode Assisté : une unité vient d'être éliminée pour de bon (une unité qui
 *  se reconstitue n'a pas été perdue, cf. lib/useArnhem.js). */
function scoreElimination(counter) {
  if (!props.assisted || !victory.active.value || actionsLocked.value) return
  const award = victory.eliminationAward(sideOfCounter(counter))
  if (!award) return
  const line = awardVictory(award.side, award.points, t('log.unitEliminated', { unit: counter?.name ?? t('log.aUnit') }))
  if (line) { victoryNoticeTitle.value = 'victory.title'; victoryNotice.value = [line] }
}

/** Mode Assisté, Fin de tour : positions tenues au-delà des fleuves, et
 *  unités coupées de leurs arrières. Ces comptes-là s'AJOUTENT à chaque tour
 *  (choix validé) — tenir une position cinq tours rapporte cinq fois.
 *
 *  En ligne, seul le joueur qui a la main compte : l'entrée de journal qu'il
 *  produit porte les points chez l'autre. */
function scoreEndOfTurn() {
  if (!props.assisted || !victory.active.value || actionsLocked.value || isReplaying.value) return
  if (props.online && !isLocalTurn.value) return
  // UNE SEULE fois par tour (cf. lib/useVictoryPoints.js, `scoredTurns`) :
  // un journal rechargé en pleine Fin de tour a déjà rejoué les points de
  // ce tour — les recompter les ajouterait une seconde fois.
  const turn = currentTurnNumber()
  if (victory.isTurnScored(turn)) return
  victory.markTurnScored(turn)
  const lines = []
  const cut = supplyLine.unsuppliedIds(counters.value)

  // Positions au-delà des fleuves : à l'unité de tenir ET d'être ravitaillée.
  const held = new Map()
  for (const counter of counters.value) {
    if (!isFighter(counter) || !victory.holdsPosition(counter)) continue
    if (!supplyLine.concerns(counter) || cut.has(String(counter.id))) continue
    const zone = victory.zoneOf(counter)
    if (!zone) continue
    if (!held.has(zone.id)) held.set(zone.id, { zone, count: 0 })
    held.get(zone.id).count += 1
  }
  for (const { zone, count } of held.values()) {
    const line = awardVictory(zone.to, zone.points * count,
      t('log.unitsInZone', { n: count, zone: mt(zone.label) }, count), { endOfTurn: true })
    if (line) lines.push(line)
  }

  // Unités coupées de leurs arrières, comptées pour l'adversaire.
  const unsupplied = rules.victoryPoints?.unsupplied
  if (unsupplied?.points) {
    const count = counters.value.filter((counter) => supplyLine.concerns(counter) && cut.has(String(counter.id))).length
    if (count) {
      const line = awardVictory(unsupplied.to, unsupplied.points * count,
        t('log.unitsUnsupplied', { n: count }, count), { endOfTurn: true })
      if (line) lines.push(line)
    }
  }

  // Dernier tour : la modale de fin de partie (cf. `startVictoryWatch`)
  // récapitule déjà tout, pas besoin d'annoncer ces points à part.
  if (lines.length && !isFinalEndOfTurn.value) {
    victoryNoticeTitle.value = 'victory.endOfTurnTitle'
    victoryNotice.value = lines
  }
}

// Entrée dans la phase de Fin de tour : c'est là qu'on fait les comptes (cf.
// `scoreEndOfTurn`). Créé au montage, comme les autres veilles de ce fichier,
// pour ne pas lire trop tôt ce qui est déclaré plus bas.
function startVictoryWatch() {
  watch(phase, (now, before) => {
    if (now !== PHASE_END_OF_TURN || before === PHASE_END_OF_TURN) return
    scoreEndOfTurn()
    // Fin du DERNIER tour : la partie est finie, on annonce le vainqueur aux
    // points (cf. `gameEnd`) — chez tous les joueurs, mais pas pendant un
    // rejeu (le bouton "Bilan de la partie" permet de la rouvrir).
    if (isFinalEndOfTurn.value && !isReplaying.value && !replayLocked.value) showGameEnd.value = true
  })
}

// --- Ligne de communication affichée (mode debug) ----------------------------
// La règle (cf. lib/useSupplyLine.js) ne pénalise personne pour l'instant :
// elle se REGARDE. Pendant la phase de Fin de tour — celle du dernier camp de
// l'ordre, l'allemand à Arnhem, le moment où l'on fait ses comptes —, un clic
// sur une unité en mode debug trace la ligne qui la relie à ses arrières, de
// centre d'hex en centre d'hex, chaque pas coloré selon son ÉTAGE (hors
// piste, piste, route — cf. lib/useSupplyLine.js::traceFor). Une unité COUPÉE
// montre quand même sa meilleure ligne partielle, terminée par une croix
// rouge au point de rupture (au centre de l'hex refusé, ou sur l'hexside si
// c'est lui qui bloque), avec la raison en infobulle. Recliquer sur l'unité
// efface le tracé, comme un clic sur une autre unité le remplace.
const supplyLineUnitId = ref(null)

/** Peut-on demander une ligne en ce moment ? */
const supplyLineOpen = computed(() => debug.value && supplyLine.active.value
  && phase.value === PHASE_END_OF_TURN)

/** Tracé de la ligne actuellement montrée, prêt à dessiner (coordonnées
 *  pixel) : `{ segments: [{ x1, y1, x2, y2, stage }], start, cross }` —
 *  `cross` (`{ x, y, reason }`) seulement si la ligne est coupée. `null` si
 *  aucune ligne n'est demandée. */
const supplyTrace = computed(() => {
  if (!supplyLineOpen.value || supplyLineUnitId.value == null) return null
  const unit = counters.value.find((counter) => String(counter.id) === String(supplyLineUnitId.value))
  const trace = unit && supplyLine.traceFor(unit)
  if (!trace) return null
  const centers = trace.steps.map((step) => ({ ...hexCenterPx(step.col, step.row), stage: step.stage }))
  const segments = centers.slice(1).map((center, index) => ({
    x1: centers[index].x, y1: centers[index].y, x2: center.x, y2: center.y, stage: center.stage,
  }))
  let cross = null
  if (!trace.connected) {
    const last = centers.at(-1)
    const refused = hexCenterPx(trace.rupture.hex.col, trace.rupture.hex.row)
    const at = trace.rupture.onEdge ? { x: (last.x + refused.x) / 2, y: (last.y + refused.y) / 2 } : refused
    cross = { ...at, reason: trace.rupture.reason }
  }
  return { segments, start: centers[0], cross }
})

/** Demi-largeur de la croix de rupture : un quart de pas de ligne, assez
 *  pour se voir sans masquer l'hex voisin. */
const SUPPLY_CROSS = computed(() => calibration.rowStep / 4)

/** UNITÉS HORS COMMUNICATION, cerclées de rouge sur la carte pendant la phase
 *  de Fin de tour — le moment où l'on fait ses comptes. Contrairement au
 *  tracé vert d'une ligne (réservé au debug), cet avertissement-là vaut en
 *  mode Assisté tout court : savoir qui est coupé fait partie du jeu.
 *
 *  Le calcul n'a lieu que pendant cette phase : même en une seule passe (cf.
 *  lib/useSupplyLine.js::unsuppliedIds), parcourir la carte pour toute une
 *  armée ne se justifie pas à chaque pas de mouvement. */
const outOfSupplyIds = computed(() => {
  if (!props.assisted || !supplyLine.active.value || phase.value !== PHASE_END_OF_TURN) return new Set()
  return supplyLine.unsuppliedIds(counters.value)
})

/** Clic sur l'unité `counter` alors qu'une ligne peut être montrée : c'est
 *  elle qu'on trace (ou qu'on cesse de tracer). Renvoie `false` si le clic ne
 *  concerne pas la ligne, pour laisser `onCounterSelect` le traiter. */
function toggleSupplyLine(counter) {
  if (!supplyLineOpen.value || !supplyLine.concerns(counter)) return false
  const id = String(counter.id)
  supplyLineUnitId.value = String(supplyLineUnitId.value) === id ? null : id
  return true
}

// Changement de phase ou de camp : la ligne montrée n'a plus lieu d'être.
watch([phase, () => turnInfo.value.step], () => { supplyLineUnitId.value = null })

// --- Menu contextuel (clic droit) : "Replacer le pion" / "Éliminé" sur un
// pion posé sur la carte ; seulement "Replacer le pion" sur un pion déjà
// éliminé (panneau "Unités éliminées") ou sur un pion de soutien (retour dans
// la tablette, cf. returnSupportToTray) ; aucun menu depuis le panneau de
// renforts (pas encore sur la carte, rien à replacer ou éliminer).
const contextMenu = ref(null) // { x, y, items: [{label, action}] } | null

function openContextMenu(ev, items) {
  ev.preventDefault()
  hoveredCounter.value = null
  contextMenu.value = { x: ev.clientX, y: ev.clientY, items }
}
function closeContextMenu() {
  contextMenu.value = null
}
/** Retire un pion de la carte et le renvoie dans les renforts (sans l'éliminer). */
function returnCounterToReinforcements(id) {
  const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(id))
  if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
  eliminatedIds.value.delete(String(id))
  eliminatedIds.value = new Set(eliminatedIds.value)
  const counter = counterDefinition(id)
  // cf. lib/useAssisted.js::resetMp — un pion replacé aux renforts doit
  // repartir avec un plein potentiel de MP la prochaine fois qu'il entrera
  // en jeu, pas avec ce qu'il lui restait au moment où il a quitté la carte.
  // cf. lib/useAssisted.js::unspendEntryCost — et s'il avait fait grimper la
  // congestion du hex par lequel il était entré ce tour-ci, cette place est
  // maintenant libre : le prochain à entrer par ce même hex ne doit pas
  // payer pour une entrée qui n'a plus lieu.
  if (counter) {
    resetMp(counter)
    unspendEntryCost(counter)
  }
  log('return', t('log.returned', { unit: counter?.name ?? id }), { counterId: id })
}
/** "Replacer le pion" sur un pion de soutien : le retire de la carte, ce qui
 *  le remet dans la tablette s'il est du tour courant (cf.
 *  SupportTracker.vue, tablette déduite de la carte) — perdu sinon, comme un
 *  pion non posé à temps. Ses déplacements n'ont plus rien à annuler. */
function returnSupportToTray(id) {
  const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(id))
  if (counterIndex === -1) return
  const [counter] = counters.value.splice(counterIndex, 1)
  moveHistory.value = moveHistory.value.filter((move) => String(move.counterId) !== String(id))
  const back = supportTrackerRef.value?.isTurnToken(id)
  log('support-return', t(back ? 'log.supportBackToTray' : 'log.supportRemoved', { unit: counter.name }), { counterId: id })
}
/** Élimine un pion (menu contextuel, ou résultat de combat — cf.
 *  lib/useRetreat.js, qui précise alors pourquoi dans `reason`). */
function eliminateCounter(id, reason) {
  const lost = counters.value.find((counter) => String(counter.id) === String(id))
  const rebuilt = noteElimination(id)
  const counter = counterDefinition(id)
  const comeback = rebuilt ? t('log.rebuilt', { turn: rebuilt.turn }) : ''
  log('eliminate', t('log.eliminated', { unit: counter?.name ?? id }) + (reason ? ` (${reason})` : '') + comeback, { counterId: id })
  // Points de victoire (cf. la section du même nom) : une unité qui se
  // reconstitue et revient en renfort n'a pas été perdue, elle ne rapporte
  // rien à l'adversaire.
  if (!rebuilt) scoreElimination(lost ?? counter)
}
function onCounterContextMenu(id, ev) {
  // Pendant une retraite (cf. lib/useRetreat.js), retirer ou replacer un
  // pion à la main désynchroniserait la file des retraites : menu désactivé.
  if (inputLocked.value || retreatActive.value) return
  const items = [
    { label: t('menu.putBack'), action: () => returnCounterToReinforcements(id) },
    { label: t('menu.eliminate'), action: () => eliminateCounter(id) },
  ]
  // Reconnaissance du moteur (cf. `reportRecon`) : sur une unité de l'hex
  // qu'il a désigné, en tête du menu.
  const onMap = counters.value.find((counter) => String(counter.id) === String(id))
  if (onMap && isReconTargetHex({ c: onMap.col, r: onMap.row })) {
    items.unshift({ label: t('menu.reconReport'), action: () => reportRecon(id) })
  }
  // Phase Mouvement uniquement (ou partie Libre, sans phases : `phase` vaut
  // `null`) — même raison que "Retour arrière" (cf. `moveHistory`) : en phase
  // Combat, l'unité a pu combattre, retraiter ou avancer depuis.
  if (movedThisTurnIds.value.has(String(id)) && (phase.value === null || phase.value === 0)) {
    items.push({ label: t('menu.cancelMove'), action: () => cancelMovement(id) })
  }
  // Sortie de carte (cf. section du même nom) : proposée sur une bande de
  // bord, grisée quand la règle l'interdit ici et maintenant.
  const clicked = counters.value.find((counter) => String(counter.id) === String(id))
  // Pile d'unités (2 ou plus sur l'hex) : faire passer une autre unité
  // au-dessus, pour pouvoir la sélectionner (cf. `cycleStack`).
  if (clicked && stackUnitsAt(clicked).length > 1) {
    items.push({ label: t('menu.restack'), action: () => cycleStack(clicked) })
  }
  const exit = mapExitOffer(clicked)
  if (exit) {
    items.push({
      label: t('menu.exitMap', { cost: exit.cost }),
      disabled: !!exit.blocked,
      title: exit.blocked === 'zoc' ? t('menu.exitZoc')
        : exit.blocked === 'mp' ? t('menu.exitMp', { cost: exit.cost, zone: mt(exit.zone.label) })
          : t('menu.exitOk', { zone: mt(exit.zone.label) }),
      action: () => exitMap(id),
    })
  }
  openContextMenu(ev, items)
}
/** Unités (ni marqueurs ni pions de soutien, cf. `isUnit`) de l'hex de
 *  `counter`, dans l'ordre de `counters` — du bas de la pile vers le haut
 *  (cf. `stackOffsets` et l'ordre de peinture du template). */
function stackUnitsAt(counter) {
  return counters.value.filter((other) => isUnit(other) && other.col === counter.col && other.row === counter.row)
}
/** Menu contextuel "Changer l'ordre de l'empilement" : l'unité du BAS de la
 *  pile passe tout en HAUT — c'est elle qui se sélectionne désormais au
 *  clic. Répété, le menu fait tourner toute la pile. Simple affichage local :
 *  `counters` n'est pas synchronisé entre clients, et aucune règle ne dépend
 *  de cet ordre. */
function cycleStack(counter) {
  const [bottom] = stackUnitsAt(counter)
  if (!bottom) return
  counters.value = [...counters.value.filter((other) => other !== bottom), bottom]
}
// --- Sortie de carte (cf. lib/rules.js::resolveMapExit, `rules.mapExit`) ----
// Le module déclare un CAMP et des BANDES DE BORD (plages "CCRR-CCRR", cf.
// lib/setup.js) : pendant sa phase de MOUVEMENT, ce camp peut faire quitter
// la carte à une unité posée sur l'une de ces bandes.
//   - la sortie coûte le coût de terrain de l'hex quitté (le même qu'il aurait
//     fallu payer pour y entrer) — sans MP suffisants, l'entrée du menu
//     contextuel reste affichée mais grisée ;
//   - une unité figée en ZOC ennemie ne sort pas (règle [5.14] : on ne quitte
//     pas un hex contrôlé par l'ennemi pendant son mouvement) ;
//   - l'unité sortie redevient un renfort (cf. `exitedUnits`/`withMapExit`),
//     qui ne rentrera qu'à partir du tour SUIVANT et par la MÊME bande, au
//     prix d'entrée habituel (congestion comprise) ;
//   - une unité poussée hors carte par une retraite ou un refoulement n'est
//     PAS concernée : faute d'hex de retraite valide sur la carte, le moteur
//     l'élimine (cf. lib/useRetreat.js) — cette règle-ci ne vaut que pour le
//     mouvement volontaire.
// Module sans `mapExit` : toute cette section reste inerte.

/** Les bandes de sortie, hex résolus une fois pour toutes. */
const mapExitZones = computed(() => (rules.mapExit?.zones ?? []).map((zone) => {
  const cells = rangeCells(parseSetup(zone.hexes), hexOnMap)
  return { ...zone, keys: new Set(cells.map((cell) => cell.col + ',' + cell.row)) }
}))

/** La sortie est-elle ouverte en ce moment ? Mode Assisté, phase de
 *  Mouvement, et c'est bien le tour du camp qui en a le droit. */
const mapExitOpen = computed(() =>
  props.assisted && !!rules.mapExit && phase.value === 0 && turnInfo.value.activeSideKey === rules.mapExit.side)

/** Bande de sortie sur laquelle se trouve `counter`, ou `null`. */
function mapExitZoneOf(counter) {
  if (!counter) return null
  const key = counter.col + ',' + counter.row
  return mapExitZones.value.find((zone) => zone.keys.has(key)) ?? null
}

/** Surlignage gris des bandes, pendant la phase de Mouvement du camp
 *  concerné — sur l'écran des DEUX joueurs en ligne : c'est une information
 *  de carte, pas une action. */
const isMapExitHex = (hex) => mapExitOpen.value && mapExitZones.value.some((zone) => zone.keys.has(hex.c + ',' + hex.r))

/** Ce que le menu contextuel doit proposer à `counter` : `{ zone, cost,
 *  blocked }` — `blocked` valant `null` (sortie possible), `'mp'` (pas assez
 *  de points de mouvement) ou `'zoc'` (figée en ZOC ennemie). `null` quand la
 *  règle ne concerne pas ce pion : pas de bande sous lui, pas la bonne phase,
 *  pas son camp, ou module sans sortie de carte. */
function mapExitOffer(counter) {
  if (!mapExitOpen.value || !isFighter(counter) || !canControl(counter)) return null
  const zone = mapExitZoneOf(counter)
  if (!zone) return null
  const cost = terrainAreaCost({ c: counter.col, r: counter.row })
  if (isZocFrozen(counter)) return { zone, cost, blocked: 'zoc' }
  const left = remainingMp(counter)
  if (left != null && left < cost) return { zone, cost, blocked: 'mp' }
  return { zone, cost, blocked: null }
}

/** Fait quitter la carte à l'unité `id` : elle paie le coût de l'hex qu'elle
 *  occupe et rejoint les renforts, d'où elle reviendra au tour suivant par la
 *  même bande (cf. `withMapExit`). */
function exitMap(id) {
  const counter = counters.value.find((candidate) => String(candidate.id) === String(id))
  const offer = mapExitOffer(counter)
  if (!offer || offer.blocked) return
  const spent = (spentMpOf(counter) ?? 0) + offer.cost
  setSpentMp(counter.id, spent)
  const from = hexId(counter.col + 1, counter.row)
  counters.value = counters.value.filter((candidate) => String(candidate.id) !== String(id))
  if (String(selectedCounterId.value) === String(id)) selectedCounterId.value = null
  // Plus rien à annuler pour un pion qui n'est plus sur la carte.
  moveHistory.value = moveHistory.value.filter((move) => String(move.counterId) !== String(id))
  exitedUnits.value = new Map(exitedUnits.value).set(String(id), { zone: offer.zone.id, turn: turnInfo.value.turn })
  log('exit', t('log.exit', { unit: counter.name, zone: mt(offer.zone.label), from, cost: offer.cost }),
    { counterId: id, zone: offer.zone.id, turn: turnInfo.value.turn, mp: spent })
}

/** Un pion (re)posé sur la carte n'est plus "sorti" : sa prochaine sortie
 *  décidera seule par où il reviendra. Appelée partout où un renfort rejoint
 *  `counters` — en jeu, en ligne et au rejeu. */
function noteMapEntry(id) {
  if (!exitedUnits.value.has(String(id))) return
  const next = new Map(exitedUnits.value)
  next.delete(String(id))
  exitedUnits.value = next
}

/** Clic droit sur un pion de soutien — ni renforts ni unités éliminées, ni
 *  mouvement à annuler (pas de liseré "a bougé") : son seul retour possible
 *  est la tablette. Les autres marqueurs (DZ...) n'ont pas de menu. */
function onSupportContextMenu(id, ev) {
  if (inputLocked.value || retreatActive.value) return
  // Déjà engagé dans un combat résolu (cf. lib/useCombat.js) : il reste sur
  // la carte jusqu'à la fin de la phase, sans quoi il resservirait ailleurs.
  if (hasFought(counters.value.find((counter) => String(counter.id) === String(id)))) return
  openContextMenu(ev, [{ label: t('menu.putBack'), action: () => returnSupportToTray(id) }])
}
function onEliminatedContextMenu(id, ev) {
  if (inputLocked.value) return
  openContextMenu(ev, [
    { label: t('menu.putBack'), action: () => returnCounterToReinforcements(id) },
  ])
}
function chooseContextMenuItem(action) {
  action()
  closeContextMenu()
}

/** Le pion actuellement sélectionné (objet complet, pas que son id) — `null`
 *  si aucun. Factorisé ici car réutilisé par `adjacentSet`, `reachableSet`
 *  ci-dessous ET par lib/useDebug.js (portée de déplacement en mode debug). */
const selectedCounter = computed(() => counters.value.find((counter) => counter.id === selectedCounterId.value) ?? null)

/** Hex voisins (0-based col / 1-based row) du pion actuellement sélectionné,
 *  sous forme de clés "col,row" pour un lookup O(1) depuis isAdjacent(). */
const adjacentSet = computed(() => {
  const counter = selectedCounter.value
  if (!counter) return new Set()
  return new Set(
    neighborsOf(counter.col, counter.row).filter((neighbor) => hexOnMap(neighbor.col, neighbor.row)).map((neighbor) => neighbor.col + ',' + neighbor.row)
  )
})
const isAdjacent = (hex) => adjacentSet.value.has(hex.c + ',' + hex.r)

// Sous-ensemble de `adjacentSet` : uniquement les hex adjacents que le pion
// sélectionné peut RÉELLEMENT rejoindre, MP suffisants pour en payer le coût
// de terrain (cf. lib/useAssisted.js::canEnterHex) — sert au surlignage vert
// (mode Assisté), pour ne pas laisser croire qu'un hex adjacent trop coûteux
// est une destination valide. Vide dès qu'aucun pion n'est sélectionné, donc
// aussi hors mode Assisté (où `selectedCounterId` ne prend jamais de valeur,
// cf. lib/useAssisted.js::selectable) — pas besoin d'un garde-fou de mode ici.
// Hors mode debug uniquement (cf. template) : le mode debug affiche à la
// place la portée COMPLÈTE de déplacement (cf. lib/useDebug.js::isInRange),
// pas que le premier pas.
const reachableSet = computed(() => {
  const counter = selectedCounter.value
  if (!counter) return new Set()
  const from = { c: counter.col, r: counter.row }
  const set = new Set()
  for (const key of adjacentSet.value) {
    const [col, row] = key.split(',').map(Number)
    const hexCell = { c: col, r: row }
    if (!canEnterHex(counter, hexCell, from)) continue
    // Règle d'empilement (mouvement normal, cf. lib/useAssisted.js) : un hex
    // déjà occupé par un pion AMI n'est atteignable que si le pion sélectionné
    // pourrait ensuite continuer sa route (MP restants après y être entré) —
    // sinon il resterait "coincé" dessus, ce qui est interdit. On l'exclut
    // donc du surlignage vert pour ne pas laisser croire que ce clic ferait
    // quelque chose.
    if (wouldOverstack(counter, hexCell) && !canLeaveAfterEntering(counter, hexCell, from)) continue
    set.add(key)
  }
  return set
})
const isReachable = (hex) => reachableSet.value.has(hex.c + ',' + hex.r)

// --- Entrée en jeu d'un renfort : deux systèmes cf. demande utilisateur —
// 1) glisser-déposer libre (n'importe quel hex, cf. onMapDrop) ;
// 2) clic sur le pion dans le panneau (bordure orange, cf.
//    ReinforcementsPanel.vue) puis clic sur un des hex d'entrée valides,
//    surlignés en orange sur la carte — cf. `entryHexSet` ci-dessous pour le
//    détail des 3 formes de `setup` (cf. arnhem.json) et de leurs hex
//    valides respectifs. Déclaré ICI (avant le `useDebug()` plus bas, pas
//    juste avant `onHex` comme le reste de la logique de renfort) parce que
//    `entryHexSet` lui est transmis, pour l'affichage debug du surcoût
//    d'entrée (cf. lib/useAssisted.js::entrySurcharge).
const selectedReinforcement = computed(() =>
  reinforcements.value.find((counter) => String(counter.id) === String(selectedReinforcementId.value))
)

// Un hex de BORD DE CARTE : au moins un de ses 6 voisins est hors carte. Les
// `setup` "ref seule" (cf. `entryHexSet` plus bas) sont TOUJOURS des hex de
// bord — cette fonction sert à ne proposer, en repli, QUE d'autres hex de
// bord (cf. `fallbackEntryHexes`), jamais un hex vers l'intérieur de la
// carte : un renfort qui débarque au bord de la zone de jeu reste au bord,
// il ne "saute" pas plus loin à l'intérieur.
function isEdgeHex(hex) {
  return hexOnMap(hex.col, hex.row) && neighborsOf(hex.col, hex.row).some((neighbor) => !hexOnMap(neighbor.col, neighbor.row))
}

// `hex` (déjà occupé ou non) empêche-t-il `r` (le renfort qu'on cherche à
// poser) d'y entrer ? Vrai si `hex` est occupé par au moins un pion qui est :
//  - ennemi de `r` (cf. lib/useAssisted.js::isEnemyOf) — on ne débarque
//    évidemment pas sur une case tenue par l'adversaire ;
//  - OU ami de `r`, mais lui-même actuellement figé dans une ZOC ennemie
//    (cf. lib/useAssisted.js::enemyZocSet — même test que `canEnterHex` :
//    "cette unité est-elle DANS la ZOC ennemie qu'elle projette autour
//    d'elle-même ?" répond à "est-elle figée sur place ce tour-ci ?").
//  - OU ami de `r`, alors que `r` ne pourrait pas en repartir ensuite (cf.
//    `entryWouldStack` ci-dessous) — il y resterait coincé avec lui.
//    Un ami "normal" (pas figé), avec un renfort qui garde de quoi repartir,
//    ne bloque PAS l'entrée : le renfort peut traverser son hex.
// Les marqueurs et pions de soutien ne comptent jamais comme occupants ici
// (ni ennemis ni amis au sens de cette règle).
function isEntryHexBlocked(reinforcement, hex) {
  const occupants = counters.value.filter(
    (counter) => counter.col === hex.col && counter.row === hex.row && isFighter(counter)
  )
  return occupants.some((counter) => isEnemyOf(reinforcement, counter) || isZocFrozen(counter))
    || entryWouldStack(reinforcement, hex)
}

// Règle d'empilement appliquée à l'ENTRÉE EN JEU (cf.
// lib/useAssisted.js::canLeaveAfterReinforcementEntry) : `hex` est occupé
// par un ami de `r`, et `r`, une fois entré (coût d'entrée payé, sauf
// aéroporté "+adj"), n'aurait plus de quoi en repartir. Toujours faux hors
// mode Assisté.
function entryWouldStack(reinforcement, hex) {
  const entryCell = { c: hex.col, r: hex.row }
  return wouldOverstack(reinforcement, entryCell) && !canLeaveAfterReinforcementEntry(reinforcement, entryCell, !isAirborneEntry(reinforcement))
}

// Atterrissage d'un AÉROPORTÉ (`setup` "+adj", cf. `entryHexSet`) : règle
// "1 unité par hex" — interdit sur tout hex qui contient déjà une unité,
// amie OU ennemie (plus strict que `entryWouldStack`, qui laisse un renfort
// de bord de carte traverser l'hex d'un ami). Marqueurs (DZ...) et pions de
// soutien ne comptent pas. Mode Assisté uniquement : en mode Libre, aucun
// garde-fou.
function airborneLandingBlocked(hex) {
  if (!props.assisted) return false
  return counters.value.some((counter) => counter.col === hex.col && counter.row === hex.row && isFighter(counter))
}

// --- La vague du tour doit être larguée -------------------------------------
// Un renfort entre en jeu À PARTIR de son tour d'arrivée, et rien n'oblige
// son propriétaire à le poser tout de suite (cf. `canEnterThisTurn`) : une
// colonne peut attendre au bord de la carte. Un LARGAGE, lui, est daté — la
// vague part ou ne part pas —, si bien que la phase Airborne refuse de se
// terminer tant qu'il reste une unité à poser, comme la phase de Combat
// refuse de finir sur un combat obligatoire en attente (cf.
// lib/useCombat.js::pendingEngagements).

/** Aéroportés du camp actif qu'il faut encore larguer — et qu'on PEUT encore
 *  larguer : ceux dont aucun hex de largage n'est libre (zone entièrement
 *  occupée) ne sont pas retenus, sans quoi la phase ne pourrait plus se
 *  terminer du tout. Liste vide hors phase Airborne. */
const airborneToDrop = computed(() => {
  if (!props.assisted || phase.value !== PHASE_AIRBORNE) return []
  return reinforcements.value.filter((counter) => isAirborneEntry(counter)
    && canControl(counter) && canEnterThisTurn(counter)
    && landingCells(parseSetup(counter.setup), hexOnMap).some((hex) => !airborneLandingBlocked(hex)))
})

/** Ces mêmes unités groupées par zone de largage, au format qu'attend
 *  PhaseBlockedModal.vue (`{ key, hex, units }`). */
const airborneToDropByZone = computed(() => {
  const zones = new Map()
  for (const counter of airborneToDrop.value) {
    const zone = String(counter.setup).replace('+adj', '')
    if (!zones.has(zone)) zones.set(zone, { key: zone, hex: `DZ ${zone}`, units: [] })
    zones.get(zone).units.push(counter.name)
  }
  return [...zones.values()]
})

// --- Hex d'entrée bloqué : le repli -----------------------------------------
// Règle (Arnhem) : « If, and only if, a scheduled entry hex is occupied by an
// Enemy unit, or a Friendly unit in an Enemy Zone of Control, the
// Reinforcing unit may enter the nearest unblocked map edge hex to the
// scheduled hex, in the direction of the nearest Friendly unit. »
//
// Elle vaut pour CHAQUE hex d'entrée prévu — l'hex seul d'un `setup` "CCRR"
// comme chacun des hex d'une plage "CCRR-CCRR" (ex. le XXX Corps, prévu en
// 0105 ou 0106) : un hex prévu libre reste utilisable, un hex prévu bloqué
// est remplacé par son repli (cf. `entryHexSet`).

/** L'hex d'entrée prévu `hex` est-il bloqué AU SENS DE LA RÈGLE, ce qui seul
 *  ouvre le repli : une unité ennemie l'occupe, ou une unité amie figée en
 *  ZOC ennemie (cf. lib/useAssisted.js::isZocFrozen). Un hex où le renfort
 *  resterait simplement coincé avec un ami (cf. `entryWouldStack`) est
 *  inutilisable, mais n'ouvre PAS de repli (« if, and only if »). */
function entryHexRuleBlocked(reinforcement, hex) {
  return counters.value.some((counter) => counter.col === hex.col && counter.row === hex.row && isFighter(counter)
    && (isEnemyOf(reinforcement, counter) || isZocFrozen(counter)))
}

/** Hex de repli de `reinforcement` pour l'hex d'entrée prévu `ref`, bloqué
 *  (cf. `entryHexRuleBlocked`) :
 *   1. on LONGE LE BORD de la carte (cf. `isEdgeHex`) depuis `ref`, dans
 *      chacun de ses sens — en général deux, "avant" et "après" —, et l'on
 *      retient dans chaque sens le premier hex non bloqué (cf.
 *      `isEntryHexBlocked`, qui écarte aussi un hex où le renfort resterait
 *      coincé) : « the nearest unblocked map edge hex » ;
 *   2. parmi ces candidats, on garde celui qui va vers l'UNITÉ AMIE LA PLUS
 *      PROCHE de `ref` (« in the direction of the nearest Friendly unit ») :
 *      le plus proche d'elle (cf. lib/hex.js::hexDistance) — ou d'elles, si
 *      plusieurs sont à égale distance de `ref`. Égalité : les DEUX sont
 *      proposés, le joueur choisit.
 *  Sans aucune unité amie sur la carte, faute de repère, le(s) plus proche(s)
 *  de `ref` le long du bord. Liste vide si aucun repli n'est possible : le
 *  renfort attend alors au bord de la carte. */
function fallbackEntryHexes(reinforcement, ref) {
  const key = (hex) => hex.col + ',' + hex.row
  const visited = new Set([key(ref)])
  // Parcours en largeur le long du bord ; chaque hex hérite du SENS (le
  // premier pas depuis `ref`) par lequel il a été atteint en premier.
  let frontier = neighborsOf(ref.col, ref.row)
    .filter((hex) => isEdgeHex(hex))
    .map((hex) => ({ hex, branch: key(hex) }))
  frontier.forEach(({ hex }) => visited.add(key(hex)))
  const firstFree = new Map() // sens -> { hex, steps }
  for (let steps = 1; frontier.length; steps += 1) {
    const next = []
    for (const { hex, branch } of frontier) {
      if (firstFree.has(branch)) continue
      if (!isEntryHexBlocked(reinforcement, hex)) { firstFree.set(branch, { hex, steps }); continue }
      for (const neighbor of neighborsOf(hex.col, hex.row)) {
        if (visited.has(key(neighbor)) || !isEdgeHex(neighbor)) continue
        visited.add(key(neighbor))
        next.push({ hex: neighbor, branch })
      }
    }
    frontier = next
  }
  const candidates = [...firstFree.values()]
  if (!candidates.length) return []
  const friendlies = counters.value.filter(
    (counter) => isFighter(counter) && !isEnemyOf(reinforcement, counter)
  )
  const keepClosest = (scored) => {
    const best = Math.min(...scored.map((entry) => entry.d))
    return scored.filter((entry) => entry.d === best).map((entry) => entry.hex)
  }
  if (!friendlies.length) return keepClosest(candidates.map(({ hex, steps }) => ({ hex, d: steps })))
  const nearestToRef = Math.min(...friendlies.map((friendly) => hexDistance(ref, friendly)))
  const nearest = friendlies.filter((friendly) => hexDistance(ref, friendly) === nearestToRef)
  return keepClosest(candidates.map(({ hex }) => ({
    hex, d: Math.min(...nearest.map((friendly) => hexDistance(hex, friendly))),
  })))
}

// Hex d'entrée valides pour le renfort actuellement sélectionné, selon la
// forme de son `setup` (cf. arnhem.json) :
//  1. "CCRR+adj" (aéroporté, ex. chaque unité alliée près de sa DZ) : l'hex
//     de référence ET ses 6 voisins, mais en mode Assisté UNIQUEMENT ceux
//     qui ne contiennent AUCUNE unité, amie comme ennemie (règle "1 unité par
//     hex" à l'atterrissage, cf. `airborneLandingBlocked`) — pas de blocage
//     ZOC à ce niveau, l'éventail est déjà large ;
//  2. "CCRR" seule, ou "CCRR-CCRR" (plage de bord de carte, ex. renforts
//     allemands, XXX Corps en 0105 ou 0106) : CHAQUE hex prévu, tel quel
//     s'il est libre — sauf si le renfort y resterait coincé avec un ami
//     (cf. `entryWouldStack`) —, remplacé par son/ses hex de repli s'il est
//     bloqué au sens de la règle (cf. `entryHexRuleBlocked`,
//     `fallbackEntryHexes`).
const entryHexSet = computed(() => {
  const reinforcement = selectedReinforcement.value
  const parsed = parseSetup(reinforcement?.setup)
  if (!parsed) return new Set()
  const keys = (cells) => new Set(cells.map((hex) => hex.col + ',' + hex.row))
  if (parsed.kind === 'adjacent') return keys(landingCells(parsed, hexOnMap).filter((hex) => !airborneLandingBlocked(hex)))
  // "*" : tout hex de la carte (mise en place libre, cf. lib/setup.js).
  if (parsed.kind === 'anywhere') return keys(hexes.value.map((hex) => ({ col: hex.c, row: hex.r })))
  return keys(rangeCells(parsed, hexOnMap).flatMap((hex) => {
    if (entryHexRuleBlocked(reinforcement, hex)) return fallbackEntryHexes(reinforcement, hex)
    return entryWouldStack(reinforcement, hex) ? [] : [hex]
  }).filter((hex) => moduleRules.hexForbidden(reinforcement, hex) !== true))
})
const isEntryHex = (hex) => entryHexSet.value.has(hex.c + ',' + hex.r)

// cf. lib/useAssisted.js::enemyZocSet — hex sous ZOC ennemie relativement au
// pion sélectionné (vide si aucun pion sélectionné, ou si l'appli n'est pas
// en mode Assisté puisqu'aucun pion n'y est alors jamais "sélectionné" — cf.
// lib/useAssisted.js::selectable). La RÈGLE elle-même (cf.
// lib/useAssisted.js::canEnterHex) s'applique TOUJOURS en mode Assisté,
// avec ou sans debug — seul cet AFFICHAGE (surlignage rouge, classe CSS
// `hex-zoc`, cf. template) est réservé au mode debug (cf. `v-if="debug"`),
// pour ne pas surcharger l'écran par défaut. `zocSet` est aussi transmis à
// useDebug() ci-dessous pour que le calcul de portée en tienne compte.
const zocSet = computed(() => enemyZocSet(selectedCounter.value))
const isZocHex = (hex) => zocSet.value.has(hex.c + ',' + hex.r)

// cf. lib/useDebug.js — case à cocher "debug" (ci-dessous dans le template)
// et tous les affichages qu'elle déclenche : le coût de terrain (COT) des
// hex adjacents au pion sélectionné (`adjacentCotLabels`), la portée
// COMPLÈTE de déplacement de ce pion, au-delà du simple premier pas adjacent
// (`isInRange`, cf. surlignage vert dans le template, en mode debug
// seulement — le clic, lui, reste toujours limité aux hex adjacents), et le
// surcoût de congestion déjà accumulé sur les hex d'entrée de renfort
// actuellement surlignés (`entrySurchargeLabels`, cf.
// lib/useAssisted.js::entrySurcharge). Le calcul de portée reçoit `zocSet`
// ci-dessus pour respecter la ZOC : un pion ne peut pas continuer son
// chemin au-delà d'un hex sous ZOC ennemie.
// Pions à hex-objectif sur la carte (cf. `runAutoMoves`), pour leurs traces
// en mode debug.
const autoMovers = computed(() => counters.value
  .map((counter) => ({ id: counter.id, target: moduleRules.autoMoveTarget(counter) }))
  .filter((mover) => mover.target))
const { debug, adjacentCotLabels, isInRange, entrySurchargeLabels, autoMoveTrailLines } = useDebug(
  hexes, isAdjacent, terrainCost, selectedCounter, remainingMp, neighborsOf, hexOnMap, canEnterTerrain, zocSet,
  entryHexSet, entrySurcharge, wouldOverstack, isZocFrozen, rules.zoc.stopOnEntry, autoMoveTrails, autoMovers,
)

// Décalage visuel des pions empilés sur un même hex — même principe
// qu'ambush-tactique (HexMap.vue, `placedPositions`) : chaque pion suivant
// sur une case glisse en diagonale de 10% de sa taille par rapport au
// précédent, cumulatif. Les marqueurs (DZ...) restent toujours au centre,
// sans décalage — les unités qui partagent leur hex commencent leur pile à
// l'indice 1 (comme les "eventMarkers" d'ambush-tactique), le marqueur
// servant de socle visuel sous la pile (cf. z-order dans le template : les
// marqueurs sont rendus avant les unités, donc toujours dessous). Les pions
// de soutien, eux, coiffent la pile : un cran au-dessus de la dernière unité
// de leur hex (rendus après les unités), tous au même cran — le badge de
// compte (cf. `supportStackBadges`) dit combien il y en a.
const STACK_STEP = 0.1
const stackOffsets = computed(() => {
  const hexKey = (counter) => counter.col + ',' + counter.row
  const stackAt = (idx) => ({ dx: -STACK_STEP * idx, dy: -STACK_STEP * idx })
  const markerHexes = new Set(counters.value.filter((counter) => !isUnit(counter) && !isSupport(counter) && !counter.attachedTo).map(hexKey))
  const unitCounts = new Map()
  const offsets = new Map()
  for (const counter of counters.value) {
    if (!isUnit(counter)) { offsets.set(counter.id, ZERO_OFFSET); continue }
    const key = hexKey(counter)
    const stackBase = markerHexes.has(key) ? 1 : 0
    const stackIndex = unitCounts.get(key) ?? 0
    unitCounts.set(key, stackIndex + 1)
    offsets.set(counter.id, stackAt(stackBase + stackIndex))
  }
  // Une fois toutes les unités comptées, quel que soit l'ordre de `counters`.
  // Les pions rattachés à une unité (résultat de recherche, "Sighted" — cf.
  // `syncSearchMarkers`) montent chacun d'un cran de plus.
  const attachedCounts = new Map()
  for (const counter of counters.value) {
    if (!isSupport(counter) && !counter.attachedTo) continue
    const key = hexKey(counter)
    const attachedIndex = counter.attachedTo ? (attachedCounts.get(key) ?? 0) : 0
    if (counter.attachedTo) attachedCounts.set(key, attachedIndex + 1)
    offsets.set(counter.id, stackAt((markerHexes.has(key) ? 1 : 0) + (unitCounts.get(key) ?? 0) + attachedIndex))
  }
  return offsets
})
const ZERO_OFFSET = { dx: 0, dy: 0 }
// Taille d'un pion en fraction du pas de ligne — cf. Counter.vue, prop `size`.
const COUNTER_SIZE = 0.8

/** Centre pixel d'un hex (col 0-based, row 1-based) — même formule que
 *  Counter.vue, dupliquée ici pour placer les badges d'empilement. */
function hexCenterPx(col, row) {
  const { x0, y0, colStep, rowStep } = calibration
  const yoff = col % 2 === 1 ? rowStep / 2 : 0
  return { x: x0 + col * colStep, y: y0 + (row - 1) * rowStep + yoff }
}

// Nombre de pions de soutien empilés sur un même hex, affiché en badge sur
// la carte (les pions de soutien étant tous identiques, un décalage visuel
// seul ne suffit pas à voir combien il y en a) — seulement à partir de 2.
// Suit le décalage de ces pions sur la pile d'unités (cf. `stackOffsets`).
const supportStackBadges = computed(() => {
  const counts = new Map()
  for (const counter of counters.value) {
    if (!isSupport(counter)) continue
    const key = counter.col + ',' + counter.row
    const entry = counts.get(key) ?? { col: counter.col, row: counter.row, offset: stackOffsets.value.get(counter.id) ?? ZERO_OFFSET, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  const counterSizePx = calibration.rowStep * COUNTER_SIZE
  return [...counts.values()].filter((supportStack) => supportStack.count >= 2).map((supportStack) => {
    const center = hexCenterPx(supportStack.col, supportStack.row)
    return {
      key: supportStack.col + ',' + supportStack.row, count: supportStack.count,
      x: center.x + calibration.a * 0.55 + supportStack.offset.dx * counterSizePx,
      y: center.y + calibration.a * 0.5 + supportStack.offset.dy * counterSizePx,
    }
  })
})

// --- Fenêtre de survol d'une pile (cf. StackPopup.vue) : survoler un pion
// d'un hex qui en porte PLUSIEURS — unités, marqueurs DZ, pions de soutien,
// toute sorte de pion — montre toute la pile en grand, l'empilement sur la
// carte masquant en partie les pions du dessous. Rien pour un pion seul.
// Coupée pendant un glisser et à l'ouverture d'un menu contextuel.
const hoveredCounter = ref(null) // { id, col, row, anchor: rect écran } | null
function onCounterHover(id, ev) {
  if (draggedCounterId.value != null) return
  const counter = counters.value.find((counter) => String(counter.id) === String(id))
  if (!counter) return
  const { left, top, right, bottom } = ev.target.getBoundingClientRect()
  hoveredCounter.value = { id, col: counter.col, row: counter.row, anchor: { left, top, right, bottom } }
}
function onCounterUnhover(id) {
  if (String(hoveredCounter.value?.id) === String(id)) hoveredCounter.value = null
}
/** Pions de l'hex survolé, du dessus vers le dessous de la pile (ordre de
 *  peinture du template inversé : soutien, unités, marqueurs) — vide s'il
 *  n'y en a qu'un. */
const hoveredStackCounters = computed(() => {
  const hover = hoveredCounter.value
  if (!hover) return []
  const here = counters.value.filter((counter) => counter.col === hover.col && counter.row === hover.row)
  if (here.length < 2) return []
  return [
    ...here.filter((counter) => !isUnit(counter) && !isSupport(counter)),
    ...here.filter(isUnit),
    ...here.filter(isSupport),
  ].reverse()
})

// --- Pions de soutien en mode Assisté (cf. lib/useCombat.js, section "PIONS
// DE SOUTIEN") : clic sur un pion de la tablette, puis clic sur un hex cible
// possible. Le camp PROPRIÉTAIRE les engage pendant les DEUX phases de
// Combat du tour — en attaque pendant la sienne, en défense pendant celle de
// l'adversaire — et les retrouve dans sa tablette entre les deux, puisqu'ils
// sont retirés de la carte à chaque fin de phase (cf. le watcher plus bas).

/** Peut-on poser un pion de soutien en ce moment ? Phase de Combat du mode
 *  Assisté, hors application d'un résultat de combat (retraite/avance en
 *  cours) — et rien à faire avec une saisie verrouillée (rejeu, tour de
 *  l'adversaire en ligne : le soutien de défense passe alors par la demande
 *  de FPF, cf. section "FPF en ligne"). */
const canPlaceSupportNow = computed(() =>
  combatAllowed.value && !!props.module.supportTrack?.side && !inputLocked.value && !retreatActive.value)

/** Clic sur un pion de la tablette : il attend un hex (recliquer l'annule). */
function onSupportSelect(id) {
  if (!canPlaceSupportNow.value) return
  selectedSupportId.value = String(selectedSupportId.value) === String(id) ? null : id
}

/** Surlignage des hex où le pion choisi peut être posé (cf.
 *  lib/useCombat.js::canPlaceSupportHex) — rien tant qu'aucun n'est choisi. */
const isSupportTargetHex = (hex) => selectedSupportId.value != null && canPlaceSupportHex(hex)

/** Pose le pion de soutien choisi sur `hex` (appelé par onHex). Renvoie
 *  `false` si le clic ne le concerne pas, pour laisser onHex continuer. */
function placeSelectedSupport(hex) {
  if (selectedSupportId.value == null) return false
  if (!canPlaceSupportHex(hex)) return true // clic consommé : hex refusé
  const token = supportTrackerRef.value?.findToken(selectedSupportId.value)
  selectedSupportId.value = null
  if (!token) return true
  const placed = { ...token, col: hex.c, row: hex.r }
  counters.value.push(placed)
  emit('move', { counterId: placed.id, col: placed.col, row: placed.row })
  // Même entrée `support` que la pose au glisser-déposer (cf. onMapDrop) :
  // `counter` embarque le pion entier, que le rejeu ne peut pas retrouver
  // dans `allCounters` (pions créés à la volée par la tablette).
  log('support', t('log.supportCommitted', { unit: placed.name, hex: hexId(placed.col + 1, placed.row) }),
    { counterId: placed.id, col: placed.col, row: placed.row, counter: placed })
  return true
}

// Fin de phase : tous les pions de soutien quittent la carte. Ils reviennent
// d'eux-mêmes dans la tablette (déduite de la carte, cf. SupportTracker.vue),
// donc utilisables à nouveau pendant l'autre phase de Combat du même tour —
// la dotation du tour vaut pour l'attaque ET pour la défense. `flush: 'sync'`
// et aucune journalisation : le retrait se déduit du changement de phase, ce
// qui le rejoue à l'identique au rechargement d'un journal comme chez
// l'adversaire en ligne (tous deux rejouent l'entrée `phase`).
watch(phase, () => {
  if (!counters.value.some(isSupport)) return
  counters.value = counters.value.filter((counter) => !isSupport(counter))
  selectedSupportId.value = null
}, { flush: 'sync' })

/** Clic sur un pion déjà sur la carte — deux interprétations possibles,
 *  cf. le nouveau comportement demandé pour le mouvement normal :
 *   1. un AUTRE pion est déjà sélectionné et celui-ci lui est adjacent -> le
 *      clic est traité comme un déplacement vers son hex (cf. onHex), PAS
 *      comme un changement de sélection. Sans ça, cliquer sur un pion qui
 *      occupe la case visée reviendrait TOUJOURS à sélectionner ce pion (son
 *      image recouvre le polygone de l'hex en dessous, cf.
 *      Counter.vue::onClick, `@click.stop`), rendant impossible tout
 *      déplacement au clic vers une case occupée (ex. empilement avec un
 *      ami, cf. la règle qui précède) ;
 *   2. sinon, comportement de sélection normal — SAUF si ce pion est
 *      verrouillé (cf. `lockedFromSelectionIds` : il a bougé ce tour-ci puis
 *      a déjà été désélectionné une fois), auquel cas le clic ne fait rien. */
function onCounterSelect(id) {
  if (inputLocked.value) return
  const counter = counters.value.find((counter) => String(counter.id) === String(id))
  if (!counter) return
  // Reconnaissance du joueur (cf. `onManualRecon`) : le clic choisit une
  // source ou explore une cible, rien d'autre.
  if (onManualRecon({ c: counter.col, r: counter.row }, counter)) return
  // Mode debug, phase de Fin de tour : le clic sert à REGARDER la ligne de
  // communication de cette unité (cf. la section du même nom), et rien
  // d'autre — y compris sur une unité que le camp actif ne contrôle pas.
  if (toggleSupplyLine(counter)) return
  // Résultat de combat en cours d'application (cf. lib/useRetreat.js) :
  //  - retraite : le seul clic utile est sur un hex rouge — le pion posé sur
  //    un tel hex (unité amie de celle qui retraite) recouvre son polygone,
  //    son clic vaut donc clic sur l'hex ;
  //  - avance : un clic sur une unité victorieuse la choisit pour avancer.
  if (retreatActive.value) {
    if (!stepRetreat({ col: counter.col, row: counter.row })) selectAdvancer(counter)
    return
  }
  // Un pion de soutien attend son hex (cf. placeSelectedSupport) : le pion
  // cliqué recouvre le polygone de son hex, le clic vaut donc clic sur cet
  // hex — c'est précisément sur un hex occupé qu'on pose un soutien.
  if (selectedSupportId.value != null) { onHex({ c: counter.col, r: counter.row }); return }
  // Phase Airborne : on ne fait que POSER des aéroportés, aucun pion déjà
  // sur la carte ne se sélectionne ni ne bouge (cf. lib/useAssisted.js,
  // section "Phase Airborne").
  if (phase.value === PHASE_AIRBORNE) return
  // Mise en place : même principe, rien ne bouge. Un clic sur un pion déjà
  // posé vaut clic sur son hex, pour y empiler le renfort choisi.
  if (phase.value === PHASE_SETUP) {
    if (selectedReinforcementId.value != null) onHex({ c: counter.col, r: counter.row })
    return
  }
  // --- Phase Combat (mode Assisté) : le clic sur un pion compose un COMBAT
  // plutôt que de sélectionner/déplacer (cf. lib/useCombat.js) —
  //   1. c'est une unité ENNEMIE -> son hex est ajouté aux cibles (ouvrant
  //      le combat s'il n'y en avait pas), ou en est retiré s'il y était déjà
  //      (même effet qu'un clic sur l'hex, cf. onHex : le pion recouvre le
  //      polygone de son propre hex, les deux doivent donc faire pareil) ;
  //   2. c'est une unité à soi, adjacente à TOUS les hex cibles (règle
  //      stricte) ou une artillerie qui les a tous à portée -> la désigne (ou
  //      la retire si elle l'était déjà) comme attaquante ;
  //   3. partie LOCALE seulement : c'est une artillerie du défenseur éligible
  //      au FPF de ce combat -> le défenseur l'y ajoute (ou l'en retire), cf.
  //      lib/useCombat.js::toggleFpf. En ligne, le défenseur choisit sur son
  //      propre écran (cf. `onFpfRequested`).
  // Dans TOUS les autres cas, le clic ne fait rien : en phase Combat, une
  // unité amie ne se sélectionne jamais "normalement" — ni avant d'avoir
  // désigné une cible, ni si elle est hors de portée, ni si elle a déjà
  // combattu (cf. lib/useCombat.js::hasFought, qui la rend inéligible).
  if (combatAllowed.value) {
    if (!toggleTarget(counter) && !toggleAttacker(counter) && !props.online) toggleFpf(counter)
    return
  }
  if (selectedCounterId.value != null && selectedCounterId.value !== id && isAdjacent({ c: counter.col, r: counter.row })) {
    onHex({ c: counter.col, r: counter.row })
    return
  }
  if (lockedFromSelectionIds.value.has(String(id))) return
  if (!canControl(counter)) return
  // Hors phase de Mouvement (Combat naval, Administrative... d'une piste à
  // phases du module), aucun pion ne se sélectionne pour bouger.
  if (phase.value != null && phase.value !== 0) return
  setSelectedCounter(selectedCounterId.value === id ? null : id)
  selectedReinforcementId.value = null
}

const selectedReinforcementId = ref(null)

function onReinforcementSelect(id) {
  if (inputLocked.value) return
  const counter = reinforcements.value.find((counter) => String(counter.id) === String(id))
  // `canPlaceReinforcementNow` : en phase Airborne, seuls les aéroportés ;
  // dans les autres phases, tout sauf eux (cf. lib/useAssisted.js).
  if (!canControl(counter) || !canEnterThisTurn(counter) || !canPlaceReinforcementNow(counter)) return
  // Désélection du pion en cours AVANT de choisir le renfort : refusée si ce
  // pion est en overstack (cf. setSelectedCounter), et le renfort n'est
  // alors pas sélectionné non plus.
  if (!setSelectedCounter(null)) return
  selectedReinforcementId.value = selectedReinforcementId.value === id ? null : id
}

// --- Empilement (stacking) au mouvement normal -----------------------------
// Une unité ne peut jamais TERMINER sa phase de Mouvement sur un hex occupé
// par une unité AMIE (deux amies ne peuvent pas y rester ensemble à la fin
// du tour) — cf. lib/useAssisted.js::wouldOverstack/
// canLeaveAfterEntering (déplacées là-bas pour être réutilisées telles
// quelles par lib/useDebug.js, cf. plus bas : le surlignage vert de la
// portée complète en mode debug doit lui aussi exclure ces hex). Ne concerne
// QUE le mouvement normal d'un pion déjà sur la carte (cf. onHex ci-dessous)
// — pas l'entrée en jeu d'un renfort, qui a ses propres règles de blocage
// (cf. `isEntryHexBlocked` plus haut : ennemi, ou ami figé en ZOC).

/** Clic sur un MARQUEUR (DZ...) : jamais sélectionnable, il ne fait que
 *  recouvrir son hex — le clic vaut donc clic sur cet hex (cf. `onHex` :
 *  y poser un renfort, y déplacer l'unité sélectionnée, y retraiter...).
 *  Un pion de soutien, lui, coiffe les unités de son hex (cf. `stackOffsets`)
 *  et masque celle du dessus : quand les pions se sélectionnent (mode
 *  Assisté), le clic vaut clic sur cette unité, comme si le soutien n'était
 *  pas là. */
function onMarkerClick(id) {
  const marker = counters.value.find((counter) => String(counter.id) === String(id))
  if (!marker) return
  if (isSupport(marker) && selectable.value) {
    const topUnit = counters.value.filter((counter) => isUnit(counter) && counter.col === marker.col && counter.row === marker.row).at(-1)
    if (topUnit) { onCounterSelect(topUnit.id); return }
  }
  const hex = hexes.value.find((candidate) => candidate.c === marker.col && candidate.r === marker.row)
  if (hex) onHex(hex)
}

/** Clic sur un hex, par ordre de priorité :
 *  1. un renfort est sélectionné (système 2) et l'hex cliqué fait partie de
 *     ses hex d'entrée valides -> il s'y pose, fin de sélection. Si son
 *     `setup` n'est pas "+adj" (aéroporté, non concerné), il paie en plus le
 *     coût d'entrée de cet hex, congestion comprise (cf.
 *     lib/useAssisted.js::spendEntryCost) ;
 *  2. un pion déjà sur la carte est sélectionné, l'hex cliqué lui est
 *     adjacent, il lui reste assez de MP pour en payer le coût de terrain
 *     (cf. lib/useAssisted.js::canEnterHex/spendMp) ET l'hex n'est pas
 *     occupé par un ami avec lequel il finirait "coincé" (cf.
 *     `wouldOverstack`/`canLeaveAfterEntering` ci-dessus) -> il s'y
 *     déplace (et reste sélectionné, pour enchaîner sur d'autres hex tant
 *     qu'il lui reste des MP) ;
 *  3. sinon, le clic ne fait rien (pas de pion/renfort concerné par cet hex).
 *  Aucune action pendant un rejeu en cours (cf. `replayLocked`) — seul le
 *  lecteur (stepReplay/fastForwardReplay) fait bouger la carte tant que le
 *  journal chargé n'est pas entièrement joué. */
const onHex = (hex) => {
  if (inputLocked.value) return
  if (onManualRecon(hex)) return
  // Résultat de combat en cours d'application (cf. lib/useRetreat.js) :
  // seul un clic sur un hex rouge (retraite) ou vert vif (avance) fait
  // quelque chose ; tout le reste est ignoré jusqu'à la fin.
  if (retreatActive.value) {
    const position = { col: hex.c, row: hex.r }
    if (!stepRetreat(position)) stepAdvance(position)
    return
  }
  // Un pion de soutien choisi dans la tablette attend son hex (mode Assisté,
  // cf. placeSelectedSupport) : il passe avant tout le reste — notamment
  // avant le retrait d'un hex cible juste en dessous, un hex cible étant
  // justement là où on veut poser ce pion.
  if (placeSelectedSupport(hex)) return
  // Clic sur un hex cible pendant un combat : le retire des cibles (et
  // annule le combat si c'était le dernier, cf. lib/useCombat.js) — pendant
  // de la même règle dans onCounterSelect, pour le cas où c'est le POLYGONE
  // de l'hex qui reçoit le clic plutôt que le pion posé dessus.
  if (isCombatTargetHex(hex)) { removeTargetHex(hex.c, hex.r); return }
  if (selectedReinforcementId.value != null) {
    if (isEntryHex(hex)) {
      const reinforcement = selectedReinforcement.value
      if (reinforcement && canEnterThisTurn(reinforcement)) {
        const placed = { ...instanceOf(reinforcement), col: hex.c, row: hex.r }
        counters.value.push(placed)
        noteMapEntry(placed.id)
        // "+adj" (aéroporté) n'est jamais un hex de bord de carte au sens de
        // cette règle — cf. lib/useAssisted.js::spendEntryCost, qui ne fait
        // rien hors mode Assisté de toute façon.
        const paysEntry = !isAirborneEntry(reinforcement)
        const paid = paysEntry ? spendEntryCost(placed, hex) : null
        // Règle particulière du module sur l'arrivée (cf.
        // lib/useArnhem.js::airborneArrivalSpentMp — un aéroporté largué
        // compte 4 MP déjà dépensés, soit 3 MP pour ce tour-ci). Inscrit
        // AVANT le `log` ci-dessous, qui journalise les MP du pion (cf.
        // `mpText`/`spentMpOf`) : la ligne du journal doit montrer, et le
        // rejeu rétablir, l'état d'APRÈS application de la règle.
        moduleRules.noteAirborneArrival(placed)
        const arrivalMp = moduleRules.airborneArrivalSpentMp(placed)
        if (arrivalMp !== null) setSpentMp(placed.id, arrivalMp)
        emit('move', { counterId: placed.id, col: hex.c, row: hex.r })
        // Hex d'entrée CONGESTIONNÉ (au moins une autre entrée par ce même hex
        // ce tour-ci, cf. lib/useAssisted.js::entryCost) : le journal le
        // signale, avec le coût majoré réellement payé.
        const congestion = paid && paid.cost > paid.baseCost
          ? ` — ${t('log.congestion', { rank: paid.rank, cost: paid.cost, base: paid.baseCost })}`
          : ''
        // `entry` : il a payé un coût d'entrée — au rejeu, on le repaie pour
        // rétablir aussi la CONGESTION de cet hex (cf. applyReplayEntry, qui
        // recalcule le coût lui-même : `entryRank`/`entryCost` ne sont là que
        // pour information).
        log('place', t('log.enters', { unit: reinforcement.name, hex: hexId(hex.c + 1, hex.r) }) + mpText(placed) + congestion,
          { counterId: placed.id, col: hex.c, row: hex.r, mp: spentMpOf(placed), entry: paysEntry,
            entryRank: paid?.rank ?? null, entryCost: paid?.cost ?? null })
        // Sélectionné automatiquement après son entrée en jeu, pour pouvoir
        // enchaîner tout de suite sur son mouvement (cf. onHex, branche
        // mouvement normal) sans avoir à recliquer dessus — comme un pion
        // déjà sur la carte qui vient de se déplacer (cf. `setSelectedCounter`,
        // qui gère aussi le verrouillage d'un éventuel pion PRÉCÉDEMMENT
        // sélectionné ayant déjà bougé, cf. section "Verrouillage" plus haut).
        // SAUF en phase Airborne : on n'y déplace aucune unité, l'aéroporté
        // posé reste donc désélectionné (cf. lib/useAssisted.js).
        // Ni à la mise en place, où rien ne bouge.
        if (phase.value !== PHASE_AIRBORNE && phase.value !== PHASE_SETUP) setSelectedCounter(placed.id)
      }
      // Un pion en nombre illimité reste choisi : chaque clic en pose un autre.
      if (!reinforcement?.multiple) selectedReinforcementId.value = null
    }
    return
  }
  if (selectedCounterId.value != null && isAdjacent(hex) && (phase.value == null || phase.value === 0)) {
    const counter = counters.value.find((counter) => counter.id === selectedCounterId.value)
    // Position de départ capturée AVANT tout déplacement — sert à la fois à
    // l'historique (from ci-dessous) et de paramètre "from" pour
    // canEnterHex/spendMp (cf. useAssisted.js::terrainCost, règle
    // route/piste : le coût dépend de d'où on VIENT, pas seulement de l'hex
    // d'arrivée).
    const from = counter ? { col: counter.col, row: counter.row } : null
    const fromHex = counter ? { c: from.col, r: from.row } : null
    // Empilement : `h` est occupé par un ami ET `c` ne pourrait plus repartir
    // ensuite -> comme si l'hex n'était pas une destination valide (cf.
    // `wouldOverstack`/`canLeaveAfterEntering` plus haut) — une unité ne
    // peut jamais TERMINER sa phase de Mouvement sur un hex ami.
    const stackingBlocked = counter && wouldOverstack(counter, hex) && !canLeaveAfterEntering(counter, hex, fromHex)
    // Pas assez de MP pour entrer dans cet hex (cf. useAssisted.js) : le
    // pion reste sélectionné et sur place, comme si l'hex n'était pas une
    // destination valide — libre à l'utilisateur d'essayer un autre hex
    // adjacent moins coûteux.
    if (counter && !stackingBlocked && canEnterHex(counter, hex, fromHex)) stepCounter(counter, hex)
    return
  }
}

/** Avance `counter` d'un pas vers l'hex adjacent `hex` (`{ c, r }`), déjà
 *  jugé permis : MP, réseau, journal, retour arrière, liseré (cf. onHex,
 *  `runAutoMoves`). */
function stepCounter(counter, hex) {
  const from = { col: counter.col, row: counter.row }
  const fromHex = { c: from.col, r: from.row }
  const previousEntry = counter.enteredFrom ?? null
  counter.col = hex.c; counter.row = hex.r
  counter.enteredFrom = entryFromMove(from, { col: hex.c, row: hex.r })
  spendMp(counter, hex, fromHex)
  emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
  const journalId = log('move', t('log.moves', { unit: counter.name, hex: hexId(hex.c + 1, hex.r) }) + mpText(counter),
    { counterId: counter.id, col: counter.col, row: counter.row, mp: spentMpOf(counter), enteredFrom: counter.enteredFrom })
  pushMoveHistory(counter.id, from, { col: counter.col, row: counter.row }, journalId, previousEntry)
  markMoved(counter.id, from, previousEntry)
}

// --- Pions à HEX-OBJECTIF (cf. lib/moduleRules.js::autoMoveTarget — ex.
// leurres et task forces japonaises de la mer de Corail) : au début de
// chaque phase de Mouvement de leur camp (`moduleRules.autoMoveSide`),
// l'appli les avance elle-même vers leur objectif, pas à pas le long du plus
// court chemin (cf. lib/autoMove.js), tant que les règles du mode Assisté le
// permettent (MP du tour, terrain, ZOC, empilement — mêmes contrôles qu'un
// clic, cf. onHex). Chaque pas est un déplacement ordinaire : journalisé,
// partagé en ligne, annulable. Une seule fois par pas de la piste ; en
// ligne, seul le navigateur de ce camp les joue (les autres reçoivent les
// mouvements). Jamais pendant un rejeu, ni en mode Libre (pas de MP).
let autoMovedStep = null
function runAutoMoves() {
  const side = moduleRules.autoMoveSide
  if (!side || !props.assisted || isReplaying.value || replayLocked.value) return
  if (phase.value !== 0 || turnInfo.value.activeSideKey !== side) return
  if (props.online && props.localSide !== side) return
  const step = turnInfo.value.step
  if (autoMovedStep === step) return
  autoMovedStep = step
  for (const counter of counters.value) {
    const target = moduleRules.autoMoveTarget(counter)
    if (!target) continue
    const path = pathToward({ col: counter.col, row: counter.row, enteredFrom: counter.enteredFrom ?? null }, target, {
      hexOnMap,
      // Le pion tel qu'il serait en `from`, entré par `enteredFrom` : les
      // règles du terrain (passages d'île compris) jugent alors chaque pas
      // du chemin, pas seulement le premier.
      canStep: (from, to, enteredFrom) => canEnterTerrain({ ...counter, col: from.c, row: from.r, enteredFrom }, to, from),
      cost: (from, to) => terrainCost(to, from),
    })
    for (const next of path) {
      const hex = { c: next.col, r: next.row }
      const fromHex = { c: counter.col, r: counter.row }
      if (!canEnterHex(counter, hex, fromHex)) break
      if (wouldOverstack(counter, hex) && !canLeaveAfterEntering(counter, hex, fromHex)) break
      stepCounter(counter, hex)
    }
  }
}
// --- Camp joué par le MOTEUR (`moduleRules.autoMoveSide` — les Japonais à
// la mer de Corail, le joueur ayant les Alliés) : à chacun de ses pas, il
// fait ses déplacements automatiques (phase de Mouvement, cf.
// `runAutoMoves`) puis rend la main de lui-même, comme si son joueur avait
// cliqué "suivant" (cf. onPhaseNext). Le joueur humain ne voit ainsi que
// ses propres phases. Une seule fois par pas ; jamais pendant un rejeu ;
// en ligne, seulement chez le joueur de ce camp, s'il y en a un.
let engineStepPlayed = null
function playEngineStep() {
  const side = moduleRules.autoMoveSide
  if (!side || !props.assisted || isReplaying.value || replayLocked.value) return
  const step = turnInfo.value.step
  if (turnInfo.value.activeSideKey !== side || step !== turnTrackerRef.value?.currentStep) return
  if (props.online && props.localSide !== side) return
  if (engineStepPlayed === step) return
  engineStepPlayed = step
  if (phase.value === 0) runAutoMoves()
  continueEngineRecon()
}
watch([phase, () => turnInfo.value.step, () => turnInfo.value.activeSideKey, isReplaying], () => nextTick(playEngineStep))

// --- Reconnaissance (`moduleRules.reconPhase` — cf. lib/useCoralSea.js) :
// pendant cette phase, chaque SOURCE de reconnaissance du camp actif
// (`moduleRules.reconChecks` — base aérienne, porte-avions) explore jusqu'à
// `checks` hex différents de sa portée. Un chit est tiré de la tasse de
// recherche, son pion posé sur l'unité explorée et son résultat appliqué
// (cf. `performSearch`, entrée `search` du journal).
//   - Camp du MOTEUR (`moduleRules.autoMoveSide`) : il tire une source au
//     hasard parmi celles qui ont encore un check et une cible, puis l'une
//     de ses cibles (surlignée sur la carte), et attend : le joueur ouvre le
//     "Rapport de reconnaissance" d'un clic droit sur une unité de cet hex
//     (cf. `reportRecon`). Puis la source suivante ; quand il n'en reste
//     plus, le moteur rend la main.
//   - Camp du JOUEUR (`moduleRules.manualReconSide`) : il clique une source
//     (surlignée), puis une cible à sa portée (cf. `onManualRecon`). Le chit
//     tiré lui reste caché — un pion "Search" générique le remplace sur la
//     carte — et un toast lui dit ce que ses avions ont vu.
const reconTarget = ref(null) // { col, row, source: { key, base, checks } } | null
// Checks déjà faits par chaque source, sous la clé "pas:source" — le pas de
// la piste, lu sur TurnTracker.vue (à jour tout de suite, même au rejeu),
// suffit à les oublier à la phase suivante. Rétabli par les entrées `search`.
const reconUses = ref(new Map())
const reconUseKey = (key) => `${turnTrackerRef.value?.currentStep}:${key}`
const reconUsesOf = (key) => reconUses.value.get(reconUseKey(key)) ?? 0
function noteReconUse(key) {
  reconUses.value = new Map(reconUses.value).set(reconUseKey(key), reconUsesOf(key) + 1)
}
const isReconTargetHex = (hex) => reconTarget.value?.col === hex.c && reconTarget.value?.row === hex.r
const searchBagLeft = () => Object.values(moduleRules.searchBag?.value ?? {}).some((count) => count > 0)

/** Le camp `side` est-il dans sa phase de reconnaissance ? */
function reconPhaseOf(side) {
  return !!moduleRules.reconPhase && !!side && turnInfo.value.activeSideKey === side
    && turnTrackerRef.value?.currentSlot?.phase === moduleRules.reconPhase
}

/** Checks que le camp `side` peut encore faire : sources qui ont un check
 *  et au moins une cible. */
function openReconChecks(side) {
  return (moduleRules.reconChecks(counters.value, side) ?? [])
    .filter((check) => check.targets.length && reconUsesOf(check.source.key) < check.source.checks)
}

/** Désigne le prochain hex à explorer, ou rend la main s'il n'y en a plus
 *  (ou si la tasse de recherche est vide). */
function continueEngineRecon() {
  reconTarget.value = null
  if (reconPhaseOf(moduleRules.autoMoveSide) && searchBagLeft()) {
    const checks = openReconChecks(moduleRules.autoMoveSide)
    if (checks.length) {
      const check = checks[Math.floor(Math.random() * checks.length)]
      reconTarget.value = { ...check.targets[Math.floor(Math.random() * check.targets.length)], source: check.source }
      return
    }
  }
  onPhaseNext()
}

// --- Reconnaissance du joueur : source choisie (clé), en attente de cible.
const manualReconSource = ref(null)
watch(() => turnInfo.value.step, () => { reconTarget.value = null; manualReconSource.value = null })

/** Phase de reconnaissance du camp joué à la main (mode Assisté). */
const manualReconActive = computed(() => props.assisted && reconPhaseOf(moduleRules.manualReconSide))
/** Checks encore possibles pour le joueur (cf. `openReconChecks`). */
const manualReconChecks = computed(() => (manualReconActive.value && searchBagLeft()
  ? openReconChecks(moduleRules.manualReconSide) : []))
const manualReconCheck = computed(() => manualReconChecks.value.find((check) => check.source.key === manualReconSource.value) ?? null)
const isManualReconSourceHex = (hex) => manualReconChecks.value.some((check) => check.source.col === hex.c && check.source.row === hex.r)
const isManualReconChosenHex = (hex) => manualReconCheck.value?.source.col === hex.c && manualReconCheck.value?.source.row === hex.r
const isManualReconTargetHex = (hex) => !!manualReconCheck.value?.targets.some((target) => target.col === hex.c && target.row === hex.r)

/** Clic pendant la reconnaissance du joueur (sur un pion ou un hex) : une
 *  source la choisit, une cible de la source choisie est explorée. Vrai si
 *  le clic a été consommé. */
function onManualRecon(hex, clicked = null) {
  if (!manualReconActive.value) return false
  const source = manualReconChecks.value.find((check) =>
    (clicked && check.source.unitId === String(clicked.id)) || (!clicked && check.source.col === hex.c && check.source.row === hex.r))
  if (source) {
    manualReconSource.value = manualReconSource.value === source.source.key ? null : source.source.key
    return true
  }
  const check = manualReconCheck.value
  if (check && isManualReconTargetHex(hex)) {
    const enemies = counters.value.filter((counter) => counter.col === hex.c && counter.row === hex.r
      && moduleRules.reconTargetOf(counter, moduleRules.manualReconSide))
    const unit = clicked && enemies.includes(clicked) ? clicked : enemies.at(-1)
    if (unit) performSearch(unit, check.source, { hidden: true })
    // Plus rien à faire pour cette source : elle se désélectionne.
    if (!manualReconCheck.value) manualReconSource.value = null
  }
  return true
}

/** Pion de résultat de recherche (cf. `moduleRules.searchResults`), posé
 *  sur l'unité `unit`, qu'il suivra (`attachedTo`, cf. `syncSearchMarkers`).
 *  `hidden` : pion "Search" générique, le vrai chit restant caché. */
function searchMarker(result, unit, hidden) {
  const look = moduleRules.searchResults?.[hidden ? 'hidden' : result]
  return { id: `search-${newUid()}`, name: look?.name ?? result, code: look?.name ?? result, type: 'marker',
    faction: 'markers', src: look?.src, col: unit.col, row: unit.row, searchResult: result, attachedTo: String(unit.id) }
}

/** Pion "Sighted" de l'état de repérage `sighting`, posé sur l'unité `unit`
 *  (cf. `moduleRules.sightings`, image selon le camp de l'unité), ou `null`
 *  si cet état n'en pose pas. */
function sightedMarker(sighting, unit) {
  const look = moduleRules.sightings?.[sighting]
  const src = look?.src?.[unit.faction] ?? Object.values(look?.src ?? {})[0]
  if (!src) return null
  return { id: `sighted-${newUid()}`, name: look.name, code: look.name, type: 'marker', faction: 'markers',
    src, col: unit.col, row: unit.row, sighted: sighting, attachedTo: String(unit.id) }
}

// État de repérage de chaque unité explorée (cf. `moduleRules.searchOutcome`)
// : id -> clé de `moduleRules.sightings` ("noContact", "carrierTF"...).
// Rétabli au rejeu par les entrées `search`.
const sightings = ref(new Map())

/** Enregistre l'état de repérage d'une unité et remplace son pion
 *  "Sighted" — en jeu comme au rejeu. */
function applySighting(unitId, sighting, sighted) {
  const key = String(unitId)
  sightings.value = new Map(sightings.value).set(key, sighting)
  counters.value = counters.value.filter((counter) => !(counter.sighted && counter.attachedTo === key))
  if (sighted) counters.value.push({ ...sighted })
}

// Toast du résultat d'une reconnaissance du joueur (cf. Toast.vue).
const reconToast = ref(null)

/** Explore l'unité `unit` depuis la source `source` : tire un chit, pose son
 *  pion sur l'unité, en applique le résultat (état de repérage, pion
 *  "Sighted", leurre retiré du jeu) et l'inscrit au journal. `hidden` : le
 *  chit reste caché au joueur (pion "Search", journal sans le chit ni le
 *  contenu de la tasse), qui reçoit à la place un toast du résultat. Faux
 *  si la tasse est vide. */
function performSearch(unit, source, { hidden = false } = {}) {
  const draw = moduleRules.drawSearch()
  if (!draw) return false
  const marker = searchMarker(draw.result, unit, hidden)
  counters.value.push(marker)
  noteReconUse(source.key)
  const outcome = moduleRules.searchOutcome(draw.result, unit) ?? { sighting: null, removed: false }
  const sighted = outcome.sighting ? sightedMarker(outcome.sighting, unit) : null
  if (outcome.sighting) applySighting(unit.id, outcome.sighting, sighted)
  const sightingLabel = outcome.sighting ? t(`sighting.${outcome.sighting}`) : '—'
  // Un porte-avions du moteur reste anonyme : le nommer trahirait quel
  // leurre le porte. Ceux du joueur sont à découvert.
  const from = source.base ?? (hidden ? source.name : t('log.reconCarrier'))
  const hex = hexId(unit.col + 1, unit.row)
  const side = sideLabel(turnInfo.value.activeSideKey)
  const { detected = 0, misdirect = 0, contactLost = 0 } = draw.bag
  const text = hidden
    ? t('log.searchHidden', { side, from, hex, unit: unit.name, sighting: sightingLabel })
    : t('log.search', { side, from, hex, unit: unit.name, result: marker.name, sighting: sightingLabel, detected, misdirect, contactLost })
  log('search', text, { counter: marker, bag: draw.bag, unitId: String(unit.id), sighting: outcome.sighting, sighted, source: source.key })
  if (outcome.removed) eliminateCounter(unit.id, t('log.dummyUnmasked'))
  if (hidden) {
    reconToast.value = { id: marker.id, text: t(outcome.removed ? 'recon.toastRemoved' : 'recon.toast', { hex, sighting: sightingLabel }) }
  }
  return true
}

/** "Rapport de reconnaissance" du moteur sur l'unité `unitId` (clic droit) :
 *  explore l'unité depuis la source désignée, puis passe à la suivante. */
function reportRecon(unitId) {
  const target = reconTarget.value
  const unit = counters.value.find((counter) => String(counter.id) === String(unitId))
  if (!target || !unit) return
  performSearch(unit, target.source)
  nextTick(continueEngineRecon)
}

// Un résultat de recherche SUIT son unité (`attachedTo`) : il en reprend
// l'hex à chacun de ses déplacements — en jeu, en ligne comme au rejeu — et
// quitte la carte avec elle (éliminée, replacée, sortie). Il ne reçoit
// aucun clic (cf. `.search-marker`) : on sélectionne et déplace l'unité à
// travers lui, comme s'il n'était pas là.
function syncSearchMarkers() {
  const byId = new Map(counters.value.map((counter) => [String(counter.id), counter]))
  const orphaned = counters.value.some((counter) => counter.attachedTo && !byId.has(counter.attachedTo))
  if (orphaned) counters.value = counters.value.filter((counter) => !counter.attachedTo || byId.has(counter.attachedTo))
  for (const marker of counters.value) {
    const unit = marker.attachedTo && byId.get(marker.attachedTo)
    if (unit && (marker.col !== unit.col || marker.row !== unit.row)) { marker.col = unit.col; marker.row = unit.row }
  }
}
watch(() => counters.value.filter((counter) => counter.attachedTo).map((marker) => {
  const unit = counters.value.find((counter) => String(counter.id) === marker.attachedTo)
  return unit ? `${unit.col},${unit.row}` : '-'
}).join('|'), syncSearchMarkers)

// Tours où les chits de recherche reviennent tous dans la tasse (piste de
// tour, cf. `moduleRules.searchChitsReturn`) : leurs pions quittent la
// carte. Déduit du seul tour : vaut aussi au rejeu, sans entrée de journal.
watch(() => turnInfo.value.turn, () => {
  if (!moduleRules.searchChitsReturn(turnTrackerRef.value?.currentTurnInfo)) return
  moduleRules.refillSearchBag()
  if (counters.value.some((counter) => counter.searchResult)) counters.value = counters.value.filter((counter) => !counter.searchResult)
})

// --- Ordre tiré au dé (piste à phases entremêlées, phase `"order": "roll"`
// — cf. lib/turnTrack.js ; le Combat naval de la mer de Corail) : en
// arrivant sur le premier créneau de cette phase, chaque camp lance un dé,
// le plus FAIBLE joue en premier, on relance en cas d'égalité. Le résultat
// part au journal (entrée `rollOrder`), d'où le rejeu et les autres joueurs
// le reprennent (cf. applyReplayEntry). En ligne, seul le camp qui a
// l'initiative du tour lance, pour qu'il n'y ait qu'un tirage ; un
// rechargement qui tombe sur un tirage manquant le refait.
function rollPhaseOrder() {
  const tracker = turnTrackerRef.value
  const slot = tracker?.currentSlot
  if (!slot || slot.side || isReplaying.value || replayLocked.value) return
  if (tracker.rollOrders?.[slot.turn]) return
  const sides = sidesOfTurn(trackConfig, slot.turn)
  if (props.online && props.localSide !== sides[0]) return
  const throws = []
  let rolls
  do {
    rolls = sides.map(() => 1 + Math.floor(Math.random() * 6))
    throws.push(rolls)
  } while (new Set(rolls).size < rolls.length)
  const order = sides.map((side, index) => ({ side, roll: rolls[index] }))
    .sort((sideA, sideB) => sideA.roll - sideB.roll).map((entry) => entry.side)
  tracker.setRollOrder(slot.turn, order)
  const phaseLabel = phaseNameOf(turnStructure.phases?.find((entry) => entry.id === slot.phase)?.step)
  const detail = throws.map((throwRolls) => sides.map((side, index) => `${sideLabel(side)} ${throwRolls[index]}`).join(' / ')).join(t('log.reroll'))
  log('rollOrder', t('log.rollOrder', { phase: phaseLabel, rolls: detail, side: sideLabel(order[0]) }),
    { turn: slot.turn, order, throws })
}
watch([() => turnInfo.value.step, isReplaying], () => nextTick(rollPhaseOrder))

// --- Drag & drop d'un pion : dépose au centre de l'hex le plus proche du curseur ---
const svgRef = ref(null)

// Position courante (coordonnées SVG) du pion suivi par un glisser "souris"
// (cf. onCounterDragStart plus bas) — permet un retour visuel live pendant
// le déplacement, avant que le relâchement ne fixe la case définitive.
const dragCurrentPx = ref(null)

function svgPointFromEvent(ev) {
  const svg = svgRef.value
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  return pt.matrixTransform(svg.getScreenCTM().inverse())
}

function onCounterDragStart(id, ev) {
  // Pendant un rejeu (cf. `replayLocked`), preventDefault() sur `dragstart`
  // annule aussi le glisser natif HTML5 (tablette de soutien, panneau de
  // renforts) — un seul guard couvre donc les deux mécanismes de glisser.
  if (inputLocked.value) { ev?.preventDefault(); return }
  const onMap = counters.value.find((counter) => String(counter.id) === String(id))
  const counter = onMap
    ?? supportTrackerRef.value?.findToken(id)
    ?? allCounters.value.find((counter) => String(counter.id) === String(id))
  // Les pions de soutien (kind: 'support', cf. SupportTracker.vue) sont une
  // ressource commune, pas rattachée à un camp — toujours glissables, que ce
  // soit depuis la tablette ou déjà posés sur la carte, sans passer par
  // canControl (ni par le tour actif).
  if (!isSupport(counter) && !canControl(counter)) { ev?.preventDefault(); return }
  // cf. lib/useAssisted.js::draggable — en mode Assisté, aucun pion ne se
  // glisse : une unité (déjà sur la carte ou en renfort) comme un pion de
  // soutien ne s'y joue qu'au clic (sélection, puis clic sur l'hex de
  // destination — cf. onHex/onCounterSelect/onReinforcementSelect/
  // onSupportSelect plus haut).
  // Exception : à la mise en place, les pions du panneau se glissent sur la
  // carte (pose libre, cf. lib/useAssisted.js, phase "setup").
  const setupDrag = phase.value === PHASE_SETUP && !onMap && !isSupport(counter)
  if (!draggable.value && !setupDrag) { ev?.preventDefault(); return }
  if (setupDrag && !canPlaceReinforcementNow(counter)) { ev?.preventDefault(); return }
  // Un renfort pas encore posé sur la carte ne peut être glissé qu'à partir
  // de son tour d'arrivée (cf. `canEnterThisTurn`) — un pion déjà sur la
  // carte (mouvement) ou un pion de soutien (tablette) n'est pas concerné.
  if (!onMap && !isSupport(counter) && !canEnterThisTurn(counter)) { ev?.preventDefault(); return }
  draggedCounterId.value = id
  // Le pion glissé quitte sa pile : au dépôt, il se retrouverait sous la
  // souris sans nouveau `mouseenter`, avec la pile de son ANCIEN hex.
  hoveredCounter.value = null
  if (ev?.dataTransfer) {
    // Glisser natif HTML5 (pion pas encore sur la carte : <img> de la
    // tablette de soutien ou du panneau "Renfort ...", tous deux hors du
    // <svg>) — le natif gère lui-même survol/dépôt, cf. onMapDrop.
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('text/plain', String(id))
    return
  }
  // Glisser "souris" (pion Counter.vue déjà posé sur la carte, <image> SVG) :
  // le DnD natif HTML5 ne se déclenche jamais de façon fiable sur une <image>
  // SVG (confirmé en test réel ET automatisé — `dragstart` ne part pas malgré
  // draggable="true"), donc on suit nous-mêmes la souris jusqu'au relâchement.
  const loc = svgPointFromEvent(ev)
  if (loc) dragCurrentPx.value = { x: loc.x, y: loc.y }
  window.addEventListener('mousemove', onCounterDragMove)
  window.addEventListener('mouseup', onCounterDragEnd)
}

function onCounterDragMove(ev) {
  const loc = svgPointFromEvent(ev)
  if (loc) dragCurrentPx.value = loc
}

function onCounterDragEnd(ev) {
  window.removeEventListener('mousemove', onCounterDragMove)
  window.removeEventListener('mouseup', onCounterDragEnd)
  const loc = svgPointFromEvent(ev) ?? dragCurrentPx.value
  dragCurrentPx.value = null
  const id = draggedCounterId.value
  draggedCounterId.value = null
  if (!loc || id == null) return
  const hex = pixelToHex(loc.x, loc.y)
  if (!hex) return
  const counter = counters.value.find((counter) => String(counter.id) === String(id))
  // Un simple clic (mousedown puis mouseup sans déplacement réel, cf.
  // Counter.vue::onClick pour la sélection) retombe ici aussi — on n'émet
  // `move` que si la case a réellement changé, pour ne pas spammer le réseau
  // à chaque clic de sélection en partie multijoueur.
  if (counter && (counter.col !== hex.col || counter.row !== hex.row)) {
    const fromLabel = hexId(counter.col + 1, counter.row)
    const from = { col: counter.col, row: counter.row }
    counter.col = hex.col; counter.row = hex.row
    emit('move', { counterId: counter.id, col: counter.col, row: counter.row })
    const journalId = log(isSupport(counter) ? 'support' : 'move', t('log.moved', { unit: counter.name, from: fromLabel, to: hexId(counter.col + 1, counter.row) }), { counterId: counter.id, col: counter.col, row: counter.row })
    pushMoveHistory(counter.id, from, { col: counter.col, row: counter.row }, journalId)
    if (!isSupport(counter)) markMoved(counter.id, from)
  }
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onCounterDragMove)
  window.removeEventListener('mouseup', onCounterDragEnd)
})

/** Convertit un point en coordonnées SVG vers l'hex logique le plus proche —
 *  cherche dans une fenêtre de 3×3 hex autour de l'estimation initiale (la
 *  grille hexagonale n'a pas de correspondance x/y → col/row directe). */
function pixelToHex(svgX, svgY) {
  const { x0, y0, colStep, rowStep } = calibration
  const c0 = Math.round((svgX - x0) / colStep)
  let best = null, dmin = Infinity
  for (let col = c0 - 1; col <= c0 + 1; col++) {
    if (col < 0 || col >= mapConfig.cols) continue
    const yoff = col % 2 === 1 ? rowStep / 2 : 0
    const r0 = Math.round((svgY - y0 - yoff) / rowStep) + 1
    for (let row = r0 - 1; row <= r0 + 1; row++) {
      if (!hexOnMap(col, row)) continue
      const cx = x0 + col * colStep
      const cy = y0 + (row - 1) * rowStep + yoff
      const distance = Math.hypot(cx - svgX, cy - svgY)
      if (distance < dmin) { dmin = distance; best = { col: col, row: row } }
    }
  }
  return best
}

function onMapDrop(ev) {
  if (inputLocked.value) return
  const svg = svgRef.value
  if (!svg || draggedCounterId.value == null) return
  const pt = svg.createSVGPoint()
  pt.x = ev.clientX; pt.y = ev.clientY
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse())
  const hex = pixelToHex(loc.x, loc.y)
  if (hex) {
    // Un pion déjà posé sur la carte emprunte désormais le glisser "souris"
    // (cf. onCounterDragEnd), qui ne passe pas par l'événement natif `drop` —
    // on n'arrive ici que pour un pion pas encore sur la carte : renfort
    // glissé depuis le panneau "Renfort ..." (glisser-déposer libre, système
    // 1, cf. entrée en jeu dans le commentaire de `entryHexSet`) ou pion de
    // soutien tiré de la tablette (cf. SupportTracker.vue::findToken — le
    // poser sur la carte suffit à l'en retirer).
    const reinforcement = allCounters.value.find((counter) => String(counter.id) === String(draggedCounterId.value))
    // Mode Assisté (mise en place) : camp actif, et phase qui l'autorise.
    const allowed = reinforcement && canEnterThisTurn(reinforcement)
      && (!props.assisted || (canControl(reinforcement) && canPlaceReinforcementNow(reinforcement)))
    if (allowed) {
      const placed = { ...withMapExit(instanceOf(reinforcement)), ...hex }
      counters.value.push(placed)
      noteMapEntry(placed.id)
      emit('move', { counterId: placed.id, col: placed.col, row: placed.row })
      log('place', t('log.enters', { unit: placed.name, hex: hexId(placed.col + 1, placed.row) }),
        { counterId: placed.id, col: placed.col, row: placed.row })
    } else {
      const token = supportTrackerRef.value?.findToken(draggedCounterId.value)
      if (token) {
        const placed = { ...token, ...hex }
        counters.value.push(placed)
        emit('move', { counterId: placed.id, col: placed.col, row: placed.row })
        // Les pions de soutien sont créés à la volée (cf. SupportTracker.vue),
        // pas déclarés dans `allCounters` — contrairement à un renfort normal,
        // le rejeu ne peut pas les retrouver par id : on embarque l'objet
        // complet dans `data.counter` pour pouvoir le recréer (cf.
        // applyReplayEntry plus bas).
        log('support', t('log.supportPlaced', { unit: placed.name, hex: hexId(placed.col + 1, placed.row) }),
          { counterId: placed.id, col: placed.col, row: placed.row, counter: placed })
      }
    }
  }
  draggedCounterId.value = null
}

/** Applique un déplacement reçu d'un autre joueur (WebSocket) — ne réémet
 *  pas `move` pour éviter une boucle avec le serveur. */
function applyRemoteMove(counterId, col, row, enteredFrom) {
  const counter = counters.value.find((counter) => String(counter.id) === String(counterId))
  if (counter) {
    const from = { col: counter.col, row: counter.row }
    const previousEntry = counter.enteredFrom ?? null
    counter.col = col; counter.row = row
    // Côté d'entrée : celui du journal quand il le porte (une annulation de
    // mouvement le rétablit tel qu'il était), sinon déduit du pas effectué.
    // En ligne, le même pas arrive deux fois (évènement `move`, puis l'entrée
    // du journal partagé) : celle du journal fait foi même sans changement
    // de position.
    if (enteredFrom !== undefined) counter.enteredFrom = enteredFrom
    else if (from.col !== col || from.row !== row) counter.enteredFrom = entryFromMove(from, { col, row })
    if (!isSupport(counter) && (from.col !== col || from.row !== row)) markMoved(counter.id, from, previousEntry)
    return
  }
  // Un autre joueur a posé un renfort pas encore présent localement (glissé
  // depuis son propre panneau "Renfort alliés") : on l'ajoute.
  const reinforcement = counterDefinition(counterId)
  if (!reinforcement) return
  counters.value.push({ ...withMapExit(reinforcement), col, row })
  noteMapEntry(counterId)
}

/** Multijoueur : un camp a perdu, au temps ou en concédant (cf.
 *  RoomLobby.vue, `game:over`). */
function applyRemoteGameOver(loser, reason) {
  declareLoss(loser, { remote: true, reason })
}

/** En ligne : entrée du journal partagé reçue d'un autre joueur (ou du
 *  serveur). Ajoutée au journal (sauf doublon, cf. `uid`) PUIS appliquée à
 *  la carte comme au rejeu — c'est ce qui synchronise ce que les seuls
 *  évènements `move`/`turn`/`phase` ne transmettent pas (éliminations,
 *  retours aux renforts, unités ayant combattu, MP dépensés, déploiement). */
function applyRemoteEntry(entry) {
  if (!entry || !journalRef.value?.appendRemote(entry)) return
  applyReplayEntry(entry)
}

/** En ligne : entrée retirée par un autre joueur (retour arrière). */
function removeRemoteEntry(uid) {
  journalRef.value?.removeByUid(uid)
}

/** Aligne pas courant, phase, pendules et fin de partie sur l'état du
 *  serveur (`toPublic`, cf. server/src/rooms.js) — au montage (props) comme
 *  après une reconnexion (cf. resyncFromServer). */
function applyServerState({ turnStep, phase: serverPhase, phaseElapsedMs, blitzUsedMs: serverBlitz, blitzLoser: serverLoser, gameOverReason: serverReason, fpfRequest }) {
  if (turnTrackerRef.value && turnStep != null && turnTrackerRef.value.currentStep !== turnStep) applyRemoteTurn(turnStep)
  // Phase déjà atteinte par le joueur actif (cf. server/src/rooms.js::
  // recordPhase) — `null` : phase de départ du camp, déjà recalculée.
  if (serverPhase != null) setPhase(serverPhase)
  // Compteurs des timings "Limité"/"Blitz" repris là où ils en étaient (le
  // temps écoulé depuis le chargement n'est pas décompté deux fois).
  moveTimerStartedAt.value = null
  syncMoveTimer(phaseElapsedMs ?? 0)
  blitzUsedMs.value = { ...(serverBlitz ?? {}) }
  if (serverLoser) declareLoss(serverLoser, { remote: true, reason: serverReason })
  // Négociation de FPF en cours (cf. section "FPF en ligne").
  restoreFpfRequest(fpfRequest)
}

/** En ligne : décisions déjà prises sur les ponts et occasion encore en
 *  attente, telles que le serveur les tient (cf. server/src/rooms.js, section
 *  "Sort des ponts en ligne"). Appliquées au montage et à chaque
 *  resynchronisation, DANS L'ORDRE — un pont démoli puis relevé doit finir
 *  relevé, pas l'inverse. */
function restoreBridges(settled, request) {
  for (const result of settled ?? []) {
    if (result?.kind === 'repair') demolition.applyRepairReplay(result)
    else demolition.applyReplay(result)
  }
  if (request) applyRemoteBridgeRequest(request)
}

/** En ligne, après une RECONNEXION : le serveur fait foi. Le journal partagé
 *  complet est rejoué depuis le déploiement (cf. startSharedJournal), ce qui
 *  rattrape à la fois les entrées manquées pendant la coupure ET celles que
 *  l'adversaire a retirées entre-temps (retour arrière) — un simple ajout des
 *  entrées manquantes laissait ces dernières dans le journal local. Ce que ce
 *  navigateur a pu jouer HORS LIGNE n'a jamais atteint le serveur : c'est
 *  abandonné, pour rester aligné sur les autres joueurs. `room` : l'état
 *  courant renvoyé par le serveur (pas, phase, pendules, fin de partie). */
function resyncFromServer(list, room) {
  startSharedJournal(list ?? [])
  applyServerState(room ?? {})
  // Ponts tranchés pendant la coupure, et occasion restée en attente (cf.
  // restoreBridges).
  restoreBridges(room?.bridgeLog, room?.bridgeRequest)
}

defineExpose({ applyRemoteMove, applyRemoteTurn, applyRemotePhase, applyRemoteGameOver, applyRemoteEntry, removeRemoteEntry, resyncFromServer,
  applyRemoteFpfRequest, applyRemoteFpfReply, applyRemoteFpfCancel,
  applyRemoteBridgeRequest, applyRemoteBridge })

/** Reçoit le journal chargé (cf. JournalPanel.vue, évènement `loaded`) en
 *  ordre chronologique et remet la carte au déploiement initial pour
 *  rejouer depuis la première ligne. */
function onJournalLoaded(list) {
  // Le journal chargé porte son propre déploiement (ou n'en a pas, s'il est
  // antérieur à cet ajout) : celui de la partie ouverte ne doit plus être
  // ajouté par-dessus.
  deploymentLogged = true
  replayEntries.value = list
  replayIndex.value = 0
  resetBoardForReplay()
}

function resetBoardForReplay() {
  isReplaying.value = true
  // Pendules "Blitz" à zéro et partie en cours : rétablies par les entrées
  // `phase` et `gameover` rejouées.
  blitzUsedMs.value = {}
  blitzLoser.value = null
  gameOverReason.value = null
  showGameEnd.value = false
  counters.value = buildInitialCounters()
  // Tasse de recherche pleine, aucun repérage : rétablis par les entrées
  // `search` rejouées.
  moduleRules.refillSearchBag()
  sightings.value = new Map()
  reconUses.value = new Map()
  autoMoveTrails.value = new Map()
  eliminatedIds.value = new Set()
  // Sorties de carte (cf. la section du même nom) : rétablies par les entrées
  // `exit` rejouées.
  exitedUnits.value = new Map()
  // Unités reconstituées (cf. `rebuiltUnits`) : rétablies par les entrées
  // `eliminate` rejouées.
  rebuiltUnits.value = new Map()
  selectedCounterId.value = null
  selectedReinforcementId.value = null
  moveHistory.value = []
  clearAllMoved()
  clearRetreat()
  // Mémoire de l'artillerie (résultats subis, refoulements, FPF) : rétablie
  // par les entrées rejouées.
  artillery.reset()
  // Ponts détruits ou définitivement épargnés : rétablis par les entrées
  // `demolition` rejouées (cf. lib/useBridges.js::applyReplay).
  demolition.reset()
  closeDemolitionResult()
  // Points de victoire : rétablis par les entrées `victory` rejouées.
  victory.reset()
  victoryNotice.value = []
  closeRepairResult()
  // Un combat resté ouvert n'a plus de sens sur un plateau remis à zéro.
  cancelCombat()
  turnTrackerRef.value?.applyRemoteTurn(0)
  // Ordres tirés au dé (cf. `rollPhaseOrder`) : rétablis par les entrées
  // `rollOrder` rejouées.
  turnTrackerRef.value?.clearRollOrders?.()
  // Phase Mouvement, aucun MP dépensé, aucune congestion d'entrée — et, par
  // le retour en phase 0, plus aucune unité "ayant combattu" ni combat
  // ouvert (cf. lib/useCombat.js, watcher de `phase`). Nécessaire même si
  // le pas 0 était déjà le pas courant (le watcher de tour ne se déclenche
  // alors pas).
  resetTurnState()
  nextTick(() => { isReplaying.value = false })
}

/** Applique une entrée de journal à la carte — même logique que la synchro
 *  multijoueur (`applyRemoteMove`/`applyRemoteTurn`), qui ne réémet ni ne
 *  journalise rien : rejouer une ligne ne fait bouger que la carte. En plus
 *  des positions, le rejeu rétablit l'état de la phase en cours (utile pour
 *  une sauvegarde faite en plein tour) :
 *   - `move`/`place` : MP déjà dépensés par l'unité (`d.mp`, total absolu,
 *     cf. lib/useAssisted.js::setSpentMp) et, pour une entrée en jeu qui a
 *     payé un coût d'entrée (`d.entry`), la congestion de l'hex. Une unité
 *     qui a bougé (`move`) est de plus VERROUILLÉE : elle ne peut plus être
 *     sélectionnée une fois le journal rechargé (cf. `lockedFromSelectionIds`) ;
 *   - `phase` : phase en cours (cf. lib/useAssisted.js::setPhase) ;
 *   - `combat` : unités ayant combattu (cf. lib/useCombat.js::markFought),
 *     FPF faits et résultats subis par l'artillerie (cf.
 *     lib/useArtillery.js::applyCombat) ;
 *   - `retreat` : artillerie refoulée par une retraite amie (`d.noFire`,
 *     cf. lib/useArtillery.js::markDisplaced).
 *  Les champs absents (journaux enregistrés avant cet ajout) sont ignorés. */
function applyReplayEntry(entry) {
  const entryData = entry.data
  if (!entryData) return
  if (entry.kind === 'setup') {
    // Déploiement initial (cf. `logDeploymentOnce`) : on remet chaque pion
    // de départ exactement où il était, à la place du nouveau tirage fait
    // par resetBoardForReplay.
    for (const position of entryData.positions ?? []) {
      const counter = counters.value.find((counter) => String(counter.id) === String(position.id))
      if (counter) { counter.col = position.col; counter.row = position.row }
    }
    moduleRules.restoreSetupSecrets(entryData.secrets)
  } else if (entry.kind === 'move' || entry.kind === 'place') {
    applyRemoteMove(entryData.counterId, entryData.col, entryData.row, entryData.enteredFrom)
    // Journal enregistré AVANT l'ajout de la phase Airborne (pas d'entrée
    // `phase` Airborne -> Mouvement) : un déplacement prouve qu'on était en
    // Mouvement.
    if (entry.kind === 'move' && phase.value === PHASE_AIRBORNE) setPhase(0)
    if (entry.kind === 'move') {
      const key = String(entryData.counterId)
      const start = turnStartPositions.get(key)
      if (start && start.col === entryData.col && start.row === entryData.row) {
        // Revenu à sa position de début de tour ("Annuler le mouvement", cf.
        // cancelMovement) : comme en jeu, il n'a de fait plus bougé.
        clearMoved(key)
      } else if (movedThisTurnIds.value.has(key)) {
        // Unité qui a bougé ce tour-ci : son mouvement est considéré comme
        // TERMINÉ au rechargement, elle ne peut plus être sélectionnée (cf.
        // `lockedFromSelectionIds`) — en jeu, ce verrou n'est posé qu'à sa
        // désélection, que le journal n'enregistre pas.
        lockedFromSelectionIds.value = new Set(lockedFromSelectionIds.value).add(key)
      }
    }
    if (entry.kind === 'place' && entryData.entry) {
      const placed = counters.value.find((counter) => String(counter.id) === String(entryData.counterId))
      if (placed) spendEntryCost(placed, { c: entryData.col, r: entryData.row })
    }
    if (entry.kind === 'place') {
      // Mémoire "a atterri ce tour-ci" des règles du module (cf.
      // lib/useArnhem.js::noteAirborneArrival) : à rétablir, sinon un
      // "Annuler le mouvement" fait APRÈS le rejeu rendrait à l'aéroporté
      // son allocation pleine. Les MP dépensés, eux, ne sont PAS recalculés
      // ici : c'est la valeur du journal, juste en dessous, qui fait foi.
      const placed = counters.value.find((counter) => String(counter.id) === String(entryData.counterId))
      if (placed) moduleRules.noteAirborneArrival(placed)
    }
    // Après `spendEntryCost` : la valeur du journal fait foi (elle inclut
    // déjà le coût d'entrée payé à l'époque).
    setSpentMp(entryData.counterId, entryData.mp)
  } else if (entry.kind === 'retreat' || entry.kind === 'advance') {
    // Un pas de retraite ou d'avance après combat (cf. lib/useRetreat.js) :
    // simple changement de position — ni liseré "a bougé", ni MP (cf.
    // `moveUnit`/`advanceUnit` dans l'appel à useRetreat plus haut).
    const counter = counters.value.find((counter) => String(counter.id) === String(entryData.counterId))
    if (counter) { counter.col = entryData.col; counter.row = entryData.row }
    // Artillerie refoulée par une retraite amie : plus de tir pendant cette
    // phase de Combat (point orange, cf. lib/useArtillery.js).
    if (entryData.noFire) artillery.markDisplaced(entryData.counterId)
  } else if (entry.kind === 'phase') {
    setPhase(entryData.phase)
    if (entryData.blitzUsed) blitzUsedMs.value = { ...entryData.blitzUsed }
  } else if (entry.kind === 'gameover') {
    blitzLoser.value = entryData.loser ?? null
    // Journaux antérieurs à la concession : seule la pendule mettait fin à
    // la partie.
    gameOverReason.value = entryData.reason === 'concede' ? 'concede' : 'blitz'
  } else if (entry.kind === 'combat') {
    markFought([...(entryData.attackerIds ?? []), ...(entryData.defenderIds ?? []), ...(entryData.supportIds ?? [])])
    // FPF faits et résultats subis par l'artillerie (cf. lib/useArtillery.js).
    artillery.applyCombat(entryData)
  } else if (entry.kind === 'support') {
    if (counters.value.some((counter) => String(counter.id) === String(entryData.counterId))) {
      applyRemoteMove(entryData.counterId, entryData.col, entryData.row)
    } else if (entryData.counter) {
      counters.value.push({ ...entryData.counter, col: entryData.col, row: entryData.row })
    }
  } else if (entry.kind === 'eliminate') {
    // Même chemin qu'en jeu (cf. `noteElimination`) : un pion que la règle du
    // module fait revenir se retrouve dans les renforts, pas chez les morts.
    noteElimination(entryData.counterId)
  } else if (entry.kind === 'victory') {
    // Points de victoire (cf. la section du même nom) : le TOTAL de l'entrée
    // fait foi, jamais un recalcul — sinon une partie rechargée, ou l'entrée
    // reçue d'un autre joueur, compterait deux fois. Une entrée de Fin de
    // tour marque ce tour comme soldé (cf. `scoreEndOfTurn`) ; pour un
    // journal antérieur à `endOfTurn`, une entrée rejouée PENDANT la Fin de
    // tour en est forcément une.
    victory.applyReplay(entryData, {
      turn: entryData.turn ?? currentTurnNumber(),
      endOfTurn: entryData.endOfTurn ?? phase.value === PHASE_END_OF_TURN,
    })
  } else if (entry.kind === 'repair') {
    // Pont relevé par le génie (cf. la section "Réparation des ponts") : le
    // journal fait foi, comme pour une démolition.
    demolition.applyRepairReplay(entryData)
  } else if (entry.kind === 'demolition') {
    // Démolition d'un pont (cf. la section du même nom) : c'est le JOURNAL
    // qui fait foi, jamais un nouveau tirage — le pont est détruit, ou
    // définitivement épargné, exactement comme dans la partie d'origine.
    demolition.applyReplay(entryData)
  } else if (entry.kind === 'exit') {
    // Sortie de carte (cf. la section du même nom) : le pion quitte la carte
    // et redevient un renfort de sa bande de sortie, avec les MP qu'il y a
    // laissés.
    counters.value = counters.value.filter((counter) => String(counter.id) !== String(entryData.counterId))
    exitedUnits.value = new Map(exitedUnits.value).set(String(entryData.counterId), { zone: entryData.zone, turn: entryData.turn })
    setSpentMp(entryData.counterId, entryData.mp)
  } else if (entry.kind === 'support-return') {
    // Pion de soutien replacé (cf. returnSupportToTray) : le retirer de la
    // carte suffit, la tablette se déduit de la carte.
    const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(entryData.counterId))
    if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
  } else if (entry.kind === 'return') {
    const counterIndex = counters.value.findIndex((counter) => String(counter.id) === String(entryData.counterId))
    if (counterIndex !== -1) counters.value.splice(counterIndex, 1)
    eliminatedIds.value.delete(String(entryData.counterId))
    eliminatedIds.value = new Set(eliminatedIds.value)
  } else if (entry.kind === 'search') {
    // Résultat de recherche (cf. `reportRecon`) : le pion tiré, et ce qui
    // reste dans la tasse — le journal fait foi, jamais un nouveau tirage.
    if (entryData.counter && !counters.value.some((counter) => String(counter.id) === String(entryData.counter.id))) {
      counters.value.push({ ...entryData.counter })
    }
    moduleRules.restoreSearchBag(entryData.bag)
    if (entryData.source) noteReconUse(entryData.source)
    // État de repérage et pion "Sighted" (le leurre démasqué, lui, part
    // avec l'entrée `eliminate` qui suit).
    if (entryData.unitId && entryData.sighting) applySighting(entryData.unitId, entryData.sighting, entryData.sighted)
  } else if (entry.kind === 'rollOrder') {
    // Ordre de jeu d'une phase tirée au dé (cf. `rollPhaseOrder`).
    turnTrackerRef.value?.setRollOrder(entryData.turn, entryData.order)
  } else if (entry.kind === 'turn') {
    turnTrackerRef.value?.applyRemoteTurn(entryData.step)
    // Nouveau tour/camp : plus aucune unité "a bougé" ni verrouillée — fait
    // ICI, tout de suite, et non dans onTurnChange (différé, cf. son
    // commentaire), pour que les `move` rejoués juste après restent marqués.
    clearAllMoved()
  }
}

/** Bouton lecture (▶) : avance d'une ligne — l'entrée réapparaît dans le
 *  journal (cf. JournalPanel.vue::revealEntry) en même temps qu'elle bouge
 *  la carte. */
function stepReplay() {
  if (replayIndex.value >= replayEntries.value.length) return
  isReplaying.value = true
  const entry = replayEntries.value[replayIndex.value]
  applyReplayEntry(entry)
  journalRef.value?.revealEntry(entry)
  replayIndex.value += 1
  nextTick(() => { isReplaying.value = false })
}

/** Bouton avance rapide (⏭) : applique toutes les lignes restantes d'un coup. */
function fastForwardReplay() {
  if (replayIndex.value >= replayEntries.value.length) return
  isReplaying.value = true
  while (replayIndex.value < replayEntries.value.length) {
    const entry = replayEntries.value[replayIndex.value]
    applyReplayEntry(entry)
    journalRef.value?.revealEntry(entry)
    replayIndex.value += 1
  }
  nextTick(() => { isReplaying.value = false })
}

// Vrai tant qu'un journal chargé n'a pas été entièrement rejoué (cf.
// stepReplay/fastForwardReplay) — bloque alors toute action de jeu (cf.
// guards dans onHex/onCounterDragStart/onMapDrop/sélections/menu contextuel
// plus haut, et props `disabled` sur TurnTracker/RollModal ci-dessous) :
// la carte ne doit bouger qu'au rythme du lecteur pendant un rejeu.
const replayLocked = computed(() => replayEntries.value.length > 0 && replayIndex.value < replayEntries.value.length)
// Camp qui a PERDU la partie — pendule tombée à 0 en Blitz, ou concession
// (cf. declareLoss, `gameOverReason`) —, `null` tant que la partie continue.
// Le nom vient du Blitz, premier cas de fin de partie (le serveur le garde).
const blitzLoser = ref(null)
// Ce qui a mis fin à la partie quand `blitzLoser` est renseigné : 'blitz' ou
// 'concede'.
const gameOverReason = ref(null)
// La PARTIE est figée pendant un rejeu et une fois terminée : plus aucune
// action de jeu, et les pendules du timing s'arrêtent (cf. moveTimerRunning).
const actionsLocked = computed(() => replayLocked.value || blitzLoser.value != null)
// La SAISIE de ce navigateur est bloquée dans ces mêmes cas, PLUS, en ligne,
// tant que ce n'est pas à son joueur de jouer (cf. `isLocalTurn`) : il ne
// peut alors ni sélectionner, ni déplacer, ni éliminer, ni replacer un pion,
// quel qu'en soit le camp — ni faire avancer tour ou phase. C'est la garde
// de TOUTES les entrées utilisateur (clics, glisser-déposer, menus, boutons,
// dé). Distincte de `actionsLocked` : chez le joueur qui attend, la partie
// continue (pendule de l'adversaire, synchro), seule sa saisie est fermée.
// Le serveur applique la même règle de son côté (cf. server/src/rooms.js::
// isPlayersTurn) : ce verrou-ci n'est que le confort de l'interface.
// Une occasion de démolition ouverte ferme elle aussi la saisie (cf. la
// section "Démolition des ponts") : la règle veut une décision immédiate, et
// rien d'autre ne doit pouvoir se faire tant qu'elle n'est pas prise.
// Temps de la phase de Mouvement écoulé (timing "Limité" seulement, cf.
// `onMoveTimeUp`) : posé à l'expiration du compte à rebours, levé au
// changement de phase ou de pas.
const moveTimeExpired = ref(false)

/** Le mouvement est-il fermé parce que le temps est écoulé ? Seulement
 *  pendant la phase de Mouvement, bien sûr — et seulement une fois les
 *  empilements résolus : `onPhaseNext` refuse de quitter la phase tant que
 *  deux unités amies partagent un hex, si bien qu'un joueur pris par le temps
 *  au milieu d'une pile ne pourrait NI la défaire NI passer au Combat. Cette
 *  soupape lui laisse de quoi se dégager ; le verrou retombe dès que c'est
 *  fait. */
const moveTimeLocked = computed(() => moveTimeExpired.value && phase.value === 0
  && stackedHexes.value.length === 0)

// Deux verrous, et non un seul, depuis que le timing "Limité" arrête le
// mouvement (cf. `moveTimeLocked` juste au-dessus) : celui-là interdit de
// BOUGER mais doit laisser passer à la phase suivante — c'est même tout ce
// qu'il reste à faire. `phaseControlsLocked` est donc ce qui ferme AUSSI la
// piste de tour, et `inputLocked`, qui lui ajoute le temps écoulé, reste la
// garde de toutes les autres entrées.
const phaseControlsLocked = computed(() => actionsLocked.value || (props.online && !isLocalTurn.value)
  || demolitionBridge.value != null || repairTarget.value != null)
const inputLocked = computed(() => phaseControlsLocked.value || moveTimeLocked.value)

// --- Timings "Limité" et "Blitz" (cf. lib/gameSettings.js, MoveTimer.vue).
// Toutes les phases sont conservées : SEULE la phase Mouvement (phase 0) est
// chronométrée — ni Airborne, ni Combat, ni Fin de tour. Sans phases (mode
// Libre, `phase === null`), il n'y a pas de phase Mouvement : pas de
// compteur. Jamais pendant un rejeu de journal.
//  - Limité : la durée saisie (minutes) vaut pour CHAQUE phase de Mouvement,
//    le compteur repart à plein à chaque fois.
//  - Blitz (pendule d'échecs) : la durée saisie est le temps TOTAL de chaque
//    camp pour toutes ses phases de Mouvement. Le temps passé dans chacune
//    s'additionne dans `blitzUsedMs` ; la pendule d'un camp démarre au début
//    de sa phase de Mouvement et s'arrête dès le changement de phase.
const timingMode = computed(() => props.settings?.timing)
const moveTimerSeconds = computed(() =>
  timingMode.value === 'limite' || timingMode.value === 'blitz' ? (Number(props.settings.timingValue) || 0) * 60 : 0)
const isBlitz = computed(() => timingMode.value === 'blitz' && moveTimerSeconds.value > 0)
const moveTimerRunning = computed(() =>
  moveTimerSeconds.value > 0 && !actionsLocked.value && phase.value === 0)
const turnOrder = props.module.turnTrack?.order ?? []
// Piste de tour complétée de ses créneaux si elle entremêle les phases (cf.
// lib/turnTrack.js::resolveTrack) — celle que reçoit TurnTracker.vue.
const trackConfig = resolveTrack(props.module)
// Camp actif lu directement sur TurnTracker.vue : `turnInfo` n'est mis à
// jour qu'en différé (évènement `change`), trop tard pour syncMoveTimer.
// L'initiative peut changer d'un tour à l'autre (cf. lib/turnTrack.js).
function currentSideKey() {
  const step = turnTrackerRef.value?.currentStep ?? props.initialTurnStep
  return sideOfStep(trackConfig, step, turnTrackerRef.value?.rollOrders)
}
// Heure de début de la phase de Mouvement en cours (ms) et camp dont la
// pendule tourne ; `null` hors de cette phase.
const moveTimerStartedAt = ref(null)
const moveTimerSide = ref(null)
// Blitz : temps de Mouvement déjà consommé par camp, `{ [campKey]: ms }`.
const blitzUsedMs = ref({})
/** Arrête le compteur en cours (en ajoutant, en Blitz, le temps passé à la
 *  pendule de son camp) puis le relance si une phase de Mouvement est en
 *  cours. `elapsedMs` : temps déjà écoulé dans cette phase (reprise en
 *  ligne, cf. onMounted). */
function syncMoveTimer(elapsedMs = 0) {
  const now = Date.now()
  const side = moveTimerSide.value
  if (moveTimerStartedAt.value != null && side != null) {
    blitzUsedMs.value = { ...blitzUsedMs.value, [side]: (blitzUsedMs.value[side] ?? 0) + (now - moveTimerStartedAt.value) }
  }
  moveTimerStartedAt.value = moveTimerRunning.value ? now - elapsedMs : null
  moveTimerSide.value = moveTimerRunning.value ? currentSideKey() : null
}
// Synchrone : la pendule doit être à jour dès le retour de `advance()` (cf.
// onPhaseNext, qui l'envoie aussitôt aux autres joueurs).
watch([moveTimerRunning, () => turnTrackerRef.value?.currentStep], () => syncMoveTimer(), { flush: 'sync' })
const showTimeUp = ref(false)
// Modale de fin de partie (cf. GameEndModal.vue, `gameEnd`) et demande de
// confirmation d'une concession (cf. `askConcede`).
const showGameEnd = ref(false)
const concedeConfirm = ref(false)
const sideLabel = (side) => mt(props.module.turnTrack?.sides?.[side]?.label) ?? side
/** Compteur à zéro (cf. MoveTimer.vue, `expired`). Blitz : le camp `side`
 *  PERD la partie. Limité : le MOUVEMENT S'ARRÊTE (cf. `moveTimeLocked`) —
 *  plus de déplacement, d'entrée de renfort ni de retour arrière, il ne reste
 *  qu'à passer à la phase suivante. L'alerte, elle, n'est montrée qu'au
 *  joueur actif : en ligne, chaque navigateur a son compteur, mais seul celui
 *  dont c'est le tour a quelque chose à en faire. */
function onMoveTimeUp(side) {
  if (isBlitz.value) { declareLoss(side); return }
  moveTimeExpired.value = true
  if (isLocalTurn.value) showTimeUp.value = true
}
/** Fin de partie : `loser` a perdu — au temps (Blitz, `reason` 'blitz') ou
 *  en concédant ('concede', cf. `concede`). La modale de fin (cf.
 *  GameEndModal.vue) s'affiche chez TOUS les joueurs.
 *  - En local : inscrite au journal.
 *  - En ligne : annoncée au serveur ; seule la PREMIÈRE annonce compte, le
 *    serveur l'inscrit lui-même au journal partagé et la renvoie à tous
 *    (`remote` : annonce du serveur, qui fait foi et peut corriger une
 *    détection locale de la pendule). */
function declareLoss(loser, { remote = false, reason = 'blitz' } = {}) {
  if (!loser || blitzLoser.value === loser) return
  if (blitzLoser.value != null && !remote) return
  blitzLoser.value = loser
  gameOverReason.value = reason === 'concede' ? 'concede' : 'blitz'
  const text = t(gameOverReason.value === 'concede' ? 'log.conceded' : 'log.timeUp', { side: sideLabel(loser) })
  if (!remote) {
    if (props.online) emit('game-over', { loser, text, t: new Date().toLocaleTimeString('fr-FR'), reason: gameOverReason.value })
    else log('gameover', text, { loser, reason: gameOverReason.value })
  }
  showGameEnd.value = true
}

// --- Concession et fin de partie (cf. GameEndModal.vue) ----------------------
// Un camp peut CONCÉDER à tout moment : la partie s'arrête, son adversaire
// l'emporte. Concède : en ligne, le camp de CE joueur (même quand ce n'est
// pas son tour) ; en local, un seul navigateur pour tous les camps, le camp
// qui a la main. La partie s'arrête aussi quand la Fin de tour du DERNIER
// tour de la piste est atteinte : victoire aux points.

/** Camp qui concéderait depuis ce navigateur (cf. l'en-tête de section). */
const concedingSide = computed(() => (props.online ? props.localSide : turnInfo.value.activeSideKey) || null)

/** Fin de tour du DERNIER tour de la piste (cf. `startVictoryWatch`). */
const isFinalEndOfTurn = computed(() => {
  const turns = props.module.turnTrack?.turns
  return !!turns && phase.value === PHASE_END_OF_TURN && currentTurnNumber() >= turns
})

/** La partie est-elle terminée — par une défaite (Blitz, concession) ou par
 *  la fin du dernier tour ? `{ reason, winner, loser }` (libellés de camp ;
 *  `winner` `null` pour un match nul), ou `null` si elle continue. */
const gameEnd = computed(() => {
  if (blitzLoser.value) {
    const winner = turnOrder.find((side) => side !== blitzLoser.value)
    return { reason: gameOverReason.value ?? 'blitz', winner: winner ? sideLabel(winner) : null, loser: sideLabel(blitzLoser.value) }
  }
  if (!isFinalEndOfTurn.value) return null
  // Victoire aux points. Le module déclare ses paliers (cf.
  // useVictoryPoints.js::outcome — rapport des totaux, victoire stratégique
  // ou tactique) : ils font foi. Sinon, le camp qui a le plus de points, ou
  // match nul.
  const outcome = victory.outcome.value
  if (outcome) return { reason: 'end', winner: outcome.winner ? sideLabel(outcome.winner) : null, loser: null, level: outcome.level }
  const scores = victory.scores.value
  const ranked = [...turnOrder].sort((sideA, sideB) => (scores[sideB] ?? 0) - (scores[sideA] ?? 0))
  const tie = ranked.length > 1 && (scores[ranked[0]] ?? 0) === (scores[ranked[1]] ?? 0)
  return { reason: 'end', winner: ranked.length && !tie ? sideLabel(ranked[0]) : null, loser: null }
})

/** Résultat aux points, pour les modales de fin et de concession (cf.
 *  GameEndModal.vue, `outcome`) : libellés des deux camps comparés, leurs
 *  totaux, le rapport et ce qu'il donne — ou `null` si le module ne déclare
 *  aucun palier (cf. useVictoryPoints.js::outcome). Une concession ou une
 *  pendule Blitz reste une défaite : ce résultat n'y est qu'indicatif. */
const victoryOutcome = computed(() => {
  const outcome = victory.outcome.value
  if (!outcome) return null
  const scores = victory.scores.value
  return {
    of: sideLabel(outcome.of), to: sideLabel(outcome.to),
    pointsOf: scores[outcome.of] ?? 0, pointsTo: scores[outcome.to] ?? 0,
    ratio: outcome.ratio,
    winner: outcome.winner ? sideLabel(outcome.winner) : null,
    level: outcome.level,
  }
})

/** Bouton "Concéder la partie" : demande d'abord confirmation. */
function askConcede() {
  if (actionsLocked.value || !concedingSide.value) return
  concedeConfirm.value = true
}

/** Confirmation de la concession (cf. GameEndModal.vue, mode `confirm`). */
function concede() {
  concedeConfirm.value = false
  if (actionsLocked.value || !concedingSide.value) return
  declareLoss(concedingSide.value, { reason: 'concede' })
}
// Nouvelle phase ou nouveau camp : le compteur repart à plein (cf.
// `syncMoveTimer`), donc le mouvement se rouvre et la modale du joueur
// précédent disparaît.
watch([() => turnInfo.value.step, phase], () => {
  showTimeUp.value = false
  moveTimeExpired.value = false
})

function zoomIn() {
  zoom.value = Math.min(2, +(zoom.value + 0.05).toFixed(2))
}
function zoomOut() {
  zoom.value = Math.max(0.1, +(zoom.value - 0.05).toFixed(2))
}

/** Zoom à la molette (Ctrl/pas de modificateur — sur toute la zone carte). */
function onMapWheel(event) {
  // Le zoom déplace le pion survolé sous la souris : fenêtre de pile périmée.
  hoveredCounter.value = null
  const step = 0.05
  const delta = event.deltaY < 0 ? step : -step
  zoom.value = Math.min(2, Math.max(0.1, +(zoom.value + delta).toFixed(2)))
}

// --- Drag-to-scroll (pan) au clic droit maintenu ---
const mapWrapRef = ref(null)
const mapDrag = ref(null) // { startX, startY, scrollLeft, scrollTop }

function onMapDragStart(event) {
  const el = mapWrapRef.value
  if (!el) return
  // Un clic droit sur un pion ouvre son menu contextuel (cf. Counter.vue) —
  // ne pas démarrer un pan ici, sinon le preventDefault() ci-dessous
  // supprime l'événement contextmenu natif avant qu'il puisse se déclencher.
  if (event.target.closest('.counter')) return
  event.preventDefault()
  mapDrag.value = { startX: event.clientX, startY: event.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
}
function onMapDragMove(event) {
  if (!mapDrag.value) return
  const el = mapWrapRef.value
  if (!el) return
  el.scrollLeft = mapDrag.value.scrollLeft - (event.clientX - mapDrag.value.startX)
  el.scrollTop = mapDrag.value.scrollTop - (event.clientY - mapDrag.value.startY)
}
function onMapDragEnd() {
  mapDrag.value = null
}
</script>

<template>
  <div class="hexmap">
    <header class="toolbar">
      <h1>{{ module.name }}</h1>

      <div v-if="module.turnTrack" class="turn-tracker-block">
        <TurnTracker ref="turnTrackerRef" :config="trackConfig" :sides="module.sides"
          :initial-step="initialTurnStep" :disabled="phaseControlsLocked" :phase="phase" :phase-index="phaseIndex" :phase-labels="phaseLabels" :next-label="nextLabel"
          @turn="onTurnAdvance" @change="onTurnChange" @phase-next="onPhaseNext" />

        <!-- cf. MoveTimer.vue — Blitz : une pendule par camp, toujours
             visible ; Limité : un seul compteur, en phase Mouvement. -->
        <div v-if="moveTimerSeconds > 0" class="move-timers">
          <template v-if="isBlitz">
            <MoveTimer v-for="side in turnOrder" :key="side" :duration-seconds="moveTimerSeconds"
              :started-at="moveTimerSide === side ? moveTimerStartedAt : null" :used-ms="blitzUsedMs[side] ?? 0"
              :label="sideLabel(side)" always-visible @expired="onMoveTimeUp(side)" />
            <span v-if="blitzLoser" class="game-over-tag">{{ $t('toolbar.gameOverTag', { side: sideLabel(blitzLoser) }) }}</span>
          </template>
          <MoveTimer v-else :duration-seconds="moveTimerSeconds" :started-at="moveTimerStartedAt"
            @expired="onMoveTimeUp" />
        </div>

        <SupportTracker ref="supportTrackerRef" :config="module.supportTrack" :turn="turnInfo.turn"
          :placed-ids="placedIds" :selectable="selectable" :placeable="canPlaceSupportNow" :selected-id="selectedSupportId"
          @dragstart="onCounterDragStart" @select="onSupportSelect" />

        <!-- cf. lib/useVictoryPoints.js — tenus à la main en mode Libre,
             par le moteur en mode Assisté. -->
        <VictoryPoints :sides="victorySides" :scores="victoryScores" :editable="victoryEditable"
          @change="onVictoryChange" />
      </div>

      <div class="controls">
        <label :title="!assisted ? $t('toolbar.gridDisabled') : ''">
          <input type="checkbox" v-model="showGrid" :disabled="!assisted"> {{ $t('toolbar.grid') }}
        </label>
        <label><input type="checkbox" v-model="showLabels"> {{ $t('toolbar.coordinates') }}</label>
        <label><input type="checkbox" v-model="showCalib"> {{ $t('toolbar.calibration') }}</label>
        <label><input type="checkbox" v-model="debug"> {{ $t('toolbar.debug') }}</label>
        <button type="button" class="toggle-btn" :class="{ active: !showCounters }"
          @click="showCounters = !showCounters">
          {{ showCounters ? $t('toolbar.hideCounters') : $t('toolbar.showCounters') }}
        </button>
        <button v-if="assisted" type="button" class="toggle-btn" :disabled="!moveHistory.length || inputLocked || phase !== 0"
          @click="undoLastMove">
          {{ $t('toolbar.undo') }}
        </button>
        <button v-if="!assisted" type="button" class="toggle-btn" :class="{ active: !showRollModal }"
          @click="showRollModal = !showRollModal">
          {{ showRollModal ? $t('toolbar.hideDie') : $t('toolbar.showDie') }}
        </button>
        <button v-if="movementChartSrc" type="button" class="toggle-btn" :class="{ active: showMovementChart }"
          @click="showMovementChart = !showMovementChart">
          {{ $t('toolbar.movementChart') }}
        </button>
        <button v-if="combatChartSrc" type="button" class="toggle-btn" :class="{ active: showCombatChart }"
          @click="showCombatChart = !showCombatChart">
          {{ $t('toolbar.combatChart') }}
        </button>
        <!-- cf. `askConcede` / `gameEnd` : concéder tant que la partie
             continue, revoir le bilan une fois qu'elle est finie. -->
        <button v-if="gameEnd" type="button" class="toggle-btn" :title="$t('toolbar.gameSummaryTitle')"
          @click="showGameEnd = true">
          {{ $t('toolbar.gameSummary') }}
        </button>
        <button v-else-if="concedingSide && !replayLocked" type="button" class="toggle-btn" :title="$t('toolbar.concedeTitle')"
          @click="askConcede">
          {{ $t('toolbar.concede') }}
        </button>
        <button type="button" class="toggle-btn"
          :title="$t('toolbar.bugReportTitle')"
          @click="openBugReport">
          {{ $t('toolbar.bugReport') }}
        </button>
        <button type="button" class="toggle-btn" :class="{ active: showGuide }" :title="$t('toolbar.helpTitle')"
          :aria-label="$t('toolbar.help')" @click="showGuide = true">?</button>
        <div v-if="replayEntries.length" class="replay-ctl">
          <span class="replay-pos">{{ replayIndex }} / {{ replayEntries.length }}</span>
          <button type="button" class="toggle-btn replay-btn" :title="$t('toolbar.replayStep')"
            :disabled="replayIndex >= replayEntries.length" @click="stepReplay">▶</button>
          <button type="button" class="toggle-btn replay-btn" :title="$t('toolbar.replayEnd')"
            :disabled="replayIndex >= replayEntries.length" @click="fastForwardReplay">⏭</button>
        </div>
        <div class="zoom-ctl">
          <button @click="zoomOut">−</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn">+</button>
        </div>
        <LanguageSwitcher />
      </div>
    </header>

    <main class="map-wrap" ref="mapWrapRef" :class="{ dragging: !!mapDrag }" @mousedown.right.prevent="onMapDragStart"
      @mousemove="onMapDragMove" @mouseup="onMapDragEnd" @mouseleave="onMapDragEnd" @contextmenu.prevent
      @wheel.prevent="onMapWheel" @scroll="hoveredCounter = null">
      <svg ref="svgRef" class="map-svg"
        :style="{ width: map.imageWidth * zoom + 'px', height: map.imageHeight * zoom + 'px' }"
        :viewBox="`0 0 ${map.imageWidth} ${map.imageHeight}`" preserveAspectRatio="none" @dragover.prevent
        @drop.prevent="onMapDrop">

        <image :href="map.url" x="0" y="0" :width="map.imageWidth" :height="map.imageHeight" preserveAspectRatio="none" />

        <g v-if="showGrid">
          <polygon v-for="hex in hexes" :key="hex.id" class="hex"
            :class="{ adjacent: debug ? isInRange(hex) : isReachable(hex), entry: isEntryHex(hex) }"
            :points="hex.pts" :stroke="gridStyle.stroke" :stroke-width="gridStyle.width"
            :stroke-opacity="gridStyle.opacity" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <!-- cf. lib/useAssisted.js::enemyZocSet — hex sous Zone de Contrôle
             (ZOC) ennemie du pion sélectionné : y entrer force l'arrêt du
             mouvement ce tour-ci (cf. canEnterHex, même règle, qui
             s'applique quel que soit cet affichage). Affiché UNIQUEMENT en
             mode debug (cf. HexMap.vue::zocSet) — la règle reste active en
             mode Assisté normal, seul ce surlignage est réservé au debug. -->
        <g v-if="debug">
          <polygon v-for="hex in hexes.filter((hex) => isZocHex(hex))" :key="'zoc' + hex.id" class="hex-zoc"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
        </g>

        <!-- cf. lib/useCombat.js — combat en cours : hex CIBLES en orange
             (cliquables pour les retirer, cf. onHex — ce groupe est rendu
             indépendamment de `showGrid`, qui ne doit pas conditionner
             l'affichage ni l'annulation d'un combat) et hex des ATTAQUANTS
             désignés en jaune (non cliquables : c'est le pion posé dessus
             qui reçoit le clic, cf. onCounterSelect). -->
        <g v-if="combatActive">
          <polygon v-for="hex in hexes.filter((hex) => isCombatAttackerHex(hex))" :key="'atk' + hex.id" class="hex-attacker"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isCombatTargetHex(hex))" :key="'def' + hex.id" class="hex-defender"
            :points="hex.pts" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
          <!-- FPF du défenseur (cf. lib/useCombat.js) : artilleries éligibles
               en pointillé bleu (quand le choix se fait sur cet écran),
               artilleries retenues en bleu plein. -->
          <polygon v-for="hex in hexes.filter(isFpfCandidateHex)" :key="'fpfc' + hex.id" class="hex-fpf-candidate"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isCombatFpfHex(hex))" :key="'fpf' + hex.id" class="hex-fpf"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
        </g>

        <!-- cf. lib/useSupplyLine.js::traceFor — ligne de communication de
             l'unité cliquée (mode debug, phase de Fin de tour) : un segment
             par pas, coloré selon son étage (hors piste, piste, route), et une
             croix rouge au point de rupture si la ligne est coupée.
             Purement informatif : les clics la traversent. -->
        <g v-if="supplyTrace" class="supply-trace">
          <circle :cx="supplyTrace.start.x" :cy="supplyTrace.start.y" :r="SUPPLY_CROSS / 2"
            :class="'supply-stage-' + Math.min(supplyTrace.segments[0]?.stage ?? 0, 2)" />
          <line v-for="(segment, index) in supplyTrace.segments" :key="'loc' + index"
            :x1="segment.x1" :y1="segment.y1" :x2="segment.x2" :y2="segment.y2"
            :class="'supply-stage-' + Math.min(segment.stage, 2)" vector-effect="non-scaling-stroke" />
          <g v-if="supplyTrace.cross" class="supply-rupture">
            <title>{{ t('supplyTrace.rupture.' + supplyTrace.cross.reason) }}</title>
            <line :x1="supplyTrace.cross.x - SUPPLY_CROSS" :y1="supplyTrace.cross.y - SUPPLY_CROSS"
              :x2="supplyTrace.cross.x + SUPPLY_CROSS" :y2="supplyTrace.cross.y + SUPPLY_CROSS"
              vector-effect="non-scaling-stroke" />
            <line :x1="supplyTrace.cross.x - SUPPLY_CROSS" :y1="supplyTrace.cross.y + SUPPLY_CROSS"
              :x2="supplyTrace.cross.x + SUPPLY_CROSS" :y2="supplyTrace.cross.y - SUPPLY_CROSS"
              vector-effect="non-scaling-stroke" />
          </g>
        </g>

        <!-- cf. lib/useBridges.js — ponts démolissables dont le sort est
             réglé : rond ROUGE sur un pont détruit, VERT sur un pont qui
             tiendra jusqu'à la fin de la partie. Purement informatif : les
             clics les traversent (cf. .hex-demolition en bas de fichier). -->
        <g v-if="demolitionMarks.length" class="demolition-marks">
          <circle v-for="mark in demolitionMarks" :key="'dem' + mark.key" :cx="mark.x" :cy="mark.y" r="11"
            :class="mark.destroyed ? 'demolished' : 'held'" />
        </g>

        <!-- cf. la section "Sortie de carte" — bandes de bord par lesquelles
             le camp actif peut quitter la carte pendant sa phase de
             Mouvement. Purement informatif : les clics les traversent. -->
        <g v-if="mapExitOpen">
          <polygon v-for="hex in hexes.filter(isMapExitHex)" :key="'exit' + hex.id" class="hex-map-exit"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
        </g>

        <!-- cf. la section "Reconnaissance du moteur" — hex que le moteur
             vient de désigner : clic droit sur une de ses unités pour le
             rapport. Purement informatif : les clics le traversent. -->
        <g v-if="reconTarget">
          <polygon v-for="hex in hexes.filter(isReconTargetHex)" :key="'recon' + hex.id" class="hex-recon-target"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
        </g>
        <!-- Reconnaissance du joueur : sources possibles (contour), source
             choisie (plein) et ses cibles (jaune clignotant). Les clics
             traversent jusqu'aux pions et aux hex (cf. `onManualRecon`). -->
        <g v-if="manualReconChecks.length">
          <polygon v-for="hex in hexes.filter(isManualReconSourceHex)" :key="'rsrc' + hex.id"
            :class="isManualReconChosenHex(hex) ? 'hex-recon-source-chosen' : 'hex-recon-source'"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter(isManualReconTargetHex)" :key="'rtgt' + hex.id" class="hex-recon-target"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
        </g>

        <!-- cf. lib/useCombat.js::canPlaceSupportHex — un pion de soutien
             attend son hex (mode Assisté) : hex cibles possibles en
             pointillé vert, cliquables pour l'y poser. Hors du groupe
             `combatActive` ci-dessus : on pose un soutien avant même
             d'ouvrir le combat. -->
        <g v-if="selectedSupportId != null">
          <polygon v-for="hex in hexes.filter(isSupportTargetHex)" :key="'sup' + hex.id" class="hex-support-target"
            :points="hex.pts" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <!-- cf. lib/useRetreat.js — avance après combat : chemin de retraite
             (POR) en vert, hex des unités qui peuvent avancer (contour vert),
             hex où l'unité choisie peut avancer (vert vif, cliquables). Rendu
             AVANT le groupe de retraite, dont le rouge doit rester dessus. -->
        <g v-if="retreatActive">
          <polygon v-for="hex in hexes.filter((hex) => isPorHex(hex))" :key="'por' + hex.id" class="hex-por"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isAdvancerHex(hex))" :key="'adu' + hex.id" class="hex-advancer"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isAdvanceHex(hex))" :key="'adv' + hex.id" class="hex-advance"
            :points="hex.pts" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <!-- cf. lib/useRetreat.js — retraite en cours : hex de l'unité qui
             retraite (contour rouge pointillé) et hex où elle peut aller
             (en ROUGE, cliquables). Rendu après le groupe du combat pour
             passer au-dessus de ses surlignages. -->
        <g v-if="retreatActive">
          <polygon v-for="hex in hexes.filter((hex) => isRetreatingHex(hex))" :key="'rtu' + hex.id" class="hex-retreating"
            :points="hex.pts" vector-effect="non-scaling-stroke" />
          <polygon v-for="hex in hexes.filter((hex) => isRetreatHex(hex))" :key="'rt' + hex.id" class="hex-retreat"
            :points="hex.pts" vector-effect="non-scaling-stroke" @click="onHex(hex)" />
        </g>

        <g v-if="showLabels">
          <text v-for="hex in hexes" :key="'t' + hex.id" class="coordtxt" :x="hex.cx" :y="hex.cy + calibration.a * 0.18"
            text-anchor="middle" :font-size="calibration.a * 0.42">{{ hex.id }}</text>
        </g>

        <!-- cf. lib/useDebug.js — coût de terrain (COT) des hex adjacents au
             pion sélectionné, uniquement quand la case "debug" est cochée. -->
        <g v-if="debug">
          <text v-for="label in adjacentCotLabels" :key="'cot' + label.id" class="debug-cot" :x="label.cx" :y="label.cy"
            text-anchor="middle" :font-size="calibration.a * 0.55">{{ label.cot }}</text>
        </g>

        <!-- cf. lib/useDebug.js::autoMoveTrailLines — trajet de chaque pion à
             hex-objectif depuis le début de la partie (rond = début/fin d'un
             tour, croix = objectif), uniquement en mode debug. -->
        <g v-if="debug" class="debug-trails">
          <g v-for="trail in autoMoveTrailLines" :key="'trail' + trail.id" :style="{ color: trail.color }">
            <polyline v-if="trail.points" :points="trail.points" class="debug-trail" :stroke-width="calibration.a * 0.07" />
            <circle v-for="(dot, index) in trail.dots" :key="index" :cx="dot.x" :cy="dot.y" :r="calibration.a * 0.11" class="debug-trail-dot" />
            <path v-if="trail.objective" class="debug-trail" :stroke-width="calibration.a * 0.07"
              :d="`M${trail.objective.x - calibration.a * 0.25},${trail.objective.y - calibration.a * 0.25} l${calibration.a * 0.5},${calibration.a * 0.5} m0,${-calibration.a * 0.5} l${-calibration.a * 0.5},${calibration.a * 0.5}`" />
          </g>
        </g>

        <!-- cf. lib/useAssisted.js::entrySurcharge — surcoût de congestion
             déjà accumulé sur les hex d'entrée de renfort surlignés, visible
             uniquement en mode debug. -->
        <g v-if="debug">
          <text v-for="label in entrySurchargeLabels" :key="'entrysur' + label.id" class="debug-entry-surcharge"
            :x="label.cx" :y="label.cy - calibration.a * 0.4" text-anchor="middle" :font-size="calibration.a * 0.4">+{{ label.surcharge }}</text>
        </g>

        <g v-if="showCounters" class="counters">
          <!-- Marqueurs (DZ...) rendus en premier : toujours sous les unités
               dans l'ordre de peinture SVG, quel que soit le hex. -->
          <Counter v-for="counter in counters.filter((counter) => !isUnit(counter) && !isSupport(counter) && !counter.attachedTo)" :key="counter.id" :id="counter.id" :src="counter.src" :col="counter.col"
            :row="counter.row" :calibration="calibration" :selected="selectedCounterId === counter.id" :selectable="false"
            :offset="stackOffsets.get(counter.id) ?? ZERO_OFFSET" :drag-px="draggedCounterId === counter.id ? dragCurrentPx : null"
            @dragstart="onCounterDragStart" @hex-click="onMarkerClick" @hover="onCounterHover" @unhover="onCounterUnhover" />
          <Counter v-for="counter in counters.filter(isUnit)" :key="counter.id" :id="counter.id" :src="counter.src" :col="counter.col"
            :row="counter.row" :calibration="calibration" :selected="selectedCounterId === counter.id" :selectable="selectable"
            :moved="showMovedRings && movedThisTurnIds.has(String(counter.id))" :spent="hasFought(counter)"
            :disrupted="artillery.isDisrupted(counter)" :displaced="artillery.isDisplaced(counter)"
            :unsupplied="outOfSupplyIds.has(String(counter.id))" :label="privateLabelOf(counter)"
            :offset="stackOffsets.get(counter.id) ?? ZERO_OFFSET" :drag-px="draggedCounterId === counter.id ? dragCurrentPx : null"
            @select="onCounterSelect" @dragstart="onCounterDragStart" @contextmenu="onCounterContextMenu"
            @hover="onCounterHover" @unhover="onCounterUnhover" />
          <!-- Résultats de recherche et pions "Sighted" (cf. `reportRecon`) :
               posés SUR la pile qu'ils renseignent, transparents aux clics
               (cf. `syncSearchMarkers`). -->
          <Counter v-for="counter in counters.filter((counter) => counter.attachedTo)" :key="counter.id" :id="counter.id" :src="counter.src" :col="counter.col"
            :row="counter.row" :calibration="calibration" :selected="false" :selectable="false"
            :offset="stackOffsets.get(counter.id) ?? ZERO_OFFSET" class="search-marker" />
          <!-- Pions de soutien rendus en dernier : toujours au-dessus des
               unités qu'ils coiffent (cf. `stackOffsets`). -->
          <Counter v-for="counter in counters.filter(isSupport)" :key="counter.id" :id="counter.id" :src="counter.src" :col="counter.col"
            :row="counter.row" :calibration="calibration" :selected="selectedCounterId === counter.id" :selectable="false"
            :offset="stackOffsets.get(counter.id) ?? ZERO_OFFSET" :drag-px="draggedCounterId === counter.id ? dragCurrentPx : null"
            @dragstart="onCounterDragStart" @hex-click="onMarkerClick" @contextmenu="onSupportContextMenu"
            @hover="onCounterHover" @unhover="onCounterUnhover" />
        </g>

        <g v-if="showCounters" class="support-badges">
          <circle v-for="badge in supportStackBadges" :key="badge.key" :cx="badge.x" :cy="badge.y" :r="calibration.a * 0.26"
            class="support-badge-bg" />
          <text v-for="badge in supportStackBadges" :key="'t' + badge.key" :x="badge.x" :y="badge.y + calibration.a * 0.1"
            class="support-badge-text" text-anchor="middle" :font-size="calibration.a * 0.34">{{ badge.count }}</text>
        </g>
      </svg>
    </main>

    <CalibrationPanel v-if="showCalib" :calibration="calibration" :grid-style="gridStyle" :map-config="mapConfig"
      :default-calibration="moduleCalibration" :image-width="map.imageWidth" :image-height="map.imageHeight" />

    <SidePanel :tabs="sidePanelTabs" v-model:open-tab="openTab">
      <template v-for="tab in sidePanelTabs" :key="tab.key" v-slot:[tab.key]>
        <EliminatedPanel v-if="tab.key === 'eliminated'" :units="eliminatedCounters"
          @contextmenu="onEliminatedContextMenu" />
        <JournalPanel v-else-if="tab.key === 'journal'" ref="journalRef" :module-id="moduleId || module.name"
          :turn="turnInfo.turn" :settings="settings" :shared="online" @loaded="onJournalLoaded"
          @settings-mismatch="(settings) => emit('restart-with', settings)" />
        <ReinforcementsPanel v-else :reinforcements="reinforcementsForTab(tab.key)"
          :selected-id="selectedReinforcementId" :current-turn="turnInfo.turn" :draggable="draggable || phase === PHASE_SETUP"
          :can-place="canPlaceReinforcementNow"
          @dragstart="onCounterDragStart" @select="onReinforcementSelect" />
      </template>
    </SidePanel>

    <Toast :message="reconToast" @close="reconToast = null" />
    <ContextMenu v-if="contextMenu" :left-px="contextMenu.x" :top-px="contextMenu.y" :items="contextMenu.items"
      @choose="chooseContextMenuItem" @close="closeContextMenu" />
    <StackPopup v-if="hoveredStackCounters.length" :counters="hoveredStackCounters" :anchor="hoveredCounter.anchor"
      :title="$t('stack.title', { hex: hexId(hoveredCounter.col + 1, hoveredCounter.row), n: hoveredStackCounters.length })" />

    <!-- cf. lib/useCombat.js — modale de combat, ouverte par un clic sur une
         unité ennemie en phase Combat. Non bloquante : la carte reste
         cliquable pour y désigner les unités attaquantes. -->
    <CombatModal v-if="combatActive" :target-hexes="combatTargetHexLabels" :defenders="combatDefenders"
      :attacker-details="combatAttackerDetails" :can-resolve="combatCanResolve" :stranded-units="combatStrandedUnits"
      :attack-strength="attackStrength" :defense-strength="defenseStrength" :differential="differential"
      :terrain-row="combatTerrainRow" :column="combatColumn" :combat-result="combatResult"
      :crt-rows="crtRows" :crt-results="crtResults" :retreat="retreatInfo" :retreat-notes="retreatNotes"
      :advance="advanceInfo" @close="onCombatClose" @fight="onCombatFight" @end-advance="endAdvance"
      @reduce-retreat="reduceRetreat" @cancel-push="cancelPush" :fpf="fpfView" :support="supportView"
      :artillery-cap="artilleryCapView" @toggle-fpf="onToggleFpf"
      @request-fpf="onRequestFpf" @cancel-fpf-request="onCancelFpfRequest" @send-fpf="onSendFpf"
      @toggle-support="toggleSupportChoice" />

    <!-- cf. onPhaseNext — changement de phase refusé : unités empilées en fin
         de Mouvement (cf. lib/useAssisted.js::stackedHexes) ou combats
         obligatoires encore en attente (cf. lib/useCombat.js::pendingEngagements).
         Les deux listes sont vides hors de leur phase respective. -->
    <!-- Signaler un bug : cf. `openBugReport`. -->
    <!-- Guide de l'interface : cf. `showGuide`. -->
    <InterfaceGuide v-if="showGuide" :assisted="assisted" @close="closeGuide" />

    <BugReportModal v-if="bugReport" :snapshot="bugReport.snapshot" :game="bugReport.game" :context="bugReport.context" @close="bugReport = null" />

    <PhaseBlockedModal v-if="showPhaseBlocked" v-bind="phaseBlockedView" @close="showPhaseBlocked = false" />

    <!-- cf. lib/useBridges.js — un pont démolissable est bordé par une
         unité ennemie : au camp qui le tient de décider, tout de suite. -->
    <BridgeModal :bridge="demolitionBridge" :result="demolitionResult" :waiting="demolitionWaiting"
      :destroy-on="rules.bridgeDemolition?.destroyOn ?? []"
      @attempt="onDemolitionAttempt" @decline="onDemolitionDecline" />

    <!-- cf. lib/useBridges.js — fin du tour adverse : un génie resté au calme
         peut relever un pont démoli qu'il borde. -->
    <BridgeModal mode="repair" :bridge="repairTarget" :result="repairResult" :waiting="repairWaiting"
      @attempt="onRepairAttempt" @decline="onRepairDecline" />

    <!-- cf. MoveTimer.vue — timing "Limité" : temps de la phase de Mouvement écoulé. -->
    <PhaseBlockedModal v-if="showTimeUp" :title="$t('timeUp.title')" @close="showTimeUp = false">
      {{ $t('timeUp.limited') }}
    </PhaseBlockedModal>

    <!-- cf. lib/useVictoryPoints.js — ce qui vient d'être marqué. -->
    <VictoryModal :awards="victoryNotice" :title="$t(victoryNoticeTitle)" @close="victoryNotice = []" />

    <!-- cf. `gameEnd` — fin de partie : concession, pendule Blitz à 0 ou
         fin du dernier tour. Et la confirmation d'une concession (cf.
         `askConcede`). -->
    <GameEndModal v-if="concedeConfirm" :confirm-side="sideLabel(concedingSide)" :outcome="victoryOutcome"
      @confirm="concede" @close="concedeConfirm = false" />
    <GameEndModal v-else-if="showGameEnd && gameEnd" :reason="gameEnd.reason" :winner="gameEnd.winner" :loser="gameEnd.loser"
      :level="gameEnd.level ?? null" :outcome="victoryOutcome"
      :sides="victorySides" :rows="victoryByTurn" :totals="victoryScores" @close="showGameEnd = false" />

    <!-- cf. setSelectedCounter — changement de sélection refusé : l'unité
         en cours de mouvement est en overstack avec une unité amie. -->
    <PhaseBlockedModal v-if="unitStackBlock" :title="$t('unitStack.title')" :stacks="[unitStackBlock]"
      :stack-message="$t('unitStack.message')"
      @close="unitStackBlock = null" />

    <!-- Dé libre : mode Libre uniquement (cf. `showRollModal`). -->
    <RollModal v-if="!assisted" v-show="showRollModal" :disabled="inputLocked" @roll="onDiceRoll" />
    <MovementChartModal v-if="movementChartSrc" v-show="showMovementChart" :src="movementChartSrc" />
    <CombatChartModal v-if="combatChartSrc" v-show="showCombatChart" :src="combatChartSrc" />
  </div>
</template>

<style scoped>
.hexmap {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 36px 0;
  background: var(--board-bg);
  flex: none;
  position: relative;
  z-index: var(--z-raised);
}

.toolbar h1 {
  font-size: var(--font-size-320);
  font-weight: 700;
  margin: 0;
  color: var(--panel-text-muted);
}

.turn-tracker-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.move-timers {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
}

.game-over-tag {
  padding: 3px 10px;
  border-radius: var(--radius-6);
  background: var(--color-alert);
  color: var(--panel-bg);
  font-size: var(--font-size-080);
  font-weight: 700;
}

.controls {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  font-size: var(--font-size-085);
}

.controls label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--color-text);
}

.toggle-btn {
  padding: 5px 10px;
  font-size: var(--font-size-085);
  border: 1px solid var(--black-a25);
  border-radius: var(--radius-4);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

.toggle-btn.active {
  background: var(--black-a25);
}

.toggle-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.replay-ctl {
  display: flex;
  align-items: center;
  gap: 6px;
}

.replay-pos {
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-080);
  opacity: 0.85;
}

.replay-btn {
  font-size: var(--font-size-090);
  line-height: 1;
  padding: 5px 9px;
}

.zoom-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-ctl button {
  width: 26px;
  height: 26px;
  cursor: pointer;
}

.map-wrap {
  overflow: hidden;
  flex: 1;
  min-height: 0;
  background: var(--board-bg);
}

.map-wrap.dragging {
  cursor: grabbing;
  user-select: none;
}

.map-wrap.dragging * {
  cursor: grabbing !important;
}

.map-svg {
  display: block;
}

polygon.hex {
  fill: var(--white-a00);
  transition: fill 0.05s;
}

polygon.hex.adjacent {
  fill: var(--reach-a35);
}

polygon.hex.adjacent:hover {
  fill: var(--reach-a55);
}

polygon.hex.entry {
  fill: var(--orange-a40);
}

polygon.hex.entry:hover {
  fill: var(--orange-a60);
}

.coordtxt {
  font-family: var(--font-mono);
  font-weight: 700;
  fill: var(--color-ink);
  pointer-events: none;
}

/* cf. lib/useDebug.js — coût de terrain (COT) affiché sur les hex adjacents
   au pion sélectionné quand le mode debug est actif. Contour blanc (double
   trait, cf. paint-order) pour rester lisible sur n'importe quel fond de
   carte, y compris par-dessus la teinte verte de `.hex.adjacent`. */
.debug-trail {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.85;
  pointer-events: none;
}

.debug-trail-dot {
  fill: currentColor;
  stroke: var(--color-white);
  stroke-width: 1.5px;
  pointer-events: none;
}

.debug-cot {
  font-family: var(--font-mono);
  font-weight: 700;
  fill: var(--color-zoc);
  stroke: var(--color-white);
  stroke-width: 3px;
  paint-order: stroke fill;
  pointer-events: none;
}

/* cf. lib/useAssisted.js::entrySurcharge — surcoût de congestion accumulé
   sur un hex d'entrée de renfort (ex. "+0.5"). Couleur distincte de
   .debug-cot pour ne pas confondre les deux nombres s'ils apparaissent sur
   le même hex (le COT normal ET le surcoût d'entrée n'ont pas le même sens). */
.debug-entry-surcharge {
  font-family: var(--font-mono);
  font-weight: 700;
  fill: var(--color-debug-surcharge);
  stroke: var(--color-white);
  stroke-width: 3px;
  paint-order: stroke fill;
  pointer-events: none;
}

/* cf. lib/useAssisted.js::enemyZocSet — hex sous ZOC ennemie du pion
   sélectionné. Contour rouge en tirets (distinct des teintes pleines
   .hex.adjacent/.entry, avec lesquelles il peut se superposer — un hex peut
   être À LA FOIS accessible ET sous ZOC, cf. règle "doit s'y arrêter") pour
   rester lisible quel que soit ce qu'il y a dessous. */
.hex-zoc {
  fill: var(--zoc-a22);
  stroke: var(--color-zoc);
  stroke-width: 2.5;
  stroke-dasharray: 5 3;
  pointer-events: none;
}

/* cf. lib/useCombat.js — hex cible d'un combat en cours. Orange plein
   avec un contour marqué, pour rester distinct de `.hex.entry` (même
   famille de couleur, mais sans contour) : les deux ne peuvent de toute
   façon pas apparaître en même temps (hex d'entrée = renfort sélectionné en
   phase Mouvement, défenseur = phase Combat). Cliquable, contrairement aux
   autres surlignages : le cliquer retire l'hex des cibles (et annule le
   combat si c'était le dernier). */
.hex-defender {
  fill: var(--orange-a50);
  stroke: var(--color-orange);
  stroke-width: 3;
  cursor: pointer;
}

.hex-defender:hover {
  fill: var(--orange-a68);
}

/* cf. lib/useCombat.js — hex d'une unité désignée attaquante. Jaune, pour
   se distinguer au premier coup d'œil de l'orange du défenseur. Les clics
   le traversent (`pointer-events: none`) : c'est le pion posé dessus qui
   les reçoit, et c'est lui qui retire l'unité du combat si on le reclique. */
.hex-attacker {
  fill: var(--gold-a45);
  stroke: var(--color-gold);
  stroke-width: 2.5;
  pointer-events: none;
}

/* cf. lib/useCombat.js — FPF du défenseur : artillerie éligible (pointillé
   bleu) et artillerie retenue (bleu plein). Les clics traversent : c'est le
   pion qui les reçoit (cf. onCounterSelect). */
/* cf. la section "Reconnaissance du moteur" — résultat de recherche posé sur
   une unité, transparent aux clics ; hex que le moteur vient de désigner. */
.search-marker {
  pointer-events: none;
}
.hex-recon-target {
  fill: rgba(255, 196, 0, 0.28);
  stroke: #ffc400;
  stroke-width: 3;
  pointer-events: none;
  animation: recon-pulse 1.2s ease-in-out infinite alternate;
}
.hex-recon-source {
  fill: none;
  stroke: #4fc3f7;
  stroke-width: 3;
  pointer-events: none;
}
.hex-recon-source-chosen {
  fill: rgba(79, 195, 247, 0.3);
  stroke: #4fc3f7;
  stroke-width: 4;
  pointer-events: none;
}
@keyframes recon-pulse {
  from { fill-opacity: 0.35; }
  to { fill-opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .hex-recon-target { animation: none; }
}
/* cf. la section "Sortie de carte" de HexMap.vue — bandes de bord ouvertes au
   camp actif. Gris discret : c'est un repère permanent de la phase, pas une
   action en attente ; les clics le traversent. */
.hex-map-exit {
  fill: var(--black-a25);
  stroke: var(--white-a35);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  pointer-events: none;
}

/* cf. lib/useSupplyLine.js::traceFor — ligne de communication (mode debug) :
   un trait de centre d'hex en centre d'hex, une couleur par étage — orange
   hors piste (et pour un aéroporté, que les étages n'engagent pas), or sur
   piste, bleu sur route —, et une croix rouge au point de rupture. Les clics
   traversent le tracé ; seule la croix capte le survol, pour son infobulle
   (la raison de la rupture). */
.supply-trace line {
  stroke-width: 5;
  stroke-linecap: round;
}
.supply-trace .supply-stage-0 { stroke: var(--color-orange); fill: var(--color-orange); }
.supply-trace .supply-stage-1 { stroke: var(--color-gold); fill: var(--color-gold); }
.supply-trace .supply-stage-2 { stroke: var(--color-blue); fill: var(--color-blue); }
.supply-trace circle,
.supply-trace > line {
  pointer-events: none;
}
.supply-rupture line {
  stroke: var(--color-red);
  stroke-width: 6;
}

/* cf. lib/useBridges.js — sort d'un pont démolissable, marqué au milieu de
   son hexside. Même cerne sombre que les points d'état des pions (cf.
   Counter.vue), pour rester lisible sur une carte claire comme sur une
   rivière. */
.demolition-marks circle {
  stroke: var(--color-ink-soft);
  stroke-width: 2;
  pointer-events: none;
}

.demolition-marks .demolished {
  fill: var(--color-dot-red);
}

.demolition-marks .held {
  fill: var(--color-green);
}

/* cf. lib/useCombat.js::canPlaceSupportHex — hex où poser le pion de soutien
   choisi dans la tablette. Vert pointillé, comme une sélection en attente. */
.hex-support-target {
  fill: var(--green-a28);
  stroke: var(--color-selection);
  stroke-width: 2.5;
  stroke-dasharray: 6 4;
  cursor: pointer;
}

.hex-support-target:hover {
  fill: var(--green-a60);
}

.hex-fpf-candidate {
  fill: none;
  stroke: var(--color-blue);
  stroke-width: 2.5;
  stroke-dasharray: 6 4;
  pointer-events: none;
}

.hex-fpf {
  fill: var(--blue-a40);
  stroke: var(--color-blue);
  stroke-width: 2.5;
  pointer-events: none;
}

/* cf. lib/useRetreat.js — hex où l'unité en retraite peut aller : rouge,
   cliquable. */
.hex-retreat {
  fill: var(--red-a45);
  stroke: var(--color-red);
  stroke-width: 3;
  cursor: pointer;
}

.hex-retreat:hover {
  fill: var(--red-a65);
}

/* cf. lib/useRetreat.js — avance après combat. Chemin de retraite (POR) :
   vert léger, les clics le traversent. */
.hex-por {
  fill: var(--green-a28);
  stroke: var(--color-green);
  stroke-width: 2;
  pointer-events: none;
}

/* Hex où l'unité choisie peut avancer : vert vif, cliquable. */
.hex-advance {
  fill: var(--green-a60);
  stroke: var(--color-green-dark);
  stroke-width: 3;
  cursor: pointer;
}

.hex-advance:hover {
  fill: var(--green-a80);
}

/* Hex d'une unité qui peut avancer : c'est le pion posé dessus qui reçoit
   le clic (cf. onCounterSelect). */
.hex-advancer {
  fill: none;
  stroke: var(--color-green);
  stroke-width: 3;
  stroke-dasharray: 8 5;
  pointer-events: none;
}

/* Hex de l'unité qui est en train de retraiter : simple contour. */
.hex-retreating {
  fill: none;
  stroke: var(--color-red);
  stroke-width: 3;
  stroke-dasharray: 8 5;
  pointer-events: none;
}

.support-badge-bg {
  fill: var(--color-zoc);
  stroke: var(--color-white);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.support-badge-text {
  fill: var(--color-white);
  font-weight: 700;
  font-family: var(--font-sans);
  pointer-events: none;
}
</style>
