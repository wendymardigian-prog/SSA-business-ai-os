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
 *   node scripts/verify-roles.mjs --despues-de-00136 --despues-de-00208   # has_permission v2 (Member, Admin, Owner)
 *   node scripts/verify-roles.mjs --despues-de-00136 --despues-de-00208 --despues-de-00211   # y el retiro de settings.manage
 *   node scripts/verify-roles.mjs --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212   # y la RLS de equipo (invitar, asignar, editar roles)
 *   ... --despues-de-00249   # y la bandeja por cuenta (dos Instagram, alcances por cuenta, "todas", la ficha y "no podes dar")
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Equipo y roles (B1): comprobaciones de las migraciones 00208 (has_permission v2) y 00211 (settings.manage).
const POST_00208 = process.argv.includes("--despues-de-00208");
const POST_00211 = process.argv.includes("--despues-de-00211");
const POST_00212 = process.argv.includes("--despues-de-00212");
const POST_00249 = process.argv.includes("--despues-de-00249");
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
        scopes: { leads: "all" },
        // La bandeja por cuenta (00249): todas las cuentas, todas las conversaciones.
        channels: { mode: "all", all: { scope: "all", reply: true } },
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
        permissions: { keys: ["settings.general"], scopes: {} },
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
      p_workspace_id: ws.id, p_key: "settings.general",
    });
    check(puedeAdmin === true, "un Admin tiene todos los permisos segun la base");

    const { data: puedeMember } = await acotado.client.rpc("has_permission", {
      p_workspace_id: ws.id, p_key: "settings.general",
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

  if (POST_00208) {
    console.log("\n— has_permission v2 (00208): el Member de sistema, el Admin, el Owner y los roles personalizados —");
    const hp = async (u, key) => (await u.client.rpc("has_permission", { p_workspace_id: ws.id, p_key: key })).data;
    const dueno = await makeUser("roles-owner");
    const conRolSistema = await makeUser("roles-member-sistema");
    const { data: rolMember } = await svc.from("workspace_roles").select("id").eq("workspace_id", ws.id).eq("system_role", "member").single();
    const personalizado = await makeUser("roles-personalizado");
    const { data: rolInvita } = await svc.from("workspace_roles").insert({
      workspace_id: ws.id, name: "zz-test Solo invita",
      permissions: { keys: ["team.invite"], scopes: { leads: "own", conversations: "own" } },
    }).select("id").single();
    await svc.from("workspace_members").insert([
      { workspace_id: ws.id, user_id: dueno.id, role: "owner" },
      { workspace_id: ws.id, user_id: conRolSistema.id, role: "member", role_id: rolMember.id },
      { workspace_id: ws.id, user_id: personalizado.id, role: "member", role_id: rolInvita.id },
    ]);

    // El Member de sistema, sin rol asignado y con la fila del rol de sistema: lo mismo.
    for (const [quien, u] of [["sin rol asignado", acotado], ["con el rol de sistema Member", conRolSistema]]) {
      check((await hp(u, "contacts.view")) === true, `un Member ${quien}: contacts.view = true`);
      check((await hp(u, "flows.publish")) === true, `un Member ${quien}: flows.publish = true`);
      check((await hp(u, "contacts.assign")) === true, `un Member ${quien}: contacts.assign = true`);
      check((await hp(u, "team.invite")) === false, `un Member ${quien}: team.invite = false`);
      check((await hp(u, "sequences.edit")) === false, `un Member ${quien}: sequences.edit = false (sale de su lista)`);
      check((await hp(u, "contacts.import")) === false, `un Member ${quien}: contacts.import = false`);
      check((await hp(u, "clave.que.no.existe")) === false, `un Member ${quien}: una clave inexistente = false`);
    }
    // Nunca NULL.
    { const { data } = await acotado.client.rpc("has_permission", { p_workspace_id: ws.id, p_key: null });
      check(data === false, "has_permission con clave NULL devuelve false, no NULL"); }

    check((await hp(admin, "settings.general")) === true, "un Admin tiene settings.general");
    check((await hp(admin, "team.invite")) === true, "un Admin tiene team.invite");
    check((await hp(admin, "team.remove")) === false, "un Admin NO tiene team.remove (solo-Owner)");
    check((await hp(admin, "workspace.transfer")) === false, "un Admin NO tiene workspace.transfer (solo-Owner)");
    check((await hp(dueno, "team.remove")) === true, "el Owner SI tiene team.remove");
    check((await hp(dueno, "workspace.transfer")) === true, "el Owner SI tiene workspace.transfer");

    // Un rol personalizado NO hereda la lista del Member: tiene lo que tildó y nada mas.
    check((await hp(personalizado, "team.invite")) === true, "un rol personalizado tiene lo que tiene tildado");
    check((await hp(personalizado, "contacts.view")) === false, "y NO hereda la lista del Member");

    // Quien no es miembro del workspace no tiene nada.
    const otro = await makeUser("roles-ajeno-hp");
    check((await hp(otro, "contacts.view")) === false, "quien no es miembro de ese workspace: false");
  }

  if (POST_00211) {
    console.log("\n— settings.manage se retira (00211): el jsonb de los roles personalizados se migra —");
    const { data: viejo } = await svc.from("workspace_roles").insert({
      workspace_id: ws.id, name: "zz-test Rol viejo",
      permissions: {
        keys: ["settings.manage", "flows.edit", "team.manage", "roles.manage", "integrations.manage", "agents.edit", "contacts.edit", "contacts.view"],
        scopes: { leads: "own", conversations: "own" },
      },
    }).select("id").single();
    const { data: sinNada } = await svc.from("workspace_roles").insert({
      workspace_id: ws.id, name: "zz-test Rol sin claves viejas",
      permissions: { keys: ["contacts.view"], scopes: { leads: "own", conversations: "own" } },
    }).select("id").single();

    // Se vuelve a correr el UPDATE de la migracion (es idempotente) sobre estos roles recien creados.
    const sql = readFileSync("supabase/migrations/00211_retire_settings_manage.sql", "utf8");
    const dir = mkdtempSync(join(tmpdir(), "verify-roles-"));
    const file = join(dir, "q.sql");
    writeFileSync(file, sql.slice(sql.indexOf("UPDATE public.workspace_roles r")));
    try { execFileSync("supabase", ["db", "query", "--linked", "-f", file], { stdio: "pipe" }); }
    catch (e) { fail("no pude correr el UPDATE de la 00211 (¿esta la CLI de Supabase?)", String(e.message).slice(0, 200)); }

    const { data: despues } = await svc.from("workspace_roles").select("id, permissions").in("id", [viejo.id, sinNada.id]);
    const keys = (id) => (despues ?? []).find((r) => r.id === id)?.permissions?.keys ?? [];
    for (const k of ["settings.general", "sales.settings", "products.manage", "assignment.manage"]) {
      check(keys(viejo.id).includes(k), `un rol con settings.manage recibe ${k}`);
    }
    check(!keys(viejo.id).includes("settings.manage"), "y ya no tiene settings.manage");
    for (const k of ["flows.publish", "webhooks.manage", "team.view", "team.invite", "roles.view", "integrations.view", "channels.manage", "ai_tasks.manage", "ai_limits.manage", "contacts.assign"]) {
      check(keys(viejo.id).includes(k), `las claves que se parten le suman ${k}`);
    }
    for (const k of ["flows.edit", "team.manage", "roles.manage", "integrations.manage", "agents.edit", "contacts.edit", "contacts.view"]) {
      check(keys(viejo.id).includes(k), `y conserva ${k}`);
    }
    check(JSON.stringify(keys(sinNada.id)) === JSON.stringify(["contacts.view"]), "un rol sin claves viejas no cambia");

    // Ninguna politica viva sigue pidiendo la clave que ya no existe.
    try {
      const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json",
        "select count(*)::int as n from pg_policies where schemaname='public' and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%settings.manage%'"], { stdio: "pipe" }).toString();
      check(JSON.parse(out).rows[0].n === 0, "ninguna politica viva menciona settings.manage");
    } catch (e) { fail("no pude consultar pg_policies", String(e.message).slice(0, 200)); }
  }

  if (POST_00212) {
    console.log("\n— RLS de equipo (00212): no podes dar lo que no tenes —");
    const casos = JSON.parse(readFileSync("lib/team/grant.cases.json", "utf8")).cases;
    const dueno2 = await makeUser("roles-owner-212");
    await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: dueno2.id, role: "owner" });

    // Un rol personalizado "Gestor" con las tres claves de equipo: es el atacante de las pruebas de abajo.
    const mkRole = async (name, keys, scopes = { leads: "own", conversations: "own" }) => {
      const { data, error } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name, permissions: { keys, scopes } }).select("id").single();
      if (error) throw new Error(`no pude crear el rol ${name}: ${error.message}`);
      return data.id;
    };
    const rolGestor = await mkRole("zz-test Gestor", ["team.invite", "team.manage", "roles.manage", "contacts.view"]);
    const rolSoloContactos = await mkRole("zz-test Solo contactos", ["contacts.view"]);
    const rolConFlows = await mkRole("zz-test Con flujos", ["flows.edit"]);
    const gestor = await makeUser("roles-gestor");
    await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: gestor.id, role: "member", role_id: rolGestor });

    // 1) Los casos compartidos, contra la gemela SQL.
    const actores = new Map(); // JSON del rol personalizado -> usuario
    const actorUser = async (a) => {
      if (a === "owner") return dueno2;
      if (a === "admin") return admin;
      if (a === "member") return acotado;
      const k = JSON.stringify(a);
      if (!actores.has(k)) {
        const u = await makeUser(`roles-actor-${actores.size}`);
        const id = await mkRole(`zz-test Actor ${actores.size}`, a.keys, a.scopes);
        await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: u.id, role: "member", role_id: id });
        actores.set(k, u);
      }
      return actores.get(k);
    };
    for (const c of casos) {
      const u = await actorUser(c.actor);
      const { data, error } = await u.client.rpc("can_grant_permissions", { p_workspace_id: ws.id, p_keys: c.keys, p_scopes: c.scopes });
      check(!error && data === c.allowed, `can_grant_permissions: ${c.name}`, error?.message ?? `esperaba ${c.allowed}, dio ${data}`);
    }

    // 2) Invitaciones.
    const inv = (u, extra) => u.client.from("workspace_invites").insert({ workspace_id: ws.id, email: `zz-test-inv-${randomUUID().slice(0, 8)}@example.test`, invited_by: u.id, delivery: "link", ...extra }).select("id").single();
    {
      const r = await inv(gestor, { role: "member", role_id: rolSoloContactos });
      check(!r.error && !!r.data, "un rol con team.invite invita con un rol cuyas claves el tiene", r.error?.message);
    }
    check((await inv(gestor, { role: "member", role_id: rolConFlows })).error !== null, "...pero no con un rol que tiene una clave que NO tiene (flows.edit)");
    check((await inv(gestor, { role: "member", role_id: null })).error !== null, "...ni como Member de sistema (tiene 27 claves que el no tiene)");
    check((await inv(gestor, { role: "admin", role_id: null })).error !== null, "...ni como Admin");
    {
      const { data: rolAdminSis } = await svc.from("workspace_roles").select("id").eq("workspace_id", ws.id).eq("system_role", "admin").single();
      check((await inv(gestor, { role: "member", role_id: rolAdminSis.id })).error !== null, "...ni con el rol de sistema Admin aunque diga role=member");
      const { data: rolOwnerSis } = await svc.from("workspace_roles").select("id").eq("workspace_id", ws.id).eq("system_role", "owner").single();
      check((await inv(admin, { role: "admin", role_id: rolOwnerSis.id })).error !== null, "ni un Admin invita con el rol Owner");
    }
    {
      const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-roles-v2", slug: `zz-test-rolesv2-${Date.now()}` }).select("id").single();
      const { data: rolAjeno } = await svc.from("workspace_roles").insert({ workspace_id: ws2.id, name: "zz-test Rol de otro workspace", permissions: { keys: ["contacts.view"], scopes: {} } }).select("id").single();
      check((await inv(gestor, { role: "member", role_id: rolAjeno.id })).error !== null, "no se puede invitar con un rol de OTRO workspace");
    }
    check((await inv(acotado, { role: "member", role_id: rolSoloContactos })).error !== null, "un Member de sistema (sin team.invite) no puede invitar");
    check(!(await inv(admin, { role: "admin", role_id: null })).error, "un Admin si invita como Admin");
    check(!(await inv(dueno2, { role: "member", role_id: rolConFlows })).error, "el Owner invita con cualquier rol personalizado");

    // El invitado ya no puede editar su propia invitacion (el agujero que la 00212 cierra).
    {
      const invitado = await makeUser("roles-invitado");
      const emailInvitado = (await svc.auth.admin.getUserById(invitado.id)).data.user.email;
      const { data: miInv } = await svc.from("workspace_invites").insert({ workspace_id: ws.id, email: emailInvitado, invited_by: admin.id, role: "member", delivery: "link" }).select("id").single();
      await invitado.client.from("workspace_invites").update({ role: "admin" }).eq("id", miInv.id);
      const { data: despues } = await svc.from("workspace_invites").select("role").eq("id", miInv.id).single();
      check(despues.role === "member", "la persona invitada NO puede cambiarse el rol en su propia invitacion");
    }

    // 3) Asignar roles a miembros.
    const rolDe = async (uid) => (await svc.from("workspace_members").select("role, role_id").eq("workspace_id", ws.id).eq("user_id", uid).single()).data;
    {
      const objetivo = await makeUser("roles-objetivo");
      await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: objetivo.id, role: "member", role_id: null });
      const mover = (u, who, patch) => u.client.from("workspace_members").update(patch).eq("workspace_id", ws.id).eq("user_id", who);
      await mover(gestor, objetivo.id, { role: "admin" });
      check((await rolDe(objetivo.id)).role === "member", "un rol con team.manage NO puede subir a alguien a Admin");
      await mover(gestor, objetivo.id, { role_id: rolConFlows });
      check((await rolDe(objetivo.id)).role_id === null, "...ni darle un rol con claves que no tiene");
      await mover(gestor, objetivo.id, { role_id: rolSoloContactos });
      check((await rolDe(objetivo.id)).role_id === rolSoloContactos, "...pero si le da un rol cuyas claves tiene");
      await mover(gestor, dueno2.id, { role: "member" });
      check((await rolDe(dueno2.id)).role === "owner", "nadie con team.manage toca al Owner");
      await mover(admin, objetivo.id, { role: "admin" });
      check((await rolDe(objetivo.id)).role === "admin", "un Admin si puede promover a otra persona");
      // Quitar personas: solo el Owner.
      await admin.client.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", objetivo.id);
      check(!!(await rolDe(objetivo.id)), "un Admin NO puede quitar personas (team.remove es solo del Owner)");
      await gestor.client.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", objetivo.id);
      check(!!(await rolDe(objetivo.id)), "un rol con team.manage tampoco");
      await dueno2.client.from("workspace_members").delete().eq("workspace_id", ws.id).eq("user_id", objetivo.id);
      const sigue = (await svc.from("workspace_members").select("user_id").eq("workspace_id", ws.id).eq("user_id", objetivo.id)).data ?? [];
      check(sigue.length === 0, "el Owner si puede quitar a alguien");
    }

    // 4) Roles.
    {
      const nuevo = (u, perms, extra = {}) => u.client.from("workspace_roles").insert({ workspace_id: ws.id, name: `zz-test Rol ${randomUUID().slice(0, 6)}`, permissions: perms, ...extra }).select("id").single();
      const r1 = await nuevo(gestor, { keys: ["contacts.view"], scopes: { leads: "own", conversations: "own" } });
      check(!r1.error && !!r1.data, "un rol con roles.manage crea un rol con claves que tiene", r1.error?.message);
      check((await nuevo(gestor, { keys: ["flows.edit"], scopes: {} })).error !== null, "...pero no uno con una clave que NO tiene");
      check((await nuevo(gestor, { keys: ["contacts.view"], scopes: { leads: "all" } })).error !== null, "...ni con un alcance mas ancho que el suyo");
      check((await nuevo(gestor, { keys: ["team.remove"], scopes: {} })).error !== null, "...ni con una clave solo-Owner");
      check((await nuevo(gestor, { keys: [], scopes: {} }, { system_role: "admin" })).error !== null, "...ni un rol de sistema");
      check(!(await nuevo(admin, { keys: ["flows.edit", "roles.manage"], scopes: { leads: "all", conversations: "all" } })).error, "un Admin crea un rol con cualquier clave comun");
      check((await nuevo(acotado, { keys: ["contacts.view"], scopes: {} })).error !== null, "un Member de sistema (sin roles.manage) no crea roles");

      const keysDe = async (id) => (await svc.from("workspace_roles").select("permissions").eq("id", id).single()).data.permissions.keys;
      // Editar el rol que tiene asignado: no.
      await gestor.client.from("workspace_roles").update({ permissions: { keys: ["team.invite", "team.manage", "roles.manage", "contacts.view"], scopes: { leads: "all" } } }).eq("id", rolGestor);
      check(!(await keysDe(rolGestor)).includes("flows.edit") && (await svc.from("workspace_roles").select("permissions").eq("id", rolGestor).single()).data.permissions.scopes.leads === "own", "nadie edita el rol que tiene asignado");
      // Agregar una clave que no tiene: el trigger lo frena.
      const r = await gestor.client.from("workspace_roles").update({ permissions: { keys: ["contacts.view", "flows.edit"], scopes: { leads: "own", conversations: "own" } } }).eq("id", rolSoloContactos).select("id");
      check(/permisos que no ten/.test(r.error?.message ?? "") && !(await keysDe(rolSoloContactos)).includes("flows.edit"), "no puede AGREGAR a un rol una clave que no tiene (lo frena el trigger, no otro error)", r.error?.message ?? "no dio error");
      // Agregar una que si tiene: bien.
      await gestor.client.from("workspace_roles").update({ permissions: { keys: ["contacts.view", "team.invite"], scopes: { leads: "own", conversations: "own" } } }).eq("id", rolSoloContactos);
      check((await keysDe(rolSoloContactos)).includes("team.invite"), "puede agregar a un rol una clave que si tiene");
      // Sacar permisos nunca es una escalada: tambien de un rol con claves que el no tiene.
      const sacar = await gestor.client.from("workspace_roles").update({ permissions: { keys: [], scopes: { leads: "own", conversations: "own" } } }).eq("id", rolConFlows).select("id");
      check(!sacar.error && (await keysDe(rolConFlows)).length === 0, "sacarle todos los permisos a un rol esta permitido", sacar.error?.message);
      // Un Admin edita cualquiera (y sube un alcance, que el gestor no podria).
      const adminEdita = await admin.client.from("workspace_roles").update({ permissions: { keys: ["flows.publish", "contacts.view"], scopes: { leads: "all", conversations: "own" } } }).eq("id", rolConFlows).select("id");
      const despuesAdmin = (await svc.from("workspace_roles").select("permissions").eq("id", rolConFlows).single()).data.permissions;
      check(!adminEdita.error && despuesAdmin.keys.includes("flows.publish") && despuesAdmin.scopes.leads === "all", "un Admin edita cualquier rol personalizado, alcances incluidos", adminEdita.error?.message);
      const gestorSube = await gestor.client.from("workspace_roles").update({ permissions: { keys: ["contacts.view", "team.invite"], scopes: { leads: "all", conversations: "own" } } }).eq("id", rolSoloContactos).select("id");
      check(/permisos que no ten/.test(gestorSube.error?.message ?? ""), "y el gestor no puede subir un alcance al editar (lo frena el trigger)", gestorSube.error?.message ?? "no dio error");
      // Los roles de sistema no se tocan.
      const { data: rolMemberSis } = await svc.from("workspace_roles").select("id, permissions").eq("workspace_id", ws.id).eq("system_role", "member").single();
      await admin.client.from("workspace_roles").update({ name: "Hackeado" }).eq("id", rolMemberSis.id);
      check((await svc.from("workspace_roles").select("name").eq("id", rolMemberSis.id).single()).data.name !== "Hackeado", "un rol de sistema no se renombra ni siquiera un Admin");
      // Borrar.
      const { data: borrable } = await svc.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Borrable", permissions: { keys: ["contacts.view"], scopes: {} } }).select("id").single();
      await gestor.client.from("workspace_roles").delete().eq("id", rolGestor);
      check(!!(await svc.from("workspace_roles").select("id").eq("id", rolGestor).maybeSingle()).data, "nadie borra el rol que tiene asignado");
      await gestor.client.from("workspace_roles").delete().eq("id", rolMemberSis.id);
      check(!!(await svc.from("workspace_roles").select("id").eq("id", rolMemberSis.id).maybeSingle()).data, "un rol de sistema no se borra");
      await acotado.client.from("workspace_roles").delete().eq("id", borrable.id);
      check(!!(await svc.from("workspace_roles").select("id").eq("id", borrable.id).maybeSingle()).data, "un Member de sistema no borra roles");
      await gestor.client.from("workspace_roles").delete().eq("id", borrable.id);
      check(!(await svc.from("workspace_roles").select("id").eq("id", borrable.id).maybeSingle()).data, "un rol con roles.manage borra un rol personalizado que no es el suyo");
    }
  }
  if (POST_00249) {
    console.log("\n— La bandeja por cuenta (00249) —");
    const casos = JSON.parse(readFileSync("lib/auth/channel-permissions.cases.json", "utf8"));
    const resolver = (v) => {
      if (Array.isArray(v)) return v.map(resolver);
      if (!v || typeof v !== "object") return v;
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [casos.ids[k] ?? k, resolver(x)]));
    };
    const lit = (v) => (v === null ? "NULL::jsonb" : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`);

    // 1) grantFor contra la gemela SQL (pura: se pregunta con la CLI).
    {
      const sql = casos.grantFor
        .map((c, i) => `select ${i} as i, (private.role_channel_grant(${lit(resolver(c.channels))}, '${casos.ids[c.channel]}') is not distinct from ${lit(c.expected)}) as ok`)
        .join(" union all ");
      try {
        const out = execFileSync("supabase", ["db", "query", "--linked", "-o", "json", `select json_agg(x) as r from (${sql}) x`], { stdio: "pipe" }).toString();
        const rows = JSON.parse(out).rows[0].r;
        for (const row of rows) check(row.ok, `role_channel_grant: ${casos.grantFor[row.i].name}`);
      } catch (e) { fail("no pude correr los casos de role_channel_grant (¿esta la CLI de Supabase?)", String(e.message).slice(0, 200)); }
    }

    // 2) canGrant contra public.can_grant_channels, con usuarios de verdad.
    const dueno = await makeUser("roles-owner-249");
    await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: dueno.id, role: "owner" });
    const mkRol = async (name, channels, keys = []) => {
      const { data, error } = await svc.from("workspace_roles")
        .insert({ workspace_id: ws.id, name, permissions: { keys, scopes: { leads: "own" }, channels } }).select("id").single();
      if (error) throw new Error(`no pude crear el rol ${name}: ${error.message}`);
      return data.id;
    };
    const conRol = async (tag, roleId) => {
      const u = await makeUser(tag);
      await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: u.id, role: "member", role_id: roleId });
      return u;
    };
    {
      const actores = new Map();
      const actor = async (a) => {
        if (a === "owner") return dueno;
        if (a === "admin") return admin;
        if (a === "member") return acotado;
        const k = JSON.stringify(a);
        if (!actores.has(k)) actores.set(k, await conRol(`roles-ch-actor-${actores.size}`, await mkRol(`zz-test Bandeja ${actores.size}`, resolver(a))));
        return actores.get(k);
      };
      for (const c of casos.canGrant) {
        const u = await actor(c.actor);
        const { data, error } = await u.client.rpc("can_grant_channels", {
          p_workspace_id: ws.id, p_wanted: resolver(c.wanted), p_before: c.before ? resolver(c.before) : null,
        });
        check(!error && data === c.allowed, `can_grant_channels: ${c.name}`, error?.message ?? `esperaba ${c.allowed}, dio ${data}`);
      }
    }

    // 3) Dos Instagram: cada rol ve las cuentas que tiene, con su alcance.
    const canal = async (tag) => (await svc.from("channels").insert({
      workspace_id: ws.id, platform: "instagram", late_account_id: `zz-test-249-${tag}-${Date.now()}`,
      username: `zztest249${tag}`, display_name: `zz test ${tag}`, is_active: true,
    }).select("id").single()).data.id;
    const ig1 = await canal("a");
    const ig2 = await canal("b");

    const lector1 = await conRol("roles-ch-ig1", await mkRol("zz-test Solo IG1", { mode: "custom", byChannel: { [ig1]: { scope: "all", reply: true } } }));
    const lector2 = await conRol("roles-ch-ig1-libres", await mkRol("zz-test IG1 sin asignar", { mode: "custom", byChannel: { [ig1]: { scope: "own_unassigned", reply: false } } }));
    const todas = await conRol("roles-ch-todas", await mkRol("zz-test Todas", { mode: "all", all: { scope: "all", reply: true } }));

    const contacto = async (name, extra = {}) => (await svc.from("contacts").insert({ workspace_id: ws.id, display_name: `zz-test ${name}`, ...extra }).select("id").single()).data.id;
    const libre = await contacto("libre");
    const deOtro = await contacto("de otro", { setter_id: admin.id });
    const soloIg2 = await contacto("solo en ig2");
    const conv = async (channelId, contactId) => (await svc.from("conversations").insert({ workspace_id: ws.id, channel_id: channelId, contact_id: contactId, platform: "instagram" }).select("id").single()).data.id;
    const cLibre1 = await conv(ig1, libre);
    const cLibre2 = await conv(ig2, libre);
    const cOtro1 = await conv(ig1, deOtro);
    const cSolo2 = await conv(ig2, soloIg2);

    const convsDe = async (u) => new Set(((await u.client.from("conversations").select("id").eq("workspace_id", ws.id)).data ?? []).map((r) => r.id));
    const contactosDe = async (u) => new Set(((await u.client.from("contacts").select("id").eq("workspace_id", ws.id)).data ?? []).map((r) => r.id));

    {
      const v = await convsDe(lector1);
      check(v.has(cLibre1) && v.has(cOtro1), "un rol con IG1 «todas» ve las conversaciones de IG1, de quien sean");
      check(!v.has(cLibre2) && !v.has(cSolo2), "...y ninguna del otro Instagram, ni siquiera por consulta directa");
      const c = await contactosDe(lector1);
      check(c.has(libre) && c.has(deOtro), "ver un chat deja ver la ficha de ese contacto (con «Contactos: solo asignados»)");
      check(!c.has(soloIg2), "...pero no la de un contacto que solo escribe por la cuenta que no tiene");
      for (const [cid, tag] of [[cSolo2, "ig2"], [cLibre1, "ig1"]]) {
        await svc.from("messages").insert({ workspace_id: ws.id, conversation_id: cid, direction: "inbound", text: `zz-test-249-${tag}`, platform_message_id: `zz-249-${tag}-${Date.now()}`, status: "delivered" });
      }
      const { data: msgs2 } = await lector1.client.from("messages").select("id").eq("conversation_id", cSolo2);
      const { data: msgs1 } = await lector1.client.from("messages").select("id").eq("conversation_id", cLibre1);
      check((msgs2 ?? []).length === 0 && (msgs1 ?? []).length === 1, "los mensajes siguen a la conversacion: los del otro Instagram no se leen");
    }
    {
      const v = await convsDe(lector2);
      check(v.has(cLibre1), "con «asignadas + sin asignar» ve la de un contacto que no tiene nadie");
      check(!v.has(cOtro1), "...y no la de un contacto que tiene setter");
      check(!v.has(cLibre2), "...ni la del mismo contacto en la otra cuenta");
      const c = await contactosDe(lector2);
      check(c.has(libre) && !c.has(deOtro), "la ficha sigue la misma regla");
    }
    {
      const ig3 = await canal("c"); // se conecta DESPUES de crear los roles
      const cNueva = await conv(ig3, deOtro);
      check((await convsDe(todas)).has(cNueva), "«todas las cuentas» incluye una cuenta conectada despues");
      check(!(await convsDe(lector1)).has(cNueva), "«elegir por cuenta» no la ve hasta que se la den");
      check((await convsDe(acotado)).size === 0, "el Member de sistema sigue viendo solo lo suyo");
    }

    // 4) El trigger: un rol que se guarda sin `channels` no pierde la bandeja; uno nuevo la arma de sus claves viejas.
    {
      const { data: viejo } = await svc.from("workspace_roles").insert({
        workspace_id: ws.id, name: "zz-test Rol de antes",
        permissions: { keys: ["inbox.whatsapp.view", "inbox.instagram.view", "inbox.instagram.reply"], scopes: { leads: "own_unassigned" } },
      }).select("id, permissions").single();
      const ch = viejo?.permissions?.channels;
      check(ch?.mode === "custom" && ch.byChannel?.[ig1]?.scope === "own_unassigned" && ch.byChannel?.[ig1]?.reply === true,
        "un rol con claves viejas recibe cada cuenta de esas redes, con su alcance y su «responder»", JSON.stringify(ch));
      await svc.from("workspace_roles").update({ permissions: { keys: ["contacts.view"], scopes: { leads: "own" } } }).eq("id", viejo.id);
      const { data: despues } = await svc.from("workspace_roles").select("permissions").eq("id", viejo.id).single();
      check(JSON.stringify(despues.permissions.channels) === JSON.stringify(ch), "guardarlo sin `channels` conserva la bandeja que tenia");
    }

    // 5) La base frena dar una cuenta que no se tiene (editar y crear).
    {
      const gestorIg1 = await conRol("roles-ch-gestor", await mkRol("zz-test Gestor IG1", { mode: "custom", byChannel: { [ig1]: { scope: "all", reply: true } } }, ["roles.manage", "team.invite"]));
      const objetivo = await mkRol("zz-test Objetivo", { mode: "custom", byChannel: {} });
      const editar = (channels) => gestorIg1.client.from("workspace_roles").update({ permissions: { keys: [], scopes: { leads: "own" }, channels } }).eq("id", objetivo).select("id");
      check(!!(await editar({ mode: "custom", byChannel: { [ig2]: { scope: "own", reply: false } } })).error, "quien tiene solo IG1 no le da IG2 a otro rol");
      check(!!(await editar({ mode: "all", all: { scope: "own", reply: false } })).error, "...ni «todas las cuentas»");
      const ok = await editar({ mode: "custom", byChannel: { [ig1]: { scope: "own", reply: true } } });
      check(!ok.error && (ok.data ?? []).length === 1, "...y si le da IG1, que tiene", ok.error?.message);
      const crear = await gestorIg1.client.from("workspace_roles").insert({ workspace_id: ws.id, name: "zz-test Creado", permissions: { keys: [], scopes: { leads: "own" }, channels: { mode: "custom", byChannel: { [ig2]: { scope: "all", reply: true } } } } }).select("id");
      check(!!crear.error, "tampoco crea un rol con una cuenta que no tiene");
      const rolIg2 = await mkRol("zz-test Con IG2", { mode: "custom", byChannel: { [ig2]: { scope: "own", reply: false } } });
      const inv = await gestorIg1.client.from("workspace_invites").insert({ workspace_id: ws.id, email: `zz-test-inv-${randomUUID().slice(0, 8)}@example.test`, invited_by: gestorIg1.id, delivery: "link", role: "member", role_id: rolIg2 }).select("id");
      check(!!inv.error, "ni invita con un rol que tiene una cuenta que no tiene");
    }
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
