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

["preset-document.js", "prompt-template.js"].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(
      path.join(root, "assets", "js", name),
      "utf8"),
    context,
    { filename: name });
});

var presetApi = windowObject.MacroStudioPreset;
var promptApi = windowObject.MacroStudioPrompt;

function readUtf8(filePath) {
  var text = fs.readFileSync(filePath, "utf8");
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text;
}

// Wording is checked across line breaks: where a sentence wraps in
// the markdown file is the editor's business, not the test's.
function flatten(text) {
  return String(text).replace(/\r?\n[ \t]*/g, "");
}

// Both lists are discovered from their folders. Folder membership is the
// stage; preset content is not allowed to declare a purpose of its own.
var presetDir = path.join(root, "presets");
var diagnosisDir = path.join(presetDir, "01_診断");
var repairDir = path.join(presetDir, "02_改修");

function readGroup(directory, folderName) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory).filter(function (name) {
    return path.extname(name).toLowerCase() === ".md";
  }).sort().map(function (name) {
    return {
      file: path.join(folderName, name),
      content: readUtf8(path.join(directory, name))
    };
  });
}

var diagnosisPresets = readGroup(diagnosisDir, "01_診断");
var repairPresets = readGroup(repairDir, "02_改修");
var presets = diagnosisPresets.concat(repairPresets);
var template = readUtf8(
  path.join(root, "templates", "request-template.txt"));

assert(
  diagnosisPresets.length === 1 && repairPresets.length === 4,
  "The shipped folders must contain one diagnosis and four repair presets.");

// ---- every shipped preset is a self-contained request ----

var diagnoseEntries = presetApi.describeAll(
  diagnosisPresets,
  "diagnose");
var repairEntries = presetApi.describeAll(repairPresets, "repair");
var entries = diagnoseEntries.concat(repairEntries);

entries.forEach(function (entry) {
  assert(
    entry.valid,
    "Shipped preset " + entry.file + " does not parse: " +
      entry.message);
  assert(
    entry.name.length > 0,
    "Shipped preset " + entry.file + " has no H1 name.");
  if (entry.replaceRules === null) {
    assert(
      entry.instruction.body.length > 0 &&
        entry.output.body.length > 0,
      "Shipped AI preset " + entry.file + " has an empty section.");
  }
});

// ---- folder-defined stages, and components asked for by name ----
// A template that wants the app's replacement table says what to look
// for. The app has no list of templates and no idea what the patterns
// mean; the only thing it reads here is "this one needs the table".

var refactorEntries = repairEntries.filter(function (entry) {
  return entry.replaceRules === null;
});
var pathEntries = repairEntries.filter(function (entry) {
  return entry.replaceRules !== null;
});

assert(
  diagnoseEntries.length === 1 &&
    diagnoseEntries[0].stage === "diagnose" &&
    repairEntries.every(function (entry) {
      return entry.stage === "repair";
    }),
  "Folder membership must be the only source of the preset stage.");
assert(
  refactorEntries.length === 3 && pathEntries.length === 1,
  "Repair presets must expose three chat routes and one that asks for " +
    "the replacement table.");
assert(
  pathEntries[0].instruction === null && pathEntries[0].output === null,
  "A template that only asks for the table must not invent a request.");
assert(
  pathEntries[0].replaceRules.length > 0 &&
    pathEntries[0].replaceRules.every(function (rule) {
      return rule.label.length > 0 && rule.pattern.length > 0;
    }),
  "Every rule must bring its own name and its own pattern.");
refactorEntries.forEach(function (entry) {
  assert(
    entry.behaviorCandidates.length > 0 &&
      entry.preserveItems.length === 3,
    "Each AI repair preset must carry behavior choices and three " +
      "visible preserve items: " + entry.file);
  [entry.output, entry.splitOutput].forEach(function (rules) {
    assert(rules && rules.body.indexOf("NOCHANGE NEEDDECISION") >= 0 &&
      rules.body.indexOf("DECISION BEGIN 1") >= 0 &&
      rules.body.indexOf("META FINDING=") >= 0 &&
      rules.body.indexOf("COMPLETE 0") >= 0,
    "Every whole and split AI output contract must teach NEEDDECISION: " +
      entry.file);
  });
});

