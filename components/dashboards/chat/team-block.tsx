"use client";

import { Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/tooltip";
import { EmptyBlock, Panel } from "./block";
import { Avatar } from "./filters/filter-menu";
import { formatCount, formatDuration } from "@/lib/dashboards/chat/comparisons";
import { filterValueFor, timeTone, type TeamRow } from "@/lib/dashboards/chat/team-rows";

/**
 * "Quién responde" (F18).
 *
 * Tocar una fila filtra todo el dashboard por ese autor, y tocarla de nuevo lo
 * saca. Una fila que no se puede filtrar (un autor que el SQL no reconoce) no es
 * clickeable: antes filtraba por un valor invalido y la pantalla quedaba vacia
 * sin explicar por que.
 *
 * El tiempo nunca se distingue solo por color: mas de 1 h lleva reloj ambar y
 * mas de 4 h reloj rojo (accesibilidad, §16).
 */

const TOOLTIPS = {
  first:
    "Mediana entre el primer mensaje del lead y la primera respuesta de esta persona. Para una persona se cuenta desde que la conversación le fue asignada o derivada.",
  reply: "Mediana de todas sus respuestas, contando desde el último mensaje del lead.",
  escalations: "Conversaciones que le derivaron o le asignaron en el período.",
  drafts: "Borradores del agente que aprobó, y qué parte salió sin editar.",
};

export function TeamBlock({
  rows,
  activeAuthor,
  onPick,
}: {
  rows: TeamRow[];
  activeAuthor: string | null;
  onPick: (author: string | null) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyBlock
        icon={<Users className="h-6 w-6" aria-hidden />}
        title="Todavía no respondió nadie"
        text="Cuando salga el primer mensaje, acá vas a ver quién responde, cuánto tarda y cuántas conversaciones toma."
      />
    );
  }

  return (
    <Panel
      footer={
        <>
          <span className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-warn">
              <Clock className="h-3 w-3" aria-hidden />
              más de 1 h
            </span>
            <span className="inline-flex items-center gap-1 text-bad">
              <Clock className="h-3 w-3" aria-hidden />
              más de 4 h
            </span>
          </span>
          <span>En “Fuera del sistema” el tiempo se calcula igual, pero no se sabe quién respondió.</span>
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <caption className="px-[18px] pb-2 pt-3 text-left text-xs text-muted-foreground">
            Tocá una fila para filtrar todo el dashboard por esa persona.
          </caption>
          <thead>
            <tr className="border-b border-border text-[11.5px] font-semibold text-muted-foreground">
              <th scope="col" className="px-[18px] py-2.5 text-left">Quién</th>
              <th scope="col" className="px-3.5 py-2.5 text-right">Conversaciones</th>
              <th scope="col" className="px-3.5 py-2.5 text-right">Mensajes enviados</th>
              <th scope="col" className="px-3.5 py-2.5 text-right">
                <span className="inline-flex items-center gap-1">Primera respuesta <InfoTooltip text={TOOLTIPS.first} label="Cómo se mide la primera respuesta" /></span>
              </th>
              <th scope="col" className="px-3.5 py-2.5 text-right">
                <span className="inline-flex items-center gap-1">Respuesta <InfoTooltip text={TOOLTIPS.reply} label="Cómo se mide la respuesta" /></span>
              </th>
              <th scope="col" className="px-3.5 py-2.5 text-right">Respondidas en menos de 1 h</th>
              <th scope="col" className="px-3.5 py-2.5 text-right">
                <span className="inline-flex items-center gap-1">Derivaciones recibidas <InfoTooltip text={TOOLTIPS.escalations} label="Qué son las derivaciones recibidas" /></span>
              </th>
              <th scope="col" className="px-3.5 py-2.5 text-right">
                <span className="inline-flex items-center gap-1">Borradores aprobados <InfoTooltip text={TOOLTIPS.drafts} label="Qué son los borradores aprobados" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const value = filterValueFor(row);
              const selected = activeAuthor !== null && value === activeAuthor;
              return (
                <tr
                  key={row.author}
                  onClick={value ? () => onPick(selected ? null : value) : undefined}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    value ? "cursor-pointer hover:bg-accent/40" : "",
                    selected && "bg-primary/10",
                  )}
                >
                  <th scope="row" className="px-[18px] py-2.5 text-left font-normal">
                    <span className="flex items-center gap-2.5">
                      <Avatar initials={row.initials} color={row.color} />
                      <span className="min-w-0">
                        <span className="block font-medium">{row.label}</span>
                        <span className="block text-[11.5px] text-muted-foreground">{row.sublabel}</span>
                      </span>
                    </span>
                  </th>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{formatCount(row.conversations)}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">{formatCount(row.messagesOut)}</td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">
                    {row.instant ? <span className="text-muted-foreground">inmediata</span> : <Time seconds={row.firstResponseMedianSeconds} />}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">
                    {row.instant ? <span className="text-muted-foreground">—</span> : <Time seconds={row.replyMedianSeconds} />}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">
                    {row.repliesUnder1hPct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        {row.repliesUnder1hPct} %
                        <span className="inline-block h-1.5 w-[54px] overflow-hidden rounded-[3px] bg-muted align-middle">
                          <span
                            className="block h-full"
                            style={{
                              width: `${row.repliesUnder1hPct}%`,
                              backgroundColor: row.repliesUnder1hPct < 60 ? "var(--warn)" : "var(--c-team)",
                            }}
                          />
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">
                    {row.escalationsReceived === null ? <span className="text-muted-foreground">—</span> : formatCount(row.escalationsReceived)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums">
                    {row.draftsApproved === null || row.draftsApproved === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        {formatCount(row.draftsApproved)}
                        {row.draftsApprovedUneditedPct !== null && (
                          <span className="ml-1 text-muted-foreground">· {row.draftsApprovedUneditedPct} % sin cambios</span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Un tiempo con su reloj cuando pasa el umbral: el color no alcanza solo. */
function Time({ seconds }: { seconds: number | null }) {
  const tone = timeTone(seconds);
  if (seconds === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center justify-end gap-1.5", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>
      {tone !== "ok" && <Clock className="h-3 w-3 shrink-0" aria-hidden />}
      {formatDuration(seconds)}
    </span>
  );
}
