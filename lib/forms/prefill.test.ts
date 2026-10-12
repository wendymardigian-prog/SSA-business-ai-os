import { describe, it, expect } from "vitest";
import { AUTO_ATTRIBUTION_GROUPS, CONTACT_LINK_VARIABLES, buildPrefillLink, coercePrefillValue, describePrefillParams, exampleValueFor, hiddenValues, prefillAliasesFor, prefillFromParams } from "./prefill";
import { addField } from "./builder";
import { ATTRIBUTION_KEYS } from "@/lib/attribution/keys";
import { newField, type FormField } from "./fields";

const f = (type: Parameters<typeof newField>[0], key: string, extra: Partial<FormField> = {}): FormField => ({
  ...newField(type, key, key),
  ...extra,
});

describe("prefillFromParams", () => {
  const email = f("email", "email");
  const plan = f("single_select", "plan", { options: ["A", "B"] });

  it("?email=ana@x.com&plan=Otro prellena el email y NO el plan inválido", () => {
    const r = prefillFromParams([email, plan], { email: "ana@x.com", plan: "Otro" });
    expect(r.values).toEqual({ email: "ana@x.com" });
  });

  it("el primer parámetro declarado con valor gana", () => {
    const campo = f("email", "mail", { prefill: { params: ["correo", "email"], behavior: "editable" } });
    const r = prefillFromParams([campo], { email: "b@x.com", correo: "a@x.com" });
    expect(r.values.mail).toBe("a@x.com");
  });

  it("si el primer parámetro trae algo inválido se prueba con el siguiente", () => {
    const campo = f("email", "mail", { prefill: { params: ["correo", "email"], behavior: "editable" } });
    expect(prefillFromParams([campo], { correo: "no-es-mail", email: "b@x.com" }).values.mail).toBe("b@x.com");
  });

  it("behavior hidden: si vino lleno no se muestra; si no vino, se muestra normal", () => {
    const campo = f("short_text", "ref", { prefill: { params: ["ref"], behavior: "hidden" } });
    expect(prefillFromParams([campo], { ref: "abc" }).hiddenByPrefill.has("ref")).toBe(true);
    expect(prefillFromParams([campo], {}).hiddenByPrefill.has("ref")).toBe(false);
  });

  it("behavior locked", () => {
    const campo = f("short_text", "plan2", { prefill: { params: ["plan"], behavior: "locked" } });
    const r = prefillFromParams([campo], { plan: "pro" });
    expect(r.locked.has("plan2")).toBe(true);
  });

  it("un hidden con valor inválido por URL se ignora y el campo se muestra vacío", () => {
    const campo = f("email", "mail", { prefill: { params: ["mail"], behavior: "hidden" } });
    const r = prefillFromParams([campo], { mail: "no-es-mail" });
    expect(r.values).toEqual({});
    expect(r.hiddenByPrefill.size).toBe(0);
  });

  it("número fuera de rango queda vacío", () => {
    const campo = f("number", "cantidad", { max: 10 });
    expect(prefillFromParams([campo], { cantidad: "50" }).values).toEqual({});
    expect(prefillFromParams([campo], { cantidad: "7" }).values).toEqual({ cantidad: 7 });
  });

  it("lo explícito gana sobre la URL", () => {
    const campo = f("single_select", "plan", { options: ["pro", "basic"] });
    const r = prefillFromParams([campo], { plan: "basic" }, { explicit: { plan: "pro" } });
    expect(r.values.plan).toBe("pro");
  });

  it("nunca prellena consentimiento ni archivo", () => {
    const r = prefillFromParams([f("consent", "ok"), f("file", "adj")], { ok: "true", adj: "x.pdf" });
    expect(r.values).toEqual({});
  });

  it("no distingue mayúsculas en el nombre del parámetro", () => {
    expect(prefillFromParams([email], { EMAIL: "ana@x.com" }).values.email).toBe("ana@x.com");
  });
});

