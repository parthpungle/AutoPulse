// All landing-page copy in one place. Numbers come from the AutoTwin pipeline (autopulse/ and the
// README results table); keep them in sync if the pipeline changes.

export const DASHBOARD_URL = import.meta.env.VITE_DASHBOARD_URL || '/dashboard';

/** Placeholders: fill in before publishing. */
export const TEAM_NAME = 'Team name';
export const GITHUB_URL = 'https://github.com/';
export const EVENT = 'HackHive 2026';

export const HERO = {
  eyebrow: 'AutoTwin · engine signature recognition',
  title: ['Engines speak', 'before they fail.'],
  sub: 'AutoTwin listens to an engine through its sound, its vibration and its OBD-II data, turns each into a frequency signature, and recognises knock, misfire and valve wear before they become breakdowns.',
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
  body: 'A short-time Fourier transform cuts every one-second window into overlapping frames and maps where the energy sits in frequency and time. Faults leave marks there that the raw waveform hides: a ringing band, a missing harmonic, a comb of ticks.',
  stats: [
    { value: '24 kHz', label: 'Sample rate' },
    { value: '512 · 50%', label: 'STFT frame · overlap' },
    { value: '28', label: 'Features per window' },
    { value: '5.5–8 kHz', label: 'Knock band' },
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
  stat: { value: '90.3%', label: 'held-out accuracy on 321 real engine recordings' },
};

export const CTA = {
  eyebrow: '04 / Action',
  title: ['See it on a', 'live engine.'],
  sub: 'The dashboard pairs with a running vehicle and diagnoses it from sensor data alone.',
  button: 'Launch dashboard',
};

export const NAV_LABELS = ['Intro', 'Sensor array', 'Signatures', 'Recognition', 'Launch'];
