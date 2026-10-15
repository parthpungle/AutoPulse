import { useCallback, useState } from 'react';
import { AudioWaveform, Car, FlaskConical, Gauge, HeartPulse, Printer, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { CAR_INFO, ENGINE_FAULTS, OBD_FAULTS, ScenarioProvider, label, useScenario } from './scenario.jsx';
import ScenarioDrawer from './components/ScenarioDrawer.jsx';
import Report from './components/Report.jsx';
import Garage from './pages/Garage.jsx';
import HealthCheck from './pages/HealthCheck.jsx';
import LiveDrive from './pages/LiveDrive.jsx';
import Signatures from './pages/Signatures.jsx';
import Insights from './pages/Insights.jsx';
import Evidence from './pages/Evidence.jsx';

const PAGES = [
  { id: 'garage', name: 'Garage', icon: Car, title: 'Garage', sub: 'Pick a car and see its health at a glance' },
  { id: 'check', name: 'Health check', icon: HeartPulse, title: 'Pre-drive health check', sub: 'Key-on scan of every subsystem' },
  { id: 'drive', name: 'Live drive', icon: Gauge, title: 'Live drive', sub: 'OBD-II telemetry with safety rules and guidance' },
  { id: 'signatures', name: 'Signatures', icon: AudioWaveform, title: 'Signature lab', sub: 'Engine vibration in time, frequency and order' },
  { id: 'insights', name: 'Insights', icon: TrendingUp, title: 'Insights', sub: "Learning this car's normal, and normal wear" },
  { id: 'evidence', name: 'Evidence', icon: FlaskConical, title: 'Evidence', sub: 'Real-data, MATLAB and Simulink results' },
];

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="#FF8A4C" strokeWidth="1.6" />
      <path d="M3.5 12h4l2-5 3 10 2.2-7 1.3 2H20.5" fill="none" stroke="#F4F1EC" strokeWidth="1.7"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Shell() {
  const initial = new URLSearchParams(window.location.search).get('page');
  const [page, setPage] = useState(PAGES.some((p) => p.id === initial) ? initial : 'garage');
  const [drawer, setDrawer] = useState(false);
  const [report, setReport] = useState(() => new URLSearchParams(window.location.search).has('report'));
  const { s, activeFaults } = useScenario();
  const P = PAGES.find((p) => p.id === page);
  const go = (id) => setPage(id);
  const closeReport = useCallback(() => setReport(false), []);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Logo />AutoPulse</div>
        <div className="brand-sub">PREDICTIVE VEHICLE HEALTH</div>
        <nav className="nav">
          {PAGES.map(({ id, name, icon: Icon }, i) => (
            <button key={id} className={page === id ? 'on' : ''} onClick={() => go(id)}>
              <Icon size={18} strokeWidth={1.7} />{name}<span className="hint">0{i + 1}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="eyebrow">Scenario</div>
          <div className="scenario-line"><span>Car</span><b>{CAR_INFO[s.car_type].name} · unit {s.unit}</b></div>
          <div className="scenario-line"><span>Engine</span><b>{label(ENGINE_FAULTS, s.engine_fault)}</b></div>
          <div className="scenario-line"><span>Vehicle</span><b>{label(OBD_FAULTS, s.obd_fault)}</b></div>
          <div className="scenario-line"><span>Ambient</span><b>{s.ambient} °C</b></div>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <div>
            <h1>{P.title}</h1>
            <div className="sub">{P.sub}</div>
          </div>
          <div className="top-actions">
            <button className="chip" onClick={() => go('garage')} title="Change car">
              <Car size={16} strokeWidth={1.7} color="var(--accent)" />{CAR_INFO[s.car_type].name}
            </button>
            <button className="btn" onClick={() => setReport(true)} title="Printable health report for this car">
              <Printer size={16} />Report
            </button>
            <button className="btn" onClick={() => setDrawer(true)}>
              <SlidersHorizontal size={16} />Scenario{activeFaults > 0 && <span className="badge">{activeFaults}</span>}
            </button>
          </div>
        </header>
        <div className="content" key={page}>
          <div className="fade-in" style={{ height: page === 'garage' ? '100%' : 'auto' }}>
            {page === 'garage' && <Garage go={go} openScenario={() => setDrawer(true)} />}
            {page === 'check' && <HealthCheck />}
            {page === 'drive' && <LiveDrive />}
            {page === 'signatures' && <Signatures />}
            {page === 'insights' && <Insights />}
            {page === 'evidence' && <Evidence />}
          </div>
        </div>
      </main>
      {drawer && <ScenarioDrawer onClose={() => setDrawer(false)} />}
      {report && <Report onClose={closeReport} />}
    </div>
  );
}

export default function App() {
  return <ScenarioProvider><Shell /></ScenarioProvider>;
}
