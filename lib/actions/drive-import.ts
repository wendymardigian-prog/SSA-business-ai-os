"use server";

import { randomUUID } from "node:crypto";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { sniffUploadMime } from "@/lib/content/media";
import { CHAT_MEDIA_BUCKET, extensionForMime } from "@/lib/chat-media/bucket";
import { fileRejection, MAX_ASSET_BYTES } from "@/lib/response-assets/files";
import { findDriveConnection, getDriveAccessToken, getDriveFileMeta, readDriveFileBytes } from "@/lib/google-drive/client";
import { planDriveItem } from "@/lib/google-drive/import-plan";
import { createAsset } from "./response-assets";

/**
 * Traer archivos de Google Drive a Recursos (00374).
 *
 * La persona elige en el selector de Google (Picker) y decide, archivo por
 * archivo, si se guarda COMO ARCHIVO (una copia en el sistema: sirve aunque
 * despues lo borren de Drive, y se manda por WhatsApp como cualquier otro) o
 * COMO ENLACE (el link de Drive: abre solo para quien tenga acceso al archivo).
 *
 * Mismo permiso que crear un recurso a mano (`templates.manage`), y cada alta
 * pasa por `createAsset`: la validacion, el audit y la transcripcion son las
 * mismas que una subida desde la computadora.
 */

const MANAGE = "templates.manage";
const NO_PERMISSION = "No tenés permiso para administrar la banca de recursos. Pedíselo a un Admin.";

/** Un tope por tanda: cada archivo se descarga en el servidor. */
const MAX_ITEMS = 20;

export type DrivePickerConfig =
  | {
      ok: true;
      /** Token de acceso de una hora, con el permiso `drive.file` y nada mas. */
      accessToken: string;
      apiKey: string;
      /** El numero del proyecto de Google Cloud (`setAppId` del Picker). */
      appId: string;
      accountLabel: string | null;
    }
  | { ok: false; error: string; needsSetup?: boolean };

/**
 * Lo que necesita el selector de Google en el navegador.
 *
 * El token viaja al navegador porque el Picker lo exige. Es de vida corta y su
 * unico permiso es `drive.file`: alcanza para ver los archivos que la persona
 * elige, no el Drive entero ni YouTube.
 */
export async function getDrivePickerConfig(): Promise<DrivePickerConfig> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  const service = await createServiceClient();
  const connection = await findDriveConnection(service, ctx.workspace.id);
  if (!connection) {
    return { ok: false, needsSetup: true, error: "Google Drive no está conectado. Conectalo en Integraciones → Google." };
  }

  const [apiKey, appId] = await Promise.all([
    readSecret(service, ctx.workspace.id, SECRET_NAMES.googleApiKey).catch(() => null),
    readSecret(service, ctx.workspace.id, SECRET_NAMES.googleProjectNumber).catch(() => null),
  ]);
  if (!apiKey || !appId) {
    return {
      ok: false,
      needsSetup: true,
      error: "Falta la API key o el número de proyecto de Google. Cargalos en Integraciones → Google → Credenciales.",
    };
  }

  const accessToken = await getDriveAccessToken(service, ctx.workspace.id);
  if (!accessToken) {
    return { ok: false, needsSetup: true, error: "No pude abrir Google Drive. Reconectalo en Integraciones → Google." };
  }

  const { data: row } = await service
    .from("oauth_connections")
    .select("account_label")
    .eq("id", connection.id)
    .maybeSingle();

  return { ok: true, accessToken, apiKey, appId, accountLabel: row?.account_label ?? null };
}

export interface DriveImportItem {
  fileId: string;
  /** Como se guarda. */
  mode: "file" | "link";
  name: string;
  description: string;
}

export type DriveImportResult =
  | {
      ok: true;
      results: Array<{ fileId: string; name: string; ok: true; assetId: string } | { fileId: string; name: string; ok: false; error: string }>;
    }
  | { ok: false; error: string };

