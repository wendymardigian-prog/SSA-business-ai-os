"use client";

import { useViewerTimezone } from "@/components/dashboard-chrome";
import { useEffect, useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Upload,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Pencil,
  Trash2,
  RefreshCw,
  FileText,
  Clock,
  Play,
  Link2,
  FileUp,
  Folder,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime } from "@/components/contacts/ui";
import {
  uploadDocument,
  updateDocumentMetadata,
  deleteDocument,
  reprocessDocument,
  indexPendingDocuments,
} from "@/lib/actions/knowledge";
import { moveDocumentToFolder, refreshLinkDocument, replaceDocumentFile } from "@/lib/actions/knowledge-sources";
import { FOLDER_ALL, FOLDER_NONE, FolderBar, LinkDialog, type FolderItem } from "./knowledge-folders";
import { countPending } from "@/lib/knowledge/pending-count";
import {
  validateFileSize,
  formatBytes,
  ACCEPTED_EXTENSIONS,
  MAX_FILE_BYTES,
  MIME_LABELS,
  type SupportedMime,
} from "@/lib/knowledge/validate";
import type { KnowledgeStatus } from "@/lib/types/database";
import { PageHeader } from "@/components/page-header";
import { ClickableBox } from "@/components/ui/clickable-row";

export interface KnowledgeDocument {
  id: string;
  title: string;
  tags: string[];
  status: KnowledgeStatus;
  errorDetail: string | null;
  chunkCount: number;
  /** Uso interno: nunca llega a un agente que conversa con leads (Fase 3). */
  internalOnly: boolean;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
  indexedAt: string | null;
  /** Carpeta, tipo de fuente y dirección del enlace (00443). */
  folderId?: string | null;
  sourceKind?: "file" | "link" | "text";
  sourceUrl?: string | null;
}

interface Props {
  documents: KnowledgeDocument[];
  /** Carpetas vivas de la base (00443). */
  folders?: Array<{ id: string; name: string }>;
  /** Puede crear carpetas, enlaces y reemplazar (`knowledge.edit`). */
  canEdit?: boolean;
  voyageConnected: boolean;
}

