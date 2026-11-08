"use client";
// @plantilla-quitar(servicios)

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { CenterDialog } from "@/components/tasks/overlay";
import { DialogField, fieldInput } from "@/components/content/dialog";
import { useViewerTimezone } from "@/components/dashboard-chrome";
import { addRecordingToPortal, portalTargets, recordingPortalPlaces } from "@/lib/actions/live-sessions";
import { suggestOccurrence } from "@/lib/program/add-to-portal";
import { cn } from "@/lib/utils";

type Targets = Extract<Awaited<ReturnType<typeof portalTargets>>, { ok: true }>["data"];
type Places = Array<{ productId: string; productName: string; where: string }>;

/**
 * Grabaciones › «⋯» (F65): «Agregar al portal» (recordings.to_portal) y, si ya está, «Ver en el portal».
 */
export function CallPortalMenu({ callId, inPortal, canAdd }: { callId: string; inPortal: boolean; canAdd: boolean }) {
  const [open, setOpen] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [places, setPlaces] = useState<Places | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => {
    if (open && inPortal && canAdd && !places) void recordingPortalPlaces(callId).then((r) => setPlaces(r.ok ? r.data : []));
  }, [open, inPortal, canAdd, places, callId]);
  if (!canAdd && !inPortal) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Más acciones" aria-expanded={open} onClick={() => setOpen((x) => !x)} className="rounded-md p-1 hover:bg-accent">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg">
          {canAdd && (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setWizard(true); }} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent">
              Agregar al portal
            </button>
          )}
          {inPortal &&
            (places === null ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">{canAdd ? "Buscando dónde está…" : "Está en el portal"}</p>
            ) : (
              places.map((p, i) => (
                <Link key={i} role="menuitem" href={`/dashboard/portal/${p.productId}`} className="block rounded-md px-2 py-1.5 hover:bg-accent">
                  Ver en el portal: <span className="text-muted-foreground">{p.productName} › {p.where}</span>
                </Link>
              ))
            ))}
        </div>
      )}
      {wizard && <AddToPortalWizard callId={callId} places={places} onClose={() => setWizard(false)} />}
    </div>
  );
}

