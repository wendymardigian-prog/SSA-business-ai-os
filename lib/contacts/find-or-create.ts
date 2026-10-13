/**
 * La regla unica "buscar o crear contacto" (Contactos: regla unica, C1).
 *
 * TODO camino que crea o resuelve un contacto por un dato fuerte pasa por aca (o por la funcion de la
 * base que esta detras, `find_or_create_contact`, 00200). Dos llegadas simultaneas de la misma persona dan
 * UN contacto: la base bloquea por dato (telefono, email, usuario de red, canal) antes de buscar.
 *
 * Que es un dato fuerte y como se normaliza vive en `identity.ts`; nunca se identifica por el nombre.
 * Siempre con el cliente de SERVICIO: quien llama ya chequeo el permiso y saco el workspace de la
 * sesion. Asi los caminos que antes usaban el cliente del usuario (alta manual, CSV) buscan duplicados
 * entre TODOS los contactos del workspace, no solo entre los que su RLS le deja ver.
 *
 * `single-entry.test.ts` falla si alguien inserta en `contacts` desde otro lado.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { ContactIdentity } from "@/lib/contacts/identity";

type Db = SupabaseClient<Database>;

export type FindOrCreateMode = "create" | "link_channel" | "find_only";

/** Un dato que coincidio con un contacto distinto del ganador (el telefono de uno y el email de otro). */
export interface IdentityConflict {
  by: string;
  contact_id: string;
}

export type FindOrCreateStatus = "found" | "created" | "not_found" | "no_identity";

export interface FindOrCreateResult {
  contactId: string | null;
  created: boolean;
  /** `channel | phone | email | instagram | tiktok | x | linkedin | facebook`, o null si no habia nadie. */
  matchedBy: string | null;
  conflictContactId: string | null;
  conflicts: IdentityConflict[];
  status: FindOrCreateStatus;
}

export interface FindOrCreateArgs {
  workspaceId: string;
  identity: ContactIdentity;
  /** Columnas de `contacts` para el alta (nombre, pais, foto...). Las de identidad salen de `identity`. */
  defaults?: Record<string, unknown>;
  mode?: FindOrCreateMode;
  /** Solo el alta manual: permite crear un contacto con nada mas que el nombre. */
  allowWithoutIdentity?: boolean;
}

interface RawResult {
  contact_id?: string | null;
  created?: boolean;
  matched_by?: string | null;
  conflict_contact_id?: string | null;
  conflicts?: IdentityConflict[] | null;
  status?: FindOrCreateStatus;
}

/**
 * Busca o crea. LANZA si la base falla: un error de la base NUNCA se toma como "no encontrado" (eso
 * crearia un duplicado). Quien llama decide como contarlo.
 */
export async function findOrCreateContact(service: Db, args: FindOrCreateArgs): Promise<FindOrCreateResult> {
  const { data, error } = await service.rpc("find_or_create_contact", {
    p_workspace_id: args.workspaceId,
    p_identity: args.identity as unknown as Json,
    p_defaults: (args.defaults ?? {}) as unknown as Json,
    p_mode: args.mode ?? "create",
    p_allow_without_identity: args.allowWithoutIdentity === true,
  });
  if (error) throw new Error(`no pude buscar o crear el contacto: ${error.message}`);

  const raw = (data ?? {}) as RawResult;
  return {
    contactId: raw.contact_id ?? null,
    created: raw.created === true,
    matchedBy: raw.matched_by ?? null,
    conflictContactId: raw.conflict_contact_id ?? null,
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    status: raw.status ?? "not_found",
  };
}

/** Solo busca (con los mismos bloqueos y la misma normalizacion): `find_only`. */
export async function findContact(service: Db, args: Omit<FindOrCreateArgs, "mode" | "defaults" | "allowWithoutIdentity">): Promise<FindOrCreateResult> {
  return findOrCreateContact(service, { ...args, mode: "find_only" });
}
