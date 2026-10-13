"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/app-url";
import { isLocalUrl } from "@/lib/webhook-url";
import { hookUrl } from "@/lib/webhooks/endpoints";
import { applyContactMapping, hasIdentifier } from "@/lib/webhooks/mapping";
import { effectiveAttribution } from "@/lib/webhooks/attribution";
import { parseUpsertContactConfig } from "@/lib/webhooks/upsert-config";
import { countryFromTimezone } from "@/lib/scheduling/phone-countries";
import type { CustomFieldDef } from "@/lib/forms/contact-config";
import type { PickerEndpoint, UpsertEditorContext, UpsertPreview, WebhookActionResult } from "@/lib/webhooks/action-types";
import { findContact } from "@/lib/contacts/find-or-create";

/**
 * Lo que el editor de flujos necesita de los webhooks: elegir el endpoint del disparador, el ejemplo y
 * los datos para armar el mapeo del paso «Crear o actualizar contacto», y «Probar con el ejemplo».
 *
 * Todas piden `flows.edit`. Leen con el cliente de servicio (restringido al workspace de la sesión)
 * después de chequear el permiso, por el mismo motivo que las pantallas de webhooks: la RLS usa
 * `has_permission`, que es false para el Member de sistema. «Probar con el ejemplo» NO escribe nada.
 */

const NO_PERMISSION = "No tenés permiso para editar automatizaciones.";

async function guard() {
  const ctx = await getPermissionAction("flows.edit");
  if (!ctx) return null;
  return { ctx, db: await createServiceClient() };
}

/** Los endpoints para el selector del disparador, con su URL (credencial: solo `flows.edit`). */
export async function listWebhookEndpointsForPicker(): Promise<WebhookActionResult<{ endpoints: PickerEndpoint[] }>> {
  const g = await guard();
  if (!g) return { ok: false, error: NO_PERMISSION };
  const { data } = await g.db
    .from("webhook_endpoints")
    .select("id, name, status, token, last_received_at, listen_until, sample_payload")
    .eq("workspace_id", g.ctx.workspace.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const base = appUrl();
  const endpoints = ((data ?? []) as unknown as Array<{ id: string; name: string; status: "active" | "paused"; token: string; last_received_at: string | null; listen_until: string | null; sample_payload: PickerEndpoint["sample"] }>).map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    url: hookUrl(base, e.token),
    urlIsLocal: !base || isLocalUrl(base),
    lastReceivedAt: e.last_received_at,
    listenUntil: e.listen_until,
    sample: e.sample_payload ?? null,
  }));
  return { ok: true, endpoints };
}

/** Para el panel del paso: el ejemplo del endpoint del disparador, los campos personalizados y los tags. */
export async function getUpsertEditorContext(endpointId: string | null): Promise<WebhookActionResult<{ context: UpsertEditorContext }>> {
  const g = await guard();
  if (!g) return { ok: false, error: NO_PERMISSION };
  const ws = g.ctx.workspace.id;

  const [{ data: fields }, { data: tags }, sampleRow] = await Promise.all([
    g.db.from("custom_field_definitions").select("slug, name, type").eq("workspace_id", ws).is("deleted_at", null).order("name"),
    g.db.from("tags").select("id, name").eq("workspace_id", ws).order("name"),
    endpointId ? g.db.from("webhook_endpoints").select("sample_payload").eq("workspace_id", ws).eq("id", endpointId).is("deleted_at", null).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const sample = (sampleRow.data as { sample_payload: { payload?: Record<string, unknown>; query?: Record<string, unknown> } | null } | null)?.sample_payload ?? null;
  return {
    ok: true,
    context: {
      sample: sample ? { payload: sample.payload ?? {}, query: sample.query ?? {} } : null,
      customFields: (fields ?? []) as { slug: string; name: string; type: string }[],
      tags: (tags ?? []) as { id: string; name: string }[],
    },
  };
}

/**
 * «Probar con el ejemplo»: aplica el mapeo al ejemplo y dice qué pasaría (se crearía, se actualizaría a
 * alguien o no se podría), campo por campo. NO escribe nada. El nombre de un contacto existente solo se
 * muestra si quien prueba puede verlo (su propia RLS), así la prueba no revela a quien no le corresponde.
 */
export async function testUpsertMapping(input: { endpointId: string | null; config: unknown; samplePayload?: unknown }): Promise<WebhookActionResult<{ preview: UpsertPreview }>> {
  const g = await guard();
  if (!g) return { ok: false, error: NO_PERMISSION };
  const ws = g.ctx.workspace.id;

  let payload: unknown = input.samplePayload;
  let query: unknown = {};
  if (payload === undefined && input.endpointId) {
    const { data } = await g.db.from("webhook_endpoints").select("sample_payload").eq("workspace_id", ws).eq("id", input.endpointId).is("deleted_at", null).maybeSingle();
    const sample = (data as { sample_payload: { payload?: unknown; query?: unknown } | null } | null)?.sample_payload;
    payload = sample?.payload;
    query = sample?.query ?? {};
  }
  if (payload === undefined || payload === null) return { ok: false, error: "Todavía no hay un ejemplo. Escuchá un envío o pegá un JSON en el disparador." };

  const config = parseUpsertContactConfig(input.config);
  const [{ data: ws_ }, { data: defs }, { data: tags }] = await Promise.all([
    g.db.from("workspaces").select("timezone").eq("id", ws).maybeSingle(),
    g.db.from("custom_field_definitions").select("id, slug, name, type").eq("workspace_id", ws).is("deleted_at", null),
    g.db.from("tags").select("id, name").eq("workspace_id", ws),
  ]);
  const mapping = applyContactMapping(payload, query, config, {
    defaultCountry: countryFromTimezone((ws_ as { timezone?: string } | null)?.timezone) ?? null,
    customFields: (defs ?? []) as unknown as CustomFieldDef[],
  });
  const attribution = effectiveAttribution({ payload, query, mapped: mapping.attribution, autoDetect: config.attribution.autoDetect });

  const knownTags = new Set(((tags ?? []) as { name: string }[]).map((t) => t.name.trim().toLowerCase()));
  const unknownTags = mapping.tagNames.filter((n) => !knownTags.has(n.toLowerCase()));

  let outcome: UpsertPreview["outcome"];
  let conflicts = 0;
  if (!hasIdentifier(mapping.contact)) {
    outcome = { kind: "fail", reason: "no_identifier" };
  } else {
    // La misma búsqueda que el paso real (la regla única), sin crear nada.
    const c = mapping.contact;
    const hit = await findContact(g.db, {
      workspaceId: ws,
      identity: { phone: c.phone, whatsapp_phone: c.whatsapp_phone, email: c.email, instagram: c.instagram_username, tiktok: c.tiktok_username, x: c.twitter_username, linkedin: c.linkedin_profile_url },
    });
    const found = { contact_id: hit.contactId, conflicts: hit.conflicts };
    conflicts = found.conflicts.length;
    if (found.contact_id) {
      // El nombre solo si quien prueba puede ver al contacto (su RLS).
      const { data: visible } = await g.ctx.supabase.from("contacts").select("display_name").eq("id", found.contact_id).maybeSingle();
      outcome = { kind: "update", name: (visible as { display_name: string | null } | null)?.display_name ?? null };
    } else if (config.mode === "update_only") {
      outcome = { kind: "fail", reason: "not_found" };
    } else {
      outcome = { kind: "create" };
    }
  }

  return { ok: true, preview: { rows: mapping.rows, outcome, tagNames: mapping.tagNames, unknownTags, attribution, conflicts } };
}
