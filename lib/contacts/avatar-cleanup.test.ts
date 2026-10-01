/**
 * Retencion de las fotos de perfil (F16).
 */

import { describe, it, expect } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { planContactAvatarCleanup, cleanupContactAvatars, AVATAR_RETENTION_DAYS } from "./avatar-cleanup";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe("planContactAvatarCleanup", () => {
  it("un contacto sin interaccion en 180 dias entra en el plan", () => {
    const plans = planContactAvatarCleanup({
      workspaceId: "ws-1",
      contacts: [{ id: "c-1", last_interaction_at: daysAgo(200) }],
      retentionDays: AVATAR_RETENTION_DAYS,
      now: NOW,
    });
    expect(plans).toEqual([{ contactId: "c-1", path: "ws-1/contacts/c-1.jpg" }]);
  });

  it("un contacto reciente no entra", () => {
    const plans = planContactAvatarCleanup({
      workspaceId: "ws-1",
      contacts: [{ id: "c-1", last_interaction_at: daysAgo(10) }],
      retentionDays: AVATAR_RETENTION_DAYS,
      now: NOW,
    });
    expect(plans).toEqual([]);
  });

  it("justo en el limite todavia no", () => {
    const plans = planContactAvatarCleanup({
      workspaceId: "ws-1",
      contacts: [{ id: "c-1", last_interaction_at: daysAgo(AVATAR_RETENTION_DAYS) }],
      retentionDays: AVATAR_RETENTION_DAYS,
      now: NOW,
    });
    expect(plans).toEqual([]);
  });

  it("sin last_interaction_at se trata como elegible: no hay evidencia de actividad", () => {
    const plans = planContactAvatarCleanup({
      workspaceId: "ws-1",
      contacts: [{ id: "c-1", last_interaction_at: null }],
      retentionDays: AVATAR_RETENTION_DAYS,
      now: NOW,
    });
    expect(plans).toHaveLength(1);
  });

  it("retentionDays 0 no borra nunca", () => {
    expect(
      planContactAvatarCleanup({
        workspaceId: "ws-1",
        contacts: [{ id: "c-1", last_interaction_at: daysAgo(1000) }],
        retentionDays: 0,
        now: NOW,
      }),
    ).toEqual([]);
  });
});

function db(contacts: Array<Record<string, unknown>> = []) {
  const memory = memoryDb({
    workspaces: [{ id: "ws-1" }],
    contacts,
  });
  const removed: string[][] = [];
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      remove: async (paths: string[]) => {
        removed.push(paths);
        return { error: null };
      },
    }),
  };
  return { memory, removed };
}

describe("cleanupContactAvatars", () => {
  it("borra el archivo y deja avatar_url en null, sin tocar avatar_source", async () => {
    const { memory, removed } = db([
      { id: "c-1", workspace_id: "ws-1", avatar_source: "storage", avatar_url: "https://x/c-1.jpg", last_interaction_at: daysAgo(200) },
    ]);

    const result = await cleanupContactAvatars(memory.client, NOW);

    expect(result).toEqual({ cleanedContacts: 1 });
    expect(removed[0]).toEqual(["ws-1/contacts/c-1.jpg"]);
    const row = memory.rows("contacts")[0];
    expect(row.avatar_url).toBeNull();
    expect(row.avatar_source).toBe("storage");
  });

  it("una foto manual o external no se toca: el filtro ya es por avatar_source='storage' en la consulta", async () => {
    const { memory, removed } = db([
      { id: "c-1", workspace_id: "ws-1", avatar_source: "manual", avatar_url: "https://x/manual.jpg", last_interaction_at: daysAgo(400) },
      { id: "c-2", workspace_id: "ws-1", avatar_source: "external", avatar_url: "https://cdn/x.jpg", last_interaction_at: daysAgo(400) },
    ]);

    await cleanupContactAvatars(memory.client, NOW);

    expect(removed).toHaveLength(0);
  });

  it("un contacto reciente no se toca", async () => {
    const { memory, removed } = db([
      { id: "c-1", workspace_id: "ws-1", avatar_source: "storage", avatar_url: "https://x/c-1.jpg", last_interaction_at: daysAgo(5) },
    ]);

    await cleanupContactAvatars(memory.client, NOW);

    expect(removed).toHaveLength(0);
  });
});
