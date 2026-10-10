<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// JournalPanel.vue — onglet "Journal" du panneau latéral (cf. SidePanel.vue) :
// historique de tout ce qui se passe en partie (tours, déplacements, entrées
// en jeu, éliminations...). Inspiré de ambush-tactique (LogPanel.vue +
// useGameLog.js), mais consolidé ici en un seul composant autonome — pas de
// composable séparé : HexMap.vue (le seul appelant) n'a qu'à récupérer une
// référence de template et appeler `log(kind, text)` à chaque évènement de
// jeu (cf. defineExpose plus bas), exactement comme pour TurnTracker.vue /
// SupportTracker.vue.
// ═══════════════════════════════════════════════════════════════════════════

import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { AUTOSAVE_KEY, downloadJson, normalizeSettings, sameSettings, hasPendingReplay, takePendingReplay } from '../lib/journalStorage.js'

const props = defineProps({
  // Identifiant/nom du module en cours (cf. HexMap.vue) et tour courant —
  // utilisés uniquement pour composer l'index des sauvegardes (cf.
  // `saveLabel`) : "nomDuModule_date_turn" pour un export manuel,
  // "nomDuModule_save_date_turn" pour l'auto-save.
  moduleId: { type: String, default: 'module' },
  turn: { type: Number, default: 1 },
  // Réglages de la partie ouverte (mode Libre/Assisté, scénario, météo,
  // timing — cf. lib/journalStorage.js::SETTING_KEYS), ou `null` s'ils ne
  // sont pas connus (partie multijoueur). Enregistrés avec le journal : il
  // ne se rejoue correctement qu'avec eux.
  settings: { type: Object, default: null },
  // Partie en ligne : journal PARTAGÉ entre les joueurs et conservé par le
  // serveur (cf. HexMap.vue::log / applyRemoteEntry). Pas de sauvegarde
  // auto ni de reprise (elles appartiennent aux parties locales), ni de
  // chargement de fichier ou de "Vider le journal" (le journal ne serait
  // plus le même que celui des autres joueurs). L'export reste possible.
  shared: { type: Boolean, default: false },
})

// `loaded` : journal à rejouer sur la carte (cf. HexMap.vue::onJournalLoaded).
// `settings-mismatch` : `{ settings, entries }` — le journal a été joué avec
// d'AUTRES réglages que la partie ouverte ; c'est à la page de relancer la
// partie avec ces réglages (cf. DemoPlay.vue::restartWith), le journal est
// alors rejoué après la relance (cf. `resumePending`).
const emit = defineEmits(['loaded', 'settings-mismatch'])

const { t, te } = useI18n()
const partyLabel = (settings) => (te(`settings.party.${settings?.party}`) ? t(`settings.party.${settings.party}`) : null)

const entries = ref([]) // { id, t: "14:32:05", kind, text, data } — plus récent en tête
let nextId = 1

/** "Arnhem: Op. Market-Garden" -> "arnhem-op-market-garden" — pour un index
 *  de sauvegarde utilisable comme nom de fichier ou clé de stockage. */
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g') // marques diacritiques combinantes (accents) après normalize('NFD')
function slugify(text) {
  return (text || 'module')
    .normalize('NFD').replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'module'
}
/** Index "nomDuModule_[save_]date_turn" (cf. demande utilisateur) — `save`
 *  seulement pour l'auto-save, pour la distinguer d'un export manuel qui
 *  porte le même schéma sans ce mot. */
function saveLabel(isAutosave) {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const parts = [slugify(props.moduleId), ...(isAutosave ? ['save'] : []), date, `turn${props.turn}`]
  return parts.join('_')
}

// Ordre d'affichage seulement (le stockage interne reste toujours "plus
// récent en tête", cf. `entries` — inchangé pour ne pas perturber
// HexMap.vue::undo qui vise une entrée par id). 'desc' = position courante
// (comme avant) ; 'asc' = lecture depuis le début (plus ancien en tête).
const order = ref('desc')
const displayEntries = computed(() => (order.value === 'asc' ? [...entries.value].reverse() : entries.value))

/** Retourne l'id de l'entrée ajoutée — permet à l'appelant (cf.
 *  HexMap.vue::undo) de retirer précisément cette entrée plus tard sans
 *  toucher aux entrées ajoutées entre-temps (ex. un changement de tour).
 *  `data` (optionnel) porte tout ce qu'il faut pour rejouer l'action sur la
 *  carte (cf. HexMap.vue::applyReplayEntry) — pas juste le texte affiché. */
