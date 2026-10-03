import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { AGENT_RUN_COST_COLUMNS, AGENT_RUN_PUBLIC_COLUMNS, channelAgentInfo } from "./public";

/**
 * Lee las migraciones en orden y reconstruye dos cosas de agent_runs: las
 * columnas que existen (CREATE TABLE + ADD COLUMN) y las que authenticated
 * puede leer (los GRANT SELECT de columna despues del ultimo REVOKE ALL).
 * Es lo que la base hace de verdad; la constante tiene que coincidir.
 */
function agentRunsSchemaFromMigrations() {
  const dir = join(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const columns = new Set<string>();
  let granted = new Set<string>();

  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");

    const create = sql.search(/CREATE TABLE IF NOT EXISTS public\.agent_runs\s*\(/i);
    if (create >= 0) {
      // El cuerpo entre parentesis balanceados (numeric(12,6) y DEFAULT now() adentro).
      let i = sql.indexOf("(", create);
      const start = i + 1;
      let depth = 0;
      for (; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")" && --depth === 0) break;
      }
      let part = "";
      depth = 0;
      const defs: string[] = [];
      for (const ch of sql.slice(start, i)) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          defs.push(part);
          part = "";
        } else part += ch;
      }
      defs.push(part);
      for (const def of defs) {
        const name = def.trim().split(/\s+/)[0]?.toLowerCase();
        if (name && !["constraint", "primary", "unique", "check", "foreign"].includes(name)) columns.add(name);
      }
    }

    for (const stmt of sql.matchAll(/ALTER TABLE (?:IF EXISTS )?public\.agent_runs\b([^;]*);/gi)) {
      for (const add of stmt[1].matchAll(/ADD COLUMN (?:IF NOT EXISTS )?(\w+)/gi)) columns.add(add[1].toLowerCase());
    }

    for (const stmt of sql.matchAll(/(REVOKE ALL ON (?:TABLE )?public\.agent_runs FROM [^;]*authenticated[^;]*;)|GRANT SELECT\s*\(([^)]*)\)\s*ON (?:TABLE )?public\.agent_runs TO authenticated/gi)) {
      if (stmt[1]) granted = new Set();
      else for (const col of stmt[2].split(",")) granted.add(col.trim().toLowerCase());
    }
  }
  return { columns, granted };
}

describe("columnas publicas de agent_runs", () => {
  const cols = AGENT_RUN_PUBLIC_COLUMNS.split(",").map((c) => c.trim());
  const { columns, granted } = agentRunsSchemaFromMigrations();

  it("no incluyen ninguna columna de tokens ni de costo (un select con ellas falla para cualquier usuario)", () => {
    for (const cost of AGENT_RUN_COST_COLUMNS) expect(cols).not.toContain(cost);
    expect(cols).not.toContain("*");
  });

  it("las migraciones se leen bien (si esto falla, el parser quedo viejo, no la constante)", () => {
    expect(columns.has("cost_usd")).toBe(true);
    expect(columns.has("audio_seconds")).toBe(true);
    expect(granted.has("id")).toBe(true);
  });

  it("toda columna publica tiene GRANT de lectura para authenticated: si no, el select entero falla", () => {
    for (const col of cols) expect(granted, `sin GRANT: ${col}`).toContain(col);
  });

  it("ninguna columna de costo tiene GRANT: el muro de privilegios sigue en pie", () => {
    for (const col of AGENT_RUN_COST_COLUMNS) expect(granted, `con GRANT: ${col}`).not.toContain(col);
  });

  it("toda columna otorgada esta en la constante: lo que la base deja leer, la pantalla lo pide", () => {
    expect([...granted].sort()).toEqual([...cols].sort());
  });

  it("toda columna de agent_runs es publica o de costo: una columna nueva tiene que clasificarse", () => {
    const classified = new Set<string>([...cols, ...AGENT_RUN_COST_COLUMNS]);
    expect([...columns].filter((c) => !classified.has(c))).toEqual([]);
  });
});

describe("toggle de la bandeja segun el maestro del canal", () => {
  const agent = { id: "a", name: "Asistente", type: "chat", is_enabled: true, enabled_channel_ids: ["ch-ig"], deleted_at: null };

  it("canal atendido: el toggle se puede operar", () => {
    expect(channelAgentInfo([agent], { id: "ch-ig", label: "Instagram" })).toMatchObject({ available: true });
  });

  it("maestro apagado: bloqueado en off con el motivo a la vista", () => {
    const info = channelAgentInfo([agent], { id: "ch-wa", label: "WhatsApp" });
    expect(info).toMatchObject({ available: false, reason: "channel_off" });
    expect(info.message).toContain("apagado para WhatsApp");
  });

  it("agente apagado globalmente", () => {
    expect(channelAgentInfo([{ ...agent, is_enabled: false }], { id: "ch-ig", label: "Instagram" })).toMatchObject({
      available: false,
      reason: "agent_off",
    });
  });

  it("sin agente", () => {
    expect(channelAgentInfo([], { id: "ch-ig", label: "Instagram" })).toMatchObject({ reason: "no_agent" });
  });
});

describe("modo del canal en la bandeja (00070)", () => {
  const base = { id: "a-1", name: "Agente", type: "chat", is_enabled: true, enabled_channel_ids: ["ch-ig"], deleted_at: null };

  it("sin entrada, el canal envia directo", () => {
    expect(channelAgentInfo([base], { id: "ch-ig", label: "Instagram" }).mode).toBe("send");
  });
  it("en draft, la bandeja lo sabe", () => {
    const agent = { ...base, channel_modes: { "ch-ig": "draft" } };
    expect(channelAgentInfo([agent], { id: "ch-ig", label: "Instagram" }).mode).toBe("draft");
  });
});
