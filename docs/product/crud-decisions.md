# PinRef CRUD 產品決策

狀態：產品與 UI UX 決策已確認  
最後更新：2026-10-03  
範圍：Pinterest 原生操作、PinRef Browser Side Panel、PinRef Dashboard、多個 Pinterest tabs，以及三者共用的 local-first Library。本文件只定義產品行為，不指定 production Extension 架構。

## 產品邊界

Pinterest 負責 discovery、原生 Save、Boards 與來源可用性。PinRef 負責 References、Tags、Notes、搜尋、Trash、Import sessions 與本地復原。PinRef 是與 Pinterest 連結、但不做破壞性鏡像的個人 reference library。

核心循環為：

**Discover → Pinterest Save → PinRef Capture → Annotate → Retrieve → Explore again**

日常瀏覽中，Pinterest 原生 Save 是唯一的自動 Capture 入口。PinRef 不注入 Add overlay，Side Panel 也不提供 Add to PinRef。既有 Pinterest saves 經由 Side Panel 中明確、可跳過的 Import flow 納入；首次與後續 Import 使用同一入口，來源就是目前開啟的 Pinterest collection。

## 共用語言

| 名稱 | 定義 |
|---|---|
| Capture Attempt | 由 Pinterest 原生 Save 啟動、可重試的暫時流程。它不是 Reference，也不計入 Library。 |
| Reference | 由已確認的 Capture Attempt 或明確 Import 建立，且已完成本地 commit 的 PinRef Library item。 |
| Context Pin | 在單一 Pinterest tab 中，由明確 route、close-up 或原生 Save 行為建立的可辨識 Pin。 |
| PinRef 收錄狀態 | 一張 Pin 目前是 Not in PinRef、In PinRef 或 In Trash。 |
| Reference Name | Reference 可選、使用者可編輯的名稱；空白時顯示 Pin ID。只是 PinRef metadata，不改 Pinterest。 |
| Pinterest Link Status | Context Pin 當下觀察到的 Pinterest Saved、Not saved、Unavailable 或 Unknown；只用於說明 Not in PinRef 的下一步，不再對 Reference 顯示或更新（ADR-0015）。 |
| Inspector | PinRef 唯一的詳細／操作介面；在 Pinterest 顯示 This Pin 或 Import，在 Dashboard 顯示目前選取並提供完整 Library 管理。Chrome Side Panel 只是承載它的容器。 |
| Inspector Placement | Docked（在 Chrome Side Panel 中）或 Floating（浮在 Dashboard 上）。關閉不改 placement，下次以原 placement 開啟。 |
| Needs Attention | 收納 identity 已知、但尚未確認或 local write 失敗之 Capture Attempts 的 Dashboard 頁面。 |
| Bootstrap Import | 使用者在 Side Panel 掃描目前 Pinterest collection、選擇既有 saves 的可跳過流程；之後可重新執行 Import from Pinterest。 |

## 2026-10-01 修訂：單一 Inspector 與 Note 自動儲存

本節優先於本文件中較早的相關描述（ADR-0013、ADR-0014）。

- PinRef 只有一個 Inspector。文中「Side Panel」指 Pinterest 上的 Docked Inspector；Chrome Side Panel 只是容器。
- Inspector 依使用者所在位置呈現：Pinterest 上是 This Pin 或 Import，維持 Pinterest 限制；Dashboard 上是目前選取，具完整 Library 管理。
- Inspector Placement：Pinterest 上永遠 Docked。從 Pinterest Inspector 進入 Dashboard 時保持 Docked。Dashboard 可切成 Floating（關閉 Side Panel）或關閉 Inspector；關閉保留 placement，再點 Pin 或按 extension 按鈕時以原 placement 開啟。Floating 時手動打開 Side Panel 視為切回 Docked。Dashboard 不再有頁面內 Docked 版面。
- Note 編輯即儲存，沒有使用者可見的草稿：只顯示 Saving、Saved、Save failed（Retry）。同一 Note 同時編輯時以最後 commit 為準。下文的 Local Draft、Unsaved changes、Discard、Updated elsewhere 與 Use my draft 等 Note 行為由此取代。

## 介面責任

| 介面 | 責任 | 明確排除 |
|---|---|---|
| Pinterest | Discovery、原生 Save、Boards 與來源 UI | PinRef 不取代或覆蓋原生 controls。 |
| Inspector（Pinterest，Docked） | 情境狀態、Reference Name、Tag assignment、Note、低摩擦 Tag rename，以及完整 Bootstrap Import lifecycle | 不提供任意單張 Pin 的 Add、Trash、Restore、Permanent Delete、Merge、Global Delete 或 Board management。 |
| Inspector（Dashboard，Docked 或 Floating） | 目前 Dashboard 選取的 single／multi-selection、Tags、Note，以及 Dashboard 的完整 Library 管理，包括 Trash、Merge 與 Global Delete | 不執行 Import。 |
| Dashboard | 完整 Library、搜尋、selection、Tag management、Capture recovery、Trash、Restore 與 Permanent Delete | 不執行 Import 或選擇其來源，不改動 Pinterest Save 或 Boards。 |

