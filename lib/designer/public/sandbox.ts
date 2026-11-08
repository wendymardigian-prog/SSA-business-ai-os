/**
 * Los permisos del iframe donde se muestra una página web publicada (F43): ninguno, salvo abrir los links en
 * una pestaña nueva. NUNCA `allow-scripts` (ni `allow-same-origin`, ni `allow-forms`, ni `allow-top-navigation`):
 * un test lo cuida. No toca `lib/security-headers.ts`.
 */
export const WEB_IFRAME_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";
