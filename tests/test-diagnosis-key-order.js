"use strict";

// The refusal the owner met on 2026-08-05, and what has to happen instead.
//
// Three correct diagnoses in a row were thrown away by D09 (metaShape) -
// 22:16:33, 22:16:57 and 23:34:30 in macrostudio_20260805.log. Nothing
// was wrong with any of them except the order the six META keys were
// written in. META is a set of key=value pairs and every reader of it
// looks the values up by name, so the order was a rule the contract
// enforced without needing it.
//
// This test fixes the four things that follow from that:
//
//   1. a correct first reply is taken in at the first attempt
//   2. the same reply with its keys in another order is taken in too,
//      and produces exactly the same diagnosis
//   3. a reply that is genuinely wrong is still refused, and the refusal
//      names the key that is missing and the key nobody asked for
//   4. the retry text put on the clipboard carries those names, so the
//      corrected reply goes in
//
// The fixture is not written here. It is the complete example the shipped
// diagnosis template gives the AI, read off disk: if the template and the
// checker ever disagree, this test is what notices.

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
var documentObject = {
  createElement: dom.createElement,
  createTextNode: dom.createTextNode
};
var context = vm.createContext({window: windowObject, document: documentObject});
windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "components.js", "preset-document.js", "handover.js",
  "diagnosis-package.js", "screens.js", "screens/workflow.js"].forEach(
  function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
      {filename: name});
  });

var diagnosisApi = windowObject.MacroStudioDiagnosis;
var presetApi = windowObject.MacroStudioPreset;
var workflow = windowObject.MacroStudioWorkflow;
var catalog = require("./helpers/contracts").catalog(presetApi);

var REQUEST_ID = "6f1d0d3a-2b70-4c58-9d2c-1f2b7a8e5c41";

// Long enough for every line the shipped example points at.
function moduleOf(name, lineCount) {
  var lines = [];
  var index;

  for (index = 1; index <= lineCount; index += 1) {
    lines.push("    Step" + index + " = " + index);
  }
  return {
    name: name,
    type: "standard",
    typeLabel: "標準モジュール",
    ext: "bas",
    lineCount: lineCount,
    code: lines.join("\r\n"),
    attributes: ""
  };
}

var OPTIONS = {
  requestId: REQUEST_ID,
  modules: [moduleOf("CommonUtil", 40), moduleOf("SalesRules", 80)],
  environment: {
    constraints: [
      {key: "WIN32API_BLOCKED", title: "Win32 API が実行できない"}
    ]
  }
};

// ---- the fixture: the template's own complete example ----

var presetText = readUtf8(path.join(
  root, "presets", "01_診断", "01_動くかどうかの監査.md"));
var parsedPreset = presetApi.parse(presetText, "diagnose");
var exampleMatch = /```\s*\r?\n([\s\S]*?)\r?\n```/.exec(parsedPreset.output.body);

assert(parsedPreset.valid, "The shipped diagnosis template must parse.");
assert(exampleMatch, "The shipped diagnosis template has no complete example.");

var CORRECT = exampleMatch[1]
  .replace(/\{\{REQUEST_ID\}\}/g, REQUEST_ID)
  .replace(/\r?\n/g, "\r\n");

// The template must not ask for something the checker does not want. It
// used to demand an order; saying so again would put the two back out of
// step in the direction that costs the reader a turn.
assert(parsedPreset.output.body.indexOf("並べる順番は問いません") >= 0,
  "The template must tell the AI that META key order does not matter.");
assert(!/META[^\n]*順序を厳守/.test(parsedPreset.output.body),
  "The template must not still demand a key order the checker ignores.");

// ---- 1. the correct reply goes in at the first attempt ----

var first = diagnosisApi.parse(CORRECT, OPTIONS);

assert(first.ok,
  "The template's own example must import in one go: " +
    first.validationId + " / " + first.reason);
assert(first.diagnosis.findings.length === 2,
  "Both findings must survive: " + first.diagnosis.findings.length);