function log(kind, text, data, uid) {
  const id = nextId++
  // Pas de limite de taille : le journal SERT de sauvegarde, le rejeu part du
  // déploiement initial et a besoin de TOUTES les entrées (une limite qui
  // supprimait les plus anciennes faisait rejouer la partie de travers).
  // `uid` : identifiant commun à tous les joueurs (journal partagé
  // uniquement, cf. `shared`) — absent en partie locale.
  entries.value.unshift({ id, t: new Date().toLocaleTimeString('fr-FR'), kind, text, data, ...(uid ? { uid } : {}) })
  return id
}
function getEntry(id) {
  return entries.value.find((entry) => entry.id === id) ?? null
}

// --- Journal partagé (partie en ligne, cf. `shared`).

/** Ajoute une entrée reçue d'un autre joueur. Renvoie `false` si elle est
 *  déjà présente (même `uid`) — elle ne doit alors pas être réappliquée. */
function appendRemote(entry) {
  if (entry.uid && entries.value.some((existing) => existing.uid === entry.uid)) return false
  entries.value.unshift({ id: nextId++, t: entry.t, kind: entry.kind, text: entry.text, data: entry.data, uid: entry.uid })
  return true
}
function removeByUid(uid) {
  const entryIndex = entries.value.findIndex((entry) => entry.uid === uid)
  if (entryIndex !== -1) entries.value.splice(entryIndex, 1)
}
/** Journal partagé déjà enregistré par le serveur : rejoué comme un journal
 *  chargé (cf. `loaded`), sans modale de confirmation. */
function loadShared(list) {
  entries.value = []
  replayTail = [...list]
  emit('loaded', list)
}
function clear() {
  entries.value = []
  replayTail = []
}
/** Retire une entrée précise par id (cf. `log`), sans effet si déjà purgée. */
function remove(id) {
  const entryIndex = entries.value.findIndex((entry) => entry.id === id)
  if (entryIndex !== -1) entries.value.splice(entryIndex, 1)
}

// Entrées d'un journal chargé PAS ENCORE rejouées (ordre chronologique) —
// elles ne sont pas encore dans `entries` (cf. `revealEntry`), mais font
// bien partie de la partie : sans elles, l'auto-save écrite pendant un rejeu
// pas à pas ne contiendrait que le début de la partie (et un rechargement de
// la page à ce moment-là perdait le reste).
let replayTail = []

/** Ordre chronologique (du plus ancien au plus récent) — plus lisible/
 *  portable qu'un export "à l'envers" propre au stockage interne. Partagé
 *  par l'export manuel et l'auto-save. Inclut les entrées d'un rejeu en
 *  cours pas encore rejouées (cf. `replayTail`). */
function toChronological() {
  const shown = [...entries.value].reverse().map(({ t: time, kind, text, data }) => ({ t: time, kind, text, data }))
  return [...shown, ...replayTail]
}

/** Enregistre le journal au format JSON — nommé "nomDuModule_date_turn.json"
 *  (cf. `saveLabel`), un fichier téléchargé à chaque appel (contrairement à
 *  l'auto-save, qui n'en garde toujours qu'un seul — cf. plus bas). Format :
 *  `{ module, settings, entries }` (les anciens fichiers, simple liste
 *  d'entrées, restent lisibles — cf. `onFileChosen`). */
function exportJournal() {
  const { name, content } = gameFile()
  downloadJson(name, content)
}

/** Partie complète, au format de l'export manuel : `{ name, content }`.
 *  Aussi téléchargée avec un rapport de bug (cf. BugReportModal.vue), ce
 *  qui permet de la recharger pour reproduire le problème. */
function gameFile() {
  return {
    name: `${saveLabel(false)}.json`,
    content: { module: props.moduleId, settings: normalizeSettings(props.settings), entries: toChronological() },
  }
}

