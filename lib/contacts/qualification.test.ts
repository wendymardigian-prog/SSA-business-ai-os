import { describe, expect, it } from "vitest";
import { lastDefinition, lastFunctionDefinition } from "@/lib/test-utils/migrations";
import cases from "./qualification.cases.json";
import {
  DEFAULT_QUALIFICATION_SETTINGS,
  nextQualificationLevel,
  parseQualificationLevel,
  parseQualificationSettings,
  qualificationLabel,
  qualificationName,
  qualificationRubricText,
  validateQualificationSettings,
  type QualificationMode,
} from "./qualification";

describe("los nombres por defecto", () => {
  // El DEFAULT de la columna es un literal (un DEFAULT que llama a una funcion sin permisos rompe el alta de un workspace).
  it("son los mismos en el código y en el DEFAULT de workspaces.qualification_settings", () => {
    const found = lastDefinition(/qualification_settings\s+(?:jsonb\s+)?(?:NOT\s+NULL\s+)?(?:SET\s+)?DEFAULT\s+'((?:[^']|'')*)'/i);
    expect(found).not.toBeNull();
    expect(JSON.parse(found!.match[1].replace(/''/g, "'"))).toEqual(DEFAULT_QUALIFICATION_SETTINGS);
  });
});

describe("nextQualificationLevel (gemela de private.qualification_next_level)", () => {
  it.each(cases)("$name", (c) => {
    expect(nextQualificationLevel(c.old, c.mode as QualificationMode, c.value)).toEqual(c.expected);
  });

  it("la función SQL existe y recorta entre 1 y 5", () => {
    const sql = lastFunctionDefinition("private.qualification_next_level")?.sql ?? "";
    expect(sql).toContain("greatest(1, least(5, v))");
    expect(sql).toContain("IF p_old IS NULL AND v < 1 THEN RETURN NULL");
  });
});

describe("parseQualificationSettings", () => {
  it("sin nada guardado, los nombres por defecto", () => {
    expect(parseQualificationSettings(null)).toEqual(DEFAULT_QUALIFICATION_SETTINGS);
    expect(parseQualificationSettings({ levels: "x" })).toEqual(DEFAULT_QUALIFICATION_SETTINGS);
  });

  it("completa los niveles que faltan y descarta los inválidos, siempre los 5 en orden", () => {
    const parsed = parseQualificationSettings({
      levels: [
        { level: 4, name: "Caliente", description: "Pidió precio" },
        { level: 9, name: "Nada" },
        { level: 2, name: "" },
      ],
    });
    expect(parsed.levels.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.levels[3]).toEqual({ level: 4, name: "Caliente", description: "Pidió precio" });
    expect(parsed.levels[1].name).toBe("Bajo");
  });
});

describe("nombres y etiquetas", () => {
  const s = parseQualificationSettings(null);
  it("sin nivel es «Sin calificar»", () => {
    expect(qualificationName(s, null)).toBe("Sin calificar");
    expect(qualificationLabel(s, undefined)).toBe("Sin calificar");
  });
  it("con nivel, número y nombre", () => {
    expect(qualificationLabel(s, 4)).toBe("4 · Bueno");
  });
  it("la rúbrica tiene una línea por nivel", () => {
    expect(qualificationRubricText(s).split("\n")).toHaveLength(5);
  });
  it("parseQualificationLevel acepta 1-5 como número o texto", () => {
    expect(parseQualificationLevel(3)).toBe(3);
    expect(parseQualificationLevel(" 5 ")).toBe(5);
    expect(parseQualificationLevel(0)).toBeNull();
    expect(parseQualificationLevel("6")).toBeNull();
    expect(parseQualificationLevel(2.5)).toBeNull();
    expect(parseQualificationLevel(null)).toBeNull();
  });
});

describe("validateQualificationSettings", () => {
  const base = DEFAULT_QUALIFICATION_SETTINGS.levels.map((l) => ({ ...l }));
  it("acepta los 5 con nombre", () => {
    const r = validateQualificationSettings(base.map((l) => ({ ...l, name: `  ${l.name}  ` })));
    expect(r.ok && r.settings.levels[0].name).toBe("No califica");
  });
  it("rechaza un nombre vacío", () => {
    const r = validateQualificationSettings(base.map((l) => (l.level === 3 ? { ...l, name: " " } : l)));
    expect(r).toEqual({ ok: false, error: "Poné un nombre al nivel 3" });
  });
  it("rechaza una descripción demasiado larga", () => {
    const r = validateQualificationSettings(base.map((l) => (l.level === 1 ? { ...l, description: "x".repeat(301) } : l)));
    expect(r.ok).toBe(false);
  });
});
