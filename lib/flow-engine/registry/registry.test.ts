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
  "pauseAgent",
  "resumeAgent",
  // Etapa 4 (F46).
  "send_email",
  "cancel_booking",
  "set_booking_status",
  // Banca de recursos en las automatizaciones.
  "sendAsset",
  // Tareas × CRM (R4).  @plantilla-quitar(tareas)
  "complete_task", // @plantilla-quitar(tareas)
  // Diseñador IA (F57).
  "designGenerate",
  // API de Conversiones de Meta (00328).
  "send_meta_event",
  // Calificación del lead (00329).
  "qualify_lead",
  // Grupos y comunidades de WhatsApp (00344).
  "send_to_group",
  "invite_to_group",
] as const;

describe("registro de nodos", () => {
  it("tiene todos los tipos ejecutables", () => {
    // 17 de la Fase 2, + pausar y reanudar el agente de IA (Fase 3),
    // + enviar email y las dos acciones de agenda (Etapa 4),
    // + enviar un recurso de la banca,
    // + las tres acciones de cobranza de Ventas (mark_payment_paid, reschedule_payment, set_sale_status),  @plantilla-quitar(ventas)
    // + `branch` ("Condiciones": varios caminos en orden y "Si no"). El `condition` de siempre sigue registrado.
    // + `notify_team` ("Avisar en la campana").
    // + `upsert_contact` ("Crear o actualizar contacto", webhooks entrantes, Extra L).  @plantilla-quitar(webhooks)
    // + `create_task` ("Crear tarea", Tareas, F22).  @plantilla-quitar(tareas)
    // + `complete_task` ("Completar tarea", Tareas × CRM, R4).  @plantilla-quitar(tareas)
    // + `send_whatsapp_number` ("Enviar WhatsApp a un número", Extra L Tirón 2, D3).
    // + `send_poll` ("Enviar encuesta", Grupos de WhatsApp).
    // + `designGenerate` ("Generar desde plantilla", Diseñador IA, F57).
    // + `send_meta_event` ("Enviar evento a Meta", API de Conversiones, 00328).
    // + `qualify_lead` ("Calificar lead", 00329).
    // + `send_to_group` y `invite_to_group` ("Enviar al grupo", "Invitar a un grupo", 00344).
    expect(listNodes()).toHaveLength(38); // @plantilla-quitar(ventas,webhooks,tareas)
    // @plantilla-sin(ventas,webhooks,tareas): expect(listNodes()).toHaveLength(32);
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
    for (const type of ["sendMessage", "aiResponse", "condition", "branch", "delay"]) {
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

  it("solo aiResponse, httpRequest y designGenerate persisten variables", () => {
    const persisten = listNodes()
      .filter((n) => n.persistsVariables)
      .map((n) => n.type)
      .sort();
    // designGenerate (Diseñador IA, F58): `design.*` y la generación pendiente tienen que sobrevivir a una pausa.
    expect(persisten).toEqual(["aiResponse", "designGenerate", "httpRequest"]);
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
