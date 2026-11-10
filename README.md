# Web PLC Studio

A PLC engineering studio that runs entirely in a browser tab: Ladder (LAD), Function Block Diagram (FBD) and SCL editors, a compiler, and a virtual CPU with online monitoring. The look and the keyboard / mouse workflow follow the S7 engineering-tool convention (project tree, tabbed editors, task cards, inspector window, green-solid / blue-dashed power flow). The styling is original; no vendor assets are used.

## Run

```bash
npm install --ignore-scripts   # esbuild, CodeMirror, STruC++ (pinned release tarball)
npm run build                  # -> dist/app.js, dist/app.css
npm run serve                  # http://localhost:5190
npm test                       # codegen + virtual CPU tests (Node)
```

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

## Shortcuts

Press **F1** in the app for the full list, with the origin of every binding. Bindings marked *engineering-tool convention* were assigned from memory of that tool's defaults; check them against your own installation and edit `src/ui/commands.js` where one differs. Browser-reserved keys (Ctrl+W, Ctrl+T, Ctrl+N) cannot be intercepted by a web page.

## Not included

SFC, pointers and OOP (STruC++ front end accepts them; the runtime does not), real I/O hardware, networking protocols, hardware configuration, multi-user projects. Projects live in the browser (localStorage) and can be exported as JSON.

## Licence

GPL-3.0-only (STruC++ is GPL-3.0). Serving this app to others is distribution: offer them the source.
