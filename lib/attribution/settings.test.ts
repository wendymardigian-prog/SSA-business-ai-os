import { describe, expect, it } from "vitest";
import {
  attributionSettingsSchema,
  defaultAttributionSettings,
  parseAttributionSettings,
  shouldCreateFromComment,
} from "./settings";

const DEFAULT_JSON = {
  comments_create_contact: { instagram: false, tiktok: true },
  content_inherit_days: 7,
  links_append_default: false,
  links_track_clicks_default: true,
};

describe("defaultAttributionSettings", () => {
  it("es el mismo default que la columna de la 00230", () => {
    expect(defaultAttributionSettings()).toEqual(DEFAULT_JSON);
  });

  it("devuelve una copia nueva: mutarla no cambia el siguiente default", () => {
    const a = defaultAttributionSettings();
    a.comments_create_contact.instagram = true;
    a.content_inherit_days = 30;
    expect(defaultAttributionSettings()).toEqual(DEFAULT_JSON);
  });

  it("pasa el esquema estricto", () => {
    expect(attributionSettingsSchema.safeParse(defaultAttributionSettings()).success).toBe(true);
  });
});

describe("parseAttributionSettings", () => {
  it("un jsonb completo y valido se conserva tal cual", () => {
    const value = {
      comments_create_contact: { instagram: true, tiktok: false },
      content_inherit_days: 14,
      links_append_default: true,
      links_track_clicks_default: false,
    };
    expect(parseAttributionSettings(value)).toEqual(value);
  });

  it("null, undefined, numeros, arrays y texto roto dan los defaults sin lanzar", () => {
    for (const bad of [null, undefined, 5, true, [], "no es json", "[1,2]", "null"]) {
      expect(parseAttributionSettings(bad)).toEqual(DEFAULT_JSON);
    }
  });

  it("un objeto vacio da los defaults", () => {
    expect(parseAttributionSettings({})).toEqual(DEFAULT_JSON);
  });

  it("cae a los defaults POR PARTE: lo bueno se conserva y lo malo se reemplaza", () => {
    const parsed = parseAttributionSettings({
      comments_create_contact: { instagram: true, tiktok: "si" },
      content_inherit_days: 99,
      links_append_default: true,
      links_track_clicks_default: "no",
    });
    expect(parsed).toEqual({
      comments_create_contact: { instagram: true, tiktok: true },
      content_inherit_days: 7,
      links_append_default: true,
      links_track_clicks_default: true,
    });
  });

  it("los dias fuera de 1..30, con decimales o de otro tipo vuelven al default", () => {
    for (const days of [0, -3, 31, 7.5, "10", null, NaN, Infinity]) {
      expect(parseAttributionSettings({ content_inherit_days: days }).content_inherit_days, String(days)).toBe(7);
    }
    expect(parseAttributionSettings({ content_inherit_days: 1 }).content_inherit_days).toBe(1);
    expect(parseAttributionSettings({ content_inherit_days: 30 }).content_inherit_days).toBe(30);
  });

  it("comments_create_contact que no es un objeto usa los dos defaults", () => {
    expect(parseAttributionSettings({ comments_create_contact: "x" }).comments_create_contact).toEqual({ instagram: false, tiktok: true });
    expect(parseAttributionSettings({ comments_create_contact: [true] }).comments_create_contact).toEqual({ instagram: false, tiktok: true });
  });

  it("un jsonb que llego como texto se lee", () => {
    expect(parseAttributionSettings(JSON.stringify({ content_inherit_days: 3 })).content_inherit_days).toBe(3);
  });

  it("descarta las claves desconocidas", () => {
    const parsed = parseAttributionSettings({ ...DEFAULT_JSON, extra: "x", comments_create_contact: { instagram: true, tiktok: true, youtube: true } });
    expect(parsed).not.toHaveProperty("extra");
    expect(parsed.comments_create_contact).toEqual({ instagram: true, tiktok: true });
  });

  it("lo que devuelve siempre pasa el esquema estricto", () => {
    for (const input of [null, {}, { content_inherit_days: -1 }, DEFAULT_JSON]) {
      expect(attributionSettingsSchema.safeParse(parseAttributionSettings(input)).success).toBe(true);
    }
  });
});

describe("attributionSettingsSchema (estricto, para guardar)", () => {
  it("rechaza dias fuera de rango, decimales y falta de partes", () => {
    const base = defaultAttributionSettings();
    expect(attributionSettingsSchema.safeParse({ ...base, content_inherit_days: 0 }).success).toBe(false);
    expect(attributionSettingsSchema.safeParse({ ...base, content_inherit_days: 31 }).success).toBe(false);
    expect(attributionSettingsSchema.safeParse({ ...base, content_inherit_days: 2.5 }).success).toBe(false);
    expect(attributionSettingsSchema.safeParse({ ...base, links_append_default: "si" }).success).toBe(false);
    expect(attributionSettingsSchema.safeParse({ content_inherit_days: 7 }).success).toBe(false);
  });
});

describe("shouldCreateFromComment", () => {
  it("con los defaults: Instagram solo busca y TikTok crea", () => {
    const s = defaultAttributionSettings();
    expect(shouldCreateFromComment(s, "instagram")).toBe(false);
    expect(shouldCreateFromComment(s, "tiktok")).toBe(true);
  });

  it("respeta cada interruptor", () => {
    const s = parseAttributionSettings({ comments_create_contact: { instagram: true, tiktok: false } });
    expect(shouldCreateFromComment(s, "instagram")).toBe(true);
    expect(shouldCreateFromComment(s, "tiktok")).toBe(false);
  });

  it("normaliza mayusculas y espacios de la red", () => {
    const s = parseAttributionSettings({ comments_create_contact: { instagram: true, tiktok: true } });
    expect(shouldCreateFromComment(s, " Instagram ")).toBe(true);
    expect(shouldCreateFromComment(s, "TIKTOK")).toBe(true);
  });

  it("una red desconocida o vacia nunca crea", () => {
    const s = parseAttributionSettings({ comments_create_contact: { instagram: true, tiktok: true } });
    for (const p of ["youtube", "facebook", "", null, undefined]) {
      expect(shouldCreateFromComment(s, p), String(p)).toBe(false);
    }
  });
});
