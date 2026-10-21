import { describe, expect, it, vi } from "vitest";
import { loadContractCopy, type CopyDownloadDeps } from "./copy-download";
import { createCopyToken } from "./copy-link";

const SECRET = "clave";
const FORM = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SUB = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-10-21T12:00:00Z");

type Row = Record<string, unknown>;

/** Una base chica en memoria con lo que lee `loadContractCopy` (select + eq/ilike + maybeSingle). */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const chain = {
        select: () => chain,
        eq: (col: string, value: unknown) => (filters.push((r) => r[col] === value), chain),
        ilike: (col: string, value: string) => (filters.push((r) => String(r[col]).toLowerCase() === value.toLowerCase()), chain),
        maybeSingle: async () => ({ data: (tables[table] ?? []).find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      };
      return chain;
    },
  } as unknown as CopyDownloadDeps["db"];
}

function setup(signature: Row | null, over: Partial<CopyDownloadDeps> = {}) {
  const tables: Record<string, Row[]> = {
    forms: [{ id: FORM, workspace_id: "w1", type: "contract", name: "Contrato de servicios", slug: "contrato", contract_config: { title: "Acuerdo de Servicios" } }],
    contract_signatures: signature ? [{ id: "sig1", submission_id: SUB, form_id: FORM, form_version_id: "v1", ...signature }] : [],
    form_versions: [{ id: "v1", version_number: 3 }],
  };
  const deps: CopyDownloadDeps = {
    db: fakeDb(tables),
    storage: { download: vi.fn(async () => new Uint8Array([37, 80, 68, 70])), upload: vi.fn(async () => true) },
    readLinkSecret: async () => SECRET,
    runPdf: vi.fn(async () => {
      Object.assign(tables.contract_signatures[0], { pdf_status: "generated", pdf_path: "w1/f/sig1/contrato.pdf" });
      return "generated" as const;
    }),
    now: NOW,
    ...over,
  };
  return { deps, tables };
}

const token = (over: { formId?: string; now?: number } = {}) => createCopyToken({ submissionId: SUB, formId: over.formId ?? FORM, now: over.now ?? NOW }, SECRET);

describe("loadContractCopy", () => {
  it("con el PDF listo lo entrega con un nombre de archivo limpio", async () => {
    const { deps } = setup({ pdf_status: "generated", pdf_path: "w1/f/sig1/contrato.pdf" });
    const result = await loadContractCopy(deps, { slug: "contrato", token: token() });
    expect(result).toMatchObject({ kind: "pdf", filename: "acuerdo-de-servicios-firmado-v3.pdf" });
    expect(deps.runPdf).not.toHaveBeenCalled();
  });

  it("si el PDF todavía no se generó, lo arma en el momento y lo entrega", async () => {
    const { deps } = setup({ pdf_status: "pending", pdf_path: null });
    const result = await loadContractCopy(deps, { slug: "contrato", token: token() });
    expect(deps.runPdf).toHaveBeenCalledWith("sig1");
    expect(result.kind).toBe("pdf");
  });

  it("si sigue sin estar, dice pending (el navegador vuelve a preguntar)", async () => {
    const { deps } = setup({ pdf_status: "pending", pdf_path: null }, { runPdf: vi.fn(async () => "retry_scheduled" as const) });
    expect(await loadContractCopy(deps, { slug: "contrato", token: token() })).toEqual({ kind: "pending" });
  });

  it("uno que falló no se vuelve a armar acá (ya tiene sus reintentos)", async () => {
    const { deps } = setup({ pdf_status: "failed", pdf_path: null });
    expect(await loadContractCopy(deps, { slug: "contrato", token: token() })).toEqual({ kind: "pending" });
    expect(deps.runPdf).not.toHaveBeenCalled();
  });

  it("un token vencido, de otro formulario, sin clave o sin firma no entrega nada", async () => {
    const { deps } = setup({ pdf_status: "generated", pdf_path: "x.pdf" });
    expect(await loadContractCopy(deps, { slug: "contrato", token: token({ now: NOW - 25 * 3_600_000 }) })).toEqual({ kind: "not_found" });
    expect(await loadContractCopy(deps, { slug: "contrato", token: token({ formId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000000" }) })).toEqual({ kind: "not_found" });
    expect(await loadContractCopy(deps, { slug: "contrato", token: null })).toEqual({ kind: "not_found" });
    expect(await loadContractCopy(deps, { slug: "otro", token: token() })).toEqual({ kind: "not_found" });
    expect(await loadContractCopy(deps, { slug: "../x", token: token() })).toEqual({ kind: "not_found" });
    const noSecret = setup({ pdf_status: "generated", pdf_path: "x.pdf" }, { readLinkSecret: async () => null });
    expect(await loadContractCopy(noSecret.deps, { slug: "contrato", token: token() })).toEqual({ kind: "not_found" });
    const noSig = setup(null);
    expect(await loadContractCopy(noSig.deps, { slug: "contrato", token: token() })).toEqual({ kind: "not_found" });
  });
});
