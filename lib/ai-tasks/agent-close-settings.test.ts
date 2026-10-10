import { describe, expect, it } from "vitest";
import { agentRow } from "@/lib/agent/testing/fixtures";
import { toAgentConfig } from "@/lib/agent/config";
import { closeSettingsFor, type TagInfo } from "./agent-close-settings";

/**
 * Lo que la pantalla de Clasificación al cierre muestra de cada agente tiene
 * que ser lo mismo que aplica `summarizeConversationOnClose`: cada parte
 * depende de su herramienta, con los defaults de cada una.
 */
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const tags = new Map<string, TagInfo>([
  [T1, { name: "Precio", hasEffect: false }],
  [T2, { name: "Interesado", hasEffect: false }],
  [T3, { name: "No contactar", hasEffect: true }],
]);

describe("closeSettingsFor", () => {
  it("sin herramientas: no etiqueta, no cambia la temperatura, no agenda", () => {
    const got = closeSettingsFor(toAgentConfig(agentRow({ allowed_tools: [] })), tags);
    expect(got.tags.enabled).toBe(false);
    expect(got.temperature.enabled).toBe(false);
    expect(got.followup.enabled).toBe(false);
    expect(got.classifyOnClose).toBe(true);
  });

  it("con las tres herramientas: la lista permitida (sin las de efecto, ordenada) y los defaults", () => {
    const got = closeSettingsFor(
      toAgentConfig(
        agentRow({
          allowed_tools: ["etiquetar_contacto", "cambiar_temperatura", "programar_seguimiento"],
          tools_config: { etiquetar_contacto: { allowedTagIds: [T1, T2, T3] } },
        }),
      ),
      tags,
    );
    expect(got.tags).toEqual({ enabled: true, allowedNames: ["Interesado", "Precio"], canRemove: false });
    expect(got.temperature).toEqual({ enabled: true, canLower: false });
    expect(got.followup).toEqual({ enabled: true, maxDaysAhead: 90, canOverrideManual: false });
  });

  it("respeta lo configurado en cada herramienta", () => {
    const got = closeSettingsFor(
      toAgentConfig(
        agentRow({
          allowed_tools: ["etiquetar_contacto", "cambiar_temperatura", "programar_seguimiento"],
          tools_config: {
            etiquetar_contacto: { allowedTagIds: [T1], canRemove: true },
            cambiar_temperatura: { canLower: true },
            programar_seguimiento: { maxDaysAhead: 30, canOverrideManual: true },
          },
          classify_on_close: false,
        }),
      ),
      tags,
    );
    expect(got.classifyOnClose).toBe(false);
    expect(got.tags.canRemove).toBe(true);
    expect(got.temperature.canLower).toBe(true);
    expect(got.followup).toEqual({ enabled: true, maxDaysAhead: 30, canOverrideManual: true });
  });
});
