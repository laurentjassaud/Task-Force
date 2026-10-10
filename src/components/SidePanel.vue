<script setup>
// Panneau à onglets coulissants sur le bord droit de l'écran — repris tel
// quel de ambush-tactique/src/components/SidePanel.vue (même structure
// DOM/CSS/logique : l'onglet .dc-tab est imbriqué DANS .dc-content et
// translate avec lui, seul un sliver reste visible/cliquable au bord de
// l'écran quand le panneau est fermé). Piloté par la prop `tabs`.
import { ref } from 'vue'

const props = defineProps({
  tabs: { type: Array, required: true }   // [{ key, label, wide? }]
})

const openTab = defineModel('openTab', { default: null })

const HOVER_PEEK = 10

/** Onglet actuellement survolé (aperçu "peek" quand il n'est pas déjà ouvert). */
const hoverKey = ref(null)

/** Onglets en cours de fondu lors d'un changement direct (ouvert → un autre
 *  ouvert), le temps de la transition. */
const fadingKeys = ref(new Set())
let fadeTimer = null

// Palette par onglet (ton clair → sombre), déclarée dans assets/main.css
// (`--tab-N-…`). Cycle si plus de 4 onglets.
const TONES = [1, 2, 3, 4].map((n) => Object.fromEntries(
  ['bg', 'ink', 'soft', 'rule', 'hover', 'label'].map((key) => [key, `var(--tab-${n}-${key})`]),
))

const TAB_TOPS = [220, 346, 444, 560]
function tabTop(tabIndex) {
  if (tabIndex < TAB_TOPS.length) return TAB_TOPS[tabIndex] + 'px'
  return (TAB_TOPS[TAB_TOPS.length - 1] + 110 * (tabIndex - TAB_TOPS.length + 1)) + 'px'
}

function select(key) {
  const prevKey = openTab.value
  const nextKey = prevKey === key ? null : key
  const isSwitch = prevKey !== null && nextKey !== null && prevKey !== nextKey

  if (isSwitch) {
    fadingKeys.value = new Set([prevKey, nextKey])
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => { fadingKeys.value = new Set() }, 320)
  }
  openTab.value = nextKey
}

function close() {
  openTab.value = null
}

function rowVars(tab, tabIndex) {
  const tone = TONES[tabIndex % TONES.length]
  const isOpen = openTab.value === tab.key
  const isPeeking = !isOpen && hoverKey.value === tab.key
  const isFading = fadingKeys.value.has(tab.key)

  return {
    '--tone': tone.bg,
    '--tone-ink': tone.ink,
    '--tone-soft': tone.soft,
    '--tone-rule': tone.rule,
    '--tone-hover': tone.hover,
    '--tone-label': tone.label,
    '--tab-top': tabTop(tabIndex),
    '--content-w': tab.wide ? '30vw' : '22vw',
    '--content-x': isOpen ? '0%' : isPeeking ? `calc(100% - ${HOVER_PEEK}px)` : '100%',
    '--content-slide': isOpen ? '0px' : '16px',
    '--content-opacity': isFading ? (isOpen ? '1' : '0') : '1',
    '--fade-duration': isFading ? '320ms' : '0ms',
    '--tab-shadow': isOpen ? 'none' : 'var(--shadow-side-tab)',
    '--content-z': isOpen ? '1' : isPeeking ? '4' : '3',
  }
}
</script>