### Prototype 與 production 結合（2026-10-01 確認）

兩個 prototype 的使用者功能完整接到同一個 Local-first Library，Dashboard 高度還原 Contact Sheet、Sidebar、Gallery、Inspector、Tag picker、搜尋、排序、Masonry／Waterfall、responsive drawer／bottom sheet；Side Panel 同時提供 This Pin 與 Import。這是完整產品驗收目標，不以唯讀 Inspector 或僅有視覺外殼視為完成。Prototype 的示範 References、固定數字、測試用 Save 結果控制、debug state 與 placeholder 捐款入口不進正式介面。

Side Panel 不提供 This Pin／Import 手動 tab。Pinterest Home 與單張 Pin 顯示 This Pin，Saved Pins／Board 顯示 Import，其餘頁面顯示待機引導；明確選擇未完成 Import Session 可進入其 review，未完成 Session 入口在各狀態保持可見。換頁後介面回到新頁面的狀態，但不改綁舊 session 或清除其選取。Side Panel 沿用 Dashboard Docked Inspector 的標題、預覽、metadata、Note／Tag 編輯與空狀態視覺語言；Import 的掃描與選取控制保持明確。掃描中執行 Pinterest 原生 Save 會暫停掃描並保留 Partial，優先顯示 Capture Attempt；同一 Pin 經 Capture 與 Import 只可形成一筆 Reference。掃描中從 Side Panel 開 Dashboard，須先提示將暫停掃描，確認後保留 Partial 供回原 tab／surface Resume。

Import 結果的 View Library 開啟全部 All Pins，依實際加入 PinRef 的時間把最新 References 排在前面，不自動選圖或開 Inspector。Dashboard 搜尋或 Tag filter 改變時，保護原 Reference 的 Local Draft 後清除 Gallery 選取；排序或 Masonry／Waterfall 切換保留選取。Waterfall 在左側 Sidebar 開關時保持 Gallery 欄寬與捲動位置，避免圖片垂直跳位。Light／Dark theme 在 Side Panel 與 Dashboard 共用；布局偏好跨 Dashboard 重開保留，Gallery 選取與正在檢視的 Pin 不跨重開保留。編輯操作採本文件及 ADR 的 stable Tag ID、Tag Assignment、Local Draft、autosave、revision 與 conflict 行為，不沿用 prototype 的 in-memory shortcut。

## Create

### Reference 建立邊界

| 項目 | 決策 |
|---|---|
| 使用者觸發 | Pinterest 原生 Save，或 Board picker 中最後一次 Save。 |
| Pinterest 畫面 | Saving、成功、取消與失敗都由 Pinterest 呈現。 |
| Side Panel | 依序顯示 Saving on Pinterest、Saving to PinRef；只有完成後才顯示 In PinRef。 |
| Dashboard | local commit 前不出現假卡片；成功後才加入 Library。 |
| 實際資料 | click 只建立 Capture Attempt。Pinterest 確認同一 Pin 且 local write commit 後才建立 Reference。 |
| 成功 | Side Panel 原地轉為 In PinRef，Dashboard 出現同一筆 Reference。 |
| 等待 | attempt 永遠綁定原 Pin，不跟隨新的 Context Pin。 |
| 失敗與復原 | Pinterest 失敗不建 Reference；Pinterest 成功但 local write 失敗則保留可重試 attempt。 |
| MVP | 必要。 |
| Prototype 驗證 | Feed、detail、Board picker、語系、取消、SPA navigation 與 tab closure 的可靠 confirmation。 |

### Pinterest 成功但 PinRef 寫入失敗

| 項目 | 決策 |
|---|---|
| 使用者觸發 | 不要求第二次操作；PinRef 先做有限次背景 retry。 |
| Pinterest 畫面 | 保持 Saved；不要求 Unsave 再 Save。 |
| Side Panel | 顯示 Saved on Pinterest、Couldn't save to PinRef 與 Retry。 |
| Dashboard | Needs Attention 顯示 Retry、Open on Pinterest、Dismiss。 |
| 實際資料 | failed attempt 與 Library 分離。 |
| 成功 | Retry commit 後建立 Reference 並移除 attempt。 |
| 等待 | Saving to PinRef。 |
| 失敗與復原 | attempt 不自動過期，直到成功或使用者在 Dashboard Dismiss。 |
| MVP | 必要。 |
| Prototype 驗證 | Worker restart、storage failure、tab close、browser restart 與 retry idempotency。 |

### Pinterest 結果未確認

