# Progreso · Módulo Ventas (Fase 1)

Rama `feat/ventas-fase1`. Plano: `docs/requerimientos-ventas-v7.md` (v1.1) y `claude/v7/ventas/plano/`.
Decisiones y diferencias con el código real: `docs/PENDIENTE-ventas.md`.

## Bloques

- [x] **B1 · Catálogo**: F1 · F2 · F3 · F4 · F5 · F6 · F7 · F8
- [x] **B2 · Atribución y asignación**: F9 · F10 · F11 · F12 · F13 · F14 · F15 · F16
- [x] **B3 · Ventas**: F17 · F18 · F19 · F20 · F21 · F22 · F23 · F24 · F25 · F26 · F26b
- [x] **B4 · Pagos, mora, historial y triggers**: F27 · F28 · F29 · F30 · F31 · F32 · F33 · F34 · F35 · F36 · F37 · F38

### Funcionalidades (marcar al cerrar)

- [x] F1 · [x] F2 · [x] F3 · [x] F4 · [x] F5 · [x] F6 · [x] F7 · [x] F8
- [x] F9 · [x] F10 · [x] F11 · [x] F12 · [x] F13 · [x] F14 · [x] F15 · [x] F16
- [x] F17 · [x] F18 · [x] F19 · [x] F20 · [x] F21 · [x] F22 · [x] F23 · [x] F24 · [x] F25 · [x] F26 · [x] F26b
- [x] F27 · [x] F28 · [x] F29 · [x] F30 · [x] F31 · [x] F32 · [x] F33 · [x] F34 · [x] F35 · [x] F36 · [x] F37 · [x] F38

## Punto de partida (11/10/2026, `main` = `3475798`, PR #41 de Formularios ya mergeado)

| Comprobación | Resultado |
|---|---|
| `npx vitest run` | 619 archivos, 7641 tests, verde |
| `npm run build` | verde |
| `npm run lint` | 0 errores, 36 warnings |
| `npx tsc --noEmit` | verde |
| `verify-rls --despues-de-00143`, `verify-roles --despues-de-00136`, `verify-audit-visibility --despues-de-00147`, `verify-workspace-isolation --despues-de-00143` | 0 |
| `verify-content`, `verify-crm`, `verify-csv-import`, `verify-scheduling`, `verify-booking-concurrency`, `verify-calls`, `verify-forms`, `verify-dashboards`, `verify-inbox-filters`, `verify-publishing`, `verify-optout`, `verify-enrichment`, `verify-chat-media`, `verify-message-persistence` | 0 |
| `verify-attribution` | **falla ya en el punto de partida**: 1 caso, "todos los contactos reales tienen first_touch" (737 de 796; los mismos 59 contactos sin `first_touch`). No es de este módulo; no puede empeorar |
| `verify-knowledge`, `verify-webhook` | no se corren (llaman a Voyage de verdad / necesitan la app local) |

Base: última migración aplicada `00158_forms_once_key_fix`. Datos: `content_offers` 3 filas activas; 0 filas con `sale_id`; 1 workspace (America/Costa_Rica).

## Migraciones

| N° | Qué | Estado |
|---|---|---|
| 00159 | Catálogo (`products`, `product_variants`, `product_versions`) | **aplicada y registrada** (dos veces: idempotente; `verify-sales --block 1` y `verify-rls` en verde) |
| 00160 | Absorbe `content_offers` (riesgo alto) | **aplicada y registrada** (control: 0 divergentes, 3 productos / 3 variantes / 3 versiones activas 3000·6000·12000, FK a `products`; dos veces: no duplica; `verify-content`, `verify-rls`, `verify-crm`, `verify-sales --block 1` en verde). Respaldo previo en `docs/ventas/respaldo-pre-00160.json` |
| 00161 | Asignación (`assignment_rules`, columnas, trigger) | **aplicada y registrada** (dos veces: idempotente; 3 reglas manuales por workspace; `verify-sales --block 2`, `verify-crm`, `verify-csv-import`, `verify-roles`, `verify-rls` en verde; `verify-attribution` con su única falla de antes) |
| 00162 | `sales`, `payments` y funciones | **aplicada y registrada** (`verify-sales --block 3` en verde: atomicidad, atribución congelada, visibilidad, DELETE bloqueado, paridad del estado) |
| 00163 | FK de `sale_id` en formularios y firmas | **aplicada y registrada** (0 huérfanos; `form_submissions` SET NULL, `contract_signatures` sin acción) |
| 00164 | `submit_form_response` valida el `sale_id` (riesgo alto) | **aplicada y registrada** (partió de la definición vigente, md5 `9d28625f…`; `lib/sales/submit-form-response-diff.test.ts`; `verify-forms` en verde con un caso adaptado a propósito) |
| 00165 | Bucket `payment-receipts` | **aplicada y registrada** (`verify-sales --block 4`: 12 MB y `.exe` rechazados, Member sin acceso) |
| 00166 | CHECK de `triggers.type` (los 24 anteriores + 6 de ventas + `payment.receipt_uploaded`) | **aplicada y registrada** |
| 00167 | Cron de mora (`private.enqueue_payments_overdue_sweep`, solo encola con pagos candidatos) | **aplicada y registrada** (`cron.job` presente; `cron-config.test` intacto) |
| 00168 | Política `audit_log_select_sales` | **aplicada y registrada** (`verify-audit-visibility --despues-de-00168`; `audit_log_select` idéntica) |
| — | `docs/pendientes/drop_content_offers.sql` | se escribe, **no se aplica** |

