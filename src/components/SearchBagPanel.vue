<script setup>
// Contenu de l'onglet "Tasse de recherche" — chits de recherche qui restent
// dans la tasse (cf. lib/useCoralSea.js::drawSearch), par résultat, sur le
// contenu d'une tasse pleine. Simple affichage : les chits tirés n'y
// reviennent qu'aux tours "Tous rendus" de la piste (cf. HexMap.vue, entrée
// `searchRefill` du journal).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  // Chits restants : `{ résultat: nombre }`.
  bag: { type: Object, required: true },
  // Tasse pleine, même forme.
  full: { type: Object, required: true },
  // Pion de chaque résultat : `{ résultat: { name, src } }`.
  looks: { type: Object, default: () => ({}) },
})

const { t } = useI18n()

const rows = computed(() => Object.entries(props.full).map(([key, total]) => ({
  key, total, left: props.bag[key] ?? 0, name: props.looks[key]?.name ?? key, src: props.looks[key]?.src,
})))
const left = computed(() => rows.value.reduce((sum, row) => sum + row.left, 0))
const total = computed(() => rows.value.reduce((sum, row) => sum + row.total, 0))
</script>

<template>
  <div class="sb-panel">
    <p class="sb-total">{{ t('searchBag.total', { left, total }) }}</p>
    <ul class="sb-list">
      <li v-for="row in rows" :key="row.key" class="sb-row" :class="{ 'sb-empty': !row.left }">
        <img v-if="row.src" :src="row.src" :alt="row.name" width="48" height="48" draggable="false" />
        <span class="sb-name">{{ row.name }}</span>
        <span class="sb-count"><b>{{ row.left }}</b> / {{ row.total }}</span>
      </li>
    </ul>
    <p class="sb-hint">{{ t('searchBag.hint') }}</p>
  </div>
</template>

<style scoped>
.sb-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: var(--font-size-085);
}
.sb-total {
  margin: 0;
  font-weight: 600;
}
.sb-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sb-row {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  align-items: center;
  gap: 12px;
}
.sb-row img {
  border-radius: var(--radius-4);
  background: var(--white-a15);
}
.sb-empty {
  opacity: 0.45;
}
.sb-count {
  font-variant-numeric: tabular-nums;
}
.sb-hint {
  font-size: var(--font-size-072);
  opacity: 0.75;
  line-height: 1.4;
  margin: 0;
}
</style>
