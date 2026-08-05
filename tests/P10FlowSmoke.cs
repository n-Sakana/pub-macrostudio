using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace MacroStudio.Tests
{
    // Walks the ten screens against the real host: one workbook in,
    // one run folder out.
    public static class P10FlowSmoke
    {
        public static string Run(
            string baseDir,
            string bookPath,
            string cacheDir,
            string lightScreenshot,
            string darkScreenshot)
        {
            return RunCore(
                baseDir,
                bookPath,
                cacheDir,
                lightScreenshot,
                darkScreenshot,
                false,
                false,
                "-");
        }

        // The same walk, with the finding naming a constraint from the
        // target environment instead of naming none. That is what puts a
        // category and an occurrence count on the findings screen, so a
        // guide sample can be driven through the grouping it belongs to.
        public static string RunWithEnvironmentKey(
            string baseDir,
            string bookPath,
            string cacheDir,
            string lightScreenshot,
            string darkScreenshot,
            string environmentKey)
        {
            return RunCore(
                baseDir,
                bookPath,
                cacheDir,
                lightScreenshot,
                darkScreenshot,
                false,
                false,
                environmentKey);
        }

        internal static string RunDiagnosisOnly(
            string baseDir,
            string bookPath,
            string cacheDir,
            string lightScreenshot,
            string darkScreenshot)
        {
            return RunCore(
                baseDir,
                bookPath,
                cacheDir,
                lightScreenshot,
                darkScreenshot,
                true,
                false,
                "-");
        }

        internal static string RunPathMap(
            string baseDir,
            string bookPath,
            string cacheDir,
            string lightScreenshot,
            string darkScreenshot)
        {
            return RunCore(
                baseDir,
                bookPath,
                cacheDir,
                lightScreenshot,
                darkScreenshot,
                false,
                true,
                "-");
        }

        private static string RunCore(
            string baseDir,
            string bookPath,
            string cacheDir,
            string lightScreenshot,
            string darkScreenshot,
            bool diagnosisOnly,
            bool pathMap,
            string environmentKey)
        {
            SmokeRunner runner = new SmokeRunner(
                baseDir,
                bookPath,
                cacheDir,
                lightScreenshot,
                darkScreenshot,
                diagnosisOnly,
                pathMap,
                environmentKey);
            Thread thread = new Thread(runner.Run);
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();

            if (!thread.Join(120000))
            {
                throw new TimeoutException(
                    "The flow smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The flow smoke test failed.",
                    runner.Error);
            }
            return runner.Result;
        }

        private sealed class SmokeRunner
        {
            private readonly string baseDir;
            private readonly string bookPath;
            private readonly string cacheDir;
            private readonly string lightScreenshot;
            private readonly string darkScreenshot;
            private readonly bool diagnosisOnly;
            private readonly bool pathMap;
            private readonly string envKey;

            private Application application;
            private Window window;
            private WebView2 webView;
            private MessageRouter router;
            private DispatcherTimer timeoutTimer;
            private JavaScriptSerializer serializer;
            private IDataObject originalClipboard;
            private bool clipboardCaptured;
            private int clipboardRetryCount;
            private const int AiHandoffYieldMilliseconds = 1000;
            private const int ClipboardPublishYieldMilliseconds = 250;
            private readonly List<string> clipboardOwners =
                new List<string>();

            public string Result;
            public Exception Error;

            public SmokeRunner(
                string baseDir,
                string bookPath,
                string cacheDir,
                string lightScreenshot,
                string darkScreenshot,
                bool diagnosisOnly,
                bool pathMap,
                string environmentKey)
            {
                this.envKey = string.IsNullOrEmpty(environmentKey)
                    ? "-"
                    : environmentKey;
                this.baseDir = Path.GetFullPath(baseDir);
                this.bookPath = Path.GetFullPath(bookPath);
                this.cacheDir = Path.GetFullPath(cacheDir);
                this.lightScreenshot = Path.GetFullPath(lightScreenshot);
                this.darkScreenshot = Path.GetFullPath(darkScreenshot);
                this.diagnosisOnly = diagnosisOnly;
                this.pathMap = pathMap;
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
                    // The size the operator's machine was checked at.
                    // MACROSTUDIO_SMOKE_WINDOW=4x3 asks for the size the
                    // product actually opens at instead, so the same walk
                    // can produce evidence at the shipped proportion.
                    window.Width = 1366;
                    window.Height = 768;
                    if (Environment.GetEnvironmentVariable(
                        "MACROSTUDIO_SMOKE_WINDOW") == "4x3")
                    {
                        window.Width = 1120;
                        window.Height = 840;
                    }
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
                    timeoutTimer.Interval = TimeSpan.FromSeconds(100);
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
                        "The flow test page navigation failed."));
                    return;
                }

                try
                {
                    Dictionary<string, object> result =
                        new Dictionary<string, object>();
                    Dictionary<string, object> eventData =
                        new Dictionary<string, object>();
                    string repairId = null;
                    string repairPrompt = null;

                    await WaitFor(
                        "MacroStudioState.getState().appInfo !== null && " +
                        "MacroStudioState.getState().appInfo.catalog");
                    // Screen 0: the workbook. Nothing stands in front of
                    // it, so [次へ] is shut until one is read.
                    result.Add("initial", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "book:MacroStudioState.getState().book !== null," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled," +
                        "entrances:document.querySelectorAll(" +
                        "'[data-action=\"select-entrance\"]').length," +
                        // The change scope is in force before anything is
                        // chosen, because a run with no answer to "how far
                        // may this change" is a run with nothing to
                        // enforce.
                        "scope:MacroStudioState.getState().changeScope" +
                        ".structure," +
                        "visibleEntries:document.querySelectorAll(" +
                        "'[data-action=\"select-mode\"]," +
                        "[data-action=\"select-purpose\"]').length" +
                        "})"));
                    result.Add("startShell", await ReadShell());

                    eventData.Add("path", bookPath);
                    router.PushEvent("bookDropped", eventData);
                    await WaitFor(
                        "MacroStudioState.getState().book !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("book", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "modules:MacroStudioState.getState().modules.length," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled," +
                        "readDisclosure:document.querySelectorAll(" +
                        "'[data-disclosure-key=\"book-read-result\"]')" +
                        ".length" +
                        "})"));

                    await Next();
                    await WaitFor(
                        "MacroStudioState.getState().screen === 1 && " +
                        "MacroStudioState.getState().diagnosisRequestId !== null && " +
                        "MacroStudioState.getState().targetEnvironment !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    string diagnosisId = serializer.Deserialize<string>(
                        await ReadJson(
                            "MacroStudioState.getState().diagnosisRequestId"));
                    string runFolder = serializer.Deserialize<string>(
                        await ReadJson(
                            "MacroStudioState.getState().runFolder"));
                    result.Add("diagnosisId", diagnosisId);
                    result.Add("runFolder", runFolder);
                    result.Add("diagnoseRequest", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "environment:document.querySelectorAll(" +
                        "'[data-disclosure-box=\"diagnose-environment\"]')" +
                        ".length," +
                        "copy:document.querySelectorAll(" +
                        "'[data-action=\"copy-diagnosis-prompt\"]').length," +
                        "open:document.querySelectorAll(" +
                        "'[data-action=\"open-diagnosis-folder\"]').length," +
                        "importAction:document.querySelectorAll(" +
                        "'[data-action=\"import-diagnosis\"]').length," +
                        "splitOption:document.querySelectorAll(" +
                        "'[data-workflow-input=\"diagnosis-split\"]').length," +
                        "requestFile:document.body.textContent" +
                        ".indexOf('source-code-for-ai.md') >= 0," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                    await Capture(lightScreenshot);
                    await Shot("01-diagnose-request");

                    CaptureClipboard();
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"copy-diagnosis-prompt\"]')" +
                        ".click();");
                    await WaitFor(
                        "MacroStudioState.getState()" +
                        ".diagnosisPromptCopied === true");
                    string diagnosisPrompt = ReadClipboardText();
                    await Execute(
                        "MacroStudioState.setDiagnosisHandoffProgress(" +
                        "null,true);");
                    // Handing the request over is not a screen of its own
                    // any more. The same screen takes the reply back, and
                    // [次へ] stays closed until a diagnosis has arrived.
                    await WaitFor(
                        "document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled");
                    await WaitForScreen(1);

                    string marker = "'@MACROSTUDIO " + diagnosisId + " ";
                    string diagnosisResponse;
                    // The finding has to name a module this workbook
                    // actually has, and a line that module actually has,
                    // or the package is rejected before it reaches a
                    // screen. Reading both from the attached book is what
                    // lets any workbook be driven through here.
                    string firstModule = serializer.Deserialize<string>(
                        await ReadJson(
                            "(MacroStudioState.getState().modules" +
                            ".filter(function (m) {" +
                            "return m.lineCount > 0;" +
                            "})[0] || MacroStudioState.getState()" +
                            ".modules[0]).name"));
                    if (pathMap)
                    {
                        diagnosisResponse =
                            marker + "DIAG BEGIN 0\r\n" +
                            marker + "SECTION BEGIN PURPOSE\r\n" +
                            "The workbook exposes a monthly report.\r\n" +
                            marker + "SECTION END PURPOSE\r\n" +
                            marker + "SECTION BEGIN FLOW\r\n" +
                            "The report reads source sheets and writes reports.\r\n" +
                            marker + "SECTION END FLOW\r\n" +
                            marker + "SECTION BEGIN DEPENDENCY\r\n" +
                            "No repair finding is needed for this route.\r\n" +
                            marker + "SECTION END DEPENDENCY\r\n" +
                            marker + "SECTION BEGIN ENVIRONMENT\r\n" +
                            "The attached source was inspected.\r\n" +
                            marker + "SECTION END ENVIRONMENT\r\n" +
                            marker + "DIAG NOFINDING SCOPE_CLEAR\r\n" +
                            marker + "DIAG COMPLETE 0\r\n" +
                            marker + "DIAG END\r\n";
                    }
                    else
                    {
                        diagnosisResponse =
                        marker + "DIAG BEGIN 1\r\n" +
                        marker + "SECTION BEGIN PURPOSE\r\n" +
                        "The workbook exposes one test entry point.\r\n" +
                        marker + "SECTION END PURPOSE\r\n" +
                        marker + "SECTION BEGIN FLOW\r\n" +
                        firstModule + " holds the visible flow.\r\n" +
                        marker + "SECTION END FLOW\r\n" +
                        marker + "SECTION BEGIN DEPENDENCY\r\n" +
                        "No external dependency is needed for this fixture.\r\n" +
                        marker + "SECTION END DEPENDENCY\r\n" +
                        marker + "SECTION BEGIN ENVIRONMENT\r\n" +
                        "The finding is based on the attached source.\r\n" +
                        marker + "SECTION END ENVIRONMENT\r\n" +
                        marker + "FINDING BEGIN 1\r\n" +
                        marker + "META GRADE=B CONFIDENCE=CONFIRMED " +
                        "MODULE=" + firstModule + " PROC=- LINES=1 " +
                        "ENVKEY=" + envKey + "\r\n" +
                        marker + "TEXT BEGIN TITLE\r\n" +
                        "Finding for flow smoke\r\n" +
                        marker + "TEXT END TITLE\r\n" +
                        marker + "TEXT BEGIN CONDITION\r\n" +
                        "The Test entry point is run.\r\n" +
                        marker + "TEXT END CONDITION\r\n" +
                        marker + "TEXT BEGIN IMPACT\r\n" +
                        "The requested visible effect is absent.\r\n" +
                        marker + "TEXT END IMPACT\r\n" +
                        marker + "TEXT BEGIN EVIDENCE\r\n" +
                        "The procedure body is empty on line 2.\r\n" +
                        marker + "TEXT END EVIDENCE\r\n" +
                        marker + "FINDING END 1\r\n" +
                        marker + "DIAG COMPLETE 1\r\n" +
                        marker + "DIAG END\r\n";
                    }
                    await SetClipboardAfterHandoff(diagnosisResponse);
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"import-diagnosis\"]').click();");
                    await WaitFor(
                        "MacroStudioState.getState().diagnosis !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("diagnosis", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "findings:MacroStudioState.getState()" +
                        ".diagnosis.findings.length," +
                        "version:MacroStudioState.getState()" +
                        ".diagnosisVersion," +
                        "recorded:MacroStudioState.getState()" +
                        ".diagnosisFilePath !== null," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));

                    await Next();
                    await WaitForScreen(2);
                    result.Add("findings", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "findingRows:document.querySelectorAll(" +
                        "'.group-row').length," +
                        "occurrenceRows:document.querySelectorAll(" +
                        "'.occurrence-row').length," +
                        "presetCards:document.querySelectorAll(" +
                        "'[data-action=\"select-repair-preset\"]').length," +
                        "oldEntries:document.querySelectorAll(" +
                        "'[data-action=\"select-mode\"]," +
                        "[data-action=\"select-purpose\"]').length," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                    await Shot("02-verdict");
                    // Reading the diagnosis and choosing the work are two
                    // pages now.
                    await Next();
                    await WaitForScreen(3);
                    await WaitFor(
                        "document.querySelector(" +
                        "'[data-action=\"select-repair-preset\"]') !== null");
                    result.Add("nextStep", await ReadJson(
                        "(function(){" +
                        "var cards=document.querySelectorAll(" +
                        "'[data-action=\"select-repair-preset\"]');" +
                        "return {" +
                        "screen:MacroStudioState.getState().screen," +
                        "presetCards:cards.length," +
                        "recommended:document.querySelectorAll(" +
                        "'.choice-card.is-recommended').length," +
                        "firstCard:cards.length ? cards[0]" +
                        ".getAttribute('data-preset-file') : ''," +
                        "headings:document.querySelectorAll(" +
                        "'.category-heading').length," +
                        "scopeOptions:document.querySelectorAll(" +
                        "'.mode-switch-option').length," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled};}())"));
                    await Shot("03-nextstep-and-scope");
                    await ShotAt("03b-change-scope", ".change-scope");
                    // The diagnosis may point at a template, and the
                    // screen arrives with that one already ticked. This
                    // walk is one route on purpose, so it unticks
                    // everything first and then ticks the one it means.
                    // Leaving an extra tick in place makes it the
                    // combined route, where the replacement runs first.
                    await Execute(
                        "(function(){" +
                        "function ticked(){" +
                        "return Array.prototype.slice.call(" +
                        "document.querySelectorAll(" +
                        "'[data-action=\"select-repair-preset\"]" +
                        "[aria-checked=\"true\"]'));}" +
                        "var open=ticked();" +
                        "var guard=0;" +
                        "while(open.length>0&&guard<20){" +
                        "open[0].click();open=ticked();guard++;}}())");
                    await WaitFor(
                        "MacroStudioState.getState().presetFiles" +
                        ".length === 0");
                    await Execute(
                        "(function(){" +
                        "var state=MacroStudioState.getState();" +
                        // Every run is offered the whole folder.
                        "var entries=state.appInfo.catalog.repair;" +
                        // With the table, the one that asks for it;
                        // without, the first that asks the chat instead.
                        "var wanted=entries.filter(function(entry){" +
                        "return entry.valid&&(" +
                        (pathMap ? "entry.replaceRules" : "!entry.replaceRules") +
                        ");})[0];" +
                        "var cards=Array.prototype.slice.call(" +
                        "document.querySelectorAll(" +
                        "'[data-action=\"select-repair-preset\"]'));" +
                        "cards.filter(function(card){return " +
                        "card.getAttribute('data-preset-file')===" +
                        "wanted.file;})[0].click();}())");
                    await WaitFor(
                        "MacroStudioState.getState().presetFile !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("preset", await ReadJson(
                        "({" +
                        // The change scope is chosen on the same screen,
                        // but it is a mode switch rather than a card now,
                        // so every selected card here is an operation.
                        "selected:document.querySelectorAll(" +
                        "'.choice-card.is-selected')" +
                        ".length," +
                        "engine:MacroStudioState.getState().presetEngine," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));

                    await Next();
                    await WaitForScreen(4);
                    if (pathMap)
                    {
                        result.Add("pathMapInitial", await ReadJson(
                            "(function(){" +
                            "var state=MacroStudioState.getState();" +
                            "return {" +
                            "screen:state.screen," +
                            "rows:state.pathMap.rows.length," +
                            "occurrences:MacroStudioPathMap" +
                            ".countOccurrences(state.pathMap)," +
                            "allUnapplied:state.pathMap.rows.every(" +
                            "function(row){return !row.applied;})," +
                            "includeChecks:document.querySelectorAll(" +
                            "'[data-workflow-input=\"path-map-include\"]')" +
                            ".length," +
                            "targetInputs:document.querySelectorAll(" +
                            "'[data-workflow-input=\"path-map-to\"]')" +
                            ".length," +
                            "nextReady:!document.querySelector(" +
                            "'[data-action=\"go-next\"]').disabled};}())"));
                        // A row the template ticked already shows its
                        // input; one it left unticked has to be included
                        // first. Both routes end at the same field.
                        await Execute(
                            "(function(){" +
                            "if(document.querySelector(" +
                            "'[data-workflow-input=\"path-map-to\"]')){" +
                            "return;}" +
                            "document.querySelector(" +
                            "'[data-workflow-input=\"path-map-include\"]')" +
                            ".click();}())");
                        await WaitFor(
                            "document.querySelector(" +
                            "'[data-workflow-input=\"path-map-to\"]')" +
                            " !== null");
                        await Execute(
                            "(function(){" +
                            "var input=document.querySelector(" +
                            "'[data-workflow-input=\"path-map-to\"]');" +
                            "input.value='mapped/';" +
                            "input.dispatchEvent(new Event(" +
                            "'input',{bubbles:true}));}())");
                        await WaitFor(
                            "MacroStudioPathMap.canApply(" +
                            "MacroStudioState.getState().pathMap) && " +
                            "!document.querySelector(" +
                            "'[data-action=\"go-next\"]').disabled");
                        result.Add("pathMapReady", await ReadJson(
                            "(function(){" +
                            "var state=MacroStudioState.getState();" +
                            "var applied=state.pathMap.rows.filter(" +
                            "function(row){return row.applied;});" +
                            "return {applied:applied.length," +
                            "target:applied[0].to," +
                            "valid:applied[0].valid," +
                            "confirmed:applied[0]" +
                            ".locationShapeConfirmed," +
                            "nextReady:!document.querySelector(" +
                            "'[data-action=\"go-next\"]').disabled};}())"));
                        await Next();
                        await WaitFor(
                            "MacroStudioState.getState().screen === 6 && " +
                            "MacroStudioState.getState().intakeResult && " +
                            "MacroStudioState.getState().intakeResult" +
                            ".mapping.rows.length === 1");
                        result.Add("pathApplied", await ReadJson(
                            "(function(){" +
                            "var state=MacroStudioState.getState();" +
                            "return {" +
                            "screen:state.screen," +
                            "mappingRows:state.intakeResult.mapping.rows.length," +
                            "repairRequest:state.repairRequestId," +
                            "changed:MacroStudioState" +
                            ".getAcceptedModuleCount()};}())"));
                    }
                    else
                    {
                    // A blocking finding starts selected, so this screen
                    // opens ready. Nothing further is asked per finding.
                    result.Add("repairInputEmpty", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "findingChecks:document.querySelectorAll(" +
                        "'[data-workflow-input=\"finding-group-select\"]')" +
                        ".length," +
                        "preselected:MacroStudioState.getState()" +
                        ".selectedFindings.length," +
                        "removedForms:document.querySelectorAll(" +
                        "'[data-workflow-input=\"desired-behaviour\"]," +
                        "[data-workflow-input=\"finding-supplement\"]," +
                        "[data-action=\"choose-behaviour-candidate\"]')" +
                        ".length," +
                        "requestFiles:document.querySelectorAll(" +
                        "'[data-disclosure-box=\"repair-files\"]').length," +
                        "preserveItems:document.querySelectorAll(" +
                        "'.preserve-items').length," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                    result.Add("repairInput", await ReadJson(
                        "({" +
                        "selected:MacroStudioState.getState()" +
                        ".selectedFindings.length," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                    await Shot("04-repair-input");

                    await Next();
                    await WaitFor(
                        "MacroStudioState.getState().screen === 5 && " +
                        "MacroStudioState.getState().repairRequestId !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    repairId = serializer.Deserialize<string>(
                        await ReadJson(
                            "MacroStudioState.getState().repairRequestId"));
                    result.Add("repairId", repairId);
                    result.Add("repairRequest", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "copy:document.querySelectorAll(" +
                        "'[data-action=\"copy-repair-prompt\"]').length," +
                        "requestFile:document.body.textContent" +
                        ".indexOf('source-code-for-ai.md') >= 0," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                    await Shot("05-repair-request");
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"copy-repair-prompt\"]').click();");
                    await WaitFor(
                        "MacroStudioState.getState()" +
                        ".repairPromptCopied === true");
                    repairPrompt = ReadClipboardText();
                    if (diagnosisOnly)
                    {
                        await Task.Delay(AiHandoffYieldMilliseconds);
                        result.Add("repairShell", await ReadShell());
                        await Capture(darkScreenshot, true);
                        result.Add("diagnosisPromptReady",
                            diagnosisPrompt.Contains(diagnosisId) &&
                            diagnosisPrompt.Contains("source-code-for-ai.md"));
                        result.Add("repairPromptReady",
                            repairPrompt.Contains(repairId) &&
                            repairPrompt.Contains(
                                "Finding for flow smoke"));
                        result.Add("idsDistinct",
                            !string.Equals(
                                diagnosisId,
                                repairId,
                                StringComparison.Ordinal));
                        result.Add(
                            "clipboardRetries",
                            clipboardRetryCount);
                        result.Add("clipboardOwners", clipboardOwners);
                        Result = serializer.Serialize(result);
                        Stop();
                        return;
                    }
                    await Execute(
                        "MacroStudioState.setRepairHandoffProgress(" +
                        "null,true);");
                    // As with the diagnosis, the repair hand-off and the
                    // import share one screen: [次へ] opens on the answer
                    // arriving, not on the request going out.
                    await WaitFor(
                        "document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled");
                    await WaitForScreen(5);
                    await SetClipboardAfterHandoff(
                        "not a MacroStudio answer");
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"import-repair\"]').click();");
                    await WaitFor(
                        "MacroStudioState.getState().lastError !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("refused", await ReadJson(
                        "({" +
                        "imported:MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled," +
                        "code:MacroStudioState.getState().lastError.code" +
                        "})"));
                    await Shot("06-refused-intake");

                    marker = "'@MACROSTUDIO " + repairId + " ";
                    // The module comes back as it was read with one line
                    // added, which is what a repair to one place looks
                    // like. Replacing it with two lines instead was a
                    // stand-in that deleted every procedure in it - a
                    // change of shape the default scope refuses, and
                    // rightly. The template this walk chose declares that
                    // it adds a standard module, so the new one below is
                    // within what was asked for.
                    string firstModuleCode = serializer.Deserialize<string>(
                        await ReadJson(
                            "MacroStudioState.getState().modules.filter(" +
                            "function(m){return m.name===" +
                            serializer.Serialize(firstModule) +
                            ";})[0].code"))
                        .TrimEnd('\r', '\n');
                    string repairResponse =
                        marker + "SUMMARY BEGIN\r\n" +
                        firstModule + " now has a visible test effect.\r\n" +
                        "FlowSmokeHelpers was added for the flow smoke.\r\n" +
                        marker + "SUMMARY END\r\n" +
                        marker + "BEGIN standard " + firstModule + "\r\n" +
                        firstModuleCode + "\r\n" +
                        "' touched by the flow smoke\r\n" +
                        marker + "END standard " + firstModule + "\r\n" +
                        marker + "BEGIN standard FlowSmokeHelpers\r\n" +
                        "Option Explicit\r\n" +
                        "Public Sub Touch(): Debug.Print \"flow\": End Sub\r\n" +
                        marker + "END standard FlowSmokeHelpers\r\n" +
                        marker + "COMPLETE 2\r\n";
                    await SetClipboardAfterHandoff(repairResponse);
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"import-repair\"]').click();");
                    await WaitFor(
                        "MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState()) === 2 && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("intake", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "imported:MacroStudioScreens.countImported(" +
                        "MacroStudioState.getState())," +
                        "accepted:MacroStudioState" +
                        ".getAcceptedModuleCount()," +
                        "total:MacroStudioState.getState()" +
                        ".intakeResult.total," +
                        "existing:MacroStudioState.getState()" +
                        ".intakeResult.existing," +
                        "added:MacroStudioState.getState()" +
                        ".intakeResult.added," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));

                    await Next();
                    await WaitForScreen(6);
                    }
                    result.Add("review", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "headline:document.querySelector(" +
                        "'.headline-card').textContent," +
                        "closed:document.querySelector(" +
                        "'[data-disclosure-box=\"change-detail\"]')" +
                        ".getAttribute('data-open')," +
                        "accepted:MacroStudioState" +
                        ".getAcceptedModuleCount()," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                    // The change arrives open: this screen exists to be
                    // looked at. Closing and reopening it proves the
                    // control still works both ways.
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"toggle-disclosure\"]" +
                        "[data-disclosure=\"change-detail\"]').click();");
                    await WaitFor(
                        "document.querySelector(" +
                        "'[data-disclosure-box=\"change-detail\"]')" +
                        ".getAttribute('data-open') === 'false'");
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"toggle-disclosure\"]" +
                        "[data-disclosure=\"change-detail\"]').click();");
                    await WaitFor(
                        "document.querySelector(" +
                        "'[data-disclosure-box=\"change-detail\"]')" +
                        ".getAttribute('data-open') === 'true' && " +
                        "document.querySelectorAll('.diff-row').length > 0");
                    result.Add("diff", await ReadJson(
                        "({" +
                        "tree:document.querySelectorAll(" +
                        "'.module-pane [data-action=\"select-module\"]')" +
                        ".length," +
                        "groups:document.querySelectorAll(" +
                        "'.module-group-title').length," +
                        "markers:document.querySelectorAll(" +
                        "'.diff-marker').length," +
                        "rows:document.querySelectorAll('.diff-row').length," +
                        "twoColumn:document.querySelectorAll(" +
                        "'.diff-code--left,.diff-code--right').length" +
                        "})"));
                    await Capture(darkScreenshot, true);

                    await Next();
                    await WaitForScreen(7);
                    result.Add("output", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "name:document.getElementById('output-name').value," +
                        "files:Array.prototype.map.call(" +
                        "document.querySelectorAll('.artifact-chip')," +
                        "function(node){return node.textContent;})," +
                        "nextReady:!document.querySelector(" +
                        "'[data-action=\"go-next\"]').disabled" +
                        "})"));
                    string outputName = serializer.Deserialize<string>(
                        await ReadJson(
                            "document.getElementById('output-name').value"));
                    result.Add("outputName", outputName);

                    await Next();
                    await WaitFor(
                        "MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.doneScreen && " +
                        "MacroStudioState.getState().busyAction === null");
                    result.Add("done", await ReadJson(
                        "({" +
                        "screen:MacroStudioState.getState().screen," +
                        "status:MacroStudioState.getState()" +
                        ".buildResult.status," +
                        "outputPath:MacroStudioState.getState()" +
                        ".buildResult.outputPath," +
                        "diffPath:MacroStudioState.getState()" +
                        ".buildResult.diffPath," +
                        "resultPath:MacroStudioState.getState()" +
                        ".buildResult.resultPath," +
                        "rows:Array.prototype.map.call(" +
                        "document.querySelectorAll('.result-row code')," +
                        "function(node){return node.textContent;})," +
                        "openButtons:document.querySelectorAll(" +
                        "'[data-action=\"open-run-folder\"]').length" +
                        "})"));
                    // The button is pressed, not merely counted. It was
                    // wired to nothing and its handler called a state
                    // function that no longer exists, and neither the
                    // count nor a screenshot could show that.
                    //
                    // The request is recorded instead of performed. The
                    // host's own RevealPath is covered by
                    // test-hostservices.ps1, and letting it run here opens
                    // Explorer on a folder this test deletes on the way
                    // out, which leaves the reader an OS error box.
                    await Execute(
                        "(function(){window.__revealed=null;" +
                        "var real=window.hostBridge.request;" +
                        "window.hostBridge.request=function(action,params){" +
                        "if(action==='revealPath'){" +
                        "window.__revealed=params.path;" +
                        "return Promise.resolve({});}" +
                        "return real.call(this,action,params);};}());");
                    await Execute(
                        "document.querySelector(" +
                        "'[data-action=\"open-run-folder\"]').click();");
                    await WaitFor(
                        "MacroStudioState.getState().busyAction === null && " +
                        "window.__revealed !== null");
                    result.Add("openFolder", await ReadJson(
                        "({" +
                        "error:MacroStudioState.getState().lastError," +
                        "revealed:window.__revealed," +
                        "stillEnabled:!document.querySelector(" +
                        "'[data-action=\"open-run-folder\"]').disabled" +
                        "})"));
                    result.Add("finalShell", await ReadShell());
                    if (pathMap)
                    {
                        result.Add("pathBuildContract", await ReadJson(
                            "(function(){" +
                            "var state=MacroStudioState.getState();" +
                            "var rows=state.intakeResult.mapping.rows;" +
                            "return {" +
                            "mappingRows:rows.length," +
                            "targetMapped:rows[0].to==='mapped/'," +
                            "count:rows[0].count," +
                            "locations:rows[0].occurrences.length," +
                            "repairRequestCreated:" +
                            "state.repairRequestId!==null," +
                            "repairRequestFile:" +
                            "state.repairRequestFilePath!==null," +
                            "engineIsAi:state.repairResultEngine==='AI'" +
                            "};}())"));
                    }

                    string diffPath = serializer.Deserialize<string>(
                        await ReadJson(
                            "MacroStudioState.getState()" +
                            ".buildResult.diffPath"));
                    await NavigateTo(diffPath);
                    await WaitFor(
                        "document.readyState === 'complete' && " +
                        "document.querySelectorAll('.diff-row').length > 0");
                    result.Add("report", await ReadJson(
                        "({" +
                        "modules:document.querySelectorAll(" +
                        "'.module-item').length," +
                        "markers:document.querySelectorAll(" +
                        "'.diff-marker').length," +
                        "editable:document.querySelectorAll(" +
                        "'textarea,input,[contenteditable]').length," +
                        "external:document.querySelectorAll(" +
                        "'link[href],script[src],img[src]').length" +
                        "})"));

                    result.Add("diagnosisPromptReady",
                        diagnosisPrompt.Contains(diagnosisId) &&
                        diagnosisPrompt.Contains("source-code-for-ai.md"));
                    if (!pathMap)
                    {
                        result.Add("repairPromptReady",
                            repairPrompt.Contains(repairId) &&
                            repairPrompt.Contains(
                                "Finding for flow smoke"));
                        result.Add("idsDistinct",
                            !string.Equals(
                                diagnosisId,
                                repairId,
                                StringComparison.Ordinal));
                    }
                    result.Add("clipboardRetries", clipboardRetryCount);
                    result.Add("clipboardOwners", clipboardOwners);
                    Result = serializer.Serialize(result);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            // Every screen keeps the footer visible and the page free
            // of scrollbars.
            private async Task<string> ReadShell()
            {
                return await ReadJson(
                    "(function(){" +
                    "var nav=document.querySelector('.nav-actions');" +
                    "var box=nav.getBoundingClientRect();" +
                    "return {" +
                    "documentScrollY:document.documentElement" +
                    ".scrollHeight>innerHeight," +
                    "documentScrollX:document.documentElement" +
                    ".scrollWidth>innerWidth," +
                    "footerVisible:box.bottom<=innerHeight+1&&" +
                    "box.top>=0," +
                    "buttons:nav.querySelectorAll('.button').length," +
                    "sameWidth:Math.abs(" +
                    "nav.children[0].getBoundingClientRect().width-" +
                    "nav.children[1].getBoundingClientRect().width)<1," +
                    "progress:document.querySelectorAll(" +
                    "'.progress-step').length," +
                    "progressSlots:document.querySelectorAll(" +
                    "'#progress-list > li').length" +
                    "};}())");
            }

            private async Task NavigateTo(string path)
            {
                TaskCompletionSource<bool> ready =
                    new TaskCompletionSource<bool>();
                EventHandler<CoreWebView2NavigationCompletedEventArgs>
                    handler = null;

                handler = delegate(
                    object sender,
                    CoreWebView2NavigationCompletedEventArgs args)
                {
                    webView.CoreWebView2.NavigationCompleted -= handler;
                    ready.TrySetResult(args.IsSuccess);
                };
                webView.CoreWebView2.NavigationCompleted += handler;
                webView.CoreWebView2.Navigate(
                    new Uri(path).AbsoluteUri);
                if (!await ready.Task)
                {
                    throw new InvalidOperationException(
                        "The report navigation failed: " + path);
                }
            }

            private async Task Next()
            {
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"go-next\"]').click();");
            }

            private async Task Back()
            {
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"go-back\"]').click();");
            }

            private async Task WaitForScreen(int index)
            {
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    index.ToString() + " && " +
                    "MacroStudioState.getState().busyAction === null");
            }

            private void CaptureClipboard()
            {
                if (clipboardCaptured)
                {
                    return;
                }
                RunClipboardOperation(
                    "The flow test clipboard could not be captured.",
                    delegate()
                    {
                        originalClipboard = MaterializeClipboard(
                            Clipboard.GetDataObject());
                    });
                clipboardCaptured = true;
            }

            private static IDataObject MaterializeClipboard(
                IDataObject source)
            {
                if (source == null)
                {
                    return null;
                }
                DataObject snapshot = new DataObject();
                string[] formats = source.GetFormats(false);
                foreach (string format in formats)
                {
                    object value = source.GetData(format, false);
                    if (value != null)
                    {
                        snapshot.SetData(format, value, false);
                    }
                }
                return snapshot;
            }

            private string ReadClipboardText()
            {
                string text = null;
                RunClipboardOperation(
                    "The flow test clipboard could not be read.",
                    delegate()
                    {
                        text = Clipboard.GetText();
                    });
                return text;
            }

            private void RunClipboardOperation(
                string errorMessage,
                Action operation)
            {
                List<string> operationOwners = new List<string>();
                try
                {
                    ClipboardRetry.Execute(
                        "E-TEST",
                        errorMessage,
                        operation,
                        Thread.Sleep,
                        ClipboardRetry.InspectOpenClipboardOwner,
                        delegate(
                            int retryCount,
                            bool succeeded,
                            IList<string> owners)
                        {
                            clipboardRetryCount += retryCount;
                            operationOwners.AddRange(owners);
                            clipboardOwners.AddRange(owners);
                        });
                }
                catch (HostActionException ex)
                {
                    throw new HostActionException(
                        "E-TEST",
                        errorMessage + " Owners: " +
                        (operationOwners.Count == 0
                            ? "none observed"
                            : string.Join(", ", operationOwners)),
                        null,
                        ex.InnerException == null
                            ? ex
                            : ex.InnerException);
                }
            }

            private void SetClipboard(string text)
            {
                CaptureClipboard();
                RunClipboardOperation(
                    "The flow test clipboard could not be updated.",
                    delegate()
                    {
                        Clipboard.SetText(text);
                    });
            }

            private async Task SetClipboardAfterHandoff(string text)
            {
                // A real AI handoff yields the UI thread between the previous
                // prompt copy and the next answer copy. Let clipboard history
                // materialize that data without extending the bounded retry
                // contract used by either clipboard operation.
                await Task.Delay(AiHandoffYieldMilliseconds);
                SetClipboard(text);
                await Task.Delay(ClipboardPublishYieldMilliseconds);
            }

            private void RestoreClipboard()
            {
                if (!clipboardCaptured)
                {
                    return;
                }
                RunClipboardOperation(
                    "The flow test clipboard could not be restored.",
                    delegate()
                    {
                        if (originalClipboard != null)
                        {
                            Clipboard.SetDataObject(
                                originalClipboard,
                                true);
                        }
                        else
                        {
                            Clipboard.Clear();
                        }
                    });
                clipboardCaptured = false;
            }

            private void CaptureClipboardRetryFailure(Exception error)
            {
                if (Error == null)
                {
                    Error = error;
                }
            }

            private async Task Capture(string path, bool dark)
            {
                if (dark)
                {
                    await Execute(
                        "document.getElementById('theme-toggle')" +
                        ".click();");
                    await Task.Delay(150);
                }
                using (FileStream stream = new FileStream(
                    path,
                    FileMode.Create,
                    FileAccess.Write,
                    FileShare.None))
                {
                    await webView.CoreWebView2.CapturePreviewAsync(
                        CoreWebView2CapturePreviewImageFormat.Png,
                        stream);
                }
                if (dark)
                {
                    await Execute(
                        "document.getElementById('theme-toggle')" +
                        ".click();");
                    await Task.Delay(150);
                }
            }

            private async Task Capture(string path)
            {
                await Capture(path, false);
            }

            // Evidence for a person to look at, rather than for an
            // assertion to read. A count and a text search cannot see
            // two elements overlapping, a line of text clipped by its
            // box, or a heading that ended up smaller than the sentence
            // under it - and every one of those has shipped.
            //
            // Off unless MACROSTUDIO_SMOKE_SHOTS names a folder, so the
            // ordinary run of this test is unchanged.
            private async Task Shot(string name)
            {
                string folder = Environment.GetEnvironmentVariable(
                    "MACROSTUDIO_SMOKE_SHOTS");

                if (string.IsNullOrEmpty(folder))
                {
                    return;
                }
                if (!Directory.Exists(folder))
                {
                    Directory.CreateDirectory(folder);
                }
                // Long enough for the screen's enter transition to
                // finish. A frame caught halfway through it is a
                // half-faded page, which tells a reviewer nothing about
                // spacing and everything about timing.
                await Task.Delay(500);
                await Capture(Path.Combine(folder, name + ".png"), false);
            }

            // The same screen, scrolled so that a control below the fold
            // is in the frame. Evidence has to show the thing it is
            // evidence of.
            private async Task ShotAt(string name, string selector)
            {
                if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(
                    "MACROSTUDIO_SMOKE_SHOTS")))
                {
                    return;
                }
                await Execute(
                    "(function(){var target=document.querySelector('" +
                    selector + "');" +
                    "if(target){target.scrollIntoView(" +
                    "{block:'end'});}}());");
                await Shot(name);
                await Execute(
                    "(function(){var main=" +
                    "document.getElementById('main-content');" +
                    "if(main){main.scrollTop=0;}}());");
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
                // A condition that never came true is nearly always a
                // screen that did not arrive or an error that was shown
                // and not read, so say which screen and which error.
                throw new TimeoutException(
                    "The flow condition timed out: " + expression +
                    " | state=" + await ReadJson(
                        "JSON.stringify({" +
                        "screen:MacroStudioState.getState().screen," +
                        "busy:MacroStudioState.getState().busyAction," +
                        "actions:Array.prototype.map.call(" +
                        "document.querySelectorAll('[data-action]')," +
                        "function(n){return n.getAttribute('data-action');})," +
                        "error:MacroStudioState.getState().lastError})"));
            }

            private void OnTimeout(object sender, EventArgs e)
            {
                Fail(new TimeoutException(
                    "The flow smoke test timed out."));
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
                    RestoreClipboard();
                }
                catch (Exception ex)
                {
                    CaptureClipboardRetryFailure(ex);
                }
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
