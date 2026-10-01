-- ============================================================
-- MIGRACION 00104 — LA FOTO DE PERFIL SE PUEDE REFRESCAR (F16)
-- ============================================================
-- Instagram sí manda la foto del contacto (`msg.sender.picture`), pero hoy
-- `find_or_link_contact` la guarda con COALESCE: "lo que ya estaba cargado
-- gana". La primera vez que se guarda una URL del CDN de Meta queda ahí para
-- siempre, y esas URLs VENCEN -- la burbuja termina mostrando un ícono roto.
--
-- El arreglo no es "pisar siempre": una foto que alguien subió a mano
-- (`avatar_source = 'manual'`) no se puede perder porque llegó un mensaje
-- nuevo, y una que F16 ya copió a nuestro Storage (`avatar_source = 'storage'`)
-- tampoco -- esa la refresca el código de TypeScript cada 30 días, no esta
-- función. Lo único que esta función puede refrescar es una foto `external`:
-- la URL cruda del proveedor, que es justo la que vence.
--
-- Por eso la columna `avatar_source` nueva, con default `'external'`: todo
-- contacto existente queda en ese estado, así que el próximo mensaje que
-- reciba ya refresca su foto con la URL fresca que trae ese mensaje -- eso
-- solo arregla el caso más común sin esperar a que el Bloque 4 de TypeScript
-- corra una sola vez.
--
-- ADVERTENCIA (siguiendo la instrucción explícita de la corrida): esta
-- migración reescribe `find_or_link_contact`, la función de deduplicación
-- cross-canal, que es la regla de negocio central del sistema. Copia la 00031
-- COMPLETA, letra por letra, y cambia SOLO las dos líneas del avatar (las que
-- en la 00031 están en `avatar_url = COALESCE(c.avatar_url, p_avatar_url)`,
-- una por cada rama que ya tenía esa línea). Nada más: ni el orden de
-- matcheo, ni las sugerencias por username, ni el audit log, ni
-- is_placeholder_name. La definición vieja (00031) queda completa más abajo
-- en este comentario, por si hay que volver atrás.
--
-- La 00047 le había sacado el EXECUTE a `authenticated` (una función sin
-- control de permisos propio no puede quedar abierta a cualquier rol: un
-- Member podía crear o vincular contactos saltándose el scope de leads). Esta
-- migración CREATE OR REPLACE la función de nuevo, así que el REVOKE se repite
-- al final -- si no, la función volvería a quedar abierta a `authenticated`,
-- que es exactamente el agujero que la 00047 cerró.
--
-- ---- La definición de la 00031, completa, por si hay que volver atrás ----
--
-- CREATE OR REPLACE FUNCTION public.find_or_link_contact(
--   p_channel_id      uuid,
--   p_sender_id       text,
--   p_display_name    text        DEFAULT NULL,
--   p_username        text        DEFAULT NULL,
--   p_avatar_url      text        DEFAULT NULL,
--   p_phone           text        DEFAULT NULL,
--   p_email           text        DEFAULT NULL,
--   p_interaction_at  timestamptz DEFAULT now(),
--   p_stamp_existing  boolean     DEFAULT true
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = ''
-- AS $OLD$
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
--       avatar_url = COALESCE(c.avatar_url, p_avatar_url),
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
--       avatar_url          = COALESCE(c.avatar_url, p_avatar_url),
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
-- $OLD$;
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas nuevas en contacts
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS avatar_source text NOT NULL DEFAULT 'external';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_avatar_source_check'
  ) THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_avatar_source_check
      CHECK (avatar_source IN ('external', 'storage', 'manual'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.contacts.avatar_source IS
  'De donde sale avatar_url. external: la URL cruda del proveedor (vence, se puede refrescar con el proximo mensaje). storage: F16 ya la copio a nuestro bucket avatars (se refresca cada 30 dias desde TypeScript). manual: alguien la cargo a mano (nunca se pisa).';
COMMENT ON COLUMN public.contacts.avatar_updated_at IS
  'Cuando se actualizo avatar_url por ultima vez. Lo usa F16 para decidir si refrescar una foto storage (cada 30 dias) y la retencion (borra la de un contacto storage sin mensajes en 6 meses).';

-- ------------------------------------------------------------
-- 2. find_or_link_contact: copia letra por letra de la 00031,
--    cambiando SOLO las dos lineas del avatar.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_or_link_contact(
  p_channel_id      uuid,
  p_sender_id       text,
  p_display_name    text        DEFAULT NULL,
  p_username        text        DEFAULT NULL,
  p_avatar_url      text        DEFAULT NULL,
  p_phone           text        DEFAULT NULL,
  p_email           text        DEFAULT NULL,
  p_interaction_at  timestamptz DEFAULT now(),
  p_stamp_existing  boolean     DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws         uuid;
  v_platform   text;
  v_contact    uuid;
  v_suggested  uuid;
  v_linked_by  text := NULL;
  v_phone      text := NULLIF(btrim(p_phone), '');
  v_email      text := public.normalize_email(p_email);
  v_handle     text := public.normalize_handle(p_username);
  v_name       text := NULLIF(btrim(p_display_name), '');
BEGIN
  SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
  FROM public.channels ch WHERE ch.id = p_channel_id;

  IF v_ws IS NULL THEN
    RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
                              'linked_by', NULL, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 1. El remitente ya es conocido en este canal ---------------------
  SELECT cc.contact_id INTO v_contact
  FROM public.contact_channels cc
  WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;

  IF v_contact IS NOT NULL THEN
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
      -- F16 (unica linea que cambia de la 00031): una foto external se
      -- refresca con la URL fresca que trae este mensaje. storage y manual
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

  -- ---- 2. Telefono exacto ---------------------------------------------
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'phone'; END IF;
  END IF;

  -- ---- 3. Email exacto -------------------------------------------------
  IF v_contact IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email
           OR public.normalize_email(c.secondary_email) = v_email)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'email'; END IF;
  END IF;

  -- ---- 4. Usuario exacto de la MISMA plataforma ------------------------
  IF v_contact IS NULL AND v_handle IS NOT NULL THEN
    SELECT c.id INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND CASE v_platform
            WHEN 'instagram' THEN lower(c.instagram_username) = v_handle
            WHEN 'twitter'   THEN lower(c.twitter_username)   = v_handle
            WHEN 'facebook'  THEN lower(c.facebook_id)        = v_handle
            WHEN 'tiktok'    THEN lower(c.tiktok_username)    = v_handle
            ELSE false
          END
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'username'; END IF;
  END IF;

  -- ---- Vincular al contacto encontrado ---------------------------------
  IF v_contact IS NOT NULL THEN
    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE COALESCE(c.display_name, v_name)
      END,
      -- F16 (la otra linea que cambia de la 00031): misma regla que arriba.
      avatar_url = CASE
        WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
        ELSE COALESCE(c.avatar_url, p_avatar_url)
      END,
      phone               = COALESCE(c.phone, v_phone),
      email               = COALESCE(c.email, v_email),
      whatsapp_phone      = CASE WHEN v_platform = 'whatsapp'  THEN COALESCE(c.whatsapp_phone, v_phone)  ELSE c.whatsapp_phone END,
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

  -- ---- 5. Contacto nuevo ------------------------------------------------
  IF v_handle IS NOT NULL THEN
    SELECT c.id INTO v_suggested
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND (lower(c.instagram_username) = v_handle
           OR lower(c.twitter_username) = v_handle
           OR lower(c.facebook_id) = v_handle
           OR lower(c.tiktok_username) = v_handle)
    ORDER BY c.created_at
    LIMIT 1;
  END IF;

  INSERT INTO public.contacts (
    workspace_id, display_name, avatar_url, last_interaction_at,
    phone, email, whatsapp_phone, instagram_username, twitter_username,
    facebook_id, tiktok_username, metadata
  ) VALUES (
    v_ws, v_name, p_avatar_url, p_interaction_at,
    v_phone, v_email,
    CASE WHEN v_platform = 'whatsapp'  THEN v_phone  ELSE NULL END,
    CASE WHEN v_platform = 'instagram' THEN v_handle ELSE NULL END,
    CASE WHEN v_platform = 'twitter'   THEN v_handle ELSE NULL END,
    CASE WHEN v_platform = 'facebook'  THEN v_handle ELSE NULL END,
    CASE WHEN v_platform = 'tiktok'    THEN v_handle ELSE NULL END,
    CASE
      WHEN v_suggested IS NOT NULL THEN
        jsonb_build_object('link_suggestions', jsonb_build_array(
          jsonb_build_object('contact_id', v_suggested, 'reason', 'username',
                             'handle', v_handle, 'at', p_interaction_at)))
      ELSE '{}'::jsonb
    END
  )
  RETURNING id INTO v_contact;

  INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
  VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
  ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

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
$$;

-- La 00047 le habia sacado el EXECUTE a `authenticated`. CREATE OR REPLACE no
-- toca los GRANT existentes de una funcion que ya existia, pero se repite el
-- REVOKE explicitamente para que esta migracion sea el registro de lo que
-- tiene que valer, sin depender de que la 00047 se haya aplicado antes.
REVOKE ALL ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) TO service_role;

COMMENT ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) IS
  'Dedup cross-canal. Solo service_role: no valida permisos, solo deriva el workspace del canal. Las rutas que la usan validan el rol antes y llaman con service client (lib/inbox-sync.ts). F16: el avatar_url de un contacto external se refresca con cada mensaje; storage y manual no se pisan nunca (avatar_source).';
