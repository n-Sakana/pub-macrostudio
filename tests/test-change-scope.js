"use strict";

// How far the code may change, and what the tool can actually tell.
//
// The reader picks one of the change scopes shipped in presets/03_変更範囲.
// The first one is the default and declares 構造変更: 禁止, and while that
// is in force the intake refuses four things it can see:
//
//   1. a module the workbook did not have
//   2. a Sub / Function / Property that left an existing module
//   3. a procedure that moved in from another module
//   4. a module that came back almost entirely rewritten
//
// It cannot see a procedure body rewritten under the same name, and the
// screen says so. This file fixes both halves: what the guard refuses,
// and what it does not claim to have checked.

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var dom = require("./helpers/dom-shim");
var contracts = require("./helpers/contracts");

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
  JSON: JSON,
  Uint8Array: Uint8Array,
  Promise: Promise
});
windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "components.js", "handover.js", "preset-document.js", "response-package.js",
  "diagnosis-package.js", "prompt-template.js", "diff.js", "vba-lexer.js",
  "path-map.js", "code-view.js", "screens.js", "state.js",
  "screens/workflow.js"]
  .forEach(function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
      {filename: name});
  });

windowObject.MacroStudioApp = {
  showToast: function () {},
  handleHostError: function () {},
  isBlockingAttachError: function () { return false; },
  createAttachErrorCard: function () { return dom.createElement("div"); }
};

var responseApi = windowObject.MacroStudioResponse;
var presetApi = windowObject.MacroStudioPreset;
var screens = windowObject.MacroStudioScreens;
var store = windowObject.MacroStudioState;
var workflow = windowObject.MacroStudioWorkflow;
var catalog = contracts.catalog(presetApi);
var requestId = "5a1f0e3b-9c2d-4d71-8f0a-6b3c7d1e4a92";

// ---- the shipped files, and what they declare ----

var minimal = catalog.scope[0];
var permissive = catalog.scope.filter(function (entry) {
  return entry.valid && entry.structure === "allowed";
})[0];

assert(catalog.scope.length === 2 && minimal.valid && permissive,
  "The install must ship one default scope and one that permits more.");
assert(minimal.structure === "forbidden",
  "The default must be the one that forbids structural change.");
// Neither option is phrased as a thing to switch off. A reader who has to
// clear a checkbox to allow something is reading a double negative.
[minimal, permissive].forEach(function (entry) {
  assert(entry.name.indexOf("ない") < 0 && entry.name.indexOf("しない") < 0 &&
    entry.name.indexOf("禁止") < 0,
  "A change scope must be named for what it permits: " + entry.name);
});
assert(permissive.name.indexOf("許可") >= 0,
  "The permissive option must say plainly that it allows more.");

// ---- what a procedure is, for this guard ----
// A Declare is a Function to the VBA grammar. Counting it as a procedure
// would make the guard refuse the most ordinary repair this tool does -
// taking a Win32 Declare out - so it is deliberately not one.

var WITH_DECLARE = [
  "Option Explicit",
  "Private Declare PtrSafe Function Sleep Lib \"kernel32\" " +
    "(ByVal ms As Long)",
  "Public Sub Run()",
  "    Sleep 100",
  "End Sub",
  "Private Function Helper(ByVal n As Long) As Long",
  "    Helper = n",
  "End Function"
].join("\r\n");

assert(
  JSON.stringify(responseApi.listProcedures(WITH_DECLARE)) ===
    JSON.stringify(["Run", "Helper"]),
  "A Declare is not a procedure the guard counts: " +
    JSON.stringify(responseApi.listProcedures(WITH_DECLARE)));
assert(
  JSON.stringify(responseApi.listProcedures(
    "Property Get Name() As String\r\nEnd Property")) ===
    JSON.stringify(["Name"]),
  "A property is a procedure.");

// ---- the four refusals ----

function moduleOf(name, code, lineCount) {
  return {
    name: name,
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: lineCount === undefined
      ? code.split("\r\n").length
      : lineCount,
    code: code,
    attributes: ""
  };
}

