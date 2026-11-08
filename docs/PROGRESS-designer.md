# PROGRESS — Diseñador IA

> Plan aprobado por Wendy el 7/11/2026, copiado tal cual abajo. Después del plan: punto de partida medido, checklist F1–F70 y subagentes.


> Este archivo se copia tal cual a `docs/PROGRESS-designer.md` en la primera tarea de la ejecución. Es lo que sigue la construcción aunque la conversación se resuma.

## Contexto

Módulo nuevo de BAIOS: diseñar piezas visuales con IA o a mano (carruseles, historias, presentaciones, PDF, certificados, páginas web). Se publican con link o se exportan, las plantillas generan piezas solas desde automatizaciones y todo se conecta con Contenido. Se construye antes que Servicios, que lo usa para los certificados.

- **Fuentes**, todas en `/Users/wendymardigian/Documents/SSA-business-ai-os/claude/v12/disenador-ia/`:
  - `requerimientos-disenador-ia.md` (**v1.4**). Es el plano y es el que manda.
  - `prototipo-disenador-ia.html`. Se abre con `file:///Users/wendymardigian/Documents/SSA-business-ai-os/claude/v12/disenador-ia/prototipo-disenador-ia.html`.
  - `alcance-v12.md`.
  - `requerimientos-v12-servicios.md`. Sirve solo para el punto de extensión de §9.3.
- **Rama** `feat/disenador-ia`, en el worktree `.claude/worktrees/disenador-ia-setup-f7b117`, sobre `main` `5a12a81`.
- **Para comparar** se usa `origin/main`. Nunca se hace checkout de `main` desde acá.
- **Nombre visible** en todo lo que ve el usuario: **"Diseñador IA"**. Lo interno sigue como dice el plano: `designer`, `design_*`, `/dashboard/disenos`.

## Decisiones tomadas en esta conversación

1. **Link público sin pie** (respuesta de Wendy). No se muestra "Hecho con SSA BAIOS" ni ningún otro "Hecho con…". Es la regla de white label, y queda anotado como diferencia con F43 y §11.7.
2. **El prototipo se recorre con Chrome** (Claude in Chrome), en una pestaña nueva y solo para ese archivo. Si Chrome no puede abrir el `file://` (permiso de la extensión), se prueba con el navegador de la app; si tampoco, se lee como texto (ya está leído). Se anota en PROGRESS y se sigue, sin trabarse. La revisión visual de la app se hace con el navegador de la app.
3. **El plano está en la versión 1.4.** Releída: encabezado, §8.1, §8.2, §8.5, F2, F7, F27, F31, F43, F47, F48, F48b, F49, F50, F58 y §15. Donde el archivo y los mensajes coinciden, manda el archivo. V1–V4 (que vienen de la 1.2) coinciden con el archivo. Dos precisiones del archivo:
   - la función de textos se llama `verificationText(docType, label, status, negocio, fecha, código)`;
   - el interruptor dice **"Se puede verificar"**, y el aviso al cambiar de formato es "Este formato no admite verificación".

   La verificación existe solo en **plantillas** impresas, nunca en diseños sueltos.
   - **V1 · Tipo de documento.**
     - `design_templates` suma `doc_type` (CHECK `certificado`, `constancia`, `diploma`, `otro`) y `doc_type_label` (solo con `otro`, de 1 a 40 caracteres).
     - Van en **D2**: no hay migración nueva.
     - CHECKs en la base y validación en la acción: `verify = true` exige `doc_type`, y además `doc_type_label` si es `otro`.
   - **V2 · Verificación solo en formatos impresos.**
     - Solo en `carta_v`, `carta_h`, `a4_v` y `a4_h` (CHECK en D2: `NOT verify OR format IN (…)`).
     - Arranca **apagada en todas** (reemplaza el "prendida por defecto" de F47).
     - En los demás formatos el interruptor no aparece. Si se cambia a un formato no impreso, se apaga sola con aviso.
     - Con IA: si es un certificado, una constancia o un diploma en formato impreso, la IA propone prenderla ("Hacerlo / No").
   - **V3 · Los textos salen del tipo.**
     - El texto del recuadro, los botones ("Emitir constancia") y los avisos salen de la función pura `lib/designer/verification.ts`, con su test (4 tipos × válido/anulado).
     - Variable nueva `design.doc_type` en el catálogo y en las salidas del nodo.
     - Donde el prototipo dice siempre "certificado", manda el plano.
   - **V5 · Conversaciones en tablas genéricas (1.3).** No se crea `design_messages`. D2 crea las genéricas de BAIOS `ai_threads` y `ai_messages`, que también van a usar el tutor del portal y el asistente (ver D2 abajo). La forma de `context` y `result` se valida con Zod por canal, en `lib/ai-threads/schema.ts`.
   - **V6 · El render duerme y hay menos archivos (1.4).**
     - `ssa-render` se crea con **Serverless** en Railway; el cliente y los jobs toleran unos segundos de arranque.
     - **F48: no hay miniaturas.** Guardar una versión no encola renders; lista, historial y selectores dibujan la página 1 en vivo (`renderPageHTML` reducido). `design_templates` y `design_versions` no tienen `thumb_path`.
     - **F48b:** un solo juego de archivos por diseño (re-renderizar borra los anteriores; los de las generaciones nunca se borran), y un job diario `design_cleanup` con la función pura `cleanupPlan`.
   - **V4 · Dominio.**
     - Todo link que ve alguien de afuera se arma con `publicBaseUrl(workspace)` / `loadPublicBaseUrl(db, ws)` de `lib/public-url.ts`: `design.link`, `design.pdf_url`, copiar link, email, descarga y Open Graph.
     - Nunca con `appUrl()`, `NEXT_PUBLIC_APP_URL` ni `window.location.origin` (docs/dominios.md).
     - `lib/public-url.test.ts` sigue en verde, y hay test nuevo con y sin dominio propio del negocio.

## Diferencias entre el plano y el código real (gana el código; se mantiene el comportamiento que pide el plano)

**Base de datos, numeración y relaciones**

| # | El plano dice | El código real | Qué hacemos |
|---|---|---|---|
| 1 | Última migración 00316 | 00317 (`flow_step_metrics`) en el registro de producción y en el repo. Ninguna rama local usa 00318 o más | D1 = **00319**, D2 = **00320**, D3 = **00321**. Se planificaron como 00318–00320, pero el 7/11 a las 21:54 UTC otra sesión (vincular anuncios sin id) registró la `00318_meta_match_rules_similar`: se corrió todo uno |
| 2 | §15: puede haber CHECK de tipos de nodo o de job | **No hay**. Consultado en la base: `scheduled_jobs` solo tiene CHECK de `status`, y los nodos viven en jsonb | No hay 4ª migración |
| 3 | `designs.subject_contact_id → contacts` y `ai_threads.contact_id → contacts` | Toda FK a `contacts` tiene que estar cubierta por la fusión. `verify-contact-merge` falla si no está en `CONTACT_MERGE_TABLES` ni en `CONTACT_MERGE_EXCLUSIONS` | Se sigue el patrón de 00256 (`contacts_known_on_merge`), **sin reescribir `merge_contacts`**:<br>• en D2, trigger `contacts_designs_on_merge`, AFTER UPDATE OF `deleted_at` con `metadata.merged_into`, que reapunta `designs.subject_contact_id` y `ai_threads.contact_id`;<br>• `designs` y `ai_threads` van a `CONTACT_MERGE_EXCLUSIONS` con ese motivo;<br>• `verify-contact-merge` en verde |
| 4 | F6: "`attempts` y `next_attempt_at`" | `scheduled_jobs` no tiene `next_attempt_at`: reintenta moviendo `run_at`, con `MAX_ATTEMPTS=3` y backoff de 10/20 s | D2 suma `designs.next_attempt_at timestamptz NULL`. Los handlers **nunca lanzan**: se reagendan a 1, 5 y 15 min con `scheduleJob`, como `decideAiFailure` (`lib/calls/ai-retry.ts`), y anotan `error` y `attempts` en la fila |

**Jobs, IA y Costos**

| # | El plano dice | El código real | Qué hacemos |
|---|---|---|---|
| 5 | 3 tipos de job (F6) | §9.1 nombra `design_ai_generate` y F48b, `design_cleanup` | Son **5 tipos**: `design_render`, `design_generate_many`, `design_content_sync`, `design_ai_generate` y `design_cleanup`. Se registran en `registerPublishing()` (`lib/publishing/bootstrap.ts`), no en `registry.ts`. Hay que actualizar `lib/jobs/bootstrap-characterization.test.ts` |
| 6 | D3: CHECK de `agent_runs.source` | Última definición en 00148. TS en tres lugares: `AgentRunSource` (`lib/types/database.ts`), `AGENT_RUN_SOURCES` (con guarda de exhaustividad) y `RUN_SOURCE_LABELS` (`lib/agent/run-labels.ts`), comparado con el CHECK en `run-labels.test.ts` | Se suma `designer` en los tres lugares, con rótulo **"Diseñador IA"** (no "Diseños", como dice F38). `SOURCE_COLORS` no se toca: en el gráfico cae en "Otros (sistema)" y en la tabla de Costos sale con su nombre |

**Permisos, menú y rutas**

| # | El plano dice | El código real | Qué hacemos |
|---|---|---|---|
| 7 | F62 pide `content.edit` | No existe. Las claves son `content.create`, `content.approve`, `content.publish` y `content.ai` | Se usa `content.create` + `designer.edit` (las dos las tiene el Member) |
| 8 | M12 solo en `access-matrix` y `member-baseline` | Además fijan el menú o las claves del Member:<br>• `lib/nav/menu-by-role.characterization.test.ts`<br>• `lib/nav/items.test.ts` (lista del Member y orden de grupos)<br>• `lib/auth/member-permissions-characterization.test.ts`<br>• `lib/actions/roles.patch.test.ts` (`toHaveLength(22)` pasa a 24)<br>• en `access-matrix`, `ADDED_TO_MENU` y `ADDED_TO_MENU_MEMBER` | Se actualizan **solo** con el cambio M12, cada uno comentado "Cambio aprobado M12". No se regenera ningún baseline |
| 9 | F4: "las públicas se suman a la lista de rutas sin sesión del `middleware.ts`" | No hay lista: el middleware solo exige sesión en `/dashboard`, así que `/d/` pasa sola | Se suma `d` a:<br>• `RESERVED_ROUTES` (`lib/site/pages.ts`) y `docs/sitio.md`;<br>• `previewBotRule` (`lib/og/robots.ts`);<br>• un caso `/d/…` en `middleware-characterization.test.ts` |
| 10 | Página `web` con "Permitir que aparezca en buscadores" | `robots.txt` bloquea todo salvo las páginas del sitio | Se permite `/d/` en `robots.txt`. Cada página lleva `noindex` salvo una `web` con `allow_indexing`. Los códigos son al azar y no se pueden listar |
| 11 | F43: la página `web` en un iframe con sandbox | `frame-ancestors 'none'` para todo lo que no sea `/calendario`, `/embed` o `/f` | Iframe con **`srcdoc`** y `sandbox` sin `allow-scripts`. No se toca `lib/security-headers.ts` |
| 12 | El ícono del menú es "destello" | `Sparkles` no está en el mapa `ICONS` de `components/sidebar.tsx` | Se suma ahí. Es archivo compartido: lo hace la sesión principal |
| 13 | Editor a pantalla completa | `page-actions.test.ts` exige que cada `page.tsx` esté en `PAGE_META` o en `PAGES_WITHOUT_HEADER` | La lista y los ajustes van a `PAGE_META` (con "+ Nuevo"). Los editores van a `PAGES_WITHOUT_HEADER`, con su motivo |

**Automatizaciones**

| # | El plano dice | El código real | Qué hacemos |
|---|---|---|---|
| 14 | Nodo con `actionType: "designGenerate"` en el registro | No hay campo `actionType`. Un nodo se declara con `type` + `aliases: [{nodeType:"action", actionType}]`. La paleta es un arreglo fijo en `node-palette.tsx` | `type: "designGenerate"` con su alias y un grupo nuevo **"Diseñador IA"** en la paleta. Hay que tocar además:<br>• `simulator.ts` (tiene que contener el literal);<br>• `contact-free.ts`, si corresponde;<br>• `registry.test.ts` (33 nodos pasan a 34, y la lista de `persistsVariables`);<br>• la lista fija de `consistency.test.ts` |
| 15 | F57: "`node-requirements`: sin plantilla no se publica" | `node-requirements` es para conexiones (email, IA, canal), no para configuración | La plantilla obligatoria va como función nueva de problemas en `publishFlow` (`lib/flow-engine/publish.ts`): `designNodeProblems`, con su test |
| 16 | F58: salidas `design.*` para interpolar y para Condiciones | La interpolación lee rutas con punto, pero `variable:design.status` lee la clave plana. El selector de variables no usa `node-outputs`: tiene una lista fija en `getFlowVariables` (`NodeConfigSidebar.tsx`) | Se guarda `variables.design = {id, link, pdf_url, code, status, doc_type}` (las **6** salidas) y se suma `"design."` a `FLOW_VARIABLE_PREFIXES` (`registry/conditions.ts`) y a `CONTACT_FREE_PREFIXES` (`nodes/branch.ts`). Las seis salidas van a `node-outputs.ts` y a `getFlowVariables` |
| 17 | F59: `EmailAttachmentRef` admite `{kind:"design", from:"design"}` | `parseEmailAttachments` descarta en silencio lo que no tiene `assetId`. `loadEmailAttachments` solo lee `response_assets` | `EmailAttachmentRef` pasa a ser una unión (recurso \| diseño), y se adaptan `parseEmailAttachments`, `attachmentBudget`, `emailAttachmentProblems` y `loadEmailAttachments` (rama nueva que busca la generación de la corrida). **Antes**, tests de caracterización que fijan los adjuntos de recursos tal como funcionan hoy |
| 18 | F57: "el panel del canvas que ya existe" | Panel por `actionType` en `panels/ActionPanel.tsx`. La tarjeta se arma con `actionConfig` en `nodes/action-node.tsx` | `case "designGenerate"` con un `DesignGeneratePanel` nuevo, e ícono `Sparkles` en paleta y tarjeta, igual en los dos (`node-icons.test.ts`) |
| 19 | F60: crear el borrador de automatización | Patrón existente: `createFormFlowFromTemplate` + `lib/forms/automation/templates.ts` | Acción nueva que inserta `flows` en borrador con `triggerType: "form_submitted"` y `form_ids: []`, más el nodo y el "Enviar email" |

