"use strict";

// A diagnosis a real chat actually wrote, kept exactly as it came back.
//
// On 2026-08-02 this reply could not be taken in. It was correct - four
// findings, every section, every meta field, the right module and the
// right environment keys - and it opened with `DIAG BEGIN 4`. The parser
// read that number as a format version, refused anything but `1`, and
// dropped the whole reply (D03). Nothing in the request had ever said
// what the number was for, and every other trailing number in the format
// is a count: `FINDING BEGIN <n>`, `DIAG COMPLETE <n>`, `PART <n> OF <n>`.
// The shipped example even opened `BEGIN 1` and closed `COMPLETE 2`.
//
// The format now means what it looked like it meant: the opener carries
// the number of findings. This test holds the real reply against that,
// so the contract can never drift away from what a competent answerer
// writes when it reads the request.
//
// It also pins the refusals that must stay refusals.

var fs = require("fs");
var path = require("path");
var vm = require("vm");

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
var context = vm.createContext({
  window: windowObject,
  Math: Math,
  JSON: JSON,
  Uint8Array: Uint8Array
});
windowObject.window = windowObject;

["response-package.js", "diagnosis-package.js", "target-environment.js"]
  .forEach(function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)),
      context, {filename: name});
  });

var diagnosis = windowObject.MacroStudioDiagnosis;
var environment = windowObject.MacroStudioTargetEnvironment;

var REQUEST_ID = "f0406438-85a1-4329-8c7b-b8cde869e030";
var reply = readUtf8(path.join(
  root, "tests", "fixtures", "real-replies",
  "s01-fixed-drive-diagnosis.txt"))
  .split("{{REQUEST_ID}}").join(REQUEST_ID);

// The workbook this reply was written about: guide sample S01, whose
// module list and line counts the findings point into.
var modules = [
  {name: "ExportSummary", type: "standard", lineCount: 70},
  {name: "Sheet1", type: "document", lineCount: 0},
  {name: "Sheet2", type: "document", lineCount: 0},
  {name: "ThisWorkbook", type: "document", lineCount: 0}
];

// parse() returns the validated profile, or throws.
var profile = environment.parse(readUtf8(
  path.join(root, "environment", "target-environment.json")));
assert(profile && Array.isArray(profile.constraints),
  "The shipped environment must parse.");

function parse(text) {
  return diagnosis.parse(text, {
    requestId: REQUEST_ID,
    modules: modules,
    environment: profile
  });
}

// ---- the reply as it actually came back ----

var result = parse(reply);
assert(result.ok,
  "The real reply must be accepted, but got " +
    result.validationId + ": " + result.reason);
assert(result.diagnosis.findings.length === 4,
  "All four findings must survive, got " + result.diagnosis.findings.length);
assert(reply.split("\r\n")[0].indexOf("DIAG BEGIN 4") > 0,
  "This fixture is only meaningful while it opens with the count.");
["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"].forEach(function (name) {
  assert(String(result.diagnosis.sections[name] || "").length > 0,
    "The " + name + " section must come through with its text.");
});
assert(result.diagnosis.findings.every(function (finding) {
  return finding.module === "ExportSummary";
}), "Every finding points at the module the reply named.");
assert(result.diagnosis.findings.some(function (finding) {
  return finding.environmentKey === "FIXED_DRIVE_LETTER";
}), "The fixed drive letter is what this sample is about.");

// The screen can be reached: a diagnosis with findings is what the
// findings screen needs.
assert(result.diagnosis.noFinding === null,
  "A reply with findings must not be recorded as a zero-finding result.");

// ---- what must still be refused ----

function expectRefusal(text, id, label) {
  var refused = parse(text);
  assert(!refused.ok, label + " must be refused.");
  assert(refused.validationId === id,
    label + " must be refused by " + id + ", got " + refused.validationId);
}

expectRefusal(
  reply.split(REQUEST_ID).join("11111111-1111-4111-8111-111111111111"),
  "D01",
  "A reply to another request");

expectRefusal(
  reply.replace("DIAG BEGIN 4", "DIAG BEGIN 3"),
  "D29",
  "An opener that disagrees with the findings actually written");

