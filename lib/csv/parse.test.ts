import { describe, it, expect } from "vitest";
import { parseCsv, detectDelimiter } from "./parse";

describe("parseCsv — lo basico", () => {
  it("separa encabezado y filas", () => {
    const r = parseCsv("nombre,email\nAna,ana@x.com\nBeto,beto@x.com");
    expect(r.headers).toEqual(["nombre", "email"]);
    expect(r.rows).toEqual([
      ["Ana", "ana@x.com"],
      ["Beto", "beto@x.com"],
    ]);
  });

  it("un archivo con solo encabezado no tiene filas", () => {
    expect(parseCsv("nombre,email").rows).toEqual([]);
  });

  it("el archivo vacio no rompe", () => {
    const r = parseCsv("");
    expect(r.headers).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  it("recorta los espacios de los nombres de columna", () => {
    expect(parseCsv(" nombre , email \nAna,ana@x.com").headers).toEqual(["nombre", "email"]);
  });
});

describe("parseCsv — comillas", () => {
  it("respeta el separador adentro de comillas", () => {
    const r = parseCsv('nombre,nota\n"Gomez, Ana","le interesa, pero espera"');
    expect(r.rows[0]).toEqual(["Gomez, Ana", "le interesa, pero espera"]);
  });

  it("las comillas dobladas son una comilla", () => {
    const r = parseCsv('nombre\n"Ana ""la jefa"" Gomez"');
    expect(r.rows[0]).toEqual(['Ana "la jefa" Gomez']);
  });

  it("acepta saltos de linea adentro de un campo", () => {
    const r = parseCsv('nombre,nota\nAna,"linea uno\nlinea dos"');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0][1]).toBe("linea uno\nlinea dos");
  });

  it("un campo entrecomillado vacio queda vacio", () => {
    expect(parseCsv('a,b\n"",x').rows[0]).toEqual(["", "x"]);
  });
});

describe("parseCsv — como sale de Excel", () => {
  it("saca el BOM del principio en vez de pegarlo al nombre de la columna", () => {
    const r = parseCsv("﻿email,nombre\nana@x.com,Ana");
    expect(r.headers).toEqual(["email", "nombre"]);
  });

  it("detecta el punto y coma del Excel en español", () => {
    const r = parseCsv("nombre;email\nAna;ana@x.com");
    expect(r.delimiter).toBe(";");
    expect(r.rows[0]).toEqual(["Ana", "ana@x.com"]);
  });

  it("detecta el tab", () => {
    expect(parseCsv("nombre\temail\nAna\tana@x.com").rows[0]).toEqual(["Ana", "ana@x.com"]);
  });

  it("maneja CRLF", () => {
    const r = parseCsv("nombre,email\r\nAna,ana@x.com\r\nBeto,beto@x.com\r\n");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]).toEqual(["Beto", "beto@x.com"]);
  });

  it("maneja CR suelto (Excel viejo de Mac)", () => {
    expect(parseCsv("nombre,email\rAna,ana@x.com").rows[0]).toEqual(["Ana", "ana@x.com"]);
  });

  it("la linea vacia del final no cuenta como fila", () => {
    expect(parseCsv("nombre\nAna\n\n").rows).toEqual([["Ana"]]);
  });
});

describe("parseCsv — filas desparejas", () => {
  it("una fila con menos columnas se conserva tal cual", () => {
    const r = parseCsv("a,b,c\n1,2");
    expect(r.rows[0]).toEqual(["1", "2"]);
  });

  it("una fila con mas columnas tampoco se recorta", () => {
    expect(parseCsv("a,b\n1,2,3").rows[0]).toEqual(["1", "2", "3"]);
  });
});

describe("parseCsv — tope de filas", () => {
  it("corta en el maximo y cuenta lo que dejo afuera", () => {
    const csv = ["a", ...Array.from({ length: 10 }, (_, i) => String(i))].join("\n");
    const r = parseCsv(csv, { maxRows: 4 });
    expect(r.rows).toHaveLength(4);
    expect(r.truncated).toBe(6);
  });

  it("sin tope no descarta nada", () => {
    expect(parseCsv("a\n1\n2\n3").truncated).toBe(0);
  });
});

describe("detectDelimiter", () => {
  it("prefiere el que mas aparece en el encabezado", () => {
    expect(detectDelimiter("a;b;c\n1,2,3")).toBe(";");
  });

  it("no cuenta separadores que estan adentro de comillas", () => {
    expect(detectDelimiter('"a;b;c;d",z\n1,2')).toBe(",");
  });

  it("con una sola columna cae en la coma", () => {
    expect(detectDelimiter("email\nana@x.com")).toBe(",");
  });
});
