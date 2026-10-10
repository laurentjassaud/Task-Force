<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { PARTY_OPTIONS, TIMING_OPTIONS, TIMING_HINTS, WEATHER_AVAILABLE, timingNeedsValue, timingAllowed, scenarioOptions } from '../lib/gameSettings.js'
import { registerModuleTexts } from '../i18n/index.js'

// Étapes 1 à 4 de la création d'une partie, communes au local
// (LocalGameSetup.vue) et à l'en ligne (CreateGame.vue) : module, scénario,
// options, mode de jeu. Le parent gère la navigation (`step`) et reçoit le
// module choisi et les réglages (format lib/gameSettings.js) via v-model.

defineProps({ step: { type: Number, required: true } })

const moduleId = defineModel('moduleId', { type: String, default: '' })
const settings = defineModel('settings', { type: Object, required: true })

const modules = ref([])
// JSON du module choisi (étape 1) — pour ses scénarios (cf.
// gameSettings.js::scenarioOptions) ; `null` tant qu'il n'est pas chargé.
const moduleData = ref(null)
const scenarios = computed(() => scenarioOptions(moduleData.value))

const scenario = ref(settings.value.scenario)
const weather = ref(settings.value.weather === '1')
const party = ref(settings.value.party)
const timing = ref(settings.value.timing)
const timingValue = ref(settings.value.timingValue ? Number(settings.value.timingValue) : null)

// Chargement du module choisi, pour lister SES scénarios à l'étape 2.
watch([moduleId, modules], async ([id, list]) => {
  const entry = list.find((mod) => mod.id === id)
  if (!entry) { moduleData.value = null; return }
  try {
    const data = await fetch(entry.path, { cache: 'no-store' }).then((res) => res.json())
    registerModuleTexts(data)
    if (moduleId.value === id) moduleData.value = data
  } catch {
    moduleData.value = null
  }
})

// Changement de module : un scénario qui n'existe pas (ou n'est pas
// disponible) dans le nouveau module est remplacé par son premier scénario
// disponible.
watch(scenarios, (list) => {
  if (!list.some((option) => option.id === scenario.value && option.available)) {
    scenario.value = list.find((option) => option.available)?.id ?? scenario.value
  }
})

// Un scénario peut rendre la météo obligatoire (`weather: 'required'`, ex. le
// placement libre d'Arnhem : pas de conditions historiques connues à
// appliquer par défaut).
const weatherRequired = computed(() => scenarios.value.find((option) => option.id === scenario.value)?.weather === 'required')
watch(weatherRequired, (required) => {
  if (required) weather.value = true
})

// Une seule valeur saisie à la fois : on la réinitialise si l'utilisateur
// change de timing pour éviter de renvoyer une ancienne valeur incohérente.
watch(timing, () => {
  timingValue.value = null
})

// Le chronomètre n'existe qu'en partie Assistée (cf. gameSettings.js::
// timingAllowed) : repasser en Libre remet le timing à "Libre", les autres
// choix étant grisés (cf. template).
watch(party, (val) => {
  if (!timingAllowed(val)) timing.value = 'libre'
})

watch([scenario, weather, party, timing, timingValue], () => {
  settings.value = {
    scenario: scenario.value,
    weather: weather.value ? '1' : '0',
    party: party.value,
    timing: timing.value,
    timingValue: timingNeedsValue(timing.value) && timingValue.value > 0 ? String(timingValue.value) : '',
  }
})

onMounted(async () => {
  const res = await fetch('/modules/index.json', { cache: 'no-store' })
  modules.value = await res.json()
})

function chooseModule(mod) {
  if (mod.active === false) return
  moduleId.value = mod.id
}
</script>

