'use client';

import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { useWorkspace } from './context';

// Served from our own origin (scripts/copy-monaco.mjs), never a CDN.
loader.config({ paths: { vs: '/monaco/vs' } });

type Monaco = Parameters<BeforeMount>[0];
type CodeEditor = Parameters<OnMount>[0];

export interface EditorMarker {
  /** UTF-16 index into the editor text. */
  readonly start: number;
  readonly message: string;
}

const defineThemes: BeforeMount = (monaco) => {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim().replace('#', '');
  const light = window.matchMedia('(prefers-color-scheme: light)').matches;
  monaco.editor.defineTheme('sqlscope', {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: token('--structure'), fontStyle: 'bold' },
      { token: 'string', foreground: token('--sev-warning') },
      { token: 'number', foreground: token('--accent') },
      { token: 'comment', foreground: token('--text-faint'), fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': `#${token('--surface-1')}`,
      'editor.lineHighlightBackground': `#${token('--surface-2')}`,
      'editorLineNumber.foreground': `#${token('--text-faint')}`,
    },
  });
};

export function SqlEditor({ markers }: { markers: readonly EditorMarker[] }) {
  const sql = useWorkspace((s) => s.sql);
  const setSql = useWorkspace((s) => s.setSql);
  const run = useWorkspace((s) => s.run);
  const editorRef = useRef<CodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  // Actions registered once must still call the latest `run`.
  const runRef = useRef(run);
  runRef.current = run;

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addAction({
      id: 'sqlscope.run',
      label: 'Executar script',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => void runRef.current(),
    });
    editor.addAction({
      id: 'sqlscope.run-selection',
      label: 'Executar seleção',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: (e) => {
        const selection = e.getSelection();
        const text = selection ? e.getModel()?.getValueInRange(selection) : '';
        void runRef.current(text?.trim() ? text : undefined);
      },
    });
    editor.focus();
  };

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      'sqlscope',
      markers.map((marker) => {
        const start = model.getPositionAt(marker.start);
        const word = model.getWordAtPosition(start);
        return {
          severity: monaco.MarkerSeverity.Error,
          message: marker.message,
          startLineNumber: start.lineNumber,
          startColumn: word?.startColumn ?? start.column,
          endLineNumber: start.lineNumber,
          endColumn: word?.endColumn ?? start.column + 1,
        };
      }),
    );
  }, [markers]);

  return (
    <Editor
      language="sql"
      theme="sqlscope"
      value={sql}
      onChange={(value) => setSql(value ?? '')}
      beforeMount={defineThemes}
      onMount={onMount}
      loading={<div className="p-4 text-[13px] text-faint">Carregando editor…</div>}
      options={{
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 12 },
        ariaLabel: 'Editor SQL. Ctrl+Enter executa; Ctrl+Shift+Enter executa a seleção.',
      }}
    />
  );
}
