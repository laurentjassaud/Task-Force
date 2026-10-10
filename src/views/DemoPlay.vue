<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HexMap from '../components/HexMap.vue'
import { stashPendingReplay } from '../lib/journalStorage.js'
import { resolveSettings, describeSettings, scenarioOptions } from '../lib/gameSettings.js'
import { registerModuleTexts } from '../i18n/index.js'
import { APP_RELEASE, APP_VERSION } from '../lib/bugReport.js'

// Chargement direct d'un module en local, sans passer par le lobby
// multijoueur — pratique pour tester le moteur de jeu (HexMap) seul.
// Le choix du module/scénario/options vient de l'assistant LocalGameSetup.vue
// (query string) ; si absent (accès direct à /demo), on retombe sur Arnhem.

const route = useRoute()
const router = useRouter()
const module = ref(null)
const moduleId = ref('')

// Réglages de la partie, lus dans l'URL. COMPUTED (et non figés au
// chargement) : reprendre une sauvegarde faite avec d'autres réglages
// change l'URL sans recréer cette page (cf. `restartWith`).
// Scénarios du module (cf. lib/gameSettings.js::scenarioOptions) : un
// scénario indisponible demandé par l'URL retombe sur le premier disponible.
const scenarios = computed(() => (module.value ? scenarioOptions(module.value) : null))
const settings = computed(() => resolveSettings(route.query, scenarios.value))
const settingsInfo = computed(() => describeSettings(settings.value, scenarios.value))
// "Assisté" est le seul mode qui active les garde-fous (grille, sélection au
// clic, restriction de tour — cf. lib/useAssisted.js) ; toute autre valeur
// (dont l'absence) reste "Libre", le comportement par défaut de HexMap.vue.
const isAssistedParty = computed(() => settings.value.party === 'assiste')

// Clé de la carte : change avec les réglages, ce qui la REMONTE à neuf —
// une partie ne change jamais de mode en cours de route (les règles du mode
// Assisté supposent une partie jouée avec elles depuis le début).
const mapKey = computed(() => JSON.stringify(settings.value))

/** Un journal à reprendre a été joué avec d'autres réglages (cf.
 *  JournalPanel.vue::startReplay) : on le met de côté, puis on relance la
 *  partie avec ces réglages ; la carte remontée le rejoue au montage (cf.
 *  HexMap.vue, `resumePending`). */
function restartWith({ settings: saved, entries, message }) {
  stashPendingReplay(entries, message)
  router.replace({ query: { ...route.query, ...saved, module: moduleId.value } })
}

onMounted(async () => {
  moduleId.value = route.query.module || 'arnhem'
  const index = await fetch('/modules/index.json', { cache: 'no-store' }).then((response) => response.json())
  const entry = index.find((moduleEntry) => moduleEntry.id === moduleId.value) ?? index.find((moduleEntry) => moduleEntry.id === 'arnhem')
  const res = await fetch(entry.path, { cache: 'no-store' })
  const data = await res.json()
  registerModuleTexts(data)
  module.value = data
  document.title = module.value.name
  if (module.value.favicon) {
    let link = document.querySelector('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = module.value.favicon
  }
})
</script>

<template>
  <div class="app">
    <p v-if="module" class="setup-banner"><span class="version" :title="APP_VERSION">v. {{ APP_RELEASE }}</span>
      {{ $t('summary.scenario', { name: settingsInfo.scenario }) }}<span v-if="settingsInfo.weather"> · {{ $t('summary.weatherOn') }}</span>
      · {{ $t('summary.party', { name: settingsInfo.party }) }} · {{ $t('summary.timing', { name: settingsInfo.timing })
      }}<span v-if="settingsInfo.timingValue"> ({{ settingsInfo.timingValue }} min)</span>
    </p>
    <HexMap v-if="module" :key="mapKey" :module="module" :module-id="moduleId" :assisted="isAssistedParty"
      :settings="settings" @restart-with="restartWith" />
  </div>
</template>

<style scoped>
.app {
  max-width: none;
  display: block;
}
.setup-banner {
  margin: 0;
  padding: 6px 12px;
  font-size: var(--font-size-em-085);
  color: var(--light-text-soft);
  background: var(--light-bg-muted);
  border-bottom: 1px solid var(--light-border-soft);
}
</style>
