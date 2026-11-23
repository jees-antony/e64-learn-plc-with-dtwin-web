// Structural edits use positions between instructions, independent of DOM/layout.
export function seriesAt(net, path = []) {
  if (!Array.isArray(path) || path.length % 2) throw new Error('Invalid wire position.')
  let list = net.elements
  for (let i = 0; i < path.length; i += 2) {
    const branch = list?.[path[i]]
    if (branch?.k !== 'branch' || !branch.branches?.[path[i + 1]]) throw new Error('That wire no longer exists. Select it again.')
    list = branch.branches[path[i + 1]]
  }
  return list
}
export function checkGap(net, gap) {
  const list = seriesAt(net, gap?.path ?? [])
  if (!Number.isInteger(gap?.index) || gap.index < 0 || gap.index > list.length) throw new Error('Select a valid wire between instructions.')
  return list
}
export function openBranches(net) {
  const found = []
  const walk = (list, base) => list.forEach((e, i) => {
    if (e.k !== 'branch') return
    const path = [...base, i]
    if (e.closed === false) found.push(path)
    e.branches?.forEach((lane, li) => walk(lane, [...path, li]))
  })
  walk(net.elements, [])
  return found
}
export function insertAtGap(net, gap, element) {
  checkGap(net, gap).splice(gap.index, 0, element)
  return [...gap.path, gap.index]
}
export function startBranch(net, gap, wrapInstruction = false) {
  if (openBranches(net).length) throw new Error('Close the unfinished branch before starting another one in this network.')
  const list = checkGap(net, gap)
  const upper = wrapInstruction && gap.index < list.length ? list.splice(gap.index, 1) : []
  list.splice(gap.index, 0, { k: 'branch', closed: false, branches: [upper, []] })
  return { path: [...gap.path, gap.index, 1], index: 0 }
}
function branchClosePlan(net, target) {
  const path = openBranches(net).at(-1)
  if (!path) throw new Error('There is no unfinished branch in this network.')
  const base = path.slice(0, -1), index = path.at(-1), list = seriesAt(net, base), branch = list[index]
  // Closing while a branch lane is selected rejoins at its existing right edge.
  const ownLane = target && target.path.length > path.length && path.every((n, i) => target.path[i] === n)
  const end = !target || ownLane ? { path: base, index: index + 1 } : target
  checkGap(net, end)
  if (JSON.stringify(end.path) !== JSON.stringify(base) || end.index <= index) throw new Error('Select a wire after the branch start on the same parent rung. Branches cannot cross or join another lane.')
  const captured = list.slice(index + 1, end.index)
  const lanes = [branch.branches[0].concat(captured), ...branch.branches.slice(1)]
  if (lanes.length < 2 || lanes.some(lane => lane.length === 0)) throw new Error('A parallel path is empty. Add an instruction to each path, and select a later main-rung wire if you are branching around existing instructions.')
  return { list, branch, base, index, captured, lanes }
}
export function canDropBranchEnd(net, branchPath, gap) {
  if (gap.path.length !== branchPath.length - 1 || gap.index <= branchPath.at(-1)) return false
  if (!gap.path.every((n, i) => n === branchPath[i])) return false
  try {
    branchClosePlan(net, gap)
    return true
  } catch {
    return false
  }
}
export function closeBranch(net, target) {
  const { list, branch, base, index, captured, lanes } = branchClosePlan(net, target)
  list.splice(index + 1, captured.length)
  branch.branches = lanes
  branch.closed = true
  return { path: base, index: index + 1 }
}
export function addParallelPath(net, path) {
  if (openBranches(net).length) throw new Error('Close the unfinished branch before adding another path.')
  const list = seriesAt(net, path.slice(0, -1)), branch = list[path.at(-1)]
  if (branch?.k !== 'branch') throw new Error('Select a branch or an instruction inside a branch first.')
  branch.branches.push([])
  branch.closed = false
  return { path: [...path, branch.branches.length - 1], index: 0 }
}
export function removeBranch(net, path) {
  const list = seriesAt(net, path.slice(0, -1)), branch = list[path.at(-1)]
  if (branch?.k !== 'branch') throw new Error('Select a branch first.')
  list.splice(path.at(-1), 1, ...branch.branches[0])
}
export function validateLadderNetwork(net) {
  const errors = []
  let action = !!net.coils?.length
  const walk = (list, base) => list.forEach((e, i) => {
    const path = [...base, i]
    if (e.k === 'move' || e.k === 'math' || e.k === 'box' || e.k === 'call') action = true
    if (e.k === 'empty') errors.push({ path, message: 'Empty box: click "??" and type an instruction or block name.' })
    if (e.k !== 'branch') return
    if (e.closed === false) errors.push({ path, message: 'Branch is not closed. Add an instruction to the open path, then drag its end to a return wire or use Shift+F9.' })
    if (!Array.isArray(e.branches) || e.branches.length < 2) errors.push({ path, message: 'A branch needs at least two parallel paths.' })
    e.branches?.forEach((lane, li) => {
      if (!lane.length && e.closed !== false) errors.push({ path, message: `Parallel path ${li + 1} is empty and would bypass the other path. Add an instruction or remove the branch.` })
      walk(lane, [...path, li])
    })
  })
  walk(net.elements ?? [], [])
  if (net.elements?.length && !action) errors.push({ message: 'Rung has no output. Add a coil, a block call or an instruction such as a timer, counter, MOVE or ADD.' })
  return errors
}
