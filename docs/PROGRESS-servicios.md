# PROGRESS — Servicios v12, Corrida A1

> **Base de datos:** toda consulta, migración y verificación contra la base va **solo a producción `knrxjnmx…`** (servidor MCP `23853d12…` o `supabase db query --linked`). Nunca a los otros proyectos conectados al MCP.
>
> **Para retomar:** releer este archivo, la checklist de abajo y `docs/PENDIENTE-servicios.md`; seguir por el primer bloque sin marcar. Antes de cada migración, confirmar el número con `list_migrations` y las ramas locales.

## Checklist de bloques (A1)

- [x] **S0** Seguridad previa: F1, F2, F3, `verify-servicios-migracion.mjs` (8/11)
  - F1: `verify-workspace-isolation --despues-de-00309` en 0 (punto de partida); `create-owner.mjs` ya pasa `ssa_create_workspace`.
  - F2: `verify-auth-settings` sale **1** en producción: el registro público está prendido y "Leaked password protection" apagada. Es de panel: queda en PENDIENTE para Wendy. Paso sumado a `/setup`.
  - F3: `docs/seguridad-despliegue.md`.
  - `verify-servicios-migracion --todas` antes de aplicar nada: verde (huellas iguales).
- [x] **SV1** El servicio: F4, F5, F6, F7, F8, F9, F10, F11, F12, F93, F94, F96, F97, F99 (S01–S05) — frenado en S02 y retomado el 8/11 con la decisión de Wendy; **listo el 8/11**
  - S01 (00330) aplicada y verificada. Esquema `app_servicio` expuesto en la API (`public,graphql_public,app_servicio`), comprobado con `verify-api-schemas --con-app-servicio`.
  - S02 (00331) falló `verify-forms` y se volvió atrás con su cabecera. Rehecha sin las tres claves foráneas (el trigger del módulo valida) y aplicada: `verify-forms` en 0.
  - S03 a S05 (00332 a 00334) aplicadas y verificadas (`verify-sales`, `verify-rls`, `verify-commissions` en 0).
  - `verify-services --bloque sv1`: **0** (69 chequeos: gemelas SQL = TS de los 11 archivos de casos, la guardia SV003, el módulo apagado, la venta sin configurar idéntica, la creación al cobrar, dos pagos a la vez, pago viejo, venta repetida, cancelación y pago revertido, crear a mano SV012/SV013/SV004, visibilidad por rol, confirmar/descartar, renovación y extensión por variante, pausa de 12 días, el enganche que falla no tumba el pago, apagar el módulo y las huellas protegidas).
  - Suite completa en verde (salvo `disconnect-networks`, inestable y ajena: ver PENDIENTE), build compila, lint sin errores nuevos.
  - La pantalla «Importar servicios» va con Clientes en SV3 (la ruta nace ahí); la acción `importServices` y `parseServicesImport` ya están.
- [x] **SV2** El camino: F13, F14, F15, F16, F17, F18, F19, F20, F21, F22, F23, F24, F25 (S06–S07) — **listo el 8/11**
  - S06 (00335) y S07 (00336) aplicadas y verificadas. `verify-services --bloque sv2`: **0** (35 chequeos: el camino se copia al crear, tildar con permiso y alcance, destildar, el avance lo calcula la base, el completado por formulario con paso firmado de otro contacto descartado, avance automático de fase, `service_item_id` inmutable, eventos sin `booking_id`, la tarea de equipo y la reunión completan su paso, el enganche roto no tumba la respuesta, la reunión, la venta ni la tarea, el módulo apagado no completa nada, el historial por servicio y el CHECK de `triggers.type`).
  - Los 5 pasos y los 26 disparadores en Automatizaciones, ocultos con el módulo apagado.
- [x] **PRD** Productos por variante: F114, F115, F116, F117, F31, F32 — **listo el 8/11** (revisión visual pendiente: ver PENDIENTE)
  - Con el módulo prendido: tarjetas de productos, la página del producto (variantes con «Al cobrarse», camino, portal y servicios activos) y la de la variante con Camino del cliente (fases y pasos que se arrastran o se mueven con Subir/Bajar y Alt+↑/↓, el drawer del paso, los workflows de cada lugar), Servicio, Portal (secciones, «En el programa» y el drawer de la regla) y Precio y cobro (lo de siempre). Apagado, Productos es exactamente el de siempre.
  - Lógica pura con test: `service-settings-form`, `journey-editor`, `product-cards`, `variant-portal-form`, `workflow-chips`, `back-to-path`.
  - `verify-services --bloque prd`: **0** (guardar por la API con la sesión, conflicto de versión, `invalid` con problemas, Member sin `services.configure`, `products.portal_enabled` por trigger, sección no disponible, copiar de otra variante con claves nuevas, SV003).
- [x] **SV3** Pantallas de Servicios: F26, F27, F28, F29, F30, F33, F95 — **listo el 8/11** (revisión visual pendiente)
  - `/dashboard/clientes` (Servicios: tabla y tablero, filtros rápidos, agrupar, buscador, paginado de 50, aviso de responsables dados de baja), `/clientes/lista` (Clientes), `/clientes/c/[id]` (ficha del cliente con su actividad y comentarios internos), `/clientes/s/[id]` (ficha del servicio con alertas, acciones según permiso y las pestañas Actividad, Camino y Datos), `/clientes/importar`, el modal «+ Servicio» (regla de la venta en rojo con motivo), las secciones Servicios/Servicio en las fichas del contacto y de la venta, y la columna Servicio de Ventas por el punto de extensión `lib/sales/module-columns.ts`.
  - «Clientes» va en el grupo Ventas del menú (ver PENDIENTE). Las pestañas Accesos, Programa, Asistencia, Entregas y Asistente IA se suman con sus bloques.
  - `verify-services` completo (sv1 + sv2 + prd) para el cierre del bloque.
- [x] **AF** Afiliados y links: F70, F71, F72, F73, F74, F75, F103, F104, F105, F106, F107 (S13) — **listo el 8/11** (revisión visual pendiente; F106 va con el portal en AC)
  - `00343_affiliates` aplicada y registrada. Links del producto (tarjeta Links con los dos principales), códigos que no cambian (AF001/AF004), asignación al entrar por un link con `?ref=` (trigger sobre el toque, que nunca lo tumba), reglas, asignar a mano con motivo, el afiliado de la venta (hereda el del contacto), el destinatario «El afiliado de la venta» en comisiones con «pagar solo la mayor» y editar una comisión a mano.
  - Pantallas: Afiliados (Resumen, Afiliados con el alta de uno externo, Reglas) en el grupo Ventas; Mis links en el menú de usuario; el link corto `/r/<código>/<link>` (público, con tope y `noindex`); el campo Afiliado en las fichas del contacto y de la venta; «Editar» en la ficha de una comisión. Tres disparadores nuevos en Automatizaciones.
  - Gemelas: `product-links`, `affiliate-settings`, `affiliate-assign` y `when-also-seller`, corridas contra la base en `verify-affiliates` (44 comprobaciones en 0). `verify-servicios-migracion --s S13`, `verify-commissions --despues-de-00235`, `verify-contact-merge` y `verify-sales` en 0. Huellas protegidas iguales.
  - Pendiente (ver PENDIENTE): el campo Afiliado en el asistente de venta y «Copiar con mi código» en Formularios y Agenda.
- [ ] **AC** Accesos y cuentas: F34, F35, F36, F37, F38, F39, F40, F41, F42, F43, F44, F109 (S08–S09)
- [ ] **PR** Programa: F45, F46, F47, F48, F49, F50, F51, F100, F101, F102, F112 (S10)
- [ ] **EV** Evaluaciones y actividades: F52, F53, F54, F55, F56, F57, F113 (S11)
- [ ] **CA** Calendario y grabaciones: F58, F59, F60, F61, F62, F63, F64, F65 (S12)
- [ ] **CE** Certificados: F66, F67, F68, F69
- [ ] **CO** Comunidad: F76, F77, F111 (S14)
- [ ] **IA** Tutor: F83, F84, F85, F86, F87, F110 (S15)
- [ ] **X** Cierre: F88, F89, F90, F91, F92, F108 (S16)

