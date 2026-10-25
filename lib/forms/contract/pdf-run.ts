/**
 * Generar el PDF firmado de UNA firma (F27). SOLO servidor.
 *
 * Lo llama el job `contract_pdf` (y "Regenerar PDF" de la respuesta). Reglas:
 *  - El PDF sale SIEMPRE de la versión de la firma (`contract_signatures.form_version_id`),
 *    nunca de la vigente: una firma de la versión 1 no cambia porque se publicó la 2.
 *  - NUNCA lanza por un fallo de generación o de subida: la cola reintentaría a los 10 s
 *    encima de la espera propia. Anota el fallo (`pdf_status = 'failed'`, `pdf_attempts + 1`)
 *    y agenda el reintento a +5, +15 y +30 minutos; después queda `failed` con el botón
 *    "Regenerar PDF". **La firma queda guardada igual.**
 *  - Al generarse, encola `contract_email` (la copia por email).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { brandName } from "@/lib/brand";
import { scheduleJob } from "@/lib/scheduler";
import { buildContractPdf, type ContractPdfInput } from "./pdf";
import { contractStorage, type ContractStorage } from "./storage";
import { emailJobKey, nextEmailRetryAt } from "./email-retry";
import { answerToText, orderedAnswers, type StoredAnswer } from "@/lib/forms/responses";
import { fieldsOf } from "@/lib/forms/server-ports";
import { pdfSkippedKeys } from "./config";
import { contractTextSha256 } from "@/lib/forms/contract-hash";

/** La firma del negocio guardada en la firma (`business_signer`), o null si no hubo o no tiene forma. */
export function parseSignerSnapshot(raw: unknown): { name: string; role: string; signature_path: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name || typeof obj.signature_path !== "string" || !obj.signature_path) return null;
  return { name: obj.name, role: typeof obj.role === "string" ? obj.role : "", signature_path: obj.signature_path };
}

type Db = SupabaseClient<Database>;

export type PdfRunResult = "generated" | "already" | "missing" | "retry_scheduled" | "failed";

export interface PdfRunDeps {
  db: Db;
  storage?: ContractStorage;
  now?: () => Date;
  build?: (input: ContractPdfInput) => Promise<Uint8Array>;
  businessName?: () => string;
  /** Agenda un job; un duplicado (misma clave pendiente) no es un error. */
  schedule?: (type: string, payload: Record<string, unknown>, runAt: Date, dedupeKey: string) => Promise<void>;
}

export const pdfJobKey = (signatureId: string, attempt: number | string) => `contract_pdf:${signatureId}:${attempt}`;

async function defaultSchedule(db: Db, type: string, payload: Record<string, unknown>, runAt: Date, dedupeKey: string) {
  try {
    await scheduleJob(db, type, payload, runAt, dedupeKey);
  } catch (error) {
    // 23505 = ya hay un job pendiente con esa clave: justo lo que se busca.
    if ((error as { code?: string })?.code === "23505") return;
    throw error;
  }
}

