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
    // An answer that changes nothing, driven through the real runtime.
    //
    // The node tests settle the protocol. What has to be seen here is
    // the screen: that a declared verdict is shown with its reason and
    // stops the run, that the way to take another answer stays open,
    // that a near miss is still refused, and that a real answer
    // afterwards still reaches a rebuilt workbook. Both ways of asking
    // for modules are driven, because the module-by-module run is the
    // one that could sit waiting for a part that never comes.
    public static class NoChangeSmoke
    {
        public static string Run(
            string baseDir,
            string cacheDir,
            string bookPath)
        {
            SmokeRunner runner = new SmokeRunner(
                baseDir,
                cacheDir,
                bookPath);
            Thread thread = new Thread(runner.Run);
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();

            if (!thread.Join(240000))
            {
                throw new TimeoutException(
                    "The no-change smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The no-change smoke test failed.",
                    runner.Error);
            }
            return runner.Result;
        }

        private sealed class SmokeRunner
        {
            private readonly string baseDir;
            private readonly string cacheDir;
            private readonly string bookPath;
            private readonly JavaScriptSerializer serializer;

            private Application application;
            private Window window;
            private WebView2 webView;
            private MessageRouter router;
            private DispatcherTimer timeoutTimer;

            public string Result;
            public Exception Error;

            public SmokeRunner(
                string baseDir,
                string cacheDir,
                string bookPath)
            {
                this.baseDir = Path.GetFullPath(baseDir);
                this.cacheDir = Path.GetFullPath(cacheDir);
                this.bookPath = Path.GetFullPath(bookPath);
                serializer = new JavaScriptSerializer();
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
                    timeoutTimer.Interval = TimeSpan.FromSeconds(230);
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
                        WebViewSecurity.TrustedHost,
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
                        WebViewSecurity.StartPage);
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
                        "The no-change test page navigation failed."));
                    return;
                }

                try
                {
                    Dictionary<string, object> report =
                        new Dictionary<string, object>();

                    await WaitFor(
                        "MacroStudioState.getState().appInfo !== null");
                    report.Add("whole", await RunOnce(false));
                    report.Add("split", await RunOnce(true));

                    Result = serializer.Serialize(report);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            private async Task<string> RunOnce(bool perModule)
            {
                Dictionary<string, object> phase =
                    new Dictionary<string, object>();

                await StartOver();
                Dictionary<string, object> eventData =
                    new Dictionary<string, object>();
                eventData.Add("path", bookPath);
                router.PushEvent("bookDropped", eventData);
                await WaitFor(
                    "MacroStudioState.getState().book !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                await AllowStructuralChange();
                phase.Add("singleEntrance", await ReadRaw(
                    "document.querySelectorAll(" +
                    "'[data-action=\"select-mode\"]," +
                    "[data-action=\"select-entrance\"]," +
                    "[data-action=\"select-purpose\"]').length === 0"));
                await ClickNext();
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.diagnoseScreen && " +
                    "MacroStudioState.getState().diagnosisRequestId " +
                    "!== null && " +
                    "MacroStudioState.getState().busyAction === null");
                phase.Add("runFolder", await ReadJson(
                    "MacroStudioState.getState().runFolder"));
                await Execute(
                    "MacroStudioState.setDiagnosisHandoffProgress(" +
                    "true,true);");
                // Asking and importing share one screen: no [次へ] here.
                await WaitForScreen("diagnoseScreen");
                await Execute(
                    "MacroStudioWorkflow.applyDiagnosisText(" +
                    ZeroDiagnosis(perModule
                        ? "INSUFFICIENT"
                        : "SCOPE_CLEAR") + ");");
                await WaitFor(
                    "MacroStudioState.getState().diagnosis !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                phase.Add("diagnosis", await ReadJson(
                    "JSON.stringify({" +
                    "reason:MacroStudioState.getState()" +
                    ".diagnosis.noFinding," +
                    "findings:MacroStudioState.getState()" +
                    ".diagnosis.findings.length," +
                    "recorded:MacroStudioState.getState()" +
                    ".diagnosisFilePath !== null," +
                    "nextReady:!document.querySelector(" +
                    "'[data-action=\"go-next\"]').disabled})"));
                await ClickNext();
                await WaitForScreen("findingsScreen");
                // Reading the diagnosis and choosing the work are two pages.
                await ClickNext();
                await WaitForScreen("nextStepScreen");
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"select-repair-preset\"]')" +
                    ".click();");
                await WaitFor(
                    "MacroStudioState.getState().presetFile !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                await ClickNext();
                await WaitForScreen("repairInputScreen");
                await Execute(
                    "(function(){var input=document.querySelector(" +
                    "'[data-workflow-input=\"extra-request\"]');" +
                    "input.value='Apply the requested safe test change.';" +
                    "input.dispatchEvent(new Event(" +
                    "'input',{bubbles:true}));}())");
                await WaitFor(
                    "MacroStudioScreens.isRepairInputReady(" +
                    "MacroStudioState.getState())");
                if (perModule)
                {
                    await Execute(
                        "document.querySelector(" +
                        "'[data-workflow-input=" +
                        "\"repair-split-output\"]')" +
                        ".click();");
                    await WaitFor(
                        "MacroStudioState.getState().splitOutput === true");
                }
                phase.Add("splitChosen", await ReadRaw(
                    "MacroStudioState.getState().splitOutput"));

                await ClickNext();
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.repairScreen && " +
                    "MacroStudioState.getState().repairRequestId " +
                    "!== null && " +
                    "MacroStudioState.getState().busyAction === null");
                await Execute(
                    "MacroStudioState.setRepairHandoffProgress(" +
                    "true,true);");
                // Asking and importing share one screen: no [次へ] here.
                await WaitForScreen("repairScreen");

                // ---- what must be refused, before anything is taken ----
                Dictionary<string, object> refusals =
                    new Dictionary<string, object>();
                string[][] cases = new string[][] {
                    new string[] { "silent", Silent() },
                    new string[] { "noReason", NoReason() },
                    new string[] { "badVerdict", BadVerdict() },
                    new string[] { "foreign", Foreign() },
                    new string[] { "cutOff", CutOff() }
                };
                int index;

                for (index = 0; index < cases.Length; index += 1)
                {
                    // The text is built first and measured, so a script
                    // that failed to produce one cannot be mistaken for
                    // an answer that was properly refused.
                    await Execute(
                        "window.__err='';try{window.__text = " +
                        cases[index][1] + ";}catch(e){window.__text='';" +
                        "window.__err=String(e);}" +
                        "window.__took = MacroStudioWorkflow" +
                        ".applyRepairText(window.__text);");
                    refusals.Add(cases[index][0], await ReadJson(
                        "JSON.stringify({" +
                        "sent:String(window.__text || '').length," +
                        "buildError:String(window.__err || '')," +
                        "took:window.__took === true," +
                        "verdictShown:MacroStudioScreens.isNoChange(" +
                        "MacroStudioState.getState())," +
                        "imported:MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "reported:MacroStudioState.getState()" +
                        ".lastError !== null," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                }
                phase.Add("refusals", serializer.Serialize(refusals));

                // ---- and what must be taken ----
                await Execute(
                    "MacroStudioWorkflow.applyRepairText(" +
                    Declared("UNNECESSARY") + ");");
                await WaitFor(
                    "MacroStudioScreens.isNoChange(" +
                    "MacroStudioState.getState())");
                phase.Add("declared", await ReadJson(ScreenShape()));

                await Execute(
                    "MacroStudioWorkflow.applyRepairText(" +
                    Declared("IMPOSSIBLE") + ");");
                await WaitFor(
                    "MacroStudioState.getState().noChangeResult" +
                    ".verdict === 'IMPOSSIBLE'");
                phase.Add("second", await ReadJson(ScreenShape()));

                // A reply that asks the reader something is the third
                // shape the contract does not have. It is refused, and
                // the state is left exactly as it was.
                string beforeQuestion = await ReadJson(
                    "JSON.stringify({" +
                    "verdict:MacroStudioState.getState()" +
                    ".noChangeResult.verdict," +
                    "repairId:MacroStudioState.getState().repairRequestId})");
                phase.Add("questionRefused", await ReadJson(
                    "JSON.stringify({" +
                    "accepted:MacroStudioWorkflow.applyRepairText(" +
                    AskingQuestion() + ")," +
                    "verdict:MacroStudioState.getState()" +
                    ".noChangeResult.verdict," +
                    "repairId:MacroStudioState.getState().repairRequestId," +
                    "before:" + serializer.Serialize(beforeQuestion) + "})"));

                // "I cannot settle this from what I was given" is a
                // refusal like the other two, not a conversation.
                await Execute(
                    "MacroStudioWorkflow.applyRepairText(" +
                    Declared("UNCLEAR") + ");");
                await WaitFor(
                    "MacroStudioState.getState().noChangeResult" +
                    ".verdict === 'UNCLEAR'");
                phase.Add("third", await ReadJson(ScreenShape()));

                // ---- taking a real answer instead still works ----
                if (perModule)
                {
                    await Execute(Part(0, 2, "AppController", true));
                    await WaitFor(
                        "MacroStudioScreens.countIntakeParts(" +
                        "MacroStudioState.getState()) === 1");
                    await Execute(Part(1, 2, "TimerUtils", false));
                }
                else
                {
                    await Execute(WholeAnswer());
                }
                await WaitFor(
                    "MacroStudioScreens.countImported(" +
                    "MacroStudioState.getState()) === 2");
                phase.Add("recovered", await ReadJson(
                    "JSON.stringify({" +
                    "verdictGone:!MacroStudioScreens.isNoChange(" +
                    "MacroStudioState.getState())," +
                    "imported:MacroStudioScreens.countImported(" +
                    "MacroStudioState.getState())," +
                    "nextReady:!document.querySelector(" +
                    "'[data-action=\"go-next\"]').disabled" +
                    "})"));

                await ClickNext();
                await WaitForScreen("reviewScreen");
                await ClickNext();
                await WaitForScreen("outputScreen");
                await ClickNext();
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.doneScreen && " +
                    "MacroStudioState.getState().buildResult !== null");
                phase.Add("built", await ReadJson(
                    "JSON.stringify({" +
                    "success:MacroStudioState.getState().buildResult" +
                    ".status !== 'error'," +
                    "outputPath:MacroStudioState.getState().buildResult" +
                    ".outputPath || ''" +
                    "})"));
                return serializer.Serialize(phase);
            }

            // What the intake screen says once a verdict has been taken.
            private static string ScreenShape()
            {
                return "(function(){" +
                    "var main=document.getElementById('main-content');" +
                    "var result=MacroStudioState.getState()" +
                    ".noChangeResult;" +
                    "return JSON.stringify({" +
                    "verdict:result?result.verdict:''," +
                    "reasonKept:result?result.summary:''," +
                    "text:main?main.textContent:''," +
                    "imported:MacroStudioScreens.countImported(" +
                    "MacroStudioState.getState())," +
                    "changed:MacroStudioScreens.countChanged(" +
                    "MacroStudioState.getState())," +
                    "waitingForParts:MacroStudioScreens" +
                    ".getIntakePartTotal(MacroStudioState.getState())," +
                    "nextReady:!document.querySelector(" +
                    "'[data-action=\"go-next\"]').disabled," +
                    "canRetake:document.querySelectorAll(" +
                    "'[data-action=\"import-repair\"]:not([disabled])')" +
                    ".length," +
                    "diffTables:document.querySelectorAll(" +
                    "'.diff-table').length" +
                    "});}())";
            }

            // ---- the answers, built from the protocol's own helpers ----

            private static string ZeroDiagnosis(string reason)
            {
                return "(function(){" +
                    "var id=MacroStudioState.getState()" +
                    ".diagnosisRequestId;" +
                    "var marker=String.fromCharCode(39)+" +
                    "'@MACROSTUDIO '+id+' ';" +
                    "var lines=[marker+'DIAG BEGIN 0'];" +
                    "['PURPOSE','FLOW','DEPENDENCY','ENVIRONMENT']" +
                    ".forEach(function(name){" +
                    "lines.push(marker+'SECTION BEGIN '+name);" +
                    "lines.push(name+' checked.');" +
                    "lines.push(marker+'SECTION END '+name);});" +
                    "lines.push(marker+'DIAG NOFINDING " + reason + "');" +
                    "lines.push(marker+'DIAG COMPLETE 0');" +
                    "lines.push(marker+'DIAG END');" +
                    "return lines.join('\\r\\n');}())";
            }

            private static string AskingQuestion()
            {
                return Wrap(
                    "[api.summaryBeginLine(id)," +
                    "'A choice is required.'," +
                    "api.summaryEndLine(id)," +
                    "api.marker+' '+id+' DECISION BEGIN 1'," +
                    "api.marker+' '+id+' META FINDING=- MODULE=-'," +
                    "api.marker+' '+id+' TEXT BEGIN QUESTION'," +
                    "'Choose the output destination.'," +
                    "api.marker+' '+id+' TEXT END QUESTION'," +
                    "api.marker+' '+id+' TEXT BEGIN OPTIONS'," +
                    "'Shared folder / personal folder'," +
                    "api.marker+' '+id+' TEXT END OPTIONS'," +
                    "api.marker+' '+id+' DECISION END 1'," +
                    "api.noChangeLine(id, 'UNCLEAR')," +
                    "api.completeLine(id, 0)].join('\\r\\n')");
            }

            private static string Reason()
            {
                // "The three modules were read. Nothing needed changing."
                return "'\\u8aad\\u307f\\u307e\\u3057\\u305f\\u3002'," +
                    "'\\u76f4\\u3059\\u884c\\u306f\\u3042\\u308a\\u307e" +
                    "\\u305b\\u3093\\u3067\\u3057\\u305f\\u3002'";
            }

            private static string Declared(string verdict)
            {
                return Wrap(
                    "[api.summaryBeginLine(id)," + Reason() + "," +
                    "api.summaryEndLine(id)," +
                    "api.noChangeLine(id, '" + verdict + "')," +
                    "api.completeLine(id, 0)].join('\\r\\n')");
            }

            // No verdict at all: the answer simply stopped.
            private static string Silent()
            {
                return Wrap(
                    "[api.summaryBeginLine(id)," + Reason() + "," +
                    "api.summaryEndLine(id)," +
                    "api.completeLine(id, 0)].join('\\r\\n')");
            }

            private static string NoReason()
            {
                return Wrap(
                    "[api.noChangeLine(id, 'UNNECESSARY')," +
                    "api.completeLine(id, 0)].join('\\r\\n')");
            }

            private static string BadVerdict()
            {
                return Wrap(
                    "[api.summaryBeginLine(id)," + Reason() + "," +
                    "api.summaryEndLine(id)," +
                    "api.marker + ' ' + id + ' NOCHANGE MAYBE'," +
                    "api.completeLine(id, 0)].join('\\r\\n')");
            }

            // Another request's verdict.
            private static string Foreign()
            {
                return "(function(){var api=MacroStudioResponse;" +
                    "var id=api.createRequestId();" +
                    "return [api.summaryBeginLine(id)," + Reason() + "," +
                    "api.summaryEndLine(id)," +
                    "api.noChangeLine(id, 'UNNECESSARY')," +
                    "api.completeLine(id, 0)].join('\\r\\n');}())";
            }

            // A verdict with no COMPLETE behind it.
            private static string CutOff()
            {
                return Wrap(
                    "[api.summaryBeginLine(id)," + Reason() + "," +
                    "api.summaryEndLine(id)," +
                    "api.noChangeLine(id, 'UNNECESSARY')].join('\\r\\n')");
            }

            private static string Wrap(string body)
            {
                return "(function(){var api=MacroStudioResponse;" +
                    "var id=MacroStudioState.getState().repairRequestId;" +
                    "return " + body + ";}())";
            }

            private static string WholeAnswer()
            {
                return "(function(){" +
                    "var id = MacroStudioState.getState()" +
                    ".repairRequestId;" +
                    "var api = MacroStudioResponse;" +
                    "MacroStudioWorkflow.applyRepairText([" +
                    "api.summaryBeginLine(id)," +
                    "'\\u76f4\\u3057\\u307e\\u3057\\u305f'," +
                    "api.summaryEndLine(id)," +
                    "api.beginLine(id, 'standard', 'AppController')," +
                    "'Option Explicit'," +
                    "'Public Sub Boot(): Beep: End Sub'," +
                    "api.endLine(id, 'standard', 'AppController')," +
                    "api.beginLine(id, 'standard', 'TimerUtils')," +
                    "'Option Explicit'," +
                    "'Public Sub Tick(): Beep: End Sub'," +
                    "api.endLine(id, 'standard', 'TimerUtils')," +
                    "api.completeLine(id, 2)" +
                    "].join('\\r\\n'));}());";
            }

            private static string Part(
                int index,
                int total,
                string name,
                bool withSummary)
            {
                string summary = withSummary
                    ? "api.summaryBeginLine(id), " +
                      "'\\u76f4\\u3057\\u307e\\u3057\\u305f', " +
                      "api.summaryEndLine(id), "
                    : string.Empty;

                return "(function(){" +
                    "var id = MacroStudioState.getState()" +
                    ".repairRequestId;" +
                    "var api = MacroStudioResponse;" +
                    "MacroStudioWorkflow.applyRepairText([" +
                    summary +
                    "api.partLine(id, " + index.ToString() + ", " +
                    total.ToString() + ")," +
                    "api.beginLine(id, 'standard', '" + name + "')," +
                    "'Option Explicit'," +
                    "'Public Sub Run" + index.ToString() +
                    "(): Beep: End Sub'," +
                    "api.endLine(id, 'standard', '" + name + "')," +
                    "api.completeLine(id, 1)" +
                    "].join('\\r\\n'));}());";
            }

            // ---- shared steps ----

            private async Task StartOver()
            {
                await Execute("MacroStudioState.reset();");
                // The app's own rediscovery: the raw folder listing is
                // described before it is stored, which is what puts the
                // operations and the change scopes in play. Nothing is
                // chosen before the workbook.
                await Execute("MacroStudioApp.loadAppInfo();");
                await WaitFor(
                    "MacroStudioState.getState().appInfo !== null && " +
                    "MacroStudioState.getState().appInfo.catalog && " +
                    "MacroStudioState.getState().changeScope !== null && " +
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.bookScreen");
            }

            // This walk is about what a refusal looks like, and its
            // stand-in answers replace whole modules with two lines.
            // Under the default scope that is a rewrite and is refused -
            // correctly, and by a check that has its own test. So this run
            // allows structural change, the way a reader who meant to
            // restructure would. It has to be done after the workbook is
            // read: attaching one starts a new run, and a new run gets the
            // default back.
            private async Task AllowStructuralChange()
            {
                await Execute(
                    "(function(){var scopes=MacroStudioState.getState()" +
                    ".appInfo.catalog.scope.filter(function(e){" +
                    "return e.valid && e.structure === 'allowed';});" +
                    "MacroStudioState.setChangeScope(scopes[0]);}());");
                await WaitFor(
                    "MacroStudioState.getState().changeScope" +
                    ".structure === 'allowed'");
            }

            private async Task ClickNext()
            {
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"go-next\"]').click();");
                await Task.Delay(120);
            }

            private async Task WaitForScreen(string name)
            {
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens." + name + " && " +
                    "MacroStudioState.getState().busyAction === null");
            }

            private async Task Execute(string script)
            {
                await webView.CoreWebView2.ExecuteScriptAsync(script);
            }

            private async Task<string> ReadJson(string expression)
            {
                return serializer.Deserialize<string>(
                    await ReadRaw(expression));
            }

            private async Task<string> ReadRaw(string expression)
            {
                return await webView.CoreWebView2.ExecuteScriptAsync(
                    expression);
            }

            private async Task WaitFor(string expression)
            {
                int attempt;

                for (attempt = 0; attempt < 400; attempt += 1)
                {
                    string raw =
                        await webView.CoreWebView2.ExecuteScriptAsync(
                            "(" + expression + ") === true");
                    if (raw == "true")
                    {
                        return;
                    }
                    await Task.Delay(50);
                }
                throw new TimeoutException(
                    "The page never satisfied: " + expression);
            }

            private void OnTimeout(object sender, EventArgs e)
            {
                Fail(new TimeoutException(
                    "The no-change smoke test ran out of time."));
            }

            private void Fail(Exception ex)
            {
                if (Error == null)
                {
                    Error = ex;
                }
                Stop();
            }

            private void Stop()
            {
                if (timeoutTimer != null)
                {
                    timeoutTimer.Stop();
                }
                if (application != null)
                {
                    application.Dispatcher.BeginInvoke(
                        new Action(delegate ()
                        {
                            if (window != null)
                            {
                                window.Close();
                            }
                            application.Shutdown();
                        }));
                }
            }
        }
    }
}
