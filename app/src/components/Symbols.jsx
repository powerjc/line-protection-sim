// ANSI-style one-line symbols (as on US utility one-lines and AC schematics), in SVG.
//
// CT: a half-loop on the conductor, on the side its secondary leads leave,
// with polarity marks: one on the primary (conductor) side and one on the
// secondary lead. Current entering the marked primary side leaves the marked
// secondary lead. Which way the primary mark faces is what makes "forward":
//   line relay CTs: mark toward the bus → current from the bus into the line is positive
//   87B CTs:        mark toward the line → current into the bus is positive
// A polarity error is usually not the CT but its leads swapped at a terminal
// block: <TerminalBlock crossed /> draws that, with the CT itself drawn correctly.

const DOT = 2.6

// x, y: where the CT sits on the conductor
// orient: 'h' (horizontal conductor) | 'v' (vertical conductor)
// side:   +1 / −1 — the side the half-loop and secondary leave on (+y for 'h', +x for 'v')
// dot:    +1 / −1 — which way along the conductor the primary polarity mark faces (+x for 'h', +y for 'v')
export function CtSymbol({ x, y, orient = 'h', side = 1, dot = -1, r = 8, color = '#111827', strokeWidth = 2 }) {
  if (orient === 'h') {
    return (
      <g>
        <path d={`M ${x - r} ${y} A ${r} ${r} 0 0 ${side > 0 ? 0 : 1} ${x + r} ${y}`} fill="none" stroke={color} strokeWidth={strokeWidth} />
        <circle cx={x + dot * (r + 3)} cy={y - side * 5} r={DOT} fill={color} />
        <circle cx={x + dot * 5} cy={y + side * (r + 5)} r={DOT} fill={color} />
      </g>
    )
  }
  return (
    <g>
      <path d={`M ${x} ${y - r} A ${r} ${r} 0 0 ${side > 0 ? 1 : 0} ${x} ${y + r}`} fill="none" stroke={color} strokeWidth={strokeWidth} />
      <circle cx={x - side * 5} cy={y + dot * (r + 3)} r={DOT} fill={color} />
      <circle cx={x + side * (r + 5)} cy={y + dot * 5} r={DOT} fill={color} />
    </g>
  )
}
// Where a CtSymbol's secondary lead starts
export const ctLead = ({ x, y, orient = 'h', side = 1, r = 8 }) => (orient === 'h' ? [x, y + side * r] : [x + side * r, y])

// VT hanging below a tap: primary winding (bumps down), secondary (bumps up). No polarity
// marks: on one-lines they matter for the CT's direction, not the VT's.
// x, y: top of the primary winding. Its secondary lead leaves from (x, y + 14).
export function VtSymbol({ x, y, color = '#111827', strokeWidth = 2 }) {
  const coil = (yy, up) => `M ${x - 9} ${yy} a 3 3 0 0 ${up ? 1 : 0} 6 0 a 3 3 0 0 ${up ? 1 : 0} 6 0 a 3 3 0 0 ${up ? 1 : 0} 6 0`
  return (
    <g>
      <path d={coil(y, false)} fill="none" stroke={color} strokeWidth={strokeWidth} />
      <path d={coil(y + 10, true)} fill="none" stroke={color} strokeWidth={strokeWidth} />
      <line x1={x} y1={y + 10} x2={x} y2={y + 14} stroke={color} strokeWidth={1.5} />
    </g>
  )
}

// A two-wire terminal block on a CT secondary run. The pair enters at (x, y) and
// leaves at (x + 24, y) for 'h' (or (x, y + 24) for 'v'); crossed = leads swapped.
export function TerminalBlock({ x, y, orient = 'h', crossed = false, color = '#6b7280', bad = '#dc2626' }) {
  const g = 3 // half the gap between the two wires
  const c = crossed ? bad : color
  if (orient === 'h') {
    return (
      <g>
        <line x1={x} y1={y - g} x2={x + 7} y2={y - g} stroke={color} />
        <line x1={x} y1={y + g} x2={x + 7} y2={y + g} stroke={color} />
        <rect x={x + 7} y={y - g - 3} width={9} height={2 * g + 6} rx={1.5} fill="#fff" stroke={c} />
        <line x1={x + 16} y1={y - g} x2={x + 24} y2={crossed ? y + g : y - g} stroke={c} strokeWidth={crossed ? 1.6 : 1} />
        <line x1={x + 16} y1={y + g} x2={x + 24} y2={crossed ? y - g : y + g} stroke={c} strokeWidth={crossed ? 1.6 : 1} />
      </g>
    )
  }
  return (
    <g>
      <line x1={x - g} y1={y} x2={x - g} y2={y + 7} stroke={color} />
      <line x1={x + g} y1={y} x2={x + g} y2={y + 7} stroke={color} />
      <rect x={x - g - 3} y={y + 7} width={2 * g + 6} height={9} rx={1.5} fill="#fff" stroke={c} />
      <line x1={x - g} y1={y + 16} x2={crossed ? x + g : x - g} y2={y + 24} stroke={c} strokeWidth={crossed ? 1.6 : 1} />
      <line x1={x + g} y1={y + 16} x2={crossed ? x - g : x + g} y2={y + 24} stroke={c} strokeWidth={crossed ? 1.6 : 1} />
    </g>
  )
}
