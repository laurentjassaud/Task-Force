// ═══════════════════════════════════════════════════════════════════════════
// setup — notation `setup` des pions (hex d'entrée en jeu)
// ═══════════════════════════════════════════════════════════════════════════
//
// Chaque pion d'un module déclare où il entre en jeu (cf. README, "Anatomie
// d'un module") sous l'une de quatre formes :
//   - "CCRR"       : cet hex précis (col/ligne imprimées, 1-based) ;
//   - "CCRR-CCRR"  : une plage de bord de carte — tous les hex "sur ou entre"
//                    les deux bornes (ex. renforts allemands d'Arnhem), en
//                    suivant le bord réel quand une colonne sur deux
//                    s'arrête plus haut (cf. `rangeCells`) ;
//   - "CCRR+adj"   : un LARGAGE — l'hex de référence ou l'un de ses 6 voisins
//                    (ex. chaque unité alliée d'Arnhem près de sa zone de
//                    largage). C'est ce suffixe, et lui seul, qui fait d'un
//                    pion un AÉROPORTÉ pour tout le moteur (phase Airborne,
//                    coût d'entrée, règles particulières du module...) ;
//   - "*"          : n'importe quel hex de la carte (ex. task forces
//                    américaines de la mer de Corail, posées librement à la
//                    mise en place). Jamais posé d'office au chargement.
//
// Avant ce fichier, cette notation était reniflée en six endroits
// (`endsWith('+adj')`, `includes('-')`, `parseHexId` sur les 4 premiers
// caractères...) ; elle n'est plus analysée qu'ici. Coordonnées renvoyées au
// format interne (`col` 0-based, `row` 1-based — cf. lib/calibration.js).
import { parseHexId } from './calibration.js'
import { neighborsOf } from './hex.js'

const SETUP_RE = /^(\d{4})(?:-(\d{4})|(\+adj))?$/

/** `{ kind: 'hex', ref }`, `{ kind: 'range', ref, to }`, `{ kind:
 *  'adjacent', ref }` ou `{ kind: 'anywhere' }` — `null` si `setup` est
 *  absent ou mal formé. */
export function parseSetup(setup) {
  if (typeof setup !== 'string') return null
  if (setup.trim() === '*') return { kind: 'anywhere' }
  const match = SETUP_RE.exec(setup.trim())
  if (!match) return null
  const ref = parseHexId(match[1])
  if (match[2]) return { kind: 'range', ref, to: parseHexId(match[2]) }
  if (match[3]) return { kind: 'adjacent', ref }
  return { kind: 'hex', ref }
}

/** Ce pion entre-t-il en jeu par LARGAGE (`setup` "+adj") ? */
export function isAirborneEntry(counter) {
  return parseSetup(counter?.setup)?.kind === 'adjacent'
}

/** Hex d'une plage "CCRR-CCRR" (`parsed.kind === 'range'`), sur la carte
 *  (`hexOnMap(col, row)`), dans l'ordre ; à défaut d'hex valide, la borne
 *  de départ seule. Pour toute autre forme : l'hex de référence.
 *
 *  Une plage est une BANDE DE BORD, et un bord de carte hexagonale n'est pas
 *  toujours une ligne bien droite : sur une grille à colonnes décalées (cf.
 *  lib/mapShape.js, `map.evenColMinus`), une colonne sur deux s'arrête une
 *  ligne plus haut — le bord bas d'Arnhem est ainsi 0126, 0225, 0326, 0425...
 *  Une plage déclarée "0126-2726" doit donc suivre ce bord, pas s'évaporer
 *  une colonne sur deux : quand l'hex de la ligne déclarée n'existe pas dans
 *  cette colonne ET que la colonne s'arrête juste au-dessus, on prend cet hex
 *  du dessus. Un simple TROU au milieu de la carte (`map.removedHexes`), lui,
 *  reste un trou : la colonne continue en dessous, donc rien n'est pris.
 *
 *  Une plage dont les DEUX bornes diffèrent en colonne ET en ligne (ex.
 *  "0126-0825") décrit ce même bord en biais : elle est lue comme une bande
 *  de colonnes sur la ligne la plus basse des deux bornes, la règle ci-dessus
 *  ramenant chaque colonne courte à sa dernière ligne. Seule une plage sur
 *  une même COLONNE (ex. "0110-0115") est lue verticalement. */
export function rangeCells(parsed, hexOnMap) {
  // "*" : toute la carte, que l'appelant énumère lui-même (cf. HexMap.vue::
  // entryHexSet) — aucun hex de référence ici.
  if (!parsed || parsed.kind === 'anywhere') return []
  if (parsed.kind !== 'range') return [parsed.ref]
  const { ref: from, to } = parsed
  const cells = []
  if (from.col === to.col && from.row !== to.row) {
    const [lo, hi] = from.row <= to.row ? [from.row, to.row] : [to.row, from.row]
    for (let row = lo; row <= hi; row++) {
      if (hexOnMap(from.col, row)) cells.push({ col: from.col, row })
    }
  } else {
    const row = Math.max(from.row, to.row)
    const [lo, hi] = from.col <= to.col ? [from.col, to.col] : [to.col, from.col]
    for (let col = lo; col <= hi; col++) {
      if (hexOnMap(col, row)) { cells.push({ col, row }); continue }
      // Colonne plus courte (grille décalée) : son bord est la ligne du
      // dessus — mais seulement si la colonne s'arrête bien là.
      if (hexOnMap(col, row - 1) && !hexOnMap(col, row + 1)) cells.push({ col, row: row - 1 })
    }
  }
  return cells.length ? cells : [from]
}

/** Hex candidats au PLACEMENT AUTOMATIQUE de départ (cf. HexMap.vue::
 *  buildInitialCounters) : toute la plage pour un "range", sinon l'hex de
 *  référence (un largage automatique se pose sur sa zone de largage). */
export function deploymentCells(parsed, hexOnMap) {
  return rangeCells(parsed, hexOnMap)
}

/** Hex d'atterrissage d'un largage (`parsed.kind === 'adjacent'`) : l'hex
 *  de référence puis ses 6 voisins, sur la carte. Vide pour une autre forme. */
export function landingCells(parsed, hexOnMap) {
  if (parsed?.kind !== 'adjacent') return []
  const { ref } = parsed
  return [ref, ...neighborsOf(ref.col, ref.row).filter((neighbor) => hexOnMap(neighbor.col, neighbor.row))]
}
