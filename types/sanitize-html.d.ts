/**
 * Tipos mínimos de `sanitize-html` (la librería no los trae). Se declaran acá
 * en vez de sumar `@types/sanitize-html`: las únicas dependencias nuevas
 * permitidas para el Diseñador IA son `fflate` y `sanitize-html`.
 * Cubre lo que usa `lib/designer/import/sanitize.ts`; si se usa otra opción,
 * se suma acá.
 */
declare module "sanitize-html" {
  type Attributes = Record<string, string>;

  interface Frame {
    tag: string;
    attribs: Attributes;
    text: string;
    tagPosition: number;
    mediaChildren: string[];
  }

  type Transformer = (tagName: string, attribs: Attributes) => { tagName: string; attribs: Attributes; text?: string };

  interface IOptions {
    allowedTags?: string[] | false;
    allowedAttributes?: Record<string, (string | { name: string; multiple?: boolean; values: string[] })[]> | false;
    allowedClasses?: Record<string, string[] | boolean>;
    allowedStyles?: Record<string, Record<string, RegExp[]>>;
    allowedSchemes?: string[];
    allowedSchemesByTag?: Record<string, string[]>;
    allowedSchemesAppliedToAttributes?: string[];
    allowProtocolRelative?: boolean;
    allowedIframeHostnames?: string[];
    allowedIframeDomains?: string[];
    allowedScriptHostnames?: string[];
    allowVulnerableTags?: boolean;
    disallowedTagsMode?: "discard" | "escape" | "recursiveEscape" | "completelyDiscard";
    nonTextTags?: string[];
    parseStyleAttributes?: boolean;
    selfClosing?: string[];
    enforceHtmlBoundary?: boolean;
    transformTags?: Record<string, string | Transformer>;
    exclusiveFilter?: (frame: Frame) => boolean;
    textFilter?: (text: string, tagName: string) => string;
    onOpenTag?: (name: string, attribs: Attributes) => void;
    onCloseTag?: (name: string, isImplied: boolean) => void;
    nestingLimit?: number;
    parser?: Record<string, unknown>;
  }

  interface SanitizeHtml {
    (dirty: string, options?: IOptions): string;
    defaults: Required<Pick<IOptions, "allowedTags" | "allowedAttributes" | "allowedSchemes" | "selfClosing">> & IOptions;
    simpleTransform(tagName: string, attribs: Attributes, merge?: boolean): Transformer;
  }

  const sanitizeHtml: SanitizeHtml;
  export = sanitizeHtml;
}
