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
  it("sin busqueda devuelve todos; sin usos, por nombre", () => {
    expect(ids(filterAssets(assets, ""))).toEqual(["3", "2", "1", "4"]);
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

  describe("los seis tipos", () => {
    const seis = [
      { id: "t", kind: "text" as const, name: "Bienvenida", shortcut: null, content: "Hola {{contact.display_name}}", transcript: null },
      { id: "v", kind: "video" as const, name: "Testimonio Ana", shortcut: "/ana", content: null, transcript: "subi las ventas un treinta por ciento", description: "Clienta de estetica" },
      { id: "i", kind: "image" as const, name: "Flyer", shortcut: null, content: null, transcript: null, description: "Captura del panel de resultados" },
      { id: "f", kind: "file" as const, name: "Propuesta", shortcut: null, content: null, transcript: null, description: "PDF con los planes y precios" },
      { id: "l", kind: "link" as const, name: "Agenda", shortcut: "/agenda", content: null, transcript: null, url: "https://calendly.com/wendy", description: "Para reservar la llamada" },
    ];

    it("un video se busca por su transcripcion", () => {
      expect(ids(filterAssets(seis, "treinta por ciento"))).toEqual(["v"]);
    });

    it("una imagen y un archivo se buscan por su descripcion", () => {
      expect(ids(filterAssets(seis, "panel de resultados"))).toEqual(["i"]);
      expect(ids(filterAssets(seis, "planes"))).toEqual(["f"]);
    });

    it("un enlace se busca por la URL y por la descripcion", () => {
      expect(ids(filterAssets(seis, "calendly"))).toEqual(["l"]);
      expect(ids(filterAssets(seis, "reservar"))).toEqual(["l"]);
    });

    it("la descripcion de un video tambien cuenta", () => {
      expect(ids(filterAssets(seis, "estetica"))).toEqual(["v"]);
    });

    it("devuelve el recurso original, no el adaptado para buscar", () => {
      const [video] = filterAssets(seis, "treinta");
      expect(video.content).toBeNull();
    });
  });

  describe("el orden por uso", () => {
    const usados = [
      { id: "a", kind: "text" as const, name: "Precio A", shortcut: null, content: "x", transcript: null, usageCount: 1 },
      { id: "b", kind: "text" as const, name: "Precio B", shortcut: null, content: "x", transcript: null, usageCount: 9 },
      { id: "c", kind: "text" as const, name: "Precio C", shortcut: null, content: "x", transcript: null, usageCount: 0, createdAt: "2026-10-08T10:00:00Z" },
      { id: "d", kind: "text" as const, name: "Precio D", shortcut: null, content: "x", transcript: null, usageCount: 0, createdAt: "2026-10-01T10:00:00Z" },
    ];

    it("sin busqueda: los mas usados primero, despues los mas nuevos", () => {
      expect(ids(filterAssets(usados, ""))).toEqual(["b", "a", "c", "d"]);
    });

    it("con busqueda, entre dos igual de relevantes gana el mas usado", () => {
      expect(ids(filterAssets(usados, "precio"))).toEqual(["b", "a", "c", "d"]);
    });

    it("la relevancia le gana al uso", () => {
      const lista = [
        { id: "x", kind: "text" as const, name: "Otra cosa", shortcut: null, content: "habla del precio", transcript: null, usageCount: 50 },
        { id: "y", kind: "text" as const, name: "Precio", shortcut: null, content: "x", transcript: null, usageCount: 0 },
      ];
      expect(ids(filterAssets(lista, "precio"))).toEqual(["y", "x"]);
    });
  });
});
