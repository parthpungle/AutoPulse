// JSDoc shapes of the live frame, for editor hints only (the dashboard stays plain JSX).
// Built in backend/live.py (process + engine); see SIGNATURE_LAB_PLAN.md §1.

/**
 * @typedef {object} Sig                     null while the engine is off
 * @property {number} rpm
 * @property {{ t_ms: number[], y: number[] }} time          first 200 ms, every 6th sample (4 kHz, aliased)
 * @property {{ f: number[], db: number[] }} spectrum        Welch 1024/512, 0–9984 Hz, Δf 23.44 Hz, dB arbitrary ref.
 * @property {{ f: number[], t: number[], z: number[][] }} spectrogram   z in bels (dB = 10·z), [64 freq][95 time]
 * @property {{ f: number[], y: number[], orders: number[] }} envelope   0–399 Hz, normalised; orders = [.5,1,1.5,2]·rpm/60
 * @property {{ labels: string[], amp: number[] }} orders    0.5×…4.0×, linear amplitude
 * @property {{ dev: number[] }} crank                        per-firing rpm minus the window median
 * @property {Record<string, number>} marks                   0.5×, 1× and 2× in Hz
 */

/**
 * @typedef {object} Engine
 * @property {'running'|'off'} state
 * @property {'ok'|'info'|'warning'|'critical'} status
 * @property {string} label
 * @property {string} [fault]           fault id, or 'healthy' until the classifier has confirmed one
 * @property {number} [confidence]      5 s mean share of the top class (shown only in the model drawer)
 * @property {number} [healthy_p]       5 s mean share of Healthy
 * @property {number} [anomaly]         deviation from this car's normal: RMS of the top-5 feature z-scores, max 10
 * @property {number} [threshold]       3.5
 * @property {number} [learned]         healthy seconds the backend baseline has absorbed
 * @property {string} [context]         '{cold|warm}_{idle|low|mid|high}'
 * @property {string[]} [classes]       7 labels, in fault-id order
 * @property {number[]} [ensemble]      7 shares, 5 s mean
 * @property {Record<string, number[]>} [votes]   SVM, Softmax, ANN, CNN: 7 shares each, this second only
 */

/**
 * @typedef {object} Row                 one second of telemetry (also the element type of history)
 * @property {number} clock              seconds since the vehicle node started
 * @property {number} t                  trip seconds
 * @property {boolean} ignition
 * @property {number} rpm
 * @property {number} throttle_pct
 * @property {number|null} anomaly
 * @property {number|null} healthy_p
 */

/**
 * @typedef {object} Alert
 * @property {'info'|'warning'|'critical'} severity
 * @property {string} title
 * @property {string} message
 * @property {string[]} actions
 * @property {string} maps_url
 */

/**
 * @typedef {object} Frame
 * @property {number} seq
 * @property {{ name: string, car_type: string, label: string, unit: number }} vehicle
 * @property {Row} row
 * @property {Engine} engine
 * @property {Alert[]} alerts
 * @property {Sig|null} sig
 */

/**
 * @typedef {object} LabFrame            one second kept by labStore (signals as Float32Array)
 * @property {number} clock
 * @property {number} t
 * @property {number} rpm
 * @property {Float32Array} spectrum     spectrum.db
 * @property {Float32Array} envelope     envelope.y
 * @property {Float32Array} spectrogram  z flattened row-major [freq][time], in bels
 * @property {Float32Array} time         time.y
 * @property {Float32Array} crank        crank.dev
 * @property {Float32Array} orders       orders.amp
 * @property {{ status: string, fault: string, label: string, anomaly: number, healthy_p: number, context: string, threshold: number }} engine
 * @property {Record<string, number>} picks   each model's argmax this second
 * @property {number} top                argmax of the 5 s ensemble
 * @property {string|null} alert         title of the engine alert, if any
 */

export {};
