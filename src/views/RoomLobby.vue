<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getGame } from '../lib/api.js'
import { getSocket } from '../lib/socket.js'
import HexMap from '../components/HexMap.vue'
import { resolveSettings, describeSettings, scenarioOptions } from '../lib/gameSettings.js'
import LanguageSwitcher from '../components/LanguageSwitcher.vue'
import { t, mt, errorMessage, registerModuleTexts } from '../i18n/index.js'

const props = defineProps({ id: { type: String, required: true } })

const storageKey = `wargame:room:${props.id}`

const loadingGame = ref(true)
const gameSummary = ref(null) // GET /api/games/:id result (moduleId, maxPlayers, players...)
const moduleData = ref(null) // module JSON complet (map/counters/terrain), pour le plateau une fois lancée
const sides = ref([])
const loadError = ref('')
const hexMapRef = ref(null)

const joined = ref(false)
const room = ref(null) // live room state pushed by the server (room:update / room:started)
const joinError = ref('')
const joining = ref(false)

const form = ref({ name: '', side: '', passcode: '' })
// Camp du joueur sur CE navigateur (cf. doJoin) — HexMap.vue n'affiche
// l'alerte "Temps imparti terminé" qu'au joueur dont c'est le tour.
const mySide = ref('')
// Journal partagé reçu en (re)joignant la partie (cf. HexMap.vue, prop
// `initialJournal`).
const sharedJournal = ref([])

// Réglages choisis à la création (cf. CreateGame.vue) : mêmes règles que la
// partie en local (DemoPlay.vue) — le mode "Assisté" active les garde-fous.
const scenarios = computed(() => (moduleData.value ? scenarioOptions(moduleData.value) : null))
const settings = computed(() => resolveSettings(gameSummary.value?.settings, scenarios.value))
const settingsInfo = computed(() => describeSettings(settings.value, scenarios.value))
const isAssistedParty = computed(() => settings.value.party === 'assiste')

// Un journal joué avec d'autres réglages ne peut pas être repris ici : les
// réglages d'une partie en ligne sont fixés pour tous les joueurs.
const replayWarning = ref('')
function onRestartWith() {
  replayWarning.value = t('lobby.replayWarning')
}

// Libellé lisible d'un camp (ex. "german" -> "Allemands", cf. module
// turnTrack.sides) ; à défaut, la clé du camp telle quelle.
const sideLabel = (side) => mt(moduleData.value?.turnTrack?.sides?.[side]?.label) ?? side

const takenSides = computed(() => new Set((room.value?.players ?? gameSummary.value?.players ?? []).map((player) => player.side)))
const availableSides = computed(() => sides.value.filter((side) => !takenSides.value.has(side)))

async function loadGame() {
  loadingGame.value = true
  loadError.value = ''
  try {
    gameSummary.value = await getGame(props.id)
    const modulesRes = await fetch('/modules/index.json', { cache: 'no-store' })
    const modules = await modulesRes.json()
    const modEntry = modules.find((moduleEntry) => moduleEntry.id === gameSummary.value.moduleId)
    if (modEntry) {
      const modRes = await fetch(modEntry.path, { cache: 'no-store' })
      const mod = await modRes.json()
      registerModuleTexts(mod)
      moduleData.value = mod
      // Un module regroupe ses factions (ex: commonwealth/us/pol) sous des
      // camps jouables via `sides` (ex: {"german":["german"],"allies":[...]})
      // — plusieurs factions peuvent partager un même camp en multijoueur.
      // À défaut (module sans ce champ), chaque faction devient son propre
      // camp, complété par des camps génériques pour avoir assez de choix.
      const factions = Object.keys(mod.counters ?? {})
      const campNames = mod.sides ? Object.keys(mod.sides) : factions
      const missing = Math.max(0, gameSummary.value.maxPlayers - campNames.length)
      sides.value = [...campNames, ...Array.from({ length: missing }, (_, campIndex) => t('lobby.genericSide', { n: campNames.length + campIndex + 1 }))]
    }
    form.value.side = availableSides.value[0] ?? ''
  } catch (error) {
    loadError.value = errorMessage(error.message)
  } finally {
    loadingGame.value = false
  }
}

