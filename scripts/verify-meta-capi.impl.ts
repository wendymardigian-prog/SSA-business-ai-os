/**
 * La API de Conversiones de Meta contra la base real (00328).
 *
 * Lo que un test con Vitest no puede probar: la RLS de las dos tablas, el índice único con diez envíos a la vez, que el
 * trigger de `payments` encole la compra solo con el interruptor prendido (una vez por pago, sin reembolsos), que un pago
 * cobrado nunca falle por esto, y que `enqueueCapiEvent` y la cola funcionen con la base de verdad. Nunca llama a Meta.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";
import type { Database } from "../lib/types/database";
import { enqueueCapiEvent, rememberCapiRequestContext } from "../lib/meta/capi/run";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient<Database>(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) as SupabaseClient<Database>;
const db = svc as unknown as SupabaseClient;

let failures = 0;
const ok = (m: string) => console.log("  ok  ", m);
const fail = (m: string, extra?: string) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond: unknown, m: string, extra?: string) => (cond ? ok(m) : fail(m, extra));

interface TestUser {
  id: string;
  client: SupabaseClient<Database>;
}

async function makeUser(tag: string): Promise<TestUser> {
  const email = `zz-test-capi-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient<Database>(URL, ANON, { auth: { persistSession: false } }) as SupabaseClient<Database>;
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const dateOf = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

try {
  console.log("\n— Preparacion —");
  const [owner, member, ajeno] = await Promise.all(["owner", "member", "ajeno"].map(makeUser));

  const { data: ws, error: wsError } = await db
    .from("workspaces")
    .insert({ name: "zz-test-capi", slug: `zz-test-capi-${Date.now()}`, timezone: "UTC" })
    .select("id")
    .single();
  if (wsError) throw new Error(`no pude crear el workspace: ${wsError.message}`);
  const workspaceId = ws.id as string;

  const { error: membersError } = await db.from("workspace_members").upsert(
    [
      { workspace_id: workspaceId, user_id: owner.id, role: "owner" },
      { workspace_id: workspaceId, user_id: member.id, role: "member" },
    ],
    { onConflict: "workspace_id,user_id" },
  );
  if (membersError) throw new Error(`no pude sumar al equipo: ${membersError.message}`);

  const { data: contact, error: contactError } = await db
    .from("contacts")
    .insert({ workspace_id: workspaceId, display_name: "zz-test Lead", email: `zz-test-lead-${Date.now()}@example.test` })
    .select("id")
    .single();
  if (contactError) throw new Error(`no pude crear el contacto: ${contactError.message}`);

  console.log("\n— Sin configurar —");
  await rememberCapiRequestContext(svc, { workspaceId, sourceType: "booking", sourceId: randomUUID(), ip: "190.12.34.56", userAgent: "zz-test" });
  const { data: noCtx } = await db.from("meta_capi_request_context").select("id").eq("workspace_id", workspaceId);
  check((noCtx ?? []).length === 0, "sin la API configurada no se guarda la IP");

  const { error: cfgError } = await db.from("integration_configs").insert({
    workspace_id: workspaceId,
    type: "meta",
    provider: "meta_capi",
    display_name: "zz-test capi",
    is_active: true,
    config: { pixel_id: "1234567890", purchase_enabled: "false" },
  });
  if (cfgError) throw new Error(`no pude configurar la API de Conversiones: ${cfgError.message}`);

  console.log("\n— La IP y el navegador —");
  const bookingRef = randomUUID();
  await rememberCapiRequestContext(svc, { workspaceId, sourceType: "booking", sourceId: bookingRef, ip: "190.12.34.56", userAgent: "zz-test" });
  await rememberCapiRequestContext(svc, { workspaceId, sourceType: "booking", sourceId: bookingRef, ip: "190.12.34.56", userAgent: "zz-test" });
  const { data: ctxRows } = await db.from("meta_capi_request_context").select("id").eq("workspace_id", workspaceId);
  check((ctxRows ?? []).length === 1, "configurada, se guarda una sola vez por reunión", `filas: ${ctxRows?.length}`);
  const { data: ownerCtx } = await owner.client.from("meta_capi_request_context").select("id").eq("workspace_id", workspaceId);
  check((ownerCtx ?? []).length === 0, "ni el Owner la lee con la sesión (solo service_role)");

  console.log("\n— Un evento, una sola vez —");
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      enqueueCapiEvent(svc, { workspaceId, eventName: "Schedule", eventId: `booking.${bookingRef}`, sourceType: "booking", sourceId: bookingRef, eventTime: new Date().toISOString() }),
    ),
  );
  check(results.filter((r) => r.ok).length === 1, "diez a la vez: uno se anota, nueve chocan con el índice único", JSON.stringify(results.map((r) => (r.ok ? "ok" : r.reason))));
  const { data: events } = await db.from("meta_capi_events").select("id, status").eq("workspace_id", workspaceId);
  check((events ?? []).length === 1 && events?.[0].status === "pending", "queda una fila pendiente");
  const { data: jobs } = await db.from("scheduled_jobs").select("id").eq("type", "meta_capi_send").eq("dedupe_key", `meta_capi:${events?.[0]?.id}`);
  check((jobs ?? []).length === 1, "y un job en la cola");

  console.log("\n— Quien ve los envios —");
  const { data: ownerEvents } = await owner.client.from("meta_capi_events").select("id").eq("workspace_id", workspaceId);
  check((ownerEvents ?? []).length === 1, "el Owner los ve");
  const { data: memberEvents } = await member.client.from("meta_capi_events").select("id").eq("workspace_id", workspaceId);
  check((memberEvents ?? []).length === 0, "un Member de sistema no (no tiene integrations.view)");
  const { data: foreignEvents } = await ajeno.client.from("meta_capi_events").select("id").eq("workspace_id", workspaceId);
  check((foreignEvents ?? []).length === 0, "alguien de otro negocio no");
  const { error: ownerInsert } = await owner.client.from("meta_capi_events").insert({ workspace_id: workspaceId, event_name: "Lead", event_id: "x", source_type: "contact", source_id: contact.id, event_time: new Date().toISOString() });
  check(ownerInsert, "nadie escribe con la sesión");

  // @plantilla-desde(ventas)
  console.log("\n— La compra de cada pago cobrado —");
  const { data: prod } = await svc.from("products").insert({ workspace_id: workspaceId, name: "zz-test Programa" } as never).select("id").single();
  const { data: variant } = await svc.from("product_variants").insert({ workspace_id: workspaceId, product_id: prod?.id, name: "zz-test variante" } as never).select("id").single();
  const { data: sale, error: saleError } = await db
    .from("sales")
    .insert({ workspace_id: workspaceId, contact_id: contact.id, product_variant_id: variant?.id, product_snapshot: { product_id: prod?.id, variant_id: variant?.id }, base_amount: 300, final_amount: 300, status: "pending", financing_type: "full", sale_date: dateOf(0), attribution_type: "none" })
    .select("id")
    .single();
  if (saleError) throw new Error(`no pude crear la venta: ${saleError.message}`);
  const payBase = { workspace_id: workspaceId, sale_id: sale.id, type: "full" };

  const { data: offPay } = await db.from("payments").insert({ ...payBase, amount: 100, status: "paid", paid_at: new Date().toISOString(), paid_on: dateOf(0) }).select("id").single();
  const { data: offEvents } = await db.from("meta_capi_events").select("id").eq("source_id", offPay?.id);
  check((offEvents ?? []).length === 0, "con el interruptor apagado, un pago cobrado no encola nada");

  await db.from("integration_configs").update({ config: { pixel_id: "1234567890", purchase_enabled: "true" } }).eq("workspace_id", workspaceId).eq("provider", "meta_capi");
  const { data: pending } = await db.from("payments").insert({ ...payBase, amount: 200, status: "pending", due_date: dateOf(-5) }).select("id").single();
  const { data: before } = await db.from("meta_capi_events").select("id").eq("source_id", pending?.id);
  check((before ?? []).length === 0, "un pago pendiente no encola nada");
  await db.from("payments").update({ status: "paid", paid_at: new Date().toISOString(), paid_on: dateOf(0) }).eq("id", pending?.id);
  const { data: purchase } = await db.from("meta_capi_events").select("event_name, event_id, params, status").eq("source_id", pending?.id);
  check(
    purchase?.length === 1 && purchase[0].event_name === "Purchase" && purchase[0].event_id === `payment.${pending?.id}` && Number((purchase[0].params as { value?: number }).value) === 200,
    "prendido, cobrarlo encola UNA compra con su monto",
    JSON.stringify(purchase),
  );
  await db.from("payments").update({ status: "pending", paid_at: null, paid_on: null }).eq("id", pending?.id);
  await db.from("payments").update({ status: "paid", paid_at: new Date().toISOString(), paid_on: dateOf(0) }).eq("id", pending?.id);
  const { data: again } = await db.from("meta_capi_events").select("id").eq("source_id", pending?.id);
  check(again?.length === 1, "revertirlo y volver a cobrarlo no manda otra compra");

  const { data: refund } = await db.from("payments").insert({ ...payBase, type: "refund", amount: -50, status: "paid", paid_at: new Date().toISOString(), paid_on: dateOf(0) }).select("id").single();
  const { data: refundEvents } = await db.from("meta_capi_events").select("id").eq("source_id", refund?.id);
  check((refundEvents ?? []).length === 0, "un reembolso no se manda");

  // Con la configuracion rota (un `config` sin la forma esperada), el trigger no encola y el pago sale igual.
  await db.from("integration_configs").update({ config: { pixel_id: "1234567890", purchase_enabled: "true", basura: [1, 2, 3] } }).eq("workspace_id", workspaceId).eq("provider", "meta_capi");
  const { error: payError } = await db.from("payments").insert({ ...payBase, amount: 10, status: "paid", paid_at: new Date().toISOString(), paid_on: dateOf(0) });
  check(!payError, "un pago cobrado nunca falla por la API de Conversiones", payError?.message);
  // @plantilla-hasta(ventas)

  // Los jobs de este workspace no se tienen que correr: se cancelan antes de limpiar.
  const ids = ((await db.from("meta_capi_events").select("id").eq("workspace_id", workspaceId)).data ?? []).map((r: { id: string }) => `meta_capi:${r.id}`);
  if (ids.length > 0) await db.from("scheduled_jobs").update({ status: "cancelled" }).eq("type", "meta_capi_send").eq("status", "pending").in("dedupe_key", ids);
} catch (error) {
  fail("la verificacion se corto", error instanceof Error ? error.stack : String(error));
} finally {
  const clean = await runCleanup(svc);
  if (!clean) failures++;
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
