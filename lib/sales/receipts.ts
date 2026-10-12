/**
 * Comprobantes de pago (plano F27). Puro: la validación (tipo por los bytes, nunca por la
 * extensión que declara el navegador; tope de 10 MB) y la ruta dentro del bucket privado
 * `payment-receipts`. El servidor sube y firma; el primer segmento del path es el workspace.
 */
import { sniffMime } from "@/lib/content/media";

export const RECEIPT_BUCKET = "payment-receipts";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_SIGNED_URL_SECONDS = 60;

export const RECEIPT_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type ReceiptCheck = { ok: true; mime: string; ext: string } | { ok: false; error: string };

export function checkReceipt(bytes: Uint8Array): ReceiptCheck {
  if (bytes.length === 0) return { ok: false, error: "El archivo está vacío" };
  if (bytes.length > RECEIPT_MAX_BYTES) return { ok: false, error: "El comprobante pesa más de 10 MB" };
  const mime = sniffMime(bytes);
  if (!mime || !(mime in RECEIPT_EXTENSIONS)) return { ok: false, error: "El comprobante tiene que ser una imagen (JPG, PNG o WebP) o un PDF" };
  return { ok: true, mime, ext: RECEIPT_EXTENSIONS[mime] };
}

/** `{workspace_id}/{sale_id}/{payment_id}/{uuid}.{ext}` */
export function receiptPath(input: { workspaceId: string; saleId: string; paymentId: string; fileId: string; ext: string }): string {
  return `${input.workspaceId}/${input.saleId}/${input.paymentId}/${input.fileId}.${input.ext}`;
}

/** Un path guardado solo se firma si de verdad cuelga del workspace, la venta y el pago que se pidieron. */
export function receiptPathBelongsTo(path: string | null | undefined, input: { workspaceId: string; saleId: string; paymentId: string }): boolean {
  if (!path) return false;
  return path.startsWith(`${input.workspaceId}/${input.saleId}/${input.paymentId}/`) && !path.includes("..");
}
