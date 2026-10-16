// The Sensor Array, in one place. Cards (3D), the left index, the expanded card, the
// screen-reader mirror and the shader colours all read from this array; nothing is written twice.
//
// Three levels of disclosure ("less on the page, more on click"):
//   level 0, the card while scrolling: code, title, `hearsShort` (no units, at most ~12 words)
//   level 1, the expanded card: `plainSentence`, a live trace, `catches`
//   level 2, "Technical details": `technical`, the original checked copy (brief §4), verbatim.
// Fuel trims are always written out as "short-term fuel trim", never abbreviated, so they can't be
// confused with the Short-Time Fourier Transform used elsewhere on the page.

export interface SensorField {
  label: string;
  text: string;
}

export interface Sensor {
  /** 0-based position in the array (also the shader's uSensor). */
  index: number;
  key: 'mic' | 'accel' | 'crank' | 'coolant' | 'throttle' | 'lambda' | 'current' | 'can';
  /** Mono code on the card. */
  code: string;
  /** Full name, no parentheticals (expanded card heading, screen readers). */
  title: string;
  /** The card title, one entry per line; drawn uppercase. */
  cardTitle: string[];
  /** Left index row label. */
  indexLabel: string;
  /** Level 0: what it hears, in a few plain words. */
  hearsShort: string;
  /** Level 1: what it is and why it matters, one plain sentence (25 words at most). */
  plainSentence: string;
  /** Level 1: fault chips. */
  catches: string[];
  /** Level 2: every technical field. */
  technical: SensorField[];
  /** Sensor colour: card art, rim, flows, index underline. */
  color: string;
}

