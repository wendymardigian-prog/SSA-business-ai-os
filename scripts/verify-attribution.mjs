#!/usr/bin/env node
/**
 * Verificacion de la atribucion de contactos contra la base real (Contenido v3,
 * B11: F82, F83, F84, F87).
 *
 * Prueba lo que no se puede probar con vitest porque vive en Postgres: la
 * funcion `record_contact_touch` (que recalcula el primero y el ultimo toque
 * DESDE LA TABLA), la RLS de `contact_touches` (un Member ve los toques de los
 * contactos que ya puede ver) y los triggers de alta, que leen la atribucion.
 *
 * Crea un workspace de prueba (`zz-test-`), usuarios de verdad y contactos, y
 * borra todo al terminar. No correr a la vez que otro verify-*: comparten el
 * prefijo `zz-test-` y se pisan la limpieza.
 *
 * La reserva (`create_booking` escribe el toque canonico) se verifica en
 * `scripts/verify-scheduling.mjs`, que ya crea una reserva real: hacerlo aca
 * sumaria otro job huerfano a la cola de produccion.
 *
 *   node scripts/verify-attribution.mjs
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

const touch = (over = {}) => ({
  source: "instagram", medium: "dm", origin: "dm", dedupe_key: `zz-${randomUUID()}`, ...over,
});
const record = (wsId, contactId, t) =>
  svc.rpc("record_contact_touch", { p_workspace_id: wsId, p_contact_id: contactId, p_touch: t });
const attributionOf = async (id) =>
  (await svc.from("contacts").select("attribution").eq("id", id).single()).data?.attribution;
const touchCount = async (id) =>
  (await svc.from("contact_touches").select("id", { count: "exact", head: true }).eq("contact_id", id)).count;

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-attr", slug: `zz-test-attr-${stamp}` }).select("id").single();
  const { data: wsOtro } = await svc.from("workspaces")
    .insert({ name: "zz-test-attr-otro", slug: `zz-test-attr-otro-${stamp}` }).select("id").single();

  const admin = await makeUser("attr-admin");
  const member = await makeUser("attr-member");
  const ajeno = await makeUser("attr-ajeno");
  await svc.from("workspace_members").insert([
    { workspace_id: ws.id, user_id: admin.id, role: "admin" },
    { workspace_id: ws.id, user_id: member.id, role: "member" },
    { workspace_id: wsOtro.id, user_id: ajeno.id, role: "owner" },
  ]);

  const newContact = async (extra = {}) => {
    const { data, error } = await svc.from("contacts")
      .insert({ workspace_id: ws.id, display_name: `zz-test ${randomUUID().slice(0, 6)}`, email: `zz-test-${randomUUID().slice(0, 8)}@example.test`, ...extra })
      .select("id").single();
    if (error) throw new Error(`no pude crear el contacto: ${error.message}`);
    return data.id;
  };

  // ── record_contact_touch: el primero y el ultimo salen de la tabla ──────────
  console.log("\n— record_contact_touch: primero y ultimo (F83) —");
  {
    const c = await newContact();
    const t1 = touch({ source: "instagram", medium: "comment", origin: "comment", occurred_at: "2026-09-01T10:00:00Z", content: "Reel de dolares" });
    const t2 = touch({ source: "instagram", medium: "story_reply", occurred_at: "2026-09-10T10:00:00Z" });
    const t3 = touch({ source: "whatsapp", medium: "dm", occurred_at: "2026-09-20T10:00:00Z" });

    for (const t of [t1, t2, t3]) {
      const { data, error } = await record(ws.id, c, t);
      if (error || data?.inserted !== true) fail("registrar un toque", error?.message ?? JSON.stringify(data));
    }

    const attr = await attributionOf(c);
    check(attr?.version === 2, "la atribucion queda en la forma canonica (version 2)");
    check(attr?.first_touch?.medium === "comment" && attr?.first_touch?.content === "Reel de dolares",
      "con tres toques seguidos, first_touch es el primero");
    check(attr?.last_touch?.source === "whatsapp" && attr?.last_touch?.medium === "dm",
      "con tres toques seguidos, last_touch es el tercero");
    check((await touchCount(c)) === 3, "quedan 3 filas en contact_touches");
    check(attr?.first_touch?.occurred_at?.startsWith("2026-09-01"), "el toque guarda cuando paso, no cuando se anoto");
  }

  console.log("\n— record_contact_touch: idempotencia (F82, F83) —");
  {
    const c = await newContact();
    const t = touch({ dedupe_key: `zz-dup-${stamp}` });
    const first = await record(ws.id, c, t);
    const second = await record(ws.id, c, t);

    check(first.data?.inserted === true, "la primera vez se registra");
    check(second.data?.inserted === false && second.data?.reason === "duplicate", "la segunda dice 'duplicate' y no escribe");
    check((await touchCount(c)) === 1, "el mismo toque dos veces queda UNA sola fila");

    // La misma clave en OTRO workspace es otro toque: el unico es por workspace.
    const cOtro = await svc.from("contacts").insert({ workspace_id: wsOtro.id, display_name: "zz-test otro", email: `zz-test-o-${stamp}@example.test` }).select("id").single();
    const cruzado = await record(wsOtro.id, cOtro.data.id, t);
    check(cruzado.data?.inserted === true, "la misma clave en otro workspace NO choca");
  }

  console.log("\n— record_contact_touch: un toque viejo que llega tarde (F83) —");
  {
    const c = await newContact();
    await record(ws.id, c, touch({ source: "instagram", medium: "dm", occurred_at: "2026-09-10T10:00:00Z" }));
    await record(ws.id, c, touch({ source: "whatsapp", medium: "dm", occurred_at: "2026-09-20T10:00:00Z" }));
    // Una relectura trae un toque de ANTES del primero que teniamos.
    await record(ws.id, c, touch({ source: "tiktok", medium: "comment", origin: "comment", occurred_at: "2026-08-15T10:00:00Z" }));

    const attr = await attributionOf(c);
    check(attr?.first_touch?.source === "tiktok", "first_touch se RECALCULA desde la tabla: el toque viejo pasa a ser el primero");
    check(attr?.last_touch?.source === "whatsapp", "last_touch sigue siendo el mas reciente");
  }

  console.log("\n— record_contact_touch: no borra las formas viejas (D7) —");
  {
    const plano = await newContact({ attribution: { utm_source: "instagram", utm_campaign: "octubre", source: "scheduling", referrer: "https://x.test/" } });
    await record(ws.id, plano, touch({ source: "instagram", medium: "dm" }));
    const a1 = await attributionOf(plano);
    check(a1?.version === 2 && a1?.first_touch, "se suma la forma canonica");
    check(a1?.source === "scheduling" && a1?.utm_campaign === "octubre" && a1?.referrer === "https://x.test/",
      "la forma plana del agendamiento sigue ahi, intacta");

    const clicks = await newContact({ attribution: { first_click: { utm_source: "facebook", captured_at: "2026-09-01T00:00:00Z" } } });
    await record(ws.id, clicks, touch({ source: "instagram" }));
    check((await attributionOf(clicks))?.first_click?.utm_source === "facebook", "la forma vieja de clicks sigue ahi, intacta");
  }

  console.log("\n— record_contact_touch: entradas invalidas y limites —");
  {
    const c = await newContact();
    const sinFuente = await record(ws.id, c, { medium: "dm", origin: "dm", dedupe_key: "zz-x" });
    check(sinFuente.data?.inserted === false && sinFuente.data?.reason === "invalid", "un toque sin fuente se rechaza como invalido");
    const sinClave = await record(ws.id, c, { source: "instagram", origin: "dm" });
    check(sinClave.data?.reason === "invalid", "un toque sin clave de deduplicacion se rechaza");

    const origenRaro = await record(ws.id, c, touch({ origin: "telepatia" }));
    check(!!origenRaro.error, "un origen que no es de la lista lo rechaza la base");

    const ajenoContacto = await record(wsOtro.id, c, touch());
    check(ajenoContacto.data?.reason === "contact_not_found", "un contacto de OTRO workspace no se anota");

    const piezaAjena = await record(ws.id, c, touch({ social_post_id: randomUUID(), content_post_id: randomUUID() }));
    check(piezaAjena.data?.inserted === true, "una pieza que no existe no tumba el registro");
    const { data: fila } = await svc.from("contact_touches").select("social_post_id, content_post_id").eq("id", piezaAjena.data.touch_id).single();
    check(fila.social_post_id === null && fila.content_post_id === null, "...y la referencia colgada queda en null, no se enlaza");

    check((await touchCount(c)) === 1, "los toques rechazados no dejaron filas (quedo solo el de la pieza inexistente)");

    const borrado = await newContact({ deleted_at: new Date().toISOString() });
    check((await record(ws.id, borrado, touch())).data?.reason === "contact_not_found", "un contacto borrado (soft delete) no se anota");
  }

  // ── RLS ───────────────────────────────────────────────────────────────────
  console.log("\n— RLS de contact_touches (F82) —");
  {
    const propio = await newContact({ setter_id: member.id });
    const ajenoDelMember = await newContact();
    await record(ws.id, propio, touch());
    await record(ws.id, ajenoDelMember, touch());
    const filaPropia = (await svc.from("contact_touches").select("id").eq("contact_id", propio).single()).data.id;
    const filaAjena = (await svc.from("contact_touches").select("id").eq("contact_id", ajenoDelMember).single()).data.id;

    const ve = async (c, id) => ((await c.client.from("contact_touches").select("id").eq("id", id)).data ?? []).length > 0;

    check(await ve(admin, filaPropia) && await ve(admin, filaAjena), "un Admin ve los toques de todos los contactos");
    check(await ve(member, filaPropia), "un Member ve los toques de un contacto donde es setter");
    check(!(await ve(member, filaAjena)), "un Member NO ve los toques de un contacto que no es suyo (scope de leads)");
    check(!(await ve(ajeno, filaPropia)) && !(await ve(ajeno, filaAjena)), "otro workspace NO ve ninguno");

    for (const [quien, c] of [["un Admin", admin], ["un Member", member]]) {
      const ins = await c.client.from("contact_touches").insert({
        workspace_id: ws.id, contact_id: propio, occurred_at: new Date().toISOString(), source: "instagram", origin: "dm", dedupe_key: `zz-cli-${quien}`,
      });
      check(!!ins.error, `${quien} NO puede insertar un toque desde el cliente`);
      await c.client.from("contact_touches").update({ source: "tiktok" }).eq("id", filaPropia);
      await c.client.from("contact_touches").delete().eq("id", filaPropia);
    }
    const intacta = (await svc.from("contact_touches").select("source").eq("id", filaPropia).single()).data;
    check(intacta?.source === "instagram", "ni un update ni un delete desde el cliente tocaron la fila");

    // Las funciones son solo del servidor.
    const viaAdmin = await admin.client.rpc("record_contact_touch", { p_workspace_id: ws.id, p_contact_id: propio, p_touch: touch() });
    check(!!viaAdmin.error, "un Admin NO puede llamar a record_contact_touch (solo service_role)");
    const viaAnon = await createClient(URL, ANON, { auth: { persistSession: false } })
      .rpc("record_contact_touch", { p_workspace_id: ws.id, p_contact_id: propio, p_touch: touch() });
    check(!!viaAnon.error, "un anonimo NO puede llamar a record_contact_touch");
  }

  // ── Cascada ───────────────────────────────────────────────────────────────
  console.log("\n— Borrar un contacto borra sus toques (F82) —");
  {
    const c = await newContact();
    await record(ws.id, c, touch());
    await record(ws.id, c, touch());
    check((await touchCount(c)) === 2, "el contacto tiene dos toques");
    await svc.from("contacts").delete().eq("id", c);
    check((await touchCount(c)) === 0, "al borrar el contacto de verdad, sus toques se borran en cascada");
  }

  // ── Los triggers de alta leen la atribucion (F84) ────────────────────────
  console.log("\n— Los triggers de alta (F84) —");
  {
    const sourceOf = async (contactId) => {
      const { data } = await svc.from("automation_events").select("payload")
        .eq("workspace_id", ws.id).eq("event_type", "contact_created").eq("contact_id", contactId);
      return (data ?? [])[0]?.payload?.source;
    };

    const viejo = await newContact({ attribution: { source: "scheduling", utm_source: "instagram" } });
    check((await sourceOf(viejo)) === "scheduling", "un contacto con la atribucion PLANA emite el mismo source de siempre ('scheduling')");

    const vacio = await newContact();
    check((await sourceOf(vacio)) === "unknown", "un contacto sin atribucion emite 'unknown', como siempre");

    const nuevo = await newContact({ attribution: { version: 2, first_touch: { source: "tiktok", medium: "comment" } } });
    check((await sourceOf(nuevo)) === "tiktok", "un contacto con first_touch emite la fuente del primer toque");

    // El anonimo no emite (es lo que protege a los contactos de TikTok de D8).
    const anonimo = await svc.from("contacts")
      .insert({ workspace_id: ws.id, display_name: "Unknown commenter", tiktok_username: `zz-test-${stamp}` }).select("id, is_anonymous").single();
    check(anonimo.data?.is_anonymous === true, "un contacto 'Unknown commenter' con solo tiktok_username queda anonimo");
    check((await sourceOf(anonimo.data.id)) === undefined, "...y por eso NO emite 'contact_created'");
  }

  // ── El backfill de la 00115 ───────────────────────────────────────────────
  console.log("\n— El backfill de los contactos existentes (F87) —");
  {
    const { count: vivos } = await svc.from("contacts").select("id", { count: "exact", head: true })
      .is("deleted_at", null).not("workspace_id", "in", `(${ws.id},${wsOtro.id})`);
    const { count: conPrimer } = await svc.from("contacts").select("id", { count: "exact", head: true })
      .is("deleted_at", null).not("workspace_id", "in", `(${ws.id},${wsOtro.id})`).not("attribution->first_touch", "is", null);
    // Los contactos que entraron DESPUES del backfill (por un webhook) los anota
    // el receptor; los demas, el backfill. Los que no tienen evento no deben
    // tener nada inventado, pero en produccion todos tienen evento.
    check(vivos === conPrimer, `todos los contactos reales tienen first_touch (${conPrimer} de ${vivos})`);
  }
} catch (err) {
  fail("el script fallo", err instanceof Error ? err.stack : String(err));
} finally {
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} falla(s)` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