// ---- the migration preset, found by what it says, not by its name ----

// The requirements the migration preset must state. This is the
// canonical wording of the request the user sees after pressing it.
var requiredInstruction = [
  "Win32 API を利用できない端末",
  "同じ機能・結果",
  "Win32 API 依存箇所",
  "すべて見つける",
  "特定の API だけに限定しない",
  "VBA 標準機能",
  "代替関数",
  "既存の処理モジュールへ混在させず",
  "新しい標準モジュール",
  "差し替える箇所だけを変更",
  "依存そのものをなくす"
];

// Legacy wording that must not come back: goals that narrow the work
// to one API or convert it into declaration maintenance.
var bannedTokens = [
  "64 bit",
  "64bit",
  "64 ビット",
  "64ビット",
  "PtrSafe",
  "Sleep",
  "API 宣言を確認",
  "宣言を確認する"
];

var migration = null;

refactorEntries.forEach(function (entry) {
  if (entry.instruction.body.indexOf("Win32 API") >= 0) {
    migration = entry;
  }
});

assert(
  migration !== null,
  "No shipped preset states the Win32 API removal request.");
requiredInstruction.forEach(function (phrase) {
  assert(
    flatten(migration.instruction.body).indexOf(phrase) >= 0,
    "The migration instruction is missing: " + phrase);
});
bannedTokens.forEach(function (token) {
  assert(
    flatten(migration.instruction.body).indexOf(token) < 0 &&
      flatten(migration.output.body).indexOf(token) < 0,
    "The migration preset still contains legacy wording: " + token);
});

// ---- the output rules live in the same one file ----

// What every preset's own output section has to establish.
var requiredOutput = [
  "変更は最小限",
  "一字一句",
  "行の順序",
  "空白",
  "インデント",
  "コメント",
  "変数宣言の並び",
  "命名",
  "省略せず全文",
  "新しく作ったモジュール",
  "コードブロック"
];

refactorEntries.forEach(function (entry) {
  var output = flatten(entry.output.body);

  requiredOutput.forEach(function (phrase) {
    assert(
      output.indexOf(phrase) >= 0,
      "Preset " + entry.file +
        " is missing this output rule: " + phrase);
  });
  assert(
    /チャット(の)?本文/.test(output),
    "Preset " + entry.file +
      " must require the answer in the chat body.");
  assert(
    output.indexOf("では返さないでください") >= 0,
    "Preset " + entry.file +
      " must forbid answering with a downloadable file.");
});

// ---- every preset states the one-block answer protocol ----

// The app takes the whole answer in one press, so each refactoring
// preset has to ask for exactly that shape, in its own file.
refactorEntries.forEach(function (entry) {
  var output = flatten(entry.output.body);

  assert(
    output.indexOf("ひとつだけのコードブロック") >= 0,
    "Preset " + entry.file +
      " must ask for a single code block.");
  assert(
    output.indexOf("{{REQUEST_ID}} BEGIN") >= 0 &&
      output.indexOf("{{REQUEST_ID}} END") >= 0 &&
      output.indexOf("{{REQUEST_ID}} COMPLETE") >= 0,
    "Preset " + entry.file +
      " must carry the begin, end and complete sentinels.");
  assert(
    output.indexOf("'@MACROSTUDIO") >= 0,
    "Preset " + entry.file + " must carry the sentinel marker.");
  assert(
    output.indexOf("書き換えたり省略したりしないでください") >= 0,
    "Preset " + entry.file +
      " must forbid altering the request id.");
  assert(
    output.indexOf("standard / class / form / document") >= 0,
    "Preset " + entry.file + " must list the module kinds.");
  // The request lists module kinds in Japanese; the sentinel needs the
  // English kind. Each preset spells the mapping out for itself.
  [
    "標準モジュール = standard",
    "クラスモジュール = class",
    "フォームモジュール = form",
    "ドキュメントモジュール = document"
  ].forEach(function (phrase) {
    assert(
      output.indexOf(phrase) >= 0,
      "Preset " + entry.file +
        " must map the module kind label: " + phrase);
  });
  assert(
    output.indexOf(
      "新しく増やすモジュールは、必ず standard") >= 0,
    "Preset " + entry.file +
      " must limit added modules to standard modules.");
  assert(
    output.indexOf("既存のクラスモジュールを直すことはできます") >= 0,
    "Preset " + entry.file +
      " must allow changing an existing class module.");
  assert(
    /ハッシュ|チェックサム|SHA|MD5/.test(entry.output.body) === false,
    "Preset " + entry.file +
      " must not ask the AI to compute a hash.");
});

