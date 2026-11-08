/**
 * Lo que leen la pestaña Generaciones y los modales de generar (F50, F53, F54). Solo servidor.
 *
 * Todo se lee con el cliente de LA PERSONA: la RLS (`designer.view`) decide qué plantillas y piezas ve, y la de Contactos
 * qué contactos. Nada de esto escribe ni encola. Lo que sale es plano (se serializa hacia el navegador): las filas ya
 * vienen con lo que dibuja la pantalla (`generationRow`, puro) y los links armados con el dominio del NEGOCIO.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCustomFieldRefs, prepareContactList, contactListQuery } from "@/lib/contacts/list-load";
import type { Database, Json } from "@/lib/types/database";
import { sanitizeSearch } from "@/lib/url-params";
import { docVariables, parseDesignDoc, type DesignDoc } from "./doc/schema";
import type { UploadedFont } from "./fonts";
import { registeredSubjectSources } from "./extensions";
import { parseEmailRequest } from "./generation-email";
import { collectAssetPaths, signAssetUrls } from "./storage";
import { parseDesignSettings } from "./settings-schema";
import {
  canSendEmailNow,
  countsFromStatuses,
  detailValues,
  emailStatusText,
  FILTER_STATUSES,
  generationRow,
  generationsRange,
  needsPolling,
  pageCount,
  searchOrFilter,
  type GenerationCounts,
  type GenerationFilters,
  type GenerationRecord,
  type GenerationRowView,
  type GenerationStatus,
  type RowContext,
} from "./screens/generations";
import { parseCustomVarsList } from "./variables/custom";
import { variableInfo, type CustomVar, type DateFormat } from "./variables/catalog";
import { docTypeNoun, isDocType, issueButtonLabel, type DocType } from "./verification";

type Db = SupabaseClient<Database>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// ─── La plantilla para los modales ──────────────────────────────────────────

export interface GenerateContext {
  template: {
    id: string;
    name: string;
    doc: DesignDoc;
    customVars: CustomVar[];
    dateFormat: DateFormat;
    verify: boolean;
    docType: DocType | null;
    docTypeLabel: string | null;
    /** «Emitir constancia» o «Generar para…» (sale de `verification.ts`). */
    issueLabel: string;
    /** «constancia», «certificado»… o null si la plantilla no verifica. */
    noun: string | null;
    archived: boolean;
  };
  /** Las claves que usa el documento (las que se muestran con su valor en el modal). */
  usedKeys: string[];
  workspaceName: string;
  assetUrls: Record<string, string>;
  uploadedFonts: UploadedFont[];
  /** Otros orígenes de sujeto que un módulo registró, además de «Contacto». */
  sources: { group: string; source: string }[];
}

