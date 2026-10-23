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
