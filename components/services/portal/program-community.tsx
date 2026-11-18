"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { SidePanel } from "@/components/tasks/overlay";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { useUrlIntent } from "@/components/ui/use-url-intent";
import { communityMarkSeen, communityModerate, communityResolveReport, communitySetMuted, communityTeamEdit, communityTeamPost } from "@/lib/actions/community";
import { LESSON_SPACE, type CommunitySpace, type ProgramCommunity } from "@/lib/program/community";
import { ProgramCommunitiesEditor } from "@/components/services/portal/program-communities-editor";
import { mediaPaths } from "@/lib/program/community-text";
import { CommunityBody } from "@/components/services/portal/community-body";
import { CommunityComposer, type ComposerPhoto } from "@/components/services/portal/community-composer";

export interface CommunityPost {
  id: string;
  /** La comunidad del post (00402). */
  community_key?: string;
  space_key: string;
  program_item_id: string | null;
  body: string;
  /** Las fotos: [{path}] en el bucket `community-media`. */
  media?: unknown;
  author_contact_id: string | null;
  author_name: string | null;
  author_user_id: string | null;
  as_business: boolean;
  pinned: boolean;
  edited_at?: string | null;
  hidden: boolean;
  hidden_reason: string | null;
  seen: boolean;
  created_at: string;
  unanswered: boolean;
  reactions: Record<string, number>;
  reports: Array<{ id: string; reason: string | null; created_at: string }>;
  replies: Array<{ id: string; body: string; author_contact_id: string | null; author_name: string | null; author_user_id: string | null; as_business: boolean; hidden: boolean; created_at: string }>;
}

const REACTION_LABEL: Record<string, string> = { like: "👍", fire: "🔥", clap: "👏" };

/**
 * Portal › programa › Comunidad (F77, F111). Sin interruptor: la comunidad se prende en Productos › variante › Portal.
 * Filtros arriba (en la URL), Publicar y la tuerca de los espacios; cada post con sus comentarios, reacciones y reportes.
 * Con más de una comunidad (00402), la barra elige cuál se ve (`?comunidad=`), Publicar deja elegir en cuáles y cada
 * post dice de qué comunidad es.
 */
