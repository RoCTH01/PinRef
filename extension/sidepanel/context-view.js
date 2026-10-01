(function () {
  "use strict";
  const { escape: e, image, imageStrip, showImage, command, createNotes, createNames, assignmentCommand } = PinRefUI;

  // This Pin mirrors the Dashboard Inspector's markup and classes (ADR-0013) within its Pinterest restrictions.
  window.createContextView = ({ getState, changed, feedback }) => {
    const notes = createNotes({ getState, changed });
    const names = createNames({ getState, changed, feedback });
    let picker = false;
    let query = "";
    let rename = null;
    let previousPin = null;

    async function act(c) {
      const result = await command(c);
      feedback(result.ok ? "Saved locally" : `Could not save: ${result.reason}. Your committed data is unchanged.`);
      await changed(true);
      return result;
    }

    function focusSoon(selector) {
      setTimeout(() => document.querySelector(selector)?.focus(), 0);
    }

    function emptyHtml(context) {
      const unavailable = context?.identityUnavailable;
      return `<section class="inspector-empty sidepanel-empty"><span class="inspector-empty-icon">◇</span>`
        + `<strong>${unavailable ? "Identity unavailable" : "No Context Pin yet"}</strong>`
        + `<p>${unavailable
          ? "This Save could not be bound to one Pin. Nothing was added. Open the Pin detail page before trying again."
          : "Open an individual Pin, or use Pinterest’s native Save on a Pin here. Hovering does not select a Pin."}</p></section>`
        + `<p class="muted">To scan existing saves, open Saved Pins or a specific Board.</p>`;
    }

    function attemptHtml(attempt) {
      const title = attempt.status === "pending" ? "Waiting for Pinterest…"
        : attempt.status === "confirmed" ? "Pinterest Save confirmed · local save needs retry"
        : attempt.status === "in-trash" ? "This Reference is in Trash"
        : "Save not confirmed";
      const body = attempt.status === "confirmed"
        ? "Retry only the local save. You do not need to save on Pinterest again."
        : "A click alone does not add a Reference. Your Library is unchanged until Save is confirmed.";
      const action = attempt.status === "confirmed"
        ? `<button class="quiet-button" data-capture-retry="${e(attempt.attemptId)}">Retry local save</button>`
        : attempt.status !== "in-trash" ? `<button class="quiet-button" data-capture-check="${e(attempt.attemptId)}">Check again</button>` : "";
      return `<div class="notice"><strong>${title}</strong><p>${body}</p><div class="editor-recovery">${action}`
        + `<a class="open-source-button" href="../dashboard/index.html?view=attention" target="_blank" rel="noopener">Manage in Needs Attention ↗</a></div></div>`;
    }

    function absentHtml(s, trash) {
      const status = s.context?.status;
      const explanation = trash ? "This Pin is in Trash. Restore it from Dashboard; Capture and Import will not restore it silently."
        : status === "saved" ? "Already saved on Pinterest. Open Saved Pins or its Board to import it; PinRef does not guess its Board."
        : status === "not-saved" ? "Not saved on Pinterest. Use Pinterest’s own Save button; PinRef adds a Reference only after confirmed Save."
        : "Pinterest Save status is unknown. Keep the Pin open and check again; no Reference is added automatically.";
      return `<p class="muted">${explanation}</p>`
        + (trash
          ? `<a class="open-source-button" href="../dashboard/index.html" target="_blank" rel="noopener">Manage in Dashboard ↗</a>`
          : `<div class="editor-recovery"><button class="quiet-button" data-context-refresh>Check current Pin</button></div>`);
    }

    function tagsHtml(s, record) {
      const chips = record.tags.map((id) => {
        const name = e(s.tags[id]?.name);
        return `<span class="editable-tag"><button class="tag-name" data-context-rename="${e(id)}" aria-label="Globally rename ${name}">${name}</button>`
          + `<button data-context-remove="${e(id)}" aria-label="Remove ${name} from this Pin">×</button></span>`;
      }).join("");
      return `<section class="detail-section"><h3>Tags</h3><div class="editable-tag-row">${chips}`
        + `<button class="add-tag-round" data-context-picker aria-label="Add Tag">+</button></div></section>`;
    }

    function pickerHtml(s, pin, record) {
      if (!picker || !record) return "";
      const options = s.tagOrder.map((id) => s.tags[id])
        .filter((tag) => tag && tag.name.toLowerCase().includes(query.toLowerCase()))
        .map((tag) => {
          const applied = record.tags.includes(tag.tagId);
          return `<button class="tag-option" data-context-assign="${e(tag.tagId)}" ${applied ? "disabled" : ""}><i style="--item-color:${e(tag.color)}"></i>`
            + `<span>${e(tag.name)}</span><small>${applied ? "Applied" : "Add"}</small></button>`;
        }).join("");
      const create = query.trim() ? `<button class="quiet-button" data-context-create>Create “${e(query.trim())}” & assign</button>` : "";
      return `<button class="tag-picker-scrim" data-context-close-picker aria-label="Close Tag picker"></button>`
        + `<section class="tag-picker toolbar-popover" role="dialog" aria-label="Add Tags">`
        + `<header class="tag-picker-head"><strong>Add Tags · ${e(record ? PinRefUI.referenceName(record) : `Pin ${pin}`)}</strong><button class="icon-button" data-context-close-picker aria-label="Close Tag picker">×</button></header>`
        + `<input data-context-query data-focus="context-tag-query" aria-label="Find or create Tag" placeholder="Find or create Tag" value="${e(query)}">`
        + `<div class="tag-picker-list">${options}</div>${create}`
        + `<footer class="tag-picker-footer"><button class="quiet-button" data-context-close-picker>Done</button></footer></section>`;
    }

    function renameHtml(s) {
      const tag = rename && s.tags[rename.id];
      if (!tag) return "";
      const affected = [...Object.values(s.references), ...Object.values(s.trash || {})].filter((r) => r.tags.includes(rename.id)).length;
      const merge = rename.target
        ? `<p>“${e(s.tags[rename.target]?.name)}” already exists. Merge keeps that Tag and combines assignments.</p>`
          + `<a class="open-source-button" href="../dashboard/index.html?merge=${encodeURIComponent(rename.id)}&target=${encodeURIComponent(rename.target)}" target="_blank" rel="noopener">Preview Merge in Dashboard ↗</a>`
        : "";
      return `<button class="tag-picker-scrim" data-context-close-rename aria-label="Close Tag editor"></button>`
        + `<section class="tag-editor-panel" role="dialog" aria-label="Manage Tag">`
        + `<header><strong>Global Tag editor</strong><button class="icon-button" data-context-close-rename aria-label="Close Tag editor">×</button></header>`
        + `<p>Affects ${affected} References, including Trash.</p>`
        + `<label>Name <input data-context-name data-focus="context-rename" value="${e(rename.name)}" maxlength="80"></label>`
        + `<small role="status">${e(rename.status || "Changes save automatically")}</small>${merge}</section>`;
    }

    function referenceHtml(pin, record) {
      return `${notes.html(pin)}<dl class="detail-grid"><dt>Added to PinRef</dt><dd>${e(new Date(record.addedToPinRefAt).toLocaleString())}</dd></dl>`
        + `<a class="open-source-button" href="https://www.pinterest.com/pin/${e(pin)}/" target="_blank" rel="noopener">View on Pinterest ↗</a>`;
    }

    function html() {
      const s = getState();
      const pin = s.context?.pinId;
      if (previousPin && previousPin !== pin) {
        notes.flush();
        names.flush();
        picker = false;
        query = "";
        rename = null;
      }
      previousPin = pin;
      if (!pin) return emptyHtml(s.context);

      const record = s.references[pin];
      const trash = s.trash?.[pin];
      const attempt = Object.values(s.attempts || {})
        .filter((a) => a.pinId === pin)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const status = attempt?.status === "pending" ? "Capture pending"
        : attempt ? "Needs attention"
        : record ? "In PinRef · saved locally"
        : trash ? "In Trash"
        : "Not in PinRef";

      return `<section class="context-card detail-content">`
        + `<section class="selection-overview">${image(record || trash || s.context, "summary-art")}${imageStrip(record || trash || s.context)}`
        + `<div class="selection-overview-copy">${record ? names.html(record) : `<h2>Pin ${e(pin)}</h2>`}<p>${status}</p></div></section>`
        + (attempt ? attemptHtml(attempt) : "")
        + (record ? tagsHtml(s, record) + referenceHtml(pin, record) : absentHtml(s, trash))
        + `</section>${pickerHtml(s, pin, record)}${renameHtml(s)}`;
    }

    async function saveRename() {
      if (!rename) return;
      clearTimeout(rename.timer);
      const tag = getState().tags[rename.id];
      if (!tag || tag.name === rename.name) return;
      const result = await command({ type: "EDIT_TAG", tagId: rename.id, name: rename.name, baseRevision: tag.revision });
      rename.status = result.ok ? "Saved globally"
        : result.reason === "tag-name-exists" ? "Name already exists. Review Merge in Dashboard."
        : "Save failed — edit or retry.";
      rename.target = result.targetTagId;
      changed(true);
    }

    async function closeRename() {
      await saveRename();
      rename = null;
      changed();
    }

    function bind(root) {
      const s = getState();
      const pin = s.context?.pinId;
      const on = (selector, fn, event = "click") => root.querySelectorAll(selector).forEach((el) => el.addEventListener(event, (ev) => fn(el, ev)));
      on("[data-show-image]", (el) => { showImage(el.dataset.imagePin, el.dataset.showImage); changed(); });
      notes.bind(root);
      names.bind(root);

      on("[data-context-refresh]", () => changed(true));
      on("[data-context-picker]", () => {
        picker = true;
        changed();
        focusSoon("[data-context-query]");
      });
      on("[data-context-close-picker]", () => {
        picker = false;
        query = "";
        changed();
        focusSoon("[data-context-picker]");
      });
      on("[data-context-query]", (el) => { query = el.value; changed(); }, "input");
      on("[data-context-query]", (_el, ev) => {
        if (ev.key !== "Escape") return;
        picker = false;
        query = "";
        changed();
        focusSoon("[data-context-picker]");
      }, "keydown");
      on("[data-context-create]", async () => {
        const result = await act(PinRefUI.createTagCommand(s, [pin], query.trim()));
        if (result.ok) { query = ""; changed(); }
      });
      on("[data-context-assign]", (el) => act(assignmentCommand(s, [pin], el.dataset.contextAssign, true)));
      on("[data-context-remove]", (el) => act(assignmentCommand(s, [pin], el.dataset.contextRemove, false)));

      on("[data-context-rename]", (el) => {
        rename = { id: el.dataset.contextRename, name: s.tags[el.dataset.contextRename].name };
        changed();
        focusSoon("[data-context-name]");
      });
      on("[data-context-name]", (el) => {
        rename.name = el.value;
        clearTimeout(rename.timer);
        rename.timer = setTimeout(saveRename, 600);
      }, "input");
      on("[data-context-name]", () => { if (!PinRefUI.isRendering()) saveRename(); }, "blur");
      on("[data-context-name]", (_el, ev) => {
        if (ev.key === "Enter") saveRename();
        if (ev.key === "Escape") closeRename();
      }, "keydown");
      on("[data-context-close-rename]", closeRename);

      on("[data-capture-retry]", (el) => act({ type: "COMMIT_CAPTURE", attemptId: el.dataset.captureRetry }));
      async function evidence(message) {
        try {
          const result = await chrome.runtime.sendMessage(message);
          feedback(result.ok ? "Evidence refreshed" : "Reliable evidence is unavailable. Keep the original Pin open and try again; saved metadata is unchanged.");
        } catch {
          feedback("Unable to refresh. Your saved data is unchanged.");
        }
        changed(true);
      }
      on("[data-capture-check]", (el) => evidence({ type: "pinref:checkCapture", attemptId: el.dataset.captureCheck }));
    }

    return { html, bind, flush: () => Promise.all([notes.flush(), names.flush()]) };
  };
})();
