import { useState, useMemo } from 'react'
import { useCoordination, DEFAULT_SPEC } from './hooks/useCoordination'
import { coordinationConfig, defaultConfig } from './lib/schema'
import { LESSONS } from './lib/lessons'
import { LessonMenu, LessonCard, loadSeen, saveSeen } from './components/Lessons'
import { WelcomeCard } from './components/Welcome'
import { AUDIENCES, configForLevel, levelFeatures, loadLevelPref, saveLevelPref, loadAudiencePref, saveAudiencePref, loadWelcomed, saveWelcomed } from './lib/levels'
import { UnitsContext, loadUnitPref, saveUnitPref } from './lib/units'
import { useSimulation } from './hooks/useSimulation'
import RelayPanel, { k0Props, shapeProps } from './components/RelayPanel'
import ImpedancePlane from './components/ImpedancePlane'
import FaultResults from './components/FaultResults'
import DifferentialView from './components/DifferentialView'
import SettingsPanel from './components/SettingsPanel'
import CoordinationView from './components/CoordinationView'
import { activeZones } from './lib/protection'
import { ChannelSelect, SchemeSelect, FaultSpecPicker } from './components/ScenarioPanel'

const TABS = [
  { id: 'coord', label: 'Coordination' },
  { id: 'study', label: 'Fault Study' },
  { id: 'diff', label: 'Differential', feature: 'diff' },
]