## Migraciones (S0x → número real)

**Renumeración del 8/11 (2ª):** otras ramas locales ocupan la `00338` (`purge_stale_unread_notifications`) y la `00339` (`scheduled_time_trigger`), así que **S08 a S12 pasan a la 00340, 00341, 00342, 00344 y 00345; S13 queda en la 00343; S14 a S16 van de la 00346 a la 00348**. Numéricamente la S13 (00343) queda antes que la S11 (00344): no nombra nada de S08 a S12, así que un clon nuevo las aplica en orden sin problema. Antes, la `00337` también la ocupó otra sesión (`00337_email_guard_fast_time_zone`, 8/11). Antes, la `00329` la ocupó otra sesión (`00329_contact_qualification`, aplicada el 8/11 a las 07:15 UTC, mientras se armaba este plan). Por eso **S01–S16 van de la 00330 a la 00345** (la tabla del plan, más abajo, decía 00329–00344). Si otra sesión ocupa un número antes de aplicar, se corre el resto y se anota acá.

| Id | Número | Archivo | Bloque | Estado |
|---|---|---|---|---|
| S01 | 00330 | `00330_app_servicio_core.sql` | SV1 | **aplicada y registrada** (8/11, versión `20261108082600`); `verify-servicios-migracion --s S01`, roles, rls y workspace-isolation en 0 |
| S02 | 00331 | `00331_app_servicio_journey_tables.sql` | SV1 | 1ª versión: falló `verify-forms` y se volvió atrás. **Rehecha sin claves foráneas en `form_submissions.service_id`, `form_submissions.service_item_id` y `contract_signatures.service_id` (decisión de Wendy, 8/11), aplicada y registrada** (versión `20261108135352`); `--s S02` y `verify-forms` en 0 |
| S03 | 00332 | `00332_app_servicio_config_columns.sql` | SV1 | **aplicada y registrada** (versión `20261108135944`); `--s S03`, `verify-sales` y `verify-rls` en 0. Corregida el mismo día (los validadores sumaban un texto a una lista sin `::text`); reaplicada y el SQL registrado es el corregido |
| S04 | 00333 | `00333_app_servicio_engine.sql` | SV1 | **aplicada y registrada** (versión `20261108140551`); `--s S04` en verde |
| S05 | 00334 | `00334_app_servicio_sales_triggers.sql` | SV1 | **aplicada y registrada** (versión `20261108140802`; corregida el mismo día: `sale_hook` declara `record`); `--s S05` y `verify-commissions` en 0; `verify-sales` en 0 en la 2ª pasada (la 1ª se cortó por la CLI, sin relación con la migración) |
| S06 | 00335 | `00335_app_servicio_completion_triggers.sql` | SV2 | **aplicada y registrada** (versión `20261108150155`); `--s S06`, `verify-forms`, `verify-scheduling` y `verify-tasks` en 0. Corregida el mismo día (`booking_hook` declara `record`, ver PENDIENTE) |
| S07 | 00336 | `00336_app_servicio_audit_and_triggers_check.sql` | SV2 | **aplicada y registrada** (versión `20261108151119`); `--s S07` y `verify-audit-visibility --despues-de-00168` en 0 |
| S08 | 00340 | `00340_app_servicio_portal_accounts.sql` | AC | pendiente |
| S09 | 00341 | `00341_app_servicio_portal_access.sql` | AC | pendiente |
| S10 | 00342 | `00342_app_servicio_program.sql` | PR | pendiente |
| S11 | 00344 | `00344_app_servicio_portal_forms.sql` | EV | pendiente |
| S12 | 00345 | `00345_app_servicio_calendar.sql` | CA | pendiente |
| S13 | 00343 | `00343_affiliates.sql` | AF | **aplicada y registrada** (8/11, versión `20261108161154`), después de ensayarla en una transacción que se deshizo sola; `--s S13` en 0 |
| S14 | 00346 | `00346_app_servicio_community.sql` | CO | pendiente |
| S15 | 00347 | `00347_app_servicio_tutor.sql` | IA | pendiente |
| S16 | 00348 | `00348_app_servicio_merge_and_cron.sql` | X | pendiente |

## Punto de partida (8/11/2026)

- **Dependencias:** el `node_modules` de esta carpeta era del 13/10 y le faltaban `fflate`, `frimousse` y `sanitize-html` (124 archivos de test en rojo por eso). Después de `npm ci`:
- **`npx vitest run`:** 1426 archivos, **18.954 tests, todos en verde**.
- **`npm run build`:** compila. Ojo: regenera `public/embed/embed.js` con otro minificado aunque nada cambió; se vuelve atrás (`git checkout -- public/embed/embed.js`) salvo que se toque `lib/attribution` o `lib/embed`.
- **`npm run lint`:** 0 errores, 37 advertencias.
- **Huellas y foto de la base:** `docs/servicios/punto-de-partida.json` (las 8 protegidas coinciden con `scripts/protected-functions.mjs`).
- **Tests de caracterización:** los que ya existían cubren el cobro y la venta (`lib/actions/payments.test.ts`, `lib/sales/payments-rules.test.ts`, `lib/actions/sales-create.test.ts`, `lib/sales/create.test.ts`), el envío de un formulario (`lib/forms/submit.test.ts`, `submit-form-response-diff.test.ts`, `signed-link.test.ts`), la reserva (`lib/scheduling/booking/create.test.ts`), la firma (`lib/actions/sales-contract.characterization.test.ts`, `lib/forms/contract/*`), completar una tarea (`lib/tasks/core.test.ts`, `complete-from-automation.test.ts`), la fusión (`lib/contacts/merge.test.ts`), el menú (`lib/nav/menu-by-role.characterization.test.ts`), los permisos del Member (`member-baseline`, `access-matrix.characterization`, `member-sql-parity`, `member-permissions-characterization`) y el registro de jobs (`lib/jobs/bootstrap-characterization.test.ts`). Nuevo: `lib/services/characterization/screens-baseline.characterization.test.ts` (columnas de Ventas, acciones y permisos de Productos, la pestaña de precio, las secciones de la ficha de la venta y del contacto).
- **`verify-*`:** 46 corridos de a uno con el candado. 42 en 0; los 4 que fallan ya fallaban en `main` y no son de esta rama (ver la nota de cada uno).

| Verify | Flags | Resultado | Nota |
|---|---|---|---|
| rls | `--despues-de-00143 --despues-de-00208 --despues-de-00313 --despues-de-00314` | 0 (125s) |  |
| roles | `--despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212 --despues-de-00249 --despues-de-00301` | 1 → 0 (91s) | 1ª pasada falló porque esta carpeta no tenía la CLI vinculada (`supabase/.temp`); copiada de la carpeta principal, 2ª pasada en 0. |
| audit-visibility | `--despues-de-00168` | 1 → 0 (217s) | Igual que roles: 2ª pasada en 0. |
| workspace-isolation | `--despues-de-00143 --despues-de-00309` | 0 (11s) |  |
| permissions-matrix | `--despues-de-00212` | 0 (212s) |  |
| sales | — | 0 (120s) |  |
| commissions | `--despues-de-00235` | 0 (83s) |  |
| forms | — | 0 (265s) |  |
| scheduling | `--despues-de-00290` | 0 (39s) |  |
| booking-concurrency | — | 0 (7s) |  |
| tasks | — | 0 (162s) |  |
| contact-merge | — | 1 (95s) | **Ya fallaba antes de esta rama**: la `00329` (otra sesión) creó `contact_qualification_changes` con `contact_id` y no la sumó a `merge_contacts` ni a `CONTACT_MERGE_TABLES`. No es de Servicios; no puede empeorar. |
| contacts-single-entry | — | 0 (29s) |  |
| designer | — | 0 (215s) |  |
| calls | `--despues-de-00300 --despues-de-00301 --despues-de-00303 --despues-de-00304 --despues-de-00307 --despues-de-00308` | 0 (59s) |  |
| expenses | `--despues-de-00233` | 0 (82s) |  |
| organic-attribution | `--despues-de-00234` | 0 (70s) |  |
| ads-attribution | — | 0 (169s) |  |
| meta-capi | — | 0 (10s) |  |
| cron-guards | — | 0 (16s) |  |
| account | `--despues-de-00275` | 0 (8s) |  |
| attribution | — | 1 (20s) | **Ya fallaba**: un dato de producción (3292 de 3412 contactos con `first_touch`), no código. No puede empeorar. |
| broadcasts | — | 0 (11s) |  |
| chat-awaiting | — | 0 (32s) |  |
| chat-core | — | 0 (132s) |  |
| chat-media | — | 0 (15s) |  |
| contact-pipeline | — | 0 (16s) |  |
| content | `--despues-de-00253` | 0 (23s) |  |
| crm | — | 0 (13s) |  |
| csv-import | — | 0 (7s) |  |
| dashboards | — | 0 (13s) |  |
| email-subscription | — | 0 (43s) |  |
| enrichment | — | 0 (6s) |  |
| eod | — | 0 (66s) |  |
| flow-metrics | — | 0 (7s) |  |
| flow-runs | — | 0 (15s) |  |
| inbound-webhooks | — | 0 (41s) |  |
| inbox-filters | — | 0 (10s) |  |
| knowledge | — | 0 (4s) |  |
| message-persistence | — | 0 (6s) |  |
| optout | — | 0 (8s) |  |
| payment-methods | — | 0 (23s) |  |
| publishing | — | 1 (35s) | **Ya fallaba**: el caso D3 de Zernio simulado. No puede empeorar. |
| unidentified-contacts | — | 0 (11s) |  |
| whatsapp-groups | — | 0 (16s) |  |
| student-schema | — | 1 (27s) | **Ya fallaba**: compara contra la poda local de la plantilla. No puede empeorar. |

