# Signature Lab redesign: plan

Scope: the Signature Lab tab (4th nav item, `?page=signatures`) in `test/frontend/`.
Built from the three exploration reports (design language, dashboard, backend). Line refs come from those reports, so check them before relying on them.

**How to use this file:** implement ONE phase per fresh session. For each phase: read this file, build the phase, verify it in the browser, commit, then stop.

**Status** (branch `signature-lab`, off `landing-page`):
- Phase 0: done
- Phases 1–6: not started

---

## 0. Ground rules

- **Frontend only.** Do not edit `test/backend/`, `test/autopulse/`, `test/vehicle/`, or the frame payload. Missing data goes into the wishlist (§6).
- **Keep these stable** (other tabs depend on them):
  - `Plot({view, d, height})` exported from `Signatures.jsx`. Cockpit (`Overview.jsx:11,120`) imports it.
  - The props of `LineChart`, `HBars`, `VBars`, `Heatmap` and `Tabs`.
  - `useLive()` and `series()`.
  - All `engine.*` field names.
  - The CSS classes `.panel`, `.panel-pad`, `.tabs`, `.status.*`, `.chart`, `.tip`, `.meter`, `.live-tag` and `table.data`.
  - The `?page=signatures` id.
- **Never import `landing.css` or call `applyThemeCSS()` in the dashboard.** The names `--bg-0`, `--bg-1`, `--accent`, `--muted` and `--line` collide with different values.
- **Stay in plain JSX.** `tsconfig.json` only covers the landing, and importing untyped `.jsx` modules from strict TS would need declaration shims. Instead, put JSDoc `@typedef`s for the payload in `src/pages/lab/types.js` to get editor hints.
- **New code goes in `src/pages/lab/`.** `Signatures.jsx` becomes a thin page that composes it and keeps exporting `Plot`.
- **New CSS goes in `src/pages/lab/lab.css`**, with every rule under a `.lab` root class. Use the existing dashboard tokens. New tokens are declared on `.lab` with a `--lab-` prefix.
- **Motion:** use the dashboard tokens (`--dur-micro` 120ms, `--dur-state` 240ms, `--ease`). Animate only on data or state changes, never as decoration. Respect `prefers-reduced-motion`.
- **Git:** `git checkout -b signature-lab` from the current branch (`landing-page`). Commit after each phase.

## 1. Findings the build depends on

### 1.1 Transport

- One WebSocket, `/api/ws/live`, at 1 frame/s, about 130 kB per frame (about 105 kB of that is `sig.spectrogram.z` at full float precision).
- Messages are `hello {link, history, latest}`, `link {link}`, and `frame` (`live.py:250-291`).
- The client keeps `history` (≤900 rows). There is **no history of `sig`, `ensemble`, `votes` or `status`**: only `latest` carries them.
- `key={page}` (`App.jsx:119`) remounts the page on every tab switch, so state kept inside the page is lost.
- A 1 s `now` ticker (`live.jsx:50`) re-renders every consumer once a second.

### 1.2 `sig` (null when the engine is off)

| Key | Shape | Meaning |
|---|---|---|
| `rpm` | number | rounded rpm |
| `time.t_ms`, `time.y` | 800 each | First 200 ms of the window, every 6th sample of 24 kHz (4 kHz, **no anti-alias filter**, so 5.5–8 kHz ringing is aliased) |
| `spectrum.f`, `.db` | 427 each | Welch, Hann, 1024/512 at 24 kHz. 0–9984 Hz, Δf 23.44 Hz. `db = 10·log10(PSD+1e-12)`, arbitrary reference, roughly −70…−29 |
| `spectrogram.f/.t/.z` | 64 / 95 / 64×95 | `z = log10(|STFT|²+1e-10)`, in **bels, not dB**, so dB = 10·z (roughly −70…−20). STFT 512/256 Hann. 70–11 883 Hz in 187.5 Hz steps, over 0–1.003 s. The heatmap tooltip wrongly says dB (`Heatmap.jsx:72`) |
| `envelope.f`, `.y`, `.orders` | 400, 400, 4 | Hilbert envelope of 2–7.5 kHz, 0–399 Hz at 1 Hz steps, normalised to 0..1. `orders` = [0.5, 1, 1.5, 2]·rpm/60 Hz |
| `orders.labels`, `.amp` | 6 each | 0.5× … 4.0×, linear amplitude |
| `crank.dev` | ~rpm/30 values | Per-firing crank rpm minus the window median |
| `marks` | 3 keys | 0.5×, 1× and 2× in Hz. Currently unused |