function reply(modules) {
  var lines = [
    responseApi.summaryBeginLine(requestId),
    "直しました。",
    responseApi.summaryEndLine(requestId)
  ];

  modules.forEach(function (item) {
    lines.push(responseApi.beginLine(requestId, "standard", item.name));
    lines.push(item.code);
    lines.push(responseApi.endLine(requestId, "standard", item.name));
  });
  lines.push(responseApi.completeLine(requestId, modules.length));
  return responseApi.describe(
    responseApi.parse(lines.join("\r\n"), requestId),
    existing,
    null);
}

var MAIN = [
  "Option Explicit",
  "Private Declare PtrSafe Function Sleep Lib \"kernel32\" " +
    "(ByVal ms As Long)",
  "Public Sub Run()",
  "    Sleep 100",
  "End Sub",
  "Public Sub Report()",
  "    Debug.Print 1",
  "End Sub"
].join("\r\n");
var OTHER = [
  "Option Explicit",
  "Public Sub Archive()",
  "    Debug.Print 2",
  "End Sub"
].join("\r\n");
var existing = [moduleOf("Main", MAIN), moduleOf("Other", OTHER)];

function guard(described, allowNewModules) {
  return responseApi.checkStructure(described, existing, {
    scopeName: minimal.name,
    allowNewModules: allowNewModules === true
  });
}

// 1. a module the workbook did not have
var added = guard(reply([
  {name: "Main", code: MAIN},
  {name: "Win32Free", code: "Option Explicit\r\nPublic Sub Wait2()\r\nEnd Sub"}
]));

assert(!added.ok && added.reason === "structureNewModule" &&
  added.message.indexOf("Win32Free") >= 0 &&
  added.message.indexOf(minimal.name) >= 0,
"A new module must be refused, by name, under the scope's own name: " +
  added.message);
// Unless the operation the reader chose says in its own file that it adds
// one. The app never decides which operations those are.
assert(guard(reply([
  {name: "Main", code: MAIN},
  {name: "Win32Free", code: "Option Explicit\r\nPublic Sub Wait2()\r\nEnd Sub"}
]), true).ok === true,
"An operation that declares it adds a module must be allowed to.");

// 2. a procedure that left
var removed = guard(reply([
  {name: "Main", code: MAIN.replace(
    "Public Sub Report()\r\n    Debug.Print 1\r\nEnd Sub", "")}
]));

assert(!removed.ok && removed.reason === "structureRemovedProcedure" &&
  removed.message.indexOf("Report") >= 0,
"A deleted procedure must be refused by name: " + removed.message);
// The Declare going is exactly what the Win32 repair does, and it passes.
assert(guard(reply([
  {name: "Main", code: MAIN
    .replace("Private Declare PtrSafe Function Sleep Lib \"kernel32\" " +
      "(ByVal ms As Long)\r\n", "")
    .replace("    Sleep 100", "    Application.Wait Now")}
])).ok === true,
"Taking a Win32 Declare out must pass the default scope.");

// 3. a procedure that moved in from another module
var moved = guard(reply([
  {name: "Main", code: MAIN + "\r\nPublic Sub Archive()\r\n" +
    "    Debug.Print 2\r\nEnd Sub"}
]));

assert(!moved.ok && moved.reason === "structureMovedProcedure" &&
  moved.message.indexOf("Archive") >= 0 &&
  moved.message.indexOf("Other") >= 0,
"A procedure moving between modules must be refused, saying where from: " +
  moved.message);
// A name that already lived here is not a move, whatever else carries
// it. VBA lets Test or Main sit privately in half the modules of a
// workbook, and matching on the name alone called every one of them a
// move - which the real GUI walk found on the first workbook it read.
existing = [
  moduleOf("A", "Option Explicit\r\nPublic Sub Test()\r\nEnd Sub"),
  moduleOf("B", "Option Explicit\r\nPublic Sub Test()\r\n" +
    "    Debug.Print 1\r\nEnd Sub")
];
assert(guard(reply([{
  name: "B",
  code: "Option Explicit\r\nPublic Sub Test()\r\n    Debug.Print 2\r\nEnd Sub"
}])).ok === true,
"A procedure name shared by two modules must not read as a move.");
existing = [moduleOf("Main", MAIN), moduleOf("Other", OTHER)];

