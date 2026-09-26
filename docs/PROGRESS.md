# Progreso — Fase 3, Bloques 2e y 3

Corrida autónoma en la rama `oneshot-fase3-2e-3`. Plano: `docs/requerimientos-fase3-bloques-2e-3.md` (v1.1).

## Punto de partida (26/9/2026, `main` @ `4c3d24a`)

| Comando | Resultado de hoy |
|---|---|
| `npx vitest run` | 90 archivos, **1059 tests en verde** |
| `npm run build` | OK (exit 0) |
| `npm run lint` | 0 errores, **45 warnings preexistentes** (directivas `eslint-disable` sin uso) |
| `node scripts/verify-rls.mjs` | Todo verde, limpieza OK |

Base: última migración aplicada `00073_tag_effects`. La `00072` **no está aplicada** (diferida). 1580 salientes (0 con autor), 837 entrantes, 593 conversaciones, 0 runs, 0 borradores. Agente apagado, Instagram en `draft`. Sin `workspaces.timezone`, sin `messages.origin`.

## Bloques

- [ ] **Bloque 0 — Arranque:** rama, copia del plano, PROGRESS/PENDIENTE
- [ ] **Bloque 1 — Base común**
  - [ ] F1 · Diagnóstico de autoría (`docs/diagnostico-autoria.md`)
  - [ ] F2 · Columna `messages.origin` (todos los caminos + backfill)
  - [ ] F3 · Zona horaria del workspace
  - [ ] F4 · Valores nuevos en checks + `normalize_for_grouping`
- [ ] **Bloque 2 — Verificación y reglas de respuesta**
  - [ ] F5 · Verificación antes de responder (3 momentos + refresco Zernio)
  - [ ] F6 · Borrador respondido por otro medio
  - [ ] F7 · Espera tras respuesta externa
  - [ ] F8 · Evaluador de reglas
  - [ ] F9 · Integración de reglas en el turno
  - [ ] F10 · Editor de reglas, plantilla y modo del canal
  - [ ] F11 · Simulación
  - [ ] F12 · Visibilidad de la decisión
- [ ] **Bloque 3 — Navegación y dashboard de Chat**
  - [ ] F13 · Navegación global (barra 56 px)
  - [ ] F14 · Filtros y período
  - [ ] F15 · Funciones de métricas + `verify-dashboards.mjs`
  - [ ] F16 · Pantalla: números, tendencias, contexto
  - [ ] F17 · Sección del agente y aprobación de borradores
  - [ ] F18 · Tabla "Quién responde"
- [ ] **Bloque 4 — Patrones de mensajes**
  - [ ] F19 · Textos y categorías
  - [ ] F20 · Clasificador
  - [ ] F21 · Corrección desde el dashboard
  - [ ] F22 · Sección Patrones
- [ ] **Bloque 5 — Tareas en segundo plano, calidad e intención**
  - [ ] F23 · Configuración de tareas en segundo plano
  - [ ] F24 · Jobs de despacho y recolección
  - [ ] F25 · Calidad, revisión rápida, set de control y versiones
  - [ ] F26 · Intención declarada por el agente y reglas por intención

## Migraciones creadas

_(ninguna todavía; continúan desde 00074)_
