import jpeg from 'jpeg-js';

const CHIP_TIMEOUT_MS = 5000;
const CENTER_FRACTION = 0.5; // sample the middle 50% of the swatch to avoid borders/shadows

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function toHex(rgb: number[]): string {
  return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Per-channel median of the centre region of an RGBA buffer. */
export function centerMedianHex(data: Uint8Array, width: number, height: number): string {
  const x0 = Math.floor((width * (1 - CENTER_FRACTION)) / 2);
  const y0 = Math.floor((height * (1 - CENTER_FRACTION)) / 2);
  const x1 = width - x0;
  const y1 = height - y0;
  const channels: number[][] = [[], [], []];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      channels[0].push(data[i]);
      channels[1].push(data[i + 1]);
      channels[2].push(data[i + 2]);
    }
  }
  return toHex(channels.map(median));
}

/** Downloads a UNIQLO swatch JPEG and returns its dominant colour, or null on any failure. */
export async function sampleChipHex(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CHIP_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return centerMedianHex(img.data, img.width, img.height);
  } catch {
    return null; // caller falls back to the colour-code ramp
  }
}
