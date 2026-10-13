/**
 * 00190 (M5 del Extra L): `create_booking` es la funcion de CADA agenda. La migracion tiene que ser la
 * version vigente copiada letra por letra con UNA sola diferencia: lo que se suma al toque de atribucion.
 * Este test lee el archivo: la definicion vieja esta completa en la cabecera (para volver atras) y la nueva
 * es el cuerpo; se comparan linea por linea.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/00190_create_booking_ad_ids.sql"), "utf8");
const lines = sql.split("\n");
const start = lines.findIndex((l) => l.startsWith("-- CREATE OR REPLACE FUNCTION public.create_booking("));
const bodyStart = lines.findIndex((l) => l.startsWith("CREATE OR REPLACE FUNCTION public.create_booking("));
const oldDef = lines.slice(start, bodyStart).filter((l) => l.startsWith("--")).map((l) => l.replace(/^-- ?/, "")).filter((l) => !l.startsWith("====")).join("\n").trimEnd();
const newDef = lines.slice(bodyStart).join("\n").replace(/;\s*$/, "").trimEnd();

describe("00190: create_booking solo cambia el toque", () => {
  it("la definicion nueva solo AGREGA lineas respecto de la vieja (no cambia ni saca ninguna)", () => {
    const oldLines = oldDef.split("\n");
    const newLines = newDef.split("\n");
    // Ninguna linea vieja desaparece: la nueva es un SUPERCONJUNTO de la vieja...
    expect(oldLines.filter((l) => !newLines.includes(l))).toEqual([]);
    // ...y lo agregado esta TODO dentro del bloque que arma el toque (entre record_contact_touch y su EXCEPTION).
    const touchStart = newLines.findIndex((l) => l.includes("PERFORM public.record_contact_touch("));
    const touchEnd = newLines.findIndex((l, i) => i > touchStart && l.includes("EXCEPTION WHEN OTHERS THEN"));
    const added = newLines.map((l, i) => ({ l, i })).filter(({ l }) => !oldLines.includes(l));
    expect(added.length).toBeGreaterThan(0);
    for (const { i } of added) expect(i > touchStart && i < touchEnd).toBe(true);
  });

  it("suma ad_id, adset_id y campaign_id al toque, y los extras en raw", () => {
    for (const piece of ["'ad_id',        nullif(btrim(p_utm->>'ad_id'), '')", "'adset_id',     nullif(btrim(p_utm->>'adset_id'), '')", "'campaign_id',  nullif(btrim(p_utm->>'campaign_id'), '')"]) {
      expect(newDef).toContain(piece);
      expect(oldDef).not.toContain(piece);
    }
    for (const key of ["utm_id", "placement", "fbp", "fbc", "ga_client_id", "first_visit"]) expect(newDef).toContain(`'${key}'`);
  });

  it("la firma (25 parametros) y lo demas no cambian", () => {
    const signature = (def: string) => def.split("\n")[0];
    expect(signature(newDef)).toBe(signature(oldDef));
    expect(signature(newDef).split("p_").length - 1).toBe(25);
    // La exclusion de manual / agent, el EXCEPTION y el RAISE WARNING siguen.
    for (const keep of ["IF p_origin NOT IN ('manual', 'agent') THEN", "EXCEPTION WHEN OTHERS THEN", "RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;"]) {
      expect(newDef).toContain(keep);
    }
  });

  it("el origen del toque sigue siendo booking y su clave la reserva", () => {
    expect(newDef).toContain("'origin',       'booking'");
    expect(newDef).toContain("'dedupe_key',   'booking:' || v_booking_id::text");
  });
});
