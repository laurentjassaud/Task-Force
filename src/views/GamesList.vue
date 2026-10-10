<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { listGames } from '../lib/api.js'
import { resolveSettings, describeSettings } from '../lib/gameSettings.js'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import { errorMessage } from '../i18n/index.js'

const infoOf = (game) => describeSettings(resolveSettings(game.settings ?? { scenario: game.scenarioId }))

const route = useRoute()
const games = ref([])
const loading = ref(true)
const error = ref('')

// Juste après la création d'une partie, on affiche son passcode une seule
// fois (il n'est jamais renvoyé par l'API ensuite) pour que le créateur
// puisse le transmettre aux autres joueurs.
const justCreated = ref(
  route.query.created ? { id: route.query.created, passcode: route.query.passcode } : null
)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    games.value = await listGames()
  } catch (requestError) {
    error.value = errorMessage(requestError.message)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="games-list">
    <header>
      <h1>{{ $t('gamesList.title') }}</h1>
      <div class="header-links">
        <router-link to="/local" class="button-link secondary">{{ $t('gamesList.localGame') }}</router-link>
        <router-link to="/create" class="button-link">{{ $t('gamesList.createGame') }}</router-link>
        <LanguageSwitcher />
      </div>
    </header>

    <i18n-t v-if="justCreated" keypath="gamesList.created" tag="p" class="passcode-banner">
      <template #room><strong>{{ justCreated.id }}</strong></template>
      <template #passcode><strong>{{ justCreated.passcode }}</strong></template>
    </i18n-t>

    <p v-if="loading">{{ $t('common.loading') }}</p>
    <p v-if="error" class="error">{{ error }}</p>

    <ul v-if="!loading && games.length" class="cards">
      <li v-for="game in games" :key="game.id">
        <router-link :to="{ name: 'room-lobby', params: { id: game.id } }" class="card">
          <div class="card-title">{{ game.moduleId }} — {{ infoOf(game).scenario }}</div>
          <div class="card-meta">
            {{ $t('gamesList.players', { count: game.playerCount, max: game.maxPlayers }) }} · {{ $te(`gamesList.status.${game.status}`) ? $t(`gamesList.status.${game.status}`) : game.status }}
          </div>
          <div class="card-variants">
            {{ $t('summary.party', { name: infoOf(game).party }) }} · {{ $t('summary.timing', { name: infoOf(game).timing })
            }}<template v-if="infoOf(game).timingValue"> ({{ infoOf(game).timingValue }} min)</template><template
              v-if="infoOf(game).weather"> · {{ $t('setup.weather') }}</template>
          </div>
          <div v-if="game.variants.length" class="card-variants">
            {{ $t('gamesList.variants', { list: game.variants.join(', ') }) }}
          </div>
        </router-link>
      </li>
    </ul>
    <p v-else-if="!loading">{{ $t('gamesList.empty') }}</p>
  </div>
</template>

<style scoped>
.games-list {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.header-links {
  display: flex;
  gap: 10px;
}
.button-link {
  padding: 8px 14px;
  border-radius: var(--radius-6);
  background: var(--light-accent);
  color: var(--color-white);
  text-decoration: none;
}
.button-link.secondary {
  background: transparent;
  color: var(--light-accent);
  border: 1px solid var(--light-accent);
}
.passcode-banner {
  background: var(--light-success-bg);
  border: 1px solid var(--light-success);
  padding: 10px 14px;
  border-radius: var(--radius-6);
}
.error {
  color: var(--light-danger);
}
.cards {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  display: block;
  border: 1px solid var(--light-border);
  border-radius: var(--radius-6);
  padding: 12px 14px;
  color: inherit;
  text-decoration: none;
}
.card:hover {
  border-color: var(--light-accent);
}
.card-title {
  font-weight: 600;
}
.card-meta {
  color: var(--light-text-muted);
  font-size: var(--font-size-em-090);
}
.card-variants {
  color: var(--light-text-muted);
  font-size: var(--font-size-em-085);
  margin-top: 4px;
}
</style>
