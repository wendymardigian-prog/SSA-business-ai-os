import { describe, expect, it } from "vitest";
import cases from "./metric-crossed.cases.json";
import { metricConfigProblems, metricCrossed, metricFlowVariables, metricOccurrence, metricSummary, thresholdInBaseUnits } from "./metric-trigger";
import { serviceEventMatches } from "./automation";

describe("«Una cifra del estudiante llega a…» (casos compartidos con svc_metric_crossed)", () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      expect(metricCrossed(c.before, c.after, c.threshold)).toBe(c.crossed);
    });
  }

  it("valida la cifra y el número", () => {
    expect(metricConfigProblems({ metric: "points", threshold: 500 })).toEqual([]);
    expect(metricConfigProblems({ metric: "revenue", threshold: 1000 })).toEqual([]);
    expect(metricConfigProblems({ metric: "real_projects", threshold: 1 })).toEqual([]);
    expect(metricConfigProblems({})).toHaveLength(2);
    expect(metricConfigProblems({ metric: "leads", threshold: 10 })).toEqual(["Elegí qué cifra se mira."]);
    expect(metricConfigProblems({ metric: "points", threshold: 0 })).toHaveLength(1);
    expect(metricConfigProblems({ metric: "points", threshold: 2.5 })).toHaveLength(1);
  });

  it("la facturación va en centavos en la base; lo demás igual", () => {
    expect(thresholdInBaseUnits("revenue", 1000)).toBe(100000);
    expect(thresholdInBaseUnits("points", 500)).toBe(500);
    expect(metricOccurrence("points", 500)).toBe("metric:points:500");
  });

  it("resumen y variables del evento", () => {
    expect(metricSummary({ metric: "points", threshold: 1500 })).toBe("Puntos del programa llega a 1.500");
    expect(metricSummary({})).toBe("Elegí la cifra y el número");
    const v = metricFlowVariables({ metric: "revenue", threshold: 1000, value: 1200.5 });
    expect(v.cifra).toEqual({ nombre: "Facturación cargada", meta: "1000", valor: "1200.5" });
    expect(v["cifra.meta"]).toBe("1000");
  });
});

describe("los eventos para UNA automatización se comparan por `flow_id`", () => {
  const payload = { flow_id: "f1", trigger_id: "t-viejo", service_id: "s1", product_id: "p1" };
  it("pasa la automatización del evento aunque su fila se haya recreado al republicar", () => {
    expect(serviceEventMatches({}, payload, "t-nuevo", "f1")).toBe(true);
  });
  it("otra automatización, o sin automatización, no", () => {
    expect(serviceEventMatches({}, payload, "t-viejo", "f2")).toBe(false);
    expect(serviceEventMatches({}, payload, "t-viejo", null)).toBe(false);
  });
  it("los de A4 (solo `trigger_id`) siguen por la fila", () => {
    expect(serviceEventMatches({}, { trigger_id: "t1" }, "t1", "f9")).toBe(true);
    expect(serviceEventMatches({}, { trigger_id: "t1" }, "t2", "f9")).toBe(false);
  });
});
