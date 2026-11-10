import './styles.css'
import './twin/twin.css'
import { buildShell } from './ui/shell.js'
import { buildRail } from './ui/rail.js'
import * as store from './ui/store.js'
import * as online from './ui/online.js'
import * as link from './twin/link.js'
import { mountTwin } from './twin/view.js'

buildShell()
const twinEl = document.getElementById('twin')
const twin = mountTwin(twinEl)
const rail = buildRail({ twin: twinEl, ide: document.getElementById('ide'), onShow: (id) => twin.show(id === 'twin') })
window.studio = { store, online, twin: link, rail }   // handle for automated checks and debugging
