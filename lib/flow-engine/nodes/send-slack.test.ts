import { describe, expect, it } from "vitest";
import { escapeSlackText, slackDestination, slackSafeVariables } from "./send-slack";
import { interpolateVariables } from "../interpolate";

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

describe("«Enviar a Slack»: lo que escribe un lead no arroba ni disfraza links", () => {
  it("escapa < > & de los valores", () => {
    expect(escapeSlackText("<!channel> & <https://x.example|Clic>")).toBe("&lt;!channel&gt; &amp; &lt;https://x.example|Clic&gt;");
  });
  it("la plantilla del equipo conserva sus menciones; el valor del lead sale escapado", () => {
    const vars = slackSafeVariables({ contact: { name: "<!channel>", tags: ["<b>"] }, n: 3 }) as Record<string, unknown>;
    expect(interpolateVariables("<@U123> nuevo lead: {{contact.name}}", vars)).toBe("<@U123> nuevo lead: &lt;!channel&gt;");
    expect((vars.contact as { tags: string[] }).tags).toEqual(["&lt;b&gt;"]);
    expect(vars.n).toBe(3);
  });
});
