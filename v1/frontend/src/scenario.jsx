// The car under test and the conditions injected into it, shared by every screen.
import { createContext, useContext, useMemo, useState } from 'react';

export const CAR_INFO = {
  hatchback: { name: 'Hatchback', spec: '1.2 L petrol · city car' },
  sedan: { name: 'Sedan', spec: '1.5 L petrol · family saloon' },
  suv: { name: 'SUV', spec: '2.0 L · seven-seater' },
  pickup: { name: 'Pickup', spec: '2.4 L · utility' },
  coupe: { name: 'Sports coupe', spec: '2.0 L turbo · two-door' },
};

export const ENGINE_FAULTS = [
  ['healthy', 'Healthy'], ['misfire', 'Misfire'], ['knock', 'Knock / detonation'],
  ['valve_tick', 'Valve train wear'], ['bearing', 'Accessory bearing fault'],
  ['belt_squeal', 'Belt slip / squeal'], ['imbalance', 'Imbalance / engine mount'],
];

export const OBD_FAULTS = [
  ['none', 'No fault'], ['coolant_leak', 'Coolant leak'], ['thermostat_stuck', 'Thermostat stuck open'],
  ['alternator_failure', 'Alternator not charging'], ['belt_broken', 'Serpentine belt broken'],
  ['puncture', 'Tyre puncture (front-left)'], ['slow_leak', 'Slow tyre leak (rear-right)'],
  ['vacuum_leak', 'Intake vacuum leak'], ['low_oil_pressure', 'Low oil pressure'], ['fuel_leak', 'Fuel leak'],
];

const Ctx = createContext(null);

export function ScenarioProvider({ children }) {
  const q = new URLSearchParams(window.location.search);
  const [s, setS] = useState({
    car_type: q.get('car') || 'sedan',
    unit: 8,
    engine_fault: q.get('engine') || 'healthy',
    severity: 0.8,
    obd_fault: q.get('obd') || 'none',
    ambient: 24,
    seed: 42,
  });
  const value = useMemo(() => ({
    s,
    set: (patch) => setS((prev) => ({ ...prev, ...patch })),
    activeFaults: (s.engine_fault !== 'healthy') + (s.obd_fault !== 'none'),
  }), [s]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useScenario = () => useContext(Ctx);
export const label = (list, id) => (list.find(([k]) => k === id) || [id, id])[1];
