import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PLACEHOLDER_NAMES,
  isPlaceholderName,
  isAnonymousContact,
  profileUpdateFor,
} from "./anonymous";

describe("isPlaceholderName", () => {
  it("reconoce lo que manda la plataforma cuando no tiene el perfil", () => {
    expect(isPlaceholderName("Instagram User")).toBe(true);
    expect(isPlaceholderName("Facebook User")).toBe(true);
  });

  it("no se marea con mayusculas ni espacios", () => {
    expect(isPlaceholderName("  instagram user  ")).toBe(true);
    expect(isPlaceholderName("INSTAGRAM USER")).toBe(true);
  });

  it("un nombre vacio tambien cuenta como sin nombre", () => {
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName("")).toBe(true);
    expect(isPlaceholderName("   ")).toBe(true);
  });

  it("un nombre de verdad no es un placeholder", () => {
    expect(isPlaceholderName("Ana Gomez")).toBe(false);
    expect(isPlaceholderName("Instagram Users SA")).toBe(false);
  });
});

describe("isAnonymousContact", () => {
  it("sin nombre y sin ningun dato, es anonimo", () => {
    expect(isAnonymousContact({ display_name: "Instagram User" })).toBe(true);
  });

  it("con nombre propio deja de serlo", () => {
    expect(isAnonymousContact({ display_name: "Ana Gomez" })).toBe(false);
  });

  it("cualquier dato de contacto alcanza para reconocerlo", () => {
    const base = { display_name: "Instagram User" };
    expect(isAnonymousContact({ ...base, email: "a@x.com" })).toBe(false);
    expect(isAnonymousContact({ ...base, phone: "+549" })).toBe(false);
    expect(isAnonymousContact({ ...base, whatsapp_phone: "+549" })).toBe(false);
    expect(isAnonymousContact({ ...base, instagram_username: "ana" })).toBe(false);
    expect(isAnonymousContact({ ...base, secondary_email: "a@x.com" })).toBe(false);
  });

  it("es sobre la identidad, no sobre el trabajo hecho: con tags y vendedor sigue siendo anonimo", () => {
    // Un contacto puede tener notas, tags y dueño y seguir sin saberse quien es.
    expect(isAnonymousContact({ display_name: null })).toBe(true);
  });
});

describe("profileUpdateFor", () => {
  it("reemplaza el placeholder por el nombre real", () => {
    const u = profileUpdateFor({ display_name: "Instagram User" }, { name: "Ana Gomez" });
    expect(u.display_name).toBe("Ana Gomez");
  });

  it("completa el nombre cuando no habia ninguno", () => {
    expect(profileUpdateFor({ display_name: null }, { name: "Ana" }).display_name).toBe("Ana");
  });

  it("NUNCA pisa un nombre que escribio una persona", () => {
    const u = profileUpdateFor({ display_name: "Ana (la del gimnasio)" }, { name: "Ana Gomez" });
    expect(u.display_name).toBeUndefined();
  });

  it("no reemplaza un placeholder por otro placeholder", () => {
    const u = profileUpdateFor({ display_name: "Instagram User" }, { name: "Instagram User" });
    expect(u.display_name).toBeUndefined();
  });

  it("completa el usuario y lo normaliza", () => {
    expect(profileUpdateFor({}, { username: "@Ana.Gomez" }).instagram_username).toBe("ana.gomez");
  });

  it("no pisa un usuario ya cargado", () => {
    const u = profileUpdateFor({ instagram_username: "ana_real" }, { username: "otro" });
    expect(u.instagram_username).toBeUndefined();
  });

  it("completa la foto solo si falta", () => {
    expect(profileUpdateFor({}, { picture: "https://cdn/a.jpg" }).avatar_url).toBe("https://cdn/a.jpg");
    expect(profileUpdateFor({ avatar_url: "https://cdn/vieja.jpg" }, { picture: "https://cdn/a.jpg" }).avatar_url)
      .toBeUndefined();
  });

  it("sin nada que mejorar devuelve un objeto vacio, para no escribir de gusto", () => {
    const u = profileUpdateFor(
      { display_name: "Ana", instagram_username: "ana", avatar_url: "https://cdn/a.jpg" },
      { name: "Ana Gomez", username: "ana2", picture: "https://cdn/b.jpg" },
    );
    expect(Object.keys(u)).toHaveLength(0);
  });

  it("un perfil vacio no borra nada", () => {
    const u = profileUpdateFor({ display_name: "Instagram User" }, { name: "", username: null });
    expect(Object.keys(u)).toHaveLength(0);
  });
});

describe("la lista de placeholders no se puede desincronizar del SQL", () => {
  it("los nombres del TS son los mismos que los de la migracion", () => {
    const sql = readFileSync("supabase/migrations/00031_contact_profile_enrichment.sql", "utf8");
    const bloque = sql.slice(sql.indexOf("is_placeholder_name"));
    const lista = bloque.slice(bloque.indexOf("IN ("), bloque.indexOf(");"));

    for (const nombre of PLACEHOLDER_NAMES) {
      expect(lista, `falta "${nombre}" en la migracion`).toContain(`'${nombre}'`);
    }
  });
});
