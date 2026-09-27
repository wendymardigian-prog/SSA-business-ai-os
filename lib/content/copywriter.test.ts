/**
 * Lo que decide el copywriter (E3, E4, E11).
 *
 * El contexto se arma de forma determinista a proposito: que elija los cinco
 * posts que mas funcionaron, o que ofrezca una palabra clave que dispara
 * algo de verdad, no puede depender de que el modelo se acuerde.
 */

import { describe, it, expect } from "vitest";
import {
  buildCopywriterPrompt,
  checkGuardrails,
  EMPTY_GUARDRAILS,
  offerableKeywords,
  pickTopPosts,
  readCopywriterConfig,
  TOP_POSTS,
  type CopywriterContext,
} from "./copywriter";
import type { CopyOutput } from "./ai-copy";

const NOW = new Date("2026-10-01T12:00:00Z");
const haceDias = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60_000).toISOString();

const post = (over: Partial<Parameters<typeof pickTopPosts>[0][number]> = {}) => ({
  platform: "instagram",
  format: "reel",
  caption: "Un caption",
  engagement: 10,
  publishedAt: haceDias(10),
  ...over,
});

describe("E4 · que posts le sirven de ejemplo", () => {
  it("elige los cinco con mas engagement", () => {
    const posts = Array.from({ length: 8 }, (_, i) =>
      post({ engagement: i + 1, caption: `post ${i + 1}` }),
    );

    const top = pickTopPosts(posts, { platform: "instagram", format: "reel", now: NOW });

    expect(top).toHaveLength(TOP_POSTS);
    expect(top[0].caption).toBe("post 8");
    expect(top[4].caption).toBe("post 4");
  });

  it("solo de esa red", () => {
    const top = pickTopPosts(
      [post({ platform: "tiktok", engagement: 999 }), post({ engagement: 1 })],
      { platform: "instagram", format: "reel", now: NOW },
    );

    expect(top.map((p) => p.platform)).toEqual(["instagram"]);
  });

  it("y de ese formato: un Reel y un carrusel no se escriben igual", () => {
    const top = pickTopPosts(
      [post({ format: "carrusel", engagement: 999 }), post({ engagement: 1 })],
      { platform: "instagram", format: "reel", now: NOW },
    );

    expect(top.map((p) => p.format)).toEqual(["reel"]);
  });

  it("nada de mas de 90 dias: el negocio de entonces era otro", () => {
    const top = pickTopPosts(
      [post({ publishedAt: haceDias(120), engagement: 999 })],
      { platform: "instagram", format: "reel", now: NOW },
    );

    expect(top).toEqual([]);
  });

  it("ni los que todavia no tienen engagement medido", () => {
    const top = pickTopPosts([post({ engagement: null }), post({ engagement: 0 })], {
      platform: "instagram",
      format: "reel",
      now: NOW,
    });

    expect(top).toEqual([]);
  });

  it("ni los que no tienen caption: no hay nada que imitar", () => {
    expect(
      pickTopPosts([post({ caption: "  " })], { platform: "instagram", format: "reel", now: NOW }),
    ).toEqual([]);
  });

  it("sin formato, compara contra toda la red", () => {
    const top = pickTopPosts([post({ format: "carrusel" }), post()], {
      platform: "instagram",
      now: NOW,
    });

    expect(top).toHaveLength(2);
  });
});

describe("E4 · que palabras clave puede ofrecer", () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    type: "comment_keyword",
    isActive: true,
    channelIds: [] as string[],
    keywords: [{ value: "SISTEMA" }],
    flowName: "Guia por DM",
    ...over,
  });

  it("las de una automatizacion activa", () => {
    expect(offerableKeywords([rule()], "instagram", "chan-1")).toEqual([
      { keyword: "SISTEMA", flowName: "Guia por DM" },
    ]);
  });

  it("no las de una apagada: dejaria al lead sin respuesta", () => {
    expect(offerableKeywords([rule({ isActive: false })], "instagram", "chan-1")).toEqual([]);
  });

  it("no las de otro canal", () => {
    expect(offerableKeywords([rule({ channelIds: ["otro"] })], "instagram", "chan-1")).toEqual([]);
  });

  it("una sin canales declarados vale para todos", () => {
    expect(offerableKeywords([rule()], "instagram", null)).toHaveLength(1);
  });

  it("no repite la misma palabra de dos flows", () => {
    expect(
      offerableKeywords([rule(), rule({ flowName: "Otro flow" })], "instagram", "chan-1"),
    ).toHaveLength(1);
  });
});

