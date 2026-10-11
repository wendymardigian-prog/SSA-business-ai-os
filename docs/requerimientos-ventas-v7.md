# Requerimientos: Etapa 5, Fase 1 — Ventas y pagos (sin integraciones)

**Proyecto:** SSA Business AI OS · **Paso:** 05-Requerimientos (brownfield) · **Versión** 1.1, 11 de octubre de 2026 (v1.1: ajustado al sistema real después de construir Llamadas y Formularios, ver §0.0) · **Anclado a:** alcance-v7.md (v7.2) · **Para:** Claude Code, bloque por bloque

**Qué es este documento:** la revisión **v7** del plano `requerimientos-ventas.md` v1.1 (27/9/2026), **recortada a la Fase 1** (Bloques B1 a B4, F1 a F38, más la nueva F26b). Es **autocontenido**: Claude Code lo usa solo, sin el plano viejo. Se conserva la numeración F1–F38 para que las referencias cruzadas de los demás documentos (CX, Gastos) sigan valiendo. La Fase 2 del plano viejo (B5–B11, F39–F73: webhooks, Whop, link de pago, conciliación, cobro automático) **está en pausa** y no se construye (§17).

**Qué cambió respecto de la v1.1** (resumen; el detalle está en cada F y en §20):

1. **Productos absorbe `content_offers`** (decisión 150): migración de riesgo alto que crea producto + variante "Estándar" + versión 1 **con el mismo id** de cada fila de `content_offers` y mueve las FK de `content_ideas.offer_id` y `content_posts.offer_id` a `products`. La pantalla actual `/dashboard/settings/productos` pasa a ser la del catálogo nuevo (F3, §1b).
2. **Rutas** bajo `/dashboard/settings/*` (no `/dashboard/configuracion/*`).
3. **Atribución por UTMs (decisión de Wendy, 10/10):** la venta guarda una **copia congelada del último toque** del contacto (`sales.attribution`, leída con `readAttribution` / `contact_touches`: source, medium, campaign, content, term, ad_id, fbclid…), editable a mano. **Salen** el catálogo de fuentes, las reglas de atribución, la fuente sugerida y todas las columnas `source_*` (fase futura, §17). Las reglas de **asignación** se quedan (setter, vendedor, referido) y sus condiciones leen los UTMs del primer y último toque canónicos (F10–F14).
4. **Triggers por cambio de estado** (decisión 160): seis tipos guardados (`sale_created`, `sale_status_changed`, `payment_created`, `payment_status_changed`, `payment_before_due`, `payment_after_due`); los atajos son **presets del editor** sobre esos tipos (F37, F38).
5. **Ya construido y verificado:** `scheduled_jobs.status` ya admite `'cancelled'` (se saca ese cambio); la Etapa 4 está construida (F24 va completo); `audit_log.actor_type`/`actor_label`, el índice, los helpers y `<Historial/>` los crea Llamadas (F34 se reduce a usarlos). La política de lectura del historial de ventas (F35) sí es de este documento: una política **adicional** `audit_log_select_sales`, sin tocar `audit_log_select`.
6. **No se crea nada de la Fase 2** (columnas de Whop, opciones de cobro, cobro automático, `payment_links`, `processor_payments`, `webhook_endpoints`, `inbound_webhooks`, CHECK de `integration_configs`). Se suman con migraciones aditivas cuando vuelva la Fase 2 (§17).
7. **Contrato atado a una venta** (nueva **F26b**, al final de B3).
8. **Permisos:** 3 claves (`sales.view`, `sales.manage`, `payments.manage`); se corrige el "10 claves" del F2 viejo.
9. **`payments.provider_fee_amount`** se guarda al cobrar y tiene índice `(workspace_id, payment_method, paid_at)` para Gastos.
10. **Tres correcciones técnicas** que salieron de verificar el sistema real (§3.2): el desfase no puede ser una columna generada que lea la zona del workspace; el backfill de permisos de roles de sistema del plano viejo no aplica (los permisos del Member viven en código); y la idempotencia de los triggers de agenda es por agenda, no por cambio, así que Ventas no la copia.

---

## 0. Cómo usar este documento

### 0.0 Estado real al 11/10/2026, después de Llamadas y Formularios (v1.1 — gana sobre el resto del documento)

Llamadas y Formularios ya están construidos. Esto es lo que dejaron y lo que cambia de este plano. Donde algo de abajo contradiga otra sección, **gana esta**.

**1. Migraciones: todas corren un número.** Formularios ocupó la `00158` con `00158_forms_once_key_fix`. Las 10 de este plano se renumeran así. La banda llega a la 00169, así que entran.

| En este plano | Número real | Qué es |
|---|---|---|
| 00158 | **00159** | Catálogo |
| 00159 | **00160** | Copia de `content_offers` (riesgo alto) |
| 00160 | **00161** | Reglas de asignación |
| 00161 | **00162** | `sales`, `payments` y funciones |
| 00162 | **00163** | FK de `sale_id` en `form_submissions` y `contract_signatures` |
| 00163 | **00164** | `submit_form_response` valida el `sale_id` (riesgo alto) |
| 00164 | **00165** | Bucket `payment-receipts` |
| 00165 | **00166** | CHECK de `triggers.type` |
| 00166 | **00167** | Cron que encola la revisión de mora |
| 00167 | **00168** | Política `audit_log_select_sales` |

Siempre que el texto nombre un número de la columna izquierda, se refiere al de la derecha. En el código, los docs y `CLAUDE.md` van los números reales (próxima libre al terminar: **00169**). Antes de escribir la primera, se confirma con la lista de migraciones aplicadas.

**2. Requisito: Formularios mergeado.** La rama `feat/formularios` (PR del módulo 2) tiene que estar mergeada a `main` antes de crear `feat/ventas-fase1`.

**3. Lo que el plano suponía de Formularios, verificado en el código:**
- `signFormLink(service, { workspaceId, formId, contactId, slug, baseUrl, serviceId?, saleId?, ttlDays? })` **ya acepta `saleId`**. No hace falta sumarlo (se descarta ese caso de §19).
- `submit_form_response` vigente es **la de la `00158`**, con 8 parámetros: `(p_form_id, p_version_id, p_idempotency_key, p_answers, p_attribution, p_meta, p_contact_hint default '{}', p_extra default '{}')`. El `sale_id` firmado llega en **`p_contact_hint ->> 'signed_sale_id'`**. La migración que valida el `sale_id` (00164 real) parte de **esa** definición, leída con `pg_get_functiondef`, y copia la anterior completa en su cabecera. Donde este plano dice "v3 → v4", léase "la vigente → la siguiente".
- `record_contract_signature(p_submission_id, p_signature_path, p_legal, p_signer_name default '', p_signer_email default null)`: copia `sale_id` y `service_id` de la respuesta. No cambia.
- **`contract_signatures` tiene un trigger `contract_signatures_protect`** que impide cambiar después de insertada la evidencia de la firma, incluido `sale_id`. Para este plano está bien (el `sale_id` se escribe al firmar). Pero la FK de la 00163 real **no puede** usar `ON DELETE SET NULL` sobre `contract_signatures.sale_id`, porque ese `UPDATE` lo rechazaría el trigger. Va sin acción (`NO ACTION`): una venta con firmas no se borra (igual nada se borra: se anula).
- Hoy hay **0** filas con `sale_id` en `form_submissions` y en `contract_signatures`: las FK se crean sin backfill.
- `find_contact_by_phone_or_email(p_workspace_id, p_phone, p_email)` existe (00156), con el criterio de `create_booking`: teléfono primero, después email.
- El alta rápida de producto desde Contenido es **`createProduct`** en `lib/actions/content-taxonomy.ts` (no `createOffer`). La asignación manual de setter y vendedor está en `lib/actions/contacts.ts`.
- `eventMatches` del registro puede ser `async` y recibe `args.supabase` (`TriggerEventArgs` en `lib/flow-engine/registry/types.ts`).
- `scripts/verify-audit-visibility.mjs` existe (de Llamadas) y se extiende para `audit_log_select_sales`.

**4. Atribución completa (del Bloque FO4 de Formularios).** Los toques ahora traen más datos: `ttclid`, `li_fat_id` y `ctwa_clid` en columnas, y en `contact_touches.raw` las claves de `lib/attribution/keys.ts` que no tienen columna (`utm_id`, `gbraid`, `wbraid`, `msclkid`, `twclid`, `sccid`, `epik`, `rdt_cid`, `placement`, `fbp`, `fbc`, `ga_client_id`, `page_url`). **La copia congelada de la venta las incluye** (F10 actualizado): así quedan los datos para una futura API de conversiones de Meta o Google sin volver a buscarlos.

**5. Patrones del repo que confirmaron las corridas anteriores** (para no volver a buscarlos):
- **Triggers:** un archivo por módulo en `lib/flow-engine/registry/` (copiar la forma de `call-triggers.ts` o `form-triggers.ts`) → `sale-triggers.ts`, con su test. El panel de triggers (`TriggerPanel`) es un array fijo: se suman las entradas y un bloque `SALE_TRIGGERS`, como hizo Formularios.
- **El drenaje de `automation_events` trata como evento de agenda cualquier payload que tenga `booking_id`**, y aplana el payload con `String(v)`. Por eso **los payloads de venta y pago no llevan la clave `booking_id`** (si hace falta, va como `sale_booking_id`) y solo llevan valores simples.
- **Jobs:** los handlers se registran en `registerPublishing()` (`lib/publishing/bootstrap.ts`), no en un `lib/jobs/handlers/index`.
- **Permisos del Member:** la lista escrita a mano está en `lib/auth/member-permissions-characterization.test.ts`; `MEMBER_KEYS` es interno. Se suman las 3 claves ahí, y `member-baseline.test.ts` suma solo páginas, acciones y nombre del menú.
- **Menú:** `NavItemMeta` exige `adminOnly`; los títulos salen de `PAGE_META`.
- **Interfaz:** SSA no tiene shadcn, Radix, sonner, dnd-kit ni date-fns: se usan `components/ui` y `lib/dates.ts`. Vitest solo corre `**/*.test.ts` en node, sin DOM: la lógica de pantallas va en funciones puras.
- **`flows` no tiene `deleted_at`.** No filtrar por esa columna: la base responde error 42703 y la lista sale vacía, que es el bug que encontró Formularios en la Agenda.
- **Variables:** `{{contact.first_name}}` y `{{contact.last_name}}` **no se resuelven** en ningún lado del motor. Las plantillas de cobranza usan `{{contact.display_name}}`.
- **Scripts:** `verify-rls`, `verify-roles`, `verify-audit-visibility` y `verify-workspace-isolation` se corren con los flags que dejaron las corridas anteriores (`--despues-de-00143`, `--despues-de-00136`, `--despues-de-00147`, y los que haya sumado Formularios).
  - `verify-attribution.mjs` ya falla en un caso de datos viejos ("todos los contactos reales tienen first_touch"): está anotado y no puede empeorar.
  - `verify-knowledge` y `verify-webhook` no se corren (llaman a Voyage de verdad o necesitan la app corriendo).

Son **4 bloques** y **39 funcionalidades** (F1 a F38 + F26b). Se construyen en orden: B1 → B2 → B3 → B4.

### 0.1 Requisitos previos (no arrancar sin esto)

1. **Llamadas y Formularios construidos y mergeados a `main`** (orden 1 y 2 de la v7). En particular, de Llamadas: `audit_log.actor_type` (CHECK `user|agent|system|webhook`, default `'user'`), `audit_log.actor_label`, el índice `(workspace_id, entity_type, entity_id, performed_at desc)`, los helpers `auditAsSystem({ ...args, label })` y `auditAsWebhook({ ...args, label })` en `lib/audit.ts` (reciben un objeto) y el componente `<Historial entityType entityId />`. De Formularios: tablas `forms`, `form_versions`, `form_submissions`, `contract_signatures` (con la columna **`sale_id uuid` reservada, nullable**, sin FK todavía), el link prellenado con identificador firmado y el bucket `contracts`.
2. **Etapa 4 (Agenda v2) construida** (lo está): `bookings`, `lib/scheduling/automation/*`, `lib/jobs/handlers/booking-relative.ts`.
3. Hay un **respaldo del día** de la base de Supabase (lo exige la migración de riesgo alto 00159).
4. El plano se guarda sin cambios en `docs/requerimientos-ventas-v7.md`.
5. Rama **`feat/ventas-fase1`**, creada desde `main` actualizado.
6. **Código de referencia** (propio, sin obligación de licencia): el módulo de ventas de prevxcrm en `/home/claude/prevxcrm` (`src/lib/sales-constants.ts`, `sale-payments.ts`, `sale-status-updater.ts`, `sales-team-rules.ts`, `source-attribution-fields.ts`, `supabase/functions/run-assignment-rules`, `check-overdue-payments`) y el de xcelerator-crm (`/home/claude/xcelerator-crm-90793ebd`). Se leen para entender la lógica; **se adapta al modelo de SSA** (workspace en vez de company, `audit_log` en vez de `activity_log`, permisos de SSA, solo USD, atribución canónica). Los bugs conocidos de prevxcrm (`Number(x)` sin fallback, cálculos inline, estado escrito a mano) **no se copian**.

### 0.2 Reglas de la corrida (se suman a las del `CLAUDE.md`)

- **Exploración primero.** Antes de escribir código, Claude Code confirma los supuestos de §21 contra el repo y la base, y si algo no coincide lo dice en el plan. Gana el código real.
- **Migraciones:** banda **00158–00169**. Antes de la primera, `list_migrations`; si la banda está ocupada, se corre entera al primer número libre, **en orden y sin saltear**. Todas idempotentes (`IF NOT EXISTS`, `DO $$…$$`), funciones con `SET search_path = ''`, RLS en toda tabla nueva. Después de cada una: `node scripts/build-all-migrations.mjs`. Se aplican con `supabase db query --linked -f <archivo>` y se registran en `supabase_migrations.schema_migrations`.
- **Las aprobadas en §1b se aplican sin volver a preguntar.** La única que **no** se aplica es el **borrado diferido de `content_offers`**: se escribe en `docs/pendientes/drop_content_offers.sql` (**fuera de `supabase/migrations/`**, sin número, para que `build-all-migrations.mjs` no la incluya ni rompa el orden), se anota en `docs/PENDIENTE.md` y espera la regla de borrado del `CLAUDE.md`; al aplicarse toma el número libre siguiente.
- **La plata se piensa en céntimos.** Ninguna decisión de saldo, cuadre o mora se toma con punto flotante: se compara en enteros (`Math.round(x * 100)`). Toda conversión desde la base usa `Number(x) || 0` (nunca `Number(x)` pelado).
- **Funciones puras** para toda la lógica de montos, saldos, mora, cuadre, atribución, asignación, estado, triggers y lo que muestra cada pantalla. Los componentes solo componen.
- **Tests y commits:** después de cada funcionalidad, `npx vitest run`. Después de cada bloque, marcar `docs/PROGRESS.md` y commit `feat: ventas fase 1 - bloque N (nombre)`.
- **Revisión visual** (no forma parte de "listo"): al cerrar cada bloque con pantallas, recorrerlas con el navegador de Claude Code en escritorio y en 390 px. Si no hay sesión iniciada, anotarlo en `docs/PENDIENTE.md`.
- **Bloqueos:** después de un intento serio, anotar en `docs/PENDIENTE.md` y seguir (§19).
- **Scripts de verificación:** uno solo nuevo, `scripts/verify-sales.mjs` (contra la base real, usuarios reales Owner y Member, prefijo `zz-test-`, limpia lo suyo, no se corre a la vez que otro `verify-*`). Se extiende bloque a bloque.

---

## 1. Mapa de ruta

| Orden v7 | Etapa / Fase | Estado | Qué tiene |
|---|---|---|---|
| — | Etapas 1, 2 y 4 | Construidas | CRM, bandeja, flows, contenido, roles, integraciones, Agenda v2 |
| 1 | Etapa 3 > Fase 2: Llamadas | Prerrequisito | Fathom, analizador, **`audit_log.actor_type` + `<Historial/>`** |
| 2 | Extra C: Formularios | Prerrequisito | Formularios, encuesta, **contrato con firma (`contract_signatures.sale_id` reservado)** |
| **3** | **Etapa 5 > Fase 1: Ventas y pagos** | **Este documento** | Catálogo (absorbe `content_offers`), atribución por UTMs, asignación automática, alta de venta, pagos, mora, historial, triggers por estado, contrato desde la venta |
| 4 | Etapa 6 > Fase 1: CX | Después | Servicio que nace del pago; usa `sales`, `payments`, `product_variants`, `sales.service_starts_at` |
| 5 | Extra I (parte): Gastos | Después | Suma `payments.provider_fee_amount` por método y mes |
| Después | Etapa 5 > Fase 2 (webhooks, Whop, conciliación, cobro automático) | **En pausa** | §17 |

**Lo que NO se construye ahora pero el diseño contempla** (para no romperlo):
- **CX (orden 4):** `sales.service_starts_at` existe desde ya (reservada, sin uso en esta fase salvo editarla en la ficha). CX suma sus propias columnas en `product_variants` y su pestaña "Servicio" en la variante; por eso el detalle de la variante se arma **con pestañas** desde el principio (hoy solo "Precio"). Los eventos `payment_status_changed` y `sale_status_changed` (con `from_status`/`to_status`) son los que CX va a escuchar. **No se agrega nada de CX acá.**
- **Gastos (orden 5):** lee `payments.provider_fee_amount`, `payment_method` y `paid_at`. El índice existe desde la 00161.
- **Fase 2 de Ventas:** todo lo de Whop, link de pago, conciliación y cobro automático se suma después con **migraciones aditivas** (columnas nullable nuevas, tablas nuevas, ampliar CHECKs). Nada de esta fase las bloquea: los métodos de pago ya incluyen la clave `whop` (como método manual) y el estado de la venta ya contempla `disputed` y `subscription_cancelled`.
- **Comisiones y pipeline:** la venta guarda setter, vendedor, atribución (UTMs del toque), montos y fechas de cobro; las columnas `opportunity_stage` y `stage_entered_at` se crean reservadas sin uso.
- **Multimoneda:** columnas `currency` con CHECK `= 'USD'`; relajarlo es aditivo.
- **Afiliados:** `contacts.referred_by_user_id` / `referred_by_contact_id` quedan listos.

---

## 1b. Cambios en la base de datos y riesgos

**Esta es la sección que se aprueba antes de construir.** *(v1.1: los números reales son 00159–00168, ver la tabla de §0.0.)* Son **10 migraciones numeradas (00158–00167)**, todas se aplican durante la construcción, **más 1 de borrado diferido** (`docs/pendientes/drop_content_offers.sql`) que se escribe y **no** se aplica. Las de riesgo alto son la 00159, la 00163 y el borrado diferido (IRREVERSIBLE).

| N° | Qué hace, en una línea | Tipo | Riesgo | Reversible | Bloque |
|---|---|---|---|---|---|
| 00158 | Tablas `products`, `product_variants`, `product_versions` + RLS + `publish_product_version()` + `workspaces.enabled_payment_methods` | Aditiva | Bajo | Sí (drop de lo nuevo) | B1 |
| 00159 | **Copia las 3 filas de `content_offers` a producto + variante "Estándar" + versión 1 con el mismo id, deja un puente que copia lo que se cree en `content_offers` mientras conviva, y cambia las FK `content_ideas.offer_id` y `content_posts.offer_id` para que apunten a `products`** | **Modifica estructura existente + modifica datos existentes** | **Alto** | Sí, con el script de vuelta de esta sección | B1 |
| 00160 | `assignment_rules` (kinds setter, vendedor, referido) + precarga por workspace; columnas nuevas en `contacts` (`referred_by_*`, `assignment_locked_at`, `payment_health`) y `workspaces` (tope de descuento, gracia de mora, flujos precreados); **trigger nuevo en `contacts`** que encola la evaluación de asignación | Aditiva (con backfill de datos nuevos y un trigger nuevo sobre una tabla en uso) | Medio | Sí (drop) | B2 |
| 00161 | `sales` (con `attribution jsonb` congelada, `attribution_touch_id` → `contact_touches`, `attribution_type` e índices de expresión por `source`/`campaign`), `payments`, `can_see_sale()`, `create_sale()`, `derive_sale_status()`, `refresh_sale_status()`, triggers de estado y de eventos, índices (incluido el de Gastos) e índice de `scheduled_jobs` por `payment_id` | Aditiva | Medio | Sí (drop) | B3 |
| 00162 | FK de `form_submissions.sale_id` y de `contract_signatures.sale_id` (columnas reservadas por Formularios) a `sales` (**v1.1:** `ON DELETE SET NULL` en `form_submissions`; **sin acción** en `contract_signatures`, por su trigger de protección, ver §0.0) + índices parciales | Modifica estructura existente (suma dos FK sobre columnas que deberían estar vacías; aborta si hay huérfanos) | Bajo | Sí (drop constraint) | B3 |
| 00163 | **Reescribe `submit_form_response` (v3 de Formularios → v4)** para validar el `sale_id` firmado (la venta existe y es del mismo contacto; si no, se descarta) y sumar `sale_id` al payload de `form_submitted`, `survey_answered` y `contract_signed`. `record_contract_signature` no cambia (copia el `sale_id` ya validado de la respuesta) | **Modifica lógica existente** (función de otro módulo, en uso por la página pública) | **Alto** | Sí, con la definición vigente (v3) copiada completa en la cabecera | B3 |
| 00164 | Bucket privado `payment-receipts` + políticas de Storage | Aditiva | Bajo | Sí | B4 |
| 00165 | CHECK de `triggers.type` suma los 6 tipos de Ventas (DROP + ADD con la lista completa leída de la base) | Modifica estructura existente | Medio | Sí (volver a la lista anterior) | B4 |
| 00166 | Función `private.enqueue_payments_overdue_sweep()` + pg_cron `payments-overdue-enqueue` cada hora que la llama (encola en `scheduled_jobs`; **no** usa `call_app_cron`) | Aditiva | Bajo | Sí (`cron.unschedule` + drop de la función) | B4 |
| 00167 | **Política nueva y adicional `audit_log_select_sales`** (permisiva, FOR SELECT) sobre `audit_log` para `sale`, `payment` y el catálogo. `audit_log_select` **no se toca** | Aditiva (suma una policy; solo amplía lectura) | Medio | Sí (`DROP POLICY audit_log_select_sales`) | B4 |
| *(sin número)* `docs/pendientes/drop_content_offers.sql` | `DROP TABLE content_offers` (y su puente) | **Borra (diferida)** | **Alto** | **IRREVERSIBLE** salvo restaurando el respaldo | **No se aplica en esta corrida** |

### Qué se aprueba (las de riesgo alto)

- **00159 — Productos absorbe `content_offers`.** Hoy "Productos" es la tabla `content_offers` (3 filas: *Scaling Systems Academy* USD 3.000, *Scaling Systems B2B* USD 6.000 y *BusinessXcelerator* USD 12.000, todas activas; las usan 1 idea y 1 pieza de Contenido). El catálogo de Ventas la reemplaza para que no haya dos pantallas "Productos". Cada fila pasa a ser un producto **con el mismo id**, con una variante "Estándar" y su versión 1 activa con el precio que tenía. Como el id no cambia, las ideas y piezas siguen apuntando a su producto sin reescribir nada: lo único que cambia es a qué tabla apunta la FK.
- **00163 — Validar la venta en los contratos firmados.** Formularios guarda el `sale_id` del link firmado **sin validarlo** (cuando se construyó, `sales` no existía) y no lo manda en el evento. Esta migración reescribe su función de envío (`submit_form_response`) para que el `sale_id` solo se guarde si la venta existe, es del mismo workspace y **del mismo contacto** que firma (si no, se descarta y la firma se guarda igual), y para que `form_submitted`, `survey_answered` y `contract_signed` lleven el `sale_id`. Es de riesgo alto porque toca la función que usa la página pública de todos los formularios: se parte de la definición vigente, se copia completa en la cabecera, y los tests de Formularios tienen que seguir en verde.
- **00167 (riesgo medio, se nombra porque toca seguridad) — Historial de ventas visible para el vendedor.** Hoy un Member solo ve en el historial lo que hizo él (más lo de agentes sobre contactos y conversaciones, y lo de agendas). Lo que escribe el sistema (el job de mora) tiene `performed_by = null`: con la política actual, el vendedor no vería el historial de su propia venta. Siguiendo la convención que fija Llamadas, se suma una **política adicional** `audit_log_select_sales` (las políticas permisivas se combinan con OR): `audit_log_select` queda **intacta**, y la nueva solo suma lectura para las entidades de este módulo.
- **Borrado diferido de `content_offers`.** Se escribe ahora y se aplica **después**, cuando el código que ya no la lee esté desplegado y comprobado (§1b.5).

### Orden contra el deploy

- **00158, 00160, 00161, 00164, 00166** (y la 00167, que solo suma una política, pero después de su test) son aditivas: el código viejo sigue andando. Se pueden aplicar por adelantado.
- **00159 se aplica justo antes de desplegar el código de B1** (en la misma ventana). Por qué: después de la 00159, una pieza de Contenido solo puede apuntar a un id que exista en `products`. El **puente** (un trigger en `content_offers` que copia a `products` cada alta o cambio) hace que el código viejo siga funcionando si alguien crea un producto desde la pantalla vieja entre la migración y el deploy. Sin el puente, esa ventana rompería la clasificación de Contenido.
- **00162** después de la 00161 (necesita `sales`). Si Formularios no dejó alguna de las columnas `sale_id`, la 00162 la crea (nullable) y se anota la divergencia.
- **00163** se aplica **junto con el deploy del código de F26b** (es compatible hacia atrás: la firma de la función no cambia, solo valida y suma un campo al payload; el código viejo de Formularios sigue funcionando). Antes de aplicarla se relee la definición vigente de `submit_form_response` en la base (`pg_get_functiondef`) y se parte **de esa**, no del plano de Formularios.
- **00165** antes de desplegar el código de F37 (si el código registra un trigger de tipo nuevo y la base no lo admite, guardar el flujo falla).
- **00167** se aplica **solo después** de correr el test de caracterización de F35 (`verify-audit-visibility.mjs` de Llamadas, extendido) y de que dé lo mismo antes y después para los `entity_type` existentes.
- **El borrado diferido (`docs/pendientes/drop_content_offers.sql`) NO se aplica en esta corrida.**

### Qué pasa con los datos que ya existen

| Tabla | Qué les pasa |
|---|---|
| `content_offers` (3 filas) | **No se tocan.** Se copian. La tabla queda sin uso (el código ya no la lee) hasta el borrado diferido |
| `content_ideas` (1 con `offer_id`), `content_posts` (1 con `offer_id`) | Los valores **no cambian** (mismo id). Solo la FK pasa a apuntar a `products(id) ON DELETE SET NULL` |
| `products` / `product_variants` / `product_versions` | Nacen con 3 / 3 / 3 filas (las de `content_offers`). Cada producto **copia tal cual** el `status` (`active`, `inactive` o `discontinued`) y el `archived_at` de su fila de `content_offers` (hoy las 3 son `active`; la coherencia `(status = 'active') = (archived_at IS NULL)` ya la garantizaba el CHECK de la 00134). Un `price_usd` NULL → versión 1 en **borrador** con precio 0 y nota "Migrado sin precio: cargá el precio y publicá" (hoy no hay ninguno) |
| `contacts` | 4 columnas nuevas, nullable o con default (`payment_health '{}'`). Ninguna fila cambia de valor; `contacts.attribution` y `contact_touches` **no se tocan** (la venta solo los lee) |
| `workspaces` | 4 columnas nuevas con default (`overdue_grace_days 0`, `sales_auto_create_flows true`, `enabled_payment_methods` = las 5 claves, `max_discount_percent null`). Ninguna fila cambia de valor |
| `assignment_rules` | Precarga: 3 reglas (`setter`, `vendedor`, `referral`) en modo `manual` por workspace (no asignan nada hasta que alguien las configure) |
| `triggers` | Ninguna fila cambia. Solo se amplía la lista del CHECK |
| `audit_log` | Ninguna fila cambia. Solo se amplía quién puede leer qué (más lectura, nunca menos) |
| `form_submissions`, `contract_signatures` | Sus `sale_id` deberían estar vacíos (antes de Ventas no se podía firmar un link con una venta). La 00162 cuenta los no nulos que no existen en `sales`: si hay alguno, **aborta** con `RAISE EXCEPTION` y el conteo (no borra nada); se revisa a mano y se anota |
| Respuestas y firmas existentes | La 00163 no toca filas: solo cambia lo que hace la función de ahí en adelante |

