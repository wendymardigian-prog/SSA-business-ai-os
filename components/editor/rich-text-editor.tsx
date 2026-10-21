"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, Node, mergeAttributes, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading1, Heading2, Heading3, Italic, Link2, List, ListOrdered, Underline as UnderlineIcon, Unlink } from "lucide-react";
import { EmojiButton } from "@/components/ui/emoji-picker";
import { bodyToEditorHtml, editorHtmlToBody, normalizeLink } from "@/lib/editor/email-body";

/**
 * Editor de texto con formato para el cuerpo de un email (y, mas adelante, el
 * texto de un contrato). Negrita, cursiva, subrayado, titulos (H1 a H3), listas,
 * enlaces, emojis y variables como fichas.
 *
 * - Guarda HTML en el mismo campo de siempre; un texto plano viejo se abre como
 *   parrafos (`bodyToEditorHtml`). Lo que sale pasa igual por la lista blanca
 *   de `lib/email/html.ts` al enviar: este editor no es la defensa.
 * - Una variable es una FICHA indivisible: el formato (negrita, enlace) puede
 *   envolverla pero no partirla, asi `{{contact.first_name}}` no se rompe.
 * - Mientras se escribe, el formato queda activo (negrita, por ejemplo) hasta
 *   que se apaga: es el comportamiento de ProseMirror.
 */

const VariableChip = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-variable") ?? "",
        renderHTML: (attrs: { name?: string }) => ({ "data-variable": attrs.name ?? "" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-variable]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), `{{${node.attrs.name}}}`];
  },
  renderText({ node }) {
    return `{{${node.attrs.name}}}`;
  },
});

/**
 * Cómo se guarda lo que escribe la persona. Sin esto, HTML (el cuerpo de un email). El contrato guarda Markdown
 * acotado (`lib/forms/contract/editor-markdown.ts`): abre el texto como documento y lo vuelve a armar al cambiar.
 */
export interface RichTextFormat {
  load: (value: string) => JSONContent;
  save: (doc: JSONContent) => string;
}

export interface RichTextEditorApi {
  /** Mete un texto (un recurso de la banca, por ejemplo) donde esta el cursor. */
  insertText: (text: string) => void;
}

