import { useState, useMemo, useEffect, useRef } from 'react'
import { simulateFault, stateAt } from '../lib/timeline'
import { EPS, buildNetwork, activeTap } from '../lib/network'

const TAIL = 0.05 // s of playback after the last event
export const DEFAULT_FAULT = { kind: 'line', line: 'AB', frac: 0.9 }
export const DEFAULT_SPEC = { type: '3PH', rf: 0 } // fault type + resistance
const EMPTY_SCENARIO = { relayOos: [], breakerFail: [], channels: {}, diffChannel: 'ok', dcLost: [], tripOpen: [] }

// A fault location only makes sense if its bus/line exists in this network
const validLoc = (net, loc, config) => (loc.kind === 'tap' || loc.kind === 'tapLV' ? !!activeTap(net, config)
  : loc.kind === 'bus' ? loc.bus in net.buses : loc.line in net.lines)

export function useCoordination(config) {
  const [faultLocRaw, setFaultLocRaw] = useState(DEFAULT_FAULT)
  const [scenario, setScenarioRaw] = useState(EMPTY_SCENARIO)
  const [spec, setSpecRaw] = useState(DEFAULT_SPEC)
  const [time, setTime] = useState(-Infinity) // clamped to the run's start (prefault)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0.25)

  const net = useMemo(() => buildNetwork(config.network), [config.network])
  const faultLoc = validLoc(net, faultLocRaw, config) ? faultLocRaw : DEFAULT_FAULT
  const sim = useMemo(() => simulateFault(config, faultLoc, scenario, spec), [config, faultLoc, scenario, spec])
  const endT = sim.events[sim.events.length - 1].t + TAIL
  const startT = sim.startT
  const t = Math.max(startT, Math.min(time, endT))
  const { idx, state } = stateAt(sim.events, t)

  // New fault or scenario → rewind
  function rewind() { setTime(-Infinity); setPlaying(false) }
  function setFaultLoc(loc) { setFaultLocRaw(loc); rewind() }
  function setScenario(fn) { setScenarioRaw(fn); rewind() }
  function setSpec(s) { setSpecRaw(s); rewind() }

  function toggleListItem(list, id) {
    setScenario(prev => {
      const cur = new Set(prev[list])
      cur.has(id) ? cur.delete(id) : cur.add(id)
      return { ...prev, [list]: [...cur] }
    })
  }

  function stepForward() {
    setPlaying(false)
    const next = sim.events.find(e => e.t > t + EPS)
    setTime(next ? next.t : endT)
  }

  function stepBack() {
    setPlaying(false)
    const prev = [...sim.events].reverse().find(e => e.t < t - EPS)
    setTime(prev ? prev.t : startT)
  }

  function togglePlay() {
    if (!playing && t >= endT - EPS) setTime(startT)
    else setTime(t) // resolve -Infinity before the clock adds to it
    setPlaying(p => !p)
  }

  // Playback clock
  const endRef = useRef(endT)
  endRef.current = endT
  useEffect(() => {
    if (!playing) return
    let raf, last = performance.now()
    const tick = now => {
      const dt = (now - last) / 1000
      last = now
      setTime(prev => {
        const nextT = prev + dt * speed
        if (nextT >= endRef.current) { setPlaying(false); return endRef.current }
        return nextT
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])

  return {
    faultLoc, setFaultLoc, spec, setSpec,
    loadScenario: sc => setScenario({ ...EMPTY_SCENARIO, ...sc }),
    setDiffChannel: v => setScenario(prev => ({ ...prev, diffChannel: v })),
    setChannel: (line, v) => setScenario(prev => ({ ...prev, channels: { ...prev.channels, [line]: v } })),
    scenario, toggleOos: id => toggleListItem('relayOos', id), toggleBreakerFail: id => toggleListItem('breakerFail', id),
    toggleDc: bus => toggleListItem('dcLost', bus),
    toggleTripOpen: id => toggleListItem('tripOpen', id),
    sim, state, eventIdx: idx,
    time: t, setTime: v => { setPlaying(false); setTime(v) }, startT, endT,
    playing, togglePlay, speed, setSpeed,
    stepForward, stepBack, rewind,
  }
}
