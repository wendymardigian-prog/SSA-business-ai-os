// @plantilla-quitar(servicios)
/**
 * Portal › Por revisar (F57): las entregas del portal (actividades y evaluaciones), solo servidor. La página ya
 * comprobó `portal.view`; se lee con el cliente de servicio filtrando por el negocio de la sesión. Las respuestas
 * correctas de una evaluación no se leen (viven en la versión, no en la respuesta).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewSubmission } from "./review";

type Db = SupabaseClient<any, any, any>;

export interface ReviewItem extends ReviewSubmission {
  formId: string;
  formName: string;
  productName: string;
  contactId: string | null;
  contactName: string;
  attempt: number | null;
  answers: Record<string, unknown>;
  fields: Array<{ key: string; label: string; type: string }>;
  reviewComment: string | null;
  internalNote: string | null;
  grading: { enabled?: boolean; scale?: string; pass_at?: unknown } | null;
}

export async function loadReviewItems(service: Db, workspaceId: string, opts: { contactId?: string | null; productId?: string | null } = {}): Promise<ReviewItem[]> {
  let formFilter: string[] | null = null;
  if (opts.productId) {
    // «Por revisar» de UN programa (lo abren las cards de Portal › Programas): sus formularios del portal.
    const { data: pf } = await service.from("forms").select("id").eq("workspace_id", workspaceId).eq("product_id" as never, opts.productId as never);
    formFilter = ((pf ?? []) as Array<{ id: string }>).map((f) => f.id);
    if (formFilter.length === 0) return [];
  }
  let q = service
    .from("form_submissions")
    .select("id, form_id, form_version_id, contact_id, answers, grade, attempt, review_status, review_comment, internal_note, created_at")
    .eq("workspace_id", workspaceId)
    .eq("context", "portal")
    .eq("status", "received")
    .order("created_at", { ascending: false })
    .limit(300);
  if (opts.contactId) q = q.eq("contact_id", opts.contactId);
  if (formFilter) q = q.in("form_id", formFilter);
  const { data, error } = await q;
  if (error) {
    console.error("[portal] no pude leer las entregas:", error.code ?? "?");
    return [];
  }
  const subs = (data ?? []) as Array<Record<string, unknown>>;
  if (subs.length === 0) return [];
  const formIds = [...new Set(subs.map((s) => s.form_id as string))];
  const versionIds = [...new Set(subs.map((s) => s.form_version_id as string))];
  const contactIds = [...new Set(subs.map((s) => s.contact_id as string).filter(Boolean))];
  const [{ data: forms }, { data: versions }, { data: contacts }] = await Promise.all([
    service.from("forms").select("id, name, type, product_id").in("id", formIds).eq("workspace_id", workspaceId),
    service.from("form_versions").select("id, definition").in("id", versionIds),
    contactIds.length ? service.from("contacts").select("id, display_name").in("id", contactIds) : Promise.resolve({ data: [] }),
  ]);
  const formById = new Map(((forms ?? []) as Array<{ id: string; name: string; type: string; product_id: string | null }>).map((f) => [f.id, f]));
  const productIds = [...new Set([...formById.values()].map((f) => f.product_id).filter(Boolean))] as string[];
  const { data: products } = productIds.length ? await service.from("products").select("id, name").in("id", productIds) : { data: [] };
  const productName = new Map(((products ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]));
  const defById = new Map(((versions ?? []) as Array<{ id: string; definition: Record<string, unknown> }>).map((v) => [v.id, v.definition]));
  const contactName = new Map(((contacts ?? []) as Array<{ id: string; display_name: string | null }>).map((c) => [c.id, c.display_name ?? "Sin nombre"]));
  return subs
    .map((s): ReviewItem | null => {
      const f = formById.get(s.form_id as string);
      if (!f || (f.type !== "quiz" && f.type !== "activity")) return null;
      const def = defById.get(s.form_version_id as string) ?? {};
      const grading = (def.grading ?? null) as ReviewItem["grading"];
      return {
        id: s.id as string,
        formId: f.id,
        formName: f.name,
        formType: f.type,
        productName: f.product_id ? productName.get(f.product_id) ?? "" : "",
        contactId: (s.contact_id as string | null) ?? null,
        contactName: s.contact_id ? contactName.get(s.contact_id as string) ?? "Sin nombre" : "Sin contacto",
        attempt: (s.attempt as number | null) ?? null,
        answers: (s.answers as Record<string, unknown>) ?? {},
        fields: ((def.fields as Array<{ key: string; label: string; type: string }>) ?? []).map((x) => ({ key: x.key, label: x.label, type: x.type })),
        reviewStatus: (s.review_status as ReviewItem["reviewStatus"]) ?? null,
        grade: (s.grade as ReviewItem["grade"]) ?? null,
        gradingEnabled: grading?.enabled === true,
        grading,
        reviewComment: (s.review_comment as string | null) ?? null,
        internalNote: (s.internal_note as string | null) ?? null,
        createdAt: s.created_at as string,
      };
    })
    .filter((x): x is ReviewItem => x !== null);
}
