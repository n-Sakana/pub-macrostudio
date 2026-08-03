// Independent probe of vba-lexer.js: reversibility and classification on
// adversarial VBA lines. Loads the product IIFE with a fake window.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ASSETS = "C:/repos/pub/macrostudio/assets/js";
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
for (const f of ["vba-lexer.js", "path-map.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ASSETS, f), "utf8"), sandbox, { filename: f });
}
const lexer = sandbox.window.MacroStudioVbaLexer;
const pathMap = sandbox.window.MacroStudioPathMap;

const CASES = [
  ['plain string', 'x = "C:\\data\\"'],
  ['apostrophe inside string', 'MsgBox "Don\'t stop " & "C:\\a\\"'],
  ['REM comment', 'REM "C:\\secret\\"'],
  ['REMark identifier', 'REMark = "C:\\real\\"'],
  ['numeric label + Rem', '100 Rem "C:\\secret\\"'],
  ['numeric label + code', '100 x = "C:\\real\\"'],
  ['bracket identifier', '[Don\'t] = "C:\\real\\"'],
  ['bracket with quote', 'x = [a"b] & "C:\\real\\"'],
  ['escaped quote in string', 'x = "say ""C:\\q\\"" ok"'],
  ['unterminated string', 'x = "C:\\open'],
  ['unterminated bracket', 'x = [abc & "C:\\real\\"'],
  ['colon statement then rem', 'x = 1: Rem "C:\\secret\\"'],
  ['line continuation', 'x = "C:\\a\\" & _'],
  ['date literal', 'd = #2026-08-01# : p = "C:\\real\\"'],
  ['surrogate pair', 'x = "\u{1F600}C:\\emoji\\"'],
  ['japanese', 'x = "C:\\データ\\月次.xlsx"'],
  ['tab indent', '\t\tx = "C:\\tab\\"'],
  ['string then comment', 'x = "C:\\a\\" \' comment "C:\\b\\"'],
];

let fails = 0;
console.log("== reversibility & string tokens ==");
for (const [name, line] of CASES) {
  const parsed = lexer.lex(line);
  const rebuilt = parsed.lines.map((l) => l.tokens.map((t) => t.text).join("") + l.eol).join("");
  const ok = rebuilt === line;
  if (!ok) fails++;
  const strings = [];
  parsed.lines.forEach((l) => l.tokens.forEach((t) => {
    if (t.kind === "string") strings.push(lexer.decodeStringToken(t));
  }));
  console.log(`${ok ? "OK " : "FAIL"} ${name.padEnd(28)} strings=${JSON.stringify(strings)}` +
    (parsed.lines[0].unterminatedString ? " [unterminatedString]" : "") +
    (parsed.lines[0].unterminatedBracket ? " [unterminatedBracket]" : ""));
}

console.log("\n== multi-line reversibility (CRLF / LF / no trailing EOL) ==");
const MULTI = [
  "a = \"C:\\1\\\"\r\nb = \"C:\\2\\\"\r\n",
  "a = \"C:\\1\\\"\nb = \"C:\\2\\\"",
  "#If VBA7 Then\r\n  a = \"C:\\1\\\"\r\n#End If\r\n",
  "#If VBA7 Then\r\n  a = \"C:\\1\\\"\r\n",     // unbalanced
  "#End If\r\na = \"C:\\1\\\"\r\n",            // unbalanced (extra end)
];
for (const text of MULTI) {
  const parsed = lexer.lex(text);
  const rebuilt = parsed.lines.map((l) => l.tokens.map((t) => t.text).join("") + l.eol).join("");
  const ok = rebuilt === text;
  if (!ok) fails++;
  console.log(`${ok ? "OK " : "FAIL"} balanced=${parsed.conditionalBalanced} ${JSON.stringify(text).slice(0, 50)}`);
}

console.log("\n== detect() with the shipped template rules ==");
const RULES = [
  { label: "ドライブから始まる場所", pattern: "^[A-Za-z]:[\\\\/]", selectedByDefault: true, picksLocation: true },
  { label: "ネットワーク上の場所", pattern: "^\\\\\\\\[^\\\\]", selectedByDefault: true, picksLocation: true },
  { label: "URL", pattern: "^(?:https?|ftp)://" },
  { label: "環境変数を含む場所", pattern: "%[A-Za-z_][A-Za-z0-9_()]*%", selectedByDefault: true, picksLocation: true },
  { label: "既知のフォルダー名", pattern: "[\\\\/][UuDdAaPp](?:sers|esktop|ocuments|ppData|rogram Files)", picksLocation: true },
  { label: "連結された場所の一部", pattern: "[\\\\/]" },
  { label: "ファイル名", pattern: "\\.[A-Za-z0-9]{1,8}$" },
];
const MODULE_CODE = [
  'Option Explicit',
  'Private Const ROOT As String = "C:\\data\\"',           // driveAbsolute
  'Private Const UNC As String = "\\\\srv\\share\\"',       // unc
  "' comment with \"C:\\comment\\\"",                        // comment: must NOT be a candidate
  'Sub A()',
  '  Dim s As String',
  '  s = "C:\\data\\"',                                     // same value -> same group
  '  s = "report.xlsx"',                                    // file name
  '  s = "Don\'t"',                                         // no separator, no extension -> no rule
  'End Sub',
  'Sub B()',
  '  s = "%APPDATA%\\tool\\"',
  'End Sub',
].join("\r\n");
const result = pathMap.detect([{ name: "M1", code: MODULE_CODE }], RULES);
console.log(JSON.stringify(result.rows.map((r) => ({
  value: r.groupKey, label: r.label, n: r.occurrences.length,
  included: r.included, applied: r.applied,
  procs: r.occurrences.map((o) => o.procedure),
})), null, 1));

console.log("\n== apply(): same value twice on one line, quote escaping ==");
const TWO = 'x = "C:\\a\\" & "C:\\a\\" & "keep"';
const det = pathMap.detect([{ name: "M2", code: TWO }], RULES);
let m = det;
m = pathMap.updateRow(m, "C:\\a\\", { included: true, to: 'D:\\b"quoted"\\' });
const applied = pathMap.apply(m, [{ name: "M2", code: TWO }]);
console.log("ok=" + applied.ok);
if (applied.ok) console.log("code=" + JSON.stringify(applied.modules[0].code));

console.log("\n== apply() against modified code (redo path, SPEC 7.7.1) ==");
const CHANGED = TWO.replace(/C:\\a\\/g, "D:\\b\\");
const applied2 = pathMap.apply(m, [{ name: "M2", code: CHANGED }]);
console.log("ok=" + applied2.ok + " code=" + applied2.code + " -> " + applied2.message);

console.log("\n== arbitrary-string replace API must not exist ==");
console.log(Object.keys(pathMap).join(", "));

process.exit(fails ? 1 : 0);
