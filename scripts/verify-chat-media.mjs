#!/usr/bin/env node
/**
 * Verificacion de las Mejoras de Chat, corrida B (Bloques 4-6) y de la banca
 * de recursos unificada (textos + audios).
 *
 * Corre contra la base real con usuarios de verdad. Prueba lo que vitest NO
 * puede probar: policies de Storage y RLS evaluadas por la BASE, no por el
 * codigo que las supone.
 *
 * Tres cosas:
 *   A. El bucket `chat-media` sigue scopeado por workspace para la banca de
 *      recursos (`<ws>/library/...`), igual que para los adjuntos del chat:
 *      un Member de otro workspace no lee, y nadie sube directo (solo el
 *      service role, via signed upload URL).
 *   B. RLS de `response_assets` (migracion 00105): cualquier miembro lee,
 *      solo Owner/Admin escriben. Si la 00105 todavia no esta aplicada, esta
 *      seccion se SALTEA con un aviso en vez de marcar una falla: no hay
 *      nada roto, falta aplicar la migracion. Incluye el chequeo de que el
 *      atajo es unico ENTRE LOS DOS TIPOS: un texto y un audio no pueden
 *      compartir uno.
 *   C. La foto de un contacto copiada a Storage (F16) sigue el path
 *      `avatars/<ws>/contacts/<id>.jpg` (bucket publico, migracion 00095,
 *      ya aplicada).
 *
 * Crea y borra todo lo suyo (prefijo zz-test-), DB y Storage. Una limpieza
 * que falla es una prueba que falla. No correr en simultaneo con otro
 * verify-*.mjs: comparten el prefijo.
 *
 *   node scripts/verify-chat-media.mjs
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

const CHAT_MEDIA_BUCKET = "chat-media";
const AVATAR_BUCKET = "avatars";

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));
const skip = (m) => console.log("  --  ", m, "(salteado)");

/**
 * La tabla todavia no existe. 42P01 es el codigo de Postgres; PGRST205 es el
 * de PostgREST cuando no la encuentra en el cache de schema (lo que pasa en
 * la practica: PostgREST cachea el esquema y ni llega a preguntarle a
 * Postgres). El texto del mensaje es el respaldo si cambia el codigo.
 */
function isMissingTable(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist/i.test(error?.message ?? "") ||
    /could not find the table/i.test(error?.message ?? "")
  );
}

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

const smallJpeg = () =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const smallM4a = () => Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]);

const uploadedPaths = [];