// ---- the refactoring preset, found by what it says ----

var refactor = null;

refactorEntries.forEach(function (entry) {
  if (flatten(entry.instruction.body).indexOf("採用がかなり濃いもの") >= 0) {
    refactor = entry;
  }
});

assert(
  refactor !== null,
  "No shipped preset offers general VBA refactoring.");

// The practical criteria the refactoring request has to state. They are
// judgement criteria, not a replace-everything rule list.
[
  "二次元",
  "一括",
  "往復",
  "dst.Value2 = src.Value2",
  "Select",
  "Activate",
  "Selection",
  "ActiveWorkbook",
  "Option Explicit",
  "ByVal",
  "ReDim Preserve",
  "Dictionary",
  "ScreenUpdating",
  "Calculation",
  "EnableEvents",
  "Value2",
  "遅延バインド",
  "参照設定",
  "On Error Resume Next",
  "Public Sub",
  "イベントプロシージャ"
].forEach(function (phrase) {
  assert(
    flatten(refactor.instruction.body).indexOf(phrase) >= 0,
    "The refactoring instruction is missing: " + phrase);
});

// The criteria are chosen against the real code, never applied blindly.
[
  "機械的に置き換えない",
  "一律には置き換えない",
  "無条件に足さない",
  "何でも `Dictionary` にしない",
  "細切れにしない",
  "推測だけで複雑にする"
].forEach(function (phrase) {
  assert(
    flatten(refactor.instruction.body).indexOf(phrase) >= 0,
    "The refactoring instruction lost its restraint rule: " + phrase);
});

// Observable behaviour is the boundary of the whole request.
[
  "呼び出し順",
  "出力する値",
  "既存の入口と副作用は守る"
].forEach(function (phrase) {
  assert(
    flatten(refactor.instruction.body).indexOf(phrase) >= 0,
    "The refactoring instruction lost its behaviour guard: " + phrase);
});

// The output rules belong to the preset file. Nothing that builds the
// prompt may become a second source for them.
[
  { label: "request template", text: template },
  {
    label: "prompt-template.js",
    text: readUtf8(
      path.join(root, "assets", "js", "prompt-template.js"))
  },
  {
    label: "preset-document.js",
    text: readUtf8(
      path.join(root, "assets", "js", "preset-document.js"))
  }
].forEach(function (item) {
  [
    "一字一句",
    "改修サマリー",
    "Attribute VB_",
    "省略せず全文",
    "コードブロック"
  ].forEach(function (phrase) {
    assert(
      item.text.indexOf(phrase) < 0,
      "The output rules must not be duplicated in " +
        item.label + ": " + phrase);
  });
});

// The UI may explain the workflow, but it must not carry a spare copy
// of the rules to fall back on.
["handover.js", "一字一句", "省略せず全文"].forEach(function (phrase) {
  assert(
    readUtf8(
      path.join(root, "assets", "js", "app.js")
    ).indexOf(phrase) < 0,
    "app.js must not hold a fallback output rule: " + phrase);
});

// ---- the generated prompt: instruction plus output rules ----

var prompt = promptApi.buildRequestPrompt({
  template: template,
  requestText: migration.instruction.body,
  outputRules: {
    title: migration.output.title,
    body: migration.output.body
  },
  codeFileName: "book_code_20260729_120000.txt",
  book: {
    name: "book.xlsm",
    totalLines: 12
  },
  modules: [
    {
      name: "Main",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 12,
      code: "Option Explicit\n"
    }
  ]
});

