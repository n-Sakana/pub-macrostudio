"use strict";

// 画面2上部の要約カードは、各 SECTION から 1 行ずつ取って診断全体を述べる
// （SPEC §2.2「診断全体を 2〜3 行で述べる要約」）。
//
// この「1 行」を物理行で取ると、書き手が折り返した位置で切れる。実測した
// 実 AI 返答では PURPOSE が「…入力の不備を見つけ、」で終わっていた。読点で
// 終わり、省略記号も「続きがある」印も無いので、意味の通らない一文が完結した
// 文として出る。内容自体はアコーディオンに全文あるため失われてはいないが、
// 既定表示が壊れている。
//
// 正しい単位は文である。このテストは、要約カードが物理行ではなく最初の一文で
// 切ること、そして全文はアコーディオン側に残っていることを固定する。

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

// 実際に取得した診断返答と同じ形。1 文が物理行をまたいで折り返している。
var PURPOSE_SENTENCE =
  "ブック内の「申請一覧」シートに並んだ申請データを 1 行ずつ点検し、" +
  "入力の不備を見つけ、期限と基準日を比べてステータスを付け替えます。";
var PURPOSE_TEXT =
  "ブック内の「申請一覧」シートに並んだ申請データを 1 行ずつ点検し、\r\n" +
  "入力の不備を見つけ、期限と基準日を比べてステータスを付け替えます。\r\n" +
  "集計結果は「設定」シートへ書き出します。";
var ENVIRONMENT_SENTENCE = "提示された環境で問題になるのは 1 点に集約されます。";
var ENVIRONMENT_TEXT =
  "提示された環境で問題になるのは 1 点に集約されます。Windows の Sleep を\r\n" +
  "Declare で直接呼ぶ処理が 64 bit の対象環境では動きません。";

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
      PURPOSE: PURPOSE_TEXT,
      FLOW: "Main から始まります。",
      DEPENDENCY: "共有フォルダを使います。",
      ENVIRONMENT: ENVIRONMENT_TEXT
    },
    findings: [{
      number: 1,
      class: "BLOCKER",
      confidence: "CONFIRMED",
      basis: "CODE",
      module: "Main",
      procedure: "Run",
      lines: "1",
      environmentKey: "excel-bitness",
      texts: {
        title: "阻害",
        condition: "阻害 の成立条件",
        impact: "阻害 の影響",
        evidence: "阻害 の根拠"
      }
    }]
  }
};

var screen = workflow.createFindingsScreen(state);
var conclusion = dom.collect(screen, function (node) {
  return node.classList &&
    node.classList.contains("diagnosis-conclusion-text");
});

assert(conclusion.length === 2,
  "要約カードは PURPOSE と ENVIRONMENT の 2 行を出す: " + conclusion.length);

var purposeLine = dom.text(conclusion[0]);
var environmentLine = dom.text(conclusion[1]);

// 1. 文として完結していること（これが PROD-08 の中身）
assert(purposeLine === PURPOSE_SENTENCE,
  "PURPOSE の要約行が最初の一文になっていない: " + purposeLine);
assert(environmentLine === ENVIRONMENT_SENTENCE,
  "ENVIRONMENT の要約行が最初の一文になっていない: " + environmentLine);

// 2. 読点で終わらないこと。物理行で切ると必ずここで落ちる。
conclusion.forEach(function (node) {
  var text = dom.text(node);
  assert(text.slice(-1) !== "、",
    "要約行が読点で終わっている（物理行で切っている）: " + text);
});

// 3. 折り返しの改行が本文に残らないこと
assert(purposeLine.indexOf("\n") < 0 && purposeLine.indexOf("\r") < 0,
  "1 文の中の折り返しが要約行に残っている: " + purposeLine);

// 4. 二文目以降は要約に出さない（要約であって全文ではない）
assert(purposeLine.indexOf("集計結果は") < 0,
  "要約行が二文目まで出している: " + purposeLine);
assert(environmentLine.indexOf("Declare") < 0,
  "要約行が二文目まで出している: " + environmentLine);

// 5. 何も失われていないこと。全文はアコーディオン側にある。
var full = dom.text(screen);
assert(full.indexOf("集計結果は「設定」シートへ書き出します。") >= 0,
  "PURPOSE の全文がアコーディオンから消えている");
assert(full.indexOf("Declare で直接呼ぶ処理が 64 bit の対象環境では動きません。") >= 0,
  "ENVIRONMENT の全文がアコーディオンから消えている");

// 6. 文末が無い節では、書き手の行をそのまま使う（境界を発明しない）
state.diagnosis.sections.PURPOSE = "見出しだけの節\r\n二行目";
var noStop = workflow.createFindingsScreen(state);
var noStopLines = dom.collect(noStop, function (node) {
  return node.classList &&
    node.classList.contains("diagnosis-conclusion-text");
});
assert(dom.text(noStopLines[0]) === "見出しだけの節",
  "句点が無い節で行の切り方を変えてはいけない: " + dom.text(noStopLines[0]));

console.log("test-diagnosis-headline: PASS");
console.log(
  "要約カードは物理行ではなく最初の一文で切り、全文はアコーディオンに残る");
