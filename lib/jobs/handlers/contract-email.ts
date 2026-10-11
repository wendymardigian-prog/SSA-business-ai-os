/**
 * El job `contract_email` (F28): manda la copia firmada de UNA firma por email.
 * Fino a propósito: la lógica vive en `lib/forms/contract/email-run.ts`.
 *
 * NUNCA lanza por un fallo del proveedor: la cola reintentaría a los 10 s encima de
 * la espera propia (a +5, +15 y +30 minutos que agenda la lógica).
 */
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { runContractEmail } from "@/lib/forms/contract/email-run";

export const CONTRACT_EMAIL_JOB = "contract_email";

export async function handleContractEmail(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { signatureId?: string; attempt?: number; manual?: boolean };
  if (!payload.signatureId) {
    console.error("[contract_email] el job no trae la firma");
    return;
  }
  const result = await runContractEmail({ db: ctx.supabase }, { signatureId: payload.signatureId, attempt: payload.attempt, manual: payload.manual });
  console.log(`[contract_email] ${result}`);
}

export function registerContractEmailHandler(): void {
  registerJobHandler(CONTRACT_EMAIL_JOB, handleContractEmail);
}
