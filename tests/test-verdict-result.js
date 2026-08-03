"use strict";

// The result screen: what follows from the diagnosis.
//
// The diagnosis says what is true. Screen 2 now says what the reader has
// to do about it, and it reads that off two facts they can check rather
// than deciding anything itself:
//
//   要改修   a shipped repair template declares this environment key -
//            the same rule that draws ★推奨 on the next screen, so the
//            two pages can never disagree
//   要確認   no template declares it and it is not an INFO note
//   改修不要  no template declares it and the AI filed it as 補助
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
var repairDir = path.join(root, "presets", "02_改修");
var shippedPresets = fs.readdirSync(repairDir).filter(function (name) {
  return /\.md$/.test(name);
}).sort().map(function (name) {
  return {
    file: "02_改修\\" + name,
    content: readUtf8(path.join(repairDir, name))
  };
});

var MODULE_CODE = (function () {
  var lines = [];
  var index;

  for (index = 1; index <= 40; index += 1) {
    lines.push("    Step" + index + " = " + index);
  }
  lines[7] = "    Declare PtrSafe Sub Sleep Lib \"kernel32\" (ByVal ms As Long)";
  return lines.join("\r\n");
}());

function finding(number, className, key, module, lines) {
  return {
    number: String(number),
    "class": className,
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
  appInfo: {presets: {repair: shippedPresets}},
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
    noFinding: null,
    sections: {
      PURPOSE: "帳票を作ります。",
      FLOW: "Main から始まります。",
      DEPENDENCY: "共有フォルダを使います。",
      ENVIRONMENT: "対象環境では止まります。"
    },
    findings: [
      // a template addresses this one
      finding(1, "BLOCKER", "WIN32API_BLOCKED", "CommonUtil", "8"),
      // no template does, and it is real work
      finding(2, "CONDITIONAL", "FIXED_HOST_NAME"),
      // no template does, and the AI filed it as 補助
      finding(3, "INFO", "-")
    ]
  }
};

var screen = workflow.createFindingsScreen(state);

function collectClass(node, name) {
  return dom.collect(node, function (item) {
    return item.classList && item.classList.contains(name);
  });
}

// ---- three verdicts, one block each ----

var blocks = collectClass(screen, "verdict-block");

assert(blocks.length === 3,
  "Each verdict that has something in it gets a block: " + blocks.length);
assert(blocks[0].classList.contains("verdict-block--repairable") &&
  blocks[1].classList.contains("verdict-block--confirm") &&
  blocks[2].classList.contains("verdict-block--noaction"),
"要改修 comes first, then 要確認, then 改修不要.");

["要改修", "要確認", "改修不要"].forEach(function (label, index) {
  assert(dom.text(blocks[index].querySelector(".verdict-badge")) === label,
    "Block " + index + " must carry the " + label + " badge.");
});

// The row under each block is the problem it belongs to.
function rowsOf(block) {
  return collectClass(block, "group-row");
}

assert(rowsOf(blocks[0]).length === 1 &&
  rowsOf(blocks[0])[0].getAttribute("data-verdict") === "REPAIRABLE",
"The Win32 finding is the one a template addresses.");
assert(rowsOf(blocks[1])[0].getAttribute("data-verdict") === "CONFIRM",
  "A finding no template claims is work outside this tool.");
assert(rowsOf(blocks[2])[0].getAttribute("data-verdict") === "NOACTION",
  "An INFO note no template claims is nothing to do.");

// ---- the strip at the top, including the zeros ----

var tiles = collectClass(screen, "verdict-tile");

assert(tiles.length === 3,
  "All three verdicts are on the strip, so 要改修 0 can be read as an " +
  "answer: " + tiles.length);
assert(dom.text(tiles[0]).indexOf("1") >= 0 &&
  dom.text(tiles[0]).indexOf("要改修") >= 0,
"The strip counts problems, not places.");
assert(dom.text(screen).indexOf("このツールで改修を依頼できる問題が 1 件") >= 0,
  "The conclusion says what can be acted on here.");

// ---- the star and the verdict are the same rule ----

var starred = collectClass(
  workflow.createNextStepScreen(state),
  "choice-card").filter(function (card) {
  return card.classList.contains("is-recommended");
});

assert(starred.length === 1,
  "Exactly the template that earns 要改修 earns the star: " + starred.length);

state.diagnosis.findings = [finding(1, "DEFECT", "FIXED_HOST_NAME")];
var noneScreen = workflow.createFindingsScreen(state);

assert(collectClass(noneScreen, "verdict-block--repairable").length === 0 &&
  dom.text(noneScreen).indexOf(
    "このツールのひな形で直せる問題はありません") >= 0,
"With nothing a template addresses, the screen says so plainly.");
assert(collectClass(
  workflow.createNextStepScreen(state), "choice-card").filter(
  function (card) {
    return card.classList.contains("is-recommended");
  }).length === 0,
"And nothing is starred, because nothing claimed it.");

// ---- zero findings still say what the AI concluded ----

state.diagnosis.findings = [];
state.diagnosis.noFinding = "INSUFFICIENT";
var emptyScreen = workflow.createFindingsScreen(state);

assert(dom.text(emptyScreen).indexOf(
  "この監査範囲では動作阻害要因を確認できませんでした。") >= 0,
"A clean result is still stated.");
assert(dom.text(emptyScreen).indexOf("判断材料が足りず") >= 0,
  "INSUFFICIENT is not the same as clean, and must not read as if it were.");
assert(dom.text(emptyScreen).split(
  "この監査範囲では動作阻害要因を確認できませんでした。").length === 2,
"The same sentence must not be printed twice on one screen.");

// ---- the code opens where the finding is read ----

state.diagnosis.findings = [
  finding(1, "BLOCKER", "WIN32API_BLOCKED", "CommonUtil", "8")
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
state.diagnosis.findings = [finding(1, "INFO", "-")];
assert(dom.collect(workflow.createFindingsScreen(state), function (node) {
  return node.classList &&
    node.classList.contains("disclosure-trigger") &&
    dom.text(node).indexOf("このコードを見る") >= 0;
}).length === 0,
"A finding that names no module must not offer code it cannot show.");

// ---- screen 4 is arranged by the same verdict ----

state.diagnosis.findings = [
  finding(1, "BLOCKER", "WIN32API_BLOCKED", "CommonUtil", "8"),
  finding(2, "CONDITIONAL", "FIXED_HOST_NAME"),
  finding(3, "INFO", "-")
];
state.presetEngine = "AI";
var inputScreen = workflow.createRepairInputScreen(state);
var selectable = dom.collect(inputScreen, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-workflow-input") === "finding-group-select";
});

assert(selectable.length === 3,
  "Every problem can still be sent: " + selectable.length);
assert(dom.text(inputScreen).indexOf("診断で［要改修］になった指摘") >= 0,
  "The screen says which of them this tool was built to carry out.");
assert(collectClass(inputScreen, "disclosure").filter(function (node) {
  return dom.text(node).indexOf("要確認") >= 0;
}).length === 1,
"The ones outside the tool's range are still offered, folded away.");

console.log("test-verdict-result: PASS");
console.log("verdict blocks and badges, the strip including its zeros, the " +
  "star and the verdict sharing one rule, the zero-finding conclusion, the " +
  "code opening under a finding, and screen 4 following the same order");

