"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { parseCsv } from "@/lib/csv/parse";
import {
  ATTRIBUTION_TARGETS,
  ATTRIBUTION_TARGET_LABELS,
  customTarget,
  mapRow,
  suggestMapping,
  type ColumnMapping,
  type ImportColumnTarget,
  type ImportCustomField,
} from "@/lib/csv/map";
import {
  consolidateSubscriptions,
  subscriptionTotals,
  SUBSCRIPTION_TARGETS,
  SUBSCRIPTION_TARGET_LABELS,
  type RowSubscription,
  type SubscriptionOutcome,
  type SubscriptionTotals,
} from "@/lib/csv/subscription";
import { CUSTOM_FIELD_TYPE_LABELS, isCustomFieldType } from "@/lib/custom-fields";
import { CONTACT_FIELDS } from "@/lib/contacts/fields";
import { startImport, importBatch, finishImport, previewBatch } from "@/lib/actions/csv-import";
import { IMPORT_BATCH_SIZE, MAX_IMPORT_ROWS, MAX_IMPORT_BYTES } from "@/lib/csv/limits";
import { ActionError } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";

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
  linkedBy: { phone: number; email: number; social: number };
  skippedConflicts: number;
  errors: number;
  details: { line: number; error: string }[];
  /** Suscripcion a emails (E6): por persona. `null` si el archivo no trae la columna de suscripcion. */
  subscription: SubscriptionTotals | null;
  /** Filas que repetian un email y se juntaron con otra. */
  consolidated: number;
}

const PREVIEW_ROWS = 5;

/** Las opciones fijas del desplegable de cada columna (los datos del contacto). */
const CONTACT_OPTIONS: { value: ImportColumnTarget; label: string }[] = [
  ...CONTACT_FIELDS.filter((f) => f.key !== "ai_conversation_summary").map((f) => ({
    value: f.key as ImportColumnTarget,
    label: f.label,
  })),
  { value: "tags", label: "Tags" },
];

/** La atribución es opcional: sin estas columnas, el contacto nuevo queda como "Importación". */
const ATTRIBUTION_OPTIONS: { value: ImportColumnTarget; label: string }[] = ATTRIBUTION_TARGETS.map((t) => ({
  value: t,
  label: ATTRIBUTION_TARGET_LABELS[t],
}));

/** La suscripcion a emails que traia la persona en el otro sistema (E6). */
const SUBSCRIPTION_OPTIONS: { value: ImportColumnTarget; label: string }[] = SUBSCRIPTION_TARGETS.map((t) => ({
  value: t,
  label: SUBSCRIPTION_TARGET_LABELS[t],
}));