### Cómo se verifica después de aplicar

| Migración | Verificación |
|---|---|
| 00158 | `node scripts/verify-sales.mjs --block 1` (RLS del catálogo con Owner y Member, índice de versión activa única, `publish_product_version` transaccional) y `node scripts/verify-rls.mjs` en 0 |
| 00159 | **Consulta de control** (en la cabecera de la migración): `SELECT count(*) FROM content_offers o LEFT JOIN products p ON p.id = o.id WHERE p.id IS NULL OR p.status <> o.status OR p.archived_at IS DISTINCT FROM o.archived_at OR p.name <> o.name` → **0** (todas copiadas, con el mismo estado); `SELECT count(*) FROM product_versions WHERE status='active'` = cantidad de offers con precio; las FK de `content_ideas`/`content_posts` apuntan a `products` (`pg_constraint`). Después: `node scripts/verify-content.mjs` y `node scripts/verify-rls.mjs` en 0 (los dos tocan productos hoy y se actualizan en F3), y `verify-sales.mjs --block 1` comprueba que el puente copia un alta nueva |
| 00160 | `verify-sales.mjs --block 2` (3 reglas por workspace, RLS, el trigger encola un job al cambiar la atribución, un contacto se sigue creando aunque el trigger falle) y `node scripts/verify-crm.mjs` + `verify-attribution.mjs` en 0 |
| 00161 | `verify-sales.mjs --block 3` (atomicidad de `create_sale`, copia congelada de la atribución —un toque nuevo después no la cambia— y `attribution_type 'none'` sin toques, visibilidad por `can_see_sale`, DELETE bloqueado, paridad de `derive_sale_status`) |
| 00162 | `verify-sales.mjs --block 3` (un `sale_id` inexistente en `form_submissions` o `contract_signatures` falla por la FK) |
| 00163 | `verify-sales.mjs --block 3`: envío real de un contrato con link firmado → la venta del mismo contacto queda en `form_submissions.sale_id` y `contract_signatures.sale_id`, y `automation_events` de `contract_signed` trae `sale_id`; con un `sale_id` de otro contacto, la firma se guarda con `sale_id` null. Además, los tests y el `verify-forms.mjs` de Formularios siguen en 0 |
| 00164 | `verify-sales.mjs --block 4` (12 MB rechazado, `.exe` rechazado, Member sin acceso a la venta no obtiene URL firmada) |
| 00165 | `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='triggers_type_check'` contiene **todos** los valores previos + los 6 nuevos; `npx vitest run lib/flow-engine` en verde |
| 00166 | `SELECT jobname, schedule, command FROM cron.job WHERE jobname='payments-overdue-enqueue'` devuelve una fila con `select private.enqueue_payments_overdue_sweep()`; llamarla dos veces en el mismo día local deja **un** job `payments_overdue_sweep` pendiente por workspace (y ninguno antes de las 03:00 locales); `lib/cron-config.test.ts` sigue **intacto** y en verde |
| 00167 | `node scripts/verify-audit-visibility.mjs` (el de Llamadas, extendido con ventas) antes y después da el **mismo** resultado para todos los `entity_type` existentes, y el Member vendedor ve el historial de su venta |

### Cómo se vuelve atrás

- **00159** (script en la cabecera de la migración, comentado):
  1. `ALTER TABLE content_ideas DROP CONSTRAINT content_ideas_offer_id_fkey;` y lo mismo en `content_posts`.
  2. Copiar a `content_offers` los productos creados después de la 00159 que estén referenciados por ideas o piezas (`INSERT … SELECT id, workspace_id, name, … FROM products WHERE id IN (SELECT offer_id …) ON CONFLICT (id) DO NOTHING`, con `price_usd` = precio de la versión activa y `status`/`archived_at` copiados de `products`).
  3. Volver a crear las dos FK a `content_offers(id) ON DELETE SET NULL`.
  4. Desplegar el código anterior (la pantalla vieja). Las tablas nuevas pueden quedar: nadie las lee.
  Mientras el borrado diferido no se aplique, `content_offers` conserva sus filas originales intactas, así que la vuelta atrás no pierde nada de lo que existía antes.
- **00163:** `CREATE OR REPLACE FUNCTION public.submit_form_response(...)` con la definición v3 copiada en la cabecera (la que estaba en la base al escribirla). Las respuestas guardadas mientras estuvo la v4 quedan como están (con `sale_id` validado).
- **00167:** `DROP POLICY IF EXISTS audit_log_select_sales ON public.audit_log;` (la política original nunca se tocó).
- **Borrado diferido:** **IRREVERSIBLE.** Antes de aplicarla (fuera de esta corrida) se guarda `docs/ventas/respaldo-content-offers.json` con todas las filas de `content_offers`; restaurar es recrear la tabla con la 00116 + 00134 y reinsertar el respaldo.
- **Las aditivas:** `DROP` de lo creado, en orden inverso (00166 → `cron.unschedule('payments-overdue-enqueue')` + `DROP FUNCTION private.enqueue_payments_overdue_sweep()`; 00165 → CHECK con la lista anterior, guardada en la cabecera).

### 1b.5 La migración que borra (diferida, fuera de `supabase/migrations/`)

`docs/pendientes/drop_content_offers.sql`: se guarda **fuera de `supabase/migrations/`** (no lleva número hasta aplicarse; cuando llegue el momento, se mueve a `supabase/migrations/` con el **número libre siguiente** según `list_migrations`). Aborta con `RAISE EXCEPTION` si alguna FK todavía apunta a `content_offers`, o si existe alguna fila de `content_offers` sin su `products` con el mismo id; después borra el trigger puente y la tabla. **Se aplica solo cuando:** (1) el código de B1 está desplegado y comprobado en el servicio; (2) `grep -rn "content_offers" app lib scripts` no encuentra lecturas (solo comentarios y la migración); (3) corrieron las consultas de seguridad de su cabecera; (4) está el respaldo. Queda anotada en `docs/PENDIENTE.md` con esos cuatro pasos.

---

## 2. Objetivo y mapa de bloques

**Objetivo:** que el equipo cargue ventas en tres pasos con el producto y el precio correctos, que el plan de pagos cuadre siempre con el total, que la mora aparezca sola, que se vea el desfase entre lo prometido y lo pagado, que cada venta quede **atribuida a los UTMs del último toque** del lead (sin bloquear si no hay), que las asignaciones se resuelvan solas, y que **cada cambio de estado de una venta o un pago dispare automatizaciones** sin código.

**Por qué en este orden:**
1. Sin catálogo no hay qué vender (B1). Y es el bloque que absorbe `content_offers`, así que conviene hacerlo primero y aislado.
2. La atribución (UTMs) y las reglas de asignación preparan lo que la venta toma del contacto (B2).
3. Con eso, la venta se carga a mano con su plan de pagos (B3).
4. Pagos, mora, historial y triggers cierran la fase (B4).

| Bloque | Qué se construye | Contexto compartido | Funcionalidades | Migraciones |
|---|---|---|---|---|
| **B1** Catálogo | Tablas del catálogo, absorción de `content_offers`, permisos, productos, variantes, versiones, historial de precios, métodos de pago en código, navegación | `products`, `product_variants`, `product_versions`, `content_ideas`, `content_posts`, `lib/sales/payment-methods.ts`, `lib/auth/permissions.ts` | F1 a F8 | 00158, 00159 |
| **B2** Atribución y asignación | Atribución de la venta por UTMs (funciones y componente), línea de atribución en el contacto, reglas de asignación, motor, probador y simulación | `assignment_rules`, `contacts`, `contact_touches`, `readAttribution`, `lib/contacts/taxonomy.ts` | F9 a F16 | 00160 |
| **B3** Ventas | Tablas de ventas y pagos, asistente de 3 pasos, cuadre, creación transaccional, estado derivado, vínculo con agenda, listado, ficha, editar, cancelar, **enviar contrato** | `sales`, `payments`, contactos, catálogo, `contact_touches`, `bookings`, `contract_signatures` | F17 a F26, F26b | 00161, 00162, 00163 |
| **B4** Pagos, mora e historial | Reglas de pagos y comprobantes, plan en la ficha, cobrar, mora, desfase, reprogramar, incobrable, reembolso, pantalla de pagos, historial, actividad, triggers y flujos de cobranza | `payments`, `scheduled_jobs`, `audit_log`, `automation_events`, flow registry | F27 a F38 | 00164 a 00167 |
| Testing | Recorrido completo, `verify-sales.mjs` entero, revisión visual | — | — | — |

---
## 3. Estado actual del sistema (as-is, verificado el 10/10/2026)

Verificado contra el repo (`main` en `f70e520`) y la base de SSA BAIOS (solo lectura). Claude Code lo reconfirma en la exploración; si algo cambió (por Llamadas o Formularios, que se construyen antes), lo informa en el plan.

### 3.1 Stack y patrones (no cambian)

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + Zod + `@supabase/ssr`. **Tests:** Vitest `^3.2.4` (`npm test` = `vitest run`, `vitest.setup.ts` bloquea `fetch` real). `npm run build` = `build-embed` + `next build`. `npm run lint` = `eslint .`.
- **Scripts de verificación existentes:** `scripts/verify-*.mjs` (`verify-rls`, `verify-content`, `verify-crm`, `verify-attribution`, `verify-roles`, `verify-scheduling`, `verify-booking-concurrency`, entre otros) y `scripts/test-cleanup.mjs`. **No existe** `verify-sales.mjs` (se crea en F1).
- **Mutaciones:** Server Actions en `lib/actions/*`, con `requirePermission` (`lib/auth/guards`). Archivos `"use server"`: todo lo exportado es `async` (test en `lib/vault-boundary.test.ts`).
- **Cola de trabajos:** `scheduled_jobs` (`status` CHECK `pending|processing|completed|failed|cancelled` — **`cancelled` ya existe**), procesada por `/api/cron/jobs` cada minuto con registro de handlers en `lib/jobs/registry.ts` y `lib/jobs/handlers/*`. Índice único de `dedupe_key` **solo entre los `pending`** (`uq_scheduled_jobs_dedupe_pending`). Ya hay un índice por `payload->>'booking_id'` para cancelar los relativos de agenda.
- **Crons:** `pg_cron` llama a `private.call_app_cron('<nombre>')` → `app/api/cron/<nombre>/route.ts`, **con una lista blanca fija de rutas** (`jobs`, `sequences`, `whatsapp-health`, `inactivity`, `automation-events`, `agent-bursts`, `drafts-refresh`, `bg-dispatch`, `bg-collect`, `social-token-refresh`, `content-media-cleanup`, `metrics-sync`, `content-upload`): una ruta nueva se rechaza con `RAISE EXCEPTION`. Por eso los módulos nuevos **no** suman rutas de cron: un pg_cron llama a una función SQL que **encola** en `scheduled_jobs`, y el cron `jobs` existente lo procesa con un handler registrado. Purgas existentes: `trigger_fires` a 90 días, `automation_events` a 7 días.
- **Automatizaciones:** `automation_events` (sin CHECK de `event_type`) drenada por `/api/cron/automation-events` cada minuto. Por cada evento busca los triggers activos de flujos publicados cuyo tipo atienda ese evento (`triggerTypesForEvent`, del registro), llama a `eventMatches` y reclama el disparo en `trigger_fires` (único `(trigger_id, dedupe_key)`; si `dedupeKeyFor` no existe, la clave es `event:<id>`). Sumar un tipo = declararlo en `lib/flow-engine/registry/*-triggers.ts` + ampliar el CHECK de `triggers.type`. Documentado en `docs/flow-registry.md`.
- **Triggers de agenda (patrón a copiar):** `lib/flow-engine/registry/booking-triggers.ts` + reglas puras en `lib/scheduling/automation/triggers.ts` (`booking_status_changed` filtra por `config.to_status[]` y `config.from_status[]` sobre el payload). Los relativos se agendan con `lib/scheduling/automation/relative.ts` y los ejecuta `lib/jobs/handlers/booking-relative.ts`.
- **Contactos:** `find_or_link_contact` deduplica los que entran **por un canal** (exige `channel_id`): no sirve para un alta manual. Para el alta manual se usa `find_contact_by_phone_or_email(p_workspace_id, p_phone, p_email)`, que crea **Formularios**: busca por **teléfono primero** y después por email (igual que `create_booking`), devuelve `jsonb {contact_id, matched_by, conflict_contact_id}` y **no crea**: si `contact_id` es null, el alta la hace quien llama. Triggers existentes en `contacts`: `contacts_automation_created` (emite `contact_created`), `contacts_automation_changes` (emite `assignment_changed` al cambiar `setter_id`/`vendedor_id` y `do_not_contact`), `contacts_automation_deanonymized`, `set_updated_at`. **No hay ningún evento cuando cambia la atribución.**
- **Atribución:** `contact_touches` + `record_contact_touch` (vía `recordTouch`, `lib/contacts/touch.ts`) recalculan `contacts.attribution` = `{version: 2, first_touch, last_touch}`. `readAttribution` (`lib/contacts/attribution.ts`) lee las formas viejas y devuelve la canónica: cada toque tiene `source`, `medium`, `campaign`, `content`, `term`, `social_post_id`, `content_post_id`, `ad_id`, `adset_id`, `campaign_id`, `fbclid`, `gclid`, `ttclid`, `li_fat_id`, `ctwa_clid`, `referrer_url`, `landing_page`, `origin`, `occurred_at`. Taxonomía cerrada en `lib/contacts/taxonomy.ts` (`SOURCES`: instagram, tiktok, youtube, linkedin, threads, whatsapp, email, google, web, referral, direct, manual, csv; `MEDIUMS`: dm, comment, story_reply, mention, link_in_bio, paid_social, organic_social, email, form, booking, qr, import).
- **Auditoría:** `lib/audit.ts` (`logAudit`, `diffFields`) → `audit_log`. Al construir esta fase, Llamadas ya sumó `actor_type`, `actor_label`, el índice por entidad, `auditAsSystem({ ...args, label })`, `auditAsWebhook({ ...args, label })` y `<Historial/>`.
- **Zona horaria:** `workspaces.timezone`, **default `'UTC'` desde la 00122** (el plano viejo decía Costa Rica). En la base hay 6 workspaces: 5 en UTC y 1 en `America/Costa_Rica`. Toda fecha "del día" se calcula en la zona del workspace.
- **Navegación:** `lib/nav/items.ts` (grupo `ventas` con Contactos y Agenda). Pestañas de Ajustes en `lib/settings/tabs.ts` (General, Equipo, Campos personalizados, Recursos, **Productos**, Integraciones). Secciones de General en `lib/settings/general-sections.ts`. Caracterización de permisos de Ajustes en `lib/settings/permissions-characterization.test.ts` (incluye `productos: settings.manage`).

### 3.2 Hallazgos que cambian el plano viejo

| Hallazgo | Qué se verificó | Consecuencia |
|---|---|---|
| **Los permisos del Member viven en código, no en la base** | `workspace_roles.permissions` es un jsonb `{keys, scopes}`; las filas de los roles de sistema tienen `keys: []` y `scopes: {leads, conversations}`. `has_permission()` devuelve `true` para owner/admin y, para el resto, mira `permissions.keys` — **para el Member de sistema devuelve `false` siempre** (su fuente es `SYSTEM_ROLE_PERMISSIONS` en `lib/auth/permissions.ts`). `permission_scope()` devuelve `all` para owner/admin y `scopes.<módulo>` o `'own'` para el resto | **El backfill de roles del F2 viejo no aplica**: no hay nada que escribir en la base. Las claves se suman en código. La RLS de ventas copia el patrón de `can_see_booking` (admin, o es setter/vendedor, o `sales.view` + alcance `all`), que no depende de `has_permission` para el caso "lo mío". Las escrituras pasan por funciones SQL **solo para `service_role`**, llamadas desde Server Actions que ya hicieron `requirePermission` (que sí conoce al Member) |
| **No existe la columna `workspace_roles.scopes`** | El alcance vive dentro de `permissions.scopes` | `SCOPED_MODULES` suma `sales`; un rol personalizado sin `scopes.sales` queda en `own` (lo más angosto) |
| **El desfase no puede ser una columna generada que lea la zona** | Una columna `GENERATED` no puede consultar otra tabla (`workspaces.timezone`) | `payments` guarda **`paid_on date`** (la fecha local del cobro, escrita junto con `paid_at`) y `delay_days` es `GENERATED ALWAYS AS (paid_on - original_due_date) STORED` |
| **La idempotencia de `booking_status_changed` es por agenda, no por cambio** | `bookingDedupeKey` devuelve `booking_status_changed:<booking_id>` para los no relativos: una agenda dispara ese trigger una sola vez en su vida | Ventas **no copia** esa clave. La clave de los triggers de estado es **por cambio** (`change_id`, F37) |
| **`audit_log_select` ya tiene una rama de agendas** | Ramas: admin; lo propio; agente sobre contacto o conversación; **miembro sobre `booking` visible** | La 00167 **no la reescribe**: suma la política adicional `audit_log_select_sales` (convención fijada por Llamadas: una política permisiva por módulo) |
| **`private.call_app_cron` tiene lista blanca de rutas** | `IF p_path NOT IN (…13 rutas…) THEN RAISE EXCEPTION` | La mora no suma una ruta de cron: pg_cron → `private.enqueue_payments_overdue_sweep()` → `scheduled_jobs` → handler en el cron `jobs` |
| **`content_offers` tiene nombre único y estado** | Índice `uq_content_offers_name (workspace_id, lower(btrim(name))) WHERE archived_at IS NULL`; CHECK `status IN (active, inactive, discontinued)` y `(status='active') = (archived_at IS NULL)`; CHECK de largo de nombre 1–60; RLS: SELECT miembros, INSERT/UPDATE `has_permission(settings.manage)`, sin DELETE | `products` conserva **los 3 estados** (`active`, `inactive`, `discontinued`) con la misma coherencia con `archived_at`, el nombre único entre los no archivados (cambia el F3 viejo, que permitía duplicados: §21) y la misma forma de RLS |
| **Quién lee `content_offers` hoy** | `app/(dashboard)/dashboard/settings/productos/page.tsx`, `lib/actions/content-taxonomy.ts` (`createProduct`, `updateProduct`, y el alta rápida desde la clasificación), `lib/content/{load-taxonomy,taxonomy,classification-refs}.ts`, `lib/agent/copywriter.ts`, `lib/dashboards/content-load.ts`, `lib/types/database.ts`, `scripts/verify-rls.mjs`, `scripts/verify-content.mjs` y sus tests | **Todos** pasan a leer `products` en F3. Ninguna función SQL lee `content_offers` (verificado en `pg_proc`) |
| **La base y `main` ya están al día** | Las ramas `perf/navegacion` y `feat/tareas-ia-estandar` están mergeadas (`00141` y `00142` tienen archivo en `main`); `00136` y `00128` ya están aplicadas (última por número: 00142). Difiere de `ssa-hechos.md`, que las daba sin mergear y sin aplicar | Nada que esperar: el prerrequisito de Llamadas sobre esas ramas ya está cumplido |

### 3.3 Qué hay de ventas hoy

Nada: no existen `products` (como tabla de ventas), `sales`, `payments`, ni columnas de ventas en `contacts`. No hay bucket `payment-receipts` (buckets actuales: `knowledge`, `content-media`, `email-attachments`, `avatars`, `chat-media`). La única pieza existente es la pantalla "Productos" sobre `content_offers` (00134: precio en USD y estado).

---

## 4. Qué cambia, qué NO cambia y análisis de impacto

### 4.1 Cambia

- **Tablas nuevas (6):** `products`, `product_variants`, `product_versions`, `assignment_rules`, `sales`, `payments`.
- **`content_ideas.offer_id` y `content_posts.offer_id`:** la FK pasa de `content_offers` a `products` (mismos ids).
- **`content_offers`:** deja de usarse; trigger puente hacia `products` mientras conviva; DROP escrito en `docs/pendientes/drop_content_offers.sql`, no aplicado.
- **`contacts`:** 4 columnas nuevas (`referred_by_user_id`, `referred_by_contact_id`, `assignment_locked_at`, `payment_health jsonb default '{}'`) y un trigger nuevo `contacts_enqueue_sales_eval` (no se toca ninguno de los existentes).
- **`workspaces`:** 4 columnas nuevas (`max_discount_percent`, `overdue_grace_days`, `sales_auto_create_flows`, `enabled_payment_methods`); nada de la Fase 2.
- **`form_submissions.sale_id` y `contract_signatures.sale_id`:** ganan su FK a `sales` (00162).
- **`submit_form_response`** (función de Formularios): v4 que valida el `sale_id` y lo manda en los eventos (00163).
- **`triggers.type`:** el CHECK suma 6 valores.
- **`audit_log`:** suma la política adicional `audit_log_select_sales` (no se toca `audit_log_select`).
- **`scheduled_jobs`:** un índice nuevo por `payload->>'payment_id'` (tipos nuevos de job: `payments_overdue_sweep`, `payment_relative_trigger`, `sales_contact_eval`).
- **pg_cron nuevo:** `payments-overdue-enqueue` cada hora → `private.enqueue_payments_overdue_sweep()` (sin ruta de cron nueva).
- **Catálogo de permisos:** 3 claves y el alcance `sales`.
- **Flow registry:** 6 triggers (con sus presets en el editor), 5 condiciones, 3 acciones y las variables `sale.*` / `payment.*`.
- **Menú:** ítem "Ventas" (grupo `ventas`). **Ajustes:** Productos (rehecha), Asignación y Actividad; sección "Ventas" en General.
- **Ficha del contacto:** secciones "Ventas" y "Salud de pago", línea de último toque y asignación.
- **Ficha de la agenda:** link a la venta (F24).
- **Storage:** bucket privado `payment-receipts`.

### 4.2 NO cambia (intocable)

- `find_or_link_contact`, `find_contact_by_phone_or_email` (de Formularios), `private.call_app_cron`, `record_contact_touch`, `readAttribution` y la forma canónica de `contacts.attribution`.
- `can_see_contact`, `can_see_conversation`, `can_see_booking`, `has_permission`, `permission_scope`.
- Los triggers existentes de `contacts` (`contacts_emit_changes`, `contacts_emit_created`, `contacts_emit_deanonymized`).
- El drenaje `/api/cron/automation-events`, el motor de flows y los nodos: **solo se registran entradas nuevas** en el registro.
- `scheduled_jobs.status` (ya admite `cancelled`) y el procesador `/api/cron/jobs`.
- `audit_log_select` entera (y las políticas adicionales de otros módulos, como la de Llamadas).
- Todo lo de la Agenda (solo se lee `bookings` y se suma un link en su ficha).
- Contenido: sus pantallas, `approve_content_idea_v2` y la clasificación siguen iguales; solo cambia de qué tabla salen los productos.
- La regla "UTC en la base, el frontend convierte".

### 4.3 Análisis de impacto y riesgos

| Zona que se toca | Quién depende | Riesgo | Mitigación |
|---|---|---|---|
| FK de `content_ideas.offer_id` / `content_posts.offer_id` (00159) | Contenido: clasificar ideas y piezas, copywriter, dashboard de contenido | Que clasificar una pieza falle si el producto no existe en `products` | Mismo id; trigger puente desde `content_offers` mientras conviva; los lectores pasan a `products` en F3; `verify-content.mjs` y los tests de `lib/content/*` y `lib/actions/content-*.test.ts` en verde antes y después |
| Pantalla `/dashboard/settings/productos` | Owners y Admins que cargan productos | Perder la columna "piezas que lo usan" o el estado | Se conservan: la columna de uso (de `pieceClassification`) y el estado con sus **3 valores** (Activo, Inactivo, Discontinuado) y el desplegable por fila, igual que hoy. Test de caracterización de la página actual antes de reescribirla |
| `lib/settings/permissions-characterization.test.ts` y `lib/settings/tabs.test.ts` | Ajustes | Cambiar quién entra a Productos o romper la pestaña activa | Productos sigue con `settings.manage`. Las pestañas nuevas se suman al test con su permiso |
| Trigger nuevo en `contacts` (00160) | Todo alta y edición de contactos (bandeja, importación CSV, agenda, formularios) | Que un error en el trigger impida crear contactos | La función atrapa toda excepción (`EXCEPTION WHEN OTHERS THEN RAISE WARNING`) y solo encola si el workspace tiene alguna regla activa; `verify-crm.mjs`, `verify-csv-import.mjs` y `verify-attribution.mjs` en verde |
| `contact_touches` (lectura) | Atribución del CRM, Agenda, Formularios | Que leer toques desde ventas cambie algo | Solo `SELECT` con columnas específicas; nada escribe en `contact_touches` ni en `contacts.attribution` desde este módulo |
| `assignment_changed` (existente) | Flujos que escuchan cambios de asignación | Que la asignación automática dispare flujos pensados para la manual | El evento lo sigue emitiendo el trigger existente (no se toca). La auditoría distingue `actor_type = 'system'` con el nombre de la regla. Se documenta en `docs/flow-registry.md` |
| Asignación automática escribiendo `setter_id`/`vendedor_id` | Alcance de leads (`can_see_contact`) | Cambiar quién ve qué contacto sin que nadie lo pida | Solo escribe si el campo está vacío (salvo "puede reasignar") y **nunca** sobre `assignment_locked_at`. Todos los modos arrancan en `manual` |
| CHECK de `triggers.type` (00165) | Todos los flujos | Perder un valor existente al reescribir el CHECK | Lista completa leída de la base al escribirla + test de que todos los `type` presentes en `triggers` siguen admitidos |
| Política adicional `audit_log_select_sales` (00167) | Historial de todos los módulos | Que un Member vea auditoría ajena (las políticas permisivas suman con OR) | Aplica solo a `sale`, `payment` y el catálogo y exige la visibilidad de la venta. Test de caracterización obligatorio antes (`verify-audit-visibility.mjs` extendido) |
| Registro de handlers de `scheduled_jobs` | La cola entera | Que un job nuevo frene la cola | Handlers registrados; tipo desconocido = `failed`. Tests existentes de `lib/jobs/*` en verde |
| Flow registry | Todos los flujos | Romper triggers existentes | Solo altas. `lib/flow-engine/registry/*.test.ts` y `consistency.test.ts` en verde |
| Rol Member (código) | Todo lo que hace un Member | Cambiar lo que ve un Member fuera de Ventas | Solo se suman 3 claves y un alcance; `lib/auth/member-baseline.test.ts` se actualiza **a propósito** y solo con esas claves |

---

## 5. Usuarios, roles y permisos

**Permisos nuevos** (se agregan a `PERMISSION_KEYS` con `module: "sales"` y a `PERMISSION_MODULES`), **3 claves** — el F2 viejo decía "10" por error:

