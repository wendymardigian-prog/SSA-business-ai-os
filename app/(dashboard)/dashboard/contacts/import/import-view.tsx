"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { parseCsv } from "@/lib/csv/parse";
import { suggestMapping, type ColumnMapping, type ImportColumnTarget } from "@/lib/csv/map";
import { CONTACT_FIELDS } from "@/lib/contacts/fields";
import { startImport, importBatch, finishImport } from "@/lib/actions/csv-import";
import { IMPORT_BATCH_SIZE, MAX_IMPORT_ROWS, MAX_IMPORT_BYTES } from "@/lib/csv/limits";
import { ActionError } from "@/components/contacts/ui";

/**
 * Importacion de CSV en cuatro pasos: archivo, mapeo, opciones y resultado.
 *
 * El archivo se lee y se parsea acá. El servidor recibe las filas en tandas, y
 * eso es lo que da la barra de progreso sin necesidad de una tabla de trabajos
 * ni de andar preguntando cada dos segundos como viene.
 */

type Step = "upload" | "map" | "running" | "done";

interface Resultado {
  imported: number;
  updated: number;
  errors: number;
  details: { line: number; error: string }[];
}

const PREVIEW_ROWS = 5;

/** Las opciones del desplegable de cada columna. */
const TARGET_OPTIONS: { value: ImportColumnTarget; label: string }[] = [
  { value: "", label: "No importar" },
  ...CONTACT_FIELDS.filter((f) => f.key !== "ai_conversation_summary").map((f) => ({
    value: f.key as ImportColumnTarget,
    label: f.label,
  })),
  { value: "tags", label: "Tags" },
];

