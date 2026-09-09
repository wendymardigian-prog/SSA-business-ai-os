/**
 * La forma de una conversacion tal como la usa la bandeja.
 *
 * Vive en lib/ y no al lado de la pantalla porque la usan la pagina (servidor),
 * la lista y el hilo. Tenerla en el componente de la vista hacia que la lista
 * importara de la vista y la vista de la lista: un ciclo que deja el modulo a
 * medio inicializar y toda la pantalla sin hidratar, sin un solo error visible.
 */

import type { Database } from "@/lib/types/database";

/**
 * El contacto que acompaña a cada conversacion. Es un subconjunto de la fila de
 * contacts: la bandeja necesita como se llama, su foto y si esta marcado como
 * "no contactar"; traer la fila entera de cada contacto de la pagina es peso al
 * pedo.
 */
export interface InboxContact {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  do_not_contact: boolean;
  do_not_contact_reason: string | null;
  setter_id: string | null;
  vendedor_id: string | null;
  /**
   * Ultima vez que el lead interactuo. La bandeja la usa para avisar cuando la
   * conversacion se enfrio: Instagram no deja escribirle a alguien que no
   * contesta hace mas de 24 horas, y a los 7 dias ya es una conversacion
   * practicamente perdida.
   */
  last_interaction_at: string | null;
}

export type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"] & {
  contacts: InboxContact | null;
};
