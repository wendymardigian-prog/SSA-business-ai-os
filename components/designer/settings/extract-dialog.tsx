"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { extractStyle } from "@/lib/actions/designer/settings";
import { actionErrorText } from "@/lib/designer/screens/ai-panel";
import { checkExtractionFile, downscaleSize, extractionPick, MAX_REFERENCE_BYTES } from "@/lib/designer/screens/settings";
import type { DesignStyle } from "@/lib/designer/styles";
import { SettingsDialog } from "./settings-dialog";

export interface PickableDesign {
  id: string;
  name: string;
}

/** Achica una imagen de referencia (lado mayor 1024 px, JPEG): alcanza para ver una paleta y una composición y entra en lo que admite el servidor. */
async function downscale(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = downscaleSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size > MAX_REFERENCE_BYTES) return file;
    return new File([blob], file.name.replace(/\.[A-Za-z0-9]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** «+ Crear desde mis piezas»: de 3 a 5 imágenes (o diseños tuyos) → la IA arma un estilo para revisar. */
export function ExtractDialog({ designs, onClose, onExtracted }: { designs: PickableDesign[]; onClose: () => void; onExtracted: (style: DesignStyle, corrections: string[]) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = extractionPick(files.length, picked.length);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    setPreparing(true);
    const next: File[] = [];
    for (const file of Array.from(list)) {
      const problem = checkExtractionFile(file);
      if (problem) {
        setError(`«${file.name}»: ${problem}`);
        continue;
      }
      next.push(await downscale(file));
    }
    setFiles((current) => [...current, ...next].slice(0, 5));
    setPreparing(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function run() {
    if (!pick.canExtract) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of files) form.append("images", f, f.name);
      for (const id of picked) form.append("designIds", id);
      const result = await extractStyle(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onExtracted(result.data.style, result.data.corrections);
    } catch (e) {
      setError(actionErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsDialog
      title="Crear un estilo desde mis piezas"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button type="button" onClick={run} disabled={!pick.canExtract || busy || preparing} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Analizando…" : "Analizar con IA"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Subí de 3 a 5 piezas que te gusten (o elegí diseños tuyos). La IA saca la paleta, las fuentes más cercanas, cuántas palabras suelen tener y reglas de composición. Lo revisás antes de guardarlo.</p>

        <div className="flex flex-col gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={files.length + picked.length >= 5 || preparing} className="inline-flex w-fit items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImagePlus className="h-4 w-4" aria-hidden />}+ Subir imágenes
          </button>
          <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Elegir imágenes de piezas" onChange={(e) => void addFiles(e.target.files)} />
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs">
                  {f.name}
                  <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))} className="hover:text-destructive">
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {designs.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">O elegí diseños tuyos (se usa su primera página)</legend>
            {designs.map((d) => {
              const checked = picked.includes(d.id);
              return (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked} disabled={!checked && files.length + picked.length >= 5} onChange={() => setPicked((l) => (checked ? l.filter((x) => x !== d.id) : [...l, d.id]))} />
                  <span className="min-w-0 truncate">{d.name}</span>
                </label>
              );
            })}
          </fieldset>
        )}

        <p className="text-xs text-muted-foreground" role="status">
          {pick.count} de 5 piezas elegidas{pick.message ? ` · ${pick.message}` : ""}
        </p>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </SettingsDialog>
  );
}
