/**
 * Que se puede hacer con cada archivo elegido en Drive (00374). Puro: lo usan
 * la pantalla (para mostrar si se puede copiar o solo enlazar, y por que) y el
 * servidor (que lo vuelve a decidir: la pantalla no manda).
 *
 * - Como enlace: siempre se puede.
 * - Como archivo: solo si entra en Recursos. Los mismos tipos y el mismo tope
 *   de 16 MB que una subida desde la computadora (lib/response-assets/files.ts).
 *   Docs, Sheets, Slides y Drawings se exportan a PDF.
 */

import { ACCEPTED_FORMATS_LABEL, MAX_ASSET_BYTES, mimeMatchesKind, type FileAssetKind } from "@/lib/response-assets/files";
import { driveCopyMode, type DriveCopyMode } from "./copy-mode";

/** Lo que el selector de Google devuelve de cada archivo, en lo que importa aca. */
export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes; los archivos de Google no tienen. */
  sizeBytes: number | null;
  url: string | null;
}

export type DriveItemPlan =
  | { canCopy: true; copy: Exclude<DriveCopyMode, { kind: "link_only" }>; kind: FileAssetKind }
  | { canCopy: false; reason: string };

/** El orden importa: `audio/mp4` es audio y `video/mp4` es video, cada uno entra en el suyo. */
const FILE_KINDS: readonly FileAssetKind[] = ["image", "video", "audio", "file"];

/** Que tipo de recurso es un archivo por su mime, o null si ninguno lo acepta. */
export function assetKindForMime(mime: string | null | undefined): FileAssetKind | null {
  return FILE_KINDS.find((kind) => mimeMatchesKind(kind, mime)) ?? null;
}

const ALL_FORMATS = Object.values(ACCEPTED_FORMATS_LABEL).join("; ");

export function planDriveItem(file: Pick<PickedDriveFile, "mimeType" | "sizeBytes">): DriveItemPlan {
  const copy = driveCopyMode(file.mimeType);
  if (copy.kind === "link_only") return { canCopy: false, reason: copy.reason };

  if (copy.kind === "export") return { canCopy: true, copy, kind: "file" };

  if (file.sizeBytes !== null && file.sizeBytes > MAX_ASSET_BYTES) {
    const mb = (file.sizeBytes / (1024 * 1024)).toFixed(1);
    return { canCopy: false, reason: `Pesa ${mb} MB y el máximo para copiarlo es 16 MB.` };
  }

  const kind = assetKindForMime(file.mimeType);
  if (!kind) {
    return { canCopy: false, reason: `Ese tipo de archivo no se puede copiar a Recursos (se aceptan ${ALL_FORMATS}).` };
  }
  return { canCopy: true, copy, kind };
}
