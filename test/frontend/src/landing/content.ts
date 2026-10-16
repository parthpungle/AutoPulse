// All landing-page copy in one place. Numbers come from the TorqueTwin pipeline (autopulse/ and the
// README results table); keep them in sync if the pipeline changes.

export const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || '/dashboard';

/** Placeholders: fill in before publishing. */
export const TEAM_NAME = 'Team name';
export const GITHUB_URL = 'https://github.com/';
export const EVENT = 'HackHive 2026';

export const HERO = {
  eyebrow: 'TorqueTwin · engine signature recognition',
  title: ['Engines speak', 'before they fail.'],
  sub: 'TorqueTwin listens to an engine through its sound, its vibration and its OBD-II data, turns each into a frequency signature, and recognises knock, misfire and valve wear before they become breakdowns.',
  primary: 'Launch dashboard',
  secondary: 'How it works',
};

export const SENSOR_ARRAY = {
  eyebrow: '01 / Sensor array',
  title: 'What each sensor hears.',
};

export const SIGNATURES = {
  eyebrow: '02 / Signatures',
  title: 'Raw signal in. Fingerprint out.',
  body: 'Faults leave marks in frequency that the raw waveform hides. Four steps turn eight channels into one fingerprint.',
  /** The four stages of the pipeline, in order: a label for the stepper, one line and one stat. */
  stages: [
    { key: 'ingest', label: 'Ingest', line: 'Eight channels come in and are lined up in time, using the CAN timestamps.', stat: { value: '8 channels', label: 'time-aligned · 24 kHz audio' } },
    { key: 'window', label: 'Window', line: 'Each second is cut into 512-sample frames, every one overlapping the last by half.', stat: { value: '512 · 50%', label: 'frame · overlap' } },
    { key: 'transform', label: 'Transform', line: 'A short-time Fourier transform shows where the energy sits in frequency and time. Knock lights up one band.', stat: { value: '5.5–8 kHz', label: 'knock band' } },
    { key: 'fingerprint', label: 'Fingerprint', line: 'Each window is boiled down to one list of features, the fingerprint the models read.', stat: { value: '28', label: 'features per window' } },
  ],
};

export const STATE_KEYS = ['healthy', 'knock', 'misfire', 'valve'] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export const RECOGNITION = {
  eyebrow: '03 / Recognition',
  title: 'Four states, told apart.',
  hint: 'Pick a state. Every scene on this page reacts.',
  states: {
    healthy: { label: 'Healthy', text: 'Even firing, steady harmonics at the engine orders, fuel trims near zero.' },
    knock: { label: 'Knock', text: 'Sharp bursts in the 5.5–8 kHz band right after each firing; the band’s kurtosis jumps.' },
    misfire: { label: 'Misfire', text: 'A combustion pulse goes missing every few cycles; half-order energy rises and crank speed dips.' },
    valve: { label: 'Valve wear', text: 'A tick at camshaft rate; the envelope spectrum shows the repetition and the noise floor creeps up.' },
  } satisfies Record<StateKey, { label: string; text: string }>,
  models: 'SVM · Softmax · ANN · CNN vote on every window',
  // placeholder until the team confirms the number for the landing page
  stat: { value: '{{MODEL_ACCURACY}}', label: 'held-out accuracy' },
};

export const CTA = {
  eyebrow: '04 / Action',
  title: ['See it on a', 'live engine.'],
  sub: 'The dashboard pairs with a running vehicle and diagnoses it from sensor data alone.',
  button: 'Launch dashboard',
};

export const NAV_LABELS = ['Intro', 'Sensor array', 'Signatures', 'Recognition', 'Launch'];
