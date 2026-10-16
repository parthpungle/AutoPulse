# AutoPulse

**Your car's heartbeat, read by the sensors it already has.**

AutoPulse extracts signatures from engine vibration and OBD-II telemetry, recognises faults with **SVM, Softmax regression, ANN and CNN** models, learns what is normal for each car, and tells the driver what to do. Built for the Honeywell problem statement *Automobile engine data: signature extraction and pattern recognition*.

---

## Two versions

| | **[v1](v1/)** · single laptop | **[v2](v2/)** · two laptops |
|---|---|---|
| **What it is** | The round-1 project: the full research pipeline and a dashboard with simulated scenarios | One laptop is the car (sensors stream out, you inject breakdowns); the other is a live dashboard that diagnoses blind |
| **Run** | `v1\run.bat` | `v2\run.bat` → 1 Vehicle · 2 Dashboard · 3 Both · macOS: `v2/run.command` |
| **Screens** | Garage, Health check, Live drive, Signatures, Insights, Evidence | Cockpit, Health check, Live drive, Signature lab, Insights, Evidence + vehicle control panel |
| **Cars** | Procedural Blender wireframes | Real car models drawn as technical illustrations (credited in [v2/README](v2/README.md#credits)) |
| **Also inside** | Real-data evaluation, MATLAB / Simulink cross-checks, round-1 report (PDF) | Everything in v1, plus the vehicle node, live pipeline and car converter |
| **Git tag** | `v1.0` | `v2.0` |

Both run on their own; they use the same ports, so run one at a time.

---

## Where to start

| Document | Use it for |
|----------|------------|
| **[v2/README.md](v2/README.md)** | The current version: how to run it on one or two laptops, what you get, demo script |
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
