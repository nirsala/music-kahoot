import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : `http://${window.location.hostname}:4000`

const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 3000,
  timeout: 20000
})

export default socket
