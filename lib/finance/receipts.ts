/**
 * Comprobantes de gastos (GF8). Puro: la validación (el tipo por los BYTES, nunca por la extensión que
 * declara el navegador; tope de 10 MB) y la ruta dentro del bucket privado `expense-receipts`.
 * El servidor sube y firma; el primer segmento del path es el workspace.
 */
import { sniffUploadMime } from "@/lib/content/media";

export const EXPENSE_RECEIPT_BUCKET = "expense-receipts";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_SIGNED_URL_SECONDS = 60;

export const ALLOWED_RECEIPT_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export function isAllowedReceiptMime(mime: string | null | undefined): boolean {
  return !!mime && (ALLOWED_RECEIPT_MIMES as readonly string[]).includes(mime);
}

export type ReceiptCheck = { ok: true; mime: string; ext: string } | { ok: false; error: string };

export function checkExpenseReceipt(bytes: Uint8Array, declaredMime?: string | null): ReceiptCheck {
  if (bytes.length === 0) return { ok: false, error: "El archivo está vacío" };
  if (bytes.length > RECEIPT_MAX_BYTES) return { ok: false, error: "El comprobante pesa más de 10 MB" };
  const mime = sniffUploadMime(bytes, declaredMime);
  if (!mime || !isAllowedReceiptMime(mime)) return { ok: false, error: "El comprobante tiene que ser una imagen (JPG, PNG, WebP o HEIC) o un PDF" };
  return { ok: true, mime, ext: EXTENSIONS[mime] };
}

/** `{workspace_id}/{expense_id}/{uuid}.{ext}` */
export function receiptPath(input: { workspaceId: string; expenseId: string; fileId: string; ext: string }): string {
  return `${input.workspaceId}/${input.expenseId}/${input.fileId}.${input.ext}`;
}

/** Un path guardado solo se firma si de verdad cuelga del workspace y el gasto que se pidieron. */
export function receiptPathBelongsTo(path: string | null | undefined, input: { workspaceId: string; expenseId: string }): boolean {
  if (!path) return false;
  return path.startsWith(`${input.workspaceId}/${input.expenseId}/`) && !path.includes("..");
}
