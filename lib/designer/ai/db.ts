/**
 * Leer y guardar el diseño o la plantilla sobre el que trabaja la IA (F31, F33).
 *
 * Todo con el cliente de servicio y FILTRADO por el negocio que ya validó quien
 * llama (nunca el que mande el navegador). Guardar es con control de versión
 * (`rev`): un `UPDATE … WHERE rev = <la leída>` y, si otra persona guardó en el
 * medio, devuelve `null` para que quien llama vuelva a leer y a fusionar. Nunca
 * pisa en silencio.
 *
 * Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { parseDesignDoc, type DesignDoc } from "../doc/schema";
import { isFormatKey, type FormatKey } from "../formats";
import type { CustomVar, DateFormat } from "../variables/catalog";
import type { DocType } from "../verification";
import type { DesignKind } from "../contracts";
import type { StoredQa } from "./qa";

type Db = SupabaseClient<Database>;

export interface TargetRow {
  kind: DesignKind;
  id: string;
  workspaceId: string;
  name: string;
  format: FormatKey;
  doc: DesignDoc;
  rev: number;
  style: string | null;
  origin: string;
  /** Solo plantillas. */
  template?: { verify: boolean; docType: DocType | null; docTypeLabel: string | null; customVars: CustomVar[]; dateFormat: DateFormat };
  /** Solo diseños. */
  contentPostId?: string | null;
  archived: boolean;
}

const DESIGN_COLUMNS = "id, workspace_id, name, format, doc, rev, style, origin, content_post_id, archived_at";
const TEMPLATE_COLUMNS = "id, workspace_id, name, format, doc, rev, style, origin, verify, doc_type, doc_type_label, custom_vars, date_format, archived_at";

const table = (kind: DesignKind) => (kind === "design" ? "designs" : "design_templates");

function customVarsOf(value: unknown): CustomVar[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    if (typeof o.key !== "string" || typeof o.label !== "string") return [];
    return [{ key: o.key, label: o.label, sample: typeof o.sample === "string" ? o.sample : "", default: typeof o.default === "string" ? o.default : null }];
  });
}

/**
 * Lee un diseño o plantilla del negocio. `null` si no existe, es de otro negocio, su documento no es válido o es una
 * GENERACIÓN: una pieza emitida (fila con `template_id`) es una copia congelada y la IA nunca la cambia (se vuelve a
 * generar desde la plantilla). Todo pedido, propuesta o cambio de estilo pasa por acá.
 */
export async function loadTarget(db: Db, workspaceId: string, kind: DesignKind, id: string): Promise<TargetRow | null> {
  let query = db
    .from(table(kind))
    .select(kind === "design" ? DESIGN_COLUMNS : TEMPLATE_COLUMNS)
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (kind === "design") query = query.is("template_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[designer-ai] no pude leer el diseño:", error.message);
    return null;
  }
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const parsed = parseDesignDoc(row.doc);
  if (!parsed.ok || !isFormatKey(row.format)) return null;
  const base: TargetRow = {
    kind,
    id,
    workspaceId,
    name: String(row.name ?? ""),
    format: row.format,
    doc: parsed.doc,
    rev: Number(row.rev ?? 0),
    style: typeof row.style === "string" ? row.style : null,
    origin: String(row.origin ?? ""),
    archived: row.archived_at != null,
  };
  if (kind === "design") return { ...base, contentPostId: typeof row.content_post_id === "string" ? row.content_post_id : null };
  return {
    ...base,
    template: {
      verify: row.verify === true,
      docType: (row.doc_type as DocType | null) ?? null,
      docTypeLabel: typeof row.doc_type_label === "string" ? row.doc_type_label : null,
      customVars: customVarsOf(row.custom_vars),
      dateFormat: (row.date_format as DateFormat) ?? "long",
    },
  };
}

export interface SaveInput {
  workspaceId: string;
  kind: DesignKind;
  id: string;
  /** La `rev` que se leyó: solo se guarda si sigue siendo la vigente. */
  rev: number;
  doc: DesignDoc;
  /** La clave del estilo, si cambia. */
  style?: string | null;
  /** Solo diseños: lo que dejó la revisión automática. */
  lastQa?: StoredQa | null;
}

/** Guarda con control de versión. Devuelve la `rev` nueva, o `null` si otra persona guardó antes (conflicto). */
export async function saveDocWithRev(db: Db, input: SaveInput): Promise<number | null> {
  const patch: Record<string, unknown> = { doc: input.doc as unknown as Json, rev: input.rev + 1 };
  if (input.style !== undefined) patch.style = input.style;
  if (input.kind === "design" && input.lastQa !== undefined) patch.last_qa = input.lastQa as unknown as Json;
  let query = db
    .from(table(input.kind))
    .update(patch as never)
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .eq("rev", input.rev);
  // Red de seguridad: nunca sobre una generación (ver `loadTarget`).
  if (input.kind === "design") query = query.is("template_id", null);
  const { data, error } = await query.select("rev").maybeSingle();
  if (error) {
    console.error("[designer-ai] no pude guardar el diseño:", error.message);
    throw new Error("No se pudo guardar el diseño");
  }
  return data ? Number((data as { rev: number }).rev) : null;
}

/** Una versión del documento (solo el documento, nunca imágenes: F48b). */
export async function insertVersion(
  db: Db,
  input: { workspaceId: string; kind: DesignKind; id: string; doc: DesignDoc; reason: "ai" | "manual"; authorKind: "ai" | "user"; authorId: string | null; createdBy: string | null },
): Promise<void> {
  const { error } = await db.from("design_versions").insert({
    workspace_id: input.workspaceId,
    ...(input.kind === "design" ? { design_id: input.id } : { template_id: input.id }),
    doc: input.doc as unknown as Json,
    reason: input.reason,
    author_kind: input.authorKind,
    author_id: input.authorId,
    created_by: input.createdBy,
  });
  if (error) console.error("[designer-ai] no pude guardar la versión:", error.message);
}
