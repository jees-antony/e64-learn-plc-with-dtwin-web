# Ladder editor test checklist

Every editing action a learner can take in the ladder (LAD) editor, and how it is checked. The editor works like the S7 engineering tool: select a position (click a connection, or select an instruction), then insert from the favorites bar, a shortcut, the Instructions card or by dragging.

- **Auto**: covered by `tests/ladder-ui.test.mjs`, which runs the real editor in Node with jsdom (`npm test`). The ID is in the test name.
- **Browser**: needs real layout or real pointer movement, so check it by hand in the app at 1440 and 1100 px wide before a release.

## Inserting instructions

| ID | Action | Expected | Check |
|---|---|---|---|
| T01 | Look at the favorites bar | Normally open contact, Normally closed contact, Assignment, Empty box, Open branch, Close branch, Insert network, in that order | Auto |
| T02 | Look at empty, normal and long networks | No "+" buttons, "+ Add instruction" pill, quick menu, ghost "Add output" coil, "+ Network" gaps, header or "Add network at end" buttons, tips, warning banner or tag bubble | Auto |
| L01 | Open an empty network | One selectable connection; clicking it selects it | Auto |
| L03 | Select a connection, click a favorite | It lands exactly on that connection, between its neighbours, and the operand box opens | Auto |
| L03b | Select an instruction, click a favorite | The new instruction goes to the right of the selected one | Auto |
| L04 | Connection before the first and after the last instruction | Inserted at the start / end of the rung | Auto |
| L05 | Contact then Assignment in an empty network | A complete rung with only the favorites and two names | Auto |
| L09 | Assignment (twice), Shift+F4 set | Coils go to the output column; the rung itself is unchanged | Auto |
| L13 | Shift+F2 / Shift+F3 / Shift+F7 with a connection selected | Inserted at that connection; coils go to the output column | Auto |
| T27 | Shift+F4, F5, F6, F7, F8, F10 and Ctrl+R | Set, empty box, reset, assignment, open branch, compare and a new network | Auto |
| L32 | Favorites bar: contact, empty box, assignment, insert network | Each inserts at the selection | Auto |
| T13 | Drop a payload `{ block }` or `{ lad }` on a network, or call `api().drop` | Call / instruction inserted at the nearest connection | Auto |
| B01 | Drag an instruction from the Instructions card or the favorites bar over a rung | The nearest connection is highlighted and the drop lands there; a coil highlights the output column | Browser |

## Empty box and block calls

| ID | Action | Expected | Check |
|---|---|---|---|
| T03 | Insert an empty box | Header shows "??", the name box opens with TON, TOF, TP, CTU, CTD, SR, RS, CMP ==, MOVE, ADD, SUB, MUL, DIV and the project's FBs and FCs | Auto |
| T04 | Type TON in the empty box | It becomes a TON box in place and the preset (PT) box opens | Auto |
| T05 | Type an invalid name | Box stays open with a message; Esc leaves it empty | Auto |
| T06 | Select an empty box and type a letter; MOVE, CMP >, add | The name box opens seeded with the key; converts to MOVE / compare `>` / ADD | Auto |
| T07 | Click the "??" | The name box opens | Auto |
| L16 | Empty box, ADD, fill the three operands | Math box with IN1, IN2, OUT filled | Auto |
| T08 | Insert an FC (`insertCall`) | `{ k: 'call' }` inserted with no dialog and no DB; first pin opens | Auto |
| T09 | Insert an FB, OK in Call options | Call with `<FB>_DB` and a new instance DB | Auto |
| T10 | Cancel in Call options | Nothing inserted, no DB | Auto |
| T11 | Call an FB from an OB, then from an FB | Multi instance tile disabled in the OB; in an FB it adds a Static variable and `multi: true`, no DB | Auto |
| T12 | Empty box, type an FB name | Same Call options flow | Auto |
| T14 | Fill the pins of a call box | Inputs on the left, outputs on the right; Enter walks to the next empty pin; double-click edits | Auto |
| T15 | Look at an FB call | Instance DB number above the box, instance name shown with quotes | Auto |

## Operands and tags

