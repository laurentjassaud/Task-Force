// Décode l'export joint à un rapport de bug GitHub (cf. src/lib/bugReport.js) :
// bloc base64url, compressé en gzip par les navigateurs qui le savent.
//
// Usage : node scripts/decode-bug-report.mjs <export>
//     ou : node scripts/decode-bug-report.mjs < export.txt
// Affiche le JSON : réglages, pas/phase, positions ("id@CCRR"), unités
// éliminées ou ayant combattu, et les derniers coups du journal (mêmes
// entrées `{ t, kind, text, data }` qu'un journal enregistré).
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const input = (process.argv[2] ?? readFileSync(0, 'utf8')).replace(/\s+/g, '')
if (!input) {
  console.error('Usage: node scripts/decode-bug-report.mjs <export>')
  process.exit(1)
}
const bytes = Buffer.from(input, 'base64url')
// Signature gzip (1f 8b) : export compressé ; sinon, JSON brut.
const json = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8')
console.log(JSON.stringify(JSON.parse(json), null, 2))