export function RichTextEditor({
  id,
  value,
  onChange,
  label,
  variables,
  disabled = false,
  minHeight = 160,
  extraToolbar,
  format,
  underline = true,
  emoji = true,
}: {
  id: string;
  value: string;
  onChange: (body: string) => void;
  /** El nombre accesible del campo. */
  label: string;
  /** Las variables que se pueden insertar como ficha. */
  variables?: string[];
  disabled?: boolean;
  minHeight?: number;
  extraToolbar?: (api: RichTextEditorApi) => ReactNode;
  format?: RichTextFormat;
  /** El botón de subrayado (el Markdown del contrato no lo tiene). */
  underline?: boolean;
  /** El selector de emojis (el PDF del contrato no los puede escribir). */
  emoji?: boolean;
}) {
  const lastEmitted = useRef<string>(value);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        horizontalRule: false,
        blockquote: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" } },
        ...(underline ? {} : { underline: false as const }),
      }),
      VariableChip,
    ],
    content: format ? format.load(value) : bodyToEditorHtml(value),
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        class: "rich-text-body focus:outline-none",
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      const next = format ? format.save(ed.getJSON()) : editorHtmlToBody(ed.getHTML());
      lastEmitted.current = next;
      onChange(next);
    },
  });

  // Un cambio que viene de afuera (deshacer del arbol, otro paso) se refleja;
  // lo que el propio editor acaba de emitir no se vuelve a escribir.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(format ? format.load(value) : bodyToEditorHtml(value), { emitUpdate: false });
  }, [value, editor, format]);

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [disabled, editor]);

  if (!editor) {
    return <div className="rounded-lg border border-input bg-background" style={{ minHeight: minHeight + 40 }} aria-busy="true" />;
  }

  const api: RichTextEditorApi = {
    insertText: (text) => editor.chain().focus().insertContent(text).run(),
  };

  return (
    <div className="rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <Toolbar editor={editor} variables={variables} disabled={disabled} extra={extraToolbar?.(api)} underline={underline} emoji={emoji} />
      <div
        className={`px-3 py-2 text-sm [&_.rich-text-body_h1]:mb-2 [&_.rich-text-body_h1]:text-xl [&_.rich-text-body_h1]:font-bold [&_.rich-text-body_h2]:mb-2 [&_.rich-text-body_h2]:text-lg [&_.rich-text-body_h2]:font-bold [&_.rich-text-body_h3]:mb-1.5 [&_.rich-text-body_h3]:text-base [&_.rich-text-body_h3]:font-bold [&_.rich-text-body_p]:mb-2 [&_.rich-text-body_ul]:mb-2 [&_.rich-text-body_ul]:list-disc [&_.rich-text-body_ul]:pl-6 [&_.rich-text-body_ol]:mb-2 [&_.rich-text-body_ol]:list-decimal [&_.rich-text-body_ol]:pl-6 [&_.rich-text-body_a]:text-blue-600 [&_.rich-text-body_a]:underline [&_[data-variable]]:rounded [&_[data-variable]]:bg-muted [&_[data-variable]]:px-1 [&_[data-variable]]:font-mono [&_[data-variable]]:text-xs ${
          disabled ? "opacity-70" : ""
        }`}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active ?? false}
      disabled={disabled}
      // mouseDown no pierde la seleccion del editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 ${
        active ? "bg-accent text-foreground" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({
  editor,
  variables,
  disabled,
  extra,
  underline,
  emoji,
}: {
  editor: Editor;
  variables?: string[];
  disabled: boolean;
  extra?: ReactNode;
  underline: boolean;
  emoji: boolean;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [, force] = useState(0);

  // Que la barra refleje donde esta el cursor (negrita activa, etc.).
  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);
    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const run = (fn: () => void) => () => {
    if (!disabled) fn();
  };

  const openLink = () => {
    setLinkValue((editor.getAttributes("link").href as string | undefined) ?? "");
    setLinkError(false);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = normalizeLink(linkValue);
    if (!href) {
      setLinkError(true);
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  };

  return (
    <div role="toolbar" aria-label="Formato del texto" className="border-b border-input px-1.5 py-1">
      <div className="flex flex-wrap items-center gap-0.5">
        <ToolButton label="Negrita" active={editor.isActive("bold")} disabled={disabled} onClick={run(() => editor.chain().focus().toggleBold().run())}>
          <Bold className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Cursiva" active={editor.isActive("italic")} disabled={disabled} onClick={run(() => editor.chain().focus().toggleItalic().run())}>
          <Italic className="h-4 w-4" aria-hidden />
        </ToolButton>
        {underline && (
          <ToolButton label="Subrayado" active={editor.isActive("underline")} disabled={disabled} onClick={run(() => editor.chain().focus().toggleUnderline().run())}>
            <UnderlineIcon className="h-4 w-4" aria-hidden />
          </ToolButton>
        )}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Título grande" active={editor.isActive("heading", { level: 1 })} disabled={disabled} onClick={run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>
          <Heading1 className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Título mediano" active={editor.isActive("heading", { level: 2 })} disabled={disabled} onClick={run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>
          <Heading2 className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Título chico" active={editor.isActive("heading", { level: 3 })} disabled={disabled} onClick={run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>
          <Heading3 className="h-4 w-4" aria-hidden />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Lista con viñetas" active={editor.isActive("bulletList")} disabled={disabled} onClick={run(() => editor.chain().focus().toggleBulletList().run())}>
          <List className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Lista numerada" active={editor.isActive("orderedList")} disabled={disabled} onClick={run(() => editor.chain().focus().toggleOrderedList().run())}>
          <ListOrdered className="h-4 w-4" aria-hidden />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolButton label="Enlace" active={editor.isActive("link")} disabled={disabled} onClick={run(openLink)}>
          <Link2 className="h-4 w-4" aria-hidden />
        </ToolButton>
        {editor.isActive("link") && (
          <ToolButton label="Quitar enlace" disabled={disabled} onClick={run(() => editor.chain().focus().extendMarkRange("link").unsetLink().run())}>
            <Unlink className="h-4 w-4" aria-hidden />
          </ToolButton>
        )}
        {emoji && (
          <EmojiButton
            // El emoji va donde estaba el cursor; el foco se queda en el selector para elegir varios.
            onPick={(picked) => editor.commands.insertContent(picked)}
            focusRef={undefined}
            placement="bottom"
            align="start"
            disabled={disabled}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          />
        )}
        {variables && variables.length > 0 && (
          <select
            aria-label="Insertar variable"
            disabled={disabled}
            value=""
            onChange={(event) => {
              const name = event.target.value;
              if (name) editor.chain().focus().insertContent({ type: "variable", attrs: { name } }).run();
            }}
            className="ml-1 h-8 max-w-[10rem] rounded-md border border-input bg-background px-1.5 text-xs"
          >
            <option value="">Variable…</option>
            {variables.map((name) => (
              <option key={name} value={name}>{`{{${name}}}`}</option>
            ))}
          </select>
        )}
        {extra}
      </div>
      {linkOpen && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 pb-1">
          <input
            autoFocus
            type="text"
            value={linkValue}
            aria-label="Dirección del enlace"
            aria-invalid={linkError}
            placeholder="https://… o ana@correo.com"
            onChange={(event) => {
              setLinkValue(event.target.value);
              setLinkError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
          />
          <button type="button" onClick={applyLink} className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
            Aplicar
          </button>
          <button type="button" onClick={() => setLinkOpen(false)} className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent">
            Cancelar
          </button>
          {linkError && <p role="alert" className="w-full text-xs text-destructive">Ese enlace no es válido. Probá con https://… o un email.</p>}
        </div>
      )}
    </div>
  );
}
