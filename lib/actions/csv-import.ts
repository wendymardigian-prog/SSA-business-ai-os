"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { recordImportTouches, type ImportTouchAttribution } from "@/lib/contacts/touch-entry";
import { logAudit } from "@/lib/audit";
import { findContact, findOrCreateContact, type FindOrCreateResult } from "@/lib/contacts/find-or-create";
import { mapRow, type ColumnMapping, type ImportCustomField, type MappedRow } from "@/lib/csv/map";
import { identityLockKeys, normalizeIdentity, type ContactIdentity } from "@/lib/contacts/identity";
import { addressEmailStatus, decideEmailStatus, setEmailStatus, worstEmailStatus, type EmailStatus } from "@/lib/email/subscription";
import {
  effectiveRowSubscription,
  importOriginSlug,
  parseConsolidated,
  type RowSubscription,
  type SubscriptionOutcome,
} from "@/lib/csv/subscription";
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
 * Buscar o crear cada contacto va por la regla unica (`find_or_create_contact`, con el cliente de servicio:
 * busca entre TODOS los contactos del workspace y bloquea por dato). Completar un contacto que ya existia
 * va con el cliente del usuario: un Member pasa por la misma RLS que si lo editara a mano, y si no lo ve,
 * la fila falla con un mensaje claro en vez de crear un duplicado.
 */


export type ImportStartResult =
  | { ok: true; importId: string }
  | { ok: false; error: string };

export interface BatchCounters {
  imported: number;
  /** Filas que cayeron en un contacto que ya existia (se completaron sus campos vacios). */
  updated: number;
  /** De esas, por que dato se vincularon. */
  linkedBy: { phone: number; email: number; social: number };
  /** Datos de la planilla que no se escribieron porque ya son de OTRO contacto. */
  skippedConflicts: number;
  errors: number;
  details: { line: number; error: string }[];
}

export type ImportBatchResult =
  | {
      ok: true;
      counters: BatchCounters;
      /** Suscripcion a emails (E6): como quedo cada persona de la tanda (el navegador suma por persona). */
      subscription: SubscriptionOutcome[];
      /** Solo la prueba en seco: las identidades que se crearian en esta tanda, para las tandas siguientes. */
      planned?: Record<string, string>;
    }
  | { ok: false; error: string };

/** Abre la importacion y devuelve el id con el que se van a mandar las tandas. */
export async function startImport(
  fileName: string,
  totalRows: number,
): Promise<ImportStartResult> {
  const { workspace, supabase, user } = await getWorkspace();
  // Importar contactos pide `contacts.import` (cambio aprobado del Member, plano §9.3).
  if (!(await getPermissionAction("contacts.import"))) return { ok: false, error: "No tenés permiso para importar contactos" };

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
  /**
   * Suscripcion a emails (E6): el origen de la importacion (`otro-sistema`). Va en el historial como
   * `import:<origen>` y como etiqueta `origen:<origen>`. Sin origen, el nombre del archivo.
   */
  origin?: string | null;
  /**
   * Lo consolidado de TODO el archivo por email (`consolidateSubscriptions`, en el navegador: las tandas no ven el
   * archivo entero). Solo puede empeorar lo de cada fila: nunca re-suscribe.
   */
  subscriptions?: unknown;
}

/** La prueba en seco: lo mismo que una tanda, sin escribir nada. */
export interface PreviewBatchInput extends Omit<ImportBatchInput, "importId"> {
  fileName: string;
  /** Las identidades que ya "se crearon" en las tandas anteriores de la prueba (clave → persona). */
  planned?: Record<string, string>;
}

/**
 * Los eventos de automatizacion que la base emite al crear o completar un contacto. Una importacion NO los dispara
 * (E6): se marcan como procesados al terminar cada tanda. Queda una ventana de unos segundos (ver PENDIENTE).
 */
const IMPORT_SUPPRESSED_EVENTS = ["contact_created", "tag_added", "field_changed", "assignment_changed"];

