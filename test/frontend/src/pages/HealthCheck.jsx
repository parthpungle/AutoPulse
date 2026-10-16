import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import Car3D from '../components/Car3D.jsx';
import { Ring, Status, StatusIcon, scoreStatus } from '../components/ui.jsx';
import { carName } from '../cars.js';
import { useLive } from '../live.jsx';

// What each check reads and how, so a click explains the verdict (shown under the list).
const EXPLAIN = {
  ecu: { streams: 'OBD-II services 03, 07, 0A (stored, pending, permanent codes) and Mode 06 self-tests', how: 'Reads the engine computer’s own fault memory.' },
  battery: { streams: 'Battery / system voltage (PID 42)', how: 'Running voltage should sit near 14 V; below 13 V for a while means the alternator is not charging.' },
  engine: { streams: 'Block accelerometer (24 kHz), crank speed at every firing', how: 'Every second: 28 signature features + spectrogram → SVM, Softmax, ANN and CNN vote, averaged over 5 s, and compared with this car’s own learned normal.' },
  cooling: { streams: 'Coolant temperature (PID 05)', how: 'Level and rate of rise against hard limits; a slow warm-up points to a stuck thermostat.' },
  oil: { streams: 'Oil pressure sensor', how: 'Pressure against engine speed and oil temperature; a floor that never adapts.' },
  fuel: { streams: 'Fuel trims (PIDs 06–09), fuel level vs fuel burned (2F, 5E)', how: 'Lean trims at idle point to a vacuum leak; a tank emptying faster than fuel is burned points to a leak.' },
  tyres: { streams: 'Tyre pressures (TPMS) or ABS wheel speeds', how: 'Absolute limits plus rate of loss: a puncture is caught by how fast pressure falls, before it is flat.' },
  brakes: { streams: 'Brake pressure and IMU deceleration', how: 'Deceleration per unit of brake pressure; falling effectiveness means worn pads or fluid.' },
};
const FOCUS = ['engine', 'battery', 'cooling', 'fuel', 'tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr'];

export default function HealthCheck() {
  const { latest } = useLive();
  const [step, setStep] = useState(0);            // how many checks are revealed (99 = all, then they stay live)
  const [sel, setSel] = useState(null);
  const timer = useRef(null);

  const run = () => {
    clearInterval(timer.current);
    setSel(null);
    setStep(0);
    timer.current = setInterval(() => setStep((s) => {
      if (s >= 8) { clearInterval(timer.current); return 99; }
      return s + 1;
    }), 380);
  };
  useEffect(() => { run(); return () => clearInterval(timer.current); }, []);

  const { systems: checks, zones: liveZones, score, verdict, vehicle: v } = latest;
  const revealed = step >= checks.length;
  const zones = revealed ? liveZones : Object.fromEntries(Object.keys(liveZones).map((k) => [k, 'ok']));
  const selected = checks.find((c) => c.id === sel);
  const focusZone = selected?.zones.find((z) => FOCUS.includes(z)) || null;
  const st = scoreStatus(score);

  return (
    <div className="grid2" style={{ gridTemplateColumns: '1.25fr 1fr', alignItems: 'start' }}>
      <div className="panel" style={{ overflow: 'hidden', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 18, top: 16, zIndex: 2 }}>
          <div className="eyebrow">X-ray view · drag to rotate</div>
          <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>{carName(v.car_type)} · unit {v.unit}</div>
        </div>
        <div style={{ position: 'absolute', right: 18, bottom: 16, zIndex: 2, display: 'flex', gap: 14 }}>
          {['ok', 'warning', 'critical'].map((x) => <Status key={x} status={x} />)}
        </div>
        <Car3D type={v.car_type} zones={zones} focus={focusZone} height="calc(100vh - 170px)" autoRotate={!focusZone} />
      </div>

      <div className="stack">
        <div className="panel panel-pad">
          <div className="ring-wrap">
            <Ring value={revealed ? score : 0} status={revealed ? st : 'muted'} />
            <div>
              <div className="kpi-label">Health score {revealed && <span className="live-tag">live</span>}</div>
              <div style={{ fontSize: 20, fontWeight: 600, margin: '4px 0 8px' }}>{revealed ? verdict : 'Scanning…'}</div>
              <button className="btn" onClick={run}>{revealed ? <RotateCcw size={15} /> : <Play size={15} />}{revealed ? 'Scan again' : 'Scanning'}</button>
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
              <div className="eyebrow accent">How this is checked</div>
              <div style={{ fontWeight: 600, fontSize: 16, margin: '6px 0 2px' }}>{selected.name}</div>
              <div className="note" style={{ marginBottom: 10 }}>{selected.detail}</div>
              <div className="kpi-label">Sensors</div>
              <div className="note" style={{ margin: '4px 0 10px' }}>{EXPLAIN[selected.id]?.streams}</div>
              <div className="kpi-label">Method</div>
              <div className="note" style={{ marginTop: 4 }}>{EXPLAIN[selected.id]?.how}</div>
            </>
          ) : (
            <div className="note">Select a check to see which sensors it reads and how the verdict is reached. The car turns to that part. Results keep updating every second.</div>
          )}
        </div>
      </div>
    </div>
  );
}