| 項目 | 決策 |
|---|---|
| 使用者觸發 | 原生 Save 已啟動，但 PinRef 沒有可靠 completion evidence。 |
| Pinterest 畫面 | 不變；PinRef 不宣稱 Pinterest 失敗。 |
| Side Panel | Save not confirmed，提供 Check again。 |
| Dashboard | identity 已知的 attempt 進 Needs Attention。 |
| 實際資料 | 不建立 Reference。 |
| 成功 | 後續確認成功時，延續原 attempt 進行 local commit。 |
| 等待 | Saving on Pinterest。 |
| 失敗與復原 | Check again、Retry 或 Dashboard Dismiss。 |
| MVP | 必要。 |
| Prototype 驗證 | 成功提示遺失、picker cancel、DOM 變動、route change、timeout 與 resumed check。 |

### Duplicate Save

| 項目 | 決策 |
|---|---|
| 使用者觸發 | 已有 active Reference 的 Pin 再次完成 Pinterest Save。 |
| Pinterest 畫面 | 正常完成原生 Save。 |
| Side Panel | 維持既有 Reference，不顯示新的成功 toast。 |
| Dashboard | 不新增、不重排、不改變 selection。 |
| 實際資料 | Idempotent no-op；added time、Tags、Note、preview 與 updated time 全部不變。 |
| MVP | 必要。 |
| Prototype 驗證 | 多 tab、Board picker 重複與 content script reconnect。 |

### Save 後無法辨識 Pin

| 項目 | 決策 |
|---|---|
| 使用者觸發 | Pinterest Save 已完成，但 PinRef 無法取得可靠 Pin identity。 |
| Pinterest 畫面 | Save 照常；PinRef 不回滾 Pinterest。 |
| Side Panel | Couldn't identify this Pin；Nothing was saved to PinRef。 |
| Dashboard | 不建立匿名 Needs Attention item。 |
| 實際資料 | 不以 page URL 或 image URL 猜 identity，也不建立 Reference。 |
| MVP | 必要。 |
| Prototype 驗證 | Feed、modal、detail 與 localized URL。 |

## 既有 Pinterest saves 的 Import

2026-09-30 修訂：以 Side Panel 取代 Dashboard 擁有首次與後續 Import。使用者直接在 Pinterest 看見來源，避免跨 workspace 選 tab 時混淆 Board 與單張 Pin。這次變更移動流程責任，不擴大到單張 Pin 的任意 Add。

來源辨識：Saved Pins `/<account>/_pins/`、具體 Board、單張 Pin `/pin/<id>/`、unsupported page 必須明確區分。只有前兩者可開始 collection scan；單張 Pin 顯示 Context Pin 與開啟 collection 的引導，`/<account>/_boards/`、Home／Search／ambiguous page 不可啟動。Start 之前顯示來源類型與 URL；Board 名稱只有經目前來源驗證後才顯示，browser tab title 不作為名稱或 Pin 數。scan 中來源不得隨頁面切換而改寫。非 Pinterest 頁面點 extension 仍可開 Side Panel 空狀態，提示先前往 Pinterest。