---

# El plan aprobado (8/11/2026), tal cual

# Plan de la Corrida A1 de Servicios v12

Rama `feat/servicios-a1`, que sale de `main` en `a6d5350`. El plano es `claude/v12/requerimientos-v12-servicios.md` v1.8.
Se construyen los bloques S0, SV1, SV2, PRD, SV3, AF, AC, PR, EV, CA, CE, CO (solo comunidad), IA y X, en ese orden.
No se construye nada de la Corrida B (portal) ni de la C (bloque PY, SX1, `app_servicio_proyectos`).

## 1. Contexto

Cada variante de un producto puede crear el servicio del cliente al cobrarse, o extender el que ya tiene. El servicio trae su camino, su semáforo y sus accesos al portal.
Desde SSA se configura y se sigue todo lo del portal: programa, evaluaciones, calendario, certificados, comunidad y tutor.
Cualquier persona puede traer ventas como afiliado con los links de cada producto.

Todas las reglas viven en la base, cada una con su gemela en TypeScript. Es un cambio sobre un sistema en producción, así que lo primero es no romper nada.

**Decisiones de Wendy del 8/11 en esta sesión:**
- **Esquema de la API (cambio del 8/11, reemplaza al anterior).** Apenas S01 esté aplicado y verificado, yo sumo `app_servicio` a los esquemas expuestos de producción (`knrxjnmx…`) por la Management API, con el token de la CLI. Es **el único cambio de configuración de producción autorizado**. Los pasos están en SV1 (§7). También actualizo `supabase/config.toml` en el repo. `app_servicio_portal` **no** se expone nunca.
- **Referido de Ventas.** `contacts.referred_by_*` y la regla "Referido" (00161) **conviven sin tocarse** con los afiliados nuevos. La idea de unificarlos queda en `PENDIENTE`.

## 2. Punto de partida (medido el 8/11, solo lectura)

- **Migraciones.** La última del repo es la `00328_meta_capi` y la última aplicada en producción (`knrxjnmx…`) también es la `00328`. **La próxima libre es la 00329.** La 00291 está reservada (`automation_runs`) y la 00295 quedó sin usar.
- **`npx vitest run`.** Dio 124 archivos y 27 tests en rojo, pero **por el entorno, no por el código**. El `node_modules` de esta carpeta (y el de la principal) es del 13/10, y le faltan `fflate`, `frimousse` y `sanitize-html`. Se arregla con `npm ci` en esta carpeta (paso 0). La medida que vale es la de después del `npm ci`.
- **`npm run lint`.** 0 errores y 37 advertencias.
- **`npm run build` y los `verify-*`.** Todavía no se corrieron: build escribe archivos y los verify escriben en la base. Van en el paso 0, con el candado.
- **Huellas.** Las 8 funciones protegidas coinciden en la base con `scripts/protected-functions.mjs`.

| Función | Huella |
|---|---|
| `record_contact_touch` | 2f51ddbf… |
| `find_or_link_contact` | 0aee0354… |
| `find_contact_for_form` | b7b5605c… |
| `find_or_create_contact` | a71d6af7… |
| `submit_form_response` | 78a358d5… |
| `create_booking` | dc462c28… |
| `create_sale` | adb766e6… |
| `resolve_meta_match` | e3c54b36… |

Además se fijan las huellas de estas funciones, que no se tocan:

| Función | Huella |
|---|---|
| `get_public_form` | 213653ea… |
| `private.call_app_cron` | fa1c8e42… |
| `can_see_contact` | e60b52a2… |
| `can_see_sale` | 94424068… |
| `can_see_task` | 366c2d74… |
| `handle_new_user` | 61617095… |
| `has_permission` | e955f005… |

Y las de las que se cambian a propósito: `merge_contacts` 7f27d943…, `commission_payee` ffe87f41…, `generate_commissions_for_payment` 3660acdd… y `private.member_permission_keys` b806cc3b….

Los valores completos van a `docs/servicios/punto-de-partida.json` (paso 0).

## 3. Diferencias entre el plano y el código real (gana el código; regla aplicada)