| Clave | Qué habilita | Alcance |
|---|---|---|
| `sales.view` | Ver ventas y sus pagos, la pantalla de Pagos y el historial de sus ventas | `sales`: `own` (es setter o vendedor) / `all` |
| `sales.manage` | Cargar, editar y cancelar ventas; enviar el contrato de una venta. **Un descuento sobre el tope del workspace exige alcance `all`** | mismo alcance `sales` |
| `payments.manage` | Cobrar, revertir un cobro, agregar una cuota, reprogramar, marcar incobrable y reembolsar | mismo alcance `sales` |

`SCOPED_MODULES` suma **`sales`** (opciones `own` y `all`, como `bookings`). Un solo alcance gobierna las tres claves.

**Permisos existentes que se reutilizan:**

| Qué | Permiso | Por qué |
|---|---|---|
| Productos, variantes, versiones | `settings.manage` | Configuración del workspace; CX cuelga la plantilla de fases de la variante y Contenido usa los productos |
| Atribución de una venta (ver y editar) | `sales.view` / `sales.manage` | Es parte de la venta; no hay configuración de atribución en esta fase |
| Reglas de asignación | `settings.manage` | Asignan sobre el **contacto** |
| Sección "Ventas" de Ajustes > General (tope de descuento, gracia de mora, métodos habilitados, flujos precreados) | `settings.manage` | Configuración del workspace |
| Pantalla global de Actividad | `is_workspace_admin` | Sin clave propia |
| Flujos con triggers de ventas | `flows.view` / `flows.edit` | Ya existen |

| Rol de sistema | Permisos de Ventas |
|---|---|
| **Owner** | Las 3 (por `ALL_PERMISSION_KEYS`), alcance `sales: all`, más `settings.manage` |
| **Admin** | Las 3, alcance `sales: all`, más `settings.manage` |
| **Member** | Las 3, alcance `sales: own`. **Sin** `settings.manage`: no ve Productos, Asignación ni la sección Ventas de General |
| **Rol personalizado** | Lo que marque, con alcance `own` o `all` (sin valor guardado = `own`) |

**Función SQL `can_see_sale(s sales)`** (`STABLE SECURITY DEFINER`, `SET search_path = ''`), mismo patrón que `can_see_booking`:
```
is_workspace_member(s.workspace_id) AND (
  is_workspace_admin(s.workspace_id)
  OR s.setter_id = auth.uid()
  OR s.vendedor_id = auth.uid()
  OR (has_permission(s.workspace_id, 'sales.view') AND permission_scope(s.workspace_id, 'sales') = 'all')
)
```
Más una sobrecarga `can_see_sale_id(p_sale_id uuid)` para usar desde `payments` y `audit_log`.

**Qué NO puede nadie:**
- Borrar ventas, pagos ni filas del `audit_log` (DELETE bloqueado por RLS: no hay policy).
- Editar una venta `cancelled`, `refunded` o `disputed` (salvo notas).
- Editar un pago cobrado sin revertirlo primero (con motivo).
- Superar el tope de descuento sin alcance `sales: all`.

**Primer usuario:** el Owner del workspace, con todo.

---

## 6. Alcance específico por bloque

### 6.1 Catálogo (B1)
- **Qué hace:** productos con variantes y versiones; el precio vive en la versión y hay a lo sumo una activa por variante; historial de precios; la lista fija de 5 métodos de pago con su comisión; **absorbe `content_offers`** y la pantalla Productos actual pasa a ser la del catálogo.
- **Hasta dónde llega:** Contenido sigue eligiendo "producto" en ideas y piezas (de `products`, solo los no archivados).
- **Qué NO hace:** inventario, precios por país o moneda, bundles, cupones, impuestos, catálogo configurable de métodos de pago, plantilla de fases (es de CX), enlace con Whop (Fase 2).

### 6.2 Atribución y asignación (B2)
- **Qué hace:** la atribución de la venta es **una copia congelada del último toque** del contacto (UTMs canónicos de `contact_touches` / `readAttribution`), con la opción de elegir otro toque del historial o cargarla a mano (taxonomía cerrada para source y medium); sin toques, "Sin atribución" sin bloquear. Reglas de asignación automática de **setter, vendedor y referido**, con destino fijo o round robin y condiciones sobre los UTMs del primer y último toque; probador y simulación en seco.
- **Qué NO hace:** catálogo de fuentes, reglas de atribución, fuente sugerida o "recalcular fuentes" (fase futura, §17); recalcular la atribución de una venta desde los toques nuevos; atribución multi-toque con pesos; leer columnas `utm_*` planas; afiliados; reglas para agendas o ventas (el modelo deja `entity_type` listo); reasignar en masa contactos ya asignados.

### 6.3 Ventas (B3)
- **Qué hace:** alta en tres pasos con foto del producto, atribución por UTMs (último toque congelado, editable), descuento con tope, cinco tipos de financiamiento (la suscripción se carga a mano), cuadre obligatorio, estado derivado, vínculo con la agenda de origen, listado, ficha, edición, cancelación y **envío del contrato** prellenado desde la venta con la firma atada.
- **Qué NO hace:** oportunidades ni kanban; cotizaciones; varios productos por venta; facturación fiscal; crear el formulario de contrato (es de Formularios); ventas automáticas desde un cobro (Fase 2).

### 6.4 Pagos, mora e historial (B4)
- **Qué hace:** plan de cuotas en la ficha, cobrar con comprobante (guardando la comisión congelada), cobro parcial, revertir, mora automática con gracia, desfase contra la fecha original, reprogramar, incobrable, reembolso, pantalla de Pagos, historial con la rama de lectura nueva, pantalla de Actividad, triggers por estado con sus presets, recordatorios relativos y flujos de cobranza precreados apagados.
- **Qué NO hace:** cobro automático, links de pago, conciliación con un procesador (Fase 2); intereses o recargos; conciliación bancaria.

---
## 7. Funcionalidades y criterios de aceptación

> **Formato:** descripción + criterios **EARS** (`CUANDO …, EL SISTEMA DEBE …`) o **DADO / CUANDO / ENTONCES** + el test que debe pasar. Los tests van junto al módulo (`*.test.ts`) y corren con `npx vitest run`. Resend y cualquier `fetch` van simulados.
>
> **Regla de plata en tests:** todo test de montos, saldos o cuadre usa importes que no cierran redondo (`416.67`, `1297.33`) y verifica que la comparación se haga en céntimos. Al menos un test por función de saldo usa un caso que falla si se compara con `===` sobre flotantes.
>
> **Regla de fechas en tests:** todo test de mora, vencimiento o desfase fija el reloj (`vi.setSystemTime`) y pasa la zona explícita (`America/Costa_Rica` y `UTC`). Casos obligatorios: un pago que vence "hoy" a las 23:00 hora local y un cobro a las 00:30 del día siguiente.

---

### Bloque 1: Catálogo

#### F1: Tablas del catálogo (migración 00158)
**Descripción:**
- `products`, `product_variants`, `product_versions` con las columnas de §9.1.
- Índice único parcial: **una sola versión `active` por variante**. Único `(product_variant_id, version_number)`.
- Único `(workspace_id, lower(btrim(name))) WHERE archived_at IS NULL` en `products` (el mismo que tenía `content_offers`).
- `products.status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','discontinued'))` + `archived_at`, con el CHECK de coherencia `products_status_archived_check`: `(status = 'active') = (archived_at IS NULL)` (los mismos estados y la misma regla que `content_offers` en la 00134).
- CHECK `currency = 'USD'`.
- Función `publish_product_version(p_version_id uuid, p_actor_id uuid)` (§F5).
- `workspaces.enabled_payment_methods text[] NOT NULL DEFAULT ARRAY['whop','transferencia_cr','transferencia_usa','wise','binance']`.
- RLS en las tres: SELECT `is_workspace_member(workspace_id)`; INSERT y UPDATE `has_permission(workspace_id, 'settings.manage')`; **sin policy de DELETE** (bloqueado). Trigger `set_updated_at` existente.
- Tipos regenerados en `lib/types/database.ts`.
- **`scripts/verify-sales.mjs` nuevo**, con flag `--block N` (corre las secciones hasta N), usuarios reales Owner y Member, prefijo `zz-test-` y limpieza al final.

**Criterios:**
- CUANDO la migración se aplica dos veces, NO DEBE fallar.
- CUANDO se intenta insertar una segunda versión `active` de la misma variante, DEBE fallar por el índice único.
- CUANDO una persona consulta el catálogo de otro workspace, NO DEBE ver filas.
- CUANDO un Member intenta insertar un producto con su sesión, DEBE fallar por RLS.
- CUANDO un Member consulta productos de su workspace, DEBE verlos (los necesita para cargar una venta).
- CUANDO cualquiera intenta un DELETE sobre las tres tablas, NO DEBE borrar nada.
- Test: `node scripts/verify-sales.mjs --block 1` sale 0; `node scripts/verify-rls.mjs` sigue en 0.

#### F2: Permisos del módulo
**Descripción:**
- Las **3 claves** de §5 en `PERMISSION_KEYS` (módulo nuevo `"sales"` en `PERMISSION_MODULES`, etiqueta "Ventas"), con etiquetas y descripciones en español.
- `SCOPED_MODULES` suma `"sales"`; `scopeOptionsFor("sales")` = `own | all`; `SYSTEM_ROLE_PERMISSIONS`: owner y admin `sales: "all"`, member `sales: "own"`; `MEMBER_KEYS` suma las 3.
- La pantalla de roles (Ajustes > Equipo > Roles) muestra el módulo y el selector de alcance sin cambios de código propios (sale del catálogo).
- **No hay backfill en la base** (§3.2): los roles de sistema leen sus permisos del código.
- `can_see_sale` y `can_see_sale_id` se crean en la 00161 (B3), pero la regla pura que las espeja, `canSeeSale(viewer, sale)`, va en `lib/sales/permissions.ts` desde este bloque.

**Criterios:**
- CUANDO se evalúa el rol de sistema `member`, DEBE tener `sales.view`, `sales.manage` y `payments.manage` con alcance `own`, y **NO** DEBE tener `settings.manage`.
- CUANDO se evalúan `owner` y `admin`, DEBEN tener las 3 con alcance `all`.
- `normalizeScope("sales", "own_unassigned")` DEBE devolver `own` (opción que no existe para ventas).
- `canSeeSale` DEBE dar `true` para el setter (no vendedor) con alcance `own`, `false` para un Member que no es ni setter ni vendedor, y `true` para un rol personalizado con `sales.view` y alcance `all`.
- `lib/auth/member-baseline.test.ts` se actualiza **solo** con las 3 claves y el alcance nuevo; el resto de sus casos sigue igual.
- Test: `lib/auth/permissions.test.ts` (extendido) y `lib/sales/permissions.test.ts` pasan.

#### F3: Productos (absorbe `content_offers`, migración 00159)
**Descripción:**

**a) La migración 00159** (riesgo alto, §1b), en una transacción:
1. Por cada fila de `content_offers` sin `products` con el mismo id: inserta `products (id = o.id, workspace_id, name, product_type = 'otro', status = o.status, archived_at = o.archived_at, created_by = o.created_by, created_at = o.created_at)`.
2. Por cada producto migrado sin variantes: inserta la variante **"Estándar"** (`duration_type = 'lifetime'`, `billing_type = 'one_time'`, `display_order = 0`).
3. Por cada variante sin versiones: inserta la **versión 1**: si `price_usd IS NOT NULL` → `status = 'active'`, `price = price_usd`, `published_at = now()`, `published_by = o.created_by`, `change_notes = 'Migrado de Productos (content_offers)'`; si es NULL → `status = 'draft'`, `price = 0`, `change_notes = 'Migrado sin precio: cargá el precio y publicá'`.
4. Trigger **puente** `content_offers_bridge_to_products` (AFTER INSERT OR UPDATE en `content_offers`, `SECURITY DEFINER`): replica el alta o el cambio (nombre, `status` y `archived_at` tal cual, precio como versión nueva publicada si cambió) en `products` con el mismo id. Existe solo mientras conviva la tabla; el borrado diferido lo borra.
5. `content_ideas` y `content_posts`: `DROP CONSTRAINT …_offer_id_fkey` y `ADD CONSTRAINT …_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.products(id) ON DELETE SET NULL NOT VALID`, después `VALIDATE CONSTRAINT`.
6. Cabecera con: qué hace, las consultas de control, el script de vuelta atrás (§1b) y el `COMMENT ON TABLE content_offers` actualizado ("SIN USO desde la 00159; la reemplaza `products`").

**b) El código** (todo en B1):
- `lib/actions/products.ts` (nuevo, `"use server"`): `createProduct`, `updateProduct`, `setProductStatus` (activo / inactivo / discontinuado; escribe `status` y `archived_at` juntos), `archiveProduct` y `restoreProduct` (atajos de `setProductStatus`), `createVariant`, `updateVariant`, `archiveVariant`, `duplicateVariant`, `createVersionDraft`, `updateVersionDraft`, `deleteVersionDraft`, `publishVersion`. Todas con `requirePermission("settings.manage")` y `logAudit` (`entity_type` `product`, `product_variant`, `product_version`).
- **`lib/actions/content-taxonomy.ts`**: `createProduct` / `updateProduct` (y el alta rápida de producto desde la clasificación, si existe) **delegan** en `lib/actions/products.ts` (crear desde Contenido crea producto + variante Estándar + versión 1 activa con el precio). Se borran las escrituras a `content_offers`.
- **Lectores que pasan a `products`:** `lib/content/load-taxonomy.ts`, `lib/content/taxonomy.ts`, `lib/content/classification-refs.ts` (`{ key: "offer_id", table: "products", … }`), `lib/agent/copywriter.ts`, `lib/dashboards/content-load.ts`, `scripts/verify-rls.mjs` y `scripts/verify-content.mjs`, con sus tests. El estado que Contenido mostraba (`active`/`inactive`/`discontinued`) **se conserva igual**, leído de `products.status`; los selectores de Contenido ofrecen solo los `active`; el precio que se mostraba es el de la versión activa de la variante por defecto (`display_order` menor).
- **Pantalla `/dashboard/settings/productos`** (la existente, rehecha): lista de productos con nombre, tipo, cantidad de variantes, precio de la variante por defecto, **piezas de Contenido que lo usan** (se conserva, de `pieceClassification`) y **estado con el desplegable por fila** (Activo · Inactivo · Discontinuado), igual que hoy; con el filtro "mostrar discontinuados" que ya tiene la pantalla.
  - **"+ Nuevo producto"** (modal corto): nombre, tipo (`programa`, `mentoria`, `curso`, `servicio`, `otro`), descripción. Al crear, el sistema crea también la variante "Estándar" y su versión 1 en **borrador** y abre el detalle.
  - **Archivar = pasar a Inactivo o Discontinuado** (escribe `archived_at = now()`); **restaurar = volver a Activo** (`archived_at = null`). Solo los `active` aparecen en el selector de venta nueva y en los de Contenido; las ventas y piezas existentes siguen mostrando su producto **en cualquier estado** (con el chip del estado).
  - El detalle `/dashboard/settings/productos/[id]` muestra sus variantes (F4).
- Lógica de pantalla en funciones puras: `lib/sales/catalog/products.ts` (`productRow`, `defaultVariantPrice`, `isSellable`).

**Criterios:**
- DADA la base con las 3 filas de `content_offers`, CUANDO se aplica la 00159, ENTONCES DEBEN existir 3 productos con **los mismos ids** y el **mismo `status`** que tenían, 3 variantes "Estándar" y 3 versiones 1 activas con 3000, 6000 y 12000; y la consulta de control de huérfanos DEBE dar 0.
- CUANDO se aplica la 00159 dos veces, NO DEBE duplicar productos, variantes ni versiones.
- CUANDO después de la 00159 se inserta una fila en `content_offers` (código viejo), DEBE aparecer en `products` con el mismo id (puente) y una pieza DEBE poder apuntar a ella.
- CUANDO una pieza de Contenido se clasifica con un producto creado desde la pantalla nueva, DEBE guardarse sin error de FK.
- CUANDO se crea un producto, DEBEN existir exactamente una variante y una versión en borrador.
- CUANDO se crea un producto con el nombre de otro activo (sin importar mayúsculas ni espacios), DEBE rechazarse con "ya existe un producto con ese nombre".
- CUANDO un producto con ventas o piezas pasa a Inactivo o Discontinuado, esas filas NO DEBEN cambiar, DEBEN seguir mostrando el producto con su estado, y el producto NO DEBE aparecer en los selectores; al volver a Activo, DEBE volver a aparecer.
- CUANDO se intenta guardar `status = 'inactive'` con `archived_at` null (o `active` con `archived_at`), DEBE fallar por el CHECK de coherencia; `setProductStatus` DEBE escribir los dos juntos.
- La pantalla DEBE mostrar los 3 estados con el desplegable por fila y el contador de piezas (test de `productRow` con un producto de cada estado).
- CUANDO se intenta borrar un producto, NO DEBE existir la acción (ni en la interfaz ni por RLS).
- `grep -rn "from(\"content_offers\")" app lib scripts` NO DEBE devolver resultados (test estático en `lib/sales/catalog/no-content-offers.test.ts` que recorre esos directorios).
- Los tests existentes de Contenido (`lib/content/*.test.ts`, `lib/actions/content-*.test.ts`, `lib/agent/copywriter.test.ts`) siguen en verde con los fixtures pasados a `products`.
- `lib/settings/permissions-characterization.test.ts` sigue diciendo `productos: settings.manage`.
- Test: `lib/sales/catalog/products.test.ts` pasa; `verify-sales.mjs --block 1`, `verify-content.mjs` y `verify-rls.mjs` salen 0.

#### F4: Variantes
**Descripción:** dentro del detalle del producto. El detalle de la variante se arma **con pestañas** (hoy una sola: **Precio**; CX suma **Servicio** después).
- Lista de variantes con nombre, **precio de la versión activa**, duración, garantía, tipo de facturación y estado.
- **"+ Nueva variante"**: nombre, duración (`days`, `weeks`, `months`, `lifetime` + valor), garantía opcional (mismo formato), tipo de facturación (`one_time` o `recurring` + intervalo `monthly`/`quarterly`/`yearly`). Crea la variante con su versión 1 en borrador.
- Duplicar una variante copia su versión activa como borrador de la nueva.
- Archivar y restaurar.
- **Sin sección de Whop** (Fase 2).

**Criterios:**
- CUANDO la facturación es `recurring`, el intervalo DEBE ser obligatorio; CUANDO es `one_time`, DEBE quedar null (CHECK y Zod).
- CUANDO la duración es `lifetime`, el valor DEBE quedar null y NO DEBE pedirse.
- CUANDO se archiva la única variante activa de un producto, DEBE advertir que el producto deja de poder venderse.
- Test: `lib/sales/catalog/variants.test.ts` pasa.

#### F5: Versiones y publicación
**Descripción:** la versión es donde vive el **precio** y las condiciones vigentes.
- Campos: número (autoincremental por variante), **precio** (USD, ≥ 0), moneda (`USD` fijo), notas del cambio, `capabilities_config jsonb default '{}'` (reservado para CX Fase 2), estado (`draft`, `active`, `deprecated`), `published_at`, `published_by`, `deprecated_at`.
- **Publicar**, en **una sola transacción**: la activa pasa a `deprecated` con `deprecated_at` y la nueva a `active` con `published_at`. Función SQL `publish_product_version(p_version_id, p_actor_id)` (`SECURITY DEFINER`, `SET search_path = ''`, `REVOKE` de `authenticated`, la llama la Server Action con el cliente de servicio después de `requirePermission`).
- Un borrador se edita y se borra libremente. Una publicada **no se edita nunca**: se crea otra.
- Precio cero solo con notas del cambio.
- Funciones puras en `lib/sales/catalog/versions.ts`: `resolveActiveVersion(versions)` y `canPublish(version, siblings)`.

**Criterios:**
- CUANDO se publica una versión, la anterior DEBE quedar `deprecated` en la **misma transacción** y DEBE existir exactamente una `active`.
- CUANDO se intenta publicar una versión `deprecated`, DEBE rechazarse.
- CUANDO se intenta editar el precio de una versión publicada, la Server Action DEBE rechazarlo con "una versión publicada no se edita: creá una nueva".
- CUANDO se intenta borrar una versión con ventas o una publicada, DEBE rechazarse.
- CUANDO el precio es 0 y no hay notas, DEBE rechazarse (CHECK y Zod).
- `resolveActiveVersion` con dos activas (estado imposible) DEBE lanzar, no elegir una.
- Test: `lib/sales/catalog/versions.test.ts` pasa; `verify-sales.mjs --block 1` cubre la transacción de publicar.

#### F6: Historial de precios
**Descripción:** en la variante, panel "Historial de precios": versiones con número, precio, estado, quién publicó, cuándo, notas y **cuántas ventas** se hicieron con esa versión (sobre `sales.product_version_id`; hasta que exista `sales` en B3, la cuenta es 0 y la consulta se agrega en F17). Botón "Nueva versión" que arranca de una copia de la activa.

**Criterios:**
- CUANDO una versión tiene 3 ventas, el panel DEBE mostrar 3 y NO DEBE existir el botón de borrar para esa versión.
- CUANDO se abre "Nueva versión", los campos DEBEN venir con los valores de la activa.
- Test: `lib/sales/catalog/price-history.test.ts` pasa.

#### F7: Métodos de pago (lista fija en código)
**Descripción:** **no hay tablas.** Constante en `lib/sales/payment-methods.ts`:

| Clave | Nombre | Comisión % | Comisión fija |
|---|---|---|---|
| `whop` | Whop (registrado a mano) | 3.00 | 0.00 |
| `transferencia_cr` | Transferencia CR | 0 | 0 |
| `transferencia_usa` | Transferencia USA | 0 | 0 |
| `wise` | Wise | 0 | 0 |
| `binance` | Binance | 0 | 0 |

> **Claude Code confirma con Wendy la comisión real de Whop** y la anota en el archivo con la fecha. El 3 % es un valor de arranque. Mientras la integración de Whop está en pausa, `whop` es un método más que se registra a mano.

- Tipo `PaymentMethodKey` derivado de la constante. El CHECK de `payments.payment_method` (00161) y el selector salen de la misma lista (test de paridad).
- **Qué métodos se ofrecen:** `workspaces.enabled_payment_methods`, editable en Ajustes > General > sección **Ventas** (con `settings.manage`).
- Función pura `computeProviderFee(amount, method)` en `lib/sales/fees.ts`, en céntimos: `round(amountCents * pct / 100) + fixedCents`.
- **Al cobrar** (F29), el pago guarda `payment_option_snapshot` (`{method_key, method_name, provider_fee_percent, provider_fee_fixed}`) y **`provider_fee_amount`** = `computeProviderFee`. Cambiar la constante no reescribe lo cobrado. **Gastos suma `provider_fee_amount` por método y por mes** (índice `(workspace_id, payment_method, paid_at)`, 00161).

**Criterios:**
- `computeProviderFee(100, 'whop')` DEBE dar `3.00`.
- `computeProviderFee(416.67, {pct: 2.9, fixed: 0.30})` DEBE dar `12.38` (en céntimos, no `12.383…`).
- `computeProviderFee(100, 'wise')` DEBE dar `0`.
- CUANDO se cambia la comisión en la constante, los pagos ya cobrados DEBEN conservar la del snapshot.
- CUANDO un método sale de `enabled_payment_methods` y hay pagos programados que lo usan, el selector NO DEBE ofrecerlo, los pagos existentes DEBEN seguir mostrándolo, y la sección de Ajustes DEBE advertir cuántos hay.
- Test: `lib/sales/fees.test.ts` y `lib/sales/payment-methods.test.ts` pasan (la paridad con el CHECK se agrega en F17).

#### F8: Navegación
**Descripción:**
- **Menú:** ítem **"Ventas"** en `lib/nav/items.ts`, grupo `ventas` (después de Agenda), `href: "/dashboard/ventas"`, `permissions: ["sales.view"]`, `alsoActiveOn: ["/dashboard/ventas"]`. Abre la lista de ventas, **sin ⚙**.
- **Barra superior de Ventas:** conmutador **Ventas · Pagos**, los filtros y "+ Nueva venta" (con `sales.manage`).
- **Ajustes** (`lib/settings/tabs.ts`), cada pestaña con su ruta y permiso:

| Ruta | Pestaña | Permiso | Bloque |
|---|---|---|---|
| `/dashboard/settings/productos` (+ `/[id]`) | Productos (existente, rehecha) | `settings.manage` | B1 |
| `/dashboard/settings/asignacion` | Reglas de asignación | `settings.manage` | B2 |
| `/dashboard/settings/actividad` | Actividad | `is_workspace_admin` | B4 |
| `/dashboard/settings` → sección "Ventas" | Tope de descuento, gracia de mora, métodos habilitados, flujos precreados | `settings.manage` | B1 (métodos) y B4 (el resto) |

**Criterios:**
- CUANDO la persona no tiene `sales.view`, "Ventas" NO DEBE aparecer en el menú y `/dashboard/ventas` DEBE redirigir.
- CUANDO la persona tiene `sales.view` pero no `settings.manage`, Productos y Asignación NO DEBEN aparecer y sus rutas DEBEN redirigir.
- En Ventas NO DEBE existir ningún botón de configuración.
- `activeSettingsTab` DEBE marcar la pestaña correcta para cada ruta nueva y para `/dashboard/settings/productos/<id>`.
- Test: `lib/nav/items.test.ts`, `lib/settings/tabs.test.ts` y `lib/settings/permissions-characterization.test.ts` extendidos pasan.

**Bloque 1 listo cuando:** F1 a F8 cumplen sus criterios; `npx vitest run` sale 0 (incluidos los tests existentes de Contenido y de Ajustes); `npm run build` compila; `npm run lint` sin errores nuevos; `node scripts/verify-sales.mjs --block 1`, `verify-rls.mjs` y `verify-content.mjs` salen 0; las migraciones 00158 y 00159 están aplicadas con su consulta de control en 0; y `docs/PENDIENTE.md` anota que `content_offers` queda sin uso hasta el borrado diferido (que se escribe al cerrar B4 en `docs/pendientes/drop_content_offers.sql`, sin número).

---
### Bloque 2: Atribución por UTMs y asignación automática

> **Cambio de la v7 (decisión de Wendy, 10/10):** la venta se atribuye **solo con UTMs**: una copia congelada del **último toque** del contacto. **No hay catálogo de fuentes ni reglas de atribución** en esta fase (quedan como fase futura, §17). Se conserva la numeración F9–F16: F10–F12 cambian de contenido.

