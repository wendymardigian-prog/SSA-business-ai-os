/**
 * Huella SHA-256 del texto de un contrato (F8, F26). SOLO servidor.
 *
 * La misma cuenta que hace la base al publicar:
 * `encode(sha256(convert_to(contract_text, 'UTF8')), 'hex')`.
 */
import { createHash } from "node:crypto";
import { normalizeContractText } from "./contract-text";

export function contractTextSha256(normalizedText: string): string {
  return createHash("sha256").update(normalizedText, "utf8").digest("hex");
}

/** Normaliza y calcula la huella en un paso. */
export function hashContractText(text: string): { text: string; sha256: string } {
  const normalized = normalizeContractText(text);
  return { text: normalized, sha256: contractTextSha256(normalized) };
}
