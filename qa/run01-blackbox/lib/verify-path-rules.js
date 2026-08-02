// Machine verification for the fixed-path candidate rules.
//
// Luca's instruction: do not adopt a regex by reasoning about it. Run the real
// strings through the real matching semantics and print a table.
//
//   node verify-path-rules.js
//
// It reads the SHIPPED preset through the product's own parser, so there is no
// second copy of the rules here to drift out of step. Three things are checked:
//
//   candidate / not      does any rule claim this literal at all
//   the editable part    what a rule with a capture group points at, which is
//                        what the reader actually retypes (PROD-16)
//   the context          the same literal in and out of CreateObject(, which
//                        is the only thing separating a ProgID from a real
//                        file name (PROD-11)

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..', '..');
const windowObject = {};
const context = vm.createContext({ window: windowObject });
windowObject.window = windowObject;
vm.runInContext(
  fs.readFileSync(path.join(REPO, 'assets', 'js', 'preset-document.js'), 'utf8'),
  context,
  { filename: 'preset-document.js' });

const presetPath = path.join(
  REPO, 'presets', '02_改修', '02_固定パスを新環境へ置き換える.md');
const parsed = windowObject.MacroStudioPreset.parse(
  fs.readFileSync(presetPath, 'utf8'), 'repair');
if (!parsed.valid || !parsed.replaceRules) {
  console.error('the shipped preset did not parse: ' + parsed.message);
  process.exit(1);
}
const RULES = parsed.replaceRules;

// The same semantics assets/js/path-map.js uses: first rule that matches and
// is not excluded by its context wins; a capture group names the editable part.
function classify(value, before) {
  for (const rule of RULES) {
    if (rule.contextExclude &&
        new RegExp(rule.contextExclude).test(before || '')) {
      continue;
    }
    const match = new RegExp(rule.pattern, 'd').exec(value);
    if (!match) {
      continue;
    }
    let start = 0;
    let end = value.length;
    if (match.length > 1 && match[1] !== undefined && match[1] !== null) {
      if (match.indices && match.indices[1]) {
        start = match.indices[1][0];
        end = match.indices[1][1];
      } else {
        const offset = match[0].indexOf(match[1]);
        start = match.index + offset;
        end = start + match[1].length;
      }
    }
    if (end <= start) {
      continue;
    }
    return { label: rule.label, segment: value.slice(start, end) };
  }
  return null;
}

// value, before, mustBeCandidate, why
const CORPUS = [
  // ---- must KEEP (real locations a user must be offered) ----
  ['C:\\data\\', '', true, 'ドライブ絶対'],
  ['S:\\eigyo\\shinsei\\', '', true, 'ドライブ絶対(S01実物)'],
  ['D:\\業務\\月次\\', '', true, 'ドライブ絶対+日本語'],
  ['\\\\fileserver\\share\\', '', true, 'UNC'],
  ['\\\\srv01\\共有\\受付\\', '', true, 'UNC+日本語'],
  ['https://contoso.sharepoint.com/sites/eigyo/', '', true, 'URL'],
  ['..\\data\\', '', true, '相対パス'],
  ['.\\config\\', '', true, '相対パス'],
  ['\\data\\', '', true, '連結断片(円記号)'],
  ['\\Reports\\', '', true, '連結断片'],
  ['/Shared Documents/', '', true, 'SharePoint断片'],
  ['/sites/eigyo/', '', true, 'SharePoint断片'],
  ['%APPDATA%\\Contoso\\', '', true, '環境変数'],
  ['C:\\Users\\taro\\Desktop\\', '', true, '既知フォルダー'],
  ['data.csv', '', true, 'ファイル名'],
  ['report.xlsx', '', true, 'ファイル名'],
  ['集計表.xlsx', '', true, 'ファイル名+日本語'],
  ['backup2.bak', '', true, 'ファイル名+数字'],
  ['\\\\?\\C:\\very\\long\\', '', true, '長パス接頭辞'],
  // Luca #15: real locations made only of digits and separators.
  ['D:/2025/08/02/', '', true, '日付フォルダ(ドライブ+スラッシュ)'],
  ['C:/2025-08-02/', '', true, '日付フォルダ(ハイフン)'],
  ['./2025/08/', '', true, 'ドット相対+数字のみ'],
  ['/mm/dd/', '', true, 'ルート始まり+書式文字のみ'],
  ['../2025/', '', true, '親相対+数字のみ'],
  ['\\2024\\', '', true, 'ルート始まり(円記号)+数字のみ'],

  // ---- PROD-11: must KEEP - the same shapes, outside the calls ----
  // Report.Backup is character-for-character the shape of a ProgID. It is
  // kept because of where it is, which is the whole point of the context
  // column: a rule tightened by shape alone would have eaten it.
  ['Report.Backup', '    name = ', true, 'ProgID と同型の本物のファイル名'],
  ['Word.docx', '    f = ', true, 'ProgID と同型(Word.)のファイル名'],
  ['notepad.exe', '    logName = ', true, '実行ファイル名だが Shell の外'],
  ['C:\\tools\\*.xlsx', '', true, '本物のパスの中のワイルドカード'],
  ['S:\\eigyo\\shinsei\\', '    app.Explore ', true,
    'F04 実物・Explore の引数は本物のパス'],
  ['\\\\kyu-fileserver\\eigyo\\teishutsu\\', '    SHARE_ROOT = ', true,
    'H01 実物・UNC'],

  // ---- PROD-11: must REJECT - ProgID, command lines, bare patterns ----
  ['WScript.Shell', '    Set sh = CreateObject(', false,
    'F04 実物・ProgID'],
  ['Shell.Application', '    Set app = CreateObject(', false,
    'F04 実物・ProgID'],
  ['Scripting.FileSystemObject', '    Set fso = CreateObject(', false,
    'ProgID'],
  ['ADODB.Connection', '    Set cn = CreateObject(', false, 'ProgID'],
  ['Forms.CommandButton.1',
    '    ThisWorkbook.Worksheets(1).OLEObjects.Add ClassType:=', false,
    'F05 実物・ProgID'],
  ['notepad.exe', '    Shell ', false, 'F04 実物・実行ファイル名'],
  ['cmd.exe /c echo hello', '    sh.Run ', false, 'F04 実物・コマンド行'],
  ['.csv', '', false, '裸の拡張子'],
  ['.xlsx', '', false, '裸の拡張子'],
  ['*.xlsx', '', false, 'H01 実物・純粋なワイルドカード'],
  ['*.*', '', false, '純粋なワイルドカード'],

  // ---- must REJECT (format pictures, not locations) ----
  ['yyyy/mm/dd', '', false, '日付書式(実物: WindowUtils 499)'],
  ['yyyy/mm/dd hh:mm:ss', '', false, '日付書式(実物: WindowUtils 431,509)'],
  ['0.00', '', false, '数値書式(実物: AppController 105)'],
  ['/', '', false, '区切り1文字(実物: AppController,SystemInfo)'],
  ['hh:mm:ss', '', false, '時刻書式'],
  ['yyyy-mm-dd', '', false, '日付書式(ハイフン)'],
  ['mm/dd/yyyy', '', false, '日付書式(米国式)'],
  ['#,##0.00', '', false, '数値書式'],
  ['yy/mm', '', false, '日付書式(短)'],
  ['2024/05/01', '', false, '日付リテラル'],
  ['0.0', '', false, '数値書式'],
  ['\\', '', false, '区切り1文字(円記号) 実物: S01 ExportSummary'],
  ['\\\\', '', false, '区切りだけ'],
  ['//', '', false, '区切りだけ']
];

