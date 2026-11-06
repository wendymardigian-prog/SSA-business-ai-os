import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lastFunctionDefinition } from "@/lib/test-utils/migrations";
import {
  PLACEHOLDER_NAMES,
  ID_NAME_PATTERN,
  HANDLE_NAME_PATTERN,
  fallbackContactName,
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

  it("el id de la plataforma o un telefono como nombre es un relleno (00284)", () => {
    expect(isPlaceholderName("1860383452043344")).toBe(true);
    expect(isPlaceholderName(" 1860383452043344 ")).toBe(true);
    expect(isPlaceholderName("+5491112345678")).toBe(true);
    expect(isPlaceholderName("5491112345678")).toBe(true);
  });

  it("un solo @usuario como nombre es un relleno (00284)", () => {
    expect(isPlaceholderName("@ana.gomez")).toBe(true);
    expect(isPlaceholderName("@ana_gomez_23")).toBe(true);
  });

  it("un nombre con numeros, un numero corto o un @ con mas texto NO son relleno", () => {
    expect(isPlaceholderName("Ana 2")).toBe(false);
    expect(isPlaceholderName("1234567")).toBe(false);
    expect(isPlaceholderName("Ana +54 9 11 1234 5678")).toBe(false);
    expect(isPlaceholderName("@ana (la del gimnasio)")).toBe(false);
    expect(isPlaceholderName("Ana @ Gym")).toBe(false);
  });
});

describe("fallbackContactName", () => {
  it("el nombre gana", () => {
    expect(fallbackContactName("Ana Gomez", "ana", "123456789012")).toBe("Ana Gomez");
  });

  it("sin nombre, el @usuario (una sola arroba)", () => {
    expect(fallbackContactName(null, "ana.gomez", "123456789012")).toBe("@ana.gomez");
    expect(fallbackContactName("  ", "@ana", "123456789012")).toBe("@ana");
  });

  it("sin nombre ni usuario, el respaldo", () => {
    expect(fallbackContactName(undefined, null, "123456789012")).toBe("123456789012");
  });

  it("todo respaldo es un relleno: el nombre real lo puede reemplazar despues", () => {
    expect(isPlaceholderName(fallbackContactName(null, "ana.gomez", "x"))).toBe(true);
    expect(isPlaceholderName(fallbackContactName(null, null, "1860383452043344"))).toBe(true);
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

  it("un id como nombre, sin ningun dato, es anonimo: lo mismo que la columna is_anonymous (00295)", () => {
    expect(isAnonymousContact({ display_name: "1860383452043344" })).toBe(true);
    expect(isAnonymousContact({ display_name: " +5491112345678 " })).toBe(true);
  });

  it("un id como nombre con algun dato, o un numero corto, no es anonimo", () => {
    expect(isAnonymousContact({ display_name: "1860383452043344", instagram_username: "ana" })).toBe(false);
    expect(isAnonymousContact({ display_name: "5491112345678", phone: "+5491112345678" })).toBe(false);
    expect(isAnonymousContact({ display_name: "1234567" })).toBe(false);
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
    const def = lastFunctionDefinition("public.is_placeholder_name");
    expect(def, "no encontre public.is_placeholder_name en las migraciones").not.toBeNull();
    const bloque = def!.sql;
    const lista = bloque.slice(bloque.indexOf("IN ("), bloque.indexOf(");"));

    for (const nombre of PLACEHOLDER_NAMES) {
      expect(lista, `falta "${nombre}" en la migracion`).toContain(`'${nombre}'`);
    }
  });

  it("las expresiones del id y del @usuario son las mismas en el TS y en el SQL", () => {
    const sql = lastFunctionDefinition("public.is_placeholder_name")!.sql;
    expect(sql).toContain(`~ '${ID_NAME_PATTERN}'`);
    expect(sql).toContain(`~ '${HANDLE_NAME_PATTERN}'`);
  });

  it("la columna is_anonymous usa la misma lista y la misma expresion del id (00295)", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/00295_unidentified_contacts.sql"), "utf8");
    const columna = sql.slice(sql.indexOf("ADD COLUMN is_anonymous boolean\n  GENERATED"), sql.indexOf(") STORED;", sql.indexOf("ADD COLUMN is_anonymous boolean\n  GENERATED")));
    expect(columna).not.toBe("");
    for (const nombre of PLACEHOLDER_NAMES) {
      expect(columna, `falta "${nombre}" en la columna`).toContain(`'${nombre}'`);
    }
    expect(columna).toContain(`~ '${ID_NAME_PATTERN}'`);
    expect(columna).not.toContain(HANDLE_NAME_PATTERN);
  });
});
