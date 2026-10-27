// Marcas de la plantilla: comentarios que dicen que lineas se van cuando un modulo
// no viaja a una plantilla (por ejemplo, la de estudiantes sin Ventas ni Tareas).
//
// En el proyecto son SOLO COMENTARIOS: no cambian nada de lo que hace el sistema.
// El export de la plantilla las lee y saca lo marcado.
//
// Tres formas (el nombre del modulo es su id: ventas, tareas, formularios...):
//
//   1. Una linea:      algo();  // @plantilla-quitar(ventas,tareas)
//      Se va la linea entera si se excluye CUALQUIERA de los modulos de la lista.
//
//   2. Un bloque:      // @plantilla-desde(ventas)
//                      ...
//                      // @plantilla-hasta(ventas)
//      Se van las lineas de adentro y las dos marcas. En JSX va como
//      {/* @plantilla-desde(ventas) */} ... {/* @plantilla-hasta(ventas) */}, y en SQL
//      con "--". Los bloques no se anidan (es un error), y el "hasta" tiene que nombrar
//      los mismos modulos que su "desde".
//
//   3. Una linea que aparece:   // @plantilla-sin(ventas): const columnas = [];
//      En el proyecto es un comentario. Si se excluye alguno de los modulos, la linea
//      queda como "const columnas = [];" (con la misma sangria). Sirve para el reemplazo
//      de lo que se saco con un bloque, cuando sacar solo no alcanza.
//
// Todo es puro (texto -> texto): lo usan el test de frontera, el simulador del
// export y, mas adelante, el export de verdad.

// El prefijo se arma por partes para que este archivo no tenga marcas de verdad.
const P = "@plantilla-";
const NAME = "[a-z0-9_-]+";
const LIST = `${NAME}(?:\\s*,\\s*${NAME})*`;

const RE_ANY = new RegExp(`${P}(quitar|desde|hasta|sin)\\b`);
const RE_QUITAR = new RegExp(`${P}quitar\\(\\s*(${LIST})\\s*\\)`);
const RE_DESDE = new RegExp(`${P}desde\\(\\s*(${LIST})\\s*\\)`);
const RE_HASTA = new RegExp(`${P}hasta\\(\\s*(${LIST})\\s*\\)`);
const RE_SIN = new RegExp(`^(\\s*)//\\s*${P}sin\\(\\s*(${LIST})\\s*\\):\\s?(.*)$`);

const parseList = (raw) => raw.split(",").map((s) => s.trim()).filter(Boolean);

/** Error de una marca mal puesta. Lleva la linea (1 = la primera). */
export class MarkerError extends Error {
  constructor(message, line) {
    super(line ? `linea ${line}: ${message}` : message);
    this.line = line;
  }
}

/**
 * Lee las marcas de un texto, sin sacar nada. Devuelve una entrada por marca:
 * { kind: "quitar" | "desde" | "hasta" | "sin", modules: string[], line }.
 * Lanza MarkerError si una marca esta mal escrita, si un bloque no cierra, si se anida
 * o si el "hasta" no coincide con su "desde". Con `known`, tambien si nombra un modulo
 * que no existe.
 */
export function parseMarkers(text, known) {
  const lines = text.split("\n");
  const out = [];
  let open = null;
  const check = (modules, line) => {
    if (!known) return;
    for (const m of modules) if (!known.includes(m)) throw new MarkerError(`modulo desconocido "${m}" en una marca`, line);
  };
  lines.forEach((text, i) => {
    const line = i + 1;
    if (!RE_ANY.test(text)) return;
    let m;
    if ((m = RE_SIN.exec(text))) {
      const modules = parseList(m[2]);
      check(modules, line);
      if (open) throw new MarkerError("una marca \"sin\" no puede ir adentro de un bloque", line);
      out.push({ kind: "sin", modules, line });
      return;
    }
    if ((m = RE_DESDE.exec(text))) {
      const modules = parseList(m[1]);
      check(modules, line);
      if (open) throw new MarkerError(`bloque anidado: ya habia uno abierto en la linea ${open.line}`, line);
      open = { kind: "desde", modules, line };
      out.push(open);
      return;
    }
    if ((m = RE_HASTA.exec(text))) {
      const modules = parseList(m[1]);
      check(modules, line);
      if (!open) throw new MarkerError("\"hasta\" sin su \"desde\"", line);
      if (modules.slice().sort().join(",") !== open.modules.slice().sort().join(","))
        throw new MarkerError(`el "hasta" (${modules.join(",")}) no coincide con su "desde" de la linea ${open.line} (${open.modules.join(",")})`, line);
      out.push({ kind: "hasta", modules, line });
      open = null;
      return;
    }
    if ((m = RE_QUITAR.exec(text))) {
      const modules = parseList(m[1]);
      check(modules, line);
      out.push({ kind: "quitar", modules, line });
      return;
    }
    throw new MarkerError("marca mal escrita (falta la lista de modulos entre parentesis, o el \":\" de \"sin\")", line);
  });
  if (open) throw new MarkerError(`bloque sin cerrar (abierto en la linea ${open.line})`, open.line);
  return out;
}

/** Los modulos que nombra cada marca, uno por entrada: [{ module, line }]. */
export function findMarkers(text, known) {
  return parseMarkers(text, known).flatMap((mk) => mk.modules.map((module) => ({ module, line: mk.line, kind: mk.kind })));
}

/**
 * Saca del texto lo marcado para los modulos excluidos. Una marca se aplica si nombra
 * AL MENOS UNO de los excluidos. Las marcas que no se aplican quedan como estan.
 * Lanza MarkerError si las marcas estan mal (ver parseMarkers).
 */
export function stripMarkers(text, excludedModules, known) {
  const excluded = new Set(excludedModules);
  const marks = parseMarkers(text, known);
  if (marks.length === 0) return text;
  const hits = (mk) => mk.modules.some((m) => excluded.has(m));
  const byLine = new Map(marks.map((mk) => [mk.line, mk]));
  const lines = text.split("\n");
  const out = [];
  let skipping = false;
  lines.forEach((text, i) => {
    const mk = byLine.get(i + 1);
    if (skipping) {
      if (mk?.kind === "hasta") skipping = false;
      return;
    }
    if (!mk) return void out.push(text);
    if (mk.kind === "desde") {
      if (hits(mk)) skipping = true;
      else out.push(text);
      return;
    }
    if (mk.kind === "quitar") {
      if (!hits(mk)) out.push(text);
      return;
    }
    if (mk.kind === "sin") {
      if (hits(mk)) {
        const m = RE_SIN.exec(text);
        out.push(`${m[1]}${m[3]}`);
      } else out.push(text);
      return;
    }
    out.push(text); // "hasta" de un bloque que se quedo
  });
  return out.join("\n");
}

/** true si el texto tiene alguna marca (sin validarla). */
export function hasMarkers(text) {
  return RE_ANY.test(text);
}
