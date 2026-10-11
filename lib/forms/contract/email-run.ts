/**
 * Mandar la copia firmada por email (F28). SOLO servidor.
 *
 * Lo llama el job `contract_email` (y "Reenviar copia" de la respuesta).
 *  - Baja el PDF del bucket y lo manda como adjunto con `sendTransactionalEmail`
 *    (`kind: "contract_copy"`); las direcciones de copia (`ccEmails`) reciben un envío
 *    aparte cada una.
 *  - Un fallo TRANSITORIO (429, 5xx, red) agenda otro intento a +5, +15 y +30 minutos
 *    (NO lanza: la cola reintentaría a los 10 s encima). Uno permanente (un 4xx que no
 *    sea 429), Resend sin conectar o agotados los reintentos deja `not_sent` con el motivo.
 *  - La firma y el PDF NUNCA dependen de esto: un email que no sale no deshace nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { sendTransactionalEmail, type SendEmailResult } from "@/lib/email/send";
import { scheduleJob } from "@/lib/scheduler";
import { classifyEmailError, emailJobKey, nextEmailRetryAt } from "./email-retry";
import { contractStorage, type ContractStorage } from "./storage";
import { parseStoredContractConfig } from "./config";
import { bodyToHtml } from "@/lib/flow-engine/nodes/send-email";

type Db = SupabaseClient<Database>;

export type EmailRunResult = "sent" | "already" | "missing" | "no_pdf" | "retry_scheduled" | "not_sent";

export interface EmailRunDeps {
  db: Db;
  storage?: ContractStorage;
  now?: () => Date;
  send?: (params: Parameters<typeof sendTransactionalEmail>[0]) => Promise<SendEmailResult>;
  schedule?: (type: string, payload: Record<string, unknown>, runAt: Date, dedupeKey: string) => Promise<void>;
}

async function defaultSchedule(db: Db, type: string, payload: Record<string, unknown>, runAt: Date, dedupeKey: string) {
  try {
    await scheduleJob(db, type, payload, runAt, dedupeKey);
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") return;
    throw error;
  }
}

/** El estado HTTP que cuenta el error de Resend ("Resend respondio 422: ..."), o 0 si no hubo respuesta. */
export function statusFromError(error: string): number {
  const match = /Resend respondio (\d{3})/.exec(error);
  return match ? Number(match[1]) : 0;
}

/** El motivo que se guarda y se muestra: sin direcciones de email ni nada de la persona. */
export function safeReason(error: string): string {
  return error.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[email]").slice(0, 300);
}

const safeFileName = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "contrato";

export async function runContractEmail(deps: EmailRunDeps, input: { signatureId: string; attempt?: number; manual?: boolean }): Promise<EmailRunResult> {
  const { db } = deps;
  const storage = deps.storage ?? contractStorage(db);
  const now = deps.now ?? (() => new Date());
  const send = deps.send ?? sendTransactionalEmail;
  const schedule = deps.schedule ?? ((type, payload, runAt, key) => defaultSchedule(db, type, payload, runAt, key));
  const attempt = Number.isInteger(input.attempt) && (input.attempt as number) >= 0 ? (input.attempt as number) : 0;

  const { data: sig } = await db.from("contract_signatures").select("*").eq("id", input.signatureId).maybeSingle();
  if (!sig) {
    console.error("[contract_email] la firma no existe");
    return "missing";
  }
  // Un reintento viejo no vuelve a mandar lo que ya salió; un reenvío manual sí.
  if (sig.email_status === "sent" && !input.manual) return "already";

  const markNotSent = async (reason: string): Promise<EmailRunResult> => {
    await db.from("contract_signatures").update({ email_status: "not_sent", email_attempts: attempt, email_next_retry_at: null, email_last_error: safeReason(reason) }).eq("id", sig.id);
    return "not_sent";
  };

  if (sig.pdf_status !== "generated" || !sig.pdf_path) {
    await markNotSent("Todavía no hay PDF para adjuntar");
    return "no_pdf";
  }
  const pdf = await storage.download(sig.pdf_path);
  if (!pdf) return markNotSent("No pude leer el PDF para adjuntarlo");

  const [{ data: form }, { data: version }] = await Promise.all([
    db.from("forms").select("name, contract_config").eq("id", sig.form_id).maybeSingle(),
    db.from("form_versions").select("version_number").eq("id", sig.form_version_id).maybeSingle(),
  ]);
  const config = parseStoredContractConfig(form?.contract_config, form?.name ?? "Contrato");
  const title = config.title || form?.name || "Contrato";
  const signedAt = new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(sig.signed_at));
  const subject = `Tu copia firmada: ${title}`;
  const html = bodyToHtml(
    `Hola${sig.signer_name ? ` ${sig.signer_name}` : ""},\n\nAdjuntamos la copia firmada de «${title}».\n\nFecha de la firma: ${signedAt} (UTC).\nLa huella del documento es ${sig.text_sha256.slice(0, 16)}…\n\nGuardá este archivo: es tu constancia.`,
  );
  const filename = `contrato-${safeFileName(title)}-v${version?.version_number ?? 1}.pdf`;
  const attachments = [{ filename, content: Buffer.from(pdf).toString("base64") }];

  const sendTo = (to: string) =>
    send({
      workspaceId: sig.workspace_id,
      to,
      subject,
      html,
      kind: "contract_copy",
      relatedEntityType: "contract_signature",
      relatedEntityId: sig.id,
      contactId: sig.contact_id,
      attachments,
      deps: { supabase: db as unknown as SupabaseClient },
    });

  const result = await sendTo(sig.signer_email);

  if (result.ok) {
    await db
      .from("contract_signatures")
      .update({ email_status: "sent", email_sent_at: now().toISOString(), email_attempts: attempt, email_next_retry_at: null, email_last_error: null })
      .eq("id", sig.id);
    // Las copias van aparte y no cambian el estado: si una falla, queda en email_log.
    for (const cc of config.ccEmails) await sendTo(cc).catch(() => undefined);
    return "sent";
  }

  if (result.reason === "not_configured") return markNotSent("Resend no está conectado");

  const status = statusFromError(result.error);
  const kind = classifyEmailError(status, result.error);
  const retryAt = kind === "transient" ? nextEmailRetryAt(attempt, now()) : null;
  if (!retryAt) return markNotSent(result.error);

  await db
    .from("contract_signatures")
    .update({ email_status: "retrying", email_attempts: attempt + 1, email_next_retry_at: retryAt.toISOString(), email_last_error: safeReason(result.error) })
    .eq("id", sig.id);
  try {
    await schedule("contract_email", { signatureId: sig.id, attempt: attempt + 1 }, retryAt, emailJobKey(sig.id, attempt + 1));
  } catch (error) {
    console.error(`[contract_email] no pude agendar el reintento: ${error instanceof Error ? error.message : "error"}`);
    return markNotSent(result.error);
  }
  return "retry_scheduled";
}
