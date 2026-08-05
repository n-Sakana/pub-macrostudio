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

["icons.js", "components.js", "handover.js", "preset-document.js", "response-package.js", "diagnosis-package.js",
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
  diagMarker("META GRADE=B CONFIDENCE=CONFIRMED MODULE=Main " +
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

var contracts = require("./helpers/contracts");
var presetApi = windowObject.MacroStudioPreset;
var catalog = contracts.catalog(presetApi);

// The gate on the shape of the flow. What it guards has changed once
// already - it used to fix an eleven-screen graph with a choice of
// entrance in front of it - so it fixes the current answer rather than
// the history: one road in, and the workbook is the way in.
assert(screens.count === 10 &&
  store.startSimple === undefined && store.setMode === undefined &&
  store.setDiagnosisSkipped === undefined && store.setEntrance === undefined &&
  screens.modeScreen === undefined && screens.isSimple === undefined &&
  screens.entranceScreen === undefined &&
  screens.isDiagnosisSkipped === undefined,
"The flow must expose one 10-screen graph and no entrance or mode API.");
assert(screens.bookScreen === 0,
  "Reading the workbook is the first thing that happens.");
assert(screens.nextIndex({}, screens.bookScreen) === screens.diagnoseScreen,
  "The workbook leads only to the diagnosis. There is nothing to skip it.");

// The diagnosis is one file and there is no folder of them to pick from.
assert(catalog.diagnosisReady === true && catalog.diagnose.length === 1,
  "The install must ship exactly one usable diagnosis template.");
// The operations stand under headings the files declare. More than one
// heading is what makes them worth grouping; the app supplies none of
// them, which the name check at the bottom of this file enforces.
assert(catalog.categories.length >= 2 &&
  catalog.repair.length > catalog.categories.length &&
  catalog.repair.every(function (entry) {
    return entry.valid === true && entry.category.length > 0;
  }),
"Every repair template must stand under a heading it declares itself.");
// The change scope has a default that can be seen and changed, and the
// default is the one that forbids structural change.
assert(catalog.scopeReady === true && catalog.scope.length >= 2 &&
  catalog.scope[0].valid === true &&
  catalog.scope[0].structure === "forbidden" &&
  catalog.scope.some(function (entry) {
    return entry.valid && entry.structure === "allowed";
  }),
"The shipped change scopes must default to forbidding structural change.");

store.setAppInfo({version: "test", presets: {}, catalog: catalog});
assert(store.getState().changeScope &&
  store.getState().changeScope.file === catalog.scope[0].file,
"The default change scope must be applied without the reader choosing it.");
assert(store.getState().screen === screens.bookScreen,
  "The shortest path must begin at the workbook.");
store.setBook({
  name: "book.xlsm", path: "C:\\books\\book.xlsm", ext: ".xlsm",
  totalLines: 3
}, modules);
assert(store.goNext() &&
  store.getState().screen === screens.diagnoseScreen,
"The attached workbook must enter the diagnosis screen.");
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

var findings = workflow.createFindingsScreen(store.getState());
// One tier stays shut on the shortest path: the box holding the places a
// problem was found in. Inside that box nothing else has to be opened.
var groupPanel = findings.querySelector(".group-panel");
assert(groupPanel && groupPanel.hidden === true,
  "The shortest path may leave the occurrences unopened.");
assert(findings.querySelector(".occurrence-toggle") === null,
  "There is no second tier to leave unopened.");

// The template comes off the shipped list, so the shortest path walks
// the files the install actually ships.
var chosen = catalog.repair[0];

assert(chosen && chosen.valid,
  "The install must offer a usable repair template.");
store.setRepairPreset({
  file: chosen.file,
  name: chosen.name,
  content: chosen.content,
  parsed: presetApi.parse(chosen.content, "repair")
});
assert(store.goNext() && store.getState().screen === screens.nextStepScreen,
  "The read diagnosis must lead to the choice of work.");
assert(store.goNext() && store.getState().screen === screens.repairInputScreen,
  "One template and the default change scope must open repair input.");
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
  productText.indexOf("AIで相談する") < 0 &&
  productText.indexOf("診断せずに進む") < 0 &&
  productText.indexOf("何をするか選びます") < 0,
"No visible diagnosis-skip, simple-mode or entrance chooser may remain.");
// The headings the operations stand under, and the words the change
// scopes call themselves, are authored on disk. The app groups by a
// string it was handed and may not carry any of those strings itself.
catalog.categories.forEach(function (name) {
  assert(productText.indexOf(name) < 0,
    "The app names a category it should be reading off disk: " + name);
});
catalog.scope.forEach(function (entry) {
  assert(!entry.valid || productText.indexOf(entry.name) < 0,
    "The app names a change scope it should be reading off disk: " +
      entry.name);
});

console.log("test-shortest-path: PASS");
console.log("one 10-screen road read off disk, a mandatory " +
  "product-validated diagnosis, declared categories, a default change " +
  "scope, one template and one desired line reach build");
