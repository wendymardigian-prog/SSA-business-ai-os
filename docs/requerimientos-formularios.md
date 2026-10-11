# Requerimientos: Formularios (Extra C) — personalizado, encuesta/NPS y contrato

**Proyecto:** SSA Business AI OS · **Paso:** 05-Requerimientos (brownfield) · **Versión** 1.1, 10 de octubre de 2026 (v1.1: suma el **Bloque FO4** — páginas públicas del sitio con formularios, prellenado configurable por campo y atribución completa y persistente) · **Anclado a:** `alcance-v7.md` (v7.2) · **Para:** Claude Code, bloque por bloque

**Módulo 2 de 5** del orden de la v7 (Llamadas → **Formularios** → Ventas → CX → Gastos). Cubre los bloques **FO1, FO2, FO3 y FO4** (alcance §1 y §2.2), los flujos **3.3, 3.4 y 3.5** y las decisiones **154 a 159** y **182 a 186**.

---

## 0. Cómo usar este documento

Este es el plano completo del módulo de Formularios: **4 bloques** y **33 funcionalidades** (F1 a F33). Se construye en orden, bloque por bloque. Cada bloque cierra con una condición de "listo" verificable por máquina.

### 0.1 Requisitos previos (no arrancar sin esto)

1. **Llamadas está construido y mergeado a `main`** (rama `feat/llamadas`). De Llamadas se usan, **sin crearlos de nuevo**:
   - `audit_log.actor_type` (`user|agent|system|webhook`, default `'user'`), `audit_log.actor_label` y el índice `(workspace_id, entity_type, entity_id, performed_at desc)`.
   - Los helpers de `lib/audit.ts`, que reciben un objeto: `auditAsSystem({ ...args, label })` y `auditAsWebhook({ ...args, label })`.
   - El componente `<Historial entityType entityId />`.
   - **Confirmado por la coordinación (10/10/2026): los tres existen** (`audit_log.actor_type`, `actor_label`, `auditAsSystem({ ...args, label })`/`auditAsWebhook({ ...args, label })` en `lib/audit.ts` y `<Historial/>`). Se usan tal cual; no se crean acá.
