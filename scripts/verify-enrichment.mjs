#!/usr/bin/env node
/**
 * Verificacion del enriquecimiento del perfil del contacto (migracion 00031).
 *
 * La regla que se prueba: el canal escribe donde hay un hueco o donde el valor
 * que hay es un placeholder de la plataforma ("Instagram User"), y NUNCA sobre
 * lo que escribio una persona.
 *
 * Lo que mas importa son los casos negativos: pisar un nombre que alguien
 * corrigio a mano es peor que dejar un contacto anonimo.
 *
 *   node scripts/verify-enrichment.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const stamp = Date.now();

const resolver = async (channelId, args) => {
  const { data, error } = await svc.rpc("find_or_link_contact", {
    p_channel_id: channelId,
    p_interaction_at: new Date().toISOString(),
    ...args,
  });
  if (error) throw new Error(`find_or_link_contact: ${error.message}`);
  return data;
};

const leer = async (id) => (await svc.from("contacts")
  .select("display_name, instagram_username, avatar_url").eq("id", id).single()).data;

try {
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-enrich", slug: `zz-test-enrich-${stamp}` }).select("id").single();

  const { data: ig } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "instagram", late_account_id: `zz-enrich-${stamp}`,
    username: "zzenrich", display_name: "zz ig", is_active: true,
  }).select("id").single();

  console.log("\n— La lista de placeholders vive en la base —");
  {
    for (const [nombre, esperado] of [
      ["Instagram User", true], ["instagram user", true], ["  INSTAGRAM USER ", true],
      ["", true], [null, true], ["Ana Gomez", false], ["Instagram Users SA", false],
    ]) {
      const { data } = await svc.rpc("is_placeholder_name", { p_name: nombre });
      check(data === esperado, `"${nombre}" → ${esperado ? "placeholder" : "nombre real"}`, `dio ${data}`);
    }
  }

  console.log("\n— Un lead que nunca respondio entra como anonimo —");
  let anonimo;
  {
    const r = await resolver(ig.id, { p_sender_id: `s-anon-${stamp}`, p_display_name: "Instagram User" });
    anonimo = r.contact_id;
    const c = await leer(anonimo);
    check(c.display_name === "Instagram User", "queda con el nombre que manda Instagram");
    check(c.instagram_username === null, "y sin usuario, porque Instagram no lo da");
  }

  console.log("\n— Cuando responde, el perfil aparece y se guarda —");
  {
    await resolver(ig.id, {
      p_sender_id: `s-anon-${stamp}`, p_display_name: "Ana Gomez",
      p_username: "@Ana.Gomez", p_avatar_url: "https://cdn/ana.jpg",
    });
    const c = await leer(anonimo);
    check(c.display_name === "Ana Gomez", "el placeholder se reemplaza por el nombre real", c.display_name);
    check(c.instagram_username === "ana.gomez", "el usuario se guarda normalizado", c.instagram_username);
    check(c.avatar_url === "https://cdn/ana.jpg", "y la foto tambien");

    const { data: link } = await svc.from("contact_channels")
      .select("platform_username").eq("channel_id", ig.id).eq("platform_sender_id", `s-anon-${stamp}`).single();
    check(link.platform_username === "ana.gomez", "el mapeo del canal tambien queda con el usuario");
  }

  console.log("\n— Lo que escribio una persona NO se pisa —");
  {
    await svc.from("contacts")
      .update({ display_name: "Ana (la del gimnasio)", avatar_url: "https://cdn/puesta-a-mano.jpg" })
      .eq("id", anonimo);

    await resolver(ig.id, {
      p_sender_id: `s-anon-${stamp}`, p_display_name: "Ana Gomez",
      p_username: "otro_usuario", p_avatar_url: "https://cdn/nueva.jpg",
    });

    const c = await leer(anonimo);
    check(c.display_name === "Ana (la del gimnasio)",
      "el nombre editado a mano sobrevive a los mensajes siguientes", c.display_name);
    check(c.instagram_username === "ana.gomez",
      "el usuario ya cargado no se reemplaza", c.instagram_username);
    check(c.avatar_url === "https://cdn/puesta-a-mano.jpg", "ni la foto", c.avatar_url);
  }

  console.log("\n— Un placeholder no reemplaza a otro placeholder —");
  {
    const r = await resolver(ig.id, { p_sender_id: `s-dos-${stamp}`, p_display_name: "Instagram User" });
    await resolver(ig.id, { p_sender_id: `s-dos-${stamp}`, p_display_name: "Facebook User" });
    const c = await leer(r.contact_id);
    check(c.display_name === "Instagram User", "se queda con el primero", c.display_name);
  }

  console.log("\n— El contacto encontrado por otro dato tambien se enriquece —");
  {
    // Un contacto cargado a mano, con telefono y sin nombre util.
    const { data: previo } = await svc.from("contacts").insert({
      workspace_id: ws.id, display_name: "Instagram User", phone: "+5491133344455",
    }).select("id").single();

    // Llega un mensaje de WhatsApp de ese mismo telefono, con nombre real.
    const { data: wa } = await svc.from("channels").insert({
      workspace_id: ws.id, platform: "whatsapp", late_account_id: `zz-enrich-wa-${stamp}`,
      display_name: "zz wa", is_active: true,
    }).select("id").single();

    const r = await resolver(wa.id, {
      p_sender_id: "+5491133344455", p_display_name: "Beto Real", p_phone: "+5491133344455",
    });
    check(r.contact_id === previo.id, "se vincula al contacto que ya existia", r.linked_by);
    const c = await leer(previo.id);
    check(c.display_name === "Beto Real",
      "y el placeholder tambien se reemplaza por esta via", c.display_name);
  }

  console.log("\n— Sellar la fecha sigue siendo opcional —");
  {
    const r = await resolver(ig.id, { p_sender_id: `s-sello-${stamp}`, p_display_name: "Carla" });
    const { data: antes } = await svc.from("contacts")
      .select("last_interaction_at").eq("id", r.contact_id).single();

    await resolver(ig.id, {
      p_sender_id: `s-sello-${stamp}`, p_display_name: "Carla",
      p_interaction_at: new Date(Date.now() + 60000).toISOString(), p_stamp_existing: false,
    });
    const { data: despues } = await svc.from("contacts")
      .select("last_interaction_at").eq("id", r.contact_id).single();
    check(antes.last_interaction_at === despues.last_interaction_at,
      "con p_stamp_existing=false la fecha no se toca (lo usa el backfill)");
  }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
