import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import socket from '../socket'

const ICONS = ['▲', '◆', '●', '■']
const GENRES = [
  { value: 'any', label: '🎵 הכל' },
  { value: 'pop', label: '🎤 Pop' },
  { value: 'rock', label: '🎸 Rock' },
  { value: 'hip hop', label: '🎧 Hip-Hop' },
  { value: 'rnb', label: '💜 R&B' },
  { value: 'electronic', label: '🎛 Electronic' },
  { value: 'jazz', label: '🎷 Jazz' },
  { value: 'classical', label: '🎻 Classical' },
  { value: 'מזרחי', label: '🎺 מזרחי' },
  { value: 'ישראלי', label: '🇮🇱 ישראלי' },
]
const LANGUAGES = [
  { value: 'any', label: '🌍 כולן' },
  { value: 'english', label: '🇺🇸 English' },
  { value: 'hebrew', label: '🇮🇱 עברית' },
  { value: 'arabic', label: '🌙 ערבית' },
  { value: 'spanish', label: '💃 ספרדית' },
  { value: 'french', label: '🇫🇷 צרפתית' },
]
const DECADES = ['80s', '90s', '00s', '10s', '20s']
const COUNTS = [5, 10, 20, 30]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildGameSongs(playlist, searchPool = []) {
  const playlistLabels = playlist.map(t => `${t.artists} - ${t.name}`)
  const poolLabels = searchPool
    .filter(t => !playlist.find(p => p.id === t.id))
    .map(t => `${t.artists} - ${t.name}`)

  return playlist.map((track, i) => {
    const correct = playlistLabels[i]
    const distractors = shuffle([
      ...playlistLabels.filter((_, j) => j !== i),
      ...poolLabels
    ].filter(l => l !== correct))
    return { audioUrl: track.previewUrl, correctAnswer: correct, options: shuffle([correct, ...distractors.slice(0, 3)]) }
  })
}

