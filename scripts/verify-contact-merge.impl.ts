/**
 * La fusion de contactos contra la base real (R9).
 *
 * Siembra un duplicado con al menos un registro en CADA tabla de `CONTACT_MERGE_TABLES` y un principal con los conflictos
 * (misma conversacion de canal, misma etiqueta, mismo campo personalizado, misma secuencia activa, misma fecha de
 * seguimiento...), fusiona de verdad y comprueba: todo cuelga del principal, ningun mensaje se perdio, las reglas de
 * conflicto, que lo que se movio conserva sus datos, el duplicado quedo borrado con `merged_into`, que un Member no puede
 * ejecutarla, la atomicidad (un fallo a mitad de camino no mueve nada) y la guardia de deriva.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";
import { CONTACT_MERGE_EXCLUSIONS, CONTACT_MERGE_TABLES, findMergeDrift, summarizeMerge } from "../lib/contacts/merge";
import { dbTargetArgs } from "./lib/db-target.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Db = SupabaseClient<any>;
const svc: Db = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m: string) => console.log("  ok  ", m);
const fail = (m: string, extra?: string) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond: unknown, m: string, extra?: string) => (cond ? ok(m) : fail(m, extra));

/** Consultas que la API no expone (pg_constraint, DDL de prueba): con la CLI ya vinculada. */
function sql(query: string): Array<Record<string, any>> {
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

interface TestUser {
  id: string;
  client: Db;
}
async function makeUser(tag: string): Promise<TestUser> {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client: Db = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

/** Inserta y devuelve la fila; si la base lo rechaza, corta diciendo QUE tabla fue. */
async function seed<T = Record<string, any>>(table: string, row: Record<string, unknown> | Array<Record<string, unknown>>): Promise<T> {
  const { data, error } = await svc.from(table).insert(row as never, { defaultToNull: false }).select("*");
  if (error || !data) throw new Error(`no pude sembrar ${table}: ${error?.message}`);
  return (Array.isArray(row) ? data : data[0]) as T;
}

const stamp = Date.now();
const iso = (d: string) => new Date(d).toISOString();
let tempArtifacts = false;

try {
  // ── Preparacion ────────────────────────────────────────────────────────────
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-fusion", slug: `zz-test-fusion-${stamp}`, timezone: "America/Costa_Rica" }).select("id").single();
  if (wsErr || !ws) throw new Error(`no pude crear el workspace: ${wsErr?.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-fusion-otro", slug: `zz-test-fusion-otro-${stamp}` }).select("id").single();

  const owner = await makeUser("m-owner");
  const admin = await makeUser("m-admin");
  const member = await makeUser("m-member");
  const outsider = await makeUser("m-outsider");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws2!.id, user_id: outsider.id, role: "owner" },
  ]);

  // ═══ La guardia de deriva (primero: es barata y si falla, lo demas no importa) ═══════════════════════════════════
  console.log("\n— La guardia: toda relacion con contacts esta cubierta —");
  const relationsInDb = () => {
    const fks = sql(`select distinct c.conrelid::regclass::text as t from pg_constraint c where c.contype = 'f' and c.confrelid = 'public.contacts'::regclass`).map((r) => String(r.t).replace(/^public\./, ""));
    const cols = sql(`select distinct table_name as t from information_schema.columns where table_schema = 'public' and column_name in ('contact_id', 'referred_by_contact_id') and table_name not in (select table_name from information_schema.views where table_schema = 'public')`).map((r) => String(r.t));
    return [...new Set([...fks, ...cols])];
  };
  const drift = findMergeDrift(relationsInDb());
  check(drift.missing.length === 0, "no hay ninguna relacion con contacts que la fusion no cubra ni excluya con motivo", `faltan: ${drift.missing.join(", ")}`);
  check(drift.stale.length === 0, "y todas las de la lista existen", `sobran: ${drift.stale.join(", ")}`);
  check(CONTACT_MERGE_TABLES.length === 25, "son las 25 (la 00247 suma el historial de estados)"); // @plantilla-quitar(llamadas,formularios,webhooks,ventas,tareas)
  // @plantilla-sin(llamadas,formularios,webhooks,ventas,tareas): check(CONTACT_MERGE_TABLES.length === 19, "son las 19 de la plantilla (sin las tablas de los modulos que no lleva)");
  // Una tabla nueva con contact_id hace fallar la guardia (se crea una de prueba y se saca).
  sql(`create table public.zz_test_merge_drift (id int, contact_id uuid references public.contacts(id) on delete cascade)`);
  tempArtifacts = true;
  const drift2 = findMergeDrift(relationsInDb());
  check(drift2.missing.includes("zz_test_merge_drift"), "una tabla nueva con contact_id aparece como «falta» en la guardia", JSON.stringify(drift2));
  sql(`drop table public.zz_test_merge_drift`);
  tempArtifacts = false;
  check(findMergeDrift(relationsInDb()).missing.length === 0, "...y al sacarla la guardia vuelve a estar en orden");
  void CONTACT_MERGE_EXCLUSIONS;

  // ═══ El mundo sembrado ══════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n— Sembrando un duplicado con registros en cada tabla —");
  const ch1: any = await seed("channels", { workspace_id: ws.id, platform: "whatsapp", late_account_id: `zz-test-wa-${stamp}` });
  const ch2: any = await seed("channels", { workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-ig-${stamp}` });

  const contactRow = (name: string, extra: Record<string, unknown> = {}) => ({ workspace_id: ws.id, display_name: name, ...extra });
  const main: any = await seed("contacts", contactRow("zz-test Principal", { phone: "+50688887777", notes: "nota del principal", metadata: {} }));
  const dup: any = await seed("contacts", contactRow("zz-test Duplicado", { email: `zz-test-dup-${stamp}@example.test`, phone: "+50699990000", notes: "nota del duplicado", setter_id: owner.id, next_followup_date: iso("2026-10-20T18:00:00Z"), metadata: { otro: 1 } }));
  await svc.from("contacts").update({ metadata: { link_suggestions: [{ contact_id: dup.id }, { contact_id: randomUUID() }] } }).eq("id", main.id);
  const referred: any = await seed("contacts", contactRow("zz-test Referido", { referred_by_contact_id: dup.id }));

  // Canales vinculados y conversaciones (una repetida por canal: cvM1 / cvD1).
  await seed("contact_channels", [{ contact_id: dup.id, channel_id: ch2.id, platform_sender_id: `ig-D-${stamp}` }, { contact_id: main.id, channel_id: ch1.id, platform_sender_id: `wa-M-${stamp}` }]);
  const cvM1: any = await seed("conversations", { workspace_id: ws.id, channel_id: ch1.id, contact_id: main.id, platform: "whatsapp", status: "closed", last_message_at: iso("2026-10-01T10:00:00Z"), last_message_preview: "viejo del principal", unread_count: 1 });
  const cvD1: any = await seed("conversations", { workspace_id: ws.id, channel_id: ch1.id, contact_id: dup.id, platform: "whatsapp", status: "open", last_message_at: iso("2026-10-10T10:00:00Z"), last_message_preview: "ultimo del duplicado", unread_count: 2 });
  const cvD2: any = await seed("conversations", { workspace_id: ws.id, channel_id: ch2.id, contact_id: dup.id, platform: "instagram", last_message_at: iso("2026-10-05T10:00:00Z"), unread_count: 0 });
  const msg = (conversation: any, text: string, pm: string | null, at: string) => ({ conversation_id: conversation.id, workspace_id: ws.id, direction: "inbound", text, platform_message_id: pm, created_at: iso(at) });
  await seed("messages", [
    msg(cvM1, "m1 del principal", "pm-1", "2026-10-01T10:00:00Z"),
    msg(cvD1, "d1 del duplicado", "pm-2", "2026-10-10T10:00:00Z"),
    msg(cvD1, "d2 repetido", "pm-1", "2026-10-02T10:00:00Z"), // mismo id de plataforma que m1: choca
    msg(cvD2, "d3 de instagram", "pm-3", "2026-10-05T10:00:00Z"),
  ]);
  // Un borrador abierto en la conversacion del principal Y otro en la del duplicado (solo uno abierto por conversacion), y uno suelto.
  const draftM: any = await seed("agent_drafts", { workspace_id: ws.id, conversation_id: cvM1.id, contact_id: main.id, channel_id: ch1.id, body: "borrador del principal", status: "pending" });
  const draftD1: any = await seed("agent_drafts", { workspace_id: ws.id, conversation_id: cvD1.id, contact_id: dup.id, channel_id: ch1.id, body: "borrador del duplicado", status: "pending" });
  const draftD2: any = await seed("agent_drafts", { workspace_id: ws.id, conversation_id: cvD2.id, contact_id: dup.id, channel_id: ch2.id, body: "borrador suelto", status: "pending" });

  // Etiquetas, campos personalizados, notas.
  const [t1, t2]: any[] = await seed("tags", [{ workspace_id: ws.id, name: "zz-test t1" }, { workspace_id: ws.id, name: "zz-test t2" }]);
  await seed("contact_tags", [{ contact_id: main.id, tag_id: t1.id }, { contact_id: dup.id, tag_id: t1.id }, { contact_id: dup.id, tag_id: t2.id }]);
  const [f1, f2]: any[] = await seed("custom_field_definitions", [{ workspace_id: ws.id, name: "zz-test f1", slug: `zz-test-f1-${stamp}` }, { workspace_id: ws.id, name: "zz-test f2", slug: `zz-test-f2-${stamp}` }]);
  await seed("contact_custom_fields", [{ contact_id: main.id, field_id: f1.id, value: "valorM" }, { contact_id: dup.id, field_id: f1.id, value: "valorD" }, { contact_id: dup.id, field_id: f2.id, value: "soloD" }]);
  await seed("contact_notes", { contact_id: dup.id, workspace_id: ws.id, content: "nota suelta del duplicado" });

  // Secuencias: s1 las dos activas (conflicto), s2 solo el duplicado.
  const [s1, s2]: any[] = await seed("sequences", [{ workspace_id: ws.id, name: "zz-test seq 1" }, { workspace_id: ws.id, name: "zz-test seq 2" }]);
  await seed("sequence_enrollments", [
    { sequence_id: s1.id, contact_id: main.id, channel_id: ch1.id, status: "active" },
    { sequence_id: s1.id, contact_id: dup.id, channel_id: ch2.id, status: "active" },
    { sequence_id: s2.id, contact_id: dup.id, channel_id: ch2.id, status: "paused" },
    { sequence_id: s2.id, contact_id: dup.id, channel_id: ch2.id, status: "completed" },
  ]);

  // Flujos: sesiones activas (una repetida), una completada, triggers y disparos.
  const [fl1, fl2]: any[] = await seed("flows", [{ workspace_id: ws.id, name: "zz-test flujo 1" }, { workspace_id: ws.id, name: "zz-test flujo 2" }]);
  await seed("flow_sessions", [
    { flow_id: fl1.id, contact_id: main.id, channel_id: ch1.id, status: "active" },
    { flow_id: fl1.id, contact_id: dup.id, channel_id: ch2.id, status: "active" },
    { flow_id: fl2.id, contact_id: dup.id, channel_id: ch2.id, status: "active" },
    { flow_id: fl2.id, contact_id: dup.id, channel_id: ch2.id, status: "completed" },
  ]);
  const trig: any = await seed("triggers", { flow_id: fl1.id, type: "keyword", workspace_id: ws.id, config: {}, is_active: false });
  await seed("trigger_fires", { trigger_id: trig.id, workspace_id: ws.id, dedupe_key: `zz-test-${stamp}`, contact_id: dup.id });

  // Eventos de automatizacion: uno pendiente y uno ya procesado.
  // (el pendiente se siembra justo antes de fusionar: el cron real de la app lee la cola cada minuto y lo marcaria como procesado)
  const evDone: any = await seed("automation_events", { workspace_id: ws.id, event_type: "contact_created", contact_id: dup.id, payload: {}, processed_at: iso("2026-10-02T00:00:00Z") });

  // Tareas: seguimiento repetido (misma fecha) + una normal + una completada.  @plantilla-quitar(tareas)
  // @plantilla-desde(tareas)
  await seed("tasks", [
    { workspace_id: ws.id, title: "zz-test seguimiento M", contact_id: main.id, source: "manual", source_ref: "followup:2026-10-20", created_by: owner.id },
    { workspace_id: ws.id, title: "zz-test seguimiento D", contact_id: dup.id, source: "manual", source_ref: "followup:2026-10-20", created_by: owner.id },
    { workspace_id: ws.id, title: "zz-test seguimiento D2", contact_id: dup.id, source: "manual", source_ref: "followup:2026-11-02", created_by: owner.id },
    { workspace_id: ws.id, title: "zz-test tarea normal D", contact_id: dup.id, created_by: owner.id },
    { workspace_id: ws.id, title: "zz-test tarea hecha D", contact_id: dup.id, status: "completed", created_by: owner.id, conversation_id: cvD1.id },
  ]);
  // @plantilla-hasta(tareas)

  // Atribucion: el duplicado tiene el toque MAS VIEJO, el principal el mas nuevo.
  await seed("contact_touches", [
    { workspace_id: ws.id, contact_id: dup.id, occurred_at: iso("2026-09-01T10:00:00Z"), source: "instagram", origin: "dm", dedupe_key: `zz-test-t-${stamp}-1` },
    { workspace_id: ws.id, contact_id: main.id, occurred_at: iso("2026-10-08T10:00:00Z"), source: "google", origin: "form", dedupe_key: `zz-test-t-${stamp}-2` }, // @plantilla-quitar(formularios)
    // @plantilla-sin(formularios): { workspace_id: ws.id, contact_id: main.id, occurred_at: iso("2026-10-08T10:00:00Z"), source: "google", origin: "manual", dedupe_key: `zz-test-t-${stamp}-2` },
  ]);

  // Agenda: una reunion del duplicado.
  const { data: cats } = await svc.from("booking_categories").select("id, name").eq("workspace_id", ws.id).is("parent_id", null);
  const evType: any = await seed("event_types", { workspace_id: ws.id, category_id: (cats ?? [])[0]?.id, owner_user_id: member.id, title: "zz-test-evento", slug: `zz-test-ev-${stamp}`, duration_minutes: 30 });
  const booking: any = await seed("bookings", { workspace_id: ws.id, uid: `zz-test-bk-${stamp}`, event_type_id: evType.id, host_user_id: member.id, contact_id: dup.id, title: "zz-test reunion", start_at: iso("2031-05-05T15:00:00Z"), end_at: iso("2031-05-05T15:30:00Z") });

  // Un registro en cada una de las demas tablas.
  const call: any = await seed("calls", { workspace_id: ws.id, source: "manual", title: "zz-test llamada", recorded_at: iso("2026-10-03T10:00:00Z"), contact_id: dup.id }); // @plantilla-quitar(llamadas)
  await seed("social_post_comments", { workspace_id: ws.id, platform: "instagram", external_comment_id: `zz-test-cm-${stamp}`, source: "sync", contact_id: dup.id });
  await seed("email_log", { workspace_id: ws.id, to_email: "zz-test@example.test", subject: "zz-test asunto", kind: "notification", status: "sent", contact_id: dup.id });
  await seed("analytics_events", { workspace_id: ws.id, event_type: "zz_test", contact_id: dup.id });
  await seed("agent_runs", { workspace_id: ws.id, source: "agent", trigger: "manual", contact_id: dup.id });
  const endpoint: any = await seed("webhook_endpoints", { workspace_id: ws.id, name: "zz-test endpoint", token: randomBytes(16).toString("base64url"), created_by: admin.id }); // @plantilla-quitar(webhooks)
  await seed("inbound_webhooks", { workspace_id: ws.id, endpoint_id: endpoint.id, status: "processed", contact_id: dup.id }); // @plantilla-quitar(webhooks)
  const bc: any = await seed("broadcasts", { workspace_id: ws.id, name: "zz-test envio" });
  await seed("broadcast_recipients", { broadcast_id: bc.id, contact_id: dup.id, channel_id: ch2.id });

  // Formularios: dos formularios con «una vez por contacto» y una firma de contrato.  @plantilla-quitar(formularios)
  // @plantilla-desde(formularios)
  const mkForm = async (tag: string) => {
    const form: any = await seed("forms", { workspace_id: ws.id, name: `zz-test form ${tag}`, type: "custom", slug: `zz-test-${tag}-${stamp}`, draft_definition: {} });
    const version: any = await seed("form_versions", { workspace_id: ws.id, form_id: form.id, version_number: 1, definition: { fields: [] } });
    return { form, version };
  };
  const fa = await mkForm("a");
  const fb = await mkForm("b");
  const sub = (f: { form: any; version: any }, contactId: string, onceKey: string | null) => ({ workspace_id: ws.id, form_id: f.form.id, form_version_id: f.version.id, idempotency_key: randomUUID(), status: "received", answers: {}, contact_id: contactId, once_key: onceKey });
  const [subA]: any[] = await seed("form_submissions", [sub(fa, dup.id, `contact:${dup.id}`), sub(fb, dup.id, `contact:${dup.id}`), sub(fb, main.id, `contact:${main.id}`)]);
  await seed("contract_signatures", { workspace_id: ws.id, submission_id: subA.id, form_id: fa.form.id, form_version_id: fa.version.id, text_sha256: "a".repeat(64), signer_email: "zz-test@example.test", legal: {}, contact_id: dup.id });
  // @plantilla-hasta(formularios)

  // Una venta con pagos (la cuelga el duplicado).  @plantilla-quitar(ventas)
  const product: any = await seed("products", { workspace_id: ws.id, name: "zz-test Producto fusion", product_type: "programa" });
  const variant: any = await seed("product_variants", { workspace_id: ws.id, product_id: product.id, name: "Estandar", price: 1000 });
  // @plantilla-desde(ventas)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const snapshot = { product_id: product.id, product_name: "zz-test Producto fusion", product_type: "programa", variant_id: variant.id, variant_name: "Estandar", price: 1000, currency: "USD", duration_type: "lifetime", duration_value: null, billing_type: "one_time", billing_interval: null, event_date: null };
  const saleRes = await svc.rpc("create_sale", {
    p_payload: {
      workspace_id: ws.id, contact_id: dup.id, product_variant_id: variant.id, product_snapshot: snapshot, base_amount: 1000, discount_amount: 0, financing_type: "reservation_installments", sale_date: yesterday,
      setter_id: null, vendedor_id: owner.id, attribution: { mode: "last_touch" },
      payments: [
        { type: "reservation", amount: 100, status: "paid", due_date: yesterday, paid_at: `${yesterday}T15:00:00Z`, paid_on: yesterday, payment_method: "wise", payment_option_snapshot: { method_key: "wise", method_name: "Wise", provider_fee_percent: 0, provider_fee_fixed: 0 }, provider_fee_amount: 0 },
        { type: "installment", amount: 450, status: "scheduled", due_date: "2031-01-15" },
        { type: "installment", amount: 450, status: "scheduled", due_date: "2031-02-15" },
      ],
    },
    p_actor_id: owner.id,
  });
  if (saleRes.error || !saleRes.data?.sale_id) throw new Error(`no pude crear la venta: ${saleRes.error?.message}`);
  const saleId = saleRes.data.sale_id as string;
  // @plantilla-hasta(ventas)

  // Pipeline (00245/00246): el duplicado tiene estado de setter y producto de interes; el principal, estado de vendedor.
  const setStatus = async (contactId: string, role: string, status: string) => {
    const r = await svc.rpc("set_contact_status", { p_workspace_id: ws.id, p_contact_id: contactId, p_role: role, p_status: status, p_actor_user: owner.id });
    if (r.error || r.data?.result !== "changed") throw new Error(`no pude poner el estado: ${r.error?.message ?? JSON.stringify(r.data)}`);
  };
  await setStatus(dup.id, "setter", "contactado");
  await setStatus(main.id, "closer", "ganado");
  await svc.from("contacts").update({ interest_product_id: product.id, interest_variant_id: variant.id }).eq("id", dup.id);

  // ═══ Foto de antes ══════════════════════════════════════════════════════════════════════════════════════════════
  const countBy = async (table: string, ids: string[], column = "contact_id") => ((await svc.from(table).select(column, { count: "exact", head: true }).in(column, ids)).count ?? 0) as number;
  const SIMPLE = ["agent_drafts", "agent_runs", "analytics_events", "bookings", "broadcast_recipients", "calls", "contact_notes", "contract_signatures", "email_log", "inbound_webhooks", "sales", "social_post_comments", "trigger_fires"]; // @plantilla-quitar(llamadas,formularios,webhooks,ventas)
  // @plantilla-sin(llamadas,formularios,webhooks,ventas): const SIMPLE = ["agent_drafts", "agent_runs", "analytics_events", "bookings", "broadcast_recipients", "contact_notes", "email_log", "social_post_comments", "trigger_fires"];
  const both = [dup.id, main.id];
  const before: Record<string, number> = {};
  for (const t of [...SIMPLE, "contact_channels", "contact_touches", "tasks", "form_submissions", "sequence_enrollments", "flow_sessions", "automation_events", "conversations", "contact_tags", "contact_custom_fields"]) before[t] = await countBy(t, both); // @plantilla-quitar(tareas,formularios)
  // @plantilla-sin(tareas,formularios): for (const t of [...SIMPLE, "contact_channels", "contact_touches", "sequence_enrollments", "flow_sessions", "automation_events", "conversations", "contact_tags", "contact_custom_fields"]) before[t] = await countBy(t, both);
  const messagesBefore = (await svc.from("messages").select("id", { count: "exact", head: true }).in("conversation_id", [cvM1.id, cvD1.id, cvD2.id])).count;
  const paymentsBefore = JSON.stringify(((await svc.from("payments").select("id, type, status, amount, due_date").eq("sale_id", saleId).order("id")).data ?? [])); // @plantilla-quitar(ventas)
  const bookingBefore = JSON.stringify(((await svc.from("bookings").select("id, status, start_at, end_at").eq("id", booking.id)).data ?? []));
  const callBefore = JSON.stringify(((await svc.from("calls").select("id, title, recorded_at").eq("id", call.id)).data ?? [])); // @plantilla-quitar(llamadas)
  check(Object.values(before).every((n) => n > 0), "cada tabla de la fusion tiene al menos un registro sembrado", JSON.stringify(Object.entries(before).filter(([, n]) => n === 0)));

  // ═══ Quien puede ejecutarla ═════════════════════════════════════════════════════════════════════════════════════
  console.log("\n— Quien puede ejecutarla —");
  const args = { p_workspace_id: ws.id, p_main: main.id, p_duplicate: dup.id, p_actor: owner.id };
  for (const [label, user] of [["un Member", member], ["el Owner con su sesion", owner], ["un Admin con su sesion", admin], ["alguien de otro workspace", outsider]] as const) {
    const r = await user.client.rpc("merge_contacts", args);
    check(!!r.error && /permission denied|42501/i.test(`${r.error.code} ${r.error.message}`), `${label} no la puede ejecutar (solo el servidor, despues del chequeo de Owner/Admin)`, r.error?.message);
  }
  const anon: Db = createClient(URL, ANON, { auth: { persistSession: false } });
  check(!!(await anon.rpc("merge_contacts", args)).error, "sin sesion tampoco");
  check(((await svc.from("contacts").select("deleted_at").eq("id", dup.id).single()).data as any)?.deleted_at === null, "y nada cambio");

  // ═══ Validaciones ═══════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n— Validaciones —");
  const bad = async (over: Record<string, unknown>, code: string, label: string) => {
    const r = await svc.rpc("merge_contacts", { ...args, ...over });
    check(!!r.error && r.error.message.includes(code), label, r.error?.message ?? JSON.stringify(r.data));
  };
  await bad({ p_duplicate: main.id }, "merge_same_contact", "el mismo contacto se rechaza");
  await bad({ p_duplicate: randomUUID() }, "merge_not_found", "un contacto que no existe se rechaza");
  const foreign: any = await seed("contacts", { workspace_id: ws2!.id, display_name: "zz-test de otro negocio" });
  await bad({ p_duplicate: foreign.id }, "merge_workspace_mismatch", "dos contactos de workspaces distintos se rechazan");
  await bad({ p_workspace_id: ws2!.id }, "merge_workspace_mismatch", "un workspace que no es el de los contactos se rechaza");
  const gone: any = await seed("contacts", { workspace_id: ws.id, display_name: "zz-test borrado", deleted_at: new Date().toISOString() });
  await bad({ p_duplicate: gone.id }, "merge_deleted", "un contacto ya borrado se rechaza");
  check(before.tasks === (await countBy("tasks", both)) && ((await svc.from("contacts").select("deleted_at").eq("id", dup.id).single()).data as any)?.deleted_at === null, "...y ninguna validacion movio nada"); // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): check(((await svc.from("contacts").select("deleted_at").eq("id", dup.id).single()).data as any)?.deleted_at === null, "...y ninguna validacion movio nada");

  // ═══ La atomicidad: un fallo a mitad de camino no mueve NADA ════════════════════════════════════════════════════
  console.log("\n— Atomicidad: un fallo a mitad de camino no mueve nada —");
  const dupB: any = await seed("contacts", contactRow("zz-test Duplicado B", { email: `zz-test-b-${stamp}@example.test` }));
  const mainB: any = await seed("contacts", contactRow("zz-test Principal B"));
  const cvB: any = await seed("conversations", { workspace_id: ws.id, channel_id: ch2.id, contact_id: dupB.id, platform: "instagram" });
  await seed("tasks", { workspace_id: ws.id, title: "zz-test tarea de B", contact_id: dupB.id, created_by: owner.id }); // @plantilla-quitar(tareas)
  await seed("contact_notes", { contact_id: dupB.id, workspace_id: ws.id, content: "nota de B" });
  await seed("email_log", { workspace_id: ws.id, to_email: "zz-test@example.test", subject: "zz-test-boom", kind: "notification", status: "sent", contact_id: dupB.id });
  sql(`create or replace function public.zz_test_boom() returns trigger language plpgsql as $f$ begin if new.subject = 'zz-test-boom' then raise exception 'zz_test_boom'; end if; return new; end $f$`);
  sql(`create trigger zz_test_boom_trg before update on public.email_log for each row execute function public.zz_test_boom()`);
  tempArtifacts = true;
  const boom = await svc.rpc("merge_contacts", { p_workspace_id: ws.id, p_main: mainB.id, p_duplicate: dupB.id, p_actor: owner.id });
  check(!!boom.error && boom.error.message.includes("zz_test_boom"), "la fusion falla a mitad de camino (un trigger de prueba levanta una excepcion al mover el email)", boom.error?.message);
  const afterB = {
    cv: (await svc.from("conversations").select("contact_id").eq("id", cvB.id).single()).data as any,
    tasks: await countBy("tasks", [dupB.id]), // @plantilla-quitar(tareas)
    notes: await countBy("contact_notes", [dupB.id]),
    deleted: ((await svc.from("contacts").select("deleted_at, metadata").eq("id", dupB.id).single()).data as any),
    main: ((await svc.from("contacts").select("email, deleted_at").eq("id", mainB.id).single()).data as any),
  };
  check(afterB.cv.contact_id === dupB.id && afterB.tasks === 1 && afterB.notes === 1 && (await countBy("tasks", [mainB.id])) === 0, "no se movio nada: la conversacion, la tarea y la nota siguen con el duplicado"); // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): check(afterB.cv.contact_id === dupB.id && afterB.notes === 1, "no se movio nada: la conversacion y la nota siguen con el duplicado");
  check(afterB.deleted.deleted_at === null && !JSON.stringify(afterB.deleted.metadata).includes("merged_into") && afterB.main.email === null, "el duplicado no se borro, no se completo nada del principal");
  check(((await svc.from("audit_log").select("id").eq("entity_id", mainB.id).eq("action", "link")).data ?? []).length === 0, "y no quedo ninguna entrada en el historial");
  sql(`drop trigger if exists zz_test_boom_trg on public.email_log`);
  sql(`drop function if exists public.zz_test_boom()`);
  tempArtifacts = false;

  // ═══ La fusion de verdad ════════════════════════════════════════════════════════════════════════════════════════
  console.log("\n— La fusion —");
  const evPending: any = await seed("automation_events", { workspace_id: ws.id, event_type: "contact_created", contact_id: dup.id, payload: {} });
  before.automation_events += 1;
  const merged = await svc.rpc("merge_contacts", args);
  check(!merged.error && merged.data?.ok === true, "merge_contacts devuelve ok", merged.error?.message);
  const moved = (merged.data?.moved ?? {}) as Record<string, number>;
  console.log("   ", summarizeMerge(merged.data));

  // Todo cuelga del principal.
  for (const t of [...SIMPLE, "contact_channels", "contact_touches", "tasks", "form_submissions", "flow_sessions"]) { // @plantilla-quitar(tareas,formularios)
  // @plantilla-sin(tareas,formularios): for (const t of [...SIMPLE, "contact_channels", "contact_touches", "flow_sessions"]) {
    const left = t === "flow_sessions" ? 0 : await countBy(t, [dup.id]);
    check(left === 0, `${t}: no queda nada colgando del duplicado`, `quedan ${left}`);
  }
  for (const t of SIMPLE) check((await countBy(t, [main.id])) === before[t], `${t}: lo del duplicado paso al principal, sin perder ninguna fila`, `${await countBy(t, [main.id])} de ${before[t]}`);
  check((await countBy("contact_channels", [main.id])) === 2, "contact_channels: los dos canales cuelgan del principal");

  // Pipeline (00245/00246).
  check((await countBy("contact_status_changes", [dup.id])) === 0 && (await countBy("contact_status_changes", [main.id])) === 2, "contact_status_changes: el historial de estados del duplicado paso al principal");
  const mainAfter = (await svc.from("contacts").select("setter_status, closer_status, last_status_role, last_status, interest_product_id, interest_variant_id").eq("id", main.id).single()).data as any;
  check(mainAfter.setter_status === "contactado", "el estado de setter que faltaba en el principal se completa con el del duplicado");
  check(mainAfter.closer_status === "ganado", "el de vendedor del principal se conserva");
  check(mainAfter.last_status_role === "closer" && mainAfter.last_status === "ganado", "el ultimo estado se recalcula (el mas reciente)", JSON.stringify(mainAfter));
  check(mainAfter.interest_product_id === product.id && mainAfter.interest_variant_id === variant.id, "el producto de interes del duplicado pasa al principal, con su variante");

  // Conversaciones y mensajes.
  const convOf = async (id: string) => (await svc.from("conversations").select("*").eq("id", id).single()).data as any;
  const [cM1, cD1, cD2] = [await convOf(cvM1.id), await convOf(cvD1.id), await convOf(cvD2.id)];
  check(cD2.contact_id === main.id && cD2.deleted_at === null, "la conversacion de otro canal se mueve entera al principal");
  check(cD1.deleted_at !== null && cD1.contact_id === dup.id, "la del canal repetido queda con borrado logico (vacia, salvo el mensaje repetido)");
  const msgsOf = async (id: string) => ((await svc.from("messages").select("text, platform_message_id").eq("conversation_id", id).order("created_at")).data ?? []) as Array<{ text: string; platform_message_id: string | null }>;
  const mainMsgs = (await msgsOf(cvM1.id)).map((m) => m.text);
  check(JSON.stringify(mainMsgs) === JSON.stringify(["m1 del principal", "d1 del duplicado"]), "los mensajes del duplicado pasaron a la conversacion del principal, en orden cronologico", JSON.stringify(mainMsgs));
  check(JSON.stringify((await msgsOf(cvD1.id)).map((m) => m.text)) === JSON.stringify(["d2 repetido"]), "el mensaje que repetia el id de la plataforma quedo en la vieja (no se pierde)");
  const messagesAfter = (await svc.from("messages").select("id", { count: "exact", head: true }).in("conversation_id", [cvM1.id, cvD1.id, cvD2.id])).count;
  check(messagesAfter === messagesBefore, "NINGUN mensaje se perdio", `${messagesAfter} de ${messagesBefore}`);
  // El resumen lo arma el trigger de mensajes con el ultimo mensaje de verdad (no el texto sembrado en la conversacion).
  check(cM1.last_message_preview === "d1 del duplicado" && new Date(cM1.last_message_at).toISOString() === iso("2026-10-10T10:00:00Z"), "el resumen de la conversacion unida toma el ultimo mensaje (el del duplicado)", `${cM1.last_message_preview} ${cM1.last_message_at}`);
  check(cM1.unread_count === 3 && cM1.status === "open", "los sin leer se suman (1 + 2) y la conversacion queda abierta");
  check(moved.conversations === 1 && moved.conversations_merged === 1 && moved.messages_moved === 1 && moved.messages_left === 1, "el conteo lo dice", JSON.stringify(moved));
  const draftState = async (id: string) => (await svc.from("agent_drafts").select("status, conversation_id, contact_id").eq("id", id).single()).data as any;
  const [dm, dd1, dd2] = [await draftState(draftM.id), await draftState(draftD1.id), await draftState(draftD2.id)];
  check(dm.status === "pending" && dm.conversation_id === cvM1.id, "el borrador abierto del principal sigue igual");
  check(dd1.status === "discarded" && dd1.conversation_id === cvM1.id && dd1.contact_id === main.id, "el borrador del duplicado, que chocaba con el abierto del principal, quedo descartado (y pasa al principal)");
  check(dd2.status === "pending" && dd2.contact_id === main.id, "el borrador suelto del duplicado se mueve");

  // Etiquetas y campos.
  const tagsMain = ((await svc.from("contact_tags").select("tag_id").eq("contact_id", main.id)).data ?? []).map((r: any) => r.tag_id).sort();
  check(JSON.stringify(tagsMain) === JSON.stringify([t1.id, t2.id].sort()), "etiquetas: el principal tiene las dos (la repetida no se duplica)");
  const fieldsMain = Object.fromEntries(((await svc.from("contact_custom_fields").select("field_id, value").eq("contact_id", main.id)).data ?? []).map((r: any) => [r.field_id, r.value]));
  check(fieldsMain[f1.id] === "valorM" && fieldsMain[f2.id] === "soloD", "campos personalizados: en el repetido gana el del principal; el otro se mueve", JSON.stringify(fieldsMain));

  // Secuencias.
  const enrolls = ((await svc.from("sequence_enrollments").select("sequence_id, contact_id, status, paused_reason").in("contact_id", both)).data ?? []) as any[];
  // La inscripcion cancelada tambien pasa al principal (nada se pierde): se la reconoce por secuencia y estado.
  const dupS1 = enrolls.find((e) => e.sequence_id === s1.id && e.status === "cancelled");
  check(dupS1?.status === "cancelled" && dupS1?.paused_reason === "fusion de contactos", "secuencias: la inscripcion viva repetida se cancelo con el motivo «fusion de contactos»", JSON.stringify(dupS1));
  check(enrolls.filter((e) => e.sequence_id === s2.id && e.contact_id === main.id).length === 2, "...y las otras (pausada y completada) se movieron");
  check(enrolls.filter((e) => e.sequence_id === s1.id && e.contact_id === main.id && e.status === "active").length === 1, "el principal sigue con su inscripcion activa a esa secuencia");
  check(enrolls.filter((e) => e.status === "cancelled").length === 1 && moved.sequence_enrollments_cancelled === 1, "solo una cancelada");

  // Flujos.
  const sessions = ((await svc.from("flow_sessions").select("flow_id, contact_id, status").in("contact_id", both)).data ?? []) as any[];
  check(sessions.filter((s) => s.flow_id === fl1.id && s.contact_id === main.id && s.status === "active").length === 1 && sessions.some((s) => s.flow_id === fl1.id && s.contact_id === dup.id && s.status === "cancelled") === false, "flujos: la sesion activa repetida (mismo flujo) no sobrevive viva", JSON.stringify(sessions));
  const cancelledSession = ((await svc.from("flow_sessions").select("status").eq("flow_id", fl1.id).eq("contact_id", main.id).eq("status", "cancelled")).data ?? []).length;
  check(cancelledSession === 1, "...se cancelo (y paso al principal con su historial)");
  check(sessions.filter((s) => s.flow_id === fl2.id && s.contact_id === main.id).length === 2, "las demas sesiones (activa y completada) se movieron al principal");

  // Eventos de automatizacion.
  const evP = (await svc.from("automation_events").select("contact_id, processed_at, error").eq("id", evPending.id).single()).data as any;
  const evD = (await svc.from("automation_events").select("contact_id, processed_at").eq("id", evDone.id).single()).data as any;
  check(evP.contact_id === dup.id && evP.processed_at !== null && evP.error === "fusion de contactos", "eventos: el pendiente NO se mueve y queda cancelado (no puede disparar un flujo para el principal)", JSON.stringify(evP));
  check(evD.contact_id === main.id, "...y el ya procesado (historial) se movio");

  // Tareas.  @plantilla-quitar(tareas)
  // @plantilla-desde(tareas)
  const tasks = ((await svc.from("tasks").select("title, contact_id, source_ref, status, conversation_id").in("contact_id", both)) .data ?? []) as any[];
  check(tasks.length === 5 && tasks.every((t) => t.contact_id === main.id), "tareas: las 5 cuelgan del principal (ninguna se perdio)", JSON.stringify(tasks));
  check(tasks.filter((t) => t.source_ref === "followup:2026-10-20").length === 1 && tasks.find((t) => t.title === "zz-test seguimiento D")?.source_ref === null, "el seguimiento repetido del duplicado paso como tarea normal (sin la clave)", JSON.stringify(tasks));
  check(tasks.find((t) => t.title === "zz-test seguimiento D2")?.source_ref === "followup:2026-11-02", "...y el que no choca conserva su clave");
  check(tasks.find((t) => t.title === "zz-test tarea hecha D")?.conversation_id === cvM1.id, "la tarea ligada a la conversacion repetida apunta a la conversacion que quedo");
  check(moved.tasks === 4 && moved.tasks_detached === 1, "el conteo de tareas", JSON.stringify(moved));
  // @plantilla-hasta(tareas)

  // Atribucion.
  const mainRow = (await svc.from("contacts").select("*").eq("id", main.id).single()).data as any;
  check(mainRow.attribution?.first_touch?.source === "instagram" && mainRow.attribution?.last_touch?.source === "google", "atribucion: se recalculo con TODOS los toques (primer toque del duplicado, ultimo del principal)", JSON.stringify(mainRow.attribution));
  check((await countBy("contact_touches", [main.id])) === 2, "los toques se movieron todos");

  // Formularios.  @plantilla-quitar(formularios)
  // @plantilla-desde(formularios)
  const subs = ((await svc.from("form_submissions").select("form_id, contact_id, once_key").in("contact_id", both)).data ?? []) as any[];
  check(subs.find((s) => s.form_id === fa.form.id)?.once_key === `contact:${main.id}`, "formularios: «una vez por contacto» pasa a la clave del principal si no choca");
  check(subs.filter((s) => s.form_id === fb.form.id && s.once_key === `contact:${dup.id}`).length === 1, "...y se queda como estaba si el principal ya tenia una para ese formulario");
  // @plantilla-hasta(formularios)

  // Lo que solo cambia de dueno.
  // @plantilla-desde(ventas)
  const saleAfter = (await svc.from("sales").select("contact_id, status").eq("id", saleId).single()).data as any;
  check(saleAfter.contact_id === main.id, "ventas: la venta cuelga del principal");
  check(JSON.stringify(((await svc.from("payments").select("id, type, status, amount, due_date").eq("sale_id", saleId).order("id")).data ?? [])) === paymentsBefore, "...y sus pagos siguen ahi, con el mismo monto, estado y fecha");
  // @plantilla-hasta(ventas)
  check(JSON.stringify(((await svc.from("bookings").select("id, status, start_at, end_at").eq("id", booking.id)).data ?? [])) === bookingBefore && (await countBy("bookings", [main.id])) === 1, "agendas: la reunion cuelga del principal sin cambiar de estado ni de horario");
  check(JSON.stringify(((await svc.from("calls").select("id, title, recorded_at").eq("id", call.id)).data ?? [])) === callBefore && (await countBy("calls", [main.id])) === 1, "llamadas: la llamada cuelga del principal sin cambios"); // @plantilla-quitar(llamadas)

  // Referidos.
  check(((await svc.from("contacts").select("referred_by_contact_id").eq("id", referred.id).single()).data as any)?.referred_by_contact_id === main.id, "los contactos que el duplicado habia referido pasan a ser referidos por el principal");

  // El contacto principal y el duplicado.
  check(mainRow.email === dup.email && mainRow.setter_id === owner.id && mainRow.next_followup_date !== null, "el principal se completo: email, setter y proximo seguimiento (estaban vacios)");
  check(mainRow.phone === "+50688887777" && mainRow.display_name === "zz-test Principal", "...y lo que ya tenia NO se piso (telefono, nombre)");
  check(mainRow.notes === "nota del principal\n\n---\n\nnota del duplicado", "las notas de los dos se juntaron");
  check(!JSON.stringify(mainRow.metadata?.link_suggestions ?? []).includes(dup.id), "la sugerencia de vinculacion con el duplicado ya no esta");
  const dupRow = (await svc.from("contacts").select("deleted_at, metadata").eq("id", dup.id).single()).data as any;
  check(dupRow.deleted_at !== null && dupRow.metadata?.merged_into === main.id && dupRow.metadata?.otro === 1, "el duplicado quedo con borrado logico y merged_into (sin perder el resto de su metadata)");

  // Historial.
  const { data: audit } = await svc.from("audit_log").select("action, entity_type, performed_by, metadata").eq("entity_id", main.id).eq("action", "link");
  check(audit?.length === 1 && audit[0].entity_type === "contact" && audit[0].performed_by === owner.id && audit[0].metadata?.merged_from === dup.id && audit[0].metadata?.automatic === false && audit[0].metadata?.moved?.tasks === 4, "el historial del principal tiene la entrada «link» con quien la hizo y el conteo por tabla", JSON.stringify(audit)); // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): check(audit?.length === 1 && audit[0].entity_type === "contact" && audit[0].performed_by === owner.id && audit[0].metadata?.merged_from === dup.id && audit[0].metadata?.automatic === false, "el historial del principal tiene la entrada «link» con quien la hizo y el conteo por tabla", JSON.stringify(audit));

  // Totales: ninguna fila desaparece (lo que no se mueve, se cancela o queda en el duplicado, pero existe).
  for (const t of ["contact_tags", "contact_custom_fields", "sequence_enrollments", "automation_events", "tasks", "contact_touches", "form_submissions", "contact_channels"]) { // @plantilla-quitar(tareas,formularios)
  // @plantilla-sin(tareas,formularios): for (const t of ["contact_tags", "contact_custom_fields", "sequence_enrollments", "automation_events", "contact_touches", "contact_channels"]) {
    const total = await countBy(t, both);
    // Los eventos pueden SUMAR uno: al rellenar los datos vacios del principal, el trigger de cambios emite el suyo (igual que antes de la fusion nueva).
    check(t === "automation_events" ? total >= before[t] : total === before[t], `${t}: ${t === "automation_events" ? "ningun evento desaparece" : "el total de filas no cambia (nada se pierde)"}`, `${total} de ${before[t]}${t === "automation_events" ? " " + JSON.stringify(((await svc.from("automation_events").select("event_type, contact_id").in("contact_id", both)).data ?? []).map((e: any) => e.event_type)) : ""}`);
  }
  check((await countBy("flow_sessions", both)) === before.flow_sessions, "flow_sessions: el total de filas no cambia");
  check((await countBy("conversations", both)) === before.conversations, "conversations: el total de filas no cambia");

  // Una segunda fusion del mismo duplicado ya no es posible (esta borrado).
  const again = await svc.rpc("merge_contacts", args);
  check(!!again.error && again.error.message.includes("merge_deleted"), "fusionar dos veces el mismo duplicado se rechaza (ya esta borrado)");

  // Concurrencia: dos fusiones del mismo duplicado hacia principales distintos; solo una gana.
  console.log("\n— Concurrencia —");
  const dupC: any = await seed("contacts", contactRow("zz-test Duplicado C"));
  const [mainC1, mainC2]: any[] = await seed("contacts", [contactRow("zz-test Principal C1"), contactRow("zz-test Principal C2")]);
  await seed("tasks", Array.from({ length: 5 }, (_, i) => ({ workspace_id: ws.id, title: `zz-test tarea C${i}`, contact_id: dupC.id, created_by: owner.id }))); // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): await seed("contact_notes", Array.from({ length: 5 }, (_, i) => ({ workspace_id: ws.id, contact_id: dupC.id, content: `zz-test nota C${i}` })));
  const [r1, r2] = await Promise.all([
    svc.rpc("merge_contacts", { p_workspace_id: ws.id, p_main: mainC1.id, p_duplicate: dupC.id, p_actor: owner.id }),
    svc.rpc("merge_contacts", { p_workspace_id: ws.id, p_main: mainC2.id, p_duplicate: dupC.id, p_actor: owner.id }),
  ]);
  const winners = [r1, r2].filter((r) => !r.error && r.data?.ok);
  check(winners.length === 1, "dos fusiones simultaneas del mismo duplicado: gana UNA y la otra se rechaza", JSON.stringify([r1.error?.message, r2.error?.message]));
  const split = [await countBy("tasks", [mainC1.id]), await countBy("tasks", [mainC2.id])].sort(); // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): const split = [await countBy("contact_notes", [mainC1.id]), await countBy("contact_notes", [mainC2.id])].sort();
  check(JSON.stringify(split) === JSON.stringify([0, 5]), "las 5 tareas terminaron todas en UN solo principal (nada partido)", JSON.stringify(split)); // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): check(JSON.stringify(split) === JSON.stringify([0, 5]), "las 5 notas terminaron todas en UN solo principal (nada partido)", JSON.stringify(split));
} catch (error) {
  fail("la verificación se cortó", error instanceof Error ? error.stack : String(error));
} finally {
  // Lo que se armo para forzar fallos y probar la guardia se saca siempre.
  try {
    sql(`drop trigger if exists zz_test_boom_trg on public.email_log`);
    sql(`drop function if exists public.zz_test_boom()`);
    sql(`drop table if exists public.zz_test_merge_drift`);
  } catch (error) {
    fail("no pude sacar lo que arme para la prueba", error instanceof Error ? error.message : String(error));
  }
  void tempArtifacts;
  // Las ventas se borran antes que los contactos (la relacion es RESTRICT), y recien despues el resto por el workspace.
  try {
    const { data: testWs } = await svc.from("workspaces").select("id").or("name.like.zz-test-%,slug.like.zz-test-%");
    const ids = (testWs ?? []).map((w: { id: string }) => w.id);
    if (ids.length > 0) {
      await svc.from("payments").delete().in("workspace_id", ids); // @plantilla-quitar(ventas)
      await svc.from("sales").delete().in("workspace_id", ids); // @plantilla-quitar(ventas)
      await svc.from("scheduled_jobs").delete().in("payload->>workspace_id", ids);
    }
  } catch (error) {
    console.error("  no pude limpiar las ventas de prueba:", error instanceof Error ? error.message : String(error));
  }
  const clean = await runCleanup(svc);
  if (!clean) failures++;
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
