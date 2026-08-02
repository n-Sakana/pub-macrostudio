"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");
var dom = require("./helpers/dom-shim");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message + "\nexpected: " + JSON.stringify(expected) +
      "\nactual: " + JSON.stringify(actual));
  }
}

function loadProduct() {
  var context = {window: {}};
  ["vba-lexer.js", "path-map.js"].forEach(function (name) {
    vm.runInNewContext(
      fs.readFileSync(
        path.join(__dirname, "..", "assets", "js", name),
        "utf8"),
      context,
      {filename: name});
  });
  return {
    lexer: context.window.MacroStudioVbaLexer,
    pathMap: context.window.MacroStudioPathMap
  };
}

function row(mapping, value) {
  var found = null;
  mapping.rows.some(function (item) {
    if (item.groupKey === value) {
      found = item;
      return true;
    }
    return false;
  });
  return found;
}

function update(api, mapping, value, patch) {
  var next = api.updateRow(mapping, value, patch);
  assert(next && next !== mapping, "The mapping row was not updated: " + value);
  return next;
}

var product = loadProduct();
var api = product.pathMap;
var classifierModule = {
  name: "Classifier",
  code:
    "Option Explicit\r\n" +
    "Public Sub Probe()\r\n" +
    "  a = \"C:\\Data\\report.xlsx\"\r\n" +
    "  b = \"\\\\server\\share\\report.xlsx\"\r\n" +
    "  c = \"https://example.test/report.csv\"\r\n" +
    "  d = \"%APPDATA%\\MacroStudio\\cache.dat\"\r\n" +
    "  e = \"..\\Users\\person\\Desktop\\report.xlsx\"\r\n" +
    "  f = \"folder/\" & _\r\n" +
    "      \"child/\"\r\n" +
    "  Workbooks.Open \"report.xlsx\"\r\n" +
    "  q = \"archive.tar\"\r\n" +
    "  r = \"folder/\"\r\n" +
    "  s = \"C:\\Data\\report.xlsx\"\r\n" +
    "  t = \"c:\\data\\report.xlsx\"\r\n" +
    "  Rem \"C:\\hidden\\rem.txt\"\r\n" +
    "  ' \"C:\\hidden\\apostrophe.txt\"\r\n" +
    "  Debug.Print [C:\\hidden\\bracket.txt]\r\n" +
    "End Sub\r\n"
};
// The rules come from a template. This file supplies its own so that
// what is being tested is the mechanism - lex, match, group, replace,
// re-verify - and not any opinion about what a path is. The product has
// no such opinion left to test.
var RULES = [
  {label: "ドライブ", pattern: "^[A-Za-z]:[\\\\/]", selectedByDefault: true},
  {label: "共有", pattern: "^\\\\\\\\[^\\\\]", selectedByDefault: true},
  {label: "URL", pattern: "^https?://", selectedByDefault: true},
  {label: "環境変数", pattern: "%[A-Za-z_][A-Za-z0-9_()]*%"},
  {label: "区切りあり", pattern: "[\\\\/]"}
];
var mapping = api.detect([classifierModule], RULES);

assert(api.isProductResult(mapping), "Detection did not return a product result.");
assert(Object.isFrozen(mapping), "The product mapping must be immutable.");
[
  ["C:\\Data\\report.xlsx", "ドライブ"],
  ["\\\\server\\share\\report.xlsx", "共有"],
  ["https://example.test/report.csv", "URL"],
  ["%APPDATA%\\MacroStudio\\cache.dat", "環境変数"],
  ["..\\Users\\person\\Desktop\\report.xlsx", "区切りあり"],
  ["folder/", "区切りあり"]
].forEach(function (expected) {
  var found = row(mapping, expected[0]);
  assert(found, "Missing rule fixture " + expected[0]);
  equal(found.label, expected[1], "Label mismatch for " + expected[0]);
});

// A literal no rule claims is not a candidate. Deciding it might be one
// anyway would be the app forming its own view.
assert(!row(mapping, "report.xlsx") && !row(mapping, "archive.tar"),
  "A literal no rule matched must not become a candidate.");