// 4. a module that came back almost entirely rewritten
var LONG_LINES = [];
var index;

for (index = 1; index <= 60; index += 1) {
  LONG_LINES.push("    Step" + index + " = " + index);
}
var LONG = "Option Explicit\r\nPublic Sub Long1()\r\n" +
  LONG_LINES.join("\r\n") + "\r\nEnd Sub";
var REWRITTEN = "Option Explicit\r\nPublic Sub Long1()\r\n" +
  LONG_LINES.map(function (line) {
    return line.replace("Step", "Phase");
  }).join("\r\n") + "\r\nEnd Sub";

existing = [moduleOf("Long", LONG)];
var rewritten = guard(reply([{name: "Long", code: REWRITTEN}]));

assert(!rewritten.ok && rewritten.reason === "structureRewritten" &&
  rewritten.message.indexOf("Long") >= 0,
"A wholesale rewrite must be refused: " + JSON.stringify(rewritten.reason));
// A targeted change to the same long module is not a rewrite.
assert(guard(reply([{
  name: "Long",
  code: LONG.replace("    Step1 = 1", "    Step1 = 2")
}])).ok === true,
"A targeted change to a long module must pass.");
// A short module is never called a rewrite on volume alone: in ten lines,
// a two-line fix is most of the file.
existing = [moduleOf("Small", "Option Explicit\r\nPublic Sub S()\r\n" +
  "    a = 1\r\nEnd Sub")];
assert(guard(reply([{
  name: "Small",
  code: "Option Explicit\r\nPublic Sub S()\r\n    a = 2\r\n    b = 3\r\nEnd Sub"
}])).ok === true,
"A short module must not be called a rewrite on proportion alone.");

// ---- what the guard does not see ----
// A body rewritten line for line under the same name passes every check
// above. This is not a gap being papered over: the screen has to say it.

existing = [moduleOf("Main", MAIN)];
assert(guard(reply([{
  name: "Main",
  code: [
    "Option Explicit",
    "Private Declare PtrSafe Function Sleep Lib \"kernel32\" " +
      "(ByVal ms As Long)",
    "Public Sub Run()",
    "    Dim rewritten As Long",
    "    rewritten = 1",
    "    Sleep 100",
    "End Sub",
    "Public Sub Report()",
    "    Debug.Print 1",
    "End Sub"
  ].join("\r\n")
}])).ok === true,
"A rewritten body under the same name passes, and must not be claimed.");

// ---- the scope is off when the reader turns it off ----

assert(screens.isStructureForbidden({changeScope: minimal}) === true &&
  screens.isStructureForbidden({changeScope: permissive}) === false &&
  screens.isStructureForbidden({}) === false,
"The guard follows the chosen scope's own declaration.");
// And with nothing chosen there is nothing to enforce, so the screen that
// chooses the work refuses to advance rather than assuming an answer.
assert(screens.isChangeScopeChosen({}) === false,
  "No scope chosen is not the same as the strict scope.");

// ---- the screen says what it checks, and what it does not ----

store.setAppInfo({version: "test", presets: {}, catalog: catalog});
store.setBook({
  name: "book.xlsm", path: "C:\\work\\book.xlsm", ext: ".xlsm", totalLines: 8
}, [moduleOf("Main", MAIN)]);
store.setTargetEnvironment({displayName: "端末", revision: "1",
  constraints: []}, "ENV");
store.commitDiagnosisRequest({requestId: requestId});
store.commitDiagnosis(contracts.diagnosis(
  windowObject.MacroStudioDiagnosis,
  {requestId: requestId, modules: store.getState().modules}), "diagnosis.md");

