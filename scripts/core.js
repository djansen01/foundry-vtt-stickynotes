/**
 * Sticky Notes — annotate canvas tokens and tiles.
 *
 * Two kinds of note:
 *   PRIVATE — stored in the player's own User flags. Only they see it.
 *   SHARED  — stored in the placeable document's flags. The whole party sees it.
 *
 * Writing a shared note needs permission to update the document, which players don't have for
 * NPC tokens or tiles. Rather than a hand-rolled socket relay, this uses Foundry V13+'s
 * User Query API: the player asks the designated active GM's client to perform the write.
 * Queries are promise-based (we get success/failure back), carry the requesting user for
 * authorisation, have a built-in timeout, and `game.users.activeGM` designates exactly one GM,
 * so there is no risk of several GM clients racing to apply the same change.
 *
 * Foundry V13/V14.
 */

const MOD = "sticky-notes";
const FLAG = "notes";            // user flag: map of private notes
const SHARED = "shared";         // document flag: the one shared note
const PINS = "pins";             // scene flag (shared) / user flag (private): free-placed map pins
const QUERY = `${MOD}.shared`;   // CONFIG.queries key
const QUERY_TIMEOUT = 10_000;

const COLORS = {
  yellow: "#f4d35e",
  blue:   "#8ecae6",
  green:  "#a7c957",
  pink:   "#f4a6c0",
  grey:   "#c9c9c9"
};

const esc = s => foundry.utils.escapeHTML(String(s ?? ""));

/* -------------------------------------------- */
/*  Storage — private                            */
/* -------------------------------------------- */

/** Flag keys can't contain dots; UUIDs are full of them. */
const keyFor = doc => doc.uuid.replaceAll(".", "_");
const allPrivate = () => game.user.getFlag(MOD, FLAG) ?? {};
const privateFor = doc => (doc ? allPrivate()[keyFor(doc)] ?? null : null);

async function savePrivate(doc, data) {
  await game.user.setFlag(MOD, FLAG, { [keyFor(doc)]: normalise(data) });
}

async function deletePrivate(doc) {
  // Flag writes merge, so removing a key needs the -= deletion syntax.
  await game.user.update({ [`flags.${MOD}.${FLAG}.-=${keyFor(doc)}`]: null });
}

function normalise(data) {
  return {
    name:  (data.name ?? "").trim(),
    info:  (data.info ?? "").trim(),
    color: data.color in COLORS ? data.color : "yellow",
    author: data.author ?? game.user.id,
    authorName: data.authorName ?? game.user.name,
    updated: Date.now()
  };
}

/* -------------------------------------------- */
/*  Storage — shared                             */
/* -------------------------------------------- */

const sharedFor = doc => doc?.getFlag?.(MOD, SHARED) ?? null;

/** Author or GM may change an existing shared note; anyone may create one. */
function mayEditShared(note, user = game.user) {
  if ( user.isGM ) return true;
  if ( !note ) return true;
  return note.author === user.id;
}

async function applyShared(doc, note) {
  if ( note === null ) await doc.unsetFlag(MOD, SHARED);
  else await doc.setFlag(MOD, SHARED, note);
}

/**
 * Write a shared note, directly if we're allowed, otherwise by asking the active GM.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function writeShared(doc, note) {
  if ( doc.canUserModify(game.user, "update") ) {
    await applyShared(doc, note);
    return { ok: true };
  }

  const gm = game.users.activeGM;
  if ( !gm ) return { ok: false, reason: game.i18n.localize("STICKYNOTES.NoGM") };

  try {
    const res = await gm.query(QUERY, { kind: "doc", uuid: doc.uuid, note }, { timeout: QUERY_TIMEOUT });
    return res?.ok ? { ok: true } : { ok: false, reason: res?.reason ?? game.i18n.localize("STICKYNOTES.Refused") };
  } catch (err) {
    console.error(`${MOD} | shared-note query failed`, err);
    return { ok: false, reason: err.message ?? game.i18n.localize("STICKYNOTES.Refused") };
  }
}

/** Runs on the GM's client on behalf of a player. Handles both placeable notes and map pins. */
async function handleSharedQuery(payload, { user }) {
  const { kind = "doc" } = payload;

  if ( kind === "pin" ) {
    const { sceneId, pinId, pin } = payload;
    const scene = game.scenes.get(sceneId);
    if ( !scene ) return { ok: false, reason: "Scene not found" };
    const existing = (scene.getFlag(MOD, PINS) ?? {})[pinId] ?? null;
    if ( !mayEditShared(existing, user) ) {
      return { ok: false, reason: `${user.name} may not change ${existing?.authorName ?? "another player"}'s party pin` };
    }
    if ( pin && pin.author !== user.id && !user.isGM ) pin.author = user.id;
    await applySharedPin(scene, pinId, pin);
    return { ok: true };
  }

  const doc = await fromUuid(payload.uuid);
  if ( !doc ) return { ok: false, reason: "Document not found" };
  const existing = sharedFor(doc);
  if ( !mayEditShared(existing, user) ) {
    return { ok: false, reason: `${user.name} may not change ${existing?.authorName ?? "another player"}'s party note` };
  }
  const note = payload.note;
  if ( note && note.author !== user.id && !user.isGM ) note.author = user.id;   // don't let a client forge authorship
  await applyShared(doc, note);
  return { ok: true };
}

/* -------------------------------------------- */
/*  Editor dialog                                */
/* -------------------------------------------- */

