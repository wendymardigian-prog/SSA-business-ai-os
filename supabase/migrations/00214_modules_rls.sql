-- ============================================================================
-- 00214 — Modulos por permiso (B5, F20-F24): las politicas de los modulos piden SU clave, no "ser Admin"
-- ============================================================================
-- Hasta hoy la base dejaba escribir en estas tablas a cualquier miembro (flows) o solo a un Admin (todo lo demas), sin mirar
-- el rol personalizado. Ahora cada una pide la clave del catalogo que ya promete la pantalla:
--
--   flows                    SELECT flows.view · INSERT/UPDATE/DELETE flows.edit        (antes: cualquier miembro)
--   triggers                 INSERT/UPDATE/DELETE flows.edit                            (antes: Admin)  <- cambio M7
--   sequences                INSERT/UPDATE/DELETE sequences.edit                        (antes: Admin)
--   tags                     la rama "Admin" pasa a tags.manage; la de etiqueta simple no cambia
--   agents                   INSERT/UPDATE agents.edit                                  (antes: Admin)
--   agent_prompt_versions    INSERT/SELECT agents.edit                                  (antes: Admin)
--   ai_task_prompt_versions  INSERT/SELECT ai_tasks.manage O calls.configure            (antes: Admin)
--   knowledge_base           INSERT/UPDATE/DELETE knowledge.edit                        (antes: Admin)
--   contacts                 DELETE contacts.delete                                     (antes: Admin)
--
-- Owner y Admin tienen todas esas claves, asi que para ellos NADA cambia. El Member de sistema (flows.view, flows.edit,
-- agents.view y nada del resto de la lista):
--   - flows: sigue leyendo y escribiendo, como hoy;
--   - triggers: ahora si escribe (M7: lo que un Member publica empieza a dispararse de verdad; hasta hoy el insert del
--     disparador fallaba en silencio);
--   - sequences, tags de agente/asignacion, agents, prompts, knowledge y borrar contactos: sigue SIN poder.
--
-- Dos diferencias con el plano (§8.4), a proposito, para no cambiarle nada al Member sin que nadie lo haya aprobado:
--   - agents UPDATE tambien pide agents.edit (el plano nombra solo el INSERT, pero las acciones actualizan con la sesion
--     de la persona: sin esto, un rol con agents.edit podria crear agentes y no editarlos).
--   - agent_prompt_versions SELECT pide agents.edit y no agents.view: el Member tiene agents.view y hasta hoy no podia
--     leer el historial de instrucciones (la pestaña de instrucciones de la pantalla ya pide agents.edit).
--
-- Se evalua con `(select public.has_permission(...))` para que Postgres lo calcule una vez por consulta y no por fila.
-- Se aplica DESPUES de desplegar el codigo del bloque B5.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE POLICY.
--
-- ----------------------------------------------------------------------------
-- COMO VOLVER ATRAS: para cada politica de abajo, ejecutar su DROP POLICY IF EXISTS <nueva> (las nuevas se llaman
-- como las viejas, salvo las dos de flows, que son flows_select/insert/update/delete) y despues recrear la vieja con las
-- definiciones vigentes ANTES de esta migracion (leidas de pg_policies), sin el prefijo "--   ":
--   DROP POLICY IF EXISTS flows_select ON public.flows;  DROP POLICY IF EXISTS flows_insert ON public.flows;
--   DROP POLICY IF EXISTS flows_update ON public.flows;  DROP POLICY IF EXISTS flows_delete ON public.flows;
-- ----------------------------------------------------------------------------
--   DROP POLICY IF EXISTS agent_prompt_versions_insert ON public.agent_prompt_versions;
--   CREATE POLICY agent_prompt_versions_insert ON public.agent_prompt_versions AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK ((is_workspace_admin(workspace_id) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
--      FROM agents a
--     WHERE ((a.id = agent_prompt_versions.agent_id) AND (a.workspace_id = agent_prompt_versions.workspace_id))))));
--
--   DROP POLICY IF EXISTS agent_prompt_versions_select ON public.agent_prompt_versions;
--   CREATE POLICY agent_prompt_versions_select ON public.agent_prompt_versions AS PERMISSIVE FOR SELECT TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS agents_insert ON public.agents;
--   CREATE POLICY agents_insert ON public.agents AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS agents_update ON public.agents;
--   CREATE POLICY agents_update ON public.agents AS PERMISSIVE FOR UPDATE TO public
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS ai_task_prompt_versions_insert ON public.ai_task_prompt_versions;
--   CREATE POLICY ai_task_prompt_versions_insert ON public.ai_task_prompt_versions AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK ((is_workspace_admin(workspace_id) AND (created_by = auth.uid())));
--
--   DROP POLICY IF EXISTS ai_task_prompt_versions_select ON public.ai_task_prompt_versions;
--   CREATE POLICY ai_task_prompt_versions_select ON public.ai_task_prompt_versions AS PERMISSIVE FOR SELECT TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS contacts_delete ON public.contacts;
--   CREATE POLICY contacts_delete ON public.contacts AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS "Users can manage flows in their workspaces" ON public.flows;
--   CREATE POLICY "Users can manage flows in their workspaces" ON public.flows AS PERMISSIVE FOR ALL TO public
--     USING (is_workspace_member(workspace_id));
--
--   DROP POLICY IF EXISTS "Users can view flows in their workspaces" ON public.flows;
--   CREATE POLICY "Users can view flows in their workspaces" ON public.flows AS PERMISSIVE FOR SELECT TO public
--     USING (is_workspace_member(workspace_id));
--
--   DROP POLICY IF EXISTS knowledge_base_delete ON public.knowledge_base;
--   CREATE POLICY knowledge_base_delete ON public.knowledge_base AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS knowledge_base_insert ON public.knowledge_base;
--   CREATE POLICY knowledge_base_insert ON public.knowledge_base AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS knowledge_base_update ON public.knowledge_base;
--   CREATE POLICY knowledge_base_update ON public.knowledge_base AS PERMISSIVE FOR UPDATE TO public
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS sequences_delete ON public.sequences;
--   CREATE POLICY sequences_delete ON public.sequences AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS sequences_insert ON public.sequences;
--   CREATE POLICY sequences_insert ON public.sequences AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS sequences_update ON public.sequences;
--   CREATE POLICY sequences_update ON public.sequences AS PERMISSIVE FOR UPDATE TO public
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS tags_delete ON public.tags;
--   CREATE POLICY tags_delete ON public.tags AS PERMISSIVE FOR DELETE TO public
--     USING ((is_workspace_member(workspace_id) AND (is_workspace_admin(workspace_id) OR ((disables_agent = false) AND (assigns_to IS NULL)))));
--
--   DROP POLICY IF EXISTS tags_insert ON public.tags;
--   CREATE POLICY tags_insert ON public.tags AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK ((is_workspace_member(workspace_id) AND (is_workspace_admin(workspace_id) OR ((disables_agent = false) AND (assigns_to IS NULL)))));
--
--   DROP POLICY IF EXISTS tags_update ON public.tags;
--   CREATE POLICY tags_update ON public.tags AS PERMISSIVE FOR UPDATE TO public
--     USING ((is_workspace_member(workspace_id) AND (is_workspace_admin(workspace_id) OR ((disables_agent = false) AND (assigns_to IS NULL)))))
--     WITH CHECK ((is_workspace_member(workspace_id) AND (is_workspace_admin(workspace_id) OR ((disables_agent = false) AND (assigns_to IS NULL)))));
--
--   DROP POLICY IF EXISTS triggers_delete ON public.triggers;
--   CREATE POLICY triggers_delete ON public.triggers AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS triggers_insert ON public.triggers;
--   CREATE POLICY triggers_insert ON public.triggers AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS triggers_update ON public.triggers;
--   CREATE POLICY triggers_update ON public.triggers AS PERMISSIVE FOR UPDATE TO public
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- flows
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can manage flows in their workspaces" ON public.flows;
DROP POLICY IF EXISTS "Users can view flows in their workspaces" ON public.flows;
DROP POLICY IF EXISTS flows_select ON public.flows;
DROP POLICY IF EXISTS flows_insert ON public.flows;
DROP POLICY IF EXISTS flows_update ON public.flows;
DROP POLICY IF EXISTS flows_delete ON public.flows;
CREATE POLICY flows_select ON public.flows FOR SELECT
  USING ((select public.has_permission(workspace_id, 'flows.view')));
