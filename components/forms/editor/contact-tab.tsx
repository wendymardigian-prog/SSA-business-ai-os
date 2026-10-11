"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Checkbox, Field, Notice, Section, inputClass } from "@/components/agents/fields";
import { saveContactSettings } from "@/lib/actions/forms/contact";
import {
  brokenMappings,
  canIdentifyContact,
  targetsFor,
  validateContactConfig,
  type ContactConfig,
  type ContactMode,
  type ContactUpdate,
} from "@/lib/forms/contact-config";
import type { FormField } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";
import type { Draft, EditorExtras, EditorForm } from "./types";

/**
 * La pestaña Contacto (F15, F18): cómo una respuesta se vuelve un contacto, qué
 * etiquetas se le ponen y a quién se avisa.
 *
 * Se guarda con su propio botón (no con el borrador): estos ajustes valen para el
 * formulario entero desde que se guardan, no se publican por versión.
 */

const MODE_LABELS: Record<ContactMode, { label: string; hint: string }> = {
  create_or_link: { label: "Crear o vincular", hint: "Si ya existe un contacto con ese teléfono o email, se vincula; si no, se crea uno nuevo." },
  link_only: { label: "Solo vincular", hint: "Se vincula a un contacto que ya existe; si no existe, la respuesta queda sin contacto." },
};

const UPDATE_LABELS: Record<ContactUpdate, { label: string; hint: string }> = {
  fill_empty: { label: "Completar lo vacío", hint: "Solo se llenan los datos que el contacto todavía no tiene." },
  overwrite: { label: "Pisar con lo nuevo", hint: "Se reemplaza lo que ya tenía por lo que respondió (nunca se borra un dato con un vacío)." },
};