| 項目 | 決策 |
|---|---|
| 使用者觸發 | 在 Pinterest 點擊 extension 開啟 Side Panel；首次可跳過 Bootstrap Import，之後仍在 Side Panel 執行 Import from Pinterest。 |
| 名稱與語意 | 這是可重複的 Import，不是 account-wide Sync、背景鏡像或 Pinterest Status Reconciliation。 |
| Pinterest 畫面 | 使用者先開啟一個 Saved root／All Pins或Board surface；PinRef可在明確Start後將該tab帶到前景並自動捲動，但不執行Save、Unsave或Board mutation。 |
| Side Panel | 顯示目前 active tab 的類型與 URL；Saved Pins／Board 可明確 Start，並在 panel 內完成 scan、review、Select all new、Deselect all new、部分選擇、commit、Retry、結果與 Done／Dismiss。候選預設不選；缺少 access 時由 Start／Resume 帶出權限請求，成功後接續原操作。 |
| Dashboard | 管理已 commit 的 Library；Import 說明只引導使用者開啟目標 Pinterest collection 與 Side Panel，不提供 tab picker，不啟動 scan，scan 結束也不自動切回 Dashboard。 |
| Scan ownership | 每個 browser profile 同時只有一個 active scan。Start 綁定目前 tab 與 surface；面板在開始前及掃描中提示不要切 tab 或改變集合頁。navigation（含 Pin close-up）、tab switch／close、window focus loss、panel closure、Cancel 或 permission revocation 都保留 Partial。操作同視窗 Side Panel 本身不算離開來源。重開 panel 不自動 Resume。 |
| Surface範圍 | Saved root／All Pins與單一Board是分開的sessions；不靜默跨Boards做account-wide crawl。若Saved root不可靠但Board可靠，MVP收窄為Board-only。 |
| Board | 只能在unfinished Import session作暫時分組或filter，可隨resumable session跨restart保存；Complete或Dismiss即丟棄，不進Reference、Library或Search。Secret與collaborative Board適用同一規則。 |
| Candidate | 只接受可靠Pin identity；無法確認identity的觀察項目直接skip並計數，不建立URL-only candidate或匿名failure。Review預設不選，使用者可選`Select all new`或部分項目。 |
| 實際資料 | 使用者選中的candidate完成local commit後才成為Reference；scan-time可靠identity已足夠，不在commit前重新向Pinterest確認。 |
| Resume | 原 tab 與 surface 必須在前景；不信任 scroll position 或 DOM node，從頂端重掃並依 Pin identity 合併。切 tab 不改寫 session 來源，review 始終標示原來源。 |
| 原 tab 已關閉 | 同 URL 的新 tab 不接管舊 session，也不可對舊 session Resume；舊候選仍可 review／匯入。新 tab 的掃描建立另一個 Import Session。 |
| 多個未完成 session | Side Panel 列出來源、狀態與候選數。切換清單只改變正在查看的 session，不開始掃描或更改綁定。切到別的 Pinterest 頁面仍可 review 舊 session 的候選，面板必須明示原來源。 |
| Side Panel 自動狀態 | Saved Pins／Board 呈現 Import 並優先呈現與 active tab 及確切 collection surface 相符的未完成 session；Pinterest Home／單張 Pin 呈現 This Pin；其餘頁面呈現待機引導。換頁即更新狀態，明確選取的 session 仍可找回且不改綁來源或選取；不得自動 Start 或 Resume。 |
| Partial review 後補掃 | 在 local Import selected 尚未開始前，可回原 tab／surface Resume；既有選取依 Pin ID 保留，新候選預設不選。開始 local write 後同 session 不再補掃。 |
| 主動停止 | 掃描中提供 Stop & review，一步停止 auto-scroll、保留已觀察候選並進入標示 Partial 的 review，不宣稱已掃完整集合。 |
| 寫入中關閉面板 | 已確認的 candidate 集合繼續逐筆 commit，結果逐筆保存；重開面板可看成功、duplicate 與可 Retry 的 failure。worker interruption 不得丟失未解決項目或重複建立 Reference。 |
| Library 狀態變化 | 每筆 local commit 前重新檢查 active Reference／Trash；已收錄變 Duplicate，已進 Trash 變 In Trash，都不建立第二筆或自動 Restore。 |
| Review 時切頁 | 未提交選取留在原 Import Session，仍標示原來源；active Pinterest 頁面變化不清空選取或改綁 session。 |
| 第二個掃描 | 正在掃描別的來源時不得自動取代；面板標明目前 active session，使用者明確 Stop & review／暫停後才能 Start 新 scan。 |
| 寫入中撤銷權限 | 已確認的本機 commit 繼續；權限撤銷停止 active scan，且在重新取得必要 access 前不能 Resume。 |
| 0 個可靠候選 | 即使只有無法確認 identity 的 skipped items，仍顯示 Partial review 與 observed／skipped 摘要；可在原來源 Resume 或明確 Dismiss，0 不代表掃描完成。 |
| 全是 Duplicate／In Trash | 無可選的新候選時可直接 Done，不需要執行空的 Import selected。 |
| 部分選取後 Done | 選中的項目已解決且沒有 failure 時可 Done；面板先說明未選 candidates 與 temporary Board context 將清除，已 commit References 保留。不按 Done、只離開面板則保留 unfinished session。 |
| Duplicate | Active Reference回報duplicate；同session重複觀察合併；Trashed Reference顯示`In Trash`且不可選，Import不自動Restore或建立第二筆。 |
| 完整性 | 只有可靠end-of-surface evidence才能標Complete；heuristic plateau顯示Unable to confirm／Partial並保留Resume或Stop and review。 |
| 成功 | 分別回報 imported、duplicate 與 failed 數量。 |
| 等待 | candidates 與 importing items 不計入 Library。 |
| 失敗與復原 | failed items留在可續跑Import session；不進Needs Attention；支援Retry、Resume、Dismiss。Done在結果確認後清除session candidates與temporary Board context；Dismiss不回滾已成功References。 |
| 時間 | addedToPinRefAt 使用實際 import 時間；拿不到 Pinterest 原始 save time 時不得偽造。lastUsedAt 在匯入時等於 addedToPinRefAt。 |
| 權限與揭露 | 優先用`activeTab`；若不足才在Import時要求Pinterest-only optional host permission。首次Import顯示in-product disclosure；CWS、privacy policy與實際local data handling必須一致。 |
| 分發 | 公開原始碼並以Chrome Web Store作一般使用者正式分發；sideload只供開發、測試與審核期間使用。 |
| MVP | Product requirement，先通過既有Pinterest integration prototype的identity、tab binding、scan lifecycle與state-transition hard gates，再以CWS review作release gate。 |
| Prototype 驗證 | Saved／Board surfaces、auto-scroll與end evidence、tab binding、SPA／tab interruption、Cancel、permission lifecycle、resume-from-top merge、duplicates、Trash、partial／unconfirmed、local-write Retry與single-active-scan isolation。 |

