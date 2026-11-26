/**
 * Deterministic seeded random numbers and value noise.
 *
 * Everything here uses 32-bit integer arithmetic (`Math.imul`, shifts) and never `Math.random`, so the same seed
 * gives the same numbers on every machine. The ground tint and the scenery layout (design 018) are built from it, which
 * makes a world look the same on every visit.
 */

/** Hashes a string to an unsigned 32-bit seed (FNV-1a). */
export function hashStringToSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Creates a mulberry32 generator returning numbers in [0, 1) from a 32-bit seed. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash of an integer lattice point and a seed to [0, 1].
function latticeValue(seed: number, ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Lattice value noise at (x, y) in [0, 1]: smoothstep interpolation of hashed values at the integer corners. */
export function valueNoise2(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const v00 = latticeValue(seed, x0, y0);
  const v10 = latticeValue(seed, x0 + 1, y0);
  const v01 = latticeValue(seed, x0, y0 + 1);
  const v11 = latticeValue(seed, x0 + 1, y0 + 1);
  const bottom = v00 + (v10 - v00) * tx;
  const top = v01 + (v11 - v01) * tx;
  return bottom + (top - bottom) * ty;
}

/** Sum of `octaves` layers of value noise (each twice the frequency and half the weight), normalised to [0, 1]. */
export function fractalNoise2(seed: number, x: number, y: number, octaves: number): number {
  const count = Math.max(1, Math.floor(octaves));
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < count; octave += 1) {
    sum += amplitude * valueNoise2(seed + Math.imul(octave, 0x632be5ab), x * frequency, y * frequency);
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / weight;
}