| # | El plano supone | El código real | Qué hago |
|---|---|---|---|
| D1 | Plata en céntimos | `payments.amount` y `sales.*_amount` son `numeric` en dólares | Lo nuevo guarda céntimos (`price_cents bigint`). Al leer Ventas convierto con `round(amount*100)`, igual que `lib/shared/money.ts`. "Lo cobrado" y la regla `amount` comparan en céntimos. |
| D2 | "Si `sales` guarda la variante…" (F6) | `sales.product_variant_id uuid NOT NULL` | F6 usa siempre esa variante. La rama "venta sin variante" no se dispara nunca, pero queda programada. |
| D3 | "Si `submit_form_response` guarda el `meta`…" (F17) | Lo guarda **sin filtrar**; los ids firmados entran por `p_contact_hint` (`signed_service_id`) | Rama A de F17: el servidor pone el paso verificado en `meta.service_item_id` y el `BEFORE INSERT` lo valida y lo copia. |
| D4 | `bookings` con estado `attended` (F18) | No existe; hay `status_group` = `active / no_show / outcome / cancelled` | `complete_on = attended` = la reunión pasa a `status_group = 'outcome'`. Es el mismo criterio que usan las métricas de anuncios (00195). |
| D5 | Las reuniones guardan las UTM (F18) | `bookings.utm jsonb` existe | Rama A: se respeta `utm.svc_item`, pero solo si el contacto es el del servicio. |
| D6 | `lib/assignment` con gemela SQL (F96) | Solo TS (`pickRoundRobin`, `resolve.ts`) | `svc_pick_owner` implementa la regla en SQL. Comparte casos nuevos con la gemela TS que la reusa: `lib/assignment` + `owner-pick.cases.json`. |
| D7 | `platform.set_module` (F97) | No existe | Creo `app_servicio.set_module_enabled(workspace_id, enabled)` con `EXECUTE` solo para `service_role`. |
| D8 | `registerDesignVariables` / `onDesignGenerated` (CE) | Existen en `lib/designer/extensions.ts`. El aviso sale cuando el render queda `ready` (`jobs/render.ts:332`) | Se usan tal cual, sin tocar el Diseñador. |
| D9 | `design_generate_from_template` en SQL (F67) | No existe; la generación es TS (`createGeneration`) | La SQL encola un job `svc_certificate_issue`. El handler TS llama a `createGeneration` con `subjectRef {module:'servicios', type:'service', id}`. |
| D10 | Plantilla "tipo de documento Certificado" | `design_templates.doc_type` acepta `certificado / constancia / diploma / otro` | Certificado = `doc_type = 'certificado'`. |
| D11 | Anular "con la función del Diseñador" (F69) | `voidDesignCore` existe, pero no hay aviso `onDesignVoided` | F69 llama a `voidDesignCore` desde la acción del módulo. "Volver a emitir" anula y emite. |
| D12 | Ajustes › Productos con "versión activa, borrador, deprecadas, Whop, Crear ventas solas, link de pago" | Un solo precio por variante (`product_variants.price`), con historial en `audit_log`. No hay Whop, ni "Crear ventas solas", ni link de pago | "Precio y cobro" = la pestaña **Precio** + **Historial** de hoy, movidas sin cambios. Lo que no existe no se construye y queda en `PENDIENTE`. |
| D13 | Rutas `/productos/[producto]/variantes/[variante]` | Existe `/dashboard/settings/productos/[id]` | Respeto el prefijo y el parámetro: producto `/productos/[id]`, variante `/productos/[id]/variantes/[variantId]?tab=`. La ficha vieja con pestañas pasa a ser la página del producto, en la misma URL, así que no hace falta redirigir. |
| D14 | Punto de extensión "columnas de módulos" en Ventas | No existe; las columnas están escritas a mano en `sales-list.tsx:260` | F95 lo crea (`lib/sales/module-columns.ts`, vacío en la plantilla) con un test de caracterización de las columnas de hoy. |
| D15 | Menú "⋯" en Grabaciones (F65) | Las filas no tienen menú (`calls-list.tsx:429`) | F65 suma el menú "⋯" con "Agregar al portal" y "Ver en el portal". |
| D16 | "Recalcular pendientes" de Extra I (F107) | No existe | Igual sumo `commissions.edited_manually`. `generate_*` y `revert_commissions_for_payment` nunca pisan una comisión editada. |
| D17 | `rules.cases.json` corre contra `commission_evaluate` | Esa función no existe; la gemela SQL es `commission_payee` + `generate_commissions_for_payment` | Los 113 casos siguen iguales. Los casos nuevos de afiliado y de bajas corren contra esas dos funciones en `verify-commissions`. |
| D18 | `workspace_member_profiles` | Es una **función** (00141/00274), no una tabla | `affiliate_code` va en `workspace_members`, como dice el plano. |
| D19 | Baja de un miembro | `removeTeamMember` **borra** la fila de `workspace_members` | Los avisos de F96 y F105 van con un trigger `AFTER DELETE ON workspace_members`. |
| D20 | `uq` de tareas `cx` | `uq_tasks_auto_source_open` no cubre `cx` | No toco `tasks`. "Se crea una sola vez" lo garantiza `service_items.task_id` bajo el candado del servicio. |
| D21 | `createTaskFromAutomation` admite `cx` | Su tipo es `flow` o `agent` | Las tareas `cx` las inserta la SQL del motor (`source = 'cx'`, `source_ref = 'svc_item:<id>'`). El aviso a quien la tiene a cargo sale por un job `svc_task_notify`, con el mismo texto de Tareas. |
| D22 | `ref` en la atribución del toque (F72) | `contact_touches` no tiene `attribution` ni `ref`; `?ref=` sobrevive solo en `entry_url` (o en `raw.utm` en la Agenda) | El trigger busca el `ref` en `entry_url`; si no está, en `raw->'utm'`; si no, en `landing_page`. |
| D23 | `agent_runs.source` suma `portal_tutor` | También existe el CHECK `agent_runs_agent_only_for_agent_sources` | S15 amplía los dos CHECK, partiendo de `pg_get_constraintdef`. |
| D24 | `ai_threads` con canal `portal` | El CHECK ya admite `portal` y `subject_type = 'product'`; la política del canal no existe | S15 suma solo la política `ai_threads_select_portal` y la de mensajes ya la cubre. |
| D25 | `/f/<slug>` descarta los tipos nuevos | `get_public_form` filtra solo `eod`; `loadPublishedForm` filtra con `isPublicFormType` | Sumo `terms`, `quiz` y `activity` a los no públicos en `lib/forms/fields.ts`. La página y la vista previa consultan el tipo en el servidor antes de mostrar (sin reescribir la función). |
| D26 | El menú tiene banderas de módulo | Hay `NavFlag` (`eod`, `settings`, `inbox`), pero ninguna de módulo | Sumo la bandera `services` (= `workspaces.services_enabled`) y el grupo `servicios`. "Mis links" va como ítem del menú de usuario (`profile-menu.tsx`). |
| D27 | Toast global, kit de tablas, estado vacío genérico | No existen | Reuso `ToastProvider` de Contenido, el patrón de `tasks-table` y `SidePanel` de Tareas, y `EmptyHint`. Sin dependencias nuevas. |
| D28 | `M11` | Libre (existen hasta el M12) | M11 = el Member suma `services.view` (own), `services.items` (own), `portal.view_as` (own) y `affiliates.use`. |
| D29 | Alcances | `SCOPED_MODULES` no tiene `services` | Sumo el módulo y el alcance `services` (own/all), que aplica a `services.view`, `services.items`, `portal.view_as` y `submissions.review`. |
| D30 | `program_items` en el portal y en el registro de jobs | La caracterización de jobs fija la lista exacta | Cada tipo de job nuevo se suma a `bootstrap-characterization.test.ts` en su bloque, con el comentario "Servicios A1". Es la forma prevista de sumar un tipo, no un debilitamiento. |
| D31 | Registro público apagado (F2) | No se sabe desde SQL; la cabecera de la 00309 dice que estaba prendido | `verify-auth-settings` lo mide por la Management API con el token de la CLI. Si no hay token, sale 2 y lo anoto. |

## 4. Migraciones: S0x → número real

Las numero de S01 a S16 en el orden del §2, sin saltear, empezando por la 00329. Las aplico en el orden de los bloques. **Antes de escribir cada una confirmo con `list_migrations` y las ramas locales** que el número siga libre. Si otra sesión ocupa uno en el medio, corro todo el bloque y lo anoto.

| Id | Número | Archivo | Se aplica en | Verificación al aplicar (además de `verify-servicios-migracion --s Sxx`) |
|---|---|---|---|---|
| S01 | 00329 | `00329_app_servicio_core.sql` | SV1 | verify-roles (flags vigentes), verify-rls, verify-workspace-isolation |
| S02 | 00330 | `00330_app_servicio_journey_tables.sql` | SV1 | verify-forms |
| S03 | 00331 | `00331_app_servicio_config_columns.sql` | SV1 | verify-sales, verify-rls |
| S04 | 00332 | `00332_app_servicio_engine.sql` | SV1 | — |
| S05 | 00333 | `00333_app_servicio_sales_triggers.sql` | SV1 | verify-sales, verify-commissions |
| S06 | 00334 | `00334_app_servicio_completion_triggers.sql` | SV2 | verify-forms, verify-scheduling, verify-tasks |
| S07 | 00335 | `00335_app_servicio_audit_and_triggers_check.sql` | SV2 | verify-audit-visibility --despues-de-00168 |
| S08 | 00336 | `00336_app_servicio_portal_accounts.sql` | AC | verify-rls |
| S09 | 00337 | `00337_app_servicio_portal_access.sql` | AC | — |
| S10 | 00338 | `00338_app_servicio_program.sql` | PR | — |
| S11 | 00339 | `00339_app_servicio_portal_forms.sql` | EV | verify-forms |
| S12 | 00340 | `00340_app_servicio_calendar.sql` | CA | verify-scheduling |
| S13 | 00341 | `00341_affiliates.sql` | AF (se aplica antes que S08) | verify-commissions, verify-contact-merge, verify-sales |
| S14 | 00342 | `00342_app_servicio_community.sql` | CO | — |
| S15 | 00343 | `00343_app_servicio_tutor.sql` | IA | verify-rls |
| S16 | 00344 | `00344_app_servicio_merge_and_cron.sql` | X | verify-contact-merge |