function editorContent(doc, note, scope, lockedShared) {
  const swatches = Object.entries(COLORS).map(([id, hex]) => `
    <label class="sn-swatch" style="--sn-c:${hex}">
      <input type="radio" name="color" value="${id}" ${(note?.color ?? "yellow") === id ? "checked" : ""}>
      <span></span>
    </label>`).join("");

  const lockNotice = lockedShared ? `
    <p class="notification info sn-locked">
      ${game.i18n.format("STICKYNOTES.LockedShared", { name: esc(lockedShared.authorName ?? "someone") })}
    </p>` : "";

  return `
  <form class="sn-form" autocomplete="off">
    ${lockNotice}
    <div class="form-group">
      <label>${game.i18n.localize("STICKYNOTES.FieldVisibility")}</label>
      <div class="form-fields sn-scope">
        <label class="sn-scope-opt">
          <input type="radio" name="scope" value="private" ${scope === "private" ? "checked" : ""}>
          <i class="fa-solid fa-lock"></i> ${game.i18n.localize("STICKYNOTES.ScopePrivate")}
        </label>
        <label class="sn-scope-opt">
          <input type="radio" name="scope" value="shared" ${scope === "shared" ? "checked" : ""}>
          <i class="fa-solid fa-users"></i> ${game.i18n.localize("STICKYNOTES.ScopeShared")}
        </label>
      </div>
      <p class="hint">${game.i18n.localize("STICKYNOTES.ScopeHint")}</p>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize("STICKYNOTES.FieldName")}</label>
      <div class="form-fields">
        <input type="text" name="name" value="${esc(note?.name)}" placeholder="${esc(doc.name ?? "")}">
      </div>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize("STICKYNOTES.FieldInfo")}</label>
      <div class="form-fields"><textarea name="info" rows="6">${esc(note?.info)}</textarea></div>
    </div>
    <div class="form-group">
      <label>${game.i18n.localize("STICKYNOTES.FieldColor")}</label>
      <div class="form-fields sn-swatches">${swatches}</div>
    </div>
  </form>`;
}

function readForm(el) {
  const form = el?.tagName === "FORM" ? el : el?.querySelector?.("form");
  if ( !form ) return { name: "", info: "", color: "yellow", scope: "private" };
  return {
    name: form.elements.name?.value ?? "",
    info: form.elements.info?.value ?? "",
    color: form.querySelector('input[name="color"]:checked')?.value ?? "yellow",
    scope: form.querySelector('input[name="scope"]:checked')?.value ?? "private"
  };
}

async function openEditor(doc) {
  const shared = sharedFor(doc);
  const priv = privateFor(doc);

  // Edit the party note if there is one and we're allowed to touch it; otherwise our own.
  const editingShared = !!shared && mayEditShared(shared);
  const note = editingShared ? shared : priv;
  const startScope = editingShared ? "shared" : "private";
  const lockedShared = (shared && !editingShared) ? shared : null;

  const buttons = [
    { action: "save", label: game.i18n.localize("STICKYNOTES.Save"), icon: "fa-solid fa-floppy-disk",
      default: true,
      callback: (event, button, dialog) => ({ op: "save", data: readForm(button.form ?? dialog.element) }) },
    { action: "cancel", label: game.i18n.localize("STICKYNOTES.Cancel"), icon: "fa-solid fa-xmark",
      callback: () => ({ op: "cancel" }) }
  ];
  if ( note ) buttons.splice(1, 0, {
    action: "delete", label: game.i18n.localize("STICKYNOTES.Delete"), icon: "fa-solid fa-trash",
    callback: () => ({ op: "delete" })
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${game.i18n.localize("STICKYNOTES.Title")} — ${doc.name ?? doc.documentName}`,
              icon: "fa-solid fa-note-sticky" },
    position: { width: 440 },
    classes: ["sticky-notes-editor"],
    content: editorContent(doc, note, startScope, lockedShared),
    buttons,
    rejectClose: false
  }).catch(() => null);

  if ( !result || result.op === "cancel" ) return;

  /* ---- delete ---- */
  if ( result.op === "delete" ) {
    if ( startScope === "shared" ) {
      const r = await writeShared(doc, null);
      if ( !r.ok ) return ui.notifications.warn(r.reason);
    } else await deletePrivate(doc);
    ui.notifications.info(game.i18n.localize("STICKYNOTES.Deleted"));
    return refreshMarkers();
  }

  /* ---- save ---- */
  const { name, info, scope } = result.data;

  if ( !name && !info ) {                                   // emptied out == delete
    if ( startScope === "shared" && shared ) await writeShared(doc, null);
    else if ( priv ) await deletePrivate(doc);
    ui.notifications.info(game.i18n.localize("STICKYNOTES.Deleted"));
    return refreshMarkers();
  }

  if ( scope === "shared" ) {
    if ( shared && !mayEditShared(shared) ) {
      return ui.notifications.warn(game.i18n.format("STICKYNOTES.LockedShared",
        { name: shared.authorName ?? "someone" }));
    }
    const payload = normalise({ ...result.data, author: shared?.author, authorName: shared?.authorName });
    const r = await writeShared(doc, payload);
    if ( !r.ok ) return ui.notifications.warn(r.reason);
    if ( priv ) await deletePrivate(doc);                   // promoted from private to party
    ui.notifications.info(game.i18n.localize("STICKYNOTES.SharedSaved"));
  } else {
    await savePrivate(doc, result.data);
    if ( startScope === "shared" && shared ) {              // demoted from party to private
      const r = await writeShared(doc, null);
      if ( !r.ok ) ui.notifications.warn(r.reason);
    }
    ui.notifications.info(game.i18n.localize("STICKYNOTES.Saved"));
  }
  await syncPinAppearance(doc);
  refreshMarkers();
}

/* -------------------------------------------- */
/*  HUD button                                   */
/* -------------------------------------------- */

function addHudButton(hud, element) {
  if ( !game.settings.get(MOD, "enabled") ) return;
  const doc = hud.document;
  if ( !doc ) return;

  const col = element.querySelector(".col.left");
  if ( !col || col.querySelector(".sn-hud-button") ) return;

  const shared = sharedFor(doc);
  const priv = privateFor(doc);
  const has = !!(shared || priv);
  const label = game.i18n.localize(has ? "STICKYNOTES.Edit" : "STICKYNOTES.Add");

  const btn = document.createElement("button");
  btn.type = "button";
  // deliberately NOT data-action: that dispatches through the HUD's own action map and would throw
  btn.className = `control-icon sn-hud-button${has ? " sn-has-note" : ""}${shared ? " sn-has-shared" : ""}`;
  btn.setAttribute("data-tooltip", label);
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<i class="fa-solid ${shared ? "fa-users" : "fa-note-sticky"}" inert></i>`;
  btn.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); openEditor(doc); });
  col.appendChild(btn);
}

