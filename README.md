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
- Each network has **+ Rung**, and the bottom of the editor has **+ Add network / rung**. Ctrl+R inserts below the selected network; the context menu can also insert above it.
- Select a wire segment (**+** appears on hover/selection) to insert before the first instruction, between instructions, or at the end of a series. Dragging an instruction onto that wire uses the same position. Arrow keys also visit these connection points.
- **Start branch** (Shift+F8) at a wire position opens a lower parallel path. Add instructions to that path, select a later wire on its parent rung, then **Close branch** (Shift+F9). Existing instructions between the two positions become the upper path. Starting from a selected instruction instead wraps that instruction in the upper path.
- Select a branch or one of its instructions and use **Add parallel path** for a third path. Nested branches work within an existing path. A return connection must be on the same parent series; crossing connections are rejected without changing the program.
- Unclosed branches show an **OPEN** marker and an explanation on their network. Empty bypass paths and contact-only rungs without an output are also reported. Unfinished circuits cannot compile/download; the last downloaded CPU program is retained. Blank spare networks remain permitted. Save/export retains branch drafts, and undo/redo restores each structural edit.

## Shortcuts

Press **F1** in the app for the full list, with the origin of every binding. Bindings marked *engineering-tool convention* were assigned from memory of that tool's defaults; check them against your own installation and edit `src/ui/commands.js` where one differs. Browser-reserved keys (Ctrl+W, Ctrl+T, Ctrl+N) cannot be intercepted by a web page.

## Not included

SFC, pointers and OOP (STruC++ front end accepts them; the runtime does not), real I/O hardware, networking protocols, hardware configuration, multi-user projects. Projects live in the browser (localStorage) and can be exported as JSON.

## Licence

GPL-3.0-only (STruC++ is GPL-3.0). Serving this app to others is distribution: offer them the source.