<template>
  <div class="dc-root">
    <div v-for="(tab, tabIndex) in tabs" :key="tab.key" class="dc-row" :style="rowVars(tab, tabIndex)">
      <div class="dc-tab-shadow" aria-hidden="true">
        <span class="dc-tab-label">{{ tab.label }}</span>
      </div>

      <div class="dc-content" @mouseenter="hoverKey = tab.key" @mouseleave="hoverKey = null">
        <button class="dc-tab" @click.stop="select(tab.key)">
          <span class="dc-tab-cap dc-tab-cap-top" aria-hidden="true">
            <svg viewBox="0 0 36 36" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M36 36V0C36 24 -2.95641e-05 12 0 36H36Z" fill="currentColor" />
            </svg>
          </span>
          <span class="dc-tab-label">{{ tab.label }}</span>
          <span class="dc-tab-cap dc-tab-cap-bottom" aria-hidden="true">
            <svg viewBox="0 0 36 36" preserveAspectRatio="none" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M36 0V36C36 12 -2.95641e-05 24 0 0H36Z" fill="currentColor" />
            </svg>
          </span>
        </button>

        <div class="dc-content-inner">
          <div class="dc-content-head">
            <h2 class="dc-title">{{ tab.label }}</h2>
          </div>
          <div class="dc-rule"></div>
          <div class="dc-content-slot">
            <slot :name="tab.key" />
          </div>
          <button class="dc-close-btn" @click.stop="close">{{ $t('common.close') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dc-root {
  font-family: var(--font-ui);
}

.dc-row {
  position: relative;
}

.dc-tab-shadow {
  position: fixed;
  top: 0;
  left: calc(100vw - var(--content-w, 22vw) - 35px);
  width: 36px;
  padding: 8px 0;
  box-sizing: border-box;
  transform: translateY(calc(var(--tab-top, 200px) - 50%)) translateX(var(--content-x, 100%));
  transition: transform 620ms cubic-bezier(0.22, 0.61, 0.36, 1);
  box-shadow: var(--tab-shadow, var(--shadow-side-tab));
  pointer-events: none;
  z-index: var(--z-side-tab-shadow);
  display: none;
}

.dc-tab-shadow .dc-tab-label {
  visibility: hidden;
}

.dc-content {
  position: fixed;
  top: 0;
  right: 0;
  width: var(--content-w, 22vw);
  height: 100vh;
  overflow: visible;
  background: var(--tone);
  transform: translateX(var(--content-x, 100%));
  transition: transform 620ms cubic-bezier(0.22, 0.61, 0.36, 1);
  display: flex;
  z-index: calc(var(--z-side-content) + var(--content-z, 0));
}

.dc-tab {
  position: absolute;
  left: -35px;
  top: var(--tab-top, 200px);
  width: 36px;
  height: auto;
  padding: 8px 0;
  box-sizing: border-box;
  border: none;
  background: var(--tone);
  color: var(--tone);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  z-index: var(--z-raised);
}

.dc-tab-cap {
  position: absolute;
  left: 0;
  width: 100%;
  height: 28px;
  pointer-events: none;
}

.dc-tab-cap-top { top: -27px; }
.dc-tab-cap-bottom { bottom: -27px; }

.dc-tab-cap svg {
  display: block;
  width: 100%;
  height: 100%;
}

.dc-tab-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: var(--font-size-px-13);
  letter-spacing: 0.9px;
  white-space: nowrap;
  color: var(--tone-label);
}

.dc-content-inner {
  flex: 1;
  padding: 32px 28px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  opacity: var(--content-opacity, 1);
  transform: translateX(var(--content-slide, 16px));
  transition: opacity var(--fade-duration, 0ms) ease, transform 620ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.dc-content-head {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dc-title {
  margin: 0;
  font-size: var(--font-size-px-22);
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--tone-ink);
}

.dc-rule {
  height: 1px;
  background: var(--tone-rule);
  flex: none;
}

.dc-content-slot {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  color: var(--tone-ink);
  /* Scrollbar fine et arrondie façon perfect-scrollbar/vue-custom-scrollbar
     (rail discret, pouce semi-transparent qui s'éclaircit au survol) —
     couleurs alignées sur le ton de l'onglet ouvert. */
  scrollbar-width: thin;
  scrollbar-color: var(--tone-rule) transparent;
}
.dc-content-slot::-webkit-scrollbar {
  width: 8px;
}
.dc-content-slot::-webkit-scrollbar-track {
  background: transparent;
}
.dc-content-slot::-webkit-scrollbar-thumb {
  background: var(--tone-rule);
  border-radius: var(--radius-4);
}
.dc-content-slot::-webkit-scrollbar-thumb:hover {
  background: var(--tone-soft);
}

.dc-close-btn {
  align-self: flex-start;
  flex: none;
  padding: 8px 16px;
  background: transparent;
  border: 1px solid var(--tone-rule);
  border-radius: var(--radius-4);
  font-size: var(--font-size-px-12);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--tone-ink);
  cursor: pointer;
  transition: background 200ms ease;
}

.dc-close-btn:hover {
  background: var(--tone-hover);
}
</style>