/* -------------------------------------------- */
/*  Hover display                                */
/* -------------------------------------------- */

let hoverEl = null, hoverTimer = null, hoverTarget = null;

function ensureHoverEl() {
  if ( hoverEl?.isConnected ) return hoverEl;
  hoverEl = document.createElement("div");
  hoverEl.className = "sn-stack sn-hidden";
  document.body.appendChild(hoverEl);
  return hoverEl;
}

function anchorFor(p) {
  const t = canvas.stage.worldTransform;
  const b = p.bounds ?? { x: p.x, y: p.y, width: 0, height: 0 };
  return { x: (b.x + b.width / 2) * t.a + t.tx, y: b.y * t.d + t.ty, h: b.height * t.d };
}

function positionHover(p) {
  if ( !hoverEl || !p ) return;
  const a = anchorFor(p);
  const r = hoverEl.getBoundingClientRect();
  let left = Math.max(8, Math.min(window.innerWidth - r.width - 8, a.x - r.width / 2));
  let top = a.y - r.height - 12;
  if ( top < 8 ) top = a.y + a.h + 12;
  hoverEl.style.left = `${Math.round(left)}px`;
  hoverEl.style.top = `${Math.round(top)}px`;
}

function noteMarkup(note, p, isShared) {
  const title = note.name || p.document?.name || "";
  const by = isShared ? `<div class="sn-note-by"><i class="fa-solid fa-users"></i> ${esc(note.authorName ?? "")}</div>` : "";
  return `
    <div class="sn-note${isShared ? " sn-note-shared" : ""}" style="--sn-c:${COLORS[note.color] ?? COLORS.yellow}">
      ${title ? `<div class="sn-note-title">${esc(title)}</div>` : ""}
      ${note.info ? `<div class="sn-note-body">${esc(note.info).replaceAll("\n", "<br>")}</div>` : ""}
      ${by}
    </div>`;
}

function showHover(p, shared, priv) {
  const el = ensureHoverEl();
  const label = p.document?.name || p.document?.text ||
                (p.document?.documentName === "Region" ? game.i18n.localize("STICKYNOTES.RegionName") : "");
  const named = { document: { name: label } };
  el.innerHTML = (shared ? noteMarkup(shared, named, true) : "") + (priv ? noteMarkup(priv, named, false) : "");
  el.classList.remove("sn-hidden");
  hoverTarget = p;
  positionHover(p);
}

function hideHover() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  hoverTarget = null;
  hoverEl?.classList.add("sn-hidden");
}

let lastHovered = null;

function onHover(p, hovered) {
  lastHovered = hovered ? p : (lastHovered === p ? null : lastHovered);
  if ( !game.settings.get(MOD, "enabled") ) return;
  clearTimeout(hoverTimer);
  if ( !hovered ) return hideHover();

  const shared = sharedFor(p.document);
  const priv = privateFor(p.document);
  if ( !shared && !priv ) return hideHover();

  hoverTimer = setTimeout(() => showHover(p, shared, priv), game.settings.get(MOD, "hoverDelay") ?? 250);
}


/* -------------------------------------------- */
/*  Map pins — notes placed on open ground       */
/* -------------------------------------------- */
/* The scene background isn't a placeable, so there's nothing to right-click. Pins are our own
 * lightweight markers stored at scene coordinates: private ones in User flags, shared ones in
 * Scene flags (written via the same GM query relay, since players can't update a Scene).       */

const pinKey = sceneId => sceneId.replaceAll(".", "_");

const allPrivatePins = () => game.user.getFlag(MOD, PINS) ?? {};
const privatePins = sceneId => allPrivatePins()[pinKey(sceneId)] ?? {};
const sharedPins = scene => scene?.getFlag?.(MOD, PINS) ?? {};

async function savePrivatePin(sceneId, pinId, pin) {
  await game.user.setFlag(MOD, PINS, { [pinKey(sceneId)]: { [pinId]: pin } });
}
async function deletePrivatePin(sceneId, pinId) {
  await game.user.update({ [`flags.${MOD}.${PINS}.${pinKey(sceneId)}.-=${pinId}`]: null });
}

