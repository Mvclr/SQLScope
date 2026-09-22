'use client';

import Editor, { loader, type BeforeMount, type OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { editorPalette } from '../../lib/editor-theme';
import { useTheme } from '../../lib/theme-client';
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

const THEME = 'sqlscope';
const FONT = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

/**
 * (Re)defines the editor theme from the tokens in effect right now. Called again whenever
 * the page theme changes: the tokens are only readable for the active theme.
 */
function defineTheme(monaco: Monaco) {
  const css = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme === 'dark';
  const palette = editorPalette((token) => css.getPropertyValue(token), dark);
  const base = dark ? 'vs-dark' : 'vs';

  try {
    monaco.editor.defineTheme(THEME, {
      base,
      inherit: true,
      rules: [
        { token: 'keyword', foreground: palette.keyword, fontStyle: 'bold' },
        { token: 'string', foreground: palette.string },
        { token: 'number', foreground: palette.number },
        { token: 'comment', foreground: palette.comment, fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': `#${palette.background}`,
        'editorGutter.background': `#${palette.background}`,
        'editor.lineHighlightBackground': `#${palette.lineHighlight}`,
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': `#${palette.lineNumber}`,
        'editorLineNumber.activeForeground': `#${palette.keyword}`,
      },
    });
  } catch (error) {
    // Colours are already validated; if Monaco still refuses them, an editor with the
    // stock theme is far better than no editor at all.
    console.warn('SQLScope: falling back to the default editor theme', error);
    monaco.editor.defineTheme(THEME, { base, inherit: true, rules: [] });
  }
}

export function SqlEditor({ markers }: { markers: readonly EditorMarker[] }) {
  const sql = useWorkspace((s) => s.sql);
  const setSql = useWorkspace((s) => s.setSql);
  const run = useWorkspace((s) => s.run);
  const { theme } = useTheme();
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
    // Monaco measures glyphs once; if the web font arrives later, the cursor drifts from
    // the text until it measures again.
    void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
    editor.focus();
  };

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !theme) return;
    defineTheme(monaco);
    monaco.editor.setTheme(THEME);
  }, [theme]);

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
      theme={THEME}
      value={sql}
      onChange={(value) => setSql(value ?? '')}
      beforeMount={defineTheme}
      onMount={onMount}
      loading={<div className="p-4 text-[13px] text-faint">Carregando editor…</div>}
      options={{
        fontFamily: FONT,
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 14, bottom: 8 },
        lineNumbersMinChars: 3,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        ariaLabel: 'Editor SQL. Ctrl+Enter executa; Ctrl+Shift+Enter executa a seleção.',
      }}
    />
  );
}
