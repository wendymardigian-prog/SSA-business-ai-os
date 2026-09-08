#!/usr/bin/env node
/**
 * Verificacion de la marca automatica de "no contactar" (F18, migracion 00027).
 *
 * Prueba lo que vive en Postgres y no se puede probar con vitest: el matcheo
 * por palabra completa, la idempotencia y que la marca pause las secuencias y
 * deje su rastro en el audit log.
 *
 * Lo que mas importa de todo esto son los casos NEGATIVOS: que "trabaja" no
 * dispare "baja" y que "no me interesa" no dispare nada. Un falso positivo
 * apaga un lead vivo, que es peor que no detectar un opt-out.
 *
 * Crea un workspace con todo lo que necesita y lo borra al terminar.
 *
 *   node scripts/verify-optout.mjs
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

const matches = async (texto, frase) => {
  const { data, error } = await svc.rpc("text_matches_phrase", { p_text: texto, p_phrase: frase });
  if (error) throw new Error(`text_matches_phrase: ${error.message}`);
  return data;
};

const applyCheck = async (contactId, texto, conversationId = null) => {
  const { data, error } = await svc.rpc("apply_opt_out_check", {
    p_contact_id: contactId,
    p_conversation_id: conversationId,
    p_text: texto,
  });
  if (error) throw new Error(`apply_opt_out_check: ${error.message}`);
  return data;
};

try {
  const { data: workspace } = await svc.from("workspaces")
    .insert({ name: "zz-test-optout", slug: `zz-test-optout-${stamp}` })
    .select("id, opt_out_phrases").single();
  const ws = workspace.id;

  // Las inscripciones a secuencias exigen un canal, asi que el workspace de
  // prueba tiene uno.
  const { data: canal, error: canalError } = await svc.from("channels").insert({
    workspace_id: ws, platform: "whatsapp", late_account_id: `zz-optout-${stamp}`,
    display_name: "zz canal", is_active: true,
  }).select("id").single();
  if (canalError) throw new Error(`no pude crear el canal: ${canalError.message}`);

  const nuevoContacto = async (nombre) => {
    const { data, error } = await svc.from("contacts")
      .insert({ workspace_id: ws, display_name: nombre }).select("id").single();
    if (error) throw new Error(`no pude crear el contacto: ${error.message}`);
    return data.id;
  };

  const inscribir = async (sequenceId, contactId, status) => {
    const { error } = await svc.from("sequence_enrollments")
      .insert({ sequence_id: sequenceId, contact_id: contactId, channel_id: canal.id, status });
    if (error) throw new Error(`no pude inscribir el contacto: ${error.message}`);
  };

  console.log("\n— La lista por defecto llega sola —");
  {
    const frases = workspace.opt_out_phrases;
    check(Array.isArray(frases) && frases.length > 0,
      "un workspace nuevo ya trae frases configuradas", JSON.stringify(frases));
    check(frases.includes("stop") && frases.includes("no me contactes"),
      "incluye las del requerimiento");
    check(!frases.includes("baja"),
      "y NO incluye 'baja' sola, que es demasiado corta para ser segura");
  }

  console.log("\n— Matcheo: lo que TIENE que disparar —");
  {
    check(await matches("no me contactes mas por favor", "no me contactes"),
      "la frase adentro de una oracion mas larga");
    check(await matches("NO ME CONTACTES", "no me contactes"),
      "en mayusculas");
    check(await matches("no me escribas mas!!!", "no me escribas mas"),
      "con signos de puntuacion pegados");
    check(await matches("no me escribás más", "no me escribas mas"),
      "con tildes de un lado y sin tildes del otro");
    check(await matches("stop", "stop"),
      "la palabra sola");
    check(await matches("Stop, por favor.", "stop"),
      "la palabra sola con puntuacion");
    check(await matches("quiero  darme   de  baja", "darme de baja"),
      "con espacios de mas en el medio");
  }

  console.log("\n— Matcheo: lo que NO tiene que disparar —");
  {
    check(!(await matches("trabaja con ustedes hace anios", "baja")),
      "'baja' NO matchea adentro de 'trabaja'");
    check(!(await matches("me hacen una rebaja?", "baja")),
      "ni adentro de 'rebaja'");
    check(!(await matches("nosotros somos dos", "no")),
      "'no' NO matchea adentro de 'nosotros'");
    check(!(await matches("stopper de puerta", "stop")),
      "'stop' NO matchea adentro de 'stopper'");
    check(!(await matches("no me contestes", "no me contactes")),
      "una frase parecida pero distinta no alcanza");
    check(!(await matches("", "stop")), "un texto vacio no matchea");
    check(!(await matches("hola", "")), "una frase vacia no matchea");
  }

  console.log("\n— Un mensaje normal no marca nada —");
  {
    const contacto = await nuevoContacto("Lead interesado");
    const r = await applyCheck(contacto, "hola! cuanto sale el servicio?");
    check(r.matched === false, "no matchea", JSON.stringify(r));

    const { data: c } = await svc.from("contacts")
      .select("do_not_contact, do_not_contact_reason").eq("id", contacto).single();
    check(c.do_not_contact === false && c.do_not_contact_reason === null,
      "y el contacto queda intacto");
  }

  console.log("\n— Un opt-out marca, pausa y audita —");
  {
    const contacto = await nuevoContacto("Lead que se va");

    const { data: seq } = await svc.from("sequences")
      .insert({ workspace_id: ws, name: "zz secuencia", status: "active" }).select("id").single();
    const { data: otraSeq } = await svc.from("sequences")
      .insert({ workspace_id: ws, name: "zz secuencia vieja", status: "active" }).select("id").single();

    await inscribir(seq.id, contacto, "active");
    await inscribir(otraSeq.id, contacto, "completed");

    const r = await applyCheck(contacto, "che, no me escribas mas");
    check(r.matched === true, "matchea", JSON.stringify(r));
    check(r.phrase === "no me escribas mas", `identifica la frase (dio ${r.phrase})`);
    check(r.sequences_paused === 1, `pausa 1 inscripcion (dio ${r.sequences_paused})`);

    const { data: c } = await svc.from("contacts")
      .select("do_not_contact, do_not_contact_reason, do_not_contact_at, is_subscribed")
      .eq("id", contacto).single();
    check(c.do_not_contact === true, "el contacto queda marcado");
    check(c.do_not_contact_reason === "auto: no me escribas mas",
      "con la razon que dice que fue automatica y cual fue la frase", c.do_not_contact_reason);
    check(!!c.do_not_contact_at, "y con la fecha");
    check(c.is_subscribed === false, "y desuscripto");

    const { data: enrollments } = await svc.from("sequence_enrollments")
      .select("status").eq("contact_id", contacto).order("status");
    check(enrollments.map((e) => e.status).join(",") === "completed,paused",
      "la activa queda pausada y la completada no se toca",
      enrollments.map((e) => e.status).join(","));

    const { data: audit } = await svc.from("audit_log")
      .select("action, entity_type, metadata, performed_by").eq("entity_id", contacto);
    check(audit?.length === 1, `queda 1 entrada en el audit log (dio ${audit?.length})`);
    check(audit?.[0]?.action === "do_not_contact" && audit?.[0]?.entity_type === "contact",
      "con la accion correcta");
    check(audit?.[0]?.performed_by === null,
      "sin autor, porque lo hizo el sistema y no una persona");
    check(audit?.[0]?.metadata?.phrase === "no me escribas mas" &&
      audit?.[0]?.metadata?.source === "auto",
      "y con la frase que lo disparo en el metadata", JSON.stringify(audit?.[0]?.metadata));
  }

  console.log("\n— El segundo mensaje del mismo lead no vuelve a escribir —");
  {
    const contacto = await nuevoContacto("Lead insistente");
    await applyCheck(contacto, "basta");
    const segunda = await applyCheck(contacto, "no me contactes");

    check(segunda.matched === false && segunda.already === true,
      "avisa que ya estaba marcado", JSON.stringify(segunda));

    const { data: c } = await svc.from("contacts")
      .select("do_not_contact_reason").eq("id", contacto).single();
    check(c.do_not_contact_reason === "auto: basta",
      "y no pisa la razon original", c.do_not_contact_reason);

    const { data: audit } = await svc.from("audit_log").select("id").eq("entity_id", contacto);
    check(audit?.length === 1,
      `el audit log sigue con 1 sola entrada (dio ${audit?.length})`);
  }

  console.log("\n— Las frases son del workspace —");
  {
    await svc.from("workspaces")
      .update({ opt_out_phrases: ["chau para siempre"] }).eq("id", ws);

    const contacto = await nuevoContacto("Lead con frase propia");
    const conFraseVieja = await applyCheck(contacto, "stop");
    check(conFraseVieja.matched === false,
      "una frase que se saco de la lista deja de disparar", JSON.stringify(conFraseVieja));

    const conFraseNueva = await applyCheck(contacto, "chau para siempre entonces");
    check(conFraseNueva.matched === true,
      "y una frase agregada dispara", JSON.stringify(conFraseNueva));
  }

  console.log("\n— Entradas invalidas —");
  {
    const contacto = await nuevoContacto("Lead mudo");
    const vacio = await applyCheck(contacto, "");
    check(vacio.matched === false, "un mensaje vacio no rompe ni marca");

    const nulo = await applyCheck(contacto, null);
    check(nulo.matched === false, "un texto nulo tampoco");

    const inexistente = await applyCheck("00000000-0000-0000-0000-000000000000", "stop");
    check(inexistente.matched === false, "un contacto que no existe se ignora sin error");
  }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  await runCleanup(svc);
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
