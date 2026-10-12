-- ============================================================================
-- 00175 — find_contact_for_form: buscar un contacto por telefono, email o usuario de red social
--         (Formularios, correccion R5c)
-- ============================================================================
-- Una respuesta puede traer un @ de Instagram, TikTok, X o un perfil de LinkedIn en vez de (o ademas de)
-- email/telefono. El workspace tiene cientos de contactos que llegaron por DM de Instagram con su
-- `instagram_username`: si alguien llena un formulario con su @ tiene que caer en ese mismo contacto.
--
-- ORDEN DE BUSQUEDA: telefono -> email -> Instagram -> TikTok -> X -> LinkedIn. Gana el primero que
-- encuentra un contacto (el mas antiguo, solo `deleted_at IS NULL`). Los demas datos que apuntaban a OTRO
-- contacto son conflictos: `conflict_contact_id` (el primero distinto, como siempre, para no romper la
-- pantalla) y `conflicts`: [{ by, contact_id }].
-- Facebook y YouTube NO se usan para buscar, solo se guardan: sus formatos (ids numericos, nombres de
-- canal, profile.php?id=) no son confiables para decir "es la misma persona".
--
-- `find_contact_by_phone_or_email` NO se toca: la usa Ventas (lib/sales/contacts.ts).
-- Aditiva. Como volver atras: DROP FUNCTION public.find_contact_for_form(uuid, text, text, jsonb);
--   DROP FUNCTION public.linkedin_slug(text); y los cuatro indices de abajo.
-- ============================================================================

-- El slug de `linkedin.com/in/<slug>` en minusculas, o NULL si no es un perfil. Inmutable: se indexa.
CREATE OR REPLACE FUNCTION public.linkedin_slug(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $$
  SELECT nullif(substring(lower(p_url) from '/in/([^/?#[:space:]]+)'), '');
$$;

-- Indices por red social dentro de un workspace (parciales; las busquedas corren en cada envio).
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_lower
  ON public.contacts (workspace_id, lower(instagram_username))
  WHERE deleted_at IS NULL AND instagram_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_tiktok_lower
  ON public.contacts (workspace_id, lower(tiktok_username))
  WHERE deleted_at IS NULL AND tiktok_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_twitter_lower
  ON public.contacts (workspace_id, lower(twitter_username))
  WHERE deleted_at IS NULL AND twitter_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_linkedin_slug
  ON public.contacts (workspace_id, public.linkedin_slug(linkedin_profile_url))
  WHERE deleted_at IS NULL AND linkedin_profile_url IS NOT NULL;

CREATE OR REPLACE FUNCTION public.find_contact_for_form(
  p_workspace_id uuid,
  p_phone text,
  p_email text,
  p_social jsonb DEFAULT '{}'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_phone  text := nullif(btrim(p_phone), '');
  v_email  text := public.normalize_email(p_email);
  v_social jsonb := CASE WHEN jsonb_typeof(p_social) = 'object' THEN p_social ELSE '{}'::jsonb END;
  v_ig     text := nullif(lower(btrim(regexp_replace(COALESCE(v_social ->> 'instagram', ''), '^@+', ''))), '');
  v_tt     text := nullif(lower(btrim(regexp_replace(COALESCE(v_social ->> 'tiktok', ''), '^@+', ''))), '');
  v_x      text := nullif(lower(btrim(regexp_replace(COALESCE(v_social ->> 'x', ''), '^@+', ''))), '');
  v_li     text := COALESCE(public.linkedin_slug(v_social ->> 'linkedin'), nullif(lower(btrim(v_social ->> 'linkedin')), ''));
  v_id     uuid;
  v_hits   jsonb := '[]'::jsonb;
  v_winner uuid;
  v_by     text;
  v_conflicts jsonb;
BEGIN
  -- 1. Telefono (el principal o el de WhatsApp de cualquier contacto).
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
    ORDER BY c.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'phone', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  -- 2. Email (el principal o el secundario).
  IF v_email IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email OR public.normalize_email(c.secondary_email) = v_email)
    ORDER BY c.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'email', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  -- 3 a 6. Redes sociales, en este orden. Se compara en minusculas (los contactos viejos pueden no estarlo).
  IF v_ig IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.instagram_username) = v_ig
    ORDER BY c.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'instagram', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  IF v_tt IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.tiktok_username) = v_tt
    ORDER BY c.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'tiktok', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  IF v_x IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.twitter_username) = v_x
    ORDER BY c.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'x', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  IF v_li IS NOT NULL THEN
    -- LinkedIn se compara por el slug de la URL, no por el texto entero.
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND public.linkedin_slug(c.linkedin_profile_url) = v_li
    ORDER BY c.created_at ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'linkedin', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  IF jsonb_array_length(v_hits) = 0 THEN
    RETURN jsonb_build_object('contact_id', NULL, 'matched_by', NULL, 'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb);
  END IF;

  v_winner := (v_hits -> 0 ->> 'contact_id')::uuid;
  v_by := v_hits -> 0 ->> 'by';

  SELECT COALESCE(jsonb_agg(h), '[]'::jsonb) INTO v_conflicts
  FROM jsonb_array_elements(v_hits) h
  WHERE (h ->> 'contact_id')::uuid <> v_winner;

  RETURN jsonb_build_object(
    'contact_id', v_winner,
    'matched_by', v_by,
    'conflict_contact_id', v_conflicts -> 0 ->> 'contact_id',
    'conflicts', v_conflicts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.find_contact_for_form(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_contact_for_form(uuid, text, text, jsonb) TO service_role;
