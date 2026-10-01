# Pinterest Import：Chrome Web Store 上架可行性

研究日期：2026-09-29（Asia/Taipei）  
決策問題：PinRef 能否把「使用者開啟自己的 Pinterest Saved／Board 頁面後，明確啟動、讀取當下已載入內容、選取後存入本機 Library」做成可送 Chrome Web Store 審核的 Extension？  
研究範圍：Chrome Web Store（CWS）的公開審核規則、資料揭露要求，以及目前已上架 Pinterest extensions 的公開先例。

> 範圍對齊：Pinterest Terms、Developer Guidelines、Pinterest API qualification 與 Pinterest 是否授權此行為，不是本文件的 go/no-go 條件，也不列為上架 blocker。本文件只回答 Google Chrome Web Store 是否存在可行的上架路徑。

本研究不修改 prototype、ADR、Product Design Plan 或 production Extension。

## 判斷標記

- **Confirmed fact**：Chrome 官方文件或目前 CWS listing 直接支持。
- **Inference**：由多項公開證據推導，但 Google 沒有直接對 PinRef 作出判斷。
- **Unknown**：公開資料無法回答。
- **Requires validation**：必須由實際 package、測試或 CWS 個案審核確認。
- **Unsupported**：與 CWS 公開規則明顯不相容，或沒有足夠上架依據。

## 1. Executive conclusion

**Recommendation: Proceed toward Chrome Web Store submission with the narrower, user-initiated flow.**

一句話結論：**有足夠證據支持 PinRef 進行 CWS 上架準備與送審；沒有證據顯示「讀取使用者目前開啟的 Pinterest 頁面、讓使用者選擇後 local-only 保存」會被 CWS 類別性拒絕。**

信心來源有兩層：