Próxima libre al terminar: 00169.

## Bloque B1 · Catálogo (hecho)

- **Permisos (F2)**: las 3 claves, el módulo `sales` y el alcance `sales` (own/all) en `lib/auth/permissions.ts`, la fila "Ventas" de Roles, `canSeeSale` en `lib/sales/permissions.ts`.
- **Núcleo portado**: de `sales-constants.ts` salen `lib/sales/{money,fees,labels,status-colors}.ts` (céntimos, `Number(x) || 0`); métodos de pago y formato aparte.
- **Base**: 00159 (catálogo, RLS, `publish_product_version`, protección de versiones publicadas, `workspaces.enabled_payment_methods`) y 00160 (absorbe `content_offers` con puente y FK a `products`).
- **Servidor**: `lib/actions/products.ts` (productos, variantes, versiones, publicar); las acciones de producto de Contenido delegan ahí.
- **Pantallas**: Ajustes > Productos (lista) y `/[id]` (variantes, pestaña Precio, historial), General > Ventas (métodos habilitados), ítem "Ventas" del menú con una página provisoria.
- Verificación: vitest 7791 verdes, build y lint (0 errores), `verify-sales --block 1`, `verify-rls`, `verify-content`, `verify-crm`.

## Bloque B2 · Atribución y asignación (hecho)

- **Base**: 00161 (`assignment_rules` con RLS, columnas de `contacts` y `workspaces`, precarga por workspace, trigger `contacts_enqueue_sales_eval` que solo encola y atrapa toda excepción).
- **Atribución de la venta (F10)**: `lib/sales/attribution.ts` (copia congelada del último toque, otro toque, manual, sin atribución, extras de `raw`).
- **Núcleo portado**: `reparto-condiciones.ts` → `lib/sales/conditions-schema.ts`; `run-assignment-rules` (`evalSingleCondition`, `combine`, `evaluateRules`) → `lib/sales/assignment/{conditions,resolve}.ts`; `apply-contact-setter-assignment` → `round-robin.ts`. Con los bugs arreglados (operador desconocido, puntero del turno).
- **Job `sales_contact_eval`** (`lib/jobs/handlers/sales-contact-eval.ts`) y `assignContact` que ahora escribe `assignment_locked_at`.
- **Pantallas**: Ajustes > Asignación (3 tarjetas, constructor de condiciones reutilizable, probador y simulación en seco), el componente de atribución y la línea de último toque y asignación en la ficha del contacto.
- Verificación: vitest 7882 verdes, build y lint (0 errores), `verify-sales --block 2`.

## Bloque B3 · Ventas (hecho)

