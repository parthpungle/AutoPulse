import { Shuffle, X } from 'lucide-react';
import { ENGINE_FAULTS, OBD_FAULTS, useScenario } from '../scenario.jsx';

/** All scenario controls live here, out of the way of the screens themselves. */
export default function ScenarioDrawer({ onClose }) {
  const { s, set } = useScenario();
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Scenario">
        <div className="row">
          <div>
            <div className="eyebrow accent">Scenario</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>Inject conditions</div>
          </div>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="note" style={{ margin: 0 }}>
          The car is simulated. Choose what is wrong with it; every screen updates.
        </p>
        <label className="field">Engine condition (sound / vibration)
          <select value={s.engine_fault} onChange={(e) => set({ engine_fault: e.target.value })}>
            {ENGINE_FAULTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="row">Fault severity<span className="spacer" /><span className="val">{s.severity.toFixed(2)}</span></span>
          <input type="range" min="0.2" max="1" step="0.05" value={s.severity}
            onChange={(e) => set({ severity: +e.target.value })} />
        </label>
        <label className="field">Vehicle condition (OBD / chassis)
          <select value={s.obd_fault} onChange={(e) => set({ obd_fault: e.target.value })}>
            {OBD_FAULTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="row">Ambient temperature<span className="spacer" /><span className="val">{s.ambient} °C</span></span>
          <input type="range" min="-5" max="45" step="1" value={s.ambient}
            onChange={(e) => set({ ambient: +e.target.value })} />
        </label>
        <label className="field">Unit (models never trained on 8 and 9)
          <select value={s.unit} onChange={(e) => set({ unit: +e.target.value })}>
            {[...Array(10).keys()].map((u) => <option key={u} value={u}>Unit {u}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => set({ seed: Math.floor(Math.random() * 1e9) })}>
          <Shuffle size={16} />New random sample
        </button>
        <div className="spacer" />
        <button className="btn ghost" onClick={() => set({ engine_fault: 'healthy', obd_fault: 'none', severity: 0.8, ambient: 24 })}>
          Reset to a healthy car
        </button>
      </aside>
    </>
  );
}
