import { describe, it, expect } from "vitest";
import { filterTemplates } from "./search";

const templates = [
  { id: "1", name: "Precio del servicio", content: "Sale X", shortcut: "/precio" },
  { id: "2", name: "Horario de atención", content: "De 9 a 18", shortcut: "/horario" },
  { id: "3", name: "Bienvenida", content: "Hola!", shortcut: null },
  { id: "4", name: "Presupuesto enviado", content: "Te mandé el presu", shortcut: "/presu" },
];

const ids = (list: { id: string }[]) => list.map((t) => t.id);

describe("filterTemplates", () => {
  it("sin busqueda devuelve todos, en el orden que vinieron", () => {
    expect(ids(filterTemplates(templates, ""))).toEqual(["1", "2", "3", "4"]);
    expect(ids(filterTemplates(templates, "   "))).toEqual(["1", "2", "3", "4"]);
  });

  it("encuentra por atajo sin escribir la barra", () => {
    expect(ids(filterTemplates(templates, "horario"))).toEqual(["2"]);
  });

  it("encuentra por nombre", () => {
    expect(ids(filterTemplates(templates, "bienven"))).toEqual(["3"]);
  });

  it("el atajo que arranca con lo tipeado va primero", () => {
    // "pre" esta en el atajo /precio y /presu, y en el nombre de los dos.
    expect(ids(filterTemplates(templates, "pre"))).toEqual(["1", "4"]);
  });

  it("prioriza el que empieza con el texto sobre el que solo lo contiene", () => {
    const lista = [
      { id: "a", name: "Segundo precio", content: "", shortcut: null },
      { id: "b", name: "Precio base", content: "", shortcut: null },
    ];
    expect(ids(filterTemplates(lista, "precio"))).toEqual(["b", "a"]);
  });

  it("ignora acentos y mayusculas", () => {
    expect(ids(filterTemplates(templates, "ATENCION"))).toEqual(["2"]);
    expect(ids(filterTemplates(templates, "atención"))).toEqual(["2"]);
  });

  it("devuelve vacio cuando no hay ninguno", () => {
    expect(filterTemplates(templates, "zzz")).toEqual([]);
  });

  it("no rompe con la lista vacia", () => {
    expect(filterTemplates([], "hola")).toEqual([]);
  });
});
