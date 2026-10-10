<script setup>
// Contenu de l'onglet "Calendrier des renforts" — inspiré de
// ambush-tactique/src/components/PionsPanel.vue (liste de pions
// glissables) : chaque pion pas encore posé sur la carte (cf.
// HexMap.vue -> `reinforcements`) est affiché sous le tour où il arrive.
// Façon(s) de le faire entrer en jeu — dépend du mode de partie (prop
// `draggable`, cf. lib/useAssisted.js::draggable, portée par HexMap.vue) :
//  1. glisser l'image directement sur la carte, n'importe quel hex — mode
//     Libre uniquement (`draggable` vrai) ;
//  2. cliquer l'image (bordure orange ici) puis cliquer un des hex d'entrée
//     surlignés en orange sur la carte — toujours possible, mais SEULE
//     option en mode Assisté (`draggable` faux : le glisser est alors
//     désactivé ci-dessous, à la fois visuellement — attribut HTML
//     `draggable` retiré — et fonctionnellement, cf. le guard côté
//     HexMap.vue::onCounterDragStart qui refuserait de toute façon un
//     glisser qui aurait quand même démarré).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  reinforcements: { type: Array, required: true }, // pions avec `setup` non encore posés
  selectedId: { type: [String, Number], default: null }, // pion choisi via le système 2 (clic)
  currentTurn: { type: Number, default: 1 }, // tour courant — interdit l'entrée en jeu en avance
  // Cf. lib/useAssisted.js::draggable — faux en mode Assisté (clic
  // uniquement), vrai en mode Libre (glisser-déposer uniquement).
  draggable: { type: Boolean, default: true },
  // Cf. lib/useAssisted.js::canPlaceReinforcementNow — le renfort peut-il
  // être posé DANS LA PHASE EN COURS (phase Airborne : aéroportés
  // seulement ; autres phases : tout sauf eux) ? Absent : aucune
  // restriction de phase.
  canPlace: { type: Function, default: null },
})

const emit = defineEmits(['dragstart', 'select'])

/** Un renfort n'est jouable qu'à partir de son tour d'arrivée déclaré, et
 *  seulement dans une phase qui l'autorise (cf. prop `canPlace`). */
function isAvailable(counter) {
  return (counter.turn ?? 1) <= props.currentTurn && (props.canPlace?.(counter) ?? true)
}
/** Info-bulle d'un renfort grisé : pourquoi il ne peut pas entrer en jeu. */
function unavailableReason(counter) {
  if ((counter.turn ?? 1) > props.currentTurn) return t('reinforcements.arrivesOnTurn', { turn: counter.turn })
  if (props.canPlace && !props.canPlace(counter)) return t('reinforcements.notThisPhase')
  return ''
}
function onDragStart(counter, ev) {
  if (!isAvailable(counter)) { ev.preventDefault(); return }
  emit('dragstart', counter.id, ev)
}
function onSelect(counter) {
  if (!isAvailable(counter)) return
  emit('select', counter.id)
}

/** Groupes { turn, items } triés par tour croissant. */
const groups = computed(() => {
  const byTurn = new Map()
  for (const counter of props.reinforcements) {
    const turn = counter.turn ?? 1
    if (!byTurn.has(turn)) byTurn.set(turn, [])
    byTurn.get(turn).push(counter)
  }
  return [...byTurn.entries()].sort((turnEntryA, turnEntryB) => turnEntryA[0] - turnEntryB[0]).map(([turn, items]) => ({ turn, items }))
})
</script>

<template>
  <div class="rf-list">
    <p v-if="!reinforcements.length" class="rf-empty">{{ t('reinforcements.empty') }}</p>
    <section v-for="group in groups" :key="group.turn" class="rf-turn">
      <!-- Tour 0 : pions de la mise en place (cf. lib/turnTrack.js, `setup`). -->
      <h3 class="rf-turn-title">{{ group.turn === 0 ? t('reinforcements.setup') : t('reinforcements.turn', { turn: group.turn }) }}</h3>
      <div class="rf-grid">
        <figure v-for="counter in group.items" :key="counter.id" class="rf-piece">
          <img :src="counter.src" :alt="counter.name" width="48" height="48" :draggable="draggable && isAvailable(counter)"
            :class="{ 'rf-selected': String(counter.id) === String(selectedId), 'rf-unavailable': !isAvailable(counter) }"
            :title="unavailableReason(counter)"
            @dragstart="onDragStart(counter, $event)" @click="onSelect(counter)" />
          <!-- Indication d'hex : pure information, pas de drag & drop (seule
               l'image ci-dessus déclenche dragstart/select). -->
          <!-- Pion en nombre illimité (`multiple`) : il reste dans le panneau
               après chaque pose. "*" (pose n'importe où) n'a rien à indiquer. -->
          <figcaption v-if="counter.multiple" class="rf-hex rf-unlimited" :title="t('reinforcements.unlimited')">∞</figcaption>
          <figcaption v-else-if="counter.setup !== '*'" class="rf-hex">{{ counter.setup }}</figcaption>
        </figure>
      </div>
    </section>
    <p class="rf-hint">
      {{ draggable ? t('reinforcements.hintDrag') : t('reinforcements.hintClick') }}
    </p>
  </div>
</template>

<style scoped>
.rf-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: var(--font-size-085);
}
.rf-empty {
  opacity: 0.75;
}
.rf-turn-title {
  margin: 0 0 8px;
  font-size: var(--font-size-095);
  font-weight: 600;
}
.rf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 10px;
}
.rf-piece {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.rf-piece img {
  border-radius: var(--radius-4);
  background: var(--white-a15);
  cursor: grab;
  border: 3px solid transparent;
  box-sizing: border-box;
}
.rf-piece img.rf-selected {
  border-color: var(--color-orange);
}
.rf-piece img.rf-unavailable {
  opacity: 0.4;
  cursor: not-allowed;
}
.rf-hex.rf-unlimited {
  font-size: var(--font-size-095);
  font-weight: 700;
  opacity: 1;
}
.rf-hex {
  font-size: var(--font-size-068);
  line-height: 1.2;
  word-break: break-word;
  opacity: 0.75;
}
.rf-hint {
  font-size: var(--font-size-072);
  opacity: 0.75;
  line-height: 1.4;
  margin: 0;
}
</style>
