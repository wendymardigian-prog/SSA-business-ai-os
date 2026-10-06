-- 00114: la tabla de toques de atribucion (Contenido v3, B11: F82, F83).
--
-- Un "toque" es una interaccion atribuible de un contacto: su primer DM, un
-- comentario en una publicacion, una reserva, un alta manual. Se guardan TODOS,
-- no solo dos fotos, porque guardar solo "primero" y "ultimo" pierde el camino
-- entero. `contacts.attribution` conserva `first_touch` y `last_touch` como una
-- copia derivada, para que la ficha y los filtros no hagan JOIN.
--
-- Aditiva e idempotente: no toca ningun dato existente.
--
-- La escribe SOLO el servidor (`record_contact_touch`, service_role). Los
-- usuarios leen: un Member ve los toques de los contactos que ya puede ver,
-- porque la subconsulta a `contacts` hereda su scope de leads (misma tecnica
-- que `contact_notes`).

CREATE TABLE IF NOT EXISTS public.contact_touches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id      uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL,

  -- La taxonomia (lib/contacts/taxonomy.ts). `content_label` es el "content"
  -- de la taxonomia: el nombre se evita aca porque ya hay columnas llamadas asi.
  source          text        NOT NULL,
  medium          text,
  campaign        text,
  content_label   text,
  term            text,
  -- Un medio que no esta en la lista cerrada se guarda crudo y se marca.
  medium_raw      boolean     NOT NULL DEFAULT false,

  -- La pieza concreta, cuando se conoce.
  social_post_id  uuid        REFERENCES public.social_posts(id) ON DELETE SET NULL,
  content_post_id uuid        REFERENCES public.content_posts(id) ON DELETE SET NULL,

  -- Identificadores de anuncio.
  ad_id           text,
  adset_id        text,
  campaign_id     text,
  fbclid          text,
  gclid           text,
  ttclid          text,
  li_fat_id       text,
  ctwa_clid       text,

  -- Para cuando haya paginas y formularios propios.
  referrer_url    text,
  landing_page    text,

  -- Por que camino tecnico entro.
  origin          text        NOT NULL,
  -- El id del mensaje, del comentario, del evento o de la reserva: es lo que
  -- hace que el mismo toque llegando dos veces quede una sola vez.
  dedupe_key      text        NOT NULL,
  -- La carga original recortada a una lista blanca (nunca tokens ni secretos).
  raw             jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_touches_origin_check
    CHECK (origin IN ('dm', 'comment', 'booking', 'form', 'manual', 'import')),
  CONSTRAINT contact_touches_source_not_empty CHECK (btrim(source) <> ''),
  CONSTRAINT uq_contact_touches_dedupe UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_contact_touches_contact
  ON public.contact_touches (workspace_id, contact_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_contact_touches_source_medium
  ON public.contact_touches (workspace_id, source, medium, occurred_at);
CREATE INDEX IF NOT EXISTS idx_contact_touches_social_post
  ON public.contact_touches (social_post_id) WHERE social_post_id IS NOT NULL;

-- Los filtros de la lista de contactos (por fuente y medio del PRIMER toque) y
-- los conteos por pieza de B13 y B14 leen la copia derivada en `contacts`.
CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_source
  ON public.contacts (workspace_id, (attribution -> 'first_touch' ->> 'source'))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_medium
  ON public.contacts (workspace_id, (attribution -> 'first_touch' ->> 'medium'))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_content_post
  ON public.contacts (workspace_id, (attribution -> 'first_touch' ->> 'content_post_id'))
  WHERE deleted_at IS NULL AND (attribution -> 'first_touch') ? 'content_post_id';

DROP TRIGGER IF EXISTS set_updated_at ON public.contact_touches;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_touches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS: lee quien ve al contacto; nadie escribe desde el cliente.
ALTER TABLE public.contact_touches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_touches_select" ON public.contact_touches;
CREATE POLICY "contact_touches_select" ON public.contact_touches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = contact_touches.contact_id
        AND c.workspace_id = contact_touches.workspace_id
    )
  );

REVOKE ALL ON public.contact_touches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.contact_touches FROM authenticated;

-- El toque tal como se guarda en `contacts.attribution`. Un solo lugar para el
-- formato, porque lo usan la funcion de abajo y el backfill de la 00115.
CREATE OR REPLACE FUNCTION public.contact_touch_json(t public.contact_touches)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'occurred_at',     t.occurred_at,
    'source',          t.source,
    'medium',          t.medium,
    'campaign',        t.campaign,
    'content',         t.content_label,
    'term',            t.term,
    'medium_raw',      CASE WHEN t.medium_raw THEN true END,
    'social_post_id',  t.social_post_id,
    'content_post_id', t.content_post_id,
    'ad_id',           t.ad_id,
    'adset_id',        t.adset_id,
    'campaign_id',     t.campaign_id,
    'fbclid',          t.fbclid,
    'gclid',           t.gclid,
    'ttclid',          t.ttclid,
    'li_fat_id',       t.li_fat_id,
    'ctwa_clid',       t.ctwa_clid,
    'referrer_url',    t.referrer_url,
    'landing_page',    t.landing_page,
    'origin',          t.origin
  ))
$$;

REVOKE ALL ON FUNCTION public.contact_touch_json(public.contact_touches) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_touch_json(public.contact_touches) TO service_role;

-- Registra un toque y deja `first_touch` y `last_touch` bien puestos.
--
-- Idempotente por (workspace, dedupe_key): el mismo toque dos veces queda una
-- sola vez y la segunda no toca nada. `first_touch` y `last_touch` se RECALCULAN
-- desde la tabla en vez de compararse con la copia: asi un toque viejo que llega
-- tarde (una relectura) queda en su lugar y el primero sigue siendo el primero.
--
-- `contacts.attribution` se mezcla con `||`: lo que ya habia (la forma vieja de
-- clicks, o la plana del agendamiento) NO se borra.
CREATE OR REPLACE FUNCTION public.record_contact_touch(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_touch        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    referrer_url, landing_page, origin, dedupe_key, raw
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
$$;

REVOKE ALL ON FUNCTION public.record_contact_touch(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_contact_touch(uuid, uuid, jsonb) TO service_role;

COMMENT ON TABLE public.contact_touches IS
  'Cada interaccion atribuible de un contacto (F82). Solo la escribe el servidor.';
