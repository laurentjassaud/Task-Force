import { customAlphabet } from 'nanoid'

const gameId = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6)
const passcode = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6)
const playerId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12)

// In-memory store. One process only for now — swap for Redis if we need
// to scale across multiple server instances (see roadmap phase 0 notes).
const games = new Map()

// --- Bornes mémoire ------------------------------------------------------------
// Tout vit en mémoire et rien ne l'écrivait jamais : sans ces limites, un
// serveur qui tourne des semaines accumule les parties abandonnées, et un
// client pouvait gonfler un journal sans fin.
const MAX_GAMES = 200                          // parties simultanées (après purge)
const MAX_JOURNAL_ENTRIES = 20000              // entrées par journal partagé
const MAX_ENTRY_DATA_LENGTH = 50000            // taille (JSON) du `data` d'une entrée
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024      // taille (JSON) cumulée d'un journal
const LOBBY_TTL_MS = 6 * 60 * 60 * 1000        // room jamais lancée, sans joueur connecté
const GAME_TTL_MS = 72 * 60 * 60 * 1000        // partie lancée, tous les joueurs déconnectés
const SWEEP_INTERVAL_MS = 15 * 60 * 1000

/** Toute activité (coup, tour, journal, connexion) repousse la purge. */
function touch(game) {
  game.lastActivity = Date.now()
}

/** Purge les parties abandonnées : aucun joueur connecté ET aucune activité
 *  depuis plus de `LOBBY_TTL_MS` (room jamais lancée) ou `GAME_TTL_MS`
 *  (partie lancée). Renvoie le nombre de parties retirées. Appelée
 *  périodiquement (cf. startSweeper) et avant de refuser une création faute
 *  de place (cf. createGame). */
export function sweepGames(now = Date.now()) {
  let removed = 0
  for (const game of games.values()) {
    if ([...game.players.values()].some((player) => player.connected)) continue
    const ttl = game.status === 'started' ? GAME_TTL_MS : LOBBY_TTL_MS
    if (now - game.lastActivity > ttl) {
      games.delete(game.id)
      removed += 1
    }
  }
  return removed
}

/** Lance la purge périodique (cf. sweepGames). Le minuteur n'empêche pas le
 *  processus de se terminer (`unref`). */
export function startSweeper(intervalMs = SWEEP_INTERVAL_MS) {
  const timer = setInterval(() => sweepGames(), intervalMs)
  timer.unref?.()
  return timer
}

export class RoomError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

// Réglages de la partie (mêmes clés que la partie en local, cf.
// src/lib/gameSettings.js) : on ne garde que les clés connues, en chaînes,
// le client complétant les valeurs manquantes par les défauts.
const SETTING_KEYS = ['scenario', 'weather', 'party', 'timing', 'timingValue']

function sanitizeSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {}
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, source[key] == null ? '' : String(source[key]).slice(0, 32)])
  )
}

/** Ordre des camps reçu du client (cf. src/views/CreateGame.vue,
 *  `module.turnTrack.order`, ou la séquence dépliée pas par pas quand
 *  l'initiative change d'un tour à l'autre — src/lib/turnTrack.js::
 *  stepSequence) : des clés courtes, quelques centaines au plus. Vide si
 *  absent — le contrôle de tour (cf. `isPlayersTurn`) est alors inactif. */
function sanitizeTurnOrder(turnOrder) {
  if (!Array.isArray(turnOrder)) return []
  return turnOrder.filter((side) => typeof side === 'string' && side && side.length <= 32).slice(0, 512)
}

