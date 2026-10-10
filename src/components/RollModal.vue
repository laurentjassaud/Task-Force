<script setup>
// Widget de dé flottant — inspiré de ambush-tactique/RollModal.vue, mais
// simplifié à un seul dé à 6 faces (1-6), pas de sélecteur de mode de tirage
// (l'original proposait 1 dé/2 dés/%). Toujours présent dans le DOM tant que
// le parent le monte (cf. HexMap.vue, v-show sur `showRollModal` piloté par
// le bouton "Cacher/Afficher les dés") — non bloquant (pas d'overlay, le
// reste de la page reste cliquable) et déplaçable par glisser-déposer, sans
// dépendance à lib/useDrag.js (absent de ce projet) : logique de drag
// réduite inline ci-dessous.
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // Vrai pendant un rejeu de journal (cf. HexMap.vue::replayLocked) — aucune
  // action de jeu n'est permise tant qu'il n'est pas entièrement rejoué.
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['roll'])

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

const phase = ref('idle') // idle | rolling | done
const value = ref(1)
let interval = null, timer = null

function rollValue() { return Math.floor(Math.random() * 6) + 1 }

function roll() {
  if (props.disabled) return
  phase.value = 'rolling'
  interval = setInterval(() => { value.value = rollValue() }, 55)
  timer = setTimeout(() => {
    clearInterval(interval); interval = null
    value.value = rollValue()
    phase.value = 'done'
    emit('roll', value.value)
  }, 900)
}

// --- Position flottante + drag (souris/tactile via Pointer Events) ---
const pos = ref({ x: 16, y: 560 })
const dragging = ref(false)
let drag = null

function onDragStart(event) {
  if (event.target.closest('button')) return
  dragging.value = true
  drag = { mx: event.clientX, my: event.clientY, x: pos.value.x, y: pos.value.y }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  event.preventDefault()
}
function onDragMove(event) {
  if (!dragging.value) return
  const nx = drag.x + (event.clientX - drag.mx)
  const ny = drag.y + (event.clientY - drag.my)
  const maxX = (window.innerWidth || 1200) - 90
  const maxY = (window.innerHeight || 800) - 90
  pos.value = { x: Math.min(Math.max(-260, nx), maxX), y: Math.min(Math.max(0, ny), maxY) }
}
function onDragEnd() {
  dragging.value = false
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

onMounted(() => {
  const my = (window.innerHeight || 800) - 220
  pos.value = { x: 16, y: Math.max(120, my) }
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  clearInterval(interval)
  clearTimeout(timer)
})
</script>

<template>
  <div class="dice-widget" :class="{ dragging }" :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onDragStart">
    <div class="dice-face" :class="{ rolling: phase === 'rolling', final: phase === 'done' }">
      {{ FACES[value - 1] }}
    </div>

    <div class="dice-result">
      <template v-if="phase === 'done'">{{ $t('dice.result') }} <b>{{ value }}</b></template>
      <template v-else>&nbsp;</template>
    </div>

    <button class="dice-roll-btn" :disabled="phase === 'rolling' || disabled" @click="roll">
      {{ phase === 'idle' ? $t('dice.roll') : phase === 'rolling' ? '...' : $t('dice.reroll') }}
    </button>
  </div>
</template>

<style scoped>
.dice-widget {
  position: fixed;
  z-index: var(--z-floating);
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-12);
  box-shadow: var(--shadow-widget);
  padding: 20px 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 170px;
  cursor: move;
  touch-action: none;
  user-select: none;
}

.dice-widget.dragging {
  box-shadow: var(--shadow-widget-drag);
}

.dice-face {
  font-size: var(--font-size-400);
  line-height: 1;
  pointer-events: none;
}

.dice-face.rolling {
  animation: dice-spin 0.11s linear infinite;
}

.dice-face.final {
  color: var(--color-orange);
}

@keyframes dice-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.dice-result {
  font-size: var(--font-size-090);
  min-height: 1.2em;
  pointer-events: none;
}

.dice-roll-btn {
  border: none;
  background: var(--color-orange);
  color: var(--panel-bg);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--font-size-085);
  padding: 8px 18px;
  border-radius: var(--radius-8);
  cursor: pointer;
  transition: filter 0.12s;
}

.dice-roll-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.dice-roll-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
