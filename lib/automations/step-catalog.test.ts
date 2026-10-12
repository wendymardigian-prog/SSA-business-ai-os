import { describe, it, expect } from "vitest";
import { FLOW_TEMPLATES, templateGraph } from "@/lib/scheduling/automation/templates";
import { FORM_FLOW_TEMPLATES, formTemplateGraph } from "@/lib/forms/automation/templates";
import { flowToTree, allSteps, type ActionStep } from "./step-tree";
import { actionKind, actionKindsFor, actionProblem, describeAction, emailRecipientsFor, kindOfStep, newActionStep, validateActionData } from "./step-catalog";

const step = (nodeType: string, data: Record<string, unknown>): ActionStep => ({ kind: "action", id: "x", nodeType, data });

describe("que se ofrece en cada pantalla", () => {
  it("Formularios: email, mensaje, esperar y tags (Condiciones aparte)", () => {
    expect(actionKindsFor("forms").map((k) => k.key)).toEqual(["email", "message", "delay", "tag_add", "tag_remove"]);
  });

  it("Agenda suma el estado de la reunion y cancelarla", () => {
    expect(actionKindsFor("agenda").map((k) => k.key)).toEqual(["email", "message", "delay", "tag_add", "tag_remove", "booking_status", "cancel_booking"]);
  });

  it("el email: al contacto o a una direccion fija; en la Agenda tambien al anfitrion", () => {
    expect(emailRecipientsFor("forms")).toEqual(["contact", "fixed"]);
    expect(emailRecipientsFor("agenda")).toEqual(["contact", "host", "fixed"]);
  });

  it("cada paso nuevo nace valido para el catalogo, salvo lo que hay que completar, y con un id nuevo", () => {
    for (const kind of actionKindsFor("agenda")) {
      const s = newActionStep(kind, ["a", "b"], () => 0.5);
      expect(kindOfStep(s, "agenda")?.key).toBe(kind.key);
      expect(s.nodeType).toBe(kind.nodeType);
      expect(["a", "b"]).not.toContain(s.id);
    }
    expect(actionKind("email").blank()).toMatchObject({ actionType: "send_email", to: "contact" });
  });

  it("un paso de la Agenda no se reconoce en Formularios", () => {
    const cancel = step("action", { actionType: "cancel_booking", status: "cancelled_other" });
    expect(kindOfStep(cancel, "agenda")?.key).toBe("cancel_booking");
    expect(kindOfStep(cancel, "forms")).toBeUndefined();
  });

  it("todos los pasos de las plantillas precreadas se reconocen en su pantalla (nada queda como 'otro')", () => {
    const grafos = [
      ...FLOW_TEMPLATES.map((t) => ({ screen: "agenda" as const, graph: templateGraph(t, "ev-1") })),
      ...FORM_FLOW_TEMPLATES.map((t) => ({ screen: "forms" as const, graph: formTemplateGraph(t.key, { form: { id: "f", name: "F", type: "survey" }, userEmail: "yo@ejemplo.com", tagName: "x" }) })),
    ];
    for (const { screen, graph } of grafos) {
      for (const s of allSteps(flowToTree(graph.nodes, graph.edges)!)) {
        expect(s.kind === "action" && kindOfStep(s, screen), `${screen}: ${s.id}`).toBeTruthy();
      }
    }
  });
});

describe("describeAction", () => {
  it.each([
    [step("action", { actionType: "send_email", to: "contact" }), "Email al contacto"],
    [step("action", { actionType: "send_email", to: "fixed" }), "Email a una dirección fija"],
    [step("action", { actionType: "send_email", to: "host" }), "Email al anfitrión"],
    [step("sendMessage", { messages: [{ text: "x" }] }), "Mensaje al contacto"],
    [step("delay", { duration: 2, unit: "hours" }), "Esperar 2 horas"],
    [step("delay", { duration: 1, unit: "days" }), "Esperar 1 día"],
    [step("action", { actionType: "addTag", tagName: "vip" }), "Agregar el tag «vip»"],
    [step("action", { actionType: "removeTag", tagName: "frio" }), "Quitar el tag «frio»"],
    [step("action", { actionType: "set_booking_status", status: "no_show" }), "Cambiar el estado de la reunión a No-show"],
    [step("action", { actionType: "cancel_booking", status: "cancelled_other" }), "Cancelar la reunión"],
    [step("action", { actionType: "httpRequest", label: "Avisar al CRM" }), "Avisar al CRM"],
    [step("action", { actionType: "httpRequest" }), "Llamada HTTP"],
    [step("action", { actionType: "algoRaro" }), "algoRaro"],
  ])("%j", (s, text) => expect(describeAction(s, "agenda")).toBe(text));
});

describe("actionProblem y validateActionData", () => {
  it("email vacio, sin direccion fija valida, mensaje vacio, tag sin nombre", () => {
    expect(actionProblem(newActionStep(actionKind("email"), []), "forms")).toMatch(/vacío/);
    expect(actionProblem(step("action", { actionType: "send_email", to: "fixed", fixedEmail: "x", subject: "a", body: "b" }), "forms")).toMatch(/email válida/);
    expect(actionProblem(step("action", { actionType: "send_email", to: "contact", subject: "a", body: "" }), "forms")).toBeNull();
    expect(actionProblem(newActionStep(actionKind("message"), []), "forms")).toMatch(/vacío/);
    expect(actionProblem(newActionStep(actionKind("tag_add"), []), "forms")).toMatch(/tag/);
    expect(actionProblem(newActionStep(actionKind("delay"), []), "forms")).toBeNull();
  });

  it("el servidor valida los datos de cada tipo", () => {
    expect(validateActionData(step("action", { actionType: "send_email", to: "contact", subject: "a", body: "b" }), "forms")).toBeNull();
    expect(validateActionData(step("action", { actionType: "send_email", to: "contact", subject: "a" }), "forms")).toMatch(/Email/);
    expect(validateActionData(step("sendMessage", { messages: [] }), "forms")).toMatch(/Mensaje/);
    expect(validateActionData(step("sendMessage", { messages: [{ text: "hola" }], onlyIfPhone: true }), "forms")).toBeNull();
    expect(validateActionData(step("delay", { duration: 5, unit: "minutes" }), "forms")).toBeNull();
    expect(validateActionData(step("delay", { duration: 5, unit: "semanas" }), "forms")).toMatch(/Esperar/);
    expect(validateActionData(step("action", { actionType: "set_booking_status", status: "inventado" }), "agenda")).toMatch(/estado/);
    expect(validateActionData(step("action", { actionType: "set_booking_status", status: "no_show" }), "agenda")).toBeNull();
    expect(validateActionData(step("action", { actionType: "cancel_booking", status: "cancelled_no_response" }), "agenda")).toBeNull();
    expect(validateActionData(step("action", { actionType: "cancel_booking", status: "sale" }), "agenda")).toMatch(/Cancelar/);
  });

  it("conserva claves de mas que el editor no conoce (no las rechaza ni las pierde)", () => {
    expect(validateActionData(step("sendMessage", { messages: [{ text: "x", imageUrl: "https://i" }], onlyIfPhone: true, cosaNueva: 1 }), "forms")).toBeNull();
  });
});
