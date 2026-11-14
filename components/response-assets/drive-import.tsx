"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudDownload, Loader2, X } from "lucide-react";
import { getDrivePickerConfig, importFromDrive } from "@/lib/actions/drive-import";
import { pickDriveFiles } from "@/lib/google-drive/picker";
import { planDriveItem, type PickedDriveFile } from "@/lib/google-drive/import-plan";
import { formatBytes } from "@/lib/response-assets/files";
import { ASSET_KIND_LABEL } from "@/lib/response-assets/kind";

/** Lo mismo que acepta el servidor por tanda (lib/actions/drive-import.ts). */
const MAX_ITEMS = 20;

interface Row {
  file: PickedDriveFile;
  mode: "file" | "link";
  name: string;
  description: string;
  /** Despues de importar: lo que paso con este. */
  result?: { ok: true } | { ok: false; error: string };
}

/**
 * «Importar de Drive» en Recursos (00374).
 *
 * Primero el selector de Google (su propia ventana, encima de todo), despues
 * una revision: archivo por archivo se elige si se guarda como archivo o como
 * enlace, con su nombre y su descripcion (la descripcion es obligatoria en
 * Recursos: es lo que lee el agente para saber si el recurso sirve).
 *
 * Si Drive no esta conectado, o faltan la API key y el numero del proyecto, el
 * boton igual se ve y explica que falta: quien administra Integraciones tiene
 * el link para resolverlo.
 */
export function DriveImportButton({ canConfigure }: { canConfigure: boolean }) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<{ error: string; needsSetup: boolean } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  async function open() {
    setProblem(null);
    setOpening(true);
    try {
      const config = await getDrivePickerConfig();
      if (!config.ok) {
        setProblem({ error: config.error, needsSetup: Boolean(config.needsSetup) });
        return;
      }
      const picked = await pickDriveFiles({ ...config, maxItems: MAX_ITEMS });
      if (picked.length === 0) return;
      setRows(
        picked.map((file) => ({
          file,
          mode: planDriveItem(file).canCopy ? "file" : "link",
          name: stripExtension(file.name),
          description: "",
        })),
      );
    } catch (err) {
      setProblem({ error: err instanceof Error ? err.message : "No pude abrir Google Drive", needsSetup: false });
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        {opening ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudDownload className="h-4 w-4" aria-hidden />}
        <span className="hidden sm:inline">Importar de Drive</span>
        <span className="sr-only sm:hidden">Importar de Drive</span>
      </button>

      {problem && (
        <Modal title="Importar de Google Drive" onClose={() => setProblem(null)}>
          <p className="text-sm">{problem.error}</p>
          {problem.needsSetup &&
            (canConfigure ? (
              <Link
                href="/dashboard/settings/integrations/google?tab=cuentas"
                className="inline-flex h-9 w-fit items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
              >
                Ir a Integraciones → Google
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground">Pedíselo a quien administra las integraciones del negocio.</p>
            ))}
        </Modal>
      )}

      {rows && (
        <ReviewDialog
          rows={rows}
          onChange={setRows}
          onClose={() => setRows(null)}
          onDone={() => {
            setRows(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ReviewDialog({
  rows,
  onChange,
  onClose,
  onDone,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pendingRows = rows.filter((r) => !r.result?.ok);
  const update = (index: number, patch: Partial<Row>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function submit() {
    setError(null);
    const missing = pendingRows.find((r) => !r.name.trim() || !r.description.trim());
    if (missing) {
      setError("Cada recurso necesita un nombre y una descripción.");
      return;
    }
    start(async () => {
      const outcome = await importFromDrive(
        pendingRows.map((r) => ({ fileId: r.file.id, mode: r.mode, name: r.name.trim(), description: r.description.trim() })),
      );
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      const byId = new Map(outcome.results.map((r) => [r.fileId, r]));
      const next = rows.map((row) => {
        const r = byId.get(row.file.id);
        if (!r) return row;
        return { ...row, result: r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const) };
      });
      if (next.every((r) => r.result?.ok)) {
        onDone();
        return;
      }
      onChange(next);
      // Lo que sí entró ya se ve en la lista de atrás.
      router.refresh();
    });
  }

  const done = rows.filter((r) => r.result?.ok).length;

  return (
    <Modal title={`Importar de Google Drive (${rows.length})`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        <strong>Como archivo</strong> se guarda una copia en el sistema: se manda por WhatsApp o email como cualquier
        recurso y sigue andando aunque lo borren de Drive. Docs, Sheets y Slides se guardan en PDF.{" "}
        <strong>Como enlace</strong> se guarda el link de Drive: abre solo para quien tenga acceso al archivo en Drive.
      </p>

      <ul className="space-y-3">
        {rows.map((row, index) => {
          const plan = planDriveItem(row.file);
          const imported = row.result?.ok;
          return (
            <li key={row.file.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-muted-foreground" title={row.file.name}>
                  {row.file.name}
                  {row.file.sizeBytes ? ` · ${formatBytes(row.file.sizeBytes)}` : ""}
                </p>
                {imported ? (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Importado</span>
                ) : (
                  <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" role="radiogroup" aria-label="Cómo se guarda">
                    <ModeButton
                      active={row.mode === "file"}
                      disabled={!plan.canCopy}
                      onClick={() => update(index, { mode: "file" })}
                      label={plan.canCopy ? `Como archivo (${ASSET_KIND_LABEL[plan.kind].toLowerCase()})` : "Como archivo"}
                    />
                    <ModeButton active={row.mode === "link"} onClick={() => update(index, { mode: "link" })} label="Como enlace" />
                  </div>
                )}
              </div>

              {!plan.canCopy && !imported && <p className="mt-1 text-[11px] text-muted-foreground">{plan.reason}</p>}

              {!imported && (
                <div className="mt-2 grid gap-2">
                  <input
                    value={row.name}
                    onChange={(e) => update(index, { name: e.target.value })}
                    placeholder="Nombre del recurso"
                    aria-label="Nombre del recurso"
                    className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                  />
                  <textarea
                    value={row.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    placeholder="Qué es y cuándo conviene mandarlo"
                    aria-label="Descripción"
                    rows={2}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}

              {row.result && !row.result.ok && (
                <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
                  {row.result.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {done > 0 && <span className="mr-auto text-xs text-muted-foreground">{done} importado(s)</span>}
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-3 text-sm">
          {done > 0 ? "Cerrar" : "Cancelar"}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || pendingRows.length === 0}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {pending ? "Importando…" : done > 0 ? "Reintentar los que faltan" : "Importar"}
        </button>
      </div>
    </Modal>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drive-import-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-5 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <h2 id="drive-import-title" className="flex-1 text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** "Propuesta 2026.pdf" → "Propuesta 2026": el nombre del recurso no necesita la extensión. */
function stripExtension(name: string): string {
  const cleaned = name.replace(/\.[A-Za-z0-9]{2,5}$/, "").trim();
  return cleaned || name;
}
