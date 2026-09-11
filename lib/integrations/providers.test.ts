import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  getProvider,
  providersByType,
  validateApiKey,
  validateConfig,
  isTextProvider,
  isEmbeddingProvider,
} from "./providers";

describe("catalogo de proveedores", () => {
  it("no repite ids ni nombres de secret", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    const secrets = PROVIDERS.map((p) => p.secretName).filter(Boolean);
    expect(new Set(secrets).size).toBe(secrets.length);
  });

  it("agrupa por tipo: un email provider y cuatro de IA", () => {
    expect(providersByType("email_provider").map((p) => p.id)).toEqual(["resend"]);
    expect(providersByType("ai_provider").map((p) => p.id)).toEqual([
      "openai",
      "anthropic",
      "google_ai",
      "voyage",
    ]);
  });

  // La marca de capacidad no es cosmetica: es lo que evita que el nodo AI
  // Response elija a Voyage, que no genera texto. Ver lib/ai/provider.test.ts.
  it("separa los que generan texto de los que generan embeddings", () => {
    const text = providersByType("ai_provider").filter(isTextProvider).map((p) => p.id);
    const embeddings = providersByType("ai_provider").filter(isEmbeddingProvider).map((p) => p.id);

    expect(text).toEqual(["openai", "anthropic", "google_ai"]);
    expect(embeddings).toEqual(["voyage"]);
  });

  it("los proveedores de texto no se quedan sin capacidad por olvido", () => {
    for (const provider of providersByType("ai_provider")) {
      const isText = isTextProvider(provider);
      const isEmbedding = isEmbeddingProvider(provider);
      // Exactamente una de las dos. Un proveedor que no sea ninguna de las dos
      // no lo usaria nadie; uno que fuera las dos rompe el filtro del selector.
      expect(isText !== isEmbedding, provider.id).toBe(true);
    }
  });

  it("cada proveedor de texto tiene un modelo por defecto sugerido", () => {
    for (const provider of providersByType("ai_provider").filter(isTextProvider)) {
      const model = provider.configFields.find((f) => f.key === "default_model");
      expect(model?.defaultValue, provider.id).toBeTruthy();
      expect(model?.options?.length, provider.id).toBeGreaterThan(0);
    }
  });

  it("cada proveedor de embeddings declara su modelo", () => {
    for (const provider of providersByType("ai_provider").filter(isEmbeddingProvider)) {
      const model = provider.configFields.find((f) => f.key === "embedding_model");
      expect(model?.defaultValue, provider.id).toBeTruthy();
      expect(model?.options?.length, provider.id).toBeGreaterThan(0);
    }
  });
});

describe("validateApiKey", () => {
  it("exige el prefijo del proveedor cuando tiene uno", () => {
    const res = validateApiKey("anthropic", "sk-esta-es-de-openai-no-de-anthropic");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("sk-ant-");
  });

  it("acepta una key con el prefijo y la longitud correctos", () => {
    expect(validateApiKey("anthropic", "sk-ant-api03-abcdefghijklmnop").ok).toBe(true);
    expect(validateApiKey("resend", "re_abcdefghijklmnopqrstuv").ok).toBe(true);
  });

  it("rechaza una key demasiado corta", () => {
    const res = validateApiKey("openai", "sk-corta");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("incompleta");
  });

  it("rechaza espacios: casi siempre es un copiado a medias", () => {
    expect(validateApiKey("openai", "sk-abcdefghij klmnopqrstu").ok).toBe(false);
  });

  it("Google no exige prefijo, solo longitud", () => {
    expect(validateApiKey("google_ai", "AIzaSyA-abcdefghijklmnop").ok).toBe(true);
    expect(validateApiKey("google_ai", "corta").ok).toBe(false);
  });

  it("rechaza vacio y proveedor desconocido", () => {
    expect(validateApiKey("openai", "   ").ok).toBe(false);
    expect(validateApiKey("mistral", "sk-loquesea-largo-de-verdad").ok).toBe(false);
  });

  it("ignora espacios de sobra alrededor de una key valida", () => {
    expect(validateApiKey("resend", "  re_abcdefghijklmnopqrstuv  ").ok).toBe(true);
  });
});

describe("validateConfig", () => {
  it("exige el remitente de Resend y valida que sea un email", () => {
    expect(validateConfig("resend", {}).ok).toBe(false);
    expect(validateConfig("resend", { from_email: "no-es-un-email" }).ok).toBe(false);
    expect(validateConfig("resend", { from_email: "hola@tudominio.com" }).ok).toBe(true);
  });

  it("el nombre del remitente es opcional", () => {
    const res = validateConfig("resend", { from_email: "hola@tudominio.com", from_name: "" });
    expect(res.ok).toBe(true);
  });

  it("exige el modelo por defecto en los proveedores de IA", () => {
    expect(validateConfig("openai", {}).ok).toBe(false);
    expect(validateConfig("openai", { default_model: "gpt-5" }).ok).toBe(true);
  });

  it("acepta un modelo que no esta en la lista sugerida", () => {
    expect(validateConfig("anthropic", { default_model: "claude-futuro-9" }).ok).toBe(true);
  });
});

describe("getProvider", () => {
  it("devuelve undefined para un id que no existe", () => {
    expect(getProvider("no-existe")).toBeUndefined();
  });
});
