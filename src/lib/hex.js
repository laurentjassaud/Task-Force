// Maths hexagonales — cohérentes avec le rendu flat-top de HexMap.vue :
// colonnes d'index IMPAIR décalées vers le bas (disposition "offset odd-q").
// col : 0-based (0 = première colonne). row : 1-based (cohérent avec hexId).

function offsetToCube(col, row) {
  const axialQ = col
  const axialR = row - (col - (col & 1)) / 2
  return { q: axialQ, r: axialR, s: -axialQ - axialR }
}

/** Distance en nombre d'hexs entre deux cases {col,row}. */
export function hexDistance(hexA, hexB) {
  const cubeA = offsetToCube(hexA.col, hexA.row)
  const cubeB = offsetToCube(hexB.col, hexB.row)
  return (Math.abs(cubeA.q - cubeB.q) + Math.abs(cubeA.r - cubeB.r) + Math.abs(cubeA.s - cubeB.s)) / 2
}

const AXIAL_DIRS = [
  { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 },
]

function toAxial(col, row) {
  const { q: axialQ, r: axialR } = offsetToCube(col, row)
  return { q: axialQ, r: axialR }
}
function fromAxial(axialQ, axialR) {
  return { col: axialQ, row: axialR + (axialQ - (axialQ & 1)) / 2 }
}

/** Les 6 hexs voisins de (col,row). */
export function neighborsOf(col, row) {
  const { q: axialQ, r: axialR } = toAxial(col, row)
  return AXIAL_DIRS.map((direction) => fromAxial(axialQ + direction.dq, axialR + direction.dr))
}