export async function importFromDrive(items: DriveImportItem[]): Promise<DriveImportResult> {
  const ctx = await getPermissionAction(MANAGE);
  if (!ctx) return { ok: false, error: NO_PERMISSION };

  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: "No elegiste ningún archivo" };
  if (items.length > MAX_ITEMS) return { ok: false, error: `Se pueden importar hasta ${MAX_ITEMS} archivos por vez` };

  const service = await createServiceClient();
  const token = await getDriveAccessToken(service, ctx.workspace.id);
  if (!token) return { ok: false, error: "No pude abrir Google Drive. Reconectalo en Integraciones → Google." };

  const results: Extract<DriveImportResult, { ok: true }>["results"] = [];

  // De a uno: cada archivo se descarga en el servidor y son hasta 16 MB.
  for (const item of items) {
    const name = (item.name ?? "").trim();
    try {
      const outcome = await importOne(service, ctx.workspace.id, token, { ...item, name });
      results.push(outcome.ok ? { fileId: item.fileId, name, ok: true, assetId: outcome.assetId } : { fileId: item.fileId, name, ok: false, error: outcome.error });
    } catch (err) {
      const message = err instanceof Error ? err.message : "error desconocido";
      console.error("[drive-import] no pude importar un archivo:", message);
      results.push({ fileId: item.fileId, name, ok: false, error: message });
    }
  }

  return { ok: true, results };
}

type Service = Awaited<ReturnType<typeof createServiceClient>>;

async function importOne(
  service: Service,
  workspaceId: string,
  token: string,
  item: DriveImportItem,
): Promise<{ ok: true; assetId: string } | { ok: false; error: string }> {
  if (typeof item.fileId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(item.fileId)) {
    return { ok: false, error: "Ese archivo de Drive no es válido" };
  }

  // Lo que dice Drive, no lo que mando el navegador: tipo, tamaño y link.
  const meta = await getDriveFileMeta({ token, fileId: item.fileId });
  const name = item.name || meta.name;

  if (item.mode === "link") {
    if (!meta.webViewLink) return { ok: false, error: "Drive no dio un enlace para este archivo" };
    const created = await createAsset({
      kind: "link",
      name,
      description: item.description,
      url: meta.webViewLink,
      linkKind: "drive",
    });
    return created.ok ? { ok: true, assetId: created.assetId! } : { ok: false, error: created.error };
  }

  const plan = planDriveItem({ mimeType: meta.mimeType, sizeBytes: meta.size });
  if (!plan.canCopy) return { ok: false, error: plan.reason };

  const bytes = await readDriveFileBytes({ token, fileId: meta.id, mode: plan.copy, maxBytes: MAX_ASSET_BYTES });

  // El tipo se decide por el CONTENIDO, igual que una subida desde la
  // computadora. Lo que declara Drive solo desempata Office.
  const declared = plan.copy.kind === "export" ? plan.copy.mimeType : meta.mimeType;
  const mime = sniffUploadMime(new Uint8Array(bytes.subarray(0, 64)), declared);
  const rejection = fileRejection(plan.kind, mime, bytes.byteLength);
  if (rejection || !mime) return { ok: false, error: rejection ?? "No reconozco ese archivo" };

  const storagePath = `${workspaceId}/library/${randomUUID()}.${extensionForMime(mime)}`;
  const { error: uploadError } = await service.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(storagePath, bytes, { contentType: mime, upsert: false });
  if (uploadError) {
    console.error("[drive-import] no pude guardar el archivo:", uploadError.message);
    return { ok: false, error: "No pude guardar el archivo. Probá de nuevo." };
  }

  const created = await createAsset({
    kind: plan.kind,
    name,
    description: item.description,
    file: { storagePath, mimeType: mime, sizeBytes: bytes.byteLength, source: "uploaded" },
  });

  if (!created.ok) {
    // El alta no salio: el archivo no queda huerfano en el bucket.
    await service.storage.from(CHAT_MEDIA_BUCKET).remove([storagePath]);
    return { ok: false, error: created.error };
  }
  return { ok: true, assetId: created.assetId! };
}
