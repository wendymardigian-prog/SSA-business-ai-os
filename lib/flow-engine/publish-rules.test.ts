import { describe, expect, it } from "vitest";
import {
  chosenTriggerType,
  MANY_TRIGGERS_PROBLEM,
  NO_FIRST_STEP_PROBLEM,
  NO_KEYWORDS_PROBLEM,
  NO_TRIGGER_PROBLEM,
  TRIGGER_NOT_CHOSEN_PROBLEM,
  triggerProblems,
} from "./publish-rules";

const t = (data: Record<string, unknown>, id = "t") => ({ id, type: "trigger", data });
const step = { id: "s", type: "action", data: {} };
const edge = (source = "t") => ({ id: "e", source, target: "s" });

describe("triggerProblems", () => {
  it("sin disparador, o con dos, no se publica", () => {
    expect(triggerProblems([step], [])).toEqual([NO_TRIGGER_PROBLEM]);
    expect(triggerProblems([t({ triggerType: "new_contact" }), t({ triggerType: "welcome" }, "t2")], [edge()])).toEqual([MANY_TRIGGERS_PROBLEM]);
  });
  it("un disparador sin elegir (asi nace una automatizacion) no se publica", () => {
    expect(triggerProblems([t({ triggerType: null }), step], [edge()])).toEqual([TRIGGER_NOT_CHOSEN_PROBLEM]);
  });
  it("un nodo viejo sin la clave se lee como palabra clave", () => {
    expect(chosenTriggerType(t({}))).toBe("keyword");
    expect(triggerProblems([t({ keywords: [{ value: "hola" }] }), step], [edge()])).toEqual([]);
  });
  it("palabra clave sin palabras no se publica (salvo «solo menciones»)", () => {
    expect(triggerProblems([t({ triggerType: "keyword", keywords: [] }), step], [edge()])).toEqual([NO_KEYWORDS_PROBLEM]);
    expect(triggerProblems([t({ triggerType: "keyword", keywords: [], storyMentionOnly: true }), step], [edge()])).toEqual([]);
    expect(triggerProblems([t({ triggerType: "keyword", config: { keywords: ["info"] } }), step], [edge()])).toEqual([]);
  });
  it("un disparador sin pasos conectados no se publica", () => {
    expect(triggerProblems([t({ triggerType: "new_contact" })], [])).toEqual([NO_FIRST_STEP_PROBLEM]);
  });
});

// @plantilla-desde(servicios)
describe("los de Servicios que emite la base no se publican a medias", () => {
  it("relativo en horas: pide las horas; «antes» solo con inicio o fin", () => {
    expect(triggerProblems([t({ triggerType: "service_relative", anchor: "service_start", unit: "hours", offset_hours: -2 }), step], [edge()])).toEqual([]);
    expect(triggerProblems([t({ triggerType: "service_relative", anchor: "service_start", unit: "hours" }), step], [edge()])).toHaveLength(1);
    expect(triggerProblems([t({ triggerType: "service_relative", anchor: "service_created", unit: "hours", offset_hours: -2 }), step], [edge()])).toHaveLength(1);
  });
  it("periódico sin fase y cifra sin número tampoco", () => {
    expect(triggerProblems([t({ triggerType: "service_phase_periodic", every_days: 7 }), step], [edge()])).toEqual(["Elegí la fase."]);
    expect(triggerProblems([t({ triggerType: "service_metric_reached", metric: "points" }), step], [edge()])).toHaveLength(1);
    expect(triggerProblems([t({ triggerType: "service_metric_reached", metric: "points", threshold: 500 }), step], [edge()])).toEqual([]);
  });
  it("lo del `config` del nodo gana (como al publicar)", () => {
    expect(triggerProblems([t({ triggerType: "service_metric_reached", metric: "points", config: { threshold: 100 } }), step], [edge()])).toEqual([]);
  });
});
// @plantilla-hasta(servicios)
