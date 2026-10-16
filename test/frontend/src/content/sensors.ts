// The Sensor Array, in one place. Cards (3D), the left index, the detail panel, the screen-reader
// mirror and the shader colours all read from this array; nothing is written twice.
// Copy follows the phase-2 brief §4 verbatim (technically checked). Note: fuel trims are always
// written out as "short-term fuel trim", never abbreviated, so they can't be confused with the
// Short-Time Fourier Transform used elsewhere on the page.

export interface SensorField {
  label: string;
  text: string;
}

export interface SensorReveals {
  /** Fault chips in the detail panel. */
  chips: string[];
  /** The "Reveals" copy, verbatim, one entry per line. */
  lines: string[];
}

export interface Sensor {
  /** 0-based position in the array (also the shader's uSensor). */
  index: number;
  key: 'mic' | 'accel' | 'crank' | 'coolant' | 'throttle' | 'lambda' | 'current' | 'can';
  /** Mono code above the card title. */
  code: string;
  /** Full name (detail panel heading, screen readers). */
  title: string;
  /** The card title, one entry per line; drawn uppercase. */
  cardTitle: string[];
  /** Left index row label. */
  indexLabel: string;
  /** The one line on the card: what it hears. */
  oneLine: string;
  /** Detail fields in display order (Hears, Signal, Mounted, Signature we extract, Model, OBD-II PID...). */
  fields: SensorField[];
  reveals: SensorReveals;
  /** One-line live readout under the index. */
  readout: string;
  /** Sensor colour: card art, rim, stream particles, index underline. */
  color: string;
}