function attachSocketListeners() {
  const socket = getSocket()
  socket.on('room:update', (roomState) => {
    if (roomState.id === props.id) room.value = roomState
  })
  socket.on('room:started', (roomState) => {
    if (roomState.id === props.id) room.value = roomState
  })
  socket.on('game:move', ({ counterId, col, row }) => {
    hexMapRef.value?.applyRemoteMove(counterId, col, row)
  })
  socket.on('game:turn', ({ turnStep }) => {
    hexMapRef.value?.applyRemoteTurn(turnStep)
  })
  socket.on('game:phase', ({ phase, step, blitzUsed }) => {
    hexMapRef.value?.applyRemotePhase(phase, step, blitzUsed)
  })
  socket.on('game:over', ({ loser, reason }) => {
    hexMapRef.value?.applyRemoteGameOver(loser, reason)
  })
  socket.on('game:log', ({ entry }) => {
    hexMapRef.value?.applyRemoteEntry(entry)
  })
  socket.on('game:unlog', ({ uid }) => {
    hexMapRef.value?.removeRemoteEntry(uid)
  })
  // FPF en ligne (cf. HexMap.vue, section "FPF en ligne") : combat soumis au
  // défenseur, sa réponse, ou l'abandon de la demande.
  socket.on('game:fpf-request', ({ request }) => {
    hexMapRef.value?.applyRemoteFpfRequest(request)
  })
  socket.on('game:fpf-reply', ({ id, fpfIds, supportIds }) => {
    hexMapRef.value?.applyRemoteFpfReply(id, fpfIds, supportIds)
  })
  socket.on('game:fpf-cancel', ({ id }) => {
    hexMapRef.value?.applyRemoteFpfCancel(id)
  })
  // Sort des ponts (cf. src/lib/useBridges.js) : l'occasion soumise au camp
  // qui doit la trancher — démolir ou réparer —, puis sa décision, que tous
  // appliquent.
  socket.on('game:bridge-request', ({ request }) => {
    hexMapRef.value?.applyRemoteBridgeRequest(request)
  })
  socket.on('game:bridge', (result) => {
    hexMapRef.value?.applyRemoteBridge(result)
  })
  socket.on('connect', () => {
    // Reconnexion (auto par socket.io après coupure réseau) : on rejoint à
    // nouveau avec les mêmes identifiants pour que le serveur nous remarque
    // comme reconnecté au lieu de créer un nouveau siège.
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (saved) doJoin(saved, true)
  })
}

function doJoin({ passcode, name, side, playerId }, silent = false) {
  return new Promise((resolve) => {
    joining.value = !silent
    joinError.value = ''
    getSocket().emit('game:join', { gameId: props.id, passcode, playerId, name, side }, (ack) => {
      joining.value = false
      if (ack.ok) {
        room.value = ack.room
        joined.value = true
        mySide.value = side
        // Plateau déjà affiché (reconnexion) : il se réaligne entièrement sur
        // le serveur — journal rejoué, pas, phase, pendules (cf.
        // HexMap.vue::resyncFromServer). Sinon, le journal sera rejoué au
        // montage du plateau.
        if (hexMapRef.value) hexMapRef.value.resyncFromServer(ack.journal, ack.room)
        else sharedJournal.value = ack.journal ?? []
        localStorage.setItem(storageKey, JSON.stringify({ passcode, name, side, playerId: ack.playerId }))
      } else if (!silent) {
        joinError.value = errorMessage(ack.error)
      }
      resolve(ack)
    })
  })
}

async function submitJoin() {
  await doJoin({ ...form.value })
}

function onLocalMove({ counterId, col, row }) {
  getSocket().emit('game:move', { gameId: props.id, counterId, col, row })
}

function onLocalPhase({ phase, step, blitzUsed }) {
  getSocket().emit('game:phase', { gameId: props.id, phase, step, blitzUsed })
}

function onLocalGameOver({ loser, text, t, reason }) {
  getSocket().emit('game:over', { gameId: props.id, loser, text, t, reason })
}

function onLocalLog(entry) {
  getSocket().emit('game:log', { gameId: props.id, entry })
}

function onLocalUnlog(uid) {
  getSocket().emit('game:unlog', { gameId: props.id, uid })
}

// FPF en ligne : le joueur actif soumet son combat au défenseur, ou y
// renonce ; le défenseur répond (cf. HexMap.vue, section "FPF en ligne").
function onFpfRequest(request) {
  getSocket().emit('game:fpf-request', { gameId: props.id, request })
}

