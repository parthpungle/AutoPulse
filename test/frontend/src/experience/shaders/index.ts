// Shader sources live in .glsl files and are imported as strings; shared chunks are joined here.
import noise from './common/noise.glsl?raw';
import state from './common/state.glsl?raw';
import shapes from './particles/shapes.glsl?raw';
import velocity from './particles/velocity.frag.glsl?raw';
import home from './particles/home.frag.glsl?raw';
import position from './particles/position.frag.glsl?raw';
import pointsVert from './particles/points.vert.glsl?raw';
import pointsFrag from './particles/points.frag.glsl?raw';
import fullscreenVert from './fullscreen.vert.glsl?raw';
import copy from './copy.frag.glsl?raw';
import backdrop from './backdrop.frag.glsl?raw';
import composite from './composite.frag.glsl?raw';
import sheenVert from './sheen.vert.glsl?raw';
import sheenFrag from './sheen.frag.glsl?raw';
import cardVert from './card.vert.glsl?raw';
import cardFrag from './card.frag.glsl?raw';
import glass from './glass.frag.glsl?raw';
import cardArt from './cardArt.frag.glsl?raw';
import advect from './fluid/advect.frag.glsl?raw';
import splat from './fluid/splat.frag.glsl?raw';
import curl from './fluid/curl.frag.glsl?raw';
import vorticity from './fluid/vorticity.frag.glsl?raw';
import divergence from './fluid/divergence.frag.glsl?raw';
import scale from './fluid/scale.frag.glsl?raw';
import pressure from './fluid/pressure.frag.glsl?raw';
import gradient from './fluid/gradient.frag.glsl?raw';

const join = (...parts: string[]) => parts.join('\n');

export const GLSL = {
  fullscreenVert,
  copy,
  backdrop: join(noise, backdrop),
  composite: join(noise, composite),
  velocity: join(noise, state, shapes, velocity),
  home: join(noise, state, shapes, home),
  position,
  pointsVert: join(state, pointsVert),
  pointsFrag,
  sheenVert,
  sheenFrag,
  cardVert,
  cardFrag: join(noise, cardFrag),
  cardArt: join(noise, state, cardArt),
  glass,
  fluid: { advect, splat, curl, vorticity, divergence, scale, pressure, gradient },
};
