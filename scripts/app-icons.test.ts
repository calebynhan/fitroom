// The installable web app: the manifest and the icons it and web/index.html point at (made by scripts/app-icons.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pub = fileURLToPath(new URL('../web/public/', import.meta.url));
const html = readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
const manifest = JSON.parse(readFileSync(`${pub}manifest.webmanifest`, 'utf8')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

/** Width, height and whether the PNG has an alpha channel (colour types 4 and 6), from its IHDR chunk. */
function png(path: string) {
  const b = readFileSync(path);
  expect(b.subarray(1, 4).toString()).toBe('PNG');
  expect(b.subarray(12, 16).toString()).toBe('IHDR');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 };
}

describe('installable web app', () => {
  it('has a manifest browsers accept for install', () => {
    expect(manifest.name).toBe('FitRoom');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12); // the home-screen label
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('points at icons that exist at the sizes it states', () => {
    for (const icon of manifest.icons) {
      const file = `${pub}${icon.src.replace(/^\//, '')}`;
      expect(existsSync(file), icon.src).toBe(true);
      expect(icon.type).toBe('image/png');
      const { width, height } = png(file);
      expect(`${width}x${height}`).toBe(icon.sizes);
    }
  });

  it('links the manifest and an opaque 180 px apple-touch-icon (iOS shows transparency as black)', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    const href = html.match(/<link rel="apple-touch-icon" href="\/([^"]+)"/)?.[1];
    expect(href).toBe('apple-touch-icon.png');
    expect(png(`${pub}${href}`)).toEqual({ width: 180, height: 180, alpha: false });
  });
});
