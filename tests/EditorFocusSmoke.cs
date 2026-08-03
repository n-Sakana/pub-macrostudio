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
    // Types into every box the flow offers, in the real runtime, and
    // watches the box itself rather than the value.
    //
    // The value was never the problem: a screen rebuilt from the state
    // shows the right characters. What a rebuild destroys is the box the
    // characters were going into - the node, and with it the caret, the
    // selection and any composition in progress. So each keystroke here
    // asks one question: is the element still the same object, and is it
    // still the focused one? A run where every answer is yes is a run
    // where a person could actually have typed the sentence.
    public static class EditorFocusSmoke
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
                    "The editor focus smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The editor focus smoke test failed.",
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
                        "The editor focus test page navigation failed."));
                    return;
                }

                try
                {
                    Dictionary<string, object> report =
                        new Dictionary<string, object>();

                    await WaitFor(
                        "MacroStudioState.getState().appInfo !== null");
                    await Execute(ProbeScript());

                    report.Add("ai", await RunAiInputs());
                    report.Add("mapping", await RunPathMapping());

                    Result = serializer.Serialize(report);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            // ---- second-AI input: the one free-text box that is left ----

            private async Task<string> RunAiInputs()
            {
                Dictionary<string, object> phase =
                    new Dictionary<string, object>();

                await StartOver();
                await AttachBook(bookPath);
                await ReachFindings(false);
                phase.Add("runFolder", await ReadJson(
                    "MacroStudioState.getState().runFolder"));
                await SelectPreset(false);
                await ClickNext();
                await WaitForScreen("repairInputScreen");
                await Execute(
                    "document.querySelector(" +
                    "'[data-action=\"toggle-workflow-disclosure\"]" +
                    "[data-disclosure-key=\"extra-request\"]')" +
                    ".click();");
                // The β1 disclosure opens by data-open on its box, and its
                // closed body is visibility:hidden rather than [hidden].
                // Wait for what the field actually needs: a field that is
                // still visibility:hidden cannot take the focus.
                await WaitFor(
                    "(function(){var box=document.querySelector(" +
                    "'[data-disclosure-box=\"extra-request\"]');" +
                    "var field=document.querySelector(" +
                    "'[data-workflow-input=\"extra-request\"]');" +
                    "return box !== null && field !== null && " +
                    "box.getAttribute('data-open') === 'true' && " +
                    "getComputedStyle(field).visibility === 'visible';}())");
                phase.Add("extra", await Probe(
                    "[data-workflow-input=\"extra-request\"]"));
                phase.Add("state", await ReadJson(
                    "(function(){var state=MacroStudioState.getState();" +
                    "return JSON.stringify({" +
                    "extra:state.extraRequest," +
                    "nextReady:!document.querySelector(" +
                    "'[data-action=\"go-next\"]').disabled});}())"));
                phase.Add("shell", await ReadJson(ShellShape()));
                return serializer.Serialize(phase);
            }

            // ---- fixed-path mapping value on the alternate screen 4 ----

            private async Task<string> RunPathMapping()
            {
                Dictionary<string, object> phase =
                    new Dictionary<string, object>();
                // A book with a real fixed path in it. The general
                // refactoring sample has none: it only ever produced
                // mapping rows because the old rules called a date
                // format picture a location (2026-08-03).
                string mappingBook = Path.Combine(
                    baseDir,
                    "testdata",
                    "guide-samples",
                    "S01_fixed_drive.xlsm");

                await StartOver();
                await AttachBook(mappingBook);
                await ReachFindings(true);
                phase.Add("runFolder", await ReadJson(
                    "MacroStudioState.getState().runFolder"));
                await SelectPreset(true);
                await ClickNext();
                await WaitForScreen("repairInputScreen");
                // A row the template ticked already shows its input; one
                // it left unticked has to be included first.
                await Execute(
                    "(function(){" +
                    "if(document.querySelector(" +
                    "'[data-workflow-input=\"path-map-to\"]')){return;}" +
                    "document.querySelector(" +
                    "'[data-workflow-input=\"path-map-include\"]')" +
                    ".click();}())");
                await WaitFor(
                    "document.querySelector(" +
                    "'[data-workflow-input=\"path-map-to\"]')" +
                    " !== null");
                phase.Add("value", await Probe(
                    "[data-workflow-input=\"path-map-to\"]"));
                phase.Add("state", await ReadJson(
                    "(function(){var rows=MacroStudioState.getState()" +
                    ".pathMap.rows.filter(function(row){" +
                    "return row.applied;});" +
                    "return JSON.stringify({" +
                    "applied:rows.length," +
                    "value:rows.length?rows[0].to:''," +
                    "nextReady:!document.querySelector(" +
                    "'[data-action=\"go-next\"]').disabled});}())"));
                phase.Add("shell", await ReadJson(ShellShape()));
                return serializer.Serialize(phase);
            }

            // ---- shared steps ----

            private async Task StartOver()
            {
                await Execute("MacroStudioState.reset();");
                // The app's own rediscovery: the raw folder listing is
                // described before it is stored, which is what puts the
                // entrances on the first screen.
                await Execute("MacroStudioApp.loadAppInfo();");
                await ChooseMacroRepair();
            }

            // The run says what it is for before it reads anything. This
            // walk is about the repair input, so it takes the entrance
            // that diagnoses and then offers a choice of template.
            private async Task ChooseMacroRepair()
            {
                await WaitFor(
                    "MacroStudioState.getState().appInfo !== null && " +
                    "document.querySelector('[data-entrance-folder=" +
                    "\"01_マクロ改修\"]') !== null");
                await Execute(
                    "document.querySelector('[data-entrance-folder=" +
                    "\"01_マクロ改修\"]').click();");
                await ClickNext();
                await WaitFor(
                    "MacroStudioState.getState().entrance !== null && " +
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.bookScreen");
            }

            private async Task AttachBook(string path)
            {
                Dictionary<string, object> eventData =
                    new Dictionary<string, object>();
                eventData.Add("path", path);
                router.PushEvent("bookDropped", eventData);
                await WaitFor(
                    "MacroStudioState.getState().book !== null && " +
                    "MacroStudioState.getState().busyAction === null");
            }

            private async Task ReachFindings(bool zero)
            {
                await ClickNext();
                await WaitFor(
                    "MacroStudioState.getState().screen === " +
                    "MacroStudioScreens.diagnoseScreen && " +
                    "MacroStudioState.getState().diagnosisRequestId " +
                    "!== null && " +
                    "MacroStudioState.getState().busyAction === null");
                await Execute(
                    "MacroStudioState.setDiagnosisHandoffProgress(" +
                    "true,true);");
                // Asking and importing share one screen: no [次へ] here.
                await WaitForScreen("diagnoseScreen");
                await Execute(
                    "MacroStudioWorkflow.applyDiagnosisText(" +
                    DiagnosisResponse(zero) + ");");
                await WaitFor(
                    "MacroStudioState.getState().diagnosis !== null && " +
                    "MacroStudioState.getState().busyAction === null");
                await ClickNext();
                await WaitForScreen("findingsScreen");
                // Reading the diagnosis and choosing the work are two pages.
                await ClickNext();
                await WaitForScreen("nextStepScreen");
            }

            private async Task SelectPreset(bool fixedPath)
            {
                await Execute(
                    "(function(){" +
                    "var state=MacroStudioState.getState();" +
                    // The templates on offer are the entrance's own.
                    "var entries=state.entrance.repair;" +
                    "var target=entries.filter(function(entry){" +
                    "return entry.valid&&" +
                    (fixedPath
                        ? "entry.replaceRules;"
                        : "!entry.replaceRules;") +
                    "})[0];" +
                    "var cards=Array.prototype.slice.call(" +
                    "document.querySelectorAll(" +
                    "'[data-action=\"select-repair-preset\"]'));" +
                    "cards.filter(function(card){return " +
                    "card.getAttribute('data-preset-file')===" +
                    "target.file;})[0].click();}())");
                await WaitFor(
                    "MacroStudioState.getState().presetFile !== null && " +
                    "MacroStudioState.getState().busyAction === null");
            }

            private static string DiagnosisResponse(bool zero)
            {
                return "(function(){" +
                    "var state=MacroStudioState.getState();" +
                    "var id=state.diagnosisRequestId;" +
                    "var marker=String.fromCharCode(39)+" +
                    "'@MACROSTUDIO '+id+' ';" +
                    "var lines=[marker+'DIAG BEGIN " +
                    (zero ? "0" : "1") + "'];" +
                    "['PURPOSE','FLOW','DEPENDENCY','ENVIRONMENT']" +
                    ".forEach(function(name){" +
                    "lines.push(marker+'SECTION BEGIN '+name);" +
                    "lines.push(name+' checked.');" +
                    "lines.push(marker+'SECTION END '+name);});" +
                    (zero
                        ? "lines.push(marker+'DIAG NOFINDING SCOPE_CLEAR');" +
                          "lines.push(marker+'DIAG COMPLETE 0');"
                        : "var module=state.modules.filter(function(item){" +
                          "return Number(item.lineCount)>0;})[0];" +
                          "lines.push(marker+'FINDING BEGIN 1');" +
                          "lines.push(marker+'META GRADE=B ' +" +
                          "'CONFIDENCE=CONFIRMED MODULE='+module.name+" +
                          "' PROC=- LINES=1 ENVKEY=-');" +
                          "['TITLE','CONDITION','IMPACT','EVIDENCE']" +
                          ".forEach(function(name){" +
                          "lines.push(marker+'TEXT BEGIN '+name);" +
                          "lines.push(name+' checked.');" +
                          "lines.push(marker+'TEXT END '+name);});" +
                          "lines.push(marker+'FINDING END 1');" +
                          "lines.push(marker+'DIAG COMPLETE 1');") +
                    "lines.push(marker+'DIAG END');" +
                    "return lines.join('\\r\\n');}())";
            }

            private static string ShellShape()
            {
                return "(function(){" +
                    "var nav=document.querySelector('.nav-actions');" +
                    "var box=nav.getBoundingClientRect();" +
                    "return JSON.stringify({" +
                    "vertical:document.documentElement.scrollHeight>" +
                    "innerHeight," +
                    "horizontal:document.documentElement.scrollWidth>" +
                    "innerWidth," +
                    "footer:box.top>=0&&box.bottom<=innerHeight+1});}())";
            }

            // ---- the probe itself ----

            // One run of everything a person does to a box: typing
            // character by character, an IME sentence, a paste, and a
            // replacement over a selection. Every step reports whether
            // the element survived it.
            private async Task<string> Probe(string id)
            {
                return await ReadJson(
                    "JSON.stringify(window.__focusProbe.run(" +
                    serializer.Serialize(id) + "))");
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

            // What the page returned, still JSON: numbers and booleans
            // are not strings and must not be read as one.
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
                    "The editor focus smoke test ran out of time."));
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

            // The script that does the typing. It is injected once and
            // reads only what the DOM already knows, so nothing here can
            // hide a rebuild from the report.
            private static string ProbeScript()
            {
                return @"
window.__focusProbe = (function () {
  function live(selector) { return document.querySelector(selector); }
  function activeName() {
    var node = document.activeElement;
    if (!node) { return ''; }
    return node.id ? node.id : node.tagName;
  }
  function caret(node) {
    if (!node) { return -1; }
    try {
      return node.selectionStart === null ||
        node.selectionStart === undefined ? -1 : node.selectionStart;
    } catch (error) { return -1; }
  }
  function snap(id, origin, label) {
    var node = live(id);
    return {
      step: label,
      survived: node === origin,
      focused: document.activeElement === origin,
      active: activeName(),
      caret: caret(node),
      value: node ? String(node.value) : null
    };
  }
  function place(node, start, end) {
    try { node.setSelectionRange(start, end); } catch (error) { }
  }
  function fire(node, name, data, inputType, composing) {
    var event;
    if (name === 'input') {
      event = new InputEvent('input', {
        bubbles: true,
        data: data,
        inputType: inputType,
        isComposing: composing === true
      });
    } else {
      event = new CompositionEvent(name, { bubbles: true, data: data });
    }
    node.dispatchEvent(event);
  }
  function typeOne(id, character, steps, label) {
    var origin = live(id);
    var start = caret(origin);
    var end = origin.selectionEnd;
    if (start < 0) { start = origin.value.length; }
    if (end === null || end === undefined) { end = start; }
    origin.value = origin.value.slice(0, start) + character +
      origin.value.slice(end);
    place(origin, start + character.length, start + character.length);
    fire(origin, 'input', character, 'insertText', false);
    steps.push(snap(id, origin, label));
  }
  return {
    run: function (id) {
      var report = { id: id, typed: [], composed: [], imeEnter: [],
        pasted: [], replaced: [], focusTaken: false, finalValue: '' };
      var node = live(id);
      var text = '\u3042\u3044\u3046abc';
      var chunks = ['\u304b', '\u304b\u3093', '\u304b\u3093\u3058'];
      var settled = '\u6f22\u5b57';
      var pasted = '\u8cbc\u4ed8';
      var base;
      var index;
      var origin;
      var start;
      var enterEvent;
      var enterStep;
      var screenBefore;

      if (!node) { report.missing = true; return report; }
      node.value = '';
      node.focus();
      place(node, 0, 0);
      report.focusTaken = document.activeElement === node;
      report.why = {
        active: activeName(),
        pageHasFocus: document.hasFocus(),
        disabled: node.disabled === true,
        visibility: getComputedStyle(node).visibility,
        display: getComputedStyle(node).display,
        height: node.offsetHeight,
        inDocument: document.body.contains(node)
      };

      // one character at a time, the way a sentence is written
      for (index = 0; index < text.length; index += 1) {
        typeOne(id, text.charAt(index), report.typed, 'type:' + index);
      }

      // a Japanese word: composing, then settled
      origin = live(id);
      base = origin.value;
      fire(origin, 'compositionstart', '', null, true);
      report.composed.push(snap(id, origin, 'compositionstart'));
      for (index = 0; index < chunks.length; index += 1) {
        origin = live(id);
        origin.value = base + chunks[index];
        place(origin, origin.value.length, origin.value.length);
        fire(origin, 'compositionupdate', chunks[index], null, true);
        fire(origin, 'input', chunks[index], 'insertCompositionText', true);
        report.composed.push(snap(id, origin, 'compose:' + index));
      }
      origin = live(id);
      screenBefore = MacroStudioState.getState().screen;
      enterEvent = new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Enter', code: 'Enter'
      });
      try {
        Object.defineProperty(enterEvent, 'isComposing', { value: true });
        Object.defineProperty(enterEvent, 'keyCode', { value: 229 });
      } catch (error) { }
      origin.dispatchEvent(enterEvent);
      enterStep = snap(id, origin, 'ime-enter');
      enterStep.screenUnchanged =
        MacroStudioState.getState().screen === screenBefore;
      report.imeEnter.push(enterStep);
      origin = live(id);
      origin.value = base + settled;
      place(origin, origin.value.length, origin.value.length);
      fire(origin, 'compositionend', settled, null, false);
      fire(origin, 'input', settled, 'insertCompositionText', false);
      report.composed.push(snap(id, origin, 'compositionend'));

      // a paste
      origin = live(id);
      start = caret(origin);
      origin.value = origin.value.slice(0, start) + pasted +
        origin.value.slice(start);
      place(origin, start + pasted.length, start + pasted.length);
      fire(origin, 'input', pasted, 'insertFromPaste', false);
      report.pasted.push(snap(id, origin, 'paste'));

      // typing over a selection replaces it
      origin = live(id);
      origin.focus();
      place(origin, 0, 3);
      report.replaced.push(snap(id, origin, 'select'));
      typeOne(id, 'X', report.replaced, 'replace');

      node = live(id);
      report.finalValue = node ? String(node.value) : null;
      return report;
    },
    toggle: function (id) {
      var node = live(id);
      var report = { id: id, steps: [] };

      if (!node) { report.missing = true; return report; }
      node.focus();
      report.focusTaken = document.activeElement === node;
      node.click();
      report.steps.push(snap(id, node, 'on'));
      node = live(id);
      node.click();
      report.steps.push(snap(id, node, 'off'));
      return report;
    }
  };
}());
";
            }
        }
    }
}
