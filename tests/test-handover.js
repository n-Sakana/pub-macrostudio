"use strict";

// The改修ガイド asks for six things at handover and four kinds of test.
// This fixes what the memo must contain, and - just as important - that
// the tool never reports a check it did not run as done.

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

vm.runInContext(
  readUtf8(path.join(root, "assets", "js", "handover.js")),
  context,
  {filename: "handover.js"});

var handover = windowObject.MacroStudioHandover;
var ENVIRONMENT = JSON.parse(readUtf8(path.join(
  root, "environment", "target-environment.json")));

function finding(number, className, module, environmentKey) {
  return {
    number: number,
    "class": className,
    confidence: "CONFIRMED",
    module: module,
    procedure: "-",
    lines: String(number),
    environmentKey: environmentKey,
    texts: {
      title: "指摘 " + number + " の題",
      condition: "成立条件",
      impact: "影響",
      evidence: "根拠"
    }
  };
}

var state = {
  book: {name: "申請管理.xlsm", ext: ".xlsm"},
  bookInventory: {
    sha256: "0123456789abcdef",
    sizeBytes: 12345,
    modifiedUtc: "2026-08-01 00:00:00Z",
    references: ["stdole", "Office", "Scripting"],
    connections: ["申請一覧の接続"],
    barcodeFonts: [],
    hasPowerQuery: true,
    activeXCount: 2,
    externalLinkCount: 0,
    hasVbaSignature: false,
    complete: true
  },
  outputName: "申請管理-Modified-20260801.xlsm",
  targetEnvironment: ENVIRONMENT,
  presetName: "Win32 API を使わない形へ直す",
  repairResultEngine: "AI",
  buildResult: {success: true},
  selectedFindings: ["1", "2", "3"],
  modules: [
    {name: "TimerUtils", status: "changed"},
    {name: "AppController", status: "changed"},
    {name: "SystemInfo", status: "unchanged"}
  ],
  diagnosis: {
    sections: {},
    findings: [
      finding(1, "BLOCKER", "TimerUtils", "WIN32API_BLOCKED"),
      finding(2, "BLOCKER", "AppController", "WIN32API_BLOCKED"),
      finding(3, "BLOCKER", "SystemInfo", "WIN32API_BLOCKED"),
      finding(4, "CONDITIONAL", "AppController", "FIXED_DRIVE_LETTER"),
      finding(5, "INFO", "SystemInfo", "-")
    ]
  }
};

// ---- one row per problem, however many places ----

var problems = handover.problems(state);

assert(problems.length === 3,
  "Findings that name the same constraint are one problem: " +
  problems.length);
assert(problems[0].places === 3 && problems[0].selected === 3,
  "A problem must carry how many places it has and how many were asked " +
  "about.");
assert(problems[0].category === "Win32 API・外部プログラム・スクリプト",
  "A problem must land in the kind of work the guide sorts it into: " +
  problems[0].category);
assert(problems[1].places === 1 && problems[1].selected === 0,
  "A problem nobody asked about must show as not asked about.");
assert(problems[2].category === "対象環境の指定がない指摘",
  "A finding that names no constraint still needs a home.");

// ---- the four kinds of test, narrowed to what this run touched ----

var viewpoints = handover.testViewpoints(state);

assert(viewpoints.length === 4 &&
  viewpoints.map(function (group) { return group.title; }).join("/") ===
    "機能テスト/異常系テスト/非機能テスト/回帰テスト",
"All four kinds of test from the guide must be present, in its order.");
assert(viewpoints[0].items.some(function (item) {
  return item.indexOf("TimerUtils") >= 0;
}), "The functional viewpoints must name the modules this run changed.");
assert(viewpoints[0].items.every(function (item) {
  return item.indexOf("SystemInfo の入口") < 0;
}), "An unchanged module is not a functional test item of this run.");
assert(viewpoints[1].items.some(function (item) {
  return item.indexOf("外部プログラム") >= 0;
}), "A run with an execution-axis problem must test that axis failing.");
assert(viewpoints[1].items.some(function (item) {
  return item.indexOf("URL") >= 0;
}), "A run with a storage-axis problem must test the URL save location.");

// ---- the terminal this ran on, which is not the workbook ----
// The reading itself is fixed by tests\test-host-runtime.ps1. What is
// fixed here is the judgement placed on it: a target file that says
// nothing about the runtime has not agreed with anything.

var silent = handover.runtimeComparison(state);

assert(silent.available === false && silent.rows.length === 0,
  "With nothing read from the machine, there is nothing to show.");

var runtimeState = JSON.parse(JSON.stringify(state));

runtimeState.hostRuntime = {
  osArchitecture: "x64",
  processArchitecture: "x64",
  officeVersion: "unknown",
  officeBitness: "x86",
  officeChannel: "設定あり",
  officeKnown: true,
  notes: ["インストール済み Excel の版を読み取れませんでした。"]
};

var unasked = handover.runtimeComparison(runtimeState);

assert(unasked.available === true && unasked.rows.length === 4,
  "Four things are observed about the terminal: " + unasked.rows.length);
assert(unasked.rows.every(function (row) {
  return row.expected === "" && row.verdict === "期待値の指定なし";
}), "A target environment that declares no expected runtime must produce " +
  "no verdict at all - silence is not agreement.");

runtimeState.targetEnvironment = JSON.parse(JSON.stringify(ENVIRONMENT));
runtimeState.targetEnvironment.expectedRuntime = {
  osArchitecture: "x64",
  officeBitness: "x64",
  officeVersion: "16.0"
};

var judged = handover.runtimeComparison(runtimeState);
var byLabel = {};