CREATE POLICY flows_insert ON public.flows FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'flows.edit')));
CREATE POLICY flows_update ON public.flows FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'flows.edit')))
  WITH CHECK ((select public.has_permission(workspace_id, 'flows.edit')));
CREATE POLICY flows_delete ON public.flows FOR DELETE
  USING ((select public.has_permission(workspace_id, 'flows.edit')));

-- ----------------------------------------------------------------------------
-- triggers (cambio aprobado M7)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS triggers_insert ON public.triggers;
CREATE POLICY triggers_insert ON public.triggers FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'flows.edit')));
DROP POLICY IF EXISTS triggers_update ON public.triggers;
CREATE POLICY triggers_update ON public.triggers FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'flows.edit')))
  WITH CHECK ((select public.has_permission(workspace_id, 'flows.edit')));
DROP POLICY IF EXISTS triggers_delete ON public.triggers;
CREATE POLICY triggers_delete ON public.triggers FOR DELETE
  USING ((select public.has_permission(workspace_id, 'flows.edit')));

-- ----------------------------------------------------------------------------
-- sequences
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS sequences_insert ON public.sequences;
CREATE POLICY sequences_insert ON public.sequences FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'sequences.edit')));
DROP POLICY IF EXISTS sequences_update ON public.sequences;
CREATE POLICY sequences_update ON public.sequences FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'sequences.edit')))
  WITH CHECK ((select public.has_permission(workspace_id, 'sequences.edit')));
