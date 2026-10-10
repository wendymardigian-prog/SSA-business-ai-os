"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PostAnalysisPanel } from "@/components/dashboards/post-analysis-panel";
import { refreshMetricsNow } from "@/lib/actions/metrics";
import { platformLabel } from "@/lib/platforms";
import {
  buildProfile,
  contentTabs,
  defaultPlatform,
  followerTrend,
  formatFilters,
  inContentTab,
  linkedinRows,
  networkTabs,
  tabRatio,
  type LinkedinSource,
  type ProfileSource,
  type UpcomingItem,
} from "@/lib/social/profile-page";
import { drawerHref } from "@/lib/content/drawer-url";
import { cn } from "@/lib/utils";

/**
 * La pagina Social (F54).
 *
 * Es el perfil como se ve en cada red, con lo que la red no muestra: las
 * metricas de cada pieza al pasar el mouse, y el analisis completo al hacer
 * clic. Sirve para la pregunta "¿como se ve mi cuenta?" sin abrir cinco apps.
 *
 * Entran tambien las publicaciones hechas a mano, marcadas: la grilla tiene
 * que parecerse a la real, y la real las incluye.
 *
 * Arriba de la grilla van las "Proximas" (F100), con borde punteado: lo
 * programado y lo tentativo de esa red. Al tocar una se abre la pieza en
 * Contenido. Una red sin conectar invita a conectarla en vez de mostrar una
 * grilla vacia, y LinkedIn es una lista porque no entrega metricas.
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
  upcoming,
  linkedin,
  canRefresh,
  canConnect,
  timeZone,
}: {
  /** Las redes conectadas. */
  platforms: string[];
  profiles: Record<string, ProfileSource>;
  tiles: SocialTile[];
  followerPoints: Record<string, Array<{ date: string; followers: number | null }>>;
  /** Lo programado y lo tentativo, por red (F100). */
  upcoming: Record<string, UpcomingItem[]>;
  /** Lo publicado desde el sistema en LinkedIn, que no entrega metricas. */
  linkedin: LinkedinSource[];
  /** "Actualizar ahora" cuesta llamadas a las redes: solo Owner y Admin (F78). */
  canRefresh: boolean;
  /** Integraciones es de Owner y Admin: los demas no reciben un link que rebota. */
  canConnect: boolean;
  /** La zona del negocio: las fechas se cuentan ahi y no en la del navegador. */
  timeZone: string;
}) {
  const [platform, setPlatform] = useState(defaultPlatform(platforms));
  const [format, setFormat] = useState<string | null>(null);
  // La pestaña de contenido (YouTube: Videos / Shorts). Null = la primera.
  const [tab, setTab] = useState<string | null>(null);
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

  const tabs = contentTabs(platform);
  const activeTab = tab ?? tabs[0]?.value ?? null;

  // Sin useMemo: son a lo sumo 120 baldosas, y filtrarlas es mas barato que
  // lo que el compilador de React pierde al no poder conservar la memoria.
  const ofPlatform = tiles.filter((tile) => tile.platform === platform);
  const visible = ofPlatform.filter(
    (tile) =>
      (!format || tile.mediaType === format) &&
      (!activeTab || inContentTab(platform, activeTab, tile.mediaType)),
  );

  const isVertical = tabRatio(platform, activeTab) === "9 / 16";

  const openIndex = openPostId ? visible.findIndex((t) => t.socialPostId === openPostId) : -1;

  const connected = platforms.includes(platform);
  const next = upcoming[platform] ?? [];
  const linkedinList = useMemo(() => linkedinRows(linkedin), [linkedin]);

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
                setTab(null);
                // El aviso era de la red anterior.
                setNotice(null);
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {networkTabs(platforms).map((tab) => (
                <option key={tab.platform} value={tab.platform}>
                  {platformLabel(tab.platform)}
                  {tab.connected ? "" : " (sin conectar)"}
                </option>
              ))}
            </select>

            {connected && platform !== "linkedin" && formatFilters(platform).length > 0 && (
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

            {connected && (
              <Link
                href={`/dashboard/dashboards/content?red=${platform}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs"
              >
                <BarChart3 className="h-3.5 w-3.5" aria-hidden />
                Analiticas
              </Link>
            )}

            {canRefresh && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await refreshMetricsNow(platform);
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

        {!connected && (
          <ConnectCard platform={platform} canConnect={canConnect} />
        )}

        {connected && profile && (
          <header className="mb-6 flex flex-wrap items-start gap-4">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="h-16 w-16 rounded-full bg-muted" aria-hidden />
            )}

            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">
                {profile.profileLink ? (
                  <a
                    href={profile.profileLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:underline hover:underline-offset-2"
                    aria-label={`Abrir el perfil de ${platformLabel(platform)} en una pestaña nueva`}
                  >
                    {profile.username ? `@${profile.username}` : platformLabel(platform)}
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </a>
                ) : profile.username ? (
                  `@${profile.username}`
                ) : (
                  platformLabel(platform)
                )}
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

              {profile.warning && (
                <p
                  role="alert"
                  className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {profile.warning}
                </p>
              )}

              <p className="mt-1 text-[11px] text-muted-foreground">{profile.sourceLabel}</p>
            </div>
          </header>
        )}

        {connected && next.length > 0 && <UpcomingGrid items={next} platform={platform} timeZone={timeZone} />}

        {connected && platform === "linkedin" && (
          <section aria-labelledby="linkedin-lista">
            <h2 id="linkedin-lista" className="text-sm font-semibold">
              Publicado desde el sistema
            </h2>
            <p className="mt-1 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              LinkedIn no entrega métricas de las publicaciones a quien no es partner, así que acá no hay números:
              ves lo que mandaste desde el sistema y cómo le fue.
            </p>
            {linkedinList.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Todavía no publicaste nada en LinkedIn desde el sistema.
              </p>
            ) : (
              <ul className="mt-3 divide-y rounded-lg border border-border">
                {linkedinList.map((row) => (
                  <li key={row.socialPostId} className="flex items-start gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{row.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            "font-medium",
                            row.tone === "ok" && "text-emerald-600 dark:text-emerald-400",
                            row.tone === "error" && "text-destructive",
                            row.tone === "pending" && "text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {row.state}
                        </span>
                        {row.at && ` · ${formatDay(row.at, timeZone)}`}
                      </p>
                      {row.note && <p className="mt-1 text-xs text-destructive">{row.note}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      {row.contentPostId && (
                        <Link
                          href={drawerHref(new URLSearchParams(), { kind: "piece", id: row.contentPostId })}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          Abrir pieza
                        </Link>
                      )}
                      {row.url && (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                        >
                          Ver <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {connected && platform !== "linkedin" && (
          <>
            {next.length > 0 && visible.length > 0 && tabs.length === 0 && (
              <h2 className="mb-2 text-sm font-semibold">Publicadas</h2>
            )}
            {tabs.length > 0 && (
              <div role="tablist" aria-label="Tipo de contenido" className="mb-3 flex gap-1 border-b border-border">
                {tabs.map((t) => {
                  const selected = t.value === activeTab;
                  const count = ofPlatform.filter((tile) => inContentTab(platform, t.value, tile.mediaType)).length;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setTab(t.value)}
                      className={cn(
                        "-mb-px border-b-2 px-3 py-1.5 text-sm",
                        selected
                          ? "border-foreground font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.label} <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {visible.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                {ofPlatform.length > 0 && tabs.length > 0
                  ? `Todavia no hay ${tabs.find((t) => t.value === activeTab)?.label.toLowerCase() ?? "publicaciones"} guardados.`
                  : "Todavia no hay publicaciones de esta red guardadas. Aparecen despues de la primera actualizacion."}
              </p>
            ) : (
              <ul
                className={cn(
                  "grid gap-2",
                  isVertical
                    ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6"
                    : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
                )}
              >
                {visible.map((tile) => (
                  <li key={tile.socialPostId}>
                    <button
                      type="button"
                      onClick={() => setOpenPostId(tile.socialPostId)}
                      className="group relative block w-full overflow-hidden rounded-lg border border-border text-left"
                      style={{ aspectRatio: tabRatio(platform, activeTab) }}
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
                        {/* Con pestañas el formato ya se sabe: la etiqueta seria ruido. */}
                        {tile.mediaType && tabs.length === 0 && (
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
          </>
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

/** Una red sin conectar: invita a conectarla en vez de mostrar una grilla vacia. */
function ConnectCard({ platform, canConnect }: { platform: string; canConnect: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">Conectá tu cuenta de {platformLabel(platform)}</p>
      <p className="text-xs text-muted-foreground">
        Cuando esté conectada, acá vas a ver su perfil, sus publicaciones con las métricas que la red no muestra y lo
        que tenés programado.
      </p>
      {canConnect ? (
        <Link
          href="/dashboard/settings/integrations"
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Conectar en Integraciones
        </Link>
      ) : (
        <p className="text-xs text-muted-foreground">
          La conecta quien administra el negocio, desde Ajustes → Integraciones.
        </p>
      )}
    </div>
  );
}

/**
 * Las "Proximas" de una red (F100): lo programado y lo tentativo, con borde
 * punteado para distinguirlo de lo ya publicado. Al tocar una se abre la pieza
 * en Contenido.
 */
function UpcomingGrid({ items, platform, timeZone }: { items: UpcomingItem[]; platform: string; timeZone: string }) {
  return (
    <section aria-labelledby="proximas" className="mb-6">
      <h2 id="proximas" className="mb-2 text-sm font-semibold">
        Próximas <span className="font-normal text-muted-foreground">· {items.length}</span>
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <li key={`${item.contentPostId}-${platform}`}>
            <Link
              href={drawerHref(new URLSearchParams(), { kind: "piece", id: item.contentPostId })}
              className="flex h-full flex-col gap-1 rounded-lg border border-dashed border-border p-3 hover:bg-accent/40"
            >
              <span
                className={cn(
                  "w-fit rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  item.kind === "scheduled"
                    ? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {item.kind === "scheduled" ? "Programada" : "Tentativa"}
              </span>
              <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
              <span className="mt-auto text-xs text-muted-foreground">
                {formatDay(item.at, timeZone)}
                {item.format && ` · ${item.format}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
