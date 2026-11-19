"use client";

import { useState, useTransition } from "react";
import { Folder, FolderPlus, Link2, Loader2, Pencil, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { addLinkDocument, createFolder, deleteFolder, renameFolder } from "@/lib/actions/knowledge-sources";
import { MAX_FOLDER_NAME } from "@/lib/knowledge/folders";

/**
 * Carpetas y enlaces de la base. La barra filtra la lista por carpeta;
 * desde ella se crea, renombra y elimina (borrado blando: los documentos quedan
 * sin carpeta). El diálogo de enlace lee la página y la indexa como un documento.
 */

export const FOLDER_ALL = "todas";
export const FOLDER_NONE = "sin-carpeta";

export interface FolderItem {
  id: string;
  name: string;
  count: number;
}

const chip = (active: boolean) =>
  cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active ? "border-primary-edge bg-primary text-primary-foreground" : "border-border hover:bg-accent",
  );

export function FolderBar({
  folders,
  selected,
  onSelect,
  totalCount,
  looseCount,
  canEdit,
  onChanged,
  onError,
}: {
  folders: FolderItem[];
  selected: string;
  onSelect: (value: string) => void;
  totalCount: number;
  looseCount: number;
  canEdit: boolean;
  onChanged: (notice: string) => void;
  onError: (error: string) => void;
}) {
  const [naming, setNaming] = useState<{ mode: "create" } | { mode: "rename"; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<FolderItem | null>(null);
  const [pending, start] = useTransition();
  const current = folders.find((f) => f.id === selected) ?? null;

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    start(async () => {
      const result = await deleteFolder(target.id);
      if (!result.ok) return onError(result.error);
      onSelect(FOLDER_ALL);
      onChanged(`Carpeta «${target.name}» eliminada. Sus documentos siguen en la base, sin carpeta.`);
    });
  }

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label="Carpetas">
        <button type="button" className={chip(selected === FOLDER_ALL)} aria-pressed={selected === FOLDER_ALL} onClick={() => onSelect(FOLDER_ALL)}>
          Todas <span className="opacity-70">{totalCount}</span>
        </button>
        {folders.map((f) => (
          <button key={f.id} type="button" className={chip(selected === f.id)} aria-pressed={selected === f.id} onClick={() => onSelect(f.id)}>
            <Folder className="h-3.5 w-3.5" aria-hidden="true" />
            {f.name} <span className="opacity-70">{f.count}</span>
          </button>
        ))}
        {folders.length > 0 && (
          <button type="button" className={chip(selected === FOLDER_NONE)} aria-pressed={selected === FOLDER_NONE} onClick={() => onSelect(FOLDER_NONE)}>
            Sin carpeta <span className="opacity-70">{looseCount}</span>
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => setNaming({ mode: "create" })} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent">
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Nueva carpeta
          </button>
        )}
      </div>

      {canEdit && current && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <button type="button" disabled={pending} onClick={() => setNaming({ mode: "rename", id: current.id, name: current.name })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent disabled:opacity-50">
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Renombrar
          </button>
          <button type="button" disabled={pending} onClick={() => setDeleting(current)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Eliminar carpeta
          </button>
        </div>
      )}

      {naming && (
        <FolderNameDialog
          initial={naming.mode === "rename" ? naming.name : ""}
          title={naming.mode === "rename" ? "Renombrar carpeta" : "Nueva carpeta"}
          onClose={() => setNaming(null)}
          onSubmit={async (name) => {
            const result = naming.mode === "rename" ? await renameFolder(naming.id, name) : await createFolder(name);
            if (!result.ok) return result.error;
            setNaming(null);
            if (naming.mode === "create" && result.id) onSelect(result.id);
            onChanged(naming.mode === "rename" ? "Carpeta renombrada." : `Carpeta «${name.trim()}» creada.`);
            return null;
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Eliminar carpeta"
        message={`Se elimina la carpeta «${deleting?.name ?? ""}». Sus documentos no se borran: quedan sin carpeta. Los agentes que tenían acceso por esta carpeta dejan de llegar a ellos.`}
        confirmLabel="Eliminar carpeta"
        cancelLabel="Cancelar"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg">
        <h2 className="text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function FolderNameDialog({ title, initial, onClose, onSubmit }: { title: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => setError(await onSubmit(name)));
        }}
      >
        <label className="block text-sm">
          <span className="text-xs font-medium">Nombre</span>
          <input autoFocus value={name} maxLength={MAX_FOLDER_NAME} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Cancelar</button>
          <button type="submit" disabled={pending || !name.trim()} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LinkDialog({ folders, defaultFolderId, onClose, onSaved }: { folders: FolderItem[]; defaultFolderId: string | null; onClose: () => void; onSaved: (pending: boolean) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Modal title="Agregar enlace" onClose={onClose}>
      <p className="mt-1 text-xs text-muted-foreground">Se lee la página y se guarda su texto como un documento más. Si la página cambia, usa «Volver a leer» en el documento.</p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const result = await addLinkDocument({ url, title, tags, folderId: folderId || null });
            if (!result.ok) return setError(result.error);
            onSaved(Boolean(result.pending));
          });
        }}
      >
        <label className="block text-sm">
          <span className="text-xs font-medium">Dirección</span>
          <input autoFocus type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium">Título (opcional)</span>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="El de la página si lo dejas vacío" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium">Etiquetas (separadas por comas)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
        </label>
        {folders.length > 0 && (
          <label className="block text-sm">
            <span className="text-xs font-medium">Carpeta</span>
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">Sin carpeta</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        )}
        {error && <p role="alert" className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent">Cancelar</button>
          <button type="submit" disabled={pending || !url.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
            {pending ? "Leyendo la página…" : "Agregar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
