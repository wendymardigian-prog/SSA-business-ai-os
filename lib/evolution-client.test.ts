import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EvolutionError,
  createInstance,
  deleteInstance,
  fetchInstanceOwner,
  fetchProfilePictureUrl,
  getBase64FromMediaMessage,
  getConnectionState,
  findStoredChats,
  findStoredMessagesPage,
  getInstanceStatus,
  getMajorVersion,
  getQrCode,
  instanceNameFor,
  listInstanceNames,
  reconnectInstance,
  resetVersionCache,
  sendMedia,
  sendReaction,
  sendText,
  sendWhatsAppAudio,
  type EvolutionConfig,
} from "./evolution-client";

const config: EvolutionConfig = {
  baseUrl: "https://evo.test",
  apiKey: "clave-global",
  instancePrefix: "ssa",
};

/** Cola de respuestas: cada fetch consume la siguiente. */
function mockFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; method: string; body: any; headers: any }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
      headers: init.headers,
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (next.body === undefined ? "" : JSON.stringify(next.body)),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const v2 = { body: { version: "2.1.1" } };
const v1 = { body: { version: "1.7.4" } };

beforeEach(() => resetVersionCache());
afterEach(() => vi.unstubAllGlobals());

describe("configuracion", () => {
  it("le pone prefijo propio a la instancia para no chocar con otro sistema", () => {
    expect(instanceNameFor(config, "280223ad-6bbc-4620-8c65-20f302a7c249")).toBe("ssa-280223ad");
  });
});

describe("deteccion de version", () => {
  it("detecta v1 y v2, y la pregunta una sola vez", async () => {
    mockFetch([v2]);
    expect(await getMajorVersion(config)).toBe(2);
    expect(await getMajorVersion(config)).toBe(2);
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);

    resetVersionCache();
    mockFetch([v1]);
    expect(await getMajorVersion(config)).toBe(1);
  });

  it("asume v2 si el servidor no dice su version", async () => {
    mockFetch([{ status: 500 }, { status: 500 }, { status: 500 }]);
    expect(await getMajorVersion(config)).toBe(2);
  });
});

describe("sendText", () => {
  it("usa el cuerpo que espera cada version", async () => {
    let calls = mockFetch([v2, { body: { key: { id: "MSG1" } } }]);
    const res = await sendText(config, "ssa-abc", "+54 9 11 2233-4455", "hola");
    expect(res.id).toBe("MSG1");
    expect(calls[1].url).toBe("https://evo.test/message/sendText/ssa-abc");
    expect(calls[1].body).toEqual({ number: "5491122334455", text: "hola" });

    resetVersionCache();
    calls = mockFetch([v1, { body: { key: { id: "MSG2" } } }]);
    await sendText(config, "ssa-abc", "5491122334455@s.whatsapp.net", "hola");
    expect(calls[1].body).toEqual({ number: "5491122334455", textMessage: { text: "hola" } });
  });

  it("a una persona sin telefono (@lid) le manda al @lid entero, no a un numero inventado", async () => {
    resetVersionCache();
    const calls = mockFetch([v2, { body: { key: { id: "MSG3" } } }]);
    await sendText(config, "ssa-abc", "98765432101234@lid", "hola");
    expect(calls[1].body).toEqual({ number: "98765432101234@lid", text: "hola" });
  });

  it("no llama a Evolution con un numero invalido", async () => {
    mockFetch([v2]);
    await expect(sendText(config, "ssa-abc", "1234", "hola")).rejects.toThrow(/invalido/);
  });

  it("manda la apikey en el header, nunca en la URL", async () => {
    const calls = mockFetch([v2, { body: {} }]);
    await sendText(config, "ssa-abc", "+5491122334455", "hola");
    expect(calls[1].headers.apikey).toBe("clave-global");
    expect(calls[1].url).not.toContain("clave-global");
  });
});

