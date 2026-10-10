<script setup>
// ═══════════════════════════════════════════════════════════════════════════
// VictoryModal.vue — annonce des points de victoire qui viennent d'être
// marqués (mode Assisté, cf. lib/useVictoryPoints.js).
//
// Deux occasions : une unité vient d'être éliminée, ou la Fin de tour vient
// de solder les positions tenues et les unités coupées de leurs arrières.
// Dans les deux cas, ce composant ne fait qu'AFFICHER la liste et renvoyer
// "close" — les totaux sont déjà inscrits quand elle s'ouvre.
//
// BLOQUANTE (overlay), comme PhaseBlockedModal.vue : c'est un acquittement,
// il n'y a rien à faire d'autre pendant qu'elle est là.
import { computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  // Lignes à annoncer : `[{ side, label, points, total, reason }]` —
  // `label` est le nom du camp tel que la piste de tour l'affiche.
  awards: { type: Array, default: () => [] },
  title: { type: String, default: null },
})

const emit = defineEmits(['close'])

function onKey(event) {
  if (event.key === 'Escape' || event.key === 'Enter') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

/** Totaux après coup, un par camp concerné — la dernière ligne de chaque
 *  camp porte son total à jour. */
const totals = computed(() => {
  const byS = new Map()
  for (const award of props.awards) byS.set(award.side, { label: award.label, total: award.total })
  return [...byS.values()]
})
</script>

<template>
  <div v-if="awards.length" class="vm-overlay" @click.self="emit('close')">
    <div class="vm-modal" role="alertdialog" aria-labelledby="vm-title">
      <h3 id="vm-title">{{ title ?? $t('victory.title') }}</h3>
      <ul class="vm-list">
        <li v-for="(award, index) in awards" :key="index">
          <b>{{ award.label }}</b>
          <span class="vm-points">+{{ award.points }}</span>
          <span class="vm-reason">{{ award.reason }}</span>
        </li>
      </ul>
      <p class="vm-totals">
        <span v-for="total in totals" :key="total.label">{{ $t('victory.total', { side: total.label }) }} <b>{{ total.total }}</b></span>
      </p>
      <footer class="vm-foot">
        <button type="button" class="vm-ok" @click="emit('close')">{{ $t('common.gotIt') }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.vm-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: var(--black-a50);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.vm-modal {
  width: min(440px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  color: var(--panel-text);
  border-radius: var(--radius-12);
  border-top: 4px solid var(--color-gold);
  box-shadow: var(--shadow-modal);
  padding: 14px 18px 16px;
}

.vm-modal h3 {
  margin: 0 0 8px;
  font-size: var(--font-size-095);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-gold);
}

.vm-list {
  margin: 0;
  padding: 8px 10px 8px 26px;
  overflow-y: auto;
  background: var(--white-a06);
  border-radius: var(--radius-8);
  font-size: var(--font-size-080);
}

.vm-list li + li {
  margin-top: 4px;
}

.vm-points {
  color: var(--color-gold);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  margin: 0 6px;
}

.vm-reason {
  color: var(--panel-text-muted);
}

.vm-totals {
  display: flex;
  gap: 16px;
  margin: 10px 0 0;
  font-size: var(--font-size-085);
}

.vm-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.vm-ok {
  border: none;
  background: var(--color-gold);
  color: var(--panel-bg);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--font-size-082);
  padding: 8px 20px;
  border-radius: var(--radius-8);
  cursor: pointer;
}

.vm-ok:hover {
  filter: brightness(1.08);
}
</style>
