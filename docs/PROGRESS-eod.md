# Reporte de fin de día (EOD) — avance

Rama `feat/formularios-eod` (12/10/2026). Resumen del módulo en [eod.md](eod.md).

## Punto de partida

- `main` limpio, correcciones R1 a R10 en main (PR #44), última migración aplicada `00177`.
- `npx vitest run` en verde (9139 tests).

## Bloque E1 — Crear y configurar

- [x] E1 Tipo `eod` (00178), `eod_config` validado con Zod, variante fija.
- [x] E2 Cinco tipos de pregunta, `step` y `metricKey`; stepper con − y + (`lib/eod/stepper.ts`).
- [x] E3 Canales: catálogo, personalizados, copiar y "usar en todos", reglas de publicar.
- [x] E4 Plantillas de setters y general.
- [x] E5 Configuración: audiencia (todos, personas, roles incluidos los de sistema), modo,
      días hacia atrás, avisos, pantalla final, recordatorio.
- [x] E11 Lista con chip y filtro por tipo; un EOD no aparece en la ficha del contacto, las
      métricas ni los disparadores de formularios; `get_public_form` → `unavailable` (00179).

## Bloque E2 — Completar, guardar sin perder nada, enviar y ver

- [x] E6 "Mi reporte del día" (menú por condición del servidor), `/dashboard/eod/[formId]`.
- [x] E7 Borrador en servidor + `localStorage`, revisión, fusión de "+1", medianoche (00180, 00181).
- [x] E8 Envío validado entero en el servidor, unicidad por índice, correcciones con historial.
- [x] E9 Reportes: tabla, totales, pendientes de hoy, detalle y CSV.
- [x] E10 `eod.view_all`, navegación y tests de permisos y menú.
- [x] E12 Documentación.
- [x] E13 Recordatorio (00185).

## Bloque E3 — Automatizaciones

- [x] E15 Flujos sin contacto: `subject`, `needsContact`, motor, cron, editor y canvas (00182).
- [x] E16 Disparador `eod_submitted` (00183, 00184), variables, plantillas y "Probar condiciones".

## Migraciones

`00178` a `00185`, aplicadas con la CLI y registradas a mano. El plan las numeraba distinto
(00179 = tabla, 00181 = `get_public_form`); se renumeraron para aplicarlas en orden sin huecos.

## Verificación

- `npx vitest run`: ver el cierre en BITACORA.
- `verify-eod` (nuevo) en verde.
- Los demás `verify-*`, de a uno: ver BITACORA.
- Revisión visual (E14): ver BITACORA.
