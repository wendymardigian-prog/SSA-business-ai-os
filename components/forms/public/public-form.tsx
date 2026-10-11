"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { attributionFromParams, parseCookieHeader, sanitizeAttribution } from "@/lib/attribution/collect";
import { effectiveAttribution } from "@/lib/attribution/merge";
import { cookieEnv, storedFromEffective } from "@/lib/attribution/browser";
import { parseStored } from "@/lib/attribution/store";
import { decodeAttr } from "@/lib/forms/embed-attr";
import { hiddenValues, prefillFromParams } from "@/lib/forms/prefill";
import { validateSubmission } from "@/lib/forms/submission-schema";
import { visibleFieldKeys } from "@/lib/forms/visibility";
import {
  answersForSubmit,
  buildPayload,
  buildSubmitFormData,
  checkClientFiles,
  describeFailure,
  submitLabelOf,
  toFormFields,
  type PublicFormData,
} from "@/lib/forms/public-client";
import { countryFromTimezone } from "@/lib/scheduling/phone-countries";
import { submitOriginFields } from "@/lib/forms/site-submit";
import { useEmbedBridge } from "@/components/scheduling/booker/use-embed-bridge";
import { FIELD_RENDERERS } from "./fields/registry";
import { TurnstileWidget } from "./turnstile-widget";
import { ContractReader, ContractSigning } from "./contract-block";
import { canSign } from "@/lib/forms/contract/signature-input";

/**
 * El formulario público (F9). Se usa igual en `/f/[slug]`, dentro de un embed y
 * dentro de una página del sitio (`mode`). El navegador valida para dar
 * feedback rápido con LA MISMA función que el servidor; el servidor vuelve a
 * validar todo, siempre.
 */

export type FormMode = "public_page" | "embed" | "site";

export interface RenderedSuccess {
  mode: "message" | "redirect";
  title?: string;
  body?: string;
  button?: { label: string; url: string };
  url?: string;
}

export interface PublicFormProps {
  form: PublicFormData;
  /** Parámetros de la URL de la página (el servidor los pasa: así el prellenado es el mismo en servidor y navegador). */
  params: Record<string, string>;
  mode: FormMode;
  /** Valores fijados por el código (`<Formulario prefill>`): ganan sobre la URL. */
  explicitPrefill?: Record<string, string | number>;
  /** Vista previa del editor: se ve igual pero no envía. */
  preview?: boolean;
  /** Solo en modo `site`: la ruta de la página. */
  sitePath?: string;
  /** Link firmado por contacto (`?c=`), ya verificado o no: el servidor lo vuelve a verificar. */
  linkToken?: string;
  className?: string;
}

const DRAFT_KEY = (slug: string) => `ssa-form-draft:${slug}`;
const SID_KEY = "ssa-form-sid";

function newUuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/[x]/g, () => Math.floor(Math.random() * 16).toString(16));
}

function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SID_KEY);
    if (existing) return existing;
    const created = newUuid();
    window.sessionStorage.setItem(SID_KEY, created);
    return created;
  } catch {
    return newUuid();
  }
}

