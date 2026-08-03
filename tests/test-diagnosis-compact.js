"use strict";

// The short output form, and the decoration a chat client adds on the
// way out.
//
// A finding used to cost eleven sentinel lines, each carrying a 36
// character request id, for four sentences of content - more scaffolding
// than diagnosis, and eleven separate chances for the AI to get the
// shape wrong. It is now one sentinel line and four tagged lines. Both
// forms parse, they may be mixed, and every check below is shared.
//
// The second half is the frustration this is really about: a reply that
// cannot be taken in has to say which check refused it, or the same
// paste goes round again.

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
var context = vm.createContext({window: windowObject});
windowObject.window = windowObject;

["preset-document.js", "diagnosis-package.js"].forEach(function (name) {
  vm.runInContext(readUtf8(path.join(root, "assets", "js", name)), context,
    {filename: name});
});

var api = windowObject.MacroStudioDiagnosis;
var preset = windowObject.MacroStudioPreset;
var ID = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";
var OTHER = "84547cd0-d729-4cab-a9f9-5c7b772ae9d2";
var OPTIONS = {
  requestId: ID,
  modules: [
    {name: "CommonUtil", lineCount: 80},
    {name: "MonthlyReport", lineCount: 80}
  ],
  environment: {
    constraints: [
      {key: "WIN32API_BLOCKED", effect: "blocked", basis: "declared"},
      {key: "FIXED_DRIVE_LETTER", effect: "changed", basis: "inferred"}
    ]
  }
};

function m(rest) {
  return "'@MACROSTUDIO " + ID + " " + rest;
}

var COMPACT = [
  m("DIAG BEGIN 2"),
  m("SECTION PURPOSE 支店ごとの売上を集計するマクロです。"),
  m("SECTION FLOW CommonUtil から始まり、MonthlyReport が集計します。"),
  m("SECTION DEPENDENCY 共有フォルダのブックを開きます。"),
  m("SECTION ENVIRONMENT Windows の関数を直接呼ぶ処理が動きません。"),
  m("FINDING 1 GRADE=B CONFIDENCE=CONFIRMED MODULE=CommonUtil " +
    "PROC=WaitSeconds LINES=8,21 ENVKEY=WIN32API_BLOCKED"),
  "TITLE: 待ち時間の処理が Windows の関数を直接呼んでいます。",
  "CONDITION: 実行すると必ず通ります。",
  "IMPACT: 最初の待ち時間で止まります。",
  "EVIDENCE: CommonUtil の 8 行目に宣言があります。",
  m("FINDING 2 GRADE=B CONFIDENCE=LIKELY MODULE=MonthlyReport " +
    "PROC=LoadSource LINES=42-47 ENVKEY=FIXED_DRIVE_LETTER"),
  "TITLE: 読み込み元がドライブ文字で書かれています。",
  "CONDITION: 同じ割り当てが無い端末で起きます。",
  "IMPACT: 支店データを開けず、実行時エラーで止まります。",
  "EVIDENCE: MonthlyReport の 42 行目で連結しています。",
  m("DIAG COMPLETE 2"),
  m("DIAG END")
].join("\r\n");

// ---- the short form ----

var compact = api.parse(COMPACT, OPTIONS);

assert(compact.ok,
  "The short form must import: " + compact.validationId + "/" +
  compact.reason);
assert(compact.diagnosis.findings.length === 2,
  "Both findings must survive.");
assert(compact.diagnosis.sections.PURPOSE.indexOf("支店ごと") >= 0,
  "A one-line section carries its body.");
assert(compact.diagnosis.findings[0].texts.title.indexOf("待ち時間") >= 0 &&
  compact.diagnosis.findings[0].texts.evidence.indexOf("8 行目") >= 0,
"The four tagged lines become the four texts.");
assert(compact.diagnosis.findings[0].environmentKey === "WIN32API_BLOCKED" &&
  compact.diagnosis.findings[0].lines === "8,21",
"META on the sentinel line is read exactly as a META line is.");

