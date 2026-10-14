# Pendientes: Formularios (UI nueva), menú lateral y URL de entrada

Plano: `claude/v12/requerimientos-formularios-ui-menu.md`. Avance en [PROGRESS-formularios-ui.md](PROGRESS-formularios-ui.md).

Formato: **qué quedó**, **por qué**, **qué se decidió**.

## Decisiones tomadas el 13/10/2026 (antes de construir)

- **Recursos fuera del menú y el Member.**
  - Qué: hoy el Member ve "Recursos" y no ve "Ajustes".
  - Por qué: si Recursos sale del menú (D4), el Member se queda sin forma de entrar desde el menú.
  - Decidido: "Ajustes" aparece para quien vea al menos una pestaña de Ajustes. El Member entra directo a Recursos, sin barra de pestañas.
- **Métricas de las tarjetas de la lista.**
  - Qué: el plano pide conversión, NPS y personas; hoy la lista solo calcula respuestas y la última.
  - Decidido: reusar los cálculos que ya existen (`conversionRate`, el NPS del panel de la encuesta, reportes y personas distintas del EOD), con una consulta por cosa y no una por formulario.
- **Coordinación con la sesión de Equipo y roles.**
  - Decidido: esta corrida usa la migración `00215`, deja B1 lo más chico posible (no toca `adminOnly` ni permisos) y le avisa a la otra sesión.

## Pendientes

_(vacío: se completa durante la construcción)_

## Notas de la corrida

- **Mensaje a la sesión de Equipo y roles: no llegó.** Lo mandé el 13/10 (migración `00215` y archivos del menú que toca B1) y quedó retenido: la otra sesión corre en un modo de permisos distinto y no lo aprobó antes de que venciera. Qué se decidió: no reenviarlo; el aviso queda en este documento y en el PR. Si roles mergea antes, los conflictos en `lib/nav/items.ts`, `lib/nav/page-actions.ts`, `lib/settings/tabs.ts`, `components/sidebar.tsx` y `member-baseline.test.ts` se resuelven en esta rama.
- **`supabase/.temp` y `.env` enlazados al checkout principal.** Los scripts `verify-*` usan `supabase db query --linked` y leen `.env`; el worktree no los tiene (están en `.gitignore`). Son symlinks, no se commitean.
