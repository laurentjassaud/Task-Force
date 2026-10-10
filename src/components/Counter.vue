<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// Counter.vue — un pion posé sur la carte hexagonale. Composant SVG (à
// utiliser DANS le <svg> de HexMap.vue, en tant que <g>) : image de fond +
// anneau vert de sélection. Ne connaît rien des règles de jeu — uniquement
// sa propre géométrie (position pixel déduite de col/row + calibration) et
// deux événements bruts (`select`, `dragstart`) que le parent interprète.
// ═══════════════════════════════════════════════════════════════════════════

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  id: { type: [String, Number], required: true },
  src: { type: String, required: true },       // image du pion
  col: { type: Number, required: true },        // hex courant — 0-based
  row: { type: Number, required: true },        // hex courant — 1-based
  calibration: { type: Object, required: true }, // { x0,y0,colStep,a,rowStep } — cf. lib/calibration.js
  selected: { type: Boolean, default: false },
  // Vrai si ce pion a bougé pendant le tour en cours (cf. HexMap.vue,
  // `movedThisTurnIds`) — liseré orange 1px, effacé en fin de tour ou par
  // "Annuler le mouvement" (menu contextuel).
  moved: { type: Boolean, default: false },
  // Vrai si ce pion a déjà combattu pendant la phase en cours (cf.
  // lib/useCombat.js::hasFought) — ROND ROUGE en haut à GAUCHE (le coin
  // droit est réservé aux points d'état de l'artillerie ci-dessous).
  spent: { type: Boolean, default: false },
  // Artillerie (cf. lib/useArtillery.js) : a subi un résultat de combat
  // pendant cette phase de Combat ou la précédente — POINT ROUGE en haut à
  // droite, plus de FPF possible.
  disrupted: { type: Boolean, default: false },
  // Artillerie refoulée par une retraite amie pendant cette phase de Combat
  // — POINT ORANGE : elle ne peut plus tirer (ni barrage, ni FPF).
  displaced: { type: Boolean, default: false },
  // Vrai si ce pion n'a plus de ligne de communication (cf.
  // lib/useSupplyLine.js, montré en phase de Fin de tour) — ANNEAU ROUGE
  // autour du pion, à ne pas confondre avec le rond rouge de "a combattu".
  unsupplied: { type: Boolean, default: false },
  size: { type: Number, default: 0.8 },         // taille du pion, fraction du pas de ligne (rowStep)
  // Faux (marqueurs type DZ, cf. HexMap.vue) : pas de sélection ni de
  // déplacement par clic sur hex adjacent — reste librement déplaçable en
  // drag & drop, qui ne passe pas par `select`. Un clic sur un tel pion vaut
  // clic sur son HEX (`hex-click`) : son image recouvre le polygone de l'hex,
  // qui sinon ne recevrait jamais le clic.
  selectable: { type: Boolean, default: true },
  // Décalage visuel en cas d'empilement de plusieurs pions sur le même hex
  // (cf. `stackOffsets` dans HexMap.vue) — fraction de la taille du pion.
  offset: { type: Object, default: () => ({ dx: 0, dy: 0 }) },
  // Position pixel SVG live pendant un glisser "souris" en cours (cf.
  // dragCurrentPx dans HexMap.vue) — remplace le centre calculé depuis
  // col/row tant que ce pion est celui suivi par le glisser.
  dragPx: { type: Object, default: null },
  // Étiquette secrète sous le pion (cf. HexMap.vue::privateLabelOf — ex.
  // vraie identité d'un leurre à la mer de Corail), ou `null`.
  label: { type: String, default: null },
})

// `hover`/`unhover` : entrée/sortie de la souris sur l'image — cf.
// HexMap.vue::onCounterHover (fenêtre de survol d'une pile).
const emit = defineEmits(['select', 'hex-click', 'dragstart', 'contextmenu', 'hover', 'unhover'])

/** Centre pixel du pion — même formule que HexMap.vue (grille flat-top, offset odd-q) — plus le décalage d'empilement. */
const center = computed(() => {
  if (props.dragPx) return props.dragPx
  const { x0, y0, colStep, rowStep } = props.calibration
  const yoff = props.col % 2 === 1 ? rowStep / 2 : 0
  const counterSizePx = rowStep * props.size
  return {
    x: x0 + props.col * colStep + props.offset.dx * counterSizePx,
    y: y0 + (props.row - 1) * rowStep + yoff + props.offset.dy * counterSizePx,
  }
})
const counterSizePx = computed(() => props.calibration.rowStep * props.size)

