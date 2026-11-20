// Runs the real ladder editor inside jsdom so editing actions can be tested like a learner uses them:
// clicks on "+", quick-menu rows, typing in the operand box, shortcuts, undo. jsdom has no layout, so
// anything that depends on pixel positions (the near-pointer reveal, scroll cues) is checked in the browser.
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
let app = null

export async function loadApp() {
  if (app) return app
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
  const w = dom.window
  const keep = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'FocusEvent',
    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'innerWidth', 'innerHeight', 'Blob', 'URL', 'MutationObserver']
  for (const k of keep) Object.defineProperty(globalThis, k, { value: w[k] ?? globalThis[k], configurable: true, writable: true })
  for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) globalThis[k] = w[k].bind(w)
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  w.Element.prototype.scrollIntoView = function () {}
  w.HTMLElement.prototype.scrollBy = function () {}
  mkdirSync(`${root}tests/.build`, { recursive: true })
  const outfile = `${root}tests/.build/ladder.mjs`
  await build({ entryPoints: [`${root}tests/support/ladder-entry.js`], bundle: true, format: 'esm', platform: 'neutral', outfile, loader: { '.stlib': 'json' }, logLevel: 'error', mainFields: ['module', 'main'] })
  const mods = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
  mods.commands.installKeyboard()
  app = { ...mods, window: w, document: w.document }
  return app
}

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms))

/** Fresh project + mounted Main editor. Returns helpers that act like a learner. */
export async function editorWith(project) {
  const a = await loadApp()
  const { store, commands, mountLadder, document } = a
  a.mounted?.dispose(); a.closeQuick(); document.body.replaceChildren()
  store.replaceProject(project)
  const block = store.state.project.blocks.find((b) => b.lang === 'LAD')
  store.state.active = `block:${block.id}`
  const host = document.createElement('div'); host.id = 'editor'; document.body.append(host)
  a.mounted = mountLadder(host, { id: block.id })
  const $ = (sel, el = document) => el.querySelector(sel)
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)]
  const net = (i) => $(`.net[data-ni="${i}"]`)
  const lad = () => store.state.project.blocks.find((b) => b.id === block.id)
  const h = {
    a, store, document, $, $$, net, lad, wait,
    networks: () => lad().networks,
    /** The "+" button on the wire at `gap` in network `ni`. */
    plus: (ni, gap) => $$('[data-gap]', net(ni)).find((s) => s.dataset.gap === JSON.stringify(gap))?.querySelector('.gap-plus'),
    async clickPlus(ni, gap) { const b = h.plus(ni, gap); if (!b) throw new Error(`no + at ${ni} ${JSON.stringify(gap)}`); h.mouse(b, 'mousedown'); b.click(); await wait(5) },
    menuRows: () => $$('.quick-menu .qm-row').map((r) => r.querySelector('b')?.textContent),
    async pick(label) { const r = $$('.quick-menu .qm-row').find((x) => x.querySelector('b')?.textContent === label); if (!r) throw new Error(`no menu row "${label}" in ${JSON.stringify(h.menuRows())}`); r.click(); await wait(40) },
    input: () => $('.op-edit'),
    async type(text, key = 'Enter', opts = {}) { const i = h.input(); if (!i) throw new Error('no operand box open'); i.value = text; h.key(i, key, opts); await wait(40) },
    key(target, key, opts = {}) { target.dispatchEvent(new a.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })) },
    async shortcut(key, opts = {}) { h.key(document.activeElement ?? document.body, key, opts); await wait(40) },
    mouse(el, type, opts = {}) { el.dispatchEvent(new a.window.MouseEvent(type, { bubbles: true, cancelable: true, ...opts })) },
    async dbl(el) { el.dispatchEvent(new a.window.MouseEvent('dblclick', { bubbles: true })); await wait(5) },
    bubble: () => $('.tag-bubble'),
    toast: () => $('.toast')?.textContent ?? '',
    select: (s) => store.select({ block: block.id, ...s }),
    run: (id) => commands.commands.get(id).run(),
    api: () => commands.editor.api,
  }
  await wait(30)
  return h
}

/** A one-block LAD project with the given networks (and some Bool / Int tags). */
export function projectWith(networks, extraTags = []) {
  return {
    version: 1, name: 'T', plc: { name: 'PLC_1', cycleMs: 10 },
    tags: [
      { name: 'A', type: 'Bool', address: '%I0.0' }, { name: 'B', type: 'Bool', address: '%I0.1' }, { name: 'C', type: 'Bool', address: '%I0.2' },
      { name: 'Y', type: 'Bool', address: '%Q0.0' }, { name: 'Z', type: 'Bool', address: '%Q0.1' }, { name: 'N1', type: 'Int', address: '%MW10' }, ...extraTags,
    ],
    blocks: [{ id: 'main', kind: 'OB', name: 'Main', number: 1, lang: 'LAD', interface: { input: [], output: [], inout: [], static: [], temp: [] }, networks, comment: '' }],
    watch: [],
  }
}
export const net = (elements = [], coils = [], extra = {}) => ({ id: `n${Math.random().toString(36).slice(2, 8)}`, title: '', comment: '', elements, coils, ...extra })
export const NO = (tag) => ({ k: 'NO', tag })
export const NC = (tag) => ({ k: 'NC', tag })
export const coil = (tag, k = 'coil') => ({ k, tag })