export function createGame({ moduleId, scenarioId, variants, settings, maxPlayers, turnOrder }) {
  if (games.size >= MAX_GAMES) sweepGames()
  if (games.size >= MAX_GAMES) throw new RoomError('too-many-games')
  const id = gameId()
  const game = {
    id,
    moduleId,
    scenarioId,
    variants: Array.isArray(variants) ? variants : [],
    settings: sanitizeSettings({ scenario: scenarioId, ...settings }),
    // Camps dans l'ordre où ils jouent chaque tour (cf. sanitizeTurnOrder) :
    // `turnOrder[turnStep % turnOrder.length]` est le camp qui a la main.
    turnOrder: sanitizeTurnOrder(turnOrder),
    maxPlayers,
    passcode: passcode(),
    status: 'lobby', // 'lobby' | 'started'
    createdAt: Date.now(),
    lastActivity: Date.now(), // cf. touch / sweepGames
    players: new Map(), // playerId -> { id, name, side, connected, socketId }
    boardState: new Map(), // counterId -> { col, row } — positions déplacées depuis le setup du module
    turnStep: 0, // index dans la séquence tours × camps du module (cf. HexMap.vue -> turnTrack)
    // Phase en cours du camp actif (mode Assisté, cf. src/lib/useAssisted.js),
    // ou `null` quand chaque client doit la recalculer lui-même (début de
    // camp/tour : Airborne ou Mouvement selon ses renforts).
    phase: null,
    // Début (horloge serveur) de la phase/du pas en cours — sert au timing
    // "Limité" pour qu'un joueur qui (re)charge la page retrouve le temps
    // restant de la phase de Mouvement, et non un compteur remis à plein.
    phaseSince: Date.now(),
    // Timing "Blitz" : temps de Mouvement consommé par camp (ms), tel que
    // transmis par le joueur actif à la fin de chacune de ses phases de
    // Mouvement — `{ [campKey]: ms }`.
    blitzUsedMs: {},
    // Timing "Blitz" : camp dont la pendule est tombée à 0 — partie
    // terminée, plus aucun coup accepté. `null` tant qu'elle continue.
    blitzLoser: null,
    // Ce qui a mis fin à la partie : 'blitz' ou 'concede' (cf. recordGameOver).
    gameOverReason: null,
    // Journal PARTAGÉ de la partie (ordre chronologique) : entrées
    // `{ uid, t, kind, text, data }` envoyées par les joueurs (cf.
    // src/components/HexMap.vue::log). Transmis en entier à chaque joueur
    // qui (re)joint la partie, pour qu'il la reconstitue.
    journal: [],
    journalBytes: 0, // taille JSON cumulée de `journal` (cf. MAX_JOURNAL_BYTES)
    // Combat soumis au défenseur pour son FPF ("final protective fire", cf.
    // `recordFpfRequest`) — `{ id, targets, attackerIds, fpfIds }`, `fpfIds`
    // à `null` tant qu'il n'a pas répondu — ou `null`. Conservé pour qu'un
    // joueur qui recharge la page retrouve la négociation en cours.
    fpfRequest: null,
    // Sort des ponts (cf. src/lib/useBridges.js) : chaque décision déjà
    // prise, DANS L'ORDRE — `[{ edge, kind, die, destroyed, unitId }]`, une
    // démolition puis, le cas échéant, la réparation qui la défait. Transmis
    // à qui (re)joint la partie pour qu'il retrouve la carte telle qu'elle
    // est ; c'est l'ordre qui la reconstitue, pas la seule dernière entrée.
    bridgeLog: [],
    // Occasion soumise au camp qui doit la trancher, quand il n'a pas la main
    // — `{ id, edge, kind, unitId }` ou `null`. Conservée pour qu'un joueur
    // qui recharge sa page retrouve la décision en attente.
    bridgeRequest: null,
  }
  games.set(id, game)
  return game
}

export function listGames() {
  return [...games.values()].map(toSummary)
}

export function getGame(id) {
  return games.get(id)
}

export function toSummary(game) {
  return {
    id: game.id,
    moduleId: game.moduleId,
    scenarioId: game.scenarioId,
    variants: game.variants,
    settings: game.settings,
    maxPlayers: game.maxPlayers,
    status: game.status,
    playerCount: game.players.size,
    createdAt: game.createdAt,
  }
}

