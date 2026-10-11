/**
 * Caracterizacion de las siete tareas de IA que existian antes de Llamadas
 * (§4.3). Llamadas suma tres tareas al catalogo; ninguna de estas siete puede
 * cambiar de forma. Este test sigue pasando cuando el catalogo crece.
 */
import { describe, expect, it } from "vitest";
import { AI_TASKS, type AiTaskId } from "./catalog";

const SHAPE = (id: AiTaskId) => {
  const t = AI_TASKS[id];
  return {
    id: t.id,
    configurable: t.configurable,
    canTurnOff: t.canTurnOff,
    control: t.control,
    editable: t.instructions.editable,
    vars: t.instructions.editable ? t.instructions.variables.map((v) => v.name) : undefined,
    hasModelPicker: t.hasModelPicker ?? false,
    onDemand: t.onDemand ?? false,
    source: t.source,
    detailLike: t.detailLike ?? null,
    backgroundTask: t.backgroundTask ?? null,
  };
};

const EXPECTED = [
  { id: "message_classification", configurable: true, canTurnOff: true, control: { kind: "task" }, editable: true, vars: ["direccion", "max_nuevas_categorias"], hasModelPicker: false, onDemand: false, source: "message_classification", detailLike: null, backgroundTask: "message_classification" },
  { id: "conversation_summary", configurable: false, canTurnOff: false, control: { kind: "agent", flag: "summaryOnClose" }, editable: true, vars: ["estilo", "largo_maximo"], hasModelPicker: false, onDemand: false, source: "conversation_summary", detailLike: null, backgroundTask: null },
  { id: "close_classification", configurable: false, canTurnOff: false, control: { kind: "agent", flag: "classifyOnClose" }, editable: true, vars: [], hasModelPicker: false, onDemand: false, source: "conversation_summary", detailLike: "%classified%", backgroundTask: null },
  { id: "knowledge_indexing", configurable: false, canTurnOff: false, control: { kind: "integration", href: "/dashboard/settings/integrations/voyage", label: "Ajustes → Integraciones → Voyage" }, editable: false, vars: undefined, hasModelPicker: false, onDemand: false, source: "kb_indexing", detailLike: null, backgroundTask: null },
  { id: "audio_transcription", configurable: false, canTurnOff: false, control: { kind: "integration", href: "/dashboard/settings/integrations", label: "Ajustes → Integraciones" }, editable: false, vars: undefined, hasModelPicker: false, onDemand: false, source: "audio_transcription", detailLike: null, backgroundTask: null },
  { id: "media_description", configurable: false, canTurnOff: false, control: { kind: "integration", href: "/dashboard/settings/integrations", label: "Ajustes → Integraciones (OpenAI, Google o Anthropic)" }, editable: true, vars: [], hasModelPicker: false, onDemand: false, source: "media_description", detailLike: null, backgroundTask: null },
  { id: "ads_analysis", configurable: false, canTurnOff: false, control: { kind: "on_demand", where: "cuando alguien aprieta “Analizar con IA” en el dashboard de Meta Ads" }, editable: true, vars: ["estilo"], hasModelPicker: true, onDemand: true, source: "ads_analysis", detailLike: null, backgroundTask: null },
] as const;

describe("las siete tareas de IA de antes de Llamadas", () => {
  it.each(EXPECTED.map((e) => [e.id, e] as const))("%s no cambia de forma", (id, expected) => {
    expect(SHAPE(id as AiTaskId)).toEqual(expected);
  });
});