/**
 * Procesa una tanda: valida cada fila, busca si el contacto ya existe y crea o
 * actualiza. Devuelve los contadores de ESTA tanda; el acumulado lo lleva la
 * fila de csv_imports.
 */
export async function importBatch(input: ImportBatchInput): Promise<ImportBatchResult> {
  return runBatch(input, "import");
}

/**
 * "Revisar antes de importar" (E6): corre EXACTAMENTE la misma logica que `importBatch` (mapeo, validacion, busqueda
 * por la regla unica, suscripcion), sin escribir nada. Lo que se crearia en una tanda viaja a las siguientes en
 * `planned`, asi una persona que aparece dos veces en el archivo cuenta como en la importacion real.
 */
export async function previewBatch(input: PreviewBatchInput): Promise<ImportBatchResult> {
  return runBatch({ ...input, importId: "" }, "preview", input.fileName, input.planned);
}

async function runBatch(
  input: ImportBatchInput,
  mode: "import" | "preview",
  previewFileName?: string,
  previewPlanned?: Record<string, string>,
): Promise<ImportBatchResult> {
  const { workspace, supabase, user } = await getWorkspace();
  // Importar contactos pide `contacts.import` (cambio aprobado del Member, plano §9.3).
  if (!(await getPermissionAction("contacts.import"))) return { ok: false, error: "No tenés permiso para importar contactos" };

  const { importId, rows, mapping, offset } = input;
  const preview = mode === "preview";

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "La tanda vino vacia" };
  }
  if (rows.length > IMPORT_BATCH_SIZE) {
    return { ok: false, error: "La tanda es muy grande" };
  }

  // Ademas de confirmar que existe, esto pasa por la RLS: nadie puede sumarle
  // filas a la importacion de otro. La prueba en seco no tiene importacion abierta.
  const registro = preview
    ? { id: "", file_name: previewFileName ?? "", imported: 0, updated: 0, errors: 0, error_details: [] as unknown }
    : (
        await supabase
          .from("csv_imports")
          .select("id, file_name, imported, updated, errors, error_details")
          .eq("id", importId)
          .eq("workspace_id", workspace.id)
          .maybeSingle()
      ).data;

  if (!registro) return { ok: false, error: "No encontre esa importacion" };

  // Suscripcion a emails: el origen (para el historial y la etiqueta) y lo consolidado del archivo.
  const originSlug = importOriginSlug(input.origin) || importOriginSlug(registro.file_name) || "csv";
  const subscriptionSource = `import:${originSlug}`;
  const consolidated = parseConsolidated(input.subscriptions);
  const originTag = importOriginSlug(input.origin) ? `origen:${importOriginSlug(input.origin)}` : null;
  const extraTags = [...new Set([...(input.extraTags ?? []), ...(originTag ? [originTag] : [])])];
  const batchStartedAt = new Date().toISOString();

  // Los campos personalizados vivos de ESTE workspace: una columna mapeada a un
  // campo que no esta aca (de otro workspace, o borrado) no se importa.
  const { data: fieldDefs } = await supabase
    .from("custom_field_definitions")
    .select("id, name, type")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);
  const customFields: ImportCustomField[] = fieldDefs ?? [];

  const setterId = await validMember(supabase, workspace.id, input.setterId);
  const vendedorId = await validMember(supabase, workspace.id, input.vendedorId);

  // Las filas se validan primero para poder resolver TODOS los tags de la
  // tanda de una vez. Resolverlos fila por fila haria una consulta por cada
  // "vip" de una planilla de 500 contactos etiquetados igual.
  const validadas = rows.map((row, i) => mapRow(row, mapping, offset + i, customFields));

  const nombresDeTags = new Set(extraTags);
  for (const r of validadas) {
    if (r.ok) for (const t of r.row.tags) nombresDeTags.add(t);
  }
  // La prueba en seco no crea etiquetas.
  const tagIds = preview ? new Map<string, string>() : await resolveTags(supabase, workspace.id, [...nombresDeTags]);

  const counters: BatchCounters = { imported: 0, updated: 0, linkedBy: { phone: 0, email: 0, social: 0 }, skippedConflicts: 0, errors: 0, details: [] };
  // Buscar o crear va con el cliente de SERVICIO (la regla unica mira todos los contactos del workspace, no
  // solo los que la RLS de quien importa le deja ver); el workspace sale de la sesion y las actualizaciones
  // de contactos que ya existen siguen yendo con el cliente de quien importa.
  const service = await createServiceClient();
  // Los contactos NUEVOS de esta tanda: son los unicos que entraron por la
  // importacion. Actualizar uno que ya existia no es un origen nuevo (F87).
  const nuevos: string[] = [];
  // La atribucion que trajo la planilla para cada contacto nuevo (F: importacion).
  const atribucion: Record<string, ImportTouchAttribution> = {};
  // Suscripcion a emails: como quedo cada persona, y (prueba en seco) lo que se crearia.
  const subscription: SubscriptionOutcome[] = [];
  const planned: Record<string, string> = { ...(previewPlanned ?? {}) };
  const tocados = new Set<string>();

  for (const result of validadas) {
    if (!result.ok) {
      counters.errors++;
      counters.details.push({ line: result.line, error: result.error });
      continue;
    }

    const { patch, tags, custom, attribution } = result.row;
    const rowSubscription = effectiveRowSubscription(result.row.subscription, consolidated[(patch.email ?? patch.secondary_email ?? "").toLowerCase()] ?? null);

    if (preview) {
      try {
        const planOutcome = await previewRow(service, supabase, workspace.id, patch, rowSubscription, planned);
        if (planOutcome.kind === "invisible") {
          counters.errors++;
          counters.details.push({ line: result.row.line, error: "Ya existe un contacto con ese dato. Pedile a un Admin que te lo asigne." });
          continue;
        }
        if (planOutcome.kind === "no_identity") {
          counters.errors++;
          counters.details.push({ line: result.row.line, error: "No se pudo guardar el contacto" });
          continue;
        }
        if (planOutcome.kind === "existing") {
          counters.updated++;
          counters.skippedConflicts += planOutcome.skipped;
          if (planOutcome.by === "phone") counters.linkedBy.phone++;
          else if (planOutcome.by === "email") counters.linkedBy.email++;
          else counters.linkedBy.social++;
        } else {
          counters.imported++;
        }
        if (planOutcome.subscription) subscription.push(planOutcome.subscription);
      } catch (err) {
        counters.errors++;
        counters.details.push({ line: result.row.line, error: err instanceof Error ? err.message : "Error inesperado" });
      }
      continue;
    }

    try {
      const central = await resolveRow(service, workspace.id, patch, setterId, vendedorId);

      if (central.status === "no_identity" || !central.contactId) {
        counters.errors++;
        counters.details.push({ line: result.row.line, error: "No se pudo guardar el contacto" });
        continue;
      }

      const existing = !central.created;
      let skipped = 0;
      let filled: string[] = [];
      if (existing) {
        const updated = await updateExisting(supabase, workspace.id, central.contactId, patch, setterId, vendedorId, central);
        if (!updated) {
          // Existe, pero quien importa no lo ve (su RLS): no se toca ni se crea un duplicado.
          counters.errors++;
          counters.details.push({
            line: result.row.line,
            error: "Ya existe un contacto con ese dato. Pedile a un Admin que te lo asigne.",
          });
          continue;
        }
        skipped = skippedConflictCount(patch, central);
        filled = updated.filled;
      }
      const contactId = central.contactId;

      // Campos personalizados: en uno nuevo, todos (lo creo la importacion, con
      // el cliente de servicio); en uno que ya existia, solo los que estaban
      // vacios y con el cliente de quien importa (su RLS).
      if (Object.keys(custom).length > 0) {
        const filledCustom = await writeCustomValues(existing ? supabase : service, contactId, custom, existing);
        filled = [...filled, ...filledCustom.map((id) => `custom:${customFields.find((f) => f.id === id)?.name ?? id}`)];
      }

      // Los de la columna de tags de esta fila, mas los que se eligieron para
      // todo el archivo (y la del origen).
      const paraAsignar = [...new Set([...tags, ...extraTags])]
        .map((nombre) => tagIds.get(nombre.toLowerCase()))
        .filter((id): id is string => Boolean(id));

      if (paraAsignar.length > 0) {
        await supabase.from("contact_tags").upsert(
          paraAsignar.map((tagId) => ({ contact_id: contactId, tag_id: tagId })),
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
        );
      }

      if (existing) {
        // La marca de la importacion en la ficha de un contacto que ya existia:
        // no es un toque (no fue su origen), es una entrada del historial.
        await logAudit({
          supabase, workspaceId: workspace.id, entityType: "contact", entityId: contactId,
          action: "import",
          metadata: { import_id: importId, file_name: registro.file_name, filled },
          performedBy: user.id,
        });
        counters.updated++;
        counters.skippedConflicts += skipped;
        const by = central.matchedBy;
        if (by === "phone") counters.linkedBy.phone++;
        else if (by === "email") counters.linkedBy.email++;
        else counters.linkedBy.social++;
      } else {
        counters.imported++;
        nuevos.push(contactId);
        if (Object.keys(attribution).length > 0) atribucion[contactId] = attribution;
      }
      tocados.add(contactId);

      // Suscripcion a emails (E6): por la funcion central, como el sistema (nunca re-suscribe), con la fecha original.
      // Va DESPUES de completar los datos: si la fila le puso el email a un contacto que no lo tenia, la baja alcanza
      // a esa direccion.
      if (rowSubscription) {
        const applied = await setEmailStatus(service, contactId, {
          status: rowSubscription.status,
          source: subscriptionSource,
          mode: "system",
          occurredAt: rowSubscription.at,
          subscribedAt: rowSubscription.subscribedAt,
          address: patch.email ?? patch.secondary_email ?? null,
          extra: {
            import_id: importId,
            ...(rowSubscription.originalSource ? { original_source: rowSubscription.originalSource } : {}),
          },
        });
        subscription.push({ key: contactId, status: applied.status ?? rowSubscription.status, keptExisting: applied.keptExisting });
      }
    } catch (err) {
      counters.errors++;
      counters.details.push({
        line: result.row.line,
        error: err instanceof Error ? err.message : "Error inesperado",
      });
    }
  }

  if (preview) return { ok: true, counters, subscription, planned };

  // Una importacion no dispara automatizaciones (E6): los eventos que la base emitio en esta tanda para estos
  // contactos (contacto nuevo, etiqueta, campo, asignacion) se marcan como procesados. Nunca tumba la tanda.
  if (tocados.size > 0) {
    try {
      await service
        .from("automation_events")
        .update({ processed_at: new Date().toISOString(), error: "importación de contactos (no dispara automatizaciones)" })
        .in("contact_id", [...tocados])
        .in("event_type", IMPORT_SUPPRESSED_EVENTS)
        .is("processed_at", null)
        .gte("created_at", batchStartedAt);
    } catch (err) {
      console.error("[csv-import] no pude apagar los eventos de la importacion:", err instanceof Error ? err.message : "error");
    }
  }

  // El toque de atribucion de los contactos nuevos. Despues de escribirlos y sin
  // poder tumbar la tanda: `recordImportTouches` atrapa todo (F87).
  if (nuevos.length > 0) {
    await recordImportTouches(await createServiceClient(), {
      workspaceId: workspace.id,
      importId,
      contactIds: nuevos,
      attribution: atribucion,
    });
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

  return { ok: true, counters, subscription };
}

