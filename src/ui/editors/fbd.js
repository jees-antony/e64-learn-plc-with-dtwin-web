// Function block diagram (FBD) editor. A network is a tree of boxes feeding one output.
// Mouse: click a pin to select it, double-click to type an operand, drag a box from the task card
// onto a pin, right-click a pin for the insert menu.
import { COMPARE, DEFAULT_PIN, FB, LOGIC, MATH } from '../../core/catalog.js'
import { newNetwork } from '../../core/model.js'
import { contextMenu, h } from '../dom.js'
import { editor } from '../commands.js'
import { isOnline, readOperand } from '../online.js'
import { PALETTE } from '../palette.js'
import { blockById, edit, on, select, state } from '../store.js'

const LABEL = { and: '&', or: '≥1', xor: 'XOR', not: 'NOT', cmp: 'CMP', add: 'ADD', sub: 'SUB', mul: 'MUL', div: 'DIV', mod: 'MOD' }
const clone = (x) => JSON.parse(JSON.stringify(x))
const pk = (p) => p.join('.')
function nodeAt(root, path) { let n = root; for (const i of path) n = n?.in?.[i] ?? n?.args?.[i]; return n }
function setAt(net, path, value) {
  if (!path.length) { net.expr = value; return }
  let n = net.expr
  for (const i of path.slice(0, -1)) n = n.in?.[i] ?? n.args?.[i]
  const last = path.at(-1)
  if (n.t === 'fb') { n.args = n.args ?? {}; n.args[last] = value } else { n.in = n.in ?? []; n.in[last] = value }
}
function nodeFrom(payload, usedInst) {
  if (payload.t === 'var') return { t: 'var', name: '' }
  if (payload.t === 'not') return { t: 'not', in: [null] }
  if (payload.t === 'fb') { let i = 1; while (usedInst.has(`${payload.fb}_${i}`)) i++; return { t: 'fb', fb: payload.fb, inst: `${payload.fb}_${i}`, args: {}, out: FB[payload.fb].flowOut } }
  if (payload.t === 'cmp') return { t: 'cmp', op: payload.op ?? '==', in: [null, null] }
  return { t: payload.t, in: [null, null] }
}

