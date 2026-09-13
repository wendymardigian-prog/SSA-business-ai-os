import { describe, it, expect } from "vitest";
import { countIncludedDocuments } from "./screen";

const docs = [
  { id: "1", title: "Precios", tags: ["ventas"], internalOnly: false, status: "ready" },
  { id: "2", title: "Margenes", tags: ["ventas"], internalOnly: true, status: "ready" },
  { id: "3", title: "FAQ", tags: [], internalOnly: false, status: "ready" },
  { id: "4", title: "RRHH", tags: ["equipo"], internalOnly: false, status: "ready" },
];

describe("contador de documentos que lee el agente", () => {
  it("sin tags: toda la base salvo lo interno", () => {
    expect(countIncludedDocuments(docs, [])).toEqual({ included: 3, internalExcluded: 1, outsideTags: 0 });
  });

  it("con tags: solo los de esos tags, y lo interno nunca, aunque tenga el tag", () => {
    expect(countIncludedDocuments(docs, ["ventas"])).toEqual({ included: 1, internalExcluded: 1, outsideTags: 2 });
  });
});
