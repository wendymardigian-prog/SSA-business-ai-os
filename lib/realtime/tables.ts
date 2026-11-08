/**
 * Las tablas de la publicacion `supabase_realtime`: las que la interfaz escucha
 * con `postgres_changes`, y ninguna mas (00327).
 *
 * Cada cambio de una tabla publicada lo decodifica Realtime aunque nadie la
 * escuche, y eso le cuesta a la base. `messages` salio en la 00327: la bandeja
 * escucha `conversations` y vuelve a pedir el hilo.
 *
 * Sumar una tabla: agregarla aca, escucharla en un componente y publicarla en
 * una migracion (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`).
 * `tables.test.ts` compara esta lista con el codigo y `verify-cron-guards.mjs`
 * con la base.
 */
export const REALTIME_TABLES = [
  "agent_drafts",
  "conversations",
  "message_reactions",
  "notifications",
  "whatsapp_group_messages",
  "whatsapp_group_reactions",
  "whatsapp_groups",
  "whatsapp_poll_votes",
] as const;