// --- Auto-save : un seul emplacement (clé localStorage fixe), écrasé à
// chaque mutation du journal — jamais plusieurs fichiers qui s'accumulent.
// L'index "nomDuModule_save_date_turn" demandé par l'utilisateur est gardé
// comme `label` DANS le contenu sauvegardé (affiché dans la toolbar,
// cf. template), pas comme clé de stockage — une clé qui changerait à
// chaque tour créerait justement les entrées multiples qu'on veut éviter.
const lastAutosaveLabel = ref('')
let autosaveTimer = null
function autosaveNow() {
  const label = saveLabel(true)
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      label, savedAt: new Date().toISOString(), settings: normalizeSettings(props.settings), entries: toChronological(),
    }))
    lastAutosaveLabel.value = label
  } catch {
    // Stockage indisponible/plein (navigation privée, quota dépassé...) —
    // l'auto-save est un confort best-effort, pas une garantie ; on n'ennuie
    // pas l'utilisateur avec une erreur pour ça (contrairement au chargement
    // manuel, cf. `loadResult`).
  }
}
// Débounce léger : un tour qui change peut journaliser plusieurs lignes
// coup sur coup (ex. régénération du soutien) — un seul write suffit.
watch(entries, () => {
  if (props.shared) return
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(autosaveNow, 300)
}, { deep: true })

// --- Reprise de l'auto-save : l'auto-save ci-dessus écrit bien dans
// localStorage, mais rien ne le relisait jamais — la partie semblait donc
// "ne pas s'enregistrer" alors qu'elle s'écrasait juste en silence à chaque
// mutation. Au montage, on propose de reprendre la dernière auto-save SI
// elle correspond au module courant (préfixe du label, cf. `saveLabel`) —
// jamais automatique, pour ne pas écraser une partie qu'on voulait
// justement recommencer à zéro. Le rejeu lui-même passe par le même circuit
// qu'un import manuel (`emit('loaded', ...)`, cf. `onFileChosen`).
const pendingAutosave = ref(null) // { label, savedAt, settings, entries } | null
onMounted(() => {
  // Partie relancée pour reprendre un journal (cf. `resumePending`) : la
  // reprise est déjà décidée, inutile de proposer l'auto-save.
  if (hasPendingReplay() || props.shared) return
  try {
    const raw = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? 'null')
    if (raw?.entries?.length && raw.label?.startsWith(slugify(props.moduleId) + '_')) {
      pendingAutosave.value = raw
    }
  } catch {
    // Stockage indisponible/corrompu — pas d'auto-save à proposer.
  }
})

/** Point de passage UNIQUE pour rejouer un journal (auto-save ou fichier).
 *  Si le journal a été joué avec d'autres réglages que la partie ouverte (le
 *  mode Libre/Assisté surtout), on ne le rejoue PAS ici : la page relance la
 *  partie avec ses réglages (évènement `settings-mismatch`), puis le rejoue
 *  (cf. `resumePending`). Sinon, rejeu immédiat. */
function startReplay(list, settings, message) {
  if (!sameSettings(settings, props.settings)) {
    const mode = partyLabel(settings)
    emit('settings-mismatch', {
      settings: normalizeSettings(settings),
      entries: list,
      message: mode ? `${message} ${t('journal.restartedInMode', { mode })}` : message,
    })
    return
  }
  entries.value = []
  replayTail = [...list]
  emit('loaded', list)
  loadResult.value = { type: 'success', message }
}

const countText = (count) => t('journal.events', count)

function resumeAutosave() {
  const save = pendingAutosave.value
  if (!save) return
  pendingAutosave.value = null
  startReplay(save.entries, save.settings, t('journal.autosaveResumed', { events: countText(save.entries.length) }))
}

/** Appelé par HexMap.vue une fois la carte montée : rejoue le journal mis de
 *  côté avant une relance de la partie (cf. lib/journalStorage.js), s'il y
 *  en a un. */
function resumePending() {
  const pending = takePendingReplay()
  if (!pending?.entries) return
  entries.value = []
  replayTail = [...pending.entries]
  emit('loaded', pending.entries)
  loadResult.value = { type: 'success', message: pending.message ?? t('journal.loadedCount', { events: countText(pending.entries.length) }) }
}
function dismissAutosave() {
  pendingAutosave.value = null
}

const fileInput = ref(null)
function triggerImport() {
  fileInput.value?.click()
}

// --- Modale bloquante de résultat de chargement (succès ou erreur) — cf.
// template plus bas. Remplace l'ancien `alert()` en cas d'erreur, et
// confirme désormais aussi le succès (silencieux auparavant). Un seul état
// à la fois ({ type, message } | null) : la modale se ferme uniquement via
// son bouton OK, jamais en cliquant le fond (volontairement bloquante).
const loadResult = ref(null)
function dismissLoadResult() {
  loadResult.value = null
}

