import { RoomError, getGame, joinGame, recordMove, advanceTurn, recordPhase, recordGameOver, appendJournal, removeJournal, recordDeployment, isPlayersTurn, mayLog, setPlayerConnectionBySocket, toPublic, recordFpfRequest, recordFpfReply, cancelFpfRequest, recordBridgeRequest, recordBridgeResult } from './rooms.js'

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('game:join', ({ gameId, passcode, playerId, name, side } = {}, ack) => {
      try {
        const { game, playerId: resolvedPlayerId } = joinGame(gameId, {
          passcode,
          playerId,
          name,
          side,
          socketId: socket.id,
        })

        socket.join(`game:${gameId}`)
        socket.data.gameId = gameId
        socket.data.playerId = resolvedPlayerId

        const publicRoom = toPublic(game)
        // Journal partagé complet : seulement pour le joueur qui (re)joint
        // (trop volumineux pour les `room:update` diffusés à tous).
        ack?.({ ok: true, playerId: resolvedPlayerId, room: publicRoom, journal: game.journal })
        io.to(`game:${gameId}`).emit('room:update', publicRoom)
        if (game.status === 'started') {
          io.to(`game:${gameId}`).emit('room:started', publicRoom)
        }
      } catch (err) {
        const code = err instanceof RoomError ? err.code : 'unknown-error'
        ack?.({ ok: false, error: code })
      }
    })

    /** Le joueur de ce socket a-t-il rejoint `gameId` ET la main dans
     *  cette partie (cf. rooms.js::isPlayersTurn) ? Garde commune à tout ce
     *  qui modifie la partie — évite aussi qu'un client injecte des coups
     *  dans une room qu'il n'a jamais rejointe. */
    function hasTurn(gameId) {
      if (socket.data.gameId !== gameId) return false
      const game = getGame(gameId)
      return !!game && isPlayersTurn(game, socket.data.playerId)
    }

    socket.on('game:move', ({ gameId, counterId, col, row } = {}) => {
      if (!hasTurn(gameId)) return
      try {
        recordMove(gameId, { counterId, col, row })
        io.to(`game:${gameId}`).emit('game:move', { counterId, col, row })
      } catch {
        // Partie pas encore lancée ou déjà supprimée : on ignore silencieusement.
      }
    })

    socket.on('game:turn', ({ gameId } = {}) => {
      if (!hasTurn(gameId)) return
      try {
        const game = advanceTurn(gameId)
        io.to(`game:${gameId}`).emit('game:turn', { turnStep: game.turnStep })
      } catch {
        // Partie pas encore lancée ou déjà supprimée : on ignore silencieusement.
      }
    })

    socket.on('game:phase', ({ gameId, phase, step, blitzUsed } = {}) => {
      // Rediffusé aux AUTRES joueurs seulement : l'émetteur a déjà changé de
      // phase localement.
      if (!hasTurn(gameId)) return
      try {
        const recorded = recordPhase(gameId, { phase, step, blitzUsed })
        socket.to(`game:${gameId}`).emit('game:phase', { phase, step, blitzUsed: recorded.blitzUsed })
      } catch {
        // Partie pas lancée, phase invalide ou pas déjà dépassé : on ignore.
      }
    })

    socket.on('game:over', ({ gameId, loser, text, t, reason } = {}) => {
      // Blitz : une pendule est tombée à 0. Diffusé à TOUS (émetteur
      // compris) une seule fois, à la première annonce — avec l'entrée de
      // journal correspondante, inscrite par le serveur.
      if (socket.data.gameId !== gameId) return
      try {
        const recorded = recordGameOver(gameId, { loser, text, t, reason, playerId: socket.data.playerId })
        if (recorded) {
          io.to(`game:${gameId}`).emit('game:over', { loser, reason: recorded.game.gameOverReason })
          io.to(`game:${gameId}`).emit('game:log', { entry: recorded.entry })
        }
      } catch {
        // Partie pas lancée, pas en Blitz (hors concession), concession
        // d'un autre camp que le sien, ou annonce invalide : on ignore.
      }
    })

    socket.on('game:log', ({ gameId, entry } = {}) => {
      // Journal partagé : conservé puis transmis aux AUTRES joueurs
      // (l'émetteur l'a déjà dans son journal). Réservé au joueur qui a la
      // main — à une exception près, cf. rooms.js::mayLog.
      if (socket.data.gameId !== gameId) return
      const game = getGame(gameId)
      if (!game || !mayLog(game, socket.data.playerId, entry)) return
      try {
        const clean = appendJournal(gameId, entry)
        if (clean) socket.to(`game:${gameId}`).emit('game:log', { entry: clean })
      } catch {
        // Partie pas lancée ou terminée, entrée invalide : on ignore.
      }
    })

    socket.on('game:unlog', ({ gameId, uid } = {}) => {
      if (!hasTurn(gameId)) return
      try {
        if (removeJournal(gameId, uid)) socket.to(`game:${gameId}`).emit('game:unlog', { uid })
      } catch {
        // Partie pas lancée : on ignore.
      }
    })

    socket.on('game:deploy', ({ gameId, entry, turnEntry } = {}, ack) => {
      // Déploiement initial (+ tour de départ) : le premier proposé fait foi,
      // renvoyé à l'émetteur (ack) et transmis aux autres joueurs s'il est
      // nouveau.
      if (socket.data.gameId !== gameId) return ack?.({ ok: false })
      try {
        const recorded = recordDeployment(gameId, entry, turnEntry)
        if (recorded.created) {
          for (const logged of recorded.entries) socket.to(`game:${gameId}`).emit('game:log', { entry: logged })
        }
        ack?.({ ok: true, entries: recorded.entries })
      } catch {
        ack?.({ ok: false })
      }
    })

    // --- FPF en ligne (cf. rooms.js, section FPF) : le joueur actif soumet
    // son combat, le DÉFENSEUR (qui n'a pas la main) répond, chacun relayé
    // aux autres joueurs.
    socket.on('game:fpf-request', ({ gameId, request } = {}) => {
      if (!hasTurn(gameId)) return
      try {
        const recorded = recordFpfRequest(gameId, request)
        socket.to(`game:${gameId}`).emit('game:fpf-request', { request: recorded })
      } catch {
        // Partie pas lancée ou demande invalide : on ignore.
      }
    })

    socket.on('game:fpf-reply', ({ gameId, requestId, fpfIds, supportIds } = {}) => {
      // Réservé à un joueur de la partie qui n'a PAS la main : le défenseur.
      if (socket.data.gameId !== gameId) return
      const game = getGame(gameId)
      if (!game || isPlayersTurn(game, socket.data.playerId)) return
      try {
        const reply = recordFpfReply(gameId, { requestId, fpfIds, supportIds })
        socket.to(`game:${gameId}`).emit('game:fpf-reply', reply)
      } catch {
        // Plus de demande en attente (annulée, déjà répondue) : on ignore.
      }
    })

    socket.on('game:fpf-cancel', ({ gameId, requestId } = {}) => {
      if (!hasTurn(gameId)) return
      try {
        if (cancelFpfRequest(gameId, requestId)) socket.to(`game:${gameId}`).emit('game:fpf-cancel', { id: requestId })
      } catch {
        // Partie pas lancée : on ignore.
      }
    })

    // --- Sort des ponts en ligne (cf. rooms.js, section du même nom) : le
    // joueur actif soumet l'occasion au camp qui doit la trancher — démolir
    // ou réparer —, et ce camp publie sa décision, que tous appliquent.
    socket.on('game:bridge-request', ({ gameId, request } = {}) => {
      if (!hasTurn(gameId)) return
      try {
        const recorded = recordBridgeRequest(gameId, request)
        socket.to(`game:${gameId}`).emit('game:bridge-request', { request: recorded })
      } catch {
        // Partie pas lancée ou demande invalide : on ignore.
      }
    })

    socket.on('game:bridge', ({ gameId, edge, kind, die, destroyed, unitId, declined } = {}) => {
      // Ouvert à tout joueur de la partie : le camp qui tranche n'a pas
      // toujours la main (c'est même le cas courant, et les deux décisions
      // reviennent à des camps opposés), et le serveur ne connaît pas les
      // camps que la règle du module désigne.
      if (socket.data.gameId !== gameId) return
      try {
        const result = recordBridgeResult(gameId, { edge, kind, die, destroyed, unitId, declined })
        socket.to(`game:${gameId}`).emit('game:bridge', result)
      } catch {
        // Partie pas lancée ou arête invalide : on ignore.
      }
    })

    socket.on('disconnect', () => {
      const game = setPlayerConnectionBySocket(socket.id, false)
      if (game) {
        io.to(`game:${game.id}`).emit('room:update', toPublic(game))
      }
    })
  })
}
