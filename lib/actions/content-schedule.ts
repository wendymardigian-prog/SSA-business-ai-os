"use server";

import { revalidatePath } from "next/cache";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { registerPublishing } from "@/lib/publishing/bootstrap";
import { credentialsForPublisher } from "@/lib/publishing/credentials";
import {
  runScheduleNetworks,
  runUnscheduleNetwork,
  type ScheduleActionResult,
  type ScheduleOutcome,
} from "@/lib/publishing/schedule-core";

/**
 * Programar y desprogramar cada red, desde la pantalla (F25).
 *
 * Aca solo esta lo que depende de que haya alguien mirando: la sesion, el
 * permiso y el refresco de la pagina. El trabajo vive en
 * `lib/publishing/schedule-core.ts`, que se puede correr sin pantalla —y por
 * eso `scripts/verify-publishing.mjs` puede comprobar de punta a punta,
 * contra la base real, que un post programado se publica.
 */

const CONTENT_PATH = "/dashboard/content";

// Los tipos NO se re-exportan desde acá: en un archivo "use server" todo lo
// exportado tiene que ser una función asincrónica, y un `export type` que el
// empaquetador no borra se vuelve una referencia a algo que no existe en
// tiempo de ejecución. Quien los necesite los importa de schedule-core.

/** El contexto de quien esta llamando, con el permiso ya resuelto. */
async function scheduleContext() {
  // Programar es `content.publish`, no "ser admin" (A20): un rol
  // personalizado con ese permiso tiene que poder, y un admin al que se lo
  // sacaron, no.
  const { workspace, user, supabase, can } = await getPermissionContext();
  const service = await createServiceClient();
  // Desprogramar puede tener que avisarle al proveedor, y para eso el
  // publicador tiene que estar registrado.
  registerPublishing();

  return {
    workspaceId: workspace.id,
    userId: user.id,
    supabase,
    service,
    canPublish: can("content.publish"),
    credentialsFor: ({ publisherId }: { publisherId: string }) =>
      credentialsForPublisher(service, { publisherId, workspaceId: workspace.id }),
  };
}

export async function scheduleNetworks(input: {
  postId: string;
  platform?: string;
  /** Publicar ya, en vez de esperar la fecha. */
  now?: boolean;
}): Promise<ScheduleActionResult<ScheduleOutcome>> {
  const result = await runScheduleNetworks(await scheduleContext(), input);
  revalidatePath(CONTENT_PATH);
  return result;
}

/** Saca una red de la cola. La fecha tentativa se conserva. */
export async function unscheduleNetwork(input: {
  postId: string;
  platform: string;
}): Promise<ScheduleActionResult<{ postStatus: string }>> {
  const result = await runUnscheduleNetwork(await scheduleContext(), input);
  revalidatePath(CONTENT_PATH);
  return result;
}
