/**
 * Google Drive del negocio (00374): el token y las tres llamadas que hacen
 * falta para traer un archivo a Recursos.
 *
 * Con el permiso `drive.file` solo se puede leer lo que la persona eligio en el
 * selector de Google (Picker): un id que no paso por ahi responde 404, que es
 * justo lo que tiene que pasar.
 *
 * Como se copia cada tipo lo decide `copy-mode.ts`.
 * developers.google.com/drive/api/reference/rest/v3/files/export
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, oauthSecretName } from "@/lib/vault";
import { findWorkspaceConnection, type WorkspaceConnection } from "@/lib/oauth/workspace-connection";
import { needsFreshToken, refreshConnection } from "@/lib/social/refresh-connection";
import { googleDriveAdapter } from "@/lib/social/google-drive";
import type { DriveCopyMode } from "./copy-mode";

type Db = SupabaseClient<Database>;
type FetchLike = typeof fetch;

const FILES = "https://www.googleapis.com/drive/v3/files";

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes. Los archivos de Google (Docs, Sheets) no tienen: null. */
  size: number | null;
  webViewLink: string | null;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

/** La conexion de Drive del negocio, si hay. */
export function findDriveConnection(supabase: Db, workspaceId: string): Promise<WorkspaceConnection | null> {
  return findWorkspaceConnection(supabase, workspaceId, "google_drive");
}

/**
 * Un access token de Drive vigente, renovado si esta por vencer (dura una
 * hora). `null` = Drive no esta conectado o no se pudo renovar (la conexion
 * queda marcada con el motivo).
 */
export async function getDriveAccessToken(service: Db, workspaceId: string): Promise<string | null> {
  const connection = await findDriveConnection(service, workspaceId);
  if (!connection || connection.status === "revoked") return null;

  if (needsFreshToken(connection.token_expires_at)) {
    try {
      return await refreshConnection(
        service,
        { id: connection.id, workspace_id: workspaceId, vault_secret_prefix: connection.vault_secret_prefix },
        googleDriveAdapter,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[drive] no pude renovar el token:", detail);
      await service
        .from("oauth_connections")
        .update({ status: "attention", last_error: `No pude renovar el acceso: ${detail}` })
        .eq("id", connection.id);
      return null;
    }
  }

  return readSecret(service, workspaceId, oauthSecretName(connection.vault_secret_prefix, "access_token"));
}

async function driveFetch(fetchImpl: FetchLike, url: string, token: string): Promise<Response> {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    const message =
      response.status === 404
        ? "Drive no encontró el archivo o no dio permiso para leerlo. Elegilo de nuevo desde el selector."
        : response.status === 401 || response.status === 403
          ? "Drive no dio permiso para leer este archivo. Reconectá Google Drive en Integraciones."
          : body.error?.message || `Drive respondió ${response.status}`;
    throw new DriveError(message, response.status);
  }
  return response;
}

/** Nombre, tipo, tamaño y link de un archivo. */
export async function getDriveFileMeta(params: {
  token: string;
  fileId: string;
  fetchImpl?: FetchLike;
}): Promise<DriveFileMeta> {
  const url = new URL(`${FILES}/${encodeURIComponent(params.fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,webViewLink");
  url.searchParams.set("supportsAllDrives", "true");
  const response = await driveFetch(params.fetchImpl ?? fetch, url.toString(), params.token);
  const json = (await response.json()) as {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: string;
    webViewLink?: string;
  };
  return {
    id: json.id ?? params.fileId,
    name: json.name ?? "Archivo de Drive",
    mimeType: json.mimeType ?? "application/octet-stream",
    size: json.size ? Number(json.size) : null,
    webViewLink: json.webViewLink ?? null,
  };
}

/**
 * Los bytes del archivo (descargado o exportado a PDF). Corta si pasa de
 * `maxBytes`: no se baja un video de 2 GB para despues rechazarlo.
 */
export async function readDriveFileBytes(params: {
  token: string;
  fileId: string;
  mode: Exclude<DriveCopyMode, { kind: "link_only" }>;
  maxBytes: number;
  fetchImpl?: FetchLike;
}): Promise<Buffer> {
  const id = encodeURIComponent(params.fileId);
  const url =
    params.mode.kind === "export"
      ? `${FILES}/${id}/export?mimeType=${encodeURIComponent(params.mode.mimeType)}`
      : `${FILES}/${id}?alt=media&supportsAllDrives=true`;
  const response = await driveFetch(params.fetchImpl ?? fetch, url, params.token);

  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > params.maxBytes) throw tooBig(params.maxBytes);

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > params.maxBytes) throw tooBig(params.maxBytes);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > params.maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooBig(params.maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function tooBig(maxBytes: number): DriveError {
  return new DriveError(
    `Pesa más de ${Math.round(maxBytes / (1024 * 1024))} MB: guardalo como enlace.`,
    413,
  );
}