export const SENSORS: Sensor[] = [
  {
    index: 0,
    key: 'mic',
    code: 'SNS-01 · ACOUSTIC',
    title: 'Acoustic microphone',
    cardTitle: ['Acoustic', 'microphone'],
    indexLabel: 'Acoustic',
    oneLine: 'airborne engine sound near the block and head.',
    fields: [
      { label: 'Hears', text: 'airborne engine sound near the block and head.' },
      { label: 'Signal', text: 'pressure waveform, 44.1–48 kHz.' },
      { label: 'Mounted', text: 'close to the cylinder head / valve cover.' },
      {
        label: 'Signature we extract',
        text: 'STFT spectrogram, band energies, firing-frequency harmonics. Firing frequency, 4-stroke = RPM ÷ 60 × cylinders ÷ 2; a 4-cyl at 3000 RPM gives 100 Hz.',
      },
      { label: 'Model', text: 'spectrogram images → CNN.' },
    ],
    reveals: {
      chips: ['Knock', 'Misfire', 'Valve-train wear'],
      lines: [
        'Knock: short broadband bursts (≈5–15 kHz) locked to combustion events.',
        'Misfire: a missing pulse at the firing frequency.',
        'Valve-train wear: periodic ticking at camshaft rate.',
      ],
    },
    readout: 'Sampling 48 kHz · Signature STFT',
    color: '#8B7BFF',
  },
  {
    index: 1,
    key: 'accel',
    code: 'SNS-02 · VIBRATION',
    title: 'Accelerometer (knock sensor)',
    cardTitle: ['Accelerometer'],
    indexLabel: 'Vibration',
    oneLine: 'structural vibration of the block.',
    fields: [
      { label: 'Hears', text: 'structural vibration of the block.' },
      { label: 'Signal', text: 'acceleration in g, 10–50 kHz.' },
      { label: 'Mounted', text: 'bolted to the block between cylinders (piezoelectric).' },
      { label: 'Signature we extract', text: 'RMS, kurtosis, crest factor, band energy, order spectrum.' },
      { label: 'Model', text: 'feature vector → SVM / ANN.' },
    ],
    reveals: {
      chips: ['Knock', 'Imbalance', 'Bearing wear'],
      lines: ['knock resonance band;', 'imbalance at 1× / 2× crank order;', 'bearing wear as rising high-frequency energy.'],
    },
    readout: 'Sampling 10–50 kHz · Signature kurtosis',
    color: '#FF4FD8',
  },
  {
    index: 2,
    key: 'crank',
    code: 'SNS-03 · CRANK',
    title: 'Crankshaft position sensor',
    cardTitle: ['Crank', 'position'],
    indexLabel: 'Crank position',
    oneLine: 'the teeth of a 60-2 trigger wheel passing the tip.',
    fields: [
      { label: 'Hears', text: 'the teeth of a 60-2 trigger wheel passing the tip.' },
      { label: 'Signal', text: 'Hall-effect square pulses or variable-reluctance sine; gives RPM and crank angle.' },
      { label: 'Signature we extract', text: 'instantaneous angular speed, per-cylinder speed deltas.' },
      { label: 'OBD-II PID', text: '0x0C Engine RPM' },
    ],
    reveals: {
      chips: ['Misfire'],
      lines: ['misfire, as a momentary crank slow-down in instantaneous speed after a weak power stroke.'],
    },
    readout: '58 teeth / rev · Signature speed deltas',
    color: '#4FD1FF',
  },
  {
    index: 3,
    key: 'coolant',
    code: 'SNS-04 · COOLANT',
    title: 'Coolant temperature sensor',
    cardTitle: ['Coolant', 'temperature'],
    indexLabel: 'Coolant',
    oneLine: 'coolant temperature via an NTC thermistor.',
    fields: [
      { label: 'Hears', text: 'coolant temperature via an NTC thermistor.' },
      { label: 'Signal', text: 'slow, ~1 Hz.' },
      { label: 'OBD-II PID', text: '0x05' },
    ],
    reveals: {
      chips: ['Warm-up', 'Overheating'],
      lines: ['warm-up state and overheating. Mainly context: it sets what “normal” sounds like, since a cold engine sounds and vibrates differently.'],
    },
    readout: 'Sampling ~1 Hz · Role context',
    color: '#FF8A3D',
  },
  {
    index: 4,
    key: 'throttle',
    code: 'SNS-05 · THROTTLE',
    title: 'Throttle position sensor',
    cardTitle: ['Throttle', 'position'],
    indexLabel: 'Throttle',
    oneLine: 'butterfly opening, 0–100%.',
    fields: [
      { label: 'Hears', text: 'butterfly opening, 0–100%.' },
      { label: 'Signal', text: 'potentiometer / Hall voltage.' },
      { label: 'OBD-II PID', text: '0x11' },
    ],
    reveals: {
      chips: ['Load context', 'Knock gating'],
      lines: ['load context. A transient throttle snap is where knock is most likely, so TPS gates when to look hardest.'],
    },
    readout: 'Range 0–100% · Role load gate',
    color: '#7CFFB2',
  },
  {
    index: 5,
    key: 'lambda',
    code: 'SNS-06 · LAMBDA',
    title: 'Oxygen (lambda) sensor → fuel trims',
    cardTitle: ['Oxygen', 'lambda'],
    indexLabel: 'Lambda · trims',
    oneLine: 'oxygen left in the exhaust, turned into short-term and long-term fuel trims.',
    fields: [
      {
        label: 'Hears',
        text: 'oxygen left in the exhaust, which the ECU turns into short-term and long-term fuel trims (the ECU’s ± corrections to fuelling).',
      },
      { label: 'OBD-II PID', text: '0x06–0x09' },
    ],
    reveals: {
      chips: ['Lean misfire', 'Vacuum leak', 'Injector fault'],
      lines: ['lean misfire, vacuum leaks, injector faults; trims drifting persistently away from 0% are the red flag.'],
    },
    readout: 'PIDs 0x06–0x09 · Short-term fuel trim',
    color: '#FFD84F',
  },
  {
    index: 6,
    key: 'current',
    code: 'SNS-07 · CURRENT',
    title: 'Current clamp',
    cardTitle: ['Current', 'clamp'],
    indexLabel: 'Current',
    oneLine: 'electrical current in injector, ignition-coil or charging circuits.',
    fields: [
      {
        label: 'Hears',
        text: 'electrical current in injector, ignition-coil or charging circuits (Hall-effect clamp, non-intrusive).',
      },
      { label: 'Signature we extract', text: 'current waveform shape, peak/plateau timing, ripple frequency.' },
    ],
    reveals: {
      chips: ['Sticking injector', 'Coil / spark', 'Alternator ripple'],
      lines: ['an injector opening profile that changes with a sticking injector;', 'coil dwell/spark anomalies;', 'alternator ripple.'],
    },
    readout: 'Hall clamp · Signature waveform shape',
    color: '#5B8CFF',
  },
  {
    index: 7,
    key: 'can',
    code: 'SNS-08 · CAN',
    title: 'OBD-II port / CAN bus',
    cardTitle: ['OBD-II', 'CAN bus'],
    indexLabel: 'OBD-II / CAN',
    oneLine: 'the engine’s nervous system.',
    fields: [
      {
        label: 'What it is',
        text: 'the engine’s nervous system. The ECU publishes telemetry over CAN, and we poll the standard OBD-II PIDs (RPM, coolant, throttle, trims) via the 16-pin port.',
      },
      { label: 'Rates', text: 'high-speed CAN ~500 kbit/s; PIDs sampled ~1–10 Hz.' },
      {
        label: 'Role',
        text: 'TorqueTwin time-aligns these slow channels with the fast audio/vibration streams, so every sound frame knows the RPM, load and temperature it happened at.',
      },
    ],
    reveals: { chips: [], lines: [] },
    readout: 'CAN 500 kbit/s · PIDs 1–10 Hz',
    color: '#C0C6FF',
  },
];

export const SENSOR_COUNT = SENSORS.length;
