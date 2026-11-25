import { TasksScreen } from "@/components/tasks/tasks-screen";
import { requirePermission } from "@/lib/auth/guards";
import { todayInputValue } from "@/lib/dates";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { createServiceClient } from "@/lib/supabase/server";
import { TASK_COLUMNS } from "@/lib/tasks/core";
import { loadTimeFormat } from "@/lib/tasks/time-format";
import { flowIdOf } from "@/lib/tasks/format";
import type { TaskRow } from "@/lib/tasks/types";
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { inChunks, loadAllTasks } from "@/lib/tasks/load-all";
import type { TaskRepeatInfo } from "@/lib/tasks/format";
import { loadTaskRepeats } from "@/lib/tasks/repeat-load"; // @plantilla-quitar(servicios)

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

  // Primera tanda, todo en paralelo: nada de esto depende de lo otro (antes eran cinco viajes a la base en fila).
  // «Hoy» es el de quien mira; la fecha y la hora guardadas siguen siendo del workspace.
  const [loaded, members, viewerTimezone, timeFormat, service] = await Promise.all([
    // De a páginas: PostgREST corta cada respuesta en 1.000 filas y las tareas más viejas no se podían filtrar ni abrir.
    loadAllTasks<TaskRow>(supabase, workspace.id, TASK_COLUMNS, LOAD_LIMIT),
    getWorkspaceMembers(workspace.id),
    resolveViewerTimezone(workspace.timezone),
    loadTimeFormat(supabase, workspace.id, ctx.user.id),
    createServiceClient(),
  ]);
  const tasks = loaded.rows;
  const error = loaded.error;
  if (error) console.error("[tareas] no pude leer las tareas:", error);

  // Segunda tanda: los nombres que la tabla y el drawer muestran (contactos vinculados y flujos de origen).
  const contactIds = [...new Set(tasks.map((t) => t.contact_id).filter((id): id is string => !!id))];
  const flowIds = [...new Set(tasks.filter((t) => t.source === "flow").map((t) => flowIdOf(t.source_ref)).filter((id): id is string => !!id))];
  // 00522: qué tareas son la vuelta de un paso que se repite (el ícono ↻ y el bloque «Se repite»). Nunca lanza.
  let repeatsPromise: Promise<Record<string, TaskRepeatInfo>> = Promise.resolve({});
  repeatsPromise = loadTaskRepeats(supabase, tasks); // @plantilla-quitar(servicios)
  const [contacts, flows, repeats] = await Promise.all([
    // En tandas: con miles de tareas, un solo `.in()` pasaba el largo máximo de la URL.
    inChunks<{ id: string; display_name: string | null; email: string | null }>(contactIds, 200, (slice) => supabase.from("contacts").select("id, display_name, email").in("id", slice)).then((data) => ({ data })),
    inChunks<{ id: string; name: string }>(flowIds, 200, (slice) => service.from("flows").select("id, name").eq("workspace_id", workspace.id).in("id", slice)).then((data) => ({ data })),
    repeatsPromise,
  ]);

  return (
    <TasksScreen
      initialTasks={tasks}
      members={members.map((m) => ({ id: m.userId, name: m.name }))}
      currentUserId={ctx.user.id}
      today={todayInputValue(new Date(), viewerTimezone)}
      timeZone={workspace.timezone || "UTC"}
      canEdit={ctx.can("tasks.edit")}
      canDelete={ctx.can("tasks.delete")}
      contactNames={Object.fromEntries((contacts.data ?? []).map((c) => [c.id, c.display_name || c.email || "Sin nombre"]))}
      flowNames={Object.fromEntries((flows.data ?? []).map((f) => [f.id, f.name]))}
      repeats={repeats}
      loadError={!!error}
      timeFormat={timeFormat}
    />
  );
}
