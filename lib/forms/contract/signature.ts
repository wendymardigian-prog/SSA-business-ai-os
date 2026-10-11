/**
 * La firma dibujada, validada en el SERVIDOR (F25). PURO.
 *
 * El navegador manda un data URL PNG y la cantidad de trazos, pero el servidor no
 * se fía: comprueba que sea un PNG de verdad (por los bytes, no por lo que dice
 * el data URL), que no pase de 200 KB y que haya al menos un trazo.
 */

export const MAX_SIGNATURE_BYTES = 200 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

export type SignatureResult =
  | { ok: true; bytes: Uint8Array | null }
  | { ok: false; error: "signature_required" | "signature_invalid" };

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

export function decodeSignature(dataUrl: string): Uint8Array | null {
  const match = DATA_URL.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return new Uint8Array(Buffer.from(match[1], "base64"));
  } catch {
    return null;
  }
}

export function validateSignature(input: { signature?: string | null; strokes?: number | null; required: boolean }): SignatureResult {
  const provided = typeof input.signature === "string" && input.signature.trim() !== "";
  if (!provided) return input.required ? { ok: false, error: "signature_required" } : { ok: true, bytes: null };

  const bytes = decodeSignature(input.signature as string);
  if (!bytes || !isPng(bytes) || bytes.byteLength > MAX_SIGNATURE_BYTES) return { ok: false, error: "signature_invalid" };
  // Sin trazos no hay firma, venga lo que venga en el PNG (puede ser un lienzo en blanco).
  if (!Number.isFinite(input.strokes) || (input.strokes ?? 0) < 1) {
    return input.required ? { ok: false, error: "signature_required" } : { ok: true, bytes: null };
  }
  return { ok: true, bytes };
}
