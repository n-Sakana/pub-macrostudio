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

function finding(number, className, confidence, title) {
  return {
    number: number,
    class: className,
    confidence: confidence,
    basis: confidence === "CONFIRMED" ? "CODE" : "ENVIRONMENT",
    module: "Main",
    procedure: "Run",
    lines: String(number),
    environmentKey: "excel-bitness",
    texts: {
      title: title,
      condition: title + " の成立条件",
      impact: title + " の影響",
      evidence: title + " の根拠"
    }
  };
}

var root = path.resolve(__dirname, "..");
var windowObject = {};
var documentObject = {createElement: dom.createElement};
var context = vm.createContext({window: windowObject, document: documentObject});
windowObject.window = windowObject;
windowObject.document = documentObject;

["icons.js", "preset-document.js", "handover.js", "screens.js",
  "screens/workflow.js"].forEach(
  function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
      {filename: name});
  });

var workflow = windowObject.MacroStudioWorkflow;
var state = {
  busyAction: null,
  presetFile: null,
  appInfo: {presets: {repair: []}},
  targetEnvironment: {
    displayName: "新しい業務端末",
    revision: "2026-08-01",
    constraints: [{
      key: "excel-bitness",
      title: "Excel は 64 bit",
      detail: "",
      sourceIds: []
    }]
  },
  diagnosis: {
    sections: {
      PURPOSE: "帳票を作ります。\r\n月次処理です。",
      FLOW: "Main から始まります。",
      DEPENDENCY: "共有フォルダを使います。",
      ENVIRONMENT: "64 bit Excel を想定します。"
    },
    findings: [
      finding(5, "INFO", "UNVERIFIED", "補助情報"),
      finding(4, "EXTERNAL", "LIKELY", "外部前提"),
      finding(3, "CONDITIONAL", "LIKELY", "条件付き"),
      finding(2, "DEFECT", "CONFIRMED", "不具合"),
      finding(1, "BLOCKER", "CONFIRMED", "阻害")
    ]
  }
};

// Every one of these findings names the same environment constraint, so
// they are one problem found in five places: one row, closed, saying how
// many places. The places are a tier further down.
var screen = workflow.createFindingsScreen(state);
var groupRows = dom.collect(screen, function (node) {
  return node.classList && node.classList.contains("group-row");
});

assert(groupRows.length === 1,
  "Findings that name the same constraint must collapse into one row: " +
  groupRows.length);
assert(dom.text(groupRows[0].querySelector(".group-title")) ===
  "Excel は 64 bit",
"The row must be named after the environment constraint, not after one " +
  "of its occurrences.");
assert(dom.text(groupRows[0].querySelector(".group-count")) ===
  "該当 5 か所",
"The row must say how many places the problem was found in.");
assert(dom.text(groupRows[0].querySelector(".class-chip")) === "阻害",
  "The row must carry the most severe class among its occurrences.");
assert(groupRows[0].querySelector(".group-toggle")
  .getAttribute("aria-expanded") === "false" &&
  groupRows[0].querySelector(".group-panel").hidden === true,
"The places must begin out of the page.");

var occurrences = dom.collect(groupRows[0], function (node) {
  return node.classList && node.classList.contains("occurrence-row");
});
assert(occurrences.length === 5,
  "Every occurrence must still be reachable: " + occurrences.length);

// One accordion opens onto one box, and the places lie flat inside it.
// A second tier of accordion made the reader open a thing only to find
// more things to open, so the detail is simply there.
var details = occurrences[0].querySelector(".finding-detail");
var detailText = dom.text(details);
assert(details.hidden !== true &&
  detailText.indexOf("成立条件") >= 0 &&
  detailText.indexOf("影響") >= 0 &&
  detailText.indexOf("該当箇所") >= 0 &&
  detailText.indexOf("根拠") >= 0 &&
  detailText.indexOf("Excel は 64 bit") >= 0,
"Inside the box a place shows its condition, impact, location, evidence " +
  "and the referenced environment constraint without a second click.");
assert(dom.collect(groupRows[0], function (node) {
  return node.classList && node.classList.contains("occurrence-toggle");
}).length === 0,
"A place must not be a second thing to open.");

// The macro's own description sits under the headline as four rows that
// open, drawn the same way the finding rows are.
var summaryRows = dom.collect(screen, function (node) {
  return node.classList && node.classList.contains("summary-row");
});
assert(summaryRows.length === 4,
  "All four sections of the macro summary must be present as rows.");
summaryRows.forEach(function (row) {
  var toggle = row.querySelector(".summary-toggle");
  var panel = row.querySelector(".summary-panel");

  assert(toggle && toggle.getAttribute("aria-expanded") === "false",
    "Each summary row must begin closed.");
  assert(panel && panel.hidden === true,
    "A closed summary row must keep its body out of the page.");
});
assert(dom.text(screen).indexOf("帳票を作ります。") >= 0,
  "The summary bodies must still carry the section text.");

// The band counts the kinds that are here and says nothing about the
// ones that are not. "補助 0" is a fact about a category, not about this
// workbook, and each one the reader skips past costs the ones that count.
var counts = dom.text(screen.querySelector(".diagnosis-counts"));
assert(counts.indexOf("阻害 1") >= 0 &&
  dom.text(screen).indexOf("想定環境: 新しい業務端末（2026-08-01 版）") >= 0,
"The conclusion band must show class counts and the actual environment.");
assert(counts.indexOf(" 0") < 0,
  "A kind with nothing in it must not take a place in the band: " + counts);
