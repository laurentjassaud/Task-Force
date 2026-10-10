<script setup>
// Fenêtre flottante affichant l'image de la table de combat (cf. HexMap.vue,
// bouton "Table de combat" dans la toolbar). Même principe que
// MovementChartModal.vue (et RollModal.vue) : widget non-bloquant,
// déplaçable par glisser-déposer, toujours monté tant que le parent le
// garde, visibilité pilotée en v-show par le bouton toolbar.
import { ref, onMounted, onUnmounted } from 'vue'

defineProps({
  src: { type: String, required: true },
})

const pos = ref({ x: 16, y: 90 })
const dragging = ref(false)
let drag = null

function onDragStart(event) {
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
  const maxX = (window.innerWidth || 1200) - 60
  const maxY = (window.innerHeight || 800) - 40
  pos.value = { x: Math.min(Math.max(-260, nx), maxX), y: Math.min(Math.max(0, ny), maxY) }
}
function onDragEnd() {
  dragging.value = false
  drag = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

onMounted(() => {
  pos.value = { x: Math.max(16, (window.innerWidth || 1200) - 500), y: 90 }
})
onUnmounted(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
})
</script>

<template>
  <div class="chart-modal" :class="{ dragging }" :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="onDragStart">
    <div class="chart-header">{{ $t('toolbar.combatChart') }}</div>
    <img class="chart-image" :src="src" :alt="$t('toolbar.combatChart')" draggable="false" />
  </div>
</template>

<style scoped>
.chart-modal {
  position: fixed;
  z-index: var(--z-floating);
  background: var(--color-white);
  border-radius: var(--radius-10);
  box-shadow: var(--shadow-widget);
  padding: 10px;
  cursor: move;
  touch-action: none;
  user-select: none;
  max-width: min(92vw, 720px);
}
.chart-modal.dragging {
  box-shadow: var(--shadow-widget-drag);
}
.chart-header {
  font-weight: 700;
  font-size: var(--font-size-085);
  margin-bottom: 8px;
  color: var(--light-text);
  pointer-events: none;
}
.chart-image {
  display: block;
  max-width: 100%;
  height: auto;
  pointer-events: none;
  border-radius: var(--radius-4);
}
</style>
