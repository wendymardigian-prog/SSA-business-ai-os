#!/usr/bin/env node
// @plantilla-quitar(servicios)
/**
 * Verificacion del programa del portal y lo que cuelga de el (Servicios A1): bloques pr, ev, ca, ce, co e ia.
 *
 * Corre contra la base real con usuarios de verdad: gemelas SQL = TS con los mismos casos, la estructura del arbol
 * (PR001), lo que incluye cada variante, el desbloqueo por persona, el avance que completa modulos y pasos, la RLS por
 * rol y que un enganche que falla no tumbe lo que lo origina.
 *
 *   node scripts/verify-program.mjs                 todos los bloques que ya tienen su migracion
 *   node scripts/verify-program.mjs --bloque pr     uno
 *
 * El modulo se prende SOLO en el negocio de prueba (zz-test-). Crea y borra todo lo suyo. No se corre a la vez que
 * otro verify-*: candado /private/tmp/ssa-verify.lock.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { runCleanup } from "./test-cleanup.mjs";
import { dbTargetArgs } from "./lib/db-target.mjs";
import { checkProtectedFunctions } from "./protected-functions.mjs";

const execFileAsync = promisify(execFile);
const repoFile = (p) => new URL(`../${p}`, import.meta.url);
const json = (p) => JSON.parse(readFileSync(repoFile(p), "utf8"));

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const bloqueArg = process.argv.indexOf("--bloque");
const ONLY = bloqueArg >= 0 ? process.argv[bloqueArg + 1] : null;
const run = (b) => !ONLY || ONLY === b;

/** El bloque ce corre en TypeScript (emitir y completar el paso son código), con vite-node y el render SIMULADO. */
function runCe() {
  const { status } = spawnSync("npx", ["vite-node", "-c", "vitest.config.ts", "scripts/verify-program/verify-ce.ts"], { stdio: "inherit", env: { ...process.env, DESIGNER_FAKE_RENDER: "1" } });
  return status ?? 1;
}
if (ONLY === "ce") process.exit(runCe());

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
// Igualdad de valores JSON sin importar el orden de las claves (la base devuelve un jsonb con sus claves
// ordenadas a su manera; TypeScript, en el orden en que se escribieron).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;

// La CLI abre un rol temporal por consulta y, con muchas seguidas, a veces no se puede conectar con el
// (SASL 28P01, "failed to connect as temp role"). Eso no es un resultado de la prueba: se reintenta.
const TRANSIENT = /failed to connect as temp role|SQLSTATE 28P01|failed SASL auth|connection reset|ECONNRESET|timeout expired|unexpected status 50[234]|upstream connect error|ETIMEDOUT|SIGTERM/i;
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function sql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 90_000 });
      return JSON.parse(out).rows ?? [];
    } catch (e) {
      const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
      if (attempt >= 5 || !TRANSIENT.test(text)) throw e;
      sleepSync(2000 * attempt);
    }
  }
}
/** Como sql(), pero si falla anota la falla con el error completo y devuelve null (no corta la verificacion). */
function sqlErrOrRows(query, label) {
  try {
    return sql(query);
  } catch (e) {
    fail(`${label}: la consulta fallo`, `${e.stderr ?? ""}${e.stdout ?? ""}`.replace(/\s+/g, " ").slice(0, 600));
    return null;
  }
}
function sqlErr(query) {
  try {
    sql(query);
    return null;
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
  }
}
async function sqlAsync(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await execFileAsync("supabase", ["db", "query", ...dbTargetArgs(), query], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 90_000 });
      return JSON.parse(stdout).rows ?? [];
    } catch (e) {
      const text = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`;
      if (attempt >= 5 || !TRANSIENT.test(text)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
/**
 * La consulta como una fila jsonb. Una que escribe (WITH x AS (UPDATE/INSERT ... RETURNING) SELECT ...) no puede ir
 * adentro de una subconsulta: el SELECT final se envuelve y el WITH queda arriba.
 */
function wrapForJson(query) {
  const q = query.trim();
  if (/^WITH\b/i.test(q)) {
    const at = q.lastIndexOf(") SELECT ");
    if (at > 0) return `${q.slice(0, at + 1)} SELECT to_jsonb(t) FROM (${q.slice(at + 2)}) t`;
  }
  return `SELECT to_jsonb(t) FROM (${q}) t`;
}
/** Una consulta con la sesion de un usuario (rol authenticated + su JWT), en una transaccion que se deshace. */
function asUser(uid, query) {
  const claims = JSON.stringify({ sub: uid, role: "authenticated" });
  const body = `DO $do$ DECLARE r jsonb; BEGIN
    PERFORM set_config('request.jwt.claims', ${lit(claims)}, true);
    PERFORM set_config('request.jwt.claim.sub', ${lit(uid)}, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE ${lit(wrapForJson(query))} INTO r;
    RAISE EXCEPTION 'RESULTADO: %', COALESCE(r::text, 'null');
  END $do$;`;
  const text = sqlErr(body) ?? "";
  const m = text.match(/RESULTADO: (\{.*?\}|null)(?=\\n|"|\n|$)/s);
  if (m) return { ok: true, row: m[1] === "null" ? null : JSON.parse(m[1].replace(/\\"/g, '"')) };
  const code = text.match(/\(SQLSTATE ([A-Z0-9]{5})\)/)?.[1] ?? text.match(/ERROR: +([A-Z0-9]{5})/)?.[1] ?? null;
  return { ok: false, error: text.slice(0, 400), code };
}

/** Llama una funcion del modulo con la sesion de la persona, por la API (como la app). Devuelve { data, error }. */
async function rpcAs(user, fn, args) {
  const { data, error } = await user.client.schema("app_servicio").rpc(fn, args);
  return { data, error: error ? `${error.code ?? ""} ${error.message}` : null };
}

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  // Una sesion de verdad para lo que tiene que QUEDAR guardado (asUser deshace todo al final).
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude iniciar sesion con ${tag}: ${e.message}`);
  return { id: data.user.id, email, client };
}

