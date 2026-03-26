const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const QRCode = require('qrcode')
const path = require('path')
const cors = require('cors')
const os = require('os')
let SONGS = require('./songs') // fallback, overwritten by Deezer chart on startup

async function loadChartSongs() {
  try {
    const r = await fetch('https://api.deezer.com/chart/0/tracks?limit=50')
    const data = await r.json()
    const tracks = (data.data || []).filter(t => t.preview).slice(0, 30)
    if (tracks.length < 4) return
    const labels = tracks.map(t => `${t.artist.name} - ${t.title}`)
    SONGS = tracks.map((t, i) => {
      const correct = labels[i]
      const others = labels.filter((_, j) => j !== i)
      const shuffled = others.sort(() => Math.random() - 0.5)
      const options = [correct, ...shuffled.slice(0, 3)].sort(() => Math.random() - 0.5)
      return { audioUrl: t.preview, correctAnswer: correct, options }
    })
    console.log(`🎵 Loaded ${SONGS.length} chart songs from Deezer`)
  } catch (e) {
    console.log('⚠️ Could not load Deezer chart, using fallback songs')
  }
}
loadChartSongs()

function getLocalIP() {
  const ifaces = os.networkInterfaces()
  const candidates = []
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push(iface.address)
      }
    }
  }
  // Prefer 192.168.x.x (WiFi) over 10.x.x.x (VPN/corporate)
  const wifi = candidates.find(ip => ip.startsWith('192.168.'))
  const local172 = candidates.find(ip => ip.startsWith('172.'))
  return wifi || local172 || candidates[0] || 'localhost'
}

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: '*' }
})

app.use(cors())
app.use(express.json())

// ---- DEEZER (no API key needed) ----
async function deezerSearch(q, limit = 50) {
  const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`)
  const data = await r.json()
  return (data.data || []).filter(t => t.preview).map(t => ({
    id: String(t.id),
    name: t.title,
    artists: t.artist.name,
    albumArt: t.album.cover_medium || t.album.cover,
    previewUrl: t.preview
  }))
}

app.get('/api/spotify/status', (req, res) => {
  res.json({ available: true })
})

app.get('/api/spotify/search', async (req, res) => {
  const { q } = req.query
  if (!q?.trim()) return res.status(400).json({ error: 'Missing query' })
  const isHebrew = /[\u0590-\u05FF]/.test(q)
  try {
    // First attempt: plain search with high limit
    let tracks = await deezerSearch(q, 100)
    // If Hebrew and few results, also try artist: prefix
    if (isHebrew && tracks.length < 3) {
      const extra = await deezerSearch(`artist:"${q}"`, 50)
      tracks = [...tracks, ...extra.filter(t => !tracks.find(x => x.id === t.id))]
    }
    res.json({ tracks: tracks.slice(0, 10) })
  } catch (err) {
    res.status(500).json({ error: 'Search failed' })
  }
})
// ------------------------------------

// ---- AUTO-SELECT ----
function formatTracks(tracks) {
  return tracks.map((t, i) => ({
    id: String(t.id),
    name: t.title,
    artists: t.artist.name,
    albumArt: t.album.cover_medium,
    previewUrl: t.preview,
    rank: t.rank || 0,
    position: t.position || (i + 1)
  }))
}

// Deezer chart IDs by genre
const GENRE_CHART = {
  pop: 132, rock: 152, 'hip hop': 116, rnb: 165, electronic: 113, jazz: 129, classical: 98
}

app.get('/api/auto-select', async (req, res) => {
  const { genre, language, decade, count = 10 } = req.query
  const n = parseInt(count)

  try {
    let tracks = []

    // Language / decade → use Deezer playlist search (preserves era authenticity)
    if ((language && language !== 'any') || decade) {
      const decadeQueries = {
        '80s': 'greatest hits 80s', '90s': 'greatest hits 90s',
        '00s': 'best of 2000s', '10s': 'best of 2010s', '20s': 'top hits 2020s'
      }
      const langQueries = {
        hebrew: 'להיטים ישראלים', arabic: 'اغاني عربية', spanish: 'latin hits',
        french: 'hits français', english: 'top hits english'
      }
      const q = [
        decade ? decadeQueries[decade] : '',
        (language && language !== 'any') ? langQueries[language] : ''
      ].filter(Boolean).join(' ')

      // Search for a playlist matching the query, then get its tracks
      const plRes = await fetch(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(q)}&limit=5`)
      const plData = await plRes.json()
      const playlist = plData.data?.[0]

      if (playlist) {
        const trRes = await fetch(`https://api.deezer.com/playlist/${playlist.id}/tracks?limit=100`)
        const trData = await trRes.json()
        tracks = (trData.data || []).filter(t => t.preview)
        // For decades, keep playlist order (curated) — don't sort by current rank
      }

      // Fallback to search if no playlist found
      if (tracks.length === 0) {
        const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=100`)
        const data = await r.json()
        tracks = (data.data || []).filter(t => t.preview)
      }
    } else {
      // Use Deezer chart — genre-specific if selected, global otherwise
      const chartId = (genre && genre !== 'any') ? (GENRE_CHART[genre] || 0) : 0
      const r = await fetch(`https://api.deezer.com/chart/${chartId}/tracks?limit=100`)
      const data = await r.json()
      tracks = (data.data || []).filter(t => t.preview)
    }

    if (tracks.length === 0) return res.status(404).json({ error: 'לא נמצאו שירים.' })
    // Filter out cover/tribute/compilation artists
    const coverKeywords = /greatest hits|top 40|karaoke|tribute|cover|station|variété|super hits|80s hits guys|90s hits|hits station/i
    const realTracks = tracks.filter(t => !coverKeywords.test(t.artist?.name || t.artists || ''))
    const finalTracks = realTracks.length >= n ? realTracks : tracks // fallback if too many filtered
    // Keep natural order (chart is already sorted by popularity, playlists are curated)
    res.json({ tracks: formatTracks(finalTracks.slice(0, n)) })
  } catch {
    res.status(500).json({ error: 'שגיאת חיפוש' })
  }
})
// ---------------------

