"use client";

import { useMemo, useState } from "react";
import { platformLabel } from "@/lib/platforms";
import type { PostDailyRow, PublishedPost } from "@/lib/dashboards/content";

/**
 * La tabla "Tus posts" (F48, punto 8).
 *
 * Todo post entra, tambien los hechos a mano: el dashboard tiene que
 * contestar "que funciono", y lo que funciono puede no haber salido de este
 * sistema.
 *
 * Se ordena por cualquier columna; por defecto por guardados, que es la
 * metrica que mejor predice alcance en Instagram. Los que no tienen el dato
 * van al final ordene por lo que ordene: una columna vacia no puede quedar
 * arriba de una llena.
 */

export interface PostRow {
  socialPostId: string;
  platform: string;
  mediaType: string | null;
  publishedAt: string | null;
  origin: "system" | "external";
  caption: string | null;
  thumbnailUrl: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagement: number | null;
  engagementD7: number | null;
}

type SortKey = keyof Pick<
  PostRow,
  "publishedAt" | "reach" | "likes" | "comments" | "shares" | "saves" | "engagement" | "engagementD7"
>;

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "publishedAt", label: "Fecha" },
  { key: "reach", label: "Alcance" },
  { key: "likes", label: "Me gusta" },
  { key: "comments", label: "Coment." },
  { key: "shares", label: "Comp." },
  { key: "saves", label: "Guard." },
  { key: "engagement", label: "Engag." },
  { key: "engagementD7", label: "Engag. 7d" },
];

const PAGE_SIZE = 25;

/** Junta cada post con su ultima foto. */
export function toRows(posts: PublishedPost[], latest: Map<string, PostDailyRow>, captions: Map<string, { caption: string | null; thumbnailUrl: string | null }>): PostRow[] {
  return posts.map((post) => {
    const row = latest.get(post.socialPostId);
    const interactions = [row?.likes, row?.comments, row?.shares, row?.saves].filter(
      (v): v is number => typeof v === "number",
    );
    const denominator = row?.reach ?? row?.views ?? null;

    return {
      socialPostId: post.socialPostId,
      platform: post.platform,
      mediaType: post.mediaType,
      publishedAt: post.publishedAt,
      origin: post.origin,
      caption: captions.get(post.socialPostId)?.caption ?? null,
      thumbnailUrl: captions.get(post.socialPostId)?.thumbnailUrl ?? null,
      reach: denominator,
      likes: row?.likes ?? null,
      comments: row?.comments ?? null,
      shares: row?.shares ?? null,
      saves: row?.saves ?? null,
      engagement:
        interactions.length > 0 && denominator !== null && denominator > 0
          ? Number(((interactions.reduce((a, b) => a + b, 0) / denominator) * 100).toFixed(2))
          : null,
      engagementD7: post.engagementD7,
    };
  });
}

export function PostsTable({
  rows,
  onOpen,
}: {
  rows: PostRow[];
  onOpen: (socialPostId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("saves");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Los sin dato al final siempre: una columna vacia no puede quedar
      // arriba de una llena.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const compared = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return descending ? -compared : compared;
    });
    return copy;
  }, [rows, sortKey, descending]);

  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.ceil(sorted.length / PAGE_SIZE);

  // El mejor y el peor engagement, para pintarlos.
  const engagements = rows.map((r) => r.engagement).filter((v): v is number => v !== null);
  const best = engagements.length > 1 ? Math.max(...engagements) : null;
  const worst = engagements.length > 1 ? Math.min(...engagements) : null;

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Todavia no hay publicaciones en este periodo.
      </p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="p-2 font-medium">
                Publicacion
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="p-2 text-right font-medium"
                  // aria-sort va en la celda, que es quien tiene el rol de
                  // encabezado de columna; en el boton no significa nada.
                  aria-sort={
                    sortKey === column.key ? (descending ? "descending" : "ascending") : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (sortKey === column.key) setDescending((d) => !d);
                      else {
                        setSortKey(column.key);
                        setDescending(true);
                      }
                      setPage(0);
                    }}
                    className="hover:text-foreground"
                  >
                    {column.label}
                    {sortKey === column.key ? (descending ? " ▼" : " ▲") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.socialPostId} className="border-b border-border last:border-0">
                <td className="p-2">
                  <button
                    type="button"
                    onClick={() => onOpen(row.socialPostId)}
                    className="flex items-center gap-2 text-left hover:underline"
                  >
                    {row.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.thumbnailUrl} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="h-9 w-9 shrink-0 rounded bg-muted" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-xs">
                        {row.caption?.slice(0, 48) || "Sin caption"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {platformLabel(row.platform)} · {row.mediaType ?? "—"}
                        {row.origin === "external" ? " · A mano" : ""}
                      </span>
                    </span>
                  </button>
                </td>
                {COLUMNS.map((column) => {
                  const value = row[column.key];
                  const isEngagement = column.key === "engagement";
                  return (
                    <td
                      key={column.key}
                      className={`p-2 text-right tabular-nums ${
                        isEngagement && value !== null && value === best
                          ? "text-emerald-600 dark:text-emerald-400"
                          : isEngagement && value !== null && value === worst
                            ? "text-destructive"
                            : ""
                      }`}
                    >
                      {value === null
                        ? "—"
                        : column.key === "publishedAt"
                          ? new Date(value as string).toLocaleDateString("es-AR", {
                              day: "numeric",
                              month: "short",
                            })
                          : typeof value === "number"
                            ? value.toLocaleString("es-AR")
                            : value}
                      {isEngagement && value !== null ? "%" : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} de {sorted.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-border px-2 py-0.5 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-border px-2 py-0.5 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
