<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// Toast.vue — court message en bas de la carte, qui s'efface de lui-même
// (ex. résultat d'une reconnaissance du joueur, cf. HexMap.vue::performSearch).
//
// NON bloquant, contrairement à VictoryModal.vue : la partie continue
// dessous. Un nouveau message (`id` différent) remplace le précédent et
// relance le délai ; un clic le ferme tout de suite.
// ═══════════════════════════════════════════════════════════════════════════
import { onUnmounted, watch } from 'vue'

const props = defineProps({
  // `{ id, text }`, ou `null` (rien à montrer).
  message: { type: Object, default: null },
  duration: { type: Number, default: 5000 },
})

const emit = defineEmits(['close'])

let timer = null
watch(() => props.message?.id, (id) => {
  clearTimeout(timer)
  if (id != null) timer = setTimeout(() => emit('close'), props.duration)
}, { immediate: true })
onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <div class="toast-region" aria-live="polite">
    <Transition name="toast">
      <button v-if="message" :key="message.id" type="button" class="toast" @click="emit('close')">{{ message.text }}</button>
    </Transition>
  </div>
</template>

<style scoped>
.toast-region {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: var(--z-overlay);
  max-width: calc(100vw - 32px);
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: block;
  padding: 10px 16px;
  border: 1px solid var(--gold-a45);
  border-radius: var(--radius-8);
  background: var(--panel-bg);
  color: var(--panel-text);
  font: inherit;
  font-size: var(--font-size-095);
  text-align: left;
  box-shadow: 0 6px 20px var(--black-a40);
  cursor: pointer;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: opacity 120ms linear;
  }

  .toast-enter-from,
  .toast-leave-to {
    transform: none;
  }
}
</style>
