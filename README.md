# Web PLC Studio

A PLC engineering studio that runs entirely in a browser tab: Ladder (LAD), Function Block Diagram (FBD) and SCL editors, a compiler, and a virtual CPU with online monitoring. The look and the keyboard / mouse workflow follow the S7 engineering-tool convention (project tree, tabbed editors, task cards, inspector window, green-solid / blue-dashed power flow). The styling is original; no vendor assets are used.

## Run

```bash
npm install --ignore-scripts   # esbuild, CodeMirror, STruC++ (pinned release tarball)
npm run build                  # -> dist/app.js, dist/app.css
npm run serve                  # http://localhost:5190
npm test                       # codegen + virtual CPU tests (Node)
```

## Workspace

The rail on the left has two tabs:

- **Digital twin**: a 3D water tank T1 (500 L) with fill valve Y1, drain valve Y2, level switches B1 (20 %) and B2 (80 %), an operator station with push buttons S1 FILL and S2 DRAIN, and the open control panel +CP1. The panel holds MCB F1, the 24 V power supply G1, PLC A1, interface relays K1 and K2 and terminal strip X1, with every wire drawn and numbered. Live wires glow, the PLC and relay LEDs follow the I/O, and a wire can be traced from the 3D view or the wiring list.
- **PLC programming**: the engineering studio below.

The twin is wired to the virtual CPU by address, like real hardware:

| Address | Device | Meaning |
|---|---|---|
| `%I0.0` | S1 | FILL push button, TRUE while pressed |
| `%I0.1` | S2 | DRAIN push button, TRUE while pressed |
| `%I0.2` | B1 | TRUE when the water is above 20 % |
| `%I0.3` | B2 | TRUE when the water is above 80 % |
| `%Q0.0` | K1 → Y1 | opens the fill valve |
| `%Q0.1` | K2 → Y2 | opens the drain valve |

The tank keeps running while you are on the programming tab. In STOP the outputs drop and both valves close. The starting project (`tankProject()`) fills with S1 until B2 and drains with S2 until B1. The twin's data and process model are in `src/twin/tank-model.js`, and `tests/twin.test.mjs` runs that program against the tank model.

## Workflow

1. Edit blocks (Main [OB1] is the cyclic program), tags (PLC tags → `%I0.0`, `%Q0.0`, `%MW10` …) and watch tables.
2. **Compile** `Ctrl+B` — errors appear in *Inspector › Info › Compile*; double-click jumps to the network or line.
3. **Download** `Ctrl+L` (compile + load into the virtual CPU), or **Start simulation** `Ctrl+Shift+X`.
4. **Online**: the editors show live power flow, the tag and watch tables show values, the *Simulation* task card has switches (`%I`) and lamps (`%Q`). Watch tables can modify values.

## How it works

```
LAD / FBD / SCL blocks + tag table  →  src/core/codegen.js  →  IEC Structured Text (+ line map)
   →  STruC++ compile() in the page (type check, diagnostics)  →  src/runtime  (AST → JS closures)
   →  virtual CPU: cyclic task, TIME(), standard function blocks, modify values
```

`src/runtime` is the browser runtime built for the OpenPLC web fork (`../openplc-web`): STruC++'s typed AST executed as closures, no `eval`, no C++ toolchain.

## Declaration and ladder editing

- Click the arrow in any **Data type** cell to see supported types, or type to filter. Arrow keys and Enter select a choice. Unknown types show an immediate inline error and block compilation/download. Block interfaces also offer standard and project function-block instance types. Imported declarations use the same validation rules.
- Use **Insert network** on a network (or Ctrl+R, or the context menu) to add one above or below it, and **Add network at end** at the bottom of the editor.
- Timer and counter pins such as `TON_1.Q` can be used in any network of the same block, even one above the timer.
- The **Instructions** card follows the open editor: items that the open ladder or FBD block cannot use are dimmed, with a note on what to use instead.
- Move the pointer along a rung and a **+** appears on the nearest wire. Click it for the quick menu: the common instructions, **Parallel path (OR)**, **New network below**, and **More instructions…** (a filterable list of every ladder instruction). Arrow keys, Enter, Esc and typing to filter all work in the menu. A new network starts with **+ Add instruction** and a ghost **Add output** coil on the right; the **+ Network** zone between networks adds a blank one.
- Dragging an instruction from the Instructions card highlights the wire it will land on (the nearest **+**). Coils always go to the output column on the right, which is highlighted while you drag one. Arrow keys also visit the wire positions.
- **Operands.** After you insert an instruction its first operand opens for typing. **Enter** accepts it (and opens the next empty one on the same instruction); **Tab** accepts it and moves to the next operand in reading order (left to right, parallel paths top to bottom, then the outputs), **Shift+Tab** goes back, **Esc** cancels this edit. The box offers your tags, block variables, timer and counter pins such as `TON_1.Q`, and `TRUE`/`FALSE` on Bool pins. Each operand is its own undo step. Double-click a timer or counter name (`TON_1`) to rename it; pins that use the old name follow.
- **Creating a tag from the editor.** A name that is not in the tag table is underlined in amber. When you accept such a name, a bubble offers **Create tag** (Enter) or **Not now** (Esc). The new tag gets a type that fits the operand (Bool, Int or Time), no address (so it is internal memory) and is added in the same undo step as the operand.
- **Math.** ADD, SUB, MUL and DIV are ladder boxes with IN1, IN2 and OUT. They run only while the rung has power, and power passes through unchanged. Online, MOVE and math boxes show the current value of OUT.
- **Start branch** (Shift+F8) at a wire position opens a lower parallel path. Add instructions to that path, select a later wire on its parent rung, then **Close branch** (Shift+F9). Existing instructions between the two positions become the upper path. Starting from a selected instruction instead wraps that instruction in the upper path.
- Select a branch or one of its instructions and use **Add parallel path** for a third path. Nested branches work within an existing path. A return connection must be on the same parent series; crossing connections are rejected without changing the program.
- Unclosed branches show an **OPEN** marker and an explanation on their network. Empty bypass paths and contact-only rungs without an output are also reported. Unfinished circuits cannot compile/download; the last downloaded CPU program is retained. Blank spare networks remain permitted. Save/export retains branch drafts, and undo/redo restores each structural edit.

## Shortcuts

Press **F1** in the app for the full list, with the origin of every binding. Bindings marked *engineering-tool convention* were assigned from memory of that tool's defaults; check them against your own installation and edit `src/ui/commands.js` where one differs. Browser-reserved keys (Ctrl+W, Ctrl+T, Ctrl+N) cannot be intercepted by a web page.

## Not included

SFC, pointers and OOP (STruC++ front end accepts them; the runtime does not), real I/O hardware, networking protocols, hardware configuration, multi-user projects. Projects live in the browser (localStorage) and can be exported as JSON.

## Licence

GPL-3.0-only (STruC++ is GPL-3.0). Serving this app to others is distribution: offer them the source.
