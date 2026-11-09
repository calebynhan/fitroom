import type { View } from '@api/look';

export const downloadName = (view: View): string => `fitroom-${view.replace('_', '-')}.jpg`;
