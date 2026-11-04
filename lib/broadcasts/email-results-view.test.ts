import { describe, it, expect } from "vitest";
import { emailResultTiles, parseEmailResultFilter, recipientEmailBadges } from "./email-results-view";

describe("emailResultTiles", () => {
  it("cada cifra con su porcentaje sobre lo enviado; abiertos marcado como aproximado", () => {
    const tiles = emailResultTiles({ sent: 200, delivered: 196, opened: 80, clicked: 12, bounced: 4, complained: 0, unsubscribed: 3 });
    expect(tiles.map((t) => [t.label, t.value, t.rate])).toEqual([
      ["Entregados", 196, "98 %"],
      ["Abiertos", 80, "40 %"],
      ["Clics", 12, "6 %"],
      ["Rebotes", 4, "2 %"],
      ["Quejas (spam)", 0, "0 %"],
      ["Bajas de este email", 3, "1,5 %"],
    ]);
    expect(tiles.find((t) => t.key === "opened")?.hint).toMatch(/Aproximado/);
  });

  it("sin enviados el porcentaje es «—», nunca 0", () => {
    expect(emailResultTiles({ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 }).every((t) => t.rate === "—")).toBe(true);
  });
});

describe("recipientEmailBadges", () => {
  const row = { delivered_at: null, opened_at: null, clicked_at: null, bounced_at: null, complained_at: null, unsubscribed_at: null, open_count: 0, click_count: 0 };
  it("lo que paso con su email, en orden", () => {
    expect(recipientEmailBadges({ ...row, delivered_at: "x", opened_at: "x", open_count: 3, clicked_at: "x", click_count: 1 })).toEqual(["Entregado", "Abrió (3)", "Clic"]);
    expect(recipientEmailBadges({ ...row, bounced_at: "x", delivered_at: "x" })).toEqual(["Rebotó"]);
    expect(recipientEmailBadges({ ...row, delivered_at: "x", complained_at: "x", unsubscribed_at: "x" })).toEqual(["Entregado", "Marcó spam", "Se dio de baja"]);
    expect(recipientEmailBadges(null)).toEqual([]);
  });
});

describe("parseEmailResultFilter", () => {
  it("solo los conocidos", () => {
    expect(parseEmailResultFilter("abrio")).toBe("abrio");
    expect(parseEmailResultFilter("cualquiera")).toBe("");
    expect(parseEmailResultFilter(null)).toBe("");
  });
});