/** Charge un journal JSON précédemment exporté (ordre chronologique dans le
 *  fichier). Le journal repart VIDE — les entrées ne réapparaissent qu'au
 *  fur et à mesure que HexMap.vue rejoue chaque ligne (lecteur ▶/⏭, cf.
 *  `revealEntry` ci-dessous) et bouge la carte en conséquence ; une fois le
 *  rejeu terminé, les nouveaux évènements de partie continuent de s'empiler
 *  dessus normalement via `log()`. Le bouton "Depuis le début"/"Position
 *  courante" ne fait que choisir l'ordre d'affichage (`order`). */
async function onFileChosen(ev) {
  const file = ev.target.files?.[0]
  ev.target.value = '' // permet de recharger le même fichier une seconde fois
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    // Deux formats : l'actuel `{ module, settings, entries }`, ou l'ancien
    // (simple liste d'entrées, sans réglages — rejoué tel quel dans la
    // partie ouverte).
    const list = Array.isArray(parsed) ? parsed : parsed?.entries
    if (!Array.isArray(list)) throw new Error(t('journal.notAList'))
    if (!Array.isArray(parsed) && parsed.module && parsed.module !== props.moduleId) {
      throw new Error(t('journal.otherModule', { module: parsed.module }))
    }
    const chronological = list.map((entry) => ({
      t: entry.t ?? '', kind: entry.kind ?? 'info', text: entry.text ?? '', data: entry.data ?? null,
    }))
    startReplay(chronological, Array.isArray(parsed) ? null : parsed.settings,
      t('journal.loadedCount', { events: countText(chronological.length) }))
  } catch (err) {
    loadResult.value = { type: 'error', message: t('journal.loadError', { reason: err.message }) }
  }
}

/** Ajoute une entrée déjà rejouée sur la carte (cf. HexMap.vue::stepReplay /
 *  fastForwardReplay) — conserve son horodatage d'origine plutôt que
 *  l'heure courante, contrairement à `log()`. */
function revealEntry(entry) {
  // HexMap.vue rejoue dans l'ordre : l'entrée révélée est la tête de
  // `replayTail`, qui passe donc dans `entries`.
  replayTail.shift()
  entries.value.unshift({ id: nextId++, t: entry.t, kind: entry.kind, text: entry.text, data: entry.data,
    ...(entry.uid ? { uid: entry.uid } : {}) })
}

// `toChronological` : journal complet, du plus ancien au plus récent — sert
// aussi à l'export joint à un rapport de bug (cf. HexMap.vue::bugReportSnapshot),
// et `gameFile` à la partie complète téléchargée avec ce rapport.
defineExpose({ log, clear, remove, revealEntry, resumePending, getEntry, appendRemote, removeByUid, loadShared, toChronological, gameFile })
</script>

<template>
  <div class="jn-list">
    <div class="jn-toolbar">
      <div class="jn-order">
        <button class="jn-btn" :class="{ on: order === 'asc' }" @click="order = 'asc'">{{ t('journal.fromStart') }}</button>
        <button class="jn-btn" :class="{ on: order === 'desc' }" @click="order = 'desc'">{{ t('journal.latestFirst') }}</button>
      </div>
      <div class="jn-io">
        <button class="jn-btn" @click="exportJournal" :disabled="!entries.length">{{ t('journal.save') }}</button>
        <button v-if="!shared" class="jn-btn" @click="triggerImport">{{ t('journal.load') }}</button>
        <input v-if="!shared" ref="fileInput" type="file" accept="application/json,.json" class="jn-file-input"
          @change="onFileChosen">
      </div>
      <p v-if="lastAutosaveLabel" class="jn-autosave">{{ t('journal.autosave', { label: lastAutosaveLabel }) }}</p>
      <p v-if="shared" class="jn-autosave">{{ t('journal.shared') }}</p>
    </div>

    <div v-if="pendingAutosave" class="jn-resume">
      <p class="jn-resume-msg">
        {{ partyLabel(pendingAutosave.settings)
          ? t('journal.foundWithMode', { label: pendingAutosave.label, mode: partyLabel(pendingAutosave.settings) })
          : t('journal.found', { label: pendingAutosave.label }) }}
      </p>
      <div class="jn-resume-btns">
        <button class="jn-btn" @click="resumeAutosave">{{ t('journal.resume') }}</button>
        <button class="jn-btn" @click="dismissAutosave">{{ t('journal.ignore') }}</button>
      </div>
    </div>

    <p v-if="!entries.length" class="jn-empty">{{ t('journal.empty') }}</p>
    <div v-for="entry in displayEntries" :key="entry.id" class="jn-row" :class="'jn-' + entry.kind">
      <span class="jn-t">{{ entry.t }}</span><span class="jn-txt">{{ entry.text }}</span>
    </div>
    <button v-if="entries.length && !shared" class="jn-clear" @click="clear">{{ t('journal.clear') }}</button>

    <div v-if="loadResult" class="jn-modal-backdrop">
      <div class="jn-modal" :class="'jn-modal-' + loadResult.type" role="alertdialog" aria-modal="true">
        <p class="jn-modal-title">{{ loadResult.type === 'success' ? t('journal.loaded') : t('journal.loadErrorTitle') }}</p>
        <p class="jn-modal-msg">{{ loadResult.message }}</p>
        <button class="jn-btn jn-modal-ok" @click="dismissLoadResult">OK</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jn-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--font-size-080);
}

