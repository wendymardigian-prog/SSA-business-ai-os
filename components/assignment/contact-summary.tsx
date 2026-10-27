import { Sparkles } from "lucide-react";
import { summarizeContact, type ContactSummaryInput } from "@/lib/assignment/contact-summary";

/**
 * Debajo de Setter y Vendedor en la ficha: el último toque del contacto y cómo
 * se asignó cada uno ("por la regla …" o "asignado a mano"). Solo lee.
 */
export function ContactSummary(props: ContactSummaryInput) {
  const summary = summarizeContact(props);
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <p className="flex items-start gap-1.5">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Último toque:</span> {summary.touchLine}
        </span>
      </p>
      {summary.assignmentLines.map((line) => (
        <p key={line.kind}>{line.text}</p>
      ))}
    </div>
  );
}
