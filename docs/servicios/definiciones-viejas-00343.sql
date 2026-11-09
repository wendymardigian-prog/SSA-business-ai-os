-- Definiciones VIEJAS de las funciones que reescribe la 00343_affiliates (leidas de la base el 8/11/2026).
-- Para volver atras: correr este archivo entero (son CREATE OR REPLACE).

-- ---- commission_facts (07e5a857...) ----
CREATE OR REPLACE FUNCTION public.commission_facts(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'payment', jsonb_build_object(
      'id', p.id,
      'type', p.type,
      'amount', p.amount,
      'paid_on', p.paid_on,
      'method', p.payment_method,
      'fee_amount', p.provider_fee_amount,
      'number', COALESCE((
        SELECT ranked.n FROM (
          SELECT x.id, row_number() OVER (ORDER BY COALESCE(x.original_due_date, x.due_date) NULLS LAST, x.created_at, x.id) AS n
            FROM public.payments x
           WHERE x.sale_id = p.sale_id AND x.type <> 'refund' AND x.status <> 'cancelled'
        ) ranked WHERE ranked.id = p.id
      ), 1)
    ),
    'sale', jsonb_build_object(
      'id', s.id,
      'status', s.status,
      'financing_type', s.financing_type,
      'final_amount', s.final_amount,
      'product_id', COALESCE(pv.product_id::text, NULLIF(s.product_snapshot ->> 'product_id', '')),
      'variant_id', s.product_variant_id,
      'setter_id', s.setter_id,
      'vendedor_id', s.vendedor_id,
      'contact_id', s.contact_id
    ),
    'touch', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', t.id,
      'channel', t.channel,
      'source', t.source,
      'medium', NULLIF(btrim(private.meta_url_decode(t.medium)), ''),
      'campaign', NULLIF(btrim(private.meta_url_decode(t.campaign)), ''),
      'content', NULLIF(btrim(private.meta_url_decode(t.content_label)), ''),
      'term', NULLIF(btrim(private.meta_url_decode(t.term)), ''),
      'content_post_id', t.content_post_id,
      'social_post_id', t.social_post_id,
      'meta_ad_id', t.meta_ad_id,
      'meta_adset_id', t.meta_adset_id,
      'meta_campaign_id', t.meta_campaign_id
    ) END,
    'content_assignee_id', CASE
      WHEN t.id IS NOT NULL AND (t.content_post_id IS NOT NULL OR t.social_post_id IS NOT NULL)
        THEN public.commission_content_owner(t.social_post_id, t.content_post_id, s.workspace_id)
      ELSE NULL END
  )
  FROM public.payments p
  JOIN public.sales s ON s.id = p.sale_id
  LEFT JOIN public.product_variants pv ON pv.id = s.product_variant_id
  LEFT JOIN public.contact_touches t ON t.id = s.attribution_touch_id
  WHERE p.id = p_payment_id;
$function$

