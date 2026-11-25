#!/usr/bin/env node
/**
 * Arma el catálogo de acciones del conector MCP (docs/mcp.md) desde `lib/actions/`.
 *
 * Cada función exportada de un archivo "use server" es algo que una persona puede hacer desde una pantalla, y corre
 * con los mismos guards de permiso. El conector las ofrece todas (menos las excluidas en `lib/mcp/overrides.json`):
 *  - `lib/mcp/catalog.generated.ts`: (el JSON como texto, con tipo explícito: importarlo como .json hacía que TypeScript
 *    dedujera el tipo de las ~900 entradas y se quedara sin memoria) id, archivo, nombre, parámetros con su forma completa (las interfaces se
 *    despliegan para que la IA sepa qué mandar), descripción (JSDoc) y las claves de permiso que se ven en el cuerpo.
 *  - `lib/mcp/action-loaders.generated.ts`: un import estático por archivo (para que el bundler los incluya).
 *
 * Uso: node scripts/build-mcp-catalog.mjs          (escribe)
 *      node scripts/build-mcp-catalog.mjs --check  (falla si lo generado no está al día; lo usa el test)
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ACTIONS_DIR = path.join(ROOT, "lib/actions");
const OUT_JSON = path.join(ROOT, "lib/mcp/catalog.generated.ts");
const OUT_LOADERS = path.join(ROOT, "lib/mcp/action-loaders.generated.ts");
const OVERRIDES = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/mcp/overrides.json"), "utf8"));

// La plantilla de estudiantes saca módulos enteros (y sus archivos de lib/actions). En el proyecto, el import de un
// archivo de un módulo que no viaja lleva su marca `quitar`, así el export lo saca (y después vuelve a generar el
// catálogo con lo que quedó). En la copia de la plantilla el perfil no existe y no hay marcas.
let moduleOfPath = () => null;
try {
  ({ moduleOfPath } = await import("./plantilla/perfiles/estudiantes.mjs"));
} catch {
  /* sin perfil: la copia de una plantilla */
}
const MARK = "@plantilla-" + "quitar";

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function isUseServer(source) {
  for (const stmt of source.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      if (stmt.expression.text === "use server") return true;
      continue;
    }
    return false;
  }
  return false;
}

const files = walk(ACTIONS_DIR)
  .filter((f) => isUseServer(ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true)))
  .sort();

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, ROOT);
const program = ts.createProgram(files, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();

const FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType;

/** La forma de un tipo, desplegando objetos hasta `depth` niveles. Texto corto y legible para la IA. */
function shape(type, depth, seen = new Set()) {
  if (depth <= 0) return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  if (type.isUnion()) {
    const parts = [...new Set(type.types.map((t) => shape(t, depth, seen)))];
    return parts.length > 12 ? checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation) : parts.join(" | ");
  }
  const str = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  if (/^(string|number|boolean|null|undefined|unknown|any|never|void|true|false|bigint|Date|FormData|File|Blob)$/.test(str)) return str;
  if (type.isStringLiteral() || type.isNumberLiteral()) return str;
  if (checker.isArrayType(type)) {
    const [el] = checker.getTypeArguments(type);
    return `${shape(el, depth, seen)}[]`.replace(/^(.+\|.+)\[\]$/, "($1)[]");
  }
  if (type.getCallSignatures().length > 0) return str;
  const props = checker.getPropertiesOfType(type);
  if ((type.flags & ts.TypeFlags.Object) && props.length > 0 && props.length <= 40) {
    if (seen.has(type)) return str;
    const next = new Set(seen).add(type);
    const fields = props.map((p) => {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      const pt = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getDeclaredTypeOfSymbol(p);
      const optional = (p.flags & ts.SymbolFlags.Optional) !== 0;
      const doc = ts.displayPartsToString(p.getDocumentationComment(checker)).replace(/\s+/g, " ").trim();
      const t = shape(optional ? checker.getNonNullableType(pt) : pt, depth - 1, next);
      return `${p.name}${optional ? "?" : ""}: ${t}${doc ? ` /* ${doc.slice(0, 140)} */` : ""}`;
    });
    return `{ ${fields.join("; ")} }`;
  }
  return str;
}

