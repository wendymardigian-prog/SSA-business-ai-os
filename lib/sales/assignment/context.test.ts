import { describe, expect, it } from "vitest";
import { ASSIGNMENT_FIELD_KEYS, buildAssignmentContext } from "./context";

const attribution = {
  version: 2,
  first_touch: { source: "google", medium: "organic_social", campaign: "marzo", occurred_at: "2026-03-01T00:00:00Z" },
  last_touch: { source: "instagram", medium: "paid_social", campaign: "Jose-Reels-Oct", content: "Reel 3", ad_id: "123", occurred_at: "2026-10-07T00:00:00Z" },
};

describe("buildAssignmentContext", () => {
  it("expone first_* y last_* de cada campo del toque canónico", () => {
    const ctx = buildAssignmentContext({ attribution });
    expect(ctx.first_source).toBe("google");
    expect(ctx.last_source).toBe("instagram");
    expect(ctx.last_campaign).toBe("Jose-Reels-Oct");
    expect(ctx.last_ad_id).toBe("123");
    expect(ctx.first_ad_id).toBe("");
  });

  it("first_combined y last_combined: fuente|medio|campaña|contenido|término en minúsculas", () => {
    const ctx = buildAssignmentContext({ attribution });
    expect(ctx.last_combined).toBe("instagram|paid_social|jose-reels-oct|reel 3|");
    expect(ctx.first_combined).toBe("google|organic_social|marzo||");
  });

  it("una atribución en la forma vieja produce first_source (de readAttribution) y NO first_utm_source", () => {
    const ctx = buildAssignmentContext({ attribution: { first_click: { utm_source: "ig", utm_campaign: "vieja" } } });
    expect(ctx.first_source).toBe("instagram");
    expect(ctx.first_campaign).toBe("vieja");
    expect(Object.keys(ctx)).not.toContain("first_utm_source");
  });

  it("sin atribución todo está vacío (así is_empty funciona)", () => {
    const ctx = buildAssignmentContext({ attribution: null });
    expect(ctx.first_source).toBe("");
    expect(ctx.last_combined).toBe("");
  });

  it("país, canal, tiene email y tiene teléfono", () => {
    const ctx = buildAssignmentContext(
      { attribution: null, country: " CR ", email: "a@b.co", phone: null, whatsapp_phone: "+50688887777" },
      { channel: "instagram" },
    );
    expect(ctx).toMatchObject({ country: "CR", channel: "instagram", has_email: "true", has_phone: "true" });
    expect(buildAssignmentContext({ attribution: null, email: " ", phone: "" })).toMatchObject({ has_email: "false", has_phone: "false" });
  });

  it("todas las claves del constructor existen en el contexto", () => {
    const ctx = buildAssignmentContext({ attribution });
    for (const key of ASSIGNMENT_FIELD_KEYS) expect(ctx, key).toHaveProperty(key);
  });
});
