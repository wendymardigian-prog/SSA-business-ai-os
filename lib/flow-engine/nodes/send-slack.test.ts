import { describe, expect, it } from "vitest";
import { slackDestination } from "./send-slack";

describe("«Enviar a Slack»: a dónde va (A4, F158)", () => {
  it("un canal por ID o por #nombre", () => {
    expect(slackDestination({ target: "channel", channel: "C0123ABCD" }, null)).toEqual({ ok: true, to: "C0123ABCD" });
    expect(slackDestination({ channel: "#ventas" }, null)).toEqual({ ok: true, to: "ventas" });
    expect(slackDestination({ channel: "ventas con espacio" }, null).ok).toBe(false);
    expect(slackDestination({ channel: "" }, null).ok).toBe(false);
  });
  it("una persona solo si eligió a alguien y esa persona cargó su ID", () => {
    expect(slackDestination({ target: "person" }, null).ok).toBe(false);
    expect(slackDestination({ target: "person", userId: "u1" }, null)).toEqual({ ok: false, reason: "Esa persona no cargó su ID de Slack en Mi cuenta." });
    expect(slackDestination({ target: "person", userId: "u1" }, "U0ABC")).toEqual({ ok: true, to: "U0ABC" });
  });
});
