(() => {
  "use strict";

  const ROOT_MARKER = "data-pinref-native-sidepanel-prototype";
  const CONTENT_BUILD = "0.0.21";
  const OVERLAY_ATTR = "data-pinref-overlay-host";
  const MIN_CARD_SIZE = 120;
  const MAX_SCAN_ANCHORS = 500;
  const {
    parsePinId: parsePinIdFromCore,
    chooseDetailPinId,
    chooseDetailPreview,
    chooseSafePreviewUrl,
    chooseLargestVisiblePreview,
    isPinterestBoardSelectorLabel,
    isPinterestUnsavedSaveLabel,
    isPinterestSavedLabel,
    findPinterestSaveControlIndex,
    resolvePinterestSaveCommit
  } = globalThis.PinRefCore;

  if (document.documentElement.hasAttribute(ROOT_MARKER)) return;
  document.documentElement.setAttribute(ROOT_MARKER, new Date().toISOString());

  const state = {
    activePinId: null,
    identityUnavailable: false,
    records: new Map(),
    observations: new Map(),
    debug: {
      routeChanges: 0, scans: 0, anchorsInspected: 0, overlaysCreated: 0,
      overlaysRebound: 0, overlayClicks: 0, duplicateHostsRemoved: 0,
      shareAnchorsUsed: 0, shareFallbacksUsed: 0, sidePanelOpenRequests: 0,
      nativeSaveClicks: 0, nativeSaveCommits: 0,
      pendingSaveCaptures: 0, pickerSaveCommits: 0,
      lastScanReason: "boot", lastEvent: "boot", lastScanMs: 0
    }
  };

  let scanScheduled = false;
  let lastHref = location.href;
  let toastTimer = null;
  let toastHost = null;
  let pendingNativeSaveContext = null;
  let pendingNativeSaveExpiresAt = 0;
  const liveCaptureAttempts = new Map();
  let liveImportScan = null;

  function currentImportSurfaceKey() {
    try {
      const url = new URL(location.href);
      const segments = url.pathname.split("/").filter(Boolean);
      return `${url.origin}/${segments.join("/")}/`;
    } catch {
      return null;
    }
  }

  function visibleImportCandidates(scan) {
    const byPin = new Map();
    const anchors = getPinAnchors(document);
    const excludedBefore = scan.excludedMembership.size;
    for (const anchor of anchors) {
      const pinId = parsePinId(anchor.href);
      if (!pinId) continue;
      const rect = anchor.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.bottom < -innerHeight || rect.top > innerHeight * 2) continue;
      if (!scan.trustedList.contains(anchor)) {
        scan.excludedMembership.add(pinId);
        continue;
      }
      const root = findCardRoot(anchor);
      const scope = importScopeForAnchor(anchor);
      const previous = byPin.get(pinId);
      const previewUrl = previewFromAnchor(anchor, root);
      if (!previous || (!previous.previewUrl && previewUrl)) {
        byPin.set(pinId, {
          pinId,
          observedUrl: anchor.href,
          previewUrl,
          ...scope,
          observedAt: new Date().toISOString()
        });
      }
    }
    return {
      observations: [...byPin.values()],
      skippedMembership: scan.excludedMembership.size - excludedBefore
    };
  }

  function importScopeForAnchor(anchor) {
    const list = anchor.closest('[role="list"]');
    if (!list) return { scopeKey: "unscoped", scopeHeading: null, scopeBoundaryKind: "none" };
    const lists = [...document.querySelectorAll('[role="list"]')];
    const listIndex = lists.indexOf(list);
    const testId = list.getAttribute("data-test-id");
    const headings = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')]
      .filter((heading) => !list.contains(heading) && (heading.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING));
    const heading = headings.at(-1);
    const scopeHeading = String(heading?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
    return {
      scopeKey: testId ? `test-id:${testId}` : `role-list:${listIndex}`,
      scopeHeading,
      scopeBoundaryKind: testId ? "data-test-id" : "role-list"
    };
  }

  function reliableImportEndEvidence() {
    const nodes = [...document.querySelectorAll('[role="status"], [role="heading"], h1, h2, h3')];
    const marker = nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
        && /^(?:no more pins|you.?ve reached the end|沒有更多 Pin|没有更多 Pin)$/i.test(text);
    });
    return marker ? String(marker.textContent || "").replace(/\s+/g, " ").trim() : null;
  }

  function reportImportEvent(eventType, values = {}) {
    if (!liveImportScan) return;
    chrome.runtime.sendMessage({
      type: "pinref:importEvent",
      sessionId: liveImportScan.sessionId,
      surfaceKey: liveImportScan.surface.surfaceKey,
      eventType,
      ...values
    }).catch(() => {});
  }

  function stopImportLoop() {
    if (!liveImportScan) return;
    clearInterval(liveImportScan.timerId);
    liveImportScan = null;
  }

  function runImportScanStep() {
    const scan = liveImportScan;
    if (!scan) return;
    if (!scan.trustedList) {
      window.scrollTo({ top: 0, behavior: "auto" });
      const nearTop = scrollY <= 8;
      const firstPinAnchor = nearTop ? getPinAnchors(document).find((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight * 2;
      }) : null;
      const candidateList = firstPinAnchor?.closest('[role="list"]');
      scan.topStableRounds = nearTop && candidateList instanceof Element ? scan.topStableRounds + 1 : 0;
      scan.seekTopRounds += 1;
      if (scan.topStableRounds >= 2) {
        scan.trustedList = candidateList;
        scan.lastHeight = document.documentElement.scrollHeight;
      } else if (scan.seekTopRounds >= 8) {
        reportImportEvent("SCAN_FAILED", { reason: "membership-boundary-unavailable-after-top-settle" });
        stopImportLoop();
      }
      return;
    }
    if (!scan.trustedList?.isConnected) {
      reportImportEvent("SCAN_FAILED", { reason: "membership-boundary-lost" });
      stopImportLoop();
      return;
    }
    const currentSurfaceKey = currentImportSurfaceKey();
    if (currentSurfaceKey !== scan.surface.surfaceKey) {
      reportImportEvent("INTERRUPT", { reason: "navigation", currentSurfaceKey });
      stopImportLoop();
      return;
    }
    const { observations, skippedMembership } = visibleImportCandidates(scan);
    const before = scan.seen.size;
    observations.forEach((candidate) => scan.seen.add(candidate.pinId));
    reportImportEvent("OBSERVE_BATCH", { observations, skippedIdentity: 0, skippedMembership });
    const endMarker = reliableImportEndEvidence();
    if (endMarker) {
      reportImportEvent("END_RELIABLE", { evidence: `visible-end-marker:${endMarker}` });
      stopImportLoop();
      return;
    }
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 8;
    const grew = scan.seen.size > before || document.documentElement.scrollHeight > scan.lastHeight;
    scan.plateauRounds = atBottom && !grew ? scan.plateauRounds + 1 : 0;
    scan.lastHeight = document.documentElement.scrollHeight;
    if (scan.plateauRounds >= 4) {
      reportImportEvent("END_UNCONFIRMED", { evidence: "four-round-scroll-height-and-identity-plateau" });
      stopImportLoop();
      return;
    }
    const nextTop = Math.min(
      scrollY + Math.max(320, innerHeight * 0.8),
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    );
    window.scrollTo({ top: nextTop, behavior: "auto" });
  }

  function startImportLoop(message) {
    if (liveImportScan) return { ok: false, reason: "scan-already-active" };
    if (currentImportSurfaceKey() !== message.surface?.surfaceKey) return { ok: false, reason: "surface-binding-mismatch" };
    window.scrollTo({ top: 0, behavior: "auto" });
    liveImportScan = {
      sessionId: message.sessionId,
      surface: { ...message.surface },
      seen: new Set(),
      excludedMembership: new Set(),
      trustedList: null,
      topStableRounds: 0,
      seekTopRounds: 0,
      plateauRounds: 0,
      lastHeight: 0,
      timerId: null
    };
    runImportScanStep();
    if (liveImportScan) liveImportScan.timerId = setInterval(runImportScanStep, 600);
    return { ok: true, surfaceKey: currentImportSurfaceKey() };
  }

  function parsePinId(rawUrl) {
    return parsePinIdFromCore(rawUrl, location.href);
  }

  function canonicalUrl(pinId) { return `https://www.pinterest.com/pin/${pinId}/`; }

  function safePreviewUrl(rawUrl) {
    return chooseSafePreviewUrl([rawUrl], location.href);
  }

  function previewFromRoot(root, minSize = 80) {
    if (!(root instanceof Element)) return null;
    const candidates = [...root.querySelectorAll("img")]
      .map((image) => ({ image, rect: image.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= minSize && rect.height >= minSize)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    return chooseSafePreviewUrl(candidates.map(({ image }) => image.currentSrc || image.src), location.href);
  }

  function previewFromAnchor(anchor, root) {
    const directPreview = previewFromRoot(anchor);
    if (directPreview) return directPreview;
    if (!(root instanceof Element)) return null;

    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.width < 1 || anchorRect.height < 1) return null;
    const candidates = [...root.querySelectorAll("img")].map((image) => {
      const rect = image.getBoundingClientRect();
      const overlapWidth = Math.max(0, Math.min(anchorRect.right, rect.right) - Math.max(anchorRect.left, rect.left));
      const overlapHeight = Math.max(0, Math.min(anchorRect.bottom, rect.bottom) - Math.max(anchorRect.top, rect.top));
      const overlap = overlapWidth * overlapHeight;
      return { image, rect, overlap };
    }).filter(({ rect, overlap }) => rect.width >= 80 && rect.height >= 80 && overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    return safePreviewUrl(candidates[0]?.image.currentSrc || candidates[0]?.image.src);
  }

  function detailRootNearControls() {
    const controls = [...document.querySelectorAll('button, [role="button"]')]
      .filter((control) => {
        const label = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("title") || ""} ${control.textContent || ""}`;
        const rect = control.getBoundingClientRect();
        return /share this pin|share pin|分享這個 Pin|分享此 Pin|傳送這個 Pin/i.test(label)
          && rect.width >= 20 && rect.height >= 20 && rect.bottom > 0 && rect.top < innerHeight;
      });
    for (const control of controls) {
      let node = control.parentElement;
      for (let depth = 0; node instanceof Element && depth < 14 && node !== document.body; depth += 1, node = node.parentElement) {
        if (previewFromRoot(node, 180)) return node;
      }
    }
    return null;
  }

  function detailPreviewNearControls() {
    return previewFromRoot(detailRootNearControls(), 180);
  }

  function largestVisiblePinPreview() {
    return chooseLargestVisiblePreview([...document.querySelectorAll("img")].map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        url: image.currentSrc || image.src,
        width: rect.width,
        height: rect.height,
        visible: rect.width >= 180 && rect.height >= 180 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
      };
    }), location.href);
  }

  function detailPreviewFromPage() {
    return detailPreviewNearControls() || largestVisiblePinPreview();
  }

  function controlLabel(control) {
    return `${control?.getAttribute?.("aria-label") || ""} ${control?.getAttribute?.("title") || ""} ${control?.textContent || ""}`
      .replace(/\s+/g, " ").trim();
  }

  function isNativePinterestSaveControl(control) {
    if (!(control instanceof Element) || control.matches(":disabled")) return false;
    const labels = [control.getAttribute("aria-label"), control.getAttribute("title"), control.textContent]
      .map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return isPinterestUnsavedSaveLabel(labels);
  }

  function nativePinterestSaveControlFromEvent(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    const elements = path.filter((entry) => entry instanceof Element);
    const candidates = elements.map((element) => ({
      isControl: element.matches('button, [role="button"]'),
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      labels: [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent]
    }));
    const index = findPinterestSaveControlIndex(candidates);
    if (index >= 0) return { control: elements[index], path: elements };

    const fallback = event?.target instanceof Element ? event.target.closest('button, [role="button"]') : null;
    return isNativePinterestSaveControl(fallback) ? { control: fallback, path: elements } : null;
  }

  function nativePinterestBoardSelectorFromEvent(event) {
    const path = typeof event?.composedPath === "function" ? event.composedPath() : [];
    for (const element of path) {
      if (!(element instanceof Element) || !element.matches('button, [role="button"]')) continue;
      const labels = [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent];
      if (isPinterestBoardSelectorLabel(labels)) {
        return { control: element, path: path.filter((entry) => entry instanceof Element) };
      }
    }
    return null;
  }

  function nativeSaveContext(control, eventPath = []) {
    const routePinId = parsePinId(location.href);
    if (routePinId) {
      const detailRoot = detailRootNearControls();
      const visibleSaveControls = [...document.querySelectorAll('button, [role="button"]')]
        .filter(isNativePinterestSaveControl)
        .filter((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
        })
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      if (detailRoot?.contains(control) || visibleSaveControls[0] === control) {
        return {
          pinId: routePinId,
          observedUrl: location.href,
          previewUrl: detailPreviewFromPage()
        };
      }
    }
    const ancestors = eventPath.filter((entry) => entry instanceof Element && entry !== document.body);
    for (let node = control; node instanceof Element && node !== document.body; node = node.parentElement) {
      if (!ancestors.includes(node)) ancestors.push(node);
    }
    for (const node of ancestors) {
      const anchors = getPinAnchors(node);
      const pinIds = [...new Set(anchors.map((anchor) => parsePinId(anchor.href)).filter(Boolean))];
      if (pinIds.length !== 1) continue;
      const anchor = anchors.find((candidate) => parsePinId(candidate.href) === pinIds[0]);
      return {
        pinId: pinIds[0],
        observedUrl: anchor?.href || canonicalUrl(pinIds[0]),
        previewUrl: previewFromAnchor(anchor, node)
      };
    }
    return null;
  }

  function surfaceForContext(context) {
    if (parsePinId(location.href) === context?.pinId) return "pin-detail";
    return pendingNativeSaveContext?.pinId === context?.pinId ? "board-picker" : "feed";
  }

  function reportCaptureEvidence(attemptId, type, evidence) {
    const live = liveCaptureAttempts.get(attemptId);
    if (!live || live.finished) return;
    live.finished = type !== "CHECK_AGAIN";
    clearTimeout(live.timeoutId);
    live.observer?.disconnect();
    chrome.runtime.sendMessage({
      type: "pinref:captureEvidence",
      attemptId,
      pinId: live.context.pinId,
      eventType: type,
      evidence
    }).catch(() => {});
  }

  function watchPinterestOutcome(attemptId, control) {
    const live = liveCaptureAttempts.get(attemptId);
    if (!live) return;
    const inspect = () => {
      if (live.finished) return;
      const labels = [control?.getAttribute?.("aria-label"), control?.getAttribute?.("title"), control?.textContent];
      if (control?.isConnected && isPinterestSavedLabel(labels)) {
        reportCaptureEvidence(attemptId, "PINTEREST_CONFIRMED", {
          kind: "same-control-saved-state",
          confidence: "conditionally-reliable",
          detail: controlLabel(control)
        });
        return;
      }
      const alerts = [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')]
        .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const failure = alerts.find((label) => /couldn.?t save|failed to save|unable to save|儲存失敗|無法儲存|保存失败|无法保存/i.test(label));
      if (failure) reportCaptureEvidence(attemptId, "PINTEREST_FAILED", {
        kind: "pinterest-error-alert",
        confidence: "conditionally-reliable",
        detail: failure.slice(0, 160)
      });
    };
    live.observer = new MutationObserver(inspect);
    live.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "title"] });
    live.timeoutId = setTimeout(() => reportCaptureEvidence(attemptId, "TIMEOUT", {
      kind: "confirmation-timeout",
      confidence: "reliable",
      detail: "No same-Pin completion evidence was observed within 6 seconds"
    }), 6000);
    inspect();
  }

  function beginCaptureAttempt(context, control) {
    if (!context?.pinId) return;
    const existing = [...liveCaptureAttempts.values()].find((item) => !item.finished && item.context.pinId === context.pinId);
    if (existing) return existing.attemptId;
    const attemptId = crypto.randomUUID();
    state.activePinId = context.pinId;
    state.identityUnavailable = false;
    observePin(context.pinId, context);
    const live = { attemptId, context: { ...context }, control, finished: false, observer: null, timeoutId: null };
    liveCaptureAttempts.set(attemptId, live);
    state.debug.lastEvent = `Capture Attempt started for ${context.pinId}`;
    sendState();
    chrome.runtime.sendMessage({
      type: "pinref:captureStarted",
      attemptId,
      operationId: `capture:${attemptId}`,
      pinId: context.pinId,
      surface: surfaceForContext(context),
      observedUrl: context.observedUrl,
      previewUrl: context.previewUrl
    }).then(() => watchPinterestOutcome(attemptId, control)).catch(() => {});
    return attemptId;
  }

  function handlePinterestBoardSelectorIntent(event) {
    const match = nativePinterestBoardSelectorFromEvent(event);
    if (!match) return false;
    const context = nativeSaveContext(match.control, match.path);
    if (!context) {
      state.debug.lastEvent = "Pinterest board picker opened, but Pin identity was unavailable";
      sendState();
      return true;
    }
    pendingNativeSaveContext = { ...context };
    pendingNativeSaveExpiresAt = Date.now() + 60_000;
    state.debug.pendingSaveCaptures += 1;
    state.debug.lastEvent = `waiting for board-picker Save for ${context.pinId}`;
    sendState();
    return true;
  }

  function handleNativePinterestSave(event) {
    const match = nativePinterestSaveControlFromEvent(event);
    if (!match) return false;
    if (pendingNativeSaveExpiresAt <= Date.now()) {
      pendingNativeSaveContext = null;
      pendingNativeSaveExpiresAt = 0;
    }
    const directContext = nativeSaveContext(match.control, match.path);
    const context = resolvePinterestSaveCommit({
      directContext,
      pendingContext: pendingNativeSaveContext
    });
    state.debug.nativeSaveClicks += 1;
    if (!context) {
      state.activePinId = null;
      state.identityUnavailable = true;
      state.debug.lastEvent = "Pinterest Save clicked, but Pin identity was unavailable";
      sendState();
      return true;
    }
    if (!directContext) {
      state.debug.pickerSaveCommits += 1;
      pendingNativeSaveContext = null;
      pendingNativeSaveExpiresAt = 0;
    }
    beginCaptureAttempt(context, match.control);
    return true;
  }

  function observePin(pinId, values = {}) {
    const previous = state.observations.get(pinId) || {};
    const next = {
      pinId, url: canonicalUrl(pinId),
      observedUrl: values.observedUrl || previous.observedUrl || canonicalUrl(pinId),
      previewUrl: values.previewUrl || previous.previewUrl || null
    };
    state.observations.set(pinId, next);
    return JSON.stringify(previous) !== JSON.stringify(next);
  }

  function snapshot() {
    return {
      location: location.href, activePinId: state.activePinId,
      identityUnavailable: state.identityUnavailable,
      records: Object.fromEntries(state.records), observations: Object.fromEntries(state.observations),
      visibleOverlayHosts: document.querySelectorAll(`[${OVERLAY_ATTR}]`).length,
      debug: { ...state.debug }
    };
  }

  function applySnapshot(next) {
    if (!next) return;
    state.activePinId = next.activePinId || null;
    state.identityUnavailable = Boolean(next.identityUnavailable);
    state.records = new Map(Object.entries(next.records || {}));
    state.observations = new Map(Object.entries(next.observations || {}));
    if (next.debug) state.debug = { ...state.debug, ...next.debug };
    renderAllOverlays();
  }

  function sendState({ openPanel = false } = {}) {
    chrome.runtime.sendMessage({ type: "pinref:contentState", state: snapshot(), openPanel }).catch(() => {});
  }

  function stopPageEvent(event) {
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  }

  function getPinAnchors(scope = document) {
    const anchors = [];
    if (scope instanceof Element && scope.matches('a[href*="/pin/"]')) anchors.push(scope);
    if (scope.querySelectorAll) anchors.push(...scope.querySelectorAll('a[href*="/pin/"]'));
    return anchors.slice(0, MAX_SCAN_ANCHORS);
  }

  function findCardRoot(anchor) {
    if (!(anchor instanceof HTMLElement) || !anchor.isConnected) return null;
    let node = anchor, fallback = null, bestSinglePinRoot = null;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      if (!(node instanceof HTMLElement) || node === document.body) break;
      const rect = node.getBoundingClientRect();
      const usable = rect.width >= MIN_CARD_SIZE && rect.height >= MIN_CARD_SIZE;
      const notPageSized = rect.width < Math.max(700, window.innerWidth * .72);
      if (!usable || !notPageSized || node === anchor) continue;
      fallback = node;
      const ownPinIds = new Set([...node.querySelectorAll('a[href*="/pin/"]')]
        .map((candidate) => parsePinId(candidate.href)).filter(Boolean));
      if (ownPinIds.size === 1 && rect.height <= Math.max(900, window.innerHeight * 1.4)) bestSinglePinRoot = node;
    }
    return bestSinglePinRoot || fallback;
  }

  function ensurePositioning(root) {
    if (getComputedStyle(root).position === "static") {
      root.dataset.pinrefPreviousPosition = root.style.position || "";
      root.style.position = "relative";
    }
  }

  function nativeShareControl(root) {
    if (!(root instanceof Element)) return null;
    return [...root.querySelectorAll('button, [role="button"]')].filter((control) => {
      const label = `${control.getAttribute("aria-label") || ""} ${control.getAttribute("title") || ""} ${control.textContent || ""}`;
      const rect = control.getBoundingClientRect();
      return /share|send|傳送|分享/i.test(label) && rect.width >= 24 && rect.height >= 24;
    }).sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0] || null;
  }

  function positionOverlay(host) {
    const root = host.parentElement;
    const share = nativeShareControl(root);
    if (share) {
      const rootRect = root.getBoundingClientRect(), shareRect = share.getBoundingClientRect();
      const left = Math.min(Math.max(6, shareRect.left - rootRect.left + (shareRect.width - 34) / 2), Math.max(6, rootRect.width - 40));
      const top = shareRect.top - rootRect.top - 42;
      if (top >= 6) {
        Object.assign(host.style, { inset: "auto", left: `${left}px`, top: `${top}px` });
        host.dataset.pinrefPosition = "native-share";
        state.debug.shareAnchorsUsed += 1;
        return;
      }
    }
    Object.assign(host.style, { inset: "auto 10px 58px auto", left: "auto", top: "auto" });
    host.dataset.pinrefPosition = "fallback";
    state.debug.shareFallbacksUsed += 1;
  }

  function createOverlayHost(root, pinId, observedUrl, previewUrl) {
    observePin(pinId, { observedUrl, previewUrl });
    ensurePositioning(root);
    const host = document.createElement("span");
    host.setAttribute(OVERLAY_ATTR, "");
    host.dataset.pinrefPinId = pinId;
    host.dataset.pinrefObservedUrl = observedUrl;
    Object.assign(host.style, {
      position: "absolute", inset: "auto 10px 58px auto", zIndex: "2147483000",
      width: "34px", height: "34px", opacity: "0", pointerEvents: "none", transition: "opacity 100ms ease"
    });
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{all:initial}button{box-sizing:border-box;width:34px;height:34px;border-radius:999px;border:1px solid rgba(255,255,255,.78);padding:0;cursor:pointer;display:grid;place-items:center;color:#fff;background:rgba(17,17,17,.84);box-shadow:0 2px 9px rgba(0,0,0,.28);font:700 21px/1 system-ui,sans-serif}button[data-saved="true"]{background:#0c7a54;font-size:17px}button:focus-visible{outline:3px solid #7cc8ff;outline-offset:2px}
    </style><button type="button"></button>`;
    const button = shadow.querySelector("button");
    const syncVisibility = () => syncOverlayVisibility(host);
    root.addEventListener("pointerenter", syncVisibility);
    root.addEventListener("pointerleave", () => requestAnimationFrame(syncVisibility));
    root.addEventListener("focusin", syncVisibility);
    root.addEventListener("focusout", () => requestAnimationFrame(syncVisibility));
    for (const type of ["pointerdown", "mousedown", "mouseup"]) button.addEventListener(type, stopPageEvent, { capture: true });
    button.addEventListener("click", (event) => {
      stopPageEvent(event);
      const currentId = parsePinId(host.dataset.pinrefObservedUrl);
      if (!currentId || currentId !== host.dataset.pinrefPinId) {
        showToast("Pin changed — try again", true); scheduleScan("stale overlay click"); return;
      }
      state.debug.overlayClicks += 1;
      state.activePinId = currentId;
      if (state.records.has(currentId)) {
        state.debug.sidePanelOpenRequests += 1;
        state.debug.lastEvent = `requested native Side Panel for ${currentId}`;
        sendState({ openPanel: true });
      } else {
        const observed = state.observations.get(currentId);
        state.records.set(currentId, {
          pinId: currentId, url: canonicalUrl(currentId), observedUrl: host.dataset.pinrefObservedUrl,
          previewUrl: observed?.previewUrl || null, note: "", tags: [], savedAt: new Date().toISOString()
        });
        state.debug.lastEvent = `saved ${currentId}`;
        showToast("Saved to PinRef"); sendState();
      }
      renderAllOverlays();
    }, { capture: true });
    root.append(host);
    state.debug.overlaysCreated += 1;
    return host;
  }

  function ensureOverlay(anchor) {
    const pinId = parsePinId(anchor.href), root = findCardRoot(anchor);
    if (!pinId || !root) return;
    const previewUrl = previewFromAnchor(anchor, root);
    const hosts = [...root.querySelectorAll(`[${OVERLAY_ATTR}]`)].filter((host) => host.parentElement === root);
    let host = hosts.shift();
    for (const duplicate of hosts) { duplicate.remove(); state.debug.duplicateHostsRemoved += 1; }
    if (!host) host = createOverlayHost(root, pinId, anchor.href, previewUrl);
    observePin(pinId, { observedUrl: anchor.href, previewUrl });
    if (host.dataset.pinrefPinId !== pinId) {
      host.dataset.pinrefPinId = pinId; host.dataset.pinrefObservedUrl = anchor.href; state.debug.overlaysRebound += 1;
    }
    positionOverlay(host); renderOverlay(host);
  }

  function removeOverlappingDuplicates() {
    const byPin = new Map();
    for (const host of document.querySelectorAll(`[${OVERLAY_ATTR}]`)) {
      const id = host.dataset.pinrefPinId;
      if (!byPin.has(id)) byPin.set(id, []);
      byPin.get(id).push(host);
    }
    for (const hosts of byPin.values()) for (let i = 0; i < hosts.length; i += 1) {
      const first = hosts[i]; if (!first?.isConnected) continue;
      const firstRoot = first.parentElement, a = firstRoot.getBoundingClientRect();
      for (let j = i + 1; j < hosts.length; j += 1) {
        const second = hosts[j]; if (!second?.isConnected) continue;
        const secondRoot = second.parentElement, b = secondRoot.getBoundingClientRect();
        const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        if (!firstRoot.contains(secondRoot) && !secondRoot.contains(firstRoot) && !(smaller > 0 && overlap / smaller >= .5)) continue;
        const duplicate = a.width * a.height >= b.width * b.height ? second : first;
        duplicate.remove(); state.debug.duplicateHostsRemoved += 1;
        if (duplicate === first) break;
      }
    }
  }

  function renderOverlay(host) {
    const button = host.shadowRoot?.querySelector("button"); if (!button) return;
    const pinId = host.dataset.pinrefPinId, saved = state.records.has(pinId);
    button.dataset.saved = String(saved); button.textContent = saved ? "✓" : "+";
    button.setAttribute("aria-label", saved ? `Open PinRef Side Panel for Pin ${pinId}` : `Save Pin ${pinId} to PinRef`);
    button.title = saved ? "Saved — open PinRef Side Panel" : "Save to PinRef";
    syncOverlayVisibility(host);
  }

  function syncOverlayVisibility(host) {
    const root = host.parentElement;
    const visible = state.records.has(host.dataset.pinrefPinId) || Boolean(root?.matches(":hover") || root?.contains(document.activeElement)) || matchMedia("(hover:none)").matches;
    host.style.opacity = visible ? "1" : "0"; host.style.pointerEvents = visible ? "auto" : "none";
  }

  function renderAllOverlays() { for (const host of document.querySelectorAll(`[${OVERLAY_ATTR}]`)) renderOverlay(host); }

  function showToast(message, error = false) {
    if (!toastHost?.isConnected) {
      toastHost = document.createElement("div");
      Object.assign(toastHost.style, { position: "fixed", inset: "auto 20px 20px auto", zIndex: "2147483647" });
      toastHost.attachShadow({ mode: "open" }); document.documentElement.append(toastHost);
    }
    toastHost.shadowRoot.innerHTML = `<div role="status" style="padding:10px 12px;border-radius:8px;background:${error ? "#9c1c1c" : "#111"};color:#fff;font:600 12px/1.3 system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.3)"></div>`;
    toastHost.shadowRoot.querySelector("div").textContent = message;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastHost?.remove(), 2200);
  }

  function resolveDetailPin() {
    return chooseDetailPinId({
      routePinId: parsePinId(location.href),
      canonicalPinId: parsePinId(document.querySelector('link[rel="canonical"]')?.href),
      openGraphPinId: parsePinId(document.querySelector('meta[property="og:url"]')?.content)
    });
  }

  function handleDetailRoute(reason) {
    const pinId = resolveDetailPin();
    if (!pinId) {
      if (["initial", "URL change", "popstate"].includes(reason)) {
        const changed = state.activePinId !== null || state.identityUnavailable;
        state.activePinId = null;
        state.identityUnavailable = false;
        return changed;
      }
      return false;
    }
    const linkedPreviews = getPinAnchors(document)
      .filter((anchor) => parsePinId(anchor.href) === pinId)
      .map((anchor) => ({
        previewUrl: previewFromAnchor(anchor, findCardRoot(anchor)),
        area: anchor.getBoundingClientRect().width * anchor.getBoundingClientRect().height
      }))
      .filter(({ previewUrl }) => previewUrl)
      .sort((a, b) => b.area - a.area)
      .map(({ previewUrl }) => previewUrl);
    const canonicalPinId = parsePinId(document.querySelector('link[rel="canonical"]')?.href);
    const openGraphPinId = parsePinId(document.querySelector('meta[property="og:url"]')?.content);
    const metadataPinId = canonicalPinId === pinId || openGraphPinId === pinId ? pinId : canonicalPinId || openGraphPinId;
    const detailPreviews = [detailPreviewFromPage()].filter(Boolean);
    const previewUrl = chooseDetailPreview({
      pinId,
      detailPreviews,
      linkedPreviews,
      metadataPinId,
      metadataPreview: safePreviewUrl(document.querySelector('meta[property="og:image"]')?.content)
    });
    const changed = observePin(pinId, { observedUrl: location.href, previewUrl });
    const previousActive = state.activePinId; state.activePinId = pinId;
    state.identityUnavailable = false;
    const record = state.records.get(pinId);
    if (record && previewUrl) record.previewUrl = previewUrl;
    state.debug.lastEvent = `${reason}: detail ${pinId}`;
    return changed || previousActive !== pinId;
  }

  function refreshMetadata(pinId) {
    const routePinId = resolveDetailPin();
    const matchingAnchors = getPinAnchors(document).filter((anchor) => parsePinId(anchor.href) === pinId);
    if (routePinId !== pinId && !matchingAnchors.length) return { ok: false, reason: "pin-not-visible" };
    const previewUrl = routePinId === pinId
      ? chooseDetailPreview({
          pinId,
          detailPreviews: [detailPreviewFromPage()].filter(Boolean),
          linkedPreviews: matchingAnchors.map((anchor) => previewFromAnchor(anchor, findCardRoot(anchor))).filter(Boolean),
          metadataPinId: parsePinId(document.querySelector('link[rel="canonical"]')?.href) || parsePinId(document.querySelector('meta[property="og:url"]')?.content),
          metadataPreview: safePreviewUrl(document.querySelector('meta[property="og:image"]')?.content)
        })
      : matchingAnchors.map((anchor) => previewFromAnchor(anchor, findCardRoot(anchor))).find(Boolean) || null;
    const observedUrl = routePinId === pinId ? location.href : matchingAnchors[0]?.href || canonicalUrl(pinId);
    observePin(pinId, { observedUrl, previewUrl });
    const record = state.records.get(pinId);
    if (record && previewUrl) record.previewUrl = previewUrl;
    state.debug.lastEvent = `manual metadata reload for ${pinId}`;
    sendState();
    const ok = Boolean(previewUrl);
    return {
      ok,
      reason: ok ? null : "metadata-not-found",
      observation: { pinId, observedUrl, previewUrl },
      refreshed: { preview: Boolean(previewUrl) }
    };
  }

  function scan(scope = document, reason = "scan") {
    const started = performance.now(), anchors = getPinAnchors(scope);
    state.debug.scans += 1; state.debug.anchorsInspected += anchors.length; state.debug.lastScanReason = reason;
    for (const host of document.querySelectorAll(`[${OVERLAY_ATTR}]`)) host.remove();
    const activeChanged = handleDetailRoute(reason);
    state.debug.lastScanMs = Number((performance.now() - started).toFixed(2));
    renderAllOverlays();
    if (activeChanged || ["initial", "URL change", "popstate"].includes(reason)) sendState();
  }

  function scheduleScan(reason, scope = document) {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => { scanScheduled = false; scan(scope, reason); });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "pinref:ping") sendResponse({ ok: true, version: CONTENT_BUILD });
    if (message?.type === "pinref:applyState") applySnapshot(message.state);
    if (message?.type === "pinref:refreshMetadata") sendResponse(refreshMetadata(String(message.pinId || "")));
    if (message?.type === "pinref:probeCapture") {
      const pinId = String(message.pinId || "");
      const savedControl = [...document.querySelectorAll('button, [role="button"]')]
        .find((control) => isPinterestSavedLabel([control.getAttribute("aria-label"), control.getAttribute("title"), control.textContent]));
      sendResponse({
        ok: Boolean(savedControl && (parsePinId(location.href) === pinId || state.activePinId === pinId)),
        pinId,
        evidence: savedControl ? { kind: "current-saved-control", confidence: "heuristic-only", detail: controlLabel(savedControl) } : null
      });
    }
    if (message?.type === "pinref:startImportScan") sendResponse(startImportLoop(message));
    if (message?.type === "pinref:stopImportScan") {
      const matches = !liveImportScan || liveImportScan.sessionId === message.sessionId;
      if (matches) stopImportLoop();
      sendResponse({ ok: matches });
    }
  });

  chrome.runtime.sendMessage({ type: "pinref:hello" }).then((response) => {
    if (response?.state) applySnapshot(response.state);
    scan(document, "initial");
  }).catch(() => scan(document, "initial"));

  new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => [...mutation.addedNodes].some((node) => node instanceof Element && (node.matches?.('a[href*="/pin/"], img') || node.querySelector?.('a[href*="/pin/"]'))));
    if (relevant) scheduleScan("mutation");
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("popstate", () => scheduleScan("popstate"));
  document.addEventListener("click", (event) => {
    handlePinterestBoardSelectorIntent(event);
    handleNativePinterestSave(event);
    setTimeout(() => scheduleScan("page click"), 0);
  }, true);
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      pendingNativeSaveContext = null;
      pendingNativeSaveExpiresAt = 0;
      state.debug.routeChanges += 1;
      scheduleScan("URL change");
    }
  }, 750);
  setInterval(() => { if (document.visibilityState === "visible") scheduleScan("reconciliation"); }, 2500);
})();