function sendBeacon(slug: string, kind: "view" | "start", sid: string, origin: FormMode) {
  // Un error acá no se le muestra a nadie.
  try {
    void fetch(`/api/public/forms/${encodeURIComponent(slug)}/beacon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, sid, origin }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // nada
  }
}

export function PublicForm({ form, params, mode, explicitPrefill, preview = false, sitePath, linkToken, className }: PublicFormProps) {
  const fields = useMemo(() => toFormFields(form.fields), [form.fields]);
  const prefill = useMemo(() => prefillFromParams(fields, params, { explicit: explicitPrefill }), [fields, params, explicitPrefill]);

  const [answers, setAnswers] = useState<Record<string, unknown>>(() => ({
    ...hiddenValues(fields, params),
    ...prefill.values,
  }));
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<RenderedSuccess | null>(null);
  const [alreadyAnswered, setAlreadyAnswered] = useState(false);
  const [changed, setChanged] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  // Contrato: la casilla de aceptación y la firma dibujada.
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState<{ dataUrl: string | null; strokes: number }>({ dataUrl: null, strokes: 0 });
  const isContract = form.type === "contract";
  const contractReady = !isContract || canSign({ accepted, signatureRequired: form.signature_required, drawn: !!signature.dataUrl });

  const idempotencyKey = useRef<string>(newUuid());
  const sid = useRef<string | null>(null);
  const started = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  // En un iframe avisa el alto (mismo protocolo que la Agenda).
  useEmbedBridge(mode === "embed");

  // Vista, y el borrador que quedó si el formulario cambió mientras se completaba.
  useEffect(() => {
    sid.current = getSessionId();
    if (!preview) sendBeacon(form.slug, "view", sid.current, mode);
    try {
      const saved = window.sessionStorage.getItem(DRAFT_KEY(form.slug));
      if (saved) {
        window.sessionStorage.removeItem(DRAFT_KEY(form.slug));
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === "object") setAnswers((prev) => ({ ...prev, ...(parsed as Record<string, unknown>) }));
      }
    } catch {
      // sessionStorage bloqueado: se sigue sin borrador.
    }
  }, [form.slug, preview, mode]);

  const onInteract = useCallback(() => {
    if (started.current || preview) return;
    started.current = true;
    if (sid.current) sendBeacon(form.slug, "start", sid.current, mode);
  }, [form.slug, preview, mode]);

  const setValue = useCallback((key: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const setFieldFiles = useCallback((key: string, list: File[]) => {
    setFiles((prev) => ({ ...prev, [key]: list }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const visible = useMemo(() => new Set(visibleFieldKeys(fields, answers as never)), [fields, answers]);

  /**
   * La atribución EFECTIVA de este envío (F6, F29): si la URL trae UTM, un id de clic o de
   * anuncio, esa visita es un toque nuevo y gana; si no, vale el último guardado (la cookie
   * `ssa_attr` en las páginas propias; en un embed, lo que mandó el script de la web que lo
   * contiene en `attr`). El servidor la vuelve a sanear: no se confía.
   */
  const collectAttribution = useCallback((): Record<string, unknown> => {
    try {
      const parentUrl = mode === "embed" ? params.referrer : undefined;
      const current = attributionFromParams(params, {
        referrer: parentUrl ?? document.referrer,
        landing: parentUrl ?? window.location.href,
        pageUrl: parentUrl ?? window.location.href,
        cookies: parseCookieHeader(document.cookie),
      });
      if (mode === "embed") {
        const fromEmbed = sanitizeAttribution(decodeAttr(params.attr));
        return effectiveAttribution(current, storedFromEffective(fromEmbed));
      }
      // Las páginas propias: la cookie `ssa_attr`; la URL actual manda si trae un toque nuevo.
      return effectiveAttribution(current, parseStored(cookieEnv(document, window.location).readStored()));
    } catch {
      return {};
    }
  }, [params, mode]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || preview) return;
    setGlobalError(null);

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fileCounts = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length]));
    const result = validateSubmission(fields, answersForSubmit(fields, answers), {
      defaultCountry: countryFromTimezone(timezone) ?? null,
      fileCounts,
    });
    const nextErrors: Record<string, string> = { ...result.errors };
    for (const field of fields) {
      if (field.type !== "file" || !visible.has(field.key)) continue;
      const problem = checkClientFiles(field, files[field.key] ?? []);
      if (problem) nextErrors[field.key] = problem;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const first = fields.find((f) => nextErrors[f.key]);
      if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first.key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (isContract && !contractReady) {
      setGlobalError(!accepted ? "Tenés que aceptar el contrato para poder firmarlo." : "Falta tu firma. Dibujala en el recuadro.");
      return;
    }
    if (!token) {
      setGlobalError("Esperá un momento a que termine la verificación e intentá de nuevo.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = buildPayload({
        idempotencyKey: idempotencyKey.current,
        turnstileToken: token,
        versionId: form.version_id,
        answers: answersForSubmit(fields, answers),
        honeypot,
        attribution: collectAttribution(),
        timezone,
        locale: navigator.language,
        screen: `${window.screen.width}x${window.screen.height}`,
        origin: submitOriginFields(mode, sitePath).origin,
        sitePath: submitOriginFields(mode, sitePath).site_path,
        linkToken,
        ...(isContract ? { accepted, signature: signature.dataUrl ?? undefined, signatureStrokes: signature.strokes } : {}),
      });
      const response = await fetch(`/api/public/forms/${encodeURIComponent(form.slug)}/submit`, {
        method: "POST",
        body: buildSubmitFormData(payload, files),
      });
      const body: unknown = await response.json().catch(() => null);

      if (response.ok && body && typeof body === "object" && (body as { ok?: boolean }).ok) {
        const success = (body as { success?: RenderedSuccess }).success;
        if (success?.mode === "redirect" && success.url) {
          window.location.assign(success.url);
          return;
        }
        setDone(success ?? { mode: "message", title: "¡Gracias!", body: "Recibimos tu respuesta." });
        return;
      }

      const failure = describeFailure(response.status, body);
      if (failure.kind === "fields") {
        setErrors(failure.fields);
        setGlobalError(failure.message);
      } else if (failure.kind === "already_answered") {
        setAlreadyAnswered(true);
      } else if (failure.kind === "form_changed") {
        try {
          window.sessionStorage.setItem(DRAFT_KEY(form.slug), JSON.stringify(answersForSubmit(fields, answers)));
        } catch {
          // sin sessionStorage no se conserva el borrador
        }
        setChanged(true);
      } else {
        setGlobalError(failure.message);
      }
    } catch {
      setGlobalError("No pudimos enviar tu respuesta. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSubmitting(false);
      // El token de Turnstile es de un solo uso: se pide otro para el próximo intento.
      setToken(null);
      setCaptchaReset((n) => n + 1);
    }
  }

  const wrapper = cn("mx-auto w-full max-w-[640px]", className);

  if (alreadyAnswered) {
    return (
      <div className={cn(wrapper, "py-10 text-center")}>
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-semibold">Ya respondiste, ¡gracias!</h2>
      </div>
    );
  }

  if (changed) {
    return (
      <div className={cn(wrapper, "py-10 text-center")}>
        <h2 className="text-lg font-semibold">El formulario cambió</h2>
        <p className="mt-1 text-sm text-muted-foreground">Recargá la página: tus respuestas se conservan.</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Recargar
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className={cn(wrapper, "space-y-4 py-10 text-center")}>
        <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" aria-hidden="true" />
        {done.title && <h2 className="text-2xl font-bold">{done.title}</h2>}
        {done.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{done.body}</p>}
        {done.button && (
          <a
            href={done.button.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {done.button.label}
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }

  const design = form.design ?? {};

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className={cn(wrapper, "space-y-6")}>
      {(design.title || design.intro) && (
        <header className="space-y-2">
          {design.title && <h1 className="text-2xl font-bold">{design.title}</h1>}
          {design.intro && <p className="whitespace-pre-line text-sm text-muted-foreground">{design.intro}</p>}
        </header>
      )}

      {preview && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          Vista previa: así lo ve quien responde. Acá no se envía nada.
        </p>
      )}

      {isContract && form.contract && <ContractReader title={form.contract.title} text={form.contract.text ?? ""} />}

      <div className="space-y-5">
        {fields.map((field) => {
          const Renderer = FIELD_RENDERERS[field.type];
          if (!Renderer || !visible.has(field.key) || prefill.hiddenByPrefill.has(field.key)) return null;
          return (
            <div key={field.key} data-field={field.key}>
              <Renderer
                field={field}
                value={answers[field.key]}
                onChange={(value) => setValue(field.key, value)}
                error={errors[field.key]}
                locked={prefill.locked.has(field.key)}
                files={files[field.key]}
                onFiles={(list) => setFieldFiles(field.key, list)}
                onInteract={onInteract}
              />
            </div>
          );
        })}
      </div>

      {isContract && form.contract && (
        <ContractSigning
          acceptLabel={form.contract.accept_label || "Leí y acepto el contrato"}
          signatureRequired={form.signature_required}
          accepted={accepted}
          onAccepted={(value) => {
            setAccepted(value);
            onInteract();
          }}
          onSignature={(dataUrl, strokes) => {
            setSignature({ dataUrl, strokes });
            onInteract();
          }}
          disabled={submitting}
        />
      )}

      {/* Campo trampa: una persona no lo ve ni lo llena; un bot sí. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Sitio web
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
        </label>
      </div>

      {form.turnstile_site_key && !preview ? (
        <TurnstileWidget siteKey={form.turnstile_site_key} onToken={setToken} onError={() => setCaptchaBroken(true)} resetKey={captchaReset} />
      ) : null}
      {captchaBroken && (
        <p role="alert" className="text-xs text-destructive">
          No se pudo cargar la verificación. Si usás un bloqueador de anuncios, desactivalo para esta página y recargá.
        </p>
      )}

      {globalError && (
        <div role="alert" className="text-center text-sm text-destructive">
          {globalError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || preview || (isContract && !contractReady)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Enviando...
          </>
        ) : (
          submitLabelOf(design, form.type)
        )}
      </button>
    </form>
  );
}
