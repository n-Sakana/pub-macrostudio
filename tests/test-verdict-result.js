"use strict";

// The result screen: what follows from the diagnosis.
//
// This page used to work out the verdict itself, by asking whether any
// shipped template declared the finding's environment key. That was the
// app deciding what a finding meant, and it could only ever mean "we
// happen to ship a file about this". The judgement moved to where it
// belongs: the AI grades each finding A-D against the entrance's own
// criteria, and this screen reads the letter back.
//
//   A 支障なし    動作に支障はない
//   B 要改修      動かない、そしてこのツールのひな形で直せる
//   C 不明        動かない、原因がコードの外にある
//   D 改修不可    動かない、置き換え先が存在しないことが確定している
//
// Only B can be sent, so B is the only grade the repair screen offers.
// The star on the template cards is a different question - "does this
// file talk about this environment key" - and stays where it was.
//
// The other half is that a finding names lines, and the module is on
// this machine, so the code opens where the finding is read.

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
var context = vm.createContext({
  window: windowObject,
  document: documentObject
});
windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "preset-document.js", "handover.js", "vba-highlight.js",
  "code-view.js", "screens.js", "screens/workflow.js"].forEach(
  function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
      {filename: name});
  });

var workflow = windowObject.MacroStudioWorkflow;
var presetApi = windowObject.MacroStudioPreset;
var catalog = require("./helpers/contracts").catalog(presetApi);

var MODULE_CODE = (function () {
  var lines = [];
  var index;

  for (index = 1; index <= 40; index += 1) {
    lines.push("    Step" + index + " = " + index);
  }
  lines[7] = "    Declare PtrSafe Sub Sleep Lib \"kernel32\" (ByVal ms As Long)";
  return lines.join("\r\n");
}());

function finding(number, grade, key, module, lines) {
  return {
    number: String(number),
    grade: grade,
    confidence: "CONFIRMED",
    module: module || "-",
    procedure: "-",
    lines: lines || "-",
    environmentKey: key,
    texts: {
      title: "指摘 " + number,
      condition: "成立条件 " + number,
      impact: "影響 " + number,
      evidence: "根拠 " + number
    }
  };
}

var state = {
  busyAction: null,
  presetFile: null,
  presetFiles: [],
  selectedFindings: [],
  extraRequest: "",
  questions: [],
  answers: {},
  appInfo: {presets: {}, catalog: catalog},
  changeScope: catalog.scope[0],
  modules: [{name: "CommonUtil", code: MODULE_CODE, lineCount: 40}],
  targetEnvironment: {
    displayName: "新しい業務端末",
    revision: "2026-08-01",
    constraints: [
      {
        key: "WIN32API_BLOCKED",
        axis: "execution",
        title: "Win32 API が実行できない",
        basis: "declared"
      },
      // The one shipped constraint no template claims: a bare host name
      // in a literal cannot be told apart from any other string, so it
      // is work for a person rather than for this tool.
      {
        key: "FIXED_HOST_NAME",
        axis: "host",
        title: "固定の接続先ホスト名が変わる可能性がある",
        basis: "inferred"
      }
    ]
  },
  diagnosis: {
    shape: "findings",
    sectionNames: ["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"],
    noFinding: null,
    sections: {
      PURPOSE: "帳票を作ります。",
      FLOW: "Main から始まります。",
      DEPENDENCY: "共有フォルダを使います。",
      ENVIRONMENT: "対象環境では止まります。"
    },
    findings: [
      // does not run, and this tool can rewrite it
      finding(1, "B", "WIN32API_BLOCKED", "CommonUtil", "8"),
      // does not run, and the cause is outside the code
      finding(2, "C", "FIXED_HOST_NAME"),
      // runs fine
      finding(3, "A", "-")
    ]
  }
};

var screen = workflow.createFindingsScreen(state);

function collectClass(node, name) {
  return dom.collect(node, function (item) {
    return item.classList && item.classList.contains(name);
  });
}

// ---- one block per grade that has something in it ----

var blocks = collectClass(screen, "grade-block");

assert(blocks.length === 3,
  "Each grade that has something in it gets a block: " + blocks.length);
assert(blocks[0].classList.contains("grade-block--c") &&
  blocks[1].classList.contains("grade-block--b") &&
  blocks[2].classList.contains("grade-block--a"),
"Worst first: C is read before B, and B before A.");

["C", "B", "A"].forEach(function (letter, index) {
  assert(dom.text(blocks[index].querySelector(".grade-badge")) === letter,
    "Block " + index + " must carry the " + letter + " badge.");
});
["不明", "要改修", "支障なし"].forEach(function (label, index) {
  assert(dom.text(blocks[index].querySelector(".grade-title")) === label,
    "Block " + index + " must say what its letter means: " + label);
});
// Each block says, in a sentence, what the letter asks of the reader.
assert(dom.text(blocks[0].querySelector(".grade-note"))
  .indexOf("このツールでは直せません") >= 0,
"C must say that the cause is outside what this tool can rewrite.");
assert(dom.text(blocks[1].querySelector(".grade-note"))
  .indexOf("ひな形で改修を依頼できます") >= 0,
"B must say that the repair can be asked for here.");

// The row under each block is the problem it belongs to.
function rowsOf(block) {
  return collectClass(block, "group-row");
}

assert(rowsOf(blocks[0]).length === 1 &&
  rowsOf(blocks[0])[0].getAttribute("data-grade") === "C",
"A finding whose cause is outside the code is filed under C.");
assert(rowsOf(blocks[1])[0].getAttribute("data-grade") === "B",
  "A finding this tool can rewrite is filed under B.");
