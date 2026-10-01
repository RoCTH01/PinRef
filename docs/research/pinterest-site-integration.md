# PinRef Pinterest 站內整合研究

研究日期：2026-09-25（Asia/Taipei）  
範圍：Pinterest 網站內的 **Save → Annotate** 核心流程；不涵蓋完整 Dashboard、搜尋索引、付費、雲端同步或完整 Extension 架構。

## 1. Executive summary

### 結論

Pin card overlay 與 Pinterest 站內 Inspector 在 Chrome Extension 技術上都可行：content script 可以讀寫目前頁面的 DOM、注入 UI，並透過 Extension messaging / storage 與其他 extension context 共用狀態；content script 預設執行於 isolated world，可避免 JavaScript 命名空間直接衝突，但仍與頁面共用 DOM，因此 Pinterest 改版、惡意或意外的 DOM 內容、以及事件衝突仍是實質風險。[Chrome：Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) [Chrome：Messaging security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#security-considerations)

建議方案：

- Overlay 以 content script 注入，在 Pin 圖片區**左上角**放一個小型獨立按鈕，避開 Pinterest 常見的右上 Save 區；未收藏的 `＋` 在 hover、`focus-within` 或觸控環境顯示，已收藏的 `✓` 保留低干擾常駐標記。精確位置與碰撞規則必須在真實、已登入 Pinterest 的各個 surface 驗證，不能由目前 DOM 推定。
- Canonical key 使用 **Pinterest Pin ID**，但不能只信 address-bar / card URL：先保存當下 permalink ID 為 observed alias，進 detail 後以 `rel=canonical`、`og:url` 與 JSON-LD 的一致結果解析 resolved ID，再做 alias reconciliation；同時保存正規化 canonical URL。Pinterest 官方把 Pin ID 列為全站唯一 ID，Developer Guidelines 也以 `https://www.pinterest.com/pin/424605071126047814/` 作為 Pin 回鏈範例。[Pinterest：Relying on ID fields](https://developers.pinterest.com/docs/key-concepts/best-practices/#Relying%20on%20ID%20fields) [Pinterest：Developer guidelines](https://policy.pinterest.com/en/developer-guidelines)
- Inspector 採用 **isolated-world content script + 單一 Shadow DOM host 的頁內 fixed overlay**。Shadow DOM 提供比一般 injected DOM 更好的樣式邊界；不更改 Pinterest 主內容容器寬度，不假設 Pinterest layout 結構。寬視窗用右側 rail；窄視窗退化為底部 sheet。CSS Shadow Scoping 規範明確定義 shadow tree 的樣式封裝邊界。[CSS Scoping Module](https://drafts.csswg.org/css-scoping/#shadow-encapsulation)
- Inspector 的 active Pin 只跟隨**明確 selection**：點擊 overlay、進入 Pin detail route、或偵測到 close-up modal；不跟隨 hover。新增成功不自動打開 Inspector，以免打斷 discovery；點擊既有的 `✓` 則開啟並聚焦既有 metadata，絕不直接移除。
- SPA 維護採「initial scan + 單一、節流的 MutationObserver + 事件委派 + route / URL 變化訊號 + 低頻 reconciliation」；所有注入以 `data-pinref-*` / host existence 做冪等，Overlay UI 只由 canonical Pin ID 與 shared state 派生。MutationObserver 能觀察 child-list/subtree 變化，但規範本身不替應用保證 selector 或節點身分穩定。[WHATWG DOM：Mutation observers](https://dom.spec.whatwg.org/#mutation-observers)
- 自動在 Pinterest feed 出現的產品體驗，`activeTab` 不足夠：它只在使用者明確觸發 extension 後給目前 tab 暫時權限。需要 Pinterest host access；可在第一次啟用站內功能時，以 `optional_host_permissions` 要求 `https://*.pinterest.com/*`，再用 `scripting` 動態註冊 persistent content script。最小權限建議為 `storage`、`scripting`、Pinterest optional host permission；不需要 `tabs`、`webNavigation`、`sidePanel` 或 `<all_urls>`。[Chrome：activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) [Chrome：optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) [Chrome：dynamic content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#dynamic-declarative)

### 關鍵政策限制

最大的非技術風險是 Pinterest 政策。Pinterest Terms、Community Guidelines 與 Developer Guidelines 均禁止未獲允許的自動化 scraping / data extraction，Developer Guidelines 也禁止未授權地複製或仿造 Pinterest UX。即使 PinRef 只在使用者點擊後本地保存 Pin reference，也不能自行斷言一定符合政策；公開發佈前需要對「讀取可見 DOM 並保存 Pin ID/URL/board context」取得 Pinterest 的書面澄清或法律評估。[Pinterest Terms](https://policy.pinterest.com/en/terms-of-service) [Pinterest Community Guidelines](https://policy.pinterest.com/en/community-guidelines#site-security-and-access) [Pinterest Developer Guidelines](https://policy.pinterest.com/en/developer-guidelines)

### 證據標記

- **[來源事實]**：官方文件、規範或政策直接支持。
- **[2026-09-25 觀察]**：對當日 Pinterest 公開、未登入頁面的唯讀觀察；不是穩定 API。
- **[工程推論]**：由來源事實與產品需求推導，必須用下一個 prototype 驗證。

## 2. Pinterest surfaces observed

### 本次可直接觀察的範圍

**[2026-09-25 觀察]** 在未登入的 `pinterest.com`：

- 首頁為行銷 / 登入表面，不是正常 Home feed。
- `/ideas` Explore 頁可看到 category tiles 與一組 image-only Pin buttons；登入 modal 覆蓋頁面並攔截 Pin 開啟。
- 向下移動頁面後可見 Pin 數量增加，符合 lazy / infinite content 的表面特徵。
- 可見 accessibility tree 使用的是語意角色（例如 button、image、dialog），沒有足以承諾為穩定 API 的 Pin card selector。
- 公開 Art category `https://www.pinterest.com/ideas/art/961238559656/` 的 gated cards 當日呈現為 `role=button`，並可見 `data-test-id="gated-pin-rep"` / `gated-pin-image` 與 `i.pinimg.com` `srcset`；但 card subtree 中沒有 Pin permalink / Pin ID。這些 `data-test-id` 是當日非契約性 DOM 證據，不可視為 API；`i.pinimg.com` 圖片 URL 也不可當 identity。
- 公開 Pin detail `https://www.pinterest.com/pin/615233999110252228/` 的 address bar 含 `/pin/<id>/`；頁面另外公開 slugged `rel=canonical`、`og:url`，以及 `SocialMediaPosting` JSON-LD 的 `sharedContent.url` / `mainEntityOfPage`，可交叉驗證 canonical reference。UI 同時提供「Board containing this Pin」連結，證明 board 可作當下 context，但不是必然可得。
- 將 localized URL `https://id.pinterest.com/pin/1017039528330458780/` 作為輸入時，address bar 保留該 localized URL，但 `rel=canonical` / `og:url` 指向另一個 Pin ID `1122100063383240551`。這是 alias、repin 或 canonicalization 差異的實證；實作必須原型驗證並保留 alias，不可只把 address-bar ID 當最終 canonical key。

本次無法在未登入狀態完整觀察 Home feed、Search results、Board page、Related Pins、已登入的 individual Pin、以及 close-up modal 的實際 DOM。以下 surface 支援矩陣因此是 **prototype 驗證計畫**，不是已確認 selector 清單。

| Surface | Overlay 建議 | Inspector active Pin 訊號 | 信心 / 限制 |
|---|---|---|---|
| Home feed | 是；card hover/focus/touch | overlay click；若 card click 進 detail，route 後更新 | 必須真站驗證 card root、Pin link、native controls |
| Search results | 是 | 同 Home feed | 必須驗證 promoted / shopping / video Pin 變體 |
| Board page | 是 | 同 Home feed；board context 可標記為「瀏覽脈絡」 | Board 不應被視為 Pin 的唯一固有屬性 |
| Related Pins | 是 | overlay click 或進 detail | 必須確認 card 結構是否與 feed 共用 |
| Individual Pin page | card overlay 可省略；在主要 Pin 區提供單一 Save/✓ action | address URL + canonical/og/JSON-LD 交叉驗證 | 已觀察到 localized address ID 與 canonical ID 不同；需 alias reconciliation |
| Modal / close-up | 只在 modal 的主要 Pin action 區顯示一次 | modal 內 permalink / 明確 click selection | modal 可能不改 top-level URL，需真站驗證 |
| Infinite / virtualized content | 是；新增 card 才 reconcile | selection 與 DOM node 解耦，以 Pin ID 保存 | node 可能被移除或重用，不可把 Element identity 當 record identity |

### Overlay 位置與可見規則

**[工程推論]** 第一個 prototype 固定測試 card 圖片區左上角、內縮 8–12 CSS px；不要放右上角，因為 Pinterest 的 primary Save control 常出現在該區域，但這一點仍須在真站逐 surface 確認。若偵測到原生可互動元素與 overlay bounding box 重疊，該 card 應停用 overlay 並記錄診斷，而不是蓋住原生控制。

- 未收藏：`＋` 在 `:hover`、`:focus-within`、overlay 自身 focus 時顯示；`pointer: coarse` / touch 時常駐。
- 已收藏：以低對比、可辨識的 `✓` 小 badge 常駐；hover/focus 時提高對比與顯示完整按鈕 affordance。
- `＋` / `✓` 必須是實際 `<button>`，具有動作導向 accessible name；不能只是一個不可聚焦的 icon。
- 放大與窄 viewport 時不以固定像素假設 card 寬度；每次 position reconciliation 讀取實際 card rect。
- 不把 overlay 塞進 Pinterest 的 native Save button，也不改寫其 label、click handler 或 tab order。

WCAG 2.2 的最低 pointer target 為 24×24 CSS px（或符合 spacing 例外），焦點必須可見；hover/focus 產生的內容需可預測、可 dismiss、可 hover 且 persistent。[W3C：Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) [W3C：Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible) [W3C：Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus)

## 3. Pin identification strategy

### Canonical reference

**推薦資料形狀（不是完整 production schema）：**

```text
canonical_key: "pinterest:pin:<numeric-id>"
pin_id: "<numeric-id>"
pinterest_url: "https://www.pinterest.com/pin/<numeric-id>/"
observed_url: "<the actual clicked href>"
alias_pin_ids: ["<ids observed before canonical resolution>"]
board_context: optional observed label/link + confidence/source
identity_status: confirmed | provisional-url | unresolved
```

**[來源事實]** Pinterest 官方文件把 Pin ID 列為全站唯一 ID；官方 Developer Guidelines 的 Pin 回鏈範例使用 `/pin/<numeric-id>/`。[Pinterest：Best practices](https://developers.pinterest.com/docs/key-concepts/best-practices/#Relying%20on%20ID%20fields) [Pinterest：Developer guidelines](https://policy.pinterest.com/en/developer-guidelines#Publishing%20content)

**[工程推論]** 因此識別順序應為：

1. Feed card / modal 先從公開 Pin anchor `href` 解析 numeric permalink ID，存為 `observed alias`；card 沒有 permalink 時不猜。
2. Detail 頁依序讀取 `rel=canonical`、`og:url` 與公開 JSON-LD `SocialMediaPosting` 的 `sharedContent.url` / `mainEntityOfPage`，只在來源彼此一致且 URL 驗證通過時標 `confirmed`。slugged path 解析最後一段的 `--<numeric-id>` 或純 numeric ID。
3. Address-bar `/pin/{id}/` 是有用訊號，但 2026-09-25 實測 localized URL 曾與 canonical/og ID 不同，因此它是 alias，不是無條件最高優先來源。
4. 若 canonical evidence 與 observed alias 不同，保留兩者、把 overlay state 對 resolved canonical key 聚合，並記錄 alias mapping；禁止靜默刪除既有 user metadata。
5. 不使用圖片 CDN URL 作主鍵；同一 Pin 可有多個尺寸 / media rendition，Pinterest 官方 API 文件也把 media image versions 與 Pin `id` 分成不同欄位。[Pinterest：Creating and managing Pins](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/)

### URL 正規化

**[工程推論]** 當 resolved Pin ID 可得時，canonical URL 固定輸出 HTTPS、`www.pinterest.com`、`/pin/{resolved-id}/`，移除 query 與 fragment；同時保留 `observed_url`、observed ID 與 alias mapping 供診斷。這避免 locale host、tracking query、slug 或 route decoration 造成重複 record。真正支援哪些 Pinterest 地區網域是待決策，不應以寬泛 `<all_urls>` 解決。

若只能取得 URL：

- 允許儲存為 `provisional-url`，但 UI 要顯示「已暫存，尚未確認 Pin ID」，不能顯示與 confirmed save 完全相同的 `✓`。
- URL 必須用標準 URL parser，限制 `https:` 與允許的 Pinterest host，拒絕 `javascript:`、`data:`、credentials、未知 origin。
- 下一次進入可辨識 detail route 時嘗試把 provisional record 合併到 Pin ID；合併規則與衝突處理仍是 product/storage open decision。

### Feed card 與 detail 能否得到同一 ID？

官方文件支持 Pin ID 是全站唯一 ID，但不保證網站每個 card DOM 都公開同一欄位，也不保證 address-bar ID 與 detail canonical ID 相同。**這是 prototype 的首要真站假設**：feed card permalink 可先提供 observed ID，detail canonical evidence 用來 resolve / reconcile；若 feed card 沒有 permalink，就不能靠 private React props、混淆 attribute 或 image URL 偽造穩定性。2026-09-25 的 unauthenticated gated category card 就是「有圖片、無 Pin permalink」的退化案例。

### Board context

Pinterest 官方說 Pin 可以被保存到多個 boards，因此 `board` 不是單一 Pin identity 的可靠固有欄位。[Pinterest：Creating and managing Pins](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/#Creating%20and%20managing%20Pins%20and%20boards)

**建議：**

- Board page 上可把目前 board URL/title 記為 `observed board context`。
- Feed/search/related surfaces 若沒有明確 board link，就留空；不要從鄰近文字猜測。
- Pin detail 若顯示 board，也只保存為當下 context，不能宣稱是 Pin 唯一 board。
- 不依賴 Pinterest 的內部 React data、未文件化 DOM attributes、圖片 alt、圖片 URL、creator username 或自然語言 title 作 canonical identity。

## 4. Overlay injection strategy

### 建議架構

1. 使用一個在 Pinterest origin 上執行的 **isolated-world content script**。Content script 可讀寫 standard DOM，且其 JavaScript environment 與 host page 隔離；只有真的需要存取頁面 private runtime state 時才考慮 page-context / MAIN world，而本流程不應需要。[Chrome：Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#work_in_isolated_worlds)
2. Initial scan 只找「包含可解析 Pin permalink 的可見 card candidate」，而不是以混淆 class name 為根。
3. 為每個 candidate 建立單一 `pinref-overlay-host`；host 加 `data-pinref-pin-id`，重掃時先檢查 host 與 ID，做到冪等。
4. Overlay 自己使用 Shadow DOM，將 button styling 與 Pinterest CSS 分隔；host 僅承擔 positioning / stacking context。
5. 以 document-level delegated listener 監測 card 的 focus/click selection，同時把 `＋/✓` 的 pointerdown/click/keydown handler 綁在 overlay button。

### 點擊不應導向 Pin card

**[工程推論]** overlay 最好作為 card root 的 sibling/child overlay，而不是放入 Pinterest 的 anchor 內。按鈕事件在 `pointerdown` 與 `click` 都執行 `preventDefault()` 與 propagation stop，並在 handler 中先解析已綁定的 Pin ID，再做 extension action。Keyboard 以原生 button 的 Enter/Space 行為觸發同一 command。

這仍不是零風險：Pinterest 若在更高祖先的 capture phase 先攔截事件，或 rerender 移除 host，可能造成 navigation。Prototype 必須實測「overlay click 不開 Pin、card click 仍正常、Save 原生按鈕仍正常」。

### 顯示與成功狀態

- `＋` click：進入短暫 `saving`，禁止 double-submit；local write 成功才變 `✓`，並以非阻斷 toast / `aria-live="polite"` 回饋。
- local write 失敗：回復 `＋` 或明確 error badge；不得留下 `✓`。
- `✓` click：開 Inspector 並聚焦該 Pin，**不刪除**。移除必須在 Inspector 內使用明確、有 label 的次要動作並要求確認或 undo。
- 同一 Pin 在多張 card 出現時，所有 overlay 都由同一 `pin_id` state 派生，storage/state update 後一起重繪。

## 5. Inspector presentation options

| 選項 | 跟隨 active Pin / 持續可見 | 版面影響與 viewport | 樣式 / CSP / a11y | 維護與政策風險 | 結論 |
|---|---|---|---|---|---|
| 1. 一般 injected DOM | 可，無額外操作 | fixed overlay 可不改 layout；若硬推 Pinterest root 則高風險 | 易受全域 CSS 污染，也可能污染 Pinterest；isolated JS 不等於 CSS 隔離 | selector/layout 耦合高 | 不採用一般 DOM 作完整 Inspector |
| 2. Shadow DOM injected Inspector | 可；可在 Pinterest route 內保持 | 寬版右 rail overlay；窄版 bottom sheet；不改 Pinterest 主容器寬度 | Shadow tree 有 CSS scoping；仍須自行處理 focus、contrast、z-index、host inherited styles | 中等；仍受 DOM host 與 Pinterest 條款影響 | **推薦 prototype** |
| 3. Chrome Side Panel API | 可透過 messaging；可跨 tab/navigation 保持 | 由 Chrome 佔用側邊空間，不遮頁；不是 Pinterest DOM 的一部分 | 樣式最隔離，extension page 可用 Chrome APIs | 技術維護較低；需 `sidePanel` permission；`open()` 必須由 user action 觸發 | 強 fallback / 可選模式，不是原始體驗首選 |
| 4. Extension popup | 能收到目前 tab 狀態，但失焦即關閉 | 不長駐、不跟隨瀏覽 | 隔離佳 | 編輯 Notes 容易中斷 | 拒絕作 Inspector |
| 5. 獨立 window/tab | 可 messaging，但與 Pin 空間分離 | 不遮頁，卻佔視窗與切換成本 | 隔離佳 | 高操作成本、selection 容易失焦 | 僅作故障 fallback / debug |

Chrome Side Panel API 的官方能力包括 website-specific panel、跨 tab navigation 保持、extension-page API access；但程式化 `sidePanel.open()` 只允許在使用者動作之後呼叫。[Chrome：Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) 這表示它能由 overlay click 開啟，但不能在任意 route change 時自動彈出。它也把 PinRef 放入 Chrome chrome，而不是 Pinterest 內容空間，會損失「目前 Pin 的站內 metadata rail」感。

### 推薦呈現規則

- **寬視窗：** Shadow DOM Inspector fixed 在 viewport 右側，寬度約 320–360 CSS px，使用 overlay，不重新分配 Pinterest 主內容寬度；可關閉。
- **窄視窗 / 高縮放：** 退化為 bottom sheet，限制高度並讓 Note 區內部滾動；不得讓頁面水平 reflow。
- 不以修改 Pinterest root `margin-right`、grid columns、CSS variables 或 class 為 MVP 手段。這些寫法可推動內容，但會綁死 private layout、造成 hydration/rerender 衝突、破壞 sticky/nav/virtualized measurement，且把 Pinterest 改版轉化為 PinRef 的破壞性 layout bug。
- 若 fixed overlay 遮住 Pinterest 重要操作，使用者可關閉；未來可提供 Side Panel mode，但不在這次 prototype 同時實作。

## 6. Recommended interaction flow

### 尚未加入的 Pin

1. card hover、`focus-within` 或觸控 surface 顯示 `＋`。
2. 使用者啟動 `＋`；overlay 阻止 card navigation。
3. 立即解析並驗證 Pin reference，送出單一 `saveReference` command。
4. UI 顯示短暫 saving；local write 成功才切為 `✓`。
5. 顯示短暫、不奪焦的「Saved to PinRef」回饋。
6. Inspector **預設不自動開啟**，使用者繼續 browsing。
7. 第一次成功可顯示一次性提示：「按 ✓ 可加入 Tags / Note」。

風險：從 DOM 得到的 Pin reference 可能在 click 與 write 之間因 card recycling 改變。因此 command 必須帶「在 pointerdown 時已解析的 Pin ID」，並在 click 時確認 overlay host 的 bound ID 沒變。

### 已加入的 Pin

1. `✓` 是「已存在 + 開啟 metadata」而不是 toggle delete。
2. 點擊 `✓`：設定 explicit active Pin、打開 Inspector、把 focus 移到 Inspector heading 或第一個可編輯欄位之前的合理位置；保留返回觸發器的 focus reference。
3. 移除 PinRef record 僅在 Inspector 內提供，與 `✓` 分開，並有 confirmation 或 undo。

這是最不易誤操作的方案：在 rapid discovery 中，反覆點擊同一 spatial control 不會意外刪除資料。

### Pin detail / modal

1. 進入 `/pin/{id}/` detail route：active Pin 切到該 ID。
2. 若 Inspector 已開啟，更新 preview / Tags / Note；若關閉，保持關閉。
3. close-up modal 若可從 modal 內 permalink 得到 ID，以該 ID 更新；modal 關閉時回到先前 explicit selection 或顯示 placeholder。
4. Note / Tags edit 採 optimistic UI，但必須顯示 saving / saved / failed；失敗不能標 saved。
5. 回 feed 後由 shared record state 重繪所有同 ID overlay。

技術風險集中在：modal 可能不改 URL、card/detail DOM shape 不同、SPA render 可能移除 injected host、virtualized node 可能換成另一張 Pin，以及多 tab 的 write ordering。

### Inspector 開啟與 active Pin 規則

優先序：

1. 明確 overlay `＋/✓` click 所選 Pin。
2. 明確 Pin detail route / close-up modal 的 Pin。
3. 使用者在 Inspector 已開啟時 click 普通 card，且 card 可可靠解析 ID；hover 不算。

規則：

- Hover 只控制 overlay visibility，永不改 Inspector 內容。
- `＋` save 不自動開 Inspector；`✓` click 一定開。
- Inspector 開啟時，plain card click 可在 navigation / modal 成功後更新，不需在 pointerdown 時造成跳動。
- 使用者關閉後設 `manualClosed=true`；route change、hover、下一次 `＋` save 都不自動重開；只有明確 `✓` /「Edit in PinRef」命令重開。
- 同一 Pinterest tab 的 route change 保留 open/closed 狀態；active Pin 不可解析時，開啟中的 Inspector 顯示「Select a Pin」placeholder，不自行關閉。
- Inspector header 永遠顯示 Pin preview + canonical reference 摘要，讓使用者知道正在編輯哪一張 Pin。

## 7. SPA and DOM lifecycle strategy

### 推薦 pipeline

1. **Boot / initial load：** `document_idle` 初始化 root observer、delegated events、Inspector host，然後做一次 bounded scan。Chrome 靜態與動態 content script 都支援 `document_idle`；動態註冊預設可跨 session 保留。[Chrome：Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#run_time) [Chrome：Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-RegisteredContentScript)
2. **MutationObserver：** 只觀察 `childList + subtree`；callback 收集 `addedNodes/removedNodes`，以 microtask/`requestAnimationFrame` 合併，不在每個 mutation 做全頁 selector scan。DOM Standard 說 observer callback 會收到一組 mutation records，且 subtree/childList 是明確 options。[WHATWG DOM](https://dom.spec.whatwg.org/#interface-mutationobserver)
3. **Candidate-local scan：** 只掃新增 subtree 中可能含 `/pin/` href 的節點；每批有上限。找不到穩定 root 就不注入。
4. **事件委派：** document-level click/focus listeners 只讀最近 candidate 的 current permalink，避免為每張 Pinterest card 加永久 listener；overlay 自身 handler 仍綁在 shadow UI。
5. **Route：** 每批 DOM mutation、document click、`popstate` 後比較 `location.href`；必要時以短暫、低頻 URL poll 作補償。可選 `chrome.webNavigation.onHistoryStateUpdated` 能收到 history-state URL 更新，但會新增 `webNavigation` permission，第一個 prototype 不需要先採用。[Chrome：webNavigation.onHistoryStateUpdated](https://developer.chrome.com/docs/extensions/reference/api/webNavigation#event-onHistoryStateUpdated)
6. **Reconciliation：** 每 2–5 秒、只在 document visible 且最近有 mutation/scroll 時做低頻 bounded scan，補救漏掉的 rerender；不是持續全頁掃描。

### 冪等、清理與 recycling

- `ensureOverlay(card, pinId)`：host 已存在且 ID 相同則只 render state；ID 不同先 detach 舊 binding，再綁新 ID。
- DOM 移除時不需立即遍歷全部 descendants 清理資料；overlay host 隨 card garbage-collected。若有 ResizeObserver / timers / ports，使用 WeakMap + disconnected check 主動解除。
- Shared metadata 不綁 Element；`Map<pinId, state>` / extension store 才是 source of truth。
- 每次 overlay 顯示與 click 前重新驗證 `href → pinId`，避免 recycled card 顯示前一張的 `✓`。
- Pinterest rerender 移除 host 後，MutationObserver 再次 `ensureOverlay`；host marker 與 shadow host existence 防止重複。
- MutationObserver callback 不讀大量 layout；positioning 批次放到 animation frame，避免 layout thrash。

### Active Pin 變更訊號

可靠度由高到低：

1. detail URL 中的 Pin ID；
2. 使用者明確點的 overlay bound ID；
3. modal 中唯一、可驗證的 Pin permalink；
4. plain card click 的 permalink；
5. 圖片 URL、alt、DOM index（不可作 identity，只能 diagnostic）。

## 8. Required permissions

### 建議的 consent-first manifest 邊界

| 權限 / manifest 能力 | 是否需要 | 理由 |
|---|---|---|
| `optional_host_permissions: ["https://*.pinterest.com/*"]` | **是** | 使用者第一次啟用 Pinterest integration 時授權；之後才能自動在該 origin 注入 |
| `scripting` | **是（若採 optional host + dynamic registration）** | 取得 host grant 後註冊 / 注入 content script；動態註冊可 persistent |
| `storage` | **是** | local metadata、Inspector open preference / fake prototype state、跨 context change event |
| `content_scripts` | 二選一 | 若改成 required host，可靜態宣告並移除 `scripting`；但 install 時就要求 Pinterest access |
| `activeTab` | **否** | 只在 explicit invocation 後暫時授權，不能讓 overlay 在日常 feed 自動出現 |
| `sidePanel` | **否（本 prototype）** | 僅當產品採 Chrome Side Panel 才需要 |
| `webNavigation` | **否（第一階段）** | Mutation / click / URL reconciliation 先足夠；之後有證據再加入 |
| `tabs`、`<all_urls>` | **否** | 超出單一 Pinterest integration 的最小權限 |

Chrome 說 `activeTab` 僅在 extension action、context menu、keyboard shortcut、omnibox 等使用者手勢後授權，且 cross-origin navigation 後撤銷，因此不符合自動 feed overlay。[Chrome：activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) Chrome 也要求使用最窄權限；即使 optional permission 也受 Minimum Permission 原則約束。[Chrome Web Store：User Data FAQ / Minimum Permission](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#minimum-permission)

### 能否延後到第一次啟用才要求 Pinterest permission？

可以。`chrome.permissions` 官方用途就是在 runtime 要求已於 `optional_host_permissions` 宣告的 origin，讓使用者知道原因並只授權必要能力；permission request 應由使用者手勢發起。[Chrome：Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)

建議 onboarding：使用者在 extension action 中點「Enable on Pinterest」→ 顯示為何需要讀寫 `pinterest.com` → request → grant 成功後動態註冊 content script → reload / 立即注入目前 Pinterest tab。

### Content script、page context 與 CSP

- Content script 可直接讀取與修改頁面 DOM；不需要 page-context script。[Chrome：Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- Isolated-world content script 有自己的 extension CSP；若注入 MAIN world，則適用頁面 CSP。這是避免 page-context 的另一理由。[Chrome：Content script CSP](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#content_security_policy)
- 只有在 prototype 證明 canonical Pin ID 完全不出現在公開 URL / DOM、且必須讀 private page runtime 時，才評估最小 MAIN-world bridge；這會擴大安全與 Pinterest 政策風險，不能先假設。

### 安全處理 DOM 與事件

- Pinterest DOM 的文字、URL、attributes 一律視為 untrusted input；用 `textContent` / `innerText` 建 UI，不用 `innerHTML`，URL 經 protocol + host allowlist + Pin path parser。
- Content script 傳給 service worker 的 command 使用固定 schema、有限 action enum、Pin ID 格式驗證與長度上限；service worker 不接受任意 URL fetch/open。Chrome 官方明確要求把 content-script message 視為可能被攻擊者偽造。[Chrome：Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure#use-content-scripts-carefully)
- 不用 `window.postMessage` 作核心 state channel；使用 `chrome.runtime` messaging。若未來不得不與 page world 通訊，驗證 `event.source`、message nonce/type/schema，且頁面送來的資料仍不可信。
- Overlay event 僅在 extension 建立的 shadow button 上接收；command 重新檢查 DOM bound ID。頁面仍可能合成 DOM event，所以不能把 event 的 `isTrusted` 當唯一安全邊界；真正的安全邊界是嚴格 command schema 與只允許本地 PinRef 動作。

### Storage 與即時同步

Chrome `storage.local` 是 extension API、可被所有 extension contexts 使用，並提供 `storage.onChanged`；預設 `storage.local` 也暴露給 content scripts，但可用 `setAccessLevel()` 限制。[Chrome：Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage) [Chrome：Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)

建議 production seam：service worker / trusted extension context 擁有 record writes；content script 發 command、接收 normalized state patch。Prototype 可先以 `storage.local` + `onChanged` 驗證跨 overlay / Inspector / tabs 同步，但要把 last-write-wins 明確標為測試行為，不當成已決策的 conflict policy。

即使資料只存在本機，Chrome Web Store 仍把 clipping/scraping 網站內容、URL / browsing activity 視為 user data handling，要求揭露；Limited Use 也只允許為已清楚揭露的 user-facing single purpose 使用。[Chrome Web Store：User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) [Chrome Web Store：Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

## 9. Accessibility and non-interference requirements

- Overlay 必須是原生 button，可 Tab 到達、Enter/Space 啟動、具 visible focus 與 `aria-label`；icon 不能是唯一 accessible name。
- 最小 target 至少 24×24 CSS px；實作目標可用 32×32，並與 Pinterest 原生 controls 保持間距。[W3C：Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- `＋` 不能 hover-only：keyboard focus 必須揭露它，touch / coarse pointer 必須常駐。
- `✓` 不只靠顏色；icon shape、accessible label 與狀態文字需同時表達 saved。
- Inspector 使用 complementary region / labelled section，不做阻斷 modal；Tab 可進出、Escape 只關閉最上層 PinRef transient UI，不能攔截 Pinterest 全域 Escape（例如 close-up modal）除非 focus 正在 PinRef surface。
- 打開 Inspector 若由 `✓` 明確觸發，可把 focus 移到 Inspector heading 或第一個 edit control；關閉時若原 card 仍存在，回到 trigger，否則回到 document 合理位置。
- `aria-live="polite"` 回報 saving / saved / failed；不要每次 storage reconciliation 重複播報。
- Note save debounce 期間顯示「Saving…」，寫入完成才顯示「Saved」；失敗保留 draft 並提供 Retry。
- Inspector host 只在自身 bounds 接收 pointer events；頁面其餘區域 `pointer-events` 不受影響。
- 不改 Pinterest 既有 DOM role、label、tabindex、focus outline、keyboard listener 或 Save action。
- 在 200% zoom、320 CSS px equivalent、reduced motion、light/dark Pinterest theme、keyboard-only 與 touch emulation 測試。WCAG 要求 keyboard 不被 trap，且 sticky / overlay 不應完全遮蔽 focused component。[W3C：No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap) [W3C：Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum)

## 10. Failure and degradation states

原則：PinRef 失敗時 Pinterest 必須仍可正常使用；只有 local write 成功才顯示 saved；不確定就降級，不猜測。

| 失敗 | UI 顯示 | 可否重試 | Pinterest 可否繼續 | 防止誤認已保存 |
|---|---|---|---|---|
| 無法識別 Pin | 不顯示 `＋`，或 disabled PinRef icon +「Can't identify this Pin」 | card/detail 改變後自動重試；Inspector 可手動 Retry | 是 | 不建立 record、不顯示 `✓` |
| Pinterest DOM 改版 | 只停用受影響 surface；extension action 顯示「Pinterest layout not recognized」 | reload / 新版 extension | 是 | fail closed；不可用圖片 URL 猜 ID |
| Overlay 注入失敗 | 無 overlay；action/popup 顯示 integration health | Reload integration | 是 | 不產生成功 toast |
| Overlay 重複 | 立即 collapse 為單一 host，記錄本地診斷 | 自動 reconciliation | 是 | state 仍按 Pin ID 單一 record |
| card virtualized / recycled | host 在 reconcile 時重新綁；rebind 前暫藏 | 自動 | 是 | click 前重新解析並核對 ID |
| Pin 已刪除 / 私人化 | Inspector 顯示「Pinterest Pin unavailable」但保留 local Tags/Note | Open original / Retry | 是 | 不刪 local metadata、不宣稱 link 可用 |
| Board context 取不到 | Board 欄顯示「Not available」或省略 | 下次 detail / board surface 再補 | 是 | 不猜 board、不阻止 save |
| 本地保存失敗 | overlay error +「Not saved」；Inspector 保留 draft | 明確 Retry | 是 | `✓` 只能在 write success 後出現 |
| 權限被撤銷 | overlay/Inspector 消失；extension action 說明「Pinterest access is off」 | 使用者手勢重新要求 | 是 | 不用 activeTab 偷渡背景行為 |
| 編輯中 active Pin 改變 | 若有未落盤 draft，暫停切換並顯示「Save failed / Retry or discard」；成功落盤才切 | Retry / Discard | 是 | header 固定顯示當前 Pin，不把 draft 套到新 Pin |
| 多 Pinterest tabs 同時寫同一 Pin | 另一 tab 收到 change，若本地無 dirty draft 就套用；有 dirty draft 顯示 conflict banner | Reload latest / keep draft（prototype 可先只記錄） | 是 | 顯示 revision/time，不靜默標 saved |
| Inspector host 被 rerender 移除 | observer 重建 host；open state 留在 extension state | 自動 | 是 | 重建前不丟 draft，恢復後顯示真實 state |
| 只有 provisional URL | `Saved provisionally`，不是標準 `✓` | 進 detail 後 resolve | 是 | 狀態文案/圖示與 confirmed save 不同 |

PinRef 不應把 Pinterest Pin availability 與 local metadata availability綁成同一件事：來源失效時，local Note/Tags 仍是使用者資料。

## 11. Recommended prototype plan

### Prototype 目的

只驗證 Pinterest 真站 integration seam，不建立正式架構：找到 card、注入 `＋/✓`、取得 canonical reference、打開最小 Inspector、經過 SPA/infinite scroll 仍工作、兩者反映同一份假資料 state。

### 要驗證的假設

1. Home、Search、Board、Related feed 的可操作 card 多數能從公開 permalink 取得 observed Pin ID，不需 private React data；detail canonical evidence 能將 alias resolve 到穩定 key。
2. 圖片左上角能放 32×32 overlay，且不遮 Pinterest Save、menu、hover、link、video controls。
3. `preventDefault + propagation stop` 能讓 overlay click 不觸發 card navigation，而 card 其餘位置保持原行為。
4. 一個 bounded MutationObserver + candidate-local scan 可處理 infinite scroll / rerender，且不造成明顯 long task 或 scroll jank。
5. detail route、close-up modal 與 overlay explicit selection 足以穩定決定 active Pin；hover 不參與。
6. Shadow DOM fixed Inspector 在寬 / 窄 viewport 都可用，且不需改 Pinterest layout。
7. `storage.local`（或 prototype in-memory store）的一個 Pin-ID-keyed state 能同步所有同 Pin overlay 與 Inspector；多 tab change 至少可被偵測。

### 最小實驗步驟

1. 建立 unpacked MV3 spike，只包含 Pinterest optional host、`scripting`、`storage` 與一個 content script；不連 API、不抓圖片、不建 DB。
2. 由使用者手勢啟用 Pinterest permission；在真實已登入 Pinterest 的 Home feed 記錄候選 card 的**語意證據**（permalink presence、可見 native controls、bounding boxes），不把 selector 宣告為 API。
3. 對 Home、Search、Board、Related 各抽樣至少 20 張 card，記錄 permalink ID 成功率、重複 Pin、video/promoted/product 變體與 false positive。
4. 注入左上 `＋/✓`，用 keyboard、mouse、touch emulation、200% zoom 測試；逐一驗證 Pin click、Pinterest Save、menu、hover preview 未被破壞。
5. 點 `＋` 取得 Pin ID + canonical URL，寫入最小 fake records；成功後所有同 ID card 變 `✓`。模擬 write failure，確認不顯示 `✓`。
6. 點 `✓` 開 Shadow DOM Inspector，只顯示 preview placeholder、canonical URL、fake Tags、Note textarea、saved time；`＋` save 不自動開。
7. 依序測試 route navigation、browser back/forward、Pin close-up open/close、infinite scroll 100+ cards、rerender、card 移出再回來；紀錄 duplicate host、wrong-state overlay、lost Inspector 次數。
8. 開兩個 Pinterest tabs 對同 ID 修改 fake Note，驗證 change event 能被另一 tab 察覺；不在 prototype 決定最終 merge policy。
9. 用 Chrome Performance panel 記錄 observer callback 次數、scan nodes、long tasks、scroll responsiveness；先定量再決定是否需要 `webNavigation` 或更低頻 reconciliation。

### 通過條件

- 抽樣 card 中 ≥95% 能由可見 permalink / detail URL 得到 numeric Pin ID；0 個圖片 URL 冒充 identity。
- Feed card observed ID 與 detail resolved ID 若相同則直接確認；若不同，能建立可重現的 alias mapping，且 canonical URL 一律指向 resolved ID，不產生重複 metadata record。
- 100+ card、三輪 infinite scroll / route / modal 操作中：0 重複 overlay、0 overlay 指到錯 Pin、0 `✓` 出現在 write failure 後。
- Overlay click 0 次誤觸 card navigation；Pinterest card、Save、menu、keyboard navigation 均可用。
- Inspector 只在 explicit selection/detail 更新，hover 0 次造成內容跳動；header 永遠可辨識 active Pin。
- local fake state update 後，可見的同 ID overlays 與 Inspector 在 200 ms 內一致（不把 200 ms 當 production SLA，只作 prototype gate）。
- observer / reconciliation 不產生可歸因於 PinRef 的 >50 ms long task；scroll 主觀與 Performance trace 均無明顯退化。
- 權限撤銷、unrecognized card、write failure 都 fail closed，Pinterest 本身仍可用。

### 失敗時替代方案

| 假設失敗 | 替代方案 |
|---|---|
| feed 無穩定 permalink / ID | 只在 Pin detail 提供 PinRef Save；feed overlay 延後，不讀 private React state |
| card 內 overlay 事件持續衝突 | 改用 card 外的 viewport portal overlay，依 bounding rect 定位；若仍不穩，退回 detail-only action |
| Shadow Inspector 嚴重遮擋 | 使用者點 `✓` 後開 Chrome Side Panel；接受 browser-chrome 體驗差異 |
| modal 無可靠 ID | modal 期間不自動切，要求點 PinRef action；detail route 才自動切 |
| MutationObserver 負擔過高 | 縮小 observed root、只掃 added subtree、用 IntersectionObserver 限可見 card；必要時加入 `webNavigation` 只補 route signal |
| 多 tab fake state 競態 | prototype 顯示 conflict，不靜默覆蓋；正式 spec 再決定 revision / merge |
| Pinterest 政策無法獲得允許 | 不公開發佈 DOM integration；改成使用者主動在 detail 頁用 extension action 保存 canonical URL，或探索正式 Pinterest API / partner 路徑 |

### 必須在真正 Pinterest 網站進行的實驗

- 所有 card discovery / permalink extraction 成功率。
- Home、Search、Board、Related、detail、modal 的 DOM lifecycle。
- native controls collision、event propagation、keyboard/touch/zoom non-interference。
- React rerender、infinite scroll、virtualization / recycling。
- 版面、z-index、theme、modal、sticky header 與 Inspector 的互動。
- Pinterest permission revoke / restricted site access 行為。

Synthetic fixture 只能測 PinRef state reducer、idempotent injection、URL normalization 與 failure UI；不能證明 Pinterest compatibility。

## 12. Rejected alternatives

- **`activeTab` 作唯一權限：** 每次都需使用者先按 extension，無法自動顯示 feed overlay。[Chrome：activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- **`<all_urls>`：** 違反最小權限與產品單一 Pinterest scope；Chrome Web Store 要求 narrowest permissions。[Chrome Web Store：Minimum Permission](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#minimum-permission)
- **圖片 URL 作主鍵：** media rendition 可變，官方模型把 Pin ID 與 media versions 分離。
- **依賴 Pinterest 混淆 class、React props、內嵌私有 data：** 未文件化、不穩定，也擴大政策與安全風險。
- **固定 interval 全頁重掃：** 容易在 infinite feed 造成不必要成本；僅保留低頻 bounded reconciliation 作保險。
- **改 Pinterest 主 layout 來騰出 Inspector 空間：** 對 private grid / sticky / virtualization 耦合過高。
- **一般 light-DOM Inspector：** CSS collision 面積太大；Shadow DOM 更符合單一 injected surface。
- **Chrome Side Panel 作唯一 Inspector：** 技術更穩但需要明確 user gesture 才能程式化開啟，且失去 Pinterest 站內 rail 的直接感；保留為 fallback。[Chrome：Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- **Popup 作 Inspector：** 不適合持續瀏覽與 Note 編輯。
- **`✓` 再點即刪除：** rapid browsing 下高誤操作；改為開 metadata，刪除移至 Inspector。
- **Hover 驅動 active Pin：** 內容跳動、易把 draft 編到錯 Pin，違反產品核心原則。
- **保存 board 為 Pin 唯一 board：** Pinterest 官方允許 Pin 保存到多個 boards；board 只能是 observed context。
- **使用 Pinterest API 取代本次 DOM prototype：** 官方 API 需要 developer app、approval 與 access token，且目前研究目標是使用者正在瀏覽的網站 surface；API 仍可作未來合規路徑，不是這次 spike 的先決。[Pinterest：Make an API call](https://developers.pinterest.com/docs/getting-started/make-an-api-call/)

## 13. Open product decisions

需要產品負責人決定或正式 spec 補齊：

1. **發佈 / 合規邊界：** 這只是私人 local prototype，還是目標公開上 Chrome Web Store？公開發佈前是否願意取得 Pinterest 書面許可 / 法律審查？
2. **地區網域：** 第一版只支援 `https://*.pinterest.com/*`，還是支援其他 country domains？後者需要明確 allowlist、測試與 permission 文案。
3. **Provisional save：** 只能取得 Pinterest URL、沒有 Pin ID 時，是允許「暫存」還是直接拒絕？本研究建議允許但狀態必須不同。
4. **Inspector responsive breakpoint / 尺寸：** 建議行為已定（寬版 right rail、窄版 bottom sheet），但 production breakpoint、寬度、高度需 prototype 後決定。
5. **第一次 save 後是否出現一次性教學：** 建議不開 Inspector，只顯示 toast + coachmark；需確認是否接受。
6. **Plain card click：** Inspector 已開時，是在 card click 當下切換，還是只在 detail/modal 成功出現後切換？本研究建議後者以降低錯配。
7. **Close / route persistence：** 建議同 tab 保留 open/closed，手動 close 後只由明確 `✓` 重開；是否跨 browser session 保存仍未決。
8. **來源失效時的 local metadata：** 建議保留 Tags/Note 並標 unavailable；何時允許使用者清除 record 需定義。
9. **多 tab conflict：** last-write-wins、revision conflict、field-level merge 或 draft lock 尚未決；prototype 只需偵測，不做正式政策。
10. **Board context 語意：** 是否命名為 `observed_board_context`，以及同一 Pin 在不同 board context 被存取時保留單一 / 最近 / 多筆 observation。
11. **政策允許前的 metadata 上限：** 是否只保存 user-selected Pin ID/URL + user-authored Tags/Note，不保存 Pinterest title/description/creator/board text；本研究強烈建議採最小化。

## 14. Sources

### Chrome Extensions / Chromium 官方

- [Chrome Extensions — Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome Extensions — The activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome Extensions — Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Extensions — Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome Extensions — Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome Extensions — Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [Chrome Extensions — Message passing and security](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome Extensions — Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- [Chrome Extensions — Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome Extensions — webNavigation API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
- [Chrome Extensions — Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome Web Store — User Data FAQ / Minimum Permission](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Chrome Web Store — Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Chrome Web Store — Program Policies](https://developer.chrome.com/docs/webstore/program-policies)

### Pinterest 官方

- [Pinterest Terms of Service](https://policy.pinterest.com/en/terms-of-service)
- [Pinterest Community Guidelines — Site security and access](https://policy.pinterest.com/en/community-guidelines#site-security-and-access)
- [Pinterest Developer Guidelines](https://policy.pinterest.com/en/developer-guidelines)
- [Pinterest Developers — Best practices / Relying on ID fields](https://developers.pinterest.com/docs/key-concepts/best-practices/#Relying%20on%20ID%20fields)
- [Pinterest Developers — Creating and managing Pins and boards](https://developers.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/)
- [Pinterest Developers — Make an API call](https://developers.pinterest.com/docs/getting-started/make-an-api-call/)

### Web standards / accessibility

- [WHATWG DOM Standard — Mutation observers](https://dom.spec.whatwg.org/#mutation-observers)
- [CSS Scoping Module Level 1 — Shadow encapsulation](https://drafts.csswg.org/css-scoping/#shadow-encapsulation)
- [WCAG 2.2 — Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [WCAG 2.2 — Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus)
- [WCAG 2.2 — Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible)
- [WCAG 2.2 — No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap)
- [WCAG 2.2 — Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum)
