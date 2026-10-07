// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * El snippet que pega el cliente en su web (F39, F40). Adaptado de
 * `packages/embeds/embed-snippet/src/index.ts`: define `window.Agenda` como
 * una cola de instrucciones y carga `/embed/embed.js`, que después procesa la
 * cola. El objeto global se llama `Agenda` (no "Cal").
 *
 * Es un string porque va adentro del código generado; se mantiene chico y
 * legible a propósito.
 */

export const EMBED_SCRIPT_PATH = "/embed/embed.js";

/** El loader, listo para envolver en `<script>`. `scriptUrl` es la URL absoluta de embed.js. */
export function loaderSnippet(scriptUrl: string): string {
  const url = JSON.stringify(scriptUrl);
  return `(function (C, A, L) {
  var p = function (a, ar) { a.q.push(ar); };
  var d = C.document;
  C.Agenda = C.Agenda || function () {
    var agenda = C.Agenda; var ar = arguments;
    if (!agenda.loaded) { agenda.ns = {}; agenda.q = agenda.q || []; d.head.appendChild(d.createElement("script")).src = A; agenda.loaded = true; }
    if (ar[0] === L) {
      var api = function () { p(api, arguments); };
      var namespace = ar[1];
      api.q = api.q || [];
      if (typeof namespace === "string") { agenda.ns[namespace] = agenda.ns[namespace] || api; p(agenda.ns[namespace], ar); p(agenda, ["initNamespace", namespace]); } else p(agenda, ar);
      return;
    }
    p(agenda, ar);
  };
})(window, ${url}, "init");`;
}

export function embedScriptUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}${EMBED_SCRIPT_PATH}`;
}
