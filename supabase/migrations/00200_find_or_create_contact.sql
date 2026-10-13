-- ============================================================================
-- 00200 — La regla unica "buscar o crear contacto" (Contactos: regla unica, C1)
-- ============================================================================
-- Hoy cada camino que crea un contacto tiene su propia busqueda, con normalizaciones distintas, y
-- `contacts` no tiene ningun indice unico: dos llegadas simultaneas de la misma persona crean dos
-- contactos (ya paso: el par de `fede.com.ia`, creados con 8 ms de diferencia). Esta migracion crea la
-- pieza central; las siguientes (00201 a 00204) la usan, y la 00205 agrega los indices unicos.
--
-- Que crea (todo ADITIVO, no toca ninguna funcion existente):
--   * public.normalize_phone(text)                     gemela exacta de `normalizePhone` (lib/phone.ts)
--   * private.contact_normalize_identity(jsonb)        normaliza un dato fuerte de cada tipo
--   * private.contact_identity_lookup(uuid, jsonb)     la BUSQUEDA pura (STABLE), la usan los envoltorios
--   * private.contact_value_taken(uuid, uuid, text, text)  "¿ese tel/email ya es de OTRO contacto?"
--   * public.find_or_create_contact(...)               buscar o crear, con bloqueo por dato fuerte
--
-- Datos fuertes (identifican a una persona): canal (+ id del remitente), telefono, WhatsApp, email,
-- email secundario, y los usuarios de Instagram, TikTok, X, LinkedIn y Facebook. NUNCA el nombre.
--
-- Orden de busqueda: canal -> telefono (primero `phone`, despues `whatsapp_phone`; cada uno contra las dos
-- columnas) -> email (primero `email`, despues `secondary_email`; cada uno contra las dos columnas) ->
-- Instagram -> TikTok -> X -> LinkedIn (por el slug) -> Facebook. Gana el primero que encuentra un
-- contacto (el mas antiguo, solo `deleted_at IS NULL`); los demas datos que apuntan a OTRO contacto son
-- conflictos: `conflict_contact_id` (el primero) y `conflicts` [{ by, contact_id }], igual que
-- `find_contact_for_form`.
--
-- Bloqueo: `pg_advisory_xact_lock` por cada dato (clave `contact-identity:<ws>:<tipo>:<valor>`), SIEMPRE
-- en el orden de la clave (COLLATE "C"). El telefono y el WhatsApp comparten tipo `phone`; el email y el
-- secundario, `email`. Dos llamadas simultaneas con el mismo dato comparten al menos un bloqueo: la
-- segunda espera y ya ve el contacto de la primera. El orden fijo evita el interbloqueo. Los bloqueos
-- duran solo la transaccion. Se toman tambien en `find_only`.
--
-- Cualquiera de las tres modalidades:
--   'create'        busca; si no esta, inserta.
--   'link_channel'  igual, y al CREAR deja la fila de `contact_channels` (ON CONFLICT DO NOTHING).
--   'find_only'     solo busca (con los mismos bloqueos).
-- Sin ningun dato fuerte devuelve status 'no_identity' y no crea nada, salvo `p_allow_without_identity`
-- (el alta manual: una persona puede cargar un contacto solo con el nombre).
--
-- Que inserta: las columnas de `p_defaults` (via jsonb_populate_record), SIN dejar pisar `id`,
-- `workspace_id`, `deleted_at`, `created_at`, `updated_at`; y las columnas de identidad (telefono, email,
-- usuarios de red) salen siempre de `p_identity` normalizado, nunca de los defaults. `facebook_id` puede
-- venir de los defaults cuando no es parte de la identidad. Un `unique_violation` al insertar (cuando
-- exista el indice de la 00205) se resuelve volviendo a buscar: nunca se pierde un contacto.
--
-- Devuelve { contact_id, created, matched_by, conflict_contact_id, conflicts, status }, status en
-- 'found' | 'created' | 'not_found' | 'no_identity'.
--
-- EXECUTE solo para service_role. SECURITY DEFINER, search_path vacio. Las funciones de `private` no se
-- exponen a la API.
--
-- Como volver atras (todo es nuevo, no hay definicion vieja que restaurar):
--   DROP FUNCTION public.find_or_create_contact(uuid, jsonb, jsonb, text, boolean);
--   DROP FUNCTION private.contact_value_taken(uuid, uuid, text, text);
--   DROP FUNCTION private.contact_identity_lookup(uuid, jsonb);
--   DROP FUNCTION private.contact_normalize_identity(jsonb);
--   DROP FUNCTION public.normalize_phone(text);
-- (solo si 00201 a 00204 ya se revirtieron: usan estas funciones).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. normalize_phone: gemela de `normalizePhone` (lib/phone.ts).
--    Deja "+<digitos>" o NULL. Saca todo menos digitos y un "+" inicial; "00" al principio equivale a "+";
--    menos de 8 o mas de 15 digitos no es un numero internacional.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $$
  SELECT CASE WHEN e.d ~ '^[0-9]{8,15}$' THEN '+' || e.d END
  FROM (
    SELECT CASE
             WHEN b.s LIKE '+%'  THEN substr(b.s, 2)
             WHEN b.s LIKE '00%' THEN substr(b.s, 3)
             ELSE b.s
           END AS d
    FROM (
      SELECT CASE
               WHEN a.c LIKE '+%' THEN '+' || replace(substr(a.c, 2), '+', '')
               ELSE replace(a.c, '+', '')
             END AS s
      FROM (SELECT regexp_replace(COALESCE(p_raw, ''), '[^0-9+]', '', 'g') AS c) a
    ) b
  ) e;
