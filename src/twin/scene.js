// 3D view of the water tank twin: plant, operator station, open control panel and every wire.
// Built from tank-model.js; `update(plant)` animates water, valves, LEDs and live wires each frame.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { CABINET, CABLE_PATHS, CABLES, DEVICES, DUCTS, GLAND, NETS, OPERATOR_STATION, PLATE_Z, TANK, TERMINALS, WIRES, X1, routeCore, routeWire } from './tank-model.js'

const V = (p) => new THREE.Vector3(p[0], p[1], p[2])
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o })

/** Polyline with rounded corners, for pipes, cables and wires. */
function pathOf(points, r = 0.02) {
  const path = new THREE.CurvePath(), v = points.map(V)
  let prev = v[0]
  for (let i = 1; i < v.length; i++) {
    const cur = v[i]
    if (i < v.length - 1) {
      const d1 = cur.clone().sub(prev), d2 = v[i + 1].clone().sub(cur)
      const rr = Math.min(r, d1.length() / 2, d2.length() / 2)
      if (rr < 1e-5) { if (cur.distanceTo(prev) > 1e-6) path.add(new THREE.LineCurve3(prev.clone(), cur.clone())); prev = cur; continue }
      const a = cur.clone().sub(d1.normalize().multiplyScalar(rr)), b = cur.clone().add(d2.normalize().multiplyScalar(rr))
      if (a.distanceTo(prev) > 1e-6) path.add(new THREE.LineCurve3(prev.clone(), a))
      path.add(new THREE.QuadraticBezierCurve3(a, cur.clone(), b))
      prev = b
    } else if (cur.distanceTo(prev) > 1e-6) path.add(new THREE.LineCurve3(prev.clone(), cur.clone()))
  }
  return path
}
function tube(points, radius, material, corner = 0.02) {
  const path = pathOf(points, corner)
  const segs = Math.min(600, Math.max(12, Math.ceil(path.getLength() / 0.012)))
  return new THREE.Mesh(new THREE.TubeGeometry(path, segs, radius, 8, false), material)
}
function textTexture(lines, { w = 256, h = 128, bg = '#00000000', fg = '#111', size = 34, align = 'center', weight = 600 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d')
  g.fillStyle = bg; g.fillRect(0, 0, w, h)
  g.fillStyle = fg; g.font = `${weight} ${size}px "Segoe UI", Arial, sans-serif`; g.textAlign = align; g.textBaseline = 'middle'
  const ls = String(lines).split('\n')
  ls.forEach((l, i) => g.fillText(l, align === 'center' ? w / 2 : 10, h / 2 + (i - (ls.length - 1) / 2) * size * 1.15))
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}
function plate(text, w, h, opts) {
  const ratio = w / h, tw = 512, th = Math.max(32, Math.round(tw / ratio))
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: textTexture(text, { w: tw, h: th, size: Math.round(th * 0.5), ...opts }), transparent: true }))
}
function label(text, cls = '') {
  const el = document.createElement('div'); el.className = `tw-label ${cls}`; el.textContent = text
  return new CSS2DObject(el)
}
function led(r = 0.006) { return new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), std('#4a4f55', { emissive: '#000000' })) }
function setLed(m, on, color) { m.material.color.set(on ? color : '#4a4f55'); m.material.emissive.set(on ? color : '#000000'); m.material.emissiveIntensity = on ? 1.4 : 0 }

