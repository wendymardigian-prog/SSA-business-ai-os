import { describe, expect, it } from "vitest";
import {
  FIRST_TOUCH_MEDIUM_PATH,
  FIRST_TOUCH_SOURCE_PATH,
  MENU_FILTER_PARAMS,
  applyListClauses,
  contactListPlan,
  contactListSelect,
  countActiveFilters,
  countMenuFilters,
  parseContactListFilters,
  type ListClause,
} from "./list-query";

const A = "9f0d1b6e-1111-2222-3333-444455556666";
const B = "9f0d1b6e-aaaa-bbbb-cccc-ddddeeeeffff";
const fields = [{ id: "f-viajeros", slug: "cantidad_de_viajeros", name: "Cantidad de viajeros", type: "number" }];

const parse = (params: Record<string, string | string[]>) => parseContactListFilters(params, fields);
/** Las condiciones sin la de los anónimos, que va siempre. */
const clausesOf = (params: Record<string, string | string[]>) =>
  contactListPlan(parse(params)).clauses.filter((c) => !("column" in c && c.column === "is_anonymous"));

describe("leer los filtros de la URL", () => {
  it("un link viejo de un solo valor sigue funcionando", () => {
    const f = parse({ setter: A, temp: "hot", fuente: "instagram", estado_setter: "calificado", estado: "closer:ganado" });
    expect(f.setterIds).toEqual([A]);
    expect(f.temperatures).toEqual(["hot"]);
    expect(f.sources).toEqual(["instagram"]);
    expect(f.setterStatuses).toEqual(["calificado"]);
    expect(f.lastStatuses).toEqual([{ role: "closer", key: "ganado" }]);
  });

  it("un parámetro repetido es una lista, sin duplicados", () => {
    const f = parse({ setter: [A, B, A], email: ["bounced", "complained"], canal: ["instagram", "whatsapp"] });
    expect(f.setterIds).toEqual([A, B]);
    expect(f.emailStatuses).toEqual(["bounced", "complained"]);
    expect(f.platforms).toEqual(["instagram", "whatsapp"]);
  });

  it("lo inventado se ignora en vez de romper la consulta", () => {
    const f = parse({
      tag: ["no-es-uuid", A],
      setter: "'; drop table contacts; --",
      temp: "tibio",
      fuente: ["facebook", "telepatia"],
      medio: "dm",
      estado: ["mal", "setter:MAL VALOR", "setter:calificado"],
      estado_vendedor: "MAL VALOR",
      producto: "no-es-uuid",
      email: "spam",
      canal: "myspace",
      anon: "todos",
    });
    expect(f.tagIds).toEqual([A]);
    expect(f.setterIds).toEqual([]);
    expect(f.temperatures).toEqual([]);
    expect(f.sources).toEqual([]);
    expect(f.mediums).toEqual(["dm"]);
    expect(f.lastStatuses).toEqual([{ role: "setter", key: "calificado" }]);
    expect(f.closerStatuses).toEqual([]);
    expect(f.productIds).toEqual([]);
    expect(f.emailStatuses).toEqual([]);
    expect(f.platforms).toEqual([]);
    expect(f.anon).toBe("");
  });

  it("acepta «ninguno» donde tiene sentido", () => {
    const f = parse({ setter: "ninguno", estado_setter: ["ninguno", "nuevo"], producto: "ninguno" });
    expect(f.setterIds).toEqual(["ninguno"]);
    expect(f.setterStatuses).toEqual(["ninguno", "nuevo"]);
    expect(f.productIds).toEqual(["ninguno"]);
  });

  it("cuenta un filtro por parámetro, tenga una o varias opciones", () => {
    const f = parseContactListFilters({ setter: [A, B], temp: "hot", campo: "cantidad_de_viajeros", op: "gt", valor: "3" }, fields, "ana");
    expect(countMenuFilters(f)).toBe(3);
    expect(countActiveFilters(f)).toBe(4);
    expect(countMenuFilters(parse({}))).toBe(0);
  });

  it("«Limpiar filtros» conoce todos los parámetros del menú", () => {
    expect(MENU_FILTER_PARAMS).toEqual(
      expect.arrayContaining(["tag", "setter", "vendedor", "temp", "canal", "anon", "fuente", "medio", "estado", "estado_setter", "estado_vendedor", "producto", "email", "campo", "op", "valor"]),
    );
    expect(MENU_FILTER_PARAMS).not.toContain("q");
    expect(MENU_FILTER_PARAMS).not.toContain("orden");
  });
});