## Read 與 Context

### Context Pin ownership

| 項目 | 決策 |
|---|---|
| 使用者觸發 | 切 tab、進入 Pin detail、開 close-up，或在 feed 執行原生 Save。 |
| Pinterest 畫面 | 正常 navigation 與 Save。 |
| Side Panel | Pin context editor 只顯示 active Pinterest tab 的 Context Pin；Import view 保留明確綁定的 session 來源，不跟隨 Context Pin 自動改綁。 |
| Dashboard | 可收到共享 Library 更新，但不能控制 Side Panel 選到哪一張 Pin。 |
| 實際資料 | Context Pin 是 per-tab ephemeral state；Library 是共享 persistent state。 |
| 優先順序 | 可辨識的 Pin detail 或 close-up，其次為 active tab 中明確發生的原生 Save。 |
| No context | Feed、Search、Board、profile 沒有單一明確 Pin 時清除 context，不保留上一張 editor。 |
| 禁止訊號 | Hover、背景 DOM observation、storage event 與 background tab 都不能選取 Side Panel 內容。 |
| MVP | 必要。 |
| Prototype 驗證 | Feed Save、modal identity、back forward、快速切 tab 與背景 write。 |

### Side Panel primary states

| 狀態 | 呈現 |
|---|---|
| No Context Pin | Open a Pin or use Pinterest Save；永不保留上一張 editor。 |
| Not in PinRef | 唯讀顯示 identity 與 preview；依 Pinterest Link Status 提供下一步。 |
| Capture pending | Saving on Pinterest 或 Saving to PinRef；metadata editor 尚不可用。 |
| Needs attention | Save not confirmed 或 Couldn't save to PinRef，附 recovery action。 |
| Reference available | 顯示 preview、其下的 Name、committed Tags、Note、added time 與 original link。 |
| Identity unavailable | 明確說明無法辨識且 PinRef 沒有寫入任何資料。 |

Not in PinRef 之下：Not saved 引導使用 Pinterest Save；Saved 引導先開啟所需 Board／Saved Pins，再於 Side Panel 執行 collection Import；Unknown 提供 Check again。單張 Pin 頁不能據此猜測所屬 Board、直接 Import 或預選目前 Pin。Import view 與以上六種 Pin context states 分開呈現。

## Update

### Tag assignment 與 Note autosave

| 項目 | Tags | Note |
|---|---|---|
| 使用者觸發 | 選擇、建立、移除或 replace assignment | 輸入文字 |
| Side Panel／Dashboard | pending chip 顯示 Saving；commit 後穩定 | editor 立即顯示 Local Draft；依序顯示 Editing、Saving changes、Changes saved 或 Changes not saved |
| 實際資料 | 每個 assignment mutation 獨立 commit | 短暫停止輸入後 commit；blur、context change、panel close、selection change 時 flush |
| 跨介面 | 只同步 committed assignment；Tag Query 不同步 | 只同步 committed Note；其他介面不看到半完成 draft |
| 失敗與復原 | committed state 不變，保留 Retry intent | 保留 Local Draft，提供 Retry 或 Discard |
| MVP | 必要 | 必要 |
| Prototype 驗證 | 快速 add remove、duplicate、multi-tab create | IME、持續輸入、切 Pin、關閉、suspend、長 Note |

### 切換 Pin 時尚有未完成編輯

| 項目 | 決策 |
|---|---|
| 使用者觸發 | Context Pin、tab、Side Panel 或 Dashboard selection 改變。 |
| Pinterest 畫面 | navigation 永不被阻擋。 |
| Side Panel | 先要求 flush，然後跟隨新 Context Pin；舊 draft 不得帶到新 Pin。 |
| Dashboard | 原 Reference 顯示 Unsaved changes；重新開啟時恢復 draft。 |
| 實際資料 | draft 綁定原 Reference、field 與 base revision。 |
| 成功 | commit 後 indicator 消失。 |
| 等待 | 原 write 可在背景完成。 |
| 失敗與復原 | 回到原 Reference Retry 或 Discard；未 commit draft 不進搜尋。 |
| MVP | 必要。 |
| Prototype 驗證 | 快速 navigation、tab close、browser restart 與多筆 failed drafts。 |

### Concurrent edits

| 項目 | 決策 |
|---|---|
| 使用者觸發 | Side Panel、Dashboard 或多 tabs 同時修改同一 Reference。 |
| Side Panel／Dashboard | clean field 套用新 committed value；dirty same-field 保留 draft 並顯示 Updated elsewhere。 |
| 實際資料 | mutation 攜帶 field-level base revision；不同 fields 合併；不同 Tag operations 合併。 |
| 成功 | 不重寫整筆 Reference。 |
| 等待 | Saving changes。 |
| 衝突與復原 | 同一 Note 顯示 Your draft 與 Latest saved version；提供 Use my draft、Use latest、Continue editing、Copy draft。 |
| MVP | 必要。 |
| Prototype 驗證 | Out-of-order completion、同 Note edits、同 Tag add remove、worker restart 與 tab resume。 |