export function toPublic(game) {
  return {
    ...toSummary(game),
    players: [...game.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      side: player.side,
      connected: player.connected,
    })),
    boardState: Object.fromEntries(game.boardState),
    turnStep: game.turnStep,
    phase: game.phase,
    phaseElapsedMs: Date.now() - game.phaseSince,
    blitzUsedMs: game.blitzUsedMs,
    blitzLoser: game.blitzLoser,
    gameOverReason: game.gameOverReason ?? null,
    fpfRequest: game.fpfRequest,
    bridgeLog: game.bridgeLog,
    bridgeRequest: game.bridgeRequest,
  }
}

export function joinGame(id, { passcode: code, playerId: existingPlayerId, name, side, socketId }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.passcode !== code) throw new RoomError('bad-passcode')

  const reconnecting = existingPlayerId && game.players.has(existingPlayerId)

  // Pseudo et camp assainis : des chaînes courtes (ils sont rediffusés à tous
  // les joueurs et affichés tels quels).
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 40) : ''
  const cleanSide = typeof side === 'string' ? side.trim().slice(0, 32) : ''

  if (!reconnecting) {
    if (game.status !== 'lobby') throw new RoomError('already-started')
    if (game.players.size >= game.maxPlayers) throw new RoomError('room-full')
    if (!cleanName) throw new RoomError('bad-name')
    if (!cleanSide) throw new RoomError('bad-side')
    const sideTaken = [...game.players.values()].some((otherPlayer) => otherPlayer.side === cleanSide)
    if (sideTaken) throw new RoomError('side-taken')
  }

  const id_ = reconnecting ? existingPlayerId : playerId()
  const player = reconnecting
    ? game.players.get(id_)
    : { id: id_, name: cleanName, side: cleanSide, connected: false, socketId: null }

  // Reconnexion : le siège est repris TEL QUEL — ni le pseudo ni surtout le
  // camp ne changent. Sinon un client pourrait se reconnecter sur le camp
  // adverse (même déjà pris) et contourner le contrôle de tour ci-dessous.
  player.connected = true
  player.socketId = socketId
  game.players.set(id_, player)
  touch(game)

  if (!reconnecting && game.players.size === game.maxPlayers) {
    game.status = 'started'
  }

  return { game, playerId: id_ }
}

// --- Contrôle de tour ---------------------------------------------------------
// Le serveur ne connaît ni les règles ni les pions : il sait seulement, grâce
// à `turnOrder` (cf. createGame) et au pas courant, QUEL CAMP a la main. Tout
// ce qui fait avancer ou modifie la partie (coup, tour, phase, journal) n'est
// accepté que du joueur de ce camp — le même verrou que l'interface (cf.
// src/components/HexMap.vue::inputLocked), mais qu'un client modifié ne peut
// pas contourner. Sans `turnOrder` (ancien client, module sans piste de
// tour), aucune restriction : comportement d'avant.

/** Camp qui a la main, ou `null` si l'ordre des camps est inconnu. */
export function activeSide(game) {
  const count = game.turnOrder.length
  return count ? game.turnOrder[game.turnStep % count] : null
}

/** Camp qui vient de rendre la main (celui du pas précédent), ou `null`. */
function previousSide(game) {
  const count = game.turnOrder.length
  if (!count || game.turnStep === 0) return null
  return game.turnOrder[(game.turnStep - 1) % count]
}

/** Le joueur `playerId` a-t-il la main ? Toujours vrai sans `turnOrder`, ni
 *  sur un pas joker ('*') : camp tiré au dé en cours de partie, que seul le
 *  client connaît (cf. src/lib/turnTrack.js::ANY_SIDE). */
export function isPlayersTurn(game, playerId) {
  const side = activeSide(game)
  if (side == null || side === '*') return true
  return game.players.get(playerId)?.side === side
}

/** Le joueur `playerId` peut-il inscrire `entry` au journal partagé ? Oui
 *  s'il a la main. Une exception : l'entrée `turn` du joueur qui VIENT de
 *  rendre la main — elle est écrite après coup (cf. HexMap.vue::onTurnChange,
 *  différé), donc arrive quand le camp actif est déjà l'adversaire. */
