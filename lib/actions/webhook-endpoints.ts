"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getPermissionAction } from "@/lib/auth/guards";
import { logAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { deleteSecret, storeSecret } from "@/lib/vault";
import { webhookSecretName } from "@/lib/secret-names";
import { deleteBlockedBy, generateToken, MAX_REPROCESS_BATCH, parseSampleJson, validateEndpointInput } from "@/lib/webhooks/endpoints";
import { flowsUsingEndpoints, loadInboundDetail } from "@/lib/webhooks/queries";
import { listenUntilFrom, isListening } from "@/lib/webhooks/listen";
import { reprocessInbound } from "@/lib/webhooks/process";
import type { InboundDetailData, WebhookActionResult } from "@/lib/webhooks/action-types";
import type { Json } from "@/lib/types/database";

/**
 * Webhooks entrantes: crear, editar, pausar, regenerar, borrar, escuchar, ejemplo y reprocesar.
 *
 * Permiso: `webhooks.manage` en TODAS (Owner/Admin y los roles que la tengan; el Member de sistema
 * NO la tiene, cambio aprobado). La lista de solo lectura para `integrations.view`/`manage` no escribe nada. El workspace sale
 * SIEMPRE de la sesion, nunca del pedido: cada consulta lleva `workspace_id = <el de la sesion>`.
 *
 * Escriben con el cliente de servicio (las tablas no tienen policies de escritura para
 * `authenticated`) y todo cambio va a `audit_log`, sin el token ni el secreto.
 */

const EDIT = "webhooks.manage";
const NO_PERMISSION = "No tenés permiso para administrar webhooks. Pedile a un Admin que te dé el permiso de editar automatizaciones.";
const NOT_FOUND = "No encontré ese endpoint. Puede que ya lo hayan borrado.";
const LIST_PATH = "/dashboard/settings/integrations/webhooks";

type Ctx = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;
type Service = Awaited<ReturnType<typeof createServiceClient>>;

async function guard(): Promise<{ ok: true; ctx: Ctx; db: Service } | { ok: false; error: string }> {
  const ctx = await getPermissionAction(EDIT);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  return { ok: true, ctx, db: await createServiceClient() };
}

async function ownEndpoint(db: Service, ctx: Ctx, endpointId: string) {
  const { data } = await db
    .from("webhook_endpoints")
    .select("id, name, status, secret_vault_name, listen_until, created_by")
    .eq("workspace_id", ctx.workspace.id)
    .eq("id", endpointId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as { id: string; name: string; status: "active" | "paused"; secret_vault_name: string | null; listen_until: string | null; created_by: string | null } | null) ?? null;
}

const audit = (db: Service, ctx: Ctx, endpointId: string, action: Parameters<typeof logAudit>[0]["action"], metadata?: Record<string, Json>) =>
  logAudit({ supabase: db, workspaceId: ctx.workspace.id, entityType: "webhook_endpoint", entityId: endpointId, action, performedBy: ctx.user.id, metadata: metadata ?? null });

export async function createWebhookEndpoint(input: { name: string; description?: string | null; eventIdPath?: string | null }): Promise<WebhookActionResult<{ endpointId: string }>> {
  const g = await guard();
  if (!g.ok) return g;
  const valid = validateEndpointInput(input);
  if (!valid.ok) return valid;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await g.db
      .from("webhook_endpoints")
      .insert({
        workspace_id: g.ctx.workspace.id,
        name: valid.value.name,
        description: valid.value.description,
        event_id_path: valid.value.eventIdPath,
        token: generateToken(),
        created_by: g.ctx.user.id,
      } as never)
      .select("id")
      .single();
    if (!error && data) {
      const id = (data as { id: string }).id;
      await audit(g.db, g.ctx, id, "webhook_endpoint.created", { name: valid.value.name });
      revalidatePath(LIST_PATH);
      return { ok: true, endpointId: id };
    }
    // 23505 por el NOMBRE (no por el token): se avisa; por el token, se reintenta con otro.
    if (error?.code === "23505" && /ws_name/.test(`${error.message} ${error.details ?? ""}`)) {
      return { ok: false, error: "Ya hay un endpoint con ese nombre. Elegí otro." };
    }
    if (error?.code !== "23505") {
      console.error("[webhooks] no pude crear el endpoint:", error?.message);
      return { ok: false, error: "No pude crear el endpoint. Probá de nuevo en un momento." };
    }
  }
  return { ok: false, error: "No pude generar una URL única. Probá de nuevo." };
}