### No Note

No Note 是單一產品狀態。Never-written、cleared、empty 與 whitespace-only committed Notes 不做區分。清空 editor 仍走正常 autosave；commit 成功前，空白只是一份 Local Draft，舊 committed Note 仍是真實值。MVP 不設獨立 Clear Note action。

### Reference Name

| 項目 | 決策 |
|---|---|
| 使用者觸發 | Inspector（Pinterest 或 Dashboard）single selection 的 Name 欄位，位於 preview 下方。 |
| 呈現 | 未命名時以 Pin ID（`Pin 123…`）作為 placeholder；Note tabs、Note preview、Trash 列表都顯示 Name，空白時顯示 Pin ID。 |
| Commit | Enter 或 blur 時 commit；Escape 還原為已 commit 的 Name。清空即回到 Pin ID。最長 120 字元。 |
| 衝突 | 與 Note 相同，最後一次 commit 為準（ADR-0014）。Trash 或 Permanent Delete 之後的舊 write 以 lifecycle revision 拒絕。 |
| Search | Dashboard main search 也比對 Name 與 Pin ID。 |
| Pinterest 畫面 | 不變；Name 只是 PinRef metadata，不會改 Pinterest 的標題。 |

### Preview Reload 與 Pinterest status check（已移除）

2026-10-01 起，Inspector 不再提供 Reload preview、Check Pinterest status，也不顯示 Reference 的 Pinterest Link Status（ADR-0015）。Reference 只會在確認 Save 或從使用者自己的 Saved Pins／Board Import 後建立，因此不需要再顯示這個狀態。已存的 `linkStatus` 原封保留，不顯示也不刪除。

## Delete

### PinRef-only Trash lifecycle

| 項目 | Move to Trash | Restore | Permanent Delete／Empty Trash |
|---|---|---|---|
| 使用者觸發 | Dashboard 單筆或多筆 Remove | Trash 頁 Restore | Trash 頁明確確認 |
| Pinterest 畫面 | 不變 | 不變 | 不變 |
| Side Panel | In PinRef Trash、唯讀、Manage in Dashboard | 回到 Reference available | 轉為 Not in PinRef |
| Dashboard | 從 active Library 移入 Trash | 回到 Library | 從 Trash 移除 |
| Tags／Note | 完整保留 | 原樣恢復 | 永久移除 |
| addedToPinRefAt | 保留 | 保留，不視為新加入 | 移除 |
| lastUsedAt | 保留 | 保留，不視為剛使用 | 移除 |
| 等待 | Moving to Trash | Restoring | Deleting permanently |
| 失敗 | 留在 Active | 留在 Trash | 未刪成功者留在 Trash並可 retry |
| 復原 | Restore | 再次 Trash | 無法復原 |
| MVP | 必要 | 必要 | 逐筆與 Empty Trash 都必要；Trash 不自動過期 |

Pinterest Unsave、Pin 刪除或私人化都不會自動移動或刪除 Reference。Side Panel 不提供 Trash、Restore 或 Permanent Delete。

Move to Trash 前先 flush pending edits。若仍有 dirty 或 failed draft，Dashboard 提供 Retry saving、Discard unsaved changes and move to Trash、Cancel。Trash commit 後以 lifecycle revision 拒絕晚到的舊 write。

Permanent Delete 不留 blocking tombstone。未來新的有效 Pinterest Save 或明確 Import 可為同一 Pin 建立全新 Reference；它使用新的 added time、空 Tags 與 No Note，不恢復舊 metadata。

## Tags CRUD

### Tag entity 與 assignment

| 項目 | 決策 |
|---|---|
| 資料模型 | Tag 是具有 stable ID、unique normalized name、color、order 的獨立 entity；Tag Assignment 連接 Tag ID 與 Reference ID。 |
| Side Panel | Typeahead assignment、Create and assign、unassign，以及低摩擦 Global Rename。 |
| Dashboard | 完整 Tag catalog、assignment、Merge、Global Delete、color、order、filter 與 multi-select。 |
| Tag Query | 尚未選 option 或確認 Create new 前只是一段 query，不是 Tag。 |
| Empty Tag | 零 assignment Tag 是有效 vocabulary，保留 name、color、order 與 count 0。 |
| 成功 | 所有介面使用同一 committed entity 與 assignments。 |
| 等待 | pending mutation 不先修改正式 counts。 |
| 失敗與復原 | 保留 committed state 與可 retry intent。 |
| MVP | 必要。 |
| Prototype 驗證 | Unicode normalization、case、whitespace、concurrent create 與 string-array migration。 |

### Rename、duplicate 與 Merge