assert(rowsOf(blocks[2])[0].getAttribute("data-grade") === "A",
  "A finding that does not stop the macro is filed under A.");

// ---- the strip at the top, including the zeros ----

var tiles = collectClass(screen, "grade-tile");

assert(tiles.length === 4,
  "All four letters are on the strip, so 要改修 0 can be read as an " +
  "answer: " + tiles.length);
assert(dom.text(tiles.filter(function (tile) {
  return dom.text(tile.querySelector(".grade-tile-letter")) === "D";
})[0]).indexOf("0") >= 0,
"A letter with nothing under it still shows its zero.");
assert(dom.text(tiles[0].querySelector(".grade-tile-count")) === "0" &&
  dom.text(tiles[1].querySelector(".grade-tile-count")) === "1",
"The strip counts problems, not places.");
// The headline states the worst grade present, which here is C.
assert(dom.text(screen.querySelector(".diagnosis-conclusion-verdict"))
  .indexOf("環境の側で手を打つ") >= 0,
"The conclusion says what the worst grade asks of the reader.");

// ---- the star is still the template's own declaration ----
// Which template a diagnosis points at is a different question from what
// grade a finding got: it is whether a file says it addresses that
// environment key. A grade cannot star anything by itself.

var starred = collectClass(
  workflow.createNextStepScreen(state),
  "choice-card").filter(function (card) {
  return card.classList.contains("is-recommended");
});

assert(starred.length === 1,
  "Exactly the template declaring WIN32API_BLOCKED earns the star: " +
    starred.length);

state.diagnosis.findings = [finding(1, "B", "FIXED_HOST_NAME")];
assert(collectClass(
  workflow.createNextStepScreen(state), "choice-card").filter(
  function (card) {
    return card.classList.contains("is-recommended");
  }).length === 0,
"Nothing is starred when no template claims the key, whatever the grade.");

// ---- zero findings still say what the AI concluded ----

state.diagnosis.findings = [];
state.diagnosis.noFinding = "INSUFFICIENT";
var emptyScreen = workflow.createFindingsScreen(state);

assert(dom.text(emptyScreen).indexOf(
  "対象の環境で動かなくなるところは見つかりませんでした。") >= 0,
"A clean result is still stated.");
assert(dom.text(emptyScreen).indexOf("判断材料が足りず") >= 0,
  "INSUFFICIENT is not the same as clean, and must not read as if it were.");
assert(dom.text(emptyScreen).split(
  "対象の環境で動かなくなるところは見つかりませんでした。").length === 2,
"The same sentence must not be printed twice on one screen.");

// ---- the code opens where the finding is read ----

state.diagnosis.findings = [
  finding(1, "B", "WIN32API_BLOCKED", "CommonUtil", "8")
];
state.diagnosis.noFinding = null;
var codeScreen = workflow.createFindingsScreen(state);
var trigger = dom.collect(codeScreen, function (node) {
  return node.classList &&
    node.classList.contains("disclosure-trigger") &&
    dom.text(node).indexOf("このコードを見る") >= 0;
});

assert(trigger.length === 1,
  "A finding that names a module offers its code: " + trigger.length);
assert(dom.text(trigger[0]).indexOf("CommonUtil") >= 0 &&
  dom.text(trigger[0]).indexOf("8 行目") >= 0,
"The row says which module and which lines before it is opened.");
assert(dom.text(codeScreen).indexOf("Step40") < 0,
  "The module is built when the row is opened, not on every render.");

// A finding with no module has nothing to open.
state.diagnosis.findings = [finding(1, "A", "-")];
assert(dom.collect(workflow.createFindingsScreen(state), function (node) {
  return node.classList &&
    node.classList.contains("disclosure-trigger") &&
    dom.text(node).indexOf("このコードを見る") >= 0;
}).length === 0,
"A finding that names no module must not offer code it cannot show.");

// ---- the repair screen carries B and only B ----
// C has its cause outside the code and D has nowhere to go, so putting
// either into a request would ask the chat for something that cannot be
// done. They stay on the page before and in the handover memo.

state.diagnosis.findings = [
  finding(1, "B", "WIN32API_BLOCKED", "CommonUtil", "8"),
  finding(2, "C", "FIXED_HOST_NAME"),
  finding(3, "A", "-")
];
state.presetEngine = "AI";
var inputScreen = workflow.createRepairInputScreen(state);
var selectable = dom.collect(inputScreen, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-workflow-input") === "finding-group-select";
});

assert(selectable.length === 1,
  "Only the B finding can be sent: " + selectable.length);
assert(dom.text(inputScreen).indexOf("診断で B（要改修）になった指摘です。") >= 0,
  "The screen says which grade it is carrying out.");
assert(dom.text(inputScreen).indexOf(
  "C（不明）と D（改修不可）の 1 件は、") >= 0,
"What is left out must be said, and counted, rather than silently absent.");
assert(dom.text(inputScreen).indexOf("引渡しメモ") >= 0,
  "And the screen must say where the ones left out go instead.");

// With no B at all the screen says so and the write-in box is the run.
state.diagnosis.findings = [finding(2, "C", "FIXED_HOST_NAME")];
assert(dom.text(workflow.createRepairInputScreen(state)).indexOf(
  "このツールで直せる指摘はありませんでした。") >= 0,
"With nothing to send, the screen says so plainly.");

console.log("test-verdict-result: PASS");
console.log("A-D blocks and their notes, the strip including its zeros, the " +
  "star staying the template's own declaration, the zero-finding " +
  "conclusion, the code opening under a finding, and the repair screen " +
  "carrying B and only B");
