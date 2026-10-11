import Link from "next/link";
import { Section } from "./ui";
import { CallSectionList } from "@/components/calls/call-section-list";
import { CONTACT_CALLS_LIMIT, viewAllCallsHref, type CallSectionRow } from "@/lib/calls/contact-section";

/**
 * Las llamadas de este contacto (F34). Solo se pinta si hay alguna que quien
 * mira puede ver (y tiene `calls.view`): sin llamadas no se muestra nada, no un
 * cartel vacio. Lo que se ve lo decide la RLS de `calls`, igual que en la lista
 * de Llamadas.
 */
export function ContactCallsSection({ calls, total, contactId, timeZone }: { calls: CallSectionRow[]; total: number; contactId: string; timeZone: string }) {
  if (calls.length === 0) return null;
  return (
    <Section title="Llamadas">
      <CallSectionList rows={calls} timeZone={timeZone} />
      {total > CONTACT_CALLS_LIMIT && (
        <p className="pt-2 text-sm">
          <Link href={viewAllCallsHref(contactId)} className="text-primary underline-offset-2 hover:underline">
            Ver todas ({total})
          </Link>
        </p>
      )}
    </Section>
  );
}
