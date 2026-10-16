// What the glass cards see behind them: the backdrop with the solids and particles laid over it,
// written at half resolution (the linear filtering doubles as a little blur).
uniform sampler2D tBackdrop;
uniform sampler2D tMain;
varying vec2 vUv;

void main() {
  vec4 m = texture2D(tMain, vUv);
  vec3 bd = texture2D(tBackdrop, vUv).rgb;
  gl_FragColor = vec4(bd * (1.0 - clamp(m.a, 0.0, 1.0)) + m.rgb, 1.0);
}
