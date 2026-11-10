# Beginner editing verification

Verified 10 November 2026. Scope: data-type selection/validation and LAD rung/branch editing in `plc-web`.

## Automated checks

`node --test --test-isolation=none tests/*.test.mjs`: 19 passing tests (5 existing engine tests and 14 editing/validation regressions).

Coverage includes unsupported and removed FB types; imported invalid tag types; insertion before, between and after instructions; saved unfinished branches; closing across multiple instructions; all 32 input combinations of a circuit with a bypass branch; nested branches; third paths; rejected empty/backward joins; compatibility with existing projects; missing rung outputs; and upstream conditions reaching a timer within a branch.

`npm run build`: successful. No dependencies added. Generated `dist/` assets rebuilt for the local preview.

## Browser verification

Tested the real bundled application in the in-app browser at `http://127.0.0.1:5190/`:

1. Added a block-interface declaration using its existing Add new row.
2. Entered `Boool`: the type cell immediately showed an error and `aria-invalid=true`.
3. Compiled: diagnostics identified Main / Temp / Temp_1 and rejected the unknown type.
4. Filtered the type dropdown and selected `Int`.
5. Added an extra rung using the visible + Rung button, inserted a contact and a coil, and edited their operands.
6. Started a branch at the wire before the first instruction. The open branch marker and network warning appeared; compilation was rejected with its network number.
7. Added the parallel contact, selected the return wire and closed the branch through the toolbar. Compilation succeeded.
8. Reloaded the page: the completed branch and type persisted.
9. Checked undo/redo of a branch draft: the unclosed warning disappeared on undo and returned on redo.
10. Captured both validation errors in `editor-validation.png`, then restored the test project to valid types and closed branches. Final compilation succeeded, with no captured browser console errors.

The first sandboxed preview could not be reached. Restarting the same local server outside the sandbox restored HTTP and browser access. The preview is a local QA service; it is not a cloud deployment.

## Behaviour boundaries

- Branches are structured series/parallel circuits. Their return point must be on the same parent series; arbitrary crossing connections are not supported.
- New branches require an explicit Close branch action. Existing stored branches without the new draft flag remain closed for compatibility.
- Empty parallel paths are rejected because they create an unconditional bypass. Blank spare networks are permitted; a nonempty contact-only rung needs an output/action.
- Unknown type text remains visible so the learner can correct it. It cannot pass preflight compilation/download.
