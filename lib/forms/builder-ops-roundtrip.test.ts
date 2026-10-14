/**
 * Plano formularios-ui, B4: las funciones nuevas del constructor, cuando no hay nada que cambiar, devuelven la
 * definicion IDENTICA (mismo arreglo, mismos campos). Se prueba con las definiciones reales de la caracterizacion
 * (`__fixtures__/definitions`) y con la rica de los 14 tipos.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changeFieldType, dropTargetIndex, moveFieldTo } from "./builder-ops";
import { setFieldMapping, mappingOf } from "./contact-map";
import { DEFAULT_CONTACT_CONFIG, parseStoredContactConfig, type ContactConfig } from "./contact-config";
import type { FormDefinition, FormField } from "./fields";

const DIR = join(__dirname, "__fixtures__", "definitions");
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as { name: string; definition: FormDefinition; contactConfig?: unknown });

describe("operaciones del constructor que no cambian nada", () => {
  for (const fx of fixtures) {
    const fields: FormField[] = fx.definition.fields;
    const config: ContactConfig = parseStoredContactConfig(fx.contactConfig) ?? DEFAULT_CONTACT_CONFIG;

    it(`${fx.name}: mover cada campo a donde ya esta devuelve el mismo arreglo`, () => {
      fields.forEach((_, i) => {
        expect(moveFieldTo(fields, i, i)).toBe(fields);
        expect(moveFieldTo(fields, i, dropTargetIndex(i, i, "before"))).toBe(fields);
        expect(moveFieldTo(fields, i, dropTargetIndex(i, i, "after"))).toBe(fields);
      });
    });

    it(`${fx.name}: cambiar cada campo a su mismo tipo devuelve el mismo arreglo`, () => {
      fields.forEach((f, i) => expect(changeFieldType(fields, i, f.type)).toBe(fields));
    });

    it(`${fx.name}: mapear cada campo a lo que ya tiene da la misma configuracion`, () => {
      for (const f of fields) {
        const current = mappingOf(config, f.key);
        const result = setFieldMapping(config, fields, [], f.key, current || null);
        expect(result.error).toBeUndefined();
        expect(result.displaced).toBeNull();
        expect(result.config.map.map((m) => `${m.fieldKey}=${m.target}`).sort()).toEqual(config.map.map((m) => `${m.fieldKey}=${m.target}`).sort());
      }
    });
  }
});
