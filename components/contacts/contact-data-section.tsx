import type { ContactFieldKey } from "@/lib/contacts/fields";
import { CONTACT_DATA_GROUPS, contactFieldHref } from "@/lib/contacts/data-groups";
import { InlineField } from "./inline-field";
import { Section } from "./ui";

/**
 * "Datos de contacto": todo lo que antes estaba detras del boton "Editar", a la
 * vista y editable con un clic, ordenado por tema (contacto, redes, resumen del
 * agente). Los grupos y sus campos salen de `lib/contacts/data-groups.ts`.
 */
export function ContactDataSection({
  contactId,
  values,
  canEdit,
}: {
  contactId: string;
  /** El valor guardado de cada campo ("" si no hay). */
  values: Partial<Record<ContactFieldKey, string>>;
  canEdit: boolean;
}) {
  return (
    <Section title="Datos de contacto">
      <div className="space-y-5 rounded-lg border border-border p-4">
        {CONTACT_DATA_GROUPS.map((group) => (
          <div key={group.id}>
            {/* El resumen del agente es un solo campo: su titulo ya es el del grupo. */}
            {group.id !== "agente" && (
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">{group.title}</h3>
            )}
            <dl className={group.id === "agente" ? "" : "grid gap-x-8 gap-y-3 sm:grid-cols-2"}>
              {group.fields.map((field) => {
                const value = values[field.key] ?? "";
                return (
                  <div key={field.key} className="min-w-0">
                    <dt className="mb-0.5 text-xs text-muted-foreground">{field.label}</dt>
                    <dd className="min-w-0">
                      <InlineField
                        contactId={contactId}
                        field={field.key}
                        value={value}
                        label={field.label}
                        hint={field.hint}
                        multiline={field.multiline}
                        prefix={field.prefix}
                        href={contactFieldHref(field.key, value)}
                        canEdit={canEdit}
                        placeholder={field.multiline ? "Todavía no hay un resumen" : "Agregar"}
                      />
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </Section>
  );
}