export function mayLog(game, playerId, entry) {
  if (isPlayersTurn(game, playerId)) return true
  if (entry?.kind === 'turn' && entry.data?.step === game.turnStep) {
    const previous = previousSide(game)
    return previous === '*' || game.players.get(playerId)?.side === previous
  }
  return false
}

export function recordMove(id, { counterId, col, row }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (game.blitzLoser) throw new RoomError('game-over')
  // Un coup est rediffusé tel quel à tous les joueurs, qui l'appliquent sans
  // vérification (cf. HexMap.vue::applyRemoteMove) : on exige au moins un
  // identifiant court et des coordonnées entières plausibles.
  const validId = (typeof counterId === 'string' || typeof counterId === 'number') && String(counterId).length <= 64
  const validCell = Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < 1000 && row < 1000
  if (!validId || !validCell) throw new RoomError('bad-move')
  game.boardState.set(String(counterId), { col, row })
  touch(game)
  return game
}

export function advanceTurn(id) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (game.blitzLoser) throw new RoomError('game-over')
  // Le serveur ne connaît pas la longueur de la piste (données du module,
  // chargées seulement côté client) : il incrémente sans borne, chaque
  // client s'arrête déjà lui-même en fin de piste avant d'émettre.
  game.turnStep += 1
  game.phase = null
  game.phaseSince = Date.now()
  game.fpfRequest = null
  touch(game)
  return game
}

/** Changement de phase SANS changement de pas (Airborne -> Mouvement,
 *  Mouvement -> Combat, Combat -> Fin de tour). Refusé s'il concerne un pas
 *  déjà dépassé (message en retard sur un `game:turn`). */
export function recordPhase(id, { phase, step, blitzUsed }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (game.blitzLoser) throw new RoomError('game-over')
  // -2 (mise en place), -1..2 : phases standard ; au-delà, phases propres au
  // module (cf. src/lib/rules.js::CUSTOM_PHASE_BASE).
  if (!Number.isInteger(phase) || phase < -2 || phase > 31) throw new RoomError('bad-phase')
  if (step !== game.turnStep) throw new RoomError('stale-step')
  game.phase = phase
  game.phaseSince = Date.now()
  game.fpfRequest = null
  const cleanBlitz = sanitizeBlitz(blitzUsed)
  if (cleanBlitz) game.blitzUsedMs = cleanBlitz
  touch(game)
  return { game, blitzUsed: cleanBlitz }
}

/** Entrée de journal reçue d'un client, assainie — `null` si invalide. */
function sanitizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const { uid, t, kind, text, data } = entry
  if (typeof uid !== 'string' || !uid || uid.length > 64) return null
  if (typeof kind !== 'string' || !kind || kind.length > 32) return null
  const clean = { uid, t: String(t ?? '').slice(0, 32), kind, text: String(text ?? '').slice(0, 500), data: data ?? null }
  if (JSON.stringify(clean.data).length > MAX_ENTRY_DATA_LENGTH) return null
  return clean
}

function startedGame(id) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  return game
}

/** Ajoute `entries` (déjà assainies) au journal de `game`, dans les limites
 *  de taille (cf. MAX_JOURNAL_ENTRIES / MAX_JOURNAL_BYTES). */
function pushJournal(game, entries) {
  const bytes = entries.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0)
  if (game.journal.length + entries.length > MAX_JOURNAL_ENTRIES || game.journalBytes + bytes > MAX_JOURNAL_BYTES) {
    throw new RoomError('journal-full')
  }
  game.journal.push(...entries)
  game.journalBytes += bytes
  touch(game)
}

/** Ajoute une entrée au journal partagé. Renvoie l'entrée assainie, ou
 *  `null` si elle y est déjà (même `uid`). */
export function appendJournal(id, entry) {
  const game = startedGame(id)
  if (game.blitzLoser) throw new RoomError('game-over')
  const clean = sanitizeEntry(entry)
  if (!clean) throw new RoomError('bad-entry')
  if (game.journal.some((existing) => existing.uid === clean.uid)) return null
  pushJournal(game, [clean])
  // Combat joué : la négociation de son FPF est close (cf. recordFpfRequest).
  if (clean.kind === 'combat') game.fpfRequest = null
  return clean
}