### 1.3 `engine` (running)

- `state`, `status` (`ok|info|warning|critical`), `label`, `fault` (fault id, or `"healthy"` until confirmed).
- `confidence`, `healthy_p`, `anomaly`, `threshold` (3.5), `learned`, `context` (`{cold|warm}_{idle|low|mid|high}`; cold means coolant < 60 °C; idle <1000, low <1800, mid <2600, high ≥2600 rpm).
- `classes` (7), `ensemble` (7, averaged over 5 s), `votes {SVM, Softmax, ANN, CNN}` (7 each, **this second, unsmoothed**; CNN is present only if torch and `cnn.pt` exist).

### 1.4 History rows

`speed_kph, rpm, throttle_pct, engine_load, coolant_c, oil_pressure_bar, battery_v, fuel_level_pct, ltft_pct, tyre_*_psi, clock, t, ignition, score, anomaly, healthy_p`.
`clock` is the x-axis. `anomaly` and `healthy_p` are null while the engine is off. `healthy_p` is buffered but never plotted anywhere yet.

### 1.5 Why FAULT can show below the threshold line (`live.py:306-320`)

- **The verdict comes from the classifier vote:**
  - The 4 models are averaged, then smoothed over 5 frames, then the argmax is taken.
  - A fault is "sure" when it is not healthy, its probability is ≥ 0.5, and at least 3 frames are buffered.
  - It must be sure for 2 frames in a row before advice is shown.
  - Misfire and knock are CRITICAL; the other faults are WARNING.
- **The chart plots a different detector**, the baseline deviation:
  - The score is the RMS of the top 5 feature z-scores (27 features, clipped at ±10, so the cap is 10).
  - On its own it can only raise **INFO** ("Sounds different…"), and only after 3 s above 3.5 in the same context.
- **The two are independent.** A bearing fault was named at 98% while the deviation stayed at 2.6–3.2.
- **Other mismatches:**
  - `confidence = smooth[k]`, even when the label says Healthy.
  - The votes table is per second; the bars are averaged over 5 s.
  - The threshold line has no visible label (`LineChart.jsx:96-100`).
  - Acknowledging is client-only and keyed by alert title (`App.jsx:57`).
  - A fault label clears about 2 s after a repair.

### 1.6 Fault classes (`generator.py:17-26`, in index order)

| id | Where it shows | Severity |
|---|---|---|
| healthy | baseline | – |
| misfire | `crank.dev` dips every 4th firing; the 0.5× order rises | critical |
| knock | 5.5–8 kHz band (knock frequency is 5.8–7.3 kHz depending on the car) | critical |
| valve_tick | envelope peak at rpm/120 | warning |
| bearing | envelope peak at 7.15–9.82 × crank rate. The defect frequency is **not sent**. Above roughly 2.45–3.35k rpm it leaves the 0–400 Hz view | warning |
| belt_squeal | narrow line at 2.6–3.4 kHz with ±40 Hz wobble. Pins the deviation at 10 | warning |
| imbalance | 1× order bar (plus extra 2×) | warning |

### 1.7 Geometry gaps

- Each 1 s window starts at a **random crank phase**.
- No TDC, tooth timing or firing order reaches the stream.
- The misfire is always cylinder index 1, but the browser cannot tell which firing that is.
- **Therefore: no cylinder numbers anywhere in the UI.**

### 1.8 Not in the browser

- Raw audio. It exists only on the vehicle→backend link.
- The 28 signature features.
- A baseline spectrum.
- A per-frame wall-clock timestamp.
- Lambda, MAF, MAP, IAT and ignition timing.

