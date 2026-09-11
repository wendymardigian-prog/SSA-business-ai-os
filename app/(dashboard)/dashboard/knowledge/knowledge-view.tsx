"use client";

import { useState, useTransition, useRef } from "react";
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
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime } from "@/components/contacts/ui";
import {
  uploadDocument,
  updateDocumentMetadata,
  deleteDocument,
  reprocessDocument,
} from "@/lib/actions/knowledge";
import {
  validateFileSize,
  formatBytes,
  ACCEPTED_EXTENSIONS,
  MAX_FILE_BYTES,
  MIME_LABELS,
  type SupportedMime,
} from "@/lib/knowledge/validate";
import type { KnowledgeStatus } from "@/lib/types/database";

export interface KnowledgeDocument {
  id: string;
  title: string;
  tags: string[];
  status: KnowledgeStatus;
  errorDetail: string | null;
  chunkCount: number;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
  indexedAt: string | null;
}

interface Props {
  documents: KnowledgeDocument[];
  voyageConnected: boolean;
}

export function KnowledgeView({ documents, voyageConnected }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setError(null);
    setNotice(null);

    // De a uno: cada documento es un job propio, y si uno falla los demas tienen
    // que seguir. Se avisa el primero que falla y se sigue con el resto.
    setUploading(true);
    const errores: string[] = [];
    let subidos = 0;

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

      const result = await uploadDocument(data);
      if (result.ok) subidos++;
      else errores.push(`${file.name}: ${result.error}`);
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";

    if (errores.length > 0) setError(errores.join(" · "));
    if (subidos > 0) {
      setNotice(
        subidos === 1
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
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Base de conocimiento</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Los documentos que la IA usa para responder con informacion tuya y no inventada
            </p>
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            {uploading ? "Subiendo..." : "Subir documento"}
          </button>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        multiple
        className="sr-only"
        aria-label="Elegir documentos para subir"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div
        className="flex-1 overflow-auto px-8 py-6"
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
                Podes subir documentos igual y se guardan, pero no se van a poder buscar hasta que
                cargues la key.{" "}
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
          <div className="mb-4 rounded-lg border-2 border-dashed border-primary bg-primary/5 p-4 text-center text-sm font-medium text-primary">
            Solta los archivos para subirlos
          </div>
        )}

        {documents.length === 0 ? (
          <EmptyState onPick={() => inputRef.current?.click()} />
        ) : (
          <div className="space-y-3">
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                disabled={pending || uploading}
                onEdit={() => setEditing(document)}
                onDelete={() => setDeleting(document)}
                onReprocess={() => handleReprocess(document)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditDialog
          document={editing}
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
  onEdit,
  onDelete,
  onReprocess,
}: {
  document: KnowledgeDocument;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReprocess: () => void;
}) {
  const label = document.mime
    ? (MIME_LABELS[document.mime as SupportedMime] ?? "Documento")
    : "Documento";

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/knowledge/${document.id}`}
              className="font-medium transition-colors hover:text-primary"
            >
              {document.title}
            </Link>
            <StatusBadge status={document.status} />
          </div>

          <p className="mt-1 text-xs text-muted-foreground">
            {label}
            {document.sizeBytes ? ` · ${formatBytes(document.sizeBytes)}` : ""}
            {document.status === "ready" ? ` · ${fragmentLabel(document.chunkCount)}` : ""}
            {` · Subido el ${formatDateTime(document.createdAt)}`}
          </p>

          {document.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
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

          {document.status === "error" && document.errorDetail && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {document.errorDetail}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {document.status === "error" && (
            <IconButton label="Reprocesar" onClick={onReprocess} disabled={disabled}>
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
    </div>
  );
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
  onClose,
  onSaved,
}: {
  document: KnowledgeDocument;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [tags, setTags] = useState(document.tags.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateDocumentMetadata(document.id, title, tags);
      if (result.ok) onSaved();
      else setError(result.error);
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
