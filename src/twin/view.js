// "Digital twin" page: 3D tank + panel, CPU controls, operator push buttons, live I/O and the wiring list.
import { h } from '../ui/dom.js'
import { download, log, runCpu, stopCpu } from '../ui/online.js'
import { edit, emit, on, state } from '../ui/store.js'
import { ioRows, plant, press, sync, tagAt } from './link.js'
import { createScene } from './scene.js'
import { IO, NETS, TANK, wiringList } from './tank-model.js'

const pct = (x) => `${Math.round(x * 100)} %`

export function mountTwin(root) {
  const stage = h('div', { class: 'tw-stage' })
  const tip = h('div', { class: 'tw-tip', hidden: true })
  const info = h('div', { class: 'tw-info' }, 'Hover over a device or wire to see what it is. Click a wire to trace it. Hold S1 or S2 to operate the tank.')
  const side = h('aside', { class: 'tw-side' })
  const head = h('div', { class: 'tw-head' })
  root.append(head, h('div', { class: 'tw-body' }, h('div', { class: 'tw-3d' }, stage, tip, info), side))

  const scene = createScene(stage, {
    onHover: (p, x, y) => {
      if (!p) { tip.hidden = true; return }
      tip.hidden = false; tip.textContent = p.name
      const r = stage.getBoundingClientRect(); tip.style.left = `${x - r.left + 14}px`; tip.style.top = `${y - r.top + 12}px`
    },
    onPick: (p) => showInfo(p),
    onPress: (id, down) => press(id, down),
  })

  function showInfo(p) {
    if (!p) { info.replaceChildren('Hover over a device or wire to see what it is. Click a wire to trace it. Hold S1 or S2 to operate the tank.'); return }
    if (p.kind === 'wire') {
      const net = NETS[p.net], live = plant.netLive(p.net)
      info.replaceChildren(h('b', null, p.name), h('span', { class: 'sw', style: { background: net.color } }), ` ${net.name} · `, h('span', { class: live ? 'on' : 'off' }, live ? 'carrying voltage / TRUE' : 'no voltage / FALSE'))
    } else info.replaceChildren(h('b', null, p.name))
  }

  /* --------------------------------------------------------------- head -- */
  let labelsOn = true
  const renderHead = () => {
    const o = state.online, m = o.machine, run = !!m?.running
    const cls = o.error ? 'err' : run ? 'run' : m ? 'stop' : 'offline'
    head.replaceChildren(
      h('div', { class: 'tw-title' }, 'Water tank T1', h('small', null, 'digital twin · wired to PLC_1')),
      h('span', { class: `pill ${cls}` }, h('i'), o.error ? 'CPU error' : run ? 'CPU RUN' : m ? 'CPU STOP' : 'No program in CPU'),
      h('button', { class: 'btn primary', title: 'Compile the PLC program, download it and start the CPU (Ctrl+L)', onClick: () => download() }, 'Download & run'),
      h('button', { class: 'btn', disabled: !m || run, onClick: runCpu }, 'RUN'),
      h('button', { class: 'btn', disabled: !run, onClick: stopCpu }, 'STOP'),
      h('span', { class: 'tw-msg' }, log.at(-1)?.text ?? ''),
      h('span', { class: 'grow' }),
      h('div', { class: 'seg' }, [['overview', 'Overview'], ['tank', 'Tank'], ['panel', 'Panel'], ['station', 'Push buttons']].map(([k, t]) => h('button', { onClick: () => scene.view(k) }, t))),
      h('label', { class: 'tw-check' }, h('input', { type: 'checkbox', checked: labelsOn, onChange: (e) => { labelsOn = e.target.checked; scene.setLabels(labelsOn) } }), 'Labels'))
  }

  /* --------------------------------------------------------------- side -- */
  const gaugeFill = h('div', { class: 'fill' }), gaugeTxt = h('div', { class: 'big' }), procRows = h('div', { class: 'kv' })
  const ioBody = h('tbody'), missing = h('div', { class: 'tw-missing' })
  const hold = (id, text, cls) => {
    const b = h('button', { class: `pb ${cls}`, title: `Hold to press ${id}` }, h('i'), h('span', null, h('b', null, id), ` ${text}`))
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(id, true); const up = () => { press(id, false); removeEventListener('pointerup', up) }; addEventListener('pointerup', up) })
    return b
  }
  const legend = h('div', { class: 'legend' }, Object.entries({ L: 'L 230 V', N: 'N', PE: 'Protective earth', P24: '+24 V', M: '0 V', S1: 'PLC input', DQ0: 'PLC output', K1: 'Valve 24 V' }).map(([k, t]) => h('span', null, h('i', { style: { background: NETS[k].color } }), t)))
  const wl = wiringList()
  const wiring = h('details', { class: 'tw-sec' }, h('summary', null, `Wiring list (${wl.length} wires and cores)`), h('table', { class: 'grid tw-wl' },
    h('thead', null, h('tr', null, ['Wire', 'From', 'To', 'Potential'].map((x) => h('th', null, x)))),
    h('tbody', null, wl.map((r) => h('tr', { onClick: () => { scene.select(r.id); showInfo({ kind: 'wire', id: r.id, net: r.net, name: `${r.kind === 'panel' ? 'Wire' : 'Core'} ${r.id}: ${r.from} → ${r.to}` }); scene.view(r.kind === 'panel' ? 'panel' : 'overview') } },
      h('td', { class: 'mono' }, r.id), h('td', { class: 'mono' }, r.from), h('td', { class: 'mono' }, r.to), h('td', null, h('i', { class: 'sw', style: { background: NETS[r.net].color } }), NETS[r.net].name))))))
  side.append(
    h('section', { class: 'tw-sec' }, h('h3', null, 'Process'),
      h('div', { class: 'proc' }, h('div', { class: 'gauge', title: 'Tank level' }, gaugeFill, h('span', { class: 'mark', style: { bottom: `${TANK.highAt * 100}%` } }, 'B2'), h('span', { class: 'mark', style: { bottom: `${TANK.lowAt * 100}%` } }, 'B1')), h('div', null, gaugeTxt, procRows)),
      h('div', { class: 'row' }, h('button', { class: 'btn', onClick: () => { plant.reset(0); sync(0) } }, 'Empty tank'), h('button', { class: 'btn', onClick: () => { plant.level = 0.5; sync(0) } }, 'Set to 50 %'))),
    h('section', { class: 'tw-sec' }, h('h3', null, 'Operator station'), h('div', { class: 'row' }, hold('S1', 'FILL', 'green'), hold('S2', 'DRAIN', 'black')),
      h('div', { class: 'hint' }, 'Hold a button (here or on the 3D operator station). The PLC program decides what the valves do.')),
    h('section', { class: 'tw-sec' }, h('h3', null, 'PLC inputs and outputs'),
      h('table', { class: 'grid tw-io' }, h('thead', null, h('tr', null, ['', 'Address', 'Tag in program', 'Wired to'].map((x) => h('th', null, x)))), ioBody), missing),
    h('section', { class: 'tw-sec' }, h('h3', null, 'Wire colours'), legend),
    wiring)

  const renderIo = () => {
    const rows = ioRows(), absent = rows.filter((r) => !r.tagName)
    ioBody.replaceChildren(...rows.map((r) => h('tr', { title: r.comment },
      h('td', null, h('i', { class: `dot${r.value ? ' on' : ''}` })), h('td', { class: 'mono' }, r.addr),
      h('td', { class: r.tagName ? 'mono' : 'warn' }, r.tagName ?? 'no tag'), h('td', null, `${r.device} · ${r.terminal}`))))
    missing.replaceChildren(...(absent.length ? [h('span', null, `${absent.length} address${absent.length > 1 ? 'es have' : ' has'} no PLC tag, so the program cannot use ${absent.length > 1 ? 'them' : 'it'}.`), h('button', { class: 'btn', onClick: addTags }, 'Add the missing tags')] : []))
  }
  function addTags() {
    edit((p) => { for (const io of IO) if (!tagAt(io.addr) && !p.tags.some((t) => t.name === io.tag)) p.tags.push({ name: io.tag, type: io.type, address: io.addr, comment: io.comment }) })
    emit('project', { reason: 'replace-tags' }); renderIo()
  }
  let lastIo = ''
  const renderProc = () => {
    gaugeFill.style.height = `${plant.level * 100}%`
    gaugeTxt.textContent = `${pct(plant.level)}  ·  ${Math.round(plant.litres)} L`
    const v = plant.valves
    procRows.replaceChildren(
      h('span', null, 'Fill valve Y1'), h('b', { class: v.Y1 ? 'on' : '' }, v.Y1 ? 'OPEN' : 'closed'),
      h('span', null, 'Drain valve Y2'), h('b', { class: v.Y2 ? 'on' : '' }, v.Y2 ? 'OPEN' : 'closed'),
      h('span', null, 'Inflow / outflow'), h('b', null, `${plant.flowIn.toFixed(0)} / ${plant.flowOut.toFixed(1)} L/s`),
      plant.overflow ? h('span', { class: 'warn', style: { gridColumn: '1 / -1' } }, 'Tank is overflowing: the fill valve is still open at 100 %.') : null)
    const key = JSON.stringify(ioRows().map((r) => [r.tagName, r.value]))
    if (key !== lastIo) { lastIo = key; renderIo() }
  }

  renderHead(); renderIo(); renderProc()
  on('online', renderHead); on('log', renderHead)
  on('project', () => { lastIo = ''; renderProc() })
  on('twin', () => { renderProc(); if (!root.hidden) scene.update(plant) })
  scene.update(plant)
  return { show(on) { scene.setActive(on); if (on) scene.update(plant) } }
}