type PreviewOutcome =
  | { kind: "new"; subscription: SubscriptionOutcome | null }
  | { kind: "existing"; by: string; skipped: number; subscription: SubscriptionOutcome | null }
  | { kind: "invisible" }
  | { kind: "no_identity" };

/** El tipo de dato de una clave de identidad, como lo cuenta la importacion. */
function linkedByOf(key: string): string {
  return key.startsWith("phone:") ? "phone" : key.startsWith("email:") ? "email" : "social";
}

/**
 * Una fila de la prueba en seco: lo que haria la importacion, sin escribir. Busca con la regla unica (`find_only`);
 * lo que se "crearia" queda en `planned` para que una segunda fila de la misma persona se cuente vinculada, igual
 * que en la importacion real. El estado de email se decide con la misma tabla que la base, sobre el peor estado
 * de la direccion en todo el workspace (incluidos los borrados, como la herencia).
 */
async function previewRow(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  supabase: Client,
  workspaceId: string,
  patch: MappedRow["patch"],
  sub: RowSubscription | null,
  planned: Record<string, string>,
): Promise<PreviewOutcome> {
  const identity: ContactIdentity = {
    phone: patch.phone, whatsapp_phone: patch.whatsapp_phone, email: patch.email, secondary_email: patch.secondary_email,
    instagram: patch.instagram_username, tiktok: patch.tiktok_username, x: patch.twitter_username, linkedin: patch.linkedin_profile_url,
  };
  const keys = identityLockKeys(normalizeIdentity(identity));
  const address = patch.email ?? patch.secondary_email ?? null;

  const decide = (key: string, current: EmailStatus): SubscriptionOutcome | null => {
    if (!sub) return null;
    const decision = decideEmailStatus(current, sub.status, "system");
    return { key, status: decision === "apply" ? sub.status : current, keptExisting: decision === "kept" };
  };
  const addressStatus = async (): Promise<EmailStatus> => (address ? ((await addressEmailStatus(service, workspaceId, address)) ?? "subscribed") : "subscribed");

  // Una persona que ya "se creo" en esta prueba (otra fila del archivo).
  // En el orden en que busca la regla unica: telefono, email, redes.
  const plannedHit = ["phone:", "email:", "instagram:", "tiktok:", "x:", "linkedin:", "facebook:"]
    .flatMap((prefix) => keys.filter((k) => k.startsWith(prefix)))
    .find((k) => planned[k]);
  if (plannedHit) {
    const person = planned[plannedHit];
    for (const k of keys) planned[k] ??= person;
    return { kind: "existing", by: linkedByOf(plannedHit), skipped: 0, subscription: decide(person, sub ? worstEmailStatus([await addressStatus()]) : "subscribed") };
  }

  const found = await findContact(service, { workspaceId, identity });
  if (found.status === "no_identity") return { kind: "no_identity" };
  if (found.contactId) {
    // Quien importa tiene que poder verlo (su RLS), igual que en la importacion real.
    const { data: visible } = await supabase.from("contacts").select("id, email_status").eq("id", found.contactId).eq("workspace_id", workspaceId).maybeSingle();
    if (!visible) return { kind: "invisible" };
    const own = (visible as { email_status?: string }).email_status ?? "subscribed";
    const current = worstEmailStatus([own, sub ? await addressStatus() : "subscribed"]);
    return { kind: "existing", by: found.matchedBy === "phone" ? "phone" : found.matchedBy === "email" ? "email" : "social", skipped: skippedConflictCount(patch, found), subscription: decide(found.contactId, current) };
  }

  const person = `new:${keys[0] ?? Math.random().toString(36).slice(2)}`;
  for (const k of keys) planned[k] = person;
  return { kind: "new", subscription: decide(person, sub ? await addressStatus() : "subscribed") };
}

