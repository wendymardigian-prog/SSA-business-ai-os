/**
 * Las Server Actions de integraciones (F3).
 *
 * Lo que se prueba es lo que no se puede ver mirando la pantalla: que el rol se
 * revalida en el servidor, que una integracion oculta no se puede guardar
 * aunque alguien arme el pedido a mano, que nada se escribe si algun secreto
 * esta mal, y —la mas importante— que ninguna respuesta lleva el valor de un
 * secreto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";

// vi.hoisted: las factorias de vi.mock se suben arriba de todo, asi que no
// pueden usar constantes declaradas despues. Esto declara los espias tambien
// arriba, y los dos lados ven el mismo objeto.
const { getAdminContext, storeSecret, deleteSecret, listSecretNames, logAudit } = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(),
  listSecretNames: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ getAdminContext }));
vi.mock("@/lib/vault", () => ({ storeSecret, deleteSecret, listSecretNames }));
vi.mock("@/lib/audit", () => ({ logAudit }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ listConnectedAiProviders: vi.fn().mockResolvedValue([]) }));

import {
  saveIntegration,
  disconnectIntegration,
  updateIntegrationConfig,
} from "./integrations";

const WS = "ws-1";
const USER = "user-1";
const KEY = "sk-ant-clave-larga-de-prueba-1234567890";
/** Anthropic exige elegir un modelo por defecto: sin eso la accion rechaza. */
const MODELO = { default_model: "claude-sonnet-5" };

function admin(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const db = memoryDb({ integration_configs: [], ...seed });
  getAdminContext.mockResolvedValue({
    workspace: { id: WS },
    supabase: db.client,
    user: { id: USER },
  });
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeSecret.mockResolvedValue({ ok: true });
  deleteSecret.mockResolvedValue({ ok: true });
  listSecretNames.mockResolvedValue([]);
  logAudit.mockResolvedValue("audit-1");
});