describe("coercePrefillValue", () => {
  it("selección: devuelve la opción con sus mayúsculas originales", () => {
    expect(coercePrefillValue(f("single_select", "s", { options: ["Más de 10k", "Menos"] }), "más de 10K")).toBe("Más de 10k");
  });

  it("múltiple separada por coma; un valor inválido la invalida entera", () => {
    const campo = f("multi_select", "m", { options: ["A", "B", "C"] });
    expect(coercePrefillValue(campo, "a, c")).toEqual(["A", "C"]);
    expect(coercePrefillValue(campo, "a,zzz")).toBeNull();
  });

  it("fecha ISO real, NPS y estrellas enteros", () => {
    expect(coercePrefillValue(f("date", "d"), "2026-10-10")).toBe("2026-10-10");
    expect(coercePrefillValue(f("date", "d"), "2026-02-31")).toBeNull();
    expect(coercePrefillValue(f("date", "d"), "10/10/2026")).toBeNull();
    expect(coercePrefillValue(f("nps", "n"), "10")).toBe(10);
    expect(coercePrefillValue(f("nps", "n"), "11")).toBeNull();
    expect(coercePrefillValue(f("nps", "n"), "7.5")).toBeNull();
    expect(coercePrefillValue(f("rating", "r"), "0")).toBeNull();
    expect(coercePrefillValue(f("rating", "r"), "5")).toBe(5);
  });

  it("teléfono normalizado a E.164, con país por defecto", () => {
    expect(coercePrefillValue(f("phone", "t"), "+506 8888-1234")).toBe("+50688881234");
    expect(coercePrefillValue(f("phone", "t"), "8888 1234", "CR")).toBe("+50688881234");
    expect(coercePrefillValue(f("phone", "t"), "abc")).toBeNull();
  });

  it("email se normaliza a minúsculas", () => {
    expect(coercePrefillValue(f("email", "e"), " ANA@X.com ")).toBe("ana@x.com");
  });
});

describe("hiddenValues", () => {
  const url = { ...f("hidden", "campana"), hidden: { source: "url_param" as const, param: "utm_campaign" } };
  const attr = { ...f("hidden", "origen"), hidden: { source: "attribution" as const, param: "utm_source" } };
  const fixed = { ...f("hidden", "canal"), hidden: { source: "fixed" as const, value: "octubre" } };

  it("toma de la URL y de la atribución, nunca el valor fijo", () => {
    const out = hiddenValues([url, attr, fixed], { utm_campaign: "oct" }, { utm_source: "meta" });
    expect(out).toEqual({ campana: "oct", origen: "meta" });
    expect(JSON.stringify(out)).not.toContain("octubre");
  });
});

describe("describePrefillParams (F32)", () => {
  const field = (type: Parameters<typeof newField>[0], key: string, extra: Record<string, unknown> = {}) => ({ ...newField(type, key, key), ...extra });

  it("lista los campos prellenables con sus parámetros y su comportamiento", () => {
    const out = describePrefillParams({
      fields: [
        field("email", "email", { label: "Email" }),
        field("short_text", "nombre", { label: "Nombre", prefill: { params: ["nombre", "name"], behavior: "locked" } }),
      ],
    });
    expect(out.fields).toEqual([
      // R7: la fila trae además el tipo y un ejemplo válido (para el link de muestra).
      { fieldKey: "email", label: "Email", type: "email", example: "ana@ejemplo.com", params: ["email"], behavior: "editable" },
      { fieldKey: "nombre", label: "Nombre", type: "short_text", example: "Ana", params: ["nombre", "name"], behavior: "locked" },
    ]);
  });

  it("NO lista consentimientos ni archivos", () => {
    const out = describePrefillParams({ fields: [field("consent", "acepto"), field("file", "cv"), field("short_text", "nombre")] });
    expect(out.fields.map((f) => f.fieldKey)).toEqual(["nombre"]);
  });

  it("lista los ocultos que vienen de la URL o de la atribución, y NO el valor de un oculto fijo (ni el campo)", () => {
    const out = describePrefillParams({
      fields: [
        field("hidden", "campana", { hidden: { source: "url_param", param: "utm_campaign" } }),
        field("hidden", "origen", { hidden: { source: "attribution", param: "gclid" } }),
        field("hidden", "secreto", { hidden: { source: "fixed", value: "valor-secreto-123" } }),
      ],
    });
    expect(out.hidden).toEqual([
      { fieldKey: "campana", label: "campana", source: "url_param", param: "utm_campaign" },
      { fieldKey: "origen", label: "origen", source: "attribution", param: "gclid" },
    ]);
    expect(JSON.stringify(out)).not.toContain("valor-secreto-123");
    expect(JSON.stringify(out)).not.toContain("secreto");
  });

  it("siempre dice lo que se registra solo (UTM, ids de clic, ids del anuncio, cookies)", () => {
    const out = describePrefillParams({ fields: [] });
    expect(out.auto.map((g) => g.title)).toEqual(["Campaña (UTM)", "Ids de clic de los anuncios", "Ids del anuncio", "Cookies de los anuncios"]);
    expect(out.auto[1].keys).toContain("msclkid");
  });

  it("las claves automáticas son las de lib/attribution/keys (una sola lista)", () => {
    const all = AUTO_ATTRIBUTION_GROUPS.flatMap((g) => g.keys).sort();
    expect(all).toEqual([...ATTRIBUTION_KEYS].sort());
  });
});