/** Lee la plantilla para los modales. `null` si no existe o la persona no la ve. */
export async function loadGenerateContextCore(
  user: Db,
  workspace: { id: string; name: string | null; brand_name?: string | null; design_settings: unknown },
  templateId: string,
): Promise<GenerateContext | null> {
  const { data, error } = await user
    .from("design_templates")
    .select("id, name, doc, custom_vars, date_format, verify, doc_type, doc_type_label, archived_at")
    .eq("id", templateId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (error) {
    console.error("[designer] no pude leer la plantilla para generar:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as unknown as { id: string; name: string; doc: Json; custom_vars: Json; date_format: string; verify: boolean; doc_type: string | null; doc_type_label: string | null; archived_at: string | null };
  const parsed = parseDesignDoc(row.doc);
  if (!parsed.ok) return null;
  const settings = parseDesignSettings(workspace.design_settings, workspace.id);
  const uploadedFonts = (settings.ok ? (settings.settings.fonts?.uploaded ?? []) : []) as UploadedFont[];
  const families = new Set(parsed.doc.pages.flatMap((p) => p.elements.flatMap((el) => (el.type === "text" ? [el.font.family] : []))));
  const signed = await signAssetUrls(user, workspace.id, collectAssetPaths(parsed.doc, uploadedFonts.filter((f) => families.has(f.family))));
  const docType = isDocType(row.doc_type) ? row.doc_type : null;
  const verify = row.verify && docType !== null;
  return {
    template: {
      id: row.id,
      name: row.name,
      doc: parsed.doc,
      customVars: parseCustomVarsList(row.custom_vars),
      dateFormat: row.date_format === "short" || row.date_format === "en" ? row.date_format : "long",
      verify: row.verify,
      docType,
      docTypeLabel: row.doc_type_label,
      issueLabel: issueButtonLabel({ verify: row.verify, doc_type: row.doc_type, doc_type_label: row.doc_type_label }),
      noun: verify ? docTypeNoun(docType, row.doc_type_label).toLowerCase() : null,
      archived: !!row.archived_at,
    },
    usedKeys: docVariables(parsed.doc),
    workspaceName: workspace.brand_name || workspace.name || "Tu negocio",
    assetUrls: Object.fromEntries(signed),
    uploadedFonts,
    sources: registeredSubjectSources(),
  };
}

// ─── La plantilla para «Generar para varios» ────────────────────────────────

export interface ManyContext {
  template: { id: string; name: string; verify: boolean; docType: string | null; docTypeLabel: string | null; noun: string | null; archived: boolean };
}

/** Lo mínimo de la plantilla para el modal de varios (el documento y sus archivos no hacen falta). */
export async function loadManyContextCore(user: Db, workspaceId: string, templateId: string): Promise<ManyContext | null> {
  const { data, error } = await user.from("design_templates").select("id, name, verify, doc_type, doc_type_label, archived_at").eq("id", templateId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) {
    console.error("[designer] no pude leer la plantilla para generar:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as unknown as { id: string; name: string; verify: boolean; doc_type: string | null; doc_type_label: string | null; archived_at: string | null };
  const verify = row.verify && isDocType(row.doc_type);
  return {
    template: { id: row.id, name: row.name, verify: row.verify, docType: row.doc_type, docTypeLabel: row.doc_type_label, noun: verify ? docTypeNoun(row.doc_type as DocType, row.doc_type_label).toLowerCase() : null, archived: !!row.archived_at },
  };
}

// ─── Buscar un contacto ─────────────────────────────────────────────────────

export interface ContactChoice {
  id: string;
  name: string;
  detail: string | null;
}

/** El buscador de «Para»: los contactos de Contactos con la misma búsqueda, como los ve la persona (hasta 8). */
export async function searchContactsCore(user: Db, input: { workspaceId: string; query: string; timeZone: string; now?: Date }): Promise<ContactChoice[]> {
  const search = sanitizeSearch(input.query);
  if (search.length < 2) return [];
  const customFields = await loadCustomFieldRefs(user, input.workspaceId);
  const { plan } = await prepareContactList(user, input.workspaceId, { q: search }, customFields, search, { now: input.now ?? new Date(), timeZone: input.timeZone });
  const { data, error } = await contactListQuery(user, input.workspaceId, "id, display_name, email, phone", plan).order("display_name").limit(8);
  if (error) throw new Error(`No pude buscar contactos: ${error.message}`);
  return ((data ?? []) as unknown as { id: string; display_name: string | null; email: string | null; phone: string | null }[]).map((c) => ({
    id: c.id,
    name: c.display_name?.trim() || c.email || c.phone || "Sin nombre",
    detail: [c.email, c.phone].filter(Boolean).join(" · ") || null,
  }));
}

// ─── La lista de generaciones ───────────────────────────────────────────────

export interface GenerationListView {
  rows: (GenerationRowView & { link: string | null })[];
  counts: GenerationCounts;
  /** Cuántas hay con el filtro y la búsqueda puestos. */
  total: number;
  page: number;
  pages: number;
  /** Algo se está armando: la pestaña vuelve a leer sola cada 5 s. */
  polling: boolean;
  template: { id: string; name: string; verify: boolean; docType: string | null; issueLabel: string };
}

export interface ListDeps {
  /** user_id → nombre del equipo (se reemplaza en los tests). */
  loadPeople?: (workspaceId: string) => Promise<Record<string, string>>;
}

async function defaultPeople(workspaceId: string): Promise<Record<string, string>> {
  const { getWorkspaceMembers } = await import("@/lib/workspace-members");
  return Object.fromEntries((await getWorkspaceMembers(workspaceId)).map((m) => [m.userId, m.name]));
}

const LIST_COLUMNS = "id, name, code, status, error, void_reason, created_at, source, source_ref, subject_contact_id, subject_ref, published, attempts, email_status, values";

interface DesignRow {
  id: string;
  name: string;
  code: string;
  status: GenerationStatus;
  error: string | null;
  void_reason: string | null;
  created_at: string;
  source: GenerationRecord["source"];
  source_ref: Json;
  subject_contact_id: string | null;
  subject_ref: Json;
  published: boolean;
  attempts: number;
  email_status: GenerationRecord["emailStatus"];
  values: Json;
}

const recordOf = (r: DesignRow): GenerationRecord => {
  const values = (r.values && typeof r.values === "object" && !Array.isArray(r.values) ? r.values : {}) as Record<string, unknown>;
  const ref = r.subject_ref && typeof r.subject_ref === "object" && !Array.isArray(r.subject_ref) ? (r.subject_ref as Record<string, unknown>) : null;
  const email = str(values["contact.email"]);
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    status: r.status,
    error: r.error,
    voidReason: r.void_reason,
    createdAt: r.created_at,
    source: r.source,
    sourceRef: r.source_ref && typeof r.source_ref === "object" && !Array.isArray(r.source_ref) ? (r.source_ref as Record<string, unknown>) : null,
    subjectName: str(values["contact.display_name"]) ?? str(ref?.label),
    subjectDetail: email,
    published: r.published,
    attempts: r.attempts,
    emailStatus: r.email_status,
    emailRequested: parseEmailRequest(r.source_ref) !== null,
    canEmail: !!r.subject_contact_id && email !== null,
  };
};

/** Los contadores de los cinco filtros: un conteo liviano por filtro (índice por plantilla y estado). */
async function countFilters(user: Db, workspaceId: string, templateId: string, search: string | null): Promise<GenerationCounts> {
  const byStatus: Partial<Record<GenerationStatus, number>> = {};
  const statuses: GenerationStatus[] = ["queued", "rendering", "ready", "failed", "void"];
  const results = await Promise.all(
    statuses.map(async (status) => {
      let q = user.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("template_id", templateId).eq("status", status);
      if (search) q = q.or(search);
      const { count, error } = await q;
      if (error) throw new Error(`No pude contar las generaciones: ${error.message}`);
      return [status, count ?? 0] as const;
    }),
  );
  for (const [status, count] of results) byStatus[status] = count;
  return countsFromStatuses(byStatus);
}

/** La pestaña Generaciones: contadores, la página pedida y lo que dibuja cada fila. */
export async function listGenerationsCore(
  user: Db,
  input: {
    workspaceId: string;
    templateId: string;
    filters: GenerationFilters;
    can: { generate: boolean };
    timeZone: string;
    now?: Date;
    /** El link público de una pieza con el dominio del negocio. */
    linkFor: (code: string) => string;
  },
  deps: ListDeps = {},
): Promise<GenerationListView | null> {
  const { workspaceId, templateId, filters } = input;
  const { data: tpl, error: tplError } = await user.from("design_templates").select("id, name, verify, doc_type, doc_type_label").eq("id", templateId).eq("workspace_id", workspaceId).maybeSingle();
  if (tplError) throw new Error(`No pude leer la plantilla: ${tplError.message}`);
  if (!tpl) return null;
  const template = tpl as unknown as { id: string; name: string; verify: boolean; doc_type: string | null; doc_type_label: string | null };

  const search = searchOrFilter(filters.q);
  const statuses = FILTER_STATUSES[filters.estado];
  const { from, to } = generationsRange(filters.page);
  let query = user.from("designs").select(LIST_COLUMNS).eq("workspace_id", workspaceId).eq("template_id", templateId);
  if (statuses) query = query.in("status", [...statuses]);
  if (search) query = query.or(search);
  const [counts, pageResult] = await Promise.all([countFilters(user, workspaceId, templateId, search), query.order("created_at", { ascending: false }).range(from, to)]);
  if (pageResult.error) throw new Error(`No pude leer las generaciones: ${pageResult.error.message}`);
  const rows = (pageResult.data ?? []) as unknown as DesignRow[];
  const records = rows.map(recordOf);

  // Los nombres que hacen falta para «Cómo se generó»: el equipo y las automatizaciones que aparecen en esta página.
  const flowIds = [...new Set(records.flatMap((r) => (r.source === "automation" && str(r.sourceRef?.flow_id) ? [r.sourceRef?.flow_id as string] : [])))];
  const flows: Record<string, string> = {};
  if (flowIds.length > 0) {
    const { data } = await user.from("flows").select("id, name").eq("workspace_id", workspaceId).in("id", flowIds);
    for (const f of (data ?? []) as { id: string; name: string }[]) flows[f.id] = f.name;
  }
  const needsPeople = records.some((r) => r.source === "manual" || r.source === "bulk");
  const people = needsPeople ? await (deps.loadPeople ?? defaultPeople)(workspaceId).catch(() => ({}) as Record<string, string>) : {};
  const modules = Object.fromEntries(registeredSubjectSources().map((s) => [s.group, s.source]));

  const ctx: RowContext = { people, flows, modules, can: input.can, template: { verify: template.verify }, now: input.now ?? new Date(), timeZone: input.timeZone };
  const views = records.map((r) => {
    const view = generationRow(r, ctx);
    return { ...view, link: view.actions.includes("view") || view.actions.includes("copy_link") ? input.linkFor(r.code) : null };
  });
  const total = counts[filters.estado];
  // Los contadores ya llevan la búsqueda puesta: el total del filtro elegido es el de lo encontrado.
  return {
    rows: views,
    counts,
    total,
    page: filters.page,
    pages: pageCount(total),
    polling: needsPolling(records),
    template: { id: template.id, name: template.name, verify: template.verify, docType: template.doc_type, issueLabel: issueButtonLabel({ verify: template.verify, doc_type: template.doc_type, doc_type_label: template.doc_type_label }) },
  };
}

// ─── El detalle de una pieza (F54) ──────────────────────────────────────────

export interface GenerationDetail {
  id: string;
  code: string;
  name: string;
  status: GenerationStatus;
  state: ReturnType<typeof generationRow>["state"];
  attempts: number;
  error: string | null;
  createdAt: string;
  origin: { text: string; href: string | null };
  /** Los valores usados, con el nombre de cada variable. */
  values: { key: string; label: string; value: string }[];
  emailText: string;
  canSendEmail: boolean;
  /** «certificado», «constancia»… o null: para proponer el email al mandarlo ahora. */
  noun: string | null;
  /** El link público (null si no funciona: sin publicar y sin verificación). */
  link: string | null;
}

/** El detalle de una pieza: valores usados, intentos, error y estado del email. `null` si no existe o no se ve. */
export async function generationDetailCore(
  user: Db,
  input: { workspaceId: string; designId: string; can: { generate: boolean }; timeZone: string; now?: Date; linkFor: (code: string) => string },
  deps: ListDeps = {},
): Promise<GenerationDetail | null> {
  const { data, error } = await user.from("designs").select(`${LIST_COLUMNS}, template_id`).eq("id", input.designId).eq("workspace_id", input.workspaceId).maybeSingle();
  if (error) throw new Error(`No pude leer la pieza: ${error.message}`);
  const row = data as unknown as (DesignRow & { template_id: string | null }) | null;
  if (!row || !row.template_id) return null;
  const { data: tpl } = await user.from("design_templates").select("doc, custom_vars, verify, doc_type, doc_type_label").eq("id", row.template_id).eq("workspace_id", input.workspaceId).maybeSingle();
  const template = tpl as unknown as { doc: Json; custom_vars: Json; verify: boolean; doc_type: string | null; doc_type_label: string | null } | null;
  const parsed = template ? parseDesignDoc(template.doc) : null;
  const customVars = template ? parseCustomVarsList(template.custom_vars) : [];
  const keys = [...new Set([...(parsed?.ok ? docVariables(parsed.doc) : []), ...customVars.map((v) => v.key)])];
  const labels = Object.fromEntries(keys.map((key) => [key, variableInfo(key, { customVars }).label]));

  const record = recordOf(row);
  const flows: Record<string, string> = {};
  const flowId = str(record.sourceRef?.flow_id);
  if (record.source === "automation" && flowId) {
    const { data: f } = await user.from("flows").select("id, name").eq("workspace_id", input.workspaceId).eq("id", flowId).maybeSingle();
    if (f) flows[(f as { id: string }).id] = (f as { name: string }).name;
  }
  const people = record.source === "manual" || record.source === "bulk" ? await (deps.loadPeople ?? defaultPeople)(input.workspaceId).catch(() => ({}) as Record<string, string>) : {};
  const view = generationRow(record, { people, flows, modules: Object.fromEntries(registeredSubjectSources().map((s) => [s.group, s.source])), can: input.can, template: { verify: !!template?.verify }, now: input.now ?? new Date(), timeZone: input.timeZone });
  const values = (row.values && typeof row.values === "object" && !Array.isArray(row.values) ? row.values : {}) as Record<string, unknown>;
  const flat = Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === "string"));
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    state: view.state,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    origin: view.origin,
    values: detailValues(flat, labels),
    emailText: emailStatusText(record),
    canSendEmail: canSendEmailNow(record, { can: input.can }),
    noun: template?.verify && isDocType(template.doc_type) ? docTypeNoun(template.doc_type, template.doc_type_label).toLowerCase() : null,
    link: view.actions.includes("view") || view.actions.includes("copy_link") ? input.linkFor(row.code) : null,
  };
}
