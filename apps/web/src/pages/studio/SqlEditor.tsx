import { autocompletion } from '@codemirror/autocomplete';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { Dataset } from '@querion/engine';

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--accent)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#e8c48a' },
  { tag: [t.number, t.bool, t.null], color: '#ff9e7a' },
  { tag: t.comment, color: 'var(--faint)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.standard(t.name)], color: 'var(--accent-2)' },
  { tag: [t.operator, t.punctuation], color: 'var(--muted)' },
  { tag: t.typeName, color: '#b9a7ff' },
  { tag: [t.name, t.variableName, t.propertyName], color: 'var(--text)' },
]);

const chrome = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '12px 0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--accent) 6%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in oklab, var(--accent) 28%, transparent) !important' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in oklab, var(--accent-2) 25%, transparent)', outline: 'none' },
  '.cm-placeholder': { color: 'var(--faint)' },
});

// error-line decoration driven from outside
const setErrorLine = StateEffect.define<number | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null || e.value > tr.state.doc.lines) return Decoration.none;
        const line = tr.state.doc.line(e.value);
        return Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
      }
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface SqlEditorHandle {
  focus: () => void;
  insert: (text: string) => void;
  markErrorLine: (line: number | null) => void;
  getSelectionOrAll: () => string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  dataset?: Dataset;
  onRun: () => void;
  onSubmit: () => void;
  onFormat: () => void;
}

export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor({ value, onChange, dataset, onRun, onSubmit, onFormat }, ref) {
  const cm = useRef<ReactCodeMirrorRef>(null);
  const actions = useRef({ onRun, onSubmit, onFormat });
  actions.current = { onRun, onSubmit, onFormat };

  useImperativeHandle(ref, () => ({
    focus: () => cm.current?.view?.focus(),
    insert: (text) => {
      const v = cm.current?.view;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      v.focus();
    },
    markErrorLine: (line) => cm.current?.view?.dispatch({ effects: setErrorLine.of(line) }),
    getSelectionOrAll: () => {
      const v = cm.current?.view;
      if (!v) return value;
      const { from, to } = v.state.selection.main;
      return from !== to ? v.state.sliceDoc(from, to) : v.state.doc.toString();
    },
  }));

  // schema-aware completion: tables, columns (incl. table.column), Postgres keywords
  const extensions = useMemo<Extension[]>(() => {
    const schema: Record<string, string[]> = {};
    for (const tb of dataset?.tables ?? []) schema[tb.name] = tb.columns.map((c) => c.name);
    return [
      sql({ dialect: PostgreSQL, schema, upperCaseKeywords: true }),
      autocompletion({ activateOnTyping: true, maxRenderedOptions: 30, icons: true }),
      syntaxHighlighting(highlight),
      chrome,
      errorField,
      EditorState.tabSize.of(2),
      Prec.highest(
        keymap.of([
          { key: 'Mod-Enter', run: () => (actions.current.onRun(), true) },
          { key: 'Shift-Mod-Enter', run: () => (actions.current.onSubmit(), true) },
          { key: 'Mod-s', run: () => (actions.current.onFormat(), true), preventDefault: true },
        ])
      ),
    ];
  }, [dataset]);

  return (
    <CodeMirror
      ref={cm}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      height="100%"
      placeholder="-- Write your PostgreSQL query here. Ctrl/⌘+Enter to run."
      basicSetup={{ foldGutter: false, highlightActiveLineGutter: true, autocompletion: false, searchKeymap: true, closeBrackets: true, bracketMatching: true }}
      className="h-full"
      aria-label="SQL editor"
    />
  );
});
