// Reprend les 38 images de pions allemands (fournies par l'utilisateur, extraites
// de la conversation) et les installe dans public/modules/arnhem/images/counters/german/,
// puis (re)génère la section counters.german de public/modules/arnhem/arnhem.json avec les
// stats lues sur chaque image (ordre = ordre de collage = img-01..img-38).
//
// Règle de nom : code imprimé "A/B" (ex. "2/9SS") -> nom canonique "B-A" (inversé,
// slash->dash). Un code sans "/" (ex. "BrOr", "180") est déjà le nom tel quel.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = process.argv[2]
if (!srcDir) {
  console.error('Usage: node scripts/apply-german-counters.mjs <dossier-images-extraites>')
  process.exit(1)
}
const outDir = 'public/modules/arnhem/images/counters/german'
mkdirSync(outDir, { recursive: true })

// Nettoyage des anciens placeholders SVG générés précédemment.
for (const fileName of readdirSync(outDir)) {
  if (fileName.endsWith('.svg')) unlinkSync(join(outDir, fileName))
}

// Unités combat (infanterie/reco) — attaque-défense-mouvement. img = ordre de collage.
const UNITS = [
  { img: 1, code: '1/2', atk: 1, def: 2, mov: 7 },
  { img: 2, code: '1/1PT', atk: 2, def: 2, mov: 7 },
  { img: 3, code: '2/1PT', atk: 2, def: 2, mov: 7 },
  { img: 4, code: '1/406', atk: 2, def: 2, mov: 7 },
  { img: 5, code: '2/406', atk: 2, def: 2, mov: 7 },
  { img: 6, code: 'BrOr', atk: 2, def: 2, mov: 7 },
  { img: 7, code: '9SS', atk: 2, def: 2, mov: 12, ss: true },
  { img: 8, code: '10SS', atk: 2, def: 2, mov: 12, ss: true },
  { img: 9, code: 'Grsn', atk: 2, def: 2, mov: 12 },
  { img: 10, code: '1/6PT', atk: 2, def: 3, mov: 7 },
  { img: 11, code: '2/6PT', atk: 2, def: 3, mov: 7 },
  { img: 12, code: '180', atk: 2, def: 3, mov: 7 },
  { img: 13, code: '1/rher', atk: 2, def: 3, mov: 7 },
  { img: 14, code: '2/rber', atk: 2, def: 3, mov: 7 },
  { img: 15, code: 'Jngw', atk: 2, def: 3, mov: 7 },
  { img: 16, code: '1/6', atk: 3, def: 3, mov: 7 },
  { img: 17, code: '2/6', atk: 3, def: 3, mov: 7 },
  { img: 18, code: '1/59', atk: 3, def: 3, mov: 7 },
  { img: 19, code: '2/59', atk: 3, def: 3, mov: 7 },
  { img: 20, code: 'Kft', atk: 3, def: 3, mov: 7 },
  { img: 21, code: '1/VT', atk: 3, def: 3, mov: 7 },
  { img: 22, code: '2/VT', atk: 3, def: 3, mov: 7 },
  { img: 23, code: '3/VT', atk: 3, def: 3, mov: 7 },
  { img: 24, code: '2/10SS', atk: 3, def: 4, mov: 7, ss: true },
  { img: 25, code: '3/10SS', atk: 3, def: 4, mov: 7, ss: true },
  { img: 26, code: 'Hnke', atk: 4, def: 3, mov: 10 },
  { img: 27, code: '2/9SS', atk: 4, def: 4, mov: 7, ss: true },
  { img: 28, code: '3/9SS', atk: 4, def: 4, mov: 7, ss: true },
  { img: 29, code: '1/10SS', atk: 4, def: 4, mov: 10, ss: true },
  { img: 30, code: '2107', atk: 4, def: 4, mov: 10 },
  { img: 31, code: '2107', atk: 5, def: 3, mov: 10 },
  { img: 32, code: '1/9SS', atk: 5, def: 5, mov: 10, ss: true },
  { img: 33, code: 'Hber', atk: 5, def: 5, mov: 10 },
]

// Unités artillerie — haut : barrage-fpf-portée, bas : défense-mouvement.
const ARTY = [
  { img: 34, code: 'SS9', bar: 3, fpf: 2, range: 7, def: 3, mov: 7, ss: true },
  { img: 35, code: '1/10SS', bar: 3, fpf: 2, range: 7, def: 3, mov: 7, ss: true },
  { img: 36, code: '2/10SS', bar: 3, fpf: 2, range: 7, def: 3, mov: 7, ss: true },
  { img: 37, code: 'Hber', bar: 2, fpf: 2, range: 7, def: 2, mov: 7 },
  { img: 38, code: 'Witr', bar: 2, fpf: 2, range: 7, def: 2, mov: 7 },
]

function nameFromCode(code) {
  if (!code.includes('/')) return code
  const [beforeSlash, afterSlash] = code.split('/')
  return `${afterSlash}-${beforeSlash}`
}

const counters = []
for (const unit of [...UNITS, ...ARTY]) {
  const id = 'de-' + String(unit.img).padStart(2, '0')
  const file = id + '.png'
  copyFileSync(join(srcDir, `img-${String(unit.img).padStart(2, '0')}.png`), join(outDir, file))
  const isArty = unit.bar != null
  counters.push({
    id, name: nameFromCode(unit.code), code: unit.code, type: isArty ? 'arty' : 'infantry', faction: 'german',
    ...(isArty ? { bar: unit.bar, fpf: unit.fpf, range: unit.range } : { atk: unit.atk }),
    def: unit.def, mov: unit.mov, ss: !!unit.ss, src: `/modules/arnhem/images/counters/german/${file}`,
  })
}

const modPath = 'public/modules/arnhem/arnhem.json'
const mod = JSON.parse(readFileSync(modPath, 'utf8'))
mod.counters = mod.counters || {}
mod.counters.german = counters
writeFileSync(modPath, JSON.stringify(mod, null, 2) + '\n')

console.log(`Installé ${counters.length} pions allemands (images réelles) dans ${outDir}`)
console.log(`arnhem.json mis à jour (counters.german)`)