function onFpfCancel(requestId) {
  getSocket().emit('game:fpf-cancel', { gameId: props.id, requestId })
}

function onFpfReply({ requestId, fpfIds, supportIds }) {
  getSocket().emit('game:fpf-reply', { gameId: props.id, requestId, fpfIds, supportIds })
}

/** Le plateau soumet une occasion au camp qui doit la trancher. */
function onBridgeRequest(request) {
  getSocket().emit('game:bridge-request', { gameId: props.id, request })
}

/** Le camp qui tranche publie sa décision — `{ edge, kind, ... }`. */
function onBridge(result) {
  getSocket().emit('game:bridge', { gameId: props.id, ...result })
}

// Déploiement initial (et tour de départ) proposés par le plateau : ceux que
// le serveur retient (les premiers proposés par l'un des joueurs) sont
// appliqués ici.
function onDeploy({ setup, turn }) {
  getSocket().emit('game:deploy', { gameId: props.id, entry: setup, turnEntry: turn }, (ack) => {
    for (const entry of ack?.entries ?? []) hexMapRef.value?.applyRemoteEntry(entry)
  })
}

function onLocalTurn() {
  // Le nouveau pas est déjà appliqué localement (optimiste, cf. HexMap.vue
  // -> nextTurn) ; le serveur incrémente sa propre copie et rediffuse la
  // valeur faisant autorité à tous les joueurs (soi-même inclus).
  getSocket().emit('game:turn', { gameId: props.id })
}

onMounted(async () => {
  attachSocketListeners()
  await loadGame()

  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
  if (saved) {
    const ack = await doJoin(saved)
    if (ack.ok) return
    // Les identifiants sauvegardés ne fonctionnent plus (partie recréée,
    // code changé...) : on efface et on retombe sur le formulaire.
    localStorage.removeItem(storageKey)
  }
})

onUnmounted(() => {
  const socket = getSocket()
  socket.off('room:update')
  socket.off('room:started')
  socket.off('game:move')
  socket.off('game:turn')
  socket.off('game:phase')
  socket.off('game:over')
  socket.off('game:log')
  socket.off('game:unlog')
  socket.off('game:fpf-request')
  socket.off('game:fpf-reply')
  socket.off('game:fpf-cancel')
  socket.off('game:bridge-request')
  socket.off('game:bridge')
  socket.off('connect')
})
</script>

