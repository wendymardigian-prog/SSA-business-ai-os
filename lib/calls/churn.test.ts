import { describe, expect, it } from "vitest";
import {
  activeChurnReasons,
  churnReasonLabel,
  churnTechnical,
  newChurnReason,
  normalizeChurnReasons,
  parseManualChurnCause,
  readChurnCause,
  sanitizeChurnCause,
  validateChurnReasons,
} from "./churn";

const LIST = [
  { clave: "precio", nombre: "Le parece caro" },
  { clave: "sin_resultados", nombre: "No ve resultados" },
  { clave: "tiempo", nombre: "Falta de tiempo", archivado: true },
];
const T = "Cliente: la verdad es que no veo resultados y estoy pensando en darme de baja el mes que viene.";

describe("la lista de causas del negocio", () => {
  it("se lee tolerante: sin clave, sin nombre o repetidas, fuera; la clave queda en minúsculas", () => {
    expect(normalizeChurnReasons([{ clave: "Precio", nombre: "Caro" }, { clave: "precio", nombre: "Otra" }, { nombre: "sin clave" }, { clave: "x", nombre: "  " }, "basura"])).toEqual([{ clave: "precio", nombre: "Caro" }]);
    expect(normalizeChurnReasons(null)).toEqual([]);
  });
  it("una causa nueva toma una clave única que no cambia al renombrarla", () => {
    expect(newChurnReason("Le parece caro", [{ clave: "le_parece_caro", nombre: "x" }]).clave).toBe("le_parece_caro_2");
  });
  it("no se guardan dos activas con el mismo nombre", () => {
    expect(validateChurnReasons([{ clave: "a", nombre: "Precio" }, { clave: "b", nombre: "precio" }])).toHaveLength(1);
    expect(validateChurnReasons(LIST)).toEqual([]);
  });
  it("una archivada no se ofrece, pero una reunión vieja la sigue mostrando con su nombre", () => {
    expect(activeChurnReasons(LIST).map((r) => r.clave)).toEqual(["precio", "sin_resultados"]);
    expect(churnReasonLabel("tiempo", LIST)).toBe("Falta de tiempo");
    expect(churnReasonLabel("borrada_ya", LIST)).toBe("borrada ya");
  });
});

describe("lo que se le pide a la IA", () => {
  it("sin causas activas, el pedido no cambia", () => {
    expect(churnTechnical([])).toBe("");
    expect(churnTechnical([{ clave: "x", nombre: "X", archivado: true }])).toBe("");
  });
  it("lista solo las activas y pide la cita textual", () => {
    const t = churnTechnical(LIST);
    expect(t).toContain("- precio: Le parece caro");
    expect(t).not.toContain("tiempo");
    expect(t).toMatch(/TEXTUAL/);
  });
});

describe("lo que devuelve la IA", () => {
  it("con una clave de la lista y una cita que está en la transcripción, queda", () => {
    expect(sanitizeChurnCause({ clave: "sin_resultados", motivo: "No ve resultados", cita: "no veo resultados" }, LIST, T)).toEqual({ clave: "sin_resultados", motivo: "No ve resultados", cita: "no veo resultados", fuente: "ia" });
  });
  it("sin cita, con una cita inventada, con una clave que no está o archivada: nada", () => {
    expect(sanitizeChurnCause({ clave: "sin_resultados", motivo: "x", cita: null }, LIST, T)).toBeNull();
    expect(sanitizeChurnCause({ clave: "sin_resultados", motivo: "x", cita: "esto no lo dijo nadie" }, LIST, T)).toBeNull();
    expect(sanitizeChurnCause({ clave: "otra_cosa", motivo: "x", cita: "no veo resultados" }, LIST, T)).toBeNull();
    expect(sanitizeChurnCause({ clave: "tiempo", motivo: "x", cita: "no veo resultados" }, LIST, T)).toBeNull();
    expect(sanitizeChurnCause({ clave: null, motivo: null, cita: null }, LIST, T)).toBeNull();
  });
});

describe("guardada y corregida a mano", () => {
  it("se lee del análisis, tolerante", () => {
    expect(readChurnCause({ causa_baja: { clave: "precio", cita: "c" } })).toEqual({ clave: "precio", motivo: null, cita: "c", fuente: "ia" });
    expect(readChurnCause({ causa_baja: { clave: "" } })).toBeNull();
    expect(readChurnCause(null)).toBeNull();
  });
  it("a mano: una de la lista activa (sin cita) o vacía para quitarla", () => {
    expect(parseManualChurnCause({ clave: "precio", motivo: " lo dijo en la renovación " }, LIST)).toEqual({ ok: true, cause: { clave: "precio", motivo: "lo dijo en la renovación", cita: null, fuente: "manual" } });
    expect(parseManualChurnCause({ clave: "", motivo: null }, LIST)).toEqual({ ok: true, cause: null });
    expect(parseManualChurnCause({ clave: "tiempo", motivo: null }, LIST).ok).toBe(false);
  });
});
