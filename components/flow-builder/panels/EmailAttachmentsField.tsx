"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, Plus, Search, Upload, X } from "lucide-react";
import { listAssets } from "@/lib/actions/response-assets";
import { getEmailAttachmentContext } from "@/lib/actions/flows";
import { toBankAsset, type BankAsset, type BankAssetRow } from "@/lib/response-assets/list";
import { ASSET_KIND_LABEL, FILE_KINDS } from "@/lib/response-assets/kind";
import { attachmentBudget, formatMegabytes, MAX_EMAIL_ATTACHMENTS, parseEmailAttachments, type EmailAttachmentRef } from "@/lib/email/attachment-limits";
import { matchesQuery } from "@/lib/flows/search";
import { AssetFormDialog } from "@/components/response-assets/asset-form-dialog";

/**
 * «Adjuntos» de «Enviar email» (auditoria de automatizaciones). Los adjuntos son SIEMPRE recursos de la banca: se
 * eligen de Recursos o se sube uno nuevo sin salir del editor (queda guardado en Recursos y elegido). Hasta 10 archivos
 * y 25 MB en total, que es lo que entra en un correo de Resend con margen.
 */
export function EmailAttachmentsField({ value, onChange }: { value: unknown; onChange: (next: EmailAttachmentRef[]) => void }) {
  const chosen = parseEmailAttachments(value);
  const [assets, setAssets] = useState<BankAsset[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [ctx, setCtx] = useState<{ canUpload: boolean; workspaceName: string } | null>(null);
  const openedAt = useRef<number>(0);

  const load = useCallback(async () => {
    try {
      const rows = (await listAssets()) as unknown as BankAssetRow[];
      const list = rows.map(toBankAsset);
      setAssets(list);
      setFailed(false);
      return list;
    } catch {
      setFailed(true);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listAssets()
      .then((rows) => {
        if (!alive) return;
        setAssets((rows as unknown as BankAssetRow[]).map(toBankAsset));
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    getEmailAttachmentContext()
      .then((c) => alive && setCtx(c))
      .catch(() => alive && setCtx({ canUpload: false, workspaceName: "" }));
    return () => {
      alive = false;
    };
  }, []);

  const files = useMemo(() => (assets ?? []).filter((a) => FILE_KINDS.includes(a.kind) && a.isActive), [assets]);
  const byId = useMemo(() => new Map((assets ?? []).map((a) => [a.id, a])), [assets]);
  const sizes = chosen.map((c) => byId.get(c.assetId)?.sizeBytes ?? c.sizeBytes ?? 0);
  const budget = attachmentBudget(sizes);
  const options = files.filter((a) => !chosen.some((c) => c.assetId === a.id) && matchesQuery([a.name, a.description, ...a.tags], query));

  const add = (asset: BankAsset) => {
    onChange([...chosen, { assetId: asset.id, name: asset.name, sizeBytes: asset.sizeBytes }]);
    setPicking(false);
    setQuery("");
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">Adjuntos</span>
        {chosen.length > 0 && (
          <span className={budget.ok ? "text-[11px] text-muted-foreground" : "text-[11px] font-medium text-destructive"}>
            {chosen.length}/{MAX_EMAIL_ATTACHMENTS} · {formatMegabytes(budget.totalBytes)} de 25 MB
          </span>
        )}
      </div>

      {chosen.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {chosen.map((c) => {
            const asset = byId.get(c.assetId);
            const gone = assets !== null && !asset;
            return (
              <li key={c.assetId} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{asset?.name ?? c.name ?? "Recurso"}</span>
                {gone ? (
                  <span className="shrink-0 text-[11px] font-medium text-amber-700 dark:text-amber-300">ya no está en Recursos</span>
                ) : (
                  asset?.sizeBytes != null && <span className="shrink-0 text-[11px] text-muted-foreground">{formatMegabytes(asset.sizeBytes)}</span>
                )}
                <button
                  type="button"
                  onClick={() => onChange(chosen.filter((x) => x.assetId !== c.assetId))}
                  aria-label={`Quitar el adjunto ${asset?.name ?? c.name ?? ""}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!budget.ok && (
        <p role="alert" className="mb-2 text-xs font-medium text-destructive">
          {budget.problem}
        </p>
      )}

      {picking ? (
        <div className="rounded-lg border border-border bg-card p-2">
          <label className="relative block">
            <span className="sr-only">Buscar en Recursos</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar un archivo, imagen, audio o video…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs focus:border-primary focus:outline-none"
            />
          </label>
          <div className="mt-2 max-h-48 overflow-y-auto">
            {assets === null && !failed && (
              <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando Recursos…
              </p>
            )}
            {failed && <p className="p-2 text-xs text-destructive">No pude leer Recursos. Recargá la página.</p>}
            {assets !== null && options.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">{files.length === 0 ? "Todavía no hay archivos en Recursos." : "Ningún recurso coincide."}</p>
            )}
            {options.map((a) => (
              <button key={a.id} type="button" onClick={() => add(a)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {ASSET_KIND_LABEL[a.kind]}
                  {a.sizeBytes != null ? ` · ${formatMegabytes(a.sizeBytes)}` : ""}
                </span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPicking(false)} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
            Cerrar
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={chosen.length >= MAX_EMAIL_ATTACHMENTS}
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Elegir de Recursos
          </button>
          {ctx?.canUpload && (
            <button
              type="button"
              disabled={chosen.length >= MAX_EMAIL_ATTACHMENTS}
              onClick={() => {
                openedAt.current = Date.now();
                setUploading(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              Subir un recurso nuevo
            </button>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {ctx && !ctx.canUpload
          ? "Los adjuntos salen de Recursos. Para subir uno nuevo hace falta el permiso de administrar Recursos."
          : "Los adjuntos salen de Recursos: lo que subas acá queda guardado ahí para reusarlo."}{" "}
        Hasta {MAX_EMAIL_ATTACHMENTS} archivos y 25 MB en total.
      </p>

      {uploading && ctx && (
        <AssetFormDialog
          asset={null}
          initialKind="file"
          assets={assets ?? []}
          workspaceName={ctx.workspaceName}
          onClose={() => setUploading(false)}
          onSaved={async () => {
            setUploading(false);
            // El recurso recien creado queda elegido: el mas nuevo con archivo, creado despues de abrir la ventana.
            const list = await load();
            const created = (list ?? [])
              .filter((a) => FILE_KINDS.includes(a.kind) && a.createdAt && Date.parse(a.createdAt) >= openedAt.current - 60_000 && !chosen.some((c) => c.assetId === a.id))
              .sort((x, y) => Date.parse(y.createdAt ?? "") - Date.parse(x.createdAt ?? ""))[0];
            if (created) onChange([...chosen, { assetId: created.id, name: created.name, sizeBytes: created.sizeBytes }]);
          }}
        />
      )}
    </div>
  );
}
