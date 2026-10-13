import { TasksScreen } from "@/components/tasks/tasks-screen";
import { requirePermission } from "@/lib/auth/guards";
import { todayInputValue } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/server";
import { TASK_COLUMNS } from "@/lib/tasks/core";
import { loadTimeFormat } from "@/lib/tasks/time-format";
import { flowIdOf } from "@/lib/tasks/format";
import type { TaskRow } from "@/lib/tasks/types";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export const dynamic = "force-dynamic";

/** Tope de tareas que se traen de una vez: la tabla muestra hasta 500 y despues pagina de a 100. */
const LOAD_LIMIT = 5000;

/**
 * Tareas (Extra A). Lee con el cliente del usuario: la RLS (`can_see_task`) decide que ve cada quien; un Member
 * ve las que creo, tiene a cargo o sigue. El estado de la vista (filtros, orden, tabla o tablero, la tarea abierta)
 * vive en la URL y lo resuelve el cliente.
 */
export default async function TareasPage() {
  const ctx = await requirePermission("tasks.view");
  const { supabase, workspace } = ctx;

  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LOAD_LIMIT);
  const tasks = (data ?? []) as unknown as TaskRow[];

  const members = await getWorkspaceMembers(workspace.id);
  const timeFormat = await loadTimeFormat(supabase, workspace.id, ctx.user.id);

  // Los nombres que la tabla y el drawer muestran: contactos vinculados y flujos de origen.
  const contactIds = [...new Set(tasks.map((t) => t.contact_id).filter((id): id is string => !!id))];
  const flowIds = [...new Set(tasks.filter((t) => t.source === "flow").map((t) => flowIdOf(t.source_ref)).filter((id): id is string => !!id))];
  const service = await createServiceClient();
  const [contacts, flows] = await Promise.all([
    contactIds.length ? supabase.from("contacts").select("id, display_name, email").in("id", contactIds) : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; email: string | null }> }),
    flowIds.length ? service.from("flows").select("id, name").eq("workspace_id", workspace.id).in("id", flowIds) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  return (
    <TasksScreen
      initialTasks={tasks}
      members={members.map((m) => ({ id: m.userId, name: m.name }))}
      currentUserId={ctx.user.id}
      today={todayInputValue(new Date(), workspace.timezone || "UTC")}
      timeZone={workspace.timezone || "UTC"}
      canEdit={ctx.can("tasks.edit")}
      canDelete={ctx.can("tasks.delete")}
      contactNames={Object.fromEntries((contacts.data ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]))}
      flowNames={Object.fromEntries((flows.data ?? []).map((f) => [f.id, f.name]))}
      loadError={!!error}
      timeFormat={timeFormat}
    />
  );
}
