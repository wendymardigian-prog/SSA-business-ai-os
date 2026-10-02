import { describe, it, expect } from "vitest";
import { runsToCsv } from "./runs-csv";
import type { RunRow } from "./screen";

function run(partial: Partial<RunRow> & { id: string }): RunRow {
  return {
    createdAt: "2026-09-28T17:00:00Z",
    completedAt: null,
    source: "agent",
    trigger: "inbound_message",
    threadId: null,
    status: "responded",
    statusDetail: null,
    routing: null,
    intent: null,
    agentId: null,
    agentName: null,
    promptVersion: null,
    conversationId: null,
    contactId: null,
    contactName: null,
    channelId: null,
    channelLabel: null,
    provider: "anthropic",
    model: "claude-sonnet-5",
    latencyMs: 1200,
    stepCount: 2,
    error: null,
    cost: null,
    steps: [],
    ...partial,
  };
}

describe("runsToCsv", () => {
  it("sin permiso de costo, no lleva las columnas de costo ni de tokens", () => {
    const csv = runsToCsv([run({ id: "r1" })], { includeCost: false });
    const [header] = csv.split("\r\n");
    expect(header).not.toContain("costo_usd");
    expect(header).not.toContain("tokens_in");
  });

  it("con permiso, las lleva, y cost_usd NULL sale vacio (no 0)", () => {
    const csv = runsToCsv([run({ id: "r1", cost: { usd: null, inputTokens: 10, outputTokens: 5, cachedTokens: 0, embeddingTokens: 0 } })], { includeCost: true });
    const [header, row] = csv.split("\r\n");
    expect(header).toContain("costo_usd");
    expect(row.endsWith(",10,5,")).toBe(true);
  });

  it("una coma o una comilla en el motivo no rompe el CSV", () => {
    const csv = runsToCsv([run({ id: "r1", error: 'primary anthropic/x: api_401, "cuidado"' })], { includeCost: false });
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('""cuidado""');
  });

  it("el encabezado es exactamente el que pide el documento", () => {
    const csv = runsToCsv([], { includeCost: true });
    expect(csv).toBe(
      "id,fecha,origen,disparador,contacto,canal,modelo,estado,motivo,pasos,duracion_ms,tokens_in,tokens_out,costo_usd",
    );
  });
});
