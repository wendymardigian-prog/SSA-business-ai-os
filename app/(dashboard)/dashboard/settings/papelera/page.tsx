import { requireAnyPermission } from "@/lib/auth/guards";
import { listTrash } from "@/lib/actions/trash";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { TRASH_PERMISSION_KEYS } from "@/lib/trash/entities";
import { TrashView } from "./trash-view";

/**
 * Ajustes → Papelera (00410, docs/papelera.md): lo eliminado en los últimos 30 días, con «Restaurar».
 *
 * La ve quien tenga al menos una clave de «Eliminar …», y cada persona ve SOLO los tipos que puede eliminar (lo
 * decide la base en `trash_list`; contactos y tareas, la acción con sus claves). La foto de lo eliminado nunca viaja.
 */
export default async function TrashPage() {
  const ctx = await requireAnyPermission(TRASH_PERMISSION_KEYS);
  const [result, members] = await Promise.all([listTrash(), getWorkspaceMembers(ctx.workspace.id)]);
  const names = Object.fromEntries(members.map((m) => [m.userId, m.name]));
  return <TrashView items={result.ok ? result.items : []} error={result.ok ? (result.notice ?? null) : result.error} names={names} />;
}
