import { describe, expect, it } from "vitest";
import { defaultMainContactId, mergedPreview, strongDataCount, type MergeCandidate } from "./merge-pick";

function contact(over: Partial<MergeCandidate>): MergeCandidate {
  return {
    id: "a",
    name: "Persona",
    phone: null,
    email: null,
    instagram: null,
    isKnown: false,
    isCustomer: false,
    platforms: [],
    ...over,
  };
}

describe("strongDataCount", () => {
  it("cuenta teléfono, email, @ y canales, nunca el nombre", () => {
    expect(strongDataCount(contact({}))).toBe(0);
    expect(strongDataCount(contact({ phone: "+5491100000000", email: "x@y.com", platforms: ["whatsapp"] }))).toBe(3);
    expect(strongDataCount(contact({ email: "  " }))).toBe(0);
  });
});

describe("defaultMainContactId", () => {
  const instagram = contact({ id: "ig", instagram: "marca", platforms: ["instagram"], isCustomer: true });
  const whatsapp = contact({ id: "wa", phone: "+5491100000000", email: "x@y.com", platforms: ["whatsapp"] });

  it("queda el que tiene más datos fuertes", () => {
    expect(defaultMainContactId(instagram, whatsapp)).toBe("wa");
    expect(defaultMainContactId(whatsapp, instagram)).toBe("wa");
  });

  it("empatados, queda el que se está mirando", () => {
    const other = contact({ id: "b", instagram: "otra", platforms: ["instagram"] });
    expect(defaultMainContactId(instagram, other)).toBe("ig");
  });
});

describe("mergedPreview", () => {
  it("completa lo vacío del principal y junta marcas y canales", () => {
    const main = contact({ id: "wa", phone: "+5491100000000", platforms: ["whatsapp"] });
    const dup = contact({ id: "ig", phone: "+5491199999999", instagram: "marca", platforms: ["instagram"], isCustomer: true });
    expect(mergedPreview(main, dup)).toEqual({
      id: "wa",
      name: "Persona",
      phone: "+5491100000000",
      email: null,
      instagram: "marca",
      isKnown: false,
      isCustomer: true,
      platforms: ["whatsapp", "instagram"],
    });
  });
});
