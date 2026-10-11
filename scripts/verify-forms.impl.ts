/**
 * Formularios contra la base real (FO1 y los bloques que siguen).
 *
 * Base real, proveedores simulados: Turnstile responde con un `fetch` de mentira
 * que imita las claves de prueba de Cloudflare (`1x…` aprueba, `2x…` rechaza); no
 * se llama a Cloudflare, ni a Resend, ni a ningun proveedor de IA.
 *
 * Lo que prueba es lo que un test con Vitest no puede: que la BASE haga cumplir
 * las reglas (RLS, unicos, la huella del contrato, la lista blanca publica, la
 * concurrencia) y que el codigo real de envio, con sus puertos reales, ande de
 * punta a punta.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";
import type { Database, Json } from "../lib/types/database";
import { createBeaconPorts, createSubmitPorts } from "../lib/forms/server-ports";
import { submitForm, type SubmitInput, type SubmitPorts } from "../lib/forms/submit";
import { handleBeacon } from "../lib/forms/beacon";
import { contractTextSha256, hashContractText } from "../lib/forms/contract-hash";
import { findForbiddenKeys, containsText } from "../lib/forms/public-definition";
import { newField, type FormField } from "../lib/forms/fields";
import { hashIp } from "../lib/scheduling/antispam";
import { deleteSecret, storeSecret } from "../lib/vault";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
// La sal de los topes por IP: la misma que usaria el servidor.
process.env.RATE_LIMIT_SALT ??= env.RATE_LIMIT_SALT || env.CRON_SECRET || "zz-test-sal";

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
  email: string;
  client: SupabaseClient<Database>;
}

async function makeUser(tag: string): Promise<TestUser> {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient<Database>(URL, ANON, { auth: { persistSession: false } }) as SupabaseClient<Database>;
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, email, client };
}

/** Consultas de solo lectura por la CLI (esquemas que la API no expone). */
function sql(query: string): Array<Record<string, unknown>> {
  const out = execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (JSON.parse(out).rows ?? []) as Array<Record<string, unknown>>;
}

// ── Turnstile simulado: imita las claves de prueba de Cloudflare ─────────────
const turnstileCalls: Array<{ secret: string; idempotencyKey: string | null }> = [];
const fakeTurnstile = (async (_url: unknown, init?: RequestInit) => {
  const body = new URLSearchParams(String(init?.body));
  const secret = body.get("secret") ?? "";
  turnstileCalls.push({ secret: secret.slice(0, 2), idempotencyKey: body.get("idempotency_key") });
  const approve = secret.startsWith("1x");
  return {
    ok: true,
    status: 200,
    json: async () => (approve ? { success: true } : { success: false, "error-codes": ["invalid-input-response"] }),
  } as Response;
}) as typeof fetch;

const TEST_SECRET_OK = "1x0000000000000000000000000000000AA"; // clave publica de prueba de Cloudflare
const TEST_SECRET_NO = "2x0000000000000000000000000000000AA";

const usedLimitKeys = new Set<string>();
const uploaded: string[] = [];

function ports(ws: string, over: Partial<SubmitPorts> = {}): SubmitPorts {
  void ws;
  const real = createSubmitPorts(svc, { fetchImpl: fakeTurnstile });
  return {
    ...real,
    limit: async (spec) => {
      usedLimitKeys.add(spec.key);
      return real.limit(spec);
    },
    upload: async (path, bytes, mime) => {
      const result = await real.upload(path, bytes, mime);
      if (result) uploaded.push(path);
      return result;
    },
    ...over,
  };
}

let ipCounter = 10;
const nextIp = () => `203.0.113.${ipCounter++}`;

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a, 0x31, 0x20, 0x30]);

function input(slug: string, payload: Record<string, unknown>, files: SubmitInput["files"] = [], ip = nextIp()): SubmitInput {
  return { slug, ip, userAgent: "verify-forms", cookieHeader: null, payload, files };
}

const field = (type: Parameters<typeof newField>[0], key: string, extra: Partial<FormField> = {}): FormField => ({ ...newField(type, key, key), ...extra });

