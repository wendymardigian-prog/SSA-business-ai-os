"use server";

import { revalidatePath } from "next/cache";
import { getWorkspace } from "@/lib/workspace";
import { logAudit } from "@/lib/audit";
import { isAdminRole } from "@/lib/auth/roles";

/**
 * Notas del contacto (F13).
 *
 * Las notas viven en el CONTACTO, no en la conversacion: un lead que escribe
 * por Instagram y por WhatsApp tiene dos conversaciones pero una sola historia,
 * y lo que anoto el setter tiene que estar donde lo vea el vendedor.
 *
 * Permisos: cualquier miembro que vea el contacto puede escribir; editar y
 * borrar es del autor o de un Owner/Admin. La regla esta en la RLS (migracion
 * 00023) y se repite aca para poder devolver un mensaje claro en vez de un
 * silencioso "0 filas afectadas".
 */

const MAX_LENGTH = 5000;

export type NoteActionResult = { ok: true; noteId?: string } | { ok: false; error: string };

function revalidateContact(contactId: string) {
  revalidatePath(`/dashboard/contacts/${contactId}`);
}

export async function createNote(
  contactId: string,
  content: string,
): Promise<NoteActionResult> {
  const { workspace, supabase, user } = await getWorkspace();

  const text = content.trim();
  if (!text) return { ok: false, error: "La nota no puede estar vacia" };
  if (text.length > MAX_LENGTH) {
    return { ok: false, error: `La nota es muy larga (maximo ${MAX_LENGTH} caracteres)` };
  }

  // Ademas de confirmar que el contacto existe, esta consulta pasa por la RLS
  // de contacts: si el scope de leads no deja ver ese lead, no vuelve nada y
  // la nota no se crea.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (!contact) return { ok: false, error: "No encontre ese contacto" };

  const { data, error } = await supabase
    .from("contact_notes")
    .insert({
      contact_id: contactId,
      workspace_id: workspace.id,
      content: text,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[contact-notes] alta fallida:", error?.message);
    return { ok: false, error: `No pude guardar la nota: ${error?.message ?? "error desconocido"}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact_note", entityId: data.id,
    action: "create", metadata: { contact_id: contactId }, performedBy: user.id,
  });

  revalidateContact(contactId);
  return { ok: true, noteId: data.id };
}

export async function updateNote(noteId: string, content: string): Promise<NoteActionResult> {
  const { workspace, supabase, user, role } = await getWorkspace();

  const text = content.trim();
  if (!text) return { ok: false, error: "La nota no puede estar vacia" };
  if (text.length > MAX_LENGTH) {
    return { ok: false, error: `La nota es muy larga (maximo ${MAX_LENGTH} caracteres)` };
  }

  const note = await loadEditableNote(supabase, workspace.id, noteId, user.id, role);
  if (!note.ok) return note;

  const { error } = await supabase
    .from("contact_notes")
    .update({ content: text })
    .eq("id", noteId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[contact-notes] edicion fallida:", error.message);
    return { ok: false, error: `No pude guardar la nota: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact_note", entityId: noteId,
    action: "update", metadata: { contact_id: note.contactId }, performedBy: user.id,
  });

  revalidateContact(note.contactId);
  return { ok: true, noteId };
}

/** Borrado logico: la nota se puede recuperar durante 30 dias. */
export async function deleteNote(noteId: string): Promise<NoteActionResult> {
  const { workspace, supabase, user, role } = await getWorkspace();

  const note = await loadEditableNote(supabase, workspace.id, noteId, user.id, role);
  if (!note.ok) return note;

  const { error } = await supabase
    .from("contact_notes")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", noteId)
    .eq("workspace_id", workspace.id);

  if (error) {
    console.error("[contact-notes] borrado fallido:", error.message);
    return { ok: false, error: `No pude eliminar la nota: ${error.message}` };
  }

  await logAudit({
    supabase, workspaceId: workspace.id, entityType: "contact_note", entityId: noteId,
    action: "delete", metadata: { contact_id: note.contactId }, performedBy: user.id,
  });

  revalidateContact(note.contactId);
  return { ok: true, noteId };
}

/**
 * Trae la nota y confirma que quien pide puede tocarla. Devuelve el contact_id
 * porque hace falta para revalidar la ficha despues de escribir.
 */
async function loadEditableNote(
  supabase: Awaited<ReturnType<typeof getWorkspace>>["supabase"],
  workspaceId: string,
  noteId: string,
  userId: string,
  role: string,
): Promise<{ ok: true; contactId: string } | { ok: false; error: string }> {
  const { data: note } = await supabase
    .from("contact_notes")
    .select("id, contact_id, created_by")
    .eq("id", noteId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!note) return { ok: false, error: "No encontre esa nota" };

  if (note.created_by !== userId && !isAdminRole(role)) {
    return { ok: false, error: "Solo el autor de la nota o un Owner/Admin puede modificarla" };
  }

  return { ok: true, contactId: note.contact_id };
}
