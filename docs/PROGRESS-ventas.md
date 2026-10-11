# Progreso · Módulo Ventas (Fase 1)

Rama `feat/ventas-fase1`. Plano: `docs/requerimientos-ventas-v7.md` (v1.1) y `claude/v7/ventas/plano/`.
Decisiones y diferencias con el código real: `docs/PENDIENTE-ventas.md`.

## Bloques

- [x] **B1 · Catálogo**: F1 · F2 · F3 · F4 · F5 · F6 · F7 · F8
- [x] **B2 · Atribución y asignación**: F9 · F10 · F11 · F12 · F13 · F14 · F15 · F16
- [ ] **B3 · Ventas**: F17 · F18 · F19 · F20 · F21 · F22 · F23 · F24 · F25 · F26 · F26b
- [ ] **B4 · Pagos, mora, historial y triggers**: F27 · F28 · F29 · F30 · F31 · F32 · F33 · F34 · F35 · F36 · F37 · F38

### Funcionalidades (marcar al cerrar)

- [x] F1 · [x] F2 · [x] F3 · [x] F4 · [x] F5 · [x] F6 · [x] F7 · [x] F8
- [x] F9 · [x] F10 · [x] F11 · [x] F12 · [x] F13 · [x] F14 · [x] F15 · [x] F16
- [ ] F17 · [ ] F18 · [ ] F19 · [ ] F20 · [ ] F21 · [ ] F22 · [ ] F23 · [ ] F24 · [ ] F25 · [ ] F26 · [ ] F26b
- [ ] F27 · [ ] F28 · [ ] F29 · [ ] F30 · [ ] F31 · [ ] F32 · [ ] F33 · [ ] F34 · [ ] F35 · [ ] F36 · [ ] F37 · [ ] F38

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
| 00162 | `sales`, `payments` y funciones | pendiente |
| 00163 | FK de `sale_id` en formularios y firmas | pendiente |
| 00164 | `submit_form_response` valida el `sale_id` (riesgo alto) | pendiente |
| 00165 | Bucket `payment-receipts` | pendiente |
| 00166 | CHECK de `triggers.type` | pendiente |
| 00167 | Cron de mora | pendiente |
| 00168 | Política `audit_log_select_sales` | pendiente |
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
