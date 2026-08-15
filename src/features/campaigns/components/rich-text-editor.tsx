"use client";

import { useState } from "react";
import {
  Bold,
  Braces,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pilcrow,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type RichTextEditorProps = {
  name: string;
  initialValue?: string;
  placeholder?: string;
};

const PERSONALIZATION_TOKENS = [
  { label: "First name", value: "{{first_name}}" },
  { label: "Last name", value: "{{last_name}}" },
  { label: "Email", value: "{{email}}" },
] as const;

export function RichTextEditor({
  name,
  initialValue = "",
  placeholder = "Write your email message...",
}: RichTextEditorProps) {
  const [html, setHtml] = useState(initialValue);
  const [sourceMode, setSourceMode] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          HTMLAttributes: {
            rel: "noopener noreferrer nofollow",
            target: "_blank",
          },
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialValue,
    editorProps: {
      attributes: {
        class:
          "min-h-72 px-4 py-3 text-sm text-slate-900 focus:outline-none [&_a]:text-indigo-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-slate-200 [&_blockquote]:pl-4 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-6",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      setHtml(currentEditor.getHTML());
    },
  });

  function switchMode() {
    if (sourceMode && editor) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
    setSourceMode((current) => !current);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
      <input type="hidden" name={name} value={html} />

      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-2">
        {!sourceMode && editor ? (
          <>
            <ToolbarButton
              label="Paragraph"
              active={editor.isActive("paragraph")}
              onClick={() => editor.chain().focus().setParagraph().run()}
            >
              <Pilcrow className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Heading 1"
              active={editor.isActive("heading", { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            >
              <Heading1 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Heading 2"
              active={editor.isActive("heading", { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <Heading2 className="h-4 w-4" />
            </ToolbarButton>

            <ToolbarDivider />

            <ToolbarButton
              label="Bold"
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Italic"
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Underline"
              active={editor.isActive("underline")}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <Underline className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Strikethrough"
              active={editor.isActive("strike")}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              <Strikethrough className="h-4 w-4" />
            </ToolbarButton>

            <ToolbarDivider />

            <ToolbarButton
              label="Bullet list"
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Numbered list"
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Add or edit link"
              active={editor.isActive("link")}
              onClick={() => setLink(editor)}
            >
              <LinkIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Clear formatting"
              onClick={() =>
                editor.chain().focus().unsetAllMarks().clearNodes().run()
              }
            >
              <RemoveFormatting className="h-4 w-4" />
            </ToolbarButton>

            <ToolbarDivider />

            <ToolbarButton
              label="Undo"
              disabled={!editor.can().chain().focus().undo().run()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton
              label="Redo"
              disabled={!editor.can().chain().focus().redo().run()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 className="h-4 w-4" />
            </ToolbarButton>

            <div className="ml-auto flex flex-wrap items-center gap-1">
              <span className="hidden text-xs text-slate-500 sm:inline">Insert:</span>
              {PERSONALIZATION_TOKENS.map((token) => (
                <button
                  key={token.value}
                  type="button"
                  title={`Insert ${token.value}`}
                  onClick={() =>
                    editor.chain().focus().insertContent(token.value).run()
                  }
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-indigo-200 hover:text-indigo-600"
                >
                  {token.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 px-1 text-xs text-slate-500">
            <Code2 className="h-4 w-4" />
            Edit the generated HTML directly
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={switchMode}
          className={cn("ml-auto", !sourceMode && "lg:ml-1")}
        >
          {sourceMode ? (
            <>
              <Braces className="h-4 w-4" />
              Visual editor
            </>
          ) : (
            <>
              <Code2 className="h-4 w-4" />
              HTML
            </>
          )}
        </Button>
      </div>

      {sourceMode ? (
        <Textarea
          value={html}
          onChange={(event) => setHtml(event.target.value)}
          rows={14}
          aria-label="Email HTML source"
          className="min-h-72 resize-y rounded-none border-0 font-mono text-xs shadow-none focus-visible:border-0 focus-visible:ring-0"
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}

function setLink(editor: Editor) {
  const previousUrl = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt("Enter a link URL:", previousUrl ?? "https://");

  if (url === null) {
    return;
  }

  if (url.trim() === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }

  editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: url.trim() })
    .run();
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="mx-1 h-6 w-px bg-slate-200" />;
}

type ToolbarButtonProps = {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-white hover:text-slate-900 disabled:pointer-events-none disabled:opacity-30",
        active && "bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200",
      )}
    >
      {children}
    </button>
  );
}
