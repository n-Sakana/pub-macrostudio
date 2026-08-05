"use strict";

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
var context = vm.createContext({window: windowObject, document: documentObject});
windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "components.js", "diagnosis-package.js", "screens.js", "state.js",
  "screens/workflow.js"].forEach(function (name) {
  vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
    {filename: name});
});

var store = windowObject.MacroStudioState;
var screens = windowObject.MacroStudioScreens;
var workflow = windowObject.MacroStudioWorkflow;
var uniqueCandidate = "候補はひな形だけが持つ 8f64b2";
var diagnosisId = "11111111-1111-4111-8111-111111111111";

store.setBook({
  name: "book.xlsm", path: "C:\\books\\book.xlsm", ext: ".xlsm",
  totalLines: 3
}, [{
  name: "Main", type: "standard", lineCount: 3,
  code: "Option Explicit\r\nPublic Sub Run()\r\nEnd Sub", attributes: ""
}]);
store.setTargetEnvironment({displayName: "test", revision: "1"}, "ENV");
store.commitDiagnosisRequest({requestId: diagnosisId});
var diagnosis = contracts.diagnosis(windowObject.MacroStudioDiagnosis, {
  requestId: diagnosisId,
  modules: store.getState().modules,
  findings: [{
    number: "1",
    // Only B can be sent: it is the one grade that says both "this does
    // not run" and "this tool can do something about it" (SPEC §2.2.1).
    grade: "B",
    confidence: "CONFIRMED",
    module: "Main",
    procedure: "Run",
    lines: "2",
    title: "固定 API を呼んでいる",
    condition: "常に成立",
    impact: "新環境で止まる",
    evidence: "Declare 文がある"
  }]
});
store.commitDiagnosis(diagnosis, "diagnosis.md");
store.setRepairPreset({
  file: "02_改修\\\\test.md",
  name: "test",
  content: "preset-content",
  parsed: {
    name: "test",
    engine: "AI",
    questions: [{text: "対象日はいつですか"}],
    behaviorCandidates: [uniqueCandidate],
    preserveItems: ["公開手続きを変えない"],
    output: {body: "rules"},
    splitOutput: null
  }
});

var state = store.getState();
assert(!screens.isRepairInputReady(state),
  "An unanswered preset question must keep Next closed.");
store.setAnswer(0, "月末");
// A finding the environment makes mandatory is selected from the start,
// so clear the selection to check the rule that questions alone are not
// work of their own.
store.getState().selectedFindings.slice().forEach(function (id) {
  store.setFindingSelected(id, false);
});
assert(!screens.isRepairInputReady(store.getState()),
  "Answered questions alone are not repair work.");

// A selected finding is the whole instruction. It already carries the
// problem, the location, the condition and the impact, so the screen asks
// for nothing else about it and the reader can go straight on.
store.setFindingSelected(1, true);
store.setExtraRequest("追加の要望あり");
assert(screens.isRepairInputReady(store.getState()),
  "A selected finding plus answered questions must open Next.");

store.setFindingSelected(1, false);
assert(screens.isRepairInputReady(store.getState()),
  "Extra text alone is valid when no finding remains selected.");
store.setExtraRequest("");
assert(!screens.isRepairInputReady(store.getState()),
  "No selected finding and no extra request must close Next.");

store.setFindingSelected(1, true);
assert(screens.isRepairInputReady(store.getState()),
  "A selected finding alone is work enough.");

// Everything the screen used to ask per finding is gone: the desired
// behaviour box, the candidate chips that filled it, the per-finding
// supplement, and the template's own list of things to preserve.
var inputScreen = workflow.createRepairInputScreen(store.getState());
var screenText = dom.text(inputScreen);

[
  "choose-behaviour-candidate",
  "desired-behaviour",
  "finding-supplement"
].forEach(function (name) {
  assert(dom.collect(inputScreen, function (node) {
    return node.getAttribute &&
      (node.getAttribute("data-action") === name ||
        node.getAttribute("data-workflow-input") === name);
  }).length === 0,
  "The repair input must no longer carry " + name + ".");
});
assert(screenText.indexOf(uniqueCandidate) < 0,
  "Candidate sentences must not be offered as choices any more.");
assert(screenText.indexOf("公開手続きを変えない") < 0,
  "The preserve list is the template's promise to the chat, not a screen.");
assert(screenText.indexOf("補足") < 0,
  "The per-finding supplement must be gone.");
// The reader decides per problem, not per place: one tick takes in every
// occurrence behind it.
assert(dom.collect(inputScreen, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-workflow-input") === "finding-group-select";
}).length === 1,
"The problem must still be selectable as one row.");
store.setSplitOutputRules("モジュールごとに返す規則");
inputScreen = workflow.createRepairInputScreen(store.getState());
assert(dom.collect(inputScreen, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-workflow-input") === "repair-split-output";
}).length === 1,
"The module-by-module reply option belongs to the repair side and stays.");

// The finding's own facts reach the chat instead of a restated sentence.
var requested = workflow.formatSelectedFindings(store.getState());

assert(requested.indexOf("成立条件") >= 0 && requested.indexOf("影響") >= 0,
  "The request must carry the finding's condition and impact.");
assert(requested.indexOf("希望する動作") < 0,
  "The request must not ask for a desired-behaviour line that is no " +
  "longer collected.");

// ---- the optional field is a field, not a grey row ----
// It used to be folded behind a row that wore the sunken grey a disabled
// control wears, labelled 任意. A reader cannot tell that apart from
// "you may not use this", and this one is always usable. So: on the
// screen, open, marked optional in words, and never disabled except
// while the app is busy.
var writeIn = dom.collect(inputScreen, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-component") === "optionalInput";
});

assert(writeIn.length === 1,
  "The extra-request field is the one place on this screen to write: " +
  writeIn.length);
assert(writeIn[0].querySelector(".field-optional-tag") !== null,
  "An optional field says 任意 in words on its own heading.");
assert(dom.text(writeIn[0].querySelector(".field-optional-tag")) === "任意",
  "The optional tag must be the word, not a symbol or a shade.");

var writeInField = writeIn[0].querySelector("textarea");

assert(writeInField !== null,
  "The optional field must actually hold the box it advertises.");
assert(writeInField.disabled === false,
  "An optional field is usable. Only busyAction may disable it.");
assert(writeInField.getAttribute("data-workflow-input") === "extra-request",
  "The optional field keeps the input name the handlers bind to.");
assert(dom.collect(inputScreen, function (node) {
  return node.classList && node.classList.contains("disclosure--writein");
}).length === 0,
"The write-in disclosure is gone: a field is not something to unfold.");

console.log("test-repair-input: PASS");
console.log("question/finding rules, extra-only work, the removal of the " +
  "per-finding form, candidates, supplement and preserve list, and the " +
  "optional write-in field reading as an enabled field behave as specified");