export default function Host() {
  const navigate = useNavigate()

  // Setup state
  const [setupTab, setSetupTab] = useState('auto') // 'manual' | 'auto'
  const [songCount, setSongCount] = useState(10)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchGenre, setSearchGenre] = useState('any')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [playlist, setPlaylist] = useState([])
  const [searchPool, setSearchPool] = useState([])
  // Auto-select filters
  const [autoGenre, setAutoGenre] = useState('any')
  const [autoArtist, setAutoArtist] = useState('')
  const [autoLanguage, setAutoLanguage] = useState('any')
  const [autoDecade, setAutoDecade] = useState(null)
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoError, setAutoError] = useState('')

  // Game state
  const [phase, setPhase] = useState('setup')
  const [gameCode, setGameCode] = useState('')
  const [qrData, setQrData] = useState(null)
  const [joinUrl, setJoinUrl] = useState('')
  const [players, setPlayers] = useState([])
  const [roundData, setRoundData] = useState(null)
  const [roundEndData, setRoundEndData] = useState(null)
  const [answerProgress, setAnswerProgress] = useState({ answeredCount: 0, totalPlayers: 0 })
  const [timer, setTimer] = useState(30)
  const [finalScores, setFinalScores] = useState([])
  const [audioState, setAudioState] = useState('idle') // idle | preview | paused | playing

  const timerRef = useRef(null)
  const audioRef = useRef(null)
  const hintTimeoutsRef = useRef([])
  const roundActiveRef = useRef(false)
  const audioStateRef = useRef('idle')
  const answeredRef = useRef(0)
  const totalPlayersRef = useRef(0)
  const [currentHint, setCurrentHint] = useState(0)

  // hint schedule: { play ms, wait ms after }
  const HINT_STEPS = [
    { play: 1000,  wait: 15000 },
    { play: 2000,  wait: 10000 },
    { play: 3000,  wait: 8000  },
    { play: 5000,  wait: 6000  },
    { play: 30000, wait: 0     }, // play rest of preview
  ]

  function setAudioStateBoth(s) {
    setAudioState(s)
    audioStateRef.current = s
  }

  function clearHintTimers() {
    hintTimeoutsRef.current.forEach(clearTimeout)
    hintTimeoutsRef.current = []
  }

  function scheduleHint(stepIndex) {
    if (!roundActiveRef.current) return
    if (stepIndex >= HINT_STEPS.length) return

    const step = HINT_STEPS[stepIndex]
    setCurrentHint(stepIndex + 1)

    if (audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.play().catch(() => {})
      setAudioStateBoth('playing_hint')
    }

    const t1 = setTimeout(() => {
      if (!roundActiveRef.current) return
      if (audioRef.current) audioRef.current.pause()
      setAudioStateBoth('paused')

      if (step.wait > 0) {
        const t2 = setTimeout(() => scheduleHint(stepIndex + 1), step.wait)
        hintTimeoutsRef.current.push(t2)
      }
    }, step.play)
    hintTimeoutsRef.current.push(t1)
  }

  // Socket listeners
  useEffect(() => {
    socket.on('gameCreated', async ({ gameCode }) => {
      setGameCode(gameCode)
      setPhase('lobby')
      try {
        const res = await fetch(`/api/qr/${gameCode}`)
        const data = await res.json()
        setQrData(data.qrDataUrl)
        setJoinUrl(data.joinUrl)
      } catch (e) { console.error('QR failed', e) }
    })

    socket.on('playerList', ({ players }) => setPlayers(players))
    socket.on('gameStarted', () => setPhase('playing'))

    socket.on('roundStarted', (data) => {
      setRoundData(data)
      setPhase('playing')
      answeredRef.current = 0
      totalPlayersRef.current = players.length
      setAnswerProgress({ answeredCount: 0, totalPlayers: players.length })
      setTimer(data.timeLimit)
      setCurrentHint(0)
      roundActiveRef.current = true
      clearHintTimers()

      if (audioRef.current) {
        audioRef.current.src = data.audioUrl
        audioRef.current.currentTime = 0
      }

      // Start progressive hints
      scheduleHint(0)

      clearInterval(timerRef.current)
      let t = data.timeLimit
      timerRef.current = setInterval(() => { t--; setTimer(t); if (t <= 0) clearInterval(timerRef.current) }, 1000)
    })

    socket.on('answerProgress', ({ answeredCount, totalPlayers }) => {
      answeredRef.current = answeredCount
      totalPlayersRef.current = totalPlayers
      setAnswerProgress({ answeredCount, totalPlayers })
      // If everyone answered, play full song immediately
      if (answeredCount >= totalPlayers && totalPlayers > 0) {
        clearHintTimers()
        if (audioRef.current) {
          audioRef.current.currentTime = 0
          audioRef.current.play().catch(() => {})
          setAudioStateBoth('playing_full')
        }
      }
    })

    socket.on('roundEnded', (data) => {
      clearInterval(timerRef.current)
      roundActiveRef.current = false
      clearHintTimers()
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
      setAudioStateBoth('idle')
      setRoundEndData(data)
      setPhase('roundEnd')
    })

    socket.on('gameOver', ({ finalScores }) => { setFinalScores(finalScores); setPhase('gameOver') })

    return () => {
      socket.off('gameCreated'); socket.off('playerList'); socket.off('gameStarted')
      socket.off('roundStarted'); socket.off('answerProgress'); socket.off('roundEnded'); socket.off('gameOver')
      clearInterval(timerRef.current)
      roundActiveRef.current = false
      clearHintTimers()
    }
  }, [players.length])

  // ---- SEARCH ----
  async function doSearch() {
    if (!searchQuery.trim() && searchGenre === 'any') return
    setSearching(true); setSearchError(''); setSearchResults([])
    const parts = []
    if (searchQuery.trim()) parts.push(searchQuery.trim())
    if (searchGenre !== 'any') parts.push(searchGenre)
    const q = parts.join(' ')
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (data.error) { setSearchError(data.error); return }
      if (!data.tracks?.length) setSearchError('לא נמצאו שירים. נסה שם אחר או סגנון אחר.')
      const tracks = data.tracks || []
      setSearchResults(tracks)
      // צבור לתוך pool לשימוש כתשובות מסיחות
      setSearchPool(prev => {
        const ids = new Set(prev.map(t => t.id))
        return [...prev, ...tracks.filter(t => !ids.has(t.id))]
      })
    } catch { setSearchError('שגיאת חיבור') }
    finally { setSearching(false) }
  }

  // ---- AUTO-SELECT ----
  async function doAutoSelect() {
    setAutoLoading(true); setAutoError(''); setPlaylist([])
    const params = new URLSearchParams({ count: songCount })
    if (autoGenre !== 'any') params.set('genre', autoGenre)
    if (autoArtist.trim()) params.set('artist', autoArtist.trim())
    if (autoLanguage !== 'any') params.set('language', autoLanguage)
    if (autoDecade) params.set('decade', autoDecade)
    try {
      const res = await fetch(`/api/auto-select?${params}`)
      const data = await res.json()
      if (!res.ok || data.error) { setAutoError(data.error || 'שגיאה'); return }
      setPlaylist(data.tracks)
    } catch { setAutoError('שגיאת חיבור') }
    finally { setAutoLoading(false) }
  }

  function addToPlaylist(track) {
    if (playlist.find(t => t.id === track.id)) return
    setPlaylist(prev => [...prev, track])
    setSearchResults([]); setSearchQuery('')
  }
  function removeFromPlaylist(id) { setPlaylist(prev => prev.filter(t => t.id !== id)) }
  function createGame() { socket.emit('createGame', { songs: buildGameSongs(playlist, searchPool) }) }
  function createGameDemo() { socket.emit('createGame', { songs: [] }) }
  function startGame() { socket.emit('startGame', { gameCode }) }
  function endRoundNow() { socket.emit('endRound', { gameCode }) }
  function skipToNextHint() {
    if (!roundActiveRef.current) return
    clearHintTimers()
    const next = currentHint // currentHint is 1-based, scheduleHint is 0-based
    scheduleHint(next) // skip directly to next step
  }
  function nextRound() { socket.emit('nextRound', { gameCode }) }

  const timerPct = roundData ? (timer / roundData.timeLimit) * 100 : 100
  const timerColor = timer > 15 ? '#27ae60' : timer > 7 ? '#f39c12' : '#e74c3c'
  const answered = answerProgress.answeredCount
  const total = answerProgress.totalPlayers || players.length

  // ============ SETUP ============
  if (phase === 'setup') { return (
      <div className="screen" style={{ gap: 16, padding: '20px 16px' }}>
        <h2 style={{ marginBottom: 4 }}>🎵 בחר שירים לקוויז</h2>

        {/* Song count */}
        <div className="count-selector">
          <span className="count-label">מספר שירים:</span>
          {COUNTS.map(c => (
            <button key={c} className={`count-btn ${songCount === c ? 'active' : ''}`} onClick={() => setSongCount(c)}>{c}</button>
          ))}
        </div>

        {/* Tabs */}
        <div className="setup-tabs">
          <button className={`tab-btn ${setupTab === 'auto' ? 'active' : ''}`} onClick={() => setSetupTab('auto')}>🎲 בחירה אוטומטית</button>
          <button className={`tab-btn ${setupTab === 'manual' ? 'active' : ''}`} onClick={() => setSetupTab('manual')}>🔍 חיפוש ידני</button>
        </div>

        <div style={{ width: '100%', maxWidth: 720 }}>

          {/* ---- AUTO TAB ---- */}
          {setupTab === 'auto' && (
            <div className="auto-panel card">
              <div className="filter-section">
                <div className="filter-label">זמר / להקה</div>
                <input type="text" placeholder="לדוגמה: The Weeknd, נועה קירל..." value={autoArtist}
                  onChange={e => setAutoArtist(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doAutoSelect()}
                  className="filter-input" />
              </div>

              <div className="filter-section">
                <div className="filter-label">סגנון</div>
                <div className="filter-chips">
                  {GENRES.map(g => (
                    <button key={g.value} className={`chip ${autoGenre === g.value ? 'active' : ''}`}
                      onClick={() => setAutoGenre(g.value)}>{g.label}</button>
                  ))}
                </div>
              </div>

              <div className="filter-section">
                <div className="filter-label">שפה</div>
                <div className="filter-chips">
                  {LANGUAGES.map(l => (
                    <button key={l.value} className={`chip ${autoLanguage === l.value ? 'active' : ''}`}
                      onClick={() => setAutoLanguage(l.value)}>{l.label}</button>
                  ))}
                </div>
              </div>

              <div className="filter-section">
                <div className="filter-label">עשור</div>
                <div className="filter-chips">
                  <button className={`chip ${autoDecade === null ? 'active' : ''}`} onClick={() => setAutoDecade(null)}>⏱ כל הזמנים</button>
                  {DECADES.map(d => (
                    <button key={d} className={`chip ${autoDecade === d ? 'active' : ''}`} onClick={() => setAutoDecade(d)}>{d}</button>
                  ))}
                </div>
              </div>

              {autoError && <div className="error-msg" style={{ marginTop: 8 }}>{autoError}</div>}

              <button className="btn btn-purple" style={{ marginTop: 12 }} onClick={doAutoSelect} disabled={autoLoading}>
                {autoLoading ? '⏳ מחפש...' : `🎲 מלא ${songCount} שירים אוטומטית`}
              </button>
            </div>
          )}

          {/* ---- MANUAL TAB ---- */}
          {setupTab === 'manual' && (
            <div className="card">
              <div style={{ display: 'flex', gap: 8 }}>
                <input type="text" placeholder="🔍 שם זמר, שיר..." value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doSearch()}
                  style={{ flex: 1 }} />
                <button className="btn btn-primary" style={{ width: 'auto', padding: '0 20px' }}
                  onClick={doSearch} disabled={searching}>
                  {searching ? '...' : 'חפש'}
                </button>
              </div>
              {/* Genre filter for manual search */}
              <div className="filter-chips" style={{ marginTop: 10 }}>
                {GENRES.map(g => (
                  <button key={g.value} className={`chip ${searchGenre === g.value ? 'active' : ''}`}
                    onClick={() => setSearchGenre(g.value)}>{g.label}</button>
                ))}
              </div>
              {searchError && <div className="error-msg" style={{ marginTop: 8 }}>{searchError}</div>}
              {searchResults.length > 0 && (
                <div className="search-results" style={{ marginTop: 12 }}>
                  {searchResults.map(track => (
                    <div key={track.id} className="search-result-item" onClick={() => addToPlaylist(track)}>
                      {track.albumArt && <img src={track.albumArt} alt="" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="track-name">{track.name}</div>
                        <div className="track-artist">{track.artists}</div>
                      </div>
                      <button className="add-btn">+</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ---- PLAYLIST ---- */}
          {playlist.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <h3 style={{ marginBottom: 12 }}>🎶 פלייליסט ({playlist.length} שירים)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {playlist.map((track, i) => (
                  <div key={track.id} className="playlist-item">
                    <span style={{ color: '#95a5a6', minWidth: 24, fontSize: '0.85rem' }}>{i + 1}.</span>
                    {track.albumArt && <img src={track.albumArt} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
                      <div style={{ color: '#95a5a6', fontSize: '0.8rem' }}>
                        {track.artists}
                        {track.rank > 0 && <span style={{ marginRight: 8, color: '#f39c12', fontSize: '0.75rem' }}>🔥 {(track.rank / 1000).toFixed(0)}K</span>}
                      </div>
                    </div>
                    <button className="remove-btn" onClick={() => removeFromPlaylist(track.id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---- ACTIONS ---- */}
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-green" style={{ flex: 2 }}
              disabled={playlist.length === 0} onClick={createGame}>
              🎮 צור משחק עם {playlist.length} שירים
            </button>
            <button className="btn btn-gray" style={{ flex: 1 }} onClick={createGameDemo}>
              🎲 Demo
            </button>
          </div>
        </div>

        <button className="btn btn-gray" style={{ maxWidth: 200, marginTop: 8 }} onClick={() => navigate('/')}>← חזרה</button>
      </div>
    )
  }

  // ============ שאר ה-PHASES — audio קבוע תמיד ===
  return (
    <>
      {/* audio אחד שלא נמחק לעולם בין phase transitions */}
      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* LOBBY */}
      {phase === 'lobby' && (
        <div className="screen">
          <h2>🎮 ממתין לשחקנים</h2>
          <div className="host-lobby">
            <div className="card" style={{ textAlign: 'center' }}>
              <p className="subtitle">קוד המשחק</p>
              <div className="big-code">{gameCode}</div>
              <p className="subtitle" style={{ marginTop: 8 }}>או סרקו QR</p>
              {qrData && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}><div className="qr-wrapper"><img src={qrData} alt="QR Code" /></div></div>}
              {joinUrl && <p style={{ fontSize: '0.75rem', color: '#566573', marginTop: 8, wordBreak: 'break-all' }}>{joinUrl}</p>}
            </div>
            <div className="card">
              <h3>שחקנים ({players.length})</h3><br />
              {players.length === 0
                ? <p className="subtitle waiting-dots">ממתין לשחקנים</p>
                : <div className="player-list">{players.map((p, i) => <span key={i} className="player-chip">{p.nickname}</span>)}</div>}
              <br />
              <button className="btn btn-green" disabled={players.length === 0} onClick={startGame}>
                ▶ התחל משחק ({players.length} שחקנים)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PLAYING */}
      {(phase === 'playing' || phase === 'hint3') && roundData && (
        <div className="play-screen">
          <div className="song-info">
            <div className="song-number">שיר {roundData.songIndex + 1} מתוך {roundData.totalSongs}</div>
            <div className="now-playing">
              {audioState === 'playing_hint' && (
                <><div className="music-wave"><span /><span /><span /><span /><span /></div>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#e74c3c' }}>
                  🎵 רמז {currentHint}
                </span></>
              )}
              {audioState === 'paused' && (
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#f39c12' }}>
                  ⏸ רמז {currentHint} — מנחשים... ({answered}/{total} ענו)
                </span>
              )}
              {audioState === 'playing_full' && (
                <><div className="music-wave"><span /><span /><span /><span /><span /></div>
                <span style={{ fontWeight: 700, fontSize: '1.1rem', color: '#27ae60' }}>🎵 כולם ענו — שיר מלא!</span></>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="timer-number" style={{ color: timerColor }}>{timer}</div>
            <div className="timer-bar-wrap" style={{ maxWidth: 400, margin: '8px auto' }}>
              <div className="timer-bar" style={{ width: `${timerPct}%`, background: timerColor }} />
            </div>
          </div>
          <p className="progress-info">ענו: {answered} / {total}</p>
          <div className="answer-grid" style={{ margin: '0 auto', maxWidth: 600 }}>
            {roundData.options.map((opt, i) => (
              <div key={i} className={`answer-btn answer-btn-${i}`} style={{ cursor: 'default' }}>
                <span className="icon">{ICONS[i]}</span>{opt}
              </div>
            ))}
          </div>
          {phase === 'playing' && (
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button className="btn btn-orange" style={{ maxWidth: 220 }} onClick={skipToNextHint}
                disabled={audioState === 'playing_hint' || audioState === 'playing_full'}>
                ⏭ רמז הבא
              </button>
              <button className="btn btn-red" style={{ maxWidth: 220 }} onClick={endRoundNow}>⏹ סיים סיבוב</button>
            </div>
          )}
        </div>
      )}

      {/* ROUND END */}
      {phase === 'roundEnd' && roundEndData && (
        <div className="screen">
          <h2>✅ תשובה נכונה</h2>
          <div style={{ background: '#27ae60', borderRadius: 16, padding: '20px 40px', fontSize: '1.6rem', fontWeight: 900, textAlign: 'center' }}>
            {roundEndData.correctAnswer}
          </div>
          <div className="card" style={{ maxWidth: 500 }}>
            <h3 style={{ textAlign: 'center', marginBottom: 16 }}>🏆 טבלת מובילים</h3>
            <div className="leaderboard">
              {roundEndData.leaderboard.slice(0, 8).map(p => (
                <div key={p.nickname} className={`lb-row ${p.rank <= 3 ? `rank-${p.rank}` : ''}`}>
                  <span className="lb-rank">{p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `${p.rank}.`}</span>
                  <span className="lb-name">{p.nickname}</span>
                  <span className="lb-score">{p.score.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" style={{ maxWidth: 300 }} onClick={nextRound}>
            {roundData && roundData.songIndex + 1 < roundData.totalSongs ? '▶ שיר הבא' : '🏁 סיום משחק'}
          </button>
        </div>
      )}

      {/* GAME OVER */}
      {phase === 'gameOver' && (
        <div className="screen">
          <div className="winner-trophy">🏆</div>
          <h1>המשחק הסתיים!</h1>
          {finalScores[0] && (
            <div style={{ background: 'linear-gradient(135deg, #f39c12, #e67e22)', borderRadius: 16, padding: '16px 32px', textAlign: 'center', fontSize: '1.4rem', fontWeight: 900 }}>
              🥇 {finalScores[0].nickname} — {finalScores[0].score.toLocaleString()} נקודות
            </div>
          )}
          <div className="card" style={{ maxWidth: 500 }}>
            <h3 style={{ textAlign: 'center', marginBottom: 16 }}>תוצאות סופיות</h3>
            <div className="leaderboard">
              {finalScores.map(p => (
                <div key={p.nickname} className={`lb-row ${p.rank <= 3 ? `rank-${p.rank}` : ''}`}>
                  <span className="lb-rank">{p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `${p.rank}.`}</span>
                  <span className="lb-name">{p.nickname}</span>
                  <span className="lb-score">{p.score.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" style={{ maxWidth: 300 }} onClick={() => navigate('/')}>🏠 חזרה לבית</button>
        </div>
      )}
    </>
  )
}