**Contenido**

| # | El plano dice | El código real | Qué hacemos |
|---|---|---|---|
| 20 | F64: subir con "la función de `content-media.ts`" | Esas son Server Actions con sesión y TUS. El bucket es `content-media`, la ruta `<ws>/<post>/<uuid>.<ext>` y el id se deriva del archivo (`mediaIdFor`) | El job usa el **mismo bucket y la misma forma de ruta**, con nombre de archivo `design-<designId>-<n>.png` (o `-pdf.pdf`), así `mediaIdFor` da el id estable. Arma la entrada con `parseNewMediaEntry` y el cliente de servicio. Para una red programada, "Actualizar los archivos" corre el mismo `planContentResync`/`applyContentResync` |
| 21 | F64: cinco estados por red | `networkStateOf` da `none \| tent \| sched \| pub \| fail`, y el estado de la pieza va aparte | `syncDecision`:<br>• `pub` o publicada a mano → nunca se toca;<br>• `sched` → aviso;<br>• **`fail` → aviso**, la opción conservadora, anotada en PENDIENTE;<br>• lo demás (borrador, en producción, en revisión, aprobada sin fecha) → se actualiza sola |
| 22 | F65: ícono de destello en la tarjeta del tablero | `BoardPost` no tiene ese dato | Se suma `hasDesign` a `BoardPost` y al loader del tablero |

**Dependencias, archivos y notificaciones**

| # | El plano dice | El código real | Qué hacemos |
|---|---|---|---|
| 23 | Sanitizador y zip: reusar si existen | No hay sanitizador como dependencia directa (`sanitizeEmailHtml` es una lista corta para emails, sin CSS). `jszip` solo viene de rebote con `mammoth` | Se suman **`fflate`** y **`sanitize-html`**. Para los tipos de `sanitize-html`, una declaración local `.d.ts`, sin sumar `@types` (regla de dependencias). El CSS se limpia con una función propia y pura |
| 24 | Fuentes validadas por bytes | `sniffMime`/`sniffUploadMime` no reconocen fuentes y no detectan SVG | `sniffFont` nuevo en `lib/designer/fonts.ts`: firmas `wOFF`, `wOF2`, `00010000`/`true` y `OTTO`. Las imágenes solo pasan como PNG, JPG o WebP, así que un SVG se rechaza |
| 25 | Avisar en la campana (F55) | Cada tipo de aviso necesita su lugar en `NOTIFICATION_TYPES`, `NOTIFICATION_DEFINITIONS` y un evento de `preferences.ts` (hay tests que lo exigen) | Tipo `design_generation_failed`, con audiencia `{kind:"admins", permissions:["designer.generate"]}`. Lo hace la sesión principal en la Ola 1 |
| 26 | Historial en `audit_log` | `AuditEntityType` no tiene entidades del Designer | Se suman `design` y `design_template` (solo TS: la tabla no tiene CHECK). Lo ven Owner y Admin con la política de siempre |
| 27 | Variables (F49, DS6) | DS2 (F24, chips y menú) las necesita antes | El **núcleo del catálogo** lo arma la sesión principal en la Ola 1 como contrato: `lib/designer/variables/catalog.ts` (grupos, claves del sistema iguales a `variable-catalog.ts`) y `extensions.ts` (`registerDesignVariables`, `onDesignGenerated`). DS6 completa `resolveValues`, las variables propias, la política si falta un dato y los tests de F49 y F55 |

## Punto de partida (sobre `main` `5a12a81`, hoy)

**Hecho ahora**, en la carpeta principal, que está en `5a12a81` y sin cambios:
- `npx vitest run`: **16.640 tests pasan; 2 archivos fallan al cargar**:
  - `components/automations/step-tree-render.test.ts`;
  - `components/flow-builder/panels/wait-and-once-panels.test.ts`;
  - motivo: en esa carpeta falta instalar `frimousse` (está en `package.json`), no es el código. Se repite después de `npm ci` en el worktree y el número de referencia es ese.
- `npm run lint`: **0 errores, 37 avisos**.
- Huellas `md5(pg_get_functiondef)` (producción):

| Función | Huella |
|---|---|
| `create_sale` | `adb766e6d657bf55db42779c7c53bcb3` |
| `find_or_create_contact` | `a71d6af701ea4460c5309631205de522` |
| `find_or_link_contact` | `0aee03549e9361626ad4720c4a98254a` |
| `submit_form_response` | `78a358d5ac8c4dfebd598bb3f5f91e7c` |

- CHECK vigente, que va a la cabecera de D3: `CHECK ((source = ANY (ARRAY['agent','flow_ai_node','sequence_ai_step','kb_indexing','conversation_summary','message_classification','message_classification_eval','content_copy','ads_analysis','audio_transcription','media_description','call_classification','call_analysis','call_correction','call_summary','call_prompt_test'])))`. Además existe `agent_runs_agent_only_for_agent_sources`, que el Designer cumple porque usa `agent_id NULL`.

**Queda para el paso 0 de la ejecución**, porque el modo plan no deja escribir:
- `npm ci` en el worktree, porque no tiene `node_modules`;
- `npm run build`, que escribe `.next`;
- los **44 `scripts/verify-*.mjs`**, que escriben datos `zz-test-` en la base. Se corren de a uno, con el candado `/private/tmp/ssa-verify.lock` (`mkdir`/`rmdir`, nunca se suelta uno ajeno) y con los flags vigentes:
  - `verify-rls --despues-de-00143 --despues-de-00208`;
  - `verify-roles --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212 --despues-de-00249`;
  - `verify-audit-visibility --despues-de-00168`;
  - `verify-permissions-matrix`;
  - y el resto con los de su sección del CLAUDE.md.

Lo que ya falla se anota y no puede empeorar.

## Migraciones (plano → número real)

| Plano | Número | Qué | Cuándo |
|---|---|---|---|
| D1 | `00319_designer_settings_permissions` | Esto:<br>• `workspaces.design_settings` + `validate_design_settings` (trigger);<br>• `private.member_permission_keys()` redefinida, copiando la de 00250 letra por letra y sumando `designer.view` y `designer.edit`;<br>• buckets privados `design-assets` (20 MB) y `design-renders`, con política SELECT por `has_permission(<ws>, 'designer.view')`;<br>• sin escritura para `authenticated` | Ola 1 |
| D2 | `00320_designer_tables` | **5 tablas**, con RLS SELECT, sin políticas de escritura y con sus `GRANT`:<br>• `design_templates` (+ `doc_type`, `doc_type_label`, `verify` por defecto `false`, CHECKs de V1 y V2; sin `thumb_path`);<br>• `designs` (+ `next_attempt_at`; `renders` sin miniatura);<br>• `design_versions` (solo el `doc`, sin `thumb_path`);<br>• **`ai_threads`** (`channel` CHECK `designer`/`portal`/`assistant`, `agent_id → agents`, `user_id → auth.users`, `contact_id → contacts` ON DELETE SET NULL, `subject_type` CHECK `design`/`design_template`/`product`, `subject_id` sin FK, `title`, `last_message_at`, `archived_at`; índices de §8.2 y único parcial `(subject_type, subject_id) WHERE channel = 'designer'`);<br>• **`ai_messages`** (`thread_id` ON DELETE CASCADE, `role` CHECK `user`/`assistant`, `content`, `attachments`, `context`, `result`, `citations`, `agent_run_id → agent_runs` ON DELETE SET NULL, `feedback` CHECK `up`/`down`; índice `(thread_id, created_at)`).<br><br>**RLS de los hilos, por canal:** `designer` → `has_permission(ws, 'designer.view')`; `assistant` → `user_id = auth.uid()` **y** `is_workspace_member(workspace_id)` (el hilo tiene que ser de un negocio del que la persona es miembro; caso propio en `verify-designer --bloque ds0`); `portal` → sin política todavía (la suma Servicios). `ai_messages` hereda la del hilo con `EXISTS`.<br><br>**Además:**<br>• `private.design_new_code()`;<br>• `validate_design_doc` (trigger);<br>• `design_public_get(code)` (DEFINER, `EXECUTE` para `anon` a propósito, comentado);<br>• trigger de fusión `contacts_designs_on_merge`, que reapunta `designs.subject_contact_id` **y** `ai_threads.contact_id`;<br>• limpieza diaria: `private.enqueue_design_cleanup()` (encola un `design_cleanup` por negocio y por día, **solo si hay candidatas**) + `cron.schedule` diario por SQL directo, como el de Finanzas y Tareas, sin tocar `call_app_cron`. Con las tablas vacías no encola nada, así que es segura antes del deploy;<br>• índices de §8.2 | Ola 1 |
| D3 | `00321_agent_runs_source_designer` | CHECK de `agent_runs.source` + `'designer'`, con el CHECK viejo copiado en la cabecera | Ola 1 |
| D2-fix | `00322_designer_doc_check_fix` | Corrige la 00320: el trigger del documento leía `NEW.format` también en `design_versions` (no tiene esa columna) y ninguna versión se podía guardar; y la limpieza diaria contaba la versión ACTUAL como candidata. Lo detectó `verify-permissions-matrix` antes de que el código nuevo se usara. Misma firma, ninguna tabla | Ola 1 |
| D1-fix | `00324_designer_renders_error_marker` | Suma `application/json` a los tipos de `design-renders`: el `error.json` de una exportación que falla del todo no se podía subir (el bucket solo aceptaba PNG, PDF y ZIP). Lo encontró `verify-designer --bloque ds5`. La 00323 la usó otra sesión (`meta_ads_video_transcript`) | Ola 2 |
| D2-fix | `00325_designer_public_published_doc` | `design_public_get` devuelve el documento de la última versión `publish` (y su cantidad de páginas): una web publicada ya no cambia al guardar con `designer.edit` sin «Publicar» (`designer.publish`). Lo marcó el auditor de la Ola 2. Misma firma y permisos; huella vieja `946a7bca…` en la cabecera | Ola 2 |
| D3-fix | `00326_agent_runs_source_ads_matching_and_designer` | Arregla una regresión de la 00321: redefinió el CHECK de `agent_runs.source` copiando la versión de la 00148 + `designer` y pisó el `ads_matching` que la 00318 (conciliación de anuncios, otra sesión) había sumado 17 minutos antes. Lo encontró `run-labels.test.ts` al poner la rama al día con `main`. Aplicada y registrada el 8/11/2026 (`20261108032503`), ensayada antes en una transacción que se deshizo sola | Ola 5 |

**Aplicadas y registradas el 7/11/2026 (UTC):** 00319 (`20261107220710`), 00320 (`20261107220734`), 00321 (`20261107221149`; el primer intento no llegó a correr por un error de autenticación de la CLI con el pooler, se reintentó) y 00322 (`20261107223521`); en la Ola 2, 00324 (`20261107233050`) y 00325 (`20261108000117`), las dos ensayadas en una transacción que se deshizo sola (la 00325 también con su comportamiento: lo publicado `#ffffff` contra lo editado `#000000`). Las tres primeras se ensayaron juntas y la 00322 sola, cada una en una transacción que se deshizo sola. Las 4 huellas siguen iguales.

**Las tres:**
- son idempotentes;
- llevan cabecera "Cómo volver atrás";
- llevan `GRANT` explícitos (regla 00224);
- las DEFINER llevan `SET search_path = ''` y `REVOKE ALL … FROM PUBLIC, anon` (regla 00276).

**Cómo se aplican:**
1. Primero se ensayan en una transacción que se deshace sola (`begin; … rollback;`).
2. Después `supabase db query --linked -f <archivo>` desde la carpeta principal, que es la vinculada.
3. Se registran con `INSERT` en `supabase_migrations.schema_migrations`.
4. `node scripts/build-all-migrations.mjs`.
5. Su verificación (§2 del plano). Si falla: **PARAR**, anotar en PENDIENTE qué falló y cómo volver atrás, y no seguir.

## Reglas de toda la corrida (confirmadas)

