-- 00283_contacts_list_filters
--
-- Lista de contactos: columnas y filtros (bloque 4). Aditiva: no cambia ni
-- borra nada.
--
-- 1. `contact_attribution_options`: los valores de campaña, contenido y término
--    del primer y del último toque que de verdad existen en el workspace, para
--    las opciones de esos filtros. SECURITY INVOKER (no DEFINER): lee
--    `contacts` con el cliente de quien llama, así que cada persona ve solo
--    los valores de los contactos que ya puede ver (la RLS de siempre,
--    `can_see_contact`). Mismo patrón que `booking_utm_options` (00129).
--    Con tope de 300 valores por lista.
--
-- 2. Índices para los filtros nuevos sobre `contacts` que no tenían uno:
--    próximo seguimiento, fecha de alta, estado de email, país, y fuente,
--    medio y campaña del último toque (los del primero son de la 00114).
--    Todos parciales sobre los contactos vivos, como el resto de la lista.

-- ---------------------------------------------------------------------------
-- 1. Las opciones de los filtros de atribución
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contact_attribution_options(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH vals AS (
    SELECT t.touch, k.key, k.value
      FROM public.contacts c
      CROSS JOIN LATERAL (VALUES ('first', c.attribution -> 'first_touch'), ('last', c.attribution -> 'last_touch')) AS t(touch, data)
      CROSS JOIN LATERAL (VALUES ('campaign', t.data ->> 'campaign'), ('content', t.data ->> 'content'), ('term', t.data ->> 'term')) AS k(key, value)
     WHERE c.workspace_id = p_workspace_id
       AND c.deleted_at IS NULL
       AND jsonb_typeof(t.data) = 'object'
       AND nullif(btrim(k.value), '') IS NOT NULL
  ),
  lists AS (
    SELECT touch, key, (SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT value AS v FROM vals x WHERE x.touch = g.touch AND x.key = g.key ORDER BY 1 LIMIT 300) d) AS items
      FROM (SELECT DISTINCT touch, key FROM vals) g
  )
  SELECT coalesce(jsonb_object_agg(touch || '_' || key, items), '{}'::jsonb) FROM lists
$$;

REVOKE ALL ON FUNCTION public.contact_attribution_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_attribution_options(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.contact_attribution_options(uuid) IS
  'Valores de campaña, contenido y término del primer y último toque (claves first_campaign, last_term…), para los filtros de la lista de contactos. SECURITY INVOKER: respeta la RLS de quien llama.';

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_contacts_next_followup
  ON public.contacts (workspace_id, next_followup_date)
  WHERE deleted_at IS NULL AND next_followup_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_created
  ON public.contacts (workspace_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email_status
  ON public.contacts (workspace_id, email_status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_country
  ON public.contacts (workspace_id, country)
  WHERE deleted_at IS NULL AND country IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_last_touch_source
  ON public.contacts (workspace_id, (attribution -> 'last_touch' ->> 'source'))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_last_touch_medium
  ON public.contacts (workspace_id, (attribution -> 'last_touch' ->> 'medium'))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_last_touch_campaign
  ON public.contacts (workspace_id, (attribution -> 'last_touch' ->> 'campaign'))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_campaign
  ON public.contacts (workspace_id, (attribution -> 'first_touch' ->> 'campaign'))
  WHERE deleted_at IS NULL;
