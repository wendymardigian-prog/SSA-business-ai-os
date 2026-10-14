import { Paperclip, Star } from "lucide-react";
import { SOCIAL_LABELS } from "@/lib/contacts/social";
import { hiddenNote, shownOptions } from "@/lib/forms/canvas-view";
import type { FormField } from "@/lib/forms/fields";

/**
 * El control de una pregunta tal como lo ve quien responde, pero sin vida: no se escribe ni se elige nada
 * (plano formularios-ui, F9). Solo da la idea de como queda. Server-safe, sin estado.
 */

const DEFAULT_HINT: Partial<Record<FormField["type"], string>> = { email: "nombre@correo.com", phone: "+54 9 11 1234 5678", number: "0" };

const box = "w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground";

export function InertControl({ field }: { field: FormField }) {
  switch (field.type) {
    case "long_text":
      return <div aria-hidden className={`${box} min-h-[64px]`}>{field.placeholder ?? ""}</div>;
    case "single_select":
    case "multi_select": {
      const { shown, more } = shownOptions(field.options);
      const round = field.type === "single_select";
      return (
        <ul aria-hidden className="space-y-1.5">
          {shown.map((o, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className={`h-4 w-4 shrink-0 border border-border bg-background ${round ? "rounded-full" : "rounded"}`} />
              <span className={o.empty ? "italic text-red-600 dark:text-red-400" : ""}>{o.empty ? "(opción vacía)" : o.text}</span>
            </li>
          ))}
          {more > 0 && <li className="pl-6 text-xs text-muted-foreground">y {more} más</li>}
        </ul>
      );
    }
    case "rating":
      return (
        <div aria-hidden className="flex gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-5 w-5 text-muted-foreground/50" />
          ))}
        </div>
      );
    case "nps":
      return (
        <div aria-hidden className="flex flex-wrap gap-1">
          {Array.from({ length: 11 }, (_, i) => (
            <span key={i} className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
              {i}
            </span>
          ))}
        </div>
      );
    case "file":
      return (
        <div aria-hidden className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
          <Paperclip className="h-4 w-4" /> Elegir archivo
        </div>
      );
    case "consent":
      return (
        <div aria-hidden className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border bg-background" />
          <span>{field.consentText || "Acepto"}</span>
        </div>
      );
    case "hidden":
      return <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{hiddenNote(field)}</p>;
    case "date":
      return <div aria-hidden className={box}>dd/mm/aaaa</div>;
    case "social":
      return (
        <div aria-hidden className={box}>
          {field.placeholder || (field.social ? `@usuario en ${SOCIAL_LABELS[field.social.platform]}` : "@usuario")}
        </div>
      );
    default:
      return <div aria-hidden className={box}>{field.placeholder || DEFAULT_HINT[field.type] || " "}</div>;
  }
}
