import { useEffect, useState } from 'react';
import { AudioWaveform, FlaskConical, Gauge, HeartPulse, LayoutDashboard, Link2, TrendingUp } from 'lucide-react';
import { LiveProvider, useLive } from './live.jsx';
import { CAR_INFO, carName } from './cars.js';
import PairDrawer from './components/PairDrawer.jsx';
import { LinkPill } from './components/LinkPill.jsx';
import Overview from './pages/Overview.jsx';
import HealthCheck from './pages/HealthCheck.jsx';
import LiveDrive from './pages/LiveDrive.jsx';
import Signatures from './pages/Signatures.jsx';
import Insights from './pages/Insights.jsx';
import Evidence from './pages/Evidence.jsx';

const PAGES = [
  { id: 'overview', name: 'Overview', icon: LayoutDashboard, title: 'Overview', sub: 'The paired car, live', live: true },
  { id: 'check', name: 'Health check', icon: HeartPulse, title: 'Health check', sub: 'Every subsystem, scanned from the live stream', live: true },
  { id: 'drive', name: 'Live drive', icon: Gauge, title: 'Live drive', sub: 'OBD-II telemetry with safety rules and guidance', live: true },
  { id: 'signatures', name: 'Signatures', icon: AudioWaveform, title: 'Signature lab', sub: 'The engine’s latest second in time, frequency and order', live: true },
  { id: 'insights', name: 'Insights', icon: TrendingUp, title: 'Insights', sub: "Learning a car's normal, and normal wear" },
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

/** Shown on live screens until a vehicle is streaming. */
function NoVehicle({ onPair }) {
  const { link, stale } = useLive();
  const waiting = ['connecting', 'lost'].includes(link.state) || stale;
  return (
    <div className="empty fade-in">
      <div className="empty-ico"><Link2 size={28} strokeWidth={1.5} /></div>
      <h2>{waiting ? 'Waiting for the vehicle…' : 'No vehicle paired'}</h2>
      <p className="note">
        {waiting
          ? `Trying ${link.host}:${link.port}. Check the vehicle laptop is running and on the same network.`
          : 'This laptop is the dashboard. Start run.bat on the vehicle laptop (role 1), then pair with the code it shows.'}
      </p>
      <button className="btn primary" onClick={onPair}><Link2 size={16} />{waiting ? 'Vehicle link' : 'Pair a vehicle'}</button>
    </div>
  );
}

function Shell() {
  const initial = new URLSearchParams(window.location.search).get('page');
  const [page, setPage] = useState(PAGES.some((p) => p.id === initial) ? initial : 'overview');
  const [drawer, setDrawer] = useState(false);
  const live = useLive();
  const { link, latest, ready } = live;
  const P = PAGES.find((p) => p.id === page);
  const v = latest?.vehicle || link.vehicle;

  useEffect(() => {                       // first visit with nothing paired: open the pairing drawer once
    if (ready && link.state === 'unpaired' && !sessionStorage.getItem('ap-paired-once')) {
      sessionStorage.setItem('ap-paired-once', '1');
      setDrawer(true);
    }
  }, [ready, link.state]);

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Logo />AutoPulse</div>
        <div className="brand-sub">DASHBOARD</div>
        <nav className="nav">
          {PAGES.map(({ id, name, icon: Icon }, i) => (
            <button key={id} className={page === id ? 'on' : ''} onClick={() => setPage(id)}>
              <Icon size={18} strokeWidth={1.7} />{name}<span className="hint">0{i + 1}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="eyebrow">Vehicle</div>
          <div className="scenario-line"><span>Car</span><b>{v ? `${carName(v.car_type)} · unit ${v.unit}` : '—'}</b></div>
          <div className="scenario-line"><span>Laptop</span><b>{v?.name || '—'}</b></div>
          <div className="scenario-line"><span>Address</span><b>{link.host ? `${link.host}:${link.port}` : '—'}</b></div>
          <div className="scenario-line"><span>Frames</span><b>{link.frames ?? 0}</b></div>
          <div className="scenario-line"><span>Latency</span><b>{live.live && link.latency_ms != null ? `${link.latency_ms} ms` : '—'}</b></div>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <div>
            <h1>{P.title}</h1>
            <div className="sub">{P.sub}</div>
          </div>
          <div className="top-actions">
            {v && <span className="chip" title={CAR_INFO[v.car_type]?.spec}>{carName(v.car_type)}<span className="muted">· unit {v.unit}</span></span>}
            <LinkPill onClick={() => setDrawer(true)} />
          </div>
        </header>
        <div className="content" key={page}>
          <div className="fade-in" style={{ height: page === 'overview' ? '100%' : 'auto' }}>
            {P.live && !latest ? <NoVehicle onPair={() => setDrawer(true)} /> : (
              <>
                {page === 'overview' && <Overview go={setPage} />}
                {page === 'check' && <HealthCheck />}
                {page === 'drive' && <LiveDrive />}
                {page === 'signatures' && <Signatures />}
                {page === 'insights' && <Insights />}
                {page === 'evidence' && <Evidence />}
              </>
            )}
          </div>
        </div>
      </main>
      {drawer && <PairDrawer onClose={() => setDrawer(false)} />}
    </div>
  );
}

export default function App() {
  return <LiveProvider><Shell /></LiveProvider>;
}
