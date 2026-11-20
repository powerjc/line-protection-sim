import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { explain, offFeatures } from '../lib/explain'
import { VERDICT } from './EventLog'
import { ms } from '../lib/timeline'

// Screen tour and Explain mode.
//
// Panels mark themselves as targets with useExplain(): ex(id, className)
// returns props to spread on the panel's own element (data-tour, and the
// spotlight / outline classes), so no wrapper changes any layout.
//   Tour:    steps through the targets on screen now, in screen order (or a
//            lesson's own steps), spotlighting one at a time.
//   Explain: outlines every target; tap one for what it is. With none picked,
//            lists what is switched off, with one-click turn on.
// A dimming overlay sits between the page and the targets, so the rest of the
// page can't be clicked while either is open; Esc closes.

const TourCtx = createContext(null)

// onAction: a lesson step's action ({ time }: move the playback there) — the App applies it
// playback: { time, playing, freqHz, rewind, stepBack, stepForward, togglePlay } for the
//   callout's own controls, shown when a step involves playback (a `*.controls` target)
//   instead of spotlighting the screen's controls, which may be far from the panel in question
const isControls = id => id.endsWith('.controls')
export function TourProvider({ ctx, onEnableFeature, onAction, playback, children }) {
  const [mode, setMode] = useState(null) // null | 'tour' | 'explain'
  const [steps, setSteps] = useState([]) // [{ id, text? }]
  const [k, setK] = useState(0)
  const [picked, setPicked] = useState(null)
  // A lesson walkthrough's way on: { label, go } for the next lesson (shown on the last step)
  const [onward, setOnward] = useState(null)

  // Spotlighted ids: a tour step can light several panels at once (playback controls
  // are not lit: the callout carries its own)
  const current = mode === 'tour' ? (steps[k]?.ids ?? []).filter(id => !isControls(id)) : mode === 'explain' && picked ? [picked] : []
  const close = useCallback(() => { setMode(null); setPicked(null) }, [])

  // Screen tour: every marked target on screen now, in document order (details
  // such as single chain cards are left to Explain mode and lessons). custom:
  // a lesson's steps [{ ids, text, title, action }], keeping the ids on screen.
  // at: the step to start on (a lesson bullet's own); onwardTo: { label, go } for the last step
  const startTour = useCallback((custom = null, at = 0, onwardTo = null) => {
    // Screen order, with the header's items (the same on every screen) last
    const all = [...document.querySelectorAll('[data-tour]')].map(el => el.dataset.tour)
    const onScreen = [...all.filter(id => !id.startsWith('header.')), ...all.filter(id => id.startsWith('header.'))]
    const list = custom
      ? custom.map(s => {
          const ids = s.ids ?? [s.target]
          // Every lesson step carries the playback, so a Try bullet can be replayed where it is lit
          return { ...s, ids: ids.filter(id => onScreen.includes(id) && !isControls(id)), withPlayback: true }
        }).filter(s => s.ids.length || s.withPlayback)
      : onScreen.filter(id => explain(id) && !explain(id).detail).map(id => ({ ids: [id] }))
    if (!list.length) return
    setSteps(list); setK(Math.max(0, Math.min(at, list.length - 1))); setPicked(null); setOnward(onwardTo); setMode('tour')
  }, [])
  const startExplain = useCallback(() => { setPicked(null); setMode('explain') }, [])

  // A lesson step can move the playback to the moment it talks about
  const action = mode === 'tour' ? steps[k]?.action : null
  useEffect(() => { if (action) onAction?.(action) }, [action]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bring the (first) spotlighted target into view
  const first = current[0]
  useEffect(() => {
    if (!first) return
    // After a beat, so a panel the step opens (collapsed settings) has its full height
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-tour="${first}"]`)
      if (!el) return
      // Phones (the callout is a bottom sheet) and tall panels: near the top instead of the middle
      if (window.innerWidth < 640 || el.offsetHeight > window.innerHeight * 0.6) {
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: 'smooth' })
      } else el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }, 60)
    return () => clearTimeout(timer)
  }, [first, k, mode])

  useEffect(() => {
    if (!mode) return
    const onKey = e => {
      if (e.key === 'Escape') close()
      if (mode === 'tour' && e.key === 'ArrowRight') setK(x => Math.min(x + 1, steps.length - 1))
      if (mode === 'tour' && e.key === 'ArrowLeft') setK(x => Math.max(x - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, steps.length, close])

  const value = { mode, current, picked, setPicked, startTour, startExplain, close, steps, k, setK, ctx, onEnableFeature, playback, onward }
  return (
    <TourCtx.Provider value={value}>
      {children}
      {/* The tour only dims: the rest of the screen stays usable. Explain mode blocks it (clicks explain, not act) */}
      {/* A Try step isn't dimmed: its result can land anywhere on the screen, so only the ring says where to act */}
      {mode && !(mode === 'tour' && steps[k]?.key?.startsWith('try')) &&
        <div className={`fixed inset-0 z-40 bg-gray-900/30${mode === 'tour' ? ' pointer-events-none' : ''}`} aria-hidden />}
      {mode && <Callout />}
    </TourCtx.Provider>
  )
}

export const useTour = () => useContext(TourCtx)

// ex(id, className, inset) → props for the target's own element
// (inset: draw the ring inside, for targets inside a clipping card)
export function useExplain() {
  const t = useContext(TourCtx)
  return (id, className = '', inset = false) => {
    const spot = !!t?.current?.includes(id)
    const outline = t?.mode === 'explain' && !spot
    const ring = inset ? (spot ? ' ring-4 ring-inset ring-indigo-400 bg-white' : ' ring-2 ring-inset ring-indigo-300 bg-white cursor-help')
      : (spot ? ' ring-4 ring-indigo-400 ring-offset-2 bg-white' : ' ring-2 ring-indigo-300 ring-offset-1 cursor-help')
    return {
      'data-tour': id,
      className: `${className}${spot || outline ? ` relative z-50${ring}` : ''}`,
      // Targets can nest (a chain card inside the chain): pick the innermost under the click
      onClickCapture: t?.mode === 'explain' ? e => { e.preventDefault(); e.stopPropagation(); t.setPicked(e.target.closest('[data-tour]')?.dataset.tour ?? id) } : undefined,
    }
  }
}

// The same as a component: renders `as` (default div) as the target itself
export function Target({ id, as: Tag = 'div', className = '', inset = false, children, ...rest }) {
  const ex = useExplain()
  return <Tag {...rest} {...ex(id, className, inset)}>{children}</Tag>
}

function Callout() {
  const t = useTour()
  const { mode, steps, k, setK, close, picked, ctx, onEnableFeature, playback, onward } = t
  const step = mode === 'tour' ? steps[k] : null
  const base = explain(mode === 'tour' ? step?.ids[0] : picked, ctx)
  const showPlayback = mode === 'tour' && step?.withPlayback && playback
  const title = step?.title ?? base?.title
  const text = step?.text ?? base?.text
  const off = mode === 'explain' && !picked ? offFeatures(ctx.config) : []

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-indigo-300 bg-white shadow-2xl px-4 py-3 max-h-[45vh] overflow-y-auto" role="dialog" aria-label={mode === 'tour' ? 'Screen tour' : 'Explain mode'}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wider">
            {mode === 'tour' ? `${steps.some(s => s.text) ? 'Lesson walkthrough' : 'Tour'} · ${k + 1} of ${steps.length}` : 'Explain mode · tap anything outlined'}
          </span>
          <button onClick={close} className="text-gray-400 hover:text-gray-700 text-lg leading-none px-1" title="Close (Esc)">×</button>
        </div>
        {title ? <>
          <h3 className="text-base font-bold text-gray-900 mt-0.5">{title}</h3>
          <p className="text-sm text-gray-700 mt-1">{text}</p>
        </> : (
          <p className="text-sm text-gray-700 mt-1">Every outlined panel can explain itself: tap one. Nothing changes while Explain mode is on.</p>
        )}
        {showPlayback && <MiniPlayback p={playback} />}
        {off.length > 0 && (
          <div className="mt-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Switched off right now</div>
            <ul className="mt-1 space-y-1">
              {off.map(o => (
                <li key={o.feature} className="flex items-baseline justify-between gap-2 text-xs">
                  <span><span className="font-semibold text-gray-700">{o.label}:</span> <span className="text-gray-500">{o.adds}</span></span>
                  {onEnableFeature && (
                    <button onClick={() => onEnableFeature(o.feature)} className="shrink-0 px-2 py-0.5 rounded border border-indigo-300 text-indigo-700 hover:border-indigo-500">Turn on</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {mode === 'explain' && picked && <button onClick={() => t.setPicked(null)} className="text-sm text-indigo-700 underline">What’s switched off?</button>}
          <span className="flex-1" />
          {mode === 'tour' && k > 0 && <button onClick={() => setK(k - 1)} className="text-sm px-3 py-1 rounded-lg border border-gray-300 text-gray-700 bg-white">◀ Back</button>}
          {mode === 'tour' && (k + 1 < steps.length
            ? <button onClick={() => setK(k + 1)} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white">Next ▶</button>
            : <>
                <button onClick={close} title="Close the walkthrough and explore freely" className={`text-sm px-3 py-1 rounded-lg ${onward ? 'border border-gray-300 text-gray-700 bg-white' : 'bg-indigo-600 text-white'}`}>Done</button>
                {onward && <button onClick={() => { close(); onward.go() }} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white">Next lesson: {onward.label} ▶</button>}
              </>)}
          {mode === 'explain' && <button onClick={close} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white">Done</button>}
        </div>
      </div>
    </div>
  )
}

// Playback controls inside the callout, for steps that say "step to…" or "play"
function MiniPlayback({ p }) {
  const btn = 'text-sm px-2.5 py-1 rounded-lg border border-gray-300 text-gray-700 bg-white hover:border-gray-500'
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Playback">
      <button onClick={p.rewind} className={btn} title="Back to the start">Reset</button>
      <button onClick={p.stepBack} className={btn} title="Previous event">◀ Step</button>
      <button onClick={p.togglePlay} className="text-sm px-2.5 py-1 rounded-lg bg-gray-800 text-white" title={p.playing ? 'Pause' : 'Play'}>{p.playing ? '⏸ Pause' : '▶ Play'}</button>
      <button onClick={p.stepForward} className={btn} title="Next event">Step ▶</button>
      {p.toEnd && <button onClick={p.toEnd} className={btn} title="Jump to the end of the run">Run to end ▶▶</button>}
      <span className="font-mono text-xs text-gray-600 ml-1">t = {(p.time * 1000).toFixed(1)} ms <span className="text-gray-400">({(p.time * p.freqHz).toFixed(1)} cyc)</span></span>
      {p.outcome && VERDICT[p.outcome.verdict] && (
        <span className="basis-full flex items-center gap-2 mt-0.5">
          <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${VERDICT[p.outcome.verdict].style}`}>{VERDICT[p.outcome.verdict].label}</span>
          {p.outcome.clearedAt !== null && <span className="text-xs text-gray-500">cleared at {ms(p.outcome.clearedAt)}</span>}
        </span>
      )}
    </div>
  )
}

// The ? in the header: tour this screen, or explain mode
export function HelpMenu() {
  const t = useTour()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} title="Help: tour this screen or explain anything on it"
        className="w-8 h-8 rounded-full border border-gray-300 text-gray-600 font-bold hover:text-gray-900 hover:border-gray-500">?</button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-56 bg-white border border-gray-200 rounded-xl shadow-lg p-1.5 flex flex-col">
          <button onClick={() => { setOpen(false); t.startTour() }} className="text-left text-sm px-2 py-1.5 rounded-lg hover:bg-gray-50">
            <span className="font-semibold text-gray-800">Tour this screen</span>
            <span className="block text-xs text-gray-500">Step through each panel</span>
          </button>
          <button onClick={() => { setOpen(false); t.startExplain() }} className="text-left text-sm px-2 py-1.5 rounded-lg hover:bg-gray-50">
            <span className="font-semibold text-gray-800">Explain mode</span>
            <span className="block text-xs text-gray-500">Tap anything to see what it is, and what’s switched off</span>
          </button>
        </div>
      )}
    </div>
  )
}