export function KnowledgeView({ documents: allDocuments, folders: rawFolders = [], canEdit = true, voyageConnected }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<KnowledgeDocument | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [folder, setFolder] = useState<string>(FOLDER_ALL);
  const folderNames = new Map(rawFolders.map((f) => [f.id, f.name]));
  const folders: FolderItem[] = rawFolders.map((f) => ({ ...f, count: allDocuments.filter((d) => d.folderId === f.id).length }));
  const isLoose = (d: KnowledgeDocument) => !d.folderId || !folderNames.has(d.folderId);
  const looseCount = allDocuments.filter(isLoose).length;
  const activeFolder = folder === FOLDER_ALL || folder === FOLDER_NONE || folderNames.has(folder) ? folder : FOLDER_ALL;
  const documents =
    activeFolder === FOLDER_ALL
      ? allDocuments
      : activeFolder === FOLDER_NONE
        ? allDocuments.filter(isLoose)
        : allDocuments.filter((d) => d.folderId === activeFolder);
  const uploadFolderId = activeFolder !== FOLDER_ALL && activeFolder !== FOLDER_NONE ? activeFolder : null;
  const pendingCount = countPending(allDocuments);
  const hasProcessing = allDocuments.some((d) => d.status === "processing");

  // Mientras algo se procesa, la lista se refresca sola (antes habia que recargar a mano para ver "Listo").
  // Tope de ~3 minutos: si un documento sigue "procesando" mas que eso, pasa algo y recargar no lo arregla.
  useEffect(() => {
    if (!hasProcessing) return;
    let ticks = 0;
    const id = setInterval(() => {
      ticks += 1;
      router.refresh();
      if (ticks >= 45) clearInterval(id);
    }, 4000);
    return () => clearInterval(id);
  }, [hasProcessing, router]);

  function handleIndexPending() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await indexPendingDocuments();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const parts = [`Se pusieron ${result.queued} documento${result.queued === 1 ? "" : "s"} en cola para indexar.`];
      if (result.failed > 0) parts.push(`${result.failed} no se pudo${result.failed === 1 ? "" : "ieron"} encolar: siguen pendientes, probá de nuevo.`);
      if (result.remaining > 0) parts.push(`Quedan ${result.remaining} más: volvé a apretar el botón.`);
      setNotice(parts.join(" "));
      router.refresh();
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setError(null);
    setNotice(null);

    // De a uno: cada documento es un job propio, y si uno falla los demas tienen
    // que seguir. Se avisa el primero que falla y se sigue con el resto.
    setUploading(true);
    const errores: string[] = [];
    let subidos = 0;
    let pendientes = 0;

    for (const file of Array.from(files)) {
      // El tamano se puede chequear aca y ahorrar la subida entera. El tipo
      // real no: eso necesita los bytes y lo decide el servidor.
      const size = validateFileSize(file.size);
      if (!size.ok) {
        errores.push(`${file.name}: ${size.error}`);
        continue;
      }

      const data = new FormData();
      data.set("file", file);
      if (uploadFolderId) data.set("folderId", uploadFolderId);

      const result = await uploadDocument(data);
      if (result.ok) {
        subidos++;
        if (result.pending) pendientes++;
      } else errores.push(`${file.name}: ${result.error}`);
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";

    if (errores.length > 0) setError(errores.join(" · "));
    if (subidos > 0) {
      setNotice(
        pendientes === subidos
          ? subidos === 1
            ? "Documento guardado. Queda pendiente de indexar: se indexa solo cuando conectes Voyage AI."
            : `${subidos} documentos guardados. Quedan pendientes de indexar: se indexan solos cuando conectes Voyage AI.`
          : subidos === 1
            ? "Documento subido. Se esta procesando: en un momento pasa a listo."
            : `${subidos} documentos subidos. Se estan procesando.`,
      );
      router.refresh();
    }
  }

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);

    startTransition(async () => {
      const result = await deleteDocument(target.id);
      if (result.ok) {
        setNotice("Documento eliminado.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  /** : una versión nueva del archivo; los trozos viejos se retiran antes de reindexar. */
  async function handleReplace(files: FileList | null) {
    const target = replacing;
    if (replaceRef.current) replaceRef.current.value = "";
    setReplacing(null);
    const file = files?.[0];
    if (!target || !file) return;
    setError(null);
    setNotice(null);
    const size = validateFileSize(file.size);
    if (!size.ok) {
      setError(`${file.name}: ${size.error}`);
      return;
    }
    const data = new FormData();
    data.set("documentId", target.id);
    data.set("file", file);
    setUploading(true);
    const result = await replaceDocumentFile(data);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(
      result.pending
        ? "Versión nueva guardada. Se indexa cuando conectes Voyage AI; mientras, el agente no usa este documento."
        : "Versión nueva subida. Se está reindexando; el agente ya no usa la anterior.",
    );
    router.refresh();
  }

  function handleRefreshLink(document: KnowledgeDocument) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await refreshLinkDocument(document.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(
        result.pending
          ? "Página leída de nuevo. Se indexa cuando conectes Voyage AI."
          : "Página leída de nuevo. Se está reindexando; el agente ya no usa la versión anterior.",
      );
      router.refresh();
    });
  }

  function handleReprocess(document: KnowledgeDocument) {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const result = await reprocessDocument(document.id);
      if (result.ok) {
        setNotice("Se volvio a encolar. En un momento cambia de estado.");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/knowledge"
        right={
          <div className="flex items-center gap-2">
            {pendingCount > 0 && voyageConnected && (
              <button
                type="button"
                onClick={handleIndexPending}
                disabled={pending || uploading}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                Indexar pendientes ({pendingCount})
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                disabled={uploading}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                <Link2 className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Agregar enlace</span>
                <span className="sm:hidden">Enlace</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {uploading ? "Subiendo..." : "Subir documento"}
            </button>
          </div>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        multiple
        className="sr-only"
        aria-label="Elegir documentos para subir"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="sr-only"
        aria-label="Elegir la versión nueva del documento"
        onChange={(e) => handleReplace(e.target.files)}
      />

      <div
        className="flex-1 overflow-auto px-4 py-6 sm:px-8"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        {!voyageConnected && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Falta conectar Voyage AI para poder indexar
              </p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                Podés subir documentos igual: quedan guardados como pendientes de indexar y se
                indexan solos cuando conectes Voyage AI. Hasta entonces no se pueden buscar.{" "}
                <Link
                  href="/dashboard/settings/integrations"
                  className="font-medium underline underline-offset-2"
                >
                  Conectarla en Integraciones
                </Link>
              </p>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
            {notice}
          </div>
        )}

        {dragging && (
          <div className="mb-4 rounded-lg border-2 border-dashed border-primary-edge bg-primary/5 p-4 text-center text-sm font-medium text-primary-ink">
            Solta los archivos para subirlos
          </div>
        )}

        {(allDocuments.length > 0 || folders.length > 0) && (
          <FolderBar
            folders={folders}
            selected={activeFolder}
            onSelect={setFolder}
            totalCount={allDocuments.length}
            looseCount={looseCount}
            canEdit={canEdit}
            onChanged={(text) => {
              setError(null);
              setNotice(text);
              router.refresh();
            }}
            onError={(text) => setError(text)}
          />
        )}

        {allDocuments.length === 0 ? (
          <EmptyState onPick={() => inputRef.current?.click()} />
        ) : documents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {activeFolder === FOLDER_NONE
              ? "Todos los documentos están en alguna carpeta."
              : "Esta carpeta está vacía. Subí un documento o agregá un enlace con la carpeta abierta y se guarda acá."}
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                disabled={pending || uploading}
                voyageConnected={voyageConnected}
                folderName={document.folderId ? (folderNames.get(document.folderId) ?? null) : null}
                onEdit={() => setEditing(document)}
                onDelete={() => setDeleting(document)}
                onReprocess={() => handleReprocess(document)}
                onReplace={
                  canEdit && (document.sourceKind ?? "file") === "file"
                    ? () => {
                        setReplacing(document);
                        replaceRef.current?.click();
                      }
                    : undefined
                }
                onRefreshLink={canEdit && document.sourceKind === "link" ? () => handleRefreshLink(document) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditDialog
          document={editing}
          folders={rawFolders}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice("Cambios guardados.");
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar documento"
        message={`Se elimina "${deleting?.title ?? ""}" de la base de conocimiento. Se puede recuperar durante 30 dias.`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

      {linkOpen && (
        <LinkDialog
          folders={folders}
          defaultFolderId={uploadFolderId}
          onClose={() => setLinkOpen(false)}
          onSaved={(isPending) => {
            setLinkOpen(false);
            setError(null);
            setNotice(isPending ? "Enlace guardado. Se indexa cuando conectes Voyage AI." : "Enlace agregado. Se está procesando: en un momento pasa a listo.");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="mt-12 rounded-xl border border-dashed border-border p-12 text-center">
      <BookOpen className="mx-auto h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold">Todavia no hay documentos</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Subi lo que tu equipo responde todos los dias: precios, politica de reembolsos, preguntas
        frecuentes. La IA va a poder buscar ahi adentro en vez de improvisar.
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        PDF, Word (.docx), texto (.txt) o Markdown (.md). Hasta {formatBytes(MAX_FILE_BYTES)} por
        archivo.
      </p>
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={onPick}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Subir el primero
        </button>
      </div>
    </div>
  );
}

function DocumentRow({
  document,
  disabled,
  voyageConnected,
  folderName,
  onEdit,
  onDelete,
  onReprocess,
  onReplace,
  onRefreshLink,
}: {
  document: KnowledgeDocument;
  disabled: boolean;
  voyageConnected: boolean;
  folderName?: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onReprocess: () => void;
  /** : subir una versión nueva (solo documentos-archivo). */
  onReplace?: () => void;
  /** : volver a leer la página (solo enlaces). */
  onRefreshLink?: () => void;
}) {
  const timeZone = useViewerTimezone();
  const isLink = document.sourceKind === "link";
  const label = isLink
    ? "Enlace"
    : document.mime
      ? (MIME_LABELS[document.mime as SupportedMime] ?? "Documento")
      : "Documento";
  const linkHost = isLink && document.sourceUrl ? safeHost(document.sourceUrl) : null;

  return (
    <ClickableBox href={`/dashboard/knowledge/${document.id}`} className="rounded-xl border border-border bg-card p-5 hover:bg-accent/30">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          {isLink ? (
            <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{document.title}</span>
            <StatusBadge status={document.status} />
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {label}
            {linkHost ? ` · ${linkHost}` : ""}
            {document.sizeBytes && !isLink ? ` · ${formatBytes(document.sizeBytes)}` : ""}
            {document.status === "ready" ? ` · ${fragmentLabel(document.chunkCount)}` : ""}
            {` · Subido el ${formatDateTime(document.createdAt, timeZone)}`}
          </p>

          {(document.tags.length > 0 || document.internalOnly || folderName) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {folderName && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <Folder className="h-3 w-3" aria-hidden="true" />
                  {folderName}
                </span>
              )}
              {document.internalOnly && (
                <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  Uso interno
                </span>
              )}
              {document.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {document.status === "pending" && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {voyageConnected
                ? "Guardado y listo para indexar: tocá “Indexar pendientes” o el botón de este documento."
                : "Guardado. Se indexa solo cuando conectes Voyage AI; hasta entonces no se puede buscar."}
            </p>
          )}

          {document.status === "error" && document.errorDetail && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {document.errorDetail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {(document.status === "error" || (document.status === "pending" && voyageConnected)) && (
            <IconButton label={document.status === "pending" ? "Indexar ahora" : "Reprocesar"} onClick={onReprocess} disabled={disabled}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          {onReplace && (
            <IconButton label="Reemplazar por una versión nueva" onClick={onReplace} disabled={disabled}>
              <FileUp className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          {onRefreshLink && (
            <IconButton label="Volver a leer la página" onClick={onRefreshLink} disabled={disabled}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          )}
          <IconButton label="Editar" onClick={onEdit} disabled={disabled}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Eliminar" onClick={onDelete} disabled={disabled} destructive>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </ClickableBox>
  );
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function fragmentLabel(count: number): string {
  return count === 1 ? "1 fragmento indexado" : `${count} fragmentos indexados`;
}

function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`rounded-lg p-2 transition-colors hover:bg-accent disabled:opacity-40 ${
        destructive ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: KnowledgeStatus }) {
  if (status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
        Procesando
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-300">
        <Clock className="h-2.5 w-2.5" aria-hidden="true" />
        Pendiente de indexar
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
        <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
        Error
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
      <CheckCircle2 className="h-2.5 w-2.5" aria-hidden="true" />
      Listo
    </span>
  );
}

function EditDialog({
  document,
  folders = [],
  onClose,
  onSaved,
}: {
  document: KnowledgeDocument;
  folders?: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [folderId, setFolderId] = useState(document.folderId ?? "");
  const [title, setTitle] = useState(document.title);
  const [tags, setTags] = useState(document.tags.join(", "));
  const [internalOnly, setInternalOnly] = useState(document.internalOnly);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateDocumentMetadata(document.id, title, tags, internalOnly);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if ((document.folderId ?? "") !== folderId) {
        const moved = await moveDocumentToFolder(document.id, folderId || null);
        if (!moved.ok) {
          setError(moved.error);
          return;
        }
      }
      onSaved();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="editar-documento"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
      >
        <h2 id="editar-documento" className="text-lg font-semibold">
          Editar documento
        </h2>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="kb-titulo" className="block text-sm font-medium">
              Titulo
            </label>
            <input
              id="kb-titulo"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="kb-tags" className="block text-sm font-medium">
              Etiquetas
            </label>
            <input
              id="kb-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="precios, faq"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">Separadas por coma.</p>
          </div>

          {folders.length > 0 && (
            <div>
              <label htmlFor="kb-carpeta" className="block text-sm font-medium">
                Carpeta
              </label>
              <select
                id="kb-carpeta"
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Sin carpeta</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="checkbox"
              checked={internalOnly}
              onChange={(e) => setInternalOnly(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium">Uso interno — no usar con leads</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                El agente de IA nunca lo lee, tenga las etiquetas que tenga.
              </span>
            </span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
