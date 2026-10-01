let currentTabId = null;
let currentState = null;
const pendingWrites = new Map();
const prototypeVersion = chrome.runtime.getManifest().version;

function showPanelMessage(text, success = false) {
  const message = document.querySelector("#panel-message");
  message.hidden = !text;
  message.classList.toggle("success", Boolean(success));
  message.textContent = text || "";
}

function activeData() {
  const pinId = currentState?.activePinId;
  const attempts = Object.values(currentState?.attempts || {});
  return pinId
    ? {
        pinId,
        record: currentState.records?.[pinId] || null,
        observed: currentState.observations?.[pinId] || null,
        attempt: attempts.filter((item) => item.pinId === pinId).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null
      }
    : { pinId: null, record: null, observed: null, attempt: null };
}

const captureCopy = {
  "saving-on-pinterest": ["Saving on Pinterest", "Waiting for same-Pin completion evidence."],
  "saving-to-pinref": ["Saving to PinRef", "Pinterest was confirmed. The local Reference is not committed yet."],
  "save-not-confirmed": ["Save not confirmed", "PinRef did not receive reliable completion evidence. Nothing was added to the Library."],
  "pinterest-save-failed": ["Pinterest couldn’t save", "Pinterest reported a failure. Nothing was added to PinRef."],
  "pinterest-save-cancelled": ["Pinterest Save cancelled", "The picker was dismissed before a confirmed Save. Nothing was added to PinRef."],
  "local-write-failed": ["Couldn’t save to PinRef", "Pinterest Save was confirmed, but the local write failed. Retry does not require Unsave → Save."]
};

function captureStateElement(attempt) {
  const wrapper = document.createElement("section");
  wrapper.className = `capture-state ${attempt.captureState}`;
  const [title, description] = captureCopy[attempt.captureState] || [attempt.captureState, "Prototype capture state."];
  wrapper.innerHTML = `<strong>${title}</strong><p>${description}</p><dl><dt>Attempt</dt><dd>${attempt.attemptId}</dd><dt>Origin tab</dt><dd>${attempt.originTabId}</dd><dt>Pin</dt><dd>${attempt.pinId}</dd><dt>Evidence</dt><dd>${attempt.evidence?.kind || "none"} · ${attempt.evidence?.confidence || "unknown"}</dd></dl>`;
  const actions = document.createElement("div");
  actions.className = "capture-actions";
  if (attempt.captureState === "local-write-failed") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry local write";
    retry.addEventListener("click", () => chrome.runtime.sendMessage({ type: "pinref:retryLocalCapture", attemptId: attempt.attemptId }));
    actions.append(retry);
  } else if (["save-not-confirmed", "pinterest-save-failed", "pinterest-save-cancelled"].includes(attempt.captureState)) {
    const check = document.createElement("button");
    check.type = "button";
    check.textContent = "Check again";
    check.addEventListener("click", async () => {
      const response = await chrome.runtime.sendMessage({ type: "pinref:checkCapture", attemptId: attempt.attemptId });
      if (!response?.ok) showPanelMessage("No reliable same-Pin confirmation is available. The attempt stays in Needs Attention.");
    });
    actions.append(check);
  }
  wrapper.append(actions);
  const lab = document.createElement("details");
  lab.className = "capture-lab";
  lab.innerHTML = "<summary>Prototype outcome controls</summary><p>These controls test state transitions; they do not claim Pinterest emitted the signal.</p><div class=\"capture-actions\"></div>";
  const outcomes = [
    ["Confirmed success", "PINTEREST_CONFIRMED", false],
    ["Success + local failure", "PINTEREST_CONFIRMED", true],
    ["Pinterest failure", "PINTEREST_FAILED", false],
    ["Picker cancelled", "PINTEREST_CANCELLED", false],
    ["Evidence timeout", "TIMEOUT", false]
  ];
  for (const [label, eventType, simulateLocalFailure] of outcomes) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => chrome.runtime.sendMessage({
      type: "pinref:simulateCapture",
      attemptId: attempt.attemptId,
      pinId: attempt.pinId,
      originTabId: attempt.originTabId,
      eventType,
      simulateLocalFailure
    }));
    lab.querySelector(".capture-actions").append(button);
  }
  wrapper.append(lab);
  return wrapper;
}

function queueRecordUpdate(pinId, field, value) {
  const key = `${pinId}:${field}`;
  clearTimeout(pendingWrites.get(key));
  pendingWrites.set(key, setTimeout(() => {
    pendingWrites.delete(key);
    chrome.runtime.sendMessage({ type: "pinref:updateRecord", tabId: currentTabId, pinId, field, value });
  }, 180));
}