describe("reintentos", () => {
  it("reintenta ante un 500 y termina bien", async () => {
    const calls = mockFetch([v2, { status: 500 }, { body: { key: { id: "OK" } } }]);
    const res = await sendText(config, "ssa-abc", "+5491122334455", "hola");
    expect(res.id).toBe("OK");
    expect(calls.length).toBe(3);
  });

  it("no reintenta ante un 400: reintentar no arregla un pedido mal armado", async () => {
    const calls = mockFetch([v2, { status: 400, body: { message: "numero invalido" } }]);
    await expect(sendText(config, "ssa-abc", "+5491122334455", "hola")).rejects.toThrow(
      EvolutionError
    );
    expect(calls.length).toBe(2);
  });

  it("se rinde despues de 3 intentos", async () => {
    const calls = mockFetch([v2, { status: 502 }, { status: 502 }, { status: 502 }]);
    await expect(sendText(config, "ssa-abc", "+5491122334455", "hola")).rejects.toThrow(/502/);
    expect(calls.length).toBe(4);
  });
});

describe("estado de la conexion", () => {
  it("normaliza el estado venga donde venga", async () => {
    mockFetch([{ body: { instance: { state: "open" } } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("open");

    mockFetch([{ body: { state: "connecting" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("connecting");

    mockFetch([{ body: { connectionStatus: "close" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("close");

    mockFetch([{ body: { algo: "raro" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("unknown");
  });

  it("una instancia que ya no existe cuenta como desconectada", async () => {
    mockFetch([{ status: 404, body: { message: "not found" } }]);
    expect(await getConnectionState(config, "ssa-abc")).toBe("close");
  });
});

describe("creacion de instancia", () => {
  it("crear una que ya existe no es un error, y reconfigura el webhook", async () => {
    // La forma REAL de la v2: el texto viene anidado en response.message y arriba solo dice "Forbidden". El test viejo
    // usaba { message } arriba de todo, una forma que Evolution no manda, y por eso no atrapaba el bug de "Reconectar".
    const calls = mockFetch([
      v2,
      {
        status: 403,
        body: { status: 403, error: "Forbidden", response: { message: ['This name "ssa-abc" is already in use.'] } },
      },
      { body: { webhook: {} } },
    ]);
    await createInstance(config, "ssa-abc", "https://x.test/hook", "token123");

    const webhookCall = calls.find((c) => c.url.includes("/webhook/set/"));
    expect(webhookCall).toBeDefined();
    expect(webhookCall!.body.webhook.url).toBe("https://x.test/hook");
    // El token va en un header del webhook: es lo unico que separa un evento
    // real de cualquiera que descubra la URL publica.
    expect(webhookCall!.body.webhook.headers["x-webhook-token"]).toBe("token123");
    expect(webhookCall!.body.webhook.events).toContain("MESSAGES_UPSERT");
    expect(webhookCall!.body.webhook.events).toContain("CONNECTION_UPDATE");
  });

  it("tambien reconoce la forma vieja, con el mensaje arriba", async () => {
    mockFetch([v2, { status: 403, body: { message: "This name ssa-abc is already in use." } }, { body: {} }]);
    await expect(createInstance(config, "ssa-abc", "https://x.test/hook", "t")).resolves.toBeUndefined();
  });

  it("el error muestra lo que dijo Evolution, no un 'Forbidden' a secas", async () => {
    mockFetch([v2, { status: 403, body: { status: 403, error: "Forbidden", response: { message: ["apikey invalida"] } } }]);
    await expect(createInstance(config, "ssa-abc", "https://x.test/hook", "t")).rejects.toThrow(/apikey invalida/);
  });

  it("un 403 que no es 'ya existe' si es un error", async () => {
    mockFetch([v2, { status: 403, body: { message: "unauthorized" } }]);
    await expect(
      createInstance(config, "ssa-abc", "https://x.test/hook", "t")
    ).rejects.toThrow(EvolutionError);
  });
});

describe("borrado de instancia", () => {
  it("se niega a borrar una instancia sin nuestro prefijo", async () => {
    // Este Evolution esta compartido con otro sistema: borrar la instancia
    // equivocada le corta WhatsApp a otro producto.
    mockFetch([]);
    await expect(deleteInstance(config, "crm-produccion")).rejects.toThrow(/prefijo/);
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });

  it("borra la propia", async () => {
    const calls = mockFetch([{ body: {} }]);
    await deleteInstance(config, "ssa-abc");
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("https://evo.test/instance/delete/ssa-abc");
  });
});

describe("fetchInstanceOwner (varios numeros)", () => {
  it("lee el numero vinculado en los tres lugares donde lo informan las versiones", async () => {
    const calls = mockFetch([{ body: [{ name: "ssa-abc", ownerJid: "5491122334455@s.whatsapp.net" }] }]);
    expect(await fetchInstanceOwner(config, "ssa-abc")).toBe("5491122334455@s.whatsapp.net");
    expect(calls[0].url).toBe("https://evo.test/instance/fetchInstances?instanceName=ssa-abc");

    mockFetch([{ body: [{ instance: { instanceName: "ssa-abc", owner: "541100000000@s.whatsapp.net" } }] }]);
    expect(await fetchInstanceOwner(config, "ssa-abc")).toBe("541100000000@s.whatsapp.net");

    mockFetch([{ body: { instances: [{ instanceName: "ssa-abc", number: "5400000000" }] } }]);
    expect(await fetchInstanceOwner(config, "ssa-abc")).toBe("5400000000");
  });

  it("sin numero vinculado (todavia no escaneo el QR) devuelve null", async () => {
    mockFetch([{ body: [{ name: "ssa-abc" }] }]);
    expect(await fetchInstanceOwner(config, "ssa-abc")).toBeNull();
    mockFetch([{ body: [] }]);
    expect(await fetchInstanceOwner(config, "ssa-abc")).toBeNull();
  });
});

describe("lecturas", () => {
  it("lista los nombres de instancia en los dos formatos de respuesta", async () => {
    mockFetch([{ body: [{ instance: { instanceName: "a" } }, { name: "b" }] }]);
    expect(await listInstanceNames(config)).toEqual(["a", "b"]);

    mockFetch([{ body: { instances: [{ instanceName: "c" }] } }]);
    expect(await listInstanceNames(config)).toEqual(["c"]);
  });

  it("saca el QR este anidado o no", async () => {
    mockFetch([{ body: { qrcode: { base64: "data:image/png;base64,AAA", code: "1@x" } } }]);
    expect(await getQrCode(config, "ssa-abc")).toEqual({
      base64: "data:image/png;base64,AAA",
      code: "1@x",
      pairingCode: null,
    });

    mockFetch([{ body: { base64: "data:image/png;base64,BBB", pairingCode: "ABCD-1234" } }]);
    expect(await getQrCode(config, "ssa-abc")).toEqual({
      base64: "data:image/png;base64,BBB",
      code: null,
      pairingCode: "ABCD-1234",
    });
  });
});

describe("getBase64FromMediaMessage (F4)", () => {
  const fullMessage = { key: { id: "WA-MSG-1" }, message: { audioMessage: { mimetype: "audio/ogg" } } };

  it("pide el archivo con el objeto `message` COMPLETO, no solo {key:{id}} (verificado en la 2.3.7, §14c)", async () => {
    const calls = mockFetch([{ body: { base64: "T2dnUw==", mimetype: "audio/ogg; codecs=opus", size: 4 } }]);

    const media = await getBase64FromMediaMessage(config, "ssa-1", fullMessage);

    expect(media).toEqual({ base64: "T2dnUw==", mimetype: "audio/ogg; codecs=opus", fileName: null, size: 4 });
    // Una sola llamada: no se consulta la version primero, el contrato es el
    // mismo en las dos versiones mayores.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/chat/getBase64FromMediaMessage/ssa-1");
    expect(calls[0].method).toBe("POST");
    // El objeto entero, tal cual llego: con la clave sola Evolution busca en
    // su propia base. convertToMp4 en false: un audio convertido pierde el
    // ptt y deja de ser una nota de voz.
    expect(calls[0].body).toEqual({ message: fullMessage, convertToMp4: false });
  });

  it("si Evolution contesta bien pero sin base64 devuelve null: la media ya se borro de WhatsApp", async () => {
    mockFetch([{ body: { mimetype: "image/jpeg" } }]);
    await expect(getBase64FromMediaMessage(config, "ssa-1", fullMessage)).resolves.toBeNull();
  });

  it("un base64 vacio tambien es null", async () => {
    mockFetch([{ body: { base64: "" } }]);
    await expect(getBase64FromMediaMessage(config, "ssa-1", fullMessage)).resolves.toBeNull();
  });

  it("el size llega como objeto en algunas versiones", async () => {
    mockFetch([{ body: { base64: "AAAA", size: { fileLength: "40213" } } }]);
    await expect(getBase64FromMediaMessage(config, "ssa-1", fullMessage)).resolves.toMatchObject({ size: 40213 });
  });

  it("un size que no es un numero no ensucia el metadato", async () => {
    mockFetch([{ body: { base64: "AAAA", size: "no-es-un-numero" } }]);
    await expect(getBase64FromMediaMessage(config, "ssa-1", fullMessage)).resolves.toMatchObject({ size: null });
  });

  it("un error de Evolution lanza EvolutionError, como el resto del cliente", async () => {
    mockFetch([{ status: 400, body: { message: "message not found" } }]);

    await expect(getBase64FromMediaMessage(config, "ssa-1", fullMessage)).rejects.toThrow(EvolutionError);
  });
});

describe("fetchProfilePictureUrl (F16)", () => {
  it("pide la foto por el numero y devuelve la URL", async () => {
    const calls = mockFetch([{ body: { wuid: "5491122334455@s.whatsapp.net", profilePictureUrl: "https://pps.whatsapp.net/x.jpg" } }]);

    const url = await fetchProfilePictureUrl(config, "ssa-1", "+54 9 11 2233-4455");

    expect(url).toBe("https://pps.whatsapp.net/x.jpg");
    expect(calls[0].url).toContain("/chat/fetchProfilePictureUrl/ssa-1");
    expect(calls[0].body).toEqual({ number: "5491122334455" });
  });

  it("sin profilePictureUrl devuelve null, sin error: pasa en algunas versiones de Baileys", async () => {
    mockFetch([{ body: { wuid: "5491122334455@s.whatsapp.net" } }]);
    await expect(fetchProfilePictureUrl(config, "ssa-1", "+5491122334455")).resolves.toBeNull();
  });

  it("un numero invalido no llama a Evolution", async () => {
    const calls = mockFetch([]);
    await expect(fetchProfilePictureUrl(config, "ssa-1", "")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("un error de Evolution lanza, como el resto del cliente", async () => {
    mockFetch([{ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }]);
    await expect(fetchProfilePictureUrl(config, "ssa-1", "+5491122334455")).rejects.toThrow(EvolutionError);
  });
});

describe("sendWhatsAppAudio (F19)", () => {
  it("manda el audio con encoding:true, el default que hace que Evolution convierta", async () => {
    const calls = mockFetch([{ body: { key: { id: "WA-OUT-1" } } }]);

    const result = await sendWhatsAppAudio(config, "ssa-1", "+54 9 11 2233-4455", "https://signed.test/audio.webm");

    expect(result).toEqual({ id: "WA-OUT-1" });
    expect(calls[0].url).toContain("/message/sendWhatsAppAudio/ssa-1");
    expect(calls[0].body).toEqual({ number: "5491122334455", audio: "https://signed.test/audio.webm", encoding: true });
  });

  it("un numero invalido no llama a Evolution", async () => {
    const calls = mockFetch([]);
    await expect(sendWhatsAppAudio(config, "ssa-1", "", "https://x")).rejects.toThrow(EvolutionError);
    expect(calls).toHaveLength(0);
  });
});

describe("sendMedia (F19)", () => {
  it("manda la imagen con mediatype, mimetype y caption", async () => {
    const calls = mockFetch([{ body: { key: { id: "WA-OUT-2" } } }]);

    const result = await sendMedia(config, "ssa-1", "+5491122334455", {
      media: "https://signed.test/foto.jpg",
      mediatype: "image",
      mimetype: "image/jpeg",
      caption: "mirá esto",
    });

    expect(result).toEqual({ id: "WA-OUT-2" });
    expect(calls[0].url).toContain("/message/sendMedia/ssa-1");
    expect(calls[0].body).toEqual({
      number: "5491122334455",
      mediatype: "image",
      media: "https://signed.test/foto.jpg",
      mimetype: "image/jpeg",
      caption: "mirá esto",
    });
  });

  it("un documento suma el fileName", async () => {
    const calls = mockFetch([{ body: { key: { id: "WA-OUT-3" } } }]);

    await sendMedia(config, "ssa-1", "+5491122334455", {
      media: "https://signed.test/doc.pdf",
      mediatype: "document",
      fileName: "contrato.pdf",
    });

    expect(calls[0].body).toMatchObject({ fileName: "contrato.pdf" });
  });
});

describe("sendReaction (A3)", () => {
  it("v2: manda key y reaction al endpoint de la instancia", async () => {
    const calls = mockFetch([v2, { body: {} }]);
    await sendReaction(config, "ssa-abc", { to: "+54 9 11 2233-4455", messageId: "WAID1", fromMe: false, reaction: "👍" });
    expect(calls[1].url).toBe("https://evo.test/message/sendReaction/ssa-abc");
    expect(calls[1].method).toBe("POST");
    expect(calls[1].body).toEqual({ key: { remoteJid: "5491122334455@s.whatsapp.net", fromMe: false, id: "WAID1" }, reaction: "👍" });
  });

  it("v1: lo anida en reactionMessage", async () => {
    const calls = mockFetch([v1, { body: {} }]);
    await sendReaction(config, "ssa-abc", { to: "+5491122334455", messageId: "WAID1", fromMe: false, reaction: "❤️" });
    expect(calls[1].body).toEqual({ reactionMessage: { key: { remoteJid: "5491122334455@s.whatsapp.net", fromMe: false, id: "WAID1" }, reaction: "❤️" } });
  });

  it("una reaccion vacia es la forma de quitarla", async () => {
    const calls = mockFetch([v2, { body: {} }]);
    await sendReaction(config, "ssa-abc", { to: "+5491122334455", messageId: "WAID1", fromMe: false, reaction: "" });
    expect(calls[1].body.reaction).toBe("");
  });

  it("un numero invalido no llama a Evolution", async () => {
    const calls = mockFetch([]);
    await expect(sendReaction(config, "ssa-abc", { to: "1234", messageId: "x", fromMe: false, reaction: "👍" })).rejects.toThrow(/invalido/);
    expect(calls).toHaveLength(0);
  });
});

describe("getInstanceStatus", () => {
  it("distingue 'no existe' de 'desconectada'", async () => {
    mockFetch([{ status: 404, body: { status: 404, error: "Not Found", response: { message: ["does not exist"] } } }]);
    expect(await getInstanceStatus(config, "ssa-abc")).toEqual({ exists: false, state: "close" });

    mockFetch([{ body: { instance: { instanceName: "ssa-abc", state: "close" } } }]);
    expect(await getInstanceStatus(config, "ssa-abc")).toEqual({ exists: true, state: "close" });
  });
});

describe("reconnectInstance (reconectar reusa la instancia)", () => {
  const noWait = async () => {};
  const qr = { body: { base64: "data:image/png;base64,QR", code: "2@abc" } };
  const noQr = { body: { count: 0 } };
  const run = () => reconnectInstance(config, "ssa-abc", "https://x.test/hook", "tok", noWait);
  type Call = { url: string; method: string; body: any };
  const creates = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/instance/create"));
  /** Ninguna llamada nombra otra instancia: reconectar nunca inventa un nombre nuevo. */
  const onlySameName = (calls: Array<Call & { body: any }>) => {
    for (const c of calls) {
      const m = c.url.match(/\/(?:instance|webhook)\/[a-zA-Z]+\/([^/?]+)/);
      if (m) expect(decodeURIComponent(m[1])).toBe("ssa-abc");
      if (c.body?.instanceName) expect(c.body.instanceName).toBe("ssa-abc");
    }
  };

  it("si Evolution la borro, la crea con el MISMO nombre", async () => {
    const calls = mockFetch([{ status: 404, body: { message: "not found" } }, v2, { body: {} }, { body: {} }]);
    expect(await run()).toBe("created");
    expect(creates(calls)).toHaveLength(1);
    expect(creates(calls)[0].body.instanceName).toBe("ssa-abc");
  });

  it("si existe y esta abierta, solo reconfigura el webhook: no crea nada", async () => {
    const calls = mockFetch([{ body: { instance: { state: "open" } } }, v2, { body: {} }]);
    expect(await run()).toBe("open");
    expect(creates(calls)).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/webhook/set/ssa-abc"))).toBe(true);
  });

  it("si existe y da QR, no crea, no reinicia ni cierra sesion", async () => {
    const calls = mockFetch([{ body: { instance: { state: "close" } } }, v2, { body: {} }, qr]);
    expect(await run()).toBe("connect");
    expect(creates(calls)).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/restart/") || c.url.includes("/logout/"))).toBe(false);
    onlySameName(calls);
  });

  it("trabada sin QR: reinicia y vuelve a pedir", async () => {
    const calls = mockFetch([{ body: { instance: { state: "connecting" } } }, v2, { body: {} }, noQr, { body: {} }, qr]);
    expect(await run()).toBe("restart");
    const restart = calls.find((c) => c.url.includes("/instance/restart/ssa-abc"));
    expect(restart?.method).toBe("POST");
    expect(creates(calls)).toHaveLength(0);
  });

  it("si reiniciar no alcanza (o falla), cierra la sesion y vuelve a pedir", async () => {
    const calls = mockFetch([
      { body: { instance: { state: "connecting" } } }, v2, { body: {} },
      noQr,
      { status: 500, body: { message: "boom" } }, // restart: un solo intento, se sigue
      { body: {} }, // logout
      qr,
    ]);
    expect(await run()).toBe("logout");
    expect(calls.filter((c) => c.url.includes("/restart/"))).toHaveLength(1);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/instance/logout/ssa-abc"))).toBe(true);
    expect(creates(calls)).toHaveLength(0);
  });

  it("ultimo recurso: borra y crea la MISMA instancia, nunca otra", async () => {
    const calls = mockFetch([
      { body: { instance: { state: "connecting" } } }, v2, { body: {} },
      noQr,
      { body: {} }, noQr, // restart sin QR
      { body: {} }, noQr, // logout sin QR
      { body: {} }, // delete
      { body: {} }, { body: {} }, // create + webhook
    ]);
    expect(await run()).toBe("recreated");
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/instance/delete/ssa-abc"))).toBe(true);
    expect(creates(calls)).toHaveLength(1);
    onlySameName(calls);
  });
});

describe("historial guardado en Evolution (solo lectura)", () => {
  it("findStoredChats pide los chats con su tope y devuelve la lista", async () => {
    const calls = mockFetch([{ body: [{ remoteJid: "5491122334455@s.whatsapp.net" }] }]);
    const chats = await findStoredChats(config, "ssa-abc", 5000);
    expect(calls[0].url).toBe("https://evo.test/chat/findChats/ssa-abc");
    expect(calls[0].body).toEqual({ where: {}, take: 5000, skip: 0 });
    expect(chats).toEqual([{ remoteJid: "5491122334455@s.whatsapp.net" }]);
  });

  it("findStoredMessagesPage lee el total y la pagina pedida; una respuesta rara da cero", async () => {
    let calls = mockFetch([{ body: { messages: { total: 12, pages: 12, currentPage: 3, records: [{ messageTimestamp: 1 }] } } }]);
    expect(await findStoredMessagesPage(config, "ssa-abc", 3, 1)).toEqual({ total: 12, pages: 12, records: [{ messageTimestamp: 1 }] });
    expect(calls[0].url).toBe("https://evo.test/chat/findMessages/ssa-abc");
    expect(calls[0].body).toEqual({ where: {}, page: 3, offset: 1 });

    calls = mockFetch([{ body: {} }]);
    expect(await findStoredMessagesPage(config, "ssa-abc", 1, 1)).toEqual({ total: 0, pages: 0, records: [] });
  });
});