var nextStep = workflow.createNextStepScreen(store.getState());
var screenText = dom.text(nextStep);

assert(screenText.indexOf(minimal.name) >= 0,
  "The default scope must be visible without opening anything.");
assert(screenText.indexOf("検査していないものを「検査した」とは表示しません") >= 0,
  "The screen must say what the checks do not cover.");
assert(screenText.indexOf("検査できません") >= 0,
  "The screen must name the limit of the checks in the reader's words.");

// ---- one setting, one control, two named states ----
//
// This is not one of the operations above it: it is a mode that applies
// to whichever of them were chosen. It used to be two controls for one
// binary - a card offering the default, and a row called 詳細オプション
// holding the other answer - so the same yes/no was on screen twice and
// the reader had to open the second to learn what the first refused.
function switchOf(screen) {
  return dom.collect(screen, function (node) {
    return node.getAttribute &&
      node.getAttribute("data-component") === "modeSwitch";
  });
}

function segmentsOf(screen) {
  return dom.collect(screen, function (node) {
    return node.classList &&
      node.classList.contains("mode-switch-option");
  });
}

var switches = switchOf(nextStep);
var segments = segmentsOf(nextStep);

assert(switches.length === 1,
  "How far the code may change is one control: " + switches.length);
assert(screenText.indexOf("詳細オプション") < 0,
  "The duplicate detail row is gone.");
assert(segments.length === 2,
  "The setting has exactly two states: " + segments.length);
assert(segments[0].getAttribute("aria-checked") === "true" &&
  segments[1].getAttribute("aria-checked") === "false",
"Exactly one state is in force, and it is the default.");
// Which one is on must be readable as words, not inferred from a
// highlighted side.
assert(dom.text(segments[0]).indexOf("いま有効") >= 0 &&
  dom.text(segments[1]).indexOf("切り替える") >= 0,
"Both segments say in words whether they are the state in force.");
assert(dom.text(segments[0]).indexOf(minimal.name) >= 0 &&
  dom.text(segments[1]).indexOf(permissive.name) >= 0,
"Each segment is named by its own file, worst-permission last.");
assert(dom.text(segments[1]).indexOf(permissive.description) >= 0,
  "Each segment says what switching to it would permit.");
assert(segments.every(function (segment) {
  return segment.getAttribute("data-action") === "select-change-scope" &&
    segment.getAttribute("data-scope-file") !== null;
}), "Both segments are the same control, addressing their own file.");

store.setChangeScope(permissive);
nextStep = workflow.createNextStepScreen(store.getState());
screenText = dom.text(nextStep);
segments = segmentsOf(nextStep);
assert(screenText.indexOf("構造の検査は行いません") >= 0,
  "With structural change allowed the screen must not imply a check.");
assert(segments[0].getAttribute("aria-checked") === "false" &&
  segments[1].getAttribute("aria-checked") === "true",
"Switching moves the one state rather than adding a second answer.");

// ---- how long the answer lasts ----
// A second diagnosis of the same workbook does not un-answer "how far
// may this change" - the templates go with the findings they were chosen
// against, the scope does not. Reading another workbook does put the
// default back, because that is another run.
store.commitDiagnosisRequest({requestId: requestId});
store.commitDiagnosis(contracts.diagnosis(
  windowObject.MacroStudioDiagnosis,
  {requestId: requestId, modules: store.getState().modules}), "diagnosis.md");
assert(store.getState().changeScope.structure === "allowed",
  "Diagnosing again must not throw away the scope the reader chose.");
store.setBook({
  name: "other.xlsm", path: "C:\\work\\other.xlsm", ext: ".xlsm",
  totalLines: 8
}, [moduleOf("Main", MAIN)]);
assert(store.getState().changeScope.structure === "forbidden",
  "Reading another workbook must put the default back.");

console.log("test-change-scope: PASS");
console.log("the shipped scopes, the four things the guard sees, the Win32 " +
  "Declare it deliberately does not count, the rewrite it cannot see, and " +
  "the screen saying both halves");
