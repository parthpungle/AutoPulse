import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { useApi } from '../api.js';
import Car3D from '../components/Car3D.jsx';
import { Ring, Status, StatusIcon, scoreStatus } from '../components/ui.jsx';
import { CAR_INFO, useScenario } from '../scenario.jsx';

// What each check reads and how, so a click explains the verdict (shown under the list).
const EXPLAIN = {
  ecu: { streams: 'OBD-II services 03, 07, 0A (stored, pending, permanent codes) and Mode 06 self-tests', how: 'Reads the engine computer’s own fault memory at key-on.' },
  battery: { streams: 'Battery voltage (PID 42) and cranking current', how: 'Depth and recovery of the voltage dip while the starter turns; each compression stroke shows as a current hump.' },
  engine: { streams: 'Block accelerometer, engine-bay microphone, crank speed', how: 'A 1-second cold-start window → 28 signature features + spectrogram → SVM, Softmax, ANN and CNN vote.' },
  cooling: { streams: 'Coolant temperature (PID 05)', how: 'Warm-up curve and rate of rise compared with this car’s own normal.' },
  oil: { streams: 'Oil pressure sensor', how: 'Pressure against engine speed and oil temperature; a floor that never adapts.' },
  fuel: { streams: 'Fuel trims (PIDs 06–09), fuel level vs fuel burned (2F, 5E), EVAP pressure', how: 'Lean trims at idle point to a vacuum leak; a tank emptying faster than fuel is burned points to a leak.' },
  tyres: { streams: 'ABS wheel speeds or valve-cap TPMS', how: 'An under-inflated tyre has a smaller rolling radius, so it spins faster than the other three.' },
  brakes: { streams: 'Brake pressure and phone/IMU deceleration', how: 'Deceleration per unit of brake pressure; falling effectiveness means worn pads or fluid.' },
};

export default function HealthCheck() {
  const { s } = useScenario();
  const { data } = useApi('/startup', s);
  const [step, setStep] = useState(99);          // how many checks are revealed (99 = all)
  const [sel, setSel] = useState(null);
  const timer = useRef(null);

  const run = () => {
    clearInterval(timer.current);
    setSel(null);
    setStep(0);
    timer.current = setInterval(() => setStep((v) => {
      if (v >= 8) { clearInterval(timer.current); return 99; }
      return v + 1;
    }), 420);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => { run(); }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const checks = data?.checks || [];
  const revealed = step >= checks.length;
  const zones = revealed && data ? data.zones : Object.fromEntries(Object.keys(data?.zones || {}).map((k) => [k, 'ok']));
  const selected = checks.find((c) => c.id === sel);
  const focusZone = selected && ['engine', 'battery', 'cooling', 'fuel', 'tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'].includes(selected.zone)
    ? selected.zone : null;
  const st = data ? scoreStatus(data.score) : 'pending';

  return (
    <div className="grid2" style={{ gridTemplateColumns: '1.25fr 1fr', alignItems: 'start' }}>
      <div className="panel" style={{ overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 18, top: 16, zIndex: 2 }}>
          <div className="eyebrow">X-ray view · drag to rotate</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>{CAR_INFO[s.car_type].name} · unit {s.unit}</div>
        </div>
        <div style={{ position: 'absolute', right: 18, bottom: 16, zIndex: 2, display: 'flex', gap: 14 }}>
          {['ok', 'warning', 'critical'].map((x) => <Status key={x} status={x} />)}
        </div>
        <Car3D type={s.car_type} mode="xray" zones={zones} focus={focusZone} height="calc(100vh - 170px)" autoRotate={!focusZone} />
      </div>

      <div className="stack">
        <div className="panel panel-pad">
          <div className="ring-wrap">
            <Ring value={revealed && data ? data.score : 0} status={revealed ? st : 'muted'} />
            <div>
              <div className="kpi-label">Health score</div>
              <div style={{ fontSize: 20, fontWeight: 600, margin: '4px 0 8px' }}>{revealed ? data?.verdict : 'Scanning…'}</div>
              <button className="btn" onClick={run}>{revealed ? <RotateCcw size={15} /> : <Play size={15} />}{revealed ? 'Run again' : 'Running'}</button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: '6px 10px' }}>
          <div className="check-list">
            {checks.map((c, i) => {
              const status = i < step ? c.status : i === step ? 'checking' : 'pending';
              return (
                <button key={c.id} className={`check ${sel === c.id ? 'on' : ''}`} onClick={() => setSel(sel === c.id ? null : c.id)}
                  disabled={i >= step}>
                  <StatusIcon status={status} />
                  <div>
                    <div className="n">{c.name}</div>
                    <div className="d">{i < step ? c.detail : status === 'checking' ? 'Checking…' : '—'}</div>
                  </div>
                  <Status status={status} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel panel-pad fade-in" key={sel || 'none'}>
          {selected ? (
            <>
              <div className="eyebrow accent">How this was checked</div>
              <div style={{ fontWeight: 600, fontSize: 16, margin: '6px 0 2px' }}>{selected.name}</div>
              <div className="note" style={{ marginBottom: 10 }}>{selected.detail}</div>
              <div className="kpi-label">Sensors</div>
              <div className="note" style={{ margin: '4px 0 10px' }}>{EXPLAIN[selected.id]?.streams}</div>
              <div className="kpi-label">Method</div>
              <div className="note" style={{ marginTop: 4 }}>{EXPLAIN[selected.id]?.how}</div>
            </>
          ) : (
            <div className="note">Select a check to see which sensors it reads and how the verdict was reached. The car turns to that part.</div>
          )}
        </div>
      </div>
    </div>
  );
}
