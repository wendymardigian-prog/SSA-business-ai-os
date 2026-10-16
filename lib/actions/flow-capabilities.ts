"use server";

import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { loadAutomationCapabilities } from "@/lib/flow-engine/capabilities";
import type { Capabilities } from "@/lib/flow-engine/node-requirements";

/**
 * Que conexiones tiene el negocio, para que los editores de automatizaciones marquen como bloqueadas las acciones que
 * no se podrian ejecutar (G1). Son cuatro verdaderos o falsos (hay Resend, hay un numero de WhatsApp, hay una IA, hay un
 * agente): lo puede pedir cualquier miembro, porque lo necesita cualquiera que arme un flujo, y no devuelve ningun dato
 * de las conexiones. El workspace sale de la sesion.
 *
 * Devuelve null si no hay sesion: el editor sigue mostrando todo habilitado, como antes. En un archivo "use server"
 * todo lo exportado es una funcion asincronica.
 */
export async function loadFlowCapabilities(): Promise<Capabilities | null> {
  const ctx = await getMemberAction();
  if (!ctx) return null;
  return loadAutomationCapabilities(await createServiceClient(), ctx.workspace.id);
}
