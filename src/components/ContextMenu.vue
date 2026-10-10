<script setup>
// Menu contextuel générique (clic droit) — inspiré de ambush-tactique
// (ActionRoundTrack.vue) : positionné en fixed aux coordonnées du clic,
// téléporté dans <body> pour échapper aux ancêtres transformés (le panneau
// latéral coulissant SidePanel.vue anime via `transform`, ce qui casserait
// un `position: fixed` resté à l'intérieur), fermé au clic extérieur ou sur
// Échap, ou après le choix d'une action.
import { onMounted, onUnmounted } from 'vue'

const props = defineProps({
  leftPx: { type: Number, required: true },
  topPx: { type: Number, required: true },
  // [{ label, action, disabled?, title? }] — une entrée `disabled` reste
  // AFFICHÉE mais inerte (la règle existe, elle n'est simplement pas
  // applicable ici : `title` dit pourquoi, en infobulle).
  items: { type: Array, required: true },
})

const emit = defineEmits(['choose', 'close'])

function onWindowClick() { emit('close') }
function onKeydown(event) { if (event.key === 'Escape') emit('close') }

onMounted(() => {
  window.addEventListener('click', onWindowClick)
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('click', onWindowClick)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="ctx-menu" :style="{ left: leftPx + 'px', top: topPx + 'px' }" @click.stop @contextmenu.prevent>
      <button v-for="item in items" :key="item.label" class="ctx-item" :disabled="!!item.disabled"
        :title="item.title ?? null" @click="emit('choose', item.action)">
        {{ item.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: var(--z-overlay);
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-6);
  box-shadow: var(--shadow-menu);
  padding: 6px;
  min-width: 180px;
  font-size: var(--font-size-085);
}
.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  padding: 9px 12px;
  border-radius: var(--radius-4);
  cursor: pointer;
  font: inherit;
}
.ctx-item:hover:not(:disabled) {
  background: var(--color-orange);
  color: var(--panel-bg);
}

.ctx-item:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