describe("la consulta", () => {
  it("sin filtros solo oculta a los anónimos", () => {
    expect(contactListPlan(parse({}))).toEqual({ embeds: [], clauses: [{ op: "eq", column: "is_anonymous", value: false }] });
  });

  it("los anónimos: incluidos no filtra, «solo» deja únicamente esos", () => {
    expect(contactListPlan(parse({ anon: "1" })).clauses).toEqual([]);
    expect(contactListPlan(parse({ anon: "solo" })).clauses).toEqual([{ op: "eq", column: "is_anonymous", value: true }]);
  });

  it("varias opciones son «cualquiera de»", () => {
    expect(clausesOf({ setter: [A, B], temp: ["hot", "warm"] })).toEqual([
      { op: "in", column: "setter_id", values: [A, B] },
      { op: "in", column: "lead_temperature", values: ["hot", "warm"] },
    ]);
  });

  it("«ninguno» solo es `is null`; junto con otros, un `or`", () => {
    expect(clausesOf({ vendedor: "ninguno" })).toEqual([{ op: "is_null", column: "vendedor_id" }]);
    expect(clausesOf({ estado_vendedor: ["ninguno", "ganado", "perdido"] })).toEqual([
      { op: "or", filter: "closer_status.is.null,closer_status.in.(ganado,perdido)" },
    ]);
    expect(clausesOf({ producto: ["ninguno", A] })).toEqual([{ op: "or", filter: `interest_product_id.is.null,interest_product_id.in.(${A})` }]);
  });

  it("el último estado: uno son dos `eq`, varios un `or` de pares", () => {
    expect(clausesOf({ estado: "setter:calificado" })).toEqual([
      { op: "eq", column: "last_status_role", value: "setter" },
      { op: "eq", column: "last_status", value: "calificado" },
    ]);
    expect(clausesOf({ estado: ["setter:calificado", "closer:ganado"] })).toEqual([
      { op: "or", filter: "and(last_status_role.eq.setter,last_status.eq.calificado),and(last_status_role.eq.closer,last_status.eq.ganado)" },
    ]);
  });

  it("la atribución filtra por el PRIMER toque, con las rutas de los índices de la 00114", () => {
    expect(FIRST_TOUCH_SOURCE_PATH).toBe("attribution->first_touch->>source");
    expect(FIRST_TOUCH_MEDIUM_PATH).toBe("attribution->first_touch->>medium");
    const clauses = clausesOf({ fuente: ["instagram", "tiktok"], medio: "comment" });
    expect(clauses).toEqual([
      { op: "in", column: FIRST_TOUCH_SOURCE_PATH, values: ["instagram", "tiktok"] },
      { op: "in", column: FIRST_TOUCH_MEDIUM_PATH, values: ["comment"] },
    ]);
    expect(JSON.stringify(clauses)).not.toContain("last_touch");
  });

  it("etiquetas y canales recortan con un join interno y no tocan las etiquetas que se muestran", () => {
    const plan = contactListPlan(parse({ tag: [A, B], canal: "whatsapp" }));
    expect(plan.embeds).toEqual(["tag_match:contact_tags!inner(tag_id)", "channel_match:contact_channels!inner(channels!inner(platform))"]);
    expect(contactListSelect("*, contact_tags(tag_id, tags(id, name, color))", plan)).toBe(
      "*, contact_tags(tag_id, tags(id, name, color)), tag_match:contact_tags!inner(tag_id), channel_match:contact_channels!inner(channels!inner(platform))",
    );
    expect(plan.clauses).toContainEqual({ op: "in", column: "tag_match.tag_id", values: [A, B] });
    expect(plan.clauses).toContainEqual({ op: "in", column: "channel_match.channels.platform", values: ["whatsapp"] });
  });

  it("el campo personalizado: join con la condición o anti-join para «vacío»", () => {
    const gt = contactListPlan(parse({ campo: "cantidad_de_viajeros", op: "gt", valor: "3" }));
    expect(gt.embeds).toEqual(["cf_match:contact_custom_fields!inner(field_id)"]);
    expect(gt.clauses).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "cf_match.field_id", value: "f-viajeros" },
        { op: "gt", column: "cf_match.value_number", value: 3 },
      ]),
    );
    const empty = contactListPlan(parse({ campo: "cantidad_de_viajeros", op: "empty" }));
    expect(empty.embeds).toEqual(["cf_match:contact_custom_fields(field_id)"]);
    expect(empty.clauses).toContainEqual({ op: "is_null", column: "cf_match" });
  });

  it("la búsqueda va primero, como un `or` ya armado", () => {
    const plan = contactListPlan(parse({}), "display_name.ilike.%ana%");
    expect(plan.clauses[0]).toEqual({ op: "or", filter: "display_name.ilike.%ana%" });
  });
});

describe("aplicar las condiciones", () => {
  it("llama al método de PostgREST que corresponde, en orden", () => {
    const calls: string[] = [];
    const builder: Record<string, (...args: unknown[]) => unknown> = {};
    for (const m of ["eq", "in", "is", "not", "ilike", "gt", "lt", "or"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push(`${m}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        return builder;
      };
    }
    const clauses: ListClause[] = [
      { op: "eq", column: "a", value: 1 },
      { op: "in", column: "b", values: ["x"] },
      { op: "is_null", column: "c" },
      { op: "not_null", column: "d" },
      { op: "ilike", column: "e", value: "%x%" },
      { op: "gt", column: "f", value: 2 },
      { op: "lt", column: "g", value: 3 },
      { op: "or", filter: "h.eq.1" },
    ];
    expect(applyListClauses(builder, clauses)).toBe(builder);
    expect(calls).toEqual([
      'eq("a",1)',
      'in("b",["x"])',
      'is("c",null)',
      'not("d","is",null)',
      'ilike("e","%x%")',
      'gt("f",2)',
      'lt("g",3)',
      'or("h.eq.1")',
    ]);
  });
});
