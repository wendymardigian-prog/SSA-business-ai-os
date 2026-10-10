#!/usr/bin/env node
/**
 * Verificacion de aislamiento entre workspaces: secretos de Vault e
 * integraciones, y que una persona invitada no reciba un workspace propio.
 *
 * Corre contra la base real. Crea dos workspaces (A y B) con un Admin cada
 * uno y prueba que el Admin de B no puede leer, escribir, borrar ni listar
 * nada de A, ni con las RPC de Vault ni con la tabla integration_configs.
 * Despues simula el alta por invitacion (lo que hace registerFromInvite) y
 * comprueba que el trigger on_auth_user_created no le arma un workspace a la
 * persona invitada (migracion 00119).
 *
 * verify-rls.mjs prueba los roles DENTRO de un workspace; esto prueba la
 * frontera ENTRE workspaces, que es lo que garantiza el prefijo
 * `ws:<workspace>:` que arma la base en la 00017.
 *
 * Como los demas verify-*: crea y limpia sus datos (prefijo zz-test-), y no
 * se corre en simultaneo con otro.
 *
 *   node scripts/verify-workspace-isolation.mjs
 *   node scripts/verify-workspace-isolation.mjs --despues-de-00143   # read_secret solo para el servidor
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
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

// Mismo criterio que isForbiddenSecretError (lib/vault.ts).
const forbidden = (error) => !!error && /forbidden|permission denied/.test(error.message);

async function makeUser(tag) {
  const email = `zz-test-${tag}-${Date.now()}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

async function makeWorkspace(tag, adminId) {
  const { data: ws, error } = await svc.from("workspaces")
    .insert({ name: `zz-test-iso-${tag}`, slug: `zz-test-iso-${tag}-${Date.now()}` }).select("id").single();
  if (error) throw new Error(`no pude crear workspace ${tag}: ${error.message}`);
  await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: adminId, role: "admin" });
  return ws.id;
}

const SECRET = "zz_test_iso";
// Desde la 00143 `read_secret` solo la ejecuta service_role. Los valores se
// comprueban con el service role (sirve antes y despues); lo que cambia es si
// el Admin todavia puede leer el SUYO con su sesion.
const POST_00143 = process.argv.includes("--despues-de-00143");
// Los secretos no se van con el workspace (viven en vault.secrets), asi que
// se anotan aca y se borran en el finally, antes de la limpieza general.
const secretsToDelete = [];

try {
  const adminA = await makeUser("iso-admin-a");
  const adminB = await makeUser("iso-admin-b");
  const wsA = await makeWorkspace("a", adminA.id);
  const wsB = await makeWorkspace("b", adminB.id);
  secretsToDelete.push([wsA, SECRET], [wsB, SECRET]);

  console.log("\n— Cada workspace tiene su propio secreto con el mismo nombre —");
  { const { error: eA } = await adminA.client.rpc("store_secret",
      { secret_name: SECRET, secret_value: "valor-de-A", workspace_id: wsA });
    check(!eA, "el Admin de A guarda el secreto en A", eA?.message);
    const { error: eB } = await adminB.client.rpc("store_secret",
      { secret_name: SECRET, secret_value: "valor-de-B", workspace_id: wsB });
    check(!eB, "el Admin de B guarda uno con el MISMO nombre en B", eB?.message);

    const { data: leeA } = await svc.rpc("read_secret", { secret_name: SECRET, workspace_id: wsA });
    const { data: leeB } = await svc.rpc("read_secret", { secret_name: SECRET, workspace_id: wsB });
    check(leeA === "valor-de-A", "A tiene su valor");
    check(leeB === "valor-de-B", "B tiene el suyo: no se pisaron"); }

  console.log("\n— Leer una clave con la sesion —");
  { const { data, error } = await adminA.client.rpc("read_secret", { secret_name: SECRET, workspace_id: wsA });
    if (POST_00143) {
      check(!!error && /permission denied/.test(error.message) && data == null,
        "el Admin de A NO puede leer ni la suya desde el navegador (00143)", error?.message ?? `devolvio: ${data}`);
    } else {
      check(data === "valor-de-A", "el Admin de A todavia lee la suya (antes de la 00143)", error?.message);
    } }

  console.log("\n— El Admin de B no puede tocar los secretos de A —");
  { const { data, error } = await adminB.client.rpc("read_secret", { secret_name: SECRET, workspace_id: wsA });
    check(forbidden(error) && data == null, "no puede leerlo", error?.message ?? `devolvio: ${data}`); }
  { const { error } = await adminB.client.rpc("store_secret",
      { secret_name: SECRET, secret_value: "pisado-por-B", workspace_id: wsA });
    check(forbidden(error), "no puede pisarlo", error?.message);
    const { data } = await svc.rpc("read_secret", { secret_name: SECRET, workspace_id: wsA });
    check(data === "valor-de-A", "y el valor de A sigue intacto"); }
  { const { error } = await adminB.client.rpc("store_secret",
      { secret_name: "zz_test_iso_nuevo", secret_value: "x", workspace_id: wsA });
    check(forbidden(error), "no puede crear uno nuevo en A", error?.message);
    secretsToDelete.push([wsA, "zz_test_iso_nuevo"]); }
  { const { error } = await adminB.client.rpc("delete_secret", { secret_name: SECRET, workspace_id: wsA });
    check(forbidden(error), "no puede borrarlo", error?.message); }
  { const { data, error } = await adminB.client.rpc("list_secret_names", { workspace_id: wsA });
    check(forbidden(error) && data == null, "no puede listar los nombres de A", error?.message); }
  { const { data } = await adminB.client.rpc("list_secret_names", { workspace_id: wsB });
    const nombres = (data ?? []).map((r) => (typeof r === "string" ? r : Object.values(r)[0]));
    check(nombres.length === 1 && nombres.every((n) => !String(n).includes(wsA)),
      "su propia lista no trae nada de A", `vio: ${JSON.stringify(nombres)}`); }

  console.log("\n— El nombre no se puede usar para salirse del prefijo —");
  // Con el service role: se saltea el chequeo de Admin, asi que lo unico que
  // lo frena es la validacion del nombre (vault_secret_key).
  { const { error } = await svc.rpc("read_secret",
      { secret_name: `ws:${wsA}:${SECRET}`, workspace_id: wsB });
    check(!!error, "un nombre con ':' (ws:<A>:...) se rechaza", "la base lo acepto"); }

  console.log("\n— La anon key no llega a Vault —");
  { const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data, error } = await anon.rpc("read_secret", { secret_name: SECRET, workspace_id: wsA });
    check(!!error && data == null, "sin sesion no se puede leer nada", `devolvio: ${data}`); }

  console.log("\n— integration_configs —");
  { const { data: cfgA, error } = await svc.from("integration_configs").insert({
      workspace_id: wsA, type: "ai_provider", provider: "openai", display_name: "zz-test openai A",
      vault_secret_name: SECRET, is_active: true,
    }).select("id").single();
    if (error) throw new Error(`no pude crear la integracion de A: ${error.message}`);

    const { data: veA } = await adminA.client.from("integration_configs").select("id").eq("id", cfgA.id);
    check((veA ?? []).length === 1, "el Admin de A ve su integracion");
    const { data: veB } = await adminB.client.from("integration_configs").select("id").eq("workspace_id", wsA);
    check((veB ?? []).length === 0, "el Admin de B no ve ninguna integracion de A");

    await adminB.client.from("integration_configs").update({ is_active: false }).eq("id", cfgA.id);
    const { data: sigue } = await svc.from("integration_configs").select("is_active").eq("id", cfgA.id).single();
    check(sigue.is_active === true, "ni puede apagarla");

    const { error: eIns } = await adminB.client.from("integration_configs").insert({
      workspace_id: wsA, type: "ai_provider", provider: "anthropic", display_name: "zz-test colada", is_active: true,
    });
    // El error tiene que ser de la RLS, no de otra cosa (un tipo invalido
    // tambien falla, y el caso pasaria sin probar nada).
    check(!!eIns && /row-level security|permission denied/.test(eIns.message),
      "ni crear una integracion a nombre de A", eIns?.message ?? "la inserto");

    await adminB.client.from("integration_configs").delete().eq("id", cfgA.id);
    const { data: noBorrada } = await svc.from("integration_configs").select("id").eq("id", cfgA.id);
    check((noBorrada ?? []).length === 1, "ni borrarla"); }

  console.log("\n— Alta por invitacion: sin workspace propio (00119) —");
  { // Lo mismo que hace registerFromInvite: crea la cuenta con el invite_id en
    // los metadatos. El trigger tiene que reconocer la invitacion pendiente y
    // NO armarle un "<nombre>'s Workspace". La membresia la suma despues
    // finalizeAcceptInvite; aca solo se mira lo que hace el trigger.
    const email = `zz-test-iso-invitada-${Date.now()}@example.test`;
    const { data: invite, error: eInv } = await svc.from("workspace_invites")
      .insert({ workspace_id: wsA, email, role: "member", invited_by: adminA.id }).select("id").single();
    if (eInv) throw new Error(`no pude crear la invitacion: ${eInv.message}`);

    const { data: created, error: eUser } = await svc.auth.admin.createUser({
      email, password: randomUUID(), email_confirm: true,
      // full_name con el prefijo: si el trigger fallara y creara el
      // workspace, se llamaria "zz-test-...'s Workspace" y la limpieza se lo lleva.
      user_metadata: { full_name: "zz-test-iso-invitada", invite_id: invite.id },
    });
    if (eUser) throw new Error(`no pude crear la cuenta invitada: ${eUser.message}`);

    const { data: suyos } = await svc.from("workspace_members").select("workspace_id").eq("user_id", created.user.id);
    check((suyos ?? []).length === 0, "la persona invitada no recibe un workspace propio",
      `quedo en ${(suyos ?? []).length} workspace(s)`); }
  { // Y el control: sin invitacion, el trigger sigue armando el workspace
    // (es como scripts/create-owner.mjs crea el primer Owner de una copia).
    const { data: created } = await svc.auth.admin.createUser({
      email: `zz-test-iso-sin-invite-${Date.now()}@example.test`, password: randomUUID(), email_confirm: true,
    });
    const { data: suyos } = await svc.from("workspace_members").select("role").eq("user_id", created.user.id);
    check((suyos ?? []).length === 1 && suyos[0].role === "owner",
      "sin invitacion, el alta si crea su workspace (el camino de create-owner)"); }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  for (const [ws, name] of secretsToDelete) {
    const { error } = await svc.rpc("delete_secret", { secret_name: name, workspace_id: ws });
    if (error) { console.error(`  no pude borrar el secreto ${name}: ${error.message}`); failures++; }
  }
  if (!(await runCleanup(svc))) failures++;
}
console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
