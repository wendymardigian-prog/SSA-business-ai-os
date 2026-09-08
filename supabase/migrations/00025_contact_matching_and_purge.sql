-- ============================================================
-- MIGRACION 00025 — DEDUPLICACION CROSS-CANAL Y PURGA (F12 + F15)
-- ============================================================
-- Por que esto vive en la base y no en TypeScript:
--
-- La logica de "encontrar o crear el contacto de este remitente" estaba
-- escrita tres veces: en supabase/functions/_shared/inbound.ts (que corre en
-- Deno y es el receptor real hoy), en lib/inbox-sync.ts y otra vez adentro de
-- lib/comment-processor.ts. La primera no puede importar de lib/ porque es
-- otro runtime, asi que sumar el matching cross-canal en TypeScript
-- significaba escribirlo y mantenerlo tres veces.
--
-- Ademas hay una carrera real: si el mismo lead escribe por Instagram y por
-- WhatsApp en el mismo segundo, dos procesos leen "no existe" y los dos
-- crean el contacto. Adentro de una funcion es una sola transaccion.
--
-- Orden de identificacion (regla de negocio: nunca por nombre solo):
--   1. Ya conocemos a este remitente en este canal.
--   2. Telefono exacto  -> vincula automatico.
--   3. Email exacto     -> vincula automatico.
--   4. Username exacto en la columna de LA MISMA plataforma del canal
--      (los usernames son unicos por plataforma) -> vincula automatico.
--   5. Nada             -> contacto nuevo.
--
-- Un username que coincide en OTRA plataforma no vincula: queda como
-- sugerencia en contacts.metadata.link_suggestions para que la ficha se la
-- ofrezca al operador. Es lo que pide F12 para los matches sin confirmar.
--
-- Cada canal conserva SU conversacion: esta funcion solo toca contacts y
-- contact_channels. La conversacion la crea upsertConversation por separado,
-- siempre por (channel_id, contact_id).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Normalizadores
-- ------------------------------------------------------------
-- Un username se guarda siempre en minusculas y sin arroba, para que la
-- comparacion sea exacta y el indice sirva. El telefono ya llega normalizado
-- como "+<digitos>" desde lib/phone.ts.