// --- FPF en ligne ---------------------------------------------------------------
// Le FPF ("final protective fire", cf. src/lib/useArtillery.js) est choisi
// par le DÉFENSEUR, qui n'a pas la main : le joueur actif lui SOUMET son
// combat (`recordFpfRequest`), le défenseur RÉPOND (`recordFpfReply`), puis le
// joueur actif lance le dé. Le serveur ne fait que relayer et garder la
// négociation en cours (cf. `game.fpfRequest`) — il ne connaît pas les
// règles : c'est le client de l'attaquant qui ne retient, dans la réponse,
// que les artilleries éligibles.

const MAX_FPF_IDS = 32

/** Liste d'ids de pions reçue d'un client : chaînes/nombres courts, au plus
 *  `MAX_FPF_IDS`. `null` si invalide. */
function sanitizeIds(ids) {
  if (!Array.isArray(ids) || ids.length > MAX_FPF_IDS) return null
  const ok = ids.every((id) => (typeof id === 'string' || typeof id === 'number') && String(id).length <= 64)
  return ok ? ids.map((id) => (typeof id === 'number' ? id : String(id))) : null
}

/** Le joueur actif soumet son combat au défenseur. `request` : `{ id,
 *  targets: [{ col, row }], attackerIds }`. Renvoie la demande assainie
 *  (celle qui est relayée). */
export function recordFpfRequest(id, request) {
  const game = startedGame(id)
  if (game.blitzLoser) throw new RoomError('game-over')
  const requestId = request?.id
  const targets = Array.isArray(request?.targets) ? request.targets : null
  const attackerIds = sanitizeIds(request?.attackerIds)
  const validTargets = targets && targets.length >= 1 && targets.length <= 6 && targets.every((target) =>
    Number.isInteger(target?.col) && Number.isInteger(target?.row) && target.col >= 0 && target.row >= 0 && target.col < 1000 && target.row < 1000)
  if (typeof requestId !== 'string' || !requestId || requestId.length > 64 || !validTargets || !attackerIds?.length) {
    throw new RoomError('bad-fpf')
  }
  game.fpfRequest = {
    id: requestId,
    targets: targets.map((target) => ({ col: target.col, row: target.row })),
    attackerIds,
    fpfIds: null,
    supportIds: null,
  }
  touch(game)
  return game.fpfRequest
}

/** Le défenseur répond à la demande `requestId` avec ses artilleries
 *  `fpfIds` et ses pions de soutien `supportIds` (cf. SupportTracker.vue —
 *  il ne peut pas les poser lui-même sur la carte pendant le tour adverse,
 *  c'est le client du joueur actif qui le fait en recevant cette réponse).
 *  Refusé s'il n'y a pas (ou plus) de demande en attente sous cet id.
 *  Renvoie `{ id, fpfIds, supportIds }`, relayé au joueur actif. */
export function recordFpfReply(id, { requestId, fpfIds, supportIds }) {
  const game = startedGame(id)
  const pending = game.fpfRequest
  const ids = sanitizeIds(fpfIds)
  const supports = sanitizeIds(supportIds ?? [])
  if (!pending || pending.id !== requestId || pending.fpfIds || !ids || !supports) throw new RoomError('bad-fpf')
  pending.fpfIds = ids
  pending.supportIds = supports
  touch(game)
  return { id: requestId, fpfIds: ids, supportIds: supports }
}

/** Le joueur actif renonce à la demande `requestId` (pas encore de réponse).
 *  `true` si elle a été retirée. */
export function cancelFpfRequest(id, requestId) {
  const game = startedGame(id)
  if (!game.fpfRequest || game.fpfRequest.id !== requestId || game.fpfRequest.fpfIds) return false
  game.fpfRequest = null
  touch(game)
  return true
}

