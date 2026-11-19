import { describe, expect, it } from "vitest";
import { actorName, approverName } from "./audit-history";

describe("historial: lo que hace un agente, con quién lo aprobó", () => {
  const names = { users: { "u-1": "Persona A" }, agents: { "a-1": "Agente de chat" } };
  const base = { performed_by: null, actor_type: "agent" as const, actor_label: null };

  it("el autor es el agente y se nombra a quien aprobó", () => {
    const row = { ...base, performed_by_agent_id: "a-1", metadata: { approved_by: "u-1", proposal_id: "p-1" } };
    expect(actorName(row, names)).toBe("Agente de chat");
    expect(approverName(row, names)).toBe("Persona A");
  });

  it("sin aprobación (o sin agente), no hay aprobador", () => {
    expect(approverName({ performed_by_agent_id: "a-1", metadata: { origin: "tool" } }, names)).toBeNull();
    expect(approverName({ performed_by_agent_id: null, metadata: { approved_by: "u-1" } }, names)).toBeNull();
    expect(approverName({ performed_by_agent_id: "a-1", metadata: null }, names)).toBeNull();
  });

  it("una persona que ya no está en el equipo: «Alguien del equipo»", () => {
    expect(approverName({ performed_by_agent_id: "a-1", metadata: { approved_by: "u-9" } }, names)).toBe("Alguien del equipo");
  });
});
