import { describe, expect, it } from 'vitest';
import type { Body } from '../photos/body';
import { garmentBounds, garmentFrame, grow23, MIN_GAIN, personBox } from './frame';

// MediaPipe's landmarks (x, y, visibility) on a real full-length front photo, 720x1280 (9:16, like the app's front
// photo): a man standing, arms at his sides (FASHN's example person, 2026-11-14).
const STANDING: Body = [
  [0.484, 0.175, 1], [0.504, 0.158, 1], [0.516, 0.158, 1], [0.527, 0.159, 1], [0.463, 0.157, 1], [0.449, 0.157, 1],
  [0.437, 0.157, 1], [0.54, 0.168, 1], [0.426, 0.163, 1], [0.508, 0.196, 1], [0.459, 0.194, 1], [0.635, 0.284, 1],
  [0.329, 0.287, 1], [0.677, 0.428, 0.98], [0.283, 0.435, 0.98], [0.689, 0.553, 0.97], [0.276, 0.553, 0.97],
  [0.696, 0.59, 0.95], [0.262, 0.593, 0.94], [0.67, 0.588, 0.95], [0.293, 0.592, 0.94], [0.664, 0.576, 0.95],
  [0.302, 0.579, 0.94], [0.56, 0.549, 1], [0.396, 0.551, 1], [0.573, 0.739, 0.99], [0.385, 0.737, 0.99],
  [0.575, 0.898, 0.99], [0.388, 0.904, 0.99], [0.555, 0.923, 0.85], [0.423, 0.928, 0.84], [0.641, 0.969, 0.98],
  [0.349, 0.969, 0.98],
].map(([x, y, v]) => ({ x, y, v }));

const W = 864;
const H = 1536;
const gain = (b: { w: number; h: number }) => Math.min(576 / b.w, 864 / b.h) / Math.min(576 / W, 864 / H);
const inside = (b: { x: number; y: number; w: number; h: number }) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H;

describe('the part of the photo the model is shown', () => {
  it('a top: the whole head to mid-thigh, arms and hands included, at 2:3', () => {
    const box = personBox(STANDING, 'tops', W, H)!;
    expect(box).not.toBeNull();
    expect(inside(box)).toBe(true);
    expect(box.w / box.h).toBeCloseTo(2 / 3, 2);
    const px = (i: number) => ({ x: STANDING[i].x * W, y: STANDING[i].y * H });
    // above the hair (the nose sits well below the head's top)
    expect(box.y).toBeLessThan(px(0).y - 1.2 * (px(11).y - px(0).y));
    // below the hips and the fingertips, above the knees
    expect(box.y + box.h).toBeGreaterThan(Math.max(px(23).y, px(18).y) + 50);
    expect(box.y + box.h).toBeLessThan(px(25).y);
    // both hands inside, with room to spare
    expect(box.x).toBeLessThan(px(18).x - 40);
    expect(box.x + box.w).toBeGreaterThan(px(17).x + 40);
    expect(gain(box)).toBeGreaterThan(1.45);
  });

  it('bottoms: from the chest (the top hem and waistband inside) to below the feet', () => {
    const box = personBox(STANDING, 'bottoms', W, H)!;
    expect(box).not.toBeNull();
    expect(inside(box)).toBe(true);
    expect(box.w / box.h).toBeCloseTo(2 / 3, 2);
    const y = (i: number) => STANDING[i].y * H;
    expect(box.y).toBeLessThan(y(23) - 150); // well above the hips
    expect(box.y).toBeGreaterThan(y(11)); // below the shoulders
    expect(box.y + box.h).toBeGreaterThanOrEqual(Math.min(H, y(31) + 20)); // the shoes
    expect(gain(box)).toBeGreaterThan(1.55);
  });

  it('scales with the photo: the same body at another size gives the same framing', () => {
    const a = personBox(STANDING, 'tops', W, H)!;
    const b = personBox(STANDING, 'tops', W / 2, H / 2)!;
    expect(b.x * 2).toBeCloseTo(a.x, -1);
    expect(b.h * 2).toBeCloseTo(a.h, -1);
  });

  it('sends the whole photo when the body is unclear, missing or the crop would gain little', () => {
    expect(personBox(null, 'tops', W, H)).toBeNull();
    expect(personBox(STANDING.slice(0, 20), 'tops', W, H)).toBeNull();
    const noShoulders = STANDING.map((p, i) => (i === 11 || i === 12 ? { ...p, v: 0.1 } : p));
    expect(personBox(noShoulders, 'tops', W, H)).toBeNull();
    const upsideDown = STANDING.map((p) => ({ ...p, y: 1 - p.y }));
    expect(personBox(upsideDown, 'bottoms', W, H)).toBeNull();
    // a photo already framed head to mid-thigh: cropping the top gains nothing
    const framed = STANDING.map((p) => ({ ...p, y: (p.y - 0.12) / 0.62 }));
    expect(personBox(framed, 'tops', 576, 864)).toBeNull();
    expect(MIN_GAIN).toBeGreaterThan(1);
  });

  it('a body cut off at the shins still gets a bottoms crop down to the photo edge', () => {
    const shins = STANDING.map((p, i) => (i >= 27 ? { ...p, v: 0.05 } : p));
    const box = personBox(shins, 'bottoms', W, H)!;
    expect(box.y + box.h).toBe(H);
  });

  it('grows a box to 2:3 around its centre and keeps it inside the image', () => {
    expect(grow23({ x: 100, y: 100, w: 200, h: 200 }, 1000, 1000)).toEqual({ x: 100, y: 50, w: 200, h: 300 });
    expect(grow23({ x: 0, y: 0, w: 100, h: 600 }, 1000, 1000)).toEqual({ x: 0, y: 0, w: 400, h: 600 });
    const edge = grow23({ x: 900, y: 900, w: 100, h: 100 }, 1000, 1000);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1000);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1000);
    const narrow = grow23({ x: 0, y: 0, w: 400, h: 100 }, 400, 400);
    expect(narrow).toEqual({ x: 0, y: 0, w: 400, h: 400 });
  });
});