CREATE OR REPLACE FUNCTION public.normalize_handle(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(lower(btrim(ltrim(btrim(p_raw), '@'))), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_email(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(lower(btrim(p_raw)), '');
$$;

REVOKE ALL ON FUNCTION public.normalize_handle(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_handle(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_email(text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. find_or_link_contact
-- ------------------------------------------------------------
-- Devuelve jsonb:
--   { "contact_id": uuid,
--     "existed": bool,            -- ya habia un contacto detras
--     "linked_by": text,          -- channel | phone | email | username | null
--     "suggested_contact_id": uuid | null }
--
-- SECURITY DEFINER: corre como dueña de las tablas, asi que ve todos los
-- contactos del workspace aunque quien la llame sea un Member con scope. Es
-- necesario — si no, un mensaje entrante crearia duplicados de leads que el
-- operador no tiene asignados. La funcion nunca DEVUELVE datos del contacto,
-- solo su id, asi que no filtra informacion fuera del scope.

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
  v_ws          uuid;
  v_platform    text;
  v_handle      text;
  v_email       text;
  v_phone       text;
  v_contact     uuid;
  v_suggested   uuid;
  v_linked_by   text;
BEGIN
  SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
  FROM public.channels ch WHERE ch.id = p_channel_id;

  IF v_ws IS NULL THEN
    RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
                              'linked_by', NULL, 'suggested_contact_id', NULL);
  END IF;

  v_handle := public.normalize_handle(p_username);
  v_email  := public.normalize_email(p_email);
  v_phone  := NULLIF(btrim(p_phone), '');

  -- ---- 1. Remitente ya conocido en este canal -------------------------
  SELECT cc.contact_id INTO v_contact
  FROM public.contact_channels cc
  WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;

  IF v_contact IS NOT NULL THEN
    IF p_stamp_existing THEN
      UPDATE public.contacts
      SET last_interaction_at = p_interaction_at
      WHERE id = v_contact;
    END IF;
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
      AND (lower(c.email) = v_email OR lower(c.secondary_email) = v_email)
    ORDER BY c.created_at
    LIMIT 1;
    IF v_contact IS NOT NULL THEN v_linked_by := 'email'; END IF;
  END IF;

  -- ---- 4. Username en la MISMA plataforma ------------------------------
  -- Ramas explicitas en vez de SQL dinamico: se leen mejor y usan los
  -- indices parciales de la migracion 00022.
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
    -- COALESCE en ese orden: lo que ya estaba cargado gana. Un mensaje
    -- entrante completa huecos, nunca pisa lo que cargo una persona.
    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name        = COALESCE(c.display_name, NULLIF(btrim(p_display_name), '')),
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
      AND v_handle IN (
        lower(c.instagram_username), lower(c.twitter_username),
        lower(c.tiktok_username),    lower(c.facebook_id)
      )
    ORDER BY c.created_at
    LIMIT 1;
  END IF;

  INSERT INTO public.contacts (
    workspace_id, display_name, avatar_url, last_interaction_at,
    phone, email, whatsapp_phone, instagram_username, twitter_username,
    facebook_id, tiktok_username, metadata
  )
  VALUES (
    v_ws,
    NULLIF(btrim(p_display_name), ''),
    p_avatar_url,
    p_interaction_at,
    v_phone,
    v_email,
    CASE WHEN v_platform = 'whatsapp'  THEN v_phone  END,
    CASE WHEN v_platform = 'instagram' THEN v_handle END,
    CASE WHEN v_platform = 'twitter'   THEN v_handle END,
    CASE WHEN v_platform = 'facebook'  THEN v_handle END,
    CASE WHEN v_platform = 'tiktok'    THEN v_handle END,
    CASE
      WHEN v_suggested IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('link_suggestions', jsonb_build_array(jsonb_build_object(
             'contact_id', v_suggested,
             'reason', 'username',
             'handle', v_handle,
             'at', p_interaction_at
           )))
    END
  )
  RETURNING id INTO v_contact;

  INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
  VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
  ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

  INSERT INTO public.analytics_events (workspace_id, contact_id, event_type)
  VALUES (v_ws, v_contact, 'contact_created');

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
  VALUES (v_ws, 'contact', v_contact, 'create',
          jsonb_build_object('source', 'inbound', 'channel_id', p_channel_id,
                             'platform', v_platform,
                             'suggested_contact_id', v_suggested),
          NULL);

  RETURN jsonb_build_object('contact_id', v_contact, 'existed', false,
                            'linked_by', NULL, 'suggested_contact_id', v_suggested);
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.find_or_link_contact(uuid, text, text, text, text, text, text, timestamptz, boolean) IS
  'Encuentra o crea el contacto de un remitente, deduplicando por telefono, email o username de la misma plataforma. Unica fuente de verdad: la usan el webhook (Deno), el backfill y el procesador de comentarios.';

-- ------------------------------------------------------------
-- 3. Purga de los borrados logicos (F15)
-- ------------------------------------------------------------
-- Borrar un contacto arrastra sus notas, conversaciones, mensajes, tags y
-- custom fields: todas esas FK son ON DELETE CASCADE desde la migracion 00001.
-- Por eso los contactos van primero y despues se limpia lo que quedo suelto.

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_templates  integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_templates WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_templates = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_templates', v_templates
  );
END;
$$;

-- Solo el servidor la llama, con la service key, desde /api/cron/purge-deleted.
REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;

COMMENT ON FUNCTION public.purge_soft_deleted(integer) IS
  'Borra de verdad lo que lleva mas de N dias marcado como eliminado. La llama el cron diario /api/cron/purge-deleted.';
