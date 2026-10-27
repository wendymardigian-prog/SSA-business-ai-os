-- ============================================================================
-- Extensiones y utilidades
--
-- Las extensiones de Postgres que usa el sistema, el esquema privado (private) para
-- las funciones internas que la app no puede llamar, y funciones chicas sin tablas:
-- normalizar telefonos, emails y textos, comparar frases, y el disparador que mantiene
-- updated_at.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensiones
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- Esquemas
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.attachment_preview_label(p_kind text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_kind
    WHEN 'image' THEN '📷 Imagen'
    WHEN 'video' THEN '🎬 Video'
    WHEN 'audio' THEN '🎵 Audio'
    WHEN 'voice' THEN '🎤 Nota de voz'
    WHEN 'sticker' THEN 'Sticker'
    WHEN 'gif' THEN 'GIF'
    WHEN 'document' THEN '📄 Documento'
    WHEN 'location' THEN '📍 Ubicación'
    WHEN 'contact' THEN '👤 Contacto'
    WHEN 'poll' THEN '📊 Encuesta'
    WHEN 'share' THEN '🔗 Publicación compartida'
    WHEN 'link' THEN '🔗 Link'
    WHEN 'story_reply' THEN 'Respuesta a una historia'
    ELSE 'Adjunto'
  END;
$function$;
REVOKE ALL ON FUNCTION private.attachment_preview_label(p_kind text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.attachment_preview_label(p_kind text) TO service_role;

CREATE OR REPLACE FUNCTION private.channel_scope_rank(p_scope text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_scope WHEN 'all' THEN 3 WHEN 'own_unassigned' THEN 2 WHEN 'own' THEN 1 ELSE 0 END
$function$;
REVOKE ALL ON FUNCTION private.channel_scope_rank(p_scope text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.channel_scope_rank(p_scope text) TO service_role;

CREATE OR REPLACE FUNCTION private.custom_value_date(p_raw text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text := btrim(coalesce(p_raw, ''));
  m text[];
BEGIN
  m := regexp_match(v, '^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})($|[T ])');
  IF m IS NOT NULL THEN
    RETURN make_date(m[1]::int, m[2]::int, m[3]::int);
  END IF;
  m := regexp_match(v, '^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{4})$');
  IF m IS NOT NULL THEN
    RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- make_date con un dia que no existe (31/02) lanza: queda NULL.
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.custom_value_date(p_raw text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.custom_value_number(p_raw text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v text := regexp_replace(coalesce(p_raw, ''), '\s', '', 'g');
  v_comma int;
  v_dot int;
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;
  v_comma := length(v) - position(',' IN reverse(v)) + 1;
  v_dot   := length(v) - position('.' IN reverse(v)) + 1;
  IF position(',' IN v) > 0 AND position('.' IN v) > 0 THEN
    IF v_comma > v_dot THEN
      v := replace(replace(v, '.', ''), ',', '.');
    ELSE
      v := replace(v, ',', '');
    END IF;
  ELSIF position(',' IN v) > 0 THEN
    v := replace(v, ',', '.');
  END IF;
  IF v !~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)$' THEN
    RETURN NULL;
  END IF;
  RETURN v::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.custom_value_number(p_raw text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.message_preview_text(p_text text, p_transcript text, p_attachments jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_first jsonb;
BEGIN
  IF COALESCE(p_text, '') <> '' THEN
    RETURN left(p_text, 100);
  END IF;
  IF COALESCE(p_transcript, '') <> '' THEN
    RETURN left(p_transcript, 100);
  END IF;
  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) = 'null' THEN
    RETURN '';
  END IF;

  -- Forma nueva: { v: 2, items: [...] }.
  IF jsonb_typeof(p_attachments) = 'object' AND p_attachments->>'v' = '2' THEN
    v_first := p_attachments->'items'->0;
    IF v_first IS NULL THEN
      RETURN '';
    END IF;
    RETURN private.attachment_preview_label(v_first->>'kind');
  END IF;

  -- Zernio y lo que registra un flow: [{ type, url }].
  IF jsonb_typeof(p_attachments) = 'array' THEN
    v_first := p_attachments->0;
    IF v_first IS NULL THEN
      RETURN '';
    END IF;
    RETURN private.attachment_preview_label(v_first->>'type');
  END IF;

  RETURN 'Adjunto';
END;
$function$;
REVOKE ALL ON FUNCTION private.message_preview_text(p_text text, p_transcript text, p_attachments jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.message_preview_text(p_text text, p_transcript text, p_attachments jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.meta_url_decode(p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_plus text;
  v_out text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;
  v_plus := replace(p_raw, '+', ' ');
  IF position('%' IN v_plus) = 0 THEN
    RETURN v_plus;
  END IF;
  BEGIN
    SELECT convert_from(
      string_agg(
        CASE WHEN m[1] IS NOT NULL THEN decode(substr(m[1], 2), 'hex') ELSE convert_to(m[2], 'UTF8') END,
        ''::bytea ORDER BY ord
      ),
      'UTF8'
    )
    INTO v_out
    FROM regexp_matches(v_plus, '(%[0-9A-Fa-f]{2})|([^%]+|%)', 'g') WITH ORDINALITY AS t(m, ord);
    RETURN coalesce(v_out, v_plus);
  EXCEPTION WHEN OTHERS THEN
    -- Un %XX que no es UTF-8 valido: se deja el texto como llego (igual que decodeURIComponent al fallar).
    RETURN v_plus;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION private.meta_url_decode(p_raw text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.scope_rank(p_scope text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_scope WHEN 'all' THEN 2 WHEN 'own_unassigned' THEN 1 ELSE 0 END
$function$;
REVOKE ALL ON FUNCTION private.scope_rank(p_scope text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.is_placeholder_name(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT lower(btrim(coalesce(p_name, ''))) IN (
    '', 'instagram user', 'facebook user', 'whatsapp user', 'unknown commenter'
  );
$function$;
COMMENT ON FUNCTION public.is_placeholder_name(p_name text) IS 'true si el nombre es un relleno que manda la plataforma cuando no tiene el perfil ("Instagram User" y companiia), y no algo que escribio una persona. Espejo de PLACEHOLDER_NAMES en lib/contacts/anonymous.ts.';
REVOKE ALL ON FUNCTION public.is_placeholder_name(p_name text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.linkedin_slug(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT nullif(substring(lower(p_url) from '/in/([^/?#[:space:]]+)'), '');
$function$;

CREATE OR REPLACE FUNCTION public.meta_name_key(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT btrim(
    regexp_replace(
      translate(
        lower(coalesce(p_raw, '')),
        'áàäâãåéèëêíìïîóòöôõúùüûñç',
        'aaaaaaeeeeiiiiooooouuuunc'
      ),
      '\s+', ' ', 'g'
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.meta_name_key(p_raw text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.normalize_email(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT NULLIF(lower(btrim(p_raw)), '');
$function$;
REVOKE ALL ON FUNCTION public.normalize_email(p_raw text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.normalize_for_grouping(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT left(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(lower(coalesce(p_raw, '')),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
            '[^a-z0-9 ]', '', 'g'),
          '(.)\1+', '\1', 'g'),
        '\s+', ' ', 'g')
    ),
    300
  );
$function$;
COMMENT ON FUNCTION public.normalize_for_grouping(p_raw text) IS 'Normaliza para AGRUPAR mensajes por lo que significan (colapsa letras repetidas: siii=si). Distinta de normalize_message_text, que detecta frases de no contactar. Espejo exacto de lib/text/normalize.ts.';
REVOKE ALL ON FUNCTION public.normalize_for_grouping(p_raw text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.normalize_handle(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT NULLIF(lower(btrim(ltrim(btrim(p_raw), '@'))), '');
$function$;
REVOKE ALL ON FUNCTION public.normalize_handle(p_raw text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.normalize_message_text(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  -- Minusculas, sin acentos y con cualquier cosa que no sea letra o numero
  -- convertida en un espacio. "NO ME ESCRIBAS MAS!!!" y "no me escribas mas"
  -- terminan siendo el mismo texto.
  SELECT btrim(regexp_replace(
    translate(lower(btrim(coalesce(p_raw, ''))),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$function$;
REVOKE ALL ON FUNCTION public.normalize_message_text(p_raw text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.normalize_phone(p_raw text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.normalize_phone(p_raw text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.text_matches_phrase(p_text text, p_phrase text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_text   text := public.normalize_message_text(p_text);
  v_phrase text := public.normalize_message_text(p_phrase);
BEGIN
  IF v_text = '' OR v_phrase = '' THEN
    RETURN false;
  END IF;

  RETURN (' ' || v_text || ' ') LIKE ('% ' || v_phrase || ' %');
END;
$function$;
COMMENT ON FUNCTION public.text_matches_phrase(p_text text, p_phrase text) IS 'true si el mensaje contiene la frase como palabras completas, ignorando mayusculas, acentos y puntuacion. Nunca por substring: "baja" no matchea en "trabaja".';
REVOKE ALL ON FUNCTION public.text_matches_phrase(p_text text, p_phrase text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated;