var flatPrompt = flatten(prompt);

requiredInstruction.forEach(function (phrase) {
  assert(
    flatPrompt.indexOf(phrase) >= 0,
    "The generated prompt is missing the request: " + phrase);
});
requiredOutput.forEach(function (phrase) {
  assert(
    flatPrompt.indexOf(phrase) >= 0,
    "The generated prompt is missing the output rule: " + phrase);
});
bannedTokens.forEach(function (token) {
  assert(
    flatPrompt.indexOf(token) < 0,
    "The generated prompt still contains legacy wording: " + token);
});

// The two parts stay separate and keep their order.
assert(
  prompt.indexOf("【改修指示】") <
    prompt.indexOf("【" + migration.output.title + "】") &&
    prompt.indexOf("【" + migration.output.title + "】") > 0,
  "The prompt must carry the request and the output rules as " +
    "separate blocks, in that order.");
assert(
  prompt.indexOf("省略はありません") >= 0,
  "The template frame must still state that the code is complete.");

// Nothing that belongs to the file editor may reach the chat.
assert(
  prompt.indexOf("<!--") < 0 &&
    prompt.indexOf("-->") < 0 &&
    prompt.indexOf("このファイル 1 つで") < 0,
  "A preset comment leaked into the generated prompt.");
assert(
  prompt.indexOf("# " + migration.name) < 0,
  "The preset name heading leaked into the generated prompt.");

// The answer must come back in the chat, not as a file.
assert(
  flatPrompt.indexOf("コードブロック") >= 0 &&
    /チャット(の)?本文/.test(flatPrompt),
  "The prompt must ask for chat code blocks.");
[
  "ファイルで返し",
  "ファイルとして返",
  "テキストファイルで返し",
  "ダウンロードできる形",
  "ファイルにまとめて返"
].forEach(function (phrase) {
  assert(
    flatPrompt.indexOf(phrase) < 0,
    "The prompt must not ask for a file answer: " + phrase);
});

// ---- the sole diagnosis preset asks for facts, never rewrites code ----

var diagnosis = diagnoseEntries[0];
// A diagnosis is prose about the macro, not the macro, so it fits in one
// reply and the template no longer offers a split form.
assert(diagnosis.splitDiagnosisOutput === null,
  "The diagnosis preset must not offer a split reply.");
var diagnosisWhole = flatten(
  diagnosis.instruction.body + diagnosis.output.body);

[
  "事実",
  "根拠",
  "コードは書き換え",
  "'@MACROSTUDIO",
  "DIAG BEGIN",
  "DIAG COMPLETE",
  "ENVKEY"
].forEach(function (phrase) {
  assert(
    diagnosisWhole.indexOf(phrase) >= 0,
    "The diagnosis preset is missing its fact contract: " + phrase);
});
assert(
  /コード(は|を)書き換え/.test(diagnosisWhole),
  "The diagnosis must state that it changes nothing.");
assert(
  diagnosis.splitOutput === null && diagnosis.replaceRules === null,
  "Diagnosis must expose neither a repair split contract nor a component " +
    "request.");
[
  "ThisWorkbook.Path",
  "Win32 API の Declare 呼び出しが実行できない",
  "固定の AppData パスが解決できない"
].forEach(function (environmentFact) {
  assert(
    diagnosisWhole.indexOf(environmentFact) < 0,
    "Environment facts must come from target-environment.json, not the " +
      "diagnosis preset: " + environmentFact);
});

// ---- the request id reaches the answer protocol ----

// The app mints one id per request and substitutes it before the text
// goes to the chat, so no placeholder may survive into the prompt.
var requestId = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";

function fillRequestId(text) {
  return String(text).replace(/\{\{REQUEST_ID\}\}/g, requestId);
}

var idPrompt = promptApi.buildRequestPrompt({
  template: template,
  requestText: fillRequestId(refactor.instruction.body),
  outputRules: {
    title: refactor.output.title,
    body: fillRequestId(refactor.output.body)
  },
  requestId: requestId,
  codeFileName: "book_code_20260729_120000.txt",
  book: { name: "book.xlsm", totalLines: 12 },
  modules: [
    {
      name: "Main",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 12,
      code: "Option Explicit\n"
    }
  ]
});

