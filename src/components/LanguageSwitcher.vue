<script setup>
import { useI18n } from 'vue-i18n'
import { LOCALES, setLocale } from '../i18n/index.js'

// Sélecteur de langue de l'interface (cf. src/i18n/index.js).
const { locale, t } = useI18n()
</script>

<template>
  <div class="lang-switcher" role="group" :aria-label="t('language.label')">
    <button v-for="code in LOCALES" :key="code" type="button" :class="{ active: locale === code }"
      :aria-pressed="locale === code" :title="t(`language.${code}`)" @click="setLocale(code)">
      {{ code.toUpperCase() }}
    </button>
  </div>
</template>

<style scoped>
.lang-switcher {
  display: inline-flex;
  border: 1px solid var(--black-a25);
  border-radius: var(--radius-4);
  overflow: hidden;
  flex: none;
}

.lang-switcher button {
  padding: 4px 8px;
  font-size: var(--font-size-080);
  font-weight: 700;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.lang-switcher button + button {
  border-left: 1px solid var(--black-a25);
}

.lang-switcher button.active {
  background: var(--black-a25);
}
</style>