<template>
  <div class="room-lobby">
    <div class="panel">
      <div class="page-head">
        <router-link to="/" class="back-link">&larr; {{ $t('lobby.backToGames') }}</router-link>
        <LanguageSwitcher />
      </div>

      <p v-if="loadingGame">{{ $t('lobby.loadingGame') }}</p>
      <p v-else-if="loadError" class="error">{{ loadError }}</p>

      <template v-else>
        <h1>{{ gameSummary.moduleId }} — {{ settingsInfo.scenario }}</h1>
        <p class="setup-summary">
          {{ $t('summary.scenario', { name: settingsInfo.scenario }) }}<span v-if="settingsInfo.weather"> · {{ $t('summary.weatherOn') }}</span>
          · {{ $t('summary.party', { name: settingsInfo.party }) }} · {{ $t('summary.timing', { name: settingsInfo.timing })
          }}<span v-if="settingsInfo.timingValue"> ({{ settingsInfo.timingValue }} min)</span>
        </p>
        <p v-if="replayWarning" class="error">{{ replayWarning }}</p>

        <form v-if="!joined" class="join-form" @submit.prevent="submitJoin">
          <label>
            {{ $t('lobby.nickname') }}
            <input v-model.trim="form.name" required />
          </label>
          <label>
            {{ $t('lobby.side') }}
            <select v-model="form.side" required>
              <option v-for="side in sides" :key="side" :value="side" :disabled="takenSides.has(side)">
                {{ sideLabel(side) }}{{ takenSides.has(side) ? ` (${$t('lobby.taken')})` : '' }}
              </option>
            </select>
          </label>
          <label>
            {{ $t('lobby.passcode') }}
            <input v-model.trim="form.passcode" required maxlength="6" style="text-transform: uppercase" />
          </label>
          <p v-if="joinError" class="error">{{ joinError }}</p>
          <button type="submit" :disabled="joining">{{ joining ? $t('lobby.joining') : $t('lobby.join') }}</button>
        </form>

        <div v-else class="lobby">
          <p v-if="room.status === 'lobby'" class="status waiting">
            {{ $t('lobby.waiting', { count: room.players.length, max: gameSummary.maxPlayers }) }}
          </p>
          <p v-else class="status started">{{ $t('lobby.started') }}</p>

          <ul class="players">
            <li v-for="player in room.players" :key="player.id" :class="{ me: player.side === mySide }">
              <strong>{{ player.name }}</strong>
              <span class="side">{{ sideLabel(player.side) }}</span>
              <span v-if="player.side === mySide" class="you">({{ $t('lobby.you') }})</span>
              <span class="presence" :class="player.connected ? 'online' : 'offline'">
                <span class="dot" />
                {{ player.connected ? $t('lobby.online') : $t('lobby.offline') }}
              </span>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <HexMap
      v-if="joined && room.status === 'started' && moduleData"
      ref="hexMapRef"
      class="board"
      :module="moduleData"
      :module-id="gameSummary.moduleId"
      :initial-positions="room.boardState"
      :initial-turn-step="room.turnStep ?? 0"
      :initial-phase="room.phase ?? null"
      :initial-phase-elapsed-ms="room.phaseElapsedMs ?? 0"
      :initial-blitz-used-ms="room.blitzUsedMs ?? {}"
      :initial-blitz-loser="room.blitzLoser ?? null"
      :initial-game-over-reason="room.gameOverReason ?? null"
      :initial-fpf-request="room.fpfRequest ?? null"
      :initial-bridge-log="room.bridgeLog ?? []"
      :initial-bridge-request="room.bridgeRequest ?? null"
      :local-side="mySide"
      online
      :initial-journal="sharedJournal"
      :assisted="isAssistedParty"
      :settings="settings"
      @move="onLocalMove"
      @turn="onLocalTurn"
      @phase="onLocalPhase"
      @game-over="onLocalGameOver"
      @log="onLocalLog"
      @unlog="onLocalUnlog"
      @deploy="onDeploy"
      @restart-with="onRestartWith"
      @fpf-request="onFpfRequest"
      @fpf-cancel="onFpfCancel"
      @fpf-reply="onFpfReply"
      @bridge-request="onBridgeRequest"
      @bridge="onBridge"
    />
  </div>
</template>

<style scoped>
.room-lobby {
  padding: 24px 16px;
}
.panel {
  max-width: 480px;
  margin: 0 auto;
}
.board {
  margin-top: 24px;
}
.setup-summary {
  color: var(--light-text-soft);
  font-size: var(--font-size-em-090);
}
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.back-link {
  color: var(--light-accent);
  text-decoration: none;
}
.join-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.join-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--font-size-em-090);
}
.join-form input,
.join-form select {
  padding: 8px 10px;
  border: 1px solid var(--light-border);
  border-radius: var(--radius-6);
}
.join-form button {
  padding: 10px 14px;
  border: none;
  border-radius: var(--radius-6);
  background: var(--light-accent);
  color: var(--color-white);
  cursor: pointer;
}
.join-form button:disabled {
  opacity: 0.6;
  cursor: default;
}
.error {
  color: var(--light-danger);
}
.status {
  padding: 10px 14px;
  border-radius: var(--radius-6);
  margin-top: 16px;
}
.status.waiting {
  background: var(--light-warning-bg);
  border: 1px solid var(--light-warning);
}
.status.started {
  background: var(--light-success-bg);
  border: 1px solid var(--light-success);
}
.players {
  list-style: none;
  padding: 0;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.players li {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--light-border);
  border-radius: var(--radius-6);
  padding: 8px 12px;
}
.players li.me {
  border-color: var(--light-accent);
}
.side {
  color: var(--light-text-soft);
}
.you {
  color: var(--light-accent);
  font-size: var(--font-size-em-085);
}
.presence {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: var(--font-size-em-085);
  white-space: nowrap;
}
.presence.online {
  color: var(--light-success-strong);
}
.presence.offline {
  color: var(--light-offline);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-round);
}
.presence.online .dot {
  background: var(--light-success);
}
.presence.offline .dot {
  background: var(--light-offline-dot);
}
</style>
