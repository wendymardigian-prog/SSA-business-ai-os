import { describe, it, expect } from "vitest";
import { FORM_FLOW_TEMPLATES, templatesForType, formTemplateGraph, blankFormFlowGraph, nextAutomationName, formFlowName, formTemplateByKey, templateQuestions, numberThresholds } from "./templates";
import { describeTree, flowToTree, treeToFlow } from "@/lib/automations/step-tree";
import { explainPaths } from "@/lib/automations/explain-paths";
import { prepareTreeSave } from "@/lib/automations/step-tree-save";
import { summarizeFlow } from "@/lib/automations/flow-summary";
import { flowToLinear, linearToFlow } from "@/lib/scheduling/automation/linear-flow";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import { resolveNodeType } from "@/lib/flow-engine/registry";
import "@/lib/flow-engine/registry";

const form = (type: "custom" | "survey" | "contract" = "custom") => ({ id: "11111111-1111-4111-8111-111111111111", name: "Aplicación", type });
const ctx = (type: "custom" | "survey" | "contract" = "custom") => ({ form: form(type), userEmail: "yo@ejemplo.com", tagName: "calificado" });

describe("plantillas de formulario", () => {
  it("la de detractor solo se ofrece para encuestas", () => {
    expect(templatesForType("custom").map((t) => t.key)).not.toContain("detractor_alert");
    expect(templatesForType("survey").map((t) => t.key)).toContain("detractor_alert");
  });

  it.each(FORM_FLOW_TEMPLATES.map((t) => [t.key] as const))("%s es lineal y vuelve igual", (key) => {
    const type = key === "detractor_alert" ? "survey" : "custom";
    const { nodes, edges } = formTemplateGraph(key, ctx(type));
    const linear = flowToLinear(nodes, edges);
    expect(linear, "tiene que poder verse como lista").not.toBeNull();
    const back = linearToFlow(linear!);
    const again = flowToLinear(back.nodes, back.edges)!;
    expect(again.steps).toEqual(linear!.steps);
    expect(again.trigger.type).toBe(type === "survey" ? "survey_answered" : "form_submitted");
  });

  it("todos los nodos de las plantillas están en el registro (con otro nombre el motor no los corre)", () => {
    for (const t of FORM_FLOW_TEMPLATES) {
      const type = t.key === "detractor_alert" ? "survey" : "custom";
      for (const node of formTemplateGraph(t.key, ctx(type)).nodes) {
        if (node.type === "trigger") continue;
        expect(resolveNodeType(node as never), `${t.key}: ${node.type}`).toBeTruthy();
      }
    }
  });

  it("el trigger se guarda con el formulario y el tipo correctos", () => {
    const { nodes } = formTemplateGraph("notify_me_email", ctx("contract"));
    const rows = buildDesiredTriggers(nodes as never, "flow-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("contract_signed");
    expect(rows[0].config).toEqual({ form_ids: [form().id] });
  });

  it("notify_me_email nace con to: fixed y el email de quien la crea", () => {
    const { nodes } = formTemplateGraph("notify_me_email", ctx());
    expect(nodes.find((n) => n.id === "step-1")?.data).toMatchObject({ actionType: "send_email", to: "fixed", fixedEmail: "yo@ejemplo.com" });
  });

  it("detractor_alert filtra por detractores y avisa por email", () => {
    const { nodes } = formTemplateGraph("detractor_alert", ctx("survey"));
    const rows = buildDesiredTriggers(nodes as never, "flow-1");
    expect(rows[0].type).toBe("survey_answered");
    expect(rows[0].config).toMatchObject({ nps_categories: ["detractor"] });
  });

  it("add_tag lleva el tag elegido", () => {
    expect(formTemplateGraph("add_tag", ctx()).nodes.find((n) => n.id === "step-1")?.data).toMatchObject({ actionType: "addTag", tagName: "calificado" });
  });

  it("la automatización en blanco es solo el trigger del tipo del formulario", () => {
    const graph = blankFormFlowGraph(form("survey"));
    expect(graph.edges).toEqual([]);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].data).toMatchObject({ triggerType: "survey_answered", form_ids: [form().id] });
  });

  it("los nombres no chocan", () => {
    expect(formFlowName("Aplicación", "Algo")).toBe("Aplicación · Algo");
    expect(nextAutomationName("A", [])).toBe("A · Automatización 1");
    expect(nextAutomationName("A", ["A · Automatización 2"])).toBe("A · Automatización 3");
    expect(formTemplateByKey("nada")).toBeUndefined();
  });
});

// ------------------------------------------------------------
// "Email distinto según una respuesta"
// ------------------------------------------------------------

