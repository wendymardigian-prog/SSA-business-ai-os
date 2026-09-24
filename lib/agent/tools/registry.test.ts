import { describe, it, expect } from "vitest";
import { listAgentTools, toolsForAgent } from "./index";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";

/**
 * El registro: las ocho herramientas de la Etapa 1, y que cada una declare
 * como se muestra su configuracion (la pestana Herramientas no tiene
 * condicionales por nombre, asi que todo tiene que salir de aca).
 */

describe("registro de herramientas", () => {
  it("tiene las herramientas de la Etapa 1", () => {
    expect(listAgentTools().map((t) => t.name).sort()).toEqual(
      [
        "asignar_conversacion",
        "buscar_datos_del_contacto",
        "buscar_en_conocimiento",
        "cambiar_temperatura",
        "derivar_a_humano",
        "etiquetar_contacto",
        "pausarse",
        "programar_seguimiento",
      ].sort(),
    );
  });

  it("cada campo de pantalla corresponde a una clave del configSchema, y los defaults validan", () => {
    for (const tool of listAgentTools()) {
      const defaults = tool.configSchema.parse({}) as Record<string, unknown>;
      for (const field of tool.configFields) {
        expect(Object.keys(defaults), `${tool.name}.${field.key}`).toContain(field.key);
      }
    }
  });

  it("sin configurar nada, el agente tiene solo derivar (obligatoria): etiquetar y asignar no existen sin lista blanca", () => {
    const agent = toAgentConfig(agentRow({ allowed_tools: ["etiquetar_contacto", "asignar_conversacion", "cambiar_temperatura"], tools_config: {} }));
    expect(toolsForAgent(agent).map((t) => t.name).sort()).toEqual(["cambiar_temperatura", "derivar_a_humano"]);
  });

  it("con lista blanca, etiquetar aparece", () => {
    const agent = toAgentConfig(
      agentRow({
        allowed_tools: ["etiquetar_contacto"],
        tools_config: { etiquetar_contacto: { allowedTagIds: ["00000000-0000-4000-8000-000000000001"] } },
      }),
    );
    expect(toolsForAgent(agent).map((t) => t.name)).toContain("etiquetar_contacto");
  });

  it("asignar al setter del contacto no necesita lista de usuarios", () => {
    const agent = toAgentConfig(agentRow({ allowed_tools: ["asignar_conversacion"], tools_config: { asignar_conversacion: { strategy: "contact_setter" } } }));
    expect(toolsForAgent(agent).map((t) => t.name)).toContain("asignar_conversacion");
  });
});
