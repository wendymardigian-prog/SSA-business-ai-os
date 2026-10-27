/**
 * Caracterización de `sanitizeRaw` / `recordTouch`.
 *
 * Fija lo que se guarda en `raw` para estos tres orígenes:
 *  - la Agenda: su toque se arma en SQL (`create_booking`) y su `raw` es
 *    `{ utm, booking_origin }`; no pasa por `sanitizeRaw`, pero su FORMA es la
 *    que tiene que seguir sobreviviendo si algún día pasara;
 *  - un DM de Zernio (`lib/contacts/touch-inbound.ts`);
 *  - un comentario de Zernio (`lib/comments/attribution.ts`).
 *
 * Lo nuevo solo puede SUMAR claves. Si alguno de estos casos cambia, se rompió algo
 * que no era parte del módulo.
 */
import { describe, it, expect, vi } from "vitest";
import { recordTouch, sanitizeRaw } from "./touch";

const AGENDA_RAW = {
  utm: { utm_source: "facebook", utm_medium: "cpc", utm_campaign: "octubre", utm_content: "video-1", utm_term: "crm" },
  booking_origin: "public",
};

const ZERNIO_DM_RAW = {
  message_id: "mid.123",
  story_id: "story-9",
  referral: {
    source: "ads",
    type: "OPEN_THREAD",
    ad_id: "120001",
    headline: "Probá el sistema",
    ctwa_clid: "ctwa-1",
    // Estas claves NO están en la lista blanca y no pueden colarse.
    access_token: "secreto",
    photo_url: "https://x/y.jpg",
  },
  sender_phone: "+50688881234",
};

const ZERNIO_COMMENT_RAW = {
  comment_id: "c-77",
  platform: "instagram",
  text: "quiero info",
  author_email: "ana@x.com",
};

describe("sanitizeRaw: caracterización previa a Formularios", () => {
  it("toque de la Agenda: conserva utm y booking_origin tal cual", () => {
    expect(sanitizeRaw(AGENDA_RAW)).toEqual(AGENDA_RAW);
  });

  it("toque de un DM de Zernio: conserva ids y referral, descarta lo demás", () => {
    expect(sanitizeRaw(ZERNIO_DM_RAW)).toEqual({
      message_id: "mid.123",
      story_id: "story-9",
      referral: {
        source: "ads",
        type: "OPEN_THREAD",
        ad_id: "120001",
        headline: "Probá el sistema",
        ctwa_clid: "ctwa-1",
      },
    });
  });

  it("toque de un comentario de Zernio: conserva comment_id y platform, descarta el texto y el email", () => {
    expect(sanitizeRaw(ZERNIO_COMMENT_RAW)).toEqual({ comment_id: "c-77", platform: "instagram" });
  });

  it("recorta valores largos a 300 caracteres y respeta los dos niveles", () => {
    const out = sanitizeRaw({ utm: { utm_source: "x".repeat(400), deeper: { utm_source: "no" } } });
    expect((out.utm as Record<string, string>).utm_source).toHaveLength(300);
    expect(out.utm).not.toHaveProperty("deeper");
  });

  it("recordTouch manda a la base exactamente el raw saneado de cada origen", async () => {
    const cases = [
      { raw: AGENDA_RAW, origin: "booking" as const },
      { raw: ZERNIO_DM_RAW, origin: "dm" as const },
      { raw: ZERNIO_COMMENT_RAW, origin: "comment" as const },
    ];
    for (const { raw, origin } of cases) {
      const rpc = vi.fn(async () => ({ data: { inserted: true }, error: null }));
      await recordTouch({ rpc } as never, {
        workspaceId: "ws",
        contactId: "c",
        touch: { source: "instagram", origin, dedupeKey: `k:${origin}`, raw },
      });
      const args = rpc.mock.calls[0] as unknown as [string, { p_touch: { raw: unknown } }];
      expect(args[0]).toBe("record_contact_touch");
      expect(args[1].p_touch.raw).toEqual(sanitizeRaw(raw));
    }
  });
});
