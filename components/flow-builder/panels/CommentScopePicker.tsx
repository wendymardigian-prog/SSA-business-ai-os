"use client";

import { useEffect, useState } from "react";
import { useActiveWorkspaceId, useViewerTimezone } from "@/components/dashboard-chrome";
import { createClient } from "@/lib/supabase/client";
import { formatDateOnly } from "@/lib/dates";
import { parsePostIds, postOptionLabel, togglePostId } from "@/lib/flows/comment-scope";

interface ChannelOption {
  id: string;
  label: string;
}

interface PostOption {
  externalId: string;
  caption: string | null;
  published_at: string | null;
  thumbnail_url: string | null;
}

/**
 * En que cuenta de Instagram y en que publicaciones escucha «Palabra clave en un comentario». Antes solo se elegia
 * desde la pestana Growth; ahora vive en el disparador (`channelId`, `postIds`) y publicar arma la fila desde ahi.
 *
 * Lee con la sesion de quien edita (la RLS decide que cuentas y publicaciones ve). Sin acceso a Social, la lista de
 * publicaciones queda vacia y se puede pegar el id a mano.
 */
export function CommentScopePicker({
  flowId,
  channelId,
  postIds,
  onChange,
}: {
  flowId?: string;
  channelId: string | null;
  postIds: string[];
  onChange: (patch: { channelId?: string | null; postIds?: string[] }) => void;
}) {
  const workspaceId = useActiveWorkspaceId();
  const timeZone = useViewerTimezone();
  const [channels, setChannels] = useState<ChannelOption[] | null>(null);
  const [posts, setPosts] = useState<PostOption[] | null>(null);
  const [manual, setManual] = useState("");
  const [mode, setMode] = useState<"all" | "some">(postIds.length > 0 ? "some" : "all");

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    const run = async () => {
      // El workspace del flujo (una persona puede estar en dos negocios); sin flujo, el activo.
      let ws = workspaceId ?? null;
      if (flowId) {
        const { data } = await supabase.from("flows").select("workspace_id").eq("id", flowId).maybeSingle();
        ws = (data as { workspace_id?: string } | null)?.workspace_id ?? ws;
      }
      if (!ws) return;
      const { data } = await supabase
        .from("channels")
        .select("id, display_name, username, is_active")
        .eq("workspace_id", ws)
        .eq("platform", "instagram")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (!alive) return;
      setChannels(
        ((data ?? []) as Array<{ id: string; display_name: string | null; username: string | null }>).map((c) => ({
          id: c.id,
          label: c.username ? `@${c.username}` : (c.display_name ?? "Cuenta de Instagram"),
        })),
      );
    };
    void run();
    return () => {
      alive = false;
    };
  }, [flowId, workspaceId]);

  useEffect(() => {
    if (mode !== "some") return;
    let alive = true;
    const supabase = createClient();
    const run = async () => {
      let accountIds: string[] | null = null;
      if (channelId) {
        const { data } = await supabase.from("social_accounts").select("id").eq("channel_id", channelId);
        accountIds = ((data ?? []) as Array<{ id: string }>).map((a) => a.id);
      }
      let query = supabase
        .from("social_posts")
        .select("external_post_id, caption, published_at, thumbnail_url")
        .eq("platform", "instagram")
        .not("external_post_id", "is", null)
        .is("deleted_at", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(30);
      if (accountIds) query = query.in("social_account_id", accountIds.length > 0 ? accountIds : ["00000000-0000-0000-0000-000000000000"]);
      const { data } = await query;
      if (!alive) return;
      setPosts(
        ((data ?? []) as Array<{ external_post_id: string; caption: string | null; published_at: string | null; thumbnail_url: string | null }>).map((p) => ({
          externalId: p.external_post_id,
          caption: p.caption,
          published_at: p.published_at,
          thumbnail_url: p.thumbnail_url,
        })),
      );
    };
    void run();
    return () => {
      alive = false;
    };
  }, [mode, channelId]);

  const selectClass =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
  const unknownIds = postIds.filter((id) => !posts?.some((p) => p.externalId === id));

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="trg-comment-channel" className="mb-2 block text-xs font-semibold text-foreground">
          Cuenta
        </label>
        <select
          id="trg-comment-channel"
          value={channelId ?? ""}
          onChange={(e) => onChange({ channelId: e.target.value || null })}
          className={selectClass}
        >
          <option value="">Todas las cuentas de Instagram</option>
          {(channels ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          {channelId && channels && !channels.some((c) => c.id === channelId) && <option value={channelId}>Una cuenta desconectada</option>}
        </select>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 block text-xs font-semibold text-foreground">Publicaciones</legend>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("all");
              onChange({ postIds: [] });
            }}
            aria-pressed={mode === "all"}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${mode === "all" ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-border bg-card text-foreground hover:bg-accent"}`}
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => setMode("some")}
            aria-pressed={mode === "some"}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${mode === "some" ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-border bg-card text-foreground hover:bg-accent"}`}
          >
            Solo algunas
          </button>
        </div>

        {mode === "some" && (
          <div className="mt-3 space-y-2">
            {posts === null ? (
              <p className="text-xs text-muted-foreground">Cargando publicaciones…</p>
            ) : posts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No encontré publicaciones de esta cuenta. Podés pegar el id abajo.</p>
            ) : (
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-1">
                {posts.map((p) => {
                  const checked = postIds.includes(p.externalId);
                  return (
                    <li key={p.externalId}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onChange({ postIds: togglePostId(postIds, p.externalId) })}
                          className="h-3.5 w-3.5 rounded border-input text-emerald-500 focus:ring-emerald-500"
                        />
                        {p.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
                        ) : (
                          <span className="h-8 w-8 shrink-0 rounded bg-muted" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate text-foreground">{postOptionLabel(p, (iso) => formatDateOnly(iso, timeZone))}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {unknownIds.length > 0 && posts !== null && (
              <div className="flex flex-wrap gap-1">
                {unknownIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground">
                    {id}
                    <button type="button" aria-label={`Quitar ${id}`} onClick={() => onChange({ postIds: postIds.filter((x) => x !== id) })} className="text-muted-foreground hover:text-foreground">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Pegar el id de una publicación"
                aria-label="Id de una publicación"
                className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                type="button"
                disabled={parsePostIds(manual).length === 0}
                onClick={() => {
                  const added = parsePostIds(manual).filter((id) => !postIds.includes(id));
                  onChange({ postIds: [...postIds, ...added] });
                  setManual("");
                }}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40"
              >
                Agregar
              </button>
            </div>
            {postIds.length === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">Sin ninguna elegida, la automatización escucha todas las publicaciones.</p>
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}