const games = {}

function generateGameCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase()
}

app.get('/api/qr/:gameCode', async (req, res) => {
  const { gameCode } = req.params
  const clientPort = process.env.CLIENT_PORT || 5176
  const localIP = getLocalIP()
  const joinUrl = `http://${localIP}:${clientPort}/play/${gameCode}`
  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' }
    })
    res.json({ qrDataUrl, joinUrl })
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' })
  }
})

io.on('connection', (socket) => {
  // --- HOST: create game ---
  socket.on('createGame', ({ songs } = {}) => {
    const gameCode = generateGameCode()
    games[gameCode] = {
      code: gameCode,
      hostId: socket.id,
      players: {},
      status: 'waiting',
      currentSongIndex: -1,
      songs: songs?.length > 0 ? songs : [...SONGS],
      roundStartTime: null,
      roundTimer: null
    }
    socket.join(gameCode)
    socket.emit('gameCreated', { gameCode })
  })

  // --- PLAYER: join game ---
  socket.on('joinGame', ({ gameCode, nickname }) => {
    const game = games[gameCode]
    if (!game) return socket.emit('joinError', { message: 'קוד משחק לא נמצא' })
    if (game.status !== 'waiting') return socket.emit('joinError', { message: 'המשחק כבר התחיל' })
    if (Object.values(game.players).some(p => p.nickname === nickname.trim()))
      return socket.emit('joinError', { message: 'הכינוי כבר תפוס' })

    game.players[socket.id] = {
      id: socket.id,
      nickname: nickname.trim(),
      score: 0,
      answered: false
    }
    socket.join(gameCode)
    socket.emit('joinSuccess', { nickname: nickname.trim(), gameCode })
    broadcastPlayerList(gameCode)
  })

  // --- HOST: start game ---
  socket.on('startGame', ({ gameCode }) => {
    const game = games[gameCode]
    if (!game || game.hostId !== socket.id) return
    if (Object.keys(game.players).length === 0) return
    game.status = 'playing'
    game.currentSongIndex = 0
    io.to(gameCode).emit('gameStarted')
    startRound(gameCode)
  })

  // --- PLAYER: submit answer ---
  socket.on('submitAnswer', ({ gameCode, answer }) => {
    const game = games[gameCode]
    if (!game) { console.log('❌ submitAnswer: game not found:', gameCode); return }
    if (game.status !== 'playing') { console.log('❌ submitAnswer: game status:', game.status); return }
    const player = game.players[socket.id]
    if (!player) { console.log('❌ submitAnswer: player not found, socketId:', socket.id, 'players:', Object.keys(game.players)); return }
    if (player.answered) { console.log('❌ submitAnswer: already answered'); return }

    const song = game.songs[game.currentSongIndex]
    const timeElapsed = Date.now() - game.roundStartTime
    const TIME_LIMIT = 30000
    const isCorrect = answer === song.correctAnswer
    console.log(`📝 ${player.nickname}: answer="${answer}" correct="${song.correctAnswer}" match=${isCorrect}`)

    player.answered = true

    let points = 0
    if (isCorrect) {
      const ratio = Math.max(0, (TIME_LIMIT - timeElapsed) / TIME_LIMIT)
      points = Math.round(500 + ratio * 500)
      player.score += points
    }

    socket.emit('answerResult', { isCorrect, points, correctAnswer: song.correctAnswer })

    const answeredCount = Object.values(game.players).filter(p => p.answered).length
    const totalPlayers = Object.values(game.players).length
    io.to(game.hostId).emit('answerProgress', { answeredCount, totalPlayers })

    if (answeredCount === totalPlayers) endRound(gameCode)
  })

  // --- HOST: end round manually ---
  socket.on('endRound', ({ gameCode }) => {
    const game = games[gameCode]
    if (!game || game.hostId !== socket.id) return
    endRound(gameCode)
  })

  // --- HOST: next round ---
  socket.on('nextRound', ({ gameCode }) => {
    const game = games[gameCode]
    if (!game || game.hostId !== socket.id) return
    game.currentSongIndex++

    if (game.currentSongIndex >= game.songs.length) {
      game.status = 'finished'
      io.to(gameCode).emit('gameOver', {
        finalScores: getSortedPlayers(game)
      })
    } else {
      startRound(gameCode)
    }
  })

  // --- DISCONNECT ---
  socket.on('disconnect', () => {
    for (const gameCode in games) {
      const game = games[gameCode]
      if (game.hostId === socket.id) {
        io.to(gameCode).emit('hostDisconnected')
        if (game.roundTimer) clearTimeout(game.roundTimer)
        delete games[gameCode]
      } else if (game.players[socket.id]) {
        delete game.players[socket.id]
        broadcastPlayerList(gameCode)
      }
    }
  })
})