2. **`main` actualizado.** Verificado el 10/10/2026: las ramas `perf/navegacion` y `feat/tareas-ia-estandar` ya están mergeadas (PR #35 y #36) y la `00128` y la `00136` ya están aplicadas (versiones `20261010201712` y `20261010195152`).
3. **Trámite externo del día 1:** crear el sitio en **Cloudflare Turnstile** (gratis) con el dominio de la app y el de cada landing donde se vaya a embeber, y tener a mano la *site key* y la *secret key*. Para desarrollo y para los scripts se usan las **claves de prueba oficiales de Cloudflare** (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`, que siempre aprueban; y `2x0000000000000000000000000000000AA`, que siempre rechaza).
4. **Resend conectado** (ya lo está: `integration_configs` tipo `email_provider`). Sin Resend, el contrato se firma igual y la copia queda "no enviada" con botón de reenviar.
5. **La decisión de la librería de PDF aprobada** (§1b y §12: `pdf-lib@1.17.1`, nueva dependencia). Si no se aprueba, el Bloque FO3 se construye sin F27 y queda anotado.
6. Backup del día de la base.
7. El plano se guarda sin cambios en `docs/requerimientos-formularios.md`.

### 0.2 Rama y reglas de la corrida

- **Rama:** `feat/formularios`, creada desde `main` actualizado.
- **Migraciones:** banda **00150–00157**. Antes de escribir la primera, `list_migrations` (MCP de Supabase) o `select name from supabase_migrations.schema_migrations order by version desc limit 5`. Si la banda está ocupada, se corre entera al primer libre, en orden y sin saltear. Todas idempotentes (`IF NOT EXISTS`, `DO $$ … $$`), funciones con `SET search_path = ''`, RLS en toda tabla nueva. Después de cada una, `node scripts/build-all-migrations.mjs`. Se aplican con `supabase db query --linked -f <archivo>` y se registran en `supabase_migrations.schema_migrations` (la CLI no registra sola).
- **Para ampliar un CHECK existente** (`triggers.type`, `integration_configs.type`): `DROP` + `ADD` con la lista **completa leída de la base en el momento de escribir la migración** (`select pg_get_constraintdef(oid) from pg_constraint where conname = '…'`), más los valores nuevos. **Nunca de memoria**: Llamadas suma `call_analyzed` y `call_linked` antes que este módulo y una lista escrita de memoria los borraría.
- **Turnstile y Resend van simulados en los tests** (`vi.fn()` sobre `fetch`; `vitest.setup.ts` ya bloquea el `fetch` real). Los scripts `verify-*.mjs` usan las claves de prueba de Cloudflare.
- **Lógica de pantalla en funciones puras** (`lib/forms/**`) con sus tests de Vitest. Los componentes solo componen esas funciones. No se suma ninguna herramienta de testing.
- **Archivos `"use server"`:** todo lo exportado es `async` (lo controla `lib/vault-boundary.test.ts`). Ningún Client Component puede llegar a `lib/vault.ts`.
- **Tests y commits:** después de cada funcionalidad, `npx vitest run`. Después de cada bloque, `npm run build`, `npm run lint`, los `verify-*.mjs` del bloque, marcar `docs/PROGRESS.md` y commit `feat: formularios - bloque FOn (nombre)`.
- **Revisión visual:** al cerrar cada bloque con pantallas, recorrerlas con el navegador de Claude Code en escritorio y en 390 px (sin scroll horizontal, estados vacío y error). Si no hay sesión iniciada, se anota en `docs/PENDIENTE.md`. **No** forma parte de la definición de listo.
- **Bloqueos:** si algo queda trabado después de un intento serio, se anota en `docs/PENDIENTE.md` y se sigue.
- **Nada periódico nuevo por fuera de la cola:** los reintentos del PDF y del email del contrato (5/15/30 min) son filas de `scheduled_jobs` con `run_at` y `dedupe_key`, que ya procesa el cron existente. Este módulo **no agrega ningún cron** ni ninguna ruta a `private.call_app_cron`. Si en el futuro hiciera falta algo periódico, sería `pg_cron` llamando a una función SQL que encola en `scheduled_jobs`.
- **Historial:** este módulo **no suma lectura** sobre `audit_log` (D15). Si un módulo posterior quisiera que los Members vean el historial de formularios o respuestas, la convención es una política de SELECT **adicional y permisiva** (`audit_log_select_forms`), nunca reescribir `audit_log_select`.
- **Lo que NO se toca nunca** (§4.2): `find_or_link_contact`, `create_booking`, `record_contact_touch`, el motor de flows (`lib/flow-engine/engine.ts` y `interpolate.ts`), el cron de `automation_events`, el `FormBuilder` de la Agenda y la política `audit_log_select`.

---

## 1. Mapa de ruta

| Orden | Módulo | Estado | Relación con Formularios |
|---|---|---|---|
| 1 | Etapa 3 > Fase 2: **Llamadas** | Prerrequisito (construido antes) | Deja `audit_log.actor_type`, `actor_label`, helpers y `<Historial>` |
| **2** | **Extra C: Formularios** | **Este documento** | — |
| 3 | Etapa 5 > Fase 1: Ventas y pagos | Después | Un contrato podrá prellenarse desde la venta y quedar atado a ella (usa `sale_id`, reservado acá) |
| 4 | Etapa 6 > Fase 1: CX | Después | Los ítems Formulario, Encuesta y Contrato del camino se completan solos con los envíos (usa `service_id`, reservado acá, y el evento de envío) |
| 5 | Extra I (parte): Gastos | Después | No depende de Formularios |
| Después | Ventas Fase 2 (receptor general de webhooks) | Pausado | Reusa el mapeo a contacto de FO2 como primera versión de su componente de mapeo |

**Lo que NO se construye ahora pero el diseño contempla:**
- **Ventas:** `form_submissions.sale_id` y `contract_signatures.sale_id` (uuid nullable, **sin FK**: la tabla `sales` todavía no existe). Ventas (00162) suma la FK de `form_submissions.sale_id` y la de `contract_signatures.sale_id`. Ventas (00168) reescribe `submit_form_response`/`record_contract_signature` para validar el `sale_id` contra el contacto y sumarlo al payload de `form_submitted`/`contract_signed`. Se llenan desde ya con el link firmado (F20) cuando lleva `sale_id`; el botón "Enviar contrato" de Ventas solo tiene que llamar a `signFormLink({…, saleId})`.
- **CX:** `form_submissions.service_id` y `contract_signatures.service_id` (mismo criterio; CX (00172) suma la FK de `form_submissions.service_id` y la de `contract_signatures.service_id`.), llenados por el link firmado con `service_id` (F20): es lo que le permite a CX saber a qué servicio pertenece un envío cuando el contacto tiene varios. La regla "una vez por contacto" guarda una `once_key` que CX podrá formar como `contacto:servicio` sin migrar ("una vez por servicio").
- **Varios pasos:** `form_versions.definition` es un objeto con `fields[]`; sumar `pages[]` después es aditivo.
- **Receptor general (Ventas Fase 2):** el mapeo a contacto (`forms.contact_config`) usa el mismo vocabulario de destinos (`contact.email`, `contact.custom.<slug>`) que el v6 definió para webhooks.

---

## 1b. Cambios en la base de datos y riesgos

**Ocho migraciones**, de la `00150` a la `00157` (la banda completa, sin huecos). Ninguna borra ni cambia datos existentes. Ninguna es irreversible.

> **v1.1 (FO4) no suma migraciones.** El sitio público, el prellenado configurable y la atribución persistente son código. Lo único que cambia en la base es **lo que devuelve `get_public_form`** (la configuración `prefill` de cada campo y los ocultos con `source: "attribution"`), y eso es parte de la 00152, que todavía no existe: se escribe directamente así.

| N° | Qué hace, en una línea | Bloque | Tipo | Riesgo | Reversible |
|---|---|---|---|---|---|
| 00150 | Tablas nuevas `forms`, `form_versions`, `form_submissions` + funciones de visibilidad `can_view_forms`, `can_see_form_submission` + RLS | FO1 | Aditiva | Bajo | Sí (drop) |
| 00151 | Índice nuevo sobre la tabla **existente** `analytics_events`: `idx_analytics_forms (workspace_id, (metadata->>'form_id'), event_type, created_at) WHERE event_type LIKE 'form\_%'` (para las métricas de vistas, inicios y rechazados) | FO1 | Aditiva (sobre una tabla existente) | Bajo | Sí (`DROP INDEX`) |
| 00152 | Funciones nuevas: `get_public_form` (definición pública segura), `publish_form_version`, `form_metrics_daily` (métricas por día en la zona del workspace), `submit_form_response` (v1, sin contacto) | FO1 | Aditiva | Bajo | Sí (drop) |
| 00153 | Buckets privados `form-uploads` y `contracts` (10 MB, tipos permitidos), sin políticas para clientes | FO1 | Aditiva | Bajo | Sí (drop si vacíos) |
| 00154 | El CHECK de `integration_configs.type` suma `'captcha'` (la card de Turnstile) | FO1 | **Modifica estructura existente** | Medio | Sí (lista vieja en la cabecera) |
| 00155 | Columna `flows.form_id` (FK a `forms`, `on delete set null`, índice parcial) + el CHECK de `triggers.type` suma `form_submitted`, `survey_answered`, `contract_signed` | FO2 | Aditiva + **Modifica estructura existente** | Medio | Sí (lista vieja en la cabecera; drop column) |
| 00156 | Función nueva `find_contact_by_phone_or_email` + reescribe `submit_form_response` (de la 00152, de este mismo módulo) para resolver el contacto, aplicar el mapeo y emitir el evento | FO2 | **Modifica lógica** (propia de este módulo) | Medio | Sí (la v1 copiada en la cabecera) |
| 00157 | Tabla nueva `contract_signatures` + función `record_contract_signature` + RLS + reescribe `submit_form_response` (v3, de este módulo) para registrar la firma en la misma transacción | FO3 | Aditiva + **Modifica lógica** (propia de este módulo) | Medio | Sí (la v2 copiada en la cabecera; drop) |

**Ninguna migración es de riesgo alto**, por estas razones concretas: no tocan `find_or_link_contact`, `create_booking`, `record_contact_touch` ni ninguna policy existente; no cambian ni borran filas; todas tienen vuelta atrás; y el código que ya está en producción sigue funcionando igual con ellas aplicadas.

**Qué se aprueba, en simple:**
- **00154 y 00155 (los dos CHECK):** la base tiene una lista cerrada de "tipos de integración" y otra de "tipos de disparador de automatización". Se les **suman** valores (`captcha`; y los tres disparadores de formularios). No se quita nada. El riesgo es escribir la lista mal y borrar sin querer un tipo que ya se usa (por ejemplo los dos de Llamadas): por eso la migración se arma copiando la lista **viva** de la base y su cabecera guarda la definición vieja completa.
- **00156 y 00157 (la función del envío):** la función que guarda una respuesta pasa a buscar o crear el contacto con la misma regla que la Agenda (teléfono exacto, después email exacto, nunca el nombre) y a disparar las automatizaciones (00156), y después a registrar la firma del contrato en la misma transacción (00157). Es una función creada por este mismo módulo en la 00152; no hay otra parte del sistema que la use. Cada versión deja la anterior completa en su cabecera.

**Orden contra el deploy:** las ocho son aditivas respecto de lo que ya existe, así que **se aplican ANTES de desplegar el código de este módulo** y se pueden aplicar con anticipación: el código viejo no se entera. El código nuevo **no** funciona sin ellas (sus pantallas leen tablas que no existirían). Dentro del módulo, cada migración se aplica al empezar su bloque: 00150–00154 en FO1, 00155–00156 en FO2, 00157 en FO3.

**Qué pasa con los datos que ya existen:**
- `flows`: todas las filas actuales quedan con `form_id = null`. No cambia nada para ellas (las de la Agenda siguen con su `event_type_id`).
- `triggers`: las filas actuales no se tocan; el CHECK nuevo es un superconjunto del viejo.
- `integration_configs`: ídem.
- `analytics_events` (779 filas al 10/10/2026, todas `contact_created`): solo gana un índice parcial que no cubre ninguna fila existente (ninguna empieza con `form_`); el `CREATE INDEX` sobre una tabla de este tamaño toma un bloqueo de escritura de milisegundos. Sus lectores actuales (el historial del contacto filtra por `contact_id` y por `event_type IN ('flow_started','flow_completed')`; el backfill de la 00115 ya corrió) no ven los eventos nuevos.
- No hay backfill. No se pierde nada.

**Cómo se verifica después de aplicar:**
- `node scripts/verify-forms.mjs` (nuevo, ver F1) sale 0: RLS por rol, unicidad de slug, idempotencia, `get_public_form` sin columnas internas, buckets privados, `form_metrics_daily` por día en la zona del workspace.
- `node scripts/verify-rls.mjs`, `verify-scheduling.mjs` y `verify-attribution.mjs` (existentes) siguen en 0.
- Consultas de control (solo lectura):
  ```sql
  -- 00154 / 00155: el CHECK nuevo contiene TODO lo que había antes
  select pg_get_constraintdef(oid) from pg_constraint where conname in ('triggers_type_check','integration_configs_type_check');
  -- 00155: ningún flow existente quedó atado a un formulario
  select count(*) from public.flows where form_id is not null;  -- 0 al aplicar
  -- 00151: el índice existe y es parcial
  select indexdef from pg_indexes where indexname = 'idx_analytics_forms';
  -- 00153: los buckets nacieron privados
  select id, public from storage.buckets where id in ('form-uploads','contracts');  -- public = false
  ```
- Test de caracterización previo a la 00155 (F19): lista los tipos del CHECK de `triggers` **antes** de migrar y verifica que el después los contiene a todos.

**Cómo se vuelve atrás:**
- **00154:** `ALTER TABLE integration_configs DROP CONSTRAINT integration_configs_type_check; ADD CONSTRAINT … CHECK (type IN (<lista vieja de la cabecera>))`. Antes, borrar la fila `captcha` si existe (es solo la card de Turnstile; el secreto se borra de Vault con `deleteSecret`).
- **00155:** `DROP INDEX idx_flows_form; ALTER TABLE flows DROP COLUMN form_id;` y el CHECK de `triggers` con la lista vieja de la cabecera, **después** de borrar los `triggers` de tipo `form_*` (los flows quedan en borrador).
- **00157:** `CREATE OR REPLACE submit_form_response` con la v2 de la cabecera; después `DROP FUNCTION record_contract_signature; DROP TABLE contract_signatures`.
- **00156:** `CREATE OR REPLACE` con la definición v1 copiada en la cabecera; `DROP FUNCTION find_contact_by_phone_or_email`.
- **00150, 00152:** `DROP FUNCTION …; DROP TABLE … CASCADE` en orden inverso. Solo tiene sentido si todavía no hay respuestas reales.
- **00151:** `DROP INDEX IF EXISTS public.idx_analytics_forms;` (los eventos `form_*` ya escritos quedan en `analytics_events` y no molestan a nadie).
- **00153:** borrar los buckets solo si están vacíos (`select count(*) from storage.objects where bucket_id in (…)` = 0).

---

## 2. Objetivo y mapa de bloques

**Objetivo:** que Wendy pueda crear formularios propios (personalizado, encuesta con NPS y contrato con firma), publicarlos con un link o un embed, recibir respuestas seguras que crean o vinculan el contacto correcto con su atribución, y disparar automatizaciones desde el mismo formulario; y que un contrato firmado quede atado al texto exacto que se firmó, con su PDF y su copia por email.

**Por qué en este orden:**
1. **FO1** primero: sin formulario publicado y envío seguro no hay respuestas que mapear ni que automatizar.
2. **FO2** después: el mapeo a contacto, la atribución y los triggers se apoyan en la respuesta guardada de FO1. Es el corazón del pedido de Wendy (contacto + atribución + automatizaciones).
3. **FO3** después: encuesta y contrato son **tipos** de formulario; reutilizan todo lo anterior y suman su panel, la firma, el PDF y el email.
4. **FO4** al final: lleva los formularios a **páginas públicas del propio proyecto** (como el home de la web) y hace que la atribución **sobreviva entre páginas**, en el sitio propio y en las webs donde se embebe. Se apoya en el renderizador público (F9), el embed (F10) y el toque (F17).

| Bloque | Día | Qué se construye | Contexto compartido | Funcionalidades |
|---|---|---|---|---|
| **FO1** Builder, publicación y envío | 1–3 | Tablas, permisos, menú, lista, builder de campos con condiciones y ocultos, prellenado, diseño y éxito, versiones y publicación, definición pública segura, página `/f/[slug]`, embed, Turnstile, envío seguro con idempotencia y archivos, respuestas con CSV, métricas | `forms`, `form_versions`, `form_submissions`, `analytics_events` (existente), `rate_limits`, buckets, `lib/embed/*`, `integration_configs` | F1 a F14 |
| **FO2** Contacto, atribución y automatizaciones | 4–5 | Pestaña Contacto (mapeo y modo), resolución y deduplicación, atribución por toque, etiquetas y aviso, 3 triggers con condiciones, variables, `flows.form_id` y pestaña Automatizaciones con plantillas | `contacts`, `contact_custom_fields`, `contact_tags`, `contact_touches`, `automation_events`, `triggers`, `flows`, flow registry | F15 a F21 |
| **FO3** Encuesta/NPS y contrato | 6–7 | Tipo encuesta, una vez por contacto con link firmado, panel NPS, tipo contrato con texto versionado, firma dibujada, metadata legal y huella en servidor, PDF, email con reintentos, ver y reenviar | `contract_signatures`, `form_versions`, `scheduled_jobs`, Resend, bucket `contracts` | F22 a F28 |
| **FO4** Sitio público y atribución completa | 8–9 | Atribución persistente entre páginas (cookie propia y almacenamiento del sitio que embebe), área pública del sitio (`app/(sitio)`, home en `/`), componente `<Formulario slug>` para cualquier página, parámetros y links con prellenado en la pestaña Publicar, todos los ids de clic y cookies de anuncios al toque | `lib/attribution/*`, `app/(sitio)`, `components/forms/public/*`, `public/embed/embed.js`, `lib/contacts/touch.ts`, `scripts/export-template.mjs` | F29 a F33 |
| Testing | 10 | Suite completa, scripts, revisión visual | — | — |

---

## 3. Estado actual (as-is, verificado)

Verificado el **10/10/2026** contra el repo (`main` en `f70e520`) y la base de SSA_BAIOS (solo lectura). Claude Code confirma cada punto en su exploración; si algo no coincide, **gana el código real** y lo informa en el plan antes de escribir.

### 3.1 Stack y patrones (no cambian)

- Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind 4 + Zod 4 + `@supabase/ssr`. Vitest 3 (entorno node). Sin Testing Library ni Playwright.
- `package.json`: `dayjs` (no hay `date-fns`), `unpdf` (solo **lee** PDFs; no genera), `recharts`. **No hay librería para generar PDF ni editor de texto enriquecido.**
- Mutaciones en Server Actions (`lib/actions/*`) con `getPermissionAction` / `requirePermission`; rutas públicas en `app/api/public/*`; crons por `pg_cron` → `private.call_app_cron`.
- `scheduled_jobs` procesada cada minuto por `/api/cron/jobs` con registro de handlers (`lib/jobs/registry.ts`, `registerJobHandler`). CHECK de `status` ya admite `cancelled`. Único parcial `uq_scheduled_jobs_dedupe_pending (dedupe_key) WHERE status = 'pending'`.
- `automation_events` drenada por `/api/cron/automation-events`, que **enruta por el registro** (`triggerTypesForEvent`): sumar un tipo es declararlo con sus `eventTypes` en `lib/flow-engine/registry/*-triggers.ts` + el CHECK. La definición de trigger admite `eventMatches`, `dedupeKeyFor` y **`variablesFor`** (variables extra para el flow), y el cron ya las inyecta. Idempotencia por `trigger_fires` con `dedupe_key`.
- Variables: `interpolateVariables` (`lib/flow-engine/interpolate.ts`) resuelve `{{a.b.c}}` (admite guiones) sobre `context.variables`; un token que no resuelve **queda tal cual**. Segundo pase `resolveBankVariables` (`lib/response-assets/bank-variables.ts`) para `{{contact.*}}`/`{{workspace.name}}`, llamado desde los nodos `send_email` y `send_message`.

### 3.2 Hallazgos que cambian el plano

| # | Hallazgo verificado | Lo que se suponía | Consecuencia en este plano |
|---|---|---|---|
| H1 | **`find_or_link_contact(p_channel_id uuid, p_sender_id text, …)` exige un canal.** Sin `channel_id` válido devuelve `contact_id = null` y no hace nada; además escribe `contact_channels`. | "Deduplicar por `find_or_link_contact`" (alcance §2.2, encargo) | **No se puede usar para un formulario**, que no viene de ningún canal. La Agenda tampoco lo usa: `create_booking` resuelve el contacto adentro de su transacción con la misma regla. Formularios hace lo mismo con una función nueva y chica, `find_contact_by_phone_or_email` (00156), que **copia el criterio** sin tocar `find_or_link_contact` (decisión D1, §21). |
| H2 | El orden de búsqueda real es **teléfono exacto primero** (`phone` o `whatsapp_phone`), **después email exacto** (`email` o `secondary_email`, normalizado), en `find_or_link_contact`, en `create_booking` y en `lib/contacts/dedup.ts`. | El alcance (§3.3) dice "email primero" | Gana el código: **teléfono primero**. Si el teléfono apunta a un contacto y el email a otro, se vincula el del teléfono y la respuesta guarda el otro en `dedupe.conflict_contact_id` para revisar. Divergencia anotada en §20. |
| H3 | `automation_events.contact_id` es **NOT NULL** (FK a `contacts`). El motor ejecuta flows **por contacto**. | — | Una respuesta **sin contacto no dispara automatizaciones** (no hay a quién mandarle nada). Si después se vincula a mano, se puede disparar con una casilla explícita (F16). |
| H4 | `has_permission()` devuelve **false** para el rol de sistema Member: sus permisos viven solo en `lib/auth/permissions.ts` (la fila del rol tiene `keys: []` a propósito). | Usar `has_permission(ws,'forms.view')` en la RLS | La RLS usa una función nueva `can_view_forms(ws)` que contempla los tres casos (owner/admin, rol de sistema Member con su baseline, rol personalizado con la clave). |
| H5 | El "constructor de preguntas" de la Agenda (`components/scheduling/form-builder/form-builder.tsx`, 195 líneas) está atado a `BookingField`: 7 tipos, tres campos del sistema fijos arriba (nombre siempre obligatorio, email o teléfono obligatorio), sin condiciones ni ocultos ni archivos, validado por `bookingFieldsSchema` sobre `event_types.booking_fields`. | "Extender el form-builder de la Agenda" | **No se extiende**: se construye un builder propio y se reusan los helpers puros (D2, §12). |
| H6 | La sección "Flujos" del evento (`flows-section.tsx`) **no tiene "+ Nueva automatización"**: lista los 7 flujos precreados con un interruptor. El editor lineal (`linear-flow-editor.tsx`, 285 líneas) importa variables, rutas y acciones **de agenda**. | "Igual que en la Agenda" | La pestaña Automatizaciones del formulario es nueva (con crear y plantillas) y el **editor lineal se extrae a un componente compartido** con la Agenda como envoltorio (D3, §12). |
| H7 | Las variables de respuestas de la Agenda son `{{booking.answers.<id>}}` (plural, dentro de `booking`). | `{{answer.*}}` | Formularios expone `{{answer.<campo>}}` (singular, de primer nivel), como pide el alcance. No se cambia lo de la Agenda. |
| H8 | El nodo `send_email` saltea el envío si el contacto tiene `do_not_contact`, **aunque el destinatario sea una dirección fija** (`to: "fixed"`); solo la agenda está exceptuada (`trigger_scope = "booking"`). | — | La plantilla "Avisarme por email" **no llega** si quien respondió está marcado "no contactar". Como el motor no se toca (alcance §4.4), el aviso al equipo confiable es la **campana** (F18), que no pasa por el motor. Anotado en §16 y §19. |
| H9 | `sendViaResend` (`lib/email/resend-client.ts`) **no admite adjuntos**. | "PDF adjunto" | Se suma `attachments?` a `ResendMessage` y a `sendTransactionalEmail` (cambio aditivo en un módulo existente, F28). |
| H10 | El tope por IP de la Agenda (`lib/scheduling/antispam.ts`) tiene el prefijo `scheduling:` y los límites escritos adentro. La tabla `rate_limits (key, window_start, count)` con único `(key, window_start)` y la RPC `bump_rate_limit(p_key, p_window_start)` **son genéricas**. | "Reusar `rate_limits` si sirve" | **Sirve tal cual.** Se agrega `lib/antispam/rate-limit.ts` (genérico, clave `forms:<acción>:<hash ip>`) y se reusan `hashIp`, `clientIp`, `safeReferrer` y `pickUtm` de la Agenda sin modificarlos. |
| H11 | `contact_touches` admite `origin = 'form'` (CHECK) y la taxonomía (`lib/contacts/taxonomy.ts`) ya tiene `medium: "form"` y `origin: "form"`. `record_contact_touch` recalcula primero y último toque **por `occurred_at`** desde la tabla. | — | Se usa tal cual. El formulario anota su toque con `recordTouch` y `occurred_at = now()` del servidor (nunca del navegador: una fecha vieja lo volvería "primer toque"). |
| H12 | `lib/content/media.ts` tiene `sniffUploadMime(bytes, declared)` (tipo real por los primeros bytes, incluye contenedores de Office). | — | Se reusa para validar los archivos subidos. |
| H13 | El embed (`public/embed/embed.js`, 14 KB hoy) acepta `calLink = usuario/evento` y arma `/calendario/...`. Test de tamaño ≤ 60 KB en `lib/embed/build.test.ts`. | — | El mismo script acepta `f/<slug>` y arma `/f/<slug>` (F10). |
| H14 | `lib/security-headers.ts` solo deja embeber `/calendario` y `/embed`. | — | Se suma `/f` (F9). |
| H15 | `email_log.status` CHECK: `sent | failed | skipped_not_configured`. | — | El estado del email del contrato vive en `contract_signatures`, no en `email_log` (que sigue registrando cada intento como siempre). |
| H17 | `analytics_events (id, workspace_id, flow_id, contact_id, event_type, metadata, created_at)` **no tiene CHECK sobre `event_type`** (hoy solo hay `contact_created`, 779 filas), RLS con SELECT e INSERT para `is_workspace_member` (el cliente de servicio la saltea), sin triggers, sin purga, índices `(workspace_id, created_at desc)` y `(flow_id, created_at desc)`. Su único lector en pantalla, el historial del contacto (`app/(dashboard)/dashboard/contacts/[contactId]/page.tsx`, con la lógica en `lib/contacts/history.ts`), filtra por `contact_id = <el contacto>` **y** `event_type IN ('flow_started','flow_completed')`. | — | Vistas, inicios y rechazados se registran ahí con `contact_id = null`: **no aparecen en el historial de ningún contacto** (verificado en el código). Como cualquier miembro puede leer la tabla, la `metadata` lleva solo `{form_id, version_id}` (y `reason` en los rechazos): nada personal, ni IP. |
| H16 | ssa-hechos decía que 00128 y 00136 estaban sin aplicar: **ya están aplicadas** y las dos ramas mergeadas. | — | Sin efecto en este módulo; se anota. |

### 3.3 Qué se reusa del repo (y dónde está)

| Pieza | Archivo | Uso en Formularios |
|---|---|---|
| Identificadores de pregunta | `lib/scheduling/booking-fields.ts`: `identifierFromLabel`, `uniqueIdentifier`; `lib/scheduling/identifier.ts`: `IDENTIFIER_RE` | Clave de cada campo (`field.key`) |
| Teléfono con país | `lib/scheduling/phone-countries.ts`: `normalizePhoneWithCountry`, `countryFromTimezone` | Campo teléfono |
| Antispam | `lib/scheduling/antispam.ts`: `HONEYPOT_FIELD`, `hashIp`, `clientIp`, `pickUtm`, `safeReferrer` | Envío público |
| Tope por IP | Tabla `rate_limits` + RPC `bump_rate_limit` | `lib/antispam/rate-limit.ts` (nuevo, genérico) |
| Tipo real de archivo | `lib/content/media.ts`: `sniffUploadMime` | Archivos subidos |
| Atribución | `lib/contacts/touch.ts`: `recordTouch`; `lib/contacts/touch-entry.ts` (armadores puros) | Toque `form` |
| Embed | `lib/embed/url.ts`, `embed-source.ts`, `iframe-side.ts`, `scripts/build-embed.mjs` | `f/<slug>` |
| Flujos de una entidad | `lib/scheduling/automation/linear-flow.ts` (`flowToLinear`, `linearToFlow`), `lib/flow-triggers.ts` (`buildDesiredTriggers`), `components/scheduling/event-editor/linear-flow-editor.tsx` | Pestaña Automatizaciones |
| Panel de trigger | `components/flow-builder/panels/TriggerPanel.tsx` | Config de los 3 triggers en el canvas |
| Email | `lib/email/send.ts` (`sendTransactionalEmail`), `resend-client.ts` | Copia del contrato |
| Notificaciones | `lib/notifications/types.ts` (`NOTIFICATION_TYPES`, sin CHECK en la base), `create.ts` | Aviso al equipo |
| Integraciones | `lib/integrations/providers.ts`, `lib/secret-names.ts`, `lib/vault.ts` | Card de Turnstile |
| Permisos | `lib/auth/permissions.ts`, `member-baseline.test.ts`, `lib/nav/items.ts` | `forms.view`, `forms.manage` |
| Marca | `lib/brand.ts` (variables de entorno del white label) | Logo y color de la página pública |

### 3.4 Qué se porta de prevxcrm (y qué se corrige)

Código propio: se porta sin obligación de licencia, adaptado a SSA (workspace, `audit_log`, permisos, Server Actions en lugar de Edge Functions de Deno).

| Pieza de prevxcrm | Qué se trae | Qué se corrige |
|---|---|---|
| `src/lib/visibility-utils.ts` | El modelo `{rootConjunction, conditions[], groups[]}` y `isFieldVisible` | Se quitan `service.*` y `contact.*` (no aplican) y la evaluación se hace con una función pura propia (no `filter-eval`). **Se re-evalúa en el servidor** (en prevxcrm solo en el navegador) |
| `src/components/cx/VisibilityRuleBuilder.tsx` | La interfaz de reglas agrupadas | Se arma sobre `components/ui` de SSA |
| `src/components/cx/QuestionFieldModal.tsx` | Los tipos de campo y sus opciones (mín./máx., opciones, archivo) | Sin `service_selector` ni `data_persistence_mode`; el mapeo a contacto pasa a la pestaña Contacto (en prevxcrm se ignoraba) |
| `src/lib/satisfaction-constants.ts` | `calculateNPS`, `calculateAverage`, la idea de categoría | NPS sobre el campo NPS 0-10 (no sobre un rating 1-10); categorías propias de SSA |
| `src/lib/form-metrics.ts`, `form-responses-export.ts` | Métricas por período y exportación | Vistas, inicios y rechazados en `analytics_events` y envíos desde `form_submissions`, agrupados por día en la zona del workspace por una función SQL; CSV con protección contra inyección de fórmulas |
| `src/components/cx/SignatureCanvas.tsx` | El canvas sin dependencias (mouse y dedo, tope 200 KB) | Se manda también la cantidad de trazos para que el servidor pueda rechazar una firma vacía |
| `supabase/functions/submit-custom-form/` | El orden general del envío | **Definición pública por RPC con columnas seguras** (no `select('*')`); **idempotencia por índice único**; **Turnstile verificado en el servidor** con secreto en Vault; **validación total en el servidor** |
| `supabase/functions/submit-contract/` | Metadata legal, armado del PDF (jsPDF) | **La huella se calcula sobre el texto de `form_versions` guardado**, no sobre `contract_html` que manda el navegador (línea 550 de prevxcrm); PDF con `pdf-lib` en Node |
| `_shared/email-retry-utils.ts` | `classifyEmailError` (transitorio/permanente) y la escalera 5/15/30 min | Los reintentos se agendan en `scheduled_jobs` con `dedupe_key`, no con un barrido por columna |
| `src/pages/public/PublicContractPage.tsx` | Flujo de lectura + aceptación + firma | Buckets privados y links firmados cortos |

---

## 4. Qué cambia, qué NO cambia y análisis de impacto

### 4.1 Cambia

- **Tablas nuevas (4):** `forms`, `form_versions`, `form_submissions`, `contract_signatures`. **No hay tabla de contadores:** vistas, inicios y rechazados van a la tabla existente `analytics_events` (`event_type` `form_view`, `form_start`, `form_rejected`) y los envíos salen de `form_submissions`.
- **`analytics_events`:** índice parcial nuevo `idx_analytics_forms` (00151) y tres `event_type` nuevos (la columna no tiene CHECK: verificado, H17).
- **Funciones SQL nuevas (8):** `can_view_forms`, `can_see_form_submission`, `get_public_form`, `publish_form_version`, `form_metrics_daily`, `submit_form_response`, `find_contact_by_phone_or_email`, `record_contract_signature`.
- **Columnas nuevas en tablas existentes:** `flows.form_id` (uuid, FK `forms`, nullable).
- **CHECK ampliados:** `triggers.type` (+3), `integration_configs.type` (+`captcha`).
- **Buckets nuevos:** `form-uploads`, `contracts` (privados).
- **Catálogo de permisos:** módulo `forms` con `forms.view` y `forms.manage`; el baseline del Member suma `forms.view`.
- **Menú:** ítem "Formularios" (grupo "adquisicion").
- **Flow registry:** 3 triggers (`form_submitted`, `survey_answered`, `contract_signed`) en `lib/flow-engine/registry/form-triggers.ts`; el `TriggerPanel` suma su configuración.
- **Variables:** `{{form.*}}`, `{{answer.*}}`, `{{submission.*}}` (por `variablesFor` del trigger) y `{{form_link.<slug>}}` (segundo pase en `lib/response-assets/bank-variables.ts`; `resolveBankVariables` acepta `variables` opcional y los nodos `send_email` y `send_message` se lo pasan: una línea aditiva cada uno).
- **Link firmado por contacto** (`lib/forms/signed-link.ts`): acepta `contact_id`, `service_id` y `sale_id` dentro de la firma; es la función que reusan Ventas y CX (F20).
- **Componente compartido nuevo:** `components/automations/linear-flow-editor.tsx` (extraído del de la Agenda, que queda como envoltorio).
- **Integraciones:** card "Cloudflare Turnstile" (tipo `captcha`) y secreto `turnstile_secret_key` en Vault; `forms_link_secret` (se genera solo, para firmar links de encuesta).
- **Email:** `ResendMessage.attachments?` y `SendEmailParams.attachments?` (aditivo).
- **Notificaciones:** tipo `form_submitted` en `NOTIFICATION_TYPES`.
- **Jobs:** tipos `contract_pdf` y `contract_email`.
- **Embed:** `buildEmbedIframeUrl` acepta `f/<slug>`; `EMBEDDABLE_PREFIXES` suma `/f`.
- **Rutas nuevas:** internas `/dashboard/formularios/*`; públicas `/f/[slug]`, `POST /api/public/forms/[slug]/submit`, `POST /api/public/forms/[slug]/beacon` (vistas e inicios).
- **Dependencia nueva (a aprobar):** `pdf-lib@1.17.1`.
- **Script nuevo:** `scripts/verify-forms.mjs`.

### 4.2 NO cambia (intocable)

- `find_or_link_contact` y `create_booking`: ni una línea.
- `record_contact_touch` y la forma canónica de `contacts.attribution`: se usan tal cual.
- El motor de flows (`engine.ts`, `interpolate.ts`, el simulador), los nodos y el cron de `automation_events`: solo se **registran** triggers nuevos.
- El `FormBuilder` de la Agenda, `booking-fields.ts`, `event_types.booking_fields` y la página de reserva.
- `lib/scheduling/antispam.ts` (se importan sus funciones, no se modifican).
- La política `audit_log_select` (la rama de lectura para Members es de Ventas en adelante; acá el historial lo ven Owner y Admin).
- `can_see_contact`, el alcance de leads y `permission_scope`.
- El CHECK de `scheduled_jobs.status` (ya admite `cancelled`).
- Los 7 flujos precreados de la Agenda y su sección "Flujos" del evento.

### 4.3 Análisis de impacto y riesgos

| Zona que se toca | Quién depende | Riesgo | Mitigación |
|---|---|---|---|
| CHECK de `triggers.type` (00155) | Todos los flows publicados | Borrar sin querer un tipo existente (los 19 de hoy + los 2 de Llamadas) y que un flow deje de poder guardarse | Lista leída de la base al escribir; test de caracterización que compara antes/después (F19); `verify-scheduling.mjs` y `lib/flow-engine/registry/consistency.test.ts` en verde |
| CHECK de `integration_configs.type` (00154) | Las cards de integraciones | Ídem | Mismo procedimiento; `lib/integrations/*.test.ts` existentes en verde |
| `flows.form_id` | Pantalla de Automatizaciones, canvas | Que la lista general de flows filtre o rompa por la columna nueva | Columna nullable; la lista general no filtra por ella (los flows del formulario aparecen igual, como los de la Agenda) |
| Extracción del editor lineal | Editor de flujos de cada evento de la Agenda | Romper el editor de la Agenda | El envoltorio pasa **las mismas** props que hoy; las acciones `saveLinearFlow`/`sendFlowTestEmail` de la Agenda no se tocan; `linear-flow.test.ts`, `triggers.test.ts` y `variables.test.ts` de la Agenda en verde; revisión visual del editor de un evento |
| `buildEmbedIframeUrl` | Todos los embeds de agenda en webs de clientes | Que un embed de agenda arme mal su URL | Solo se agrega una rama para `f/…`; `lib/embed/url.test.ts` existente en verde + casos nuevos; tamaño ≤ 60 KB |
| `EMBEDDABLE_PREFIXES` | Headers de seguridad | Dejar embebible algo interno | Solo `/f`; `lib/security-headers.test.ts` extendido verifica que `/dashboard` sigue con `DENY` |
| `bank-variables.ts` (segundo pase) y la línea que suman `send_email`/`send_message` (pasan `context.variables`) | Todo email y mensaje de flows | Romper la resolución de `{{contact.*}}` o el envío | `variables` es opcional; el pase de `{{form_link.*}}` es aparte y solo corre si el texto lo trae; los tests existentes de los dos nodos en verde; `bank-variables.test.ts` existente en verde |
| `resend-client.ts` / `send.ts` | Todos los emails transaccionales | Cambiar el cuerpo que se manda a Resend | `attachments` solo se incluye si viene; `send.test.ts` existente en verde + caso nuevo |
| Baseline del Member (`forms.view`) | `member-baseline.test.ts` | Que el test de caracterización falle | Se agrega la clave a su tabla escrita a mano con comentario de la decisión (alcance §4.5) |
| `analytics_events` (índice y eventos `form_*`) | Historial del contacto, motor de flows, comment-processor | Ensuciar el historial del contacto o hacer lenta la escritura de los demás eventos | Los eventos de formulario van con `contact_id = null` y el historial filtra por contacto y por `flow_started`/`flow_completed` (H17); el índice es parcial (`form_%`), así que los inserts del motor no lo mantienen; tope por IP y deduplicado por sesión en las vistas (F14) |
| Página pública sin sesión | Seguridad | Exponer configuración interna o permitir spam | `get_public_form` con lista blanca, Turnstile + honeypot + tope por IP, validación total en servidor (§15) |
| Contactos | Toda la app | Duplicar contactos | Misma regla que la Agenda (teléfono, después email, nunca nombre); sin email ni teléfono no se crea (decisión 156) |

---

## 5. Usuarios, roles y permisos

**Permisos nuevos** (módulo `forms` en `PERMISSION_MODULES`, claves en `PERMISSION_KEYS`):

| Clave | Etiqueta | Qué habilita | Owner | Admin | Member |
|---|---|---|---|---|---|
| `forms.view` | Ver formularios y respuestas | Lista, editor en solo lectura, respuestas, métricas y panel de encuesta | ✓ | ✓ | ✓ **solo las respuestas de contactos que ve** (las sin contacto, no) |
| `forms.manage` | Crear y publicar formularios | Crear, editar, duplicar, publicar, pausar, archivar; pestaña Contacto; vincular respuestas a mano; marcar spam; reenviar copia del contrato | ✓ | ✓ | — |

- **Automatizaciones desde el formulario:** crear y editar exige `forms.manage` **y** `flows.edit` (el flow es un flow normal). Ver la pestaña exige `forms.view` y `flows.view`.
- **Card de Turnstile:** `integrations.manage` (Owner/Admin), como el resto de las integraciones.
- **Rol personalizado:** lo que marque. Sin `forms.view`, el ítem del menú no aparece y las rutas redirigen.

**Función SQL `can_view_forms(p_workspace_id uuid) returns boolean`** (`SECURITY DEFINER`, `STABLE`, `SET search_path = ''`): true si `is_workspace_admin`; si no, true si el miembro no tiene `role_id` o su rol tiene `system_role = 'member'` (baseline con `forms.view`); si no, `has_permission(p_workspace_id, 'forms.view')`. **Por qué no `has_permission` sola:** H4.

**Función SQL `can_see_form_submission(s public.form_submissions) returns boolean`:** `is_workspace_admin(s.workspace_id)` OR (`can_view_forms(s.workspace_id)` AND `s.contact_id IS NOT NULL` AND `can_see_contact(<fila de contacts>)`).

**Qué NO puede nadie:**
- Ver la secret key de Turnstile (vive en Vault, no vuelve al navegador).
- Borrar formularios, versiones, respuestas o firmas (no hay DELETE: se archiva o se marca spam).
- Editar una versión publicada o una respuesta.
- Cambiar el texto de un contrato ya firmado: editar el texto publica una versión nueva.

---

## 6. Alcance específico

### 6.1 Formularios y builder (FO1)
- **Qué hace:** tres tipos (`custom`, `survey`, `contract`); campos: texto corto, texto largo, email, teléfono con país, número (mín./máx.), selección única, selección múltiple, fecha, calificación con estrellas (1-5), NPS (0-10), archivo (tipos y tamaño), casilla de consentimiento, campo oculto; condiciones de mostrar/ocultar (y/o, agrupadas) re-evaluadas en el servidor; prellenado por URL con bloqueo opcional; diseño de una sola página con título, introducción, logo y color de la marca y botón; pantalla de éxito con texto o redirección; versiones publicadas; slug propio; link y embed.
- **Qué NO hace:** varias páginas o pasos; lógica de puntaje (quiz); pagos dentro del formulario; A/B; plantillas de formulario precargadas; temas visuales por formulario más allá del color; traducción.
- **Dónde va lo que queda afuera:** fuera de la v7 (alcance §6).

### 6.2 Envío seguro (FO1)
- **Qué hace:** Turnstile verificado en el servidor, honeypot, tope por IP, clave de idempotencia, validación total en el servidor (obligatorios, formatos, opciones, rangos, archivos, condiciones), archivos al bucket privado, contadores de vistas, inicios, envíos y rechazados.
- **Qué NO hace:** guardar los envíos rechazados como respuestas (solo queda un evento `form_rejected` en `analytics_events`, sin datos de la persona); reCAPTCHA u otros captchas; listas negras de emails.

### 6.3 Respuestas y métricas (FO1)
- **Qué hace:** tabla por formulario con la etiqueta de cada campo al enviarse, filtro por fecha y estado, detalle, contacto vinculado, exportar CSV, marcar como spam; métricas por período.
- **Qué NO hace:** editar una respuesta; borrar respuestas; dashboard de formularios en Dashboards (el panel vive en el formulario).

### 6.4 Contacto, atribución y automatizaciones (FO2)
- **Qué hace:** mapeo por campo a los campos fijos del contacto (nombre, email, teléfono, WhatsApp, país) o a un campo personalizado; tres modos (crear o vincular · solo vincular · y para el existente: completar solo lo vacío o pisar); deduplicación teléfono → email; un toque de atribución por envío; etiquetas al enviar; aviso en la campana; 3 triggers con condiciones; variables; pestaña Automatizaciones con plantillas de un clic.
- **Qué NO hace:** crear contactos sin email ni teléfono (decisión 156); mapear a "apellido" o "empresa" como campos fijos (**no existen en `contacts`**: se mapean a campos personalizados, §21 D6); fusionar contactos; un tipo de automatización aparte (los flujos son los mismos de Automatizaciones, decisión 158).

### 6.5 Encuesta y contrato (FO3)
- **Qué hace:** encuesta con puntaje principal (estrellas o NPS) y categoría; una vez por contacto (con link firmado o por email); panel con promedio, distribución, NPS y evolución; contrato con texto con formato básico versionado, aceptación obligatoria, firma dibujada obligatoria u opcional, metadata legal, huella SHA-256 del texto guardado, PDF en el servidor, copia por email con reintentos 5/15/30, ver y reenviar.
- **Qué NO hace:** firma tipeada o con certificado digital; varios firmantes; contrato prellenado desde una venta (llega con Ventas); "una vez por servicio" (llega con CX); exámenes; EOD.

---

## 7. Funcionalidades y criterios de aceptación

> **Formato:** descripción + criterios **EARS** (`CUANDO …, EL SISTEMA DEBE …`) o **DADO/CUANDO/ENTONCES** + el test que debe pasar. Los tests van junto al módulo (`*.test.ts`). Turnstile y Resend simulados con `vi.fn()` sobre `fetch`.
>
> **Regla de fechas en tests:** todo test de métricas o de "día" fija el reloj (`vi.setSystemTime`) y usa una zona explícita (`America/Costa_Rica`). Caso obligatorio: un envío a las 23:30 hora local cuenta en ese día y no en el siguiente UTC.
>
> **Regla de seguridad en tests:** cada validación del servidor tiene al menos un test que manda lo que el navegador **no** dejaría mandar (un campo oculto por condición con valor, una opción inexistente, un prellenado bloqueado alterado, un texto de contrato distinto).

---

### Bloque FO1: Builder, publicación y envío

#### F1: Tablas base, RLS y script de verificación
**Descripción:**
- Migración `00150_forms_core.sql` con `forms`, `form_versions`, `form_submissions` (§9), las funciones `can_view_forms` y `can_see_form_submission` (§5) y la RLS de §15.
- Tipos regenerados en `lib/types/database.ts`.
- `scripts/verify-forms.mjs` nuevo, con el patrón de los `verify-*.mjs` existentes: usuarios reales Owner y Member, prefijo `zz-test-`, limpia lo suyo al final, no se corre en paralelo con otro.

**Criterios:**
- CUANDO la migración se aplica dos veces, NO DEBE fallar.
- CUANDO se crean dos formularios con el mismo slug (sin importar mayúsculas), el segundo DEBE fallar por el único `lower(slug)`.
- CUANDO se insertan dos respuestas del mismo formulario con la misma `idempotency_key`, la segunda DEBE fallar por el único.
- CUANDO un Member consulta `forms`, DEBE ver las filas de su workspace (lectura) y CUANDO intenta un INSERT o UPDATE, DEBE fallar por RLS.
- CUANDO un Member consulta `form_submissions`, DEBE ver solo las de contactos que `can_see_contact` le deja ver, y NINGUNA sin contacto.
- CUANDO cualquiera intenta un DELETE en las tres tablas, DEBE fallar.
- CUANDO un usuario de otro workspace consulta, NO DEBE ver filas.
- Test: `node scripts/verify-forms.mjs` sale 0; `node scripts/verify-rls.mjs` sigue en 0.

#### F2: Permisos y navegación
**Descripción:**
- `PERMISSION_MODULES` suma `"forms"`; `PERMISSION_KEYS` suma `forms.view` y `forms.manage` con sus etiquetas (§5). `MEMBER_KEYS` suma `forms.view`.
- `lib/auth/member-baseline.test.ts`: su tabla escrita a mano suma `forms.view` para el Member, con el comentario "alcance v7.1 §4.5: el Member ve las respuestas de los contactos que ve".
- `lib/nav/items.ts`: ítem `{ name: "Formularios", href: "/dashboard/formularios", icon: "ClipboardList", permissions: ["forms.view"], group: "adquisicion" }`.
- Toda página bajo `/dashboard/formularios` usa el guard de permiso existente (`requirePermission("forms.view")`); toda Server Action de escritura, `getPermissionAction("forms.manage")`.

**Criterios:**
- CUANDO se evalúa el rol de sistema `member`, DEBE tener `forms.view` y NO `forms.manage`.
- CUANDO una persona no tiene `forms.view`, "Formularios" NO DEBE aparecer en el menú y la ruta DEBE redirigir.
- CUANDO una persona sin `forms.manage` llama a cualquier acción de escritura de formularios, DEBE responder "No tenés permiso" sin tocar la base.
- `can_view_forms` DEBE devolver true para Owner, Admin y Member de sistema, y para un rol personalizado solo si tiene la clave (caso cubierto en `verify-forms.mjs`).
- Test: `lib/auth/permissions.test.ts`, `lib/auth/member-baseline.test.ts` y `lib/nav/items.test.ts` (extendidos) pasan.

#### F3: Lista de formularios
**Descripción:** `/dashboard/formularios`.
- Columnas: nombre, tipo (Personalizado · Encuesta · Contrato), estado (Borrador · Publicado · Pausado · Archivado), envíos totales, último envío.
- Pastillas con contador: **Publicados** · **Borradores** · **Pausados** · **Archivados** (los archivados solo aparecen en su pastilla).
- **"+ Nuevo formulario"** (con `forms.manage`): modal con nombre y tipo. Al crear: slug sugerido desde el nombre (`slugify`, único con sufijo `-2`, `-3`), estado `draft`, definición inicial según el tipo (§9.1 `defaultDefinition(type)`), y abre el editor.
- Acciones por fila: Abrir · Duplicar (copia la definición de borrador, nombre "Copia de …", slug nuevo, estado `draft`, sin respuestas, sin flujos) · Pausar / Reanudar · Archivar / Restaurar.
- Lógica pura en `lib/forms/list.ts`: `formListRow(form, stats)`, `nextSlug(base, taken)`, `canTransition(from, to)`.

**Criterios:**
- `canTransition` DEBE permitir: draft→published (vía publicar), published→paused, paused→published, cualquiera→archived, archived→draft (restaurar vuelve a borrador). Cualquier otra DEBE dar false.
- CUANDO se duplica un formulario con 3 flujos y 10 respuestas, la copia DEBE tener 0 flujos, 0 respuestas y estado `draft`.
- `nextSlug("aplicacion", ["aplicacion","aplicacion-2"])` DEBE dar `"aplicacion-3"`.
- CUANDO no hay formularios, DEBE mostrarse el vacío "Todavía no hay formularios" con el botón de crear (solo con `forms.manage`).
- Test: `lib/forms/list.test.ts` pasa.

#### F4: Campos y builder
**Descripción:**
- **Modelo** en `lib/forms/fields.ts` (puro, sin Zod en lo que importa el embed): `FormFieldType = "short_text" | "long_text" | "email" | "phone" | "number" | "single_select" | "multi_select" | "date" | "rating" | "nps" | "file" | "consent" | "hidden"`. Cada campo: `{ id, key, type, label, help?, placeholder?, required, options?, min?, max?, file?: {accept: string[], maxMb: number, maxFiles: number}, consentText?, hidden?: {source: "url_param" | "fixed", param?: string, value?: string}, visibility?: VisibilityConfig, prefill?: PrefillConfig }`, con `hidden.source` que admite también **`"attribution"`** (toma el valor de la atribución efectiva de la visita, F6: por ejemplo `utm_campaign` aunque la persona haya llegado a otra página con ese UTM y después navegado).
- **`PrefillConfig = { params: string[], behavior: "editable" | "locked" | "hidden" }`** (v1.1, decisión 184). `params`: los nombres de parámetro de URL que llenan el campo, en orden de prioridad; por defecto `[key]`; cada uno con `^[a-zA-Z0-9_.-]{1,40}$`, hasta 5 por campo, y no se repiten entre campos. `behavior`: `editable` (por defecto: aparece lleno y se puede cambiar), `locked` (aparece lleno y deshabilitado; reemplaza al viejo `lockIfPrefilled`) u `hidden` (si vino lleno, **no se muestra** y se envía igual; si no vino, se muestra normal). Aplica a todos los tipos **salvo** `file`, `consent` (el consentimiento no se puede dar por URL) y la firma.
- `key` se genera con `identifierFromLabel` + `uniqueIdentifier` de la Agenda (H5) y **no cambia** cuando se edita la etiqueta (es la clave de las respuestas y de `{{answer.<key>}}`). Se puede editar a mano mientras el formulario nunca se publicó.
- **Validación de la definición** con Zod en `lib/forms/definition-schema.ts`: claves únicas y con `IDENTIFIER_RE`; selección con 2 a 50 opciones sin repetidas; `min ≤ max`; `rating` con `max` 5 fijo; `nps` 0-10 fijo; `file.maxMb ≤ 10`, `maxFiles ≤ 3`, `accept ⊆ ALLOWED_UPLOAD_MIMES` (imágenes jpeg/png/webp, pdf, docx, xlsx); `hidden` con `param` o `value`; una condición solo puede mirar campos **anteriores**; a lo sumo 60 campos.
- **Builder** propio en `components/forms/builder/` (`fields-builder.tsx`, `field-editor.tsx`, `field-type-picker.tsx`): lista ordenable con flechas (como la Agenda, sin dependencias de arrastre), editor del campo en panel, vista previa a la derecha que usa **el mismo** componente de la página pública.
- **No se modifica** el `FormBuilder` de la Agenda (D2, §12).

**Criterios:**
- CUANDO se cambia la etiqueta de un campo de un formulario ya publicado, su `key` NO DEBE cambiar.
- CUANDO dos campos tienen la misma `key`, la validación DEBE fallar nombrando la clave.
- CUANDO una condición mira un campo posterior, DEBE fallar con "una condición solo puede mirar preguntas anteriores".
- CUANDO un campo archivo pide 15 MB o un tipo fuera de la lista, DEBE fallar.
- CUANDO una selección tiene opciones repetidas (sin importar mayúsculas), DEBE fallar.
- CUANDO dos campos declaran el mismo parámetro de prellenado, o un campo `consent`/`file` tiene `prefill`, la validación DEBE fallar nombrando el campo.
- Los 13 tipos DEBEN tener una entrada en `FIELD_TYPE_LABELS` y en el renderizador público (test de paridad que recorre la lista).
- Test: `lib/forms/fields.test.ts` y `lib/forms/definition-schema.test.ts` pasan; el `lib/scheduling/booking-fields.test.ts` existente sigue en verde sin cambios.

#### F5: Condiciones (mostrar u ocultar)
**Descripción:**
- `VisibilityConfig = { rootConjunction: "and"|"or", conditions: Condition[], groups: {conjunction, conditions[]}[] }`, `Condition = { fieldKey, operator, value }`. Operadores: `is`, `is_not`, `contains`, `not_contains`, `gt`, `lt`, `gte`, `lte`, `is_empty`, `is_not_empty`, `includes_any` (para selección múltiple).
- Función pura `isFieldVisible(field, answers)` y `visibleFieldKeys(fields, answers)` en `lib/forms/visibility.ts`. **Encadenada:** un campo cuya condición mira un campo oculto ve ese valor como vacío (así no se puede "colar" una respuesta por un campo que no se mostró).
- Interfaz: `components/forms/builder/visibility-rule-builder.tsx` (portado de prevxcrm, sobre `components/ui`).
- **En el servidor** (F12): se recalcula `visibleFieldKeys` con las respuestas recibidas; todo campo no visible **se descarta** (no se guarda) aunque venga con valor, y sus obligatorios no se exigen.

**Criterios:**
- DADO "mostrar `presupuesto` si `facturacion` is `más de 10k`" y `facturacion = "menos de 1k"`, `isFieldVisible` DEBE dar false.
- DADO un grupo `(A or B) and C`, DEBE evaluarse con ese agrupamiento.
- DADO un campo C visible solo si B tiene valor, y B oculto por su propia condición pero con valor en las respuestas, C DEBE quedar oculto (encadenado).
- DADO `gt` sobre un número que llega como texto `"12"`, DEBE comparar numéricamente.
- CUANDO el servidor recibe un valor para un campo oculto por condición, la respuesta guardada NO DEBE contenerlo.
- Test: `lib/forms/visibility.test.ts` pasa (los 5 casos).

#### F6: Prellenado por URL, campos ocultos y atribución
**Descripción:**
- **Prellenado (v1.1):** función pura `prefillFromParams(fields, params)` en `lib/forms/prefill.ts`. Para cada campo con prellenado, recorre `prefill.params` (por defecto `[key]`) y toma el **primero** que venga con valor. Selección: solo si el valor es una opción válida (sin distinguir mayúsculas); múltiple separado por coma; fecha ISO `AAAA-MM-DD`; número dentro de `min`/`max`; email y teléfono normalizados con las mismas funciones del envío; NPS 0-10 y estrellas 1-5 enteros. Un valor que no pasa su validación **se ignora** (el campo queda vacío, nunca a medias). Devuelve `{ values, locked: Set<key>, hiddenByPrefill: Set<key> }` según el `behavior` de cada campo.
- Fuentes del prellenado, en este orden (gana la primera que trae el parámetro): (1) `prefill` explícito del código (`<Formulario prefill>`, F31, o la config del embed, F10); (2) los parámetros de la URL de la página donde está el formulario (`/f/<slug>`, la página del sitio, o la página que lo embebe, F10). La atribución persistida **no** prellena campos visibles: solo ocultos con `source: "attribution"`.
- **Campo oculto:** `source: "url_param"` toma `params[param]`; `source: "attribution"` toma la clave de la atribución efectiva (abajo); `source: "fixed"` toma `value`, que **nunca** viaja al navegador (lo pone el servidor al guardar, F9 y F12).
- **Claves de atribución, una sola fuente (v1.1, decisión 185):** `lib/attribution/keys.ts` (puro, sin dependencias, lo importa el embed):
  - `UTM_KEYS`: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`.
  - `CLICK_ID_KEYS`: `fbclid` (Meta), `gclid`, `gbraid`, `wbraid` (Google), `msclkid` (Microsoft), `ttclid` (TikTok), `li_fat_id` (LinkedIn), `twclid` (X), `sccid` (Snapchat, también `ScCid`), `epik` (Pinterest), `rdt_cid` (Reddit).
  - `AD_KEYS`: `ad_id`, `adset_id`, `campaign_id`, `placement`.
  - `COOKIE_KEYS` (las lee el navegador, nunca la URL): `_fbp` → `fbp`, `_fbc` → `fbc`, `_ga` → `ga_client_id` (los dos últimos números de la cookie).
  - **No se cambian** `UTM_KEYS` ni `CLICK_ID_KEYS` de `lib/scheduling/booker/embed-params.ts` (los usa la Agenda): las del formulario son un superconjunto aparte, y un test verifica que lo contienen.
- **Atribución de la visita:** función pura `attributionFromParams(params, { referrer, landing, cookies, now })` en `lib/attribution/collect.ts` → objeto plano con las claves de arriba que vinieron (nada inventado), más `referrer_url` (por `safeReferrer`), `landing_page` (sin query sensible: solo origen + ruta + las claves de atribución) y `page_url` (donde está el formulario). Recorta cada valor a 200 caracteres. Si vino `fbclid` y no hay cookie `_fbc`, arma `fbc = "fb.1.<ms>.<fbclid>"` (el formato de Meta), para poder usarlo después con la API de conversiones.
- **Atribución efectiva** (función pura `effectiveAttribution(current, stored)` en `lib/attribution/merge.ts`): si la URL actual trae **alguna** clave de UTM, clic o anuncio, gana la actual (es un toque nuevo); si no, se usa el **último** toque persistido (F29) con su `landing_page` y su `referrer_url`. Siempre se adjunta `first_visit` (el primero persistido) y `page_url` actual. Las cookies (`fbp`, `fbc`, `ga_client_id`) se suman siempre que existan.
- En el embed, los parámetros y la atribución vienen de la página que lo contiene (F10).

**Criterios:**
- `prefillFromParams` con `?email=ana@x.com&plan=Otro` sobre un `plan` de opciones `[A,B]` DEBE prellenar el email y NO el plan.
- DADO un campo `email` con `prefill.params = ["correo","email"]` y la URL `?email=b@x.com&correo=a@x.com`, DEBE prellenarse con `a@x.com`.
- DADO un campo con `behavior = "hidden"` y la URL lo trae, NO DEBE mostrarse y su valor DEBE enviarse; sin el parámetro, DEBE mostrarse normal.
- DADO un campo `number` con `max = 10` y `?cantidad=50`, DEBE quedar vacío.
- DADO un campo bloqueado prellenado con `pro` y el navegador manda `free`, el servidor DEBE guardar `free` **solo si** `free` pasa la validación del campo (se trata como cualquier respuesta: se valida, no se confía, alcance §3.3). Lo mismo con un campo `hidden` por prellenado.
- DADO un oculto `fixed` con valor `octubre`, la definición pública NO DEBE contener `octubre` y la respuesta guardada SÍ.
- `attributionFromParams` con `utm_source=facebook&ad_id=123&utm_campaign=octubre` DEBE devolver esos tres valores y nada inventado; con `fbclid=abc` y sin cookie `_fbc`, DEBE devolver `fbc` con el formato `fb.1.<ms>.abc`; con `msclkid`, `gbraid` y `ScCid`, DEBE devolverlos (este último como `sccid`).
- `effectiveAttribution` con URL sin UTM y un último toque persistido `{utm_campaign:"octubre"}` DEBE dar `utm_campaign = "octubre"`; con URL `?utm_campaign=noviembre`, DEBE dar `noviembre` y `first_visit` intacto.
- `CLICK_ID_KEYS` de `lib/attribution/keys.ts` DEBE contener todas las de `lib/scheduling/booker/embed-params.ts`.
- Test: `lib/forms/prefill.test.ts`, `lib/attribution/keys.test.ts`, `lib/attribution/collect.test.ts` y `lib/attribution/merge.test.ts` pasan.

#### F7: Diseño y pantalla de éxito
**Descripción:**
- `forms.design jsonb`: `{ title, intro (texto con saltos de línea), submitLabel, showLogo: boolean }`. El logo y el color salen de `lib/brand.ts` (white label, variables de entorno); no hay subida de logo por formulario.
- `forms.success jsonb`: `{ mode: "message", title, body, button?: {label, url} }` **o** `{ mode: "redirect", url, passParams: boolean }`. Las URLs se validan `http(s)`. `body`, `title` y `button.url` admiten variables `{{answer.<key>}}` y `{{form.name}}`, resueltas **en el servidor** al responder el envío (función pura `renderSuccess(success, ctx)`, con escape HTML; una variable que no resuelve queda vacía en la pantalla pública, no cruda).
- Con `passParams`, la redirección suma `submission_id` y los UTM recibidos.

**Criterios:**
- CUANDO `mode = "redirect"` y la URL no es `http(s)`, guardar DEBE fallar.
- `renderSuccess` con `"Gracias {{answer.nombre}}"` y `nombre = "<b>Ana</b>"` DEBE devolver el texto escapado.
- DADO `passParams = true`, la URL de redirección DEBE incluir `submission_id` y los UTM y NO DEBE incluir respuestas.
- Test: `lib/forms/success.test.ts` pasa.

#### F8: Publicación y versiones
**Descripción:**
- El editor trabaja sobre `forms.draft_definition jsonb`. **Publicar** llama a la función SQL `publish_form_version(p_form_id uuid, p_actor uuid)` (00152), que en **una transacción**: valida que la definición cambió respecto de la versión vigente (si no cambió, devuelve la vigente), inserta `form_versions` con `version_number + 1`, copia `definition`, y si es contrato copia `contract_text` y guarda `contract_text_sha256 = encode(sha256(convert_to(contract_text,'UTF8')),'hex')`; apunta `forms.current_version_id`, pone `status = 'published'`, `published_at`, y escribe el `audit_log` (`entity_type 'form'`, `action 'form.published'`).
- **Antes** de llamar, la Server Action valida la definición con `definition-schema` (F4), exige slug válido (`^[a-z0-9-]{3,60}$`) y **Turnstile configurado** (F11); si falta, publicar se bloquea con el motivo y un link a Integraciones.
- El texto del contrato se normaliza antes de guardar (función pura `normalizeContractText`: NFC, `\r\n` → `\n`, sin espacios al final de línea): lo que se hashea es exactamente lo que se guarda.
- Una versión publicada **nunca** se edita (no hay UPDATE sobre `form_versions` en la RLS ni en la acción).
- Cambiar el slug de un formulario publicado avisa que los links viejos dejan de funcionar y exige confirmar.

**Criterios:**
- CUANDO se publica sin cambios, NO DEBE crearse una versión nueva.
- CUANDO se publica un contrato, `contract_text_sha256` DEBE coincidir con el SHA-256 calculado en Node sobre el mismo texto guardado (test de paridad SQL/TS en `verify-forms.mjs`).
- CUANDO se cambia el texto de un contrato con 3 firmas y se publica, DEBE existir la versión 2 y las 3 firmas DEBEN seguir apuntando a la versión 1.
- CUANDO Turnstile no está configurado, publicar DEBE rechazarse con "Configurá Cloudflare Turnstile en Integraciones para publicar".
- CUANDO se intenta un UPDATE sobre `form_versions`, DEBE fallar.
- Test: `lib/forms/publish.test.ts` y `lib/forms/contract-text.test.ts` pasan; `verify-forms.mjs` cubre la transacción y la paridad del hash.

#### F9: Definición pública segura y página pública
**Descripción:**
- **Función SQL `get_public_form(p_slug text) returns jsonb`** (00152, `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`, `GRANT EXECUTE` a `anon`, `authenticated`, `service_role`). Devuelve **solo**:
  `{ status: "available"|"unavailable", slug, type, version_id, design, fields: [<campo público>], contract: {text, version_number}|null, signature_required, survey: {scoreFieldKey}|null, turnstile_site_key }`.
  - **Campo público** = `{key, type, label, help, placeholder, required, options, min, max, file, consentText, visibility, prefill}` y, para ocultos, solo `{key, type:"hidden", hidden:{source:"url_param"|"attribution", param}}`. **Los ocultos `fixed` no se devuelven.**
  - **Nunca** devuelve: `id` del formulario, `workspace_id`, `contact_config`, `tags_on_submit`, `notify_*`, `draft_definition`, `created_by`, `success` (el éxito lo arma el servidor al responder el envío), nombres internos, conteos.
  - Formulario `draft`, `paused` o `archived`, o slug inexistente → `{ status: "unavailable" }` (no distingue cuál).
- **Página** `app/f/[slug]/page.tsx` (Server Component): llama a `get_public_form` con el cliente de servicio, arma el prellenado con los `searchParams`, y renderiza `components/forms/public/public-form.tsx` (Client Component) con el logo y el color de `lib/brand.ts`. Sin sesión. `unavailable` → "Este formulario no está disponible".
- `lib/security-headers.ts`: `EMBEDDABLE_PREFIXES` suma `"/f"` y `nextHeadersConfig` suma la fuente `/f/:path*` y excluye `f` del lookahead del resto.
- Renderizador público: un componente por tipo de campo en `components/forms/public/fields/*`, la visibilidad con `visibleFieldKeys` (F5) en vivo, validación en el navegador con el **mismo** esquema que el servidor (`buildSubmissionSchema`, F12), estados de envío (enviando, error por campo, error general con "Reintentar", éxito).

**Criterios:**
- CUANDO se llama `get_public_form` de un formulario publicado, la respuesta NO DEBE contener las claves `workspace_id`, `contact_config`, `tags_on_submit`, `notify_user_ids`, `draft_definition`, `success`, ni el `value` de ningún oculto `fixed` (test en `verify-forms.mjs` que recorre el JSON entero buscando esas claves y el valor sembrado).
- CUANDO se llama con el rol `anon` directamente (sin pasar por la app), DEBE devolver lo mismo y nada más (la RLS de `forms` no tiene policy para `anon`: un `select` directo sobre `forms` con `anon` DEBE dar 0 filas).
- CUANDO el formulario está pausado, archivado o en borrador, DEBE devolver `{status:"unavailable"}` y la página DEBE mostrar "Este formulario no está disponible".
- CUANDO se pide `/f/<slug>`, los headers DEBEN ser `frame-ancestors *` (embebible); `/dashboard` DEBE seguir con `X-Frame-Options: DENY`.
- Test: `lib/security-headers.test.ts` extendido y `lib/forms/public-definition.test.ts` (la función pura `toPublicField` que espeja la lista blanca, con test de paridad contra las claves que devuelve la SQL en `verify-forms.mjs`) pasan.

#### F10: Embed
**Descripción:**
- **Se extiende el mismo script** `public/embed/embed.js` (no uno nuevo): una web con agenda y formulario carga un solo script.
- `lib/embed/url.ts`: `CAL_LINK_RE` admite también `^f\/[a-z0-9-]+$`; `buildEmbedIframeUrl("f/<slug>", config, parentUtm)` arma `/f/<slug>?embed=1&…` con los UTM y click ids de la página padre (los mismos `UTM_KEYS` y `CLICK_ID_KEYS`), más `ad_id`, `adset_id`, `campaign_id` si están, y `referrer` (la URL de la página padre). Para cualquier otro `calLink`, **el resultado no cambia**.
- `inline`, `modal` y el botón flotante funcionan igual con `f/<slug>`. La página `/f/[slug]` con `embed=1` usa `lib/embed/iframe-side.ts` para avisar el alto (mismo protocolo `agenda-embed`).
- **Parámetros y atribución desde la página que lo contiene (v1.1):** para `f/<slug>`, el script además:
  - Pasa al iframe **los parámetros de la URL de la página** que no son de atribución, para el prellenado (F6): solo nombres con `^[a-zA-Z0-9_.-]{1,40}$`, hasta 30 parámetros de hasta 500 caracteres, y **nunca** los que parecen sensibles (`token`, `password`, `pass`, `secret`, `key`, `code`, `auth`, `session`, `access_token`, `id_token`, ni los que empiezan con `_`). El formulario ignora los que no declara.
  - Acepta `config.prefill` (`{ <param>: valor }`) para que quien pega el embed fije valores; gana sobre la URL.
  - Lee en la página que lo contiene las cookies `_fbp`, `_fbc` y `_ga` (son de ese dominio: el iframe no las ve) y la atribución persistida de ese sitio (F29), y se las pasa al iframe en un solo parámetro `attr` (JSON en base64url, hasta 2 KB). La página `/f/[slug]` lo decodifica y lo vuelve a sanear con `attributionFromParams`: **no se confía**.
  - `referrer` sigue siendo la URL de la página que lo contiene; `landing_page` sale de la atribución persistida de ese sitio si existe.
- **Pestaña Publicar** del editor: link público con "Copiar", código del embed (inline y botón) generado con `lib/embed/code.ts`, y "Link firmado para un contacto" (FO3, F22). La v1.1 suma la sección de parámetros y el código para páginas del sitio (F32).
- Antes de habilitar `f/…`, la exploración confirma que no existe un usuario de agenda con username `f` (`select count(*) from scheduling_profiles where username = 'f'`); si existe, se anota y se usa el prefijo `form/` en su lugar.
- `node scripts/build-embed.mjs` regenera el bundle; **el archivo se commitea**.

**Criterios:**
- `buildEmbedIframeUrl("f/aplicacion", {}, {utm_source:"facebook", fbclid:"x"}, "https://app.x")` DEBE dar `https://app.x/f/aplicacion?embed=1&utm_source=facebook&fbclid=x`.
- `buildEmbedIframeUrl("ana/llamada", …)` DEBE dar **exactamente** lo mismo que antes del cambio (los casos existentes de `url.test.ts` sin modificar).
- `buildEmbedIframeUrl("f/aplicacion", {prefill:{plan:"pro"}}, {}, "https://app.x", {hostParams:{email:"a@x.com", token:"zzz"}})` DEBE incluir `email` y `plan` y NO `token`.
- DADO un sitio con cookie `_fbp=fb.1.1.2`, el iframe DEBE recibir `attr` con `fbp`, y la respuesta guardada DEBE tenerlo en `attribution.fbp` (test con un `document` simulado en `lib/embed/embed-source.test.ts`).
- `public/embed/embed.js` DEBE pesar menos de 60 KB y empezar con `/* Agenda embed`.
- Test: `lib/embed/url.test.ts` (extendido), `lib/embed/build.test.ts` y `lib/embed/code.test.ts` pasan.

#### F11: Cloudflare Turnstile
**Descripción:**
- Migración `00154_integration_captcha.sql`: el CHECK de `integration_configs.type` suma `'captcha'` (lista leída de la base, vieja en la cabecera).
- `lib/types/database.ts`: `IntegrationType` suma `"captcha"`.
- `lib/secret-names.ts`: `turnstileSecretKey: "turnstile_secret_key"` y `formsLinkSecret: "forms_link_secret"`.
- `lib/integrations/providers.ts`: entrada `turnstile` (`type: "captcha"`, `connection: "api_key"`, sección nueva "Seguridad"), con el campo de configuración **no secreto** `site_key` (en `integration_configs.config`) y el secreto `turnstile_secret_key` (a Vault). "Probar y guardar" llama a `siteverify` con un token de prueba vacío y acepta como válida la respuesta `invalid-input-response` (prueba que la secret key existe y Cloudflare la reconoce); `invalid-input-secret` → error "La secret key no es válida".
- `lib/forms/turnstile.ts` (solo servidor): `verifyTurnstile({ secret, token, ip, idempotencyKey, fetchImpl })` → `{ ok: true } | { ok: false, codes: string[] }`. `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` con `secret`, `response`, `remoteip` e `idempotency_key`; timeout 5 s. **Nunca lanza.** Si Cloudflare no responde: `{ ok: false, codes: ["network"] }` y el envío responde 503 "Probá de nuevo en un momento" (no se acepta sin verificar).
- La página pública carga `https://challenges.cloudflare.com/turnstile/v0/api.js` y renderiza el widget con la `turnstile_site_key` que trae `get_public_form`.
- La secret key nunca se loguea ni vuelve al navegador.

**Criterios:**
- CUANDO se aplica la 00154, la definición del CHECK DEBE contener **todos** los tipos que tenía más `captcha` (test de caracterización en `verify-forms.mjs`).
- CUANDO `siteverify` responde `success: true`, `verifyTurnstile` DEBE dar `ok: true`.
- CUANDO responde `success: false` con `timeout-or-duplicate`, DEBE dar `ok: false` con ese código.
- CUANDO `fetch` falla, DEBE dar `ok: false, codes: ["network"]` y NO lanzar.
- El cuerpo enviado a Cloudflare DEBE incluir `idempotency_key` (test que inspecciona el cuerpo).
- Ningún archivo `"use client"` DEBE alcanzar `lib/forms/turnstile.ts` (extensión del test `lib/vault-boundary.test.ts`).
- Test: `lib/forms/turnstile.test.ts` y `lib/integrations/providers.test.ts` (extendido) pasan.

#### F12: Envío seguro
**Descripción:** `POST /api/public/forms/[slug]/submit` (`multipart/form-data`: un campo `payload` JSON + los archivos) → `lib/forms/submit.ts` → RPC `submit_form_response`.

**El orden, y por qué es ese:**
1. **Tope por IP** (`lib/antispam/rate-limit.ts`, clave `forms:submit:<hashIp>`): **20 envíos por IP por hora** y por formulario `forms:submit:<form>:<hashIp>`: **5 por hora**. Superado → 429. **No** se registra `form_rejected` (un ataque llenaría `analytics_events`): lo cuenta `rate_limits`.
2. **Formulario disponible:** se relee con el cliente de servicio la versión vigente (`current_version_id`) **y** su definición completa (incluidos los ocultos `fixed`). No disponible → 404 `unavailable`.
3. **Forma del pedido** (Zod): `idempotency_key` UUID v4, `turnstile_token`, `answers`, `version_id`, `honeypot`, `attribution`, `client_meta` (zona, idioma, pantalla), y para contratos `signature` (PNG base64 ≤ 200 KB) + `signature_strokes` (entero) + `accepted` (bool).
   - **v1.1:** el servidor **no confía** en `attribution`: la vuelve a pasar por `attributionFromParams` y `effectiveAttribution` (F6), y en `/f` y en las páginas del sitio también lee la cookie `ssa_attr` del pedido, que llega sola porque es del mismo dominio (F29). En el embed, la atribución llega por el parámetro `attr` (F10). Se queda solo con las claves de `lib/attribution/keys.ts`, y cada valor se recorta a 200 caracteres.
4. **Idempotencia, primero:** si ya existe una respuesta con `(form_id, idempotency_key)`, se devuelve **el mismo resultado** que la primera vez (200 con `duplicate: true`) sin verificar Turnstile de nuevo (el token ya se consumió) y sin disparar nada.
5. **Honeypot** (`website`): lleno → se responde éxito falso (200) sin guardar, y se registra `form_rejected` con `reason: "honeypot"` (F14).
6. **Turnstile** (`verifyTurnstile` con `idempotency_key`). Falla → 400 `captcha_failed` y se registra `form_rejected` con `reason: "captcha"` (F14). **Caso carrera:** si el código es `timeout-or-duplicate`, se vuelve a buscar por `idempotency_key`; si la respuesta ya existe (la otra pestaña ganó), se devuelve esa.
7. **Versión:** si `version_id` no es la vigente (el formulario se republicó mientras la persona completaba), se valida contra la **vigente**; si eso falla, 409 `form_changed` con "El formulario cambió: recargá la página".
8. **Validación total en el servidor** con `buildSubmissionSchema(definition, { defaultCountry })` (`lib/forms/submission-schema.ts`, patrón de `buildBookingSchema`): visibilidad recalculada (F5) — lo oculto se descarta —, obligatorios, formatos (email, teléfono normalizado con `normalizePhoneWithCountry`, fecha ISO, número), opciones válidas, rangos (`min`/`max`, estrellas 1-5, NPS 0-10 enteros), consentimiento obligatorio = `true`, claves desconocidas descartadas. Error → 400 con `fields: {key: mensaje}`.
9. **Archivos:** por cada campo `file` visible: cantidad ≤ `maxFiles`, tamaño ≤ `maxMb`, **tipo real** con `sniffUploadMime(primeros bytes, declarado)` dentro de `accept`. Se suben con el cliente de servicio a `form-uploads/{workspace_id}/{form_id}/{idempotency_key}/{field_key}/{uuid}.{ext}` (la carpeta usa la clave de idempotencia porque el id de la respuesta todavía no existe; queda guardada en la respuesta). Un fallo → 400 por campo.
10. **Ocultos `fixed`:** el servidor agrega sus valores a las respuestas.
11. **Guardar** con la RPC `submit_form_response(p_form_id, p_version_id, p_idempotency_key, p_answers jsonb, p_attribution jsonb, p_meta jsonb, p_contact_hint jsonb)` en una transacción: guarda la respuesta con `answers` en formato **con etiqueta** (`{ <key>: { label, type, value } }`, la etiqueta de **esa** versión), `status`, `attribution`, `meta` (ip_hash, user_agent, zona, `origin: public_page|embed`). Los envíos se cuentan desde `form_submissions` (F14): no hay contador aparte. En FO1 (v1) la respuesta queda `status = 'no_contact'`; FO2 (00156) agrega el contacto. **Violación del único de idempotencia (23505)** → se relee y se devuelve la existente.
12. **Responder** `{ ok: true, submission_id, success: renderSuccess(...) }` (F7).

- **Si algo falla después de guardar** (subir un archivo no, eso es antes): nada de lo que viene después (aviso, etiquetas, toque) puede convertir un envío guardado en un error para quien respondió. Van en `try/catch` y se loguean sin datos personales.
- Los logs no escriben respuestas, emails ni teléfonos: solo `form_id`, `submission_id` y el resultado.

**Criterios:**
- CUANDO llegan dos pedidos con la misma `idempotency_key` **en paralelo**, DEBE existir **una** respuesta y los dos DEBEN responder 200 con el mismo `submission_id` (test de concurrencia real en `verify-forms.mjs`: 5 pedidos simultáneos con la clave de prueba de Turnstile que siempre aprueba).
- CUANDO el honeypot viene lleno, DEBE responder 200, NO DEBE guardar respuesta y DEBE existir un `analytics_events` `form_rejected` con `reason: "honeypot"` y `contact_id` null.
- CUANDO Turnstile rechaza (secret de prueba `2x…`), DEBE responder 400 `captcha_failed`, NO DEBE guardar respuesta y DEBE existir un `form_rejected` con `reason: "captcha"`.
- CUANDO se supera el tope por IP, NO DEBE escribirse `form_rejected`.
- CUANDO falta un obligatorio visible, DEBE responder 400 con el campo; CUANDO falta un obligatorio **oculto por condición**, NO DEBE exigirlo.
- CUANDO llega una opción que no existe en una selección, DEBE responder 400.
- CUANDO un NPS llega como 11 o 7.5, DEBE responder 400.
- CUANDO un archivo `.exe` llega renombrado a `.pdf`, DEBE rechazarse por tipo real; CUANDO pesa 12 MB, por tamaño.
- CUANDO se supera el tope por formulario, DEBE responder 429.
- CUANDO el formulario se republicó durante el llenado y las respuestas siguen siendo válidas, DEBE guardarse con la versión **vigente**.
- La respuesta guardada DEBE tener la etiqueta de cada campo **de la versión con la que se guardó** (test: se renombra el campo y se publica; la respuesta vieja conserva la etiqueta vieja).
- Test: `lib/forms/submission-schema.test.ts`, `lib/forms/submit.test.ts` (con Supabase y Turnstile simulados, los 10 casos) y `lib/antispam/rate-limit.test.ts` pasan; `verify-forms.mjs` cubre la concurrencia.

#### F13: Respuestas
**Descripción:** `/dashboard/formularios/[id]/respuestas` y el detalle `/dashboard/formularios/[id]/respuestas/[submissionId]`.
- **Tabla:** fecha (zona del workspace), contacto (link a la ficha) o "Sin contacto", estado (Recibida · Sin contacto · Spam), y una columna por cada campo de la **versión vigente** más las columnas de campos que ya no existen si hay respuestas viejas con ellos (función pura `responseColumns(versions, submissions)`, que usa la etiqueta más reciente de cada clave). Encuestas: columna de puntaje; contratos: estado del email.
- **Filtros en la URL:** rango de fechas, estado, con o sin contacto. Paginación de 50. RLS: el Member ve solo las de contactos que ve (F1).
- **Detalle:** cada respuesta con la etiqueta con la que se respondió, archivos (link firmado de 60 s generado en el servidor solo si `can_see_form_submission`), atribución de la visita, versión, origen, y `<Historial entityType="form_submission" entityId>` (de Llamadas; lo ven Owner y Admin, §16).
- **Marcar como spam** (`forms.manage`): `status = 'spam'`, sale de métricas y paneles, queda en el historial. Reversible.
- **Exportar CSV** (`lib/forms/export.ts`, portado de `form-responses-export.ts`): las columnas visibles con el filtro actual, fechas en la zona del workspace, múltiples unidas por `; `, **protección contra inyección de fórmulas** (un valor que empieza con `=`, `+`, `-`, `@` o tab se prefija con `'`), BOM UTF-8. Se genera en el servidor respetando la RLS de quien exporta. Tope 10.000 filas por exportación (con aviso).

**Criterios:**
- CUANDO una respuesta vieja tiene un campo que la versión vigente borró, la tabla DEBE mostrar su columna con la etiqueta vieja.
- CUANDO un valor empieza con `=SUM(`, el CSV DEBE tenerlo como `'=SUM(`.
- CUANDO un Member exporta, el CSV DEBE tener solo las respuestas que ve.
- CUANDO se marca spam, la respuesta NO DEBE contar en métricas ni en el panel de encuesta.
- CUANDO quien mira no puede ver la respuesta, NO DEBE obtener link firmado del archivo.
- Test: `lib/forms/responses.test.ts` y `lib/forms/export.test.ts` pasan.

#### F14: Métricas
**Descripción:** `/dashboard/formularios/[id]/metricas`. **No hay tabla de contadores** (decisión de Wendy, 10/10): cada cosa sale de donde ya está.

| Métrica | De dónde sale |
|---|---|
| **Vistas** | `analytics_events` con `event_type = 'form_view'`, `contact_id = null`, `metadata = {form_id, version_id}` |
| **Inicios** (primera interacción) | `analytics_events` con `event_type = 'form_start'`, misma `metadata` |
| **Envíos** | `form_submissions` con `status IN ('received','no_contact')` |
| **Spam** (marcado a mano) | `form_submissions` con `status = 'spam'` (se muestra aparte y **no** cuenta como envío) |
| **Rechazados** (captcha o honeypot) | `analytics_events` con `event_type = 'form_rejected'`, `metadata = {form_id, version_id, reason: "captcha"|"honeypot"}`. **Decisión:** se registran ahí y no en `form_submissions`, para no guardar basura en las respuestas. Los cortados por el tope por IP **no** se registran (F12) |

- **Escritura de vistas e inicios:** `POST /api/public/forms/[slug]/beacon` con `{kind: "view"|"start", sid}`. `sid` es un identificador aleatorio que la página genera una vez y guarda en `sessionStorage` (por pestaña; sobrevive a un refresh, no a cerrar la pestaña). El servidor:
  1. **Tope por IP:** 60 beacons por IP por hora en total (`forms:beacon:<hashIp>`, `lib/antispam/rate-limit.ts`). Superado → 204 sin escribir.
  2. **Deduplicado por sesión del navegador:** `bump_rate_limit('forms:<kind>:<form_id>:' || sha256(sid), <ventana de 24 h>)`; solo si devuelve **1** se inserta el evento. Así un refresh (mismo `sid`) no infla las vistas, y el `sid` no se guarda en claro en ningún lado. Sin `sid` válido (UUID) → 204 sin escribir.
  3. Formulario no publicado → 204 sin escribir (no revela nada).
  4. Inserta en `analytics_events` con el cliente de servicio: `{workspace_id, event_type, contact_id: null, flow_id: null, metadata: {form_id, version_id}}`. **Nunca** la IP, el user agent ni el `sid`.
  - La página manda `view` al montar y `start` en la primera interacción con un campo (una vez por carga). Los dos van con `keepalive`, y un error no se le muestra a la persona.
- **Lectura:** función SQL `form_metrics_daily(p_form_id uuid, p_from date, p_to date) returns table(day date, views int, starts int, submissions int, spam int, rejected int)` (00152, `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`). Exige `can_view_forms(<workspace del formulario>)` (si no, no devuelve filas), calcula `day` como `(created_at at time zone workspaces.timezone)::date`, agrupa `analytics_events` (filtrando `workspace_id`, `metadata->>'form_id'` y `event_type LIKE 'form\_%'`, que es lo que usa el índice `idx_analytics_forms` de la 00151) y `form_submissions` (índice `(form_id, created_at desc)`), y completa con ceros los días sin datos (`generate_series`). Rango máximo: 366 días. Son **conteos agregados del formulario entero**: un Member con `forms.view` ve los totales, no las respuestas (esas siguen con su RLS, F13).
- **Pantalla:** selector de período (7 / 30 / 90 días / personalizado), cuatro números (vistas, inicios, envíos, conversión = envíos / vistas), "rechazados" y "spam" como dato secundario, gráfico de barras por día (recharts, ya está). Lógica pura en `lib/forms/metrics.ts`: `summarize(rows)`, `conversionRate(submissions, views)` (con vistas 0 → `null`, se muestra "—"), `startRate(starts, views)`.

**Criterios:**
- DADO un envío a las 23:30 de Costa Rica del 10/10, `form_metrics_daily` DEBE contarlo en el día 10/10 (no en el 11/10 UTC); ídem para una vista a esa hora.
- CUANDO la misma pestaña recarga el formulario 5 veces (mismo `sid`), DEBE existir **un** `form_view`; CUANDO se abre en otra pestaña (otro `sid`), dos.
- CUANDO una IP manda 61 beacons en una hora, el 61 NO DEBE escribir nada.
- Los eventos `form_view`, `form_start` y `form_rejected` DEBEN tener `contact_id` null y su `metadata` NO DEBE contener IP, user agent ni `sid` (test que inspecciona la fila en `verify-forms.mjs`).
- CUANDO se abre la ficha de un contacto, su historial NO DEBE incluir ningún evento `form_*` (`lib/contacts/history.test.ts` existente en verde + caso nuevo con un `form_view` sembrado en el mismo workspace).
- Una respuesta marcada spam DEBE contarse en `spam` y NO en `submissions`.
- `conversionRate(3, 0)` DEBE dar `null`; `conversionRate(3, 12)` DEBE dar `0.25`.
- CUANDO quien consulta no pasa `can_view_forms`, `form_metrics_daily` NO DEBE devolver filas.
- `EXPLAIN` de la consulta de vistas de `form_metrics_daily` DEBE usar `idx_analytics_forms` (chequeo en `verify-forms.mjs` con datos sembrados y `enable_seqscan = off` en la sesión de prueba).
- Test: `lib/forms/metrics.test.ts` y `app/api/public/forms/beacon.test.ts` (con Supabase simulado: tope, deduplicado, sin `sid`) pasan; `verify-forms.mjs` cubre `form_metrics_daily` con la zona, el índice y la `metadata` limpia.

**Bloque FO1 listo cuando:** F1 a F14 cumplen sus criterios; `npx vitest run` sale 0 (incluidos los tests existentes de embed, security-headers, booking-fields, permisos y nav); `npm run build` compila; `npm run lint` sin errores nuevos; `node scripts/verify-forms.mjs` y `node scripts/verify-rls.mjs` salen 0; `public/embed/embed.js` regenerado, commiteado y < 60 KB.

---

### Bloque FO2: Contacto, atribución y automatizaciones

#### F15: Pestaña Contacto (mapeo y modo)
**Descripción:**
- `forms.contact_config jsonb`, validado con Zod (`lib/forms/contact-config.ts`):
  ```
  { mode: "create_or_link" | "link_only",          // default create_or_link
    update: "fill_empty" | "overwrite",              // default fill_empty
    map: [ { fieldKey, target } ] }
  ```
  `target` ∈ `contact.display_name` · `contact.first_name_part` · `contact.last_name_part` · `contact.email` · `contact.phone` · `contact.whatsapp_phone` · `contact.country` · `contact.custom.<slug>` (un `custom_field_definitions` activo del workspace).
- **Nombre y apellido:** `contacts` tiene **solo** `display_name` (verificado). Si se mapean `first_name_part` y `last_name_part`, se arma `display_name = "<nombre> <apellido>"`. "Empresa" no es un campo fijo: se mapea a un campo personalizado (D6).
- **Compatibilidad de tipos** (función pura `targetAccepts(fieldType, target)`): email → `contact.email` o custom `email`/`text`; teléfono → `phone`/`whatsapp_phone` o custom `text`; número → custom `number`/`text`; fecha → custom `date`/`text`; consentimiento → custom `boolean`; selección única → `country` (si las opciones son códigos ISO-2) o custom `text`; múltiple → custom `text` (unidas por `, `). Un mapeo incompatible no se puede guardar.
- **Sugerencia automática** al crear: campos de tipo `email` y `phone` se mapean solos a `contact.email` y `contact.phone`; un campo con clave `nombre`/`name` a `display_name`.
- Pantalla: tabla "Campo del formulario → Campo del contacto" con selectores, los dos selectores de modo con su explicación en una línea, y un aviso fijo: **"Sin email ni teléfono mapeados, ninguna respuesta va a crear ni vincular contacto"** si el mapeo no tiene ninguno de los dos.
- Encuestas y contratos usan la misma pestaña.

**Criterios:**
- CUANDO se mapea un campo `number` a `contact.email`, guardar DEBE fallar.
- CUANDO un `contact.custom.<slug>` apunta a un campo personalizado borrado (`deleted_at`), la pantalla DEBE marcarlo "campo inexistente" y el envío DEBE ignorar ese mapeo sin fallar.
- CUANDO el mapeo no tiene email ni teléfono, DEBE mostrarse el aviso.
- Test: `lib/forms/contact-config.test.ts` pasa.

#### F16: Resolución del contacto y deduplicación
**Descripción:**
- **Función SQL nueva `find_contact_by_phone_or_email(p_workspace_id uuid, p_phone text, p_email text) returns jsonb`** (00156, `SECURITY DEFINER`, `STABLE`, `SET search_path = ''`, solo `service_role`): **misma regla que `create_booking` y `find_or_link_contact`** (H1, H2): teléfono exacto contra `phone` o `whatsapp_phone`, el más antiguo; si no, email normalizado (`public.normalize_email`) contra `email` o `secondary_email`, el más antiguo; nunca por nombre; solo `deleted_at IS NULL`. Devuelve `{ contact_id, matched_by: "phone"|"email"|null, conflict_contact_id }`, donde `conflict_contact_id` es el contacto al que apuntaba el email cuando el teléfono ganó con otro.
- **`submit_form_response` v2** (00156, `CREATE OR REPLACE`, la v1 copiada en la cabecera). Además de lo de F12:
  1. Calcula los valores del contacto desde `p_answers` con el mapeo (lo hace TypeScript con `applyContactMapping(definition, contactConfig, answers)` y se lo pasa como `p_contact_hint`: `{ display_name, email, phone, whatsapp_phone, country, custom: {<field_id>: valor}, signed_contact_id?, signed_service_id?, signed_sale_id? }`; los tres `signed_*` solo vienen de un token verificado por `verifyFormLink`, F20).
  2. Si viene `signed_contact_id` y el contacto existe en el workspace → se usa ese, sin deduplicar. `signed_service_id` y `signed_sale_id` se escriben en `form_submissions.service_id`/`sale_id` sin validar contra tablas (F20).
  3. Si no: **sin email ni teléfono** → `contact_id = null`, `status = 'no_contact'` (decisión 156). Con alguno → `find_contact_by_phone_or_email`.
  4. No existe: modo `create_or_link` → `INSERT contacts (workspace_id, display_name, email, phone, whatsapp_phone, country, last_interaction_at = now())`; modo `link_only` → sin contacto.
  5. Existe: `update = fill_empty` → `coalesce(campo, valor)` campo por campo; `overwrite` → pisa con lo que vino **no vacío** (nunca borra un dato con un vacío). Los personalizados: `INSERT … ON CONFLICT (contact_id, field_id) DO UPDATE` solo si `overwrite` o si estaba vacío. `last_interaction_at = greatest(…, now())`.
  6. Guarda en la respuesta `contact_id`, `contact_created bool`, `dedupe = {matched_by, conflict_contact_id}` y `status = 'received'`.
  7. Con contacto: inserta en `automation_events` el evento que corresponde al tipo (F19) con `payload = {submission_id, form_id, form_type, score?, nps_category?}`.
  8. `audit_log`: `entity_type 'contact'`, `action 'contact.created'` o `'contact.linked'`, `metadata {source: 'form', form_id, submission_id, matched_by}`, con `actor_type 'system'` y `actor_label 'Formulario: <nombre>'`.
- **Vincular a mano** (`forms.manage`) desde el detalle de una respuesta `no_contact`: buscador de contactos (el existente de la app); al confirmar, `contact_id`, `status = 'received'`, `audit_log`, y una casilla **"Disparar ahora las automatizaciones de este formulario"** (apagada por defecto): si se tilda, se emite el evento con la misma clave de idempotencia (`form:<tipo>:<submission_id>`), así nunca dispara dos veces.
- **No contactar:** la respuesta se guarda y el evento se emite igual; las acciones de mensaje del flow respetan la marca como en todo el sistema (alcance §3.3).

**Criterios (DADO/CUANDO/ENTONCES):**
- DADO un contacto con `phone = +50688881234`, CUANDO llega una respuesta con ese teléfono y otro email, ENTONCES DEBE vincularse a ese contacto con `matched_by = 'phone'` y, si el email era de otro contacto, `conflict_contact_id` DEBE ser ese otro.
- DADO un contacto con `secondary_email = ana@x.com`, CUANDO llega `ANA@x.com` sin teléfono, ENTONCES DEBE vincularse por email.
- CUANDO llega una respuesta **sin email ni teléfono**, NO DEBE crearse contacto, la respuesta DEBE quedar `no_contact` y NO DEBE existir `automation_events`.
- CUANDO el modo es `link_only` y no existe el contacto, NO DEBE crearse y la respuesta DEBE quedar `no_contact`.
- DADO un contacto existente con `display_name = "Ana"` y modo `fill_empty`, CUANDO llega "Ana María", `display_name` NO DEBE cambiar; con `overwrite`, DEBE cambiar; y con `overwrite` y el campo vacío, NO DEBE borrarse.
- CUANDO dos respuestas del mismo teléfono nuevo llegan en paralelo, DEBE quedar **un** contacto (la RPC toma `pg_advisory_xact_lock(hashtextextended(workspace_id || ':' || phone_o_email, 0))` antes de buscar; test de concurrencia en `verify-forms.mjs`).
- CUANDO se vincula a mano sin tildar la casilla, NO DEBE emitirse evento; tildada dos veces, DEBE haber un solo disparo (`trigger_fires`).
- `applyContactMapping` con `first_name_part = "Ana"` y `last_name_part = "Pérez"` DEBE dar `display_name = "Ana Pérez"`.
- Test: `lib/forms/contact-mapping.test.ts` pasa; `verify-forms.mjs` cubre la RPC (los 7 casos) y la concurrencia; `verify-scheduling.mjs` sigue en 0 (`create_booking` intacto).

#### F17: Atribución por toque
**Descripción:**
- Armador puro `formTouch({ submissionId, formName, formId, attribution })` en `lib/contacts/touch-entry.ts` (junto a `manualTouch` e `importTouch`):
  - `source`: `normalizeSource(utm_source) ?? "web"`.
  - `medium`: **`"form"`** siempre (como la Agenda fuerza `"booking"`); el `utm_medium` original queda en `raw.utm`.
  - `campaign`, `term`: de los UTM. `content`: `utm_content` si vino; si no, el **nombre del formulario** ("el formulario como contenido", alcance §2.2).
  - `adId`, `adsetId`, `campaignId`, `fbclid`, `gclid`, `ttclid`, `liFatId`, `referrerUrl`, `landingPage`: de la atribución de la visita (F6).
  - `origin: "form"`, `dedupeKey: "form:<submission_id>"`, `occurredAt`: **omitido** (la base usa `now()` del servidor).
  - `raw`: `{ utm: {…}, source_type: "form", source_id: <form_id> }` (claves de la lista blanca de `sanitizeRaw`). **v1.1 (F33):** también los ids y cookies que no tienen columna propia (`utm_id`, `gbraid`, `wbraid`, `msclkid`, `twclid`, `sccid`, `epik`, `rdt_cid`, `placement`, `fbp`, `fbc`, `ga_client_id`, `page_url`).
- Después de que la RPC guarda la respuesta **con contacto**, `lib/forms/submit.ts` llama `recordTouch(service, { workspaceId, contactId, touch: formTouch(…) })`. **Nunca lanza** y no tumba el envío.
- **Regla pedida por Wendy (decisión 157)** — que ya es la de `record_contact_touch` (H11): contacto nuevo → este toque es su primero (y último); contacto existente con toques → pasa a ser el **último** y el **primero no cambia**. Contacto existente **sin ningún toque previo** (por ejemplo, cargado antes de la 00114) → este toque queda como primero y último, porque es lo único que se sabe.

**Criterios:**
- `formTouch` con `utm_source=facebook&utm_campaign=octubre&ad_id=123` DEBE dar `source: "facebook"`, `medium: "form"`, `campaign: "octubre"`, `adId: "123"`, `origin: "form"`, `dedupeKey: "form:<id>"` y SIN `occurredAt`.
- `formTouch` sin UTM DEBE dar `source: "web"` y `content` = nombre del formulario.
- **Test que demuestra la regla del primer/último toque** (`verify-forms.mjs`, contra la base real con `record_contact_touch` intacta):
  - DADO un contacto **nuevo** creado por un envío con `utm_campaign=octubre`, ENTONCES `attribution.first_touch.campaign` y `attribution.last_touch.campaign` DEBEN ser `octubre` y `first_touch.medium = "form"`.
  - DADO un contacto **existente** con un toque previo `{source: "instagram", medium: "dm"}` de ayer, CUANDO envía el formulario con `utm_campaign=noviembre`, ENTONCES `first_touch.source` DEBE seguir siendo `instagram` y `last_touch.campaign` DEBE ser `noviembre`.
  - CUANDO se procesa dos veces el mismo envío (misma `dedupe_key`), DEBE haber **una** fila en `contact_touches`.
- CUANDO `recordTouch` falla (RPC simulada con error), el envío DEBE responder 200 igual.
- Test: `lib/contacts/touch-entry.test.ts` (extendido) y `lib/forms/submit.test.ts` pasan; `verify-forms.mjs` y `verify-attribution.mjs` salen 0.

#### F18: Etiquetas al enviar y aviso al equipo (nice-to-have)
**Descripción:**
- `forms.tags_on_submit uuid[]` (tags del workspace). Con contacto, la RPC inserta `contact_tags` con `ON CONFLICT DO NOTHING` (el trigger existente de tags emite su propio evento de CRM, como siempre).
- `forms.notify_enabled bool default true` y `forms.notify_user_ids uuid[]` (default: quien creó el formulario). Después de guardar, `createNotification` con tipo nuevo `form_submitted` en `lib/notifications/types.ts` (título "Nueva respuesta en <formulario>", link a la respuesta) para cada destinatario que siga en el workspace. Va en `try/catch`.
- La campana **no** pasa por el motor de flows, así que llega aunque el contacto esté marcado "no contactar" (H8): es el aviso al equipo confiable.

**Criterios:**
- CUANDO el formulario tiene la etiqueta "calificado" y el contacto ya la tenía, NO DEBE duplicarse ni fallar.
- CUANDO `notify_enabled = false`, NO DEBE crearse notificación.
- CUANDO un destinatario ya no está en el workspace, NO DEBE crearse su notificación.
- CUANDO crear la notificación falla, el envío DEBE responder 200.
- Test: `lib/forms/notify.test.ts` y `lib/notifications/types.test.ts` (extendido) pasan.

#### F19: Triggers de formulario
**Descripción:**
- **Test de caracterización antes de migrar:** `verify-forms.mjs` guarda la lista de tipos del CHECK de `triggers` y la compara después.
- Migración `00155_flows_form_id_trigger_types.sql`: el CHECK de `triggers.type` suma `form_submitted`, `survey_answered`, `contract_signed` (lista viva + nuevos; vieja en la cabecera). (La columna `flows.form_id` va en la misma migración, F21.)
- `lib/types/database.ts`: `TriggerType` suma los tres.
- **Un evento por respuesta, según el tipo de formulario** (así un mismo envío no dispara dos veces): personalizado → `form_submitted`; encuesta → `survey_answered`; contrato → `contract_signed` (se emite cuando la firma quedó guardada, F26; no espera al PDF).
- `lib/flow-engine/registry/form-triggers.ts` (importado desde `registry/index.ts`), con `scope: "event"`, `priority: 45`, `eventTypes: [type]`:
  - `eventMatches`: carga la respuesta (`submission_id` del payload) y aplica `formEventMatches(type, config, submission)` (puro, `lib/forms/automation/triggers.ts`).
  - `dedupeKeyFor`: `form:<type>:<submission_id>`.
  - `variablesFor`: F20.
- **Configuración** (`triggers.config`), validada con Zod:
  - `form_submitted`: `{ form_ids: string[] (vacío = cualquiera), answer_conditions?: VisibilityConfig }` — las mismas condiciones de F5 sobre las respuestas.
  - `survey_answered`: `{ form_ids, score?: {operator: "lte"|"gte"|"eq", value}, nps_categories?: ("promoter"|"passive"|"detractor")[], survey_categories?: string[], answer_conditions? }`.
  - `contract_signed`: `{ form_ids }`.
- `components/flow-builder/panels/TriggerPanel.tsx`: tres entradas nuevas ("Se envió un formulario", "Se respondió una encuesta", "Se firmó un contrato") con su configuración: selector múltiple de formularios del tipo (con "Cualquiera"), y el constructor de condiciones de F5 alimentado con los campos de la **versión vigente** de los formularios elegidos (si se eligen varios, solo los campos con la misma clave y tipo en todos). Lógica pura del panel en `lib/forms/automation/trigger-config.ts`.
- `docs/flow-registry.md`: se documentan los tres.

**Criterios:**
- DADO `form_submitted` con `form_ids = [A]` y una respuesta del formulario B, NO DEBE iniciarse el flow; con `form_ids = []`, SÍ.
- DADO `answer_conditions` "facturación is más de 10k" y una respuesta con "menos de 1k", NO DEBE iniciarse.
- DADO `survey_answered` con `nps_categories = ["detractor"]` y un NPS de 4, DEBE iniciarse; con 7, NO.
- DADO `score: {operator: "lte", value: 6}` y un NPS de 6, DEBE iniciarse.
- CUANDO se procesa dos veces el mismo `automation_events`, el flow DEBE iniciarse una sola vez.
- CUANDO se envía una encuesta, NO DEBE emitirse `form_submitted` (un evento por respuesta).
- CUANDO se aplica la 00155, el CHECK DEBE contener todos los tipos anteriores (incluidos los de Llamadas) más los tres nuevos.
- Los tests existentes del registro (`registry.test.ts`, `consistency.test.ts`, `crm-triggers.test.ts`) y `lib/flow-triggers.test.ts` DEBEN seguir en verde.
- Test: `lib/forms/automation/triggers.test.ts` y `trigger-config.test.ts` pasan; `verify-forms.mjs` cubre el CHECK.

#### F20: Variables de formulario
**Descripción:**
- `variablesFor` de los tres triggers arma (función pura `formVariables(form, submission, baseUrl)` en `lib/forms/automation/variables.ts`):
  ```
  form:       { id, name, type, slug, url, category }
  answer:     { <key>: texto }                 // answerToText de la Agenda: múltiples unidas por ", "
  submission: { id, url, created_at, score, nps_category, contact_created }
  ```
  `submission.url` = `<APP_URL>/dashboard/formularios/<form_id>/respuestas/<submission_id>` (pide sesión: sirve para avisos al equipo, no se le manda al contacto). `form.url` = el link público. Los archivos **no** van en `answer` (sale el nombre del archivo, no un link).
- Las claves con guion se pasan a guion bajo (el interpolador lee `\w` y guiones; se normaliza igual que `schedulingLinkVariables` para que sea predecible).
- **Link firmado por contacto** (`lib/forms/signed-link.ts`, solo servidor; vale para los tres tipos de formulario):
  - **Datos que acepta, y solo estos:** `contact_id` (obligatorio), `service_id` (opcional, para CX) y `sale_id` (opcional, para Ventas), más `form_id` y `exp` que pone el sistema. **Los tres ids viajan dentro de la firma, nunca sueltos en la URL.** Un `service_id`, `sale_id` o `contact_id` que llegue como parámetro suelto de la URL o en el cuerpo del envío **se ignora**.
  - **Formato:** `?c=<token>`, con `token = base64url(JSON {v:1, f:form_id, c:contact_id, s?:service_id, o?:sale_id, e:exp_unix}) + "." + base64url(HMAC-SHA256(payload, forms_link_secret))`. `forms_link_secret` vive en Vault por workspace y se genera la primera vez (mismo patrón que `oauth_state_secret`). Vence a los **60 días**.
  - **API:** `signFormLink({ workspaceId, formId, contactId, serviceId?, saleId?, ttlDays? })` → URL completa `<base>/f/<slug>?c=<token>`; `verifyFormLink(token, { workspaceId, formId, now })` → `{ ok: true, contactId, serviceId: string|null, saleId: string|null } | { ok: false, reason }`. **`signFormLink` es la función que usan Ventas (botón "Enviar contrato" de la venta, con `saleId`) y CX (ítems del camino, con `serviceId`)**; no hace falta otra.
  - **Cómo lo valida el servidor**, en este orden y en `submit` (y en la página, para el "Ya respondiste"): (1) formato y `v` conocido; (2) HMAC recalculado con el secreto del workspace del formulario, comparado en **tiempo constante**; (3) `exp` no vencido; (4) `f` igual al formulario del slug pedido (un token de otro formulario no sirve); (5) `c` es un contacto de **ese** workspace con `deleted_at IS NULL`; (6) `s` y `o`, si vienen, tienen formato UUID. **`service_id` y `sale_id` no se validan contra ninguna tabla** (`services` y `sales` todavía no existen): se guardan tal cual en `form_submissions.service_id`/`sale_id` (y en `contract_signatures`), y Ventas (00162) suma la FK de `form_submissions.sale_id` y la de `contract_signatures.sale_id`. CX (00172) suma la FK de `form_submissions.service_id` y la de `contract_signatures.service_id`. Ventas (00168) reescribe `submit_form_response`/`record_contract_signature` para validar el `sale_id` contra el contacto y sumarlo al payload de `form_submitted`/`contract_signed`. Si falla cualquiera de los pasos 1-5, **el token se ignora entero** (los tres ids) y el envío sigue como si no hubiera link firmado; no se responde error (no se revela nada).
  - Con token válido, la RPC recibe `p_contact_hint.signed_contact_id`, `signed_service_id` y `signed_sale_id` (F16) y los escribe en la respuesta.
- **Link de formulario en cualquier mensaje:** `{{form_link.<slug_con_guion_bajo>}}` → el link firmado para el contacto del flow, con `serviceId` = `variables.service.id` y `saleId` = `variables.sale.id` **si el flow los tiene en su contexto** (los pondrán los triggers de CX y de Ventas); si no, solo el contacto. Se resuelve en un segundo pase dentro de `lib/response-assets/bank-variables.ts` (función nueva `resolveFormLinkVariables`, llamada desde `resolveBankVariables` **solo si el texto trae `{{form_link.`**). Para eso `resolveBankVariables` acepta un campo opcional `variables` en su `context`, y los nodos `send_email` y `send_message` le pasan `context.variables` (una línea aditiva en cada uno; sin `variables`, todo funciona como hoy). No se tocan el motor ni el interpolador.
- Editor lineal y panel de variables: `FORM_VARIABLE_KEYS` + las claves `answer.*` de los formularios del trigger aparecen en el selector de variables.

**Criterios:**
- `formVariables` con una múltiple `["A","B"]` DEBE dar `answer.<key> = "A, B"`.
- CUANDO un flow de `form_submitted` manda "Hola {{answer.nombre}}", el texto DEBE salir con el nombre (test con el motor real usando `executeFlow` en modo test existente o `interpolateVariables` sobre las variables armadas).
- CUANDO un texto trae `{{form_link.como_vas}}` y el contacto existe, DEBE reemplazarse por `<base>/f/como-vas?c=<token>` con un token válido para ese contacto; CUANDO el formulario no existe, el token DEBE quedar tal cual.
- CUANDO el flow tiene `service.id` en sus variables, el token DEBE llevar ese `service_id` y la URL NO DEBE contener el id en claro (test que busca el uuid en la URL armada).
- `verifyFormLink` DEBE dar inválido con: la firma alterada en un byte, el payload cambiado (otro `service_id`) con la firma vieja, `exp` vencido, un token de otro formulario, y un contacto borrado o de otro workspace (6 casos).
- CUANDO el envío trae un token válido con `s` y `o`, la respuesta DEBE guardar `service_id` y `sale_id` aunque no existan tablas `services`/`sales`; CUANDO trae `service_id` como parámetro suelto de la URL o en el cuerpo, NO DEBE guardarse.
- CUANDO el token es inválido, el envío DEBE guardarse igual sin `contact_id`/`service_id`/`sale_id` firmados (resolución normal por teléfono o email).
- CUANDO un texto NO trae `{{form_link.`, `resolveBankVariables` NO DEBE hacer consultas nuevas (test que espía el cliente).
- `bank-variables.test.ts` existente DEBE seguir en verde.
- Test: `lib/forms/automation/variables.test.ts` y `lib/response-assets/bank-variables.test.ts` (extendido) pasan.

#### F21: Automatizaciones desde el formulario
**Descripción:**
- **`flows.form_id`** (00155): `uuid REFERENCES forms(id) ON DELETE SET NULL`, índice `idx_flows_form (form_id) WHERE form_id IS NOT NULL`. Mismo patrón que `event_type_id`.
- **Componente compartido** `components/automations/linear-flow-editor.tsx` (D3): se extrae del editor de la Agenda con props `{ backHref, routeForHeader, flowId, flowName, linear, enabled, reach?, variableKeys, describeTrigger, onSave, onSendTest }`. `components/scheduling/event-editor/linear-flow-editor.tsx` queda como **envoltorio** que pasa exactamente lo de hoy (sus variables, su `describeTrigger`, `saveLinearFlow`, `sendFlowTestEmail`).
- **Pestaña Automatizaciones** del formulario (`components/forms/editor/automations-tab.tsx`):
  - Lista de flujos con `form_id = <este>`: nombre (link al editor lineal), descripción en palabras del trigger y sus condiciones, interruptor encender/apagar (publica el flow y escribe su trigger con `buildDesiredTriggers`, igual que `toggleEventFlow`).
  - **"+ Nueva automatización"** (`forms.manage` + `flows.edit`): crea un flow `draft` con `form_id`, nombre "<formulario> · Automatización N", y un nodo trigger del tipo del formulario con `config.form_ids = [<este>]`; abre el editor lineal en `/dashboard/formularios/[id]/automatizaciones/[flowId]`.
  - **Plantillas de un clic** (nice-to-have), en `lib/forms/automation/templates.ts`, todas nacen **apagadas**: `notify_me_email` ("Avisarme por email": `send_email` `to: "fixed"` al email de quien la crea, asunto "Nueva respuesta: {{form.name}}", cuerpo con `{{submission.url}}`), `thank_you_message` ("Mandarle un mensaje de gracias": `sendMessage` + `send_email` al contacto), `add_tag` ("Ponerle un tag": `addTag` con el tag elegido). Encuesta suma `detractor_alert` (trigger con `nps_categories: ["detractor"]` + `notify_me_email`).
  - "Abrir en el canvas" → `/dashboard/flows/[flowId]`. Los flujos aparecen también en la pantalla general de Automatizaciones (es un flow normal).
- Acciones en `lib/actions/forms/flows.ts`: `createFormFlow`, `createFormFlowFromTemplate`, `toggleFormFlow`, `saveFormLinearFlow`, `sendFormFlowTestEmail` (este último con variables de ejemplo de `emptyFormVariables()`, solo al email de quien edita, `kind: "flow_test"`). Auditoría en la entidad `form` (como la Agenda audita en `event_type`).
- Un flow con ramas se abre en solo lectura con "Abrir en el canvas" (misma regla que la Agenda).

**Criterios:**
- CUANDO se toca "+ Nueva automatización" en el formulario A, DEBE existir un flow `draft` con `form_id = A` y un trigger configurado con `form_ids = [A]` del tipo correcto (`survey_answered` si A es encuesta).
- CUANDO se enciende, el flow DEBE quedar `published` y DEBE existir su fila en `triggers` activa; al apagarlo, `draft` e inactiva.
- CUANDO se archiva el formulario, sus flows NO DEBEN borrarse (siguen en Automatizaciones, `form_id` intacto).
- CUANDO se usa la plantilla `notify_me_email`, el flow DEBE nacer apagado con `to: "fixed"` y el email de quien la creó.
- CUANDO se abre el editor lineal de un evento de la **Agenda**, DEBE comportarse igual que antes (los tests existentes de `lib/scheduling/automation/*` en verde; el envoltorio pasa las mismas props — test de tipos con `tsc` vía `npm run build`).
- `flowToLinear(linearToFlow(x))` DEBE devolver `x` para un flujo de formulario (test de ida y vuelta con el trigger `form_submitted`).
- Test: `lib/forms/automation/templates.test.ts` y `lib/actions/forms/flows.test.ts` pasan; `lib/scheduling/automation/linear-flow.test.ts` sigue en verde.

**Bloque FO2 listo cuando:** F15 a F21 cumplen sus criterios; `npx vitest run` sale 0 (incluidos los tests del flow registry, de `lib/scheduling/automation/*`, de `bank-variables` y de `touch-entry`); `npm run build` compila; `verify-forms.mjs`, `verify-rls.mjs`, `verify-scheduling.mjs` y `verify-attribution.mjs` salen 0.

---

### Bloque FO3: Encuesta/NPS y contrato

#### F22: Tipo encuesta y "una vez por contacto"
**Descripción:**
- `forms.survey_config jsonb` (solo `type = 'survey'`): `{ scoreFieldKey, category, oncePerContact: boolean }`. `scoreFieldKey` apunta a un campo `rating` o `nps` **obligatorio** de la definición (validado al publicar). `category` ∈ `servicio`, `llamada`, `onboarding`, `cierre`, `general` (lista en `lib/forms/survey.ts`, editable en código; CX usa `servicio`).
- Al crear una encuesta, la definición inicial trae un campo NPS obligatorio "¿Qué tan probable es que nos recomiendes?" y un texto largo opcional "¿Por qué?".
- La respuesta guarda `score` (entero) y `nps_category` (`promoter` 9-10 · `passive` 7-8 · `detractor` 0-6; null si el puntaje es de estrellas) en columnas, calculados **en la RPC** desde las respuestas validadas (función pura espejo `npsCategory(score)` con test de paridad).
- **Link firmado:** es el de F20 (`?c=<token>`, con `contact_id` y, opcionalmente, `service_id` y `sale_id` **dentro de la firma**). Acá se usa el `contact_id` verificado para "una vez por contacto".
- **Una vez por contacto:** la respuesta guarda `once_key`:
  - con `c` válido → `contact:<id>`;
  - si no, contacto resuelto por dedupe → `contact:<id>`;
  - si no, email respondido → `email:<normalizado>`;
  - si no → null (anónimo: cuenta en el NPS, no se puede limitar).
  Índice único parcial `(form_id, once_key) WHERE once_key IS NOT NULL AND status <> 'spam'`. Choque → 409 `already_answered` y la página muestra **"Ya respondiste, ¡gracias!"**. Con `c` válido, la página lo dice **antes** de mostrar el formulario (la página consulta con el cliente de servicio si ya existe).
- Respuesta sin identificar (sin contacto): cuenta en el panel, no se vincula, no dispara (H3).

**Criterios:**
- `npsCategory(9)` → `promoter`; `npsCategory(7)` → `passive`; `npsCategory(6)` → `detractor`; y la RPC DEBE dar lo mismo (paridad en `verify-forms.mjs`).
- CUANDO se publica una encuesta cuyo `scoreFieldKey` no existe o es opcional, DEBE rechazarse.
- CUANDO el mismo contacto responde dos veces con `oncePerContact`, la segunda DEBE dar 409 y NO DEBE guardarse.
- CUANDO un token tiene la firma alterada o venció, `verifyFormLink` DEBE dar inválido y la página DEBE funcionar como si no hubiera `c` (no da error).
- CUANDO una respuesta anterior se marcó spam, el contacto DEBE poder responder de nuevo.
- Test: `lib/forms/survey.test.ts` y `lib/forms/signed-link.test.ts` pasan.

#### F23: Panel de la encuesta
**Descripción:** `/dashboard/formularios/[id]/encuesta` (solo encuestas).
- Selector de período. **Cuatro números:** respuestas, promedio (estrellas) o **NPS** (% promotores − % detractores, entero), % promotores, % detractores.
- **Distribución:** barras 0-10 (NPS) o 1-5 (estrellas), con el color por categoría.
- **Evolución:** NPS o promedio por semana (≤ 90 días) o por mes, con la cantidad de respuestas de cada punto (un punto con menos de 5 respuestas se marca "pocas respuestas").
- Últimos comentarios (el campo de texto largo, si hay) con su puntaje y link a la respuesta.
- Funciones puras en `lib/forms/survey-metrics.ts`, portadas de `satisfaction-constants.ts`: `calculateNPS(scores)`, `calculateAverage(scores)`, `distribution(scores, scale)`, `evolution(rows, granularity, tz)`. Excluyen spam.
- Respeta la RLS: un Member ve el panel calculado solo sobre las respuestas que ve (se aclara con un chip "Calculado sobre las respuestas de tus contactos").

**Criterios:**
- `calculateNPS([10,9,8,7,6,0])` DEBE dar `0` (2 promotores, 2 detractores de 6).
- `calculateNPS([])` DEBE dar `null` y la pantalla DEBE mostrar "Todavía no hay respuestas".
- `calculateAverage([5,4,4])` DEBE dar `4.33`.
- `evolution` con respuestas a las 23:30 de Costa Rica DEBE agruparlas en el día local.
- Test: `lib/forms/survey-metrics.test.ts` pasa.

#### F24: Tipo contrato
**Descripción:**
- `forms.contract_config jsonb` (solo `type = 'contract'`): `{ title, signatureRequired: boolean (default true), acceptLabel (default "Leí y acepto el contrato"), ccEmails: string[] (≤ 3) }`. El texto vive en `draft_definition.contractText` y se congela en `form_versions.contract_text` al publicar (F8).
- **Formato del texto:** Markdown **acotado** (títulos `#`/`##`, negrita, cursiva, listas, párrafos; sin HTML, sin links, sin imágenes). Editor: textarea + vista previa (`components/forms/editor/contract-editor.tsx`). Renderizador puro `renderContractMarkdown(text) → bloques` (`lib/forms/contract/markdown.ts`), el **mismo** para la página pública y para el PDF. Todo HTML que aparezca se escapa (D7: no se suma un editor rico).
- Variables en el texto: **no** en esta versión (la huella es sobre un texto fijo; prellenar el contrato desde la venta llega con Ventas).
- Campos opcionales: el contrato puede tener campos (nombre del firmante, email, documento…); el nombre y el email del firmante se mapean como en F15 y son **obligatorios** en un contrato (validado al publicar: debe existir un campo email obligatorio, porque ahí va la copia).
- Página pública: título, el texto renderizado en un contenedor con scroll, los campos, la casilla de aceptación (obligatoria siempre) y la firma (F25). El botón "Firmar y enviar" se habilita con la casilla tildada y, si es obligatoria, la firma hecha.

**Criterios:**
- `renderContractMarkdown("# Título\n**hola** <script>x</script>")` DEBE devolver un título, un párrafo con negrita y el `<script>` **escapado** como texto.
- CUANDO se publica un contrato sin campo email obligatorio, DEBE rechazarse.
- CUANDO llega un envío de contrato con `accepted = false`, el servidor DEBE responder 400.
- Test: `lib/forms/contract/markdown.test.ts` y `lib/forms/contract/config.test.ts` pasan.

#### F25: Firma dibujada
**Descripción:**
- `components/forms/public/signature-canvas.tsx`, portado de prevxcrm (sin dependencias): mouse y dedo (`pointer events`, `touch-action: none`), botón "Borrar", fondo blanco, trazo negro, exporta PNG; ancho al 100 % del contenedor (390 px usable) y alto 180 px.
- Manda `signature` (data URL PNG) y `signature_strokes` (cantidad de trazos con al menos 2 puntos).
- **Validación en el servidor** (`lib/forms/contract/signature.ts`, puro): data URL `image/png`, cabecera PNG real (`89 50 4E 47`), ≤ 200 KB, `signature_strokes ≥ 1`. Si `signatureRequired` y falta o es inválida → 400 `signature_required`. Si es opcional y no vino → se firma sin imagen.

**Criterios:**
- CUANDO la firma es obligatoria y llega vacía o con `signature_strokes = 0`, el servidor DEBE responder 400 (aunque el navegador lo haya dejado pasar).
- CUANDO llega un data URL que dice PNG pero los bytes son un JPEG, DEBE rechazarse.
- CUANDO pesa 250 KB, DEBE rechazarse.
- Test: `lib/forms/contract/signature.test.ts` pasa.

#### F26: Registro de la firma, metadata legal y huella
**Descripción:**
- Migración `00157_contract_signatures.sql`: tabla `contract_signatures` (§9.5), función `record_contract_signature(p_submission_id uuid, p_signature_path text, p_legal jsonb) returns uuid` (`SECURITY DEFINER`, solo `service_role`) y `submit_form_response` v3 (`CREATE OR REPLACE`, la v2 copiada en la cabecera) que la llama cuando el formulario es contrato.
- En el envío de un contrato (F12), después de validar todo y **dentro de la misma transacción** que la respuesta (la RPC `submit_form_response` llama a `record_contract_signature` cuando el tipo es contrato):
  - **La huella se calcula en la base, sobre `form_versions.contract_text` de la versión con la que se guardó la respuesta:** `text_sha256 = <form_versions.contract_text_sha256>` (calculado al publicar, F8) y se **verifica de nuevo** `encode(sha256(convert_to(contract_text,'UTF8')),'hex')` en el momento de firmar; si no coinciden, la firma falla (indica corrupción). **Nada de lo que mande el navegador entra en la huella**: el pedido ni siquiera trae el texto.
  - Guarda `form_version_id`, `signer_name`, `signer_email` (de las respuestas mapeadas), `signature_path`, `signed_at = now()` (hora del servidor), y `legal` jsonb: `{ ip, user_agent, device, os, browser, timezone, locale, utm, referrer, landing, accepted_label, signature_strokes }`. La **IP se guarda en claro solo acá** (es evidencia legal; §15), en el resto del sistema va hasheada.
  - `device`, `os`, `browser` salen del `user_agent` del **servidor** (cabecera), con la función pura `parseUserAgent(ua)` (sin dependencias, reglas simples); `timezone` y `locale` vienen del navegador y se guardan como "declarados".
  - `sale_id` y `service_id` copiados de la respuesta (solo vienen de un link firmado válido, F20).
  - `pdf_status = 'pending'`, `email_status = 'pending'`.
- La imagen de la firma se sube **antes** de la RPC a `contracts/{workspace_id}/{form_id}/{idempotency_key}/signature.png`.
- Dentro de la misma transacción, la RPC encola el job `contract_pdf` (`dedupe_key = contract_pdf:<signature_id>`, `run_at = now()`) y, si hay contacto, emite `contract_signed` en `automation_events` (F16 paso 7: es el evento del tipo contrato). Si la transacción falla, no queda ni firma, ni job, ni evento.
- La pantalla de éxito del contrato dice: "Listo. Te mandamos la copia firmada a <email> en unos minutos."

**Criterios:**
- CUANDO el navegador manda un campo `contract_text` o `contract_html` en el pedido, DEBE ignorarse y la huella DEBE ser la del texto guardado (test explícito: se manda un texto distinto y se compara la huella con `sha256` del texto de la versión).
- CUANDO se firma con la versión 1 y después se publica la 2, la firma DEBE seguir con `form_version_id` de la 1 y su huella.
- CUANDO la huella guardada en la versión no coincide con la recalculada (se fuerza en el test cambiando el texto con service role), la firma DEBE fallar y la respuesta NO DEBE quedar guardada.
- `signed_at` DEBE ser la hora del servidor aunque el navegador mande otra.
- `parseUserAgent` de un iPhone Safari DEBE dar `{device: "mobile", os: "iOS", browser: "Safari"}`.
- Test: `lib/forms/contract/legal.test.ts` pasa; `verify-forms.mjs` cubre la huella, la versión y la transacción.

#### F27: PDF firmado (en el servidor)
**Descripción:**
- **Librería:** `pdf-lib@1.17.1` (decisión a aprobar, §12 D4). Solo servidor (`lib/forms/contract/pdf.ts`, nunca importado desde un Client Component; extensión del test de frontera).
- Handler del job `contract_pdf` (`lib/jobs/handlers/contract-pdf.ts`, registrado con `registerJobHandler`):
  1. Lee la firma, la versión (texto), la respuesta y el formulario con el cliente de servicio.
  2. Arma el PDF (A4, Helvetica de las fuentes estándar con codificación WinAnsi, que cubre español: á é í ó ú ñ ü ¿ ¡): encabezado con el nombre del negocio (`lib/brand.ts`), título, el texto renderizado con `renderContractMarkdown` (títulos, negrita, listas; salto de página automático), datos del firmante, las respuestas de los campos (etiqueta: valor), la imagen de la firma, el bloque **"Datos de aceptación"** (fecha y hora del servidor en la zona del workspace y en UTC, IP, dispositivo, sistema, navegador, zona declarada, versión del texto) y **al pie de cada página** la huella SHA-256 y "Versión N".
  3. Caracteres fuera de WinAnsi (emojis, etc.) se reemplazan por `?` con la función pura `toWinAnsi(text)` (no rompe la generación).
  4. Sube a `contracts/{workspace_id}/{form_id}/{signature_id}/contrato-v<N>.pdf`, `pdf_path`, `pdf_status = 'generated'`, y encola `contract_email` (`dedupe_key = contract_email:<signature_id>:0`).
  5. Falla → `pdf_status = 'failed'`, `pdf_attempts + 1`, reintenta a los 5, 15 y 30 minutos (mismo cálculo que F28) y después queda `failed` con botón "Regenerar PDF" en la respuesta. **La firma queda guardada igual** (alcance §3.5).
- El PDF de una firma **no se regenera** con otra versión: siempre lee la versión de la firma.

**Criterios:**
- CUANDO se genera el PDF, DEBE contener (texto extraído con `unpdf`, que ya está en el repo) el título, el nombre del firmante, la huella y "Versión 1".
- CUANDO el texto tiene `ñ` y `¿`, DEBEN aparecer en el texto extraído; CUANDO tiene un emoji, la generación NO DEBE fallar.
- CUANDO el texto ocupa 3 páginas, la huella DEBE aparecer en las 3.
- CUANDO la generación falla (subida simulada con error), `pdf_status` DEBE quedar `failed` con `pdf_attempts = 1` y DEBE existir el job de reintento a +5 min.
- Test: `lib/forms/contract/pdf.test.ts` (genera el PDF en memoria y lo lee con `unpdf`) y `lib/jobs/handlers/contract-pdf.test.ts` pasan.

#### F28: Copia por email con reintentos, ver y reenviar
**Descripción:**
- **Adjuntos en el email** (H9): `ResendMessage.attachments?: { filename: string; content: string /* base64 */ }[]` en `lib/email/resend-client.ts` y `SendEmailParams.attachments?` en `lib/email/send.ts`; solo se agregan al cuerpo si vienen. `send.test.ts` existente en verde.
- Handler del job `contract_email` (`lib/jobs/handlers/contract-email.ts`):
  1. Baja el PDF del bucket con el cliente de servicio y lo manda con `sendTransactionalEmail({ kind: "contract_copy", to: signer_email, cc… , relatedEntityType: "contract_signature", relatedEntityId, contactId, attachments: [{filename: "contrato-<titulo>-v<N>.pdf", content}] })`. Las direcciones fijas (`ccEmails`) reciben un envío aparte cada una (Resend por API acepta `cc`, pero `sendTransactionalEmail` manda a uno: se mantiene así).
  2. Asunto "Tu copia firmada: <título>"; cuerpo corto con la fecha y "La huella del documento es <primeros 16 caracteres>…".
  3. OK → `email_status = 'sent'`, `email_sent_at`.
  4. Falla → `classifyEmailError(status, message)` (portado de `email-retry-utils.ts` a `lib/forms/contract/email-retry.ts`): **transitorio** (429, 5xx, red, o sin estado) → `email_status = 'retrying'`, `email_attempts + 1`, `email_next_retry_at = now + [5, 15, 30][intento]` minutos y un job nuevo `contract_email` con `run_at` = esa hora y `dedupe_key = contract_email:<signature_id>:<intento>`; **permanente** (4xx salvo 429) o agotados los 3 reintentos → `email_status = 'not_sent'`, `email_last_error`.
  5. Resend no configurado (`reason: not_configured`) → `not_sent` directo con el motivo "Resend no está conectado".
- **Estados visibles** (alcance §4.3): Enviado · Reintentando · No enviado.
- **Desde la respuesta** (`forms.view` para ver; `forms.manage` para reenviar):
  - **"Ver PDF"**: link firmado de **60 segundos** generado en el servidor, solo si `can_see_form_submission`.
  - **"Reenviar copia"**: encola `contract_email` con `dedupe_key = contract_email:<signature_id>:manual:<timestamp>`, vuelve el estado a `retrying` con intentos en 0, y deja `audit_log` (`action 'contract.email_resent'`).
  - **"Regenerar PDF"** (solo si `pdf_status = 'failed'`).

**Criterios:**
- `nextEmailRetryAt(0)` DEBE dar +5 min; `(1)` +15; `(2)` +30; `(3)` `null`.
- `classifyEmailError(429, "")` → transitorio; `(422, "invalid to")` → permanente; `(0, "fetch failed")` → transitorio.
- DADO tres fallos transitorios seguidos, DEBEN existir los jobs a +5, +15 y +30 y, al cuarto fallo, `email_status = 'not_sent'` sin un quinto job.
- DADO un fallo permanente, DEBE quedar `not_sent` sin reintentos.
- CUANDO se reenvía, DEBE crearse un job nuevo aunque haya uno pendiente con otra clave, y NO DEBE crearse otro si se toca dos veces en el mismo segundo (misma clave).
- CUANDO quien pide el PDF no ve la respuesta, NO DEBE obtener el link.
- El cuerpo enviado a Resend DEBE incluir `attachments` con el PDF en base64 (test con `fetch` simulado que inspecciona el cuerpo) y un email sin adjuntos DEBE mandarse igual que antes (test existente).
- Test: `lib/forms/contract/email-retry.test.ts`, `lib/jobs/handlers/contract-email.test.ts` y `lib/email/send.test.ts` (extendido) pasan.

**Bloque FO3 listo cuando:** F22 a F28 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `npm run lint` sin errores nuevos; `verify-forms.mjs` sale 0 (incluidos huella, versión, firma y NPS); los handlers `contract_pdf` y `contract_email` aparecen en `registeredJobTypes()`.

---

### Bloque FO4: Sitio público y atribución completa (v1.1)

**Para qué:** Wendy quiere poner formularios en las páginas públicas que arme en este mismo proyecto (como el home de su web), además de embeberlos en otras webs. En los dos casos, cada envío tiene que llevar los UTMs y cualquier dato del anuncio (`fbclid`, `gclid`…), **aunque la persona haya llegado a una página y llene el formulario en otra**. Este bloque no suma tablas ni migraciones.

> **Requisito:** FO1 a FO3 construidos. Usa `prefillFromParams`, `attributionFromParams` y `effectiveAttribution` (F6), el renderizador público (F9), el embed (F10) y `formTouch` (F17).

#### F29: Atribución persistente entre páginas
**Descripción:**
- **Funciones puras** en `lib/attribution/store.ts`:
  - `parseStored(raw: string | null)` → `{ v: 1, first?: Visit, last?: Visit }` o vacío si el JSON está roto, es de otra versión o pesa más de 3,5 KB. Descarta las claves que no están en `lib/attribution/keys.ts`.
  - `recordVisit(stored, current, now)`:
    - Si `current` trae alguna clave de UTM, clic o anuncio: es un toque nuevo. Pasa a ser `last` y, si no había `first`, también `first`. `first` **nunca** se pisa.
    - Si no trae nada, devuelve `stored` igual.
    - Cada `Visit` es `{ ...claves, landing_page, referrer_url, ts }`.
  - `serializeStored(stored)` → string ≤ 3,5 KB (recorta valores a 200 caracteres).
  - Las fechas de más de 90 días se descartan al leer.
- **En las páginas del propio proyecto** (el sitio, F30, y `/f/[slug]` cuando **no** está embebido):
  - Un Client Component `components/attribution/attribution-tracker.tsx`, montado en el layout del sitio y en `/f/[slug]`.
  - Al cargar, lee la URL, `document.referrer` (solo si es de **otro** dominio) y las cookies `_fbp`, `_fbc` y `_ga`, y escribe la cookie propia **`ssa_attr`**: `SameSite=Lax`, `Secure`, `Path=/`, 90 días.
  - No hace pedidos a la red ni carga scripts de terceros.
- **En webs externas** (`public/embed/embed.js`):
  - Al cargarse, el script hace lo mismo en el **`localStorage` de la web que lo contiene**, con la clave `ssa_attr`. Las mismas funciones puras van empaquetadas en el bundle.
  - Modo **"solo seguimiento"**: `<script src=".../embed/embed.js" data-agenda-track async></script>` sin formulario ni agenda. Se pega en el `<head>` de toda la web y solo persiste la atribución.
  - Cuando después se abre un embed `f/<slug>`, le pasa al iframe la atribución persistida y las cookies en el parámetro `attr` (F10).
  - Los embeds de agenda **no cambian** su URL.
- Todo acceso a cookies y `localStorage` va en `try/catch`. Si el navegador los bloquea, se usa solo la URL actual y el formulario funciona igual.

**Criterios:**
- `recordVisit({}, {utm_campaign:"octubre"}, t1)` DEBE dar `first.utm_campaign = last.utm_campaign = "octubre"`.
- Sobre ese resultado, `recordVisit(…, {gclid:"g1"}, t2)` DEBE dejar `first` con `octubre` y `last` con `gclid = "g1"` (sin `utm_campaign`: son toques distintos).
- `recordVisit(stored, {}, t3)` DEBE devolver `stored` sin cambios.
- `parseStored` con JSON roto, con `v: 2`, con 10 KB o con una clave `password` DEBE devolver vacío o descartar esa clave.
- Una visita con `ts` de hace 91 días DEBE descartarse al leer.
- DADO un `document` simulado con `?utm_source=meta` y `localStorage` que tira error, el tracker del embed NO DEBE lanzar.
- El bundle de `embed.js` DEBE seguir pesando menos de 60 KB.
- Test: `lib/attribution/store.test.ts`, `lib/embed/embed-source.test.ts` (extendido) y `lib/embed/build.test.ts` pasan; los casos existentes de embed de agenda siguen iguales.

#### F30: Área pública del sitio
**Descripción:**
- **Grupo de rutas `app/(sitio)/`** para las páginas públicas del proyecto, fuera del login:
  - `layout.tsx`: encabezado con logo y nombre del white label (`lib/brand.ts`), pie simple, `<AttributionTracker/>`, metadatos base (título, descripción, Open Graph con la marca) y nada del dashboard.
  - `page.tsx`: el home, que reemplaza a `app/page.tsx`. **La versión por defecto redirige a `/login`**, como hoy. El clon que quiere su web la reemplaza.
  - Las páginas nuevas van como `app/(sitio)/<ruta>/page.tsx`. Las imágenes van en `public/sitio/`.
- **Son código armado por Claude Code a pedido** (decisión 182): no hay editor visual. `docs/sitio.md` explica cómo pedir y armar una página:
  - El layout que usa y cómo agregarle formularios con `<Formulario>`.
  - Las reglas de SEO (`metadata` por página, `sitemap` y `robots`).
  - Que las páginas sean estáticas o con caché: sin leer la sesión.
  - Que no pueden usar rutas reservadas: `dashboard`, `login`, `auth`, `invite`, `api`, `calendario`, `f`, `embed`.
- **Son de cada clon** (decisión 183): `scripts/export-template.mjs` **no copia** `app/(sitio)/` ni `public/sitio/`. En su lugar copia la versión por defecto, que vive en `scripts/template-files/sitio/` (`layout.tsx` + `page.tsx` que redirige a `/login`).
- **El middleware no cambia de comportamiento**:
  - Quien no tiene sesión ve el sitio.
  - Quien tiene sesión **también** ve el sitio en `/` (antes `/` siempre llevaba al login).
  - `/login` con sesión sigue yendo a `/dashboard`.
  - Se verifica con un test sobre `updateSession`, o la función pura que decide la redirección si existe.
- `app/sitemap.ts` (nuevo) lista las páginas de `app/(sitio)` a partir de una lista que mantiene cada clon (`lib/site/pages.ts`, vacía en la plantilla). `app/robots.ts` existente suma el sitemap.
- Headers: las páginas del sitio **no** son embebibles (`frame-ancestors 'self'`); `/f` y `/calendario` siguen como están.

**Criterios:**
- CUANDO se pide `/` sin páginas propias (versión por defecto), DEBE redirigir a `/login`.
- CUANDO se pide `/login` con sesión, DEBE redirigir a `/dashboard` (sin cambios).
- `lib/security-headers.test.ts` DEBE verificar que `/` y `/ejemplo` **no** son embebibles y que `/f/x` sí.
- `export-template.mjs` corrido sobre una carpeta temporal DEBE dejar `app/(sitio)/page.tsx` igual a `scripts/template-files/sitio/page.tsx` y NO DEBE copiar ningún otro archivo de `app/(sitio)/` ni `public/sitio/` (test en `scripts/export-template.test.ts` si existe el patrón, o en `verify-forms.mjs`).
- `npm run build` DEBE compilar con la versión por defecto y con una página de ejemplo (`app/(sitio)/ejemplo/page.tsx`, que se crea para el test y **se borra antes del commit final**).
- Test: `lib/security-headers.test.ts` (extendido) y `lib/site/pages.test.ts` pasan.

#### F31: Componente `<Formulario>` para cualquier página del sitio
**Descripción:**
- `components/forms/public/formulario.tsx`: Server Component `<Formulario slug="aplicacion" prefill={{ plan: "pro" }} variant="card" | "plain" className="…" />`.
  - Lee la definición con `get_public_form`, con caché por etiqueta `form:<slug>`. `publish_form_version` y pausar o archivar el formulario invalidan esa etiqueta desde su Server Action (`revalidateTag`). Así la página puede ser estática y muestra la versión vigente.
  - Renderiza **el mismo** `PublicForm` de F9, en modo `site` (sin el marco de página de `/f`).
  - El prellenado de la URL lo lee el cliente con `useSearchParams`, envuelto en `Suspense`, para no volver dinámica la página. `prefill` del código gana sobre la URL.
- El envío va por **el mismo** camino que `/f` (F12), con:
  - `meta.origin = "site"`;
  - `meta.site_path` = la ruta de la página;
  - la atribución efectiva de F6, armada con la URL actual + la cookie `ssa_attr`.
- Turnstile, idempotencia, condiciones, archivos, éxito con mensaje o redirección, `view` y `start` en `analytics_events` (con `origin: "site"`): todo igual que en `/f`.
- Si el formulario no está disponible, el componente muestra el aviso dentro de la página y **no** la rompe (ni tira 404).
- Varios `<Formulario>` en la misma página funcionan cada uno por su lado.

**Criterios:**
- DADO un `<Formulario slug="x">` en una página y un formulario publicado, CUANDO se publica una versión nueva, la página DEBE mostrar la nueva sin redeploy (la etiqueta invalidada; test de la acción que verifica la llamada a `revalidateTag("form:x")`).
- DADO `prefill={{plan:"pro"}}` y la URL `?plan=basic`, el campo DEBE quedar en `pro`.
- CUANDO se envía desde una página del sitio, la respuesta DEBE tener `meta.origin = "site"` y `meta.site_path`.
- DADO un formulario pausado, la página DEBE renderizar con el aviso y responder 200.
- `verify-forms.mjs`: un envío con `origin: "site"` y una cookie `ssa_attr` con `last.utm_campaign = "octubre"` (sin UTM en la URL) DEBE guardar `attribution.utm_campaign = "octubre"` y un toque con `campaign = "octubre"`.
- Test: `lib/forms/site-submit.test.ts` (la función pura que arma `meta` y la atribución para el modo `site`) pasa.

#### F32: Parámetros, links con prellenado y códigos en la pestaña Publicar
**Descripción:**
- **"Parámetros de la URL"** (función pura `describePrefillParams(definition)` en `lib/forms/prefill.ts`):
  - Una tabla con cada campo prellenable: etiqueta, parámetros que acepta y comportamiento.
  - Los ocultos `url_param` y `attribution`, con su parámetro o su clave.
  - Las claves de atribución que se registran solas (UTMs, ids de clic, cookies), para que Wendy sepa que no tiene que hacer nada con ellas.
- **Armador de link** (función pura `buildPrefillLink(baseUrl, values)`):
  - Elegís valores para los parámetros y copiás la URL.
  - Admite variables del contacto (`{{contact.email}}`, `{{contact.phone}}`, `{{contact.first_name}}`, `{{contact.last_name}}`) **sin codificarlas**, para pegar el link en un mensaje o email de una automatización: las resuelve el nodo de envío, como cualquier variable.
  - Un aviso dice que esos datos viajan en la URL y que, para encuestas de "una vez por contacto", conviene el link firmado (F22).
- **"Usar en una página del sitio"**: el código `<Formulario slug="…" />` (generado por `lib/embed/code.ts`, extendido) con "Copiar".
- **Embed**: suma el snippet de **"Seguimiento en todo el sitio"** (F29), con su explicación.

**Criterios:**
- `buildPrefillLink("https://app.x/f/apl", {correo:"{{contact.email}}", plan:"pro"})` DEBE dar `https://app.x/f/apl?correo={{contact.email}}&plan=pro` (la variable sin codificar; el resto codificado).
- `describePrefillParams` NO DEBE listar campos `consent` ni `file`, ni el `value` de los ocultos `fixed`.
- El código de "página del sitio" DEBE ser `<Formulario slug="apl" />` exacto.
- Test: `lib/forms/prefill.test.ts` (extendido) y `lib/embed/code.test.ts` (extendido) pasan.

#### F33: Todos los datos del anuncio llegan al contacto
**Descripción:**
- `formTouch` (F17) pasa a usar la atribución **efectiva** (F6/F29) y manda a sus columnas propias lo que `contact_touches` ya tiene:
  - `fbclid`, `gclid`, `ttclid`, `li_fat_id`;
  - `ad_id`, `adset_id`, `campaign_id`;
  - `referrer_url`, `landing_page`.

  Todo lo demás (`utm_id`, `gbraid`, `wbraid`, `msclkid`, `twclid`, `sccid`, `epik`, `rdt_cid`, `placement`, `fbp`, `fbc`, `ga_client_id`, `page_url`) va a **`raw`**.
- `lib/contacts/touch.ts`:
  - `RAW_KEYS` suma exactamente esas claves.
  - **Es el único cambio** en ese archivo: `record_contact_touch` y la forma de `contacts.attribution` no cambian.
  - Test de caracterización antes: un toque de la Agenda y uno de Zernio se sanean **igual** antes y después.
- La ficha de la respuesta (F13) muestra la atribución en un bloque plegable: primero los UTMs, después "Anuncio" (ids de clic y de anuncio), "Navegador" (`fbp`, `fbc`, `ga_client_id`), página de llegada, página del envío, de dónde vino, y "Primera visita" si es distinta.
- La exportación CSV (F13) suma las columnas de atribución que tengan algún valor en el período.

**Criterios:**
- `formTouch` con `msclkid=m1&fbclid=f1` DEBE dar `fbclid = "f1"` en su columna y `raw.msclkid = "m1"`.
- `sanitizeRaw` DEBE conservar `fbc`, `fbp`, `gbraid` y `page_url`, y seguir descartando una clave inventada (`foo`).
- El test de caracterización de `sanitizeRaw` (toque de Agenda y de Zernio) DEBE dar lo mismo antes y después.
- `verify-attribution.mjs` (existente) DEBE seguir en 0; `verify-forms.mjs`: un envío con `?utm_source=facebook&fbclid=abc&msclkid=m1` DEBE dejar en `contact_touches` `fbclid = "abc"` y `raw` con `msclkid` y `fbc`.
- Test: `lib/contacts/touch-entry.test.ts` (extendido), `lib/contacts/touch.test.ts` (extendido) y `lib/forms/export.test.ts` (extendido) pasan.

**Bloque FO4 listo cuando:** F29 a F33 cumplen sus criterios; `npx vitest run` sale 0 (incluidos todos los de embed, headers, touch y atribución existentes); `npm run build` compila con la versión por defecto del sitio; `npm run lint` sin errores nuevos; `verify-forms.mjs` (con los casos de FO4), `verify-attribution.mjs` y `verify-scheduling.mjs` salen 0; `embed.js` < 60 KB; `docs/sitio.md` escrito; la página de ejemplo borrada.


### Definición de "listo" de todo el módulo

- `docs/PROGRESS.md` tiene FO1, FO2, FO3 y FO4 y **F1 a F33** marcados. F18 y las plantillas de F21 (nice-to-have) pueden quedar en `docs/PENDIENTE.md` si se recortan, y F27 si no se aprobó `pdf-lib` (el contrato se firma igual y queda sin PDF).
- Salen 0: `npx vitest run` (toda la suite, nuevos + existentes), `npm run build`, `npm run lint` (sin errores nuevos), `node scripts/verify-forms.mjs` (con los casos de FO4), `verify-rls.mjs`, `verify-scheduling.mjs`, `verify-attribution.mjs` y los demás `verify-*.mjs` existentes. `node scripts/export-template.mjs` en una carpeta temporal deja `app/(sitio)/` con la versión por defecto (F30).
- Ninguna de las cosas de §4.2 ("NO cambia") se rompió: en particular `find_or_link_contact`, `create_booking` y `record_contact_touch` tienen la misma definición que al empezar (consulta de control `md5(pg_get_functiondef(...))` antes y después, en `verify-forms.mjs`).
- Están creados o actualizados: `docs/formularios.md` (modelo, tipos, el orden del envío, la regla de contacto y toque, los triggers y las variables, el contrato y su huella), `docs/flow-registry.md`, `.env.example` (sin variables nuevas: Turnstile va a Vault; se documenta en el comentario), `CLAUDE.md` (sección "Formularios (construido)" con lo que no se puede romper: la definición pública solo por `get_public_form`, la huella sobre el texto guardado, idempotencia por índice único, Turnstile en el servidor, **las claves de atribución en un solo lugar (`lib/attribution/keys.ts`)**; y sección "Sitio público": dónde van las páginas, que son de cada clon y cómo se usa `<Formulario>`), `docs/sitio.md` (F30) y `BITACORA.md`.

### Funcionalidades de módulos siguientes (no se construyen ahora)
- Contrato prellenado desde la venta y firma atada a ella (`sale_id`) — **Ventas**.
- Ítems Formulario/Encuesta/Contrato del camino que se completan solos; "una vez por servicio"; satisfacción del resumen de CX — **CX**.
- Mapeo a contacto como componente compartido para webhooks, nodo HTTP y agente — **Ventas Fase 2**.

---

## 8. Flujos

### 8.1 Un lead llena un formulario y se crea la automatización desde el formulario (alcance 3.3)

1. Wendy crea "Aplicación al programa" (personalizado): nombre, email, WhatsApp (teléfono), facturación mensual (selección única), "¿por qué ahora?" (texto largo) y un oculto `campana` con `source: url_param, param: utm_campaign`.
2. **Pestaña Contacto:** nombre → `contact.display_name`, email → `contact.email`, WhatsApp → `contact.whatsapp_phone`, facturación → `contact.custom.facturacion`. Deja "Crear o vincular" y "Completar solo lo vacío".
3. **Pestaña Automatizaciones → "+ Nueva automatización":** se crea el flow en borrador con el trigger "Se envió un formulario: Aplicación al programa". En el editor lineal agrega la condición "facturación es más de 10k" y los pasos: mensaje de WhatsApp con `{{scheduling.link.ana.llamada_de_diagnostico}}` y tag "calificado". Lo enciende.
4. **Publica** (versión 1) y copia el embed en su landing.
5. Un lead llega con `utm_source=facebook&utm_campaign=octubre&ad_id=123`. El embed le pasa esos UTM al iframe; la página manda `view` y, al tocar el primer campo, `start`.
6. Envía. El servidor: tope por IP → formulario disponible → forma del pedido → idempotencia (nueva) → honeypot vacío → Turnstile OK → validación total → ocultos `fixed` → **RPC**: busca por teléfono (no hay) y por email (no hay) → crea el contacto con los campos mapeados → guarda la respuesta `received` → suma `submissions` → emite `form_submitted`. Responde con la pantalla de éxito.
7. Después del commit: `recordTouch` con `medium form`, campaña octubre, anuncio 123 → como el contacto es nuevo, es **su primer toque**. Notificación en la campana.
8. El cron de `automation_events` enruta `form_submitted` → `eventMatches` evalúa la condición de facturación → el flow manda el WhatsApp (si el contacto tiene conversación de WhatsApp; si no, el paso no puede enviar por canal, como en la Agenda) y pone el tag.

**Casos raros** (todos con su regla en §16): el contacto ya existía · email y teléfono de contactos distintos · sin email ni teléfono · modo "solo vincular" sin coincidencia · doble clic o reintento de red · captcha o spam · formulario pausado o archivado · campo renombrado o borrado con respuestas · contacto "no contactar" · archivo de más o de otro tipo · prellenado bloqueado manipulado.

### 8.2 Encuesta de satisfacción (alcance 3.4)

1. Wendy crea la encuesta "¿Cómo vas?" (NPS obligatorio + "¿Por qué?"), categoría *servicio*, "una vez por contacto". Mapeo: el email al contacto.
2. Pestaña Automatizaciones → plantilla **"Avisarme si es detractor"**: trigger "Se respondió una encuesta" con NPS detractor → email a Wendy con `{{answer.por_que}}` y `{{submission.url}}`. La enciende.
3. Desde un flow de la Agenda ("Terminó la reunión") manda por WhatsApp "¿Nos contás cómo vas? {{form_link.como_vas}}": el link sale **firmado para ese contacto**.
4. El cliente abre el link: la página verifica el token (válido, no respondió) y muestra la encuesta. Responde 4.
5. La RPC usa el contacto del token (sin deduplicar), calcula `score = 4`, `nps_category = detractor`, `once_key = contact:<id>`, emite `survey_answered`. El flow manda el aviso.
6. El panel muestra el NPS del mes.

**Casos raros:** el mismo contacto vuelve a abrir el link → "Ya respondiste, ¡gracias!" antes del formulario · responde sin link firmado y sin email → cuenta en el NPS, sin contacto, no dispara · token vencido o alterado → la página funciona como sin token (se respeta el email cargado).

### 8.3 Firmar un contrato (alcance 3.5)

1. Wendy crea "Acuerdo de servicio" (contrato): texto con formato, firma obligatoria, campos nombre y email (obligatorios, mapeados al contacto), copia a `admin@negocio.com`. Publica: versión 1 con su huella calculada en la base.
2. Le manda el link al cliente (o lo embebe).
3. El cliente lee, completa nombre y email, tilda "Leí y acepto" y firma con el dedo.
4. El servidor: lo de 8.1 hasta la validación → valida la firma (PNG real, ≤ 200 KB, ≥ 1 trazo) → sube la imagen → **RPC en una transacción**: resuelve el contacto, guarda la respuesta, **registra la firma** con la versión 1, la huella **leída y verificada del texto guardado**, la metadata legal y la hora del servidor, emite `contract_signed`. Encola `contract_pdf`.
5. Job `contract_pdf` (al minuto siguiente): arma el PDF con la huella al pie, lo guarda en `contracts`, encola `contract_email`.
6. Job `contract_email`: manda la copia al firmante con el PDF adjunto y un envío aparte a la dirección fija. Estado "Enviado".

**Casos raros:** Wendy edita el texto después de 3 firmas → versión 2; las 3 firmas siguen con la 1 y sus PDFs no cambian · falla el PDF → la firma queda; reintentos a 5/15/30 min; después "Regenerar PDF" · falla el email → reintentos 5/15/30; después "No enviado" con "Reenviar" · alguien manda otro texto desde el navegador → se ignora · firma vacía con firma obligatoria → no deja enviar en el navegador ni en el servidor.

### 8.4 Resumen técnico del envío (la secuencia que comparten los tres tipos)

`POST /api/public/forms/[slug]/submit` → tope IP → definición vigente (servicio) → Zod del pedido → **idempotencia** → honeypot → **Turnstile** (servidor, Vault) → versión → **`buildSubmissionSchema`** (visibilidad recalculada) → archivos (tipo real, bucket privado) → ocultos `fixed` → mapeo a contacto (puro) → **RPC `submit_form_response`** (transacción: lock por teléfono/email → contacto → respuesta → firma si es contrato → `automation_events`) → después del commit, en `try/catch`: `recordTouch`, tags ya hechos en la RPC, notificación, job `contract_pdf` → respuesta con el éxito renderizado.

---

## 9. Modelo de datos

> Todas las tablas nuevas: `id uuid default gen_random_uuid()`, `workspace_id uuid not null references workspaces(id) on delete cascade`, `created_at`/`updated_at` con el trigger de `updated_at` existente, **RLS habilitada**, **sin DELETE** para nadie (no hay policy de DELETE; solo `service_role` podría y no se usa). Tipos en `lib/types/database.ts`.

### 9.1 `forms` (00150)

| Columna | Tipo | Notas |
|---|---|---|
| `name` | text not null | 1-120 |
| `type` | text not null | CHECK `IN ('custom','survey','contract')`. No cambia después de crear |
| `status` | text not null default `'draft'` | CHECK `IN ('draft','published','paused','archived')` |
| `slug` | text not null | CHECK `slug ~ '^[a-z0-9-]{3,60}$'`. **Único `lower(slug)`** (global: la URL pública no lleva workspace) |
| `draft_definition` | jsonb not null default `'{"fields":[]}'` | La copia de trabajo del editor: `{ fields: FormField[], contractText?: string }` |
| `current_version_id` | uuid null | FK `form_versions(id)` (`DEFERRABLE INITIALLY DEFERRED`, se agrega después de crear `form_versions`) |
| `design` | jsonb not null default `'{}'` | F7 |
| `success` | jsonb not null default `'{"mode":"message"}'` | F7 |
| `contact_config` | jsonb not null default `'{"mode":"create_or_link","update":"fill_empty","map":[]}'` | F15 |
| `survey_config` | jsonb null | F22. CHECK `type = 'survey'` ⇒ not null |
| `contract_config` | jsonb null | F24. CHECK `type = 'contract'` ⇒ not null |
| `tags_on_submit` | uuid[] not null default `'{}'` | F18 |
| `notify_enabled` | boolean not null default true | F18 |
| `notify_user_ids` | uuid[] not null default `'{}'` | F18 |
| `published_at`, `archived_at` | timestamptz null | |
| `created_by`, `updated_by` | uuid null | FK `auth.users` `on delete set null` |

Índices: `(workspace_id, status, updated_at desc)`, único `lower(slug)`.

### 9.2 `form_versions` (00150)

| Columna | Tipo | Notas |
|---|---|---|
| `form_id` | uuid not null | FK `forms` `on delete cascade` |
| `version_number` | int not null | Único `(form_id, version_number)` |
| `definition` | jsonb not null | `{ fields: FormField[] }` congelado (incluye ocultos `fixed` con su valor: lo lee solo el servidor) |
| `contract_text` | text null | Normalizado (F8). Solo contratos |
| `contract_text_sha256` | text null | hex de 64. CHECK `contract_text IS NULL OR contract_text_sha256 ~ '^[0-9a-f]{64}$'` |
| `published_by` | uuid null | |
| `published_at` | timestamptz not null default now() | |

**Inmutable:** sin policy de UPDATE; solo la crea `publish_form_version`.

### 9.3 `form_submissions` (00150; columnas de contacto usadas desde 00156)

| Columna | Tipo | Notas |
|---|---|---|
| `form_id` | uuid not null | FK `forms` |
| `form_version_id` | uuid not null | FK `form_versions` |
| `idempotency_key` | uuid not null | **Único `(form_id, idempotency_key)`** |
| `status` | text not null | CHECK `IN ('received','no_contact','spam')` |
| `answers` | jsonb not null | `{ <key>: { label, type, value } }` con la etiqueta de la versión. Archivos: `value = [{ path, name, size, mime }]` |
| `contact_id` | uuid null | FK `contacts` `on delete set null` |
| `contact_created` | boolean not null default false | |
| `dedupe` | jsonb not null default `'{}'` | `{ matched_by, conflict_contact_id }` |
| `score` | int null | Encuestas |
| `nps_category` | text null | CHECK `IN ('promoter','passive','detractor')` |
| `once_key` | text null | F22. **Único parcial `(form_id, once_key) WHERE once_key IS NOT NULL AND status <> 'spam'`** |
| `attribution` | jsonb not null default `'{}'` | La **efectiva** de la visita (F6): todas las claves de `lib/attribution/keys.ts` que vinieron, `referrer_url`, `landing_page`, `page_url`, las cookies (`fbp`, `fbc`, `ga_client_id`) y `first_visit` (el primer toque persistido, F29). Saneada en el servidor |
| `meta` | jsonb not null default `'{}'` | `{ ip_hash, user_agent, origin: 'public_page'|'embed'|'site', site_path?, timezone, locale }` (sin IP en claro). `site` = un `<Formulario>` dentro de una página del sitio (F31) |
| `upload_prefix` | text null | Carpeta de archivos (`…/{idempotency_key}`) |
| `linked_by`, `linked_at` | uuid / timestamptz null | Vínculo a mano (F16) |
| `marked_spam_by`, `marked_spam_at` | uuid / timestamptz null | F13 |
| **`sale_id`** | uuid null | **Para Ventas, sin FK.** Solo lo escribe un link firmado válido con `sale_id` (F20); sin validar contra `sales` (no existe). Ventas (00162) suma la FK de `form_submissions.sale_id` y la de `contract_signatures.sale_id`. Ventas (00168) reescribe `submit_form_response`/`record_contract_signature` para validar el `sale_id` contra el contacto y sumarlo al payload de `form_submitted`/`contract_signed`. |
| **`service_id`** | uuid null | **Para CX, sin FK.** Solo lo escribe un link firmado válido con `service_id` (F20); sin validar contra `services` (no existe). CX (00172) suma la FK de `form_submissions.service_id` y la de `contract_signatures.service_id`. |

Índices: `(form_id, created_at desc)`, `(workspace_id, created_at desc)`, `(contact_id, created_at desc) WHERE contact_id IS NOT NULL`, `(form_id, status, created_at desc)`.

### 9.4 Métricas: sin tabla propia (`analytics_events`, existente)

No se crea tabla de contadores (decisión de Wendy, 10/10). Vistas, inicios y rechazados se escriben en `analytics_events` (H17), con:

| Columna | Valor |
|---|---|
| `workspace_id` | El del formulario |
| `event_type` | `form_view` · `form_start` · `form_rejected` |
| `contact_id`, `flow_id` | null (así no aparecen en el historial de ningún contacto) |
| `metadata` | `{form_id, version_id}` y, en `form_rejected`, `reason` (`captcha`|`honeypot`). Nada personal |

Índice nuevo (00151): `idx_analytics_forms ON analytics_events (workspace_id, (metadata->>'form_id'), event_type, created_at) WHERE event_type LIKE 'form\_%'`. Los envíos y el spam se cuentan desde `form_submissions`. La lectura es `form_metrics_daily` (F14).

### 9.5 `contract_signatures` (00157)

| Columna | Tipo | Notas |
|---|---|---|
| `submission_id` | uuid not null | FK `form_submissions`. **Único** (una firma por respuesta) |
| `form_id`, `form_version_id` | uuid not null | FK |
| `text_sha256` | text not null | CHECK hex 64. Copiado y verificado contra `form_versions` |
| `signer_name`, `signer_email` | text not null | |
| `contact_id` | uuid null | FK `contacts` `on delete set null` |
| `signature_path` | text null | Null si la firma es opcional y no se dibujó |
| `signed_at` | timestamptz not null default now() | Hora del servidor |
| `legal` | jsonb not null | F26 (incluye la IP en claro: evidencia legal) |
| `pdf_path` | text null | |
| `pdf_status` | text not null default `'pending'` | CHECK `IN ('pending','generated','failed')` |
| `pdf_attempts` | int not null default 0 | |
| `email_status` | text not null default `'pending'` | CHECK `IN ('pending','sent','retrying','not_sent')` |
| `email_attempts` | int not null default 0 | |
| `email_next_retry_at`, `email_sent_at` | timestamptz null | |
| `email_last_error` | text null | Sin datos personales |
| **`sale_id`** | uuid null | **Para Ventas, sin FK.** Copiado de la respuesta (link firmado). Ventas (00162) suma la FK de `form_submissions.sale_id` y la de `contract_signatures.sale_id`. Ventas (00168) reescribe `submit_form_response`/`record_contract_signature` para validar el `sale_id` contra el contacto y sumarlo al payload de `form_submitted`/`contract_signed`. |
| **`service_id`** | uuid null | **Para CX, sin FK.** Copiado de la respuesta (link firmado). CX (00172) suma la FK de `form_submissions.service_id` y la de `contract_signatures.service_id`. |

Índices: `(form_id, signed_at desc)`, `(email_status) WHERE email_status IN ('retrying','not_sent')`.

### 9.6 Cambios en tablas existentes

| Tabla | Cambio | Migración |
|---|---|---|
| `flows` | `form_id uuid null REFERENCES forms(id) ON DELETE SET NULL` + `idx_flows_form` parcial | 00155 |
| `triggers` | CHECK `type` + `form_submitted`, `survey_answered`, `contract_signed` | 00155 |
| `integration_configs` | CHECK `type` + `captcha` | 00154 |
| `analytics_events` | Índice parcial `idx_analytics_forms` (§9.4) y los `event_type` `form_view`, `form_start`, `form_rejected` (sin CHECK que cambiar) | 00151 |
| `storage.buckets` | `form-uploads` (privado, 10 MB, `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, docx, xlsx) y `contracts` (privado, 10 MB, `image/png`, `application/pdf`) | 00153 |

### 9.7 Funciones SQL

| Función | Migración | Seguridad | Qué hace |
|---|---|---|---|
| `can_view_forms(ws uuid)` | 00150 | DEFINER, STABLE | §5 |
| `can_see_form_submission(s form_submissions)` | 00150 | DEFINER, STABLE | §5 |
| `get_public_form(p_slug text)` | 00152 | DEFINER, STABLE, `anon` + `authenticated` + `service_role` | Definición pública (lista blanca, F9) |
| `publish_form_version(p_form_id uuid, p_actor uuid)` | 00152 | DEFINER, solo `service_role` | F8 (la Server Action verifica `forms.manage` antes) |
| `form_metrics_daily(p_form_id uuid, p_from date, p_to date)` | 00152 | DEFINER, STABLE, `authenticated` + `service_role`; exige `can_view_forms` | F14 |
| `submit_form_response(...)` | 00152 v1 → 00156 v2 → 00157 v3 | DEFINER, solo `service_role` | F12, F16, F26 |
| `find_contact_by_phone_or_email(ws, phone, email)` | 00156 | DEFINER, STABLE, solo `service_role` | F16 |
| `record_contract_signature(...)` | 00157 | DEFINER, solo `service_role` | F26 |

Todas con `SET search_path = ''` y referencias calificadas (`public.`). `REVOKE ALL … FROM public` y `GRANT EXECUTE` explícito.

### 9.8 Políticas de datos

- **Nada se borra:** formularios se archivan; versiones son inmutables; respuestas se marcan spam; firmas son permanentes. El purgado de 30 días (`purge_soft_deleted`) **no** alcanza a estas tablas.
- **Auditoría:** `audit_log` con `entity_type` `form` (crear, editar, publicar, pausar, archivar, cambiar mapeo, flujos), `form_submission` (vincular, spam), `contract_signature` (reenvío, regenerar PDF) y `contact` (creado o vinculado por formulario), con `actor_type`/`actor_label` de Llamadas.
- **Snapshots:** la respuesta guarda la etiqueta de cada campo; la firma guarda la versión y la huella; el PDF se arma siempre con la versión de la firma.
- **Notas de optimización:** no hay tabla de campos (viven en jsonb de la versión: se leen siempre juntos y una versión es inmutable); no hay tabla de contadores ni de vistas (vistas, inicios y rechazados en `analytics_events`, envíos desde `form_submissions`); no hay tabla de intentos de email (columnas en la firma + `email_log` existente); no hay tabla de tokens de encuesta (link firmado con HMAC, sin estado).

---

## 10. Arquitectura

```
PÚBLICO (sin sesión)                                INTERNO (sesión + permisos)
/f/[slug]  (Server Component)                       /dashboard/formularios                  (lista)
  └─ get_public_form(slug) ── lista blanca          /dashboard/formularios/[id]             (Campos · Contacto · Automatizaciones · Publicar)
  └─ <PublicForm> (cliente): visibilidad, Zod,      /dashboard/formularios/[id]/respuestas[/sid]
     Turnstile widget, firma, beacons               /dashboard/formularios/[id]/metricas
POST /api/public/forms/[slug]/beacon  (view/start)  /dashboard/formularios/[id]/encuesta
POST /api/public/forms/[slug]/submit  (multipart)   /dashboard/formularios/[id]/automatizaciones/[flowId]
public/embed/embed.js  (Agenda + f/<slug>)                 │ Server Actions: lib/actions/forms/* (requirePermission)
        │                                                  │
        ▼                                                  ▼
lib/forms/ ── fields, definition-schema, visibility, prefill, attribution, success,   (puros)
          ├── submission-schema, contact-config, contact-mapping, survey, survey-metrics,
          ├── metrics, responses, export, list, signed-link, public-definition
          ├── contract/ markdown, signature, legal, email-retry, pdf (servidor), config
          ├── automation/ triggers, trigger-config, variables, templates
          ├── turnstile (servidor), submit (servidor)
lib/antispam/rate-limit.ts  ──► rate_limits + bump_rate_limit   (+ hashIp/clientIp de la Agenda)
lib/contacts/touch-entry.ts: formTouch ──► recordTouch ──► record_contact_touch (intacta)
lib/flow-engine/registry/form-triggers.ts ──► automation_events ──► cron ──► motor (intacto)
lib/response-assets/bank-variables.ts: + resolveFormLinkVariables ({{form_link.*}})
lib/jobs/handlers/contract-pdf.ts, contract-email.ts ──► scheduled_jobs (cron cada minuto)
components/forms/{builder,editor,public,responses}/*   components/automations/linear-flow-editor.tsx
Supabase: forms, form_versions, form_submissions, contract_signatures
          analytics_events (existente: form_view · form_start · form_rejected, índice parcial)
          flows.form_id · triggers (+3 tipos) · integration_configs (+captcha)
Vault: turnstile_secret_key · forms_link_secret     Storage: form-uploads · contracts (privados)
Externos: Cloudflare Turnstile (siteverify) · Resend (adjuntos)
```

**Principios:**
- **El servidor decide.** El navegador valida para dar feedback rápido; el servidor recalcula visibilidad, obligatorios, opciones, rangos, archivos, firma y huella.
- **La página pública solo ve la lista blanca** que devuelve `get_public_form`. Nunca un `select` sobre `forms`.
- **Idempotencia por índice único**, no por `SELECT` previo (el `SELECT` es solo para devolver lo que ya existía).
- **Una transacción por envío:** contacto, respuesta, firma y evento juntos o nada.
- **Lo que viene después del guardado nunca tumba el envío:** toque, notificación, jobs, en `try/catch`.
- **Un evento por respuesta**, según el tipo: no hay dos caminos que disparen lo mismo.
- **La huella es del texto guardado**, calculada y verificada en la base.

---

## 11. Storage

| Bucket | Acceso | Ruta | Tipos | Límite | Retención |
|---|---|---|---|---|---|
| `form-uploads` | **Privado**, sin policies para `authenticated`/`anon`: escribe y firma solo el servidor (service role) | `{workspace_id}/{form_id}/{idempotency_key}/{field_key}/{uuid}.{ext}` | jpeg, png, webp, pdf, docx, xlsx (tipo real por `sniffUploadMime`) | 10 MB por archivo, hasta 3 por campo | Mientras exista la respuesta (nunca se borra) |
| `contracts` | **Privado**, igual | `{workspace_id}/{form_id}/{idempotency_key}/signature.png` · `{workspace_id}/{form_id}/{signature_id}/contrato-v<N>.pdf` | png, pdf | 10 MB | Permanente |

- **Lectura:** URL firmada de **60 segundos**, generada en el servidor solo si `can_see_form_submission` (archivos) o `can_see_form_submission` de la respuesta de la firma (PDF y firma). Nunca URL pública.
- **Primer segmento = `workspace_id`**, como en `chat-media`.
- **Archivos huérfanos:** si la RPC falla después de subir (raro: la validación es antes), el archivo queda en la carpeta de la `idempotency_key`; el reintento con la misma clave reusa la carpeta. No hace falta un barrido en esta versión (anotado en §19).
- **Plan:** dentro de Supabase Pro (100 GB). Un contrato pesa ~100-300 KB; un formulario con archivos, hasta 30 MB por respuesta.

**Criterios:** un `.exe` renombrado se rechaza; 12 MB se rechaza; una URL firmada vencida no sirve; un Member que no ve la respuesta no obtiene URL (cubiertos en F12, F13, F28 y `verify-forms.mjs`).

---

## 12. Stack y decisiones técnicas

| Decisión | Elección | Por qué |
|---|---|---|
| **D2 · Builder de campos** | **Builder propio** (`components/forms/builder/*`) con modelo propio (`lib/forms/fields.ts`), reusando los helpers puros de la Agenda (`identifierFromLabel`, `uniqueIdentifier`, `IDENTIFIER_RE`, `normalizePhoneWithCountry`) | El de la Agenda está atado a `BookingField` y a reglas que no valen acá (tres campos del sistema fijos, email o teléfono obligatorio, 7 tipos, sin condiciones ni ocultos ni archivos) y lo valida `bookingFieldsSchema` sobre datos en producción (`event_types.booking_fields`). Extenderlo obligaría a ensanchar un tipo que usa la reserva pública y su Zod, con riesgo de romper agendas. Compartir los helpers puros da lo reusable sin ese riesgo. |
| **D3 · Editor de automatizaciones** | **Se extrae** `components/automations/linear-flow-editor.tsx`; el de la Agenda queda como envoltorio. La lista de flujos del formulario es un componente nuevo (`automations-tab.tsx`) | El editor lineal es lo mismo para los dos (Cuándo / Si / Entonces) y tiene 285 líneas: copiarlo duplicaría cada arreglo futuro. Lo único de agenda que trae (variables, `describeTrigger`, acciones, rutas) pasa a props. La lista no se comparte porque la de la Agenda no crea ni ofrece plantillas (H6): forzarla a hacerlo cambiaría la Agenda sin que nadie lo pidiera. |
| **D4 · PDF en el servidor** | **`pdf-lib@1.17.1`** (MIT; dependencias `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, `tslib`; **19,5 MB desempaquetado** en `node_modules`, verificado con `npm view` el 10/10/2026; sin binarios nativos; solo servidor, no entra al bundle del navegador). **Decisión a aprobar: es una dependencia nueva.** | El repo no tiene con qué generar un PDF (`unpdf` solo lee). `pdf-lib` es JS puro (corre en Railway sin dependencias del sistema), embebe PNG (la firma) y trae Helvetica con WinAnsi, que cubre el español. Alternativas descartadas: **jsPDF** (lo usa prevxcrm; 30,2 MB desempaquetado, pensado para el navegador), **Puppeteer/Chromium** (cientos de MB y un navegador en el servidor), **@react-pdf/renderer** (más pesado y otro modelo de componentes). Su última versión es de 2022: es estable y la API que se usa (texto, imagen, páginas) no cambia. |
| D5 · Captcha | **Cloudflare Turnstile**, verificado en el servidor (`siteverify`), secret en Vault, site key pública en `integration_configs.config` | Gratis, sin cookies de rastreo, y es lo que pide el alcance. Card en Integraciones con tipo nuevo `captcha` (CHECK aditivo) |
| D7 · Formato del contrato | **Markdown acotado** + textarea con vista previa; un solo renderizador puro para la página y el PDF | No hay editor rico en el repo y sumar uno (Tiptap, etc.) es otra dependencia grande. Un subconjunto chico es predecible para la huella y para el PDF |
| Tope por IP | `rate_limits` + `bump_rate_limit` (existentes) con `lib/antispam/rate-limit.ts` genérico | H10: la tabla y la RPC ya son genéricas |
| Validación | **Zod 4** (ya está) con `buildSubmissionSchema`, mismo patrón que `buildBookingSchema` | Mismo esquema en el navegador y en el servidor |
| Transacciones | Funciones plpgsql por RPC (`submit_form_response`, `publish_form_version`, `record_contract_signature`) | El cliente de Supabase no sostiene una transacción entre llamadas |
| Link firmado por contacto | HMAC-SHA256 con `node:crypto` y secreto en Vault; payload `{f, c, s?, o?, e}` | Sin estado y sin tabla; vence solo; los ids no se pueden alterar sin romper la firma |
| Reintentos de email | Jobs en `scheduled_jobs` con `run_at` y `dedupe_key` | Reusa la cola y su registro; nada nuevo que monitorear |
| Fechas | `dayjs` (ya está) + `Intl` en la zona del workspace | No hay `date-fns` en el repo |
| Gráficos | `recharts` (ya está) | |

---

## 13. Pantallas detalladas

### 13.0 Convenciones globales
- Barra superior de 56 px con título e ícono ⓘ (`PageHeader`), como el resto del sistema. `components/ui` existentes (Switch, Notice, botones, modales).
- **Estados en toda pantalla nueva:** skeleton al cargar; vacío con acción; error con "Reintentar"; éxito con toast.
- **Responsive:** 390 px sin scroll horizontal. Las tablas pasan a tarjetas con los datos principales; las pestañas del editor pasan a un selector.
- **Textos:** español con voseo, sin jerga ("respuesta", no "submission").
- **Fechas:** zona del workspace. **Lógica de cada pantalla en `lib/forms/*`**, probada con Vitest.

### 13.1 Bloque FO1

**Formularios (lista)** — `/dashboard/formularios`
- Layout: barra con "+ Nuevo formulario" (solo `forms.manage`); pastillas; tabla.
- Vacío: "Todavía no hay formularios. Creá el primero para captar leads, medir satisfacción o firmar contratos." + botón.
- Interacciones: clic en la fila → editor; menú ⋯ con Duplicar, Pausar/Reanudar, Archivar/Restaurar (confirmación en archivar).
- 390 px: tarjetas con nombre, chip de tipo y estado, envíos.

**Editor del formulario** — `/dashboard/formularios/[id]`
- Encabezado: nombre editable, chip de estado, "Vista previa" (abre `/f/<slug>?preview=1` con el borrador, solo con sesión y `forms.view`) y **"Publicar"** (deshabilitado con el motivo si falta Turnstile o hay errores de validación; muestra "Hay cambios sin publicar" cuando `draft_definition` difiere de la versión vigente).
- Pestañas: **Campos · Contacto · Automatizaciones · Publicar** (+ **Contrato** en contratos y **Encuesta** en encuestas para su configuración) y accesos a **Respuestas**, **Métricas** y (encuestas) **Panel**.
- **Campos:** izquierda la lista (flechas para ordenar, ícono por tipo, "Oculto"/"Condicional" como chips), "+ Agregar campo" con el selector de 13 tipos; panel del campo (etiqueta, ayuda, obligatorio, opciones, mín./máx., archivo, consentimiento, oculto, **llenar desde la URL** (parámetros y comportamiento, F4/F6), **condiciones** con el constructor); derecha la vista previa en vivo con el mismo componente público. Diseño (título, introducción, texto del botón, mostrar logo) y Éxito (mensaje o redirección) en dos tarjetas plegables al pie.
- Guardado del borrador automático con indicador ("Guardado" / "Guardando…" / "No se pudo guardar · Reintentar"); aviso de cambios sin guardar al salir (`lib/unsaved-changes.ts` existente).
- Solo lectura sin `forms.manage`.
- 390 px: la vista previa pasa a un botón "Ver cómo queda".

**Publicar (pestaña)**
- Link público con "Copiar" y "Abrir"; slug editable (con el aviso de links viejos).
- Embed: pestañas "En la página" y "Botón flotante" con el código y "Copiar".
- Estado de Turnstile: "Protegido con Cloudflare Turnstile" o "Falta configurar Turnstile → Integraciones".
- Encuestas: "Link para un contacto" (buscador de contactos + copiar el link firmado).
- Historial de versiones: número, fecha, quién publicó, y para contratos la huella (primeros 12 caracteres).

**Página pública** — `/f/[slug]`
- Una columna centrada (máx. 640 px), logo arriba (si `showLogo`), título, introducción, campos, Turnstile, botón con el color de la marca. Errores por campo debajo de cada uno; error general arriba del botón con "Reintentar".
- Estados: cargando el envío (botón con spinner, deshabilitado: evita el doble clic), éxito (mensaje o redirección), "Este formulario no está disponible", "Ya respondiste, ¡gracias!".
- En `embed=1`: sin márgenes externos y avisa el alto al padre.
- 390 px: campos a lo ancho, teclado numérico para teléfono y número, NPS en dos filas de botones (0-5 y 6-10).

**Respuestas** — `/dashboard/formularios/[id]/respuestas`
- Barra: período, estado, "con/sin contacto", "Exportar CSV". Tabla con columnas dinámicas (F13). Clic → detalle.
- Vacío: "Todavía no hay respuestas. Compartí el link desde Publicar." con link.
- **Detalle:** respuestas (etiqueta: valor), archivos (botón que pide el link firmado), contacto (link a la ficha) o "Sin contacto · Vincular" (`forms.manage`), atribución, versión, origen, firma y estado del PDF y del email (contratos) con "Ver PDF" / "Reenviar copia" / "Regenerar PDF", y el `<Historial>` (Owner/Admin).
- 390 px: tarjetas con fecha, contacto y las dos primeras respuestas.

**Métricas** — `/dashboard/formularios/[id]/metricas`: período, cuatro números, barras por día. Vacío: "Sin datos en este período".

**Integraciones → Seguridad → Cloudflare Turnstile:** card con estado, modal con site key (visible) y secret key (se pega, no vuelve), "Probar y guardar", link a la guía de Cloudflare.

### 13.2 Bloque FO2

**Contacto (pestaña):** explicación en una línea ("Cada respuesta crea o vincula un contacto por teléfono o email, nunca por nombre"); selector **Qué hacer** (Crear o vincular · Solo vincular) y **Si ya existe** (Completar solo lo vacío · Pisar con lo nuevo); tabla de mapeo con un selector por campo (agrupado: Contacto · Campos personalizados), sugerencias marcadas; aviso fijo si no hay email ni teléfono; etiquetas al enviar (selector de tags); aviso en la campana (switch + a quién).

**Automatizaciones (pestaña):** lista de flujos con interruptor; vacío "Todavía no hay automatizaciones para este formulario" + "+ Nueva automatización" + las plantillas como tarjetas de un clic ("Avisarme por email", "Mandarle un mensaje de gracias", "Ponerle un tag", y en encuestas "Avisarme si es detractor"). Requiere `flows.view` para ver y `forms.manage` + `flows.edit` para crear/encender. Nota al pie: "Los flujos nacen apagados: leelos y encendelos."

**Editor lineal** — `/dashboard/formularios/[id]/automatizaciones/[flowId]`: el componente compartido con el trigger descrito en palabras ("Cuando se envía *Aplicación al programa* y facturación es más de 10k"), condiciones, pasos, selector de variables con `form.*`, `answer.*` (las claves del formulario) y `submission.*`, "Enviarme una prueba", "Abrir en el canvas".

**Canvas (`TriggerPanel`):** los tres triggers en su grupo "Formularios", con el selector de formularios y el constructor de condiciones.

### 13.3 Bloque FO3

**Encuesta (pestaña de configuración):** campo de puntaje principal (selector entre los `rating`/`nps` obligatorios), categoría, "una vez por contacto" (switch con la explicación de cómo se identifica).

**Panel de encuesta** — `/dashboard/formularios/[id]/encuesta`: período; cuatro números (respuestas, NPS o promedio, % promotores, % detractores); distribución; evolución; últimos comentarios. Vacío: "Todavía no hay respuestas". Chip de alcance para Members. 390 px: números en 2×2 y gráficos a lo ancho.

**Contrato (pestaña):** título, editor del texto (textarea + vista previa lado a lado; en 390 px, pestañas "Escribir · Ver"), ayuda del formato permitido, "Firma obligatoria", texto de aceptación, copias a direcciones fijas. Aviso: "Si cambiás el texto y publicás, se crea una versión nueva. Las firmas anteriores quedan con su versión."

**Página pública del contrato:** título; el texto en un recuadro con scroll (alto máximo 60 % de la pantalla); campos; casilla de aceptación; recuadro de firma con "Borrar"; "Firmar y enviar". Éxito: "Listo. Te mandamos la copia firmada a <email> en unos minutos."

---

### 13.4 Bloque FO4

**Páginas del sitio** — `app/(sitio)/…` (públicas, sin login)
- Las arma Claude Code a pedido (no hay editor visual de páginas, decisión 182). Cada página usa el layout del sitio (`app/(sitio)/layout.tsx`: encabezado con logo y nombre del white label, pie, sin nada del dashboard) y puede poner uno o varios `<Formulario slug="…" />`.
- El formulario dentro de una página se ve **igual** que en `/f/<slug>` pero sin su marco de página: toma el ancho del contenedor (máx. 640 px por defecto), con `variant="card"` (tarjeta con borde) o `"plain"` (sin borde, para meterlo en una sección con fondo propio).
- Estados: los mismos de F9. Si el formulario no está disponible, el componente muestra "Este formulario no está disponible" **dentro de la página**, sin romperla.
- 390 px: sin scroll horizontal; campos a lo ancho.

**Pestaña Publicar (suma de la v1.1, F32)**
- Tarjeta **"Parámetros de la URL"**: tabla con cada campo que se puede prellenar (etiqueta, parámetros que acepta, comportamiento) y los ocultos con su fuente. Debajo, un **armador de link**: elegís valores de ejemplo, o variables del contacto (`{{contact.email}}`, `{{contact.phone}}`, `{{contact.first_name}}`) para usar el link en una automatización, y copiás la URL.
- Tarjeta **"Usar en una página del sitio"**: el código `<Formulario slug="…" />` con "Copiar" y una línea: "Pedile a Claude Code que lo ponga en la página que quieras".
- Tarjeta del embed: suma la opción **"Seguimiento en todo el sitio"** con el snippet de una línea para pegar en el `<head>` de la web externa (F29), con la explicación "así los UTMs no se pierden si la persona llega a una página y llena el formulario en otra".

**Panel del campo (builder, F4):** sección **"Llenar desde la URL"** con los parámetros (chips, por defecto la clave del campo) y el comportamiento (Editable · Bloqueado · Ocultar si viene lleno). No aparece en consentimiento ni archivo.

---

## 14. Guía de UI

- Diseño actual del fork (Tailwind 4, `components/ui`), sin marca propia del cliente: la página pública toma logo y color del white label (`lib/brand.ts`).
- Se reutilizan: `PageHeader`, `Switch`, `Notice`, el buscador de contactos, la tabla con filtros en la URL, el selector de período de los dashboards, `lib/unsaved-changes.ts`, y el editor lineal compartido.
- El constructor de condiciones de formularios (`visibility-rule-builder.tsx`) se escribe **una vez** y lo usan el campo (F5) y el panel de triggers (F19).
- La página pública es liviana: sin `recharts` ni nada del dashboard en su bundle (los componentes públicos viven en `components/forms/public/` y no importan nada de `components/forms/editor/`).
- Tono: directo y amable. Errores que dicen qué hacer ("Elegí una de las opciones", "El archivo pesa más de 10 MB").

---

## 15. Seguridad

**Autenticación:** pantallas internas y Server Actions con sesión y `requirePermission`/`getPermissionAction`. Las rutas públicas (`/f/[slug]`, `submit`, `beacon`) no piden sesión: su defensa es Turnstile, honeypot, tope por IP, idempotencia y validación total en el servidor.

**RLS por tabla nueva:**

| Tabla | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| `forms` | `is_workspace_member(workspace_id) AND can_view_forms(workspace_id)` | Solo servidor (Server Actions con `forms.manage` usando el cliente de servicio) | Nadie |
| `form_versions` | Igual que `forms` | Solo `publish_form_version` | Nadie (sin UPDATE: inmutable) |
| `form_submissions` | `can_see_form_submission(form_submissions)` | Solo las RPC (service role) | Nadie |
| `analytics_events` (existente, **sin cambios de RLS**) | La política existente (`is_workspace_member`): por eso los eventos `form_*` no llevan datos personales | El servidor con el cliente de servicio (beacon y rechazos) | Sin cambios |
| `contract_signatures` | `EXISTS (select 1 from form_submissions s where s.id = submission_id and can_see_form_submission(s))` | Solo `record_contract_signature` y los jobs (service role) | Nadie |
| `anon` | **Ninguna policy** en las cuatro tablas nuevas: lo público sale solo por `get_public_form` | — | — |

**Las fallas de prevxcrm que acá se hacen bien:**
- **Definición pública:** prevxcrm leía el formulario con `select('*')` desde el navegador. Acá, `get_public_form` con lista blanca, y `anon` sin acceso a las tablas.
- **Idempotencia:** único `(form_id, idempotency_key)`; un doble clic o un reintento devuelven la misma respuesta y disparan una sola vez.
- **Captcha:** Turnstile verificado en el servidor con la secret en Vault e `idempotency_key`; sin verificación no se guarda (ni siquiera si Cloudflare no responde).
- **Validación total en el servidor**, incluidas condiciones, prellenados bloqueados y archivos por tipo real.
- **Huella** SHA-256 sobre `form_versions.contract_text`, calculada al publicar y re-verificada al firmar, en la base. El pedido no trae el texto.
- **Buckets privados** con links firmados de 60 s.
- **Tope por IP** con `rate_limits`.

**Datos sensibles:**
- Turnstile secret y `forms_link_secret` solo en Vault; no se loguean ni vuelven al navegador.
- IP: hasheada (`hashIp`) en `form_submissions.meta` y en `rate_limits`; **en claro solo en `contract_signatures.legal`** (evidencia legal), que ven Owner, Admin y quien ve esa respuesta.
- Logs del envío: solo `form_id`, `submission_id`, resultado y códigos. Nunca respuestas, emails, teléfonos ni la firma.
- El `audit_log` no copia respuestas: guarda ids y acciones.
- CSV: protección contra inyección de fórmulas.

**Protección contra ataques comunes:**
- **XSS:** todo texto del formulario y de las respuestas se renderiza escapado (React); el contrato pasa por `renderContractMarkdown` que escapa todo HTML; la pantalla de éxito escapa las variables; ningún `dangerouslySetInnerHTML`.
- **Clickjacking:** solo `/f/*` es embebible (`frame-ancestors *`, como `/calendario`); `/dashboard` sigue con `DENY`.
- **Open redirect:** la redirección de éxito solo admite `http(s)` y la URL la define quien tiene `forms.manage`; los parámetros que se le suman son ids y UTM, nunca respuestas.
- **CSRF:** las rutas públicas no usan cookies de sesión; las internas son Server Actions (protección de Next).
- **Enumeración:** `get_public_form` no distingue "no existe" de "pausado".
- **Links de encuesta:** HMAC con comparación en tiempo constante y vencimiento; un token inválido no da error (no revela nada).

**Checklist para la IA constructora:**
- [ ] RLS habilitada en las 4 tablas nuevas y probada con `verify-forms.mjs` (Owner, Member, otro workspace, `anon`)
- [ ] `get_public_form` probada contra la lista de claves prohibidas
- [ ] `requirePermission`/`getPermissionAction` en toda página y Server Action nueva
- [ ] Validación Zod en el servidor del pedido y de las respuestas (`buildSubmissionSchema`)
- [ ] Turnstile verificado en el servidor; secret en Vault; nunca aceptar sin verificar
- [ ] Idempotencia probada con 5 pedidos simultáneos
- [ ] Tope por IP en `submit` y `beacon`; deduplicado por sesión en `beacon`; eventos `form_*` sin datos personales y sin `contact_id`
- [ ] Archivos: tipo real, tamaño, cantidad; bucket privado; links de 60 s
- [ ] Huella calculada en la base sobre el texto guardado; test con texto alterado desde el navegador
- [ ] Ningún Client Component alcanza `lib/vault.ts`, `turnstile.ts`, `submit.ts` ni `pdf.ts` (`vault-boundary.test.ts`)
- [ ] Logs sin datos personales
- [ ] Headers: `/f` embebible, `/dashboard` con `DENY`
- [ ] HTTPS (Railway lo da)

**Suma de la v1.1 (FO4):**
- **Cookie de atribución `ssa_attr`:** propia del dominio, `SameSite=Lax`, `Secure`, `Path=/`, 90 días, **sin datos personales** (solo claves de atribución y fechas), hasta 3,5 KB. No es `HttpOnly` porque la lee el navegador: por eso el servidor **siempre** la re-sanea con `attributionFromParams` y nunca la usa para decidir permisos.
- **Parámetros que el embed reenvía:** lista de exclusión de nombres sensibles, topes de cantidad y tamaño, y el formulario solo usa los que declara (F10). Ningún parámetro reenviado se guarda si no es de un campo o de atribución.
- **Páginas del sitio:** no leen la sesión ni cookies del usuario logueado; son públicas y cacheables. Los headers siguen siendo los del sitio (no embebibles: `X-Frame-Options: DENY`, como el resto salvo `/f` y `/calendario`). `lib/security-headers.test.ts` lo verifica para `/` y para una página de ejemplo.
- **`fbclid`, `fbp` y `fbc` no son datos personales del contacto** pero se tratan igual que los UTM: se guardan en la respuesta y en el toque, no se muestran en la página pública ni se mandan a terceros (la API de conversiones de Meta queda fuera, §17).
- **Consentimiento de cookies:** no hay banner en esta versión (decisión 186, a confirmar): la cookie es propia, de medición y sin datos personales. Si el sitio va a recibir tráfico de la Unión Europea, se suma antes un banner (§17).

---

## 16. Decisiones transversales y casos borde

| Tema | Definición para este módulo |
|---|---|
| Historial y auditoría | `audit_log` con `actor_type`/`actor_label` (de Llamadas) para formularios, respuestas, firmas y contactos creados o vinculados. `<Historial>` en el detalle de la respuesta y en el editor. **Lo ven Owner y Admin**: la política `audit_log_select` no se toca en este módulo (un Member ve solo lo que hizo él, como hoy) |
| Soft delete | Nada se borra: archivar, inmutabilidad, spam |
| Deduplicación | Teléfono exacto → email exacto, nunca nombre (H1, H2). Sin ninguno de los dos, sin contacto (decisión 156) |
| Snapshots | Etiqueta por respuesta; versión y huella por firma |
| Estados | Formulario: Borrador · Publicado · Pausado · Archivado. Respuesta: Recibida · Sin contacto · Spam (las rechazadas no son respuestas: quedan como evento `form_rejected`). Email del contrato: Pendiente · Enviado · Reintentando · No enviado. PDF: Pendiente · Generado · Falló |
| Zona horaria e idioma | UTC en la base; métricas y fechas en la zona del workspace; español |
| Automatización | Flows normales con `form_id`, 3 triggers registrados, motor intacto |
| Asignación | Formularios no asigna setter ni vendedor (lo hará Ventas con sus reglas de asignación al crearse el contacto) |
| Contacto cross-canal | El contacto creado por formulario no tiene `contact_channels`; si después escribe por WhatsApp, `find_or_link_contact` lo encuentra por teléfono, como a uno de la Agenda |
| Secrets | Turnstile y `forms_link_secret` en Vault; key inválida → publicar bloqueado y aviso en la card |
| Webhooks | No hay tipo webhook (decisión 155) |
| Envíos masivos | No aplica |

**Casos borde con su regla:**
- **El contacto ya existía:** se vincula, se completan solo los vacíos (por defecto) y el toque es el último; el primero no cambia (F16, F17).
- **Email de un contacto y teléfono de otro:** gana el teléfono (regla real del sistema, H2); la respuesta guarda el otro en `dedupe.conflict_contact_id` y el detalle lo muestra: "El email coincide con otro contacto: <link>".
- **Sin email ni teléfono:** respuesta sin contacto; se vincula a mano; no dispara salvo que se tilde la casilla al vincular.
- **"Solo vincular" sin coincidencia:** respuesta sin contacto.
- **Doble clic, reintento de red, dos pestañas:** una respuesta, un evento (idempotencia + `trigger_fires`).
- **Captcha falla o spam (honeypot):** no se guarda respuesta; queda un `form_rejected` en `analytics_events`.
- **Refresh de la página pública:** misma pestaña, mismo `sid`: una sola vista.
- **Cloudflare no responde:** 503 "Probá de nuevo en un momento"; no se guarda sin verificar.
- **Formulario pausado o archivado:** "Este formulario no está disponible" (también para un envío en curso: 404).
- **Se publica una versión nueva mientras alguien completa:** se valida contra la vigente; si no pasa, 409 "El formulario cambió: recargá la página" (las respuestas cargadas se conservan en el navegador).
- **Se borra o renombra un campo con respuestas:** las respuestas conservan su etiqueta; la tabla muestra la columna vieja.
- **Contacto "no contactar":** se guarda, se dispara, y los mensajes del flow lo respetan. **Ojo (H8):** la plantilla "Avisarme por email" tampoco sale para ese contacto, porque el nodo de email del motor chequea la marca aunque el destinatario sea fijo; el aviso confiable es la campana (F18). Queda anotado en `docs/PENDIENTE.md` como mejora del motor (fuera de este módulo).
- **Archivo de más o de otro tipo:** rechazado en el navegador y en el servidor.
- **Prellenado bloqueado manipulado:** se valida como cualquier respuesta.
- **El contacto respondió una encuesta "una vez" y alguien la marca spam:** puede volver a responder.
- **Contrato editado después de firmas:** versión nueva; las firmas viejas no cambian.
- **Falla el PDF o el email:** la firma queda; reintentos 5/15/30; después botón.
- **Un campo personalizado mapeado se borró:** el mapeo se ignora en el envío y se marca en la pestaña.
- **Dos personas editan el mismo borrador:** gana el último guardado; si `updated_at` cambió desde que se abrió, aviso "Alguien más cambió este formulario: recargá" antes de pisar.
- **Se cierra la ventana a mitad del formulario:** no se guarda nada (una sola página, sin borradores del lado del que responde).
- **Un usuario sale del workspace:** sus formularios siguen; deja de recibir avisos.

**Casos borde de la v1.1 (FO4):**

| Caso | Qué pasa |
|---|---|
| La persona llega al home con `?utm_campaign=octubre`, navega a /contacto y llena el formulario ahí | El toque lleva `utm_campaign = octubre` (último toque persistido) y `page_url = /contacto` |
| Llega primero por Google (`gclid`) y a la semana vuelve por un anuncio de Meta (`fbclid`) | `first_visit` = la de Google, último = la de Meta. El toque del envío usa la de Meta; la de Google queda en `attribution.first_visit` de la respuesta |
| Llega sin ningún parámetro y sin cookie | El toque queda `source: "web"` con `referrer_url` y `landing_page` si los hay |
| El navegador bloquea cookies o `localStorage` | No se persiste nada y se usa solo lo de la URL actual (nunca rompe el formulario: todo en `try/catch`) |
| La cookie viene adulterada (JSON roto, claves inventadas, 10 KB) | Se ignora entera, o se descartan las claves que no están en la lista; el envío sigue |
| Un campo con "Ocultar si viene lleno" recibe un valor inválido por URL | El valor se ignora y el campo **se muestra** vacío |
| Un campo obligatorio está oculto por prellenado y la persona borra el parámetro a mano en la URL | Se muestra (no vino lleno) |
| La web externa no tiene el snippet de seguimiento en el `<head>`, solo el embed en la página del formulario | Funciona igual con los UTM de esa página; lo que se pierde es la persistencia entre páginas de esa web (lo dice la pestaña Publicar) |
| Dos formularios en la misma página del sitio | Cada uno con su `idempotency_key` y su envío; comparten la misma atribución |
| Un clon nuevo sin páginas propias | `/` redirige a `/login`, igual que hoy (la versión por defecto de `app/(sitio)/page.tsx`) |

---

## 17. Fuera de alcance

**Para módulos siguientes de la v7:**

| Funcionalidad | Dónde | Nota |
|---|---|---|
| Botón "Enviar contrato" en la venta (usa `signFormLink` con `saleId`), contrato prellenado y FK de `sale_id` | Ventas | El link firmado y la columna ya guardan `sale_id`. Ventas (00162) suma la FK de `form_submissions.sale_id` y la de `contract_signatures.sale_id`. Ventas (00168) reescribe `submit_form_response`/`record_contract_signature` para validar el `sale_id` contra el contacto y sumarlo al payload de `form_submitted`/`contract_signed`. |
| Ítems del camino que se completan con un envío (desempatan el servicio por `form_submissions.service_id`, que llega por el link firmado); "una vez por servicio"; FK de `service_id` | CX | El link firmado y la columna ya guardan `service_id`. CX (00172) suma la FK de `form_submissions.service_id` y la de `contract_signatures.service_id`. `once_key` lista |
| Mapeo a contacto reutilizable por webhooks, nodo HTTP y agente | Ventas Fase 2 | Mismo vocabulario de destinos |

**Fuera de la v7 (alcance §6):** formularios de varios pasos; exámenes y evaluaciones; EOD; tipo webhook; firma tipeada o con certificado digital; pagos dentro del formulario; lógica de puntaje (quiz); A/B de formularios.

**Fuera de la v1.1 (FO4):** editor visual de páginas (constructor tipo landing builder o CMS desde el dashboard: las páginas las arma Claude Code); blog o colecciones de contenido; dominio propio por página; píxeles de anuncios (Meta Pixel, Google Tag) y API de conversiones (los datos para usarla, `fbp`/`fbc`/`gclid`, ya quedan guardados); banner de consentimiento de cookies; pruebas A/B de páginas; atribución multi-toque más allá de primero y último.

**Además, en este documento:** editor de texto enriquecido (se usa Markdown acotado, D7); variables dentro del texto del contrato; varios firmantes; subida de logo por formulario (sale del white label); temas por formulario; plantillas de formularios precargadas; dashboard de formularios en Dashboards; editar o borrar respuestas; barrido de archivos huérfanos; una rama nueva de `audit_log_select` para que Members vean el historial de respuestas; cambiar el nodo `send_email` para que el aviso a una dirección fija ignore "no contactar" (H8); fusionar contactos desde un conflicto de dedupe.

---

## 18. Verificación en vivo (después de construir, con Wendy)

No es parte de la definición de listo.

1. Cargar las claves reales de Turnstile en Integraciones y verificar que la card queda "Conectado".
2. Crear "Aplicación al programa" como en el flujo 8.1, mapear a contacto, crear la automatización desde la pestaña y publicar.
3. Pegar el embed en una landing real y entrar con `?utm_source=facebook&utm_campaign=octubre&ad_id=123` desde el celular. Enviar.
4. Verificar: contacto creado con los campos mapeados; en su ficha, atribución "primer toque: facebook / form / octubre / anuncio 123"; la respuesta con su contacto; la notificación; el WhatsApp y el tag del flow.
5. Volver a enviar con el mismo email y otra campaña: el contacto es el mismo, el **primer** toque sigue en octubre y el **último** cambió.
6. Hacer doble clic rápido en "Enviar" con la red lenta (modo avión al tocar y volver): una sola respuesta.
7. Enviar sin email ni teléfono (si el formulario lo permite): respuesta "Sin contacto"; vincularla a mano.
8. Crear la encuesta "¿Cómo vas?", mandar el link firmado por WhatsApp desde un flow, responder con 4 desde el celular: llega el aviso de detractor; volver a abrir el link: "Ya respondiste".
9. Ver el panel con el NPS.
10. Crear el contrato, firmarlo con el dedo en el celular, recibir el email con el PDF; abrir el PDF y comparar la huella con la de la versión en la pestaña Publicar.
11. Editar el texto, publicar la versión 2, y verificar que la firma anterior sigue con la versión 1 y su PDF no cambió.
12. Desconectar Resend un momento, firmar otro contrato y ver "Reintentando" → "No enviado"; reconectar y "Reenviar copia".
13. Abrir el formulario pausado: "Este formulario no está disponible".
14. Con un usuario Member: ver solo las respuestas de sus contactos y no poder publicar.
15. **(FO4)** Pedirle a Claude Code una página de prueba del sitio con `<Formulario>`. Entrar al home con `?utm_source=facebook&utm_campaign=octubre&fbclid=prueba123`, navegar a la página del formulario **sin** parámetros y enviar: la respuesta y el toque del contacto tienen `utm_campaign = octubre`, `fbclid` y `fbc`.
16. **(FO4)** En una web externa con el snippet de seguimiento en el `<head>`: entrar con UTMs a una página, ir a otra con el embed y enviar. Mismo resultado.
17. **(FO4)** Un link `?correo=ana@x.com&plan=pro` sobre un formulario con esos parámetros configurados: el email se ve bloqueado o se oculta según su comportamiento, y el plan queda elegido.
18. **(FO4)** Si querés que el sitio responda en tu dominio (por ejemplo `scalingsystems.com`), apuntá el dominio a Railway; es configuración, no código.

---

## 19. Si algo bloquea

- **Algún helper de Llamadas tiene otra firma que la esperada** (están confirmados como existentes): se adapta la llamada a la firma real; no se modifican ni se duplican.
- **La banda 00150–00157 está ocupada:** se corre entera al primer libre, en orden, y se actualiza §1b en `docs/requerimientos-formularios.md`.
- **El CHECK de `triggers` o de `integration_configs` no coincide con lo esperado** (otro módulo lo cambió en el medio): se relee de la base al escribir y se escribe con esa lista; el test de caracterización manda.
- **El CHECK de `integration_configs` no se puede tocar:** no se reusa un tipo existente (mezclaría integraciones distintas). Se usa una configuración propia de Formularios (⚙ en la lista de formularios) con la site key en una columna nueva aditiva `workspaces.turnstile_site_key` (esa migración ocupa el lugar de la 00154) y el secreto igual en Vault. Se anota.
- **`pdf-lib` no se aprueba o no corre en Railway:** F27 no se construye; el contrato se firma, se guarda con su huella y la copia por email sale **sin adjunto**, con el resumen de los datos de aceptación en el cuerpo. Se anota.
- **Resend rechaza adjuntos del tamaño del PDF:** se manda sin adjunto con un link firmado de 7 días al PDF (excepción documentada a la regla de 60 s, solo para el firmante) y se anota.
- **La extracción del editor lineal rompe algo de la Agenda que los tests no cubren:** se revierte la extracción, se copia el componente para Formularios (duplicación consciente, con comentario apuntando al original) y se anota como deuda.
- **El `TriggerPanel` no admite la configuración de condiciones sin reescribirlo:** los triggers se configuran con el selector de formularios en el canvas y las condiciones solo desde el editor lineal de la pestaña; se anota.
- **Turnstile no carga dentro del iframe del embed** (bloqueadores, dominios): se verifica que el sitio de Turnstile tenga cargados los dominios de la landing; si no se resuelve, el embed abre el formulario en modal de pestaña nueva (`/f/<slug>`) y se anota.
- **Existe un usuario de agenda `f`:** el prefijo del embed pasa a `form/` (F10).
- **Archivos huérfanos aparecen en `form-uploads`** (envíos que fallaron después de subir): se anota para un barrido futuro; no bloquea.
- **Nunca quedarse en un loop:** después de un intento serio, `docs/PENDIENTE.md` y seguir.

---

## 20. Chequeo de sincronía con el alcance

Divergencias entre este plano y `alcance-v7.md` (v7.1), con su motivo:

1. **Deduplicación "por `find_or_link_contact`" (§2.2 FO2 y §4.4):** esa función **exige un canal** y no sirve para un formulario (H1). Se usa la **misma regla** con una función nueva chica (`find_contact_by_phone_or_email`), como ya hace la Agenda dentro de `create_booking`. `find_or_link_contact` sigue intocable, que es lo que pedía §4.4.
2. **"Email primero" (§3.3, caso raro):** el sistema real busca **teléfono primero** (H2). Gana el código; el conflicto queda anotado en la respuesta.
3. **"Extender el form-builder de la Agenda" (§1, §2.2 FO1):** se construye un builder propio reusando los helpers puros (D2). El de la Agenda no cambia.
4. **"Igual que en el editor de tipos de evento" (§2.2, decisión 158):** la sección de la Agenda no tiene "+ Nueva automatización" (H6). La pestaña del formulario es nueva y el editor lineal se comparte (D3).
5. **Nombre, apellido y empresa como campos del contacto (§2.2 FO2):** `contacts` solo tiene `display_name`; "apellido" se arma en `display_name` y "empresa" va a un campo personalizado (D6).
6. **Variables:** se suma `{{form_link.<slug>}}` (no estaba en el alcance) porque el flujo 3.4 necesita mandar un link firmado por contacto desde un flow.
7. **"La respuesta sin identificar cuenta en el NPS pero no se vincula" (§3.4)** se cumple, y además **no dispara** automatizaciones (H3: `automation_events.contact_id` es obligatorio).
8. **Aviso al equipo (§2.2, nice-to-have):** la campana es el aviso confiable; la plantilla "Avisarme por email" no sale si el contacto está "no contactar" (H8).
9. **Un trigger por tipo de formulario:** el alcance listaba los tres triggers; acá se fija que cada respuesta emite **uno solo** según su tipo (una encuesta no emite también "formulario enviado").
10. **Card de Turnstile con tipo `captcha`** en `integration_configs`: el alcance pedía "cargar las claves"; dónde, lo define este plano (CHECK aditivo, 00154).
11. **Tablas:** quedan 4 de las 5 de la convención: **`form_stats_daily` no se crea** (decisión de Wendy, 10/10); vistas, inicios y rechazados van a `analytics_events` (alcance §9.2 decía "contadores, no eventos sueltos": cambia). Se suma `flows.form_id` (ya estaba en §9.3 del alcance).

12. **FO4 (v1.1):** el sitio público con formularios, el prellenado configurable y la atribución persistente son un pedido nuevo de Wendy (10/10, 18 h). Ya están en el alcance v7.2 (decisiones 182 a 186, bloque FO4).

**¿Actualizar el alcance?** Recomiendo que sí, en una v7.2 corta: las divergencias 1, 2 y 5 cambian cómo se describe la regla de contacto, y la 9 aclara los triggers. Se marca con ~~tachado~~ lo que sale y **negrita** lo que entra, sin regenerar el documento.

---

## 21. Supuestos y decisiones del documento

### Decisiones que tomé (no estaban en el alcance o el alcance suponía algo que no es)

| # | Decisión | Por qué |
|---|---|---|
| D1 | Deduplicación con `find_contact_by_phone_or_email` (nueva) con la regla de `create_booking`, dentro de la RPC del envío | H1, H2 |
| D2 | Builder propio, sin extender el de la Agenda | §12 |
| D3 | Editor lineal extraído a `components/automations/`; pestaña Automatizaciones nueva | §12 |
| D4 | **`pdf-lib@1.17.1` (a aprobar)** | §12 |
| D5 | Turnstile como card de Integraciones (`captcha`); **publicar exige Turnstile configurado** | El alcance exige captcha en todo envío; las claves de prueba de Cloudflare permiten desarrollar y testear |
| D6 | Apellido → parte de `display_name`; empresa → campo personalizado | `contacts` no tiene esas columnas y agregarlas sería tocar el CRM fuera de este módulo |
| D7 | Texto del contrato en Markdown acotado, sin editor rico | Sin dependencia nueva; huella y PDF predecibles |
| D8 | Un evento por respuesta según el tipo | Evita disparos dobles |
| D9 | `slug` único global | La URL pública no lleva workspace |
| D10 | Envío como `multipart` en un solo pedido (archivos incluidos), no subida previa con URL firmada | Sin archivos huérfanos de formularios que nunca se envían; 10 MB × 3 por campo es manejable |
| D11 | Idempotencia antes que Turnstile (el token es de un solo uso) y re-búsqueda ante `timeout-or-duplicate` | Un reintento legítimo no puede fallar por el captcha ya consumido |
| D12 | IP en claro solo en la firma del contrato | Evidencia legal; en el resto, hash |
| D13 | Link firmado por contacto con HMAC (60 días), secreto en Vault, sin tabla; lleva `contact_id` y, opcionales, `service_id` y `sale_id` **dentro de la firma**, nunca sueltos en la URL; los dos últimos se guardan sin validar contra tablas que todavía no existen | El alcance pide "identificador firmado"; CX necesita desempatar el servicio y Ventas atar el contrato a la venta |
| D14 | Respuesta sin contacto no dispara; al vincular a mano, casilla explícita | H3 y evitar mensajes tardíos no buscados |
| D15 | Historial de formularios y respuestas visible para Owner/Admin: **no se suma ninguna política sobre `audit_log`** | No hace falta en esta versión. Si después se quisiera para Members, va como política adicional y permisiva `audit_log_select_forms`, nunca reescribiendo `audit_log_select` |
| D16 | Categorías de encuesta: servicio, llamada, onboarding, cierre, general (en código) | El alcance da ejemplos; CX usa `servicio` |
| D17 | Topes: 20 envíos por IP por hora, 5 por IP y formulario por hora; 60 beacons por IP por hora; 1 vista y 1 inicio por sesión del navegador y formulario cada 24 h | Razonables para formularios de captación; se ajustan en `lib/forms/limits.ts` |
| D19 | **Sin tabla de contadores** (decisión de Wendy): vistas, inicios y rechazados en `analytics_events` (`contact_id` null, `metadata` sin datos personales), envíos y spam desde `form_submissions`, lectura por `form_metrics_daily` con índice parcial nuevo | Reusa una tabla existente que ya acepta tipos libres (H17); no ensucia el historial del contacto |
| D20 | Los rechazos por captcha y honeypot se registran como `form_rejected`; los cortados por tope por IP, no | Así no se guarda basura en `form_submissions` y un ataque no llena `analytics_events` |
| D18 | Reintentos del PDF con la misma escalera 5/15/30 | Un solo cálculo para los dos jobs |
| D21 (v1.1) | Las páginas del sitio son **código** en `app/(sitio)/`, armadas por Claude Code; no hay editor visual | Es lo que pidió Wendy ("páginas que cree en este mismo proyecto"); un constructor visual es un módulo entero (decisión 182) |
| D22 (v1.1) | Las páginas del sitio son **de cada clon**: `scripts/export-template.mjs` no las copia y pone la versión por defecto | El repo es también la plantilla white label: el home de Wendy no puede viajar a un cliente nuevo (decisión 183) |
| D23 (v1.1) | Prellenado configurable por campo (parámetros + comportamiento) en lugar de solo `?<key>=` | Pedido de Wendy; permite usar los nombres de parámetro que ya usan sus links y anuncios (decisión 184) |
| D24 (v1.1) | Una sola lista de claves de atribución (`lib/attribution/keys.ts`), superconjunto de la de la Agenda, sin tocar la de la Agenda | Pedido de Wendy ("UTMs y cualquier metadata, como fbclid"); tocar la de la Agenda cambiaría sus URLs de embed (decisión 185) |
| D25 (v1.1) | Atribución persistida 90 días en una cookie propia (sitio) o en `localStorage` del sitio que embebe; el envío usa la de la URL si trae algo, si no la última persistida | Sin persistencia, los UTM se pierden en cuanto la persona cambia de página (decisión 185) |
| D26 (v1.1) | Sin banner de cookies por ahora | Cookie propia, de medición y sin datos personales; a confirmar si hay tráfico europeo (decisión 186) |

**Decisiones del alcance "a confirmar" que tocan este módulo, tomadas con la recomendación cargada:** la **156** (sin email ni teléfono no se crea contacto) — **supuesto**: Wendy la confirma.

### Lo que no pude verificar (confirmar en la exploración de Claude Code)

1. **Lo que deja Llamadas:** que existen `audit_log.actor_type`/`actor_label`, `auditAsSystem({ ...args, label })`/`auditAsWebhook({ ...args, label })` en `lib/audit.ts` y `<Historial/>` **está confirmado** por la coordinación; falta solo confirmar las props exactas de `<Historial/>` y que la 00155 lea los dos tipos de Llamadas del CHECK vivo.
2. **Que `normalize_email` exista con ese nombre en `public`** (lo usa `find_or_link_contact`; se asume que sí).
3. **El trigger existente de `contact_tags`** que emite eventos de CRM: que siga emitiéndolos cuando la RPC inserta tags (se asume que sí, como cuando lo hace el flow).
4. **Que no exista un usuario de agenda `f`** (F10).
5. **El soporte de `idempotency_key` en `siteverify`** de Turnstile tal como se describe (documentación de Cloudflare; si no está, se omite el parámetro y se mantiene la re-búsqueda de D11).
6. **El límite de tamaño de adjuntos de Resend** para la cuenta (40 MB por email según su documentación; un contrato pesa < 1 MB).
7. **Si Railway limita el cuerpo de un pedido** a menos de 30 MB (envío con 3 archivos de 10 MB). Si limita, `maxFiles` baja a 1 por campo.
8. **Que `lib/scheduling/automation/linear-flow.ts` no tenga dependencias de agenda** además de los tipos de paso `booking_status`/`cancel_booking` (se leyó la primera mitad).
9. **Cómo `buildDesiredTriggers` copia `config` para tipos registrados** (`answer_conditions` anidado): se leyeron las primeras 80 líneas; la exploración confirma que pasa la config completa del nodo.

### Conflictos con las convenciones o con otros módulos

- **Con las convenciones:** tablas, triggers, permisos, rutas, banda y buckets son los de `convenciones.md`, **salvo `form_stats_daily`, que ya no se crea** (decisión de Wendy del 10/10, comunicada por la coordinación): las métricas usan `analytics_events`. La banda 00150–00157 queda ocupada completa.
- **Con Llamadas:** dependencia dura de `actor_type`, helpers y `<Historial>` (se usan, no se crean). La 00155 lee el CHECK de `triggers` **después** de que Llamadas haya sumado sus tipos.
- **Con Ventas:** Ventas (00162) suma la FK de `form_submissions.sale_id` y la de `contract_signatures.sale_id`. Ventas (00168) reescribe `submit_form_response`/`record_contract_signature` para validar el `sale_id` contra el contacto y sumarlo al payload de `form_submitted`/`contract_signed`. Ventas también extiende el CHECK de `triggers` después de este módulo: debe leerlo de la base (incluirá los tres de formularios).
- **Con CX:** CX (00172) suma la FK de `form_submissions.service_id` y la de `contract_signatures.service_id`. CX completa ítems escuchando el evento de respuesta; con D8 debe escuchar `form_submitted`, `survey_answered` **o** `contract_signed` según el tipo del ítem (no solo `form_submitted`). Conviene que el plano de CX lo nombre así.
- **Con el alcance §4.4 ("`find_or_link_contact` no se toca"):** se cumple; la divergencia es solo que **no se usa** (H1).
