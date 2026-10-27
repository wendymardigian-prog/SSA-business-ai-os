#!/usr/bin/env node
/**
 * Verificacion del pipeline de contenido contra la base real (F16).
 *
 * Lo que se prueba aca no se puede probar con vitest: son las policies de
 * RLS y las del bucket, que son la barrera de verdad. La pantalla puede
 * esconder un boton; esto comprueba que la base tampoco deja.
 *
 * Crea DOS workspaces con sus usuarios, prueba el cruce en los dos sentidos y
 * borra todo al terminar. Si la limpieza falla, es un test fallido.
 *
 *   node scripts/verify-content.mjs
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
  const email = `zz-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const password = randomUUID();
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw new Error(`no pude loguear ${tag}: ${e.message}`);
  return { id: data.user.id, client };
}

async function makeWorkspace(name) {
  const { data, error } = await svc.from("workspaces")
    .insert({ name: `zz-test-${name}`, slug: `zz-test-${name}-${Date.now()}` })
    .select("id").single();
  if (error) throw new Error(`no pude crear el workspace ${name}: ${error.message}`);
  return data.id;
}

try {
  const wsA = await makeWorkspace("contenido-a");
  const wsB = await makeWorkspace("contenido-b");

  const owner = await makeUser("owner");
  const member = await makeUser("member");
  const member2 = await makeUser("member2");
  const ajeno = await makeUser("ajeno");

  await svc.from("workspace_members").insert([
    { workspace_id: wsA, user_id: owner.id, role: "owner" },
    { workspace_id: wsA, user_id: member.id, role: "member" },
    { workspace_id: wsA, user_id: member2.id, role: "member" },
    { workspace_id: wsB, user_id: ajeno.id, role: "owner" },
  ]);

  console.log("\n— Ideas —");

  // El Member crea su idea con su propio cliente: la RLS decide.
  const { data: ideaMember, error: eIdea } = await member.client.from("content_ideas")
    .insert({ workspace_id: wsA, title: "zz-test idea del member", created_by: member.id })
    .select("id").single();
  check(!eIdea && ideaMember?.id, "un Member puede crear una idea", eIdea?.message);

  { const { error } = await member.client.from("content_ideas")
      .insert({ workspace_id: wsA, title: "zz-test ya aprobada", created_by: member.id, status: "aprobada" });
    check(!!error, "un Member no puede crear una idea ya aprobada, salteandose el paso"); }

  { const { error } = await member.client.from("content_ideas")
      .update({ status: "aprobada" }).eq("id", ideaMember.id);
    const { data } = await svc.from("content_ideas").select("status").eq("id", ideaMember.id).single();
    check(data.status === "nueva", "un Member no puede aprobar su propia idea", error?.message); }

  { const { error } = await owner.client.from("content_ideas")
      .update({ status: "descartada" }).eq("id", ideaMember.id);
    check(!error, "el Owner si puede decidir sobre la idea", error?.message);
    await svc.from("content_ideas").update({ status: "nueva" }).eq("id", ideaMember.id); }

  console.log("\n— Aprobar es una sola transaccion, y hereda la clasificacion —");

  // Una idea con TODA la clasificacion cargada, para ver que pasa a la pieza.
  const { data: pilar } = await svc.from("content_pillars")
    .insert({ workspace_id: wsA, name: "zz-test Educativo", color: "#10b981" }).select("id").single();
  const { data: oferta } = await svc.from("products")
    .insert({ workspace_id: wsA, name: "zz-test Mentoria" }).select("id").single();
  await svc.from("content_ideas").update({
    content: "Hook de la idea\n\nAngulo y notas",
    platforms: ["instagram", "tiktok"],
    pillar_id: pilar.id,
    offer_id: oferta.id,
    funnel_stage: "mofu",
    reference: "https://ejemplo.test/ref",
  }).eq("id", ideaMember.id);

  { const { data: postId, error } = await owner.client.rpc("approve_content_idea_v2", {
      p_idea_id: ideaMember.id,
      p_title: "zz-test pieza de la idea",
      p_format: "reel",
    });
    check(!error && postId, "el Owner aprueba: se crea la pieza y la idea queda aprobada", error?.message);

    const { data: idea } = await svc.from("content_ideas").select("status").eq("id", ideaMember.id).single();
    const { data: post } = await svc.from("content_posts")
      .select("id, status, idea_id, format, pillar_id, offer_id, funnel_stage, reference, networks, script, recording_notes")
      .eq("id", postId).maybeSingle();
    check(idea.status === "aprobada" && post?.status === "draft" && post?.idea_id === ideaMember.id,
      "quedan las dos cosas: idea aprobada y pieza en borrador");

    check(post?.pillar_id === pilar.id && post?.offer_id === oferta.id && post?.funnel_stage === "mofu",
      "la pieza hereda el pilar, la oferta y la etapa del embudo de la idea");
    check(post?.format === "reel" && post?.reference === "https://ejemplo.test/ref",
      "hereda el formato y la referencia");
    check(JSON.stringify((post?.networks ?? []).map((n) => n.platform)) === JSON.stringify(["instagram", "tiktok"]),
      "las plataformas de la idea pasan a ser las redes de la pieza, en el mismo orden");
    check((post?.networks ?? []).every((n) => n.planned_at === null && n.caption === null),
      "las redes heredadas entran SIN fecha ni caption: elegir la red no es programarla");
    check(post?.script === null && post?.recording_notes === null,
      "el guion y las notas de grabacion arrancan vacios: el texto de la idea es contexto");

    // @plantilla-desde(proyecto)
    // La 00118 (6/10/2026) borro lo del modelo viejo: que no vuelva sin que nadie lo note.
    const { error: eCopy } = await svc.from("content_posts").select("copy").limit(1);
    const { error: eHook } = await svc.from("content_ideas").select("hook").limit(1);
    check(!!eCopy && !!eHook, "las columnas viejas (`copy`, `hook`) ya no existen: las borro la 00118");
    const { error: eV1 } = await owner.client.rpc("approve_content_idea", {
      p_idea_id: ideaMember.id, p_title: "x", p_format: null, p_copy: {},
    });
    check(!!eV1 && /could not find the function/i.test(eV1.message), "la funcion `approve_content_idea` vieja ya no existe", eV1?.message);
    // @plantilla-hasta(proyecto)

    const { error: eDoble } = await owner.client.rpc("approve_content_idea_v2", {
      p_idea_id: ideaMember.id, p_title: "otra", p_format: null,
    });
    check(!!eDoble, "aprobar dos veces la misma idea se rechaza (un doble clic no crea dos piezas)"); }

  { // Un Member que intenta aprobar: la funcion corre con SU permiso, asi que
    // la idea no se aprueba Y la pieza no queda creada.
    const { data: otraIdea } = await svc.from("content_ideas")
      .insert({ workspace_id: wsA, title: "zz-test idea para el member", created_by: member.id })
      .select("id").single();
    const antes = await svc.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", wsA);
    const { error } = await member.client.rpc("approve_content_idea_v2", {
      p_idea_id: otraIdea.id, p_title: "zz-test no deberia existir", p_format: null,
    });
    const despues = await svc.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", wsA);
    const { data: idea } = await svc.from("content_ideas").select("status").eq("id", otraIdea.id).single();
    check(!!error, "un Member no puede aprobar por la API directa", error ? undefined : "no dio error");
    check(idea.status === "nueva" && antes.count === despues.count,
      "y no queda una pieza huerfana: la transaccion se deshizo entera"); }

  { // Una idea sin clasificar se aprueba igual, y la pieza queda sin clasificar.
    const { data: lisa } = await svc.from("content_ideas")
      .insert({ workspace_id: wsA, title: "zz-test idea pelada", created_by: member.id }).select("id").single();
    const { data: postId, error } = await owner.client.rpc("approve_content_idea_v2", {
      p_idea_id: lisa.id, p_title: "zz-test pieza pelada", p_format: null,
    });
    const { data: post } = await svc.from("content_posts")
      .select("pillar_id, offer_id, funnel_stage, networks").eq("id", postId).maybeSingle();
    check(!error && post?.pillar_id === null && post?.offer_id === null && post?.funnel_stage === null
      && (post?.networks ?? []).length === 0,
      "una idea sin clasificar se aprueba igual y la pieza queda sin pilar ni oferta", error?.message); }

  { // Archivar el pilar NO le saca el pilar a la pieza que ya lo tiene.
    await svc.from("content_pillars").update({ archived_at: new Date().toISOString() }).eq("id", pilar.id);
    const { data: post } = await svc.from("content_posts").select("pillar_id").eq("workspace_id", wsA)
      .eq("pillar_id", pilar.id).maybeSingle();
    check(post?.pillar_id === pilar.id, "archivar un pilar no se lo saca a la pieza que lo usa"); }

  console.log("\n— Piezas —");

  const { data: postMember } = await member.client.from("content_posts")
    .insert({ workspace_id: wsA, title: "zz-test pieza del member", created_by: member.id })
    .select("id").single();
  check(!!postMember?.id, "un Member puede crear una pieza");

  { const { error } = await member.client.from("content_posts")
      .update({ status: "in_review" }).eq("id", postMember.id);
    check(!error, "y mandarla a revision", error?.message); }

  { const { error } = await member.client.from("content_posts")
      .update({ status: "approved" }).eq("id", postMember.id);
    const { data } = await svc.from("content_posts").select("status").eq("id", postMember.id).single();
    check(data.status === "in_review", "un Member NO puede aprobar su pieza por la API directa", error?.message); }

  { const { error } = await member.client.from("content_posts")
      .update({ status: "scheduled" }).eq("id", postMember.id);
    const { data } = await svc.from("content_posts").select("status").eq("id", postMember.id).single();
    check(data.status === "in_review", "ni programarla", error?.message); }

  { const { data: postOwner } = await svc.from("content_posts")
      .insert({ workspace_id: wsA, title: "zz-test pieza del owner", created_by: owner.id })
      .select("id").single();
    const { error } = await member.client.from("content_posts")
      .update({ title: "secuestrada" }).eq("id", postOwner.id);
    const { data } = await svc.from("content_posts").select("title").eq("id", postOwner.id).single();
    check(data.title === "zz-test pieza del owner", "un Member no edita la pieza de otro", error?.message); }

  { const { data } = await member.client.from("content_posts").select("id").eq("id", postMember.id);
    check((data ?? []).length === 1, "pero SI ve todas las piezas del workspace: el contenido no tiene scope de leads"); }

  console.log("\n— Responsable de la pieza (00223) —");

  { const { data } = await svc.from("content_posts").select("assigned_to").eq("id", postMember.id).single();
    check(data.assigned_to === member.id, "una pieza nueva queda asignada a quien la crea (trigger)"); }

  { const { data: p } = await svc.from("content_posts")
      .insert({ workspace_id: wsA, title: "zz-test pieza asignada", created_by: owner.id })
      .select("id, assigned_to").single();
    check(p.assigned_to === owner.id, "lo mismo si la crea el servidor (aprobar una idea, el agente)");

    // El Owner se la asigna a un Member: ahora la puede editar, sin ser su autor.
    await svc.from("content_posts").update({ assigned_to: member.id }).eq("id", p.id);
    { const { error } = await member.client.from("content_posts").update({ title: "zz-test editada por el responsable" }).eq("id", p.id);
      const { data } = await svc.from("content_posts").select("title, created_by").eq("id", p.id).single();
      check(!error && data.title === "zz-test editada por el responsable" && data.created_by === owner.id,
        "un Member edita la pieza que tiene ASIGNADA, y created_by no cambia", error?.message); }

    { await member.client.from("content_posts").update({ assigned_to: member2.id }).eq("id", p.id);
      const { data } = await svc.from("content_posts").select("assigned_to").eq("id", p.id).single();
      check(data.assigned_to === member.id, "pero el responsable no se la pasa a otra persona (eso es del autor o un admin)"); }

    { await member.client.from("content_posts").update({ status: "approved" }).eq("id", p.id);
      const { data } = await svc.from("content_posts").select("status").eq("id", p.id).single();
      check(data.status !== "approved", "ni la aprueba: el limite de estados es el mismo"); }

    // Quien NO es autor ni responsable sigue sin poder.
    { await member2.client.from("content_posts").update({ title: "colada" }).eq("id", p.id);
      const { data } = await svc.from("content_posts").select("title").eq("id", p.id).single();
      check(data.title !== "colada", "un tercero Member sigue sin editarla"); }

    // El responsable tiene que ser del equipo.
    { const { error } = await svc.from("content_posts").update({ assigned_to: ajeno.id }).eq("id", p.id);
      check(!!error, "el responsable tiene que ser miembro del workspace (trigger)", error ? undefined : "lo dejo asignar a alguien de otro negocio"); }
  }

  { // El autor SI reasigna.
    const { error } = await member.client.from("content_posts").update({ assigned_to: member2.id }).eq("id", postMember.id);
    const { data } = await svc.from("content_posts").select("assigned_to").eq("id", postMember.id).single();
    check(!error && data.assigned_to === member2.id, "quien creo la pieza puede cambiar el responsable", error?.message); }

  if (process.argv.includes("--despues-de-00253")) { // @plantilla-quitar(proyecto)
  // @plantilla-sin(proyecto): {
    console.log("\n— Editar en cualquier estado —");

    const { data: aprobada } = await svc.from("content_posts")
      .insert({ workspace_id: wsA, title: "zz-test aprobada del member", created_by: member.id, status: "approved" })
      .select("id").single();

    { const { error } = await member.client.from("content_posts")
        .update({ caption: "zz-test corregido despues de aprobar" }).eq("id", aprobada.id);
      const { data } = await svc.from("content_posts").select("caption, status").eq("id", aprobada.id).single();
      check(!error && data.caption === "zz-test corregido despues de aprobar" && data.status === "approved",
        "un Member edita el caption de su pieza APROBADA, y el estado no cambia", error?.message); }

    { const { error } = await member.client.from("content_posts")
        .update({ status: "draft" }).eq("id", aprobada.id);
      const { data } = await svc.from("content_posts").select("status").eq("id", aprobada.id).single();
      check(!!error && data.status === "approved",
        "pero no le cambia el estado: sacarla de Aprobado es de quien aprueba (trigger)",
        error ? undefined : "la movio a borrador"); }

    { await svc.from("content_posts").update({ status: "published" }).eq("id", aprobada.id);
      const { error } = await member.client.from("content_posts")
        .update({ script: "zz-test guion despues de publicar" }).eq("id", aprobada.id);
      const { data } = await svc.from("content_posts").select("script").eq("id", aprobada.id).single();
      check(!error && data.script === "zz-test guion despues de publicar",
        "tambien edita una PUBLICADA", error?.message); }

    { await member2.client.from("content_posts").update({ caption: "colada" }).eq("id", aprobada.id);
      const { data } = await svc.from("content_posts").select("caption").eq("id", aprobada.id).single();
      check(data.caption !== "colada", "un Member que no es autor ni responsable sigue sin editarla"); }

    { const { error } = await owner.client.from("content_posts")
        .update({ status: "approved" }).eq("id", aprobada.id);
      check(!error, "Owner y Admin siguen moviendo el estado como siempre", error?.message); }
    // @plantilla-desde(proyecto)
  } else {
    console.log("\n(sin --despues-de-00253: no se prueba editar en cualquier estado)");
    // @plantilla-hasta(proyecto)
  }

  console.log("\n— social_posts solo la escribe el servidor —");

  { const { data: sp } = await svc.from("social_posts").insert({
      workspace_id: wsA, content_post_id: postMember.id, platform: "instagram",
      status: "scheduled", scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    }).select("id").single();

    const { data: visible } = await member.client.from("social_posts").select("id").eq("id", sp.id);
    check((visible ?? []).length === 1, "un Member ve las publicaciones programadas");

    const { error } = await member.client.from("social_posts")
      .update({ status: "published" }).eq("id", sp.id);
    const { data } = await svc.from("social_posts").select("status").eq("id", sp.id).single();
    check(data.status === "scheduled", "pero no las puede tocar: eso lo escribe el servidor", error?.message);

    const { error: eIns } = await member.client.from("social_posts")
      .insert({ workspace_id: wsA, platform: "tiktok", status: "scheduled" }).select("id");
    check(!!eIns, "ni crear una publicacion a mano"); }

  console.log("\n— Nada se cruza entre workspaces —");

  { const { data } = await ajeno.client.from("content_posts").select("id").eq("workspace_id", wsA);
    check((data ?? []).length === 0, "el Owner de otro workspace no ve estas piezas"); }

  { const { data } = await ajeno.client.from("content_ideas").select("id").eq("workspace_id", wsA);
    check((data ?? []).length === 0, "ni las ideas"); }

  { const { data } = await ajeno.client.from("social_posts").select("id").eq("workspace_id", wsA);
    check((data ?? []).length === 0, "ni las publicaciones"); }

  { const { error } = await ajeno.client.from("content_posts")
      .insert({ workspace_id: wsA, title: "zz-test colada", created_by: ajeno.id }).select("id");
    const { data } = await svc.from("content_posts").select("id").eq("title", "zz-test colada");
    check((data ?? []).length === 0, "ni puede crear una pieza dentro de nuestro workspace", error?.message); }

  console.log("\n— El bucket de media —");

  const archivo = new Blob(["contenido de prueba"], { type: "image/png" });
  const rutaA = `${wsA}/zz-test-${Date.now()}.png`;

  { const { error } = await member.client.storage.from("content-media").upload(rutaA, archivo, {
      contentType: "image/png",
    });
    check(!error, "un Member del workspace puede subir media a la carpeta de su workspace", error?.message); }

  { const { data, error } = await owner.client.storage.from("content-media").download(rutaA);
    check(!error && data, "el Owner del mismo workspace la puede leer", error?.message); }

  { const { data, error } = await ajeno.client.storage.from("content-media").download(rutaA);
    check(!data || !!error, "el de OTRO workspace no la puede leer", "pudo descargarla"); }

  { const rutaAjena = `${wsA}/zz-test-colado-${Date.now()}.png`;
    const { error } = await ajeno.client.storage.from("content-media").upload(rutaAjena, archivo, {
      contentType: "image/png",
    });
    const { data: listado } = await svc.storage.from("content-media").list(wsA);
    const colado = (listado ?? []).some((f) => f.name.includes("colado"));
    check(!!error && !colado, "ni puede escribir dentro de la carpeta de otro workspace", error ? undefined : "subio igual"); }

  { const { error } = await member.client.storage.from("content-media").remove([rutaA]);
    const { data: listado } = await svc.storage.from("content-media").list(wsA);
    const sigue = (listado ?? []).some((f) => rutaA.endsWith(f.name));
    check(sigue, "un Member no borra media: sacarla de un post publicado rompe lo que se ve en la red", error?.message); }

  { const { error } = await owner.client.storage.from("content-media").remove([rutaA]);
    check(!error, "el Owner si puede borrarla", error?.message); }

  // Lo que quedo en el bucket, por si algun check fallo antes de borrar.
  const { data: restante } = await svc.storage.from("content-media").list(wsA);
  for (const f of restante ?? []) await svc.storage.from("content-media").remove([`${wsA}/${f.name}`]);
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
