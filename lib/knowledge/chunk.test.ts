import { describe, it, expect } from "vitest";
import {
  chunkMarkdown,
  DEFAULT_CHUNK_SIZE,
  MIN_CHUNK_CHARS,
} from "./chunk";

const parrafo = (n: number, len = 100) => `P${n} ` + "palabra ".repeat(Math.ceil(len / 8));

describe("chunkMarkdown", () => {
  it("un documento vacio no genera fragmentos", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   \n\n  ")).toEqual([]);
  });

  it("un documento corto entra en un solo fragmento", () => {
    const chunks = chunkMarkdown("Los precios arrancan en 500 dolares por mes.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].content).toContain("500 dolares");
  });

  it("un documento corto se indexa aunque no llegue al minimo", () => {
    // Es corto, pero es todo lo que hay: no indexarlo seria perderlo.
    const chunks = chunkMarkdown("Hola.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Hola.");
  });

  it("numera los fragmentos en orden y sin huecos", () => {
    const doc = Array.from({ length: 40 }, (_, i) => parrafo(i, 200)).join("\n\n");
    const chunks = chunkMarkdown(doc);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("ningun fragmento se pasa mucho del tamano objetivo", () => {
    const doc = Array.from({ length: 40 }, (_, i) => parrafo(i, 300)).join("\n\n");
    const chunks = chunkMarkdown(doc, { chunkSize: 1000, overlap: 100 });

    for (const c of chunks) {
      // El solapamiento se suma arriba del tamano, por eso el margen.
      expect(c.content.length).toBeLessThanOrEqual(1000 + 100 + 10);
    }
  });

  it("corta por parrafo cuando puede: no parte una frase al medio", () => {
    const doc = [
      "El plan basico cuesta 500 dolares por mes.",
      "El plan avanzado cuesta 1200 dolares por mes.",
    ].join("\n\n");

    const chunks = chunkMarkdown(doc, { chunkSize: 50, overlap: 0 });

    // Cada precio queda entero en algun fragmento.
    expect(chunks.some((c) => c.content.includes("500 dolares por mes."))).toBe(true);
    expect(chunks.some((c) => c.content.includes("1200 dolares por mes."))).toBe(true);
  });

  it("parte un parrafo gigante por final de oracion", () => {
    const doc = Array.from({ length: 60 }, (_, i) => `Esta es la oracion numero ${i}.`).join(" ");
    const chunks = chunkMarkdown(doc, { chunkSize: 300, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    // Cortar por oracion significa terminar en puntuacion, no a mitad de palabra.
    for (const c of chunks) expect(c.content.trim()).toMatch(/[.!?]$/);
  });

  it("un texto sin puntuacion igual se trocea en vez de perderse", () => {
    // Una tabla, una lista sin puntos, un idioma sin punto final.
    const doc = "dato ".repeat(2000);
    const chunks = chunkMarkdown(doc, { chunkSize: 500, overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.content).join("")).toContain("dato");
  });

  it("solapa: el final de un fragmento reaparece al principio del siguiente", () => {
    // Si la respuesta cae justo en el limite, sin solapamiento no la tiene nadie.
    const doc = Array.from({ length: 30 }, (_, i) => parrafo(i, 200)).join("\n\n");
    const chunks = chunkMarkdown(doc, { chunkSize: 800, overlap: 150 });

    expect(chunks.length).toBeGreaterThan(1);

    const finalDelPrimero = chunks[0].content.slice(-100);
    const primerasPalabras = finalDelPrimero.trim().split(/\s+/).slice(-3).join(" ");
    expect(chunks[1].content).toContain(primerasPalabras);
  });

  it("sin solapamiento no repite contenido", () => {
    const doc = Array.from({ length: 10 }, (_, i) => parrafo(i, 200)).join("\n\n");
    const chunks = chunkMarkdown(doc, { chunkSize: 500, overlap: 0 });

    const total = chunks.reduce((sum, c) => sum + c.content.length, 0);
    // Sin solapamiento el total no puede superar al original por mucho.
    expect(total).toBeLessThanOrEqual(doc.length + chunks.length * 4);
  });

  it("un solapamiento absurdo no cuelga el troceo", () => {
    // Si overlap >= chunkSize, cada fragmento empezaria donde empezo el
    // anterior y esto no terminaria nunca. Se recorta a la mitad del tamano.
    const doc = Array.from({ length: 20 }, (_, i) => parrafo(i, 200)).join("\n\n");
    const chunks = chunkMarkdown(doc, { chunkSize: 400, overlap: 9999 });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(200);
  });

  it("no deja fragmentos basura sueltos", () => {
    const doc = [parrafo(1, 900), "Pagina 12", parrafo(2, 900)].join("\n\n");
    const chunks = chunkMarkdown(doc, { chunkSize: 1000, overlap: 0 });

    // "Pagina 12" no puede quedar como fragmento propio: es ruido que puede
    // ganarle a un fragmento bueno en una busqueda corta.
    expect(chunks.some((c) => c.content.trim() === "Pagina 12")).toBe(false);
    expect(chunks.some((c) => c.content.includes("Pagina 12"))).toBe(true);
  });

  it("todos los fragmentos utiles llegan al minimo", () => {
    const doc = Array.from({ length: 30 }, (_, i) => parrafo(i, 250)).join("\n\n");
    const chunks = chunkMarkdown(doc);

    for (const c of chunks) expect(c.content.length).toBeGreaterThanOrEqual(MIN_CHUNK_CHARS);
  });

  it("estima tokens en cada fragmento", () => {
    const chunks = chunkMarkdown("x".repeat(400));
    expect(chunks[0].tokenEstimate).toBe(100);
  });

  it("el tamano por defecto es el esperado", () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(1800);
  });

  it("no pierde el contenido: todo el texto aparece en algun fragmento", () => {
    const marcadores = ["ALFA-111", "BETA-222", "GAMMA-333", "DELTA-444"];
    const doc = marcadores.map((m, i) => `${m} ${parrafo(i, 600)}`).join("\n\n");
    const chunks = chunkMarkdown(doc, { chunkSize: 700, overlap: 100 });

    const todo = chunks.map((c) => c.content).join("\n");
    for (const m of marcadores) expect(todo).toContain(m);
  });
});
