/**
 * Formularios contra la base real (FO1 y los bloques que siguen).
 *
 * Base real, proveedores simulados: no se llama a Resend ni a ningun proveedor de IA.
 * (El captcha se saco en la correccion R1; ver docs/pendientes/turnstile-captcha.md.)
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
import { deleteSecret } from "../lib/vault";
import { signFormLink, verifyFormLink, createToken, getOrCreateLinkSecret } from "../lib/forms/signed-link";
import { recordTouch } from "../lib/contacts/touch";
import { resolveBankVariables } from "../lib/response-assets/bank-variables";
import { getTrigger } from "../lib/flow-engine/registry";
import { createNotification } from "../lib/notifications/create";
import { extractText, getDocumentProxy } from "unpdf";
import { isAlreadyAnswered } from "../lib/forms/public-load";
import { npsCategory } from "../lib/forms/survey";
import { effectiveAttribution } from "../lib/attribution/merge";
import { recordVisit, serializeStored, parseStored } from "../lib/attribution/store";
import { attributionFromParams } from "../lib/attribution/collect";
import { runContractPdf } from "../lib/forms/contract/pdf-run";
import { runContractEmail } from "../lib/forms/contract/email-run";

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

const usedLimitKeys = new Set<string>();
const uploaded: string[] = [];

function ports(ws: string, over: Partial<SubmitPorts> = {}): SubmitPorts {
  void ws;
  const real = createSubmitPorts(svc);
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
  for (const t of ["channel", "ai_provider", "email_provider", "social_network", "publishing_service", "google", "meta"]) {
    check(integrationCheck.includes(`'${t}'`), `el CHECK de integration_configs.type incluye '${t}'`);
  }
  check(!integrationCheck.includes("'captcha'"), "...y ya NO incluye 'captcha' (R1: se saco Turnstile)");

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
  check(true, "se publica sin ninguna integracion configurada (R1: publicar no depende de nada externo)");

  const pub = await anon.rpc("get_public_form", { p_slug: publicSlug });
  check(!pub.error && (pub.data as { status?: string })?.status === "available", "anon obtiene la definicion publica de un formulario publicado", pub.error?.message);
  const forbidden = findForbiddenKeys(pub.data);
  check(forbidden.length === 0, "la definicion publica NO tiene claves internas", forbidden.join(", "));
  check(!containsText(pub.data, secretFixed), "el valor de un oculto 'fixed' no aparece en la definicion publica");
  check(!containsText(pub.data, ws.id) && !containsText(pub.data, pForm!.id), "no aparece ni el workspace ni el id del formulario");
  const pubFields = (pub.data as { fields: Array<{ key: string; type: string; hidden?: unknown }> }).fields;
  check(pubFields.some((f) => f.key === "campana" && f.type === "hidden"), "un oculto de URL si se devuelve, solo con su fuente");
  check(!pubFields.some((f) => f.key === "canal"), "el oculto fijo no se devuelve");
  check(!("turnstile_site_key" in (pub.data as object)), "get_public_form NO devuelve turnstile_site_key (R1)");
  check(!("success" in (pub.data as object)), "no devuelve la configuracion de exito");
  const sameKeys = (pub.data as { fields: Array<Record<string, unknown>> }).fields.every((f) => Object.keys(f).every((k) => ["key", "type", "label", "help", "placeholder", "required", "options", "min", "max", "file", "consentText", "visibility", "prefill", "social", "hidden"].includes(k)));
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
  console.log("\n— F12: el envio seguro (codigo real, sin captcha) —");
  const key1 = randomUUID();
  const { data: pubVersion } = await svc.from("forms").select("current_version_id").eq("id", pForm!.id).single();
  const basePayload = (key: string, answers: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    idempotency_key: key,
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
  check(saved.status === "received", "con email mapeado, la respuesta crea el contacto y queda 'received' (FO2)");
  const again = await submitForm(ports(ws.id), input(publicSlug, basePayload(key1, { nombre: "Ana", email: "ana@example.test", plan: "A" })));
  check(again.body.duplicate === true, "un reintento con la misma clave devuelve la misma respuesta (duplicate)");

  const noEmail = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "Sin email", plan: "A" })));
  check(noEmail.status === 400 && (noEmail.body.fields as Record<string, string>)?.email, "falta un obligatorio visible: 400 con el campo");
  const badOption = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "X", email: "x@example.test", plan: "Z" })));
  check(badOption.status === 400, "una opcion que no existe: 400");

  // Honeypot: deja form_rejected, sin datos personales.
  const rejectedBefore = (await svc.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("event_type", "form_rejected")).count ?? 0;
  const honey = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "Bot", email: "bot@example.test" }, { honeypot: "http://spam" })));
  check(honey.status === 200 && honey.body.ok === true, "honeypot lleno: 200 falso");
  const { data: honeyRow } = await svc.from("form_submissions").select("id").eq("form_id", pForm!.id).filter("answers->nombre->>value", "eq", "Bot");
  check((honeyRow ?? []).length === 0, "...y no se guarda nada");
  const rejectedMid = (await svc.from("analytics_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id).eq("event_type", "form_rejected")).count ?? 0;
  check(rejectedMid === rejectedBefore + 1, "queda un form_rejected por el honeypot");
  const { data: rejectedRows } = await svc.from("analytics_events").select("contact_id, flow_id, metadata").eq("workspace_id", ws.id).eq("event_type", "form_rejected");
  check((rejectedRows ?? []).length === rejectedBefore + 1, "...y no hay ningun otro rechazo");
  check((rejectedRows ?? []).every((r) => r.contact_id === null && r.flow_id === null), "los form_rejected no tienen contacto ni flow");
  const meta = (rejectedRows ?? []).map((r) => Object.keys((r.metadata ?? {}) as object).sort().join(","));
  check(meta.every((k) => k === "form_id,reason,version_id"), "la metadata de un rechazo es solo {form_id, reason, version_id}", meta.join(" | "));
  const noToken = await submitForm(ports(ws.id), input(publicSlug, basePayload(randomUUID(), { nombre: "Sin token", email: "st@example.test" })));
  check(noToken.status === 200 && noToken.body.ok === true, "un envio sin token de captcha se guarda (R1)", JSON.stringify(noToken.body));

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


  // ── FO2: contacto, atribucion y automatizaciones ───────────────────────────
  console.log("\n— 00155: flows.form_id y el CHECK de triggers —");
  const triggerCheck = String(sql("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'triggers_type_check'")[0]?.d);
  for (const t of [
    "keyword", "postback", "quick_reply", "welcome", "default", "comment_keyword", "new_contact", "crm_event", "inactivity", "email_received",
    "booking_created", "booking_rescheduled", "booking_cancelled", "booking_updated", "booking_ended", "booking_status_changed",
    "booking_before_start", "booking_after_end", "booking_after_created", "call_analyzed", "call_linked",
    "form_submitted", "survey_answered", "contract_signed",
  ]) {
    check(triggerCheck.includes(`'${t}'`), `el CHECK de triggers.type incluye '${t}'`);
  }
  const formIdColumn = sql("select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='flows' and column_name='form_id'");
  check(formIdColumn[0]?.n === 1, "flows tiene la columna form_id");
  const formIdIndex = sql("select indexdef from pg_indexes where indexname='idx_flows_form'");
  check(String(formIdIndex[0]?.indexdef ?? "").includes("WHERE (form_id IS NOT NULL)"), "idx_flows_form es parcial (solo flows con formulario)");

  console.log("\n— F16/F17/F18: el contacto, el toque y el aviso (codigo real, sin captcha) —");
  const { data: tag } = await svc.from("tags").insert({ workspace_id: ws.id, name: "zz-test calificado" }).select("id").single();
  const { data: customDef } = await svc.from("custom_field_definitions").insert({ workspace_id: ws.id, name: "zz-test empresa", slug: "zz_test_empresa", type: "text" }).select("id").single();
  const fo2Slug = `zz-test-fo2-${Date.now()}`;
  const fo2Fields: FormField[] = [
    field("short_text", "nombre", { required: true, label: "Nombre" }),
    field("email", "email", { label: "Email" }),
    field("phone", "tel", { label: "Telefono" }),
    field("short_text", "empresa", { label: "Empresa" }),
  ];
  const contactConfig = (over: Record<string, unknown> = {}) => ({
    mode: "create_or_link",
    update: "fill_empty",
    map: [
      { fieldKey: "nombre", target: "contact.display_name" },
      { fieldKey: "email", target: "contact.email" },
      { fieldKey: "tel", target: "contact.phone" },
      { fieldKey: "empresa", target: "contact.custom.zz_test_empresa" },
    ],
    ...over,
  });
  const { data: fo2 } = await svc
    .from("forms")
    .insert({
      workspace_id: ws.id, name: "zz-test FO2", type: "custom", slug: fo2Slug,
      draft_definition: { fields: fo2Fields } as unknown as Json,
      contact_config: contactConfig() as unknown as Json,
      tags_on_submit: [tag!.id], notify_enabled: true, notify_user_ids: [owner.id],
    })
    .select("id")
    .single();
  await svc.rpc("publish_form_version", { p_form_id: fo2!.id, p_actor: owner.id });
  const { data: fo2Pub } = await svc.from("forms").select("current_version_id").eq("id", fo2!.id).single();
  await svc.from("forms").update({ status: "published" }).eq("id", fo2!.id);

  const fo2Payload = (answers: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    idempotency_key: randomUUID(),
    version_id: fo2Pub!.current_version_id,
    answers,
    honeypot: "",
    attribution: { utm_source: "facebook", utm_campaign: "octubre", ad_id: "123" },
    client_meta: { timezone: "America/Costa_Rica" },
    origin: "public_page",
    ...extra,
  });
  const send = (answers: Record<string, unknown>, extra: Record<string, unknown> = {}) => submitForm(ports(ws.id), input(fo2Slug, fo2Payload(answers, extra)));
  const rowOf = async (submissionId: unknown) => (await svc.from("form_submissions").select("*").eq("id", String(submissionId)).single()).data!;

  // 1. Contacto nuevo.
  const first = await send({ nombre: "Ana Nueva", email: "Ana.Nueva@Example.test", tel: "+50688881234", empresa: "Acme" });
  check(first.status === 200, "un envio con email y telefono responde 200", JSON.stringify(first.body));
  const firstRow = await rowOf(first.body.submission_id);
  check(firstRow.status === "received" && !!firstRow.contact_id && firstRow.contact_created === true, "crea el contacto y la respuesta queda 'received' con contact_created");
  const { data: c1 } = await svc.from("contacts").select("*").eq("id", firstRow.contact_id!).single();
  check(c1?.display_name === "Ana Nueva" && c1?.email === "ana.nueva@example.test" && c1?.phone === "+50688881234", "el contacto tiene el nombre, el email normalizado y el telefono", `${c1?.display_name} ${c1?.email} ${c1?.phone}`);
  const { data: cf } = await svc.from("contact_custom_fields").select("value").eq("contact_id", firstRow.contact_id!).eq("field_id", customDef!.id);
  check(cf?.[0]?.value === "Acme", "el campo personalizado mapeado se guarda");
  const { data: ct } = await svc.from("contact_tags").select("tag_id").eq("contact_id", firstRow.contact_id!);
  check((ct ?? []).some((t) => t.tag_id === tag!.id), "la etiqueta del formulario queda puesta");
  const { data: audit1 } = await svc.from("audit_log").select("action, actor_type, actor_label, performed_by").eq("entity_type", "contact").eq("entity_id", firstRow.contact_id!).eq("action", "contact.created");
  check(audit1?.length === 1 && audit1[0].actor_type === "system" && audit1[0].actor_label === "Formulario: zz-test FO2" && audit1[0].performed_by === null, "el historial dice contact.created por el sistema 'Formulario: <nombre>'", JSON.stringify(audit1));

  // 2. El evento de automatizacion: solo escalares, sin booking_id.
  const { data: evs } = await svc.from("automation_events").select("event_type, contact_id, payload").eq("contact_id", firstRow.contact_id!);
  const ev = (evs ?? []).find((e) => e.event_type === "form_submitted");
  check(!!ev, "se emite un evento form_submitted para el contacto");
  const payload = (ev?.payload ?? {}) as Record<string, unknown>;
  check(Object.values(payload).every((v) => ["string", "number"].includes(typeof v)), "el payload del evento tiene solo escalares", JSON.stringify(payload));
  check(!("booking_id" in payload) && payload.submission_id === firstRow.id && payload.form_id === fo2!.id, "...sin booking_id y con submission_id y form_id");
  check((evs ?? []).filter((e) => e.event_type === "survey_answered" || e.event_type === "contract_signed").length === 0, "un formulario comun NO emite eventos de encuesta ni de contrato");

  // 3. El toque: contacto nuevo => primero y ultimo.
  const { data: attr1 } = await svc.from("contacts").select("attribution").eq("id", firstRow.contact_id!).single();
  const a1 = attr1?.attribution as { first_touch?: { campaign?: string; medium?: string; source?: string }; last_touch?: { campaign?: string } };
  check(a1?.first_touch?.campaign === "octubre" && a1?.last_touch?.campaign === "octubre" && a1?.first_touch?.medium === "form" && a1?.first_touch?.source === "facebook", "contacto nuevo: el toque del formulario es su primero y su ultimo (medium 'form')", JSON.stringify(a1));
  const { data: touches1 } = await svc.from("contact_touches").select("origin, dedupe_key, content_label, ad_id").eq("contact_id", firstRow.contact_id!);
  check(touches1?.length === 1 && touches1[0].origin === "form" && touches1[0].dedupe_key === `form:${firstRow.id}` && touches1[0].ad_id === "123", "queda UNA fila en contact_touches con origin 'form' y la clave form:<respuesta>", JSON.stringify(touches1));
  check(touches1?.[0].content_label === "zz-test FO2", "sin utm_content, la pieza es el nombre del formulario");

  // 4. El aviso de la campana.
  const { data: notes } = await svc.from("notifications").select("type, entity_type, entity_id, recipient_id, metadata, body").eq("workspace_id", ws.id).eq("type", "form_submitted").eq("entity_id", firstRow.id);
  check(notes?.length === 1 && notes[0].recipient_id === owner.id && notes[0].entity_type === "form_submission" && (notes[0].metadata as { form_id?: string }).form_id === fo2!.id, "queda un aviso form_submitted para quien eligio el formulario, con el form_id en la metadata", JSON.stringify(notes));
  check(!JSON.stringify(notes).includes("ana.nueva") && !JSON.stringify(notes).includes("50688881234"), "el aviso no lleva el email ni el telefono de la persona");

  // 5. Un contacto que ya existe: por telefono (con otro email), y el email choca con otro contacto.
  const { data: dupPhone } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Telefono Viejo", phone: "+50670000001" }).select("id").single();
  const { data: dupEmail } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Email Otro", email: "otro.zz@example.test" }).select("id").single();
  const byPhone = await rowOf((await send({ nombre: "X", email: "otro.zz@example.test", tel: "+50670000001" })).body.submission_id);
  check(byPhone.contact_id === dupPhone!.id && byPhone.contact_created === false, "con el mismo telefono se vincula al contacto existente aunque el email sea de otro");
  check((byPhone.dedupe as { matched_by?: string; conflict_contact_id?: string }).matched_by === "phone" && (byPhone.dedupe as { conflict_contact_id?: string }).conflict_contact_id === dupEmail!.id, "matched_by = phone y conflict_contact_id = el otro contacto", JSON.stringify(byPhone.dedupe));

  // 6. Email secundario, con mayusculas.
  const { data: secondary } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Secundario", email: "principal.zz@example.test", secondary_email: "sec.zz@example.test" }).select("id").single();
  const bySecondary = await rowOf((await send({ nombre: "Y", email: "SEC.ZZ@Example.test" })).body.submission_id);
  check(bySecondary.contact_id === secondary!.id && (bySecondary.dedupe as { matched_by?: string }).matched_by === "email", "el email (en mayusculas) encuentra el email secundario");

  // 7. Sin email ni telefono: no se crea nada y no hay evento.
  const eventsBefore = (await svc.from("automation_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count ?? 0;
  const anon1 = await rowOf((await send({ nombre: "Anonimo" })).body.submission_id);
  check(anon1.contact_id === null && anon1.status === "no_contact", "sin email ni telefono: no hay contacto y la respuesta queda 'no_contact'");
  check(((await svc.from("automation_events").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count ?? 0) === eventsBefore, "...y no se emite ningun automation_event");
  const { data: anonNote } = await svc.from("notifications").select("id").eq("workspace_id", ws.id).eq("type", "form_submitted").eq("entity_id", anon1.id);
  check((anonNote ?? []).length === 1, "...pero el aviso al equipo llega igual");

  // 8. link_only.
  await svc.from("forms").update({ contact_config: contactConfig({ mode: "link_only" }) as unknown as Json }).eq("id", fo2!.id);
  const contactsBefore = (await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count ?? 0;
  const linkOnlyNew = await rowOf((await send({ nombre: "Nadie", email: "nadie.zz@example.test" })).body.submission_id);
  check(linkOnlyNew.contact_id === null && linkOnlyNew.status === "no_contact", "link_only con un contacto que no existe: no se crea y queda 'no_contact'");
  check(((await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count ?? 0) === contactsBefore, "...y no aparecio ningun contacto");
  const linkOnlyExisting = await rowOf((await send({ nombre: "Ana", email: "ana.nueva@example.test" })).body.submission_id);
  check(linkOnlyExisting.contact_id === firstRow.contact_id, "link_only con un contacto que existe: lo vincula");

  // 9. fill_empty / overwrite.
  await svc.from("forms").update({ contact_config: contactConfig() as unknown as Json }).eq("id", fo2!.id);
  await send({ nombre: "Ana Maria Nueva", email: "ana.nueva@example.test", empresa: "Otra" });
  const { data: keep } = await svc.from("contacts").select("display_name").eq("id", firstRow.contact_id!).single();
  check(keep?.display_name === "Ana Nueva", "fill_empty: un nombre que ya estaba NO cambia");
  const { data: keepCf } = await svc.from("contact_custom_fields").select("value").eq("contact_id", firstRow.contact_id!).eq("field_id", customDef!.id);
  check(keepCf?.[0]?.value === "Acme", "fill_empty: el campo personalizado que ya tenia valor NO cambia");
  await svc.from("forms").update({ contact_config: contactConfig({ update: "overwrite" }) as unknown as Json }).eq("id", fo2!.id);
  await send({ nombre: "Ana Maria Nueva", email: "ana.nueva@example.test", empresa: "Otra" });
  const { data: over } = await svc.from("contacts").select("display_name").eq("id", firstRow.contact_id!).single();
  check(over?.display_name === "Ana Maria Nueva", "overwrite: el nombre cambia");
  const { data: overCf } = await svc.from("contact_custom_fields").select("value").eq("contact_id", firstRow.contact_id!).eq("field_id", customDef!.id);
  check(overCf?.[0]?.value === "Otra", "overwrite: el campo personalizado cambia");
  await send({ nombre: "", email: "ana.nueva@example.test", tel: "" });
  const { data: notBlank } = await svc.from("contacts").select("display_name, phone").eq("id", firstRow.contact_id!).single();
  check(notBlank?.display_name === "Ana Maria Nueva" && notBlank?.phone === "+50688881234", "overwrite con un campo vacio: NUNCA borra un dato");
  await svc.from("forms").update({ contact_config: contactConfig() as unknown as Json }).eq("id", fo2!.id);

  // 10. Concurrencia: cinco respuestas distintas con el mismo telefono nuevo => UN contacto.
  const racePhone = "+50670000999";
  const race = await Promise.all(Array.from({ length: 5 }, (_, i) => send({ nombre: `Carrera ${i}`, tel: racePhone })));
  check(race.every((r) => r.status === 200), "5 respuestas simultaneas con el mismo telefono nuevo responden 200", race.map((r) => r.status).join(","));
  const { data: raceContacts } = await svc.from("contacts").select("id").eq("workspace_id", ws.id).eq("phone", racePhone);
  check(raceContacts?.length === 1, "...y queda UN solo contacto", `hay ${raceContacts?.length}`);

  // 11. Primer y ultimo toque de un contacto que ya tenia historia.
  const { data: veteran } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Veterano", email: "veterano.zz@example.test" }).select("id").single();
  await recordTouch(svc, {
    workspaceId: ws.id, contactId: veteran!.id,
    touch: { source: "instagram", medium: "dm", origin: "dm", dedupeKey: "zz-prev-dm", occurredAt: new Date(Date.now() - 86_400_000) },
  });
  const vet = await rowOf((await send({ nombre: "Veterano", email: "veterano.zz@example.test" }, { attribution: { utm_source: "facebook", utm_campaign: "noviembre" } })).body.submission_id);
  const { data: vetAttr } = await svc.from("contacts").select("attribution").eq("id", veteran!.id).single();
  const av = vetAttr?.attribution as { first_touch?: { source?: string }; last_touch?: { campaign?: string; medium?: string } };
  check(av?.first_touch?.source === "instagram", "contacto con historia: el PRIMER toque no cambia (instagram)", JSON.stringify(av));
  check(av?.last_touch?.campaign === "noviembre" && av?.last_touch?.medium === "form", "...y el ULTIMO es el del formulario", JSON.stringify(av));
  const replay = await recordTouch(svc, {
    workspaceId: ws.id, contactId: veteran!.id,
    touch: { source: "facebook", medium: "form", origin: "form", dedupeKey: `form:${vet.id}`, campaign: "noviembre" },
  });
  const { data: vetTouches } = await svc.from("contact_touches").select("id").eq("contact_id", veteran!.id).eq("dedupe_key", `form:${vet.id}`);
  check(vetTouches?.length === 1 && replay.recorded === false, "procesar dos veces el mismo envio deja UNA fila en contact_touches");
  const { data: noPrior } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Sin Historia", email: "sinhistoria.zz@example.test", attribution: {} }).select("id").single();
  await svc.from("contact_touches").delete().eq("contact_id", noPrior!.id);
  await send({ nombre: "Sin Historia", email: "sinhistoria.zz@example.test" }, { attribution: { utm_source: "google", utm_campaign: "tardio" } });
  const { data: npAttr } = await svc.from("contacts").select("attribution").eq("id", noPrior!.id).single();
  const np = npAttr?.attribution as { first_touch?: { campaign?: string }; last_touch?: { campaign?: string } };
  check(np?.first_touch?.campaign === "tardio" && np?.last_touch?.campaign === "tardio", "contacto existente SIN toques: el del formulario queda como primero y ultimo");

  console.log("\n— F20: el link firmado por contacto —");
  const signedUrl = await signFormLink(svc, { workspaceId: ws.id, formId: fo2!.id, slug: fo2Slug, contactId: veteran!.id, serviceId: randomUUID(), saleId: randomUUID(), baseUrl: "https://app.ejemplo.test" });
  const token = new globalThis.URL(signedUrl).searchParams.get("c")!;
  const okLink = await verifyFormLink(svc, token, { workspaceId: ws.id, formId: fo2!.id });
  check(okLink.ok && okLink.contactId === veteran!.id && !!okLink.serviceId && !!okLink.saleId, "un link firmado valido se verifica con su contacto, servicio y venta");
  check(!signedUrl.includes(okLink.ok ? okLink.serviceId ?? "x" : "x"), "los ids de servicio y venta no aparecen en claro en la URL");
  const tampered = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
  check(!(await verifyFormLink(svc, tampered, { workspaceId: ws.id, formId: fo2!.id })).ok, "la firma alterada se rechaza");
  const secret = await getOrCreateLinkSecret(svc, ws.id);
  const otherContact = createToken({ formId: randomUUID(), contactId: veteran!.id }, secret);
  check(!(await verifyFormLink(svc, otherContact, { workspaceId: ws.id, formId: fo2!.id })).ok, "un token de otro formulario se rechaza");
  const expired = createToken({ formId: fo2!.id, contactId: veteran!.id, ttlDays: 1, now: Date.now() - 3 * 86_400_000 }, secret);
  check(!(await verifyFormLink(svc, expired, { workspaceId: ws.id, formId: fo2!.id })).ok, "un token vencido se rechaza");
  const { data: gone } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Borrado", deleted_at: new Date().toISOString() }).select("id").single();
  const goneToken = createToken({ formId: fo2!.id, contactId: gone!.id }, secret);
  check(!(await verifyFormLink(svc, goneToken, { workspaceId: ws.id, formId: fo2!.id })).ok, "un contacto borrado se rechaza");
  const otherWsToken = createToken({ formId: fo2!.id, contactId: randomUUID() }, secret);
  check(!(await verifyFormLink(svc, otherWsToken, { workspaceId: ws.id, formId: fo2!.id })).ok, "un contacto que no es de este workspace se rechaza");

  const serviceId = randomUUID();
  const saleId = randomUUID();
  const withLink = await signFormLink(svc, { workspaceId: ws.id, formId: fo2!.id, slug: fo2Slug, contactId: veteran!.id, serviceId, saleId, baseUrl: "https://app.ejemplo.test" });
  const linked = await rowOf((await send({ nombre: "Otro Nombre", email: "completamente.otro@example.test" }, { link_token: new globalThis.URL(withLink).searchParams.get("c") })).body.submission_id);
  check(linked.contact_id === veteran!.id && linked.contact_created === false, "con un link valido la respuesta va al contacto del link, sin deduplicar por el email que escribio");
  // Desde la 00164 el sale_id del link se VALIDA: una venta que no existe se descarta (la respuesta se guarda igual).
  check(linked.service_id === serviceId && linked.sale_id === null && (linked.meta as { sale_id_discarded?: boolean })?.sale_id_discarded === true, "...guarda el service_id y descarta un sale_id de una venta inexistente (00164, meta.sale_id_discarded)");
  const looseIds = await rowOf((await send({ nombre: "Suelto", email: "suelto.zz@example.test" }, { service_id: randomUUID(), sale_id: randomUUID() })).body.submission_id);
  check(looseIds.service_id === null && looseIds.sale_id === null, "un service_id o sale_id suelto en el cuerpo del envio se ignora");
  const badLink = await rowOf((await send({ nombre: "Token Roto", email: "tokenroto.zz@example.test" }, { link_token: tampered })).body.submission_id);
  check(badLink.status === "received" && badLink.contact_id !== veteran!.id && badLink.service_id === null, "con un token invalido el envio se guarda igual y se resuelve por email");

  console.log("\n— F19/F20: los triggers y las variables contra la base —");
  const formTrigger = getTrigger("form_submitted")!;
  const fakeEvent = (submissionId: string) => ({ id: randomUUID(), workspace_id: ws.id, event_type: "form_submitted", contact_id: firstRow.contact_id!, payload: { submission_id: submissionId, form_id: fo2!.id, form_type: "custom" } });
  const triggerArgs = (submissionId: string, config: Record<string, unknown>) => ({ supabase: svc, event: fakeEvent(submissionId), config, trigger: { id: randomUUID() } }) as never;
  check((await formTrigger.eventMatches!(triggerArgs(String(first.body.submission_id), { form_ids: [fo2!.id] }))) === true, "el trigger coincide con el formulario elegido");
  check((await formTrigger.eventMatches!(triggerArgs(String(first.body.submission_id), { form_ids: [randomUUID()] }))) === false, "...y no coincide con otro");
  check((await formTrigger.eventMatches!(triggerArgs(String(first.body.submission_id), { answer_conditions: { rootConjunction: "and", conditions: [{ fieldKey: "empresa", operator: "is", value: "Acme" }], groups: [] } }))) === true, "las condiciones sobre las respuestas leen la respuesta guardada");
  check((await formTrigger.eventMatches!(triggerArgs(randomUUID(), {}))) === false, "una respuesta que no existe no dispara");
  const vars = (await formTrigger.variablesFor!(triggerArgs(String(first.body.submission_id), {}))) as { form?: { name?: string; url?: string }; answer?: Record<string, string>; submission?: { url?: string } };
  check(vars.form?.name === "zz-test FO2" && vars.answer?.nombre === "Ana Nueva" && String(vars.submission?.url).endsWith(`/dashboard/formularios/${fo2!.id}/respuestas/${firstRow.id}`), "variablesFor arma form.*, answer.* y submission.url con la respuesta real", JSON.stringify(vars));
  check(formTrigger.dedupeKeyFor!(triggerArgs("sub-1", {})) === "form:form_submitted:sub-1", "la clave de idempotencia es form:<tipo>:<respuesta>");

  const [withToken, withoutToken] = await resolveBankVariables(svc, { workspaceId: ws.id, contactId: veteran!.id, variables: { service: { id: serviceId } } }, [`Respondé: {{form_link.${fo2Slug.replace(/-/g, "_")}}}`, "Hola {{contact.display_name}}"]);
  const resolvedUrl = withToken.replace("Respondé: ", "");
  check(/\/f\/zz-test-fo2-\d+\?c=/.test(resolvedUrl), "{{form_link.<slug>}} se reemplaza por el link firmado", resolvedUrl);
  const resolvedToken = new globalThis.URL(resolvedUrl).searchParams.get("c");
  const verifiedFromText = await verifyFormLink(svc, resolvedToken, { workspaceId: ws.id, formId: fo2!.id });
  check(verifiedFromText.ok && verifiedFromText.contactId === veteran!.id && verifiedFromText.serviceId === serviceId, "...con un token valido para ese contacto y el service.id del flujo");
  check(!resolvedUrl.includes(serviceId), "...y el service_id no esta en claro en la URL");
  check(withoutToken === "Hola zz-test Veterano", "la variable de la banca se resuelve en el mismo pase");
  const [missing] = await resolveBankVariables(svc, { workspaceId: ws.id, contactId: veteran!.id }, ["{{form_link.no_existe_zz}}"]);
  check(missing === "{{form_link.no_existe_zz}}", "un formulario que no existe deja el token tal cual");

  // Un aviso apagado no escribe nada.
  await svc.from("forms").update({ notify_enabled: false }).eq("id", fo2!.id);
  const quiet = await rowOf((await send({ nombre: "Callado", email: "callado.zz@example.test" })).body.submission_id);
  const { data: quietNotes } = await svc.from("notifications").select("id").eq("entity_id", quiet.id).eq("type", "form_submitted");
  check((quietNotes ?? []).length === 0, "con notify_enabled = false no se crea ninguna notificacion");
  void createNotification;


  // ── FO3: encuesta/NPS y contrato ───────────────────────────────────────────
  console.log("\n— 00157: contract_signatures —");
  const csProtect = sql("select count(*)::int as n from pg_trigger where tgname='contract_signatures_protect'");
  check(csProtect[0]?.n === 1, "existe el trigger que protege la evidencia de una firma");
  const csRls = sql("select relrowsecurity as on from pg_class where relname='contract_signatures'");
  check(csRls[0]?.on === true, "contract_signatures tiene RLS");
  const csOneIndex = sql("select count(*)::int as n from pg_constraint where conname='contract_signatures_one_per_submission'");
  check(csOneIndex[0]?.n === 1, "una sola firma por respuesta (unico)");

  const jobIds: string[] = [];
  const contractFiles: string[] = [];
  const ctPorts = () => {
    const base = ports(ws.id);
    return {
      ...base,
      uploadContractFile: async (path: string, bytes: Uint8Array, mime: string) => {
        const done = await base.uploadContractFile(path, bytes, mime);
        if (done) contractFiles.push(path);
        return done;
      },
    };
  };

  // 1. Encuesta: NPS, estrellas, una vez por contacto.
  console.log("\n— F22: encuesta, NPS y una vez por contacto —");
  const surveySlug = `zz-test-enc-${Date.now()}`;
  const surveyFields: FormField[] = [field("nps", "nps", { required: true, label: "NPS" }), field("long_text", "porque", { label: "Por que" }), field("email", "email", { label: "Email" })];
  const surveyContact = { mode: "create_or_link", update: "fill_empty", map: [{ fieldKey: "email", target: "contact.email" }] };
  const { data: sForm } = await svc
    .from("forms")
    .insert({
      workspace_id: ws.id, name: "zz-test encuesta", type: "survey", slug: surveySlug,
      draft_definition: { fields: surveyFields } as unknown as Json,
      survey_config: { scoreFieldKey: "nps", category: "servicio", oncePerContact: true } as unknown as Json,
      contact_config: surveyContact as unknown as Json,
      notify_enabled: false,
    })
    .select("id")
    .single();
  await svc.rpc("publish_form_version", { p_form_id: sForm!.id, p_actor: owner.id });
  await svc.from("forms").update({ status: "published" }).eq("id", sForm!.id);
  const { data: sVer } = await svc.from("forms").select("current_version_id").eq("id", sForm!.id).single();
  const sendSurvey = (answers: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    submitForm(ports(ws.id), input(surveySlug, {
      idempotency_key: randomUUID(), version_id: sVer!.current_version_id, answers, honeypot: "", attribution: {}, client_meta: {}, origin: "public_page", ...extra,
    }));
  const rowById = async (id: unknown) => (await svc.from("form_submissions").select("*").eq("id", String(id)).single()).data!;

  const parity: Array<[number, string | null]> = [];
  for (const score of [0, 6, 7, 8, 9, 10]) {
    const out = await sendSurvey({ nps: score });
    parity.push([score, (await rowById(out.body.submission_id)).nps_category]);
  }
  check(parity.every(([score, category]) => category === npsCategory(score)), "paridad: la categoria NPS que calcula la RPC es la de npsCategory() para 0, 6, 7, 8, 9 y 10", JSON.stringify(parity));
  const nineRow = await rowById((await sendSurvey({ nps: 9 })).body.submission_id);
  check(nineRow.score === 9 && nineRow.nps_category === "promoter", "un 9 guarda score 9 y promotor");

  // Estrellas: score sin categoria.
  const starsSlug = `zz-test-est-${Date.now()}`;
  const { data: stForm } = await svc
    .from("forms")
    .insert({
      workspace_id: ws.id, name: "zz-test estrellas", type: "survey", slug: starsSlug,
      draft_definition: { fields: [field("rating", "estrellas", { required: true, label: "Estrellas" })] } as unknown as Json,
      survey_config: { scoreFieldKey: "estrellas", category: "general", oncePerContact: false } as unknown as Json,
      notify_enabled: false,
    })
    .select("id")
    .single();
  await svc.rpc("publish_form_version", { p_form_id: stForm!.id, p_actor: owner.id });
  await svc.from("forms").update({ status: "published" }).eq("id", stForm!.id);
  const { data: stVer } = await svc.from("forms").select("current_version_id").eq("id", stForm!.id).single();
  const starsOut = await submitForm(ports(ws.id), input(starsSlug, { idempotency_key: randomUUID(), version_id: stVer!.current_version_id, answers: { estrellas: 4 }, honeypot: "", attribution: {}, client_meta: {}, origin: "public_page" }));
  const starsRow = await rowById(starsOut.body.submission_id);
  check(starsRow.score === 4 && starsRow.nps_category === null, "estrellas: guarda el puntaje y NO una categoria NPS");

  // Una vez por contacto, por email.
  const once1 = await sendSurvey({ nps: 8, email: "unavez.zz@example.test" });
  check(once1.status === 200, "la primera respuesta de un contacto se guarda");
  const once2 = await sendSurvey({ nps: 3, email: "unavez.zz@example.test" });
  check(once2.status === 409 && once2.body.error === "already_answered", "la segunda del mismo contacto da 409 already_answered");
  const { data: onceRows } = await svc.from("form_submissions").select("id, once_key").eq("form_id", sForm!.id).like("once_key", "contact:%");
  check((onceRows ?? []).length === 1, "y NO se guardo", `hay ${onceRows?.length}`);
  const anon2 = [await sendSurvey({ nps: 5 }), await sendSurvey({ nps: 6 })];
  check(anon2.every((r) => r.status === 200), "las respuestas anonimas (sin email ni link) no se pueden limitar");

  // Una respuesta marcada spam no cuenta: esa persona puede responder de nuevo.
  await svc.from("form_submissions").update({ status: "spam" }).eq("id", String(once1.body.submission_id));
  const afterSpam = await sendSurvey({ nps: 9, email: "unavez.zz@example.test" });
  check(afterSpam.status === 200, "con la anterior marcada spam, el contacto puede responder de nuevo");

  // Link firmado: la clave es el contacto del link.
  const { data: linkContact } = await svc.from("contacts").insert({ workspace_id: ws.id, display_name: "zz-test Con Link", email: "conlink.zz@example.test" }).select("id").single();
  const surveyLink = await signFormLink(svc, { workspaceId: ws.id, formId: sForm!.id, slug: surveySlug, contactId: linkContact!.id, baseUrl: "https://app.ejemplo.test" });
  const linkToken = new globalThis.URL(surveyLink).searchParams.get("c")!;
  check(!(await isAlreadyAnswered(svc, surveySlug, linkToken)), "antes de responder, la pagina NO dice 'Ya respondiste'");
  const withLink1 = await sendSurvey({ nps: 10 }, { link_token: linkToken });
  const withLinkRow = await rowById(withLink1.body.submission_id);
  check(withLink1.status === 200 && withLinkRow.contact_id === linkContact!.id && withLinkRow.once_key === `contact:${linkContact!.id}`, "con el link firmado la respuesta va al contacto del link y la clave es contact:<id>");
  check(await isAlreadyAnswered(svc, surveySlug, linkToken), "despues de responder, la pagina dice 'Ya respondiste' antes del formulario");
  const withLink2 = await sendSurvey({ nps: 2 }, { link_token: linkToken });
  check(withLink2.status === 409, "responder otra vez con el mismo link da 409");
  const tamperedToken = linkToken.slice(0, -2) + (linkToken.endsWith("AA") ? "BB" : "AA");
  check(!(await isAlreadyAnswered(svc, surveySlug, tamperedToken)), "con un token alterado la pagina funciona como si no hubiera c (no da error)");
  const { data: surveyEvents } = await svc.from("automation_events").select("event_type, payload").eq("contact_id", linkContact!.id);
  const surveyEvent = (surveyEvents ?? []).find((e) => e.event_type === "survey_answered");
  check(!!surveyEvent && (surveyEvent.payload as { score?: unknown; nps_category?: unknown }).score === 10 && (surveyEvent.payload as { nps_category?: unknown }).nps_category === "promoter", "una encuesta emite survey_answered con el puntaje y la categoria (y NO form_submitted)", JSON.stringify(surveyEvents));
  check(!(surveyEvents ?? []).some((e) => e.event_type === "form_submitted"), "una encuesta no emite form_submitted (un evento por respuesta)");

  // 2. Contrato.
  console.log("\n— F24-F28: contrato, firma, huella, PDF y email —");
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
  const pngUrl = `data:image/png;base64,${PNG.toString("base64")}`;
  const contractSlug = `zz-test-contrato2-${Date.now()}`;
  const contractText1 = hashContractText("# Acuerdo de servicios\n\nEl cliente acepta las condiciones.\n\n- Primera clausula\n- Segunda clausula con ñ y ¿acentos?");
  const contractFields: FormField[] = [field("short_text", "nombre", { required: true, label: "Nombre del firmante" }), field("email", "email", { required: true, label: "Email" })];
  const { data: kForm } = await svc
    .from("forms")
    .insert({
      workspace_id: ws.id, name: "zz-test firma", type: "contract", slug: contractSlug,
      draft_definition: { fields: contractFields, contractText: contractText1.text } as unknown as Json,
      contract_config: { title: "Acuerdo de servicios", signatureRequired: true, acceptLabel: "Leí y acepto", ccEmails: [] } as unknown as Json,
      contact_config: { mode: "create_or_link", update: "fill_empty", map: [{ fieldKey: "nombre", target: "contact.display_name" }, { fieldKey: "email", target: "contact.email" }] } as unknown as Json,
      notify_enabled: false,
    })
    .select("id")
    .single();
  await svc.rpc("publish_form_version", { p_form_id: kForm!.id, p_actor: owner.id });
  await svc.from("forms").update({ status: "published" }).eq("id", kForm!.id);
  const { data: kVer1 } = await svc.from("forms").select("current_version_id").eq("id", kForm!.id).single();
  const v1Id = kVer1!.current_version_id!;
  const sendContract = (answers: Record<string, unknown>, extra: Record<string, unknown> = {}, versionId = v1Id, ip = nextIp()) =>
    submitForm(ctPorts(), { ...input(contractSlug, { idempotency_key: randomUUID(), version_id: versionId, answers, honeypot: "", attribution: { utm_source: "meta" }, client_meta: { timezone: "America/Costa_Rica", locale: "es-CR" }, origin: "public_page", ...extra }, [], ip), userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1" });
  const sig = (over: Record<string, unknown> = {}) => ({ accepted: true, signature: pngUrl, signature_strokes: 3, ...over });
  const ana = { nombre: "Ana Firma", email: "Ana.Firma@Example.test" };

  const noAccept = await sendContract(ana, sig({ accepted: false }));
  check(noAccept.status === 400, "sin aceptar la casilla: 400");
  const noSig = await sendContract(ana, sig({ signature: "", signature_strokes: 0 }));
  check(noSig.status === 400 && noSig.body.error === "signature_required", "sin firma (obligatoria): 400 signature_required");
  const fakePng = await sendContract(ana, sig({ signature: `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a]).toString("base64")}` }));
  check(fakePng.status === 400 && fakePng.body.error === "signature_invalid", "un 'PNG' que en realidad es un JPEG: 400 signature_invalid");
  const bigPng = await sendContract(ana, sig({ signature: `data:image/png;base64,${Buffer.concat([PNG, Buffer.alloc(250 * 1024, 1)]).toString("base64")}` }));
  check(bigPng.status === 400, "una firma de 250 KB: 400");
  const { count: noRows } = await svc.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", kForm!.id);
  check(noRows === 0, "ninguno de esos envios dejo una respuesta");
  const { count: noSigs } = await svc.from("contract_signatures").select("id", { count: "exact", head: true }).eq("form_id", kForm!.id);
  check(noSigs === 0, "...ni una firma");

  const signedOk = await sendContract(ana, sig({ contract_text: "TEXTO QUE MANDA EL NAVEGADOR", contract_html: "<b>x</b>", signed_at: "2000-01-01T00:00:00Z" }));
  check(signedOk.status === 200, "un envio valido se firma", JSON.stringify(signedOk.body));
  check(String((signedOk.body.success as { body?: string })?.body).includes("ana.firma@example.test"), "la pantalla de exito dice a que email va la copia");
  const { data: sig1 } = await svc.from("contract_signatures").select("*").eq("submission_id", String(signedOk.body.submission_id)).single();
  check(sig1?.text_sha256 === contractText1.sha256, "la huella es el SHA-256 del texto GUARDADO (el texto del navegador se ignora)", `${sig1?.text_sha256} vs ${contractText1.sha256}`);
  check(sig1?.form_version_id === v1Id, "la firma queda con la version 1");
  check(sig1?.signer_email === "ana.firma@example.test" && sig1?.signer_name === "Ana Firma", "guarda el firmante (email normalizado)");
  const legal1 = (sig1?.legal ?? {}) as Record<string, unknown>;
  check(typeof legal1.ip === "string" && String(legal1.ip).startsWith("203.0.113.") && legal1.device === "mobile" && legal1.os === "iOS" && legal1.browser === "Safari", "la metadata legal sale del servidor: IP en claro, dispositivo, sistema y navegador", JSON.stringify(legal1));
  check(legal1.timezone === "America/Costa_Rica" && legal1.accepted_label === "Leí y acepto" && legal1.signature_strokes === 3, "la zona la declara el navegador y la casilla queda guardada");
  check(Math.abs(Date.now() - new Date(String(sig1?.signed_at)).getTime()) < 120_000, "signed_at es la hora del servidor aunque el navegador mande otra");
  check(sig1?.pdf_status === "pending" && sig1?.email_status === "pending", "arranca con pdf_status y email_status 'pending'");
  const { data: subMeta } = await svc.from("form_submissions").select("meta").eq("id", String(signedOk.body.submission_id)).single();
  check(!JSON.stringify(subMeta?.meta).includes("203.0.113"), "la IP en claro esta SOLO en la firma: en la respuesta va hasheada");
  const { data: storedSig } = await svc.storage.from("contracts").download(String(sig1?.signature_path));
  check(!!storedSig && (await storedSig.arrayBuffer()).byteLength === PNG.byteLength, "la imagen de la firma esta en el bucket privado de contratos");

  // Sin mirar el estado: el ejecutor de la cola de produccion puede tomar el job antes de esta consulta
  // (hoy no conoce el tipo y lo deja fallido; con el codigo desplegado lo corre de verdad).
  const { data: pdfJob } = await svc.from("scheduled_jobs").select("id, type, dedupe_key, status, payload").eq("dedupe_key", `contract_pdf:${sig1!.id}`);
  check(pdfJob?.length === 1 && pdfJob[0].type === "contract_pdf" && (pdfJob[0].payload as { signatureId?: string }).signatureId === sig1!.id, "la RPC encolo el job contract_pdf en la misma transaccion");
  for (const j of pdfJob ?? []) jobIds.push(j.id);
  const { data: contractEvents } = await svc.from("automation_events").select("event_type, payload").eq("contact_id", String(sig1?.contact_id));
  check((contractEvents ?? []).some((e) => e.event_type === "contract_signed"), "se emite contract_signed (no espera al PDF)");
  check(!(contractEvents ?? []).some((e) => e.event_type === "form_submitted" || e.event_type === "survey_answered"), "un contrato no emite los eventos de los otros tipos");

  // La evidencia no se toca.
  const { error: evErr1 } = await svc.from("contract_signatures").update({ text_sha256: "f".repeat(64) }).eq("id", sig1!.id);
  const { error: evErr2 } = await svc.from("contract_signatures").update({ legal: { ip: "1.1.1.1" } as unknown as Json }).eq("id", sig1!.id);
  const { error: evErr3 } = await svc.from("contract_signatures").update({ signed_at: "2000-01-01T00:00:00Z" }).eq("id", sig1!.id);
  check(!!evErr1 && !!evErr2 && !!evErr3, "ni con el service role se puede cambiar la huella, la metadata legal ni la hora de una firma");
  const { error: stateOk } = await svc.from("contract_signatures").update({ pdf_attempts: 0 }).eq("id", sig1!.id);
  check(!stateOk, "pero el estado del PDF y del email si se actualiza");
  const dupSig = await svc.rpc("record_contract_signature", { p_submission_id: String(signedOk.body.submission_id), p_signature_path: null, p_legal: {}, p_signer_name: "x", p_signer_email: "x@example.test" });
  check(!dupSig.error && dupSig.data === sig1!.id, "record_contract_signature es idempotente: devuelve la misma firma");
  const { error: anonRecord } = await anon.rpc("record_contract_signature", { p_submission_id: String(signedOk.body.submission_id), p_signature_path: null, p_legal: {} });
  const { error: userRecord } = await admin.client.rpc("record_contract_signature", { p_submission_id: String(signedOk.body.submission_id), p_signature_path: null, p_legal: {} });
  check(!!anonRecord && !!userRecord, "ni anon ni un Admin desde el navegador pueden llamar a record_contract_signature");

  // RLS de las firmas.
  const sigRows = async (u: TestUser) => (await u.client.from("contract_signatures").select("id").eq("workspace_id", ws.id)).data ?? [];
  check((await sigRows(owner)).length >= 1 && (await sigRows(admin)).length >= 1, "Owner y Admin ven las firmas");
  check((await sigRows(member)).length === 0, "un Member NO ve la firma de un contacto que no es suyo");
  check((await sigRows(blind)).length === 0 && (await sigRows(outsider)).length === 0, "sin forms.view y otro workspace no ven ninguna");
  const { data: anonSigs } = await anon.from("contract_signatures").select("id");
  check((anonSigs ?? []).length === 0, "anon no lee firmas");
  const { error: memberInsertSig } = await member.client.from("contract_signatures").insert({ workspace_id: ws.id, submission_id: String(signedOk.body.submission_id), form_id: kForm!.id, form_version_id: v1Id, text_sha256: "a".repeat(64), signer_email: "x@example.test", legal: {} as unknown as Json });
  const { data: ownerDeleteSig } = await owner.client.from("contract_signatures").delete().eq("id", sig1!.id).select("id");
  check(!!memberInsertSig && (ownerDeleteSig ?? []).length === 0, "nadie puede insertar ni borrar una firma desde el navegador");
  // Un contrato firmado por un contacto visible para el Member: sí lo ve.
  const memberLink = await signFormLink(svc, { workspaceId: ws.id, formId: kForm!.id, slug: contractSlug, contactId: contactVisible, baseUrl: "https://app.ejemplo.test" });
  const memberSigned = await sendContract({ nombre: "Del Member", email: "delmember.zz@example.test" }, sig({ link_token: new globalThis.URL(memberLink).searchParams.get("c") }));
  check(memberSigned.status === 200, "se firma un contrato con el link de un contacto del Member");
  check((await sigRows(member)).length === 1, "...y ESE si lo ve el Member (la RLS sigue a la respuesta)");

  // Versiones: publicar la 2 no toca la firma de la 1.
  const contractText2 = hashContractText("# Acuerdo de servicios\n\nTEXTO NUEVO de la version dos.");
  await svc.from("forms").update({ draft_definition: { fields: contractFields, contractText: contractText2.text } as unknown as Json }).eq("id", kForm!.id);
  await svc.rpc("publish_form_version", { p_form_id: kForm!.id, p_actor: owner.id });
  const { data: kVer2 } = await svc.from("forms").select("current_version_id").eq("id", kForm!.id).single();
  const v2Id = kVer2!.current_version_id!;
  const signedV2 = await sendContract({ nombre: "Beto Dos", email: "beto.zz@example.test" }, sig(), v2Id);
  const { data: sig2 } = await svc.from("contract_signatures").select("*").eq("submission_id", String(signedV2.body.submission_id)).single();
  check(sig2?.form_version_id === v2Id && sig2?.text_sha256 === contractText2.sha256, "una firma nueva toma la version 2 y su huella");
  const { data: sig1Again } = await svc.from("contract_signatures").select("form_version_id, text_sha256").eq("id", sig1!.id).single();
  check(sig1Again?.form_version_id === v1Id && sig1Again?.text_sha256 === contractText1.sha256, "la firma de la version 1 sigue con su version y su huella");
  const { data: sig2Job } = await svc.from("scheduled_jobs").select("id").eq("dedupe_key", `contract_pdf:${sig2!.id}`);
  for (const j of sig2Job ?? []) jobIds.push(j.id);

  // Huella corrupta: la firma falla y no queda NADA.
  await svc.from("form_versions").update({ contract_text: "texto adulterado" } as never).eq("id", v2Id);
  const beforeContacts = (await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count ?? 0;
  const beforeSigs = (await svc.from("contract_signatures").select("id", { count: "exact", head: true }).eq("form_id", kForm!.id)).count ?? 0;
  const corruptKey = randomUUID();
  const errorsMute = console.error;
  console.error = () => undefined;
  const corrupt = await sendContract({ nombre: "Carlos Corrupto", email: "corrupto.zz@example.test" }, sig({ idempotency_key: corruptKey }), v2Id);
  console.error = errorsMute;
  check(corrupt.status === 500, "con el texto de la version alterado, la firma falla (500 sin detalles)", String(corrupt.status));
  const { data: corruptRows } = await svc.from("form_submissions").select("id").eq("form_id", kForm!.id).eq("idempotency_key", corruptKey);
  check((corruptRows ?? []).length === 0, "...y la respuesta NO queda guardada");
  check(((await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id)).count ?? 0) === beforeContacts, "...ni se crea el contacto");
  check(((await svc.from("contract_signatures").select("id", { count: "exact", head: true }).eq("form_id", kForm!.id)).count ?? 0) === beforeSigs, "...ni la firma ni su job (todo en la misma transaccion)");
  const { data: leftover } = await svc.storage.from("contracts").download(`${ws.id}/${kForm!.id}/${corruptKey}/signature.png`);
  check(!leftover, "...y la imagen de la firma que se habia subido se descarta");
  await svc.from("form_versions").update({ contract_text: contractText2.text } as never).eq("id", v2Id);

  // El PDF, de verdad: con la base y el bucket reales, sin proveedores.
  console.log("\n— F27-F28: el PDF y el email (base y Storage reales; Resend simulado) —");
  const pdfDeps = { db: svc, businessName: () => "zz-test negocio" };
  const pdfResult = await runContractPdf(pdfDeps, sig1!.id);
  check(pdfResult === "generated", "el job genera el PDF de la firma", pdfResult);
  const { data: sig1Pdf } = await svc.from("contract_signatures").select("pdf_path, pdf_status, email_status").eq("id", sig1!.id).single();
  check(sig1Pdf?.pdf_status === "generated" && sig1Pdf?.pdf_path === `${ws.id}/${kForm!.id}/${sig1!.id}/contrato-v1.pdf`, "queda generated con la ruta contratos/{ws}/{form}/{firma}/contrato-v1.pdf", sig1Pdf?.pdf_path ?? "");
  if (sig1Pdf?.pdf_path) contractFiles.push(sig1Pdf.pdf_path);
  const { data: pdfBlob } = await svc.storage.from("contracts").download(String(sig1Pdf?.pdf_path));
  const pdfBytes = pdfBlob ? new Uint8Array(await pdfBlob.arrayBuffer()) : new Uint8Array();
  const pdfDoc = await getDocumentProxy(new Uint8Array(pdfBytes));
  const { text: pdfPages } = await extractText(pdfDoc, { mergePages: true });
  const pdfText = String(pdfPages);
  check(pdfText.includes("Acuerdo de servicios") && pdfText.includes("Ana Firma") && pdfText.includes(contractText1.sha256) && pdfText.includes("Versión 1"), "el PDF trae el titulo, el firmante, la huella del texto y 'Versión 1'");
  check(pdfText.includes("Segunda clausula con ñ y ¿acentos?") && pdfText.includes("203.0.113."), "...el texto con ñ y ¿, y los datos de aceptacion (con la IP)");
  const { data: emailJob } = await svc.from("scheduled_jobs").select("id, type, status").eq("dedupe_key", `contract_email:${sig1!.id}:0`);
  check(emailJob?.length === 1 && emailJob[0].type === "contract_email", "al generarse el PDF se encola contract_email");
  for (const j of emailJob ?? []) jobIds.push(j.id);
  const pdfAgain = await runContractPdf(pdfDeps, sig1!.id);
  check(pdfAgain === "already", "generar dos veces el PDF de una firma no lo repite");

  // Email simulado: el adjunto es el PDF.
  const sent: Array<Record<string, unknown>> = [];
  const okSend = async (params: Record<string, unknown>) => {
    sent.push(params);
    return { ok: true as const, id: "msg" };
  };
  const emailResult = await runContractEmail({ db: svc, send: okSend as never }, { signatureId: sig1!.id });
  check(emailResult === "sent", "el job de email manda la copia", emailResult);
  const attached = (sent[0]?.attachments as Array<{ filename: string; content: string }> | undefined)?.[0];
  check(!!attached && attached.filename === "contrato-acuerdo-de-servicios-v1.pdf" && Buffer.from(attached.content, "base64").equals(Buffer.from(pdfBytes)), "el adjunto es exactamente el PDF guardado");
  check(sent[0]?.to === "ana.firma@example.test" && sent[0]?.kind === "contract_copy" && sent[0]?.relatedEntityId === sig1!.id, "va al firmante, con kind contract_copy y la firma como entidad");
  const { data: sentRow } = await svc.from("contract_signatures").select("email_status, email_sent_at").eq("id", sig1!.id).single();
  check(sentRow?.email_status === "sent" && !!sentRow?.email_sent_at, "queda 'sent' con la hora");
  const resentAfter = await runContractEmail({ db: svc, send: okSend as never }, { signatureId: sig1!.id, attempt: 1 });
  check(resentAfter === "already" && sent.length === 1, "un reintento viejo no vuelve a mandar lo que ya salio");

  // Reintentos con la cola real: un fallo transitorio agenda el siguiente a +5 minutos.
  const secondPdf = await runContractPdf(pdfDeps, sig2!.id);
  check(secondPdf === "generated", "se genera tambien el PDF de la firma de la version 2");
  const { data: sig2Pdf } = await svc.from("contract_signatures").select("pdf_path").eq("id", sig2!.id).single();
  if (sig2Pdf?.pdf_path) contractFiles.push(sig2Pdf.pdf_path);
  const { data: sig2EmailJob } = await svc.from("scheduled_jobs").select("id").eq("dedupe_key", `contract_email:${sig2!.id}:0`);
  for (const j of sig2EmailJob ?? []) jobIds.push(j.id);
  const failing = async () => ({ ok: false as const, reason: "failed" as const, error: "Resend respondio 503: unavailable" });
  const retry1 = await runContractEmail({ db: svc, send: failing as never }, { signatureId: sig2!.id, attempt: 0 });
  const { data: retryRow } = await svc.from("contract_signatures").select("email_status, email_attempts, email_next_retry_at").eq("id", sig2!.id).single();
  check(retry1 === "retry_scheduled" && retryRow?.email_status === "retrying" && retryRow?.email_attempts === 1, "un fallo transitorio deja 'retrying' con un intento", JSON.stringify(retryRow));
  const minutes = (new Date(String(retryRow?.email_next_retry_at)).getTime() - Date.now()) / 60_000;
  check(minutes > 4 && minutes < 6, "el siguiente intento es en unos 5 minutos", String(minutes));
  const { data: retryJob } = await svc.from("scheduled_jobs").select("id, run_at, payload").eq("dedupe_key", `contract_email:${sig2!.id}:1`);
  check(retryJob?.length === 1 && (retryJob[0].payload as { attempt?: number }).attempt === 1, "existe el job de reintento con su clave y el numero de intento");
  for (const j of retryJob ?? []) jobIds.push(j.id);
  const permanent = async () => ({ ok: false as const, reason: "failed" as const, error: "Resend respondio 422: invalid to" });
  const retry2 = await runContractEmail({ db: svc, send: permanent as never }, { signatureId: sig2!.id, attempt: 1 });
  const { data: permRow } = await svc.from("contract_signatures").select("email_status, email_last_error").eq("id", sig2!.id).single();
  check(retry2 === "not_sent" && permRow?.email_status === "not_sent", "un fallo permanente queda 'not_sent' sin otro reintento");
  const { data: noMoreJobs } = await svc.from("scheduled_jobs").select("id").eq("dedupe_key", `contract_email:${sig2!.id}:2`);
  check((noMoreJobs ?? []).length === 0, "...y no se agenda ningun intento mas");

  // Ver el PDF con la sesion de quien mira: la RLS decide.
  const { data: ownerSees } = await owner.client.from("contract_signatures").select("id, pdf_path").eq("submission_id", String(signedOk.body.submission_id)).maybeSingle();
  const { data: blindSees } = await blind.client.from("contract_signatures").select("id").eq("submission_id", String(signedOk.body.submission_id)).maybeSingle();
  check(!!ownerSees?.pdf_path && !blindSees, "quien ve la respuesta obtiene la firma (y el link de su PDF); quien no la ve, nada");
  const { data: directPdf } = await member.client.storage.from("contracts").download(String(ownerSees?.pdf_path));
  check(!directPdf, "nadie baja un PDF directo del bucket (privado, sin policies)");

  // Limpieza propia de FO3: jobs de la cola y archivos del bucket.
  const oursByKey = await svc.from("scheduled_jobs").delete().or(`dedupe_key.like.contract_pdf:%,dedupe_key.like.contract_email:%`).in("id", jobIds).select("id");
  void oursByKey;
  if (contractFiles.length > 0) await svc.storage.from("contracts").remove(contractFiles);


  // ── FO4: el sitio, la atribucion persistente y los datos del anuncio ───────
  console.log("\n— F29-F33: formulario en una pagina del sitio y atribucion completa —");

  // La persona llego antes con ?utm_campaign=octubre (cookie ssa_attr); ahora esta en otra pagina SIN UTM.
  const storedCookie = parseStored(serializeStored(recordVisit({ v: 1 }, { utm_source: "facebook", utm_campaign: "octubre", landing_page: "https://app.ejemplo.test/promo?utm_campaign=octubre" }, Date.now() - 3600_000)));
  const siteAttribution = effectiveAttribution(attributionFromParams({}, { landing: "https://app.ejemplo.test/contacto", pageUrl: "https://app.ejemplo.test/contacto" }), storedCookie);
  check(siteAttribution.utm_campaign === "octubre" && siteAttribution.page_url === "https://app.ejemplo.test/contacto", "la atribucion efectiva usa el ultimo toque guardado cuando la URL no trae UTM");
  const siteSend = await send({ nombre: "Desde el Sitio", email: "sitio.zz@example.test" }, { origin: "site", site_path: "/servicios?x=1", attribution: siteAttribution });
  check(siteSend.status === 200, "un envio desde una pagina del sitio se guarda", JSON.stringify(siteSend.body));
  const siteRow = await rowOf(siteSend.body.submission_id);
  check((siteRow.meta as { origin?: string; site_path?: string }).origin === "site" && (siteRow.meta as { site_path?: string }).site_path === "/servicios", "meta.origin = 'site' y meta.site_path = la ruta limpia", JSON.stringify(siteRow.meta));
  check((siteRow.attribution as { utm_campaign?: string }).utm_campaign === "octubre", "attribution.utm_campaign = 'octubre' (de la cookie, sin UTM en la URL)");
  const { data: siteTouch } = await svc.from("contact_touches").select("campaign, origin, source").eq("contact_id", String(siteRow.contact_id));
  check(siteTouch?.length === 1 && siteTouch[0].campaign === "octubre" && siteTouch[0].origin === "form" && siteTouch[0].source === "facebook", "queda un toque con campaign 'octubre'", JSON.stringify(siteTouch));
  const { data: siteContact } = await svc.from("contacts").select("attribution").eq("id", String(siteRow.contact_id)).single();
  check((siteContact?.attribution as { first_touch?: { campaign?: string } })?.first_touch?.campaign === "octubre", "y es el primer toque del contacto nuevo");

  // Un envio fuera del sitio no lleva site_path aunque lo manden.
  const pageSend = await send({ nombre: "Pagina", email: "pagina.zz@example.test" }, { origin: "public_page", site_path: "/no-deberia" });
  check(!("site_path" in ((await rowOf(pageSend.body.submission_id)).meta as object)), "fuera del sitio, site_path no se guarda");

  // F33: todos los datos del anuncio llegan al toque.
  const adAttribution = attributionFromParams(new URLSearchParams("utm_source=facebook&fbclid=abc&msclkid=m1&gbraid=gb1&ad_id=77"), { landing: "https://app.ejemplo.test/?utm_source=facebook&fbclid=abc&msclkid=m1&gbraid=gb1&ad_id=77", pageUrl: "https://app.ejemplo.test/f/x", referrer: "https://www.google.com/", cookies: { _fbp: "fb.1.2.3" } });
  const adSend = await send({ nombre: "Del Anuncio", email: "anuncio.zz@example.test" }, { origin: "site", site_path: "/", attribution: adAttribution });
  const adRow = await rowOf(adSend.body.submission_id);
  const { data: adTouch } = await svc.from("contact_touches").select("fbclid, ad_id, referrer_url, landing_page, raw, source").eq("contact_id", String(adRow.contact_id)).single();
  const adRaw = (adTouch?.raw ?? {}) as Record<string, unknown>;
  check(adTouch?.fbclid === "abc" && adTouch?.ad_id === "77" && adTouch?.source === "facebook", "fbclid y ad_id van a sus columnas");
  check(adRaw.msclkid === "m1" && adRaw.gbraid === "gb1" && typeof adRaw.fbc === "string" && adRaw.fbc !== "" && adRaw.fbp === "fb.1.2.3" && adRaw.page_url === "https://app.ejemplo.test/f/x", "msclkid, gbraid, fbc, fbp y page_url quedan en raw", JSON.stringify(adRaw));
  check(adTouch?.referrer_url === "https://www.google.com/" && String(adTouch?.landing_page).includes("fbclid=abc"), "el referrer y la pagina de llegada van a sus columnas");
  check(!JSON.stringify(adRaw).includes("foo"), "raw sigue siendo una lista blanca");
  check((adRow.attribution as Record<string, string>).msclkid === "m1" && (adRow.attribution as Record<string, string>).gbraid === "gb1", "la respuesta guarda todos los datos del anuncio");

  // La vista y el inicio llevan el origen.
  const siteBeaconPorts = createBeaconPorts(svc);
  const siteSid = randomUUID();
  const siteBeaconIp = nextIp();
  const siteWrapped = { ...siteBeaconPorts, limit: async (spec: Parameters<typeof siteBeaconPorts.limit>[0]) => (usedLimitKeys.add(spec.key), siteBeaconPorts.limit(spec)) };
  await handleBeacon(siteWrapped, { slug: fo2Slug, ip: siteBeaconIp, body: { kind: "view", sid: siteSid, origin: "site" } });
  const { data: siteView } = await svc.from("analytics_events").select("metadata").eq("workspace_id", ws.id).eq("event_type", "form_view").filter("metadata->>form_id", "eq", fo2!.id).filter("metadata->>origin", "eq", "site");
  check((siteView ?? []).length === 1, "un form_view desde el sitio lleva origin: 'site' en su metadata");
  check(!JSON.stringify(siteView).includes(siteSid) && !JSON.stringify(siteView).includes(siteBeaconIp), "...sin el sid ni la IP");

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
    for (const name of ["forms_link_secret"]) {
      try {
        await deleteSecret(svc, w.id, name);
      } catch {
        // sin secreto no hay nada que borrar
      }
    }
  }
  if (uploaded.length > 0) await svc.storage.from("form-uploads").remove(uploaded);
  if (usedLimitKeys.size > 0) await svc.from("rate_limits").delete().in("key", [...usedLimitKeys]);
  void hashIp;
  const clean = await runCleanup(svc);
  if (!clean) failures++;
  // Los jobs de contratos que dejaron las firmas de prueba (su workspace ya no existe): se sacan de la cola.
  try {
    sql("delete from public.scheduled_jobs j where j.type in ('contract_pdf', 'contract_email') and not exists (select 1 from public.contract_signatures c where c.id::text = j.payload ->> 'signatureId')");
  } catch (error) {
    console.error("  no pude limpiar los jobs de contratos:", error instanceof Error ? error.message : error);
    failures++;
  }
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} falla(s)`);
process.exitCode = failures === 0 ? 0 : 1;
