#!/usr/bin/env node
/**
 * Verificacion de los comentarios con @menciones (Servicios A4, F132; migracion 00364).
 *
 * Contra la base real, con usuarios de verdad y dos alcances distintos:
 *   1. Quien ve la tarea comenta (1 a 5000 caracteres) y se devuelve el id; quien no la ve recibe CM001 y no se guarda.
 *   2. Una mencion a alguien que no ve la entidad se descarta sin avisarle; a quien la ve le llega `mentioned` una vez,
 *      nunca a quien escribe.
 *   3. Solo el autor edita y borra (CM002); borrar es logico (la fila queda con deleted_at y no se lee).
 *   4. Nadie escribe directo en `comments` con su sesion (sin politicas de escritura).
 *   5. Los comentarios de una reunion siguen la visibilidad de la reunion.
 *   6. La lista del `@` (comment_mention_candidates) trae solo a quien ve la entidad.
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). No correr en simultaneo con los otros verify-*: tomar el candado
 * /private/tmp/ssa-verify.lock (mkdir para tomarlo, rmdir para soltarlo).
 *
 *   node scripts/verify-comments.mjs
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

async function makeUser(tag) {
  const email = `zz-test-comments-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ app_metadata: { ssa_create_workspace: true }, email, password, email_confirm: true, user_metadata: { full_name: `zz-test ${tag}` } });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

const mentionsFor = async (userId, commentId) =>
  ((await svc.from("notifications").select("id, metadata").eq("recipient_id", userId).eq("type", "mentioned")).data ?? [])
    .filter((n) => n.metadata?.comment_id === commentId).length;

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-comments", slug: `zz-test-comments-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-comments-b", slug: `zz-test-comments-b-${stamp}` }).select("id").single();

  const owner = await makeUser("owner");   // ve todo
  const ana = await makeUser("ana");       // Member, alcance propio en tareas
  const beto = await makeUser("beto");     // Member, alcance propio en tareas
  const otro = await makeUser("otro");     // de otro negocio
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: owner.id, role: "owner" },
    { workspace_id: ws.id, user_id: ana.id, role: "member" },
    { workspace_id: ws.id, user_id: beto.id, role: "member" },
    { workspace_id: ws2.id, user_id: otro.id, role: "owner" },
  ]);

  // La tarea es de Ana (la ve Ana y el Owner; Beto no).
  const { data: task, error: tErr } = await svc.from("tasks").insert({ workspace_id: ws.id, title: "zz-test tarea de Ana", owner_id: ana.id, created_by: owner.id }).select("id").single();
  if (tErr) throw new Error(`no pude crear la tarea: ${tErr.message}`);

  // ---------------------------------------------------------------------------
  console.log("\n1. Comentar: quien ve la tarea, si; quien no, CM001");
  const post = (u, body, mentions = []) => u.client.rpc("post_comment", { p_entity_type: "task", p_entity_id: task.id, p_body: body, p_mentions: mentions });
  const c1 = await post(ana, "Hola, @zz-test owner mirá esto", [owner.id, beto.id, ana.id]);
  check(!c1.error && typeof c1.data === "string", "Ana (ve la tarea) comenta y recibe el id", c1.error?.message);
  const c1Row = (await svc.from("comments").select("*").eq("id", c1.data).single()).data;
  check(c1Row?.author_id === ana.id && c1Row?.workspace_id === ws.id, "queda con su autora y el negocio de la tarea");
  const cBeto = await post(beto, "No debería poder");
  check(cBeto.error?.hint === "CM001", "Beto (no ve la tarea) recibe CM001", cBeto.error?.message);
  const cOtro = await post(otro, "Intruso");
  check(cOtro.error?.hint === "CM001", "alguien de otro negocio recibe CM001");
  const before = (await svc.from("comments").select("id").eq("entity_id", task.id)).data?.length ?? 0;
  check(before === 1, "no se guardó nada de los rechazados");
  const empty = await post(ana, "   ");
  check(empty.error?.hint === "CM003", "un comentario vacío se rechaza");
  const huge = await post(ana, "x".repeat(5001));
  check(Boolean(huge.error), "uno de más de 5000 caracteres se rechaza");

  // ---------------------------------------------------------------------------
  console.log("\n2. Menciones filtradas y avisos");
  check(JSON.stringify(c1Row?.mentions ?? []) === JSON.stringify([owner.id]), "queda solo la mención del Owner (Beto no ve la tarea; Ana es la autora)", JSON.stringify(c1Row?.mentions));
  check((await mentionsFor(owner.id, c1.data)) === 1, "al Owner le llega un aviso `mentioned`");
  check((await mentionsFor(beto.id, c1.data)) === 0, "a Beto no le llega nada");
  check((await mentionsFor(ana.id, c1.data)) === 0, "a la autora tampoco");
  const cands = await ana.client.rpc("comment_mention_candidates", { p_entity_type: "task", p_entity_id: task.id });
  const candIds = new Set((cands.data ?? []).map((r) => r.user_id));
  check(candIds.has(owner.id) && candIds.has(ana.id) && !candIds.has(beto.id), "la lista del @ trae solo a quien ve la tarea", JSON.stringify([...candIds]));
  const candsBeto = await beto.client.rpc("comment_mention_candidates", { p_entity_type: "task", p_entity_id: task.id });
  check((candsBeto.data ?? []).length === 0, "a quien no ve la tarea, la lista le llega vacía");

  // ---------------------------------------------------------------------------
  console.log("\n3. Editar y borrar: solo lo propio");
  const editOther = await owner.client.rpc("edit_comment", { p_id: c1.data, p_body: "Lo piso", p_mentions: [] });
  check(editOther.error?.hint === "CM002", "el Owner NO edita el comentario de Ana (CM002)", editOther.error?.message);
  const editOwn = await ana.client.rpc("edit_comment", { p_id: c1.data, p_body: "Hola, mirá esto (editado)", p_mentions: [owner.id] });
  check(!editOwn.error, "Ana edita lo suyo", editOwn.error?.message);
  const edited = (await svc.from("comments").select("body, edited_at").eq("id", c1.data).single()).data;
  check(edited?.edited_at && edited.body.includes("editado"), "queda con edited_at y el texto nuevo");
  check((await mentionsFor(owner.id, c1.data)) === 1, "editar no repite el aviso de la misma mención");
  const delOther = await owner.client.rpc("delete_comment", { p_id: c1.data });
  check(delOther.error?.hint === "CM002", "el Owner NO borra el comentario de Ana");
  const delOwn = await ana.client.rpc("delete_comment", { p_id: c1.data });
  check(!delOwn.error, "Ana borra lo suyo", delOwn.error?.message);
  const after = (await svc.from("comments").select("deleted_at").eq("id", c1.data).single()).data;
  check(Boolean(after?.deleted_at), "la fila sigue en la base con deleted_at");
  const readAfter = await ana.client.from("comments").select("id").eq("entity_id", task.id).is("deleted_at", null);
  check((readAfter.data ?? []).length === 0, "y no aparece al leer el hilo");

  // ---------------------------------------------------------------------------
  console.log("\n4. Nadie escribe directo");
  const direct = await ana.client.from("comments").insert({ workspace_id: ws.id, entity_type: "task", entity_id: task.id, author_id: ana.id, body: "directo" });
  check(Boolean(direct.error), "un insert directo con la sesión falla");
  const directUpd = await ana.client.from("comments").update({ body: "x" }).eq("id", c1.data).select("id");
  check((directUpd.data ?? []).length === 0, "ni un update directo");
  const sys = await ana.client.rpc("comment_system", { p_workspace_id: ws.id, p_entity_type: "task", p_entity_id: task.id, p_body: "x" });
  check(Boolean(sys.error), "un usuario no puede dejar un comentario de sistema");

  // ---------------------------------------------------------------------------
  console.log("\n5. Lectura por visibilidad (tarea y reunión)");
  const c2 = await post(owner, "Comentario del Owner");
  check(!c2.error, "el Owner comenta la tarea de Ana", c2.error?.message);
  check(((await ana.client.from("comments").select("id").eq("entity_id", task.id)).data ?? []).length >= 1, "Ana lo lee");
  check(((await beto.client.from("comments").select("id").eq("entity_id", task.id)).data ?? []).length === 0, "Beto no lo lee");
  const { data: call, error: callErr } = await svc.from("calls").insert({ workspace_id: ws.id, source: "manual", title: "zz-test reunión", recorded_at: new Date().toISOString(), recorded_by_user_id: owner.id }).select("id").single();
  if (callErr) throw new Error(`no pude crear la reunión: ${callErr.message}`);
  const cc = await owner.client.rpc("post_comment", { p_entity_type: "call", p_entity_id: call.id, p_body: "Sobre la reunión", p_mentions: [beto.id] });
  check(!cc.error, "el Owner comenta una reunión", cc.error?.message);
  const ccRow = (await svc.from("comments").select("mentions").eq("id", cc.data).single()).data;
  check((ccRow?.mentions ?? []).length === 0, "la mención a Beto (no ve la reunión) se descarta");
  const callBeto = await beto.client.rpc("post_comment", { p_entity_type: "call", p_entity_id: call.id, p_body: "x" });
  check(callBeto.error?.hint === "CM001", "Beto no comenta una reunión que no ve");
  const badType = await owner.client.rpc("post_comment", { p_entity_type: "ficha", p_entity_id: task.id, p_body: "x" });
  check(badType.error?.hint === "CM001", "un tipo de entidad desconocido se rechaza");
} catch (error) {
  fail("el script se cortó", error instanceof Error ? error.message : String(error));
} finally {
  const cleaned = await runCleanup(svc);
  if (!cleaned) fail("la limpieza de los datos de prueba falló");
}

console.log(failures === 0 ? "\nverify-comments: todo en verde" : `\nverify-comments: ${failures} falla(s)`);
process.exit(failures === 0 ? 0 : 1);
