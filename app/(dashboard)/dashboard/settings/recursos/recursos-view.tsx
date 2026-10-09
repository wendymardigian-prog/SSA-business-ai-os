"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteAsset, retryTranscription, setAssetAgentEnabled } from "@/lib/actions/response-assets";
import {
  agentUsable,
  applyFilters,
  contextLine,
  hasActiveFilters,
  isTranscribing,
  kindCounts,
  NO_FILTERS,
  paginate,
  tagCounts,
  transcriptStatusLabel,
  type AssetFilters,
  type BankAsset,
} from "@/lib/response-assets/list";
import { ASSET_KINDS, ASSET_KIND_LABEL, isTranscribableKind, type AssetKind } from "@/lib/response-assets/kind";
import { formatBytes, formatLabel } from "@/lib/response-assets/files";
import { urlDomain } from "@/lib/response-assets/shape";
import { formatRecordingDuration } from "@/lib/audio/recording";
import { AssetKindIcon } from "@/components/response-assets/asset-kind-icon";
import { AssetThumb } from "@/components/response-assets/asset-thumb";
import { AssetFilterBar } from "@/components/response-assets/asset-filter-bar";
import { AssetPreview } from "@/components/response-assets/asset-preview";
import { AssetFormDialog } from "@/components/response-assets/asset-form-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ActionError } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";
import { cn } from "@/lib/utils";

/**
 * La pantalla de la banca de recursos (F5): filtros por tipo y por etiqueta
 * con sus conteos, buscador, una fila por recurso con lo que corresponde a su
 * tipo, y "Ver" para revisarlo entero sin entrar a editarlo.
 *
 * No decide nada: filtrar, contar, paginar y la linea de cada tipo son
 * funciones puras (lib/response-assets/list.ts), las mismas que usa el
 * widget del chat. Pagina en memoria de a 25: la banca entera llega del
 * servidor sin URLs firmadas (las miniaturas cargan lazy y los
 * reproductores firman al apretar play).
 */