Global Rename 只修改 Tag name；assignments 持續引用 stable Tag ID。Rename 無 confirmation dialog：目前 editor 即時顯示 rename draft，短暫停止輸入後 autosave，Enter 或 blur 時 flush；其他介面只接收 committed name。

若 normalized name 已存在，Rename 停止並提供 Review merge in Dashboard。Merge preview 顯示 source、target、assignment count、overlap，以及 target 保留的屬性。Atomic commit 後 target 保留自己的 ID、name、color、order；source assignments 移到 target、duplicates collapse，source Tag 移除。失敗時完全不改資料。

### Global Delete 與 Undo

Global Delete 只存在 Dashboard。確認畫面顯示受影響 Reference 數量，並 atomic delete Tag entities 與 assignments，不刪 References 或 Notes。

Merge 與 Global Delete 成功後建立短期、version-guarded operation receipt。Undo 必須恢復原 Tag IDs、metadata 與精確 assignments；如果後續 mutation 使自動復原不安全，PinRef 保留現況並說明無法 Undo，不能覆蓋新資料。

## 退化與狀態對帳

### Pinterest Unavailable 或 Unknown

PinRef 不再檢查或對帳 Reference 的 Pinterest 狀態（ADR-0015）。Pinterest 上的 Pin 被刪除、私人化或 Unsave，都不影響 Reference、preview、Tags 與 Note；使用者可自行 Move to Trash。Not in PinRef 的 Context Pin 仍依當下觀察到的 Pinterest Save 狀態提供下一步。

### Resume 與 stale state

| 項目 | 決策 |
|---|---|
| 使用者觸發 | Tab activation、Side Panel reopen、Dashboard focus 或 worker restart。 |
| Side Panel | reconcile active tab，不得改變 Context Pin。 |
| Dashboard | 保留 selection、scroll、focus 與 drafts，只 patch 變更的 committed fields。 |
| 實際資料 | Retry 或 overwrite 前先比對 revisions 與 operation receipts。 |
| Clean state | 靜默套用最新 committed value。 |
| Different-field draft | 套用其他 fields，保留 draft。 |
| Same-field draft | 保留 draft 與最新 committed value，顯示 Updated elsewhere。 |
| Unknown pending result | 先查 operation receipt，不重複 submit。 |
| 無法確認 freshness | 保留畫面並顯示 May be out of date、提供 local-state Refresh。 |
| MVP | 必要。 |
| Prototype 驗證 | Suspend、restart、offline、lost completion、out-of-order response 與 focus preservation。 |

## 共用狀態與回饋

| 狀態軸 | Canonical user-visible states |
|---|---|
| PinRef 收錄狀態 | Not in PinRef；In PinRef；In Trash |
| Capture | Saving on Pinterest；Saving to PinRef；Save not confirmed；Couldn't save to PinRef |
| Pinterest Link（只用於 Not in PinRef 的 Context Pin） | Saved on Pinterest；Not saved on Pinterest；Pinterest Pin unavailable；Pinterest status unknown |
| Metadata Mutation | Editing；Saving changes；Changes saved；Changes not saved；Updated elsewhere；Unsaved changes |
| Import Session | Scanning；Ready to import；Importing；Paused；Import incomplete；Import complete |

Pending 使用現在進行式與 spinner，不顯示 success mark。Success 只有 commit 後才短暫出現。Failure 持續到 Retry、Discard、Dismiss 或問題消失。Unknown 使用中性語氣。Conflict 保存雙方內容。Background success 只更新資料；background failure 綁定原 Reference、Capture Attempt 或 Import session，永不更換 foreground Context Pin。

## Local-first 與未來 sync

MVP 使用同一 browser profile 中由 Pinterest tabs、Side Panel 與 Dashboard 共用的 Local-first Library。它不要求帳號，也不承諾清除 profile、移除 extension 或更換裝置後能自動恢復。Changes saved 只代表 confirmed local commit，不代表 cloud durability。

Cross-device sync 是未來 opt-in 能力。Stable IDs、revisions、operation IDs、timestamps 為未來保留，但 account、encryption、deletion propagation、offline queue、Local Draft、Capture Attempt、Import session 與跨裝置 conflict 都必須另作決策。

## Dashboard 與 Retrieval

### Search

- Main search 搜尋 Reference Name、Pin ID、committed Tag names 與 committed Notes。
- Pinterest Board 永遠不是 PinRef searchable field。
- Search focus 可顯示 Tag recommendations；outside click 關閉 suggestions。
- Tag filters 支援多 Tag；AND、OR、tokenization 留給 search specification。
- Local Draft、Capture Attempt、Import candidate、Trashed Reference 不進一般搜尋。
- Zero-result 保留 query 與 filters，提供調整或清除路徑。
- Open original 回到 Pinterest 繼續 discovery。

### Shared Inspector