expectRefusal(
  reply.replace("DIAG COMPLETE 4", "DIAG COMPLETE 3"),
  "D19",
  "A closer that disagrees with the findings actually written");

expectRefusal(
  reply.replace("DIAG BEGIN 4", "DIAG BEGIN 04"),
  "D03",
  "An opener whose number is not canonical decimal");

expectRefusal(
  reply.replace("MODULE=ExportSummary", "MODULE=NoSuchModule"),
  "D13",
  "A finding that names a module the workbook does not have");

expectRefusal(
  reply.replace("\r\n'@MACROSTUDIO " + REQUEST_ID + " DIAG END", ""),
  "D02",
  "A reply that was cut off before the end");

// ---- and the flow can move on to the findings screen ----
//
// Accepting the text is not the same as being able to read it. This
// walks the product's own state and screen rules with the real reply, so
// "Fixed Drive reaches the diagnosis screen" is a checked fact.

var flowWindow = {};
var flowContext = vm.createContext({
  window: flowWindow,
  Math: Math,
  JSON: JSON,
  Uint8Array: Uint8Array
});
flowWindow.window = flowWindow;
["preset-document.js", "response-package.js", "diagnosis-package.js",
  "vba-lexer.js", "path-map.js", "screens.js",
  "state.js"].forEach(function (name) {
  vm.runInContext(readUtf8(path.join(root, "assets", "js", name)),
    flowContext, {filename: name});
});

var store = flowWindow.MacroStudioState;
var screens = flowWindow.MacroStudioScreens;

var WORK = "C:" + String.fromCharCode(92) + "work" + String.fromCharCode(92);

// Everything the run offers comes off the presets folder, so the catalog
// is in place before the workbook is read.
store.setAppInfo({
  version: "test",
  presets: {},
  catalog: require("./helpers/contracts").catalog(flowWindow.MacroStudioPreset)
});
assert(store.getState().screen === screens.bookScreen,
  "The flow starts at the workbook.");

store.setBook({
  name: "S01_fixed_drive.xlsm",
  path: WORK + "S01_fixed_drive.xlsm",
  ext: ".xlsm",
  totalLines: 70
}, modules.map(function (module) {
  return {
    name: module.name,
    type: module.type,
    typeLabel: module.type === "standard" ? "標準モジュール" : "ドキュメントモジュール",
    ext: module.type === "standard" ? "bas" : "cls",
    lineCount: module.lineCount,
    code: "",
    attributes: ""
  };
}));
store.setTargetEnvironment(profile, "ENVIRONMENT-SNAPSHOT");
// The reader has read the workbook and walked on to the diagnosis.
assert(store.canGoNext() && store.goNext() &&
  store.getState().screen === screens.diagnoseScreen,
"The attached workbook leads to the diagnosis screen.");
store.commitDiagnosisRequest({
  requestId: REQUEST_ID,
  requestText: "",
  prompt: "prompt",
  requestPath: "diagnose-request.md",
  runFolder: WORK + "run",
  outputTimestamp: "20260802_122925"
});

var accepted = flowWindow.MacroStudioDiagnosis.parse(reply, {
  requestId: REQUEST_ID,
  modules: store.getState().modules,
  environment: profile
});
assert(accepted.ok,
  "The real reply must parse against the attached workbook, got " +
    accepted.validationId);
assert(store.commitDiagnosis(accepted.diagnosis, "diagnosis.md"),
  "The real diagnosis must be committable to the run.");
assert(screens.isDiagnosisCurrent(store.getState()),
  "The committed diagnosis must belong to this request and this workbook.");
assert(store.canGoNext(),
  "Fixed Drive must be able to move on once the reply is in.");
assert(store.goNext() &&
  store.getState().screen === screens.findingsScreen,
"Fixed Drive must reach the findings screen.");
assert(screens.describe(store.getState(), screens.findingsScreen)
  .meta.indexOf("4") === 0,
"The findings screen must report the four findings that came back.");

console.log("test-real-diagnosis-reply: PASS");
console.log(
  "the diagnosis a real chat wrote for S01 is accepted with all four " +
  "findings, and another request, a miscounted opener or closer, a " +
  "non-canonical count, an unknown module and a truncated reply are " +
  "still refused");
