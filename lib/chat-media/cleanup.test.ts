/**
 * La retencion de la media del chat (F5), con reloj fijo.
 */

import { describe, it, expect } from "vitest";
import { emptyAttachment } from "@/lib/messages/attachments";
import { planChatMediaCleanup, type MessageToClean } from "./cleanup";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 3_600_000).toISOString();

const ready = (path: string, over = {}) =>
  emptyAttachment("voice", { status: "ready", storagePath: path, mime: "audio/ogg", durationSeconds: 12, ...over });

const message = (over: Partial<MessageToClean> = {}): MessageToClean => ({
  id: "m-1",
  created_at: daysAgo(200),
  attachments: { v: 2, items: [ready("ws-1/cv-1/m-1-0.ogg")] },
  ...over,
});

describe("planChatMediaCleanup (F5)", () => {
  it("un archivo que paso la retencion se borra y el item queda sin path", () => {
    const [plan] = planChatMediaCleanup({ messages: [message()], retentionDays: 180, now: NOW });

    expect(plan.messageId).toBe("m-1");
    expect(plan.paths).toEqual(["ws-1/cv-1/m-1-0.ogg"]);
    expect(plan.attachments?.items[0]).toMatchObject({
      kind: "voice",
      storagePath: null,
      // "none" y no "failed": no fallo nada, el archivo cumplio su plazo.
      status: "none",
      error: null,
      // Y el resto de los metadatos se conserva: la burbuja sigue pudiendo
      // decir que llego una nota de voz de 12 segundos.
      durationSeconds: 12,
      mime: "audio/ogg",
    });
  });

  it("uno que todavia no la paso no se toca", () => {
    expect(planChatMediaCleanup({ messages: [message({ created_at: daysAgo(100) })], retentionDays: 180, now: NOW }))
      .toEqual([]);
  });

  it("justo en el limite no se borra: el plazo se cumple al pasarlo", () => {
    expect(planChatMediaCleanup({ messages: [message({ created_at: daysAgo(180) })], retentionDays: 180, now: NOW }))
      .toEqual([]);
  });

  it("retencion 0 es no borrar nunca", () => {
    expect(planChatMediaCleanup({ messages: [message({ created_at: daysAgo(3000) })], retentionDays: 0, now: NOW }))
      .toEqual([]);
  });

  it("los adjuntos de email NO se tocan: tienen su bucket y su propia retencion", () => {
    const plans = planChatMediaCleanup({
      messages: [
        message({
          attachments: {
            v: 2,
            items: [
              emptyAttachment("document", {
                status: "ready",
                storagePath: "ws-1/email-1/0-guia.pdf",
                meta: { bucket: "email-attachments" },
              }),
            ],
          },
        }),
      ],
      retentionDays: 180,
      now: NOW,
    });

    expect(plans).toEqual([]);
  });

  it("un item que ya fallo o que ya se purgo no da trabajo de nuevo", () => {
    const plans = planChatMediaCleanup({
      messages: [
        message({ attachments: { v: 2, items: [emptyAttachment("image", { status: "failed", error: "404" })] } }),
        message({ id: "m-2", attachments: { v: 2, items: [emptyAttachment("voice", { status: "none" })] } }),
      ],
      retentionDays: 180,
      now: NOW,
    });

    expect(plans).toEqual([]);
  });

  it("de un mensaje con dos adjuntos se borran los dos, en un solo plan", () => {
    const [plan] = planChatMediaCleanup({
      messages: [
        message({
          attachments: { v: 2, items: [ready("ws-1/cv-1/m-1-0.ogg"), ready("ws-1/cv-1/m-1-1.jpg", { kind: "image" })] },
        }),
      ],
      retentionDays: 180,
      now: NOW,
    });

    expect(plan.paths).toEqual(["ws-1/cv-1/m-1-0.ogg", "ws-1/cv-1/m-1-1.jpg"]);
    expect(plan.attachments?.items.every((i) => i.storagePath === null)).toBe(true);
  });

  it("los formatos viejos no dan trabajo: no tienen archivo nuestro que borrar", () => {
    const plans = planChatMediaCleanup({
      messages: [
        message({ attachments: [{ type: "image", url: "https://cdn.meta/vencida.jpg" }] }),
        message({ id: "m-2", attachments: { audioMessage: { ptt: true, seconds: 3 } } }),
        message({ id: "m-3", attachments: null }),
      ],
      retentionDays: 180,
      now: NOW,
    });

    expect(plans).toEqual([]);
  });

  it("una fecha ilegible no se borra: ante la duda no se toca", () => {
    expect(planChatMediaCleanup({ messages: [message({ created_at: "cualquier cosa" })], retentionDays: 180, now: NOW }))
      .toEqual([]);
  });

  it("un mensaje sin adjuntos no entra en el plan", () => {
    expect(planChatMediaCleanup({ messages: [message({ attachments: { v: 2, items: [] } })], retentionDays: 180, now: NOW }))
      .toEqual([]);
  });
});
