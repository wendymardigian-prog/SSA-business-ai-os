import { describe, expect, it } from "vitest";
import { countNewRunFilters, isRunDetailFilter, pickRuleFilter, ruleFilterOptions, runDetailQuery } from "./runs-filters";

describe("pickRuleFilter", () => {
  it("acepta una regla que existe", () => {
    expect(pickRuleFilter("r3", ["r1", "r3"])).toBe("r3");
  });
  it("descarta una que no existe", () => {
    expect(pickRuleFilter("r9", ["r1"])).toBe("");
  });
  it("acepta la accion por defecto, que no es una regla", () => {
    expect(pickRuleFilter("default", [])).toBe("default");
  });
  it("vacio es vacio", () => {
    expect(pickRuleFilter("", ["r1"])).toBe("");
  });
});

describe("runDetailQuery", () => {
  it("el detalle se busca con like: status_detail lleva varias notas separadas por coma", () => {
    expect(runDetailQuery("external_cooldown", "")).toEqual({
      statusDetailLike: "%external_cooldown%",
      routingRuleId: null,
      routingRuleIsNull: false,
    });
  });

  it("'lo decidio una regla' busca el prefijo, porque el id va pegado detras", () => {
    expect(runDetailQuery("rule", "").statusDetailLike).toBe("%rule:%");
  });

  it("un detalle inventado no filtra nada (no se manda a la base)", () => {
    expect(runDetailQuery("../../etc/passwd", "").statusDetailLike).toBeNull();
  });

  it("la regla filtra por el routing", () => {
    expect(runDetailQuery("", "r3")).toMatchObject({ routingRuleId: "r3", routingRuleIsNull: false });
  });

  it("la accion por defecto es routing con regla nula", () => {
    expect(runDetailQuery("", "default")).toMatchObject({ routingRuleId: null, routingRuleIsNull: true });
  });

  it("los dos filtros se combinan", () => {
    expect(runDetailQuery("already_answered", "r1")).toEqual({
      statusDetailLike: "%already_answered%",
      routingRuleId: "r1",
      routingRuleIsNull: false,
    });
  });
});

describe("isRunDetailFilter", () => {
  it("solo los cuatro conocidos", () => {
    expect(isRunDetailFilter("external_cooldown")).toBe(true);
    expect(isRunDetailFilter("cualquiera")).toBe(false);
  });
});

describe("ruleFilterOptions", () => {
  it("se leen como oraciones, nunca el id", () => {
    const options = ruleFilterOptions([{ id: "r1", name: "botón conocido" }, { id: "r2", name: null }]);
    expect(options[0]).toEqual({ value: "r1", label: "Regla 1 · botón conocido" });
    expect(options[1].label).toBe("Regla 2");
    expect(options.every((o) => !o.label.includes("r1") && !o.label.includes("r2"))).toBe(true);
  });

  it("siempre ofrece la accion por defecto", () => {
    expect(ruleFilterOptions([]).map((o) => o.value)).toEqual(["default"]);
  });
});

describe("countNewRunFilters", () => {
  it("cuenta los dos", () => {
    expect(countNewRunFilters("", "")).toBe(0);
    expect(countNewRunFilters("rule", "")).toBe(1);
    expect(countNewRunFilters("rule", "r1")).toBe(2);
  });
});
