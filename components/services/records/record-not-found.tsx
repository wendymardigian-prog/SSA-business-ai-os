// @plantilla-quitar(servicios)
import { RecordModal } from "./record-modal";

/** Una ficha que no existe o que la persona no ve: el modal lo dice y se cierra como cualquier otro. */
export function RecordNotFound({ what }: { what: "servicio" | "cliente" }) {
  return (
    <RecordModal label={`No encontramos este ${what}`} header={<h2 className="pr-12 text-base font-semibold">No encontramos este {what}</h2>}>
      <p className="px-4 py-6 text-sm text-muted-foreground md:px-6">Puede que ya no exista o que no tengas acceso a él.</p>
    </RecordModal>
  );
}