// The first rule wins, and it wins for the whole group.
equal(
  row(mapping, "%APPDATA%\\MacroStudio\\cache.dat").label,
  "環境変数",
  "An earlier rule must win over a later one that also matches.");
equal(
  row(mapping, "folder/").occurrences.length,
  2,
  "Equal values must aggregate by value alone.");
assert(
  row(mapping, "C:\\Data\\report.xlsx") !==
    row(mapping, "c:\\data\\report.xlsx"),
  "Case-distinct values must remain separate rows.");

// Whether a candidate starts ticked is the template's call.
assert(row(mapping, "C:\\Data\\report.xlsx").included === true &&
  row(mapping, "folder/").included === false,
"A rule's own default must decide whether its rows begin selected.");

// Rules the template could not express are dropped, not guessed at.
equal(
  api.detect([classifierModule], [
    {label: "壊れた", pattern: "^[A-Z"},
    {label: "ドライブ", pattern: "^[A-Za-z]:[\\\\/]"}
  ]).rows.length,
  2,
  "An uncompilable rule must be skipped without taking the rest with it.");
equal(
  api.detect([classifierModule], []).rows.length,
  0,
  "With no rules there are no candidates.");
assert(
  mapping.rows.every(function (item) { return item.applied === false; }),
  "Every mapping row must begin unapplied.");
assert(
  !mapping.rows.some(function (item) {
    return item.from.indexOf("hidden") >= 0;
  }),
  "Comments and bracket identifiers must never become candidates.");

var evidence = row(mapping, "C:\\Data\\report.xlsx").occurrences[0];
var evidenceLine = classifierModule.code.split("\r\n")[evidence.line - 1];
var evidenceToken = evidenceLine.slice(evidence.column, evidence.endColumn);
equal(
  product.lexer.decodeStringToken({
    kind: "string",
    text: evidenceToken
  }),
  "C:\\Data\\report.xlsx",
  "Evidence highlighting must use the product lexer span.");
assert(
  Array.isArray(evidence.logicalLines) &&
    evidence.logicalLines[0].line === evidence.line,
  "Evidence must carry the lexer's logical-line parts.");
equal(
  evidence.procedure,
  "Probe",
  "The occurrence must be attributed to its live procedure.");

// A line the lexer could not read safely around is never classified by a
// rule: the tool refuses to guess about code it could not parse.
var unsafe = api.detect([{
  name: "Unsafe",
  code:
    "#If VBA7 Then\r\n" +
    "x = \"C:\\unsafe\\one.txt\"\r\n"
}, {
  name: "Unterminated",
  code:
    "x = \"C:\\safe\\first.txt\" : [broken\r\n" +
    "y = \"C:\\unterminated\r\n"
}], RULES);
assert(
  unsafe.rows.every(function (item) {
    return item["class"] === api.unsafeClass;
  }),
  "Unbalanced conditionals and unterminated lines must lock every occurrence.");
assert(
  unsafe.rows.every(function (item) { return item.included === false; }),
  "Nothing the tool could not read safely may begin selected.");

// What the app checks is that a replacement can be carried out, not
// whether it is a good one. The shape of the new value is the reader's
// judgement and no rule here inspects it.
[
  {input: {applied: true, to: ""}, id: "M01"},
  {input: {applied: true, to: "x\tpath"}, id: "M02"},
  {input: {applied: true, to: new Array(1026).join("x")}, id: "M03"}
].forEach(function (fixture) {
  var result = api.validateRow(fixture.input);
  assert(!result.ok, fixture.id + " failure was accepted.");
  equal(result.validationId, fixture.id, fixture.id + " ID mismatch.");
});
assert(
  api.validateRow({applied: false, to: "\t"}).ok,
  "An unapplied row must not be validated.");
assert(
  api.validateRow({applied: true, to: "hello"}).ok,
  "A value that does not look like the old one is still the reader's " +
    "to make: the tool has no opinion about its shape.");

var mergeMapping = api.detect([classifierModule], RULES);
mergeMapping = update(
  api,
  mergeMapping,
  "C:\\Data\\report.xlsx",
  {to: "D:\\merged"});