describe("plantilla «Email distinto según una respuesta»", () => {
  const FACT = ["Menos de USD 1.000", "USD 1.000 a USD 10.000", "Más de USD 10.000"];
  const seeded = () => {
    let n = 0;
    return () => {
      n = (n * 9301 + 49297) % 233280;
      return n / 233280;
    };
  };
  const selectQ = { key: "facturacion", label: "Facturación", type: "single_select" as const, options: FACT };
  const npsQ = { key: "nota", label: "Nota", type: "nps" as const, min: 0, max: 10 };
  const buildGraph = (question: typeof selectQ | typeof npsQ, type: "custom" | "survey" | "contract" = "custom") =>
    formTemplateGraph("email_by_answer", { ...ctx(type), question, random: seeded() });
  const emails = <T extends { type: string; data?: Record<string, unknown> }>(nodes: T[]): T[] => nodes.filter((n) => n.type === "action" && n.data?.actionType === "send_email");

  it("se ofrece a los tres tipos de formulario y pide una pregunta", () => {
    for (const type of ["custom", "survey", "contract"] as const) {
      expect(templatesForType(type).map((t) => t.key)).toContain("email_by_answer");
    }
    expect(formTemplateByKey("email_by_answer")).toMatchObject({ needsQuestion: true, name: "Email distinto según una respuesta" });
  });

  it("las plantillas lineales de siempre no cambian: siguen siendo las cuatro", () => {
    expect(FORM_FLOW_TEMPLATES.map((t) => t.key)).toEqual(["notify_me_email", "thank_you_message", "add_tag", "detractor_alert"]);
  });

  it("sin pregunta no hay plantilla", () => {
    expect(() => formTemplateGraph("email_by_answer", ctx())).toThrow(/pregunta/);
  });

  describe("con una pregunta de selección", () => {
    it("arma un Condiciones con un camino por cada una de las dos primeras opciones y tres emails vacíos", () => {
      const { nodes, edges } = buildGraph(selectQ);
      const branch = nodes.find((n) => n.type === "branch")!;
      const paths = (branch.data as { paths: Array<{ id: string; label: string; conditions: unknown[] }> }).paths;
      expect(paths.map((p) => p.label)).toEqual([FACT[0], FACT[1]]);
      expect(paths[0].conditions).toEqual([{ field: "answer.facturacion", operator: "is", value: FACT[0], valueType: "single_select" }]);
      expect(paths[1].conditions).toEqual([{ field: "answer.facturacion", operator: "is", value: FACT[1], valueType: "single_select" }]);
      expect(emails(nodes)).toHaveLength(3);
      for (const email of emails(nodes)) expect(email.data).toMatchObject({ actionType: "send_email", to: "contact", subject: "", body: "" });
      expect(nodes.filter((n) => n.type === "trigger")).toHaveLength(1);
      expect(edges).toHaveLength(4);
    });

    it("las salidas del Condiciones son sus caminos y «Si no», cada una a su email", () => {
      const { nodes, edges } = buildGraph(selectQ);
      const branch = nodes.find((n) => n.type === "branch")!;
      const pathIds = (branch.data as { paths: Array<{ id: string }> }).paths.map((p) => p.id);
      const fromBranch = edges.filter((e) => e.source === branch.id);
      expect(fromBranch.map((e) => e.sourceHandle).sort()).toEqual([...pathIds, "else"].sort());
      const emailIds = new Set(emails(nodes).map((n) => n.id));
      for (const e of fromBranch) expect(emailIds.has(e.target)).toBe(true);
      // Tres salidas, tres emails distintos.
      expect(new Set(fromBranch.map((e) => e.target)).size).toBe(3);
      // Ningun camino se llama como una salida que el motor ya conoce.
      for (const id of pathIds) expect(["else", "true", "false", "yes", "no"]).not.toContain(id);
    });

    it("el disparador es el del tipo del formulario, atado a ESTE formulario", () => {
      expect(buildGraph(selectQ, "survey").nodes.find((n) => n.type === "trigger")?.data).toMatchObject({ triggerType: "survey_answered", form_ids: [form().id] });
      expect(buildGraph(selectQ, "contract").nodes.find((n) => n.type === "trigger")?.data).toMatchObject({ triggerType: "contract_signed" });
    });

    it("el nodo lleva el nombre de la pregunta", () => {
      expect(buildGraph(selectQ).nodes.find((n) => n.type === "branch")?.data).toMatchObject({ label: "Facturación" });
    });

    it("el motor lo sigue: cada respuesta va a su email", () => {
      const graph = buildGraph(selectQ);
      const tree = flowToTree(graph.nodes, graph.edges)!;
      const where = (answer: string) => explainPaths(tree, { "answer.facturacion": answer }, []).branches[0].takenLabel;
      expect(where(FACT[0])).toBe(FACT[0]);
      expect(where(FACT[1])).toBe(FACT[1]);
      // La tercera opcion no tiene camino propio: va por «Si no».
      expect(where(FACT[2])).toBe("Si no");
    });
  });

  describe("con una pregunta numérica", () => {
    it("arma dos umbrales: el primero «alto» y el segundo «bajo» (gana el primero que se cumple)", () => {
      const { nodes } = buildGraph(npsQ);
      const paths = (nodes.find((n) => n.type === "branch")!.data as { paths: Array<{ label: string; conditions: Array<Record<string, unknown>> }> }).paths;
      expect(paths[0].conditions[0]).toEqual({ field: "answer.nota", operator: "gte", value: "7", valueType: "number" });
      expect(paths[1].conditions[0]).toEqual({ field: "answer.nota", operator: "gte", value: "3", valueType: "number" });
      expect(paths[0].label).toBe("Alto: 7 o más");
      expect(paths[1].label).toBe("Medio: 3 o más");
      expect(emails(nodes)).toHaveLength(3);
    });

    it("reparte tres rangos: alto, medio y «Si no»", () => {
      const graph = buildGraph(npsQ);
      const tree = flowToTree(graph.nodes, graph.edges)!;
      const where = (value: number | null) => explainPaths(tree, { "answer.nota": value }, []).branches[0].takenLabel;
      expect(where(10)).toBe("Alto: 7 o más");
      expect(where(7)).toBe("Alto: 7 o más");
      expect(where(6)).toBe("Medio: 3 o más");
      expect(where(3)).toBe("Medio: 3 o más");
      expect(where(2)).toBe("Si no");
      // Sin responder no es un cero: va por «Si no».
      expect(where(null)).toBe("Si no");
    });
  });

  it("el grafo vuelve igual por el editor de pasos (ids, tipos, datos y salidas conservados)", () => {
    for (const question of [selectQ, npsQ]) {
      const graph = buildGraph(question);
      const tree = flowToTree(graph.nodes, graph.edges);
      expect(tree, "tiene que ser un árbol que el editor abre").not.toBeNull();
      const back = treeToFlow(tree!);
      const sortById = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
      expect(sortById(back.nodes).map((n) => ({ id: n.id, type: n.type, data: n.data }))).toEqual(sortById(graph.nodes).map((n) => ({ id: n.id, type: n.type, data: n.data })));
      expect(sortById(back.edges).map((e) => [e.source, e.target, e.sourceHandle])).toEqual(sortById(graph.edges).map((e) => [e.source, e.target, e.sourceHandle]));
    }
  });

  it("el servidor la acepta al guardarla desde el editor (misma validación que cualquier árbol)", () => {
    const graph = buildGraph(selectQ);
    const tree = flowToTree(graph.nodes, graph.edges)!;
    const triggerData = graph.nodes.find((n) => n.type === "trigger")!.data;
    const prepared = prepareTreeSave({ screen: "forms", stored: graph, tree: { steps: tree.steps }, triggerData });
    expect(prepared.ok).toBe(true);
  });

  it("se resume como «Cuando se envía · 2 caminos + si no · 3 emails»", () => {
    const graph = buildGraph(selectQ);
    expect(describeTree(flowToTree(graph.nodes, graph.edges)!)).toBe("Cuando se envía · 2 caminos + si no · 3 emails");
    expect(summarizeFlow(graph.nodes, graph.edges)).toBe("Cuando se envía · 2 caminos + si no · 3 emails");
  });
});

