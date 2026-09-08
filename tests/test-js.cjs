// Run: node --test tests/test-js.cjs (Node.js 18+; no npm packages).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ROOT = process.env.MACROSTUDIO_ROOT || path.resolve(__dirname, '..');
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
function load() {
  const w = { console, crypto: crypto.webcrypto, setTimeout, clearTimeout,
    document: { addEventListener() {}, querySelector() { return null; } },
    hostBridge: { request() { return Promise.resolve(null); } } };
  w.window = w;
  vm.createContext(w);
  for (const f of ['preset-document', 'response-package', 'prompt-template',
      'diff', 'vba-highlight', 'diff-report', 'diff-view', 'screens', 'state', 'app']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f + '.js'), 'utf8'), w, {filename:f});
  }
  return w;
}
function moduleRecord(name='Main', code='Option Explicit\r\n') {
  return { name, type:'standard', typeLabel:'標準モジュール', ext:'bas',
    code, attributes:`Attribute VB_Name = "${name}"\r\n`, lineCount:1 };
}
function setup(w) {
  const s = w.MacroStudioState;
  s.setBook({name:'監査.xlsm', path:'C:\\books\\監査.xlsm', ext:'.xlsm', totalLines:1}, [moduleRecord()]);
  s.setMode('refactor');
  s.setPurpose('custom.md', 'Custom', ID, []);
  s.setRequestBase('Original request');
  s.setRequestText('Original request');
  s.setOutputRules({title:'出力指示', body:`'@MACROSTUDIO ${ID} COMPLETE 1`});
  s.setSplitOutputRules({title:'分割',body:`'@MACROSTUDIO ${ID} PART 00 OF 02`});
  return s;
}
function pack(r, opts={}) {
  const id=opts.id || ID;
  const lines=[];
  if (opts.summary!==false) lines.push(r.summaryBeginLine(id),opts.summary || '変更しました。',r.summaryEndLine(id));
  if (opts.part) lines.push(r.partLine(id,opts.part[0],opts.part[1]));
  const modules=opts.modules || [{name:'Main',kind:'standard',code:'Option Explicit\r\nSub Test()\r\nEnd Sub'}];
  for (const m of modules) lines.push(r.beginLine(id,m.kind||'standard',m.name),m.code,r.endLine(id,m.kind||'standard',m.name));
  if (opts.verdict) lines.push(r.noChangeLine(id,opts.verdict));
  lines.push(r.completeLine(id,modules.length));
  return lines.join('\n');
}
function plain(x) { return JSON.parse(JSON.stringify(x)); }
for (const lineEnd of ['\n','\r\n','\r']) {
  test(`response accepts ${JSON.stringify(lineEnd)} and whole markdown fence`,()=>{
    const r=load().MacroStudioResponse;
    const text='```vba'+lineEnd+pack(r).replace(/\r\n/g,'\n').replace(/\n/g,lineEnd)+lineEnd+'```';
    const result=r.parse(text,ID); assert.equal(result.ok,true); assert.equal(result.modules[0].name,'Main');
  });
}
const invalidCases={
  'empty':r=>'',
  'plain VBA without sentinels':r=>'Sub Test()\nEnd Sub',
  'other request':r=>pack(r,{id:OTHER}),
  'missing COMPLETE':r=>pack(r).replace(/.* COMPLETE 1$/,''),
  'wrong count':r=>pack(r).replace('COMPLETE 1','COMPLETE 2'),
  'hex count':r=>pack(r).replace('COMPLETE 1','COMPLETE 0x1'),
  'exponential count':r=>pack(r).replace('COMPLETE 1','COMPLETE 1e0'),
  'extra COMPLETE tokens':r=>pack(r).replace('COMPLETE 1','COMPLETE 1 extra'),
  'duplicate COMPLETE':r=>pack(r)+'\n'+r.completeLine(ID,1),
  'COMPLETE before modules':r=>r.completeLine(ID,1)+'\n'+pack(r).replace(/.* COMPLETE 1$/,''),
  'summary after COMPLETE':r=>pack(r)+'\n'+r.summaryBeginLine(ID)+'\nlate\n'+r.summaryEndLine(ID),
  'two summaries':r=>r.summaryBeginLine(ID)+'\nx\n'+r.summaryEndLine(ID)+'\n'+pack(r),
  'unknown kind':r=>pack(r,{modules:[{name:'M',kind:'unknown',code:'Option Explicit'}]}),
  'invalid module name':r=>pack(r,{modules:[{name:'../Other',code:'Option Explicit'}]}),
  'empty module':r=>pack(r,{modules:[{name:'Main',code:' \t'}]}),
  'case-insensitive duplicate':r=>pack(r,{modules:[{name:'Main',code:'a'},{name:'MAIN',code:'b'}]}),
  'mismatched END':r=>pack(r).replace('END standard Main','END standard Other'),
  'unknown directive':r=>pack(r).replace('SUMMARY BEGIN','UNRECOGNIZED'),
  'NOCHANGE with modules':r=>pack(r,{verdict:'UNNECESSARY'}),
  'NOCHANGE without reason':r=>pack(r,{verdict:'UNNECESSARY',modules:[],summary:false}),
  'NOCHANGE unknown verdict':r=>pack(r,{verdict:'MAYBE',modules:[]}),
  'zero modules without verdict':r=>pack(r,{modules:[]}),
  'NOCHANGE inside module':r=>pack(r).replace('Option Explicit',r.noChangeLine(ID,'UNNECESSARY')),
  'PART with invalid index':r=>pack(r,{part:[2,2]}),
  'PART zero total':r=>pack(r,{part:[0,0]}),
  'PART malformed OF':r=>pack(r,{part:[0,2]}).replace(' OF ',' / ')
};
for(const [name,generate] of Object.entries(invalidCases)) test(`response rejects ${name}`,()=>{
  const r=load().MacroStudioResponse;assert.equal(r.parse(generate(r),ID).ok,false);
});
for(const verdict of ['UNNECESSARY','IMPOSSIBLE']) test(`explicit no-change ${verdict}`,()=>{
  const r=load().MacroStudioResponse;const x=r.parse(pack(r,{verdict,modules:[]}),ID);
  assert.equal(x.ok,true);assert.equal(x.noChange,verdict);
});
test('marker text inside a VBA string remains source',()=>{
 const r=load().MacroStudioResponse,code=`Debug.Print "${r.completeLine(ID,99)}"`;
 assert.equal(r.parse(pack(r,{modules:[{name:'Main',code}]}),ID).modules[0].code,code);
});
test('request IDs are unique and canonical',()=>{
 const r=load().MacroStudioResponse;const ids=Array.from({length:100},()=>r.createRequestId());
 assert.equal(new Set(ids).size,100);ids.forEach(id=>assert.equal(r.isRequestId(id),true));
});
test('constructor is a new module, never Object.prototype.constructor',()=>{
 const r=load().MacroStudioResponse;const x=r.describe(r.parse(pack(r,{modules:[{name:'constructor',code:'Option Explicit'}]}),ID),[]);
 assert.equal(x.added,1);assert.equal(x.modules[0].name,'constructor');assert.equal(x.modules[0].isNew,true);
});
test('existing names and module kinds come from workbook',()=>{
 const r=load().MacroStudioResponse;const x=r.describe(r.parse(pack(r,{modules:[{name:'main',kind:'class',code:'Option Explicit'}]}),ID),[moduleRecord()]);
 assert.equal(x.modules[0].name,'Main');assert.equal(x.modules[0].kind,'standard');assert.equal(x.kindWarnings.length,1);
});
test('split replies merge out of order; duplicates and conflicts are distinguished',()=>{
 const r=load().MacroStudioResponse;
 const p=(i,name,code='Option Explicit')=>r.parse(pack(r,{part:[i,2],modules:[{name,code}]}),ID);
 let x=r.addPart(null,p(1,'B'));assert.equal(x.complete,false);assert.deepEqual(plain(x.missing),[0]);
 let same=r.addPart(x.collection,p(1,'B'));assert.equal(same.added,false);
 assert.equal(r.addPart(x.collection,p(1,'B','new text')).ok,false);
 assert.equal(r.addPart(x.collection,p(0,'B')).ok,false);
 assert.equal(r.addPart(x.collection,r.parse(pack(r,{part:[0,3]}),ID)).ok,false);
 x=r.addPart(x.collection,p(0,'A'));assert.equal(x.complete,true);
 assert.deepEqual(plain(r.mergeParts(x.collection).modules.map(m=>m.name)),['A','B']);
});
test('incomplete parts cannot be merged',()=>{
 const r=load().MacroStudioResponse;assert.equal(r.mergeParts(r.createPartCollection()).ok,false);
});
test('editing an issued request rotates ID and clears old response, parts and artifacts',()=>{
 const w=load(),s=setup(w);s.setRequestPrompt('issued');s.setRunFolder('old');s.setHandoffProgress(true,true);
 s.importPackage([{name:'Main',code:'New code',changedLineCount:1}]);s.setBuildResult({success:true});
 s.setRequestText('Revised request');const st=s.getState();
 assert.notEqual(st.requestId,ID);assert.equal(w.MacroStudioScreens.isIntakeCurrent(st),false);
 assert.equal(s.hasImportedModules(),false);assert.equal(st.requestPrompt,null);assert.equal(st.runFolder,null);assert.equal(st.buildResult,null);
 assert.equal(st.promptCopied,false);assert.ok(st.outputRules.body.includes(st.requestId));assert.ok(st.splitOutputRules.body.includes(st.requestId));
 assert.equal(w.MacroStudioResponse.parse(pack(w.MacroStudioResponse),st.requestId).ok,false);
});
test('repeated input events for unchanged request preserve its response',()=>{
 const w=load(),s=setup(w);s.importPackage([{name:'Main',code:'new',changedLineCount:1}]);
 s.setRequestText('Original request');assert.equal(s.hasImportedModules(),true);assert.equal(s.getState().requestId,ID);
});
test('switching output format of an issued request invalidates stale replies',()=>{
 const w=load(),s=setup(w);s.setRequestPrompt('issued');s.setSplitOutput(true);
 assert.notEqual(s.getState().requestId,ID);assert.equal(s.getState().requestPrompt,null);assert.equal(s.getState().splitOutput,true);
});
test('changing purpose clears previous handoff data',()=>{
 const w=load(),s=setup(w);s.setRequestPrompt('issued');s.setRunFolder('old');s.setHandoffProgress(true,true);
 s.setPurpose('next','next',OTHER,[]);assert.equal(s.getState().runFolder,null);assert.equal(s.getState().promptCopied,false);
});
test('switching workbook clears old question index and request base',()=>{
 const w=load(),s=setup(w);s.getState().questionIndex=2;s.setBook({name:'B.xlsm',ext:'.xlsm'},[moduleRecord('B')]);
 assert.equal(s.getState().questionIndex,0);assert.equal(s.getState().requestBase,'');
});
test('replacement packages remove modules added by an earlier answer',()=>{
 const w=load(),s=setup(w);s.importPackage([{name:'Added',code:'new',lineCount:1}]);s.importPackage([{name:'Main',code:'changed'}]);
 assert.equal(s.getState().modules.length,1);assert.equal(s.getState().modules[0].name,'Main');
});
test('invalid answer does not destroy a valid imported answer',()=>{
 const w=load(),s=setup(w);assert.equal(w.MacroStudioApp.applyResponsePackage(pack(w.MacroStudioResponse)),true);
 const code=s.findModule('Main').pastedCode;assert.equal(w.MacroStudioApp.applyResponsePackage('bad'),false);assert.equal(s.findModule('Main').pastedCode,code);
});
test('a new split collection cannot leave old complete reply buildable',()=>{
 const w=load(),s=setup(w),r=w.MacroStudioResponse;s.setSplitOutput(true);
 const one=pack(r,{part:[0,1]});assert.equal(w.MacroStudioApp.applyResponsePackage(one),true);assert.equal(s.hasImportedModules(),true);
 const part=pack(r,{part:[0,2],modules:[{name:'Main',code:'Different reply'}]});
 assert.equal(w.MacroStudioApp.applyResponsePackage(part),true);assert.equal(s.hasImportedModules(),false);
 assert.equal(w.MacroStudioScreens.isIntakeCurrent(s.getState()),false);assert.equal(s.getState().intakeParts.parts.length,1);
});
test('NOCHANGE replaces and removes a previous modification',()=>{
 const w=load(),s=setup(w),r=w.MacroStudioResponse;w.MacroStudioApp.applyResponsePackage(pack(r));
 assert.equal(w.MacroStudioApp.applyResponsePackage(pack(r,{verdict:'UNNECESSARY',modules:[]})),true);
 assert.equal(s.hasImportedModules(),false);assert.equal(s.getState().noChangeResult.verdict,'UNNECESSARY');
});
test('format-only response preserves original trailing whitespace and blank lines',()=>{
 const w=load(),s=setup(w);s.findModule('Main').code='Option Explicit  \r\n\r\n';
 assert.equal(w.MacroStudioApp.applyResponsePackage(pack(w.MacroStudioResponse,{modules:[{name:'Main',code:'Option Explicit'}]})),true);
 assert.equal(s.findModule('Main').status,'unchanged');assert.equal(s.findModule('Main').pastedCode,'Option Explicit  \r\n\r\n');
});
test('new nonstandard modules are refused without altering state',()=>{
 const w=load(),s=setup(w);assert.equal(w.MacroStudioApp.applyResponsePackage(pack(w.MacroStudioResponse,{modules:[{name:'NewClass',kind:'class',code:'Option Explicit'}]})),false);
 assert.equal(s.getState().modules.length,1);
});
test('source exports never include modules invented by a previous answer',()=>{
 const w=load(),s=setup(w);s.importPackage([{name:'Added',code:'New code'}]);assert.equal(s.getBookModules().length,1);
});
const invalidNames=['NUL.xlsm','CON.backup.xlsm','AUX.xlsm','PRN.xlsm','COM1.xlsm','LPT9.xlsm','COM¹.xlsm','LPT².xlsm','x\x01.xlsm','x\x00.xlsm','a/b.xlsm','a\\b.xlsm','../a.xlsm','a.xlsm.','a.txt','', 'a'.repeat(121)+'.xlsm'];
for(const name of invalidNames) test(`output filename rejected: ${JSON.stringify(name)}`,()=>{
 assert.equal(load().MacroStudioScreens.isOutputNameValid({book:{ext:'.xlsm'},outputName:name}),false);
});
for(const name of ['Report.xlsm','日本語-改修版.xlsm','report..xlsm','CONSOLE.xlsm','V1.2.XLSM','hello world.xlsm']) test(`valid filename: ${name}`,()=>{
 assert.equal(load().MacroStudioScreens.isOutputNameValid({book:{ext:'.xlsm'},outputName:name}),true);
});
for(const ext of ['.xlsm','.xlam','.xlsb','.xls']) test(`long generated filenames fit 120 characters ${ext}`,()=>{
 const w=load(),book={name:'あ'.repeat(110)+ext,ext};
 const output=w.MacroStudioState.getDefaultOutputName(book,'20260908');const diff=w.MacroStudioState.getDiffReportName(book,'20260908');
 assert.ok(output.length<=120);assert.ok(diff.length<=120);assert.ok(output.endsWith('-Modified-20260908'+ext));assert.ok(diff.endsWith('-Diff-Report-20260908.html'));
});
test('all six supplied presets parse successfully',()=>{
 const p=load().MacroStudioPreset,files=fs.readdirSync(path.join(ROOT,'presets')).filter(f=>f.endsWith('.md'));
 assert.equal(files.length,6);for(const file of files){const x=p.parse(fs.readFileSync(path.join(ROOT,'presets',file),'utf8'));assert.equal(x.valid,true,file+': '+x.message);}
});
test('preset parser rejects missing and duplicate required headings',()=>{
 const p=load().MacroStudioPreset;
 assert.equal(p.parse('# Test\n## 改修指示\ntext').valid,false);
 assert.equal(p.parse('# Test\n## 改修指示\ntext\n## 改修指示\nagain\n## 出力指示\ntext').valid,false);
});
test('template expansion is single-pass and literal VBA-like placeholders survive',()=>{
 const w=load(),s=setup(w);const text=w.MacroStudioPrompt.buildRequestPrompt({template:'{{REQUEST_TEXT}}\n{{OUTPUT_RULES}}',requestText:'Use {{BOOK_NAME}} literally',outputRules:{body:'Return $& exactly'},book:s.getState().book,modules:s.getBookModules(),codeFileName:'source-code.md'});
 assert.ok(text.includes('{{BOOK_NAME}}'));assert.ok(text.includes('$&'));
});
test('template rejects unknown/malformed placeholders',()=>{
 const w=load(),s=setup(w);for(const template of ['{{REQUEST_TEXT}} {{TYPO}}','{{REQUEST_TEXT}} {{','no request'])assert.throws(()=>w.MacroStudioPrompt.buildRequestPrompt({template,requestText:'x',book:s.getState().book,modules:s.getBookModules(),codeFileName:'source-code.md'}));
});
test('shared request template does not order code modification for consultation',()=>{
 const t=fs.readFileSync(path.join(ROOT,'templates/request-template.txt'),'utf8');assert.equal(t.includes('従って改修してください'),false);assert.equal(t.includes('省略はありません'),false);
});
test('uncertain extraction warning is present in request and source file',()=>{
 const w=load(),s=setup(w);s.getState().book.read={level:'sourceDoubt',headline:'読み取り不完全',detail:'ModuleX が読めません'};
 const options={book:s.getState().book,modules:s.getBookModules(),generatedAt:'2026-09-08',requestText:'Check',codeFileName:'source-code.md',template:fs.readFileSync(path.join(ROOT,'templates/request-template.txt'),'utf8')};
 assert.match(w.MacroStudioPrompt.buildRequestPrompt(options),/欠落/);assert.match(w.MacroStudioPrompt.buildCodeFile(options),/ModuleX/);
});
test('diff existing self-tests',()=>assert.equal(load().MacroStudioDiff.runSelfTest(),true));
for(const mode of ['insert','delete']) test(`diff preserves identical tail after 150-line ${mode}`,()=>{
 const d=load().MacroStudioDiff,left=Array.from({length:200},(_,i)=>'old'+i),right=Array.from({length:150},(_,i)=>'new'+i).concat(left);
 const rows=d.getGreedyDiff(...(mode==='insert'?[left,right]:[right,left]));
 assert.equal(d.countChangedLines(rows),150);assert.equal(rows.filter(r=>r.type==='equal').length,200);
});
test('diff reconstructs both inputs for 500 deterministic randomized cases',()=>{
 const d=load().MacroStudioDiff;let seed=20260908;
 const next=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let trial=0;trial<500;trial++){
  const a=Array.from({length:Math.floor(next()*90)},()=>String(Math.floor(next()*15)));
  const b=Array.from({length:Math.floor(next()*90)},()=>String(Math.floor(next()*15)));
  const rows=d.getGreedyDiff(a,b);
  assert.deepEqual(plain(rows.filter(r=>r.lineA>=0).map(r=>r.textA)),a);
  assert.deepEqual(plain(rows.filter(r=>r.lineB>=0).map(r=>r.textB)),b);
 }
});
test('report JSON cannot close its script element',()=>{
 const r=load().MacroStudioDiffReport,x=r.escapeJson({code:'</script><script>globalThis.pwned=1</script>\u2028'});
 assert.equal(x.includes('<'),false);assert.equal(JSON.parse(x).code.startsWith('</script>'),true);
});
test('HTML escaping retains code as text',()=>{
 const r=load().MacroStudioDiffReport;assert.equal(r.escapeHtml('<script>"\'&'), '&lt;script&gt;&quot;&#39;&amp;');
});

test('manual paste of normalization-equivalent original remains unchanged',()=>{
 const w=load(),s=setup(w);s.importPackage([{name:'Main',code:'Option Explicit\r\nSub Test()\r\nEnd Sub',changedLineCount:2}]);
 assert.equal(w.MacroStudioApp.acceptPastedText('Option Explicit','Main'),true);
 assert.equal(s.findModule('Main').status,'unchanged');assert.equal(s.findModule('Main').pastedCode,s.findModule('Main').code);
});

for (const mode of ['refactor', 'diagnose']) test('source-doubt workbook gating: '+mode,()=>{
 const w=load(),s=setup(w);s.setMode(mode);s.getState().book.read={level:'sourceDoubt'};s.getState().screen=1;
 assert.equal(s.canGoNext(),mode==='diagnose');
});
test('explicit source doubt is not masked by a missing general warning',()=>{
 const a=load().MacroStudioApp;const x=a.describeReadResult({warning:false,read:{level:'sourceDoubt',partialModules:['Main']}});
 assert.equal(x.level,'sourceDoubt');assert.ok(x.detail.includes('相談用'));assert.ok(x.detail.includes('Main'));
});