// PROD-16: what the reader is asked to retype. value, before, expected
// editable part, expected label.
const F06_ACCDB =
  'Provider=Microsoft.ACE.OLEDB.12.0;Data Source=S:\\eigyo\\shinsei\\' +
  'master.accdb;Persist Security Info=False;';
const F06_XLSX =
  'Provider=Microsoft.ACE.OLEDB.12.0;Data Source=S:\\eigyo\\shinsei\\' +
  'rate.xlsx;Extended Properties="Excel 12.0 Xml;HDR=YES";';

const SEGMENTS = [
  [F06_ACCDB, '    Private Const CONN As String = ',
    'S:\\eigyo\\shinsei\\', '接続文字列の中の場所',
    'F06 実物・Data Source のパス部分だけが編集対象'],
  [F06_XLSX, '    ExcelSource = ',
    'S:\\eigyo\\shinsei\\', '接続文字列の中の場所',
    'F06 実物・mustPreserve(HDR=YES) を打ち直させない'],
  ['C:\\data\\', '', 'C:\\data\\', 'ドライブから始まる場所',
    '捕獲グループの無い規則はリテラル全体のまま(後方互換)'],
  ['data.csv', '', 'data.csv', 'ファイル名',
    '捕獲グループの無い規則はリテラル全体のまま(後方互換)'],
  ['\\data\\', '', '\\data\\', '連結された場所の一部',
    '区切りで始まる断片は「連結された場所の一部」のまま'],
  // The naming complaint in PROD-16: this string is not concatenated.
  ['cmd.exe /c echo hello', '    logLine = ', 'cmd.exe /c echo hello',
    '場所を含む文字列',
    '連結されていない文字列に「連結された…」と出さない']
];

let bad = [];
let pass = 0;

for (const [value, before, mustBeCandidate, why] of CORPUS) {
  const hit = classify(value, before);
  if ((hit !== null) === mustBeCandidate) {
    pass++;
  } else {
    bad.push({
      value, before, why,
      expected: mustBeCandidate ? 'candidate' : 'REJECT',
      got: hit ? hit.label : '(none)'
    });
  }
}

let segmentPass = 0;
for (const [value, before, segment, label, why] of SEGMENTS) {
  const hit = classify(value, before);
  if (hit && hit.segment === segment && hit.label === label) {
    segmentPass++;
  } else {
    bad.push({
      value, before, why,
      expected: label + ' -> ' + JSON.stringify(segment),
      got: hit
        ? hit.label + ' -> ' + JSON.stringify(hit.segment)
        : '(none)'
    });
  }
}

console.log('=== shipped preset rules ===');
console.log('rules read: ' + RULES.length);
console.log('candidate / reject : ' + pass + '/' + CORPUS.length);
console.log('editable part      : ' + segmentPass + '/' + SEGMENTS.length);
if (bad.length) {
  console.log('--- mismatches ---');
  for (const b of bad) {
    console.log('  ' + JSON.stringify(b.value).padEnd(44) +
      ' before=' + JSON.stringify(b.before).padEnd(26) +
      '\n      expected=' + b.expected + '  got=' + b.got + '   (' + b.why + ')');
  }
}
console.log('\nclean:', bad.length === 0);
process.exit(bad.length === 0 ? 0 : 1);
