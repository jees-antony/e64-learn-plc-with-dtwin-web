import './styles.css'
import { buildShell } from './ui/shell.js'
import * as store from './ui/store.js'
import * as online from './ui/online.js'

buildShell()
window.studio = { store, online }   // handle for automated checks and debugging