describe("buildPrefillLink (F32)", () => {
  it("la variable del contacto va SIN codificar y el resto codificado", () => {
    expect(buildPrefillLink("https://app.x/f/apl", { correo: "{{contact.email}}", plan: "pro" })).toBe("https://app.x/f/apl?correo={{contact.email}}&plan=pro");
  });
  it("codifica espacios, acentos y símbolos de los valores comunes", () => {
    expect(buildPrefillLink("https://app.x/f/apl", { nombre: "Ana Pérez & Cía" })).toBe("https://app.x/f/apl?nombre=Ana%20P%C3%A9rez%20%26%20C%C3%ADa");
  });
  it("un valor mixto codifica el texto y deja la variable", () => {
    expect(buildPrefillLink("https://app.x/f/apl", { msg: "Hola {{contact.display_name}}!" })).toBe("https://app.x/f/apl?msg=Hola%20{{contact.display_name}}!");
  });
  it("ignora valores vacíos y nombres inválidos; sin nada devuelve la base", () => {
    expect(buildPrefillLink("https://app.x/f/apl", { a: "", b: "  ", "mal nombre": "x", c: undefined, d: null })).toBe("https://app.x/f/apl");
  });
  it("si la base ya tiene query, suma con &", () => {
    expect(buildPrefillLink("https://app.x/f/apl?c=tok", { plan: "pro" })).toBe("https://app.x/f/apl?c=tok&plan=pro");
  });
  it("las variables que se ofrecen son las tres que el sistema resuelve", () => {
    expect([...CONTACT_LINK_VARIABLES]).toEqual(["{{contact.display_name}}", "{{contact.email}}", "{{contact.phone}}"]);
  });
  it("una variable con espacios adentro se normaliza (la que resuelve el motor no los tiene)", () => {
    expect(buildPrefillLink("https://x/f/a", { e: "{{ contact.email }}" })).toBe("https://x/f/a?e={{contact.email}}");
  });
});

describe("prefill de un usuario de red social (R5)", () => {
  const ig = f("social", "instagram", { social: { platform: "instagram" } });

  it("?instagram=@Prueba se prellena normalizado", () => {
    expect(prefillFromParams([ig], { instagram: "@Prueba" }).values.instagram).toBe("prueba");
  });

  it("un valor que no es un usuario válido se ignora entero", () => {
    expect(prefillFromParams([ig], { instagram: "no es un usuario" }).values).toEqual({});
  });
});

