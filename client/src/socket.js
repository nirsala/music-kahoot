import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : `http://${window.location.hostname}:4000`

const socket = io(SOCKET_URL, { autoConnect: true })

export default socket