export const SENSORS: Sensor[] = [
  {
    index: 0,
    key: 'mic',
    code: 'SNS-01',
    title: 'Acoustic microphone',
    cardTitle: ['Acoustic', 'microphone'],
    indexLabel: 'Acoustic',
    hearsShort: "Hears the engine's sound.",
    plainSentence: 'A microphone near the cylinder head. Knock, misfire and worn valves each change how an engine sounds, and this is where we hear it.',
    catches: ['Knock', 'Misfire', 'Valve-train wear'],
    technical: [
      { label: 'Hears', text: 'airborne engine sound near the block and head.' },
      { label: 'Signal', text: 'pressure waveform, 44.1–48 kHz.' },
      { label: 'Mounted', text: 'close to the cylinder head / valve cover.' },
      {
        label: 'Reveals',
        text: 'Knock: short broadband bursts (≈5–15 kHz) locked to combustion events. Misfire: a missing pulse at the firing frequency. Valve-train wear: periodic ticking at camshaft rate.',
      },
      {
        label: 'Signature we extract',
        text: 'STFT spectrogram, band energies, firing-frequency harmonics. Firing frequency, 4-stroke = RPM ÷ 60 × cylinders ÷ 2; a 4-cyl at 3000 RPM gives 100 Hz.',
      },
      { label: 'Model', text: 'spectrogram images → CNN.' },
      { label: 'Sample rate', text: '44.1–48 kHz' },
    ],
    color: '#8B7BFF',
  },
  {
    index: 1,
    key: 'accel',
    code: 'SNS-02',
    title: 'Accelerometer',
    cardTitle: ['Accelerometer'],
    indexLabel: 'Vibration',
    hearsShort: 'Feels the block shake.',
    plainSentence: 'A piezo sensor bolted to the engine block. When combustion goes wrong, the metal rings at tell-tale frequencies, and this is where we catch it.',
    catches: ['Knock', 'Imbalance', 'Bearing wear'],
    technical: [
      { label: 'Hears', text: 'structural vibration of the block.' },
      { label: 'Signal', text: 'acceleration in g, 10–50 kHz.' },
      { label: 'Mounted', text: 'bolted to the block between cylinders (piezoelectric).' },
      { label: 'Reveals', text: 'knock resonance band; imbalance at 1× / 2× crank order; bearing wear as rising high-frequency energy.' },
      { label: 'Signature we extract', text: 'RMS, kurtosis, crest factor, band energy, order spectrum.' },
      { label: 'Model', text: 'feature vector → SVM / ANN.' },
      { label: 'Sample rate', text: '10–50 kHz' },
    ],
    color: '#FF4FD8',
  },
  {
    index: 2,
    key: 'crank',
    code: 'SNS-03',
    title: 'Crankshaft position sensor',
    cardTitle: ['Crank', 'position'],
    indexLabel: 'Crank position',
    hearsShort: 'Counts every tooth of the crank.',
    plainSentence: 'It reads the 60-2 toothed wheel on the crankshaft. A weak power stroke briefly slows the crank, and that is how misfires show up.',
    catches: ['Misfire'],
    technical: [
      { label: 'Hears', text: 'the teeth of a 60-2 trigger wheel passing the tip.' },
      { label: 'Signal', text: 'Hall-effect square pulses or variable-reluctance sine; gives RPM and crank angle.' },
      { label: 'Reveals', text: 'misfire, as a momentary crank slow-down in instantaneous speed after a weak power stroke.' },
      { label: 'Signature we extract', text: 'instantaneous angular speed, per-cylinder speed deltas.' },
      { label: 'OBD-II PID', text: '0x0C Engine RPM' },
    ],
    color: '#4FD1FF',
  },
  {
    index: 3,
    key: 'coolant',
    code: 'SNS-04',
    title: 'Coolant temperature sensor',
    cardTitle: ['Coolant', 'temperature'],
    indexLabel: 'Coolant',
    hearsShort: 'Knows how hot it runs.',
    plainSentence: 'A thermistor in the coolant. A cold engine sounds and vibrates differently, so temperature tells us what normal should sound like.',
    catches: ['Warm-up', 'Overheating'],
    technical: [
      { label: 'Hears', text: 'coolant temperature via an NTC thermistor.' },
      { label: 'Signal', text: 'slow, ~1 Hz.' },
      {
        label: 'Reveals',
        text: 'warm-up state and overheating. Mainly context: it sets what “normal” sounds like, since a cold engine sounds and vibrates differently.',
      },
      { label: 'OBD-II PID', text: '0x05' },
      { label: 'Sample rate', text: '~1 Hz' },
    ],
    color: '#FF8A3D',
  },
  {
    index: 4,
    key: 'throttle',
    code: 'SNS-05',
    title: 'Throttle position sensor',
    cardTitle: ['Throttle', 'position'],
    indexLabel: 'Throttle',
    hearsShort: 'Knows how hard you push.',
    plainSentence: 'It reads how far the throttle is open. A sudden snap is when knock is most likely, so it tells us when to listen hardest.',
    catches: ['Load context', 'Knock timing'],
    technical: [
      { label: 'Hears', text: 'butterfly opening, 0–100%.' },
      { label: 'Signal', text: 'potentiometer / Hall voltage.' },
      { label: 'Reveals', text: 'load context. A transient throttle snap is where knock is most likely, so TPS gates when to look hardest.' },
      { label: 'OBD-II PID', text: '0x11' },
    ],
    color: '#7CFFB2',
  },
  {
    index: 5,
    key: 'lambda',
    code: 'SNS-06',
    title: 'Oxygen sensor → fuel trims',
    cardTitle: ['Oxygen', 'sensor'],
    indexLabel: 'Lambda · trims',
    hearsShort: 'Tastes the exhaust.',
    plainSentence: 'An oxygen sensor in the exhaust. The ECU turns its reading into fuel trims, and trims drifting away from zero point to leaks or misfires.',
    catches: ['Lean misfire', 'Vacuum leak', 'Injector fault'],
    technical: [
      {
        label: 'Hears',
        text: 'oxygen left in the exhaust, which the ECU turns into short-term and long-term fuel trims (the ECU’s ± corrections to fuelling).',
      },
      { label: 'Reveals', text: 'lean misfire, vacuum leaks, injector faults; trims drifting persistently away from 0% are the red flag.' },
      { label: 'OBD-II PID', text: '0x06–0x09' },
    ],
    color: '#FFD84F',
  },
  {
    index: 6,
    key: 'current',
    code: 'SNS-07',
    title: 'Current clamp',
    cardTitle: ['Current', 'clamp'],
    indexLabel: 'Current',
    hearsShort: 'Watches the electrical pulses.',
    plainSentence: 'A clamp around a wire that measures current without cutting in. Sticking injectors, weak coils and alternator faults all change the waveform.',
    catches: ['Sticking injector', 'Coil / spark', 'Alternator ripple'],
    technical: [
      {
        label: 'Hears',
        text: 'electrical current in injector, ignition-coil or charging circuits (Hall-effect clamp, non-intrusive).',
      },
      { label: 'Reveals', text: 'an injector opening profile that changes with a sticking injector; coil dwell/spark anomalies; alternator ripple.' },
      { label: 'Signature we extract', text: 'current waveform shape, peak/plateau timing, ripple frequency.' },
    ],
    color: '#5B8CFF',
  },
  {
    index: 7,
    key: 'can',
    code: 'SNS-08',
    title: 'OBD-II port / CAN bus',
    cardTitle: ['OBD-II', 'CAN bus'],
    indexLabel: 'OBD-II / CAN',
    hearsShort: 'Where all the data meets.',
    plainSentence: 'The car’s own data network. We read RPM, temperature, throttle and trims here, and line them up with every sound and vibration sample.',
    catches: [],
    technical: [
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
    color: '#C0C6FF',
  },
];

export const SENSOR_COUNT = SENSORS.length;
