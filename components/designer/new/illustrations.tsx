import type { CreateOrigin } from "@/lib/designer/contracts";

/**
 * Las cuatro ilustraciones del paso «Cómo empezás» (§F16, las del prototipo). SVG en línea que usan los colores
 * del tema (clases `fill-*` / `stroke-*`), así se ven bien en claro y en oscuro y no llevan ninguna marca escrita.
 */

const SVG = "h-24 w-full rounded-[10px] bg-muted p-1.5";

function Ai() {
  return (
    <svg viewBox="0 0 140 90" className={SVG} aria-hidden>
      <rect x="62" y="10" width="62" height="72" rx="6" className="fill-card stroke-border" />
      <rect x="70" y="20" width="40" height="7" rx="3" className="fill-primary" />
      <rect x="70" y="33" width="46" height="4" rx="2" className="fill-border" />
      <rect x="70" y="41" width="38" height="4" rx="2" className="fill-border" />
      <rect x="70" y="55" width="46" height="18" rx="3" className="fill-primary/15" />
      <rect x="10" y="18" width="50" height="20" rx="10" className="fill-primary" />
      <rect x="18" y="26" width="30" height="4" rx="2" className="fill-primary-foreground" opacity=".85" />
      <rect x="16" y="46" width="40" height="16" rx="8" className="fill-muted stroke-border" />
      <path d="M34 66l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" className="fill-primary" />
    </svg>
  );
}

function Img() {
  return (
    <svg viewBox="0 0 140 90" className={SVG} aria-hidden>
      <rect x="18" y="10" width="104" height="70" rx="6" className="fill-card stroke-muted-foreground/60" strokeWidth="3" />
      <rect x="25" y="17" width="90" height="56" rx="3" className="fill-none stroke-border" />
      <rect x="45" y="24" width="50" height="6" rx="2" className="fill-muted-foreground/50" />
      <rect x="36" y="38" width="68" height="12" rx="4" className="fill-primary/15 stroke-primary" strokeDasharray="3 2" />
      <rect x="44" y="42" width="52" height="4" rx="2" className="fill-primary" />
      <circle cx="70" cy="64" r="6" className="fill-muted-foreground/40" />
      <g transform="translate(104,58)">
        <circle r="11" className="fill-primary" />
        <path d="M-5 0h10M0-5v10" className="stroke-primary-foreground" strokeWidth="2.2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function Html() {
  return (
    <svg viewBox="0 0 140 90" className={SVG} aria-hidden>
      <rect x="24" y="8" width="70" height="76" rx="6" className="fill-card stroke-border" />
      <rect x="24" y="8" width="70" height="14" rx="6" className="fill-muted" />
      <circle cx="32" cy="15" r="2" className="fill-bad" />
      <circle cx="39" cy="15" r="2" className="fill-warn" />
      <circle cx="46" cy="15" r="2" className="fill-good" />
      <text x="59" y="58" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="20" fontWeight="700" className="fill-primary">
        &lt;/&gt;
      </text>
      <g transform="translate(108,46)">
        <circle r="18" className="fill-primary" />
        <path d="M0 8V-7M-6-1l6-6 6 6" className="stroke-primary-foreground" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function Blank() {
  return (
    <svg viewBox="0 0 140 90" className={SVG} aria-hidden>
      <rect x="40" y="8" width="60" height="76" rx="6" className="fill-card stroke-muted-foreground" strokeDasharray="5 4" />
      <g transform="translate(70,46)">
        <circle r="13" className="fill-primary/15" />
        <path d="M-6 0h12M0-6v12" className="stroke-primary" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <rect x="14" y="62" width="20" height="16" rx="3" className="fill-muted stroke-border" />
      <text x="24" y="74" textAnchor="middle" fontSize="11" fontWeight="700" className="fill-muted-foreground">
        T
      </text>
      <rect x="106" y="16" width="22" height="16" rx="3" className="fill-muted stroke-border" />
      <path d="M110 28l4-5 3 3 3-4 4 6" className="stroke-muted-foreground" fill="none" />
    </svg>
  );
}

const ILLUSTRATIONS: Record<CreateOrigin, () => React.JSX.Element> = { ai: Ai, image: Img, html: Html, blank: Blank };

export function HowIllustration({ how, className }: { how: CreateOrigin; className?: string }) {
  const Component = ILLUSTRATIONS[how];
  return className ? (
    <div className={className}>
      <Component />
    </div>
  ) : (
    <Component />
  );
}