**Construcción y paralelo**
- **Dependencias:**
  - DS2–DS5 dependen de DS0 y DS1;
  - DS6 y DS8 dependen de DS2 y DS5;
  - DS7 depende de DS6;
  - F30 ("que la IA me proponga…") y el paso "Con IA" de F16 necesitan DS3;
  - "Cargar un archivo HTML" de F16 necesita DS4.
- **Si un bloque se traba** después de un intento serio, se anota en PENDIENTE y se sigue con lo que no depende de él. Al final se vuelve a intentar lo trabado.
- **Nunca se debilita** un permiso, un test existente ni una política de RLS para destrabar algo.

**Ritmo de pruebas y commits**
- Después de cada F, los tests del bloque.
- Después de cada integración, `npx vitest run` + `npm run build`, y los `verify-*` del bloque.
- Al cerrar cada ola:
  - auditor;
  - marcar PROGRESS con la prueba de cada F;
  - commit `feat: disenador-ia - ola N (bloques)`;
  - `git push origin feat/disenador-ia`.

**Revisión visual** al cerrar las olas 2, 3 y 4 y al final:
- con el navegador de la app (`preview_start ssa-dev`), a 1440 y a 390 px, en tema claro y oscuro;
- se recorre la lista que pide el prompt y se compara con el prototipo, abierto en Chrome;
- sin sesión iniciada, se anota. Nunca se escriben credenciales.

**Nada externo en los tests**
- Nada de proveedores de IA, Resend, Zernio ni del servicio real.
- La IA se prueba con proveedor simulado y el render con `DESIGNER_FAKE_RENDER=1`.
- En `render/`, `node --test` con el navegador inyectado.

**Seguridad y render**
- El render es uno solo y nunca produce `<script>`.
- Todo HTML de afuera pasa por `sanitize` en el servidor al guardar.
- Sin `dangerouslySetInnerHTML` fuera del render saneado.

**UI**
- La lógica de cada pantalla en `lib/designer/screens/*`, con tests.
- Tokens del tema, sin `dark:`.
- Pestañas, filtros y drawers en la URL.
- Responsive según §11.1.
- Todo arrastre tiene alternativa de teclado.

**Plantilla y marca**
- El módulo viaja sin `@plantilla-quitar`.
- `npx vitest run scripts/plantilla` en 0.
- **Ni código ni tests ni fixtures llevan nombres reales**: "Wendy", "Mardigian", "Scaling Systems", "SSA BAIOS", "@wendymardigian". Se usan nombres genéricos.
- Antes del PR se corre el control de `export-template`.

**Lo que no se toca**
- Los demás nodos, el motor y el simulador (salvo el literal del nodo nuevo).
- Publicar, programar, validar formato y el borrado a 30 días de Contenido.
- Topes y cálculo de costo de IA.
- Los trabajos existentes.
- Las 4 funciones de la huella.

**Infra**
- No se crea nada en Railway ni se cambian variables reales.
- Sin el servicio de render, exportar y generar muestran "Falta conectar el servicio de render" y quedan para reintentar.

## Archivos compartidos (solo los toca la sesión principal)