mergeMapping = update(
  api,
  mergeMapping,
  "\\\\server\\share\\report.xlsx",
  {to: "D:\\merged"});
assert(
  api.canApply(mergeMapping),
  "Two source rows may intentionally converge on the same new value.");
assert(
  JSON.stringify(api.validate(mergeMapping)).indexOf("M05") < 0,
  "M05 must not exist.");

var applyModule = {
  name: "ApplyModule",
  code:
    "Option Explicit\r\n" +
    "Public Sub Run()\r\n" +
    "  a = \"C:\\Data\\report.xlsx\": b = \"C:\\Data\\report.xlsx\"\r\n" +
    "  c = \"archive.tar\" ' C:\\Data\\report.xlsx stays text\r\n" +
    "End Sub\r\n"
};
var applyMapping = api.detect([applyModule], RULES);
var newValue = "D:\\New\"Folder\\report.xlsx";
applyMapping = update(
  api,
  applyMapping,
  "C:\\Data\\report.xlsx",
  {to: newValue});
assert(api.canApply(applyMapping), "A valid drive mapping was not ready.");
var applied = api.apply(applyMapping, [applyModule]);
assert(
  api.isProductResult(applied) && applied.ok && applied.kind === "apply",
  "Apply did not return a branded success result.");
equal(applied.modules.length, 1, "The changed module count is wrong.");
equal(
  applied.modules[0].code,
  "Option Explicit\r\n" +
    "Public Sub Run()\r\n" +
    "  a = \"D:\\New\"\"Folder\\report.xlsx\": " +
      "b = \"D:\\New\"\"Folder\\report.xlsx\"\r\n" +
    "  c = \"archive.tar\" ' C:\\Data\\report.xlsx stays text\r\n" +
    "End Sub\r\n",
  "Only the two recorded string-token spans may change.");
assert(
  applied.modules[0].code.indexOf("\"archive.tar\"") >= 0,
  "An unapplied candidate changed.");
assert(
  JSON.stringify(applied.logSummary).indexOf("C:\\Data") < 0 &&
    JSON.stringify(applied.logSummary).indexOf("D:\\New") < 0,
  "The safe log summary leaked path values.");

var alteredModules = [{
  name: applyModule.name,
  code: applyModule.code.replace(
    "C:\\Data\\report.xlsx",
    "C:\\Other\\report.xlsx")
}];
var beforeModules = JSON.stringify(alteredModules);
var beforeMapping = JSON.stringify(applyMapping);
var refused = api.apply(applyMapping, alteredModules);
assert(
  api.isProductResult(refused) && !refused.ok &&
    refused.code === "E-MAP-02",
  "A stale token position must fail the whole preflight.");
equal(
  JSON.stringify(alteredModules),
  beforeModules,
  "E-MAP-02 mutated the input modules.");
equal(
  JSON.stringify(applyMapping),
  beforeMapping,
  "E-MAP-02 mutated staged mappings.");
assert(
  !api.isProductResult(JSON.parse(JSON.stringify(applyMapping))),
  "The private product brand must not survive cloning.");

assert(
  Object.keys(api).every(function (name) {
    return !/replace|replaceAll|fromTo/i.test(name);
  }),
  "An arbitrary string-replacement API must not be public.");

var workflowSource = fs.readFileSync(
  path.join(__dirname, "..", "assets", "js", "screens", "workflow.js"),
  "utf8");
assert(
  workflowSource.indexOf("path-evidence-mark") >= 0 &&
    workflowSource.indexOf("occurrence.column") >= 0 &&
    workflowSource.indexOf("occurrence.endColumn") >= 0,
  "The evidence UI must highlight the exact product-lexer span.");
assert(
  workflowSource.indexOf("MacroStudioVbaHighlight") < 0,
  "The mapping evidence UI must not use the display-only highlighter.");