export function RecursosView({
  assets,
  canManage,
  showSettingsTabs,
  workspaceName,
}: {
  assets: BankAsset[];
  canManage: boolean;
  showSettingsTabs: boolean;
  workspaceName: string;
}) {
  const [filters, setFilters] = useState<AssetFilters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ asset: BankAsset | null; kind: AssetKind | null } | null>(null);
  const [deleting, setDeleting] = useState<BankAsset | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();

  // Un audio se transcribe al guardar y tarda unos segundos: mientras haya
  // alguno en camino, la lista se actualiza sola (cada 4 s, hasta ~2 minutos
  // por tanda) para que la transcripcion aparezca sin recargar a mano.
  const transcribingKey = assets.filter(isTranscribing).map((a) => a.id).sort().join(",");
  useEffect(() => {
    if (!transcribingKey) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > 30) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [transcribingKey, router]);

  const results = useMemo(() => applyFilters(assets, filters), [assets, filters]);
  const counts = useMemo(() => kindCounts(assets, filters), [assets, filters]);
  const tags = useMemo(() => tagCounts(assets, filters), [assets, filters]);
  const current = paginate(results, page);

  function changeFilters(next: AssetFilters) {
    setFilters(next);
    setPage(1);
  }

  function openNew(kind: AssetKind | null = null) {
    setError(null);
    setEditing({ asset: null, kind });
  }

  function run(assetId: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusyId(assetId);
    start(async () => {
      const result = await action();
      setBusyId(null);
      if (!result.ok) {
        setError(result.error ?? "Algo salió mal. Probá de nuevo.");
        return;
      }
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    run(target.id, () => deleteAsset(target.id));
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader
        route="/dashboard/settings/recursos"
        backHref={
          showSettingsTabs ? (
            <Link
              href="/dashboard/settings"
              aria-label="Volver a Ajustes"
              className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          ) : undefined
        }
        right={
          canManage && (
            <button
              onClick={() => openNew()}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Nuevo recurso</span>
              <span className="sr-only sm:hidden">Nuevo recurso</span>
            </button>
          )
        }
      />
      {/* Las pestañas llevan a pantallas de Admin: a quien no lo es, lo rebotarian. */}
      {showSettingsTabs && <SettingsTabs />}

      {error && (
        <div className="px-4 pt-4 md:px-8">
          <ActionError message={error} />
        </div>
      )}

      {assets.length === 0 ? (
        <BankEmptyState canManage={canManage} onNew={openNew} />
      ) : (
        <div className="flex flex-1 flex-col gap-4 px-4 py-4 md:px-8">
          <AssetFilterBar
            filters={filters}
            onChange={changeFilters}
            counts={counts}
            tags={tags}
            placeholder="Buscar por nombre, atajo, descripción, transcripción, enlace o etiqueta"
          />

          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {filters.query.trim()
                  ? `No hay recursos que coincidan con «${filters.query.trim()}».`
                  : "No hay recursos con estos filtros."}
              </p>
              {hasActiveFilters(filters) && (
                <button
                  type="button"
                  onClick={() => changeFilters(NO_FILTERS)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Recursos">
              {current.items.map((asset) => (
                <AssetListRow
                  key={asset.id}
                  asset={asset}
                  canManage={canManage}
                  busy={busyId === asset.id}
                  expanded={expandedId === asset.id}
                  onToggleExpanded={() => setExpandedId((id) => (id === asset.id ? null : asset.id))}
                  onEdit={() => {
                    setError(null);
                    setEditing({ asset, kind: asset.kind });
                  }}
                  onDelete={() => setDeleting(asset)}
                  onToggleAgent={() => run(asset.id, () => setAssetAgentEnabled(asset.id, !asset.agentEnabled))}
                  onRetry={() => run(asset.id, () => retryTranscription(asset.id))}
                />
              ))}
            </ul>
          )}

          {current.totalPages > 1 && (
            <nav aria-label="Páginas" className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {(current.page - 1) * 25 + 1}–{Math.min(current.page * 25, current.total)} de {current.total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(current.page - 1)}
                  disabled={current.page <= 1}
                  aria-label="Página anterior"
                  className="rounded-lg border border-border p-1.5 hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <span className="px-2 tabular-nums">
                  {current.page} / {current.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(current.page + 1)}
                  disabled={current.page >= current.totalPages}
                  aria-label="Página siguiente"
                  className="rounded-lg border border-border p-1.5 hover:bg-muted disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </nav>
          )}
        </div>
      )}

      {editing && (
        <AssetFormDialog
          asset={editing.asset}
          initialKind={editing.kind}
          assets={assets}
          workspaceName={workspaceName}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar recurso"
        message={
          deleting
            ? `Se elimina "${deleting.name}". Deja de aparecer en la bandeja y el asistente deja de usarlo. Lo que ya se mandó no cambia.`
            : ""
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/** El estado vacio que enseña (F5): que se puede guardar, y un boton por tipo. */
function BankEmptyState({ canManage, onNew }: { canManage: boolean; onNew: (kind: AssetKind) => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">Todavía no hay recursos.</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {canManage ? SETTINGS_EMPTY_STATES.recursosAdmin : SETTINGS_EMPTY_STATES.recursosMember}
      </p>
      {canManage && (
        <div className="mt-2 grid w-full max-w-md grid-cols-2 gap-2 sm:grid-cols-3">
          {ASSET_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => onNew(kind)}
              className="flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm hover:border-primary hover:bg-muted"
            >
              <AssetKindIcon kind={kind} className="h-4 w-4 text-muted-foreground" />
              {ASSET_KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetListRow({
  asset,
  canManage,
  busy,
  expanded,
  onToggleExpanded,
  onEdit,
  onDelete,
  onToggleAgent,
  onRetry,
}: {
  asset: BankAsset;
  canManage: boolean;
  busy: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAgent: () => void;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const usable = agentUsable(asset);
  const meta = metaLine(asset);
  const detailsId = `asset-details-${asset.id}`;

  async function copyText() {
    try {
      await navigator.clipboard.writeText(asset.content ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <li className={cn("flex flex-col gap-3 px-3 py-3 sm:px-4", !asset.isActive && "opacity-60")}>
      <div className="flex items-start gap-3">
        <AssetThumb asset={asset} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{asset.name}</span>
            {asset.shortcut && <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{asset.shortcut}</code>}
            {!asset.isActive && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Inactivo</span>}
            {asset.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-border px-1.5 text-[11px] text-muted-foreground">
                #{tag}
              </span>
            ))}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{contextLine(asset, 160)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground/80">
            <span className="inline-flex items-center gap-1">
              <AssetKindIcon kind={asset.kind} className="h-3 w-3" />
              {ASSET_KIND_LABEL[asset.kind]}
            </span>
            {meta && <span>{meta}</span>}
            {isTranscribableKind(asset.kind) && asset.transcriptStatus !== "ready" && (
              <span className={asset.transcriptStatus === "failed" ? "text-red-600 dark:text-red-400" : undefined}>
                {transcriptStatusLabel(asset.kind, asset.transcriptStatus)}
              </span>
            )}
            {asset.usageCount > 0 && <span>Usado {asset.usageCount} {asset.usageCount === 1 ? "vez" : "veces"}</span>}
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1">
          <AgentSwitch
            enabled={asset.agentEnabled}
            disabled={!canManage || busy || (!asset.agentEnabled && !usable)}
            reason={
              !usable && !asset.agentEnabled
                ? "El asistente solo puede usar un audio o un video con voz cuando su transcripción está lista"
                : !canManage
                  ? asset.agentEnabled
                    ? "El asistente lo puede usar solo"
                    : "El asistente no lo usa"
                  : undefined
            }
            onToggle={onToggleAgent}
          />
          {asset.kind === "text" && (
            <IconButton label={copied ? "Copiado" : `Copiar ${asset.name}`} onClick={copyText}>
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            </IconButton>
          )}
          <button
            type="button"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            aria-controls={detailsId}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Ver
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
          {canManage && (
            <>
              <IconButton label={`Editar ${asset.name}`} onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </IconButton>
              <IconButton label={`Eliminar ${asset.name}`} onClick={onDelete} danger>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </IconButton>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div id={detailsId} className="sm:pl-[60px]">
          <AssetPreview asset={asset} onRetryTranscript={canManage ? onRetry : undefined} retrying={busy} />
        </div>
      )}
    </li>
  );
}

/** Lo que dice cada tipo de si mismo: duracion, formato y peso, dominio. */
function metaLine(asset: BankAsset): string {
  switch (asset.kind) {
    case "audio":
    case "video":
      return [asset.durationSeconds != null ? formatRecordingDuration(asset.durationSeconds) : "", formatBytes(asset.sizeBytes)]
        .filter(Boolean)
        .join(" · ");
    case "image":
    case "file":
      return [formatLabel(asset.mimeType), formatBytes(asset.sizeBytes)].filter(Boolean).join(" · ");
    case "link":
      return urlDomain(asset.url);
    case "text":
      return "";
  }
}

function AgentSwitch({
  enabled,
  disabled,
  reason,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  reason?: string;
  onToggle: () => void;
}) {
  return (
    <span className="flex items-center gap-1.5 pr-1" title={reason}>
      <span className="hidden text-[11px] text-muted-foreground md:inline">Asistente</span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Que el asistente lo pueda usar"
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40",
          enabled ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform",
            enabled ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </span>
  );
}

function IconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-lg p-2 text-muted-foreground transition-colors",
        danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
