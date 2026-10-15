import { describe, expect, it } from "vitest";
import { autoCloseDaysError, buildMetaRows, buildProcessorRows, changedInputs, isAutoDirty, NO_FEE_NOTE, ONLY_USD_NOTE } from "./auto-card";
import type { AutoExpenseSetting } from "./settings";

const methods = [
  { key: "whop", name: "Whop (registrado a mano)", active: true, fee_percent: 2.9, fee_fixed: 0.3 },
  { key: "transfer", name: "Transferencia", active: true, fee_percent: 0, fee_fixed: 0 },
  { key: "old", name: "Viejo", active: false, fee_percent: 3, fee_fixed: 0 },
  { key: "old_on", name: "Viejo prendido", active: false, fee_percent: 3, fee_fixed: 0 },
];
const on = (over: Partial<AutoExpenseSetting> = {}): AutoExpenseSetting => ({ enabled: true, vendor_id: null, category_key: null, charge_mode: "automatic", ...over });

describe("buildProcessorRows", () => {
  it("una fila por método activo; un desactivado solo si todavía tiene un automático encendido", () => {
    const rows = buildProcessorRows(methods, { old_on: on() });
    expect(rows.map((r) => r.key)).toEqual(["whop", "transfer", "old_on"]);
    expect(rows[2].note).toMatch(/desactivado/);
  });

  it("un método sin comisión en Ventas lo aclara, pero se puede encender", () => {
    const row = buildProcessorRows(methods, {}).find((r) => r.key === "transfer")!;
    expect(row.note).toBe(NO_FEE_NOTE);
    expect(row.locked).toBe(false);
  });

  it("lee lo guardado y arma el nombre del proveedor sin el paréntesis", () => {
    const row = buildProcessorRows(methods, { whop: on({ charge_mode: "manual", category_key: "software", vendor_id: "v1" }) })[0];
    expect(row).toMatchObject({ enabled: true, chargeMode: "manual", categoryKey: "software", vendorId: "v1", vendorDefaultName: "Whop" });
  });

  it("sin nada guardado: apagado, se descuenta solo, sin categoría ni proveedor", () => {
    expect(buildProcessorRows(methods, {})[0]).toMatchObject({ enabled: false, chargeMode: "automatic", categoryKey: null, vendorId: null });
  });
});

describe("buildMetaRows", () => {
  const accounts = [{ id: "act_1", name: "USD", currency: "USD" }, { id: "act_2", name: "EUR", currency: "EUR" }, { id: "act_3", name: "Sin moneda", currency: null }];

  it("las que no están en USD quedan bloqueadas con «Solo USD por ahora»", () => {
    const rows = buildMetaRows(accounts, {});
    expect(rows.map((r) => r.locked)).toEqual([false, true, true]);
    expect(rows[1].lockedReason).toBe(ONLY_USD_NOTE);
    expect(rows[0].vendorDefaultName).toBe("Meta");
  });

  it("una no-USD que ya estaba encendida se puede apagar", () => {
    expect(buildMetaRows(accounts, { act_2: on() })[1].locked).toBe(false);
  });
});

describe("changedInputs", () => {
  it("manda solo las filas que cambiaron", () => {
    const base = buildProcessorRows(methods, {});
    const edited = base.map((r) => (r.key === "whop" ? { ...r, enabled: true, categoryKey: "software" } : r));
    expect(changedInputs(edited, base)).toEqual([{ key: "whop", enabled: true, chargeMode: "automatic", categoryKey: "software", vendorId: null }]);
    expect(changedInputs(base, base)).toEqual([]);
  });

  it("apagar una fila encendida también se manda", () => {
    const base = buildProcessorRows(methods, { whop: on() });
    const edited = base.map((r) => (r.key === "whop" ? { ...r, enabled: false } : r));
    expect(changedInputs(edited, base)).toHaveLength(1);
  });
});

describe("isAutoDirty", () => {
  const p = buildProcessorRows(methods, {});
  const base = { processor: p, meta: [], days: "3" };
  it("sin cambios no está sucio; cambiar los días sí", () => {
    expect(isAutoDirty(base, base)).toBe(false);
    expect(isAutoDirty({ ...base, days: "5" }, base)).toBe(true);
    expect(isAutoDirty({ ...base, processor: p.map((r) => ({ ...r, enabled: true })) }, base)).toBe(true);
  });
});

describe("autoCloseDaysError", () => {
  it("acepta 0 a 10 y rechaza lo demás", () => {
    expect(autoCloseDaysError("0")).toBeNull();
    expect(autoCloseDaysError("10")).toBeNull();
    expect(autoCloseDaysError("11")).toMatch(/0 a 10/);
    expect(autoCloseDaysError("")).toMatch(/0 a 10/);
    expect(autoCloseDaysError("2,5")).toMatch(/0 a 10/);
    expect(autoCloseDaysError("-1")).toMatch(/0 a 10/);
  });
});
