"use strict";

// 画面7（出力ファイル名）の受理条件を総当たりで固定する。
//
// SPEC §2.1 の表は［次へ］の条件を「名前が正しい（ファイル名のみ・元の拡張子）」
// とだけ書いており、何を弾くかは実装にしかない。ここが緩むと、待たされた末に
// ビルドで落ちる。逆に厳しすぎると正当な名前が黙って通らなくなる。
//
// 「ファイル名のみ」＝ パス区切りとドライブ指定を含まないこと、
// 「元の拡張子」＝ 元ブックの拡張子で終わること、として実装されている。
//
// 末尾に、現状は通ってしまう入力（Windows の予約デバイス名と制御文字）を
// 「現状こうである」として記録してある。これは合格を主張するものではなく、
// findings\FINDINGS.md の PROD-12 として報告した挙動の固定である。

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
var context = vm.createContext({window: windowObject});
windowObject.window = windowObject;

["response-package.js", "diagnosis-package.js", "vba-lexer.js",
  "path-map.js", "screens.js"].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
    context,
    {filename: name});
});

var screens = windowObject.MacroStudioScreens;

function ok(name, ext) {
  return screens.isOutputNameValid({
    outputName: name,
    book: {ext: ext || ".xlsm"}
  });
}

function repeat(text, count) {
  var out = "";
  var i;
  for (i = 0; i < count; i += 1) {
    out += text;
  }
  return out;
}

// ---- 受理されるべきもの --------------------------------------------------
[
  ["S01_fixed_drive-Modified-20260802.xlsm", "実際に製品が既定で入れる形"],
  ["a.xlsm", "最小"],
  ["日本語のファイル名.xlsm", "日本語"],
  ["BOOK.XLSM", "拡張子の大文字小文字は問わない"],
  ["   book.xlsm   ", "前後の空白は落として判定する"],
  ["名前 に 空白.xlsm", "内部の空白は正当"],
  ["book.backup.xlsm", "途中のドットは正当"],
  [repeat("x", 120 - ".xlsm".length) + ".xlsm", "上限ちょうど 120 文字"]
].forEach(function (row) {
  assert(ok(row[0]) === true,
    "受理されるはずの名前が拒否された（" + row[1] + "）: " + row[0]);
});

// 元ブックが .xlsb / .xlam / .xls でも、その拡張子で終われば受理される
[[".xlsb", "book.xlsb"], [".xlam", "book.xlam"], [".xls", "book.xls"]]
  .forEach(function (row) {
    assert(ok(row[1], row[0]) === true,
      "元の拡張子に合った名前が拒否された: " + row[1] + " (" + row[0] + ")");
  });

// ---- 拒否されるべきもの --------------------------------------------------
[
  ["", "空"],
  ["   ", "空白だけ"],
  ["book", "拡張子が無い"],
  [".xlsm", "拡張子だけ（ドットが先頭）"],
  ["book.xlsx", "元と違う拡張子"],
  ["book.xls", "元と違う拡張子（前方一致に見えるが別物）"],
  ["book.xlsm.", "末尾のドット"],
  ["sub\\book.xlsm", "パス区切り（円記号）"],
  ["sub/book.xlsm", "パス区切り（スラッシュ）"],
  ["C:book.xlsm", "ドライブ指定"],
  ["..\\book.xlsm", "相対パス"],
  ["bo*ok.xlsm", "ワイルドカード *"],
  ["bo?ok.xlsm", "ワイルドカード ?"],
  ["bo\"ok.xlsm", "引用符"],
  ["bo<ok.xlsm", "山括弧 <"],
  ["bo>ok.xlsm", "山括弧 >"],
  ["bo|ok.xlsm", "パイプ"],
  [repeat("x", 121 - ".xlsm".length) + ".xlsm", "121 文字（上限超過）"]
].forEach(function (row) {
  assert(ok(row[0]) === false,
    "拒否されるはずの名前が受理された（" + row[1] + "）: " + row[0]);
});

// 拡張子が長いケースで上限が拡張子ぶんずれていないこと
assert(ok(repeat("x", 120 - ".xlsb".length) + ".xlsb", ".xlsb") === true,
  ".xlsb で 120 文字ちょうどが拒否された");
assert(ok(repeat("x", 121 - ".xlsb".length) + ".xlsb", ".xlsb") === false,
  ".xlsb で 121 文字が受理された");

// ---- 現状の記録（PROD-12 として報告済み。合格の主張ではない） -------------
// Windows が作れない名前だが、画面7は通す。落ちるのはビルドの IO 例外で、
// そこは E-BUILD-03 として出力を捨てる作りになっているため安全は保たれる。
// ただし利用者はビルドを待たされてから知ることになる。
["CON.xlsm", "PRN.xlsm", "AUX.xlsm", "NUL.xlsm", "COM1.xlsm", "LPT1.xlsm"]
  .forEach(function (name) {
    assert(ok(name) === true,
      "予約デバイス名の扱いが変わった（変えたなら PROD-12 を閉じて " +
        "このテストを反転させること）: " + name);
  });
// 制御文字も同様に通る。貼り付けで入りうる。
assert(ok("book" + String.fromCharCode(1) + "name.xlsm") === true,
  "制御文字の扱いが変わった（変えたなら PROD-12 を閉じること）");

console.log("test-output-name: PASS");
console.log(
  "出力ファイル名は「ファイル名のみ・元の拡張子・120文字以内」で受理される。" +
  "予約デバイス名と制御文字が通る現状も固定した（PROD-12）");
