"use server";

/**
 * La Papelera (docs/papelera.md): vista previa, eliminar, restaurar, eliminar varios y lo importado de Fathom.
 *
 * Tres capas, como toda clave del catálogo: el botón (`can(<clave>)`), esta acción (`getPermissionAction`) y la
 * base (`trash_preview` / `trash_delete` / `trash_restore` miran `has_permission` y que la persona VEA el registro).
 * Las funciones de la base corren con la SESIÓN de la persona (no con el cliente de servicio): así la base sabe
 * quién es y el workspace sale de la sesión, nunca del navegador.
 *
 * En un archivo "use server" todo lo exportado es una función asincrónica: los tipos viven en `lib/trash/types.ts`.
 */

import { revalidatePath } from "next/cache";
import { getAnyPermissionAction, getPermissionAction, type PermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { deleteEvent } from "@/lib/google-calendar/client";
import { googleImportOf } from "@/lib/google-calendar/import-meta";
import {
  isSoftDeleteEntity,
  isTrashEntity,
  SOFT_DELETE_ENTITIES,
  TRASH_ENTITIES,
  TRASH_PERMISSION_KEYS,
  TRASH_RETENTION_DAYS,
  type TrashEntity,
} from "@/lib/trash/entities";
import { blockerMessage, blockerMessages, deleteErrorMessage, describeCounts, restoreErrorMessage, warningMessage } from "@/lib/trash/messages";
import type { TrashBulkResult, TrashDeleteResult, TrashListItem, TrashListResult, TrashPreview, TrashRestoreResult } from "@/lib/trash/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_PERMISSION = "No tenés permiso para eliminarlo.";

/** La tabla de cada tipo (para no contar el registro mismo entre «lo que se va con él»). */
const ROOT_TABLE: Record<TrashEntity, string> = {
  booking: "public.bookings",
  sale: "public.sales",
  payment: "public.payments",
  product: "public.products",
  service: "app_servicio.services",
  call: "public.calls",
  form: "public.forms",
  form_submission: "public.form_submissions",
  eod_report: "public.eod_reports",
  expense: "public.expenses",
  commission: "public.commissions",
  content_post: "public.content_posts",
  content_idea: "public.content_ideas",
  conversation: "public.conversations",
};

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
const rpcOf = (client: unknown) => (client as { rpc: Rpc }).rpc.bind(client);

function cleanOptions(entity: TrashEntity, options: unknown): Record<string, boolean> {
  const raw = (options && typeof options === "object" ? options : {}) as Record<string, unknown>;
  return entity === "sale" ? { with_service: raw.with_service === true } : {};
}

async function contextFor(entity: unknown): Promise<{ ctx: PermissionContext; entity: TrashEntity } | null> {
  if (!isTrashEntity(entity)) return null;
  const ctx = await getPermissionAction(TRASH_ENTITIES[entity].key);
  return ctx ? { ctx, entity } : null;
}

// ── Vista previa ─────────────────────────────────────────────────────────────────────────────────────────────

export async function previewTrashDelete(entityRaw: string, id: string, options?: { with_service?: boolean }): Promise<TrashPreview> {
  const found = await contextFor(entityRaw);
  if (!found) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(id)) return { ok: false, error: deleteErrorMessage("not_found") };
  const { ctx, entity } = found;
  const { data, error } = await rpcOf(ctx.supabase)("trash_preview", {
    p_workspace_id: ctx.workspace.id,
    p_entity: entity,
    p_id: id,
    p_options: cleanOptions(entity, options),
  });
  if (error) {
    console.error("[papelera] vista previa:", error.message);
    return { ok: false, error: "No pude revisar qué se elimina. Probá de nuevo." };
  }
  const res = data as { ok: boolean; code?: string; label?: string; counts?: Record<string, number>; blockers?: string[]; warnings?: string[] };
  if (!res?.ok) return { ok: false, error: deleteErrorMessage(res?.code ?? "") };
  const warnings = (res.warnings ?? []).map(warningMessage).filter((w): w is string => !!w);
  return {
    ok: true,
    label: res.label ?? "",
    alsoDeleted: describeCounts(res.counts ?? null, ROOT_TABLE[entity]),
    blockers: blockerMessages(res.blockers ?? []),
    warnings,
    offersServiceOption: entity === "sale" && (res.warnings ?? []).includes("has_service"),
    canDeleteService: ctx.can(TRASH_ENTITIES.service.key),
  };
}

// ── Eliminar ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Una agenda futura con evento en Google: se borra allá ANTES (sin avisar al invitado). El trabajo de
 * sincronización no lo puede hacer después, porque la fila ya no existe. Un fallo de Google no frena el borrado.
 */