judged.rows.forEach(function (row) {
  byLabel[row.label] = row;
});

assert(byLabel["OS のアーキテクチャ"].verdict === "一致",
  "A value that meets the declared expectation must read as meeting it.");
assert(byLabel["Excel / Office のビット数"].verdict === "不一致",
  "A value that differs from the declared expectation must say so.");
assert(byLabel["MacroStudio のプロセス"].verdict === "期待値の指定なし",
  "An expectation the owner did not declare stays undeclared, even when " +
  "the neighbouring rows were declared.");
assert(byLabel["Excel / Office の版"].measured === "unknown" &&
  byLabel["Excel / Office の版"].verdict ===
    "この端末では読み取れませんでした",
"Something that could not be read is neither a match nor a mismatch.");
assert(judged.notes.length === 1,
  "A note from the reader must reach the person reading the memo.");

var runtimeMemo = handover.sections(runtimeState);

assert(runtimeMemo.indexOf("### この端末で確認できた実行環境（参考）") >= 0 &&
  runtimeMemo.indexOf("ブックの属性では") >= 0,
"The memo must carry the terminal's own facts, marked as not the book's.");
assert(runtimeMemo.indexOf("| Excel / Office のビット数 | x86 | x64 | 不一致 |")
  >= 0, "The memo must show the disagreement as a row, not a summary.");
assert(handover.sections(state)
  .indexOf("（読み取れていません。人が確認してください）") >= 0,
"A run that read nothing about the machine must say so in the memo.");

// ---- what was verified, and what was not ----

var verified = handover.verifiedByTool(state);

assert(verified.length > 0 &&
  verified.some(function (item) { return item.indexOf("読み直して") >= 0; }),
"A successful build must report the re-read it actually performed.");
assert(verified.every(function (item) {
  return item.indexOf("実行") < 0 || item.indexOf("読み直") >= 0;
}), "The tool must not claim to have run the macro.");

var notBuilt = handover.verifiedByTool({
  buildResult: {success: false},
  modules: [],
  diagnosis: null
});

assert(notBuilt.length === 0,
  "A run that did not build has verified nothing and must say so by " +
  "listing nothing.");

// ---- work that lives outside the code ----

var human = handover.humanTasks(state);
var humanText = human.map(function (task) {
  return task.title + task.reason + task.detail;
}).join(" ");
var byKey = {};

human.forEach(function (task) {
  byKey[task.key] = task;
});

["参照設定", "Power Query", "ActiveX", "バーコード"].forEach(function (name) {
  assert(humanText.indexOf(name) >= 0,
    "The guide's out-of-code work must be handed to a person: " + name);
});
human.forEach(function (task) {
  assert(task.reason.length > 0,
    "Each handed-over task must say why this tool cannot do it.");
});

// Each line says what was looked for and what was found, so an absence is
// a reported observation rather than a gap in the list.
assert(byKey.references.found === true &&
  byKey.references.detail.indexOf("Scripting") >= 0,
"A reference that exists must be named.");
assert(byKey.activeX.found === true &&
  byKey.activeX.detail.indexOf("2 件") >= 0,
"ActiveX parts must be counted from the workbook, not assumed.");
assert(byKey.barcode.found === false &&
  byKey.barcode.detail.indexOf("見つかりませんでした") >= 0,
"Nothing found must be reported as nothing found, not left out.");
assert(byKey.externalLinks.found === false,
  "An absent external link must report as absent.");

// Without an inventory the tool says it could not look, rather than
// listing four tasks it never checked.
var unknown = handover.humanTasks({});

assert(unknown.length === 1 && unknown[0].key === "inventory",
  "A run with no inventory must say it could not look, not guess.");

// ---- the six deliverables ----

var memo = handover.sections(state);

[
  "## 改修対象一覧",
  "## 環境依存設定一覧",
  "## テスト仕様・結果",
  "## 既知の制約",
  "## ロールバック手順"
].forEach(function (heading) {
  assert(memo.indexOf(heading) >= 0,
    "The handover memo is missing: " + heading);
});
assert(memo.indexOf("このツールはマクロを実行しません") >= 0,
  "The memo must state plainly that the macro was never run.");
assert(memo.indexOf("人が確認すること（未実施）") >= 0,
  "Unrun checks must be labelled unrun.");
assert(memo.indexOf("- [ ] ") >= 0,
  "Unrun checks must be written as things still to do.");
assert(memo.indexOf("申請管理.xlsm") >= 0 &&
  memo.indexOf("変更していません") >= 0,
"The rollback section must name the untouched original.");
assert(memo.indexOf("`WIN32API_BLOCKED`") >= 0 &&
  memo.indexOf("実値（保存先・接続先・機器名）はこのメモに書きません") >= 0,
"The environment list must name the keys and withhold the values.");
assert(memo.indexOf("今回は依頼していない") >= 0,
  "A problem left alone must be visible as left alone.");

// A run with no diagnosis still hands over what it can.
var bare = handover.sections({
  book: {name: "x.xlsm"},
  outputName: "x-Modified.xlsm",
  targetEnvironment: null,
  selectedFindings: [],
  modules: [],
  diagnosis: null,
  buildResult: {success: true}
});

assert(bare.indexOf("## ロールバック手順") >= 0 &&
  bare.indexOf("（診断で対処が必要な問題は挙がっていません）") >= 0,
"A run without a diagnosis must still produce a complete memo.");

console.log("test-handover: PASS");
console.log("problems group by constraint, the four test viewpoints follow " +
  "what the run touched, out-of-code work is handed to a person, the " +
  "terminal's own runtime is judged only against a declared expectation, " +
  "and the memo carries the guide's deliverables without claiming an " +
  "unrun check");
