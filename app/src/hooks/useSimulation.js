import { useState, useMemo } from 'react'
import { defaultConfig } from '../lib/schema'
import { FAULTS } from '../lib/faults'
import { runSimulation } from '../lib/study'
import { DEFAULT_SPEC } from './useCoordination'

// baseConfig: () => config used at start and by Reset (defaults + the learner level)
export function useSimulation(baseConfig = defaultConfig) {
  const [config, setConfig] = useState(baseConfig)
  const [selectedFaultId, setSelectedFaultId] = useState('F3')
  // Fault Study channel condition for the base line's pilot scheme
  const [studyChannel, setStudyChannel] = useState('ok')
  // Fault Study fault type + resistance, applied to the whole suite
  const [studySpec, setStudySpec] = useState(DEFAULT_SPEC)

  const results = useMemo(
    () => runSimulation(FAULTS, config, { channels: { AB: studyChannel } }, studySpec),
    [config, studyChannel, studySpec]
  )

  const selectedFault = FAULTS.find(f => f.id === selectedFaultId)
  const selectedResult = results.find(r => r.fault.id === selectedFaultId)

  function updateZone(relayId, zoneId, field, value) {
    setConfig(prev => ({
      ...prev,
      relays: {
        ...prev.relays,
        [relayId]: {
          ...prev.relays[relayId],
          zones: prev.relays[relayId].zones.map(z =>
            z.id === zoneId ? { ...z, [field]: value } : z
          ),
        },
      },
    }))
  }

  function updateLineLength(lineId, length) {
    setConfig(prev => ({
      ...prev,
      network: {
        ...prev.network,
        lines: prev.network.lines.map(l => (l.id === lineId ? { ...l, length } : l)),
      },
    }))
  }

  function updateTiming(field, value) {
    setConfig(prev => ({ ...prev, timing: { ...prev.timing, [field]: value } }))
  }

  function updateFeature(name, on) {
    setConfig(prev => ({ ...prev, features: { ...prev.features, [name]: on } }))
  }

  function updateLine(lineId, field, value) {
    setConfig(prev => ({
      ...prev,
      network: { ...prev.network, lines: prev.network.lines.map(l => (l.id === lineId ? { ...l, [field]: value } : l)) },
    }))
  }

  // Relay-level settings: k0 (null = auto, number = magnitude override), shape ('mho' | 'quad')
  function updateRelay(relayId, field, value) {
    setConfig(prev => ({ ...prev, relays: { ...prev.relays, [relayId]: { ...prev.relays[relayId], [field]: value } } }))
  }

  // Infeed at an intermediate bus; a stiff (SIR 0) infeed would hold the bus
  // at 1 pu and starve the upstream line, so switching one on starts at SIR 1
  function updateInfeed(busId, on) {
    setConfig(prev => ({
      ...prev,
      network: {
        ...prev.network,
        buses: prev.network.buses.map(b => (b.id === busId ? { ...b, infeed: on, sir: on && !(b.sir > 0) ? 1 : b.sir } : b)),
      },
    }))
  }

  function updateDiff(field, value) {
    setConfig(prev => ({ ...prev, diff: { ...prev.diff, [field]: value } }))
  }

  function updateBus(busId, field, value) {
    setConfig(prev => ({
      ...prev,
      network: { ...prev.network, buses: prev.network.buses.map(b => (b.id === busId ? { ...b, [field]: value } : b)) },
    }))
  }

  function updateSir(busId, sir) {
    setConfig(prev => ({
      ...prev,
      network: { ...prev.network, buses: prev.network.buses.map(b => (b.id === busId ? { ...b, sir } : b)) },
    }))
  }

  function updateScheme(lineId, scheme) {
    setConfig(prev => ({ ...prev, schemes: { ...prev.schemes, [lineId]: scheme } }))
  }

  function updatePilot(field, value) {
    setConfig(prev => ({ ...prev, pilot: { ...prev.pilot, [field]: value } }))
  }

  function updateTopLevel(field, value) {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  function resetConfig() {
    setConfig(baseConfig())
  }

  // Line tap settings (line A–B)
  function updateTap(field, value) {
    setConfig(prev => ({
      ...prev,
      network: { ...prev.network, lines: prev.network.lines.map(l => (l.tap ? { ...l, tap: { ...l.tap, [field]: value } } : l)) },
    }))
  }

  // Switch a group of features at once (learner levels)
  function updateFeatures(features) {
    setConfig(prev => ({ ...prev, features: { ...prev.features, ...features } }))
  }

  // Replace the whole config (lessons)
  function loadConfig(cfg) {
    setConfig(cfg)
  }

  return {
    config,
    results,
    selectedFaultId,
    setSelectedFaultId,
    selectedFault,
    selectedResult,
    updateZone,
    updateLineLength,
    updateTiming,
    updateFeature,
    updateFeatures,
    updateTap,
    updateScheme,
    updatePilot,
    updateSir,
    updateBus,
    updateDiff,
    updateInfeed,
    updateLine,
    updateRelay,
    studySpec,
    setStudySpec,
    studyChannel,
    setStudyChannel,
    updateTopLevel,
    resetConfig,
    loadConfig,
  }
}