var uiWindow = {};
var uiDocument = {createElement: dom.createElement};
var uiContext = vm.createContext({window: uiWindow, document: uiDocument});
uiWindow.window = uiWindow;
uiWindow.document = uiDocument;
["icons.js", "preset-document.js", "vba-lexer.js", "path-map.js", "screens.js",
  "screens/workflow.js"].forEach(function (name) {
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "assets", "js", name), "utf8"),
    uiContext,
    {filename: name});
});
var uiMapping = uiWindow.MacroStudioPathMap.detect([classifierModule], RULES);
var uiScreen = uiWindow.MacroStudioWorkflow.createRepairInputScreen({
  presetEngine: "対応表による置換",
  pathMap: uiMapping,
  modules: [classifierModule],
  busyAction: null
});
var uiRows = dom.collect(uiScreen, function (node) {
  return node.classList && node.classList.contains("path-map-row");
});
equal(uiRows.length, uiMapping.rows.length,
  "Screen 4 must render one row per exact-value group.");

// The name beside a candidate is the one its rule carried. The app has
// no table of its own to look it up in.
assert(uiRows.some(function (node) {
  return dom.text(node).indexOf("ドライブ") >= 0;
}), "A row must be labelled with the name the template's rule gave it.");

// Rows carry the whole module now, so a row is found by the value it is
// about rather than by any text that happens to appear inside it.
function uiRowFor(rows, value) {
  return rows.filter(function (node) {
    var shown = node.querySelector(".path-map-value");
    return shown && dom.text(shown) === value;
  })[0];
}

var selectedUiRow = uiRowFor(uiRows, "C:\\Data\\report.xlsx");
var unselectedUiRow = uiRowFor(uiRows, "folder/");
assert(selectedUiRow && selectedUiRow.querySelector(".path-map-input"),
  "A row the template ticks by default must expose its input at once.");
assert(unselectedUiRow &&
  unselectedUiRow.querySelector('[data-workflow-input="path-map-include"]') &&
  !unselectedUiRow.querySelector(".path-map-input"),
"A row the template leaves unticked must wait to be included.");
// The reader is deciding about a string, so the module it lives in is
// shown whole, with the exact token marked inside it. A list of line
// numbers named the place without showing it.
var evidenceMarks = dom.collect(uiScreen, function (node) {
  return node.classList && node.classList.contains("path-evidence-mark");
});
assert(evidenceMarks.length > 0 && dom.text(evidenceMarks[0]).charAt(0) === '"',
  "Evidence must visibly mark the full string token, including its quotes.");
assert(dom.text(selectedUiRow).indexOf("Option Explicit") >= 0 &&
  dom.text(selectedUiRow).indexOf("End Sub") >= 0,
"The module must be shown whole, not as the lines around the match.");
assert(dom.collect(selectedUiRow, function (node) {
  return node.classList && node.classList.contains("path-module-name");
}).length === 1,
"Each module the candidate appears in is named once.");

// Nothing on this screen judges the value that was typed in.
var typedUiMapping = update(
  uiWindow.MacroStudioPathMap,
  uiMapping,
  "C:\\Data\\report.xlsx",
  {to: "hello"});
var typedUiScreen = uiWindow.MacroStudioWorkflow.createRepairInputScreen({
  presetEngine: "対応表による置換",
  pathMap: typedUiMapping,
  busyAction: null
});
assert(
  uiWindow.MacroStudioPathMap.canApply(typedUiMapping) &&
    dom.text(typedUiScreen).indexOf("場所の形") < 0,
  "The screen must not gate a replacement on what the new value looks " +
    "like.");