- Dashboard 只有一個 Inspector，處理 single 與 multi-selection；沒有獨立 selection toolbar。
- Floating 與 Docked 是 placement，不是不同 detail mode；Docked 位於 Chrome Side Panel，Floating 浮在 Dashboard 上，兩者不會同時出現。
- 切換 Reference 只更新內容，不改 placement。
- Floating 在 selection 清除後關閉；Docked 保留 empty placeholder。關閉 Inspector 不改 placement，下次以原 placement 開啟。
- Single selection 由上而下顯示 preview、editable Name（placeholder 為 Pin ID）、Tags、editable Note、added time、Open original。
- Multi-selection 顯示 stacked thumbnails、count、shared Tag intersection、Note rail。Note 永遠只編輯一筆 active Reference，不 batch overwrite。
- Clear 是 titlebar 上「n selected」旁的低強度 action；Move to Trash 位於 footer，與 View on Pinterest 同列且同樣低調。Note editor 取得彈性垂直空間。

### Reference Use 與 Recently used（ADR-0016）

- Library 的時間分類是 Recently used，依 lastUsedAt 由新到舊排序；All Pins 仍依 addedToPinRefAt 排序。
- 算作 use：指派或移除 Tag、儲存 Note、儲存 Name、在 Inspector 選取、在 Pinterest 成為 Context Pin。
- 不算 use：Trash、Restore、Permanent Delete 等 lifecycle 操作。
- lastUsedAt 只前進，不帶 field revision；同一筆 Reference 一分鐘內重複檢視不寫入。
- Recently used 的排序在進入該分類時定住，切換分類或 Tag filter 才重新讀取，避免點選時 Gallery 在游標下重排。切換新舊方向只是反轉同一份順序。
- 舊資料沒有 lastUsedAt 時沿用 addedToPinRefAt。

### Gallery、Sidebar 與 responsive behavior

- Dashboard 使用 Tags sidebar、image-only Gallery、shared Inspector 的 responsive 三區 workspace。
- Gallery cards 不重複 captions、source text、Tags 或 Notes；metadata 屬於 Search 與 Inspector。
- Masonry 與 Waterfall 是互斥 Gallery layouts。
- Sticky top region 將 centered search 與 sorting、layout controls 分開。
- Tags sidebar 負責完整 Tag management、filter、order、color、selection、Merge 與 Global Delete。
- Needs Attention、Trash 是 Dashboard destinations，但不增加 active Library count。Import from Pinterest 位於 Side Panel，未 commit candidates 不增加 Library count。
- Compact width 時 Sidebar 成為 drawer、Inspector 成為 bottom sheet；Search 依 Gallery 實際可用寬度置中。
- Add Tag picker 在 viewport level render，具 collision detection 與 keyboard access。
- Dragging 不是唯一操作路徑；icon-only controls 有 accessible name、visible focus 與可用 target size。
- Escape 只關閉最上層 PinRef transient surface 並正確返回 focus。
- MVP 只有 Light 與 Dark theme。

## MVP 範圍

Included：

- Confirmed native-Save Capture 與 recovery。
- Per-tab Context Pin isolation 的 Browser Side Panel。
- Shared Local-first Library 與 field-level revision contract。
- Dashboard Library、Needs Attention、Trash 與完整 Tag management；Side Panel 完整 Import lifecycle。
- Optional、repeatable Import from Pinterest；須通過identity、tab binding、scan lifecycle與state-transition prototype gates，並以Chrome Web Store review作release gate。
- Reference Name、Tags、Note autosave、search、filters、multi-selection。
- 共用 pending、success、failure、unknown、conflict、stale feedback。

Excluded：

- PinRef overlay 或 Side Panel Add to PinRef。
- Pinterest Board persistence、search 或 ongoing synchronization。
- Pinterest saved collection 的 automatic full mirror。
- Relink 到另一個 Pin identity。
- Cross-device sync、account requirement 或 cloud durability promise。
- Automatic metadata、visual similarity、Saved Views、batch Note overwrite、其他 reference sources。

## Prototype validation gates

產品語意已確認。進入 production specification 前仍須驗證：

1. Pinterest Save success、cancellation 與同一 Pin identity 的可靠判定。
2. Import from Pinterest 的Board／Saved surface identity、tab binding、auto-scroll、completion evidence、partial／resume與permission lifecycle；Saved root失敗可收窄為Board-only，Board identity失敗則延後Import。
3. SPA navigation 與 background events 下的 per-tab Context Pin isolation。
4. Worker restart 後 Capture Attempts、Local Drafts、revisions、operation receipts 的 durability。
5. Atomic Tag Merge、Global Delete、Undo、Trash、Restore 與 batch partial failure。
6. Pinterest Saved、Not saved、Unavailable、Unknown 的 evidence threshold。
7. Side Panel、Dashboard、dialogs 與 transient feedback 的 accessibility 與 focus behavior。

上述驗證轉化為 measurable acceptance criteria，並確定 storage、permissions、privacy 與Chrome Web Store submission architecture 後，產品即可進入 production CRUD specification。
