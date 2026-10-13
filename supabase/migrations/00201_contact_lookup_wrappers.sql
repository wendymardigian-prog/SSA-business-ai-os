-- ============================================================================
-- 00201 — Los buscadores de contactos sobre la busqueda compartida (Contactos: regla unica, C2)
-- ============================================================================
-- `find_contact_for_form` (00175) y `find_contact_by_phone_or_email` (00156) tenian cada uno su propia
-- busqueda. Pasan a llamar a `private.contact_identity_lookup` (00200), la misma que usa la regla central:
-- una sola forma de buscar. Siguen siendo STABLE (sus llamadores no cambian), con la misma firma y la
-- misma salida. Diferencias que se ven (todas deliberadas, ver docs/PROGRESS-contactos.md):
--   * el telefono se normaliza con `normalize_phone` (antes solo `btrim`): "+54 9 11..." ahora encuentra
--     a "+549 11..."; un telefono de menos de 8 digitos ya no cuenta como dato;
--   * cuando hay empate de fecha de alta, desempata el id (antes quedaba al azar).
-- `find_contact_by_phone_or_email` sigue sin crear nada: la usa Ventas.
-- Como volver atras: pegar las dos definiciones de abajo.
--
-- DEFINICIONES VIGENTES ANTES DE ESTA MIGRACION (copiadas de la base con pg_get_functiondef).
-- Para volver atras: pegar la que corresponda (CREATE OR REPLACE).
--
-- ==== find_contact_for_form (md5 b5238c113b5a69192d8735ddb04355aa) ====
-- CREATE OR REPLACE FUNCTION public.find_contact_for_form(p_workspace_id uuid, p_phone text, p_email text, p_social jsonb DEFAULT '{}'::jsonb)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_phone  text := nullif(btrim(p_phone), '');
--   v_email  text := public.normalize_email(p_email);
--   v_social jsonb := CASE WHEN jsonb_typeof(p_social) = 'object' THEN p_social ELSE '{}'::jsonb END;
--   v_ig     text := nullif(lower(btrim(regexp_replace(COALESCE(v_social ->> 'instagram', ''), '^@+', ''))), '');
--   v_tt     text := nullif(lower(btrim(regexp_replace(COALESCE(v_social ->> 'tiktok', ''), '^@+', ''))), '');
--   v_x      text := nullif(lower(btrim(regexp_replace(COALESCE(v_social ->> 'x', ''), '^@+', ''))), '');
--   v_li     text := COALESCE(public.linkedin_slug(v_social ->> 'linkedin'), nullif(lower(btrim(v_social ->> 'linkedin')), ''));
--   v_id     uuid;
--   v_hits   jsonb := '[]'::jsonb;
--   v_winner uuid;
--   v_by     text;
--   v_conflicts jsonb;
-- BEGIN
--   -- 1. Telefono (el principal o el de WhatsApp de cualquier contacto).
--   IF v_phone IS NOT NULL THEN
--     SELECT c.id INTO v_id FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
--       AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
--     ORDER BY c.created_at ASC LIMIT 1;
--     IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'phone', 'contact_id', v_id)); END IF;
--     v_id := NULL;
--   END IF;
--
--   -- 2. Email (el principal o el secundario).
--   IF v_email IS NOT NULL THEN
--     SELECT c.id INTO v_id FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
--       AND (public.normalize_email(c.email) = v_email OR public.normalize_email(c.secondary_email) = v_email)
--     ORDER BY c.created_at ASC LIMIT 1;
--     IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'email', 'contact_id', v_id)); END IF;
--     v_id := NULL;
--   END IF;
--
--   -- 3 a 6. Redes sociales, en este orden. Se compara en minusculas (los contactos viejos pueden no estarlo).
--   IF v_ig IS NOT NULL THEN
--     SELECT c.id INTO v_id FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.instagram_username) = v_ig
--     ORDER BY c.created_at ASC LIMIT 1;
--     IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'instagram', 'contact_id', v_id)); END IF;
--     v_id := NULL;
--   END IF;
--
--   IF v_tt IS NOT NULL THEN
--     SELECT c.id INTO v_id FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.tiktok_username) = v_tt
--     ORDER BY c.created_at ASC LIMIT 1;
--     IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'tiktok', 'contact_id', v_id)); END IF;
--     v_id := NULL;
--   END IF;
--
--   IF v_x IS NOT NULL THEN
--     SELECT c.id INTO v_id FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.twitter_username) = v_x
--     ORDER BY c.created_at ASC LIMIT 1;
--     IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'x', 'contact_id', v_id)); END IF;
--     v_id := NULL;
--   END IF;
--
--   IF v_li IS NOT NULL THEN
--     -- LinkedIn se compara por el slug de la URL, no por el texto entero.
--     SELECT c.id INTO v_id FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND public.linkedin_slug(c.linkedin_profile_url) = v_li
--     ORDER BY c.created_at ASC LIMIT 1;
--     IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'linkedin', 'contact_id', v_id)); END IF;
--     v_id := NULL;
--   END IF;
--
--   IF jsonb_array_length(v_hits) = 0 THEN
--     RETURN jsonb_build_object('contact_id', NULL, 'matched_by', NULL, 'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb);
--   END IF;
--
--   v_winner := (v_hits -> 0 ->> 'contact_id')::uuid;
--   v_by := v_hits -> 0 ->> 'by';
--
--   SELECT COALESCE(jsonb_agg(h), '[]'::jsonb) INTO v_conflicts
--   FROM jsonb_array_elements(v_hits) h
--   WHERE (h ->> 'contact_id')::uuid <> v_winner;
--
--   RETURN jsonb_build_object(
--     'contact_id', v_winner,
--     'matched_by', v_by,
--     'conflict_contact_id', v_conflicts -> 0 ->> 'contact_id',
--     'conflicts', v_conflicts
--   );
-- END;
-- $function$
--
-- ==== find_contact_by_phone_or_email (md5 0732f4d093f716a6093d7b5c983fce5a) ====
-- CREATE OR REPLACE FUNCTION public.find_contact_by_phone_or_email(p_workspace_id uuid, p_phone text, p_email text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_phone    text := nullif(btrim(p_phone), '');
--   v_email    text := public.normalize_email(p_email);
--   v_by_phone uuid;
--   v_by_email uuid;
--   v_contact  uuid;
--   v_matched  text;
--   v_conflict uuid;
-- BEGIN
--   IF v_phone IS NOT NULL THEN
--     SELECT c.id INTO v_by_phone
--     FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
--       AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
--     ORDER BY c.created_at ASC LIMIT 1;
--   END IF;
--
--   IF v_email IS NOT NULL THEN
--     SELECT c.id INTO v_by_email
--     FROM public.contacts c
--     WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
--       AND (public.normalize_email(c.email) = v_email OR public.normalize_email(c.secondary_email) = v_email)
--     ORDER BY c.created_at ASC LIMIT 1;
--   END IF;
--
--   IF v_by_phone IS NOT NULL THEN
--     v_contact := v_by_phone;
--     v_matched := 'phone';
--     IF v_by_email IS NOT NULL AND v_by_email <> v_by_phone THEN
--       v_conflict := v_by_email;
--     END IF;
--   ELSIF v_by_email IS NOT NULL THEN
--     v_contact := v_by_email;
--     v_matched := 'email';
--   END IF;
--
--   RETURN jsonb_build_object('contact_id', v_contact, 'matched_by', v_matched, 'conflict_contact_id', v_conflict);
-- END;
-- $function$
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_contact_for_form(p_workspace_id uuid, p_phone text, p_email text, p_social jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_social jsonb := CASE WHEN jsonb_typeof(p_social) = 'object' THEN p_social ELSE '{}'::jsonb END;
BEGIN
  RETURN private.contact_identity_lookup(
    p_workspace_id,
    private.contact_normalize_identity(jsonb_build_object(
      'phone',     p_phone,
      'email',     p_email,
      'instagram', v_social ->> 'instagram',
      'tiktok',    v_social ->> 'tiktok',
      'x',         v_social ->> 'x',
      'linkedin',  v_social ->> 'linkedin'
    ))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_contact_by_phone_or_email(p_workspace_id uuid, p_phone text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_found jsonb;
BEGIN
  v_found := private.contact_identity_lookup(
    p_workspace_id,
    private.contact_normalize_identity(jsonb_build_object('phone', p_phone, 'email', p_email))
  );
  RETURN jsonb_build_object(
    'contact_id', v_found -> 'contact_id',
    'matched_by', v_found -> 'matched_by',
    'conflict_contact_id', v_found -> 'conflict_contact_id'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.find_contact_for_form(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_contact_for_form(uuid, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.find_contact_by_phone_or_email(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_contact_by_phone_or_email(uuid, text, text) TO service_role;