// It is genuinely shorter: that is the whole point of adding it.
var VERBOSE_EQUIVALENT_SENTINELS = 4 * 3 + 2 * 11 + 3;
var compactSentinels = COMPACT.split("\r\n").filter(function (line) {
  return line.indexOf("'@MACROSTUDIO") === 0;
}).length;

assert(compactSentinels * 2 < VERBOSE_EQUIVALENT_SENTINELS,
  "The short form must cost less than half the sentinel lines: " +
  compactSentinels + " vs " + VERBOSE_EQUIVALENT_SENTINELS);

// ---- the two forms may be mixed ----

var MIXED = [
  m("DIAG BEGIN 1"),
  m("SECTION BEGIN PURPOSE"),
  "支店ごとの売上を集計するマクロです。",
  m("SECTION END PURPOSE"),
  m("SECTION FLOW CommonUtil から始まります。"),
  m("SECTION DEPENDENCY 共有フォルダのブックを開きます。"),
  m("SECTION ENVIRONMENT 対象環境では動きません。"),
  m("FINDING 1 GRADE=A CONFIDENCE=UNVERIFIED MODULE=- PROC=- " +
    "LINES=- ENVKEY=-"),
  "TITLE: 補助情報です。",
  "CONDITION: 常に成立します。",
  "IMPACT: 影響はありません。",
  "EVIDENCE: 根拠です。",
  m("DIAG COMPLETE 1"),
  m("DIAG END")
].join("\r\n");

assert(api.parse(MIXED, OPTIONS).ok,
  "A reply that mixes the two forms must import.");

// ---- the shapes a chat client hands back ----

function decorate(text, wrap) {
  return text.split("\r\n").map(wrap).join("\r\n");
}

