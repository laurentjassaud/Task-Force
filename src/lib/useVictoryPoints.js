// ═══════════════════════════════════════════════════════════════════════════
// useVictoryPoints — POINTS DE VICTOIRE
// ═══════════════════════════════════════════════════════════════════════════
//
// Un total par camp, tenu de deux façons selon le mode de partie :
//   - mode LIBRE : les joueurs comptent eux-mêmes (cf. VictoryPoints.vue,
//     boutons − et +). Ce fichier ne fait alors que garder les totaux et les
//     rendre au journal ;
//   - mode ASSISTÉ : le moteur les attribue, d'après ce que le module déclare
//     (`rules.victoryPoints`, cf. lib/rules.js::resolveVictoryPoints).
//
// ─── CE QUI RAPPORTE (Arnhem) ────────────────────────────────────────────────
//   - une unité ÉLIMINÉE rapporte à son adversaire : 1 point à l'Allié par
//     unité allemande, 5 points à l'Allemand par unité alliée. Une unité qui
//     se reconstitue et revient en renfort (le génie, cf.
//     lib/useArnhem.js::rebuiltReinforcement) n'a jamais été perdue : elle ne
//     rapporte rien ;
//   - à chaque FIN DE TOUR, l'Allié marque pour chaque unité non aéroportée
//     qui tient une position au-delà d'un fleuve ET trace une ligne de
//     communication : 5 points au-delà de la Waal, 10 au-delà du Neder Rijn.
//     Les deux zones sont DISJOINTES (les fleuves isolent deux régions
//     distinctes de la carte), une unité ne peut donc pas cumuler ;
//   - à chaque FIN DE TOUR, l'Allemand marque 3 points par unité alliée
//     incapable de tracer une ligne de communication.
// Ces comptes de fin de tour s'AJOUTENT à chaque tour : tenir une position
// cinq tours durant rapporte cinq fois.
//
// ─── COMMENT UNE ZONE EST DÉLIMITÉE ──────────────────────────────────────────
// « À droite de la Waal » ne se décrit ni par une ligne droite ni par une
// liste d'hex : c'est la région que le fleuve ISOLE. On part d'un hex témoin
// déclaré par le module (`zones[].seed` — 3005 pour l'Île, 3706 pour Arnhem)
// et on remplit de proche en proche SANS JAMAIS franchir une arête de
// rivière, ponts compris : un pont fait passer des hommes, il ne déplace pas
// la rive. La zone épouse ainsi le tracé imprimé, méandres compris, et suit
// la carte si elle change. Calculée une fois pour toutes (cf. `zoneHexes`) :
// les fleuves ne bougent pas.
//
// ─── CE QUI EST JOURNALISÉ ───────────────────────────────────────────────────
// Chaque attribution donne une entrée `victory` (cf. HexMap.vue) : le camp,
// les points, le nouveau total, la raison, le TOUR (`turn`) et, pour un
// compte de Fin de tour, `endOfTurn: true`. `applyReplay` la rejoue telle
// quelle — ce qui la fait aussi arriver, en ligne, chez l'autre joueur (cf.
// HexMap.vue::applyRemoteEntry), sans canal réseau dédié.
//
// ─── UNE SEULE FIN DE TOUR PAR TOUR ──────────────────────────────────────────
// Les comptes de Fin de tour ne se font qu'UNE fois par tour (cf.
// `scoredTurns`) : un journal rechargé en pleine Fin de tour rejoue les
// entrées déjà marquées, il ne doit pas les compter une seconde fois.
//
// ─── RÉSULTAT DE LA PARTIE ───────────────────────────────────────────────────
// Le module peut déclarer comment les totaux se traduisent en résultat
// (`victory.outcome`, cf. lib/rules.js::resolveOutcome) : on divise les
// points d'un camp par ceux de l'autre, et le rapport obtenu, arrondi au
// centième (la table se lit au centième : 2,01, 1,99...), tombe dans un
// palier. Arnhem compare Allemands contre Alliés :
//   - 3,00 contre 1 ou plus  → victoire stratégique allemande ;
//   - de 2,01 à 2,99         → victoire tactique allemande ;
//   - exactement 2,00        → match nul ;
//   - de 1,01 à 1,99         → victoire tactique alliée ;
//   - 1,00 contre 1 ou moins → victoire stratégique alliée.
// Cas limites : un camp `to` à zéro face à des points adverses donne un
// rapport infini (premier palier) ; deux camps à zéro, aucun rapport — match
// nul (cf. `outcome`).
// C'est le résultat d'une partie menée à son DERNIER tour. Une concession
// ou une pendule Blitz à zéro reste une défaite, quel que soit ce rapport :
// la fin de partie l'affiche alors à titre indicatif (cf. HexMap.vue::
// gameEnd, GameEndModal.vue).
//
// ─── RÉCAPITULATIF PAR TOUR ──────────────────────────────────────────────────
// Chaque attribution, jouée ou rejouée, rejoint `history` (`{ turn, side,
// points }`) : c'est ce que la modale de fin de partie récapitule tour par
// tour (cf. `byTurn`, GameEndModal.vue).
//
// Paramètres reçus :
//   - `assisted` : ref/computed booléen — décide qui tient le compte.
//   - `victory` : `rules.victoryPoints` résolu, ou `null`.
//   - `terrain` : `module.terrain` — pour délimiter les zones.
//   - `hexOnMap` : `(col, row) => bool`.
import { computed, ref } from 'vue'
import { hexId, parseHexId } from './calibration.js'
import { neighborsOf } from './hex.js'