assert(
  idPrompt.indexOf("{{REQUEST_ID}}") < 0 &&
    idPrompt.indexOf("{{") < 0,
  "No placeholder may survive into the generated prompt.");
assert(
  idPrompt.indexOf("'@MACROSTUDIO " + requestId + " BEGIN") >= 0 &&
    idPrompt.indexOf("'@MACROSTUDIO " + requestId + " END") >= 0 &&
    idPrompt.indexOf("'@MACROSTUDIO " + requestId + " COMPLETE") >= 0,
  "The generated prompt must carry the sentinels of this request.");

// Without a preset there are no invented rules and no empty heading.
var promptWithoutRules = promptApi.buildRequestPrompt({
  template: template,
  requestText: "自分の言葉で書いた依頼",
  outputRules: null,
  codeFileName: "book_code_20260729_120000.txt",
  book: { name: "book.xlsm", totalLines: 12 },
  modules: [
    {
      name: "Main",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 12,
      code: "Option Explicit\n"
    }
  ]
});

assert(
  promptWithoutRules.indexOf("【出力指示】") < 0 &&
    promptWithoutRules.indexOf("一字一句") < 0,
  "Without a preset the tool must not invent output rules.");
assert(
  promptWithoutRules.indexOf("自分の言葉で書いた依頼") >= 0,
  "A hand written request must still reach the prompt.");

// ---- discovery stays dynamic: no file name lives in the product ----

var productFiles = [
  path.join(root, "assets", "index.html"),
  path.join(root, "templates", "request-template.txt"),
  path.join(root, "templates", "diagnose-template.txt"),
  path.join(root, "templates", "repair-template.txt")
];

function addProductFiles(directory) {
  fs.readdirSync(directory, {withFileTypes: true}).forEach(function (entry) {
    var filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      addProductFiles(filePath);
    } else {
      productFiles.push(filePath);
    }
  });
}

addProductFiles(path.join(root, "assets", "js"));
addProductFiles(path.join(root, "src"));

productFiles.forEach(function (filePath) {
  var text = readUtf8(filePath);

  presets.forEach(function (preset) {
    var stem = path.basename(preset.file, ".md");

    assert(
      text.indexOf(preset.file) < 0 && text.indexOf(stem) < 0,
      path.basename(filePath) +
        " hard-codes the preset file name: " + preset.file);
  });
  entries.forEach(function (entry) {
    assert(
      text.indexOf(entry.name) < 0,
      path.basename(filePath) +
        " hard-codes the preset name: " + entry.name);
  });
});

// Adding, removing and renaming files changes the rendered list with
// no code change: the list is a pure function of the folder.
var renamed = presetApi.describeAll([
  { file: "別の名前.md", content: repairPresets[0].content }
], "repair");
assert(
  renamed.length === 1 &&
    renamed[0].file === "別の名前.md" &&
    renamed[0].name === repairEntries[0].name,
  "Renaming a file must keep the H1 as the displayed name.");

var retitled = presetApi.describeAll([
  {
    file: repairPresets[0].file,
    content: repairPresets[0].content.replace(
      "# " + repairEntries[0].name,
      "# 別の表示名")
  }
], "repair");
assert(
  retitled[0].valid && retitled[0].name === "別の表示名",
  "Editing the H1 must change the displayed name.");

var added = presetApi.describeAll(repairPresets.concat([
  {
    file: "追加.md",
    content: "# 追加\n\n## 改修指示\n本文\n\n## 出力指示\n出力\n"
  }
]), "repair");
assert(
  added.length === repairPresets.length + 1 &&
    added[added.length - 1].name === "追加",
  "Adding a file must add a preset.");
assert(
  presetApi.describeAll(repairPresets.slice(1), "repair").length ===
    repairPresets.length - 1,
  "Removing a file must remove its preset.");

console.log("test-preset-migration: PASS");
console.log(
  "every shipped preset is one self-contained markdown file, and " +
  "the generated prompt joins its request and output rules");
