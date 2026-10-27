import { describe, expect, it } from "vitest";
import { cleanCommentLine, cleanSource, historyRefs } from "./clean-comments.mjs";
import { codeTokens, findComments } from "./comments.mjs";

// Los numeros de migracion y los codigos se arman por partes: asi este archivo no queda en el
// control de historia del proyecto por sus propios ejemplos.
const M = (n: string) => `00${n}`;

describe("findComments: solo comentarios de verdad", () => {
  it("un // adentro de un string, de un template o de una regex no es un comentario", () => {
    const src = [
      'const a = "http://x.com // no";',
      "const b = `// tampoco ${a} /* ni esto */`;",
      "const c = /\\/\\/ ni esta/;",
      "// este si",
    ].join("\n");
    const found = findComments(src, "a.ts").map((c) => src.slice(c.start, c.end));
    expect(found).toEqual(["// este si"]);
  });

  it("en JSX, el texto no es un comentario y {/* */} si", () => {
    const src = [
      "export const X = () => (",
      "  <p>",
      "    Visita http://ejemplo.com // con barras",
      "    {/* el comentario */}",
      '    <a title="// tampoco">link</a>',
      "  </p>",
      ");",
    ].join("\n");
    const found = findComments(src, "a.tsx").map((c) => src.slice(c.start, c.end));
    expect(found).toEqual(["/* el comentario */"]);
  });

  it("encuentra los comentarios antes de una llave de cierre y al final del archivo", () => {
    const src = "function f() {\n  g();\n  // al final del bloque\n}\n// al final del archivo\n";
    const found = findComments(src, "a.ts").map((c) => src.slice(c.start, c.end));
    expect(found).toEqual(["// al final del bloque", "// al final del archivo"]);
  });

  it("CSS y SQL", () => {
    expect(findComments('a { content: "/* no */"; } /* si */', "a.css")).toHaveLength(1);
    const sql = "select '-- no' as x; -- si\n/* tambien */ select $$ -- adentro de la funcion $$;";
    expect(findComments(sql, "a.sql").map((c) => sql.slice(c.start, c.end))).toEqual(["-- si", "/* tambien */", "-- adentro de la funcion $$;"]);
  });
});

describe("cleanCommentLine", () => {
  const cases: [string, string | null][] = [
    // Numeros de migracion
    [` Las cuentas donde puede responder (${M("249")}): \`null\` = en todas.`, " Las cuentas donde puede responder: `null` = en todas."],
    [` Índice parcial de la ${M("103")}.`, " Índice parcial."],
    [` Con el de servicio: desde la ${M("143")} \`read_secret\` solo la ejecuta el`, " Con el de servicio: `read_secret` solo la ejecuta el"],
    [` Pipeline (${M("245")}/${M("246")}): estado y producto.`, " Pipeline: estado y producto."],
    [` ${M("259")}: esperando respuesta, el mismo`, " Esperando respuesta, el mismo"],
    [` El scope lo aplica la RLS (migracion ${M("041")}): un Member`, " El scope lo aplica la RLS: un Member"],
    // Fechas (las de un ejemplo quedan)
    [" sobre blanco (22/10/2026). Tambien", " sobre blanco. Tambien"],
    [" Verificado contra la documentacion el 26/9/2026.", " Verificado contra la documentacion."],
    [" Martes 6/10/2026 10:10 en Costa Rica.", " Martes 6/10/2026 10:10 en Costa Rica."],
    [' "2026-10-09" → "09/10/2026".', ' "2026-10-09" → "09/10/2026".'],
    // Codigos de requerimiento y etapas
    [" Dashboard de Chat (Bloques 2e y 3, F14-F18, F22).", " Dashboard de Chat."],
    [" Desde F4 devuelve el id: la ingesta", " Devuelve el id: la ingesta"],
    [" ── C14 · el color de cada tarjeta ──────", " ── El color de cada tarjeta ──────"],
    [" Fase 3: las conversaciones donde fallo (indice parcial).", " Las conversaciones donde fallo (indice parcial)."],
    [" Atribucion de un contacto (F10, y F84 de Contenido v3).", " Atribucion de un contacto."],
    [" ¿Es un previsualizador? (Extra I, F40.)", " ¿Es un previsualizador?"],
    [" Cambio aprobado M9 (Extra I): el Member ve sus comisiones", " El Member ve sus comisiones"],
    [" Importar pide `contacts.import` (cambio aprobado del Member, plano §9.3).", " Importar pide `contacts.import`."],
    [" Un evento (decisión del 20/10/2026): no tiene", " Un evento: no tiene"],
    [" retención y, desde el Extra I, «Atribución»", " retención y «Atribución»"],
    [" El agente que eligio (E1: para saber si su IA sigue conectada).", " El agente que eligio (para saber si su IA sigue conectada)."],
    [" La lista (auditoria de automatizaciones, oct 2026): buscador y filtros", " La lista: buscador y filtros"],
    [" Mejoras de Chat: el asistente no pudo entender un mensaje.", " El asistente no pudo entender un mensaje."],
    [' "Clasificación al cierre" (Bloque Agentes IA) no tiene `source` propio', ' "Clasificación al cierre" no tiene `source` propio'],
    [" Decision 152 aparte: (decision 153) nada", " Decision 152 aparte: nada"],
    [" Ver `docs/sitio.md`.", null],
    [` ${M("118")}`, null],
    // Lo que no es historia no se toca
    [" OLE (Compound File Binary): D0 CF 11 E0 A1 B1 1A E1", " OLE (Compound File Binary): D0 CF 11 E0 A1 B1 1A E1"],
    [" Firma HMAC-SHA256 y la clave ES256", " Firma HMAC-SHA256 y la clave ES256"],
    [" titulos (H1 a H3), MP4 y T0+140s", " titulos (H1 a H3), MP4 y T0+140s"],
    [" La codificacion queda: \"%C2%B7\"", " La codificacion queda: \"%C2%B7\""],
    [` El numero de una migracion (\`${M("042")}_algo.sql\` -> 42).`, ` El numero de una migracion (\`${M("042")}_algo.sql\` -> 42).`],
    [" Usa la API /api/v1/messages y Tailwind v4", " Usa la API /api/v1/messages y Tailwind v4"],
    [" «15 nov 2026». Una fecha civil", " «15 nov 2026». Una fecha civil"],
    [" El 3 de octubre de 2026, 12:00 en Costa Rica.", " El 3 de octubre de 2026, 12:00 en Costa Rica."],
  ];
  it.each(cases)("%s", (input, expected) => {
    expect(cleanCommentLine(input)).toBe(expected);
  });

  it("avisa cuando lo que queda pide la referencia (hay que reescribirlo a mano)", () => {
    const w: string[] = [];
    cleanCommentLine(" Programar de verdad es F25. Mover la tarjeta", w);
    cleanCommentLine(` un producto anterior a la ${M("134")}.`, w);
    cleanCommentLine(" El Bloque 1 asumio lo contrario", w);
    cleanCommentLine(" La Tanda B compila `entry.ts`", w);
    expect(w).toHaveLength(4);
    const ok: string[] = [];
    cleanCommentLine(" Desde la Fase 3 los entrantes se guardan", ok);
    cleanCommentLine(" Cancelar desde el equipo, con motivo (F36).", ok);
    expect(ok).toEqual([]);
  });

  it("una directiva no se toca", () => {
    const line = ` eslint-disable-next-line no-console -- ${M("143")}`;
    expect(cleanCommentLine(line)).toBe(line);
  });
});

