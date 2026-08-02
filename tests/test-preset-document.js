"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

var root = path.resolve(__dirname, "..");
var windowObject = {};
var context = vm.createContext({
  window: windowObject
});
windowObject.window = windowObject;

vm.runInContext(
  fs.readFileSync(
    path.join(root, "assets", "js", "preset-document.js"),
    "utf8"),
  context,
  { filename: "preset-document.js" });

var presetApi = windowObject.MacroStudioPreset;

function parseRepair(content) {
  return presetApi.parse(content, "repair");
}

function lines(list) {
  return list.join("\n");
}

// ---- the shape a preset file must have ----

var complete = lines([
  "<!-- editor note before the title -->",
  "# 新端末移行",
  "",
  "<!--",
  "  複数行のコメント。",
  "  # これは見出しではない",
  "-->",
  "",
  "## 改修指示",
  "",
  "Win32 API を使わない形へ直してください。",
  "",
  "- 依存箇所をすべて見つける",
  "",
  "## 出力指示",
  "",
  "チャット本文のコードブロックで返してください。",
  "",
  "### 補足",
  "",
  "全文を返してください。",
  ""
]);

var parsed = parseRepair(complete);

assert(parsed.valid, "A complete preset must parse: " + parsed.message);
assert(
  parsed.name === "新端末移行",
  "The first H1 must become the preset name: " + parsed.name);
assert(
  parsed.instruction.title === "改修指示" &&
    parsed.output.title === "出力指示",
  "Both section titles must be reported.");
assert(
  parsed.instruction.body ===
    "Win32 API を使わない形へ直してください。\r\n\r\n" +
    "- 依存箇所をすべて見つける",
  "Instruction body mismatch: " +
    JSON.stringify(parsed.instruction.body));
assert(
  parsed.output.body ===
    "チャット本文のコードブロックで返してください。\r\n\r\n" +
    "### 補足\r\n\r\n全文を返してください。",
  "Output body mismatch: " + JSON.stringify(parsed.output.body));

// Comments are for the person editing the file, never for the chat.
assert(
  parsed.instruction.body.indexOf("editor note") < 0 &&
    parsed.output.body.indexOf("editor note") < 0 &&
    parsed.instruction.body.indexOf("複数行のコメント") < 0 &&
    parsed.output.body.indexOf("複数行のコメント") < 0 &&
    parsed.instruction.body.indexOf("<!--") < 0 &&
    parsed.output.body.indexOf("-->") < 0,
  "A comment leaked into a preset section.");
assert(
  parsed.name.indexOf("これは見出しではない") < 0,
  "A commented-out heading became the preset name.");

// Line endings: CRLF input parses to the same result as LF input.
assert(
  JSON.stringify(parseRepair(complete.replace(/\n/g, "\r\n"))) ===
    JSON.stringify(parsed),
  "CRLF input must parse like LF input.");

// ---- comments ----

var inlineComment = parseRepair(lines([
  "# 名前 <!-- 表示名の注意 -->",
  "## 改修指示",
  "本文 <!-- 行内コメント --> のつづき",
  "## 出力指示",
  "出力"
]));

assert(inlineComment.valid, "An inline comment must be accepted.");
assert(
  inlineComment.name === "名前",
  "An inline comment must be stripped from the name: " +
    inlineComment.name);
assert(
  inlineComment.instruction.body === "本文  のつづき",
  "An inline comment must be stripped from the body: " +
    JSON.stringify(inlineComment.instruction.body));

var strippedOnly = presetApi.stripComments(
  "a<!-- x -->b<!-- y -->c");
assert(
  strippedOnly.text === "abc" && !strippedOnly.unterminated,
  "stripComments must remove every comment.");

var unterminated = parseRepair(lines([
  "# 名前",
  "<!-- 閉じ忘れ",
  "## 改修指示",
  "本文",
  "## 出力指示",
  "出力"
]));
assert(
  !unterminated.valid &&
    unterminated.message === presetApi.messages.unterminatedComment,
  "An unterminated comment must be reported.");

// ---- fenced code blocks are body text, not headings ----

var fenced = parseRepair(lines([
  "# 名前",
  "## 改修指示",
  "```",
  "# これはコード内の行",
  "```",
  "## 出力指示",
  "出力"
]));
assert(
  fenced.valid && fenced.name === "名前",
  "A hash inside a fenced block must not be read as a heading.");
assert(
  fenced.instruction.body.indexOf("# これはコード内の行") >= 0,
  "Fenced content must stay in the body.");

// ---- editing mistakes must be refused, never silently accepted ----