function startRound(gameCode) {
  const game = games[gameCode]
  if (!game) return

  Object.values(game.players).forEach(p => { p.answered = false })
  game.roundStartTime = Date.now()

  const song = game.songs[game.currentSongIndex]
  io.to(gameCode).emit('roundStarted', {
    songIndex: game.currentSongIndex,
    totalSongs: game.songs.length,
    options: song.options,
    audioUrl: song.audioUrl,
    timeLimit: 30
  })

  game.roundTimer = setTimeout(() => endRound(gameCode), 31000)
}

function endRound(gameCode) {
  const game = games[gameCode]
  if (!game || game.status !== 'playing') return

  if (game.roundTimer) {
    clearTimeout(game.roundTimer)
    game.roundTimer = null
  }

  const song = game.songs[game.currentSongIndex]
  io.to(gameCode).emit('roundEnded', {
    correctAnswer: song.correctAnswer,
    leaderboard: getSortedPlayers(game)
  })
}

function getSortedPlayers(game) {
  return Object.values(game.players)
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, nickname: p.nickname, score: p.score }))
}

function broadcastPlayerList(gameCode) {
  const game = games[gameCode]
  if (!game) return
  io.to(gameCode).emit('playerList', {
    players: Object.values(game.players).map(p => ({ nickname: p.nickname, score: p.score }))
  })
}

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')))
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'))
  })
}

const PORT = process.env.PORT || 4000
server.listen(PORT, () => {
  console.log(`🎵 Music Kahoot server running on http://localhost:${PORT}`)
})
