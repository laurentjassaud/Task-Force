<script setup>
// Modale "Signaler un bug" (cf. HexMap.vue, bouton de la barre d'outils) :
// le joueur saisit un titre et une description ; "Soumettre" ouvre, dans un
// nouvel onglet, la page de création de ticket GitHub PRÉ-REMPLIE avec ce
// texte, le contexte de la partie et un export compressé de l'état du jeu
// (cf. lib/bugReport.js, qui construit tout le rapport). Il ne reste qu'à la
// valider avec son compte GitHub, puis à revenir à la partie.
//
// La partie COMPLÈTE ne tient pas dans l'URL du ticket, et GitHub ne permet
// pas d'y joindre un fichier d'avance : "Soumettre" la TÉLÉCHARGE donc aussi
// (format de l'export du journal, rechargeable), et le ticket invite le
// joueur à y glisser ce fichier. L'export compressé des derniers coups reste
// dans le ticket au cas où le fichier ne serait pas joint.
//
// "Soumettre" est un vrai LIEN (`<a target="_blank">`) plutôt qu'un
// `window.open` : l'export est compressé de façon asynchrone à l'ouverture de
// la modale, et une fenêtre ouverte après un `await` serait bloquée par
// certains navigateurs ; le lien, lui, est prêt avant le clic.
//
// Bloquante (overlay) : rien à cliquer sur la carte pendant la saisie. Un
// clic à côté ne la ferme PAS (le texte saisi serait perdu) : seuls
// "Annuler", le bouton de fermeture et Échap le font.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildIssueUrl, prepareExport, REPORT_ENTRIES } from '../lib/bugReport.js'
import { downloadJson } from '../lib/journalStorage.js'

const props = defineProps({
  // État du jeu à exporter (cf. HexMap.vue::bugReportSnapshot), avec ses
  // `entries` : les derniers coups du journal.
  snapshot: { type: Object, required: true },
  // Partie complète à télécharger, `{ name, content }` (cf.
  // JournalPanel.vue::gameFile), ou `null`.
  game: { type: Object, default: null },
  // Contexte lisible, `[[libellé, valeur], ...]` (module, réglages...).
  context: { type: Array, default: () => [] },
})

const emit = defineEmits(['close'])

const title = ref('')
const description = ref('')

// Export compressé (cf. lib/bugReport.js::prepareExport) — `null` pendant
// la compression, qui ne prend qu'un instant.
const exported = ref(null)
const failed = ref(false)

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    exported.value = await prepareExport(props.snapshot)
  } catch {
    failed.value = true
  }
})
onUnmounted(() => window.removeEventListener('keydown', onKey))

function onKey(event) {
  if (event.key === 'Escape') emit('close')
}

/** Derniers coups en clair, du plus ancien au plus récent. */
const lines = computed(() => (props.snapshot.entries ?? []).map((entry) => `${entry.t ?? ''} · ${entry.text ?? entry.kind}`))

/** Nom du fichier de la partie complète téléchargé avec le rapport, ou ''. */
const gameFileName = computed(() => (props.game ? `bug-report_${props.game.name}` : ''))

/** Ticket pré-rempli (cf. lib/bugReport.js::buildIssueUrl), ou `null` tant
 *  qu'il manque le titre ou l'export. */
const issue = computed(() => {
  if (!title.value.trim() || !exported.value) return null
  return buildIssueUrl({
    title: title.value, description: description.value, context: props.context, lines: lines.value, exported: exported.value,
    gameFileName: gameFileName.value,
  })
})

/** Clic sur "Soumettre" : télécharge la partie complète, le lien ouvre
 *  GitHub dans un nouvel onglet, puis la modale se ferme. Fermée au tour
 *  suivant seulement : retirer le lien du DOM pendant son propre clic
 *  pourrait annuler l'ouverture de l'onglet. */
function onSubmit(event) {
  if (!issue.value) {
    event.preventDefault()
    return
  }
  if (props.game) downloadJson(gameFileName.value, props.game.content)
  setTimeout(() => emit('close'), 0)
}
</script>

