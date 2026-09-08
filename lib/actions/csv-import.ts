"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";
import { findDuplicateContact } from "@/lib/contacts/dedup";
import { mapRow, type ColumnMapping } from "@/lib/csv/map";
import type { ContactFieldKey } from "@/lib/contacts/fields";
import type { Json } from "@/lib/types/database";
// Los limites viven en su propio modulo: un archivo "use server" solo puede
// exportar funciones async.
import { IMPORT_BATCH_SIZE, MAX_IMPORT_ROWS, MAX_ERROR_DETAILS } from "@/lib/csv/limits";

/**
 * Importacion de contactos desde CSV (F19).
 *
 * El archivo se parsea en el navegador y llega hasta aca en tandas. Tres
 * motivos:
 *
 * 1. El body de una Server Action tiene un tope de 1 MB por default, y el
 *    limite del requerimiento son 10 MB. Mandarlo entero obligaria a subir ese
 *    tope para toda la app.
 * 2. La barra de progreso sale gratis: tandas hechas sobre tandas totales, sin
 *    tabla de trabajos ni cron ni polling.
 * 3. La pantalla de mapeo ya necesita las filas parseadas del lado del cliente.
 *    Parsear dos veces la misma planilla no tiene sentido.
 *
 * Lo que se paga por esto: la importacion no es atomica. Si una tanda falla, lo
 * anterior queda escrito. Por eso la fila de csv_imports se crea al empezar y
 * se cierra al terminar: una importacion cortada es una que quedo sin
 * finished_at y con contadores que no suman total_rows.
 *
 * Todo corre con el cliente del usuario, nunca con la service key: un Member
 * importando pasa por la misma RLS que si cargara los contactos a mano.
 */


export type ImportStartResult =
  | { ok: true; importId: string }
  | { ok: false; error: string };

export interface BatchCounters {
  imported: number;
  updated: number;
  errors: number;
  details: { line: number; error: string }[];
}

export type ImportBatchResult =
  | { ok: true; counters: BatchCounters }
  | { ok: false; error: string };