-- ---- private.commission_failed_dimension (f946371b...) ----
CREATE OR REPLACE FUNCTION private.commission_failed_dimension(p_rule commission_rules, p_facts jsonb, p_payee text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  c jsonb := CASE WHEN jsonb_typeof(p_rule.conditions) = 'object' THEN p_rule.conditions ELSE '{}'::jsonb END;
  f_sale jsonb := COALESCE(p_facts -> 'sale', '{}'::jsonb);
  f_pay jsonb := COALESCE(p_facts -> 'payment', '{}'::jsonb);
  touch jsonb := CASE WHEN jsonb_typeof(p_facts -> 'touch') = 'object' THEN p_facts -> 'touch' ELSE NULL END;
  v_vals text[];
  v_actual text;
  v_dim text;
  v_cond jsonb;
  v_num int;
  v_from numeric;
  v_to numeric;
  v_cents bigint;
  v_paid_on date;
BEGIN
  v_vals := private.cm_list(c -> 'user_ids');
  IF cardinality(v_vals) > 0 AND p_payee <> 'fixed' AND NOT private.cm_in_list(v_vals, private.cm_sale_person(p_payee, p_facts)) THEN RETURN 'user_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'vendedor_ids'), f_sale ->> 'vendedor_id') THEN RETURN 'vendedor_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'setter_ids'), f_sale ->> 'setter_id') THEN RETURN 'setter_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'product_ids'), f_sale ->> 'product_id') THEN RETURN 'product_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'variant_ids'), f_sale ->> 'variant_id') THEN RETURN 'variant_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'financing_types'), f_sale ->> 'financing_type') THEN RETURN 'financing_types'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'payment_methods'), f_pay ->> 'method') THEN RETURN 'payment_methods'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'payment_types'), f_pay ->> 'type') THEN RETURN 'payment_types'; END IF;
  -- Sin toque (o un toque sin canal) el canal es `direct`.
  IF NOT private.cm_in_list(private.cm_list(c -> 'channels'), COALESCE(NULLIF(touch ->> 'channel', ''), 'direct')) THEN RETURN 'channels'; END IF;

  v_vals := ARRAY(SELECT private.cm_norm(x) FROM unnest(private.cm_list(c -> 'platforms')) x WHERE private.cm_norm(x) <> '');
  IF cardinality(v_vals) > 0 AND NOT (private.cm_norm(touch ->> 'source') = ANY (v_vals)) THEN RETURN 'platforms'; END IF;

  IF NOT private.cm_in_list(private.cm_list(c -> 'content_post_ids'), touch ->> 'content_post_id') THEN RETURN 'content_post_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'meta_campaign_ids'), touch ->> 'meta_campaign_id') THEN RETURN 'meta_campaign_ids'; END IF;
  IF NOT private.cm_in_list(private.cm_list(c -> 'meta_ad_ids'), touch ->> 'meta_ad_id') THEN RETURN 'meta_ad_ids'; END IF;

  FOREACH v_dim IN ARRAY ARRAY['source', 'medium', 'campaign', 'content', 'term'] LOOP
    v_cond := c -> 'utm' -> v_dim;
    v_vals := ARRAY(SELECT private.cm_norm(x) FROM unnest(private.cm_list(v_cond -> 'values')) x WHERE private.cm_norm(x) <> '');
    CONTINUE WHEN cardinality(v_vals) = 0; -- dimension vacia = cualquiera
    v_actual := CASE WHEN touch IS NULL THEN '' ELSE private.cm_norm(touch ->> v_dim) END;
    IF v_actual = '' THEN RETURN 'utm.' || v_dim; END IF;
    IF (v_cond ->> 'op') = 'contains' THEN
      IF NOT EXISTS (SELECT 1 FROM unnest(v_vals) v WHERE position(v IN v_actual) > 0) THEN RETURN 'utm.' || v_dim; END IF;
    ELSE
      IF NOT (v_actual = ANY (v_vals)) THEN RETURN 'utm.' || v_dim; END IF;
    END IF;
  END LOOP;

  IF jsonb_typeof(c -> 'payment_number') = 'object' THEN
    v_num := COALESCE((f_pay ->> 'number')::int, 0);
    IF jsonb_typeof(c -> 'payment_number' -> 'from') = 'number' AND v_num < (c -> 'payment_number' ->> 'from')::numeric THEN RETURN 'payment_number'; END IF;
    IF jsonb_typeof(c -> 'payment_number' -> 'to') = 'number' AND v_num > (c -> 'payment_number' ->> 'to')::numeric THEN RETURN 'payment_number'; END IF;
  END IF;

  IF jsonb_typeof(c -> 'sale_amount') = 'object' THEN
    v_cents := round(COALESCE((f_sale ->> 'final_amount')::numeric, 0) * 100)::bigint;
    IF jsonb_typeof(c -> 'sale_amount' -> 'min') = 'number' THEN
      v_from := round((c -> 'sale_amount' ->> 'min')::numeric * 100);
      IF v_cents < v_from THEN RETURN 'sale_amount'; END IF;
    END IF;
    IF jsonb_typeof(c -> 'sale_amount' -> 'max') = 'number' THEN
      v_to := round((c -> 'sale_amount' ->> 'max')::numeric * 100);
      IF v_cents > v_to THEN RETURN 'sale_amount'; END IF;
    END IF;
  END IF;

  v_paid_on := NULLIF(f_pay ->> 'paid_on', '')::date;
  IF v_paid_on IS NOT NULL THEN
    IF p_rule.valid_from IS NOT NULL AND v_paid_on < p_rule.valid_from THEN RETURN 'validity'; END IF;
    IF p_rule.valid_until IS NOT NULL AND v_paid_on > p_rule.valid_until THEN RETURN 'validity'; END IF;
  END IF;

  RETURN NULL;
END;
$function$