async function removeGoogleEvent(ctx: PermissionContext, bookingId: string): Promise<void> {
  try {
    const { data: visible } = await ctx.supabase.from("bookings").select("id").eq("id", bookingId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!visible) return;
    const service = await createServiceClient();
    const { data: b } = await service
      .from("bookings")
      .select("google_event_id, google_connection_id, google_calendar_id, google_event_deleted_at, metadata")
      .eq("id", bookingId)
      .maybeSingle();
    if (!b?.google_event_id || !b.google_connection_id || !b.google_calendar_id || b.google_event_deleted_at) return;
    // 00510: una reunión pasada al sistema desde un evento que organiza otra persona no se borra de Google (borrarla
    // solo la sacaría del calendario propio, como rechazarla). Queda como evento de Google.
    if (googleImportOf(b.metadata)?.organizer_self === false) return;
    const { data: cal } = await service.from("calendars").select("external_calendar_id").eq("id", b.google_calendar_id).maybeSingle();
    if (!cal) return;
    await deleteEvent({ supabase: service }, b.google_connection_id, cal.external_calendar_id, b.google_event_id, "none");
    // La copia de la Agenda: si no, el evento quedaría a la vista como «solo en Google» hasta la próxima lectura.
    await service.from("google_calendar_events").delete().eq("calendar_id", b.google_calendar_id).eq("external_event_id", b.google_event_id);
  } catch (e) {
    console.error("[papelera] no pude borrar el evento de Google:", e instanceof Error ? e.message : String(e));
  }
}

async function deleteOne(ctx: PermissionContext, entity: TrashEntity, id: string, options: Record<string, boolean>): Promise<TrashDeleteResult> {
  if (!UUID.test(id)) return { ok: false, error: deleteErrorMessage("not_found") };
  if (entity === "booking") await removeGoogleEvent(ctx, id);
  const { data, error } = await rpcOf(ctx.supabase)("trash_delete", {
    p_workspace_id: ctx.workspace.id,
    p_entity: entity,
    p_id: id,
    p_options: options,
  });
  if (error) {
    console.error("[papelera] eliminar:", error.message);
    return { ok: false, error: deleteErrorMessage("") };
  }
  const res = data as { ok: boolean; code?: string; item_id?: string; blockers?: string[] };
  if (!res?.ok) {
    if (res?.code === "blocked") return { ok: false, error: blockerMessages(res.blockers ?? []).join(" ") || blockerMessage("") };
    return { ok: false, error: deleteErrorMessage(res?.code ?? "") };
  }
  return { ok: true, itemId: res.item_id ?? "" };
}

export async function deleteToTrash(entityRaw: string, id: string, options?: { with_service?: boolean }): Promise<TrashDeleteResult> {
  const found = await contextFor(entityRaw);
  if (!found) return { ok: false, error: NO_PERMISSION };
  // Sin `revalidatePath` a propósito: la ventana de «Eliminar» se queda abierta con «Deshacer», y si la página se
  // volviera a pedir ahora (la ficha de lo eliminado ya no existe) la ventana desaparecería. La pantalla se actualiza
  // al cerrarla (`router.refresh()` o `router.push`).
  return deleteOne(found.ctx, found.entity, id, cleanOptions(found.entity, options));
}

/** Varias filas a la vez (Ventas, Pagos, Grabaciones): de a una, en serie, con un resumen. Hasta 100 por vez. */
export async function deleteManyToTrash(entityRaw: string, ids: string[]): Promise<TrashBulkResult> {
  const found = await contextFor(entityRaw);
  if (!found) return { ok: false, error: NO_PERMISSION };
  const list = Array.from(new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && UUID.test(x)))).slice(0, 100);
  let deleted = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const id of list) {
    const r = await deleteOne(found.ctx, found.entity, id, {});
    if (r.ok) deleted += 1;
    else failures.push({ id, error: r.error });
  }
  if (deleted > 0) revalidatePath("/dashboard", "layout");
  return { ok: true, deleted, failures };
}

/**
 * «Eliminar todo lo importado» de una conexión de Fathom: las grabaciones que la persona ve de esa conexión, de a
 * tandas de 50 (la pantalla vuelve a llamar mientras queden). Ninguna vuelve a entrar al sincronizar.
 */
export async function deleteImportedCalls(connectionId: string): Promise<TrashBulkResult & { remaining?: number }> {
  const ctx = await getPermissionAction(TRASH_ENTITIES.call.key);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(connectionId)) return { ok: false, error: "No encontré esa conexión." };
  const { data, error } = await ctx.supabase
    .from("calls")
    .select("id")
    .eq("workspace_id", ctx.workspace.id)
    .eq("connection_id", connectionId)
    .order("recorded_at", { ascending: true })
    .limit(50);
  if (error) {
    console.error("[papelera] grabaciones de la conexión:", error.message);
    return { ok: false, error: "No pude leer las grabaciones." };
  }
  let deleted = 0;
  const failures: Array<{ id: string; error: string }> = [];
  for (const row of data ?? []) {
    const r = await deleteOne(ctx, "call", row.id as string, {});
    if (r.ok) deleted += 1;
    else failures.push({ id: row.id as string, error: r.error });
  }
  const { count } = await ctx.supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .eq("connection_id", connectionId);
  if (deleted > 0) revalidatePath("/dashboard", "layout");
  return { ok: true, deleted, failures, remaining: failures.length > 0 ? 0 : count ?? 0 };
}

