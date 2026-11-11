#!/usr/bin/env node
/**
 * Verificacion de las vistas guardadas de las tablas (migracion 00360).
 *
 * Prueba contra la base real, con usuarios de verdad, lo que vitest no puede:
 *   1. Una vista privada la ve solo su dueña (ni un Admin ve la privada de otra persona).
 *   2. Un Member no puede compartir; un Admin si (con todo el equipo o con personas elegidas).
 *   3. Una vista compartida solo la edita o borra su dueña o un Owner/Admin.
 *   4. Vistas predeterminadas: una por persona y tabla, 10 pedidos a la vez dejan una; un Admin se la deja a otra persona
 *      (y la suma a 'selected'); un Member no puede; una vista privada no puede ser predeterminada de otra persona.
 *   5. Pasar una vista a privada saca a las demas personas y sus predeterminadas.
 *   6. Aislamiento entre negocios, CHECK y que nadie escribe directo en las tablas.
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). No correr en simultaneo con los otros verify-*: tomar el candado
 * /private/tmp/ssa-verify.lock (mkdir para tomarlo, rmdir para soltarlo).
 *
 *   node scripts/verify-table-views.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();
const TABLE = "sales";
const config = { v: 1, columns: { order: [], hidden: ["variant"], shown: [], pinned: [], widths: {} }, filters: "estado=paid" };

async function makeUser(tag) {
  const email = `zz-test-views-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

try {
  const mkWs = async (tag) => {
    const { data, error } = await svc.from("workspaces").insert({ name: `zz-test-views-${tag}`, slug: `zz-test-views-${tag}-${stamp}` }).select("id").single();
    if (error) throw new Error(`no pude crear el workspace ${tag}: ${error.message}`);
    return data.id;
  };
  const ws = await mkWs("a");
  const ws2 = await mkWs("b");
  const ana = await makeUser("ana");      // owner
  const bruno = await makeUser("bruno");  // admin
  const carla = await makeUser("carla");  // member
  const eli = await makeUser("eli");      // member
  const dani = await makeUser("dani");    // otro negocio
  await svc.from("workspace_members").insert([
    { workspace_id: ws, user_id: ana.id, role: "owner" },
    { workspace_id: ws, user_id: bruno.id, role: "admin" },
    { workspace_id: ws, user_id: carla.id, role: "member" },
    { workspace_id: ws, user_id: eli.id, role: "member" },
    { workspace_id: ws2, user_id: dani.id, role: "owner" },
  ]);

  const save = (u, over = {}) =>
    u.client.rpc("save_table_view", { p_id: null, p_workspace: ws, p_table_key: TABLE, p_name: "Vista", p_config: config, p_visibility: "private", p_member_ids: null, ...over });
  const idsOf = async (u) => ((await u.client.from("table_views").select("id").eq("workspace_id", ws)).data ?? []).map((r) => r.id);

  // -------------------------------------------------------------------------
  console.log("\n1. Privadas: solo su dueña");
  const priv = await save(ana, { p_name: "Privada de Ana" });
  check(!priv.error && !!priv.data, "Ana crea una vista privada", priv.error?.message);
  check((await idsOf(ana)).includes(priv.data), "Ana la ve");
  check(!(await idsOf(carla)).includes(priv.data), "Carla (Member) NO la ve");
  check(!(await idsOf(bruno)).includes(priv.data), "Bruno (Admin) NO ve la privada de otra persona");
  check(!(await idsOf(dani)).includes(priv.data), "Dani (otro negocio) NO la ve");
  const dup = await save(ana, { p_name: "  privada de ana " });
  check(dup.error?.code === "23505", "el mismo nombre (sin importar mayusculas ni espacios) se rechaza", dup.error?.message);
  const sameNameOther = await save(carla, { p_name: "Privada de Ana" });
  check(!sameNameOther.error, "otra persona puede usar el mismo nombre", sameNameOther.error?.message);

  // -------------------------------------------------------------------------
  console.log("\n2. Compartir: solo Owner y Admin");
  const memberShare = await save(carla, { p_name: "Carla comparte", p_visibility: "workspace" });
  check(memberShare.error?.code === "42501", "un Member NO puede compartir una vista", memberShare.error?.message);
  const team = await save(bruno, { p_name: "Para todo el equipo", p_visibility: "workspace" });
  check(!team.error, "un Admin la comparte con todo el equipo", team.error?.message);
  check((await idsOf(carla)).includes(team.data) && (await idsOf(eli)).includes(team.data), "Carla y Eli la ven");
  check(!(await idsOf(dani)).includes(team.data), "Dani (otro negocio) no");
  const sel = await save(bruno, { p_name: "Solo para Carla", p_visibility: "selected", p_member_ids: [carla.id] });
  check(!sel.error, "un Admin la comparte con personas elegidas", sel.error?.message);
  check((await idsOf(carla)).includes(sel.data), "Carla la ve");
  check(!(await idsOf(eli)).includes(sel.data), "Eli NO la ve");
  check((await idsOf(ana)).includes(sel.data), "Ana (Owner) la ve y puede administrarla");
  const outsider = await save(bruno, { p_name: "Con un extraño", p_visibility: "selected", p_member_ids: [dani.id] });
  check(Boolean(outsider.error), "no se puede compartir con alguien de otro negocio", outsider.error?.message);
  const crossWs = await dani.client.rpc("save_table_view", { p_id: null, p_workspace: ws, p_table_key: TABLE, p_name: "Intruso", p_config: config, p_visibility: "private", p_member_ids: null });
  check(Boolean(crossWs.error), "alguien de otro negocio NO puede crear vistas en este negocio", crossWs.error?.message);

  // -------------------------------------------------------------------------
  console.log("\n3. Editar y borrar");
  const carlaEdit = await save(carla, { p_id: team.data, p_name: "Carla la pisa" });
  check(carlaEdit.error?.code === "42501", "un Member NO edita una vista compartida de otra persona", carlaEdit.error?.message);
  const carlaDel = await carla.client.rpc("delete_table_view", { p_id: team.data });
  check(carlaDel.error?.code === "42501", "ni la borra", carlaDel.error?.message);
  const anaEdit = await save(ana, { p_id: team.data, p_name: "Para todo el equipo (v2)", p_visibility: "workspace" });
  check(!anaEdit.error, "el Owner edita una compartida aunque no sea suya", anaEdit.error?.message);
  const adminPrivate = await save(bruno, { p_id: priv.data, p_name: "Se la robo" });
  check(adminPrivate.error?.code === "42501" || adminPrivate.error?.code === "P0002", "un Admin NO edita la privada de otra persona", adminPrivate.error?.message);
  const direct = await carla.client.from("table_views").insert({ workspace_id: ws, table_key: TABLE, name: "Directo", owner_id: carla.id });
  check(Boolean(direct.error), "nadie escribe directo en la tabla (solo por las funciones)");
  const directUpd = await ana.client.from("table_views").update({ name: "x" }).eq("id", priv.data).select("id");
  check((directUpd.data ?? []).length === 0, "ni actualiza directo");
  const badKey = await save(ana, { p_name: "Clave rara", p_table_key: "Ventas!" });
  check(Boolean(badKey.error), "el CHECK rechaza una clave de tabla invalida");
  const bigConfig = await save(ana, { p_name: "Enorme", p_config: { v: 1, junk: "x".repeat(25000) } });
  check(Boolean(bigConfig.error), "el CHECK rechaza una configuracion enorme");

  // -------------------------------------------------------------------------
  console.log("\n4. Predeterminadas");
  const setDef = (u, view, users = null, key = TABLE) => u.client.rpc("set_table_view_default", { p_workspace: ws, p_table_key: key, p_view: view, p_user_ids: users });
  const defRows = async (userId) => ((await svc.from("table_view_defaults").select("view_id, assigned_by").eq("workspace_id", ws).eq("table_key", TABLE).eq("user_id", userId)).data ?? []);

  const own = await setDef(carla, team.data);
  check(!own.error, "Carla deja una compartida como SU predeterminada", own.error?.message);
  check((await defRows(carla.id)).length === 1, "queda una sola fila");
  const noView = await setDef(carla, priv.data);
  check(Boolean(noView.error), "no puede dejar de predeterminada una vista que no ve");
  const forOther = await setDef(carla, team.data, [eli.id]);
  check(forOther.error?.code === "42501", "un Member NO elige la predeterminada de otra persona", forOther.error?.message);
  const adminAssign = await setDef(bruno, team.data, [eli.id, carla.id]);
  check(!adminAssign.error, "un Admin se la deja a otras personas", adminAssign.error?.message);
  const eliRow = await defRows(eli.id);
  check(eliRow.length === 1 && eliRow[0].assigned_by === bruno.id, "queda anotado quien se la asigno");
  const toSel = await setDef(bruno, sel.data, [eli.id]);
  check(!toSel.error, "una vista 'elegidas' se le deja a Eli y se la suma a su lista", toSel.error?.message);
  check((await idsOf(eli)).includes(sel.data), "Eli ahora la ve");
  const privOther = await setDef(ana, priv.data, [eli.id]);
  check(Boolean(privOther.error), "una vista privada NO puede ser la predeterminada de otra persona", privOther.error?.message);

  // Una sola por persona y tabla, aunque lleguen 10 pedidos a la vez.
  const racers = await Promise.all(Array.from({ length: 10 }, (_, i) => setDef(carla, i % 2 ? team.data : sel.data)));
  check(racers.every((r) => !r.error), "10 pedidos a la vez no fallan", racers.find((r) => r.error)?.error?.message);
  check((await defRows(carla.id)).length === 1, "y queda UNA sola predeterminada por persona y tabla");
  const clear = await setDef(carla, null);
  check(!clear.error && (await defRows(carla.id)).length === 0, "quitar la predeterminada la borra");
  const seeOthers = await carla.client.from("table_view_defaults").select("user_id").eq("workspace_id", ws);
  check((seeOthers.data ?? []).every((r) => r.user_id === carla.id), "un Member ve solo SU predeterminada");
  const adminSees = await bruno.client.from("table_view_defaults").select("user_id").eq("workspace_id", ws);
  check((adminSees.data ?? []).some((r) => r.user_id === eli.id), "un Admin ve la predeterminada de otras personas (la de Eli)", JSON.stringify(adminSees.data));

  // -------------------------------------------------------------------------
  console.log("\n5. Pasar a privada saca a los demas");
  await setDef(bruno, sel.data, [carla.id, eli.id]);
  const toPrivate = await save(bruno, { p_id: sel.data, p_name: "Solo para Carla", p_visibility: "private" });
  check(!toPrivate.error, "el Admin que la creo la vuelve privada", toPrivate.error?.message);
  check(!(await idsOf(carla)).includes(sel.data), "Carla ya no la ve");
  const left = await svc.from("table_view_defaults").select("user_id").eq("view_id", sel.data);
  check((left.data ?? []).every((r) => r.user_id === bruno.id), "ni la tiene de predeterminada", JSON.stringify(left.data));
  const members = await svc.from("table_view_members").select("user_id").eq("view_id", sel.data);
  check((members.data ?? []).length === 0, "y su lista de personas queda vacia");

  // -------------------------------------------------------------------------
  console.log("\n6. Borrar se lleva todo");
  const del = await bruno.client.rpc("delete_table_view", { p_id: team.data });
  check(!del.error, "un Admin borra una vista compartida", del.error?.message);
  const gone = await svc.from("table_view_defaults").select("user_id").eq("view_id", team.data);
  check((gone.data ?? []).length === 0, "y se lleva sus predeterminadas");
} catch (err) {
  fail("la verificacion se corto", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\nLimpieza");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} comprobacion(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
