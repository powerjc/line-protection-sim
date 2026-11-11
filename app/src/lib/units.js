import { createContext, useContext } from 'react'

// Display units for relay time delays. Settings are stored in cycles
// (schema v3); simulation results are in seconds. This only changes how
// either is shown and entered.

export const UnitsContext = createContext({ unit: 'cyc', freqHz: 60 })

const trim = n => String(Math.round(n * 100) / 100)

export function makeUnits(unit, freqHz) {
  const cyc = unit === 'cyc'
  return {
    unit,
    freqHz,
    label: cyc ? 'cyc' : 's',
    step: cyc ? 0.5 : 0.05,
    max: cyc ? 5 * freqHz : 5,
    // stored setting (cycles) ⇄ display value
    cycToDisplay: c => (cyc ? c : c / freqHz),
    displayToCyc: v => (cyc ? v : v * freqHz),
    fmtCyc: c => (cyc ? `${trim(c)} cyc` : `${trim(c / freqHz)}s`),
    // simulation time (seconds) → display text
    fmt: s => (cyc ? `${trim(s * freqHz)} cyc` : `${trim(s)}s`),
  }
}

export function useUnits() {
  const { unit, freqHz } = useContext(UnitsContext)
  return makeUnits(unit, freqHz)
}

const KEY = 'lps.timeUnit'

export function loadUnitPref() {
  try { return localStorage.getItem(KEY) === 's' ? 's' : 'cyc' } catch { return 'cyc' }
}

export function saveUnitPref(unit) {
  try { localStorage.setItem(KEY, unit) } catch { /* storage unavailable — preference just isn't remembered */ }
}
