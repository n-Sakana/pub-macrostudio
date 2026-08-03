"use strict";

// The output contract and the importer are fixed together here. Every
// shape a chat client can hand back - fenced, unfenced, with a preamble,
// re-indented, or with its line breaks folded away by Markdown - has to
// reach the same diagnosis, and a reply whose lines had to be rebuilt has
// to say so instead of passing as a clean one.

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

["diagnosis-package.js", "preset-document.js"].forEach(function (name) {
  vm.runInContext(
    readUtf8(path.join(root, "assets", "js", name)),
    context,
    {filename: name});
});

var diagnosis = windowObject.MacroStudioDiagnosis;
var preset = windowObject.MacroStudioPreset;
var REQUEST_ID = "3c563519-6f65-4d43-8d4c-1207350f6385";
var MODULES = [
  {name: "AppController", lineCount: 210},
  {name: "TimerUtils", lineCount: 32}
];
var ENVIRONMENT = JSON.parse(readUtf8(path.join(
  root, "environment", "target-environment.json")));

function line(rest) {
  return "'@MACROSTUDIO " + REQUEST_ID + " " + rest;
}

function buildPackage() {
  var out = [];

  out.push(line("DIAG BEGIN 1"));
  [
    ["PURPOSE", "申請一覧シートの申請データを検証し、期限に応じてステータスを更新するマクロです。"],
    ["FLOW", "AppController.RunApplicationReview が入口です。各シートを取得して検証します。"],
    ["DEPENDENCY", "待ち時間の処理だけが TimerUtils の Declare により kernel32 の Sleep に依存しています。"],
    ["ENVIRONMENT", "提示された想定動作環境では Win32 API の Declare 呼び出しが止められます。"]
  ].forEach(function (pair) {
    out.push(line("SECTION BEGIN " + pair[0]));
    out.push(pair[1]);
    out.push(line("SECTION END " + pair[0]));
  });
  out.push(line("FINDING BEGIN 1"));
  out.push(line("META GRADE=B CONFIDENCE=CONFIRMED MODULE=TimerUtils " +
    "PROC=- LINES=5,7 ENVKEY=WIN32API_BLOCKED"));
  out.push(line("TEXT BEGIN TITLE"));
  out.push("待ち時間処理が kernel32 の Sleep を直接呼ぶため、想定環境では実行できません。");
  out.push(line("TEXT END TITLE"));
  out.push(line("TEXT BEGIN CONDITION"));
  out.push("RunApplicationReview を入口として実行すると必ず Sleep 呼び出しへ到達します。");
  out.push(line("TEXT END CONDITION"));
  out.push(line("TEXT BEGIN IMPACT"));
  out.push("初回のシート取得前に処理が止まるため、検証も集計も完了しません。");
  out.push(line("TEXT END IMPACT"));
  out.push(line("TEXT BEGIN EVIDENCE"));
  out.push("TimerUtils の 5 行目に Declare PtrSafe Sub Sleep の宣言があります。");
  out.push(line("TEXT END EVIDENCE"));
  out.push(line("FINDING END 1"));
  out.push(line("DIAG COMPLETE 1"));
  out.push(line("DIAG END"));
  return out.join("\r\n");
}

var PACKAGE = buildPackage();
var options = {
  requestId: REQUEST_ID,
  modules: MODULES,
  environment: ENVIRONMENT
};

// ---- the contract the prompt states ----

var presetText = readUtf8(path.join(
  root, "presets", "01_マクロ改修", "01_診断", "01_動くかどうかの監査.md"));
var parsedPreset = preset.parse(presetText, "diagnose");

assert(parsedPreset.valid, "The diagnosis preset must parse.");
assert(parsedPreset.output.body.indexOf("ひとつだけのコードブロック") >= 0,
  "The output rules must ask for exactly one code block. Without it the " +
  "chat writes the sentinels as Markdown body text and the line " +
  "structure is folded away before it ever reaches the importer.");
