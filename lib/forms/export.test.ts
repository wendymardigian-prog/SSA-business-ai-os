import { describe, it, expect } from "vitest";
import { attributionColumns, buildExportFilename, buildResponsesCsv, buildResponsesMatrix, csvEscape, protectCell, toCsv } from "./export";
import type { ResponseColumn, ResponseRow } from "./responses";

const columns: ResponseColumn[] = [
  { key: "nombre", label: "Nombre", type: "short_text", removed: false },
  { key: "intereses", label: "Intereses", type: "multi_select", removed: false },
];

const row = (over: Partial<ResponseRow> = {}): ResponseRow => ({
  id: "1",
  created_at: "2026-10-10T05:30:00Z",
  status: "received",
  contact_id: "c1",
  contact_name: "Ana",
  contact_email: "ana@x.com",
  answers: {
    nombre: { label: "Nombre", type: "short_text", value: "Ana" },
    intereses: { label: "Intereses", type: "multi_select", value: ["A", "B"] },
  },
  ...over,
});

const opts = { formatDate: (iso: string) => `FMT(${iso})` };

describe("protección contra inyección de fórmulas", () => {
  it("un valor que empieza con =SUM( queda como '=SUM(", () => {
    expect(protectCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    for (const v of ["+1", "-1", "@cmd", "\tx"]) expect(protectCell(v)).toBe(`'${v}`);
    expect(protectCell("Ana")).toBe("Ana");
  });

  it("el CSV lleva la protección", () => {
    const r = row({ answers: { nombre: { label: "Nombre", type: "short_text", value: "=HYPERLINK(\"http://x\")" } } });
    const { csv } = buildResponsesCsv([r], columns, opts);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe("CSV", () => {
  it("lleva BOM UTF-8 y escapa comas, comillas y saltos", () => {
    const csv = toCsv([["a", 'b,"c"', "d\ne"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('a,"b,""c""","d\ne"');
    expect(csvEscape("simple")).toBe("simple");
  });

  it("múltiples unidas por '; '", () => {
    const matrix = buildResponsesMatrix([row()], columns, opts);
    expect(matrix[1]).toContain("A; B");
  });

  it("cabecera con las columnas fijas y las del formulario", () => {
    const matrix = buildResponsesMatrix([row()], columns, opts);
    expect(matrix[0]).toEqual(["Fecha", "Contacto", "Email del contacto", "Estado", "Nombre", "Intereses"]);
    expect(matrix[1].slice(0, 4)).toEqual(["FMT(2026-10-10T05:30:00Z)", "Ana", "ana@x.com", "Recibida"]);
  });

  it("encuestas suman puntaje y contratos el estado del email", () => {
    const matrix = buildResponsesMatrix(
      [row({ score: 4, nps_category: "detractor", email_status: "sent" })],
      columns,
      { ...opts, includeScore: true, includeEmailStatus: true },
    );
    expect(matrix[0]).toContain("Puntaje");
    expect(matrix[0]).toContain("Email del contrato");
    expect(matrix[1]).toContain("4");
    expect(matrix[1]).toContain("Enviado");
  });

  it("tope de 10.000 filas con aviso", () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => row({ id: String(i) }));
    const result = buildResponsesCsv(rows, columns, opts);
    expect(result.truncated).toBe(true);
    expect(result.rows).toBe(10_000);
    expect(buildResponsesCsv([row()], columns, opts).truncated).toBe(false);
  });
});

describe("atribución en el CSV (F33)", () => {
  it("suma solo las columnas de atribución que tienen algún valor", () => {
    const rows = [row({ attribution: { utm_source: "meta", fbclid: "abc" } }), row({ attribution: { utm_source: "google" } })];
    expect(attributionColumns(rows)).toEqual(["utm_source", "fbclid"]);
    const matrix = buildResponsesMatrix(rows, columns, opts);
    expect(matrix[0].slice(-2)).toEqual(["Atribución: utm_source", "Atribución: fbclid"]);
    expect(matrix[2].slice(-2)).toEqual(["google", ""]);
  });

  it("sin atribución no suma columnas", () => {
    expect(attributionColumns([row({ attribution: {} }), row({ attribution: null })])).toEqual([]);
  });
});

describe("buildExportFilename", () => {
  it("nombre seguro y con extensión csv", () => {
    expect(buildExportFilename("Aplicación al programa", "todos", "2026-10-10")).toBe("aplicacion_al_programa_todos_2026-10-10.csv");
    expect(buildExportFilename("¿¿??", "todos", "2026-10-10")).toBe("respuestas_todos_2026-10-10.csv");
  });
});