.jn-empty {
  opacity: 0.75;
}

.jn-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}

.jn-order,
.jn-io {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jn-btn {
  padding: 6px 10px;
  background: transparent;
  border: 1px solid var(--white-a35);
  border-radius: var(--radius-4);
  font-size: var(--font-size-072);
  letter-spacing: 0.3px;
  color: inherit;
  cursor: pointer;
}

.jn-btn:hover:not(:disabled) {
  background: var(--white-a12);
}

.jn-btn.on {
  background: var(--white-a25);
  border-color: var(--white-a70);
}

.jn-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.jn-file-input {
  display: none;
}

.jn-autosave {
  margin: 0;
  font-size: var(--font-size-070);
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}

.jn-resume {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-4);
  background: var(--gold-a22);
  border: 1px solid var(--gold-a50);
}

.jn-resume-msg {
  margin: 0;
  line-height: 1.35;
}

.jn-resume-btns {
  display: flex;
  gap: 6px;
}

.jn-row {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-4);
  background: var(--white-a10);
  line-height: 1.35;
}

.jn-row.jn-turn {
  background: var(--gold-a22);
  font-weight: 600;
}

.jn-row.jn-phase {
  background: var(--gold-a12);
  font-style: italic;
}

.jn-row.jn-combat {
  background: var(--orange-a18);
}

.jn-row.jn-eliminate {
  background: var(--danger-a20);
}

/* Démolition d'un pont (cf. lib/useBridges.js) : même famille que les
   éliminations — c'est un élément de la carte qui disparaît. */
.jn-row.jn-demolition {
  background: var(--danger-a20);
}

/* Réparation d'un pont : l'inverse, donc la même famille que les entrées en
   jeu et les retours. */
.jn-row.jn-repair {
  background: var(--selection-a14);
}

/* Points de victoire (cf. lib/useVictoryPoints.js) : l'or de la piste de
   tour, puisque c'est de compte qu'il s'agit. */
.jn-row.jn-victory {
  background: var(--gold-a12);
}

.jn-row.jn-place,
.jn-row.jn-return {
  background: var(--selection-a14);
}

.jn-t {
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
  flex: none;
}

.jn-txt {
  flex: 1;
}

.jn-clear {
  align-self: flex-start;
  margin-top: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--white-a35);
  border-radius: var(--radius-4);
  font-size: var(--font-size-072);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: inherit;
  cursor: pointer;
}

.jn-clear:hover {
  background: var(--white-a12);
}

.jn-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-journal-modal);
  background: var(--black-a50);
  display: flex;
  align-items: center;
  justify-content: center;
}

.jn-modal {
  width: min(90vw, 360px);
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-10);
  box-shadow: var(--shadow-modal);
  padding: 20px 22px;
  border-top: 4px solid var(--color-selection);
}

.jn-modal-error {
  border-top-color: var(--color-danger);
}

.jn-modal-title {
  margin: 0 0 8px;
  font-weight: 700;
  font-size: var(--font-size-100);
}

.jn-modal-msg {
  margin: 0 0 16px;
  font-size: var(--font-size-085);
  line-height: 1.4;
}

.jn-modal-ok {
  display: block;
  margin-left: auto;
  padding: 8px 20px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
</style>
