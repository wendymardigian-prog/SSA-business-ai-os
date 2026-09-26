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
  const ajeno = await makeUser("ajeno");

  await svc.from("workspace_members").insert([
    { workspace_id: wsA, user_id: owner.id, role: "owner" },
    { workspace_id: wsA, user_id: member.id, role: "member" },
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

  console.log("\n— Aprobar es una sola transaccion —");

  { const { data: postId, error } = await owner.client.rpc("approve_content_idea", {
      p_idea_id: ideaMember.id,
      p_title: "zz-test pieza de la idea",
      p_format: "reel",
      p_copy: { hook: "h", body: "", cta: "", recording_notes: "" },
    });
    check(!error && postId, "el Owner aprueba: se crea la pieza y la idea queda aprobada", error?.message);

    const { data: idea } = await svc.from("content_ideas").select("status").eq("id", ideaMember.id).single();
    const { data: post } = await svc.from("content_posts").select("id, status, idea_id").eq("id", postId).maybeSingle();
    check(idea.status === "aprobada" && post?.status === "draft" && post?.idea_id === ideaMember.id,
      "quedan las dos cosas: idea aprobada y pieza en borrador");

    const { error: eDoble } = await owner.client.rpc("approve_content_idea", {
      p_idea_id: ideaMember.id, p_title: "otra", p_format: null, p_copy: {},
    });
    check(!!eDoble, "aprobar dos veces la misma idea se rechaza (un doble clic no crea dos piezas)"); }

  { // Un Member que intenta aprobar: la funcion corre con SU permiso, asi que
    // la idea no se aprueba Y la pieza no queda creada.
    const { data: otraIdea } = await svc.from("content_ideas")
      .insert({ workspace_id: wsA, title: "zz-test idea para el member", created_by: member.id })
      .select("id").single();
    const antes = await svc.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", wsA);
    const { error } = await member.client.rpc("approve_content_idea", {
      p_idea_id: otraIdea.id, p_title: "zz-test no deberia existir", p_format: null, p_copy: {},
    });
    const despues = await svc.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", wsA);
    const { data: idea } = await svc.from("content_ideas").select("status").eq("id", otraIdea.id).single();
    check(!!error, "un Member no puede aprobar por la API directa", error ? undefined : "no dio error");
    check(idea.status === "nueva" && antes.count === despues.count,
      "y no queda una pieza huerfana: la transaccion se deshizo entera"); }

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
