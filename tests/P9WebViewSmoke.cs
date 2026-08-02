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
    public static class P9WebViewSmoke
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

            if (!thread.Join(45000))
            {
                throw new TimeoutException(
                    "The P9 preset smoke test did not stop.");
            }
            if (runner.Error != null)
            {
                throw new InvalidOperationException(
                    "The P9 preset smoke test failed.",
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
                    window.Width = 1100;
                    window.Height = 700;
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
                    timeoutTimer.Interval = TimeSpan.FromSeconds(35);
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
                        "The P9 test page navigation failed."));
                    return;
                }

                try
                {
                    await WaitFor(
                        "MacroStudioState.getState().appInfo !== null");
                    Dictionary<string, object> eventData =
                        new Dictionary<string, object>();
                    eventData.Add("path", bookPath);
                    router.PushEvent("bookDropped", eventData);
                    await WaitFor(
                        "MacroStudioState.getState().book !== null && " +
                        "MacroStudioState.getState().busyAction === null");
                    await Execute(
                        "(function(){" +
                        "var id='11111111-1111-4111-8111-111111111111';" +
                        "var marker=String.fromCharCode(39)+" +
                        "'@MACROSTUDIO '+id+' ';" +
                        "var lines=[marker+'DIAG BEGIN 0'];" +
                        "['PURPOSE','FLOW','DEPENDENCY','ENVIRONMENT']" +
                        ".forEach(function(name){" +
                        "lines.push(marker+'SECTION BEGIN '+name);" +
                        "lines.push(name+' checked.');" +
                        "lines.push(marker+'SECTION END '+name);});" +
                        "lines.push(marker+'DIAG NOFINDING SCOPE_CLEAR');" +
                        "lines.push(marker+'DIAG COMPLETE 0');" +
                        "lines.push(marker+'DIAG END');" +
                        "MacroStudioState.commitDiagnosisRequest({" +
                        "requestId:id,requestText:'test',prompt:'test'," +
                        "requestPath:'test',runFolder:'test'});" +
                        "var parsed=MacroStudioDiagnosis.parse(" +
                        "lines.join('\\r\\n'),{" +
                        "requestId:id," +
                        "modules:MacroStudioState.getState().modules," +
                        "environment:MacroStudioState.getState()" +
                        ".targetEnvironment});" +
                        "if(!parsed.ok){throw new Error(parsed.validationId);}" +
                        "MacroStudioState.commitDiagnosis(" +
                        "parsed.diagnosis,'diagnosis.md');" +
                        "MacroStudioState.goTo(" +
                        "MacroStudioScreens.nextStepScreen,false);" +
                        "}());");
                    // The templates are drawn on their own page now.
                    await WaitFor(
                        "MacroStudioState.getState().screen === " +
                        "MacroStudioScreens.nextStepScreen");
                    Result = await ReadJson(
                        "(function(){" +
                        "var info=MacroStudioState.getState().appInfo;" +
                        "var presets=info.presets.repair;" +
                        "var entries=MacroStudioPreset" +
                        ".describeAll(presets,'repair');" +
                        "return {" +
                        "count:document.querySelectorAll(" +
                        "'[data-action=\"select-repair-preset\"]').length," +
                        "stateCount:presets.length," +
                        "diagnoseCount:info.presets.diagnose.length," +
                        "invalidCount:entries.filter(function(item){" +
                        "return !item.valid;}).length," +
                        "validCount:entries.filter(function(item){" +
                        "return item.valid;}).length," +
                        "labels:Array.prototype.map.call(" +
                        "document.querySelectorAll('.choice-title')," +
                        "function(node){return node.textContent;})," +
                        "names:entries.filter(function(item){" +
                        "return item.valid;}).map(function(item){" +
                        "return item.name;})," +
                        "files:presets.map(function(item){" +
                        "return item.file;})," +
                        "invalidFiles:entries.filter(function(item){" +
                        "return !item.valid;}).map(function(item){" +
                        "return item.file;})," +
                        "invalidVisible:document.querySelectorAll(" +
                        "'.preset-invalid-item').length," +
                        "horizontal:document.documentElement" +
                        ".scrollWidth>innerWidth" +
                        "};}())");
                    Stop();
                }
                catch (Exception ex)
                {
                    Fail(ex);
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
                    "The P9 browser condition timed out: " +
                    expression);
            }

            private void OnTimeout(object sender, EventArgs e)
            {
                Fail(new TimeoutException(
                    "The P9 preset smoke test timed out."));
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
