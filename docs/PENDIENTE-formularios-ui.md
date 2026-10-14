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
