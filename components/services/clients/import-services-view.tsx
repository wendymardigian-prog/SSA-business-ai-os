// @plantilla-quitar(servicios)
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { importServices, type ImportPreviewRow } from "@/lib/actions/services";
import { IMPORT_COLUMNS } from "@/lib/services/import";
import { ActionError } from "@/components/contacts/ui";
import { PageHeader } from "@/components/page-header";

/**
 * Clientes › Importar servicios (F99): pegar o subir un CSV, revisar fila por fila y recién ahí crear. Volver a
 * importar el mismo archivo no duplica (cada fila tiene su clave).
 */
export function ImportServicesView() {
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<ImportPreviewRow[] | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ok = rows?.filter((r) => r.problems.length === 0 && !r.duplicate).length ?? 0;

  function run(commit: boolean) {
    setError(null);
    start(async () => {
      const res = await importServices(csv, commit);
      if (!res.ok) {
        setError(res.missingColumns.length ? `Faltan columnas: ${res.missingColumns.join(", ")}` : res.error ?? "No se pudo leer el archivo");
        return;
      }
      setRows(res.rows);
      if (commit) setCreated(res.created);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Importar servicios"
        tooltip="Carga inicial de los servicios que ya existían antes del sistema."
        backHref={
          <Link href="/dashboard/clientes" aria-label="Volver a Clientes" className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-8">
          <p className="text-sm text-muted-foreground">Columnas: {IMPORT_COLUMNS.join(", ")}. Una fila por servicio. Los servicios nacen con origen «Manual» y el motivo «Carga inicial».</p>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent">
            <Upload className="h-4 w-4" aria-hidden />
            Subir un CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
          </label>
          <label htmlFor="import-csv" className="block text-xs font-semibold">
            O pegalo acá
          </label>
          <textarea id="import-csv" value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs" />
          <div className="flex gap-2">
            <button type="button" disabled={pending || !csv.trim()} onClick={() => run(false)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-50">
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Revisar
            </button>
            {rows && ok > 0 && created === null && (
              <button type="button" disabled={pending} onClick={() => run(true)} className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                Crear {ok} {ok === 1 ? "servicio" : "servicios"}
              </button>
            )}
          </div>
          {error && <ActionError message={error} />}
          {created !== null && <p className="text-sm text-good">Listo: se crearon {created} servicios.</p>}
          {rows && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Fila</th>
                    <th className="px-3 py-2 font-medium">Contacto</th>
                    <th className="px-3 py-2 font-medium">Producto · variante</th>
                    <th className="px-3 py-2 font-medium">Inicio</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                      <td className="px-3 py-2">{r.contact}</td>
                      <td className="px-3 py-2">
                        {r.product} · {r.variant}
                      </td>
                      <td className="px-3 py-2">{r.startsOn}</td>
                      <td className="px-3 py-2">{r.duplicate ? <span className="text-muted-foreground">Ya importado</span> : r.problems.length ? <span className="text-destructive">{r.problems.join(" · ")}</span> : <span className="text-good">Listo</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