-- ---- private.cm_sale_person (f687821a...) ----
CREATE OR REPLACE FUNCTION private.cm_sale_person(p_payee text, p_facts jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_payee
    WHEN 'sale_vendedor' THEN p_facts -> 'sale' ->> 'vendedor_id'
    WHEN 'sale_setter' THEN p_facts -> 'sale' ->> 'setter_id'
    WHEN 'content_assignee' THEN p_facts ->> 'content_assignee_id'
    ELSE NULL END;
$function$

-- ---- commission_payee (ffe87f41...) ----
CREATE OR REPLACE FUNCTION public.commission_payee(p_role jsonb, p_rule commission_rules, p_facts jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_payee text := p_role ->> 'payee';
  v_override uuid := p_rule.beneficiary_user_id;
  v_touch jsonb := CASE WHEN jsonb_typeof(p_facts -> 'touch') = 'object' THEN p_facts -> 'touch' ELSE NULL END;
  v_user text;
BEGIN
  IF v_payee IN ('sale_vendedor', 'sale_setter') THEN
    v_user := COALESCE(v_override::text, private.cm_sale_person(v_payee, p_facts));
    RETURN jsonb_build_object('applies', v_user IS NOT NULL, 'user_id', v_user);
  ELSIF v_payee = 'content_assignee' THEN
    IF v_touch IS NULL OR (NULLIF(v_touch ->> 'content_post_id', '') IS NULL AND NULLIF(v_touch ->> 'social_post_id', '') IS NULL) THEN
      RETURN jsonb_build_object('applies', false, 'user_id', NULL);
    END IF;
    RETURN jsonb_build_object('applies', true, 'user_id', COALESCE(v_override::text, NULLIF(p_facts ->> 'content_assignee_id', '')));
  ELSIF v_payee = 'fixed' THEN
    RETURN jsonb_build_object('applies', v_override IS NOT NULL, 'user_id', v_override);
  END IF;
  RETURN jsonb_build_object('applies', false, 'user_id', NULL);
END;
$function$

-- ---- generate_commissions_for_payment (3660acdd...) ----
CREATE OR REPLACE FUNCTION public.generate_commissions_for_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  p public.payments%ROWTYPE;
  v_facts jsonb;
  v_settings jsonb;
  v_role jsonb;
  v_rule public.commission_rules;
  v_rule_id uuid;
  v_payee jsonb;
  v_base bigint;
  v_amount bigint;
  v_user uuid;
  v_id uuid;
  v_touch jsonb;
  v_created int := 0;
  v_created_ids jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_title text;
  v_ad_name text;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'not_found');
  END IF;
  IF p.status <> 'paid' OR p.type = 'refund' THEN
    RETURN jsonb_build_object('skipped', 'not_paid');
  END IF;

  v_facts := public.commission_facts(p.id);
  v_touch := CASE WHEN jsonb_typeof(v_facts -> 'touch') = 'object' THEN v_facts -> 'touch' ELSE NULL END;
  SELECT w.commission_settings INTO v_settings FROM public.workspaces w WHERE w.id = p.workspace_id;

  IF v_touch IS NOT NULL THEN
    SELECT c.title INTO v_title FROM public.content_posts c WHERE c.id = NULLIF(v_touch ->> 'content_post_id', '')::uuid;
    SELECT a.name INTO v_ad_name FROM public.meta_ads a WHERE a.workspace_id = p.workspace_id AND a.ad_id = NULLIF(v_touch ->> 'meta_ad_id', '');
  END IF;

  FOR v_role IN SELECT * FROM jsonb_array_elements(COALESCE(v_settings -> 'roles', '[]'::jsonb)) LOOP
    CONTINUE WHEN COALESCE((v_role ->> 'active')::boolean, false) IS NOT TRUE;

    v_rule_id := public.commission_pick_rule(p.workspace_id, v_facts, v_role ->> 'key');
    IF v_rule_id IS NULL THEN
      v_skipped := v_skipped || jsonb_build_object('role', v_role ->> 'key', 'reason', 'no_rule');
      CONTINUE;
    END IF;
    SELECT * INTO v_rule FROM public.commission_rules WHERE id = v_rule_id;

    v_payee := public.commission_payee(v_role, v_rule, v_facts);
    IF NOT COALESCE((v_payee ->> 'applies')::boolean, false) THEN
      v_skipped := v_skipped || jsonb_build_object('role', v_role ->> 'key', 'reason', 'not_applicable');
      CONTINUE;
    END IF;

    v_amount := public.commission_amount_cents(v_rule, v_facts);
    IF v_amount <= 0 THEN
      v_skipped := v_skipped || jsonb_build_object('role', v_role ->> 'key', 'reason', 'zero_amount');
      CONTINUE;
    END IF;
    v_base := public.commission_base_cents(v_rule, v_facts);
    v_user := NULLIF(v_payee ->> 'user_id', '')::uuid;
    v_id := NULL;

    INSERT INTO public.commissions (
      workspace_id, kind, role, user_id, payment_id, sale_id, rule_id, rule_snapshot, base_amount, amount,
      attribution_touch_id, attribution_snapshot, paid_on, available_on
    ) VALUES (
      p.workspace_id, 'earned', v_role ->> 'key', v_user, p.id, p.sale_id, v_rule.id,
      jsonb_build_object('name', v_rule.name, 'role', v_rule.role, 'calc_type', v_rule.calc_type, 'rate', v_rule.rate,
                         'fixed_amount', v_rule.fixed_amount, 'base', v_rule.base, 'conditions', v_rule.conditions, 'position', v_rule.position),
      v_base::numeric / 100, v_amount::numeric / 100,
      NULLIF(v_touch ->> 'id', '')::uuid,
      CASE WHEN v_touch IS NULL THEN NULL ELSE jsonb_build_object(
        'channel', v_touch ->> 'channel', 'source', v_touch ->> 'source', 'content_post_id', v_touch ->> 'content_post_id',
        'content_title', v_title, 'meta_ad_id', v_touch ->> 'meta_ad_id', 'ad_name', v_ad_name) END,
      p.paid_on, COALESCE(p.paid_on, CURRENT_DATE) + v_rule.hold_days
    )
    ON CONFLICT (payment_id, role) WHERE kind = 'earned' AND voided_at IS NULL DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NOT NULL THEN
      v_created := v_created + 1;
      v_created_ids := v_created_ids || to_jsonb(v_id);
      PERFORM private.cm_audit(p.workspace_id, 'commission', v_id, 'commission.generated',
        jsonb_build_object('amount', jsonb_build_object('old', NULL, 'new', v_amount::numeric / 100)),
        jsonb_build_object('role', v_role ->> 'key', 'payment_id', p.id, 'sale_id', p.sale_id, 'rule_id', v_rule.id, 'user_id', v_user));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', v_created, 'created_ids', v_created_ids, 'skipped_roles', v_skipped);
END;
$function$

-- ---- revert_commissions_for_payment (452c233b...) ----
CREATE OR REPLACE FUNCTION public.revert_commissions_for_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_status text;
  v_ws uuid;
  v_voided jsonb := '[]'::jsonb;
  v_review jsonb := '[]'::jsonb;
  r record;
BEGIN
  SELECT status, workspace_id INTO v_status, v_ws FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'not_found');
  END IF;
  -- Si volvio a `paid` antes de que corra (carrera), no hay nada que revertir.
  IF v_status = 'paid' THEN
    RETURN jsonb_build_object('skipped', 'still_paid');
  END IF;

  FOR r IN
    SELECT c.id, c.expense_id, c.workspace_id FROM public.commissions c
     WHERE c.payment_id = p_payment_id AND c.kind = 'earned' AND c.voided_at IS NULL
     ORDER BY c.id FOR UPDATE
  LOOP
    IF r.expense_id IS NULL THEN
      UPDATE public.commissions SET voided_at = now(), voided_by = NULL, void_reason = 'Se revirtió el cobro' WHERE id = r.id;
      v_voided := v_voided || to_jsonb(r.id);
      PERFORM private.cm_audit(r.workspace_id, 'commission', r.id, 'commission.voided',
        jsonb_build_object('void_reason', jsonb_build_object('old', NULL, 'new', 'Se revirtió el cobro')), jsonb_build_object('payment_id', p_payment_id));
    ELSE
      v_review := v_review || to_jsonb(r.id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('voided', v_voided, 'needs_review', v_review);
END;
$function$

-- ---- merge_contacts (7f27d943...) ----
CREATE OR REPLACE FUNCTION public.merge_contacts(p_workspace_id uuid, p_main uuid, p_duplicate uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main public.contacts%ROWTYPE;
  v_dup public.contacts%ROWTYPE;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_conv record;
  v_merged_convs uuid[] := '{}';
  v_convs_merged integer := 0;
  v_msgs_moved integer := 0;
  v_msgs_left integer := 0;
  v_notes text;
  v_table text;
  -- Pipeline (00245): el estado de cada rol despues de fusionar, y el ultimo.
  v_setter text;
  v_setter_at timestamptz;
  v_setter_by_agent boolean;
  v_closer text;
  v_closer_at timestamptz;
  v_last_role text;
  v_last text;
  v_last_at timestamptz;
BEGIN
  IF p_workspace_id IS NULL OR p_main IS NULL OR p_duplicate IS NULL THEN
    RAISE EXCEPTION 'merge_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_main = p_duplicate THEN
    RAISE EXCEPTION 'merge_same_contact' USING ERRCODE = '22023';
  END IF;

  -- Las dos filas, bloqueadas en un orden fijo (sin interbloqueos entre dos fusiones).
  PERFORM 1 FROM public.contacts WHERE id IN (p_main, p_duplicate) ORDER BY id FOR UPDATE;
  SELECT * INTO v_main FROM public.contacts WHERE id = p_main;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_dup FROM public.contacts WHERE id = p_duplicate;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_main.workspace_id <> p_workspace_id OR v_dup.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'merge_workspace_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_main.deleted_at IS NOT NULL OR v_dup.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'merge_deleted' USING ERRCODE = '22023';
  END IF;

  -- El duplicado sale de circulacion PRIMERO: asi, si hay indices unicos por telefono o email sobre los contactos vivos,
  -- rellenar los datos vacios del principal no choca con el duplicado.
  UPDATE public.contacts
     SET deleted_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('merged_into', p_main)
   WHERE id = p_duplicate;

  -- Canales vinculados (unico por canal + remitente: los remitentes son distintos, no choca).
  UPDATE public.contact_channels SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_channels', v_n);

  -- Conversaciones: UNA por canal y contacto. Si el principal ya tiene una en ese canal, los mensajes de la del
  -- duplicado pasan a la del principal (los que repiten el id del mensaje de la plataforma se quedan donde estan y se
  -- cuentan), se recalcula su resumen y la del duplicado queda vacia y con borrado logico.
  FOR v_conv IN
    SELECT d.id AS dup_conv, m.id AS main_conv
      FROM public.conversations d
      JOIN public.conversations m ON m.channel_id = d.channel_id AND m.contact_id = p_main
     WHERE d.contact_id = p_duplicate
     ORDER BY d.id
  LOOP
    -- Un solo borrador abierto por conversacion: si el principal ya tiene uno, el del duplicado se descarta.
    IF EXISTS (SELECT 1 FROM public.agent_drafts WHERE conversation_id = v_conv.main_conv AND status IN ('pending', 'sending', 'failed')) THEN
      UPDATE public.agent_drafts SET status = 'discarded'
       WHERE conversation_id = v_conv.dup_conv AND status IN ('pending', 'sending', 'failed');
    END IF;
    UPDATE public.agent_drafts SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;

    UPDATE public.messages msg SET conversation_id = v_conv.main_conv
     WHERE msg.conversation_id = v_conv.dup_conv
       AND (msg.platform_message_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.messages o
              WHERE o.conversation_id = v_conv.main_conv AND o.platform_message_id = msg.platform_message_id));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_msgs_moved := v_msgs_moved + v_n;
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv.dup_conv;
    v_msgs_left := v_msgs_left + v_n;

    UPDATE public.conversations m SET
      last_message_preview = CASE WHEN d.last_message_at IS NOT NULL AND (m.last_message_at IS NULL OR d.last_message_at > m.last_message_at)
                                  THEN d.last_message_preview ELSE m.last_message_preview END,
      last_message_at = GREATEST(m.last_message_at, d.last_message_at),
      unread_count = COALESCE(m.unread_count, 0) + COALESCE(d.unread_count, 0),
      status = CASE WHEN m.status = 'open' OR d.status = 'open' THEN 'open' ELSE m.status END,
      assigned_to = COALESCE(m.assigned_to, d.assigned_to),
      needs_human_reason = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_reason ELSE m.needs_human_reason END,
      needs_human_at = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_at ELSE m.needs_human_at END,
      needs_human = COALESCE(m.needs_human, false) OR COALESCE(d.needs_human, false),
      deleted_at = CASE WHEN m.deleted_at IS NOT NULL AND d.deleted_at IS NULL THEN NULL ELSE m.deleted_at END
     FROM public.conversations d
    WHERE m.id = v_conv.main_conv AND d.id = v_conv.dup_conv;

    UPDATE public.agent_runs SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
    UPDATE public.tasks SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
    UPDATE public.conversations SET deleted_at = COALESCE(deleted_at, now()), unread_count = 0 WHERE id = v_conv.dup_conv;

    v_merged_convs := v_merged_convs || v_conv.dup_conv;
    v_convs_merged := v_convs_merged + 1;
  END LOOP;

  -- Las demas conversaciones se mueven enteras.
  UPDATE public.conversations SET contact_id = p_main
   WHERE contact_id = p_duplicate AND NOT (id = ANY (v_merged_convs));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('conversations', v_n, 'conversations_merged', v_convs_merged, 'messages_moved', v_msgs_moved, 'messages_left', v_msgs_left);

  -- Etiquetas: se mueven las que el principal no tiene (PK contact_id + tag_id).
  UPDATE public.contact_tags SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_tags o WHERE o.contact_id = p_main AND o.tag_id = public.contact_tags.tag_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_tags', v_n);

  -- Campos personalizados: en uno que ambos tienen, gana el del principal.
  UPDATE public.contact_custom_fields SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_custom_fields o WHERE o.contact_id = p_main AND o.field_id = public.contact_custom_fields.field_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_custom_fields', v_n);

  -- Secuencias: una inscripcion viva por secuencia. Si el principal ya esta activo o pausado en esa secuencia, la viva del
  -- duplicado se cancela (con el motivo); el resto se mueve.
  UPDATE public.sequence_enrollments d SET status = 'cancelled', paused_reason = 'fusion de contactos', next_step_at = NULL, locked_at = NULL
   WHERE d.contact_id = p_duplicate AND d.status IN ('active', 'paused')
     AND EXISTS (SELECT 1 FROM public.sequence_enrollments m WHERE m.contact_id = p_main AND m.sequence_id = d.sequence_id AND m.status IN ('active', 'paused'));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments_cancelled', v_n);
  UPDATE public.sequence_enrollments SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments', v_n);

  -- Sesiones de flujo: las activas del duplicado se mueven, salvo que el principal ya tenga una activa del mismo flujo (la
  -- del duplicado se cancela). El historial se mueve siempre.
  UPDATE public.flow_sessions d SET status = 'cancelled'
   WHERE d.contact_id = p_duplicate AND d.status = 'active'
     AND EXISTS (SELECT 1 FROM public.flow_sessions m WHERE m.contact_id = p_main AND m.status = 'active' AND m.flow_id = d.flow_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions_cancelled', v_n);
  UPDATE public.flow_sessions SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions', v_n);

  -- Eventos de automatizacion: los pendientes del duplicado NO se mueven (podrian disparar otra vez un flujo para el
  -- principal): se marcan como cancelados. Los ya procesados (historial) se mueven.
  UPDATE public.automation_events SET processed_at = now(), error = 'fusion de contactos'
   WHERE contact_id = p_duplicate AND processed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events_cancelled', v_n);
  UPDATE public.automation_events SET contact_id = p_main
   WHERE contact_id = p_duplicate AND processed_at IS NOT NULL AND error IS DISTINCT FROM 'fusion de contactos';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events', v_n);

  -- Tareas: si los dos tienen un seguimiento para la misma fecha, el del duplicado pasa como tarea normal (sin la clave).
  UPDATE public.tasks d SET source_ref = NULL
   WHERE d.contact_id = p_duplicate AND d.source_ref LIKE 'followup:%' AND d.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.tasks m WHERE m.workspace_id = d.workspace_id AND m.contact_id = p_main AND m.source_ref = d.source_ref AND m.deleted_at IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks_detached', v_n);
  UPDATE public.tasks SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks', v_n);

  -- Toques de atribucion: se mueven todos y la atribucion del principal se recalcula con TODOS (primer y ultimo toque).
  UPDATE public.contact_touches SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_touches', v_n);
  IF v_n > 0 THEN PERFORM private.refresh_contact_attribution(p_main); END IF;

  -- Pipeline (00245): el historial de estados del duplicado pasa al principal (los cambios siguen siendo de quien los hizo).
  UPDATE public.contact_status_changes SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_status_changes', v_n);

  -- Formularios: "una vez por contacto" guarda `contact:<id>`; la respuesta que se mueve pasa a `contact:<principal>` salvo
  -- que el principal ya tenga una para ese formulario (el indice unico no deja dos).
  UPDATE public.form_submissions fs SET once_key = 'contact:' || p_main::text
   WHERE fs.contact_id = p_duplicate AND fs.once_key = 'contact:' || p_duplicate::text
     AND NOT EXISTS (SELECT 1 FROM public.form_submissions o WHERE o.form_id = fs.form_id AND o.once_key = 'contact:' || p_main::text AND o.status <> 'spam' AND fs.status <> 'spam');
  UPDATE public.form_submissions SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('form_submissions', v_n);

  -- Lo que solo cambia de dueno (sin indices unicos que dependan del contacto). Las ventas llevan sus pagos; las agendas y
  -- las llamadas no cambian de estado ni de monto.
  FOREACH v_table IN ARRAY ARRAY[
    'agent_drafts', 'agent_runs', 'analytics_events', 'bookings', 'broadcast_recipients', 'calls', 'contact_notes',
    'contract_signatures', 'email_log', 'inbound_webhooks', 'sales', 'social_post_comments', 'trigger_fires'
  ] LOOP
    EXECUTE format('UPDATE public.%I SET contact_id = $1 WHERE contact_id = $2', v_table) USING p_main, p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_moved := v_moved || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- Los contactos que el duplicado habia referido pasan a ser referidos por el principal.
  UPDATE public.contacts SET referred_by_contact_id = NULL WHERE id = p_main AND referred_by_contact_id = p_duplicate;
  UPDATE public.contacts SET referred_by_contact_id = p_main WHERE referred_by_contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('referred_contacts', v_n);

  -- Los datos de identidad que el principal tiene vacios se completan con los del duplicado (nunca al reves), mas la fecha
  -- del proximo seguimiento.
  UPDATE public.contacts SET
    display_name = CASE WHEN NULLIF(btrim(COALESCE(display_name, '')), '') IS NULL THEN COALESCE(v_dup.display_name, display_name) ELSE display_name END,
    email = CASE WHEN NULLIF(btrim(COALESCE(email, '')), '') IS NULL THEN COALESCE(v_dup.email, email) ELSE email END,
    secondary_email = CASE WHEN NULLIF(btrim(COALESCE(secondary_email, '')), '') IS NULL THEN COALESCE(v_dup.secondary_email, secondary_email) ELSE secondary_email END,
    phone = CASE WHEN NULLIF(btrim(COALESCE(phone, '')), '') IS NULL THEN COALESCE(v_dup.phone, phone) ELSE phone END,
    whatsapp_phone = CASE WHEN NULLIF(btrim(COALESCE(whatsapp_phone, '')), '') IS NULL THEN COALESCE(v_dup.whatsapp_phone, whatsapp_phone) ELSE whatsapp_phone END,
    country = CASE WHEN NULLIF(btrim(COALESCE(country, '')), '') IS NULL THEN COALESCE(v_dup.country, country) ELSE country END,
    instagram_username = CASE WHEN NULLIF(btrim(COALESCE(instagram_username, '')), '') IS NULL THEN COALESCE(v_dup.instagram_username, instagram_username) ELSE instagram_username END,
    tiktok_username = CASE WHEN NULLIF(btrim(COALESCE(tiktok_username, '')), '') IS NULL THEN COALESCE(v_dup.tiktok_username, tiktok_username) ELSE tiktok_username END,
    twitter_username = CASE WHEN NULLIF(btrim(COALESCE(twitter_username, '')), '') IS NULL THEN COALESCE(v_dup.twitter_username, twitter_username) ELSE twitter_username END,
    facebook_id = CASE WHEN NULLIF(btrim(COALESCE(facebook_id, '')), '') IS NULL THEN COALESCE(v_dup.facebook_id, facebook_id) ELSE facebook_id END,
    youtube_channel_id = CASE WHEN NULLIF(btrim(COALESCE(youtube_channel_id, '')), '') IS NULL THEN COALESCE(v_dup.youtube_channel_id, youtube_channel_id) ELSE youtube_channel_id END,
    linkedin_profile_url = CASE WHEN NULLIF(btrim(COALESCE(linkedin_profile_url, '')), '') IS NULL THEN COALESCE(v_dup.linkedin_profile_url, linkedin_profile_url) ELSE linkedin_profile_url END,
    setter_id = COALESCE(setter_id, v_dup.setter_id),
    vendedor_id = COALESCE(vendedor_id, v_dup.vendedor_id),
    next_followup_date = COALESCE(next_followup_date, v_dup.next_followup_date),
    -- Producto de interes (00246): gana el del principal; si no tiene, el del duplicado con SU variante.
    interest_variant_id = CASE WHEN interest_product_id IS NULL THEN v_dup.interest_variant_id ELSE interest_variant_id END,
    interest_product_id = COALESCE(interest_product_id, v_dup.interest_product_id)
   WHERE id = p_main;

  -- Pipeline (00245): el estado de cada rol es el del principal; si no tiene, el del duplicado. El ultimo se recalcula
  -- con la misma regla que `set_contact_status` (el mas reciente; empatados, el del vendedor). Las columnas de estado solo
  -- se escriben con la marca de transaccion (`contacts_status_guard`).
  IF v_main.setter_status IS NOT NULL THEN
    v_setter := v_main.setter_status; v_setter_at := v_main.setter_status_at; v_setter_by_agent := v_main.setter_status_by_agent;
  ELSE
    v_setter := v_dup.setter_status; v_setter_at := v_dup.setter_status_at; v_setter_by_agent := COALESCE(v_dup.setter_status_by_agent, false);
  END IF;
  IF v_main.closer_status IS NOT NULL THEN
    v_closer := v_main.closer_status; v_closer_at := v_main.closer_status_at;
  ELSE
    v_closer := v_dup.closer_status; v_closer_at := v_dup.closer_status_at;
  END IF;
  IF v_closer IS NOT NULL AND (v_setter IS NULL OR v_closer_at >= v_setter_at) THEN
    v_last_role := 'closer'; v_last := v_closer; v_last_at := v_closer_at;
  ELSIF v_setter IS NOT NULL THEN
    v_last_role := 'setter'; v_last := v_setter; v_last_at := v_setter_at;
  ELSE
    v_last_role := NULL; v_last := NULL; v_last_at := NULL;
  END IF;
  IF v_setter IS DISTINCT FROM v_main.setter_status OR v_closer IS DISTINCT FROM v_main.closer_status THEN
    PERFORM set_config('app.contact_status_internal', 'on', true);
    UPDATE public.contacts SET
      setter_status = v_setter, setter_status_at = v_setter_at, setter_status_by_agent = COALESCE(v_setter_by_agent, false),
      closer_status = v_closer, closer_status_at = v_closer_at,
      last_status_role = v_last_role, last_status = v_last, last_status_at = v_last_at
     WHERE id = p_main;
    PERFORM set_config('app.contact_status_internal', 'off', true);
  END IF;

  -- Las notas de los dos se juntan (dos textos de personas distintas sobre el mismo lead: quedarse con uno tira el otro).
  v_notes := concat_ws(E'\n\n---\n\n', NULLIF(btrim(COALESCE(v_main.notes, '')), ''), NULLIF(btrim(COALESCE(v_dup.notes, '')), ''));
  IF v_notes <> '' AND v_notes IS DISTINCT FROM btrim(COALESCE(v_main.notes, '')) THEN
    UPDATE public.contacts SET notes = v_notes WHERE id = p_main;
  END IF;

  -- La sugerencia de vinculacion ya no corresponde.
  UPDATE public.contacts SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb), '{link_suggestions}',
      COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(metadata -> 'link_suggestions') s WHERE s ->> 'contact_id' IS DISTINCT FROM p_duplicate::text), '[]'::jsonb))
   WHERE id = p_main AND jsonb_typeof(metadata -> 'link_suggestions') = 'array';

  -- El historial del contacto principal, en la misma transaccion (sin datos sensibles: solo cuentas).
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (p_workspace_id, 'contact', p_main, 'link', NULL,
          jsonb_build_object('merged_from', p_duplicate, 'automatic', false, 'moved', v_moved), p_actor);

  RETURN jsonb_build_object('ok', true, 'main', p_main, 'duplicate', p_duplicate, 'moved', v_moved);
