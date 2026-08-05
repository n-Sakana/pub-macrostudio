"use strict";

// PROD-14: a run that skipped the diagnosis must not claim it handed the code
// to an AI.
//
// diagnose-request.md and temp\<run>\source-code-for-ai.md are both written on
// the way into screen 1 - before the reader has decided whether to use a
// diagnosis at all. The completion screen and result.md listed the first as
// "the first request handed to the AI" and closed with "the code attached to
// the AI is in the temp folder", on a route where nothing was ever handed to
// anyone. Both files really are on disk, so the fix is not to hide them: it is
// to describe them truthfully.
//
// This is the same shape as PROD-07 (diagnosis.md listed as created when it
// was not) and is guarded the same way - by the route, not by the file.

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var dom = require("./helpers/dom-shim");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readUtf8(filePath) {
  var text = fs.readFileSync(filePath, "utf8");
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

var root = path.resolve(__dirname, "..");
var windowObject = {};
// app.js registers for DOMContentLoaded at the end of the file; the shim only
// has to accept the call, because nothing here runs initialize().
var documentObject = {
  createElement: dom.createElement,
  addEventListener: function () { return undefined; },
  querySelector: function () { return null; },
  getElementById: function () { return null; }
};
var context = vm.createContext({window: windowObject, document: documentObject});

windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "components.js", "response-package.js", "diagnosis-package.js", "vba-lexer.js",
  "vba-highlight.js", "diff.js", "diff-view.js", "path-map.js",
  "target-environment.js", "prompt-template.js", "preset-document.js",
  "handover.js", "state.js", "screens.js", "screens/workflow.js",
  "app.js"].forEach(function (name) {
  vm.runInContext(
    readUtf8(path.join(root, "assets", "js", name)),
    context,
    {filename: name});
});

var app = windowObject.MacroStudioApp;

assert(app && typeof app.createResultMarkdown === "function",
  "createResultMarkdown is not reachable from the test harness");

// ---- the smallest state that reaches the artifact listing ----------------

function createState(overrides) {
  var state = {
    book: {name: "S01.xlsm", path: "C:\\books\\S01.xlsm", ext: ".xlsm"},
    bookInventory: null,
    modules: [
      {
        name: "ExportSummary",
        type: "standard",
        typeLabel: "標準モジュール",
        status: "changed",
        accepted: true,
        changedLineCount: 1,
        code: "Option Explicit\r\n",
        pastedCode: "Option Explicit\r\n"
      }
    ],
    outputName: "S01-Modified-20260803.xlsm",
    outputDateStamp: "20260803",
    runFolder: "C:\\books\\MacroStudio\\S01_20260803_011439",
    diagnosisFilePath: null,
    repairRequestFilePath: null,
    repairResultEngine: "対応表による置換",
    presetName: "固定パスを新環境へ置き換える",
    selectedFindings: [],
    findings: [],
    questions: [],
    answers: {},
    pathMap: null,
    targetEnvironment: {displayName: "新しい業務端末", revision: "2026-08-01"},
    buildResult: {status: "ok"}
  };

  Object.keys(overrides || {}).forEach(function (key) {
    state[key] = overrides[key];
  });
  return state;
}

function markdownFor(overrides) {
  return app.createResultMarkdown(createState(overrides), "2026-08-03 01:17:43");
}

// ---- result.md ----------------------------------------------------------

var skipped = markdownFor({});
var withDiagnosis = markdownFor({
  diagnosisFilePath: "C:\\books\\MacroStudio\\S01_20260803_011439\\diagnosis.md"
});

// The request file is still listed - it is in the folder and the section is
// titled "the files in this folder". Leaving it out would be its own untruth.
assert(skipped.indexOf("diagnose-request.md") >= 0,
  "診断を飛ばした実行で diagnose-request.md が一覧から消えた（実在するので載せること）");

assert(skipped.indexOf("診断のためAIへ渡した第1依頼") < 0,
  "診断を飛ばした実行で「AIへ渡した」と名乗っている（PROD-14）");
assert(skipped.indexOf("この実行では使っていません") >= 0,
  "診断を飛ばした実行で、使っていないことが書かれていない");

assert(withDiagnosis.indexOf("診断のためAIへ渡した第1依頼") >= 0,
  "実際に診断した実行で「AIへ渡した」が消えた");

// The closing sentence about the attachment has the same problem.
assert(skipped.indexOf("AIへ添付したコードは") < 0,
  "診断を飛ばした実行で「AIへ添付した」と名乗っている（PROD-14）");
assert(skipped.indexOf("AI へ何も渡していません") >= 0,
  "診断を飛ばした実行で、AIへ何も渡していないことが書かれていない");
assert(withDiagnosis.indexOf("AIへ添付したコードは") >= 0,
  "実際に診断した実行で添付の案内が消えた");

// A repair-only route did hand code over, even with no diagnosis.
var repairOnly = markdownFor({
  repairRequestFilePath:
    "C:\\books\\MacroStudio\\S01_20260803_011439\\repair-request.md",
  repairResultEngine: "AI"
});

assert(repairOnly.indexOf("AIへ添付したコードは") >= 0,
  "AIへ改修を依頼した実行で添付の案内が消えた");

// ---- the completion screen says the same thing --------------------------

function doneScreenText(overrides) {
  var text = [];

  function walk(element) {
    if (!element) { return; }
    if (element.textContent) { text.push(String(element.textContent)); }
    (element.children || []).forEach(walk);
  }

  walk(app.createDoneScreen(createState(overrides)));
  return text.join("\n");
}

var doneSkipped = doneScreenText({});
var doneDiagnosed = doneScreenText({
  diagnosisFilePath: "C:\\books\\MacroStudio\\S01_20260803_011439\\diagnosis.md"
});

assert(doneSkipped.indexOf("diagnose-request.md") >= 0,
  "完了画面から diagnose-request.md が消えた（実在するので載せること）");
assert(doneSkipped.indexOf("診断のためAIへ渡した第1依頼") < 0,
  "完了画面が、診断を飛ばした実行で「AIへ渡した」と名乗っている（PROD-14）");
assert(doneSkipped.indexOf("この実行では使っていません") >= 0,
  "完了画面が、使っていないことを書いていない");
assert(doneDiagnosed.indexOf("診断のためAIへ渡した第1依頼") >= 0,
  "完了画面が、実際に診断した実行で「AIへ渡した」を落とした");

// PROD-07 stays fixed: diagnosis.md is only listed when it was written.
assert(doneSkipped.indexOf("diagnosis.md") < 0,
  "診断を飛ばした実行で diagnosis.md が並んでいる（PROD-07 の退行）");
assert(doneDiagnosed.indexOf("diagnosis.md") >= 0,
  "診断した実行で diagnosis.md が並んでいない");

console.log("test-skipped-diagnosis-artifacts: PASS");
console.log(
  "診断を飛ばした実行では、完了画面も result.md も「AIへ渡した／添付した」と" +
  "名乗らず、実在するファイルは用途どおりに説明される（PROD-14）");
