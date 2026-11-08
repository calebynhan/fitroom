// Typed measurements <-> MHR body weights, per CLAUDE.md:
// w = default + pinv(J) @ (target_cm - measured_cm_at_default), clamped to -3..3.

export const WEIGHT_LIMIT = 3;
export const BASE_HEIGHT_CM = 178; // body.glb is exported at this height
export const SLIDER_COUNT = 4; // Build / Chest / Waist / Hips -> body_0..body_3
export const SLIDER_LABELS = ['Build', 'Chest', 'Waist', 'Hips'] as const;

export type Girth = 'chest' | 'waist' | 'hips';
export const GIRTHS: Girth[] = ['chest', 'waist', 'hips'];
export type Girths = Record<Girth, number>;

export interface BodyMeasure {
  default_weights: number[];
  measured_cm_at_default: Girths;
  jacobian_cm_per_unit: Record<Girth, number[]>;
}

export const DEFAULT_GIRTHS: Girths = { chest: 92, waist: 75, hips: 90 };

const clamp = (v: number, lim = WEIGHT_LIMIT) => Math.min(lim, Math.max(-lim, v));

export function parseBodyMeasure(data: unknown): BodyMeasure | null {
  const d = data as Partial<BodyMeasure> | null;
  const okVec = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');
  if (!d || !okVec(d.default_weights)) return null;
  const m = d.measured_cm_at_default;
  const j = d.jacobian_cm_per_unit;
  if (!m || !j || !GIRTHS.every((g) => typeof m[g] === 'number' && okVec(j[g]))) return null;
  return d as BodyMeasure;
}

function invert3(m: number[][]): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-9) return null;
  const inv = [
    [A, -(b * i - c * h), b * f - c * e],
    [B, a * i - c * g, -(a * f - c * d)],
    [C, -(a * h - b * g), a * e - b * d],
  ];
  return inv.map((row) => row.map((v) => v / det));
}

/** Minimum-norm weight change that hits the target girths (J is 3 x n). */
export function weightsForGirths(measure: BodyMeasure, target: Girths): number[] {
  const J = GIRTHS.map((g) => measure.jacobian_cm_per_unit[g]);
  const n = measure.default_weights.length;
  const JJt = J.map((ri) => J.map((rj) => ri.reduce((s, v, k) => s + v * (rj[k] ?? 0), 0)));
  const inv = invert3(JJt);
  if (!inv) return [...measure.default_weights];
  const delta = GIRTHS.map((g) => target[g] - measure.measured_cm_at_default[g]);
  const y = inv.map((row) => row.reduce((s, v, k) => s + v * delta[k], 0)); // (J J^T)^-1 delta
  return Array.from({ length: n }, (_, k) => clamp(measure.default_weights[k] + J.reduce((s, row, r) => s + (row[k] ?? 0) * y[r], 0)));
}

/** Linear estimate of girths for the given weights. */
export function girthsForWeights(measure: BodyMeasure, weights: number[]): Girths {
  const est = (g: Girth) =>
    measure.measured_cm_at_default[g] +
    measure.jacobian_cm_per_unit[g].reduce((s, v, k) => s + v * ((weights[k] ?? 0) - (measure.default_weights[k] ?? 0)), 0);
  return { chest: est('chest'), waist: est('waist'), hips: est('hips') };
}

export function setWeight(weights: number[], index: number, value: number): number[] {
  return weights.map((w, i) => (i === index ? clamp(value) : w));
}
