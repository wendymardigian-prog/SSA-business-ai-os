/**
 * Mandar la copia firmada por email (F28). SOLO servidor.
 *
 * Lo llama el job `contract_email` (y "Reenviar copia" de la respuesta).
 *  - Baja el PDF del bucket y lo manda como adjunto con `sendTransactionalEmail`
 *    (`kind: "contract_copy"`) a quien firmó. Las direcciones de copia (`ccEmails`) y, con
 *    `copyToOwner` (por defecto), el Owner del negocio reciben un envío aparte cada una, con
 *    otro texto ("se firmó…"), sin repetir una dirección.
 *  - La fecha va en la zona del negocio (`workspaces.timezone`).
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
  /** Los emails del/los Owner del workspace (para "Mandarme una copia"). Nunca lanza: sin dato, lista vacía. */
  ownerEmails?: (workspaceId: string) => Promise<string[]>;
}

/** Los Owner del workspace, con el cliente de servicio (`auth.admin`). Sin dato o con un error, ninguno. */
async function defaultOwnerEmails(db: Db, workspaceId: string): Promise<string[]> {
  try {
    const { data: owners } = await db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner");
    const emails: string[] = [];
    for (const owner of owners ?? []) {
      const { data } = await db.auth.admin.getUserById(owner.user_id);
      if (data?.user?.email) emails.push(data.user.email.toLowerCase());
    }
    return emails;
  } catch {
    return [];
  }
}

/** La fecha de la firma en la zona del negocio ("21 de octubre de 2026, 10:30"), con UTC si la zona no sirve. */
export function signedAtText(signedAt: string, timeZone: string | null | undefined): string {
  const date = new Date(signedAt);
  try {
    if (timeZone) return `${new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short", timeZone }).format(date)} (${timeZone})`;
  } catch {
    // Una zona inválida cae a UTC.
  }
  return `${new Intl.DateTimeFormat("es", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(date)} (UTC)`;
}

/** A quién va cada copia aparte: las direcciones configuradas y los Owner, sin la del firmante ni repetidas. */
export function copyRecipients(signerEmail: string, ccEmails: string[], ownerEmails: string[]): string[] {
  const seen = new Set([signerEmail.trim().toLowerCase()]);
  const out: string[] = [];
  for (const email of [...ccEmails, ...ownerEmails]) {
    const clean = email.trim().toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
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

  const [{ data: form }, { data: version }, { data: workspace }] = await Promise.all([
    db.from("forms").select("name, contract_config").eq("id", sig.form_id).maybeSingle(),
    db.from("form_versions").select("version_number").eq("id", sig.form_version_id).maybeSingle(),
    db.from("workspaces").select("timezone").eq("id", sig.workspace_id).maybeSingle(),
  ]);
  const config = parseStoredContractConfig(form?.contract_config, form?.name ?? "Contrato");
  const title = config.title || form?.name || "Contrato";
  const signedAt = signedAtText(sig.signed_at, (workspace as { timezone?: string } | null)?.timezone);
  const fingerprint = `${sig.text_sha256.slice(0, 16)}…`;
  const subject = `Tu copia firmada: ${title}`;
  const html = bodyToHtml(
    `Hola${sig.signer_name ? ` ${sig.signer_name}` : ""},\n\nAdjuntamos la copia firmada de «${title}».\n\nFecha de la firma: ${signedAt}.\nLa huella del documento es ${fingerprint}\n\nGuardá este archivo: es tu constancia.`,
  );
  const copySubject = `Se firmó: ${title}`;
  const copyHtml = bodyToHtml(
    `Se firmó «${title}».\n\nFirmante: ${sig.signer_name || "(sin nombre)"} (${sig.signer_email}).\nFecha de la firma: ${signedAt}.\nLa huella del documento es ${fingerprint}\n\nAdjuntamos el PDF firmado.`,
  );
  const filename = `contrato-${safeFileName(title)}-v${version?.version_number ?? 1}.pdf`;
  const attachments = [{ filename, content: Buffer.from(pdf).toString("base64") }];

  const sendTo = (to: string, copy = false) =>
    send({
      workspaceId: sig.workspace_id,
      to,
      subject: copy ? copySubject : subject,
      html: copy ? copyHtml : html,
      kind: "contract_copy",
      relatedEntityType: "contract_signature",
      relatedEntityId: sig.id,
      contactId: sig.contact_id,
      attachments,
      // Suscripcion a emails: la copia al firmante es transaccional (la pidio al firmar): solo la frena un rebote,
      // no "no contactar" ni la baja de marketing (decision de Wendy, 29/10/2026). Las copias al equipo no son de
      // un contacto.
      ...(copy ? {} : { category: "transactional" as const }),
      deps: { supabase: db as unknown as SupabaseClient },
    });

  const result = await sendTo(sig.signer_email);

  if (result.ok) {
    await db
      .from("contract_signatures")
      .update({ email_status: "sent", email_sent_at: now().toISOString(), email_attempts: attempt, email_next_retry_at: null, email_last_error: null })
      .eq("id", sig.id);
    // Las copias van aparte y no cambian el estado: si una falla, queda en email_log. Un reenvío manual ("Reenviar
    // copia") no le vuelve a llegar al Owner: ya la tiene.
    const owners =
      config.copyToOwner && !input.manual ? await (deps.ownerEmails ?? ((id: string) => defaultOwnerEmails(db, id)))(sig.workspace_id).catch(() => []) : [];
    for (const to of copyRecipients(sig.signer_email, config.ccEmails, owners)) await sendTo(to, true).catch(() => undefined);
    return "sent";
  }

  if (result.reason === "not_configured") return markNotSent("Resend no está conectado");
  // La direccion del firmante rebota: reintentar no lo arregla, y queda anotado en email_log.
  if (result.reason === "skipped") return markNotSent(result.error);

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
