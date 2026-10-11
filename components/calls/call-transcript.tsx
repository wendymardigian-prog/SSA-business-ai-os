"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { isQuotedLine, type TLine } from "@/lib/calls/detail";
import { searchTranscript, transcriptStartLabel } from "@/lib/calls/detail-view";

/**
 * La transcripcion por turnos, con el hablante y el minuto (F13). Las lineas
 * que el analisis cita van resaltadas; la busqueda ignora tildes y mayusculas.
 * Un minuto citado en el analisis lleva a su linea (`jumpTo`).
 */
export function CallTranscript({ lines, quotes, jumpRef }: { lines: TLine[]; quotes: string[]; jumpRef?: React.MutableRefObject<((timestamp: string) => void) | null> }) {
  const [query, setQuery] = useState("");
  const [who, setWho] = useState("all");
  const [onlyQuoted, setOnlyQuoted] = useState(false);
  const refs = useRef<Array<HTMLDivElement | null>>([]);

  const speakers = useMemo(() => [...new Set(lines.map((l) => l.speaker?.display_name || "—"))], [lines]);
  const hits = useMemo(() => new Set(searchTranscript(lines, query)), [lines, query]);
  const quoted = useMemo(() => lines.map((l) => isQuotedLine(l.text, quotes)), [lines, quotes]);

  // El salto a un minuto citado: se registra en un efecto, no al renderizar.
  useEffect(() => {
    if (!jumpRef) return;
    jumpRef.current = (timestamp: string) => {
      const i = lines.findIndex((l) => l.timestamp === timestamp);
      if (i >= 0) refs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    return () => {
      jumpRef.current = null;
    };
  }, [jumpRef, lines]);

  if (lines.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Esta llamada no tiene transcripción.</p>;
  }

  const visible = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l, i }) => (who === "all" || (l.speaker?.display_name || "—") === who) && (!onlyQuoted || quoted[i]));
  const searching = query.trim().length >= 2;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en la transcripción" aria-label="Buscar en la transcripción" className="h-8 w-full rounded-lg border border-input bg-background pl-7 pr-2 text-sm" />
        </div>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filtrar por quién habla" className="h-8 max-w-[10rem] rounded-lg border border-input bg-background px-2 text-sm">
          <option value="all">Todos hablan</option>
          {speakers.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {quotes.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={onlyQuoted} onChange={(e) => setOnlyQuoted(e.target.checked)} /> Solo lo citado
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {searching ? `${hits.size} ${hits.size === 1 ? "coincidencia" : "coincidencias"} · ` : ""}{visible.length} de {lines.length} líneas
      </p>
      <div className="space-y-1.5">
        {visible.map(({ l, i }) => (
          <div
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            className={`rounded px-2 py-1 text-sm ${quoted[i] ? "border-l-2 border-amber-500 bg-amber-500/10" : ""} ${searching && hits.has(i) ? "ring-1 ring-primary" : ""}`}
          >
            <span className="font-medium">{l.speaker?.display_name || "—"}</span>
            {l.timestamp && <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">{transcriptStartLabel(l.timestamp)}</span>}
            <p className="text-muted-foreground">{l.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