#### F9: Tablas de asignación y columnas nuevas (migración 00160)
**Descripción:**
- `assignment_rules` (§9.2), con `kind` `setter`, `vendedor` o `referral` (**sin** `source`).
- `contacts`: `referred_by_user_id` (FK `auth.users`, `SET NULL`), `referred_by_contact_id` (FK `contacts`, `SET NULL`), `assignment_locked_at timestamptz`, `payment_health jsonb NOT NULL DEFAULT '{}'`. **Sin `source_id`.**
- `workspaces`: `max_discount_percent numeric(5,2) NULL CHECK (0..100)`, `overdue_grace_days int NOT NULL DEFAULT 0 CHECK (0..30)`, `sales_auto_create_flows bool NOT NULL DEFAULT true`. **Sin `default_source_id`.**
- **Precarga por workspace** (backfill + trigger `AFTER INSERT ON workspaces`, función nueva `seed_sales_defaults()`, mismo patrón que `seed_booking_categories`): 3 filas de `assignment_rules` (`setter`, `vendedor`, `referral`, `entity_type = 'contact'`) en modo `manual`.
- **Trigger nuevo `contacts_enqueue_sales_eval`** (`AFTER INSERT OR UPDATE OF attribution ON contacts`, función nueva `SECURITY DEFINER`): si el workspace tiene alguna `assignment_rules` en modo distinto de `manual`, inserta en `scheduled_jobs` un job `sales_contact_eval` con `payload {contact_id, workspace_id}`, `run_at = now()` y `dedupe_key = 'sales_eval:' || contact_id || ':' || md5(coalesce(NEW.attribution::text,''))` con `ON CONFLICT DO NOTHING`. **Toda excepción se atrapa** (`EXCEPTION WHEN OTHERS THEN RAISE WARNING`): el alta de un contacto nunca falla por esto. Los triggers existentes de `contacts` **no se tocan**.
- RLS de `assignment_rules`: SELECT para miembros; INSERT/UPDATE con `has_permission(…, 'settings.manage')`; sin DELETE.

**Criterios:**
- CUANDO se crea un workspace (o corre el backfill), DEBEN existir **3** filas de `assignment_rules` en `manual`.
- CUANDO se intenta guardar una regla con `kind = 'source'`, DEBE fallar por el CHECK.
- CUANDO un Member intenta escribir en `assignment_rules`, DEBE fallar por RLS y por la Server Action.
- CUANDO cambia `contacts.attribution` en un workspace con alguna regla no manual, DEBE existir un job `sales_contact_eval` pendiente; con todas en manual, NO DEBE crearse.
- CUANDO el trigger falla (se fuerza en el test), el contacto DEBE crearse igual.
- `verify-crm.mjs`, `verify-csv-import.mjs` y `verify-attribution.mjs` siguen en 0.
- Test: `verify-sales.mjs --block 2` sale 0.

#### F10: La atribución de una venta (funciones puras)
**Descripción:** `lib/sales/attribution.ts`. La atribución de la venta es **una copia congelada de un toque canónico**, leída con `readAttribution` / `contact_touches`, nunca de columnas `utm_*` planas.
- **Forma guardada** en `sales.attribution jsonb` (tipo `SaleAttribution`): `{touch_id, occurred_at, source, medium, campaign, content, term, ad_id, adset_id, campaign_id, fbclid, gclid, ttclid, li_fat_id, ctwa_clid, referrer_url, landing_page, extras}`. **`extras`** (v1.1) es el objeto con las claves de `contact_touches.raw` que están en `lib/attribution/keys.ts` (`utm_id`, `gbraid`, `wbraid`, `msclkid`, `twclid`, `sccid`, `epik`, `rdt_cid`, `placement`, `fbp`, `fbc`, `ga_client_id`, `page_url`); se omite si no hay ninguna. La misma forma la arma `create_sale` en SQL para el modo `last_touch`. `content` sale de `contact_touches.content_label` (en `readAttribution` es `content`). Campos ausentes = omitidos (no `""`).
- **`attributionFromTouch(touch)`**: arma `SaleAttribution` desde una fila de `contact_touches` (con su `id` como `touch_id`).
- **`attributionFromContact(contact)`**: si no hay fila de toque disponible, usa `readAttribution(contact.attribution).last_touch` (sin `touch_id`). Devuelve `null` si el contacto no tiene ningún toque.
- **`manualAttribution(input)`**: valida con Zod la carga a mano: `source` y `medium` de la **taxonomía cerrada** de `lib/contacts/taxonomy.ts` (`SOURCES`, `MEDIUMS`; obligatorio al menos `source`), y `campaign`, `content`, `term` libres (texto ≤ 200, `trim`). Sin `touch_id` (salvo que se haya elegido un toque y después se edite: en ese caso se conserva el `touch_id` de origen).
- **`resolveSaleAttribution({mode, touchId, manual}, contact, touches)`** → `{attribution, attribution_touch_id, attribution_type}`:
  - `mode = 'last_touch'` (por defecto): el toque más reciente del contacto (`occurred_at` mayor) → `attribution_type = 'last_touch'`.
  - `mode = 'touch'` (eligió **otro toque** del historial): ese toque → `attribution_type = 'manual'`, con su `touch_id`.
  - `mode = 'manual'` (editó a mano): `manualAttribution` → `attribution_type = 'manual'`.
  - Sin toques y sin edición → `attribution = null`, `attribution_type = 'none'` ("Sin atribución"). **No bloquea la venta.**
- **`describeAttribution(a, now, tz)`** → la línea legible: "instagram / paid_social / campaña octubre / anuncio 123 (hace 3 días)", con las etiquetas de `SOURCE_LABELS`/`MEDIUM_LABELS`; `none` → "Sin atribución".

**Criterios:**
- DADO un contacto con toques del 1/10 (`source google`) y del 7/10 (`source instagram, medium paid_social, campaign "octubre", ad_id "123"`), `resolveSaleAttribution({mode:'last_touch'})` DEBE devolver el del 7/10, con su `touch_id` y `attribution_type 'last_touch'`.
- DADO `mode:'touch'` con el `touch_id` del 1/10, DEBE devolver ese toque con `attribution_type 'manual'`.
- DADO un contacto sin toques, DEBE devolver `attribution null` y `attribution_type 'none'`.
- DADO un contacto cuya atribución está en la **forma vieja** (`{first_click:{utm_source:"ig"}}`) y sin filas de `contact_touches`, `attributionFromContact` DEBE usar lo que devuelve `readAttribution` (y nunca claves `utm_*`).
- `manualAttribution({source:"facebook"})` DEBE rechazarse (no está en `SOURCES`); `{source:"instagram", medium:"paid_social", campaign:" octubre "}` DEBE guardar `campaign "octubre"`.
- `attributionFromTouch` DEBE mapear `content_label` → `content` y omitir los campos vacíos.
- DADO un toque con `raw = {msclkid:"m1", fbc:"fb.1.1.x", foo:"z"}`, `attributionFromTouch` DEBE dar `extras = {msclkid:"m1", fbc:"fb.1.1.x"}` (sin `foo`); y `verify-sales.mjs` DEBE confirmar que `create_sale` en SQL guarda el mismo `extras` (paridad SQL/TS).
- `describeAttribution` DEBE dar "Sin atribución" para `none` y "hace 3 días" con el reloj fijado.
- Test: `lib/sales/attribution.test.ts` pasa (los 7 casos).

#### F11: Componente "Atribución" (ver, editar, elegir otro toque)
**Descripción:** `components/sales/attribution-field.tsx`, reusado en el paso 1 del asistente (F18) y en la edición de la venta (F26).
- **Línea:** "Atribución: último toque — instagram / paid_social / campaña octubre / anuncio 123 (hace 3 días)" + botón **"Editar"**. Sin toques: "Sin atribución" + "Editar".
- **"Editar"** abre un panel con dos opciones:
  - **Elegir otro toque del historial (recomendado):** lista de los toques del contacto de `contact_touches` (fecha, origen, source / medium / campaign), del más reciente al más viejo, paginada de a 20. Elegir uno lo usa tal cual (reusa el dato real del toque).
  - **Cargar a mano:** `source` y `medium` con selectores de la taxonomía cerrada (con sus etiquetas), `campaign`, `content` y `term` libres.
  - "Volver al último toque" restaura el modo por defecto.
- Lectura de toques por una Server Action `listContactTouches(contactId)` con `sales.view` y visibilidad del contacto (`can_see_contact`), con `.select` de columnas específicas.
- La lógica de qué se muestra vive en `lib/sales/attribution.ts` (F10); el componente solo compone.

**Criterios:**
- CUANDO el contacto no tiene toques, el componente DEBE mostrar "Sin atribución" y el panel DEBE abrir directo en "Cargar a mano" (la lista de toques vacía no se ofrece).
- CUANDO se elige otro toque, el estado del formulario DEBE quedar `{mode:'touch', touchId}`; CUANDO se carga a mano, `{mode:'manual', manual}`.
- CUANDO una persona no puede ver el contacto, `listContactTouches` DEBE responder "sin permiso".
- Test: `lib/sales/attribution-field.test.ts` (estado del componente como función pura) y `lib/actions/contact-touches.test.ts` pasan.

#### F12: Atribución y asignación en la ficha del contacto
**Descripción:** en la ficha del contacto, una línea con el **último toque** (`describeAttribution` sobre `readAttribution(contact.attribution).last_touch`) y el estado de la asignación: "Setter: Ana (por la regla *Campañas de José*)" / "asignado a mano" si hay `assignment_locked_at`. No se cachea nada en `contacts`: se lee de la atribución canónica que ya existe.

**Criterios:**
- CUANDO el contacto tiene toques, DEBE mostrarse el último con fecha relativa; sin toques, "Sin atribución".
- CUANDO la asignación fue automática, DEBE mostrarse el nombre de la regla (del último `audit_log` de asignación con `actor_type = 'system'`); a mano, "asignado a mano".
- Test: `lib/sales/contact-summary.test.ts` pasa.

#### F13: Pantalla de reglas de asignación
**Descripción:** `/dashboard/settings/asignacion`.
- **Una tarjeta por `kind`**: **Setter · Vendedor · Referido**, con su **modo** y un resumen.
- **Modos:** `manual`, `round_robin` (reparto parejo entre `enabled_member_ids`, puntero `last_assigned_member_id`) y `condition_based` (lista de reglas).
- En `condition_based`: lista por prioridad. Cada regla con **nombre**, prioridad, condiciones (constructor de condiciones con los campos de F14), **destino**, "puede reasignar" y activa.
- **Destino:** setter y vendedor → una persona fija **o** round robin entre un subconjunto (la regla guarda `members[]` y su propio `last_index`); referido → una persona o un contacto (sin round robin).
- Una regla con destino inválido (persona fuera del workspace, contacto borrado) se marca "destino inválido" y se saltea.
- Quien no tiene `settings.manage` no llega a la ruta (redirige, F8).

**Criterios:**
- CUANDO dos reglas activas del mismo `kind` tienen la misma prioridad, la pantalla DEBE marcarlo y NO DEBE permitir guardar.
- CUANDO se guarda una regla `condition_based` sin destino, DEBE rechazarse.
- CUANDO el modo es `round_robin` y `enabled_member_ids` está vacío, DEBE rechazarse con "elegí al menos una persona".
- CUANDO el destino es una persona que ya no está en el workspace, DEBE mostrarse "destino inválido" y `matchRule` DEBE saltearla.
- La pantalla NO DEBE ofrecer una tarjeta de "Fuente".
- Test: `lib/sales/assignment/rules.test.ts` pasa; `verify-sales.mjs --block 2` cubre la RLS.

#### F14: Motor de condiciones y round robin
**Descripción:** funciones puras en `lib/sales/assignment/`.
- **`buildAssignmentContext(contact, extras)`** → contexto plano, construido **sobre `readAttribution(contact.attribution)`** (los UTMs del primer y último toque canónicos):
  - Por cada campo del toque (`source`, `medium`, `campaign`, `content`, `term`, `ad_id`, `adset_id`, `campaign_id`, `fbclid`, `gclid`, `ttclid`, `referrer_url`, `landing_page`, `origin`, `social_post_id`, `content_post_id`): `first_<campo>` y `last_<campo>`.
  - **`first_combined`** y **`last_combined`**: `source|medium|campaign|content|term` del toque, en minúsculas (el caso "la campaña contiene el nombre del setter").
  - `country` (de `contacts.country`), `channel` (plataforma de la conversación más reciente, que pasa quien llama en `extras`), `has_email`, `has_phone`.
- Para `first_source`/`last_source` y `first_medium`/`last_medium` el constructor ofrece la taxonomía cerrada de `lib/contacts/taxonomy.ts` con sus etiquetas (y acepta texto libre para un medio crudo).
- **`evaluateConditions(conditions, context)`**: árbol `{conditions[], groups[], rootConjunction}`; operadores `is`, `is_not`, `contains`, `not_contains`, `starts_with`, `is_empty`, `is_not_empty`, sin distinguir mayúsculas.
- **`matchRule(rule, context, validTargets)`** → `boolean` (saltea inactivas y destino inválido).
- **`pickRoundRobin(members, lastIndex, activeMembers)`** → `{memberId, nextIndex} | null`.

**Criterios:**
- DADO `[{field: last_combined, op: contains, value: "jose"}, {field: first_combined, op: contains, value: "jose"}]` con `rootConjunction: "or"` y `last_touch = {source:"instagram", medium:"paid_social", campaign:"jose-reels-oct"}`, `evaluateConditions` DEBE dar `true`.
- DADO `rootConjunction: "and"` con solo el último coincidiendo, DEBE dar `false`.
- DADO un grupo `{conditions:[A,B], conjunction:"or"}` combinado con `and` a `C`, DEBE evaluarse como `(A or B) and C`.
- DADO `is_empty` sobre `last_fbclid` ausente, DEBE dar `true`; `contains "Jose"` contra `"jose"`, coincidir.
- DADO un contacto con atribución en la forma vieja `{first_click: {utm_source: "ig"}}`, `buildAssignmentContext` DEBE producir `first_source` con lo que devuelva `readAttribution` (y **no** una clave `first_utm_source`).
- `pickRoundRobin(['a','b','c'], 2, all)` DEBE devolver `{memberId:'a', nextIndex:0}`; con `b` inactivo y `lastIndex 0`, `{memberId:'c', nextIndex:2}`; vacío o todos inactivos → `null`.
- Test: `lib/sales/assignment/context.test.ts`, `conditions.test.ts` y `round-robin.test.ts` pasan (los 9 casos).

#### F15: Aplicar las asignaciones
**Descripción:**
- `resolveAssignments(contact, rulesByKind, activeMembers, extras)` → `{setter_id?, vendedor_id?, referred_by_user_id?, referred_by_contact_id?, applied: [{kind, ruleId, ruleName, destination}], skipped: [{kind, reason}], pointerUpdates: [...]}`. **Pura.**
- Handler **`sales_contact_eval`** (`lib/jobs/handlers/sales-contact-eval.ts`): carga el contacto, llama a `resolveAssignments`, escribe **solo lo que corresponde**, avanza los punteros y audita con `auditAsSystem({ supabase, workspaceId, entityType: 'contact', entityId, action, changes, label: <nombre de la regla> })`.
- **Reglas de escritura, en orden:** (1) con `assignment_locked_at`, ese `kind` no se toca nunca; (2) campo con valor y regla sin "puede reasignar" → no se toca; (3) si no, se escribe.
- `assignment_changed` lo sigue emitiendo el trigger existente de `contacts` al cambiar `setter_id`/`vendedor_id`: no se emite a mano.
- Cambiar una asignación **a mano** desde la ficha del contacto escribe `assignment_locked_at = now()` (en la Server Action existente de asignación, como único cambio) y audita con `actor_type = 'user'`.

**Criterios:**
- DADO un contacto sin setter y una regla que coincide con destino Ana, el handler DEBE dejar `setter_id = Ana`, una fila en `audit_log` con `actor_type = 'system'` y el nombre de la regla, y **un** `assignment_changed` (el del trigger existente).
- DADO un contacto que ya tiene setter y una regla sin "puede reasignar", `setter_id` NO DEBE cambiar y NO DEBE haber auditoría.
- DADO `assignment_locked_at` y una regla **con** "puede reasignar", `setter_id` NO DEBE cambiar.
- DADO que ninguna regla coincide, NO DEBE escribirse nada.
- DADO un destino round robin, DEBE avanzar el `last_index` **de esa regla**.
- DADO dos jobs del mismo contacto con la misma atribución mientras el primero está pendiente, el segundo NO DEBE crearse; y si se crea después, NO DEBE escribir nada nuevo.
- CUANDO se asigna a mano desde la ficha, `assignment_locked_at` DEBE quedar con la fecha y la auditoría con `actor_type = 'user'`.
- Test: `lib/sales/assignment/resolve.test.ts` y `lib/jobs/handlers/sales-contact-eval.test.ts` pasan (los 7 casos).

#### F16: Probador y simulación en seco
**Descripción:**
- **Probador** (panel en la pantalla de reglas): cargar un toque a mano (source y medium de la taxonomía, campaign, content, term) o elegir un contacto, y ver para cada `kind` a quién se asignaría, por qué regla, o "ninguna regla coincide". **No escribe.**
- **Simulación en seco:** "Probar sobre los últimos 50 contactos" → tabla con contacto, lo que tiene hoy, lo que asignaría la regla y si se aplicaría (y por qué no: campo lleno, asignado a mano, destino inválido). **No escribe.**
- Las dos usan exactamente `resolveAssignments`.

**Criterios:**
- CUANDO se corre el probador o la simulación, NO DEBE haber ningún `insert`, `update`, `upsert` ni `delete` (test que espía el cliente de Supabase).
- CUANDO la simulación encuentra un contacto con el campo lleno, la fila DEBE decir "no se aplicaría: ya tiene vendedor"; bloqueado a mano, "no se aplicaría: asignado a mano".
- El resultado del probador para un contacto DEBE coincidir con lo que el handler haría.
- Test: `lib/sales/assignment/dry-run.test.ts` pasa.

**Bloque 2 listo cuando:** F9 a F16 cumplen sus criterios; `npx vitest run` sale 0; `npm run build` compila; `verify-sales.mjs --block 2`, `verify-crm.mjs`, `verify-csv-import.mjs` y `verify-attribution.mjs` salen 0; la 00160 está aplicada.

---

### Bloque 3: Ventas

#### F17: Tablas de ventas y pagos (migración 00161)
**Descripción:** la 00161 crea **`sales` y `payments` juntas** (en el plano viejo `payments` estaba en B4, pero el asistente de B3 ya crea los pagos de la venta en la misma transacción; F27 define las reglas de pagos y las verifica).
- `sales` y `payments` con las columnas de §9.3 y §9.4.
- `sales.status` CHECK con los **9 estados** (sin `draft`): `pending_payment`, `reserved`, `paid`, `overdue`, `subscription_active`, `cancelled`, `refunded`, `disputed`, `subscription_cancelled`. `financing_type` CHECK con los 5.
- `payments.payment_method` CHECK con las 5 claves de F7.
- Índices de `sales`: `(workspace_id, created_at desc)`, `(workspace_id, status, created_at desc)`, `(contact_id, created_at desc)`, `(product_version_id)`, `(vendedor_id)`, `(setter_id)`, `(booking_id) WHERE booking_id IS NOT NULL`, y **dos índices de expresión** para filtrar por atribución: `(workspace_id, (attribution->>'source'))` y `(workspace_id, (attribution->>'campaign'))`. `attribution_type` CHECK `('last_touch','manual','none')`; CHECK `attribution_type = 'none' ⇔ attribution IS NULL`.
- Índices de `payments`: `(sale_id)`, `(workspace_id, status, due_date)`, `(workspace_id, paid_at)` y **`(workspace_id, payment_method, paid_at) WHERE status = 'paid'`** (el que usa Gastos).
- Índice nuevo en `scheduled_jobs`: `((payload->>'payment_id')) WHERE payload ? 'payment_id'` (para cancelar los relativos de un pago, como el de agendas).
- Funciones (todas `SET search_path = ''`): `can_see_sale(sales)`, `can_see_sale_id(uuid)`, `derive_sale_status(...)`, `refresh_sale_status(p_sale_id, p_change_id)`, `create_sale(...)`, `emit_sales_event(...)`, y los triggers de §F23 y §F27. Las que escriben son `SECURITY DEFINER` con `REVOKE ALL … FROM PUBLIC, anon, authenticated` y `GRANT EXECUTE … TO service_role`.
- RLS: `sales` SELECT `can_see_sale(sales.*)`; `payments` SELECT `can_see_sale_id(sale_id)`. **Sin policies de INSERT/UPDATE/DELETE**: todo se escribe con el cliente de servicio desde Server Actions que ya pasaron `requirePermission` y el chequeo de alcance (§3.2). DELETE bloqueado para todos.

**Criterios:**
- CUANDO se intenta insertar una venta con `currency = 'EUR'`, o con `attribution_type = 'none'` y una `attribution` no nula, DEBE fallar.
- CUANDO un Member consulta una venta donde no es setter ni vendedor, NO DEBE ver la fila ni sus pagos.
- CUANDO un Member con sesión intenta INSERT, UPDATE o DELETE sobre `sales` o `payments`, DEBE fallar.
- CUANDO un usuario autenticado llama por RPC a `create_sale`, DEBE fallar por permiso (solo `service_role`).
- El CHECK de `payments.payment_method` DEBE coincidir con las claves de `lib/sales/payment-methods.ts` (test de paridad que lee la migración).
- Test: `verify-sales.mjs --block 3` sale 0; `lib/sales/payment-methods.test.ts` (paridad) pasa.

#### F18: Asistente de venta — Paso 1 (contacto, asignaciones y atribución)
**Descripción:** modal "Nueva venta" con indicador de 3 pasos. El borrador vive en el cliente (no se escribe nada hasta guardar).
- **Contacto:** buscador por nombre, email, teléfono o usuario de red (solo contactos que la persona puede ver). **"+ Crear contacto"**: nombre (obligatorio), email y teléfono, al menos uno de los dos. El servidor (cliente de servicio) llama a **`find_contact_by_phone_or_email(p_workspace_id, p_phone, p_email)`** (de Formularios: `STABLE`, solo `service_role`, **no crea contactos**), que devuelve `jsonb {contact_id, matched_by, conflict_contact_id}`: busca por **teléfono primero** (contra `phone` y `whatsapp_phone`) y después por email (contra `email` y `secondary_email`). Se lee **`.contact_id`**: si viene un id, se usa ese contacto y se avisa "ya existía: se usó ese" (y, si `conflict_contact_id` no es null, "el email pertenece a otro contacto"); si viene **null**, el contacto se **inserta** en `contacts` dentro de la misma Server Action (`lib/sales/contacts.ts → createManualContact`, con `display_name`, `email`, `phone`, `workspace_id` y `created_by`), antes de abrir el paso 2. El asistente nunca deja un contacto a medio crear: si la venta no se guarda, el contacto creado queda (como cualquier alta manual) y se audita. **No** se usa `find_or_link_contact`, que exige un `channel_id` y es para lo que entra por un canal. Desde la ficha del contacto o de una agenda, este paso viene resuelto.
- **Asignaciones:** setter y vendedor precargados con los del contacto, editables.
- **Atribución** (en lugar del selector de fuente): el componente de F11. Por defecto, una línea **"Atribución: último toque — instagram / paid_social / campaña octubre / anuncio 123 (hace 3 días)"** con **"Editar"**: elegir **otro toque del historial** del contacto (recomendado) o **cargar a mano** (`source` y `medium` de la taxonomía cerrada, `campaign`, `content`, `term` libres). Sin toques: **"Sin atribución"**, que **no bloquea** avanzar.
- **Datos de la venta:** fecha (por defecto hoy en la zona del workspace, no futura), notas internas, y **"Agenda que originó esta venta"** (F24).
- **Avisos arriba:** contacto "no contactar"; ya tiene una venta activa del mismo **producto** (con link); tiene pagos morosos.

**Criterios:**
- CUANDO el contacto no tiene toques, "Siguiente" DEBE estar **habilitado** y el borrador DEBE quedar con `attribution_type 'none'`.
- CUANDO no se toca la atribución, el borrador DEBE quedar `{mode:'last_touch'}`; al elegir otro toque o cargar a mano, `{mode:'touch'|'manual'}` (el servidor resuelve el resto, F22).
- CUANDO la fecha de la venta es futura (en la zona del workspace), DEBE rechazarse.
- CUANDO el contacto ya tiene una venta activa (no `cancelled`/`refunded`/`subscription_cancelled`) del mismo producto, DEBE mostrarse el aviso y exigir confirmación.
- CUANDO el contacto está "no contactar", DEBE mostrarse el aviso sin bloquear.
- Test: `lib/sales/wizard/step1.test.ts` pasa.

#### F19: Asistente — Paso 2 (producto y precio)
**Descripción:**
- Producto activo → variante activa, con el **precio de la versión activa** a la vista. Variante sin versión activa: no se ofrece y se dice por qué.
- **Descuento:** monto o porcentaje; **motivo** obligatorio si supera `workspaces.max_discount_percent`. Sin alcance `sales: all` no se puede superar el tope (el campo se limita y el servidor lo rechaza).
- En vivo: precio base, descuento, **precio final**.
- **Fecha de inicio del servicio** (`sales.service_starts_at`, reservada para CX): por defecto la del primer pago; editable.
- Funciones puras en `lib/sales/sale-math.ts`: `computeFinalAmount(base, discount)` y `buildProductSnapshot(product, variant, version)`.

**Criterios:**
- `computeFinalAmount(1497, {type:'amount', value:200})` DEBE dar `1297`; `{type:'percent', value:15}` DEBE dar `1272.45` (en céntimos).
- CUANDO el descuento deja el final negativo, DEBE rechazarse.
- CUANDO supera el tope sin motivo, DEBE rechazarse; CUANDO quien carga no tiene alcance `all` e intenta superarlo, el servidor DEBE rechazarlo aunque el cliente lo mande.
- `buildProductSnapshot` DEBE incluir `product_id`, `product_name`, `product_type`, `variant_id`, `variant_name`, `version_id`, `version_number`, `price`, `currency`, `duration_type`, `duration_value`, `billing_type`, `billing_interval`, `guarantee_duration_type`, `guarantee_duration_value`.
- Test: `lib/sales/sale-math.test.ts` pasa (los 7 casos).

#### F20: Asistente — Paso 3 (financiamiento)
**Descripción:**
- **Tipo:** `full`, `reservation_balance`, `installments`, `reservation_installments`, `subscription`.
- **Primer pago:** tipo (derivado), monto, **método** (de los habilitados), y estado: "ya cobrado" (fecha efectiva, por defecto hoy) o "programado" (vencimiento).
- **Pagos programados:** el sistema propone el resto; cantidad de cuotas **o** monto por cuota, frecuencia (`weekly`, `biweekly`, `monthly`) y fecha de la primera. Tabla editable fila por fila antes de guardar.
- **Suscripción** (cargada a mano en esta fase): importe del ciclo e intervalo; un pago por ciclo se agrega a mano; sin cuadre ni saldo.
- Funciones puras en `lib/sales/payment-plan.ts`: `buildPaymentPlan(params)` y `validatePlanBalances(finalAmount, payments)` → `{ok, diffCents}`.

**Criterios:**
- `buildPaymentPlan({total: 1250, first: {amount: 250, paid: true}, installments: 4, frequency: 'monthly', firstDue: '2026-10-26'})` DEBE dar 5 pagos: uno de 250 cobrado y cuatro de 250 mensuales.
- DADO 1.250 con primer pago 0 y 3 cuotas, DEBEN ser `416.67`, `416.67`, `416.66` (**la última absorbe el redondeo**) y sumar exactamente 1.250.
- DADO mensual desde el 31 de enero, DEBEN caer el 28 (o 29) de febrero y el 31 de marzo.
- `validatePlanBalances(1297, …)` con suma 1.296,99 DEBE dar `{ok:false, diffCents: 1}`.
- CUANDO es `subscription`, `validatePlanBalances` NO DEBE aplicarse.
- CUANDO el primer pago se marca cobrado con fecha anterior a la de la venta, DEBE rechazarse.
- CUANDO una cuota tiene fecha anterior a hoy, DEBE permitirse con el aviso "va a nacer morosa".
- Test: `lib/sales/payment-plan.test.ts` pasa (los 7 casos).

