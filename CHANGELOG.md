# Changelog

All notable changes to this module. Versions follow [Semantic Versioning](https://semver.org/).

## [1.9.0]

- **Players can now note NPC tokens.** Foundry only opens a Token HUD for the token's owner
  (`_canHUD` requires ownership; tiles require a GM), so players right-clicking an NPC got no HUD
  and never saw the sticky-note button. A right-click on anything that won't open a HUD now
  summons the module's own small button beside it. Right-drag panning is unaffected.
- Hover and right-click hit-testing ignore hidden tokens for non-GMs, so neither can reveal that
  something hidden is there.

## [1.8.0]

- Notes now appear on hover **regardless of which tool is selected**. Foundry only fires its
  hover hooks while an object's own layer is active, so the module hit-tests all layers itself.
  The same hit-test drives the keybinding. Toggle with *Show notes on any layer*.
- Overlapping objects resolve to the smallest — a token inside a region shows the token's note.

## [1.7.0]

- **Drawings** can carry notes, with the same right-click HUD button as tokens.
- **Sticky pins** are now real Drawings created pre-shaped and flagged by the module, so they
  move, resize, lock, layer and delete natively. The pin takes the note's colour as its fill and
  the note's name as its label.
- The pin tool moved to the Drawings toolbar and hides itself without `DRAWING_CREATE`.

## [1.6.0]

- Markers, pins and buttons track placeables live while they're dragged or reshaped, by following
  the drag preview rather than the committed document.
- Panning and zooming reposition existing overlay elements instead of rebuilding them.

## [1.5.2]

- Region note buttons are summoned by right-click and dismissed by left-click, mirroring a HUD.
- Visibility options in the editor are left-justified.

## [1.5.0]

- **Regions** can carry notes. Replaced an earlier `RegionBehaviorType` approach, which required a
  `documentTypes` manifest declaration and buried the note three clicks deep.

## [1.4.0]

- Notes attachable to regions via a custom region behaviour. *(Superseded in 1.5.0.)*

## [1.3.0]

- Keybindings: **N** notes the object under the cursor, **Shift+N** places a pin.

## [1.2.0]

- Free-placed map pins, for annotating open ground where there's no placeable to right-click.

## [1.1.0]

- Notes can be **shared with the party**, stored on the document itself.
- Players without permission to update a document write shared notes through the **User Query
  API**, which relays to the active GM's client. Authorship is set GM-side so it can't be forged.

## [1.0.0]

- Initial release: private per-player notes on tokens and tiles, hover display, corner markers.
