import type { View } from '@api/look';

/** File extension for a data URL's image type (try-on results can be WebP when they aren't composited). */
export function extensionOf(dataUrl: string | undefined): string {
  const type = dataUrl?.match(/^data:image\/([a-z]+)/i)?.[1]?.toLowerCase();
  return type === 'webp' ? 'webp' : type === 'png' ? 'png' : 'jpg';
}

export const downloadName = (view: View, image?: string): string => `fitroom-${view.replace('_', '-')}.${extensionOf(image)}`;

/** "fitroom-front-size-M.jpg" for a size comparison photo. */
export const compareDownloadName = (size: string): string => `fitroom-front-size-${size.replace(/[^A-Za-z0-9]+/g, '')}.jpg`;