export function ProgramCommunity({
  productId,
  posts,
  spaces,
  communities,
  community,
  programSettings,
  usedBy,
  rev,
  counts,
  filter,
  space,
  lessonId,
  teamNames,
  businessName,
  lessonTitles,
  photoUrls,
  meUserId,
  can,
}: {
  productId: string;
  posts: CommunityPost[];
  /** Los espacios de la comunidad que se está viendo. */
  spaces: CommunitySpace[];
  /** Todas las comunidades del programa (las archivadas también, para el nombre de sus posts). */
  communities: ProgramCommunity[];
  /** La comunidad que se está viendo. */
  community: string;
  /** `products.portal_settings` (lo edita la tuerca). */
  programSettings: unknown;
  /** Clave de cada comunidad → las variantes que la eligieron. */
  usedBy: Record<string, string[]>;
  rev: number;
  counts: { unanswered: number; reported: number };
  filter: "all" | "unanswered" | "reported";
  space: string | null;
  lessonId: string | null;
  teamNames: Record<string, string>;
  businessName: string;
  lessonTitles: Record<string, string>;
  /** El link firmado de cada foto (path → url), armado por la página. */
  photoUrls: Record<string, string>;
  meUserId: string;
  can: { reply: boolean; moderate: boolean; spaces: boolean };
}) {
  const router = useRouter();
  const tz = useViewerTimezone();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  const activeCommunities = communities.filter((c) => !c.archived);
  const multi = communities.length > 1;
  const communityName = (key: string | undefined) => communities.find((c) => c.key === key)?.name ?? key ?? "";
  // Publicar en una o en varias comunidades (R4.2): arranca en la que se está viendo.
  const [targets, setTargets] = useState<string[]>([community]);
  // Los espacios que se ofrecen son los que tienen TODAS las comunidades elegidas (un anuncio en dos va a Anuncios de las dos).
  const live = spaces.filter(
    (s) => !s.archived && targets.every((k) => k === community || activeCommunities.find((c) => c.key === k)?.spaces.some((x) => x.key === s.key && !x.archived)),
  );
  const [draft, setDraft] = useState({ body: "", space: space && space !== LESSON_SPACE ? space : live.find((s) => s.key === "general")?.key ?? live[0]?.key ?? "", asBusiness: true });
  const [photos, setPhotos] = useState<ComposerPhoto[]>([]);
  // El editor se vuelve a armar vacío después de publicar.
  const [composerKey, setComposerKey] = useState(0);
  const [editing, setEditing] = useState<{ id: string; body: string; photos: ComposerPhoto[] } | null>(null);
  const photosOf = (media: unknown) => mediaPaths(media).map((path) => photoUrls[path]).filter((u): u is string => !!u);
  const canEdit = (p: CommunityPost) => can.reply && !p.author_contact_id && (can.moderate || p.author_user_id === meUserId);
  const [replying, setReplying] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const when = (iso: string) => new Intl.DateTimeFormat("es", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error?.message ?? "No se pudo hacer");
      after?.();
      router.refresh();
    });
  const author = (p: { author_name: string | null; author_user_id: string | null; as_business: boolean; author_contact_id: string | null }) =>
    p.author_contact_id ? p.author_name ?? "Estudiante" : p.as_business ? businessName : teamNames[p.author_user_id ?? ""] ?? "Equipo";
  const ask = (q: string) => {
    const r = prompt(q);
    return r && r.trim() ? r.trim() : null;
  };

  // Los filtros (Todo, Sin contestar, Reportados, cada espacio) y la tuerca de los espacios viven en la barra superior
  // (Servicios A2): la tuerca llega como `?espacios=1`.
  useUrlIntent("espacios", () => {
    if (can.spaces) setGear(true);
  });

  return (
    <div className="space-y-4">
      {lessonId && (
        <p className="text-xs text-muted-foreground">
          Comentarios de la clase <span className="font-medium text-foreground">{lessonTitles[lessonId] ?? "…"}</span>
        </p>
      )}
      {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {can.reply && (
        <div className="rounded-xl border border-border p-3">
          <CommunityComposer
            key={composerKey}
            id="community-new-post"
            productId={productId}
            body={draft.body}
            onBody={(body) => setDraft((d) => ({ ...d, body }))}
            photos={photos}
            onPhotos={setPhotos}
            footer={({ uploading }) => (
              <>
                {multi && (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1" role="group" aria-label="Publicar en">
                    <span className="text-xs text-muted-foreground">En</span>
                    {activeCommunities.map((c) => (
                      <label key={c.key} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={targets.includes(c.key)}
                          onChange={(e) => setTargets(e.target.checked ? [...targets, c.key] : targets.length > 1 ? targets.filter((k) => k !== c.key) : targets)}
                        />
                        {c.name}
                      </label>
                    ))}
                  </span>
                )}
                <select value={live.some((s) => s.key === draft.space) ? draft.space : ""} onChange={(e) => setDraft({ ...draft, space: e.target.value })} className={cn(fieldInput, "w-auto")} aria-label="Espacio">
                  {!live.some((s) => s.key === draft.space) && <option value="">Elegí el espacio</option>}
                  {live.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={draft.asBusiness} onChange={(e) => setDraft({ ...draft, asBusiness: e.target.checked })} /> Como {businessName}
                </label>
                <span className="flex-1" />
                <span className={cn("text-xs", draft.body.length > 10000 ? "text-destructive" : "text-muted-foreground")}>{draft.body.length > 8000 ? `${draft.body.length.toLocaleString("es")} / 10.000` : ""}</span>
                <button
                  type="button"
                  disabled={pending || uploading || !draft.body.trim() || draft.body.length > 10000 || !live.some((s) => s.key === draft.space)}
                  onClick={() =>
                    run(
                      () => communityTeamPost(productId, { body: draft.body, spaceKey: draft.space, asBusiness: draft.asBusiness, media: photos.map((f) => f.path), communityKeys: targets }),
                      () => {
                        setDraft((d) => ({ ...d, body: "" }));
                        setPhotos([]);
                        setComposerKey((k) => k + 1);
                      },
                    )
                  }
                  className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                >
                  Publicar
                </button>
              </>
            )}
          />
        </div>
      )}
      {posts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {filter === "unanswered" ? "No hay nada sin contestar." : filter === "reported" ? "No hay reportes abiertos." : "Todavía no hay publicaciones acá."}
        </p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p.id} className={cn("space-y-2 rounded-xl border border-border p-3", p.hidden && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{author(p)}</span>
                {!p.author_contact_id && <span className="rounded bg-primary/10 px-1.5 text-foreground">Equipo</span>}
                <span>{when(p.created_at)}</span>
                {multi && <span className="rounded bg-accent px-1.5 text-foreground">{communityName(p.community_key)}</span>}
                <span>· {p.program_item_id ? `Clase «${lessonTitles[p.program_item_id] ?? "…"}»` : spaces.find((s) => s.key === p.space_key)?.name ?? p.space_key}</span>
                {p.pinned && <span className="rounded bg-accent px-1.5">Fijado</span>}
                {p.hidden && <span className="rounded bg-accent px-1.5">Oculto: {p.hidden_reason}</span>}
                {p.unanswered && <span className="rounded bg-warn/15 px-1.5 text-foreground">Sin contestar</span>}
                {p.edited_at && <span>· editado</span>}
              </div>
              {editing?.id === p.id ? (
                <CommunityComposer
                  id={`community-edit-${p.id}`}
                  productId={productId}
                  body={editing.body}
                  onBody={(body) => setEditing((e) => (e ? { ...e, body } : e))}
                  photos={editing.photos}
                  onPhotos={(update) => setEditing((e) => (e ? { ...e, photos: update(e.photos) } : e))}
                  footer={({ uploading }) => (
                    <>
                      <span className="flex-1" />
                      <button type="button" onClick={() => setEditing(null)} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">Cancelar</button>
                      <button
                        type="button"
                        disabled={pending || uploading || !editing.body.trim() || editing.body.length > 10000}
                        onClick={() => run(() => communityTeamEdit(productId, p.id, { body: editing.body, media: editing.photos.map((f) => f.path) }), () => setEditing(null))}
                        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                      >
                        Guardar
                      </button>
                    </>
                  )}
                />
              ) : (
                <CommunityBody body={p.body} photos={photosOf(p.media)} />
              )}
              {Object.keys(p.reactions).length > 0 && (
                <p className="text-xs text-muted-foreground">{Object.entries(p.reactions).map(([k, n]) => `${REACTION_LABEL[k] ?? k} ${n}`).join("  ")}</p>
              )}
              {p.reports.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs">
                  {p.reports.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <span className="flex-1">Reporte: {r.reason || "sin motivo"}</span>
                      {can.moderate && <button type="button" disabled={pending} onClick={() => run(() => communityResolveReport(productId, r.id))} className="text-primary-ink hover:underline">Resolver</button>}
                    </li>
                  ))}
                </ul>
              )}
              {p.replies.length > 0 && (
                <ul className="space-y-1.5 border-l-2 border-border pl-3">
                  {p.replies.map((r) => (
                    <li key={r.id} className={cn("text-sm", r.hidden && "opacity-60")}>
                      <span className="text-xs font-medium">{author(r)}</span>
                      {!r.author_contact_id && <span className="ml-1 rounded bg-primary/10 px-1 text-[11px]">Equipo</span>}
                      <span className="ml-2 text-xs text-muted-foreground">{when(r.created_at)}</span>
                      <CommunityBody body={r.body} compact />
                      {can.moderate && (
                        <button type="button" disabled={pending} onClick={() => { if (r.hidden) run(() => communityModerate(productId, r.id, "unhide")); else { const why = ask("¿Por qué se oculta?"); if (why) run(() => communityModerate(productId, r.id, "hide", why)); } }} className="text-xs text-muted-foreground hover:underline">
                          {r.hidden ? "Mostrar" : "Ocultar"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {replying === p.id && (
                <div className="space-y-2">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} className={fieldInput} placeholder="Tu respuesta" aria-label="Respuesta" maxLength={10000} />
                  <div className="flex gap-2">
                    <button type="button" disabled={pending || !reply.trim()} onClick={() => run(() => communityTeamPost(productId, { body: reply, parentId: p.id, asBusiness: draft.asBusiness }), () => { setReply(""); setReplying(null); })} className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50">
                      Responder
                    </button>
                    <button type="button" onClick={() => setReplying(null)} className="rounded-md px-2 py-1 text-xs hover:bg-accent">Cancelar</button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-3 text-xs">
                {can.reply && replying !== p.id && <button type="button" onClick={() => { setReplying(p.id); setReply(""); }} className="text-primary-ink hover:underline">Responder</button>}
                {canEdit(p) && editing?.id !== p.id && (
                  <button type="button" onClick={() => setEditing({ id: p.id, body: p.body, photos: mediaPaths(p.media).map((path) => ({ path, url: photoUrls[path] ?? "" })) })} className="hover:underline">
                    Editar
                  </button>
                )}
                {can.reply && p.author_contact_id && !p.seen && <button type="button" disabled={pending} onClick={() => run(() => communityMarkSeen(productId, p.id))} className="hover:underline">Marcar como visto</button>}
                {can.moderate && (
                  <>
                    <button type="button" disabled={pending} onClick={() => run(() => communityModerate(productId, p.id, p.pinned ? "unpin" : "pin"))} className="hover:underline">{p.pinned ? "Desfijar" : "Fijar"}</button>
                    <button type="button" disabled={pending} onClick={() => { if (p.hidden) run(() => communityModerate(productId, p.id, "unhide")); else { const why = ask("¿Por qué se oculta?"); if (why) run(() => communityModerate(productId, p.id, "hide", why)); } }} className="hover:underline">
                      {p.hidden ? "Mostrar" : "Ocultar"}
                    </button>
                    <button type="button" disabled={pending} onClick={() => confirm("¿Borrar esta publicación? Se oculta ya y se borra del todo a los 30 días.") && run(() => communityModerate(productId, p.id, "delete"))} className="text-destructive hover:underline">Borrar</button>
                    {p.author_contact_id && (
                      <button type="button" disabled={pending} onClick={() => { const why = ask(`¿Por qué se silencia a ${author(p)}? No va a poder publicar ni comentar.`); if (why) run(() => communitySetMuted(productId, p.author_contact_id as string, true, why)); }} className="hover:underline">
                        Silenciar
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {gear && (
        <SidePanel
          label="Comunidades y espacios"
          onClose={() => setGear(false)}
          header={<h2 className="text-base font-semibold">{multi ? "Comunidades y espacios" : "Espacios de la comunidad"}</h2>}
        >
          <div className="p-4">
            <ProgramCommunitiesEditor productId={productId} settings={programSettings} rev={rev} usedBy={usedBy} canEdit={can.spaces} initialOpen={community} onSaved={() => setGear(false)} />
          </div>
        </SidePanel>
      )}
    </div>
  );
}
