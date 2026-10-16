// The signal pipeline's shared geometry ("Raw signal in. Fingerprint out."): used by the particle
// shapes (shapes.glsl) and the overlay lines (pipelineOverlay.frag.glsl), so a window, a clock or a
// band is drawn exactly where its particles are. The pipeline lives in one region (uL2: centre x,
// width, height, bottom y, world units); positions inside it are fractions of that region.
uniform vec4 uL2;

const float PIPE_WIN = 0.2;     // the sliding window, as a fraction of the region width
const float PIPE_PACKET = 0.1;  // one packet: half a window, so neighbours overlap by 50%
const float PIPE_PRISM = 0.46;  // where the prism stands
const float PIPE_WALL0 = 0.55;  // the spectrogram wall runs from here ...
const float PIPE_WALL1 = 0.90;  // ... to here
const float PIPE_WALL_LO = 0.20; // and from this fraction of the height ...
const float PIPE_WALL_HI = 0.96; // ... to this one
const float KNOCK_LO = 0.458;   // 5.5 kHz of a 12 kHz span
const float KNOCK_HI = 0.667;   // 8 kHz

float pipeX(float f) { return uL2.x - 0.5 * uL2.y + f * uL2.y; }
float pipeY(float f) { return uL2.w + f * uL2.z; }
// the clock line sweeping across the lanes, and the left edge of the sliding window (fractions)
float pipeClock(float t) { return fract(t * 0.11); }
float pipeWindow(float t) { return fract(t * 0.14) * (1.0 - PIPE_WIN); }
