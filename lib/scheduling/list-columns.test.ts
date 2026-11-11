import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMN_WIDTHS,
  EXTRA_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  clampWidth,
  columnWidth,
  parseColumnWidths,
  resetColumnWidth,
  serializeColumnWidths,
  setColumnWidth,
  totalWidth,
} from "./list-columns";

describe("anchos de las columnas de la lista de Agenda", () => {
  it("sin nada guardado, cada columna tiene su ancho normal (y las de atribucion el suyo)", () => {
    expect(columnWidth("event", {})).toBe(DEFAULT_COLUMN_WIDTHS.event);
    expect(columnWidth("attr:utm_source", {})).toBe(EXTRA_COLUMN_WIDTH);
  });

  it("el evento arranca mas ancho que la categoria y el origen (era lo que se comprimia)", () => {
    expect(DEFAULT_COLUMN_WIDTHS.event).toBeGreaterThan(DEFAULT_COLUMN_WIDTHS.category);
    expect(DEFAULT_COLUMN_WIDTHS.event).toBeGreaterThan(DEFAULT_COLUMN_WIDTHS.origin);
  });

  it("un ancho nunca baja del minimo ni pasa el maximo", () => {
    expect(clampWidth(5)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(99999)).toBe(MAX_COLUMN_WIDTH);
    expect(clampWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(200.4)).toBe(200);
  });

  it("lo guardado manda sobre lo normal", () => {
    expect(columnWidth("event", { event: 400 })).toBe(400);
  });

  it("lo guardado que no es un numero, o que esta roto, se ignora", () => {
    expect(parseColumnWidths(null)).toEqual({});
    expect(parseColumnWidths("no es json")).toEqual({});
    expect(parseColumnWidths("[1,2]")).toEqual({});
    expect(parseColumnWidths('{"event":"ancho","host":200,"x":null}')).toEqual({ host: 200 });
  });

  it("guardar y volver a leer devuelve lo mismo", () => {
    const saved = setColumnWidth({}, "event", 420);
    expect(parseColumnWidths(serializeColumnWidths(saved))).toEqual({ event: 420 });
  });

  it("dejar una columna en su ancho normal no guarda nada", () => {
    const saved = setColumnWidth({ event: 420 }, "event", DEFAULT_COLUMN_WIDTHS.event);
    expect(saved).toEqual({});
  });

  it("restablecer una columna saca solo esa", () => {
    expect(resetColumnWidth({ event: 420, host: 200 }, "event")).toEqual({ host: 200 });
  });

  it("el ancho de la tabla es la suma de sus columnas, con la que se esta arrastrando en vivo", () => {
    const keys = ["event", "host"];
    expect(totalWidth(keys, {})).toBe(DEFAULT_COLUMN_WIDTHS.event + DEFAULT_COLUMN_WIDTHS.host);
    expect(totalWidth(keys, { host: 200 })).toBe(DEFAULT_COLUMN_WIDTHS.event + 200);
    expect(totalWidth(keys, { host: 200 }, { key: "event", width: 500 })).toBe(500 + 200);
  });
});