// --- Sort des ponts en ligne ----------------------------------------------------
// Démolir un pont et le relever sont tranchés par des camps OPPOSÉS (cf.
// src/lib/useBridges.js — l'allemand fait sauter, le génie allié répare), et
// aucun des deux n'a systématiquement la main. Quand celui qui décide ne l'a
// pas, le joueur actif lui SOUMET l'occasion (`recordBridgeRequest`) et
// attend ; le camp décideur publie sa décision (`recordBridgeResult`), que
// tous appliquent. Quand il a la main, il décide sans demande préalable.
// Comme pour le FPF, le serveur ne connaît pas les règles : il relaie, garde
// l'occasion en attente pour une page rechargée, et tient l'historique des
// ponts pour un joueur qui rejoint en cours de partie.

/** Clé d'arête reçue d'un client ("CCRR-CCRR"), ou `null` si invalide. */
function sanitizeEdge(edge) {
  return typeof edge === 'string' && /^\d{4}-\d{4}$/.test(edge) ? edge : null
}

/** Sorte de décision reçue d'un client, ou `null`. */
function sanitizeKind(kind) {
  return kind === 'repair' || kind === 'demolition' ? kind : null
}

/** Id de pion reçu d'un client (le génie qui répare), ou `null`. */
function sanitizeUnitId(unitId) {
  if (unitId == null) return null
  const ok = (typeof unitId === 'string' || typeof unitId === 'number') && String(unitId).length <= 64
  return ok ? String(unitId) : null
}

/** Le joueur actif soumet l'occasion au camp décideur. `request` :
 *  `{ id, edge, kind, unitId }`. Renvoie la demande assainie (relayée). */
export function recordBridgeRequest(id, request) {
  const game = startedGame(id)
  if (game.blitzLoser) throw new RoomError('game-over')
  const requestId = request?.id
  const edge = sanitizeEdge(request?.edge)
  const kind = sanitizeKind(request?.kind) ?? 'demolition'
  if (typeof requestId !== 'string' || !requestId || requestId.length > 64 || !edge) throw new RoomError('bad-bridge')
  game.bridgeRequest = { id: requestId, edge, kind, unitId: sanitizeUnitId(request?.unitId) }
  touch(game)
  return game.bridgeRequest
}

/** Le camp décideur publie sa décision : `{ edge, kind, die, destroyed,
 *  unitId, declined }` — `die` à `null` s'il a renoncé sans lancer,
 *  `declined` pour une réparation refusée (qui ne change rien à la carte mais
 *  clôt l'occasion). Retenue DANS L'ORDRE pour les joueurs qui rejoindront
 *  ensuite, et clôt l'occasion en attente si c'est bien de ce pont qu'elle
 *  parlait. Renvoie le résultat relayé. */
export function recordBridgeResult(id, { edge, kind, die = null, destroyed, unitId, declined } = {}) {
  const game = startedGame(id)
  const clean = sanitizeEdge(edge)
  if (!clean) throw new RoomError('bad-bridge')
  const result = {
    edge: clean,
    kind: sanitizeKind(kind) ?? 'demolition',
    die: Number.isInteger(die) ? die : null,
    destroyed: !!destroyed,
    unitId: sanitizeUnitId(unitId),
    declined: !!declined,
  }
  // Une réparation refusée ne laisse aucune trace sur la carte : inutile de
  // la rejouer à qui rejoint la partie.
  if (!result.declined && !isRepeat(game.bridgeLog, result)) game.bridgeLog.push(result)
  if (game.bridgeRequest && sameEdge(game.bridgeRequest.edge, clean)) game.bridgeRequest = null
  touch(game)
  return result
}

/** Cette décision est-elle celle que l'historique porte DÉJÀ en dernier pour
 *  ce pont (deux clients qui se croisent) ? Un même pont peut y figurer
 *  plusieurs fois — démoli, puis relevé —, mais jamais deux fois de suite
 *  pour la même chose. */
function isRepeat(log, result) {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    if (sameEdge(log[index].edge, result.edge)) return log[index].kind === result.kind
  }
  return false
}

/** Deux clés d'arête désignent-elles le même hexside ? Le client peut nommer
 *  l'arête dans l'un ou l'autre sens (cf. src/lib/useBridges.js). */
