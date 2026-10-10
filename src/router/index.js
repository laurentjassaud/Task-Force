import { createRouter, createWebHistory } from 'vue-router'
import GamesList from '../views/GamesList.vue'
import CreateGame from '../views/CreateGame.vue'
import LocalGameSetup from '../views/LocalGameSetup.vue'
import DemoPlay from '../views/DemoPlay.vue'
import RoomLobby from '../views/RoomLobby.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'games-list', component: GamesList },
    { path: '/create', name: 'create-game', component: CreateGame },
    { path: '/local', name: 'local-game-setup', component: LocalGameSetup },
    { path: '/demo', name: 'demo-play', component: DemoPlay },
    { path: '/room/:id', name: 'room-lobby', component: RoomLobby, props: true },
  ],
})