/** Cierra la importacion y deja el resultado en el audit log. */
export async function finishImport(importId: string) {
  const { workspace, supabase, user } = await getWorkspace();
  // Importar contactos pide `contacts.import` (cambio aprobado del Member, plano §9.3).
  if (!(await getPermissionAction("contacts.import"))) return { ok: false as const, error: "No tenés permiso para importar contactos" };

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

/** Busca o crea la fila con la regla unica. Lo que no es un dato de identidad entra como valores por defecto. */
async function resolveRow(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  workspaceId: string,
  patch: Partial<Record<ContactFieldKey, string | null>>,
  setterId: string | null,
  vendedorId: string | null,
): Promise<FindOrCreateResult> {
  const {
    phone, whatsapp_phone, email, secondary_email, instagram_username, tiktok_username, twitter_username,
    linkedin_profile_url, ...rest
  } = patch;
  return findOrCreateContact(service, {
    workspaceId,
    identity: {
      phone, whatsapp_phone, email, secondary_email,
      instagram: instagram_username, tiktok: tiktok_username, x: twitter_username, linkedin: linkedin_profile_url,
    },
    defaults: {
      ...rest,
      ...(setterId ? { setter_id: setterId } : {}),
      ...(vendedorId ? { vendedor_id: vendedorId } : {}),
    },
    mode: "create",
  });
}

/** Las columnas de la planilla cuyo dato ya es de OTRO contacto: no se escriben. */
function conflictedKeys(central: FindOrCreateResult): Set<string> {
  const out = new Set<string>();
  for (const c of central.conflicts) {
    if (c.by === "phone") (out.add("phone"), out.add("whatsapp_phone"));
    if (c.by === "email") (out.add("email"), out.add("secondary_email"));
    if (c.by === "instagram") out.add("instagram_username");
    if (c.by === "tiktok") out.add("tiktok_username");
    if (c.by === "x") out.add("twitter_username");
    if (c.by === "linkedin") out.add("linkedin_profile_url");
  }
  return out;
}

function skippedConflictCount(patch: Partial<Record<ContactFieldKey, string | null>>, central: FindOrCreateResult): number {
  const keys = conflictedKeys(central);
  return Object.entries(patch).filter(([key, value]) => !!value && keys.has(key)).length;
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
  central: FindOrCreateResult,
): Promise<{ contactId: string; filled: string[] } | null> {
  const conflicted = conflictedKeys(central);
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
    // Un telefono, email o usuario que ya es de OTRO contacto no se escribe en este.
    if (conflicted.has(key)) continue;
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

  return { contactId, filled: Object.keys(cambios) };
}

/**
 * Escribe los campos personalizados de una fila. En un contacto que ya existia
 * solo completa los vacios (la misma regla que los datos del contacto: una
 * planilla vieja no pisa lo que alguien cargo a mano). Devuelve los ids de los
 * campos que se escribieron.
 */
async function writeCustomValues(
  client: Client | Awaited<ReturnType<typeof createServiceClient>>,
  contactId: string,
  custom: Record<string, string>,
  onlyEmpty: boolean,
): Promise<string[]> {
  let ids = Object.keys(custom);
  if (onlyEmpty) {
    const { data: actuales } = await client
      .from("contact_custom_fields")
      .select("field_id")
      .eq("contact_id", contactId)
      .in("field_id", ids);
    const tomados = new Set((actuales ?? []).map((r) => r.field_id));
    ids = ids.filter((id) => !tomados.has(id));
  }
  if (ids.length === 0) return [];
  const now = new Date().toISOString();
  const { error } = await client.from("contact_custom_fields").upsert(
    ids.map((fieldId) => ({ contact_id: contactId, field_id: fieldId, value: custom[fieldId], updated_at: now })),
    { onConflict: "contact_id,field_id", ignoreDuplicates: onlyEmpty },
  );
  if (error) {
    // El contacto ya quedo escrito: no se lo cuenta como error de la fila (se
    // crearia de nuevo al reintentar). Se loguea sin los valores.
    console.error("[csv-import] no pude guardar los campos personalizados:", error.message);
    return [];
  }
  return ids;
}
