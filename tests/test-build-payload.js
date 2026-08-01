"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message +
      "\nExpected: " + JSON.stringify(expected) +
      "\nActual:   " + JSON.stringify(actual));
  }
}

var windowObject = {};
var context = vm.createContext({
  window: windowObject,
  document: {
    addEventListener: function () {}
  },
  Promise: Promise
});

// The build payload and the summary memo lean on the diff engine and on
// the state's naming rules, so the real modules are loaded rather than
// stubbed: the names in the memo have to be the names the run produces.
["handover.js",
  "diff.js",
  "screens.js",
  "state.js",
  "app.js"
].forEach(function (file) {
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "..", "assets", "js", file),
      "utf8"),
    context,
    { filename: file });
});

var app = windowObject.MacroStudioApp;
var stateApi = windowObject.MacroStudioState;
var attributes = "Attribute VB_Name = \"Module1\"\r\n";
var normalized =
  "Option Explicit\r\n" +
  "Public Sub Run(): End Sub\r\n";
var state = {
  modules: [
    {
      name: "Module1",
      status: "changed",
      accepted: true,
      attributes: attributes,
      pastedCode: normalized
    },
    {
      name: "ModulePending",
      status: "changed",
      accepted: false,
      attributes: "Attribute VB_Name = \"ModulePending\"\r\n",
      pastedCode: "Option Explicit\r\n"
    },
    {
      name: "Module2",
      status: "unchanged",
      attributes: "Attribute VB_Name = \"Module2\"\r\n",
      pastedCode: "Option Explicit\r\n"
    },
    {
      name: "Module3",
      status: "excluded",
      attributes: "Attribute VB_Name = \"Module3\"\r\n",
      pastedCode: null
    }
  ]
};

assertEqual(
  app.createOutputTimestamp(new Date(2026, 6, 8, 1, 2, 3)),
  "20260708_010203",
  "Output timestamp format mismatch.");
assertEqual(
  app.createBuildOutputName(
    {
      name: "sample.xlsm",
      ext: ".xlsm"
    },
    "20260708_010203",
    "改修済"),
  "sample_改修済_20260708_010203.xlsm",
  "Build output name mismatch.");
assertEqual(
  app.createBuildOutputName(
    {
      name: "SAMPLE.XLSM",
      ext: ".xlsm"
    },
    "20260708_010203",
    "改修済"),
  "SAMPLE_改修済_20260708_010203.xlsm",
  "Extension removal must be case-insensitive.");
assertEqual(
  app.createBuildOutputName(
    {
      name: "sample.xlsm",
      ext: ".xlsm"
    },
    "20260708_010203",
    "確認済"),
  "sample_確認済_20260708_010203.xlsm",
  "Build output name ignored the host-provided label.");
assertEqual(
  app.getHostErrorMessage({
    code: "E-SYS-02",
    data: {
      userMessage: "ひな形は UTF-8 で保存してください。"
    }
  }),
  "ひな形は UTF-8 で保存してください。",
  "Safe host-provided user message was not displayed.");

assertEqual(
  app.joinFinalCode(attributes, normalized),
  attributes + normalized,
  "CRLF-terminated attributes gained an extra blank line.");
assertEqual(
  app.joinFinalCode(
    "Attribute VB_Name = \"Module1\"",
    normalized),
  attributes + normalized,
  "Missing Attribute boundary CRLF was not supplied.");
assertEqual(
  app.joinFinalCode("", normalized),
  normalized,
  "Empty attributes added a leading line.");

var modules = app.createBuildModules(state);
assert(modules.length === 1, "Only accepted modules may be built.");
assertEqual(modules[0].name, "Module1", "Build module name mismatch.");
assertEqual(
  modules[0].code,
  attributes + normalized,
  "Build module final code mismatch.");
assertEqual(
  state.modules[0].attributes,
  attributes,
  "Build payload creation changed the retained attributes.");

var newModules = app.createBuildModules({
  modules: [
    {
      name: "CommonHelpers",
      status: "changed",
      accepted: true,
      attributes: "",
      pastedCode: normalized,
      isNew: true
    }
  ]
});
assert(newModules.length === 1, "New module build payload is missing.");
assertEqual(
  newModules[0].name,
  "CommonHelpers",
  "New module build name mismatch.");
assertEqual(
  newModules[0].code,
  normalized,
  "New module build payload must not synthesize Attributes in JS.");
assertEqual(
  newModules[0].isNew,
  true,
  "New module build payload is not explicitly marked.");

assertEqual(
  app.getNewModuleNameError(state, "共通処理"),
  "",
  "A valid Unicode VBA identifier was rejected.");
assert(
  app.getNewModuleNameError(state, "1Broken").length > 0,
  "An invalid VBA identifier was accepted.");
assert(
  app.getNewModuleNameError(state, "module1").length > 0,
  "A case-insensitive duplicate module name was accepted.");

var threw = false;
try {
  app.createBuildModules({
    modules: [
      {
        name: "Broken",
        status: "changed",
        accepted: true,
        pastedCode: null
      }
    ]
  });
} catch (error) {
  threw = true;
}
assert(threw, "Missing accepted code must produce an explicit error.");

// ---- the names the run's files carry, and the summary memo ----

