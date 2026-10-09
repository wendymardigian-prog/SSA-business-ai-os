"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { ContentDialog } from "./dialog";
import { PillarsManager, type PillarRow } from "./pillars-manager";

/**
 * El boton de ajustes (⚙️) de la pagina de Contenido: abre los ajustes del
 * contenido. Hoy es solo la administracion de los pilares; el dia que haya
 * otros ajustes de contenido se suman en este mismo dialogo.
 *
 * Solo lo ve quien puede cambiar la configuracion (`settings.manage`): la
 * pagina no lo dibuja para el resto, y las acciones lo piden igual.
 */
export function ContentSettingsButton({ pillars }: { pillars: PillarRow[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ajustes del contenido"
        aria-haspopup="dialog"
        title="Ajustes del contenido"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Settings className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <ContentDialog
          title="Ajustes del contenido"
          label="Ajustes del contenido"
          onClose={() => setOpen(false)}
          footer={
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cerrar
            </button>
          }
        >
          <PillarsManager pillars={pillars} />
        </ContentDialog>
      )}
    </>
  );
}
