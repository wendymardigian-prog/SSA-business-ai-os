"use server";

import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { readResendConnection } from "@/lib/email/resend-config";
import { brakeWebhookProblem } from "@/lib/email/marketing-delivery-view";
import { hasWebhookSecret } from "@/lib/email/resend-connection";

/**
 * El aviso rojo del webhook (la guardia de entrega, 00287) para el editor de broadcasts y el paso «Enviar email»: si
 * los rebotes y quejas no llegan, el freno automatico no puede funcionar. Lo necesita cualquiera que arme un envio y
 * no devuelve ningun dato de la conexion (solo el texto del aviso, o null). El workspace sale de la sesion.
 *
 * Sin Resend conectado no avisa nada (no hay email que mandar). En un archivo "use server" todo lo exportado es una
 * funcion asincronica.
 */
export async function loadEmailDeliveryNotice(): Promise<string | null> {
  const ctx = await getMemberAction();
  if (!ctx) return null;
  try {
    const service = await createServiceClient();
    const { data } = await service
      .from("integration_configs")
      .select("config, is_active")
      .eq("workspace_id", ctx.workspace.id)
      .eq("type", "email_provider")
      .eq("provider", "resend")
      .maybeSingle();
    const row = data as { config?: unknown; is_active?: boolean } | null;
    if (!row?.is_active) return null;
    return brakeWebhookProblem(readResendConnection(row.config ?? {}), { secretSaved: await hasWebhookSecret(service, ctx.workspace.id) });
  } catch {
    return null;
  }
}
