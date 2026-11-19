import { describe, expect, it } from "vitest";
import { paramsWereEdited, stableJson } from "./types";
import { agentToolFields, agentToolPermission } from "./agent-tools";
import { executorOf, permissionFor } from "./core";

describe("propuestas", () => {
  it("editar = cambió algo de los parámetros (el orden de las claves no cuenta)", () => {
    expect(stableJson({ b: 1, a: [1, { y: 2, x: 1 }] })).toBe(stableJson({ a: [1, { x: 1, y: 2 }], b: 1 }));
    expect(paramsWereEdited({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(false);
    expect(paramsWereEdited({ a: 1 }, { a: 2 })).toBe(true);
  });

  it("nadie aprueba lo que no podría hacer: cada acción pide su permiso", () => {
    expect(agentToolPermission("etiquetar_contacto")).toBe("contacts.edit");
    expect(agentToolPermission("asignar_conversacion")).toBe("contacts.assign");
    expect(agentToolPermission("crear_tarea")).toBe("tasks.edit");
    expect(agentToolPermission("desconocida")).toBe("agents.edit");
    expect(permissionFor({ tool_key: "crear_nota", tool_config: { executor: "person_tool" } }, (k) => (k === "crear_nota" ? "contacts.edit" : null))).toBe("contacts.edit");
    expect(executorOf({ tool_config: {} })).toBe("agent_tool");
  });

  it("los campos editables salen de lo que escribió el modelo", () => {
    expect(agentToolFields({ motivo: "Lo pidió", add: ["vip"], dias: 3 }).map((f) => [f.key, f.kind])).toEqual([
      ["motivo", "text"],
      ["add", "list"],
    ]);
  });
});
