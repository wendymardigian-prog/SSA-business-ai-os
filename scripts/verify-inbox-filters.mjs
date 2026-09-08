#!/usr/bin/env node
/**
 * Verificacion de los filtros de la bandeja contra la base real (F16).
 *
 * Lo que prueba, y que ningun test de vitest puede probar: que el scope de
 * leads siga valiendo CON los filtros puestos. Un filtro se resuelve en
 * Postgres, asi que la pregunta no es si la UI esconde bien, sino si la
 * consulta filtrada le devuelve a un Member algo que no le corresponde.
 *
 * Por eso las consultas se hacen con el cliente de un Member logueado de
 * verdad, y son las mismas que arma app/(dashboard)/dashboard/inbox/page.tsx.
 *
 * Crea un workspace con dos usuarios, dos canales, tags y varias
 * conversaciones, y borra todo al terminar.
 *
 *   node scripts/verify-inbox-filters.mjs
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

const stamp = Date.now();

async function makeUser(tag) {
  const email = `zz-test-${tag}-${stamp}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-filtros", slug: `zz-test-filtros-${stamp}` }).select("id").single();

  const admin = await makeUser("filtros-admin");
  const member = await makeUser("filtros-member");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
  ]);

  const canal = async (platform, suf) => (await svc.from("channels").insert({
    workspace_id: ws.id, platform, late_account_id: `zz-${suf}-${stamp}`,
    username: `zz${suf}`, display_name: `zz ${suf}`, is_active: true,
  }).select("id").single()).data.id;

  const ig = await canal("instagram", "figs");
  const wa = await canal("whatsapp", "fwa");

  const { data: tagVip } = await svc.from("tags")
    .insert({ workspace_id: ws.id, name: "vip", color: "#ef4444" }).select("id").single();

  const dias = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

  /** Crea contacto + conversacion y devuelve los dos ids. */
  const lead = async ({ nombre, canalId, plataforma, tag, cuando, estado = "open", setter = null }) => {
    const { data: c } = await svc.from("contacts")
      .insert({ workspace_id: ws.id, display_name: nombre, setter_id: setter }).select("id").single();
    if (tag) await svc.from("contact_tags").insert({ contact_id: c.id, tag_id: tag });
    const { data: conv } = await svc.from("conversations").insert({
      workspace_id: ws.id, channel_id: canalId, contact_id: c.id, platform: plataforma,
      status: estado, last_message_at: cuando, last_message_preview: `hola de ${nombre}`,
    }).select("id").single();
    return { contacto: c.id, conversacion: conv.id };
  };

  // Del Member: uno de cada canal, uno con tag, uno viejo.
  const mio1 = await lead({ nombre: "Mio IG vip", canalId: ig, plataforma: "instagram", tag: tagVip.id, cuando: dias(0), setter: member.id });
  const mio2 = await lead({ nombre: "Mio WA", canalId: wa, plataforma: "whatsapp", cuando: dias(2), setter: member.id });
  const mio3 = await lead({ nombre: "Mio IG viejo", canalId: ig, plataforma: "instagram", cuando: dias(60), setter: member.id });
  const mioCerrado = await lead({ nombre: "Mio cerrado", canalId: wa, plataforma: "whatsapp", cuando: dias(1), estado: "closed", setter: member.id });

  // Del Admin: mismos atributos, para que un filtro flojo los deje pasar.
  const ajeno1 = await lead({ nombre: "Ajeno IG vip", canalId: ig, plataforma: "instagram", tag: tagVip.id, cuando: dias(0), setter: admin.id });
  const ajeno2 = await lead({ nombre: "Ajeno WA", canalId: wa, plataforma: "whatsapp", cuando: dias(2), setter: admin.id });

  /** La misma consulta que arma la pagina de la bandeja. */
  async function consultar(client, { estado = "open", plataformas = [], tags = [], desde = null, busqueda = "" } = {}) {
    let select = "*, contacts!inner(id, display_name, setter_id, vendedor_id)";
    if (tags.length > 0) select += ", tag_match:contacts!inner(contact_tags!inner(tag_id))";

    let q = client.from("conversations")
      .select(select, { count: "exact" })
      .eq("workspace_id", ws.id)
      .is("deleted_at", null);

    if (estado !== "all") q = q.eq("status", estado);
    if (plataformas.length > 0) q = q.in("platform", plataformas);
    if (tags.length > 0) q = q.in("tag_match.contact_tags.tag_id", tags);
    if (desde) q = q.gte("last_message_at", desde);
    if (busqueda) q = q.ilike("contacts.display_name", `%${busqueda}%`);

    const { data, count, error } = await q.order("last_message_at", { ascending: false });
    if (error) throw new Error(`consulta fallida: ${error.message}`);
    return { nombres: (data ?? []).map((r) => r.contacts.display_name).sort(), count };
  }

  const iguales = (a, b) => JSON.stringify(a.sort()) === JSON.stringify(b.sort());

  console.log("\n— Sin filtros: cada uno ve lo suyo —");
  {
    const m = await consultar(member.client);
    check(iguales(m.nombres, ["Mio IG vip", "Mio WA", "Mio IG viejo"]),
      "el Member ve solo sus tres conversaciones abiertas", m.nombres.join(", "));
    check(m.count === 3, `y el total dice 3 (dio ${m.count})`);

    const a = await consultar(admin.client);
    check(a.nombres.length === 5, `el Admin ve las cinco abiertas (dio ${a.nombres.length})`, a.nombres.join(", "));
  }

  console.log("\n— Filtrar por canal no abre leads ajenos —");
  {
    const m = await consultar(member.client, { plataformas: ["instagram"] });
    check(iguales(m.nombres, ["Mio IG vip", "Mio IG viejo"]),
      "el Member filtra Instagram dentro de lo suyo", m.nombres.join(", "));
    check(!m.nombres.includes("Ajeno IG vip"),
      "y el lead del Admin en el mismo canal NO aparece");
  }

  console.log("\n— Filtrar por tag tampoco —");
  {
    const m = await consultar(member.client, { tags: [tagVip.id] });
    check(iguales(m.nombres, ["Mio IG vip"]),
      "el Member ve solo su lead con el tag", m.nombres.join(", "));
    check(!m.nombres.includes("Ajeno IG vip"),
      "el lead del Admin con el MISMO tag no se cuela");

    const a = await consultar(admin.client, { tags: [tagVip.id] });
    check(a.nombres.length === 2, `el Admin si ve los dos con ese tag (dio ${a.nombres.length})`);
  }

  console.log("\n— Filtrar por fecha —");
  {
    const m = await consultar(member.client, { desde: dias(7) });
    check(iguales(m.nombres, ["Mio IG vip", "Mio WA"]),
      "quedan los de los ultimos 7 dias y se va el de hace 60", m.nombres.join(", "));
  }

  console.log("\n— Filtrar por estado —");
  {
    const abiertas = await consultar(member.client, { estado: "open" });
    check(!abiertas.nombres.includes("Mio cerrado"), "una cerrada no aparece entre las abiertas");

    const cerradas = await consultar(member.client, { estado: "closed" });
    check(iguales(cerradas.nombres, ["Mio cerrado"]), "y si al pedir las cerradas", cerradas.nombres.join(", "));

    const todas = await consultar(member.client, { estado: "all" });
    check(todas.nombres.length === 4, `"todas" trae las cuatro del Member (dio ${todas.nombres.length})`);
  }

  console.log("\n— Buscar por nombre no es una puerta de atras —");
  {
    const m = await consultar(member.client, { busqueda: "Ajeno" });
    check(m.nombres.length === 0,
      "buscar el nombre exacto de un lead ajeno no devuelve nada", m.nombres.join(", "));
    check(m.count === 0, `y el contador tampoco lo delata (dio ${m.count})`);
  }

  console.log("\n— Los filtros combinan con AND —");
  {
    const m = await consultar(member.client, { plataformas: ["instagram"], tags: [tagVip.id] });
    check(iguales(m.nombres, ["Mio IG vip"]), "canal + tag deja uno solo", m.nombres.join(", "));

    const vacio = await consultar(member.client, { plataformas: ["whatsapp"], tags: [tagVip.id] });
    check(vacio.nombres.length === 0,
      "una combinacion sin resultados devuelve vacio y no ignora un filtro", vacio.nombres.join(", "));
  }

  console.log("\n— Con el scope apagado el Member ve todo —");
  {
    await svc.from("workspaces").update({ lead_scope_enabled: false }).eq("id", ws.id);
    const m = await consultar(member.client);
    check(m.nombres.length === 5,
      `sin scope, el Member ve las cinco abiertas (dio ${m.nombres.length})`, m.nombres.join(", "));
    await svc.from("workspaces").update({ lead_scope_enabled: true }).eq("id", ws.id);
  }

  console.log("\n— Un contacto borrado desaparece de la bandeja —");
  {
    await svc.from("contacts").update({ deleted_at: new Date().toISOString() }).eq("id", mio2.contacto);
    const m = await consultar(member.client);
    check(!m.nombres.includes("Mio WA"),
      "la conversacion de un lead borrado no aparece", m.nombres.join(", "));
    await svc.from("contacts").update({ deleted_at: null }).eq("id", mio2.contacto);
  }

  void mio1; void mio3; void mioCerrado; void ajeno1; void ajeno2;
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
