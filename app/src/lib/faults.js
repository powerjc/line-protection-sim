// Fault Study test suite — locations on the network (see network.js).
export const FAULTS = [
  { id: 'F1', label: 'Bus A',             loc: { kind: 'bus', bus: 'A' },                description: 'Station A bus fault' },
  { id: 'F2', label: 'Close-in A',        loc: { kind: 'line', line: 'AB', frac: 0.05 }, description: '5% from Terminal A' },
  { id: 'F3', label: 'Midline',           loc: { kind: 'line', line: 'AB', frac: 0.50 }, description: '50% of line' },
  { id: 'F4', label: 'Close-in B',        loc: { kind: 'line', line: 'AB', frac: 0.95 }, description: '95% from Terminal A' },
  { id: 'F5', label: 'Bus B',             loc: { kind: 'bus', bus: 'B' },                description: 'Station B bus fault' },
  { id: 'F6', label: 'Adjacent beyond B', loc: { kind: 'line', line: 'BY', frac: 0.10 }, description: '10% into adjacent line B–Y' },
]
