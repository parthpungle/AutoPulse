import { useEffect, useState } from 'react';
import { AudioWaveform, ChevronRight, FlaskConical, Gauge, HeartPulse, LayoutDashboard, Link2, Moon, Sun, TrendingUp } from 'lucide-react';
import { setTheme, useTheme } from './theme.js';
import { LiveProvider, useLive } from './live.jsx';
import { CAR_INFO, carName } from './cars.js';
import PairDrawer from './components/PairDrawer.jsx';
import { LinkButton } from './components/LinkPill.jsx';
import { AlarmShape, PRIORITY, prio } from './components/hmi.jsx';
import Ask from './assistant/Ask.jsx';
import { spotlight } from './assistant/nav.js';
import Overview from './pages/Overview.jsx';
import HealthCheck from './pages/HealthCheck.jsx';
import LiveDrive from './pages/LiveDrive.jsx';
import Signatures from './pages/Signatures.jsx';
import Insights from './pages/Insights.jsx';
import Evidence from './pages/Evidence.jsx';

const PAGES = [
  { id: 'overview', name: 'Cockpit', icon: LayoutDashboard, live: true },
  { id: 'check', name: 'Health check', icon: HeartPulse, live: true },
  { id: 'drive', name: 'Live drive', icon: Gauge, live: true },
  { id: 'signatures', name: 'Signature lab', icon: AudioWaveform, live: true },
  { id: 'insights', name: 'Insights', icon: TrendingUp },
  { id: 'evidence', name: 'Evidence', icon: FlaskConical },
];

/** Light for bright rooms and projectors, dark for screens. Remembered in this browser. */
function ThemeToggle() {
  const theme = useTheme();
  const light = theme === 'light';
  return (
    <button className="ask-trigger" aria-pressed={light} onClick={() => setTheme(light ? 'dark' : 'light')}
      title={light ? 'Switch to the dark theme' : 'Switch to the light theme (bright rooms, projectors)'}
      aria-label={light ? 'Dark theme' : 'Light theme'}>
      {light ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}

function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="AutoPulse">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M3.5 12h4l2-5 3 10 2.2-7 1.3 2H20.5" fill="none" stroke="var(--text-max)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
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
      <h2>{waiting ? 'Waiting for the vehicle…' : 'No vehicle connected'}</h2>
      <p className="note">
        {waiting
          ? `Trying ${link.host}:${link.port}. Check the vehicle laptop is running and on the same network.`
          : 'This laptop is the dashboard. Start the vehicle laptop (run.bat or run.command, role 1), then connect with the code it shows.'}
      </p>
      <button className="btn primary" onClick={onPair}><Link2 size={15} />{waiting ? 'Vehicle link' : 'Connect a vehicle'}</button>
    </div>
  );
}

// single-screen views fit the window exactly and never scroll
const FIT = new Set(['overview', 'check', 'insights']);

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Shell() {
  const initial = new URLSearchParams(window.location.search).get('page');
  const [page, setPage] = useState(PAGES.some((p) => p.id === initial) ? initial : 'overview');
  const [drawer, setDrawer] = useState(false);
  const [acked, setAcked] = useState(() => new Set());
  const live = useLive();
  const { link, latest, ready } = live;
  const P = PAGES.find((p) => p.id === page);
  const v = latest?.vehicle || link.vehicle;
  const top = latest?.alerts?.find((a) => a.severity !== 'info');
  const topP = top ? prio(top.severity) : null;

  useEffect(() => {                       // Ask AutoPulse: go to the screen that holds the answer, then spotlight it
    const on = (e) => {
      const { page: to, spot, action } = e.detail;
      if (action === 'pair') setDrawer(true);
      if (to) setPage(to);
      if (spot) setTimeout(() => spotlight(spot), to && to !== page ? 380 : 60);
    };
    window.addEventListener('autopulse:goto', on);
    return () => window.removeEventListener('autopulse:goto', on);
  }, [page]);

  useEffect(() => {                       // first visit with nothing paired: open the pairing drawer once
    if (ready && link.state === 'unpaired' && !sessionStorage.getItem('ap-paired-once')) {
      sessionStorage.setItem('ap-paired-once', '1');
      setDrawer(true);
    }
  }, [ready, link.state]);

  return (
    <div className={`shell ${FIT.has(page) ? 'fit-page' : ''}`}>
      <aside className="rail">
        <div className="rail-logo"><Logo /></div>
        <nav aria-label="Screens">
          {PAGES.map(({ id, name, icon: Icon }, i) => (
            <button key={id} className={page === id ? 'on' : ''} onClick={() => setPage(id)} aria-label={name}
              aria-current={page === id ? 'page' : undefined}>
              <Icon size={21} strokeWidth={1.6} />
              <span className="tip">{name} · {i + 1}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">v2</div>
      </aside>

      <header className="statusbar">
        <span className="brandmark">AutoPulse</span>
        <ChevronRight size={14} className="crumb" />
        <span className="page-title">{P.name}</span>
        <span className="sep" />
        {v ? (
          <>
            <span className="kv" title={CAR_INFO[v.car_type]?.spec}><b className="car">{carName(v.car_type)}</b><span className="muted">unit {v.unit}</span></span>
            {latest && <span className="kv"><span className="label">Trip</span><b>{latest.row.ignition ? mmss(latest.row.t) : 'engine off'}</b></span>}
          </>
        ) : <span className="label">No vehicle</span>}
        <div className="right">
          <Ask page={page} />
          <ThemeToggle />
          <LinkButton onClick={() => setDrawer(true)} />
        </div>
      </header>

      {top && (
        <div className="banner" style={{ '--c': PRIORITY[topP].color }} role="alert">
          <AlarmShape priority={topP} size={18} flash={!acked.has(top.title)} />
          <b>{top.title}</b>
          <span className="act">{top.actions?.[0]}</span>
          <span className="ack row" style={{ gap: 10 }}>
            <span className="ack-state">{acked.has(top.title) ? 'ACKNOWLEDGED' : 'UNACKNOWLEDGED'}</span>
            {!acked.has(top.title) && <button className="btn primary" onClick={() => setAcked((s) => new Set(s).add(top.title))}>Acknowledge</button>}
            <button className="btn ghost" onClick={() => setPage('drive')}>Guidance</button>
          </span>
        </div>
      )}

      <main className="main">
        <div className={`content ${FIT.has(page) ? 'fit' : ''}`} key={page}>
          <div className="fade-in" style={FIT.has(page) ? { height: '100%' } : undefined}>
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
