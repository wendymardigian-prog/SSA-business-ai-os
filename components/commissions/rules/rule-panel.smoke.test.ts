import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultCommissionRoles } from "@/lib/commissions/roles";
import { draftFromRule, emptyRuleDraft } from "@/lib/commissions/rules-ui-draft";
import type { CommissionRule } from "@/lib/commissions/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/" }));
vi.mock("@/lib/actions/commission-rules", () => ({
  updateCommissionRoles: async () => ({ ok: true }),
  createCommissionRule: async () => ({ ok: true }),
  updateCommissionRule: async () => ({ ok: true }),
  previewCommissions: async () => ({ ok: false, error: "x" }),
}));
vi.mock("@/lib/actions/commission-rules-lookup", () => ({
  searchSalesForCommissionTest: async () => [],
  loadSalePaymentsForCommissionTest: async () => ({ ok: true, payments: [] }),
  searchPiecesForCommissionRule: async () => [],
  searchMetaForCommissionRule: async () => [],
}));

const { RulePanel } = await import("./rule-panel");
const { RolesDialog } = await import("./roles-dialog");

const ANA = "33333333-3333-4333-8333-333333333333";
const PROD = "98888888-8888-4888-8888-888888888881";
const roles = Object.fromEntries(defaultCommissionRoles().map((r) => [r.key, r]));
const editor = {
  products: [{ id: PROD, name: "Mentoría", status: "active", archived: false }],
  variants: [{ id: "v1", productId: PROD, name: "Mensual", archived: false }],
  members: [{ id: ANA, name: "Ana" }],
  methods: [{ key: "whop", name: "Whop", active: true }],
  utm: { source: ["instagram", "tiktok"], medium: [], campaign: [], content: [], term: [] },
};
const lookups = { roles: { vendedor: "Vendedor" }, products: { [PROD]: "Mentoría" }, people: { [ANA]: "Ana" } };

const rule: CommissionRule = {
  id: "d1000000-0000-4000-8000-000000000000", name: "Vendedor 12 %", role: "vendedor", position: 1,
  conditions: { product_ids: [PROD], utm: { campaign: { op: "contains", values: ["webinar"] } } }, calc_type: "percent", rate: 12, fixed_amount: null, base: "net_of_fees",
  beneficiary_user_id: null, hold_days: 7, valid_from: "2026-11-01", valid_until: null, is_active: true, archived_at: null,
};

const panel = (initial: ReturnType<typeof emptyRuleDraft>, role = roles.vendedor) =>
  renderToStaticMarkup(createElement(RulePanel, { role, initial, savedRules: [rule], editor, lookups, position: 1, returnFocus: { current: null }, onClose: () => undefined, onSaved: () => undefined }));

describe("RulePanel (render de servidor)", () => {
  it("una regla nueva: secciones, campos y botones", () => {
    const html = panel(emptyRuleDraft(roles.vendedor, 0));
    for (const text of ["Nueva regla de Vendedor", "Venta", "Pago", "Origen", "Cuánto se paga", "A quién se le paga", "Retención y vigencia", "Probar esta regla", "Crear regla", "Así se lee la regla"]) expect(html).toContain(text);
    for (const text of ["Fuente (utm_source)", "Medio (utm_medium)", "Campaña (utm_campaign)", "Contenido (utm_content)", "Término (utm_term)", "Campaña de Meta", "Anuncio de Meta", "Pieza puntual", "Número de pago", "Monto de la venta"]) expect(html).toContain(text);
    expect(html).toContain("+ instagram");
    expect(html).toContain("El vendedor de la venta (por defecto)");
  });

  it("editar: trae lo guardado y la frase en vivo", () => {
    const html = panel(draftFromRule(rule, "2026-10-01T00:00:00Z"));
    expect(html).toContain("Editar regla");
    expect(html).toContain("Guardar cambios");
    expect(html).toContain("Vendedor · Mentoría · campaña contiene «webinar» · 12 % del neto · retiene 7 días · desde el 1/11");
    expect(html).toContain('value="Vendedor 12 %"');
  });

  it("un rol de persona fija pide la persona", () => {
    const html = panel(emptyRuleDraft(roles.pauta, 0), roles.pauta);
    expect(html).toContain("Elegí una persona");
    expect(html).toContain("Este rol es de una persona fija");
  });

  it("la primera regla de Contenido se propone orgánica", () => {
    const html = panel(emptyRuleDraft(roles.contenido, 0), roles.contenido);
    expect(html).toContain("Quitar canal: Orgánico");
  });
});

describe("RolesDialog (render de servidor)", () => {
  it("lista los roles con a quién se le paga, su estado y cuántas reglas tienen", () => {
    const html = renderToStaticMarkup(createElement(RolesDialog, { roles: defaultCommissionRoles(), ruleCounts: { vendedor: 2, setter: 1 }, onClose: () => undefined }));
    for (const text of ["Roles de comisión", "El vendedor de la venta", "El responsable de la pieza", "Una persona fija", "Precargado", "2 reglas", "1 regla", "Sin reglas", "Crear un rol", "Agregar rol", "Guardar roles"]) expect(html).toContain(text);
  });
});
