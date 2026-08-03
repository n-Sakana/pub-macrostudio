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
    path.join(root, "assets", "js", "prompt-template.js"),
    "utf8"),
  context,
  { filename: "prompt-template.js" });

var promptApi = windowObject.MacroStudioPrompt;
var defaultTemplate = fs.readFileSync(
  path.join(root, "templates", "request-template.txt"),
  "utf8");
var diagnosisTemplate = fs.readFileSync(
  path.join(root, "templates", "diagnose-template.txt"),
  "utf8");
var repairTemplate = fs.readFileSync(
  path.join(root, "templates", "repair-template.txt"),
  "utf8");
var crlf = "\r\n";
var banner = new Array(81).join("=");
var indexLine = new Array(41).join("-");

var options = {
  template: defaultTemplate,
  requestText: "一行目\n二行目",
  outputRules: {
    title: "出力指示",
    body: "出力の一行目\n出力の二行目"
  },
  codeFileName: "台帳_コード全文_20260729_120000.txt",
  book: {
    name: "台帳.xlsm",
    totalLines: 3
  },
  modules: [
    {
      name: "Module1",
      type: "standard",
      typeLabel: "標準モジュール",
      ext: "bas",
      lineCount: 3,
      code: "Option Explicit\nPublic Sub Run()\nEnd Sub\n",
      attributes: "Attribute VB_Name = \"Module1\"\r\n"
    },
    {
      name: "ThisWorkbook",
      type: "document",
      typeLabel: "ドキュメントモジュール",
      ext: "cls",
      lineCount: 0,
      code: "",
      attributes: "Attribute VB_Name = \"ThisWorkbook\"\r\n"
    }
  ]
};

// ---- the attached code file: fixed format, code only ----

var codeFile = promptApi.buildCodeFile({
  book: options.book,
  modules: options.modules,
  generatedAt: "2026-07-29 12:00:00"
});
var expectedCodeFile = [
  banner,
  " 台帳.xlsm - VBA Source Code",
  " Generated: 2026-07-29 12:00:00",
  banner,
  "",
  "MODULE INDEX",
  indexLine,
  "",
  "  Standard Modules:",
  "    Module1.bas (3 lines)",
  "",
  "  Document Modules:",
  "    ThisWorkbook.cls (0 lines)",
  "",
  "  Total: 3 lines across 2 modules",
  "",
  banner,
  " Module1.bas",
  banner,
  "",
  "Option Explicit",
  "Public Sub Run()",
  "End Sub",
  "",
  banner,
  " ThisWorkbook.cls",
  banner
].join(crlf) + crlf;

assert(
  codeFile === expectedCodeFile,
  "Generated code file mismatch.");
assert(
  codeFile.indexOf("【") < 0 &&
    codeFile.indexOf("■") < 0 &&
    codeFile.indexOf("現在空です") < 0 &&
    codeFile.indexOf("```") < 0,
  "The code file must contain no prose, notes, or fences.");
assert(
  codeFile.indexOf("Attribute VB_Name") < 0,
  "Attribute headers leaked into the code file.");
assert(
  codeFile.replace(/\r\n/g, "").indexOf("\n") < 0 &&
    codeFile.replace(/\r\n/g, "").indexOf("\r") < 0,
  "The code file contains a lone LF or CR.");
assert(
  codeFile.slice(-2) === crlf &&
    codeFile.slice(-4) !== crlf + crlf,
  "The code file must end with exactly one CRLF.");

var unknownTypeRejected = false;
try {
  promptApi.buildCodeFile({
    book: options.book,
    modules: [
      {
        name: "X",
        type: "mystery",
        ext: "bas",
        lineCount: 1,
        code: "A\n"
      }
    ],
    generatedAt: "2026-07-29 12:00:00"
  });
} catch (error) {
  unknownTypeRejected = true;
}
assert(
  unknownTypeRejected,
  "An unknown module type must raise an error.");

// ---- the chat prompt: external template, no source blocks ----