const hoy = new Date().toISOString().slice(0, 10);
const hasTable = (t) => sql(`SELECT to_regclass(${lit(t)}) IS NOT NULL ok`)[0]?.ok === true;

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-programa", slug: `zz-test-programa-${Date.now()}`, timezone: "America/Costa_Rica" }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const owner = await makeUser("pr-owner");
  const member = await makeUser("pr-member");
  const roleNone = await makeUser("pr-role-none");
  const { data: rNone } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Sin servicios", permissions: { keys: ["contacts.view"], scopes: {} } }).select("id").single();
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: ws.id, user_id: roleNone.id, role: "member", role_id: rNone.id },
  ]);
  sql(`SELECT app_servicio.set_module_enabled(${lit(ws.id)}, true)`);
  const { data: prod } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Programa", product_type: "programa" }).select("id").single();
  const mkVariant = async (name) => (await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prod.id, name, price: 1000, duration_type: "months", duration_value: 3 }).select("id").single()).data;
  const newContact = async (t) => (await svc.from("contacts").insert({ workspace_id: ws.id, display_name: `zz-test ${t}`, email: `zz-test-${t.replace(/\s/g, "-")}-${Date.now()}@example.test` }).select("id").single()).data;
  const item = (kind, title, parent = null, extra = {}) =>
    sql(`INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, status, unlock_rule)
         VALUES (${lit(ws.id)}, ${lit(prod.id)}, ${parent ? lit(parent) : "NULL"}, ${lit(kind)}, ${kind === "lesson" ? lit(extra.lesson_type ?? "video") : "NULL"}, ${lit(title)},
                 ${lit(extra.status ?? "active")}, ${jlit(extra.rule ?? { type: "open" })}) RETURNING id`)[0]?.id;

  const mkService = (contactId, variantId) => sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(contactId)}, 'variant_id', ${lit(variantId)}, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', ${lit(member.id)})) id`)[0]?.id;

  if (run("pr")) {
    console.log("\npr · Casos compartidos (gemela del desbloqueo)");
    const { cases } = json("lib/program/unlock.cases.json");
    const got = sql(`SELECT jsonb_build_array(${cases.map((c) => `app_servicio.program_unlock_plan(${jlit(c.input)})`).join(", ")}) AS r`)[0]?.r ?? [];
    const bad = cases.filter((c, i) => !eq(got[i], c.expected)).map((c, i) => `${c.name}: ${JSON.stringify(got[cases.indexOf(c)])}`);
    check(bad.length === 0, `program_unlock_plan: los ${cases.length} casos dan lo mismo que en TypeScript`, bad.slice(0, 3).join(" | "));

    console.log("\npr · El árbol (F45, PR001)");
    const created = await rpcAs(owner, "program_create_item", { p_product_id: prod.id, p: { kind: "module", title: "zz-test Nuevo" } });
    check(!created.error && sql(`SELECT status FROM app_servicio.program_items WHERE id = ${lit(created.data)}`)[0]?.status === "inactive", "lo nuevo nace inactivo", created.error);
    const m1 = item("module", "Módulo 1", null, { rule: { type: "journey_item", locked_text: "Se abre al terminar Onboarding" } });
    const l1 = item("lesson", "Clase 1", m1);
    const bad1 = sqlErr(`INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title) VALUES (${lit(ws.id)}, ${lit(prod.id)}, ${lit(l1)}, 'lesson', 'video', 'zz-test mal')`);
    check(/PR001/.test(bad1 ?? ""), "colgar una clase de otra clase se rechaza (PR001)", bad1?.slice(0, 200));
    const byMember = asUser(member.id, `SELECT app_servicio.program_create_item(${lit(prod.id)}, '{"kind":"module","title":"x"}'::jsonb) r`);
    check(!byMember.ok && /SV004|permiso/.test(byMember.error), "un Member no edita el contenido (program.manage)", byMember.error);
    const reads = (uid) => asUser(uid, `SELECT count(*)::int n FROM app_servicio.program_items WHERE product_id = ${lit(prod.id)}`);
    check(reads(member.id).row?.n >= 2, "el Member (services.view) lee el árbol");
    check(reads(roleNone.id).row?.n === 0, "un rol sin servicios ni programa no lee nada");

    console.log("\npr · Desbloqueo por persona y contenido por variante (F47, F100, F101)");
    const m2 = item("module", "Módulo 2");
    const l2 = item("lesson", "Clase 2", m2);
    const vFull = await mkVariant("zz-test Completa");
    const vLight = await mkVariant("zz-test Light");
    sql(`UPDATE public.product_variants SET portal_settings = ${jlit({ v: 1, enabled: true, sections: [{ section: "program", included: true, content: { modules: "all" } }] })} WHERE id = ${lit(vFull.id)}`);
    sql(`UPDATE public.product_variants SET portal_settings = ${jlit({ v: 1, enabled: true, sections: [{ section: "program", included: true, content: { modules: [m1] } }] })} WHERE id = ${lit(vLight.id)}`);
    const cA = await newContact("estudiante a");
    const sA = mkService(cA.id, vFull.id);
    const unlocked = (c, i) => sql(`SELECT app_servicio.program_item_unlocked(${lit(c)}, ${lit(i)}) r`)[0]?.r;
    const before = unlocked(cA.id, l1);
    check(before?.unlocked === false && before?.visible === true && before?.reason === "Se abre al terminar Onboarding", "antes del paso, la clase del módulo bloqueado se ve con candado", JSON.stringify(before));
    sql(`SELECT app_servicio.svc_open_module(${lit(sA)}, ${lit(m1)}, 'journey_item')`);
    check(unlocked(cA.id, l1)?.unlocked === true, "al abrirlo el camino, se abre para esa persona");
    sql(`SELECT app_servicio.svc_open_module(${lit(sA)}, ${lit(m1)}, 'journey_item')`);
    check(sql(`SELECT count(*)::int n FROM app_servicio_portal.program_progress WHERE contact_id = ${lit(cA.id)} AND program_item_id = ${lit(m1)}`)[0]?.n === 1, "abrir dos veces no duplica");
    const cB = await newContact("estudiante b");
    mkService(cB.id, vLight.id);
    check(unlocked(cB.id, l1)?.unlocked === false, "una automatización o un paso abre para una persona y no para otras");
    check(unlocked(cB.id, l2)?.included === false, "la variante light no incluye el módulo 2 (no se ve)", JSON.stringify(unlocked(cB.id, l2)));
    mkService(cB.id, vFull.id);
    check(unlocked(cB.id, l2)?.included === true, "con la completa también, vale la unión: ve el módulo 2");

    console.log("\npr · El avance completa módulos y pasos (F48, F19)");
    const events = (type) => sql(`SELECT count(*)::int n FROM public.automation_events WHERE workspace_id = ${lit(ws.id)} AND event_type = ${lit(type)} AND contact_id = ${lit(cA.id)}`)[0]?.n;
    const progress = (itemId, extra = "") => sql(`INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, viewed_at, completed_at) VALUES (${lit(ws.id)}, ${lit(cA.id)}, ${lit(itemId)}, now(), now())
      ON CONFLICT (contact_id, program_item_id) DO UPDATE SET completed_at = COALESCE(app_servicio_portal.program_progress.completed_at, now()) ${extra} RETURNING id`);
    progress(l2);
    progress(l2);
    check(sql(`SELECT count(*)::int n FROM app_servicio_portal.program_progress WHERE contact_id = ${lit(cA.id)} AND program_item_id = ${lit(l2)}`)[0]?.n === 1, "la misma clase dos veces: una fila");
    check(sql(`SELECT completed_at IS NOT NULL ok FROM app_servicio_portal.program_progress WHERE contact_id = ${lit(cA.id)} AND program_item_id = ${lit(m2)}`)[0]?.ok === true, "completar la última clase activa completa el módulo");
    check(events("program_module_completed") === 1 && events("program_lesson_completed") >= 1, "y emite un solo program_module_completed", `${events("program_module_completed")} / ${events("program_lesson_completed")}`);
    const lInactive = item("lesson", "Clase inactiva", m1, { status: "inactive" });
    void lInactive;
    progress(l1);
    check(sql(`SELECT completed_at IS NOT NULL ok FROM app_servicio_portal.program_progress WHERE contact_id = ${lit(cA.id)} AND program_item_id = ${lit(m1)}`)[0]?.ok === true, "lo inactivo no cuenta: el módulo 1 se completa con su clase activa");

    console.log("\npr · Un fallo del enganche no tumba el avance");
    const l3 = item("lesson", "Clase 3", m2);
    const forced = sqlErr(`DO $$ DECLARE n int; a int; BEGIN
      ALTER FUNCTION app_servicio.svc_apply_access_event(uuid, text, text) RENAME TO zz_svc_apply_access_event_off;
      ALTER FUNCTION app_servicio.emit(app_servicio.services, text, jsonb) RENAME TO zz_emit_off;
      INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, completed_at) VALUES (${lit(ws.id)}, ${lit(cA.id)}, ${lit(l3)}, now());
      SELECT count(*) INTO n FROM app_servicio_portal.program_progress WHERE program_item_id = ${lit(l3)};
      SELECT count(*) INTO a FROM public.audit_log WHERE entity_id = ${lit(cA.id)} AND action = 'svc.hook_failed';
      RAISE EXCEPTION 'RESULTADO: % %', n, a;
    END $$`);
    check(/RESULTADO: 1 [1-9]/.test(forced ?? ""), "el avance se guarda igual y queda svc.hook_failed (y todo se deshace)", forced?.slice(0, 300));

    console.log("\npr · Archivar conserva el avance");
    sql(`SELECT app_servicio.program_set_status(${lit(m2)}, 'archived')`);
    check(unlocked(cA.id, l2)?.visible === false, "un módulo archivado no se ve");
    check(sql(`SELECT count(*)::int n FROM app_servicio_portal.program_progress WHERE program_item_id = ${lit(l2)}`)[0]?.n === 1, "y su avance sigue guardado");
  }

  if (run("ev") && hasTable("public.form_submissions") && sql(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'form_submissions' AND column_name = 'review_status'`)[0]?.n === 1) {
    console.log("\nev · Casos compartidos (nota, calificación y términos)");
    const runList = (list, label, toSql, expected) => {
      const got = sql(`SELECT jsonb_build_array(${list.map((c) => `to_jsonb(${toSql(c)})`).join(", ")}) AS r`)[0]?.r ?? [];
      const bad = list.filter((c, i) => !eq(got[i], expected(c))).map((c) => c.name);
      check(bad.length === 0, `${label}: los ${list.length} casos dan lo mismo que en TypeScript`, bad.slice(0, 3).join(" | "));
    };
    runList(json("lib/program/quiz-grade.cases.json").cases, "quiz_grade_plan", (c) => `app_servicio.quiz_grade_plan(${jlit({ settings: c.settings, answers: c.answers, attempt: c.attempt })})`, (c) => c.expected);
    runList(json("lib/program/grading.cases.json").cases, "grading_passed", (c) => `app_servicio.grading_passed(${lit(c.scale)}, ${jlit(c.value)}, ${c.passAt === null ? "NULL" : jlit(c.passAt)})`, (c) => c.expected);
    runList(json("lib/program/terms.cases.json").cases, "portal_terms_plan", (c) => `app_servicio.portal_terms_plan(${jlit(c.input)})`, (c) => c.expected);

    console.log("\nev · Tipos del portal (F52)");
    const noProduct = sqlErr(`INSERT INTO public.forms (workspace_id, name, type, slug) VALUES (${lit(ws.id)}, 'zz-test quiz', 'quiz', 'zz-test-quiz-sin-${Date.now()}')`);
    check(/forms_portal_product_check|check/i.test(noProduct ?? ""), "una evaluación sin programa se rechaza", noProduct?.slice(0, 160));
    const mkForm = (type, def) => {
      const f = sql(`INSERT INTO public.forms (workspace_id, name, type, slug, product_id, status) VALUES (${lit(ws.id)}, ${lit(`zz-test ${type}`)}, ${lit(type)}, ${lit(`zz-test-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)}, ${lit(prod.id)}, 'published') RETURNING id`)[0]?.id;
      const v = sql(`INSERT INTO public.form_versions (workspace_id, form_id, version_number, definition) VALUES (${lit(ws.id)}, ${lit(f)}, 1, ${jlit(def)}) RETURNING id`)[0]?.id;
      return { f, v };
    };
    const quizDef = { fields: [{ id: "q1", key: "q1", type: "single_select", label: "¿2+2?", required: true, options: ["3", "4"] }], quiz: { pass_pct: 70, attempts: 2, questions: { q1: { points: 1, correct: ["4"] } } } };
    const quiz = mkForm("quiz", quizDef);
    const activity = mkForm("activity", { fields: [{ id: "t", key: "t", type: "long_text", label: "Tu plan", required: true }], grading: { enabled: true, scale: "stars", pass_at: 3 } });
    const vEv = await mkVariant("zz-test Evaluaciones");
    sql(`UPDATE public.product_variants SET journey_template = ${jlit({ v: 1, phases: [{ key: "ph_evalu1", name: "Evaluar", advance: "manual", items: [
      { key: "it_evalu1", kind: "quiz", name: "Examen", ref: { form_id: quiz.f, complete_on: "passed" } },
      { key: "it_evalu2", kind: "activity", name: "Plan", ref: { form_id: activity.f, complete_on: "reviewed" } },
    ] }] })}, journey_template_rev = journey_template_rev + 1 WHERE id = ${lit(vEv.id)}`);
    const cE = await newContact("evaluado");
    const sE = mkService(cE.id, vEv.id);
    const itemStatus = (k) => sql(`SELECT status FROM app_servicio.service_items WHERE service_id = ${lit(sE)} AND template_key = ${lit(k)}`)[0]?.status;
    const submit = (form, answers) => sql(`INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id)
      VALUES (${lit(ws.id)}, ${lit(form.f)}, ${lit(form.v)}, gen_random_uuid(), 'received', ${jlit(answers)}, ${lit(cE.id)}) RETURNING id, grade, attempt, review_status, context`)[0];

    console.log("\nev · La nota la calcula la base (F54)");
    const s1 = submit(quiz, { q1: "3" });
    check(s1?.review_status === "graded" && s1?.attempt === 1 && s1?.grade?.passed === false && s1?.context === "portal", "primer intento mal: nota guardada, no aprobó", JSON.stringify(s1));
    check(itemStatus("it_evalu1") === "pending", "el paso «al aprobar» no se completa");
    const s2 = submit(quiz, { q1: "4" });
    check(s2?.attempt === 2 && s2?.grade?.passed === true && s2?.grade?.counted === true, "segundo intento bien: aprobó", JSON.stringify(s2));
    check(itemStatus("it_evalu1") === "completed", "y el paso se completa");
    const s3 = submit(quiz, { q1: "4" });
    check(s3?.attempt === 3 && s3?.grade?.counted === false, "pasados los intentos se guarda con counted = false");
    const forced = sqlErr(`DO $$ DECLARE r record; BEGIN
      ALTER FUNCTION app_servicio.quiz_grade_plan(jsonb) RENAME TO zz_quiz_grade_plan_off;
      INSERT INTO public.form_submissions (workspace_id, form_id, form_version_id, idempotency_key, status, answers, contact_id)
        VALUES (${lit(ws.id)}, ${lit(quiz.f)}, ${lit(quiz.v)}, gen_random_uuid(), 'received', '{"q1":"4"}'::jsonb, ${lit(cE.id)}) RETURNING id, grade INTO r;
      RAISE EXCEPTION 'RESULTADO: % %', r.id IS NOT NULL, r.grade IS NULL;
    END $$`);
    check(/RESULTADO: t t/.test(forced ?? ""), "si la nota falla, la respuesta se guarda igual (y todo se deshace)", forced?.slice(0, 300));

    console.log("\nev · La actividad y su revisión (F55, F56)");
    const a1 = submit(activity, { t: "Mi plan" });
    check(a1?.review_status === "pending" && a1?.grade === null, "una actividad entra pendiente de revisión");
    const byMember = asUser(member.id, `SELECT app_servicio.submission_review(${lit(a1.id)}, 'reviewed', '4'::jsonb, 'bien', 'nota') r`);
    check(!byMember.ok && /SV004|permiso/.test(byMember.error), "sin submissions.review no se revisa", byMember.error);
    const outOfScale = asUser(owner.id, `SELECT app_servicio.submission_review(${lit(a1.id)}, 'reviewed', '7'::jsonb, 'x', NULL) r`);
    check(!outOfScale.ok && /EV001/.test(outOfScale.error), "un valor fuera de la escala se rechaza (EV001)", outOfScale.error);
    const reviewed = await rpcAs(owner, "submission_review", { p_submission_id: a1.id, p_status: "reviewed", p_grade_value: 4, p_comment: "¡Muy bien!", p_internal_note: "solo equipo" });
    const row = sql(`SELECT review_status, grade, internal_note, review_comment FROM public.form_submissions WHERE id = ${lit(a1.id)}`)[0];
    check(!reviewed.error && row?.review_status === "reviewed" && row?.grade?.passed === true && row?.internal_note === "solo equipo", "el Owner la califica: la base calcula si aprobó", reviewed.error ?? JSON.stringify(row));
    check(itemStatus("it_evalu2") === "completed", "y el paso «al quedar revisada» se completa");
    check(sql(`SELECT count(*)::int n FROM public.automation_events WHERE contact_id = ${lit(cE.id)} AND event_type = 'task_submission_reviewed'`)[0]?.n >= 1, "emite task_submission_reviewed");

    console.log("\nev · Términos al entrar (F113)");
    const terms = mkForm("terms", { fields: [{ id: "c1", key: "c1", type: "consent", label: "Me comprometo", required: true }] });
    sql(`UPDATE public.products SET portal_settings = jsonb_set(portal_settings, '{terms}', ${jlit({ enabled: true, form_id: terms.f, ask_again_on_change: true })}) WHERE id = ${lit(prod.id)}`);
    const pendingTerms = () => sql(`SELECT app_servicio.portal_terms_pending(${lit(cE.id)}, ${lit(prod.id)}) p`)[0]?.p;
    check(pendingTerms() === true, "con los términos prendidos y sin aceptar, están pendientes");
    submit(terms, { c1: true });
    submit(terms, { c1: true });
    check(pendingTerms() === false, "al aceptarlos dejan de estarlo (aceptar dos veces no cambia nada)");
    sql(`INSERT INTO public.form_versions (workspace_id, form_id, version_number, definition) VALUES (${lit(ws.id)}, ${lit(terms.f)}, 2, '{"fields":[]}'::jsonb)`);
    check(pendingTerms() === true, "una versión nueva con «pedirlos de nuevo» los vuelve a pedir");
    sql(`UPDATE public.product_variants SET portal_settings = jsonb_set(COALESCE(portal_settings, '{}'::jsonb), '{ask_terms}', 'false'::jsonb) WHERE id = ${lit(vEv.id)}`);
    check(pendingTerms() === false, "si su variante no los pide, no están pendientes");
  }

  if (run("ca") && hasTable("app_servicio.live_sessions")) {
    console.log("\nca · Casos compartidos (fechas, ventana y base)");
    const occ = json("lib/program/occurrences.cases.json").cases;
    const gotOcc = sql(`SELECT jsonb_build_array(${occ.map((c) => `app_servicio.live_occurrences_plan(${jlit({ session: c.session, exceptions: c.exceptions, from: c.from, to: c.to })})`).join(", ")}) AS r`)[0]?.r ?? [];
    const badOcc = occ.filter((c, i) => !eq(gotOcc[i], c.expected)).map((c) => `${c.name}: ${JSON.stringify(gotOcc[occ.indexOf(c)]).slice(0, 200)}`);
    check(badOcc.length === 0, `live_occurrences_plan: los ${occ.length} casos dan lo mismo que en TypeScript`, badOcc.slice(0, 2).join(" | "));
    const win = json("lib/program/attendance-window.cases.json").cases;
    const gotWin = sql(`SELECT jsonb_build_array(${win.map((c) => `app_servicio.live_attendance_window(${lit(c.startsAt)}::timestamptz, ${lit(c.endsAt)}::timestamptz, ${lit(c.at)}::timestamptz)`).join(", ")}) AS r`)[0]?.r ?? [];
    check(win.every((c, i) => gotWin[i] === c.expected), `live_attendance_window: los ${win.length} casos dan lo mismo que en TypeScript`, JSON.stringify(gotWin));
    const bc = json("lib/program/attendance-base.cases.json").cases;
    const gotBase = sql(`SELECT jsonb_build_array(${bc.map((c) => `app_servicio.attendance_base_plan(${jlit({ base: c.base, sessionVariantIds: c.sessionVariantIds, member: c.member, occursOn: c.occursOn })})`).join(", ")}) AS r`)[0]?.r ?? [];
    const badBase = bc.filter((c, i) => gotBase[i] !== c.expected).map((c) => c.name);
    check(badBase.length === 0, `attendance_base_plan: los ${bc.length} casos dan lo mismo que en TypeScript`, badBase.join(" | "));

    console.log("\nca · Sesiones (F58, F59)");
    const shape = sqlErr(`INSERT INTO app_servicio.live_sessions (workspace_id, product_id, title, kind, timezone) VALUES (${lit(ws.id)}, ${lit(prod.id)}, 'zz-test mal', 'weekly', 'UTC')`);
    check(/live_sessions_shape_check/.test(shape ?? ""), "una semanal sin días ni hora se rechaza (CHECK de forma)", shape?.slice(0, 160));
    const badBase2 = sqlErr(`INSERT INTO app_servicio.live_sessions (workspace_id, product_id, title, kind, single_at, timezone, attendance_base) VALUES (${lit(ws.id)}, ${lit(prod.id)}, 'zz-test', 'single', now(), 'UTC', '{"type":"started_within","days":0}'::jsonb)`);
    check(/live_sessions_base_check/.test(badBase2 ?? ""), "una base de asistencia inválida se rechaza", badBase2?.slice(0, 160));
    const weekly = { title: "zz-test Martes en vivo", kind: "weekly", weekdays: [2], every_weeks: 1, starts_on: "2026-09-01", start_time: "19:00", duration_minutes: 60, timezone: "America/Costa_Rica", meeting_url: "https://meet.example.test/abc" };
    const byMember = asUser(member.id, `SELECT app_servicio.live_session_save(${lit(prod.id)}, NULL, ${jlit(weekly)}) r`);
    check(!byMember.ok && /SV004|permiso/.test(byMember.error), "un Member no crea sesiones (live_sessions.manage)", byMember.error);
    const saved = await rpcAs(owner, "live_session_save", { p_product_id: prod.id, p_session_id: null, p: weekly });
    const sid = saved.data;
    check(!saved.error && !!sid, "el Owner crea una sesión semanal", saved.error);
    const occs = await rpcAs(owner, "live_session_occurrences", { p_product_id: prod.id, p_from: "2026-11-01", p_to: "2026-11-30" });
    check(!occs.error && occs.data?.length === 4 && occs.data[0].starts_at.startsWith("2026-11-04T01:00:00"), "las 19:00 de Costa Rica son las 01:00 UTC del día siguiente, cuatro martes en noviembre", JSON.stringify(occs.data?.[0] ?? occs.error));
    const meetRead = asUser(owner.id, `SELECT meeting_url FROM app_servicio.live_sessions WHERE id = ${lit(sid)}`);
    check(!meetRead.ok && /42501|permission/.test(meetRead.error), "el link de la reunión no se lee con la sesión (solo el servidor)", meetRead.error?.slice(0, 120));
    check(asUser(roleNone.id, `SELECT count(*)::int n FROM app_servicio.live_sessions WHERE product_id = ${lit(prod.id)}`).row?.n === 0, "un rol sin servicios ni portal no ve las sesiones");
    const cancel = await rpcAs(owner, "live_date_save", { p_live_session_id: sid, p_occurs_on: "2026-11-10", p: { status: "cancelled" } });
    const move = await rpcAs(owner, "live_date_save", { p_live_session_id: sid, p_occurs_on: "2026-11-17", p: { status: "moved", moved_to: "2026-11-19T01:00:00Z" } });
    const after = (await rpcAs(owner, "live_session_occurrences", { p_product_id: prod.id, p_from: "2026-11-01", p_to: "2026-11-30" })).data ?? [];
    check(!cancel.error && !move.error && after.find((o) => o.occurs_on === "2026-11-10")?.status === "cancelled" && after.find((o) => o.occurs_on === "2026-11-17")?.starts_at.startsWith("2026-11-19T01:00"), "cancelar y mover una fecha: la movida conserva su fecha original", JSON.stringify(after.map((o) => [o.occurs_on, o.status, o.starts_at])));
    check(sql(`SELECT count(*)::int n FROM app_servicio.live_session_dates WHERE live_session_id = ${lit(sid)}`)[0]?.n === 2, "solo se guardan las excepciones (nunca las fechas futuras)");

    console.log("\nca · Asistencia (F61)");
    sql(`UPDATE public.products SET portal_enabled = true WHERE id = ${lit(prod.id)}`);
    const vCal = await mkVariant("zz-test Calendario");
    const cS = await newContact("asiste");
    const sS = mkService(cS.id, vCal.id);
    sql(`SELECT app_servicio.svc_open_access(${lit(sS)}, 'calendar', NULL, 'automation')`);
    const day = "2026-11-03";
    const baseNow = sql(`SELECT coalesce(jsonb_agg(contact_id), '[]'::jsonb) b FROM app_servicio.attendance_base_members(${lit(sid)}, ${lit(hoy)}::date)`)[0]?.b ?? [];
    check(baseNow.includes(cS.id), "con acceso al calendario, el estudiante está en la base de la sesión", JSON.stringify(baseNow));
    const markMember = asUser(member.id, `SELECT app_servicio.attendance_mark(${lit(sid)}, ${lit(hoy)}::date, ${lit(cS.id)}, 'team') r`);
    check(!markMember.ok && /SV004|permiso/.test(markMember.error), "sin attendance.manage no se marca", markMember.error);
    const m1 = await rpcAs(owner, "attendance_mark", { p_live_session_id: sid, p_occurs_on: hoy, p_contact_id: cS.id, p_source: "click" });
    const m2 = await rpcAs(owner, "attendance_mark", { p_live_session_id: sid, p_occurs_on: hoy, p_contact_id: cS.id, p_source: "team" });
    const rowA = sql(`SELECT source, added_manually FROM app_servicio_portal.live_attendance WHERE id = ${lit(m1.data)}`)[0];
    check(!m1.error && m1.data === m2.data && rowA?.source === "team" && rowA?.added_manually === false, "marcar dos veces deja una sola; una persona siempre marca «team»", JSON.stringify(rowA ?? m1.error));
    const outsider = await newContact("fuera de la base");
    const mo = await rpcAs(owner, "attendance_mark", { p_live_session_id: sid, p_occurs_on: hoy, p_contact_id: outsider.id });
    check(sql(`SELECT added_manually FROM app_servicio_portal.live_attendance WHERE id = ${lit(mo.data)}`)[0]?.added_manually === true, "alguien fuera de la base queda «agregado a mano»");
    const sheet = (await rpcAs(owner, "live_session_attendance", { p_live_session_id: sid, p_occurs_on: hoy })).data;
    check(sheet?.base?.includes(cS.id) && !sheet?.base?.includes(outsider.id) && sheet?.attended?.length === 2, "la ficha separa la base de quienes asistieron");
    const noReason = asUser(owner.id, `SELECT app_servicio.attendance_remove(${lit(mo.data)}, '  ') r`);
    check(!noReason.ok && /CA001|motivo/.test(noReason.error), "quitar sin motivo se rechaza", noReason.error);
    const removed = await rpcAs(owner, "attendance_remove", { p_attendance_id: mo.data, p_reason: "zz-test se marcó por error" });
    check(!removed.error && sql(`SELECT removed_at IS NOT NULL r FROM app_servicio_portal.live_attendance WHERE id = ${lit(mo.data)}`)[0]?.r === true, "quitar con motivo deja la marca de quitada", removed.error);
    check(sql(`SELECT count(*)::int n FROM public.audit_log WHERE workspace_id = ${lit(ws.id)} AND action IN ('attendance.marked', 'attendance.removed')`)[0]?.n >= 3, "marcar y quitar quedan en el historial");
    const dup = sqlErr(`INSERT INTO app_servicio_portal.live_attendance (workspace_id, live_session_id, occurs_on, contact_id, source) VALUES (${lit(ws.id)}, ${lit(sid)}, ${lit(hoy)}, ${lit(cS.id)}, 'self')`);
    check(/uq_live_attendance|duplicate/.test(dup ?? ""), "una sola asistencia viva por sesión, fecha y persona (índice único)");
    const ipPlain = sqlErr(`INSERT INTO app_servicio.link_clicks (workspace_id, target_type, target_id, target_date, contact_id, ip_hash) VALUES (${lit(ws.id)}, 'live_session', ${lit(sid)}, ${lit(day)}, ${lit(cS.id)}, '1.2.3.4')`);
    check(/link_clicks_ip_hash_check/.test(ipPlain ?? ""), "un clic no guarda la IP en claro (solo su huella)");

    console.log("\nca · Grabaciones (F63, F51)");
    const manual = await rpcAs(owner, "live_date_save", { p_live_session_id: sid, p_occurs_on: day, p: { recording_url: "https://video.example.test/r1", recording_source: "manual" } });
    sql(`SELECT app_servicio.live_date_save(${lit(sid)}, ${lit(day)}::date, '{"recording_url":"https://otra.example.test/x","recording_source":"fathom"}'::jsonb)`);
    check(!manual.error && sql(`SELECT recording_url FROM app_servicio.live_session_dates WHERE live_session_id = ${lit(sid)} AND occurs_on = ${lit(day)}`)[0]?.recording_url === "https://video.example.test/r1", "lo que carga una persona no lo pisa un proceso automático", manual.error);
    const otherCall = await rpcAs(owner, "live_date_save", { p_live_session_id: sid, p_occurs_on: day, p: { recording_call_id: randomUUID() } });
    check(/CA002|No existe/.test(otherCall.error ?? ""), "una grabación que no es del negocio se rechaza", otherCall.error);
    const recs = sql(`SELECT count(*)::int n FROM app_servicio.program_live_recordings(${lit(prod.id)})`)[0]?.n;
    check(recs === 1, "«Sesiones semanales» del portal lista la fecha con grabación", String(recs));
    sql(`SELECT app_servicio.live_date_save(${lit(sid)}, ${lit(day)}::date, '{"recording_active":false}'::jsonb)`);
    check(sql(`SELECT count(*)::int n FROM app_servicio.program_live_recordings(${lit(prod.id)})`)[0]?.n === 0, "apagar «Activa en el portal» la saca de la lista");
    const overview = await rpcAs(owner, "live_attendance_overview", { p_product_id: prod.id, p_from: "2026-10-01", p_to: hoy });
    check(!overview.error && Array.isArray(overview.data) && overview.data.every((d) => d.status !== "cancelled" && Date.parse(d.starts_at) <= Date.now()), "la asistencia del período solo trae fechas pasadas y no canceladas", overview.error);
    const tooLong = await rpcAs(owner, "live_attendance_overview", { p_product_id: prod.id, p_from: "2026-01-01", p_to: hoy });
    check(/CA001|120/.test(tooLong.error ?? ""), "el período es de hasta 120 días", tooLong.error);

    console.log("\nca · El tipo «Clase» (F64)");
    const dupClase = sql(`SELECT count(*)::int n FROM (SELECT workspace_id FROM public.booking_categories WHERE system_key = 'servicio.clase' GROUP BY 1 HAVING count(*) > 1) x`)[0]?.n;
    check(dupClase === 0, "ningún negocio tiene dos «Clase»", String(dupClase));
    const mine = sql(`SELECT count(*)::int n FROM public.booking_categories c JOIN public.booking_categories a ON a.id = c.parent_id
                       WHERE c.workspace_id = ${lit(ws.id)} AND c.system_key = 'servicio.clase' AND a.system_key = 'servicio'`)[0]?.n;
    check(mine === 1, "al prender el módulo, el negocio recibe un «Clase» colgado del área Servicio", String(mine));
    const { data: wsOff } = await svc.from("workspaces").insert({ name: "zz-test-sin-modulo", slug: `zz-test-sin-modulo-${Date.now()}`, timezone: "UTC" }).select("id").single();
    check(sql(`SELECT count(*)::int n FROM public.booking_categories WHERE workspace_id = ${lit(wsOff.id)} AND system_key = 'servicio.clase'`)[0]?.n === 0, "un negocio nuevo con el módulo apagado nace igual que antes (sin «Clase»)");
  }

  console.log("\nHuellas de las funciones protegidas");
  checkProtectedFunctions(sql, check);
} catch (e) {
  fail("el script fallo", e instanceof Error ? e.stack?.split("\n").slice(0, 3).join(" | ") : String(e));
} finally {
  const cleanupOk = await runCleanup(svc);
  if (!cleanupOk) failures++;
}

if (!ONLY) {
  console.log("\nce · Certificados (vite-node)");
  if (runCe() !== 0) failures++;
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
