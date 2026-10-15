"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Save, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateAttributionSettings } from "@/lib/actions/attribution-settings";
import { MAX_INHERIT_DAYS, MIN_INHERIT_DAYS, type AttributionSettings } from "@/lib/attribution/settings";

/**
 * Ajustes > General > Atribución (`settings.general`, Extra I F31): si comentar crea un contacto (por red), cuántos días
 * un mensaje hereda la pieza que lo originó y los valores iniciales de los links de los mensajes. Se guarda todo junto
 * con un botón; la pantalla no tiene librería de avisos, así que el resultado se muestra en la página.
 */

function Toggle({
  checked,
  onChange,
  disabled,
  title,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  title: string;
  description?: string;
}) {
  return (
    <label
      className={cn(
        "flex gap-3 rounded-lg border border-border p-3 transition-colors",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent/40",
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 accent-current"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

export function AttributionSettingsCard({ initial }: { initial: AttributionSettings }) {
  const router = useRouter();
  const daysId = useId();
  const [value, setValue] = useState<AttributionSettings>(initial);
  // El número se edita como texto para poder borrarlo mientras se escribe; se valida al guardar.
  const [daysText, setDaysText] = useState(String(initial.content_inherit_days));
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function change(next: Partial<AttributionSettings>) {
    setValue((current) => ({ ...current, ...next }));
    setMessage(null);
  }

  function save() {
    const days = daysText.trim() === "" ? Number.NaN : Number(daysText);
    if (!Number.isInteger(days) || days < MIN_INHERIT_DAYS || days > MAX_INHERIT_DAYS) {
      setMessage({ kind: "error", text: `Los días de herencia van de ${MIN_INHERIT_DAYS} a ${MAX_INHERIT_DAYS}` });
      return;
    }
    const payload: AttributionSettings = { ...value, content_inherit_days: days };
    start(async () => {
      const result = await updateAttributionSettings(payload);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setValue(result.settings);
      setDaysText(String(result.settings.content_inherit_days));
      setMessage({ kind: "ok", text: "Cambios guardados" });
      router.refresh();
    });
  }

  return (
    <section>
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Atribución</h2>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      <div className="mt-4 space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Crear contactos desde comentarios</legend>
          <Toggle
            checked={value.comments_create_contact.instagram}
            onChange={(next) => change({ comments_create_contact: { ...value.comments_create_contact, instagram: next } })}
            disabled={pending}
            title="Instagram"
            description="Si lo prendés, cada persona que comenta una publicación tuya se vuelve un contacto, con su @usuario. Ventaja: no perdés el rastro de nadie que mostró interés y, si después te escribe, ya sabés de qué publicación vino. Desventaja: tu lista se llena de gente que solo opinó y cada una cuenta como «contacto nuevo» (y puede disparar tus automatizaciones de contacto nuevo). Apagado, solo se vincula el comentario cuando esa persona ya es contacto."
          />
          <Toggle
            checked={value.comments_create_contact.tiktok}
            onChange={(next) => change({ comments_create_contact: { ...value.comments_create_contact, tiktok: next } })}
            disabled={pending}
            title="TikTok"
            description="TikTok no tiene mensajes directos: el comentario es la única señal que vas a tener de esa persona. Prendido, se crea un contacto discreto (no cuenta como «contacto nuevo» ni aparece en las listas) para no perder de qué video vino. Apagado, solo se vincula si ya es contacto."
          />
        </fieldset>

        <div className="rounded-lg border border-border p-3">
          <label htmlFor={daysId} className="block text-sm font-medium">
            Días que un mensaje hereda la pieza
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cuando una persona escribe después de ver una publicación o de recibir una automatización, el mensaje se atribuye a esa pieza durante
            esta cantidad de días (de {MIN_INHERIT_DAYS} a {MAX_INHERIT_DAYS}).
          </p>
          <input
            id={daysId}
            type="number"
            inputMode="numeric"
            min={MIN_INHERIT_DAYS}
            max={MAX_INHERIT_DAYS}
            step={1}
            value={daysText}
            disabled={pending}
            onChange={(e) => {
              setDaysText(e.target.value);
              setMessage(null);
            }}
            className="mt-2 h-9 w-24 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Links de los mensajes</legend>
          <Toggle
            checked={value.links_append_default}
            onChange={(next) => change({ links_append_default: next })}
            disabled={pending}
            title="Agregar parámetros de atribución a los links de los mensajes por defecto"
            description="Es el valor inicial en los pasos de envío nuevos. En cada paso se puede cambiar."
          />
          <Toggle
            checked={value.links_track_clicks_default}
            onChange={(next) => change({ links_track_clicks_default: next })}
            disabled={pending}
            title="Registrar el clic en los links por defecto"
            description="Es el valor inicial en los pasos de envío nuevos. En cada paso se puede cambiar."
          />
        </fieldset>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" aria-hidden />
              Guardar cambios
            </>
          )}
        </button>

        {message?.kind === "ok" && (
          <span role="status" className="flex items-center gap-1 text-sm text-green-600">
            <Check className="h-4 w-4" aria-hidden />
            {message.text}
          </span>
        )}
        {message?.kind === "error" && (
          <span role="alert" className="text-sm text-red-600">
            {message.text}
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        El cambio vale para los comentarios que lleguen de ahora en adelante. Si más adelante una persona se vuelve contacto, sus comentarios viejos se
        vinculan solos.
      </p>
    </section>
  );
}