var expectedPrompt = [
  "添付ファイル 台帳_コード全文_20260729_120000.txt は、" +
    "Excel ブック 台帳.xlsm の VBA コード全文です",
  "（2 モジュール、合計 3 行。省略はありません）。",
  "ソースコードが欠落している・省略されていると判断せず、追加の資料を求めず、",
  "添付ファイルの内容だけを対象に、下の【改修指示】に従って改修してください。",
  "",
  "【改修指示】",
  "一行目",
  "二行目",
  "",
  "【対象モジュール】※ 0 行のモジュールは元から空です",
  "  - Module1 （標準モジュール, 3 行）",
  "  - ThisWorkbook （ドキュメントモジュール, 0 行）",
  "",
  "【出力指示】",
  "出力の一行目",
  "出力の二行目"
].join(crlf) + crlf;

var actualPrompt = promptApi.buildRequestPrompt(options);
assert(
  actualPrompt === expectedPrompt,
  "Generated request prompt mismatch.");
assert(
  actualPrompt.indexOf("Option Explicit") < 0 &&
    actualPrompt.indexOf("End Sub") < 0,
  "Module source leaked into the request prompt.");
assert(
  actualPrompt.indexOf("省略はありません") >= 0 &&
    actualPrompt.indexOf("欠落") >= 0,
  "The template frame must state that the attached code is complete.");

// ---- diagnosis template: environment is data, not preset prose ----

var diagnosisPrompt = promptApi.buildRequestPrompt({
  template: diagnosisTemplate,
  requestText: "事実だけを監査してください。",
  targetEnvironment: "[execution]\n- WIN32API_BLOCKED: 利用できません。",
  outputRules: {
    title: "出力指示",
    body: "契約形式で返してください。"
  },
  requestId: "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1",
  gradingBasis: "【改修の基準】" + crlf + "動くかどうかで見てください。" +
    crlf + crlf,
  codeFileName: options.codeFileName,
  book: options.book,
  modules: options.modules
});
var expectedDiagnosisPrompt = [
  "添付ファイル " + options.codeFileName + " は、Excel ブック 台帳.xlsm の VBA コード全文です",
  "（2 モジュール、合計 3 行。省略はありません）。",
  "ソースコードが欠落している・省略されていると判断せず、追加の資料を求めず、",
  "添付ファイルの内容と下の【想定動作環境】だけを根拠に、事実を診断してください。",
  "",
  "【想定動作環境】",
  "[execution]",
  "- WIN32API_BLOCKED: 利用できません。",
  "",
  "【診断指示】",
  "事実だけを監査してください。",
  "",
  "【改修の基準】",
  "動くかどうかで見てください。",
  "",
  "【対象モジュール】※ 0 行のモジュールは元から空です",
  "  - Module1 （標準モジュール, 3 行）",
  "  - ThisWorkbook （ドキュメントモジュール, 0 行）",
  "",
  "【出力指示】",
  "契約形式で返してください。"
].join(crlf) + crlf;

assert(
  diagnosisPrompt === expectedDiagnosisPrompt,
  "Generated diagnosis request prompt mismatch.");

// An entrance with no single repair template has no basis to name, and
// the request must then carry no empty heading at all.
assert(
  promptApi.buildRequestPrompt({
    template: diagnosisTemplate,
    requestText: "事実だけを監査してください。",
    targetEnvironment: "[execution]",
    outputRules: {title: "出力指示", body: "契約形式で返してください。"},
    requestId: "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1",
    gradingBasis: "",
    codeFileName: options.codeFileName,
    book: options.book,
    modules: options.modules
  }).indexOf("【改修の基準】") < 0,
  "An empty grading basis must leave no heading behind.");

var missingEnvironmentPlaceholder = false;
try {
  promptApi.buildRequestPrompt({
    template: "{{REQUEST_TEXT}}",
    requestText: "診断",
    targetEnvironment: "環境",
    codeFileName: options.codeFileName,
    book: options.book,
    modules: options.modules
  });
} catch (error) {
  missingEnvironmentPlaceholder =
    error.message.indexOf("TARGET_ENVIRONMENT") >= 0;
}
assert(
  missingEnvironmentPlaceholder,
  "A diagnosis template without TARGET_ENVIRONMENT must be rejected.");

// ---- repair template: diagnosis and zero-selection context are mandatory ----

