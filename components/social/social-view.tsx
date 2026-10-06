"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PostAnalysisPanel } from "@/components/dashboards/post-analysis-panel";
import { refreshMetricsNow } from "@/lib/actions/metrics";
import { platformLabel } from "@/lib/platforms";
import {
  buildProfile,
  followerTrend,
  formatFilters,
  gridRatio,
  type ProfileSource,
} from "@/lib/social/profile-page";

/**
 * La pagina Social (F54).
 *
 * Es el perfil como se ve en cada red, con lo que la red no muestra: las
 * metricas de cada pieza al pasar el mouse, y el analisis completo al hacer
 * clic. Sirve para la pregunta "¿como se ve mi cuenta?" sin abrir cinco apps.
 *
 * Entran tambien las publicaciones hechas a mano, marcadas: la grilla tiene
 * que parecerse a la real, y la real las incluye.
 */

export interface SocialTile {
  socialPostId: string;
  platform: string;
  mediaType: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  url: string | null;
  publishedAt: string | null;
  origin: "system" | "external";
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  engagement: number | null;
}

export function SocialView({
  platforms,
  profiles,
  tiles,
  followerPoints,
  canRefresh,
}: {
  platforms: string[];
  profiles: Record<string, ProfileSource>;
  tiles: SocialTile[];
  followerPoints: Record<string, Array<{ date: string; followers: number | null }>>;
  /** "Actualizar ahora" cuesta llamadas a las redes: solo Owner y Admin (F78). */
  canRefresh: boolean;
}) {
  const [platform, setPlatform] = useState(platforms[0] ?? "");
  const [format, setFormat] = useState<string | null>(null);
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const profile = useMemo(
    () => (profiles[platform] ? buildProfile(profiles[platform]) : null),
    [profiles, platform],
  );

  const trend = useMemo(
    () => followerTrend(followerPoints[platform] ?? []),
    [followerPoints, platform],
  );

  const visible = useMemo(
    () =>
      tiles.filter(
        (tile) => tile.platform === platform && (!format || tile.mediaType === format),
      ),
    [tiles, platform, format],
  );

  const openIndex = openPostId ? visible.findIndex((t) => t.socialPostId === openPostId) : -1;

  if (platforms.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader route="/dashboard/social" />
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Todavia no hay ninguna cuenta conectada. Conecta una en Ajustes → Integraciones y esta
            pantalla muestra su perfil y sus publicaciones.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/social"
        right={
          <div className="flex items-center gap-2">
            <select
              aria-label="Red"
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value);
                setFormat(null);
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {platformLabel(p)}
                </option>
              ))}
            </select>

            {formatFilters(platform).length > 0 && (
              <select
                aria-label="Formato"
                value={format ?? "all"}
                onChange={(e) => setFormat(e.target.value === "all" ? null : e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="all">Todos los formatos</option>
                {formatFilters(platform).map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            )}

            <Link
              href={`/dashboard/dashboards/content?red=${platform}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs"
            >
              <BarChart3 className="h-3.5 w-3.5" aria-hidden />
              Analiticas
            </Link>

            {canRefresh && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await refreshMetricsNow();
                    setNotice(result.ok ? "Se esta actualizando. Recarga en un minuto." : result.error);
                  })
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                Actualizar
              </button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {notice && (
          <p role="status" className="mb-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        {profile && (
          <header className="mb-6 flex flex-wrap items-start gap-4">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="h-16 w-16 rounded-full bg-muted" aria-hidden />
            )}

            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">
                {profile.username ? `@${profile.username}` : platformLabel(platform)}
              </p>
              {profile.displayName && <p className="text-sm">{profile.displayName}</p>}
              {profile.bio && <p className="mt-1 text-sm text-muted-foreground">{profile.bio}</p>}
              {profile.website && (
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline underline-offset-2"
                >
                  {profile.website}
                </a>
              )}

              <ul className="mt-2 flex flex-wrap gap-4">
                {profile.stats.map((stat) => (
                  <li key={stat.key} className="text-sm">
                    <span className="font-semibold tabular-nums">
                      {stat.value === null ? "—" : stat.value.toLocaleString("es-AR")}
                    </span>{" "}
                    <span className="text-muted-foreground">{stat.label}</span>
                  </li>
                ))}
              </ul>

              {trend.change !== null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {trend.change >= 0 ? "+" : ""}
                  {trend.change} seguidores en los ultimos 30 dias
                </p>
              )}

              <p className="mt-1 text-[11px] text-muted-foreground">{profile.sourceLabel}</p>
            </div>
          </header>
        )}

        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Todavia no hay publicaciones de esta red guardadas. Aparecen despues de la primera
            actualizacion.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((tile) => (
              <li key={tile.socialPostId}>
                <button
                  type="button"
                  onClick={() => setOpenPostId(tile.socialPostId)}
                  className="group relative block w-full overflow-hidden rounded-lg border border-border text-left"
                  style={{ aspectRatio: gridRatio(platform) }}
                >
                  {tile.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tile.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-muted p-2 text-center text-xs text-muted-foreground">
                      {tile.caption?.slice(0, 80) || "Sin vista previa"}
                    </span>
                  )}

                  <span className="absolute left-1 top-1 flex gap-1">
                    {tile.mediaType && (
                      <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        {tile.mediaType}
                      </span>
                    )}
                    {tile.origin === "external" && (
                      <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        A mano
                      </span>
                    )}
                  </span>

                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-[11px] text-white">
                    {(tile.views ?? tile.reach)?.toLocaleString("es-AR") ?? "sin datos"}
                  </span>

                  <span className="pointer-events-none absolute inset-0 flex flex-col justify-center gap-0.5 bg-black/70 p-2 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Metric label="Me gusta" value={tile.likes} />
                    <Metric label="Comentarios" value={tile.comments} />
                    <Metric label="Compartidos" value={tile.shares} />
                    <Metric label="Guardados" value={tile.saves} />
                    <Metric label="Alcance" value={tile.reach} />
                    {tile.engagement !== null && (
                      <span className="mt-0.5 font-medium">{tile.engagement}% engagement</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {openPostId && (
        <PostAnalysisPanel
          socialPostId={openPostId}
          onClose={() => setOpenPostId(null)}
          onPrevious={
            openIndex > 0 ? () => setOpenPostId(visible[openIndex - 1].socialPostId) : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < visible.length - 1
              ? () => setOpenPostId(visible[openIndex + 1].socialPostId)
              : undefined
          }
        />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <span>
      {label}: {value.toLocaleString("es-AR")}
    </span>
  );
}
