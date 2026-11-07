import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { readSecret, storeSecret } = vi.hoisted(() => ({ readSecret: vi.fn(), storeSecret: vi.fn() }));
vi.mock("@/lib/vault", () => ({ readSecret, storeSecret }));

import { getOrCreateSecret } from "./vault-get-or-create";

const db = {} as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrCreateSecret", () => {
  it("si ya hay una, la devuelve y no guarda nada", async () => {
    readSecret.mockResolvedValue("guardada");
    await expect(getOrCreateSecret(db, "w1", "forms_link_secret", "de los links")).resolves.toBe("guardada");
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("un error de Vault al leer sube y NO pisa la guardada", async () => {
    readSecret.mockRejectedValue(new Error("vault caido"));
    await expect(getOrCreateSecret(db, "w1", "forms_link_secret", "de los links")).rejects.toThrow("vault caido");
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("la primera vez la crea y devuelve lo que quedo guardado (otro primer uso pudo ganar)", async () => {
    readSecret.mockResolvedValueOnce(null).mockResolvedValueOnce("la-que-gano");
    storeSecret.mockResolvedValue({ ok: true });
    await expect(getOrCreateSecret(db, "w1", "forms_link_secret", "de los links")).resolves.toBe("la-que-gano");
    expect(storeSecret).toHaveBeenCalledTimes(1);
  });

  it("si no se pudo guardar, lanza", async () => {
    readSecret.mockResolvedValue(null);
    storeSecret.mockResolvedValue({ ok: false, error: "sin permiso" });
    await expect(getOrCreateSecret(db, "w1", "forms_link_secret", "de los links")).rejects.toThrow("sin permiso");
  });
});
