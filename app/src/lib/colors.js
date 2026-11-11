// Per-relay colors shared by the one-line, time-distance diagram, and panels.
export const RELAY_COLOR = {
  XA: '#0d9488', // teal
  AX: '#ca8a04', // yellow
  AB: '#2563eb', // blue  (Relay A)
  BA: '#9333ea', // purple (Relay B)
  BY: '#16a34a', // green
  YB: '#db2777', // pink
}

export const relayColor = id => RELAY_COLOR[id] ?? '#6b7280'
