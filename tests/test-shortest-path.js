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
var entrances = fs.readdirSync(path.join(root, "presets"))
  .filter(function (name) {
    return fs.statSync(path.join(root, "presets", name)).isDirectory();
  }).sort().map(function (folder) {
    return contracts.entrance(presetApi, folder);
  });

assert(screens.count === 11 &&
  store.startSimple === undefined && store.setMode === undefined &&
  store.setDiagnosisSkipped === undefined &&
  screens.modeScreen === undefined && screens.isSimple === undefined,
"The flow must expose one 11-screen graph and no simple-mode API.");
// Three entrances, each usable, each saying for itself what a run of its
// kind does. Nothing about the shape of a run is decided in the app.
assert(entrances.length === 3 && entrances.every(function (entrance) {
  return entrance.valid === true && entrance.description.length > 0;
}), "The install must ship exactly three usable entrances.");
assert(entrances.filter(function (entrance) {
  return entrance.hasDiagnosis;
}).length === 2, "Two of the three entrances diagnose.");
assert(entrances.every(function (entrance) {
  return entrance.hasDiagnosis === false || entrance.diagnosisReady === true;
}), "An entrance that diagnoses must hold exactly one diagnosis template.");

var macroEntrance = entrances[0];

assert(macroEntrance.folder === "01_マクロ改修" &&
  macroEntrance.choosesTemplate === true,
"The macro entrance is the one that offers a choice of repair template.");
assert(screens.nextIndex({entrance: macroEntrance}, screens.bookScreen) ===
  screens.diagnoseScreen,
"For an entrance that diagnoses, the workbook leads only to the diagnosis.");

store.setEntrance(macroEntrance);
assert(store.getState().screen === screens.entranceScreen && store.goNext() &&
  store.getState().screen === screens.bookScreen,
"The shortest path must begin by saying what the run is for.");
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

// The template comes off the entrance's own list, so the shortest path
// walks the files the install actually ships.
var chosen = macroEntrance.repair[0];

assert(chosen && chosen.valid,
  "The macro entrance must offer a usable repair template.");
store.setRepairPreset({
  file: chosen.file,
  name: chosen.name,
  content: chosen.content,
  parsed: presetApi.parse(chosen.content, "repair")
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
  productText.indexOf("AIで相談する") < 0 &&
  productText.indexOf("診断せずに進む") < 0,
"No visible diagnosis-skip or simple-mode entrance may remain in product code.");
// What the entrances are called is authored in their own folders, so the
// app may not carry the names of the three it happens to ship.
entrances.forEach(function (entrance) {
  assert(productText.indexOf(entrance.name) < 0,
    "The app names an entrance it should be reading off disk: " +
      entrance.name);
});

console.log("test-shortest-path: PASS");
console.log("three entrances read off disk, the macro entrance's mandatory " +
  "product-validated diagnosis, collapsed evidence, one template and one " +
  "desired line reach build");
