import { useEffect, useRef } from 'react'
import { ms } from '../lib/timeline'

const KIND_STYLE = {
  fault:     'text-red-700 font-semibold',
  pickup:    'text-gray-800',
  trip:      'text-red-700 font-semibold',
  operate:   'text-gray-500',
  bkrOpen:   'text-green-700 font-semibold',
  bkrFail:   'text-red-700 font-bold',
  reset:     'text-blue-700',
  cleared:   'text-green-800 font-bold',
  tx:        'text-indigo-700',
  rx:        'text-indigo-700',
  blocked:   'text-indigo-800 font-semibold',
  channel:   'text-orange-700 font-semibold',
  uncleared: 'text-red-800 font-bold',
}

const VERDICT = {
  selective:       { label: 'Selective clearing',      style: 'bg-green-100 text-green-800 border-green-300' },
  tight:           { label: 'Cleared — tight margin',  style: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  backup:          { label: 'Cleared by backup',       style: 'bg-blue-100 text-blue-800 border-blue-300' },
  miscoordination: { label: 'Miscoordination',         style: 'bg-orange-100 text-orange-800 border-orange-300' },
  uncleared:       { label: 'Fault NOT cleared',       style: 'bg-red-100 text-red-800 border-red-300' },
}

const NOTE_STYLE = { info: 'text-gray-600', warn: 'text-yellow-700', bad: 'text-orange-700 font-medium' }

export function OutcomeCard({ outcome, revealed }) {
  const v = VERDICT[outcome.verdict]
  return (
    <div className="px-4 py-3 border-b border-gray-100">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-block rounded border px-2 py-0.5 text-xs font-bold ${revealed ? v.style : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
          {revealed ? v.label : 'Outcome — run or step to the end'}
        </span>
        {revealed && outcome.clearedAt !== null && (
          <span className="text-xs text-gray-500">cleared at {ms(outcome.clearedAt)}</span>
        )}
      </div>
      {revealed && outcome.notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {outcome.notes.map((n, i) => <li key={i} className={`text-xs ${NOTE_STYLE[n.level]}`}>• {n.text}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function EventLog({ events, eventIdx, onSelect }) {
  const activeRef = useRef(null)
  // Keep the current event visible by scrolling the log box only —
  // scrollIntoView would also scroll the page (jarring on phones).
  useEffect(() => {
    const el = activeRef.current
    const box = el?.closest('[data-scroll-box]')
    if (!box) return
    const top = el.offsetTop, bottom = top + el.offsetHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight
  }, [eventIdx])

  return (
    <ol className="text-xs">
      {events.map((e, i) => {
        const past = i <= eventIdx
        const current = past && (i === eventIdx || events[i].t === events[eventIdx].t)
        return (
          <li key={i} ref={i === eventIdx ? activeRef : null}
            onClick={() => onSelect(e.t)}
            className={`flex gap-2 px-4 py-1.5 border-b border-gray-50 cursor-pointer transition
              ${current ? 'bg-yellow-50' : 'hover:bg-gray-50'} ${past ? '' : 'opacity-35'}`}>
            <span className="font-mono text-gray-400 w-16 shrink-0 text-right">{ms(e.t)}</span>
            <span className={KIND_STYLE[e.kind] ?? ''}>{e.text}</span>
          </li>
        )
      })}
    </ol>
  )
}
