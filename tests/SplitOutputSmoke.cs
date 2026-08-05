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
    // Drives the module-by-module option through the real WebView2
    // runtime: the checkbox on the request screen, the rules that reach
    // the written request, taking the parts in one by one, and the way
    // back to another answer on the intake screen.
    //
    // The clipboard is not used anywhere here. The hand-off screen needs
    // a copy and an explorer window to release its [next], which is what
    // tests\test-flow-webview.ps1 covers; this run marks that step done
    // through the state so the intake screen can be reached without
    // touching the clipboard.
    public static class SplitOutputSmoke
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

            if (!thread.Join(60000))
            {
                throw new TimeoutException(
                    "The split output smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The split output smoke test failed.",
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
                    timeoutTimer.Interval = TimeSpan.FromSeconds(50);
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

            private async void OnLoaded(
                object sender,
                RoutedEventArgs e)
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
                        "The split output test page navigation failed."));
                    return;
                }

                try
                {
                    Dictionary<string, object> report =
                        new Dictionary<string, object>();

                    await OpenRequestScreen(report);
                    await TurnTheOptionOn(report);
                    await PrepareTheRequest(report);
                    await TakeThePartsIn(report);
                    await TakeAWholeAnswerInstead(report);

                    Result = serializer.Serialize(report);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            // Attach once, rebuild the first-AI request with split output,
            // prove gap/duplicate/merge handling, then choose an AI repair
            // preset that also carries module-by-module rules.
            private async Task OpenRequestScreen(
                Dictionary<string, object> report)
            {
                // Nothing is chosen before the workbook, so waiting for
                // the catalog and the first screen is the whole set-up.
                await WaitFor(
                    "MacroStudioState.getState().appInfo !== null && " +
                    "MacroStudioState.getState().appInfo.catalog && " +
                    "MacroStudioState.getState().changeScope !== null && " +
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.bookScreen");
                Dictionary<string, object> eventData =
                    new Dictionary<string, object>();
                eventData.Add("path", bookPath);
                router.PushEvent("bookDropped", eventData);
                await WaitFor(
                    "MacroStudioState.getState().book !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                // The parts this walk sends replace whole modules with two
                // lines, which under the default scope is a rewrite and is
                // refused - correctly, and by a check with its own test.
                // This run is about the part protocol, so it allows
                // structural change the way a reader would. After the
                // workbook, because attaching one starts a new run.
                await Execute(
                    "(function(){var scopes=MacroStudioState.getState()" +
                    ".appInfo.catalog.scope.filter(function(e){" +
                    "return e.valid && e.structure === 'allowed';});" +
                    "MacroStudioState.setChangeScope(scopes[0]);}());");
                await WaitFor(
                    "MacroStudioState.getState().changeScope" +
                    ".structure === 'allowed'");
                report.Add("singleEntrance", await ReadBool(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.bookScreen && " +
                    "document.querySelectorAll(" +
                    "'[data-action=\"select-mode\"]," +
                    "[data-action=\"select-entrance\"]," +
                    "[data-action=\"select-purpose\"]').length === 0"));
                await ClickNext(1);
                await WaitFor(
                    "MacroStudioState.getState().diagnosisRequestId " +
                    "!== null && " +
                    "MacroStudioState.getState().busyAction === null");

                // The diagnosis is prose about the macro and fits in one
                // reply, so the screen no longer offers to split it. Only
                // the repair reply, which is code, still can be.
                report.Add("diagnosisOptionGone", await ReadBool(
                    "document.querySelector(" +
                    "'[data-workflow-input=\"diagnosis-split\"]') " +
                    "=== null"));
                string diagnosisId = await ReadJson(
                    "MacroStudioState.getState().diagnosisRequestId");
                report.Add("runFolder", await ReadJson(
                    "MacroStudioState.getState().runFolder"));
                await Execute(
                    "MacroStudioState.setDiagnosisHandoffProgress(" +
                    "true,true);");
                // Asking and importing share one screen: no [次へ] here.

                // One reply, one package: the diagnosis is no longer split.
                await Execute(
                    "MacroStudioWorkflow.applyDiagnosisText(" +
                    serializer.Serialize(BuildDiagnosis(diagnosisId)) + ");");
                await WaitFor(
                    "MacroStudioState.getState().diagnosis !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                report.Add("diagnosisTaken", await ReadJson(
                    "JSON.stringify({" +
                    "findings:MacroStudioState.getState()" +
                    ".diagnosis.findings.length," +
                    "partsUnused:MacroStudioState.getState()" +
                    ".diagnosisParts === null," +
                    "recorded:MacroStudioState.getState()" +
                    ".diagnosisFilePath !== null})"));
                await ClickNext(2);
                // Reading the diagnosis and choosing the work are two pages.
                await ClickNext(3);

                string presetFile = await ReadJson(
                    "(function(){" +
                    "var entries = " +
                    "MacroStudioState.getState().appInfo.catalog.repair;" +
                    "var found = '';" +
                    "entries.forEach(function(entry){" +
                    "if (!found && entry.valid && " +
                    "!entry.replaceRules && " +
                    "entry.splitOutput) {" +
                    "found = entry.file;}});" +
                    "return found;}())");
                if (string.IsNullOrEmpty(presetFile))
                {
                    throw new InvalidOperationException(
                        "No shipped preset carries the split rules.");
                }
                report.Add("presetFile", presetFile);
                await Execute(
                    "(function(){var file=" +
                    serializer.Serialize(presetFile) + ";" +
                    "var cards=Array.prototype.slice.call(" +
                    "document.querySelectorAll(" +
                    "'[data-action=\"select-repair-preset\"]'));" +
                    "cards.filter(function(card){return " +
                    "card.getAttribute('data-preset-file')===file;})" +
                    "[0].click();}())");
                await WaitFor(
                    "MacroStudioState.getState().splitOutputRules " +
                    "!== null && " +
                    "MacroStudioState.getState().busyAction === null");
                await ClickNext(4);
                // The blocking finding is selected from the start and the
                // screen asks nothing further about it.
                await WaitFor(
                    "MacroStudioScreens.isRepairInputReady(" +
                    "MacroStudioState.getState())");
            }

            // One reply carries the whole diagnosis.
            private string BuildDiagnosis(string requestId)
            {
                string marker = "'@MACROSTUDIO " + requestId + " ";
                List<string> lines = new List<string>();
                string[] sections = {
                    "PURPOSE", "FLOW", "DEPENDENCY", "ENVIRONMENT"
                };
                int sectionIndex;

                lines.Add(marker + "DIAG BEGIN 2");
                for (sectionIndex = 0;
                    sectionIndex < sections.Length;
                    sectionIndex++)
                {
                    lines.Add(marker + "SECTION BEGIN " +
                        sections[sectionIndex]);
                    lines.Add(sections[sectionIndex] + " checked.");
                    lines.Add(marker + "SECTION END " +
                        sections[sectionIndex]);
                }
                AddDiagnosisFinding(
                    lines,
                    marker,
                    1,
                    "B",
                    "AppController",
                    "Test",
                    "2",
                    "First split finding.");
                AddDiagnosisFinding(
                    lines,
                    marker,
                    2,
                    "A",
                    "TimerUtils",
                    "-",
                    "1",
                    "Second split finding.");
                lines.Add(marker + "DIAG COMPLETE 2");
                lines.Add(marker + "DIAG END");
                return string.Join("\r\n", lines.ToArray());
            }

            private void AddDiagnosisFinding(
                List<string> lines,
                string marker,
                int number,
                string grade,
                string module,
                string procedure,
                string lineRange,
                string title)
            {
                string value = number.ToString();
                lines.Add(marker + "FINDING BEGIN " + value);
                lines.Add(marker + "META GRADE=" + grade +
                    " CONFIDENCE=CONFIRMED MODULE=" + module +
                    " PROC=" + procedure + " LINES=" + lineRange +
                    " ENVKEY=-");
                lines.Add(marker + "TEXT BEGIN TITLE");
                lines.Add(title);
                lines.Add(marker + "TEXT END TITLE");
                lines.Add(marker + "TEXT BEGIN CONDITION");
                lines.Add("Condition checked.");
                lines.Add(marker + "TEXT END CONDITION");
                lines.Add(marker + "TEXT BEGIN IMPACT");
                lines.Add("Impact checked.");
                lines.Add(marker + "TEXT END IMPACT");
                lines.Add(marker + "TEXT BEGIN EVIDENCE");
                lines.Add("Evidence checked.");
                lines.Add(marker + "TEXT END EVIDENCE");
                lines.Add(marker + "FINDING END " + value);
            }

            private async Task TurnTheOptionOn(
                Dictionary<string, object> report)
            {
                report.Add(
                    "optionOnScreen",
                    await ReadBool(
                        "document.querySelector(" +
                        "'[data-workflow-input=\"repair-split-output\"]')" +
                        " !== null"));
                report.Add(
                    "optionOffByDefault",
                    await ReadBool(
                        "MacroStudioState.getState().splitOutput " +
                        "=== false && " +
                        "document.querySelector(" +
                        "'[data-workflow-input=\"repair-split-output\"]')" +
                        ".checked === false"));
                await Execute(
                    "document.querySelector(" +
                    "'[data-workflow-input=\"repair-split-output\"]')" +
                    ".click();");
                await WaitFor(
                    "MacroStudioState.getState().splitOutput === true");
                report.Add(
                    "optionChecked",
                    await ReadBool(
                        "document.querySelector(" +
                        "'[data-workflow-input=\"repair-split-output\"]')" +
                        ".checked === true"));
            }

            // Leaving the request screen writes the run folder and its
            // two files, so this is where the rules that were chosen
            // actually reach the request the user pastes into the chat.
            private async Task PrepareTheRequest(
                Dictionary<string, object> report)
            {
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"go-next\"]').click();");
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.repairScreen && " +
                    "MacroStudioState.getState().busyAction === null");
                report.Add(
                    "promptHasPartSentinel",
                    await ReadBool(
                        "MacroStudioState.getState().repairPrompt" +
                        ".indexOf(MacroStudioResponse.marker + ' ' + " +
                        "MacroStudioState.getState().repairRequestId + " +
                        "' PART ') >= 0"));
                report.Add(
                    "promptHasOneBlockRule",
                    await ReadBool(
                        "MacroStudioState.getState().repairPrompt" +
                        ".indexOf(MacroStudioResponse.marker + ' ' + " +
                        "MacroStudioState.getState().repairRequestId + " +
                        "' COMPLETE 1') >= 0"));

                // The copy and the explorer window are the hand-off
                // screen's own conditions and need the clipboard, so they
                // are marked done here instead of being pressed.
                await Execute(
                    "MacroStudioState.setRepairHandoffProgress(" +
                    "true,true);");
                // Asking and importing share one screen: no [次へ] here.
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.repairScreen");
            }

            private async Task TakeThePartsIn(
                Dictionary<string, object> report)
            {
                await Execute(BuildPart(
                    0,
                    2,
                    "standard",
                    "AppController",
                    "Public Sub Boot(): Beep: End Sub",
                    true));
                await WaitFor(
                    "MacroStudioScreens.countIntakeParts(" +
                    "MacroStudioState.getState()) === 1");
                report.Add(
                    "afterFirstPart",
                    await ReadJson(
                        "JSON.stringify({" +
                        "parts: MacroStudioScreens.countIntakeParts(" +
                        "MacroStudioState.getState())," +
                        "total: MacroStudioScreens.getIntakePartTotal(" +
                        "MacroStudioState.getState())," +
                        "imported: MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "canGoNext: MacroStudioState.canGoNext()," +
                        "rows: document.querySelectorAll(" +
                        "'.split-progress').length," +
                        "missingShown: document.querySelector(" +
                        "'.split-progress') !== null" +
                        "})"));

                // A second module under a number that is already in, with
                // other content, is a contradiction and must be refused.
                report.Add(
                    "conflictRefused",
                    await ReadBool(
                        "(function(){" +
                        "var before = MacroStudioScreens" +
                        ".countIntakeParts(" +
                        "MacroStudioState.getState());" +
                        BuildPartExpression(
                            0,
                            2,
                            "standard",
                            "SystemInfo",
                            "Public Sub Other(): End Sub",
                            false) +
                        "return taken === false && " +
                        "MacroStudioScreens.countIntakeParts(" +
                        "MacroStudioState.getState()) === before;}())"));

                await Execute(BuildPart(
                    1,
                    2,
                    "standard",
                    "CompatHelpers",
                    "Public Sub Wait(): End Sub",
                    false));
                await WaitFor(
                    "MacroStudioScreens.countImported(" +
                    "MacroStudioState.getState()) === 2");
                report.Add(
                    "afterLastPart",
                    await ReadJson(
                        "JSON.stringify({" +
                        "imported: MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "changed: MacroStudioScreens.countChanged(" +
                        "MacroStudioState.getState())," +
                        "canGoNext: MacroStudioState.canGoNext()," +
                        "buildModules: MacroStudioApp" +
                        ".createBuildModules(" +
                        "MacroStudioState.getState()).length," +
                        "restartOnScreen: document.querySelector(" +
                        "'[data-action=\"restart-repair-intake\"]')" +
                        " !== null," +
                        "summary: MacroStudioState.getState()" +
                        ".intakeResult.summary" +
                        "})"));
            }

            // After a package has come in, restart the split intake and
            // take a corrected pair instead. The prior added module must
            // not leak into the replacement result.
            private async Task TakeAWholeAnswerInstead(
                Dictionary<string, object> report)
            {
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"restart-repair-intake\"]')" +
                    ".click();");
                await WaitFor(
                    "MacroStudioState.getState().splitOutput === true && " +
                    "MacroStudioScreens.countImported(" +
                    "MacroStudioState.getState()) === 0");
                await Execute(BuildPart(
                    0,
                    2,
                    "standard",
                    "AppController",
                    "Public Sub Boot(): Beep: End Sub",
                    true));
                await WaitFor(
                    "MacroStudioScreens.countIntakeParts(" +
                    "MacroStudioState.getState()) === 1");
                await Execute(BuildPart(
                    1,
                    2,
                    "standard",
                    "TimerUtils",
                    "Public Sub Tick(): Beep: End Sub",
                    false));
                await WaitFor(
                    "MacroStudioScreens.countImported(" +
                    "MacroStudioState.getState()) === 2");
                report.Add(
                    "afterWholeAnswer",
                    await ReadJson(
                        "JSON.stringify({" +
                        "imported: MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "canGoNext: MacroStudioState.canGoNext()," +
                        "reimportOnScreen: document.querySelector(" +
                        "'[data-action=\"import-repair\"]') !== null," +
                        "addedModuleGone: MacroStudioState.findModule(" +
                        "'CompatHelpers') === null," +
                        "horizontal: document.documentElement" +
                        ".scrollWidth > innerWidth" +
                        "})"));
            }

            private string BuildPartExpression(
                int index,
                int total,
                string kind,
                string name,
                string body,
                bool withSummary)
            {
                string summary = withSummary
                    ? "api.summaryBeginLine(id), 'two modules changed', " +
                      "api.summaryEndLine(id), "
                    : string.Empty;

                return "var id = MacroStudioState.getState()" +
                    ".repairRequestId;" +
                    "var api = MacroStudioResponse;" +
                    "var taken = MacroStudioWorkflow.applyRepairText([" +
                    summary +
                    "api.partLine(id, " + index.ToString() + ", " +
                    total.ToString() + ")," +
                    "api.beginLine(id, '" + kind + "', '" + name + "')," +
                    "'Option Explicit'," +
                    "'" + body + "'," +
                    "api.endLine(id, '" + kind + "', '" + name + "')," +
                    "api.completeLine(id, 1)" +
                    "].join('\\r\\n'));";
            }

            private string BuildPart(
                int index,
                int total,
                string kind,
                string name,
                string body,
                bool withSummary)
            {
                return "(function(){" +
                    BuildPartExpression(
                        index,
                        total,
                        kind,
                        name,
                        body,
                        withSummary) +
                    "return taken;}());";
            }

            private async Task ClickNext(int expectedScreen)
            {
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"go-next\"]').click();");
                if (expectedScreen >= 0)
                {
                    await WaitFor(
                        "MacroStudioState.getState().screen === " +
                        expectedScreen.ToString());
                }
            }

            private async Task Execute(string script)
            {
                await webView.CoreWebView2.ExecuteScriptAsync(script);
            }

            private async Task<string> ReadJson(string expression)
            {
                string raw =
                    await webView.CoreWebView2.ExecuteScriptAsync(
                        "String(" + expression + ")");
                return serializer.Deserialize<string>(raw);
            }

            private async Task<bool> ReadBool(string expression)
            {
                string raw =
                    await webView.CoreWebView2.ExecuteScriptAsync(
                        "Boolean(" + expression + ")");
                return raw == "true";
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
                    "The split output condition timed out: " +
                    expression);
            }

            private void OnTimeout(object sender, EventArgs e)
            {
                Fail(new TimeoutException(
                    "The split output smoke test timed out."));
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
                        if (webView.CoreWebView2 != null &&
                            router != null)
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
