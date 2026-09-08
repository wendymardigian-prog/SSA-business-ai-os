import { describe, it, expect } from "vitest";
import {
  messageText,
  messageDirection,
  visibleAttachments,
  toInboxMessage,
  toInboxThread,
} from "./zernio-message";

/**
 * El mensaje de plantilla es el payload REAL que devolvio Zernio para una de
 * las conversaciones que mostraban "Attachment" en vez del texto.
 */
const plantilla = {
  id: "aWdfZAG1faXRlbToxOklHTWVzc2FnZA",
  conversationId: "1024574473955803",
  platform: "instagram",
  message: "",
  senderId: "17841401412602901",
  senderName: "You",
  direction: "outgoing",
  createdAt: "2026-09-05T02:39:11.605Z",
  attachments: [
    {
      type: "template",
      payload: {
        generic: {
          elements: [
            {
              title: "Hola! Gracias por el follow 🤗 Te gustaría que te la envíe?",
              buttons: [{ type: "postback", title: "Si enviamelo!" }],
            },
          ],
        },
      },
    },
  ],
};

const entranteConTexto = {
  id: "m2",
  message: "https://www.instagram.com/reel/DZ4",
  direction: "incoming",
  createdAt: "2026-09-05T03:00:00.000Z",
  attachments: [{ type: "video", url: "https://cdn/video.mp4" }],
};

const soloImagen = {
  id: "m3",
  message: "",
  direction: "incoming",
  createdAt: "2026-09-05T04:00:00.000Z",
  attachments: [{ type: "image", url: "https://cdn/foto.jpg" }],
};

describe("messageText", () => {
  it("usa el texto cuando Zernio lo manda", () => {
    expect(messageText(entranteConTexto)).toBe("https://www.instagram.com/reel/DZ4");
  });

  it("saca el texto de adentro de una plantilla cuando el mensaje viene vacio", () => {
    expect(messageText(plantilla)).toBe(
      "Hola! Gracias por el follow 🤗 Te gustaría que te la envíe?",
    );
  });

  it("un adjunto real no inventa texto", () => {
    expect(messageText(soloImagen)).toBeNull();
  });

  it("junta titulo y subtitulo de la tarjeta", () => {
    const conSubtitulo = {
      message: "",
      attachments: [{ type: "template", payload: { generic: { elements: [
        { title: "Precio", subtitle: "USD 500 por mes" },
      ] } } }],
    };
    expect(messageText(conSubtitulo)).toBe("Precio\n\nUSD 500 por mes");
  });

  it("no se cae con una plantilla incompleta", () => {
    for (const roto of [
      { message: "", attachments: [{ type: "template" }] },
      { message: "", attachments: [{ type: "template", payload: {} }] },
      { message: "", attachments: [{ type: "template", payload: { generic: {} } }] },
      { message: "", attachments: [{ type: "template", payload: { generic: { elements: "no es array" } } }] },
      { message: "", attachments: [{ type: "template", payload: { generic: { elements: [null] } } }] },
    ]) {
      expect(messageText(roto)).toBeNull();
    }
  });

  it("un mensaje con solo espacios cuenta como vacio", () => {
    expect(messageText({ message: "   " })).toBeNull();
  });

  it("no se cae con basura", () => {
    expect(messageText(null)).toBeNull();
    expect(messageText("hola")).toBeNull();
    expect(messageText({})).toBeNull();
  });
});

describe("messageDirection", () => {
  it("outgoing es saliente: es nuestro mensaje", () => {
    expect(messageDirection({ direction: "outgoing" })).toBe("outbound");
  });

  it("incoming es entrante", () => {
    expect(messageDirection({ direction: "incoming" })).toBe("inbound");
  });

  it("ante la duda, entrante", () => {
    expect(messageDirection({})).toBe("inbound");
    expect(messageDirection({ direction: "cualquiera" })).toBe("inbound");
  });
});

describe("visibleAttachments", () => {
  it("la plantilla cuyo texto ya se muestra deja de ser adjunto", () => {
    expect(visibleAttachments(plantilla, true)).toBeNull();
  });

  it("un adjunto de verdad se conserva", () => {
    expect(visibleAttachments(soloImagen, false)).toHaveLength(1);
  });

  it("el adjunto que acompaña a un texto propio tambien se conserva", () => {
    expect(visibleAttachments(entranteConTexto, false)).toHaveLength(1);
  });
});

describe("toInboxMessage", () => {
  it("traduce el mensaje de plantilla completo", () => {
    const m = toInboxMessage(plantilla, "conv-1");
    expect(m.text).toContain("Gracias por el follow");
    expect(m.direction).toBe("outbound");
    expect(m.attachments).toBeNull();
    expect(m.conversation_id).toBe("conv-1");
    expect(m.created_at).toBe("2026-09-05T02:39:11.605Z");
  });

  it("traduce un entrante con adjunto", () => {
    const m = toInboxMessage(entranteConTexto, "conv-1");
    expect(m.direction).toBe("inbound");
    expect(m.text).toContain("instagram.com/reel");
    expect(m.attachments).toHaveLength(1);
  });

  it("usa deliveryStatus cuando viene", () => {
    expect(toInboxMessage({ ...plantilla, deliveryStatus: "failed" }, "c").status).toBe("failed");
    expect(toInboxMessage(plantilla, "c").status).toBe("sent");
  });
});

describe("toInboxThread", () => {
  const respuesta = (messages: unknown[], sortOrderApplied?: string) => ({
    data: { messages, ...(sortOrderApplied ? { sortOrderApplied } : {}) },
  });

  it("lee la lista de mensajes", () => {
    const hilo = toInboxThread(respuesta([plantilla, entranteConTexto]), "c");
    expect(hilo).toHaveLength(2);
  });

  it("da vuelta el hilo cuando vino descendente, para que se lea de arriba abajo", () => {
    const hilo = toInboxThread(respuesta([entranteConTexto, plantilla], "desc"), "c");
    expect(hilo[0].id).toBe(plantilla.id);
  });

  it("NO lo da vuelta cuando ya vino ascendente", () => {
    const hilo = toInboxThread(respuesta([plantilla, entranteConTexto], "asc"), "c");
    expect(hilo[0].id).toBe(plantilla.id);
  });

  it("tampoco lo da vuelta si no dice en que orden vino", () => {
    const hilo = toInboxThread(respuesta([plantilla, entranteConTexto]), "c");
    expect(hilo[0].id).toBe(plantilla.id);
  });

  it("una respuesta vacia o rara devuelve lista vacia", () => {
    expect(toInboxThread({ data: {} }, "c")).toEqual([]);
    expect(toInboxThread(null, "c")).toEqual([]);
  });
});
