const OUT_WIDTH = 1024;
const OUT_HEIGHT = 1536; // matches the 2:3 portrait size requested from the image model

/** Crops the centre 2:3 portrait of the viewer canvas (where the avatar stands) and returns a PNG data URL. */
export function snapshotPortrait(source: HTMLCanvasElement): string {
  const cropH = source.height;
  const cropW = Math.min(source.width, Math.round((cropH * OUT_WIDTH) / OUT_HEIGHT));
  const sx = Math.round((source.width - cropW) / 2);
  const scale = Math.min(1, OUT_HEIGHT / cropH);
  const out = document.createElement('canvas');
  out.width = Math.round(cropW * scale);
  out.height = Math.round(cropH * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(source, sx, 0, cropW, cropH, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
