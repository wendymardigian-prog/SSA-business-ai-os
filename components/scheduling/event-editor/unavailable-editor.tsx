"use client";

/**
 * "Si no se puede agendar" (F58): los tres mensajes que puede ver el invitado
 * cuando la pagina publica no tiene horarios que ofrecer.
 *
 * Los textos y el boton se guardan en `event_types.unavailable_messages`. Con
 * "el mismo mensaje para los tres casos" se carga uno solo. Vacío = textos por
 * defecto (los del nucleo), que ya son razonables.
 *
 * La vista previa de la derecha usa la MISMA funcion que el booker
 * (`resolveUnavailableMessage`), asi lo que se ve acá es lo que se ve allá, y
 * se puede mirar en claro y en oscuro sin salir de la pantalla.
 */

import { useState, useTransition } from "react";
import { Notice } from "@/components/agents/fields";
import { Switch } from "@/components/ui/switch";
import { UnavailableState } from "@/components/scheduling/booker/states";
import {
  BODY_MAX,
  CTA_LABEL_MAX,
  TITLE_MAX,
  UNAVAILABLE_KEYS,
  UNAVAILABLE_KEY_LABELS,
  DEFAULT_UNAVAILABLE_MESSAGES,
} from "@/lib/scheduling/booker/unavailable";
import type { CtaKind, UnavailableKey, UnavailableMessage, UnavailableMessages } from "@/lib/scheduling/types";
import { saveUnavailableMessages } from "@/lib/actions/scheduling/event-types";

const CTA_KINDS: Array<{ value: CtaKind; label: string; hint: string }> = [
  { value: "whatsapp", label: "WhatsApp", hint: "Número internacional, por ejemplo +50688881234" },
  { value: "email", label: "Email", hint: "Una dirección de email" },
  { value: "link", label: "Link", hint: "Una dirección https://" },
];

const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

type Draft = Record<UnavailableKey, UnavailableMessage & { ctaEnabled: boolean; cta: { label: string; kind: CtaKind; value: string; prefill: string } }>;

function emptyCta() {
  return { label: "", kind: "whatsapp" as CtaKind, value: "", prefill: "" };
}

function toDraft(messages: UnavailableMessages | null): { sameForAll: boolean; draft: Draft } {
  const draft = {} as Draft;
  for (const key of UNAVAILABLE_KEYS) {
    const source = messages?.same_for_all ? messages.no_slots ?? messages.unavailable ?? messages.load_error : messages?.[key];
    draft[key] = {
      title: source?.title ?? "",
      body: source?.body ?? "",
      ctaEnabled: Boolean(source?.cta),
      cta: source?.cta ? { label: source.cta.label, kind: source.cta.kind, value: source.cta.value, prefill: source.cta.prefill ?? "" } : emptyCta(),
    };
  }
  return { sameForAll: messages?.same_for_all ?? true, draft };
}

function toPayload(sameForAll: boolean, draft: Draft): UnavailableMessages | null {
  const keys = sameForAll ? (["no_slots"] as UnavailableKey[]) : UNAVAILABLE_KEYS;
  const out: UnavailableMessages = { same_for_all: sameForAll };
  let any = false;
  for (const key of keys) {
    const d = draft[key];
    if (!d.title.trim() && !d.body.trim()) continue;
    any = true;
    out[key] = {
      title: d.title.trim(),
      body: d.body.trim(),
      ...(d.ctaEnabled && d.cta.label.trim() && d.cta.value.trim()
        ? { cta: { label: d.cta.label.trim(), kind: d.cta.kind, value: d.cta.value.trim(), ...(d.cta.prefill.trim() ? { prefill: d.cta.prefill.trim() } : {}) } }
        : {}),
    };
  }
  // Nada cargado = textos por defecto.
  return any ? out : null;
}