### 1.9 Existing data worth using

- `GET /api/results`: model metrics, already used by Evidence. Use it in the Model details drawer.
- `latest.alerts[0]`: the engine alert, inserted first. It provides `message`, `actions[]`, `title` and `severity`.

## 2. Design decisions

1. **Visual system:** keep the dashboard's graphite tokens and IBM Plex for consistency with the other tabs. This follows ISA-101: healthy is grey, and colour (`--p1..p4`) is used only for alarm states.
2. **Borrow from the landing page only these motifs:**
   - numbered eyebrows (`01 / Evidence`, `02 / Detectors`, …)
   - 1px hairline rules
   - tabular mono numerals
   - the knock-band **corner bracket** (corners plus a left bar), replacing the filled rect with a critical-coloured label
   - the ring, for the dial

   No haze, glass, grain, glows or decorative motion.
3. **Data colours, used consistently on every chart:**
   - Baseline: `--band` fill with a `--band-edge` outline.
   - Live trace: `--trace`.
   - Excess over baseline: `--lab-excess`, a muted tone derived from `--s4`. Verify its contrast. It means "deviation, not an alarm".
   - Alarm hues appear only in the status block and alarm markers.
4. **Show the two detectors explicitly**, instead of hiding the conflict:
   - "Classifier · Knock · 4/4 models agree · confirmed 6 s"
   - "Deviation from this car's normal · 2.6 / 3.5"
   - A one-line note saying which detector drives the alarm.
5. **Replace "99% ensemble confidence"** with model agreement (the 4 per-second argmaxes compared with the smoothed argmax) plus persistence (fault-confirmed seconds out of the last 5, from the client buffer). The raw ensemble share goes in the Model details drawer only.
6. **The evidence chart switches to whichever plot best proves the current verdict** (by `engine.fault`; see §4 Phase 2).
7. **Dial = firing-synchronous view, labelled "estimated":**
   - Firings are labelled F1–F4 "(cylinder mapping not available)".
   - It shows the current window only, with no averaging across windows, because the phase is random.
8. **Client-side buffers** live in a module-level store so they survive tab remounts (§3).
9. **Show the verdict once on the page**, in large type. The global banner in `App.jsx` stays as it is in phases 1–4.
10. **Projector contrast pass, not a light theme:** use lines ≥1.5px, and brighter captions that pass WCAG AA on `--bg-*`. A light theme is optional phase 6.
11. **Units on every chart:**
    - Spectrum: "dB (arbitrary ref.) · Welch 1024 · Δf 23.4 Hz"
    - Spectrogram: dB = 10·z
    - Deviation: "RMS of top-5 feature z-scores, max 10"

## 3. Client-side store (`src/pages/lab/labStore.js`)

The store is fed from `LiveProvider` through **one additive line** (for example `labStore.push(frame)` in the frame handler of `live.jsx`). The rest of `live.jsx` stays unchanged.

- **Ring buffer, last 180 s**, keyed by `row.clock`. Each entry holds:
  - `sig.spectrum.db` and `sig.envelope.y` as Float32Array
  - `sig.spectrogram.z` as Float32Array: 64×95×180 ≈ 4.4 MB, which is acceptable
  - `sig.rpm`
  - `engine.{status, fault, label, anomaly, healthy_p, context}`
  - the argmax of each model in `votes`
  - `alerts[0]?.title`
- **Baseline spectrum per context:** a running mean and variance of `spectrum.db`, updated only while `engine.status === 'ok'`. It needs ≥10 frames before it is shown, and is labelled "learned in this browser since page load (n s)".
- **Reset:** clear the store when "Mark serviced" is pressed, and when `vehicle.car_type` changes (mirror `live.jsx:39-43`).
- **Hook:** expose `useLabStore(selector)` and subscribe with `useSyncExternalStore`, so the 1 s `now` ticker doesn't cause extra work.

## 4. Phases

### Phase 0: prep (small)

