import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DELETED_MESSAGE_LABEL,
  WHATSAPP_DELETE_WINDOW_MS,
  canDeleteForEveryone,
  deletedBubbleView,
  parseWhatsappRevoke,
  revokeSource,
  withoutDeletedMessages,
} from "./revoke";

const JID = "5491122223333@s.whatsapp.net";

describe("parseWhatsappRevoke: como llega un borrado en Evolution 2.3.7", () => {
  it("messages.edited con el protocolMessage REVOKE (como texto, como 0 o sin type)", () => {
    for (const type of ["REVOKE", 0, undefined]) {
      expect(parseWhatsappRevoke("messages.edited", { key: { remoteJid: JID, fromMe: false, id: "ABC" }, type })).toEqual({
        targetId: "ABC",
        fromMe: false,
        remoteJid: JID,
      });
    }
  });

  it("una edicion no es un borrado (trae editedMessage, tipo 14)", () => {
    expect(parseWhatsappRevoke("messages.edited", { key: { id: "ABC" }, type: 14, editedMessage: { conversation: "x" } })).toBeNull();
    expect(parseWhatsappRevoke("messages.edited", { key: { id: "ABC" }, type: "MESSAGE_EDIT" })).toBeNull();
  });

  it("otros avisos del protocolo no son un borrado", () => {
    expect(parseWhatsappRevoke("messages.edited", { key: { id: "ABC" }, type: 3 })).toBeNull();
    expect(parseWhatsappRevoke("messages.edited", { type: 0 })).toBeNull();
  });

  it("messages.delete con la key desparramada (aviso de Baileys)", () => {
    expect(parseWhatsappRevoke("messages.delete", { remoteJid: JID, fromMe: true, id: "ABC", status: "DELETED" })).toEqual({
      targetId: "ABC",
      fromMe: true,
      remoteJid: JID,
    });
  });

  it("messages.delete con la fila de Evolution (borrado por la API): el id bueno es key.id, no data.id", () => {
    expect(
      parseWhatsappRevoke("messages.delete", { id: "cuid-evolution", key: { remoteJid: JID, fromMe: true, id: "3EB0" }, status: "DELETED" }),
    ).toMatchObject({ targetId: "3EB0", fromMe: true });
  });

  it("messages.upsert con un protocolMessage de borrado", () => {
    expect(
      parseWhatsappRevoke("messages.upsert", { key: { id: "evt" }, message: { protocolMessage: { key: { id: "ABC", fromMe: true }, type: 0 } } }),
    ).toMatchObject({ targetId: "ABC", fromMe: true });
  });

  it("un mensaje comun, una reaccion o algo ilegible no es un borrado", () => {
    expect(parseWhatsappRevoke("messages.upsert", { key: { id: "evt" }, message: { conversation: "hola" } })).toBeNull();
    expect(parseWhatsappRevoke("messages.upsert", { message: { reactionMessage: { key: { id: "ABC" }, text: "❤️" } } })).toBeNull();
    expect(parseWhatsappRevoke("messages.delete", null)).toBeNull();
    expect(parseWhatsappRevoke("messages.delete", { id: "" })).toBeNull();
    expect(parseWhatsappRevoke("connection.update", { key: { id: "ABC" } })).toBeNull();
  });
});

describe("revokeSource", () => {
  it("lo nuestro lo borro el negocio; lo del contacto, el contacto; sin dato, lo que diga el evento", () => {
    expect(revokeSource({ fromMe: true }, false)).toBe("business");
    expect(revokeSource({ fromMe: false }, true)).toBe("contact");
    expect(revokeSource({ fromMe: null }, true)).toBe("business");
    expect(revokeSource({ fromMe: null }, false)).toBe("contact");
  });
});

