/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "openai" for the paid four-view generator; anything else (or unset) = the free try-on Space. */
  readonly VITE_PHOTO_ENGINE?: string;
  /** "owner/name" of our own duplicate of the FASHN VTON v1.5 Space; unset = FASHN's (always the fallback). */
  readonly VITE_TRYON_SPACE?: string;
}