**Cada migración:**
- Es idempotente y lleva su cabecera "Cómo volver atrás".
- Lo que reescribe se copia en la cabecera desde la base, leído con `pg_get_functiondef` o `pg_get_constraintdef`, nunca de un archivo viejo.
- Las funciones van `SECURITY DEFINER` (o `INVOKER` donde lo diga el plano), con `SET search_path = ''`, `REVOKE ALL … FROM public, anon` y `GRANT` explícitos (regla 00224 y `migrations-grants.test`).
- **Aplicar:** `supabase db query --linked -f`, registro en `supabase_migrations.schema_migrations`, `node scripts/build-all-migrations.mjs` y su verificación inmediata.
- **Si falla:** paro todo, la vuelvo atrás con su cabecera, compruebo que la base quedó como antes y lo anoto en `PENDIENTE-servicios.md`.

**Dependencias entre migraciones que se resuelven con "puntos vacíos":**
- S04 crea stubs que no hacen nada y S09 los reemplaza con `CREATE OR REPLACE`: `svc_grant_initial_access`, `svc_open_access` y `svc_cut_access`.
- S06 completa formularios, encuestas, contratos, agenda y tareas. S11 le suma actividad y evaluación (`complete_on`), porque las columnas de revisión nacen en S11.
- El trigger de `program_progress` (F19 por módulo o clase) va en S10.
- **Ninguna migración nombra columnas que todavía no existen.** Así, un clon nuevo puede aplicarlas en orden numérico (S13 sigue siendo válida después de la S12). Lo pruebo al final con `simulate-export` y `verify-servicios-migracion --todas`.

## 5. Reglas de toda la corrida

1. **El plano manda; el código real gana donde no coinciden** (§3). Ante un caso nuevo aplico su regla "si X, A; si no, B", sin preguntar, y lo anoto en `PENDIENTE`.
2. **Una migración que falla frena toda la corrida.** Un bloque que se traba por código, tras un intento serio, se anota y sigo solo con los que no dependen de él. Las dependencias son las del §3 del plano: SV1→SV2→PRD→SV3; AF suelto; AC←PRD; PR, CO, IA ← AC; EV y CA ← PR; CE ← SV2; X ← todos.
3. **Lo que no se puede debilitar:** nunca debilito un permiso, un test existente ni una política de RLS para destrabar algo. Nunca desactivo un test.
   - Solo cambian, con su comentario: `member-baseline` y `access-matrix.characterization` (M11), `bootstrap-characterization` (tipos de job nuevos, D30), `consistency.test` (catálogo y CHECK) y `merge.test` (25 tablas; las tablas de los esquemas del módulo entran por el gancho, no por `CONTACT_MERGE_TABLES`).
4. **No toco:**
   - las 8 funciones protegidas y `get_public_form`
   - `private.call_app_cron`
   - `can_see_contact`, `can_see_sale` y `can_see_task`
   - `audit_log_select`
   - `handle_new_user`

   Al cerrar la corrida, las huellas tienen que ser las del punto de partida.
5. **Ninguna tabla nueva en `public`.** Solo las 14 tablas de A1 (7 en `app_servicio`, 7 en `app_servicio_portal`). La configuración va en las columnas del §8.2b y la escriben solo las funciones del módulo (guardia `SV003`).
6. **Gemelas:** toda regla en la base tiene su gemela pura en TS y un `*.cases.json` que corre contra las dos (vitest para TS, `verify-*` para SQL).
7. **Lo automático nunca tumba lo que lo origina:**
   - Todo trigger sobre `payments`, `sales`, `form_submissions`, `contract_signatures`, `bookings`, `tasks`, `workspace_members` y `contact_touches` va con `EXCEPTION WHEN OTHERS` → `RAISE WARNING` + `audit_log` (`svc.hook_failed`) + aviso. Lo pruebo forzando el error.
   - Con `services_enabled = false` (así nace), todo trigger del módulo sale al principio.
   - Un producto sin configurar vende igual: lo compruebo con una venta de punta a punta en `verify-services`.
8. **El módulo se prende solo en el negocio de prueba** (`zz-test-`), con `set_module_enabled` y `service_role`. Nunca en un negocio real. No cambio Railway ni variables de producción. **La única excepción autorizada** es sumar `app_servicio` a los esquemas expuestos de la API, con el procedimiento de SV1.
9. **Permisos:** las claves del §4.1 se suman en las tres capas, con `requirePermission`, `getPermissionAction` y `has_permission` en la política. Nunca `isAdminRole`. Cada bloque suma solo las claves que usa, y la copia SQL del Member se cambia en S01 y S13.
10. **Pantallas:**
    - La lógica va en funciones puras con test: `lib/services/*`, `lib/services/screens/*`, `lib/portal-admin/*`, `lib/program/*`, `lib/affiliates/*`.
    - Drawers en la URL con pushState/replaceState (patrón de Tareas).
    - Gráficos con los SVG propios (`components/dashboards/charts.tsx`), sin sumar recharts.
    - Colores con tokens del tema, sin `dark:`.
    - Arrastrar con HTML5 nativo más Subir/Bajar y `Alt+↑/↓` (patrón de `rule-row.tsx`).
    - Sin dependencias nuevas, con las marcas `@plantilla-quitar(servicios)` (y las de Ventas en afiliados), y con código neutro.
11. **Nada externo de verdad:** ningún test llama a Fathom, Whop, Resend, Meta, Zernio ni a un proveedor de IA. No sumo variables de entorno.
12. **Ritmo:**
    - Después de cada funcionalidad, `npx vitest run`.
    - Después de cada bloque: marcar `PROGRESS-servicios.md`, commit `feat: servicios-a1 - bloque X (nombre)` y `git push origin feat/servicios-a1`.
    - Los `verify-*` van de a uno y con el candado: `mkdir /private/tmp/ssa-verify.lock` para tomarlo y `rmdir` para soltarlo. Si está tomado, espero; nunca suelto uno ajeno.
13. **Base de datos:** toda consulta, migración y verificación va **solo contra producción `knrxjnmx…`** (servidor MCP `23853d12…` o `supabase db query --linked`). Nunca contra los otros proyectos conectados al MCP.
14. **Revisión visual** de cada bloque con pantallas:
    - Con el navegador de la app, a 1440 y 390 px, en claro y oscuro, comparando con `claude/v12/prototipo-v12-panel.html` (sin su panel "Prototipo · datos de ejemplo").
    - Si la app pide login y no hay sesión, lo anoto. Nunca escribo credenciales.

## 6. Paso 0: antes de S0 (lo primero al recibir tu `/goal`)

1. `npm ci` en esta carpeta, sin tocar la carpeta principal.
2. Copiar el `.env` de la carpeta principal a esta, sin abrirlo (está en el `.gitignore` y lo necesitan los `verify-*`).
3. **Medir el punto de partida**, de a uno y con el candado:
   - `npx vitest run`, `npm run build` y `npm run lint`.
   - Cada `verify-*` con sus flags vigentes:

     | Verify | Flags |
     |---|---|
     | rls | `--despues-de-00143 --despues-de-00208 --despues-de-00313 --despues-de-00314` |
     | roles | `--despues-de-00136 --despues-de-00208 --despues-de-00211 --despues-de-00212 --despues-de-00249 --despues-de-00301` |
     | audit-visibility | `--despues-de-00168` |
     | workspace-isolation | `--despues-de-00143 --despues-de-00309` |
     | sales | — |
     | commissions | `--despues-de-00235` |
     | forms | — |
     | scheduling | `--despues-de-00290` |
     | booking-concurrency | — |
     | tasks | — |
     | contact-merge | — |
     | contacts-single-entry | — |
     | permissions-matrix | `--despues-de-00212` |
     | designer | — |
     | calls | `--despues-de-00300 --despues-de-00301 --despues-de-00303 --despues-de-00304 --despues-de-00307 --despues-de-00308` |
     | expenses | `--despues-de-00233` |
     | organic-attribution | `--despues-de-00234` |
     | ads-attribution | — |
     | meta-capi | — |
     | cron-guards | — |
     | el resto de la lista | sin flags |

   - Lo que ya falla se anota en "Punto de partida" y no puede empeorar.
4. **Huellas y foto de la base** en `docs/servicios/punto-de-partida.json`:
   - las huellas del §2;
   - los triggers vigentes de las 8 tablas que se enganchan;
   - los CHECK que se amplían: `triggers.type`, `forms.type`, `agent_runs.source` y `agent_only`.
