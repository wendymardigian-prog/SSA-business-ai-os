/**
 * Cliente de Postproxy (F14).
 *
 * Postproxy publica en varias redes por API. En esta etapa se usa para UNA
 * cosa: subir a YouTube sin pasar por la auditoria de Google, que es lo que
 * bloquea publicar en publico con la API oficial.
 *
 * **Lo que dice la documentacion, y difiere del plano** (consultada el
 * 26/9/2026 en postproxy.dev/getting-started/quickstart):
 *   - La base es `https://api.postproxy.dev/api` y se autentica con
 *     `Authorization: Bearer <api key>`.
 *   - Se publica con `POST /posts`, con el cuerpo
 *     `{ post: { body, draft, scheduled_at }, profiles: [...], media: [url] }`.
 *     No hay campos propios de YouTube documentados (titulo, privacidad,
 *     Short, miniatura): lo que hay es un texto, una lista de perfiles y una
 *     lista de URLs de media. Lo especifico de cada red viaja, segun la
 *     respuesta, en `platforms[].params`.
 *   - El estado viene en la respuesta y en `GET /posts/:id`. El quickstart
 *     **no documenta webhooks**, asi que el estado final se consulta
 *     (F32 agenda ese chequeo). Queda anotado en PENDIENTE.
 *
 * Por eso este modulo expone lo que la API tiene de verdad y no lo que el
 * plano suponia. La interfaz comun de publicadores (F30) la adapta.
 */

import type { FetchLike } from "@/lib/oauth/types";

export const POSTPROXY_BASE = "https://api.postproxy.dev/api";

/** Publicaciones por mes del plan gratis. */
export const POSTPROXY_FREE_MONTHLY = 10;

export class PostproxyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** true si conviene reintentar (corte de red, 429, 5xx). */
    readonly temporary: boolean,
  ) {
    super(message);
    this.name = "PostproxyError";
  }
}

interface RequestOptions {
  apiKey: string;
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  fetchImpl?: FetchLike;
}

async function request<T>(options: RequestOptions): Promise<T> {
  const { apiKey, path, body, method = body ? "POST" : "GET" } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${POSTPROXY_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Sin respuesta no se sabe si llego: se trata como temporal.
    throw new PostproxyError(
      `No pude comunicarme con Postproxy: ${err instanceof Error ? err.message : String(err)}`,
      0,
      true,
    );
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail =
      (typeof json.error === "string" && json.error) ||
      (typeof json.message === "string" && json.message) ||
      `Postproxy respondio ${response.status}`;
    // 429 y 5xx se reintentan; 401 y 4xx de validacion no van a mejorar solos.
    throw new PostproxyError(detail, response.status, response.status === 429 || response.status >= 500);
  }

  return json as T;
}

export interface PostproxyProfile {
  id: string;
  platform: string;
  username?: string | null;
  name?: string | null;
}

/** Los perfiles conectados en la cuenta de Postproxy. */
export async function listProfiles(
  apiKey: string,
  fetchImpl?: FetchLike,
): Promise<PostproxyProfile[]> {
  const json = await request<{ profiles?: PostproxyProfile[]; data?: PostproxyProfile[] }>({
    apiKey,
    path: "/profiles",
    fetchImpl,
  });
  return json.profiles ?? json.data ?? [];
}

/**
 * Prueba la clave antes de guardarla.
 *
 * Es la unica llamada que se hace al conectar: si la clave no sirve, se dice
 * en el momento en vez de descubrirlo el dia que falle una publicacion.
 */
export async function testApiKey(
  apiKey: string,
  fetchImpl?: FetchLike,
): Promise<{ ok: true; profiles: PostproxyProfile[] } | { ok: false; error: string }> {
  try {
    const profiles = await listProfiles(apiKey, fetchImpl);
    return { ok: true, profiles };
  } catch (err) {
    if (err instanceof PostproxyError && err.status === 401) {
      return { ok: false, error: "Postproxy no reconoce esa API key." };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No pude verificar la API key",
    };
  }
}

export interface CreatePostInput {
  apiKey: string;
  /** Texto del post. En YouTube es la descripcion. */
  body: string;
  /** Perfiles o nombres de plataforma a los que publicar. */
  profiles: string[];
  /** URLs de la media. Tienen que ser accesibles por Postproxy. */
  media?: string[];
  /** ISO 8601. Sin esto se publica al recibirlo. */
  scheduledAt?: string | null;
  draft?: boolean;
  fetchImpl?: FetchLike;
}

export interface PostproxyPlatformResult {
  platform: string;
  status: string;
  error?: string | null;
  attempted_at?: string | null;
}

export interface PostproxyPost {
  id: string;
  status: string;
  scheduled_at?: string | null;
  platforms?: PostproxyPlatformResult[];
}

export async function createPost(input: CreatePostInput): Promise<PostproxyPost> {
  const post: Record<string, unknown> = { body: input.body };
  if (input.draft) post.draft = true;
  if (input.scheduledAt) post.scheduled_at = input.scheduledAt;

  const json = await request<PostproxyPost>({
    apiKey: input.apiKey,
    path: "/posts",
    body: {
      post,
      profiles: input.profiles,
      ...(input.media?.length ? { media: input.media } : {}),
    },
    fetchImpl: input.fetchImpl,
  });

  if (!json?.id) {
    throw new PostproxyError("Postproxy no devolvio el id de la publicacion", 502, false);
  }
  return json;
}

/**
 * El estado de una publicacion.
 *
 * El quickstart no documenta webhooks, asi que el resultado final se consulta.
 * Si algun dia los documenta, el publicador cambia de camino sin tocar esto.
 */
export async function getPost(
  apiKey: string,
  postId: string,
  fetchImpl?: FetchLike,
): Promise<PostproxyPost> {
  return request<PostproxyPost>({ apiKey, path: `/posts/${postId}`, fetchImpl });
}

/** Como quedo una red dentro de una publicacion. */
export function platformOutcome(
  post: PostproxyPost,
  platform: string,
): { status: "published" | "processing" | "failed"; error: string | null } {
  const entry = post.platforms?.find((p) => p.platform === platform);
  if (!entry) {
    // Todavia no hay resultado para esa red: sigue en curso.
    return { status: "processing", error: null };
  }
  if (entry.status === "published") return { status: "published", error: null };
  if (entry.status === "error") {
    return { status: "failed", error: entry.error || "Postproxy no pudo publicar" };
  }
  return { status: "processing", error: null };
}
