"use strict";

// The fixed-path preset decides what counts as a location. It used to decide
// with two catch-all rules ("contains a slash", "ends in a dot plus letters"),
// and那 caught date and number format pictures: input_win32_sleep.xlsm has no
// fixed path at all, yet the screen offered 4 kinds / 6 places, naming
// "yyyy/mm/dd" a 連結された場所の一部 and "0.00" a ファイル名. Replacing those
// would have rewritten every date and number format in the book.
//
// This test pins both directions: real locations stay candidates, format
// pictures do not. It reads the shipped preset, so a future edit to the rules
// is checked against the same corpus.

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
var context = vm.createContext({ window: windowObject });
windowObject.window = windowObject;

vm.runInContext(
  fs.readFileSync(path.join(root, "assets", "js", "preset-document.js"), "utf8"),
  context,
  { filename: "preset-document.js" });

var presetApi = windowObject.MacroStudioPreset;

var presetPath = path.join(
  root, "presets", "02_改修", "02_固定パスを新環境へ置き換える.md");
var parsed = presetApi.parse(fs.readFileSync(presetPath, "utf8"), "repair");

assert(!parsed.invalid, "the shipped fixed-path preset must parse: " + parsed.message);
assert(parsed.replaceRules && parsed.replaceRules.length > 0,
  "the fixed-path preset must declare 置換の候補");

// Same semantics the screen uses: the first rule that matches and that has
// not ruled itself out for this context names the literal, and a capture
// group narrows what may be edited to part of it.
function match(value, before) {
  var i;
  var rule;
  var found;
  var start;
  var end;
  var offset;

  for (i = 0; i < parsed.replaceRules.length; i++) {
    rule = parsed.replaceRules[i];
    if (rule.contextExclude &&
        new RegExp(rule.contextExclude).test(before || "")) {
      continue;
    }
    found = new RegExp(rule.pattern, "d").exec(value);
    if (!found) {
      continue;
    }
    start = 0;
    end = value.length;
    if (found.length > 1 && found[1] !== undefined && found[1] !== null) {
      if (found.indices && found.indices[1]) {
        start = found.indices[1][0];
        end = found.indices[1][1];
      } else {
        offset = found[0].indexOf(found[1]);
        start = found.index + offset;
        end = start + found[1].length;
      }
    }
    if (end <= start) {
      continue;
    }
    return {label: rule.label, segment: value.slice(start, end)};
  }
  return null;
}

function classify(value, before) {
  var found = match(value, before);
  return found === null ? null : found.label;
}

// ---- real locations: must stay candidates ----
var MUST_KEEP = [
  ["C:\\data\\", "ドライブ絶対"],
  ["S:\\eigyo\\shinsei\\", "ドライブ絶対 (S01 の実物)"],
  ["D:\\業務\\月次\\", "ドライブ絶対 + 日本語"],
  ["\\\\fileserver\\share\\", "UNC"],
  ["\\\\srv01\\共有\\受付\\", "UNC + 日本語"],
  ["https://contoso.sharepoint.com/sites/eigyo/", "URL"],
  ["..\\data\\", "相対パス"],
  [".\\config\\", "相対パス"],
  ["\\data\\", "連結された場所の一部"],
  ["\\Reports\\", "連結された場所の一部"],
  ["/Shared Documents/", "SharePoint 断片"],
  ["/sites/eigyo/", "SharePoint 断片"],
  ["%APPDATA%\\Contoso\\", "環境変数"],
  ["C:\\Users\\taro\\Desktop\\", "既知のフォルダー"],
  ["data.csv", "ファイル名"],
  ["report.xlsx", "ファイル名"],
  ["集計表.xlsx", "ファイル名 + 日本語"],
  ["backup2.bak", "ファイル名 + 数字"],
  // Locations built only from digits and separators. A rule that drops
  // "format-looking" strings by character set alone would eat these, so the
  // structural alternatives (rooted / dot-relative) have to come first.
  ["D:/2025/08/02/", "日付フォルダ (ドライブ + スラッシュ)"],
  ["C:/2025-08-02/", "日付フォルダ (ハイフン)"],
  ["./2025/08/", "ドット相対 + 数字のみ"],
  ["../2025/", "親相対 + 数字のみ"],
  [".\\08\\", "ドット相対 (円記号) + 数字のみ"],
  ["/mm/dd/", "ルート始まり + 書式文字のみ"],
  ["\\2024\\", "ルート始まり (円記号) + 数字のみ"]
];

