/**
 * El hilo de Instagram con nuestra media encima (F14).
 */

import { describe, it, expect } from "vitest";
import type { InboxMessage } from "./zernio-message";
import { mergeThreadWithLocal, platformIdsOf, type LocalMessageMedia } from "./zernio-message-merge";

const fromZernio = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  id: "z-1",
  conversation_id: "cv-1",
  direction: "inbound",
  text: null,
  attachments: [{ type: "audio", url: "https://cdn.meta/vencida.m4a" }],
  quick_reply_payload: null,
  postback_payload: null,
  callback_data: null,
  platform_message_id: "z-1",
  platform_native_message_id: null,
  sent_by_flow_id: null,
  sent_by_node_id: null,
  sent_by_user_id: null,
  status: "delivered",
  created_at: "2026-09-28T12:00:00.000Z",
  ...over,
});

const localRow = (over: Partial<LocalMessageMedia> = {}): LocalMessageMedia => ({
  id: "m-local-1",
  platform_message_id: "z-1",
  attachments: {
    v: 2,
    items: [{ kind: "voice", status: "ready", storagePath: "ws-1/cv-1/m-local-1-0.ogg", mime: "audio/ogg" }],
  },
  transcript: "hola, queria saber el precio",
  transcript_status: "ready",
  transcript_error: null,
  media_description: null,
  ...over,
});

describe("mergeThreadWithLocal (F14)", () => {
  it("con fila local, el mensaje trae NUESTROS adjuntos y la transcripcion", () => {
    const [merged] = mergeThreadWithLocal([fromZernio()], [localRow()]);

    expect(merged.attachments).toEqual({
      v: 2,
      items: [expect.objectContaining({ kind: "voice", status: "ready" })],
    });
    expect(merged.transcript).toBe("hola, queria saber el precio");
    expect(merged.transcript_status).toBe("ready");
  });

  it("y el id pasa a ser el LOCAL: es el que entienden las rutas de reintento", () => {
    const [merged] = mergeThreadWithLocal([fromZernio()], [localRow()]);

    expect(merged.id).toBe("m-local-1");
    // El de Zernio se conserva donde corresponde.
    expect(merged.platform_message_id).toBe("z-1");
  });

  it("SIN fila local devuelve lo de Zernio sin romper", () => {
    // Pasa cuando persist_zernio_inbound estaba apagado: no hay ninguna fila.
    const [merged] = mergeThreadWithLocal([fromZernio()], []);

    expect(merged.id).toBe("z-1");
    expect(merged.attachments).toEqual([{ type: "audio", url: "https://cdn.meta/vencida.m4a" }]);
    expect(merged.transcript).toBeNull();
    expect(merged.transcript_status).toBeNull();
  });

  it("no cambia el orden ni agrega mensajes: el hilo lo manda Zernio", () => {
    const thread = [
      fromZernio({ id: "z-1", platform_message_id: "z-1", text: "hola" }),
      fromZernio({ id: "z-2", platform_message_id: "z-2", text: "y otra cosa" }),
    ];
    // Una fila local que Zernio no devolvio: NO se agrega, dejaria la
    // conversacion en un orden que no es el real.
    const local = [localRow({ id: "m-3", platform_message_id: "z-99" })];

    const merged = mergeThreadWithLocal(thread, local);

    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.platform_message_id)).toEqual(["z-1", "z-2"]);
  });

  it("cruza cada mensaje con el suyo, no con el primero que encuentra", () => {
    const thread = [
      fromZernio({ id: "z-1", platform_message_id: "z-1" }),
      fromZernio({ id: "z-2", platform_message_id: "z-2" }),
    ];
    const local = [
      localRow({ id: "m-1", platform_message_id: "z-1", transcript: "el primero" }),
      localRow({ id: "m-2", platform_message_id: "z-2", transcript: "el segundo" }),
    ];

    const merged = mergeThreadWithLocal(thread, local);

    expect(merged[0].transcript).toBe("el primero");
    expect(merged[1].transcript).toBe("el segundo");
  });

  it("una fila local sin platform_message_id no cruza con nada", () => {
    const [merged] = mergeThreadWithLocal([fromZernio()], [localRow({ platform_message_id: null })]);
    expect(merged.id).toBe("z-1");
  });

  it("un mensaje de Zernio sin platform_message_id tampoco", () => {
    const [merged] = mergeThreadWithLocal([fromZernio({ platform_message_id: null })], [localRow()]);
    expect(merged.transcript).toBeNull();
  });

  it("pasa la descripcion de la imagen y el motivo del fallo", () => {
    const [merged] = mergeThreadWithLocal(
      [fromZernio()],
      [
        localRow({
          transcript: null,
          transcript_status: "failed",
          transcript_error: "No pudimos abrir este audio",
          media_description: "Una captura del comprobante",
        }),
      ],
    );

    expect(merged.transcript_error).toBe("No pudimos abrir este audio");
    expect(merged.media_description).toBe("Una captura del comprobante");
  });

  it("un hilo vacio devuelve un hilo vacio", () => {
    expect(mergeThreadWithLocal([], [localRow()])).toEqual([]);
  });
});

describe("platformIdsOf (F14)", () => {
  it("devuelve los ids para la consulta, sin repetidos ni nulos", () => {
    const ids = platformIdsOf([
      fromZernio({ platform_message_id: "z-1" }),
      fromZernio({ platform_message_id: "z-2" }),
      fromZernio({ platform_message_id: "z-1" }),
      fromZernio({ platform_message_id: null }),
    ]);

    expect(ids).toEqual(["z-1", "z-2"]);
  });

  it("un hilo vacio no dispara una consulta con una lista vacia", () => {
    expect(platformIdsOf([])).toEqual([]);
  });
});
