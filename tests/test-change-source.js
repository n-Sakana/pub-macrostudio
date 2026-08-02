"use strict";

// 確認画面（画面6）は AI 経路と置換経路の合流点なので、「どちらから来た変更か」を
// 名乗り分ける必要がある。ここが崩れると、AI へ一度も渡していない実行で
// 「AIの回答を取り込みました」と出て、［この回答は採用しない］（＝AIへの修正依頼）
// まで並ぶ。
//
// 一度 countImported(state) > 0 を判定に使って失敗した。置換経路も
// importPackageItems() を通り、そこで module.pastedCode が入るため、
// pastedCode の有無は「AIが答えたか」の印にならない。
// 正しい印は state.repairResultEngine（intake 時に経路名がそのまま入る）。
// このテストはその区別を固定する。

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

var screens = windowObject.MacroStudioScreens;

function stateFrom(engine) {
  return {
    // 置換経路でも AI 経路でも、取り込んだモジュールの形はこうなる。
    modules: [{
      name: "ExportSummary",
      code: "Const A = \"S:\\eigyo\\\"",
      pastedCode: "Const A = \"E:\\eigyo\\\"",
      status: "changed",
      accepted: true
    }],
    repairResultEngine: engine
  };
}

var replaced = stateFrom("対応表による置換");
var answered = stateFrom("AI");

// 1. pastedCode は経路を区別しない（これが最初の修正を誤らせた事実）
assert(screens.countImported(replaced) > 0,
  "置換経路でも pastedCode は入る: countImported が 0 だと前提が変わっている");
assert(screens.countImported(answered) > 0,
  "AI 経路でも countImported は 1 以上のはず");
assert(screens.countImported(replaced) === screens.countImported(answered),
  "countImported は両経路で同じ値になる。だから経路の判別には使えない");

// 2. repairResultEngine は経路を区別する
assert(replaced.repairResultEngine === "対応表による置換",
  "置換経路の印が違う");
assert(answered.repairResultEngine !== "対応表による置換",
  "AI 経路が置換扱いになっている");

// 3. 画面が使う判定式そのもの（app.js と同じ式）を固定する
function saysAiAnswered(state) {
  return state.repairResultEngine !== "対応表による置換";
}
assert(saysAiAnswered(replaced) === false,
  "置換のみの実行で「AIの回答を取り込みました」と名乗ってはいけない");
assert(saysAiAnswered(answered) === true,
  "AI 経路では「AIの回答を取り込みました」と名乗る");

// 4. 実装が実際にその式を使っているか（countImported へ戻っていないか）
var appSource = fs.readFileSync(
  path.join(root, "assets", "js", "app.js"), "utf8");
assert(
  appSource.indexOf("state.repairResultEngine === \"対応表による置換\"") !== -1,
  "確認画面の見出しが repairResultEngine で判別していない");
assert(
  appSource.indexOf("state.repairResultEngine !== \"対応表による置換\"") !== -1,
  "［この回答は採用しない］の出し分けが repairResultEngine を見ていない");
// countImported は経路を区別しないので、画面の描画判断に使ってはいけない。
assert(appSource.indexOf("countImported") === -1,
  "app.js が countImported で経路を判別している（置換経路を AI 扱いする）");

console.log("test-change-source: PASS");
