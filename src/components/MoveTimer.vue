<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// MoveTimer.vue — compte à rebours des modes de timing "Limité" et "Blitz"
// (cf. lib/gameSettings.js, réglage `timing` + `timingValue` en minutes).
// Seule la phase de MOUVEMENT est chronométrée, dans les deux modes.
//
//  - Limité : le joueur actif dispose de `durationSeconds` pour CHAQUE phase
//    de Mouvement ; le compteur repart à plein à chaque nouvelle phase et
//    n'est affiché que pendant celle-ci.
//  - Blitz (pendule d'échecs) : chaque camp dispose de `durationSeconds` pour
//    TOUTES ses phases de Mouvement de la partie. HexMap.vue affiche un
//    compteur par camp, toujours visible ; celui du camp actif tourne pendant
//    sa phase de Mouvement et s'arrête dès le changement de phase.
//
// Le parent (HexMap.vue) pilote le compteur :
//  - `startedAt` : heure (ms) de début de la phase de Mouvement en cours, ou
//    `null` si ce compteur est à l'arrêt. Peut être dans le passé (partie en
//    ligne rechargée en cours de phase) ;
//  - `usedMs` : temps déjà consommé AVANT cette phase (Blitz ; 0 en Limité) ;
//  - `alwaysVisible` : affiché même à l'arrêt (Blitz).
// Sous 20 secondes, le compteur clignote tant qu'il tourne ; à zéro, il émet
// `expired` (le parent ouvre alors la modale "Temps imparti terminé").
// ═══════════════════════════════════════════════════════════════════════════

import { ref, computed, watch, onUnmounted } from 'vue'

const props = defineProps({
  durationSeconds: { type: Number, required: true },
  startedAt: { type: Number, default: null },
  usedMs: { type: Number, default: 0 },
  label: { type: String, default: null },
  alwaysVisible: { type: Boolean, default: false },
})

const emit = defineEmits(['expired'])

const WARNING_SECONDS = 20

const running = computed(() => props.startedAt != null)
// Heure courante, rafraîchie par l'intervalle tant que le compteur tourne.
const now = ref(Date.now())
let intervalId = null

// Temps restant recalculé depuis des horodatages absolus (et non décrémenté
// à chaque tick) : pas de dérive si l'onglet est ralenti en arrière-plan.
const remaining = computed(() => {
  const elapsed = props.usedMs + (running.value ? Math.max(0, now.value - props.startedAt) : 0)
  return Math.max(0, Math.ceil((props.durationSeconds * 1000 - elapsed) / 1000))
})

function stop() {
  if (intervalId != null) clearInterval(intervalId)
  intervalId = null
}

function tick() {
  now.value = Date.now()
  if (remaining.value === 0) {
    stop()
    emit('expired')
  }
}

watch(
  () => [props.startedAt, props.usedMs, props.durationSeconds],
  () => {
    stop()
    if (!running.value) return
    intervalId = setInterval(tick, 250)
    tick()
  },
  { immediate: true },
)

onUnmounted(stop)

const display = computed(() => {
  const minutes = Math.floor(remaining.value / 60)
  const seconds = remaining.value % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
})
const low = computed(() => remaining.value <= WARNING_SECONDS)
const warning = computed(() => running.value && remaining.value > 0 && low.value)
</script>

<template>
  <div v-if="running || alwaysVisible" class="move-timer" :class="{ warning, low, paused: !running }"
    :title="$t('moveTimer.title')">
    <span class="mt-label">{{ label ?? $t('moveTimer.label') }}</span>
    <span class="mt-value">{{ display }}</span>
  </div>
</template>

<style scoped>
.move-timer {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  border-radius: var(--radius-6);
  background: var(--black-a25);
  color: var(--panel-text-muted);
  font-size: var(--font-size-080);
  font-weight: 600;
}

.mt-value {
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-095);
  color: var(--color-gold);
}

/* Pendule à l'arrêt (Blitz, camp qui n'est pas en Mouvement) : atténuée. */
.move-timer.paused {
  opacity: 0.55;
}

.move-timer.low .mt-value {
  color: var(--color-alert);
}

.move-timer.warning {
  animation: mt-blink 1s steps(2, start) infinite;
}

@keyframes mt-blink {
  to {
    visibility: hidden;
  }
}

@media (prefers-reduced-motion: reduce) {
  .move-timer.warning {
    animation: none;
    outline: 2px solid var(--color-alert);
  }
}
</style>
