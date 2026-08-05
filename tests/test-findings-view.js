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

["icons.js", "preset-document.js", "handover.js", "screens.js",
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
assert(dom.text(groupRows[0].querySelector(".grade-chip")) === "D",
  "The row must carry the worst grade among its occurrences.");
assert(groupRows[0].getAttribute("data-grade") === "D",
  "The row must say which grade block it belongs to.");
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

// The band shows all four letters, including the empty ones. The reader
// is asking "what do I have to do", and 「要改修 0」 answers that where
// 「不具合 0」 only described a category. Five findings that name one
// constraint are one problem, so the letters count problems, not lines.
var tiles = dom.collect(screen.querySelector(".grade-tiles"),
  function (node) {
    return node.classList && node.classList.contains("grade-tile");
  });

assert(tiles.length === 4,
  "All four grades must have a tile, even at zero: " + tiles.length);
assert(tiles.map(function (tile) {
  return dom.text(tile.querySelector(".grade-tile-letter"));
}).join("") === "DCBA",
"The letters must run worst first: " + tiles.map(function (tile) {
  return dom.text(tile.querySelector(".grade-tile-letter"));
}).join(""));
assert(dom.text(tiles[0].querySelector(".grade-tile-count")) === "1" &&
  dom.text(tiles[3].querySelector(".grade-tile-count")) === "0",
"The tiles must count problems, not occurrences: " +
  tiles.map(function (tile) {
    return dom.text(tile.querySelector(".grade-tile-count"));
  }).join(","));
assert(dom.text(tiles[0].querySelector(".grade-tile-label")) === "改修不可" &&
  dom.text(tiles[2].querySelector(".grade-tile-label")) === "要改修",
"Each tile must say what its letter means.");
// The worst grade present is what the headline states, so the reader is
// not left to work out what D among A-D implies.
assert(dom.text(screen.querySelector(".diagnosis-conclusion-verdict"))
  .indexOf("動かすことはできません") >= 0,
"The headline must state the worst grade in a sentence.");
assert(dom.text(screen).indexOf("想定環境: 新しい業務端末（2026-08-01 版）") >= 0,
  "The conclusion band must name the actual environment.");
// One block per grade that has anything in it, worst first.
var blocks = dom.collect(screen, function (node) {
  return node.classList && node.classList.contains("grade-block");
});

assert(blocks.length === 1,
  "One problem in one grade means one block: " + blocks.length);
assert(dom.text(blocks[0].querySelector(".grade-badge")) === "D" &&
  dom.text(blocks[0].querySelector(".grade-title")) === "改修不可" &&
  dom.text(blocks[0].querySelector(".grade-count")) === "1 件",
"The block must carry its letter, what it means and how many.");

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

assert(dom.text(graded.querySelector(".grade-badge")) === "D" &&
  dom.text(graded.querySelector(".value-title")) ===
    "リファクタの価値の判定は 大きい",
"The graded result must state the letter and what it is worth: " +
  dom.text(graded.querySelector(".value-title")));
assert(dom.text(graded.querySelector(".value-judgement"))
  .indexOf("AI の見立て") >= 0,
"A qualitative grade must be shown as a judgement, not as a fact.");
assert(dom.text(graded).indexOf("ワークシートとの往復が多い") >= 0,
  "The reasoning the template asked for must be on the screen.");
assert(graded.querySelector(".grade-tiles") === null &&
  dom.collect(graded, function (node) {
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
// The change scope is drawn on the same screen and its options are cards
// too, so the operations are the cards that are not scope cards.
var orderedTitles = dom.collect(
  workflow.createNextStepScreen(state),
  function (node) {
    return node.classList && node.classList.contains("choice-card") &&
      !node.classList.contains("scope-card");
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
    return node.classList && node.classList.contains("choice-card") &&
      !node.classList.contains("scope-card");
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
// The change scope is one answer, not a set of them, so its options say
// radio. A screen that drew both as checkboxes would be telling the
// reader they could allow and forbid at the same time.
dom.collect(
  workflow.createNextStepScreen(state),
  function (node) {
    return node.classList && node.classList.contains("scope-card");
  }).forEach(function (card) {
  assert(card.getAttribute("role") === "radio",
    "A change-scope option must say it is one of a set.");
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
console.log("A-D blocks and tiles, one row per cause, evidence hierarchy, " +
  "summary rows, zero-finding rendering, the graded result, the fixed " +
  "template order, the diagnosis-backed recommendation, checkbox cards " +
  "and the shared source block match the contract");