export default function App() {
  const [tabRaw, setTab] = useState('coord')
  const [timeUnit, setTimeUnit] = useState(loadUnitPref)
  // Learner level: the remembered choice seeds the config at start and on Reset
  const [levelPref, setLevelPref] = useState(loadLevelPref)
  // Audience (welcome card): picks the starting point and switches the consequences module
  const [audience, setAudience] = useState(loadAudiencePref)
  const {
    config,
    results,
    selectedFaultId,
    setSelectedFaultId,
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
  } = useSimulation(() => configForLevel(levelPref, audience))
  const coordConfig = useMemo(() => coordinationConfig(config), [config])
  // A feature tab falls back to Coordination when its feature is switched off
  const tab = TABS.find(t => t.id === tabRaw && (!t.feature || config.features?.[t.feature])) ? tabRaw : 'coord'
  const coord = useCoordination(coordConfig)
  const pilotOn = !!config.features?.pilot
  const abScheme = pilotOn ? config.schemes.AB : 'step'

  function changeTimeUnit(u) { setTimeUnit(u); saveUnitPref(u) }
  function changeLevel(id) { setLevelPref(id); saveLevelPref(id); updateFeatures(levelFeatures(id)) }
  function changeAudience(id) { setAudience(id); saveAudiencePref(id); updateFeatures(AUDIENCES.find(a => a.id === id).features) }

  // ── First run ──
  const [welcome, setWelcome] = useState(() => !loadWelcomed())
  function closeWelcome() { setWelcome(false); saveWelcomed() }

  // ── Lessons ──
  const [lessonId, setLessonId] = useState(null)
  const [seen, setSeen] = useState(loadSeen)
  const lesson = LESSONS.find(l => l.id === lessonId)

  function startLesson(l) {
    const cfg = defaultConfig()
    l.setup?.(cfg)
    loadConfig(cfg)
    setTab(l.tab)
    if (l.tab === 'diff') {
      setStudySpec({ ...DEFAULT_SPEC, ...l.faultSpec })
    } else if (l.tab === 'study') {
      setSelectedFaultId(l.faultId ?? 'F3')
      setStudyChannel(l.studyChannel ?? 'ok')
      setStudySpec({ ...DEFAULT_SPEC, ...l.faultSpec })
    } else {
      coord.setFaultLoc(l.fault)
      coord.loadScenario(l.scenario ?? {})
      coord.setSpec({ ...DEFAULT_SPEC, ...l.faultSpec })
    }
    setLessonId(l.id)
    closeWelcome()
    const next = new Set(seen).add(l.id)
    setSeen(next)
    saveSeen(next)
  }
  const step = d => startLesson(LESSONS[LESSONS.indexOf(lesson) + d])

  return (
    <UnitsContext.Provider value={{ unit: timeUnit, freqHz: config.timing.freqHz }}>
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Line Protection Simulator</h1>
          <p className="text-xs text-gray-500 hidden sm:block">Distance &amp; differential protection training</p>
        </div>
        <nav className="order-last sm:order-none w-full sm:w-auto flex gap-1 bg-gray-100 rounded-lg p-1">
          {TABS.filter(t => !t.feature || config.features?.[t.feature]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 sm:flex-none px-3 py-1 text-sm font-semibold rounded-md transition
                ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
        <LessonMenu activeId={lessonId} seen={seen} onStart={startLesson}
          onWelcome={() => { setLessonId(null); setTab('coord'); setWelcome(true) }} />
        <SettingsPanel config={config} onLevel={changeLevel} onUpdateTap={updateTap} onUpdate={updateTopLevel} onUpdateTiming={updateTiming} onReset={resetConfig}
          onUpdateFeature={updateFeature} onUpdatePilot={updatePilot} onUpdateSir={updateSir} onUpdateBus={updateBus} onUpdateInfeed={updateInfeed}
          timeUnit={timeUnit} onTimeUnit={changeTimeUnit} />
        </div>
      </header>

      {!lesson && welcome && tab === 'coord' && (
        <WelcomeCard audience={audience} onAudience={changeAudience} onStartLesson={startLesson} onClose={closeWelcome} />
      )}

      {lesson && (
        <LessonCard key={lesson.id} lesson={lesson} onRestart={() => startLesson(lesson)}
          onPrev={() => step(-1)} onNext={() => step(1)} onClose={() => setLessonId(null)} />
      )}

      {tab === 'diff' ? (
        <DifferentialView config={config} spec={studySpec} onSpec={setStudySpec} onUpdateDiff={updateDiff} />
      ) : tab === 'coord' ? (
        <CoordinationView config={coordConfig} coord={coord}
          failuresHint={lesson?.tab === 'coord' && lesson.tryIt.some(t => t.includes('Failures')) ? lesson.id : null}
          onUpdateZone={updateZone} onUpdateLineLength={updateLineLength} onUpdateLine={updateLine} onUpdateRelay={updateRelay} onUpdateScheme={updateScheme} />
      ) : (
        <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 min-h-0">

          {/* Left: relay controls */}
          <aside className="lg:w-64 flex flex-col gap-6 bg-white rounded-xl border border-gray-200 p-4 shrink-0">
            <RelayPanel relayId="AB" zones={activeZones(config.relays.AB, config)} onUpdate={updateZone} title="Relay A (21-AB)" k0={k0Props(config, 'AB', updateRelay)} shape={shapeProps(config, 'AB', updateRelay)} />
            <hr className="border-gray-100" />
            <RelayPanel relayId="BA" zones={activeZones(config.relays.BA, config)} onUpdate={updateZone} title="Relay B (21-BA)" k0={k0Props(config, 'BA', updateRelay)} shape={shapeProps(config, 'BA', updateRelay)} />
            {pilotOn && (
              <>
                <hr className="border-gray-100" />
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-semibold text-gray-500 uppercase tracking-wider text-xs">Line A–B scheme</span>
                  <SchemeSelect value={config.schemes.AB} onChange={v => updateScheme('AB', v)} />
                </label>
              </>
            )}
          </aside>

          {/* Center: R-X plane */}
          <main className="flex-1 bg-white rounded-xl border border-gray-200 p-4 min-w-0">
            <ImpedancePlane config={config} selectedResult={selectedResult} />
          </main>

          {/* Right: results table */}
          <section className="lg:w-80 bg-white rounded-xl border border-gray-200 overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Fault Results</h2>
              <p className="text-xs text-gray-400">Click a row to highlight on the R-X plane</p>
              <div className="mt-2"><FaultSpecPicker config={config} spec={studySpec} onChange={setStudySpec} /></div>
              {abScheme !== 'step' && (
                <label className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-600">
                  <span>{abScheme} channel A–B</span>
                  <ChannelSelect value={studyChannel} onChange={setStudyChannel} />
                </label>
              )}
            </div>
            <FaultResults
              results={results}
              selectedFaultId={selectedFaultId}
              onSelectFault={setSelectedFaultId}
            />
          </section>
        </div>
      )}
    </div>
    </UnitsContext.Provider>
  )
}
