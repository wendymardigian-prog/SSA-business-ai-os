import { describe, expect, it } from "vitest";
import "@/lib/flow-engine/registry";
import { resolveNodeType } from "@/lib/flow-engine/registry";
import { triggerProblems } from "@/lib/flow-engine/publish-rules";
import { buildDesiredTriggers } from "@/lib/flow-triggers";
import {
  buildPollAnswerFlows,
  cleanTags,
  NOTHING_TO_DO,
  pollAnswerActionsProblem,
  pollCategory,
  TAG_TOO_LONG,
  TAG_WITH_VARIABLE,
  type PollAnswerActionsInput,
} from "./poll-answer-actions";

const base: PollAnswerActionsInput = {
  groupId: "g-1",
  messageId: "m-1",
  pollName: "¿Venís a la clase?",
  options: ["Sí", "No", "Tal vez"],
  tags: {},
  field: null,
};

describe("cleanTags / pollAnswerActionsProblem", () => {
  it("una respuesta sin etiqueta no etiqueta; los espacios de más se limpian", () => {
    expect(cleanTags(base.options, { Sí: "  Va a la   clase ", No: "", "Tal vez": "   " })).toEqual([{ option: "Sí", tag: "Va a la clase" }]);
  });

  it("sin etiquetas ni campo no hay nada que crear", () => {
    expect(pollAnswerActionsProblem({ ...base, tags: { Sí: " " } })).toBe(NOTHING_TO_DO);
    expect(pollAnswerActionsProblem({ ...base, field: { slug: "respuesta", name: "Respuesta" } })).toBeNull();
  });

  it("rechaza etiquetas largas o con variables", () => {
    expect(pollAnswerActionsProblem({ ...base, tags: { Sí: "x".repeat(101) } })).toBe(TAG_TOO_LONG);
    expect(pollAnswerActionsProblem({ ...base, tags: { Sí: "{{poll.selected}}" } })).toBe(TAG_WITH_VARIABLE);
  });

  it("una etiqueta de una respuesta que la encuesta no tiene se ignora", () => {
    expect(cleanTags(base.options, { Otra: "x" })).toEqual([]);
  });
});

describe("buildPollAnswerFlows", () => {
  const input: PollAnswerActionsInput = { ...base, tags: { Sí: "Va a la clase", No: "No va" }, field: { slug: "respuesta_clase", name: "Respuesta clase" } };
  const flows = buildPollAnswerFlows(input);

  it("una automatización por respuesta con etiqueta, más la del campo", () => {
    expect(flows.map((f) => f.name)).toEqual([
      "Encuesta «¿Venís a la clase?» · Sí → etiqueta «Va a la clase»",
      "Encuesta «¿Venís a la clase?» · No → etiqueta «No va»",
      "Encuesta «¿Venís a la clase?» · respuesta → campo «Respuesta clase»",
    ]);
    for (const f of flows) expect(f.categories).toEqual(["Grupos de WhatsApp", "Encuesta: ¿Venís a la clase?"]);
  });

  it("la de cada respuesta filtra a ESA respuesta de ESA encuesta y agrega la etiqueta", () => {
    const [si] = flows;
    expect(si.nodes[0].data).toEqual({
      triggerType: "whatsapp_group_poll_vote",
      group_ids: ["g-1"],
      message_scope: "picked",
      message_ids: ["m-1"],
      options: ["Sí"],
    });
    expect(si.nodes[1].data).toEqual({ actionType: "addTag", tagName: "Va a la clase" });
    expect(si.edges).toEqual([{ id: "e-trigger-step", source: "trigger", target: "step" }]);
  });

  it("la del campo filtra a todas las respuestas y guarda {{poll.selected}}", () => {
    const field = flows[2];
    expect(field.nodes[0].data.options).toEqual(["Sí", "No", "Tal vez"]);
    expect(field.nodes[1].data).toEqual({ actionType: "setCustomField", fieldSlug: "respuesta_clase", value: "{{poll.selected}}" });
  });

  it("el motor reconoce los pasos y se pueden publicar", () => {
    for (const f of flows) {
      expect(triggerProblems(f.nodes, f.edges)).toEqual([]);
      expect(resolveNodeType(f.nodes[1] as never)).toBe(f.nodes[1].data.actionType === "addTag" ? "addTag" : "setCustomField");
      const rows = buildDesiredTriggers(f.nodes as never, "flow-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "whatsapp_group_poll_vote", config: { message_ids: ["m-1"], message_scope: "picked" } });
    }
  });

  it("sin nada que hacer no arma ninguna", () => {
    expect(buildPollAnswerFlows(base)).toEqual([]);
  });

  it("la categoría no pasa del tope ni lleva comas (el filtro de la lista separa por coma)", () => {
    expect(pollCategory("x".repeat(100)).length).toBeLessThanOrEqual(40);
    expect(pollCategory("¿Lunes, martes o jueves?")).toBe("Encuesta: ¿Lunes martes o jueves?");
  });
});
