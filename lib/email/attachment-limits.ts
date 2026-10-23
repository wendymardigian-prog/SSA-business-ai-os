/**
 * Los topes de los adjuntos de «Enviar email» (auditoria de automatizaciones, oct 2026). Puro: lo usan el panel del
 * paso y el envio.
 *
 * Resend acepta hasta 40 MB por correo CONTANDO el base64, que agranda los archivos alrededor de un 33 %: unos 30 MB
 * de archivos. El tope propio (25 MB, 10 archivos) deja margen para el cuerpo y los encabezados. Cada recurso ya tiene
 * su propio tope de 16 MB, y Recursos solo acepta formatos seguros (PDF, Office, imagenes, audio y video): ningun
 * ejecutable llega a un adjunto.
 */

export const MAX_EMAIL_ATTACHMENTS = 10;
export const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface EmailAttachmentRef {
  /** El recurso de la banca. */
  assetId: string;
  /** Lo que se ve en el panel aunque el recurso cambie de nombre (no decide nada). */
  name?: string;
  sizeBytes?: number | null;
}

/** Los adjuntos guardados en el paso, sin basura ni repetidos. */
export function parseEmailAttachments(value: unknown): EmailAttachmentRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: EmailAttachmentRef[] = [];
  for (const item of value) {
    const id = (item as { assetId?: unknown } | null)?.assetId;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    const name = (item as { name?: unknown }).name;
    const size = Number((item as { sizeBytes?: unknown }).sizeBytes);
    out.push({ assetId: id, ...(typeof name === "string" ? { name } : {}), ...(Number.isFinite(size) && size > 0 ? { sizeBytes: size } : {}) });
  }
  return out;
}

/** Si una lista de adjuntos entra en un correo, y por que no. */
export function attachmentBudget(sizes: Array<number | null | undefined>): { ok: boolean; totalBytes: number; problem: string | null } {
  const totalBytes = sizes.reduce<number>((sum, s) => sum + (Number.isFinite(Number(s)) ? Number(s) : 0), 0);
  if (sizes.length > MAX_EMAIL_ATTACHMENTS) return { ok: false, totalBytes, problem: `Hasta ${MAX_EMAIL_ATTACHMENTS} adjuntos por email.` };
  if (totalBytes > MAX_EMAIL_ATTACHMENT_BYTES) return { ok: false, totalBytes, problem: "Los adjuntos pasan de 25 MB en total: sacá alguno o usá un recurso más liviano." };
  return { ok: true, totalBytes, problem: null };
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