assert(parsedPreset.output.body.indexOf("区切りの行は 1 行に 1 つだけ") >= 0,
  "The output rules must ask for one sentinel per line.");
assert(parsedPreset.output.body.indexOf(
  "コードブロックの外には、あいさつ、前置き、要約、感想を書かないで") >= 0,
"The output rules must forbid text outside the block.");
// A diagnosis is prose about a macro, not the macro. It fits in one
// reply, so the template no longer offers to split it and the screen no
// longer asks. Splitting stays only where the reply is code.
assert(parsedPreset.splitDiagnosisOutput === null,
  "The diagnosis template must not offer a split reply.");

// ---- every shape the importer has to accept ----

var shapes = {
  plain: PACKAGE,
  fenced: "```\r\n" + PACKAGE + "\r\n```",
  fencedWithLanguage: "```text\r\n" + PACKAGE + "\r\n```",
  preambleAndFence: "承知しました。診断結果は次のとおりです。\r\n\r\n```\r\n" +
    PACKAGE + "\r\n```\r\n\r\n必要であれば補足します。",
  preambleWithoutFence: "承知しました。診断結果は次のとおりです。\r\n\r\n" +
    PACKAGE + "\r\n\r\n以上です。",
  lineFeedOnly: PACKAGE.replace(/\r\n/g, "\n"),
  indented: PACKAGE.split("\r\n").map(function (item) {
    return "  " + item;
  }).join("\r\n"),
  blankLines: PACKAGE.split("\r\n").join("\r\n\r\n")
};

Object.keys(shapes).forEach(function (name) {
  var result = diagnosis.parse(shapes[name], options);

  assert(result.ok,
    name + " must import: " + result.validationId + "/" + result.reason);
  assert(result.diagnosis.findings.length === 1,
    name + " must keep the finding.");
  assert(result.diagnosis.sections.PURPOSE.indexOf("申請一覧") >= 0,
    name + " must keep the section body.");
  assert(result.recovered !== true,
    name + " is already line-structured and must not be reported as " +
    "recovered.");
});

// ---- the shape that actually came back from the chat ----

var collapsed = PACKAGE.replace(/\r\n/g, " ");
var collapsedResult = diagnosis.parse(collapsed, options);

assert(collapsedResult.ok,
  "A reply whose line breaks Markdown folded away must still import: " +
  collapsedResult.validationId + "/" + collapsedResult.reason);
assert(collapsedResult.recovered === true,
  "A rebuilt reply must be reported as recovered, not passed off as a " +
  "clean one.");
assert(collapsedResult.diagnosis.findings.length === 1,
  "Recovery must keep the finding.");
assert(collapsedResult.diagnosis.sections.PURPOSE.indexOf("申請一覧") >= 0,
  "Recovery must keep the section body, not just the sentinels.");
assert(collapsedResult.diagnosis.findings[0].texts.title.indexOf(
  "kernel32") >= 0,
"Recovery must keep the finding text.");

var collapsedWithPreamble = diagnosis.parse(
  "推論が 16 ステップで完了しました。 " + collapsed,
  options);

assert(collapsedWithPreamble.ok && collapsedWithPreamble.recovered === true,
  "A folded reply with a preamble must import and be reported as " +
  "recovered.");

// ---- what recovery must not do ----

var wrongRequest = diagnosis.parse(collapsed, {
  requestId: "11111111-1111-4111-8111-111111111111",
  modules: MODULES,
  environment: ENVIRONMENT
});

assert(!wrongRequest.ok && wrongRequest.reason === "otherRequest",
  "Recovery must not make a reply from another request importable.");

var truncated = diagnosis.parse(
  collapsed.slice(0, collapsed.indexOf("FINDING END")),
  options);

assert(!truncated.ok,
  "Recovery must not invent the missing end of a truncated reply.");

console.log("test-diagnosis-recovery: PASS");
console.log("the prompt states the single-code-block contract, and the " +
  "importer accepts fenced, unfenced, prefaced, re-indented and " +
  "Markdown-folded replies while still refusing the wrong request and " +
  "truncated ones");
