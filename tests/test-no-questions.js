"use strict";

// A repair answer has two shapes and no third one.
//
//   1. the changed code, in the shape the request asked for
//   2. a refusal, with a reason: UNNECESSARY / IMPOSSIBLE / UNCLEAR
//
// What a chat reaches for when it is unsure is the third thing: asking
// the reader a question, or offering options to choose between. That is
// a conversation the app cannot hold - it hands text to a chat through
// the clipboard and takes text back - so a reply that starts one is
// refused, and the reason says what to send instead.
//
// "I would need to know X" is not a question here. It is UNCLEAR, with
// X written as the reason.

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
var context = vm.createContext({
  window: windowObject,
  Math: Math,
  JSON: JSON,
  Uint8Array: Uint8Array
});
windowObject.window = windowObject;
["response-package.js", "preset-document.js"].forEach(function (name) {
  vm.runInContext(readUtf8(path.join(root, "assets", "js", name)),
    context, {filename: name});
});

var api = windowObject.MacroStudioResponse;
var presets = windowObject.MacroStudioPreset;
var ID = "3f1c9c7a-2b64-4a1e-9f52-0b5a4d2e77c1";

function marker(rest) {
  return "'@MACROSTUDIO " + ID + " " + rest;
}

function summary(text) {
  return [marker("SUMMARY BEGIN"), text, marker("SUMMARY END")];
}

// ---- the two answers the contract allows ----

var code = api.parse([].concat(
  summary("待ち時間を標準機能へ置き換えました。"),
  [
    marker("BEGIN standard TimerUtils"),
    "Option Explicit",
    marker("END standard TimerUtils"),
    marker("COMPLETE 1")
  ]).join("\r\n"), ID);
assert(code.ok && code.modules.length === 1 && code.noChange === null,
  "The changed code is one of the two answers.");

["UNNECESSARY", "IMPOSSIBLE", "UNCLEAR"].forEach(function (verdict) {
  var refusal = api.parse([].concat(
    summary("この判断にした理由です。"),
    [marker("NOCHANGE " + verdict), marker("COMPLETE 0")]).join("\r\n"), ID);

  assert(refusal.ok && refusal.noChange === verdict,
    verdict + " is a refusal the contract accepts.");
  assert(refusal.modules.length === 0,
    verdict + " carries no modules.");
  assert(String(refusal.summary).indexOf("理由") >= 0,
    verdict + " carries the reason it gave.");
});

assert(api.verdicts.length === 3 &&
  api.verdicts.indexOf("NEEDDECISION") < 0,
"NEEDDECISION named a handover to the reader and is gone.");

// A refusal with no reason is still refused: silence is not a verdict.
var silent = api.parse([
  marker("NOCHANGE UNCLEAR"),
  marker("COMPLETE 0")
].join("\r\n"), ID);
assert(!silent.ok && silent.reason === "noChangeReason",
  "A refusal with no reason must still be refused.");

// ---- the third shape is refused ----

function expectQuestionRefused(lines, label) {
  var result = api.parse(lines.join("\r\n"), ID);

  assert(!result.ok, label + " must be refused.");
  assert(result.reason === "questionNotAllowed",
    label + " must be refused as a question, got " + result.reason);
  assert(result.validationId === "R3",
    label + " must be refused by R3, got " + result.validationId);
  assert(String(result.message).indexOf("UNCLEAR") >= 0,
    label + " must be told what to send instead.");
}

expectQuestionRefused([].concat(
  summary("保存先が決まりません。"),
  [
    marker("DECISION BEGIN 1"),
    marker("META FINDING=1 MODULE=TimerUtils"),
    marker("TEXT BEGIN QUESTION"),
    "共有先と個人先のどちらですか。",
    marker("TEXT END QUESTION"),
    marker("TEXT BEGIN OPTIONS"),
    "共有先 / 個人先",
    marker("TEXT END OPTIONS"),
    marker("DECISION END 1"),
    marker("NOCHANGE UNCLEAR"),
    marker("COMPLETE 0")
  ]), "A reply that asks the reader to choose");

// The dangerous one: code AND a question in the same answer. Taking the
// code in would apply a change the chat itself said it was unsure about.
expectQuestionRefused([].concat(
  summary("直しましたが、確認したい点があります。"),
  [
    marker("BEGIN standard TimerUtils"),
    "Option Explicit",
    marker("END standard TimerUtils"),
    marker("DECISION BEGIN 1"),
    marker("META FINDING=- MODULE=-"),
    marker("TEXT BEGIN QUESTION"),
    "この解釈で合っていますか。",
    marker("TEXT END QUESTION"),
    marker("TEXT BEGIN OPTIONS"),
    "はい / いいえ",
    marker("TEXT END OPTIONS"),
    marker("DECISION END 1"),
    marker("COMPLETE 1")
  ]), "A reply that returns code and asks a question anyway");

expectQuestionRefused([].concat(
  summary("決められません。"),
  [
    marker("TEXT BEGIN QUESTION"),
    "どちらにしますか。",
    marker("TEXT END QUESTION"),
    marker("NOCHANGE UNCLEAR"),
    marker("COMPLETE 0")
  ]), "A bare question block with no decision wrapper");

// ---- the request says so, in every template that sends one ----

// Every repair template. The rule is about what goes out to a chat, so
// it applies to the whole folder without exception.
var repairDir = path.join(root, "presets", "02_改修");
var repairTemplates = fs.readdirSync(repairDir)
  .filter(function (name) {
    return /\.md$/.test(name);
  }).map(function (name) {
    return {label: name, path: path.join(repairDir, name)};
  });

assert(repairTemplates.length >= 5,
  "The scan found almost no repair templates: " + repairTemplates.length);

repairTemplates.forEach(function (template) {
  var name = template.label;
  var parsed = presets.parse(readUtf8(template.path), "repair");

  if (parsed.replaceRules) {
    // A template that only asks for the replacement table sends nothing
    // to a chat, so it has no output contract to check.
    return;
  }

  assert(parsed.valid, name + " must parse.");
  [parsed.output, parsed.splitOutput].forEach(function (rules) {
    assert(rules, name + " must carry both output contracts.");
    assert(rules.body.indexOf("返せる答えは 2 つだけです") >= 0,
      name + " must say there are two answers.");
    assert(rules.body.indexOf("質問を返したり") >= 0,
      name + " must forbid asking the reader anything.");
    assert(rules.body.indexOf("UNCLEAR") >= 0,
      name + " must name the refusal for what cannot be settled.");
    assert(rules.body.indexOf("DECISION BEGIN") < 0,
      name + " must not still describe a question exchange.");
  });
});

console.log("test-no-questions: PASS");
console.log(
  "a repair answer is the changed code or a refusal with a reason; a " +
  "reply that asks the reader anything - alone or alongside code - is " +
  "refused as R3 and told to send UNCLEAR instead, and every request " +
  "that goes out says so");
