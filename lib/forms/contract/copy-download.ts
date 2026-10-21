/**
 * "Descargar contrato" desde la pantalla de éxito: la copia firmada de UNA respuesta. SOLO servidor.
 *
 * El orden: el slug tiene forma → el formulario es un contrato → hay clave de links en Vault → el token vale para ese
 * formulario y no venció → la firma existe → el PDF. Si el PDF todavía no se generó (el job corre cada minuto), se arma
 * en el momento con la misma `runContractPdf` del job (que no repite si ya está). Si sigue sin estar, "pending": el
 * navegador vuelve a preguntar. Cualquier falla de validación es "not_found", sin detalle.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { SLUG_PATTERN } from "@/lib/forms/list";
import { readCopyToken } from "./copy-link";
import type { ContractStorage } from "./storage";
import type { PdfRunResult } from "./pdf-run";

type Db = SupabaseClient<Database>;

export type CopyDownload = { kind: "pdf"; bytes: Uint8Array; filename: string } | { kind: "pending" } | { kind: "not_found" };

export interface CopyDownloadDeps {
  db: Db;
  storage: ContractStorage;
  /** La clave de los links del workspace; `null` si no hay (nunca se firmó nada) o no se pudo leer. */
  readLinkSecret: (workspaceId: string) => Promise<string | null>;
  runPdf: (signatureId: string) => Promise<PdfRunResult>;
  now?: number;
}

function fileName(title: string, version: number | null): string {
  const base =
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "contrato";
  return `${base}-firmado${version ? `-v${version}` : ""}.pdf`;
}

export async function loadContractCopy(deps: CopyDownloadDeps, input: { slug: string; token: string | null }): Promise<CopyDownload> {
  const slug = (input.slug ?? "").toLowerCase();
  if (!SLUG_PATTERN.test(slug) || !input.token) return { kind: "not_found" };

  const { data: form } = await deps.db.from("forms").select("id, workspace_id, type, name, contract_config").ilike("slug", slug).maybeSingle();
  if (!form || form.type !== "contract") return { kind: "not_found" };

  const secret = await deps.readLinkSecret(form.workspace_id).catch(() => null);
  if (!secret) return { kind: "not_found" };
  const read = readCopyToken(input.token, secret, { formId: form.id, now: deps.now });
  if (!read.ok) return { kind: "not_found" };

  const select = () =>
    deps.db.from("contract_signatures").select("id, pdf_status, pdf_path, form_version_id").eq("submission_id", read.submissionId).eq("form_id", form.id).maybeSingle();
  let { data: signature } = await select();
  if (!signature) return { kind: "not_found" };

  // Solo se arma acá si todavía está pendiente: uno que falló ya tiene sus reintentos agendados.
  if (signature.pdf_status === "pending") {
    await deps.runPdf(signature.id).catch(() => "failed" as const);
    ({ data: signature } = await select());
    if (!signature) return { kind: "not_found" };
  }
  if (signature.pdf_status !== "generated" || !signature.pdf_path) return { kind: "pending" };

  const bytes = await deps.storage.download(signature.pdf_path);
  if (!bytes) return { kind: "pending" };

  const { data: version } = await deps.db.from("form_versions").select("version_number").eq("id", signature.form_version_id).maybeSingle();
  const title = ((form.contract_config ?? {}) as { title?: string }).title?.trim() || form.name;
  return { kind: "pdf", bytes, filename: fileName(title, version?.version_number ?? null) };
}
