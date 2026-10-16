// Adds a gaussian blob of pointer velocity.
uniform sampler2D tTarget;
uniform vec2 uPoint;
uniform vec2 uForce;
uniform float uRadius;
uniform float uAspect;
varying vec2 vUv;

void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  vec2 splat = exp(-dot(p, p) / uRadius) * uForce;
  gl_FragColor = vec4(texture2D(tTarget, vUv).xy + splat, 0.0, 1.0);
}
