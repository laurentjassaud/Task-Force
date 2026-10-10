// Réglages d'une partie (scénario, météo, mode Libre/Assisté, timing),
// communs à la partie en local (LocalGameSetup.vue -> DemoPlay.vue) et à la
// partie en ligne (CreateGame.vue -> serveur -> RoomLobby.vue). Mêmes clés que
// lib/journalStorage.js::SETTING_KEYS, toutes en chaînes (format de l'URL).
// Les libellés sont des getters : lus au moment de l'affichage, ils suivent
// la langue choisie (cf. src/i18n).

import { t, mt } from '../i18n/index.js'

// --- Scénarios ---------------------------------------------------------------
// Chaque module déclare ses scénarios (`module.scenarios`, cf. arnhem.json) :
// `{ id, label, deployment, weather, available }`. Le MOTEUR, lui, sait quels
// modes de déploiement il applique (`SUPPORTED_DEPLOYMENTS`) : un scénario
// dont le déploiement n'est pas encore implémenté est proposé grisé ("Bientôt
// disponible") et jamais retenu (cf. `scenarioOptions`, `resolveSettings`) —
// c'est le cas du placement libre d'Arnhem, qui demande un déploiement au
// choix des joueurs que HexMap.vue ne fait pas encore.
//   - 'setup' : chaque pion à l'hex d'entrée déclaré par son `setup` (cf.
//     HexMap.vue::buildInitialCounters) — le seul mode existant ;
//   - 'free'  : placement au choix des joueurs — pas encore implémenté.
export const SUPPORTED_DEPLOYMENTS = ['setup']
// Scénario d'un module qui n'en déclare aucun : le déploiement du module.
export const DEFAULT_SCENARIOS = [{ id: 'historique', get label() { return t('settings.scenarioHistorical') }, deployment: 'setup' }]

/** Scénarios proposés pour `module` (JSON du module, ou `null` s'il n'est pas
 *  encore connu) — `DEFAULT_SCENARIOS` à défaut —, chacun complété :
 *  `{ id, label, deployment, weather: 'optional' | 'required', available }`,
 *  `available` étant faux si le module l'écarte ou si le moteur n'en sait pas
 *  appliquer le déploiement. */
export function scenarioOptions(module) {
  const declared = Array.isArray(module?.scenarios) && module.scenarios.length ? module.scenarios : DEFAULT_SCENARIOS
  return declared
    .filter((scenario) => typeof scenario?.id === 'string' && scenario.id)
    .map((scenario) => {
      const deployment = scenario.deployment ?? 'setup'
      return {
        id: scenario.id,
        get label() { return mt(scenario.label) ?? scenario.id },
        deployment,
        weather: scenario.weather === 'required' ? 'required' : 'optional',
        available: scenario.available !== false && SUPPORTED_DEPLOYMENTS.includes(deployment),
      }
    })
}

// Météo : aucune règle du moteur ne la lit encore — proposée grisée.
export const WEATHER_AVAILABLE = false
export const PARTY_OPTIONS = [
  { id: 'libre', get label() { return t('settings.party.libre') } },
  { id: 'assiste', get label() { return t('settings.party.assiste') } },
]
export const TIMING_OPTIONS = [
  { id: 'libre', get label() { return t('settings.timing.libre') } },
  { id: 'limite', get label() { return t('settings.timing.limite') } },
  { id: 'blitz', get label() { return t('settings.timing.blitz') } },
]
export const TIMING_HINTS = {
  get limite() { return t('settings.timingHint.limite') },
  get blitz() { return t('settings.timingHint.blitz') },
}
// Le chronomètre (Limité, Blitz) porte sur la phase de MOUVEMENT (cf.
// MoveTimer.vue), qui n'existe qu'en partie Assistée : en partie Libre, il
// n'y a pas de phases, donc pas de chronomètre possible (cf. le message
// `settings.timingLocked`).
export function timingAllowed(party) {
  return party === 'assiste'
}

// Réglages qui changent les RÈGLES de la partie : seuls ceux-là comptent pour
// savoir si une sauvegarde peut être reprise telle quelle (cf.
// lib/journalStorage.js::sameSettings). `weather` n'a pas d'effet tant qu'elle
// n'est pas disponible, et `scenario` non plus tant que le seul déploiement
// appliqué est 'setup' (cf. `SUPPORTED_DEPLOYMENTS`) — à ajouter ici le jour
// où deux scénarios disponibles déploieront différemment.
export const RULE_SETTING_KEYS = ['party', 'timing', 'timingValue']

const labelOf = (options, id) => (options.find((option) => option.id === id) ?? options[0]).label

// Identifiant de scénario plausible (reçu de l'URL, du serveur, d'un fichier).
const SCENARIO_ID_RE = /^[\w-]{1,32}$/

/** Réglages par défaut ; `scenarios` (cf. `scenarioOptions`) : le scénario
 *  par défaut est alors le premier disponible du module. */
export function defaultSettings(scenarios = null) {
  const scenario = scenarios?.find((option) => option.available)?.id ?? DEFAULT_SCENARIOS[0].id
  return { scenario, weather: '0', party: 'libre', timing: 'libre', timingValue: '' }
}

/** Complète/assainit des réglages partiels (URL, réponse serveur, fichier de
 *  sauvegarde) avec les valeurs par défaut — une valeur inconnue OU pas
 *  encore disponible retombe sur le défaut, et un chronomètre demandé en
 *  partie Libre est ignoré (cf. `timingAllowed`). Le résultat est ce que le
 *  moteur applique réellement : deux réglages qui se résolvent pareil
 *  donnent la même partie.
 *
 *  `scenarios` (cf. `scenarioOptions`) : scénarios du module joué. Sans eux
 *  (module pas encore chargé, liste des parties, comparaison de
 *  sauvegardes), le scénario est gardé tel quel s'il est plausible — sa
 *  disponibilité ne peut être vérifiée qu'avec le module. */
export function resolveSettings(raw, scenarios = null) {
  const defaults = defaultSettings(scenarios)
  const pick = (options, value, fallback) =>
    (options.some((option) => option.id === value && option.available !== false) ? value : fallback)
  const scenario = scenarios
    ? pick(scenarios, raw?.scenario, defaults.scenario)
    : (SCENARIO_ID_RE.test(raw?.scenario ?? '') ? raw.scenario : defaults.scenario)
  const party = pick(PARTY_OPTIONS, raw?.party, defaults.party)
  const timing = timingAllowed(party) ? pick(TIMING_OPTIONS, raw?.timing, defaults.timing) : 'libre'
  return {
    scenario,
    weather: WEATHER_AVAILABLE && raw?.weather === '1' ? '1' : '0',
    party,
    timing,
    timingValue: timingNeedsValue(timing) && raw?.timingValue ? String(raw.timingValue) : '',
  }
}

export function timingNeedsValue(timing) {
  return timing === 'limite' || timing === 'blitz'
}

/** Libellés affichés dans le bandeau de la partie et la liste des parties —
 *  `scenarios` (cf. `scenarioOptions`) pour le libellé du scénario ; à
 *  défaut, celui des scénarios par défaut, ou son identifiant. */
export function describeSettings(settings, scenarios = null) {
  return {
    scenario: (scenarios ?? DEFAULT_SCENARIOS).find((option) => option.id === settings.scenario)?.label ?? settings.scenario,
    weather: settings.weather === '1',
    party: labelOf(PARTY_OPTIONS, settings.party),
    timing: labelOf(TIMING_OPTIONS, settings.timing),
    timingValue: settings.timingValue,
  }
}
