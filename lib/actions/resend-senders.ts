"use server";

import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit, diffFields } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { workspaceResendDomains } from "@/lib/email/resend-domains";
import { parseSenderInput, SENDER_CONFIG_KEYS, type ResendDomain, type SenderInput } from "@/lib/email/senders";
import type { Json } from "@/lib/types/database";

/**
 * Los remitentes de Resend (E8): Ajustes → Integraciones → Resend. Piden `integrations.manage` (el mismo permiso que
 * configurar Resend). La key se lee en el servidor con el cliente de servicio y nunca viaja al navegador: lo unico que
 * vuelve son los nombres y estados de los dominios.
 */

const NO_PERMISSION = "No tenés permiso para configurar Resend";

const DOMAIN_MESSAGES = {
  no_key: "Guardá primero la API key de Resend para elegir el dominio.",
  forbidden: "Tu API key no puede listar dominios; escribí el dominio a mano o usá una key con acceso completo.",
  failed: "No pude traer los dominios de Resend ahora. Escribí el dominio a mano o probá «Actualizar dominios» en un rato.",
} as const;

/** Los dominios de la cuenta, para el desplegable. Sin poder listarlos, el aviso y el campo a mano (nunca bloquea). */
export async function loadResendDomains(input: { refresh?: boolean } = {}): Promise<
  { ok: true; domains: ResendDomain[] } | { ok: false; listable: false; message: string } | { ok: false; error: string }
> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const result = await workspaceResendDomains(service as never, ctx.workspace.id, { refresh: input.refresh === true });
  if (result.ok) return { ok: true, domains: result.domains };
  return { ok: false, listable: false, message: DOMAIN_MESSAGES[result.reason] };
}

/**
 * Guarda los remitentes. Si se pudo listar los dominios, el elegido tiene que estar verificado (si no, no se guarda y
 * se dice por que). Guarda tambien `from_email` compuesto, que es lo que lee el envio.
 */
export async function saveResendSenders(input: SenderInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getPermissionAction("integrations.manage");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const { workspace, supabase, user } = ctx;

  const { data: existing } = await supabase
    .from("integration_configs")
    .select("id, config")
    .eq("workspace_id", workspace.id)
    .eq("type", "email_provider")
    .eq("provider", "resend")
    .maybeSingle();
  if (!existing) return { ok: false, error: DOMAIN_MESSAGES.no_key };

  const service = await createServiceClient();
  const listed = await workspaceResendDomains(service as never, workspace.id);
  const parsed = parseSenderInput(input, listed.ok ? listed.domains : null);
  if (!parsed.ok) return parsed;

  const before = (existing.config ?? {}) as Record<string, unknown>;
  const next: Record<string, Json> = { ...(before as Record<string, Json>) };
  for (const key of SENDER_CONFIG_KEYS) {
    const value = parsed.config[key];
    if (value) next[key] = value;
    else delete next[key];
  }

  const { error } = await supabase.from("integration_configs").update({ config: next }).eq("id", existing.id);
  if (error) {
    console.error("[resend] no pude guardar los remitentes:", error.message);
    return { ok: false, error: "No pude guardar los remitentes. Probá de nuevo." };
  }

  const changes = diffFields(
    Object.fromEntries(SENDER_CONFIG_KEYS.map((k) => [k, before[k] ?? null])),
    Object.fromEntries(SENDER_CONFIG_KEYS.map((k) => [k, next[k] ?? null])),
  );
  if (changes) {
    await logAudit({
      supabase,
      workspaceId: workspace.id,
      // Igual que el resto de las integraciones (lib/actions/integrations.ts): la entrada es del workspace.
      entityType: "channel",
      entityId: workspace.id,
      action: "update",
      changes,
      metadata: { provider: "resend", kind: "resend_senders" },
      performedBy: user.id,
    });
  }

  revalidatePath("/dashboard/settings/integrations", "layout");
  return { ok: true };
}
