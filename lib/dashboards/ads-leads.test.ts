/**
 * Leads por campaña cruzados con los contactos (F60).
 */

import { describe, it, expect } from "vitest";
import { leadsByCampaign, orphanAttributions, parseAttribution } from "./ads-leads";

const contact = (campaignId: string | null, id = "ct-1") => ({
  contactId: id,
  createdAt: "2026-10-01T12:00:00Z",
  campaignId,
  adId: null,
});

describe("leer la atribucion (F60)", () => {
  it("acepta snake_case y camelCase", () => {
    expect(parseAttribution({ campaign_id: "c1", ad_id: "a1" })).toEqual({
      campaignId: "c1",
      adId: "a1",
    });
    expect(parseAttribution({ campaignId: "c1" }).campaignId).toBe("c1");
  });

  it("lo que no sirve no rompe nada", () => {
    expect(parseAttribution(null)).toEqual({ campaignId: null, adId: null });
    expect(parseAttribution("texto suelto")).toEqual({ campaignId: null, adId: null });
    expect(parseAttribution({ campaign_id: 42 }).campaignId).toBeNull();
  });
});

describe("contactos por campaña (F60)", () => {
  const campaigns = [
    { objectId: "c1", objectName: "Campaña 1", leads: 10 },
    { objectId: "c2", objectName: "Campaña 2", leads: 0 },
  ];

  it("cuenta los contactos que traen ese campaign_id", () => {
    const result = leadsByCampaign({
      campaigns,
      contacts: [contact("c1", "a"), contact("c1", "b"), contact("c2", "c")],
    });

    expect(result[0]).toMatchObject({ campaignId: "c1", contacts: 2, reportedLeads: 10 });
  });

  it("cuando Meta informa mas que el CRM, explica por que", () => {
    // Meta cuenta eventos y el CRM cuenta personas.
    const result = leadsByCampaign({ campaigns, contacts: [contact("c1")] });

    expect(result[0].note).toContain("mas de una vez");
  });

  it("cuando hay mas contactos que leads, tambien", () => {
    const result = leadsByCampaign({
      campaigns: [{ objectId: "c1", objectName: "Campaña 1", leads: 1 }],
      contacts: [contact("c1", "a"), contact("c1", "b"), contact("c1", "c")],
    });

    expect(result[0].note).toContain("por otro lado");
  });

  it("leads informados sin ningun contacto es un problema, y lo dice", () => {
    const result = leadsByCampaign({ campaigns, contacts: [] });

    expect(result[0].note).toContain("Revisa la integracion");
  });

  it("si los dos numeros coinciden, no hay nada que aclarar", () => {
    const result = leadsByCampaign({
      campaigns: [{ objectId: "c1", objectName: "Campaña 1", leads: 2 }],
      contacts: [contact("c1", "a"), contact("c1", "b")],
    });

    expect(result[0].note).toBeNull();
  });
});

describe("atribuciones sin campaña conocida (F60)", () => {
  it("se cuentan aparte", () => {
    // Una fila con un id numerico suelto no le sirve a nadie.
    expect(
      orphanAttributions({
        knownCampaignIds: ["c1"],
        contacts: [contact("c1"), contact("c9", "b"), contact(null, "c")],
      }),
    ).toBe(1);
  });
});
