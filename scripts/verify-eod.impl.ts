/**
 * Reportes de fin de dia contra la base real (E2; E3 suma el evento y el flujo).
 *
 * Lo que un test con Vitest no puede probar: que la BASE haga cumplir las reglas (RLS,
 * la columna que nadie lee, el unico, la revision, la concurrencia) y que el codigo real
 * de guardar y enviar ande de punta a punta. La "sesion" es el userId que se le pasa al
 * nucleo, exactamente como lo hace la Server Action con `ctx.user.id`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";
import type { Database, Json } from "../lib/types/database";
import { eodPorts } from "../lib/eod/server-ports";
import { saveDraftCore, submitEodCore, type EodPorts } from "../lib/eod/submit";
import { setterTemplate, EOD_SUCCESS } from "../lib/eod/templates";
import { defaultEodConfig, type EodConfig } from "../lib/eod/config";
import { todayInputValue } from "../lib/dates";
import { addDays } from "../lib/eod/dates";
import type { EodDraftData } from "../lib/eod/draft";
import "../lib/flow-engine/registry";
import { processEvent, type AutomationEvent } from "../lib/flow-engine/automation-events";
import { eodTemplateGraph } from "../lib/eod/automation/templates";
import { buildDesiredTriggers } from "../lib/flow-triggers";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient<Database>(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) as SupabaseClient<Database>;

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
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient<Database>(URL, ANON, { auth: { persistSession: false } }) as SupabaseClient<Database>;
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const TZ = "America/Costa_Rica";
const zeros = { conv_inbound: 0, conv_outbound: 0, seguimientos: 0, respuestas: 0, llamadas_agendadas: 0 };
const fullDraft = (igLinks: number, waLinks = 0): EodDraftData => ({
  answers: { horas_trabajadas: 8, rendimiento: 7, mejor_conversacion: "zz-test" },
  channels: {
    instagram: { selected: true, answers: { ...zeros, links_enviados: igLinks } },
    whatsapp: { selected: waLinks > 0, answers: { ...zeros, links_enviados: waLinks } },
    linkedin: { selected: false, answers: { ...zeros, links_enviados: 99 } },
  },
});

try {
  // ── Preparacion ────────────────────────────────────────────────────────────
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-eod", slug: `zz-test-eod-${Date.now()}`, timezone: TZ }).select("id").single();
  if (wsErr || !ws) throw new Error(`no pude crear el workspace: ${wsErr?.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-eod-otro", slug: `zz-test-eod-otro-${Date.now()}` }).select("id").single();

  const owner = await makeUser("eod-owner");
  const admin = await makeUser("eod-admin");
  const setterA = await makeUser("eod-setter-a"); // Member de sistema, en la audiencia
  const setterB = await makeUser("eod-setter-b"); // Member de sistema, en la audiencia
  const leader = await makeUser("eod-leader"); // rol personalizado con eod.view_all, fuera de la audiencia
  const other = await makeUser("eod-other"); // Member de sistema, FUERA de la audiencia
  const outsider = await makeUser("eod-outsider"); // otro workspace
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: setterA.id, role: "member" },
    { workspace_id: ws.id, user_id: setterB.id, role: "member" },
    { workspace_id: ws.id, user_id: leader.id, role: "member" },
    { workspace_id: ws.id, user_id: other.id, role: "member" },
    { workspace_id: ws2!.id, user_id: outsider.id, role: "owner" },
  ]);
  const { data: role } = await svc
    .from("workspace_roles")
    .insert({ workspace_id: ws.id, name: "zz-test lider", permissions: { keys: ["forms.view", "eod.view_all"], scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own" } } })
    .select("id")
    .single();
  await svc.from("workspace_members").update({ role_id: role!.id }).eq("workspace_id", ws.id).eq("user_id", leader.id);
  for (const u of [setterA, setterB]) await svc.from("user_preferences").upsert({ user_id: u.id, timezone: TZ, timezone_source: "manual" });

  // ── 00178: el tipo eod ────────────────────────────────────────────────────
  console.log("\n— 00178: el tipo eod —");
  const { error: noConfig } = await svc.from("forms").insert({ workspace_id: ws.id, name: "zz-test sin config", type: "eod", slug: `zz-test-eod-nc-${Date.now()}`, draft_definition: {} as Json });
  check(!!noConfig, "un EOD sin eod_config no se puede crear (CHECK)");

  const config: EodConfig = { ...defaultEodConfig("setter"), audience: { mode: "users", userIds: [setterA.id, setterB.id], roleIds: [] }, notify: { userIds: [owner.id] } };
  const slug = `zz-test-eod-${Date.now()}`;
  const { data: form, error: formErr } = await svc
    .from("forms")
    .insert({ workspace_id: ws.id, name: "zz-test EOD setters", type: "eod", slug, draft_definition: setterTemplate() as unknown as Json, eod_config: config as unknown as Json, success: EOD_SUCCESS as unknown as Json, contact_config: { mode: "none", update: "fill_empty", map: [] } as unknown as Json, created_by: owner.id })
    .select("id")
    .single();
  if (formErr || !form) throw new Error(`no pude crear el EOD: ${formErr?.message}`);
  check(true, "se crea un EOD de setters con su configuración");

  const ports: EodPorts = eodPorts(svc);
  const today = todayInputValue(new Date(), TZ);
  const base = { workspaceId: ws.id, formId: form.id, reportDate: today };

  const notPublished = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: 0, data: fullDraft(1) });
  check(!notPublished.ok && notPublished.code === "not_available", "sin publicar: 'no disponible'");

  const { data: pub, error: pubErr } = await svc.rpc("publish_form_version", { p_form_id: form.id, p_actor: owner.id });
  check(!pubErr && pub?.version_number === 1, "publish_form_version congela el EOD (versión 1)", pubErr?.message);
  const { data: frozen } = await svc.from("form_versions").select("definition").eq("form_id", form.id).single();
  const frozenDef = frozen?.definition as { channels?: unknown[]; channelSelector?: unknown } | null;
  check(Array.isArray(frozenDef?.channels) && frozenDef?.channels.length === 9 && !!frozenDef?.channelSelector, "la versión congela los canales y la pregunta de los canales");

  const publicForm = await svc.rpc("get_public_form", { p_slug: slug });
  check((publicForm.data as { status?: string } | null)?.status === "unavailable", "get_public_form devuelve 'unavailable' para un EOD publicado (00179)");

  // ── El borrador: revision y conflicto ─────────────────────────────────────
  console.log("\n— El borrador (save_eod_draft) —");
  const s1 = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: 0, data: fullDraft(3) });
  check(s1.ok && s1.rev === 1, "el primer guardado crea la fila con revisión 1", JSON.stringify(s1));
  const stale = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: 0, data: fullDraft(9) });
  check(!stale.ok && stale.code === "conflict" && stale.current.rev === 1 && stale.current.data.channels.instagram?.answers.links_enviados === 3, "un guardado con una revisión vieja devuelve conflicto con lo vigente, sin pisar", JSON.stringify(stale));
  const s2 = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: 1, data: fullDraft(5) });
  check(s2.ok && s2.rev === 2, "con la revisión vigente, guarda y avanza", JSON.stringify(s2));

  const outOfAudience = await saveDraftCore(ports, { ...base, userId: other.id, rev: 0, data: fullDraft(1) });
  const { count: otherRows } = await svc.from("eod_reports").select("id", { count: "exact", head: true }).eq("form_id", form.id).eq("user_id", other.id);
  check(!outOfAudience.ok && outOfAudience.code === "not_available" && otherRows === 0, "alguien fuera de la audiencia: rechazado y sin tocar la base");
  const fromOtherWs = await saveDraftCore(ports, { ...base, workspaceId: ws2!.id, userId: outsider.id, rev: 0, data: fullDraft(1) });
  check(!fromOtherWs.ok && fromOtherWs.code === "not_available", "alguien de otro workspace: 'no disponible'");

  const future = await saveDraftCore(ports, { ...base, reportDate: addDays(today, 1), userId: setterA.id, rev: 0, data: fullDraft(1) });
  check(!future.ok && future.code === "date", "una fecha futura se rechaza");
  const tooOld = await saveDraftCore(ports, { ...base, reportDate: addDays(today, -8), userId: setterA.id, rev: 0, data: fullDraft(1) });
  check(!tooOld.ok && tooOld.code === "date", "una fecha más vieja que pastDays (7) se rechaza");

  // ── RLS de los borradores ─────────────────────────────────────────────────
  console.log("\n— RLS —");
  const sees = async (u: TestUser) => {
    const { data } = await u.client.from("eod_reports").select("id, user_id, status").eq("form_id", form.id);
    return data ?? [];
  };
  check((await sees(setterA)).some((r) => r.user_id === setterA.id && r.status === "draft"), "la persona ve su propio borrador");
  for (const [who, u] of [["otro setter", setterB], ["el Owner", owner], ["un Admin", admin], ["un rol con eod.view_all", leader], ["otro workspace", outsider]] as const) {
    check(!(await sees(u)).some((r) => r.user_id === setterA.id), `${who} NO ve el borrador ajeno`);
  }
  const { error: pendingCol } = await setterA.client.from("eod_reports").select("pending_edit").eq("form_id", form.id);
  check(!!pendingCol, "nadie lee pending_edit con su sesión (privilegio por columna)");
  const { error: starErr } = await setterA.client.from("eod_reports").select("*").eq("form_id", form.id);
  check(!!starErr, "select('*') con la sesión falla (por eso las consultas nombran las columnas)");
  const { data: delA } = await setterA.client.from("eod_reports").delete().eq("form_id", form.id).select("id");
  const { count: stillA } = await svc.from("eod_reports").select("id", { count: "exact", head: true }).eq("form_id", form.id).eq("user_id", setterA.id);
  check((delA ?? []).length === 0 && stillA === 1, "nadie borra: el borrado con la sesión no toca filas");
  const { error: rpcAsUser } = await setterA.client.rpc("save_eod_draft", { p_workspace_id: ws.id, p_form_id: form.id, p_user_id: setterB.id, p_report_date: today, p_rev: 0, p_answers: {}, p_channels: {}, p_report_mode: "single" });
  check(!!rpcAsUser, "save_eod_draft no se puede llamar con la sesión (solo el servidor)");

  // ── Enviar ────────────────────────────────────────────────────────────────
  console.log("\n— Enviar (submit_eod_report) —");
  const missing = fullDraft(5, 7);
  delete missing.channels.whatsapp.answers.seguimientos;
  const s3 = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: 2, data: missing });
  const incomplete = await submitEodCore(ports, { ...base, userId: setterA.id, rev: s3.ok ? s3.rev : -1 });
  check(!incomplete.ok && incomplete.code === "invalid" && (incomplete.errors ?? []).some((e) => e.includes('Canal "WhatsApp"') && e.includes("Seguimientos")), "a un canal elegido le falta una obligatoria: se rechaza nombrando canal y pregunta", JSON.stringify(incomplete));
  const s4 = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: 3, data: fullDraft(5, 7) });
  const sent = await submitEodCore(ports, { ...base, userId: setterA.id, rev: s4.ok ? s4.rev : -1 });
  check(sent.ok && !sent.edited, "se envía el reporte", JSON.stringify(sent));
  const { data: row } = await svc.from("eod_reports").select("status, answers, channels, metrics, form_version_id, submitted_at").eq("form_id", form.id).eq("user_id", setterA.id).single();
  const metrics = row?.metrics as Record<string, Record<string, number>> | null;
  check(row?.status === "submitted" && !!row.submitted_at && !!row.form_version_id, "queda 'submitted' con la versión y la hora");
  check(metrics?.total?.links_enviados === 12 && metrics?.instagram?.links_enviados === 5 && metrics?.whatsapp?.links_enviados === 7, "métricas: 5 + 7 = 12 en total y cada canal el suyo");
  check(!Object.keys((row?.channels ?? {}) as object).includes("linkedin") && metrics?.linkedin === undefined, "lo cargado en un canal NO elegido no se guarda ni suma");
  check(((row?.answers ?? {}) as Record<string, { label?: string }>).horas_trabajadas?.label === "Horas trabajadas hoy", "las respuestas van con su etiqueta");
  const { data: notif } = await svc.from("notifications").select("title, recipient_id").eq("workspace_id", ws.id).eq("type", "eod_submitted");
  check((notif ?? []).some((n) => n.recipient_id === owner.id && n.title.includes("envió su reporte")), "le llega el aviso a quien eligió el reporte");

  check((await sees(admin)).some((r) => r.user_id === setterA.id), "un Admin ve el reporte enviado");
  check((await sees(owner)).some((r) => r.user_id === setterA.id), "el Owner ve el reporte enviado");
  check((await sees(leader)).some((r) => r.user_id === setterA.id), "un rol con eod.view_all ve el reporte enviado");
  check(!(await sees(setterB)).some((r) => r.user_id === setterA.id), "otro setter (Member) NO ve el reporte enviado de otro");
  check(!(await sees(outsider)).some((r) => r.user_id === setterA.id), "otro workspace no lo ve");

  const again = await submitEodCore(ports, { ...base, userId: setterA.id, rev: 5 });
  check(!again.ok && again.error === "Ya enviaste el reporte de este día", "uno por día: el segundo envío se rechaza");
  const draftAfter = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: 5, data: fullDraft(1) });
  check(!draftAfter.ok && draftAfter.code === "already_submitted", "uno por día: no se puede guardar un borrador sobre lo enviado");

  // ── Concurrencia ──────────────────────────────────────────────────────────
  console.log("\n— Dos envíos a la vez —");
  const b1 = await saveDraftCore(ports, { ...base, userId: setterB.id, rev: 0, data: fullDraft(2) });
  const rev = b1.ok ? b1.rev : -1;
  const both = await Promise.all([submitEodCore(ports, { ...base, userId: setterB.id, rev }), submitEodCore(ports, { ...base, userId: setterB.id, rev })]);
  const { data: bRows } = await svc.from("eod_reports").select("id, status, edit_count").eq("form_id", form.id).eq("user_id", setterB.id);
  check(both.filter((r) => r.ok).length === 1, "de dos envíos simultáneos, uno solo sale bien", JSON.stringify(both));
  check(bRows?.length === 1 && bRows[0].status === "submitted" && bRows[0].edit_count === 0, "queda UN reporte, enviado una vez");
  const { error: dup } = await svc.from("eod_reports").insert({ workspace_id: ws.id, form_id: form.id, user_id: setterB.id, report_date: today } as never);
  check(dup?.code === "23505", "la unicidad (form, persona, día) la da un índice");

  // ── Se puede corregir ─────────────────────────────────────────────────────
  console.log("\n— Modo 'se puede corregir' —");
  await svc.from("forms").update({ eod_config: { ...config, reportMode: "editable" } as unknown as Json }).eq("id", form.id);
  const { data: before } = await svc.from("eod_reports").select("rev").eq("form_id", form.id).eq("user_id", setterA.id).single();
  const e1 = await saveDraftCore(ports, { ...base, userId: setterA.id, rev: before!.rev, data: fullDraft(9, 7) });
  check(e1.ok, "una corrección guarda su borrador", JSON.stringify(e1));
  const { data: mid } = await svc.from("eod_reports").select("metrics, pending_edit, status").eq("form_id", form.id).eq("user_id", setterA.id).single();
  check((mid?.metrics as Record<string, Record<string, number>>)?.total?.links_enviados === 12 && mid?.status === "submitted" && !!mid?.pending_edit, "mientras se corrige, lo enviado no cambia (la corrección va aparte)");
  const { data: leaderView } = await leader.client.from("eod_reports").select("metrics").eq("form_id", form.id).eq("user_id", setterA.id).maybeSingle();
  check((leaderView?.metrics as Record<string, Record<string, number>> | undefined)?.total?.links_enviados === 12, "quien ve a todos sigue viendo lo enviado, no la corrección a medio hacer");
  const fixed = await submitEodCore(ports, { ...base, userId: setterA.id, rev: e1.ok ? e1.rev : -1 });
  check(fixed.ok && fixed.edited, "se reenvía como corrección", JSON.stringify(fixed));
  const { data: after } = await svc.from("eod_reports").select("metrics, edit_count, edited_at, pending_edit, id").eq("form_id", form.id).eq("user_id", setterA.id).single();
  check(after?.edit_count === 1 && !!after.edited_at && after.pending_edit === null && (after.metrics as Record<string, Record<string, number>>).total.links_enviados === 16, "suma edit_count y edited_at y reemplaza lo enviado (9 + 7 = 16)");
  const { data: audit } = await svc.from("audit_log").select("changes, performed_by").eq("entity_type", "eod_report").eq("entity_id", after!.id).eq("action", "eod.edited");
  const changes = (audit?.[0]?.changes ?? {}) as Record<string, { old: unknown; new: unknown }>;
  check(audit?.length === 1 && audit[0].performed_by === setterA.id && changes["instagram.links_enviados"]?.old === 5 && changes["instagram.links_enviados"]?.new === 9, "lo anterior queda en el historial con lo que cambió", JSON.stringify(audit));

  // ── E3: el evento y la automatización sin contacto ────────────────────────
  console.log("\n— E3: flujos sin contacto —");
  const { data: firstEvent } = await svc
    .from("automation_events")
    .select("id, workspace_id, event_type, contact_id, member_user_id, payload")
    .eq("workspace_id", ws.id)
    .eq("member_user_id", setterB.id)
    .maybeSingle();
  check(
    firstEvent?.event_type === "eod_submitted" && firstEvent.contact_id === null && (firstEvent.payload as Record<string, unknown>)?.edit_count === 0,
    "al enviar queda un automation_events eod_submitted, sin contacto y con la persona",
    JSON.stringify(firstEvent),
  );
  const { error: noContactEvent } = await svc.from("automation_events").insert({ workspace_id: ws.id, event_type: "tag_added", contact_id: null, member_user_id: setterA.id, payload: {} });
  check(!!noContactEvent, "un evento de contacto sin contacto no se puede insertar (CHECK de la 00182)");

  // "Alerta por bajo rendimiento", encendida, creada por el Owner.
  const { data: ownerUser } = await svc.auth.admin.getUserById(owner.id);
  const mkFlow = async (on: "first" | "every") => {
    const graph = eodTemplateGraph("eod_low_performance", { form: { id: form.id, name: "zz-test EOD" }, userId: owner.id, userEmail: ownerUser.user?.email ?? "" });
    const trigger = graph.nodes.find((n) => n.type === "trigger")!;
    trigger.data = { ...trigger.data, on };
    const { data: flow } = await svc.from("flows").insert({ workspace_id: ws.id, name: `zz-test bajo rendimiento ${on}`, status: "published", nodes: graph.nodes as unknown as Json, edges: graph.edges as unknown as Json, form_id: form.id }).select("id").single();
    const desired = buildDesiredTriggers(graph.nodes as unknown as Array<Record<string, unknown>>, flow!.id);
    await svc.from("triggers").insert(desired.map((t) => ({ ...t, workspace_id: ws.id, is_active: true })));
    return flow!.id;
  };
  const firstFlow = await mkFlow("first");

  const runEventsOf = async (userId: string, editCount?: number) => {
    // Solo los eventos de esta prueba: la cola real no se toca.
    let query = svc.from("automation_events").select("id, workspace_id, event_type, contact_id, member_user_id, payload").eq("workspace_id", ws.id).eq("member_user_id", userId);
    if (editCount !== undefined) query = query.eq("payload->>edit_count", String(editCount));
    const { data: events } = await query.order("created_at");
    let fired = 0;
    for (const event of events ?? []) fired += await processEvent(svc, event as unknown as AutomationEvent);
    return fired;
  };
  const emailsTo = async (email: string) => (await svc.from("email_log").select("id").eq("workspace_id", ws.id).eq("to_email", email)).data?.length ?? 0;
  const noticesTo = async (userId: string) => (await svc.from("notifications").select("id").eq("workspace_id", ws.id).eq("type", "flow_notice").eq("recipient_id", userId)).data?.length ?? 0;

  // Un setter con 4 links: le llega el email y al Owner el aviso.
  await svc.from("forms").update({ eod_config: { ...config, audience: { mode: "all", userIds: [], roleIds: [] }, reportMode: "single" } as unknown as Json }).eq("id", form.id);
  const low = await makeUser("eod-setter-low");
  const high = await makeUser("eod-setter-high");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: low.id, role: "member" },
    { workspace_id: ws.id, user_id: high.id, role: "member" },
  ]);
  const lowEmail = (await svc.auth.admin.getUserById(low.id)).data.user?.email ?? "";
  const highEmail = (await svc.auth.admin.getUserById(high.id)).data.user?.email ?? "";
  const lowSaved = await saveDraftCore(ports, { ...base, userId: low.id, rev: 0, data: fullDraft(4) });
  check((await submitEodCore(ports, { ...base, userId: low.id, rev: lowSaved.ok ? lowSaved.rev : -1 })).ok, "el setter con 4 links envía");
  const noticesBefore = await noticesTo(owner.id);
  check((await runEventsOf(low.id)) === 1, "el evento dispara la Alerta por bajo rendimiento");
  check((await emailsTo(lowEmail)) === 1, "le llega el email a quien envió (4 links < 10)");
  check((await noticesTo(owner.id)) === noticesBefore + 1, "y el aviso en la campana a quien creó el flujo");
  const { data: sessions } = await svc.from("flow_sessions").select("contact_id, member_user_id, status").eq("flow_id", firstFlow);
  check(sessions?.length === 1 && sessions[0].contact_id === null && sessions[0].member_user_id === low.id, "la sesión del flujo es sin contacto, sobre la persona", JSON.stringify(sessions));
  check((await runEventsOf(low.id)) === 0, "el mismo evento no dispara dos veces (trigger_fires)");

  // Uno con 25 links: no pasa nada.
  const highSaved = await saveDraftCore(ports, { ...base, userId: high.id, rev: 0, data: fullDraft(20, 5) });
  check((await submitEodCore(ports, { ...base, userId: high.id, rev: highSaved.ok ? highSaved.rev : -1 })).ok, "el setter con 25 links envía");
  const noticesMid = await noticesTo(owner.id);
  await runEventsOf(high.id);
  check((await emailsTo(highEmail)) === 0 && (await noticesTo(owner.id)) === noticesMid, "con 25 links no pasa nada (va por «Si no», vacío)");

  // Una corrección: con "first" no vuelve a disparar; con "every", una vez por corrección.
  await svc.from("forms").update({ eod_config: { ...config, audience: { mode: "all", userIds: [], roleIds: [] }, reportMode: "editable" } as unknown as Json }).eq("id", form.id);
  await mkFlow("every");
  const { data: lowRow } = await svc.from("eod_reports").select("rev").eq("form_id", form.id).eq("user_id", low.id).single();
  const corr = await saveDraftCore(ports, { ...base, userId: low.id, rev: lowRow!.rev, data: fullDraft(3) });
  check((await submitEodCore(ports, { ...base, userId: low.id, rev: corr.ok ? corr.rev : -1 })).ok, "el setter corrige su reporte");
  check((await runEventsOf(low.id, 1)) === 1, "la corrección dispara solo el flujo 'cada corrección' (el de 'primer envío' no)");
  check((await runEventsOf(low.id, 1)) === 0, "y una sola vez por corrección");
} catch (error) {
  fail("la verificación se cortó", error instanceof Error ? error.stack : String(error));
} finally {
  const clean = await runCleanup(svc);
  if (!clean) failures++;
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
