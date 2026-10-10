// ═══════════════════════════════════════════════════════════════════════════
// passages — hex COUPÉS en plusieurs eaux (île, récif), déclarés par le module
// ═══════════════════════════════════════════════════════════════════════════
//
// Une île peut traverser un hex de part en part : un navire entré par le nord
// de l'île ne peut pas ressortir par le sud sans la contourner. Le module
// colorie donc les côtés de ces hex par GROUPES (cf. l'éditeur d'hexsides de
// la mer de Corail) : on ne passe, dans l'hex, que d'un côté à un côté de la
// MÊME couleur. Un côté sans couleur ne contraint rien.
//
// Déclaration : `terrain.edges.passages` nomme la couche de `terrain` qui
// porte ces couleurs, au format { "CCRR": { "couleur": ["AAAA-BBBB", ...] } } :
//
//   "terrain": {
//     "seaPassages": { "0305": { "green": ["0205-0305"], "blue": ["0204-0305"] } },
//     "edges": { "passages": "seaPassages", ... }
//   }
//
// Un côté est partagé par deux hex, et la saisie le range parfois sous l'hex
// VOISIN de celui qu'il coupe : la couleur d'un côté vue depuis un hex est
// donc celle qu'il porte sous cet hex, à défaut celle qu'il porte sous
// l'autre hex du côté.

/** Clé d'un côté "AAAA-BBBB", indépendante du sens. */
function sideKey(idA, idB) {
  return idA < idB ? idA + '-' + idB : idB + '-' + idA
}

/** `module.terrain` → `{ active, colorOf, allowsTransit }`. */
export function resolvePassages(terrain) {
  const layer = terrain?.edges?.passages
  const raw = layer && terrain?.[layer] && typeof terrain[layer] === 'object' ? terrain[layer] : {}

  // Hex → (côté → couleur), côtés normalisés.
  const byHex = new Map()
  for (const [hex, groups] of Object.entries(raw)) {
    const sides = new Map()
    for (const [color, edges] of Object.entries(groups ?? {})) {
      for (const edge of Array.isArray(edges) ? edges : []) {
        const [idA, idB] = String(edge).split('-')
        if (idA && idB) sides.set(sideKey(idA, idB), color)
      }
    }
    if (sides.size) byHex.set(hex, sides)
  }

  /** Couleur du côté `hex`|`neighbor` vue depuis `hex`, ou `null`. */
  function colorOf(hex, neighbor) {
    const key = sideKey(hex, neighbor)
    return byHex.get(hex)?.get(key) ?? byHex.get(neighbor)?.get(key) ?? null
  }

  /** Un pion entré dans `hex` depuis `enteredFrom` peut-il en sortir vers
   *  `to` ? Faux seulement si les deux côtés sont coloriés de couleurs
   *  différentes. Vrai sans côté d'entrée connu (pion posé là, ou présent
   *  depuis le début de la partie). */
  function allowsTransit(enteredFrom, hex, to) {
    if (!enteredFrom || !byHex.size) return true
    const entry = colorOf(hex, enteredFrom)
    const exit = colorOf(hex, to)
    return !entry || !exit || entry === exit
  }

  return { active: byHex.size > 0, colorOf, allowsTransit }
}
