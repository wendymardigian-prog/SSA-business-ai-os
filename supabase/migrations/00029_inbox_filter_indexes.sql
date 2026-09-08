-- ============================================================
-- MIGRACION 00029 — INDICES PARA LOS FILTROS DE LA BANDEJA (F16)
-- ============================================================
-- Hasta ahora la bandeja traia 50 conversaciones ordenadas por fecha y
-- filtraba en memoria, asi que a la base solo le pedia eso. Con los filtros de
-- F16 la consulta cambia de forma: estado, canal, asignado y rango de fechas
-- se resuelven en Postgres y con paginacion, que es la unica manera de que el
-- filtro no mienta cuando hay mas conversaciones que las que entran en una
-- tanda.
--
-- Los tres indices cubren las consultas que aparecen, no todas las
-- combinaciones posibles: el orden siempre es por last_message_at descendente,
-- asi que va al final de cada uno.
-- ============================================================

-- Lo que se pide al entrar: las abiertas, mas recientes primero. Ya existia
-- idx_conversations_status(workspace_id, status), pero sin la fecha adentro el
-- orden se resuelve igual con un sort de todo lo que matchea.
CREATE INDEX IF NOT EXISTS idx_conversations_ws_status_last
  ON public.conversations(workspace_id, status, last_message_at DESC)
  WHERE deleted_at IS NULL;

-- El filtro por persona asignada.
CREATE INDEX IF NOT EXISTS idx_conversations_ws_assigned_last
  ON public.conversations(workspace_id, assigned_to, last_message_at DESC)
  WHERE deleted_at IS NULL;

-- Filtrar por tag entra por el tag y sale por los contactos. La clave primaria
-- de contact_tags es (contact_id, tag_id), que sirve para "los tags de este
-- contacto" y no para "los contactos de este tag", que es lo que hace falta
-- aca.
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag
  ON public.contact_tags(tag_id, contact_id);