$$;

REVOKE ALL ON FUNCTION public.normalize_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Normalizar la identidad. Entrada: jsonb con las claves channel_id, sender_id, phone, whatsapp_phone,
--    email, secondary_email, instagram, tiktok, x, linkedin, facebook (todas opcionales). Salida: solo las
--    que quedan con valor, normalizadas. Gemela de `normalizeIdentity` (lib/contacts/identity.ts); los
--    mismos casos (lib/contacts/identity.cases.json) corren contra las dos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contact_normalize_identity(p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $$
DECLARE
  v_in      jsonb := CASE WHEN jsonb_typeof(p_identity) = 'object' THEN p_identity ELSE '{}'::jsonb END;
  v_ch      text  := NULLIF(btrim(v_in ->> 'channel_id'), '');
  v_sender  text  := NULLIF(btrim(v_in ->> 'sender_id'), '');
  v_li_raw  text  := v_in ->> 'linkedin';
  v_li_slug text;
BEGIN
  -- LinkedIn: el slug de la URL; si no es una URL, el texto solo si parece un slug.
  v_li_slug := public.linkedin_slug(v_li_raw);
  IF v_li_slug IS NULL AND lower(btrim(COALESCE(v_li_raw, ''))) ~ '^[a-z0-9_.%-]+$' THEN
    v_li_slug := lower(btrim(v_li_raw));
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    -- El canal vale solo con las dos puntas: el canal y el id del remitente.
    'channel_id',      CASE WHEN v_ch IS NOT NULL AND v_sender IS NOT NULL THEN v_ch END,
    'sender_id',       CASE WHEN v_ch IS NOT NULL AND v_sender IS NOT NULL THEN v_sender END,
    'phone',           public.normalize_phone(v_in ->> 'phone'),
    'whatsapp_phone',  public.normalize_phone(v_in ->> 'whatsapp_phone'),
    'email',           public.normalize_email(v_in ->> 'email'),
    'secondary_email', public.normalize_email(v_in ->> 'secondary_email'),
    'instagram',       public.normalize_handle(v_in ->> 'instagram'),
    'tiktok',          public.normalize_handle(v_in ->> 'tiktok'),
    'x',               public.normalize_handle(v_in ->> 'x'),
    'linkedin',        CASE WHEN v_li_slug IS NOT NULL THEN 'https://www.linkedin.com/in/' || v_li_slug END,
    'facebook',        public.normalize_handle(v_in ->> 'facebook')
  ));
END;
$$;

REVOKE ALL ON FUNCTION private.contact_normalize_identity(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. La busqueda pura. Recibe la identidad YA normalizada. Nunca escribe, nunca bloquea.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contact_identity_lookup(p_workspace_id uuid, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $$
DECLARE
  v_id        uuid;
  v_hits      jsonb := '[]'::jsonb;
  v_winner    uuid;
  v_by        text;
  v_conflicts jsonb;
  v_phone     text := p_identity ->> 'phone';
  v_wa        text := p_identity ->> 'whatsapp_phone';
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

  -- 2. Telefono: el recibido como `phone` y despues el de WhatsApp; cada uno contra las dos columnas.
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'phone', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_wa IS NOT NULL AND v_wa IS DISTINCT FROM v_phone THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = v_wa OR c.whatsapp_phone = v_wa)
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
$$;

REVOKE ALL ON FUNCTION private.contact_identity_lookup(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ¿Ese telefono / email ya es de OTRO contacto? Para los UPDATE que completan vacios: un dato fuerte
--    que es de otro contacto no se escribe (dejaria dos contactos con el mismo dato). El valor ya viene
--    normalizado. kind: 'phone' (columnas `phone` y `whatsapp_phone`) | 'email' (`email` y `secondary_email`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contact_value_taken(p_workspace_id uuid, p_exclude_contact uuid, p_kind text, p_value text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN false
    WHEN p_kind = 'phone' THEN EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND c.id IS DISTINCT FROM p_exclude_contact
        AND (c.phone = p_value OR c.whatsapp_phone = p_value))
    WHEN p_kind = 'email' THEN EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND c.id IS DISTINCT FROM p_exclude_contact
        AND (public.normalize_email(c.email) = p_value OR public.normalize_email(c.secondary_email) = p_value))
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION private.contact_value_taken(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. La regla central.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_or_create_contact(
  p_workspace_id uuid,
  p_identity jsonb,
  p_defaults jsonb DEFAULT '{}'::jsonb,
  p_mode text DEFAULT 'create',
  p_allow_without_identity boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
      'phone:' || (v_ident ->> 'phone'),
      'phone:' || (v_ident ->> 'whatsapp_phone'),
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
$$;

REVOKE ALL ON FUNCTION public.find_or_create_contact(uuid, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_or_create_contact(uuid, jsonb, jsonb, text, boolean) TO service_role;
