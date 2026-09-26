/**
 * El token de Meta y a que cuenta de Instagram da acceso (F40, F43).
 *
 * Portado de ScaleOS, con el cambio que importa: el token sale de **Vault**
 * y no de una variable de entorno. Es un token de System User, que no vence,
 * asi que no hay refresco ni intercambio: se genera una vez en el Business
 * Manager y se pega.
 *
 * La cuenta de Instagram no se pide: se DEDUCE del token, mirando que
 * paginas alcanza. Pedirle a alguien que busque el id numerico de su cuenta
 * en el Business Manager es pedirle que se equivoque.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import {
  graphGet,
  humanizeGraphError,
  pagesWithInstagram,
  type PageCandidate,
  type PageNode,
} from "./graph";

type Db = SupabaseClient<Database>;

export interface IgAccountInfo {
  igId: string;
  pageId: string | null;
  pageName: string | null;
  username: string | null;
  /** Todas las paginas con Instagram que alcanza el token. */
  pages: PageCandidate[];
}

export type IgAccountResult =
  | { ok: true; account: IgAccountInfo }
  | { ok: false; reason: "invalid_token" | "no_page"; detail?: string };

/**
 * Resuelve la cuenta de Instagram del token.
 *
 * Se queda con la primera pagina que tenga cuenta profesional vinculada, en
 * el orden que devuelve el grafo, que es estable. Si hay varias, la card
 * muestra la lista para poder elegir otra.
 */
export async function resolveIgAccount(
  token: string,
  fetchImpl: typeof fetch = fetch,
  preferredPageId?: string | null,
): Promise<IgAccountResult> {
  const pages = await graphGet<{ data?: PageNode[] }>(
    "me/accounts",
    token,
    { fields: "id,name,instagram_business_account{id,username}", limit: 100 },
    fetchImpl,
  );

  if (!pages.ok) {
    return { ok: false, reason: "invalid_token", detail: pages.error.message };
  }

  const candidates = pagesWithInstagram(pages.data.data ?? []);
  const picked = preferredPageId
    ? (candidates.find((c) => c.id === preferredPageId) ?? candidates[0])
    : candidates[0];

  if (!picked) return { ok: false, reason: "no_page" };

  const account: IgAccountInfo = {
    igId: picked.igId,
    pageId: picked.id,
    pageName: picked.name,
    username: picked.igUsername,
    pages: candidates,
  };

  // El nombre de usuario no siempre viene en la pagina: se pregunta aparte,
  // porque sin el la card diria un id numerico.
  if (!account.username) {
    const ig = await graphGet<{ username?: string }>(
      account.igId,
      token,
      { fields: "username" },
      fetchImpl,
    );
    if (ig.ok) account.username = ig.data.username ?? null;
  }

  return { ok: true, account };
}

/** El token guardado en Vault. Null si no hay. */
export async function getMetaToken(supabase: Db, workspaceId: string): Promise<string | null> {
  try {
    return await readSecret(supabase, workspaceId, SECRET_NAMES.metaSystemUserToken);
  } catch (err) {
    console.error(
      "[meta] no pude leer el token:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Valida un token contra `/me`.
 *
 * Es lo que corre "Probar y guardar": si el token no sirve, no se guarda.
 * Guardar uno invalido dejaria la card en verde y los dashboards vacios.
 */
export async function validateMetaToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; id: string; name: string | null } | { ok: false; error: string }> {
  const me = await graphGet<{ id?: string; name?: string }>(
    "me",
    token,
    { fields: "id,name" },
    fetchImpl,
  );

  if (!me.ok) return { ok: false, error: humanizeGraphError(me.error) };
  if (!me.data.id) {
    return { ok: false, error: "Meta no reconocio el token" };
  }

  return { ok: true, id: me.data.id, name: me.data.name ?? null };
}
