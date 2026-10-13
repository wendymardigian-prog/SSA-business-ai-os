"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Field, Notice, Section, inputClass } from "@/components/agents/fields";
import { saveEodConfig } from "@/lib/actions/forms/config";
import { MAX_PAST_DAYS, MAX_ROLE_LABEL, type AudienceMode, type EodConfig, type EodReportMode } from "@/lib/eod/config";
import type { SuccessConfig } from "@/lib/forms/success";

/**
 * La pestaña Configuración de un EOD (E5): quién lo completa, si se puede corregir,
 * hasta cuántos días atrás, a quién se avisa y la pantalla final. La configuración se
 * guarda con su botón (vale desde que se guarda); la pantalla final va con el borrador.
 */
export function EodConfigTab({
  formId,
  config,
  onSaved,
  members,
  roles,
  success,
  onSuccessChange,
  disabled,
}: {
  formId: string;
  config: EodConfig;
  onSaved: (config: EodConfig) => void;
  members: Array<{ userId: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
  success: SuccessConfig;
  onSuccessChange: (next: SuccessConfig) => void;
  disabled: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<EodConfig>(config);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, start] = useTransition();
  const message_ = success.mode === "message" ? success : { mode: "message" as const, title: "", body: "" };

  function setAudienceMode(mode: AudienceMode) {
    setDraft({ ...draft, audience: { ...draft.audience, mode } });
  }

  function toggleIn(list: string[], id: string, on: boolean): string[] {
    return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
  }

  function save() {
    setMessage(null);
    start(async () => {
      const result = await saveEodConfig({ formId, config: draft });
      if (result.ok) {
        onSaved(draft);
        setMessage({ tone: "success", text: "Guardado" });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Section title="El rol" description={draft.variant === "setter" ? "Reporte de setters: con canales." : "Reporte general: solo preguntas, sin canales."}>
        <Field label="Cómo se llama el rol en pantalla" hint="La variante (con o sin canales) se elige al crear y no cambia.">
          {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={MAX_ROLE_LABEL} value={draft.roleLabel} onChange={(e) => setDraft({ ...draft, roleLabel: e.target.value })} />}
        </Field>
      </Section>

      <Section title="Quién completa este reporte">
        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">Quién completa este reporte</legend>
          {(
            [
              ["all", "Todo el equipo"],
              ["users", "Personas elegidas"],
              ["roles", "Roles elegidos"],
            ] as Array<[AudienceMode, string]>
          ).map(([mode, text]) => (
            <label key={mode} className="flex items-center gap-2">
              <input type="radio" name="eod-audience" disabled={disabled} checked={draft.audience.mode === mode} onChange={() => setAudienceMode(mode)} />
              {text}
            </label>
          ))}
        </fieldset>
        {draft.audience.mode === "users" && (
          <fieldset className="grid gap-1.5 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-semibold">Personas</legend>
            {members.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={draft.audience.userIds.includes(m.userId)}
                  onChange={(e) => setDraft({ ...draft, audience: { ...draft.audience, userIds: toggleIn(draft.audience.userIds, m.userId, e.target.checked) } })}
                />
                {m.name}
              </label>
            ))}
          </fieldset>
        )}
        {draft.audience.mode === "roles" && (
          <fieldset className="grid gap-1.5 sm:grid-cols-2">
            <legend className="mb-1 text-xs font-semibold">Roles</legend>
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={draft.audience.roleIds.includes(r.id)}
                  onChange={(e) => setDraft({ ...draft, audience: { ...draft.audience, roleIds: toggleIn(draft.audience.roleIds, r.id, e.target.checked) } })}
                />
                {r.name}
              </label>
            ))}
          </fieldset>
        )}
      </Section>

      <Section title="Si alguien ya envió el reporte de ese día">
        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">Si alguien ya envió el reporte de ese día</legend>
          {(
            [
              ["single", "Un reporte por día: el segundo envío se rechaza"],
              ["editable", "Se puede corregir: lo puede volver a abrir, cambiar y reenviar"],
            ] as Array<[EodReportMode, string]>
          ).map(([mode, text]) => (
            <label key={mode} className="flex items-center gap-2">
              <input type="radio" name="eod-mode" disabled={disabled} checked={draft.reportMode === mode} onChange={() => setDraft({ ...draft, reportMode: mode })} />
              {text}
            </label>
          ))}
        </fieldset>
        <Field label="Hasta cuántos días atrás se puede reportar" hint="0 = solo hoy. Nunca una fecha futura.">
          {(id) => (
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_PAST_DAYS}
              className={`${inputClass} max-w-[8rem]`}
              disabled={disabled}
              value={draft.pastDays}
              onChange={(e) => setDraft({ ...draft, pastDays: Math.min(MAX_PAST_DAYS, Math.max(0, Math.trunc(Number(e.target.value) || 0))) })}
            />
          )}
        </Field>
      </Section>

      <Section title="Avisar cuando alguien envía" description="Les llega un aviso en la campana con el link al reporte.">
        <fieldset className="grid gap-1.5 sm:grid-cols-2">
          <legend className="sr-only">A quién avisar</legend>
          {members.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={draft.notify.userIds.includes(m.userId)}
                onChange={(e) => setDraft({ ...draft, notify: { userIds: toggleIn(draft.notify.userIds, m.userId, e.target.checked) } })}
              />
              {m.name}
            </label>
          ))}
        </fieldset>
      </Section>

      <Section title="Recordatorio" description="A la hora elegida (en la zona de cada persona), un aviso en la campana a quien todavía no envió el de hoy.">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={disabled} checked={draft.reminder.enabled} onChange={(e) => setDraft({ ...draft, reminder: { ...draft.reminder, enabled: e.target.checked } })} />
          Mandar un recordatorio
        </label>
        {draft.reminder.enabled && (
          <Field label="Hora">
            {(id) => <input id={id} type="time" className={`${inputClass} max-w-[9rem]`} disabled={disabled} value={draft.reminder.time} onChange={(e) => setDraft({ ...draft, reminder: { ...draft.reminder, time: e.target.value } })} />}
          </Field>
        )}
      </Section>

      {!disabled && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Guardar configuración
          </button>
          {message && (
            <div role="status" className="flex-1">
              <Notice tone={message.tone}>{message.text}</Notice>
            </div>
          )}
        </div>
      )}

      <Section title="La pantalla final" description="Lo que ve la persona después de enviar. Se guarda solo, con las preguntas.">
        <Field label="Título">
          {(id) => <input id={id} className={inputClass} disabled={disabled} maxLength={200} value={message_.title ?? ""} onChange={(e) => onSuccessChange({ ...message_, title: e.target.value })} />}
        </Field>
        <Field label="Texto">
          {(id) => <textarea id={id} rows={3} className={inputClass} disabled={disabled} maxLength={2000} value={message_.body ?? ""} onChange={(e) => onSuccessChange({ ...message_, body: e.target.value })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Botón: texto (opcional)">
            {(id) => (
              <input
                id={id}
                className={inputClass}
                disabled={disabled}
                maxLength={60}
                value={message_.button?.label ?? ""}
                onChange={(e) => onSuccessChange({ ...message_, button: e.target.value ? { label: e.target.value, url: message_.button?.url ?? "https://" } : undefined })}
              />
            )}
          </Field>
          <Field label="Botón: dirección">
            {(id) => (
              <input
                id={id}
                className={inputClass}
                disabled={disabled || !message_.button}
                value={message_.button?.url ?? ""}
                placeholder="https://"
                onChange={(e) => message_.button && onSuccessChange({ ...message_, button: { ...message_.button, url: e.target.value } })}
              />
            )}
          </Field>
        </div>
      </Section>
    </div>
  );
}
