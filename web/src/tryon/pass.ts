// One try-on pass, the same for the app (shoot.ts) and the eval page: show the model the part of the photo it dresses
// (frame.ts), run it, and put its result back into the full-resolution photo (composite.ts). The result is the photo
// wearing the garment, which the next pass starts from.
import type { Body } from '../photos/body';
import { compositePass, sameFraming } from './composite';
import { cropImage, imageSize, personBox, type Box } from './frame';
import { cancelledError, type GarmentPhotoType, type SpaceStatus, type TryOnCategory, type TryOnRunner } from './space';

/** Data URL of a result image (kept in memory like every photo; also what the Download link saves). */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/webp'};base64,${btoa(binary)}`;
}

/**
 * The part of `base` (the photo, maybe already wearing the top) to show the model for `category`, or null for all of
 * it. Landmarks come from the photo itself, so they only apply while `base` has the photo's shape.
 */
export async function frameFor(base: string, photo: string, body: Body | null, category: TryOnCategory): Promise<Box | null> {
  if (!body) return null;
  try {
    const [size, photoSize] = await Promise.all([imageSize(base), base === photo ? null : imageSize(photo)]);
    if (photoSize && !sameFraming(size, photoSize)) return null;
    return personBox(body, category, size.width, size.height);
  } catch {
    return null;
  }
}

export interface PassGarment {
  blob: Blob;
  type: GarmentPhotoType;
  category: TryOnCategory;
  /** The colour reads as skin: don't keep the shopper's skin in this pass, where the garment could pass for it. */
  skinTone?: boolean;
}

/**
 * `garment` on `base` (a data URL at the photo's resolution). `body`: landmarks of `photo` (null = send all of `base`).
 * Resolves to the new base and the box the model was shown; throws what the runner throws.
 */
export async function dressPass(
  base: string,
  photo: string,
  body: Body | null,
  garment: PassGarment,
  run: TryOnRunner,
  onStatus: (s: SpaceStatus) => void,
  signal?: AbortSignal,
): Promise<{ image: string; box: Box | null }> {
  let box = await frameFor(base, photo, body, garment.category);
  let person = box ? await cropImage(base, box).catch(() => null) : null;
  if (!person) {
    box = null;
    person = await (await fetch(base)).blob();
  }
  if (signal?.aborted) throw cancelledError();
  const result = await run(person, garment.blob, garment.category, garment.type, onStatus, signal);
  const image = await compositePass(base, result, box, await blobToDataUrl(result), { keepSkin: !garment.skinTone });
  return { image, box };
}