<template>
  <div class="br-overlay">
    <div class="br-modal" role="dialog" aria-labelledby="br-title">
      <header class="br-head">
        <h3 id="br-title">{{ $t('toolbar.bugReport') }}</h3>
        <button type="button" class="br-close" :title="$t('common.close')" @click="emit('close')">&minus;</button>
      </header>
      <p class="br-text">{{ $t('bugReport.intro') }}</p>
      <p class="br-note br-orange">{{ $t('bugReport.quick') }}</p>
      <p v-if="game" class="br-note br-red">{{ $t('bugReport.fullGame', { file: gameFileName }) }}</p>
      <p v-else class="br-note br-red">{{ $t('bugReport.lastMoves', { count: REPORT_ENTRIES }) }}</p>
      <input v-model="title" class="br-field" type="text" maxlength="120" :placeholder="$t('bugReport.titlePlaceholder')" />
      <textarea v-model="description" class="br-field" rows="3" :placeholder="$t('bugReport.descriptionPlaceholder')" />
      <!-- Ce que l'export a dû laisser de côté pour tenir dans l'URL GitHub. -->
      <p v-if="failed" class="br-warn">{{ $t('bugReport.exportFailed') }}</p>
      <p v-else-if="exported && exported.count < (snapshot.entries?.length ?? 0)" class="br-warn">
        {{ $t('bugReport.exportTrimmed', { count: exported.count }) }}
      </p>
      <p v-if="issue?.descriptionCut" class="br-warn">{{ $t('bugReport.descriptionCut') }}</p>
      <footer class="br-foot">
        <a class="br-btn" :class="{ disabled: !issue }" :href="issue?.url" target="_blank" rel="noopener noreferrer"
          :aria-disabled="!issue" @click="onSubmit">{{ $t('bugReport.submit') }}</a>
        <button type="button" class="br-btn" @click="emit('close')">{{ $t('common.cancel') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.br-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-bug-report);
  background: var(--black-a50);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.br-modal {
  width: min(960px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--tab-4-bg);
  color: var(--tab-4-ink);
  border-radius: var(--radius-4);
  box-shadow: var(--shadow-modal);
  padding: 0 12px 12px;
  overflow: hidden;
}

.br-head {
  position: relative;
  margin: 0 -12px;
  padding: 8px 48px;
  background: linear-gradient(var(--report-head-top), var(--report-head-bottom));
  border-bottom: 1px solid var(--report-divider);
  text-align: center;
}

.br-head h3 {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--font-size-170);
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--color-white);
}

.br-close {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-round);
  background: var(--report-close);
  color: var(--color-white);
  font-size: var(--font-size-110);
  line-height: 24px;
  padding: 0;
  cursor: pointer;
}

.br-close:hover {
  background: var(--report-close-hover);
}

.br-text,
.br-note,
.br-warn {
  margin: 0;
  font-family: var(--font-serif);
  font-size: var(--font-size-095);
  line-height: 1.45;
}

.br-note {
  padding: 8px 10px;
}

.br-orange {
  background: var(--report-banner-info);
}

.br-red {
  background: var(--report-banner-danger);
}

.br-warn {
  color: var(--report-warn);
  font-size: var(--font-size-085);
}

.br-field {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--report-border);
  border-radius: var(--radius-2);
  background: var(--report-field-bg);
  color: var(--report-text);
  font-family: var(--font-serif);
  font-size: var(--font-size-110);
  resize: vertical;
}

.br-field::placeholder {
  color: var(--report-placeholder);
}

.br-field:focus {
  outline: 2px solid var(--report-focus);
  outline-offset: -1px;
}

.br-foot {
  display: flex;
  gap: 10px;
}

.br-btn {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-2);
  background: var(--report-btn);
  color: var(--color-white);
  font-size: var(--font-size-125);
  text-decoration: none;
  cursor: pointer;
}

.br-btn:hover:not(.disabled) {
  background: var(--report-btn-hover);
}

.br-btn.disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