function photo(w: number, h: number, paint: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) px.set([...paint(x, y), 255], (y * w + x) * 4);
  return px;
}

describe('the garment photo the model is shown', () => {
  // a 3:4 garment-only shot: a grey sweater on an off-white backdrop with a wide margin, a few JPEG specks
  const [w, h] = [150, 200];
  const flat = photo(w, h, (x, y) => {
    if ((x === 5 && y === 190) || (x === 140 && y === 8)) return [200, 200, 200];
    return x >= 30 && x < 120 && y >= 45 && y < 155 ? [150, 150, 152] : [236, 236, 234];
  });

  it('finds the garment on a plain backdrop, ignoring specks', () => {
    const found = garmentBounds(flat, w, h)!;
    expect(found.box).toEqual({ x: 30, y: 45, w: 90, h: 110 });
    expect(found.backdrop.map(Math.round)).toEqual([236, 236, 234]);
  });

  it('gives up on a photo without a plain backdrop, or with nothing on it', () => {
    const scene = photo(w, h, (x, y) => (x < 75 ? [40, 90, 30] : y < 100 ? [200, 200, 220] : [120, 80, 60]));
    expect(garmentBounds(scene, w, h)).toBeNull();
    expect(garmentBounds(photo(w, h, () => [236, 236, 234]), w, h)).toBeNull();
  });

  it('crops to the garment with a small margin, centred on a 2:3 canvas', () => {
    const frame = garmentFrame({ x: 300, y: 450, w: 900, h: 1100 }, 1500, 2000, [236, 236, 234])!;
    expect(frame.crop.x).toBeLessThan(300);
    expect(frame.crop.x).toBeGreaterThan(260);
    expect(frame.canvas.w / frame.canvas.h).toBeCloseTo(2 / 3, 2);
    expect(frame.canvas.w).toBeGreaterThanOrEqual(frame.crop.w);
    expect(frame.canvas.h).toBeGreaterThanOrEqual(frame.crop.h);
    expect(frame.at.x * 2 + frame.crop.w).toBeCloseTo(frame.canvas.w, -1);
  });

  it('leaves a garment that already fills the photo as it is', () => {
    expect(garmentFrame({ x: 20, y: 20, w: 1460, h: 1960 }, 1500, 2000, [255, 255, 255])).toBeNull();
  });
});
