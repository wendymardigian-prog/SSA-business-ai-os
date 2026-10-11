"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { importCall } from "@/lib/actions/calls-import";
import { searchContactsForCall, type ContactOption } from "@/lib/actions/calls-link";
import { datetimeInputToIso, isoToDatetimeInput } from "@/lib/dates";
import { MAX_IMPORT_BYTES, titleFromFilename, validateImportFile } from "@/lib/calls/transcript-import";

/**
 * Importar una llamada que no vino de Fathom (Zoom, Meet, TurboScribe…) (F11):
 * pegar el texto o subir un .vtt, .srt o .txt (hasta 2 MB). El tamaño y el tipo
 * se revisan aca y, otra vez, en el servidor.
 */
export function ImportCallModal({
  onClose,
  closers,
  currentUserId,
  onImported,
}: {
  onClose: () => void;
  closers: Array<{ id: string; name: string }>;
  currentUserId: string;
  onImported: (id: string) => void;
}) {
  const timeZone = useViewerTimezone();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState(() => isoToDatetimeInput(new Date().toISOString(), timeZone));
  const [closerId, setCloserId] = useState(currentUserId);
  const [contact, setContact] = useState<ContactOption | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [options, setOptions] = useState<ContactOption[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ file: File; loadedText: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // El buscador de contactos: solo los que esta persona puede ver (lo decide la base).
  const searching = !contact && contactQuery.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const handle = setTimeout(async () => {
      const found = await searchContactsForCall(contactQuery);
      if (alive) setOptions(found);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [contactQuery, searching]);
  // Lo que se muestra: sin busqueda activa no queda ningun resultado viejo a la vista.
  const shownOptions = searching ? options : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !pending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  async function pickFile(f: File | undefined) {
    if (!f) return;
    const check = validateImportFile({ name: f.name, size: f.size });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    const content = await f.text();
    setFile({ file: f, loadedText: content });
    setText(content);
    if (!title) setTitle(titleFromFilename(f.name));
  }

  function submit() {
    setError(null);
    const iso = datetimeInputToIso(when, timeZone);
    if (!iso) return setError("Poné la fecha y la hora de la llamada");
    if (!text.trim()) return setError("Pegá o subí la transcripción");
    const form = new FormData();
    form.set("title", title.trim() || "Llamada importada");
    form.set("recordedAt", iso);
    form.set("closerId", closerId);
    if (contact) form.set("contactId", contact.id);
    // Si no se toco el texto que vino del archivo, se manda el archivo (se valida el tipo y el peso en el servidor).
    if (file && text === file.loadedText) form.set("file", file.file);
    else form.set("text", text);
    start(async () => {
      const r = await importCall(form);
      if (!r.ok) return setError(r.error);
      onImported(r.id);
    });
  }

  const tooBig = new TextEncoder().encode(text).length > MAX_IMPORT_BYTES;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="fixed inset-0 bg-black/50" onClick={() => !pending && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-card p-5 shadow-lg sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="import-title" className="text-base font-semibold">Importar llamada</h2>
            <p className="mt-1 text-xs text-muted-foreground">Traé una llamada grabada fuera de Fathom (Zoom, Google Meet…). Se clasifica igual que las de Fathom.</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Cerrar" className="rounded-lg p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" aria-hidden /></button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium">
            Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Cierre con Juan Pérez" maxLength={200} disabled={pending} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              Fecha y hora
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={pending} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" />
            </label>
            <label className="block text-xs font-medium">
              Closer
              <select value={closerId} onChange={(e) => setCloserId(e.target.value)} disabled={pending} className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm">
                {closers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div className="relative text-xs font-medium">
            <label htmlFor="import-contact">Contacto <span className="font-normal text-muted-foreground">(opcional)</span></label>
            {contact ? (
              <div className="mt-1 flex h-9 items-center justify-between rounded-lg border border-input bg-muted/40 px-2 text-sm">
                <span className="truncate">{contact.name}{contact.email ? ` · ${contact.email}` : ""}</span>
                <button type="button" aria-label="Quitar el contacto" onClick={() => { setContact(null); setContactQuery(""); }} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" aria-hidden /></button>
              </div>
            ) : (
              <input id="import-contact" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} placeholder="Buscar por nombre o correo" disabled={pending} autoComplete="off" className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm" />
            )}
            {shownOptions.length > 0 && (
              <ul role="listbox" aria-label="Contactos" className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
                {shownOptions.map((o) => (
                  <li key={o.id}>
                    <button type="button" role="option" aria-selected={false} onClick={() => { setContact(o); setOptions([]); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent">
                      <span className="block truncate">{o.name}</span>
                      {o.email && <span className="block truncate text-xs text-muted-foreground">{o.email}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="import-text" className="text-xs font-medium">Transcripción</label>
              <input ref={fileRef} type="file" accept=".txt,.vtt,.srt" className="hidden" onChange={(e) => { void pickFile(e.target.files?.[0]); if (fileRef.current) fileRef.current.value = ""; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={pending} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                <Upload className="h-3.5 w-3.5" aria-hidden /> Subir .txt, .vtt o .srt
              </button>
            </div>
            <textarea id="import-text" value={text} onChange={(e) => setText(e.target.value)} rows={9} disabled={pending} placeholder="Pegá acá el texto de la llamada…" className="mt-1 w-full rounded-lg border border-input bg-background p-2 text-sm" />
            {tooBig && <p className="mt-1 text-xs text-destructive">El texto pesa más de 2 MB.</p>}
          </div>
        </div>

        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent">Cancelar</button>
          <button type="button" onClick={submit} disabled={pending || !text.trim() || tooBig} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Importar
          </button>
        </div>
      </div>
    </div>
  );
}
