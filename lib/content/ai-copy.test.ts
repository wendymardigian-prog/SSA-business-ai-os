import { describe, it, expect } from "vitest";
import {
  applyGeneratedCopy,
  buildPrompt,
  needsConfirmation,
  validateCopyOutput,
  type CopyOutput,
} from "./ai-copy";

const output = (over: Partial<CopyOutput> = {}): CopyOutput => ({
  copy: { hook: "Un hook", body: "El desarrollo", cta: "Comenta SISTEMA", recording_notes: "Plano medio" },
  caption_base: "Un caption base",
  captions: { instagram: "Para Instagram", threads: "Para Threads" },
  youtube_title: null,
  ...over,
});

describe("armar el pedido (F29)", () => {
  it("incluye la voz de marca antes que nada", () => {
    const prompt = buildPrompt({
      title: "Como cobrar",
      platforms: ["instagram"],
      brand: { voice: "Directa, sin vueltas", audience: "Duenas de agencia" },
    });

    expect(prompt.indexOf("Voz de marca")).toBeLessThan(prompt.indexOf("Titulo de la pieza"));
    expect(prompt).toContain("Duenas de agencia");
  });

  it("los ejemplos van, porque hacen mas por el tono que cualquier adjetivo", () => {
    const prompt = buildPrompt({
      title: "x",
      platforms: [],
      brand: { examples: ["Asi hablamos nosotras"] },
    });

    expect(prompt).toContain("Asi hablamos nosotras");
  });

  it("dice el limite real de cada red pedida", () => {
    // Pedir un caption de Threads sin decir que son 500 es pedirlo para tirarlo.
    const prompt = buildPrompt({ title: "x", platforms: ["threads", "instagram"] });

    expect(prompt).toContain("threads: hasta 500");
    expect(prompt).toContain("instagram: hasta 2200");
  });

  it("con YouTube pide ademas el titulo", () => {
    expect(buildPrompt({ title: "x", platforms: ["youtube"] })).toContain("titulo para YouTube");
  });

  it("al regenerar, manda lo que ya hay para mejorarlo", () => {
    const prompt = buildPrompt({
      title: "x",
      platforms: [],
      existingCopy: { body: "Lo que ya estaba escrito" },
    });

    expect(prompt).toContain("Lo que ya estaba escrito");
    expect(prompt).toContain("sin perder lo que ya funciona");
  });

  it("la idea de origen entra como contexto", () => {
    const prompt = buildPrompt({
      title: "x",
      platforms: [],
      idea: { hook: "El hook de la idea", angle: "Desde la objecion" },
    });

    expect(prompt).toContain("El hook de la idea");
    expect(prompt).toContain("Desde la objecion");
  });

  it("sin voz de marca ni idea, igual arma un pedido usable", () => {
    expect(buildPrompt({ title: "Una pieza", platforms: ["instagram"] })).toContain("Una pieza");
  });
});

describe("validar lo que devolvio el modelo", () => {
  it("una salida bien formada pasa", () => {
    const result = validateCopyOutput(output(), ["instagram", "threads"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.copy.hook).toBe("Un hook");
    expect(result.warnings).toEqual([]);
  });

  it("una salida que no cumple el esquema se rechaza sin guardar nada", () => {
    expect(validateCopyOutput({ copy: { hook: "" } }, []).ok).toBe(false);
    expect(validateCopyOutput("no es un objeto", []).ok).toBe(false);
    expect(validateCopyOutput(null, []).ok).toBe(false);
  });

  it("un hook vacio se rechaza: es lo unico que no puede faltar", () => {
    const result = validateCopyOutput(
      output({ copy: { hook: "", body: "x", cta: "", recording_notes: "" } }),
      [],
    );

    expect(result.ok).toBe(false);
  });

  it("un caption mas largo que el limite se recorta y se avisa", () => {
    // El guion, que es lo caro, ya esta bien: volver a pedirlo cuesta plata.
    const result = validateCopyOutput(
      output({ captions: { threads: "a".repeat(600) } }),
      ["threads"],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.captions.threads).toHaveLength(500);
    expect(result.warnings[0]).toContain("recorto");
  });

  it("una red sin caption propio usa el base, sin avisar nada", () => {
    // Usar el base es el comportamiento correcto, no un problema: la red que
    // no necesita un texto distinto usa el de la pieza.
    const result = validateCopyOutput(output({ captions: {} }), ["instagram"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.captions.instagram).toBe("Un caption base");
    expect(result.warnings).toEqual([]);
  });

  it("si no hay ni caption propio ni base, se avisa", () => {
    const result = validateCopyOutput(output({ captions: {}, caption_base: "" }), ["instagram"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings[0]).toContain("No escribio un caption");
  });

  it("el titulo de YouTube tambien se recorta", () => {
    const result = validateCopyOutput(output({ youtube_title: "a".repeat(150) }), []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.youtube_title).toHaveLength(100);
  });
});

describe("como queda la pieza despues de generar", () => {
  const networks = [{ platform: "instagram" }, { platform: "youtube" }];

  it("sin copy previo queda marcada como escrita por IA y sin revisar", () => {
    const applied = applyGeneratedCopy({
      output: output(),
      platforms: ["instagram"],
      previousCopySource: "manual",
      hadManualCopy: false,
      networks,
    });

    expect(applied.copy_source).toBe("ai");
    expect(applied.ai_unreviewed).toBe(true);
  });

  it("con copy escrito a mano antes, queda mixta", () => {
    // Es lo que permite decir despues "esto lo escribio la IA y nadie lo reviso".
    const applied = applyGeneratedCopy({
      output: output(),
      platforms: ["instagram"],
      previousCopySource: "manual",
      hadManualCopy: true,
      networks,
    });

    expect(applied.copy_source).toBe("mixed");
  });

  it("un caption igual al base no se duplica en la red", () => {
    const applied = applyGeneratedCopy({
      output: output({ captions: { instagram: "Un caption base" } }),
      platforms: ["instagram"],
      previousCopySource: "manual",
      hadManualCopy: false,
      networks,
    });

    expect(applied.networks.find((n) => n.platform === "instagram")?.caption).toBeNull();
  });

  it("el titulo de YouTube va a su red y no a las otras", () => {
    const applied = applyGeneratedCopy({
      output: output({ youtube_title: "Un titulo" }),
      platforms: ["youtube"],
      previousCopySource: "manual",
      hadManualCopy: false,
      networks,
    });

    expect(applied.networks.find((n) => n.platform === "youtube")?.youtube_title).toBe("Un titulo");
    expect(applied.networks.find((n) => n.platform === "instagram")?.youtube_title).toBeUndefined();
  });
});

describe("regenerar sobre algo escrito", () => {
  it("pide confirmacion si ya hay un guion", () => {
    expect(needsConfirmation({ body: "Ya escribi esto" })).toBe(true);
    expect(needsConfirmation({ body: "   " })).toBe(false);
    expect(needsConfirmation(null)).toBe(false);
  });
});
