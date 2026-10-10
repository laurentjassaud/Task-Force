<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// VictoryPoints.vue — compteur de points de victoire, un par camp.
//
// Deux usages selon le mode de partie (cf. lib/useVictoryPoints.js, qui porte
// l'état et les règles) :
//   - mode LIBRE : les joueurs tiennent le compte eux-mêmes, avec les boutons
//     − et + ou en tapant la valeur ; chaque modification part au journal ;
//   - mode ASSISTÉ : le moteur seul remplit les compteurs (éliminations,
//     positions tenues, unités coupées de leurs arrières) et le bloc passe en
//     lecture seule — un total saisi à la main et un total calculé ne
//     pourraient que diverger.
//
// Ce composant n'a aucune mémoire : il affiche ce qu'on lui donne et renvoie
// l'intention "change" (`{ side, value }` — la valeur VOULUE, au parent d'en
// faire ce qu'il veut).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  // Camps à afficher, dans l'ordre : `[{ key, label }]` (cf.
  // HexMap.vue::victorySides — clés de `module.sides`, libellés de la piste
  // de tour).
  sides: { type: Array, default: () => [] },
  // Total par camp : `{ [key]: points }`.
  scores: { type: Object, default: () => ({}) },
  // Mode Libre : les joueurs tiennent le compte. Faux en Assisté.
  editable: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

/** Total d'un camp, toujours un nombre. */
const scoreOf = (key) => Number(props.scores?.[key] ?? 0)

/** Bouton − / + : la valeur voulue, bornée à zéro (un camp ne descend pas
 *  sous zéro — aucune règle du jeu ne l'exige et c'est presque toujours une
 *  faute de frappe). */
function step(key, delta) {
  if (!props.editable) return
  emit('change', { side: key, value: Math.max(0, scoreOf(key) + delta) })
}

/** Saisie directe : on ignore ce qui n'est pas un entier positif. */
function onInput(key, event) {
  if (!props.editable) return
  const value = Number.parseInt(event.target.value, 10)
  if (!Number.isFinite(value)) return
  emit('change', { side: key, value: Math.max(0, value) })
}

const title = computed(() => (props.editable ? t('victory.manualTitle') : t('victory.engineTitle')))
</script>

<template>
  <div v-if="sides.length" class="victory-points" :title="title">
    <span class="vp-label">{{ t('victory.title') }}</span>
    <div v-for="side in sides" :key="side.key" class="vp-row">
      <span class="vp-side">{{ side.label }}</span>
      <button v-if="editable" type="button" class="vp-step" @click="step(side.key, -1)" :aria-label="t('victory.removePoint')">−</button>
      <input class="vp-value" type="number" min="0" :value="scoreOf(side.key)" :readonly="!editable"
        :tabindex="editable ? 0 : -1" @change="onInput(side.key, $event)" />
      <button v-if="editable" type="button" class="vp-step" @click="step(side.key, 1)" :aria-label="t('victory.addPoint')">+</button>
    </div>
  </div>
</template>

<style scoped>
.victory-points {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--black-a25);
  border-radius: var(--radius-8);
  padding: 6px 10px;
}

.vp-label {
  color: var(--panel-text-muted);
  font-size: var(--font-size-078);
  font-weight: 600;
  white-space: nowrap;
}

.vp-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.vp-side {
  color: var(--panel-text-muted);
  font-size: var(--font-size-075);
  white-space: nowrap;
}

.vp-value {
  width: 3.2em;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: var(--font-size-090);
  font-weight: 700;
  color: var(--color-gold);
  background: var(--white-a10);
  border: none;
  border-radius: var(--radius-4);
  padding: 2px 4px;
}

/* Lecture seule (mode Assisté) : la valeur reste lisible, mais rien n'invite
   à la toucher. */
.vp-value[readonly] {
  background: transparent;
  cursor: default;
}

/* Les flèches natives du champ nombre n'ont pas de sens ici : les boutons
   − et + font le travail, et elles disparaissent en lecture seule. */
.vp-value::-webkit-inner-spin-button,
.vp-value::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

.vp-value {
  appearance: textfield;
}

.vp-step {
  width: 1.6em;
  height: 1.6em;
  line-height: 1;
  border: none;
  border-radius: var(--radius-4);
  background: var(--white-a10);
  color: var(--panel-text);
  font-size: var(--font-size-090);
  font-weight: 700;
  cursor: pointer;
}

.vp-step:hover {
  background: var(--white-a35);
}
</style>
