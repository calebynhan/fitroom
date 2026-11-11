// Renders the home-screen icons from web/public/favicon.svg (the one source of the mark):
//   web/public/apple-touch-icon.png  180 px, iOS "Add to Home Screen" (iOS rounds the corners itself)
//   web/public/icons/icon-192.png    manifest, Android / desktop install
//   web/public/icons/icon-512.png    manifest, splash screens; also the maskable icon (the F sits inside the safe zone)
// The SVG draws the F as a path (Cormorant Garamond 500), so the result doesn't depend on installed fonts.
// Needs Playwright with Chromium (`npx playwright install chromium` if it isn't on the machine). Run: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(`${root}web/public/favicon.svg`, 'utf8');
const outputs = [
  ['web/public/apple-touch-icon.png', 180],
  ['web/public/icons/icon-192.png', 192],
  ['web/public/icons/icon-512.png', 512],
];

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.error('Playwright is not installed: npm i -D playwright && npx playwright install chromium, then run this again.');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  mkdirSync(`${root}web/public/icons`, { recursive: true });
  for (const [file, size] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(`<style>html,body{margin:0;background:#111111}img{display:block}</style><img src="${src}" width="${size}" height="${size}">`);
    await page.locator('img').evaluate((img) => img.decode());
    writeFileSync(`${root}${file}`, await page.screenshot({ type: 'png' }));
    await page.close();
    console.log(`${file} (${size} px)`);
  }
} finally {
  await browser.close();
}