var SHAPES = {
  fencedWithLanguage: "```text\r\n" + COMPACT + "\r\n```",
  quoted: decorate(COMPACT, function (line) { return "> " + line; }),
  quotedAndFenced: "```\r\n" +
    decorate(COMPACT, function (line) { return "> " + line; }) + "\r\n```",
  bulleted: decorate(COMPACT, function (line) {
    return line.charAt(0) === "'" ? "- " + line : line;
  }),
  curlyApostrophe: decorate(COMPACT, function (line) {
    return line.replace(/^'/, "’");
  }),
  fullWidthAt: decorate(COMPACT, function (line) {
    return line.replace(/^'@/, "'＠");
  }),
  htmlEscaped: decorate(COMPACT, function (line) {
    return line.replace(/^'/, "&#39;");
  }),
  htmlWrapped: decorate(COMPACT, function (line) {
    return line.charAt(0) === "'" ? "<code>" + line + "</code>" : line;
  }),
  backticked: decorate(COMPACT, function (line) {
    return line.charAt(0) === "'" ? "`" + line + "`" : line;
  }),
  blankLines: COMPACT.split("\r\n").join("\r\n\r\n"),
  indented: decorate(COMPACT, function (line) { return "   " + line; })
};

Object.keys(SHAPES).forEach(function (name) {
  var result = api.parse(SHAPES[name], OPTIONS);

  assert(result.ok,
    name + " must import: " + result.validationId + "/" + result.reason);
  assert(result.diagnosis.findings.length === 2,
    name + " must keep both findings.");
  assert(result.diagnosis.findings[0].texts.title.indexOf("待ち時間") >= 0,
    name + " must keep the finding text.");
});

// Folding the line breaks away is still recovery, and still says so.
var folded = api.parse(COMPACT.replace(/\r\n/g, " "), OPTIONS);

assert(folded.ok && folded.recovered === true,
  "A folded short-form reply must import and be reported as rebuilt.");
assert(folded.diagnosis.findings[1].texts.evidence.indexOf("42 行目") >= 0,
  "Rebuilding must split the four tags apart rather than pile them into " +
  "the first one.");

// ---- what decoration must not buy ----

assert(!api.parse(SHAPES.quoted.replace(new RegExp(ID, "g"), OTHER),
  OPTIONS).ok,
"Taking decoration off must not make another request's reply importable.");
assert(!api.parse(
  COMPACT.slice(0, COMPACT.indexOf("DIAG COMPLETE")), OPTIONS).ok,
"A truncated reply is still refused.");

// ---- why it was refused ----

var REFUSALS = [
  ["D13", COMPACT.replace("MODULE=CommonUtil", "MODULE=Missing")],
  ["D14", COMPACT.replace("ENVKEY=WIN32API_BLOCKED", "ENVKEY=NOPE")],
  ["D25", COMPACT.replace("LINES=8,21", "LINES=800")],
  ["D16", COMPACT.replace(
    "EVIDENCE: CommonUtil の 8 行目に宣言があります。\r\n", "")],
  ["D29", COMPACT.replace("DIAG BEGIN 2", "DIAG BEGIN 3")],
  ["D19", COMPACT.replace("DIAG COMPLETE 2", "DIAG COMPLETE 3")],
  ["D01", COMPACT.replace(new RegExp(ID, "g"), OTHER)],
  ["D04", COMPACT.replace(
    "'@MACROSTUDIO " + ID + " SECTION FLOW " +
      "CommonUtil から始まり、MonthlyReport が集計します。\r\n", "")]
];

REFUSALS.forEach(function (row) {
  var result = api.parse(row[1], OPTIONS);

  assert(!result.ok, row[0] + " must be refused.");
  assert(result.validationId === row[0],
    row[0] + " expected, got " + result.validationId + "/" + result.reason);
  assert(typeof result.detail === "string" && result.detail.length > 0,
    row[0] + " must say what was wrong, not only that something was.");
  assert(result.detail.indexOf(row[0]) < 0,
    row[0] + " must not print its own check number inside the sentence.");
  assert(/。$/.test(result.detail),
    row[0] + " must end its reason as a sentence: " + result.detail);
});

// Every id the contract can return has a sentence behind it, so no
// refusal can reach the screen as a bare code.
var source = readUtf8(path.join(
  root, "assets", "js", "diagnosis-package.js"));
var ids = {};
var pattern = /failure\(\s*"([A-Z0-9]+)"/g;
var found;

while ((found = pattern.exec(source)) !== null) {
  ids[found[1]] = true;
}
Object.keys(ids).forEach(function (id) {
  assert(new RegExp("\\n    " + id + ":").test(source),
    "Check " + id + " has no reason written for the reader.");
});
assert(Object.keys(ids).length > 20,
  "The scan found almost no checks, so it is checking nothing.");

// ---- the shipped template asks for the short form ----

var presetText = readUtf8(path.join(
  root, "presets", "01_マクロ改修", "01_診断", "01_動くかどうかの監査.md"));
var parsedPreset = preset.parse(presetText, "diagnose");

assert(parsedPreset.valid, "The diagnosis template must parse.");
[
  "言語名を",
  "コードブロックは回答全体で 1 個",
  "空行を入れないでください",
  "1 物理行",
  "引用記号"
].forEach(function (phrase) {
  assert(parsedPreset.output.body.indexOf(phrase) >= 0,
    "The output rules must state the compatibility note: " + phrase);
});
assert(parsedPreset.instruction.body.indexOf("添付されている場合") >= 0,
  "The instruction must tell the AI to read whatever else was attached.");
assert(parsedPreset.instruction.body.indexOf("原因ごと") >= 0,
  "The instruction must ask for one finding per cause, not per place.");

var example = /```\s*\r?\n([\s\S]*?)\r?\n```/.exec(parsedPreset.output.body);

assert(example, "The template must carry a complete example.");
assert(example[1].indexOf("TITLE:") >= 0 &&
  example[1].indexOf("TEXT BEGIN TITLE") < 0,
"The example must be written in the short form it now asks for.");

console.log("test-diagnosis-compact: PASS");
console.log("the short form, mixing with the long one, quoted / bulleted / " +
  "escaped / fenced / folded replies, the refusals that must survive all " +
  "of that, a reader-facing reason for every check, and the shipped " +
  "template's own example");