describe("templateQuestions", () => {
  const f = (key: string, type: string, extra: Record<string, unknown> = {}) => ({ key, label: `Pregunta ${key}`, type, ...extra }) as never;

  it("ofrece selección única (con dos opciones o más) y las numéricas; nada más", () => {
    const found = templateQuestions([
      f("a", "single_select", { options: ["x", "y"] }),
      f("b", "single_select", { options: ["solo"] }),
      f("c", "multi_select", { options: ["x", "y"] }),
      f("d", "number"),
      f("e", "rating", { min: 1, max: 5 }),
      f("f", "nps", { min: 0, max: 10 }),
      f("g", "text"),
      f("h", "date"),
      f("i", "consent"),
    ]);
    expect(found.map((q) => q.key)).toEqual(["a", "d", "e", "f"]);
  });

  it("sin etiqueta usa la clave", () => {
    expect(templateQuestions([{ key: "k", label: "", type: "number" }] as never)[0].label).toBe("k");
  });
});

describe("numberThresholds", () => {
  it("parte el rango en tercios y redondea a algo cómodo", () => {
    expect(numberThresholds(0, 10)).toEqual({ high: 7, low: 3 }); // NPS
    expect(numberThresholds(1, 5)).toEqual({ high: 4, low: 2 }); // calificación
    expect(numberThresholds(0, 100)).toEqual({ high: 70, low: 30 });
    expect(numberThresholds(0, 1000)).toEqual({ high: 700, low: 300 });
  });
  it("sin mínimo ni máximo parte de un rango de 0 a 100", () => {
    expect(numberThresholds()).toEqual({ high: 70, low: 30 });
    expect(numberThresholds(undefined, 30)).toEqual({ high: 20, low: 10 });
  });
  it("siempre deja el alto por encima del bajo, también con rangos chicos o raros", () => {
    for (const [min, max] of [[0, 1], [0, 2], [5, 5], [10, 3], [-10, 10], [0, 3]] as const) {
      const { high, low } = numberThresholds(min, max);
      expect(high, `${min}..${max}`).toBeGreaterThan(low);
    }
  });
});
