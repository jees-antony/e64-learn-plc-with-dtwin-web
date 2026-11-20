# Ladder editor test checklist

Every editing action a learner can take in the ladder (LAD) editor, and how it is checked.

- **Auto**: covered by `tests/ladder-ui.test.mjs`, which runs the real editor in Node with jsdom (`npm test`). The ID is in the test name.
- **Browser**: needs real layout or real pointer movement, so check it by hand in the app at 1440 and 1100 px wide before a release.

## Adding instructions

| ID | Action | Expected | Check |
|---|---|---|---|
| L01 | Open an empty network | "+ Add instruction" pill and a dashed "Add output" coil are visible without hovering | Auto |
| L02 | Click a "+" on a wire | Quick menu: NO, NC, output coil, set, reset, TON, CTU, parallel path, new network, More instructions… | Auto |
| L03 | Pick an instruction from the menu | It lands exactly on that wire, between its neighbours, and the operand box opens | Auto |
| L04 | "+" before the first and after the last instruction | Inserted at the start / end of the rung | Auto |
| L05 | Contact then "Add output" in an empty network | A complete rung with only clicks and two names | Auto |
| L09 | Add output, "+" under the last coil, set/reset from the menu | Coils go to the output column, the rung itself is unchanged | Auto |
| L13 | Shift+F2 / Shift+F3 / Shift+F7 with a wire selected | Inserted at that wire; coils go to the output column | Auto |
| L16 | More instructions…, type a name, Enter | The best match is highlighted and inserted (typing "add" gives ADD, not "Add parallel path") | Auto |
| L32 | Favorites bar above the editor | Click inserts at the selection; "+ Network" adds a network below | Auto |
| B01 | Move the mouse along a rung | Exactly one "+" fades in, the one nearest the pointer | Browser |
| B02 | Click a "+" quickly without pausing on it first (or tap on a touch screen) | The menu opens | Browser |
| B03 | Drag an instruction from the Instructions card or the favorites bar | The "+" nearest the pointer is highlighted and the drop lands there; a coil highlights the output column | Browser |

## Operands and tags

| ID | Action | Expected | Check |
|---|---|---|---|
| L06 | Type an unknown name, Enter | "Tag 'X' does not exist yet" bubble; Create adds it with the right type (Bool for contacts, Time for timer presets, Int for numbers) | Auto |
| L07 | "Not now" in the bubble | Name kept, no tag created, operand underlined as unknown | Auto |
| L08 | Type an invalid name ("2 bad") | Refused with an explanation, box stays open | Auto |
| L10 | Insert TON / CTU | Box opens on the preset (PT / PV); Tab reaches R; Shift+Tab goes back | Auto |
| L11 | Tab through a rung with a parallel path | Order is main rung → top path → lower path → coils; never stops on a wire | Auto |
| L12 | Esc in the operand box | Edit cancelled, old value kept | Auto |
| L28 | Double-click a timer name, rename it | Every `Timer.Q` reference in the block follows; one undo step | Auto |
| L29 | Operand suggestions | Timer and counter pins (`TON_1.Q`, `CTU_1.CV`) are offered | Auto |
| L42 | Open an operand box | A TIA-style tag table appears under it: Name, Data type, Address, Initial value, Comment; tags of the right type first, others under "Other data types" | Auto |
| L43 | Type to filter, arrow + Enter, click a row, or type a new name + Enter | Filter narrows the table; the highlighted / clicked row is taken; with no row chosen the typed text is kept | Auto |
| B09 | Contacts and coils with long tag names (B2_LevelHigh, K2_DrainValve) | The wire runs into the symbol on both sides: no white gap between line and instruction, also when monitoring | Browser |

## Parallel paths (branches)

