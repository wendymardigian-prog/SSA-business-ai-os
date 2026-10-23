"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, Loader2, GitBranch, FileJson, X, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { Json } from "@/lib/types/database";

export interface FlowExportData {
  name: string;
  description?: string | null;
  categories?: string[];
  nodes: Json;
  edges: Json;
  version: number;
  exportedAt: string;
  source: "business-os";
}

function isValidFlowData(data: unknown): data is FlowExportData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.name === "string" &&
    Array.isArray(d.nodes) &&
    Array.isArray(d.edges)
  );
}

/** Arma y baja el archivo `.flow.json` de una automatizacion (lo usan la lista y el lienzo). */
export function downloadFlowFile(data: FlowExportData) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")}.flow.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exportar desde la lista: la lista no trae los pasos (no hace falta para mostrarla), asi que se piden al tocar.
 * Exporta lo que corre (no los cambios sin publicar).
 */
export function ExportFlowButton({ flow }: { flow: { id: string; name: string } }) {
  const [busy, setBusy] = useState(false);
  async function handleExport(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/flows/${flow.id}`);
      if (!res.ok) throw new Error(String(res.status));
      const full = (await res.json()) as { name: string; description?: string | null; categories?: string[]; nodes: Json; edges: Json; version?: number };
      downloadFlowFile({
        name: full.name,
        description: full.description || null,
        categories: full.categories ?? [],
        nodes: full.nodes,
        edges: full.edges,
        version: full.version || 1,
        exportedAt: new Date().toISOString(),
        source: "business-os",
      });
    } catch (err) {
      console.error("[flows] no se pudo exportar:", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={busy}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground/60 hover:bg-muted hover:text-muted-foreground transition-colors disabled:opacity-50"
      aria-label={`Exportar ${flow.name}`}
      title="Exportar"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
    </button>
  );
}

export function DeleteFlowButton({
  flow,
}: {
  flow: { id: string; name: string };
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/flows/${flow.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        console.error("[flows] no se pudo borrar la automatizacion");
        setError("No se pudo borrar. Probá de nuevo.");
        return;
      }

      router.refresh();
    } catch (err) {
      console.error("[flows] no se pudo borrar la automatizacion:", err);
      setError("No se pudo borrar. Probá de nuevo.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    // The button lives inside the flow card's <Link>; stop clicks (including
    // clicks inside the dialog, which renders in the same DOM subtree) from
    // bubbling into card navigation.
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        onClick={() => setConfirmOpen(true)}
        disabled={deleting}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground/60 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors disabled:opacity-50"
        aria-label={`Borrar ${flow.name}`}
        title={error ?? "Borrar"}
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Borrar automatización"
        message={`«${flow.name}» se borra con sus disparadores, versiones e historial de ejecuciones. No se puede deshacer.`}
        confirmLabel="Borrar"
        destructive
        onConfirm={() => {
          setConfirmOpen(false);
          handleDelete();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </span>
  );
}

export function ImportFlowButton({ compact = false }: { compact?: boolean } = {}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FlowExportData | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!isValidFlowData(data)) {
        throw new Error("El archivo no es una automatización: le faltan el nombre, los pasos o las conexiones.");
      }

      setPreview(data);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError("El archivo no se puede leer (no es un JSON válido).");
      } else {
        setError(err instanceof Error ? err.message : "El archivo no sirve.");
      }
      setTimeout(() => setError(null), 4000);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleConfirmImport() {
    if (!preview) return;

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${preview.name} (importada)`,
          description: preview.description || null,
          categories: Array.isArray(preview.categories) ? preview.categories : [],
          nodes: preview.nodes,
          edges: preview.edges,
        }),
      });

      if (!res.ok) {
        let errorMsg = "No se pudo importar la automatización.";
        try {
          const err = await res.json();
          errorMsg = err.error || errorMsg;
        } catch {
          errorMsg = `El servidor respondió ${res.status}. Probá de nuevo.`;
        }
        throw new Error(errorMsg);
      }

      const flow = await res.json();
      setPreview(null);
      router.push(`/dashboard/flows/${flow.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo importar.");
      setTimeout(() => setError(null), 4000);
    } finally {
      setImporting(false);
    }
  }

  const nodeCount = preview ? (Array.isArray(preview.nodes) ? preview.nodes.length : 0) : 0;
  const edgeCount = preview ? (Array.isArray(preview.edges) ? preview.edges.length : 0) : 0;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.flow.json"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        aria-label="Importar una automatización"
        title="Importar una automatización (.flow.json)"
        className={
          compact
            ? "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
            : "inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
        }
      >
        {importing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        <span className={compact ? "hidden 2xl:inline" : undefined}>{importing ? "Importando…" : "Importar"}</span>
      </button>

      {error && (
        <span className="text-xs font-medium text-destructive">{error}</span>
      )}

      {/* Import preview */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreview(null)}>
          <div className="mx-4 w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{preview.name}</p>
                <p className="text-xs text-muted-foreground">
                  {nodeCount} {nodeCount === 1 ? "paso" : "pasos"} · {edgeCount} {edgeCount === 1 ? "conexión" : "conexiones"}
                </p>
              </div>
            </div>

            {error && (
              <p className="mt-3 text-xs font-medium text-destructive">{error}</p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setPreview(null)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={importing}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                {importing ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
