// Shared type rules for declaration editing and compile preflight.
import { TYPES } from './model.js'
import { FB } from './catalog.js'

const upper = s => String(s ?? '').trim().toUpperCase()
export function availableTypes(project, { instances = false, block } = {}) {
  const basic = TYPES.map(name => ({ name, kind: 'Basic type' }))
  if (!instances) return basic
  return [...basic, ...Object.keys(FB).map(name => ({ name, kind: 'Standard function block' })),
    ...project.blocks.filter(b => b.kind === 'FB' && b.id !== block?.id).map(b => ({ name: b.name, kind: 'Project function block' }))]
}

export function checkType(project, value, options) {
  const text = String(value ?? '').trim()
  const found = availableTypes(project, options).find(t => upper(t.name) === upper(text))
  if (found) return { ok: true, name: found.name, kind: found.kind }
  return { ok: false, message: text ? `Unknown data type “${text}”. Choose a supported type from the list.` : 'Choose a data type.' }
}

export function validateInterfaces(project) {
  const errors = []
  for (const block of project.blocks) for (const [section, vars] of Object.entries(block.interface ?? {})) {
    for (const variable of vars) {
      const result = checkType(project, variable.type, { instances: true, block })
      if (!result.ok) errors.push({ where: 'interface', block: block.id, section, variable: variable.name, message: `${block.name} · ${section} · ${variable.name}: ${result.message}` })
    }
  }
  return errors
}
