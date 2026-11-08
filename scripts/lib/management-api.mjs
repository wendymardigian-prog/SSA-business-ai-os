// La Management API de Supabase (https://api.supabase.com/v1), con el token de la CLI.
//
// El token sale de SUPABASE_ACCESS_TOKEN o, si no esta, del llavero donde lo guarda
// `supabase login` (servicio "Supabase CLI"). Nunca se imprime ni se loguea.
// El proyecto es el vinculado con la CLI (supabase/.temp/project-ref) o SUPABASE_PROJECT_REF.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function managementToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    let t = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (t.startsWith("go-keyring-base64:")) t = Buffer.from(t.slice("go-keyring-base64:".length), "base64").toString("utf8");
    return t || null;
  } catch {
    return null;
  }
}

export function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    return readFileSync(new URL("../../supabase/.temp/project-ref", import.meta.url), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Llama a la Management API. Devuelve { status, body }. Nunca lanza por un 4xx/5xx. */
export async function management(path, { method = "GET", body, token = managementToken() } = {}) {
  if (!token) return { status: 0, body: null, noToken: true };
  const res = await fetch(`https://api.supabase.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}
