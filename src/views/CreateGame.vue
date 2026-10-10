<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { createGame } from '../lib/api.js'
import GameSetupSteps from '../components/GameSetupSteps.vue'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import { t, errorMessage, registerModuleTexts } from '../i18n/index.js'
import { defaultSettings, timingNeedsValue } from '../lib/gameSettings.js'
import { stepSequence, resolveTrack } from '../lib/turnTrack.js'

const router = useRouter()

// Mêmes étapes que la partie en local (cf. GameSetupSteps.vue), plus le
// nombre de joueurs de la room.
const step = ref(1)
const totalSteps = 5

const selectedModuleId = ref('')
const selectedModule = ref(null) // full module JSON, fetched once chosen
const settings = ref(defaultSettings())
const maxPlayers = ref(2)

const loadingModule = ref(false)
const submitting = ref(false)
const error = ref('')

const playerRange = computed(() => ({
  min: selectedModule.value?.minPlayers ?? 2,
  max: selectedModule.value?.maxPlayers ?? 2,
}))

// Le module complet n'est chargé que pour connaître sa plage de joueurs.
watch(selectedModuleId, async (id) => {
  loadingModule.value = true
  error.value = ''
  try {
    const index = await fetch('/modules/index.json', { cache: 'no-store' }).then((res) => res.json())
    const entry = index.find((moduleEntry) => moduleEntry.id === id)
    selectedModule.value = await fetch(entry.path, { cache: 'no-store' }).then((res) => res.json())
    registerModuleTexts(selectedModule.value)
    maxPlayers.value = playerRange.value.min
  } catch {
    error.value = t('setup.moduleLoadError')
  } finally {
    loadingModule.value = false
  }
})

const canNext = computed(() => {
  if (step.value === 1) return !!selectedModule.value && !loadingModule.value
  if (step.value === 4 && timingNeedsValue(settings.value.timing)) return !!settings.value.timingValue
  if (step.value === 5) return maxPlayers.value >= playerRange.value.min && maxPlayers.value <= playerRange.value.max
  return true
})

function next() {
  if (step.value < totalSteps) step.value += 1
}
function back() {
  if (step.value > 1) step.value -= 1
}

async function submit() {
  submitting.value = true
  error.value = ''
  try {
    const game = await createGame({
      moduleId: selectedModuleId.value,
      scenarioId: settings.value.scenario,
      settings: settings.value,
      maxPlayers: maxPlayers.value,
      // Ordre des camps de la piste de tour, déplié pas par pas quand
      // l'initiative change d'un tour à l'autre (cf. lib/turnTrack.js) : le
      // serveur ne charge pas les modules, c'est ce qui lui permet de savoir
      // à qui est le tour et de refuser les coups de l'autre joueur (cf.
      // server/src/rooms.js::isPlayersTurn).
      turnOrder: stepSequence(resolveTrack(selectedModule.value)),
    })
    router.push({ name: 'games-list', query: { created: game.id, passcode: game.passcode } })
  } catch (requestError) {
    error.value = errorMessage(requestError.message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="wizard">
    <div class="page-head">
      <h1>{{ $t('createGame.title') }}</h1>
      <LanguageSwitcher />
    </div>
    <p class="step-indicator">{{ $t('setup.stepOf', { step, total: totalSteps }) }}</p>

    <GameSetupSteps v-model:module-id="selectedModuleId" v-model:settings="settings" :step="step">
      <template #module-status>
        <p v-if="loadingModule">{{ $t('setup.loadingModule') }}</p>
      </template>
    </GameSetupSteps>

    <section v-if="step === 5">
      <h2>{{ $t('createGame.playerCount') }}</h2>
      <input
        type="number"
        v-model.number="maxPlayers"
        :min="playerRange.min"
        :max="playerRange.max"
      />
      <p class="hint">{{ $t('createGame.playerRange', playerRange) }}</p>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="actions">
      <button type="button" :disabled="step === 1" @click="back">{{ $t('common.back') }}</button>
      <button v-if="step < totalSteps" type="button" :disabled="!canNext" @click="next">{{ $t('common.next') }}</button>
      <button v-else type="button" :disabled="!canNext || submitting" @click="submit">
        {{ submitting ? $t('createGame.creating') : $t('createGame.create') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.wizard {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 16px;
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.step-indicator {
  color: var(--light-text-muted);
  margin-top: -8px;
}
.hint {
  color: var(--light-text-muted);
  font-size: var(--font-size-em-090);
}
.error {
  color: var(--light-danger);
}
.actions {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
}
</style>
