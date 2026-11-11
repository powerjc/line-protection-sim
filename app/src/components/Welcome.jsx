import { useState } from 'react'
import { AUDIENCES } from '../lib/levels'
import { LESSONS } from '../lib/lessons'

// First-run card on the Coordination tab: how to read the screen, who you
// are (sets the starting point), then that audience's first lesson or explore.
export function WelcomeCard({ audience, onAudience, onStartLesson, onClose }) {
  const [min, setMin] = useState(false)
  const chosen = AUDIENCES.find(a => a.id === audience) ?? AUDIENCES[0]
  const lesson = LESSONS.find(l => l.id === chosen.firstLesson)

  return (
    <section className="mx-4 mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60" aria-label="Welcome">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="text-xs font-semibold text-indigo-500 uppercase tracking-wider shrink-0">Welcome</span>
        <h2 className="text-sm font-bold text-indigo-900 flex-1 min-w-0 truncate">One fault, every relay, step by step</h2>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setMin(m => !m)} className="text-xs text-indigo-600 hover:text-indigo-900 px-2 py-1">{min ? 'Show' : 'Hide'}</button>
          <button onClick={onClose} className="text-indigo-400 hover:text-indigo-700 text-lg leading-none px-1" title="Close (reopen from Lessons)">×</button>
        </div>
      </div>
      {!min && (
        <div className="px-4 pb-3 flex flex-col gap-3">
          <p className="text-sm text-gray-800">
            The one-line below shows transmission line A–B with a distance relay and a breaker at each end.
            A fault is already placed at 90% of the way from A to B. Play it and watch how each end clears it.
          </p>
          <ol className="grid md:grid-cols-3 gap-1.5 sm:gap-2 text-sm text-gray-700">
            {[
              ['Pick a fault', 'Click anywhere on the one-line, or use the fault-location presets.'],
              ['Play or step', '▶ Play runs the clearing sequence; Step ▶ goes one event at a time (pickup, timer, trip, breaker open).'],
              ['Read the result', 'Once the fault clears, the verdict appears above the sequence of events: selective, cleared by backup, miscoordination, or not cleared.'],
            ].map(([head, text], i) => (
              <li key={head} className="flex gap-2 sm:rounded-lg sm:bg-white sm:border sm:border-indigo-100 sm:px-3 sm:py-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <span><span className="font-semibold text-gray-900">{head}.</span> {text}</span>
              </li>
            ))}
          </ol>
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Which describes you?</div>
            <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Audience">
              {AUDIENCES.map(a => (
                <button key={a.id} role="radio" aria-checked={a.id === chosen.id} onClick={() => onAudience(a.id)}
                  className={`text-left rounded-lg border px-3 py-2 transition
                    ${a.id === chosen.id ? 'border-indigo-500 bg-white ring-2 ring-indigo-200' : 'border-gray-200 bg-white/70 hover:border-indigo-300'}`}>
                  <span className="block text-sm font-semibold text-gray-900">{a.label}</span>
                  <span className="block text-xs text-indigo-700">{a.who}</span>
                  <span className="hidden sm:block text-xs text-gray-500 mt-0.5">{a.blurb}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">Learner level and modules (Consequences, 87L) are in ⚙ Settings.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lesson && (
              <button onClick={() => onStartLesson(lesson)} className="text-sm px-3 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                Start lesson: {lesson.title} ▶
              </button>
            )}
            <button onClick={onClose} className="text-sm px-3 py-1 rounded-lg border border-indigo-300 text-indigo-700 bg-white hover:border-indigo-500">
              Explore on my own
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