function render() {
  const focusedField = document.activeElement?.dataset?.field || null;
  const selectionStart = document.activeElement?.selectionStart;
  const selectionEnd = document.activeElement?.selectionEnd;
  const content = document.querySelector("#content");
  const records = currentState?.records || {};
  document.querySelector("#library-count").textContent = `${Object.keys(records).length} references · v${prototypeVersion}`;
  document.querySelector("#debug").textContent = JSON.stringify({ tabId: currentTabId, ...currentState }, null, 2);
  content.replaceChildren();

  const { pinId, record, observed, attempt } = activeData();
  document.querySelector("#reload-metadata").disabled = !pinId;
  if (!pinId) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = currentState?.identityUnavailable
      ? "Couldn’t identify this Pin. Nothing was saved to PinRef."
      : Object.keys(records).length
      ? "Select a Pin on Pinterest, or open Dashboard to browse your library."
      : "Use Pinterest’s Save button to start your local library.";
    content.append(empty);
    return;
  }

  const identity = document.createElement("section");
  identity.className = "identity";
  const previewUrl = observed?.previewUrl || record?.previewUrl;
  if (previewUrl) {
    const image = document.createElement("img");
    image.className = "preview";
    image.alt = "";
    image.src = previewUrl;
    identity.append(image);
  }
  const copy = document.createElement("div");
  copy.className = "identity-copy";
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = record ? "Reference available" : attempt ? "Capture Attempt" : "Current Pin · not in PinRef";
  const id = document.createElement("div");
  id.className = "pin-id";
  id.textContent = pinId;
  const link = document.createElement("a");
  link.href = record?.url || `https://www.pinterest.com/pin/${pinId}/`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Open original Pinterest Pin ↗";
  copy.append(eyebrow, id, link);
  identity.append(copy);
  content.append(identity);

  if (attempt) {
    content.append(captureStateElement(attempt));
    return;
  }

  if (!record) {
    const waiting = document.createElement("div");
    waiting.className = "waiting-state";
    waiting.innerHTML = "<strong>Waiting for Pinterest Save</strong><p>Use Pinterest’s own Save button. PinRef will add this Pin automatically after that action.</p>";
    content.append(waiting);
    return;
  }

  const editor = document.createElement("div");
  editor.className = "editor";
  for (const [field, labelText, elementName, placeholder] of [
    ["tags", "Tags", "input", "fashion, pose, lighting"],
    ["note", "Note", "textarea", "Add a note…"]
  ]) {
    const label = document.createElement("label");
    label.textContent = labelText;
    const control = document.createElement(elementName);
    control.dataset.field = field;
    control.value = field === "tags" ? (record.tags || []).join(", ") : record.note || "";
    control.placeholder = placeholder;
    control.addEventListener("input", () => {
      const value = field === "tags"
        ? [...new Set(control.value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))]
        : control.value;
      record[field] = value;
      queueRecordUpdate(pinId, field, value);
    });
    label.append(control);
    editor.append(label);
  }
  const saved = document.createElement("p");
  saved.className = "saved-time";
  saved.textContent = `Saved ${new Date(record.savedAt).toLocaleString()}`;
  editor.append(saved);
  content.append(editor);

  if (focusedField) {
    const next = document.querySelector(`[data-field="${focusedField}"]`);
    next?.focus();
    if (typeof selectionStart === "number") next?.setSelectionRange(selectionStart, selectionEnd);
  }
}

document.querySelector("#open-dashboard").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "pinref:openDashboard" });
});

document.querySelector("#reload-metadata").addEventListener("click", async () => {
  const button = document.querySelector("#reload-metadata");
  const { pinId } = activeData();
  if (!pinId || button.disabled) return;
  button.disabled = true;
  button.classList.add("loading");
  showPanelMessage("Reloading preview…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "pinref:reloadMetadata", tabId: currentTabId, pinId });
    const refreshed = response?.results?.[0]?.refreshed;
    showPanelMessage(response?.ok && refreshed?.preview ? "Reloaded preview." : response?.message, Boolean(response?.ok));
  } catch {
    showPanelMessage("Reload failed. Keep the Pin open on Pinterest and try again.");
  } finally {
    button.classList.remove("loading");
    button.disabled = !activeData().pinId;
  }
});

document.querySelector("#close-panel").addEventListener("click", async () => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const browserWindow = await chrome.windows.getCurrent();
    const response = await chrome.runtime.sendMessage({
      type: "pinref:closePanel",
      tabId: activeTab?.id,
      windowId: browserWindow.id
    });
    if (!response?.ok) throw new Error("worker could not close panel");
  } catch {
    showPanelMessage("This browser version cannot close the panel from inside it. Use the browser’s × button.");
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "pinref:panelState") return;
  currentTabId = message.tabId;
  currentState = message.state;
  render();
});

chrome.runtime.sendMessage({ type: "pinref:getPanelState" }).then((response) => {
  currentTabId = response.tabId;
  currentState = response.state;
  render();
});
