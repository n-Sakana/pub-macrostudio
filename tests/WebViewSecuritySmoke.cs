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
    // Works the WebView2 boundary in a running window.
    //
    // Two phases, because the two defences have to be shown separately:
    //
    //   1. The product's own window, locked down by WebViewSecurity.Apply.
    //      The trusted page must load and its host requests must still be
    //      answered, while every attempt to take the window somewhere
    //      else - a remote page, a local file, a data URI, a look-alike
    //      host, a second window, a frame - is refused.
    //
    //   2. A window that is deliberately NOT locked down, so a document
    //      from another origin can be loaded at all. It posts a host
    //      request through the real MessageRouter. The message must be
    //      dropped: no reply, nothing done. This is the layer that has to
    //      hold even if a foreign document ever gets in.
    public static class WebViewSecuritySmoke
    {
        public static string Run(
            string baseDir,
            string cacheDir,
            string probeDir,
            string logPath)
        {
            SmokeRunner runner = new SmokeRunner(
                baseDir,
                cacheDir,
                probeDir,
                logPath);
            Thread thread = new Thread(runner.Run);
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();

            if (!thread.Join(120000))
            {
                throw new TimeoutException(
                    "The WebView2 security smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The WebView2 security smoke test failed.",
                    runner.Error);
            }
            return runner.Result;
        }

        private const string ProbeHost = "untrusted.local";
        private const string ProbePage =
            "https://untrusted.local/probe.html";
        private const string SentinelMessage =
            "SENTINEL-FROM-UNTRUSTED-ORIGIN";

        private sealed class SmokeRunner
        {
            private readonly string baseDir;
            private readonly string cacheDir;
            private readonly string probeDir;
            private readonly string logPath;
            private readonly JavaScriptSerializer serializer;
            private readonly List<string> refusals;
            private readonly List<string> navigations;

            private Application application;
            private Window window;
            private WebView2 webView;
            private MessageRouter router;
            private HostServices services;
            private DispatcherTimer timeoutTimer;
            private bool hardened;

            public string Result;
            public Exception Error;

            public SmokeRunner(
                string baseDir,
                string cacheDir,
                string probeDir,
                string logPath)
            {
                this.baseDir = Path.GetFullPath(baseDir);
                this.cacheDir = Path.GetFullPath(cacheDir);
                this.probeDir = Path.GetFullPath(probeDir);
                this.logPath = Path.GetFullPath(logPath);
                serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = int.MaxValue;
                refusals = new List<string>();
                navigations = new List<string>();
                Result = string.Empty;
            }

            public void Run()
            {
                try
                {
                    application = new Application();
                    application.ShutdownMode =
                        ShutdownMode.OnExplicitShutdown;

                    window = CreateWindow();
                    window.Loaded += OnLoaded;

                    timeoutTimer = new DispatcherTimer();
                    timeoutTimer.Interval = TimeSpan.FromSeconds(110);
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

            private Window CreateWindow()
            {
                Window created = new Window();

                created.Width = 1100;
                created.Height = 700;
                created.Left = -10000;
                created.Top = -10000;
                created.ShowInTaskbar = false;
                created.ShowActivated = false;
                created.WindowStyle = WindowStyle.None;
                created.ResizeMode = ResizeMode.NoResize;
                return created;
            }

            private async void OnLoaded(object sender, RoutedEventArgs e)
            {
                Dictionary<string, object> result =
                    new Dictionary<string, object>();

                try
                {
                    WriteProbePage();
                    await RunHardenedPhase(result);
                    await RunUntrustedOriginPhase(result);
                    Result = serializer.Serialize(result);
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            }

            // The page that stands in for anything not shipped with the
            // app: same runtime, same chrome.webview object, different
            // origin.
            private void WriteProbePage()
            {
                string html =
                    "<!doctype html><html><head><meta charset=\"utf-8\">" +
                    "<title>probe</title></head><body>" +
                    "<script>\n" +
                    "window.replies = [];\n" +
                    "window.posted = false;\n" +
                    "window.bridge = " +
                    "typeof chrome !== 'undefined' && chrome.webview " +
                    "? true : false;\n" +
                    "if (window.bridge) {\n" +
                    "  chrome.webview.addEventListener('message', " +
                    "function (event) { window.replies.push(" +
                    "JSON.stringify(event.data)); });\n" +
                    // Shaped exactly like a real host request: the same
                    // object the product page posts, so nothing but the
                    // origin distinguishes it.
                    "  window.attack = function () {\n" +
                    "    chrome.webview.postMessage({\n" +
                    "      id: 'probe-1', action: 'writeLog',\n" +
                    "      params: { level: 'ERROR', message: '" +
                    SentinelMessage + "' }\n" +
                    "    });\n" +
                    "    chrome.webview.postMessage({\n" +
                    "      id: 'probe-2', action: 'getAppInfo',\n" +
                    "      params: {}\n" +
                    "    });\n" +
                    "    window.posted = true;\n" +
                    "  };\n" +
                    "}\n" +
                    "</script></body></html>";

                Directory.CreateDirectory(probeDir);
                using (StreamWriter writer = new StreamWriter(
                    Path.Combine(probeDir, "probe.html"),
                    false,
                    new UTF8Encoding(false)))
                {
                    writer.Write(html);
                }
            }

            // ---- phase 1: the product's own, hardened window ----

            private async Task RunHardenedPhase(
                Dictionary<string, object> result)
            {
                await CreateWebView(true);

                await Navigate(WebViewSecurity.StartPage, true);
                await WaitFor(
                    "window.MacroStudioState && " +
                    "MacroStudioState.getState().appInfo !== null");

                // The product page still gets its work done: this value
                // only arrives by way of a host request that the router
                // accepted.
                result.Add("trustedRequestWorks", await ReadJson(
                    // Every Markdown file the host handed over: the one
                    // diagnosis, the operations, the change scopes.
                    "({presets:MacroStudioState.getState()" +
                    ".appInfo.presets.diagnose.length+" +
                    "MacroStudioState.getState()" +
                    ".appInfo.presets.repair.length+" +
                    "MacroStudioState.getState()" +
                    ".appInfo.presets.scope.length," +
                    "version:String(MacroStudioState.getState()" +
                    ".appInfo.version)})"));
                result.Add("startPage", await CurrentSource());
                result.Add("settings", ReadSettings());

                // Every navigation the runtime asked for while starting
                // up, in order, with what the policy decided. This is the
                // measurement the startup allowance is based on.
                result.Add("startupNavigations", new List<string>(
                    navigations));

                result.Add(
                    "blockedNavigations",
                    await RefuseNavigations());
                result.Add("newWindow", await RefuseNewWindow());
                result.Add("frame", await RefuseFrame());
                result.Add("refusals", new List<string>(refusals));

                await DisposeWebView();
            }

            private List<string> ReadSettings()
            {
                CoreWebView2Settings settings =
                    webView.CoreWebView2.Settings;
                List<string> values = new List<string>();

                values.Add("devTools=" +
                    settings.AreDevToolsEnabled.ToString());
                values.Add("acceleratorKeys=" +
                    settings.AreBrowserAcceleratorKeysEnabled.ToString());
                values.Add("contextMenus=" +
                    settings.AreDefaultContextMenusEnabled.ToString());
                values.Add("hostObjects=" +
                    settings.AreHostObjectsAllowed.ToString());
                values.Add("statusBar=" +
                    settings.IsStatusBarEnabled.ToString());
                values.Add("webMessage=" +
                    settings.IsWebMessageEnabled.ToString());
                return values;
            }

            // Each target is asked for from the host side, which is the
            // deterministic way in: whatever a page could do to itself
            // ends up in the same event.
            private async Task<List<string>> RefuseNavigations()
            {
                string[] targets = new string[]
                {
                    "https://example.com/",
                    "http://macrostudio.local/index.html",
                    "https://macrostudio.local.example.com/index.html",
                    "https://macrostudio.local:8443/index.html",
                    "about:blank",
                    ProbePage,
                    new Uri(Path.Combine(
                        baseDir,
                        "assets",
                        "index.html")).AbsoluteUri,
                    "data:text/html,<h1>x</h1>"
                };
                List<string> outcomes = new List<string>();
                int index;

                for (index = 0; index < targets.Length; index++)
                {
                    webView.CoreWebView2.Navigate(targets[index]);
                    await Task.Delay(250);
                    outcomes.Add(
                        targets[index] + " -> " + await CurrentSource());
                }

                // The page trying to leave on its own account, rather
                // than the host being asked to take it away.
                await Execute(
                    "try{location.href='https://example.com/';}" +
                    "catch(err){}");
                await Task.Delay(400);
                outcomes.Add("location.href -> " + await CurrentSource());
                return outcomes;
            }

            private async Task<Dictionary<string, object>>
                RefuseNewWindow()
            {
                // Same reasoning as the frame: the target is served by
                // this test, so an unhandled request would really open
                // it. Whether a window appeared is read from the runtime
                // (a new CoreWebView2 would have been handed over) and
                // from the page (window.open returns a live handle only
                // when a window was made).
                int before = Application.Current.Windows.Count;

                await Execute(
                    "try{window.opened=window.open(" +
                    "'" + ProbePage + "','_blank');}" +
                    "catch(err){window.opened=null;}");
                await Task.Delay(900);

                Dictionary<string, object> outcome =
                    new Dictionary<string, object>();
                outcome.Add("windowsBefore", before);
                outcome.Add("windowsAfter",
                    Application.Current.Windows.Count);
                outcome.Add("openedHandle",
                    await ReadString("String(window.opened)"));
                outcome.Add("openedClosed",
                    await ReadString(
                        "(function(){try{return String(" +
                        "window.opened === null || window.opened.closed);}" +
                        "catch(err){return 'blocked';}}())"));
                outcome.Add("source", await CurrentSource());
                return outcome;
            }

            // The frame points at a page this test serves itself, so
            // "did it load" has a definite answer with no network in it:
            // left alone it would succeed, and the only reason it can
            // fail is the refusal. A cross-origin frame cannot be read
            // from the page, so the answer is taken from the runtime's
            // own completion event rather than from script.
            private async Task<Dictionary<string, object>> RefuseFrame()
            {
                List<string> completions = new List<string>();
                EventHandler<CoreWebView2NavigationCompletedEventArgs>
                    handler = delegate(
                        object sender,
                        CoreWebView2NavigationCompletedEventArgs args)
                {
                    completions.Add(
                        args.IsSuccess.ToString() + ":" +
                        args.WebErrorStatus.ToString());
                };

                int attempt;

                webView.CoreWebView2.FrameNavigationCompleted += handler;
                await Execute(
                    "(function(){var f=document.createElement('iframe');" +
                    "f.id='probe-frame';" +
                    "f.src='" + ProbePage + "';" +
                    "document.body.appendChild(f);}())");
                // Waited for rather than timed: a frame that is allowed
                // to load takes longer than one that is refused, and a
                // fixed pause would call the slow case "never tried".
                for (attempt = 0; attempt < 100; attempt++)
                {
                    if (completions.Count > 0)
                    {
                        break;
                    }
                    await Task.Delay(50);
                }
                await Task.Delay(200);
                webView.CoreWebView2.FrameNavigationCompleted -= handler;

                Dictionary<string, object> outcome =
                    new Dictionary<string, object>();
                outcome.Add("completions", completions);
                outcome.Add("frameUrl", await ReadString(
                    "(function(){try{return String(" +
                    "document.getElementById('probe-frame')" +
                    ".contentWindow.location.href);}" +
                    "catch(err){return 'blocked:'+err.name;}}())"));
                await Execute(
                    "(function(){var f=document.getElementById(" +
                    "'probe-frame');if(f){f.parentNode.removeChild(f);}}())");
                outcome.Add("source", await CurrentSource());
                return outcome;
            }

            // ---- phase 2: a foreign document, reaching the real router ----

            private async Task RunUntrustedOriginPhase(
                Dictionary<string, object> result)
            {
                long logLengthBefore = ReadLogLength();

                // Deliberately not hardened, so the foreign page can be
                // loaded at all. The router is the real one.
                await CreateWebView(false);
                await Navigate(ProbePage, true);

                Dictionary<string, object> outcome =
                    new Dictionary<string, object>();

                outcome.Add("origin", await CurrentSource());
                // The bridge is handed to every document in the WebView,
                // which is precisely why the router cannot trust it.
                outcome.Add("bridgeReachable", await ReadString(
                    "String(window.bridge)"));
                await Execute("if(window.attack){window.attack();}");
                await WaitFor("window.posted === true");
                await Task.Delay(1500);
                outcome.Add("replies", await ReadString(
                    "String(window.replies.length)"));
                outcome.Add("repliesText", await ReadString(
                    "JSON.stringify(window.replies)"));
                result.Add("untrustedMessage", outcome);

                await DisposeWebView();

                // The log is the record of what happened: the refusal is
                // written, and the action the page asked for is not.
                string log = ReadLogTail(logLengthBefore);
                Dictionary<string, object> logOutcome =
                    new Dictionary<string, object>();
                logOutcome.Add(
                    "refusalLogged",
                    log.IndexOf(
                        "untrusted source",
                        StringComparison.Ordinal) >= 0);
                logOutcome.Add(
                    "sentinelWritten",
                    log.IndexOf(
                        SentinelMessage,
                        StringComparison.Ordinal) >= 0);
                logOutcome.Add("tailLength", log.Length);
                result.Add("log", logOutcome);
            }

            private long ReadLogLength()
            {
                try
                {
                    FileInfo info = new FileInfo(logPath);
                    return info.Exists ? info.Length : 0;
                }
                catch (Exception)
                {
                    return 0;
                }
            }

            private string ReadLogTail(long from)
            {
                try
                {
                    if (!File.Exists(logPath))
                    {
                        return string.Empty;
                    }
                    using (FileStream stream = new FileStream(
                        logPath,
                        FileMode.Open,
                        FileAccess.Read,
                        FileShare.ReadWrite))
                    {
                        if (from > 0 && from < stream.Length)
                        {
                            stream.Seek(from, SeekOrigin.Begin);
                        }
                        using (StreamReader reader = new StreamReader(
                            stream,
                            Encoding.UTF8))
                        {
                            return reader.ReadToEnd();
                        }
                    }
                }
                catch (Exception)
                {
                    return string.Empty;
                }
            }

            // ---- plumbing ----

            private async Task CreateWebView(bool applyPolicy)
            {
                Directory.CreateDirectory(cacheDir);
                CoreWebView2Environment environment =
                    await CoreWebView2Environment.CreateAsync(
                        null,
                        cacheDir,
                        null);

                hardened = applyPolicy;
                webView = new WebView2();
                webView.AllowExternalDrop = false;
                window.Content = webView;
                await webView.EnsureCoreWebView2Async(environment);
                webView.ZoomFactor = 1.0;
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    WebViewSecurity.TrustedHost,
                    Path.Combine(baseDir, "assets"),
                    CoreWebView2HostResourceAccessKind.Allow);
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    ProbeHost,
                    probeDir,
                    CoreWebView2HostResourceAccessKind.Allow);

                // Recorded whether the policy is on or not, so the
                // startup navigations can be compared between the two.
                webView.CoreWebView2.NavigationStarting += delegate(
                    object sender,
                    CoreWebView2NavigationStartingEventArgs args)
                {
                    navigations.Add(
                        args.Uri + (args.Cancel ? " [cancelled]" : ""));
                };

                services = new HostServices(window, baseDir);
                if (applyPolicy)
                {
                    WebViewSecurity.Apply(
                        webView.CoreWebView2,
                        delegate(string message)
                        {
                            refusals.Add(message);
                        });
                }
                router = new MessageRouter(webView, services);
                webView.CoreWebView2.WebMessageReceived +=
                    router.OnWebMessageReceived;
            }

            private async Task DisposeWebView()
            {
                if (webView == null)
                {
                    return;
                }

                if (webView.CoreWebView2 != null && router != null)
                {
                    webView.CoreWebView2.WebMessageReceived -=
                        router.OnWebMessageReceived;
                }
                window.Content = null;
                webView.Dispose();
                webView = null;
                router = null;
                await Task.Delay(200);
            }

            private async Task<string> CurrentSource()
            {
                await Task.Delay(1);
                return webView.CoreWebView2.Source;
            }

            private async Task Navigate(string url, bool mustSucceed)
            {
                TaskCompletionSource<bool> done =
                    new TaskCompletionSource<bool>();
                EventHandler<CoreWebView2NavigationCompletedEventArgs>
                    handler = null;
                handler = delegate(
                    object sender,
                    CoreWebView2NavigationCompletedEventArgs args)
                {
                    webView.CoreWebView2.NavigationCompleted -= handler;
                    done.TrySetResult(args.IsSuccess);
                };
                webView.CoreWebView2.NavigationCompleted += handler;
                webView.CoreWebView2.Navigate(url);
                bool ok = await done.Task;
                if (mustSucceed && !ok)
                {
                    throw new InvalidOperationException(
                        "Navigation failed: " + url +
                        " (hardened=" + hardened.ToString() + ")");
                }
            }

            private async Task Execute(string script)
            {
                await webView.CoreWebView2.ExecuteScriptAsync(script);
            }

            private async Task<string> ReadString(string expression)
            {
                string raw =
                    await webView.CoreWebView2.ExecuteScriptAsync(
                        "String(" + expression + ")");
                return serializer.Deserialize<string>(raw);
            }

            private async Task<string> ReadJson(string expression)
            {
                return await ReadString(
                    "JSON.stringify(" + expression + ")");
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
                    "The security condition timed out: " + expression);
            }

            private void OnTimeout(object sender, EventArgs e)
            {
                Fail(new TimeoutException(
                    "The WebView2 security smoke test timed out."));
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
                        if (window != null)
                        {
                            window.Content = null;
                        }
                        webView.Dispose();
                        webView = null;
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