async function applySharedPin(scene, pinId, pin) {
  if ( pin === null ) await scene.update({ [`flags.${MOD}.${PINS}.-=${pinId}`]: null });
  else await scene.setFlag(MOD, PINS, { [pinId]: pin });
}

/** Write a shared pin directly if allowed, otherwise ask the active GM. */
async function writeSharedPin(scene, pinId, pin) {
  if ( scene.canUserModify(game.user, "update") ) {
    await applySharedPin(scene, pinId, pin);
    return { ok: true };
  }
  const gm = game.users.activeGM;
  if ( !gm ) return { ok: false, reason: game.i18n.localize("STICKYNOTES.NoGM") };
  try {
    const res = await gm.query(QUERY, { kind: "pin", sceneId: scene.id, pinId, pin },
                               { timeout: QUERY_TIMEOUT });
    return res?.ok ? { ok: true } : { ok: false, reason: res?.reason ?? game.i18n.localize("STICKYNOTES.Refused") };
  } catch (err) {
    console.error(`${MOD} | shared-pin query failed`, err);
    return { ok: false, reason: err.message ?? game.i18n.localize("STICKYNOTES.Refused") };
  }
}

/** Screen pixels -> scene coordinates. Inverse of the transform the markers use. */
function screenToWorld(ev) {
  const view = canvas.app?.view;
  const rect = view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  const t = canvas.stage.worldTransform;
  return {
    x: (ev.clientX - rect.left - t.tx) / t.a,
    y: (ev.clientY - rect.top - t.ty) / t.d
  };
}

/* ---- placement ---- */

let placing = false;

function armPlacement() {
  if ( placing ) return cancelPlacement();
  placing = true;
  document.body.classList.add("sn-placing");
  ui.notifications.info(game.i18n.localize("STICKYNOTES.PlaceHint"));
  window.addEventListener("pointerdown", onPlacementClick, { capture: true });
  window.addEventListener("keydown", onPlacementKey, { capture: true });
}

function cancelPlacement() {
  placing = false;
  document.body.classList.remove("sn-placing");
  window.removeEventListener("pointerdown", onPlacementClick, { capture: true });
  window.removeEventListener("keydown", onPlacementKey, { capture: true });
}

function onPlacementKey(ev) {
  if ( ev.key === "Escape" ) { ev.preventDefault(); ev.stopPropagation(); cancelPlacement(); }
}

async function onPlacementClick(ev) {
  if ( !placing ) return;
  // only place on the canvas itself, so clicking the toolbar or a window doesn't drop a pin
  if ( !ev.target.closest?.("#board") ) return;
  if ( ev.button !== 0 ) { cancelPlacement(); return; }
  ev.preventDefault();
  ev.stopPropagation();
  const { x, y } = screenToWorld(ev);
  cancelPlacement();
  await placePinDrawing(x, y);
}

/* ---- pin editor ---- */

function findPin(pinId) {
  const scene = canvas.scene;
  if ( !scene ) return null;
  const shared = sharedPins(scene)[pinId];
  if ( shared ) return { pin: shared, scope: "shared" };
  const priv = privatePins(scene.id)[pinId];
  if ( priv ) return { pin: priv, scope: "private" };
  return null;
}

async function openPinEditor(pinId, at) {
  const scene = canvas.scene;
  if ( !scene ) return;

  const found = pinId ? findPin(pinId) : null;
  const existing = found?.pin ?? null;
  const startScope = found?.scope ?? "private";
  const locked = (found?.scope === "shared" && !mayEditShared(existing)) ? existing : null;
  const pseudoDoc = { name: game.i18n.localize("STICKYNOTES.MapPin"), documentName: "Pin" };

  const buttons = [
    { action: "save", label: game.i18n.localize("STICKYNOTES.Save"), icon: "fa-solid fa-floppy-disk",
      default: true,
      callback: (e, button, dialog) => ({ op: "save", data: readForm(button.form ?? dialog.element) }) },
    { action: "cancel", label: game.i18n.localize("STICKYNOTES.Cancel"), icon: "fa-solid fa-xmark",
      callback: () => ({ op: "cancel" }) }
  ];
  if ( existing ) buttons.splice(1, 0, {
    action: "delete", label: game.i18n.localize("STICKYNOTES.Delete"), icon: "fa-solid fa-trash",
    callback: () => ({ op: "delete" })
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: `${game.i18n.localize("STICKYNOTES.Title")} — ${game.i18n.localize("STICKYNOTES.MapPin")}`,
              icon: "fa-solid fa-map-pin" },
    position: { width: 440 },
    classes: ["sticky-notes-editor"],
    content: editorContent(pseudoDoc, existing, startScope, locked),
    buttons,
    rejectClose: false
  }).catch(() => null);

  if ( !result || result.op === "cancel" ) return;

  const id = pinId ?? foundry.utils.randomID();
  const pos = existing ? { x: existing.x, y: existing.y } : at;

  if ( result.op === "delete" ) {
    if ( startScope === "shared" ) {
      const r = await writeSharedPin(scene, id, null);
      if ( !r.ok ) return ui.notifications.warn(r.reason);
    } else await deletePrivatePin(scene.id, id);
    ui.notifications.info(game.i18n.localize("STICKYNOTES.Deleted"));
    return refreshMarkers();
  }

  const { name, info, scope } = result.data;
  if ( !name && !info ) {
    if ( existing ) {
      if ( startScope === "shared" ) await writeSharedPin(scene, id, null);
      else await deletePrivatePin(scene.id, id);
      ui.notifications.info(game.i18n.localize("STICKYNOTES.Deleted"));
    }
    return refreshMarkers();
  }

  const payload = { ...normalise({ ...result.data, author: existing?.author, authorName: existing?.authorName }), ...pos };

  if ( scope === "shared" ) {
    if ( existing && startScope === "shared" && !mayEditShared(existing) ) {
      return ui.notifications.warn(game.i18n.format("STICKYNOTES.LockedShared",
        { name: existing.authorName ?? "someone" }));
    }
    const r = await writeSharedPin(scene, id, payload);
    if ( !r.ok ) return ui.notifications.warn(r.reason);
    if ( startScope === "private" && existing ) await deletePrivatePin(scene.id, id);
    ui.notifications.info(game.i18n.localize("STICKYNOTES.SharedSaved"));
  } else {
    await savePrivatePin(scene.id, id, payload);
    if ( startScope === "shared" && existing ) {
      const r = await writeSharedPin(scene, id, null);
      if ( !r.ok ) ui.notifications.warn(r.reason);
    }
    ui.notifications.info(game.i18n.localize("STICKYNOTES.Saved"));
  }
  refreshMarkers();
}

