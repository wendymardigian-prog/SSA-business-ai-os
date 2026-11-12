"use client";

import { useSyncExternalStore } from "react";
import { PhoneInput } from "@/components/ui/phone-input";
import { countryFromTimezone } from "@/lib/scheduling/phone-countries";
import { SOCIAL_PREFIX } from "@/lib/contacts/social";
import { FieldShell, publicInputClass, type FieldProps } from "./shared";

const text = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

export function ShortTextField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="text"
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
          maxLength={500}
        />
      )}
    </FieldShell>
  );
}

/** Un link (Servicios A2, F127.8): el teclado de URL en el celular; la validacion (https://) es la del servidor. */
export function LinkField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="url"
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder || "https://"}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
          maxLength={2000}
        />
      )}
    </FieldShell>
  );
}

export function LongTextField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={4}
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
          maxLength={5000}
        />
      )}
    </FieldShell>
  );
}

export function EmailField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          className={publicInputClass}
          value={text(value)}
          placeholder={field.placeholder || "correo@ejemplo.com"}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

// El país por la zona horaria del navegador. `useSyncExternalStore` da el del servidor (ninguno) al hidratar y el del
// navegador enseguida: así el HTML no cambia entre servidor y navegador.
const subscribeNothing = () => () => {};
const serverPhoneCountry = (): string | undefined => undefined;
function browserPhoneCountry(): string | undefined {
  try {
    return countryFromTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

/**
 * Un teléfono con país: el desplegable lleva todos los países con su prefijo y la persona escribe el número SIN
 * prefijo (`PhoneInput`). Lo que se guarda es `+<dígitos>`. El país con el que arranca sale de la zona horaria del
 * navegador.
 */
export function PhoneField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  const country = useSyncExternalStore(subscribeNothing, browserPhoneCountry, serverPhoneCountry);
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <div onFocusCapture={onInteract}>
          {/* `key`: al resolverse el país, el campo (todavía vacío) vuelve a arrancar con él. */}
          <PhoneInput
            key={country ?? "auto"}
            id={id}
            value={text(value)}
            onChange={onChange}
            defaultCountry={country}
            disabled={locked}
            invalid={!!error}
            describedBy={describedBy}
            label={field.label}
            selectClassName="w-[6.75rem]"
            placeholder={field.placeholder || "8888 1234"}
          />
        </div>
      )}
    </FieldShell>
  );
}

export function NumberField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={publicInputClass}
          value={text(value)}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

export function DateField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  return (
    <FieldShell field={field} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <input
          id={id}
          type="date"
          className={publicInputClass}
          value={text(value)}
          disabled={locked}
          required={field.required}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          onFocus={onInteract}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

/** Un usuario de red social: con el prefijo "@" (o la dirección de LinkedIn) pegado al input. */
export function SocialField({ field, value, onChange, error, locked, onInteract }: FieldProps) {
  const platform = field.social?.platform ?? "instagram";
  return (
    <FieldShell field={{ ...field, help: field.help ?? (platform === "linkedin" ? undefined : "Sin la arroba") }} error={error} locked={locked}>
      {({ id, describedBy }) => (
        <div className="flex items-stretch">
          <span className="inline-flex items-center rounded-l-lg border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground" aria-hidden="true">
            {SOCIAL_PREFIX[platform]}
          </span>
          <input
            id={id}
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${publicInputClass} rounded-l-none`}
            value={text(value)}
            placeholder={field.placeholder || (platform === "linkedin" ? "tu-nombre" : "tuusuario")}
            disabled={locked}
            required={field.required}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            onFocus={onInteract}
            onChange={(e) => onChange(e.target.value)}
            maxLength={300}
          />
        </div>
      )}
    </FieldShell>
  );
}
