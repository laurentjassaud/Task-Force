import { io } from 'socket.io-client'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

let socket = null

// Une seule connexion WebSocket pour toute l'app — les vues la partagent
// plutôt que d'en ouvrir une nouvelle à chaque navigation.
export function getSocket() {
  if (!socket) socket = io(API_URL)
  return socket
}
