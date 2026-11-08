// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { copySectionsTo, portalRows, readVariantPortal, setEnabled, setIncluded, setRule } from "./variant-portal-form";
import { validateVariantPortalSettings } from "@/lib/portal-admin/settings";

describe("la pestaña Portal de la variante", () => {
  it("una variante sin configurar: sin acceso, ninguna sección incluida, todas prendidas en el programa", () => {
    const rows = portalRows({}, {});
    expect(readVariantPortal({}).enabled).toBe(false);
    expect(rows.every((r) => !r.included && r.inProgram)).toBe(true);
    expect(rows.map((r) => r.section)).toContain("program");
  });

  it("En el programa sale del producto y vale para todas las variantes", () => {
    const rows = portalRows({}, { sections: { community: false } });
    expect(rows.find((r) => r.section === "community")?.inProgram).toBe(false);
  });

  it("incluir y sacar conserva la regla", () => {
    let s = setIncluded({}, "calendar", true);
    s = setRule(s, "calendar", { opens: { type: "days_after_start", days: 7 } });
    s = setIncluded(s, "calendar", false);
    s = setIncluded(s, "calendar", true);
    const row = portalRows(s, {}).find((r) => r.section === "calendar")!;
    expect(row.included).toBe(true);
    expect(row.opensLabel).toBe("7 días después del inicio");
  });

  it("las etiquetas de cuándo se abre, hasta cuándo y límites", () => {
    let s = setRule({}, "assistant", { ai_limit_usd: 5, until: { type: "months", n: 3 } });
    s = setRule(s, "community", { limits: { community_can_post: false } });
    const rows = portalRows(s, {});
    expect(rows.find((r) => r.section === "assistant")).toMatchObject({ untilLabel: "3 meses", limitsLabel: "Hasta USD 5 por mes", opensLabel: "Al empezar el servicio" });
    expect(rows.find((r) => r.section === "community")?.limitsLabel).toBe("Solo lee");
  });

  it("lo que arma la pestaña pasa la validacion gemela de la base", () => {
    let s = setEnabled({}, true);
    s = setIncluded(s, "program", true);
    s = setRule(s, "calendar", { opens: { type: "fixed_date", date: "2027-01-10" }, until: { type: "forever" } });
    expect(validateVariantPortalSettings(s)).toEqual([]);
  });

  it("copiar a otra variante copia secciones y reglas, no el acceso", () => {
    const from = setRule(setEnabled({}, true), "program", { content: { modules: "all" } });
    const to = copySectionsTo(from, { enabled: false });
    expect(to.enabled).toBe(false);
    expect(to.sections).toEqual(from.sections);
  });
});