/** Cuántas grabaciones de una conexión ve la persona (para el texto de confirmación). */
export async function countImportedCalls(connectionId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const ctx = await getPermissionAction(TRASH_ENTITIES.call.key);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  if (!UUID.test(connectionId)) return { ok: false, error: "No encontré esa conexión." };
  const { count, error } = await ctx.supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ctx.workspace.id)
    .eq("connection_id", connectionId);
  if (error) return { ok: false, error: "No pude contar las grabaciones." };
  return { ok: true, count: count ?? 0 };
}

// ── Lista de la Papelera ─────────────────────────────────────────────────────────────────────────────────────

export async function listTrash(): Promise<TrashListResult> {
  const ctx = await getAnyPermissionAction(TRASH_PERMISSION_KEYS);
  if (!ctx) return { ok: false, error: "No tenés acceso a la Papelera." };
  const items: TrashListItem[] = [];

  const { data, error } = await rpcOf(ctx.supabase)("trash_list", { p_workspace_id: ctx.workspace.id });
  // Si la base no responde (o la 00410 todavía no se aplicó), igual se listan los contactos y las tareas borrados.
  let notice: string | undefined;
  if (error) {
    console.error("[papelera] lista:", error.message);
    notice = "No pude leer lo eliminado de ventas, agendas y el resto. Abajo están los contactos y las tareas borrados.";
  }
  for (const row of (error ? [] : (data ?? [])) as Array<{ id: string; entity: string; entity_id: string; label: string; counts: Record<string, number>; deleted_by: string | null; deleted_at: string; expires_at: string }>) {
    if (!isTrashEntity(row.entity)) continue;
    items.push({
      id: row.id,
      entity: row.entity,
      entityId: row.entity_id,
      label: row.label,
      alsoDeleted: describeCounts(row.counts, ROOT_TABLE[row.entity]),
      deletedBy: row.deleted_by,
      deletedAt: row.deleted_at,
      expiresAt: row.expires_at,
    });
  }

  // Lo que ya se borraba antes (contactos y tareas): se leen con el cliente de servicio DESPUÉS de mirar la clave,
  // porque su RLS esconde lo borrado. Solo los últimos 30 días, como su purga.
  const since = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000).toISOString();
  const service = await createServiceClient();
  if (ctx.can(SOFT_DELETE_ENTITIES.contact.key)) {
    let contactsQuery = service
      .from("contacts")
      .select("id, display_name, deleted_at")
      .eq("workspace_id", ctx.workspace.id);
    const leadsFilter = ownContactsFilter(ctx);
    if (leadsFilter) contactsQuery = contactsQuery.or(leadsFilter);
    const { data: contacts, error: cErr } = await contactsQuery
      .not("deleted_at", "is", null)
      // Un duplicado que se unió a otro (Fusionar) no es algo eliminado: restaurarlo reviviría el duplicado.
      .is("metadata->merged_into", null)
      .gt("deleted_at", since)
      .order("deleted_at", { ascending: false })
      .limit(500);
    if (cErr) console.error("[papelera] contactos borrados:", cErr.message);
    for (const c of contacts ?? []) {
      items.push(softItem("contact", c.id, c.display_name || "Contacto sin nombre", c.deleted_at as string));
    }
  }
  if (ctx.can(SOFT_DELETE_ENTITIES.task.key)) {
    let tasksQuery = service
      .from("tasks")
      .select("id, title, deleted_at")
      .eq("workspace_id", ctx.workspace.id);
    const tasksFilter = ownTasksFilter(ctx);
    if (tasksFilter) tasksQuery = tasksQuery.or(tasksFilter);
    const { data: tasks, error: tErr } = await tasksQuery
      .not("deleted_at", "is", null)
      .gt("deleted_at", since)
      .order("deleted_at", { ascending: false })
      .limit(500);
    if (tErr) console.error("[papelera] tareas borradas:", tErr.message);
    for (const t of tasks ?? []) {
      items.push(softItem("task", t.id as string, (t.title as string) || "Tarea sin título", t.deleted_at as string));
    }
  }

  items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
  return { ok: true, items, notice };
}

