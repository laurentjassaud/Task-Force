// ═══════════════════════════════════════════════════════════════════════════
// bugReport — rapport de bug GitHub pré-rempli
// ═══════════════════════════════════════════════════════════════════════════
//
// Le bouton "Signaler un bug" (cf. HexMap.vue, BugReportModal.vue) ouvre la
// page de création de ticket du dépôt GitHub, PRÉ-REMPLIE (titre + corps) :
// le joueur n'a plus qu'à la valider avec son propre compte GitHub — aucun
// jeton, aucun serveur intermédiaire. Contrainte : tout doit tenir dans
// l'URL, que GitHub refuse au-delà d'environ 8 000 caractères (cf.
// `MAX_URL_LENGTH`).
//
// Corps du ticket :
//   1. la description du joueur ;
//   2. le contexte (module, réglages, situation, partie locale/en ligne,
//      version de l'application, navigateur) ;
//   3. les derniers coups du journal EN CLAIR, autant que la place le permet
//      (les plus récents d'abord) ;
//   4. l'EXPORT : état de la carte et `REPORT_ENTRIES` derniers coups avec
//      toutes leurs données (cf. HexMap.vue::bugReportSnapshot), compressé
//      (gzip) puis encodé en base64url — illisible tel quel, mais plusieurs
//      fois plus court que le JSON. Décodage :
//      `node scripts/decode-bug-report.mjs <export>`.
//
// La partie COMPLÈTE ne tient pas dans l'URL : elle est téléchargée au clic
// sur "Soumettre" (cf. BugReportModal.vue), et le ticket demande d'y glisser
// ce fichier (section "Partie complète").

/** Dépôt GitHub qui reçoit les rapports ("propriétaire/nom"). */
export const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO || 'laurentjassaud/generic-wargame'

/** Nombre de coups du journal joints au rapport. */
export const REPORT_ENTRIES = 30

// Longueur maximale de l'URL du ticket pré-rempli (GitHub répond "414" au-delà
// d'environ 8 Ko), et part réservée à l'export compressé dans cette URL.
const MAX_URL_LENGTH = 8000
const MAX_EXPORT_LENGTH = 4200

/** Version de l'application (commit git, injecté au build par
 *  vite.config.js), ou chaîne vide. */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

/** Numéro de version de l'application (champ `version` de package.json,
 *  injecté au build par vite.config.js), ou chaîne vide. */
export const APP_RELEASE = typeof __APP_RELEASE__ !== 'undefined' ? __APP_RELEASE__ : ''

/** Octets -> base64url (sans `=`), qui passe dans une URL sans être
 *  ré-encodé. */
function toBase64Url(bytes) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** `data` -> JSON compressé en gzip (si le navigateur sait le faire, cf.
 *  CompressionStream), encodé en base64url. Le script de décodage reconnaît
 *  lui-même un contenu gzip ou non. */
async function pack(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  if (typeof CompressionStream === 'undefined') return toBase64Url(bytes)
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))
}

/** Export du rapport : `snapshot` (état de la carte, cf.
 *  HexMap.vue::bugReportSnapshot) et ses `entries` (les derniers coups).
 *  Si l'export compressé dépasse sa part de l'URL, les coups les plus
 *  anciens sont retirés jusqu'à ce qu'il tienne. Renvoie `{ packed, count }`
 *  — `count` : nombre de coups finalement retenus. */
export async function prepareExport(snapshot) {
  const entries = snapshot.entries ?? []
  for (let count = entries.length; count >= 0; count = count > 5 ? count - 5 : count - 1) {
    const packed = await pack({ ...snapshot, entries: entries.slice(entries.length - count) })
    if (packed.length <= MAX_EXPORT_LENGTH || count === 0) return { packed, count }
  }
  return { packed: '', count: 0 }
}

/** Corps Markdown du ticket. */
function issueBody({ description, context, lines, exported, gameFileName }) {
  const parts = [description.trim() || '_(pas de description)_', '']
  if (gameFileName) {
    parts.push('### Partie complète',
      `**Glissez ici le fichier \`${gameFileName}\`**, qui vient d'être téléchargé (dossier Téléchargements).`, '')
  }
  parts.push('### Contexte')
  for (const [label, value] of context) parts.push(`- ${label} : ${value}`)
  parts.push(`- Version : ${[APP_RELEASE, APP_VERSION].filter(Boolean).join(' · ') || 'inconnue'}`)
  parts.push(`- Navigateur : ${navigator.userAgent}`)
  if (lines.length) {
    parts.push('', `### Derniers coups (${lines.length})`, '```', ...lines, '```')
  }
  parts.push('', '### Export',
    `<details><summary>État de la carte et ${exported.count} derniers coups — gzip + base64url, `
    + 'décodage : <code>node scripts/decode-bug-report.mjs</code></summary>', '', '```', exported.packed, '```', '</details>')
  return parts.join('\n')
}

/** URL de création du ticket pré-rempli. `lines` : derniers coups en clair
 *  (du plus ancien au plus récent) ; on en garde le plus possible, les plus
 *  récents d'abord, puis, en dernier recours, on raccourcit la description.
 *  Renvoie `{ url, lineCount, descriptionCut }`. */
export function buildIssueUrl({ title, description, context, lines, exported, gameFileName = '' }) {
  const make = (text, kept) => {
    const params = new URLSearchParams({ title: title.trim(), body: issueBody({ description: text, context, lines: kept, exported, gameFileName }) })
    return `https://github.com/${GITHUB_REPO}/issues/new?${params}`
  }
  for (let count = lines.length; count >= 0; count--) {
    const url = make(description, lines.slice(lines.length - count))
    if (url.length <= MAX_URL_LENGTH) return { url, lineCount: count, descriptionCut: false }
  }
  // Description trop longue à elle seule : raccourcie jusqu'à ce que ça tienne.
  let text = description
  while (text.length > 0) {
    text = text.slice(0, Math.floor(text.length * 0.8))
    const url = make(`${text}… _(description tronquée)_`, [])
    if (url.length <= MAX_URL_LENGTH) return { url, lineCount: 0, descriptionCut: true }
  }
  return { url: make('', []), lineCount: 0, descriptionCut: true }
}
