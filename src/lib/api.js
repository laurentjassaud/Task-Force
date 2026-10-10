const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

async function request(path, options) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export function createGame({ moduleId, scenarioId, variants, settings, maxPlayers, turnOrder }) {
  return request('/api/games', {
    method: 'POST',
    body: JSON.stringify({ moduleId, scenarioId, variants, settings, maxPlayers, turnOrder }),
  })
}

export function listGames() {
  return request('/api/games')
}

export function getGame(id) {
  return request(`/api/games/${id}`)
}
