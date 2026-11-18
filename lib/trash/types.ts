/** Lo que devuelven las acciones de la Papelera (lib/actions/trash.ts). En un archivo aparte: un "use server" solo exporta funciones. */

import type { AnyTrashEntity } from "./entities";

export type TrashPreview =
  | {
      ok: true;
      label: string;
      /** «3 pagos», «2 comisiones»: lo que se va además del registro. */
      alsoDeleted: string[];
      /** Por qué no se puede eliminar (vacío si se puede). */
      blockers: string[];
      warnings: string[];
      /** Una venta con servicio: se ofrece «Eliminar también el servicio». */
      offersServiceOption: boolean;
      canDeleteService: boolean;
    }
  | { ok: false; error: string };

export type TrashDeleteResult = { ok: true; itemId: string } | { ok: false; error: string };

export type TrashBulkResult =
  | { ok: true; deleted: number; failures: Array<{ id: string; error: string }> }
  | { ok: false; error: string };

export interface TrashListItem {
  /** El id del ítem de la Papelera, o `contact:<id>` / `task:<id>` para los que ya se borraban antes. */
  id: string;
  entity: AnyTrashEntity;
  entityId: string;
  label: string;
  alsoDeleted: string[];
  deletedBy: string | null;
  deletedAt: string;
  expiresAt: string;
}

export type TrashListResult = { ok: true; items: TrashListItem[] } | { ok: false; error: string };

export type TrashRestoreResult = { ok: true; entity: string; entityId: string } | { ok: false; error: string };
