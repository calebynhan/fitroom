import type { View } from '@api/look';

export const downloadName = (view: View): string => `fitroom-${view.replace('_', '-')}.jpg`;

/** "fitroom-front-size-M.jpg" for a size comparison photo. */
export const compareDownloadName = (size: string): string => `fitroom-front-size-${size.replace(/[^A-Za-z0-9]+/g, '')}.jpg`;