DROP POLICY IF EXISTS sequences_delete ON public.sequences;
CREATE POLICY sequences_delete ON public.sequences FOR DELETE
  USING ((select public.has_permission(workspace_id, 'sequences.edit')));

-- ----------------------------------------------------------------------------
-- tags: solo la rama "Admin" (la de etiqueta simple, sin efectos, queda igual)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS tags_insert ON public.tags;
CREATE POLICY tags_insert ON public.tags FOR INSERT
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND ((select public.has_permission(workspace_id, 'tags.manage')) OR (disables_agent = false AND assigns_to IS NULL))
  );
DROP POLICY IF EXISTS tags_update ON public.tags;
CREATE POLICY tags_update ON public.tags FOR UPDATE
  USING (
    public.is_workspace_member(workspace_id)
    AND ((select public.has_permission(workspace_id, 'tags.manage')) OR (disables_agent = false AND assigns_to IS NULL))
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND ((select public.has_permission(workspace_id, 'tags.manage')) OR (disables_agent = false AND assigns_to IS NULL))
  );
DROP POLICY IF EXISTS tags_delete ON public.tags;
CREATE POLICY tags_delete ON public.tags FOR DELETE
  USING (
    public.is_workspace_member(workspace_id)
    AND ((select public.has_permission(workspace_id, 'tags.manage')) OR (disables_agent = false AND assigns_to IS NULL))
  );

-- ----------------------------------------------------------------------------
-- agents y sus versiones de instrucciones
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS agents_insert ON public.agents;
CREATE POLICY agents_insert ON public.agents FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'agents.edit')));
DROP POLICY IF EXISTS agents_update ON public.agents;
CREATE POLICY agents_update ON public.agents FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'agents.edit')))
  WITH CHECK ((select public.has_permission(workspace_id, 'agents.edit')));

DROP POLICY IF EXISTS agent_prompt_versions_insert ON public.agent_prompt_versions;
CREATE POLICY agent_prompt_versions_insert ON public.agent_prompt_versions FOR INSERT
  WITH CHECK (
    (select public.has_permission(workspace_id, 'agents.edit'))
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_prompt_versions.agent_id AND a.workspace_id = agent_prompt_versions.workspace_id
    )
  );
DROP POLICY IF EXISTS agent_prompt_versions_select ON public.agent_prompt_versions;
CREATE POLICY agent_prompt_versions_select ON public.agent_prompt_versions FOR SELECT
  USING ((select public.has_permission(workspace_id, 'agents.edit')));

-- ----------------------------------------------------------------------------
-- instrucciones versionadas de las tareas de IA
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS ai_task_prompt_versions_insert ON public.ai_task_prompt_versions;
CREATE POLICY ai_task_prompt_versions_insert ON public.ai_task_prompt_versions FOR INSERT
  WITH CHECK (
    (
      (select public.has_permission(workspace_id, 'ai_tasks.manage'))
      OR (select public.has_permission(workspace_id, 'calls.configure'))
    )
    AND created_by = auth.uid()
  );
DROP POLICY IF EXISTS ai_task_prompt_versions_select ON public.ai_task_prompt_versions;
CREATE POLICY ai_task_prompt_versions_select ON public.ai_task_prompt_versions FOR SELECT
  USING (
    (select public.has_permission(workspace_id, 'ai_tasks.manage'))
    OR (select public.has_permission(workspace_id, 'calls.configure'))
  );

-- ----------------------------------------------------------------------------
-- knowledge_base
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS knowledge_base_insert ON public.knowledge_base;
CREATE POLICY knowledge_base_insert ON public.knowledge_base FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'knowledge.edit')));
DROP POLICY IF EXISTS knowledge_base_update ON public.knowledge_base;
CREATE POLICY knowledge_base_update ON public.knowledge_base FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'knowledge.edit')))
  WITH CHECK ((select public.has_permission(workspace_id, 'knowledge.edit')));
DROP POLICY IF EXISTS knowledge_base_delete ON public.knowledge_base;
CREATE POLICY knowledge_base_delete ON public.knowledge_base FOR DELETE
  USING ((select public.has_permission(workspace_id, 'knowledge.edit')));

-- ----------------------------------------------------------------------------
-- contacts: solo el DELETE (el alcance de lectura y edicion sigue siendo `can_see_contact`)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS contacts_delete ON public.contacts;
CREATE POLICY contacts_delete ON public.contacts FOR DELETE
  USING ((select public.has_permission(workspace_id, 'contacts.delete')));