#### F21: Cuadre obligatorio y resumen
**Descripción:**
- Línea siempre visible: **"Asignado $X de $Y"**, verde si cuadra; **"Falta asignar $Z"** o **"Te pasaste por $Z"** en rojo.
- **"Guardar" deshabilitado hasta que cuadre** (salvo suscripción).
- **Resumen "Qué va a pasar":** estado en que queda la venta, cuántos pagos se crean, el primero por cuánto y con qué estado, cuándo vence el próximo, y **los flujos publicados que se van a disparar** (leídos de los triggers activos de tipo `sale_created`, `sale_status_changed`, `payment_created`, `payment_status_changed` con sus filtros, usando las mismas funciones puras de F37; hasta B4 la lista sale vacía).

**Criterios:**
- CUANDO la suma difiere del final en cualquier monto, "Guardar" DEBE estar deshabilitado y la línea DEBE decir la diferencia exacta.
- CUANDO es `subscription`, "Guardar" DEBE estar habilitado sin cuadre.
- CUANDO el primer pago cobrado cubre el total, el resumen DEBE decir **Pagada**; con reserva cobrada y saldo, **Reservada**.
- Test: `lib/sales/wizard/summary.test.ts` pasa.

#### F22: Crear la venta (transacción)
**Descripción:** Server Action `createSale(input)` en `lib/actions/sales.ts` → `lib/sales/create.ts`.
1. Valida con Zod, **incluido el cuadre en el servidor**.
2. `requirePermission("sales.manage")`; descuento sobre el tope → exige alcance `sales: all`; con alcance `own`, quien carga tiene que quedar como setter o vendedor (si no, se rechaza: no podría ver lo que crea).
3. **Relee el catálogo:** toma la versión activa **en este momento**; si cambió desde que se abrió el asistente, rechaza con `version_changed` y el precio nuevo.
4. Llama por RPC (cliente de servicio) a **`create_sale(p_payload jsonb, p_actor_id uuid)`** (plpgsql, una transacción):
   - a. Resuelve la **atribución dentro de la transacción**: con `mode 'last_touch'`, toma la fila más reciente de `contact_touches` del contacto (`ORDER BY occurred_at DESC, id DESC LIMIT 1`) y guarda su **copia congelada** en `sales.attribution` (forma de F10, con `content` = `content_label`), `attribution_touch_id` = su id y `attribution_type 'last_touch'`; si el contacto no tiene filas en `contact_touches`, usa `contacts.attribution->'last_touch'` (forma canónica) sin `touch_id`, y si tampoco hay, `attribution null` + `'none'`. Con `mode 'touch'`, el toque elegido (verificando que sea **de ese contacto**) + `'manual'`. Con `mode 'manual'`, lo que validó `manualAttribution` en el servidor + `'manual'`.
   - a2. Inserta `sales` con snapshot, montos, atribución, asignaciones, `booking_id`, `service_starts_at` y `created_by`.
   - b. Con `set_config('ssa.suppress_sale_refresh', 'on', true)` (local a la transacción) inserta los `payments` del plan, para que el trigger de pagos **no** recalcule el estado fila por fila.
   - c. Calcula el estado **una vez** con `derive_sale_status` y lo escribe.
   - d. Emite los eventos con `emit_sales_event` (F37): `sale_created` + `sale_status_changed` (`from_status: null`, `to_status: <estado inicial>`) con el **mismo `change_id`**; por cada pago, `payment_created` y, si nació cobrado, `payment_status_changed` (`null → paid`) con su propio `change_id`.
   - e. Inserta el `audit_log` (`entity_type 'sale'`, `action 'sale.created'`, `actor_type 'user'`) y uno por cada pago cobrado.
5. Después del RPC, `syncPaymentRelativeJobs(saleId)` (F37; en B3 es un no-op que se completa en B4).
6. Devuelve el id.
- **Acepta `contactId`** ya resuelto (desde la ficha del contacto o de la agenda): no pasa por la deduplicación.

**Criterios:**
- CUANDO el cuadre no da en el servidor, DEBE rechazarse con `plan_unbalanced` y la diferencia.
- CUANDO la versión activa cambió, DEBE rechazarse con `version_changed` y el precio nuevo, **sin crear nada**.
- CUANDO se crea la venta, DEBEN existir la venta, las N filas de `payments`, el `audit_log` de `sale.created` y en `automation_events` **exactamente** un `sale_created`, un `sale_status_changed` (de `null`) y un `payment_created` por pago.
- CUANDO la venta se crea, `sales.status` DEBE haberse calculado **una sola vez** (no debe existir un `sale_status_changed` intermedio, p. ej. `pending_payment → reserved`, durante la creación).
- CUANDO falla la inserción de un pago, **nada** DEBE quedar creado (test que fuerza el fallo del segundo pago).
- CUANDO quien llama no tiene `sales.manage`, DEBE responder "sin permiso" sin tocar la base.
- CUANDO se pasa `contactId`, NO DEBE llamarse a `find_contact_by_phone_or_email`.
- CUANDO se crea la venta con `mode 'last_touch'`, `sales.attribution` DEBE ser la copia del toque más reciente al momento de guardar, con su `attribution_touch_id`; CUANDO después el contacto recibe un toque nuevo, `sales.attribution` NO DEBE cambiar (la copia está congelada).
- CUANDO se manda `mode 'touch'` con un toque de **otro** contacto, DEBE rechazarse con `invalid_touch`.
- CUANDO el contacto no tiene toques, la venta DEBE crearse con `attribution_type 'none'` y `attribution null`.
- CUANDO se crea un contacto nuevo cuyo teléfono ya existe con otro email, DEBE usarse el `contact_id` que devuelve la función (el teléfono gana), mostrarse el aviso de `conflict_contact_id` y NO DEBE insertarse un duplicado; NUNCA DEBE llamarse a `find_or_link_contact`.
- CUANDO la función devuelve `contact_id: null`, DEBE insertarse exactamente un contacto nuevo (test que simula la RPC con las dos respuestas).
- Test: `lib/sales/create.test.ts` pasa (los 7 casos); `verify-sales.mjs --block 3` cubre la atomicidad y los eventos con un caso real.

#### F23: Estado derivado de la venta
**Descripción:** función pura `deriveSaleStatus(sale, payments)` en `lib/sales/sale-status.ts`, con espejo SQL `derive_sale_status(...)`.
- **Los 4 estados escritos ganan** y no se derivan: `cancelled`, `refunded`, `disputed`, `subscription_cancelled`. (En esta fase `disputed` no tiene acción en la interfaz: queda reservado para la Fase 2; `subscription_cancelled` se escribe con "Cancelar suscripción" en la ficha.)
- **Los 5 derivados**, por precedencia: (1) `subscription_active` si es suscripción; (2) `overdue` si hay al menos un pago `overdue`; (3) `paid` si `saleBalance ≤ 0` en céntimos; (4) `reserved` si hay un pago `reservation` cobrado y queda saldo; (5) `pending_payment`.
- **Trigger `payments_refresh_sale_status`** (AFTER INSERT OR UPDATE OF status, amount, type en `payments`): salvo que `ssa.suppress_sale_refresh = 'on'`, llama a `refresh_sale_status(sale_id, gen_random_uuid())`, que recalcula y, **solo si el estado cambió**, actualiza `sales.status` y emite `sale_status_changed` con `from_status` y `to_status`.
- **Trigger `sales_emit_status_change`**: cuando una Server Action escribe un estado manual (cancelar, reembolso total, cancelar suscripción), el cambio también emite `sale_status_changed`. **Un cambio = un evento**: el refresco y el trigger nunca emiten los dos por el mismo cambio (el refresco escribe con `ssa.sale_status_emitted = 'on'` y el trigger lo respeta).
- **Saldo y por cobrar** (`lib/sales/sale-math.ts`):
  - **`saleBalance(finalAmount, payments)`** = final − Σ `amount` de los pagos con `status = 'paid'` (los reembolsos son filas `paid` con monto negativo, así que restan solos), en céntimos. Marcar incobrable **no lo cambia**.
  - **`saleExpected(payments)`** = suma de `scheduled` y `overdue`. `uncollectible` y `cancelled` no entran.
  - Una venta con un incobrable queda con saldo > 0: **nunca llega a `paid`**.

**Criterios:**
- DADO 1.297 con un cobrado de 297 (tipo reserva) y cuatro programados de 250 → `reserved`; con el primero de tipo `installment` → `pending_payment`.
- DADO un pago `overdue` y otro `paid` → `overdue`.
- DADO todo cobrado y saldo 0 → `paid`.
- DADO `cancelled` con pagos cobrados → `cancelled`.
- DADO 1.250 con cobros 416,67 + 416,67 + 416,66 → `saleBalance` exactamente 0.
- DADO 1.250 con 1.000 cobrados y un `uncollectible` de 250 → `saleBalance` 250, `saleExpected` 0, estado `pending_payment` (nunca `paid`).
- La función SQL y la de TypeScript DEBEN dar lo mismo sobre los 7 casos (test de paridad: `verify-sales.mjs` llama a `derive_sale_status` con los mismos casos que el test de Vitest, leídos de `lib/sales/sale-status.cases.json`).
- CUANDO un pago pasa a cobrado y la venta pasa de `pending_payment` a `reserved`, DEBE existir **un** `sale_status_changed` con `from_status = 'pending_payment'` y `to_status = 'reserved'`.
- CUANDO un pago cambia sin que cambie el estado de la venta, NO DEBE emitirse `sale_status_changed`.
- Test: `lib/sales/sale-status.test.ts` pasa; `verify-sales.mjs --block 3` cubre el trigger, los eventos y la paridad.

#### F24: Vínculo con la agenda (la Etapa 4 está construida)
**Descripción:**
- `sales.booking_id` (FK a `bookings`, nullable, `ON DELETE SET NULL`).
- Paso 1 del asistente: selector con las agendas **pasadas** de ese contacto (fecha, tipo de evento, estado, anfitrión) que la persona puede ver.
- **Desde la agenda:** en la ficha de la agenda (cuando su estado es "asistió" o equivalente del grupo realizado), botón **"Cargar venta"** que abre el asistente con el contacto, la agenda y —si el anfitrión es del equipo— el vendedor precargados.
- Ficha de la venta: link a la agenda. Ficha de la agenda: sección "Ventas" con link a la venta (o "Sin venta").
- **Dos condiciones de flujo nuevas** (en F37): "la venta vino de una agenda" y "el tipo de evento de la agenda es …" (lista de `event_types`).

**Criterios:**
- CUANDO se elige una agenda de otro contacto (forzando el id), DEBE rechazarse.
- CUANDO se elige una agenda futura, DEBE rechazarse.
- CUANDO se abre el asistente desde la agenda, el contacto y la agenda DEBEN venir resueltos.
- CUANDO se borra la agenda (la FK lo contempla), la venta NO DEBE borrarse.
- La condición "el tipo de evento de la agenda es X" DEBE dar `true` solo para ventas con `booking_id` de ese tipo.
- Test: `lib/sales/booking-link.test.ts` pasa; `verify-sales.mjs --block 3` cubre la FK.

#### F25: Listado de ventas
**Descripción:** `/dashboard/ventas` (vista por defecto).
- **Pastillas** con contador: **Al día** · **Con mora** · **Por cobrar esta semana** · **Canceladas**.
- Columnas: fecha, contacto (link), producto (del snapshot), monto final, **cobrado**, **pendiente**, estado (chip), vendedor, **atribución** (`source / medium · campaign`, o "Sin atribución").
- Filtros en la URL: estado (varios), producto, variante, vendedor, setter, **utm source**, **utm medium**, **utm campaign** (contiene), tipo de atribución (último toque / manual / sin atribución), rango de fechas, búsqueda por contacto. Los filtros de atribución leen `sales.attribution->>'source'|'medium'|'campaign'` (índices de expresión de F17).
- Paginación de 50. Chip de alcance ("Todas las ventas del equipo" / "Solo tus ventas").
- **Vacío:** "Todavía no hay ventas" + "+ Nueva venta"; sin productos con versión activa, "Creá tu primer producto" con link a Ajustes (si tiene `settings.manage`) o "Pedile a un admin que cargue un producto".
- Lógica en `lib/sales/list.ts` (armado de filtros desde la URL, pastillas, columnas calculadas).

**Criterios:**
- CUANDO se elige "Con mora", DEBE listar solo ventas con al menos un pago `overdue`.
- CUANDO un Member con alcance `own` abre el listado, DEBE ver solo sus ventas aunque la URL pida otro vendedor.
- CUANDO se filtra por producto, DEBE filtrar por el producto **del snapshot** (una venta de un producto archivado sigue apareciendo).
- CUANDO se filtra `utm_source = instagram`, DEBE listar solo ventas con `attribution->>'source' = 'instagram'`; "Sin atribución" lista las `attribution_type = 'none'`.
- "Cobrado" y "pendiente" DEBEN calcularse con `saleBalance` en céntimos, no con sumas en flotante.
- Test: `lib/sales/list.test.ts` pasa; `verify-sales.mjs --block 3` cubre la visibilidad.

#### F26: Ficha de la venta, editar y cancelar
**Descripción:** `/dashboard/ventas/[id]` (en móvil, pantalla completa).
- **Encabezado:** contacto, producto, monto final, estado, saldo.
- **Secciones:** datos (atribución con su tipo —último toque, manual o sin atribución— y la línea de F10, asignaciones, fecha, inicio del servicio, agenda de origen, notas), **plan de pagos** (F28, en B4; en B3 una tabla de solo lectura), **contratos** (F26b), **historial** (`<Historial entityType="sale" entityId={id} />`, F34) y comprobantes.
- **Editar** (con `sales.manage` y alcance): contacto, asignaciones, **atribución** (con el componente de F11: elegir otro toque o cargar a mano → `attribution_type 'manual'`, auditado con el valor anterior y el nuevo en `changes`; **no** existe "recalcular desde el último toque actual": eso queda fuera, §17), descuento, notas, inicio del servicio.
  - **Cambiar el producto o el precio con pagos cobrados** exige `confirmRepricing: true` y motivo, **reescribe el snapshot** guardando el anterior en `audit_log.changes`, y **no toca los cobrados**; si el cuadre se rompe, `plan_unbalanced = true` con aviso y botón "Rearmar el plan".
  - Conflicto de edición: si `updated_at` cambió desde que se abrió, se avisa y se recarga.
- **Cancelar** (motivo obligatorio): los pagos `scheduled` y `overdue` pasan a `cancelled` (cada uno emite su `payment_status_changed`), los `paid` se conservan; si hubo cobro, sugerencia "registrá el reembolso". La venta pasa a `cancelled` (emite `sale_status_changed` → `cancelled`). **No vuelve atrás.**
- **Cancelar suscripción** (solo `subscription`): motivo → `subscription_cancelled`, con `subscription_cancelled_at` y `subscription_cancel_reason`.

**Criterios:**
- CUANDO se cambia el precio con pagos cobrados sin `confirmRepricing`, DEBE rechazarse indicando cuánto se cobró.
- CUANDO se cambia con confirmación, el snapshot anterior DEBE quedar en `audit_log.changes` y los cobrados NO DEBEN cambiar.
- CUANDO después del cambio el plan no cuadra, DEBE mostrarse "plan descuadrado" con la diferencia.
- CUANDO se cancela, los programados y morosos DEBEN quedar `cancelled`, los cobrados intactos, y DEBE existir **un** `sale_status_changed` con `to_status = 'cancelled'`.
- CUANDO se intenta editar una venta `refunded`, `disputed` o `cancelled` (salvo notas), DEBE rechazarse con el motivo.
- CUANDO una persona sin `sales.manage` abre la ficha, NO DEBE ver las acciones y las Server Actions DEBEN responder "sin permiso".
- Test: `lib/actions/sales.test.ts` pasa (los 6 casos).

#### F26b: Enviar contrato desde la venta (nueva en la v7)
> **Por qué "F26b" y no F27:** para no correr la numeración F27–F38, que otros documentos (CX, Gastos) y el plano viejo citan. Es la última funcionalidad de B3.

**Descripción:** con Formularios construido, la ficha de la venta tiene el botón **"Enviar contrato"** (con `sales.manage` y alcance sobre la venta).
- Abre un modal: selector de **formularios de tipo contrato publicados** (de `forms`), vista previa del texto de la versión publicada y los campos que se van a prellenar.
- **Prellenado con la venta:** datos del contacto (nombre, email, teléfono) y de la venta (producto y variante del snapshot, monto final, fecha de inicio del servicio), a los campos del formulario que tengan esa clave o ese mapeo (lo que Formularios use para prellenar), y **`sale_id` dentro del identificador firmado** del link (el mismo mecanismo que Formularios usa para el contacto). Función pura `buildContractPrefill(sale, contact, formFields)` en `lib/sales/contract.ts`.
- Genera el **link firmado** con **`signFormLink({ workspaceId, formId, contactId, saleId })`** (`lib/forms/signed-link.ts`, de Formularios: el `sale_id` viaja dentro de la firma) y ofrece: **Copiar**, **"Enviar por WhatsApp"** / **"Enviar por Instagram"** (abren la conversación del contacto en la bandeja con el link en el cuadro de texto, sin enviarlo solo) y **"Enviar por email"** (si el contacto tiene email; usa el envío por Resend existente).
- **Al firmar (migración 00163):** Formularios verifica el token (`verifyFormLink`) y pasa `signed_sale_id` a `submit_form_response`, que hasta ahora lo guardaba **sin validar**. La **v4** de `submit_form_response` (reescrita en la banda de Ventas, partiendo de la definición vigente):
  1. Si viene `signed_sale_id`, verifica `EXISTS (SELECT 1 FROM public.sales s WHERE s.id = signed_sale_id AND s.workspace_id = <ws del formulario> AND s.contact_id = <contacto resuelto de la respuesta>)`. Si no se cumple (venta inexistente, de otro workspace o de otro contacto, o la respuesta quedó sin contacto), **descarta** el `sale_id` (queda null) y anota `meta.sale_id_discarded = true` con el motivo; la respuesta y la firma se guardan igual.
  2. Escribe el `sale_id` validado en `form_submissions.sale_id`; `record_contract_signature` lo copia de la respuesta a `contract_signatures.sale_id` (esa función **no** cambia).
  3. Suma **`sale_id`** (validado o null) al payload de `form_submitted`, `survey_answered` y `contract_signed` en `automation_events`. El resto del payload y del comportamiento queda **idéntico** a la v3.
- **Sección "Contratos" en la ficha de la venta:** las firmas con ese `sale_id` (formulario, versión, fecha, estado del email) con "Ver PDF" (link firmado de Formularios) y el estado "Enviado sin firmar" para los links generados que todavía no tienen firma (se registra el envío en `audit_log` con `action 'sale.contract_sent'` y el `form_id`).
- Con el `sale_id` en el payload de `contract_signed`, un flujo puede filtrar por venta (y CX puede atar el ítem "Contrato" a su venta).

**Criterios:**
- CUANDO no hay formularios de tipo contrato publicados, el modal DEBE explicarlo y ofrecer el link a Formularios (si tiene `forms.manage`).
- `buildContractPrefill` DEBE mapear nombre, email, teléfono, producto, monto y fecha de inicio a los campos que los declaran, e ignorar los que no existen en el formulario.
- CUANDO se genera el link, DEBE llevar el `sale_id` dentro del token **firmado** (no como parámetro suelto): un token con el `sale_id` alterado DEBE ignorarse entero (regla de Formularios) y la respuesta DEBE quedar sin `sale_id`.
- CUANDO el contacto firma, `contract_signatures.sale_id` DEBE quedar con la venta y la ficha DEBE listarla.
- CUANDO el token trae un `sale_id` de otro contacto (o de otro workspace, o inexistente), la firma y la respuesta DEBEN guardarse **sin** `sale_id` y con `meta.sale_id_discarded = true`.
- CUANDO se firma con un `sale_id` válido, el `automation_events` de `contract_signed` DEBE traer `sale_id`; CUANDO se envía un formulario personalizado con link de venta, `form_submitted` DEBE traerlo.
- La 00163 NO DEBE cambiar ningún otro comportamiento de `submit_form_response`: los tests de Formularios (`lib/forms/*.test.ts`) y `verify-forms.mjs` siguen en 0 sin cambios.
- CUANDO una persona sin `sales.manage` abre la ficha, el botón NO DEBE aparecer.
- Test: `lib/sales/contract.test.ts` pasa; `verify-sales.mjs --block 3` cubre las FK de la 00162 y la validación de la 00163 con firmas reales de prueba.

**Bloque 3 listo cuando:** F17 a F26 y F26b cumplen sus criterios; `npx vitest run` sale 0 (incluidos los tests de Formularios y de la Agenda); `npm run build` compila; `verify-sales.mjs --block 3` sale 0; las migraciones 00161, 00162 y 00163 están aplicadas; y los tests y `verify-forms.mjs` de Formularios siguen en 0.

---
### Bloque 4: Pagos, mora, historial y triggers

