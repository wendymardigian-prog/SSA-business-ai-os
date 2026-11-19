"use server";

/**
 * La clave con la que se firma la «Llamada HTTP» de las automatizaciones (traído de RER). Una por negocio, en la bóveda
 * (`automation_webhook_secret`).
 *
 * - Con permiso de editar automatizaciones (`flows.edit`). El permiso se mira acá; el guardado va con el cliente de
 *   servicio, como la app de Fathom.
 * - La pantalla solo sabe si está guardada: el valor nunca vuelve al navegador, salvo UNA vez al generarla (hay que
 *   copiarla para dársela a quien recibe; para cambiarla se genera o se pega otra).
 * - Guardarla o cambiarla queda en el registro, sin el valor.
 */
import { randomBytes } from "node:crypto";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { listSecretNames, storeSecret, SECRET_NAMES } from "@/lib/vault";
import { webhookSecretProblem } from "@/lib/automations/webhook-signature-constants";

const NO_PERMISSION = "No tenés permiso para editar automatizaciones.";

export type WebhookSecretResult<T = object> = ({ ok: true; configured: boolean } & T) | { ok: false; error: string };

export async function getAutomationWebhookSecretInfo(): Promise<WebhookSecretResult> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const service = await createServiceClient();
  const names = await listSecretNames(service, ctx.workspace.id);
  return { ok: true, configured: names.includes(SECRET_NAMES.automationWebhookSecret) };
}

async function save(secret: string, kind: "pasted" | "generated"): Promise<WebhookSecretResult> {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  const problem = webhookSecretProblem(secret);
  if (problem) return { ok: false, error: problem };
  const service = await createServiceClient();
  const stored = await storeSecret(service, ctx.workspace.id, SECRET_NAMES.automationWebhookSecret, secret.trim());
  if (!stored.ok) return { ok: false, error: "No se pudo guardar la clave. Probá de nuevo." };
  await logAudit({
    supabase: ctx.supabase,
    workspaceId: ctx.workspace.id,
    entityType: "workspace",
    entityId: ctx.workspace.id,
    action: "update",
    // Nunca el valor: solo que se cambió y cómo.
    metadata: { kind: "automation_webhook_secret", source: kind },
    performedBy: ctx.user.id,
  });
  return { ok: true, configured: true };
}

/** Guarda la clave que se acordó con quien recibe. */
export async function saveAutomationWebhookSecret(input: { secret: string }): Promise<WebhookSecretResult> {
  return save(String(input?.secret ?? ""), "pasted");
}

/** Genera una clave nueva, la guarda y la devuelve UNA vez para copiarla. Reemplaza la anterior. */
export async function generateAutomationWebhookSecret(): Promise<WebhookSecretResult<{ secret?: string }>> {
  const secret = randomBytes(32).toString("base64url");
  const res = await save(secret, "generated");
  return res.ok ? { ...res, secret } : res;
}
