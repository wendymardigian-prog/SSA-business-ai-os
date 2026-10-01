import { describe, it, expect } from "vitest";
import { filterAudioAssets } from "./search";

const assets = [
  { id: "1", name: "Precio base", shortcut: "/precio", transcript: "Cuesta tanto por mes" },
  { id: "2", name: "Horario", shortcut: "/horario", transcript: "Atendemos de 9 a 18" },
  { id: "3", name: "Bienvenida", shortcut: null, transcript: "Hola, como estas" },
  { id: "4", name: "Sin transcribir todavia", shortcut: null, transcript: null },
];

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe("filterAudioAssets (F21)", () => {
  it("sin busqueda devuelve todos", () => {
    expect(ids(filterAudioAssets(assets, ""))).toEqual(["1", "2", "3", "4"]);
  });

  it("encuentra por nombre y por atajo, como los templates", () => {
    expect(ids(filterAudioAssets(assets, "horario"))).toEqual(["2"]);
    expect(ids(filterAudioAssets(assets, "bienven"))).toEqual(["3"]);
  });

  it("encuentra por transcripcion cuando no matchea nombre ni atajo", () => {
    expect(ids(filterAudioAssets(assets, "atendemos"))).toEqual(["2"]);
    expect(ids(filterAudioAssets(assets, "como estas"))).toEqual(["3"]);
  });

  it("un audio sin transcripcion no rompe la busqueda: sigue apareciendo por nombre", () => {
    expect(ids(filterAudioAssets(assets, "sin transcribir"))).toEqual(["4"]);
  });

  it("nombre le gana a la transcripcion de otro", () => {
    const lista = [
      { id: "a", name: "Mensaje de precio", shortcut: null, transcript: "no dice nada relevante" },
      { id: "b", name: "Otro", shortcut: null, transcript: "aca menciono el precio tambien" },
    ];
    expect(ids(filterAudioAssets(lista, "precio"))).toEqual(["a", "b"]);
  });
});