/** Every pin on the current scene, shared first. */
function currentPins() {
  const scene = canvas?.scene;
  if ( !scene ) return [];
  const out = [];
  for ( const [id, pin] of Object.entries(sharedPins(scene)) ) out.push([id, pin, true]);
  for ( const [id, pin] of Object.entries(privatePins(scene.id)) ) out.push([id, pin, false]);
  return out;
}



/* -------------------------------------------- */
/*  Sticky pins, built on Drawings               */
/* -------------------------------------------- */
/* Foundry has no way to register a new *kind* of Drawing — only documents with a `type` field
 * (Actor, Item, RegionBehavior…) accept module sub-types. So a "pin drawing" is a normal Drawing
 * that we create pre-shaped and flagged as ours. It behaves natively in every way that matters:
 * it has a HUD, it moves, resizes, locks, layers and deletes like any drawing, and DRAWING_CREATE
 * defaults to TRUSTED so players can make their own without a GM relay.                        */

const isPin = doc => !!doc?.getFlag?.(MOD, "pin");

function pinDrawingData(x, y, note) {
  const size = canvas.grid?.size ?? 100;
  const hex = COLORS[note?.color] ?? COLORS.yellow;
  return {
    author: game.user.id,
    x: Math.round(x - size / 2),
    y: Math.round(y - size / 2),
    shape: { type: "r", width: size, height: size },
    fillType: 1,
    fillColor: hex,
    fillAlpha: 0.45,
    strokeColor: "#1b1b1b",
    strokeWidth: 2,
    strokeAlpha: 0.9,
    text: note?.name ?? "",
    fontSize: Math.max(16, Math.round(size / 4)),
    textColor: "#f8f6f2",
    flags: { [MOD]: { pin: true } }
  };
}

/** Keep the drawing looking like its note: colour of the swatch, label of the name. */
async function syncPinAppearance(doc) {
  if ( !isPin(doc) ) return;
  const note = sharedFor(doc) ?? privateFor(doc);
  if ( !note ) return;
  const hex = COLORS[note.color] ?? COLORS.yellow;
  const patch = {};
  if ( doc.fillColor !== hex ) patch.fillColor = hex;
  if ( (doc.text ?? "") !== (note.name ?? "") ) patch.text = note.name ?? "";
  if ( !Object.keys(patch).length ) return;
  if ( doc.canUserModify(game.user, "update") ) await doc.update(patch);
}

async function placePinDrawing(x, y) {
  const scene = canvas.scene;
  if ( !scene ) return;
  if ( !game.user.can("DRAWING_CREATE") ) {
    return ui.notifications.warn(game.i18n.localize("STICKYNOTES.NoDrawingPerm"));
  }
  const [doc] = await scene.createEmbeddedDocuments("Drawing", [pinDrawingData(x, y, null)]);
  if ( !doc ) return;
  await openEditor(doc);
  await syncPinAppearance(doc);
  refreshMarkers();
}

/* -------------------------------------------- */
/*  Regions                                      */
/* -------------------------------------------- */
/* Regions are documents, so they take exactly the same flag-based note as tokens and tiles and
 * reuse the same editor. (An earlier attempt registered a custom RegionBehaviorType instead —
 * that needs a `documentTypes` declaration in the manifest to appear in the Behaviours list, and
 * it buried a one-field note three clicks deep. Not worth it.)
 *
 * Regions have no HUD, so instead of right-click we draw our own small button at the centre of
 * every region on the Regions layer.                                                          */

/** Where the region's note button sits: inset from the bottom-left corner of its bounds. */
function regionAnchor(region) {
  const t = canvas.stage.worldTransform;
  const b = region.bounds;
  if ( !b ) return null;
  const inset = 20;   // screen px, so it stays put as you zoom
  return {
    x: b.x * t.a + t.tx + inset,
    y: (b.y + b.height) * t.d + t.ty - inset,
    cx: (b.x + b.width / 2) * t.a + t.tx,
    top: b.y * t.d + t.ty
  };
}

