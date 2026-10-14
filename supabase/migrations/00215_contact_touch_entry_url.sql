-- 00215_contact_touch_entry_url.sql
-- Plano formularios-ui, M1 (F18): la URL de entrada completa en cada toque.
--
-- Que hace:
--   1. `contact_touches.entry_url text`: la direccion completa por la que llego la persona, con todos sus
--      parametros (menos los sensibles, los internos y el fragmento: eso lo sanea el codigo antes de llegar).
--      Sin CHECK a proposito: un CHECK violado pone "Failing row contains (...)" en el log, con la URL adentro.
--   2. `record_contact_touch` escribe esa columna. Mismo cuerpo que la definicion vigente (copiada abajo,
--      leida de la base viva con pg_get_functiondef el 13/10/2026, md5 f364db1862cc0f90291ca14ef855a214);
--      los UNICOS cambios son sumar `entry_url` a la lista de columnas y su valor. Misma firma,
--      SECURITY DEFINER, SET search_path = '' y mismos permisos (solo service_role).
--
-- Lo que NO hace:
--   - No toca `create_booking` (00203): la Agenda manda la URL dentro de `p_utm`, que ya viaja en `raw.utm`.
--   - No toca `contact_touch_json` ni `contacts.attribution`: la copia derivada no cambia. La ficha del
--     contacto lee la URL de la fila de `contact_touches`.
--   - No hay backfill: los toques existentes quedan con NULL.
--
-- El codigo viejo corre contra la base nueva (la columna es opcional) y el nuevo no rompe si la columna no esta
-- (la ficha reintenta sin ella; el toque viejo ignora la clave).
--
-- ====================================================================================================
-- COMO VOLVER ATRAS (en este orden)
-- ====================================================================================================
--   1. Restaurar la funcion con la definicion vieja (la de abajo, sin los "-- ").
--   2. ALTER TABLE public.contact_touches DROP COLUMN IF EXISTS entry_url;
--   3. Quitar la fila de supabase_migrations.schema_migrations (name = '00215_contact_touch_entry_url').
--
-- Definicion VIGENTE antes de esta migracion (letra por letra):
--
-- CREATE OR REPLACE FUNCTION public.record_contact_touch(p_workspace_id uuid, p_contact_id uuid, p_touch jsonb)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_id    uuid;
--   v_first jsonb;
--   v_last  jsonb;
-- BEGIN
--   IF p_touch IS NULL
--      OR nullif(btrim(p_touch->>'source'), '') IS NULL
--      OR nullif(btrim(p_touch->>'dedupe_key'), '') IS NULL
--      OR nullif(btrim(p_touch->>'origin'), '') IS NULL THEN
--     RETURN jsonb_build_object('inserted', false, 'reason', 'invalid');
--   END IF;
--
--   PERFORM 1 FROM public.contacts
--   WHERE id = p_contact_id AND workspace_id = p_workspace_id AND deleted_at IS NULL;
--   IF NOT FOUND THEN
--     RETURN jsonb_build_object('inserted', false, 'reason', 'contact_not_found');
--   END IF;
--
--   INSERT INTO public.contact_touches (
--     workspace_id, contact_id, occurred_at,
--     source, medium, campaign, content_label, term, medium_raw,
--     social_post_id, content_post_id,
--     ad_id, adset_id, campaign_id, fbclid, gclid, ttclid, li_fat_id, ctwa_clid,
--     referrer_url, landing_page, origin, dedupe_key, raw
--   )
--   VALUES (
--     p_workspace_id, p_contact_id,
--     coalesce((p_touch->>'occurred_at')::timestamptz, now()),
--     btrim(p_touch->>'source'),
--     nullif(btrim(p_touch->>'medium'), ''),
--     nullif(btrim(p_touch->>'campaign'), ''),
--     nullif(btrim(p_touch->>'content'), ''),
--     nullif(btrim(p_touch->>'term'), ''),
--     coalesce((p_touch->>'medium_raw')::boolean, false),
--     -- La pieza solo se enlaza si existe Y es de este workspace: una referencia
--     -- colgada o ajena no puede tumbar el registro ni filtrar datos.
--     (SELECT id FROM public.social_posts
--        WHERE id = nullif(p_touch->>'social_post_id', '')::uuid AND workspace_id = p_workspace_id),
--     (SELECT id FROM public.content_posts
--        WHERE id = nullif(p_touch->>'content_post_id', '')::uuid AND workspace_id = p_workspace_id),
--     nullif(p_touch->>'ad_id', ''),
--     nullif(p_touch->>'adset_id', ''),
--     nullif(p_touch->>'campaign_id', ''),
--     nullif(p_touch->>'fbclid', ''),
--     nullif(p_touch->>'gclid', ''),
--     nullif(p_touch->>'ttclid', ''),
--     nullif(p_touch->>'li_fat_id', ''),
--     nullif(p_touch->>'ctwa_clid', ''),
--     nullif(p_touch->>'referrer_url', ''),
--     nullif(p_touch->>'landing_page', ''),
--     btrim(p_touch->>'origin'),
--     btrim(p_touch->>'dedupe_key'),
--     coalesce(p_touch->'raw', '{}'::jsonb)
--   )
--   ON CONFLICT (workspace_id, dedupe_key) DO NOTHING
--   RETURNING id INTO v_id;
--
--   -- Ya estaba: no hay nada que recalcular ni que escribir.
--   IF v_id IS NULL THEN
--     RETURN jsonb_build_object('inserted', false, 'reason', 'duplicate');
--   END IF;
--
--   SELECT public.contact_touch_json(t) INTO v_first
--   FROM public.contact_touches t
--   WHERE t.contact_id = p_contact_id
--   ORDER BY t.occurred_at ASC, t.created_at ASC, t.id ASC
--   LIMIT 1;
--
--   SELECT public.contact_touch_json(t) INTO v_last
--   FROM public.contact_touches t
--   WHERE t.contact_id = p_contact_id
--   ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
--   LIMIT 1;
--
--   UPDATE public.contacts
--   SET attribution = coalesce(attribution, '{}'::jsonb)
--         || jsonb_build_object('version', 2, 'first_touch', v_first, 'last_touch', v_last)
--   WHERE id = p_contact_id;
--
--   RETURN jsonb_build_object('inserted', true, 'touch_id', v_id);
-- END;
-- $function$
-- ====================================================================================================

