// Browser-side audio for the Real clip mode: decode any format the browser can play, downmix to mono,
// and encode a 16-bit PCM WAV for /api/classify-audio (so the server needs no ffmpeg). Also a 10 s recorder.

/** Mono Float32Array -> 16-bit PCM WAV Blob. */
export function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Any audio Blob the browser can decode -> { wav, seconds, sampleRate }. Channels are averaged to mono. */
export async function toWav(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
    }
    return { wav: encodeWav(mono, audio.sampleRate), seconds: audio.duration, sampleRate: audio.sampleRate };
  } finally {
    ctx.close();
  }
}

/** Record from the microphone for `seconds`. onTick({ left, level }) about 20x per second; resolves to a Blob.
 *  Echo cancellation, noise suppression and auto gain are off: they would reshape the engine sound. */
export async function record(seconds, onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const t0 = performance.now();
  const timer = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length);
    onTick?.({ left: Math.max(0, seconds - (performance.now() - t0) / 1000), level: Math.min(1, rms * 4) });
  }, 50);
  return new Promise((resolve, reject) => {
    rec.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
    rec.onerror = (e) => reject(e.error || new Error('Recording failed'));
    rec.start();
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000);
  });
}
