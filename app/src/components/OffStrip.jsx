// A panel that needs a setting which is off: shown as one line with what it
// would show, what it needs, and a button to turn it on (visible-but-off,
// instead of disappearing).
export default function OffStrip({ title, what, needs, onEnable, enableLabel = 'Turn on' }) {
  return (
    <section className="rounded-xl border border-dashed border-gray-300 bg-white/60 px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label={`${title} (off)`}>
      <span className="font-semibold text-gray-500">{title}</span>
      <span className="text-gray-400 flex-1 min-w-[12rem]">{what} Needs <span className="font-medium text-gray-600">{needs}</span>.</span>
      {onEnable && (
        <button onClick={onEnable} className="px-2 py-0.5 rounded border border-indigo-300 text-indigo-700 bg-white hover:border-indigo-500">{enableLabel}</button>
      )}
    </section>
  )
}