#### F27: Reglas de la tabla de pagos y comprobantes (tabla en 00161, bucket en 00164)
**Descripción:** la tabla se creó en la 00161 (F17); acá se define y se prueba su comportamiento.
- Columnas clave: `type` (`full`, `reservation`, `installment`, `refund`), `amount`, `status` (`scheduled`, `paid`, `overdue`, `uncollectible`, `refunded`, `cancelled`), `due_date date`, **`original_due_date date`**, **`paid_at timestamptz`**, **`paid_on date`** (fecha local del cobro), `reschedule_count int default 0`, `payment_method`, `payment_option_snapshot jsonb`, **`provider_fee_amount numeric(12,2)`**, `receipt_path`, `notes`, motivos.
- **`delay_days int GENERATED ALWAYS AS (paid_on - original_due_date) STORED`**: null si no está cobrado (§3.2: una columna generada no puede leer la zona del workspace, por eso existe `paid_on`, que escribe el servidor con `localDate(paid_at, workspace.timezone)`).
- Trigger `payments_protect_original_due_date` (BEFORE UPDATE): `original_due_date` se escribe una sola vez al crear y no cambia nunca.
- CHECKs: `type = 'refund' ⇒ amount < 0`; `type <> 'refund' ⇒ amount > 0`; `status = 'paid' ⇒ paid_at IS NOT NULL AND paid_on IS NOT NULL`; `status <> 'paid' ⇒ provider_fee_amount IS NULL`; `type = 'refund' ⇒ (provider_fee_amount IS NULL OR provider_fee_amount = 0)`; y **`status <> 'refunded'`** como CHECK propio de la Fase 1 (`payments_no_refunded_status_phase1`, se quita con una migración aditiva cuando la Fase 2 lo necesite).
- **Reembolsos en la Fase 1 (regla explícita):** un reembolso es **una fila nueva** `type = 'refund'`, `amount` negativo, `status = 'paid'`, con `paid_at`/`paid_on` de la fecha del reembolso y `provider_fee_amount` null. **El pago original NO cambia de estado** (sigue `paid`, con su comisión). El valor `refunded` de `payments.status` existe en la lista del v6 pero **no se usa en esta fase** (el CHECK de arriba lo impide); queda para la Fase 2 (reembolsos de un procesador).
- **Para Gastos:** las comisiones se suman sobre `status = 'paid'` (índice `(workspace_id, payment_method, paid_at) WHERE status = 'paid'`); las filas `refund` aportan 0 porque su `provider_fee_amount` es null.
- **Bucket privado `payment-receipts`** (00164): ruta `{workspace_id}/{sale_id}/{payment_id}/{uuid}.{ext}`, tipos `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, **10 MB**. Sin policies públicas: se sube y se lee por el servidor (cliente de servicio) después de comprobar `can_see_sale`, con URL firmada de **60 s**.

**Criterios:**
- CUANDO se inserta un `refund` con monto positivo, DEBE fallar.
- CUANDO se actualiza `due_date`, `original_due_date` NO DEBE cambiar.
- DADO `original_due_date = 2026-10-26` y `paid_on = 2026-10-28` → `delay_days = 2`; `paid_on = 2026-10-24` → `-2`; sin cobrar → null.
- CUANDO un Member consulta pagos de una venta que no ve, NO DEBE ver filas.
- CUANDO se sube un comprobante de 12 MB o un `.exe`, DEBE rechazarse; CUANDO un Member que no ve la venta pide la URL firmada, NO DEBE obtenerla; una URL vencida NO DEBE servir.
- Test: `verify-sales.mjs --block 4` sale 0.

#### F28: Plan de pagos en la ficha de la venta
**Descripción:** tabla dentro de la ficha.
- Columnas: tipo, monto, **vence** (con la original entre paréntesis si se reprogramó), **cobrado el**, **desfase** (chip: verde "puntual", azul "−2 d", ámbar "+2 d", rojo "+15 d"; umbrales en `lib/sales/delay.ts`), estado, método, comisión, comprobante.
- Acciones por fila (con `payments.manage`): **Marcar cobrado**, **Reprogramar**, **Marcar incobrable**, **Revertir cobro**, **Ver comprobante**.
- Pie: precio final, cobrado neto, **saldo**, aviso de descuadre si aplica.
- **"+ Agregar pago"** (una cuota a mano, p. ej. la diferencia de un cobro parcial).
- Lógica en `lib/sales/payment-table.ts`.

**Criterios:**
- CUANDO un pago se reprogramó, "vence" DEBE mostrar la nueva y, entre paréntesis, la original.
- CUANDO el desfase es 0, el chip DEBE decir "puntual".
- CUANDO el saldo no es 0 y no es suscripción, el pie DEBE mostrarlo en rojo.
- CUANDO la persona no tiene `payments.manage`, las acciones NO DEBEN aparecer.
- Test: `lib/sales/payment-table.test.ts` pasa.

#### F29: Marcar cobrado, cobro parcial y revertir
**Descripción:** Server Action `markPaymentPaid(input)` + modal.
- Modal: **fecha efectiva** (por defecto hoy; no anterior a la fecha de la venta ni futura), **método**, **monto** (por defecto el programado, editable con aviso), **comprobante** (opcional) y nota.
- Al guardar: `status = 'paid'`, `paid_at`, `paid_on` (fecha local), `payment_option_snapshot`, **`provider_fee_amount = computeProviderFee(monto, método)`** (queda **congelada**: es la que Gastos suma por método y mes), `audit_log`. El trigger de pagos emite **`payment_status_changed`** (`from_status` = `scheduled` u `overdue`, `to_status = 'paid'`) y recalcula la venta (que emite `sale_status_changed` si cambió, p. ej. → `paid`, que es la "venta saldada").
- **Cobro parcial:** monto menor al programado → el pago queda cobrado por lo que entró y la respuesta **ofrece** crear una cuota por la diferencia (fecha sugerida +30 días). No es automático.
- **Cobro de más:** permitido; la venta muestra "cobrado de más $X" y sugiere un reembolso.
- **Revertir cobro** (motivo obligatorio): vuelve a `scheduled` u `overdue` según su fecha **en la zona del workspace**; se borran `paid_at`, `paid_on`, `provider_fee_amount` y el snapshot; emite `payment_status_changed` (`paid → scheduled|overdue`).

**Criterios:**
- CUANDO se marca cobrado, el snapshot DEBE tener nombre y comisiones de ese momento y `provider_fee_amount` DEBE coincidir con `computeProviderFee`.
- CUANDO el monto es menor, el pago DEBE quedar por el real y la respuesta DEBE traer la oferta con la diferencia exacta.
- CUANDO el monto deja el saldo negativo, la venta DEBE quedar `paid` con el aviso.
- CUANDO la fecha efectiva es anterior a la de la venta, DEBE rechazarse.
- CUANDO se revierte el cobro de un pago vencido hace 5 días, DEBE quedar `overdue` y `provider_fee_amount` null.
- CUANDO el pago ya está `paid`, marcarlo cobrado otra vez DEBE rechazarse.
- CUANDO se marca cobrado, DEBE existir **un** `payment_status_changed` con `from_status` y `to_status` correctos en el payload.
- Test: `lib/actions/payments.test.ts` pasa (los 7 casos).

#### F30: Mora automática
**Descripción:** **no se suma ninguna ruta de cron** (`private.call_app_cron` tiene lista blanca, §3.2). La 00166 crea:
- **`private.enqueue_payments_overdue_sweep()`** (`SECURITY DEFINER`, `SET search_path = ''`): por cada workspace, calcula `now() AT TIME ZONE workspaces.timezone`; si la hora local **ya pasó las 03:00**, inserta en `scheduled_jobs` un job `payments_overdue_sweep` con `payload {workspace_id, local_date}`, `run_at = now()` y **`dedupe_key = 'overdue:' || workspace_id || ':' || local_date`**, con `ON CONFLICT DO NOTHING`. Antes de las 03:00 locales no encola nada.
- **pg_cron `payments-overdue-enqueue`**, cada hora en el minuto 7: `select private.enqueue_payments_overdue_sweep()`.
- El cron **`jobs` existente** procesa el job con el handler registrado **`lib/jobs/handlers/payments-overdue-sweep.ts`**, que para ese workspace:
  - Marca `overdue` todo pago `scheduled` con `due_date < local_date − overdue_grace_days` (`local_date` = la del payload, en la zona del workspace). Como la función corre cada hora, cada workspace se barre una vez por día local, a partir de las 03:00 de su zona, sea cual sea.
  - El `dedupe_key` solo frena duplicados mientras el job está **pendiente** (índice existente entre `pending`); si se encola otro el mismo día después de terminado, el barrido es igual de seguro porque la transición es idempotente (ver abajo).
- **No toca** `paid`, `cancelled`, `uncollectible`, `refunded`, ni pagos de ventas `cancelled`, `refunded`, `disputed` o `subscription_cancelled`.
- El `UPDATE … WHERE status = 'scheduled'` es lo que hace la transición **una sola vez** por pago (dos corridas simultáneas: la segunda no encuentra filas). Cada transición emite su `payment_status_changed` (`scheduled → overdue`) por el trigger, audita con `auditAsSystem({ ...args, label: 'Job de mora' })` y recalcula la venta (→ `overdue`, con su `sale_status_changed`).
- Funciones puras en `lib/sales/overdue.ts`: `isOverdue(payment, todayLocal, graceDays)`, `localToday(now, tz)` y `shouldEnqueueSweep(now, tz)` (espejo de la condición de las 03:00, con test de paridad contra la función SQL en `verify-sales.mjs`).

**Criterios:**
- DADO gracia 0, un pago que vence hoy **no** pasa; uno que venció ayer, sí. DADO gracia 3, uno de hace 3 días no; de hace 4, sí.
- DADO un pago que vence el 26/10 en `America/Costa_Rica`: a las 00:30 locales del 27/10 la función **no** encola (antes de las 03:00); a las 03:07 locales del 27/10 encola el job con `local_date = 2026-10-27` y el handler lo pasa a moroso; un job del 26/10 (`local_date = 2026-10-26`) **no** lo marca.
- CUANDO la función corre dos veces en el mismo día local mientras el job está pendiente, DEBE existir **un** job `payments_overdue_sweep` por workspace (`dedupe_key overdue:<ws>:<fecha>`).
- DADO un pago de una venta `cancelled`, NO DEBE pasar.
- DADO un pago cobrado el mismo día, NO DEBE pasar.
- CUANDO el handler corre dos veces para el mismo workspace y día, DEBE haber **un** `payment_status_changed → overdue` por pago.
- CUANDO un pago pasa a moroso, la venta DEBE quedar `overdue`.
- Test: `lib/sales/overdue.test.ts` y `lib/jobs/handlers/payments-overdue-sweep.test.ts` pasan (los 8 casos); `verify-sales.mjs --block 4` llama a la función SQL y verifica el `dedupe_key`; `lib/cron-config.test.ts` queda **intacto** y en verde.

#### F31: Desfase y salud de pago
**Descripción:**
- `paymentDelayDays(originalDueDate, paidAt, tz)` en `lib/sales/delay.ts`: días de calendario en la zona del workspace (la misma lógica que escribe `paid_on`).
- **Filtro en Pagos:** "cobrados con más de N días de atraso" (`delay_days > N`).
- **Salud de pago del contacto** (`contacts.payment_health`, recalculada al cobrar, revertir o pasar a moroso, en la misma Server Action o handler): `{on_time, late, early, avg_delay_days, has_active_overdue, total_paid}`. En la ficha del contacto: "7 pagos: 5 puntuales, 2 tarde · promedio +3 días · sin mora activa".

**Criterios:**
- DADO `original_due_date = 2026-10-26` y `paid_at = 2026-10-26T23:50` local → **0**; `2026-10-27T00:30` local → **1**.
- DADO un `paid_at` en UTC que en la zona local todavía es el día anterior → el valor del día **local**.
- DADO 5 puntuales y 2 de +3 días, `avg_delay_days` DEBE ser el promedio de todos, a un decimal.
- CUANDO un pago pasa a moroso, `has_active_overdue = true`; al cobrarse el último moroso, `false`.
- Test: `lib/sales/delay.test.ts` y `lib/sales/payment-health.test.ts` pasan.

#### F32: Reprogramar, incobrable y reembolso
**Descripción:**
- **Reprogramar** (`scheduled` u `overdue`): fecha nueva + **motivo obligatorio**. Cambia `due_date`, conserva `original_due_date`, suma 1 a `reschedule_count`; si estaba `overdue` y la nueva es futura, vuelve a `scheduled` (emite `payment_status_changed overdue → scheduled`). Reprograma los jobs relativos (F37).
- **Incobrable** (solo `overdue`, motivo): `status = 'uncollectible'`. Sale de `saleExpected`, **no del saldo**. Reversible a `scheduled`/`overdue` según la fecha. Cancela sus jobs relativos.
- **Reembolso** (modal sobre la venta): monto (≤ cobrado neto), fecha y motivo. Crea un pago **nuevo** `type 'refund'` con **monto negativo**, `status 'paid'`, `provider_fee_amount` null y `refund_of_payment_id` opcional (emite `payment_created` con `payload.refund_scope = 'total' | 'partial'`). **El pago original no cambia de estado**: sigue `paid` con su comisión; `payments.status = 'refunded'` no se usa en la Fase 1. Si cubre todo lo cobrado, la venta pasa a `refunded` (estado escrito) y sus programados a `cancelled`; si es parcial, el saldo lo refleja y el estado se sigue derivando.

**Criterios:**
- CUANDO se reprograma, `original_due_date` NO DEBE cambiar y el desfase futuro se mide contra la original.
- CUANDO se reprograma un moroso a fecha futura → `scheduled`; a fecha pasada → sigue `overdue`. Sin motivo → rechazo.
- CUANDO pasa a `uncollectible`, `saleBalance` NO DEBE cambiar, `saleExpected` DEBE bajar y el estado NO DEBE ser `paid`.
- CUANDO el reembolso supera el cobrado neto, DEBE rechazarse con el máximo.
- CUANDO cubre todo, `sales.status` DEBE quedar `refunded` y NO DEBE recalcularse por el trigger.
- CUANDO el reembolso se registra, el `payment_created` DEBE llevar `payment_type = 'refund'` y `refund_scope`.
- CUANDO se reembolsa, el pago original DEBE seguir `paid` con su `provider_fee_amount` intacto, la fila nueva DEBE tener `provider_fee_amount` null, y NO DEBE emitirse `payment_status_changed` para el original.
- CUANDO se intenta escribir `payments.status = 'refunded'`, DEBE fallar por el CHECK de la Fase 1.
- Test: `lib/actions/payments.test.ts` extendido pasa (los 7 casos).

#### F33: Pantalla de Pagos
**Descripción:** `/dashboard/ventas/pagos`.
- **Pastillas** con contador: **Vencen esta semana** · **Morosos** · **Cobrados este mes** · **Incobrables**.
- Columnas: vence, contacto, venta (link), producto, monto, estado, desfase, método, cobrado el.
- Filtros: estado, método, rango de vencimiento, rango de cobro, vendedor, "atraso mayor a N días", búsqueda.
- Acciones en línea: marcar cobrado, reprogramar.
- Totales del filtro arriba: cantidad, monto y, de los cobrados, **bruto / comisión / neto** (de `provider_fee_amount`).
- Lógica en `lib/sales/payments-list.ts`.

**Criterios:**
- CUANDO se elige "Vencen esta semana", DEBE listar los `scheduled` con `due_date` dentro de la semana **en la zona del workspace**.
- CUANDO un Member `own` abre la pantalla, DEBE ver solo los pagos de sus ventas.
- CUANDO se filtra "atraso mayor a 7 días", DEBE usar `delay_days > 7`.
- Los totales DEBEN calcularse en céntimos y coincidir con la suma de las filas.
- Test: `lib/sales/payments-list.test.ts` pasa.

#### F34: Historial (se usa lo que creó Llamadas)
**Descripción:** **no se crean columnas, índices ni componentes** (los creó Llamadas). Este módulo:
- Escribe toda su auditoría con `actor_type` y `actor_label`: personas con `logAudit` (`'user'`), el job de mora con `auditAsSystem({ ...args, label: 'Job de mora' })` y el handler de asignación con `auditAsSystem({ ...args, label: <nombre de la regla> })` (los helpers de Llamadas reciben **un objeto**; `auditAsWebhook({ ...args, label })` no se usa en esta fase).
- Monta `<Historial entityType entityId />` en: ficha de la venta (`sale`), fila expandida del pago (`payment`), producto (`product`), variante (`product_variant`), y versión (`product_version`). Los `entity_type` nuevos se suman al diccionario de etiquetas del componente (si lo tiene).
- Formato de `changes` con `diffFields` (campo, antes, después) para que `<Historial>` lo muestre legible.

**Criterios:**
- CUANDO el job de mora escribe, la fila DEBE tener `actor_type = 'system'` y `actor_label = 'Job de mora'`.
- CUANDO una regla de asignación escribe, `actor_type = 'system'` y el nombre de la regla en `actor_label`.
- CUANDO una persona cobra un pago, `actor_type = 'user'` y `performed_by` = esa persona.
- `<Historial>` DEBE mostrar las entradas de una venta con su diff legible (test del armado de filas que ya tenga el componente, con un caso de venta).
- Test: `lib/sales/audit.test.ts` pasa (verifica qué escribe cada acción del módulo).

#### F35: Política de lectura del historial (migración 00167)
**Descripción:** **no se reescribe `audit_log_select`.** Siguiendo la convención que fija Llamadas (cada módulo suma su propia política de SELECT **adicional y permisiva** sobre `audit_log`; Postgres las combina con OR), la 00167 crea **`audit_log_select_sales`**:
```
CREATE POLICY audit_log_select_sales ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id) AND (
         (entity_type = 'sale'    AND public.can_see_sale_id(entity_id))
      OR (entity_type = 'payment' AND EXISTS (
            SELECT 1 FROM public.payments p
             WHERE p.id = audit_log.entity_id AND public.can_see_sale_id(p.sale_id)))
      OR (entity_type IN ('product','product_variant','product_version'))
    )
  );
