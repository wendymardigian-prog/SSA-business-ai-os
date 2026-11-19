"use client";
// @plantilla-quitar(servicios)

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { copyProgramItemToProduct, createProgramItem, reorderProgramItems, saveLessonTranscript, setProgramItemStatus, updateProgramItem, uploadProgramFile, type ProgramUploadKind } from "@/lib/actions/program";
import { buildTree, flattenTree, inactiveDescendants, reorderTree, type ProgramRow, type TreeNode } from "@/lib/program/tree";
import { LESSON_TYPE_LABELS } from "@/lib/program/lesson";
import { transcriptFormat } from "@/lib/program/transcript";
import { transcriptBadge, type TranscriptInfo } from "@/lib/program/transcript-status";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { PortalFormEditor, type PortalFormInitial } from "./portal-form-editor";
import { useUrlIntent } from "@/components/ui/use-url-intent";
import { listFathomForLesson, pickFathomForLesson } from "@/lib/actions/live-sessions";
import { useViewerTimezone } from "@/components/dashboard-chrome";

export interface ContentRow extends ProgramRow {
  /** El formulario de una evaluación o actividad (bloque EV), si ya tiene uno. */
  portalForm?: PortalFormInitial | null;
  /** «Puntos al entregar / al aprobar» propios (F129); null = los del programa. */
  points?: PortalFormInitial["points"];
  /** F46: la grabación de Fathom de una clase de video («Elegir un Fathom»). */
  source_call_id?: string | null;
  description: string | null;
  required: boolean;
  comments_enabled: boolean;
  html_content: string | null;
  document_path: string | null;
  hasTranscript: boolean;
  /** El estado de la transcripción en Conocimiento (null si no tiene). */
  transcript?: TranscriptInfo | null;
}

const STATUS_LABEL = { active: "Activo", inactive: "Inactivo", archived: "Archivado" } as const;
const UNLOCK_LABEL: Record<string, string> = {
  open: "",
  fixed_date: "Se abre en una fecha",
  days_after_start: "Se abre N días después",
  after_complete: "Se abre al completar algo",
  challenge_started: "Se abre con el Reto",
  journey_item: "Lo abre un paso del camino",
  automation: "Lo abre una automatización",
};

/**
 * Portal › programa › Contenido (F45-F49, F102, F112): el árbol de módulos, submódulos y clases. Cada fila se prende o
 * apaga (lo nuevo nace inactivo), se sube o se baja (botones y Alt+↑/↓), y abre su drawer con el contenido, el
 * desbloqueo y la transcripción.
 */