function sameEdge(edgeA, edgeB) {
  if (edgeA === edgeB) return true
  const [hexA, hexB] = String(edgeA).split('-')
  return hexB + '-' + hexA === edgeB
}

/** Retire une entrée du journal partagé (retour arrière). `true` si retirée. */
export function removeJournal(id, uid) {
  const game = startedGame(id)
  const index = game.journal.findIndex((entry) => entry.uid === uid)
  if (index === -1) return false
  const [removed] = game.journal.splice(index, 1)
  game.journalBytes -= JSON.stringify(removed).length
  touch(game)
  return true
}

/** Déploiement initial (et, optionnellement, entrée `turn` du tour de
 *  départ) proposés par un joueur au lancement : retenus seulement si le
 *  journal est encore vide (le premier arrivé fait foi). Renvoie
 *  `{ entries, created }` — `entries` : ce qui fait foi (vide si le journal
 *  a déjà commencé sans déploiement). */
export function recordDeployment(id, entry, turnEntry) {
  const game = startedGame(id)
  const index = game.journal.findIndex((journalEntry) => journalEntry.kind === 'setup')
  if (index !== -1) {
    const follow = game.journal[index + 1]
    return { entries: [game.journal[index], ...(follow?.kind === 'turn' ? [follow] : [])], created: false }
  }
  if (game.journal.length) return { entries: [], created: false }
  const clean = sanitizeEntry(entry)
  if (!clean || clean.kind !== 'setup') throw new RoomError('bad-entry')
  const cleanTurn = turnEntry ? sanitizeEntry(turnEntry) : null
  const entries = cleanTurn?.kind === 'turn' ? [clean, cleanTurn] : [clean]
  pushJournal(game, entries)
  return { entries, created: true }
}

/** Fin de partie : `loser` perd — au temps (Blitz : sa pendule est tombée
 *  à 0) ou parce qu'il CONCÈDE (`reason` 'concede', quel que soit le
 *  timing, et seulement pour le camp du joueur `playerId` lui-même). Seule
 *  la PREMIÈRE annonce compte (chaque client détecte la pendule de son
 *  côté) : le serveur l'inscrit alors lui-même au journal partagé et
 *  renvoie `{ game, entry }` ; `null` si la partie était déjà terminée. */
export function recordGameOver(id, { loser, text, t, reason, playerId: announcer }) {
  const game = games.get(id)
  if (!game) throw new RoomError('not-found')
  if (game.status !== 'started') throw new RoomError('not-started')
  if (typeof loser !== 'string' || !loser || loser.length > 32) throw new RoomError('bad-loser')
  const conceded = reason === 'concede'
  if (conceded) {
    if (game.players.get(announcer)?.side !== loser) throw new RoomError('not-your-side')
  } else if (game.settings.timing !== 'blitz') {
    throw new RoomError('not-blitz')
  }
  if (game.blitzLoser) return null
  game.blitzLoser = loser
  game.gameOverReason = conceded ? 'concede' : 'blitz'
  const entry = sanitizeEntry({ uid: `srv-${playerId()}`, t, kind: 'gameover', text: text || `Temps écoulé — ${loser}`, data: { loser, reason: game.gameOverReason } })
  pushJournal(game, [entry])
  return { game, entry }
}

/** Pendules "Blitz" reçues d'un client : quelques camps au plus, temps en
 *  ms positifs. `null` si absentes ou invalides. */
function sanitizeBlitz(blitzUsed) {
  if (!blitzUsed || typeof blitzUsed !== 'object') return null
  const entries = Object.entries(blitzUsed)
    .filter(([key, ms]) => key.length <= 32 && Number.isFinite(ms) && ms >= 0)
    .slice(0, 16)
  return entries.length ? Object.fromEntries(entries) : null
}

export function setPlayerConnectionBySocket(socketId, connected) {
  for (const game of games.values()) {
    for (const player of game.players.values()) {
      if (player.socketId === socketId) {
        player.connected = connected
        touch(game)
        return game
      }
    }
  }
  return null
}
