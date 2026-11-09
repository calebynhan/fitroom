// Procedural, tileable fabric detail: a normal map (weave/knit relief) and a greyscale albedo multiplier
// (heather, denim weft flecks). Generated once per fabric on a canvas; no downloads.
import * as THREE from 'three';

const SIZE = 512;

export interface FabricPattern {
  /** Physical size (m) of one texture tile on the garment. */
  tileMetres: number;
  /** Relief strength for the normal map. */
  normalStrength: number;
  height: (u: number, v: number, x: number, y: number) => number;
  albedo: (u: number, v: number, x: number, y: number, h: number) => number;
}

const frac = (n: number) => n - Math.floor(n);
const TAU = Math.PI * 2;

/** Tileable per-pixel noise in [0, 1). */
function hash(x: number, y: number): number {
  const xi = ((x % SIZE) + SIZE) % SIZE;
  const yi = ((y % SIZE) + SIZE) % SIZE;
  const s = Math.sin(xi * 127.1 + yi * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth tileable value noise at a cell size in pixels. */
function smoothNoise(x: number, y: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const cells = SIZE / cell;
  const at = (i: number, j: number) => hash(((gx + i) % cells) * 7, ((gy + j) % cells) * 13);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
  const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
  return top + (bottom - top) * sy;
}

/** Knit "V" stitches: columns of chevrons. */
function knitStitch(u: number, v: number, cols: number, rows: number): number {
  const x = frac(u * cols) - 0.5;
  return 0.5 + 0.5 * Math.sin(TAU * (v * rows + Math.abs(x) * 1.6));
}

export const PATTERNS: Record<string, FabricPattern> = {
  // Washable Milano ribbed sweater: pronounced vertical wales over a knit stitch.
  rib_knit: {
    tileMetres: 0.05,
    normalStrength: 3.2,
    height: (u, v) => 0.75 * Math.pow(Math.abs(Math.sin(Math.PI * 5 * u)), 0.7) + 0.25 * knitStitch(u, v, 20, 28),
    albedo: (_u, _v, x, y, h) => 0.82 + 0.14 * h + 0.04 * smoothNoise(x, y, 16),
  },
  // Cashmere: fine soft knit with a fuzzy, uneven surface.
  cashmere: {
    tileMetres: 0.05,
    normalStrength: 1.4,
    height: (u, v, x, y) => 0.6 * knitStitch(u, v, 22, 30) + 0.4 * smoothNoise(x, y, 8),
    albedo: (_u, _v, x, y, h) => 0.86 + 0.08 * h + 0.06 * smoothNoise(x, y, 32),
  },
  // 1x1 rib for collars, cuffs and hem bands (drawn over any fabric by the COLOR_0 rib mask): ~4 mm wales.
  rib_band: {
    tileMetres: 0.02,
    normalStrength: 2.6,
    height: (u, v) => 0.8 * Math.pow(Math.abs(Math.sin(Math.PI * 5 * u)), 0.6) + 0.2 * knitStitch(u, v, 10, 36),
    albedo: (_u, _v, _x, _y, h) => 0.9 + 0.1 * h,
  },
  // Cotton jersey tee: tiny stitches plus heather (melange) variation.
  jersey: {
    tileMetres: 0.04,
    normalStrength: 1.1,
    height: (u, v) => knitStitch(u, v, 28, 38),
    albedo: (_u, _v, x, y, h) => 0.84 + 0.06 * h + 0.1 * (0.6 * hash(x, y) + 0.4 * smoothNoise(x, y, 4)),
  },
  // Denim: 3/1 right-hand twill diagonals, white weft flecks and slubby warp streaks.
  denim: {
    tileMetres: 0.035,
    normalStrength: 2.4,
    height: (u, v) => 0.5 + 0.5 * Math.sin(TAU * 18 * (u + v)),
    albedo: (u, v, x, y, h) => {
      const slub = smoothNoise(x * 0.25, y * 4, 8); // long vertical streaks
      const weft = Math.pow(0.5 + 0.5 * Math.sin(TAU * 18 * (u + v)), 6); // weft showing between twill lines
      return 0.72 + 0.16 * slub + 0.22 * weft + 0.05 * hash(x, y) - 0.04 * h;
    },
  },
  // Chino/stretch twill: fine diagonal, subtle.
  twill: {
    tileMetres: 0.03,
    normalStrength: 1.3,
    height: (u, v) => 0.5 + 0.5 * Math.sin(TAU * 26 * (u + v)),
    albedo: (_u, _v, x, y, h) => 0.88 + 0.06 * h + 0.06 * smoothNoise(x, y, 6),
  },
};

export interface FabricMaps {
  normalMap: THREE.CanvasTexture;
  map: THREE.CanvasTexture;
}

function makeTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace; // linear data / multiplier
  return tex;
}

function generate(pattern: FabricPattern): FabricMaps {
  const heights = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) heights[y * SIZE + x] = pattern.height(x / SIZE, y / SIZE, x, y);
  }
  const normalCanvas = document.createElement('canvas');
  const albedoCanvas = document.createElement('canvas');
  normalCanvas.width = albedoCanvas.width = SIZE;
  normalCanvas.height = albedoCanvas.height = SIZE;
  const nctx = normalCanvas.getContext('2d');
  const actx = albedoCanvas.getContext('2d');
  if (!nctx || !actx) throw new Error('2D canvas unavailable');
  const nImg = nctx.createImageData(SIZE, SIZE);
  const aImg = actx.createImageData(SIZE, SIZE);
  const h = (x: number, y: number) => heights[(((y + SIZE) % SIZE) * SIZE) + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * pattern.normalStrength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * pattern.normalStrength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * SIZE + x) * 4;
      nImg.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      nImg.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      nImg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nImg.data[i + 3] = 255;
      const a = Math.max(0, Math.min(1, pattern.albedo(x / SIZE, y / SIZE, x, y, h(x, y)))) * 255;
      aImg.data[i] = aImg.data[i + 1] = aImg.data[i + 2] = a;
      aImg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nImg, 0, 0);
  actx.putImageData(aImg, 0, 0);
  return { normalMap: makeTexture(normalCanvas), map: makeTexture(albedoCanvas) };
}

const cache = new Map<string, FabricMaps>();

/** Shared base maps per fabric (callers clone to set their own repeat). */
export function fabricMaps(fabric: string): FabricMaps {
  const key = PATTERNS[fabric] ? fabric : 'jersey';
  const hit = cache.get(key);
  if (hit) return hit;
  const maps = generate(PATTERNS[key]);
  cache.set(key, maps);
  return maps;
}

/** Metres of garment surface per UV unit, from total world vs UV triangle area. */
export function metresPerUv(geometry: THREE.BufferGeometry): number | null {
  const pos = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!pos || !uv) return null;
  const index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let world = 0;
  let uvArea = 0;
  for (let i = 0; i < count; i += 3) {
    const [i0, i1, i2] = index ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)] : [i, i + 1, i + 2];
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    world += b.sub(a).cross(c.sub(a)).length() / 2;
    const du1 = uv.getX(i1) - uv.getX(i0);
    const dv1 = uv.getY(i1) - uv.getY(i0);
    const du2 = uv.getX(i2) - uv.getX(i0);
    const dv2 = uv.getY(i2) - uv.getY(i0);
    uvArea += Math.abs(du1 * dv2 - du2 * dv1) / 2;
  }
  return uvArea > 1e-9 ? Math.sqrt(world / uvArea) : null;
}
