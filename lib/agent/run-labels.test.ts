import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { describeModelError, describeRunDetail, RUN_SOURCE_LABELS } from "./run-labels";

/**
 * Los valores del CHECK vigente de agent_runs.source, leidos de las
 * migraciones (Bloque A4). Cada redefinicion (`ADD CONSTRAINT
 * agent_runs_source_check`) reemplaza a la anterior; se lee en orden y se
 * queda con la ultima, igual que hace la base de verdad.
 */
function sourceCheckValues(): string[] {
  const dir = join(process.cwd(), "supabase/migrations");
  let values: string[] | null = null;
  for (const file of readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/ADD CONSTRAINT agent_runs_source_check\s+CHECK\s*\(\s*source\s+IN\s*\(([^)]+)\)/gi)) {
      values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
  }
  if (!values) throw new Error("no encontre agent_runs_source_check en las migraciones");
  return values;
}

/**
 * Lo que lee una persona cuando el agente no pudo contestar.
 *
 * El error crudo se conserva al final (sirve para depurar), pero adelante va
 * que hay que hacer. "AI_APICallError" no le dice a nadie que tiene que ir a
 * cambiar la API key.
 */

describe("describeModelError", () => {
  it("una key rechazada manda a Integraciones, nombrando al proveedor", () => {
    const texto = describeModelError(
      "primary anthropic/claude-sonnet-5: api_401:authentication_error; " +
        "fallback anthropic/claude-haiku-4-5: skipped_same_provider_auth",
    );

    expect(texto).toContain("API key de Anthropic");
    expect(texto).toContain("Ajustes > Integraciones");
    // El detalle tecnico no se pierde.
    expect(texto).toContain("api_401");
  });

  it("un 404 nombra el modelo que no existe", () => {
    const texto = describeModelError("primary anthropic/claude-inventado-9: api_404:not_found_error");
    expect(texto).toContain("claude-inventado-9");
    expect(texto).toContain("no existe");
  });

  it("un 429 explica que suele resolverse solo", () => {
    expect(describeModelError("primary openai/gpt-5: api_429")).toContain("limite de uso de OpenAI");
  });

  it("un 5xx aclara que no hay nada que arreglar de este lado", () => {
    expect(describeModelError("primary anthropic/claude-sonnet-5: api_529:overloaded_error")).toContain("caido");
  });

  it("un timeout sugiere subir el timeout", () => {
    expect(describeModelError("primary anthropic/claude-opus-5: timeout")).toContain("timeout");
  });

  it("un proveedor desconectado manda a conectarlo", () => {
    expect(describeModelError("fallback openai/gpt-5: provider_unavailable")).toContain("no esta conectado");
  });

  it("sin error no inventa nada", () => {
    expect(describeModelError(null)).toBe("");
    expect(describeModelError("")).toBe("");
  });

  it("un error que no reconoce se muestra tal cual", () => {
    expect(describeModelError("algo completamente nuevo")).toBe("algo completamente nuevo");
  });
});

describe("describeRunDetail", () => {
  it("traduce el salteo del respaldo por key rechazada", () => {
    expect(describeRunDetail("skipped_same_provider_auth")).toEqual([
      "no se intento el respaldo: mismo proveedor, y la key ya habia sido rechazada",
    ]);
  });
});

describe("RUN_SOURCE_LABELS (A4)", () => {
  it("las migraciones se leen bien (si esto falla, el parser quedo viejo)", () => {
    expect(sourceCheckValues()).toContain("audio_transcription");
  });

  it("tiene etiqueta para los 11 valores del CHECK, ninguno de mas", () => {
    expect(Object.keys(RUN_SOURCE_LABELS).sort()).toEqual([...sourceCheckValues()].sort());
  });

  it("ninguna etiqueta queda igual al valor crudo (la gracia es traducirlo)", () => {
    for (const [source, label] of Object.entries(RUN_SOURCE_LABELS)) expect(label).not.toBe(source);
  });
});