describe("cleanSource", () => {
  it("saca la linea de un comentario que queda vacio y deja el codigo igual", () => {
    const src = ["const a = 1;", `// ${M("118")}`, "const b = 2; // (F25)", "const c = 3;"].join("\n");
    const { text, changed } = cleanSource(src, "a.ts");
    expect(text).toBe(["const a = 1;", "const b = 2;", "const c = 3;"].join("\n"));
    expect(changed).toBe(2);
  });

  it("en un bloque saca solo las lineas vacias y conserva la forma", () => {
    const src = ["/**", " * El widget (banca v2, F7-F9).", ` * Fase 3`, " *", " * Sigue igual.", " */", "export const x = 1;"].join("\n");
    const { text } = cleanSource(src, "a.ts");
    expect(text).toBe(["/**", " * El widget.", " *", " * Sigue igual.", " */", "export const x = 1;"].join("\n"));
  });

  it("un bloque que queda vacio se va entero, y en JSX con sus llaves", () => {
    const src = ["export const X = () => (", "  <div>", "    {/* (F25) */}", "    <p>hola</p>", "  </div>", ");"].join("\n");
    const { text } = cleanSource(src, "a.tsx");
    expect(text).toBe(["export const X = () => (", "  <div>", "    <p>hola</p>", "  </div>", ");"].join("\n"));
    expect(codeTokens(text, "a.tsx")).toEqual(codeTokens(src, "a.tsx"));
  });

  it("no toca strings ni texto de JSX aunque tengan referencias", () => {
    const src = [`const s = "la ${M("249")} (F25)";`, "export const X = () => <p>Fase 3 (F25)</p>;"].join("\n");
    expect(cleanSource(src, "a.tsx").text).toBe(src);
  });

  it("SQL y CSS", () => {
    expect(cleanSource(`select 1; -- (${M("249")})\n`, "a.sql").text).toBe("select 1;\n");
    expect(cleanSource("/* El zoom del iPhone (23/10/2026). */\na {}", "a.css").text).toBe("/* El zoom del iPhone. */\na {}");
  });
});

describe("historyRefs", () => {
  it("encuentra lo mismo que la limpieza saca, y no las fechas de ejemplo", () => {
    expect(historyRefs(` desde la ${M("143")} (F25, Extra I) el 22/10/2026`).map((h) => h.rule)).toEqual([
      "numero de migracion",
      "fecha",
      "codigo de requerimiento",
      "etapa del proyecto",
    ]);
    expect(historyRefs(" Martes 6/10/2026 10:10 en Costa Rica")).toEqual([]);
  });
});