export async function updateWebhookEndpoint(endpointId: string, input: { name: string; description?: string | null; eventIdPath?: string | null }): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const valid = validateEndpointInput(input);
  if (!valid.ok) return valid;
  if (!(await ownEndpoint(g.db, g.ctx, endpointId))) return { ok: false, error: NOT_FOUND };

  const { error } = await g.db
    .from("webhook_endpoints")
    .update({ name: valid.value.name, description: valid.value.description, event_id_path: valid.value.eventIdPath } as never)
    .eq("workspace_id", g.ctx.workspace.id)
    .eq("id", endpointId);
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya hay un endpoint con ese nombre. Elegí otro." };
    return { ok: false, error: "No pude guardar los cambios." };
  }
  await audit(g.db, g.ctx, endpointId, "webhook_endpoint.updated", { name: valid.value.name });
  revalidatePath(LIST_PATH);
  return { ok: true };
}

export async function setWebhookEndpointStatus(endpointId: string, status: "active" | "paused"): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (status !== "active" && status !== "paused") return { ok: false, error: "Estado inválido." };
  if (!(await ownEndpoint(g.db, g.ctx, endpointId))) return { ok: false, error: NOT_FOUND };

  // Pausar apaga tambien la escucha: un endpoint pausado no captura.
  const { error } = await g.db
    .from("webhook_endpoints")
    .update({ status, ...(status === "paused" ? { listen_until: null } : {}) } as never)
    .eq("workspace_id", g.ctx.workspace.id)
    .eq("id", endpointId);
  if (error) return { ok: false, error: "No pude cambiar el estado." };
  await audit(g.db, g.ctx, endpointId, status === "paused" ? "webhook_endpoint.paused" : "webhook_endpoint.resumed");
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** La URL vieja deja de funcionar YA: el token nuevo reemplaza al anterior. */
export async function regenerateWebhookToken(endpointId: string): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(await ownEndpoint(g.db, g.ctx, endpointId))) return { ok: false, error: NOT_FOUND };

  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await g.db
      .from("webhook_endpoints")
      .update({ token: generateToken() } as never)
      .eq("workspace_id", g.ctx.workspace.id)
      .eq("id", endpointId);
    if (!error) {
      await audit(g.db, g.ctx, endpointId, "webhook_endpoint.token_regenerated");
      revalidatePath(LIST_PATH);
      return { ok: true };
    }
    if (error.code !== "23505") break;
  }
  return { ok: false, error: "No pude regenerar la URL." };
}

/**
 * Genera el secreto del header `x-webhook-secret`, lo guarda en Vault y lo devuelve UNA vez: no se
 * puede volver a ver. Para cambiarlo se genera otro.
 */
export async function generateWebhookSecret(endpointId: string): Promise<WebhookActionResult<{ secret: string }>> {
  const g = await guard();
  if (!g.ok) return g;
  const endpoint = await ownEndpoint(g.db, g.ctx, endpointId);
  if (!endpoint) return { ok: false, error: NOT_FOUND };

  const secret = randomBytes(24).toString("base64url");
  const name = webhookSecretName(endpointId);
  const stored = await storeSecret(g.db as never, g.ctx.workspace.id, name, secret);
  if (!stored.ok) return { ok: false, error: "No pude guardar el secreto." };
  const { error } = await g.db
    .from("webhook_endpoints")
    .update({ secret_vault_name: name } as never)
    .eq("workspace_id", g.ctx.workspace.id)
    .eq("id", endpointId);
  if (error) return { ok: false, error: "No pude activar el secreto." };
  await audit(g.db, g.ctx, endpointId, "webhook_endpoint.secret_changed", { enabled: true });
  revalidatePath(LIST_PATH);
  return { ok: true, secret };
}

