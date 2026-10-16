// Vehicle control panel: this laptop is the car. Pick the car, drive it, break it.
// Everything here goes to the vehicle node (vehicle/node.py) through /vapi; the dashboard
// laptop only ever sees the sensor stream, never what was injected.
import { useEffect, useRef, useState } from 'react';
import { Activity, Gauge, OctagonAlert, Power, Radio, RotateCcw, TriangleAlert, Wrench, Zap } from 'lucide-react';
import Car3D from '../components/Car3D.jsx';
import CarSelect from '../components/CarSelect.jsx';
import { Tabs } from '../components/ui.jsx';

const SEVERE_ENGINE = ['misfire', 'knock'];
const OBD_ZONE = {          // where each breakdown lives on the car, and how bad it is
  coolant_leak: [['cooling'], 'critical'], thermostat_stuck: [['cooling'], 'warning'],
  alternator_failure: [['battery'], 'warning'], belt_broken: [['battery', 'cooling'], 'critical'],
  puncture: [['tyre_fl'], 'critical'], slow_leak: [['tyre_rr'], 'warning'], vacuum_leak: [['fuel'], 'warning'],
  low_oil_pressure: [['engine'], 'critical'], fuel_leak: [['fuel'], 'critical'],
};

async function call(path, body) {
  const r = await fetch('/vapi' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function useVehicle() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const refresh = () => call('/state').then((d) => { setS(d); setErr(null); }, (e) => setErr(e));
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 700);
    return () => clearInterval(id);
  }, []);
  const act = (path, body) => call(path, body).then(refresh);
  return { s, err, act };
}

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="#7fd4ff" strokeWidth="1.5" />
      <path d="M3.5 12h4l2-5 3 10 2.2-7 1.3 2H20.5" fill="none" stroke="#f2f4f6" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function VehicleApp() {
  const { s, err, act } = useVehicle();
  if (!s) {
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <div className="empty-ico"><Radio size={28} strokeWidth={1.5} /></div>
        <h2>{err ? 'Vehicle node not running' : 'Connecting to the vehicle node…'}</h2>
        <p className="note">{err ? 'Start split\\run.bat and choose role 1 (Vehicle) or 3 (Both). This page talks to port 8200.' : ''}</p>
      </div>
    );
  }
  const o = s.obd || {};
  const zones = {};
  if (s.truth.engine_fault !== 'healthy') zones.engine = SEVERE_ENGINE.includes(s.truth.engine_fault) ? 'critical' : 'warning';
  s.truth.obd_faults.forEach(({ id }) => {
    const [zs, sev] = OBD_ZONE[id] || [[], 'warning'];
    zs.forEach((z) => { if (zones[z] !== 'critical') zones[z] = sev; });
  });
  const active = new Set(s.truth.obd_faults.map((f) => f.id));
  const broken = s.truth.engine_fault !== 'healthy' || active.size > 0;

  return (
    <div className="veh">
      <header className="veh-top">
        <div className="brand"><Logo />AutoPulse <span className="veh-role">Vehicle</span></div>
        <div className="muted" style={{ fontSize: 13 }}>This laptop is the car. Sensors stream to the paired dashboard.</div>
        <div className="spacer" />
        <div className="veh-pair">
          <div><div className="kpi-label">Address</div><code>{s.ip}:{s.port}</code></div>
          <div><div className="kpi-label">Pairing code</div><code className="big-code">{s.code}</code></div>
          <div className={`link-pill ${s.clients.length ? 'good' : 'muted'}`}>
            <Radio size={15} className={s.clients.length ? 'pulse-ico' : ''} />
            {s.clients.length ? `${s.clients.length} dashboard${s.clients.length > 1 ? 's' : ''} paired` : 'No dashboard yet'}
          </div>
        </div>
      </header>

      <div className="veh-grid">
        {/* ---------------- the car */}
        <section className="panel veh-car">
          <div className="veh-car-head">
            <CarSelect value={s.car_type} onChange={(id) => act('/control', { car_type: id })} />
            <label className="field" style={{ width: 120 }}>
              <select value={s.unit} onChange={(e) => act('/control', { unit: +e.target.value })} aria-label="Unit">
                {[...Array(10).keys()].map((u) => <option key={u} value={u}>Unit {u}</option>)}
              </select>
            </label>
          </div>
          <div className="veh-car-3d">
            <Car3D type={s.car_type} zones={zones} distance={1.05} />
            <div className="veh-truth">
              <div className="eyebrow">{broken ? 'What is really broken' : 'Nothing broken'}</div>
              <div className="muted" style={{ fontSize: 12 }}>Only this laptop knows. The dashboard has to find it.</div>
            </div>
          </div>
          <div className="veh-drive">
            <button className={`ignition ${s.ignition ? 'on' : ''}`} onClick={() => act('/control', { ignition: !s.ignition })}>
              <Power size={22} /><span>{s.ignition ? 'Stop engine' : 'Start engine'}</span>
            </button>
            <div className="stack" style={{ gap: 12, flex: 1 }}>
              <div className="row">
                <span className="kpi-label">Driving</span><div className="spacer" />
                <Tabs value={s.mode} onChange={(m) => act('/control', { mode: m })} items={s.options.modes.map((m) => [m.id, m.label.split(',')[0]])} />
              </div>
              <label className="field">
                <span className="row">Outside temperature<span className="spacer" /><span className="val">{fmt(s.ambient)} °C</span></span>
                <input type="range" min="-5" max="45" step="1" defaultValue={s.ambient}
                  onPointerUp={(e) => act('/control', { ambient: +e.target.value })} onKeyUp={(e) => act('/control', { ambient: +e.target.value })} />
              </label>
            </div>
          </div>
        </section>

        {/* ---------------- what the sensors are sending */}
        <section className="panel panel-pad veh-sensors">
          <div className="row"><Activity size={16} color="var(--accent)" /><div className="eyebrow">Sensors transmitting</div>
            <div className="spacer" /><span className="muted" style={{ fontSize: 12 }}>{s.ignition ? `trip ${mmss(s.trip_s)}` : 'engine off'}</span></div>
          <div className="cluster">
            <div className="cl big"><span>{fmt(o.speed_kph)}</span><small>km/h</small></div>
            <div className="cl big"><span>{fmt(o.rpm)}</span><small>rpm</small></div>
            <div className="cl"><b>{fmt(o.coolant_c)}</b><small>coolant °C</small></div>
            <div className="cl"><b>{fmt(o.oil_pressure_bar, 1)}</b><small>oil bar</small></div>
            <div className="cl"><b>{fmt(o.battery_v, 1)}</b><small>battery V</small></div>
            <div className="cl"><b>{fmt(o.fuel_level_pct, 1)}</b><small>fuel %</small></div>
            <div className="cl"><b>{fmt(o.ltft_pct, 0)}</b><small>fuel trim %</small></div>
            <div className="cl"><b>{fmt(o.engine_load, 0)}</b><small>load %</small></div>
            <div className="cl"><b>{fmt(o.throttle_pct, 0)}</b><small>throttle %</small></div>
            <div className="cl"><b>{fmt(o.fuel_rate_lph, 1)}</b><small>fuel use L/h</small></div>
          </div>
          <div className="tyres">
            {[['tyre_fl_psi', 'FL'], ['tyre_fr_psi', 'FR'], ['tyre_rl_psi', 'RL'], ['tyre_rr_psi', 'RR']].map(([k, l]) => (
              <div key={k} className={o[k] != null && o[k] < 29 ? 'low' : ''}><small>{l}</small><b>{fmt(o[k])}</b><small>psi</small></div>
            ))}
          </div>
          <div className="streams">
            <div className="stream"><Gauge size={15} /><div><b>OBD-II bus</b><small>19 values · 1 Hz</small></div><span className={`dot ${s.ignition || o.t != null ? 'on' : ''}`} /></div>
            <div className="stream"><Zap size={15} /><div><b>Block accelerometer</b><small>24 000 samples/s · int16</small></div><span className={`dot ${s.ignition ? 'on' : ''}`} /></div>
            <div className="stream"><RotateCcw size={15} /><div><b>Crank position</b><small>speed at every firing</small></div><span className={`dot ${s.ignition ? 'on' : ''}`} /></div>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {s.stats.frames} frames · {s.stats.kb_sent} kB sent · {s.stats.kbps} kB/s now
          </div>
        </section>

        {/* ---------------- breakdowns */}
        <section className="panel panel-pad veh-faults">
          <div className="row"><Wrench size={16} color="var(--accent)" /><div className="eyebrow">Simulate a breakdown</div><div className="spacer" />
            <button className="btn ghost" disabled={!broken} onClick={() => act('/repair', { fault: 'all' })}>Repair all</button></div>

          <div className="kpi-label" style={{ marginTop: 4 }}>Engine (heard by the vibration sensor)</div>
          <div className="fault-grid">
            {s.options.engine_faults.map((f) => (
              <button key={f.id} className={`fault ${s.truth.engine_fault === f.id ? 'on' : ''} ${f.id === 'healthy' ? 'healthy' : ''}`}
                onClick={() => act('/inject', { fault: f.id })}>
                {f.label.split(' (')[0]}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="row">Severity<span className="spacer" /><span className="val">{s.severity.toFixed(2)}</span></span>
            <input type="range" min="0.2" max="1" step="0.05" defaultValue={s.severity}
              onPointerUp={(e) => act('/control', { severity: +e.target.value })} onKeyUp={(e) => act('/control', { severity: +e.target.value })} />
          </label>

          <div className="kpi-label" style={{ marginTop: 6 }}>Vehicle (read over OBD-II)</div>
          <div className="obd-list">
            {s.options.obd_faults.map((f) => {
              const on = active.has(f.id);
              const since = s.truth.obd_faults.find((x) => x.id === f.id)?.since_s;
              const sev = OBD_ZONE[f.id]?.[1];
              return (
                <button key={f.id} className={`obd ${on ? 'on' : ''}`} onClick={() => act(on ? '/repair' : '/inject', { fault: f.id })}>
                  {sev === 'critical' ? <OctagonAlert size={15} /> : <TriangleAlert size={15} />}
                  <span>{f.label}</span>
                  <span className="spacer" />
                  <small>{on ? `${mmss(Math.max(0, since))} · repair` : 'inject'}</small>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---------------- console */}
        <section className="panel veh-console">
          <div className="row" style={{ padding: '12px 16px 0' }}><div className="eyebrow">Console</div><div className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>{s.name}</span></div>
          <Console lines={s.log} />
        </section>
      </div>
    </div>
  );
}

function Console({ lines }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [lines.length, lines[lines.length - 1]?.msg]);
  return (
    <div className="console" ref={ref}>
      {lines.map((l, i) => (
        <div key={i} className={`ln k-${l.kind}`}><span className="t">{l.time}</span>{l.msg}</div>
      ))}
    </div>
  );
}