export function ProgramContentEditor({
  productId,
  rows,
  canManage,
  canActivate,
  commentCounts = {},
  otherPrograms = [],
}: {
  productId: string;
  rows: ContentRow[];
  canManage: boolean;
  canActivate: boolean;
  /** Comentarios sin contestar por clase (F111, «N comentarios nuevos»). */
  commentCounts?: Record<string, number>;
  /** F50: los otros programas del negocio, para «Copiar a otro programa». */
  otherPrograms?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const tree = useMemo(() => buildTree(rows), [rows]);
  const flat = useMemo(() => flattenTree(tree), [tree]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ kind: "module" | "submodule" | "lesson"; parentId: string | null } | null>(null);
  const [title, setTitle] = useState("");
  const [lessonType, setLessonType] = useState("video");
  const [msg, setMsg] = useState<string | null>(null);
  // «+ Módulo» vive en la barra superior (Servicios A2): llega como `?nuevo=modulo`.
  useUrlIntent("nuevo", (v) => {
    if (v === "modulo" && canManage) setAdding({ kind: "module", parentId: null });
  });
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) =>
    start(async () => {
      setMsg(null);
      const res = await fn();
      if (!res.ok) return setMsg(res.error?.message ?? "No se pudo hacer");
      router.refresh();
    });

  function move(node: TreeNode, delta: number) {
    const siblings = rows.filter((r) => r.parent_id === node.parent_id && r.status !== "archived");
    const sorted = siblings.slice().sort((a, b) => a.position - b.position);
    const ids = reorderTree(sorted, { id: node.id, to: sorted.findIndex((s) => s.id === node.id) + delta });
    run(() => reorderProgramItems(productId, node.parent_id, ids));
  }

  function toggle(node: TreeNode) {
    if (node.status === "active") return run(() => setProgramItemStatus(productId, node.id, "inactive"));
    const n = inactiveDescendants(node);
    const children = n > 0 && window.confirm(`¿Prender también sus ${n} clases inactivas?`);
    run(() => setProgramItemStatus(productId, node.id, "active", children));
  }

  function add() {
    if (!adding || !title.trim()) return;
    const a = adding;
    start(async () => {
      const res = await createProgramItem(productId, { kind: a.kind, parentId: a.parentId, lessonType, title });
      if (!res.ok) return setMsg(res.error.message);
      setAdding(null);
      setTitle("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {flat.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay contenido. Empezá con un módulo: lo nuevo nace inactivo, así podés armarlo antes de que lo vean.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {flat.map((n) => (
            <li
              key={n.id}
              className={cn("flex flex-wrap items-center gap-2 px-3 py-2", (n.status !== "active" || n.hiddenByParent) && "opacity-60")}
              style={{ paddingLeft: `${0.75 + n.depth * 1.25}rem` }}
              onKeyDown={(e) => {
                if (!canManage || !e.altKey) return;
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  move(n, -1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  move(n, 1);
                }
              }}
            >
              <button type="button" onClick={() => setEditing(n.id)} className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:underline">
                {n.title}
                <span className="ml-2 text-xs text-muted-foreground">
                  {n.kind === "module" ? (n.is_extra ? "Módulo · Extra" : "Módulo") : n.kind === "submodule" ? "Submódulo" : LESSON_TYPE_LABELS[n.lesson_type ?? ""] ?? "Clase"}
                  {UNLOCK_LABEL[(n.unlock_rule?.type as string) ?? "open"] ? ` · ${UNLOCK_LABEL[(n.unlock_rule?.type as string) ?? "open"]}` : ""}
                  {n.hiddenByParent ? " · Oculto porque el módulo está inactivo" : ""}
                  {n.kind === "lesson" && n.lesson_type === "video" && !byId.get(n.id)?.hasTranscript ? " · Sin transcripción" : ""}
                  {n.kind === "lesson" && byId.get(n.id)?.transcript && byId.get(n.id)?.transcript?.status !== "ready" ? " · Transcripción sin indexar" : ""}
                </span>
              </button>
              {(commentCounts[n.id] ?? 0) > 0 && (
                <Link href={`/dashboard/portal/${productId}?tab=comunidad&clase=${n.id}`} className="rounded-full bg-warn/15 px-2 py-0.5 text-xs text-foreground hover:underline">
                  {commentCounts[n.id] === 1 ? "1 comentario nuevo" : `${commentCounts[n.id]} comentarios nuevos`}
                </Link>
              )}
              <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{STATUS_LABEL[n.status]}</span>
              {canActivate && (
                <button type="button" onClick={() => toggle(n)} disabled={pending} className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                  {n.status === "active" ? "Apagar" : "Prender"}
                </button>
              )}
              {canManage && (
                <>
                  <button type="button" aria-label="Subir" onClick={() => move(n, -1)} disabled={pending} className="rounded-md p-1 hover:bg-accent">
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" aria-label="Bajar" onClick={() => move(n, 1)} disabled={pending} className="rounded-md p-1 hover:bg-accent">
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {n.kind !== "lesson" && (
                    <button type="button" onClick={() => setAdding({ kind: "lesson", parentId: n.id })} className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                      + Clase
                    </button>
                  )}
                  {n.kind === "module" && (
                    <button type="button" onClick={() => setAdding({ kind: "submodule", parentId: n.id })} className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                      + Submódulo
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Alt + ↑ / ↓ mueve la fila con el teclado. Lo inactivo no existe para el estudiante; lo archivado se oculta y conserva el avance.</p>
      {msg && (
        <p role="alert" className="text-sm text-destructive">
          {msg}
        </p>
      )}

      {adding && (
        <div role="dialog" aria-modal="true" aria-label="Agregar" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-background p-4 shadow-xl">
            <h3 className="text-sm font-semibold">{adding.kind === "module" ? "Nuevo módulo" : adding.kind === "submodule" ? "Nuevo submódulo" : "Nueva clase"}</h3>
            <label className="block text-xs text-muted-foreground">
              Título
              <input className={fieldInput} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </label>
            {adding.kind === "lesson" && (
              <label className="block text-xs text-muted-foreground">
                Tipo
                <select className={fieldInput} value={lessonType} onChange={(e) => setLessonType(e.target.value)}>
                  {["video", "html", "document", "quiz", "activity"].map((t) => (
                    <option key={t} value={t}>
                      {LESSON_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAdding(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent">
                Cancelar
              </button>
              <button type="button" onClick={add} disabled={pending || !title.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && byId.get(editing) && (
        <ItemDrawer key={editing} productId={productId} item={byId.get(editing)!} canManage={canManage} canActivate={canActivate} otherPrograms={otherPrograms} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ItemDrawer({ productId, item, canManage, canActivate, otherPrograms, onClose }: { productId: string; item: ContentRow; canManage: boolean; canActivate: boolean; otherPrograms: Array<{ id: string; name: string }>; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? "");
  const [videoUrl, setVideoUrl] = useState(item.video_url ?? "");
  const [html, setHtml] = useState(item.html_content ?? "");
  const [required, setRequired] = useState(item.required);
  const [comments, setComments] = useState(item.comments_enabled);
  const [extra, setExtra] = useState(item.is_extra === true);
  const rule = (item.unlock_rule ?? { type: "open" }) as Record<string, unknown>;
  const [ruleType, setRuleType] = useState(String(rule.type ?? "open"));
  const [ruleDate, setRuleDate] = useState(String(rule.date ?? ""));
  const [ruleDays, setRuleDays] = useState(rule.days != null ? String(rule.days) : "");
  const [display, setDisplay] = useState(String(rule.display ?? ""));
  const [lockedText, setLockedText] = useState(String(rule.locked_text ?? rule.coming_soon_text ?? ""));
  const [transcript, setTranscript] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  // Una clase de video también puede llevar una página: el portal la muestra debajo del video (00490).
  const hasPage = item.kind === "lesson" && (item.lesson_type === "html" || item.lesson_type === "video");

  function save() {
    const unlock: Record<string, unknown> = { type: ruleType };
    if (ruleType === "fixed_date") unlock.date = ruleDate || null;
    if (ruleType === "days_after_start") unlock.days = ruleDays === "" ? null : Number(ruleDays);
    if (ruleType !== "open" && display) unlock.display = display;
    if (display === "coming_soon" && lockedText) unlock.coming_soon_text = lockedText;
    else if ((ruleType === "journey_item" || ruleType === "automation") && lockedText) unlock.locked_text = lockedText;
    const patch: Record<string, unknown> = { title, description, required, comments_enabled: comments, unlock_rule: unlock };
    if (item.kind === "lesson" && item.lesson_type === "video") patch.video_url = videoUrl;
    if (hasPage) patch.html_content = html;
    if (item.kind === "module") patch.is_extra = extra;
    start(async () => {
      const res = await updateProgramItem(productId, item.id, patch);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      setMsg({ kind: "ok", text: res.data.warning ? `Guardado. ${res.data.warning}` : "Guardado." });
      router.refresh();
    });
  }

  function upload(kind: ProgramUploadKind, file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await uploadProgramFile(productId, item.id, kind, fd);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      setMsg({ kind: "ok", text: "Archivo subido." });
      router.refresh();
    });
  }

  function saveTranscript(text: string, format: "vtt" | "srt" | "txt") {
    start(async () => {
      const res = await saveLessonTranscript(productId, item.id, text, format);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      setMsg({ kind: res.data.status === "ready" ? "ok" : "error", text: res.data.status === "ready" ? `Transcripción indexada (${res.data.chunks} partes).` : "La transcripción quedó guardada pero no se pudo indexar (falta conectar Voyage o falló). Se reintenta desde Conocimiento." });
      setTranscript("");
      router.refresh();
    });
  }

  const disabled = !canManage || pending;
  return (
    <div role="dialog" aria-modal="true" aria-label={item.title} className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-lg space-y-4 overflow-y-auto border-l border-border bg-background p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{item.title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent">
            Cerrar
          </button>
        </div>
        <label className="block text-xs text-muted-foreground">
          Título
          <input className={fieldInput} value={title} disabled={disabled} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-xs text-muted-foreground">
          Descripción
          <textarea className={fieldInput} rows={3} value={description} disabled={disabled} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {item.kind === "lesson" && item.lesson_type === "video" && (
          <label className="block text-xs text-muted-foreground">
            Link del video (YouTube, Vimeo, Loom, Drive o Fathom)
            <input className={fieldInput} value={videoUrl} disabled={disabled} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://" />
          </label>
        )}
        {item.kind === "lesson" && item.lesson_type === "video" && canManage && (
          <FathomPicker
            productId={productId}
            itemId={item.id}
            linked={!!item.source_call_id}
            onPicked={(url, warning) => {
              setVideoUrl(url);
              setMsg({ kind: warning ? "error" : "ok", text: warning ? `Guardado. ${warning}` : "Listo: la clase usa esa grabación de Fathom y su transcripción." });
              router.refresh();
            }}
          />
        )}
        {hasPage && (
          <div className="space-y-1">
            <label className="block text-xs text-muted-foreground">
              {item.lesson_type === "video" ? "Página debajo del video (opcional): pegala acá o subí un .html de hasta 1 MB" : "Página (pegala acá o subí un .html de hasta 1 MB)"}
              <textarea className={cn(fieldInput, "font-mono")} rows={6} value={html} disabled={disabled} onChange={(e) => setHtml(e.target.value)} />
            </label>
            {canManage && <input type="file" accept=".html,text/html" aria-label="Subir página HTML" onChange={(e) => upload("html", e.target.files?.[0])} className="text-xs" />}
          </div>
        )}
        {item.kind === "lesson" && (item.lesson_type === "quiz" || item.lesson_type === "activity") && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold">{item.lesson_type === "quiz" ? "Evaluación" : "Actividad"}</legend>
            <PortalFormEditor
              productId={productId}
              kind={item.lesson_type}
              itemId={item.id}
              canEdit={canManage}
              initial={item.portalForm ?? { name: item.title, intro: "", fields: [], quiz: {}, grading: { enabled: false }, points: item.points ?? null }}
            />
          </fieldset>
        )}
        {item.kind === "lesson" && item.lesson_type === "document" && canManage && (
          <label className="block text-xs text-muted-foreground">
            Documento PDF (hasta 20 MB){item.document_path ? " · ya hay uno cargado" : ""}
            <input type="file" accept="application/pdf" onChange={(e) => upload("document", e.target.files?.[0])} className="mt-1 block text-xs" />
          </label>
        )}
        {canManage && (
          <label className="block text-xs text-muted-foreground">
            {item.kind === "module" ? "Imagen de portada (16:9, JPG, PNG o WebP, hasta 2 MB)" : "Imagen de vista previa (JPG, PNG o WebP, hasta 2 MB)"}
            {(item.kind === "module" ? item.cover_path : item.thumbnail_path) ? " · ya hay una cargada" : ""}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => upload(item.kind === "module" ? "cover" : "thumbnail", e.target.files?.[0])} className="mt-1 block text-xs" />
          </label>
        )}
        {item.kind === "lesson" && canManage && (
          <label className="block text-xs text-muted-foreground">
            Recurso (archivo, hasta 20 MB)
            <input type="file" onChange={(e) => upload("resource", e.target.files?.[0])} className="mt-1 block text-xs" />
          </label>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} disabled={disabled} onChange={(e) => setRequired(e.target.checked)} /> Obligatoria
          </label>
          {item.kind === "module" && (
            <label className="flex items-center gap-2 text-sm" title="En el portal va en la sección Extras, sin número y fuera del avance">
              <input type="checkbox" checked={extra} disabled={disabled} onChange={(e) => setExtra(e.target.checked)} /> Extra (va en la sección Extras del portal)
            </label>
          )}
          {item.kind === "lesson" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={comments} disabled={disabled} onChange={(e) => setComments(e.target.checked)} /> Comentarios
              {item.kind === "lesson" && (
                <Link href={`/dashboard/portal/${productId}?tab=comunidad&clase=${item.id}`} className="ml-2 text-xs text-primary-ink hover:underline">
                  Ver los comentarios
                </Link>
              )}
            </label>
          )}
        </div>

        <fieldset className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Cuándo se abre</legend>
          <select className={fieldInput} value={ruleType} disabled={disabled} onChange={(e) => setRuleType(e.target.value)}>
            <option value="open">Abierto</option>
            <option value="fixed_date">En una fecha</option>
            <option value="days_after_start">N días después de empezar</option>
            <option value="challenge_started">Al empezar el Reto</option>
            <option value="journey_item">Lo abre un paso del camino</option>
            <option value="automation">Lo abre una automatización</option>
          </select>
          {ruleType === "fixed_date" && <input type="date" className={fieldInput} value={ruleDate} disabled={disabled} onChange={(e) => setRuleDate(e.target.value)} aria-label="Fecha" />}
          {ruleType === "days_after_start" && <input type="number" min={0} className={fieldInput} value={ruleDays} disabled={disabled} onChange={(e) => setRuleDays(e.target.value)} aria-label="Días" />}
          {ruleType !== "open" && (
            <>
              <label className="block text-xs text-muted-foreground">
                Mientras está bloqueado se ve
                <select className={fieldInput} value={display} disabled={disabled} onChange={(e) => setDisplay(e.target.value)}>
                  <option value="">{ruleType === "fixed_date" ? "Próximamente (por defecto)" : "Con candado (por defecto)"}</option>
                  <option value="locked">Con candado</option>
                  <option value="coming_soon">Próximamente</option>
                  <option value="hidden">Oculto</option>
                </select>
              </label>
              {(display === "coming_soon" || ruleType === "journey_item" || ruleType === "automation") && (
                <label className="block text-xs text-muted-foreground">
                  Texto que ve el estudiante (hasta 80)
                  <input className={fieldInput} maxLength={80} value={lockedText} disabled={disabled} onChange={(e) => setLockedText(e.target.value)} />
                </label>
              )}
            </>
          )}
        </fieldset>

        {item.kind === "lesson" && item.lesson_type === "video" && canManage && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold">Transcripción</legend>
            {(() => {
              const b = transcriptBadge(item.transcript ?? (item.hasTranscript ? { status: "ready", chunks: null, at: null } : null));
              return (
                <div
                  role="status"
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
                    b.tone === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                    b.tone === "warn" && "bg-warn/15 text-foreground",
                    b.tone === "missing" && "bg-muted text-muted-foreground",
                  )}
                >
                  <span className="font-semibold">{b.tone === "ok" ? "✓ " : ""}{b.label}</span>
                  <span>{b.detail}</span>
                </div>
              );
            })()}
            <p className="text-xs text-muted-foreground">
              {item.hasTranscript
                ? "El estudiante no la ve: la usa el tutor para responder y citar el minuto. Para reemplazarla, subí otro archivo o pegá el texto nuevo."
                : "El tutor solo usa las clases con transcripción. Con .vtt o .srt se guarda el segundo de cada parte."}
            </p>
            <input
              type="file"
              accept=".vtt,.srt,.txt,text/plain,text/vtt"
              aria-label="Subir transcripción"
              className="text-xs"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                const fmt = f ? transcriptFormat(f.name) : null;
                if (!f || !fmt) return setMsg({ kind: "error", text: "Subí un archivo .vtt, .srt o .txt" });
                saveTranscript(await f.text(), fmt);
              }}
            />
            <textarea className={fieldInput} rows={4} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={item.hasTranscript ? "Pegá acá el texto nuevo para reemplazarla" : "O pegá el texto acá"} />
            <button type="button" onClick={() => saveTranscript(transcript, "txt")} disabled={pending || !transcript.trim()} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-60">
              {item.hasTranscript ? "Reemplazar transcripción" : "Guardar transcripción"}
            </button>
          </fieldset>
        )}

        {canManage && item.kind !== "submodule" && otherPrograms.length > 0 && (
          <CopyToProgram productId={productId} itemId={item.id} programs={otherPrograms} onDone={(text) => setMsg({ kind: "ok", text })} onError={(text) => setMsg({ kind: "error", text })} />
        )}

        {msg && (
          <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
            {msg.text}
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2">
          {canActivate && item.status !== "archived" ? (
            <button
              type="button"
              onClick={() =>
                window.confirm("¿Archivar? Se oculta para todos y conserva el avance.") &&
                start(async () => {
                  const res = await setProgramItemStatus(productId, item.id, "archived");
                  if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
                  onClose();
                  router.refresh();
                })
              }
              className="rounded-lg px-3 py-1.5 text-sm text-destructive hover:bg-accent"
            >
              Archivar
            </button>
          ) : (
            <span />
          )}
          {canManage && (
            <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60">
              {pending ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** «Copiar a otro programa» (F50): copias nuevas e inactivas en el programa elegido. */
function CopyToProgram({ productId, itemId, programs, onDone, onError }: { productId: string; itemId: string; programs: Array<{ id: string; name: string }>; onDone: (t: string) => void; onError: (t: string) => void }) {
  const [target, setTarget] = useState(programs[0]?.id ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
      <label className="min-w-0 flex-1 text-xs text-muted-foreground">
        Copiar a otro programa
        <select className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground" value={target} onChange={(e) => setTarget(e.target.value)}>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={pending || !target}
        onClick={() =>
          start(async () => {
            const res = await copyProgramItemToProduct(productId, itemId, target);
            if (!res.ok) return onError(res.error.message);
            onDone(`Copiado (${res.data.count === 1 ? "1 ítem" : `${res.data.count} ítems`}). La copia quedó inactiva en el otro programa.`);
          })
        }
        className="h-9 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60"
      >
        {pending ? "Copiando…" : "Copiar"}
      </button>
    </div>
  );
}

/**
 * «Elegir un Fathom» (F46): las grabaciones de Fathom del equipo, con buscador. Guarda `source_call_id`, el link
 * compartido y la transcripción. Con link compartido, el video se ve dentro del portal (`/embed/`); si no, el portal
 * muestra «Ver la grabación». Sin Fathom conectado, lleva a Integraciones.
 */
function FathomPicker({ productId, itemId, linked, onPicked }: { productId: string; itemId: string; linked: boolean; onPicked: (videoUrl: string, warning: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ connected: boolean; calls: Array<{ id: string; title: string; recorded_at: string; shared: boolean }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timeZone = useViewerTimezone();
  const when = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone });

  function load(text: string) {
    setQ(text);
    start(async () => {
      const r = await listFathomForLesson(text);
      if (r.ok) setData(r.data);
      else setError(r.error.message);
    });
  }
  function pick(callId: string) {
    setError(null);
    start(async () => {
      const r = await pickFathomForLesson(productId, itemId, callId);
      if (!r.ok) return setError(r.error.message);
      setOpen(false);
      onPicked(r.data.videoUrl, r.data.warning);
    });
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => { setOpen(!open); if (!open) load(""); }} className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent">
          Elegir un Fathom
        </button>
        {linked && <span className="text-muted-foreground">Usa una grabación de Fathom: con link compartido se ve dentro del portal.</span>}
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border border-border p-2">
          {data && !data.connected ? (
            <p className="text-sm">
              Fathom no está conectado.{" "}
              <Link href="/dashboard/settings/integrations" className="font-medium text-primary-ink hover:underline">
                Conectalo en Integraciones
              </Link>
            </p>
          ) : (
            <>
              <input value={q} onChange={(e) => load(e.target.value)} placeholder="Buscar una grabación…" aria-label="Buscar una grabación de Fathom" className={fieldInput} />
              {data && data.calls.length === 0 ? (
                <p className="text-muted-foreground">No hay grabaciones{q ? " con ese nombre" : ""}.</p>
              ) : (
                <ul className="max-h-56 divide-y divide-border overflow-auto rounded-md border border-border text-sm" aria-busy={pending}>
                  {(data?.calls ?? []).map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate">
                        {c.title} <span className="text-xs text-muted-foreground">· {when.format(new Date(c.recorded_at))}{c.shared ? "" : " · sin link compartido"}</span>
                      </span>
                      <button type="button" disabled={pending} onClick={() => pick(c.id)} className="text-xs font-medium text-primary-ink hover:underline">
                        Usar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
