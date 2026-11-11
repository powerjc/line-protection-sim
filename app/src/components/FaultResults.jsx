import { useUnits } from '../lib/units'

const ASSESSMENT_STYLE = {
  'Correct trip':    'bg-green-100 text-green-800',
  'Correct no-op':   'bg-gray-100 text-gray-600',
  'Underreach':      'bg-red-100 text-red-800',
  'Overreach':       'bg-orange-100 text-orange-800',
  'Overreach (Z1)':  'bg-orange-100 text-orange-800',
  'Backup (Z2)':     'bg-blue-100 text-blue-700',
  'Coordination failure': 'bg-red-100 text-red-800',
  'Pilot overtrip':  'bg-red-100 text-red-800',
  'No operation':    'bg-gray-100 text-gray-500',
  'Unknown':         'bg-gray-100 text-gray-400',
}

// Time-domain behaviour with pilot schemes on: which logic tripped first, or blocked
function PilotLine({ pilot, units }) {
  let text, style
  if (pilot.logic && pilot.logic !== 'step') { text = `${pilot.logic} trip · ${units.fmt(pilot.t)}`; style = 'text-indigo-700 font-semibold' }
  else if (pilot.blocked) { text = 'DCB blocked'; style = 'text-gray-500' }
  else if (pilot.logic === 'step') { text = `Step Z${pilot.zoneId} · ${units.fmt(pilot.t)}`; style = 'text-gray-500' }
  else return null
  return <div className={`text-xs mt-0.5 ${style}`}>⚡ {text}</div>
}

function Cell({ result }) {
  const units = useUnits()
  if (!result) return <td className="px-3 py-2 text-gray-300 text-sm">—</td>

  const { zones, tripTime, assessment } = result
  const asserted = zones.filter(z => z.asserted)
  const style = ASSESSMENT_STYLE[assessment] ?? 'bg-gray-100 text-gray-500'

  return (
    <td className="px-3 py-2 align-top">
      <div className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${style}`}>
        {assessment}
      </div>
      {asserted.length > 0 && (
        <div className="text-xs text-gray-500 mt-0.5">
          {asserted.map(z => z.label).join(', ')}
          {tripTime !== null && <>{' · '}{tripTime === 0 ? 'Inst.' : units.fmt(tripTime)}</>}
        </div>
      )}
      {result.pilot && <PilotLine pilot={result.pilot} units={units} />}
    </td>
  )
}

export default function FaultResults({ results, selectedFaultId, onSelectFault }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-40">
              Fault
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-blue-600 uppercase tracking-wider">
              Relay A
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-purple-600 uppercase tracking-wider">
              Relay B
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map(({ fault, A, B }) => (
            <tr
              key={fault.id}
              onClick={() => onSelectFault(fault.id)}
              className={`border-b border-gray-100 cursor-pointer transition
                ${fault.id === selectedFaultId
                  ? 'bg-yellow-50 border-yellow-200'
                  : 'hover:bg-gray-50'}`}
            >
              <td className="px-3 py-2 font-medium text-gray-800">
                <span className="text-xs text-gray-400 mr-1">{fault.id}</span>
                {fault.label}
                <div className="text-xs text-gray-400 font-normal">{fault.description}</div>
              </td>
              <Cell result={A} />
              <Cell result={B} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
