/**
 * Every section owns its own particles: a block of whole rows in the one simulation texture, so
 * each section can be simulated (a scissored pass) and drawn (a draw range) on its own, and only
 * the sections on screen cost anything. Sizes are relative to the tier's particle count: the hero,
 * the Sensor Array and the signal pipeline get a full tier each, Recognition 60%, the CTA ring 50%.
 * Rows are filled in random order, so a quality drop that draws only the first part of each
 * range still covers every shape evenly.
 */
export const SECTION_SHARE = [1, 1, 1, 0.6, 0.5];

export interface Range {
  section: number;
  /** First row and number of rows in the simulation texture. */
  rowStart: number;
  rows: number;
  /** First particle (texel) index and how many the rows can hold. */
  start: number;
  capacity: number;
  /** Particles drawn and simulated at the current tier. */
  count: number;
}

export class Ranges {
  readonly side: number;
  readonly list: Range[];
  /** The tier count the ranges were sized for. */
  readonly baseCount: number;

  constructor(tierCount: number) {
    this.baseCount = tierCount;
    const want = SECTION_SHARE.map((s) => Math.floor(s * tierCount));
    let side = Math.ceil(Math.sqrt(want.reduce((a, b) => a + b, 0)));
    // whole rows per section: grow the side until they fit
    while (want.reduce((a, w) => a + Math.ceil(w / side), 0) > side) side++;
    this.side = side;
    let row = 0;
    this.list = want.map((w, section) => {
      const rows = Math.ceil(w / side);
      const r: Range = { section, rowStart: row, rows, start: row * side, capacity: rows * side, count: w };
      row += rows;
      return r;
    });
  }

  /** Particles per section at a tier's count (a drop draws and simulates a prefix of each range). */
  setTierCount(count: number) {
    const k = count / this.baseCount;
    for (const r of this.list) r.count = Math.min(r.capacity, Math.floor(SECTION_SHARE[r.section] * this.baseCount * k));
  }

  /** Rows that hold a range's drawn particles. */
  activeRows(r: Range) {
    return Math.ceil(r.count / this.side);
  }

  /** Section of a particle (texel) index, -1 past the last range. */
  sectionOf(index: number) {
    for (const r of this.list) if (index >= r.start && index < r.start + r.capacity) return r.section;
    return -1;
  }
}