assertEqual(
  stateApi.formatDateStamp(new Date(2026, 6, 8, 1, 2, 3)),
  "20260708",
  "The date stamp must be a fixed width local date.");
assertEqual(
  stateApi.getDefaultOutputName(
    { name: "SalesTool.xlsm", ext: ".xlsm" },
    "20260730"),
  "SalesTool-Modified-20260730.xlsm",
  "The rebuilt workbook name mismatch.");
assertEqual(
  stateApi.getDiffReportName(
    { name: "SalesTool.xlsm", ext: ".xlsm" },
    "20260730"),
  "SalesTool-Diff-Report-20260730.html",
  "The report name mismatch.");
assertEqual(
  stateApi.getDefaultOutputName(
    { name: "SALESTOOL.XLSM", ext: ".xlsm" },
    "20260730"),
  "SALESTOOL-Modified-20260730.xlsm",
  "Extension removal must be case-insensitive.");
assert(
  stateApi.getDefaultOutputName(null, "20260730") === "" &&
    stateApi.getDiffReportName(null, "20260730") === "",
  "Without a workbook there is no name to produce.");
assert(
  stateApi.getDefaultOutputName(
    { name: "SalesTool.xlsm", ext: ".xlsm" },
    "20260730").indexOf("macrostudio") < 0,
  "The old suffix must not come back in the workbook name.");

// The summary memo names the same files and keeps its headings short.
var memo = app.createResultMarkdown(
  {
    book: { name: "SalesTool.xlsm", ext: ".xlsm" },
    outputName: "SalesTool-Modified-20260730.xlsm",
    outputDateStamp: "20260730",
    presetName: "ひな形",
    repairRequestId: "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1",
    diagnosisFilePath: "C:\\run\\diagnosis.md",
    repairRequestFilePath: "C:\\run\\repair-request.md",
    intakeResult: { summary: "Module1 を直しました。" },
    modules: [
      {
        name: "Module1",
        type: "standard",
        typeLabel: "標準モジュール",
        status: "changed",
        accepted: true,
        code: "Option Explicit\r\n",
        pastedCode: "Option Explicit\r\nSub A(): End Sub\r\n"
      },
      {
        name: "Module2",
        type: "standard",
        typeLabel: "標準モジュール",
        status: "pending",
        code: "Option Explicit\r\n",
        pastedCode: null
      }
    ]
  },
  "20260730_010203");

assert(
  memo.indexOf("## 改修内容") >= 0,
  "The summary memo heading must be the short one.");
assert(
  memo.indexOf("AIが書いた改修内容") < 0,
  "The long heading must not come back.");
assert(
  memo.indexOf("Module1 を直しました。") >= 0,
  "The summary the answer carried must reach the memo.");
assert(
  memo.indexOf("SalesTool-Modified-20260730.xlsm") >= 0 &&
    memo.indexOf("SalesTool-Diff-Report-20260730.html") >= 0,
  "The memo must name the files this run produced: " + memo);
assert(
  memo.indexOf("diff-report.html") < 0,
  "The memo must not name the old fixed report name.");
assert(
  memo.indexOf("- diagnose-request.md") >= 0 &&
    memo.indexOf("- source-code.md") >= 0 &&
    memo.indexOf("- diagnosis.md") >= 0 &&
    memo.indexOf("- repair-request.md") >= 0 &&
    memo.indexOf("- result.md") >= 0,
  "The memo must still name the files that keep their fixed names.");
assert(
  memo.indexOf("- request.md") < 0,
  "The beta 1.10 request.md name must not come back.");

var mappingMemo = app.createResultMarkdown({
  book: {name: "SalesTool.xlsm", ext: ".xlsm"},
  outputName: "SalesTool-Modified-20260730.xlsm",
  outputDateStamp: "20260730",
  presetName: "固定パスを新環境へ置き換える",
  repairRequestId: null,
  repairResultEngine: "対応表による置換",
  diagnosisFilePath: "C:\\run\\diagnosis.md",
  repairRequestFilePath: null,
  intakeResult: {
    mapping: {
      rows: [{
        "class": "driveAbsolute",
        from: "C:\\old\\report.xlsx",
        to: "D:\\new\\report.xlsx",
        count: 1,
        occurrences: [{module: "Module1", procedure: "Run", line: 4}]
      }]
    }
  },
  modules: [{
    name: "Module1",
    type: "standard",
    typeLabel: "標準モジュール",
    status: "changed",
    accepted: true,
    code: "x = \"C:\\old\\report.xlsx\"\r\n",
    pastedCode: "x = \"D:\\new\\report.xlsx\"\r\n"
  }]
}, "20260730_010203");
assert(
  mappingMemo.indexOf("## 置換の対応表") >= 0 &&
    mappingMemo.indexOf("C:\\old\\report.xlsx") >= 0 &&
    mappingMemo.indexOf("D:\\new\\report.xlsx") >= 0 &&
    mappingMemo.indexOf("Module1 / Run / 4行目") >= 0,
  "The deterministic result memo must preserve the reviewed mapping table.");
assert(
  mappingMemo.indexOf("repair-request.md") < 0,
  "The deterministic route must not claim an AI repair request artifact.");

console.log("test-build-payload: PASS");
