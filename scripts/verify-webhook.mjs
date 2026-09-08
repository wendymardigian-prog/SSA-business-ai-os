#!/usr/bin/env node
/**
 * Verificacion del receptor de webhooks (Edge Function channel-webhook).
 *
 * Le manda payloads reales de Evolution API y de Zernio y comprueba que lo que
 * queda en la base es lo correcto: contacto, conversacion, mensaje, estado de
 * conexion, idempotencia y rechazo de lo que no esta firmado.
 *
 * No necesita ni Evolution ni Zernio corriendo: prueba nuestro lado.
 * Crea todo lo que usa y lo borra al terminar.
 *
 *   node scripts/verify-webhook.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const HOOK = `${SUPA}/functions/v1/channel-webhook`;
const TOKEN = env.EVOLUTION_WEBHOOK_TOKEN;
const svc = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

if (!TOKEN) {
  console.error("Falta EVOLUTION_WEBHOOK_TOKEN en .env");
  process.exit(1);
}

let failures = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const post = (route, body, headers = {}) =>
  fetch(`${HOOK}/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const evo = (body) => post("evolution", body, { "x-webhook-token": TOKEN });
const zernio = (body, secret) => {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  return fetch(`${HOOK}/zernio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-late-signature": sig },
    body: raw,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
};

const stamp = Date.now();
const cleanup = { workspaces: [], events: [] };

try {
  const SECRET = "secreto-de-prueba-para-hmac";
  const { data: ws } = await svc.from("workspaces")
    .insert({ name: "zz-test-webhook", slug: `zz-test-webhook-${stamp}`, webhook_secret: SECRET })
    .select("id").single();
  cleanup.workspaces.push(ws.id);

  const INSTANCE = `zz-test-instance-${stamp}`;
  const { data: waChannel } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "whatsapp", provider: "evolution",
    late_account_id: `evolution:${INSTANCE}`, evolution_instance: INSTANCE,
    display_name: "WhatsApp de prueba", is_active: true,
  }).select("id").single();

  const IG_ACCOUNT = `zz-test-ig-${stamp}`;
  const { data: igChannel } = await svc.from("channels").insert({
    workspace_id: ws.id, platform: "instagram", provider: "zernio",
    late_account_id: IG_ACCOUNT, username: "mi_cuenta", display_name: "IG de prueba",
    is_active: true,
  }).select("id").single();

  const evoMessage = (over = {}) => ({
    event: "messages.upsert",
    instance: INSTANCE,
    data: {
      key: { remoteJid: "5491122334455@s.whatsapp.net", fromMe: false, id: `MSG-${stamp}` },
      pushName: "Juan Lead",
      message: { conversation: "hola, quiero info" },
      messageType: "conversation",
      messageTimestamp: Math.floor(stamp / 1000),
      ...over,
    },
  });

  /**
   * La conversacion del lead principal de WhatsApp. Antes alcanzaba con filtrar
   * por canal, pero los casos de opt-out sumaron dos contactos mas al mismo
   * canal y un .single() por canal ya no encuentra una sola fila.
   */
  const convDelLead = async (channelId, senderId, columns) => {
    const link = await contactoDe(channelId, senderId);
    const { data } = await svc.from("conversations").select(columns)
      .eq("channel_id", channelId).eq("contact_id", link.contact_id).maybeSingle();
    return data;
  };

  const contactoDe = async (channelId, senderId) => {
    const { data } = await svc.from("contact_channels")
      .select("contact_id, platform_username, contacts(display_name)")
      .eq("channel_id", channelId).eq("platform_sender_id", senderId).maybeSingle();
    return data;
  };

  console.log("\n— WhatsApp: mensaje entrante —");
  {
    const r = await evo(evoMessage());
    check(r.status === 200 && r.body?.ok, "el webhook acepta el mensaje", JSON.stringify(r.body));

    const link = await contactoDe(waChannel.id, "+5491122334455");
    check(!!link, "se creo el contacto con el telefono normalizado como +digitos");
    check(link?.contacts?.display_name === "Juan Lead", "y con el nombre que manda WhatsApp");

    const conv = await convDelLead(waChannel.id, "+5491122334455",
      "id, unread_count, last_message_preview, platform");
    check(!!conv, "se creo la conversacion");
    check(conv?.unread_count === 1, `queda 1 mensaje sin leer (dio ${conv?.unread_count})`);
    check(conv?.last_message_preview === "hola, quiero info", "el preview es el texto del mensaje");

    const { data: msgs } = await svc.from("messages").select("id, direction, text")
      .eq("conversation_id", conv.id);
    check(msgs?.length === 1, `se guardo 1 mensaje (dio ${msgs?.length})`);
    check(msgs?.[0]?.direction === "inbound" && msgs?.[0]?.text === "hola, quiero info",
      "guardado como entrante y con el texto correcto");
  }

  console.log("\n— WhatsApp: el mismo mensaje otra vez (Evolution reintenta) —");
  {
    const r = await evo(evoMessage());
    check(r.body?.skipped === "evento repetido", "lo ignora por idempotencia", JSON.stringify(r.body));
    const conv = await convDelLead(waChannel.id, "+5491122334455", "id, unread_count");
    const { data: msgs } = await svc.from("messages").select("id").eq("conversation_id", conv.id);
    check(msgs?.length === 1, "no se duplico el mensaje");
    check(conv.unread_count === 1, "ni se volvio a sumar el no leido");
  }

  console.log("\n— WhatsApp: el lead pide que no le escriban mas (F18) —");
  {
    const r = await evo(evoMessage({
      key: { remoteJid: "5491199887766@s.whatsapp.net", fromMe: false, id: `OPTOUT-${stamp}` },
      pushName: "Lead que se va",
      message: { conversation: "gracias pero no me escribas mas por favor" },
    }));
    check(r.status === 200, "el mensaje se acepta igual", JSON.stringify(r.body));

    const link = await contactoDe(waChannel.id, "+5491199887766");
    const { data: c } = await svc.from("contacts")
      .select("do_not_contact, do_not_contact_reason").eq("id", link.contact_id).single();
    check(c.do_not_contact === true, "el contacto queda marcado como no contactar");
    check(c.do_not_contact_reason === "auto: no me escribas mas",
      "con la frase que lo disparo", c.do_not_contact_reason);

    const { data: conv } = await svc.from("conversations")
      .select("id").eq("channel_id", waChannel.id).eq("contact_id", link.contact_id).single();
    const { data: msgs } = await svc.from("messages").select("text").eq("conversation_id", conv.id);
    check(msgs?.length === 1,
      "y el mensaje igual queda en el hilo: es la prueba de por que quedo marcado");
  }

  console.log("\n— WhatsApp: 'trabaja' no dispara la marca —");
  {
    const r = await evo(evoMessage({
      key: { remoteJid: "5491155443322@s.whatsapp.net", fromMe: false, id: `NOOPT-${stamp}` },
      pushName: "Lead interesado",
      message: { conversation: "hola! mi hermana trabaja con ustedes, me pasan precios?" },
    }));
    check(r.status === 200, "se acepta", JSON.stringify(r.body));

    const link = await contactoDe(waChannel.id, "+5491155443322");
    const { data: c } = await svc.from("contacts")
      .select("do_not_contact").eq("id", link.contact_id).single();
    check(c.do_not_contact === false,
      "el lead NO queda marcado: 'baja' adentro de 'trabaja' no es un opt-out");
  }

  console.log("\n— WhatsApp: mensaje de grupo —");
  {
    const r = await evo(evoMessage({
      key: { remoteJid: "120363001122334455@g.us", fromMe: false, id: `GRP-${stamp}` },
    }));
    check(r.body?.skipped === "sin telefono utilizable",
      "un grupo se ignora: no hay un lead con telefono detras", JSON.stringify(r.body));
    const { data } = await svc.from("contact_channels").select("platform_sender_id")
      .eq("channel_id", waChannel.id);
    check(!data?.some((c) => c.platform_sender_id.includes("g.us")),
      "no se creo un contacto para el grupo",
      data?.map((c) => c.platform_sender_id).join(", "));
  }

  console.log("\n— WhatsApp: respuesta mandada desde el celular —");
  {
    const r = await evo(evoMessage({
      key: { remoteJid: "5491122334455@s.whatsapp.net", fromMe: true, id: `OUT-${stamp}` },
      message: { conversation: "ya te paso info" },
    }));
    check(r.status === 200, "se acepta", JSON.stringify(r.body));
    const conv = await convDelLead(waChannel.id, "+5491122334455", "id, unread_count");
    const { data: msgs } = await svc.from("messages").select("direction, text")
      .eq("conversation_id", conv.id).order("created_at");
    check(msgs?.length === 2, `el hilo tiene los dos mensajes (dio ${msgs?.length})`);
    check(msgs?.[1]?.direction === "outbound", "el que salio del celular queda como saliente");
    check(conv.unread_count === 1, "y no suma no leidos");
  }

  console.log("\n— WhatsApp: estado de la conexion —");
  {
    await evo({ event: "connection.update", instance: INSTANCE, data: { state: "open" } });
    let { data: ch } = await svc.from("channels")
      .select("connection_status, last_connected_at, last_error").eq("id", waChannel.id).single();
    check(ch.connection_status === "connected" && !!ch.last_connected_at,
      "state=open deja el canal conectado");

    await evo({ event: "connection.update", instance: INSTANCE, data: { state: "close", statusReason: 401 } });
    ({ data: ch } = await svc.from("channels")
      .select("connection_status, last_error").eq("id", waChannel.id).single());
    check(ch.connection_status === "disconnected", "state=close lo marca desconectado");
    check(/escanear el QR/.test(ch.last_error ?? ""),
      "y con un motivo entendible cuando cerraron sesion desde el telefono", ch.last_error);
  }

  console.log("\n— WhatsApp: instancia de otro sistema en el mismo Evolution —");
  {
    const r = await evo({ event: "messages.upsert", instance: "crm-de-otro-producto", data: {} });
    check(r.status === 200 && r.body?.skipped === "instancia desconocida",
      "se ignora sin tocar nada", JSON.stringify(r.body));
  }

  console.log("\n— Instagram: DM entrante firmado —");
  {
    const payload = {
      id: `ZEV-${stamp}`,
      event: "message.received",
      message: {
        id: `IGM-${stamp}`, direction: "inbound", text: "hola! vi tu reel",
        sender: { id: `ig-sender-${stamp}`, name: "Ana Lead", username: "ana.lead", picture: null },
        sentAt: new Date().toISOString(),
      },
      conversation: { id: `IGC-${stamp}` },
      account: { id: IG_ACCOUNT },
    };
    cleanup.events.push(payload.id);
    const r = await zernio(payload, SECRET);
    check(r.status === 200 && r.body?.ok, "se acepta con firma valida", JSON.stringify(r.body));

    const link = await contactoDe(igChannel.id, `ig-sender-${stamp}`);
    check(!!link, "se creo el contacto de Instagram");
    check(link?.platform_username === "ana.lead", "vinculado por su username de Instagram");

    const { data: conv } = await svc.from("conversations")
      .select("id, unread_count, late_conversation_id").eq("channel_id", igChannel.id).maybeSingle();
    check(!!conv, "se creo la conversacion");
    check(conv?.late_conversation_id === `IGC-${stamp}`,
      "guardando el id de conversacion de Zernio, que es como la app pide el hilo");

    const { data: msgs } = await svc.from("messages").select("id").eq("conversation_id", conv.id);
    check(msgs?.length === 0,
      "el mensaje NO se guarda local: para Instagram la fuente de verdad es Zernio");
  }

  console.log("\n— Instagram: firma invalida —");
  {
    const payload = {
      id: `ZEV-BAD-${stamp}`, event: "message.received",
      message: { id: "x", direction: "inbound", text: "inyectado",
        sender: { id: "atacante", name: "Atacante", username: null, picture: null } },
      conversation: { id: "x" }, account: { id: IG_ACCOUNT },
    };
    const r = await zernio(payload, "secreto-equivocado");
    check(r.status === 401, `se rechaza con 401 (dio ${r.status})`, JSON.stringify(r.body));
    const link = await contactoDe(igChannel.id, "atacante");
    check(!link, "y no se escribio nada en la base");
  }

  console.log("\n— Instagram: mensaje saliente propio —");
  {
    const payload = {
      id: `ZEV-OUT-${stamp}`, event: "message.received",
      message: { id: "y", direction: "outbound", text: "respuesta nuestra",
        sender: { id: "nosotros", name: "Nosotros", username: null, picture: null } },
      conversation: { id: "y" }, account: { id: IG_ACCOUNT },
    };
    const r = await zernio(payload, SECRET);
    check(r.body?.skipped === "mensaje saliente",
      "se ignora para no entrar en bucle", JSON.stringify(r.body));
  }

  console.log("\n— Instagram: comentario —");
  {
    const payload = {
      id: `ZEC-${stamp}`, event: "comment.received",
      comment: {
        id: `CMT-${stamp}`, postId: "post-1", platformPostId: "ig-post-1",
        text: "cuanto sale?", author: { id: "a1", username: "curioso", name: "Curioso" },
      },
      account: { id: IG_ACCOUNT },
    };
    cleanup.events.push(payload.id);
    const r = await zernio(payload, SECRET);
    check(r.status === 200 && r.body?.ok, "se acepta", JSON.stringify(r.body));

    const { data: log } = await svc.from("comment_logs")
      .select("comment_text, author_username").eq("channel_id", igChannel.id).maybeSingle();
    check(log?.comment_text === "cuanto sale?", "queda registrado en comment_logs");
    check(log?.author_username === "curioso", "con el autor");
  }

  console.log("\n— Instagram: comentario propio —");
  {
    const payload = {
      id: `ZEC-OWN-${stamp}`, event: "comment.received",
      comment: { id: "c2", postId: "post-1", platformPostId: "ig-post-1", text: "gracias!",
        author: { id: "a2", username: "mi_cuenta", name: "Yo" } },
      account: { id: IG_ACCOUNT },
    };
    const r = await zernio(payload, SECRET);
    check(r.body?.skipped === "comentario propio",
      "nuestra propia respuesta no vuelve a entrar", JSON.stringify(r.body));
  }
} catch (err) {
  fail(`error inesperado: ${err.message}`);
} finally {
  console.log("\n— Limpieza —");
  for (const id of cleanup.workspaces) await svc.from("workspaces").delete().eq("id", id);
  for (const id of cleanup.events) await svc.from("webhook_events").delete().eq("event_id", id);
  await svc.from("webhook_events").delete().like("event_id", `%${stamp}%`);
  console.log("  datos de prueba borrados");
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
