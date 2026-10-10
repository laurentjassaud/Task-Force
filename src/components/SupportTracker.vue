<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// SupportTracker.vue — tablette de soutien allié, autonome : plateau [18.16]
// — un nombre de pions "support" fixé par tour (config.byTurn, indexé par le
// tour courant), tous identiques. Régénérés à neuf à chaque changement de
// tour : un pion non posé avant le tour suivant est simplement perdu
// (ressource par tour, pas cumulative), comme au tableau des règles.
//
// Deux façons de les poser sur la carte, selon le mode (mêmes deux systèmes
// que les renforts, cf. lib/useAssisted.js::draggable/selectable) :
//   - mode LIBRE : glisser-déposer d'un pion de la tablette vers un hex ;
//   - mode ASSISTÉ (`selectable`) : clic sur un pion de la tablette, puis
//     clic sur l'hex cible (cf. HexMap.vue::onSupportSelect/onHex) — et
//     seulement quand la règle l'autorise (`placeable` : phase de Combat,
//     cf. HexMap.vue::canPlaceSupportNow).
//
// La tablette n'a PAS d'état propre : elle se DÉDUIT de la carte — ce sont
// les pions du tour courant dont l'id n'est pas sur la carte (`placedIds`,
// cf. HexMap.vue). Une fois glissé sur la carte, un pion devient un pion
// comme un autre dans `counters` et disparaît de la tablette ; qu'il quitte
// la carte (menu contextuel "Replacer le pion", cf.
// HexMap.vue::returnSupportToTray) et il y revient de lui-même — s'il est du
// tour courant : celui d'un tour écoulé est perdu, la tablette ne recrée que
// les pions du tour en cours. Aucune synchro à faire au rejeu du journal ni
// en ligne, puisque tous deux ne font que reconstruire `counters`.
// Le parent délègue tout le reste (glisser-déposer unifié avec renforts/pions
// déjà posés, empilement, badge de compte sur la carte) car cela concerne
// des pions DÉJÀ sur la carte, hors du périmètre de la tablette.
// ═══════════════════════════════════════════════════════════════════════════

import { computed } from 'vue'
import { mt } from '../i18n/index.js'

const props = defineProps({
  // module.supportTrack — { label, side, factor, marker, byTurn: [count par
  // tour] }. Absent (null) : pas de tablette de soutien.
  config: { type: Object, default: null },
  // Tour courant (1-based, cf. TurnTracker.vue) — régénère la tablette.
  turn: { type: Number, default: 1 },
  // Ids (en chaîne) des pions actuellement sur la carte.
  placedIds: { type: Set, default: () => new Set() },
  // Mode Assisté : les pions se CLIQUENT (et ne se glissent plus).
  selectable: { type: Boolean, default: false },
  // Mode Assisté : la règle autorise-t-elle à en poser un MAINTENANT (cf.
  // HexMap.vue::canPlaceSupportNow) ? Sinon ils sont éteints et inertes.
  placeable: { type: Boolean, default: false },
  // Id du pion choisi dans la tablette, en attente d'un clic sur un hex.
  selectedId: { type: [String, Number], default: null },
})

const emit = defineEmits(['dragstart', 'select'])

const count = computed(() => props.config?.byTurn[props.turn - 1] ?? 0)
// Tous les pions du tour courant, posés ou non...
const turnTokens = computed(() => {
  const track = props.config
  if (!track) return []
  return Array.from({ length: count.value }, (_, tokenIndex) => ({
    id: `support-t${props.turn}-${tokenIndex}`, type: 'marker', kind: 'support', faction: null, name: mt(track.label), src: track.marker,
  }))
})
// ...et ceux qui restent dans la tablette.
const tokens = computed(() => turnTokens.value.filter((token) => !props.placedIds.has(token.id)))

/** Lecture seule — utilisé par HexMap.vue::onCounterDragStart pour résoudre
 *  l'id glissé (avant de savoir si c'est un pion de la tablette ou non) et
 *  par HexMap.vue::onMapDrop pour le poser sur la carte. */
function findToken(id) {
  return tokens.value.find((token) => String(token.id) === String(id)) ?? null
}

/** Le pion est-il de la tablette du tour courant (posé ou non) ? — cf.
 *  HexMap.vue::returnSupportToTray : dit, au moment de le retirer de la
 *  carte, s'il va revenir dans la tablette ou être perdu. Ne dépend pas de
 *  `placedIds`, qui n'est à jour qu'au rendu suivant. */
function isTurnToken(id) {
  return turnTokens.value.some((token) => String(token.id) === String(id))
}

/** Les pions encore dans la tablette — cf. HexMap.vue, soutien du défenseur
 *  en ligne : il les coche sur son écran (il n'a pas la main pour les poser),
 *  et le client du joueur actif les pose en recevant sa réponse. */
const trayTokens = () => tokens.value

defineExpose({ findToken, isTurnToken, trayTokens })
</script>

<template>
  <div v-if="config" class="support-tracker">
    <span class="st-label">{{ mt(config.label) }} ({{ count }})</span>
    <div class="st-tray">
      <img v-for="token in tokens" :key="token.id" :src="token.src" :alt="token.name" class="st-token"
        :class="{ clickable: selectable && placeable, idle: selectable && !placeable, on: String(selectedId) === token.id }"
        :title="selectable && !placeable ? $t('supportTracker.combatOnly') : null"
        :draggable="!selectable" @dragstart="emit('dragstart', token.id, $event)"
        @click="selectable && placeable && emit('select', token.id)" />
    </div>
  </div>
</template>

<style scoped>
.support-tracker {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--black-a25);
  border-radius: var(--radius-8);
  padding: 6px 10px;
}

.st-label {
  color: var(--panel-text-muted);
  font-size: var(--font-size-078);
  font-weight: 600;
  white-space: nowrap;
}

.st-tray {
  display: flex;
  gap: 6px;
}

.st-token {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-4);
  cursor: grab;
}

/* Mode Assisté : le pion se clique (cf. `selectable`), et le pion choisi
   attend un clic sur un hex de la carte (contour vert de sélection, comme un
   pion sélectionné sur la carte, cf. Counter.vue). */
.st-token.clickable {
  cursor: pointer;
}

.st-token.on {
  outline: 2px solid var(--color-selection);
  outline-offset: 1px;
}

/* Hors phase de Combat : plus rien à en faire pour l'instant. */
.st-token.idle {
  opacity: 0.45;
  cursor: default;
}
</style>