5. **Tests de caracterización nuevos**, antes de tocar nada. Los que ya existen se corren y se nombran en "Punto de partida":
   - **Cobro y venta:** `lib/services/characterization/payment-sale.characterization.test.ts`. Fija que `markPaidCore` y `createSale` escriben lo mismo (payload de `create_sale`, transición del pago).
   - **Envío de formulario:** `form-submit.characterization.test.ts`. Fija el `p_meta`, el `p_contact_hint` y lo que se manda a la RPC.
   - **Reserva:** `booking.characterization.test.ts`. Fija los parámetros de `create_booking` y el `utm`.
   - **Firma:** `contract-signature.characterization.test.ts`.
   - **Completar tarea:** `task-complete.characterization.test.ts`. Fija el núcleo y la RPC.
   - **Fusión:** se usa `merge.test` (25 tablas) y sumo el texto de `merge_contacts` vigente a la foto.
   - **Menú:** `lib/nav/servicios-menu.characterization.test.ts`. Fija `NAV_ITEMS`, los grupos y los ítems del menú de usuario para Owner, Admin, Member y un rol vacío.
   - **Permisos del Member:** se usan `member-baseline`, `access-matrix` y `member-sql-parity`.
   - **Registro de jobs:** se usa `bootstrap-characterization`.
   - **Pantallas de Productos:** `lib/catalog/products-screen.characterization.test.ts`. Fija las pestañas y acciones de la ficha de hoy, las rutas y los permisos.
   - **Columnas de Ventas:** `lib/sales/list-columns.characterization.test.ts`.
   - **Secciones de las fichas:** `lib/contacts/detail-sections.characterization.test.ts` (contacto) y `lib/sales/detail-slots.characterization.test.ts` (venta).
6. **Documentos:**
   - `docs/PROGRESS-servicios.md`: este plan tal cual, los 14 bloques con sus F como checklist, "Punto de partida" y "Migraciones" (tabla del §4). Arranca con: "Toda consulta, migración y verificación contra la base va solo a producción `knrxjnmx…`; nunca a los otros proyectos del MCP".
   - `docs/PENDIENTE-servicios.md`, con el formato "qué quedó / por qué / qué se decidió". Arranca con D12 y D16, la convivencia con Referido y el paso manual de apagar el registro público.
7. Commit `docs: plan de Servicios A1` y push. **Freno y espero tu `/goal`.**

## 7. Plan por bloque

En cada bloque, "listo" = sus criterios, `npx vitest run` en 0, `npm run build` compila, los `verify-*` del bloque y del área en 0, y la revisión visual si tiene pantallas.

### S0 · Seguridad previa (F1–F3)

- **F1:** `verify-workspace-isolation --despues-de-00309` (ya tiene el caso) y una lectura de `create-owner.mjs`, sin reescribir `handle_new_user`.
- **F2:** `scripts/verify-auth-settings.mjs`. Lee la Management API con el token de la CLI. Sale 1 si el registro público está prendido y 2 si no hay token. Suma el paso a `.claude/commands/setup.md`.
- **F3:** `docs/seguridad-despliegue.md`. El aviso de "Leaked password protection" es una advertencia, no un fallo.
- **Además:** `scripts/verify-servicios-migracion.mjs --s Sxx` y `--todas`. Comprueba los objetos, la RLS, los GRANT y REVOKE, que ninguna función sea ejecutable por anon o public, que los CHECK sigan aceptando los valores viejos y que los triggers no hagan nada con el módulo apagado. También llama a `checkProtectedFunctions`.
- **Sin migración.**
- **Riesgo:** sin el token de la Management API, F2 queda informado y no verde.

### SV1 · El servicio (F4–F12, F93, F94, F96, F97, F99) — S01 a S05

- **S01:**
  - El esquema `app_servicio` (USAGE para `authenticated` y solo lectura), `services`, `can_see_service` y `module_on`.
  - `workspaces.services_enabled` con su guardia `trg_app_servicio_config_guard` (`SV003`) y `set_module_enabled`.
  - `member_permission_keys` suma las claves de M11 del módulo.
  - Las claves de `services.*` y `portal.view_as` en el catálogo, con el alcance `services`.
- **S02:** `service_phases` y `service_items`. Las FK `NOT VALID` y después `VALIDATE` de `form_submissions.service_id` y `contract_signatures.service_id`. Columnas `form_submissions.service_item_id` y `contact_notes.service_id`.
- **S03:**
  - Las columnas de configuración de `workspaces`, `products` y `product_variants`, con sus `*_rev`.
  - Los validadores `validate_*` y sus triggers (`SV001`).
  - El trigger de `products.portal_enabled` y la guardia extendida.
  - Las funciones `svc_save_*` y `portal_admin_save_*`, más el índice único del host.
- **S04:** el motor.
  - Creación: `svc_create_service` (la única entrada), `svc_rule_met`, `svc_rule_check`, `svc_renewal_plan`, `svc_pick_owner`.
  - Camino: `svc_instantiate_journey`, `svc_compute_due`, `svc_try_advance_phase`, `svc_move_to_phase`, `svc_complete_item` y `svc_uncomplete_item`, `svc_generate_occurrences`, `svc_start_challenge`, `svc_compute_light`.
  - Fechas y estados: `svc_extend`, `svc_extend_plan`, `svc_revert_extension`, `svc_pause`, `svc_resume`, `svc_resume_plan`.
  - Responsable: `svc_set_owner`, `svc_bulk_set_owner`.
  - Cierre: `svc_complete`, `svc_cancel`, `svc_confirm_service`, `svc_discard_service`.
  - Los stubs de accesos.
  - `progress_pct` por trigger.
- **S05:**
  - `trg_app_servicio_payment` (AFTER INSERT/UPDATE OF status ON payments) llama a `svc_evaluate_auto_creation`, más lo que pasa al revertir un pago.
  - `trg_app_servicio_sale` (AFTER UPDATE OF status ON sales): cancelación, reembolso total y "la venta cambió".
- **TS:**
  - `lib/services/{settings, auto-creation, renewal, extend, pause, owner-pick, availability, module}.ts`, cada uno con su test.
  - Casos: `service-settings.cases.json`, `auto-creation.cases.json`, `renewal.cases.json`, `extend.cases.json`, `pause.cases.json` y `owner-pick.cases.json`.
  - `single-entry.test.ts`.
  - `lib/actions/services.ts`: `createService`, `confirmService`, `pause`, `resume`, `extend`, `complete`, `cancel`, `setOwner`, `bulkSetOwner`, `importServices` y `saveServiceSettings`.
  - `lib/services/import.ts` (`parseServicesImport`).
- **Esquema expuesto en la API** (inmediatamente después de aplicar y verificar S01; único cambio de configuración de producción autorizado):
  1. Leer con la Management API, con el token de la CLI, la lista vigente de esquemas expuestos de producción (`knrxjnmx…`), y guardarla en `docs/servicios/punto-de-partida.json` (`api_exposed_schemas`).
  2. Escribir la misma lista + `app_servicio` al final, sin quitar ni reordenar nada. `app_servicio_portal` **no** se expone.
  3. Comprobar en el momento, con el usuario de prueba `zz-test-`, que la API responde como antes:
     - una lectura de `public.contacts` por REST con su sesión (la RLS de siempre);
     - una lectura de `app_servicio.services` con su sesión, que respeta la RLS (devuelve solo lo que ese usuario puede ver y rechaza la escritura).
  4. **Si algo falla:** vuelvo a escribir la lista guardada, compruebo que `public.contacts` responde como antes, lo anoto en `PENDIENTE` y sigo con lo que no lee pantallas. SV3 y las demás pantallas que leen `app_servicio` quedan anotadas como trabadas.
  5. **Sin token de la CLI:** lo anoto en `PENDIENTE` y sigo como antes (Wendy lo suma a mano en el panel).
  6. Actualizo `supabase/config.toml` (`[api] schemas`) con la misma lista, en el commit del bloque.