const PERM_RE = /(?:getPermissionAction|requirePermission|ctx\.can|\.can)\(\s*["'`]([a-z_]+\.[a-z_.]+)["'`]/g;
const ANY_RE = /(?:getAnyPermissionAction|requireAnyPermission)\(\s*\[([^\]]+)\]/g;

function keysIn(text) {
  const keys = new Set();
  for (const m of text.matchAll(PERM_RE)) keys.add(m[1]);
  for (const m of text.matchAll(ANY_RE)) for (const k of m[1].matchAll(/["'`]([a-z_]+\.[a-z_.]+)["'`]/g)) keys.add(k[1]);
  return [...keys].sort();
}

/** lectura / escritura / delicada, por el nombre (con lo explícito de overrides.json por encima). */
function classify(id, name) {
  if (OVERRIDES.kind?.[id]) return OVERRIDES.kind[id];
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/);
  const first = words[0];
  const SENSITIVE = ["delete", "remove", "void", "cancel", "archive", "purge", "restore", "merge", "send", "broadcast", "invite", "publish", "unpublish", "revoke", "ban", "transfer", "disconnect", "reset", "regenerate", "refund", "discard", "reject", "empty", "wipe", "reassign", "trash", "approve", "issue", "resend", "disable", "uninstall", "unlink", "drop"];
  if (words.some((w) => SENSITIVE.includes(w))) return "sensitive";
  if (/role|permission|roles/.test(id.split("#")[0]) && !["get", "list", "load"].includes(first)) return "sensitive";
  const READ = ["get", "list", "load", "fetch", "search", "find", "count", "preview", "read", "check", "describe", "estimate", "suggest", "probe", "lookup", "export", "explain", "compare", "resolve", "validate", "test", "simulate", "summarize", "show", "view", "query", "sample", "measure"];
  if (READ.includes(first)) return "read";
  return "write";
}

const actions = [];
const loaderKeys = new Map();
for (const file of files) {
  const rel = path.relative(ACTIONS_DIR, file).replace(/\\/g, "/").replace(/\.ts$/, "");
  if ((OVERRIDES.excludedFiles ?? []).includes(rel)) continue;
  const source = program.getSourceFile(file);
  if (!source) continue;
  for (const stmt of source.statements) {
    let name = null;
    let fnNode = null;
    const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      name = stmt.name.text;
      fnNode = stmt;
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          name = d.name.text;
          fnNode = d.initializer;
        }
      }
    }
    if (!name || !fnNode) continue;
    const id = `${rel}#${name}`;
    if ((OVERRIDES.excludedActions ?? []).includes(id)) continue;
    const signature = checker.getSignatureFromDeclaration(fnNode);
    const params = (fnNode.parameters ?? []).map((p) => {
      const pt = checker.getTypeAtLocation(p);
      const optional = !!p.questionToken || !!p.initializer;
      return { name: p.name.getText(source), optional, type: shape(optional ? checker.getNonNullableType(pt) : pt, 3) };
    });
    const ret = signature ? checker.typeToString(checker.getReturnTypeOfSignature(signature), undefined, ts.TypeFormatFlags.NoTruncation) : "unknown";
    const docNode = ts.isFunctionDeclaration(stmt) ? stmt : stmt;
    const jsdoc = ts
      .getJSDocCommentsAndTags(docNode)
      .map((d) => (typeof d.comment === "string" ? d.comment : Array.isArray(d.comment) ? d.comment.map((c) => c.text).join("") : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    actions.push({
      id,
      file: rel,
      name,
      kind: classify(id, name),
      permissions: keysIn(fnNode.getText(source)),
      params,
      returns: ret.length > 600 ? `${ret.slice(0, 600)}…` : ret,
      description: (OVERRIDES.descriptions?.[id] ?? jsdoc).slice(0, 700),
    });
    loaderKeys.set(rel, true);
  }
}

const json = [
  "// GENERADO por scripts/build-mcp-catalog.mjs: no editar a mano (node scripts/build-mcp-catalog.mjs).",
  "// El catálogo va como texto: importado como objeto, TypeScript deduce el tipo de cada entrada y se queda sin memoria.",

  `export const CATALOG_JSON: string = ${JSON.stringify(JSON.stringify({ count: actions.length, actions }))};`,
  "",
].join("\n");
const loaders = [
  "// GENERADO por scripts/build-mcp-catalog.mjs: no editar a mano (node scripts/build-mcp-catalog.mjs).",
  "// Un import por archivo de lib/actions: así el bundler incluye cada acción en la ruta del conector MCP.",

  "export const ACTION_MODULES: Record<string, () => Promise<Record<string, unknown>>> = {",
  ...[...loaderKeys.keys()].sort().map((rel) => {
    const mod = moduleOfPath(`lib/actions/${rel}.ts`);
    return `  ${JSON.stringify(rel)}: () => import(${JSON.stringify(`@/lib/actions/${rel}`)}) as Promise<Record<string, unknown>>,${mod ? ` // ${MARK}(${mod})` : ""}`;
  }),
  "};",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const same = fs.existsSync(OUT_JSON) && fs.readFileSync(OUT_JSON, "utf8") === json && fs.existsSync(OUT_LOADERS) && fs.readFileSync(OUT_LOADERS, "utf8") === loaders;
  if (!same) {
    console.error("El catálogo del MCP no está al día: corré node scripts/build-mcp-catalog.mjs");
    process.exit(1);
  }
  console.log(`Catálogo al día (${actions.length} acciones).`);
} else {
  fs.writeFileSync(OUT_JSON, json);
  fs.writeFileSync(OUT_LOADERS, loaders);
  const byKind = actions.reduce((acc, a) => ((acc[a.kind] = (acc[a.kind] ?? 0) + 1), acc), {});
  console.log(`Catálogo del MCP: ${actions.length} acciones`, byKind);
}
