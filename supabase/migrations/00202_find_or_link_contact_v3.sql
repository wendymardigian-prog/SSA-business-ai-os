-- ============================================================================
-- 00202 — find_or_link_contact v3: los entrantes por canal sobre la regla central (C2)
-- ============================================================================
-- Parte de la definicion VIVA (la 00104; el md5 esta abajo). Lo que cambia:
--   * Si el remitente no es conocido en el canal, busca o crea con `find_or_create_contact` en modo
--     'link_channel' (bloqueo por dato: dos mensajes simultaneos de la misma persona dan UN contacto).
--   * El telefono se normaliza con `normalize_phone` (antes solo `btrim`).
--   * Al completar un contacto encontrado, un telefono o email que ya es de OTRO contacto NO se escribe
--     (dejaria dos contactos con el mismo dato); el resto de las columnas se completan como siempre.
-- Lo que NO cambia: la firma, los valores de `linked_by` (channel | phone | email | username), la
-- sugerencia de vinculacion por usuario de otra red (`link_suggestions`), `analytics_events` y `audit_log`,
-- la foto de perfil (F16), el sello de `last_interaction_at` y la rama del remitente ya conocido, que
-- sigue sin bloquear nada.
-- Como volver atras: pegar la definicion de abajo (CREATE OR REPLACE).
--
-- DEFINICIONES VIGENTES ANTES DE ESTA MIGRACION (copiadas de la base con pg_get_functiondef).
-- Para volver atras: pegar la que corresponda (CREATE OR REPLACE).
--
-- ==== find_or_link_contact (md5 861440d10e8519b67606d78c53ca663b) ====
-- CREATE OR REPLACE FUNCTION public.find_or_link_contact(p_channel_id uuid, p_sender_id text, p_display_name text DEFAULT NULL::text, p_username text DEFAULT NULL::text, p_avatar_url text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_interaction_at timestamp with time zone DEFAULT now(), p_stamp_existing boolean DEFAULT true)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_ws         uuid;
--   v_platform   text;
--   v_contact    uuid;
--   v_suggested  uuid;
--   v_linked_by  text := NULL;
--   v_phone      text := NULLIF(btrim(p_phone), '');
--   v_email      text := public.normalize_email(p_email);
--   v_handle     text := public.normalize_handle(p_username);
--   v_name       text := NULLIF(btrim(p_display_name), '');
-- BEGIN
--   SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
--   FROM public.channels ch WHERE ch.id = p_channel_id;
--
--   IF v_ws IS NULL THEN
--     RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
--                               'linked_by', NULL, 'suggested_contact_id', NULL);
--   END IF;
--
--   -- ---- 1. El remitente ya es conocido en este canal ---------------------
--   SELECT cc.contact_id INTO v_contact
--   FROM public.contact_channels cc
--   WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;
--
--   IF v_contact IS NOT NULL THEN
--     UPDATE public.contacts c SET
--       last_interaction_at = CASE
--         WHEN p_stamp_existing THEN p_interaction_at
--         ELSE c.last_interaction_at
--       END,
--       display_name = CASE
--         WHEN v_name IS NOT NULL
--          AND NOT public.is_placeholder_name(v_name)
--          AND public.is_placeholder_name(c.display_name)
--         THEN v_name
--         ELSE c.display_name
--       END,
--       -- F16 (unica linea que cambia de la 00031): una foto external se
--       -- refresca con la URL fresca que trae este mensaje. storage y manual
--       -- no se pisan nunca.
--       avatar_url = CASE
--         WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
--         ELSE COALESCE(c.avatar_url, p_avatar_url)
--       END,
--       instagram_username = CASE
--         WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle)
--         ELSE c.instagram_username
--       END,
--       twitter_username = CASE
--         WHEN v_platform = 'twitter' THEN COALESCE(c.twitter_username, v_handle)
--         ELSE c.twitter_username
--       END,
--       facebook_id = CASE
--         WHEN v_platform = 'facebook' THEN COALESCE(c.facebook_id, v_handle)
--         ELSE c.facebook_id
--       END,
--       tiktok_username = CASE
--         WHEN v_platform = 'tiktok' THEN COALESCE(c.tiktok_username, v_handle)
--         ELSE c.tiktok_username
--       END
--     WHERE c.id = v_contact;
--
--     UPDATE public.contact_channels cc
--     SET platform_username = COALESCE(cc.platform_username, v_handle)
--     WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;
--
--     RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
--                               'linked_by', 'channel', 'suggested_contact_id', NULL);
--   END IF;
--
--   -- ---- 2. Telefono exacto ---------------------------------------------
--   IF v_phone IS NOT NULL THEN
--     SELECT c.id INTO v_contact
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
--     ORDER BY c.created_at
--     LIMIT 1;
--     IF v_contact IS NOT NULL THEN v_linked_by := 'phone'; END IF;
--   END IF;
--
--   -- ---- 3. Email exacto -------------------------------------------------
--   IF v_contact IS NULL AND v_email IS NOT NULL THEN
--     SELECT c.id INTO v_contact
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND (public.normalize_email(c.email) = v_email
--            OR public.normalize_email(c.secondary_email) = v_email)
--     ORDER BY c.created_at
--     LIMIT 1;
--     IF v_contact IS NOT NULL THEN v_linked_by := 'email'; END IF;
--   END IF;
--
--   -- ---- 4. Usuario exacto de la MISMA plataforma ------------------------
--   IF v_contact IS NULL AND v_handle IS NOT NULL THEN
--     SELECT c.id INTO v_contact
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND CASE v_platform
--             WHEN 'instagram' THEN lower(c.instagram_username) = v_handle
--             WHEN 'twitter'   THEN lower(c.twitter_username)   = v_handle
--             WHEN 'facebook'  THEN lower(c.facebook_id)        = v_handle
--             WHEN 'tiktok'    THEN lower(c.tiktok_username)    = v_handle
--             ELSE false
--           END
--     ORDER BY c.created_at
--     LIMIT 1;
--     IF v_contact IS NOT NULL THEN v_linked_by := 'username'; END IF;
--   END IF;
--
--   -- ---- Vincular al contacto encontrado ---------------------------------
--   IF v_contact IS NOT NULL THEN
--     UPDATE public.contacts c SET
--       last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
--       display_name = CASE
--         WHEN v_name IS NOT NULL
--          AND NOT public.is_placeholder_name(v_name)
--          AND public.is_placeholder_name(c.display_name)
--         THEN v_name
--         ELSE COALESCE(c.display_name, v_name)
--       END,
--       -- F16 (la otra linea que cambia de la 00031): misma regla que arriba.
--       avatar_url = CASE
--         WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
--         ELSE COALESCE(c.avatar_url, p_avatar_url)
--       END,
--       phone               = COALESCE(c.phone, v_phone),
--       email               = COALESCE(c.email, v_email),
--       whatsapp_phone      = CASE WHEN v_platform = 'whatsapp'  THEN COALESCE(c.whatsapp_phone, v_phone)  ELSE c.whatsapp_phone END,
--       instagram_username  = CASE WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle) ELSE c.instagram_username END,
--       twitter_username    = CASE WHEN v_platform = 'twitter'   THEN COALESCE(c.twitter_username, v_handle)   ELSE c.twitter_username END,
--       facebook_id         = CASE WHEN v_platform = 'facebook'  THEN COALESCE(c.facebook_id, v_handle)        ELSE c.facebook_id END,
--       tiktok_username     = CASE WHEN v_platform = 'tiktok'    THEN COALESCE(c.tiktok_username, v_handle)    ELSE c.tiktok_username END
--     WHERE c.id = v_contact;
--
--     INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
--     VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
--     ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;
--
--     INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
--     VALUES (v_ws, 'contact', v_contact, 'link',
--             jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
--                                'platform', v_platform, 'automatic', true),
--             NULL);
--
--     RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
--                               'linked_by', v_linked_by, 'suggested_contact_id', NULL);
--   END IF;
--
--   -- ---- 5. Contacto nuevo ------------------------------------------------
--   IF v_handle IS NOT NULL THEN
--     SELECT c.id INTO v_suggested
--     FROM public.contacts c
--     WHERE c.workspace_id = v_ws
--       AND c.deleted_at IS NULL
--       AND (lower(c.instagram_username) = v_handle
--            OR lower(c.twitter_username) = v_handle
--            OR lower(c.facebook_id) = v_handle
--            OR lower(c.tiktok_username) = v_handle)
--     ORDER BY c.created_at
--     LIMIT 1;
--   END IF;
--
--   INSERT INTO public.contacts (
--     workspace_id, display_name, avatar_url, last_interaction_at,
--     phone, email, whatsapp_phone, instagram_username, twitter_username,
--     facebook_id, tiktok_username, metadata
--   ) VALUES (
--     v_ws, v_name, p_avatar_url, p_interaction_at,
--     v_phone, v_email,
--     CASE WHEN v_platform = 'whatsapp'  THEN v_phone  ELSE NULL END,
--     CASE WHEN v_platform = 'instagram' THEN v_handle ELSE NULL END,
--     CASE WHEN v_platform = 'twitter'   THEN v_handle ELSE NULL END,
--     CASE WHEN v_platform = 'facebook'  THEN v_handle ELSE NULL END,
--     CASE WHEN v_platform = 'tiktok'    THEN v_handle ELSE NULL END,
--     CASE
--       WHEN v_suggested IS NOT NULL THEN
--         jsonb_build_object('link_suggestions', jsonb_build_array(
--           jsonb_build_object('contact_id', v_suggested, 'reason', 'username',
--                              'handle', v_handle, 'at', p_interaction_at)))
--       ELSE '{}'::jsonb
--     END
--   )
--   RETURNING id INTO v_contact;
--
--   INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
--   VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
--   ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;
--
--   INSERT INTO public.analytics_events (workspace_id, contact_id, event_type, metadata)
--   VALUES (v_ws, v_contact, 'contact_created',
--           jsonb_build_object('channel_id', p_channel_id, 'platform', v_platform));
--
--   INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
--   VALUES (v_ws, 'contact', v_contact, 'create',
--           jsonb_build_object('source', 'inbound', 'channel_id', p_channel_id,
--                              'platform', v_platform), NULL);
--
--   RETURN jsonb_build_object('contact_id', v_contact, 'existed', false,
--                             'linked_by', NULL, 'suggested_contact_id', v_suggested);
-- END;
-- $function$
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_or_link_contact(p_channel_id uuid, p_sender_id text, p_display_name text DEFAULT NULL::text, p_username text DEFAULT NULL::text, p_avatar_url text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_interaction_at timestamp with time zone DEFAULT now(), p_stamp_existing boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws         uuid;
  v_platform   text;
  v_contact    uuid;
  v_suggested  uuid;
  v_linked_by  text := NULL;
  v_phone      text := public.normalize_phone(p_phone);
  v_email      text := public.normalize_email(p_email);
  v_handle     text := public.normalize_handle(p_username);
  v_name       text := NULLIF(btrim(p_display_name), '');
  v_known      boolean := false;
  v_central    jsonb;
  v_identity   jsonb;
  v_skip_phone boolean := false;
  v_skip_email boolean := false;
BEGIN
  SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
  FROM public.channels ch WHERE ch.id = p_channel_id;

  IF v_ws IS NULL THEN
    RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
                              'linked_by', NULL, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 1. El remitente ya es conocido en este canal (sin bloqueos: es lo comun) ------------------
  SELECT cc.contact_id INTO v_contact
  FROM public.contact_channels cc
  WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;
  v_known := v_contact IS NOT NULL;

  -- ---- 2. Buscar o crear con la regla central ---------------------------------------------------
  IF NOT v_known THEN
    v_identity := jsonb_strip_nulls(jsonb_build_object(
      'channel_id',     p_channel_id,
      'sender_id',      p_sender_id,
      'phone',          v_phone,
      'whatsapp_phone', CASE WHEN v_platform = 'whatsapp' THEN v_phone END,
      'email',          v_email,
      'instagram',      CASE WHEN v_platform = 'instagram' THEN v_handle END,
      'x',              CASE WHEN v_platform = 'twitter'   THEN v_handle END,
      'facebook',       CASE WHEN v_platform = 'facebook'  THEN v_handle END,
      'tiktok',         CASE WHEN v_platform = 'tiktok'    THEN v_handle END
    ));

    v_central := public.find_or_create_contact(
      v_ws,
      v_identity,
      jsonb_strip_nulls(jsonb_build_object(
        'display_name', v_name,
        'avatar_url', p_avatar_url,
        'last_interaction_at', p_interaction_at,
        'metadata', '{}'::jsonb
      )),
      'link_channel'
    );
    v_contact := (v_central ->> 'contact_id')::uuid;

    -- La regla central tambien mira el canal: otro mensaje de este mismo remitente pudo ganarnos de mano.
    IF v_central ->> 'matched_by' = 'channel' THEN v_known := true; END IF;
  END IF;

  -- ---- Remitente ya conocido ---------------------------------------------------------------------
  IF v_known THEN
    UPDATE public.contacts c SET
      last_interaction_at = CASE
        WHEN p_stamp_existing THEN p_interaction_at
        ELSE c.last_interaction_at
      END,
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE c.display_name
      END,
      -- F16: una foto external se refresca con la URL fresca que trae este mensaje. storage y manual
      -- no se pisan nunca.
      avatar_url = CASE
        WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
        ELSE COALESCE(c.avatar_url, p_avatar_url)
      END,
      instagram_username = CASE
        WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle)
        ELSE c.instagram_username
      END,
      twitter_username = CASE
        WHEN v_platform = 'twitter' THEN COALESCE(c.twitter_username, v_handle)
        ELSE c.twitter_username
      END,
      facebook_id = CASE
        WHEN v_platform = 'facebook' THEN COALESCE(c.facebook_id, v_handle)
        ELSE c.facebook_id
      END,
      tiktok_username = CASE
        WHEN v_platform = 'tiktok' THEN COALESCE(c.tiktok_username, v_handle)
        ELSE c.tiktok_username
      END
    WHERE c.id = v_contact;

    UPDATE public.contact_channels cc
    SET platform_username = COALESCE(cc.platform_username, v_handle)
    WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', 'channel', 'suggested_contact_id', NULL);
  END IF;

  -- ---- Lo encontro por otro dato: vincular al contacto -------------------------------------------
  IF (v_central ->> 'status') = 'found' THEN
    v_linked_by := CASE v_central ->> 'matched_by'
                     WHEN 'phone' THEN 'phone'
                     WHEN 'email' THEN 'email'
                     ELSE 'username'
                   END;

    -- Un telefono o email que ya es de OTRO contacto no se escribe en este.
    v_skip_phone := private.contact_value_taken(v_ws, v_contact, 'phone', v_phone);
    v_skip_email := private.contact_value_taken(v_ws, v_contact, 'email', v_email);

    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE COALESCE(c.display_name, v_name)
      END,
      avatar_url = CASE
        WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
        ELSE COALESCE(c.avatar_url, p_avatar_url)
      END,
      phone               = CASE WHEN v_skip_phone THEN c.phone ELSE COALESCE(c.phone, v_phone) END,
      email               = CASE WHEN v_skip_email THEN c.email ELSE COALESCE(c.email, v_email) END,
      whatsapp_phone      = CASE WHEN v_platform = 'whatsapp' AND NOT v_skip_phone THEN COALESCE(c.whatsapp_phone, v_phone) ELSE c.whatsapp_phone END,
      instagram_username  = CASE WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle) ELSE c.instagram_username END,
      twitter_username    = CASE WHEN v_platform = 'twitter'   THEN COALESCE(c.twitter_username, v_handle)   ELSE c.twitter_username END,
      facebook_id         = CASE WHEN v_platform = 'facebook'  THEN COALESCE(c.facebook_id, v_handle)        ELSE c.facebook_id END,
      tiktok_username     = CASE WHEN v_platform = 'tiktok'    THEN COALESCE(c.tiktok_username, v_handle)    ELSE c.tiktok_username END
    WHERE c.id = v_contact;

    INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
    VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
    ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
    VALUES (v_ws, 'contact', v_contact, 'link',
            jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
                               'platform', v_platform, 'automatic', true),
            NULL);

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', v_linked_by, 'suggested_contact_id', NULL);
  END IF;

  -- ---- Contacto nuevo (ya lo creo la regla central, con el canal vinculado) ----------------------
  IF v_handle IS NOT NULL THEN
    SELECT c.id INTO v_suggested
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND c.id <> v_contact
      AND (lower(c.instagram_username) = v_handle
           OR lower(c.twitter_username) = v_handle
           OR lower(c.facebook_id) = v_handle
           OR lower(c.tiktok_username) = v_handle)
    ORDER BY c.created_at
    LIMIT 1;

    IF v_suggested IS NOT NULL THEN
      UPDATE public.contacts c
      SET metadata = jsonb_build_object('link_suggestions', jsonb_build_array(
            jsonb_build_object('contact_id', v_suggested, 'reason', 'username',
                               'handle', v_handle, 'at', p_interaction_at)))
      WHERE c.id = v_contact;
    END IF;
  END IF;

  INSERT INTO public.analytics_events (workspace_id, contact_id, event_type, metadata)
  VALUES (v_ws, v_contact, 'contact_created',
          jsonb_build_object('channel_id', p_channel_id, 'platform', v_platform));

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
  VALUES (v_ws, 'contact', v_contact, 'create',
          jsonb_build_object('source', 'inbound', 'channel_id', p_channel_id,
                             'platform', v_platform), NULL);

  RETURN jsonb_build_object('contact_id', v_contact, 'existed', false,
                            'linked_by', NULL, 'suggested_contact_id', v_suggested);
END;
$function$;

REVOKE ALL ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamp with time zone, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamp with time zone, boolean) TO service_role;
