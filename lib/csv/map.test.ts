import { describe, it, expect } from "vitest";
import { suggestMapping, mapRow, type ColumnMapping } from "./map";

describe("suggestMapping", () => {
  it("reconoce los nombres en ingles", () => {
    const m = suggestMapping(["name", "email", "phone"]);
    expect(m.map((c) => c.target)).toEqual(["display_name", "email", "phone"]);
  });

  it("y los nombres en castellano, que es como vienen casi siempre", () => {
    const m = suggestMapping(["Nombre", "Correo electrónico", "Celular"]);
    expect(m.map((c) => c.target)).toEqual(["display_name", "email", "phone"]);
  });

  it("no se marea con mayusculas, acentos ni puntuacion", () => {
    expect(suggestMapping(["E-Mail"])[0].target).toBe("email");
    expect(suggestMapping(["TELÉFONO"])[0].target).toBe("phone");
  });

  it("deja sin mapear la columna que no reconoce", () => {
    expect(suggestMapping(["saldo pendiente"])[0].target).toBe("");
  });

  it("no manda dos columnas al mismo campo", () => {
    // "Telefono" y "Celular" apuntan las dos a phone: la segunda queda para
    // que la persona decida, en vez de pisar la primera en silencio.
    const m = suggestMapping(["Telefono", "Celular"]);
    expect(m[0].target).toBe("phone");
    expect(m[1].target).toBe("");
  });

  it("reconoce la columna de tags", () => {
    expect(suggestMapping(["Etiquetas"])[0].target).toBe("tags");
  });
});

const mapping: ColumnMapping[] = [
  { header: "nombre", target: "display_name" },
  { header: "email", target: "email" },
  { header: "telefono", target: "phone" },
  { header: "etiquetas", target: "tags" },
];

describe("mapRow", () => {
  it("arma el contacto con lo que trae la fila", () => {
    const r = mapRow(["Ana Gomez", "ana@x.com", "+54 9 11 2233 4455", ""], mapping, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.patch.display_name).toBe("Ana Gomez");
    expect(r.row.patch.email).toBe("ana@x.com");
    expect(r.row.patch.phone).toBe("+5491122334455");
  });

  it("normaliza el telefono a + y digitos", () => {
    const r = mapRow(["Ana", "", "(011) 4567-8900", ""], mapping, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.patch.phone).toMatch(/^\+?\d+$/);
  });

  it("parte los tags de una celda", () => {
    const r = mapRow(["Ana", "ana@x.com", "", "vip, caliente; recomendado"], mapping, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.tags).toEqual(["vip", "caliente", "recomendado"]);
  });

  it("no repite un tag que viene dos veces", () => {
    const r = mapRow(["Ana", "ana@x.com", "", "vip,vip"], mapping, 0);
    expect(r.ok && r.row.tags).toEqual(["vip"]);
  });

  it("rechaza un email con formato invalido", () => {
    const r = mapRow(["Ana", "ana-arroba-x.com", "", ""], mapping, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Email");
  });

  it("rechaza la fila sin email ni telefono, que no se podria deduplicar", () => {
    const r = mapRow(["Ana Sola", "", "", "vip"], mapping, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("email");
  });

  it("con solo email alcanza", () => {
    expect(mapRow(["", "ana@x.com", "", ""], mapping, 0).ok).toBe(true);
  });

  it("con solo telefono tambien", () => {
    expect(mapRow(["", "", "+5491122334455", ""], mapping, 0).ok).toBe(true);
  });

  it("ignora las columnas sin mapear", () => {
    const conExtra: ColumnMapping[] = [...mapping, { header: "saldo", target: "" }];
    const r = mapRow(["Ana", "ana@x.com", "", "", "99999"], conExtra, 0);
    expect(r.ok).toBe(true);
  });

  it("una celda vacia no pisa el campo con vacio", () => {
    const r = mapRow(["", "ana@x.com", "", ""], mapping, 0);
    expect(r.ok && "display_name" in r.row.patch).toBe(false);
  });

  it("una fila mas corta que el mapeo no rompe", () => {
    expect(mapRow(["Ana", "ana@x.com"], mapping, 0).ok).toBe(true);
  });
});

describe("numero de fila del error", () => {
  it("la primera fila de datos es la 2, como la ve la persona en la planilla", () => {
    const r = mapRow(["Ana", "", "", ""], mapping, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.line).toBe(2);
  });

  it("y la decima fila de datos es la 11", () => {
    const r = mapRow(["Ana", "", "", ""], mapping, 9);
    expect(r.ok ? null : r.line).toBe(11);
  });

  it("las filas buenas tambien reportan su numero", () => {
    const r = mapRow(["Ana", "ana@x.com", "", ""], mapping, 4);
    expect(r.ok && r.row.line).toBe(6);
  });
});
