<script setup>
// Modale d'avertissement : changement de phase refusé (mode Assisté).
//
// Ouverte par HexMap.vue::onPhaseNext quand le joueur veut quitter :
//  - la phase Mouvement alors que 2 unités amies ou plus occupent encore un
//    même hex (cf. lib/useAssisted.js::stackedHexes) ;
//  - la phase Combat alors qu'il reste des combats obligatoires en attente —
//    des unités amies et ennemies adjacentes qui n'ont, ni l'une ni l'autre,
//    combattu (cf. lib/useCombat.js::pendingEngagements).
// Ce composant ne fait qu'AFFICHER ces listes (seule celle qui n'est pas vide
// apparaît) et renvoyer l'intention "ferme".
//
// Réutilisée aussi par HexMap.vue::setSelectedCounter (props `title` et
// `stackMessage`) quand on veut quitter une unité en overstack pour en
// sélectionner une autre.
//
// Et par HexMap.vue pour le timing "Limité" (cf. MoveTimer.vue) : `title` et
// un message libre passé dans le slot par défaut, sans liste.
//
// Contrairement à CombatModal.vue, elle est BLOQUANTE (overlay) : c'est un
// simple message à acquitter, il n'y a rien à cliquer sur la carte pendant
// qu'elle est ouverte.
import { onMounted, onUnmounted } from 'vue'

defineProps({
  // `[{ key, friendly, friendlyHex, enemy, enemyHex }]` — cf.
  // useCombat.js::pendingEngagements.
  engagements: { type: Array, default: () => [] },
  // `[{ key, hex, units }]` — cf. useAssisted.js::stackedHexes.
  stacks: { type: Array, default: () => [] },
  title: { type: String, default: null },
  // Phrase affichée au-dessus de la liste `stacks`.
  stackMessage: { type: String, default: null },
})

const emit = defineEmits(['close'])

function onKey(event) {
  if (event.key === 'Escape' || event.key === 'Enter') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="pb-overlay" @click.self="emit('close')">
    <div class="pb-modal" role="alertdialog" aria-labelledby="pb-title">
      <h3 id="pb-title">{{ title ?? $t('phaseBlocked.title') }}</h3>
      <p v-if="$slots.default"><slot /></p>
      <template v-if="stacks.length">
        <p>{{ stackMessage ?? $t('phaseBlocked.stacks') }}</p>
        <ul class="pb-list">
          <li v-for="stack in stacks" :key="stack.key">
            <span class="pb-hex">{{ stack.hex }}</span>
            <span class="pb-vs">—</span>
            <b>{{ stack.units.join(', ') }}</b>
          </li>
        </ul>
      </template>
      <p v-if="engagements.length">{{ $t('phaseBlocked.engagements') }}</p>
      <ul v-if="engagements.length" class="pb-list">
        <li v-for="engagement in engagements" :key="engagement.key">
          <b>{{ engagement.friendly }}</b> <span class="pb-hex">{{ engagement.friendlyHex }}</span>
          <span class="pb-vs">↔</span>
          <b>{{ engagement.enemy }}</b> <span class="pb-hex">{{ engagement.enemyHex }}</span>
        </li>
      </ul>
      <footer class="pb-foot">
        <button type="button" class="pb-ok" @click="emit('close')">{{ $t('common.gotIt') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pb-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: var(--black-a50);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.pb-modal {
  width: min(460px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-12);
  border-top: 4px solid var(--color-orange);
  box-shadow: var(--shadow-modal);
  padding: 14px 18px 16px;
}

.pb-modal h3 {
  margin: 0 0 8px;
  font-size: var(--font-size-095);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-orange);
}

.pb-modal p {
  margin: 0 0 10px;
  font-size: var(--font-size-085);
  line-height: 1.4;
}

.pb-list {
  margin: 0;
  padding: 8px 10px 8px 26px;
  overflow-y: auto;
  background: var(--white-a06);
  border-radius: var(--radius-8);
  font-size: var(--font-size-080);
}

/* Les deux listes (empilements, combats) ne coexistent jamais en pratique
   (phases différentes), mais on les sépare proprement si ça arrivait. */
.pb-list + p {
  margin-top: 12px;
}

.pb-list li + li {
  margin-top: 4px;
}

.pb-hex {
  color: var(--color-gold);
  font-variant-numeric: tabular-nums;
}

.pb-vs {
  color: var(--panel-text-faint);
  margin: 0 6px;
}

.pb-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.pb-ok {
  border: none;
  background: var(--color-orange);
  color: var(--panel-bg);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--font-size-082);
  padding: 8px 20px;
  border-radius: var(--radius-8);
  cursor: pointer;
}

.pb-ok:hover {
  filter: brightness(1.08);
}
</style>