- **Permisos, menú y rutas:**
  - `lib/auth/permissions.ts` y los tests de M12 (#8);
  - `lib/nav/*`;
  - `components/sidebar.tsx` (ícono);
  - `lib/site/pages.ts`, `lib/og/robots.ts`, `docs/sitio.md`, `docs/roles.md`.
- **Jobs:** `lib/jobs/registry.ts`, `lib/publishing/bootstrap.ts`, `lib/jobs/bootstrap-characterization.test.ts`.
- **Tipos, avisos e IA:**
  - `lib/types/database.ts`, `lib/audit.ts`;
  - `lib/notifications/types.ts` y `preferences.ts`;
  - `lib/agent/runs-query.ts` y `run-labels.ts`.
- **Dependencias, base y documentos del proyecto:**
  - `package.json`, `package-lock.json`;
  - `supabase/migrations/*`;
  - `CLAUDE.md`.
- **Contratos:** `lib/designer/contracts.ts`, `docs/designer/contratos.md` y los archivos de firma o placeholder que se nombran abajo (cada placeholder es de UN solo bloque, que lo reemplaza).
- **Fuera del Designer** (`lib/flow-engine/*`, `components/flow-builder/*`, `lib/email/*`, `lib/content/*`, `components/content/*`), solo el bloque al que le toca: DS7 la sesión principal y DS8 su subagente.

## Contratos (se escriben, commitean y documentan al cerrar la Ola 1)

En `lib/designer/contracts.ts` (solo tipos y reexportaciones) y `docs/designer/contratos.md`:

**1. Documento y render**
- `DesignDoc` y sus tipos (de `lib/designer/doc/schema.ts`), `parseDesignDoc` y `FormatKey`/`FORMATS`.
- `renderPageHTML(doc, pageIndex, {values?, mode, assetUrl})`, más `elementStyle` y `backgroundLayers`.

**2. Servicio de render**
- Cliente `renderDesign(request: RenderRequest): Promise<RenderResult>` y errores `RenderNotConfigured`/`RenderFailed`, en `lib/designer/render-client.ts`.
- Firma compartida `signRenderBody(body, secret, t)`:
  - cabecera `X-Render-Signature: t=<unix s>,v1=<hex HMAC-SHA256 de "<t>.<cuerpo crudo>">`;
  - se rechaza si `t` tiene más de 60 s;
  - **arranque en frío (V6):** el cliente espera hasta 60 s la primera respuesta (el servidor sigue con su tope de 30 s por pedido una vez despierto) y reintenta una vez ante un error de conexión o un 502/503 antes de devolver `RenderFailed`. Lo que siga fallando lo reagenda el job a 1, 5 y 15 min;
  - se copia en `render/sign.mjs`.

**3. Jobs y almacenamiento**
- `enqueueDesignRender({designId|templateId, purpose: "publish"|"export"|"generation", …})`. No hay `"thumb"` (V6).
- Los 5 handlers registrados, que delegan en `lib/designer/jobs/{render,generate-many,content-sync,ai-generate,cleanup}.ts`.
  - `render` y `cleanup` son de la sesión principal. `cleanup` usa la función pura `cleanupPlan(rows, now)` (`lib/designer/cleanup.ts`).
  - El borrado de los archivos anteriores al re-renderizar (F48b) lo suma DS5 sobre `render`, en `replaceRenderSet`.
  - Los otros nacen como stubs que marcan la fila `failed` con "Todavía no está construido" y los reemplaza su bloque.
- Storage: `designAssetPath`, `signedAssetUrl` y `uploadDesignAsset` (validados por bytes).

**4. Variables, verificación y links públicos**
- Núcleo del catálogo y extensiones (#27), ya con `design.doc_type`.
- `lib/designer/verification.ts` (V2 y V3, puro), con:
  - `PRINT_FORMATS`, `canVerify(format)`, `verifyAfterFormatChange(template, newFormat)` (→ `{verify, notice?}`);
  - `docTypeNoun(type, label)`, `verificationText(docType, label, status, negocio, fecha, código)` (nombre del plano 1.4; válido/anulado), `issueButtonLabel(type, label)` ("Emitir constancia"), `verificationNotices(...)`;
  - `validateTemplateVerification({format, verify, doc_type, doc_type_label})`, gemela de los CHECKs de D2 con casos compartidos en `verification.cases.json`, que corren en vitest y contra la base en `verify-designer --bloque ds0`.
- `lib/designer/public-links.ts` (V4): `designPublicUrl(base, code)`, `designDownloadUrl(base, code, {formato, pagina})` y `loadDesignLinks(db, workspaceId, code)`, sobre `publicBaseUrl` / `loadPublicBaseUrl`.
  - Los componentes de cliente reciben la URL ya armada como prop: nunca calculan el origen.
  - Test con y sin `workspaces.scheduling_public_base_url`.
- **Conversaciones (V5):** `lib/ai-threads/schema.ts` (Zod por canal: `designer` → `context: {scope:{page?}}`, `result: {changed_pages, summary}`; `portal` y `assistant` quedan como esquemas mínimos para que los complete su módulo) y `lib/ai-threads/store.ts` (con el cliente de servicio: `getOrCreateDesignerThread(subject)`, `appendMessage`, `listMessages`). Es genérico de BAIOS: lo hace la sesión principal en la Ola 1 y DS3 lo usa.

**5. Server Actions** (`"use server"`, solo funciones async). Las firmas son definitivas. Las de otros bloques devuelven `{ok:false, error:"Todavía no está construido (Ola N)"}`.

| Archivo | Bloque | Funciones |
|---|---|---|
| `lib/actions/designer/designs.ts` | DS2 | crear, guardar con `rev` (→ `{ok}` \| `{conflict, current}`), renombrar, duplicar, archivar, borrar, versiones, restaurar, subir imagen |
| `lib/actions/designer/ai.ts` | DS3 | `startAiDesign`, `sendAiMessage`, `proposeTemplateTexts` (F30), `changeStyle`, `extractStyle` (F37) |
| `lib/actions/designer/import.ts` | DS4 | `importHtml(formData)` → `{id, detected, removed}` |
| `lib/actions/designer/publish.ts` | DS5 | `publishDesign`, `unpublishDesign`, `setPublicOptions`, `requestExport` (→ listo con URL \| en preparación) |
| `lib/actions/designer/generate.ts` | DS6 | `generateOne`, `generateMany`, `retryGeneration`, `regenerate`, `voidGeneration`, `sendGenerationEmail` |
| `lib/actions/designer/content.ts` | DS8 | `useInContent`, `designFromPiece`, `syncToPiece`, `unlinkFromPiece` |
| `lib/actions/designer/automate.ts` | DS7 | `createAutomationFromTemplate` |
| `lib/actions/designer/settings.ts` | DS3 | estilos propios y fuentes (`designer.manage`) |

**6. Puntos de montaje** (componentes placeholder con sus props fijas)

| Componente | Bloque |
|---|---|
| `components/designer/ai/ai-panel.tsx` | DS3 |
| `components/designer/import/html-step.tsx` | DS4 |
| `components/designer/publish/publish-menu.tsx` y `export-menu.tsx` | DS5 |
| `components/designer/generate/{generate-one,generate-many}-modal.tsx` y `generations-tab.tsx` | DS6 |
| `components/designer/content/use-in-content.tsx` | DS8 |
| `components/designer/automate/automate-modal.tsx` | DS7 |

**7. Verificación:** `scripts/verify-designer.mjs` (runner + `--bloque`) y un archivo por bloque en `scripts/verify-designer/verify-<bloque>.ts`, cada uno de un solo dueño.

## Olas y bloques

### Ola 1 — DS0 + DS1 (sesión principal) y R (subagente, en paralelo)

**Subagente R** (`sonnet`, worktree, rama `feat/disenador-ia-render`) — **F5**
- Arranca **en cuanto empieza la ola**: solo depende del formato del pedido (§9.2) y de la firma de arriba, que va escrita en su prompt.
- **Archivos:**
  - `render/package.json` (`playwright` fijado a la versión estable actual, consultada con `npm view` y anotada), `render/Dockerfile` (`FROM mcr.microsoft.com/playwright:v1.<x>-noble`);
  - `render/server.mjs`: `POST /render` (401, 413 y 60 s), `GET /health`, concurrencia 3, 30 s, `javaScriptEnabled:false`, `route` con lista blanca `RENDER_ALLOWED_HOSTS`, `measure`;
  - `render/sign.mjs`, `render/server.test.mjs`, `render/README.md`.
- **Tests:** el navegador se carga con `import()` dinámico e inyectable, así `node --test` corre **sin instalar Playwright ni bajar navegadores**.
- **No toca nada fuera de `render/`.**

**Sesión principal: DS0** (F1–F4, F6, F7)
- **Migraciones:** D1, D2 y D3, con sus verificaciones.
- **Permisos (F1):** las 5 claves en las tres capas, con los 5 pasos de `docs/roles.md`. M12 en `MEMBER_KEYS` y en SQL, y los tests de #8 comentados.
- **Menú y rutas (F4):**
  - ítem en Herramientas (`Sparkles`, `designer.view`);
  - páginas con su guard: `/dashboard/disenos`, `d/[id]`, `t/[id]`, `ajustes` y `/d/[code]` (+ `descargar`), cada una con el contenido mínimo que su bloque va a reemplazar;
  - `page-actions`, `RESERVED_ROUTES` y `robots`.
- **Render y jobs:**
  - `lib/designer/render-client.ts`, con `DESIGNER_FAKE_RENDER`;
  - F6: `design_render` completo (1/5/15 min, `failed` al cuarto intento) y los otros 4 tipos registrados (5 en total), con `bootstrap-characterization.test.ts` extendido;
  - **F48b (limpieza), sesión principal:**
    - `lib/designer/cleanup.ts` con `cleanupPlan(rows, now)` y `cleanup.test.ts`: versión de 29 días queda y de 31 se va; export de 6 días queda y de 8 se va; la versión actual y la última `publish` nunca se van; los archivos de una generación nunca se borran;
    - `lib/designer/jobs/cleanup.ts` (`design_cleanup`, nunca lanza);
    - el cron diario de D2;
  - aviso y entidades de `audit`.
- **Conversaciones (V5):** `lib/ai-threads/{schema,store}.ts` con sus tests.
- **Scripts de verificación existentes** (archivos compartidos, los toca la sesión principal):
  - `verify-rls` suma `ai_threads` / `ai_messages` y las tablas del Designer (RLS prendida, sin escritura para `authenticated`, lectura por canal);
  - `verify-permissions-matrix` suma las tablas con `designer.view` (Owner, Admin, Member, rol con solo la clave y rol sin ella).
- **F7:** `docs/designer/puesta-en-marcha.md`, con **Serverless prendido** en Railway (duerme sin pedidos), las tres variables, `GET /health`, costo, qué pasa si no está y que la primera exportación del día puede tardar unos segundos más.
- **Dependencias:** `fflate` y `sanitize-html` (+ `.d.ts`).
- **`scripts/verify-designer/verify-ds0.ts`:**
  - buckets privados y sus políticas;
  - RLS con Owner, Member y un rol sin `designer.view`;
  - unicidad de 2000 códigos;
  - los CHECKs de V1 y V2 con los casos de `verification.cases.json` (un `verify` en `sq`, sin `doc_type` o con `otro` sin rótulo, se rechaza);
  - `design_public_get` (vacío si no existe, sin `workspace_id` ni datos del sujeto);
  - **RLS por canal de `ai_threads` / `ai_messages`:** un Member con `designer.view` ve los hilos `designer` de su negocio y **no** el `assistant` de otra persona; un hilo `assistant` propio de un negocio del que ya no es miembro tampoco se ve; nadie ve los `portal`; un rol sin `designer.view` no ve los `designer`; el único parcial (un hilo por diseño o plantilla) rechaza el segundo;
  - `enqueue_design_cleanup` no encola nada sin candidatas.

**Sesión principal: DS1** (F8–F14), todo puro en `lib/designer/`, con tests
- `doc/schema.ts` + `doc.cases.json` (≥ 20 casos, compartidos con `validate_design_doc`).
- `formats.ts`.
- `render/page-html.ts`, con la paridad `elementStyle` y sin `<script` / `on…=` / `javascript:`.
- `fonts.ts` (60 familias, `googleCssUrl`, `sniffFont`).
- `color.ts`, `styles.ts` (6 de fábrica) y `canvas-math.ts` (≥ 15 casos).
- `settings-schema.ts` + `settings.cases.json`, gemela de `validate_design_settings`.
- `verification.ts` + `verification.cases.json` (V1–V3) y `public-links.ts` (V4), como contrato.

**Al cerrar la Ola 1**
1. Integrar R: merge, suite, build, y además `cd render && node --test`.
2. Contratos commiteados.
3. Verificar:
   - `verify-rls --despues-de-00143 --despues-de-00208`;
   - `verify-roles --despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212 --despues-de-00249`;
   - `verify-permissions-matrix`;
   - `verify-contact-merge`;
   - `verify-designer --bloque ds0`.
4. Auditor (opus) sobre F1–F14 y F5.
5. Commit y push.

### Ola 2 — 4 subagentes en paralelo

Todos usan `sonnet`, worktree y rama `feat/disenador-ia-dsN`, que sale del tip integrado.

**DS2 — editor manual** (F15–F30)
- **Archivos:**
  - pantallas en `app/(dashboard)/dashboard/disenos/**` (reemplaza el contenido mínimo);
  - `components/designer/{list,new,editor,canvas,layers,element-toolbar,pages,config,variables}/*`;
  - `lib/designer/screens/{list,new-flow,toolbar,selection,layers,element-toolbar,background,variables,pages,history}.ts` con sus tests;
  - `lib/actions/designer/designs.ts`, `lib/designer/queries.ts`.
- **Lienzo:** Pointer Events. Mover, imanes y tamaño **solo** con `canvas-math` (test de frontera). Arrastre de capas y páginas con HTML5 nativo + teclado (no hay `@dnd-kit` en el repo).
- **Usa:** "Con IA" llama a `startAiDesign` (DS3); el paso HTML monta `html-step` (DS4); la barra monta `publish-menu`/`export-menu` (DS5). Deja los lugares de DS6 y DS8.
- **v1.2 (F17 y F28):**
  - en Configuración, el interruptor de verificación y el selector de tipo (+ rótulo con "Otro") solo en formatos impresos (`canVerify`);
  - cambiar de formato aplica `verifyAfterFormatChange` y muestra el aviso;
  - el botón "Emitir …" sale de `issueButtonLabel`;
  - "copiar link" usa la URL que llega del servidor (V4).
- **F48 (en vivo, V6):** la tarjeta de la lista, el historial de versiones (F27) y los selectores dibujan la página 1 con `renderPageHTML` reducido, en un contenedor escalado. Test: **guardar una versión no encola ningún render** (espía sobre `scheduleJob`/`enqueueDesignRender`) y la lista no dispara renders.
- **Verify:** `scripts/verify-designer/verify-ds2.ts` (conflicto de `rev` y que una generación no aparezca en la lista). La revisión visual es la del cierre de ola.

**DS3 — IA** (F31–F38)
- **Archivos:**
  - `lib/designer/ai/{rules,prompt,schema,patch,merge,scope,qa,provider,run}.ts` con sus tests;
  - **la conversación vive en `ai_threads` (`channel = designer`, un hilo por diseño o plantilla) y `ai_messages`**, siempre a través de `lib/ai-threads/store.ts` y validada con `lib/ai-threads/schema.ts`. `ai_messages.agent_run_id` apunta a la corrida. No toca la migración ni los esquemas genéricos: si necesita un campo, lo pide en el informe;
  - `lib/designer/jobs/ai-generate.ts`;
  - `components/designer/ai/*`;
  - `lib/actions/designer/{ai,settings}.ts`;
  - pantalla `/dashboard/disenos/ajustes` (estilos propios y fuentes).
- **Modelo:**
  - `getWorkspaceModel`, prefiriendo Anthropic con visión;
  - `generateObject` + Zod, con un reintento ante un error de validación;
  - `withinWorkspaceBudget` **antes** de llamar;
  - `openAiRun({source:"designer", trigger:"job"|"manual"})`.
- **Tests:** proveedor simulado. Al tope, no se llama al proveedor. Nunca más de 2 pasadas de corrección.
- **v1.2 (V2):** en una plantilla de formato impreso que la IA reconoce como certificado, constancia o diploma, la respuesta trae la propuesta "Prender la verificación como <tipo>" con **Hacerlo / No**. Hacerlo pasa por la acción, que valida con `validateTemplateVerification`. Lleva su test con el proveedor simulado.

**DS4 — cargar HTML** (F39–F42)
- **Archivos:**
  - `lib/designer/import/{zip,sanitize,css,detect,mark-text}.ts` + `fixtures/` (6 HTML) + tests;
  - ≥ 20 ataques en `sanitize.test.ts`;
  - `lib/actions/designer/import.ts`, `components/designer/import/*`.
- **Reglas:** `fflate` sin `..`, sin enlaces simbólicos y hasta 300 archivos. Los recursos van a `design-assets/<ws>/imports/<id>/`, con `asset:<id>`.

**DS5 — publicar y exportar** (F43–F47 y F48b; F48 en vivo es de DS2)
- **Archivos:**
  - `app/d/[code]/{page.tsx,layout.tsx,descargar/route.ts,preview.png/route.ts}`;
  - `lib/designer/public/*`, `lib/designer/export.ts` (`exportPlan`);
  - `lib/actions/designer/publish.ts`, `components/designer/publish/*`;
  - `scripts/verify-designer/verify-ds5.ts`.
- **Reglas:**
  - tope por IP con `checkLimit` (120/min);
  - `noindex`;
  - **sin pie** (decisión 1);
  - `srcdoc` + `sandbox` para `web`;
  - descarga por streaming, con 202 mientras se prepara;
  - Open Graph con la imagen de los archivos de publicar (no hay miniaturas).
- **F48b (un solo juego de archivos):**
  - `replaceRenderSet` en `lib/designer/jobs/render.ts`: al re-renderizar un diseño **propio** (publicar o exportar después de un cambio), sube lo nuevo, actualiza `designs.renders` y recién después borra del bucket los archivos anteriores de ese diseño;
  - **nunca** borra los de una generación;
  - las exportaciones sueltas van a `design-renders/<ws>/<design>/exports/…` para que la limpieza diaria las encuentre;
  - test puro de qué se borra;
  - en `verify-designer --bloque ds5`: después de re-renderizar, en el bucket quedan solo los archivos nuevos de ese diseño.
- **v1.2:**
  - F43/F47: el recuadro sale de `verificationText(docType, label, status, negocio, fecha, código)` según el tipo (válido/anulado);
  - V4: copiar link, descarga, Open Graph (`og:url` e imagen) y "ver como el público" con `loadDesignLinks`;
  - test de la página: con dominio propio, el link usa ese dominio; sin él, el principal.

**Prompt de cada subagente** (resumen). Incluye:
- las rutas completas del plano y del prototipo;
- sus F con el "Bloque listo cuando" literal;
- las reglas de esta corrida (sección de arriba) y la lista de **archivos que no puede tocar** (la de "Archivos compartidos", los contratos y lo de los otros bloques);
- la tabla de diferencias que le corresponde.

Lo que tiene que hacer:
1. `git checkout -b feat/disenador-ia-dsN` desde el tip integrado.
2. `npm ci`.
3. Construir **un commit por F**.
4. Correr los tests del bloque, `npx vitest run` completo y `npm run build`.
5. Devolver el informe: F → archivo + test, la salida de los tests, qué necesita de la sesión principal y qué no pudo hacer.

Lo que nunca hace:
- aplicar migraciones, escribir en la base ni correr `verify-*` (puede escribir su archivo de verify);
- sumar dependencias;
- mergear;
- usar nombres reales.

**Riesgos de choque y cómo se evitan**
- DS2 monta lo de DS3, DS4 y DS5 **solo por import de los placeholders**: cada bloque reemplaza su archivo y nadie edita el de otro.
- Pantallas: DS2 es dueño de `app/(dashboard)/dashboard/disenos/**` salvo `ajustes` (DS3). DS5 es dueño de `app/d/**`.
- Cualquier tipo nuevo que un bloque necesite en el contrato se pide en el informe y lo agrega la sesión principal al integrar.
- **Orden de integración:** DS5 → DS4 → DS3 → DS2 (el editor al final, porque es el que más archivos monta).

**Cierre de la Ola 2**
- `verify-designer --bloque ds5` y el `ds2`.
- Auditor sobre F15–F48b.
- Revisión visual.
- Commit y push.


### Ola 3 — DS6 y DS8 (2 subagentes en paralelo)

**DS6 — plantillas y generaciones** (F49–F56)
- **Archivos:**
  - `lib/designer/variables/{resolve,custom}.ts` + `missing.cases.json`;
  - `lib/designer/jobs/generate-many.ts`;
  - `lib/designer/screens/generations.ts`;
  - `components/designer/generate/*`, `lib/actions/designer/generate.ts`;
  - `scripts/verify-designer/verify-ds6.ts`.
- **Reglas:**
  - "Generar para varios" usa los filtros de Contactos (`prepareContactList` + `applyListClauses`, con el cliente de la persona, como Broadcasts);
  - el email sale por `sendTransactionalEmail` con categoría transaccional (pasa la puerta de suscripción);
  - aviso `design_generation_failed`;
  - copia congelada del documento;
  - código y fecha en la zona del negocio.
- **v1.2:**
  - F49: `design.doc_type` resuelve al nombre del tipo (`docTypeNoun`).
  - F50: el título del modal, el botón ("Emitir constancia" / "Generar para…"), el aviso "Ya tiene una constancia válida…" y los textos de Generaciones salen de `verification.ts`.
  - V4: `{{design.link}}` en el email y el link de cada fila de Generaciones con `loadDesignLinks`. Test con y sin dominio propio.

**DS8 — Contenido** (F61–F66)
- **Archivos:**
  - `lib/designer/content-map.ts`, `lib/designer/content-sync.ts` (`syncDecision`, ids estables), `lib/designer/jobs/content-sync.ts`;
  - `lib/actions/designer/content.ts`, `components/designer/content/*`;
  - en Contenido: botón y grupo "Del diseño" en `piece-drawer.tsx` / `media-uploader`, `hasDesign` en `BoardPost` + `kanban.tsx`, `designGroups`;
  - `scripts/verify-designer/verify-ds8.ts`.
- **Antes de tocar el drawer:** tests de caracterización del drawer y de `media-uploader` como están hoy.
- **Al cerrar:** `verify-content` en 0.

**Riesgo de choque:** los dos tocan la barra del editor solo a través de sus placeholders. DS8 es el único que toca `lib/content/*` y `components/content/*`.

**Cierre de la Ola 3**
- `verify-designer --bloque ds6`, `--bloque ds8` y `verify-content`.
- Auditor F49–F56 y F61–F66.
- Revisión visual (Generaciones, modales y drawer con "Del diseño").
- Commit y push.

### Ola 4 — DS7 (sesión principal) (F57–F60)

1. **Antes de tocar nada:** tests de caracterización de "Enviar email" con adjuntos de recursos: parseo, presupuesto, problemas al publicar y carga.
2. **El nodo y sus salidas:**
   - `lib/flow-engine/nodes/design-generate.ts`, registrado;
   - `design-generate.ts` con `deferFlowNode` + `nextProviderRetry` (1, 5 y 15) y `noteStep` en cada falla;
   - lo de #14, #15, #16 y #18;
   - `node-outputs.ts` con **6 salidas**: `design.id`, `design.link`, `design.pdf_url`, `design.code`, `design.status` y `design.doc_type` (V3). También van a `getFlowVariables` y a la ayuda fija del panel;
   - `design.link` y `design.pdf_url` con `loadDesignLinks` (V4), con test con y sin dominio propio.
3. **El adjunto (#17).**
4. **"Automatizar" (F60):** `lib/actions/designer/automate.ts` + `automate-modal.tsx`.
5. **`scripts/verify-designer/verify-ds7.ts`** de punta a punta, con formulario de prueba y render simulado:
   - con el dato, la generación tiene ese valor;
   - con la respuesta vacía y "No generar", la generación queda `failed`.
6. **Tests:** `lib/flow-engine` completo + `verify-flow-runs` y `verify-flow-metrics`. Una automatización existente corre igual.
7. **Cierre:** auditor F57–F60, revisión visual del panel del nodo, commit y push.

### Ola 5 — X cierre (F67–F70)

1. **Docs (F67):**
   - `docs/designer.md`;
   - secciones nuevas en `docs/flow-registry.md`, `docs/contenido.md` y `docs/roles.md` (M12);
   - sección **"Diseñador IA"** en `CLAUDE.md`: lo que no se puede romper (§9.4 adaptado: sin pie), migraciones aplicadas, próxima libre, y M12 en "Equipo, roles y permisos".
2. **Plantilla (F69):** `npx vitest run scripts/plantilla` y el control de nombres de `export-template`.
3. **Definición de listo**, de a uno:
   - `vitest`, `build`, `lint` (sin errores nuevos);
   - `verify-rls`, `verify-roles`, `verify-content`, `verify-designer` (todos los bloques), `verify-contact-merge`;
   - `node --test` en `render/`;
   - huellas iguales a las del punto de partida.
4. **Revisión visual final (F70)** y reintento de lo trabado.
5. **Auditoría final F1–F70** con un subagente nuevo en Opus. Su tabla se pega en PROGRESS.
6. **PR** `feat/disenador-ia` → `main` con `gh pr create`:
   - resumen de PROGRESS y PENDIENTE y la tabla de la auditoría;
   - sección **"Puesta en marcha"** (Railway `ssa-render`, `RENDER_SERVICE_URL`, `RENDER_SERVICE_SECRET`, `RENDER_ALLOWED_HOSTS`, y que D1–D3 ya están aplicadas).
   - **No se mergea.** Después del PR, `get_status`/`bind_pr`.

## Auditor (al cierre de cada ola)

- Subagente nuevo, `opus`, **sin worktree y solo lectura**, que no construyó nada.
- Recibe: rutas completas del plano y del prototipo, las F de la ola y la tabla de diferencias.
- Devuelve una tabla **F → criterio → prueba (test o comando y su salida) → cumple / falta**.
- Con un "falta" no se pasa de ola: se construye (yo o un subagente), se integra y el auditor lo vuelve a mirar.
- Lo imposible de verdad (por ejemplo, necesita una cuenta real) va a PENDIENTE con el motivo y la decisión.
- Los nice-to-have se construyen igual.

## Primeras tareas de la ejecución (después de tu aprobación)

1. **Paso 0:**
   - `npm ci` en el worktree;
   - `npm run build`;
   - `npx vitest run` (referencia en el worktree);
   - los 44 `verify-*` de a uno con el candado;
   - recorrido del prototipo en Chrome: lista, Nuevo (los 4 caminos), editor, capas, variables, generaciones, link público, nodo y "Usar en contenido".
2. **`docs/PROGRESS-designer.md`:**
   - este plan tal cual;
   - las 5 olas y los 10 bloques con F1–F70 como checklist, cada una con su lugar para "prueba". Los cambios v1.2 van como renglones propios bajo su F:
     - F2/D2 (V1 y V2: columnas y CHECKs);
     - F17 y F28 (interruptor y tipo solo en impresos, aviso al cambiar de formato);
     - F35/F36 en DS3 (la IA propone prenderla);
     - F43 y F47 (recuadro por tipo, apagada por defecto; V4 en link, descarga y Open Graph);
     - **F48** en DS2 (en vivo; guardar una versión no encola renders);
     - **F48b como renglón propio en DS5** (un solo juego de archivos, generaciones intactas);
     - **la limpieza en DS0** (`cleanupPlan` + `design_cleanup` + cron diario de D2), como renglón propio bajo F6;
     - F2/D2 (V5: `ai_threads` / `ai_messages` y RLS por canal) y F31 en DS3 (la conversación en esas tablas);
     - F7 (Serverless);
     - F49 y F50 (`design.doc_type`, botones y avisos por tipo; V4 en el email);
     - F57 y F58 (6 salidas; V4 en `design.link`/`pdf_url`);
   - "Punto de partida" completo;
   - "Migraciones";
   - "Subagentes" (rama, estado, informe, integrado sí/no, auditado sí/no).
3. **`docs/PENDIENTE-designer.md`**, con el formato qué quedó, por qué y qué se decidió. Arranca con:
   - #21 (`fail` → aviso);
   - el pie quitado (decisión 1);
   - `SOURCE_COLORS` sin tocar.
4. Commit `docs: plan del Diseñador IA` y `git push origin feat/disenador-ia`.
5. **FRENO y espero tu `/goal`.**

## Verificación (cómo se sabe que todo está listo)

- **Suite y build:** `npx vitest run` igual o mejor que el punto de partida, y `npm run build` y `npm run lint` sin errores nuevos.
- **Render:** `cd render && node --test` en 0.
- **`verify-*`:** `verify-designer.mjs` con todos sus bloques, más `verify-rls`, `verify-roles`, `verify-permissions-matrix`, `verify-content`, `verify-contact-merge`, `verify-flow-runs` y `verify-flow-metrics`, todos en 0.
- **Huellas:** las 4 iguales a las de arriba.
- **Links:** `lib/public-url.test.ts` en verde. Ningún archivo nuevo del Designer lee `NEXT_PUBLIC_APP_URL`, `appUrl()` ni `window.location.origin` para un link de afuera (lo cubre ese test, más un test de frontera en `lib/designer/public-links.test.ts`).
- **Tests fijos:** `member-baseline` y `access-matrix` solo cambian con M12.
- **Revisión visual:** con capturas a 1440 y a 390 px, en claro y oscuro.
- **Auditoría final:** F1–F70 todas "cumple" o en PENDIENTE con su motivo.

---

## Punto de partida medido (paso 0, 7/11/2026)

En el worktree, después de `npm ci`:

- **`npm run build`**: compila (exit 0).
- **`npx vitest run`**: **1283 archivos y 16.664 tests, todos en verde**. Los 2 que fallaban en la carpeta principal eran solo porque allá falta instalar `frimousse`.
- **`npm run lint`**: 0 errores, 37 avisos.
- **Huellas**: las de la tabla de "Punto de partida" de arriba.
- **Prototipo**: Chrome respondió "extension disconnected" y el navegador de la app solo muestra el archivo como imagen. Se leyó como texto (ver PENDIENTE).

**`verify-*`** desde la carpeta principal (mismo commit `5a12a81`, tiene el `.env`), de a uno con el candado: **37 de 44 en 0**.

| Script | Resultado | Duración |
|---|---|---|
| `verify-account` | ✅ 0 | 18s |
| `verify-ads-attribution` | ✅ 0 | 197s |
| `verify-attribution` | ❌ 1 | 44s |
| `verify-audit-visibility` | ✅ 0 | 57s |
| `verify-booking-concurrency` | ❌ 1 | 93s |
| `verify-broadcasts` | ❌ 1 | 132s |
| `verify-calls` | ✅ 0 | 114s |
| `verify-chat-awaiting` | ✅ 0 | 47s |
| `verify-chat-core` | ❌ 1 | 256s |
| `verify-chat-media` | ✅ 0 | 62s |
| `verify-commissions` | ✅ 0 | 154s |
| `verify-contact-merge` | ✅ 0 | 109s |
| `verify-contact-pipeline` | ✅ 0 | 16s |
| `verify-contacts-single-entry` | ✅ 0 | 40s |
| `verify-content` | ✅ 0 | 29s |
| `verify-crm` | ✅ 0 | 13s |
| `verify-csv-import` | ✅ 0 | 18s |
| `verify-dashboards` | ✅ 0 | 22s |
| `verify-email-subscription` | ✅ 0 | 60s |
| `verify-enrichment` | ✅ 0 | 9s |
| `verify-eod` | ❌ 1 | 372s |
| `verify-expenses` | ✅ 0 | 172s |
| `verify-flow-metrics` | ✅ 0 | 19s |
| `verify-flow-runs` | ✅ 0 | 36s |
| `verify-forms` | ✅ 0 | 531s |
| `verify-inbound-webhooks` | ✅ 0 | 67s |
| `verify-inbox-filters` | ✅ 0 | 74s |
| `verify-knowledge` | ✅ 0 | 12s |
| `verify-message-persistence` | ✅ 0 | 9s |
| `verify-optout` | ✅ 0 | 13s |
| `verify-organic-attribution` | ✅ 0 | 94s |
| `verify-payment-methods` | ✅ 0 | 41s |
| `verify-permissions-matrix` | ✅ 0 | 311s |
| `verify-publishing` | ✅ 0 | 62s |
| `verify-rls` | ✅ 0 | 239s |
| `verify-roles` | ✅ 0 | 131s |
| `verify-sales` | ✅ 0 | 148s |
| `verify-scheduling` | ✅ 0 | 60s |
| `verify-student-schema` | ❌ 1 | 67s |
| `verify-tasks` | ✅ 0 | 196s |
| `verify-unidentified-contacts` | ✅ 0 | 43s |
| `verify-webhook` | ❌ 1 | 0s |
| `verify-whatsapp-groups` | ✅ 0 | 25s |
| `verify-workspace-isolation` | ✅ 0 | 31s |

Fallas que ya estaban antes de tocar nada (no pueden empeorar):
- **`verify-attribution`**: 118 de 3200 contactos reales no tienen "primer toque". Son datos de producción, no código.
- **`verify-booking-concurrency`**: en la ronda 1, de dos pedidos a la vez se creó una reunión y el otro no recibió el rechazo esperado; después la limpieza se cortó por el tiempo máximo de la base.
- **`verify-broadcasts`**: no pudo borrar dos usuarios de prueba al limpiar.
- **`verify-student-schema`**: necesita un Supabase local (`127.0.0.1:55322`) que acá no está corriendo.
- **`verify-webhook`**: prueba el receptor contra la app levantada en `localhost:3000` (ECONNREFUSED).
- **`verify-chat-core`** (382 de 383) y **`verify-eod`**: todas sus comprobaciones pasan; falla solo la limpieza. Borrar un workspace de prueba se corta por el tiempo máximo de sentencia de la base (`canceling statement due to statement timeout`), y una limpieza que falla cuenta como falla. Es el mismo patrón de `verify-booking-concurrency` y `verify-broadcasts`: la base de producción tarda en borrar en cascada. Los restos `zz-test-` los barre la limpieza del siguiente script.

## Checklist F1–F70 (por ola y bloque)

Formato de cada renglón: `- [ ] F — qué` · **prueba:** test o comando y su salida (se completa al construir) · **auditado:** sí/no.

### Ola 1

#### DS0 · Fundaciones (sesión principal)
- [x] F1 — Migración D1 (00319): `design_settings`, claves `designer.*` en tres capas, M12, buckets privados · prueba: `member-sql-parity`, `catalog-usage`, `access-matrix`, `member-baseline`, `member-permissions-characterization`, `roles.patch` (M12) en verde; `verify-designer --bloque ds0` 60/60 (permisos del Member, buckets privados, nadie sube con la sesión, trigger de ajustes); `verify-roles` 0 · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F2 — Migración D2 (00320): `design_templates`, `designs`, `design_versions`, `design_public_get`, códigos · prueba: `verify-designer ds0`: RLS con Owner, Member, rol con solo `designer.view` y rol sin nada; sin escritura con la sesión; 2000 códigos únicos; `design_public_get` (inexistente, borrador, publicado, generación sin datos del sujeto, anulada); `verify-permissions-matrix` (5 tablas); 00322 corrige el trigger de versiones · auditado: cumple (auditor Ola 1, 2ª pasada)
  - [x] F2 / V1–V2 — `doc_type`, `doc_type_label`, `verify` apagada por defecto, CHECK solo impresos y tipo obligatorio · prueba: `verification.test.ts` (18 casos); `verify-designer ds0` corre los mismos casos contra los CHECK de la base · auditado: cumple (auditor Ola 1, 2ª pasada)
  - [x] F2 / V5 — `ai_threads` y `ai_messages`, RLS por canal (designer / assistant / portal), único parcial por diseño · prueba: `lib/ai-threads/schema.test.ts`, `store.test.ts`; `verify-designer ds0` (designer, assistant propio/ajeno, portal, otro negocio, único parcial); `verify-rls` (sección Diseñador IA); `verify-permissions-matrix` (ai_threads y ai_messages) · auditado: cumple (auditor Ola 1, 2ª pasada)
  - [x] F2 / fusión — trigger `contacts_designs_on_merge` (designs + ai_threads) y `CONTACT_MERGE_EXCLUSIONS` · prueba: `merge.test.ts` (la guardia cuenta las exclusiones); `verify-designer ds0` (la generación y el hilo pasan al principal); `verify-contact-merge` 0 · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F3 — Migración D3 (00321): `agent_runs.source` + `designer`; `AgentRunSource`, `AGENT_RUN_SOURCES`, `RUN_SOURCE_LABELS` ("Diseñador IA") · prueba: `lib/agent/run-labels.test.ts` (CHECK = `RUN_SOURCE_LABELS`), guarda de exhaustividad de `AGENT_RUN_SOURCES`; `verify-designer ds0` (el CHECK suma 'designer' y conserva los demás) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F4 — Menú (Herramientas › Diseñador IA, `Sparkles`) y rutas; `/d/` en `RESERVED_ROUTES` y robots · prueba: `lib/nav/items.test.ts`, `menu-by-role.characterization.test.ts`, `page-actions.test.ts`, `lib/site/pages.test.ts`, `middleware-characterization.test.ts` (`/d/…` sin sesión), `lib/designer/guards.test.ts` (404 sin la clave) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F6 — Jobs: 5 tipos registrados, `design_render` con 1/5/15 min y `failed` al 4º · prueba: `lib/designer/jobs/render.test.ts` (1/5/15 min, `failed` al cuarto, sin servicio, imágenes sin firmar se reintentan, exportar prueba de plantilla); `lib/jobs/bootstrap-characterization.test.ts` (5 tipos) · auditado: cumple (auditor Ola 1, 2ª pasada)
  - [x] F6 / limpieza (F48b, parte DS0) — `cleanupPlan` + job `design_cleanup` + cron diario de D2 (solo encola con candidatas) · prueba: `lib/designer/cleanup.test.ts` (29/31 días, 6/8 días, actual, publicada, generación); `verify-designer ds0` (sin candidatas no encola, la actual no cuenta, con candidata encola una vez, cron programado) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F7 — `docs/designer/puesta-en-marcha.md` con Serverless prendido y las tres variables · prueba: `docs/designer/puesta-en-marcha.md` (Serverless, `RENDER_SERVICE_URL`, `RENDER_SERVICE_SECRET`, `RENDER_ALLOWED_HOSTS`) y `.env.example` · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] Contratos — `lib/designer/contracts.ts` + `docs/designer/contratos.md` · prueba: `lib/designer/contracts.ts`, `docs/designer/contratos.md`, 8 archivos de Server Actions con firma definitiva, 9 puntos de montaje; `npx tsc --noEmit` 0 · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] V4 contrato — `lib/designer/public-links.ts` (con y sin dominio propio) · prueba: `lib/designer/public-links.test.ts` (con y sin dominio propio, si la base falla, frontera sin dominio del navegador ni variable) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] V5 contrato — `lib/ai-threads/{schema,store}.ts` · prueba: `lib/ai-threads/schema.test.ts`, `store.test.ts` · auditado: cumple (auditor Ola 1, 2ª pasada)

