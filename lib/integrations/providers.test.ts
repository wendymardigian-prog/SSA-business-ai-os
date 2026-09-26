import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  getProvider,
  providersByType,
  validateApiKey,
  validateConfig,
  isTextProvider,
  isEmbeddingProvider,
  providersBySection,
  getVisibleProvider,
  secretFieldsOf,
  configProviderOf,
  providerForConfigRow,
  SECTION_ORDER,
} from "./providers";
import { ALL_SECRET_NAMES } from "@/lib/secret-names";

describe("catalogo de proveedores", () => {
  it("no repite ids ni nombres de secret", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    const secrets = PROVIDERS.map((p) => p.secretName).filter(Boolean);
    expect(new Set(secrets).size).toBe(secrets.length);
  });

  // Agrupa solo lo visible: desde la etapa 2 el catalogo tiene tambien Resend
  // entrante (email) y Meta, que se prenden en los bloques 8 y 5.
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

// ── Etapa 2, F1: catalogo extendido ─────────────────────────────────────────

describe("catalogo extendido (F1)", () => {
  it("devuelve las secciones en el orden de la pantalla, solo con lo visible", () => {
    const groups = providersBySection();

    expect(groups.map((g) => g.section)).toEqual([
      "messaging",
      "publishing",
      "google",
      "email",
      "ai",
    ]);
    // Meta existe en el catalogo pero se prende en el bloque 5: su seccion no
    // aparece todavia.
    expect(groups.some((g) => g.section === "meta")).toBe(false);
    for (const group of groups) {
      expect(group.providers.every((p) => p.visible)).toBe(true);
      expect(group.label.length).toBeGreaterThan(0);
    }
  });

  it("mensajeria tiene Zernio y Evolution; publicacion, Postproxy, LinkedIn y Threads", () => {
    const bySection = Object.fromEntries(
      providersBySection().map((g) => [g.section, g.providers.map((p) => p.id)]),
    );

    expect(bySection.messaging).toEqual(["zernio", "evolution"]);
    expect(bySection.publishing).toEqual(["postproxy", "linkedin", "threads"]);
    expect(bySection.google).toEqual(["google"]);
    expect(bySection.email).toEqual(["resend"]);
    expect(bySection.ai).toEqual(["openai", "anthropic", "google_ai", "voyage"]);
  });

  it("una integracion todavia no visible no se puede usar desde una accion", () => {
    // El criterio de F1: lo oculto se excluye de la pantalla Y de las acciones.
    expect(getProvider("meta")?.visible).toBe(false);
    expect(getVisibleProvider("meta")).toBeUndefined();
    expect(getVisibleProvider("resend_inbound")).toBeUndefined();
    expect(getVisibleProvider("zernio")?.id).toBe("zernio");
    expect(getVisibleProvider("no-existe")).toBeUndefined();
  });

  it("cada secreto declarado existe en SECRET_NAMES", () => {
    // Un nombre inventado guardaria el secreto con una clave que despues nadie
    // sabe leer, y el error recien se veria en produccion.
    for (const provider of PROVIDERS) {
      for (const field of secretFieldsOf(provider)) {
        expect(ALL_SECRET_NAMES, `${provider.id}.${field.key}`).toContain(field.secretName);
      }
      if (provider.secretName) {
        expect(ALL_SECRET_NAMES, `${provider.id}.secretName`).toContain(provider.secretName);
      }
    }
  });

  it("no hay dos integraciones que escriban la misma fila de integration_configs", () => {
    // (type, provider) es unico en la tabla: dos entradas con el mismo par se
    // pisarian la configuracion entre si.
    const rows = PROVIDERS.map((p) => `${p.type}:${configProviderOf(p)}`);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("la fila de Zernio sigue siendo la que ya existe en la base", () => {
    const zernio = getProvider("zernio")!;
    expect(zernio.type).toBe("channel");
    expect(configProviderOf(zernio)).toBe("instagram_zernio");
    expect(providerForConfigRow("channel", "instagram_zernio")?.id).toBe("zernio");
  });

  it("una integracion con un solo secreto igual declara su campo", () => {
    const fields = secretFieldsOf(getProvider("anthropic")!);
    expect(fields).toHaveLength(1);
    expect(fields[0].secretName).toBe("anthropic_api_key");
    expect(fields[0].keyPrefix).toBe("sk-ant-");
  });

  it("Evolution y Zernio guardan dos secretos cada una", () => {
    expect(secretFieldsOf(getProvider("evolution")!).map((f) => f.secretName)).toEqual([
      "evolution_api_key",
      "evolution_webhook_token",
    ]);
    expect(secretFieldsOf(getProvider("zernio")!).map((f) => f.secretName)).toEqual([
      "zernio_api_key",
      "zernio_webhook_secret",
    ]);
  });

  it("las integraciones de OAuth piden Client ID y Secret, y no tienen key propia", () => {
    for (const id of ["google", "linkedin", "threads"]) {
      const provider = getProvider(id)!;
      expect(provider.connection).toBe("oauth_app");
      expect(provider.secretName).toBeNull();
      expect(secretFieldsOf(provider)).toHaveLength(2);
      expect(secretFieldsOf(provider).every((f) => f.required)).toBe(true);
    }
  });

  it("los topes de uso son los de los planes gratis", () => {
    expect(getProvider("zernio")!.usage).toMatchObject({ limit: 2 });
    expect(getProvider("postproxy")!.usage).toMatchObject({ limit: 10 });
    expect(getProvider("zernio")!.usage?.atLimitHint).toContain("6");
  });

  it("toda integracion declara como se conecta y en que seccion va", () => {
    for (const provider of PROVIDERS) {
      expect(SECTION_ORDER, provider.id).toContain(provider.section);
      expect(
        ["api_key", "oauth_app", "system_token", "qr", "via_zernio"],
        provider.id,
      ).toContain(provider.connection);
    }
  });
});