export async function removeWebhookSecret(endpointId: string): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const endpoint = await ownEndpoint(g.db, g.ctx, endpointId);
  if (!endpoint) return { ok: false, error: NOT_FOUND };
  if (endpoint.secret_vault_name) await deleteSecret(g.db as never, g.ctx.workspace.id, endpoint.secret_vault_name);
  await g.db.from("webhook_endpoints").update({ secret_vault_name: null } as never).eq("workspace_id", g.ctx.workspace.id).eq("id", endpointId);
  await audit(g.db, g.ctx, endpointId, "webhook_endpoint.secret_changed", { enabled: false });
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** Borrado suave. Solo si ningun flujo PUBLICADO lo usa: si lo usan, se ofrece pausar. */
export async function deleteWebhookEndpoint(endpointId: string): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const endpoint = await ownEndpoint(g.db, g.ctx, endpointId);
  if (!endpoint) return { ok: false, error: NOT_FOUND };

  const using = (await flowsUsingEndpoints(g.db, g.ctx.workspace.id, [endpointId])).get(endpointId) ?? [];
  const blocked = deleteBlockedBy(using);
  if (!blocked.ok) return { ok: false, error: blocked.error };

  const { error } = await g.db
    .from("webhook_endpoints")
    .update({ deleted_at: new Date().toISOString(), listen_until: null } as never)
    .eq("workspace_id", g.ctx.workspace.id)
    .eq("id", endpointId);
  if (error) return { ok: false, error: "No pude borrar el endpoint." };
  if (endpoint.secret_vault_name) await deleteSecret(g.db as never, g.ctx.workspace.id, endpoint.secret_vault_name);
  await audit(g.db, g.ctx, endpointId, "webhook_endpoint.deleted", { name: endpoint.name });
  revalidatePath(LIST_PATH);
  return { ok: true };
}

/** "Escuchar el próximo envío": 15 minutos. Lo que llegue se guarda como ejemplo y no dispara flujos. */
export async function startWebhookListening(endpointId: string): Promise<WebhookActionResult<{ listenUntil: string }>> {
  const g = await guard();
  if (!g.ok) return g;
  const endpoint = await ownEndpoint(g.db, g.ctx, endpointId);
  if (!endpoint) return { ok: false, error: NOT_FOUND };
  if (endpoint.status === "paused") return { ok: false, error: "El endpoint está pausado: reanudalo para escuchar un envío." };
  const until = listenUntilFrom(new Date()).toISOString();
  const { error } = await g.db.from("webhook_endpoints").update({ listen_until: until } as never).eq("workspace_id", g.ctx.workspace.id).eq("id", endpointId);
  if (error) return { ok: false, error: "No pude empezar a escuchar." };
  return { ok: true, listenUntil: until };
}

export async function stopWebhookListening(endpointId: string): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(await ownEndpoint(g.db, g.ctx, endpointId))) return { ok: false, error: NOT_FOUND };
  await g.db.from("webhook_endpoints").update({ listen_until: null } as never).eq("workspace_id", g.ctx.workspace.id).eq("id", endpointId);
  return { ok: true };
}

/** Lo consulta el panel cada 3 segundos mientras escucha (sin Realtime nuevo). */
export async function pollWebhookSample(endpointId: string): Promise<WebhookActionResult<{ listening: boolean; sampleCapturedAt: string | null }>> {
  const g = await guard();
  if (!g.ok) return g;
  const { data } = await g.db
    .from("webhook_endpoints")
    .select("listen_until, sample_payload")
    .eq("workspace_id", g.ctx.workspace.id)
    .eq("id", endpointId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return { ok: false, error: NOT_FOUND };
  const row = data as { listen_until: string | null; sample_payload: { captured_at?: string } | null };
  return { ok: true, listening: isListening(new Date(), row.listen_until), sampleCapturedAt: row.sample_payload?.captured_at ?? null };
}

async function saveSample(db: Service, ctx: Ctx, endpointId: string, payload: Record<string, unknown>, query: Record<string, unknown>): Promise<boolean> {
  const { error } = await db
    .from("webhook_endpoints")
    .update({ sample_payload: { payload, query, captured_at: new Date().toISOString() } as unknown as Json, listen_until: null } as never)
    .eq("workspace_id", ctx.workspace.id)
    .eq("id", endpointId);
  if (!error) await audit(db, ctx, endpointId, "webhook_endpoint.sample_saved");
  return !error;
}

/** Cuando pasaron los 15 minutos: pegar un JSON a mano (validado). */
export async function saveWebhookSampleFromJson(endpointId: string, text: string): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(await ownEndpoint(g.db, g.ctx, endpointId))) return { ok: false, error: NOT_FOUND };
  const parsed = parseSampleJson(text);
  if (!parsed.ok) return parsed;
  if (!(await saveSample(g.db, g.ctx, endpointId, parsed.value, {}))) return { ok: false, error: "No pude guardar el ejemplo." };
  return { ok: true };
}

