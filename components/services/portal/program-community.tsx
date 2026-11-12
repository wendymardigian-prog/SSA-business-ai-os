"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { SidePanel } from "@/components/tasks/overlay";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { useUrlIntent } from "@/components/ui/use-url-intent";
import { communityMarkSeen, communityModerate, communityResolveReport, communitySetMuted, communityTeamPost } from "@/lib/actions/community";
import { saveProgramSettings } from "@/lib/actions/services";
import { LESSON_SPACE, spaceKeyFor, spacesIssues, type CommunitySpace } from "@/lib/program/community";

export interface CommunityPost {
  id: string;
  space_key: string;
  program_item_id: string | null;
  body: string;
  author_contact_id: string | null;
  author_name: string | null;
  author_user_id: string | null;
  as_business: boolean;
  pinned: boolean;
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
 */
export function ProgramCommunity({
  productId,
  posts,
  spaces,
  lessonComments,
  rev,
  counts,
  filter,
  space,
  lessonId,
  teamNames,
  businessName,
  lessonTitles,
  can,
}: {
  productId: string;
  posts: CommunityPost[];
  spaces: CommunitySpace[];
  lessonComments: boolean;
  rev: number;
  counts: { unanswered: number; reported: number };
  filter: "all" | "unanswered" | "reported";
  space: string | null;
  lessonId: string | null;
  teamNames: Record<string, string>;
  businessName: string;
  lessonTitles: Record<string, string>;
  can: { reply: boolean; moderate: boolean; spaces: boolean };
}) {
  const router = useRouter();
  const tz = useViewerTimezone();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  const live = spaces.filter((s) => !s.archived);
  const [draft, setDraft] = useState({ body: "", space: space && space !== LESSON_SPACE ? space : live.find((s) => s.key === "general")?.key ?? live[0]?.key ?? "", asBusiness: true });
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
        <div className="space-y-2 rounded-xl border border-border p-3">
          <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={3} placeholder="Escribí una publicación para la comunidad" className={fieldInput} maxLength={10000} aria-label="Publicación" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select value={draft.space} onChange={(e) => setDraft({ ...draft, space: e.target.value })} className={cn(fieldInput, "w-auto")} aria-label="Espacio">
              {live.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={draft.asBusiness} onChange={(e) => setDraft({ ...draft, asBusiness: e.target.checked })} /> Como {businessName}
            </label>
            <span className="flex-1" />
            <button type="button" disabled={pending || !draft.body.trim() || !draft.space} onClick={() => run(() => communityTeamPost(productId, { body: draft.body, spaceKey: draft.space, asBusiness: draft.asBusiness }), () => setDraft({ ...draft, body: "" }))} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
              Publicar
            </button>
          </div>
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
                <span>· {p.program_item_id ? `Clase «${lessonTitles[p.program_item_id] ?? "…"}»` : spaces.find((s) => s.key === p.space_key)?.name ?? p.space_key}</span>
                {p.pinned && <span className="rounded bg-accent px-1.5">Fijado</span>}
                {p.hidden && <span className="rounded bg-accent px-1.5">Oculto: {p.hidden_reason}</span>}
                {p.unanswered && <span className="rounded bg-warn/15 px-1.5 text-foreground">Sin contestar</span>}
              </div>
              <p className="whitespace-pre-wrap text-sm">{p.body}</p>
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
                      <p className="whitespace-pre-wrap">{r.body}</p>
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
      {gear && <SpacesPanel productId={productId} spaces={spaces} lessonComments={lessonComments} rev={rev} onClose={() => setGear(false)} />}
    </div>
  );
}

function SpacesPanel({ productId, spaces: initial, lessonComments: initialLc, rev, onClose }: { productId: string; spaces: CommunitySpace[]; lessonComments: boolean; rev: number; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [spaces, setSpaces] = useState<CommunitySpace[]>(initial);
  const [lessonComments, setLc] = useState(initialLc);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const issues = spacesIssues(spaces);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= spaces.length) return;
    const next = [...spaces];
    [next[i], next[j]] = [next[j], next[i]];
    setSpaces(next);
  };
  const patch = (i: number, p: Partial<CommunitySpace>) => setSpaces(spaces.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveProgramSettings(productId, { community: { spaces, lesson_comments: lessonComments } }, rev);
      if (!r.ok) return setError(r.error.message);
      const d = r.data as { status?: string; problems?: string[] };
      if (d.status === "invalid") return setError((d.problems ?? []).join(". "));
      if (d.status === "conflict") return setError("Alguien cambió los espacios mientras tanto. Cerrá y volvé a abrir.");
      router.refresh();
      onClose();
    });
  return (
    <SidePanel
      label="Espacios de la comunidad"
      onClose={onClose}
      header={<h2 className="text-base font-semibold">Espacios de la comunidad</h2>}
      footer={
        <>
          {(error || issues[0]) && <p role="alert" className="w-full text-xs text-destructive">{error ?? issues[0]}</p>}
          <button type="button" disabled={pending || issues.length > 0} onClick={save} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">Guardar</button>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">Cancelar</button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        <ul className="space-y-2">
          {spaces.map((s, i) => (
            <li
              key={s.key}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
                if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
              }}
              className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-border p-2", s.archived && "opacity-60")}
            >
              <input value={s.name} onChange={(e) => patch(i, { name: e.target.value })} className={cn(fieldInput, "w-40 flex-1")} aria-label={`Nombre del espacio ${s.key}`} maxLength={40} />
              <select value={s.team_only ? "team" : "all"} onChange={(e) => patch(i, { team_only: e.target.value === "team" })} className={cn(fieldInput, "w-auto")} aria-label="Quién publica">
                <option value="all">Publican todos</option>
                <option value="team">Solo el equipo</option>
              </select>
              <button type="button" onClick={() => patch(i, { archived: !s.archived })} className="rounded-md px-2 py-1 text-xs hover:bg-accent">{s.archived ? "Volver a usar" : "Archivar"}</button>
              <button type="button" aria-label="Subir" onClick={() => move(i, -1)} className="rounded-md p-1 hover:bg-accent"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label="Bajar" onClick={() => move(i, 1)} className="rounded-md p-1 hover:bg-accent"><ArrowDown className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre del espacio nuevo" className={fieldInput} maxLength={40} />
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={() => {
              setSpaces([...spaces, { key: spaceKeyFor(newName, spaces.map((s) => s.key)), name: newName.trim() }]);
              setNewName("");
            }}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
        <section className="space-y-1 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Clases</p>
          <p className="text-xs text-muted-foreground">Los comentarios de las clases se juntan acá. Apagados, los que había quedan guardados y no se ven.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lessonComments} onChange={(e) => setLc(e.target.checked)} /> Permitir comentarios en las clases
          </label>
        </section>
      </div>
    </SidePanel>
  );
}
