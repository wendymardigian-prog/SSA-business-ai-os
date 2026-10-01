import { describe, it, expect } from "vitest";
import { listAgentTools, toolsForAgent, toolsForTurn } from "./index";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";

/**
 * El registro: las ocho herramientas de la Etapa 1, y que cada una declare
 * como se muestra su configuracion (la pestana Herramientas no tiene
 * condicionales por nombre, asi que todo tiene que salir de aca).
 */

describe("registro de herramientas", () => {
  it("tiene las herramientas de la Etapa 1 mas las siete de agendamiento y las dos de la banca de audios", () => {
    expect(listAgentTools().map((t) => t.name).sort()).toEqual(
      [
        "asignar_conversacion",
        "buscar_datos_del_contacto",
        "buscar_en_conocimiento",
        "cambiar_temperatura",
        "declarar_intencion",
        "derivar_a_humano",
        "enviar_audio",
        "etiquetar_contacto",
        "generar_link_whatsapp",
        "listar_audios",
        "pausarse",
        "programar_seguimiento",
        // Etapa 4: la habilidad de agendamiento. Estan registradas siempre,
        // pero con la habilidad apagada ninguna se OFRECE (isAvailable).
        "scheduling_book",
        "scheduling_cancel",
        "scheduling_get_booking",
        "scheduling_get_slots",
        "scheduling_list_events",
        "scheduling_reschedule",
        "scheduling_send_link",
      ].sort(),
    );
  });

  it("con la habilidad de agendamiento apagada, el agente ve exactamente lo de antes", () => {
    // Es la garantia de que sumar la habilidad no cambio nada para los agentes
    // que ya existian.
    // `scheduling_book` en la lista no alcanza: la habilidad esta apagada, asi
    // que ninguna de las siete se ofrece.
    const agente = toAgentConfig(agentRow({ allowed_tools: ["scheduling_book", "scheduling_get_slots"], tools_config: {} }));
    expect(toolsForAgent(agente).map((t) => t.name).filter((n) => n.startsWith("scheduling_"))).toEqual([]);
  });

  it("encendida y con un evento elegido, las siete aparecen", () => {
    const agente = toAgentConfig(
      agentRow({
        allowed_tools: [],
        tools_config: { scheduling: { habilitada: true, event_type_ids: ["3f1a0b2c-4d5e-4f70-8192-a3b4c5d6e7f8"], puede_agendar: true, puede_cancelar: true } },
      }),
    );
    const nombres = toolsForAgent(agente).map((t) => t.name);
    expect(nombres).toContain("scheduling_get_slots");
    expect(nombres).toContain("scheduling_book");
    expect(nombres).toContain("scheduling_cancel");
  });

  it("sin eventos elegidos no se ofrece ninguna, aunque este encendida", () => {
    const agente = toAgentConfig(agentRow({ allowed_tools: [], tools_config: { scheduling: { habilitada: true, event_type_ids: [] } } }));
    expect(toolsForAgent(agente).map((t) => t.name)).toEqual(["derivar_a_humano"]);
  });

  it("en borrador, las que agendan no se ofrecen y las que leen si", () => {
    const agente = toAgentConfig(
      agentRow({
        allowed_tools: [],
        tools_config: { scheduling: { habilitada: true, event_type_ids: ["3f1a0b2c-4d5e-4f70-8192-a3b4c5d6e7f8"], puede_agendar: true, puede_cancelar: true } },
      }),
    );
    const enBorrador = toolsForTurn(agente, { mode: "draft" }).map((t) => t.name);
    expect(enBorrador).toContain("scheduling_get_slots");
    expect(enBorrador).not.toContain("scheduling_book");
    expect(enBorrador).not.toContain("scheduling_cancel");
    // Al enviar, todas.
    expect(toolsForTurn(agente, { mode: "send" }).map((t) => t.name)).toContain("scheduling_book");
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