// ---- 2. the same facts, the keys in another order ----

// Reversed, which is the furthest a reply can get from the written order
// while still carrying all six.
function reorderMeta(text, order) {
  return text.replace(
    /(GRADE|CONFIDENCE|MODULE|PROC|LINES|ENVKEY)=\S+(?: (?:GRADE|CONFIDENCE|MODULE|PROC|LINES|ENVKEY)=\S+){5}/g,
    function (block) {
      var pairs = {};

      block.split(" ").forEach(function (pair) {
        pairs[pair.split("=")[0]] = pair;
      });
      return order.map(function (key) {
        return pairs[key];
      }).join(" ");
    });
}

var REVERSED = reorderMeta(
  CORRECT,
  ["ENVKEY", "LINES", "PROC", "MODULE", "CONFIDENCE", "GRADE"]);
var SHUFFLED = reorderMeta(
  CORRECT,
  ["MODULE", "GRADE", "ENVKEY", "CONFIDENCE", "LINES", "PROC"]);

assert(REVERSED !== CORRECT && SHUFFLED !== CORRECT,
  "The reorder helper did not actually move anything.");

[["reversed", REVERSED], ["shuffled", SHUFFLED]].forEach(function (entry) {
  var result = diagnosisApi.parse(entry[1], OPTIONS);

  assert(result.ok,
    "A reply with the same six keys in another order must import (" +
      entry[0] + "): " + result.validationId + " / " + result.reason);
  // Not merely accepted - identical. Order carries no meaning, so it
  // cannot be allowed to change a single value.
  assert(
    JSON.stringify(result.diagnosis.findings) ===
      JSON.stringify(first.diagnosis.findings),
    "Key order must not change the diagnosis (" + entry[0] + ").");
});

// ---- 3. a reply that is genuinely wrong is still refused ----

// Everything else in this file is about not refusing. This is the half
// that must not move: drop a key the contract needs, invent one it does
// not know, and the whole reply is still turned away.
var BROKEN = CORRECT.replace(
  "MODULE=CommonUtil PROC=WaitSeconds",
  "MODULE=CommonUtil SEVERITY=HIGH");
var broken = diagnosisApi.parse(BROKEN, OPTIONS);

assert(!broken.ok && broken.validationId === "D09",
  "A META missing a key and carrying an unknown one is still D09: " +
    broken.validationId);
assert(broken.diagnosis === null,
  "A refused reply imports nothing at all.");
assert(broken.evidence,
  "A refusal the AI could fix must carry the evidence to fix it with.");
assert(broken.evidence.actual.indexOf("PROC") >= 0,
  "The refusal must name the key that is missing: " + broken.evidence.actual);
assert(broken.evidence.actual.indexOf("SEVERITY") >= 0,
  "The refusal must name the key nobody asked for: " + broken.evidence.actual);
assert(broken.evidence.expected.indexOf("並べる順番は問いません") >= 0,
  "What is expected must say the one thing that is not required: " +
    broken.evidence.expected);
assert(broken.evidence.fix.indexOf("PROC") >= 0 &&
  broken.evidence.fix.indexOf("SEVERITY") >= 0,
"The fix must name both edits: " + broken.evidence.fix);
// SPEC 8.4: the reply's own words never come back out of the checker.
assert(broken.evidence.actual.indexOf("WaitSeconds") < 0 &&
  broken.evidence.actual.indexOf("待ち時間") < 0,
"The evidence states facts about the reply, never quotes it: " +
  broken.evidence.actual);

// Two other shapes that must stay refused, so "order is free" has not
// become "anything goes".
[
  ["a key written twice",
    CORRECT.replace("GRADE=B CONFIDENCE=CONFIRMED MODULE=CommonUtil",
      "GRADE=B GRADE=B CONFIDENCE=CONFIRMED MODULE=CommonUtil")],
  ["a value left empty",
    CORRECT.replace("MODULE=CommonUtil", "MODULE=")]
].forEach(function (entry) {
  var result = diagnosisApi.parse(entry[0] === "" ? "" : entry[1], OPTIONS);

  assert(!result.ok && result.validationId === "D09",
    "Still refused: " + entry[0] + " (" + result.validationId + ")");
});

