import { ms } from '../lib/timeline'

const SPEEDS = [0.05, 0.1, 0.25, 1]

function Btn({ onClick, title, children, primary }) {
  return (
    <button onClick={onClick} title={title}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition
        ${primary ? 'bg-gray-800 text-white border-gray-800 hover:bg-gray-700' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'}`}>
      {children}
    </button>
  )
}

export default function SimControls({ coord, freqHz }) {
  const { time, startT, endT, playing, togglePlay, stepForward, stepBack, rewind, setTime, speed, setSpeed } = coord
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn onClick={rewind} title="Reset to fault inception">Reset</Btn>
      <Btn onClick={stepBack} title="Previous event">◀ Step</Btn>
      <Btn onClick={togglePlay} title={playing ? 'Pause' : 'Play'} primary>{playing ? '⏸ Pause' : '▶ Play'}</Btn>
      <Btn onClick={stepForward} title="Next event">Step ▶</Btn>
      <select value={speed} onChange={e => coord.setSpeed(Number(e.target.value))}
        className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white" title="Playback speed">
        {SPEEDS.map(s => <option key={s} value={s}>{s}× speed</option>)}
      </select>
      <input type="range" min={startT} max={endT} step={0.0005} value={time}
        onChange={e => setTime(Number(e.target.value))}
        className="flex-1 min-w-[8rem] h-2" aria-label="Simulation time" />
      <span className="font-mono text-sm text-gray-700 whitespace-nowrap text-right">
        t = {ms(time)} <span className="text-gray-400">({(time * freqHz).toFixed(1)} cyc)</span>
      </span>
    </div>
  )
}