- **Base**: 00162 (`sales`, `payments`, `create_sale`, `cancel_sale`, `derive_sale_status`, eventos y auditoría en la misma transacción), 00163 (claves de `sale_id`), 00164 (`submit_form_response` v4: valida el `sale_id` del link y lo suma a los eventos).
- **Núcleo puro** (`lib/sales/`): `sale-status` (con casos compartidos con SQL), `sale-math`, `payment-plan`, `create`, `contacts`, `booking-link`, `list`, `edit`, `detail`, `contract`, `wizard/{step1,catalog,step3,summary}`.
- **Servidor** (`lib/actions/sales.ts`, `sales-contract.ts`): `createSale`, `updateSale` (con `confirmRepricing`, conflicto por `updated_at` y atribución auditada), `cancelSale`, `cancelSubscription`, `rebuildPlan`, `getSaleContactContext`, y el envío del contrato (link firmado con el `sale_id` adentro del token, por copia/WhatsApp/Instagram/email).
- **Pantallas**: lista `/dashboard/ventas` (pastillas, filtros en la URL, cards en celular), asistente «Nueva venta» de 3 pasos, ficha `/dashboard/ventas/[id]` (datos, plan de pagos de solo lectura, contratos, historial), sección «Ventas» en la ficha del contacto y en el panel de la Agenda («Cargar venta» con el contacto y la agenda resueltos).
- **Bandeja**: `?texto=` deja el mensaje escrito en el composer sin mandarlo (para «Enviar por WhatsApp/Instagram»).
- Verificación: `verify-sales --block 3` (incluye 00163 y 00164), `verify-forms` en verde, vitest, build y lint (0 errores).

## Bloque B4 · Pagos, mora, historial y triggers (hecho)

- **Base**: 00165 (bucket privado de comprobantes), 00166 (CHECK de `triggers.type`), 00167 (cron de mora: SQL directo, `call_app_cron` no se toca) y 00168 (política ADICIONAL `audit_log_select_sales`; `audit_log_select` no se reescribe).
- **Núcleo compartido** (`lib/sales/payments-core.ts`, actor usuario o sistema): lo usan las Server Actions y los nodos de flow, así un pago se cobra, reprograma o marca incobrable igual venga de una persona o de una automatización. Reembolso = fila negativa `paid`; el total pasa la venta a `refunded` primero.
- **Mora**: handler `payments_overdue_sweep` con `UPDATE … WHERE status='scheduled'` condicional; el desfase y la salud de pago salen de `lib/sales/{delay,overdue,payment-health}.ts`.
- **Triggers**: seis por cambio de estado y tres relativos al vencimiento (`payment_relative_trigger`, clave con el número de reprogramaciones). `pickCanonicalTrigger` dentro de `eventMatches` hace que un flow corra UNA vez por cambio. Tres nodos (cobrar, reprogramar, cambiar estado de venta), 11 atajos en el selector y `SalesTriggerPanel` con sus filtros.
- **Pantallas**: `/dashboard/ventas/pagos`, cobrar/editar/ver pago con comprobante, reembolso, incobrable, plan de pagos en la ficha, sección «Ventas» de Ajustes > General (tope, gracia, flujos de cobranza) y Ajustes > Actividad (historial global con filtros).
- **Flujos de cobranza precreados**: cuatro flows en borrador que se crean al abrir Ventas por primera vez (Owner/Admin), al prender la opción y al crear un workspace. Sin backfill durante la corrida.
- **Borrado diferido**: `docs/pendientes/drop_content_offers.sql` escrito, **no aplicado**.
- Verificación: vitest 8213 verdes (682 archivos), `tsc` y build verdes, lint 0 errores (36 warnings, los mismos del punto de partida), `verify-sales` completo y `verify-audit-visibility --despues-de-00168`.

Próxima migración libre: **00169**.

## Cierre (11/10/2026)

| Comprobación | Resultado |
|---|---|
| `npx vitest run` | 682 archivos, 8213 tests, verde |
| `npx tsc --noEmit`, `npm run build` | verdes |
| `npm run lint` | 0 errores, 36 warnings (los mismos del punto de partida) |
| `verify-sales` (bloques 1 a 4), `verify-audit-visibility --despues-de-00168` | 0 |
| `verify-rls`, `verify-roles`, `verify-workspace-isolation` (con sus flags), `verify-content`, `verify-crm`, `verify-csv-import`, `verify-scheduling`, `verify-booking-concurrency`, `verify-calls`, `verify-forms`, `verify-dashboards`, `verify-inbox-filters`, `verify-publishing`, `verify-optout`, `verify-enrichment`, `verify-chat-media`, `verify-message-persistence` | 0 |
| `verify-attribution` | Solo la falla de antes: «todos los contactos reales tienen first_touch» (741 de 800, los mismos 59 contactos). No empeoró |

Migraciones 00159 a 00168 aplicadas y registradas; `ALL_MIGRATIONS.sql` regenerado. `docs/ventas.md`, `docs/flow-registry.md`, `CLAUDE.md` y `BITACORA.md` actualizados. El borrado de `content_offers` queda escrito y sin aplicar.
