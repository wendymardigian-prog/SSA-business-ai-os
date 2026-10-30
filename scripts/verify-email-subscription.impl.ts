/**
 * La suscripcion a emails contra la base real (00270-00272). Lo lanza
 * `scripts/verify-email-subscription.mjs`.
 *
 * Que prueba:
 *  1. La tabla de transiciones de la base (`private.email_status_decide`) da lo mismo
 *     que la de TypeScript, caso por caso (`subscription-transitions.cases.json`).
 *  2. Las transiciones de verdad por modo: el sistema no re-suscribe; la persona no
 *     vuelve desde un rebote; alguien del equipo saca un rebote solo con motivo.
 *  3. 10 llamadas en paralelo sobre dos contactos con la misma direccion (en
 *     mayusculas distintas): los dos terminan iguales y sin entradas duplicadas.
 *  4. `email_address_status`: email, secundario, contacto borrado y despues de fusionar.
 *  5. El token: abrir la pagina no cambia nada; el clic da de baja; volver funciona
 *     salvo desde un rebote.
 *  6. La guardia: nadie escribe las columnas por fuera de la funcion, ni el service role.
 *  7. La herencia al poner una direccion, y si falla (forzado, en una transaccion que
 *     se deshace sola): queda anotada y la puerta de envio igual frena.
 *  8. La baja pausa en el momento las secuencias de email con marketing, y no las reanuda.
 *  9. Ninguna funcion de la base salvo las centrales escribe esas columnas.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCleanup } from "./test-cleanup.mjs";
import { dbTargetArgs } from "./lib/db-target.mjs";
import cases from "../lib/email/subscription-transitions.cases.json";
import { canSendEmailTo } from "../lib/email/subscription";
import { applyUnsubscribeAction, loadUnsubscribeTarget, publicView } from "../lib/email/unsubscribe-public";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
// El tope por IP de la baja publica usa una sal: la del entorno.
for (const k of ["RATE_LIMIT_SALT", "CRON_SECRET"]) if (env[k] && !process.env[k]) process.env[k] = env[k];

type Db = SupabaseClient<any>;
const svc: Db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const ok = (m: string) => console.log("  ok  ", m);
const fail = (m: string, extra?: string) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond: unknown, m: string, extra?: string) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

function sql(query: string): Array<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "zz-email-sub-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, query);
  const out = execFileSync("supabase", ["db", "query", ...dbTargetArgs(), "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  return (JSON.parse(out).rows ?? []) as Array<Record<string, unknown>>;
}

/** Un bloque DO que termina con `RAISE EXCEPTION 'RESULTADO: ...'`: lo que hizo se deshace solo. */
function sqlProbe(query: string): string {
  const dir = mkdtempSync(join(tmpdir(), "zz-email-sub-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, query);
  try {
    execFileSync("supabase", ["db", "query", ...dbTargetArgs(), "-f", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "SIN RESULTADO";
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    const m = text.match(/RESULTADO: ([^"\\]*)/);
    return m ? m[1].trim() : text.slice(0, 500);
  }
}

const lit = (v: string | null | undefined) => (v === null || v === undefined ? "NULL" : `'${v.replace(/'/g, "''")}'`);

async function contact(ws: string, fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await svc.from("contacts").insert({ workspace_id: ws, ...fields }).select("id").single();
  if (error) throw new Error(`no pude crear el contacto: ${error.message}`);
  return data.id as string;
}
async function statusOf(id: string): Promise<string> {
  const { data } = await svc.from("contacts").select("email_status").eq("id", id).single();
  return (data as { email_status: string }).email_status;
}
async function setStatus(id: string, args: Record<string, unknown>) {
  return svc.rpc("set_email_status", { p_contact_id: id, ...args });
}
async function auditOf(id: string) {
  const { data } = await svc.from("audit_log").select("action, changes, metadata, performed_by").eq("entity_id", id).in("action", ["email_status", "email_status_inherit_failed"]).order("performed_at");
  return (data ?? []) as Array<{ action: string; changes: { email_status?: { old: string; new: string } } | null; metadata: Record<string, unknown> | null }>;
}

try {
  const { data: workspace, error: wsError } = await svc.from("workspaces").insert({ name: "zz-test-email-sub", slug: `zz-test-email-sub-${stamp}` }).select("id").single();
  if (wsError) throw new Error(`no pude crear el workspace: ${wsError.message}`);
  const ws = workspace.id as string;

  console.log("\n— 1. La tabla de transiciones: base y TypeScript dicen lo mismo —");
  {
    const list = cases.cases as Array<{ from: string; to: string; mode: string; reason?: string; expect: string }>;
    const values = list.map((c, i) => `(${i}, ${lit(c.from)}, ${lit(c.to)}, ${lit(c.mode)}, ${lit(c.reason ?? null)})`).join(",\n");
    const rows = sql(`select i, private.email_status_decide(f, t, m, r) as d from (values ${values}) as v(i, f, t, m, r) order by i;`);
    const mismatches = list.filter((c, i) => rows[i]?.d !== c.expect).map((c, i) => `${c.mode} ${c.from}->${c.to}: base=${rows[i]?.d} esperado=${c.expect}`);
    check(rows.length === list.length && mismatches.length === 0, `los ${list.length} casos coinciden`, mismatches.join("; "));
  }

  console.log("\n— 2. Las transiciones de verdad, por modo —");
  {
    const c = await contact(ws, { display_name: "zz-test modos", email: `zz-modos-${stamp}@example.com` });
    let r = await setStatus(c, { p_status: "unsubscribed", p_source: "admin", p_mode: "system" });
    check(!r.error && (r.data as { changed: boolean }).changed && (await statusOf(c)) === "unsubscribed", "el sistema da de baja");
    r = await setStatus(c, { p_status: "subscribed", p_source: "import:zz", p_mode: "system" });
    check((r.data as { kept_existing: boolean }).kept_existing === true && (await statusOf(c)) === "unsubscribed", "el sistema NO re-suscribe (kept_existing)");
    r = await setStatus(c, { p_status: "subscribed", p_source: "unsubscribe_page", p_mode: "person" });
    check((await statusOf(c)) === "subscribed", "la persona vuelve a suscribirse desde una baja");
    r = await setStatus(c, { p_status: "bounced", p_source: "resend_bounce", p_mode: "system" });
    check((await statusOf(c)) === "bounced", "un rebote del sistema");
    r = await setStatus(c, { p_status: "subscribed", p_source: "unsubscribe_page", p_mode: "person" });
    check((r.data as { kept_existing: boolean }).kept_existing === true && (await statusOf(c)) === "bounced", "la persona NO vuelve desde un rebote");
    r = await setStatus(c, { p_status: "subscribed", p_source: "admin", p_mode: "admin" });
    check(r.error?.code === "EM002" && (await statusOf(c)) === "bounced", "el equipo no saca un rebote sin motivo (EM002)", r.error?.message);
    r = await setStatus(c, { p_status: "subscribed", p_source: "admin", p_mode: "admin", p_reason: "zz confirmo que el buzon anda" });
    check(!r.error && (await statusOf(c)) === "subscribed", "con motivo, si");
    const before = (await auditOf(c)).length;
    await setStatus(c, { p_status: "subscribed", p_source: "admin", p_mode: "admin" });
    check((await auditOf(c)).length === before, "el mismo estado no escribe un evento nuevo (idempotente)");
    const future = new Date(Date.now() + 86_400_000 * 30).toISOString();
    await setStatus(c, { p_status: "unsubscribed", p_source: "import:zz", p_mode: "system", p_occurred_at: future });
    const { data: atRow } = await svc.from("contacts").select("email_status_at").eq("id", c).single();
    check(new Date((atRow as { email_status_at: string }).email_status_at).getTime() <= Date.now() + 5000, "una fecha futura nunca queda en el futuro");
    const past = "2025-03-04T10:00:00.000Z";
    const c2 = await contact(ws, { display_name: "zz-test fecha", email: `zz-fecha-${stamp}@example.com` });
    await setStatus(c2, { p_status: "unsubscribed", p_source: "import:zz", p_mode: "system", p_occurred_at: past });
    const { data: pastRow } = await svc.from("contacts").select("email_status_at").eq("id", c2).single();
    check(new Date((pastRow as { email_status_at: string }).email_status_at).toISOString() === past, "una fecha pasada (importacion) se respeta");
    const audit = (await auditOf(c2))[0];
    check(audit?.metadata?.occurred_at !== undefined && audit?.changes?.email_status?.new === "unsubscribed", "queda en audit_log con el cambio y la fecha del hecho");
  }

  console.log("\n— 3. 10 llamadas en paralelo sobre la misma direccion —");
  {
    const a = await contact(ws, { display_name: "zz-test par A", email: `ZZ-Par-${stamp}@Example.com` });
    const b = await contact(ws, { display_name: "zz-test par B", phone: `+54911${String(stamp).slice(-8)}`, secondary_email: `zz-par-${stamp}@example.com` });
    const calls = Array.from({ length: 10 }, (_, i) =>
      setStatus(i % 2 === 0 ? a : b, { p_status: i % 3 === 0 ? "bounced" : "unsubscribed", p_source: "resend_bounce", p_mode: "system" }),
    );
    const results = await Promise.all(calls);
    check(results.every((r) => !r.error), "las 10 terminan sin error", results.find((r) => r.error)?.error?.message);
    const [sa, sb] = [await statusOf(a), await statusOf(b)];
    check(sa === sb && sa === "bounced", `los dos terminan iguales (${sa} / ${sb})`);
    for (const [name, id] of [["A", a], ["B", b]] as const) {
      const entries = (await auditOf(id)).filter((e) => e.action === "email_status");
      const pairs = entries.map((e) => `${e.changes?.email_status?.old}->${e.changes?.email_status?.new}`);
      check(new Set(pairs).size === pairs.length && entries.length <= 2, `${name}: sin entradas duplicadas (${pairs.join(", ")})`);
    }
  }

  console.log("\n— 4. El estado de una direccion —");
  {
    const addr = `zz-dir-${stamp}@example.com`;
    const sec = `zz-sec-${stamp}@example.com`;
    const main = await contact(ws, { display_name: "zz-test dir", email: addr, secondary_email: sec });
    const status = async (e: string) => (await svc.rpc("email_address_status", { p_workspace_id: ws, p_email: e })).data;
    check((await status(addr)) === "subscribed", "una direccion nueva esta suscripta");
    await setStatus(main, { p_status: "unsubscribed", p_source: "admin", p_mode: "admin" });
    check((await status(addr.toUpperCase())) === "unsubscribed" && (await status(sec)) === "unsubscribed", "la baja vale para el email y el secundario (sin importar mayusculas)");
    await svc.from("contacts").update({ deleted_at: new Date().toISOString() }).eq("id", main);
    check((await status(addr)) === "unsubscribed", "borrar el contacto NO borra la baja de la direccion");

    const keep = await contact(ws, { display_name: "zz-test fusion principal", email: `zz-main-${stamp}@example.com` });
    const dup = await contact(ws, { display_name: "zz-test fusion duplicado", email: `zz-dup-${stamp}@example.com` });
    await setStatus(dup, { p_status: "complained", p_source: "resend_complaint", p_mode: "system" });
    const merged = await svc.rpc("merge_contacts", { p_workspace_id: ws, p_main: keep, p_duplicate: dup, p_actor: null });
    check(!merged.error, "la fusion corre", merged.error?.message);
    check((await statusOf(keep)) === "complained", "el principal se lleva el peor estado de los dos");
    check((await status(`zz-dup-${stamp}@example.com`)) === "complained", "la direccion del duplicado sigue frenada despues de fusionar");
    const mergeAudit = (await auditOf(keep)).find((e) => e.metadata?.source === "merge");
    check(Boolean(mergeAudit), "la fusion deja su entrada en audit_log");
  }

  console.log("\n— 5. El token de baja —");
  {
    const c = await contact(ws, { display_name: "zz-test token", email: `zz-token-${stamp}@example.com` });
    const { data: row } = await svc.from("contacts").select("email_unsubscribe_token").eq("id", c).single();
    const token = (row as { email_unsubscribe_token: string }).email_unsubscribe_token;
    const target = await loadUnsubscribeTarget(svc, token);
    const view = target ? publicView(target) : null;
    check(view?.maskedAddress === "z***@example.com" && view.status === "subscribed", "la pagina muestra solo la direccion enmascarada");
    check((await statusOf(c)) === "subscribed" && (await auditOf(c)).length === 0, "abrir la pagina NO cambia nada");
    const click = await applyUnsubscribeAction(svc, { token, ip: "203.0.113.7", action: "unsubscribe", source: "one_click" });
    check(click.ok && (await statusOf(c)) === "unsubscribed", "el clic da de baja");
    const entry = (await auditOf(c))[0];
    check(entry?.metadata?.source === "one_click" && entry?.metadata?.mode === "person", "como la propia persona, con origen one_click");
    const again = await applyUnsubscribeAction(svc, { token, ip: "203.0.113.7", action: "unsubscribe", source: "one_click" });
    check(again.ok && (await auditOf(c)).length === 1, "un segundo clic no escribe otra entrada");
    await applyUnsubscribeAction(svc, { token, ip: "203.0.113.7", action: "resubscribe", source: "unsubscribe_page" });
    check((await statusOf(c)) === "subscribed", "«Me equivoqué» vuelve a suscribir");
    await setStatus(c, { p_status: "bounced", p_source: "resend_bounce", p_mode: "system" });
    const fromBounce = await applyUnsubscribeAction(svc, { token, ip: "203.0.113.7", action: "resubscribe", source: "unsubscribe_page" });
    check(fromBounce.ok && !fromBounce.view.canResubscribe && (await statusOf(c)) === "bounced", "desde un rebote no se puede volver");
    check((await loadUnsubscribeTarget(svc, "00000000-0000-4000-8000-000000000000")) === null, "un token que no existe no devuelve nada");
  }

  console.log("\n— 6. La guardia de las columnas —");
  {
    const c = await contact(ws, { display_name: "zz-test guardia", email: `zz-guardia-${stamp}@example.com` });
    const upd = await svc.from("contacts").update({ email_status: "unsubscribed" }).eq("id", c);
    check(upd.error?.code === "EM003", "un UPDATE directo (ni el service role) no cambia el estado", upd.error?.message);
    const tok = await svc.from("contacts").update({ email_unsubscribe_token: "11111111-1111-4111-8111-111111111111" }).eq("id", c);
    check(tok.error?.code === "EM003", "tampoco el token");
    const ins = await svc.from("contacts").insert({ workspace_id: ws, display_name: "zz-test insert", email: `zz-ins-${stamp}@example.com`, email_status: "unsubscribed" });
    check(ins.error?.code === "EM003", "un contacto no puede nacer dado de baja por fuera de la funcion");
  }

  console.log("\n— 7. La herencia al poner una direccion —");
  {
    const addr = `zz-hereda-${stamp}@example.com`;
    const old = await contact(ws, { display_name: "zz-test viejo", email: addr });
    await setStatus(old, { p_status: "unsubscribed", p_source: "admin", p_mode: "admin" });
    await svc.from("contacts").update({ deleted_at: new Date().toISOString() }).eq("id", old);
    const fresh = await contact(ws, { display_name: "zz-test nuevo", phone: `+54912${String(stamp).slice(-8)}` });
    check((await statusOf(fresh)) === "subscribed", "un contacto sin email arranca suscripto");
    await svc.from("contacts").update({ email: addr.toUpperCase() }).eq("id", fresh);
    check((await statusOf(fresh)) === "unsubscribed", "al ponerle una direccion dada de baja (aunque sea de un borrado), la hereda");
    check((await auditOf(fresh)).some((e) => e.metadata?.source === "inherit"), "queda en audit_log como herencia");
    const { count } = await svc.from("audit_log").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("action", "email_status_inherit_failed");
    check(count === 0, "en una corrida normal no hay fallos de herencia");

    const probe = sqlProbe(`
DO $do$
DECLARE v_new uuid; v_status text; v_failed int; v_addr text;
BEGIN
  EXECUTE $f$CREATE OR REPLACE FUNCTION private.email_status_apply(p_workspace_id uuid, p_contact_ids uuid[], p_address text, p_status text, p_source text, p_occurred_at timestamptz, p_reason text, p_performed_by uuid, p_mode text, p_subscribed_at timestamptz, p_extra jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $b$ BEGIN RAISE EXCEPTION 'zz forzado'; END; $b$$f$;
  INSERT INTO public.contacts (workspace_id, display_name, email) VALUES (${lit(ws)}::uuid, 'zz-test forzado', ${lit(`zz-forzado-${stamp}@example.com`)}) RETURNING id INTO v_new;
  -- la direccion la tiene otro contacto dado de baja: se arma con el UPDATE directo de la funcion real deshabilitada
  PERFORM set_config('app.email_status_internal', 'on', true);
  INSERT INTO public.contacts (workspace_id, display_name, secondary_email, email_status) VALUES (${lit(ws)}::uuid, 'zz-test baja previa', ${lit(`zz-forzado2-${stamp}@example.com`)}, 'unsubscribed');
  PERFORM set_config('app.email_status_internal', 'off', true);
  INSERT INTO public.contacts (workspace_id, display_name, email) VALUES (${lit(ws)}::uuid, 'zz-test hereda roto', ${lit(`zz-forzado2-${stamp}@example.com`)}) RETURNING id INTO v_new;
  SELECT email_status INTO v_status FROM public.contacts WHERE id = v_new;
  SELECT count(*) INTO v_failed FROM public.audit_log WHERE entity_id = v_new AND action = 'email_status_inherit_failed';
  v_addr := public.email_address_status(${lit(ws)}::uuid, ${lit(`zz-forzado2-${stamp}@example.com`)});
  RAISE EXCEPTION 'RESULTADO: alta=% estado=% fallos=% direccion=%', CASE WHEN v_new IS NULL THEN 'no' ELSE 'si' END, v_status, v_failed, v_addr;
END $do$;`);
    check(probe === "RESULTADO: alta=si estado=subscribed fallos=1 direccion=unsubscribed".replace("RESULTADO: ", ""),
      "si la herencia falla (forzado): el alta igual se hace, queda una entrada email_status_inherit_failed, y la direccion sigue frenada para la puerta", probe);
    const gate = await canSendEmailTo(svc, { workspaceId: ws, address: addr, category: "marketing" });
    check(!gate.ok && gate.reason === "unsubscribed", "la puerta de envio mira la direccion en todos los contactos (no depende del trigger)");
  }

  console.log("\n— 8. Secuencias: la baja pausa en el momento —");
  {
    const { data: mail } = await svc.from("channels").insert({ workspace_id: ws, platform: "email", provider: "resend", late_account_id: `email:zz-${stamp}@example.com`, email_address: `zz-canal-${stamp}@example.com`, display_name: "zz email", is_active: true }).select("id").single();
    const { data: wa } = await svc.from("channels").insert({ workspace_id: ws, platform: "whatsapp", late_account_id: `zz-wa-${stamp}`, display_name: "zz wa", is_active: true }).select("id").single();
    const { data: seqM } = await svc.from("sequences").insert({ workspace_id: ws, name: "zz-test marketing", status: "active", steps: [{ type: "delay", delayMinutes: 60 }, { type: "message", content: "hola" }] }).select("id").single();
    const { data: seqT } = await svc.from("sequences").insert({ workspace_id: ws, name: "zz-test transaccional", status: "active", steps: [{ type: "message", content: "tu turno", emailCategory: "transactional" }] }).select("id").single();
    const c = await contact(ws, { display_name: "zz-test secuencia", email: `zz-seq-${stamp}@example.com` });
    const enroll = async (sequence_id: string, channel_id: string) => {
      const { data, error } = await svc.from("sequence_enrollments").insert({ sequence_id, contact_id: c, channel_id, status: "active" }).select("id").single();
      if (error) throw new Error(`no pude inscribir: ${error.message}`);
      return data.id as string;
    };
    const eMarketing = await enroll(seqM!.id, mail!.id);
    const eTransactional = await enroll(seqT!.id, mail!.id);
    const { data: seqW } = await svc.from("sequences").insert({ workspace_id: ws, name: "zz-test por whatsapp", status: "active", steps: [{ type: "message", content: "hola" }] }).select("id").single();
    const eWhatsapp = await enroll(seqW!.id, wa!.id);
    const r = await setStatus(c, { p_status: "unsubscribed", p_source: "unsubscribe_page", p_mode: "person" });
    const state = async (id: string) => (await svc.from("sequence_enrollments").select("status, paused_reason, paused_at").eq("id", id).single()).data as { status: string; paused_reason: string | null; paused_at: string | null };
    const m = await state(eMarketing);
    check(m.status === "paused" && m.paused_reason === "email_unsubscribed" && Boolean(m.paused_at), "la de email con marketing pendiente queda pausada en el momento, con el motivo");
    check((await state(eTransactional)).status === "active", "una secuencia solo transaccional no se pausa");
    check((await state(eWhatsapp)).status === "active", "una por WhatsApp no se pausa por la baja de email");
    check((r.data as { enrollments_paused: number }).enrollments_paused === 1 && (await auditOf(c))[0]?.metadata?.enrollments_paused === 1, "audit_log dice cuantas inscripciones pauso");
    await setStatus(c, { p_status: "subscribed", p_source: "unsubscribe_page", p_mode: "person" });
    check((await state(eMarketing)).status === "paused", "volver a suscribirse NO la reanuda sola");
    await setStatus(c, { p_status: "bounced", p_source: "resend_bounce", p_mode: "system" });
    check((await state(eMarketing)).paused_reason === "email_unsubscribed", "una pausa ya hecha no se pisa");
  }

  console.log("\n— 9. Ninguna otra funcion escribe esas columnas —");
  {
    const allowed = new Set([
      "email_status_apply", "email_address_status", "email_address_send_state", "set_email_status", "set_email_status_by_address",
      "contacts_email_status_guard", "contacts_email_inherit", "contacts_email_on_merge",
      // El candado por direccion: su clave empieza con el texto 'email_status:' (no escribe nada).
      "email_status_lock",
    ]);
    const rows = sql(`
      select n.nspname || '.' || p.proname as fn, p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private')
         and p.prosrc ~ '(email_status|email_status_at|email_status_source|email_subscribed_at|email_unsubscribe_token)\\M';`);
    const others = rows.filter((r) => !allowed.has(String(r.proname))).map((r) => String(r.fn));
    check(others.length === 0, "solo las funciones centrales, la guardia, la herencia y la fusion las nombran", others.join(", "));
  }
} catch (err) {
  fail(`error inesperado: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
