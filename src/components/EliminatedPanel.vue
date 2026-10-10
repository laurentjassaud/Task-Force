<script setup>
// Contenu de l'onglet "Unités éliminées" — pions retirés de la carte via le
// menu contextuel "Éliminé" (cf. HexMap.vue), regroupés par nationalité
// (faction). Pas de drag & drop ici : seul le clic droit propose de
// "Replacer le pion" (retour dans les renforts, cf. onEliminatedContextMenu
// dans HexMap.vue).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  units: { type: Array, required: true }, // pions éliminés (toutes factions)
})

const emit = defineEmits(['contextmenu'])

const { t, te } = useI18n()
const factionLabel = (faction) => (te(`factions.${faction}`) ? t(`factions.${faction}`) : faction)

/** Groupes { faction, items }, triés par nom de faction affiché. */
const groups = computed(() => {
  const byFaction = new Map()
  for (const counter of props.units) {
    const faction = counter.faction ?? '?'
    if (!byFaction.has(faction)) byFaction.set(faction, [])
    byFaction.get(faction).push(counter)
  }
  return [...byFaction.entries()]
    .map(([faction, items]) => ({ faction, label: factionLabel(faction), items }))
    .sort((counterA, counterB) => counterA.label.localeCompare(counterB.label))
})
</script>

<template>
  <div class="el-list">
    <p v-if="!units.length" class="el-empty">{{ t('eliminated.empty') }}</p>
    <section v-for="group in groups" :key="group.faction" class="el-group">
      <h3 class="el-group-title">{{ group.label }}</h3>
      <div class="el-grid">
        <figure v-for="counter in group.items" :key="counter.id" class="el-piece">
          <img :src="counter.src" :alt="counter.name" width="48" height="48" draggable="false"
            @contextmenu.prevent="emit('contextmenu', counter.id, $event)" />
        </figure>
      </div>
    </section>
    <p class="el-hint">{{ t('eliminated.hint') }}</p>
  </div>
</template>

<style scoped>
.el-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-size: var(--font-size-085);
}
.el-empty {
  opacity: 0.75;
}
.el-group-title {
  margin: 0 0 8px;
  font-size: var(--font-size-095);
  font-weight: 600;
}
.el-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 10px;
}
.el-piece {
  margin: 0;
}
.el-piece img {
  border-radius: var(--radius-4);
  background: var(--white-a15);
  filter: grayscale(0.6);
  cursor: context-menu;
}
.el-hint {
  font-size: var(--font-size-072);
  opacity: 0.75;
  line-height: 1.4;
  margin: 0;
}
</style>
