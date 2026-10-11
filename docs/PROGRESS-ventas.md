# Progreso · Módulo Ventas (Fase 1)

Rama `feat/ventas-fase1`. Plano: `docs/requerimientos-ventas-v7.md` (v1.1) y `claude/v7/ventas/plano/`.
Decisiones y diferencias con el código real: `docs/PENDIENTE-ventas.md`.

## Bloques

- [ ] **B1 · Catálogo**: F1 · F2 · F3 · F4 · F5 · F6 · F7 · F8
- [ ] **B2 · Atribución y asignación**: F9 · F10 · F11 · F12 · F13 · F14 · F15 · F16
- [ ] **B3 · Ventas**: F17 · F18 · F19 · F20 · F21 · F22 · F23 · F24 · F25 · F26 · F26b
- [ ] **B4 · Pagos, mora, historial y triggers**: F27 · F28 · F29 · F30 · F31 · F32 · F33 · F34 · F35 · F36 · F37 · F38

### Funcionalidades (marcar al cerrar)

- [ ] F1 · [ ] F2 · [ ] F3 · [ ] F4 · [ ] F5 · [ ] F6 · [ ] F7 · [ ] F8
- [ ] F9 · [ ] F10 · [ ] F11 · [ ] F12 · [ ] F13 · [ ] F14 · [ ] F15 · [ ] F16
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
| 00159 | Catálogo (`products`, `product_variants`, `product_versions`) | pendiente |
| 00160 | Absorbe `content_offers` (riesgo alto) | pendiente |
| 00161 | Asignación (`assignment_rules`, columnas, trigger) | pendiente |
| 00162 | `sales`, `payments` y funciones | pendiente |
| 00163 | FK de `sale_id` en formularios y firmas | pendiente |
| 00164 | `submit_form_response` valida el `sale_id` (riesgo alto) | pendiente |
| 00165 | Bucket `payment-receipts` | pendiente |
| 00166 | CHECK de `triggers.type` | pendiente |
| 00167 | Cron de mora | pendiente |
| 00168 | Política `audit_log_select_sales` | pendiente |
| — | `docs/pendientes/drop_content_offers.sql` | se escribe, **no se aplica** |

Próxima libre al terminar: 00169.
