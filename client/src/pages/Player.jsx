import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import socket from '../socket'

const ICONS = ['▲', '◆', '●', '■']
const COLORS = ['#e74c3c', '#2980b9', '#f39c12', '#27ae60']

export default function Player() {
  const { gameCode: codeFromUrl } = useParams()
  const navigate = useNavigate()

  const [phase, setPhase] = useState(codeFromUrl ? 'enterNickname' : 'enterCode')
  const [gameCode, setGameCode] = useState(codeFromUrl || '')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [players, setPlayers] = useState([])
  const [roundData, setRoundData] = useState(null)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [answerResult, setAnswerResult] = useState(null)
  const [roundEndData, setRoundEndData] = useState(null)
  const [finalScores, setFinalScores] = useState([])
  const [timer, setTimer] = useState(30)
  const [myScore, setMyScore] = useState(0)
  const timerRef = useRef(null)
  const myNickname = useRef('')

  useEffect(() => {
    socket.on('joinSuccess', ({ nickname }) => {
      myNickname.current = nickname
      setPhase('lobby')
    })

    socket.on('joinError', ({ message }) => {
      setError(message)
    })

    socket.on('playerList', ({ players }) => setPlayers(players))

    socket.on('gameStarted', () => {
      setPhase('playing')
    })

    socket.on('roundStarted', (data) => {
      setRoundData(data)
      setSelectedAnswer(null)
      setAnswerResult(null)
      setTimer(data.timeLimit)
      setPhase('playing')

      clearInterval(timerRef.current)
      let t = data.timeLimit
      timerRef.current = setInterval(() => {
        t--
        setTimer(t)
        if (t <= 0) clearInterval(timerRef.current)
      }, 1000)
    })

    socket.on('answerResult', ({ isCorrect, points, correctAnswer }) => {
      setAnswerResult({ isCorrect, points, correctAnswer })
      setPhase('answered')
      if (isCorrect) setMyScore(prev => prev + points)
    })

    socket.on('roundEnded', (data) => {
      clearInterval(timerRef.current)
      setRoundEndData(data)
      setPhase('roundEnd')
    })

    socket.on('gameOver', ({ finalScores }) => {
      setFinalScores(finalScores)
      setPhase('gameOver')
    })

    socket.on('hostDisconnected', () => {
      alert('המארח התנתק. המשחק הסתיים.')
      navigate('/')
    })

    return () => {
      socket.off('joinSuccess')
      socket.off('joinError')
      socket.off('playerList')
      socket.off('gameStarted')
      socket.off('roundStarted')
      socket.off('answerResult')
      socket.off('roundEnded')
      socket.off('gameOver')
      socket.off('hostDisconnected')
      clearInterval(timerRef.current)
    }
  }, [navigate])

  function joinGame() {
    if (!gameCode.trim()) { setError('הכנס קוד משחק'); return }
    if (!nickname.trim()) { setError('הכנס כינוי'); return }
    setError('')
    socket.emit('joinGame', { gameCode: gameCode.trim().toUpperCase(), nickname: nickname.trim() })
  }

  function submitAnswer(answer) {
    if (selectedAnswer) return
    setSelectedAnswer(answer)
    socket.emit('submitAnswer', { gameCode, answer })
  }

  const timerPct = roundData ? (timer / roundData.timeLimit) * 100 : 100
  const timerColor = timer > 15 ? '#27ae60' : timer > 7 ? '#f39c12' : '#e74c3c'

  const myRank = roundEndData?.leaderboard.find(p => p.nickname === myNickname.current)

  // ---- ENTER CODE ----
  if (phase === 'enterCode') {
    return (
      <div className="screen">
        <div style={{ fontSize: '3rem', textAlign: 'center' }}>🎵</div>
        <h2>הצטרף למשחק</h2>
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="input-group">
              <label>קוד משחק</label>
              <input
                type="text"
                placeholder="ABCDE"
                value={gameCode}
                onChange={e => setGameCode(e.target.value.toUpperCase())}
                maxLength={8}
                style={{ textAlign: 'center', letterSpacing: 6, fontSize: '1.5rem' }}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!gameCode.trim()) { setError('הכנס קוד משחק'); return }
                setError('')
                setPhase('enterNickname')
              }}
            >
              המשך
            </button>
            {error && <div className="error-msg">{error}</div>}
          </div>
        </div>
        <button className="btn btn-gray" style={{ maxWidth: 200 }} onClick={() => navigate('/')}>
          ← חזרה
        </button>
      </div>
    )
  }

  // ---- ENTER NICKNAME ----
  if (phase === 'enterNickname') {
    return (
      <div className="screen">
        <div style={{ fontSize: '3rem', textAlign: 'center' }}>👤</div>
        <h2>בחר כינוי</h2>
        <p className="subtitle">משחק: <strong>{gameCode}</strong></p>
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="input-group">
              <label>השם שלך</label>
              <input
                type="text"
                placeholder="שם הגיבור..."
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                maxLength={20}
                onKeyDown={e => e.key === 'Enter' && joinGame()}
                autoFocus
              />
            </div>
            <button className="btn btn-primary" onClick={joinGame}>
              🚀 הצטרף למשחק!
            </button>
            {error && <div className="error-msg">{error}</div>}
          </div>
        </div>
      </div>
    )
  }

  // ---- LOBBY ----
  if (phase === 'lobby') {
    return (
      <div className="screen">
        <div style={{ fontSize: '3rem', textAlign: 'center' }}>✅</div>
        <h2>הצטרפת!</h2>
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.5rem', fontWeight: 900 }}>{myNickname.current}</p>
          <p className="subtitle" style={{ marginTop: 8 }}>
            ממתין לתחילת המשחק<span className="waiting-dots"></span>
          </p>
          <div className="divider" style={{ margin: '16px 0' }} />
          <p className="player-count">{players.length} שחקנים חוברו</p>
          <div className="player-list" style={{ marginTop: 12 }}>
            {players.map((p, i) => (
              <span key={i} className="player-chip" style={{
                background: p.nickname === myNickname.current ? '#8e44ad' : undefined
              }}>
                {p.nickname}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ---- PLAYING ----
  if (phase === 'playing' && roundData) {
    return (
      <div className="play-screen">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="song-info" style={{ flex: 1 }}>
            <div className="song-number">שיר {roundData.songIndex + 1} / {roundData.totalSongs}</div>
            <div className="now-playing">
              <div className="music-wave">
                <span /><span /><span /><span /><span />
              </div>
              <span style={{ fontWeight: 700 }}>הקשב...</span>
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: '0 16px' }}>
            <div className="timer-number" style={{ color: timerColor }}>{timer}</div>
          </div>
        </div>

        <div className="timer-bar-wrap">
          <div className="timer-bar" style={{ width: `${timerPct}%`, background: timerColor }} />
        </div>

        <div style={{ flex: 1 }}>
          <p className="subtitle" style={{ textAlign: 'center', marginBottom: 12 }}>
            🎵 איזה סגנון מוזיקה זה?
          </p>
          <div className="answer-grid">
            {roundData.options.map((opt, i) => (
              <button
                key={i}
                className={`answer-btn answer-btn-${i}${selectedAnswer === opt ? ' selected' : ''}`}
                onClick={() => submitAnswer(opt)}
                disabled={!!selectedAnswer}
              >
                <span className="icon">{ICONS[i]}</span>
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center', color: '#566573', fontSize: '0.85rem' }}>
          נקודות: {myScore.toLocaleString()}
        </div>
      </div>
    )
  }

  // ---- ANSWERED ----
  if (phase === 'answered' && answerResult) {
    return (
      <div className="screen">
        <div className="answered-waiting">
          <div className="answered-icon">
            {answerResult.isCorrect ? '✅' : '❌'}
          </div>
          <h2>{answerResult.isCorrect ? 'נכון!' : 'טעות...'}</h2>
          {answerResult.isCorrect && (
            <div className="points-pop">+{answerResult.points}</div>
          )}
          {!answerResult.isCorrect && (
            <p className="subtitle">
              התשובה הנכונה: <strong>{answerResult.correctAnswer}</strong>
            </p>
          )}
          <p className="subtitle waiting-dots">ממתין לסיום הסיבוב</p>
        </div>
      </div>
    )
  }

  // ---- ROUND END ----
  if (phase === 'roundEnd' && roundEndData) {
    return (
      <div className="screen">
        <div style={{
          background: '#27ae60',
          borderRadius: 16,
          padding: '16px 32px',
          fontSize: '1.4rem',
          fontWeight: 900,
          textAlign: 'center'
        }}>
          ✅ {roundEndData.correctAnswer}
        </div>

        {myRank && (
          <div className="card" style={{ textAlign: 'center', maxWidth: 300 }}>
            <p style={{ color: '#95a5a6', fontSize: '0.9rem' }}>הדירוג שלך</p>
            <p style={{ fontSize: '2.5rem', fontWeight: 900 }}>#{myRank.rank}</p>
            <p style={{ fontSize: '1.3rem', color: '#f1c40f', fontWeight: 700 }}>
              {myRank.score.toLocaleString()} נקודות
            </p>
          </div>
        )}

        <div className="card" style={{ maxWidth: 400 }}>
          <h3 style={{ textAlign: 'center', marginBottom: 12 }}>🏆 מובילים</h3>
          <div className="leaderboard">
            {roundEndData.leaderboard.slice(0, 5).map((p) => (
              <div
                key={p.nickname}
                className={`lb-row ${p.rank <= 3 ? `rank-${p.rank}` : ''}`}
                style={p.nickname === myNickname.current ? { outline: '2px solid #8e44ad' } : {}}
              >
                <span className="lb-rank">
                  {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `${p.rank}.`}
                </span>
                <span className="lb-name">{p.nickname}</span>
                <span className="lb-score">{p.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="subtitle waiting-dots">ממתין לסיבוב הבא</p>
      </div>
    )
  }

  // ---- GAME OVER ----
  if (phase === 'gameOver') {
    const myFinal = finalScores.find(p => p.nickname === myNickname.current)
    const isWinner = myFinal?.rank === 1

    return (
      <div className="screen">
        {isWinner && <div className="winner-trophy">🏆</div>}
        <h1>{isWinner ? 'ניצחת! 🎉' : 'המשחק הסתיים!'}</h1>

        {myFinal && (
          <div className="card" style={{ textAlign: 'center', maxWidth: 300 }}>
            <p style={{ color: '#95a5a6' }}>התוצאה שלך</p>
            <p style={{ fontSize: '2rem', fontWeight: 900 }}>#{myFinal.rank}</p>
            <p style={{ fontSize: '1.5rem', color: '#f1c40f', fontWeight: 700 }}>
              {myFinal.score.toLocaleString()} נקודות
            </p>
          </div>
        )}

        <div className="card" style={{ maxWidth: 400 }}>
          <h3 style={{ textAlign: 'center', marginBottom: 12 }}>תוצאות סופיות</h3>
          <div className="leaderboard">
            {finalScores.map((p) => (
              <div
                key={p.nickname}
                className={`lb-row ${p.rank <= 3 ? `rank-${p.rank}` : ''}`}
                style={p.nickname === myNickname.current ? { outline: '2px solid #8e44ad' } : {}}
              >
                <span className="lb-rank">
                  {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `${p.rank}.`}
                </span>
                <span className="lb-name">{p.nickname}</span>
                <span className="lb-score">{p.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" style={{ maxWidth: 280 }} onClick={() => navigate('/')}>
          🏠 חזרה לבית
        </button>
      </div>
    )
  }

  return null
}
