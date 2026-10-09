#!/usr/bin/env node
/**
 * Verificacion de los roles personalizados (F69, F71, F72).
 *
 * Corre contra la base real con usuarios de verdad. Prueba lo que los tests
 * de vitest NO pueden probar: que el alcance de un rol lo aplique la BASE, y
 * no solo la pantalla.
 *
 * Lo que mas importa es la prueba POSITIVA: un rol personalizado con alcance
 * `all` en leads ve todos los contactos del workspace, incluidos los de
 * otras personas. `verify-rls.mjs` prueba lo contrario (que un Member no ve
 * de mas); sin esta, el alcance `all` podria no funcionar y nadie se
 * enteraria hasta crear el primer rol de verdad.
 *
 * Crea y borra todo lo suyo. Una limpieza que falla es una prueba que falla.
 *
 *   node scripts/verify-roles.mjs                      # antes de aplicar la 00136
 *   node scripts/verify-roles.mjs --despues-de-00136   # y despues: suma el alcance own_unassigned
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

/** Cuantos contactos ve esa persona. */
async function contactCount(user, wsId) {
  const { data } = await user.client.from("contacts").select("id").eq("workspace_id", wsId);
  return (data ?? []).length;
}

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-roles-v", slug: `zz-test-rolesv-${Date.now()}` }).select("id").single();

  // Un workspace nuevo ya nace con el scope de leads prendido y los sin asignar
  // cerrados (lo que fijan las columnas por defecto hasta la 00136, y despues
  // el Member de sistema con alcance `own`): no hace falta forzar nada.

  const admin = await makeUser("roles-admin");
  const acotado = await makeUser("roles-acotado");
  const amplio = await makeUser("roles-amplio");

  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: acotado.id, role: "member" },
    { workspace_id: ws.id, user_id: amplio.id, role: "member" },
  ]);

  console.log("\n— Los tres roles de sistema se crearon solos —");
  {
    const { data: roles } = await svc.from("workspace_roles")
      .select("name, system_role").eq("workspace_id", ws.id);

    const sistema = (roles ?? []).filter((r) => r.system_role).map((r) => r.system_role).sort();
    check(sistema.join(",") === "admin,member,owner",
      "un workspace nuevo nace con Owner, Admin y Member", JSON.stringify(sistema));
  }

  console.log("\n— Un rol personalizado con alcance `all` ve todos los leads —");
  let rolAmplio;
  {
    const { data, error } = await svc.from("workspace_roles").insert({
      workspace_id: ws.id,
      name: "zz-test Supervisor",
      description: "Ve todos los leads del negocio",
      permissions: {
        keys: ["contacts.view", "dashboards.content.view"],
        scopes: { leads: "all", conversations: "all" },
      },
    }).select("id").single();
    check(!error && !!data, "se puede crear un rol personalizado", error?.message);
    rolAmplio = data;

    // Dos contactos: uno del acotado, uno de nadie conocido.
    const { data: suyo } = await svc.from("contacts").insert({
      workspace_id: ws.id, display_name: "zz-test lead propio", setter_id: acotado.id,
    }).select("id").single();
    const { data: ajeno } = await svc.from("contacts").insert({
      workspace_id: ws.id, display_name: "zz-test lead de otro", setter_id: admin.id,
    }).select("id").single();

    check(await contactCount(acotado, ws.id) === 1,
      "un Member sin rol asignado ve solo el lead que tiene asignado");

    // Ahora se le da el rol amplio al segundo member.
    await svc.from("workspace_members")
      .update({ role_id: rolAmplio.id })
      .eq("workspace_id", ws.id).eq("user_id", amplio.id);

    check(await contactCount(amplio, ws.id) === 2,
      "con alcance `all`, ve los DOS leads aunque ninguno sea suyo");

    // Y el otro sigue viendo uno: el rol es de una persona, no del workspace.
    check(await contactCount(acotado, ws.id) === 1,
      "el rol de una persona no le cambia el alcance a las demas");

    // Las conversaciones siguen la misma regla.
    const { data: ch } = await svc.from("channels").insert({
      workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-r-${Date.now()}`,
      username: "zztestroles", display_name: "zz test roles", is_active: true,
    }).select("id").single();
    await svc.from("conversations").insert({
      workspace_id: ws.id, channel_id: ch.id, contact_id: ajeno.id, platform: "instagram",
    });

    const verConv = async (u) => {
      const { data } = await u.client.from("conversations").select("id").eq("workspace_id", ws.id);
      return (data ?? []).length;
    };
    check(await verConv(amplio) === 1, "con alcance `all` en conversaciones, ve la del lead ajeno");
    check(await verConv(acotado) === 0, "el otro Member no ve esa conversacion");
  }

  console.log("\n— Bajarle el alcance a `own` lo vuelve a acotar —");
  {
    await svc.from("workspace_roles").update({
      permissions: { keys: ["contacts.view"], scopes: { leads: "own", conversations: "own" } },
    }).eq("id", rolAmplio.id);

    check(await contactCount(amplio, ws.id) === 0,
      "sin leads asignados y con alcance `own`, no ve ninguno");
  }

  if (process.argv.includes("--despues-de-00136")) {
    console.log("\n— Alcance `own_unassigned`: los suyos + los sin asignar (00136) —");
    {
      const { data: libre } = await svc.from("contacts").insert({
        workspace_id: ws.id, display_name: "zz-test lead sin asignar",
      }).select("id").single();

      await svc.from("workspace_roles").update({
        permissions: { keys: ["contacts.view"], scopes: { leads: "own_unassigned", conversations: "own" } },
      }).eq("id", rolAmplio.id);

      // Hay tres leads: el del acotado, el de otra persona (admin) y el libre.
      check(await contactCount(amplio, ws.id) === 1,
        "ve el que no tiene a nadie asignado, y NO los que tienen a otra persona");

      // Si se lo asignan a el, lo sigue viendo; si se lo asignan a otro, deja de verlo.
      await svc.from("contacts").update({ setter_id: amplio.id }).eq("id", libre.id);
      check(await contactCount(amplio, ws.id) === 1, "asignado a el, lo sigue viendo");
      await svc.from("contacts").update({ setter_id: acotado.id }).eq("id", libre.id);
      check(await contactCount(amplio, ws.id) === 0, "asignado a otra persona, deja de verlo");
      await svc.from("contacts").update({ setter_id: null }).eq("id", libre.id);
      check(await contactCount(amplio, ws.id) === 1, "y al quedar libre, vuelve a verlo");

      // El Member sin rol personalizado no gana nada por esto.
      check(await contactCount(acotado, ws.id) === 1,
        "el Member de sistema (alcance own) NO ve el lead sin asignar");
    }
  }

  console.log("\n— Los roles de sistema no se tocan —");
  {
    const { data: member } = await svc.from("workspace_roles")
      .select("id").eq("workspace_id", ws.id).eq("system_role", "member").single();

    { const { error } = await svc.from("workspace_roles")
        .update({ permissions: { keys: [] } }).eq("id", member.id);
      check(!!error, "ni el service role puede cambiarle los permisos al rol Member", error?.message); }

    { const { error } = await svc.from("workspace_roles")
        .update({ name: "Otro nombre" }).eq("id", member.id);
      check(!!error, "ni renombrarlo"); }

    { const { error } = await svc.from("workspace_roles").delete().eq("id", member.id);
      check(!!error, "ni borrarlo"); }

    { const { error } = await svc.from("workspace_roles")
        .update({ description: "Una descripcion nueva" }).eq("id", member.id);
      check(!error, "pero la descripcion si se puede cambiar: es texto y no afecta a nadie", error?.message); }
  }

  console.log("\n— Quien puede escribir roles —");
  {
    { const { error } = await acotado.client.from("workspace_roles").insert({
        workspace_id: ws.id, name: "zz-test Colado",
        permissions: { keys: ["settings.manage"], scopes: {} },
      });
      check(!!error, "un Member no puede crearse un rol con permisos"); }

    { const { data, error } = await admin.client.from("workspace_roles").insert({
        workspace_id: ws.id, name: "zz-test Del admin",
        permissions: { keys: ["contacts.view"], scopes: { leads: "own", conversations: "own" } },
      }).select("id");
      check(!error && (data ?? []).length === 1, "un Admin si", error?.message); }

    { const { error } = await admin.client.from("workspace_roles").insert({
        workspace_id: ws.id, name: "zz-test Falso sistema", system_role: "owner",
        permissions: { keys: [], scopes: {} },
      });
      check(!!error, "nadie puede fabricarse un rol marcado como de sistema"); }

    const { data: visibles } = await acotado.client.from("workspace_roles")
      .select("id").eq("workspace_id", ws.id);
    check((visibles ?? []).length > 0,
      "un Member SI ve la lista de roles: la necesita el selector del equipo");
  }

  console.log("\n— Aislamiento entre workspaces —");
  {
    const otro = await makeUser("roles-otro");
    const { data: wsOtro } = await svc.from("workspaces")
      .insert({ name: "zz-test-roles-otro", slug: `zz-test-rolesotro-${Date.now()}` }).select("id").single();
    await svc.from("workspace_members")
      .insert({ workspace_id: wsOtro.id, user_id: otro.id, role: "owner" });

    const { data: ajenos } = await otro.client.from("workspace_roles")
      .select("id").eq("workspace_id", ws.id);
    check((ajenos ?? []).length === 0, "otro workspace no ve los roles de este");

    check(await contactCount(otro, ws.id) === 0, "ni sus contactos");
  }

  console.log("\n— has_permission y permission_scope —");
  {
    // Se consultan con el cliente del usuario: son SECURITY DEFINER y miran
    // auth.uid(), asi que con el service role no dirian nada util.
    const { data: puedeAdmin } = await admin.client.rpc("has_permission", {
      p_workspace_id: ws.id, p_key: "settings.manage",
    });
    check(puedeAdmin === true, "un Admin tiene todos los permisos segun la base");

    const { data: puedeMember } = await acotado.client.rpc("has_permission", {
      p_workspace_id: ws.id, p_key: "settings.manage",
    });
    check(puedeMember === false, "un Member no");

    const { data: scopeAdmin } = await admin.client.rpc("permission_scope", {
      p_workspace_id: ws.id, p_module: "leads",
    });
    check(scopeAdmin === "all", "el alcance de un Admin es `all`");

    const { data: scopeMember } = await acotado.client.rpc("permission_scope", {
      p_workspace_id: ws.id, p_module: "leads",
    });
    check(scopeMember === "own", "el de un Member sin rol, `own`");
  }
} catch (err) {
  fail("error inesperado", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\n— Limpieza —");
  // Una limpieza que falla es una prueba que falla: deja datos zz-test- que
  // ensucian la proxima corrida.
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
