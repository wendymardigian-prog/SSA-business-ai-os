/**
 * F4: los datos de Evolution salen de Vault, con las variables de entorno como
 * respaldo.
 *
 * Lo que se prueba es sobre todo el respaldo: mientras nadie cargue nada en la
 * pantalla, WhatsApp tiene que seguir funcionando exactamente como hoy. Ese es
 * el riesgo del cambio, no el camino nuevo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

const { readSecret } = vi.hoisted(() => ({ readSecret: vi.fn() }));
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault")>();
  return { ...actual, readSecret };
});

import { getEvolutionConfig, getEvolutionWebhookToken } from "./evolution-config";

const WS = "ws-1";
const ENV = {
  EVOLUTION_API_URL: "https://evolution-del-entorno.test",
  EVOLUTION_API_KEY: "clave-del-entorno",
  EVOLUTION_INSTANCE_PREFIX: "ssa",
  EVOLUTION_WEBHOOK_TOKEN: "token-del-entorno",
};

/** La base con (o sin) la integracion de Evolution guardada. */
function db(row?: { config?: Record<string, string>; is_active?: boolean }) {
  return memoryDb({
    integration_configs: row
      ? [
          {
            id: "cfg-1",
            workspace_id: WS,
            type: "channel",
            provider: "evolution",
            is_active: row.is_active ?? true,
            config: row.config ?? {},
          },
        ]
      : [],
  }).client;
}

/** Vault con estos secretos y nada mas. */
function vault(secrets: Record<string, string>) {
  readSecret.mockImplementation(async (_c: unknown, _ws: string, name: string) => secrets[name] ?? null);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, ENV);
  vault({});
});

afterEach(() => {
  for (const key of Object.keys(ENV)) delete process.env[key as keyof typeof ENV];
});

describe("de donde sale la configuracion de Evolution", () => {
  it("sin nada guardado usa las variables de entorno, como hasta ahora", async () => {
    const config = await getEvolutionConfig(db(), WS);

    expect(config).toEqual({
      baseUrl: "https://evolution-del-entorno.test",
      apiKey: "clave-del-entorno",
      instancePrefix: "ssa",
    });
  });

  it("lo guardado en el workspace le gana al entorno", async () => {
    vault({ evolution_api_key: "clave-de-vault" });
    const config = await getEvolutionConfig(
      db({ config: { api_url: "https://evolution-del-negocio.test", instance_prefix: "ssa2" } }),
      WS,
    );

    expect(config).toEqual({
      baseUrl: "https://evolution-del-negocio.test",
      apiKey: "clave-de-vault",
      instancePrefix: "ssa2",
    });
  });

  it("se puede tener la direccion guardada y la clave todavia en el entorno", async () => {
    // Es el estado intermedio de la migracion, y tiene que funcionar.
    const config = await getEvolutionConfig(
      db({ config: { api_url: "https://evolution-del-negocio.test" } }),
      WS,
    );

    expect(config).toMatchObject({
      baseUrl: "https://evolution-del-negocio.test",
      apiKey: "clave-del-entorno",
    });
  });

  it("una integracion desactivada no se usa: manda el entorno", async () => {
    vault({ evolution_api_key: "clave-de-vault" });
    const config = await getEvolutionConfig(
      db({ is_active: false, config: { api_url: "https://apagada.test" } }),
      WS,
    );

    expect(config).toMatchObject({
      baseUrl: "https://evolution-del-entorno.test",
      apiKey: "clave-del-entorno",
    });
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("sin direccion en ningun lado devuelve null, igual que antes", async () => {
    delete process.env.EVOLUTION_API_URL;

    expect(await getEvolutionConfig(db(), WS)).toBeNull();
  });

  it("sin clave en ningun lado devuelve null, igual que antes", async () => {
    delete process.env.EVOLUTION_API_KEY;

    expect(await getEvolutionConfig(db(), WS)).toBeNull();
  });

  it("si Vault falla, no se cae: usa el entorno", async () => {
    // readSecret lanza cuando la RPC falla. Que WhatsApp deje de mandar
    // mensajes porque Vault tuvo un mal momento seria mucho peor.
    readSecret.mockRejectedValue(new Error("vault caido"));
    const config = await getEvolutionConfig(db({ config: { api_url: "https://x.test" } }), WS);

    expect(config).toMatchObject({ apiKey: "clave-del-entorno" });
  });

  it("la direccion se guarda sin la barra final", async () => {
    const config = await getEvolutionConfig(db({ config: { api_url: "https://x.test/" } }), WS);

    expect(config?.baseUrl).toBe("https://x.test");
  });

  it("sin prefijo configurado queda el de siempre", async () => {
    delete process.env.EVOLUTION_INSTANCE_PREFIX;
    const config = await getEvolutionConfig(db(), WS);

    expect(config?.instancePrefix).toBe("ssa");
  });
});

describe("el token del webhook", () => {
  it("sale de Vault cuando el workspace lo tiene", async () => {
    vault({ evolution_webhook_token: "token-de-vault" });

    expect(await getEvolutionWebhookToken(db(), WS)).toBe("token-de-vault");
  });

  it("sin nada en Vault vale el del entorno", async () => {
    expect(await getEvolutionWebhookToken(db(), WS)).toBe("token-del-entorno");
  });

  it("sin workspace conocido vale el del entorno", async () => {
    // Pasa cuando llega un mensaje de una instancia que no es nuestra.
    expect(await getEvolutionWebhookToken(db(), null)).toBe("token-del-entorno");
    expect(readSecret).not.toHaveBeenCalled();
  });

  it("sin token en ningun lado devuelve null y el receptor responde 500", async () => {
    delete process.env.EVOLUTION_WEBHOOK_TOKEN;

    expect(await getEvolutionWebhookToken(db(), WS)).toBeNull();
  });
});

describe("la regla que no se puede romper", () => {
  it("nadie mas lee las variables EVOLUTION_ por su cuenta", async () => {
    // El sentido de F4 es que haya UN lugar que decide de donde salen estos
    // datos. Si manana alguien vuelve a leer process.env.EVOLUTION_ en una
    // ruta, esa ruta se queda en el entorno para siempre y nadie se entera.
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, resolve, relative } = await import("node:path");

    const root = resolve(__dirname, "..");
    // La regla es sobre el codigo que corre en produccion. Un test que simula
    // el entorno (el de caracterizacion del receptor lo hace) no cuenta.
    const permitido = (rel: string) => rel === "lib/evolution-config.ts" || rel.includes(".test.");

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(full);
      }
    };
    walk(join(root, "lib"));
    walk(join(root, "app"));

    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes("process.env.EVOLUTION_"))
      .map((f) => relative(root, f))
      .filter((f) => !permitido(f));

    expect(offenders).toEqual([]);
  });
});
