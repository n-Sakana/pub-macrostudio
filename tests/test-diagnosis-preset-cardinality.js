"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

var root = path.resolve(__dirname, "..");
var windowObject = {};
var context = vm.createContext({
  window: windowObject,
  document: {
    addEventListener: function () {},
    createElement: function () {
      return {};
    },
    getElementById: function () {
      return null;
    },
    querySelector: function () {
      return null;
    }
  },
  Promise: Promise,
  Uint8Array: Uint8Array,
  Math: Math,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
});
windowObject.window = windowObject;
windowObject.document = context.document;
windowObject.setTimeout = setTimeout;
windowObject.clearTimeout = clearTimeout;
windowObject.console = { error: function () {} };
windowObject.hostBridge = {
  request: function () {
    return Promise.resolve(null);
  },
  on: function () {
    return function () {};
  }
};

["handover.js",
  "diff.js",
  "diff-view.js",
  "vba-highlight.js",
  "preset-document.js",
  "response-package.js",
  "diagnosis-package.js",
  "prompt-template.js",
  "screens.js",
  "state.js",
  "app.js"
].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
    context,
    { filename: name });
});

var app = windowObject.MacroStudioApp;
var presetApi = windowObject.MacroStudioPreset;
var validContent = [
  "# 診断",
  "",
  "## 説明",
  "",
  "事実を監査します。",
  "",
  "## 改修指示",
  "",
  "事実を読んでください。",
  "",
  "## 出力指示",
  "",
  "契約で返してください。"
].join("\n");
var invalidContent = "見出しがありません。";

function preset(file, content) {
  return { file: file, content: content };
}

// There is one diagnosis folder for the whole install and it must hold
// exactly one usable file. The catalog is built the way the host hands
// the folder over.
function catalogWith(diagnose) {
  return presetApi.describeCatalog({
    diagnose: diagnose,
    repair: [preset("02_改修\\01_直す.md", validContent)],
    scope: [preset("03_変更範囲\\01_最小.md", [
      "# 必要最小限",
      "",
      "## 説明",
      "",
      "構成は変えません。",
      "",
      "## 構造変更",
      "",
      "禁止",
      "",
      "## 改修指示",
      "",
      "必要な範囲だけ直してください。"
    ].join("\n"))]
  });
}

function resolve(diagnose) {
  return app.resolveDiagnosisPreset({
    appInfo: {catalog: catalogWith(diagnose)}
  });
}

var file = "01_診断\\one.md";
var none = resolve([]);
var one = resolve([preset(file, validContent)]);
var two = resolve([
  preset(file, validContent),
  preset("01_診断\\two.md", validContent.replace("# 診断", "# 診断2"))
]);
var oneAndBroken = resolve([
  preset(file, validContent),
  preset("01_診断\\broken.md", invalidContent)
]);

assert(
  !none.ok && none.code === "E-PRESET-02" && none.validCount === 0,
  "Zero valid diagnosis presets must stop with E-PRESET-02.");
assert(
  one.ok && one.code === "" && one.validCount === 1 &&
    one.entry.file === file,
  "Exactly one valid diagnosis preset must be selected.");
assert(
  !two.ok && two.code === "E-PRESET-02" && two.validCount === 2,
  "Two valid diagnosis presets must stop with E-PRESET-02.");
assert(
  oneAndBroken.ok && oneAndBroken.validCount === 1 &&
    oneAndBroken.entries.length === 2 &&
    oneAndBroken.entries[1].valid === false,
  "Cardinality must count valid files while retaining invalid diagnostics.");
// An install with no diagnosis at all is a broken install, not a run
// that skips the diagnosis. There is no such run any more.
assert(app.resolveDiagnosisPreset({}).ok === false,
  "With no readable catalog there is no diagnosis to resolve.");
// The scope folder is held to its own cardinality: at least one usable
// file, and the first of them is the default.
assert(catalogWith([preset(file, validContent)]).scopeReady === true &&
  catalogWith([preset(file, validContent)]).defaultScope ===
    "03_変更範囲\\01_最小.md",
"The first usable change scope must be the default.");
assert(presetApi.describeCatalog({
  diagnose: [preset(file, validContent)],
  repair: [],
  scope: []
}).scopeReady === false,
"An install with no usable change scope must say so rather than assume one.");

console.log("test-diagnosis-preset-cardinality: PASS");
console.log("0/1/2 valid diagnosis files, invalid-file visibility, and the " +
  "change-scope default: PASS");
