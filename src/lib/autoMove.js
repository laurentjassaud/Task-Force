// ═══════════════════════════════════════════════════════════════════════════
// autoMove — chemin d'un pion qui marche SEUL vers un hex-objectif
// ═══════════════════════════════════════════════════════════════════════════
//
// Certains pions ne sont pas déplacés par le joueur mais par l'appli (cf.
// lib/moduleRules.js::autoMoveTarget — ex. les leurres et task forces
// japonaises de la mer de Corail). À chaque phase de Mouvement de leur camp,
// HexMap.vue::runAutoMoves leur fait suivre, pas à pas et tant que les
// règles le permettent (MP, terrain, ZOC — cf. lib/useAssisted.js::
// canEnterHex), le chemin calculé ici.
//
// Plus court chemin (Dijkstra) sur toute la carte, pondéré par le coût de
// terrain et limité aux pas que le terrain autorise (barrières côtières,
// passages d'île... cf. lib/useAssisted.js::canEnterTerrain) — comme la
// portée de lib/useDebug.js::reachableHexes, mais sans plafond de MP : le
// chemin va jusqu'à l'objectif, le pion n'en parcourt que ce que ses MP du
// tour lui permettent. Objectif inaccessible : le chemin mène à l'hex
// accessible le plus proche de lui.
//
// Hex COUPÉS par une île (cf. lib/passages.js) : on n'en ressort que par un
// côté de la même couleur que celui par lequel on y est entré. Un nœud du
// graphe est donc un hex ET le côté par lequel on y entre — sans quoi le
// chemin pourrait traverser une île, et le pion, refusé en route, perdrait
// ses tours à faire demi-tour.
import { neighborsOf, hexDistance } from './hex.js'

const hexIdOf = (col, row) => String(col + 1).padStart(2, '0') + String(row).padStart(2, '0')
const keyOf = (col, row, enteredFrom) => col + ',' + row + '|' + (enteredFrom ?? '')
const cellOf = (key) => key.split('|')[0].split(',').map(Number)

/** File de priorité minimale (tas binaire) : `push(priorité, valeur)`,
 *  `pop()` -> `{ priority, value }` de plus petite priorité. Une grille
 *  d'environ 600 hex × 7 côtés d'entrée est trop grande pour chercher le
 *  prochain nœud par simple parcours, comme le fait lib/useDebug.js. */
class MinQueue {
  constructor() { this.items = [] }
  get size() { return this.items.length }
  push(priority, value) {
    const items = this.items
    items.push({ priority, value })
    let index = items.length - 1
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (items[parent].priority <= items[index].priority) break
      ;[items[parent], items[index]] = [items[index], items[parent]]
      index = parent
    }
  }
  pop() {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length) {
      items[0] = last
      let index = 0
      for (;;) {
        const left = index * 2 + 1
        const right = left + 1
        let smallest = index
        if (left < items.length && items[left].priority < items[smallest].priority) smallest = left
        if (right < items.length && items[right].priority < items[smallest].priority) smallest = right
        if (smallest === index) break
        ;[items[smallest], items[index]] = [items[index], items[smallest]]
        index = smallest
      }
    }
    return top
  }
}

/** Hex (`{ col, row }`) à parcourir de `start` vers `target`, `start` exclu
 *  — liste vide si le pion y est déjà ou ne peut s'en rapprocher.
 *  `start.enteredFrom` : id ("CCRR") de l'hex d'où le pion est entré dans
 *  son hex de départ, ou `null`. `canStep(from, to, enteredFrom)` et
 *  `cost(from, to)` reçoivent des hex au format `{ c, r }` de
 *  lib/useAssisted.js, `enteredFrom` étant le côté d'entrée dans `from`. */
export function pathToward(start, target, { hexOnMap, canStep, cost }) {
  const startKey = keyOf(start.col, start.row, start.enteredFrom)
  const dist = new Map([[startKey, 0]])
  const previous = new Map()
  const visited = new Set()
  const queue = new MinQueue()
  queue.push(0, startKey)
  while (queue.size) {
    const { priority: currentDist, value: currentKey } = queue.pop()
    if (visited.has(currentKey)) continue
    visited.add(currentKey)
    const [col, row] = cellOf(currentKey)
    if (col === target.col && row === target.row) break
    const enteredFrom = currentKey.split('|')[1] || null
    for (const neighbor of neighborsOf(col, row)) {
      if (!hexOnMap(neighbor.col, neighbor.row)) continue
      const from = { c: col, r: row }
      const to = { c: neighbor.col, r: neighbor.row }
      if (!canStep(from, to, enteredFrom)) continue
      const next = currentDist + cost(from, to)
      const key = keyOf(neighbor.col, neighbor.row, hexIdOf(col, row))
      if (next < (dist.get(key) ?? Infinity)) { dist.set(key, next); previous.set(key, currentKey); queue.push(next, key) }
    }
  }
  // Destination : l'objectif s'il est atteignable (par le côté le moins
  // coûteux), sinon l'hex atteint le plus proche de lui (à distance égale,
  // le moins coûteux).
  let best = null
  for (const [key, distance] of dist) {
    const [col, row] = cellOf(key)
    const gap = hexDistance({ col, row }, target)
    if (!best || gap < best.gap || (gap === best.gap && distance < best.distance)) best = { key, gap, distance }
  }
  const path = []
  for (let key = best.key; key !== startKey; key = previous.get(key)) {
    const [col, row] = cellOf(key)
    path.unshift({ col, row })
  }
  return path
}
