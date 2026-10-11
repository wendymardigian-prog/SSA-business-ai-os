import { describe, expect, it } from "vitest";
import { attendeesText, transcriptText } from "./transcript-text";

describe("transcriptText", () => {
  it("una linea por intervencion con hora y quien habla", () => {
    expect(
      transcriptText([
        { timestamp: "00:00:05", speaker: { display_name: "Ana" }, text: "Hola" },
        { timestamp: "00:00:09", speaker: { display_name: "Leo" }, text: "Buenas" },
      ]),
    ).toBe("[00:00:05] Ana: Hola\n[00:00:09] Leo: Buenas");
  });
  it("tolera campos que faltan y valores raros", () => {
    expect(transcriptText([{ text: "solo texto" }])).toBe("[] ?: solo texto");
    expect(transcriptText(null)).toBe("");
    expect(transcriptText("ya es texto")).toBe("ya es texto");
  });
});

describe("attendeesText", () => {
  it("lista nombre, correo y si es externo", () => {
    expect(attendeesText([{ name: "Ana", email: "a@x.com", is_external: true }, { email: "b@x.com" }])).toBe(
      "- Ana <a@x.com> (externo)\n- <b@x.com>",
    );
  });
  it("sin invitados lo dice", () => {
    expect(attendeesText([])).toBe("(sin invitados)");
    expect(attendeesText(undefined)).toBe("(sin invitados)");
  });
});