export function UnavailableEditor({
  eventId,
  eventTitle,
  hostName,
  messages,
}: {
  eventId: string;
  eventTitle: string;
  hostName: string;
  messages: UnavailableMessages | null;
}) {
  const initial = toDraft(messages);
  const [sameForAll, setSameForAll] = useState(initial.sameForAll);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [which, setWhich] = useState<UnavailableKey>("no_slots");
  const [previewTheme, setPreviewTheme] = useState<"light" | "dark">("light");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const editing = sameForAll ? "no_slots" : which;
  const current = draft[editing];
  const update = (patch: Partial<Draft[UnavailableKey]>) => setDraft((d) => ({ ...d, [editing]: { ...d[editing], ...patch } }));
  const updateCta = (patch: Partial<Draft[UnavailableKey]["cta"]>) => update({ cta: { ...current.cta, ...patch } });

  function save() {
    setNotice(null);
    const payload = toPayload(sameForAll, draft);
    startSaving(async () => {
      const result = await saveUnavailableMessages({ eventId, messages: payload });
      setNotice(result.ok ? { kind: "ok", text: "Mensajes guardados" } : { kind: "error", text: result.error });
    });
  }

  // La vista previa siempre muestra lo que se está editando ahora.
  const preview = toPayload(sameForAll, draft);

  return (
    <section className="space-y-4">
      {notice && <Notice tone={notice.kind === "ok" ? "success" : "error"}>{notice.text}</Notice>}

      <div className="rounded-xl border border-border p-4">
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="text-sm font-medium">El mismo mensaje para los tres casos</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Si lo apagás, podés escribir uno para cuando no quedan horarios, otro para cuando el calendario está caído y otro para cuando la página falla.
            </span>
          </span>
          <Switch checked={sameForAll} onChange={setSameForAll} label="El mismo mensaje para los tres casos" />
        </label>
      </div>

      {!sameForAll && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Caso">
          {UNAVAILABLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={which === key}
              onClick={() => setWhich(key)}
              className={
                which === key
                  ? "rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  : "rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              }
            >
              {UNAVAILABLE_KEY_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="un-title" className="text-sm font-medium">
              Título
            </label>
            <input
              id="un-title"
              value={current.title}
              maxLength={TITLE_MAX}
              placeholder={DEFAULT_UNAVAILABLE_MESSAGES[editing].title}
              onChange={(e) => update({ title: e.target.value })}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="un-body" className="text-sm font-medium">
              Texto
            </label>
            <textarea
              id="un-body"
              value={current.body}
              maxLength={BODY_MAX}
              rows={4}
              placeholder={DEFAULT_UNAVAILABLE_MESSAGES[editing].body}
              onChange={(e) => update({ body: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Podés usar <code>{"{{event_title}}"}</code> y <code>{"{{host_name}}"}</code>.
            </p>
          </div>

          <div className="rounded-xl border border-border p-4">
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">Mostrar un botón</span>
              <Switch checked={current.ctaEnabled} onChange={(v: boolean) => update({ ctaEnabled: v })} label="Mostrar un botón" />
            </label>

            {current.ctaEnabled && (
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <label htmlFor="un-cta-label" className="text-sm font-medium">
                    Texto del botón
                  </label>
                  <input id="un-cta-label" value={current.cta.label} maxLength={CTA_LABEL_MAX} onChange={(e) => updateCta({ label: e.target.value })} className={inputClass} />
                </div>
                <div className="space-y-1">
                  <label htmlFor="un-cta-kind" className="text-sm font-medium">
                    A dónde lleva
                  </label>
                  <select id="un-cta-kind" value={current.cta.kind} onChange={(e) => updateCta({ kind: e.target.value as CtaKind })} className={inputClass}>
                    {CTA_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="un-cta-value" className="text-sm font-medium">
                    Destino
                  </label>
                  <input id="un-cta-value" value={current.cta.value} onChange={(e) => updateCta({ value: e.target.value })} className={inputClass} />
                  <p className="text-xs text-muted-foreground">{CTA_KINDS.find((k) => k.value === current.cta.kind)?.hint}</p>
                </div>
                {current.cta.kind !== "link" && (
                  <div className="space-y-1">
                    <label htmlFor="un-cta-prefill" className="text-sm font-medium">
                      {current.cta.kind === "whatsapp" ? "Mensaje precargado" : "Asunto"}
                    </label>
                    <input id="un-cta-prefill" value={current.cta.prefill} onChange={(e) => updateCta({ prefill: e.target.value })} className={inputClass} />
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Guardando…" : "Guardar mensajes"}
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Vista previa</span>
            <div className="ml-auto flex gap-1">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPreviewTheme(t)}
                  aria-pressed={previewTheme === t}
                  className={
                    previewTheme === t
                      ? "rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
                      : "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  }
                >
                  {t === "light" ? "Claro" : "Oscuro"}
                </button>
              ))}
            </div>
          </div>
          <div data-theme={previewTheme} className="overflow-hidden rounded-xl border border-border bg-background text-foreground">
            <UnavailableState messages={preview} which={editing} eventTitle={eventTitle} hostName={hostName} onRetry={() => {}} />
          </div>
          <p className="text-xs text-muted-foreground">
            {editing === "no_slots"
              ? "Se ve cuando hay agenda pero en ese rango no queda ningún horario."
              : editing === "unavailable"
                ? "Se ve cuando no se pueden ofrecer horarios: el calendario está desconectado o tu agenda está apagada."
                : "Se ve cuando la página no pudo cargar. También es el respaldo del embed."}
          </p>
        </div>
      </div>
    </section>
  );
}