// ---- 4. the retry text names the failure, and the fix goes in ----

// The clipboard text after a refusal. It used to be the contract restated
// in full and nothing else, which asks the chat to find its own mistake
// in a page of rules.
windowObject.MacroStudioState = {
  getState: function () {
    return {
      appInfo: {catalog: catalog},
      diagnosisRequestId: REQUEST_ID,
      outputRules: null
    };
  },
  isDiagnosisRequestDirty: function () { return false; }
};

var retry = workflow.retryText("diagnose", broken);

assert(retry.indexOf("【求めている形】") >= 0 &&
  retry.indexOf("【返ってきた形】") >= 0 &&
  retry.indexOf("【直すところ】") >= 0,
"The retry text must say what was wanted, what came, and what to change.");
assert(retry.indexOf("PROC") >= 0 && retry.indexOf("SEVERITY") >= 0,
  "The retry text must be about this failure, not about failures in " +
  "general: " + retry);
assert(retry.indexOf(REQUEST_ID) >= 0,
  "The retry text must carry the request id the reply has to quote.");
assert(retry.indexOf("{{REQUEST_ID}}") < 0,
  "The retry text must not hand the template placeholder to the chat.");
assert(retry.indexOf("並べる順番は問いません") >= 0,
  "The retry text carries the same output rules the first request did.");

// A check with nothing to add still produces something to send.
var plain = workflow.retryText("diagnose", null);

assert(plain.indexOf("取り込めませんでした") >= 0 &&
  plain.indexOf("【求めている形】") < 0,
"Without evidence the retry text is the rules and no invented detail.");

// The corrected reply - the one the chat sends back after reading the
// retry text - goes in. Its keys are in yet another order, because
// nothing asked it to put them back.
var FIXED = reorderMeta(
  BROKEN.replace("MODULE=CommonUtil SEVERITY=HIGH",
    "PROC=WaitSeconds MODULE=CommonUtil"),
  ["PROC", "ENVKEY", "GRADE", "LINES", "MODULE", "CONFIDENCE"]);
var fixed = diagnosisApi.parse(FIXED, OPTIONS);

assert(fixed.ok,
  "The corrected reply must import: " + fixed.validationId + " / " +
    fixed.reason);
assert(
  JSON.stringify(fixed.diagnosis.findings) ===
    JSON.stringify(first.diagnosis.findings),
  "The corrected reply must be the same diagnosis as the correct one.");

// ---- the screen says the same three things the clipboard does ----

var screen = workflow.createDiagnoseScreen({
  busyAction: null,
  appInfo: {catalog: catalog},
  diagnosisRequestId: REQUEST_ID,
  diagnosisConcern: "",
  targetEnvironmentSnapshot: "環境です。",
  intakeError: {
    diagnose: {
      code: broken.code,
      validationId: broken.validationId,
      reason: broken.reason,
      message: broken.message,
      detail: broken.detail,
      evidence: broken.evidence,
      count: 1
    }
  }
});
var alertBox = dom.collect(screen, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-component") === "alert";
})[0];

assert(alertBox, "A refused paste must leave a standard alert on the screen.");
assert(dom.text(alertBox).indexOf("求めている形") >= 0 &&
  dom.text(alertBox).indexOf("返ってきた形") >= 0 &&
  dom.text(alertBox).indexOf("直すところ") >= 0,
"The screen shows the same three lines the retry text carries.");
assert(dom.text(alertBox).indexOf("D09") >= 0,
  "The check number stays on the screen, for quoting when a chat cannot " +
  "be made to comply.");

console.log("test-diagnosis-key-order: PASS");
console.log("the shipped example imports first time, any key order gives " +
  "the same diagnosis, a missing or unknown key is still refused by name, " +
  "and the retry text and the screen both carry expected/actual/fix");