try {
  // ── Preparacion ────────────────────────────────────────────────────────────
  const { data: ws, error: wsErr } = await svc
    .from("workspaces")
    .insert({ name: "zz-test-forms", slug: `zz-test-forms-${Date.now()}`, timezone: "America/Costa_Rica" })
    .select("id")
    .single();
  if (wsErr || !ws) throw new Error(`no pude crear el workspace: ${wsErr?.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-forms-otro", slug: `zz-test-forms-otro-${Date.now()}` }).select("id").single();

  const owner = await makeUser("forms-owner");
  const admin = await makeUser("forms-admin");
  const member = await makeUser("forms-member"); // Member de sistema
  const viewer = await makeUser("forms-viewer"); // rol personalizado CON forms.view
  const blind = await makeUser("forms-blind"); // rol personalizado SIN forms.view
  const outsider = await makeUser("forms-outsider"); // otro workspace
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws.id, user_id: viewer.id, role: "member" },
    { workspace_id: ws.id, user_id: blind.id, role: "member" },
    { workspace_id: ws2!.id, user_id: outsider.id, role: "owner" },
  ]);

  const mkRole = async (name: string, keys: string[]) => {
    const { data, error } = await svc
      .from("workspace_roles")
      .insert({ workspace_id: ws.id, name, permissions: { keys, scopes: { leads: "own", conversations: "own", bookings: "own", calls: "own" } } })
      .select("id")
      .single();
    if (error || !data) throw new Error(`no pude crear el rol ${name}: ${error?.message}`);
    return data.id;
  };
  await svc.from("workspace_members").update({ role_id: await mkRole("zz-test ve formularios", ["forms.view"]) }).eq("workspace_id", ws.id).eq("user_id", viewer.id);
  await svc.from("workspace_members").update({ role_id: await mkRole("zz-test sin formularios", ["contacts.view"]) }).eq("workspace_id", ws.id).eq("user_id", blind.id);

  const { data: contacts } = await svc
    .from("contacts")
    .insert([
      { workspace_id: ws.id, display_name: "zz-test lead del member", email: "zz-test-visible@example.test", setter_id: member.id },
      { workspace_id: ws.id, display_name: "zz-test lead ajeno", email: "zz-test-ajeno@example.test", setter_id: admin.id },
    ])
    .select("id, display_name");
  const contactVisible = contacts!.find((c) => c.display_name?.includes("del member"))!.id;
  const contactAjeno = contacts!.find((c) => c.display_name?.includes("ajeno"))!.id;

  // ── F1: tablas, unicos y RLS ───────────────────────────────────────────────
  console.log("\n— F1: tablas, unicos y RLS —");
  const slug = `zz-test-apl-${Date.now()}`;
  const defaultFields: FormField[] = [field("short_text", "nombre", { required: true, label: "Nombre" }), field("email", "email")];
  const { data: form, error: formErr } = await svc
    .from("forms")
    .insert({ workspace_id: ws.id, name: "zz-test aplicacion", type: "custom", slug, draft_definition: { fields: defaultFields } as unknown as Json, created_by: owner.id })
    .select("id")
    .single();
  if (formErr || !form) throw new Error(`no pude crear el formulario: ${formErr?.message}`);
  check(true, "se crea un formulario");

  const { error: dupSame } = await svc
    .from("forms")
    .insert({ workspace_id: ws.id, name: "zz-test otro", type: "custom", slug, draft_definition: { fields: [] } as unknown as Json });
  check(!!dupSame, "dos formularios con el mismo slug: el segundo falla por el unico", dupSame ? undefined : "se inserto el segundo");
  const { error: upperSlug } = await svc
    .from("forms")
    .insert({ workspace_id: ws2!.id, name: "zz-test mayusculas", type: "custom", slug: slug.toUpperCase(), draft_definition: { fields: [] } as unknown as Json });
  check(!!upperSlug, "el slug solo admite minusculas (CHECK) y el unico es global entre workspaces");

  const { error: badType } = await svc.from("forms").insert({ workspace_id: ws.id, name: "zz-test x", type: "encuesta" as never, slug: `zz-test-x-${Date.now()}`, draft_definition: {} as Json });
  check(!!badType, "el tipo solo puede ser custom, survey o contract");
  const { error: noSurvey } = await svc.from("forms").insert({ workspace_id: ws.id, name: "zz-test s", type: "survey", slug: `zz-test-s-${Date.now()}`, draft_definition: {} as Json });
  check(!!noSurvey, "una encuesta sin survey_config no se puede crear");

  const asRows = async (u: TestUser, table: "forms" | "form_submissions" | "form_versions") => {
    const { data } = await u.client.from(table).select("id").eq("workspace_id", ws.id);
    return data ?? [];
  };
  check((await asRows(owner, "forms")).length >= 1, "el Owner ve los formularios");
  check((await asRows(admin, "forms")).length >= 1, "un Admin ve los formularios");
  check((await asRows(member, "forms")).length >= 1, "un Member de sistema ve los formularios (forms.view)");
  check((await asRows(viewer, "forms")).length >= 1, "un rol personalizado con forms.view los ve");
  check((await asRows(blind, "forms")).length === 0, "un rol personalizado SIN forms.view no ve ninguno");
  check((await asRows(outsider, "forms")).length === 0, "un usuario de otro workspace no ve filas");
  const anon = createClient<Database>(URL, ANON, { auth: { persistSession: false } });
  const { data: anonForms } = await anon.from("forms").select("id");
  check((anonForms ?? []).length === 0, "anon no lee la tabla forms (sin policy)");
  const { data: anonSubs } = await anon.from("form_submissions").select("id");
  check((anonSubs ?? []).length === 0, "anon no lee form_submissions");

  const { error: memberInsert } = await member.client.from("forms").insert({ workspace_id: ws.id, name: "zz-test m", type: "custom", slug: `zz-test-m-${Date.now()}`, draft_definition: {} as Json });
  check(!!memberInsert, "un Member NO puede insertar en forms");
  const { data: memberUpdate } = await member.client.from("forms").update({ name: "hackeado" }).eq("id", form.id).select("id");
  check((memberUpdate ?? []).length === 0, "un Member NO puede actualizar forms");
  const { data: ownerDelete, error: ownerDeleteErr } = await owner.client.from("forms").delete().eq("id", form.id).select("id");
  check(!!ownerDeleteErr || (ownerDelete ?? []).length === 0, "ni el Owner puede borrar un formulario (se archiva)");
  const { data: stillThere } = await svc.from("forms").select("id").eq("id", form.id);
  check((stillThere ?? []).length === 1, "el formulario sigue ahi despues de intentar borrarlo");

  // Respuestas sembradas: una de un contacto visible para el Member, una ajena y una sin contacto.
  const { data: ver0 } = await svc
    .from("form_versions")
    .insert({ workspace_id: ws.id, form_id: form.id, version_number: 1, definition: { fields: defaultFields } as unknown as Json })
    .select("id")
    .single();
  await svc.from("forms").update({ current_version_id: ver0!.id, status: "published" }).eq("id", form.id);
  const seed = (extra: Record<string, unknown>) => ({
    workspace_id: ws.id,
    form_id: form.id,
    form_version_id: ver0!.id,
    idempotency_key: randomUUID(),
    status: "received" as const,
    answers: {} as Json,
    ...extra,
  });
  const { data: seeded, error: seedErr } = await svc
    .from("form_submissions")
    .insert([seed({ contact_id: contactVisible }), seed({ contact_id: contactAjeno }), seed({ status: "no_contact" })])
    .select("id, contact_id");
  if (seedErr) throw new Error(`no pude sembrar respuestas: ${seedErr.message}`);
  const subVisible = seeded!.find((s) => s.contact_id === contactVisible)!.id;
  const memberSubs = (await asRows(member, "form_submissions")).map((r) => r.id);
  check(memberSubs.length === 1 && memberSubs[0] === subVisible, "un Member ve SOLO las respuestas de contactos que ve, y ninguna sin contacto", `ve ${memberSubs.length}`);
  check((await asRows(admin, "form_submissions")).length === 3, "un Admin ve las tres respuestas, incluida la que no tiene contacto");
  check((await asRows(blind, "form_submissions")).length === 0, "sin forms.view no se ve ninguna respuesta");
  check((await asRows(outsider, "form_submissions")).length === 0, "otro workspace no ve respuestas");
  const { data: firstSeed } = await svc.from("form_submissions").select("idempotency_key").eq("id", subVisible).single();
  const { error: dupKey } = await svc.from("form_submissions").insert({ ...seed({}), idempotency_key: firstSeed!.idempotency_key });
  check(!!dupKey, "dos respuestas con la misma idempotency_key: la segunda falla");
  const { error: memberDeleteSub } = await member.client.from("form_submissions").delete().eq("id", subVisible);
  const { data: afterDel } = await svc.from("form_submissions").select("id").eq("id", subVisible);
  check(!!memberDeleteSub || (afterDel ?? []).length === 1, "nadie puede borrar una respuesta");

  // ── Funciones intactas ─────────────────────────────────────────────────────
  console.log("\n— Lo que NO se toca —");
  const fingerprints = sql(
    "select p.proname, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('find_or_link_contact','create_booking','record_contact_touch')",
  );
  const expected: Record<string, string> = {
    find_or_link_contact: "861440d10e8519b67606d78c53ca663b",
    create_booking: "b81db84edb30ee7853efa2d42385593a",
    record_contact_touch: "f364db1862cc0f90291ca14ef855a214",
  };
  for (const [name, hash] of Object.entries(expected)) {
    const row = fingerprints.find((r) => r.proname === name);
    check(row?.h === hash, `${name} tiene la misma definicion que al empezar el modulo`, `ahora ${String(row?.h)}`);
  }

  // ── 00154: el CHECK conserva todo lo anterior ──────────────────────────────
  console.log("\n— 00154: integration_configs.type —");
  const integrationCheck = String(sql("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'integration_configs_type_check'")[0]?.d);
  for (const t of ["channel", "ai_provider", "email_provider", "social_network", "publishing_service", "google", "meta", "captcha"]) {
    check(integrationCheck.includes(`'${t}'`), `el CHECK de integration_configs.type incluye '${t}'`);
  }

  // ── F8: publicar, versiones y huella ───────────────────────────────────────
  console.log("\n— F8: publicar, versiones y la huella del contrato —");
  const contractText = "# Acuerdo\r\n\r\nPrimera linea  \r\nSegunda con ñ y ¿acentos?";
  const normalized = hashContractText(contractText);
  const { data: cForm, error: cErr } = await svc
    .from("forms")
    .insert({
      workspace_id: ws.id,
      name: "zz-test contrato",
      type: "contract",
      slug: `zz-test-contrato-${Date.now()}`,
      draft_definition: { fields: [field("email", "email", { required: true })], contractText: normalized.text } as unknown as Json,
      contract_config: { title: "Acuerdo", signatureRequired: true, acceptLabel: "Acepto", ccEmails: [] } as unknown as Json,
    })
    .select("id")
    .single();
  if (cErr || !cForm) throw new Error(`no pude crear el contrato: ${cErr?.message}`);
  const p1 = await svc.rpc("publish_form_version", { p_form_id: cForm.id, p_actor: owner.id });
  check(!p1.error && p1.data?.version_number === 1 && p1.data?.changed === true, "publicar crea la version 1", p1.error?.message);
  const { data: v1 } = await svc.from("form_versions").select("id, contract_text, contract_text_sha256").eq("form_id", cForm.id).eq("version_number", 1).single();
  check(v1?.contract_text_sha256 === normalized.sha256, "paridad: el SHA-256 calculado en la base es el mismo que calcula Node sobre el texto guardado", `${v1?.contract_text_sha256} vs ${normalized.sha256}`);
  check(v1?.contract_text === normalized.text, "la base guarda exactamente el texto normalizado");
  const p1b = await svc.rpc("publish_form_version", { p_form_id: cForm.id, p_actor: owner.id });
  check(p1b.data?.changed === false && p1b.data?.version_number === 1, "publicar sin cambios NO crea otra version");
  const { count: versionCount } = await svc.from("form_versions").select("id", { count: "exact", head: true }).eq("form_id", cForm.id);
  check(versionCount === 1, "sigue habiendo una sola version", `hay ${versionCount}`);

  const newText = hashContractText("# Acuerdo\n\nTexto NUEVO");
  await svc.from("forms").update({ draft_definition: { fields: [field("email", "email", { required: true })], contractText: newText.text } as unknown as Json }).eq("id", cForm.id);
  const p2 = await svc.rpc("publish_form_version", { p_form_id: cForm.id, p_actor: owner.id });
  check(p2.data?.version_number === 2 && p2.data?.changed === true, "cambiar el texto y publicar crea la version 2");
  const { data: v2 } = await svc.from("form_versions").select("contract_text_sha256").eq("form_id", cForm.id).eq("version_number", 2).single();
  check(v2?.contract_text_sha256 === contractTextSha256(newText.text), "la version 2 tiene su propia huella");
  const { data: v1Again } = await svc.from("form_versions").select("contract_text_sha256").eq("id", v1!.id).single();
  check(v1Again?.contract_text_sha256 === normalized.sha256, "la version 1 conserva su huella y su texto");

  const { data: updVersion } = await owner.client.from("form_versions").update({ contract_text: "hackeado" } as never).eq("id", v1!.id).select("id");
  check((updVersion ?? []).length === 0, "un UPDATE sobre form_versions (como Owner) no cambia nada: es inmutable");
  const { data: delVersion } = await owner.client.from("form_versions").delete().eq("id", v1!.id).select("id");
  check((delVersion ?? []).length === 0, "un DELETE sobre form_versions (como Owner) no borra nada");
  const { data: auditPublish } = await svc.from("audit_log").select("id").eq("entity_type", "form").eq("entity_id", cForm.id).eq("action", "form.published");
  check((auditPublish ?? []).length === 2, "cada publicacion queda en el historial");
  const { data: emptyContract } = await svc
    .from("forms")
    .insert({
      workspace_id: ws.id, name: "zz-test sin texto", type: "contract", slug: `zz-test-sin-texto-${Date.now()}`,
      draft_definition: { fields: [], contractText: "" } as unknown as Json, contract_config: {} as Json,
    })
    .select("id")
    .single();
  const { error: noText } = await svc.rpc("publish_form_version", { p_form_id: emptyContract!.id, p_actor: owner.id });
  check(!!noText, "publicar un contrato sin texto falla en la base");

  // ── F9: la definicion publica ──────────────────────────────────────────────
  console.log("\n— F9: la definicion publica (lista blanca) —");
  const secretFixed = `zz-secreto-${randomUUID().slice(0, 8)}`;
  const publicSlug = `zz-test-pub-${Date.now()}`;
  const publicFields: FormField[] = [
    field("short_text", "nombre", { required: true, label: "Nombre" }),
    field("email", "email", { required: true, label: "Email" }),
    { ...field("hidden", "canal"), hidden: { source: "fixed", value: secretFixed } },
    { ...field("hidden", "campana"), hidden: { source: "url_param", param: "utm_campaign" } },
    field("file", "cv", { label: "CV" }),
    field("single_select", "plan", { options: ["A", "B"], label: "Plan" }),
  ];
  publicFields[4] = { ...publicFields[4], file: { accept: ["application/pdf"], maxMb: 1, maxFiles: 1 } };
  const { data: pForm } = await svc
    .from("forms")
    .insert({
      workspace_id: ws.id, name: "zz-test publico", type: "custom", slug: publicSlug,
      draft_definition: { fields: publicFields } as unknown as Json,
      success: { mode: "message", title: "Gracias {{answer.nombre}}", body: "Listo" } as unknown as Json,
      contact_config: { mode: "create_or_link", update: "fill_empty", map: [{ fieldKey: "email", target: "contact.email" }] } as unknown as Json,
      tags_on_submit: [randomUUID()], notify_user_ids: [owner.id],
    })
    .select("id")
    .single();
  const pubUnpublished = await anon.rpc("get_public_form", { p_slug: publicSlug });
  check((pubUnpublished.data as { status?: string })?.status === "unavailable", "un formulario en borrador devuelve unavailable");
  await svc.rpc("publish_form_version", { p_form_id: pForm!.id, p_actor: owner.id });
  await svc.from("integration_configs").insert({ workspace_id: ws.id, type: "captcha", provider: "turnstile", config: { site_key: "1x00000000000000000000AA" }, is_active: true });

  const pub = await anon.rpc("get_public_form", { p_slug: publicSlug });
  check(!pub.error && (pub.data as { status?: string })?.status === "available", "anon obtiene la definicion publica de un formulario publicado", pub.error?.message);
  const forbidden = findForbiddenKeys(pub.data);
  check(forbidden.length === 0, "la definicion publica NO tiene claves internas", forbidden.join(", "));
  check(!containsText(pub.data, secretFixed), "el valor de un oculto 'fixed' no aparece en la definicion publica");
  check(!containsText(pub.data, ws.id) && !containsText(pub.data, pForm!.id), "no aparece ni el workspace ni el id del formulario");
  const pubFields = (pub.data as { fields: Array<{ key: string; type: string; hidden?: unknown }> }).fields;
  check(pubFields.some((f) => f.key === "campana" && f.type === "hidden"), "un oculto de URL si se devuelve, solo con su fuente");
  check(!pubFields.some((f) => f.key === "canal"), "el oculto fijo no se devuelve");
  check((pub.data as { turnstile_site_key?: string }).turnstile_site_key === "1x00000000000000000000AA", "devuelve la site key publica de Turnstile");
  check(!("success" in (pub.data as object)), "no devuelve la configuracion de exito");
  const sameKeys = (pub.data as { fields: Array<Record<string, unknown>> }).fields.every((f) => Object.keys(f).every((k) => ["key", "type", "label", "help", "placeholder", "required", "options", "min", "max", "file", "consentText", "visibility", "prefill", "hidden"].includes(k)));
  check(sameKeys, "cada campo publico solo tiene claves de la lista blanca (paridad con toPublicField)");

  await svc.from("forms").update({ status: "paused" }).eq("id", pForm!.id);
  const pubPaused = await anon.rpc("get_public_form", { p_slug: publicSlug });
  check((pubPaused.data as { status?: string })?.status === "unavailable", "pausado devuelve unavailable");
  await svc.from("forms").update({ status: "archived" }).eq("id", pForm!.id);
  check(((await anon.rpc("get_public_form", { p_slug: publicSlug })).data as { status?: string })?.status === "unavailable", "archivado devuelve unavailable");
  check(((await anon.rpc("get_public_form", { p_slug: "no-existe-zz" })).data as { status?: string })?.status === "unavailable", "un slug inexistente devuelve lo mismo (no se puede enumerar)");
  await svc.from("forms").update({ status: "published" }).eq("id", pForm!.id);
  const { error: anonSubmit } = await anon.rpc("submit_form_response", {
    p_form_id: pForm!.id, p_version_id: randomUUID(), p_idempotency_key: randomUUID(), p_answers: {}, p_attribution: {}, p_meta: {},
  });
  check(!!anonSubmit, "anon NO puede llamar a submit_form_response");
  const { error: anonPublish } = await anon.rpc("publish_form_version", { p_form_id: pForm!.id, p_actor: owner.id });
  check(!!anonPublish, "anon NO puede llamar a publish_form_version");
  const { error: adminPublish } = await admin.client.rpc("publish_form_version", { p_form_id: pForm!.id, p_actor: admin.id });
  check(!!adminPublish, "ni un Admin desde el navegador puede llamar a publish_form_version (la accion verifica el permiso)");

  // ── F12: el envio, de punta a punta ────────────────────────────────────────
  console.log("\n— F12: el envio seguro (codigo real, Turnstile simulado) —");
  const stored = await storeSecret(svc, ws.id, "turnstile_secret_key", TEST_SECRET_OK);
  check(stored.ok, "se guarda la secret key de prueba en Vault", stored.ok ? undefined : stored.error);

  const key1 = randomUUID();
  const { data: pubVersion } = await svc.from("forms").select("current_version_id").eq("id", pForm!.id).single();
  const basePayload = (key: string, answers: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    idempotency_key: key,
    turnstile_token: "token-de-prueba",
    version_id: pubVersion!.current_version_id,
    answers,
    honeypot: "",
    attribution: { utm_source: "facebook", utm_campaign: "octubre", fbclid: "abc123" },
    client_meta: { timezone: "America/Costa_Rica", locale: "es-CR" },
    origin: "public_page",
    ...extra,
  });

  // 5 pedidos simultaneos con la misma clave: UNA respuesta.
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () => submitForm(ports(ws.id), input(publicSlug, basePayload(key1, { nombre: "Ana", email: "ana@example.test", plan: "A" })))),
  );
  check(concurrent.every((r) => r.status === 200), "5 pedidos simultaneos con la misma clave responden 200", concurrent.map((r) => r.status).join(","));
  const ids = new Set(concurrent.map((r) => String(r.body.submission_id)));
  check(ids.size === 1, "los 5 devuelven el MISMO submission_id", [...ids].join(","));
  const { data: rowsForKey } = await svc.from("form_submissions").select("id, answers, attribution, meta, status").eq("form_id", pForm!.id).eq("idempotency_key", key1);
  check((rowsForKey ?? []).length === 1, "existe UNA sola respuesta para esa clave", `hay ${rowsForKey?.length}`);
  const saved = rowsForKey![0];
  const answers = saved.answers as Record<string, { label: string; value: unknown }>;
  check(answers.nombre?.label === "Nombre" && answers.nombre?.value === "Ana", "la respuesta guarda la etiqueta de la version");
  check(answers.canal?.value === secretFixed, "el oculto fijo SI esta en la respuesta guardada (lo puso el servidor)");
  check((saved.attribution as Record<string, string>).utm_campaign === "octubre" && (saved.attribution as Record<string, string>).fbclid === "abc123", "la atribucion de la visita queda en la respuesta");
  check(!JSON.stringify(saved.meta).includes("203.0.113"), "la IP no se guarda en claro en meta");
  check(String((saved.meta as { ip_hash?: string }).ip_hash ?? "").length > 8, "meta guarda el hash de la IP");
  check(saved.status === "no_contact", "en FO1 la respuesta queda sin contacto (el contacto llega en FO2)");
  const afterConcurrent = turnstileCalls.length;
  const again = await submitForm(ports(ws.id), input(publicSlug, basePayload(key1, { nombre: "Ana", email: "ana@example.test", plan: "A" })));
  check(again.body.duplicate === true && turnstileCalls.length === afterConcurrent, "un reintento con la misma clave no vuelve a verificar Turnstile");
  check(turnstileCalls.some((c) => c.idempotencyKey === key1), "Turnstile recibe la clave de idempotencia");

  const noEmail = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "Sin email", plan: "A" })));
  check(noEmail.status === 400 && (noEmail.body.fields as Record<string, string>)?.email, "falta un obligatorio visible: 400 con el campo");
  const badOption = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "X", email: "x@example.test", plan: "Z" })));
  check(badOption.status === 400, "una opcion que no existe: 400");

  // Honeypot y captcha: dejan form_rejected, sin datos personales.
  const rejectedBefore = (await svc.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("event_type", "form_rejected")).count ?? 0;
  const honey = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "Bot", email: "bot@example.test" }, { honeypot: "http://spam" })));
  check(honey.status === 200 && honey.body.ok === true, "honeypot lleno: 200 falso");
  const { data: honeyRow } = await svc.from("form_submissions").select("id").eq("form_id", pForm!.id).filter("answers->nombre->>value", "eq", "Bot");
  check((honeyRow ?? []).length === 0, "...y no se guarda nada");
  const rejectedMid = (await svc.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("event_type", "form_rejected")).count ?? 0;
  check(rejectedMid === rejectedBefore + 1, "queda un form_rejected por el honeypot");
  const badCaptcha = await submitForm(ports(ws.id, { turnstileSecret: async () => TEST_SECRET_NO }), input(publicSlug, basePayload(randomUUID(), { nombre: "Otro", email: "o@example.test" })));
  check(badCaptcha.status === 400 && badCaptcha.body.error === "captcha_failed", "Turnstile rechaza: 400 captcha_failed");
  const { data: rejectedRows } = await svc.from("analytics_events").select("contact_id, flow_id, metadata").eq("workspace_id", ws.id).eq("event_type", "form_rejected");
  check((rejectedRows ?? []).length === rejectedBefore + 2, "...y queda otro form_rejected");
  check((rejectedRows ?? []).every((r) => r.contact_id === null && r.flow_id === null), "los form_rejected no tienen contacto ni flow");
  const meta = (rejectedRows ?? []).map((r) => Object.keys((r.metadata ?? {}) as object).sort().join(","));
  check(meta.every((k) => k === "form_id,reason,version_id"), "la metadata de un rechazo es solo {form_id, reason, version_id}", meta.join(" | "));
  const netFail = await submitForm(
    ports(ws.id, { verifyTurnstile: async () => ({ ok: false as const, codes: ["network"] }) }),
    input(publicSlug, basePayload(randomUUID(), { nombre: "Red", email: "r@example.test" })),
  );
  check(netFail.status === 503, "Cloudflare no responde: 503 y no se acepta sin verificar");

  // Archivos: tipo real, tamano y carpeta.
  const fileKey = randomUUID();
  const withFile = await submitForm(ports(ws.id), input(publicSlug, basePayload(fileKey, { nombre: "Con CV", email: "cv@example.test" }), [{ fieldKey: "cv", name: "mi cv.pdf", declaredType: "application/pdf", bytes: PDF }]));
  check(withFile.status === 200, "un PDF real se acepta", JSON.stringify(withFile.body));
  const { data: fileRow } = await svc.from("form_submissions").select("answers, upload_prefix").eq("form_id", pForm!.id).eq("idempotency_key", fileKey).single();
  const fileAnswer = (fileRow?.answers as Record<string, { value: Array<{ path: string; name: string }> }>)?.cv?.value?.[0];
  check(!!fileAnswer && fileAnswer.path.startsWith(`${ws.id}/${pForm!.id}/${fileKey}/cv/`), "el archivo queda en {workspace}/{form}/{clave}/{campo}/", fileAnswer?.path);
  check(fileRow?.upload_prefix === `${ws.id}/${pForm!.id}/${fileKey}`, "la respuesta guarda su carpeta de archivos");
  const { data: signed, error: signErr } = await svc.storage.from("form-uploads").createSignedUrl(fileAnswer!.path, 60);
  check(!signErr && !!signed?.signedUrl, "el servidor puede firmar un link de 60 segundos");
  const { data: memberDownload } = await member.client.storage.from("form-uploads").download(fileAnswer!.path);
  check(!memberDownload, "un usuario no puede bajar el archivo directo del bucket (privado, sin policies)");
  const fake = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "Exe", email: "e@example.test" }), [{ fieldKey: "cv", name: "cv.pdf", declaredType: "application/pdf", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 255, 255]) }]));
  check(fake.status === 400, "un .exe renombrado a .pdf se rechaza por su tipo real");

  // Republicar: la respuesta vieja conserva la etiqueta vieja.
  const renamed = publicFields.map((f) => (f.key === "nombre" ? { ...f, label: "Nombre completo" } : f));
  await svc.from("forms").update({ draft_definition: { fields: renamed } as unknown as Json }).eq("id", pForm!.id);
  const rep = await svc.rpc("publish_form_version", { p_form_id: pForm!.id, p_actor: owner.id });
  check(rep.data?.version_number === 2, "republicar con otra etiqueta crea la version 2");
  const { data: oldRow } = await svc.from("form_submissions").select("answers").eq("form_id", pForm!.id).eq("idempotency_key", key1).single();
  check((oldRow?.answers as Record<string, { label: string }>).nombre.label === "Nombre", "la respuesta vieja conserva la etiqueta vieja");
  const staleVersion = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "Tarde", email: "t@example.test" }))); // version_id viejo, sigue valida
  check(staleVersion.status === 200, "un envio con la version vieja pero todavia valido se guarda con la vigente");
  const { data: staleRow } = await svc.from("form_submissions").select("form_version_id, answers").eq("form_id", pForm!.id).filter("answers->nombre->>value", "eq", "Tarde").single();
  const { data: vigente } = await svc.from("forms").select("current_version_id").eq("id", pForm!.id).single();
  check(staleRow?.form_version_id === vigente?.current_version_id, "...y queda con la version VIGENTE");
  check((staleRow?.answers as Record<string, { label: string }>).nombre.label === "Nombre completo", "...con la etiqueta de la version vigente");

  // ── F14: metricas ──────────────────────────────────────────────────────────
  console.log("\n— F14: metricas, zona horaria e indice —");
  const { data: mForm } = await svc
    .from("forms")
    .insert({ workspace_id: ws.id, name: "zz-test metricas", type: "custom", slug: `zz-test-met-${Date.now()}`, draft_definition: { fields: [] } as unknown as Json })
    .select("id")
    .single();
  await svc.rpc("publish_form_version", { p_form_id: mForm!.id, p_actor: owner.id });
  const { data: mVer } = await svc.from("forms").select("current_version_id").eq("id", mForm!.id).single();
  // 23:30 del 10/10 en Costa Rica (UTC-6) = 05:30 UTC del 11/10.
  const lateNight = "2026-10-11T05:30:00Z";
  await svc.from("form_submissions").insert({
    workspace_id: ws.id, form_id: mForm!.id, form_version_id: mVer!.current_version_id!, idempotency_key: randomUUID(), status: "received", answers: {} as Json, created_at: lateNight,
  });
  await svc.from("form_submissions").insert({
    workspace_id: ws.id, form_id: mForm!.id, form_version_id: mVer!.current_version_id!, idempotency_key: randomUUID(), status: "spam", answers: {} as Json, created_at: "2026-10-10T18:00:00Z",
  });
  await svc.from("analytics_events").insert([
    { workspace_id: ws.id, event_type: "form_view", metadata: { form_id: mForm!.id, version_id: mVer!.current_version_id } as Json, created_at: lateNight },
    { workspace_id: ws.id, event_type: "form_view", metadata: { form_id: mForm!.id, version_id: mVer!.current_version_id } as Json, created_at: "2026-10-10T15:00:00Z" },
    { workspace_id: ws.id, event_type: "form_start", metadata: { form_id: mForm!.id, version_id: mVer!.current_version_id } as Json, created_at: lateNight },
  ]);
  const daily = await owner.client.rpc("form_metrics_daily", { p_form_id: mForm!.id, p_from: "2026-10-09", p_to: "2026-10-12" });
  check(!daily.error && daily.data?.length === 4, "devuelve una fila por dia, con ceros en los dias sin datos", daily.error?.message);
  const byDay = Object.fromEntries((daily.data ?? []).map((r) => [r.day, r]));
  check(byDay["2026-10-10"]?.submissions === 1 && byDay["2026-10-11"]?.submissions === 0, "un envio a las 23:30 de Costa Rica cuenta en el 10/10, no en el 11/10 UTC", JSON.stringify(byDay["2026-10-10"]));
  check(byDay["2026-10-10"]?.views === 2 && byDay["2026-10-10"]?.starts === 1, "lo mismo para una vista y un inicio a esa hora");
  check(byDay["2026-10-10"]?.spam === 1 && byDay["2026-10-10"]?.submissions === 1, "el spam se cuenta aparte y no suma a los envios");
  check(byDay["2026-10-09"]?.views === 0 && byDay["2026-10-12"]?.submissions === 0, "los dias sin datos son cero");
  const memberDaily = await member.client.rpc("form_metrics_daily", { p_form_id: mForm!.id, p_from: "2026-10-09", p_to: "2026-10-12" });
  check((memberDaily.data ?? []).length === 4, "un Member con forms.view ve los totales del formulario");
  const blindDaily = await blind.client.rpc("form_metrics_daily", { p_form_id: mForm!.id, p_from: "2026-10-09", p_to: "2026-10-12" });
  check((blindDaily.data ?? []).length === 0, "quien no pasa can_view_forms no recibe filas");
  const outsiderDaily = await outsider.client.rpc("form_metrics_daily", { p_form_id: mForm!.id, p_from: "2026-10-09", p_to: "2026-10-12" });
  check((outsiderDaily.data ?? []).length === 0, "otro workspace tampoco");
  const tooLong = await owner.client.rpc("form_metrics_daily", { p_form_id: mForm!.id, p_from: "2024-01-01", p_to: "2026-10-12" });
  check(!!tooLong.error, "un rango de mas de 366 dias se rechaza");

  // Igualdad en las tres columnas iniciales del indice parcial (workspace, formulario y tipo de evento) mas el
  // predicado `LIKE 'form\\_%'` de la funcion: con enable_seqscan = off el planificador tiene que elegirlo. Una
  // consulta con solo un rango de fechas puede preferir el indice general por (workspace, fecha) en un workspace
  // nuevo y sin estadisticas, y eso no seria una falla del indice.
  const plan = sql(
    `set enable_seqscan = off; explain select count(*) from public.analytics_events e where e.workspace_id = '${ws.id}' and e.metadata ->> 'form_id' = '${mForm!.id}' and e.event_type = 'form_view' and e.event_type LIKE 'form\\_%'`,
  );
  const planText = JSON.stringify(plan);
  check(planText.includes("idx_analytics_forms"), "el EXPLAIN de la consulta de vistas usa idx_analytics_forms", planText.slice(0, 300));

  // El beacon, con los puertos reales.
  const beaconPorts = createBeaconPorts(svc);
  const sid = randomUUID();
  const beaconIp = nextIp();
  const eventCount = async () => (await svc.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("event_type", "form_view").filter("metadata->>form_id", "eq", pForm!.id)).count ?? 0;
  const viewsBefore = await eventCount();
  const wrapped = { ...beaconPorts, limit: async (spec: Parameters<typeof beaconPorts.limit>[0]) => (usedLimitKeys.add(spec.key), beaconPorts.limit(spec)) };
  for (let i = 0; i < 5; i++) await handleBeacon(wrapped, { slug: publicSlug, ip: beaconIp, body: { kind: "view", sid } });
  check((await eventCount()) === viewsBefore + 1, "recargar la misma pestaña 5 veces (mismo sid) deja UNA vista");
  await handleBeacon(wrapped, { slug: publicSlug, ip: beaconIp, body: { kind: "view", sid: randomUUID() } });
  check((await eventCount()) === viewsBefore + 2, "otra pestaña (otro sid) suma otra");
  const { data: viewRows } = await svc.from("analytics_events").select("contact_id, flow_id, metadata").eq("workspace_id", ws.id).eq("event_type", "form_view").filter("metadata->>form_id", "eq", pForm!.id);
  check((viewRows ?? []).every((r) => r.contact_id === null && r.flow_id === null), "los form_view no llevan contacto ni flow");
  check(!JSON.stringify(viewRows).includes(sid) && !JSON.stringify(viewRows).includes(beaconIp), "ni el sid ni la IP aparecen en los eventos");
  await handleBeacon(wrapped, { slug: `zz-no-existe`, ip: beaconIp, body: { kind: "view", sid: randomUUID() } });
  check((await eventCount()) === viewsBefore + 2, "un formulario inexistente no escribe nada");

  // El historial del contacto (la pagina del contacto) filtra por contacto Y por flow_started/flow_completed:
  // un form_view sembrado en el mismo workspace no puede aparecer ahi.
  const historyQuery = await svc
    .from("analytics_events")
    .select("id, event_type")
    .eq("contact_id", contactVisible)
    .in("event_type", ["flow_started", "flow_completed"]);
  const anyFormEvents = (await svc.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).like("event_type", "form\\_%")).count ?? 0;
  check(anyFormEvents > 0 && (historyQuery.data ?? []).length === 0, "hay eventos form_* en el workspace y ninguno aparece en la consulta del historial del contacto", `form_*: ${anyFormEvents}`);

  // ── Buckets ────────────────────────────────────────────────────────────────
  console.log("\n— 00153: buckets privados —");
  const buckets = sql("select id, public from storage.buckets where id in ('form-uploads','contracts')");
  check(buckets.length === 2 && buckets.every((b) => b.public === false), "form-uploads y contracts nacieron privados");
  const bucketPolicies = sql("select count(*)::int as n from pg_policies where schemaname='storage' and tablename='objects' and (coalesce(qual,'') like '%form-uploads%' or coalesce(qual,'') like '%contracts%' or coalesce(with_check,'') like '%form-uploads%' or coalesce(with_check,'') like '%contracts%')");
  check(bucketPolicies[0]?.n === 0, "ninguna policy de storage nombra esos buckets (sin acceso para clientes)");

} catch (error) {
  fail("la verificacion se corto con una excepcion", error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  // Limpieza: el secreto de prueba, los archivos subidos, los topes por IP y los datos de prueba.
  const { data: testWorkspaces } = await svc.from("workspaces").select("id").like("name", "zz-test-%");
  for (const w of testWorkspaces ?? []) {
    try {
      await deleteSecret(svc, w.id, "turnstile_secret_key");
    } catch {
      // sin secreto no hay nada que borrar
    }
  }
  if (uploaded.length > 0) await svc.storage.from("form-uploads").remove(uploaded);
  if (usedLimitKeys.size > 0) await svc.from("rate_limits").delete().in("key", [...usedLimitKeys]);
  void hashIp;
  const clean = await runCleanup(svc);
  if (!clean) failures++;
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