describe('el "+" de la URL (R7)', () => {
  const phone = f("phone", "telefono");
  const email = f("email", "email");

  it("un teléfono con + sin codificar llega como espacio y se restaura: +50688881234", () => {
    expect(coercePrefillValue(phone, " 50688881234", "CR")).toBe("+50688881234");
    // Antes: el espacio se recortaba, el número parecía local y se le sumaba el código del país otra vez.
    expect(coercePrefillValue(phone, "  50688881234", "CR")).toBe("+50688881234");
  });

  it("un teléfono local sin + sigue igual (sin cambios)", () => {
    expect(coercePrefillValue(phone, "88881234", "CR")).toBe("+50688881234");
    expect(coercePrefillValue(phone, "+50688881234", "CR")).toBe("+50688881234");
  });

  it("un email con + sin codificar llega con un espacio en el medio y se restaura", () => {
    expect(coercePrefillValue(email, "ana promo@x.com")).toBe("ana+promo@x.com");
    expect(coercePrefillValue(email, "ana+promo@x.com")).toBe("ana+promo@x.com");
    expect(coercePrefillValue(email, "  ana@x.com  ")).toBe("ana@x.com");
  });

  it("de punta a punta: buildPrefillLink → la variable se reemplaza SIN codificar → la URL → el campo", () => {
    const link = buildPrefillLink("https://app.ejemplo.test/f/aplicacion", { telefono: "{{contact.phone}}", email: "{{contact.email}}" });
    // El nodo de envío reemplaza la variable por el valor tal cual, sin codificar.
    const resolved = link.replace("{{contact.phone}}", "+50688881234").replace("{{contact.email}}", "ana+promo@x.com");
    const params: Record<string, string> = {};
    new URL(resolved).searchParams.forEach((value, key) => (params[key] = value));
    const result = prefillFromParams([phone, email], params, { defaultCountry: "CR" });
    expect(result.values.telefono).toBe("+50688881234");
    expect(result.values.email).toBe("ana+promo@x.com");
  });

  it("codificado a mano también funciona", () => {
    const link = buildPrefillLink("https://app.ejemplo.test/f/a", { telefono: "+50688881234", email: "ana+promo@x.com" });
    const params: Record<string, string> = {};
    new URL(link).searchParams.forEach((value, key) => (params[key] = value));
    expect(prefillFromParams([phone, email], params, { defaultCountry: "CR" }).values).toEqual({ telefono: "+50688881234", email: "ana+promo@x.com" });
  });
});

describe("parámetros cortos automáticos (R7)", () => {
  it("un campo email nuevo se llena con ?email=… (su clave ya es email, o se suma el alias si la clave es otra)", () => {
    const [field] = addField([], "email");
    expect(field.key).toBe("email");
    expect(field.prefill).toBeUndefined(); // el parámetro por defecto ya es `email`
    expect(prefillAliasesFor({ type: "email", key: "correo_de_contacto" }, [])).toEqual(["email"]);
  });

  it("si otro campo ya lo usa, NO se suma: el segundo email no se queda con ?email=", () => {
    const fields = addField(addField([], "email"), "email");
    expect(fields[1].key).not.toBe("email");
    expect(fields[1].prefill).toBeUndefined();
    expect(prefillFromParams(fields, { email: "ana@x.com" }).values).toEqual({ [fields[0].key]: "ana@x.com" });
  });

  it("teléfono suma telefono y phone (menos el que ya es su clave); las redes, su nombre", () => {
    expect(addField([], "phone")[0].prefill?.params).toEqual(["telefono", "phone"]);
    expect(prefillAliasesFor({ type: "phone", key: "mi_numero" }, [])).toEqual(["telefono", "phone"]);
    const [social] = addField([], "social");
    expect(social.prefill?.params).toEqual([social.key, "instagram"]);
    expect(prefillFromParams([social], { instagram: "@Prueba" }).values[social.key]).toBe("prueba");
  });

  it("un campo cuya clave ya es el alias no lo repite", () => {
    expect(prefillAliasesFor({ type: "email", key: "email" }, [])).toEqual([]);
  });

  it("el alias que otro campo ya tiene como clave (sin prefill propio) cuenta como usado", () => {
    expect(prefillAliasesFor({ type: "email", key: "correo" }, [{ key: "email" }])).toEqual([]);
  });

  it("no se suma nada a los demás tipos", () => {
    expect(addField([], "short_text")[0].prefill).toBeUndefined();
  });
});

describe("ejemplos de link (R7)", () => {
  it("cada campo prellenable tiene un ejemplo que su propio campo acepta", () => {
    for (const type of ["short_text", "long_text", "email", "phone", "number", "date", "rating", "nps"] as const) {
      const field = f(type, "campo");
      expect(coercePrefillValue(field, exampleValueFor(field), "CR"), type).not.toBeNull();
    }
    const select = f("single_select", "plan", { options: ["A", "B"] });
    expect(coercePrefillValue(select, exampleValueFor(select))).toBe("A");
    const social = f("social", "ig", { social: { platform: "instagram" } });
    expect(coercePrefillValue(social, exampleValueFor(social))).toBe("tuusuario");
  });

  it("describePrefillParams trae tipo y ejemplo por campo", () => {
    const row = describePrefillParams({ fields: [f("email", "email")] }).fields[0];
    expect(row.type).toBe("email");
    expect(row.example).toBe("ana@ejemplo.com");
  });
});