| ID | Action | Expected | Check |
|---|---|---|---|
| L17 | Select a contact, Shift+F8, add a contact to the lower path, close from "+" | "Close the parallel path here" is the first menu row on a valid wire; the result is an OR around the contact | Auto |
| L18 | Add a third path, close it, remove a path | Three paths, then back to the top path only | Auto |
| L19 | Close a path that is still empty | Refused with an explanation; nothing changes | Auto |
| L21 | Delete the only contact of a parallel path | The empty path disappears (no hidden always-true bypass) | Auto |
| L33 | Seal-in rung: select S1, Shift+F8, add S3 below, close from "+" | Nested OR inside the top path; logic is (S1 OR S3 OR K1) AND NOT B2; compiles | Auto |
| L34 | Seal-in rung: "+" before S1 inside the top path → Parallel path, close after S1 | Same nested OR, S1 moved into it, nothing left behind | Auto |
| L35 | Seal-in rung: select K1 in the holding path, Shift+F8, add, Shift+F9 | Nested OR inside the lower path | Auto |
| L36 | Series contact in the holding path, then a second OR around B2 on the main rung | Two ORs in series with the right logic | Auto |
| L37 | Parallel path from the first wire of the rung, closed after B2 | A bypass around the whole seal-in and B2 | Auto |
| L38 | Try to close a nested path on the outer rung | Not offered in the menu; Shift+F9 refuses with an explanation; nothing changes | Auto |
| L39 | Type a new tag name, then go straight on (Shift+F9, Esc) without answering the "does not exist" bubble | The name stays on the rung (shown as unknown); no tag is created | Auto |
| L40 | Open path started from the "+" in front of S1 inside the seal-in | Only the wire just after S1 is marked green (wider, "+" visible); its menu offers "Close the parallel path here" first; markers vanish once joined | Auto |
| L41 | Drop "Drag to join" anywhere in the network, not on the wire | Snaps to the nearest green wire and joins there | Auto |
| B04 | Drag "Drag to join" towards a green wire with a real mouse | The nearest green "+" fills in while dragging; releasing joins there | Browser |
| B08 | Nested ORs (inside the top path, the lower path, a middle path, two levels deep, still open) | Every vertical join line runs exactly from the top path's wire to the bottom path's wire: no gaps, no lines hanging below | Browser |

## Delete, undo, copy and paste

| ID | Action | Expected | Check |
|---|---|---|---|
| L20 | Delete an instruction, a coil and a whole branch; undo and redo | Each step is undone and redone exactly | Auto |
| L22 | Delete with only a wire selected | Nothing deleted, no undo step recorded | Auto |
| L23 | Delete with a network selected | Network removed, toast says Ctrl+Z undoes it | Auto |
| L25 | Copy and paste a network with a timer | The copy gets its own timer (`TON_2`), references inside the copy follow it, other networks keep the original | Auto |
| L26 | Copy, cut, paste one instruction and one coil | Pasted at the selected wire or after the selected instruction; cut removes only what is selected | Auto |

## Networks and navigation

| ID | Action | Expected | Check |
|---|---|---|---|
| L24 | Header "Insert network", "+ Network" between networks, Ctrl+R, insert above, "Add network at end" | Each inserts at the right place and selects the new network's first wire | Auto |
| L27 | Arrow keys | Left/right walk wires and instructions in order; up/down change network | Auto |
| L14, L15 | Quick menu keyboard | Arrows move, Enter picks, Esc closes without inserting; Shift+F2 still works while it is open | Auto |

## Long rungs, layout and monitoring

| ID | Action | Expected | Check |
|---|---|---|---|
| L30 | More than 10 instructions in series | A calm "split the logic" tip, not a warning | Auto |
| L31 | Build a program only through the editor, compile | 0 errors | Auto |
| B05 | 15 contacts in one rung at 1440 and 1100 px | Coil and both rails stay visible; scroll arrows and shadows appear only on the side with hidden content; the newly inserted instruction is fully in view | Browser |
| B06 | Zoom with Ctrl+wheel (0.6 to 1.6) | Rung stays usable; the "+" and the menu line up with the wire | Browser |
| B07 | Download (Ctrl+L) and watch the rung | Green power flow follows the inputs; the "+", "Add output" and "+ Network" never take monitoring colours; MOVE and ADD show their result next to OUT | Browser |
