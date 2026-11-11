// UNIQLO's garment-only shot for a catalogue photo: the garment alone on a plain backdrop, which try-on reproduces
// without the catalogue model's styling (see CLAUDE.md, Photo engines). Shared by the web app (web/src/tryon/garment.ts)
// and the ChatGPT plugin (api/_lib/mcp/tryOn.ts).

/**
 * The garment-only shot for a catalogue photo, if the URL follows UNIQLO's pattern:
 * /uniqlo/UQ/ST3/us/imagesgoods/453754/item/usgoods_67_453754_3x4.jpg
 *   -> /uniqlo/UQ/ST3/WesternCommon/imagesgoods/453754/item/goods_67_453754_3x4.jpg
 */
export function garmentOnlyUrl(url: string): string | null {
  const m = url.match(/^(.*\/UQ\/ST3\/)us(\/imagesgoods\/\d+\/item\/)usgoods_([A-Za-z0-9]+_\d+_3x4\.jpg)$/);
  return m ? `${m[1]}WesternCommon${m[2]}goods_${m[3]}` : null;
}