export function ImportView({
  tags,
  members,
  customFields = [],
}: {
  tags: string[];
  members: { userId: string; label: string }[];
  /** Los campos personalizados vivos del workspace: cada uno es un destino posible. */
  customFields?: ImportCustomField[];
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

  const [origin, setOrigin] = useState("");

  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Resultado | null>(null);
  // "Revisar antes de importar": el mismo recorrido sin escribir, y el resumen de lo que pasaria.
  const [preview, setPreview] = useState<Resultado | null>(null);
  const [previewing, setPreviewing] = useState(false);

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
    setMapping(suggestMapping(parsed.headers, customFields));
    setTruncated(parsed.truncated);
    setPreview(null);
    setStep("map");
  }

  function setTarget(index: number, target: ImportColumnTarget) {
    setPreview(null);
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

  /**
   * Lo consolidado de TODO el archivo por email (el servidor ve una tanda por vez): si una persona aparece dada de
   * baja en alguna fila, queda dada de baja. Se valida igual que en el servidor.
   */
  function consolidate(): { byEmail: Record<string, RowSubscription>; consolidatedRows: number } {
    const today = new Date().toISOString().slice(0, 10);
    const refs = rows.flatMap((values, i) => {
      const r = mapRow(values, mapping, i, customFields, today);
      return r.ok ? [{ line: r.row.line, email: r.row.patch.email ?? r.row.patch.secondary_email ?? null, subscription: r.row.subscription }] : [];
    });
    return consolidateSubscriptions(refs);
  }

  /** Lo consolidado que le toca a una tanda: solo los emails que aparecen en ella. */
  function subscriptionsFor(tanda: string[][], byEmail: Record<string, RowSubscription>): Record<string, RowSubscription> {
    const columns = mapping.flatMap((m, i) => (m.target === "email" || m.target === "secondary_email" ? [i] : []));
    const out: Record<string, RowSubscription> = {};
    for (const row of tanda) {
      for (const i of columns) {
        const email = (row[i] ?? "").trim().toLowerCase();
        if (email && byEmail[email]) out[email] = byEmail[email];
      }
    }
    return out;
  }

  /**
   * Recorre el archivo en tandas. `preview`: la prueba en seco (no escribe nada); si no, la importacion. Las dos
   * usan la misma logica del servidor, asi el resumen de la prueba es lo que va a pasar.
   */
  async function walk(kind: "preview" | "import", importId?: string): Promise<Resultado | null> {
    const { byEmail, consolidatedRows } = consolidate();
    const tieneSuscripcion = mapping.some((m) => m.target === "sub:status");
    const acumulado: Resultado = {
      imported: 0, updated: 0, linkedBy: { phone: 0, email: 0, social: 0 }, skippedConflicts: 0, errors: 0, details: [],
      subscription: null, consolidated: tieneSuscripcion ? consolidatedRows : 0,
    };
    const outcomes: SubscriptionOutcome[] = [];
    let planned: Record<string, string> = {};
    const tandas = Math.ceil(rows.length / IMPORT_BATCH_SIZE);

    for (let t = 0; t < tandas; t++) {
      const offset = t * IMPORT_BATCH_SIZE;
      const tanda = rows.slice(offset, offset + IMPORT_BATCH_SIZE);
      const base = {
        rows: tanda,
        mapping,
        offset,
        setterId: setterId || null,
        vendedorId: vendedorId || null,
        extraTags,
        origin: origin.trim() || null,
        subscriptions: subscriptionsFor(tanda, byEmail),
      };
      const res = kind === "preview" ? await previewBatch({ ...base, fileName, planned }) : await importBatch({ ...base, importId: importId ?? "" });

      if (!res.ok) {
        setError(
          kind === "preview"
            ? `${res.error} No se pudo terminar la revisión.`
            : `${res.error} Se importaron ${acumulado.imported + acumulado.updated} contactos antes de cortar.`,
        );
        return kind === "preview" ? null : acumulado;
      }

      acumulado.imported += res.counters.imported;
      acumulado.updated += res.counters.updated;
      acumulado.linkedBy.phone += res.counters.linkedBy.phone;
      acumulado.linkedBy.email += res.counters.linkedBy.email;
      acumulado.linkedBy.social += res.counters.linkedBy.social;
      acumulado.skippedConflicts += res.counters.skippedConflicts;
      acumulado.errors += res.counters.errors;
      acumulado.details.push(...res.counters.details);
      outcomes.push(...res.subscription);
      if (res.planned) planned = res.planned;
      if (kind === "import") setProgress(Math.round(((t + 1) / tandas) * 100));
    }

    acumulado.subscription = tieneSuscripcion ? subscriptionTotals(outcomes) : null;
    return acumulado;
  }

  async function review() {
    setError(null);
    setPreviewing(true);
    setPreview(null);
    const resumen = await walk("preview");
    setPreviewing(false);
    if (resumen) setPreview(resumen);
  }

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

    const acumulado = await walk("import", inicio.importId);

    await finishImport(inicio.importId);
    if (acumulado) setResult(acumulado);
    setStep("done");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <PageHeader
        route="/dashboard/contacts/import"
        backHref={
          <Link
            href="/dashboard/contacts"
            aria-label="Volver a Contactos"
            className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      {error && <div className="px-4 pt-4 md:px-8"><ActionError message={error} /></div>}

      <div className="flex-1 px-8 py-6">
        {step === "upload" && <UploadStep onFile={handleFile} />}

        {step === "map" && (
          <MapStep
            customFields={customFields}
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
            origin={origin}
            onOrigin={(v) => { setOrigin(v); setPreview(null); }}
            onReview={review}
            previewing={previewing}
            preview={preview}
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
  canRun, onRun, onBack, customFields,
  origin, onOrigin, onReview, previewing, preview,
}: {
  customFields: ImportCustomField[];
  origin: string;
  onOrigin: (v: string) => void;
  onReview: () => void;
  previewing: boolean;
  preview: Resultado | null;
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
        <p className="mt-1 text-xs text-muted-foreground">
          Los contactos nuevos quedan con origen <strong>Importación</strong>. Si la planilla dice de dónde vino cada
          persona (fuente, medio, campaña o la fecha del primer contacto), mapealo en «Atribución» y se guarda con ese dato.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Si viene de otro sistema con la <strong>suscripción a emails</strong> (quién se dio de baja, rebotó o marcó spam),
          mapeala en «Suscripción a emails»: nadie que se haya dado de baja vuelve a quedar suscripto. Sin esa columna, los
          nuevos quedan suscriptos y los que ya existían no cambian.
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
                      <option value="">No importar</option>
                      <optgroup label="Datos del contacto">
                        {CONTACT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
                      {customFields.length > 0 && (
                        <optgroup label="Campos personalizados">
                          {customFields.map((f) => (
                            <option key={f.id} value={customTarget(f.id)}>
                              {f.name} ({isCustomFieldType(f.type) ? CUSTOM_FIELD_TYPE_LABELS[f.type] : f.type})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Atribución (opcional)">
                        {ATTRIBUTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Suscripción a emails (opcional)">
                        {SUBSCRIPTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </optgroup>
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

        <div className="mt-3">
          <label htmlFor="imp-origin" className="mb-1 block text-xs font-medium text-muted-foreground">
            Origen de la importación
          </label>
          <input
            id="imp-origin"
            value={origin}
            onChange={(e) => onOrigin(e.target.value)}
            placeholder="Por ejemplo: mi-web"
            maxLength={40}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Queda en el historial de cada contacto y como etiqueta «origen:…». Sin escribir nada, se usa el nombre del archivo.
          </p>
        </div>
      </section>

      {preview && (
        <section className="max-w-2xl rounded-xl border border-border bg-muted/30 p-4">
          <h2 className="text-sm font-semibold">Revisión: esto es lo que va a pasar</h2>
          <p className="mt-1 text-xs text-muted-foreground">Todavía no se escribió nada. «Importar» hace exactamente esto.</p>
          <div className="mt-3">
            <Summary result={preview} future />
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onBack}
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
        >
          Elegir otro archivo
        </button>
        <button
          onClick={onReview}
          disabled={!canRun || previewing}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {previewing && <Loader2 className="h-4 w-4 animate-spin" />}
          Revisar antes de importar
        </button>
        <button
          onClick={onRun}
          disabled={!canRun || previewing}
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

      <Summary result={result} />

      {result.details.length > 0 && (
        <p className="text-xs text-muted-foreground/70">
          Los números de fila son los de {fileName}, contando la fila de encabezados. Corregilas ahí y volvé a subir solo esas.
        </p>
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

/**
 * El resumen de una importacion o de su revision (los mismos numeros: `future` cambia solo el tiempo verbal).
 * La suscripcion se cuenta por persona: tres filas de la misma persona son una.
 */
function Summary({ result, future = false }: { result: Resultado; future?: boolean }) {
  const s = result.subscription;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Counter label={future ? "Se crearían" : "Nuevos"} value={result.imported} />
        <Counter label={future ? "Se vincularían" : "Actualizados"} value={result.updated} />
        <Counter label="Con error" value={result.errors} destacar={result.errors > 0} />
      </div>

      {result.updated > 0 && (
        <p className="text-xs text-muted-foreground">
          {future ? "Se vincularían" : "Vinculadas"} a un contacto que ya existía: {result.updated.toLocaleString("es-AR")} (por teléfono{" "}
          {result.linkedBy.phone.toLocaleString("es-AR")}, por email {result.linkedBy.email.toLocaleString("es-AR")}, por usuario de red{" "}
          {result.linkedBy.social.toLocaleString("es-AR")}).
          {result.skippedConflicts > 0 &&
            ` ${result.skippedConflicts.toLocaleString("es-AR")} dato(s) de la planilla no se ${future ? "escribirían" : "escribieron"} porque ya son de otro contacto.`}
        </p>
      )}

      {s && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground">Suscripción a emails (por persona)</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Counter label="Suscriptos" value={s.subscribed} />
            <Counter label="Dados de baja" value={s.unsubscribed} />
            <Counter label="Rebotan" value={s.bounced} />
            <Counter label="Marcaron spam" value={s.complained} />
          </div>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {s.notResubscribed > 0 && (
              <li>
                {s.notResubscribed.toLocaleString("es-AR")} {s.notResubscribed === 1 ? "contacto" : "contactos"} que el archivo decía
                «suscripto» {future ? "seguirían" : "siguen"} dados de baja: la baja gana.
              </li>
            )}
            {result.consolidated > 0 && (
              <li>
                {result.consolidated.toLocaleString("es-AR")} {result.consolidated === 1 ? "fila repetía" : "filas repetían"} un email y se
                {result.consolidated === 1 ? " juntó" : " juntaron"} con otra (gana el estado más grave).
              </li>
            )}
          </ul>
        </section>
      )}

      {result.details.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-muted-foreground">
            Filas que no se {future ? "podrían" : "pudieron"} importar
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
        </section>
      )}
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