// ---- format pictures: must never be offered as a location ----
var MUST_REJECT = [
  ["yyyy/mm/dd", "日付書式 (WindowUtils 499 の実物)"],
  ["yyyy/mm/dd hh:mm:ss", "日付書式 (WindowUtils 431/509 の実物)"],
  ["0.00", "数値書式 (AppController 105 の実物)"],
  ["/", "区切り 1 文字 (AppController / SystemInfo の実物)"],
  ["hh:mm:ss", "時刻書式"],
  ["yyyy-mm-dd", "日付書式 (ハイフン)"],
  ["mm/dd/yyyy", "日付書式 (米国式)"],
  ["#,##0.00", "数値書式"],
  ["yy/mm", "日付書式 (短)"],
  ["2024/05/01", "日付リテラル"],
  ["0.0", "数値書式"],
  // A separator on its own names no location. "\\" は S01 の ExportSummary が
  // パス連結に使っている実物で、置き換える対象ではない。
  ["\\", "区切り 1 文字 (円記号)"],
  ["\\\\", "区切りだけ"],
  ["//", "区切りだけ"]
];

// ---- PROD-11: the same literal, in and out of the call ----
//
// "WScript.Shell" and "Report.Backup" are the same shape. No rule reading a
// literal on its own can separate them, so the rules read the code standing
// in front of it instead. Both directions are pinned here: tightening the
// shape alone would have taken real file names with it, and that is a bug of
// its own, not a smaller one.
//
// value, 直前のコード, 候補であるべきか, why
var CONTEXT = [
  ["WScript.Shell", "    Set sh = CreateObject(", false,
    "ProgID (F04 の実物)"],
  ["Shell.Application", "    Set app = CreateObject(", false,
    "ProgID (F04 の実物)"],
  ["Scripting.FileSystemObject", "    Set fso = CreateObject(", false,
    "ProgID"],
  ["ADODB.Connection", "    Set cn = CreateObject(", false, "ProgID"],
  ["Forms.CommandButton.1",
    "    ThisWorkbook.Worksheets(1).OLEObjects.Add ClassType:=", false,
    "ProgID (F05 の実物)"],
  ["notepad.exe", "    Shell ", false, "実行ファイル名 (F04 の実物)"],
  ["cmd.exe /c echo hello", "    sh.Run ", false,
    "コマンド行 (F04 の実物)"],
  // The same two strings, outside those calls, are ordinary values.
  ["notepad.exe", "    logName = ", true, "Shell の外なら普通の名前"],
  ["Report.Backup", "    name = ", true, "ProgID と同型の本物のファイル名"],
  ["Word.docx", "    f = ", true, "ProgID と同型 (Word.) のファイル名"],
  // A real path handed to a call is still a real path: the context column is
  // only on the last two rules, so nothing above them can be lost this way.
  ["S:\\eigyo\\shinsei\\", "    app.Explore ", true,
    "Explore の引数は本物のパス (F04 の実物)"],
  ["C:\\data\\", "    Set sh = CreateObject(", true,
    "ドライブ始まりは文脈に関係なく場所"]
];

// ---- PROD-11: shapes that are not locations at all ----
var MUST_REJECT_SHAPE = [
  [".csv", "裸の拡張子"],
  [".xlsx", "裸の拡張子"],
  ["*.xlsx", "純粋なワイルドカード (H01 の実物)"],
  ["*.*", "純粋なワイルドカード"]
];

