/**
 * Punto de entrada de `public/embed/embed.js` (F39). La Tanda B lo compila
 * (esbuild, formato iife) y lo sirve en `/embed/embed.js`. En la tanda A no
 * está integrado al build: solo existe la fuente y sus tests.
 */
import { bootstrap, type EmbedDocument, type EmbedWindow } from "./embed-source";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootstrap({
    window: window as unknown as EmbedWindow,
    document: document as unknown as EmbedDocument,
  });
}
