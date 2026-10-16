// Microphone capture: getUserMedia -> AudioWorklet tap -> Float32 chunks on the main thread.
// Browser APIs are injectable so the lifecycle (permission, device loss, start/stop) is testable in Node.

const CHUNK = 2048; // samples per message from the audio thread (~43 ms at 48 kHz)

// Runs on the audio rendering thread: averages channels to mono and posts fixed-size chunks.
export const WORKLET_SOURCE = `
class AutoPulseTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${CHUNK}); this.n = 0; }
  process(inputs) {
    const chans = inputs[0];
    if (chans && chans.length) {
      const len = chans[0].length, k = chans.length;
      for (let i = 0; i < len; i++) {
        let v = 0;
        for (let c = 0; c < k; c++) v += chans[c][i];
        this.buf[this.n++] = v / k;
        if (this.n === ${CHUNK}) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('autopulse-tap', AutoPulseTap);
`;

// Browser voice processing reshapes the spectrum (noise suppression removes steady tones), so ask for it off.
export const CONSTRAINTS = {
  audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  video: false,
};

const MESSAGES = {
  insecure: 'Microphone access needs a secure page: open the app at http://localhost:5173 (or over HTTPS).',
  unsupported: 'This browser does not support microphone capture with AudioWorklet. Use a current Chrome, Edge or Firefox.',
  denied: 'Microphone permission was denied. Allow it in the browser address bar (site settings), then press Start again.',
  no_device: 'No microphone was found. Connect one or enable it in the system sound settings.',
  busy: 'The microphone is in use by another application or could not be opened.',
  disconnected: 'The microphone stopped delivering audio (unplugged or disabled). Capture has stopped.',
  failed: 'The microphone could not be started.',
};

export class MicError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || MESSAGES.failed);
    this.code = code;
    this.detail = detail;
  }
}

/** Map a getUserMedia / AudioContext exception to one of the codes above. */
export function classify(err) {
  switch (err?.name) {
    case 'NotAllowedError': case 'PermissionDeniedError': case 'SecurityError': return 'denied';
    case 'NotFoundError': case 'DevicesNotFoundError': case 'OverconstrainedError': return 'no_device';
    case 'NotReadableError': case 'TrackStartError': case 'AbortError': return 'busy';
    default: return 'failed';
  }
}

export class MicCapture {
  constructor({
    onChunk = () => {}, onState = () => {},
    mediaDevices = globalThis.navigator?.mediaDevices,
    AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext,
    WorkletNodeCtor = globalThis.AudioWorkletNode,
    secure = globalThis.isSecureContext,
    makeModuleUrl = () => URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' })),
    revokeModuleUrl = (u) => URL.revokeObjectURL(u),
  } = {}) {
    Object.assign(this, { onChunk, onState, mediaDevices, AudioContextCtor, WorkletNodeCtor, secure, makeModuleUrl, revokeModuleUrl });
    this.state = 'idle';
    this.error = null;
    this.session = 0; // bumped by stop(): a start() still awaiting permission then cleans up instead of going live
    this.stream = this.ctx = this.node = this.sink = this.source = null;
  }

  _set(state, error = null) {
    this.state = state;
    this.error = error;
    this.onState({ state, error, sampleRate: this.sampleRate, device: this.device });
  }

  get sampleRate() { return this.ctx?.sampleRate ?? null; }

  get device() { return this.stream?.getAudioTracks?.()[0]?.label || null; }

  /** Resolves true once audio flows; false if already running or stopped meanwhile. Never throws. */
  async start() {
    if (this.state === 'requesting' || this.state === 'active') return false;
    const session = ++this.session;
    this._set('requesting');
    try {
      if (this.secure === false) throw new MicError('insecure');
      if (!this.mediaDevices?.getUserMedia || !this.AudioContextCtor || !this.WorkletNodeCtor) throw new MicError('unsupported');
      let stream;
      try {
        stream = await this.mediaDevices.getUserMedia(CONSTRAINTS);
      } catch (e) {
        throw new MicError(classify(e), e?.message);
      }
      if (session !== this.session) { stream.getTracks().forEach((t) => t.stop()); return false; }
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new MicError('no_device');
      track.addEventListener?.('ended', () => this._lost(session));

      this.ctx = new this.AudioContextCtor();
      if (!this.ctx.audioWorklet) throw new MicError('unsupported');
      const url = this.makeModuleUrl();
      try { await this.ctx.audioWorklet.addModule(url); } finally { this.revokeModuleUrl(url); }
      if (session !== this.session) { await this._release(); return false; }
      this.source = this.ctx.createMediaStreamSource(stream);
      this.node = new this.WorkletNodeCtor(this.ctx, 'autopulse-tap');
      this.node.port.onmessage = (e) => { if (session === this.session) this.onChunk(e.data); };
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0; // keeps the graph pulled without playing the mic back through the speakers
      this.source.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this._set('active');
      return true;
    } catch (e) {
      await this._release();
      if (session === this.session) this._set('error', e instanceof MicError ? e : new MicError('failed', e?.message));
      return false;
    }
  }

  async stop() {
    this.session++;
    await this._release();
    this._set('idle');
  }

  async _lost(session) {
    if (session !== this.session || this.state !== 'active') return;
    this.session++;
    await this._release();
    this._set('error', new MicError('disconnected'));
  }

  async _release() {
    const { stream, ctx, node, source, sink } = this;
    this.stream = this.ctx = this.node = this.sink = this.source = null;
    if (node) node.port.onmessage = null;
    for (const n of [source, node, sink]) { try { n?.disconnect(); } catch { /* already disconnected */ } }
    stream?.getTracks().forEach((t) => t.stop());
    if (ctx && ctx.state !== 'closed') { try { await ctx.close(); } catch { /* already closing */ } }
  }
}
