import { describe, expect, it } from "vitest";
import { ENTRY_URL_MAX_LENGTH, entryUrlFrom } from "./entry-url";
import { SENSITIVE_PARAM_NAMES } from "./sensitive-params";

const META =
  "https://ejemplo.test/programa-x?utm_source=facebook&utm_medium=paid&utm_campaign=Programa+X+%C2%B7+clase+jueves&ad_id=120214558930140527" +
  "&ad_name=Video+testimonio+Noe&adset_name=Lookalike+1%25+compradores&campaign_name=Programa+X&placement=Instagram_Reels&site_source_name=ig&ref=podcast&fbclid=IwZXh0bgNhZW0BMABh";

describe("entryUrlFrom (plano formularios-ui, F17)", () => {
  it("conserva TODOS los parametros, en el orden original y con su codificacion", () => {
    expect(entryUrlFrom(META)).toBe(META);
    const out = entryUrlFrom(META) ?? "";
    for (const key of ["ad_name", "adset_name", "campaign_name", "site_source_name", "ref"]) expect(out).toContain(`${key}=`);
    // La codificacion no se vuelve a escribir: "+" y "%C2%B7" quedan como vinieron.
    expect(out).toContain("utm_campaign=Programa+X+%C2%B7+clase+jueves");
  });

  it("saca los parametros sensibles, sin distinguir mayusculas y tambien si el nombre viene codificado", () => {
    const out = entryUrlFrom("https://ejemplo.test/p?utm_source=ig&token=abc&PASSWORD=x&api_key=k&%74oken2=ok&Code=WEN10&keep=1");
    expect(out).toBe("https://ejemplo.test/p?utm_source=ig&%74oken2=ok&keep=1");
  });

  it("saca los internos del sistema (embed, attr, preview, c, referrer)", () => {
    const out = entryUrlFrom("https://ejemplo.test/f/mi-form?embed=1&attr=eyJ&preview=1&c=firma&referrer=https%3A%2F%2Fx.test&utm_source=ig");
    expect(out).toBe("https://ejemplo.test/f/mi-form?utm_source=ig");
  });

  it("saca el fragmento y las credenciales de la URL", () => {
    expect(entryUrlFrom("https://user:clave@ejemplo.test/p?a=1#seccion")).toBe("https://ejemplo.test/p?a=1");
  });

  it("sin parametros queda origen y ruta, sin signo de pregunta", () => {
    expect(entryUrlFrom("https://ejemplo.test/p?token=abc")).toBe("https://ejemplo.test/p");
    expect(entryUrlFrom("https://ejemplo.test/p?")).toBe("https://ejemplo.test/p");
  });

  it("limpia caracteres de control", () => {
    expect(entryUrlFrom("https://ejemplo.test/p?a=1\u0000&b=\u00072")).toBe("https://ejemplo.test/p?a=1&b=2");
  });

  it("recorta a 2000 caracteres sin dejar una codificacion a medias", () => {
    const long = `https://ejemplo.test/p?utm_source=ig&x=${"a".repeat(1960)}%C2%B7${"b".repeat(100)}`;
    const out = entryUrlFrom(long) ?? "";
    expect(out.length).toBeLessThanOrEqual(ENTRY_URL_MAX_LENGTH);
    expect(out.startsWith("https://ejemplo.test/p?utm_source=ig&x=")).toBe(true);
    expect(out).not.toMatch(/%[0-9A-Fa-f]?$/);
    const cutMidEncoding = `https://ejemplo.test/p?x=${"a".repeat(1974)}%C2%B7`;
    expect(entryUrlFrom(cutMidEncoding)).not.toMatch(/%[0-9A-Fa-f]?$/);
  });

  it("rechaza lo que no es http ni https, y devuelve null si no hay URL", () => {
    for (const bad of ["javascript:alert(1)", "ftp://ejemplo.test/x", "data:text/html,hola", "no es una url", "", "   ", null, undefined, 42, {}]) {
      expect(entryUrlFrom(bad as unknown)).toBeNull();
    }
  });

  it("la lista de nombres sensibles es la compartida con el embed", () => {
    expect([...SENSITIVE_PARAM_NAMES]).toEqual(
      expect.arrayContaining(["token", "password", "secret", "access_token", "api_key"]),
    );
  });
});