var repairPrompt = promptApi.buildRequestPrompt({
  template: repairTemplate,
  requestText: "保存場所を選べるようにしてください。",
  targetEnvironment: "TARGET ENVIRONMENT\nrevision: 2026-08-01",
  diagnosis: "## PURPOSE\n帳票を保存します。\n\n#01 [BLOCKER/CONFIRMED] 保存先が固定です。",
  selectedFindings: [
    indexLine + indexLine,
    " REQUESTED CHANGES",
    indexLine + indexLine,
    "（指摘の選択なし。追加の要望のみ）",
    indexLine + indexLine
  ].join("\n"),
  outputRules: {title: "出力指示", body: "契約どおり返してください。"},
  requestId: "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1",
  codeFileName: "source-code.md",
  book: options.book,
  modules: options.modules
});
var repairDivider = new Array(81).join("-");
var expectedRepairPrompt = [
  "添付ファイル source-code.md は、Excel ブック 台帳.xlsm の VBA コード全文です",
  "（2 モジュール、合計 3 行。省略はありません）。",
  "ソースコードが欠落している・省略されていると判断せず、追加の資料を求めず、",
  "診断結果と希望する動作、想定動作環境をすべて守って改修してください。",
  "",
  "【想定動作環境】",
  "TARGET ENVIRONMENT",
  "revision: 2026-08-01",
  "",
  "【診断結果】",
  "## PURPOSE",
  "帳票を保存します。",
  "",
  "#01 [BLOCKER/CONFIRMED] 保存先が固定です。",
  "",
  "【選んだ指摘と希望する動作】",
  repairDivider,
  " REQUESTED CHANGES",
  repairDivider,
  "（指摘の選択なし。追加の要望のみ）",
  repairDivider,
  "",
  "【改修指示】",
  "保存場所を選べるようにしてください。",
  "",
  "【対象モジュール】※ 0 行のモジュールは元から空です",
  "  - Module1 （標準モジュール, 3 行）",
  "  - ThisWorkbook （ドキュメントモジュール, 0 行）",
  "",
  "【出力指示】",
  "契約どおり返してください。"
].join(crlf) + crlf;

assert(repairPrompt === expectedRepairPrompt,
  "Generated repair request prompt mismatch.");
assert(repairPrompt.indexOf("【選んだ指摘と希望する動作】") >= 0 &&
  repairPrompt.indexOf("（指摘の選択なし。追加の要望のみ）") >= 0,
"Zero selected findings must keep the section and its explicit context.");

["TARGET_ENVIRONMENT", "DIAGNOSIS", "SELECTED_FINDINGS"].forEach(
  function (placeholder) {
    var rejectedRepair = false;
    try {
      promptApi.buildRequestPrompt({
        template: repairTemplate.replace("{{" + placeholder + "}}", ""),
        requestText: "改修",
        targetEnvironment: "環境",
        diagnosis: "診断",
        selectedFindings: "選択なし",
        codeFileName: "source-code.md",
        book: options.book,
        modules: options.modules
      });
    } catch (error) {
      rejectedRepair = error.message.indexOf(placeholder) >= 0;
    }
    assert(rejectedRepair,
      "A repair template without " + placeholder + " must be rejected.");
  });

// The template frame carries no output rules of its own: they come
// from the preset file, or the block is absent.
var promptWithoutRules = promptApi.buildRequestPrompt({
  template: defaultTemplate,
  requestText: options.requestText,
  outputRules: null,
  codeFileName: options.codeFileName,
  book: options.book,
  modules: options.modules
});
assert(
  promptWithoutRules.indexOf("【出力指示】") < 0 &&
    promptWithoutRules.indexOf("【") ===
      promptWithoutRules.indexOf("【改修指示】"),
  "Without output rules the prompt must not keep an empty block.");
assert(
  promptWithoutRules.slice(-4) !== crlf + crlf,
  "An absent output block must not leave trailing blank lines.");
assert(
  promptApi.formatOutputRules({
    title: "出力指示",
    body: "本文"
  }) === "【出力指示】" + crlf + "本文",
  "Output rules must keep their own heading from the preset file.");
assert(
  promptApi.formatOutputRules(null) === "" &&
    promptApi.formatOutputRules({ title: "出力指示", body: "" }) === "",
  "Missing output rules must render as nothing.");
assert(
  actualPrompt.replace(/\r\n/g, "").indexOf("\n") < 0 &&
    actualPrompt.replace(/\r\n/g, "").indexOf("\r") < 0,
  "Generated prompt contains a lone LF or CR.");