#### R · Servicio de render (subagente)
- [x] F5 — `render/` (servidor, firma HMAC con marca de tiempo, sin JS, red restringida, `measure`, Dockerfile Playwright); `render-client.ts` con arranque en frío y `DESIGNER_FAKE_RENDER` · prueba: `cd render && node --test` 57/57 (firma 401/60 s, 413, 503, 504, sin JS, red restringida, medición); `lib/designer/render-client.test.ts` (firma igual a la del servicio, copias iguales, simulado, arranque en frío, 401 no reintenta); Playwright 1.65.0, imagen `v1.65.0-noble` (no se construyó: no hay Docker acá) · auditado: cumple (auditor Ola 1, 2ª pasada)

#### DS1 · Documento y render (sesión principal)
- [x] F8 — `DesignDoc` (Zod) + `doc.cases.json` (≥ 20) gemelo de `validate_design_doc` · prueba: `lib/designer/doc/schema.test.ts` (31 casos de `doc.cases.json`); `verify-designer ds0` corre los mismos contra `validate_design_doc` · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F9 — Formatos y zonas seguras · prueba: `lib/designer/formats.test.ts` · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F10 — `renderPageHTML` único, sin `<script>`, paridad con `elementStyle` · prueba: `lib/designer/render/page-html.test.ts` (sin `<script`/`on…=`/`javascript:`, 13 ataques disfrazados, texto escapado, z-index, paridad de 10 elementos, web responsive) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F11 — Tipografías (60 + Google + subidas, `sniffFont`) · prueba: `lib/designer/fonts.test.ts` (60 familias, una URL, pesos ajustados, `sniffFont`, 2 MB) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F12 — Colores y contraste · prueba: `lib/designer/color.test.ts` (21 y 1, capa mínima para contraste) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F13 — Estilos de fábrica (6) · prueba: `lib/designer/styles.test.ts` (6 de fábrica válidos con fuentes curadas) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] F14 — `canvas-math` (≥ 15 casos) · prueba: `lib/designer/canvas-math.test.ts` (21 tests) · auditado: cumple (auditor Ola 1, 2ª pasada)
- [x] V2–V3 contrato — `verification.ts` + `verification.cases.json` (4 tipos × válido/anulado) · prueba: `lib/designer/verification.test.ts` (4 tipos × válido/anulado, botones, avisos, apagado al cambiar de formato) · auditado: cumple (auditor Ola 1, 2ª pasada)