export async function runContractPdf(deps: PdfRunDeps, signatureId: string, options: { force?: boolean } = {}): Promise<PdfRunResult> {
  const { db } = deps;
  const storage = deps.storage ?? contractStorage(db);
  const now = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? ((type, payload, runAt, key) => defaultSchedule(db, type, payload, runAt, key));

  const { data: sig } = await db.from("contract_signatures").select("*").eq("id", signatureId).maybeSingle();
  if (!sig) {
    console.error("[contract_pdf] la firma no existe");
    return "missing";
  }
  if (sig.pdf_status === "generated" && sig.pdf_path && !options.force) return "already";

  const fail = async (reason: string): Promise<PdfRunResult> => {
    // Sin datos del contrato ni del firmante en el log: solo el id de la firma y el motivo.
    console.error(`[contract_pdf] firma=${signatureId} falló: ${reason}`);
    const attempts = sig.pdf_attempts + 1;
    await db.from("contract_signatures").update({ pdf_status: "failed", pdf_attempts: attempts }).eq("id", signatureId);
    const retryAt = nextEmailRetryAt(attempts - 1, now());
    if (!retryAt) return "failed";
    try {
      await schedule("contract_pdf", { signatureId }, retryAt, pdfJobKey(signatureId, `retry:${attempts}`));
      return "retry_scheduled";
    } catch (error) {
      console.error(`[contract_pdf] no pude agendar el reintento: ${error instanceof Error ? error.message : "error"}`);
      return "failed";
    }
  };

  try {
    const [{ data: version }, { data: form }, { data: submission }] = await Promise.all([
      db.from("form_versions").select("version_number, definition, contract_text, contract_text_sha256").eq("id", sig.form_version_id).maybeSingle(),
      db.from("forms").select("name, contract_config").eq("id", sig.form_id).maybeSingle(),
      db.from("form_submissions").select("answers").eq("id", sig.submission_id).maybeSingle(),
    ]);
    if (!version || !form || !submission || version.contract_text === null) return fail("faltan datos de la firma");
    // La huella guardada tiene que seguir siendo la del texto: si no, no se firma nada con este PDF.
    if (version.contract_text_sha256 !== sig.text_sha256) return fail("la huella no coincide con la versión");
    // Modo Contrato: el PDF sale del texto que se FIRMÓ (con las variables completadas), y su huella tiene que cerrar.
    const rendered = sig.rendered_text ?? null;
    if (rendered !== null && contractTextSha256(rendered) !== sig.rendered_sha256) return fail("la huella del texto firmado no coincide");

    const { data: workspace } = await db.from("workspaces").select("timezone, brand_name").eq("id", sig.workspace_id).maybeSingle();
    const config = (form.contract_config ?? {}) as { title?: string };
    const legal = (sig.legal ?? {}) as Record<string, unknown>;
    const str = (key: string) => (typeof legal[key] === "string" ? (legal[key] as string) : null);

    let signaturePng: Uint8Array | null = null;
    if (sig.signature_path) {
      signaturePng = await storage.download(sig.signature_path);
      if (!signaturePng) return fail("no pude leer la imagen de la firma");
    }
    // La firma del negocio que se estampó al firmar (la imagen de ESE momento, aunque después se cambie).
    const signer = parseSignerSnapshot(sig.business_signer);
    let businessSigner: { name: string; role: string; image: Uint8Array } | null = null;
    if (signer) {
      const image = await storage.download(signer.signature_path);
      if (!image) return fail("no pude leer la imagen de la firma del negocio");
      businessSigner = { name: signer.name, role: signer.role, image };
    }

    const definitionFields = fieldsOf(version.definition);
    const stored = (submission.answers ?? {}) as unknown as Record<string, StoredAnswer>;
    // El nombre y el email del firmante ya salen en "Firmante": no se repiten en la lista de respuestas.
    const skip = pdfSkippedKeys(definitionFields, Object.fromEntries(Object.entries(stored).map(([key, answer]) => [key, answer.value])));
    const answers = orderedAnswers(stored, definitionFields.map((f) => f.key))
      .filter(([key]) => !skip.has(key))
      .map(([, answer]) => ({ label: answer.label, value: answerToText(answer.value) }));

    const bytes = await (deps.build ?? buildContractPdf)({
      // El nombre del negocio dueño del contrato (00266); sin marca propia, el de la instalación.
      businessName: deps.businessName ? deps.businessName() : workspace?.brand_name?.trim() || brandName(),
      title: config.title?.trim() || form.name,
      text: rendered ?? version.contract_text,
      versionNumber: version.version_number,
      sha256: sig.text_sha256,
      signer: { name: sig.signer_name, email: sig.signer_email },
      answers,
      signaturePng,
      signedAt: new Date(sig.signed_at),
      timeZone: workspace?.timezone ?? "UTC",
      legal: {
        ip: str("ip"),
        device: str("device"),
        os: str("os"),
        browser: str("browser"),
        timezone: str("timezone"),
        locale: str("locale"),
        acceptedLabel: str("accepted_label"),
      },
      contract: rendered !== null && sig.rendered_sha256 ? { renderedSha256: sig.rendered_sha256, businessSigner } : null,
    });

    const path = `${sig.workspace_id}/${sig.form_id}/${sig.id}/contrato-v${version.version_number}.pdf`;
    if (!(await storage.upload(path, bytes, "application/pdf"))) return fail("no pude subir el PDF");

    const { error } = await db.from("contract_signatures").update({ pdf_path: path, pdf_status: "generated" }).eq("id", signatureId);
    if (error) return fail("no pude guardar el estado del PDF");

    // La copia por email: la primera vez (un PDF regenerado después de un fallo también la manda).
    if (sig.email_status === "pending") {
      try {
        await schedule("contract_email", { signatureId, attempt: 0 }, now(), emailJobKey(signatureId, 0));
      } catch (e) {
        console.error(`[contract_pdf] no pude encolar el email: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    return "generated";
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 200) : "error");
  }
}
