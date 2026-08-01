using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace MacroStudio
{
    public sealed class MessageRouter
    {
        private sealed class BuildModulePayload
        {
            public Dictionary<string, string> Changes;
            public List<VbaModuleAddition> Additions;

            public BuildModulePayload()
            {
                Changes = new Dictionary<string, string>(
                    StringComparer.OrdinalIgnoreCase);
                Additions = new List<VbaModuleAddition>();
            }
        }

        private readonly WebView2 webView;
        private readonly HostServices services;
        private readonly JavaScriptSerializer serializer;

        public MessageRouter(WebView2 webView, HostServices services)
        {
            if (webView == null)
            {
                throw new ArgumentNullException("webView");
            }
            if (services == null)
            {
                throw new ArgumentNullException("services");
            }

            this.webView = webView;
            this.services = services;
            serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = int.MaxValue;
        }

        public async void OnWebMessageReceived(
            object sender,
            CoreWebView2WebMessageReceivedEventArgs e)
        {
            object id = null;
            string action = string.Empty;

            // Before the message is even read: only the product page may
            // ask the host to do work. Anything else is dropped here,
            // with no reply, so an untrusted document learns nothing and
            // reaches no host action.
            if (!WebViewSecurity.IsTrustedSource(GetSource(e)))
            {
                WriteRefusalLog(e);
                return;
            }

            try
            {
                Dictionary<string, object> message =
                    serializer.Deserialize<Dictionary<string, object>>(
                        e.WebMessageAsJson);
                if (message == null)
                {
                    throw new HostActionException(
                        "E-SYS-02",
                        "The host request is empty.");
                }
                if (!message.TryGetValue("id", out id) || id == null)
                {
                    throw new HostActionException(
                        "E-SYS-02",
                        "The host request id is missing.");
                }

                action = GetString(message, "action");
                if (string.IsNullOrEmpty(action))
                {
                    throw new HostActionException(
                        "E-SYS-02",
                        "The host action is missing.");
                }

                Dictionary<string, object> parameters =
                    GetParameters(message);
                object data;
                if (action == "resolveDroppedFiles")
                {
                    // Dropped files arrive as CoreWebView2File objects
                    // next to the message; only the host can read their
                    // real paths.
                    data = CreateDroppedFileResult(e);
                }
                else if (IsEngineAction(action))
                {
                    data = await Task.Run<object>(delegate()
                    {
                        return Dispatch(action, parameters);
                    });
                }
                else
                {
                    data = Dispatch(action, parameters);
                }

                SendSuccess(id, data);
            }
            catch (Exception ex)
            {
                Exception error = Unwrap(ex);
                WriteErrorLog(action, error);
                if (id != null)
                {
                    SendError(id, error);
                }
            }
        }

        public void PushEvent(string eventName, object data)
        {
            if (string.IsNullOrEmpty(eventName))
            {
                throw new ArgumentException(
                    "The event name is empty.",
                    "eventName");
            }

            Dictionary<string, object> message =
                new Dictionary<string, object>();
            message.Add("event", eventName);
            message.Add("data", data);
            PostMessage(message);
        }

        private object Dispatch(
            string action,
            Dictionary<string, object> parameters)
        {
            switch (action)
            {
                case "getAppInfo":
                    return services.GetAppInfo();
                case "getTargetEnvironment":
                    return services.GetTargetEnvironment();
                case "getHostRuntime":
                    return services.GetHostRuntime();
                case "pickBook":
                    return services.PickBook();
                case "attachBook":
                    return services.AttachBook(
                        GetString(parameters, "path"));
                case "readPreset":
                    return services.ReadPreset(
                        GetString(parameters, "file"));
                case "readRequestTemplate":
                    return services.ReadRequestTemplate(
                        GetString(parameters, "name"));
                case "writeRequestFiles":
                    return services.WriteRequestFiles(
                        GetString(parameters, "stage"),
                        GetString(parameters, "outputTimestamp"),
                        GetString(parameters, "request"),
                        GetString(parameters, "code"));
                case "writeDiagnosisFile":
                    return services.WriteDiagnosisFile(
                        GetString(parameters, "outputTimestamp"),
                        GetString(parameters, "markdown"));
                case "writeClipboard":
                    return services.WriteClipboard(
                        GetString(parameters, "text"));
                case "readClipboard":
                    return services.ReadClipboard();
                case "buildBook":
                    BuildModulePayload buildModules =
                        GetModuleChanges(parameters);
                    return services.BuildBook(
                        buildModules.Changes,
                        buildModules.Additions,
                        GetString(parameters, "outputTimestamp"),
                        GetString(parameters, "diffHtml"),
                        GetString(parameters, "outputName"),
                        GetString(parameters, "resultMarkdown"),
                        GetString(parameters, "diffName"));
                case "revealPath":
                    services.RevealPath(
                        GetString(parameters, "path"));
                    return null;
                case "writeLog":
                    services.WriteLog(
                        GetString(parameters, "level"),
                        GetString(parameters, "message"));
                    return null;
                default:
                    throw new HostActionException(
                        "E-SYS-02",
                        "Unknown host action: " + action);
            }
        }

        private static Dictionary<string, object> CreateDroppedFileResult(
            CoreWebView2WebMessageReceivedEventArgs e)
        {
            List<string> paths = new List<string>();
            IReadOnlyList<object> additional = e.AdditionalObjects;
            if (additional != null)
            {
                int index;
                for (index = 0; index < additional.Count; index++)
                {
                    CoreWebView2File file =
                        additional[index] as CoreWebView2File;
                    if (file == null ||
                        string.IsNullOrEmpty(file.Path))
                    {
                        continue;
                    }

                    paths.Add(file.Path);
                }
            }

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("paths", paths);
            return result;
        }

        private static bool IsEngineAction(string action)
        {
            return action == "attachBook" ||
                action == "buildBook";
        }

        private static Dictionary<string, object> GetParameters(
            Dictionary<string, object> message)
        {
            object value;
            if (!message.TryGetValue("params", out value) ||
                value == null)
            {
                return new Dictionary<string, object>();
            }

            Dictionary<string, object> parameters =
                value as Dictionary<string, object>;
            if (parameters == null)
            {
                throw new HostActionException(
                    "E-SYS-02",
                    "The host request params are invalid.");
            }
            return parameters;
        }

        private static BuildModulePayload GetModuleChanges(
            Dictionary<string, object> parameters)
        {
            object value;
            if (!parameters.TryGetValue("modules", out value) ||
                value == null)
            {
                throw new HostActionException(
                    "E-BUILD-01",
                    "The build module list is missing.");
            }

            IEnumerable items = value as IEnumerable;
            if (items == null || value is string)
            {
                throw new HostActionException(
                    "E-BUILD-01",
                    "The build module list is invalid.");
            }

            BuildModulePayload result =
                new BuildModulePayload();
            HashSet<string> names =
                new HashSet<string>(
                    StringComparer.OrdinalIgnoreCase);
            foreach (object itemValue in items)
            {
                Dictionary<string, object> item =
                    itemValue as Dictionary<string, object>;
                if (item == null)
                {
                    throw new HostActionException(
                        "E-BUILD-01",
                        "A build module entry is invalid.");
                }

                string name = GetString(item, "name");
                string code = GetString(item, "code");
                if (string.IsNullOrEmpty(name) || code == null)
                {
                    throw new HostActionException(
                        "E-BUILD-01",
                        "A build module name or code is missing.");
                }
                if (!names.Add(name))
                {
                    throw new HostActionException(
                        "E-BUILD-01",
                        "A build module is duplicated: " + name);
                }

                object isNewValue;
                bool isNew = false;
                if (item.TryGetValue(
                    "isNew",
                    out isNewValue) &&
                    isNewValue != null)
                {
                    if (!(isNewValue is bool))
                    {
                        throw new HostActionException(
                            "E-BUILD-01",
                            "A build module type is invalid.");
                    }
                    isNew = (bool)isNewValue;
                }

                if (isNew)
                {
                    result.Additions.Add(
                        new VbaModuleAddition(name, code));
                }
                else
                {
                    result.Changes.Add(name, code);
                }
            }

            return result;
        }

        private static string GetString(
            Dictionary<string, object> values,
            string key)
        {
            object value;
            if (values == null ||
                !values.TryGetValue(key, out value) ||
                value == null)
            {
                return null;
            }
            return value as string ?? value.ToString();
        }

        private void SendSuccess(object id, object data)
        {
            Dictionary<string, object> response =
                new Dictionary<string, object>();
            response.Add("id", id);
            response.Add("status", "ok");
            response.Add("data", data);
            PostMessage(response);
        }

        private void SendError(object id, Exception error)
        {
            string code = "E-SYS-02";
            object data = null;

            HostActionException hostError =
                error as HostActionException;
            if (hostError != null)
            {
                code = hostError.ErrorCode;
                data = hostError.ErrorData;
            }
            else
            {
                MacroStudioException macroStudioError =
                    error as MacroStudioException;
                if (macroStudioError != null)
                {
                    code = macroStudioError.ErrorCode;
                }
            }

            Dictionary<string, object> response =
                new Dictionary<string, object>();
            response.Add("id", id);
            response.Add("status", "error");
            response.Add("code", code);
            response.Add("message", error.Message);
            if (data != null)
            {
                response.Add("data", data);
            }
            PostMessage(response);
        }

        private void PostMessage(object message)
        {
            if (!webView.Dispatcher.CheckAccess())
            {
                webView.Dispatcher.BeginInvoke(new Action(delegate()
                {
                    PostMessage(message);
                }));
                return;
            }
            if (webView.CoreWebView2 == null)
            {
                return;
            }

            string json = serializer.Serialize(message);
            webView.CoreWebView2.PostWebMessageAsJson(json);
        }

        // Reading Source must not itself become a way in: a runtime that
        // cannot report it is treated as untrusted.
        private static string GetSource(
            CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (e == null)
            {
                return null;
            }

            try
            {
                return e.Source;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private void WriteRefusalLog(
            CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                services.WriteLog(
                    "WARN",
                    "host request refused, untrusted source: " +
                        WebViewSecurity.Describe(GetSource(e)));
            }
            catch
            {
            }
        }

        private void WriteErrorLog(string action, Exception error)
        {
            try
            {
                string label = string.IsNullOrEmpty(action) ?
                    "host request" :
                    action;
                services.WriteLog(
                    "ERROR",
                    label + ": " + error.ToString());
            }
            catch
            {
            }
        }

        private static Exception Unwrap(Exception error)
        {
            AggregateException aggregate =
                error as AggregateException;
            if (aggregate != null)
            {
                aggregate = aggregate.Flatten();
                if (aggregate.InnerExceptions.Count == 1)
                {
                    return aggregate.InnerExceptions[0];
                }
            }
            return error;
        }
    }
}