ALTER TABLE public.contact_touches ADD COLUMN IF NOT EXISTS entry_url text;

COMMENT ON COLUMN public.contact_touches.entry_url IS
  'La URL de entrada completa de la visita (con todos sus parametros, sin sensibles ni fragmento). La escribe record_contact_touch (00215). Puede traer datos de la persona: nunca se loguea.';

CREATE OR REPLACE FUNCTION public.record_contact_touch(p_workspace_id uuid, p_contact_id uuid, p_touch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_id    uuid;
  v_first jsonb;
  v_last  jsonb;
BEGIN
  IF p_touch IS NULL
     OR nullif(btrim(p_touch->>'source'), '') IS NULL
     OR nullif(btrim(p_touch->>'dedupe_key'), '') IS NULL
     OR nullif(btrim(p_touch->>'origin'), '') IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'invalid');
  END IF;

  PERFORM 1 FROM public.contacts
  WHERE id = p_contact_id AND workspace_id = p_workspace_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'contact_not_found');
  END IF;

  INSERT INTO public.contact_touches (
    workspace_id, contact_id, occurred_at,
    source, medium, campaign, content_label, term, medium_raw,
    social_post_id, content_post_id,
    ad_id, adset_id, campaign_id, fbclid, gclid, ttclid, li_fat_id, ctwa_clid,
    referrer_url, landing_page, entry_url, origin, dedupe_key, raw
  )
  VALUES (
    p_workspace_id, p_contact_id,
    coalesce((p_touch->>'occurred_at')::timestamptz, now()),
    btrim(p_touch->>'source'),
    nullif(btrim(p_touch->>'medium'), ''),
    nullif(btrim(p_touch->>'campaign'), ''),
    nullif(btrim(p_touch->>'content'), ''),
    nullif(btrim(p_touch->>'term'), ''),
    coalesce((p_touch->>'medium_raw')::boolean, false),
    -- La pieza solo se enlaza si existe Y es de este workspace: una referencia
    -- colgada o ajena no puede tumbar el registro ni filtrar datos.
    (SELECT id FROM public.social_posts
       WHERE id = nullif(p_touch->>'social_post_id', '')::uuid AND workspace_id = p_workspace_id),
    (SELECT id FROM public.content_posts
       WHERE id = nullif(p_touch->>'content_post_id', '')::uuid AND workspace_id = p_workspace_id),
    nullif(p_touch->>'ad_id', ''),
    nullif(p_touch->>'adset_id', ''),
    nullif(p_touch->>'campaign_id', ''),
    nullif(p_touch->>'fbclid', ''),
    nullif(p_touch->>'gclid', ''),
    nullif(p_touch->>'ttclid', ''),
    nullif(p_touch->>'li_fat_id', ''),
    nullif(p_touch->>'ctwa_clid', ''),
    nullif(p_touch->>'referrer_url', ''),
    nullif(p_touch->>'landing_page', ''),
    -- La URL de entrada completa (plano formularios-ui, F18). Un formulario la manda como `entry_url`; la Agenda,
    -- dentro de `raw.utm` (create_booking pasa `p_utm` entero ahi), asi que `create_booking` NO se toca.
    -- Hasta 2000 caracteres: lo que pase de eso se corta, nunca hace fallar el toque.
    left(
      coalesce(
        nullif(btrim(p_touch->>'entry_url'), ''),
        nullif(btrim(p_touch->'raw'->'utm'->>'entry_url'), '')
      ),
      2000
    ),
    btrim(p_touch->>'origin'),
    btrim(p_touch->>'dedupe_key'),
    coalesce(p_touch->'raw', '{}'::jsonb)
  )
  ON CONFLICT (workspace_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  -- Ya estaba: no hay nada que recalcular ni que escribir.
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'reason', 'duplicate');
  END IF;

  SELECT public.contact_touch_json(t) INTO v_first
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at ASC, t.created_at ASC, t.id ASC
  LIMIT 1;

  SELECT public.contact_touch_json(t) INTO v_last
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
  LIMIT 1;

  UPDATE public.contacts
  SET attribution = coalesce(attribution, '{}'::jsonb)
        || jsonb_build_object('version', 2, 'first_touch', v_first, 'last_touch', v_last)
  WHERE id = p_contact_id;

  RETURN jsonb_build_object('inserted', true, 'touch_id', v_id);
END;
$function$;
