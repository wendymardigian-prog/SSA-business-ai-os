// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
"use client";

/**
 * El formulario del invitado (F25, F18). Adaptado de
 * `apps/web/modules/bookings/components/BookEventForm/BookingFields.tsx`: se
 * quitan react-hook-form y `@calcom/ui`; los campos vienen del evento y la
 * validacion la hace el MISMO esquema que el servidor (`buildBookingSchema`),
 * asi el mensaje que se ve es el que el servidor daria.
 *
 * El campo trampa (`website`) va oculto: un robot lo llena y la reserva se
 * descarta en silencio.
 */

import { useMemo, useState } from "react";
import type { BookingField, Slot } from "@/lib/scheduling/types";
import { buildBookingSchema, visibleFields } from "@/lib/scheduling/booking-fields";
import { HONEYPOT_FIELD } from "@/lib/scheduling/antispam";
import { PHONE_COUNTRIES } from "@/lib/scheduling/phone-countries";
import { capitalize, formatSlotSummary } from "@/lib/scheduling/booker/format";

export interface BookFormValues {
  responses: Record<string, unknown>;
  honeypot: string;
}

export function BookForm({
  fields,
  slot,
  timezone,
  timeFormat,
  prefill,
  defaultCountry,
  submitting,
  error,
  fieldErrors,
  onBack,
  onSubmit,
}: {
  fields: BookingField[];
  slot: Slot;
  timezone: string;
  timeFormat: "12h" | "24h";
  prefill: { name?: string; email?: string; phone?: string; answers: Record<string, string> };
  defaultCountry: string;
  submitting: boolean;
  error: string | null;
  fieldErrors: Record<string, string>;
  onBack: () => void;
  onSubmit: (values: BookFormValues) => void;
}) {
  const shown = useMemo(() => visibleFields(fields), [fields]);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of shown) {
      if (f.type === "phone") initial[f.identifier] = { country: defaultCountry, number: prefill.phone ?? "" };
      else if (f.type === "multiselect") initial[f.identifier] = [];
      else if (f.identifier === "name") initial[f.identifier] = prefill.name ?? "";
      else if (f.identifier === "email") initial[f.identifier] = prefill.email ?? "";
      else initial[f.identifier] = prefill.answers[f.identifier] ?? "";
    }
    return initial;
  });
  const [honeypot, setHoneypot] = useState("");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const errors = { ...localErrors, ...fieldErrors };
  const set = (id: string, value: unknown) => setValues((v) => ({ ...v, [id]: value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // El mismo esquema que el servidor: lo que pasa acá, pasa allá.
    const schema = buildBookingSchema(fields, { defaultCountry });
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join(".") || "_"] = issue.message;
      setLocalErrors(next);
      return;
    }
    setLocalErrors({});
    onSubmit({ responses: values, honeypot });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-5" noValidate>
      <p className="text-sm font-medium tabular-nums text-muted-foreground">
        {capitalize(formatSlotSummary(slot.startUtc, slot.endUtc, timezone, timeFormat))}
      </p>

      {shown.map((field) => (
        <Field key={field.identifier} field={field} value={values[field.identifier]} error={errors[field.identifier]} onChange={(v) => set(field.identifier, v)} />
      ))}

      {/* El campo trampa. Oculto para personas, visible para robots. */}
      <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={HONEYPOT_FIELD}>Sitio web</label>
        <input id={HONEYPOT_FIELD} name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-1 flex gap-2">
        <button type="button" onClick={onBack} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          Atrás
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Agendando…" : "Confirmar"}
        </button>
      </div>
    </form>
  );
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: BookingField;
  value: unknown;
  error: string | undefined;
  onChange: (value: unknown) => void;
}) {
  const id = `f-${field.identifier}`;
  const required = field.visibility === "required";
  const describedBy = [error ? `${id}-err` : null, field.help ? `${id}-help` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {required && <span aria-hidden className="text-destructive"> *</span>}
        {required && <span className="sr-only"> (obligatorio)</span>}
      </label>

      {field.type === "long_text" ? (
        <textarea
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          rows={3}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      ) : field.type === "select" ? (
        <select
          id={id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="">Elegí una opción</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === "multiselect" ? (
        <div className="flex flex-col gap-1.5" role="group" aria-describedby={describedBy}>
          {(field.options ?? []).map((o) => {
            const list = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label key={o} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={list.includes(o)}
                  onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))}
                  className="h-4 w-4"
                />
                {o}
              </label>
            );
          })}
        </div>
      ) : field.type === "phone" ? (
        <PhoneField id={id} value={value} onChange={onChange} invalid={Boolean(error)} describedBy={describedBy} />
      ) : (
        <input
          id={id}
          type={field.type === "email" ? "email" : "text"}
          inputMode={field.type === "email" ? "email" : undefined}
          autoComplete={field.type === "email" ? "email" : field.type === "name" ? "name" : undefined}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      )}

      {field.help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {field.help}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function PhoneField({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  const current = (value ?? {}) as { country?: string | null; number?: string };
  return (
    <div className="flex gap-2">
      <select
        aria-label="País"
        value={current.country ?? ""}
        onChange={(e) => onChange({ ...current, country: e.target.value })}
        className="w-32 shrink-0 rounded-lg border border-border bg-background px-2 py-2 text-sm"
      >
        {PHONE_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label} +{c.dial}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={current.number ?? ""}
        onChange={(e) => onChange({ ...current, number: e.target.value })}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
    </div>
  );
}
