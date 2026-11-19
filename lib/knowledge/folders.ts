/**
 * Carpetas de la base de conocimientos. Una sola altura: una
 * carpeta agrupa documentos y se usa para dar acceso a un agente.
 * La tabla solo la escribe el servidor: estas funciones reciben el
 * cliente de servicio, después de comprobar el permiso `knowledge.edit`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const MAX_FOLDER_NAME = 80;

export type FolderNameCheck = { ok: true; name: string } | { ok: false; error: string };

export function validateFolderName(raw: string): FolderNameCheck {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Ponle un nombre a la carpeta." };
  if (name.length > MAX_FOLDER_NAME) return { ok: false, error: `El nombre puede tener hasta ${MAX_FOLDER_NAME} caracteres.` };
  return { ok: true, name };
}

export interface KnowledgeFolder {
  id: string;
  name: string;
}

/** Las carpetas vivas del negocio, por nombre. Sirve con el cliente de la persona (RLS de lectura) o el de servicio. */
export async function listFolders(db: Db, workspaceId: string): Promise<KnowledgeFolder[]> {
  const { data, error } = await db
    .from("knowledge_folders")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) {
    console.error("[kb] no pude leer las carpetas:", error.message);
    return [];
  }
  return data ?? [];
}

/**
 * La carpeta que llega de un formulario, comprobada: tiene que existir, estar
 * viva y ser de este negocio. "" o null = sin carpeta. `undefined` si no vale.
 */
export async function resolveFolderId(db: Db, workspaceId: string, raw: unknown): Promise<string | null | undefined> {
  const value = typeof raw === "string" ? raw.trim() : raw == null ? "" : null;
  if (value === null) return undefined;
  if (value === "") return null;
  if (!/^[0-9a-f-]{36}$/i.test(value)) return undefined;
  const { data } = await db
    .from("knowledge_folders")
    .select("id")
    .eq("id", value)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  return data?.id ?? undefined;
}

/** Ids de carpeta repetidos o de otro negocio fuera; el resto, en el orden recibido. */
export function keepKnownIds(ids: readonly string[], known: ReadonlySet<string>, max = 200): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (known.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
