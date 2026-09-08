#!/usr/bin/env node
/**
 * Verificacion de los receptores de webhooks de la app.
 *
 * Les manda payloads reales de Evolution API y de Zernio a
 * /api/webhooks/evolution y /api/webhooks/late, y comprueba que lo que queda en
 * la base es lo correcto: contacto, conversacion, mensaje, estado de conexion,
 * idempotencia y rechazo de lo que no esta firmado.
 *
 * No necesita ni Evolution ni Zernio corriendo: prueba nuestro lado.
 * Crea todo lo que usa y lo borra al terminar.
 *
 *   node scripts/verify-webhook.mjs                  (contra localhost:3000)
 *   node scripts/verify-webhook.mjs --target=prod    (contra NEXT_PUBLIC_APP_URL)
 *   node scripts/verify-webhook.mjs --target=https://otra.url
 *
 * Nota sobre los tiempos: la app responde 200 y procesa despues (`after()`),
 * asi que las comprobaciones contra la base se reintentan hasta que el efecto
 * aparece. Es a proposito: los proveedores cortan la entrega a los pocos
 * segundos y el ack tiene que salir primero.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const SUPA = env.NEXT_PUBLIC_SUPABASE_URL;
const TOKEN = env.EVOLUTION_WEBHOOK_TOKEN;
const svc = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const targetArg = process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);
const APP = (
  targetArg === "prod"
    ? env.NEXT_PUBLIC_APP_URL
    : targetArg && targetArg !== "local"
      ? targetArg
      : "http://localhost:3000"
)?.replace(/\/$/, "");

const esLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(url ?? "");

if (!TOKEN) {
  console.error("Falta EVOLUTION_WEBHOOK_TOKEN en .env");
  process.exit(1);
}
if (!APP) {
  console.error("No se pudo resolver la URL de la app (revisa NEXT_PUBLIC_APP_URL)");
  process.exit(1);
}

// --target=prod sale del .env local, donde NEXT_PUBLIC_APP_URL suele ser
// localhost. Sin este corte, "verificar produccion" prueba tu maquina y da todo
// verde: es exactamente la clase de error silencioso que este script existe
// para atrapar.
if (targetArg === "prod" && esLocal(APP)) {
  console.error(
    `--target=prod resolvio "${APP}", que es local.\n` +
    "Tu .env apunta a localhost. Pasa la URL publica a mano:\n" +
    "  node scripts/verify-webhook.mjs --target=https://tu-app.up.railway.app"
  );
  process.exit(1);
}

console.log(`Receptor bajo prueba: ${APP}${esLocal(APP) ? "  (local)" : "  (remoto)"}\n`);

let failures = 0;
let omitidos = 0;
const ok = (m) => console.log("  ok  ", m);
const fail = (m, extra) => { console.error("  FALLA", m, extra ? `\n        ${extra}` : ""); failures++; };
const check = (cond, m, extra) => (cond ? ok(m) : fail(m, extra));

const post = (path, raw, headers = {}) =>
  fetch(`${APP}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

const evo = (body, headers = {}) =>
  post("/api/webhooks/evolution", JSON.stringify(body), {
    "x-webhook-token": TOKEN,
    ...headers,
  });

const zernio = (body, secret) => {
  const raw = JSON.stringify(body);
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  return post("/api/webhooks/late", raw, { "x-late-signature": sig });
};

/**
 * Reintenta una comprobacion hasta que da true o se acaba el tiempo.
 *
 * La app contesta antes de procesar, asi que mirar la base en el instante
 * siguiente al 200 es una carrera. Devuelve el ultimo valor leido para poder
 * mostrarlo cuando falla.
 */
