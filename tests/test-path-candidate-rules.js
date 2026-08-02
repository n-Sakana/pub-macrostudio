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

// Same semantics the screen uses: first rule whose pattern matches names it.
function classify(value) {
  var i;
  for (i = 0; i < parsed.replaceRules.length; i++) {
    if (new RegExp(parsed.replaceRules[i].pattern).test(value)) {
      return parsed.replaceRules[i].label;
    }
  }
  return null;
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

MUST_KEEP.forEach(function (row) {
  var label = classify(row[0]);
  assert(label !== null,
    "候補から落ちてはいけない値が落ちた: " + JSON.stringify(row[0]) + " (" + row[1] + ")");
});

MUST_REJECT.forEach(function (row) {
  var label = classify(row[0]);
  assert(label === null,
    "書式文字列が「" + label + "」として候補に出た: " +
      JSON.stringify(row[0]) + " (" + row[1] + ")");
});

console.log("test-path-candidate-rules: PASS (" +
  MUST_KEEP.length + " keep / " + MUST_REJECT.length + " reject)");