### Ola 2

### Auditoría de la Ola 1 (F1–F14, F5 y contratos) — resultado final

Auditor Opus de solo lectura, dos pasadas (7/11/2026 UTC). **Veredicto final: todo «cumple».**
- **1ª pasada:** 5 «falta»: una forma de saltear la limpieza defensiva del render (F10), un render que daba por buenos links de imágenes sin firmar (F6), el test de «sin permiso, 404» (F4), exportar una plantilla de prueba por su id y un caso de `verify-ds0` sin candidatas. Arreglados en `f3c3031` y `2eee553`.
- **2ª pasada:** todo «cumple». Observaciones no bloqueantes, anotadas en PENDIENTE (limpieza que puede encolar de más, `verify-ds0` sobre toda la base, notas para DS2, DS5 y DS6) o resueltas en olas siguientes (`error.json` con la 00324, generaciones públicas solo `ready`/`void`).
- **Pruebas:** `verify-designer ds0` 60/60, `verify-rls`, `verify-roles`, `verify-permissions-matrix`, `verify-contact-merge` en verde; `render/` 57/57.

#### DS2 · Editor manual (subagente)
> Integrado (`c3697e5`). `verify-designer --bloque ds2`: 27/27. Las pruebas son de `lib/designer/screens/*` (puras) y `lib/actions/designer/designs*.test.ts`.
- [x] F15 — Lista de Diseños y Plantillas · prueba: `screens/list.test.ts` (filtros ↔ URL), `thumbs.test.ts`; verify ds2 (una generación nunca aparece, ni para un Member; contadores) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F16 — Crear (3 pasos, 4 caminos con ilustración) · prueba: `screens/new-flow.test.ts`, `starter-docs.test.ts`, `uploads.test.ts` (SVG rechazado), `lib/actions/designer/designs.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F17 — Barra superior · prueba: `screens/toolbar.test.ts` (`editorActions`: lo que el permiso no da se oculta), `panels.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
  - [x] F17 / V3 — botón "Emitir <tipo>" desde `verification.ts` · prueba: `toolbar.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F18 — Seleccionar y editar texto · prueba: `screens/selection.test.ts`, `variables.test.ts` (texto con fichas), `zoom-keyboard.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F19 — Mover, imanes, tamaño y rotación · prueba: `screens/canvas-session.test.ts`, `zoom-keyboard.test.ts`, `canvas-boundary.test.ts` (el lienzo no calcula posiciones fuera de `canvas-math`) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F20 — Capas · prueba: `screens/layers.test.ts` (reordenar y las 4 acciones; página cargada con `isImportedPage`) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F21 — Barra del elemento · prueba: `screens/element-toolbar.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F22 — Agregar · prueba: `starter-docs.test.ts`, `uploads.test.ts`; panel `editor/add-panel.tsx` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F23 — Fondo y capa de color · prueba: `screens/background.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F24 — Variables en el lienzo · prueba: `screens/variables.test.ts` (`serializeText`/`parseText`, variables propias validadas, `design.code` solo con verificación) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F25 — Páginas · prueba: `screens/pages.test.ts` (máx. 20, la web sin tira) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F26 — Deshacer y rehacer · prueba: `screens/history.test.ts` (un arrastre es un paso) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F27 — Guardar (`rev`) y versiones · prueba: `save.test.ts`, `versions.test.ts`, `designs-ops.test.ts`; verify ds2 (conflict con la misma rev, una versión por sesión de 10 min, restaurar no borra) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F28 — Configuración (drawer) · prueba: `screens/config.test.ts`, `format-change.test.ts`, `designs-ops.test.ts`; verify ds2 (archivar uno publicado confirma y despublica; borrar con generaciones se rechaza) · auditado: cumple (auditor Ola 2, 3ª pasada)
  - [x] F28 / V2 — "Se puede verificar" y tipo solo en impresos; al cambiar a no impreso se apaga con "Este formato no admite verificación" · prueba: `format-change.test.ts`, `config.test.ts` (`updateTemplateSettings` con `verifyAfterFormatChange` + `validateTemplateVerification`) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F29 — Página web · prueba: `screens/web.test.ts` (sin desplazamiento horizontal a 390 px) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F30 — Desde una imagen y en blanco · prueba: `starter-docs.test.ts`, `designs.test.ts` (`createDesign`: imagen de fondo bloqueada «Cubrir»; en blanco con el color de la marca) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F48 — Miniaturas en vivo (`renderPageHTML` reducido); guardar una versión no encola renders · prueba: `designs-ops.test.ts` (espía: guardar no encola salvo un diseño publicado), `thumbs.test.ts`; verify ds2 (guardar y restaurar no encolan) · auditado: cumple (auditor Ola 2, 3ª pasada)

#### DS3 · IA (subagente)
- [x] F31 — La conversación (en `ai_threads` / `ai_messages`, canal `designer`) · prueba: `lib/designer/ai/merge.test.ts`, `requests.test.ts`, `lib/actions/designer/ai.test.ts`, `screens/ai-panel.test.ts`, `ai-panel.test.ts`; todo por `lib/ai-threads/store.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F32 — El motor (proveedor, salida estructurada, reglas) · prueba: `ai/schema.test.ts`, `prompt.test.ts` (zonas seguras y densidad del estilo; el pedido viaja como dato), `patch.test.ts`, `normalize.test.ts`, `run.test.ts` (un reintento ante validación); lo que escribe pasa por `sanitizeAiDoc` + `sanitizeDocHtml` (`doc-sanitize.test.ts`) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F33 — Primera versión · prueba: `jobs/ai-generate.test.ts` (26: con una imagen, `pages[0].background.type = "image"` y capa con opacidad > 0), `run.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F34 — Cambios por página o de todo · prueba: `ai/scope.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F35 — Estilos en la IA · prueba: `run.test.ts` y `ai-generate.test.ts` (cambiar de estilo conserva los textos) · auditado: cumple (auditor Ola 2, 3ª pasada)
  - [x] F35–F36 / V2 — la IA propone prender la verificación (Hacerlo / No) · prueba: `ai/proposals.test.ts`, `requests.test.ts` («Hacerlo» valida con `validateTemplateVerification`), `ai-generate.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F36 — Revisión automática · prueba: `ai/qa.test.ts` (los 5 problemas; nunca más de 2 pasadas), `measure.test.ts`, `run.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F37 — Estilos propios (y pantalla de Ajustes con Fuentes) · prueba: `style-extract.test.ts` (estilo extraído valida, fuente fuera de la lista se corrige), `settings-requests.test.ts`, `lib/actions/designer/settings.test.ts`, `screens/settings.test.ts`, `settings-screen.test.ts`; F11 fuentes en las mismas acciones · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F38 — Costos y topes · prueba: `ai/cost.test.ts`, `ai-generate.test.ts` (con el tope alcanzado NO se llama al proveedor) · auditado: cumple (auditor Ola 2, 3ª pasada)

#### DS4 · Cargar HTML (subagente)
- [x] F39 — Subir (`.html` / `.zip`) · prueba: `import/zip.test.ts` (28: `../evil.html` y 301 archivos se rechazan; absolutas, `\\`, enlaces simbólicos, >50 MB, cifrado), `lib/actions/designer/import.test.ts`, `pipeline.test.ts`, `screens/html-step.test.ts`; tope de 51 MB en `next.config.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F40 — Limpiar (≥ 20 ataques) · prueba: `import/sanitize.test.ts` (54 ataques, comprobados con un lector de etiquetas), `css.test.ts` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F41 — Detectar el formato (6 fixtures) · prueba: `import/detect.test.ts` (2 landings → web, 2 presentaciones 16:9 → wide, carrusel → v45 de 6, ambiguo → web) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F42 — Editar lo cargado · prueba: `import/mark-text.test.ts` (editar un texto marcado cambia solo ese nodo; un parche con `<script>` queda limpio) · auditado: cumple (auditor Ola 2, 3ª pasada)

