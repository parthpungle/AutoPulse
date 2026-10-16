# Dashboard changelog

These are changes to the **dashboard** (`/dashboard`, the code in `test/frontend/src`) on the `signature-lab` branch. They do not cover the landing page. All of this work is frontend only: the backend, the models, the API and the frame payload are unchanged.

The full design rationale, the data findings and the phase-by-phase notes are in [`test/SIGNATURE_LAB_PLAN.md`](../SIGNATURE_LAB_PLAN.md).

## Signature lab (tab 4) redesign

The old page showed a spectrum, a deviation chart and a stack of probability bars. It is now a page that shows each verdict with its evidence, in this order:

| Section | What it shows | Where the data comes from |
|---|---|---|
| Header | Live rpm as a large readout, and the engine state in words ("Warm engine · high band, 2,600 rpm and up") | `sig.rpm`, `engine.context` |
| **01 Verdict** | The verdict, shown **once** on the page. It is in the alarm colour only for a real alarm. "99% ensemble confidence" is replaced by "4/4 models agree this second · fault in 5 of the last 5 s · confirmed for 1 min 20 s". The action line comes from the alarm. | `engine`, `engine.votes`, `alerts` |
| **02 Detectors** | The classifier (raises the alarm) and the deviation from this car's normal (advisory only), side by side, each against its own threshold. A note explains when the two disagree. | `engine.ensemble`, `engine.anomaly`, `engine.threshold` |
| **03 Engine cycle** | A 720° dial. The 200 ms vibration snippet is folded onto one engine cycle using rpm. Four firing sectors F1–F4 each show their crank-speed change, against this car's normal band. It is labelled "estimated · cylinder mapping unavailable", because the stream has no crank or cam reference. | `sig.time`, `sig.crank.dev` |
| **04 Evidence** | One chart chosen to prove the current verdict (see the table below), against this car's normal, with a numeric readout and a caption that states units and resolution | `sig.*` |
| **05 Why · where · what next** | The reason, then where in frequency, where in the cycle, where in time, and what next. Clicking a line jumps to the chart that proves it; "where in time" also scrubs the timeline. Next to it is an **operating-point map** (throttle against rpm): healthy region, fault seconds, now plus trail, and an "ease off" arrow. | all of the above, plus `history` |
| **06 Timeline** | The last 3 min of both detectors on one time axis. Thresholds are labelled ("3.5 · advisory after 3 s above", "0.50 · alarm after 2 s above"). A bar shows the seconds a fault was confirmed, with markers for "first above 3.5" and "fault confirmed". **Drag, or use ← →, to inspect a past second**: the evidence and signals then show that second; Esc goes back to live. | `history`, plus the lab's own buffer |
| Signals | The six original views (waveform, spectrum, spectrogram, envelope, orders, crank speed) as a drill-down | `sig.*` |
| Model details (drawer) | Each model's shares this second, the 5 s vote, and held-out test metrics per model | `engine.votes`, `engine.ensemble`, `GET /api/results` |

**Evidence chart by fault:**

| Fault | Chart | Readout |
|---|---|---|
| Knock | Spectrum with the 5.5–8 kHz band bracketed | dB over this car's normal in the band |
| Belt squeal | Spectrum zoomed to 2–4 kHz | The tone's frequency and how far it stands out |
| Accessory bearing | Envelope spectrum with crank orders marked | The repetition that is not an engine order, as a multiple of crank speed |
| Misfire | Crank speed at every firing, with the slow firing picked out | rpm lost on that firing |
| Valve tick | Envelope spectrum at the once-per-cycle rate | Level against normal |
| Imbalance | Orders, with 1× highlighted | 1× amplitude against normal |
| No fault | Spectrum against normal | Largest rise, or share inside normal |

**Two fixes behind the redesign:**
- **FAULT shown while the deviation was below its threshold.** The old page could show FAULT while the deviation chart sat under its "alarm threshold", because the two come from different detectors. **It was a labelling problem, not a logic bug.** The alarm comes from the classifier vote (one class at 0.50 or more for 2 s in a row); the deviation detector can only raise an advisory. The page now shows both detectors with their own thresholds, so they can no longer seem to contradict each other.
- **No cylinder numbers anywhere.** Each 1 s window starts at a random crank phase, and the stream has no TDC or firing-order reference.

