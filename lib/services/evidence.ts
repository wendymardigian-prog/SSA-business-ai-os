// @plantilla-quitar(servicios)
/**
 * La evidencia de un paso (Servicios A4, F147). PURA: validación de tipos, largos y bytes, qué falta para completar
 * y quién puede quitar qué. La base vuelve a mirarlo (`svc_add_evidence`, `svc_remove_evidence` y el completar a mano).
 *
 *   ref.evidence = { required: true, kinds: ["file" | "link" | "note", …] }
 *   service_items.evidence = [{ id, kind, path?, url?, text?, by, at }]   (hasta 10)
 *
 * Archivos: PNG, JPG, WEBP o PDF, hasta 10 MB, validados por SUS BYTES (nunca por la extensión ni el tipo declarado),
 * en el bucket privado `service-evidence`, ruta `<workspace>/<service>/<item>/<uuid>.<ext>`.
 */
import { sniffMime } from "@/lib/content/media";

export const EVIDENCE_BUCKET = "service-evidence";
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_MAX_PER_ITEM = 10;
export const EVIDENCE_TEXT_MAX = 2000;
export const EVIDENCE_URL_MAX = 2000;
export const EVIDENCE_SIGNED_SECONDS = 600;

export type EvidenceKind = "file" | "link" | "note";
export type EvidenceEntry = { id: string; kind: EvidenceKind; path?: string; url?: string; text?: string; by: string; at: string };
export type EvidenceRule = { required: true; kinds: EvidenceKind[] };

const ALLOWED_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = { file: "una captura o archivo", link: "un link", note: "una nota" };

export function readEvidenceRule(raw: unknown): EvidenceRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.required !== true || !Array.isArray(o.kinds)) return null;
  const kinds = o.kinds.filter((k): k is EvidenceKind => k === "file" || k === "link" || k === "note");
  return kinds.length ? { required: true, kinds: [...new Set(kinds)] } : null;
}

export function readEvidence(raw: unknown): EvidenceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is EvidenceEntry => !!e && typeof e === "object" && typeof (e as EvidenceEntry).id === "string" && ["file", "link", "note"].includes((e as EvidenceEntry).kind));
}

/** Si al paso le falta evidencia para completarse (SV034): pide y no tiene ninguna de los tipos pedidos. */
export function evidenceMissing(rule: EvidenceRule | null, entries: readonly EvidenceEntry[]): boolean {
  if (!rule) return false;
  return !entries.some((e) => rule.kinds.includes(e.kind));
}

/** El mensaje de SV034 (el mismo que dice la base). */
export const EVIDENCE_MISSING_MESSAGE = "Este paso pide evidencia: adjuntá una captura, un link o una nota.";

export type EvidenceInput =
  | { kind: "file"; bytes: Uint8Array; size: number }
  | { kind: "link"; url: string }
  | { kind: "note"; text: string };

export type ValidEvidence = { kind: "file"; mime: string; ext: string } | { kind: "link"; url: string } | { kind: "note"; text: string };

export function validateEvidence(input: EvidenceInput, rule: EvidenceRule | null, current: readonly EvidenceEntry[]): { ok: true; value: ValidEvidence } | { ok: false; error: string } {
  if (current.length >= EVIDENCE_MAX_PER_ITEM) return { ok: false, error: `Un paso tiene hasta ${EVIDENCE_MAX_PER_ITEM} evidencias.` };
  if (rule && !rule.kinds.includes(input.kind)) return { ok: false, error: `Este paso pide ${rule.kinds.map((k) => EVIDENCE_KIND_LABEL[k]).join(", ")}.` };
  if (input.kind === "file") {
    if (input.size > EVIDENCE_MAX_BYTES) return { ok: false, error: "El archivo puede pesar hasta 10 MB." };
    const mime = sniffMime(input.bytes);
    const ext = mime ? ALLOWED_MIME[mime] : undefined;
    if (!mime || !ext) return { ok: false, error: "Subí una imagen PNG, JPG o WEBP, o un PDF." };
    return { ok: true, value: { kind: "file", mime, ext } };
  }
  if (input.kind === "link") {
    const url = input.url.trim();
    if (!/^https:\/\/\S+$/.test(url) || url.length > EVIDENCE_URL_MAX) return { ok: false, error: "El link tiene que empezar con https:// y no llevar espacios." };
    return { ok: true, value: { kind: "link", url } };
  }
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Escribí la nota." };
  if (text.length > EVIDENCE_TEXT_MAX) return { ok: false, error: `La nota puede tener hasta ${EVIDENCE_TEXT_MAX} caracteres.` };
  return { ok: true, value: { kind: "note", text } };
}

/** La ruta del archivo en el bucket: siempre dentro del negocio, el servicio y el paso. */
export function evidencePath(workspaceId: string, serviceId: string, itemId: string, fileId: string, ext: string): string {
  return `${workspaceId}/${serviceId}/${itemId}/${fileId}.${ext}`;
}

export function isEvidencePathOf(path: string, workspaceId: string, serviceId: string, itemId: string): boolean {
  return path.startsWith(`${workspaceId}/${serviceId}/${itemId}/`) && !path.includes("..");
}

/** Solo se quita lo propio, y solo mientras el paso está pendiente. */
export function canRemoveEvidence(entry: EvidenceEntry, viewerId: string, itemStatus: string): boolean {
  return itemStatus === "pending" && entry.by === viewerId;
}
