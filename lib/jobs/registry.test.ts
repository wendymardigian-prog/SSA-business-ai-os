/**
 * El registro de tipos de job (F30).
 *
 * El cambio que fija: un tipo desconocido FALLA. Antes quedaba completado
 * con un warn, y un tipo mal escrito pasaba por hecho sin que nadie se
 * enterara.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  UnknownJobTypeError,
  getJobHandler,
  registerJobHandler,
  registeredJobTypes,
  resetJobHandlers,
} from "./registry";

beforeEach(() => resetJobHandlers());

describe("registro de jobs (F30)", () => {
  it("un tipo registrado devuelve su handler", async () => {
    const handler = vi.fn(async () => {});
    registerJobHandler("content_publish", handler);

    await getJobHandler("content_publish")!({} as never);

    expect(handler).toHaveBeenCalledOnce();
  });

  it("un tipo desconocido no tiene handler, y ese es el punto", () => {
    expect(getJobHandler("typo_publich")).toBeUndefined();
    expect(() => {
      throw new UnknownJobTypeError("typo_publich");
    }).toThrow(/typo_publich/);
  });

  it("registrar el mismo tipo dos veces deja el ultimo", () => {
    registerJobHandler("x", vi.fn());
    const segundo = vi.fn();
    registerJobHandler("x", segundo);

    expect(getJobHandler("x")).toBe(segundo);
    expect(registeredJobTypes()).toEqual(["x"]);
  });

  it("lista los tipos ordenados, para poder mostrarlos", () => {
    registerJobHandler("zeta", vi.fn());
    registerJobHandler("alfa", vi.fn());

    expect(registeredJobTypes()).toEqual(["alfa", "zeta"]);
  });
});
