"use client";

/**
 * Contenido › Ideas con la tabla común del sistema: columnas que se ocultan y ensanchan (se recuerdan por persona).
 * Lo que espera una decisión primero; dentro de cada estado, lo más nuevo arriba. En el celular, tarjetas.
 */
import Link from "next/link";
import { useMemo } from "react";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import { ColumnsMenu } from "@/components/ui/data-table/columns-menu";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";
import { sortIdeaRows, type IdeaListRow, type IdeaTone } from "@/lib/content/ideas-list";

export const IDEAS_TABLE_KEY = "content_ideas";

const META = [
  { key: "title", label: "Idea", defaultWidth: 280, hideable: false },
  { key: "status", label: "Estado", defaultWidth: 120 },
  { key: "pieces", label: "Pieza", defaultWidth: 220 },
  { key: "origin", label: "De dónde salió", defaultWidth: 240 },
  { key: "date", label: "Fecha", defaultWidth: 120 },
] as const;

const TONE_CLASS: Record<IdeaTone, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  yellow: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  red: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
};

/** La fila entera abre la primera pieza o, si todavía no tiene, la idea. */
const ideaHref = (r: IdeaListRow) => `/dashboard/content?${r.pieces[0] ? `piece=${r.pieces[0].id}` : `idea=${r.id}`}`;

export function IdeasTable({ rows, timeZone }: { rows: IdeaListRow[]; timeZone: string }) {
  const prefs = useTablePrefs(IDEAS_TABLE_KEY, "base", META, null);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone }), [timeZone]);
  const sorted = useMemo(() => sortIdeaRows(sortIdeaRows(rows, "date", "desc"), "status", "asc"), [rows]);

  const columns: DataColumn<IdeaListRow>[] = useMemo(
    () => [
      { ...META[0], cellClassName: "font-medium", render: (r) => r.title },
      { ...META[1], render: (r) => <IdeaStatusPill row={r} /> },
      { ...META[2], render: (r) => <IdeaPieces row={r} /> },
      { ...META[3], render: (r) => <IdeaOrigin row={r} dateFmt={dateFmt} /> },
      { ...META[4], cellClassName: "whitespace-nowrap text-muted-foreground tabular-nums", render: (r) => dateFmt.format(new Date(r.date)) },
    ],
    [dateFmt],
  );

  return (
    <>
      <div className="hidden space-y-2 md:block">
        <div className="flex justify-end">
          <ColumnsMenu state={prefs} />
        </div>
        <DataTable caption="Ideas de contenido" columns={columns} rows={sorted} rowKey={(r) => r.id} state={prefs} rowHref={ideaHref} />
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card md:hidden">
        {sorted.map((row) => (
          <li key={row.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words font-medium">{row.title}</p>
              <IdeaStatusPill row={row} />
            </div>
            <IdeaPieces row={row} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <IdeaOrigin row={row} dateFmt={dateFmt} />
              <span>{dateFmt.format(new Date(row.date))}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function IdeaStatusPill({ row }: { row: IdeaListRow }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[row.tone]}`} title={row.discardedReason ?? undefined}>
      {row.statusLabel}
    </span>
  );
}

function IdeaPieces({ row }: { row: IdeaListRow }) {
  if (row.pieces.length === 0) return <span className="text-xs text-muted-foreground">{row.status === "aprobada" ? "Sin pieza" : "—"}</span>;
  return (
    <ul className="space-y-1">
      {row.pieces.map((p) => (
        <li key={p.id} className="text-xs">
          <Link href={`/dashboard/content?piece=${p.id}`} className="font-medium text-primary-ink hover:underline">
            {p.title}
          </Link>{" "}
          <span className="text-muted-foreground">· {p.statusLabel}</span>
        </li>
      ))}
    </ul>
  );
}

function IdeaOrigin({ row, dateFmt }: { row: IdeaListRow; dateFmt: Intl.DateTimeFormat }) {
  const o = row.origin;
  if (o.kind !== "call" || !o.visible) return <span className="text-xs text-muted-foreground">{o.label}</span>;
  const when = o.recordedAt ? ` · ${dateFmt.format(new Date(o.recordedAt))}` : "";
  return (
    <Link href={`/dashboard/llamadas/${o.callId}`} className="text-xs font-medium text-primary-ink hover:underline">
      Grabación: {o.label}
      {when}
    </Link>
  );
}
