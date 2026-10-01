(function installImportScanner() {
  "use strict";

  if (globalThis.__pinrefImportScannerInstalled) return;
  globalThis.__pinrefImportScannerInstalled = true;

  let scan = null;
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function surfaceKeyForUrl(value) {
    try {
      const url = new URL(value);
      const segments = url.pathname.split("/").filter(Boolean);
      if (url.protocol !== "https:" || !/(^|\.)pinterest\.com$/i.test(url.hostname) || segments.length !== 2) return null;
      if (["pin", "search", "ideas", "today", "settings", "explore"].includes(segments[0].toLowerCase())) return null;
      if (segments[1].startsWith("_") && segments[1] !== "_pins") return null;
      url.search = "";
      url.hash = "";
      url.pathname = `/${segments[0]}/${segments[1]}/`;
      return url.toString();
    } catch {
      return null;
    }
  }

  function pinIdFromHref(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== "https:" || !/(^|\.)pinterest\.com$/i.test(url.hostname)) return null;
      const match = url.pathname.match(/\/pin\/(?:[^/?#]*--)?(\d{6,})(?:\/|$)/i);
      return match?.[1] || null;
    } catch {
      return null;
    }
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden" && style.display !== "none";
  }

  function safePreview(anchor) {
    const container = anchor.closest('[role="listitem"], [data-test-id="pin"]') || anchor;
    const images = [...container.querySelectorAll("img")]
      .filter(isVisible)
      .map((image) => image.currentSrc || image.src)
      .filter((url) => /^https:\/\/i\.pinimg\.com\//i.test(url));
    return images[0] || null;
  }

  function importScopeForAnchor(anchor) {
    const list = anchor.closest('[role="list"]');
    if (!list) return { scopeKey: "unscoped", scopeHeading: null, scopeBoundaryKind: "none" };
    const lists = [...document.querySelectorAll('[role="list"]')];
    const listIndex = lists.indexOf(list);
    const testId = list.getAttribute("data-test-id");
    const headings = [...document.querySelectorAll('h1, h2, h3, [role="heading"]')]
      .filter((heading) => !list.contains(heading) && (heading.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING));
    const scopeHeading = String(headings.at(-1)?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
    return {
      scopeKey: testId ? `test-id:${testId}` : `role-list:${listIndex}`,
      scopeHeading,
      scopeBoundaryKind: testId ? "data-test-id" : "role-list"
    };
  }

  function visibleImportCandidates(scan) {
    const candidates = new Map();
    const excludedBefore = scan.excludedMembership.size;
    let skippedIdentity = 0;
    for (const item of scan.trustedList.querySelectorAll('[role="listitem"]')) {
      const rect = item.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.bottom < -innerHeight || rect.top > innerHeight * 2) continue;
      const hasCanonicalPin = [...item.querySelectorAll("a[href]")].some((anchor) => pinIdFromHref(anchor.href));
      if (!hasCanonicalPin && !scan.skippedIdentityNodes.has(item)) {
        scan.skippedIdentityNodes.add(item);
        skippedIdentity += 1;
      }
    }
    for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
      const pinId = pinIdFromHref(anchor.href);
      const rect = anchor.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.bottom < -innerHeight || rect.top > innerHeight * 2) continue;
      if (!pinId) {
        const listItem = anchor.closest('[role="listitem"]');
        if (
          scan.trustedList.contains(anchor)
          && (!listItem || !scan.trustedList.contains(listItem))
          && !scan.skippedIdentityNodes.has(anchor)
        ) {
          scan.skippedIdentityNodes.add(anchor);
          skippedIdentity += 1;
        }
        continue;
      }
      if (!scan.trustedList.contains(anchor)) {
        scan.excludedMembership.add(pinId);
        continue;
      }
      const prior = candidates.get(pinId);
      const previewUrl = safePreview(anchor);
      candidates.set(pinId, {
        pinId,
        observedUrl: anchor.href,
        previewUrl: previewUrl || prior?.previewUrl || null,
        ...importScopeForAnchor(anchor),
        observedAt: new Date().toISOString()
      });
    }
    return {
      observations: [...candidates.values()],
      skippedMembership: scan.excludedMembership.size - excludedBefore,
      skippedIdentity
    };
  }

  function reliableImportEndEvidence() {
    return [...document.querySelectorAll('[role="status"], [role="heading"], h1, h2, h3')].find((node) => {
      const rect = node.getBoundingClientRect();
      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
        && /^(?:no more pins|you.?ve reached the end|沒有更多 Pin|没有更多 Pin)$/i.test(text);
    })?.textContent?.trim() || null;
  }

  async function report(current, eventType, detail = {}) {
    if (scan !== current) return null;
    return chrome.runtime.sendMessage({
      type: "pinref:scanEvent",
      sessionId: current.sessionId,
      surfaceKey: current.surfaceKey,
      eventType,
      ...detail
    }).catch(() => null);
  }

  async function run(current) {
    while (scan === current && !current.cancelled) {
      if (document.visibilityState !== "visible") {
        await report(current, "INTERRUPT", { reason: "loss-of-foreground-reliability" });
        if (scan === current) scan = null;
        return;
      }
      if (surfaceKeyForUrl(location.href) !== current.surfaceKey) {
        await report(current, "INTERRUPT", { reason: "navigation" });
        if (scan === current) scan = null;
        return;
      }
      const heartbeat = await report(current, "HEARTBEAT");
      if (scan !== current) return;
      if (!heartbeat?.ok || !heartbeat.continueScan) { scan = null; return; }
      if (!current.trustedList) {
        window.scrollTo({ top: 0, behavior: "auto" });
        const nearTop = scrollY <= 8;
        const firstPin = nearTop ? [...document.querySelectorAll('a[href*="/pin/"]')].find((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return pinIdFromHref(anchor.href) && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight * 2;
        }) : null;
        const candidateList = firstPin?.closest('[role="list"]') || null;
        current.topStableRounds = nearTop && candidateList?.isConnected ? current.topStableRounds + 1 : 0;
        current.seekTopRounds += 1;
        if (current.topStableRounds >= 2) {
          current.trustedList = candidateList;
          current.lastHeight = document.documentElement.scrollHeight;
        } else if (current.seekTopRounds >= 8) {
          await report(current, "SCAN_FAILED", { reason: "membership-boundary-unavailable-after-top-settle" });
          if (scan === current) scan = null;
          return;
        }
        await wait(600);
        continue;
      }
      if (!current.trustedList.isConnected) {
        await report(current, "SCAN_FAILED", { reason: "trusted-collection-disconnected" });
        if (scan === current) scan = null;
        return;
      }
      const { observations, skippedMembership, skippedIdentity } = visibleImportCandidates(current);
      const before = current.seen.size;
      for (const candidate of observations) current.seen.add(candidate.pinId);
      const accepted = await report(current, "OBSERVE_BATCH", {
        observations,
        skippedIdentity,
        skippedMembership
      });
      if (scan !== current) return;
      if (!accepted?.ok || !accepted.continueScan) { scan = null; return; }
      const endMarker = reliableImportEndEvidence();
      if (endMarker) {
        await report(current, "END_RELIABLE", { evidence: `visible-end-marker:${endMarker}` });
        if (scan === current) scan = null;
        return;
      }
      const scrollHeight = document.documentElement.scrollHeight;
      const atBottom = innerHeight + scrollY >= scrollHeight - 8;
      const grew = current.seen.size > before || scrollHeight > current.lastHeight;
      current.plateauRounds = atBottom && !grew ? current.plateauRounds + 1 : 0;
      current.lastHeight = scrollHeight;
      if (current.plateauRounds >= 4) {
        await report(current, "END_UNCONFIRMED", { evidence: "four-round-scroll-height-and-identity-plateau" });
        if (scan === current) scan = null;
        return;
      }
      const nextTop = Math.min(
        scrollY + Math.max(320, innerHeight * 0.8),
        Math.max(0, scrollHeight - innerHeight)
      );
      window.scrollTo({ top: nextTop, behavior: "auto" });
      await wait(600);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "pinref:pingImportScanner") {
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "pinref:startImportScan") {
      if (scan && !scan.cancelled) {
        sendResponse({ ok: false, reason: "scan-already-active" });
        return;
      }
      scan = {
        sessionId: message.sessionId,
        surfaceKey: message.surface.surfaceKey,
        trustedList: null,
        seen: new Set(),
        excludedMembership: new Set(),
        skippedIdentityNodes: new WeakSet(),
        topStableRounds: 0,
        seekTopRounds: 0,
        plateauRounds: 0,
        lastHeight: 0,
        cancelled: false
      };
      window.scrollTo({ top: 0, behavior: "auto" });
      sendResponse({ ok: true });
      const started = scan;
      run(started).catch(async () => {
        await report(started, "SCAN_FAILED", { reason: "scanner-unavailable" });
        if (scan === started) scan = null;
      });
      return;
    }
    if (message?.type === "pinref:stopImportScan" && scan?.sessionId === message.sessionId) {
      scan.cancelled = true;
      scan = null;
      sendResponse({ ok: true });
    }
  });
})();
