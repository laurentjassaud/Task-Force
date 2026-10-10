// Lit l'export live de l'artefact "Grille de Mouvement Arnhem" (roads-data,
// trails-data, removed-data, et les hex dont le terrain a été changé au clic
// gauche) et produit un fichier de transition à côté du module — jamais
// écrit directement dans arnhem.json, pour permettre une relecture avant
// application manuelle.
import { readFileSync, writeFileSync } from 'node:fs'

const liveHtmlPath = process.argv[2]
if (!liveHtmlPath) {
  console.error('Usage: node scripts/build-terrain-transition.mjs <chemin-vers-le-html-de-l-artefact>')
  process.exit(1)
}
const live = readFileSync(liveHtmlPath, 'utf8')
const mod = JSON.parse(readFileSync('public/modules/arnhem/arnhem.json', 'utf8'))

function extractJsonTag(id) {
  const tagMatch = live.match(new RegExp(`<script id="${id}" type="application/json">([^<]*)</script>`))
  if (!tagMatch) throw new Error('missing data tag: ' + id)
  return JSON.parse(tagMatch[1])
}

const removedHexes = extractJsonTag('removed-data')
const roads = extractJsonTag('roads-data')
const trails = extractJsonTag('trails-data')

// Terrain changés au clic gauche : on relit chaque polygone d'hex de
// hexLayer pour son couple (id, terrain) tel que laissé par l'artefact.
const hexLayerMatch = live.match(/<g id="hexLayer"[^>]*>([\s\S]*?)<\/g>/)
if (!hexLayerMatch) throw new Error('missing hexLayer group')
const terrainGrid = { ...mod.terrain.grid }
const terrainChanges = []
const polyRe = /data-id="(\d{4})"[^>]*data-terrain="(\w+)"/g
let mArr
while ((mArr = polyRe.exec(hexLayerMatch[1]))) {
  const [, id, terrain] = mArr
  if (terrainGrid[id] !== terrain) {
    terrainChanges.push({ id, from: terrainGrid[id] || 'mixed', to: terrain })
    terrainGrid[id] = terrain
  }
}

const transition = JSON.parse(JSON.stringify(mod)) // deep clone
transition.map.removedHexes = removedHexes.join(',')
transition.terrain.grid = terrainGrid
transition.terrain.roads = roads
transition.terrain.trails = trails

const outPath = 'public/modules/arnhem/arnhem.transition.json'
writeFileSync(outPath, JSON.stringify(transition, null, 2) + '\n')

console.log('Wrote', outPath)
console.log('removedHexes:', removedHexes.length, 'hex(es)')
console.log('roads:', roads.length, 'segment(s)')
console.log('trails:', trails.length, 'segment(s)')
console.log('terrain changes:', terrainChanges.length)
for (const terrainChange of terrainChanges) console.log('  ', terrainChange.id, terrainChange.from, '->', terrainChange.to)
