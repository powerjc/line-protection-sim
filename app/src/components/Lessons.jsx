import { useState } from 'react'
import { LESSONS, TRACKS } from '../lib/lessons'
import { trackLabel } from '../lib/levels'

// Lessons the viewer has opened — a per-browser convenience, safe to lose.
const KEY = 'lps.lessonsSeen'
export function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')) } catch { return new Set() }
}
export function saveSeen(seen) {
  try { localStorage.setItem(KEY, JSON.stringify([...seen])) } catch { /* storage unavailable */ }
}

export function LessonMenu({ activeId, seen, onStart, onWelcome }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition
          ${open || activeId ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-300 hover:border-indigo-500'}`}>
        Lessons
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-20 w-80 max-h-[75vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg p-3">
          <button onClick={() => { onWelcome(); setOpen(false) }}
            className="w-full text-left px-2 py-1.5 mb-1 rounded-lg text-sm text-indigo-700 hover:bg-indigo-50">
            Welcome &amp; how to read the screen
          </button>
          <p className="text-xs text-gray-400 px-1 mb-2">Starting a lesson resets settings to defaults, then switches on what the lesson needs.</p>
          {TRACKS.map(track => (
            <div key={track} className="mb-2">
              <div className="flex items-baseline justify-between px-1 mb-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{track}</span>
                <span className="text-[11px] text-gray-400">{trackLabel(track)}</span>
              </div>
              {LESSONS.filter(l => l.track === track).map((l, i) => (
                <button key={l.id} onClick={() => { onStart(l); setOpen(false) }}
                  className={`w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-lg text-sm transition
                    ${l.id === activeId ? 'bg-indigo-50 text-indigo-800' : 'hover:bg-gray-50 text-gray-700'}`}>
                  <span className="text-xs text-gray-400 w-4 shrink-0 pt-0.5">{i + 1}</span>
                  <span className="flex-1">{l.title}</span>
                  {seen.has(l.id) && <span className="text-green-600 text-xs pt-0.5" title="Opened">✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function LessonCard({ lesson, onRestart, onPrev, onNext, onClose }) {
  const [min, setMin] = useState(false)
  const idx = LESSONS.indexOf(lesson)
  const prev = LESSONS[idx - 1], next = LESSONS[idx + 1]

  return (
    <section className="mx-4 mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wider shrink-0">{lesson.track}</span>
        <h2 className="text-sm font-bold text-indigo-900 flex-1 min-w-0 truncate">{lesson.title}</h2>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setMin(m => !m)} className="text-xs text-indigo-600 hover:text-indigo-900 px-2 py-1">{min ? 'Show' : 'Hide'}</button>
          <button onClick={onClose} className="text-indigo-400 hover:text-indigo-700 text-lg leading-none px-1" title="End lesson">×</button>
        </div>
      </div>
      {!min && (
        <div className="px-4 pb-3 flex flex-col gap-3">
          <p className="text-sm text-gray-800">{lesson.intro}</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Watch for</div>
              <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">{lesson.watch.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Try this</div>
              <ul className="text-sm text-gray-700 space-y-1 list-disc pl-5">{lesson.tryIt.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          </div>
          <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2 text-sm text-indigo-900">
            <span className="font-semibold">Key point: </span>{lesson.takeaway}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onRestart} className="text-sm px-3 py-1 rounded-lg border border-indigo-300 text-indigo-700 bg-white hover:border-indigo-500">Restart lesson</button>
            <span className="flex-1" />
            {prev && <button onClick={onPrev} className="text-sm px-3 py-1 rounded-lg border border-gray-300 text-gray-700 bg-white hover:border-gray-500">◀ {prev.title}</button>}
            {next && <button onClick={onNext} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">{next.title} ▶</button>}
          </div>
        </div>
      )}
    </section>
  )
}
