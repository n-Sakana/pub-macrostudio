using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace MacroStudio.Tests
{
    // Two operations, one case: replacing the fixed paths and repairing the
    // Win32 calls, chosen together and carried out in one run.
    //
    // This is the route with an order that matters. The machine replacement
    // runs first and the chat is then handed the code it produced, because
    // a chat asked to repair lines the table is about to rewrite answers
    // with the old paths still in them. The workbook as it was read never
    // moves: the diff is original -> final.
    //
    // Driven in the real window against the real host, under the default
    // change scope. As in every smoke here, the chat's answer is a
    // stand-in written by the test - what is being checked is the tool's
    // side of the exchange, not a chat's.
    public static class BothRouteSmoke
    {
        public static string Run(
            string baseDir,
            string bookPath,
            string cacheDir)
        {
            SmokeRunner runner = new SmokeRunner(baseDir, bookPath, cacheDir);
            Thread thread = new Thread(runner.Run);
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();

            if (!thread.Join(180000))
            {
                throw new TimeoutException(
                    "The both-route smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The both-route smoke test failed.",
                    runner.Error);
            }
            return runner.Result;
        }

        private sealed class SmokeRunner
        {
            private readonly string baseDir;
            private readonly string bookPath;
            private readonly string cacheDir;

            private Application application;
            private Window window;
            private WebView2 webView;
            private MessageRouter router;
            private DispatcherTimer timeoutTimer;
            private JavaScriptSerializer serializer;

            public string Result;
            public Exception Error;

            public SmokeRunner(
                string baseDir,
                string bookPath,
                string cacheDir)
            {
                this.baseDir = Path.GetFullPath(baseDir);
                this.bookPath = Path.GetFullPath(bookPath);
                this.cacheDir = Path.GetFullPath(cacheDir);
                serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = int.MaxValue;
                Result = string.Empty;
            }

            public void Run()
            {
                try
                {
                    application = new Application();
                    application.ShutdownMode =
                        ShutdownMode.OnExplicitShutdown;

                    window = new Window();
                    window.Width = 1366;
                    window.Height = 768;
                    window.Left = -10000;
                    window.Top = -10000;
                    window.ShowInTaskbar = false;
                    window.ShowActivated = false;
                    window.WindowStyle = WindowStyle.None;
                    window.ResizeMode = ResizeMode.NoResize;

                    webView = new WebView2();
                    webView.AllowExternalDrop = false;
                    window.Content = webView;
                    window.Loaded += OnLoaded;

                    timeoutTimer = new DispatcherTimer();
                    timeoutTimer.Interval = TimeSpan.FromSeconds(150);
                    timeoutTimer.Tick += OnTimeout;
                    timeoutTimer.Start();

                    application.Run(window);
                }
                catch (Exception ex)
                {
                    Error = ex;
                    Stop();
                }
            }

            private async void OnLoaded(object sender, RoutedEventArgs e)
            {
                try
                {
                    Directory.CreateDirectory(cacheDir);
                    CoreWebView2Environment environment =
                        await CoreWebView2Environment.CreateAsync(
                            null,
                            cacheDir,
                            null);
                    await webView.EnsureCoreWebView2Async(environment);
                    webView.ZoomFactor = 1.0;
                    webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                        "macrostudio.local",
                        Path.Combine(baseDir, "assets"),
                        CoreWebView2HostResourceAccessKind.Allow);

                    HostServices services = new HostServices(
                        window,
                        baseDir);
                    router = new MessageRouter(webView, services);
                    webView.CoreWebView2.WebMessageReceived +=
                        router.OnWebMessageReceived;
                    webView.CoreWebView2.NavigationCompleted +=
                        OnNavigationCompleted;
                    webView.CoreWebView2.Navigate(
                        "https://macrostudio.local/index.html");
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            private async void OnNavigationCompleted(
                object sender,
                CoreWebView2NavigationCompletedEventArgs e)
            {
                webView.CoreWebView2.NavigationCompleted -=
                    OnNavigationCompleted;
                if (!e.IsSuccess)
                {
                    Fail(new InvalidOperationException(
                        "The both-route page navigation failed."));
                    return;
                }

                try
                {
                    Dictionary<string, object> result =
                        new Dictionary<string, object>();

                    await WaitFor(
                        "MacroStudioState.getState().appInfo !== null && " +
                        "MacroStudioState.getState().appInfo.catalog && " +
                        "MacroStudioState.getState().changeScope !== null");
                    result.Add("scope", await ReadJson(
                        "MacroStudioState.getState().changeScope.structure"));

                    await AttachBook();
                    result.Add("originalCode", await ReadJson(
                        "MacroStudioState.getState().modules.map(" +
                        "function(m){return m.code;}).join('\\u0000')"));

                    await ClickNext();
                    await WaitFor(
                        "MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.diagnoseScreen && " +
                        "MacroStudioState.getState().diagnosisRequestId " +
                        "!== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    await Execute(
                        "MacroStudioWorkflow.applyDiagnosisText(" +
                        TwoFindings() + ");");
                    await WaitFor(
                        "MacroStudioState.getState().diagnosis !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    await ClickNext();
                    await WaitForScreen("findingsScreen");
                    await ClickNext();
                    await WaitForScreen("nextStepScreen");

                    // The two operations that deal with what the code runs
                    // outside itself stand under one heading, and they are
                    // still two files. Which two those are comes off the
                    // declarations, never off a name written here.
                    result.Add("sharedHeading", await ReadJson(
                        "(function(){var c=MacroStudioState.getState()" +
                        ".appInfo.catalog;" +
                        "var byCategory={};" +
                        "c.repair.forEach(function(e){if(!e.valid){return;}" +
                        "byCategory[e.category]=(byCategory[e.category]||[])" +
                        ".concat([e.file]);});" +
                        "var shared=Object.keys(byCategory).filter(" +
                        "function(k){return byCategory[k].length > 1;});" +
                        "return {headings:Object.keys(byCategory).length," +
                        "sharedHeadings:shared.length," +
                        "filesUnderShared:shared.map(function(k){" +
                        "return byCategory[k].length;})," +
                        "allFilesDistinct:c.repair.filter(function(e){" +
                        "return e.valid;}).map(function(e){return e.file;})" +
                        ".filter(function(f,i,a){return a.indexOf(f)===i;})" +
                        ".length === c.repair.filter(function(e){" +
                        "return e.valid;}).length};}())"));

                    // The table operation and one chat operation, ticked
                    // together. Both are found by what they declare.
                    await Execute(
                        "window.__msTable = MacroStudioState.getState()" +
                        ".appInfo.catalog.repair.filter(function(e){" +
                        "return e.valid && e.replaceRules;})[0].file;" +
                        "window.__msChat = MacroStudioState.getState()" +
                        ".appInfo.catalog.repair.filter(function(e){" +
                        "return e.valid && e.instruction && " +
                        "e.recommendKeys.indexOf('WIN32API_BLOCKED') >= 0;" +
                        "})[0].file;");
                    await ClickCard("data-preset-file", "__msTable");
                    await WaitFor(
                        "MacroStudioState.getState().presetFiles.length " +
                        ">= 1 && " +
                        "MacroStudioState.getState().busyAction === null");
                    await ClickCard("data-preset-file", "__msChat");
                    await WaitFor(
                        "MacroStudioState.getState().presetFiles.length " +
                        "=== 2 && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("chosen", await ReadJson(
                        "({" +
                        "count:MacroStudioState.getState()" +
                        ".presetFiles.length," +
                        "engine:MacroStudioScreens.getEngine(" +
                        "MacroStudioState.getState())," +
                        "hasReplacementStage:" +
                        "MacroStudioScreens.hasReplacementStage(" +
                        "MacroStudioState.getState())" +
                        "})"));

                    await ClickNext();
                    await WaitForScreen("repairInputScreen");

                    // The replacement comes first on this screen. Nothing
                    // has been applied yet, and the chat has not been asked
                    // anything.
                    result.Add("tableFirst", await ReadJson(
                        "(function(){var s=MacroStudioState.getState();" +
                        "return {" +
                        "rows:s.pathMap.rows.length," +
                        "allUnapplied:s.pathMap.rows.every(function(r){" +
                        "return !r.applied;})," +
                        "replacementPending:" +
                        "MacroStudioScreens.isReplacementPending(s)," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled};}())"));

                    await Execute(
                        "(function(){" +
                        "if(document.querySelector(" +
                        "'[data-workflow-input=\"path-map-to\"]')){return;}" +
                        "document.querySelector(" +
                        "'[data-workflow-input=\"path-map-include\"]')" +
                        ".click();}())");
                    await WaitFor(
                        "document.querySelector(" +
                        "'[data-workflow-input=\"path-map-to\"]') !== null");
                    await Execute(
                        "(function(){var input=document.querySelector(" +
                        "'[data-workflow-input=\"path-map-to\"]');" +
                        "input.value='\\\\\\\\newserver\\\\eigyo\\\\';" +
                        "input.dispatchEvent(new Event(" +
                        "'input',{bubbles:true}));}())");
                    await WaitFor(
                        "MacroStudioPathMap.canApply(" +
                        "MacroStudioState.getState().pathMap) && " +
                        "!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled");
                    await ClickNext();
                    // The replacement is carried out and the screen stays
                    // where it is, now asking what the chat should repair.
                    await WaitFor(
                        "MacroStudioScreens.isReplacementDone(" +
                        "MacroStudioState.getState()) && " +
                        "MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.repairInputScreen && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("replaced", await ReadJson(
                        "(function(){var s=MacroStudioState.getState();" +
                        "var snap=s.deterministicCodeSnapshot||{};" +
                        "var names=Object.keys(snap);" +
                        "return {" +
                        "screen:s.screen," +
                        "applied:s.appliedMapping.mapping.rows.filter(" +
                        "function(r){return r.applied;}).length," +
                        "modulesReplaced:names.length," +
                        "codeChanged:names.some(function(n){" +
                        "return s.modules.filter(function(m){" +
                        "return m.name === n;})[0].code !== snap[n];})," +
                        "findingChecks:document.querySelectorAll(" +
                        "'[data-workflow-input=\"finding-group-select\"]')" +
                        ".length};}())"));

                    await Execute(
                        "MacroStudioState.setFindingSelected('2', true);");
                    await WaitFor(
                        "MacroStudioScreens.isRepairInputReady(" +
                        "MacroStudioState.getState())");
                    await ClickNext();
                    await WaitFor(
                        "MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.repairScreen && " +
                        "MacroStudioState.getState().repairRequestId " +
                        "!== null && " +
                        "MacroStudioState.getState().busyAction === null");

                    // One request carries both operations, each under its
                    // own name, plus the change scope and the note that the
                    // code it is looking at was already rewritten once.
                    result.Add("request", await ReadJson(
                        "(function(){var s=MacroStudioState.getState();" +
                        "var speaking=s.presets.filter(function(p){" +
                        "return p.parsed && p.parsed.instruction;});" +
                        "return {" +
                        "chosen:s.presets.length," +
                        "speaking:speaking.length," +
                        // Every operation that has something to say is in
                        // the one request, in its own words.
                        "instructionsInRequest:speaking.filter(" +
                        "function(p){return s.repairPrompt.indexOf(" +
                        "p.parsed.instruction.body.split('\\r\\n')[0]" +
                        ") >= 0;}).length," +
                        "changeScope:s.repairPrompt.indexOf(" +
                        "'\\u3010\\u5909\\u66f4\\u7bc4\\u56f2\\u3011') >= 0," +
                        "replacedNote:s.repairPrompt.indexOf(" +
                        "'\\u7f6e\\u304d\\u63db\\u3048\\u6e08\\u307f') >= 0," +
                        "keepsNewValue:s.repairPrompt.indexOf(" +
                        "'newserver') >= 0," +
                        "aiFileReplaced:s.repairPrompt.indexOf(" +
                        "'\\u5143\\u306e\\u5024\\u3078\\u623b\\u3055\\u306a" +
                        "\\u3044\\u3067\\u304f\\u3060\\u3055\\u3044') >= 0" +
                        "};}())"));

                    await Execute(
                        "MacroStudioWorkflow.applyRepairText(" +
                        ChatReply() + ");");
                    await WaitFor(
                        "MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState()) >= 1 && " +
                        "MacroStudioState.getState().busyAction === null");
                    await ClickNext();
                    await WaitForScreen("reviewScreen");
                    // The diff runs from the workbook as it was read to the
                    // final code, so it carries both what the table did and
                    // what the chat did.
                    result.Add("review", await ReadJson(
                        "(function(){var s=MacroStudioState.getState();" +
                        "var changed=s.modules.filter(function(m){" +
                        "return m.status === 'changed';});" +
                        "return {" +
                        "screen:s.screen," +
                        "changed:changed.length," +
                        "carriesReplacement:changed.some(function(m){" +
                        "return m.pastedCode.indexOf('newserver') >= 0;})," +
                        "carriesChatChange:changed.some(function(m){" +
                        "return m.pastedCode.indexOf(" +
                        "'both route smoke') >= 0;})," +
                        "sourceStillOriginal:s.modules.every(function(m){" +
                        "return m.code.indexOf('newserver') < 0 && " +
                        "m.code.indexOf('both route smoke') < 0;})};}())"));

                    await ClickNext();
                    await WaitForScreen("outputScreen");
                    await ClickNext();
                    await WaitFor(
                        "MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.doneScreen && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("done", await ReadJson(
                        "(function(){var s=MacroStudioState.getState();" +
                        "return {" +
                        "screen:s.screen," +
                        "status:s.buildResult.status," +
                        "success:s.buildResult.success," +
                        "outputPath:s.buildResult.outputPath," +
                        "verified:s.buildResult.verified};}())"));

                    Result = serializer.Serialize(result);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            // ---- shared steps ----

            // Ticks a card, and leaves it alone if the diagnosis already
            // ticked it. The card is a toggle, so clicking one the screen
            // arrived with would take it off.
            //
            // Walked rather than selected: a preset file name carries a
            // backslash, which a CSS selector reads as an escape.
            private async Task ClickCard(string attribute, string variable)
            {
                await Execute(
                    "(function(){var card=Array.prototype.filter.call(" +
                    "document.querySelectorAll('[" + attribute + "]')," +
                    "function(c){return c.getAttribute('" + attribute +
                    "') === window." + variable + ";})[0];" +
                    "if(card.getAttribute('aria-checked') !== 'true'){" +
                    "card.click();}}())");
            }

            private async Task AttachBook()
            {
                Dictionary<string, object> eventData =
                    new Dictionary<string, object>();
                eventData.Add("path", bookPath);
                router.PushEvent("bookDropped", eventData);
                await WaitFor(
                    "MacroStudioState.getState().book !== null && " +
                    "MacroStudioState.getState().busyAction === null");
            }

            private async Task ClickNext()
            {
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"go-next\"]').click();");
            }

            private async Task WaitForScreen(string name)
            {
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens." + name + " && " +
                    "MacroStudioState.getState().busyAction === null");
            }

            // Two B findings against the first module with code: one that
            // names the fixed-drive constraint, one that names Win32. That
            // is what makes this one case rather than two runs.
            private string TwoFindings()
            {
                List<string> lines = new List<string>();

                lines.Add(
                    "(function(){var s=MacroStudioState.getState();" +
                    "var id=s.diagnosisRequestId;");
                lines.Add(
                    "var name=s.modules.filter(function(m){" +
                    "return m.lineCount > 0;})[0].name;");
                lines.Add(
                    "var m=String.fromCharCode(39)+'@MACROSTUDIO '+id+' ';");
                lines.Add("var out=[m+'DIAG BEGIN 2'];");
                lines.Add(
                    "['PURPOSE','FLOW','DEPENDENCY','ENVIRONMENT'].forEach(" +
                    "function(n){out.push(m+'SECTION BEGIN '+n);" +
                    "out.push(n+' \\u306e\\u4e8b\\u5b9f\\u3067\\u3059\\u3002');" +
                    "out.push(m+'SECTION END '+n);});");
                lines.Add(
                    "[['1','FIXED_DRIVE_LETTER'],['2','WIN32API_BLOCKED']]" +
                    ".forEach(function(pair){" +
                    "out.push(m+'FINDING BEGIN '+pair[0]);" +
                    "out.push(m+'META GRADE=B CONFIDENCE=CONFIRMED MODULE='" +
                    "+name+' PROC=- LINES=1 ENVKEY='+pair[1]);" +
                    "['TITLE','CONDITION','IMPACT','EVIDENCE'].forEach(" +
                    "function(n){out.push(m+'TEXT BEGIN '+n);" +
                    "out.push(pair[1]+' \\u306e'+n+" +
                    "' \\u3067\\u3059\\u3002');" +
                    "out.push(m+'TEXT END '+n);});" +
                    "out.push(m+'FINDING END '+pair[0]);});");
                lines.Add("out.push(m+'DIAG COMPLETE 2');");
                lines.Add("out.push(m+'DIAG END');");
                lines.Add("return out.join('\\r\\n');}())");
                return string.Join("", lines.ToArray());
            }

            // The chat answers on the code the table produced, keeping the
            // replacement and adding one line of its own. Keeping every
            // procedure is what a repair to one place looks like, and it is
            // what the default change scope requires.
            private string ChatReply()
            {
                List<string> lines = new List<string>();

                lines.Add(
                    "(function(){var s=MacroStudioState.getState();" +
                    "var id=s.repairRequestId;" +
                    "var snap=s.deterministicCodeSnapshot||{};" +
                    "var replacedNames=Object.keys(snap);");
                // The chat answers on the code the table produced, which is
                // exactly the file it was handed. Reading it back from the
                // run's own record of the replacement is how the reply
                // carries the new value forward instead of undoing it.
                lines.Add(
                    "var first=replacedNames.length " +
                    "? s.modules.filter(function(m){" +
                    "return m.name === replacedNames[0];})[0] " +
                    ": s.modules.filter(function(m){" +
                    "return m.lineCount > 0;})[0];");
                lines.Add(
                    "var current=(snap[first.name] || first.pastedCode || " +
                    "first.code).replace(/\\r\\n$/, '');");
                lines.Add(
                    "var m=String.fromCharCode(39)+'@MACROSTUDIO '+id+' ';");
                lines.Add("var out=[m+'SUMMARY BEGIN'];");
                lines.Add(
                    "out.push('\\u76f4\\u3057\\u307e\\u3057\\u305f\\u3002');");
                lines.Add("out.push(m+'SUMMARY END');");
                lines.Add(
                    "out.push(m+'BEGIN '+first.type+' '+first.name);");
                lines.Add(
                    "out.push(current + '\\r\\n' + " +
                    "String.fromCharCode(39) + ' both route smoke');");
                lines.Add("out.push(m+'END '+first.type+' '+first.name);");
                lines.Add("out.push(m+'COMPLETE 1');");
                lines.Add("return out.join('\\r\\n');}())");
                return string.Join("", lines.ToArray());
            }

            private async Task Execute(string script)
            {
                await webView.CoreWebView2.ExecuteScriptAsync(script);
            }

            private async Task<string> ReadJson(string expression)
            {
                string raw =
                    await webView.CoreWebView2.ExecuteScriptAsync(
                        "JSON.stringify(" + expression + ")");
                return serializer.Deserialize<string>(raw);
            }

            private async Task WaitFor(string expression)
            {
                int attempt;
                for (attempt = 0; attempt < 600; attempt++)
                {
                    string raw =
                        await webView.CoreWebView2.ExecuteScriptAsync(
                            "Boolean(" + expression + ")");
                    if (raw == "true")
                    {
                        return;
                    }
                    await Task.Delay(50);
                }
                throw new TimeoutException(
                    "The both-route condition timed out: " +
                    expression + " | state=" + await ReadJson(
                        "JSON.stringify({" +
                        "screen:MacroStudioState.getState().screen," +
                        "busy:MacroStudioState.getState().busyAction," +
                        "error:MacroStudioState.getState().lastError," +
                        "intake:MacroStudioState.getState().intakeError})"));
            }

            private void OnTimeout(object sender, EventArgs e)
            {
                Fail(new TimeoutException(
                    "The both-route smoke test timed out."));
            }

            private void Fail(Exception error)
            {
                Error = error;
                Stop();
            }

            private void Stop()
            {
                try
                {
                    if (timeoutTimer != null)
                    {
                        timeoutTimer.Stop();
                        timeoutTimer.Tick -= OnTimeout;
                        timeoutTimer = null;
                    }
                    if (webView != null)
                    {
                        if (webView.CoreWebView2 != null && router != null)
                        {
                            webView.CoreWebView2.WebMessageReceived -=
                                router.OnWebMessageReceived;
                        }
                        if (window != null)
                        {
                            window.Content = null;
                        }
                        webView.Dispose();
                        webView = null;
                        router = null;
                    }
                    if (window != null)
                    {
                        window.Close();
                        window = null;
                    }
                    if (application != null)
                    {
                        application.Shutdown();
                        application = null;
                    }
                }
                catch
                {
                }
            }
        }
    }
}
