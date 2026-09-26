import { describe, it, expect } from "vitest";
import {
  addPostId,
  checkCta,
  createAutomationHref,
  findUppercaseWords,
  isLimitedToPosts,
  keywordTriggers,
  type AutomationRule,
} from "./keywords";

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  triggerId: "t1",
  flowId: "f1",
  flowName: "Guia gratis",
  type: "comment_keyword",
  isActive: true,
  channelIds: [],
  keywords: [{ value: "sistema", matchType: "contains" }],
  postIds: [],
  ...over,
});

const context = (rules: AutomationRule[] = [rule()]) => ({
  platform: "instagram",
  channelId: "ch-1",
  rules,
});

describe("una palabra dispara una automatizacion (F27)", () => {
  it("contains: la palabra del CTA en mayusculas encuentra la configurada en minuscula", () => {
    expect(keywordTriggers("SISTEMA", rule())).toBe(true);
  });

  it("exact exige que sea la misma", () => {
    const exacta = rule({ keywords: [{ value: "sistema", matchType: "exact" }] });

    expect(keywordTriggers("SISTEMA", exacta)).toBe(true);
    expect(keywordTriggers("el sistema", exacta)).toBe(false);
  });

  it("startsWith acepta que una empiece con la otra", () => {
    const empieza = rule({ keywords: [{ value: "sistema", matchType: "startsWith" }] });

    expect(keywordTriggers("SISTEMA YA", empieza)).toBe(true);
  });

  it("una palabra vacia no dispara nada", () => {
    expect(keywordTriggers("   ", rule())).toBe(false);
  });
});

describe("revisar el CTA de una red", () => {
  it("con una automatizacion activa, dice cual responde", () => {
    const check = checkCta({ type: "comment", keyword: "SISTEMA" }, context())!;

    expect(check.level).toBe("ok");
    expect(check.message).toContain("Guia gratis");
    expect(check.match?.flowId).toBe("f1");
  });

  it("una automatizacion INACTIVA no cuenta", () => {
    // Decir que si cuando esta apagada es peor que decir que no.
    const check = checkCta({ type: "comment", keyword: "SISTEMA" }, context([rule({ isActive: false })]))!;

    expect(check.level).toBe("warning");
    expect(check.match).toBeNull();
  });

  it("una automatizacion de DM no responde un CTA de comentario", () => {
    const check = checkCta(
      { type: "comment", keyword: "SISTEMA" },
      context([rule({ type: "keyword" })]),
    )!;

    expect(check.level).toBe("warning");
  });

  it("una automatizacion de otro canal no cuenta", () => {
    const check = checkCta(
      { type: "comment", keyword: "SISTEMA" },
      context([rule({ channelIds: ["otro-canal"] })]),
    )!;

    expect(check.level).toBe("warning");
  });

  it("una automatizacion sin canales declarados vale para todos", () => {
    expect(checkCta({ type: "comment", keyword: "SISTEMA" }, context())!.level).toBe("ok");
  });

  it("un CTA sin palabra avisa", () => {
    const check = checkCta({ type: "comment", keyword: "" }, context())!;

    expect(check.level).toBe("warning");
    expect(check.message).toContain("no pusiste la palabra");
  });

  it("sin CTA no hay nada que revisar", () => {
    expect(checkCta({ type: "none" }, context())).toBeNull();
    expect(checkCta({ type: "link", url: "https://x.test" }, context())).toBeNull();
  });

  it("en LinkedIn se avisa que las respuestas se atienden a mano", () => {
    const check = checkCta(
      { type: "comment", keyword: "SISTEMA" },
      { platform: "linkedin", channelId: null, rules: [rule()] },
    )!;

    expect(check.level).toBe("info");
    expect(check.message).toContain("a mano");
  });

  it("el link para crear la automatizacion lleva todo precargado", () => {
    const check = checkCta({ type: "dm", keyword: "GUIA" }, context([]))!;
    const href = createAutomationHref(check, "ch-1");

    expect(href).toContain("trigger=keyword");
    expect(href).toContain("keyword=GUIA");
    expect(href).toContain("channel=ch-1");
  });
});

describe("palabras en mayuscula del texto", () => {
  it("las encuentra, sin repetir", () => {
    expect(findUppercaseWords("Comenta SISTEMA y te mando la GUIA. SISTEMA, si.")).toEqual([
      "SISTEMA",
      "GUIA",
    ]);
  });

  it("ignora siglas comunes y palabras cortas", () => {
    expect(findUppercaseWords("El CEO dijo OK al PDF")).toEqual([]);
  });

  it("un texto normal no marca nada", () => {
    expect(findUppercaseWords("Un caption comun y corriente")).toEqual([]);
  });
});

describe("completar los postIds al publicar", () => {
  it("agrega el id publicado", () => {
    expect(addPostId([], "ig-123")).toEqual(["ig-123"]);
    expect(addPostId(["otro"], "ig-123")).toEqual(["otro", "ig-123"]);
  });

  it("no lo duplica", () => {
    expect(addPostId(["ig-123"], "ig-123")).toEqual(["ig-123"]);
  });

  it("solo aplica a las automatizaciones limitadas a posts", () => {
    expect(isLimitedToPosts(rule({ postIds: [] }))).toBe(false);
    expect(isLimitedToPosts(rule({ postIds: ["ig-1"] }))).toBe(true);
  });
});
