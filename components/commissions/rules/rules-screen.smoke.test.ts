import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildRuleViews } from "@/lib/commissions/rules-view";
import { defaultCommissionRoles } from "@/lib/commissions/roles";
import type { RulesViewData } from "@/lib/commissions/rules-ui-load";
import type { CommissionRule } from "@/lib/commissions/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/dashboard/finanzas/comisiones/reglas",
}));
vi.mock("@/lib/actions/commission-rules", () => ({
  updateCommissionRoles: async () => ({ ok: true }),
  createCommissionRule: async () => ({ ok: true }),
  updateCommissionRule: async () => ({ ok: true }),
  duplicateCommissionRule: async () => ({ ok: true }),
  setCommissionRuleActive: async () => ({ ok: true }),
  archiveCommissionRule: async () => ({ ok: true }),
  reorderCommissionRules: async () => ({ ok: true }),
  previewCommissions: async () => ({ ok: false, error: "x" }),
}));
vi.mock("@/lib/actions/commission-rules-lookup", () => ({
  searchSalesForCommissionTest: async () => [],
  loadSalePaymentsForCommissionTest: async () => ({ ok: true, payments: [] }),
  searchPiecesForCommissionRule: async () => [],
  searchMetaForCommissionRule: async () => [],
}));

const { RulesScreen } = await import("./rules-screen");

const ANA = "33333333-3333-4333-8333-333333333333";
const PROD = "98888888-8888-4888-8888-888888888881";

const rule = (n: number, over: Partial<CommissionRule> = {}): CommissionRule => ({
  id: `d${n}000000-0000-4000-8000-000000000000`, name: `Regla ${n}`, role: "vendedor", position: n, conditions: {}, calc_type: "percent", rate: 8, fixed_amount: null, base: "gross",
  beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, ...over,
});

function data(over: Partial<RulesViewData> = {}, rules: CommissionRule[] = []): RulesViewData {
  const roles = over.roles ?? defaultCommissionRoles();
  const lookups = { roles: Object.fromEntries(roles.map((r) => [r.key, r.name])), products: { [PROD]: "Mentoría" }, people: { [ANA]: "Ana" } };
  return {
    access: "manage",
    roles,
    rules: buildRuleViews(roles, rules, lookups, "2026-10-15"),
    lookups,
    editor: {
      products: [{ id: PROD, name: "Mentoría", status: "active", archived: false }],
      variants: [],
      members: [{ id: ANA, name: "Ana" }],
      methods: [{ key: "whop", name: "Whop", active: true }],
      utm: { source: ["instagram"], medium: [], campaign: [], content: [], term: [] },
    },
    today: "2026-10-15",
    tz: "UTC",
    loadError: false,
    updatedAt: {},
    ...over,
  };
}

const render = (d: RulesViewData, role: string | null = "vendedor") => renderToStaticMarkup(createElement(RulesScreen, { data: d, initialRole: role }));

describe("RulesScreen (render de servidor)", () => {
  const rules = [
    rule(1),
    rule(2, { conditions: { product_ids: [PROD] }, name: "Mentoría" }),
    rule(3, { is_active: false, name: "Pausada" }),
    rule(4, { valid_until: "2026-01-01", name: "Vieja" }),
    rule(5, { role: "pauta", position: 1, name: "Pauta sin persona", beneficiary_user_id: null }),
  ];

  it("quien administra ve pestañas, frases, estados, avisos y los botones", () => {
    const html = render(data({}, rules));
    expect(html).toContain("Reglas de comisión");
    for (const text of ["Vendedor", "Setter", "Contenido", "Pauta"]) expect(html).toContain(text);
    expect(html).toContain("Vendedor · Mentoría · 8 % del cobrado");
    expect(html).toContain(">Activa<");
    expect(html).toContain(">Pausada<");
    expect(html).toContain(">Vencida<");
    expect(html).toContain("Nunca se usa");
    expect(html).toContain("Nueva regla");
    expect(html).toContain("Probar con una venta");
    expect(html).toContain("Alt + flecha arriba o abajo");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="tablist"');
  });

  it("la pestaña de un rol de persona fija avisa de la regla sin persona", () => {
    expect(render(data({}, rules), "pauta")).toContain("Esta regla no genera comisiones: falta la persona");
  });

  it("un rol sin reglas dice que nadie cobra como ese rol y ofrece crear la primera", () => {
    const html = render(data({}, rules), "setter");
    expect(html).toContain("Sin reglas de Setter: nadie cobra comisión como Setter");
    expect(html).toContain("Crear regla");
  });

  it("en solo lectura no hay botones de cambio y se avisa", () => {
    const html = render(data({ access: "read" }, rules));
    expect(html).toContain("Tenés acceso de lectura");
    for (const text of ["Nueva regla", "Probar con una venta", ">Editar", "Duplicar", "Archivar", "Alt + flecha"]) expect(html).not.toContain(text);
    expect(html).toContain("Vendedor · Mentoría · 8 % del cobrado");
  });

  it("sin roles activos lo dice y, a quien administra, le ofrece activar uno", () => {
    const off = defaultCommissionRoles().map((r) => ({ ...r, active: false }));
    const html = render(data({ roles: off }), null);
    expect(html).toContain("No hay roles de comisión activos");
    expect(html).toContain("Activá uno desde");
  });

  it("si falló la carga, lo dice con un botón para reintentar", () => {
    const html = render(data({ loadError: true }));
    expect(html).toContain("No pudimos cargar las reglas de comisión");
    expect(html).toContain("Reintentar");
  });
});