describe("withoutDeletedMessages: el agente y el resumen no leen lo borrado", () => {
  it("saca solo los borrados y conserva el orden", () => {
    const rows = [
      { id: "a", deleted_for_everyone_at: null },
      { id: "b", deleted_for_everyone_at: "2026-11-08T18:30:00Z" },
      { id: "c" },
    ];
    expect(withoutDeletedMessages(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("deletedBubbleView: la burbuja de un mensaje borrado", () => {
  it("un mensaje sin borrar se ve como siempre", () => {
    expect(deletedBubbleView({ direction: "inbound", text: "hola", deleted_for_everyone_at: null })).toBeNull();
  });

  it("dice «Mensaje eliminado», quien lo borro y si hay algo para ver", () => {
    expect(
      deletedBubbleView({ direction: "outbound", text: "¡Hola Contacto!", deleted_for_everyone_at: "2026-11-08T18:30:00Z", deleted_for_everyone_source: "business" }),
    ).toEqual({ label: DELETED_MESSAGE_LABEL, detail: "Se eliminó desde el WhatsApp del negocio.", hasOriginal: true });
    expect(deletedBubbleView({ direction: "inbound", text: "x", deleted_for_everyone_at: "t", deleted_for_everyone_source: "contact" })?.detail).toBe(
      "Lo eliminó el contacto.",
    );
    expect(deletedBubbleView({ direction: "outbound", text: "x", deleted_for_everyone_at: "t", deleted_for_everyone_source: "app" })?.detail).toBe(
      "Lo eliminó alguien del equipo desde acá.",
    );
  });

  it("sin texto ni adjunto no ofrece «Ver lo que decía»", () => {
    expect(deletedBubbleView({ direction: "inbound", text: "  ", attachments: null, deleted_for_everyone_at: "t" })?.hasOriginal).toBe(false);
    expect(deletedBubbleView({ direction: "inbound", text: null, attachments: { v: 2, items: [] }, deleted_for_everyone_at: "t" })?.hasOriginal).toBe(true);
  });
});

describe("canDeleteForEveryone: cuando se ofrece «Eliminar para todos»", () => {
  const now = new Date("2026-11-08T20:00:00Z");
  const base = {
    provider: "evolution",
    direction: "outbound" as const,
    status: "sent",
    platformMessageId: "3EB0",
    createdAt: "2026-11-08T18:00:00Z",
    deletedAt: null,
    now,
  };

  it("un saliente de WhatsApp que salio hace poco, si", () => {
    expect(canDeleteForEveryone(base)).toEqual({ ok: true });
    expect(canDeleteForEveryone({ ...base, status: "delivered" }).ok).toBe(true);
  });

  it("solo WhatsApp: Instagram, email y un proveedor desconocido no", () => {
    for (const provider of ["zernio", "resend", "otro", null]) {
      expect(canDeleteForEveryone({ ...base, provider }).ok).toBe(false);
    }
  });

  it("no lo del contacto, ni lo que no salio, ni lo que ya se borro, ni sin id", () => {
    expect(canDeleteForEveryone({ ...base, direction: "inbound" }).ok).toBe(false);
    expect(canDeleteForEveryone({ ...base, status: "failed" }).ok).toBe(false);
    expect(canDeleteForEveryone({ ...base, status: "pending" }).ok).toBe(false);
    expect(canDeleteForEveryone({ ...base, deletedAt: "2026-11-08T19:00:00Z" }).ok).toBe(false);
    expect(canDeleteForEveryone({ ...base, platformMessageId: null }).ok).toBe(false);
  });

  it("dentro de los dos dias si; despues, no", () => {
    const justInside = new Date(now.getTime() - WHATSAPP_DELETE_WINDOW_MS + 60_000).toISOString();
    const outside = new Date(now.getTime() - WHATSAPP_DELETE_WINDOW_MS - 60_000).toISOString();
    expect(canDeleteForEveryone({ ...base, createdAt: justInside }).ok).toBe(true);
    expect(canDeleteForEveryone({ ...base, createdAt: outside })).toEqual({
      ok: false,
      reason: "WhatsApp solo deja eliminar para todos durante los primeros dos días.",
    });
  });
});

// @plantilla-desde(proyecto)
describe("la vista previa de la lista (00356) dice lo mismo que la burbuja", () => {
  it("la etiqueta del SQL es DELETED_MESSAGE_LABEL", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/00356_messages_deleted_for_everyone.sql"), "utf8");
    expect(sql).toContain(`THEN '${DELETED_MESSAGE_LABEL}'`);
  });

  it("el trigger del ultimo mensaje usa la vista previa con el borrado", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/00356_messages_deleted_for_everyone.sql"), "utf8");
    expect(sql).toMatch(/v_preview := private\.message_list_preview\(v_last\.text, v_last\.transcript, v_last\.attachments, v_last\.deleted_for_everyone_at\)/);
    expect(sql).toMatch(/AFTER UPDATE OF deleted_for_everyone_at ON public\.messages/);
  });
});
// @plantilla-hasta(proyecto)
