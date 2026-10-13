#!/usr/bin/env node
/**
 * Verificacion de la regla unica "buscar o crear contacto" (Contactos: regla unica) contra la base real.
 *
 * Prueba lo que vitest NO puede:
 *   1. Que NINGUNA funcion de la base, salvo `find_or_create_contact`, inserta en `public.contacts`.
 *   2. Los mismos casos de `lib/contacts/identity.cases.json` contra `private.contact_normalize_identity`
 *      (la gemela SQL de `normalizeIdentity`) y `public.normalize_phone` contra `normalizePhone`.
 *   3. La regla central: crear, encontrar por cada dato, conflictos, `find_only`, sin datos, normalizacion.
 *   4. La concurrencia: 10 llamadas en paralelo con el mismo telefono y 10 con el mismo email (en
 *      mayusculas y minusculas distintas) dan UN contacto cada vez.
 *   5. Los envoltorios (`find_contact_for_form`, `find_contact_by_phone_or_email`) y los caminos que ya
 *      usan la regla (`find_or_link_contact`, `create_booking`, `submit_form_response`), cuando estan aplicados.
 *   6. Los indices unicos de la 00205 (si no estan aplicados, se ensayan dentro de una transaccion que se
 *      deshace sola).
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que falla es una prueba que falla.
 * No correrlo en paralelo con otro verify-*.
 *
 *   node scripts/verify-contacts-single-entry.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

/** SQL directo con la CLI (funciones de `private`, catalogo, y pruebas dentro de una transaccion que se deshace). */
function sql(query) {
  const dir = mkdtempSync(join(tmpdir(), "verify-contacts-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, query);
  const out = execFileSync("supabase", ["db", "query", "--linked", "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  const start = out.indexOf("{");
  return JSON.parse(out.slice(start)).rows ?? [];
}

const stamp = Date.now();
const num = (n) => `+5069${String(stamp).slice(-4)}${String(n).padStart(4, "0")}`; // +5069 XXXX NNNN (11 digitos)

async function central(ws, identity, defaults = {}, mode = "create", allow = false) {
  const { data, error } = await svc.rpc("find_or_create_contact", {
    p_workspace_id: ws, p_identity: identity, p_defaults: defaults, p_mode: mode, p_allow_without_identity: allow,
  });
  if (error) throw new Error(`find_or_create_contact: ${error.message}`);
  return data;
}

const count = async (ws) => (await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws).is("deleted_at", null)).count ?? 0;

try {
  await runCleanup(svc);
  const { data: workspace } = await svc.from("workspaces").insert({ name: "zz-test-contacts-single", slug: `zz-test-contacts-single-${stamp}` }).select("id").single();
  const ws = workspace.id;
  const { data: workspace2 } = await svc.from("workspaces").insert({ name: "zz-test-contacts-single-2", slug: `zz-test-contacts-single-2-${stamp}` }).select("id").single();
  const ws2 = workspace2.id;

  console.log("\n— Quien puede insertar en contacts —");
  {
    const rows = sql(`
      SELECT p.oid::regprocedure::text AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'private')
        AND p.prokind = 'f'
        AND pg_get_functiondef(p.oid) ~* 'insert\\s+into\\s+(public\\.)?contacts\\s*[(\\s]'
      ORDER BY 1`);
    const names = rows.map((r) => r.fn);
    // Las funciones que no son parte de la regla central, listadas a ver si hay alguna.
    const extra = names.filter((n) => !n.startsWith("find_or_create_contact(") && !n.startsWith("public.find_or_create_contact("));
    check(names.some((n) => n.includes("find_or_create_contact(")), "find_or_create_contact inserta en contacts");
    check(extra.length === 0, "ninguna otra funcion de la base inserta en contacts", extra.join(", "));
  }

  console.log("\n— normalize_phone contra normalizePhone —");
  {
    const phones = ["+54 9 11 2233-4455", "005491122334455", "5491122334455", "1234567", "1234567890123456", "+54+9112233", "tel: 54911 2233 4455", "", "   ", "+0054911223344", "(506) 8888-7777", "+506 8888 7777 ext 5"];
    // La gemela en TypeScript se recorre en vitest (identity.test.ts); aca se compara la base contra una copia literal de la regla.
    const ts = (raw) => {
      if (!raw) return null;
      let d = raw.replace(/[^\d+]/g, "");
      d = d.replace(/(?!^)\+/g, "");
      if (d.startsWith("+")) d = d.slice(1); else if (d.startsWith("00")) d = d.slice(2);
      if (!/^\d+$/.test(d)) return null;
      if (d.length < 8 || d.length > 15) return null;
      return `+${d}`;
    };
    const values = phones.map((p) => `(${phones.indexOf(p)}, '${p.replace(/'/g, "''")}')`).join(",");
    const rows = sql(`SELECT t.i, t.raw, public.normalize_phone(t.raw) AS n FROM (VALUES ${values}) AS t(i, raw) ORDER BY t.i`);
    for (const r of rows) check((r.n ?? null) === ts(r.raw), `normalize_phone(${JSON.stringify(r.raw)}) = ${JSON.stringify(ts(r.raw))}`, `base: ${JSON.stringify(r.n)}`);
  }

  console.log("\n— Los casos compartidos de identidad (TS ↔ SQL) —");
  {
    const shared = JSON.parse(readFileSync("lib/contacts/identity.cases.json", "utf8")).cases;
    const values = shared.map((c, i) => `(${i}, '${JSON.stringify(c.input).replace(/'/g, "''")}'::jsonb)`).join(",\n");
    const rows = sql(`SELECT t.i, private.contact_normalize_identity(t.input) AS n FROM (VALUES ${values}) AS t(i, input) ORDER BY t.i`);
    check(rows.length === shared.length, `la base resolvio los ${shared.length} casos`);
    for (const r of rows) {
      const c = shared[r.i];
      check(JSON.stringify(sortKeys(r.n)) === JSON.stringify(sortKeys(c.normalized)), `identidad: ${c.name}`, `base: ${JSON.stringify(r.n)} · esperado: ${JSON.stringify(c.normalized)}`);
    }
  }

  console.log("\n— La regla central: crear y encontrar —");
  {
    const p1 = num(1);
    const created = await central(ws, { phone: `  ${p1.slice(0, 4)} ${p1.slice(4)} `, email: "  Ana.Uno@Example.TEST " }, { display_name: "Ana Uno", country: "CR" });
    check(created.status === "created" && created.created === true && !!created.contact_id, "sin datos previos crea un contacto");
    const { data: row } = await svc.from("contacts").select("phone, email, display_name, country, workspace_id, deleted_at").eq("id", created.contact_id).single();
    check(row.phone === p1 && row.email === "ana.uno@example.test", "guarda el telefono y el email normalizados", JSON.stringify(row));
    check(row.display_name === "Ana Uno" && row.country === "CR" && row.workspace_id === ws, "y los defaults");

    const byPhone = await central(ws, { phone: p1 });
    check(byPhone.status === "found" && byPhone.contact_id === created.contact_id && byPhone.matched_by === "phone", "lo encuentra por telefono");
    const byPhoneSpaces = await central(ws, { phone: `${p1.slice(1, 4)}-${p1.slice(4)}` });
    check(byPhoneSpaces.contact_id === created.contact_id, "lo encuentra por telefono escrito distinto");
    const byEmail = await central(ws, { email: "ANA.UNO@example.test" });
    check(byEmail.contact_id === created.contact_id && byEmail.matched_by === "email", "lo encuentra por email con otras mayusculas");
    const viaWa = await central(ws, { whatsapp_phone: p1 });
    check(viaWa.contact_id === created.contact_id, "el WhatsApp tambien busca en la columna del telefono");
    check((await count(ws)) === 1, "sigue habiendo UN contacto");

    const other = await central(ws2, { phone: p1 });
    check(other.status === "created" && other.contact_id !== created.contact_id, "otro workspace con el mismo telefono: otro contacto");
    await svc.from("contacts").delete().eq("workspace_id", ws2);
  }

  console.log("\n— Redes sociales —");
  {
    const a = await central(ws, { instagram: "@Fede.Com.IA" }, { display_name: "Fede" });
    check(a.status === "created", "crea por un usuario de Instagram");
    const b = await central(ws, { instagram: "fede.com.ia" });
    check(b.contact_id === a.contact_id && b.matched_by === "instagram", "lo encuentra con otro formato del mismo usuario");
    const t = await central(ws, { tiktok: "@tt_zz" });
    const t2 = await central(ws, { tiktok: "TT_ZZ" });
    check(t.contact_id === t2.contact_id && t2.matched_by === "tiktok", "TikTok: mismo usuario, un contacto");
    const x = await central(ws, { x: "@x_zz" });
    check((await central(ws, { x: "X_ZZ" })).contact_id === x.contact_id, "X: mismo usuario, un contacto");
    const li = await central(ws, { linkedin: "https://www.linkedin.com/in/Ana-ZZ/" });
    const li2 = await central(ws, { linkedin: "linkedin.com/in/ana-zz?trk=a" });
    check(li.contact_id === li2.contact_id && li2.matched_by === "linkedin", "LinkedIn: se compara por el slug");
    const { data: liRow } = await svc.from("contacts").select("linkedin_profile_url").eq("id", li.contact_id).single();
    check(liRow.linkedin_profile_url === "https://www.linkedin.com/in/ana-zz", "y guarda la URL canonica");
  }

  console.log("\n— Conflictos —");
  {
    const pA = num(10), pB = num(11);
    const a = await central(ws, { phone: pA, email: "conf.a@example.test" });
    const b = await central(ws, { phone: pB, email: "conf.b@example.test" });
    check(a.contact_id !== b.contact_id, "dos personas distintas");
    const r = await central(ws, { phone: pA, email: "conf.b@example.test" }, {}, "find_only");
    check(r.contact_id === a.contact_id && r.matched_by === "phone", "gana el telefono (prioridad)");
    check(r.conflict_contact_id === b.contact_id && r.conflicts.length === 1 && r.conflicts[0].by === "email" && r.conflicts[0].contact_id === b.contact_id, "el email de la otra persona queda como conflicto", JSON.stringify(r.conflicts));
    const r2 = await central(ws, { phone: pA, email: "conf.b@example.test" });
    check(r2.contact_id === a.contact_id && r2.created === false, "en 'create' tampoco crea otro");
    const r3 = await central(ws, { email: "conf.a@example.test", secondary_email: "conf.b@example.test" }, {}, "find_only");
    check(r3.contact_id === a.contact_id && r3.conflicts.length === 1, "email y secundario de dos personas: conflicto");
  }

  console.log("\n— find_only, sin datos y bloqueos de forma —");
  {
    const before = await count(ws);
    const miss = await central(ws, { phone: num(20) }, {}, "find_only");
    check(miss.status === "not_found" && miss.contact_id === null, "find_only de alguien que no esta: not_found");
    check((await count(ws)) === before, "y no crea nada");
    const none = await central(ws, { display_name: "Solo Nombre" });
    check(none.status === "no_identity" && none.contact_id === null, "solo el nombre: no_identity");
    check((await count(ws)) === before, "y no crea nada");
    const allowed = await central(ws, {}, { display_name: "Solo Nombre" }, "create", true);
    check(allowed.status === "created" && !!allowed.contact_id, "con allow_without_identity (alta manual) SI crea con solo el nombre");
    const noneFind = await central(ws, {}, {}, "find_only", true);
    check(noneFind.status === "no_identity", "find_only nunca crea, ni con el permiso");
    const { error: badMode } = await svc.rpc("find_or_create_contact", { p_workspace_id: ws, p_identity: { email: "a@b.co" }, p_defaults: {}, p_mode: "nope" });
    check(!!badMode, "una modalidad invalida lanza");
    const { error: noChan } = await svc.rpc("find_or_create_contact", { p_workspace_id: ws, p_identity: { email: "a@b.co" }, p_defaults: {}, p_mode: "link_channel" });
    check(!!noChan, "link_channel sin canal lanza");
  }

  console.log("\n— Los defaults no pisan lo estructural ni la identidad —");
  {
    const fakeId = randomUUID();
    const r = await central(ws2, { email: "defaults@example.test" }, {
      id: fakeId, workspace_id: ws, email: "otro@example.test", phone: "+10000000000", deleted_at: "2020-01-01T00:00:00Z",
      created_at: "2001-01-01T00:00:00Z", display_name: "Defaults", instagram_username: "pisado", is_anonymous: true, no_existe_esta_columna: 1,
    });
    const { data: row } = await svc.from("contacts").select("id, workspace_id, email, phone, deleted_at, created_at, display_name, instagram_username").eq("id", r.contact_id).single();
    check(row.id !== fakeId && row.workspace_id === ws2, "id y workspace salen de la funcion, no de los defaults");
    check(row.email === "defaults@example.test" && row.phone === null && row.instagram_username === null, "la identidad sale de p_identity");
    check(row.deleted_at === null && !row.created_at.startsWith("2001"), "ni deleted_at ni created_at se pisan");
    check(row.display_name === "Defaults", "el resto de los defaults entra");
    await svc.from("contacts").delete().eq("workspace_id", ws2);
  }

  console.log("\n— Canal —");
  {
    const { data: ch } = await svc.from("channels").insert({
      workspace_id: ws, platform: "instagram", late_account_id: `zz-single-${stamp}`, username: "zzsingle", display_name: "zz single", is_active: true,
    }).select("id").single();
    const first = await central(ws, { channel_id: ch.id, sender_id: "sender-1", instagram: "@canal.uno" }, { display_name: "Canal Uno" }, "link_channel");
    check(first.created === true, "link_channel crea el contacto");
    const { data: links } = await svc.from("contact_channels").select("contact_id, platform_username").eq("channel_id", ch.id).eq("platform_sender_id", "sender-1");
    check(links?.length === 1 && links[0].contact_id === first.contact_id && links[0].platform_username === "canal.uno", "y deja el vinculo con el canal");
    const again = await central(ws, { channel_id: ch.id, sender_id: "sender-1" }, {}, "link_channel");
    check(again.created === false && again.matched_by === "channel" && again.contact_id === first.contact_id, "el mismo remitente despues se encuentra por el canal");
  }

  console.log("\n— Concurrencia: 10 llamadas a la vez —");
  {
    const p = num(30);
    const samePhone = await Promise.all(Array.from({ length: 10 }, () => central(ws, { phone: p }, { display_name: "Carrera tel" })));
    check(new Set(samePhone.map((r) => r.contact_id)).size === 1, "10 llamadas con el mismo telefono dan el mismo contacto");
    check(samePhone.filter((r) => r.created).length === 1, "y solo una lo creo");
    const { count: nPhone } = await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("phone", p);
    check(nPhone === 1, "hay UN contacto con ese telefono", String(nPhone));

    const variants = ["Carrera.Mail@Example.test", "carrera.mail@example.test", "CARRERA.MAIL@EXAMPLE.TEST", " carrera.mail@example.test ", "Carrera.mail@example.TEST"];
    const sameEmail = await Promise.all(Array.from({ length: 10 }, (_, i) => central(ws, { email: variants[i % variants.length] }, { display_name: "Carrera mail" })));
    check(new Set(sameEmail.map((r) => r.contact_id)).size === 1, "10 llamadas con el mismo email (mayusculas distintas) dan el mismo contacto");
    check(sameEmail.filter((r) => r.created).length === 1, "y solo una lo creo");
    const { count: nMail } = await svc.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("email", "carrera.mail@example.test");
    check(nMail === 1, "hay UN contacto con ese email", String(nMail));

    // Cruzado: la mitad por telefono + email, la otra mitad solo por el email.
    const p2 = num(31);
    const mixed = await Promise.all(Array.from({ length: 10 }, (_, i) => central(ws, i % 2 ? { phone: p2, email: "mixto@example.test" } : { email: "MIXTO@example.test" }, { display_name: "Mixto" })));
    check(new Set(mixed.map((r) => r.contact_id)).size === 1, "llamadas cruzadas (telefono+email y solo email) dan el mismo contacto");
  }

  console.log("\n— Privilegios —");
  {
    const a = await anon.rpc("find_or_create_contact", { p_workspace_id: ws, p_identity: { email: "anon@example.test" }, p_defaults: {}, p_mode: "create" });
    check(!!a.error, "un anonimo no puede ejecutar find_or_create_contact");
    const n = await anon.rpc("normalize_phone", { p_raw: "+5491122334455" });
    check(!!n.error, "ni normalize_phone");
    const rows = sql(`
      SELECT p.oid::regprocedure::text AS fn, p.prosecdef, p.proconfig::text AS cfg,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'find_or_create_contact' AND n.nspname = 'public'`);
    check(rows.length === 1 && rows[0].prosecdef === true && /search_path=.{0,4}""/.test(rows[0].cfg ?? ""), "find_or_create_contact es SECURITY DEFINER con search_path vacio", JSON.stringify(rows));
    check(rows[0]?.auth_exec === false && rows[0]?.anon_exec === false && rows[0]?.svc_exec === true, "y solo service_role la ejecuta");
  }
} catch (err) {
  fail(`el script se cayo: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
} finally {
  console.log("\n— Limpieza —");
  const cleaned = await runCleanup(svc);
  if (!cleaned) failures++;
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
}

console.log(failures === 0 ? "\nTodo en orden." : `\n${failures} verificaciones fallaron.`);
process.exit(failures === 0 ? 0 : 1);
