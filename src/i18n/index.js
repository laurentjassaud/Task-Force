import { reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import fr from './fr.js'
import en from './en.js'

/* ═══════════════════════════════════════════════════════════════════════════
   Traduction de l'interface (français / anglais).
   Les textes vivent dans fr.js et en.js, rangés par écran ou composant. Dans
   un template : `$t('cle')` ; dans un <script setup> : `const { t } =
   useI18n()` ; dans une lib (hors composant) : `import { t } from
   '../i18n'`.
   Le journal de partie reste dans la langue où il a été écrit : ses lignes
   sont traduites au moment où elles sont écrites, puis stockées en texte.
   Les noms d'unités et de lieux du module ne sont pas traduits. Ses autres
   libellés (camps, scénarios, résultats de combat...) sont écrits en
   français dans son JSON, qui peut en donner la traduction dans un
   dictionnaire `i18n` : `{ "en": { "Alliés": "Allies" } }` (cf. `mt`).
   ═══════════════════════════════════════════════════════════════════════════ */

export const LOCALES = ['fr', 'en']
const STORAGE_KEY = 'locale'

/** Langue choisie dans le sélecteur si elle a été mémorisée, sinon celle du
 *  navigateur (français s'il le demande, anglais pour tout le reste). */
function initialLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (LOCALES.includes(saved)) return saved
  } catch {
    // Stockage indisponible (navigation privée...) : on se rabat sur le navigateur.
  }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of preferred) {
    const base = String(language ?? '').slice(0, 2).toLowerCase()
    if (LOCALES.includes(base)) return base
  }
  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'fr',
  messages: { fr, en },
})

/** `t` global, pour les libs appelées hors d'un composant. Réactif : un
 *  computed qui l'appelle se recalcule quand la langue change. */
export const t = (...args) => i18n.global.t(...args)

export function currentLocale() {
  return i18n.global.locale.value
}

export function setLocale(locale) {
  if (!LOCALES.includes(locale)) return
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Choix non mémorisé : il vaut quand même pour cette session.
  }
}

/** Message d'erreur lisible pour un code renvoyé par le serveur
 *  ('not-found', 'room-full'...) ; un code inconnu est affiché tel quel. */
export function errorMessage(code) {
  const key = `errors.${code}`
  return i18n.global.te(key) ? t(key) : String(code)
}

// --- Libellés des modules -----------------------------------------------------
// Dictionnaires `i18n` des modules chargés, par langue : { en: { fr: en } }.
const moduleTexts = reactive({})

/** Retient les traductions d'un module (JSON complet) — à appeler dès qu'il
 *  est chargé, avant d'afficher ses libellés. */
export function registerModuleTexts(module) {
  for (const [locale, dict] of Object.entries(module?.i18n ?? {})) {
    moduleTexts[locale] = { ...moduleTexts[locale], ...dict }
  }
}

/** Libellé d'un module (écrit en français dans son JSON) dans la langue
 *  courante ; tel quel s'il n'a pas de traduction. */
export function mt(text) {
  if (typeof text !== 'string') return text
  return moduleTexts[currentLocale()]?.[text] ?? text
}

document.documentElement.lang = i18n.global.locale.value