/** Abre la importacion y devuelve el id con el que se van a mandar las tandas. */
export async function startImport(
  fileName: string,
  totalRows: number,
): Promise<ImportStartResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const name = (fileName ?? "").trim().slice(0, 200);
  if (!name) return { ok: false, error: "El archivo no tiene nombre" };

  if (!Number.isFinite(totalRows) || totalRows < 1) {
    return { ok: false, error: "El archivo no tiene filas para importar" };
  }
  if (totalRows > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `El archivo tiene ${totalRows} filas y el maximo son ${MAX_IMPORT_ROWS}. Partilo en varios.`,
    };
  }

  const { data, error } = await supabase
    .from("csv_imports")
    .insert({
      workspace_id: workspace.id,
      file_name: name,
      total_rows: totalRows,
      imported_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[csv-import] no pude abrir la importacion:", error?.message);
    return { ok: false, error: `No pude empezar la importacion: ${error?.message ?? "error desconocido"}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "csv_import", entityId: data.id,
    action: "import", metadata: { stage: "start", file_name: name, total_rows: totalRows },
    performedBy: user.id,
  });

  return { ok: true, importId: data.id };
}

export interface ImportBatchInput {
  importId: string;
  /** Filas crudas del CSV, tal como salieron del parser. */
  rows: string[][];
  mapping: ColumnMapping[];
  /** Indice de la primera fila de esta tanda dentro del archivo. */
  offset: number;
  /** Asignaciones y tags que se aplican a todas las filas del archivo. */
  setterId?: string | null;
  vendedorId?: string | null;
  extraTags?: string[];
}

/**
 * Procesa una tanda: valida cada fila, busca si el contacto ya existe y crea o
 * actualiza. Devuelve los contadores de ESTA tanda; el acumulado lo lleva la
 * fila de csv_imports.
 */
export async function importBatch(input: ImportBatchInput): Promise<ImportBatchResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const { importId, rows, mapping, offset } = input;

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "La tanda vino vacia" };
  }
  if (rows.length > IMPORT_BATCH_SIZE) {
    return { ok: false, error: "La tanda es muy grande" };
  }

  // Ademas de confirmar que existe, esto pasa por la RLS: nadie puede sumarle
  // filas a la importacion de otro.
  const { data: registro } = await supabase
    .from("csv_imports")
    .select("id, imported, updated, errors, error_details")
    .eq("id", importId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!registro) return { ok: false, error: "No encontre esa importacion" };

  const setterId = await validMember(supabase, workspace.id, input.setterId);
  const vendedorId = await validMember(supabase, workspace.id, input.vendedorId);

  // Las filas se validan primero para poder resolver TODOS los tags de la
  // tanda de una vez. Resolverlos fila por fila haria una consulta por cada
  // "vip" de una planilla de 500 contactos etiquetados igual.
  const validadas = rows.map((row, i) => mapRow(row, mapping, offset + i));

  const nombresDeTags = new Set(input.extraTags ?? []);
  for (const r of validadas) {
    if (r.ok) for (const t of r.row.tags) nombresDeTags.add(t);
  }
  const tagIds = await resolveTags(supabase, workspace.id, [...nombresDeTags]);

  const counters: BatchCounters = { imported: 0, updated: 0, errors: 0, details: [] };

  for (const result of validadas) {
    if (!result.ok) {
      counters.errors++;
      counters.details.push({ line: result.line, error: result.error });
      continue;
    }

    const { patch, tags } = result.row;

    try {
      const existing = await findDuplicateContact({
        supabase,
        workspaceId: workspace.id,
        phones: [patch.phone, patch.whatsapp_phone],
        emails: [patch.email, patch.secondary_email],
        select: "id",
      });

      const contactId = existing
        ? await updateExisting(supabase, workspace.id, existing.id as string, patch, setterId, vendedorId)
        : await insertNew(supabase, workspace.id, patch, setterId, vendedorId);

      if (!contactId) {
        counters.errors++;
        counters.details.push({ line: result.row.line, error: "No se pudo guardar el contacto" });
        continue;
      }

      // Los de la columna de tags de esta fila, mas los que se eligieron para
      // todo el archivo.
      const paraAsignar = [...new Set([...tags, ...(input.extraTags ?? [])])]
        .map((nombre) => tagIds.get(nombre.toLowerCase()))
        .filter((id): id is string => Boolean(id));

      if (paraAsignar.length > 0) {
        await supabase.from("contact_tags").upsert(
          paraAsignar.map((tagId) => ({ contact_id: contactId, tag_id: tagId })),
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
        );
      }

      if (existing) counters.updated++;
      else counters.imported++;
    } catch (err) {
      counters.errors++;
      counters.details.push({
        line: result.row.line,
        error: err instanceof Error ? err.message : "Error inesperado",
      });
    }
  }

  const detallePrevio = (registro.error_details as { line: number; error: string }[]) ?? [];
  const detalle = [...detallePrevio, ...counters.details].slice(0, MAX_ERROR_DETAILS);

  const { error: updateError } = await supabase
    .from("csv_imports")
    .update({
      imported: registro.imported + counters.imported,
      updated: registro.updated + counters.updated,
      errors: registro.errors + counters.errors,
      error_details: detalle as unknown as Json,
    })
    .eq("id", importId)
    .eq("workspace_id", workspace.id);

  if (updateError) {
    // Los contactos ya se escribieron: perder el contador no justifica
    // hacerle creer a la persona que la tanda fallo.
    console.error("[csv-import] no pude actualizar los contadores:", updateError.message);
  }

  void user;
  return { ok: true, counters };
}

/** Cierra la importacion y deja el resultado en el audit log. */
export async function finishImport(importId: string) {
  const { workspace, supabase, user } = await getWorkspace();

  const { data: registro } = await supabase
    .from("csv_imports")
    .select("id, file_name, total_rows, imported, updated, errors")
    .eq("id", importId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!registro) return { ok: false as const, error: "No encontre esa importacion" };

  await supabase
    .from("csv_imports")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("workspace_id", workspace.id);

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "csv_import", entityId: importId,
    action: "import",
    metadata: {
      stage: "finish",
      file_name: registro.file_name,
      total_rows: registro.total_rows,
      imported: registro.imported,
      updated: registro.updated,
      errors: registro.errors,
    },
    performedBy: user.id,
  });

  revalidatePath("/dashboard/contacts");
  return { ok: true as const, summary: registro };
}

// ------------------------------------------------------------
// Auxiliares
// ------------------------------------------------------------

type Client = Awaited<ReturnType<typeof getWorkspace>>["supabase"];

/** Un id de persona solo vale si es de alguien del workspace. */
async function validMember(
  supabase: Client,
  workspaceId: string,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? userId : null;
}

/**
 * Los tags del archivo se buscan por nombre y se crean los que falten, una sola
 * vez por tanda. Sin esto, una planilla con 500 filas etiquetadas "vip" haria
 * 500 consultas para resolver el mismo tag.
 */
async function resolveTags(
  supabase: Client,
  workspaceId: string,
  nombres: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const limpios = [...new Set(nombres.map((n) => n.trim()).filter(Boolean))];
  if (limpios.length === 0) return mapa;

  const { data: existentes } = await supabase
    .from("tags")
    .select("id, name")
    .eq("workspace_id", workspaceId);

  for (const tag of existentes ?? []) mapa.set(tag.name.toLowerCase(), tag.id);

  const faltantes = limpios.filter((n) => !mapa.has(n.toLowerCase()));
  if (faltantes.length > 0) {
    const { data: creados } = await supabase
      .from("tags")
      .insert(faltantes.map((name) => ({ workspace_id: workspaceId, name })))
      .select("id, name");
    for (const tag of creados ?? []) mapa.set(tag.name.toLowerCase(), tag.id);
  }

  return mapa;
}

async function insertNew(
  supabase: Client,
  workspaceId: string,
  patch: Partial<Record<ContactFieldKey, string | null>>,
  setterId: string | null,
  vendedorId: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("contacts")
    // El patch sale de validateContactField, que ya dejo cada valor en su
    // forma valida; el cast es porque los tipos generados a mano no pueden
    // seguir esa validacion.
    .insert({
      workspace_id: workspaceId,
      ...(patch as Record<string, never>),
      ...(setterId ? { setter_id: setterId } : {}),
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

/**
 * Actualiza solo con lo que trae el archivo y solo donde el contacto no tenia
 * nada. Una planilla vieja no puede pisar un telefono que alguien corrigio a
 * mano la semana pasada.
 */
async function updateExisting(
  supabase: Client,
  workspaceId: string,
  contactId: string,
  patch: Partial<Record<ContactFieldKey, string | null>>,
  setterId: string | null,
  vendedorId: string | null,
): Promise<string | null> {
  const { data: actual } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!actual) return null;

  const cambios: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!value) continue;
    const previo = (actual as Record<string, unknown>)[key];
    if (previo === null || previo === undefined || previo === "") cambios[key] = value;
  }

  if (setterId && !actual.setter_id) cambios.setter_id = setterId;
  if (vendedorId && !actual.vendedor_id) cambios.vendedor_id = vendedorId;

  if (Object.keys(cambios).length > 0) {
    const { error } = await supabase
      .from("contacts")
      .update(cambios)
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
  }

  return contactId;
}
