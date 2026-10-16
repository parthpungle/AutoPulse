import { ChevronRight, HeartPulse } from 'lucide-react';
import { useApi } from '../api.js';
import Car3D, { CarThumb } from '../components/Car3D.jsx';
import { Status, StatusIcon, scoreStatus } from '../components/ui.jsx';
import { CAR_INFO, useScenario } from '../scenario.jsx';

export default function Garage({ go, openScenario }) {
  const { s, set } = useScenario();
  const { data } = useApi('/startup', s);
  const issues = data ? data.checks.filter((c) => c.status !== 'ok') : [];
  const st = data ? scoreStatus(data.score) : 'pending';
  const facts = issues.length ? issues : (data?.checks || []).slice(0, 5);

  return (
    <div className="garage">
      <div className="stage">
        <div className="stage-info">
          <div className="eyebrow accent">Your car</div>
          <h2>{CAR_INFO[s.car_type].name}</h2>
          <div className="ink2">{CAR_INFO[s.car_type].spec}</div>
          <div className="muted" style={{ fontSize: 13 }}>Unit {s.unit}</div>

          <div className="stage-score">
            <span className="big" style={{ color: `var(--${st === 'ok' ? 'good' : st === 'pending' ? 'muted' : st})` }}>
              {data ? data.score : '—'}
            </span>
            <div>
              <div className="kpi-label">Health score</div>
              {data && <div style={{ marginTop: 4 }}><Status status={st} /></div>}
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 15 }}>{data?.verdict}</div>
          <div className="row" style={{ marginTop: 20 }}>
            <button className="btn primary" onClick={() => go('check')}><HeartPulse size={16} />Run health check</button>
            <button className="btn ghost" onClick={openScenario}>Scenario</button>
          </div>
        </div>

        <div className="stage-mid" />
        <div className="stage-car">
          <Car3D type={s.car_type} mode="showroom" zones={data?.zones} distance={0.98} />
        </div>

        <div className="stage-facts">
          <div className="eyebrow">{issues.length ? `${issues.length} need attention` : 'All systems normal'}</div>
          {facts.map((c) => (
            <button key={c.id} className="fact" onClick={() => go('check')} style={{ textAlign: 'left', color: 'inherit' }}>
              <StatusIcon status={c.status} />
              <div>
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{c.detail}</div>
              </div>
              <span className="spacer" /><ChevronRight size={15} color="var(--muted)" />
            </button>
          ))}
        </div>
      </div>

      <div className="picker" role="radiogroup" aria-label="Car type">
        {Object.entries(CAR_INFO).map(([id, c]) => (
          <button key={id} role="radio" aria-checked={s.car_type === id} className={`pick ${s.car_type === id ? 'on' : ''}`}
            onClick={() => set({ car_type: id })}>
            <div className="pick-3d"><CarThumb type={id} /></div>
            <div className="name">{c.name}</div>
            <div className="spec">{c.spec}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
