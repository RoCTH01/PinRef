const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("MV3 Import extension keeps Pinterest host access optional and exposes a native Side Panel", () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  const background = read("extension/background.js");
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*.pinterest.com/*"]);
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(fs.existsSync(path.join(root, "extension", manifest.side_panel.default_path)));
  assert.equal(manifest.action.default_popup, undefined);
  assert.doesNotMatch(background, /focusDashboard|chrome\.windows\.update/);
  assert.match(background, /chrome\.windows\.onFocusChanged/);
});

test("production scanner fails closed around one trusted Pinterest collection list", () => {
  const source = read("extension/content/import-scanner.js");
  assert.match(source, /trustedList/);
  assert.match(source, /role=.?list/);
  assert.match(source, /trustedList\.contains/);
  assert.match(source, /trustedList\.isConnected/);
  assert.match(source, /surfaceKeyForUrl/);
  assert.match(source, /topStableRounds/);
  assert.match(source, /seekTopRounds >= 8/);
  assert.match(source, /atBottom && !grew/);
  assert.match(source, /current\.seen/);
  assert.match(source, /document\.visibilityState/);
  assert.match(source, /role=.listitem/);
  assert.match(source, /END_UNCONFIRMED/);
  assert.doesNotMatch(source, /boardContext|document\.cookie|fetch\(/);
});

test("candidate review lives in the Side Panel while Dashboard only gives import guidance", () => {
  const html = read("extension/sidepanel/index.html");
  const css = read("extension/dashboard/dashboard.css");
  const source = read("extension/sidepanel/panel.js");
  assert.match(html, /id="panel-content"/);
  assert.match(css, /\.library-sidebar/);
  assert.match(css, /\.import-candidates/);
  assert.match(css, /@media \(max-width: ?900px\)/);
  assert.doesNotMatch(read("extension/dashboard/dashboard.js"), /pinref:importCommand/);
  for (const disclosure of ["automatically scroll", "temporary", "does not modify Pinterest", "revocable"]) assert.match(source, new RegExp(disclosure, "i"));
  assert.match(html, /not affiliated with Pinterest/i);
  assert.equal(fs.existsSync(path.join(root, "extension/import.html")), false);
});
