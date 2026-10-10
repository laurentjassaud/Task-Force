// ═══════════════════════════════════════════════════════════════════════════
// combatTable — table de combat (CRT) déclarée par le module
// ═══════════════════════════════════════════════════════════════════════════
//
// La table de combat est une DONNÉE de la boîte de jeu (`module.combat`, cf.
// public/modules/arnhem/arnhem.json et son image images/combat-chart.png) ;
// le moteur (lib/useCombat.js pour le jet, lib/useRetreat.js pour
// l'application du résultat) ne fait que l'INTERPRÉTER. Ce fichier la lit,
// la vérifie et fournit les deux calculs qui en dépendent.
//
// Forme de `module.combat` :
//   - `die` : nombre de faces du dé (une ligne de `results` par face) ;
//   - `columns` : colonnes de DIFFÉRENTIEL (attaque − défense) de la ligne de
//     référence, de gauche à droite : `{ max, label }` — une colonne couvre
//     tout différentiel ≤ `max` que la précédente ne couvre pas ; la
//     dernière n'a pas de `max` et absorbe tout le reste ("+12 et plus") ;
//   - `rows` : lignes de TERRAIN `{ key, label, shift, firstLabel, terrains }`
//     — chacune est la ligne de référence décalée de `shift` colonnes vers la
//     gauche (avantage défensif du terrain) ; `terrains` liste les clés de
//     `terrain.grid` qui s'y rattachent ; `firstLabel` est l'étiquette
//     imprimée de sa 1re colonne (qui absorbe tout ce qui est en dessous) ;
//   - `defaultRow` : clé de la ligne d'un hex dont le terrain n'est rattaché
//     à aucune ligne ;
//   - `edgeRows` : substitution par la nature de l'HEXSIDE franchi par tous
//     les attaquants — `{ [nature d'arête]: { row, reason } }` (cf.
//     lib/useCombat.js::rowForTargetHex et lib/useAssisted.js::combatEdgeKind) ;
//   - `results` : `results[dé - 1][colonne - 1]` = code du résultat ;
//   - `labels` : libellé en clair de chaque code (affiché dans la modale) ;
//   - `effects` : ce que fait chaque code — `{ retreat: { defenders: n,
//     attackers: n } }` (les défenseurs retraitent en premier) et/ou
//     `{ eliminate: 'defenders' | 'attackers' }` (cf. lib/useRetreat.js::start) ;
//   - `advanceAfterCombat` : les vainqueurs peuvent-ils avancer dans le
//     chemin de retraite (vrai par défaut) ?
//
// Un module sans `combat` (ou avec une table incohérente — un avertissement
// est alors émis en console) n'a pas de combat : la phase Combat se déroule
// sans qu'aucun combat ne puisse y être ouvert.

/** `module.combat` → table vérifiée, ou `null` (pas de combat). */
export function resolveCombatTable(raw) {
  if (!raw || typeof raw !== 'object') return null
  const problems = []
  const die = Number.isInteger(raw.die) && raw.die >= 1 ? raw.die : null
  if (!die) problems.push('die')
  const columns = Array.isArray(raw.columns) ? raw.columns : []
  const columnsOk = columns.length > 0 && columns.every((column, index) =>
    typeof column?.label === 'string'
    && (index === columns.length - 1 || (Number.isFinite(column.max) && (index === 0 || column.max > columns[index - 1].max))))
  if (!columnsOk) problems.push('columns')
  const rows = Array.isArray(raw.rows) ? raw.rows : []
  const rowsOk = rows.length > 0 && rows.every((row) =>
    typeof row?.key === 'string' && typeof row.label === 'string' && Number.isInteger(row.shift)
    && row.shift >= 0 && row.shift < columns.length && Array.isArray(row.terrains))
  if (!rowsOk) problems.push('rows')
  if (!rows.some((row) => row.key === raw.defaultRow)) problems.push('defaultRow')
  const results = Array.isArray(raw.results) ? raw.results : []
  if (results.length !== die || results.some((line) => !Array.isArray(line) || line.length !== columns.length)) problems.push('results')
  const effects = raw.effects && typeof raw.effects === 'object' ? raw.effects : {}
  const missing = [...new Set(results.flat())].filter((code) => !effects[code])
  if (missing.length) problems.push(`effects (${missing.join(', ')})`)
  const edgeRows = raw.edgeRows && typeof raw.edgeRows === 'object' ? raw.edgeRows : {}
  if (Object.values(edgeRows).some((edgeRow) => !rows.some((row) => row.key === edgeRow?.row))) problems.push('edgeRows')
  if (problems.length) {
    console.warn(`module.combat incohérent (${problems.join(', ')}) : combat désactivé.`)
    return null
  }
  return {
    die, columns, rows, results, effects, edgeRows,
    defaultRow: raw.defaultRow,
    labels: raw.labels && typeof raw.labels === 'object' ? raw.labels : {},
    advanceAfterCombat: raw.advanceAfterCombat !== false,
  }
}

/** Colonne (1-based) de la ligne de référence pour le différentiel `diff` :
 *  la première dont le `max` le couvre, la dernière sinon. Les autres lignes
 *  s'en déduisent par décalage (cf. lib/useCombat.js::column). */
export function referenceColumn(table, diff) {
  const last = table.columns.length - 1
  return table.columns.findIndex((column, index) => index === last || diff <= column.max) + 1
}

/** Étiquettes de différentiel de chaque ligne de terrain, pour la mini-table
 *  de la modale : une par colonne réellement couverte par la ligne (les
 *  suivantes restent vides, comme sur la table imprimée). */
export function rowCells(table, row) {
  return Array.from({ length: table.columns.length - row.shift }, (_, index) =>
    (index === 0 ? row.firstLabel ?? table.columns[row.shift].label : table.columns[index + row.shift].label))
}
