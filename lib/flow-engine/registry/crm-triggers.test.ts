import { describe, it, expect } from "vitest";
import { crmEventMatches } from "./triggers";
import { listTriggers, getTrigger } from "./index";
import { windowHours } from "@/app/api/cron/inactivity/route";

describe("F4 — que evento del CRM dispara que flow", () => {
  const tagAgregado = {
    event_type: "tag_added",
    payload: { tag_name: "interesado", tag_id: "abc" },
  };

  it("dispara cuando coincide el evento y el valor", () => {
    expect(crmEventMatches({ event: "tag_added", value: "interesado" }, tagAgregado)).toBe(true);
  });

  it("no dispara con otro tag", () => {
    expect(crmEventMatches({ event: "tag_added", value: "frio" }, tagAgregado)).toBe(false);
  });

  it("no dispara cuando el evento es otro", () => {
    expect(crmEventMatches({ event: "tag_removed", value: "interesado" }, tagAgregado)).toBe(false);
  });

  it("sin valor, alcanza con el tipo de evento", () => {
    expect(crmEventMatches({ event: "tag_added" }, tagAgregado)).toBe(true);
    expect(crmEventMatches({ event: "tag_added", value: "" }, tagAgregado)).toBe(true);
  });

  it("ignora mayusculas y espacios: el operador escribe el tag a mano", () => {
    expect(crmEventMatches({ event: "tag_added", value: "  INTERESADO " }, tagAgregado)).toBe(true);
  });

  it("los campos personalizados se filtran por cual cambio, no por su valor", () => {
    const cambio = {
      event_type: "field_changed",
      payload: { field_slug: "presupuesto", value: "5000" },
    };
    expect(crmEventMatches({ event: "field_changed", value: "presupuesto" }, cambio)).toBe(true);
    expect(crmEventMatches({ event: "field_changed", value: "5000" }, cambio)).toBe(false);
  });

  it("la asignacion se filtra por rol", () => {
    const asignado = {
      event_type: "assignment_changed",
      payload: { role: "vendedor", user_id: "u1" },
    };
    expect(crmEventMatches({ event: "assignment_changed", value: "vendedor" }, asignado)).toBe(true);
    expect(crmEventMatches({ event: "assignment_changed", value: "setter" }, asignado)).toBe(false);
  });

  it("no dispara si el payload no trae el dato que se filtra", () => {
    expect(
      crmEventMatches({ event: "tag_added", value: "interesado" }, {
        event_type: "tag_added",
        payload: {},
      })
    ).toBe(false);
  });
});

describe("F6 — palabra clave en respuesta a historia", () => {
  const keyword = listTriggers("message").find((t) => t.type === "keyword")!;
  const base = { trigger: {} as never, isFirstMessage: false };

  it("con el filtro puesto, una respuesta a historia con la palabra dispara", () => {
    expect(
      keyword.matches!({
        ...base,
        config: { keywords: ["quiero"], storyReply: true },
        message: { text: "quiero info", isStoryReply: true },
        text: "quiero info",
      })
    ).toBe(true);
  });

  it("con el filtro puesto, una respuesta a historia SIN la palabra no dispara", () => {
    expect(
      keyword.matches!({
        ...base,
        config: { keywords: ["quiero"], storyReply: true },
        message: { text: "hola", isStoryReply: true },
        text: "hola",
      })
    ).toBe(false);
  });

  it("con el filtro puesto, un DM comun con la palabra no dispara", () => {
    expect(
      keyword.matches!({
        ...base,
        config: { keywords: ["quiero"], storyReply: true },
        message: { text: "quiero info", isStoryReply: false },
        text: "quiero info",
      })
    ).toBe(false);
  });

  it("sin el filtro, sigue disparando con cualquier mensaje", () => {
    expect(
      keyword.matches!({
        ...base,
        config: { keywords: ["quiero"] },
        message: { text: "quiero info" },
        text: "quiero info",
      })
    ).toBe(true);
  });
});

describe("F5 — ventana de inactividad", () => {
  it("interpreta horas y dias", () => {
    expect(windowHours({ amount: 24, unit: "hours" })).toBe(24);
    expect(windowHours({ amount: 3, unit: "days" })).toBe(72);
  });

  it("sin unidad asume horas", () => {
    expect(windowHours({ amount: 48 })).toBe(48);
  });

  it("rechaza una ventana invalida en vez de disparar sobre todo", () => {
    expect(windowHours({})).toBeNull();
    expect(windowHours({ amount: 0 })).toBeNull();
    expect(windowHours({ amount: -5 })).toBeNull();
    expect(windowHours({ amount: NaN })).toBeNull();
  });
});

describe("los tres tipos nuevos estan registrados", () => {
  it.each(["new_contact", "crm_event", "inactivity"])("%s", (type) => {
    expect(getTrigger(type)).toBeDefined();
  });

  it("no se evaluan contra mensajes entrantes", () => {
    const deMensaje = listTriggers("message").map((t) => t.type);
    expect(deMensaje).not.toContain("new_contact");
    expect(deMensaje).not.toContain("crm_event");
    expect(deMensaje).not.toContain("inactivity");
  });

  it("los de evento y los agendados estan separados", () => {
    expect(listTriggers("event").map((t) => t.type).sort()).toEqual(["crm_event", "new_contact"]);
    expect(listTriggers("scheduled").map((t) => t.type)).toEqual(["inactivity"]);
  });
});
