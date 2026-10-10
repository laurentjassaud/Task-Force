import { Router } from 'express'
import { createGame, listGames, getGame, toSummary, toPublic } from '../rooms.js'

export const gamesRouter = Router()

gamesRouter.post('/', (req, res) => {
  const { moduleId, scenarioId, variants, settings, maxPlayers, turnOrder } = req.body ?? {}

  if (typeof moduleId !== 'string' || !moduleId) {
    return res.status(400).json({ error: 'moduleId is required' })
  }
  if (typeof scenarioId !== 'string' || !scenarioId) {
    return res.status(400).json({ error: 'scenarioId is required' })
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 8) {
    return res.status(400).json({ error: 'maxPlayers must be an integer between 1 and 8' })
  }

  let game
  try {
    game = createGame({ moduleId, scenarioId, variants, settings, maxPlayers, turnOrder })
  } catch (err) {
    // Trop de parties en mémoire (cf. rooms.js::MAX_GAMES) : le serveur est
    // plein, pas la requête fautive.
    if (err.code === 'too-many-games') return res.status(503).json({ error: 'too-many-games' })
    throw err
  }

  // Passcode is only ever returned here, right after creation, so the
  // creator can share it with the other players.
  res.status(201).json({ ...toSummary(game), passcode: game.passcode })
})

gamesRouter.get('/', (req, res) => {
  res.json(listGames())
})

gamesRouter.get('/:id', (req, res) => {
  const game = getGame(req.params.id)
  if (!game) return res.status(404).json({ error: 'not-found' })
  res.json(toPublic(game))
})
