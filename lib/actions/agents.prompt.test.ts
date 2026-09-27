import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { agentRow } from "@/lib/agent/testing/fixtures";

/**
 * La Server Action del prompt, directa (no la pantalla). Confirma el tope de
 * 32.000 server-side: 31.999 crea la versión y la activa; 32.001 se rechaza sin
 * tocar la base. El cliente puede saltearse, así que esto es lo que garantiza.
 */

vi.mock("@/lib/auth/guards", () => ({ getAdminContext: vi.fn(), isOwnerRole: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(), createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue("audit-1"), diffFields: () => null }));

import { getAdminContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { saveSystemPrompt } from "./agents";

function setup() {
  const db = memoryDb({
    agents: [agentRow({ id: "agent-1", workspace_id: "ws-1", system_prompt: "Sos el asistente de prueba.", deleted_at: null })],
    agent_prompt_versions: [],
  });
  vi.mocked(getAdminContext).mockResolvedValue({
    workspace: { id: "ws-1" },
    supabase: db.client,
    user: { id: "user-1" },
    role: "owner",
  } as never);
  vi.mocked(createServiceClient).mockResolvedValue(db.client as never);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveSystemPrompt: tope de 32.000 en el servidor", () => {
  it("31.999 caracteres se guarda como versión nueva y se activa", async () => {
    const db = setup();
    const result = await saveSystemPrompt("agent-1", "a".repeat(31_999));
    expect(result.ok).toBe(true);
    expect(db.rows("agent_prompt_versions")).toHaveLength(1);
    expect((db.rows("agent_prompt_versions")[0].system_prompt as string).length).toBe(31_999);
    expect(db.rows("agents")[0].active_prompt_version).toBe(1);
    expect((db.rows("agents")[0].system_prompt as string).length).toBe(31_999);
  });

  it("32.001 caracteres se rechaza con mensaje claro y no toca la base", async () => {
    const db = setup();
    const result = await saveSystemPrompt("agent-1", "a".repeat(32_001));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("32000");
    expect(db.rows("agent_prompt_versions")).toHaveLength(0);
    expect(db.rows("agents")[0].system_prompt).toBe("Sos el asistente de prueba.");
  });
});