async function waitFor(read, isReady, { timeoutMs = 15000, everyMs = 300 } = {}) {
  const until = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await read();
    if (isReady(last)) return last;
    if (Date.now() > until) return last;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/**
 * Un entorno sin EVOLUTION_WEBHOOK_TOKEN no puede recibir WhatsApp, y eso no es
 * una falla del receptor: es que el canal no esta configurado ahi. Se detecta
 * una vez y las comprobaciones de WhatsApp se omiten con un aviso, en vez de
 * ensuciar el resultado con rojos que no dicen nada.
 */
async function whatsappConfigurado() {
  const r = await post("/api/webhooks/evolution", "{}", { "x-webhook-token": TOKEN });
  return !(r.status === 500 && /no configurado/i.test(r.body?.error ?? ""));
}

const stamp = Date.now();
const cleanup = { workspaces: [], events: [] };

const CON_WHATSAPP = await whatsappConfigurado();
if (!CON_WHATSAPP) {
  console.log(
    "AVISO: este entorno no tiene EVOLUTION_WEBHOOK_TOKEN, asi que no puede recibir\n" +
    "       WhatsApp. Se omiten esas comprobaciones y se corren solo las de Instagram.\n"
  );
}

/** Corre un bloque solo si el canal de WhatsApp esta configurado en este entorno. */
const siWhatsApp = async (titulo, fn) => {
  if (!CON_WHATSAPP) {
    console.log(`\n— ${titulo} —\n  omitido  WhatsApp no esta configurado en este entorno`);
    omitidos++;
    return;
  }
  console.log(`\n— ${titulo} —`);
  await fn();
};

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
    if (!link) return null;
    return waitFor(
      async () => {
        const { data } = await svc.from("conversations").select(columns)
          .eq("channel_id", channelId).eq("contact_id", link.contact_id).maybeSingle();
        return data;
      },
      (d) => !!d,
    );
  };

  const contactoDe = (channelId, senderId) =>
    waitFor(
      async () => {
        const { data } = await svc.from("contact_channels")
          .select("contact_id, platform_username, contacts(display_name)")
          .eq("channel_id", channelId).eq("platform_sender_id", senderId).maybeSingle();
        return data;
      },
      (d) => !!d,
    );

  /** Los mensajes de una conversacion, esperando a que lleguen los que se esperan. */
  const mensajesDe = (conversationId, columns, esperados) =>
    waitFor(
      async () => {
        const { data } = await svc.from("messages").select(columns)
          .eq("conversation_id", conversationId).order("created_at");
        return data ?? [];
      },
      (rows) => rows.length >= esperados,
    );

  /**
   * Para los casos en que NO tiene que pasar nada: se espera un momento fijo
   * antes de mirar, porque no hay un efecto que esperar y hay que darle a la app
   * la oportunidad de equivocarse.
   */
  const nadaQueEsperar = () => new Promise((r) => setTimeout(r, 1500));

  /** Un contacto que NO deberia existir: no se espera, se confirma la ausencia. */
  const contactoAusente = async (channelId, senderId) => {
    const { data } = await svc.from("contact_channels").select("contact_id")
      .eq("channel_id", channelId).eq("platform_sender_id", senderId).maybeSingle();
    return data;
  };

  await siWhatsApp("WhatsApp: mensaje entrante", async () => {
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

    const msgs = await mensajesDe(conv.id, "id, direction, text", 1);
    check(msgs?.length === 1, `se guardo 1 mensaje (dio ${msgs?.length})`);
    check(msgs?.[0]?.direction === "inbound" && msgs?.[0]?.text === "hola, quiero info",
      "guardado como entrante y con el texto correcto");
  });

  await siWhatsApp("WhatsApp: el mismo mensaje otra vez (Evolution reintenta)", async () => {
    const r = await evo(evoMessage());
    check(r.body?.skipped === "evento repetido", "lo ignora por idempotencia", JSON.stringify(r.body));
    await nadaQueEsperar();
    const conv = await convDelLead(waChannel.id, "+5491122334455", "id, unread_count");
    const { data: msgs } = await svc.from("messages").select("id").eq("conversation_id", conv.id);
    check(msgs?.length === 1, "no se duplico el mensaje");
    check(conv.unread_count === 1, "ni se volvio a sumar el no leido");
  });

  await siWhatsApp("WhatsApp: el lead pide que no le escriban mas (F18)", async () => {
    const r = await evo(evoMessage({
      key: { remoteJid: "5491199887766@s.whatsapp.net", fromMe: false, id: `OPTOUT-${stamp}` },
      pushName: "Lead que se va",
      message: { conversation: "gracias pero no me escribas mas por favor" },
    }));
    check(r.status === 200, "el mensaje se acepta igual", JSON.stringify(r.body));

    const link = await contactoDe(waChannel.id, "+5491199887766");
    const c = await waitFor(
      async () => {
        const { data } = await svc.from("contacts")
          .select("do_not_contact, do_not_contact_reason").eq("id", link.contact_id).single();
        return data;
      },
      (d) => d?.do_not_contact === true,
    );
    check(c.do_not_contact === true, "el contacto queda marcado como no contactar");
    check(c.do_not_contact_reason === "auto: no me escribas mas",
      "con la frase que lo disparo", c.do_not_contact_reason);

    const { data: conv } = await svc.from("conversations")
      .select("id").eq("channel_id", waChannel.id).eq("contact_id", link.contact_id).single();
    const msgs = await mensajesDe(conv.id, "text", 1);
    check(msgs?.length === 1,
      "y el mensaje igual queda en el hilo: es la prueba de por que quedo marcado");
  });

  await siWhatsApp("WhatsApp: 'trabaja' no dispara la marca", async () => {
    const r = await evo(evoMessage({
      key: { remoteJid: "5491155443322@s.whatsapp.net", fromMe: false, id: `NOOPT-${stamp}` },
      pushName: "Lead interesado",
      message: { conversation: "hola! mi hermana trabaja con ustedes, me pasan precios?" },
    }));
    check(r.status === 200, "se acepta", JSON.stringify(r.body));

    const link = await contactoDe(waChannel.id, "+5491155443322");
    await nadaQueEsperar();
    const { data: c } = await svc.from("contacts")
      .select("do_not_contact").eq("id", link.contact_id).single();
    check(c.do_not_contact === false,
      "el lead NO queda marcado: 'baja' adentro de 'trabaja' no es un opt-out");
  });

  await siWhatsApp("WhatsApp: mensaje de grupo", async () => {
    const r = await evo(evoMessage({
      key: { remoteJid: "120363001122334455@g.us", fromMe: false, id: `GRP-${stamp}` },
    }));
    check(r.body?.skipped === "sin telefono utilizable",
      "un grupo se ignora: no hay un lead con telefono detras", JSON.stringify(r.body));
    await nadaQueEsperar();
    const { data } = await svc.from("contact_channels").select("platform_sender_id")
      .eq("channel_id", waChannel.id);
    check(!data?.some((c) => c.platform_sender_id.includes("g.us")),
      "no se creo un contacto para el grupo",
      data?.map((c) => c.platform_sender_id).join(", "));
  });

  await siWhatsApp("WhatsApp: respuesta mandada desde el celular", async () => {
    const r = await evo(evoMessage({
      key: { remoteJid: "5491122334455@s.whatsapp.net", fromMe: true, id: `OUT-${stamp}` },
      message: { conversation: "ya te paso info" },
    }));
    check(r.status === 200, "se acepta", JSON.stringify(r.body));
    const conv = await convDelLead(waChannel.id, "+5491122334455", "id, unread_count");
    const msgs = await mensajesDe(conv.id, "direction, text", 2);
    check(msgs?.length === 2, `el hilo tiene los dos mensajes (dio ${msgs?.length})`);
    check(msgs?.[1]?.direction === "outbound", "el que salio del celular queda como saliente");
    check(conv.unread_count === 1, "y no suma no leidos");
  });

  await siWhatsApp("WhatsApp: estado de la conexion", async () => {
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
  });

  await siWhatsApp("WhatsApp: instancia de otro sistema en el mismo Evolution", async () => {
    const r = await evo({ event: "messages.upsert", instance: "crm-de-otro-producto", data: {} });
    check(r.status === 200 && r.body?.skipped === "instancia desconocida",
      "se ignora sin tocar nada", JSON.stringify(r.body));
  });

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

    const conv = await waitFor(
      async () => {
        const { data } = await svc.from("conversations")
          .select("id, unread_count, late_conversation_id")
          .eq("channel_id", igChannel.id).maybeSingle();
        return data;
      },
      (d) => !!d,
    );
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
    await nadaQueEsperar();
    check(!(await contactoAusente(igChannel.id, "atacante")),
      "y no se escribio nada en la base");
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

    const log = await waitFor(
      async () => {
        const { data } = await svc.from("comment_logs")
          .select("comment_text, author_username").eq("channel_id", igChannel.id).maybeSingle();
        return data;
      },
      (d) => !!d,
    );
    check(log?.comment_text === "cuanto sale?", "queda registrado en comment_logs");
    check(log?.author_username === "curioso", "con el autor");
  }

  await siWhatsApp("WhatsApp: token del webhook", async () => {
    // Esta URL es publica: el token es lo unico que separa un evento real de
    // cualquiera que la descubra.
    const raw = JSON.stringify(evoMessage({
      key: { remoteJid: "5491100000000@s.whatsapp.net", fromMe: false, id: `TOK-${stamp}` },
    }));

    const sinToken = await post("/api/webhooks/evolution", raw);
    check(sinToken.status === 401, `sin token se rechaza con 401 (dio ${sinToken.status})`);

    const malToken = await post("/api/webhooks/evolution", raw, {
      "x-webhook-token": "token-equivocado",
    });
    check(malToken.status === 401, `con un token equivocado tambien (dio ${malToken.status})`);

    await nadaQueEsperar();
    check(!(await contactoAusente(waChannel.id, "+5491100000000")),
      "y no se escribio nada en la base");
  });

  console.log("\n— Zernio sin secreto configurado —");
  {
    // Sin secreto no se puede verificar la firma. Antes se aceptaba igual.
    const { data: wsSinSecreto } = await svc.from("workspaces")
      .insert({ name: "zz-test-sin-secreto", slug: `zz-test-sin-secreto-${stamp}` })
      .select("id").single();
    cleanup.workspaces.push(wsSinSecreto.id);

    const cuenta = `zz-test-ig-nosec-${stamp}`;
    await svc.from("channels").insert({
      workspace_id: wsSinSecreto.id, platform: "instagram", provider: "zernio",
      late_account_id: cuenta, username: "sin_secreto", is_active: true,
    });

    const r = await zernio({
      id: `ZEV-NOSEC-${stamp}`, event: "message.received",
      message: { id: "z", direction: "inbound", text: "sin firma verificable",
        sender: { id: "quien-sea", name: "Quien sea", username: null, picture: null } },
      conversation: { id: "z" }, account: { id: cuenta },
    }, "cualquier-secreto");

    check(r.status === 401,
      `un workspace sin webhook_secret rechaza el evento (dio ${r.status})`,
      JSON.stringify(r.body));
  }

  console.log("\n— Un DM entrante evalua automatizaciones —");
  {
    // Es la razon del cambio de receptor: la Edge Function guardaba el mensaje
    // pero no podia disparar ningun flow.
    const { data: flow } = await svc.from("flows").insert({
      workspace_id: ws.id, name: "zz-test-flow", status: "published",
      nodes: [], edges: [],
    }).select("id").single();

    await svc.from("triggers").insert({
      flow_id: flow.id, channel_id: igChannel.id, type: "keyword",
      config: { keywords: [{ value: "presupuesto", matchType: "contains" }] },
      is_active: true,
    });

    const payload = {
      id: `ZEV-FLOW-${stamp}`, event: "message.received",
      message: {
        id: `IGM-FLOW-${stamp}`, direction: "inbound", text: "me pasas un presupuesto?",
        sender: { id: `ig-flow-${stamp}`, name: "Lead con trigger", username: "lead.trigger", picture: null },
        sentAt: new Date().toISOString(),
      },
      conversation: { id: `IGC-FLOW-${stamp}` },
      account: { id: IG_ACCOUNT },
    };
    cleanup.events.push(payload.id);

    const r = await zernio(payload, SECRET);
    check(r.status === 200, "el mensaje se acepta", JSON.stringify(r.body));

    // Un flow sin nodos no manda nada, pero deja su sesion: es la prueba de que
    // el trigger se evaluo y el motor arranco.
    const sesion = await waitFor(
      async () => {
        const { data } = await svc.from("flow_sessions")
          .select("id, flow_id").eq("flow_id", flow.id).maybeSingle();
        return data;
      },
      (d) => !!d,
    );
    check(!!sesion, "el trigger se evaluo y el motor de flows arranco");
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
  // Barrido por prefijo, igual que los demas scripts de verificacion: se lleva
  // tambien lo que haya quedado de una corrida que murio a la mitad.
  await runCleanup(svc);
  for (const id of cleanup.events) await svc.from("webhook_events").delete().eq("event_id", id);
  await svc.from("webhook_events").delete().like("event_id", `%${stamp}%`);
}

const resumen = omitidos ? ` (${omitidos} bloques de WhatsApp omitidos)` : "";
console.log(failures ? `\n${failures} FALLAS${resumen}` : `\nTodo verde${resumen}`);
process.exitCode = failures ? 1 : 0;
