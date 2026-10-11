/**
 * Lo que muestra la sección «Contratos» de la ficha de una venta (F26b): las firmas con ese
 * `sale_id` y los envíos que todavía no tienen firma. Solo servidor, y solo se llama DESPUÉS de
 * que la página comprobó (con la sesión de la persona) que ve la venta: las firmas se leen con el
 * cliente de servicio porque quien mira la venta puede no tener `forms.view`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { unsignedContracts } from "./contract";

type Db = SupabaseClient<Database>;

export interface SaleContractsData {
  signed: Array<{
    submissionId: string;
    formName: string;
    versionNumber: number | null;
    signedAt: string;
    emailStatus: string;
    pdfStatus: string;
  }>;
  unsigned: Array<{ formId: string; formName: string; sentAt: string }>;
}

export async function loadSaleContracts(service: Db, workspaceId: string, saleId: string): Promise<SaleContractsData> {
  const [{ data: signatures }, { data: sent }] = await Promise.all([
    service
      .from("contract_signatures")
      .select("submission_id, form_id, form_version_id, signed_at, email_status, pdf_status")
      .eq("workspace_id", workspaceId)
      .eq("sale_id", saleId)
      .order("signed_at", { ascending: false }),
    service
      .from("audit_log")
      .select("performed_at, metadata")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "sale")
      .eq("entity_id", saleId)
      .eq("action", "sale.contract_sent")
      .order("performed_at", { ascending: false })
      .limit(100),
  ]);

  const formIds = [...new Set([...(signatures ?? []).map((s) => s.form_id), ...(sent ?? []).map((s) => (s.metadata as { form_id?: string } | null)?.form_id).filter((x): x is string => !!x)])];
  const versionIds = (signatures ?? []).map((s) => s.form_version_id);
  const [{ data: forms }, { data: versions }] = await Promise.all([
    formIds.length ? service.from("forms").select("id, name").in("id", formIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    versionIds.length ? service.from("form_versions").select("id, version_number").in("id", versionIds) : Promise.resolve({ data: [] as Array<{ id: string; version_number: number }> }),
  ]);
  const formName = new Map((forms ?? []).map((f) => [f.id, f.name]));
  const versionNumber = new Map((versions ?? []).map((v) => [v.id, v.version_number]));

  const sentRows = (sent ?? [])
    .map((s) => ({ form_id: (s.metadata as { form_id?: string } | null)?.form_id ?? "", sent_at: s.performed_at }))
    .filter((s) => s.form_id);
  const pending = unsignedContracts(sentRows, (signatures ?? []).map((s) => ({ form_id: s.form_id, signed_at: s.signed_at })));

  return {
    signed: (signatures ?? []).map((s) => ({
      submissionId: s.submission_id,
      formName: formName.get(s.form_id) ?? "Contrato",
      versionNumber: versionNumber.get(s.form_version_id) ?? null,
      signedAt: s.signed_at,
      emailStatus: s.email_status,
      pdfStatus: s.pdf_status,
    })),
    unsigned: pending.map((p) => ({ formId: p.form_id, formName: formName.get(p.form_id) ?? "Contrato", sentAt: p.sent_at })),
  };
}
