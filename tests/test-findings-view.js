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

function finding(number, grade, confidence, title) {
  return {
    number: number,
    grade: grade,
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

["icons.js", "components.js", "preset-document.js", "handover.js", "screens.js",
  "screens/workflow.js"].forEach(
  function (name) {
    vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
      {filename: name});
  });

var workflow = windowObject.MacroStudioWorkflow;
var presetApi = windowObject.MacroStudioPreset;
var contracts = require("./helpers/contracts");
var catalog = contracts.catalog(presetApi);
var state = {
  busyAction: null,
  presetFile: null,
  appInfo: {presets: {}, catalog: catalog},
  changeScope: catalog.scope[0],
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
    shape: "findings",
    sectionNames: ["PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"],
    findings: [
      finding(5, "A", "UNVERIFIED", "支障なし"),
      finding(4, "A", "LIKELY", "外部前提"),
      finding(3, "C", "LIKELY", "不明"),
      finding(2, "B", "CONFIRMED", "要改修"),
      finding(1, "D", "CONFIRMED", "改修不可")
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
assert(groupRows[0].querySelector(".grade-chip") === null,
  "No letter chip on the row: the section heading already says, in " +
  "words, what this class of problem means.");
assert(groupRows[0].getAttribute("data-grade") === "D",
  "The row must say which class block it belongs to.");
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
var occurrenceText = dom.text(occurrences[0]);
assert(details.hidden !== true &&
  detailText.indexOf("成立条件") >= 0 &&
  detailText.indexOf("影響") >= 0 &&
  detailText.indexOf("根拠") >= 0 &&
  detailText.indexOf("excel-bitness") >= 0 &&
  occurrenceText.indexOf("module: Main") >= 0,
"Inside the box a place shows its condition, impact, location, evidence " +
  "and the environment key it rests on without a second click.");
// Each of those facts once. The location was printed at the head of the
// row and again under 該当箇所, and the constraint's title - which is the
// name of the group this row is already inside - was printed a second
// time next to its key.
assert(occurrenceText.split("module: Main").length === 2,
  "The location must appear once in a place, not twice.");
assert(detailText.indexOf("Excel は 64 bit") < 0 &&
  dom.text(groupRows[0].querySelector(".group-title")) === "Excel は 64 bit",
"The constraint's title is the group's name and is not repeated inside " +
  "every place under it.");
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

// One verdict for the workbook. This fixture has a D finding, so the
// verdict phrase is the D answer - in words, never as a bare letter.
// The letter survives as data-grade and the tone. Five findings naming
// one constraint are one problem, so the breakdown counts problems.
var verdict = screen.querySelector(".verdict");

assert(verdict !== null, "The result page must carry a verdict.");
assert(dom.collect(screen, function (node) {
  return node.classList && node.classList.contains("verdict");
}).length === 1, "There is one verdict, not one per grade.");
assert(dom.text(verdict.querySelector(".verdict-label")) === "総合判定",
  "The card says what it is: the whole-workbook verdict.");
assert(dom.text(verdict.querySelector(".verdict-answer")) ===
  "この環境では動かせない",
"The verdict is the answer in words: " +
  dom.text(verdict.querySelector(".verdict-answer")));
assert(verdict.querySelector(".verdict-letter") === null &&
  dom.text(verdict).indexOf("判定は D") < 0,
"The bare letter is no longer the display.");
assert(verdict.getAttribute("data-grade") === "D" &&
  verdict.classList.contains("verdict--d"),
"The internal grade still travels with the verdict, as data and tone.");
assert(dom.text(verdict.querySelector(".verdict-headline"))
  .indexOf("動かす手段が無い") >= 0,
"The verdict explains in a sentence why, not just that.");
// The reason names the first place that goes wrong - module, procedure,
// lines - and the environment assumption it collides with.
var verdictReason = dom.text(verdict.querySelector(".verdict-reason"));

assert(verdictReason.indexOf("Main の Run") >= 0 &&
  verdictReason.indexOf("1 行目") >= 0,
"The verdict names the first failing module and procedure: " +
  verdictReason);
assert(verdictReason.indexOf("Excel は 64 bit") >= 0,
  "And the environment assumption the code collides with.");
assert(dom.text(verdict).indexOf("ひとつだけ") < 0,
  "The how-grading-works legend is gone: the screen shows meaning, " +
  "not mechanics.");
// The counts are a line of text under it, naming only grades that occur.
var note = dom.text(screen.querySelector(".diagnosis-conclusion-note"));

assert(note.indexOf("改修不可 1件") >= 0 && note.indexOf("5 か所") >= 0,
  "The breakdown counts problems, and the places separately: " + note);
assert(note.indexOf("支障なし") < 0 && note.indexOf("不明") < 0,
  "A grade with nothing in it is not counted at the reader: " + note);
assert(dom.text(screen).indexOf("想定環境: 新しい業務端末（2026-08-01 版）") >= 0,
  "The conclusion band must name the actual environment.");
// One block per grade that has anything in it, worst first.
var blocks = dom.collect(screen, function (node) {
  return node.classList && node.classList.contains("grade-block");
});

assert(blocks.length === 1,
  "One problem in one class means one block: " + blocks.length);
assert(blocks[0].querySelector(".grade-badge") === null &&
  dom.text(blocks[0].querySelector(".grade-title")) ===
    "この環境では動かせないもの" &&
  dom.text(blocks[0].querySelector(".grade-count")) === "1 件",
"The block is headed by what its class means, in words, and how many - " +
  "never by the bare letter.");
assert(blocks[0].classList.contains("result-card"),
  "The class block stands on the same card surface the rest of the " +
  "flow draws cards on.");

state.diagnosis.findings = [];
state.diagnosis.noFinding = "SCOPE_CLEAR";
var empty = workflow.createFindingsScreen(state);
assert(dom.text(empty).indexOf(
  "対象の環境で動かなくなるところは見つかりませんでした。") >= 0 &&
  dom.text(empty).indexOf("診断の範囲は確認できた") >= 0 &&
  dom.collect(empty, function (node) {
    return node.classList && node.classList.contains("finding-row");
  }).length === 0,
"A valid zero-finding diagnosis must have a factual empty result, not an " +
  "empty frame.");
delete state.diagnosis.noFinding;

// ---- the other kind of diagnosis: one grade for the whole workbook ----
// A scoring template returns a letter and its reasoning, and the screen
// says out loud that this is a judgement rather than a fact.
var gradedCatalog = {
  diagnose: [{
    file: "01_診断\\01_採点.md",
    name: "リファクタの価値",
    content: "",
    valid: true
  }],
  repair: [],
  scope: catalog.scope,
  categories: [],
  diagnosisReady: true,
  scopeReady: true,
  defaultScope: catalog.scope[0].file
};
var graded = workflow.createFindingsScreen({
  busyAction: null,
  presetFile: null,
  appInfo: {presets: {}, catalog: gradedCatalog},
  changeScope: catalog.scope[0],
  targetEnvironment: state.targetEnvironment,
  diagnosis: {
    shape: "grade",
    grade: "D",
    sectionNames: ["PURPOSE", "FLOW", "DEPENDENCY", "REASON"],
    sections: {
      PURPOSE: "帳票を作ります。",
      FLOW: "Main から始まります。",
      DEPENDENCY: "共有フォルダを使います。",
      REASON: "ワークシートとの往復が多いためです。"
    },
    findings: []
  }
});

// The other kind of diagnosis returns one judgement for the whole
// workbook and no findings at all. It is the same kind of answer, so it
// is the same component: the answer in words, under the template's own
// name.
assert(dom.text(graded.querySelector(".verdict-label")) ===
    "リファクタの価値の判定" &&
  dom.text(graded.querySelector(".verdict-answer")) === "大きい",
"The graded result must state, in words, what the judgement is worth: " +
  dom.text(graded.querySelector(".verdict-answer")));
assert(graded.querySelector(".verdict-letter") === null &&
  graded.querySelector(".verdict").getAttribute("data-grade") === "D",
"The letter is data, not display, on the graded result too.");
assert(dom.text(graded.querySelector(".verdict-headline"))
  .indexOf("AI の見立て") >= 0,
"A qualitative grade must be shown as a judgement, not as a fact.");
assert(dom.text(graded).indexOf("ワークシートとの往復が多い") >= 0,
  "The reasoning the template asked for must be on the screen.");
assert(dom.collect(graded, function (node) {
  return node.classList && node.classList.contains("group-row");
}).length === 0,
"A graded diagnosis has no findings, so it shows no finding rows.");

// ---- the star is drawn from the diagnosis, never from the template ----
// Each shipped template declares which environment constraints it
// addresses. A finding that names one earns the badge; a finding that
// names none earns nothing, however plausible the template looks.
var shippedPresets = catalog.repair;

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

state.diagnosis.findings = [finding(1, "B", "CONFIRMED", "見つかった事実")];

function titlesOf(className) {
  return dom.collect(
    workflow.createNextStepScreen(state),
    function (node) {
      return node.classList && node.classList.contains(className);
    }).map(function (node) {
    return dom.text(node);
  });
}

var headings = titlesOf("category-heading");
// The change scope is drawn on the same screen, but it is a mode switch
// rather than a card, so every card here is an operation.
var orderedTitles = dom.collect(
  workflow.createNextStepScreen(state),
  function (node) {
    return node.classList && node.classList.contains("choice-card");
  }).map(function (card) {
  return dom.text(card.querySelector(".choice-title"));
});

// The headings are the files' own, in the order the folder offers them.
// Nothing here is a list the app keeps.
assert(JSON.stringify(headings) === JSON.stringify(catalog.categories) &&
  headings.length >= 2,
"The category headings must be the declared ones, in the offered order: " +
  JSON.stringify(headings));
// Inside each heading the leading file number is the whole of the
// ordering rule, and every shipped operation is reachable.
assert(orderedTitles.length === shippedPresets.length &&
  orderedTitles[0].indexOf("Win32") >= 0 &&
  orderedTitles[1].indexOf("外部プログラム") >= 0 &&
  orderedTitles[2].indexOf("固定パス") >= 0 &&
  orderedTitles[3].indexOf("ファイル操作") >= 0 &&
  orderedTitles[4].indexOf("診断で見つかった") >= 0 &&
  orderedTitles[5].indexOf("自分で") >= 0,
"The templates must be offered grouped and in the fixed order: " +
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

assert(cards.length === shippedPresets.length,
  "Every template must still be offered.");
cards.forEach(function (card) {
  assert(card.getAttribute("role") === "checkbox" &&
    card.getAttribute("aria-checked") !== null,
  "A card that can be chosen alongside another must say it is a " +
    "checkbox, not a pressed button.");
  assert(card.querySelector(".choice-checkbox") !== null,
    "A checkbox card must draw its box.");
});
// The change scope is one answer, not a set of them, and it applies to
// every operation ticked above rather than being another operation. So
// it is the ordinary on/off switch, drawn once. A screen that drew it
// as more cards would be telling the reader they could allow and forbid
// at the same time.
var scopeScreen = workflow.createNextStepScreen(state);
var scopeToggles = dom.collect(scopeScreen, function (node) {
  return node.getAttribute &&
    node.getAttribute("data-component") === "toggleSwitch";
});

assert(scopeToggles.length === 1,
  "The change scope is one switch: " + scopeToggles.length);
var scopeControl = scopeToggles[0].querySelector(".toggle-control");

assert(scopeControl.getAttribute("role") === "switch" &&
  scopeControl.getAttribute("aria-checked") === "false",
"The switch says it is a switch, and the default scope reads as OFF.");
assert(dom.text(scopeScreen).indexOf("いまの設定") >= 0 &&
  dom.text(scopeScreen).indexOf(catalog.scope[0].name) >= 0,
"The value in force is written out above the switch, in words.");
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
console.log("A-D blocks and tiles, one row per cause, evidence hierarchy, " +
  "summary rows, zero-finding rendering, the graded result, the fixed " +
  "template order, the diagnosis-backed recommendation, checkbox cards " +
  "and the shared source block match the contract");