export function mountFbd(host, tab) {
  const blockId = tab.id
  const block = () => blockById(blockId)
  const body = h('div', { class: 'ed-body', style: { background: '#eef1f4' } })
  const root = h('div', { class: 'lad' })
  body.append(root); host.append(body)
  let zoom = 1
  const sel = () => (state.selection?.block === blockId ? state.selection : null)
  const setSel = (s) => select({ block: blockId, ...s })
  const usedInst = () => { const s = new Set(); const walk = (n) => { if (!n) return; if (n.inst) s.add(n.inst); (n.in ?? []).forEach(walk); Object.values(n.args ?? {}).forEach(walk) }; block().networks.forEach((x) => walk(x.expr)); return s }
  const tagOptions = () => [...state.project.tags.map((t) => t.name), ...Object.values(block().interface).flat().map((v) => v.name)]

  function put(ni, path, node) { edit((p) => { setAt(p.blocks.find((x) => x.id === blockId).networks[ni], path, node) }); state.selection = { block: blockId, network: ni, pin: path }; }
  function operandEdit(el, ni, path, initial) {
    document.querySelector('.op-edit')?.remove()
    const r = el.getBoundingClientRect(), id = `dl${Math.random().toString(36).slice(2)}`
    const input = h('input', { class: 'op-edit', value: initial ?? '', list: id, style: { left: `${r.left - 2}px`, top: `${r.top - 1}px`, width: `${Math.max(100, r.width + 10)}px` } })
    const dl = h('datalist', { id }, tagOptions().map((n) => h('option', { value: n })))
    document.body.append(dl, input); input.focus(); input.select()
    let done = false
    const finish = (ok) => { if (done) return; done = true; const v = input.value.trim(); input.remove(); dl.remove(); if (ok && v !== (initial ?? '')) put(ni, path, v ? { t: 'var', name: v } : null) }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') finish(false); e.stopPropagation() })
    input.addEventListener('blur', () => finish(true))
  }
  const insertAt = (ni, path, payload) => put(ni, path, nodeFrom(payload, usedInst()))
  function menu(ev, ni, path) {
    const items = [{ label: 'Operand…', run: () => operandEdit(ev.target.closest('.leaf') ?? ev.target, ni, path, nodeAt(block().networks[ni].expr, path)?.name) }, '-']
    for (const g of PALETTE) for (const it of g.items.filter((i) => i.fbd && !i.fbd.out)) items.push({ label: `${g.group}  ›  ${it.name}`, run: () => insertAt(ni, path, it.fbd) })
    items.push('-', { label: 'Clear', run: () => put(ni, path, null) })
    const n = nodeAt(block().networks[ni].expr, path)
    if (n && ['and', 'or', 'xor', 'add', 'mul'].includes(n.t)) items.push({ label: 'Add input', run: () => edit((p) => { const x = nodeAt(p.blocks.find((q) => q.id === blockId).networks[ni].expr, path); x.in.push(null) }) })
    contextMenu(ev.clientX, ev.clientY, items)
  }

  /* ---- rendering ---- */
  function pinWire(ni, path) { return h('div', { class: 'fwire', dataset: { p: `${ni}:${pk(path)}` } }) }
  function leaf(n, ni, path) {
    const text = n?.t === 'var' ? n.name : ''
    const el = h('div', { class: `leaf${text ? '' : ' empty'}${sel()?.network === ni && sel()?.pin && pk(sel().pin) === pk(path) ? ' sel' : ''}`, dataset: { p: `${ni}:${pk(path)}` },
      onMousedown: (e) => { e.stopPropagation(); setSel({ network: ni, pin: path }) }, onDblclick: (e) => { e.stopPropagation(); operandEdit(el, ni, path, text) }, onContextmenu: (e) => { e.preventDefault(); e.stopPropagation(); setSel({ network: ni, pin: path }); menu(e, ni, path) } }, text || '<??.?>')
    return el
  }
  function inputRow(child, pinName, ni, path) {
    return h('div', { class: 'fpin' }, child.kind === 'leaf' ? child.el : child.el, pinWire(ni, path), h('span', { class: 'pname' }, pinName))
  }
  function node(n, ni, path) {
    if (!n || n.t === 'var') return { kind: 'leaf', el: leaf(n, ni, path) }
    let pins, label, info = null
    if (n.t === 'fb') {
      const def = FB[n.fb]; label = def.label; info = n.inst
      pins = Object.keys(def.in).map((pin) => ({ name: pin, key: pin, child: node(n.args?.[pin] ?? null, ni, [...path, pin]), def: DEFAULT_PIN[def.in[pin]] }))
    } else {
      label = LABEL[n.t]
      const names = n.t === 'not' ? ['IN'] : n.t === 'cmp' ? ['A', 'B'] : (n.in ?? []).map((_, i) => `IN${i + 1}`)
      pins = names.map((name, i) => ({ name, key: i, child: node(n.in?.[i] ?? null, ni, [...path, i]) }))
      if (n.t === 'cmp') info = n.op
    }
    const isSel = sel()?.network === ni && sel()?.pin && pk(sel().pin) === pk(path)
    const outs = n.t === 'fb' ? Object.keys(FB[n.fb].out) : []
    const el = h('div', { class: 'fnode' },
      h('div', { class: 'fins' }, pins.map((p) => inputRow(p.child, p.name, ni, [...path, p.key]))),
      h('div', { class: `fbox${isSel ? ' sel' : ''}`, dataset: { p: `${ni}:${pk(path)}` }, onMousedown: (e) => { e.stopPropagation(); setSel({ network: ni, pin: path }) }, onContextmenu: (e) => { e.preventDefault(); e.stopPropagation(); setSel({ network: ni, pin: path }); menu(e, ni, path) } },
        h('div', { class: 'bh' }, label), info ? (n.t === 'cmp' ? h('div', { class: 'bi' }, h('select', { class: 'in', onChange: (e) => edit((p) => { nodeAt(p.blocks.find((q) => q.id === blockId).networks[ni].expr, path).op = e.target.value }) }, COMPARE.map((o) => h('option', { value: o, selected: o === n.op }, o)))) : h('div', { class: 'bi' }, info)) : null,
        outs.length ? h('div', { class: 'bi' }, outs.map((o) => h('span', { style: { cursor: 'pointer', padding: '0 4px', fontWeight: o === n.out ? 700 : 400, color: o === n.out ? '#007a7a' : '' }, title: `Use output ${o}`, onClick: (e) => { e.stopPropagation(); edit((p) => { nodeAt(p.blocks.find((q) => q.id === blockId).networks[ni].expr, path).out = o }) } }, o))) : null,
        h('div', { class: 'bi mon-val', dataset: { mv: `${ni}:${pk(path)}` } })))
    void MATH; void LOGIC
    return { kind: 'node', el }
  }
  function network(net, ni) {
    const tree = node(net.expr, ni, [])
    const out = h('div', { class: 'fout', onMousedown: (e) => { e.stopPropagation(); setSel({ network: ni, out: true }) }, onDblclick: (e) => outEdit(e.currentTarget, ni, net.out?.tag) }, `${net.out?.mode === 'S' ? '(S) ' : net.out?.mode === 'R' ? '(R) ' : ''}${net.out?.tag || '<??.?>'}`)
    const nv = h('div', { class: 'net', dataset: { ni } },
      h('div', { class: 'net-head' }, `Network ${ni + 1}:`, h('input', { class: 'ntitle', value: net.title ?? '', placeholder: 'Title…', onInput: (e) => edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].title = e.target.value }, `nt:${net.id}`), onMousedown: (e) => e.stopPropagation() })),
      h('div', { class: 'fbd-net' }, tree.el, pinWire(ni, ['out']), out))
    nv.addEventListener('mousedown', () => setSel({ network: ni }))
    nv.addEventListener('contextmenu', (e) => { e.preventDefault(); setSel({ network: ni }); contextMenu(e.clientX, e.clientY, [{ label: 'Insert network', keys: 'Ctrl+R', run: () => insertNetwork(true) }, { label: 'Delete network', keys: 'Delete', run: remove }]) })
    nv.addEventListener('dragover', (e) => e.preventDefault())
    nv.addEventListener('drop', (e) => {
      e.preventDefault()
      try {
        const p = JSON.parse(e.dataTransfer.getData('text/plain')); if (!p.fbd) return
        const t = e.target.closest?.('[data-p]'); const path = t ? (t.dataset.p.split(':')[1] === '' ? [] : t.dataset.p.split(':')[1].split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x))) : []
        if (p.fbd.out) edit((pr) => { pr.blocks.find((x) => x.id === blockId).networks[ni].out.mode = p.fbd.out }); else insertAt(ni, path, p.fbd)
      } catch { /* not ours */ }
    })
    return nv
  }
  function outEdit(el, ni, initial) {
    document.querySelector('.op-edit')?.remove()
    const r = el.getBoundingClientRect(), id = `dl${Math.random().toString(36).slice(2)}`
    const input = h('input', { class: 'op-edit', value: initial ?? '', list: id, style: { left: `${r.left}px`, top: `${r.top}px` } })
    const dl = h('datalist', { id }, tagOptions().map((n) => h('option', { value: n })))
    document.body.append(dl, input); input.focus(); input.select()
    let done = false
    const finish = (ok) => { if (done) return; done = true; const v = input.value.trim(); input.remove(); dl.remove(); if (ok) edit((p) => { p.blocks.find((x) => x.id === blockId).networks[ni].out.tag = v }) }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') finish(false); e.stopPropagation() })
    input.addEventListener('blur', () => finish(true))
  }

  /* ---- commands ---- */
  function insertNetwork(after = true) { edit((p) => { const b = p.blocks.find((x) => x.id === blockId); const i = sel()?.network ?? b.networks.length - 1; b.networks.splice(after ? i + 1 : i, 0, newNetwork('FBD')); state.selection = { block: blockId, network: after ? i + 1 : i } }) }
  function remove() {
    const s = sel(); if (!s) return
    edit((p) => {
      const b = p.blocks.find((x) => x.id === blockId)
      if (s.pin) { setAt(b.networks[s.network], s.pin, null); return }
      b.networks.splice(s.network, 1); if (!b.networks.length) b.networks.push(newNetwork('FBD')); state.selection = { block: blockId, network: Math.max(0, s.network - 1) }
    })
  }
  function insert(kind) {
    const s = sel() ?? { network: block().networks.length - 1, pin: [] }
    const pin = s.pin ?? []
    if (kind === 'NO') return insertAt(s.network, pin, { t: 'var' })
    if (kind === 'NC') return insertAt(s.network, pin, { t: 'not' })
    if (kind === 'set' || kind === 'reset') return edit((p) => { p.blocks.find((x) => x.id === blockId).networks[s.network].out.mode = kind === 'set' ? 'S' : 'R' })
    if (kind === 'coil') return edit((p) => { p.blocks.find((x) => x.id === blockId).networks[s.network].out.mode = '=' })
    if (kind === 'cmp') return insertAt(s.network, pin, { t: 'cmp' })
    if (kind === 'box?') { const r = body.getBoundingClientRect(); contextMenu(r.left + 80, r.top + 80, PALETTE.flatMap((g) => g.items.filter((i) => i.fbd && !i.fbd.out).map((i) => ({ label: `${g.group}  ›  ${i.name}`, run: () => insertAt(s.network, pin, i.fbd) }))).slice(0, 26)); return }
  }
  const edit0 = () => { const s = sel(); if (!s) return; const el = s.out ? body.querySelector(`.net[data-ni="${s.network}"] .fout`) : body.querySelector(`.leaf[data-p="${s.network}:${pk(s.pin ?? [])}"]`); if (el?.classList.contains('fout')) outEdit(el, s.network, block().networks[s.network].out?.tag); else if (el) operandEdit(el, s.network, s.pin, nodeAt(block().networks[s.network].expr, s.pin)?.name) }
  editor.api = { drop: (pl) => { if (!pl.fbd) return; if (pl.fbd.out) return insert(pl.fbd.out === 'S' ? 'set' : 'reset'); const s = sel() ?? { network: block().networks.length - 1, pin: [] }; insertAt(s.network, s.pin ?? [], pl.fbd) }, insert, remove, insertNetwork, edit: edit0, zoom: (d) => { zoom = Math.max(0.5, Math.min(2, zoom + d)); root.style.zoom = zoom }, escape: () => { document.querySelector('.op-edit')?.remove(); select(null) },
    copy: () => { const s = sel(); if (s) state.clipboard = { kind: 'fbd-network', data: clone(block().networks[s.network]) } },
    paste: () => { if (state.clipboard?.kind !== 'fbd-network') return; edit((p) => { const b = p.blocks.find((x) => x.id === blockId); const i = sel()?.network ?? b.networks.length - 1; const n = clone(state.clipboard.data); n.id = `n${Date.now().toString(36)}`; b.networks.splice(i + 1, 0, n) }) },
    cut() { this.copy(); remove() }, move: (d) => { const s = sel(); const n = (s?.network ?? 0) + (d === 'down' ? 1 : d === 'up' ? -1 : 0); if (n >= 0 && n < block().networks.length) setSel({ network: n }) } }

  /* ---- live values ---- */
  const val = (t) => readOperand(block().name, t)
  function evalNode(n) {
    if (!n) return undefined
    switch (n.t) {
      case 'var': return val(n.name)
      case 'not': { const v = evalNode(n.in?.[0]); return v === undefined ? undefined : !v }
      case 'and': case 'or': case 'xor': { const vs = (n.in ?? []).map(evalNode); if (vs.some((v) => v === undefined)) return undefined; return n.t === 'and' ? vs.every(Boolean) : n.t === 'or' ? vs.some(Boolean) : vs.reduce((a, b) => a !== !!b, false) }
      case 'cmp': { const [a, b] = (n.in ?? []).map(evalNode); if (a === undefined || b === undefined) return undefined; return { '==': a === b, '<>': a !== b, '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b }[n.op] }
      case 'add': case 'sub': case 'mul': case 'div': case 'mod': { const vs = (n.in ?? []).map(evalNode); if (vs.some((v) => typeof v !== 'number')) return undefined; return vs.reduce((a, b) => ({ add: a + b, sub: a - b, mul: a * b, div: b ? a / b : 0, mod: a % b })[n.t]) }
      case 'fb': return val(`${n.inst}.${n.out ?? FB[n.fb].flowOut}`)
      default: return undefined
    }
  }
  function paint() {
    const live = isOnline() && state.monitor !== false
    body.querySelectorAll('.net').forEach((el) => el.classList.toggle('mon', live))
    body.querySelectorAll('.fwire,.mon-val').forEach((w) => { w.classList.remove('t', 'f'); if (w.classList.contains('mon-val')) w.textContent = '' })
    if (!live) return
    block().networks.forEach((net, ni) => {
      const walk = (n, path) => {
        if (!n) return
        const v = evalNode(n), key = `${ni}:${pk(path)}`
        body.querySelectorAll(`.fwire[data-p="${key}"]`).forEach((w) => { w.classList.toggle('t', v === true); w.classList.toggle('f', v === false) })
        const mv = body.querySelector(`.mon-val[data-mv="${key}"]`); if (mv && v !== undefined) mv.textContent = typeof v === 'boolean' ? (v ? '■ 1' : '□ 0') : String(typeof v === 'number' && v > 1e6 ? `${(v / 1e6).toFixed(0)}ms` : v)
        const lf = body.querySelector(`.leaf[data-p="${key}"]`); if (lf && v !== undefined && n.t === 'var') lf.title = String(v)
        if (n.t === 'fb') Object.entries(n.args ?? {}).forEach(([k, c]) => walk(c, [...path, k])); else (n.in ?? []).forEach((c, i) => walk(c, [...path, i]))
      }
      walk(net.expr, [])
      body.querySelector(`.fwire[data-p="${ni}:out"]`)?.classList.toggle('t', evalNode(net.expr) === true)
    })
  }
  function render() {
    const scroll = body.scrollTop
    root.replaceChildren(...block().networks.map((n, i) => network(n, i)), h('div', { class: 'insert-hint' }, 'Double-click a pin to type a tag. Right-click a pin to insert a box. Drag boxes from the task card onto a pin.'))
    root.style.zoom = zoom; body.scrollTop = scroll
    body.querySelector(`.net[data-ni="${sel()?.network}"]`)?.classList.add('sel')
    paint()
  }
  function applySel() {
    body.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'))
    const s = sel(); if (!s) return
    body.querySelector(`.net[data-ni="${s.network}"]`)?.classList.add('sel')
    if (s.pin) body.querySelectorAll(`[data-p="${s.network}:${pk(s.pin)}"]`).forEach((x) => { if (x.classList.contains('leaf') || x.classList.contains('fbox')) x.classList.add('sel') })
  }
  const offs = [on('project', () => { if (!document.querySelector('.op-edit')) render() }), on('selection', () => applySel()), on('tick', paint), on('online', paint)]
  render()
  return { dispose() { offs.forEach((f) => f()) } }
}