#### DS5 · Publicar y exportar (subagente)
- [x] F43 — Link público (sin pie) · prueba: `lib/designer/public/{model,serve,guard,boundary}.test.ts` (sin «Hecho con», `sandbox` sin `allow-scripts`, tope por IP, 404 con tiempo parejo; generación solo `ready`/`void`); `verify-designer ds5` 75/75 · auditado: cumple (auditor Ola 2, 3ª pasada)
  - [x] F43 / V3 — recuadro con `verificationText` según el tipo · prueba: `public/model.test.ts` (4 tipos × válido/anulado) · auditado: cumple (auditor Ola 2, 3ª pasada)
  - [x] F43 / V4 — link, copiar link, descarga y Open Graph con `publicBaseUrl` · prueba: `public/share.test.ts` (dominio propio vs. principal) · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F44 — Descargar · prueba: `public/download.test.ts`, `serve.test.ts` (nombre legible, 404 con descarga apagada o anulada, 202 mientras se prepara); `verify-designer ds5` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F45 — Publicar y despublicar · prueba: `publishing.test.ts` (despublicar → 404 en el siguiente pedido, el código se conserva), `publish-actions.test.ts`, `screens/publish-menu.test.ts`; `verify-designer ds5` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F46 — Exportar · prueba: `export.test.ts`, `exporting.test.ts` (incluye `error.json`; 00324 para que el bucket lo acepte), `screens/export-menu.test.ts`; `verify-designer ds5` · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F47 — Verificación y anular (apagada por defecto; CHECK + acción) · prueba: `void.test.ts` (motivo obligatorio, nunca se borra, link «anulado» sin Descargar); CHECK en `verify-designer ds0`; la acción que rechaza `verify` es de DS2 · auditado: cumple (auditor Ola 2, 3ª pasada)
- [x] F48b — Un solo juego de archivos por diseño · prueba: `jobs/render-replace.test.ts`; `verify-designer ds5` (en el bucket quedan solo los archivos nuevos, mirando `storage.objects`) · auditado: cumple (auditor Ola 2, 3ª pasada)

### Auditoría de la Ola 2 (F15–F48b) — resultado final

Auditor Opus de solo lectura, tres pasadas (8/11/2026 UTC). **Veredicto final: todo «cumple»** (lo no construido, en PENDIENTE con motivo y decisión).

- **1ª pasada:** 5 «falta». F42 (la IA no editaba textos de un HTML cargado), F36 (punto ámbar), F17 («Usar en contenido» sin mirar el permiso), «lo que el permiso no da se oculta» (Agregar y el drawer), y guardar un publicado re-renderizaba (un Member cambiaba el link). Se arreglaron en `feat/disenador-ia-ds2-fix` y `-ds3-fix`, más la migración 00325 (una web publicada muestra lo publicado).
- **2ª pasada:** 2 «falta» medios y 1 bajo. La IA todavía podía cambiar una pieza emitida; el render de publicar de una pieza PNG/PDF salía del borrador; faltaba anotar que la IA no edita el CSS de un HTML cargado. Arreglados en `3b8994b`.
- **3ª pasada:** todo «cumple». Pruebas: 1408 tests de `lib/designer`, `lib/actions/designer`, `components/designer` y `lib/ai-threads`; `verify-designer ds2` 27/27 y `ds5` 82/82.
- **Observaciones de la 3ª pasada:** la primera se arregló al cierre (si no se puede leer la última publicación, el render reagenda en vez de usar el borrador, con test). Las otras dos son cosméticas: la carpeta de un render de publicar lleva la `rev` del borrador, y no hay test de una generación con versión `publish` porque no puede pasar.
- **Fuera de la ola:** «volver a generar» de F47 (DS6), «Automatizar» de F17 (DS7), «Usar en contenido», «Dónde se usa › contenido» y el aviso de TikTok (DS8).
- **Revisión visual:** parcial (lista, modal Nuevo, Ajustes y el 404 del link, a 1440 y 390 px, claro y oscuro). El editor y un link publicado con datos quedan en PENDIENTE: requieren crear un diseño en la base real.
- **Incidente:** el 8/11 a la madrugada (UTC) el proyecto de Supabase quedó «Unhealthy» (plan Free, máquina NANO, sin memoria). Pasó a Pro y a Micro; Postgres volvió a las 01:11 UTC. Mientras tanto no se corrió nada contra la base.

### Ola 3

#### DS6 · Plantillas y generaciones (subagente)
> Integrado (`172616a`). `verify-designer --bloque ds6` 53/53. `Actor.userId` admite null (una automatización publica una generación, `07ca021`).
- [x] F49 — Catálogo de variables (+ `design.doc_type`) · prueba: `variables/catalog.test.ts` (claves de Contacto iguales a `variable-catalog.ts`; `design.doc_type` → `docTypeNoun`; `design.issued_on` en la zona del negocio; un origen registrado con `registerDesignVariables`), `variables/resolve.test.ts` (orden: lo pasado, el sujeto, el valor por defecto), `custom.test.ts` · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F50 — Generar para uno ("Emitir <tipo>") · prueba: `generate-ops.test.ts`, `screens/generate-one.test.ts` (pide los obligatorios antes de confirmar; vista previa con `renderPageHTML`), `lib/actions/designer/generate.test.ts`; verify ds6 · auditado: cumple (auditor Ola 3, 2ª pasada)
  - [x] F50 / V3–V4 — textos y avisos por tipo; `{{design.link}}` del email con `publicBaseUrl` · prueba: `generation-email.test.ts`, `screens/generate-one.test.ts` · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F51 — Generar para varios · prueba: `bulk-core.test.ts`, `jobs/generate-many.test.ts` (tandas de 10, máx. 500), `screens/generate-many.test.ts`; verify ds6 (3 contactos, uno con pieza válida y «saltear» → genera 2) · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F52 — La generación (copia congelada) · prueba: `generate-core.test.ts` (38); verify ds6 (cambiar el texto de la plantilla no cambia una generación vieja) · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F53 — Pestaña Generaciones · prueba: `screens/generations.test.ts` (`generationRow` para los 4 orígenes y el estado con su motivo; filtros y contadores; páginas de 50), `generations-query.test.ts`; verify ds6 (quién ve las generaciones) · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F54 — Reintentar · prueba: `generate-ops.test.ts`; verify ds6 (una falla de datos sin completarlos SIGUE pidiendo el dato) · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F55 — Si falta un dato · prueba: `variables/missing.cases.json` (23 casos con las 3 políticas, en `resolve.test.ts`), aviso en la campana en `generate-core.test.ts`; verify ds6 · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F56 — Código y fecha de emisión · prueba: `generate-core.test.ts` (el código es el de la fila; fecha en la zona del negocio); verify ds6 · auditado: cumple (auditor Ola 3, 2ª pasada)

#### DS8 · Contenido (subagente)
> Integrado (`5f69420`) y enganchado (`311f3a0`: guardar, restaurar y la IA encolan la sincronización de un diseño vinculado; «Volver a la pieza»). `verify-designer --bloque ds8` 43/43 y `verify-content --despues-de-00253` «Todo verde». Caracterización del drawer y de `media-uploader` antes de tocarlos (commit `d09cc9e`, intacta).
- [x] F61 — Formatos Contenido ↔ Diseñador · prueba: `lib/designer/content-map.test.ts` (56: las combinaciones y PNG por página o un PDF) · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F62 — Diseñar desde la pieza · prueba: `content-request.test.ts` (guion de 5 partes + Instagram Carrusel → `v45`, las 5 partes en el pedido), `content-link.test.ts`, `lib/actions/designer/content.test.ts`, `piece-drawer.designer.test.ts`, `screens/toolbar.test.ts` («Volver a la pieza») · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F63 — "Usar en contenido" · prueba: `screens/use-in-content.test.ts`, `components/designer/content/use-in-content.test.ts`; verify ds8 (pieza nueva en Borrador con los archivos en su biblioteca y elegidos EN ORDEN) · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F64 — Sincronizar archivos (`syncDecision`, ids estables) · prueba: `content-sync.test.ts` (los 5 estados, ids estables), `jobs/content-sync.test.ts` (37), `designs-ops.test.ts` (guardar uno vinculado encola con 30 s); verify ds8 (ids iguales al re-sincronizar, publicada intacta, programada solo avisa) · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F65 — Lo que se ve en Contenido · prueba: `lib/content/piece-designs.test.ts` (`designGroups` por `design_id`), `kanban.designer.test.ts` (destello), `load-piece-designer.test.ts`, `load-designed.test.ts`; los tests de Contenido existentes en verde · auditado: cumple (auditor Ola 3, 2ª pasada)
- [x] F66 — Lo que no cambia en Contenido · prueba: `lib/designer/content-unchanged.test.ts` (14), caracterización intacta, `verify-content` verde; verify ds8 (desvincular y archivar no borran archivos) · auditado: cumple (auditor Ola 3, 2ª pasada)

### Auditoría de la Ola 3 (F49–F56, F47 de DS6, F61–F66) — resultado final

Auditor Opus de solo lectura, dos pasadas (8/11/2026 UTC). **Veredicto final: todo «cumple».**
- **1ª pasada:** 16 criterios implementados y probados; 3 «falta» chicos de la regla «lo que el permiso no da se oculta» y del texto del plano: «Usar en contenido» sin mirar `content.create`, el aviso «El diseño cambió» con botones para quien no puede actuar, y el selector «Contacto / <origen>». Una observación de seguridad: emitir para una persona no respetaba el alcance de leads. Todo arreglado en `d814f76` (el selector queda en PENDIENTE como tarea de Servicios).
- **2ª pasada:** los 4 puntos «cumple».
- **Pruebas contra la base:** `verify-designer ds6` 53/53, `ds8` 43/43, `verify-content` «Todo verde».
- **Para confirmar con Wendy (en PENDIENTE):** carta vertical y presentación disponibles solo como «Carrusel PDF» de LinkedIn.
- **Revisión visual:** la de Generaciones, los modales de emitir y el drawer de la pieza con «Del diseño» requiere crear datos en la base real; queda con la del editor (PENDIENTE, «Revisión visual de la Ola 2»).

### Ola 4

#### DS7 · Automatizaciones (sesión principal)
> Adelantado durante la Ola 2 (7/11/2026). `verify-designer --bloque ds7` 16/16 (8/11/2026, con el núcleo de DS6): con el dato del formulario la generación lleva ese nombre, origen `automation` con la sesión, lista con el render simulado y las seis salidas; el email adjunta su PDF; con la respuesta vacía y «No generar» el camino termina con «Falta: …» y la generación queda `failed`; el borrador de «Automatizar» pasa la validación salvo el formulario. Una automatización existente corre igual: `lib/flow-engine` completo en verde, `verify-flow-runs` y `verify-flow-metrics` «Todo en orden» (8/11/2026). Falta: el auditor y la revisión visual del panel.

- [x] F57 — Nodo "Generar desde plantilla" · prueba: `lib/flow-engine/nodes/design-generate.test.ts` (9: el valor de la respuesta, el origen `automation` con la sesión, «No generar» corta con «Falta: …», reintento de la MISMA generación a la hora del render, existente, nunca lanza), `lib/designer/automation/node-config.test.ts`, `node-requirements.test.ts` («sin plantilla no se publica»), `registry.test.ts` (34 nodos, alias `action/designGenerate`, persiste variables), `consistency.test.ts` (simulador), `node-icons.test.ts` (Sparkles en paleta y lienzo); panel `components/flow-builder/panels/DesignGeneratePanel.tsx`; `scripts/verify-designer/verify-ds7.ts` escrito · auditado: cumple (auditor Ola 4, 2ª pasada)
- [x] F58 — Salidas del nodo (6, con `design.doc_type`) · prueba: `node-outputs.test.ts` (las seis con su rótulo; Condiciones las ofrece DESPUÉS del paso y no antes), `design.` en `FLOW_VARIABLE_PREFIXES` y `CONTACT_FREE_PREFIXES`, `getFlowVariables` · auditado: cumple (auditor Ola 4, 2ª pasada)
  - [x] F58 / V4 — `design.link` y `design.pdf_url` con `loadDesignLinks` · prueba: `design-generate.test.ts` («deja las seis salidas con los links del dominio del negocio»); con y sin dominio propio lo cubre `lib/designer/public-links.test.ts` · auditado: cumple (auditor Ola 4, 2ª pasada)
- [x] F59 — Adjuntar el PDF en "Enviar email" (caracterización antes) · prueba: `lib/email/attachments-characterization.test.ts` (escrito ANTES, commit 2a858ba, intacto), `lib/flow-engine/nodes/send-email-design.test.ts` (7: con la generación lista se adjunta; sin generación falla con «No hay un diseño generado en esta automatización.»; sin estar lista espera 1/5/15; otro negocio no), `send-email.test.ts` en verde, publicar sin un «Generar» antes se frena · auditado: cumple (auditor Ola 4, 2ª pasada)
- [x] F60 — "Automatizar" desde la plantilla · prueba: `lib/designer/automation/flow-template.test.ts` (el borrador pasa la validación salvo «Falta elegir el formulario.»); acción `lib/actions/designer/automate.ts`; modal `components/designer/automate/automate-modal.tsx` · auditado: cumple (auditor Ola 4, 2ª pasada)
  - Decisión: un flujo que genera diseños con un disparador de formulario SIN formulario elegido no se publica (vacío = cualquier formulario: emitiría certificados por una encuesta). Solo aplica a flujos con «Generar desde plantilla».
  - Decisión: si el contacto ya tiene una pieza válida de esa plantilla (`reason: "existing"`), el flujo sigue con ESA (no se anula ni se emite otra).