// Points d'état du pion :
//   - coin haut GAUCHE : rond rouge "a combattu pendant cette phase" (prop
//     `spent`) ;
//   - coin haut DROIT : points de l'artillerie (props `disrupted`/
//     `displaced`) — rouge au coin, orange juste à sa gauche.
const dotRadius = computed(() => counterSizePx.value * 0.09)
const dots = computed(() => {
  const radius = dotRadius.value
  const top = center.value.y - counterSizePx.value / 2 + radius + 1
  const list = []
  if (props.spent) list.push({ key: 'fought', cls: 'dot-fought', cx: center.value.x - counterSizePx.value / 2 + radius + 1, cy: top })
  const right = []
  if (props.disrupted) right.push({ key: 'hit', cls: 'dot-disrupted' })
  if (props.displaced) right.push({ key: 'pushed', cls: 'dot-displaced' })
  right.forEach((dot, index) => list.push({
    ...dot,
    cx: center.value.x + counterSizePx.value / 2 - radius - 1 - index * radius * 2.4,
    cy: top,
  }))
  return list
})
const dotTitle = computed(() => [
  props.spent ? t('counter.fought') : null,
  props.disrupted ? t('counter.disrupted') : null,
  props.displaced ? t('counter.displaced') : null,
].filter(Boolean).join(' — '))

function onClick() {
  emit(props.selectable ? 'select' : 'hex-click', props.id)
}

/** Démarre le glisser au clic gauche — cf. HexMap.vue::onCounterDragStart :
 *  le DnD natif HTML5 (`draggable`/`dragstart`) ne se déclenche pas de façon
 *  fiable sur une <image> SVG, donc on suit la souris nous-mêmes plutôt que
 *  de compter sur l'événement natif. */
function onMouseDown(ev) {
  if (ev.button !== 0) return
  ev.preventDefault()
  emit('dragstart', props.id, ev)
}
</script>

<template>
  <g class="counter" :class="{ selected, spent }">
    <title v-if="dotTitle">{{ dotTitle }}</title>
    <image :href="src" :x="center.x - counterSizePx / 2" :y="center.y - counterSizePx / 2" :width="counterSizePx" :height="counterSizePx" class="counter-img"
      @mousedown="onMouseDown" @click.stop="onClick"
      @contextmenu.prevent.stop="emit('contextmenu', id, $event)"
      @mouseenter="emit('hover', id, $event)" @mouseleave="emit('unhover', id)" />
    <rect v-if="selected" class="counter-ring" :x="center.x - counterSizePx / 2 - 3" :y="center.y - counterSizePx / 2 - 3" :width="counterSizePx + 6"
      :height="counterSizePx + 6" rx="5" ry="5" />
    <rect v-if="unsupplied" class="counter-unsupplied-ring" :x="center.x - counterSizePx / 2 - 3" :y="center.y - counterSizePx / 2 - 3"
      :width="counterSizePx + 6" :height="counterSizePx + 6" rx="5" ry="5" />
    <rect v-if="moved" class="counter-moved-ring" :x="center.x - counterSizePx / 2" :y="center.y - counterSizePx / 2" :width="counterSizePx" :height="counterSizePx"
      rx="3" ry="3" />
    <circle v-for="dot in dots" :key="dot.key" :class="['counter-dot', dot.cls]" :cx="dot.cx" :cy="dot.cy" :r="dotRadius" />
    <text v-if="label" class="counter-label" :x="center.x" :y="center.y + counterSizePx / 2 - 2" :font-size="counterSizePx * 0.2">{{ label }}</text>
  </g>
</template>

<style scoped>
.counter-img {
  cursor: pointer;
  user-select: none;
  -webkit-user-drag: none;
}

.counter.spent .counter-img {
  cursor: default;
}

.counter-ring {
  fill: none;
  stroke: var(--color-selection);
  stroke-width: 4;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.counter-dot {
  stroke: var(--color-ink-soft);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.dot-fought,
.dot-disrupted {
  fill: var(--color-dot-red);
}

.dot-displaced {
  fill: var(--color-orange);
}

.counter-label {
  fill: #fff;
  stroke: #000;
  stroke-width: 3;
  paint-order: stroke;
  font-weight: 700;
  text-anchor: middle;
  pointer-events: none;
  user-select: none;
}

.counter-moved-ring {
  fill: none;
  stroke: var(--color-orange);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

/* cf. lib/useSupplyLine.js — unité coupée de ses arrières, en phase de Fin de
   tour. Même anneau que la sélection, en rouge : les deux ne se rencontrent
   pas (on ne sélectionne rien dans cette phase-là) et un liseré fin comme
   celui du mouvement se perdrait sur la carte. */
.counter-unsupplied-ring {
  fill: none;
  stroke: var(--color-red);
  stroke-width: 4;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
</style>