export function createScene(host, { onHover, onPick, onPress }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap
  host.append(renderer.domElement)
  const labels = new CSS2DRenderer(); labels.domElement.className = 'tw-labels'; host.append(labels.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#dde3e8')
  const camera = new THREE.PerspectiveCamera(38, 1, 0.03, 80)
  camera.position.set(0.6, 2.9, 6.2)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(-0.3, 1.0, 0.1); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.25; controls.maxDistance = 14
  scene.add(new THREE.HemisphereLight('#ffffff', '#7d8892', 1.25))
  const sun = new THREE.DirectionalLight('#ffffff', 1.7); sun.position.set(3, 7, 5); sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -3, near: 1, far: 20 }); sun.shadow.bias = -0.0005
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#ffffff', 0.5); fill.position.set(0.5, 1.5, 4); scene.add(fill)

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), std('#c7ced4', { roughness: 0.95 }))
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor)
  const grid = new THREE.GridHelper(14, 28, '#aeb8c0', '#bac3ca'); grid.position.y = 0.002; scene.add(grid)

  const pickables = [], byId = new Map(), wireMeshes = new Map(), dyn = {}
  const add = (obj, parent = scene) => { parent.add(obj); return obj }
  const pick = (obj, info) => { obj.userData.pick = info; pickables.push(obj); if (info.kind === 'device') byId.set(info.id, obj); return obj }
  const steel = std('#9aa5ae', { metalness: 0.65, roughness: 0.35 })
  const shadow = (o) => { o.castShadow = true; o.receiveShadow = true; return o }

  /* ---------------------------------------------------------------- tank -- */
  const [cx, , cz] = TANK.center, r = TANK.radius, yb = TANK.bottom, H = TANK.height
  const tank = new THREE.Group(); scene.add(tank)
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, yb, 12), steel)), tank).position.set(cx + Math.cos(a) * r * 0.8, yb / 2, cz + Math.sin(a) * r * 0.8) }
  add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.04, 48), steel)), tank).position.set(cx, yb - 0.02, cz)
  const shell = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, H, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#cfe8f5', transparent: true, opacity: 0.2, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false })), tank)
  shell.position.set(cx, yb + H / 2, cz)
  pick(shell, { kind: 'device', id: 'T1', name: 'Tank T1 — 500 L, clear wall so you can see the level' })
  for (const y of [yb + 0.02, yb + H - 0.02]) add(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.012, r + 0.012, 0.04, 48, 1, true), steel), tank).position.set(cx, y, cz)
  add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.03, 48), steel)), tank).position.set(cx, yb + H + 0.015, cz)
  const waterMat = new THREE.MeshStandardMaterial({ color: '#2a7fd4', transparent: true, opacity: 0.72, roughness: 0.15 })
  const waterGeo = new THREE.CylinderGeometry(r - 0.008, r - 0.008, 1, 64); waterGeo.translate(0, 0.5, 0)
  dyn.water = add(new THREE.Mesh(waterGeo, waterMat), tank); dyn.water.position.set(cx, yb, cz)
  dyn.surface = add(new THREE.Mesh(new THREE.CircleGeometry(r - 0.008, 64), new THREE.MeshStandardMaterial({ color: '#5aa7ea', transparent: true, opacity: 0.85, roughness: 0.1 })), tank)
  dyn.surface.rotation.x = -Math.PI / 2
  // level scale on the front
  { const sc = document.createElement('canvas'); sc.width = 64; sc.height = 512; const g = sc.getContext('2d'); g.fillStyle = '#ffffffd0'; g.fillRect(0, 0, 64, 512); g.fillStyle = '#1b2a41'; g.font = '600 18px Segoe UI, Arial'
    for (let p = 0; p <= 100; p += 10) { const y = 512 - (p / 100) * 500 - 6; g.fillRect(0, y, p % 50 ? 18 : 30, 3); if (p % 20 === 0) g.fillText(`${p}`, 30, y + 7) }
    g.fillStyle = '#d07b00'; for (const f of [TANK.lowAt, TANK.highAt]) g.fillRect(0, 512 - f * 500 - 6, 64, 3)
    const t = new THREE.CanvasTexture(sc); t.colorSpace = THREE.SRGBColorSpace
    const s = add(new THREE.Mesh(new THREE.PlaneGeometry(0.07, H * 1.024), new THREE.MeshBasicMaterial({ map: t, transparent: true })), tank)
    s.position.set(cx - 0.3, yb + H / 2 - 0.006, cz + Math.sqrt(r * r - 0.3 * 0.3) + 0.015); s.rotation.y = -Math.asin(0.3 / r) }
  const tankLabel = label('T1  Tank 500 L', 'big'); tankLabel.position.set(cx, yb + H + 0.16, cz); tank.add(tankLabel)
  dyn.overflow = label('OVERFLOW', 'warn'); dyn.overflow.position.set(cx, yb + H + 0.32, cz); tank.add(dyn.overflow)

  /* --------------------------------------------------------------- pipes -- */
  const pipe = (pts, rad = 0.028) => add(shadow(tube(pts, rad, steel, 0.08)))
  pipe([[-3.6, 2.25, 0], [cx, 2.25, 0], [cx, yb + H + 0.03, 0]])
  pipe([[cx + r - 0.02, 0.55, 0], [-0.42, 0.55, 0], [-0.42, 0.33, 0]])
  const supplyLabel = label('Water supply'); supplyLabel.position.set(-3.4, 2.42, 0); scene.add(supplyLabel)
  // drain sump
  add(shadow(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.36), std('#5d666e')))).position.set(-0.42, 0.04, 0)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.3), std('#20262b'))).position.set(-0.42, 0.081, 0)
  const drainLabel = label('Drain'); drainLabel.position.set(-0.42, 0.2, 0.25); scene.add(drainLabel)
  // falling water
  const stripe = document.createElement('canvas'); stripe.width = 16; stripe.height = 64
  { const g = stripe.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, '#7cc0ff'); gr.addColorStop(0.5, '#2a7fd4'); gr.addColorStop(1, '#7cc0ff'); g.fillStyle = gr; g.fillRect(0, 0, 16, 64) }
  const streamTex = new THREE.CanvasTexture(stripe); streamTex.wrapS = streamTex.wrapT = THREE.RepeatWrapping; streamTex.repeat.set(1, 6)
  const streamMat = new THREE.MeshBasicMaterial({ map: streamTex, transparent: true, opacity: 0.75 })
  const sGeo = new THREE.CylinderGeometry(0.02, 0.026, 1, 12, 1, true); sGeo.translate(0, -0.5, 0)
  dyn.inStream = add(new THREE.Mesh(sGeo, streamMat)); dyn.inStream.position.set(cx, yb + H, cz)
  dyn.outStream = add(new THREE.Mesh(sGeo, streamMat)); dyn.outStream.position.set(-0.42, 0.33, 0); dyn.outStream.scale.y = 0.25

  /* -------------------------------------------------------------- valves -- */
  dyn.valveLed = {}
  for (const id of ['Y1', 'Y2']) {
    const d = DEVICES.find((x) => x.id === id), g = new THREE.Group(); g.position.set(...d.pos); scene.add(g)
    pick(add(shadow(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.09), std('#b58b3a', { metalness: 0.5, roughness: 0.4 }))), g), { kind: 'device', id, name: d.name })
    for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 16), std('#a07c35', { metalness: 0.5 })), g).rotateZ(Math.PI / 2).position.set(s * 0.07, 0, 0)
    const coil = pick(add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.09, 20), std('#24282c'))), g), { kind: 'device', id, name: d.name })
    coil.position.y = 0.085
    add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.03), std('#1a1d20')), g).position.set(0, 0.09, 0.045)
    const l = led(0.007); l.position.set(0, 0.1, 0.062); g.add(l); dyn.valveLed[id] = l
    const lb = label(d.text); lb.position.set(0, 0.2, 0); g.add(lb)
  }

  /* -------------------------------------------------------- level switches -- */
  dyn.levelLed = {}
  for (const id of ['B1', 'B2']) {
    const d = DEVICES.find((x) => x.id === id), g = new THREE.Group(); g.position.set(...d.pos); g.rotation.y = d.angle; scene.add(g)
    pick(add(shadow(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), std('#e5b62a'))), g), { kind: 'device', id, name: d.name })
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 8), steel), g).rotateX(Math.PI / 2).position.set(0, 0, -0.1)
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 16), std('#f1f1f1')), g).rotateX(Math.PI / 2).position.set(0, 0, -0.19)
    const l = led(0.006); l.position.set(0, 0.012, 0.027); g.add(l); dyn.levelLed[id] = l
    const lb = label(d.text); lb.position.set(0, 0.075, 0.03); g.add(lb)
  }

  /* ---------------------------------------------------- operator station -- */
  const op = OPERATOR_STATION.pos
  add(shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, op[1] - 0.08, 12), std('#6c757d', { metalness: 0.4 })))).position.set(op[0], (op[1] - 0.08) / 2, op[2])
  add(shadow(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.3), std('#6c757d')))).position.set(op[0], 0.006, op[2])
  add(shadow(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.17, 0.11), std('#d9dcde')))).position.set(...op)
  dyn.buttons = {}
  for (const [id, dx, color, text] of [['S1', -0.065, '#1f9d3a', 'FILL'], ['S2', 0.065, '#26292c', 'DRAIN']]) {
    const bez = add(new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 24), std('#c4c9cd', { metalness: 0.7, roughness: 0.25 })))
    bez.rotation.x = Math.PI / 2; bez.position.set(op[0] + dx, op[1] + 0.02, op[2] + 0.06)
    const cap = add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.022, 24), std(color, { roughness: 0.35 })))
    cap.rotation.x = Math.PI / 2; cap.position.set(op[0] + dx, op[1] + 0.02, op[2] + 0.07)
    pick(cap, { kind: 'button', id, name: DEVICES.find((x) => x.id === id).name }); pick(bez, { kind: 'button', id, name: DEVICES.find((x) => x.id === id).name })
    dyn.buttons[id] = { cap, z: cap.position.z }
    const p = plate(`${id}  ${text}`, 0.09, 0.025, { bg: '#f5f5f0', fg: '#111' }); p.position.set(op[0] + dx, op[1] - 0.045, op[2] + 0.0555); scene.add(p)
  }
  const opLabel = label('Operator station'); opLabel.position.set(op[0], op[1] + 0.17, op[2]); scene.add(opLabel)

  /* ------------------------------------------------------------- cabinet -- */
  const { x0, x1, y0, y1, z0, z1 } = CABINET, cw = x1 - x0, ch = y1 - y0, cmx = (x0 + x1) / 2
  const body = std('#d5d8d9', { roughness: 0.5 })
  const cab = new THREE.Group(); scene.add(cab)
  const panel = (w, h, d, x, y, z, m = body) => add(shadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)), cab).position.set(x, y, z)
  panel(cw, ch, 0.015, cmx, y0 + ch / 2, z0)
  panel(0.015, ch, z1 - z0, x0, y0 + ch / 2, (z0 + z1) / 2); panel(0.015, ch, z1 - z0, x1, y0 + ch / 2, (z0 + z1) / 2)
  panel(cw, 0.015, z1 - z0, cmx, y1, (z0 + z1) / 2); panel(cw, 0.015, z1 - z0, cmx, y0, (z0 + z1) / 2)
  panel(cw, y0, z1 - z0, cmx, y0 / 2, (z0 + z1) / 2, std('#2f3439'))
  const door = new THREE.Group(); door.position.set(x1, y0 + ch / 2, z1); door.rotation.y = 1.95; cab.add(door)
  add(shadow(new THREE.Mesh(new THREE.BoxGeometry(cw, ch, 0.02), body)), door).position.set(-cw / 2, 0, 0)
  const pocket = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.02), std('#8d9399')), door); pocket.position.set(-cw / 2, -0.2, -0.02)
  panel(cw - 0.08, ch - 0.1, 0.006, cmx, y0 + ch / 2, PLATE_Z - 0.003, std('#e2bc8c', { roughness: 0.7 }))
  pick(cab.children[0], { kind: 'device', id: 'CP1', name: 'Control panel +CP1 (door open, duct covers removed)' })
  const cabLabel = label('Control panel +CP1', 'big'); cabLabel.position.set(cmx, y1 + 0.12, 0); scene.add(cabLabel)
  // DIN rails and ducts (covers removed so the wires stay visible)
  for (const y of [1.38, 0.86]) panel(cw - 0.12, 0.035, 0.0075, cmx, y, PLATE_Z + 0.004, steel)
  const duct = std('#8f969c', { transparent: true, opacity: 0.35, depthWrite: false })
  for (const y of [DUCTS.top, DUCTS.mid, DUCTS.bottom]) panel(DUCTS.right - DUCTS.left + 0.05, 0.05, 0.06, (DUCTS.left + DUCTS.right) / 2, y, PLATE_Z + 0.03, duct)
  for (const x of [DUCTS.left, DUCTS.right]) panel(0.05, DUCTS.top - DUCTS.bottom - 0.05, 0.06, x, (DUCTS.top + DUCTS.bottom) / 2, PLATE_Z + 0.03, duct)
  for (const g of [GLAND.bottom, GLAND.top]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16), std('#2c3135')), cab).position.set(...g)

  // components
  const comp = (d, color) => { const m = pick(add(shadow(new THREE.Mesh(new THREE.BoxGeometry(...d.size), std(color))), cab), { kind: 'device', id: d.id, name: d.name }); m.position.set(d.pos[0], d.pos[1], PLATE_Z + d.size[2] / 2); return m }
  const front = (d, text, opts, w = d.size[0] * 0.9, h = d.size[1] * 0.35, dy = 0) => { const p = plate(text, w, h, opts); p.position.set(d.pos[0], d.pos[1] + dy, PLATE_Z + d.size[2] + 0.0008); cab.add(p) }
  const dev = (id) => DEVICES.find((x) => x.id === id)
  comp(dev('F1'), '#eceff1'); front(dev('F1'), 'F1 C6', { fg: '#222' }, 0.045, 0.02, 0.03)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.02), std('#2d6fc2')), cab).position.set(dev('F1').pos[0], dev('F1').pos[1] - 0.005, PLATE_Z + 0.08)
  comp(dev('G1'), '#b9c0c6'); front(dev('G1'), 'G1\n24 V DC', { fg: '#1b2a41' }, 0.1, 0.06, 0.02)
  dyn.psuLed = led(0.005); dyn.psuLed.position.set(dev('G1').pos[0] + 0.035, dev('G1').pos[1] - 0.04, PLATE_Z + 0.101); cab.add(dyn.psuLed)
  comp(dev('A1'), '#3a4147'); front(dev('A1'), 'PLC_1   CPU  DI 24 V / DQ 24 V', { fg: '#e9eef2', weight: 600 }, 0.3, 0.026, 0.045)
  // PLC status and I/O LEDs
  const a1 = dev('A1'), lz = PLATE_Z + a1.size[2] + 0.002
  dyn.plcLed = {}
  ;[['RUN', -0.13], ['STOP', -0.105], ['ERR', -0.08]].forEach(([n, dx]) => { const l = led(0.005); l.position.set(a1.pos[0] + dx, a1.pos[1] + 0.005, lz); cab.add(l); dyn.plcLed[n] = l })
  const tag = (t, x, y) => { const p = plate(t, 0.03, 0.012, { fg: '#cfd8df', weight: 500 }); p.position.set(x, y, lz); cab.add(p) }
  tag('RUN STOP ERR', a1.pos[0] - 0.105, a1.pos[1] - 0.012)
  for (let i = 0; i < 4; i++) { const l = led(0.0045); l.position.set(a1.pos[0] - 0.02 + i * 0.022, a1.pos[1] + 0.03, lz); cab.add(l); dyn.plcLed[`DI${i}`] = l; tag(`DI${i}`, a1.pos[0] - 0.02 + i * 0.022, a1.pos[1] + 0.017) }
  for (let i = 0; i < 2; i++) { const l = led(0.0045); l.position.set(a1.pos[0] - 0.02 + i * 0.022, a1.pos[1] - 0.03, lz); cab.add(l); dyn.plcLed[`DQ${i}`] = l; tag(`DQ${i}`, a1.pos[0] - 0.02 + i * 0.022, a1.pos[1] - 0.043) }
  dyn.relayLed = {}
  for (const id of ['K1', 'K2']) {
    const d = dev(id); comp(d, '#5b6670')
    const cube = add(new THREE.Mesh(new THREE.BoxGeometry(d.size[0] * 0.8, d.size[1] * 0.45, 0.02), std('#3f73b5', { transparent: true, opacity: 0.85 })), cab)
    cube.position.set(d.pos[0], d.pos[1] + 0.01, PLATE_Z + d.size[2] + 0.008)
    const l = led(0.0045); l.position.set(d.pos[0], d.pos[1] - 0.03, PLATE_Z + d.size[2] + 0.002); cab.add(l); dyn.relayLed[id] = l
    front(d, id, { fg: '#fff' }, 0.03, 0.014, -0.018)
  }
  // terminal strip X1
  for (let i = 1; i <= X1.count; i++) {
    const m = pick(add(shadow(new THREE.Mesh(new THREE.BoxGeometry(X1.size[0], X1.size[1], X1.size[2]), std(i === 10 || i === 12 ? '#3b6fb6' : '#9aa1a7'))), cab), { kind: 'device', id: `X1:${i}`, name: `Terminal X1:${i}` })
    m.position.set(X1.x0 + (i - 1) * X1.pitch, X1.y, PLATE_Z + X1.size[2] / 2)
    const n = plate(String(i), 0.016, 0.012, { bg: '#ffffff', fg: '#111' }); n.position.set(m.position.x, X1.y + 0.012, PLATE_Z + X1.size[2] + 0.0008); cab.add(n)
  }
  for (const [id, x, y] of [['F1', 1.03, 1.52], ['G1', 1.16, 1.53], ['A1', 1.5, 1.52], ['K1 K2', 1.045, 0.97], ['X1', 1.33, 0.95]]) { const l = label(id, 'small'); l.position.set(x, y, PLATE_Z + 0.1); cab.add(l) }

  /* --------------------------------------------------------------- wires -- */
  const wireMat = (net) => std(NETS[net].color, { roughness: 0.45, emissive: '#000000' })
  WIRES.forEach((w, i) => {
    const m = pick(add(tube(routeWire(w.from, w.to, i), 0.0024, wireMat(w.net), 0.012), cab), { kind: 'wire', id: w.id, name: `Wire ${w.id}: ${w.from} → ${w.to}`, net: w.net })
    wireMeshes.set(w.id, { mesh: m, net: w.net })
  })
  let lane = 0
  for (const c of CABLES) {
    c.cores.forEach((k) => {
      const m = pick(add(tube(routeCore(k.at, c.top, lane++), 0.0022, wireMat(k.net), 0.012), cab), { kind: 'wire', id: `${c.id}.${k.core}`, name: `${c.id} core ${k.core}: ${k.at.replace(/f$/, '')} → ${k.to}`, net: k.net })
      wireMeshes.set(`${c.id}.${k.core}`, { mesh: m, net: k.net })
    })
    pick(add(shadow(tube(CABLE_PATHS[c.id], c.top ? 0.011 : 0.009, std(c.top ? '#5a6066' : '#3c4248', { roughness: 0.7 }), 0.06))), { kind: 'cable', id: c.id, name: `Cable ${c.id}: ${c.name}` })
  }
  for (const t of TERMINALS.values()) if (t.device !== 'X1') add(new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 8), steel), cab).position.set(...t.pos)

  /* ------------------------------------------------------ interaction -- */
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2()
  let hovered = null, selected = null, pressed = null
  const hit = (e) => {
    const r2 = renderer.domElement.getBoundingClientRect()
    mouse.set(((e.clientX - r2.left) / r2.width) * 2 - 1, -((e.clientY - r2.top) / r2.height) * 2 + 1)
    ray.setFromCamera(mouse, camera); ray.params.Line = { threshold: 0.01 }
    return ray.intersectObjects(pickables, false)[0]?.object ?? null
  }
  renderer.domElement.addEventListener('pointermove', (e) => {
    const o = hit(e)
    if (o !== hovered) { hovered = o; renderer.domElement.style.cursor = o ? (o.userData.pick.kind === 'button' ? 'pointer' : 'help') : '' }
    onHover?.(o?.userData.pick ?? null, e.clientX, e.clientY)
  })
  renderer.domElement.addEventListener('pointerleave', () => onHover?.(null))
  renderer.domElement.addEventListener('pointerdown', (e) => {
    const o = hit(e); if (!o) return
    const p = o.userData.pick
    if (p.kind === 'button') { pressed = p.id; controls.enabled = false; onPress?.(p.id, true) }
  })
  addEventListener('pointerup', () => { if (pressed) { onPress?.(pressed, false); pressed = null; controls.enabled = true } })
  let downAt = null
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY] })
  renderer.domElement.addEventListener('click', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return
    const o = hit(e); const p = o?.userData.pick ?? null
    if (p?.kind === 'button') return
    select(p?.kind === 'wire' ? p.id : null); onPick?.(p)
  })
  function select(id) {
    selected = id
    for (const [wid, { mesh }] of wireMeshes) { mesh.material.transparent = !!id && wid !== id; mesh.material.opacity = id && wid !== id ? 0.18 : 1; mesh.scale.setScalar(1) }
  }

  /* -------------------------------------------------------------- views -- */
  const VIEWS = {
    overview: [[0.6, 2.9, 6.2], [-0.3, 1.0, 0.1]],
    tank: [[-0.9, 2.0, 3.1], [-1.6, 1.2, 0]],
    panel: [[1.45, 1.12, 1.95], [1.4, 1.05, -0.12]],
    station: [[0.42, 1.35, 1.45], [0.35, 1.12, 0.55]],
  }
  let tween = null
  function view(name) {
    const v = VIEWS[name]; if (!v) return
    tween = { t0: performance.now(), p0: camera.position.clone(), q0: controls.target.clone(), p1: V(v[0]), q1: V(v[1]) }
  }

  /* -------------------------------------------------------------- frame -- */
  let active = false, raf = 0, flowPhase = 0, lastT = performance.now(), plantRef = null
  function update(plant) {
    plantRef = plant
    const lvl = Math.max(0.0005, plant.level)
    dyn.water.scale.y = lvl * H; dyn.surface.position.set(cx, yb + lvl * H + 0.001, cz)
    dyn.water.visible = dyn.surface.visible = plant.level > 0.001
    const v = plant.valves
    dyn.inStream.visible = v.Y1; dyn.inStream.scale.y = Math.max(0.02, yb + H - (yb + lvl * H))
    dyn.outStream.visible = v.Y2 && plant.level > 0.001
    dyn.overflow.visible = plant.overflow
    setLed(dyn.valveLed.Y1, v.Y1, '#ffcf33'); setLed(dyn.valveLed.Y2, v.Y2, '#ffcf33')
    const inp = plant.inputs
    setLed(dyn.levelLed.B1, inp['%I0.2'], '#ffcf33'); setLed(dyn.levelLed.B2, inp['%I0.3'], '#ffcf33')
    const r = plant.relays
    setLed(dyn.relayLed.K1, r.K1, '#ffcf33'); setLed(dyn.relayLed.K2, r.K2, '#ffcf33')
    setLed(dyn.psuLed, plant.power, '#3ad15a')
    setLed(dyn.plcLed.RUN, plant.cpuRun, '#3ad15a'); setLed(dyn.plcLed.STOP, !plant.cpuRun, '#ffb000')
    ;['%I0.0', '%I0.1', '%I0.2', '%I0.3'].forEach((a, i) => setLed(dyn.plcLed[`DI${i}`], inp[a], '#3ad15a'))
    setLed(dyn.plcLed.DQ0, plant.netLive('DQ0'), '#3ad15a'); setLed(dyn.plcLed.DQ1, plant.netLive('DQ1'), '#3ad15a')
    for (const [id, b] of Object.entries(dyn.buttons)) b.cap.position.z = b.z - (plant.buttons[id] ? 0.008 : 0)
    for (const { mesh, net } of wireMeshes.values()) { const on = plant.netLive(net); mesh.material.emissive.set(on ? NETS[net].color : '#000000'); mesh.material.emissiveIntensity = on ? 0.9 : 0 }
  }
  function frame(t) {
    raf = active ? requestAnimationFrame(frame) : 0
    const dt = (t - lastT) / 1000; lastT = t
    flowPhase += dt * 2.5; streamTex.offset.y = -flowPhase
    if (tween) {
      const k = Math.min(1, (t - tween.t0) / 650), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.q0, tween.q1, e)
      if (k >= 1) tween = null
    }
    if (selected && wireMeshes.get(selected)) { const m = wireMeshes.get(selected).mesh; m.material.emissive.set('#ffd400'); m.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t / 180) }
    controls.update()
    renderer.render(scene, camera); labels.render(scene, camera)
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return
    renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(host)
  function setActive(on) { active = on; if (on && !raf) { resize(); lastT = performance.now(); raf = requestAnimationFrame(frame) } }
  function setLabels(on) { labels.domElement.style.display = on ? '' : 'none' }
  return { update, setActive, view, select, setLabels, get plant() { return plantRef } }
}