function AddToPortalWizard({ callId, places, onClose }: { callId: string; places: Places | null; onClose: () => void }) {
  const router = useRouter();
  const tz = useViewerTimezone();
  const [targets, setTargets] = useState<Targets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [productId, setProductId] = useState("");
  const [where, setWhere] = useState<"live" | "lesson">("live");
  const [sessionKey, setSessionKey] = useState("");
  const [parent, setParent] = useState("");
  const [newModule, setNewModule] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [active, setActive] = useState(true);
  const [saveTranscript, setSaveTranscript] = useState(true);
  const [pending, start] = useTransition();

  useEffect(() => {
    void portalTargets(callId).then((r) => {
      if (!r.ok) return setError(r.error.message);
      setTargets(r.data);
      setTitle(r.data.title);
      if (r.data.programs.length === 1) setProductId(r.data.programs[0].id);
    });
  }, [callId]);

  const program = targets?.programs.find((p) => p.id === productId) ?? null;
  const occurrences = (program?.sessions ?? []).flatMap((s) => s.occurrences.map((o) => ({ ...o, sessionId: s.id, title: s.title })));
  useEffect(() => {
    if (!targets || !program) return;
    const best = suggestOccurrence(targets.recordedAt, occurrences);
    setSessionKey(best ? `${best.sessionId}|${best.occurs_on}` : "");
    setWhere(occurrences.length ? "live" : "lesson");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, targets]);
  const fmt = (iso: string) => new Intl.DateTimeFormat("es", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const canNext =
    step === 1 ? !!productId :
    step === 2 ? (where === "live" ? !!sessionKey : !!parent && (parent !== "new" || !!newModule.trim())) :
    step === 3 ? where === "live" || !!title.trim() : true;

  const submit = () =>
    start(async () => {
      setError(null);
      const [sid, occ] = sessionKey.split("|");
      const r = await addRecordingToPortal(callId, {
        productId,
        target: where === "live" ? { kind: "live", sessionId: sid, occursOn: occ } : parent === "new" ? { kind: "lesson", newModuleTitle: newModule } : { kind: "lesson", parentId: parent },
        title,
        description,
        videoUrl,
        active,
        saveTranscript,
      });
      if (!r.ok) return setError(r.error.message);
      router.refresh();
      onClose();
    });

  return (
    <CenterDialog label="Agregar al portal" onClose={onClose}>
      <div className="space-y-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Agregar al portal</h2>
          <span className="text-xs text-muted-foreground">Paso {step} de 4</span>
        </div>
        {places && places.length > 0 && (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            Ya está en {places.map((p) => `${p.productName} › ${p.where}`).join("; ")}. Podés agregarla igual a otro programa.
          </p>
        )}
        {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        {!targets ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : targets.programs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay programas con portal. Prendé el portal de un producto en Portal › Programas.</p>
        ) : step === 1 ? (
          <DialogField label="Programa">
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldInput}>
              <option value="">Elegí un programa</option>
              {targets.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </DialogField>
        ) : step === 2 ? (
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" checked={where === "live"} onChange={() => setWhere("live")} disabled={!occurrences.length} className="mt-1" />
              <span>Como grabación de una clase en vivo{!occurrences.length && <span className="block text-xs text-muted-foreground">No hay sesiones cerca de la fecha de la grabación.</span>}</span>
            </label>
            {where === "live" && occurrences.length > 0 && (
              <select value={sessionKey} onChange={(e) => setSessionKey(e.target.value)} className={fieldInput} aria-label="Sesión y fecha">
                <option value="">Elegí la sesión</option>
                {occurrences.map((o) => <option key={`${o.sessionId}|${o.occurs_on}`} value={`${o.sessionId}|${o.occurs_on}`}>{o.title} · {fmt(o.starts_at)}</option>)}
              </select>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={where === "lesson"} onChange={() => setWhere("lesson")} /> Como clase nueva
            </label>
            {where === "lesson" && (
              <div className="space-y-2">
                <select value={parent} onChange={(e) => setParent(e.target.value)} className={fieldInput} aria-label="Módulo">
                  <option value="">Elegí el módulo</option>
                  {program?.modules.map((m) => <option key={m.id} value={m.id}>{m.kind === "submodule" ? "— " : ""}{m.title}</option>)}
                  <option value="new">+ Nuevo módulo</option>
                </select>
                {parent === "new" && <input value={newModule} onChange={(e) => setNewModule(e.target.value)} placeholder="Nombre del módulo" className={fieldInput} />}
              </div>
            )}
          </div>
        ) : step === 3 ? (
          where === "live" ? (
            <div className="space-y-2">
              <p className="text-sm">La grabación de Fathom queda vinculada a esa fecha. Si querés, sumá un link de Drive o YouTube para el portal.</p>
              <input type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https:// (opcional)" className={fieldInput} />
            </div>
          ) : (
            <div className="space-y-3">
              <DialogField label="Título"><input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldInput} /></DialogField>
              <DialogField label="Descripción"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={fieldInput} /></DialogField>
              <DialogField label="Video" hint="Fathom no se muestra en el portal: pegá un link de Drive, YouTube, Vimeo o Loom (opcional).">
                <input type="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://" className={fieldInput} />
              </DialogField>
              <fieldset className="flex gap-4 text-sm">
                <label className="flex items-center gap-1"><input type="radio" checked={active} onChange={() => setActive(true)} /> Activa ahora</label>
                <label className="flex items-center gap-1"><input type="radio" checked={!active} onChange={() => setActive(false)} /> Dejar inactiva</label>
              </fieldset>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={saveTranscript} onChange={(e) => setSaveTranscript(e.target.checked)} className="mt-1" />
                Guardar la transcripción en Conocimiento, vinculada a esta clase y a cada minuto
              </label>
              <p className="text-xs text-muted-foreground">El desbloqueo se configura después en Portal › Contenido.</p>
            </div>
          )
        ) : (
          <div className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Programa:</span> {program?.name}</p>
            <p>
              <span className="text-muted-foreground">Dónde:</span>{" "}
              {where === "live" ? `Grabación de ${occurrences.find((o) => `${o.sessionId}|${o.occurs_on}` === sessionKey)?.title ?? "la sesión"} del ${sessionKey.split("|")[1]}` : `Clase nueva «${title}» en ${parent === "new" ? `el módulo nuevo «${newModule}»` : program?.modules.find((m) => m.id === parent)?.title}`}
            </p>
            {where === "lesson" && <p><span className="text-muted-foreground">Estado:</span> {active ? "Activa" : "Inactiva"}{saveTranscript ? " · con transcripción" : ""}</p>}
          </div>
        )}
        <div className="flex justify-between gap-2 pt-2">
          <button type="button" onClick={step === 1 ? onClose : () => setStep(step - 1)} className="rounded-md px-3 py-1.5 text-sm hover:bg-accent">{step === 1 ? "Cancelar" : "Atrás"}</button>
          {step < 4 ? (
            <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)} className={cn("rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground", !canNext && "opacity-50")}>Siguiente</button>
          ) : (
            <button type="button" disabled={pending} onClick={submit} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">{pending ? "Agregando…" : "Agregar al portal"}</button>
          )}
        </div>
      </div>
    </CenterDialog>
  );
}