/**
 * Con el cliente de servicio (la RLS esconde lo borrado) la Papelera respeta el alcance a mano: quien ve «solo lo
 * suyo» ve solo lo suyo borrado, con la misma regla que `can_see_task` y, para contactos, la de setter y vendedor de
 * `can_see_contact` (más estricta: no suma los chats asignados). `null` = ve todo (Owner, Admin o alcance «all»).
 * El id sale de la sesión: es un uuid, no hay texto del navegador en el filtro.
 */
function seesEverything(ctx: PermissionContext, scope: "leads" | "tasks"): boolean {
  return ctx.role === "owner" || ctx.role === "admin" || ctx.scope(scope) === "all";
}

function ownTasksFilter(ctx: PermissionContext): string | null {
  if (seesEverything(ctx, "tasks")) return null;
  const me = ctx.user.id;
  return `created_by.eq.${me},owner_id.eq.${me},follower_ids.cs.{${me}}`;
}

function ownContactsFilter(ctx: PermissionContext): string | null {
  if (seesEverything(ctx, "leads")) return null;
  const me = ctx.user.id;
  const own = `setter_id.eq.${me},vendedor_id.eq.${me}`;
  return ctx.scope("leads") === "own_unassigned" ? `${own},and(setter_id.is.null,vendedor_id.is.null)` : own;
}

function softItem(entity: "contact" | "task", id: string, label: string, deletedAt: string): TrashListItem {
  return {
    id: `${entity}:${id}`,
    entity,
    entityId: id,
    label,
    alsoDeleted: [],
    deletedBy: null,
    deletedAt,
    expiresAt: new Date(new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * 86_400_000).toISOString(),
  };
}

// ── Restaurar ────────────────────────────────────────────────────────────────────────────────────────────────

export async function restoreFromTrash(itemId: string): Promise<TrashRestoreResult> {
  // Contactos y tareas: su propio borrado suave.
  const soft = /^(contact|task):([0-9a-f-]{36})$/i.exec(itemId);
  if (soft) return restoreSoft(soft[1] as "contact" | "task", soft[2]);

  if (!UUID.test(itemId)) return { ok: false, error: restoreErrorMessage("not_found") };
  const ctx = await getAnyPermissionAction(TRASH_PERMISSION_KEYS);
  if (!ctx) return { ok: false, error: restoreErrorMessage("forbidden") };
  const { data, error } = await rpcOf(ctx.supabase)("trash_restore", { p_workspace_id: ctx.workspace.id, p_item_id: itemId });
  if (error) {
    console.error("[papelera] restaurar:", error.message);
    return { ok: false, error: "No pude restaurarlo. Probá de nuevo." };
  }
  const res = data as { ok: boolean; code?: string; entity?: string; entity_id?: string };
  if (!res?.ok) return { ok: false, error: restoreErrorMessage(res?.code ?? "") };
  revalidatePath("/dashboard", "layout");
  return { ok: true, entity: res.entity ?? "", entityId: res.entity_id ?? "" };
}

async function restoreSoft(entity: "contact" | "task", id: string): Promise<TrashRestoreResult> {
  if (!isSoftDeleteEntity(entity)) return { ok: false, error: restoreErrorMessage("not_found") };
  if (entity === "contact") {
    const { restoreContact } = await import("@/lib/actions/contacts");
    const r = await restoreContact(id);
    if (!r.ok) return { ok: false, error: r.error ?? "No pude restaurar el contacto." };
    revalidatePath("/dashboard", "layout");
    return { ok: true, entity, entityId: id };
  }
  const ctx = await getPermissionAction(SOFT_DELETE_ENTITIES.task.key);
  if (!ctx) return { ok: false, error: restoreErrorMessage("forbidden") };
  // `deleted_at` no lo escribe una sesión (privilegio por columna): lo vuelve a null el cliente de servicio,
  // filtrando por el workspace de la sesión.
  const service = await createServiceClient();
  let restore = service
    .from("tasks")
    .update({ deleted_at: null })
    .eq("id", id)
    .eq("workspace_id", ctx.workspace.id)
    .not("deleted_at", "is", null);
  // Solo lo que la persona vería: con alcance «solo lo mío», sus tareas.
  const tasksFilter = ownTasksFilter(ctx);
  if (tasksFilter) restore = restore.or(tasksFilter);
  const { data, error } = await restore.select("id");
  if (error) {
    console.error("[papelera] restaurar tarea:", error.message);
    return { ok: false, error: "No pude restaurar la tarea." };
  }
  if (!data || data.length === 0) return { ok: false, error: restoreErrorMessage("not_found") };
  await logAudit({ supabase: service, workspaceId: ctx.workspace.id, entityType: "task", entityId: id, action: "trash.restored", performedBy: ctx.user.id });
  revalidatePath("/dashboard", "layout");
  return { ok: true, entity, entityId: id };
}