| ID | Action | Expected | Check |
|---|---|---|---|
| T16 | Look at operands; type `#x` or `"B"` | Global tags shown as `"A"` with the address above, block variables as `#x`; stored without quotes | Auto |
| T17 | Type an unknown name, Enter | Stored as typed, marked unknown, toast points to "Define tag…", no tag created, no bubble | Auto |
| L07 | Unknown name in a new contact | Name kept, no tag, operand marked unknown | Auto |
| L08 | Type an invalid name ("2 bad") | Refused with an explanation, box stays open | Auto |
| T18 | Right-click an unknown operand, Define tag… | Dialog with Name, Section, Data type, Address, Comment; Define creates the global tag with its address | Auto |
| T19 | Define tag with a bad address, then Local · Temp | Bad address refused; local section adds a block variable and the operand shows `#name` | Auto |
| T20 | Right-click a tag, Rename tag…, OK | Renamed in the tag table, every network and watch table | Auto |
| T21 | Rename tag to an existing name | Refused, dialog stays open | Auto |
| T22 | Right-click an instruction, a timer, a connection, a multi-selection | Cut, Copy, Paste, Delete, tag items, Insert network, branch items; timers add Rename instance…; a multi-selection adds Open branch around selection | Auto |
| T23 | Rewire tag…, Insert network from the menu | Operand box reopens; network inserted | Auto |
| T24 | Drag a tag onto an operand, a coil operand, and onto the bare rung | Operand set; the bare rung only shows an explanation | Auto |
| T28 | Click an empty operand; type a key on a selected instruction | Operand box opens; typing seeds it | Auto |
| L10 | Insert TON / CTU | Box opens on the preset (PT / PV); Tab reaches R; Shift+Tab goes back | Auto |
| L11 | Tab through a rung with a parallel path | Order is main rung, top path, lower path, coils; never stops on a wire | Auto |
| L12 | Esc in the operand box | Edit cancelled, old value kept | Auto |
| L28 | Double-click a timer name, rename it | Every `Timer.Q` reference in the block follows; one undo step | Auto |
| L29 | Operand suggestions | Timer and counter pins (`TON_1.Q`) are offered | Auto |
| L42 | Open an operand box | Tag table: Name, Data type, Address, Initial value, Comment; right type first, others under "Other data types" | Auto |
| L43 | Type to filter, arrow + Enter, click a row, or type a new name + Enter | Filter narrows; highlighted / clicked row taken; otherwise the typed text is kept | Auto |
| B09 | Contacts and coils with long tag names | The wire runs into the symbol on both sides, also when monitoring | Browser |

## Parallel paths (branches)

| ID | Action | Expected | Check |
|---|---|---|---|
| L17 | Select a contact, Shift+F8, add a contact to the lower path, right-click the connection | "Close branch" is offered (and "Open branch" is not); result is an OR around the contact | Auto |
| L18 | Add a third path, close it, remove a path | Three paths, then back to the top path only | Auto |
| L18b | Right-click a selected branch | "Insert parallel path" adds a path | Auto |
| L19 | Close a path that is still empty | Refused with an explanation; nothing changes | Auto |
| L21 | Delete the only contact of a parallel path | The empty path disappears | Auto |
| L33 | Seal-in rung: select S1, Shift+F8, add S3 below, close from the connection menu | Nested OR in the top path; (S1 OR S3 OR K1) AND NOT B2; compiles | Auto |
| L34 | Seal-in rung: connection before S1, Open branch favorite, close after S1 | Same nested OR, S1 moved into it | Auto |
| L35 | Seal-in rung: select K1, Shift+F8, add, Shift+F9 | Nested OR in the lower path | Auto |
| L36 | Series contact in the holding path, then a second OR on the main rung | Two ORs in series with the right logic | Auto |
| L37 | Open branch at the first connection, Close branch after B2 | A bypass around the whole seal-in and B2 | Auto |
| L38 | Try to close a nested path on the outer rung | Not offered in the menu; Shift+F9 refuses; nothing changes | Auto |
| L39 | Type a new tag name, then go straight on (Shift+F9) | The name stays (marked unknown); no tag created; no bubble | Auto |
| L40 | Open path started before S1 inside the seal-in | Only the connection just after S1 is a join target; its menu offers "Close branch"; markers vanish once joined | Auto |
| L41 | Drop the branch-end arrow anywhere in the network | Snaps to the nearest join connection and joins there | Auto |
| T25 | Network with an open branch | A "!" marker (`.net-err`) in the network header, message in its title; gone once the branch is closed; no banner | Auto |
| T26 | Complete networks | No error marker | Auto |
| B04 | Drag the branch-end arrow towards a join connection with a real mouse | The nearest join connection is highlighted while dragging; releasing joins there | Browser |
| B08 | Nested ORs (top path, lower path, middle path, two levels deep, still open) | Vertical join lines run exactly from the top path's wire to the bottom path's wire | Browser |

## Delete, undo, copy and paste

| ID | Action | Expected | Check |
|---|---|---|---|
| L20 | Delete an instruction, a coil and a whole branch; undo and redo | Each step is undone and redone exactly | Auto |
| L22 | Delete with only a connection selected | Nothing deleted, no undo step recorded | Auto |
| L23 | Delete with a network selected | Network removed, toast says Ctrl+Z undoes it | Auto |
| L25 | Copy and paste a network with a timer | The copy gets its own timer (`TON_2`), references inside the copy follow it | Auto |
| L26 | Copy, cut, paste one instruction and one coil | Pasted at the selected connection or after the selected instruction | Auto |

## Networks and navigation

| ID | Action | Expected | Check |
|---|---|---|---|
| L24 | Favorites "Insert network", Ctrl+R, context menu, insert above | Each inserts at the right place and selects the new network's first connection | Auto |
| L27 | Arrow keys | Left/right walk connections and instructions in order; up/down change network | Auto |

## Long rungs, layout and monitoring

| ID | Action | Expected | Check |
|---|---|---|---|
| L30 | More than 10 instructions in series | No tip, no warning, no error marker | Auto |
| L31 | Build a program only through the editor (including Define tag…), compile | 0 errors | Auto |
| B05 | 15 contacts in one rung at 1440 and 1100 px | Coil and both rails stay visible; scroll arrows and shadows only on the side with hidden content; the new instruction is fully in view | Browser |
| B06 | Zoom with Ctrl+wheel (0.6 to 1.6) | Rung stays usable | Browser |
| B07 | Download (Ctrl+L) and watch the rung | Green power flow follows the inputs; MOVE and ADD show their result next to OUT | Browser |