/** Which region is currently showing its note button, mirroring how a token HUD is summoned. */
let activeRegionId = null;

function setActiveRegion(id) {
  if ( activeRegionId === id ) return;
  activeRegionId = id;
  refreshMarkers();
}

/** Right-click a region to summon its button; left-click anywhere to dismiss it. */
function installRegionClickHandlers() {
  const board = document.getElementById("board");
  if ( !board || board.dataset.snBound ) return;
  board.dataset.snBound = "1";

  board.addEventListener("pointerdown", ev => {
    if ( !game.settings.get(MOD, "enabled") ) return;
    if ( !canvas.regions?.active ) return;
    if ( ev.button === 2 ) {
      const region = (lastHovered?.document?.documentName === "Region") ? lastHovered : null;
      setActiveRegion(region ? region.id : null);
    } else if ( ev.button === 0 ) {
      setActiveRegion(null);
    }
  }, { capture: true });
}

function onHoverRegion(region, hovered) {
  lastHovered = hovered ? region : (lastHovered === region ? null : lastHovered);
  if ( !game.settings.get(MOD, "enabled") ) return;
  if ( game.settings.get(MOD, "anyLayerHover") ) return;   // our own hit-testing drives it instead
  clearTimeout(hoverTimer);
  if ( !hovered ) return hideHover();

  const shared = sharedFor(region.document);
  const priv = privateFor(region.document);
  if ( !shared && !priv ) return hideHover();

  hoverTimer = setTimeout(() => {
    const box = ensureHoverEl();
    const fake = { document: { name: region.document.name || game.i18n.localize("STICKYNOTES.RegionName") } };
    box.innerHTML = (shared ? noteMarkup(shared, fake, true) : "") + (priv ? noteMarkup(priv, fake, false) : "");
    box.classList.remove("sn-hidden");
    hoverTarget = null;
    const a = regionAnchor(region);
    if ( !a ) return;
    const r = box.getBoundingClientRect();
    box.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - r.width - 8, a.cx - r.width / 2)))}px`;
    box.style.top = `${Math.round(Math.max(8, a.top - r.height - 12))}px`;
  }, game.settings.get(MOD, "hoverDelay") ?? 250);
}


/* -------------------------------------------- */
/*  Layer-independent hover                      */
/* -------------------------------------------- */
/* Foundry only fires hoverToken / hoverDrawing / hoverTile / hoverRegion while that object's own
 * layer is active, so notes would vanish the moment you switched tools. Instead we track raw
 * pointer movement over the board and hit-test every layer ourselves, which makes notes readable
 * no matter which tool is selected. Only placeable bounds are compared, and the work is throttled
 * to one animation frame, so it stays cheap.                                                    */

const HIT_LAYERS = () => [canvas.tokens, canvas.drawings, canvas.tiles, canvas.regions];

function boundsOf(p) {
  const b = p?.bounds;
  if ( b && Number.isFinite(b.x) ) return b;
  if ( Number.isFinite(p?.x) ) return { x: p.x, y: p.y, width: p.width ?? 0, height: p.height ?? 0 };
  return null;
}

/** Smallest placeable whose bounds contain the point — smallest so a token inside a big region wins. */
function hitTest(world, { notedOnly = false } = {}) {
  let best = null, bestArea = Infinity;
  for ( const layer of HIT_LAYERS() ) {
    for ( const p of layer?.placeables ?? [] ) {
      const doc = p.document;
      if ( !doc ) continue;
      if ( notedOnly && !sharedFor(doc) && !privateFor(doc) ) continue;
      const b = boundsOf(p);
      if ( !b ) continue;
      if ( world.x < b.x || world.x > b.x + b.width ) continue;
      if ( world.y < b.y || world.y > b.y + b.height ) continue;
      const area = Math.max(1, b.width * b.height);
      if ( area < bestArea ) { best = p; bestArea = area; }
    }
  }
  return best;
}

let pointerRaf = null;
let lastPointer = null;

function onBoardPointerMove(ev) {
  lastPointer = ev;
  if ( pointerRaf ) return;
  pointerRaf = requestAnimationFrame(() => {
    pointerRaf = null;
    if ( !lastPointer || !canvas?.ready ) return;
    if ( !game.settings.get(MOD, "enabled") ) return;

    const world = screenToWorld(lastPointer);
    lastHovered = hitTest(world) ?? null;          // so the N keybinding works on any layer too

    if ( !game.settings.get(MOD, "anyLayerHover") ) return;

    const target = hitTest(world, { notedOnly: true });
    if ( !target ) return hideHover();
    if ( hoverTarget === target && !hoverEl?.classList.contains("sn-hidden") ) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      const doc = target.document;
      const shared = sharedFor(doc), priv = privateFor(doc);
      if ( !shared && !priv ) return hideHover();
      showHover(target, shared, priv);
    }, game.settings.get(MOD, "hoverDelay") ?? 250);
  });
}

function installPointerTracking() {
  const board = document.getElementById("board");
  if ( !board || board.dataset.snHover ) return;
  board.dataset.snHover = "1";
  board.addEventListener("pointermove", onBoardPointerMove, { passive: true });
  board.addEventListener("pointerleave", () => { lastPointer = null; hideHover(); }, { passive: true });
}

/* -------------------------------------------- */
/*  Corner markers                               */
/* -------------------------------------------- */

let markerLayer = null;

function ensureMarkerLayer() {
  if ( markerLayer?.isConnected ) return markerLayer;
  markerLayer = document.createElement("div");
  markerLayer.className = "sn-marker-layer";
  document.body.appendChild(markerLayer);
  return markerLayer;
}

/**
 * Move the overlay elements without rebuilding them.
 * Each element created by refreshMarkers() carries a _snPos closure that recomputes its screen
 * position from the live placeable, so panning, zooming and dragging are a cheap transform update
 * rather than a full teardown. Only structural changes (a note added, a placeable created or
 * deleted, the layer changing) need refreshMarkers().
 */
function repositionAll() {
  if ( !markerLayer?.isConnected || !canvas?.ready ) return;
  for ( const el of markerLayer.children ) {
    const pos = el._snPos?.();
    if ( !pos ) { el.style.display = "none"; continue; }
    el.style.display = "";
    el.style.left = `${Math.round(pos.x)}px`;
    el.style.top = `${Math.round(pos.y)}px`;
  }
}

/** A region being dragged or reshaped is represented by a preview clone; follow that instead. */
function livePlaceable(placeable) {
  const preview = placeable?.layer?.preview?.children?.find?.(c => c.id === placeable.id);
  return preview ?? placeable;
}

function refreshMarkers() {
  const layer = ensureMarkerLayer();
  layer.replaceChildren();
  if ( !canvas?.ready ) return;
  if ( !game.settings.get(MOD, "enabled") || !game.settings.get(MOD, "showMarkers") ) return;

  const t = canvas.stage.worldTransform;
  for ( const lyr of [canvas.tokens, canvas.tiles, canvas.drawings] ) {
    for ( const p of lyr?.placeables ?? [] ) {
      const shared = sharedFor(p.document);
      const priv = privateFor(p.document);
      if ( !shared && !priv ) continue;
      const note = shared ?? priv;
      if ( isPin(p.document) ) continue;   // the drawing itself is the marker
      const b = p.bounds ?? { x: p.x, y: p.y, width: 0, height: 0 };
      const dot = document.createElement("div");
      dot.className = `sn-marker${shared ? " sn-marker-shared" : ""}`;
      dot.style.setProperty("--sn-c", COLORS[note.color] ?? COLORS.yellow);
      dot._snPos = () => {
        const live = livePlaceable(p);
        const bb = live.bounds ?? b;
        const tt = canvas.stage.worldTransform;
        if ( live.destroyed ) return null;
        return { x: (bb.x + bb.width) * tt.a + tt.tx - 9, y: bb.y * tt.d + tt.ty - 1 };
      };
      layer.appendChild(dot);
    }
  }

  // Regions get their own button, since they have no HUD to hang one off. Only while the Regions
  // layer is active, which is also the only time the regions themselves are visible.
  const regionsActive = !!canvas.regions?.active;
  const alwaysShow = game.settings.get(MOD, "regionButtons");
  for ( const region of (regionsActive ? canvas.regions?.placeables ?? [] : []) ) {
    const shared = sharedFor(region.document);
    const priv = privateFor(region.document);
    const note = shared ?? priv;
    // summoned by right-click; or always, if the player prefers that
    if ( !alwaysShow && region.id !== activeRegionId ) continue;
    const c = regionAnchor(region);
    if ( !c ) continue;
    const el = document.createElement("div");
    el.className = `sn-region-btn${note ? " sn-has-note" : " sn-empty"}${shared ? " sn-shared" : ""}`;
    el.style.setProperty("--sn-c", COLORS[note?.color] ?? COLORS.yellow);
    el._snPos = () => {
      const live = livePlaceable(region);
      if ( live.destroyed ) return null;
      const a = regionAnchor(live);
      return a ? { x: a.x, y: a.y } : null;
    };
    el.title = game.i18n.localize(note ? "STICKYNOTES.Edit" : "STICKYNOTES.Add");
    el.innerHTML = `<i class="fa-solid fa-note-sticky"></i>`;
    el.addEventListener("click", ev => {
      ev.preventDefault(); ev.stopPropagation(); hideHover(); openEditor(region.document);
    });
    layer.appendChild(el);
  }

  // free-placed map pins
  for ( const [id, pin, isShared] of currentPins() ) {
    const el = document.createElement("div");
    el.className = `sn-pin${isShared ? " sn-pin-shared" : ""}`;
    el.style.setProperty("--sn-c", COLORS[pin.color] ?? COLORS.yellow);
    el._snPos = () => {
      const tt = canvas.stage.worldTransform;
      return { x: pin.x * tt.a + tt.tx, y: pin.y * tt.d + tt.ty };
    };
    el.innerHTML = `<i class="fa-solid fa-map-pin"></i>`;
    el.addEventListener("pointerenter", () => showPinHover(el, pin, isShared));
    el.addEventListener("pointerleave", hideHover);
    el.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); hideHover(); openPinEditor(id); });
    layer.appendChild(el);
  }

  repositionAll();
}

/** Pins are HTML, so they anchor to their own element rather than a canvas placeable. */
function showPinHover(el, pin, isShared) {
  const box = ensureHoverEl();
  box.innerHTML = noteMarkup(pin, { document: { name: game.i18n.localize("STICKYNOTES.MapPin") } }, isShared);
  box.classList.remove("sn-hidden");
  hoverTarget = null;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  box.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - b.width - 8, r.left + r.width / 2 - b.width / 2)))}px`;
  box.style.top = `${Math.round(r.top - b.height - 10)}px`;
}

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  // Every client registers the handler; only the designated active GM is ever asked.
  CONFIG.queries[QUERY] = handleSharedQuery;

  // The scene-control tool is easy to miss, so give both actions a key as well.
  game.keybindings.register(MOD, "noteHovered", {
    name: "STICKYNOTES.KeyNoteName",
    hint: "STICKYNOTES.KeyNoteHint",
    editable: [{ key: "KeyN" }],
    onDown: () => {
      if ( !game.settings.get(MOD, "enabled") ) return false;
      const target = lastHovered ?? canvas?.tokens?.controlled?.[0];
      if ( !target?.document ) return false;
      hideHover();
      openEditor(target.document);
      return true;
    }
  });
  game.keybindings.register(MOD, "placePin", {
    name: "STICKYNOTES.KeyPinName",
    hint: "STICKYNOTES.KeyPinHint",
    editable: [{ key: "KeyN", modifiers: ["Shift"] }],
    onDown: () => {
      if ( !game.settings.get(MOD, "enabled") ) return false;
      armPlacement();
      return true;
    }
  });

  game.settings.register(MOD, "enabled", {
    name: "STICKYNOTES.SettingEnabledName", hint: "STICKYNOTES.SettingEnabledHint",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshMarkers()
  });
  game.settings.register(MOD, "anyLayerHover", {
    name: "STICKYNOTES.SettingAnyLayerName", hint: "STICKYNOTES.SettingAnyLayerHint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => hideHover()
  });
  game.settings.register(MOD, "regionButtons", {
    name: "STICKYNOTES.SettingRegionButtonsName", hint: "STICKYNOTES.SettingRegionButtonsHint",
    scope: "client", config: true, type: Boolean, default: false, onChange: () => refreshMarkers()
  });
  game.settings.register(MOD, "showMarkers", {
    name: "STICKYNOTES.SettingShowMarkersName", hint: "STICKYNOTES.SettingShowMarkersHint",
    scope: "client", config: true, type: Boolean, default: true, onChange: () => refreshMarkers()
  });
  game.settings.register(MOD, "hoverDelay", {
    name: "STICKYNOTES.SettingHoverDelayName", hint: "STICKYNOTES.SettingHoverDelayHint",
    scope: "client", config: true, type: Number, default: 250,
    range: { min: 0, max: 2000, step: 50 }
  });
});

