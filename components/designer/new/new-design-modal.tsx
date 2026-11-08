"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Plus, Sparkles, X } from "lucide-react";
import { createDesign } from "@/lib/actions/designer/designs";
import { importHtml } from "@/lib/actions/designer/import";
import type { AiAttachment } from "@/lib/ai-threads/schema";
import type { DesignKind } from "@/lib/designer/contracts";
import { FORMATS } from "@/lib/designer/formats";
import {
  buildCreateInput,
  canCreate,
  createDisabledReason,
  formatOptions,
  formatShape,
  HOW_OPTIONS,
  initialNewFlow,
  KIND_OPTIONS,
  modalTitle,
  needsFormat,
  nextStep,
  pagesHelp,
  prevStep,
  primaryLabel,
  setFormat,
  setHow,
  setKind,
  setMultiPage,
  stepLabels,
  type NewFlowState,
} from "@/lib/designer/screens/new-flow";
import { IMAGE_ACCEPT } from "@/lib/designer/screens/uploads";
import type { DesignStyle } from "@/lib/designer/styles";
import { cn } from "@/lib/utils";
import { HtmlStep } from "@/components/designer/import/html-step";
import { DesignerDialog, primaryButton, secondaryButton, smallButton, textareaClass } from "@/components/designer/editor/overlays";
import { useImageUpload } from "@/components/designer/editor/use-image-upload";
import { HowIllustration } from "./illustrations";

/**
 * El modal «Nuevo diseño / Nueva plantilla» de tres pasos (F16, §11.3). Toda la lógica (qué se ofrece, cuándo se
 * puede crear, qué se manda) está en `lib/designer/screens/new-flow.ts`; esto solo la dibuja.
 */
