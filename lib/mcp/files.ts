import "server-only";
import { safeFetchResponse } from "@/lib/net/safe-fetch";

/**
 * Archivos que llegan por el MCP (docs/mcp.md): un documento para Conocimiento, una imagen para un mensaje. Solo
 * servidor. Se mandan como `{ nombre, tipo, base64 }` o `{ url, nombre? }`; la URL se baja con `safeFetchResponse`
 * (solo direcciones públicas, con tope de tiempo), nunca con un fetch suelto.
 */

export const MCP_MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface FileInput {
  nombre?: string;
  tipo?: string;
  base64?: string;
  url?: string;
}

export function isFileInput(v: unknown): v is FileInput {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.base64 === "string" || (typeof o.url === "string" && /^https?:\/\//i.test(o.url));
}

function cleanName(raw: string | undefined, fallback: string): string {
  const name = (raw ?? "").replace(/[\\/\u0000-\u001f]/g, " ").trim().slice(0, 200);
  return name || fallback;
}

export async function fileFromInput(input: FileInput): Promise<File> {
  if (typeof input.base64 === "string") {
    const b64 = input.base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    if (b64.length > Math.ceil((MCP_MAX_FILE_BYTES * 4) / 3) + 8) throw new Error("El archivo pasa de 25 MB.");
    const bytes = Buffer.from(b64, "base64");
    if (bytes.byteLength === 0) throw new Error("El archivo está vacío o el base64 no es válido.");
    return new File([bytes], cleanName(input.nombre, "archivo"), { type: input.tipo ?? "application/octet-stream" });
  }
  if (typeof input.url === "string") {
    const { response, finalUrl } = await safeFetchResponse(input.url, { timeoutMs: 30_000 });
    if (!response.ok) throw new Error(`No pude bajar el archivo (respuesta ${response.status}).`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MCP_MAX_FILE_BYTES) throw new Error("El archivo pasa de 25 MB.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MCP_MAX_FILE_BYTES) throw new Error("El archivo pasa de 25 MB.");
    const fromUrl = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() ?? "");
    const type = input.tipo ?? (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    return new File([bytes], cleanName(input.nombre ?? fromUrl, "archivo"), { type });
  }
  throw new Error("Un archivo se manda como { nombre, tipo, base64 } o { url }.");
}

/** Un objeto plano → FormData. Los archivos con `fileFromInput`; una lista agrega cada valor con la misma clave. */
export async function toFormData(value: unknown): Promise<FormData> {
  if (value instanceof FormData) return value;
  const form = new FormData();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Este parámetro es un formulario: mandalo como un objeto { campo: valor }.");
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const items = Array.isArray(v) ? v : [v];
    for (const item of items) {
      if (item === undefined || item === null) continue;
      if (isFileInput(item)) form.append(k, await fileFromInput(item));
      else if (typeof item === "object") form.append(k, JSON.stringify(item));
      else form.append(k, String(item));
    }
  }
  return form;
}
