// The image prompt for one view of a personalised look. Pure: no I/O.
import type { BodySpec, Ease, Length, LookPiece, Scene, View } from './look';

export const SCENE_SETTINGS: Record<Scene, string> = {
  studio:
    'an online clothing store product photo: seamless light-grey studio backdrop, soft even lighting, a faint shadow on the floor',
  city: 'a city street in daylight, shallow depth of field with softly blurred buildings behind',
  night: 'a city street at night, warm key light from street lamps and a cool blue rim light',
};

export const VIEW_DIRECTIONS: Record<View, string> = {
  front: 'Front view: the person faces the camera squarely and looks into the lens.',
  three_quarter:
    "Three-quarter view: the body is turned about 45 degrees so the camera sees the front and the person's left side; the face turns slightly back toward the camera.",
  side: "Side view: the body is turned 90 degrees with the person's left side toward the camera, face in left profile, looking straight ahead.",
  back: 'Back view: the person faces directly away from the camera; we see the back of the head, the back of the outfit and the backs of the shoes. The face is not visible.',
};

const EASE_TOP: Record<Ease, string> = {
  close: 'close-fitting, skimming the chest and shoulders with little spare room',
  regular: 'a regular fit with a little room through the chest and waist',
  relaxed: 'a relaxed fit with visible room; the fabric falls away from the body',
  oversized: 'an oversized fit: the shoulder seams drop past the shoulders and the body hangs loose and wide',
};
const EASE_BOTTOM: Record<Ease, string> = {
  close: 'slim through the hip and thigh',
  regular: 'a regular fit through the hip and thigh',
  relaxed: 'a relaxed, roomy fit through the hip and thigh',
  oversized: 'a very wide, baggy fit',
};
const LENGTH_TOP: Partial<Record<Length, string>> = {
  cropped: 'the hem ends at or above the waistband',
  regular: 'the hem sits at the hip',
  long: 'the hem falls below the hip',
};
const LENGTH_BOTTOM: Partial<Record<Length, string>> = {
  cropped: 'cropped above the ankle',
  ankle: 'ankle-length: the hem stops at the ankle bone',
  full: 'full length with a slight break over the shoe',
  long: 'long: the fabric stacks over the shoe',
};

export interface ImageRoles {
  /** A finished front shot of this look is attached after the three photos. */
  reference: boolean;
  /** Product photos attached, in this order, after the photos (and reference). */
  products: ('top' | 'bottom')[];
}

const cmToFeet = (cm: number): string => {
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
};

/** "Image 1: ..." lines, in the order the server attaches the images. */
export function describeImages(roles: ImageRoles): string[] {
  const lines = [
    'the person, front view, full body',
    'the same person, side view, full body',
    "the same person's face in left profile, close-up",
  ];
  if (roles.reference) {
    lines.push(
      'the finished front photo of this exact look; match it exactly: same person, same garments, same shoes, same lighting and backdrop',
    );
  }
  for (const slot of roles.products) lines.push(`product photo of the ${slot === 'top' ? 'top' : 'bottoms'} to wear`);
  return lines.map((l, i) => `Image ${i + 1}: ${l}.`);
}

export function describeBody(b: BodySpec): string {
  const lb = Math.round(b.weightKg * 2.2046);
  return (
    `They are ${Math.round(b.heightCm)} cm (${cmToFeet(b.heightCm)}) tall and weigh ${Math.round(b.weightKg)} kg (${lb} lb); ` +
    `chest ${Math.round(b.chestCm)} cm, waist ${Math.round(b.waistCm)} cm, hips ${Math.round(b.hipsCm)} cm, inseam ${Math.round(b.inseamCm)} cm.`
  );
}

export function describePiece(p: LookPiece): string {
  const label = p.slot === 'top' ? 'Top' : 'Bottoms';
  const fabric = p.fabric ? `, ${p.fabric}` : '';
  const size = p.size ? `, size ${p.size}` : '';
  const fit: string[] = [];
  if (p.ease) fit.push((p.slot === 'top' ? EASE_TOP : EASE_BOTTOM)[p.ease]);
  const length = p.length && (p.slot === 'top' ? LENGTH_TOP : LENGTH_BOTTOM)[p.length];
  if (length) fit.push(length);
  const fitText = fit.length ? ` On this body: ${fit.join('; ')}.` : '';
  const worn = p.slot === 'top' ? ' Worn untucked.' : '';
  return `${label}: UNIQLO "${p.name}" in ${p.color}${fabric}${size}.${fitText}${worn}`;
}

export interface PromptInput {
  view: View;
  scene: Scene;
  body: BodySpec;
  items: LookPiece[];
  roles: ImageRoles;
}

export function buildLookPrompt({ view, scene, body, items, roles }: PromptInput): string {
  const productRef = roles.products.length
    ? ' Reproduce each garment exactly as in its product photo: colour, fabric texture, neckline, cuffs, seams and silhouette.'
    : ' Reproduce each garment faithfully: colour, fabric texture, neckline, cuffs and silhouette.';
  return [
    'A photorealistic full-length photograph of the person in the reference photos, wearing the outfit below, as on a clothing store product page.',
    VIEW_DIRECTIONS[view],
    '',
    'Reference images, in order:',
    ...describeImages(roles),
    '',
    "The person: keep their identity exactly: face, skin tone, hair colour, length and style, facial hair, glasses if they wear them, and their real body shape and proportions. " +
      `${describeBody(body)} Do not make them slimmer, more muscular, taller or younger. Ignore the clothes they wear in Images 1-3.`,
    '',
    'The outfit:',
    ...items.map(describePiece),
    `${productRef.trim()} The fit and length follow from the size on this body, as described. Plain white low-top leather sneakers.`,
    '',
    'Pose and framing: standing naturally like a clothing model, arms relaxed at the sides, calm neutral expression. ' +
      'Head to toe in frame with a little space above the head and below the feet; camera at chest height; 2:3 portrait.',
    `Setting: ${SCENE_SETTINGS[scene]}.`,
    'Photorealistic, sharp, true-to-life colours. One person only. No logos, no text, no watermark.',
  ].join('\n');
}