const chip = (on: boolean) =>
  cn(
    "rounded-lg px-2.5 py-1 text-xs",
    on ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "border border-border text-muted-foreground hover:bg-muted",
  );

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function ContactTab({
  form,
  draft,
  extras,
  canManage,
}: {
  form: EditorForm;
  draft: Draft;
  extras: EditorExtras;
  canManage: boolean;
}) {
  const router = useRouter();
  const fields: FormField[] = draft.definition.fields;
  const [config, setConfig] = useState<ContactConfig>(form.contactConfig);
  const [tagIds, setTagIds] = useState<string[]>(form.tagsOnSubmit);
  const [notifyEnabled, setNotifyEnabled] = useState(form.notifyEnabled);
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>(form.notifyUserIds);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const disabled = !canManage || form.status === "archived";
  const broken = useMemo(() => brokenMappings(config, fields, extras.customFields), [config, fields, extras.customFields]);
  const brokenKeys = new Set(broken.map((b) => b.fieldKey));
  const identifiable = canIdentifyContact(config, fields);

  // Lo roto (un campo que ya no existe) no se puede guardar: se limpia antes.
  const cleaned: ContactConfig = useMemo(() => ({ ...config, map: config.map.filter((m) => fields.some((f) => f.key === m.fieldKey)) }), [config, fields]);
  const validation = useMemo(() => validateContactConfig(cleaned, fields, extras.customFields), [cleaned, fields, extras.customFields]);

  function setTarget(fieldKey: string, target: string) {
    setMessage(null);
    setConfig((c) => ({ ...c, map: [...c.map.filter((m) => m.fieldKey !== fieldKey), ...(target ? [{ fieldKey, target }] : [])] }));
  }

  function save() {
    setMessage(null);
    startSaving(async () => {
      const result = await saveContactSettings({ formId: form.id, contactConfig: cleaned, tagIds, notifyEnabled, notifyUserIds });
      if (result.ok) {
        setConfig(cleaned);
        setMessage({ tone: "success", text: "Guardado" });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {!identifiable && (
        <Notice tone="warning">Sin email ni teléfono mapeados, ninguna respuesta va a crear ni vincular contacto.</Notice>
      )}

      <Section title="Qué pasa con el contacto" description="Cada respuesta con email o teléfono busca a la persona en tus contactos. Nunca se busca por nombre.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cuando llega una respuesta" hint={MODE_LABELS[config.mode].hint}>
            {(id) => (
              <select id={id} className={inputClass} disabled={disabled} value={config.mode} onChange={(e) => setConfig({ ...config, mode: e.target.value as ContactMode })}>
                {(Object.keys(MODE_LABELS) as ContactMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m].label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Si el contacto ya existía" hint={UPDATE_LABELS[config.update].hint}>
            {(id) => (
              <select id={id} className={inputClass} disabled={disabled} value={config.update} onChange={(e) => setConfig({ ...config, update: e.target.value as ContactUpdate })}>
                {(Object.keys(UPDATE_LABELS) as ContactUpdate[]).map((u) => (
                  <option key={u} value={u}>
                    {UPDATE_LABELS[u].label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </Section>

      <Section title="Campo del formulario → campo del contacto" description="Elegí a qué dato del contacto va cada respuesta. Lo que no se mapea queda solo en la respuesta.">
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay campos. Sumalos en la pestaña Campos.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Campo del formulario</th>
                  <th scope="col" className="px-3 py-2 font-medium">Campo del contacto</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const current = config.map.find((m) => m.fieldKey === field.key)?.target ?? "";
                  const options = targetsFor(field, extras.customFields);
                  const known = current === "" || options.some((o) => o.value === current);
                  return (
                    <tr key={field.key} className="border-t border-border">
                      <td className="px-3 py-2">
                        <span className="font-medium">{field.label || field.key}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{field.key}</span>
                      </td>
                      <td className="px-3 py-2">
                        {options.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No se puede mapear</span>
                        ) : (
                          <select
                            aria-label={`Campo del contacto para ${field.label || field.key}`}
                            className={cn(inputClass, brokenKeys.has(field.key) && "border-red-400")}
                            disabled={disabled}
                            value={current}
                            onChange={(e) => setTarget(field.key, e.target.value)}
                          >
                            <option value="">No mapear</option>
                            {!known && <option value={current}>Campo inexistente</option>}
                            <optgroup label="Contacto">
                              {options.filter((o) => o.group === "Contacto").map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </optgroup>
                            {options.some((o) => o.group === "Campos personalizados") && (
                              <optgroup label="Campos personalizados">
                                {options.filter((o) => o.group === "Campos personalizados").map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        )}
                        {brokenKeys.has(field.key) && <p className="mt-1 text-xs text-destructive">Ese campo del contacto ya no existe: elegí otro o dejalo sin mapear.</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {broken.some((b) => b.reason === "field") && (
          <p className="mt-2 text-xs text-muted-foreground">Había mapeos a campos que ya no están en el formulario: se quitan al guardar.</p>
        )}
        {!validation.ok && <p className="mt-2 text-xs text-destructive">{validation.errors[0]}</p>}
      </Section>

      <Section title="Etiquetas al enviar" description="Se le ponen al contacto cuando responde. Si ya la tenía, no pasa nada.">
        {extras.tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay etiquetas en el sistema.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {extras.tags.map((t) => (
              <button key={t.id} type="button" aria-pressed={tagIds.includes(t.id)} disabled={disabled} onClick={() => setTagIds(toggle(tagIds, t.id))} className={chip(tagIds.includes(t.id))}>
                {t.name}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Avisar al equipo" description="Llega a la campana aunque el contacto esté marcado como no contactar.">
        <Checkbox checked={notifyEnabled} onChange={setNotifyEnabled} label="Avisar cuando llega una respuesta" description="Sin elegir personas, el aviso va a Owner y Admin." />
        {notifyEnabled && (
          <div className="mt-3 flex flex-wrap gap-2">
            {extras.members.map((m) => (
              <button key={m.userId} type="button" aria-pressed={notifyUserIds.includes(m.userId)} disabled={disabled} onClick={() => setNotifyUserIds(toggle(notifyUserIds, m.userId))} className={chip(notifyUserIds.includes(m.userId))}>
                {m.name}
              </button>
            ))}
          </div>
        )}
      </Section>

      {message && (
        <div role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {canManage && (
        <button
          type="button"
          onClick={save}
          disabled={disabled || saving || !validation.ok}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Guardar
        </button>
      )}
    </div>
  );
}
