// Machine verification for the fixed-path candidate rules.
//
// Luca's instruction: do not adopt a regex by reasoning about it. Run the real
// strings through the real matching semantics (first rule that matches wins,
// RegExp.test against the whole literal) and print a table.
//
//   node verify-path-rules.js            -> checks the CURRENT preset on disk
//   node verify-path-rules.js --proposed -> checks the proposed replacement

'use strict';

const CURRENT = [
  ['ドライブから始まる場所', '^[A-Za-z]:[\\\\/]'],
  ['ネットワーク上の場所', '^\\\\\\\\[^\\\\]'],
  ['URL', '^(?:https?|ftp)://'],
  ['環境変数を含む場所', '%[A-Za-z_][A-Za-z0-9_()]*%'],
  ['既知のフォルダー名', '[\\\\/][UuDdAaPp](?:sers|esktop|ocuments|ppData|rogram Files)'],
  ['連結された場所の一部', '[\\\\/]'],
  ['ファイル名', '\\.[A-Za-z0-9]{1,8}$']
];

// Structural evidence of a location comes FIRST; only then do we drop strings
// that are nothing but a format picture. A path that happens to be all digits
// and separators ("./2025/08/", "/mm/dd/") still carries structure - it starts
// at a root or at a dot-relative prefix - and must survive.
const FORMAT_ONLY = '(?![0-9yYmMdDhHsS#,.:/ -]+$)';
const ROOTED = '[\\\\/][^\\\\/]';        // starts at a separator, then content
const DOT_REL = '\\.{1,2}[\\\\/]';       // ./x  ../x  .\x  ..\x
const HAS_CONTENT = '(?=.*[^\\\\/])';    // a bare separator names no location
const PROPOSED = CURRENT.slice(0, 5).concat([
  ['連結された場所の一部',
    '^' + HAS_CONTENT + '(?:' + ROOTED + '|' + DOT_REL + '|' + FORMAT_ONLY + '.*[\\\\/])'],
  ['ファイル名', '^' + FORMAT_ONLY + '.*\\.[A-Za-z0-9]{1,8}$']
]);

// value, mustBeCandidate, why
const CORPUS = [
  // ---- must KEEP (real locations a user must be offered) ----
  ['C:\\data\\',                                      true,  'ドライブ絶対'],
  ['S:\\eigyo\\shinsei\\',                            true,  'ドライブ絶対(S01実物)'],
  ['D:\\業務\\月次\\',                                 true,  'ドライブ絶対+日本語'],
  ['\\\\fileserver\\share\\',                         true,  'UNC'],
  ['\\\\srv01\\共有\\受付\\',                          true,  'UNC+日本語'],
  ['https://contoso.sharepoint.com/sites/eigyo/',     true,  'URL'],
  ['..\\data\\',                                      true,  '相対パス'],
  ['.\\config\\',                                     true,  '相対パス'],
  ['\\data\\',                                        true,  '連結断片(円記号)'],
  ['\\Reports\\',                                     true,  '連結断片'],
  ['/Shared Documents/',                              true,  'SharePoint断片'],
  ['/sites/eigyo/',                                   true,  'SharePoint断片'],
  ['%APPDATA%\\Contoso\\',                            true,  '環境変数'],
  ['C:\\Users\\taro\\Desktop\\',                      true,  '既知フォルダー'],
  ['data.csv',                                        true,  'ファイル名'],
  ['report.xlsx',                                     true,  'ファイル名'],
  ['集計表.xlsx',                                      true,  'ファイル名+日本語'],
  ['backup2.bak',                                     true,  'ファイル名+数字'],
  ['\\\\?\\C:\\very\\long\\',                         true,  '長パス接頭辞'],
  // Luca #15: real locations made only of digits and separators.
  ['D:/2025/08/02/',                                  true,  '日付フォルダ(ドライブ+スラッシュ)'],
  ['C:/2025-08-02/',                                  true,  '日付フォルダ(ハイフン)'],
  ['./2025/08/',                                      true,  'ドット相対+数字のみ'],
  ['/mm/dd/',                                         true,  'ルート始まり+書式文字のみ'],
  ['../2025/',                                        true,  '親相対+数字のみ'],
  ['\\2024\\',                                        true,  'ルート始まり(円記号)+数字のみ'],
  ['.\\08\\',                                         true,  'ドット相対(円記号)+数字のみ'],

  // ---- must REJECT (format pictures, not locations) ----
  ['yyyy/mm/dd',                                      false, '日付書式(実物: WindowUtils 499)'],
  ['yyyy/mm/dd hh:mm:ss',                             false, '日付書式(実物: WindowUtils 431,509)'],
  ['0.00',                                            false, '数値書式(実物: AppController 105)'],
  ['/',                                               false, '区切り1文字(実物: AppController,SystemInfo)'],
  ['hh:mm:ss',                                        false, '時刻書式'],
  ['yyyy-mm-dd',                                      false, '日付書式(ハイフン)'],
  ['mm/dd/yyyy',                                      false, '日付書式(米国式)'],
  ['#,##0.00',                                        false, '数値書式'],
  ['yy/mm',                                           false, '日付書式(短)'],
  ['2024/05/01',                                      false, '日付リテラル'],
  ['0.0',                                             false, '数値書式'],
  ['\\',                                              false, '区切り1文字(円記号) 実物: S01 ExportSummary'],
  ['\\\\',                                            false, '区切りだけ'],
  ['//',                                              false, '区切りだけ']
];

function classify(rules, value) {
  for (const [label, pattern] of rules) {
    if (new RegExp(pattern).test(value)) return label;
  }
  return null;
}

function run(name, rules) {
  let pass = 0;
  const bad = [];
  for (const [value, mustBeCandidate, why] of CORPUS) {
    const label = classify(rules, value);
    const isCandidate = label !== null;
    if (isCandidate === mustBeCandidate) {
      pass++;
    } else {
      bad.push({ value, why, expected: mustBeCandidate ? 'candidate' : 'REJECT', got: label || '(none)' });
    }
  }
  console.log(`\n=== ${name} ===`);
  console.log(`pass ${pass}/${CORPUS.length}`);
  if (bad.length) {
    console.log('--- mismatches ---');
    for (const b of bad) {
      console.log(`  ${JSON.stringify(b.value).padEnd(42)} expected=${b.expected.padEnd(9)} got=${b.got}   (${b.why})`);
    }
  }
  return bad.length === 0;
}

const okCurrent = run('CURRENT preset rules', CURRENT);
const okProposed = run('PROPOSED preset rules', PROPOSED);

console.log('\nCURRENT clean:', okCurrent, ' PROPOSED clean:', okProposed);
process.exit(okProposed ? 0 : 1);
