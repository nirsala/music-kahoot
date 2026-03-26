import { useNavigate } from 'react-router-dom'

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="screen">
      <div className="home-logo">🎵</div>
      <div className="home-title">Music Quiz</div>
      <p className="subtitle">נחשו שירים, צברו נקודות!</p>

      <div className="home-btns">
        <button className="btn btn-host" onClick={() => navigate('/host')}>
          🎮 אירח משחק
        </button>
        <button className="btn btn-join" onClick={() => navigate('/play/')}>
          📱 הצטרף למשחק
        </button>
      </div>
    </div>
  )
}
