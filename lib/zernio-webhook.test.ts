import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureWebhookRegistered,
  generateWebhookSecret,
  getOrCreateWorkspaceWebhookSecret,
  resolveWebhookSecret,
  verifyWebhookSignature,
  WEBHOOK_NAME,
} from "./zernio-webhook";

interface CapturedUpdate {
  table: string;
  patch: Record<string, unknown>;
}

/**
 * Un cliente que responde las RPC de Vault.
 *
 * Desde la 00090 el secreto vive SOLO ahi: `workspaces.webhook_secret` y
 * `channels.webhook_secret` se borraron. `from` lanza para probar que ya no
 * se consulta ninguna tabla.
 */
function makeFakeSupabase(seed: { vault?: string | null; storeFalla?: string }) {
  const updates: CapturedUpdate[] = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      if (name === "read_secret") {
        return Promise.resolve({ data: seed.vault ?? null, error: null });
      }
      if (name === "store_secret") {
        if (seed.storeFalla) {
          return Promise.resolve({ data: null, error: { message: seed.storeFalla } });
        }
        updates.push({ table: "vault", patch: { name: args.secret_name } });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      throw new Error(`no deberia consultar ${table}: el secreto esta en Vault`);
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

/**
 * Builds a fake Zernio client exposing only the `webhooks` surface used by
 * ensureWebhookRegistered, pre-seeded with a list of existing webhooks.
 */
function fakeZernio(existing: Array<Record<string, unknown>>) {
  const create = vi.fn().mockResolvedValue({ data: { success: true } });
  const update = vi.fn().mockResolvedValue({ data: { success: true } });
  const get = vi.fn().mockResolvedValue({ data: { webhooks: existing } });
  return {
    client: { webhooks: { getWebhookSettings: get, createWebhookSettings: create, updateWebhookSettings: update } },
    get,
    create,
    update,
  };
}

const opts = {
  url: "https://app.ejemplo.test/api/webhooks/late",
  secret: "s3cr3t",
  events: ["message.received", "comment.received"] as const,
};
const EXPECTED_URL = "https://app.ejemplo.test/api/webhooks/late";

describe("ensureWebhookRegistered", () => {
  it("creates the webhook when none exists (AC1)", async () => {
    const z = fakeZernio([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("created");
    expect(z.create).toHaveBeenCalledTimes(1);
    expect(z.create).toHaveBeenCalledWith({
      body: {
        name: WEBHOOK_NAME,
        url: EXPECTED_URL,
        secret: "s3cr3t",
        events: ["message.received", "comment.received"],
      },
    });
    expect(z.update).not.toHaveBeenCalled();
  });

  it("is idempotent — no-op when config already correct (AC2)", async () => {
    const z = fakeZernio([
      { _id: "wh1", name: WEBHOOK_NAME, url: EXPECTED_URL, secret: "s3cr3t", events: ["message.received", "comment.received"] },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("unchanged");
    expect(z.create).not.toHaveBeenCalled();
    expect(z.update).not.toHaveBeenCalled();
  });

  it("updates when the url is stale (AC3)", async () => {
    const z = fakeZernio([
      { _id: "wh1", name: WEBHOOK_NAME, url: "https://old.example/api/webhooks/late", events: ["message.received", "comment.received"] },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("updated");
    expect(z.update).toHaveBeenCalledTimes(1);
    expect(z.update).toHaveBeenCalledWith({
      body: {
        _id: "wh1",
        name: WEBHOOK_NAME,
        url: EXPECTED_URL,
        secret: "s3cr3t",
        events: ["message.received", "comment.received"],
      },
    });
    expect(z.create).not.toHaveBeenCalled();
  });

  it("updates when the remote secret differs (drift after local rotation)", async () => {
    const z = fakeZernio([
      { _id: "wh1", name: WEBHOOK_NAME, url: EXPECTED_URL, secret: "old-secret", events: ["message.received", "comment.received"] },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("updated");
    expect(z.update).toHaveBeenCalledWith({
      body: {
        _id: "wh1",
        name: WEBHOOK_NAME,
        url: EXPECTED_URL,
        secret: "s3cr3t",
        events: ["message.received", "comment.received"],
      },
    });
  });

  it("updates when a required event is missing (AC3)", async () => {
    const z = fakeZernio([
      { _id: "wh1", name: WEBHOOK_NAME, url: EXPECTED_URL, events: ["message.received"] },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("updated");
    expect(z.update).toHaveBeenCalledTimes(1);
  });

  it("strips whitespace from the url (newline in env var corrupted the registered URL, #10)", async () => {
    const z = fakeZernio([]);
    await ensureWebhookRegistered(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      z.client as any,
      { ...opts, url: "https://app.ejemplo.test/api/webhooks/late\n", events: [...opts.events] },
    );

    expect(z.create).toHaveBeenCalledWith({
      body: {
        name: WEBHOOK_NAME,
        url: EXPECTED_URL,
        secret: "s3cr3t",
        events: ["message.received", "comment.received"],
      },
    });
  });

  it("matches an existing webhook by name even if the url has a trailing slash", async () => {
    const z = fakeZernio([
      { _id: "wh1", name: WEBHOOK_NAME, url: EXPECTED_URL, secret: "s3cr3t", events: ["message.received", "comment.received"] },
    ]);
    const res = await ensureWebhookRegistered(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      z.client as any,
      { ...opts, url: "https://app.ejemplo.test/api/webhooks/late/", events: [...opts.events] },
    );

    expect(res.action).toBe("unchanged");
  });

  it("adopts a pre-existing webhook with a different name when the path matches (E2E finding)", async () => {
    const z = fakeZernio([
      {
        _id: "wh9",
        name: "comments+DM para el negocio",
        url: `${EXPECTED_URL}?x-vercel-protection-bypass=tok`,
        events: ["message.received", "comment.received"],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("updated");
    expect(z.update).toHaveBeenCalledWith({
      body: {
        _id: "wh9",
        name: WEBHOOK_NAME,
        url: EXPECTED_URL,
        secret: "s3cr3t",
        events: ["message.received", "comment.received"],
      },
    });
    expect(z.create).not.toHaveBeenCalled();
  });

  it("matches by path when the url carries a query string but events are already set", async () => {
    const z = fakeZernio([
      {
        _id: "wh1",
        name: WEBHOOK_NAME,
        url: `${EXPECTED_URL}?x-vercel-protection-bypass=tok`,
        events: ["message.received", "comment.received"],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    // Same path but url differs (query token) → update to strip it and set our secret.
    expect(res.action).toBe("updated");
    expect(z.update).toHaveBeenCalledTimes(1);
  });

  it("creates a new webhook when several exist and none are ours", async () => {
    const z = fakeZernio([
      { _id: "a", name: "Other A", url: "https://x.example/hook", events: [] },
      { _id: "b", name: "Other B", url: "https://y.example/hook", events: [] },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("created");
    expect(z.create).toHaveBeenCalledTimes(1);
    expect(z.update).not.toHaveBeenCalled();
  });

  it("never hijacks a lone unrelated webhook (Zernio allows up to 10 per account)", async () => {
    const z = fakeZernio([
      {
        _id: "user1",
        name: "AgendaAI Webhook",
        url: "https://example.supabase.co/functions/v1/zernio-webhook",
        events: ["message.received"],
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await ensureWebhookRegistered(z.client as any, { ...opts, events: [...opts.events] });

    expect(res.action).toBe("created");
    expect(z.create).toHaveBeenCalledTimes(1);
    expect(z.update).not.toHaveBeenCalled();
  });
});

describe("generateWebhookSecret", () => {
  it("returns a 64-char hex string", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different value each call", () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe("getOrCreateWorkspaceWebhookSecret", () => {
  it("devuelve el secreto que ya esta en Vault, sin escribir (AC5)", async () => {
    const fake = makeFakeSupabase({ vault: "existing-secret" });
    const secret = await getOrCreateWorkspaceWebhookSecret(fake.client, "ws-1");

    expect(secret).toBe("existing-secret");
    expect(fake.updates).toHaveLength(0);
  });

  it("genera uno nuevo y lo guarda EN VAULT cuando no hay (AC1, AC5)", async () => {
    const fake = makeFakeSupabase({ vault: null });
    const secret = await getOrCreateWorkspaceWebhookSecret(fake.client, "ws-1");

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toMatchObject({
      table: "vault",
      patch: { name: "zernio_webhook_secret" },
    });
  });

  it("si no se puede guardar, LANZA en vez de devolver el secreto", async () => {
    // Registrar en Zernio un secreto que no quedo guardado deja todos los
    // webhooks entrantes rechazados con 401, y sin nada que lo explique.
    const fake = makeFakeSupabase({ vault: null, storeFalla: "sin permiso" });

    await expect(getOrCreateWorkspaceWebhookSecret(fake.client, "ws-1")).rejects.toThrow(
      /no pude guardar el secreto/i,
    );
  });
});

describe("verifyWebhookSignature (AC4)", () => {
  const secret = "workspace-secret";
  const body = '{"event":"message.received"}';
  const validSig = createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid HMAC-SHA256 signature", () => {
    expect(verifyWebhookSignature(secret, body, validSig)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyWebhookSignature(secret, body, "deadbeef")).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyWebhookSignature(secret, body, null)).toBe(false);
  });

  it("rejects when the body was tampered with", () => {
    expect(verifyWebhookSignature(secret, '{"event":"other"}', validSig)).toBe(false);
  });
});

// ── Etapa 2, F5: el secreto se muda a Vault ────────────────────────────────

/**
 * Un cliente que ademas responde la RPC de Vault. Los tres casos que importan
 * son: lo hay en Vault, no lo hay, y Vault se cayo.
 */
function supabaseConVault(options: { vault?: string | null; vaultFalla?: boolean }) {
  const consultas: string[] = [];
  const client = {
    rpc(name: string) {
      consultas.push(`rpc:${name}`);
      if (options.vaultFalla) {
        return Promise.resolve({ data: null, error: { message: "vault caido" } });
      }
      return Promise.resolve({ data: options.vault ?? null, error: null });
    },
    from(table: string) {
      consultas.push(`from:${table}`);
      throw new Error(`no deberia consultar ${table}`);
    },
  };
  return { client: client as unknown as SupabaseClient, consultas };
}

describe("resolveWebhookSecret: solo Vault (F5, 00090)", () => {
  it("el secreto sale de Vault y no se consulta ninguna tabla", async () => {
    const fake = supabaseConVault({ vault: "secreto-de-vault" });

    const secret = await resolveWebhookSecret(fake.client, {
      workspace_id: "ws-1",
      webhook_secret: "secreto-del-canal",
    });

    expect(secret).toBe("secreto-de-vault");
    expect(fake.consultas).toEqual(["rpc:read_secret"]);
  });

  it("el secreto viejo del canal YA NO vale", async () => {
    // CAMBIO DOCUMENTADO (00090). Habia dos respaldos en columnas para que
    // Instagram siguiera entrando mientras el secreto no estuviera en Vault.
    // El secreto se movio y las columnas se borraron.
    const fake = supabaseConVault({ vault: null });

    expect(
      await resolveWebhookSecret(fake.client, {
        workspace_id: "ws-1",
        webhook_secret: "secreto-del-canal",
      }),
    ).toBeNull();
  });

  it("si Vault se cae, se rechaza el webhook en vez de aceptarlo a ciegas", async () => {
    // Ya no hay a donde caer. Esta URL es publica: aceptar sin verificar
    // seria peor que dejar de recibir un rato.
    const fake = supabaseConVault({ vaultFalla: true });

    expect(
      await resolveWebhookSecret(fake.client, { workspace_id: "ws-1", webhook_secret: null }),
    ).toBeNull();
  });

  it("sin secreto devuelve null y el receptor rechaza", async () => {
    const fake = supabaseConVault({ vault: null });

    expect(
      await resolveWebhookSecret(fake.client, { workspace_id: "ws-1", webhook_secret: null }),
    ).toBeNull();
  });
});