// ---- PROD-16: what the reader is actually asked to retype ----
//
// A connection string is one literal, but only the folder inside it is a
// place. Without a capture group the reader had to retype the whole string -
// including the quotes inside Extended Properties - to move a folder.
var F06_ACCDB =
  "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=S:\\eigyo\\shinsei\\" +
  "master.accdb;Persist Security Info=False;";
var F06_XLSX =
  "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=S:\\eigyo\\shinsei\\" +
  "rate.xlsx;Extended Properties=\"Excel 12.0 Xml;HDR=YES\";";

// value, 直前のコード, 編集できる部分, 呼び方, why
var SEGMENTS = [
  [F06_ACCDB, "    Private Const CONN As String = ",
    "S:\\eigyo\\shinsei\\", "接続文字列の中の場所",
    "F06 の実物・Data Source のパス部分だけ"],
  [F06_XLSX, "    ExcelSource = ",
    "S:\\eigyo\\shinsei\\", "接続文字列の中の場所",
    "F06 の実物・HDR=YES を打ち直させない"],
  // Backward compatibility: a rule with no capture group still means the
  // whole literal, exactly as before.
  ["C:\\data\\", "", "C:\\data\\", "ドライブから始まる場所",
    "捕獲グループの無い規則はリテラル全体"],
  ["data.csv", "", "data.csv", "ファイル名",
    "捕獲グループの無い規則はリテラル全体"],
  // The naming complaint in PROD-16: a string that is not concatenated must
  // not be called a concatenated fragment.
  ["\\data\\", "", "\\data\\", "連結された場所の一部",
    "区切りで始まる断片は今までどおりの呼び方"],
  [F06_ACCDB.replace("Data Source=", "DataSrc="),
    "    x = ",
    F06_ACCDB.replace("Data Source=", "DataSrc="), "場所を含む文字列",
    "連結されていない文字列に「連結された…」と出さない"]
];

MUST_KEEP.forEach(function (row) {
  var label = classify(row[0], "");
  assert(label !== null,
    "候補から落ちてはいけない値が落ちた: " + JSON.stringify(row[0]) + " (" + row[1] + ")");
});

MUST_REJECT.forEach(function (row) {
  var label = classify(row[0], "");
  assert(label === null,
    "書式文字列が「" + label + "」として候補に出た: " +
      JSON.stringify(row[0]) + " (" + row[1] + ")");
});

MUST_REJECT_SHAPE.forEach(function (row) {
  var label = classify(row[0], "");
  assert(label === null,
    "場所でない形が「" + label + "」として候補に出た: " +
      JSON.stringify(row[0]) + " (" + row[1] + ")");
});

CONTEXT.forEach(function (row) {
  var label = classify(row[0], row[1]);
  if (row[2]) {
    assert(label !== null,
      "文脈のせいで本物が落ちた: " + JSON.stringify(row[0]) +
        " 直前=" + JSON.stringify(row[1]) + " (" + row[3] + ")");
  } else {
    assert(label === null,
      "場所でないものが「" + label + "」として候補に出た: " +
        JSON.stringify(row[0]) + " 直前=" + JSON.stringify(row[1]) +
        " (" + row[3] + ")");
  }
});

SEGMENTS.forEach(function (row) {
  var found = match(row[0], row[1]);
  assert(found !== null,
    "候補にならなかった: " + JSON.stringify(row[0]) + " (" + row[4] + ")");
  assert(found.label === row[3],
    "呼び方が違う: 期待 " + row[3] + " 実際 " + found.label +
      " 値=" + JSON.stringify(row[0]) + " (" + row[4] + ")");
  assert(found.segment === row[2],
    "編集できる部分が違う: 期待 " + JSON.stringify(row[2]) +
      " 実際 " + JSON.stringify(found.segment) +
      " 値=" + JSON.stringify(row[0]) + " (" + row[4] + ")");
});

console.log("test-path-candidate-rules: PASS (" +
  MUST_KEEP.length + " keep / " +
  (MUST_REJECT.length + MUST_REJECT_SHAPE.length) + " reject / " +
  CONTEXT.length + " context / " +
  SEGMENTS.length + " segment)");
