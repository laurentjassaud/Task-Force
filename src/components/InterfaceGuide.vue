<script setup>
// Guide de l'interface : modale en quelques étapes (barre du haut, carte,
// pions, panneau latéral, outils) qui présente l'écran de jeu au joueur.
//
// Ouverte automatiquement par HexMap.vue la PREMIÈRE fois qu'on arrive sur
// une partie (cf. `GUIDE_SEEN_KEY`, mémorisé dans le localStorage à la
// fermeture), puis à la demande par le bouton "?" de la barre d'outils.
//
// Le contenu dépend du mode (`assisted`) : en mode Assisté les pions se
// jouent au clic (sélection, puis hex de destination), en mode Libre au
// glisser-déposer — cf. lib/useAssisted.js::draggable/selectable.
//
// Bloquante (overlay), comme PhaseBlockedModal.vue : fermée par "Terminer",
// le bouton de fermeture, Échap ou un clic à côté ; ← / → changent d'étape.
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  assisted: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

// Chaque étape : un titre et une liste de points `{ term, text }` (clés
// i18n sous `guide.<étape>.<point>`). Les points réservés à un mode portent
// `mode: 'assisted'` ou `mode: 'free'`.
const STEPS = [
  { key: 'toolbar', items: [
    { key: 'turn' },
    { key: 'phases', mode: 'assisted' },
    { key: 'next', mode: 'free' },
    { key: 'support' },
    { key: 'victory' },
    { key: 'timer' },
  ] },
  { key: 'map', items: [
    { key: 'zoom' },
    { key: 'pan' },
    { key: 'stack' },
  ] },
  { key: 'units', items: [
    { key: 'select', mode: 'assisted' },
    { key: 'highlight', mode: 'assisted' },
    { key: 'drag', mode: 'free' },
    { key: 'menu' },
    { key: 'undo', mode: 'assisted' },
    { key: 'combat', mode: 'assisted' },
  ] },
  { key: 'panel', items: [
    { key: 'reinforcements' },
    { key: 'eliminated' },
    { key: 'journal' },
  ] },
  { key: 'tools', items: [
    { key: 'charts' },
    { key: 'die', mode: 'free' },
    { key: 'display' },
    { key: 'bug' },
    { key: 'help' },
  ] },
]

const steps = computed(() => {
  const mode = props.assisted ? 'assisted' : 'free'
  return STEPS.map((step) => ({ ...step, items: step.items.filter((item) => !item.mode || item.mode === mode) }))
})

const index = ref(0)
const step = computed(() => steps.value[index.value])
const isLast = computed(() => index.value === steps.value.length - 1)

function previous() {
  if (index.value > 0) index.value--
}
function next() {
  if (isLast.value) emit('close')
  else index.value++
}

function onKey(event) {
  if (event.key === 'Escape') emit('close')
  else if (event.key === 'ArrowRight') next()
  else if (event.key === 'ArrowLeft') previous()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<script>
/** Clé localStorage : le guide a déjà été vu sur ce navigateur. */
export const GUIDE_SEEN_KEY = 'generic-wargame.interfaceGuideSeen'

/** Le guide a-t-il déjà été vu ? Un localStorage inaccessible (navigation
 *  privée, stockage bloqué) compte comme "vu" : mieux vaut ne pas le
 *  rouvrir à chaque partie. */
export function guideSeen() {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

export function markGuideSeen() {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, '1')
  } catch {
    // Stockage indisponible : le guide se rouvrira simplement plus tard.
  }
}
</script>

<template>
  <div class="ig-overlay" @click.self="emit('close')">
    <div class="ig-modal" role="dialog" aria-labelledby="ig-title">
      <header class="ig-head">
        <span class="ig-step">{{ $t('guide.stepOf', { step: index + 1, total: steps.length }) }}</span>
        <h3 id="ig-title">{{ $t(`guide.${step.key}.title`) }}</h3>
        <button type="button" class="ig-close" :title="$t('common.close')" @click="emit('close')">&times;</button>
      </header>

      <p v-if="index === 0" class="ig-intro">
        {{ $t('guide.intro', { mode: assisted ? $t('settings.party.assiste') : $t('settings.party.libre') }) }}
      </p>
      <p class="ig-lead">{{ $t(`guide.${step.key}.lead`) }}</p>

      <ul class="ig-list">
        <li v-for="item in step.items" :key="item.key">
          <span class="ig-term">{{ $t(`guide.${step.key}.${item.key}.term`) }}</span>
          <span class="ig-text">{{ $t(`guide.${step.key}.${item.key}.text`) }}</span>
        </li>
      </ul>

      <footer class="ig-foot">
        <div class="ig-dots" aria-hidden="true">
          <button v-for="(dot, dotIndex) in steps" :key="dot.key" type="button" class="ig-dot"
            :class="{ active: dotIndex === index }" tabindex="-1" @click="index = dotIndex" />
        </div>
        <button type="button" class="ig-btn ig-secondary" :disabled="index === 0" @click="previous">
          {{ $t('guide.previous') }}
        </button>
        <button type="button" class="ig-btn" @click="next">
          {{ isLast ? $t('guide.finish') : $t('common.next') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.ig-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-guide);
  background: var(--black-a50);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.ig-modal {
  width: min(560px, 100%);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-12);
  border-top: 4px solid var(--color-gold);
  box-shadow: var(--shadow-modal);
  padding: 14px 18px 16px;
}

.ig-head {
  position: relative;
  padding-right: 32px;
  margin-bottom: 8px;
}

.ig-step {
  font-size: var(--font-size-080);
  color: var(--panel-text-faint);
  font-variant-numeric: tabular-nums;
}

.ig-head h3 {
  margin: 2px 0 0;
  font-size: var(--font-size-110);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-gold);
}

.ig-close {
  position: absolute;
  top: 0;
  right: 0;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: var(--radius-round);
  background: var(--white-a06);
  color: var(--panel-text);
  font-size: var(--font-size-110);
  line-height: 26px;
  padding: 0;
  cursor: pointer;
}

.ig-close:hover {
  filter: brightness(1.3);
}

.ig-intro,
.ig-lead {
  margin: 0 0 10px;
  font-size: var(--font-size-085);
  line-height: 1.45;
}

.ig-intro {
  padding: 8px 10px;
  background: var(--white-a06);
  border-radius: var(--radius-8);
}

.ig-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  min-height: 0;
}

.ig-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 0;
  font-size: var(--font-size-085);
  line-height: 1.4;
}

.ig-list li + li {
  border-top: 1px solid var(--white-a06);
}

.ig-term {
  font-weight: 700;
  color: var(--color-gold);
}

.ig-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.ig-dots {
  display: flex;
  gap: 6px;
  margin-right: auto;
}

.ig-dot {
  width: 8px;
  height: 8px;
  padding: 0;
  border: none;
  border-radius: var(--radius-round);
  background: var(--panel-text-faint);
  opacity: 0.5;
  cursor: pointer;
}

.ig-dot.active {
  background: var(--color-gold);
  opacity: 1;
}

.ig-btn {
  border: none;
  background: var(--color-gold);
  color: var(--panel-bg);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--font-size-082);
  padding: 8px 18px;
  border-radius: var(--radius-8);
  cursor: pointer;
}

.ig-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.ig-secondary {
  background: var(--white-a06);
  color: var(--panel-text);
}

.ig-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
