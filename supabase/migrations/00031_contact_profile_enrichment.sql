-- ============================================================
-- MIGRACION 00031 — COMPLETAR EL PERFIL DEL CONTACTO CON LO QUE MANDA EL CANAL
-- ============================================================
-- Cuando alguien le escribe a la cuenta sin haber interactuado antes,
-- Instagram no le da a Zernio el perfil de esa persona y llega el nombre
-- "Instagram User". Eso no es un dato: es la forma que tiene la plataforma de
-- decir que no lo tiene. Cuando esa misma persona responde, el perfil aparece
-- — pero hasta ahora no se guardaba, porque find_or_link_contact tiene dos
-- ramas y ninguna lo hacia:
--
--   Rama 1 (el remitente ya esta mapeado en contact_channels): solo sellaba
--   last_interaction_at. Es la rama por la que pasa el 99% de los mensajes de
--   una conversacion ya empezada, o sea justo cuando el perfil mejora.
--
--   Rama 2 (se lo encontro por telefono, email o usuario): usa COALESCE, o sea
--   "lo que ya estaba cargado gana". Correcto para no pisar lo que escribio
--   una persona, pero deja "Instagram User" para siempre, porque no es NULL.
--
-- La regla que queda: el canal escribe donde hay un hueco, o donde el valor que
-- hay lo puso el propio canal como placeholder. Lo que escribio una persona no
-- se toca nunca. Un nombre que no esta en la lista de placeholders se asume
-- escrito por una persona (o real), y es intocable.
--
-- Por que aca y no en TypeScript: los mensajes entran por dos receptores mas
-- el backfill mas el procesador de comentarios, y los cuatro llaman a esta
-- funcion. Hacerlo adentro es un solo lugar, sin una consulta extra por
-- mensaje, y en la misma transaccion que el resto del alta.
--
-- La lista de placeholders esta tambien en lib/contacts/anonymous.ts, porque
-- la necesita el filtro de contactos anonimos. Un test compara las dos.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La lista de nombres que no son nombres
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_placeholder_name(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT lower(btrim(coalesce(p_name, ''))) IN (
    '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
  );
$$;

REVOKE ALL ON FUNCTION public.is_placeholder_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_placeholder_name(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_placeholder_name(text) IS
  'true si el nombre es un relleno que manda la plataforma cuando no tiene el perfil ("Instagram User" y companiia), y no algo que escribio una persona. Espejo de PLACEHOLDER_NAMES en lib/contacts/anonymous.ts.';

-- ------------------------------------------------------------
-- 2. find_or_link_contact completa el perfil en las dos ramas
-- ------------------------------------------------------------
-- Se reescribe entera porque plpgsql no admite parches parciales. Respecto de
-- la version de la 00025 cambian dos cosas y nada mas:
--   - la rama 1 ahora completa nombre, usuario y foto ademas de sellar la fecha
--   - el display_name de la rama 2 pisa el placeholder
-- El resto (orden de matcheo, sugerencias por username de otra plataforma,
-- audit log) es identico.

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
    -- Ademas de sellar la fecha, se aprovecha lo que traiga este mensaje: es
    -- la rama por la que pasan los mensajes de una conversacion ya empezada,
    -- que es cuando Instagram recien expone el perfil.
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
      avatar_url = COALESCE(c.avatar_url, p_avatar_url),
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

    -- El username tambien se completa en el mapeo del canal, que es de donde
    -- lo lee la ficha para mostrar por donde escribio.
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
    -- COALESCE en casi todo: lo que ya estaba cargado gana. La excepcion es el
    -- nombre, que si es un placeholder de la plataforma se reemplaza: dejarlo
    -- seria conservar un "no se quien es" pudiendo saberlo.
    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE COALESCE(c.display_name, v_name)
      END,
      avatar_url          = COALESCE(c.avatar_url, p_avatar_url),
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

    -- Vinculacion automatica: queda registrada (F12).
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
    VALUES (v_ws, 'contact', v_contact, 'link',
            jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
                               'platform', v_platform, 'automatic', true),
            NULL);

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', v_linked_by, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 5. Contacto nuevo ------------------------------------------------
  -- Antes de crearlo: si el handle coincide con OTRA plataforma, es un match
  -- sin confirmar. No se vincula, se deja anotado para que decida una persona.
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

REVOKE ALL ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) IS
  'Encuentra o crea el contacto detras de un remitente, y de paso completa su perfil con lo que traiga el canal: escribe donde hay un hueco o donde el valor que hay es un placeholder de la plataforma, nunca sobre lo que cargo una persona. La llaman los dos receptores de webhooks, el backfill y el procesador de comentarios.';