describe("guardar una integracion", () => {
  it("un Member no puede: la accion corta antes de tocar Vault", async () => {
    getAdminContext.mockResolvedValue(null);

    const result = await saveIntegration({ providerId: "anthropic", secrets: { api_key: KEY } });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Owner y Admin") });
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("una integracion que todavia no se muestra no se puede guardar", async () => {
    // Meta se prende en el bloque 5. Que no este en la pantalla no alcanza:
    // el pedido se puede armar a mano.
    admin();

    const result = await saveIntegration({
      providerId: "meta",
      secrets: { system_user_token: "x".repeat(60) },
    });

    expect(result).toEqual({ ok: false, error: "Integracion desconocida" });
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("guarda la key en Vault y deja la integracion conectada", async () => {
    const db = admin();

    const result = await saveIntegration({
      providerId: "anthropic",
      secrets: { api_key: KEY },
      config: { default_model: "claude-sonnet-5" },
    });

    expect(result).toEqual({ ok: true });
    expect(storeSecret).toHaveBeenCalledWith(expect.anything(), WS, "anthropic_api_key", KEY);
    const row = db.rows("integration_configs")[0];
    expect(row).toMatchObject({
      workspace_id: WS,
      type: "ai_provider",
      provider: "anthropic",
      is_active: true,
      config: { default_model: "claude-sonnet-5" },
    });
  });

  it("la respuesta nunca lleva el valor del secreto", async () => {
    admin();

    const result = await saveIntegration({
      providerId: "anthropic",
      secrets: { api_key: KEY },
      config: MODELO,
    });

    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("el audit deja que campos se rotaron, nunca el valor", async () => {
    admin();

    await saveIntegration({ providerId: "anthropic", secrets: { api_key: KEY }, config: MODELO });

    const [call] = logAudit.mock.calls;
    expect(call[0].metadata).toMatchObject({ provider: "anthropic", secrets_rotated: ["api_key"] });
    expect(JSON.stringify(call[0])).not.toContain(KEY);
  });

  it("una key con el prefijo equivocado se rechaza sin guardar nada", async () => {
    admin();

    const result = await saveIntegration({
      providerId: "anthropic",
      secrets: { api_key: "sk-de-openai-1234567890123456" },
    });

    expect(result.ok).toBe(false);
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("si el segundo secreto esta mal, el primero tampoco se guarda", async () => {
    // Evolution tiene dos. Guardar el primero y fallar en el segundo dejaria la
    // integracion a medio conectar, que es peor que no guardarla.
    admin();

    const result = await saveIntegration({
      providerId: "evolution",
      secrets: { api_key: "clave-valida-del-servidor", webhook_token: "corto" },
      config: { api_url: "https://evolution.test" },
    });

    expect(result.ok).toBe(false);
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("guarda los dos secretos de Evolution cuando los dos estan bien", async () => {
    admin();

    const result = await saveIntegration({
      providerId: "evolution",
      secrets: {
        api_key: "clave-valida-del-servidor",
        webhook_token: "token-de-webhook-largo",
      },
      config: { api_url: "https://evolution.test", instance_prefix: "ssa" },
    });

    expect(result).toEqual({ ok: true });
    expect(storeSecret.mock.calls.map((c) => c[2])).toEqual([
      "evolution_api_key",
      "evolution_webhook_token",
    ]);
  });

  it("un secreto que ya esta guardado no hace falta volver a pegarlo", async () => {
    listSecretNames.mockResolvedValue(["evolution_api_key", "evolution_webhook_token"]);
    admin();

    const result = await updateIntegrationConfig("evolution", {
      api_url: "https://otro-servidor.test",
    });

    expect(result).toEqual({ ok: true });
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("sin ningun secreto guardado, el obligatorio es obligatorio", async () => {
    admin();

    const result = await saveIntegration({
      providerId: "evolution",
      config: { api_url: "https://evolution.test" },
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Falta") });
  });

  it("un campo de config obligatorio que falta corta antes de guardar", async () => {
    admin();

    const result = await saveIntegration({
      providerId: "evolution",
      secrets: { api_key: "clave-valida-del-servidor", webhook_token: "token-de-webhook-largo" },
      config: {},
    });

    expect(result.ok).toBe(false);
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("no guarda campos de config que el proveedor no declara", async () => {
    const db = admin();

    await saveIntegration({
      providerId: "anthropic",
      secrets: { api_key: KEY },
      config: { default_model: "claude-sonnet-5", colado: "no deberia estar" },
    });

    expect(db.rows("integration_configs")[0].config).toEqual({ default_model: "claude-sonnet-5" });
  });

  it("si Vault falla, la integracion no queda marcada como conectada", async () => {
    const db = admin();
    storeSecret.mockResolvedValue({ ok: false, error: "vault caido" });

    const result = await saveIntegration({
      providerId: "anthropic",
      secrets: { api_key: KEY },
      config: MODELO,
    });

    expect(result.ok).toBe(false);
    expect(db.rows("integration_configs")).toHaveLength(0);
  });

  it("Zernio escribe en la fila que ya existe, no en una nueva", async () => {
    const db = admin();

    await saveIntegration({
      providerId: "zernio",
      secrets: { api_key: "clave-de-zernio-larga-1234" },
    });

    expect(db.rows("integration_configs")[0]).toMatchObject({
      type: "channel",
      provider: "instagram_zernio",
    });
  });
});

describe("desconectar una integracion", () => {
  it("borra todos sus secretos y la deja inactiva", async () => {
    const db = admin({
      integration_configs: [
        {
          id: "cfg-1",
          workspace_id: WS,
          type: "channel",
          provider: "evolution",
          is_active: true,
          vault_secret_name: "evolution_api_key",
          config: {},
        },
      ],
    });

    const result = await disconnectIntegration("evolution");

    expect(result).toEqual({ ok: true });
    expect(deleteSecret.mock.calls.map((c) => c[2])).toEqual([
      "evolution_api_key",
      "evolution_webhook_token",
    ]);
    expect(db.rows("integration_configs")[0]).toMatchObject({
      is_active: false,
      vault_secret_name: null,
    });
  });

  it("si no se puede borrar un secreto, la integracion sigue conectada", async () => {
    const db = admin({
      integration_configs: [
        { id: "cfg-1", workspace_id: WS, type: "ai_provider", provider: "anthropic", is_active: true, config: {} },
      ],
    });
    deleteSecret.mockResolvedValue({ ok: false, error: "vault caido" });

    const result = await disconnectIntegration("anthropic");

    expect(result.ok).toBe(false);
    expect(db.rows("integration_configs")[0].is_active).toBe(true);
  });

  it("un Member no puede desconectar", async () => {
    getAdminContext.mockResolvedValue(null);

    const result = await disconnectIntegration("anthropic");

    expect(result.ok).toBe(false);
    expect(deleteSecret).not.toHaveBeenCalled();
  });
});
