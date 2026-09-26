import { describe, it, expect } from "vitest";
import {
  parsePublishers,
  publisherEntrySchema,
  resolveDefaultPublisher,
  usablePublishers,
  type PublisherEntry,
} from "./accounts-schema";

const entry = (over: Partial<PublisherEntry> = {}): PublisherEntry =>
  publisherEntrySchema.parse({
    publisher: "postproxy",
    status: "available",
    ...over,
  });

describe("validacion de los publicadores (F8)", () => {
  it("acepta una entrada minima y completa lo que falta", () => {
    const result = parsePublishers([{ publisher: "zernio", status: "available" }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publishers[0]).toEqual({
      publisher: "zernio",
      account_ref: null,
      status: "available",
      status_reason: null,
      verified_at: null,
      manually_enabled: false,
    });
  });

  it("rechaza un publicador que no existe", () => {
    const result = parsePublishers([{ publisher: "telegram", status: "available" }]);

    expect(result.ok).toBe(false);
  });

  it("rechaza un estado que no existe", () => {
    expect(parsePublishers([{ publisher: "zernio", status: "mas o menos" }]).ok).toBe(false);
  });

  it("rechaza el mismo publicador dos veces", () => {
    // Dos entradas del mismo camino dejarian el estado en manos del orden.
    const result = parsePublishers([
      { publisher: "zernio", status: "available" },
      { publisher: "zernio", status: "unavailable", status_reason: "x" },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("dos veces");
  });

  it("un publicador no disponible tiene que decir por que", () => {
    const sinMotivo = parsePublishers([{ publisher: "youtube_api", status: "unavailable" }]);
    expect(sinMotivo.ok).toBe(false);

    const conMotivo = parsePublishers([
      { publisher: "youtube_api", status: "unavailable", status_reason: "El proyecto no paso la auditoria" },
    ]);
    expect(conMotivo.ok).toBe(true);
  });

  it("lo que no es un array se rechaza", () => {
    expect(parsePublishers({ publisher: "zernio" }).ok).toBe(false);
    expect(parsePublishers(null).ok).toBe(false);
  });

  it("una lista vacia es valida: una cuenta puede no tener por donde publicar", () => {
    expect(parsePublishers([]).ok).toBe(true);
  });
});

describe("cual publicador se usa", () => {
  it("usable es lo disponible, mas lo habilitado a mano", () => {
    const entries = [
      entry({ publisher: "postproxy", status: "available" }),
      entry({ publisher: "youtube_api", status: "unverified" }),
      entry({ publisher: "zernio", status: "unavailable", status_reason: "sin cuenta", manually_enabled: true }),
    ];

    expect(usablePublishers(entries).map((e) => e.publisher)).toEqual(["postproxy", "zernio"]);
  });

  it("se respeta el elegido a mano mientras siga andando", () => {
    const entries = [
      entry({ publisher: "postproxy" }),
      entry({ publisher: "youtube_api", status: "available" }),
    ];

    expect(resolveDefaultPublisher(entries, "postproxy")).toEqual({
      publisher: "postproxy",
      changed: false,
    });
  });

  it("si el elegido deja de andar, pasa al siguiente y avisa que cambio", () => {
    // Cambiar en silencio por donde sale el contenido del negocio no vale.
    const entries = [
      entry({ publisher: "postproxy", status: "unavailable", status_reason: "se desconecto" }),
      entry({ publisher: "youtube_api", status: "available" }),
    ];

    expect(resolveDefaultPublisher(entries, "postproxy")).toEqual({
      publisher: "youtube_api",
      changed: true,
    });
  });

  it("YouTube prefiere la API oficial antes que Postproxy", () => {
    const entries = [
      entry({ publisher: "postproxy", status: "available" }),
      entry({ publisher: "youtube_api", status: "available" }),
    ];

    expect(resolveDefaultPublisher(entries, null).publisher).toBe("youtube_api");
  });

  it("sin ninguno usable queda vacio y avisa", () => {
    const entries = [entry({ publisher: "postproxy", status: "unavailable", status_reason: "sin key" })];

    expect(resolveDefaultPublisher(entries, "postproxy")).toEqual({ publisher: null, changed: true });
  });

  it("un publicador que ya no esta en la lista no se conserva como default", () => {
    expect(resolveDefaultPublisher([entry({ publisher: "zernio" })], "postproxy")).toEqual({
      publisher: "zernio",
      changed: true,
    });
  });
});