```
- Idempotente (`DROP POLICY IF EXISTS audit_log_select_sales` + `CREATE`). `audit_log_select` y las políticas adicionales de otros módulos (la de Llamadas) **no se tocan**. Las entidades de catálogo ya son visibles para cualquier miembro en sus tablas, así que su historial también.
- **Test de caracterización:** se **extiende** el script que creó Llamadas, `scripts/verify-audit-visibility.mjs` (o el nombre que haya usado; no se crea otro): siembra filas de `audit_log` de **cada** `entity_type` existente (`contact`, `conversation`, `booking`, `call`, y los que haya) escritas por Owner, Member, un agente y el sistema, y registra qué ve Owner, Admin y Member. Se corre antes de aplicar la 00167 y después: **para los `entity_type` existentes, el resultado tiene que ser idéntico**. La extensión suma los casos de `sale` y `payment`.

**Criterios:**
- CUANDO un Member es vendedor de una venta, DEBE ver el historial completo de esa venta, incluidas las filas `actor_type = 'system'`.
- CUANDO un Member no es setter ni vendedor, NO DEBE ver ninguna fila de esa venta ni de sus pagos.
- CUANDO un Member consulta filas `contact` que no escribió él (ni un agente), DEBE seguir **sin** verlas.
- La definición de `audit_log_select` DEBE ser idéntica antes y después de la 00167 (`pg_policies`).
- El baseline de los tres roles DEBE dar lo mismo antes y después para todos los `entity_type` previos.
- Test: `node scripts/verify-audit-visibility.mjs` (extendido) sale 0 antes y después; `verify-sales.mjs --block 4` cubre los casos nuevos.

#### F36: Pantalla de Actividad (global)
**Descripción:** `/dashboard/settings/actividad`, solo `is_workspace_admin`, sin clave propia.
- Tabla del `audit_log` con filtros: tipo de entidad, acción, tipo de actor, persona, rango de fechas y búsqueda en `actor_label`. Cada fila lleva a la entidad. Paginación de 50.
- Usa **la misma función de armado de consulta** que `<Historial>` (si Llamadas la dejó exportada; si no, se extrae a `lib/audit-query.ts` sin cambiar el comportamiento del componente).

**Criterios:**
- CUANDO una persona que no es admin entra a la ruta, DEBE redirigir.
- CUANDO se filtra por `actor_type = 'system'`, DEBE listar solo esas filas.
- Los filtros DEBEN pasar por la función compartida (test que la llama con cada filtro).
- Test: `lib/audit-query.test.ts` pasa.

#### F37: Triggers de venta y pago por cambio de estado (decisión 160)
**Descripción:** se registran en el flow registry (`lib/flow-engine/registry/sales-triggers.ts`, reglas puras en `lib/sales/automation/triggers.ts`), sin tocar el motor ni el drenaje. La 00165 suma los 6 tipos al CHECK de `triggers.type`.

**Los 6 tipos guardados** (en `triggers.type` y en `automation_events.event_type` con el mismo nombre):

| Tipo | Cuándo se emite | Payload | Filtros en `triggers.config` |
|---|---|---|---|
| `sale_created` | Al crear la venta (F22) | `sale_id, contact_id, change_id, product_id, variant_id, vendedor_id, setter_id, financing_type, final_amount, attribution_type, utm_source, utm_medium, utm_campaign` | `product_ids[]`, `variant_ids[]`, **`utm_sources[]`, `utm_mediums[]`, `utm_campaign_contains`, `attribution_types[]`**, `vendedor_ids[]`, `setter_ids[]`, `financing_types[]`, `min_amount`, `max_amount` |
| `sale_status_changed` | Cada vez que `sales.status` cambia (derivado o escrito), **y al nacer** (`from_status: null`) | lo de arriba + **`from_status`, `to_status`**, `reason` (si es cancelación) | `from_status[]`, `to_status[]`, `product_ids[]`, `vendedor_ids[]`, `utm_sources[]`, `utm_mediums[]`, `utm_campaign_contains`, `reasons_contains` |
| `payment_created` | Al crearse un pago (programado, cobrado o reembolso) | `payment_id, sale_id, contact_id, change_id, payment_type, payment_method, amount, status, refund_scope?` | `payment_types[]`, `payment_methods[]`, `refund_scope[]`, `product_ids[]` |
| `payment_status_changed` | Cada vez que `payments.status` cambia, y al nacer cobrado (`from_status: null`) | lo de arriba + **`from_status`, `to_status`**, `delay_days`, `days_overdue` | `from_status[]`, `to_status[]`, `payment_types[]`, `payment_methods[]`, `min_amount`, `max_amount`, `min_delay_days`, `product_ids[]` |
| `payment_before_due` | Relativo: X días antes del vencimiento (1–30), a la hora configurada en la zona del workspace | `payment_id, sale_id, contact_id, trigger_id, reschedule_count` | `offset_days`, `at_time`, `payment_types[]`, `product_ids[]` |
| `payment_after_due` | Relativo: X días después del vencimiento (1–90) **si sigue impago** | igual | igual (`offset_days` 1–90) |

**Los atajos son presets del editor, no tipos aparte.** El selector de triggers del flow builder muestra:

| Atajo (lo que ve la persona) | Tipo guardado | `config` que el preset deja elegido |
|---|---|---|
| Venta creada | `sale_created` | — |
| Cambió el estado de la venta | `sale_status_changed` | — (la persona elige desde/hacia) |
| **Venta cancelada** | `sale_status_changed` | `to_status: ['cancelled']` |
| **Venta saldada** | `sale_status_changed` | `to_status: ['paid']` |
| Pago creado | `payment_created` | — |
| Cambió el estado del pago | `payment_status_changed` | — |
| **Pago cobrado** | `payment_status_changed` | `to_status: ['paid']` |
| **Pago vencido (moroso)** | `payment_status_changed` | `to_status: ['overdue']` |
| **Reembolso registrado** | `payment_created` | `payment_types: ['refund']` (+ `refund_scope` opcional: total / parcial) |
| X días antes de un vencimiento | `payment_before_due` | `offset_days` |
| X días después de un vencimiento impago | `payment_after_due` | `offset_days` |

Un trigger guardado con un preset se reabre mostrando el nombre del atajo (función pura `presetFor(type, config)`; si la config ya no coincide con ningún preset, se muestra el genérico). Etiquetas legibles en `describeSalesTrigger(type, config)` ("Pago: Programado → Cobrado").

**Emisión (en la base, una sola puerta):** `emit_sales_event(p_workspace_id, p_event_type, p_contact_id, p_payload)` llama a `emit_automation_event` existente y agrega `change_id`. Los cambios de estado los emiten los triggers de la 00161 (`payments_refresh_sale_status`, `payments_emit_status_change`, `sales_emit_status_change`) comparando `OLD.status IS DISTINCT FROM NEW.status`: **todo cambio de estado genera exactamente un evento** con `from_status` y `to_status`, venga de una Server Action, del barrido de mora o de una acción de flujo.

**Que un mismo cambio no dispare dos veces** (alcance 3.6, caso raro 1):
1. **Un cambio = un evento.** No hay eventos por atajo: "Pago cobrado" y "Cambió el estado del pago" son el mismo `payment_status_changed`.
2. **Clave de idempotencia por cambio:** `dedupeKeyFor` = `<type>:<change_id>` (y para los relativos `<type>:<trigger_id>:<payment_id>:<reschedule_count>`). **No** se copia la clave de agendas (`booking_status_changed:<booking_id>`), que dispara una sola vez por agenda en toda su vida.
3. **Un flujo corre una vez por cambio aunque tenga dos triggers que coincidan** (p. ej. el genérico "Cambió el estado del pago" y el atajo "Pago cobrado", o "Pago creado" + "Pago cobrado" sobre un pago que nace cobrado, que comparten `change_id`). En `eventMatches`, la definición de los triggers de ventas carga los triggers activos **del mismo flujo** con tipos de ventas y los eventos con el mismo `change_id`, y aplica la función pura **`pickCanonicalTrigger(candidates)`**: entre todos los pares (trigger, evento) que coinciden, gana el de menor `(priority, trigger.id, event.id)`. Solo ese par devuelve `true`. Es determinista (no depende del orden en que el cron procese los eventos) y vive en el registro: el drenaje no se toca.

**Triggers relativos:** `syncPaymentRelativeJobs(saleId | paymentId)` en `lib/sales/automation/relative.ts` (patrón de `lib/scheduling/automation/relative.ts`): por cada trigger activo de flujo publicado de tipo `payment_before_due` / `payment_after_due` que coincida con el pago, crea un job `payment_relative_trigger` con `run_at` calculado en la zona del workspace y `dedupe_key = rel:<trigger_id>:<payment_id>:<reschedule_count>`. Se llama al crear la venta, al agregar o reprogramar un pago, y al publicar o cambiar un flujo con esos triggers. Al cobrar, cancelar, marcar incobrable o reembolsar, los jobs pendientes del pago quedan `cancelled` (por el índice de `payload->>'payment_id'`). Si el momento ya pasó al crearse el pago, no se crea. Handler `lib/jobs/handlers/payment-relative.ts`: relee el pago; si ya no corresponde (cobrado, anulado, o reprogramado con otro `reschedule_count`), no emite; si corresponde, emite el evento con el nombre del trigger.

**Condiciones nuevas** (`lib/flow-engine/registry/sales-conditions.ts`): ¿tiene una venta activa? (de un producto o variante) · estado de su última venta · ¿tiene pagos morosos? · cantidad de pagos con atraso mayor a N días · monto total comprado (operador + número) · **UTM de la venta** (source, medium o campaign de `sales.attribution`: es / contiene / está vacío) · **tipo de atribución** (último toque / manual / sin atribución) · **la venta vino de una agenda** · **el tipo de evento de la agenda de la venta es …** (F24).

**Acciones nuevas:** **Marcar pago como cobrado** (con confirmación en el editor; usa el método y la fecha del día; no sube comprobante) · **Reprogramar pago** (días a sumar + motivo fijo) · **Cambiar estado de la venta** (solo a `cancelled` o `subscription_cancelled`, con motivo). Todas auditan con `actor_type = 'system'` y `actor_label` = nombre del flujo, y pasan por las mismas funciones que las Server Actions.

**Variables** (`variablesFor`): `sale.product_name`, `sale.variant_name`, `sale.final_amount`, `sale.balance`, `sale.status` (etiqueta), `sale.from_status`, **`sale.utm_source`, `sale.utm_medium`, `sale.utm_campaign`, `sale.utm_content`, `sale.utm_term`, `sale.attribution_type`** (de `sales.attribution`), `sale.vendedor_name`, `sale.setter_name`, `payment.amount`, `payment.due_date`, `payment.days_overdue`, `payment.delay_days`, `payment.method`, `payment.from_status`, `payment.to_status`. Se suman a `lib/response-assets/bank-variables.ts` para que el editor las ofrezca.

**Criterios:**
- CUANDO se crea una venta del producto A y hay un flujo con `sale_created` filtrado al producto B, NO DEBE iniciarse; con filtro vacío o que incluye A, sí.
- DADO un flujo con el atajo "Pago cobrado" y otro con "Cambió el estado del pago (→ Moroso)", CUANDO un pago pasa de programado a cobrado, ENTONCES DEBE correr solo el primero.
- **DADO un flujo con dos triggers, el genérico `payment_status_changed` (sin filtros) y el atajo "Pago cobrado", CUANDO un pago pasa a cobrado, ENTONCES el flujo DEBE iniciarse UNA sola vez** (test de `pickCanonicalTrigger` y test de integración que procesa el evento con los dos triggers).
- **DADO un flujo con "Pago creado" y "Pago cobrado", CUANDO se crea un pago ya cobrado (dos eventos con el mismo `change_id`), ENTONCES el flujo DEBE iniciarse UNA sola vez, procese el cron los eventos en el orden que sea** (test que procesa en los dos órdenes).
- CUANDO se procesa dos veces el mismo `automation_events`, el flujo DEBE iniciarse una sola vez.
- CUANDO un pago pasa de cobrado a programado (revertir), DEBE dispararse `payment_status_changed` con `from_status 'paid'`, y un flujo filtrado "→ Cobrado" NO DEBE correr.
- CUANDO el barrido marca 30 pagos, DEBEN existir 30 eventos con claves distintas y un flujo "→ Moroso" DEBE correr una vez por pago.
- DADO un pago que vence el 26/10 y un trigger "3 días antes a las 09:00", el job DEBE tener `run_at` el 23/10 09:00 **en la zona del workspace**; DADO un pago creado hoy que vence mañana, NO DEBE crearse.
- CUANDO se reprograma, el job anterior DEBE quedar `cancelled` y existir uno nuevo con el `reschedule_count` nuevo; CUANDO se cobra, sus relativos pendientes DEBEN quedar `cancelled`; CUANDO el job corre y el pago ya está cobrado, NO DEBE emitir.
- `presetFor('payment_status_changed', {to_status:['paid']})` DEBE devolver "Pago cobrado"; con `{to_status:['paid','overdue']}`, el genérico.
- Los tests existentes del registro (`lib/flow-engine/registry/*.test.ts`, incluido `consistency.test.ts`), de `lib/scheduling/automation/*` y de `lib/jobs/*` siguen en verde.
- Test: `lib/sales/automation/triggers.test.ts`, `canonical.test.ts`, `relative.test.ts` y `presets.test.ts` pasan; `verify-sales.mjs --block 4` cubre los eventos reales (`from_status`/`to_status`) de cobrar, revertir, moroso y cancelar.

#### F38: Flujos precreados de cobranza
**Descripción:** si `workspaces.sales_auto_create_flows = true` (default), `ensureSalesTemplateFlows(workspaceId)` (idempotente por `flows.template_key`) crea **apagados** cuatro flujos, al terminar B4 para los workspaces existentes y al crear un workspace nuevo:

| `template_key` | Trigger guardado | Pasos |
|---|---|---|
| `payment_reminder_3d` | `payment_before_due`, `offset_days: 3`, 09:00 | Enviar email: "Tu próximo pago de {{sale.product_name}} vence el {{payment.due_date}}. Si ya lo hiciste, ignorá este mensaje; si tenés dudas, respondé este email." |
| `payment_due_today` | `payment_before_due`, `offset_days: 0`, 09:00 | Enviar email: recordatorio del día |
| `payment_overdue_3d` | `payment_after_due`, `offset_days: 3` | Enviar email + condición "tiene WhatsApp" → mensaje por el canal WhatsApp |
| `sale_settled_thanks` | `sale_status_changed` con el preset **Venta saldada** (`to_status: ['paid']`) | Enviar email de agradecimiento |

- Los textos viven en `lib/sales/automation/templates.ts`, en español con voseo, **sin link de pago** (es de la Fase 2). Se editan como cualquier flujo.
- `payment_before_due` con `offset_days: 0` es el único caso permitido en 0 (el selector de la persona va de 1 a 30).
- **Respetan `do_not_contact`**: es cobranza, no una reunión que el contacto pidió.
- El toggle "Crear flujos de cobranza" vive en Ajustes > General > Ventas.

**Criterios:**
- CUANDO la opción está activa, DEBEN existir los 4 flujos, todos **apagados** (`status = 'draft'` y triggers inactivos); correr `ensureSalesTemplateFlows` dos veces NO DEBE duplicarlos.
- CUANDO la opción está apagada, NO DEBE crearse ninguno.
- CUANDO se publica `payment_reminder_3d` y hay pagos programados a más de 3 días, DEBEN crearse sus jobs.
- CUANDO el contacto tiene `do_not_contact`, estos flujos NO DEBEN enviar.
- `sale_settled_thanks` DEBE guardarse como `sale_status_changed` con `to_status ['paid']` (no como un tipo `sale_settled`, que no existe).
- Test: `lib/sales/automation/templates.test.ts` pasa.

**Bloque 4 listo cuando:** F27 a F38 cumplen sus criterios; `npx vitest run` sale 0 (incluidos los tests existentes del flow registry, de `lib/scheduling/automation`, de `lib/jobs` y `lib/cron-config.test.ts` sin modificar); `npm run build` compila; `npm run lint` sin errores nuevos; `verify-sales.mjs` (completo) y `verify-audit-visibility.mjs` (extendido) salen 0; las migraciones 00164 a 00167 están aplicadas; y el **borrado diferido está escrito en `docs/pendientes/drop_content_offers.sql` (fuera de `supabase/migrations/`), no aplicado**, y anotado en `docs/PENDIENTE.md` con sus cuatro pasos (§1b.5).

### Definición de "listo" de la Fase 1

- `docs/PROGRESS.md` tiene los **4** bloques y **F1 a F38 + F26b** marcados.
- Salen 0: `npx vitest run`, `npm run build`, `npm run lint` (sin errores nuevos), `node scripts/verify-rls.mjs`, `verify-sales.mjs`, `verify-audit-visibility.mjs`, `verify-content.mjs`, `verify-crm.mjs`, `verify-attribution.mjs`, `verify-csv-import.mjs`, `verify-scheduling.mjs` y los `verify-*.mjs` de Llamadas y Formularios.
- Ningún test que pasaba en el punto de partida se rompió; en particular: Contenido (productos), Ajustes (pestañas y permisos), `member-baseline` (cambiado a propósito solo con las 3 claves), flow registry, jobs y crons.
- Están creados o actualizados: `docs/ventas.md` (modelo, estados, cómo se deriva el estado, cómo se mide el desfase, los 6 triggers y sus presets, y por qué un cambio dispara una sola vez), `docs/flow-registry.md`, `docs/PENDIENTE.md` (el borrado diferido y lo que haya quedado), `CLAUDE.md` (sección Ventas Fase 1 y próxima migración libre) y la bitácora.

---
## 8. Flujos principales

1. **Configurar** (Ajustes, con `settings.manage`): Productos → producto → variante → versión con precio → publicar (F3–F6); los productos que ya existían vienen migrados con su precio · métodos habilitados en General > Ventas (F7) · Reglas de asignación (F13–F16) · tope de descuento, gracia de mora y flujos precreados (General > Ventas).
2. **Entra un lead** (bandeja, agenda o formulario): `recordTouch` actualiza `contacts.attribution` → el trigger `contacts_enqueue_sales_eval` encola `sales_contact_eval` (si hay alguna regla no manual) → `resolveAssignments` → escribe lo que corresponde → `assignment_changed` (trigger existente) + auditoría con actor sistema (F9, F15). La ficha del contacto muestra su último toque y quién lo asignó (F12).
3. **Cargar una venta a mano** (desde Ventas, desde el contacto o desde una agenda): asistente de 3 pasos (en el paso 1, la atribución = último toque, editable) → cuadre validado en el servidor → `create_sale` en una transacción (copia congelada del toque en `sales.attribution` + venta + pagos + estado calculado una vez + eventos + auditoría) → relativos agendados (F18–F22, F37).
4. **Enviar el contrato:** ficha de la venta → "Enviar contrato" → formulario de contrato → link firmado con `sale_id` → el cliente firma → `contract_signatures.sale_id` → la ficha lo lista → `contract_signed` (F26b).
5. **Cobrar:** `markPaymentPaid` → snapshot + comisión congelada + comprobante → trigger: `payment_status_changed (scheduled → paid)` → recálculo de la venta → si cambió, `sale_status_changed` (p. ej. `pending_payment → reserved`, o `→ paid` = venta saldada) (F29, F23, F37).
6. **Mora:** pg_cron horario → `enqueue_payments_overdue_sweep()` encola un job por workspace y día local (desde las 03:00 locales) → el cron `jobs` corre el handler → `scheduled → overdue` una sola vez → `payment_status_changed` + venta `→ overdue` (F30).
7. **Recordatorios:** al crear o reprogramar un pago, jobs `payment_relative_trigger` por cada flujo publicado con `payment_before_due`/`payment_after_due`; al cobrarse o anularse, se cancelan (F37).
8. **Un flujo reacciona:** el cron de automatizaciones toma el evento → los triggers de ventas filtran por config → `pickCanonicalTrigger` deja pasar un solo par por flujo y cambio → `trigger_fires` con clave por cambio → `executeFlow` con las variables `sale.*`/`payment.*` (F37).

**Ejemplo (alcance 3.6):** se cobra la reserva de una venta de 1.297. El pago pasa de *Programado* a *Cobrado* (evento A) y la venta de *Con pago pendiente* a *Reservada* (evento B, otro `change_id`). Un flujo "Pago cobrado → mandar recibo" corre por A; uno "Venta → Con mora → avisar al vendedor" no corre. Un flujo con "Cambió el estado del pago" **y** "Pago cobrado" corre **una vez**.

---

## 9. Modelo de datos

> Todas las tablas nuevas: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE`, `created_at` y `updated_at timestamptz NOT NULL DEFAULT now()` (trigger `set_updated_at` → `update_updated_at()` existente), RLS habilitada. Dinero `numeric(12,2)`. Moneda `text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD')`. Ninguna tabla de este módulo tiene DELETE por RLS (salvo `source_attribution_rules`).

### 9.1 Catálogo (00158)

**`products`**
| Columna | Tipo | Notas |
|---|---|---|
| `name` | `text NOT NULL` | CHECK largo 1–120 tras `btrim`. Único `(workspace_id, lower(btrim(name))) WHERE archived_at IS NULL` |
| `description` | `text` | |
| `product_type` | `text NOT NULL DEFAULT 'otro'` | CHECK `programa, mentoria, curso, servicio, otro` |
| `display_order` | `int NOT NULL DEFAULT 0` | |
| `status` | `text NOT NULL DEFAULT 'active'` | CHECK `status IN ('active','inactive','discontinued')` (los mismos 3 estados de `content_offers`, 00134). Solo `active` se ofrece en los selectores |
| `archived_at` | `timestamptz` | CHECK `products_status_archived_check`: `(status = 'active') = (archived_at IS NULL)` |
| `created_by`, `updated_by` | `uuid` → `auth.users ON DELETE SET NULL` | |

Índices: `(workspace_id, status, display_order)`. **El `id` de los productos migrados es el de `content_offers`.**

**`product_variants`**
| Columna | Tipo | Notas |
|---|---|---|
| `product_id` | `uuid NOT NULL` → `products ON DELETE RESTRICT` | |
| `name` | `text NOT NULL` | "Estándar" en los migrados |
| `duration_type` | `text NOT NULL` | `days, weeks, months, lifetime` |
| `duration_value` | `int` | CHECK: `lifetime ⇒ null`, si no `> 0` |
| `guarantee_duration_type` | `text` | `days, weeks, months` o null |
| `guarantee_duration_value` | `int` | Junto con el anterior |
| `billing_type` | `text NOT NULL DEFAULT 'one_time'` | `one_time, recurring` |
| `billing_interval` | `text` | `monthly, quarterly, yearly`; CHECK `recurring ⇒ not null`, `one_time ⇒ null` |
| `display_order` | `int NOT NULL DEFAULT 0` | |
| `archived_at` | `timestamptz` | |

Índice `(product_id, archived_at, display_order)`. **CX suma columnas acá en su propia migración** (no se reservan ahora). **La Fase 2 suma las de Whop y de opciones de cobro.**

**`product_versions`**
| Columna | Tipo | Notas |
|---|---|---|
| `product_variant_id` | `uuid NOT NULL` → `product_variants ON DELETE RESTRICT` | |
| `version_number` | `int NOT NULL` | Único `(product_variant_id, version_number)` |
| `price` | `numeric(12,2) NOT NULL CHECK (price >= 0)` | CHECK `price = 0 ⇒ change_notes IS NOT NULL` |
| `currency` | `text` | `'USD'` |
| `change_notes` | `text` | |
| `capabilities_config` | `jsonb NOT NULL DEFAULT '{}'` | Reservado (CX Fase 2) |
| `status` | `text NOT NULL DEFAULT 'draft'` | `draft, active, deprecated`. **Único parcial `(product_variant_id) WHERE status = 'active'`** |
| `published_at`, `published_by`, `deprecated_at` | | |

**`workspaces.enabled_payment_methods`** `text[] NOT NULL DEFAULT ARRAY['whop','transferencia_cr','transferencia_usa','wise','binance']`.

**Funciones:** `publish_product_version(p_version_id uuid, p_actor_id uuid)` (solo `service_role`). **Puente (00159):** `content_offers_bridge_to_products()` + trigger `content_offers_bridge` (lo borra el borrado diferido).

### 9.2 Asignación (00160)

**`assignment_rules`**: `kind text NOT NULL` CHECK (`setter, vendedor, referral`) — **sin `source`**; `entity_type text NOT NULL DEFAULT 'contact'` (CHECK `contact`; reservado para `booking` y `sale`), `mode text NOT NULL DEFAULT 'manual'` (`manual, round_robin, condition_based`), `enabled_member_ids uuid[] NOT NULL DEFAULT '{}'`, `last_assigned_member_id uuid`, `condition_rules jsonb NOT NULL DEFAULT '[]'` (`[{id, name, priority, conditions: {conditions:[{field, operator, value}], groups:[{conditions[], conjunction}], rootConjunction}, destination:{type:'user'|'contact'|'round_robin', user_id?, contact_id?, members?, last_index?}, can_reassign, is_active}]`, validado con Zod en `lib/sales/conditions-schema.ts`), `updated_by`. **Único `(workspace_id, kind, entity_type)`.**

**`contacts`** (aditivas): `referred_by_user_id`, `referred_by_contact_id`, `assignment_locked_at`, `payment_health jsonb NOT NULL DEFAULT '{}'`. Trigger nuevo `contacts_enqueue_sales_eval` (F9). **No se agrega `source_id`:** la atribución del contacto sigue siendo la canónica (`contacts.attribution` + `contact_touches`), sin tocar.

**`workspaces`** (aditivas): `max_discount_percent numeric(5,2)`, `overdue_grace_days int NOT NULL DEFAULT 0 CHECK (overdue_grace_days BETWEEN 0 AND 30)`, `sales_auto_create_flows bool NOT NULL DEFAULT true`. Función y trigger `seed_sales_defaults()` en `workspaces` (AFTER INSERT): 3 filas de `assignment_rules` en `manual`. **No se agrega `default_source_id`.**

### 9.3 Ventas (00161)

**`sales`**
| Columna | Tipo | Notas |
|---|---|---|
| `contact_id` | `uuid NOT NULL` → `contacts ON DELETE RESTRICT` | |
| `product_version_id` | `uuid NOT NULL` → `product_versions ON DELETE RESTRICT` | |
| `product_snapshot` | `jsonb NOT NULL` | Ver abajo |
| `base_amount`, `discount_amount` (default 0), `final_amount` | `numeric(12,2) NOT NULL` | CHECK `final_amount = base_amount - discount_amount` y `final_amount >= 0` |
| `discount_reason` | `text` | |
| `currency` | `text` | `'USD'` |
| `status` | `text NOT NULL` | CHECK con los 9 estados (F17) |
| `financing_type` | `text NOT NULL` | `full, reservation_balance, installments, reservation_installments, subscription` |
| `subscription_interval` | `text` | `monthly, quarterly, yearly`; solo si `subscription` |
| `sale_date` | `date NOT NULL` | "No futura" se valida en `create_sale` (un CHECK con `current_date` no es inmutable) |
| `setter_id`, `vendedor_id` | `uuid` → `auth.users ON DELETE SET NULL` | |
| `attribution` | `jsonb` | **Copia congelada** del toque (F10): `{touch_id, occurred_at, source, medium, campaign, content, term, ad_id, adset_id, campaign_id, fbclid, gclid, referrer_url, landing_page}`. Null si `attribution_type = 'none'`. **No cambia** cuando el contacto recibe toques nuevos |
| `attribution_touch_id` | `uuid` → `contact_touches ON DELETE SET NULL` | El toque copiado (null si fue cargado a mano sin toque, o sin atribución) |
| `attribution_type` | `text NOT NULL DEFAULT 'none'` | CHECK `('last_touch','manual','none')`; CHECK `(attribution_type = 'none') = (attribution IS NULL)` |
| `booking_id` | `uuid` → `bookings ON DELETE SET NULL` | F24 |
| `service_starts_at` | `date` | **Reservada para CX** (en esta fase solo se carga y se edita) |
| `notes` | `text` | |
| `plan_unbalanced` | `bool NOT NULL DEFAULT false` | |
| `cancelled_at`, `cancelled_by`, `cancellation_reason` | | |
| `subscription_cancelled_at`, `subscription_cancel_reason` | | |
| `refunded_at` | `timestamptz` | |
| `opportunity_stage`, `stage_entered_at` | `text`, `timestamptz` | **Reservadas sin uso** (pipeline futuro) |
| `created_by`, `updated_by` | `uuid` | |

**`product_snapshot`:** `{product_id, product_name, product_type, variant_id, variant_name, version_id, version_number, price, currency, duration_type, duration_value, billing_type, billing_interval, guarantee_duration_type, guarantee_duration_value}`.

Índices de expresión: `(workspace_id, (attribution->>'source'))` y `(workspace_id, (attribution->>'campaign'))` (filtros del listado y condiciones de flujo).

**No se crean ahora:** `source_id`, `source_assignment_type` (fase futura: catálogo de fuentes, §17); `external_membership_id`, `checkout_currency`, `checkout_payment_methods` (Fase 2).

### 9.4 Pagos (00161)

**`payments`**
| Columna | Tipo | Notas |
|---|---|---|
| `sale_id` | `uuid NOT NULL` → `sales ON DELETE RESTRICT` | |
| `type` | `text NOT NULL` | `full, reservation, installment, refund` |
| `amount` | `numeric(12,2) NOT NULL` | CHECK de signo según `type` |
| `currency` | `text` | `'USD'` |
| `status` | `text NOT NULL` | `scheduled, paid, overdue, uncollectible, refunded, cancelled`. **`refunded` no se usa en la Fase 1** (CHECK `payments_no_refunded_status_phase1`): un reembolso es otra fila `type='refund'`, `status='paid'`, monto negativo |
| `due_date` | `date` | |
| `original_due_date` | `date` | Se escribe al crear (= `due_date`) y no cambia (trigger) |
| `reschedule_count` | `int NOT NULL DEFAULT 0` | Sube con cada reprogramación (clave de los relativos) |
| `paid_at` | `timestamptz` | |
| `paid_on` | `date` | Fecha local del cobro en la zona del workspace |
| `delay_days` | `int GENERATED ALWAYS AS (paid_on - original_due_date) STORED` | |
| `payment_method` | `text` | CHECK con las 5 claves de F7 |
| `payment_option_snapshot` | `jsonb` | `{method_key, method_name, provider_fee_percent, provider_fee_fixed}` al cobrar |
| `provider_fee_amount` | `numeric(12,2)` | **Comisión congelada al cobrar.** Gastos la suma por método y mes sobre `status = 'paid'`. Null en las filas `refund` y en lo no cobrado |
| `receipt_path` | `text` | Ruta en `payment-receipts` |
| `notes`, `reschedule_reason`, `uncollectible_reason`, `refund_reason`, `revert_reason` | `text` | |
| `refund_of_payment_id` | `uuid` → `payments` | En los reembolsos, opcional |
| `created_by`, `updated_by` | `uuid` | |

Índices: `(sale_id)`, `(workspace_id, status, due_date)`, `(workspace_id, paid_at)`, **`(workspace_id, payment_method, paid_at) WHERE status = 'paid'`**.

**No se crean ahora** (Fase 2): `processor_payment_id`, `whop_payment_id`, `whop_payment_intent_id`, las columnas `autocharge_*`.

**Funciones y triggers de la 00161:** `can_see_sale`, `can_see_sale_id`, `derive_sale_status`, `refresh_sale_status`, `create_sale`, `emit_sales_event`; triggers `payments_protect_original_due_date` (BEFORE UPDATE), `payments_refresh_sale_status` (AFTER INSERT/UPDATE), `payments_emit_status_change` (AFTER INSERT/UPDATE OF status), `sales_emit_status_change` (AFTER UPDATE OF status), `set_updated_at` en las dos. Índice nuevo en `scheduled_jobs` por `payload->>'payment_id'`.

### 9.5 Cambios en tablas existentes

| Tabla | Cambio | Migración | Tipo |
|---|---|---|---|
| `content_ideas`, `content_posts` | FK `offer_id` → `products(id) ON DELETE SET NULL` | 00159 | **Modifica estructura existente** |
| `content_offers` | Trigger puente; sin uso; DROP diferido | 00159 / borrado diferido | Modifica / **Borra (no se aplica)** |
| `contacts` | 4 columnas + trigger nuevo | 00160 | Aditiva |
| `workspaces` | 4 columnas + trigger de precarga | 00158, 00160 | Aditiva |
| `scheduled_jobs` | Índice por `payment_id` | 00161 | Aditiva |
| `form_submissions`, `contract_signatures` | FK de `sale_id` → `sales ON DELETE SET NULL` + índice `(sale_id) WHERE sale_id IS NOT NULL` en cada una | 00162 | Modifica estructura (suma FK) |
| `submit_form_response` (de Formularios) | v4: valida el `sale_id` firmado y lo suma al payload de los eventos de formulario | 00163 | **Modifica lógica existente** |
| `triggers` | CHECK de `type` + 6 valores | 00165 | Modifica estructura existente |
| `audit_log` | Política adicional `audit_log_select_sales` (no toca `audit_log_select`) | 00167 | Aditiva |
| `storage.buckets` | `payment-receipts` | 00164 | Aditiva |
| `cron.job` + `private` | `payments-overdue-enqueue` → `private.enqueue_payments_overdue_sweep()` | 00166 | Aditiva |

**No se tocan:** `audit_log` (columnas, las creó Llamadas), `scheduled_jobs.status` (ya admite `cancelled`), `integration_configs`, `webhook_events`.

---

## 10. Arquitectura

```
Internas (sesión + permisos)
/dashboard/ventas              (lista · pastillas)          ─┐
/dashboard/ventas/[id]         (ficha · plan · contratos)    │ Server Actions (requirePermission
/dashboard/ventas/pagos        (pagos)                       │  + alcance) → cliente de servicio
/dashboard/settings/productos  (+ /[id] → variante: Precio)  │  → RPC solo service_role
/dashboard/settings/asignacion · /actividad                  │
/dashboard/settings            (sección Ventas)             ─┘
              │
lib/sales ── catalog/{products,variants,versions,price-history} (puros)
         ├── payment-methods, fees (puros)
         ├── attribution (puro: copia del toque, manual, línea legible; sobre readAttribution / contact_touches)
         ├── assignment/{context,conditions,round-robin,resolve,dry-run} (puros)
         ├── sale-math, payment-plan, sale-status (puros + espejo SQL)
         ├── overdue, delay, payment-health (puros)
         ├── wizard/{step1,summary}, list, payments-list, payment-table (puros de pantalla)
         ├── contract (F26b), permissions (canSeeSale)
         ├── create (→ RPC create_sale)
         └── automation/{triggers,presets,canonical,relative,templates}
lib/flow-engine/registry/sales-triggers.ts · sales-conditions.ts · (acciones)
lib/jobs/handlers/{sales-contact-eval, payment-relative}.ts
private.enqueue_payments_overdue_sweep() ◄── pg_cron cada hora → scheduled_jobs → cron `jobs` → lib/jobs/handlers/payments-overdue-sweep.ts
Supabase: products, product_variants, product_versions, assignment_rules, sales, payments
          (+ contacts, contact_touches [solo lectura], workspaces, contract_signatures)
          triggers SQL: estado derivado, eventos por cambio (change_id), puente content_offers
automation_events ──► /api/cron/automation-events (sin cambios) ──► registro ──► flows
Storage: payment-receipts (privado)
```

**Principios:**
- **La plata se decide en céntimos.**
- **El servidor decide:** cuadre, descuento, versión activa y alcance.
- **El estado de la venta se deriva** (salvo los 4 escritos), con espejo SQL y test de paridad.
- **Un cambio de estado = un evento**, emitido en la base, con `from_status`/`to_status` y `change_id`.
- **Una transacción por operación de negocio:** crear venta, publicar versión.
- **Nada se borra:** ventas se cancelan, pagos se anulan, productos se archivan, versiones se deprecian.
- **La atribución de una venta se congela al crearla:** los reportes no se mueven solos cuando el contacto recibe toques nuevos.
- **La comisión se congela al cobrar** y es la que lee Gastos.

---

## 11. Storage

**Bucket nuevo `payment-receipts`** (00164), privado.
- Ruta `{workspace_id}/{sale_id}/{payment_id}/{uuid}.{ext}`; tipos `image/jpeg`, `image/png`, `image/webp`, `application/pdf` (se valida el tipo real por los primeros bytes en el servidor, no solo la extensión); **10 MB**.
- Sin policies para `authenticated`: subir y leer pasan por Server Actions con el cliente de servicio, después de `requirePermission` + `can_see_sale`. URL firmada de **60 s**.
- Retención permanente mientras exista la venta (las ventas no se borran). No se adjuntan a emails.
- Supabase Pro alcanza de sobra: un comprobante pesa < 1 MB y hay decenas por mes.

---

## 12. Stack y decisiones técnicas

| Decisión | Elección | Por qué |
|---|---|---|
| Dinero | Enteros de céntimos en la lógica, `numeric(12,2)` en la base | Tres cuotas de 416,67 tienen que cerrar 1.250 |
| Estado de la venta | Derivado (función pura + espejo SQL + trigger) | Un estado escrito a mano se desincroniza el primer día |
| Eventos de estado | Triggers de Postgres que comparan `OLD.status` y `NEW.status` | Es la única forma de que **todo** cambio (acción, job, flujo) genere exactamente un evento |
| Idempotencia de triggers | Clave por `change_id` + `pickCanonicalTrigger` por flujo | La clave por entidad (la de agendas) dispararía una sola vez en la vida; sin la regla por flujo, dos triggers del mismo flujo correrían dos veces |
| Escrituras | Server Action (`requirePermission` + alcance) → cliente de servicio → RPC `service_role` | `has_permission` en SQL no conoce al Member de sistema (§3.2) |
| Desfase | `paid_on date` escrita por el servidor + `delay_days` generada | Una columna generada no puede leer la zona del workspace |
| Mora | pg_cron horario → función SQL que encola un job por workspace y día local → handler del cron `jobs` | Con zonas distintas por workspace, una hora fija UTC marca a destiempo; y `call_app_cron` no admite rutas nuevas |
| Transacciones | Funciones plpgsql por RPC | El cliente de Supabase no sostiene una transacción entre llamadas |
| Fechas | `date-fns` + `Intl` (lo que ya usa el sistema) | Sin dependencias nuevas |
| Métodos de pago | Constante en código + `enabled_payment_methods` | Cinco filas que no cambian; el snapshot conserva la historia |
| Absorber `content_offers` | Mismo id + mover FK + puente temporal | Ninguna referencia se reescribe; el código viejo sigue andando en la ventana del deploy |
| Comprobantes | Storage privado + URL firmada corta | Dato financiero |
| Atribución de la venta | Copia congelada (jsonb) del toque de `contact_touches` + FK al toque + tipo; sin catálogo de fuentes | Decisión de Wendy: solo UTMs. El jsonb conserva el dato aunque el toque se purgue, y los índices de expresión bastan para filtrar |

---

## 13. Pantallas detalladas

### 13.0 Convenciones globales
- Barra superior con título e ícono ⓘ (`PageHeader`), como el resto del sistema; en Ajustes, `SettingsTabs`.
- **Estados en toda pantalla nueva:** skeleton (`loading.tsx`), vacío con acción (`SettingsEmptyState` en Ajustes), error con "Reintentar" (`ActionError`) y toast de éxito.
- **390 px:** sin scroll horizontal; las tablas pasan a cards con los datos principales; los modales a pantalla completa.
- **Textos:** español con voseo, sin jerga.
- **Dinero:** `$1.297,00`, a la derecha en tablas; negativos (reembolsos) en rojo y entre paréntesis. Formateo en `lib/sales/format.ts` (una sola función).
- **Fechas** en la zona del workspace; vencimientos con "vence en 3 días" / "venció hace 5 días".
- **Chips de estado:** un color por estado en todas las pantallas (`lib/sales/status-colors.ts`), con etiqueta en castellano (`lib/sales/labels.ts`: Con pago pendiente, Reservada, Pagada, Con mora, Suscripción activa, Cancelada, Reembolsada, En disputa, Suscripción cancelada; Programado, Cobrado, Moroso, Incobrable, Reembolsado, Anulado).

### 13.1 Ventas (`/dashboard/ventas`)
- Barra: conmutador **Ventas | Pagos**, filtros y "+ Nueva venta". Sin ⚙.
- Pastillas → tabla (F25). Vacío, cargando y error según 13.0.
- **Modal "Nueva venta":** 3 pasos con indicador; la línea de cuadre siempre visible en el paso 3; el resumen "Qué va a pasar" antes de guardar. En 390 px, pasos a pantalla completa con "Atrás / Siguiente" fijos abajo.

### 13.2 Ficha de la venta (`/dashboard/ventas/[id]`)
- Encabezado con saldo destacado y acciones (Editar, Cancelar, Reembolso, Enviar contrato) según permisos.
- Secciones (acordeón en móvil): Datos · Plan de pagos (F28) · Contratos (F26b) · Historial · Comprobantes.
- Venta no visible o inexistente → 404 propio ("Esta venta no existe o no tenés acceso").

### 13.3 Pagos (`/dashboard/ventas/pagos`)
- Totales del filtro arriba (cantidad, monto, bruto / comisión / neto), pastillas, tabla con acciones en línea. Modal de cobrar con subida de comprobante (barra de progreso, error por tamaño o tipo).

### 13.4 Ajustes
- **Productos:** lista (F3) → detalle del producto con sus variantes → variante con pestañas (**Precio**: versión activa, borrador, historial de precios). Aviso arriba la primera vez: "Tus productos de Contenido ya están acá, con su precio."
- **Reglas de asignación:** tres tarjetas (Setter · Vendedor · Referido); constructor de condiciones; probador y simulación.
- **Actividad:** tabla con filtros (solo admin).
- **General → sección Ventas:** tope de descuento (%), días de gracia (0–30), métodos habilitados (casillas, con el aviso de pagos programados que usan uno deshabilitado), "Crear flujos de cobranza" (toggle).

### 13.5 Contacto y agenda
- **Ficha del contacto:** sección **Ventas** (sus ventas con estado y saldo, "+ Nueva venta"), **Salud de pago** (F31) y la línea de último toque y asignación (F12, con "asignado a mano" si hay `assignment_locked_at`).
- **Ficha de la agenda:** sección **Ventas** con link o "Cargar venta" (F24).

---

## 14. Guía de UI

- Diseño actual del sistema (Tailwind 4, `components/ui`, `components/settings/*`, `PageHeader`).
- Se reutilizan: tabla con filtros en la URL, buscador de contactos, `SettingsTabs`, `SettingsEmptyState`, `ActionError`, el modal de pasos del asistente de agendar, y **el constructor de condiciones del flow builder**, extraído a `components/conditions/` si todavía vive dentro del builder (uno solo para atribución y asignación, con otro catálogo de campos).
- El selector de triggers del flow builder suma la sección **Ventas y pagos** con los atajos de F37 arriba y los genéricos abajo.

---

## 15. Seguridad

**Autenticación:** la existente (Supabase Auth). Todas las pantallas y Server Actions de este módulo exigen sesión y `requirePermission`. No hay rutas públicas nuevas (el link del contrato es de Formularios y ya tiene su defensa).

**RLS por tabla:**

| Tabla | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| `products`, `product_variants`, `product_versions` | Miembros del workspace | `has_permission(settings.manage)` (owner/admin) | Bloqueado |
| `assignment_rules` | Miembros | `settings.manage` | Bloqueado (fila fija por `kind`) |
| `sales` | `can_see_sale(sales.*)` | Solo servidor (`service_role`) | **Bloqueado** |
| `payments` | `can_see_sale_id(sale_id)` | Solo servidor | **Bloqueado** |
| `contacts` (columnas nuevas) | La RLS existente de `contacts` | Las existentes (`payment_health` y `assignment_locked_at` los escribe el servidor) | Sin cambios |
| `contract_signatures` | La de Formularios (sin cambios) | La de Formularios | Sin cambios |
| `audit_log` | Según F35 | Sin cambios | Bloqueado |
| `storage.objects` en `payment-receipts` | Sin policy (solo servidor + URL firmada) | Sin policy | Sin policy |

**Funciones:** todas con `SET search_path = ''`. Las que escriben (`create_sale`, `publish_product_version`, `refresh_sale_status`, `emit_sales_event`) con `REVOKE` de `PUBLIC`, `anon`, `authenticated` y `GRANT` a `service_role`. `can_see_sale*` `STABLE SECURITY DEFINER`, ejecutables por `authenticated` (las usa la RLS).

**Validación:** Zod en el servidor para todo input (montos, fechas, ids, condiciones, mapeo de prefill). El cuadre, el descuento, la versión activa y el alcance se deciden en el servidor. Los comprobantes se validan por tipo real y tamaño.

**Datos sensibles:** comprobantes por URL firmada de 60 s; los logs no escriben montos con datos del contacto ni emails; el `sale_id` del contrato viaja **dentro** del identificador firmado.

**Dinero:** un pago cobrado no se edita (se revierte con motivo); la versión activa se relee en el servidor; un Member con alcance `own` no puede crear una venta en la que no quede como setter o vendedor.

**Checklist por bloque:**
- [ ] RLS habilitada en tablas nuevas y probada con `verify-sales.mjs` (Owner y Member reales)
- [ ] `requirePermission` + chequeo de alcance en toda Server Action nueva
- [ ] RPC que escriben: solo `service_role`
- [ ] Validación Zod en el servidor (cuadre, descuento, versión activa)
- [ ] DELETE bloqueado en ventas, pagos y catálogo
- [ ] Todo monto comparado en céntimos; `Number(x) || 0` al leer de la base
- [ ] Comprobantes privados, tipo real validado, URL firmada corta
- [ ] Nada sensible en logs
- [ ] Test de caracterización de la visibilidad de `audit_log` (`verify-audit-visibility.mjs` extendido) antes de la 00167

---

## 16. Decisiones transversales y casos borde

- **Auditoría:** crear, editar y cancelar ventas; cobrar, revertir, reprogramar, marcar incobrable, reembolsar y agregar pagos; crear, archivar y restaurar productos y variantes; publicar y depreciar versiones; crear y editar reglas de asignación; **editar la atribución de una venta** (valor anterior y nuevo); cada asignación automática; enviar un contrato; cada acción de flujo sobre ventas. Siempre con `actor_type` y `actor_label`.
- **Nada se borra** (salvo borradores de versión). El purgado de 30 días **no** alcanza a ninguna tabla de este módulo.
- **Deduplicación de contactos:** alta manual con `find_contact_by_phone_or_email` (teléfono primero, después email, como `create_booking`; se lee `.contact_id` y, si es null, se inserta el contacto en la Server Action); lo que entra por un canal sigue con `find_or_link_contact`. Nunca por nombre.
- **Snapshot de precios:** la venta guarda la foto del producto y la versión; el pago guarda la foto del método y su comisión.
- **Estados:** venta (9) y pago (6) como en §F17/§F27. Transiciones del pago: `scheduled → paid | overdue | cancelled`; `overdue → paid | scheduled (reprogramar) | uncollectible | cancelled`; `paid → scheduled | overdue (revertir)` (un reembolso **no** cambia el estado del pago: es otra fila); `uncollectible → scheduled | overdue`. Cualquier otra se rechaza (función pura `canTransitionPayment(from, to)`).
- **Zona horaria:** instantes en UTC; vencimientos `date` interpretados en la zona del workspace; mora, desfase, "hoy" y relativos en esa zona.
- **Modelo de asignación:** setter y vendedor en el contacto (manual, round robin o por condiciones) y copiados a la venta (editables). Lo manual bloquea lo automático (`assignment_locked_at`).
- **Motor de automatización:** triggers por evento y relativos por `scheduled_jobs`; lo único periódico nuevo es el pg_cron que encola el barrido de mora (sin ruta de cron nueva).
- **Casos borde:**
  - La versión activa cambia con el asistente abierto → `version_changed` con el precio nuevo (F22).
  - Un pago se cobra el día en que el barrido lo iba a marcar moroso → gana el cobro (el `UPDATE … WHERE status='scheduled'` ya no lo encuentra).
  - Cambio de precio que descuadra → `plan_unbalanced` + "Rearmar el plan" (F26).
  - Dos personas editan la misma venta → gana el último guardado, con aviso si `updated_at` cambió.
  - Una persona sale del workspace → sus ventas conservan el id (FK `SET NULL` solo si se borra el usuario de Auth); las reglas que la tenían como destino se marcan "destino inválido".
  - Alguien crea un producto desde un código viejo después de la 00159 → el puente lo copia (F3).
  - Un flujo con el genérico y el atajo → corre una vez (F37).
  - El barrido marca 30 pagos → 30 eventos, cada uno con su clave.
  - Se revierte un cobro → `payment_status_changed paid → scheduled|overdue`; Gastos recalcula la comisión del mes (es su lógica).
  - Una firma llega con un `sale_id` de otro contacto → se guarda sin `sale_id` (F26b).
  - El navegador se cierra a mitad del asistente → no queda nada escrito (el borrador vive en el cliente).
  - El contacto recibe un toque nuevo después de la venta → `sales.attribution` **no cambia** (copia congelada); recalcular a mano queda fuera.
  - El contacto no tiene toques → venta con "Sin atribución" (`attribution_type 'none'`), sin bloquear; se puede cargar a mano.
  - Se borra (o purga) el toque copiado → `attribution_touch_id` queda null por la FK; la copia en `sales.attribution` se conserva.
  - Llega un toque nuevo mientras el asistente está abierto → `create_sale` toma el más reciente **al guardar**, no el que se mostró (la línea del paso 1 es informativa); si la persona eligió un toque puntual, se respeta ese.

---

## 17. Fuera de alcance

**Fase 2 de Ventas, en pausa** (se retoma después de Gastos; todo se suma con migraciones **aditivas**: columnas nullable nuevas, tablas nuevas, CHECKs ampliados con la lista completa vigente):

| Bloque | F | Qué era | Qué agrega a la base cuando vuelva |
|---|---|---|---|
| B5 Receptor de webhooks y mapeo | F39–F45 | Endpoints configurables, firma, captura, mapeo de datos | `webhook_endpoints`, `inbound_webhooks` |
| B6 Integración de Whop | F46–F48 | Card, API key en Vault, modo pruebas | CHECK de `integration_configs.type` + `'payment_processor'` |
| B7 Enlace y creación automática | F49–F54 | Plan ↔ variante, ventas automáticas, reservas, suscripciones | 7 columnas `whop_*` en `product_variants`; `payments.whop_payment_id` (único parcial); `sales.external_membership_id` |
| B8 Link de pago | F55–F57 | Generar link, puente, atribución del cobro | `payment_links` |
| B9 Conciliación | F58–F64 | Cobros del procesador, vincular, reembolsos y disputas | `processor_payments`; `payments.processor_payment_id` |
| B10 Cobro automático | F65–F70 | Opciones de cobro, tarjeta guardada, cobro fuera de sesión | `checkout_*` en `workspaces`/`product_variants`/`sales`; 8 columnas `autocharge_*` en `payments`; 6 de medio de pago en `contacts` |
| B11 Página de pago propia | F71–F73 | Checkout embebido | — |

**Fase futura: catálogo de fuentes con reglas** (salió de esta fase por decisión de Wendy, 10/10; se suma con migraciones aditivas):

| Qué | Qué agrega cuando vuelva |
|---|---|
| Catálogo de fuentes (Meta Ads, Orgánico, Referido…) con su pantalla | Tabla `sources` |
| Reglas de atribución que traducen los UTMs a una fuente, con probador | Tabla `source_attribution_rules` |
| Fuente sugerida en el contacto y "recalcular fuentes" | `contacts.source_id` |
| Fuente por defecto del workspace | `workspaces.default_source_id` |
| Fuente de la venta (heredada / manual / por defecto) | `sales.source_id`, `sales.source_assignment_type` (se puede backfillear desde `sales.attribution`) |
| Asignación automática de la fuente | `kind 'source'` en el CHECK de `assignment_rules` |
| Recalcular la atribución de ventas existentes desde los toques actuales | Acción manual auditada |

**Además, fuera de esta fase:** pipeline y comisiones de vendedores (las columnas `opportunity_stage`/`stage_entered_at` quedan reservadas); multimoneda; varios productos por venta; cotizaciones; facturación fiscal; intereses o recargos por mora; conciliación bancaria; importar ventas por CSV; que el agente IA cargue ventas; afiliados; atribución multi-toque con pesos; reglas de asignación para agendas o ventas; reasignación masiva; dashboard comercial; marcar "en disputa" a mano (el estado existe, la acción llega con la Fase 2); **todo lo de CX** (servicio, plantilla de fases, pestaña "Servicio" de la variante); **todo lo de Gastos** (solo se deja `provider_fee_amount` y su índice).

---

## 18. Verificación en vivo (con Wendy, después de construir; no es parte de "listo")

1. Abrir Ajustes > Productos y ver los 3 productos de antes (Scaling Systems Academy, Scaling Systems B2B, BusinessXcelerator) con su precio. Abrir una pieza de Contenido clasificada con uno y verificar que lo sigue mostrando; clasificar otra con un producto nuevo.
2. Crear un producto con dos variantes, publicar una versión de cada una, cambiar el precio de una y ver la anterior depreciada en el historial.
3. Cargar una venta a un contacto que vino de un anuncio y ver en el paso 1 "Atribución: último toque — instagram / paid_social / …"; elegir otro toque del historial en otra venta; cargar una tercera a un contacto sin toques y verla como "Sin atribución". Después, que el contacto reciba un toque nuevo y comprobar que la atribución de la primera venta **no cambió**. Filtrar el listado por utm campaign.
4. Poner el setter en "Por condiciones" (campaña contiene el nombre del setter) y el vendedor en round robin. Mandar un lead de prueba con esa campaña y ver quién queda asignado y qué dice el historial.
5. Cargar una venta con reserva + 4 cuotas desde la ficha de una agenda "asistió": no deja guardar hasta que cuadra, y la venta queda atada a la agenda.
6. Enviar el contrato desde la venta por WhatsApp, firmarlo desde el celular y verlo en la sección Contratos de la venta.
7. Cobrar la primera cuota con un comprobante, dos días después del vencimiento: chip "+2 d", comisión calculada.
8. Con un flujo "Pago cobrado → email de recibo" publicado, cobrar otra cuota y recibir el email **una sola vez** (aunque el flujo tenga también el genérico "Cambió el estado del pago").
9. Dejar una cuota sin cobrar y, al día siguiente, verla morosa, la venta "Con mora" y la pastilla.
10. Reprogramarla: "vence" muestra las dos fechas y el desfase se sigue midiendo contra la original.
11. Publicar `payment_reminder_3d` y verificar que llega el recordatorio 3 días antes.
12. Con un usuario Member: no ve ventas ajenas ni Ajustes > Productos; en una venta propia ve el historial completo, incluido lo del job de mora.

---

## 19. Si algo bloquea

- **La 00159 falla la consulta de control** (un huérfano, un producto duplicado): no aplicar el cambio de FK; dejar las tablas nuevas, revisar la fila, anotar en `docs/PENDIENTE.md`. **No** seguir con F3 hasta que dé 0.
- **Algún lector de `content_offers` no aparece en la lista de §3.2** (lo encuentra el test estático de F3): pasarlo a `products` en el mismo bloque.
- **Formularios no dejó `form_submissions.sale_id` o `contract_signatures.sale_id`:** la 00162 la crea (`uuid NULL`) además de la FK, y se anota la divergencia.
- **`signFormLink` no acepta `saleId`** (Formularios lo planea con `saleId`): sumarle ese parámetro opcional en este bloque, con su test, sin cambiar los links existentes, y anotarlo.
- **La definición vigente de `submit_form_response` no coincide con el plano de Formularios** (otro nombre, otra firma, o el envío de contratos no pasa por ahí): la 00163 se escribe sobre la función que realmente guarda `form_submissions.sale_id` (la que haya), con la misma regla, y se anota la divergencia.
- **Llamadas no dejó `<Historial/>` o los helpers de auditoría:** crearlos acá con la forma de §0.1 (columnas, índice, helpers, componente) **en la primera migración libre de la banda**, y anotarlo como conflicto con Llamadas. No se duplica si existen con otro nombre: se usan.
- **La política adicional cambia lo que ve alguien hoy** (el baseline da distinto para un `entity_type` previo): no aplicar la 00167; resolver el historial de ventas con una función `SECURITY DEFINER` `sale_audit_entries(p_sale_id)` que verifique `can_see_sale_id` y devuelva las filas; anotarlo.
- **El CHECK de `triggers.type` tiene valores que no figuran en ningún documento:** se conservan (se lee de la base, nunca de memoria).
- **`pickCanonicalTrigger` resulta caro** (muchos triggers por flujo): cachear por evento dentro de la corrida del cron vía `args` si el registro lo permite; si no, anotarlo y medir. No se toca el drenaje sin aprobación.
- **`private.enqueue_payments_overdue_sweep` no puede leer `workspaces.timezone` o el job no se procesa:** revisar el registro de handlers de `lib/jobs/registry.ts`; **nunca** sumar una ruta a la lista blanca de `call_app_cron` ni tocar `lib/cron-config.test.ts`.
- **Formularios no dejó `find_contact_by_phone_or_email`:** crearla en la primera migración libre de la banda **con la firma y la semántica de Formularios** (`(p_workspace_id uuid, p_phone text, p_email text) RETURNS jsonb {contact_id, matched_by, conflict_contact_id}`, `STABLE`, solo `service_role`, **no crea contactos**), y anotarlo como conflicto con Formularios.
- **Test de caracterización que revela un comportamiento distinto** (Contenido, Ajustes, Member, auditoría): gana el comportamiento actual; ajustar y anotar.
- **Nunca quedarse en un loop:** después de un intento serio, anotar en `docs/PENDIENTE.md` y seguir.

---

## 20. Chequeo de sincronía con el alcance (v7.1) y con el plano v1.1

**Divergencias respecto del alcance v7.1:**
- **Fuentes (cambio de Wendy, 10/10):** el alcance §2.3 dice que "las reglas de atribución leen la forma canónica" y §9.2 lista `sources` y `source_attribution_rules`. Acá **no se crean**: la venta se atribuye solo con UTMs (copia congelada del último toque). El catálogo de fuentes con reglas pasa a fase futura. **Conviene actualizar el alcance** (§2.3, §9.2 y §9.3: sin `sources`, sin `source_attribution_rules`, sin `contacts.source_id`/`workspaces.default_source_id`; con `sales.attribution`, `attribution_touch_id`, `attribution_type`).
- **Tablas:** el alcance (§9.3) dice que `workspaces` suma `enabled_payment_methods` y las demás — coincide. El alcance no menciona `contacts_enqueue_sales_eval` ni los índices nuevos: son detalle técnico.
- **Triggers:** el alcance lista 11 filas (con atajos); acá son **6 tipos guardados + 5 presets**, como pide la decisión 160 y las convenciones. "Venta saldada" es el preset `sale_status_changed → paid`.
- **"Nacer en un estado cuenta como cambiar a ese estado desde null":** el alcance no lo decía. Se decidió para que "Pago cobrado" y "Venta saldada" funcionen también con pagos y ventas que nacen así (§21).
- **Mora:** el alcance dice "job diario"; coincide: es **un barrido diario por workspace**, desde las 03:00 de su zona; lo encola cada hora una función SQL (`private.enqueue_payments_overdue_sweep`) y lo procesa el cron `jobs`.
- **Productos:** el alcance dice "cada producto pasa a variante Estándar y versión 1 activa con su precio" — coincide; se suma el caso "sin precio" (versión en borrador).

**Respecto del plano v1.1 (lo que cambió y por qué):**
- F2: **3 claves** (el viejo decía 10); sin `can_reconcile`; **sin backfill** de roles en la base (los permisos del Member viven en código, §3.2).
- F3: la pantalla es la existente `/dashboard/settings/productos`; absorbe `content_offers`; **conserva los 3 estados** (Activo, Inactivo, Discontinuado) con el desplegable por fila y el contador de piezas (el v1.1 solo tenía archivado); **nombre único** entre activos (el viejo permitía duplicados).
- F4: sin sección "Cobro por Whop".
- **B2 (decisión de Wendy, 10/10, "solo UTMs"):** salen `sources`, `source_attribution_rules`, las pantallas de Fuentes, el probador de fuentes, "recalcular fuentes", `contacts.source_id`, `workspaces.default_source_id`, `sales.source_id`, `source_assignment_type` y el `kind` `source`. F10–F12 se **reutilizan**: F10 = funciones de atribución de la venta (copia congelada del último toque, otro toque, manual, sin atribución), F11 = componente de atribución, F12 = línea de último toque y asignación en el contacto.
- F14: atribución canónica (`first_touch`/`last_touch`), `combined` en lugar de `utm_combined`.
- F15: lo dispara un trigger nuevo en `contacts` que encola `sales_contact_eval` (en el v1.1 era un evento `contact_attribution_changed` que nadie emitía).
- F17/F18/F22/F25/F26/F37: `sales.attribution` (jsonb congelado), `attribution_touch_id`, `attribution_type`; filtros, condiciones, payloads y variables `sale.utm_*` en lugar de fuente.
- F17: crea `sales` **y** `payments` (B3 los necesita); sin columnas de Whop.
- F23: eventos de estado desde la base, con `change_id`; sin `draft`.
- F24: completo (la Etapa 4 está construida) y con "Cargar venta" desde la agenda.
- F26: sin "cobros del procesador vinculados"; suma "Cancelar suscripción".
- **F26b nueva.**
- F27: `paid_on` + `delay_days` generada sobre `paid_on` (la expresión del viejo no era posible); sin `whop_payment_id` ni `processor_payment_id`.
- F30: pg_cron horario que **encola** un barrido por workspace y día local (desde las 03:00 locales), procesado por el cron `jobs`; sin ruta de cron nueva (`call_app_cron` tiene lista blanca).
- F33: sin la pastilla "Sin conciliar".
- F34: se reduce a **usar** lo de Llamadas.
- F35: política adicional `audit_log_select_sales` (no reescribe `audit_log_select`); el test es el `verify-audit-visibility.mjs` de Llamadas, extendido.
- F18: alta de contacto con `find_contact_by_phone_or_email` (no `find_or_link_contact`).
- F36: ruta `/dashboard/settings/actividad`.
- F37/F38: 6 tipos + presets; sin `payment.pay_link`; `sale_settled` desaparece como tipo.
- Se sacan del plano: `scheduled_jobs` + `cancelled` (ya existe), `integration_configs` + `payment_processor`, todo B5–B11.

**¿Actualizar el alcance?** Recomiendo actualizar el alcance v7.1 con el cambio de atribución (arriba) y sumar a la sección 2.3 dos líneas: "nacer en un estado dispara el cambio desde *sin estado*" y "la mora se barre una vez por día local de cada workspace, desde las 03:00". El resto es detalle de este plano.

---

## 21. Supuestos y decisiones del documento

### 21.1 Decisiones que tomé (no estaban cerradas)

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Decisión 150 ("a confirmar") tomada con la recomendación:** Ventas absorbe `content_offers` con el mismo id | Lo pide el encargo y el alcance la carga así |
| D2 | `products.product_type` de los migrados = `'otro'`; variante "Estándar" `lifetime` + `one_time` | No hay datos para más; Wendy los ajusta en la pantalla |
| D3 | Nombre de producto **único** entre los activos (como `content_offers`), no "advertir y permitir" como el v1.1 | Contenido elige productos por nombre; dos iguales confunden. Las cohortes son variantes |
| D4 | Puente `content_offers → products` mientras conviva la tabla | Permite aplicar la 00159 sin coordinar al segundo con el deploy |
| D5 | `has_permission` no se toca; escrituras por RPC `service_role` detrás de `requirePermission` | Es el patrón real del sistema para el Member de sistema |
| D6 | `paid_on` + `delay_days` generada sobre `paid_on` | La columna generada del v1.1 no era posible |
| D7 | Nacer cobrado / nacer en un estado emite el `*_status_changed` desde `null` | Que "Pago cobrado" y "Venta saldada" sirvan también para lo que nace así |
| D8 | `pickCanonicalTrigger` en el registro para que un flujo corra una vez por cambio | Las convenciones piden que un mismo cambio no dispare dos veces y que el drenaje no se toque |
| D9 | Mora: pg_cron horario que **encola** un barrido por workspace y día local (desde las 03:00), procesado por el cron `jobs` | Hay workspaces en UTC y en Costa Rica, y `call_app_cron` no admite rutas nuevas (corrección del coordinador) |
| D10 | `create_sale` suprime el recálculo por fila y calcula el estado una vez | Evita eventos intermedios falsos durante la creación |
| D11 | Un Member `own` no puede crear una venta donde no sea setter ni vendedor | Si no, crearía algo que después no puede ver |
| D12 | Numeración **F26b** para el contrato | No correr F27–F38, que citan CX y Gastos |
| D13 | Un script nuevo, `verify-sales.mjs` (con `--block N`); la visibilidad del historial se prueba **extendiendo** el `verify-audit-visibility.mjs` que creó Llamadas | El encargo pide `verify-sales.mjs`; no se duplica el script de auditoría |
| D14 | El `whop` queda como método de pago manual en la constante | Wendy cobra por Whop hoy; registrar esos cobros a mano es útil y Gastos necesita la comisión |
| D15 | El borrado de `content_offers` se escribe en `docs/pendientes/drop_content_offers.sql`, sin número, al cerrar B4; toma el número libre siguiente al aplicarse | Pedido del coordinador: no romper el orden ni que `build-all-migrations.mjs` la incluya |
| D16 | Para validar el `sale_id` de los contratos se agrega la **00163** en B3 y se corren las de B4 un número (bucket 00164, CHECK 00165, mora 00166, historial 00167). El coordinador la había nombrado 00168 | El borrado de `content_offers` salió de `supabase/migrations/`, y una 00168 aplicada en B3 antes que las de B4 rompería la regla "en orden, sin saltear" |
| D17 | (Decisión de Wendy) Atribución **solo por UTMs**: `sales.attribution` = copia congelada del último toque; sin catálogo de fuentes | Pedido de Wendy. Los reportes no se mueven solos |
| D18 | El último toque se lee de **`contact_touches`** (fila más reciente, con su `touch_id`); si el contacto no tiene filas (datos anteriores a la 00114), de `readAttribution(contacts.attribution).last_touch` sin `touch_id` | `contact_touches` es la fuente canónica y da el id para la FK; el respaldo cubre contactos viejos |
| D19 | **Elegir otro toque del historial** (además de cargar a mano), guardado como `attribution_type 'manual'` con su `touch_id` | Sugerencia del coordinador: reusa datos reales en vez de tipearlos. El CHECK solo admite `last_touch`, `manual` y `none` |
| D20 | En la carga manual, `source` obligatorio y de la taxonomía cerrada; `medium` opcional de la taxonomía; `campaign`, `content`, `term` libres | Mantener la misma taxonomía que los toques para que los filtros agrupen bien |
| D21 | Los F10–F12 se reutilizan para la atribución en vez de dejar huecos en la numeración | CX y Gastos citan F-números de B3 y B4, no de B2 |

### 21.2 Supuestos que no pude verificar (Claude Code los confirma en la exploración)

> **v1.1:** los puntos 1, 2, 3 (en parte), 4, 5, 6 y 7 quedaron verificados en §0.0. Sigue abierto el 8 (comisión real de Whop: 3 % de arranque). El 9 se confirma en la exploración.

1. **Formularios** (verificado contra su plano, `requerimientos-formularios.md`): dejó `form_submissions.sale_id` y `contract_signatures.sale_id` (nullable, sin FK); `signFormLink({ workspaceId, formId, contactId, serviceId?, saleId? })` en `lib/forms/signed-link.ts`; `submit_form_response` (v3 en la 00156) que guarda `signed_sale_id` sin validar y llama a `record_contract_signature`; y `find_contact_by_phone_or_email` (00155). Falta confirmar en la base que lo construido coincide con el plano (si no, §19).
2. **Llamadas** dejó `audit_log.actor_type`, `actor_label`, el índice, `auditAsSystem({ ...args, label })`, `auditAsWebhook({ ...args, label })` y `<Historial entityType entityId />`, su política adicional sobre `audit_log` y `scripts/verify-audit-visibility.mjs` (o un nombre similar: se extiende el que exista).
3. Los valores del CHECK de `triggers.type` al momento de la 00165 incluyen los de Llamadas (`call_analyzed`, `call_linked`) y Formularios (`form_submitted`, `survey_answered`, `contract_signed`): se leen de la base.
4. Existe una Server Action de asignación manual de setter/vendedor en la ficha del contacto donde agregar `assignment_locked_at` (no la ubiqué por nombre).
5. El alta rápida de producto desde la clasificación de Contenido (`createOffer` o similar en `lib/actions/content-taxonomy.ts`) existe y se puede redirigir a `lib/actions/products.ts`.
6. Formularios dejó `find_contact_by_phone_or_email(p_workspace_id, p_phone, p_email) RETURNS jsonb {contact_id, matched_by, conflict_contact_id}` (`STABLE`, solo `service_role`, no crea contactos; si no, §19).
7. La firma de `eventMatches` en el registro recibe el cliente de Supabase (`args.supabase`) y puede ser `async` (así lo usa el drenaje hoy: `await definition.eventMatches(args)`), lo que permite `pickCanonicalTrigger`.
8. La comisión real de Whop (3 % es un valor de arranque).
9. Que la ficha de la agenda tenga un lugar natural para la sección "Ventas" y el botón "Cargar venta".

### 21.3 Conflictos con las convenciones u otros módulos

- **Ninguno con las convenciones** (tras las correcciones del coordinador: mora por `scheduled_jobs` sin ruta de cron nueva, política adicional `audit_log_select_sales`, alta manual con `find_contact_by_phone_or_email`). Se usan: banda 00158–00169 (se ocupan 00158–00167; el borrado diferido va aparte, en `docs/pendientes/drop_content_offers.sql`), rama `feat/ventas-fase1`, tablas con los nombres fijos, 6 tipos de trigger con presets, 3 claves, rutas `/dashboard/settings/*`, `verify-sales.mjs`, bucket `payment-receipts`.
- **Con CX:** CX va a sumar columnas a `product_variants` y la pestaña "Servicio": este documento deja el detalle de la variante con pestañas y **no** reserva nada de CX salvo `sales.service_starts_at`. CX debería escuchar `payment_status_changed` (→ `paid`) y `sale_status_changed` (→ `cancelled`/`refunded`) desde la base o el registro, no reimplementar el estado.
- **Con Gastos:** `provider_fee_amount` se borra al **revertir** un cobro (vuelve a null). Gastos tiene que recalcular el mes sin asumir que una comisión ya sumada no desaparece (lo prevé su caso raro "se revierte un cobro").
- **Con Formularios:** la 00163 reescribe `submit_form_response` (función de Formularios) para validar el `sale_id` y sumarlo al payload de sus eventos; es un cambio pedido por la revisión cruzada, con la v3 copiada para volver atrás. Formularios no valida el `sale_id`; lo valida Ventas.