/** Une unité AÉROPORTÉE au sens des points de victoire : parachutiste,
 *  planeur ou leur artillerie. Les positions au-delà des fleuves ne sont
 *  payées qu'aux unités venues par la route — celles qui ont eu à les
 *  franchir. */
const AIRBORNE_TYPE = /airborne|glider/i

const keyOf = (col, row) => `${col},${row}`

export function useVictoryPoints({ assisted, victory = null, terrain = null, hexOnMap = () => true }) {
  /** La règle s'applique-t-elle dans ce module ? */
  const active = computed(() => !!victory)

  /** Les joueurs tiennent-ils le compte eux-mêmes ? */
  const editable = computed(() => active.value && !assisted.value)

  // Total par camp (clé de `module.sides`).
  const scores = ref(Object.fromEntries((victory?.sides ?? []).map((side) => [side, 0])))

  // Attributions de la partie, dans l'ordre : `[{ turn, side, points }]`
  // (cf. l'en-tête, « Récapitulatif par tour »).
  const history = ref([])

  // Tours dont la Fin de tour a déjà été soldée (cf. l'en-tête).
  const scoredTurns = ref(new Set())

  /** Note `points` (positifs ou négatifs) au camp `side` pour le tour `turn`. */
  function record(turn, side, points) {
    if (!points) return
    history.value = [...history.value, { turn: turn ?? 1, side, points }]
  }

  /** La Fin de tour du tour `turn` a-t-elle déjà été soldée ? */
  function isTurnScored(turn) {
    return scoredTurns.value.has(turn)
  }

  /** Marque la Fin de tour du tour `turn` comme soldée. */
  function markTurnScored(turn) {
    if (turn == null || scoredTurns.value.has(turn)) return
    scoredTurns.value = new Set(scoredTurns.value).add(turn)
  }

  /** Points marqués par camp, tour par tour : `[{ turn, points: { [camp]:
   *  n } }]`, du premier tour au dernier où quelqu'un a marqué — un tour
   *  sans aucun point y figure quand même, à zéro, pour que le tableau se
   *  lise sans trou. */
  const byTurn = computed(() => {
    const sides = victory?.sides ?? []
    const last = history.value.reduce((max, line) => Math.max(max, line.turn), 0)
    const rows = []
    for (let turn = 1; turn <= last; turn += 1) {
      rows.push({ turn, points: Object.fromEntries(sides.map((side) => [side, 0])) })
    }
    for (const line of history.value) {
      const row = rows[line.turn - 1]
      if (row && line.side in row.points) row.points[line.side] += line.points
    }
    return rows
  })

  /** Résultat de la partie d'après les totaux actuels (cf. l'en-tête,
   *  « Résultat de la partie ») : `{ of, to, ratio, winner, level }` —
   *  `ratio` arrondi au centième (`Infinity` si `to` n'a rien marqué, `null`
   *  si personne n'a rien marqué), `winner` le camp vainqueur ou `null` pour
   *  un match nul, `level` 'strategic' | 'tactical' | `null`. `null` si le
   *  module ne déclare aucun palier. */
  const outcome = computed(() => {
    const rule = victory?.outcome
    if (!active.value || !rule) return null
    const { of, to } = rule.ratio
    const pointsOf = scores.value[of] ?? 0
    const pointsTo = scores.value[to] ?? 0
    if (pointsOf === 0 && pointsTo === 0) return { of, to, ratio: null, winner: null, level: null }
    const ratio = pointsTo === 0 ? Infinity : Math.round((pointsOf / pointsTo) * 100) / 100
    const reached = rule.levels.find((level) => ratio >= level.min) ?? rule.levels[rule.levels.length - 1]
    return { of, to, ratio, winner: reached.winner, level: reached.level }
  })

  /** Fixe le total d'un camp — la seule porte d'entrée, en jeu comme au
   *  rejeu. Renvoie ce qu'il faut journaliser, ou `null` si rien ne change. */
  function set(side, value) {
    if (!active.value || !(side in scores.value)) return null
    const total = Math.max(0, Math.round(Number(value) || 0))
    if (total === scores.value[side]) return null
    const delta = total - scores.value[side]
    scores.value = { ...scores.value, [side]: total }
    return { side, delta, total }
  }

  /** Ajoute `points` au camp `side`. Renvoie `{ side, delta, total }` ou
   *  `null` (rien à ajouter, ou règle inerte). */
  function award(side, points) {
    if (!points) return null
    return set(side, (scores.value[side] ?? 0) + points)
  }

  /** Rejeu d'une entrée `victory` du journal : le total qu'elle porte fait
   *  foi — jamais un recalcul, sans quoi une partie rechargée pourrait
   *  compter deux fois. `turn` : le tour de l'attribution ; `endOfTurn` :
   *  c'était un compte de Fin de tour, qui ne doit pas être refait (cf.
   *  `scoredTurns`). */
  function applyReplay({ side, total } = {}, { turn = 1, endOfTurn = false } = {}) {
    if (side == null || total == null) return
    if (!(side in scores.value)) return
    const next = Math.max(0, Math.round(Number(total) || 0))
    record(turn, side, next - scores.value[side])
    scores.value = { ...scores.value, [side]: next }
    if (endOfTurn) markTurnScored(turn)
  }

  // --- Zones au-delà d'un fleuve (cf. l'en-tête) ------------------------------

  /** Arêtes de rivière de la carte, dans les deux sens — la frontière que le
   *  remplissage ne franchit jamais. */
  const riverEdges = computed(() => {
    const set = new Set()
    for (const layer of victory?.zoneBarriers ?? []) {
      for (const edge of terrain?.[layer] ?? []) {
        const [hexA, hexB] = String(edge).split('-')
        set.add(hexA + '-' + hexB)
        set.add(hexB + '-' + hexA)
      }
    }
    return set
  })

  /** Les hex de chaque zone, par identifiant — remplissage depuis l'hex
   *  témoin, sans jamais franchir une arête de rivière (cf. l'en-tête). */
  const zoneHexes = computed(() => {
    const zones = new Map()
    if (!active.value) return zones
    const barrier = riverEdges.value
    for (const zone of victory.zones ?? []) {
      const seed = parseHexId(zone.seed)
      if (!seed || !hexOnMap(seed.col, seed.row)) { zones.set(zone.id, new Set()); continue }
      const reached = new Set([keyOf(seed.col, seed.row)])
      let frontier = [seed]
      while (frontier.length) {
        const next = []
        for (const hex of frontier) {
          for (const neighbor of neighborsOf(hex.col, hex.row)) {
            if (!hexOnMap(neighbor.col, neighbor.row)) continue
            const edge = hexId(hex.col + 1, hex.row) + '-' + hexId(neighbor.col + 1, neighbor.row)
            if (barrier.has(edge)) continue
            const key = keyOf(neighbor.col, neighbor.row)
            if (reached.has(key)) continue
            reached.add(key)
            next.push(neighbor)
          }
        }
        frontier = next
      }
      zones.set(zone.id, reached)
    }
    return zones
  })

  /** La zone où se trouve `unit`, ou `null` — les zones étant disjointes, il
   *  n'y en a jamais plus d'une. */
  function zoneOf(unit) {
    if (!active.value || !unit) return null
    const key = keyOf(unit.col, unit.row)
    for (const zone of victory.zones ?? []) {
      if (zoneHexes.value.get(zone.id)?.has(key)) return zone
    }
    return null
  }

  /** `unit` peut-elle marquer une position ? Seules les unités venues par la
   *  route comptent (cf. `AIRBORNE_TYPE`). */
  function holdsPosition(unit) {
    return !AIRBORNE_TYPE.test(unit?.type ?? '')
  }

  /** Points que rapporte l'ÉLIMINATION de `unit` — `{ side, points }` (le
   *  camp qui marque est l'ADVERSAIRE de l'unité perdue), ou `null`. */
  function eliminationAward(side) {
    if (!active.value || !side) return null
    const winner = (victory.sides ?? []).find((other) => other !== side)
    const points = victory.elimination?.[winner] ?? 0
    return winner && points ? { side: winner, points } : null
  }

  /** Rechargement d'un journal : tout repart de zéro (cf. HexMap.vue::
   *  resetBoardForReplay), les entrées rejouées rétablissent les totaux. */
  function reset() {
    scores.value = Object.fromEntries((victory?.sides ?? []).map((side) => [side, 0]))
    history.value = []
    scoredTurns.value = new Set()
  }

  return {
    active, editable, scores, set, award, record, applyReplay, reset, zoneOf, holdsPosition, eliminationAward, zoneHexes,
    isTurnScored, markTurnScored, byTurn, outcome,
  }
}