/** "Usar uno del historial": copia los datos de un envío como ejemplo del endpoint. */
export async function saveWebhookSampleFromHistory(endpointId: string, inboundId: string): Promise<WebhookActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!(await ownEndpoint(g.db, g.ctx, endpointId))) return { ok: false, error: NOT_FOUND };
  const { data } = await g.db
    .from("inbound_webhooks")
    .select("payload, query")
    .eq("workspace_id", g.ctx.workspace.id)
    .eq("endpoint_id", endpointId)
    .eq("id", inboundId)
    .maybeSingle();
  const row = data as { payload: Record<string, unknown> | null; query: Record<string, unknown> | null } | null;
  if (!row) return { ok: false, error: "No encontré ese envío." };
  if (!row.payload) return { ok: false, error: "Los datos de ese envío ya se borraron (más de 90 días)." };
  if (!(await saveSample(g.db, g.ctx, endpointId, row.payload, row.query ?? {}))) return { ok: false, error: "No pude guardar el ejemplo." };
  return { ok: true };
}

/**
 * Reprocesa envios con la version publicada ACTUAL de cada flujo. Un flujo que YA corrio para ese envio NO se
 * repite (nada de mensajes duplicados): solo vuelve a mapear el contacto; corren los que todavia no corrieron o
 * fallaron. Con `rerunCompleted` (la casilla «Volver a correr tambien los flujos que ya corrieron», apagada por
 * defecto) se vuelven a correr TODOS, y si mandan mensajes se mandan de nuevo: queda auditado quien lo pidio.
 * Un doble clic corre una sola vez (claim sobre `reprocess_count`).
 */
export async function reprocessWebhookInbounds(
  items: { id: string; reprocessCount: number }[],
  options: { rerunCompleted?: boolean } = {},
): Promise<WebhookActionResult<{ reprocessed: number; skipped: number }>> {
  const g = await guard();
  if (!g.ok) return g;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "No elegiste ningún envío." };
  if (items.length > MAX_REPROCESS_BATCH) return { ok: false, error: `Podés reprocesar hasta ${MAX_REPROCESS_BATCH} envíos a la vez.` };
  const rerunCompleted = options?.rerunCompleted === true;

  // Solo envios del workspace de la sesion.
  const ids = items.map((i) => i.id);
  const { data: own } = await g.db.from("inbound_webhooks").select("id, endpoint_id").eq("workspace_id", g.ctx.workspace.id).in("id", ids);
  const endpointOf = new Map(((own ?? []) as { id: string; endpoint_id: string }[]).map((r) => [r.id, r.endpoint_id]));

  let reprocessed = 0;
  let skipped = 0;
  const queue = items.filter((i) => endpointOf.has(i.id));
  skipped += items.length - queue.length;
  for (let i = 0; i < queue.length; i += 5) {
    const outcomes = await Promise.all(queue.slice(i, i + 5).map((item) => reprocessInbound(g.db, item.id, item.reprocessCount, { rerunCompleted })));
    for (const [idx, outcome] of outcomes.entries()) {
      const item = queue[i + idx];
      if (outcome.kind === "processed") {
        reprocessed++;
        // Se espera (no `void`): volver a correr lo que ya corrio es lo unico que puede repetir mensajes y tiene
        // que quedar escrito quien lo pidio antes de contestar.
        await audit(g.db, g.ctx, endpointOf.get(item.id)!, "webhook_endpoint.reprocessed", {
          inbound_id: item.id,
          reprocess_count: item.reprocessCount + 1,
          rerun_completed: rerunCompleted,
        });
      } else {
        skipped++;
      }
    }
  }
  revalidatePath(LIST_PATH);
  return { ok: true, reprocessed, skipped };
}

/** El detalle de UN envio (con el payload) para el cajon del historial. Solo `webhooks.manage`. */
export async function getWebhookInboundDetail(inboundId: string): Promise<WebhookActionResult<{ detail: InboundDetailData }>> {
  const g = await guard();
  if (!g.ok) return g;
  const detail = await loadInboundDetail(g.db, g.ctx.workspace.id, inboundId);
  if (!detail) return { ok: false, error: "No encontré ese envío." };
  return { ok: true, detail };
}
