"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import {
  EnrollContactDialog,
  type SequenceOption,
} from "./enroll-contact-dialog";

/**
 * Abre el diálogo de inscripción. Existe aparte porque las dos pantallas que
 * lo usan son Server Components y el diálogo necesita estado.
 */
export function EnrollButton({
  sequence,
  contact,
  sequences,
  label = "Inscribir contacto",
}: {
  sequence?: SequenceOption;
  contact?: { id: string; name: string; channels: Array<{ id: string; label: string }> };
  sequences?: SequenceOption[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
      >
        <UserPlus className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <EnrollContactDialog
          sequence={sequence}
          contact={contact}
          sequences={sequences}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