// ---------------------------------------------------------------------
// PROD-16: a rule may point INSIDE a literal.
//
// A connection string is one string token, but only the folder in it is a
// place. Replacing the whole literal meant retyping Provider=, the quotes
// inside Extended Properties and HDR=YES by hand, any of which the reader
// could get wrong. So the editable part is what the capture group caught,
// and the rest of the literal is rebuilt around whatever is typed.
var connectionModule = {
  name: "AceConn",
  code:
    "Option Explicit\r\n" +
    "Private Const CONN As String = \"Provider=Microsoft.ACE.OLEDB.12.0;" +
    "Data Source=S:\\eigyo\\shinsei\\master.accdb;" +
    "Persist Security Info=False;\"\r\n" +
    "Public Function ExcelSource() As String\r\n" +
    "  ExcelSource = \"Provider=Microsoft.ACE.OLEDB.12.0;" +
    "Data Source=S:\\eigyo\\shinsei\\rate.xlsx;" +
    "Extended Properties=\"\"Excel 12.0 Xml;HDR=YES\"\";\"\r\n" +
    "End Function\r\n"
};
var connectionRules = [
  {
    label: "接続文字列の中の場所",
    pattern: "[Dd]ata\\s+[Ss]ource\\s*=\\s*((?:[A-Za-z]:|\\\\\\\\)[^;\"]*[\\\\/])",
    selectedByDefault: true,
    picksLocation: true
  },
  {label: "場所を含む文字列", pattern: "^(?=.*[^\\\\/]).*[\\\\/]"}
];
var connectionMapping = api.detect([connectionModule], connectionRules);

equal(connectionMapping.rows.length, 1,
  "One folder inside two different connection strings is one row: the " +
  "point of the table is to type a place once.");
var connectionRow = connectionMapping.rows[0];
equal(connectionRow.groupKey, "S:\\eigyo\\shinsei\\",
  "The row is keyed by the part the rule pointed at, not by the literal.");
equal(connectionRow.label, "接続文字列の中の場所",
  "The row carries the name the template gave that rule.");
equal(connectionRow.occurrences.length, 2,
  "Both connection strings are places the same folder is written.");
assert(connectionRow.occurrences[0].prefix.indexOf(
  "Provider=Microsoft.ACE.OLEDB.12.0;") >= 0,
"Each occurrence remembers the part of its own literal that stays put.");
assert(connectionRow.occurrences[0].suffix.indexOf("master.accdb") >= 0 &&
  connectionRow.occurrences[1].suffix.indexOf("HDR=YES") >= 0,
"The two occurrences keep their own tails, which are not the same text.");

var connectionApplied = api.apply(
  update(api, connectionMapping, "S:\\eigyo\\shinsei\\",
    {to: "E:\\新しい場所\\"}),
  [connectionModule]);
assert(connectionApplied.ok, "The replacement must be applicable.");
var rebuilt = connectionApplied.modules[0].code;
assert(rebuilt.indexOf(
  "Data Source=E:\\新しい場所\\master.accdb;Persist Security Info=False;") >= 0,
"The folder changes and the rest of the connection string does not.");
assert(rebuilt.indexOf(
  "Data Source=E:\\新しい場所\\rate.xlsx;" +
  "Extended Properties=\"\"Excel 12.0 Xml;HDR=YES\"\";") >= 0,
"Everything the reader would have had to retype survives untouched, " +
  "including the doubled quotes inside the literal.");
assert(rebuilt.indexOf("S:\\eigyo\\shinsei\\") < 0,
  "No occurrence of the old folder is left behind.");
assert(rebuilt.indexOf("Provider=Microsoft.ACE.OLEDB.12.0;") >= 0,
  "mustPreserve values are not at the mercy of the reader's typing.");

// A row read back from an older session names the whole literal and knows
// nothing about prefixes. It must still apply, unchanged.
var legacyMapping = api.detect([{
  name: "Legacy",
  code: "Option Explicit\r\na = \"C:\\Data\\report.xlsx\"\r\n"
}], [{label: "ドライブから始まる場所", pattern: "^[A-Za-z]:[\\\\/]",
  selectedByDefault: true}]);
equal(legacyMapping.rows[0].groupKey, "C:\\Data\\report.xlsx",
  "A rule with no capture group still means the whole literal.");
equal(legacyMapping.rows[0].occurrences[0].prefix, "",
  "With no capture group there is nothing standing before the segment.");

console.log("test-path-map: PASS");
console.log(
  "rules come from the template, first match wins, unmatched literals " +
  "are not candidates, value-only grouping, M01-M03, exact-span rebuild, " +
  "quote escaping, private brands and all-or-nothing E-MAP-02 are fixed");
console.log(
  "a capture group narrows the editable part to the folder inside a " +
  "connection string, groups both places into one row, and rebuilds each " +
  "literal around what was typed");
