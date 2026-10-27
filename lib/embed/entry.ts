/**
 * Punto de entrada de `public/embed/embed.js` (F39). Se compila (esbuild,
 * formato iife) y se sirve en `/embed/embed.js`.
 */
import { bootstrap, type EmbedDocument, type EmbedWindow } from "./embed-source";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootstrap({
    window: window as unknown as EmbedWindow,
    document: document as unknown as EmbedDocument,
  });
}
