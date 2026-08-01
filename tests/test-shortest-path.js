"use strict";

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
var documentObject = {createElement: dom.createElement};
var context = vm.createContext({
  window: windowObject,
  document: documentObject,
  Math: Math,
  Uint8Array: Uint8Array
});
windowObject.window = windowObject;
windowObject.document = documentObject;
windowObject.Math = Math;
windowObject.Uint8Array = Uint8Array;

["icons.js", "handover.js", "preset-document.js", "response-package.js", "diagnosis-package.js",
  "diff.js", "screens.js", "state.js", "screens/workflow.js"]
  .forEach(function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
      {filename: name});
  });

var screens = windowObject.MacroStudioScreens;
var store = windowObject.MacroStudioState;
var diagnosisApi = windowObject.MacroStudioDiagnosis;
var responseApi = windowObject.MacroStudioResponse;
var workflow = windowObject.MacroStudioWorkflow;
var diagnosisId = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";
var repairId = "84547cd0-d729-4cab-a9f9-5c7b772ae9d2";
var environment = {
  displayName: "新しい業務端末",
  revision: "2026-08-01",
  constraints: [{
    key: "WIN32API_BLOCKED",
    title: "Win32 API は利用できない",
    detail: "",
    effect: "blocked",
    basis: "declared",
    sourceIds: []
  }]
};
var modules = [{
  name: "Main",
  type: "standard",
  typeLabel: "標準モジュール",
  ext: "bas",
  lineCount: 3,
  code: "Option Explicit\r\nPublic Sub Run()\r\nEnd Sub",
  attributes: ""
}];

windowObject.MacroStudioApp = {
  showToast: function () {},
  handleHostError: function () {},
  isBlockingAttachError: function () { return false; },
  createAttachErrorCard: function () { return dom.createElement("div"); }
};

function diagMarker(value) {
  return "'@MACROSTUDIO " + diagnosisId + " " + value;
}

var diagnosisText = [
  diagMarker("DIAG BEGIN 1"),
  diagMarker("SECTION BEGIN PURPOSE"), "帳票を出力します。",
  diagMarker("SECTION END PURPOSE"),
  diagMarker("SECTION BEGIN FLOW"), "Main を実行します。",
  diagMarker("SECTION END FLOW"),
  diagMarker("SECTION BEGIN DEPENDENCY"), "Win32 API を呼びます。",
  diagMarker("SECTION END DEPENDENCY"),
  diagMarker("SECTION BEGIN ENVIRONMENT"), "対象環境では API を使えません。",
  diagMarker("SECTION END ENVIRONMENT"),
  diagMarker("FINDING BEGIN 1"),
  diagMarker("META CLASS=BLOCKER CONFIDENCE=CONFIRMED MODULE=Main " +
    "PROC=Run LINES=2 ENVKEY=WIN32API_BLOCKED"),
  diagMarker("TEXT BEGIN TITLE"), "Win32 API を呼んでいる",
  diagMarker("TEXT END TITLE"),
  diagMarker("TEXT BEGIN CONDITION"), "Run を実行する",
  diagMarker("TEXT END CONDITION"),
  diagMarker("TEXT BEGIN IMPACT"), "対象環境で停止する",
  diagMarker("TEXT END IMPACT"),
  diagMarker("TEXT BEGIN EVIDENCE"), "コードに呼び出しがある",
  diagMarker("TEXT END EVIDENCE"),
  diagMarker("FINDING END 1"),
  diagMarker("DIAG COMPLETE 1"),
  diagMarker("DIAG END")
].join("\r\n");

assert(screens.count === 10 &&
  store.startSimple === undefined && store.setMode === undefined &&
  screens.modeScreen === undefined && screens.isSimple === undefined,
"The beta2 flow must expose one 10-screen graph and no simple-mode API.");
assert(screens.nextIndex({}, screens.bookScreen) === screens.diagnoseScreen,
  "The workbook screen must lead only to diagnosis, never to findings.");

