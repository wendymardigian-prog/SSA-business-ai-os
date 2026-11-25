import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Cómo responde una herramienta del conector. Puro. */

export const MAX_RESULT_CHARS = 100_000;

/** JSON legible y a prueba de lo que no es JSON (bigint, Map, Set, Error, funciones). Corta a ~100 KB con aviso. */
export function toJsonText(value: unknown, max = MAX_RESULT_CHARS): string {
  const seen = new WeakSet<object>();
  const text = JSON.stringify(
    value,
    (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "function" || typeof v === "symbol") return undefined;
      if (v instanceof Map) return Object.fromEntries(v);
      if (v instanceof Set) return [...v];
      if (v instanceof Error) return { error: v.message };
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      return v;
    },
    2,
  ) ?? "null";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[… respuesta cortada: ${text.length.toLocaleString("es-ES")} caracteres en total. Pedí menos filas o columnas, o filtrá más.]`;
}

export function ok(data: unknown, note?: string): CallToolResult {
  const body = toJsonText(data);
  return { content: [{ type: "text", text: note ? `${note}\n\n${body}` : body }] };
}

export function fail(message: string, extra?: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: "text", text: extra ? `${message}\n\n${toJsonText(extra)}` : message }] };
}

/** Un `redirect()` / `notFound()` de Next que se escapó de una acción: no es un error del servidor. Puro. */
export function nextNavigationMessage(err: unknown): string | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT")) {
    if (digest.includes("/login") || digest.includes("/auth/salir")) return "Tu sesión no es válida para este negocio. Volvé a conectar el MCP.";
    return "No tenés acceso a eso (la acción te mandaría a otra pantalla).";
  }
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND") return "No encontré eso, o no tenés acceso.";
  return null;
}
