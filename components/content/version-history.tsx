"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw } from "lucide-react";
import { restoreVersion } from "@/lib/actions/content-versions";
import { compareVersions, describeVersion, type PostSnapshot, type StoredVersion } from "@/lib/content/versions";

/**
 * El historial de la pieza (F22).
 *
 * Tres cosas: ver que versiones hay, comparar una con lo que hay ahora, y
 * restaurar. Restaurar no borra nada: guarda lo actual como una version mas y
 * despues escribe lo viejo, asi el camino de vuelta siempre existe.
 */
export function VersionHistory({
  postId,
  versions,
  current,
  authorNames,
  canEdit,
  onRestored,
}: {
  postId: string;
  versions: StoredVersion[];
  /** Lo que hay ahora, para comparar contra una version. */
  current: StoredVersion["snapshot"];
  authorNames: Record<string, string>;
  canEdit: boolean;
  /** Despues de restaurar (F97): el drawer vuelve al post y relee lo escrito. */
  onRestored?: (snapshot: PostSnapshot) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comparing, setComparing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (versions.length === 0) {
    return (
      <section aria-labelledby="historial">
        <h3 id="historial" className="flex items-center gap-1.5 text-sm font-semibold">
          <History className="h-4 w-4" aria-hidden />
          Historial
        </h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Todavia no hay versiones. Se guarda una al editar (agrupadas por sesion), al cambiar de estado, al
          aprobar y cada vez que la IA escribe.
        </p>
      </section>
    );
  }

  const shown = versions.find((v) => v.id === comparing);
  const diffs = shown ? compareVersions(shown.snapshot, current) : [];

  return (
    <section aria-labelledby="historial">
      <h3 id="historial" className="flex items-center gap-1.5 text-sm font-semibold">
        <History className="h-4 w-4" aria-hidden />
        Historial
      </h3>

      <ol className="mt-2 space-y-1.5">
        {[...versions]
          .sort((a, b) => b.version_no - a.version_no)
          .map((version) => (
            <li key={version.id} className="rounded-lg border border-border p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">
                    v{version.version_no} · {describeVersion(version, authorNames[version.author_id ?? ""])}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(version.created_at).toLocaleString("es-AR", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setComparing(comparing === version.id ? null : version.id)}
                    className="h-7 rounded-md px-2 text-xs hover:bg-accent"
                  >
                    {comparing === version.id ? "Cerrar" : "Comparar"}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const result = await restoreVersion({ postId, versionId: version.id });
                          if (!result.ok) setError(result.error);
                          else {
                            onRestored?.(result.data.snapshot);
                            router.refresh();
                          }
                        })
                      }
                      className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-accent"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden />
                      Restaurar
                    </button>
                  )}
                </div>
              </div>

              {comparing === version.id && (
                <div className="mt-2 border-t border-border pt-2">
                  {diffs.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Esta version es igual a lo que hay ahora.
                    </p>
                  ) : (
                    <dl className="space-y-2">
                      {diffs.map((diff) => (
                        <div key={diff.field}>
                          <dt className="text-[11px] font-medium">{diff.label}</dt>
                          <dd className="grid gap-1 text-[11px] sm:grid-cols-2">
                            <span className="rounded bg-red-500/10 p-1.5 line-through opacity-80">
                              {diff.before || "(vacio)"}
                            </span>
                            <span className="rounded bg-emerald-500/10 p-1.5">
                              {diff.after || "(vacio)"}
                            </span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              )}
            </li>
          ))}
      </ol>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