- **Pantalla:** Clientes › Importar servicios. El estado vacío de `/dashboard/clientes` llega en SV3.
- **Verify:** `scripts/verify-services.mjs --bloque sv1`. Cubre la RLS con 5 roles, los casos SQL, la concurrencia de dos pagos, la guardia `SV003`, el módulo apagado, el error forzado del trigger con el pago que queda `paid`, y una **venta de punta a punta sin configurar idéntica a la de hoy**.
- **Riesgos:**
  - S05 es la más delicada (triggers sobre pagos en uso). Mitigación: módulo apagado por defecto, `EXCEPTION`, y `verify-sales` y `verify-commissions` antes y después.

### SV2 · El camino (F13–F25) — S06 y S07

- **S06:** completado automático.
  - `BEFORE` y `AFTER INSERT ON form_submissions` (paso firmado por `meta`, D3).
  - `AFTER INSERT ON contract_signatures`.
  - `AFTER INSERT/UPDATE OF status ON bookings` (D4/D5).
  - `AFTER UPDATE OF status ON tasks`, en las dos direcciones.
  - `AFTER DELETE ON workspace_members` (aviso de responsables, D19).
  - Creación de tareas `cx` (D20/D21).
- **S07:**
  - La política adicional `audit_log_select_services`.
  - El CHECK de `triggers.type` + los 26 del módulo, partiendo del vigente.
  - El link firmado suma `i` (`lib/forms/signed-link.ts`, compatible con lo existente) y el servidor pone `meta.service_item_id`.
- **TS:**
  - `lib/services/{journey-template, due, recurrence, light, advance, completion}.ts`.
  - Casos: `journey-template.cases.json`, `due.cases.json`, `recurrence.cases.json`, `light.cases.json` (≥ 28), `advance.cases.json` (`auto`, `auto_all`, `manual`) y `complete-on.cases.json`.
  - `progress-boundary.test.ts`.
  - Registro: `lib/flow-engine/registry/service-triggers.ts` (los 26 menos `certificate_issued`, que va en CE) y los nodos de 10 acciones ("Emitir certificado" va en CE).
  - Eventos con escalares y nunca `booking_id`.
- **Verify:** `verify-services --bloque sv2`. Incluye el avance con dos conexiones a la vez y el error forzado en cada trigger.
- **Riesgos:**
  - Triggers sobre cinco tablas en uso. Además corro `verify-forms`, `verify-scheduling`, `verify-tasks` y `verify-sales`.

### PRD · Productos por variante (F114–F117, F31, F32) — sin migración

- **Pantallas:**
  - Lista en tarjetas (`/settings/productos`).
  - Página del producto `[id]`, con Variantes y, en AF, Links.
  - Página de la variante `[id]/variantes/[variantId]?tab=camino|servicio|portal|precio`, con migas, "Copiar de otra variante" y "Renombrar".
  - **Camino del cliente:** editor con fases y pasos que se arrastran, ayudas "?", el drawer del paso con "Se completa" y "Semáforo si se vence", y los workflows como línea de chips con su drawer, Pasos e Historial (lee de `flow_session_steps`).
  - **Servicio:** el formulario de los tres modos.
  - **Portal:** el acceso, la tabla de secciones con el drawer de F109 (guarda acá; AC suma el motor) y los términos (los suma EV).
  - **Precio y cobro:** las pestañas Precio e Historial de hoy (D12).
- **TS:**
  - `lib/services/screens/{product-cards, variant-row, journey-editor, service-settings-form, variant-portal-form, workflow-chips}.ts`, con su test.
  - `journey-editor.test.ts`.
  - `lib/portal-admin/variant-accesses.ts`.
  - Acciones: `saveJourneyTemplate`, `copyVariantSetup`, `saveVariantPortal`, `saveProgramSettings` y `createPathWorkflow`.
- **Permisos de pestaña:** `services.configure`, `portal.sections` y `portal.access_rules`. Con el módulo apagado se ve solo Precio y cobro.
- **Verify:** `verify-services --bloque prd`.
- **Revisión visual:** lista, producto, variante y sus 4 pestañas, el drawer del ítem y el drawer del workflow.
- **Riesgos:**
  - Reemplazar la ficha de hoy: los tests de caracterización del paso 0 cuidan que Precio y cobro sea idéntico.
  - Workflow desde el camino: reuso la creación de flujos y la validación de publicación.

### SV3 · Pantallas de Servicios (F26–F30, F33, F95) — sin migración

- **Vistas `security_invoker`:** `app_servicio.services_list`, `clients_list` y `service_detail`, más la función `svc_clients_list` (`SECURITY INVOKER`). Van en S04: si hace falta tocarlas, S04b.
- **Pantallas:**
  - `/dashboard/clientes`: Servicios y Clientes, Tabla y Tablero, filtros en la URL y aviso de reasignar.
  - Ficha del cliente `c/[contactId]`.
  - Ficha del servicio `s/[serviceId]?tab=` con Actividad, Camino, Accesos, Programa, Asistencia, Entregas, Asistente IA y Datos. Las pestañas que llegan con otros bloques se suman en cada uno.
  - El modal "+ Servicio".
  - Las secciones en la ficha del contacto y de la venta.
  - La columna Servicio en Ventas, por el punto de extensión de D14, con el modal en rojo y el modal al registrar un pago.
- **TS:**
  - `lib/services/screens/{list, board, service, client, new-service, sales-cell}.ts`, con su test.
  - Un test de frontera que prohíbe pedir el contacto fila por fila.
- **Menú:** grupo Servicios con Clientes y Portal (bandera `services`).
- **Verify:** `verify-services`.
- **Revisión visual:** Clientes, la ficha del servicio y la columna Servicio en Ventas.
- **Riesgos:**
  - Si el procedimiento de SV1 no pudo exponer el esquema en la API (falló o no había token), las pantallas no leen: queda anotado y sigo con AF.

### AF · Afiliados y links (F70–F75, F103–F107) — S13 (BAIOS, marcas de Ventas)

- **S13:**
  - `products.links` y `links_rev`, con `validate_product_links`.
  - `workspaces.affiliate_settings`.
  - `workspace_members.affiliate_code` y `contacts.affiliate_code`, con unicidad cruzada (`AF001`).
  - Las columnas `affiliate_*` de `contacts` y `sales`.
  - `commissions.contact_id`, `commissions.edited_manually`, `vendors.contact_id`.
  - Reglas de comisión: `on_departure` y `when_also_seller` en `commission_rules`, y la condición `affiliate_kind`.
  - El payee `sale_affiliate` en `commission_payee` y `generate_commissions_for_payment` (copiadas de la base).
  - `public.affiliate_assign`, `affiliate_ensure_code` y `affiliate_referrals`.
  - El trigger `trg_affiliate_touch` (D22).
  - `merge_contacts` copiada de la base, con las referencias de afiliado.
  - El CHECK de `triggers.type` + 3.
  - `member_permission_keys` + `affiliates.use`.
  - El cron `affiliates-daily` por SQL directo (`private.enqueue_affiliates_daily`).
- **TS:**
  - `lib/affiliates/{product-links, assign, url, my-links, summary}.ts`.
  - Casos: `product-links.cases.json` y `affiliate-assign.cases.json` (≥ 14).
  - Casos nuevos en `rules.cases.json` (afiliado, doble comisión, bajas).
  - `lib/commissions/edit.ts`.
- **Pantallas:**
  - La tarjeta Links del producto.
  - `/dashboard/mis-links` (menú de usuario).
  - `/r/[code]/[linkKey]`: ruta reservada nueva, tope de 120/min por IP con `requestIp`/`checkLimit`, `noindex` y nunca 500.
  - "Copiar con mi código" en Formularios y en Agenda.
  - El campo Afiliado en el paso 1 de la venta (segundo paso después de `create_sale`, sin tocarla) y en la ficha del contacto y de la venta.
  - Afiliados: Resumen, Afiliados y Reglas.
  - Finanzas › Comisiones › Editar.
  - El aviso al dar de baja.
- **Verify:** `scripts/verify-affiliates.mjs`, más `verify-commissions` (113 casos iguales + los nuevos), `verify-contact-merge` y `verify-sales`.
- **Revisión visual:** Afiliados, Mis links y Links del producto.
- **Riesgos:**
  - S13 toca tres funciones de BAIOS (comisiones y fusión). Mitigación: la definición vigente completa en la cabecera, con su huella antes y después.

