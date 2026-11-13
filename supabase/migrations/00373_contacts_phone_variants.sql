-- ============================================================================
-- 00373 — +52 y +521 (y +54 y +549) son el mismo numero al buscar un contacto
-- ============================================================================
-- El 13/11/2026 aparecieron 63 personas de Mexico guardadas dos veces: el formulario o la agenda las
-- guardaba con +52 55… y WhatsApp con +521 55… (el «1» del celular). La regla unica de contactos
-- (00200) comparaba el telefono exacto, asi que cada forma creaba su propio contacto. Lo mismo puede pasar
-- en Argentina con +54 11… y +549 11… (el «9» del celular). Los 63 pares ya se unieron con merge_contacts;
-- esta migracion evita que vuelva a pasar.
--
-- Que cambia:
--   * public.phone_variants(text)  NUEVA. Las formas equivalentes de un numero ya normalizado (incluido el
--                                  mismo). Gemela de `phoneVariants` (lib/phone.ts).
--   * public.phone_canonical(text) NUEVA. Una forma fija por numero (la corta: +52…, +54…), para el
--                                  bloqueo. Gemela de `phoneCanonical` (lib/phone.ts).
--   * private.contact_identity_lookup   el telefono y el WhatsApp se buscan en todas sus formas.
--   * private.contact_value_taken       «¿ese telefono ya es de otro contacto?» tambien en todas sus formas.
--   * public.find_or_create_contact     el bloqueo por telefono usa la forma fija: una llegada con +52 y otra
--                                       con +521 al mismo tiempo se esperan y no crean dos contactos.
-- Lo demas de las tres funciones queda igual (se parte de la definicion en produccion del 13/11/2026).
--
-- Regla: solo por largo. +521 seguido de 10 digitos <-> +52 seguido de 10 digitos; +549 seguido de 10
-- digitos <-> +54 seguido de 10 digitos. Cualquier otro numero tiene una sola forma.
--
-- Como volver atras: volver a correr las definiciones de la 00200 de las tres funciones y despues
--   DROP FUNCTION public.phone_canonical(text);
--   DROP FUNCTION public.phone_variants(text);
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Las formas de un numero y su forma fija.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phone_variants(p_phone text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_phone IS NULL THEN NULL
    WHEN p_phone ~ '^\+521[0-9]{10}$' THEN ARRAY[p_phone, '+52' || substr(p_phone, 5)]
    WHEN p_phone ~ '^\+52[0-9]{10}$'  THEN ARRAY[p_phone, '+521' || substr(p_phone, 4)]
    WHEN p_phone ~ '^\+549[0-9]{10}$' THEN ARRAY[p_phone, '+54' || substr(p_phone, 5)]
    WHEN p_phone ~ '^\+54[0-9]{10}$'  THEN ARRAY[p_phone, '+549' || substr(p_phone, 4)]
    ELSE ARRAY[p_phone]
  END;
$function$;

CREATE OR REPLACE FUNCTION public.phone_canonical(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_phone ~ '^\+521[0-9]{10}$' THEN '+52' || substr(p_phone, 5)
    WHEN p_phone ~ '^\+549[0-9]{10}$' THEN '+54' || substr(p_phone, 5)
    ELSE p_phone
  END;
$function$;

REVOKE ALL ON FUNCTION public.phone_variants(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_canonical(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_variants(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_canonical(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. La busqueda.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contact_identity_lookup(p_workspace_id uuid, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_id        uuid;
  v_hits      jsonb := '[]'::jsonb;
  v_winner    uuid;
  v_by        text;
  v_conflicts jsonb;
  v_phone     text := p_identity ->> 'phone';
  v_wa        text := p_identity ->> 'whatsapp_phone';
  v_phone_any text[] := public.phone_variants(p_identity ->> 'phone');
  v_wa_any    text[] := public.phone_variants(p_identity ->> 'whatsapp_phone');
  v_email     text := p_identity ->> 'email';
  v_email2    text := p_identity ->> 'secondary_email';
  v_ig        text := p_identity ->> 'instagram';
  v_tt        text := p_identity ->> 'tiktok';
  v_x         text := p_identity ->> 'x';
  v_li        text := public.linkedin_slug(p_identity ->> 'linkedin');
  v_fb        text := p_identity ->> 'facebook';
BEGIN
  -- 1. El canal: el remitente ya es conocido. Gana y corta (no hay conflictos que mirar).
  IF p_identity ->> 'channel_id' IS NOT NULL THEN
    -- Sin filtrar `deleted_at`, como `find_or_link_contact` desde siempre: si el contacto de un remitente
    -- conocido esta borrado, el mensaje sigue yendo a el (crear otro dejaria un canal huerfano).
    SELECT cc.contact_id INTO v_id
    FROM public.contact_channels cc
    WHERE cc.channel_id = (p_identity ->> 'channel_id')::uuid
      AND cc.platform_sender_id = p_identity ->> 'sender_id'
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('contact_id', v_id, 'matched_by', 'channel', 'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb);
    END IF;
  END IF;

  -- 2. Telefono: el recibido como `phone` y despues el de WhatsApp; cada uno contra las dos columnas y en
  --    todas sus formas (00373: +52/+521 en Mexico, +54/+549 en Argentina son el mismo numero).
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = ANY (v_phone_any) OR c.whatsapp_phone = ANY (v_phone_any))
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'phone', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_wa IS NOT NULL AND public.phone_canonical(v_wa) IS DISTINCT FROM public.phone_canonical(v_phone) THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = ANY (v_wa_any) OR c.whatsapp_phone = ANY (v_wa_any))
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'phone', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  -- 3. Email: el principal y despues el secundario recibido; cada uno contra las dos columnas.
  IF v_email IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email OR public.normalize_email(c.secondary_email) = v_email)
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'email', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_email2 IS NOT NULL AND v_email2 IS DISTINCT FROM v_email THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email2 OR public.normalize_email(c.secondary_email) = v_email2)
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'email', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  -- 4. Redes sociales, en este orden. Se compara en minusculas (los contactos viejos pueden no estarlo).
  IF v_ig IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.instagram_username) = v_ig
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'instagram', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_tt IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.tiktok_username) = v_tt
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'tiktok', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_x IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.twitter_username) = v_x
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'x', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_li IS NOT NULL THEN
    -- LinkedIn se compara por el slug de la URL, no por el texto entero.
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND public.linkedin_slug(c.linkedin_profile_url) = v_li
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'linkedin', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_fb IS NOT NULL THEN
    -- Facebook solo busca cuando el que llama lo pide (un canal de Facebook): sus ids no son
    -- confiables para formularios, que nunca lo mandan como parte de la identidad.
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.facebook_id) = v_fb
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'facebook', 'contact_id', v_id)); END IF;
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

