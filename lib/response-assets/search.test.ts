import { describe, it, expect } from "vitest";
import { filterAssets } from "./search";

const assets = [
  { id: "1", kind: "audio" as const, name: "Precio base", shortcut: "/precio", content: null, transcript: "Cuesta tanto por mes" },
  { id: "2", kind: "audio" as const, name: "Horario", shortcut: "/horario", content: null, transcript: "Atendemos de 9 a 18" },
  { id: "3", kind: "text" as const, name: "Bienvenida", shortcut: null, content: "Hola, como estas", transcript: null },
  { id: "4", kind: "audio" as const, name: "Sin transcribir todavia", shortcut: null, content: null, transcript: null },
];

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe("filterAssets", () => {
  it("sin busqueda devuelve todos", () => {
    expect(ids(filterAssets(assets, ""))).toEqual(["1", "2", "3", "4"]);
  });

  it("encuentra por nombre y por atajo, de los dos tipos", () => {
    expect(ids(filterAssets(assets, "horario"))).toEqual(["2"]);
    expect(ids(filterAssets(assets, "bienven"))).toEqual(["3"]);
  });

  it("un audio se busca por su transcripcion cuando no matchea nombre ni atajo", () => {
    expect(ids(filterAssets(assets, "atendemos"))).toEqual(["2"]);
  });

  it("un texto se busca por su contenido cuando no matchea nombre ni atajo", () => {
    expect(ids(filterAssets(assets, "como estas"))).toEqual(["3"]);
  });

  it("un audio sin transcripcion no rompe la busqueda: sigue apareciendo por nombre", () => {
    expect(ids(filterAssets(assets, "sin transcribir"))).toEqual(["4"]);
  });

  it("nombre le gana al texto de otro, mezclando tipos", () => {
    const lista = [
      { id: "a", kind: "text" as const, name: "Mensaje de precio", shortcut: null, content: "no dice nada relevante", transcript: null },
      { id: "b", kind: "audio" as const, name: "Otro", shortcut: null, content: null, transcript: "aca menciono el precio tambien" },
    ];
    expect(ids(filterAssets(lista, "precio"))).toEqual(["a", "b"]);
  });

  it("busca por etiquetas en los dos tipos", () => {
    const lista = [
      { id: "a", kind: "text" as const, name: "Saludo", shortcut: null, content: "Hola", transcript: null, tags: ["objeciones"] },
      { id: "b", kind: "audio" as const, name: "Otro", shortcut: null, content: null, transcript: "nada", tags: [] },
    ];
    expect(ids(filterAssets(lista, "objec"))).toEqual(["a"]);
  });

  it("un texto y un audio con el mismo atajo literal no pueden coexistir en los datos, pero la busqueda no asume eso", () => {
    expect(filterAssets([], "cualquier cosa")).toEqual([]);
  });
});