END;
$function$

-- ---- private.member_permission_keys() ----
CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage',
    'calls.view',
    'forms.view',
    'sales.view',
    'sales.manage',
    'payments.manage',
    'tasks.view',
    'tasks.edit',
    'commissions.view',
    'designer.view',
    'designer.edit',
    'services.view',
    'services.items',
    'portal.view_as'
  ]::text[]
$function$

-- ---- private.commission_settings_guard (5b5251bc...) ----
CREATE OR REPLACE FUNCTION private.commission_settings_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_keys text[];
BEGIN
  IF NEW.commission_settings IS NOT DISTINCT FROM OLD.commission_settings THEN
    RETURN NEW;
  END IF;

  FOR v_old IN SELECT * FROM jsonb_array_elements(OLD.commission_settings -> 'roles') LOOP
    SELECT n INTO v_new FROM jsonb_array_elements(NEW.commission_settings -> 'roles') n WHERE n ->> 'key' = v_old ->> 'key' LIMIT 1;
    IF v_new IS NULL THEN
      RAISE EXCEPTION 'Un rol de comision no se borra: se desactiva (%).', v_old ->> 'key' USING ERRCODE = 'CM002';
    END IF;
    IF (v_new ->> 'payee') IS DISTINCT FROM (v_old ->> 'payee') THEN
      RAISE EXCEPTION 'A quien se le paga un rol de comision no se cambia (%).', v_old ->> 'key' USING ERRCODE = 'CM002';
    END IF;
    IF COALESCE(v_new ->> 'system', 'false') IS DISTINCT FROM COALESCE(v_old ->> 'system', 'false') THEN
      RAISE EXCEPTION 'Un rol precargado sigue siendo precargado (%).', v_old ->> 'key' USING ERRCODE = 'CM002';
    END IF;
  END LOOP;

  SELECT array_agg(n ->> 'key') INTO v_keys FROM jsonb_array_elements(NEW.commission_settings -> 'roles') n;
  IF EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE k IS NULL OR k !~ '^[a-z0-9_]{2,40}$') THEN
    RAISE EXCEPTION 'La clave de un rol de comision tiene que ser ^[a-z0-9_]{2,40}$.' USING ERRCODE = 'CM002';
  END IF;
  IF (SELECT count(*) FROM unnest(v_keys)) <> (SELECT count(DISTINCT k) FROM unnest(v_keys) k) THEN
    RAISE EXCEPTION 'Hay dos roles de comision con la misma clave.' USING ERRCODE = 'CM002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.commission_settings -> 'roles') n
     WHERE (n ->> 'payee') NOT IN ('sale_vendedor', 'sale_setter', 'content_assignee', 'fixed') OR (n ->> 'payee') IS NULL
  ) THEN
    RAISE EXCEPTION 'A quien se le paga un rol de comision no es valido.' USING ERRCODE = 'CM002';
  END IF;
  RETURN NEW;
END;
$function$
