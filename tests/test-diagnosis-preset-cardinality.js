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

// Which diagnosis is in play is a property of the chosen entrance, so
// this asks the entrance rather than the whole install (SPEC section
// 2.2.0). The folder is built the way the host hands one over.
function entranceWith(diagnose, hasDiagnoseFolder) {
  return presetApi.describeEntrance({
    folder: "01_テスト入口",
    entrance: preset("01_テスト入口\\入口.md", [
      "# テスト入口",
      "",
      "## 説明",
      "",
      "この入口の説明です。"
    ].join("\n")),
    hasDiagnoseFolder: hasDiagnoseFolder !== false,
    diagnose: diagnose,
    repair: [preset("01_テスト入口\\02_改修\\01_直す.md", validContent)]
  });
}

function resolve(diagnose, hasDiagnoseFolder) {
  return app.resolveDiagnosisPreset({
    entrance: entranceWith(diagnose, hasDiagnoseFolder)
  });
}

var file = "01_テスト入口\\01_診断\\one.md";
var none = resolve([]);
var one = resolve([preset(file, validContent)]);
var two = resolve([
  preset(file, validContent),
  preset("01_テスト入口\\01_診断\\two.md",
    validContent.replace("# 診断", "# 診断2"))
]);
var oneAndBroken = resolve([
  preset(file, validContent),
  preset("01_テスト入口\\01_診断\\broken.md", invalidContent)
]);
// An entrance with no diagnosis folder at all does not diagnose, and
// that is a shape of run rather than a broken install.
var noStage = resolve([], false);

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
assert(
  noStage.ok && noStage.code === "" && noStage.entry === null,
  "An entrance that does not diagnose must not be reported as broken.");
// And nothing is decided before an entrance is chosen.
assert(app.resolveDiagnosisPreset({entrance: null}).ok === false,
  "With no entrance chosen there is no diagnosis to resolve.");

console.log("test-diagnosis-preset-cardinality: PASS");
console.log("0/1/2 valid files per entrance, invalid-file visibility, and " +
  "an entrance with no diagnosis stage: PASS");
