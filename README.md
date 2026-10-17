# AutoPulse

**Your car's heartbeat, read by the sensors it already has.**

AutoPulse extracts signatures from engine vibration and OBD-II telemetry, recognises faults with **SVM, Softmax regression, ANN and CNN** models, learns what is normal for each car, and tells the driver what to do. Built for the Honeywell problem statement *Automobile engine data: signature extraction and pattern recognition*.

---

## Four versions

| | **[v1](v1/)** · single laptop | **[v2](v2/)** · two laptops | **[v3](v3/)** · two laptops, team build | **[v4](v4/)** · v3, easier to read |
|---|---|---|---|---|
| **What it is** | The round-1 project: the full research pipeline and a dashboard with simulated scenarios | One laptop is the car (sensors stream out, you inject breakdowns); the other is a live dashboard that diagnoses blind | v2 plus the team's branches: light / dark theme, the new Signature lab, engine audio (clips and the live microphone) on real-data models, mic + vibration + OBD fusion, robustness tests, printable health report | v3 with a clearer visual hierarchy, after v1: a big car name and health score, green ticks for every healthy system in a fixed grid, sentence-case titles, a visible dot floor |
| **Run** | `v1\run.bat` | `v2\run.bat` → 1 Vehicle · 2 Dashboard · 3 Both · macOS: `v2/run.command` | `v3\run.bat` (same roles; 3 connects by itself) · macOS: `v3/run.command` | `v4\run.bat` (same roles) · macOS: `v4/run.command` |
| **Screens** | Garage, Health check, Live drive, Signatures, Insights, Evidence | Cockpit, Health check, Live drive, Signature lab, Insights, Evidence + vehicle control panel | The same screens, with Engine audio in the Signature lab, Vibration analysis in Insights, and the report | Same as v3 |
| **Cars** | Procedural Blender wireframes | Real car models drawn as technical illustrations (credited in [v2/README](v2/README.md#credits)) | Same as v2 | Same as v2 |
| **Also inside** | Real-data evaluation, MATLAB / Simulink cross-checks, round-1 report (PDF) | Everything in v1, plus the vehicle node, live pipeline and car converter | Everything in v2, plus real-audio and fusion training, pytest and node test suites | Everything in v3 |
| **Git tag** | `v1.0` | `v2.0`, `v2.1` | — | `v4.0` |

Each runs on its own; they use the same ports, so run one at a time.

---

## Where to start

| Document | Use it for |
|----------|------------|
| **[v4/README.md](v4/README.md)** | The newest version: v3 with v1's clearer hierarchy |
| **[v3/README.md](v3/README.md)** | The whole team's features, before the visual pass |
| **[v2/README.md](v2/README.md)** | The two-laptop version before the team merge: how to run it, what you get, demo script |
| **[v2/docs/SETUP.md](v2/docs/SETUP.md)** | Requirements, roles, pairing, firewall, troubleshooting (Windows and macOS) |
| **[v2/docs/ARCHITECTURE.md](v2/docs/ARCHITECTURE.md)** | The wire format, the live pipeline, the line-art cars |
| [v1/README.md](v1/README.md) | The round-1 project and its results |
| [v1/docs/WALKTHROUGH.md](v1/docs/WALKTHROUGH.md) | Every project step, from data to report |
| [v1/report/AutoPulse-Concept-Report.pdf](v1/report/AutoPulse-Concept-Report.pdf) | Round-1 concept report |

---

## Results

| Test | Data | Result |
|------|------|--------|
| Fault classification from engine sound | 321 **real** recordings, held out by recording | **90.3%** (SVM) |
| Adaptive baseline on real driving | 129 **real** carOBD trips | False alarms on **14%** of healthy trips vs 31% fixed |
| Misfire on **MathWorks' Simulink engine** | Powertrain Blockset example, run blind | **11 / 11** detected |
| Live two-laptop pipeline (v2) | 30 min of simulated healthy driving + every fault | 0 false engine warnings; engine faults named in 3 s |