Hooks.on("getSceneControlButtons", controls => {
  if ( !game.settings.get(MOD, "enabled") ) return;
  // V14 controls are an object keyed by group name, each with a `tools` object.
  const group = controls.drawings ?? controls.notes ?? controls.tokens;
  if ( !group?.tools ) return;
  group.tools["sticky-note-pin"] = {
    name: "sticky-note-pin",
    order: Object.keys(group.tools).length + 1,
    title: "STICKYNOTES.PlacePin",
    icon: "fa-solid fa-note-sticky",
    button: true,
    visible: game.user.can("DRAWING_CREATE"),
    onChange: () => armPlacement()
  };
});

Hooks.on("renderTokenHUD", (hud, element) => addHudButton(hud, element));
Hooks.on("renderTileHUD",  (hud, element) => addHudButton(hud, element));
Hooks.on("renderDrawingHUD", (hud, element) => addHudButton(hud, element));
Hooks.on("hoverToken", onHover);
Hooks.on("hoverTile",  onHover);
Hooks.on("hoverDrawing", onHover);
Hooks.on("hoverRegion", onHoverRegion);

Hooks.on("canvasPan", () => { if ( hoverTarget ) positionHover(hoverTarget); repositionAll(); });

// Placeables emit refresh<DocumentName> continuously while they are dragged or reshaped, so the
// overlay can track them live instead of snapping into place only once the change is committed.
for ( const h of ["refreshRegion", "refreshToken", "refreshTile", "refreshDrawing"] ) {
  Hooks.on(h, () => {
    if ( hoverTarget ) positionHover(hoverTarget);
    repositionAll();
  });
}
Hooks.on("canvasReady", () => { hideHover(); activeRegionId = null; installRegionClickHandlers(); installPointerTracking(); refreshMarkers(); });
Hooks.on("activateCanvasLayer", () => { hideHover(); activeRegionId = null; refreshMarkers(); });
Hooks.on("canvasTearDown", hideHover);

// a shared note changing on another client must update this one live
for ( const h of ["updateToken", "updateTile", "deleteToken", "deleteTile",
                  "createDrawing", "updateDrawing", "deleteDrawing"] ) {
  Hooks.on(h, () => { if ( hoverTarget?.destroyed ) hideHover(); refreshMarkers(); });
}
Hooks.on("updateUser", user => { if ( user.id === game.user.id ) refreshMarkers(); });
Hooks.on("updateScene", scene => { if ( scene.id === canvas?.scene?.id ) refreshMarkers(); });
for ( const h of ["createRegion", "updateRegion", "deleteRegion",
                  "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior"] ) {
  Hooks.on(h, () => refreshMarkers());
}

Hooks.once("ready", () => {
  installRegionClickHandlers();
  installPointerTracking();
  refreshMarkers();
  console.log(`${MOD} | ready — right-click a token or tile; notes can be private or shared with the party`);
});

globalThis.StickyNotes = {
  private: doc => privateFor(doc),
  shared: doc => sharedFor(doc),
  pins: () => currentPins(),
  placePin: () => armPlacement(),
  all: allPrivate,
  open: openEditor,
  refresh: refreshMarkers
};