store.setBook({
  name: "book.xlsm", path: "C:\\books\\book.xlsm", ext: ".xlsm",
  totalLines: 3
}, modules);
assert(store.getState().screen === screens.bookScreen && store.goNext() &&
  store.getState().screen === screens.diagnoseScreen,
"The shortest path must begin at book and enter the diagnosis screen.");
store.setTargetEnvironment(environment, "ENVIRONMENT SNAPSHOT");
store.commitDiagnosisRequest({requestId: diagnosisId});
store.setDiagnosisHandoffProgress(true, true);
assert(!store.canGoNext(),
  "Handing the request over must not by itself open findings.");

var parsedDiagnosis = diagnosisApi.parse(diagnosisText, {
  requestId: diagnosisId,
  modules: modules,
  environment: environment
});
assert(parsedDiagnosis.ok,
  "The shortest path must use a package accepted by the product parser.");
store.commitDiagnosis(parsedDiagnosis.diagnosis, "diagnosis.md");
assert(store.goNext() && store.getState().screen === screens.findingsScreen,
  "A valid diagnosis, not a skip, must open findings.");

var findings = workflow.createFindingsScreen(Object.assign(
  store.getState(), {appInfo: {presets: {repair: []}}}));
// One tier stays shut on the shortest path: the box holding the places a
// problem was found in. Inside that box nothing else has to be opened.
var groupPanel = findings.querySelector(".group-panel");
assert(groupPanel && groupPanel.hidden === true,
  "The shortest path may leave the occurrences unopened.");
assert(findings.querySelector(".occurrence-toggle") === null,
  "There is no second tier to leave unopened.");

var presetPath = path.join(root, "presets", "02_改修",
  "01_Win32 API を使わない形へ直す.md");
var presetContent = readUtf8(presetPath);
var parsedPreset = windowObject.MacroStudioPreset.parse(presetContent, "repair");
assert(parsedPreset.valid, "The selected shipped repair preset must parse.");
store.setRepairPreset({
  file: "02_改修\\02_Win32 API を使わない形へ直す.md",
  name: parsedPreset.name,
  content: presetContent,
  parsed: parsedPreset
});
assert(store.goNext() && store.getState().screen === screens.nextStepScreen,
  "The read diagnosis must lead to the choice of work.");
assert(store.goNext() && store.getState().screen === screens.repairInputScreen,
  "Selecting one template must open repair input.");
store.setFindingSelected(1, true);
store.setDesiredBehaviour(1, "元と同じ結果で動いてほしい");
assert(screens.isRepairInputReady(store.getState()),
  "One selected finding and one desired-behaviour line is enough here.");

store.commitRepairRequest({requestId: repairId, prompt: "repair prompt"});
assert(store.goNext() && store.getState().screen === screens.repairScreen,
  "A host-committed repair request must enter the repair screen.");
store.setRepairHandoffProgress(true, true);
assert(!store.canGoNext(),
  "Handing the repair request over must not by itself open review.");

var answer = [
  responseApi.summaryBeginLine(repairId),
  "Main を最小限変更しました。",
  responseApi.summaryEndLine(repairId),
  responseApi.beginLine(repairId, "standard", "Main"),
  "Option Explicit",
  "Public Sub Run(): Beep: End Sub",
  responseApi.endLine(repairId, "standard", "Main"),
  responseApi.completeLine(repairId, 1)
].join("\r\n");
assert(workflow.applyRepairText(answer) && store.goNext() &&
  store.getState().screen === screens.reviewScreen,
"A product-validated repair package must join the ordinary review screen.");
assert(store.goNext() && store.getState().screen === screens.outputScreen,
  "The unchanged review contract must reach output.");
assert(store.goNext() && store.getState().screen === screens.buildScreen,
  "The shortest valid beta2 path must reach build.");

var productText = [
  readUtf8(path.join(root, "assets", "index.html")),
  readUtf8(path.join(root, "assets", "js", "app.js")),
  readUtf8(path.join(root, "assets", "js", "screens.js")),
  readUtf8(path.join(root, "assets", "js", "screens", "workflow.js"))
].join("\n");
assert(productText.indexOf("簡易モードで始める") < 0 &&
  productText.indexOf("AIで相談する") < 0,
"No visible diagnosis-skip or simple-mode entrance may remain in product code.");

console.log("test-shortest-path: PASS");
console.log("one entrance, mandatory product-validated diagnosis, collapsed " +
  "evidence, one template and one desired line reach build");
