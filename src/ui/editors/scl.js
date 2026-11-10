// SCL (Structured Text) editor on CodeMirror 6: highlighting, tag completion, error lines.
import { autocompletion } from '@codemirror/autocomplete'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { Compartment, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { basicSetup } from 'codemirror'

import { FB } from '../../core/catalog.js'
import { TYPES } from '../../core/model.js'
import { editor } from '../commands.js'
import { h } from '../dom.js'
import { blockById, edit, on, state } from '../store.js'

const KEYWORDS = new Set('IF THEN ELSE ELSIF END_IF CASE OF END_CASE FOR TO BY DO END_FOR WHILE END_WHILE REPEAT UNTIL END_REPEAT EXIT RETURN AND OR XOR NOT MOD TRUE FALSE'.split(' '))
const TYPE_NAMES = new Set([...TYPES.map((x) => x.toUpperCase()), 'BOOL', 'REAL', 'LREAL', 'TIME', 'STRING', ...Object.keys(FB)])

function sclLanguage(tagNames) {
  return StreamLanguage.define({
    startState: () => ({ comment: false }),
    token(stream, st) {
      if (st.comment) { if (stream.skipTo('*)')) { stream.match('*)'); st.comment = false } else stream.skipToEnd(); return 'comment' }
      if (stream.eatSpace()) return null
      if (stream.match('(*')) { st.comment = true; if (stream.skipTo('*)')) { stream.match('*)'); st.comment = false } else stream.skipToEnd(); return 'comment' }
      if (stream.match('//')) { stream.skipToEnd(); return 'comment' }
      if (stream.match(/^'[^']*'/)) return 'string'
      if (stream.match(/^(?:T|TIME)#[0-9A-Za-z_.]+/i)) return 'number'
      if (stream.match(/^%[IQM][XBWD]?\d+(?:\.\d)?/i)) return 'atom'
      if (stream.match(/^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/)) return 'number'
      if (stream.match(/^[A-Za-z_]\w*/)) {
        const w = stream.current().toUpperCase()
        if (KEYWORDS.has(w)) return 'keyword'
        if (TYPE_NAMES.has(w)) return 'typeName'
        if (tagNames().has(stream.current())) return 'variableName.special'
        return 'variableName'
      }
      stream.next(); return null
    },
    languageData: { commentTokens: { line: '//', block: { open: '(*', close: '*)' } } },
    tokenTable: {},
  })
}

const style = HighlightStyle.define([
  { tag: t.keyword, color: '#0b5cad', fontWeight: '600' },
  { tag: t.typeName, color: '#7a5ab4' },
  { tag: t.comment, color: '#5d8f4a', fontStyle: 'italic' },
  { tag: t.number, color: '#b35c00' },
  { tag: t.string, color: '#a31515' },
  { tag: t.atom, color: '#8a5a00' },
  { tag: t.special(t.variableName), color: '#007a7a', fontWeight: '600' },
])

const setErrors = StateEffect.define()
const errorLines = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setErrors)) {
      const b = new RangeSetBuilder()
      for (const ln of [...new Set(e.value)].sort((a, c) => a - c)) if (ln >= 1 && ln <= tr.state.doc.lines) { const pos = tr.state.doc.line(ln).from; b.add(pos, pos, Decoration.line({ class: 'cm-errline' })) }
      return b.finish()
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

export function mountScl(host, tab) {
  const id = tab.id
  const block = () => blockById(id)
  const tagNames = () => new Set(state.project.tags.map((x) => x.name))
  const wrap = h('div', { class: 'scl-code' })
  host.append(h('div', { class: 'ed-body' }, wrap))
  host.lastChild.style.overflow = 'hidden'
  const lang = new Compartment()
  const complete = (ctx) => {
    const w = ctx.matchBefore(/[A-Za-z_][\w.]*/)
    if (!w || (w.from === w.to && !ctx.explicit)) return null
    const locals = Object.values(block().interface).flat().map((v) => ({ label: v.name, type: 'variable', detail: v.type }))
    return { from: w.from, options: [
      ...state.project.tags.map((x) => ({ label: x.name, type: 'variable', detail: `${x.type} ${x.address}`, boost: 2 })), ...locals,
      ...[...KEYWORDS].map((k) => ({ label: k, type: 'keyword' })), ...Object.keys(FB).map((k) => ({ label: k, type: 'class', detail: FB[k].title })),
    ] }
  }
  let applying = false
  const view = new EditorView({
    parent: wrap,
    doc: block().code ?? '',
    extensions: [basicSetup, lang.of(sclLanguage(tagNames)), syntaxHighlighting(style), errorLines, autocompletion({ override: [complete] }), keymap.of([]),
      EditorView.updateListener.of((u) => { if (u.docChanged && !applying) { const text = u.state.doc.toString(); edit((p) => { p.blocks.find((x) => x.id === id).code = text }, `scl:${id}`) } })],
  })
  const paintErrors = () => {
    const lines = state.diagnostics.filter((d) => d.block === id && d.line).map((d) => d.line)
    view.dispatch({ effects: setErrors.of(lines) })
  }
  const offs = [
    on('project', () => { const code = block()?.code ?? ''; if (code !== view.state.doc.toString()) { applying = true; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }); applying = false } }),
    on('diagnostics', paintErrors),
    on('goto', (d) => { if (d?.block === id && d.line) { const ln = view.state.doc.line(Math.min(d.line, view.state.doc.lines)); view.dispatch({ selection: { anchor: ln.from }, scrollIntoView: true }); view.focus() } }),
  ]
  editor.api = { zoom: (d) => { wrap.style.fontSize = `${Math.max(9, Math.min(28, (parseFloat(wrap.style.fontSize) || 13) + d * 10))}px` } }
  paintErrors()
  return { dispose() { offs.forEach((f) => f()); view.destroy() }, focus() { view.focus() } }
}