export function ImportView({
  tags,
  members,
}: {
  tags: string[];
  members: { userId: string; label: string }[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);

  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping[]>([]);
  const [truncated, setTruncated] = useState(0);

  const [setterId, setSetterId] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Resultado | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (file.size > MAX_IMPORT_BYTES) {
      setError(
        `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo son ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }

    const text = await file.text();
    const parsed = parseCsv(text, { maxRows: MAX_IMPORT_ROWS });

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("No encontré filas para importar. ¿El archivo tiene una fila de encabezados y al menos un contacto?");
      return;
    }

    setFileName(file.name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(suggestMapping(parsed.headers));
    setTruncated(parsed.truncated);
    setStep("map");
  }

  function setTarget(index: number, target: ImportColumnTarget) {
    setMapping((prev) =>
      prev.map((m, i) => {
        if (i === index) return { ...m, target };
        // Dos columnas al mismo campo no tiene sentido: la anterior se libera.
        if (target && m.target === target) return { ...m, target: "" as ImportColumnTarget };
        return m;
      }),
    );
  }

  const mapeaAlgo = mapping.some((m) => m.target);

  async function run() {
    setError(null);
    setStep("running");
    setProgress(0);

    const inicio = await startImport(fileName, rows.length);
    if (!inicio.ok) {
      setError(inicio.error);
      setStep("map");
      return;
    }

    const acumulado: Resultado = { imported: 0, updated: 0, errors: 0, details: [] };
    const tandas = Math.ceil(rows.length / IMPORT_BATCH_SIZE);

    for (let t = 0; t < tandas; t++) {
      const offset = t * IMPORT_BATCH_SIZE;
      const tanda = rows.slice(offset, offset + IMPORT_BATCH_SIZE);

      const res = await importBatch({
        importId: inicio.importId,
        rows: tanda,
        mapping,
        offset,
        setterId: setterId || null,
        vendedorId: vendedorId || null,
        extraTags,
      });

      if (!res.ok) {
        setError(`${res.error} Se importaron ${acumulado.imported + acumulado.updated} contactos antes de cortar.`);
        break;
      }

      acumulado.imported += res.counters.imported;
      acumulado.updated += res.counters.updated;
      acumulado.errors += res.counters.errors;
      acumulado.details.push(...res.counters.details);
      setProgress(Math.round(((t + 1) / tandas) * 100));
    }

    await finishImport(inicio.importId);
    setResult(acumulado);
    setStep("done");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border px-8 py-6">
        <Link
          href="/dashboard/contacts"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Contactos
        </Link>
        <h1 className="text-xl font-semibold">Importar contactos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Desde un archivo CSV. Si un contacto ya existe con el mismo email o teléfono, se
          completan sus datos vacíos en vez de duplicarlo.
        </p>
        {error && <div className="mt-4 max-w-2xl"><ActionError message={error} /></div>}
      </div>

      <div className="flex-1 px-8 py-6">
        {step === "upload" && <UploadStep onFile={handleFile} />}

        {step === "map" && (
          <MapStep
            fileName={fileName}
            headers={headers}
            rows={rows}
            mapping={mapping}
            truncated={truncated}
            onTarget={setTarget}
            members={members}
            tags={tags}
            setterId={setterId}
            vendedorId={vendedorId}
            extraTags={extraTags}
            newTag={newTag}
            onSetter={setSetterId}
            onVendedor={setVendedorId}
            onNewTag={setNewTag}
            onAddTag={() => {
              const t = newTag.trim();
              if (t && !extraTags.includes(t)) setExtraTags((prev) => [...prev, t]);
              setNewTag("");
            }}
            onRemoveTag={(t) => setExtraTags((prev) => prev.filter((x) => x !== t))}
            canRun={mapeaAlgo}
            onRun={run}
            onBack={() => { setStep("upload"); setError(null); }}
          />
        )}

        {step === "running" && <RunningStep total={rows.length} progress={progress} />}

        {step === "done" && result && <DoneStep result={result} fileName={fileName} />}
      </div>
    </div>
  );
}

function UploadStep({ onFile }: { onFile: (f: File | undefined) => void }) {
  return (
    <label className="flex max-w-2xl cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border px-6 py-16 text-center transition-colors hover:bg-accent/40">
      <Upload className="h-8 w-8 text-muted-foreground/60" />
      <span className="text-sm font-medium">Elegí un archivo CSV</span>
      <span className="max-w-sm text-xs text-muted-foreground">
        Hasta {MAX_IMPORT_BYTES / 1024 / 1024} MB y {MAX_IMPORT_ROWS.toLocaleString("es-AR")} filas.
        La primera fila tiene que ser la de los nombres de columna.
      </span>
      <input
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </label>
  );
}

function MapStep({
  fileName, headers, rows, mapping, truncated, onTarget,
  members, tags, setterId, vendedorId, extraTags, newTag,
  onSetter, onVendedor, onNewTag, onAddTag, onRemoveTag,
  canRun, onRun, onBack,
}: {
  fileName: string;
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping[];
  truncated: number;
  onTarget: (index: number, target: ImportColumnTarget) => void;
  members: { userId: string; label: string }[];
  tags: string[];
  setterId: string;
  vendedorId: string;
  extraTags: string[];
  newTag: string;
  onSetter: (v: string) => void;
  onVendedor: (v: string) => void;
  onNewTag: (v: string) => void;
  onAddTag: () => void;
  onRemoveTag: (t: string) => void;
  canRun: boolean;
  onRun: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{fileName}</span>
        <span className="text-muted-foreground">
          · {rows.length.toLocaleString("es-AR")} {rows.length === 1 ? "fila" : "filas"}
        </span>
        {truncated > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Se dejaron afuera {truncated.toLocaleString("es-AR")} filas por el límite
          </span>
        )}
      </div>

      <section>
        <h2 className="text-sm font-semibold">Mapeo de columnas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Revisá a qué campo va cada columna. Las que no reconocí quedan sin importar.
        </p>

        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                {headers.map((header, i) => (
                  <th key={`${header}-${i}`} className="min-w-44 px-3 py-2 align-top">
                    <span className="block truncate text-xs font-medium text-muted-foreground" title={header}>
                      {header || `(columna ${i + 1})`}
                    </span>
                    <select
                      value={mapping[i]?.target ?? ""}
                      onChange={(e) => onTarget(i, e.target.value as ImportColumnTarget)}
                      aria-label={`Campo para la columna ${header || i + 1}`}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {TARGET_OPTIONS.map((o) => (
                        <option key={o.value || "none"} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                <tr key={r} className="border-b border-border last:border-0">
                  {headers.map((_, c) => (
                    <td key={c} className="max-w-52 truncate px-3 py-2 text-xs text-muted-foreground">
                      {row[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground/70">
          Vista previa de las primeras {Math.min(PREVIEW_ROWS, rows.length)} filas.
        </p>
      </section>

      <section className="max-w-2xl">
        <h2 className="text-sm font-semibold">Para todos los importados</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Opcional. Si el contacto ya tiene setter o vendedor, no se le cambia.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="imp-setter" className="mb-1 block text-xs font-medium text-muted-foreground">
              Setter
            </label>
            <select
              id="imp-setter"
              value={setterId}
              onChange={(e) => onSetter(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Sin asignar</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="imp-vendedor" className="mb-1 block text-xs font-medium text-muted-foreground">
              Vendedor
            </label>
            <select
              id="imp-vendedor"
              value={vendedorId}
              onChange={(e) => onVendedor(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Sin asignar</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <label htmlFor="imp-tag" className="mb-1 block text-xs font-medium text-muted-foreground">
            Tags
          </label>
          <div className="flex gap-2">
            <input
              id="imp-tag"
              list="tags-existentes"
              value={newTag}
              onChange={(e) => onNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddTag();
                }
              }}
              placeholder="Agregar un tag..."
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <datalist id="tags-existentes">
              {tags.map((t) => <option key={t} value={t} />)}
            </datalist>
            <button
              onClick={onAddTag}
              disabled={!newTag.trim()}
              className="rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Agregar
            </button>
          </div>

          {extraTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {extraTags.map((t) => (
                <button
                  key={t}
                  onClick={() => onRemoveTag(t)}
                  className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs hover:bg-accent"
                >
                  {t} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
        >
          Elegir otro archivo
        </button>
        <button
          onClick={onRun}
          disabled={!canRun}
          title={canRun ? undefined : "Mapeá al menos una columna"}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Importar {rows.length.toLocaleString("es-AR")} {rows.length === 1 ? "fila" : "filas"}
        </button>
      </div>
    </div>
  );
}

function RunningStep({ total, progress }: { total: number; progress: number }) {
  return (
    <div className="max-w-md">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        Importando {total.toLocaleString("es-AR")} filas...
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {progress}% · No cierres la pestaña hasta que termine.
      </p>
    </div>
  );
}

function DoneStep({ result, fileName }: { result: Resultado; fileName: string }) {
  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <h2 className="text-sm font-semibold">Importación terminada</h2>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Counter label="Nuevos" value={result.imported} />
        <Counter label="Actualizados" value={result.updated} />
        <Counter label="Con error" value={result.errors} destacar={result.errors > 0} />
      </div>

      {result.details.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground">
            Filas que no se pudieron importar
          </h3>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {result.details.map((d, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="w-24 px-3 py-1.5 text-xs text-muted-foreground">Fila {d.line}</td>
                    <td className="px-3 py-1.5 text-xs">{d.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground/70">
            Los números de fila son los de {fileName}, contando la fila de encabezados.
            Corregilas ahí y volvé a subir solo esas.
          </p>
        </section>
      )}

      <Link
        href="/dashboard/contacts"
        className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Ver los contactos
      </Link>
    </div>
  );
}

function Counter({ label, value, destacar }: { label: string; value: number; destacar?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className={`text-2xl font-semibold ${destacar ? "text-destructive" : ""}`}>
        {value.toLocaleString("es-AR")}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