var invalidCases = [
  {
    label: "no H1 (the old plain-body format)",
    text: lines([
      "Win32 API を使わない形へ直してください。",
      "- 依存箇所をすべて見つける"
    ]),
    message: presetApi.messages.missingName
  },
  {
    label: "two H1",
    text: lines([
      "# 名前",
      "## 改修指示",
      "本文",
      "## 出力指示",
      "出力",
      "# もう一つ"
    ]),
    message: presetApi.messages.multipleNames
  },
  {
    label: "H1 without a name",
    text: lines(["#", "## 改修指示", "本文", "## 出力指示", "出力"]),
    message: presetApi.messages.emptyName
  },
  {
    label: "missing instruction section",
    text: lines(["# 名前", "## 出力指示", "出力"]),
    message: "「## 改修指示」がありません。"
  },
  {
    label: "missing output section",
    text: lines(["# 名前", "## 改修指示", "本文"]),
    message: "「## 出力指示」がありません。"
  },
  {
    label: "duplicate section",
    text: lines([
      "# 名前",
      "## 改修指示",
      "本文",
      "## 改修指示",
      "本文2",
      "## 出力指示",
      "出力"
    ]),
    message: "「## 改修指示」が 2 つ以上あります。"
  },
  {
    label: "unknown section",
    text: lines([
      "# 名前",
      "## 改修指示",
      "本文",
      "## メモ",
      "個人用",
      "## 出力指示",
      "出力"
    ]),
    message:
      "知らない見出しがあります: ## メモ。" +
      "使えるのは「## 改修指示」「## 出力指示」「## 質問」「## 説明」" +
      "「## 置換の候補」「## 希望動作の候補」「## 維持すること」" +
      "「## 推奨条件」「## 記入欄」" +
      "「## 出力指示（モジュール単位）」「## 出力指示（分割）」です。"
  },
  {
    label: "empty section body",
    text: lines([
      "# 名前",
      "## 改修指示",
      "",
      "## 出力指示",
      "出力"
    ]),
    message: "「## 改修指示」の本文が空です。"
  },
  {
    label: "text before the title",
    text: lines([
      "前置き",
      "# 名前",
      "## 改修指示",
      "本文",
      "## 出力指示",
      "出力"
    ]),
    message: presetApi.messages.textBeforeName
  },
  {
    label: "text outside a section",
    text: lines([
      "# 名前",
      "見出しの外の本文",
      "## 改修指示",
      "本文",
      "## 出力指示",
      "出力"
    ]),
    message: presetApi.messages.textOutsideSection
  },
  {
    label: "empty file",
    text: "   \n\n",
    message: presetApi.messages.empty
  }
];

invalidCases.forEach(function (item) {
  var result = parseRepair(item.text);

  assert(
    !result.valid,
    "This preset must be refused: " + item.label);
  assert(
    result.message === item.message,
    "Wrong reason for " + item.label + ": " + result.message);
  assert(
    result.instruction === null && result.output === null,
    "A refused preset must not expose sections: " + item.label);
});

assert(
  !parseRepair(null).valid &&
    !parseRepair(undefined).valid,
  "Missing content must be refused.");

// ---- beta 2 sections and folder-defined stages ----

var repairWithSections = parseRepair(lines([
  "# 改修ひな形",
  "## 説明",
  "画面に出す説明です。",
  "## 希望動作の候補",
  "- 結果を変えずに直す",
  "- 確認事項を返す",
  "## 維持すること",
  "- 公開入口は変えない",
  "- 判断できないことは決めない",
  "## 改修指示",
  "本文",
  "## 出力指示",
  "出力",
  "## 出力指示（モジュール単位）",
  "分割出力"
]));

assert(repairWithSections.valid, repairWithSections.message);
assert(
  repairWithSections.stage === "repair" &&
    repairWithSections.replaceRules === null,
  "A repair preset that asks for no component must say so by asking for " +
    "none.");
assert(
  JSON.stringify(repairWithSections.behaviorCandidates) ===
    JSON.stringify(["結果を変えずに直す", "確認事項を返す"]) &&
    JSON.stringify(repairWithSections.preserveItems) ===
      JSON.stringify(["公開入口は変えない", "判断できないことは決めない"]),
  "Behavior candidates and preserve items must stay structured.");
assert(
  repairWithSections.splitOutput.body === "分割出力" &&
    repairWithSections.splitDiagnosisOutput === null,
  "Repair split output must use its beta 1.10 property only.");
assert(
  parsed.replaceRules === null,
  "A template that declares no rules asks for no component.");

var diagnosisWithSplit = presetApi.parse(lines([
  "# 診断ひな形",
  "## 説明",
  "事実を調べます。",
  "## 改修指示",
  "コードを書き換えずに調べてください。",
  "## 出力指示",
  "診断形式で返してください。",
  "## 出力指示（分割）",
  "診断を分割して返してください。"
]), "diagnose");

assert(diagnosisWithSplit.valid, diagnosisWithSplit.message);
assert(
  diagnosisWithSplit.stage === "diagnose" &&
    diagnosisWithSplit.replaceRules === null &&
    diagnosisWithSplit.splitOutput === null &&
    diagnosisWithSplit.splitDiagnosisOutput.body ===
      "診断を分割して返してください。",
  "Diagnosis split output must be separate from repair split output.");

