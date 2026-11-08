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

  if (run("co") && hasTable("app_servicio_portal.community_posts")) {
    console.log("\nco · Casos compartidos (quién puede publicar)");
    const cc = json("lib/program/community.cases.json").cases;
    const gotCc = sql(`SELECT jsonb_build_array(${cc.map((c) => `app_servicio.community_can_post_plan(${jlit(c.input)})`).join(", ")}) AS r`)[0]?.r ?? [];
    const badCc = cc.filter((c, i) => !eq(gotCc[i], c.expected)).map((c) => c.name);
    check(badCc.length === 0, `community_can_post_plan: los ${cc.length} casos dan lo mismo que en TypeScript`, badCc.join(" | "));

    console.log("\nco · Tablas (F76)");
    const vCo = await mkVariant("zz-test Comunidad");
    sql(`UPDATE public.product_variants SET portal_settings = ${jlit({ v: 1, enabled: true, sections: [{ section: "program", included: true, content: { modules: "all" } }, { section: "community", included: true }] })} WHERE id = ${lit(vCo.id)}`);
    const student = await newContact("comunidad");
    const sCo = mkService(student.id, vCo.id);
    sql(`SELECT app_servicio.svc_open_access(${lit(sCo)}, 'community', NULL, 'automation')`);
    sql(`SELECT app_servicio.svc_open_access(${lit(sCo)}, 'program', NULL, 'automation')`);
    const post = (cols) => sql(`INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, parent_id, program_item_id, author_contact_id, author_user_id, as_business, body, created_at)
      VALUES (${lit(ws.id)}, ${lit(prod.id)}, ${lit(cols.space ?? "general")}, ${cols.parent ? lit(cols.parent) : "NULL"}, ${cols.item ? lit(cols.item) : "NULL"}, ${cols.contact ? lit(cols.contact) : "NULL"},
              ${cols.user ? lit(cols.user) : "NULL"}, ${cols.business ? "true" : "false"}, ${lit(cols.body ?? "zz-test")}, ${lit(cols.at ?? new Date().toISOString())}) RETURNING id`)[0]?.id;
    const both = sqlErr(`INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, author_contact_id, author_user_id, body) VALUES (${lit(ws.id)}, ${lit(prod.id)}, 'general', ${lit(student.id)}, ${lit(owner.id)}, 'x')`);
    check(/community_posts_author_check/.test(both ?? ""), "un post es de un contacto O del equipo, nunca de los dos (CHECK)");
    const top = post({ contact: student.id, body: "zz-test hola" });
    const child = post({ parent: top, user: owner.id });
    const grand = sqlErr(`INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, parent_id, author_contact_id, body) VALUES (${lit(ws.id)}, ${lit(prod.id)}, 'general', ${lit(child)}, ${lit(student.id)}, 'x')`);
    check(/CO001/.test(grand ?? ""), "un comentario de un comentario se rechaza (CO001)", grand?.slice(0, 160));
    const noItem = sqlErr(`INSERT INTO app_servicio_portal.community_posts (workspace_id, product_id, space_key, author_contact_id, body) VALUES (${lit(ws.id)}, ${lit(prod.id)}, 'clases', ${lit(student.id)}, 'x')`);
    check(/community_posts_lesson_check/.test(noItem ?? ""), "un post del espacio «clases» necesita su clase");

    console.log("\nco · Quién puede publicar (F77, F111)");
    const can = (c, space, item = null) => sql(`SELECT app_servicio.community_can_post(${c ? lit(c) : "NULL"}, ${lit(prod.id)}, ${lit(space)}, ${item ? lit(item) : "NULL"}) ok`)[0]?.ok;
    check(can(student.id, "general") === true, "un estudiante con acceso publica en General");
    check(can(student.id, "anuncios") === false, "en Anuncios publica solo el equipo");
    const outsider = await newContact("sin comunidad");
    check(can(outsider.id, "general") === false, "sin acceso a la comunidad no publica");
    sql(`SELECT app_servicio.svc_open_access(${lit(sCo)}, 'community', NULL, 'automation')`);
    const muteByMember = asUser(member.id, `SELECT app_servicio.community_set_muted(${lit(prod.id)}, ${lit(student.id)}, true, 'x') r`);
    check(!muteByMember.ok && /SV004|permiso/.test(muteByMember.error), "sin community.moderate no se silencia", muteByMember.error);
    const muted = await rpcAs(owner, "community_set_muted", { p_product_id: prod.id, p_contact_id: student.id, p_muted: true, p_reason: "zz-test" });
    check(!muted.error && can(student.id, "general") === false, "un silenciado no publica (community_can_post)", muted.error);
    await rpcAs(owner, "community_set_muted", { p_product_id: prod.id, p_contact_id: student.id, p_muted: false });
    const mOpen = item("module", "zz-test Módulo comunidad");
    const lOpen = item("lesson", "zz-test Clase abierta", mOpen);
    const mLocked = item("module", "zz-test Módulo cerrado", null, { rule: { type: "fixed_date", date: "2099-01-01" } });
    const lLocked = item("lesson", "zz-test Clase cerrada", mLocked, { rule: { type: "fixed_date", date: "2099-01-01" } });
    check(can(student.id, "clases", lOpen) === true, "comenta una clase que tiene abierta");
    check(can(student.id, "clases", lLocked) === false, "un comentario en una clase que no tiene abierta se rechaza");
    sql(`UPDATE app_servicio.program_items SET comments_enabled = false WHERE id = ${lit(lOpen)}`);
    check(can(student.id, "clases", lOpen) === false && can(null, "clases", lOpen) === false, "con los comentarios apagados en la clase, nadie comenta");
    sql(`UPDATE app_servicio.program_items SET comments_enabled = true, status = 'inactive' WHERE id = ${lit(lOpen)}`);
    check(can(student.id, "clases", lOpen) === false, "una clase inactiva no se comenta");
    sql(`UPDATE app_servicio.program_items SET status = 'active' WHERE id = ${lit(lOpen)}`);

    console.log("\nco · Sin contestar (F77, F111)");
    const before = sql(`SELECT app_servicio.community_unanswered(${lit(prod.id)}, 30) n`)[0]?.n;
    post({ user: owner.id, body: "zz-test del equipo" });
    const answered = post({ contact: student.id, body: "zz-test contestado" });
    post({ parent: answered, business: true, body: "zz-test respuesta" });
    post({ contact: student.id, body: "zz-test viejo", at: new Date(Date.now() - 40 * 86_400_000).toISOString() });
    const open = post({ contact: student.id, body: "zz-test sin contestar" });
    post({ contact: student.id, space: "clases", item: lOpen, body: "zz-test comentario de clase" });
    const after = sql(`SELECT app_servicio.community_unanswered(${lit(prod.id)}, 30) n`)[0]?.n;
    check(after - before === 2, "cuenta solo los posts de estudiantes sin respuesta del equipo (incluidos los de las clases)", `${before} → ${after}`);
    const counts = (await rpcAs(owner, "community_item_counts", { p_product_id: prod.id })).data;
    check(counts?.unanswered === after && counts?.by_item?.[lOpen] === 1, "los contadores coinciden con «sin contestar» y separan por clase", JSON.stringify(counts));
    const seen = await rpcAs(owner, "community_mark_seen", { p_post_id: open });
    check(!seen.error && sql(`SELECT app_servicio.community_unanswered(${lit(prod.id)}, 30) n`)[0]?.n === after - 1, "«Marcar como visto» lo saca de sin contestar", seen.error);
    const feed = (await rpcAs(owner, "community_feed", { p_product_id: prod.id, p: { filter: "unanswered" } })).data ?? [];
    check(feed.length === after - 1 && feed.every((x) => x.unanswered), "el filtro «Sin contestar» de la pantalla es la misma consulta", String(feed.length));

    console.log("\nco · El equipo (permisos)");
    const byMember = asUser(member.id, `SELECT app_servicio.community_team_post(${lit(prod.id)}, '{"body":"x","space_key":"general"}'::jsonb) r`);
    check(!byMember.ok && /SV004|permiso/.test(byMember.error), "sin community.reply no se publica", byMember.error);
    const reply = await rpcAs(owner, "community_team_post", { p_product_id: prod.id, p: { body: "zz-test respuesta del equipo", parent_id: top, as_business: true } });
    check(!reply.error && sql(`SELECT app_servicio.community_is_unanswered(${lit(top)}) u`)[0]?.u === false, "responder un post lo saca de sin contestar", reply.error);
    const hideNoReason = asUser(owner.id, `SELECT app_servicio.community_moderate(${lit(top)}, 'hide', NULL) r`);
    check(!hideNoReason.ok && /CO002|motivo/.test(hideNoReason.error), "ocultar sin motivo se rechaza");
    const roleNoneFeed = asUser(roleNone.id, `SELECT app_servicio.community_feed(${lit(prod.id)}, '{}'::jsonb) r`);
    check(!roleNoneFeed.ok, "un rol sin community.view no lee la comunidad");
    check(sql(`SELECT has_schema_privilege('authenticated', 'app_servicio_portal', 'USAGE') u`)[0]?.u === false, "el esquema del portal sigue cerrado para la sesión");
  }

  if (run("ia") && sql(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'tutor_agent_id'`)[0]?.n === 1) {
    console.log("\nia · Casos compartidos (límites y créditos)");
    const ac = json("lib/program/assistant.cases.json").cases;
    const gotAc = sql(`SELECT jsonb_build_array(${ac.map((c) => `app_servicio.assistant_credits_plan(${jlit(c.input)})`).join(", ")}) AS r`)[0]?.r ?? [];
    const badAc = ac.filter((c, i) => !eq(gotAc[i], c.expected)).map((c, i) => `${c.name}: ${JSON.stringify(gotAc[ac.indexOf(c)])}`);
    check(badAc.length === 0, `assistant_credits_plan: los ${ac.length} casos dan lo mismo que en TypeScript`, badAc.slice(0, 2).join(" | "));

    console.log("\nia · El tutor del programa (F83, F84)");
    const { data: prodT } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Programa tutor", product_type: "programa" }).select("id").single();
    const t1 = await rpcAs(owner, "program_ensure_tutor", { p_product_id: prodT.id });
    const t2 = await rpcAs(owner, "program_ensure_tutor", { p_product_id: prodT.id });
    const agentRow = sql(`SELECT type, monthly_cost_limit_action, config ->> 'program_id' AS program, knowledge_tags FROM public.agents WHERE id = ${lit(t1.data)}`)[0];
    check(!t1.error && t1.data === t2.data, "prender dos veces crea un solo tutor", t1.error ?? t2.error);
    check(agentRow?.type === "student_tutor" && agentRow?.monthly_cost_limit_action === "notify" && agentRow?.program === prodT.id, "nace como tutor del programa con el tope mensual en «avisar»", JSON.stringify(agentRow));
    const memberEnsure = asUser(member.id, `SELECT app_servicio.program_ensure_tutor(${lit(prodT.id)}) r`);
    check(!memberEnsure.ok && /SV004|permiso/.test(memberEnsure.error), "un Member no crea tutores", memberEnsure.error);
    const tamper = asUser(owner.id, `WITH u AS (UPDATE public.products SET tutor_agent_id = NULL WHERE id = ${lit(prodT.id)} RETURNING id) SELECT count(*) n FROM u`);
    check(!tamper.ok && /SV003/.test(tamper.error), "con la sesión no se cambia el tutor de un programa (SV003)", tamper.error);
    const moveProgram = asUser(owner.id, `WITH u AS (UPDATE public.agents SET config = jsonb_set(config, '{program_id}', '"otro"') WHERE id = ${lit(t1.data)} RETURNING id) SELECT count(*) n FROM u`);
    check(!moveProgram.ok && /SV003/.test(moveProgram.error), "el programa de un tutor no se cambia (SV003)", moveProgram.error);
    const { data: prodT2 } = await svc.from("products").insert({ workspace_id: ws.id, name: "zz-test Otro programa", product_type: "programa" }).select("id").single();
    const twice = sqlErr(`UPDATE public.products SET tutor_agent_id = ${lit(t1.data)} WHERE id = ${lit(prodT2.id)}`);
    check(/uq_products_tutor_agent|duplicate/.test(twice ?? ""), "el mismo agente en dos programas se rechaza (índice único)");
    await rpcAs(owner, "program_ensure_tutor", { p_product_id: prodT2.id });
    const noReplace = await rpcAs(owner, "program_duplicate_tutor", { p_agent_id: t1.data, p_dest_product_id: prodT2.id, p_replace: false });
    check(/IA001/.test(noReplace.error ?? ""), "duplicar a un programa con tutor pide reemplazarlo (IA001)", noReplace.error);
    const oldTutor = sql(`SELECT tutor_agent_id FROM public.products WHERE id = ${lit(prodT2.id)}`)[0]?.tutor_agent_id;
    const dup = await rpcAs(owner, "program_duplicate_tutor", { p_agent_id: t1.data, p_dest_product_id: prodT2.id, p_replace: true });
    const after = sql(`SELECT (SELECT tutor_agent_id FROM public.products WHERE id = ${lit(prodT2.id)}) AS now, (SELECT deleted_at IS NOT NULL FROM public.agents WHERE id = ${lit(oldTutor)}) AS archived`)[0];
    check(!dup.error && after?.now === dup.data && after?.archived === true, "duplicar con reemplazo archiva el anterior y apunta al nuevo", dup.error ?? JSON.stringify(after));
    await rpcAs(owner, "program_tutor_set_enabled", { p_product_id: prodT.id, p_enabled: false });
    check(sql(`SELECT is_enabled FROM public.agents WHERE id = ${lit(t1.data)}`)[0]?.is_enabled === false, "apagar el Asistente IA deja el tutor inactivo");
    await rpcAs(owner, "program_tutor_set_enabled", { p_product_id: prodT.id, p_enabled: true });

    console.log("\nia · Lo que puede usar el tutor (F83, F110)");
    sql(`UPDATE public.products SET portal_settings = '{"sections":{"program":true}}'::jsonb WHERE id = ${lit(prodT.id)}`);
    const vT = (await svc.from("product_variants").insert({ workspace_id: ws.id, product_id: prodT.id, name: "zz-test Tutor", price: 1000, duration_type: "months", duration_value: 3 }).select("id").single()).data;
    sql(`UPDATE public.product_variants SET portal_settings = ${jlit({ v: 1, enabled: true, sections: [{ section: "program", included: true, content: { modules: "all" } }, { section: "assistant", included: true }] })} WHERE id = ${lit(vT.id)}`);
    const itemT = (kind, title, parent = null, extra = {}) =>
      sql(`INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, status, unlock_rule)
           VALUES (${lit(ws.id)}, ${lit(prodT.id)}, ${parent ? lit(parent) : "NULL"}, ${lit(kind)}, ${kind === "lesson" ? lit(extra.lesson_type ?? "video") : "NULL"}, ${lit(title)}, 'active', ${jlit(extra.rule ?? { type: "open" })}) RETURNING id`)[0]?.id;
    const mA = itemT("module", "zz-test Módulo abierto");
    const lA = itemT("lesson", "zz-test Clase abierta", mA);
    const mL = itemT("module", "zz-test Módulo 5", null, { rule: { type: "fixed_date", date: "2099-01-01" } });
    const lL = itemT("lesson", "zz-test Clase 5", mL, { rule: { type: "fixed_date", date: "2099-01-01" } });
    const lQ = itemT("lesson", "zz-test Evaluación", mA, { lesson_type: "quiz" });
    itemT("lesson", "zz-test Video sin transcripción", mA);
    const kb = (title, extra = {}) => sql(`INSERT INTO public.knowledge_base (workspace_id, title, tags, status, internal_only, program_item_id)
      VALUES (${lit(ws.id)}, ${lit(title)}, ${extra.tags === false ? "'{}'" : `ARRAY['programa:${prodT.id}']`}::text[], 'ready', ${extra.internal ? "true" : "false"}, ${extra.item ? lit(extra.item) : "NULL"}) RETURNING id`)[0]?.id;
    const kA = kb("zz-test transcripción abierta", { item: lA });
    const kL = kb("zz-test transcripción clase 5", { item: lL });
    const kQ = kb("zz-test evaluación", { item: lQ });
    const kDoc = kb("zz-test documento del programa");
    const kInternal = kb("zz-test documento interno", { internal: true });
    const kOther = kb("zz-test documento suelto", { tags: false });
    const cT = await newContact("estudiante tutor");
    const sT = mkService(cT.id, vT.id);
    sql(`SELECT app_servicio.svc_open_access(${lit(sT)}, 'program', NULL, 'automation')`);
    const ids = (c) => (sql(`SELECT coalesce(jsonb_agg(knowledge_id), '[]'::jsonb) k FROM app_servicio.tutor_knowledge_ids(${c ? lit(c) : "NULL"}, ${lit(prodT.id)})`)[0]?.k ?? []);
    const forStudent = ids(cT.id);
    check(forStudent.includes(kA) && forStudent.includes(kDoc), "el estudiante tiene la clase abierta y los documentos del programa", JSON.stringify(forStudent));
    check(!forStudent.includes(kL), "con la clase 5 bloqueada, su transcripción no está para ese estudiante");
    check(!forStudent.includes(kQ) && !ids(null).includes(kQ), "una evaluación nunca");
    check(!ids(null).includes(kInternal) && !ids(null).includes(kOther), "nunca un documento interno ni uno de otro lado");
    const listT = (await rpcAs(owner, "tutor_knowledge_list", { p_product_id: prodT.id })).data;
    const listIds = [...(listT?.lessons ?? []).map((l) => l.knowledge_id).filter(Boolean), ...(listT?.documents ?? []).map((d) => d.knowledge_id)].sort();
    check(eq(listIds, [...ids(null)].sort()), "la lista del equipo coincide con lo que puede devolver la búsqueda del tutor", JSON.stringify({ listIds, search: ids(null) }));
    check(!(listT?.lessons ?? []).some((l) => l.item_id === lQ), "la evaluación no aparece en la lista");
    const missing = (listT?.lessons ?? []).filter((l) => l.lesson_type === "video" && !l.knowledge_id).length;
    const missingSql = sql(`SELECT count(*)::int n FROM app_servicio.program_items i WHERE i.product_id = ${lit(prodT.id)} AND i.kind = 'lesson' AND i.lesson_type = 'video' AND i.status <> 'archived'
                            AND NOT EXISTS (SELECT 1 FROM public.knowledge_base k WHERE k.program_item_id = i.id AND k.deleted_at IS NULL)`)[0]?.n;
    check(missing === 1 && missing === missingSql, "«Falta transcripción» cuenta los videos sin fila en Conocimiento", `${missing} / ${missingSql}`);
    const excl = await rpcAs(owner, "tutor_set_excluded", { p_product_id: prodT.id, p_knowledge_id: kDoc, p_excluded: true });
    check(!excl.error && !ids(cT.id).includes(kDoc) && !ids(null).includes(kDoc), "un material excluido no lo usa el tutor (y no se borra)", excl.error);
    check(sql(`SELECT count(*)::int n FROM public.knowledge_base WHERE id = ${lit(kDoc)} AND deleted_at IS NULL`)[0]?.n === 1, "…sigue en Conocimiento");
    const addInternal = await rpcAs(owner, "tutor_add_document", { p_product_id: prodT2.id, p_knowledge_id: kInternal });
    check(/IA001/.test(addInternal.error ?? ""), "«Agregar desde Conocimiento» rechaza un documento interno");

    console.log("\nia · Gasto y créditos (F85)");
    const tutorId = t1.data;
    sql(`INSERT INTO public.agent_runs (workspace_id, source, agent_id, contact_id, trigger, status, cost_usd, created_at) VALUES
         (${lit(ws.id)}, 'portal_tutor', ${lit(tutorId)}, ${lit(cT.id)}, 'manual', 'completed', 3, now()),
         (${lit(ws.id)}, 'portal_tutor', ${lit(tutorId)}, ${lit(cT.id)}, 'manual', 'completed', 50, now() - interval '40 days')`);
    check(Number(sql(`SELECT app_servicio.assistant_month_spend(${lit(cT.id)}, ${lit(tutorId)}) s`)[0]?.s) === 3, "el gasto es el del mes (lo del mes pasado no cuenta)");
    sql(`UPDATE public.products SET portal_settings = jsonb_set(portal_settings, '{assistant}', '{"monthly_limit_usd_per_student":5,"credits_per_usd":100}'::jsonb) WHERE id = ${lit(prodT.id)}`);
    check(Number(sql(`SELECT app_servicio.assistant_credits(${lit(cT.id)}, ${lit(prodT.id)}) c`)[0]?.c) === 200, "créditos = (límite − gasto) × créditos por dólar");
    const usageOwner = (await rpcAs(owner, "assistant_usage", { p_product_id: prodT.id })).data;
    const usageMember = (await rpcAs(member, "assistant_usage", { p_product_id: prodT.id })).data;
    check(usageOwner?.students?.[0]?.spent_usd === 3 && usageMember?.money === false && usageMember?.students?.[0]?.spent_usd === null, "el uso lo ve quien ve servicios; los montos, solo con ai_costs.view", JSON.stringify({ o: usageOwner?.students?.[0], m: usageMember?.students?.[0] }));

    console.log("\nia · Conversaciones del canal portal (F87)");
    sql(`INSERT INTO public.ai_threads (workspace_id, channel, agent_id, contact_id, subject_type, subject_id, title) VALUES (${lit(ws.id)}, 'portal', ${lit(tutorId)}, ${lit(cT.id)}, 'product', ${lit(prodT.id)}, 'zz-test hilo')`);
    const seesOwner = asUser(owner.id, `SELECT count(*)::int n FROM public.ai_threads WHERE contact_id = ${lit(cT.id)} AND channel = 'portal'`).row?.n;
    // El Member de sistema ve solo sus contactos (setter, vendedor o asignado): este no es suyo.
    const seesNone = asUser(member.id, `SELECT count(*)::int n FROM public.ai_threads WHERE contact_id = ${lit(cT.id)} AND channel = 'portal'`).row?.n;
    check(seesOwner === 1 && seesNone === 0, "una conversación del portal la lee quien ve el contacto", `${seesOwner} / ${seesNone}`);
  }

  if (run("x") && sql(`SELECT to_regprocedure('app_servicio.merge_contacts_hook(uuid,uuid)') IS NOT NULL ok`)[0]?.ok === true) {
    console.log("\nx · Fusión de contactos con datos del módulo (F89)");
    const vX = await mkVariant("zz-test Fusión");
    sql(`UPDATE public.product_variants SET portal_settings = ${jlit({ v: 1, enabled: true, sections: [{ section: "program", included: true, content: { modules: "all" } }] })} WHERE id = ${lit(vX.id)}`);
    const main = await newContact("principal");
    const dupC = await newContact("duplicado");
    const sMain = mkService(main.id, vX.id);
    const sDup = mkService(dupC.id, vX.id);
    const accMain = sql(`SELECT app_servicio.svc_ensure_portal_account(${lit(ws.id)}, ${lit(main.id)}) id`)[0]?.id;
    const accDup = sql(`SELECT app_servicio.svc_ensure_portal_account(${lit(ws.id)}, ${lit(dupC.id)}) id`)[0]?.id;
    sql(`INSERT INTO app_servicio_portal.portal_sessions (workspace_id, account_id, kind, token_hash, expires_at) VALUES (${lit(ws.id)}, ${lit(accDup)}, 'student', ${lit(createHash("sha256").update(randomUUID()).digest("hex"))}, now() + interval '1 day')`);
    const mX = item("module", "zz-test Módulo fusión");
    const lX = item("lesson", "zz-test Clase fusión", mX);
    sql(`INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, viewed_at, completed_at) VALUES
         (${lit(ws.id)}, ${lit(main.id)}, ${lit(lX)}, now(), now()),
         (${lit(ws.id)}, ${lit(dupC.id)}, ${lit(lX)}, now() - interval '5 days', now() - interval '5 days')`);
    const merged = sql(`SELECT public.merge_contacts(${lit(ws.id)}, ${lit(main.id)}, ${lit(dupC.id)}, ${lit(owner.id)}) r`)[0]?.r;
    check(merged?.ok === true && merged?.moved?.services === 1, "merge_contacts llama al gancho del módulo en la misma transacción", JSON.stringify(merged?.moved ?? merged));
    check(sql(`SELECT count(*)::int n FROM app_servicio.services WHERE contact_id = ${lit(main.id)} AND id IN (${lit(sMain)}, ${lit(sDup)})`)[0]?.n === 2, "los dos servicios quedan en el principal");
    check(sql(`SELECT count(*)::int n FROM public.notifications WHERE workspace_id = ${lit(ws.id)} AND type = 'svc_merge_two_services'`)[0]?.n >= 1, "dos servicios activos del mismo producto: se avisa");
    const accs = sql(`SELECT (SELECT status FROM app_servicio_portal.portal_accounts WHERE id = ${lit(accDup)}) AS dup_status,
                             (SELECT contact_id FROM app_servicio_portal.portal_accounts WHERE id = ${lit(accMain)}) AS main_contact,
                             (SELECT bool_and(revoked_at IS NOT NULL) FROM app_servicio_portal.portal_sessions WHERE account_id = ${lit(accDup)}) AS revoked`)[0];
    check(accs?.dup_status === "suspended" && accs?.main_contact === main.id && accs?.revoked === true, "dos cuentas del portal: queda la del principal y se revocan las sesiones de la otra", JSON.stringify(accs));
    const prog = sql(`SELECT count(*)::int n, min(completed_at) < now() - interval '4 days' AS oldest FROM app_servicio_portal.program_progress WHERE program_item_id = ${lit(lX)}`)[0];
    check(prog?.n === 1 && prog?.oldest === true, "avance repetido: una fila, con la fecha más vieja", JSON.stringify(prog));

    console.log("\nx · El barrido diario (F88)");
    sql(`UPDATE app_servicio.service_items SET due_on = app_servicio.today_in(${lit(ws.id)}) - 2 WHERE id = (SELECT id FROM app_servicio.service_items WHERE service_id = ${lit(sMain)} AND status = 'pending' AND NOT is_recurring_template LIMIT 1)`);
    const run1 = sql(`SELECT app_servicio.svc_daily_run(${lit(ws.id)}) r`)[0]?.r;
    const run2 = sql(`SELECT app_servicio.svc_daily_run(${lit(ws.id)}) r`)[0]?.r;
    check(Array.isArray(run1?.errors) && run1.errors.length === 0, "corre todos los pasos sin errores", JSON.stringify(run1));
    check(run2?.items_overdue === 0 && run2?.started === 0 && run2?.missed === 0 && (run2?.errors ?? []).length === 0, "dos veces el mismo día no duplica nada", JSON.stringify({ run1, run2 }));
    const enq1 = sql(`SELECT private.enqueue_svc_daily(now() + interval '1 day') n`)[0]?.n;
    const enq2 = sql(`SELECT private.enqueue_svc_daily(now() + interval '1 day') n`)[0]?.n;
    check(enq1 >= 1 && enq2 === 0, "encola uno por día y por negocio con el módulo prendido", `${enq1} / ${enq2}`);
    sql(`DELETE FROM public.scheduled_jobs WHERE type = 'svc_daily' AND payload ->> 'workspace_id' = ${lit(ws.id)}`);

    console.log("\nx · Emitir el certificado al llegar al paso (F67)");
    const { data: tplX } = await svc.from("design_templates").insert({ workspace_id: ws.id, name: "zz-test certificado x", format: "carta_h", doc: { v: 1, format: "carta_h", pages: [{ id: "pg_test0001", background: { type: "color", color: "#ffffff" }, elements: [] }] }, origin: "blank", doc_type: "certificado" }).select("id").single();
    check(!!tplX?.id, "se crea la plantilla de certificado de prueba");
    const vCert = await mkVariant("zz-test Certificado solo");
    sql(`UPDATE public.product_variants SET journey_template = ${jlit({ v: 1, phases: [{ key: "ph_certx1", name: "Cierre", advance: "manual", items: [{ key: "it_certx1", kind: "certificate", name: "Certificado", ref: { template_id: tplX?.id, auto_issue: true } }] }] })},
         journey_template_rev = journey_template_rev + 1 WHERE id = ${lit(vCert.id)}`);
    const cCert = await newContact("certificado solo");
    const sCert = mkService(cCert.id, vCert.id);
    check(sql(`SELECT count(*)::int n FROM public.scheduled_jobs WHERE type = 'svc_certificate_issue' AND payload ->> 'service_id' = ${lit(sCert)}`)[0]?.n === 1, "al abrirse la fase, el paso Certificado con «Emitirlo solo» encola la emisión");
    sql(`DELETE FROM public.scheduled_jobs WHERE type = 'svc_certificate_issue' AND payload ->> 'service_id' = ${lit(sCert)}`);

    console.log("\nx · Límite propio del asistente (F85) y métricas de las cards (F108)");
    const vAs = await mkVariant("zz-test Asistente");
    sql(`UPDATE public.products SET portal_settings = jsonb_set(COALESCE(portal_settings, '{}'::jsonb), '{sections}', COALESCE(portal_settings -> 'sections', '{}'::jsonb) || '{"assistant":true}'::jsonb) WHERE id = ${lit(prod.id)}`);
    const cAs = await newContact("asistente");
    const sAs = mkService(cAs.id, vAs.id);
    sql(`SELECT app_servicio.svc_open_access(${lit(sAs)}, 'assistant', NULL, 'automation')`);
    const byMemberLimit = asUser(member.id, `SELECT app_servicio.assistant_set_own_limit(${lit(sAs)}, 7) r`);
    check(!byMemberLimit.ok && /SV004|permiso/.test(byMemberLimit.error), "sin tutor.manage no se cambia el límite propio", byMemberLimit.error);
    const setLimit = await rpcAs(owner, "assistant_set_own_limit", { p_service_id: sAs, p_limit_usd: 7 });
    const detail = sql(`SELECT app_servicio.assistant_credits_detail(${lit(cAs.id)}, ${lit(prod.id)}) d`)[0]?.d;
    check(!setLimit.error && Number(detail?.limitUsd) === 7, "el límite propio le gana al del programa", setLimit.error ?? JSON.stringify(detail));
    const metrics = (await rpcAs(owner, "program_card_metrics", { p_product_ids: [prod.id], p_days: 7 })).data;
    const m = metrics?.[prod.id];
    check(m && m.days === 7 && ["new_students", "lessons_completed", "to_review", "to_grade", "certificates", "community_posts", "attendance_pct", "inactive_14d"].every((k) => k in m), "las cards tienen sus 8 números en una consulta", JSON.stringify(m));
    const metricsNone = asUser(roleNone.id, `SELECT app_servicio.program_card_metrics(ARRAY[${lit(prod.id)}]::uuid[], 30) r`);
    check(!metricsNone.ok, "sin services.view ni program.manage no se leen");
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
