"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Checkbox, Field, Notice, Section, inputClass } from "@/components/agents/fields";
import { FIELD_ICONS } from "@/components/forms/builder/field-icons";
import { saveContactSettings } from "@/lib/actions/forms/contact";
import {
  brokenMappings,
  canIdentifyContact,
  identifierLabels,
  linksContacts,
  NO_CONTACT_CONSEQUENCES,
  targetsFor,
  validateContactConfig,
  type ContactConfig,
  type ContactMode,
  type ContactUpdate,
} from "@/lib/forms/contact-config";
import { setFieldMapping } from "@/lib/forms/contact-map";
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

type LinkingMode = Exclude<ContactMode, "none">;

const MODE_LABELS: Record<LinkingMode, { label: string; hint: string }> = {
  create_or_link: { label: "Crear el contacto", hint: "Se crea un contacto nuevo con lo que respondió." },
  link_only: { label: "No crear: dejar la respuesta sin contacto", hint: "Solo se vincula a un contacto que ya existe; si no existe, la respuesta queda sin contacto." },
};

const UPDATE_LABELS: Record<ContactUpdate, { label: string; hint: string }> = {
  fill_empty: { label: "Completar solo lo que le falta", hint: "Solo se llenan los datos que el contacto todavía no tiene." },
  overwrite: { label: "Actualizar con lo que respondió", hint: "Se reemplaza lo que ya tenía por lo que respondió (nunca se borra un dato con un vacío)." },
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
  ensureSaved,
  onSaved,
}: {
  form: EditorForm;
  draft: Draft;
  extras: EditorExtras;
  canManage: boolean;
  /** Guarda el borrador pendiente ANTES de guardar el mapeo: el servidor lo valida contra los campos guardados. */
  ensureSaved: () => Promise<boolean>;
  onSaved: (config: ContactConfig, updatedAt?: string) => void;
}) {
  const router = useRouter();
  const fields: FormField[] = draft.definition.fields;
  const [config, setConfig] = useState<ContactConfig>(form.contactConfig);
  // Al apagar el interruptor se recuerda el modo para devolverlo al prenderlo; el mapeo nunca se toca.
  const [lastMode, setLastMode] = useState<LinkingMode>(form.contactConfig.mode === "none" ? "create_or_link" : form.contactConfig.mode);
  const linking = linksContacts(config);
  const [tagIds, setTagIds] = useState<string[]>(form.tagsOnSubmit);
  const [notifyEnabled, setNotifyEnabled] = useState(form.notifyEnabled);
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>(form.notifyUserIds);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const disabled = !canManage || form.status === "archived";
  const broken = useMemo(() => brokenMappings(config, fields, extras.customFields), [config, fields, extras.customFields]);
  const brokenKeys = new Set(broken.map((b) => b.fieldKey));
  const identifiable = canIdentifyContact(config, fields);
  const identifiers = identifierLabels(config, fields);

  // Lo roto (un campo que ya no existe) no se puede guardar: se limpia antes.
  const cleaned: ContactConfig = useMemo(() => ({ ...config, map: config.map.filter((m) => fields.some((f) => f.key === m.fieldKey)) }), [config, fields]);
  const validation = useMemo(() => validateContactConfig(cleaned, fields, extras.customFields), [cleaned, fields, extras.customFields]);

  // Misma regla que "Se guarda en el contacto" del panel de cada pregunta (`setFieldMapping`): un dato del contacto lo
  // usa una sola pregunta, y si otra lo tenia se lo saca y se avisa.
  function setTarget(fieldKey: string, target: string) {
    const result = setFieldMapping(config, fields, extras.customFields, fieldKey, target || null);
    if (result.error) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setConfig(result.config);
    setMessage(result.displaced ? { tone: "success", text: `Ese dato ya lo usaba "${result.displaced.label}": se lo sacamos.` } : null);
  }

  function save() {
    setMessage(null);
    startSaving(async () => {
      if (!(await ensureSaved())) {
        setMessage({ tone: "error", text: "No pudimos guardar los últimos cambios de los campos. Probá de nuevo." });
        return;
      }
      const result = await saveContactSettings({ formId: form.id, contactConfig: cleaned, tagIds, notifyEnabled, notifyUserIds });
      if (result.ok) {
        setConfig(cleaned);
        onSaved(cleaned, result.updatedAt);
        setMessage({ tone: "success", text: "Guardado" });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.error });
      }
    });
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      {linking && !identifiable && (
        <Notice tone="warning">Sin email, teléfono ni usuario de red social mapeados, ninguna respuesta va a crear ni vincular contacto.</Notice>
      )}
      {linking && identifiable && (
        <p className="text-sm text-muted-foreground">
          Las respuestas buscan y crean contactos por: <span className="font-medium text-foreground">{identifiers.join(", ")}</span>
        </p>
      )}

      <Section title="Vincular con contactos" description="Cada respuesta con email, teléfono o usuario de red social busca a la persona en tus contactos. Nunca se busca por nombre.">
        <Checkbox
          checked={linking}
          disabled={disabled}
          onChange={(on) => {
            setMessage(null);
            if (on) setConfig({ ...config, mode: lastMode });
            else {
              if (config.mode !== "none") setLastMode(config.mode);
              setConfig({ ...config, mode: "none" });
            }
          }}
          label="Vincular las respuestas con contactos"
          description={linking ? "Cada respuesta se vincula con un contacto (o lo crea)." : undefined}
        />
        {!linking && (
          <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Con el interruptor apagado:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {NO_CONTACT_CONSEQUENCES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2">Lo que mapeaste se guarda: si lo volvés a prender, sigue ahí.</p>
          </div>
        )}
        {linking && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Si la persona no está en tus contactos" hint={MODE_LABELS[config.mode as LinkingMode].hint}>
            {(id) => (
              <select id={id} className={inputClass} disabled={disabled} value={config.mode} onChange={(e) => setConfig({ ...config, mode: e.target.value as ContactMode })}>
                {(Object.keys(MODE_LABELS) as LinkingMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m].label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Si la persona ya está en tus contactos" hint={UPDATE_LABELS[config.update].hint}>
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
        )}
      </Section>

      {linking && (
      <Section title="Pregunta → dato del contacto" description="Elegí a qué dato del contacto va cada respuesta. Lo que no se mapea queda solo en la respuesta. Es el mismo dato que “Se guarda en el contacto” en el panel de cada pregunta.">
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay campos. Sumalos en la pestaña Diseño.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Pregunta</th>
                  <th scope="col" className="w-8 px-0 py-2" aria-hidden />
                  <th scope="col" className="px-3 py-2 font-medium">Dato del contacto</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const current = config.map.find((m) => m.fieldKey === field.key)?.target ?? "";
                  const options = targetsFor(field, extras.customFields);
                  const known = current === "" || options.some((o) => o.value === current);
                  const Icon = FIELD_ICONS[field.type];
                  return (
                    <tr key={field.key} className="border-t border-border">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="font-medium">{field.label || field.key}</span>
                        </span>
                      </td>
                      <td className="px-0 py-2 text-center text-muted-foreground" aria-hidden>
                        →
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
      )}

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
