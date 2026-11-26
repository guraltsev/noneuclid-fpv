/**
 * Seeded, platform-independent pseudo-randomness and smooth noise for generated world detail.
 *
 * Everything here is integer math (`Math.imul`, `>>> 0`) plus a few float operations that are exactly rounded, so the same seed gives
 * the same numbers on every machine. Nothing uses `Math.random`: a world file must give the same world on every visit.
 */

/** Hashes text to a 32-bit unsigned seed with FNV-1a. */
export function hashStringToSeed(text: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/** Creates a mulberry32 generator: each call returns the next number in [0, 1) of the sequence of `seed`. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash of one integer lattice point to [0, 1].
function latticeValue(seed: number, ix: number, iy: number): number {
  let hash = (seed >>> 0) ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1]: random values on the integer lattice, interpolated with a smoothstep; features are about 1 unit wide. */
export function valueNoise2(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep01(x - x0);
  const ty = smoothstep01(y - y0);
  const bottom = latticeValue(seed, x0, y0) * (1 - tx) + latticeValue(seed, x0 + 1, y0) * tx;
  const top = latticeValue(seed, x0, y0 + 1) * (1 - tx) + latticeValue(seed, x0 + 1, y0 + 1) * tx;
  return bottom * (1 - ty) + top * ty;
}

/** Sum of `octaves` value-noise layers, each twice as fine and half as strong as the one before, normalized to [0, 1]. */
export function fractalNoise2(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  let frequency = 1;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise2((seed + Math.imul(octave, 0x9e3779b1)) >>> 0, x * frequency, y * frequency);
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return weight > 0 ? sum / weight : 0;
}
