// @plantilla-quitar(servicios)
/**
 * La invitación para pasarse (00404), pura: lo que el panel de la variante sugiere y muestra en la vista previa.
 *
 * La configuración vive en la regla Programa de la variante (`sections[program].not_included`) y la valida
 * `notIncludedProblems` (lib/portal-admin/settings.ts), gemela de la base. El link del botón lo arma la base
 * (`module_teaser_row`); `invitationHref` es la misma regla, para la vista previa.
 */
import type { NotIncluded, SectionRule } from "@/lib/portal-admin/settings";
import { normalizePhone } from "@/lib/phone";

export type NotIncludedMode = NotIncluded["mode"];

export interface InvitationModule {
  id: string;
  title: string;
  /** El número que muestra el portal (null para los extras). */
  number: number | null;
  extra: boolean;
}

/** Los textos que se sugieren al prender la invitación, con el nombre del programa. */
export function suggestedInvitation(programName: string): Required<Pick<NotIncluded, "label" | "text" | "button">> {
  const name = programName.trim() || "el programa completo";
  return {
    label: `Incluido en ${name}`.slice(0, 40),
    text: `Pasate a ${name}: tenés todos los módulos, las clases en vivo y el Reto. Lo que ya avanzaste se mantiene.`.slice(0, 400),
    button: "Quiero pasarme",
  };
}

/** La configuración de la regla Programa (sin la clave, `hidden`). */
export function readNotIncluded(rule: SectionRule | undefined): NotIncluded {
  const n = rule?.not_included;
  return n && typeof n === "object" && typeof n.mode === "string" ? n : { mode: "hidden" };
}

/** Cambiar el modo conserva lo escrito; al pasar a «invitación» completa lo que falte con lo sugerido. */
export function withMode(current: NotIncluded, mode: NotIncludedMode, programName: string): NotIncluded {
  if (mode !== "invite") return { ...current, mode };
  const s = suggestedInvitation(programName);
  return {
    ...current,
    mode,
    label: current.label?.trim() ? current.label : s.label,
    text: current.text?.trim() ? current.text : s.text,
    button: current.button?.trim() ? current.button : s.button,
    on_click: current.on_click ?? { notify: "owner" },
  };
}

/** Los módulos que la variante deja afuera, en el orden del programa (los extras al final). */
export function excludedModules(modules: InvitationModule[], content: SectionRule["content"]): InvitationModule[] {
  if (!content || content.modules === "all") return [];
  const inc = new Set(content.modules);
  return [...modules.filter((m) => !m.extra), ...modules.filter((m) => m.extra)].filter((m) => !inc.has(m.id));
}

/** Tildar o destildar un módulo. Sin ninguno tildado vuelve a «todo el programa» (una lista vacía no es válida). */
export function toggleModule(content: SectionRule["content"], all: InvitationModule[], id: string, on: boolean): NonNullable<SectionRule["content"]> {
  const current = !content || content.modules === "all" ? all.map((m) => m.id) : content.modules;
  const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
  const ordered = all.map((m) => m.id).filter((x) => next.includes(x));
  if (ordered.length === 0) return { modules: "all" };
  return { modules: ordered.length === all.length ? "all" : ordered };
}

/** El número de WhatsApp como lo guarda la configuración: solo dígitos, con el código de país. */
export function whatsappDigits(raw: string): string {
  const n = normalizePhone(raw);
  return n ? n.replace(/^\+/, "") : raw.replace(/\D/g, "");
}

/** El link del botón (el mismo que arma la base). Null si el destino no está completo. */
export function invitationHref(target: NotIncluded["target"]): string | null {
  if (!target) return null;
  switch (target.kind) {
    case "link":
    case "form":
    case "event":
      return target.url && /^https?:\/\/\S+$/.test(target.url) ? target.url : null;
    case "whatsapp": {
      if (!target.value || !/^[1-9][0-9]{7,14}$/.test(target.value)) return null;
      const text = target.prefill?.trim() ? `?text=${encodeURIComponent(target.prefill)}` : "";
      return `https://wa.me/${target.value}${text}`;
    }
    default:
      return null;
  }
}
