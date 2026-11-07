/**
 * Cada ruta de `app/api/cron/` es publica (la llama pg_cron por HTTP) y hace trabajo con el cliente de servicio:
 * sin el chequeo del secreto, cualquiera que adivine la URL dispara el cron. Este test recorre TODAS las rutas
 * y falla si algun handler exportado no arranca con `authorizeCronRequest` (`lib/cron-auth.ts`) y su salida
 * temprana, antes de cualquier `await`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const CRON_DIR = join(ROOT, "app", "api", "cron");

function routes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routes(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const HANDLER = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=/g;
const GUARD = /const\s+(\w+)\s*=\s*authorizeCronRequest\(\s*\w+\s*\)\s*;?\s*if\s*\(\s*\1\s*\)\s*return\s+\1\b/;

/** Los problemas de los handlers de una ruta (vacio si esta bien). */
function cronRouteProblems(source: string): string[] {
  const problems: string[] = [];
  const starts = [...source.matchAll(HANDLER)];
  if (starts.length === 0) return ["no exporta ningun handler"];
  for (let i = 0; i < starts.length; i++) {
    const name = starts[i][1] ?? starts[i][2];
    const from = starts[i].index!;
    const to = i + 1 < starts.length ? starts[i + 1].index! : source.length;
    const body = source.slice(from, to);
    const guard = GUARD.exec(body);
    if (!guard) {
      problems.push(`${name} no llama a authorizeCronRequest con su salida temprana`);
      continue;
    }
    if (/\bawait\b/.test(body.slice(0, guard.index))) problems.push(`${name} hace un await antes de chequear el secreto`);
  }
  return problems;
}

describe("las rutas de cron chequean el secreto", () => {
  const files = routes(CRON_DIR);

  it("hay rutas para revisar", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("cada handler arranca con authorizeCronRequest", () => {
    const offenders = files.flatMap((f) => cronRouteProblems(readFileSync(f, "utf8")).map((p) => `${relative(ROOT, f)}: ${p}`));
    expect(offenders).toEqual([]);
  });

  it("el chequeo atrapa una ruta sin el secreto o con el chequeo tarde", () => {
    expect(cronRouteProblems(`export async function GET() { return Response.json({ ok: true }); }`)).toHaveLength(1);
    expect(
      cronRouteProblems(`export async function GET(request) {
        await trabajo();
        const denied = authorizeCronRequest(request);
        if (denied) return denied;
      }`),
    ).toEqual(["GET hace un await antes de chequear el secreto"]);
    expect(
      cronRouteProblems(`export async function GET(request) {
        const denied = authorizeCronRequest(request);
        if (denied) return denied;
        await trabajo();
      }
      export async function POST(request) { await trabajo(); }`),
    ).toEqual(["POST no llama a authorizeCronRequest con su salida temprana"]);
    expect(
      cronRouteProblems(`export async function GET(request) {
        const denied = authorizeCronRequest(request);
        if (denied) return denied;
      }`),
    ).toEqual([]);
  });
});
