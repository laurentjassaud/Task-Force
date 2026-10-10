// Forme réelle de la grille hexagonale d'un module — au-delà du simple
// rectangle cols×rows : colonnes décalées (0-based impaires, cf. HexMap.vue)
// amputées d'une ligne quand `map.evenColMinus` est actif, plus des hexs
// ponctuels absents de la carte imprimée listés dans `map.removedHexes`
// ("2501,2502,2601").
import { hexId } from './calibration.js'

/** Ensemble des ids d'hex explicitement retirés de la carte. */
export function removedHexSet(map) {
  const raw = map && map.removedHexes
  if (!raw) return new Set()
  return new Set(String(raw).split(',').map((idText) => idText.trim()).filter(Boolean))
}

/** Dernière ligne valide (1-based) pour une colonne 0-based donnée : les
 *  colonnes décalées vers le bas (index impair) ont une ligne de moins que
 *  `map.rows` quand `map.evenColMinus` est actif. */
export function lastRowOfCol(col, map) {
  return map.evenColMinus && col % 2 === 1 ? map.rows - 1 : map.rows
}

/** Un hex (col 0-based, row 1-based) fait-il partie de la carte ?
 *  `removed`, si fourni, évite de reconstruire le Set à chaque appel. */
export function hexExists(col, row, map, removed) {
  if (col < 0 || col >= map.cols || row < 1 || row > lastRowOfCol(col, map)) return false
  const set = removed || removedHexSet(map)
  return !set.has(hexId(col + 1, row))
}
