"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, X } from "lucide-react";
import { loadPostAnalysis, type PostAnalysis } from "@/lib/actions/post-analysis";
import { drawerHref } from "@/lib/content/drawer-url";
import { ANALYSIS_METRIC_LABELS, ageLabel, type AnalysisMetric } from "@/lib/dashboards/post-analysis";
import { platformLabel } from "@/lib/platforms";
import { colorFor, DualAxisChart, type ChartSeries } from "./charts";

/**
 * El panel de analisis de un post (F51, F52).
 *
 * Se abre desde la tabla, los puntos de los graficos, la grilla de Social y
 * el detalle de la pieza. Las flechas recorren la misma lista de donde se
 * abrio, y Esc lo cierra: es un panel, no una pantalla.
 *
 * Lo que contesta, en orden: como le fue, como fue creciendo comparado con
 * los del mismo formato, si movio la aguja de seguidores, a quien llego y
 * que le dijeron.
 */
export function PostAnalysisPanel({
  socialPostId,
  onClose,
  onPrevious,
  onNext,
}: {
  socialPostId: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const [metric, setMetric] = useState<AnalysisMetric>("views");
  // Un solo estado con la pregunta que contesta: asi cambiar de post no
  // necesita un `setState` sincronico dentro del efecto para limpiar lo
  // anterior, que dispara un render en cascada. Lo viejo se descarta
  // comparando, no borrando.
  const [loaded, setLoaded] = useState<{
    socialPostId: string;
    metric: AnalysisMetric;
    data: PostAnalysis | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadPostAnalysis({ socialPostId, metric }).then((result) => {
      if (cancelled) return;
      setLoaded({
        socialPostId,
        metric,
        data: result.ok ? result.data : null,
        error: result.ok ? null : result.error,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [socialPostId, metric]);

  const current =
    loaded && loaded.socialPostId === socialPostId && loaded.metric === metric ? loaded : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && onPrevious) onPrevious();
      if (event.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrevious, onNext]);

  const evolutionSeries: ChartSeries[] = data
    ? [
        {
          key: "added",
          label: `${ANALYSIS_METRIC_LABELS[metric]} por dia`,
          color: colorFor(data.post.platform),
          points: data.evolution.map((p) => ({ bucket: `dia ${p.day}`, value: p.added })),
        },
      ]
    : [];

  const cumulativeSeries: ChartSeries[] = data
    ? [
        {
          key: "cumulative",
          label: "Acumulado",
          color: "#6366f1",
          points: data.evolution.map((p) => ({ bucket: `dia ${p.day}`, value: p.cumulative })),
        },
        {
          key: "benchmark",
          label: "Promedio del mismo formato",
          color: "#94a3b8",
          points: data.benchmark.map((p) => ({ bucket: `dia ${p.day}`, value: p.value })),
        },
      ]
    : [];

  const bumpSeries: ChartSeries[] = data
    ? [
        {
          key: "bump",
          label: "Seguidores netos por dia",
          color: "#10b981",
          points: data.bump.window.map((d) => ({ bucket: d.date, value: d.net })),
        },
      ]
    : [];

  return (
    <aside
      role="dialog"
      aria-label="Analisis de la publicacion"
      aria-modal="true"
      className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto border-l border-border bg-background shadow-xl sm:max-w-lg"
    >
      <header className="sticky top-0 flex items-center gap-2 border-b border-border bg-background px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <h2 className="flex-1 truncate text-sm font-semibold">
          {data ? `${platformLabel(data.post.platform)} · ${data.post.mediaType ?? "publicacion"}` : "Cargando"}
        </h2>
        {onPrevious && (
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Anterior"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        {onNext && (
          <button
            type="button"
            onClick={onNext}
            aria-label="Siguiente"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
      </header>

      {error && (
        <p role="alert" className="m-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!data && !error && (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando el analisis...
        </div>
      )}

      {data && (
        <div className="space-y-6 p-4">
          <div className="flex items-start gap-3">
            {data.post.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.post.thumbnailUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {ageLabel(data.post.publishedAt, new Date())} ·{" "}
                {data.post.origin === "system" ? "Publicado por el sistema" : "Publicado a mano"}
              </p>
              {data.post.caption && (
                <p className="mt-1 line-clamp-2 text-sm">{data.post.caption}</p>
              )}
              <div className="mt-1 flex gap-3 text-xs">
                {data.post.url && (
                  <a
                    href={data.post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    Ver en la red <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
                {data.post.contentPostId && (
                  <Link
                    href={drawerHref(new URLSearchParams(), { kind: "piece", id: data.post.contentPostId })}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Abrir en Contenido
                  </Link>
                )}
              </div>
            </div>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ahora
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {data.cards.map((card) => (
                <div key={card.key} className="rounded-lg border border-border p-2">
                  <p className="text-[11px] text-muted-foreground">{card.label}</p>
                  <p className="text-base font-semibold tabular-nums">
                    {card.value === null ? (card.note ?? "—") : card.value.toLocaleString("es-AR")}
                  </p>
                  {card.value !== null && card.note && (
                    <p className="text-[10px] text-muted-foreground">{card.note}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Desde que salio
              </h3>
              <select
                aria-label="Metrica"
                value={metric}
                onChange={(e) => setMetric(e.target.value as AnalysisMetric)}
                className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              >
                {Object.entries(ANALYSIS_METRIC_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <DualAxisChart
              bars={evolutionSeries}
              lines={cumulativeSeries}
              formatBucket={(b) => b}
              emptyMessage="Todavia no hay fotos diarias de esta publicacion."
            />
            {data.evolution.some((p) => p.estimated) && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Algunos dias no tienen foto: lo que sumaron se repartio entre ellos.
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Seguidores alrededor de la publicacion
            </h3>
            <p className="mb-2 text-sm">{data.bump.label}</p>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Es una señal, no una atribucion: ninguna red dice cuantos seguidores trajo un post.
            </p>
            <DualAxisChart
              bars={bumpSeries}
              lines={[]}
              emptyMessage="Todavia no hay seguidores registrados alrededor de esa fecha."
            />
            {data.neighbors.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Ese dia y el siguiente salieron {data.neighbors.length}{" "}
                {data.neighbors.length === 1 ? "pieza mas" : "piezas mas"} en la misma red: el
                salto es de todas juntas.
              </p>
            )}
          </section>

          {data.audience && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                A quien llego
              </h3>
              <p className="text-sm">{data.audience.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.audience.nonFollowerShare}% no te seguian (
                {data.audience.nonFollowers.toLocaleString("es-AR")} de{" "}
                {(data.audience.followers + data.audience.nonFollowers).toLocaleString("es-AR")}).
              </p>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Comentarios
            </h3>
            {data.comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavia no hay comentarios guardados.</p>
            ) : (
              <ul className="space-y-2">
                {data.comments.map((comment) => (
                  <li key={comment.id} className="rounded-lg border border-border p-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {comment.isOwn ? "Vos" : (comment.authorUsername ?? "Alguien")}
                    </p>
                    <p className="mt-0.5">{comment.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