export function NewDesignModal({ initialKind = "design", styles, onClose }: { initialKind?: DesignKind; styles: readonly DesignStyle[]; onClose: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<NewFlowState>(() => initialNewFlow(initialKind));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { upload, busy: uploading, error: uploadError, clearError } = useImageUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const baseRef = useRef<HTMLInputElement>(null);

  const labels = stepLabels(state);
  const reason = createDisabledReason(state);
  const last = state.step === 3;
  const disabled = creating || uploading || (last && !canCreate(state));

  async function addAttachment(file: File | undefined) {
    if (!file) return;
    const uploaded = await upload(file);
    if (!uploaded) return;
    const attachment: AiAttachment = { asset_path: uploaded.path, name: uploaded.name, mime: uploaded.mime };
    setState((s) => ({ ...s, attachments: [...s.attachments, attachment].slice(0, 6) }));
  }

  async function setBase(file: File | undefined) {
    if (!file) return;
    const uploaded = await upload(file);
    if (uploaded) setState((s) => ({ ...s, baseImage: { path: uploaded.path, name: uploaded.name } }));
  }

  async function submit() {
    if (!last) {
      setState(nextStep);
      return;
    }
    if (!canCreate(state)) return;
    setCreating(true);
    setError(null);
    try {
      if (state.how === "html" && state.html) {
        const result = await importHtml({ uploadId: state.html.uploadId, kind: state.kind, as: state.html.as });
        if (!result.ok) {
          setError(result.error);
          setCreating(false);
          return;
        }
        router.push(result.data.href);
        return;
      }
      const result = await createDesign(buildCreateInput(state));
      if (!result.ok) {
        setError(result.error);
        setCreating(false);
        return;
      }
      router.push(result.data.notice ? `${result.data.href}?ia=${result.data.notice}` : result.data.href);
    } catch {
      setError("No pudimos crear el diseño. Probá de nuevo.");
      setCreating(false);
    }
  }

  const indicator = (
    <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Pasos">
      {labels.map((label, i) => {
        const n = i + 1;
        const current = state.step === n;
        return (
          <li
            key={label}
            aria-current={current ? "step" : undefined}
            className={cn("rounded-full px-2.5 py-1 font-medium", current ? "bg-primary/15 text-primary-ink" : state.step > n ? "bg-good/15 text-good" : "bg-muted text-muted-foreground")}
          >
            {n}. {label}
          </li>
        );
      })}
    </ol>
  );

  return (
    <DesignerDialog
      title={modalTitle(state.kind)}
      label={modalTitle(state.kind)}
      onClose={onClose}
      header={indicator}
      footer={
        <>
          {last && reason && <p className="mr-auto text-xs text-muted-foreground">{reason}</p>}
          <button type="button" className={secondaryButton} onClick={() => (state.step === 1 ? onClose() : setState(prevStep))} disabled={creating}>
            {state.step === 1 ? "Cancelar" : "Atrás"}
          </button>
          <button type="button" className={primaryButton} onClick={submit} disabled={disabled} title={disabled && reason ? reason : undefined}>
            {creating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {primaryLabel(state)}
          </button>
        </>
      }
    >
      {state.step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Qué querés crear">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={state.kind === option.key}
              onClick={() => setState((s) => setKind(s, option.key))}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-colors",
                state.kind === option.key ? "border-primary-edge bg-primary/10" : "border-border hover:border-muted-foreground/50",
              )}
            >
              {option.key === "design" ? <Sparkles className="h-[18px] w-[18px]" aria-hidden /> : <FileText className="h-[18px] w-[18px]" aria-hidden />}
              <span className="text-sm font-semibold">{option.title}</span>
              <span className="text-[12.5px] leading-snug text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </div>
      )}

      {state.step === 2 && (
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Cómo empezás">
          {HOW_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={state.how === option.key}
              onClick={() => setState((s) => setHow(s, option.key))}
              className={cn(
                "flex flex-col gap-1.5 rounded-[14px] border p-3 pb-3.5 text-left transition-all hover:-translate-y-px",
                state.how === option.key ? "border-primary-edge bg-primary/10" : "border-border hover:border-muted-foreground/50",
              )}
            >
              <HowIllustration how={option.key} />
              <span className="text-sm font-semibold">{option.title}</span>
              <span className="text-xs leading-snug text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </div>
      )}

      {state.step === 3 && state.how === "html" && <HtmlStep kind={state.kind} onChange={(html) => setState((s) => ({ ...s, html }))} />}

      {state.step === 3 && needsFormat(state.how) && (
        <>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Páginas</span>
            <div role="group" aria-label="Páginas" className="inline-flex gap-0.5 rounded-[9px] border border-border bg-muted p-[3px]">
              {[
                [false, "Una página"],
                [true, "Varias páginas"],
              ].map(([multi, label]) => (
                <button
                  key={String(multi)}
                  type="button"
                  aria-pressed={state.multiPage === multi}
                  onClick={() => setState((s) => setMultiPage(s, multi as boolean))}
                  className={cn("rounded-md px-3 py-1 text-[12.5px] font-medium", state.multiPage === multi ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
                >
                  {label as string}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{pagesHelp(state.multiPage)}</p>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5" role="radiogroup" aria-label="Formato">
            {formatOptions(state).map((key) => {
              const shape = formatShape(key);
              const def = FORMATS[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={state.format === key}
                  onClick={() => setState((s) => setFormat(s, key))}
                  className={cn("flex flex-col items-center gap-2 rounded-xl border px-2.5 py-3 text-center", state.format === key ? "border-primary-edge bg-primary/10" : "border-border hover:border-muted-foreground/50")}
                >
                  <span
                    aria-hidden
                    className="rounded-[3px] border border-border bg-muted"
                    style={{ width: shape.width, height: shape.height, background: shape.web ? "linear-gradient(var(--border) 0 14px, var(--muted) 14px)" : undefined }}
                  />
                  <span className="text-[12.5px] font-semibold">{def.label}</span>
                  <span className="text-[11px] text-muted-foreground">{def.description}</span>
                </button>
              );
            })}
          </div>
          {state.format === "web" && <p className="text-xs text-muted-foreground">Una página web no se exporta a PDF ni a imagen: se comparte con su link.</p>}

          {state.how === "ai" && (
            <>
              <div>
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Estilo</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Estilo">
                  {styles.map((style) => {
                    const active = (state.style ?? "auto") === style.key;
                    return (
                      <button
                        key={style.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setState((s) => ({ ...s, style: style.key === "auto" ? null : style.key }))}
                        className={cn("flex flex-col gap-1 rounded-[10px] border px-2.5 py-2 text-left", active ? "border-primary-edge bg-primary/10" : "border-border hover:border-muted-foreground/50")}
                      >
                        <span className="flex" aria-hidden>
                          {[style.palette.bg, style.palette.text, style.palette.accent].map((color, i) => (
                            <i key={i} className={cn("h-3 w-3 rounded-full border border-black/15", i > 0 && "-ml-[3px]")} style={{ background: color }} />
                          ))}
                        </span>
                        <span className="text-[12.5px] font-semibold">{style.name}</span>
                        {style.description && <span className="text-[11px] leading-tight text-muted-foreground">{style.description}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Contale a la IA qué querés</span>
                <textarea
                  value={state.prompt}
                  onChange={(e) => setState((s) => ({ ...s, prompt: e.target.value }))}
                  rows={4}
                  maxLength={4000}
                  className={textareaClass}
                  placeholder={
                    state.kind === "template"
                      ? "Ej.: un certificado elegante para el curso, con el nombre, el curso, la fecha y la firma"
                      : "Ej.: un carrusel de 6 láminas sobre los 3 errores al contratar a tu primer vendedor, con mi marca"
                  }
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => void addAttachment(e.target.files?.[0]).then(() => (e.target.value = ""))} />
                <button type="button" className={smallButton} disabled={uploading || state.attachments.length >= 6} onClick={() => { clearError(); fileRef.current?.click(); }}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                  Subir imágenes
                </button>
                {state.attachments.map((a, i) => (
                  <span key={a.asset_path} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-2.5 pr-1">
                    {a.name}
                    <button type="button" aria-label={`Quitar ${a.name}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-accent" onClick={() => setState((s) => ({ ...s, attachments: s.attachments.filter((_, j) => j !== i) }))}>
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
                {state.attachments.length === 0 && <span className="text-muted-foreground">Fotos, tu logo o referencias que te gustan.</span>}
              </div>
            </>
          )}

          {state.how === "image" && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input ref={baseRef} type="file" accept={IMAGE_ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => void setBase(e.target.files?.[0]).then(() => (e.target.value = ""))} />
                <button type="button" className={smallButton} disabled={uploading} onClick={() => { clearError(); baseRef.current?.click(); }}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
                  {state.baseImage ? "Cambiar la imagen base" : "Subir la imagen base"}
                </button>
                {state.baseImage ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pl-2.5 pr-1">
                    {state.baseImage.name}
                    <button type="button" aria-label="Quitar la imagen base" className="grid h-4 w-4 place-items-center rounded-full hover:bg-accent" onClick={() => setState((s) => ({ ...s, baseImage: null }))}>
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ) : (
                  <span className="text-muted-foreground">PNG, JPG o WebP de hasta 20 MB.</span>
                )}
              </div>
              {state.kind === "template" && (
                <label className="flex items-start gap-2 text-[13px]">
                  <input type="checkbox" className="mt-0.5" checked={state.proposeTexts} onChange={(e) => setState((s) => ({ ...s, proposeTexts: e.target.checked }))} />
                  <span>Después, que la IA me proponga dónde van los textos y las variables</span>
                </label>
              )}
            </>
          )}
        </>
      )}

      {(uploadError || error) && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
          {uploadError ?? error}
        </p>
      )}
    </DesignerDialog>
  );
}
