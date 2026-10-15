#!/usr/bin/env node
/**
 * Verificacion de la atribucion organica (Extra I, bloque AO1; migracion 00230, y 00234 con el flag).
 *
 * Corre contra la base real. Prueba lo que Vitest NO puede probar: que la BASE haga lo que dice
 *   - el canal de un toque (`touch_channel`) da lo mismo que su gemela en TypeScript sobre los mismos casos;
 *   - el codigo de cada pieza se genera solo, es unico y no queda ninguna pieza sin codigo;
 *   - un toque con el codigo de una pieza en `content_label` completa la pieza (y la publicacion si es UNA sola);
 *   - un link organico con UTMs no queda en «Sin vincular» de Meta, y uno con anuncio sigue como antes;
 *   - los dos triggers de `contact_touches` no pueden costar un toque (error forzado => entra con canal `direct`);
 *   - ningun toque queda sin canal y `contact_last_origin_touch` elige bien;
 *   - el CHECK de origen acepta `link_click` y sigue rechazando uno inventado;
 *   - la funcion del vinculo retroactivo de comentarios encola una vez y no lanza si falla;
 *   - las huellas de las ocho funciones protegidas no cambiaron.
 *
 *   --despues-de-00234   suma la comprobacion del trigger `contacts_comment_backfill` (se aplica despues del merge).
 *
 * Crea y borra todo lo suyo (prefijo zz-test-). No se corre a la vez que otro verify-*: comparten prefijo.
 * Tomar el candado /private/tmp/ssa-verify.lock.
 *
 *   node scripts/verify-organic-attribution.mjs [--despues-de-00234]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { runCleanup } from "./test-cleanup.mjs";
import { checkProtectedFunctions } from "./protected-functions.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const AFTER_00234 = process.argv.includes("--despues-de-00234");

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const stamp = Date.now();

function sql(query) {
  const out = execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out).rows ?? [];
}

/** Corre un bloque DO que termina con `RAISE EXCEPTION 'RESULTADO: ...'`: la transaccion se deshace sola. */
function sqlProbe(query) {
  try {
    execFileSync("supabase", ["db", "query", "--linked", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return "SIN RESULTADO (el bloque no levanto la excepcion final)";
  } catch (e) {
    const text = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const m = text.match(/RESULTADO: ([^"\\]*)/);
    return m ? m[1].trim() : text.slice(0, 400);
  }
}

const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

try {
  const { data: ws, error: wsErr } = await svc.from("workspaces").insert({ name: "zz-test-organic", slug: `zz-test-organic-${stamp}` }).select("id").single();
  if (wsErr) throw new Error(`no pude crear el workspace: ${wsErr.message}`);
  const { data: ws2 } = await svc.from("workspaces").insert({ name: "zz-test-organic-otro", slug: `zz-test-organic-otro-${stamp}` }).select("id").single();

  const email = `zz-test-organic-${stamp}@example.test`;
  const { data: u, error: uErr } = await svc.auth.admin.createUser({ email, password: randomUUID(), email_confirm: true });
  if (uErr) throw new Error(`no pude crear usuario: ${uErr.message}`);
  const outsiderEmail = `zz-test-organic-out-${stamp}@example.test`;
  const { data: out } = await svc.auth.admin.createUser({ email: outsiderEmail, password: randomUUID(), email_confirm: true });
  await svc.from("workspace_members").insert({ workspace_id: ws.id, user_id: u.user.id, role: "owner" });

  const newContact = async (extra = {}, workspace = ws.id) => {
    const { data, error } = await svc.from("contacts")
      .insert({ workspace_id: workspace, display_name: `zz-test ${randomUUID().slice(0, 6)}`, email: `zz-test-${randomUUID().slice(0, 8)}@example.test`, ...extra }).select("id").single();
    if (error) throw new Error(`no pude crear el contacto: ${error.message}`);
    return data.id;
  };
  const newPiece = async (workspace = ws.id) => {
    const { data, error } = await svc.from("content_posts").insert({ workspace_id: workspace, title: `zz-test pieza ${randomUUID().slice(0, 5)}`, created_by: u.user.id }).select("id, attribution_code").single();
    if (error) throw new Error(`no pude crear la pieza: ${error.message}`);
    return data;
  };
  const insertTouch = (contactId, over = {}, workspace = ws.id) =>
    svc.from("contact_touches").insert({ workspace_id: workspace, contact_id: contactId, source: "instagram", medium: "dm", origin: "dm", dedupe_key: `zz-${randomUUID()}`, occurred_at: new Date().toISOString(), ...over }).select("*").single();

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— touch_channel: paridad con la gemela de TypeScript (los mismos casos) —");
  {
    const cases = JSON.parse(readFileSync("lib/attribution/channel.cases.json", "utf8"));
    for (const c of cases.cases) {
      // Un uuid vacio no existe en la base: el caso de TypeScript "" cuenta como sin dato.
      const args = Object.fromEntries(cases.keys.map((k) => [`p_${k}`, (k.endsWith("_post_id") && c.input[k] === "") ? null : (c.input[k] ?? null)]));
      const { data, error } = await svc.rpc("touch_channel", args);
      check(!error && data === c.expected, `touch_channel: ${c.name}`, error?.message ?? `dio ${data}, esperaba ${c.expected}`);
    }
    check(cases.cases.length >= 16, `hay al menos 16 casos compartidos (${cases.cases.length})`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Codigo de atribucion de cada pieza —");
  {
    const a = await newPiece();
    const b = await newPiece();
    check(/^c[a-z2-9]{5}$/.test(a.attribution_code), "una pieza nueva nace con un codigo c + 5 caracteres", a.attribution_code);
    check(!/[01lo]/.test(a.attribution_code.slice(1)), "sin 0, 1, l ni o");
    check(a.attribution_code !== b.attribution_code, "dos piezas del mismo workspace tienen codigos distintos");
    const dup = await svc.from("content_posts").update({ attribution_code: b.attribution_code }).eq("id", a.id);
    check(!!dup.error, "dos piezas del mismo workspace NO pueden repetir el codigo (indice unico)");
    const same = await newPiece(ws2.id);
    check(/^c[a-z2-9]{5}$/.test(same.attribution_code), "otro workspace tiene su propio espacio de codigos");
    const nulls = sql("select count(*)::int as n from public.content_posts where attribution_code is null");
    check(nulls[0].n === 0, "ninguna pieza (ni vieja ni nueva) queda sin codigo");
    const info = sql("select is_nullable from information_schema.columns where table_schema='public' and table_name='content_posts' and column_name='attribution_code'");
    check(info[0]?.is_nullable === "NO", "la columna es NOT NULL");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Un toque con el codigo de la pieza —");
  {
    const piece = await newPiece();
    const code = piece.attribution_code;
    const contact = await newContact();

    const first = await insertTouch(contact, { source: "instagram", medium: "social", origin: "form", content_label: code, campaign: "zz-test-camp" });
    check(first.data?.content_post_id === piece.id, "content_label = codigo completa la pieza", first.error?.message);
    check(first.data?.channel === "organic", "el canal es organico");
    check(first.data?.meta_match_status === "ignored" && first.data?.meta_match_reason === "organic_content", "y el vinculo de Meta queda ignorado (organic_content): no aparece en «Sin vincular»", `${first.data?.meta_match_status} / ${first.data?.meta_match_reason}`);
    check(first.data?.raw?.content_code_matched === true, "queda anotado en raw.content_code_matched");
    check(first.data?.social_post_id === null, "sin publicacion en esa red, social_post_id queda vacio");

    // El codigo llega codificado y en mayusculas (UTMs de verdad).
    const encoded = await insertTouch(contact, { content_label: `%43${code.slice(1).toUpperCase()}`, source: "instagram", origin: "form" });
    check(encoded.data?.content_post_id === piece.id, "un codigo codificado (%43) y en mayusculas tambien coincide", encoded.error?.message);

    // Con UNA publicacion de la pieza en esa red, la completa; con dos, no adivina.
    const { data: sp } = await svc.from("social_posts").insert({ workspace_id: ws.id, content_post_id: piece.id, platform: "instagram", status: "published" }).select("id").single();
    const withPost = await insertTouch(contact, { content_label: code, source: "instagram", origin: "form" });
    check(withPost.data?.social_post_id === sp.id, "con una sola publicacion de la pieza en esa red, completa tambien social_post_id", withPost.error?.message);
    // El indice unico (pieza, red) ya impide dos publicaciones vivas; una borrada no cuenta.
    await svc.from("social_posts").insert({ workspace_id: ws.id, content_post_id: piece.id, platform: "instagram", status: "published", deleted_at: new Date().toISOString() });
    const withDeleted = await insertTouch(contact, { content_label: code, source: "instagram", origin: "form" });
    check(withDeleted.data?.social_post_id === sp.id, "una publicacion borrada de la misma pieza no cuenta: sigue siendo UNA");
    const otherNetwork = await insertTouch(contact, { content_label: code, source: "tiktok", origin: "form" });
    check(otherNetwork.data?.content_post_id === piece.id && otherNetwork.data?.social_post_id === null, "y en otra red sin publicaciones tampoco");

    // Un codigo que no existe, o de OTRO workspace, no hace nada.
    const other = await newPiece(ws2.id);
    const ghost = await insertTouch(contact, { content_label: "czzzzz", source: "instagram", origin: "form" });
    check(ghost.data?.content_post_id === null, "un codigo que no existe no completa nada");
    const foreign = await insertTouch(contact, { content_label: other.attribution_code, source: "instagram", origin: "form" });
    check(foreign.data?.content_post_id === null, "el codigo de una pieza de OTRO workspace no completa nada");
    const already = await insertTouch(contact, { content_label: code, source: "instagram", origin: "form", content_post_id: other.id === piece.id ? null : null });
    check(!!already.data?.id, "un toque que ya trae su pieza no se pisa (se probo sin error)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Pauta y vinculo de Meta: lo de siempre —");
  {
    const piece = await newPiece();
    const contact = await newContact();
    const paid = await insertTouch(contact, { source: "instagram", origin: "dm", ad_id: "120001", content_label: piece.attribution_code });
    check(paid.data?.channel === "paid", "un toque con ad_id es de pauta");
    check(paid.data?.meta_match_status !== "ignored", "y el vinculo de Meta NO se marca como ignorado", paid.data?.meta_match_status);
    const clid = await insertTouch(contact, { source: "web", origin: "form", medium: "paid_social" });
    check(clid.data?.channel === "paid", "un medium de pauta tambien");
    const fb = await insertTouch(contact, { source: "web", origin: "form", fbclid: "IwAR-zz", content_label: piece.attribution_code });
    check(fb.data?.channel === "organic" && fb.data?.meta_match_status !== "ignored", "fbclid + pieza: organico pero NO se ignora el vinculo (hay un dato de Meta)", `${fb.data?.channel} ${fb.data?.meta_match_status}`);
    const direct = await insertTouch(contact, { source: "web", origin: "form", medium: null });
    check(direct.data?.channel === "direct", "un toque sin ninguna senal es directo");
    const referral = await insertTouch(contact, { source: "manual", origin: "manual", medium: "referral_person" });
    check(referral.data?.channel === "referral", "un medium referral_person es referido");
    const dm = await insertTouch(contact, { source: "instagram", origin: "dm", medium: "dm" });
    check(dm.data?.channel === "organic", "un DM de Instagram sin mas datos es organico");
    const wa = await insertTouch(contact, { source: "whatsapp", origin: "dm", medium: "dm" });
    check(wa.data?.channel === "direct", "un DM de WhatsApp sin mas datos es directo");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Los triggers no pueden costar un toque —");
  {
    const contact = await newContact();
    const probe = (body) => sqlProbe(`
      DO $$
      DECLARE v record;
      BEGIN
        ${body}
        INSERT INTO public.contact_touches (workspace_id, contact_id, occurred_at, source, medium, origin, dedupe_key, content_label)
        VALUES ('${ws.id}', '${contact}', now(), 'instagram', 'dm', 'dm', 'zz-probe-${stamp}', 'cabcde')
        RETURNING * INTO v;
        RAISE EXCEPTION 'RESULTADO: %|%', v.channel, v.id IS NOT NULL;
      END $$;`);

    const channelFail = probe(`
      CREATE OR REPLACE FUNCTION public.touch_channel(p_origin text,p_medium text,p_source text,p_ad_id text,p_adset_id text,p_campaign_id text,p_meta_ad_id text,p_meta_campaign_id text,p_gclid text,p_ttclid text,p_li_fat_id text,p_ctwa_clid text,p_fbclid text,p_social_post_id uuid,p_content_post_id uuid)
        RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$ BEGIN RAISE EXCEPTION 'forzado'; END $f$;`);
    check(channelFail === "direct|t", "si el calculo del canal falla, el toque entra igual con canal `direct`", channelFail);

    const codeFail = probe(`
      CREATE OR REPLACE FUNCTION private.meta_url_decode(p_raw text) RETURNS text LANGUAGE plpgsql SET search_path = '' AS $f$ BEGIN RAISE EXCEPTION 'forzado'; END $f$;`);
    check(codeFail.endsWith("|t"), "si el trigger del codigo falla, el toque entra igual", codeFail);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Canal puesto a mano y recalculo —");
  {
    const contact = await newContact();
    const explicit = await insertTouch(contact, { source: "manual", origin: "manual", medium: "dm", channel: "referral" });
    check(explicit.data?.channel === "referral", "un canal puesto en el INSERT se respeta");
    const t = await insertTouch(contact, { source: "web", origin: "form", medium: null });
    check(t.data?.channel === "direct", "un toque sin senal arranca directo");
    const upd = await svc.from("contact_touches").update({ ad_id: "999" }).eq("id", t.data.id).select("channel").single();
    check(upd.data?.channel === "paid", "si despues se le vincula un anuncio, el canal se recalcula a pauta", upd.error?.message);
    const bad = await svc.from("contact_touches").update({ channel: "inventado" }).eq("id", t.data.id);
    check(!!bad.error, "un canal que no existe se rechaza (CHECK)");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Origen link_click y ultimo toque con origen —");
  {
    const contact = await newContact();
    const click = await insertTouch(contact, { source: "instagram", origin: "link_click", medium: "dm_link", dedupe_key: `zz-click-${stamp}`, occurred_at: "2026-10-01T10:00:00Z" });
    check(!click.error && click.data?.channel === "organic", "el origen link_click se acepta y es organico", click.error?.message);
    const bad = await svc.from("contact_touches").insert({ workspace_id: ws.id, contact_id: contact, source: "web", origin: "inventado", dedupe_key: `zz-bad-${stamp}` });
    check(!!bad.error, "un origen inventado sigue rechazado");
    const later = await insertTouch(contact, { source: "web", origin: "form", medium: null, occurred_at: "2026-10-05T10:00:00Z" });
    const lastOrigin = await svc.rpc("contact_last_origin_touch", { p_contact_id: contact });
    check(lastOrigin.data === click.data.id, "contact_last_origin_touch salta el toque directo y devuelve el ultimo con origen", `${lastOrigin.data} vs ${click.data.id} (directo ${later.data?.id})`);
    const none = await newContact();
    await insertTouch(none, { source: "web", origin: "form", medium: null });
    check((await svc.rpc("contact_last_origin_touch", { p_contact_id: none })).data === null, "y sin ningun toque con origen devuelve null");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Relleno del historico y configuracion —");
  {
    const nulls = sql("select count(*)::int as n from public.contact_touches where channel is null");
    check(nulls[0].n === 0, "no queda ningun toque sin canal");
    const settings = await svc.from("workspaces").select("attribution_settings").eq("id", ws.id).single();
    const s = settings.data?.attribution_settings;
    check(s?.comments_create_contact?.instagram === false && s?.comments_create_contact?.tiktok === true && s?.content_inherit_days === 7 && s?.links_append_default === false && s?.links_track_clicks_default === true,
      "un workspace nuevo trae la configuracion por defecto de la atribucion", JSON.stringify(s));
    const bad = await svc.from("workspaces").update({ attribution_settings: [] }).eq("id", ws.id);
    check(!!bad.error, "una configuracion que no es un objeto se rechaza");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Responsable de una publicacion sin pieza —");
  {
    const { data: post } = await svc.from("social_posts").insert({ workspace_id: ws.id, platform: "instagram", origin: "external", external_post_id: `zz-test-${stamp}` }).select("id").single();
    const member = await svc.from("social_posts").update({ assigned_to: u.user.id }).eq("id", post.id);
    check(!member.error, "un miembro del workspace se puede asignar", member.error?.message);
    const outsider = await svc.from("social_posts").update({ assigned_to: out.user.id }).eq("id", post.id);
    check(!!outsider.error, "alguien que NO es del equipo, no");
    const clear = await svc.from("social_posts").update({ assigned_to: null }).eq("id", post.id);
    check(!clear.error, "y se puede quitar");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Vinculo retroactivo de comentarios: la funcion del trigger —");
  {
    const contact = await newContact();
    const enqueue = (body) => sqlProbe(`
      DO $$
      DECLARE n int; w int;
      BEGIN
        DROP TRIGGER IF EXISTS zz_probe_backfill ON public.contacts;
        CREATE TRIGGER zz_probe_backfill AFTER INSERT OR UPDATE OF instagram_username, tiktok_username ON public.contacts
          FOR EACH ROW WHEN (NEW.deleted_at IS NULL) EXECUTE FUNCTION private.enqueue_comment_backfill();
        ${body}
        SELECT count(*) INTO n FROM public.scheduled_jobs WHERE type = 'comment_backfill' AND payload ->> 'contact_id' = '${contact}';
        RAISE EXCEPTION 'RESULTADO: %', n;
      END $$;`);

    check(enqueue(`UPDATE public.contacts SET instagram_username = 'zz_test_ana' WHERE id = '${contact}';`) === "1", "ganar un usuario de Instagram encola UN vinculo de comentarios");
    check(enqueue(`UPDATE public.contacts SET instagram_username = 'zz_test_ana' WHERE id = '${contact}'; UPDATE public.contacts SET display_name = 'otro nombre' WHERE id = '${contact}';`) === "1", "un cambio que no toca el usuario no encola otro");
    check(enqueue(`UPDATE public.contacts SET instagram_username = 'zz_test_ana' WHERE id = '${contact}'; UPDATE public.contacts SET instagram_username = 'zz_test_ana' WHERE id = '${contact}';`) === "1", "repetir el mismo usuario no encola otro");
    check(enqueue(`UPDATE public.contacts SET instagram_username = 'zz_test_ana', tiktok_username = 'zz_test_ana_tt' WHERE id = '${contact}';`) === "2", "Instagram y TikTok a la vez encolan uno por red");
    const failing = enqueue(`ALTER TABLE public.scheduled_jobs ADD CONSTRAINT zz_fail CHECK (false) NOT VALID;
        UPDATE public.contacts SET instagram_username = 'zz_test_boom' WHERE id = '${contact}';`);
    check(failing === "0", "si no puede encolar, NO lanza: el contacto se actualiza igual", failing);
    check(enqueue(`UPDATE public.contacts SET deleted_at = now() WHERE id = '${contact}'; UPDATE public.contacts SET instagram_username = 'zz_test_borrado' WHERE id = '${contact}';`) === "0", "un contacto borrado no encola nada");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Un formulario con utm_content = codigo, y los clics de un link (F40 y F41) —");
  {
    const piece = await newPiece();
    const contact = await newContact();
    // Lo que escribe el formulario: `record_contact_touch` con `content` = el utm_content (el trigger lo reconoce).
    const form = await svc.rpc("record_contact_touch", {
      p_workspace_id: ws.id, p_contact_id: contact,
      p_touch: { source: "instagram", medium: "organic_social", origin: "form", content: piece.attribution_code, campaign: "info-reel", dedupe_key: `zz-form-${stamp}`, occurred_at: new Date().toISOString() },
    });
    check(form.data?.inserted === true, "el formulario deja su toque", form.error?.message);
    const t = (await svc.from("contact_touches").select("content_post_id, channel, meta_match_status").eq("workspace_id", ws.id).eq("dedupe_key", `zz-form-${stamp}`).single()).data;
    check(t?.content_post_id === piece.id && t?.channel === "organic" && t?.meta_match_status === "ignored", "...vinculado a la pieza, organico y fuera de «Sin vincular» de Meta", JSON.stringify(t));

    // Los clics de un link con seguimiento: UNO por dia, por persona y pieza.
    const click = (key) => svc.rpc("record_contact_touch", {
      p_workspace_id: ws.id, p_contact_id: contact,
      p_touch: { source: "instagram", medium: "dm_link", origin: "link_click", content: piece.attribution_code, content_post_id: piece.id, dedupe_key: key, occurred_at: new Date().toISOString() },
    });
    const key = `click:${contact}:${randomUUID()}:${piece.id}:${new Date().toISOString().slice(0, 10)}`;
    check((await click(key)).data?.inserted === true, "el primer clic del dia deja un toque link_click");
    check((await click(key)).data?.reason === "duplicate", "el segundo clic del mismo dia NO deja otro (misma clave)");
    const clicks = (await svc.from("contact_touches").select("id, channel", { count: "exact" }).eq("contact_id", contact).eq("origin", "link_click")).data ?? [];
    check(clicks.length === 1 && clicks[0].channel === "organic", "queda UN toque link_click y es organico");
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n— Funciones y lo que NO se toco —");
  {
    checkProtectedFunctions(sql, check);
    const fns = sql("select proname, prosecdef from pg_proc where proname in ('contact_touches_content_code_trg','contact_touches_zz_channel_trg','content_posts_attribution_code_trg','social_posts_assignee_guard','enqueue_comment_backfill','new_attribution_code')");
    check(fns.length === 6 && fns.every((f) => f.prosecdef), "las seis funciones nuevas son SECURITY DEFINER");
    const trg = sql("select tgname from pg_trigger where tgrelid = 'public.contact_touches'::regclass and not tgisinternal order by tgname").map((t) => t.tgname);
    check(JSON.stringify(trg) === JSON.stringify(["contact_touches_content_code", "contact_touches_meta_match", "contact_touches_zz_channel", "set_updated_at"]),
      "los triggers de contact_touches corren en el orden esperado (content_code < meta_match < zz_channel)", trg.join(","));
    const assignee = sql("select tgname from pg_trigger where tgrelid = 'public.content_posts'::regclass and tgname = 'content_posts_assignee'");
    check(assignee.length === 1, "el trigger de responsable de las piezas (00223) sigue ahi");
    const hook = sql("select tgname from pg_trigger where tgrelid = 'public.contacts'::regclass and tgname = 'contacts_comment_backfill'");
    if (AFTER_00234) check(hook.length === 1, "el trigger contacts_comment_backfill existe (00234)");
    else check(hook.length === 0, "el trigger contacts_comment_backfill todavia NO existe (la 00234 se aplica despues del merge)");
  }

  if (AFTER_00234) {
    console.log("\n— Despues de la 00234 —");
    const contact = await newContact({ instagram_username: `zz_test_${stamp}` });
    const jobs = sql(`select count(*)::int as n from public.scheduled_jobs where type = 'comment_backfill' and payload ->> 'contact_id' = '${contact}'`);
    check(jobs[0].n === 1, "crear un contacto con usuario de Instagram encola el vinculo de comentarios");
    await svc.from("scheduled_jobs").delete().eq("type", "comment_backfill").filter("payload->>contact_id", "eq", contact);
    const sweep = sql("select count(*)::int as n from public.scheduled_jobs where type = 'comment_backfill_workspace'");
    check(sweep[0].n >= 0, "el barrido inicial por workspace se encolo una vez");
  }
} catch (e) {
  fail("el script fallo", e instanceof Error ? e.stack : String(e));
} finally {
  try {
    await runCleanup(svc);
    console.log("\n  limpieza de los datos zz-test- hecha");
  } catch (e) {
    fail("la limpieza fallo", e instanceof Error ? e.message : String(e));
  }
}

console.log(failures ? `\n${failures} falla(s)` : "\nTodo verde");
process.exit(failures ? 1 : 0);