assert(dom.collect(screen.querySelector(".diagnosis-counts"), function (node) {
  return node.classList && node.classList.contains("class-chip");
}).length === 1,
"Five findings that name one constraint are one problem, so the band " +
  "carries one chip.");

state.diagnosis.findings = [];
var empty = workflow.createFindingsScreen(state);
assert(dom.text(empty).indexOf(
  "この監査範囲では動作阻害要因を確認できませんでした。") >= 0 &&
  dom.collect(empty, function (node) {
    return node.classList && node.classList.contains("finding-row");
  }).length === 0,
"A valid zero-finding diagnosis must have a factual empty result, not an " +
  "empty frame.");

// ---- the star is drawn from the diagnosis, never from the template ----
// Each shipped template declares which environment constraints it
// addresses. A finding that names one earns the badge; a finding that
// names none earns nothing, however plausible the template looks.
var repairDir = path.join(root, "presets", "02_改修");
var shippedPresets = fs.readdirSync(repairDir).filter(function (name) {
  return /\.md$/.test(name);
}).sort().map(function (name) {
  return {
    file: "02_改修\\" + name,
    content: readUtf8(path.join(repairDir, name))
  };
});

function starredTitles() {
  return dom.collect(
    workflow.createNextStepScreen(state),
    function (node) {
      return node.classList && node.classList.contains("choice-card");
    }).filter(function (card) {
    return card.classList.contains("is-recommended");
  }).map(function (card) {
    return dom.text(card.querySelector(".choice-title"));
  });
}

state.appInfo = {presets: {repair: shippedPresets}};
state.diagnosis.findings = [finding(1, "BLOCKER", "CONFIRMED", "見つかった事実")];

var orderedTitles = dom.collect(
  workflow.createNextStepScreen(state),
  function (node) {
    return node.classList && node.classList.contains("choice-title");
  }).map(function (node) {
  return dom.text(node);
});

assert(orderedTitles.length === 4 &&
  orderedTitles[0].indexOf("Win32") >= 0 &&
  orderedTitles[1].indexOf("固定パス") >= 0 &&
  orderedTitles[2].indexOf("リファクター") >= 0 &&
  orderedTitles[3].indexOf("自分で") >= 0,
"The templates must be offered in the fixed order: " +
  JSON.stringify(orderedTitles));

state.diagnosis.findings[0].environmentKey = "-";
assert(starredTitles().length === 0,
  "A finding that names no environment constraint must star nothing.");

state.diagnosis.findings[0].environmentKey = "WIN32API_BLOCKED";
assert(JSON.stringify(starredTitles()).indexOf("Win32") >= 0 &&
  starredTitles().length === 1,
"Only the template declaring WIN32API_BLOCKED may be starred: " +
  JSON.stringify(starredTitles()));

// ---- the card is a checkbox, and it is built like one ----
// More than one template may be chosen, so a card that only changed
// colour did not say a second one could be pressed too. And the mark
// column is sized to its own text: a label in a column sized for an icon
// is what pushed 推奨 off the card's edge.
state.diagnosis.findings[0].environmentKey = "WIN32API_BLOCKED";
var cards = dom.collect(
  workflow.createNextStepScreen(state),
  function (node) {
    return node.classList && node.classList.contains("choice-card");
  });

assert(cards.length === 4, "Every template must still be offered.");
cards.forEach(function (card) {
  assert(card.getAttribute("role") === "checkbox" &&
    card.getAttribute("aria-checked") !== null,
  "A card that can be chosen alongside another must say it is a " +
    "checkbox, not a pressed button.");
  assert(card.querySelector(".choice-checkbox") !== null,
    "A checkbox card must draw its box.");
});
var markColumn = cards[0].querySelector(".choice-state");

assert(markColumn && markColumn.children.some(function (child) {
  return child.classList && child.classList.contains("choice-recommended");
}), "The recommendation belongs in the mark column, which is sized for it.");

state.diagnosis.findings[0].environmentKey = "FIXED_DRIVE_LETTER";
assert(JSON.stringify(starredTitles()).indexOf("固定パス") >= 0 &&
  starredTitles().length === 1,
"A fixed-path finding must star the fixed-path template: " +
  JSON.stringify(starredTitles()));

// ---- one component for one purpose ----
// The environment given to the AI and the memo handed over at the end
// are both files. Both are shown through the same block, so the reader
// meets one shape twice instead of two arrangements of the same facts.
var block = workflow.sourceBlock("行1\r\n行2");

assert(block.tagName === "PRE" &&
  block.classList.contains("source-block") &&
  dom.text(block).indexOf("行1") >= 0,
"Managed text must be shown as written, through the shared block.");

var memo = [
  "## 改修対象一覧",
  "",
  "本文A",
  "",
  "## 既知の制約",
  "",
  "- [ ] 残っている作業",
  "",
  "## ロールバック手順",
  "",
  "本文C"
].join("\r\n");

assert(workflow.markdownSection(memo, "既知の制約") ===
  "## 既知の制約\r\n\r\n- [ ] 残っている作業",
"A section must run from its heading to the next one, with the trailing " +
  "blank lines dropped: " +
  JSON.stringify(workflow.markdownSection(memo, "既知の制約")));
assert(workflow.markdownSection(memo, "無い見出し") === "",
  "A heading the memo does not carry must yield nothing, not everything.");

console.log("test-findings-view: PASS");
console.log("class order, INFO collapse, evidence hierarchy, summary rows, " +
  "zero-finding rendering, the fixed template order, the " +
  "diagnosis-backed recommendation, checkbox cards and the shared " +
  "source block match the beta2 contract");
