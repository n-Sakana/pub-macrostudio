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

// ---- 予約デバイス名（PROD-12。ここは実測に基づく） -----------------------
// 以前この節は「通ってしまう現状」を固定していた。実機で測ったところ、
// ビルドは失敗せず**成功し**、出来上がるのは
// 「列挙には出るが Test-Path が False・Excel で開けない・改名も削除もできない」
// 成果物だった（findings\FINDINGS.md の PROD-12）。
// result.md が案内するロールバック手順も実行できない。
// 待たされてから気づく話ではなく、直せない物が出来るので、画面7で弾く。
//
// 弾く集合は qa\run01-blackbox\lib\probe-reserved-names.ps1 の実測に合わせた。
// 文書の一覧（COM1〜COM9 / LPT1〜LPT9）より広く、**COM0 / LPT0 / CLOCK$ も
// 同じ性質**を示す。
[
  ["CON.xlsm", "CON"],
  ["PRN.xlsm", "PRN"],
  ["AUX.xlsm", "AUX"],
  ["NUL.xlsm", "NUL"],
  ["CLOCK$.xlsm", "CLOCK$ も実測で到達不能"],
  ["con.xlsm", "小文字"],
  ["Con.xlsm", "大小混在"],
  ["CON .xlsm", "末尾空白を落とすと予約名"],
  ["CON..xlsm", "末尾ドットを落とすと予約名"],
  ["CON.backup.xlsm", "先頭成分が予約名（古い Windows では装置として解決される）"]
].forEach(function (row) {
  assert(ok(row[0]) === false,
    "予約デバイス名が受理された（" + row[1] + "）: " + row[0]);
});

// COM0..COM9 / LPT0..LPT9 は全数。0 番も実測では到達不能だった。
(function () {
  var i;
  for (i = 0; i <= 9; i += 1) {
    assert(ok("COM" + i + ".xlsm") === false, "COM" + i + " が受理された");
    assert(ok("LPT" + i + ".xlsm") === false, "LPT" + i + " が受理された");
    assert(ok("lpt" + i + ".xlsm") === false, "lpt" + i + " が受理された");
  }
}());

// 元ブックが別形式でも同じこと
assert(ok("CON.xlsb", ".xlsb") === false, ".xlsb の CON が受理された");
assert(ok("NUL.xlam", ".xlam") === false, ".xlam の NUL が受理された");

// ---- 予約名に「似ているだけ」の正当な名前は通し続ける -------------------
// 締めすぎると正当な名前が黙って通らなくなる。ここは全て実測で
// 普通のファイルとして作成・読み書き・削除できたもの。
[
  ["CONTRACT.xlsm", "前方一致するだけ"],
  ["CON1.xlsm", "CON1 は予約名ではない"],
  ["COM.xlsm", "数字が無ければ予約名ではない"],
  ["LPT.xlsm", "同上"],
  ["NULL.xlsm", "NUL ではない"],
  ["AUXILIARY.xlsm", "AUX で始まるだけ"],
  ["COM10.xlsm", "2桁は予約名ではない"],
  ["backup.CON.xlsm", "先頭成分でなければ関係ない"]
].forEach(function (row) {
  assert(ok(row[0]) === true,
    "正当な名前が予約名として拒否された（" + row[1] + "）: " + row[0]);
});

// ---- 制御文字（PROD-12 の同項） -----------------------------------------
// .NET の WriteAllBytes すら作成を拒否する。貼り付けで混入しうるので弾く。
assert(ok("book" + String.fromCharCode(1) + "name.xlsm") === false,
  "制御文字を含む名前が受理された");
assert(ok("book" + String.fromCharCode(31) + "name.xlsm") === false,
  "制御文字 0x1F を含む名前が受理された");
assert(ok("book" + String.fromCharCode(0) + "name.xlsm") === false,
  "NUL 文字を含む名前が受理された");

// ---- 拒否の理由を名乗ること -----------------------------------------------
// 枠が赤くなるだけで理由が出ず、唯一の補足が「拡張子は .xlsm のままにします」
// だった。パス区切りのときは的外れ、予約デバイス名のときは**嘘**になる。
function problem(name, ext) {
  return screens.getOutputNameProblem({
    outputName: name,
    book: {ext: ext || ".xlsm"}
  });
}

// 正当な名前では理由を出さない（＝既定の補足文のままにする）
[
  "S01_fixed_drive-Modified-20260802.xlsm", "a.xlsm", "CONTRACT.xlsm",
  "backup.CON.xlsm", "日本語のファイル名.xlsm"
].forEach(function (name) {
  assert(problem(name) === "",
    "正当な名前に理由が出た: " + name + " -> " + problem(name));
});

// 拒否される名前では必ず理由が出る、かつ理由が原因ごとに違う
[
  ["", "入力"],
  ["book", "拡張子"],
  ["sub\\book.xlsm", "区切り"],
  ["CON.xlsm", "装置"],
  ["COM9.xlsm", "装置"],
  ["book.xlsx", "拡張子"],
  [repeat("x", 200) + ".xlsm", "長"]
].forEach(function (row) {
  var text = problem(row[0]);
  assert(text.length > 0, "拒否された名前に理由が無い: " + row[0]);
  assert(text.indexOf(row[1]) >= 0,
    "理由が原因と噛み合っていない（" + row[1] + " を含むはず）: " +
      row[0] + " -> " + text);
});

// 予約デバイス名の理由は、拡張子の話をしてはいけない（これが元の不具合）
assert(problem("CON.xlsm").indexOf("拡張子") < 0,
  "予約デバイス名の理由が拡張子の話になっている: " + problem("CON.xlsm"));
// そして、その名前自身を名指しすること
assert(problem("COM1.xlsm").indexOf("COM1") >= 0,
  "理由が問題の名前を名指ししていない: " + problem("COM1.xlsm"));

// 制御文字は「使えない文字」として説明され、装置名の話にならない
assert(problem("a" + String.fromCharCode(7) + "b.xlsm").indexOf("文字") >= 0,
  "制御文字の理由が文字の話になっていない");

// isOutputNameValid と getOutputNameProblem が食い違わないこと。
// 片方だけ直すと、赤いのに理由が空、あるいは理由が出るのに次へ進める。
[
  "", "   ", "book", "book.xlsm", "CON.xlsm", "CONTRACT.xlsm", "sub/b.xlsm",
  "book.xlsx", "COM0.xlsm", "LPT9.xlsm", "backup.CON.xlsm", "CLOCK$.xlsm",
  "a.xlsm", "CON..xlsm", "CON .xlsm", "COM10.xlsm"
].forEach(function (name) {
  assert(ok(name) === (problem(name) === ""),
    "受理判定と理由の有無が食い違う: " + name +
      " valid=" + ok(name) + " problem=\"" + problem(name) + "\"");
});

console.log("test-output-name: PASS");
console.log(
  "出力ファイル名は「ファイル名のみ・元の拡張子・120文字以内・" +
  "予約デバイス名でない・制御文字を含まない」で受理される（PROD-12 を修正）");
