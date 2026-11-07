import { describe, expect, it } from "vitest";
import { buildCommentAutomations, commentLogStatus, newCommentAutomationBody } from "./automation-list";

const CH = "11111111-1111-4111-8111-111111111111";

describe("la pestaña Comentarios", () => {
  it("cuenta coincidencias y mensajes enviados de verdad, con el motivo mas comun", () => {
    const [row] = buildCommentAutomations({
      triggers: [
        { id: "t1", flow_id: "f1", channel_id: null, is_active: true, config: { keywords: [{ value: "clase" }], replyText: "x" }, flow: { id: "f1", name: "Clase", status: "published" } },
      ],
      channelNames: {},
      logs: [
        { matched_trigger_id: "t1", dm_sent: false, reply_sent: true },
        { matched_trigger_id: "t1", dm_sent: true, reply_sent: true },
        { matched_trigger_id: null, dm_sent: false, reply_sent: false },
      ],
      failures: [{ flow_id: "f1", reason: "Otra app contestó primero." }],
    });
    expect(row).toMatchObject({ keywords: ["clase"], matched: 2, dmSent: 1, notSent: 1, topFailure: "Otra app contestó primero.", legacy: false });
    expect(row.scope).toBe("Todas las cuentas · todas las publicaciones");
  });

  it("marca como vieja una regla de Growth (con cuenta y sin la marca del lienzo)", () => {
    const rows = buildCommentAutomations({
      triggers: [
        { id: "g", flow_id: "f", channel_id: CH, is_active: true, config: { postIds: ["1"] }, flow: { id: "f", name: "A", status: "published" } },
        { id: "c", flow_id: "f2", channel_id: CH, is_active: true, config: { origin: "canvas" }, flow: { id: "f2", name: "B", status: "published" } },
      ],
      channelNames: { [CH]: "@wendy" },
      logs: [],
      failures: [],
    });
    expect(rows.find((r) => r.triggerId === "g")).toMatchObject({ legacy: true, scope: "@wendy · 1 publicación" });
    expect(rows.find((r) => r.triggerId === "c")?.legacy).toBe(false);
  });

  it("el estado de cada comentario", () => {
    expect(commentLogStatus({ matched_trigger_id: null, dm_sent: false, error: null }).label).toBe("No coincidió");
    expect(commentLogStatus({ matched_trigger_id: "t", dm_sent: true, error: null }).tone).toBe("ok");
    expect(commentLogStatus({ matched_trigger_id: "t", dm_sent: false, error: null }).label).toBe("No se envió");
  });

  it("arma la automatizacion nueva con la palabra y la cuenta", () => {
    const body = newCommentAutomationBody({ trigger: "comment_keyword", keyword: " CLASE ", channelId: CH });
    expect(body.name).toBe("Comentario «CLASE»");
    expect(body.nodes[0].data).toEqual({ triggerType: "comment_keyword", keywords: [{ value: "CLASE", matchType: "exact" }], channelId: CH });
  });
});