**This car's normal (learned in the browser):** the band on the charts is learned in the browser, per engine context, from seconds the models call healthy (no confirmed fault and a healthy share of 0.6 or more). It does not wait for the backend status to be `ok`, because after a long fault the backend's own baseline freezes until "Mark serviced". The browser needs about 10 healthy seconds per context before it shows the band. The learned normal is not saved, so it is lost on reload.

## Whole dashboard (every tab)

- **Light theme:**
  - A Light / Dark button in the header; the choice is remembered in the browser.
  - The light colours are tuned for bright rooms and projectors, with text contrast 5.2:1 or more, alarm colours 4.5:1 or more, and lines 3:1 or more.
  - Every hard-coded colour is now a theme variable in `styles.css`. That includes the alarm shapes, the spectrogram colours and the 3-D car's lines, which redraw when the theme changes.
  - The vehicle page (`/vehicle.html`) stays dark and is unchanged.
- **Header:** node name, trip timer and frame count moved into a **Diagnostics** popover.
- **Alarm banner:** ACKNOWLEDGE is now the primary button.
- **Left nav:** the active item is marked with `aria-current`, and the tooltips also show on keyboard focus.
- **Spectrogram unit:** the spectrogram is now in dB. The backend sends log10 power, but the tooltip said dB; this applies to Cockpit's spectrogram too.
- **Bar chart colour:** a leftover warm-grey bar colour was replaced with the dashboard grey.

## Demo recording and replay (dev only)

- **Record:** the "Record demo" button on the Signature lab saves the live frames as JSON. 30 s is about 4 MB.
- **Replay:** put the file in `test/frontend/public/replays/` (git-ignored) and open `/dashboard?page=signatures&replay=<file name>`. It plays once a second, in a loop, instead of the live socket.
- **Replays are labelled:** the link pill reads "Replay · <name> · not live", and pairing and "Mark serviced" do nothing during a replay.

## Files

- **New:**
  - `src/pages/lab/`: the Signature lab components (`Verdict`, `Detectors`, `Cycle`, `Dial`, `Evidence`, `EvidenceChart`, `WhyWhere`, `OpMap`, `Timeline`, `ModelDrawer`, `Recorder`), the client-side buffer (`labStore.js`), the derivations (`derive.js`, `cycle.js`), payload notes (`types.js`) and its styles (`lab.css`)
  - `src/theme.js`
  - `src/components/Diagnostics.jsx`
- **Changed:**
  - `src/pages/Signatures.jsx`: now composes the lab. It still exports `Plot` for Cockpit, with the same signature.
  - `src/live.jsx`: feeds the lab's buffer; record and replay.
  - `src/App.jsx`: header, nav, theme button.
  - `src/styles.css`: theme tokens.
  - `src/components/{Car3D,hmi,LinkPill}.jsx`, `charts/{Heatmap,Bars}.jsx`
  - `src/main.jsx`
  - `src/vehicle/VehicleApp.jsx`: logo colours only.

## Known limits

- **Knock on the dial is modest:** about 3–4 dB. The 200 ms snippet is decimated to 4 kHz without an anti-alias filter, so knock ringing folds into the same band as normal combustion ringing. The spectrum chart is the stronger knock evidence.
- **The timeline only covers this page's lifetime:** its bar and scrubbing only reach seconds this page has seen (up to 3 min); the lines use the backend's 15 min history.
- **Cockpit still says "% confidence":** Cockpit's recognition panel was not changed.

## Wishlist for the backend (nothing was changed there)

These would make the views above stronger; the list is in `SIGNATURE_LAB_PLAN.md` §6.
1. An anti-aliased waveform or a short audio snippet. This enables an audio play button and a sharper dial.
2. A crank or TDC reference per window, so cylinders could be named.
3. A baseline spectrum per context.
4. The bearing defect frequency.
5. A per-frame timestamp.
6. A server-side acknowledge.
7. A smaller spectrogram payload.