<template>
  <section v-if="step === 1">
    <h2>{{ $t('setup.chooseModule') }}</h2>
    <ul class="choice-list">
      <li v-for="mod in modules" :key="mod.id">
        <button
          type="button"
          :class="{ selected: moduleId === mod.id }"
          :disabled="mod.active === false"
          @click="chooseModule(mod)"
        >
          {{ mod.name }}
          <span v-if="mod.active === false" class="badge">{{ $t('common.comingSoon') }}</span>
        </button>
      </li>
    </ul>
    <slot name="module-status" />
  </section>

  <section v-else-if="step === 2">
    <h2>{{ $t('setup.chooseScenario') }}</h2>
    <ul class="choice-list">
      <li v-for="opt in scenarios" :key="opt.id">
        <button type="button" :class="{ selected: scenario === opt.id }" :disabled="opt.available === false"
          @click="scenario = opt.id">
          {{ opt.label }}
          <span v-if="opt.available === false" class="badge">{{ $t('common.comingSoon') }}</span>
        </button>
      </li>
    </ul>
  </section>

  <section v-else-if="step === 3">
    <h2>{{ $t('setup.options') }}</h2>
    <label class="checkbox-choice" :class="{ disabled: !WEATHER_AVAILABLE || weatherRequired }">
      <input type="checkbox" v-model="weather" :disabled="!WEATHER_AVAILABLE || weatherRequired" />
      {{ $t('setup.weather') }}
      <span v-if="!WEATHER_AVAILABLE" class="badge">{{ $t('common.comingSoon') }}</span>
    </label>
    <p v-if="!WEATHER_AVAILABLE" class="hint">{{ $t('setup.weatherNotYet') }}</p>
    <p v-else-if="weatherRequired" class="hint">{{ $t('setup.weatherRequired') }}</p>
  </section>

  <section v-else-if="step === 4">
    <h2>{{ $t('setup.gameMode') }}</h2>

    <h3>{{ $t('setup.party') }}</h3>
    <ul class="choice-list">
      <li v-for="opt in PARTY_OPTIONS" :key="opt.id">
        <label class="checkbox-choice">
          <input type="radio" name="party" :value="opt.id" v-model="party" />
          {{ opt.label }}
        </label>
      </li>
    </ul>

    <h3>{{ $t('setup.timing') }}</h3>
    <ul class="choice-list">
      <li v-for="opt in TIMING_OPTIONS" :key="opt.id">
        <label class="checkbox-choice" :class="{ disabled: opt.id !== 'libre' && !timingAllowed(party) }">
          <input type="radio" name="timing" :value="opt.id" v-model="timing" :disabled="opt.id !== 'libre' && !timingAllowed(party)" />
          {{ opt.label }}
        </label>
      </li>
    </ul>
    <p v-if="!timingAllowed(party)" class="hint">{{ $t('settings.timingLocked') }}</p>
    <div v-if="timingNeedsValue(timing)" class="timing-value">
      <label>
        {{ timing === 'limite' ? $t('setup.limitedDuration') : $t('setup.blitzDuration') }}
        <input type="number" min="1" v-model.number="timingValue" />
      </label>
      <p class="hint">{{ TIMING_HINTS[timing] }}</p>
    </div>
  </section>
</template>

<style scoped>
.choice-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.choice-list button {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--light-border);
  border-radius: var(--radius-6);
  background: var(--color-white);
  cursor: pointer;
}
.choice-list button.selected {
  border-color: var(--light-accent);
  background: var(--light-accent-bg);
}
.choice-list button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.badge {
  margin-left: 8px;
  font-size: var(--font-size-em-075);
  color: var(--light-text-muted);
}
.checkbox-choice {
  display: flex;
  align-items: center;
  gap: 8px;
}
.checkbox-choice.disabled {
  color: var(--light-text-faint);
}
.hint {
  color: var(--light-text-muted);
  font-size: var(--font-size-em-090);
}
h3 {
  margin: 16px 0 8px;
  font-size: var(--font-size-em-100);
}
.timing-value {
  margin-top: 12px;
}
.timing-value input {
  margin-left: 8px;
  width: 80px;
  padding: 4px 6px;
}
</style>