### Auditoría de la Ola 4 (F57–F60) — resultado final

Auditor Opus de solo lectura, dos pasadas (8/11/2026 UTC). **Veredicto final: todo «cumple».**
- **1ª pasada:** los criterios literales y V4 cumplían; una falla media (el paso podía lanzar: `return renderNow` sin `await` dentro del `try`, y `deferFlowNode` lanza si no puede guardar el reintento) y cuatro bajas (el verify sin un formulario de verdad, un render `skipped` dejaba la generación trabada, «ya tenía uno» decía siempre «Lista», el selector sin rótulos). Arregladas en `5023dba` y `e8266a6`.
- **2ª pasada:** todo «cumple». Encontró una baja nueva (una pieza ajena pendiente podía renderizarse en paralelo con su propio render): arreglada al cierre, una pieza que no creó el paso solo se mira y se espera, con test.
- **Pruebas:** `verify-designer ds7` 21/21; `verify-flow-runs` y `verify-flow-metrics` «Todo en orden»; caracterización de los adjuntos de Recursos intacta (un solo commit).
- **Revisión visual del panel del nodo:** requiere abrir el lienzo de una automatización en la base real (el lienzo guarda un borrador): queda con la del editor en PENDIENTE.

### Ola 5

#### X · Cierre (sesión principal + auditor)
- [x] F67 — Documentación y sección en `CLAUDE.md` · prueba: `docs/designer.md` (piezas, permisos M12, lo que no se puede romper con las 7 reglas de §9.4, variables y su punto de extensión, reglas de la IA, datos, jobs, verificación), secciones en `docs/flow-registry.md`, `docs/contenido.md` y `docs/roles.md` (M12 y las 5 claves), sección «# Diseñador IA» del `CLAUDE.md` y M12 en «Cambios del Member», `docs/designer/contratos.md` (estado final), `docs/designer/puesta-en-marcha.md` · auditado: auditoría final (los huecos que marcó se completaron)
- [x] F68 — `verify-designer.mjs` (todos los bloques) · prueba: corrida completa de cierre `verify-designer` EXIT 0 (ds0, ds2, ds5, ds6, ds7, ds8; render simulado) · auditado: cumple (auditoría final)
- [x] F69 — Plantilla clonable · prueba: `npx vitest run scripts/plantilla` 82/82; `export-template` común limpio (4.507 archivos, sin restos identificables); ningún `@plantilla-quitar` en el módulo; punto de extensión de variables vacío; sin nombres reales. El perfil de estudiantes queda para la sincronización de BAIOS (PENDIENTE, «Cierre (Ola 5)») · auditado: cumple (auditoría final)
- [x] F70 — Revisión visual y responsive · prueba: parcial (lista, modal Nuevo con sus 3 pasos y el paso Archivo, Ajustes y el 404 del link, a 1440 y 390 px, claro y oscuro; se arregló el título truncado); lo demás anotado en PENDIENTE («Cierre (Ola 5): revisión visual») con motivo y decisión · auditado: anotado (auditoría final)

## Definición de listo: corrida de cierre (8/11/2026 UTC)

- `npx vitest run`: **1413 archivos y 18.774 tests en verde** (con la rama al día con `main`, `09eb4d1`, y la 00326).
- `npm run build`: compila. `npm run lint`: 0 errores, 37 avisos (los mismos del punto de partida).
- `render/`: `node --test` 57/57. `npx vitest run scripts/plantilla`: 82/82. `export-template` común: limpio.
- Huellas de `create_sale`, `find_or_create_contact`, `find_or_link_contact` y `submit_form_response`: **iguales** al punto de partida.
- `verify-*` de a uno con el candado (las 37 que pasaban al empezar + `verify-designer` entero): **38 de 38 en 0**. La primera corrida dio 5 en rojo (`ads-attribution`, `commissions`, `expenses`, `organic-attribution`, `payment-methods`) por la huella y las reglas de `resolve_meta_match`. Las había cambiado la 00318 (conciliación de anuncios, ya en `main`) y esta rama todavía tenía los scripts viejos. Con la rama al día con `main`, las 5 dan 0. Al poner la rama al día apareció además la regresión del CHECK de `agent_runs.source` (00326).
- Las 7 que fallaban al empezar (`attribution`, `booking-concurrency`, `broadcasts`, `chat-core`, `eod`, `student-schema`, `webhook`) no se corrieron: son fallas previas que no tocan el módulo.

| Script | Resultado | Duración |
|---|---|---|
| `verify-designer` | ✅ 0 (2ª corrida, con la rama al día con `main`) | 222s |
| `verify-rls` | ✅ 0 | 126s |
| `verify-roles` | ✅ 0 | 96s |
| `verify-permissions-matrix` | ✅ 0 | 206s |
| `verify-content` | ✅ 0 | 22s |
| `verify-contact-merge` | ✅ 0 | 100s |
| `verify-forms` | ✅ 0 | 261s |
| `verify-flow-runs` | ✅ 0 | 16s |
| `verify-flow-metrics` | ✅ 0 | 7s |
| `verify-workspace-isolation` | ✅ 0 | 11s |
| `verify-account` | ✅ 0 | 9s |
| `verify-ads-attribution` | ✅ 0 (2ª corrida, con la rama al día con `main`) | 172s |
| `verify-audit-visibility` | ✅ 0 | 17s |
| `verify-calls` | ✅ 0 | 62s |
| `verify-chat-awaiting` | ✅ 0 | 33s |
| `verify-chat-media` | ✅ 0 | 16s |
| `verify-commissions` | ✅ 0 (2ª corrida, con la rama al día con `main`) | 84s |
| `verify-contact-pipeline` | ✅ 0 | 14s |
| `verify-contacts-single-entry` | ✅ 0 | 31s |
| `verify-crm` | ✅ 0 | 7s |
| `verify-csv-import` | ✅ 0 | 6s |
| `verify-dashboards` | ✅ 0 | 13s |
| `verify-email-subscription` | ✅ 0 | 44s |
| `verify-enrichment` | ✅ 0 | 6s |
| `verify-expenses` | ✅ 0 (2ª corrida, con la rama al día con `main`) | 86s |
| `verify-inbound-webhooks` | ✅ 0 | 42s |
| `verify-inbox-filters` | ✅ 0 | 11s |
| `verify-knowledge` | ✅ 0 | 5s |
| `verify-message-persistence` | ✅ 0 | 5s |
| `verify-optout` | ✅ 0 | 9s |
| `verify-organic-attribution` | ✅ 0 (2ª corrida, con la rama al día con `main`) | 72s |
| `verify-payment-methods` | ✅ 0 (2ª corrida, con la rama al día con `main`) | 22s |
| `verify-publishing` | ✅ 0 | 38s |
| `verify-sales` | ✅ 0 | 125s |
| `verify-scheduling` | ✅ 0 | 41s |
| `verify-tasks` | ✅ 0 | 162s |
| `verify-unidentified-contacts` | ✅ 0 | 11s |
| `verify-whatsapp-groups` | ✅ 0 | 16s |

## Auditoría final F1–F70 (8/11/2026 UTC)

Auditor Opus nuevo, de solo lectura, dos pasadas sobre `566f58b` y `9b9a59f`. **Veredicto final: F1–F70 sin ningún «falta»** (lo no construido o no revisado está en PENDIENTE con motivo y decisión).

| F | Criterio (resumido) | Prueba | Resultado |
|---|---|---|---|
| F1 | Member con view y edit (no publish); sin sesión no se lee `design-renders`; tests de M12 | `verify-ds0`; `member-sql-parity`, `access-matrix` | cumple |
| F2 (+V1, V2, V5, fusión) | `design_public_get` sin datos del sujeto; 2000 códigos; RLS por rol; CHECK de verificación; `ai_threads` por canal; trigger de fusión | `verify-ds0`; `verification.cases.json` en vitest y en la base; `verify-contact-merge` | cumple |
| F3 | CHECK de `agent_runs.source` con `designer` | `run-labels.test.ts` | cumple |
| F4 | Menú y rutas; 404 sin `designer.view`; `/d/` sin sesión | `guards.test.ts`, `middleware-characterization` | cumple |
| F5 | Firma igual en las dos copias; 401; sin JS; red restringida; topes | `render-client.test.ts`; `render/` 57/57 | cumple |
| F6 (+limpieza) | 5 jobs; 1/5/15 y `failed` al cuarto; `cleanupPlan` y cron diario | `jobs/render.test.ts`, `cleanup.test.ts`, `verify-ds0` | cumple |
| F7 | Puesta en marcha (Serverless, 3 variables) | `docs/designer/puesta-en-marcha.md` | cumple |
| F8–F14 | Documento (31 casos), formatos, render único sin `<script>`, fuentes, color, estilos, `canvas-math` (21) | sus tests | cumple |
| F15–F30 (+V2, V3) | Editor manual completo | `lib/designer/screens/*.test.ts`, `designs-ops.test.ts`, `verify-ds2` 27/27 | cumple |
| F31–F38 (+V2) | IA: fusión, esquema y prompt, primera versión, alcance, estilos, revisión (≤ 2 pasadas), estilos propios, tope | `ai/*.test.ts`, `ai-generate.test.ts` | cumple |
| F39–F42 | Zip, 54 ataques, 6 fixtures, editar un nodo | `import/*.test.ts` | cumple |
| F43–F47 (+V3, V4) | Link público, descarga, publicar, exportar, anular | `public/*.test.ts`, `publishing`, `export`, `void`; `verify-ds5` 82/82 | cumple |
| F48, F48b | Guardar no encola renders; un solo juego de archivos | `designs-ops.test.ts`, `render-replace.test.ts`, `verify-ds5` | cumple |
| F49–F56 (+F47 DS6) | Variables, emitir para uno y para varios, copia congelada, Generaciones, reintentar, si falta un dato, código | `variables/*`, `generate-*`, `generations.test.ts`; `verify-ds6` 53/53 | cumple |
| F57–F60 (+V4) | Nodo, seis salidas, PDF adjunto, Automatizar | `design-generate.test.ts`, `node-outputs`, `send-email-design`, `flow-template`; `verify-ds7` 21/21 | cumple |
| F61–F66 | Contenido | `content-*.test.ts`, caracterización intacta; `verify-ds8` 43/43, `verify-content` | cumple |
| F67 | Docs y sección del CLAUDE.md (las 7 reglas de §9.4) | `docs/designer.md`, `flow-registry`, `contenido`, `roles`, `CLAUDE.md`, `contratos.md` | cumple (2ª pasada) |
| F68 | `verify-designer` por bloque | corrida de cierre EXIT 0 con los 6 bloques | cumple |
| F69 | Plantilla clonable | `scripts/plantilla` 82/82; export común limpio; perfil de estudiantes en PENDIENTE (sincronización de BAIOS) | cumple |
| F70 | Revisión visual | parcial; el resto en PENDIENTE con motivo y decisión | cumple (anotado) |

Observaciones que no bloquean: «Las reglas de la IA» de `docs/designer.md` es un resumen fiel de `rules.ts`, no una copia literal (deja afuera la numeración «N/M», la composición sobria de los impresos y la línea de la página web); la revisión visual de las pantallas con datos sigue pendiente y necesita el OK para crear datos de prueba.

## Subagentes

| Subagente | Rama | Estado | Informe | Integrado | Auditado |
|---|---|---|---|---|---|
| R (render) | `feat/disenador-ia-render` | terminado (`7c2d34e`) | F5 completo, 57 tests; Playwright 1.65.0; Docker sin probar (no hay Docker) | sí (merge en la Ola 1) | sí (auditor Ola 1) |
| DS2 | `feat/disenador-ia-ds2` (+ `-ds2-fix`) | terminado (`9f73da7`, `eaa0cb5`) | F15–F30, F48; verify-ds2 27/27 | sí (`c3697e5`, `2c47b49`) | sí (Ola 2) |
| DS3 | `feat/disenador-ia-ds3` | terminado (`a3406c2`) | F31–F38, F11, V2; 17.257 tests en su rama | sí (`063d970`, `8940152`; `sanitizeAiDoc` enganchado a `sanitizeDocHtml`) | sí (Ola 2) |
| DS4 | `feat/disenador-ia-ds4` | terminado (`978d3a8`) | F39–F42, 54 ataques | sí (`2365ee6`; tope de 51 MB y `@import` primero) | sí (Ola 2) |
| DS5 | `feat/disenador-ia-ds5` | terminado (`d65b6b2`) | F43–F47, F48b; verify-ds5 75/75 tras la 00324 | sí (`002ec98`; acciones propias en el historial) | sí (Ola 2) |
| DS6 | `feat/disenador-ia-ds6` | terminado (`28ffb5d`) | F49–F56; verify-ds6 53/53 | sí (`172616a`, `07ca021`) | sí (Ola 3) |
| DS8 | `feat/disenador-ia-ds8` | terminado (`f9ab062`) | F61–F66; verify-ds8 43/43, verify-content verde | sí (`5f69420`, `311f3a0`) | sí (Ola 3) |
| Auditor ola 1–5 | — (solo lectura, Opus) | terminado | Ola 1 (2 pasadas), Ola 2 (3), Ola 3 (2), Ola 4 (2), final F1–F70 (2): todo «cumple» | — | — |
