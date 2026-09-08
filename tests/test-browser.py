"""Browser integration tests. The Windows host is deliberately mocked.
Requires Python 3.10+, playwright and Chromium. Never executes Excel/VBA.
Run: python tests/test-browser.py; set CHROMIUM_EXECUTABLE as needed.
"""
import json
import os
from pathlib import Path
import unittest
import re
from playwright.sync_api import sync_playwright

ROOT = Path(os.environ.get('MACROSTUDIO_ROOT', Path(__file__).resolve().parent.parent))
PRESETS = [{'file': p.name, 'content': p.read_text(encoding='utf-8-sig')} for p in sorted((ROOT/'presets').glob('*.md'))]
TEMPLATE = (ROOT/'templates/request-template.txt').read_text(encoding='utf-8-sig')
ASSETS = {str(p.relative_to(ROOT/'assets')).replace('\\','/'):p.read_text(encoding='utf-8-sig') for folder in ['css','js'] for p in (ROOT/'assets'/folder).glob('*') if p.is_file()}
INDEX = (ROOT/'assets/index.html').read_text(encoding='utf-8-sig')
SCRIPTS = re.findall(r'<script src="([^"]+)"',INDEX)
INDEX = re.sub(r'<script\b[^>]*>.*?</script>', '', INDEX, flags=re.S)
INDEX = re.sub(r'<link rel="stylesheet" href="([^"]+)">', lambda m:'<style>'+ASSETS[m[1]]+'</style>', INDEX)
SOURCE = 'Option Explicit\r\n\r\nPublic Sub Test()\r\n    MsgBox "before"\r\nEnd Sub\r\n'
MOCK = r'''
(() => {
 const presets = __PRESETS__, template = __TEMPLATE__, code = __SOURCE__, assets = __ASSETS__;
 window.XMLHttpRequest = class { open(method,path){this.path=path;} send(){setTimeout(()=>{this.status=Object.hasOwn(assets,this.path)?200:404;this.responseText=assets[this.path]||'';this.onload();},10);} }; 
 const handlers = [], host = window.__host = {messages:[], clipboard:'', files:[], builds:[], delays:{}, errors:{}, run:0};
 host.emit = data => handlers.forEach(fn => fn({data}));
 const dispatch = m => {
   host.messages.push(m);
   setTimeout(() => {
    if(host.errors[m.action]) { host.emit({id:m.id,status:'error',code:host.errors[m.action],message:'Simulated host error'}); return; }
    let data = {};
    switch(m.action) {
     case 'getAppInfo': data = {version:'test',presets,buildFileLabel:'改修版'}; break;
     case 'pickBook': data = {path:'C:\\books\\監査.xlsm'}; break;
     case 'attachBook': data = {book:{name:'監査.xlsm',path:m.params.path,ext:'.xlsm',totalLines:6}, modules:[{name:'Main',type:'standard',typeLabel:'標準モジュール',ext:'bas',code,attributes:'Attribute VB_Name = "Main"\r\n',lineCount:6}], read:host.read || {level:'clean'},warning:!!host.read}; break;
     case 'readPreset': data = presets.find(p => p.file === m.params.file); break;
     case 'readRequestTemplate': data = {content:template}; break;
     case 'writeRequestFiles': host.run++; host.files.push(m.params); data={folderPath:'C:\\runs\\'+host.run,requestPath:'C:\\runs\\'+host.run+'\\request.md',codePath:'C:\\runs\\'+host.run+'\\source-code.md'}; break;
     case 'writeClipboard': host.clipboard = m.params.text; break;
     case 'readClipboard': data={text:host.clipboard}; break;
     case 'buildBook': host.builds.push(m.params); data={outputPath:'C:\\runs\\'+host.run+'\\'+m.params.outputName,results:m.params.modules.map(x=>({name:x.name,result:'written',message:''})),diffPath:'C:\\runs\\diff.html',resultPath:'C:\\runs\\result.md'}; break;
     case 'resolveDroppedFiles': data={paths:[]}; break;
     case 'revealPath': case 'writeLog': break;
     default: throw new Error('Unexpected mocked action: '+m.action);
    }
    host.emit({id:m.id,status:'success',data});
   }, host.delays[m.action] || 0);
 };
 window.chrome = window.chrome || {};
 window.chrome.webview = {addEventListener(type,fn){if(type==='message') handlers.push(fn);},postMessage:dispatch,postMessageWithAdditionalObjects:dispatch};
})();
'''.replace('__PRESETS__', json.dumps(PRESETS, ensure_ascii=False)).replace('__TEMPLATE__',json.dumps(TEMPLATE,ensure_ascii=False)).replace('__SOURCE__',json.dumps(SOURCE,ensure_ascii=False)).replace('__ASSETS__',json.dumps(ASSETS,ensure_ascii=False))

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        exe = os.environ.get('CHROMIUM_EXECUTABLE')
        if not exe and Path('/usr/bin/chromium').exists(): exe='/usr/bin/chromium'
        cls.browser = cls.pw.chromium.launch(headless=True,executable_path=exe)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()
    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':1280,'height':800})
        self.page = self.context.new_page(); self.errors=[]
        self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        self.page.set_default_timeout(5000)
        self.page.set_content(INDEX)
        self.page.evaluate(MOCK)
        for source in SCRIPTS: self.page.evaluate(ASSETS[source])
        self.page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        self.page.wait_for_function('MacroStudioState.getState().appInfo !== null')
    def tearDown(self):
        self.context.close(); self.assertEqual(self.errors,[], 'Uncaught browser errors')
    def state(self): return self.page.evaluate('MacroStudioState.getState()')
    def screen(self,n): self.page.wait_for_function('(n) => MacroStudioState.getState().screen === n && !MacroStudioState.getState().busyAction',arg=n)
    def next(self,n):
        self.page.locator('[data-action="go-next"]').click(); self.screen(n)
    def to_request(self,mode='refactor',simple=False):
        if simple:
            self.page.locator('[data-action="start-simple"]').click(); self.screen(1)
        else:
            self.page.locator(f'[data-action="select-mode"][data-mode="{mode}"]').click(); self.next(1)
        self.page.evaluate("MacroStudioApp.attachPath('C:\\\\books\\\\監査.xlsm')")
        self.page.wait_for_function('!!MacroStudioState.getState().book && !MacroStudioState.getState().busyAction')
        if simple:
            self.next(5); return
        self.next(2); self.next(3)
        file = next(p['file'] for p in PRESETS if p['file'].startswith('03_' if mode=='refactor' else '06_'))
        self.page.evaluate('(file)=>MacroStudioApp.selectPurpose(file)',file)
        target = 4 if self.state()['questions'] else 5
        self.next(target)
        if target == 4:
            self.page.evaluate("MacroStudioApp.answerQuestion(0,'監査用の回答')")
            self.next(5)
    def issue(self,split=False):
        self.page.evaluate("MacroStudioState.setRequestText('MsgBox の表示内容だけを変更してください。')")
        if split: self.page.evaluate('MacroStudioApp.setSplitOutput(true)')
        self.next(6)
        self.assertEqual(len(self.page.evaluate('__host.files')),1)
        self.page.evaluate('MacroStudioApp.copyRequestPrompt()')
        self.page.evaluate('MacroStudioApp.openRunFolder()')
    def answer(self,nochange=None,part=None,name='Main',code=None):
        return self.page.evaluate('''(x)=>{const r=MacroStudioResponse,id=MacroStudioState.getState().requestId;
         const a=[r.summaryBeginLine(id),'表示だけを変更しました。',r.summaryEndLine(id)];
         if(x.part) a.push(r.partLine(id,x.part[0],x.part[1]));
         if(x.nochange) a.push(r.noChangeLine(id,x.nochange));
         else a.push(r.beginLine(id,'standard',x.name),x.code || 'Option Explicit\\r\\nPublic Sub Test()\\r\\n    MsgBox "after"\\r\\nEnd Sub',r.endLine(id,'standard',x.name));
         a.push(r.completeLine(id,x.nochange?0:1)); return a.join('\\n');
        }''',{'nochange':nochange,'part':part,'name':name,'code':code})
    def import_answer(self,text):
        self.page.evaluate('(text)=>__host.clipboard=text',text)
        self.page.locator('[data-action="import-response"]').click()
        self.page.wait_for_function('!MacroStudioState.getState().busyAction')
    def to_review(self,simple=False):
        self.to_request(simple=simple); self.issue(); self.next(7)
        self.import_answer(self.answer()); self.next(8)
    def test_normal_flow_builds_once_and_report_is_standalone(self):
        self.to_review(); self.next(9)
        self.page.evaluate("__host.delays.buildBook=60")
        self.page.locator('[data-action="go-next"]').click(); self.screen(11)
        builds=self.page.evaluate('__host.builds'); self.assertEqual(len(builds),1)
        self.assertIn('after',builds[0]['modules'][0]['code'])
        html=builds[0]['diffHtml']; self.assertIn('before',html); self.assertIn('after',html)
        report=self.context.new_page(); errors=[]; report.on('pageerror',lambda e:errors.append(str(e)))
        report.set_content(html,wait_until='load'); self.assertEqual(errors,[])
        self.assertGreater(report.locator('button').count(),0)
        self.assertEqual(report.locator('script[src],link[rel="stylesheet"]').count(),0)
        report.close()
    def test_simple_flow_reaches_build_without_name_screen(self):
        self.to_review(simple=True)
        self.page.locator('[data-action="go-next"]').click(); self.screen(11)
        self.assertEqual(len(self.page.evaluate('__host.builds')),1)
    def test_consultation_finishes_without_import_or_build(self):
        self.to_request(mode='diagnose'); self.issue()
        self.assertIn('相談・診断',self.page.evaluate('__host.files[0].request'))
        self.page.locator('[data-action="finish"]').click(); self.screen(0)
        self.assertEqual(self.page.evaluate('__host.builds'),[])
    def test_edited_issued_request_disables_old_answer(self):
        self.to_review(); old=self.state()['requestId']
        self.page.evaluate("MacroStudioState.setRequestText('異なる依頼へ変更')")
        self.assertNotEqual(self.state()['requestId'],old)
        self.assertFalse(self.page.evaluate('MacroStudioState.canGoNext()'))
        self.assertIsNone(self.state()['runFolder'])
    def test_split_answer_rejects_incomplete_and_accepts_out_of_order(self):
        self.to_request(); self.issue(split=True); self.next(7)
        self.import_answer(self.answer(part=[1,2],name='Added'))
        self.assertFalse(self.page.evaluate('MacroStudioState.canGoNext()'))
        self.import_answer(self.answer(part=[0,2])); self.next(8)
        self.assertEqual(len(self.state()['modules']),2)
    def test_new_split_answer_invalidates_previous_complete_answer(self):
        self.to_request(); self.issue(split=True); self.next(7)
        self.import_answer(self.answer(part=[0,1])); self.assertTrue(self.page.evaluate('MacroStudioState.canGoNext()'))
        self.page.locator('[data-action="restart-intake"]').click()
        self.assertFalse(self.page.evaluate('MacroStudioState.canGoNext()'))
        self.import_answer(self.answer(part=[0,2])); self.assertFalse(self.page.evaluate('MacroStudioState.canGoNext()'))
    def test_nochange_shows_reason_and_does_not_build(self):
        self.to_request(); self.issue(); self.next(7)
        self.import_answer(self.answer(nochange='UNNECESSARY'))
        self.assertIn('変更なし',self.page.locator('h1').inner_text())
        self.assertFalse(self.page.evaluate('MacroStudioState.canGoNext()'))
        self.assertEqual(self.page.evaluate('__host.builds'),[])
    def test_invalid_filename_has_visible_feedback_and_blocks_forward(self):
        self.to_review(); self.next(9)
        self.page.locator('input').first.fill('CON.xlsm')
        self.assertFalse(self.page.evaluate('MacroStudioState.canGoNext()'))
        self.assertGreater(self.page.locator('[aria-invalid="true"]').count(),0)
        self.assertIn('ファイル名',self.page.locator('#main-content').inner_text())
    def test_multiple_host_dropped_files_are_not_silently_selected(self):
        self.page.evaluate("__host.emit({event:'bookDropped',data:{path:'C:\\\\A.xlsm',paths:['C:\\\\A.xlsm','C:\\\\B.xlsm']}})")
        self.assertIsNone(self.state()['book']); self.assertIn('1つずつ',self.page.locator('#toast-region').inner_text())
    def test_busy_build_guard_applies_before_report_asset_fetch(self):
        self.to_review(); self.next(9)
        self.page.evaluate('''()=>{MacroStudioState.getState().screen=10;
         const first=MacroStudioApp.buildBook(); const second=MacroStudioApp.buildBook();
         window.__doubleBuild=Promise.all([first,second]); return MacroStudioState.getState().busyAction;}''')
        self.page.evaluate('__doubleBuild'); self.screen(11)
        self.assertEqual(len(self.page.evaluate('__host.builds')),1)
    def test_host_error_recovers_busy_state_and_can_retry(self):
        self.to_request(); self.page.evaluate("__host.errors.writeRequestFiles='E-GEN-02'; MacroStudioState.setRequestText('変更内容')")
        self.page.locator('[data-action="go-next"]').click()
        self.page.wait_for_function('!MacroStudioState.getState().busyAction')
        self.assertEqual(self.state()['screen'],5)
        self.page.evaluate('delete __host.errors.writeRequestFiles')
        self.next(6)
    def test_incomplete_source_blocks_refactor_early_with_guidance(self):
        self.page.locator('[data-action="start-simple"]').click(); self.screen(1)
        self.page.evaluate("__host.read={level:'sourceDoubt',partialModules:['Main']}")
        self.page.evaluate("MacroStudioApp.attachPath('C:\\\\books\\\\監査.xlsm')")
        self.page.wait_for_function('!!MacroStudioState.getState().book && !MacroStudioState.getState().busyAction')
        self.assertFalse(self.page.evaluate('MacroStudioState.canGoNext()'))
        self.assertIn('相談',self.page.locator('#action-context').inner_text())
        self.assertEqual(self.page.evaluate('__host.files'),[])
    def test_small_viewport_footer_visible_and_theme_toggle_works(self):
        self.page.set_viewport_size({'width':760,'height':440})
        self.to_review(); self.next(9)
        field=self.page.locator('input').first
        field.scroll_into_view_if_needed()
        field.click()
        self.page.wait_for_timeout(300)
        f=field.bounding_box()
        footer=self.page.locator('.actionbar').bounding_box()
        self.assertLessEqual(f['y']+f['height'],footer['y']+1)
        b=self.page.locator('[data-action="go-next"]').bounding_box()
        self.assertLessEqual(b['y']+b['height'],441)
        self.assertLessEqual(b['x']+b['width'],761)
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),760)
        self.page.locator('#theme-toggle').click()
        self.assertEqual(self.page.locator('html').get_attribute('data-theme'),'dark')
        self.page.wait_for_timeout(350)
        destination=os.environ.get('BROWSER_SCREENSHOT')
        if destination: self.page.screenshot(path=destination,full_page=True)

if __name__ == '__main__': unittest.main(verbosity=2)
