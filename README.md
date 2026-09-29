# Sticky Notes

A Foundry VTT module for annotating your maps. Right-click a token, drawing, tile or region and
attach a note — keep it private to yourself, or share it with the whole party. Hover anything with
a note to read it.

Built and tested on **Foundry V14** (works on V13+), system-agnostic.

---

## Install

**In Foundry:** *Add-on Modules → Install Module*, paste this manifest URL:

```
https://github.com/djansen01/foundry-vtt-stickynotes/releases/latest/download/module.json
```

**Manually:** download `module.zip` from the [latest release][releases], unzip it into your
Foundry `Data/modules/sticky-notes/` folder, and restart.

Then enable **Sticky Notes** under *Game Settings → Manage Modules*.

[releases]: https://github.com/djansen01/foundry-vtt-stickynotes/releases/latest

---

## Using it

### Attach a note

| What | How |
|---|---|
| **Token** | Right-click it → sticky-note button at the bottom of the HUD's left column |
| **Drawing** | Right-click it → same button |
| **Tile** | Switch to the Tiles layer, right-click it |
| **Region** | Right-click it to summon its button (Foundry defines no HUD for regions) |
| **Anywhere on the map** | Drawings toolbar → sticky-note tool → click the map |

Or use the keyboard:

| Key | |
|---|---|
| **N** | Note whatever's under the cursor — or the selected token |
| **Shift+N** | Place a sticky pin, then click the map |

Both rebindable under *Configure Controls*.

### Read a note

Hover the object. Notes appear **whatever tool you have selected** — you don't have to be on the
Tokens layer to read a token's note.

Objects carrying a note get a small coloured corner marker so you can see which ones have notes
without hovering everything.

### Delete a note

Press **Delete** in the editor, or clear both fields and save.

---

## Private vs shared

Every note is one or the other, chosen in the editor:

- **Private to me** — stored in your own User flags. Only you see it. Everyone at the table can
  have their own private note on the same token without colliding.
- **Shared with party** — stored on the object itself, so everyone sees it. One shared note per
  object. Only its author or the GM can change it; anyone else can still keep a private note
  alongside, and both show on hover.

Switching visibility moves the note between the two stores, so nothing is duplicated.

Shared notes are outlined in blue, credited to their author, and stack above your private one.
Corner markers are round for shared, square for private.

> **A GM must be online to save a *shared* note** on something you don't own — see below. Private
> notes never need a GM.

### How players write shared notes

Players can't normally update an NPC token, a tile or a scene. Rather than a hand-rolled socket
relay, this uses Foundry V13+'s **User Query API**:

- If you can modify the document, the write happens directly.
- If not, the module calls `game.users.activeGM.query(...)` and the GM's client performs the write.

Queries are promise-based (the player gets a real error rather than silence), carry the requesting
user so the GM's client can authorise properly, have a built-in timeout, and `activeGM` designates
exactly one GM — so multiple GM clients can't race the same write. The GM-side handler re-checks
permission and overwrites the author field, so a modified client can't forge authorship.

Sticky pins are **Drawings**, and `DRAWING_CREATE` defaults to the TRUSTED role — so trusted
players can place their own pins with no GM involvement at all.

### A caveat on "private"

Private notes are privacy *by convention*. User documents are world-visible in Foundry, so a
determined player could read another's from the browser console. That's the right trade for a home
table, not a secrets system.

---

## Settings

All per-player, under *Configure Settings → Module Settings*.

| Setting | Default | |
|---|---|---|
| Enable sticky notes | on | Turns the module's UI off for you without disabling the module |
| Show notes on any layer | on | Off falls back to Foundry's per-layer hover hooks |
| Always show region note buttons | off | On shows a button on every region instead of right-click to summon |
| Show markers on noted objects | on | The corner dots |
| Hover delay (ms) | 250 | 0 shows notes instantly |

---

## Macro API

```js
StickyNotes.private(token.document)  // your private note, or null
StickyNotes.shared(token.document)   // the party note, or null
StickyNotes.all()                    // all your private notes, keyed by sanitised UUID
StickyNotes.open(token.document)     // open the editor
StickyNotes.placePin()               // arm pin placement
StickyNotes.refresh()                // redraw the overlay
```

---

## How it works

Worth reading if you plan to modify it — several of these were non-obvious.

**Storage.** Private notes live in `game.user` flags keyed by the object's UUID with dots replaced
by underscores (flag keys can't contain dots). Shared notes live in the object's own flags.
Deleting uses the `-=key` syntax, because flag writes merge by default.

**Hover works on any layer.** Foundry only fires `hoverToken` while the Tokens layer is active,
`hoverDrawing` while Drawings is active, and so on. The module instead tracks `pointermove` over
the board and hit-tests all layers itself, throttled to one animation frame and comparing only
bounding boxes. When objects overlap, the smallest wins, so a token inside a region shows the
token's note.

**The overlay follows the canvas.** Markers, pins and buttons are HTML in a fixed layer. Each
element carries a `_snPos()` closure, so panning and dragging reposition existing elements rather
than rebuilding them; full rebuilds happen only on structural change. Foundry emits
`refresh<DocumentName>` continuously during a drag, and a dragged placeable is a **preview clone**
— `livePlaceable()` follows the clone, which is why a button tracks a region while you reshape it.

**HUD buttons carry no `data-action`.** That attribute dispatches through the HUD's own action map
and throws on an unknown action; the button uses its own listener.

**Sticky pins are ordinary Drawings.** Foundry only allows module sub-types on documents with a
`type` field (Actor, Item, RegionBehavior…), and Drawing isn't one — so there's no way to register
a new *kind* of drawing. A pin is a normal Drawing created pre-shaped and flagged by the module,
which means it inherits a HUD, move, resize, lock, layering, delete and undo for free.

**Regions took two attempts.** The first registered a custom `RegionBehaviorType` so "Sticky Note"
would appear in the Behaviours list. That needs a `documentTypes` declaration in the manifest or it
never shows up — and even working, it buried a one-field note three clicks deep. Regions now take
the same flag-based note as everything else.

**`scripts/main.js` is a permanent two-line loader** that imports `core.js` with a cache-busting
query string, so the manifest never changes and browsers can't serve a stale `core.js`.

---

## Contributing

Issues and pull requests welcome.

```bash
git clone https://github.com/djansen01/foundry-vtt-stickynotes.git
ln -s "$(pwd)/foundry-vtt-stickynotes" /path/to/foundrydata/Data/modules/sticky-notes
```

There's no build step — the module ships as plain ES modules. CI runs `node --check` on the
scripts and validates the manifest; please make sure both pass.

To cut a release, bump the version in `CHANGELOG.md` and push a tag:

```bash
git tag v1.8.1 && git push origin v1.8.1
```

The release workflow stamps `module.json` with the version and the manifest/download URLs, zips
the module, and publishes a GitHub Release.

---

## Licence

[MIT](LICENSE) — use it, change it, redistribute it, commercially or otherwise. Just keep the
copyright notice.
