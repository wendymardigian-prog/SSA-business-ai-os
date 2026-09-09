import { describe, it, expect } from "vitest";
import {
  getNode,
  getNodeByType,
  listNodes,
  listTriggers,
  resolveNodeType,
  getConditionOperator,
  matchConditionField,
} from "./index";

/**
 * Los once nodos que el panel guarda como `type: "action"`.
 *
 * Este es el test que importa de verdad: durante toda la Fase 1 estos nodos
 * existieron en el panel, se podian arrastrar y configurar, pasaban el panel de
 * Test... y en produccion el motor los tiraba por el `default` del switch. Un
 * flow con Add Tag agregaba cero tags y nadie se enteraba.
 */
const NODOS_DE_ACCION = [
  "abSplit",
  "smartDelay",
  "addTag",
  "removeTag",
  "setCustomField",
  "httpRequest",
  "goToFlow",
  "humanTakeover",
  "subscribe",
  "unsubscribe",
  "enrollSequence",
] as const;

describe("registro de nodos", () => {
  it("tiene los 17 tipos ejecutables", () => {
    expect(listNodes()).toHaveLength(17);
  });

  it.each(NODOS_DE_ACCION)(
    'resuelve "%s" cuando el canvas lo guarda como type:"action"',
    (actionType) => {
      const node = { type: "action", data: { actionType } };
      expect(resolveNodeType(node)).toBe(actionType);
      expect(getNode(node)?.type).toBe(actionType);
    }
  );

  it("resuelve los nodos que el canvas guarda con su tipo directo", () => {
    for (const type of ["sendMessage", "aiResponse", "condition", "delay"]) {
      expect(resolveNodeType({ type: type, data: {} })).toBe(type);
    }
  });

  it("no resuelve un actionType que no existe, en vez de adivinar", () => {
    const node = { type: "action", data: { actionType: "inventado" } };
    expect(resolveNodeType(node)).toBeUndefined();
    expect(getNode(node)).toBeUndefined();
  });

  it("no resuelve un tipo desconocido", () => {
    expect(resolveNodeType({ type: "noExiste", data: {} })).toBeUndefined();
  });

  it("solo aiResponse y httpRequest persisten variables", () => {
    const persisten = listNodes()
      .filter((n) => n.persistsVariables)
      .map((n) => n.type)
      .sort();
    expect(persisten).toEqual(["aiResponse", "httpRequest"]);
  });

  it("todos los nodos tienen etiqueta y funcion de ejecucion", () => {
    for (const node of listNodes()) {
      expect(node.label).toBeTruthy();
      expect(typeof node.execute).toBe("function");
    }
  });

  it("el nodo trigger no es ejecutable: es el punto de entrada", () => {
    expect(getNodeByType("trigger")).toBeUndefined();
  });
});

describe("registro de triggers", () => {
  it("ordena los de mensaje por prioridad, de mayor a menor", () => {
    const tipos = listTriggers("message").map((t) => t.type);
    expect(tipos).toEqual(["postback", "quick_reply", "keyword", "welcome", "default"]);
  });

  it("el trigger por defecto no filtra: es el ultimo recurso", () => {
    const porDefecto = listTriggers("message").find((t) => t.type === "default");
    expect(porDefecto?.matches).toBeUndefined();
  });

  it("separa los de comentario de los de mensaje", () => {
    expect(listTriggers("comment").map((t) => t.type)).toEqual(["comment_keyword"]);
  });

  it("una palabra clave matchea segun su matchType", () => {
    const keyword = listTriggers("message").find((t) => t.type === "keyword")!;
    const base = {
      trigger: {} as never,
      message: {},
      isFirstMessage: false,
    };

    expect(
      keyword.matches!({
        ...base,
        config: { keywords: ["hola"], matchType: "exact" },
        text: "hola",
      })
    ).toBe(true);

    expect(
      keyword.matches!({
        ...base,
        config: { keywords: ["hola"], matchType: "exact" },
        text: "hola que tal",
      })
    ).toBe(false);

    expect(
      keyword.matches!({
        ...base,
        config: { keywords: [{ value: "precio", matchType: "contains" }] },
        text: "cual es el precio?",
      })
    ).toBe(true);
  });
});

describe("registro de condiciones", () => {
  it("tiene los seis operadores", () => {
    for (const op of ["equals", "not_equals", "contains", "exists", "gt", "lt"]) {
      expect(getConditionOperator(op)).toBeDefined();
    }
  });

  it("evalua igual que el switch que reemplazo", () => {
    expect(getConditionOperator("equals")!.evaluate("a", "a")).toBe(true);
    expect(getConditionOperator("contains")!.evaluate(undefined, "a")).toBe(false);
    expect(getConditionOperator("exists")!.evaluate("", "")).toBe(false);
    expect(getConditionOperator("gt")!.evaluate("5", "3")).toBe(true);
    expect(getConditionOperator("lt")!.evaluate("5", "3")).toBe(false);
  });

  it("separa el prefijo del argumento en los campos con dos puntos", () => {
    const match = matchConditionField("tag:interesado");
    expect(match?.definition.prefix).toBe("tag:");
    expect(match?.argument).toBe("interesado");
  });

  it("resuelve los campos exactos sin argumento", () => {
    expect(matchConditionField("platform")?.argument).toBe("");
  });

  it("devuelve undefined para un campo sin resolver, que se trata como campo personalizado", () => {
    expect(matchConditionField("presupuesto")).toBeUndefined();
  });
});