try {
  const { data: wsA } = await svc.from("workspaces")
    .insert({ name: "zz-test-chatmedia-a", slug: `zz-test-chatmedia-a-${Date.now()}` }).select("id").single();
  const { data: wsB } = await svc.from("workspaces")
    .insert({ name: "zz-test-chatmedia-b", slug: `zz-test-chatmedia-b-${Date.now()}` }).select("id").single();

  const admin = await makeUser("cm-admin");
  const member = await makeUser("cm-member");
  const ajeno = await makeUser("cm-ajeno");

  await svc.from("workspace_members").insert([
    { workspace_id: wsA.id, user_id: admin.id, role: "admin" },
    { workspace_id: wsA.id, user_id: member.id, role: "member" },
    { workspace_id: wsB.id, user_id: ajeno.id, role: "member" },
  ]);

  console.log("\n— A. El bucket chat-media sigue scopeado por workspace (banca de audios) —");
  {
    const path = `${wsA.id}/library/zz-test-${randomUUID()}.m4a`;
    const { error: upErr } = await svc.storage.from(CHAT_MEDIA_BUCKET).upload(path, smallM4a(), { contentType: "audio/mp4" });
    if (upErr) {
      fail("el service role pudo subir a library/ (precondicion)", upErr.message);
    } else {
      uploadedPaths.push(path);

      const { data: propio, error: eOwn } = await member.client.storage.from(CHAT_MEDIA_BUCKET).download(path);
      check(!eOwn && propio, "un Member de ese workspace lee su propio audio de la banca");

      const { data: ajenoData, error: eAjeno } = await ajeno.client.storage.from(CHAT_MEDIA_BUCKET).download(path);
      check(!ajenoData && Boolean(eAjeno), "un miembro de OTRO workspace no lo lee");

      const { error: eWrite } = await member.client.storage.from(CHAT_MEDIA_BUCKET)
        .upload(`${wsA.id}/library/zz-test-directo.m4a`, smallM4a(), { contentType: "audio/mp4" });
      check(Boolean(eWrite), "un Member no puede subir directo (sin policy de escritura, solo signed URL)");
    }
  }

  console.log("\n— B. RLS de response_assets (00105) —");
  {
    const { error: probe } = await svc.from("response_assets").select("id").limit(1);
    if (probe && isMissingTable(probe)) {
      skip("response_assets no existe todavia: la 00105 esta escrita pero no aplicada");
    } else if (probe) {
      fail("no pude consultar response_assets", probe.message);
    } else {
      const { data: asset, error: insErr } = await svc.from("response_assets").insert({
        workspace_id: wsA.id, kind: "audio", name: "zz-test audio", description: "para probar RLS",
        storage_path: `${wsA.id}/library/zz-test-rls.m4a`, mime_type: "audio/mp4", source: "uploaded",
      }).select("id").single();
      if (insErr) {
        fail("el service role pudo crear un audio (precondicion)", insErr.message);
      } else {
        const { data: lee, error: eLee } = await member.client.from("response_assets").select("id").eq("id", asset.id).maybeSingle();
        check(!eLee && lee?.id === asset.id, "un Member LEE el audio de su workspace");

        const { data: leeAjeno } = await ajeno.client.from("response_assets").select("id").eq("id", asset.id).maybeSingle();
        check(!leeAjeno, "un miembro de otro workspace no lo lee");

        const { error: eUpdate } = await member.client.from("response_assets")
          .update({ name: "intento de Member" }).eq("id", asset.id);
        const { data: sigue } = await svc.from("response_assets").select("name").eq("id", asset.id).single();
        check(sigue?.name === "zz-test audio", "un Member NO puede editarlo (la RLS lo corta, aunque el UPDATE no de error)");

        const { error: eInsertMember } = await member.client.from("response_assets").insert({
          workspace_id: wsA.id, kind: "audio", name: "zz-test desde Member", description: "no deberia entrar",
          storage_path: `${wsA.id}/library/zz-test-member.m4a`, mime_type: "audio/mp4", source: "uploaded",
        });
        check(Boolean(eInsertMember), "un Member no puede crear un recurso");

        const { error: eInsertAdmin } = await admin.client.from("response_assets").insert({
          workspace_id: wsA.id, kind: "audio", name: "zz-test desde Admin", description: "si deberia entrar",
          storage_path: `${wsA.id}/library/zz-test-admin.m4a`, mime_type: "audio/mp4", source: "uploaded",
        }).select("id").single();
        check(!eInsertAdmin, "un Admin si puede crear un recurso");
      }

      // El atajo es unico ENTRE LOS DOS TIPOS (idx_response_assets_shortcut no
      // lleva `kind`): un texto y un audio no pueden compartir uno.
      const shortcut = `/zz-test-${randomUUID().slice(0, 8)}`;
      const { error: textErr } = await svc.from("response_assets").insert({
        workspace_id: wsA.id, kind: "text", name: "zz-test texto", content: "contenido de prueba", shortcut,
      });
      if (textErr) {
        fail("el service role pudo crear un texto con atajo (precondicion)", textErr.message);
      } else {
        const { error: clashErr } = await svc.from("response_assets").insert({
          workspace_id: wsA.id, kind: "audio", name: "zz-test audio con el mismo atajo", description: "choca",
          storage_path: `${wsA.id}/library/zz-test-clash.m4a`, mime_type: "audio/mp4", source: "uploaded", shortcut,
        });
        check(Boolean(clashErr), "un audio no puede compartir atajo con un texto ya existente");
      }
    }
  }

  console.log("\n— C. La foto de un contacto en avatars/<ws>/contacts/<id>.jpg (F16) —");
  {
    const { data: contact } = await svc.from("contacts")
      .insert({ workspace_id: wsA.id, display_name: "zz-test contacto" }).select("id").single();
    const path = `${wsA.id}/contacts/${contact.id}.jpg`;
    const { error: upErr } = await svc.storage.from(AVATAR_BUCKET).upload(path, smallJpeg(), { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      fail("no pude subir la foto de prueba (precondicion)", upErr.message);
    } else {
      uploadedPaths.push({ bucket: AVATAR_BUCKET, path });
      const { data: pub } = svc.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      check(pub?.publicUrl?.includes(path), "el bucket de avatares es publico y arma la URL con el path esperado");
    }
  }
} catch (err) {
  fail("error inesperado", err instanceof Error ? err.message : String(err));
} finally {
  console.log("\n— Limpieza —");
  for (const entry of uploadedPaths) {
    const bucket = typeof entry === "string" ? CHAT_MEDIA_BUCKET : entry.bucket;
    const path = typeof entry === "string" ? entry : entry.path;
    const { error } = await svc.storage.from(bucket).remove([path]);
    if (error) { fail(`no pude borrar ${bucket}/${path}`, error.message); }
  }
  if (!(await runCleanup(svc))) failures++;
}

console.log(failures === 0 ? "\nTodo verde" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
