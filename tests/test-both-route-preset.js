"use strict";

// 両方経路（固定パス置換 ＋ AI 改修）で、AI 段へ渡すひな形の選び方を固定する。
//
// 実機で見つけた行き止まり: 画面3で「02 固定パスを新環境へ置き換える」と
// 「03 VBAリファクター」を選ぶと、画面4の2段目（置換の後、AIへ何を頼むか）で
// ［次へ］が有効表示のまま押しても何も起きなかった。
// 原因は applyPresetSelection が presetContent / 返答契約を「選んだ先頭」から
// 取っていたこと。先頭は表ひな形なので、AI 用として解析すると invalid になり、
// prepareRepairRequest が無言で return していた。
// 「01 Win32 ＋ 02 固定パス」だと 01 が先頭に来るため、この不具合は隠れる。
//
// よって固定するのは「AI 段には、実際に送る内容を持つ最初のひな形が渡る」こと。

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

["response-package.js", "diagnosis-package.js", "vba-lexer.js",
  "path-map.js", "screens.js", "state.js"].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(root, "assets", "js", name), "utf8"),
    context,
    { filename: name });
});

var store = windowObject.MacroStudioState;
var screens = windowObject.MacroStudioScreens;

var presetDir = path.join(root, "presets", "01_マクロ改修", "02_改修");
function preset(fileName) {
  var full = path.join(presetDir, fileName);
  var content = fs.readFileSync(full, "utf8");
  var parsed = windowObject.MacroStudioPreset
    ? windowObject.MacroStudioPreset.parse(content, "repair")
    : null;
  return { file: fileName, content: content, parsed: parsed, name: fileName };
}

// preset-document.js is needed to parse; load it into the same context.
vm.runInContext(
  fs.readFileSync(path.join(root, "assets", "js", "preset-document.js"), "utf8"),
  context,
  { filename: "preset-document.js" });

var files = fs.readdirSync(presetDir).filter(function (n) {
  return n.slice(-3) === ".md";
}).sort();

var table = null;
var sender = null;
files.forEach(function (name) {
  var entry = preset(name);
  if (!entry.parsed || entry.parsed.invalid) { return; }
  if (Array.isArray(entry.parsed.replaceRules) && !table) { table = entry; }
  if (entry.parsed.instruction && !sender) { sender = entry; }
});

assert(table, "表ひな形（## 置換の候補 を持つもの）が見つからない");
assert(sender, "AIへ送るひな形（## 改修指示 を持つもの）が見つからない");

// 表ひな形と AI ひな形の両方を選ぶ = 実機で行き止まりになった組み合わせ。
// setRepairPreset は内部で番号順に並べ直すので、選ぶ順は結果を変えない。
store.reset();
store.setRepairPreset(table);
store.setRepairPreset(sender);
var state = store.getState();

assert(state.presetEngine === "AI",
  "表 + AI の組み合わせは AI 経路になるはず: " + state.presetEngine);
assert(state.presetContent === sender.content,
  "AI 段へ渡るひな形が、送る内容を持つ方になっていない（表ひな形が渡っている）");
assert(state.presetFile === sender.file,
  "presetFile が送る側のひな形を指していない: " + state.presetFile);
assert(state.outputRules,
  "返答契約（## 出力指示）が空。表ひな形から取ってしまっている");

// 逆順で選んでも同じ結果になること（選ぶ順で挙動が変わらない）
store.reset();
store.setRepairPreset(sender);
store.setRepairPreset(table);
var state2 = store.getState();
assert(state2.presetContent === sender.content,
  "逆順で結果が変わってはいけない");
assert(state2.outputRules, "逆順で返答契約が空になってはいけない");

// 表だけを選んだときは、従来どおり表が唯一のひな形として残る
store.reset();
store.setRepairPreset(table);
var state3 = store.getState();
assert(state3.presetContent === table.content,
  "表だけを選んだときは表ひな形が presetContent であるべき");
assert(screens.getEngine(state3) === "対応表による置換",
  "表だけの選択は置換経路であるべき: " + screens.getEngine(state3));

console.log("test-both-route-preset: PASS");