// A template asks for the app's replacement table by saying what to look
// for and what to call it. The app knows nothing about the subject; the
// pattern and the name both come from here.
var replaceTemplate = parseRepair(lines([
  "# 置き換える",
  "## 説明",
  "確認した値へ置き換えます。",
  "## 置換の候補",
  "- ドライブから始まる場所 | ^[A-Za-z]:[\\\\/] | 既定で選ぶ",
  "- ファイル名 | \\.[A-Za-z0-9]{1,8}$"
]));
assert(
  replaceTemplate.valid &&
    replaceTemplate.instruction === null &&
    replaceTemplate.output === null,
  "A template that only asks for the table needs no instruction or " +
    "output section: " + replaceTemplate.message);
assert(
  replaceTemplate.replaceRules.length === 2 &&
    replaceTemplate.replaceRules[0].label === "ドライブから始まる場所" &&
    replaceTemplate.replaceRules[0].pattern === "^[A-Za-z]:[\\\\/]" &&
    replaceTemplate.replaceRules[0].selectedByDefault === true &&
    replaceTemplate.replaceRules[1].selectedByDefault === false,
  "The rules must survive with their pattern and their default intact.");

[
  {
    label: "obsolete purpose section",
    stage: "repair",
    text: complete.replace(
      "## 改修指示",
      "## 用途\n\n改修\n\n## 改修指示"),
    message: presetApi.messages.obsoleteMode
  },
  {
    label: "diagnosis carrying repair split output",
    stage: "diagnose",
    text: complete + "\n## 出力指示（モジュール単位）\n分割\n",
    message: presetApi.messages.wrongDiagnosisSplit
  },
  {
    label: "repair carrying diagnosis split output",
    stage: "repair",
    text: complete + "\n## 出力指示（分割）\n分割\n",
    message: presetApi.messages.wrongRepairSplit
  },
  {
    label: "replacement rule without a pattern",
    stage: "repair",
    text: complete.replace(
      "## 改修指示",
      "## 置換の候補\n\n- ドライブ\n\n## 改修指示"),
    message: presetApi.messages.invalidReplaceRule
  },
  {
    label: "replacement rule the app cannot compile",
    stage: "repair",
    text: complete.replace(
      "## 改修指示",
      "## 置換の候補\n\n- 壊れた規則 | ^[A-Z\n\n## 改修指示"),
    message: "「## 置換の候補」の正規表現が読み取れません: 壊れた規則"
  },
  {
    label: "non-list behavior candidates",
    stage: "repair",
    text: complete.replace(
      "## 改修指示",
      "## 希望動作の候補\n\n箇条書きではない\n\n## 改修指示"),
    message: "「## 希望動作の候補」は「- 文」の箇条書きで書いてください。"
  },
  {
    label: "repair-only replacement rules in diagnosis",
    stage: "diagnose",
    text: complete.replace(
      "## 改修指示",
      "## 置換の候補\n\n- 名前 | ^x\n\n## 改修指示"),
    message: "「## 置換の候補」は改修ひな形だけで使えます。"
  },
  {
    label: "table-only preset without description",
    stage: "repair",
    text: "# 置き換える\n\n## 置換の候補\n\n- 名前 | ^x\n",
    message: "「## 説明」がありません。"
  }
].forEach(function (item) {
  var result = presetApi.parse(item.text, item.stage);

  assert(!result.valid, "This beta 2 preset must fail: " + item.label);
  assert(
    result.message === item.message,
    "Wrong beta 2 reason for " + item.label + ": " + result.message);
});

assert(
  !presetApi.parse(complete).valid &&
    presetApi.parse(complete).message === presetApi.messages.unknownStage,
  "The containing folder stage must be supplied; content cannot declare it.");

// ---- the list the UI renders ----

var entries = presetApi.describeAll([
  { file: "a.md", content: complete },
  { file: "b.md", content: "# 名前だけ" },
  { file: "c.md", content: "", error: "read" }
], "repair");

assert(entries.length === 3, "Every file must stay in the list.");
assert(
  entries[0].valid && entries[0].name === "新端末移行",
  "A valid file must carry its H1 name.");
assert(
  !entries[1].valid && entries[1].name === "" &&
    entries[1].message === "「## 改修指示」がありません。",
  "An invalid file must carry its reason instead of a name.");
assert(
  !entries[2].valid &&
    entries[2].message === presetApi.messages.unreadable,
  "A file the host could not read must be reported as unreadable.");
assert(
  presetApi.countValid([
    { file: "a.md", content: complete },
    { file: "b.md", content: "# 名前だけ" }
  ], "repair") === 1,
  "Only parsable files count as usable presets.");
assert(
  presetApi.countValid([], "repair") === 0 &&
    presetApi.describeAll(null, "repair").length === 0,
  "An empty presets folder must yield no usable presets.");

console.log("test-preset-document: PASS");
console.log(
  "H1 name, both sections, comment removal and every refused " +
  "editing mistake behave as specified");
