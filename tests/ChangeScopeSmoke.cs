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
    // The part of the flow P10FlowSmoke never exercises: how far the code
    // is allowed to change, and what happens to a reply that goes further
    // than that.
    //
    // Walked in the real window against the real host, by clicking what a
    // reader clicks. Three things are checked, all of them on screen:
    //
    //   the operations stand under headings the files declare, and two
    //     operations sharing a heading are still two separate items;
    //   the default scope is in force without anyone choosing it, the
    //     request carries its words, and a reply that adds a module is
    //     refused with a reason;
    //   allowing structural change is a deliberate act, and only after it
    //     does the same reply go in.
    public static class ChangeScopeSmoke
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
                    "The change scope smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The change scope smoke test failed.",
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
                        "The change scope page navigation failed."));
                    return;
                }

                try
                {
                    Dictionary<string, object> result =
                        new Dictionary<string, object>();

                    await WaitFor(
                        "MacroStudioState.getState().appInfo !== null && " +
                        "MacroStudioState.getState().appInfo.catalog");

                    // Nothing stands between the window opening and the
                    // workbook. There is no first screen to get past.
                    result.Add("start", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "isBook:MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.bookScreen," +
                        "entranceCards:document.querySelectorAll(" +
                        "'[data-action=\"select-entrance\"]').length," +
                        "screens:MacroStudioScreens.count," +
                        "scope:MacroStudioState.getState().changeScope.name," +
                        "structure:MacroStudioState.getState()" +
                        ".changeScope.structure" +
                        "})"));

                    await AttachBook();
                    await ClickNext();
                    await WaitFor(
                        "MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.diagnoseScreen && " +
                        "MacroStudioState.getState().diagnosisRequestId " +
                        "!== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    await Execute(
                        "MacroStudioWorkflow.applyDiagnosisText(" +
                        FindingsReply() + ");");
                    await WaitFor(
                        "MacroStudioState.getState().diagnosis !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    await ClickNext();
                    await WaitForScreen("findingsScreen");
                    await ClickNext();
                    await WaitForScreen("nextStepScreen");

                    // The headings are the files' own, and two operations
                    // under one heading are still two cards with two files
                    // behind them.
                    result.Add("categories", await ReadJson(
                        "(function(){var groups=Array.prototype.slice.call(" +
                        "document.querySelectorAll('.category-group'));" +
                        "return {" +
                        "headings:groups.map(function(g){return " +
                        "g.querySelector('.category-heading').textContent;})," +
                        "sizes:groups.map(function(g){return " +
                        "g.querySelectorAll('.choice-card').length;})," +
                        "files:groups.map(function(g){return " +
                        "Array.prototype.map.call(g.querySelectorAll(" +
                        "'.choice-card'),function(c){return " +
                        "c.getAttribute('data-preset-file');});})," +
                        "declared:MacroStudioState.getState().appInfo" +
                        ".catalog.categories" +
                        "};}())"));

                    // What the reader is told the strict scope actually
                    // checks - and, in the same breath, what it does not.
                    result.Add("scopeScreen", await ReadJson(
                        "({" +
                        "options:document.querySelectorAll(" +
                        "'.scope-card').length," +
                        "radios:Array.prototype.every.call(" +
                        "document.querySelectorAll('.scope-card')," +
                        "function(c){return c.getAttribute('role') === " +
                        "'radio';})," +
                        "detail:document.body.textContent.indexOf(" +
                        "'\\u8a73\\u7d30\\u30aa\\u30d7\\u30b7\\u30e7\\u30f3'" +
                        ") >= 0," +
                        "checks:document.querySelectorAll(" +
                        "'.scope-guard-item').length," +
                        "limit:document.body.textContent.indexOf(" +
                        "'\\u691c\\u67fb\\u3067\\u304d\\u307e\\u305b\\u3093'" +
                        ") >= 0" +
                        "})"));

                    // An operation that does not claim it adds modules, so
                    // a reply that adds one is going further than anything
                    // chosen asked for. Which one that is comes off the
                    // files, never off a name written here.
                    await Execute(
                        "window.__msPlain = MacroStudioState.getState()" +
                        ".appInfo.catalog.repair.filter(function(e){" +
                        "return e.valid && e.instruction && " +
                        "(!e.allowedStructures || " +
                        "e.allowedStructures.length === 0);})[0].file;");
                    // Found by walking the cards rather than by a CSS
                    // attribute selector: a preset file name carries a
                    // backslash, which a selector reads as an escape.
                    await Execute(
                        "Array.prototype.filter.call(" +
                        "document.querySelectorAll('[data-preset-file]')," +
                        "function(c){return c.getAttribute(" +
                        "'data-preset-file') === window.__msPlain;" +
                        "})[0].click();");
                    await WaitFor(
                        "MacroStudioState.getState().presetFiles.length " +
                        "=== 1 && " +
                        "MacroStudioState.getState().busyAction === null");
                    await ClickNext();
                    await WaitForScreen("repairInputScreen");
                    await Execute(
                        "MacroStudioState.setFindingSelected('1', true);");
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

                    // The scope is not only enforced, it is asked for: the
                    // request carries the file's own words under its own
                    // heading.
                    result.Add("strictRequest", await ReadJson(
                        "({" +
                        "heading:MacroStudioState.getState().repairPrompt" +
                        ".indexOf('\\u3010\\u5909\\u66f4\\u7bc4\\u56f2" +
                        "\\u3011') >= 0," +
                        "carriesScopeText:MacroStudioState.getState()" +
                        ".repairPrompt.indexOf(MacroStudioState.getState()" +
                        ".changeScope.instruction.body.split('\\r\\n')[0]" +
                        ") >= 0" +
                        "})"));

                    await Execute(
                        "MacroStudioWorkflow.applyRepairText(" +
                        AddingReply() + ");");
                    await WaitFor(
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("refused", await ReadJson(
                        "({" +
                        "imported:MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "screen:MacroStudioState.getState().screen," +
                        "reason:MacroStudioState.getState()" +
                        ".intakeError.repair," +
                        "onScreen:document.body.textContent.indexOf(" +
                        "'MacroStudioAddedModule') >= 0" +
                        "})"));

                    // Allowing more is a deliberate act on the screen that
                    // chose the work, and the request is written again
                    // under the new answer.
                    await Execute(
                        "MacroStudioState.goTo(" +
                        "MacroStudioScreens.nextStepScreen, false);");
                    await WaitForScreen("nextStepScreen");
                    await Execute(
                        "window.__msAllow = MacroStudioState.getState()" +
                        ".appInfo.catalog.scope.filter(function(e){" +
                        "return e.valid && e.structure === 'allowed';" +
                        "})[0].file;");
                    await Execute(
                        "Array.prototype.filter.call(" +
                        "document.querySelectorAll('[data-scope-file]')," +
                        "function(c){return c.getAttribute(" +
                        "'data-scope-file') === window.__msAllow;" +
                        "})[0].click();");
                    await WaitFor(
                        "MacroStudioState.getState().changeScope" +
                        ".structure === 'allowed'");
                    await ClickNext();
                    await WaitForScreen("repairInputScreen");
                    await Execute(
                        "MacroStudioState.setFindingSelected('1', true);");
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
                    await Execute(
                        "MacroStudioWorkflow.applyRepairText(" +
                        AddingReply() + ");");
                    await WaitFor(
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("accepted", await ReadJson(
                        "({" +
                        "imported:MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "added:MacroStudioState.getState().modules.filter(" +
                        "function(m){return m.name === " +
                        "'MacroStudioAddedModule';}).length," +
                        "reason:MacroStudioState.getState()" +
                        ".intakeError.repair" +
                        "})"));

                    Result = serializer.Serialize(result);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            // ---- shared steps ----

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

            // One B finding against the first module of whatever workbook
            // this was pointed at, in the shape the shipped diagnosis
            // template declares.
            private string FindingsReply()
            {
                List<string> lines = new List<string>();

                lines.Add(
                    "(function(){var s=MacroStudioState.getState();" +
                    "var id=s.diagnosisRequestId;");
                // A finding has to point at a line that exists, so the
                // first module with any code in it is the subject.
                lines.Add(
                    "var name=s.modules.filter(function(m){" +
                    "return m.lineCount > 0;})[0].name;");
                lines.Add(
                    "var m=String.fromCharCode(39)+'@MACROSTUDIO '+id+' ';");
                lines.Add("var out=[m+'DIAG BEGIN 1'];");
                lines.Add(
                    "['PURPOSE','FLOW','DEPENDENCY','ENVIRONMENT'].forEach(" +
                    "function(n){out.push(m+'SECTION BEGIN '+n);" +
                    "out.push(n+' \\u306e\\u4e8b\\u5b9f\\u3067\\u3059\\u3002');" +
                    "out.push(m+'SECTION END '+n);});");
                lines.Add("out.push(m+'FINDING BEGIN 1');");
                lines.Add(
                    "out.push(m+'META GRADE=B CONFIDENCE=CONFIRMED MODULE='" +
                    "+name+' PROC=- LINES=1 ENVKEY=-');");
                lines.Add(
                    "['TITLE','CONDITION','IMPACT','EVIDENCE'].forEach(" +
                    "function(n){out.push(m+'TEXT BEGIN '+n);" +
                    "out.push(n+' \\u306e\\u4e8b\\u5b9f\\u3067\\u3059\\u3002');" +
                    "out.push(m+'TEXT END '+n);});");
                lines.Add("out.push(m+'FINDING END 1');");
                lines.Add("out.push(m+'DIAG COMPLETE 1');");
                lines.Add("out.push(m+'DIAG END');");
                lines.Add("return out.join('\\r\\n');}())");
                return string.Join("", lines.ToArray());
            }

            // A repair reply that changes one module and adds one the
            // workbook never had. Nothing else about it is wrong: it is
            // refused for the shape of the change, not for its form.
            private string AddingReply()
            {
                List<string> lines = new List<string>();

                lines.Add(
                    "(function(){var s=MacroStudioState.getState();" +
                    "var id=s.repairRequestId;");
                lines.Add(
                    "var first=s.modules.filter(function(m){" +
                    "return m.lineCount > 0;})[0];");
                lines.Add(
                    "var m=String.fromCharCode(39)+'@MACROSTUDIO '+id+' ';");
                lines.Add("var out=[m+'SUMMARY BEGIN'];");
                lines.Add(
                    "out.push('\\u76f4\\u3057\\u307e\\u3057\\u305f\\u3002');");
                lines.Add("out.push(m+'SUMMARY END');");
                lines.Add("out.push(m+'BEGIN standard '+first.name);");
                lines.Add(
                    "out.push(first.code.replace(/\\r\\n$/, '') + " +
                    "'\\r\\n' + String.fromCharCode(39) + " +
                    "' touched by the smoke test');");
                lines.Add("out.push(m+'END standard '+first.name);");
                lines.Add(
                    "out.push(m+'BEGIN standard MacroStudioAddedModule');");
                lines.Add(
                    "out.push('Option Explicit\\r\\n" +
                    "Public Sub AddedHelper()\\r\\nEnd Sub');");
                lines.Add(
                    "out.push(m+'END standard MacroStudioAddedModule');");
                lines.Add("out.push(m+'COMPLETE 2');");
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
                for (attempt = 0; attempt < 400; attempt++)
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
                    "The change scope condition timed out: " +
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
                    "The change scope smoke test timed out."));
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
