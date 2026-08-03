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
    // The two entrances the long walk does not take.
    //
    // P10FlowSmoke drives the macro repair from end to end. What that
    // never sees is the part of the flow that is not one route with a
    // switch in it: the refactor, whose diagnosis comes back as one
    // letter for the whole workbook and whose single template means
    // there is nothing to choose; and the free request, whose folder
    // holds no diagnosis at all, so the hand-over and the result are
    // pages that never existed for it.
    //
    // Both are walked in the real window against the real host, by
    // clicking what a reader clicks. What is checked is what changed
    // with the entrance: which screens are reached, what the result
    // screen says, and that a run with one template arrives with it
    // already chosen.
    public static class EntranceRoutesSmoke
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
                    "The entrance routes smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The entrance routes smoke test failed.",
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
                        "The entrance routes page navigation failed."));
                    return;
                }

                try
                {
                    Dictionary<string, object> result =
                        new Dictionary<string, object>();

                    await WaitFor(
                        "MacroStudioState.getState().appInfo !== null && " +
                        "document.querySelectorAll(" +
                        "'[data-action=\"select-entrance\"]').length > 0");

                    // What the first screen offers, read off the cards
                    // rather than off any list in the app.
                    result.Add("entrances", await ReadJson(
                        "Array.prototype.map.call(" +
                        "document.querySelectorAll(" +
                        "'[data-action=\"select-entrance\"]')," +
                        "function(card){return {" +
                        "folder:card.getAttribute('data-entrance-folder')," +
                        "title:card.querySelector('.choice-title')" +
                        ".textContent," +
                        "note:card.querySelector('.choice-note').textContent," +
                        "disabled:card.disabled};})"));

                    // Read while the cards are on screen: after the
                    // first walk starts, the page has moved on.
                    string refactorFolder = await EntranceFolder(1);
                    string freeFolder = await EntranceFolder(2);

                    result.Add("refactor", await WalkRefactor(refactorFolder));
                    result.Add("free", await WalkFreeRequest(freeFolder));

                    Result = serializer.Serialize(result);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            // ---- the refactor: one grade for the whole workbook ----

            private async Task<string> WalkRefactor(string folder)
            {
                Dictionary<string, object> phase =
                    new Dictionary<string, object>();

                await StartOver();
                await ChooseEntrance(folder);
                phase.Add("entrance", await ReadJson(
                    "({" +
                    "hasDiagnosis:MacroStudioState.getState()" +
                    ".entrance.hasDiagnosis," +
                    "choosesTemplate:MacroStudioState.getState()" +
                    ".entrance.choosesTemplate," +
                    "repairTemplates:MacroStudioState.getState()" +
                    ".entrance.repair.length" +
                    "})"));
                await ClickNext();
                await WaitForScreen("bookScreen");
                await AttachBook();
                await ClickNext();
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.diagnoseScreen && " +
                    "MacroStudioState.getState().diagnosisRequestId " +
                    "!== null && " +
                    "MacroStudioState.getState().busyAction === null");

                // The criteria the reply is graded against come from the
                // entrance's own repair template, so the request has to
                // be carrying them before any answer is written.
                phase.Add("request", await ReadJson(
                    "({" +
                    "gradingBasis:MacroStudioState.getState()" +
                    ".diagnosisPrompt.indexOf(" +
                    "'\\u3010\\u6539\\u4fee\\u306e\\u57fa\\u6e96\\u3011')" +
                    " >= 0," +
                    "asksForGrade:MacroStudioState.getState()" +
                    ".diagnosisPrompt.indexOf('DIAG GRADE') >= 0" +
                    "})"));

                await Execute(
                    "MacroStudioWorkflow.applyDiagnosisText(" +
                    GradeReply() + ");");
                await WaitFor(
                    "MacroStudioState.getState().diagnosis !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                await ClickNext();
                await WaitForScreen("findingsScreen");
                phase.Add("result", await ReadJson(
                    "({" +
                    "shape:MacroStudioState.getState().diagnosis.shape," +
                    "grade:MacroStudioState.getState().diagnosis.grade," +
                    "badge:document.querySelector('.grade-badge')" +
                    ".textContent," +
                    "title:document.querySelector('.value-title')" +
                    ".textContent," +
                    "judgement:document.querySelectorAll(" +
                    "'.value-judgement').length," +
                    "reason:document.body.textContent.indexOf(" +
                    "'\\u5f80\\u5fa9\\u304c\\u591a\\u3044') >= 0," +
                    "gradeTiles:document.querySelectorAll(" +
                    "'.grade-tile').length," +
                    "findingRows:document.querySelectorAll(" +
                    "'.group-row').length" +
                    "})"));

                // One template means there is nothing to choose between,
                // so the page that would have asked is not in the way and
                // the template arrives already chosen.
                await ClickNext();
                await WaitForScreen("repairInputScreen");
                await WaitFor(
                    "MacroStudioState.getState().presetFile !== null");
                phase.Add("repairInput", await ReadJson(
                    "({" +
                    "screen:MacroStudioState.getState().screen," +
                    "preset:MacroStudioState.getState().presetName," +
                    "chosen:MacroStudioState.getState().presetFiles.length," +
                    "findingChecks:document.querySelectorAll(" +
                    "'[data-workflow-input=\"finding-group-select\"]')" +
                    ".length" +
                    "})"));
                return serializer.Serialize(phase);
            }

            // ---- the free request: no diagnosis at all ----

            private async Task<string> WalkFreeRequest(string folder)
            {
                Dictionary<string, object> phase =
                    new Dictionary<string, object>();

                await StartOver();
                await ChooseEntrance(folder);
                phase.Add("entrance", await ReadJson(
                    "({" +
                    "hasDiagnosis:MacroStudioState.getState()" +
                    ".entrance.hasDiagnosis," +
                    "skipped:MacroStudioScreens.isDiagnosisSkipped(" +
                    "MacroStudioState.getState())," +
                    "repairTemplates:MacroStudioState.getState()" +
                    ".entrance.repair.length" +
                    "})"));
                await ClickNext();
                await WaitForScreen("bookScreen");
                await AttachBook();

                // The workbook leads straight to the request: the
                // hand-over and the result are pages this entrance never
                // had anything to put on.
                await ClickNext();
                await WaitForScreen("repairInputScreen");
                await WaitFor(
                    "MacroStudioState.getState().presetFile !== null");
                phase.Add("repairInput", await ReadJson(
                    "({" +
                    "screen:MacroStudioState.getState().screen," +
                    "diagnosis:MacroStudioState.getState().diagnosis," +
                    "preset:MacroStudioState.getState().presetName," +
                    "findingChecks:document.querySelectorAll(" +
                    "'[data-workflow-input=\"finding-group-select\"]')" +
                    ".length," +
                    // A template that exists so the reader writes the
                    // work themselves names the field, so it is on the
                    // screen under that name rather than folded away.
                    "writeIn:document.querySelectorAll(" +
                    "'.repair-write-in [data-workflow-input=" +
                    "\"extra-request\"]').length," +
                    "folded:document.querySelectorAll(" +
                    "'.disclosure--writein').length," +
                    "nextReady:!document.querySelector(" +
                    "'[data-action=\"go-next\"]').disabled" +
                    "})"));

                // What the reader writes is the whole request here, so
                // writing something is what opens the way forward.
                await Execute(
                    "MacroStudioState.setExtraRequest(" +
                    "'\\u5f85\\u3061\\u6642\\u9593\\u3092\\u6e1b\\u3089\\u3057" +
                    "\\u3066\\u304f\\u3060\\u3055\\u3044\\u3002');");
                await WaitFor(
                    "MacroStudioScreens.isRepairInputReady(" +
                    "MacroStudioState.getState())");
                await ClickNext();
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.repairScreen && " +
                    "MacroStudioState.getState().repairRequestId !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                phase.Add("request", await ReadJson(
                    "({" +
                    "screen:MacroStudioState.getState().screen," +
                    "carriesWhatWasWritten:MacroStudioState.getState()" +
                    ".repairPrompt.indexOf(" +
                    "'\\u5f85\\u3061\\u6642\\u9593\\u3092\\u6e1b\\u3089\\u3057" +
                    "\\u3066\\u304f\\u3060\\u3055\\u3044') >= 0," +
                    "noDiagnosisQuoted:MacroStudioState.getState()" +
                    ".repairPrompt.indexOf('DIAG BEGIN') < 0" +
                    "})"));
                return serializer.Serialize(phase);
            }

            // ---- shared steps ----

            private async Task<string> EntranceFolder(int index)
            {
                string raw = await ReadJson(
                    "(document.querySelectorAll(" +
                    "'[data-action=\"select-entrance\"]')[" +
                    index.ToString() + "] || {getAttribute:function(){" +
                    "return null;}}).getAttribute('data-entrance-folder')");

                if (raw == null || raw == "null")
                {
                    throw new InvalidOperationException(
                        "The first screen has no entrance at position " +
                        index.ToString() + ": " + await ReadJson(
                            "Array.prototype.map.call(" +
                            "document.querySelectorAll('[data-action]')," +
                            "function(n){return n.getAttribute(" +
                            "'data-action');})"));
                }
                return serializer.Deserialize<string>(raw);
            }

            private async Task StartOver()
            {
                // A run folder is named after the workbook and the second
                // it was started in, and the product refuses to write into
                // one that already exists. Two walks over the same
                // workbook inside one second would collide on that name,
                // which is a fact about this test running faster than a
                // person, not about the product.
                await Task.Delay(1100);
                await Execute("MacroStudioState.reset();");
                await Execute("MacroStudioApp.loadAppInfo();");
                await WaitFor(
                    "MacroStudioState.getState().appInfo !== null && " +
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.entranceScreen && " +
                    "document.querySelectorAll(" +
                    "'[data-action=\"select-entrance\"]').length > 0");
            }

            private async Task ChooseEntrance(string folder)
            {
                await Execute(
                    "document.querySelector('[data-entrance-folder=' + " +
                    serializer.Serialize(serializer.Serialize(folder)) +
                    " + ']').click();");
                await WaitFor(
                    "MacroStudioState.getState().entrance !== null && " +
                    "MacroStudioState.getState().entrance.folder === " +
                    serializer.Serialize(folder));
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

            // A reply in the shape the refactor template asks for: three
            // sections, one letter, and the reasoning behind it.
            private string GradeReply()
            {
                List<string> lines = new List<string>();

                lines.Add(
                    "(function(){var id=MacroStudioState.getState()" +
                    ".diagnosisRequestId;");
                lines.Add(
                    "var m=String.fromCharCode(39)+'@MACROSTUDIO '+id+' ';");
                lines.Add("var out=[m+'DIAG BEGIN 0'];");
                lines.Add(
                    "['PURPOSE','FLOW','DEPENDENCY'].forEach(" +
                    "function(name){out.push(m+'SECTION BEGIN '+name);" +
                    "out.push(name+' \\u306e\\u4e8b\\u5b9f\\u3067\\u3059\\u3002');" +
                    "out.push(m+'SECTION END '+name);});");
                lines.Add("out.push(m+'DIAG GRADE D');");
                lines.Add("out.push(m+'SECTION BEGIN REASON');");
                lines.Add(
                    "out.push('\\u30ef\\u30fc\\u30af\\u30b7\\u30fc\\u30c8" +
                    "\\u3068\\u306e\\u5f80\\u5fa9\\u304c\\u591a\\u3044\\u305f" +
                    "\\u3081\\u3067\\u3059\\u3002');");
                lines.Add("out.push(m+'SECTION END REASON');");
                lines.Add("out.push(m+'DIAG COMPLETE 0');");
                lines.Add("out.push(m+'DIAG END');");
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
                    "The entrance routes condition timed out: " +
                    expression + " | state=" + await ReadJson(
                        "JSON.stringify({" +
                        "screen:MacroStudioState.getState().screen," +
                        "busy:MacroStudioState.getState().busyAction," +
                        "error:MacroStudioState.getState().lastError})"));
            }

            private void OnTimeout(object sender, EventArgs e)
            {
                Fail(new TimeoutException(
                    "The entrance routes smoke test timed out."));
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
