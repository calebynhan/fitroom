/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "openai" for the paid four-view generator; anything else (or unset) = the free try-on Space. */
  readonly VITE_PHOTO_ENGINE?: string;
}