### AC · Accesos y cuentas (F34–F44, F109) — S08 y S09

- **S08:** el esquema `app_servicio_portal`, cerrado (sin USAGE para anon ni authenticated). `portal_accounts` y `portal_sessions`. El bucket `portal-avatars`.
- **S09:**
  - `portal_access`.
  - El motor de accesos: `svc_grant_initial_access`, `svc_open_access` y el corte reales (reemplazan los stubs), `portal_access_effective`, `portal_section_enabled`, `portal_access_window`.
  - La mora en el cron.
  - Acceso extra, extender y quitar (`AC001`, `AC002`).
  - La invitación: huella, 7 días, una por minuto y cinco por día.
  - `portal_admin_create_preview_pass`, por 60 segundos.
  - `portal_invite_token_valid` y `app_servicio.contract_version()`.
- **TS:**
  - `lib/portal-admin/{sections, access, account, settings, preview}.ts`.
  - Casos: `access.cases.json` y `access-rule.cases.json` (≥ 20).
  - El envío de la invitación por Resend del negocio, con la puerta de email transaccional.
- **Pantallas:**
  - Portal › Programas ("+ Agregar programa").
  - Portal › programa: cabecera, Afiliados (F106) y Ajustes del programa.
  - La pestaña Accesos de la ficha.
  - "Ver como estudiante".
  - Portal › Ajustes del portal.
- **Verify:** `verify-services --bloque ac` y `scripts/verify-portal-schema.mjs`.
- **Riesgos:** la invitación necesita Resend. En los tests se simula siempre.

### PR · Programa (F45–F51, F100–F102, F112) — S10

- **S10:**
  - `program_items`, con el trigger de estructura `PR001`.
  - `program_progress` y su trigger: módulo completo y paso del camino (F19).
  - El bucket `program-resources`.
  - `knowledge_base.program_item_id` y `knowledge_chunks.start_second`.
  - `program_item_unlocked` y `program_live_recordings`.
- **TS:**
  - `lib/program/{tree, lesson, video-url, unlock, visibility, variant-content, transcript}.ts`.
  - Casos: `video-url.cases.json` (≥ 15) y `unlock.cases.json` (≥ 25).
  - Transcripción con `indexText` y el segundo de cada parte.
- **Pantalla:** Portal › programa › Contenido, con el árbol, el drawer, portadas y vistas previas, y Activo/Inactivo.
- **Verify:** `scripts/verify-program.mjs --bloque pr`.

### EV · Evaluaciones y actividades (F52–F57, F113) — S11

- **S11:**
  - El CHECK de `forms.type` + `terms`, `quiz` y `activity`. Aborta si hubiera filas de esos tipos.
  - `forms.product_id`.
  - Las columnas de revisión de `form_submissions`.
  - `quiz_grade` por trigger.
  - `submission_review`.
  - `portal_terms_pending`.
  - El completado de actividad y evaluación en el motor (`CREATE OR REPLACE` de S06).
- **TS:**
  - `lib/program/{quiz, grading, review}.ts`.
  - Casos: `quiz-grade.cases.json` (≥ 12) y `grading.cases.json`.
  - Un test de frontera para `internal_note` y las respuestas correctas.
  - El filtro de tipos no públicos (D25).
- **Pantallas:**
  - El editor de evaluación y actividad, con Contenido, Entregas o Resultados, y Comentarios.
  - Portal › Por revisar, con el contador en el menú y la alerta en Clientes.
  - El bloque de términos en la variante y en Ajustes del programa.
- **Verify:** `verify-program --bloque ev` y `verify-forms` con las huellas iguales.

### CA · Calendario y grabaciones (F58–F65) — S12

- **S12:**
  - `live_sessions`, `live_session_dates`, `live_attendance` y `link_clicks` (sin IP en claro).
  - `live_session_occurrences`, `live_attendance_window`, `attendance_base_members`, `attendance_mark` y `attendance_remove`.
  - El tipo Clase (`servicio.clase`) en cada área Servicio.
- **TS:**
  - `lib/program/{live-sessions, occurrences, attendance, attendance-base}.ts`.
  - Casos: `occurrences.cases.json` (≥ 10), `attendance-window.cases.json` y `attendance-base.cases.json` (≥ 8).
  - `addToPortalPlan`.
- **Pantallas:**
  - El Calendario: Lista, Mes, Sesiones recurrentes, la grilla y la ficha de la sesión con "Agregar un estudiante que asistió".
  - El menú "⋯" de Grabaciones con "Agregar al portal" (D15).
- **Verify:** `verify-program --bloque ca` y `verify-scheduling`.

### CE · Certificados (F66–F69) — sin migración

- **TS:**
  - `registerDesignVariables` con el grupo "Servicio" y las variables `service.*`.
  - La suscripción a `onDesignGenerated`, que completa el paso.
  - El job `svc_certificate_issue` (D9).
  - Emitir, anular y volver a emitir (D11).
  - El disparador `certificate_issued` y la acción "Emitir certificado".
  - La sección Certificado en `AVAILABLE_SECTIONS`.
- **Verify:** `verify-program --bloque ce` (render simulado `DESIGNER_FAKE_RENDER=1`) y `verify-designer` sin cambios.
- **Si algo del Diseñador falla:** CE va a `PENDIENTE` y el paso Certificado no se ofrece.

### CO · Comunidad (F76, F77, F111) — S14

- **S14:** `community_posts` y `community_reactions`, el bucket `community-media`, `community_can_post` y `community_unanswered`. La purga va en el cron de X.
- **Pantallas:** la pestaña Comunidad (filtros y espacios en la tuerca) y los comentarios de la clase.
- **Verify:** `verify-program --bloque co`.

### IA · Tutor (F83–F87, F110) — S15

- **S15:**
  - `products.tutor_agent_id`, único.
  - Los dos CHECK de `agent_runs` (D23).
  - La política del canal `portal` (D24).
  - `program_ensure_tutor`, `assistant_month_spend` y `assistant_credits`.
- **TS:**
  - El tipo `student_tutor` en `agent-types.ts`, con `notify`.
  - `AGENT_RUN_SOURCES` + `portal_tutor`.
  - La base de conocimiento, los límites y el uso.
  - Casos de créditos.
- **Verify:** `verify-program --bloque ia` y `verify-rls`.

### X · Cierre (F88–F92, F108) — S16

- **S16:**
  - `merge_contacts`, copiada de la base (ya trae lo de S13), llama a `app_servicio.merge_contacts_hook` si existe.
  - `private.enqueue_svc_daily()` con `cron.schedule` por SQL directo, solo para los negocios con el módulo prendido y solo si hay candidatas. Lo despierta la guarda `cron_work_jobs`; sin ruta nueva en `app/api/cron`.
  - `program_card_metrics`.
- **Plantilla:** `servicios` en `perfiles/estudiantes.mjs`. `poda.sql` borra los esquemas, los triggers `trg_app_servicio_*` y las columnas "Servicios". Afiliados sigue a Ventas.
- **Verify:** `verify-contact-merge`, que lee el catálogo de los tres esquemas. Al final, todos los `verify-*` de A1, de a uno.
- **Docs:** `docs/servicios.md`, `docs/portal-admin.md` y `docs/afiliados.md`. Se actualizan `flow-registry.md`, `roles.md` (M11 y claves) y la sección de `CLAUDE.md` "Servicios, portal y afiliados" (§9c, migraciones aplicadas y próxima libre, 00345).

## 8. Cierre de la corrida

1. Suite completa, build, lint sin errores nuevos y todos los `verify-*`, de a uno.
2. Las huellas iguales al punto de partida.
3. `PROGRESS` y `PENDIENTE` al día.
4. No mergeo a `main`.
5. `gh pr create` de `feat/servicios-a1` a `main` con el resumen de `PROGRESS` y `PENDIENTE`, más "Después del merge":
   - cómo prender el módulo en un negocio con `set_module_enabled`;
   - el estado del esquema expuesto (lista anterior y lista nueva, del `punto-de-partida.json`);
   - qué probar en vivo (§15 del plano).
6. Después de mergear, te pregunto si sincronizo la plantilla BAIOS.
