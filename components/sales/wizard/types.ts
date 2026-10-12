import type { WizardProduct } from "@/lib/sales/wizard/catalog";

export interface WizardMember {
  id: string;
  name: string;
}

/** Lo que el asistente recibe de la página: catálogo vendible y ajustes del workspace. */
export interface WizardConfig {
  catalog: WizardProduct[];
  members: WizardMember[];
  enabledMethods: string[];
  maxDiscountPercent: number | null;
  hasAllScope: boolean;
  /** Hoy en la zona del workspace (YYYY-MM-DD). */
  today: string;
  timeZone: string;
  currentUserId: string;
  canManageCatalog: boolean;
}

/** Lo que ya viene resuelto al abrir el asistente desde la ficha del contacto o de una agenda. */
export interface WizardInitial {
  contact?: { id: string; name: string };
  bookingId?: string | null;
  vendedorId?: string | null;
}
