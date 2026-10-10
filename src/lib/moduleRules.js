// ═══════════════════════════════════════════════════════════════════════════
// moduleRules — registre des règles PARTICULIÈRES par module
// ═══════════════════════════════════════════════════════════════════════════
//
// Chaque boîte de jeu peut avoir des règles qu'aucun champ du JSON ne sait
// exprimer (cf. lib/useArnhem.js, qui explique le patron et la convention
// `null` = "pas de règle particulière"). Le moteur (HexMap.vue) ne connaît
// plus chaque module par son nom : il demande ICI le composable de règles du
// module joué, et reçoit un composable INERTE pour un module qui n'en a pas.
//
// AJOUTER UN MODULE : écrire `lib/useHurtgen.js` sur le patron de
// useArnhem.js (mêmes fonctions que `INERT_RULES`, chacune rendant `null` ou
// ne faisant rien quand elle n'a rien à dire), puis l'inscrire dans
// `REGISTRY` — c'est la seule ligne du moteur à toucher.
import { unref } from 'vue'
import { useArnhem, ARNHEM_MODULE_ID } from './useArnhem.js'
import { useCoralSea, CORAL_SEA_MODULE_ID } from './useCoralSea.js'

/** Interface qu'expose tout composable de règles particulières — et ce que
 *  reçoit le moteur pour un module sans règles particulières. */
export const INERT_RULES = Object.freeze({
  active: false,
  /** Ce pion est-il posé au chargement ? `true`/`false` pour trancher, `null` pour laisser la règle générique. */
  autoPlacesAtLoad: () => null,
  /** Un aéroporté vient d'être posé (mémoire du tour, cf. useArnhem.js). */
  noteAirborneArrival: () => {},
  /** MP à compter comme déjà dépensés du fait de l'arrivée, ou `null`. */
  airborneArrivalSpentMp: () => null,
  /** Nouveau camp/tour : oublier ce qui ne valait que pour le tour écoulé. */
  clearTurnState: () => {},
  /** Cet hex peut-il recevoir un pion de soutien ? `false` pour l'interdire, `null` sinon. */
  supportHexAllowed: () => null,
  /** Combien d'artilleries un camp peut-il combiner dans un combat ? Un nombre, ou `null` (sans limite). */
  maxArtilleryPerCombat: () => null,
  /** Réduction de retraite offerte dans cet hex — `{ total, reason }` ou `null`. */
  cityRetreatReduction: () => null,
  /** Cette unité peut-elle franchir cet hexside malgré le terrain ? `true` pour l'ouvrir, `null` sinon. */
  engineerCrossingAllows: () => null,
  /** Ce pion échappe-t-il à la limite d'empilement ? `true` s'il ne compte pas, `null` sinon. */
  stackingExempt: () => null,
  /** Nature d'arête à substituer AU COMBAT pour cette unité, ou `null` (assaut de rivière). */
  engineerAssaultEdge: () => null,
  /** Ce pion éliminé revient-il en renfort ? `{ setup, turn }` ou `null`. */
  rebuiltReinforcement: () => null,
  /** Le génie qui tient un passage sur cet hex, ou `null`. */
  engineerAt: () => null,
  /** Cette unité est-elle un aéroporté ou un planeur à pied ? */
  isAirborneFoot: () => false,
  /** Potentiel de mouvement de ce pion ce tour-ci (`turnInfo` = détail du tour de la piste), ou `null` (règle générique). */
  movementAllowance: () => null,
  /** Étiquette secrète d'un pion, montrée au seul camp `privateLabelSide`, ou `null`. */
  privateLabel: () => null,
  privateLabelSide: null,
  /** Tirage secret à inscrire au journal avec le déploiement, ou `null`. */
  setupSecrets: () => null,
  /** Rétablit ce tirage, lu dans le journal (rejeu, partie en ligne). */
  restoreSetupSecrets: () => {},
  /** Hex vers lequel ce pion marche SEUL à chaque phase de Mouvement de
   *  `autoMoveSide` (`{ col, row }`), ou `null` (déplacé par le joueur). */
  autoMoveTarget: () => null,
  autoMoveSide: null,
  /** Cet hex (`{ col, row }`) est-il interdit à ce pion — placement comme
   *  mouvement ? `true` pour l'interdire, `null` sinon. */
  hexForbidden: () => null,
  /** Phase (id de `turnStructure.phases`) où `autoMoveSide` fait ses
   *  reconnaissances, ou `null` (pas de reconnaissance du moteur). */
  reconPhase: null,
  /** Checks de reconnaissance du camp donné : chaque source (`{ key, base,
   *  name, unitId, checks, col, row }`) explore jusqu'à `checks` de ses hex
   *  par phase (`[{ source, targets: [{ col, row }] }]`), ou `null`. */
  reconChecks: () => null,
  /** Ce pion est-il une cible de reconnaissance pour ce camp ? */
  reconTargetOf: () => false,
  /** Camp qui fait SES reconnaissances à la main (clic source puis cible), ou `null`. */
  manualReconSide: null,
  /** Chits restant dans la tasse de recherche (`{ résultat: nombre }`), ou `null`. */
  searchBag: null,
  /** Tire un chit de recherche : `{ result, bag }`, ou `null`. */
  drawSearch: () => null,
  /** Remet tous les chits dans la tasse. */
  refillSearchBag: () => {},
  /** Rétablit le contenu de la tasse, lu dans le journal. */
  restoreSearchBag: () => {},
  /** Les chits reviennent-ils dans la tasse à ce tour (`turnInfo` de la piste) ? */
  searchChitsReturn: () => false,
  /** Pion posé pour chaque résultat : `{ résultat: { name, src } }`, ou `null`. */
  searchResults: null,
  /** Effet d'un chit sur l'unité explorée : `{ sighting, removed }`, ou `null`. */
  searchOutcome: () => null,
  /** États de repérage : `{ état: { name?, src? } }` (`src` = pion "Sighted" à poser, par camp), ou `null`. */
  sightings: null,
})

const REGISTRY = {
  [ARNHEM_MODULE_ID]: useArnhem,
  [CORAL_SEA_MODULE_ID]: useCoralSea,
}

/** Composable de règles particulières du module `moduleId` (chaîne ou ref),
 *  avec le contexte `ctx` que le moteur lui prête (cf. useArnhem.js pour
 *  son contenu) — `INERT_RULES` si le module n'en déclare pas. */
export function useModuleRules(moduleId, ctx = {}) {
  const hook = REGISTRY[unref(moduleId)]
  return hook ? hook(moduleId, ctx) : { ...INERT_RULES }
}
