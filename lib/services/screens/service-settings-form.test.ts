// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { serviceSettingsForm, toServiceSettings } from "./service-settings-form";
import { validateServiceSettings } from "../settings";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";

const CREATE = {
  v: 1,
  mode: "create",
  when: { rule: "percent", value: 50, enabled_at: "2026-11-01T00:00:00Z" },
  confirm: true,
  start: "sale_date",
  owner: { mode: "round_robin", members: [U1, U2], fallback_user_id: U1 },
  renewal: "ask",
  light: { overdue_red_days: 10 },
  overdue_cut: { enabled: true, days: 20, restore: false },
};

const EXTEND = {
  v: 1,
  mode: "extend",
  when: { rule: "any_payment" },
  extend: { target_variant_ids: null, n: 3, unit: "months", extend_accesses: true, if_no_service: "confirm", fallback_variant_id: V1 },
};

describe("serviceSettingsForm <-> toServiceSettings", () => {
  it("crea: ida y vuelta sin perder nada", () => {
    expect(toServiceSettings(serviceSettingsForm(CREATE))).toEqual(CREATE);
  });

  it("extiende: ida y vuelta sin perder nada", () => {
    expect(toServiceSettings(serviceSettingsForm(EXTEND))).toEqual(EXTEND);
  });

  it("no crea: una variante sin configurar es none y guarda {}", () => {
    const f = serviceSettingsForm({});
    expect(f.mode).toBe("none");
    expect(toServiceSettings(f)).toEqual({});
  });

  it("cambiar de modo y volver no pierde lo escrito", () => {
    const f = serviceSettingsForm(CREATE);
    const back = toServiceSettings({ ...{ ...f, mode: "extend" as const }, mode: "create" });
    expect(back).toEqual(CREATE);
  });

  it("solo manda las claves del modo elegido", () => {
    const f = { ...serviceSettingsForm(CREATE), mode: "extend" as const, fallbackVariantId: V1 };
    const out = toServiceSettings(f) as Record<string, unknown>;
    expect(out.owner).toBeUndefined();
    expect(out.renewal).toBeUndefined();
    expect(out.extend).toBeDefined();
  });

  it("una persona fija guarda user_id y no members", () => {
    const f = { ...serviceSettingsForm(CREATE), ownerMode: "fixed" as const, ownerUserId: U2 };
    expect(toServiceSettings(f).owner).toEqual({ mode: "fixed", user_id: U2, fallback_user_id: U1 });
  });

  it("lo que arma el formulario pasa la validacion gemela de la base", () => {
    expect(validateServiceSettings(toServiceSettings(serviceSettingsForm(CREATE)))).toEqual([]);
    expect(validateServiceSettings(toServiceSettings(serviceSettingsForm(EXTEND)))).toEqual([]);
  });

  it("un numero mal escrito no se convierte en un valor valido: lo rechaza la validacion", () => {
    const f = { ...serviceSettingsForm(EXTEND), extendN: "tres" };
    expect(validateServiceSettings(toServiceSettings(f)).length).toBeGreaterThan(0);
  });
});
