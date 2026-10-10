import { redirect } from "next/navigation";

/**
 * "Tareas en segundo plano" se mudó a Agentes IA (Bloque Agentes IA): cada
 * tarea tiene su propia página (/dashboard/agents/tareas/<id>), agrupada con
 * los agentes. Esta ruta solo redirige, para que un link o un marcador viejo
 * no rompa.
 */
export default function BackgroundTasksRedirect() {
  redirect("/dashboard/agents");
}