- Create the branch.
- Spot-check the line refs used in §1.
- Create `src/pages/lab/` containing `types.js`, `lab.css` and `labStore.js`, and add the one-line feed in `live.jsx`.
- **Done when:** the store fills (check with a temporary dev log, then remove it), and every other tab behaves as before.

### Phase 1: page frame, verdict and detectors

- **Page header:** a large live RPM readout and the context in words ("warm · low rpm band"). Remove the small `live-tag`.
- **01 / Verdict block:**
  - the label, in the alarm colour only when the status is warning or critical
  - agreement (n/4)
  - persistence
  - onset ("confirmed 14:02 ago" style; time comes from `row.clock` deltas)
  - the action line from `alerts[0].actions[0]`
- **02 / Detectors panel:**
  - Classifier row
  - Deviation row with a mini bar against 3.5
  - the explanatory note (decision 4)
- **Model details drawer:**
  - the votes table
  - ensemble bars, hiding classes under 1%
  - smoothing details (5 s average, per-second votes)
  - per-class metrics from `/api/results`
- **Fix in `Plot`:** convert the spectrogram to dB (10·z) before handing it to `Heatmap`, so Cockpit gets the correct unit as well. Keep the `Plot` signature unchanged.
- **Fix in `Bars.jsx`:** replace the `#4a4846` fallback with `var(--s3)`. Insights passes explicit colours, so it is unaffected.
- **Done when:**
  - The verdict shows once.
  - No "% confidence" text remains on the page.
  - Healthy shows grey.
  - Injecting knock gives critical styling plus "4/4 agree" within about 4 s.
  - Cockpit still renders.

### Phase 2: fault-specific evidence

- **03 / Evidence:** a single main chart, chosen by `engine.fault` (or by status `info` with no fault). Every view has a one-line caption and a numeric readout:

  | Case | Chart | Readout |
  |---|---|---|
  | knock | spectrum with baseline band, live line and excess fill; 5.5–8 kHz corner bracket | "+X dB vs baseline in band" (mean of live minus baseline over the band) |
  | belt_squeal | spectrum zoomed to 2–4 kHz | peak frequency and its prominence in dB |
  | bearing | envelope spectrum | detected peak in Hz and as a multiple of crank rate ("7.6× crank"); "out of view at this rpm" when expected > 399 Hz |
  | valve_tick | envelope with a marker at rpm/120 | – |
  | misfire | `crank.dev` bars, with every 4th firing emphasised | orders, showing 0.5× |
  | imbalance | orders bars with 1× highlighted | – |
  | healthy | spectrum with baseline band | "within normal" |
  | info | spectrum with baseline, and the frequency region of largest excess annotated | – |

- If there is no baseline yet, show "learning baseline · n/10 s" in place of the band.
- Label harmonics directly (1×, 2× firing) on the spectrum and envelope.
- The secondary tabs (waveform, spectrogram, envelope, orders, crank) move below the main chart as drill-down. Note on the waveform that it is decimated to 4 kHz.
- **Done when:** each of knock, belt_squeal, bearing and misfire (injected via curl, §5) switches the main chart, and the readout matches what is visible.

### Phase 3: timeline and scrub

- **04 / Timeline:** the deviation score over the last 180 s, with:
  - a threshold line **labelled** "3.5 · flags after 3 s above"
  - a classifier strip underneath: `healthy_p` as a thin line, plus segments showing fault-confirmed periods from the store
  - markers for the first deviation crossing and the fault onset
- **Scrub:** dragging on the timeline sets `inspectClock`.
  - All evidence views read from the store at that time.
  - A "viewing −42 s · back to live" pill appears.
  - Esc returns to live.
- **Done when:**
  - The verdict, strip and deviation can never visually contradict each other without the note explaining why.
  - Scrubbing back to before an injection shows the healthy spectrum.

### Phase 4: dial and Why / Where / What-next

