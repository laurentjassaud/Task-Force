import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { gamesRouter } from './routes/games.js'
import { registerSocketHandlers } from './socket.js'
import { startSweeper } from './rooms.js'

const PORT = process.env.PORT ?? 3001
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

const app = express()
app.use(cors({ origin: CLIENT_ORIGIN }))
app.use(express.json())

app.get('/', (req, res) => res.json({ name: 'generic-wargame-server', api: '/api/games' }))
app.get('/api/health', (req, res) => res.json({ ok: true }))
app.use('/api/games', gamesRouter)

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN } })
registerSocketHandlers(io)
// Purge périodique des parties abandonnées (cf. rooms.js::sweepGames).
startSweeper()

httpServer.listen(PORT, () => {
  console.log(`generic-wargame server listening on http://localhost:${PORT}`)
})
