// ═══════════════════════════════════════════════════════════════════════════
// journalStorage — stockage navigateur du journal de partie
// ═══════════════════════════════════════════════════════════════════════════
//
// Partagé entre JournalPanel.vue (auto-save, reprise) et DemoPlay.vue
// (relance de la partie avec les réglages d'une sauvegarde).
//
// Pourquoi une "reprise en attente" : un journal ne se rejoue correctement
// que dans les RÉGLAGES où il a été joué (mode Libre/Assisté surtout — les
// règles de phase, de MP, de combat n'existent qu'en Assisté). Quand on
// reprend une sauvegarde faite avec d'autres réglages que la partie ouverte,
// DemoPlay.vue relance la partie avec les bons réglages (nouvelle URL, carte
// remontée à neuf) ; le journal à rejouer traverse ce remontage en
// sessionStorage, puis HexMap.vue le récupère au montage (cf.
// JournalPanel.vue::resumePending).

/** Clé de l'auto-save (un seul emplacement, écrasé à chaque mutation). */
import { resolveSettings, RULE_SETTING_KEYS } from './gameSettings.js'

export const AUTOSAVE_KEY = 'generic-wargame:journal-autosave'

const PENDING_KEY = 'generic-wargame:pending-replay'

/** Réglages de partie qui comptent pour rejouer un journal (cf.
 *  LocalGameSetup.vue). Normalisés en chaînes, pour comparer sans surprise
 *  une valeur venue de l'URL et une valeur relue d'un fichier. */
export const SETTING_KEYS = ['scenario', 'weather', 'party', 'timing', 'timingValue']

export function normalizeSettings(settings) {
  if (!settings) return null
  return Object.fromEntries(SETTING_KEYS.map((settingKey) => [settingKey, settings[settingKey] == null ? '' : String(settings[settingKey])]))
}

/** Les réglages `a` et `b` donnent-ils la MÊME partie ? Comparés une fois
 *  RÉSOLUS (cf. lib/gameSettings.js::resolveSettings — une option indisponible
 *  ou un chronomètre en partie Libre y sont neutralisés) et seulement sur les
 *  clés qui changent les règles (`RULE_SETTING_KEYS`) : une sauvegarde qui
 *  ne diffère que par un réglage sans effet se reprend directement, sans
 *  relancer la partie. Comparer les valeurs brutes relançait la partie pour
 *  rien — et, la relance se résolvant aux mêmes réglages, la carte n'était
 *  pas remontée et le journal mis de côté restait en attente sans être
 *  rejoué. Si l'un des deux est inconnu (sauvegarde antérieure à cet ajout,
 *  partie multijoueur sans réglages), on ne peut pas comparer : considérés
 *  compatibles. */
export function sameSettings(settingsA, settingsB) {
  if (!settingsA || !settingsB) return true
  const ra = resolveSettings(settingsA), rb = resolveSettings(settingsB)
  return RULE_SETTING_KEYS.every((settingKey) => ra[settingKey] === rb[settingKey])
}

/** Télécharge `content` en fichier JSON nommé `name` (export du journal,
 *  partie complète jointe à un rapport de bug). */
export function downloadJson(name, content) {
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const downloadLink = document.createElement('a')
  downloadLink.href = url
  downloadLink.download = name
  downloadLink.click()
  URL.revokeObjectURL(url)
}

/** Met de côté un journal à rejouer après la relance de la partie. */
export function stashPendingReplay(entries, message) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ entries, message }))
  } catch {
    // Stockage indisponible : la relance se fera sans reprise.
  }
}

/** Y a-t-il un journal en attente (sans le consommer) ? */
export function hasPendingReplay() {
  try {
    return sessionStorage.getItem(PENDING_KEY) != null
  } catch {
    return false
  }
}

/** Récupère ET efface le journal en attente — `{ entries, message }` ou
 *  `null`. */
export function takePendingReplay() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
