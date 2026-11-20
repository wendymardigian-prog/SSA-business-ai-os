"use client";

/**
 * «Agendar llamada» desde la ficha del cliente o del servicio: abre el MISMO modal de agendar a mano de la Agenda
 * (`BookManualDialog`), con el contacto ya elegido y fijo, y el área «Servicio» por defecto. Lo que necesita el modal
 * se pide recién al tocar el botón (`loadManualBookingForContact`): abrir la ficha no paga esas consultas.
 *
 * Después de agendar se queda en la ficha: refresca (la reunión aparece en «Reuniones» del servicio) y muestra un
 * aviso con el link a la reunión en la Agenda.
 */

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Loader2 } from "lucide-react";
import { loadManualBookingForContact } from "@/lib/actions/scheduling/manual-booking-options";
import { searchContactsForBooking } from "@/lib/actions/scheduling/bookings";
import { Tip } from "@/components/ui/tooltip";
import { BookManualDialog } from "./book-manual-dialog";

type Loaded = Extract<Awaited<ReturnType<typeof loadManualBookingForContact>>, { ok: true }>["data"];

/** `iconOnly`: un botón cuadrado solo con el icono (encabezados de las fichas, donde el ancho importa). */
export function ScheduleCallButton({ contactId, className, iconOnly = false }: { contactId: string; className?: string; iconOnly?: boolean }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // El aviso de «Reunión agendada» se va solo.
  useEffect(() => {
    if (!createdId) return;
    const id = setTimeout(() => setCreatedId(null), 12000);
    return () => clearTimeout(id);
  }, [createdId]);

  function openDialog() {
    setError(null);
    setCreatedId(null);
    start(async () => {
      const r = await loadManualBookingForContact(contactId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLoaded(r.data);
      setOpen(true);
    });
  }

  const icon = pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />;

  return (
    <>
      {iconOnly ? (
        <Tip content="Agendar una llamada con este cliente">
          <button
            type="button"
            onClick={openDialog}
            disabled={pending}
            aria-label="Agendar llamada"
            className={className ?? "inline-grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border hover:bg-accent disabled:opacity-60 md:h-8 md:w-8"}
          >
            {icon}
          </button>
        </Tip>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          disabled={pending}
          className={
            className ??
            "inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm hover:bg-accent disabled:opacity-60 md:h-8"
          }
        >
          {icon}
          Agendar llamada
        </button>
      )}
      {error && (
        <span role="alert" className="basis-full text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
      {createdId && (
        <span role="status" className="inline-flex basis-full items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          Reunión agendada ·{" "}
          <Link href={`/dashboard/agenda?agenda=${createdId}`} className="font-medium text-primary-ink hover:underline">
            Ver en Agenda
          </Link>
        </span>
      )}
      {open &&
        loaded &&
        createPortal(
          <BookManualDialog
            events={loaded.events}
            timezone={loaded.timezone}
            onClose={() => setOpen(false)}
            onCreated={(bookingId) => {
              setCreatedId(bookingId);
              router.refresh();
            }}
            searchContacts={(term) => searchContactsForBooking(term)}
            hosts={loaded.hosts}
            currentUserId={loaded.currentUserId}
            areas={loaded.areas}
            confirmationConfigs={loaded.confirmationConfigs}
            presetContact={loaded.contact}
          />,
          document.body,
        )}
    </>
  );
}
