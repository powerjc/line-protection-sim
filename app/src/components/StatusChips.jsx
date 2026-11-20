import { LEVELS, levelOf } from '../lib/levels'
import { busDiffBlocker } from '../lib/features'

// What is switched on right now, always visible: the learner level, any
// feature beyond it, and the modules. Click any chip to open ⚙ Settings.
export const FEATURE_LABEL = {
  adjacent: 'Adjacent lines', pilot: 'Pilot schemes', sir: 'Source impedance', ground: 'Ground faults',
  rf: 'Fault resistance', infeed: 'Infeed', load: 'Prefault load', tap: 'Line tap', diff: '87L', busdiff: '87B',
}
const MODULES = ['diff', 'busdiff']

export default function StatusChips({ config, onOpenSettings }) {
  const f = config.features ?? {}
  const levelId = levelOf(f)
  const level = LEVELS.find(l => l.id === levelId)
  const implied = new Set(level?.features ?? [])
  const extras = Object.keys(FEATURE_LABEL).filter(k => !MODULES.includes(k) && f[k] && !implied.has(k))
  const modules = MODULES.filter(k => f[k])
  const chip = 'px-2 py-0.5 rounded-full border text-xs whitespace-nowrap hover:border-indigo-400'
  return (
    <div className="px-4 py-1.5 bg-white border-b border-gray-100 flex flex-wrap items-center gap-1.5" aria-label="What is switched on">
      <button onClick={onOpenSettings} className={`${chip} border-gray-300 text-gray-700`} title="Learner level (⚙ Settings)">
        Level: <span className="font-semibold">{level ? level.label : 'Custom'}</span>
      </button>
      {extras.map(k => (
        <button key={k} onClick={onOpenSettings} className={`${chip} border-gray-200 text-gray-600`} title="Feature on (⚙ Settings)">+ {FEATURE_LABEL[k]}</button>
      ))}
      {modules.map(k => (
        <button key={k} onClick={onOpenSettings} className={`${chip} border-violet-200 text-violet-700 bg-violet-50`} title="Module on (⚙ Settings → Modules)">
          {FEATURE_LABEL[k]}{k === 'busdiff' && busDiffBlocker(config) ? ' (not in force)' : ''}
        </button>
      ))}
    </div>
  )
}
