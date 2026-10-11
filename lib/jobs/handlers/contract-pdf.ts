/**
 * El job `contract_pdf` (F27): genera el PDF firmado de UNA firma. Fino a propósito:
 * la lógica vive en `lib/forms/contract/pdf-run.ts`.
 *
 * NUNCA lanza por un fallo de generación o de subida: la cola reintentaría a los
 * 10 s encima de la espera propia (a +5, +15 y +30 minutos que agenda la lógica).
 */
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runContractPdf } from "@/lib/forms/contract/pdf-run";

export const CONTRACT_PDF_JOB = "contract_pdf";

export async function handleContractPdf(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { signatureId?: string };
  if (!payload.signatureId) {
    console.error("[contract_pdf] el job no trae la firma");
    return;
  }
  const result = await runContractPdf({ db: ctx.supabase }, payload.signatureId);
  console.log(`[contract_pdf] ${result}`);
}

export function registerContractPdfHandler(): void {
  registerJobHandler(CONTRACT_PDF_JOB, handleContractPdf);
}
