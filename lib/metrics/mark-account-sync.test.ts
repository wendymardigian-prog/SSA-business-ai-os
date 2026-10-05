/**
 * F75: la sincronizacion de una cuenta se sella solo si la lectura salio bien.
 * Antes `markAccountSync` sellaba `profile_synced_at` aunque hubiera fallado,
 * y la card decia "sincronizado" con datos viejos.
 */
import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { markAccountSync } from "./sync";

const now = new Date("2026-10-03T12:00:00Z");

describe("markAccountSync (F75)", () => {
  it("con lectura buena sella profile_synced_at", async () => {
    const db = memoryDb({ social_accounts: [{ id: "sa-1", profile_synced_at: null }] });
    await markAccountSync(db.client as never, { socialAccountId: "sa-1", now, error: null });
    expect(db.rows("social_accounts")[0].profile_synced_at).toBe(now.toISOString());
  });

  it("con error NO sella y deja la fecha anterior", async () => {
    const anterior = "2026-10-01T00:00:00.000Z";
    const db = memoryDb({ social_accounts: [{ id: "sa-1", profile_synced_at: anterior }] });
    await markAccountSync(db.client as never, { socialAccountId: "sa-1", now, error: "Graph caído" });
    expect(db.rows("social_accounts")[0].profile_synced_at).toBe(anterior);
  });
});