-- ---------------------------------------------------------------------------
-- 3. ¿Ese telefono ya es de otro contacto?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contact_value_taken(p_workspace_id uuid, p_exclude_contact uuid, p_kind text, p_value text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_value IS NULL THEN false
    WHEN p_kind = 'phone' THEN EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND c.id IS DISTINCT FROM p_exclude_contact
        AND (c.phone = ANY (public.phone_variants(p_value)) OR c.whatsapp_phone = ANY (public.phone_variants(p_value))))
    WHEN p_kind = 'email' THEN EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND c.id IS DISTINCT FROM p_exclude_contact
        AND (public.normalize_email(c.email) = p_value OR public.normalize_email(c.secondary_email) = p_value))
    ELSE false
  END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. La regla central: solo cambia la clave del bloqueo por telefono.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_or_create_contact(p_workspace_id uuid, p_identity jsonb, p_defaults jsonb DEFAULT '{}'::jsonb, p_mode text DEFAULT 'create'::text, p_allow_without_identity boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ident     jsonb;
  v_defaults  jsonb := CASE WHEN jsonb_typeof(p_defaults) = 'object' THEN p_defaults ELSE '{}'::jsonb END;
  v_key       text;
  v_found     jsonb;
  v_row       jsonb;
  v_cols      text;
  v_id        uuid;
  v_has_ident boolean;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'find_or_create_contact: falta el workspace' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('create', 'link_channel', 'find_only') THEN
    RAISE EXCEPTION 'find_or_create_contact: modalidad invalida (%)', p_mode USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_ident := private.contact_normalize_identity(p_identity);

  IF p_mode = 'link_channel' AND v_ident ->> 'channel_id' IS NULL THEN
    RAISE EXCEPTION 'find_or_create_contact: link_channel necesita el canal y el id del remitente' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_has_ident := v_ident ? 'channel_id' OR v_ident ? 'phone' OR v_ident ? 'whatsapp_phone' OR v_ident ? 'email'
                 OR v_ident ? 'secondary_email' OR v_ident ? 'instagram' OR v_ident ? 'tiktok' OR v_ident ? 'x'
                 OR v_ident ? 'linkedin' OR v_ident ? 'facebook';

  IF NOT v_has_ident AND NOT (p_allow_without_identity AND p_mode <> 'find_only') THEN
    RETURN jsonb_build_object('contact_id', NULL, 'created', false, 'matched_by', NULL,
                              'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb, 'status', 'no_identity');
  END IF;

  -- Un bloqueo por cada dato, SIEMPRE ordenados por la clave.
  FOR v_key IN
    SELECT k FROM unnest(ARRAY[
      'channel:' || (v_ident ->> 'channel_id') || ':' || (v_ident ->> 'sender_id'),
      'phone:' || public.phone_canonical(v_ident ->> 'phone'),
      'phone:' || public.phone_canonical(v_ident ->> 'whatsapp_phone'),
      'email:' || (v_ident ->> 'email'),
      'email:' || (v_ident ->> 'secondary_email'),
      'instagram:' || (v_ident ->> 'instagram'),
      'tiktok:' || (v_ident ->> 'tiktok'),
      'x:' || (v_ident ->> 'x'),
      'linkedin:' || (v_ident ->> 'linkedin'),
      'facebook:' || (v_ident ->> 'facebook')
    ]) AS k WHERE k IS NOT NULL GROUP BY k ORDER BY k COLLATE "C"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('contact-identity:' || p_workspace_id::text || ':' || v_key, 0));
  END LOOP;

  IF v_has_ident THEN
    v_found := private.contact_identity_lookup(p_workspace_id, v_ident);
    IF v_found ->> 'contact_id' IS NOT NULL THEN
      RETURN jsonb_build_object(
        'contact_id', v_found ->> 'contact_id', 'created', false, 'matched_by', v_found ->> 'matched_by',
        'conflict_contact_id', v_found ->> 'conflict_contact_id', 'conflicts', v_found -> 'conflicts', 'status', 'found');
    END IF;
  END IF;

  IF p_mode = 'find_only' THEN
    RETURN jsonb_build_object('contact_id', NULL, 'created', false, 'matched_by', NULL,
                              'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb, 'status', 'not_found');
  END IF;

  -- Crear. Las columnas de identidad salen SOLO de la identidad normalizada; los defaults no pisan nada
  -- de lo estructural.
  v_row := (v_defaults - ARRAY['id', 'workspace_id', 'deleted_at', 'created_at', 'updated_at',
                               'phone', 'whatsapp_phone', 'email', 'secondary_email',
                               'instagram_username', 'tiktok_username', 'twitter_username', 'linkedin_profile_url'])
           || jsonb_strip_nulls(jsonb_build_object(
                'workspace_id',         p_workspace_id,
                'phone',                v_ident -> 'phone',
                'whatsapp_phone',       v_ident -> 'whatsapp_phone',
                'email',                v_ident -> 'email',
                'secondary_email',      v_ident -> 'secondary_email',
                'instagram_username',   v_ident -> 'instagram',
                'tiktok_username',      v_ident -> 'tiktok',
                'twitter_username',     v_ident -> 'x',
                'linkedin_profile_url', v_ident -> 'linkedin',
                'facebook_id',          v_ident -> 'facebook'));

  -- Solo las claves que son columnas reales de `contacts` (y no generadas).
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.contacts'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attgenerated = '' AND v_row ? a.attname::text;

  BEGIN
    EXECUTE format(
      'INSERT INTO public.contacts (%s) SELECT %s FROM jsonb_populate_record(NULL::public.contacts, $1) RETURNING id',
      v_cols, v_cols
    ) INTO v_id USING v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Otro camino gano la carrera por un dato (no pasa si todos usan esta funcion, pero la base manda):
    -- se vuelve a buscar y se devuelve a quien ya estaba.
    IF v_has_ident THEN
      v_found := private.contact_identity_lookup(p_workspace_id, v_ident);
      IF v_found ->> 'contact_id' IS NOT NULL THEN
        RETURN jsonb_build_object(
          'contact_id', v_found ->> 'contact_id', 'created', false, 'matched_by', v_found ->> 'matched_by',
          'conflict_contact_id', v_found ->> 'conflict_contact_id', 'conflicts', v_found -> 'conflicts', 'status', 'found');
      END IF;
    END IF;
    RAISE;
  END;

  IF p_mode = 'link_channel' THEN
    INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
    VALUES (v_id, (v_ident ->> 'channel_id')::uuid, v_ident ->> 'sender_id',
            COALESCE(v_ident ->> 'instagram', v_ident ->> 'tiktok', v_ident ->> 'x', v_ident ->> 'facebook'))
    ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('contact_id', v_id, 'created', true, 'matched_by', NULL,
                            'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb, 'status', 'created');
END;
$function$;

-- Los permisos no cambian con CREATE OR REPLACE; se repiten para que la migracion se lea sola.
REVOKE ALL ON FUNCTION private.contact_identity_lookup(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.contact_value_taken(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_contact(uuid, jsonb, jsonb, text, boolean) TO service_role;