- **Dial (SVG or canvas, 1 Hz):**
  - Detect firing impulses in the envelope of `sig.time` (expected spacing 30/rpm s).
  - Anchor 0° at the first detected firing and fold the 200 ms onto 720° using rpm.
  - The radial trace shows energy per angle. Four sectors F1–F4 carry the mean `crank.dev` for that firing index (mod 4) across the full window.
  - If detection is unreliable, show "can't align this second" instead of a guess.
  - Label it "estimated · cylinder mapping unavailable".
- **Why / Where / What-next panel:**
  - *Frequency:* taken from the phase 2 readout.
  - *Cycle:* from the dial (for example "bursts ~X° after firing; F3 slower by 18 rpm"), or "not available".
  - *Time:* onset, plus occurrences this session from the store.
  - *Action and consequence:* from `alerts[0]`.
  - Each line focuses the matching chart.
- **Done when:**
  - Misfire shows one weak sector.
  - Knock shows post-firing bursts.
  - Healthy shows even lobes.
  - Nothing claims a cylinder number.

### Phase 5 (opt-in; touches the shared shell or adds tooling)

- **Operating-point map:** RPM against throttle from `history`.
  - The healthy region is the density of points while the status was ok.
  - Fault-confirmed points come from the store.
  - Show a "now" dot with a trail.
  - Draw an arrow towards lower throttle when the action says to ease off.
  - Label it "this session".
- **Demo safety:** a dev-only recorder that saves store frames to JSON, and `?replay=file` to play them through a mock provider. The simulator is unseeded, so this makes demos repeatable.
- **Shell polish (`App.jsx`), tested on every tab:**
  - `aria-current` on the active nav item
  - tooltips shown on `:focus-visible` as well as hover
  - ACKNOWLEDGE as the primary button
  - node name and frame count moved into a footer or diagnostics popover

### Phase 6 (optional): light theme

A light theme is dashboard-wide token work: `[data-theme]` on `:root`, plus removing the hard-coded hex values listed in the dashboard report (§9). Only do it if the demo room is bright.

## 5. Running and driving states (macOS, from `test/`)

```
AUTOPULSE_CODE=1234 .venv/bin/python -m uvicorn vehicle.node:app --host 0.0.0.0 --port 8200
AUTOPULSE_AUTOPAIR=127.0.0.1:8200:1234 .venv/bin/python -m uvicorn backend.app:app --port 8000
npm --prefix frontend run dev        # open http://localhost:5173/dashboard?page=signatures
```

Use port 5173, not 8000. Port 8000 serves a stale `dist` build.

```
curl -X POST localhost:8200/api/control -H 'content-type: application/json' -d '{"ignition":true,"mode":"idle"}'
curl -X POST localhost:8200/api/inject  -H 'content-type: application/json' -d '{"fault":"knock"}'   # misfire, belt_squeal, bearing, valve_tick, imbalance
curl -X POST localhost:8200/api/repair  -H 'content-type: application/json' -d '{"fault":"all"}'
```

There is no test framework. Verify in the browser: screenshot each state (healthy, knock, belt_squeal, bearing, misfire) and inspect the screenshots. `npm --prefix frontend run build` must still pass.

## 6. Data wishlist (for the backend owner)

1. **Audio:** a short, properly band-limited audio snippet, or an anti-aliased waveform. This enables playback and a waveform without aliasing.
2. **Crank reference:** TDC or tooth timing plus a firing-index→cylinder mapping per window. This would let the dial name cylinders.
3. **Baseline spectrum per context** (mean and std of `spectrum.db`), so the ghost is backend-learned rather than browser-learned.
4. **Deviation explanation:** the top contributing features and their z-scores.
5. **Bearing defect frequency** (or its ratio) for the current car.
6. **Timestamp:** a per-frame wall-clock time (the vehicle's `sent` is currently dropped).
7. **History:** a `sig` history or `/api/sig?clock=`, so scrubbing works across reloads.
8. **Alarms:** a server-side acknowledge endpoint and alarm latching.
9. **Payload size:** round `spectrogram.z` to 2 dp to cut roughly 70% of the frame size.
10. **Threshold consistency:** align the thresholds (Insights uses 3.0, the live baseline uses 3.5).