assert(
  !Object.prototype.hasOwnProperty.call(
    promptApi,
    "buildRequestFile"),
  "The single-file request builder must be removed.");

var boundaryPrompt = promptApi.buildRequestPrompt({
  template: defaultTemplate,
  requestText: "末尾改行あり\n",
  codeFileName: options.codeFileName,
  book: options.book,
  modules: options.modules
});
assert(
  boundaryPrompt.indexOf(
    "末尾改行あり\r\n\r\n【対象モジュール】") >= 0,
  "A request trailing newline changed the section boundary.");

// ---- preset append (unchanged behaviour) ----

assert(
  promptApi.appendPreset("", "preset") === "preset",
  "Preset append to an empty request must preserve the preset.");
assert(
  promptApi.appendPreset("request", "preset") ===
    "request\r\n\r\npreset",
  "Preset append must insert one blank line.");
assert(
  promptApi.appendPreset("request\r\n", "preset") ===
    "request\r\n\r\npreset",
  "Preset append must supplement one missing line break.");
assert(
  promptApi.appendPreset("request\r\n\r\n", "preset") ===
    "request\r\n\r\npreset",
  "Preset append must not add a second blank line.");
assert(
  promptApi.appendPreset("request", "\r\npreset") ===
    "request\r\n\r\npreset",
  "Preset leading break must count toward the blank line.");

// ---- template validation ----

var rejected = false;
try {
  promptApi.buildRequestPrompt({});
} catch (error) {
  rejected = true;
}
assert(rejected, "Missing prompt data must raise an error.");

function buildWithTemplate(template, requestText) {
  return promptApi.buildRequestPrompt({
    template: template,
    requestText: requestText === undefined
      ? options.requestText
      : requestText,
    codeFileName: options.codeFileName,
    book: options.book,
    modules: options.modules
  });
}

var minimal = buildWithTemplate("{{REQUEST_TEXT}}\n");
assert(
  minimal.indexOf("一行目\r\n二行目\r\n") === 0,
  "A template may omit optional placeholders.");
assert(
  minimal.slice(-2) === crlf &&
    minimal.slice(-4) !== crlf + crlf,
  "Rendered prompts must end with exactly one CRLF.");

var repeated = buildWithTemplate(
  "{{CODE_FILE_NAME}}|{{CODE_FILE_NAME}}\n{{REQUEST_TEXT}}");
assert(
  repeated.indexOf(
    options.codeFileName + "|" + options.codeFileName + "\r\n") === 0,
  "Known placeholders may be repeated.");

var dollarText = buildWithTemplate(
  "{{REQUEST_TEXT}}",
  "$&\n$1");
assert(
  dollarText.indexOf("$&\r\n$1\r\n") === 0,
  "Placeholder values must not use replacement-string semantics.");

var literalPlaceholderText = buildWithTemplate(
  "{{REQUEST_TEXT}}",
  "{{BOOK_NAME}}\n{{MODULE_COUNT}}");
assert(
  literalPlaceholderText.indexOf(
    "{{BOOK_NAME}}\r\n{{MODULE_COUNT}}\r\n") === 0,
  "Placeholder-like text inside a value must remain literal.");

var sourceBlocksError = "";
try {
  buildWithTemplate(
    "{{REQUEST_TEXT}}\n{{MODULE_SOURCE_BLOCKS}}");
} catch (error) {
  sourceBlocksError = error.message;
}
assert(
  sourceBlocksError.indexOf("MODULE_SOURCE_BLOCKS") >= 0,
  "A retired MODULE_SOURCE_BLOCKS placeholder must be " +
    "rejected with a clear message.");

[
  {
    template: "{{MODULE_LIST}}",
    label: "REQUEST_TEXT"
  },
  {
    template: "{{REQUEST_TEXT}}\n{{BOOK_NAM}}",
    label: "unknown"
  },
  {
    template: "{{REQUEST_TEXT}}\n{{BOOK_NAME}",
    label: "malformed"
  }
].forEach(function (testCase) {
  var didReject = false;

  try {
    buildWithTemplate(testCase.template);
  } catch (error) {
    didReject = true;
  }
  assert(
    didReject,
    "The " + testCase.label + " template error was accepted.");
});

console.log("test-prompt-template: PASS");
console.log(
  "code file format, exact default prompt, variables, CRLF, append: PASS");
