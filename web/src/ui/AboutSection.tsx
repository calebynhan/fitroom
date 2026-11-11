import { TRY_ON } from '../look/engine';
import { SPACE_PAGE } from '../tryon/space';

/** How it works, what happens to your data, and whose work this stands on. */
export function AboutSection() {
  return (
    <section className="rail-section about" id="about" aria-labelledby="about-title">
      <h2 className="eyebrow" id="about-title">
        How it works
      </h2>
      <ol className="about-steps">
        <li>
          <strong>Your size.</strong> FitRoom checks UNIQLO's size charts against your height, weight and any measurements you
          add, picks the size to buy, and says when it's a close call.
        </li>
        {TRY_ON ? (
          <li>
            <strong>The clothes on you.</strong> A free try-on model repaints only the clothes in your own photo; your face, body,
            pose and background stay yours.
          </li>
        ) : (
          <li>
            <strong>The clothes on you.</strong> Your photos become four shots (front, three-quarter, side, back) of you in the
            outfit, in the size you chose.
          </li>
        )}
        <li>
          <strong>The fit in numbers.</strong> {TRY_ON ? 'The photo shows the garment as UNIQLO photographed it; the' : 'The'} fit
          card shows how your size sits: room at the chest or hips, where the hem lands, against one size either side.
        </li>
      </ol>
      <p className="note">
        <strong>Your data.</strong> Photos stay in this tab and FitRoom never stores them. Measurements and saved outfits stay in
        this browser. Share links carry the outfit only. Page counts are anonymous, without cookies.
      </p>
      <p className="note fine">
        {TRY_ON && (
          <>
            Try-on by{' '}
            <a href={SPACE_PAGE} target="_blank" rel="noreferrer">
              FASHN VTON v1.5
            </a>{' '}
            (Apache-2.0) on Hugging Face's free GPUs, which allow a few try-ons a day per connection.{' '}
          </>
        )}
        Product names, photos and size charts are UNIQLO's, used for a non-commercial demo; FitRoom isn't affiliated with UNIQLO.
        Every item links to{' '}
        <a href="https://www.uniqlo.com/us/en/" target="_blank" rel="noreferrer">
          uniqlo.com
        </a>
        .
      </p>
    </section>
  );
}