1. **Confirmed fact**：Chrome 的公開政策允許 extension 為明確的 user-facing single purpose 存取必要的 website content／browsing activity；要求是最小權限、正確揭露、privacy policy、用途一致與安全處理。Local-only 不免除揭露義務，但也不是禁止條件。[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) [Single-purpose FAQ](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq)
2. **Confirmed fact**：CWS 目前已有多個第三方 Pinterest extensions 公開描述 whole-board scanning、auto-scroll、visible-Pin extraction、選擇、去重、metadata export 或本機 collection，且仍可安裝。所有送交 CWS 的 items 都會經過 automated review，部分會再進 manual review；因此這些 listing 至少證明相鄰功能曾通過 CWS 的發布流程，而不是被功能類別直接排除。[Review process](https://developer.chrome.com/docs/webstore/review-process) [Check review status](https://developer.chrome.com/docs/webstore/check-review)

這不等於保證 PinRef 一定通過。Google 不公開每個 item 的 reviewer rationale、歷次修改要求或是否進入 manual review；實際結果仍取決於 PinRef 最終 manifest、程式行為、listing、privacy disclosures 與 reviewer 可測性是否一致。

開源與上架不衝突。PinRef 可以保留 public source repository，同時把簽署的 Manifest V3 package 送 CWS；開源本身不是豁免，也不是負面條件。

## 2. 已記錄的產品路線

本次研究以以下路線為準：

1. 使用者自行登入 Pinterest，並主動開啟 Saved root 或特定 Board 頁面。
2. 使用者在 PinRef UI 明確啟動 Import；不做排程或無人操作的 background scan。
3. Extension 只讀目前頁面已載入、可識別的 Pin links／IDs 與呈現 Import 選擇所需的 preview metadata。
4. 允許使用者選擇全部目前候選或部分候選；只在選中項目 local commit 成功後建立 Reference。
5. Board name 只作當次 Import session 的暫時 filter／group，不持久化、不搜尋、不持續同步。
6. 不需要 Pinterest API、OAuth、private endpoints、session-cookie reuse 或 Pinterest mutation。
7. Import candidates／importing items 不算 Library；failed items留在 Import session 供 Resume／Retry；依可靠 Pin identity 去重。
8. Extension 公開原始碼，並以 **Chrome Web Store 上架** 作為一般使用者的正式分發路徑；sideload 可保留給開發與測試，但不再是唯一 MVP 路徑。

## 3. CWS reviewability matrix

| PinRef 行為 | CWS 公開規則 | 判斷 | 送審含義 |
|---|---|---|---|
| 使用者按下 Import 後讀取目前 Pinterest 頁面 | Chrome 把 clipping／scraping visited-page content 明列為 handling user data；若為 prominently described 的 user-facing feature，可在必要範圍內使用 browsing activity。 | **Confirmed fact：可申報，不是類別性禁止** | Listing 與 UI 必須直接說明何時讀、讀什麼、為何需要。 |
| Local-only 儲存 Pin URL、preview、Note、Tags | Local-only 仍需揭露 user-data handling，且 handling user data 的產品需提供 privacy policy。 | **Confirmed fact** | 不可因「不上傳 server」就選擇不揭露；應把 local-only 當成資料流限制寫清楚。 |
| 只在 `pinterest.com` 執行 | Extension 必須使用能實作現有功能的最窄 permission；不可以為未來功能先要求更廣權限。 | **Confirmed fact** | 避免 `<all_urls>`；把 host access 限於實際支援的 Pinterest origins。 |
| 使用者明確啟動 Import | Browsing activity 只有在 extension page 與 Store page 都明確呈現的 user-facing feature 所必要時才能收集／使用。 | **Confirmed fact** | 明確 gesture、session 邊界與結果摘要都有利於 reviewer理解。 |
| Import、selection、retry、local Library | Single purpose 可以涵蓋同一 narrow focus area 下多個直接相關功能。 | **Confirmed fact / Inference** | 可將 single purpose 寫成「把使用者選中的 Pinterest saves 匯入本機 reference library」；selection、dedupe、retry、local organization 都直接服務此目的。 |
| 遠端載入或執行 JavaScript | Manifest V3 要求 extension logic 包含在 package 內，禁止 remote-hosted executable code。 | **Confirmed fact** | DOM parser、state machine 與 import logic 都應隨 package 發布；不要下載可執行規則或程式碼。 |
| 登入後頁面才能完整測試 | CWS Dashboard 提供 Test instructions 與必要 credentials 欄位。 | **Confirmed fact** | 提交時提供逐步測試方式；若 reviewer 必須登入才能看到 Saved 頁，準備專用測試帳號或足以重現的測試路徑。[Test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions) |
| 開源 repository | CWS 審查的是 submitted package、metadata 與實際行為；官方政策沒有把 open source 列為免審或禁止。 | **Inference** | Repo 可提高可理解性，但 listing／dashboard disclosures 仍須獨立完整。 |

## 4. 目前已上架的 Pinterest extension 先例

### 這些先例能證明什麼

- **Confirmed fact**：下列頁面是目前公開、可安裝的 CWS listing，且描述了相鄰或更積極的 Pinterest page extraction 行為。
- **Confirmed fact**：CWS 說所有 items 都會經 automated review，部分 items 也會 manual review；updates 也可能被 review。[Review process](https://developer.chrome.com/docs/webstore/review-process)
- **Inference**：這些 listing 的存在是「此功能類別可上架」的強先例，因此 PinRef 值得送審。
- **Unknown**：Google 為何核准每一個版本、是否要求修改、是否人工審核、其實際 code 是否完全符合 listing。公開頁面無法回答，所以不能複製別人的 disclosure 或把 listing 當保證。

### Comparable listings

| Extension | Listing 公開描述 | 與 PinRef 的相似性 | 公開 privacy disclosure | 證據強度 |
|---|---|---|---|---|
| [Pinterest Pins Organizer](https://chromewebstore.google.com/detail/pinterest-pins-organizer/dhgekkjppjaebmkhgeehmocjmljehbjk) | 在 Pinterest organize page 搜尋、auto-scroll、掃描 lazy-loaded Pins、模擬 selection。 | 直接讀 Pinterest DOM並批量選擇；行為比 PinRef「只讀已載入項目」更積極。 | Website content。 | **Strong adjacent precedent** |
| [PinSaver — Pinterest Collection Manager & Downloader](https://chromewebstore.google.com/detail/pinsaver-pinterest-collec/fdhfelhlikpdilmjcoimmicnfghfmmkk) | 從 feed／Pin detail 把內容存入 extension 自己的 custom collections，提供本機 dashboard、search、move與bulk download。 | 最接近 PinRef 的「Pinterest → extension-owned local reference library」。 | Publisher 宣稱不 collect/use data；實際所需權限未公開。 | **Closest product precedent** |
| [PinSaver — Pinterest Downloader](https://chromewebstore.google.com/detail/pinsaver-pinterest-downlo/fbmimnlpflbgajdpiahkbngokipnpbbp) | Listing 直接寫「Scroll, scrape and download」，可備份 entire board、metadata、links與CSV。 | 大量列舉、metadata extraction、local output均比 narrow import 更廣。 | Publisher 宣稱不 collect/use data；完整資料流未知。 | **Strong scope precedent** |
| [Pinterest Downloader — Unpinned](https://chromewebstore.google.com/detail/pinterest-downloader-unpi/nclfapfhhlaanahigidekpnmaefbmokp) | 開啟 board 後由使用者啟動，可處理 50–5,000+ Pins。 | 使用者啟動、whole-board processing、部分資料進產品帳號。 | Personally identifiable information、Website content。 | **Strong scale precedent** |
| [Pinterest Image Downloader](https://chromewebstore.google.com/detail/pinterest-image-downloade/mofllcdceclbcfneekkbiemopmcfoobn) | 從 board page 偵測隨 scroll 載入的新 Pins，下載 images/videos/GIFs。 | current-page scanning與動態 DOM觀察。 | User activity。 | **Strong technical precedent** |
| [Pin Kit — Pinterest Board Downloader](https://chromewebstore.google.com/detail/pin-kit-pinterest-board-d/dadffeljcabienkbcmdakmegmdpfamfm) | Featured；下載 Boards／sections／Pins，含選擇與整批 ZIP/PDF。 | 使用者選擇、board-level extraction、website content handling。 | Location、User activity、Website content。 | **Strong review precedent** |
| [SuperPin — Pinterest Board Downloader + Figma](https://chromewebstore.google.com/detail/superpin-%E2%80%94-pinterest-boar/mnhndgnpahknegbjigjccakhkdaafkbo) | 遍歷 whole board、選擇個別 Pins、duplicate detection、metadata export，並可送往 Figma。 | selection、dedupe、完整 Board processing與第三方 transfer。 | 以 listing 當日公開欄位為準；精確資料流仍需個案查核。 | **Strong feature precedent** |
| [Save to Pinterest](https://chromewebstore.google.com/detail/save-to-pinterest/gpdjojdkbbmdfjfahjcgigfpmkopogic) | Pinterest 官方 extension，從使用者瀏覽頁面挑圖片、顯示 Board picker並存回 Pinterest。 | 證明 CWS接受在 visited page 上由 user gesture 擷取 website content；產品方向相反，故不是 import 的直接先例。 | PII、User activity、Website content。 | **Platform handling precedent** |

### 對「它們如何通過審核」的準確回答

公開證據無法還原個別 reviewer 的思考，因此不能聲稱某個具體技巧「讓它通過」。可以合理歸納的共同 pattern 是：

1. 功能在 listing 中有窄而明確的 single purpose。
2. 使用者知道何時啟動，功能發生在目前 Pinterest page／board。
3. Requested permissions 能直接對應產品功能。
4. Website content、User activity、PII 等依實際 data flow揭露，而不是以 local-only為由省略。
5. 多個第三方 listing 清楚標示不隸屬 Pinterest，降低品牌混淆。

這些是 submission strategy 的證據，不是保證公式。

## 5. 建議的 CWS submission envelope

### Single purpose

建議固定成一句：

> Import user-selected, currently loaded Pinterest saves into a local PinRef reference library.

Selection、duplicate detection、retry/resume、Note／Tags 與 local Library 都應明確描述成此單一目的的直接子功能。不要在同一版本加入無關的通用 scraper、media downloader、Pinterest mutation或跨站追蹤。

### 最小 permissions

最終清單要等 production manifest 才能確認；目前建議邊界是：

- `storage`：只存 PinRef local references、import session與偏好。
- `sidePanel`：若正式產品沿用 Side Panel。
- `scripting`：只在需要由明確 user gesture 注入 scanner 時使用。
- `activeTab`：若能覆蓋一次性掃描，優先於持久 host access。
- `optional_host_permissions`：若 Side Panel 重開或 SPA lifecycle 無法只靠 `activeTab`，再 runtime請求 Pinterest-only origins。
- 不要求 `cookies`、`webRequest`、`downloads`、history、`<all_urls>` 或不相干的 tabs access。

`activeTab` 在使用者 gesture 後提供目前 tab 的暫時 host access；同源 navigation可保留，跨源 navigation或 tab關閉會撤銷。[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) 因 Side Panel 的 gesture與重連行為仍需實測，這不是已確定的最終 manifest。

**Requires validation**：prototype 不能證明 production 所需 permission set；送審前應以最終 build 做 permission audit，確認每一項都有可測、已上線的必要功能。

### Privacy disclosure

Chrome 把「擷取使用者造訪網站的內容」和 URLs／website content 視為 user-data handling；即使資料只留在裝置上也必須揭露。[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

PinRef 應保守揭露：

| 資料 | 建議 CWS 類別 | 使用方式 |
|---|---|---|
| Pinterest Pin URLs／IDs | Website content；可能同時構成 web browsing activity | candidate identity、dedupe、Open original、local Reference。 |
| Pin preview、title／description | Website content；可能含 user-generated content | selection與 local preview。 |
| Board name | Website content／user-generated content | 只在 active Import session暫時分組，不持久化。 |
| User selections、Note、Tags | User-generated content／form data | local Reference metadata。 |
| Import state與 timestamps | 由上述資料衍生的 operational data | Resume、Retry與結果摘要。 |

Privacy policy與 Store disclosures應明寫：

- 何時開始讀取 Pinterest page。
- 讀取哪些欄位、哪些只在 session記憶體存在、哪些會 local commit。
- 不傳送 Pin content、Board name、Note、Tags或 Import session到 PinRef server（只要產品事實確實如此）。
- 使用者如何刪除 local References／session data。
- 不販售、不作廣告、不用於與 single purpose無關的用途。

不要直接抄用競品的「不收集資料」宣稱；Chrome 明確把 local processing 也算 handling，PinRef 應依自己的實際 data flow完整揭露。

### Reviewer testability

CWS Dashboard 可提交 Test instructions 與 credentials。[Test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions) 建議提交包附上：

1. 從乾淨 Chrome profile 安裝後的精確步驟。
2. 開啟 Pinterest Saved／Board、啟動 Import、選擇、commit、duplicate、failed retry 的預期結果。
3. 若登入是必要條件，提供 reviewer 專用測試帳號或不暴露私人資料的替代測試路徑。
4. 列出每項 permission 對應的可觀察功能。
5. 指向公開 privacy policy與 source repository；repo tag應對應 submitted version。

## 6. Chrome privacy與資料邊界

### Confirmed facts

- Local-only 仍屬 user-data handling，仍需 privacy policy與正確 disclosures。[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- 使用 browsing activity只可服務 Store page與產品 UI 中 prominently described 的 user-facing feature。[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- Extension 必須只要求完成現有功能所需的最窄 permissions；optional permissions也受相同要求。[User Data FAQ — Minimum Permission](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq#minimum-permission)
- Submitted package必須符合 Manifest V3 的 remote-code規則。[Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- CWS 禁止誤導性的官方關係或 endorsement 宣稱。[Impersonation and intellectual property](https://developer.chrome.com/docs/webstore/program-policies/policies#impersonation-intellectual-property)

### Inference

PinRef 的 local-first flow 比會把 Pinterest內容上傳服務器、建立帳號、追蹤跨站行為或索取 cookies 的方案更容易形成清楚、最小且可驗證的 disclosure。這提升可審核性，但不是自動核准。

### Unknown / Requires validation

- `activeTab` 是否足以支援 Pinterest SPA navigation與 Side Panel reconnect；若不足，必須說明為何需要 Pinterest-only optional host permission。
- Google 是否會把 Pin URL 同時要求申報為 Website content與 User activity；最安全做法是以真實 data flow保守揭露並在 dashboard解釋。
- Reviewer 是否接受需要登入 Pinterest 的測試流程；需透過 test instructions／credentials與實際 review確認。
- 個別 reviewer是否要求額外 in-product disclosure或 permission調整。

## 7. Risks and unknowns（只限上架）

1. **Disclosure mismatch**：程式讀到的資料、Dashboard checkbox、privacy policy與 Store listing不一致，是最直接的審核風險。
2. **Permission breadth**：`<all_urls>`、cookies、webRequest或未被現有功能使用的 permissions會增加審核風險與時間。
3. **Reviewer無法重現**：登入限制、空的 Saved account、地區／locale差異或不清楚的操作步驟可能造成 rejection或來回詢問。
4. **Remote-code誤判**：若 scanner rules或 executable logic從遠端更新，可能碰到 Manifest V3 remote-hosted code限制。
5. **Brand confusion**：名稱、圖示與文案不應暗示 Pinterest 官方出品；第三方 listing普遍使用 non-affiliation聲明，PinRef也應採用。
6. **Competitor evidence limit**：現存 listing證明類別可審核，不證明所有競品都持續合規，也不保證 PinRef 個案通過。
7. **Policy change**：正式提交前需重查當時 CWS policies與Dashboard欄位；研究日的結論不是永久保證。

## 8. MVP recommendation

| 選項 | 判斷 |
|---|---|
| Ship as originally broad「同步全部既有 saves」 | **No**。不是因為 CWS 類別性禁止，而是產品宣稱會超過 visible／loaded scan可驗證的能力。 |
| Ship with the recorded narrower flow | **Recommended**。公開原始碼、user-initiated、Pinterest-only、currently-loaded candidates、partial selection、local-only commit，並準備 CWS submission。 |
| Defer from MVP | 只有在 production permission audit顯示必須索取過廣權限，或 reviewer無法測試核心流程時才考慮。 |
| Do not pursue | 目前沒有足夠 CWS 證據支持此結論。 |

**CWS go/no-go：Go to submission preparation。** 不需要先取得「相同產品已核准」的確定證明；現有相鄰 listings 已足以排除「功能類別根本不能上架」的假設。實際 submission outcome仍是 **Requires validation**。

## 9. 對現有產品決策與 ADR 0004 的影響

本研究不直接修改 ADR。

### Supported

- Import 由使用者明確啟動，與 background browsing collection切開。
- 使用者可部分選擇；candidate／importing不算 Library，local commit後才建立 Reference。
- Board只作 session filter，不持久化、不搜尋、不同步。
- 失敗項目留在 Import session做 Resume／Retry，不進 Needs Attention。
- Pinterest原生 Save仍是日常 Capture入口；Import是明確啟動的例外。
- Open-source 與 local-first 可以保留，並與 CWS distribution並存。

### 需要改變或重新確認

1. **Distribution decision**：把「MVP不上 CWS、只 sideload」改為「公開原始碼並準備 CWS submission；sideload保留給開發測試」。
2. **Import promise**：不要在未驗證前承諾「同步全部 saves」；CWS listing應準確寫成 currently loaded／detected items，或依最終實作寫出能被 reviewer重現的範圍。
3. **Data disclosure**：Local-only不等於不處理 user data；產品、privacy policy與 CWS Dashboard必須使用一致說法。
4. **Permission budget**：正式實作前先固定必要 permissions；若後續功能要求 cookies、network interception或 all-sites access，需重新做上架風險評估。

## 10. 下一個產品訪談只需決定的問題

回到 `/grill-with-docs` 時，只需針對新揭露的上架決策：

1. MVP 的公開承諾是「目前已載入的 saves」，還是要實作使用者手動滾動後可重掃的明確流程？
2. 先以 Saved root、單一 Board，或兩者作 CWS reviewer的 canonical test path？
3. 若 `activeTab` 不足，是否接受 Pinterest-only persistent host permission？
4. Privacy disclosure是否明確承認 local handling Website content／User activity，而不是宣稱「完全不收集資料」？
5. 誰提供與維護 reviewer測試帳號、privacy policy URL與 tagged source release？

## 11. Sources

### Chrome official policy and review documentation

- [Chrome Web Store — Program Policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Chrome Web Store — Review process](https://developer.chrome.com/docs/webstore/review-process)
- [Chrome Web Store — Check review status](https://developer.chrome.com/docs/webstore/check-review)
- [Chrome Web Store — Publish an item](https://developer.chrome.com/docs/webstore/publish/)
- [Chrome Web Store — Test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)
- [Chrome Web Store — Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
- [Chrome Web Store — Single-purpose quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq)
- [Chrome Web Store — Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [Chrome Web Store — User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Chrome Web Store — Privacy Policies](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [Chrome Web Store — Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Chrome Extensions — activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome Extensions — Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)

### Current Chrome Web Store listings

- [Save to Pinterest](https://chromewebstore.google.com/detail/save-to-pinterest/gpdjojdkbbmdfjfahjcgigfpmkopogic)
- [Pinterest Pins Organizer](https://chromewebstore.google.com/detail/pinterest-pins-organizer/dhgekkjppjaebmkhgeehmocjmljehbjk)
- [PinSaver — Pinterest Collection Manager & Downloader](https://chromewebstore.google.com/detail/pinsaver-pinterest-collec/fdhfelhlikpdilmjcoimmicnfghfmmkk)
- [PinSaver — Pinterest Downloader](https://chromewebstore.google.com/detail/pinsaver-pinterest-downlo/fbmimnlpflbgajdpiahkbngokipnpbbp)
- [Pinterest Downloader — Unpinned](https://chromewebstore.google.com/detail/pinterest-downloader-unpi/nclfapfhhlaanahigidekpnmaefbmokp)
- [Pinterest Image Downloader](https://chromewebstore.google.com/detail/pinterest-image-downloade/mofllcdceclbcfneekkbiemopmcfoobn)
- [Pin Kit — Pinterest Board Downloader](https://chromewebstore.google.com/detail/pin-kit-pinterest-board-d/dadffeljcabienkbcmdakmegmdpfamfm)
- [SuperPin — Pinterest Board Downloader + Figma](https://chromewebstore.google.com/detail/superpin-%E2%80%94-pinterest-boar/mnhndgnpahknegbjigjccakhkdaafkbo)
