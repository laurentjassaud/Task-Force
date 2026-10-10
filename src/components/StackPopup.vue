<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// StackPopup.vue — fenêtre de survol d'une pile : montre, en grand et côte à
// côte, tous les pions d'un hex qui en porte plusieurs (unités, marqueurs DZ,
// pions de soutien...), que l'empilement sur la carte masque en partie.
// Ne connaît rien des règles : HexMap.vue lui passe la pile déjà triée (du
// dessus vers le dessous, cf. `hoveredStackCounters`) et le rectangle écran
// du pion survolé, à côté duquel elle s'affiche.
//
// Téléportée dans <body> pour la même raison que ContextMenu.vue (ancêtres
// transformés), et transparente à la souris (`pointer-events: none`) : elle
// ne doit ni voler le survol du pion qu'elle décrit, ni gêner un clic.
// ═══════════════════════════════════════════════════════════════════════════

import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  // Pions de la pile, du dessus vers le dessous — [{ id, src, name }].
  counters: { type: Array, required: true },
  // Rectangle écran du pion survolé — { left, top, right, bottom }.
  anchor: { type: Object, required: true },
  title: { type: String, default: '' },
})

const GAP = 10
const popupRef = ref(null)
const position = ref({ left: 0, top: 0 })

/** À droite du pion survolé, ou à sa gauche si la fenêtre sortirait de
 *  l'écran ; alignée sur son haut, sans déborder en bas. Recalculée une fois
 *  la fenêtre rendue, sa taille dépendant du nombre de pions. */
function place() {
  const popup = popupRef.value
  if (!popup) return
  const { width, height } = popup.getBoundingClientRect()
  const { anchor } = props
  const left = anchor.right + GAP + width <= window.innerWidth ? anchor.right + GAP : Math.max(GAP, anchor.left - GAP - width)
  const top = Math.max(GAP, Math.min(anchor.top, window.innerHeight - GAP - height))
  position.value = { left, top }
}

watch(() => [props.anchor, props.counters.length], () => nextTick(place), { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div ref="popupRef" class="stack-popup" :style="{ left: position.left + 'px', top: position.top + 'px' }">
      <div v-if="title" class="sp-title">{{ title }}</div>
      <div class="sp-counters">
        <figure v-for="counter in counters" :key="counter.id" class="sp-counter">
          <img :src="counter.src" :alt="counter.name" class="sp-img" />
          <figcaption class="sp-name">{{ counter.name }}</figcaption>
        </figure>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.stack-popup {
  position: fixed;
  z-index: var(--z-overlay);
  pointer-events: none;
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-6);
  box-shadow: var(--shadow-menu);
  padding: 8px 10px 6px;
}

.sp-title {
  color: var(--panel-text-muted);
  font-size: var(--font-size-075);
  font-weight: 600;
  margin-bottom: 6px;
  white-space: nowrap;
}

.sp-counters {
  display: flex;
  gap: 8px;
}

.sp-counter {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.sp-img {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-4);
}

.sp-name {
  max-width: 64px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-070);
  color: var(--panel-text-muted);
}
</style>