describe("E3 · la configuracion, con respaldo en lo que ya habia", () => {
  it("usa la del agente cuando esta", () => {
    const config = readCopywriterConfig(
      {
        system_prompt: "Escribi como Wendy",
        config: { brand: { voice: "Directa" }, auto_on_approve: true },
        knowledge_tags: ["oferta"],
      },
      { voice: "La vieja" },
    );

    expect(config.instructions).toBe("Escribi como Wendy");
    expect(config.brand.voice).toBe("Directa");
    expect(config.knowledgeTags).toEqual(["oferta"]);
    expect(config.autoOnApprove).toBe(true);
  });

  it("cae a `workspaces.content_copy_settings` para que nadie reescriba su voz", () => {
    const config = readCopywriterConfig({ system_prompt: "", config: {} }, { voice: "La de antes" });

    expect(config.brand.voice).toBe("La de antes");
  });

  it("producir el copy al aprobar arranca APAGADO", () => {
    expect(readCopywriterConfig({ config: {} }, {}).autoOnApprove).toBe(false);
  });

  it("los limites mal cargados no rompen nada", () => {
    const config = readCopywriterConfig(
      { config: { guardrails: { bannedPhrases: "no es una lista", maxLength: -5 } } } as never,
      {},
    );

    expect(config.guardrails.bannedPhrases).toEqual([]);
    expect(config.guardrails.maxLength).toBeNull();
  });
});

describe("E4 · el pedido al modelo", () => {
  const base: CopywriterContext = {
    request: { title: "Una pieza", platforms: ["instagram"] },
    config: {
      instructions: "Escribi como Wendy",
      brand: {},
      guardrails: { bannedPhrases: ["revolucionario"], bannedClaims: [], maxLength: 300 },
      knowledgeTags: [],
      autoOnApprove: false,
    },
    topPosts: [{ platform: "instagram", caption: "El que anduvo", engagement: 9 }],
    keywords: [{ keyword: "SISTEMA", flowName: "Guia por DM" }],
    knowledge: [{ title: "Oferta", text: "Implementacion en 10 dias" }],
  };

  it("lleva las instrucciones, los limites, el conocimiento y los ejemplos", () => {
    const prompt = buildCopywriterPrompt(base);

    expect(prompt).toContain("Escribi como Wendy");
    expect(prompt).toContain("revolucionario");
    expect(prompt).toContain("300 caracteres");
    expect(prompt).toContain("Implementacion en 10 dias");
    expect(prompt).toContain("El que anduvo");
  });

  it("le dice que use una palabra clave que dispara algo de verdad", () => {
    const prompt = buildCopywriterPrompt(base);

    expect(prompt).toContain("SISTEMA -> Guia por DM");
    expect(prompt).toContain("No inventes otra");
  });

  it("sin automatizaciones, le pide un CTA que alguien pueda atender a mano", () => {
    const prompt = buildCopywriterPrompt({ ...base, keywords: [] });

    expect(prompt).toContain("atender a mano");
    expect(prompt).not.toContain("No inventes otra");
  });

  it("las indicaciones de la persona van al final, que es lo que mas pesa", () => {
    const prompt = buildCopywriterPrompt({ ...base, instructions: "mas corto, mas directo" });

    expect(prompt.trimEnd().endsWith("mas corto, mas directo")).toBe(true);
  });

  it("sin nada configurado no arma sedimento vacio", () => {
    const prompt = buildCopywriterPrompt({
      request: base.request,
      config: { instructions: "", brand: {}, guardrails: EMPTY_GUARDRAILS, knowledgeTags: [], autoOnApprove: false },
      topPosts: [],
      keywords: [],
      knowledge: [],
    });

    expect(prompt).not.toContain("LIMITES");
    expect(prompt).not.toContain("INSTRUCCIONES");
  });
});

describe("E3 · que se revisa al recibir la respuesta", () => {
  const output = (over: Partial<CopyOutput> = {}): CopyOutput => ({
    copy: { hook: "Un hook", body: "El desarrollo", cta: "Comenta SISTEMA", recording_notes: "" },
    caption_base: "Un caption normal",
    captions: { instagram: "Para Instagram" },
    ...over,
  });

  it("avisa si usa una frase prohibida", () => {
    const avisos = checkGuardrails(output({ caption_base: "Esto es REVOLUCIONARIO" }), {
      ...EMPTY_GUARDRAILS,
      bannedPhrases: ["revolucionario"],
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("revolucionario");
  });

  it("y si promete algo que no se puede", () => {
    const avisos = checkGuardrails(output({ copy: { ...output().copy, body: "Resultados garantizados" } }), {
      ...EMPTY_GUARDRAILS,
      bannedClaims: ["resultados garantizados"],
    });

    expect(avisos[0]).toContain("Promete");
  });

  it("y si se pasa de largo", () => {
    const avisos = checkGuardrails(output({ caption_base: "x".repeat(400) }), {
      ...EMPTY_GUARDRAILS,
      maxLength: 300,
    });

    expect(avisos[0]).toContain("400 caracteres");
  });

  it("con todo en orden, no dice nada", () => {
    expect(checkGuardrails(output(), EMPTY_GUARDRAILS)).toEqual([]);
  });
});
