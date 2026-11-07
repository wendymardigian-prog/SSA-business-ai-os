"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { listVersions, restoreVersion, signDesignAssetUrls } from "@/lib/actions/designer/designs";
import type { DesignTarget, VersionSummary } from "@/lib/designer/contracts";
import type { UploadedFont } from "@/lib/designer/fonts";
import { collectAssetPathsOf } from "@/lib/designer/screens/thumbs";
import { REASON_LABELS, versionAuthor, versionWhen } from "@/lib/designer/versions";
import type { CustomVar } from "@/lib/designer/variables/catalog";
import { LiveThumb } from "@/components/designer/list/live-thumb";
import { smallButton } from "@/components/designer/editor/overlays";

/**
 * Configuración › Versiones (F27): la lista con fecha, autor (la persona o «IA»), motivo y la miniatura EN VIVO de cada una
 * (se dibuja con el documento de la versión; no hay miniaturas renderizadas, F48). «Restaurar» crea una versión NUEVA: no
 * borra ninguna.
 */
export function VersionsList({
  target,
  canEdit,
  timeZone,
  uploadedFonts,
  customVars,
  onRestored,
}: {
  target: DesignTarget;
  canEdit: boolean;
  timeZone: string;
  uploadedFonts: readonly UploadedFont[];
  customVars: readonly CustomVar[];
  /** Se restauró una versión: el editor vuelve a leer el documento. */
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const load = useCallback(async () => {
    setError(null);
    const result = await listVersions(target);
    if (!result.ok) {
      setError(result.error);
      setVersions([]);
      return;
    }
    setVersions(result.data);
    // Las imágenes de la primera página de cada versión (un solo pedido).
    const paths = [...new Set(result.data.flatMap((v) => collectAssetPathsOf(v.doc, 0)))];
    if (paths.length > 0) {
      const signed = await signDesignAssetUrls(paths);
      if (signed.ok) setUrls(signed.data);
    }
  }, [target]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    setBusy(id);
    setError(null);
    const result = await restoreVersion({ ...target, versionId: id });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onRestored();
    void load();
  }

  if (versions === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Cargando las versiones…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
      {versions.length === 0 && !error && <p className="text-xs text-muted-foreground">Todavía no hay versiones guardadas.</p>}
      <ul className="flex flex-col gap-2">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center gap-3 rounded-[10px] border border-border bg-card p-2">
            <LiveThumb doc={v.doc} box={{ width: 64, height: 48 }} assetUrls={urls} uploadedFonts={uploadedFonts} customVars={customVars} label={`Versión del ${versionWhen(v.createdAt, now, timeZone)}`} />
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-medium">{versionWhen(v.createdAt, now, timeZone)}</p>
              <p className="text-muted-foreground">
                {REASON_LABELS[v.reason]} · {versionAuthor(v)}
              </p>
            </div>
            {canEdit && (
              <button type="button" className={smallButton} disabled={busy !== null} onClick={() => void restore(v.id)}>
                {busy === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}
                Restaurar
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Restaurar crea una versión nueva: no se borra ninguna.</p>
    </div>
  );
}
