using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows;
using Microsoft.Win32;

namespace MacroStudio
{
    public sealed class HostActionException : Exception
    {
        public string ErrorCode;
        public object ErrorData;

        public HostActionException(string errorCode, string message)
            : this(errorCode, message, null, null)
        {
        }

        public HostActionException(
            string errorCode,
            string message,
            object errorData)
            : this(errorCode, message, errorData, null)
        {
        }

        public HostActionException(
            string errorCode,
            string message,
            object errorData,
            Exception innerException)
            : base(message, innerException)
        {
            ErrorCode = errorCode;
            ErrorData = errorData;
        }
    }

    internal static class ClipboardRetry
    {
        private const int CannotOpenClipboardHResult =
            unchecked((int)0x800401D0);
        private const int MaximumAttempts = 10;
        private const int RetryDelayMilliseconds = 50;

        [DllImport("user32.dll")]
        private static extern IntPtr GetOpenClipboardWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(
            IntPtr window,
            out uint processId);

        internal static void Execute(
            string errorCode,
            string errorMessage,
            Action operation,
            Action<int> wait,
            Func<string> inspectOwner,
            Action<int, bool, IList<string>> report)
        {
            if (operation == null)
            {
                throw new ArgumentNullException("operation");
            }
            if (wait == null)
            {
                throw new ArgumentNullException("wait");
            }

            int retryCount = 0;
            List<string> owners = new List<string>();
            int attempt;
            for (attempt = 1; attempt <= MaximumAttempts; attempt++)
            {
                try
                {
                    operation();
                    Report(report, retryCount, true, owners);
                    return;
                }
                catch (Exception ex)
                {
                    bool clipboardBusy =
                        ex.HResult == CannotOpenClipboardHResult;
                    if (clipboardBusy)
                    {
                        owners.Add(InspectOwner(inspectOwner));
                    }
                    bool canRetry =
                        clipboardBusy &&
                        attempt < MaximumAttempts;
                    if (!canRetry)
                    {
                        Report(report, retryCount, false, owners);
                        throw new HostActionException(
                            errorCode,
                            errorMessage,
                            null,
                            ex);
                    }
                }

                retryCount++;
                wait(RetryDelayMilliseconds);
            }
        }

        internal static string InspectOpenClipboardOwner()
        {
            IntPtr window = GetOpenClipboardWindow();
            if (window == IntPtr.Zero)
            {
                return "none";
            }

            uint processId;
            GetWindowThreadProcessId(window, out processId);
            if (processId == 0)
            {
                return "unknown pid=0";
            }

            string processName = "unknown";
            try
            {
                using (Process process = Process.GetProcessById(
                    checked((int)processId)))
                {
                    processName = process.ProcessName;
                }
            }
            catch
            {
            }
            return processName + " pid=" +
                processId.ToString(CultureInfo.InvariantCulture);
        }

        private static string InspectOwner(Func<string> inspectOwner)
        {
            if (inspectOwner == null)
            {
                return "unavailable";
            }
            try
            {
                string value = inspectOwner();
                return string.IsNullOrEmpty(value) ? "unavailable" : value;
            }
            catch
            {
                return "unavailable";
            }
        }

        private static void Report(
            Action<int, bool, IList<string>> report,
            int retryCount,
            bool succeeded,
            IList<string> owners)
        {
            if (report == null)
            {
                return;
            }
            try
            {
                report(retryCount, succeeded, owners);
            }
            catch
            {
            }
        }
    }

    public sealed class HostServices
    {
        private static readonly object LogLock = new object();

        // The record of what a run confirmed. It is written for the log
        // and for anyone reading the folder afterwards; nothing reads it
        // back into a running session.
        private const string RunManifestName = "run-manifest.json";

        // Everything one run produces lives inside MacroStudio itself,
        // never beside the workbook it read. The deliverables and the one
        // file handed to the chat are separate trees under the same run
        // name, one level deep each.
        private const string ExportsRoot = "exports";
        private const string TempRoot = "temp";
        private const string AiCodeFileName = "source-code-for-ai.md";

        private readonly Window owner;
        private readonly string baseDir;
        private readonly HashSet<string> runArtifacts;
        private string attachedBookPath;
        // The VBA as it stood when the request was prepared. The build
        // refuses to write an answer that was based on older code.
        private string attachedSourceSignature;
        private string runFolderPath;
        private string handoffFolderPath;

        public HostServices(Window owner, string baseDir)
        {
            if (string.IsNullOrEmpty(baseDir))
            {
                throw new ArgumentException(
                    "The application base directory is empty.",
                    "baseDir");
            }

            this.owner = owner;
            this.baseDir = Path.GetFullPath(baseDir);
            runArtifacts = new HashSet<string>(
                StringComparer.OrdinalIgnoreCase);
            attachedBookPath = string.Empty;
            attachedSourceSignature = null;
            runFolderPath = string.Empty;
            handoffFolderPath = string.Empty;
        }

        // The order of the cards is the order of the file names, with a
        // leading number read as a number: "10_" follows "2_" instead of
        // preceding it. Files with no leading number come after the
        // numbered ones, in name order.
        private static int ReadLeadingNumber(string name)
        {
            int digits = 0;
            int value;

            while (digits < name.Length &&
                name[digits] >= '0' &&
                name[digits] <= '9')
            {
                digits++;
            }
            if (digits == 0 ||
                !int.TryParse(
                    name.Substring(0, digits),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out value))
            {
                return int.MaxValue;
            }
            return value;
        }

        private static int ComparePresetFiles(string left, string right)
        {
            string leftName = Path.GetFileName(left);
            string rightName = Path.GetFileName(right);
            int leftOrder = ReadLeadingNumber(leftName);
            int rightOrder = ReadLeadingNumber(rightName);

            if (leftOrder != rightOrder)
            {
                return leftOrder < rightOrder ? -1 : 1;
            }
            return string.Compare(
                leftName,
                rightName,
                StringComparison.OrdinalIgnoreCase);
        }

        private List<Dictionary<string, object>> ReadPresetGroup(
            string folderName)
        {
            List<Dictionary<string, object>> presets =
                new List<Dictionary<string, object>>();
            string groupRoot = Path.Combine(
                baseDir,
                "presets",
                folderName);
            if (Directory.Exists(groupRoot))
            {
                string[] files = Directory.GetFiles(
                    groupRoot,
                    "*.md",
                    SearchOption.TopDirectoryOnly);
                Array.Sort(files, ComparePresetFiles);

                int index;
                for (index = 0; index < files.Length; index++)
                {
                    if (!string.Equals(
                        Path.GetExtension(files[index]),
                        ".md",
                        StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    Dictionary<string, object> preset =
                        new Dictionary<string, object>();
                    preset.Add(
                        "file",
                        Path.Combine(
                            folderName,
                            Path.GetFileName(files[index])));

                    // The preset markdown is parsed in the UI, so the
                    // preset name and its sections have exactly one
                    // implementation. The host only carries the text.
                    try
                    {
                        preset.Add(
                            "content",
                            File.ReadAllText(
                                files[index],
                                new UTF8Encoding(false, true)));
                    }
                    catch (Exception)
                    {
                        preset.Add("content", string.Empty);
                        preset.Add("error", "read");
                    }
                    presets.Add(preset);
                }
            }
            return presets;
        }

        public Dictionary<string, object> GetAppInfo()
        {
            Dictionary<string, object> presets =
                new Dictionary<string, object>();
            presets.Add(
                "diagnose",
                ReadPresetGroup("01_\u8A3A\u65AD"));
            presets.Add(
                "repair",
                ReadPresetGroup("02_\u6539\u4FEE"));

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("version", "beta 2.0.0");
            result.Add("presets", presets);
            result.Add(
                "buildFileLabel",
                LoadAssetText("build-file-label.txt"));
            return result;
        }

        public Dictionary<string, object> PickBook()
        {
            OpenFileDialog dialog = new OpenFileDialog();
            dialog.Title = "Select an Excel macro workbook";
            dialog.Filter =
                "Excel macro workbooks (*.xlsm;*.xlam;*.xlsb)" +
                "|*.xlsm;*.xlam;*.xlsb|All files (*.*)|*.*";
            dialog.FilterIndex = 1;
            dialog.Multiselect = false;
            dialog.CheckFileExists = true;

            bool? selected;
            if (owner == null)
            {
                selected = dialog.ShowDialog();
            }
            else
            {
                selected = dialog.ShowDialog(owner);
            }
            if (selected != true)
            {
                return null;
            }

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("path", dialog.FileName);
            return result;
        }

        // A location for the reader to point at instead of typing. The
        // same dialog the workbook is chosen with, opened on folders:
        // they walk into the one they mean and press Open. Nothing is
        // read or written - the path comes back as text they can still
        // check and edit, exactly as if they had typed it.
        public Dictionary<string, object> PickLocation()
        {
            OpenFileDialog dialog = new OpenFileDialog();
            Dictionary<string, object> result;
            string chosen;
            string folder;
            bool? selected;

            dialog.Title = "Select a folder";
            dialog.CheckFileExists = false;
            dialog.CheckPathExists = true;
            dialog.ValidateNames = false;
            dialog.Multiselect = false;
            dialog.FileName = "folder";

            if (owner == null)
            {
                selected = dialog.ShowDialog();
            }
            else
            {
                selected = dialog.ShowDialog(owner);
            }
            if (selected != true)
            {
                return null;
            }
            chosen = dialog.FileName;
            folder = Path.GetDirectoryName(chosen);
            if (string.IsNullOrEmpty(folder))
            {
                return null;
            }
            result = new Dictionary<string, object>();
            result.Add(
                "path",
                folder.EndsWith("\\", StringComparison.Ordinal)
                    ? folder
                    : folder + "\\");
            return result;
        }

        private static Dictionary<string, object> CreateInventory(
            string fullPath,
            VbaProjectData project)
        {
            BookInventory inventory;
            Dictionary<string, object> item =
                new Dictionary<string, object>();
            byte[] bookBytes;

            try
            {
                bookBytes = File.ReadAllBytes(fullPath);
            }
            catch (IOException)
            {
                bookBytes = null;
            }
            catch (UnauthorizedAccessException)
            {
                bookBytes = null;
            }
            inventory = BookInventoryReader.Read(
                fullPath,
                bookBytes,
                project);
            item.Add("sha256", inventory.Sha256);
            item.Add("sizeBytes", inventory.SizeBytes);
            item.Add("modifiedUtc", inventory.ModifiedUtc);
            item.Add("references", inventory.References.ToArray());
            item.Add("connections", inventory.Connections.ToArray());
            item.Add("barcodeFonts", inventory.BarcodeFonts.ToArray());
            item.Add("hasPowerQuery", inventory.HasPowerQuery);
            item.Add("activeXCount", inventory.ActiveXCount);
            item.Add("externalLinkCount", inventory.ExternalLinkCount);
            item.Add("hasVbaSignature", inventory.HasVbaSignature);
            item.Add("complete", inventory.Complete);
            return item;
        }

        public Dictionary<string, object> AttachBook(string path)
        {
            string fullPath = ValidateAttachPath(path);
            VbaProjectData project = BookIO.ReadProject(fullPath);

            List<Dictionary<string, object>> modules =
                new List<Dictionary<string, object>>();
            int totalLines = 0;
            int index;
            for (index = 0; index < project.Modules.Count; index++)
            {
                VbaModule module = project.Modules[index];
                int lineCount = CountLines(module.Code);
                totalLines = checked(totalLines + lineCount);

                Dictionary<string, object> item =
                    new Dictionary<string, object>();
                item.Add("name", module.Name);
                item.Add("type", GetModuleType(module.Kind));
                item.Add(
                    "typeLabel",
                    GetModuleTypeLabel(module.Kind));
                item.Add("ext", module.Extension);
                item.Add("lineCount", lineCount);
                item.Add("code", module.Code);
                item.Add("attributes", module.AttributeHeader);
                modules.Add(item);
            }

            Dictionary<string, object> book =
                new Dictionary<string, object>();
            book.Add("path", fullPath);
            book.Add("name", Path.GetFileName(fullPath));
            book.Add(
                "ext",
                Path.GetExtension(fullPath).ToLowerInvariant());
            book.Add("totalLines", totalLines);

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("book", book);
            result.Add("modules", modules);
            result.Add("warning", project.HasReadWarnings);
            // What the warning was about. The screen needs this to say
            // whether the VBA source is in doubt or only the workbook's
            // internal bookkeeping was off, instead of warning about
            // everything in the same breath.
            result.Add("read", CreateReadReport(project));
            // Everything in the workbook that is not VBA code. This tool
            // does not change any of it, so the screen and the handover
            // memo can only name it and hand it to a person.
            result.Add("inventory", CreateInventory(fullPath, project));

            attachedBookPath = fullPath;
            attachedSourceSignature =
                BookIO.CreateSourceSignature(project);
            runFolderPath = string.Empty;
            handoffFolderPath = string.Empty;
            runArtifacts.Clear();
            return result;
        }

        // "sourceDoubt" is the only level that asks the user to do
        // something. Everything else is reported as read-and-complete,
        // with one line naming what was off.
        private static Dictionary<string, object> CreateReadReport(
            VbaProjectData project)
        {
            Dictionary<string, object> report =
                new Dictionary<string, object>();
            bool doubt = project.HasSourceDoubt();

            report.Add(
                "level",
                !project.HasReadWarnings
                    ? "clean"
                    : doubt ? "sourceDoubt" : "structureOnly");
            report.Add("partialModules", project.PartialSourceModules);
            report.Add(
                "recoveredOffsetModules",
                project.RecoveredOffsetModules);
            report.Add("unreadableModules", project.UnreadableModules);
            report.Add("containerFallback", project.ContainerFallback);
            report.Add("salvaged", project.Salvaged);
            report.Add(
                "shortStream",
                project.Ole2 != null && project.Ole2.HasShortStreamRead);
            return report;
        }

        public Dictionary<string, object> ReadPreset(string file)
        {
            if (string.IsNullOrEmpty(file))
            {
                throw new HostActionException(
                    "E-SYS-02",
                    "The preset file name is empty.");
            }

            string presetRoot = Path.GetFullPath(
                Path.Combine(baseDir, "presets"));
            string rootPrefix = presetRoot.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar) +
                Path.DirectorySeparatorChar;
            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(
                    Path.Combine(presetRoot, file));
            }
            catch (Exception ex)
            {
                throw new HostActionException(
                    "E-SYS-02",
                    "The preset path is invalid.",
                    null,
                    ex);
            }

            if (!fullPath.StartsWith(
                rootPrefix,
                StringComparison.OrdinalIgnoreCase) ||
                !string.Equals(
                    Path.GetExtension(fullPath),
                    ".md",
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new HostActionException(
                    "E-SYS-02",
                    "The preset is outside the presets directory.");
            }
            if (!File.Exists(fullPath))
            {
                throw new HostActionException(
                    "E-SYS-02",
                    "The preset file was not found.");
            }

            string content;
            try
            {
                content = File.ReadAllText(
                    fullPath,
                    new UTF8Encoding(false, true));
            }
            catch (DecoderFallbackException ex)
            {
                string userMessage = LoadAssetText(
                    "preset-encoding-error.txt");
                Dictionary<string, object> errorData =
                    new Dictionary<string, object>();
                errorData.Add("userMessage", userMessage);
                throw new HostActionException(
                    "E-SYS-02",
                    userMessage,
                    errorData,
                    ex);
            }
            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("content", content);
            return result;
        }

        public Dictionary<string, object> ReadRequestTemplate(string name)
        {
            if (string.IsNullOrEmpty(name) ||
                !Regex.IsMatch(name, "^[a-z-]+$"))
            {
                throw new HostActionException(
                    "E-GEN-02",
                    "The request template name is invalid.");
            }

            string templateRoot = Path.GetFullPath(
                Path.Combine(baseDir, "templates"));
            string rootPrefix = templateRoot.TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar) +
                Path.DirectorySeparatorChar;
            string path = Path.GetFullPath(Path.Combine(
                templateRoot,
                name + ".txt"));
            if (!path.StartsWith(
                rootPrefix,
                StringComparison.OrdinalIgnoreCase))
            {
                throw new HostActionException(
                    "E-GEN-02",
                    "The request template is outside the templates directory.");
            }
            string content;
            try
            {
                content = File.ReadAllText(
                    path,
                    new UTF8Encoding(false, true));
            }
            catch (Exception ex)
            {
                throw new HostActionException(
                    "E-GEN-02",
                    "The request template could not be read.",
                    null,
                    ex);
            }

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("content", content);
            return result;
        }

        public Dictionary<string, object> GetTargetEnvironment()
        {
            string path = Path.Combine(
                baseDir,
                "environment",
                "target-environment.json");
            string content;
            try
            {
                // The host is only the strict UTF-8 transport. Schema
                // validation and prompt rendering have one implementation in
                // assets/js/target-environment.js.
                content = File.ReadAllText(
                    path,
                    new UTF8Encoding(false, true));
            }
            catch (Exception ex)
            {
                Dictionary<string, object> errorData =
                    new Dictionary<string, object>();
                errorData.Add("validationId", "ENV-READ");
                throw new HostActionException(
                    "E-ENV-01",
                    "The target environment file could not be read.",
                    errorData,
                    ex);
            }

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("content", content);
            return result;
        }

        // Every run gets one folder next to the workbook:
        // <book folder>\MacroStudio\<book base>_<timestamp>.
        // Diagnosis creates it and its immutable source-code.md; later
        // stages only add or generation-replace their own run artifact.
        public Dictionary<string, object> WriteRequestFiles(
            string stage,
            string outputTimestamp,
            string request,
            string code,
            string aiCode)
        {
            bool diagnose = string.Equals(
                stage,
                "diagnose",
                StringComparison.Ordinal);
            bool repair = string.Equals(
                stage,
                "repair",
                StringComparison.Ordinal);
            if ((!diagnose && !repair) || request == null ||
                (diagnose && code == null))
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The request stage or content is missing.");
            }
            ValidateOutputTimestamp(outputTimestamp);

            string sourcePath = RequireAttachedBook("E-GEN-01");
            string folder;
            string handoffFolder;
            string requestPath;
            string codePath = null;
            string aiCodePath = null;
            string attachText = aiCode == null ? code : aiCode;
            try
            {
                if (diagnose && string.IsNullOrEmpty(runFolderPath))
                {
                    folder = CreateNewRunFolder(
                        sourcePath,
                        outputTimestamp);
                    requestPath = Path.Combine(
                        folder,
                        "diagnose-request.md");
                    codePath = Path.Combine(folder, "source-code.md");
                    WriteInitialDiagnosisFiles(
                        folder,
                        requestPath,
                        request,
                        codePath,
                        code);
                }
                else
                {
                    folder = RequireRunFolder();
                    requestPath = Path.Combine(
                        folder,
                        diagnose
                            ? "diagnose-request.md"
                            : "repair-request.md");
                    WriteRunFileAtomically(
                        requestPath,
                        request,
                        runArtifacts.Contains(requestPath));
                    codePath = Path.Combine(folder, "source-code.md");
                    if (!runArtifacts.Contains(codePath) ||
                        !File.Exists(codePath))
                    {
                        throw new HostActionException(
                            "E-GEN-01",
                            "The source code file for this run is missing.");
                    }
                }

                // The one file the chat is actually given. It is written
                // every time a request is made, because the fixed-path
                // route hands over code the machine already rewrote while
                // source-code.md above stays the workbook as it was read.
                handoffFolder = CreateHandoffFolder(
                    sourcePath,
                    outputTimestamp);
                aiCodePath = Path.Combine(handoffFolder, AiCodeFileName);
                if (attachText != null)
                {
                    WriteRunFileAtomically(
                        aiCodePath,
                        attachText,
                        runArtifacts.Contains(aiCodePath));
                }
                else if (!File.Exists(aiCodePath))
                {
                    throw new HostActionException(
                        "E-GEN-01",
                        "The code file for the chat is missing.");
                }
            }
            catch (HostActionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The request files could not be created.",
                    null,
                    ex);
            }

            runFolderPath = folder;
            handoffFolderPath = handoffFolder;
            runArtifacts.Add(requestPath);
            runArtifacts.Add(aiCodePath);
            if (codePath != null)
            {
                runArtifacts.Add(codePath);
            }
            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("folderPath", folder);
            result.Add("requestPath", requestPath);
            result.Add("handoffFolderPath", handoffFolder);
            result.Add("aiCodePath", aiCodePath);
            result.Add("aiCodeName", AiCodeFileName);
            if (codePath != null)
            {
                result.Add("codePath", codePath);
            }
            return result;
        }

        public Dictionary<string, object> WriteDiagnosisFile(
            string outputTimestamp,
            string markdown)
        {
            if (markdown == null)
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The diagnosis markdown is missing.");
            }
            ValidateOutputTimestamp(outputTimestamp);
            RequireAttachedBook("E-GEN-01");

            string folder = RequireRunFolder();
            string path = Path.Combine(folder, "diagnosis.md");
            try
            {
                WriteRunFileAtomically(
                    path,
                    markdown,
                    runArtifacts.Contains(path));
            }
            catch (HostActionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The diagnosis file could not be created.",
                    null,
                    ex);
            }

            runArtifacts.Add(path);
            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("path", path);
            return result;
        }

        // One record of what this run has confirmed, written beside the
        // artifacts it describes. The screen, the log, result.md and a
        // resumed session all read the same values from here, so they
        // cannot drift apart. The host stores and returns the text; the
        // shape of it belongs to assets/js/state.js.
        public Dictionary<string, object> WriteRunManifest(
            string outputTimestamp,
            string manifest)
        {
            if (manifest == null)
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The run manifest is missing.");
            }
            ValidateOutputTimestamp(outputTimestamp);
            RequireAttachedBook("E-GEN-01");

            string folder = RequireRunFolder();
            string path = Path.Combine(folder, RunManifestName);
            try
            {
                WriteRunFileAtomically(
                    path,
                    manifest,
                    runArtifacts.Contains(path));
            }
            catch (HostActionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The run manifest could not be written.",
                    null,
                    ex);
            }

            runArtifacts.Add(path);
            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("path", path);
            return result;
        }

        public Dictionary<string, object> ReadClipboard()
        {
            string text = null;
            ClipboardRetry.Execute(
                "E-GEN-04",
                "The clipboard could not be read.",
                delegate()
                {
                    text = Clipboard.GetText();
                },
                Thread.Sleep,
                ClipboardRetry.InspectOpenClipboardOwner,
                delegate(
                    int retryCount,
                    bool succeeded,
                    IList<string> owners)
                {
                    ReportClipboardRetry(
                        "read",
                        retryCount,
                        succeeded,
                        owners);
                });

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("text", text);
            return result;
        }

        public Dictionary<string, object> WriteClipboard(
            string text)
        {
            if (text == null)
            {
                throw new HostActionException(
                    "E-GEN-03",
                    "The clipboard text is missing.");
            }

            ClipboardRetry.Execute(
                "E-GEN-03",
                "The clipboard could not be updated.",
                delegate()
                {
                    Clipboard.SetText(text);
                },
                Thread.Sleep,
                ClipboardRetry.InspectOpenClipboardOwner,
                delegate(
                    int retryCount,
                    bool succeeded,
                    IList<string> owners)
                {
                    ReportClipboardRetry(
                        "write",
                        retryCount,
                        succeeded,
                        owners);
                });

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("copied", true);
            return result;
        }

        private void ReportClipboardRetry(
            string operation,
            int retryCount,
            bool succeeded,
            IList<string> owners)
        {
            if (retryCount <= 0)
            {
                return;
            }
            try
            {
                string message =
                    "clipboard " + operation + " retried " +
                    retryCount.ToString(CultureInfo.InvariantCulture) +
                    " times: " + (succeeded ? "success" : "failed");
                if (!succeeded && owners != null && owners.Count > 0)
                {
                    message += "; owners: " + string.Join(", ", owners);
                }
                WriteLog(
                    "WARN",
                    message);
            }
            catch
            {
            }
        }

        public Dictionary<string, object> BuildBook(
            IDictionary<string, string> moduleChanges,
            string outputTimestamp)
        {
            return BuildBook(
                moduleChanges,
                new List<VbaModuleAddition>(),
                outputTimestamp);
        }

        public Dictionary<string, object> BuildBook(
            IDictionary<string, string> moduleChanges,
            IList<VbaModuleAddition> newModules,
            string outputTimestamp)
        {
            return BuildBookCore(
                moduleChanges,
                newModules,
                outputTimestamp,
                null,
                false,
                null,
                null,
                null);
        }

        public Dictionary<string, object> BuildBook(
            IDictionary<string, string> moduleChanges,
            IList<VbaModuleAddition> newModules,
            string outputTimestamp,
            string diffHtml)
        {
            return BuildBookCore(
                moduleChanges,
                newModules,
                outputTimestamp,
                diffHtml,
                true,
                null,
                null,
                null);
        }

        public Dictionary<string, object> BuildBook(
            IDictionary<string, string> moduleChanges,
            IList<VbaModuleAddition> newModules,
            string outputTimestamp,
            string diffHtml,
            string outputName)
        {
            return BuildBookCore(
                moduleChanges,
                newModules,
                outputTimestamp,
                diffHtml,
                true,
                outputName,
                null,
                null);
        }

        public Dictionary<string, object> BuildBook(
            IDictionary<string, string> moduleChanges,
            IList<VbaModuleAddition> newModules,
            string outputTimestamp,
            string diffHtml,
            string outputName,
            string resultMarkdown)
        {
            return BuildBookCore(
                moduleChanges,
                newModules,
                outputTimestamp,
                diffHtml,
                true,
                outputName,
                resultMarkdown,
                null);
        }

        public Dictionary<string, object> BuildBook(
            IDictionary<string, string> moduleChanges,
            IList<VbaModuleAddition> newModules,
            string outputTimestamp,
            string diffHtml,
            string outputName,
            string resultMarkdown,
            string diffName)
        {
            return BuildBookCore(
                moduleChanges,
                newModules,
                outputTimestamp,
                diffHtml,
                true,
                outputName,
                resultMarkdown,
                diffName);
        }

        private Dictionary<string, object> BuildBookCore(
            IDictionary<string, string> moduleChanges,
            IList<VbaModuleAddition> newModules,
            string outputTimestamp,
            string diffHtml,
            bool createDiffReport,
            string outputName,
            string resultMarkdown,
            string diffName)
        {
            if (moduleChanges == null)
            {
                throw new HostActionException(
                    "E-BUILD-01",
                    "The build module list is missing.");
            }
            if (newModules == null)
            {
                throw new HostActionException(
                    "E-BUILD-01",
                    "The new module list is missing.");
            }
            ValidateOutputTimestamp(outputTimestamp);

            string sourcePath = RequireAttachedBook("E-BUILD-01");
            string outputPath;
            string folder;
            try
            {
                folder = CreateRunFolder(sourcePath, outputTimestamp);
                outputPath = Path.Combine(
                    folder,
                    ResolveOutputName(sourcePath, outputName));
            }
            catch (HostActionException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new HostActionException(
                    "E-BUILD-01",
                    "The build output path could not be created.",
                    null,
                    ex);
            }
            runFolderPath = folder;

            // Building again after a success is a documented way through
            // the flow, and the run folder is fixed when the request is
            // written. So the workbook this run already produced may be
            // replaced by the next generation, while a file of the same
            // name that this run did not write is never touched.
            BookBuildResult build = BookIO.BuildCopy(
                sourcePath,
                outputPath,
                moduleChanges,
                newModules,
                attachedSourceSignature,
                runArtifacts.Contains(outputPath));
            Dictionary<string, object> data =
                CreateBuildData(build);
            if (!build.Success)
            {
                string errorCode = string.IsNullOrEmpty(
                    build.ErrorCode) ?
                    "E-BUILD-01" :
                    build.ErrorCode;
                string message = string.IsNullOrEmpty(
                    build.Message) ?
                    "The workbook build failed." :
                    build.Message;
                throw new HostActionException(
                    errorCode,
                    message,
                    data);
            }
            runArtifacts.Add(outputPath);

            if (createDiffReport)
            {
                try
                {
                    data.Add(
                        "diffPath",
                        WriteDiffReport(
                            folder,
                            ResolveDiffReportName(sourcePath, diffName),
                            diffHtml));
                }
                catch (Exception ex)
                {
                    data.Add(
                        "diffError",
                        "The diff report file could not be created.");
                    WriteDiffReportError(ex);
                }
            }
            // The plain summary of the run. Losing it never fails a
            // build that already produced a workbook.
            if (!string.IsNullOrEmpty(resultMarkdown))
            {
                try
                {
                    data.Add(
                        "resultPath",
                        WriteRunFile(
                            folder,
                            "result.md",
                            resultMarkdown));
                }
                catch (Exception ex)
                {
                    data.Add(
                        "resultError",
                        "The result file could not be created.");
                    WriteDiffReportError(ex);
                }
            }
            return data;
        }

        // Explorer never reports that it could not resolve a target: given
        // a path that is gone it quietly opens the default folder, which on
        // this machine is the Desktop. Started that way, Process.Start
        // still succeeds, so the app would tell the user it had opened the
        // output folder while an unrelated window was on screen. The target
        // is therefore checked here, and a missing one is an error rather
        // than a window.
        public void RevealPath(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw new ArgumentException(
                    "The path to reveal is empty.",
                    "path");
            }

            string fullPath = Path.GetFullPath(path);
            if (Directory.Exists(fullPath))
            {
                Process.Start(
                    "explorer.exe",
                    "\"" + fullPath + "\"");
                return;
            }
            if (File.Exists(fullPath))
            {
                Process.Start(
                    "explorer.exe",
                    "/select,\"" + fullPath + "\"");
                return;
            }

            string userMessage = LoadAssetText(
                "reveal-missing-error.txt");
            Dictionary<string, object> errorData =
                new Dictionary<string, object>();
            errorData.Add("userMessage", userMessage);
            throw new HostActionException(
                "E-SYS-02",
                "The path to reveal does not exist: " + fullPath,
                errorData);
        }

        public void WriteLog(string level, string message)
        {
            if (string.IsNullOrEmpty(level))
            {
                throw new ArgumentException(
                    "The log level is empty.",
                    "level");
            }
            if (message == null)
            {
                throw new ArgumentNullException("message");
            }

            string logDir = Path.Combine(
                Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                "MacroStudio",
                "logs");
            string logPath = Path.Combine(
                logDir,
                "macrostudio_" +
                DateTime.Now.ToString("yyyyMMdd") +
                ".log");
            string line =
                "[" + DateTime.Now.ToString("HH:mm:ss") + "] " +
                "[" + level.ToUpperInvariant() + "] " +
                message;

            lock (LogLock)
            {
                Directory.CreateDirectory(logDir);
                using (FileStream output = new FileStream(
                    logPath,
                    FileMode.Append,
                    FileAccess.Write,
                    FileShare.ReadWrite))
                using (StreamWriter writer = new StreamWriter(
                    output,
                    new UTF8Encoding(false)))
                {
                    writer.WriteLine(line);
                }
            }
        }

        private string ValidateAttachPath(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw new MacroStudioException(
                    "E-ATTACH-02",
                    "The workbook path is empty.");
            }

            string fullPath;
            try
            {
                fullPath = Path.GetFullPath(path);
            }
            catch (Exception ex)
            {
                throw new MacroStudioException(
                    "E-ATTACH-02",
                    "The workbook path is invalid.",
                    ex);
            }

            // No extension gate and no exclusive-lock probe here: the
            // container kind is decided from the file content by BookIO,
            // and books stay attachable while they are open in Excel.
            return fullPath;
        }

        private string RequireAttachedBook(string errorCode)
        {
            if (string.IsNullOrEmpty(attachedBookPath))
            {
                throw new HostActionException(
                    errorCode,
                    "No workbook is attached.");
            }
            return attachedBookPath;
        }

        // The name one run answers to. Both trees use it, so the
        // deliverables and the file handed to the chat can be told apart
        // and still be recognised as the same piece of work.
        private static string RunName(string sourcePath, string timestamp)
        {
            return Path.GetFileNameWithoutExtension(sourcePath) +
                "_" + timestamp;
        }

        // Everything a run produces lives inside MacroStudio, not beside
        // the workbook it read. `exports` holds what the reader keeps;
        // `temp` holds the one file the chat is given. One level each:
        // the run folder is both the case and the run, so there is
        // nothing to nest inside it.
        private string RunTree(string treeName)
        {
            return Path.Combine(baseDir, treeName);
        }

        // The folder is fixed when the first request is written, so every
        // later output of the same run joins it.
        private string CreateRunFolder(
            string sourcePath,
            string timestamp)
        {
            string folder = Path.Combine(
                RunTree(ExportsRoot),
                RunName(sourcePath, timestamp));

            if (!string.IsNullOrEmpty(runFolderPath) &&
                Directory.Exists(runFolderPath))
            {
                return runFolderPath;
            }
            Directory.CreateDirectory(folder);
            return folder;
        }

        private string CreateNewRunFolder(
            string sourcePath,
            string timestamp)
        {
            string folder = Path.Combine(
                RunTree(ExportsRoot),
                RunName(sourcePath, timestamp));

            if (Directory.Exists(folder))
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The run folder already exists.");
            }
            Directory.CreateDirectory(folder);
            return folder;
        }

        // The chat's copy. Only what is actually attached goes here, and
        // it never mixes with the deliverables: the request text itself
        // goes to the clipboard, as it always has.
        private string CreateHandoffFolder(
            string sourcePath,
            string timestamp)
        {
            string folder = Path.Combine(
                RunTree(TempRoot),
                RunName(sourcePath, timestamp));

            Directory.CreateDirectory(folder);
            return folder;
        }

        private string RequireRunFolder()
        {
            if (string.IsNullOrEmpty(runFolderPath) ||
                !Directory.Exists(runFolderPath))
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The run folder has not been created.");
            }
            return runFolderPath;
        }

        private void WriteInitialDiagnosisFiles(
            string folder,
            string requestPath,
            string request,
            string codePath,
            string code)
        {
            bool requestCreated = false;
            bool codeCreated = false;
            try
            {
                WriteRunFileAtomically(requestPath, request, false);
                requestCreated = true;
                WriteRunFileAtomically(codePath, code, false);
                codeCreated = true;
            }
            catch
            {
                try
                {
                    if (codeCreated && File.Exists(codePath))
                    {
                        File.Delete(codePath);
                    }
                    if (requestCreated && File.Exists(requestPath))
                    {
                        File.Delete(requestPath);
                    }
                    if (Directory.Exists(folder) &&
                        Directory.GetFileSystemEntries(folder).Length == 0)
                    {
                        Directory.Delete(folder, false);
                    }
                }
                catch
                {
                }
                throw;
            }
        }

        private void WriteRunFileAtomically(
            string outputPath,
            string content,
            bool replacing)
        {
            bool exists = File.Exists(outputPath);
            if ((exists && !replacing) || (!exists && replacing))
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The run artifact generation is not owned by this run.");
            }

            string directory = Path.GetDirectoryName(outputPath);
            string fileName = Path.GetFileName(outputPath);
            string token = Guid.NewGuid().ToString("N");
            string temporaryPath = Path.Combine(
                directory,
                "." + fileName + "." + token + ".tmp");
            string backupPath = Path.Combine(
                directory,
                "." + fileName + "." + token + ".previous");
            bool committed = false;
            try
            {
                using (FileStream output = new FileStream(
                    temporaryPath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None,
                    4096,
                    FileOptions.WriteThrough))
                using (StreamWriter writer = new StreamWriter(
                    output,
                    new UTF8Encoding(true)))
                {
                    writer.Write(content);
                    writer.Flush();
                    output.Flush(true);
                }

                if (replacing)
                {
                    File.Replace(
                        temporaryPath,
                        outputPath,
                        backupPath,
                        true);
                }
                else
                {
                    File.Move(temporaryPath, outputPath);
                }
                committed = true;
            }
            finally
            {
                if (!committed)
                {
                    try
                    {
                        if (File.Exists(temporaryPath))
                        {
                            File.Delete(temporaryPath);
                        }
                    }
                    catch
                    {
                    }
                }
                try
                {
                    if (File.Exists(backupPath))
                    {
                        File.Delete(backupPath);
                    }
                }
                catch
                {
                    // The target generation is already committed. A stale
                    // backup is cleanup debt, not a failed transaction.
                }
            }
        }

        // yyyyMMdd of today, for the fallback names. The screen normally
        // supplies the name, and it carries the date of the run it
        // belongs to; this is only used when nothing was supplied.
        private static string TodayStamp()
        {
            return DateTime.Now.ToString(
                "yyyyMMdd",
                CultureInfo.InvariantCulture);
        }

        // The name comes from the screen, so it is checked here: a
        // file name only, keeping the workbook kind.
        private string ResolveOutputName(
            string sourcePath,
            string outputName)
        {
            string extension = Path.GetExtension(sourcePath);
            string fallback =
                Path.GetFileNameWithoutExtension(sourcePath) +
                "-Modified-" + TodayStamp() + extension;

            return ResolveRunFileName(
                outputName,
                extension,
                fallback);
        }

        // The report's name is fixed by the screen the same way, and it
        // is always an .html file beside the workbook it describes.
        private string ResolveDiffReportName(
            string sourcePath,
            string diffName)
        {
            string fallback =
                Path.GetFileNameWithoutExtension(sourcePath) +
                "-Diff-Report-" + TodayStamp() + ".html";

            return ResolveRunFileName(diffName, ".html", fallback);
        }

        private static string ResolveRunFileName(
            string requested,
            string extension,
            string fallback)
        {
            string candidate = requested == null
                ? string.Empty
                : requested.Trim();

            if (candidate.Length == 0)
            {
                return fallback;
            }
            if (candidate.Length > 120 ||
                candidate.IndexOfAny(
                    Path.GetInvalidFileNameChars()) >= 0 ||
                candidate.IndexOf("..", StringComparison.Ordinal) >= 0 ||
                !string.Equals(
                    Path.GetExtension(candidate),
                    extension,
                    StringComparison.OrdinalIgnoreCase))
            {
                throw new HostActionException(
                    "E-BUILD-03",
                    "The output file name is not usable.");
            }
            return candidate;
        }

        private void WriteTextFile(string path, string content)
        {
            using (FileStream output = new FileStream(
                path,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None))
            using (StreamWriter writer = new StreamWriter(
                output,
                new UTF8Encoding(true)))
            {
                writer.Write(content);
            }
        }

        private string WriteDiffReport(
            string folder,
            string fileName,
            string content)
        {
            if (content == null)
            {
                throw new InvalidDataException(
                    "The diff report content is missing.");
            }

            return WriteRunFile(folder, fileName, content);
        }

        // A run's own note or report may be rewritten by the next build
        // of the same run, so the folder never mixes generations. A file
        // this run did not write is left alone: CreateNew still refuses
        // to overwrite anything that was already there.
        private string WriteRunFile(
            string folder,
            string fileName,
            string content)
        {
            string outputPath = Path.Combine(
                folder,
                fileName);
            bool replacing = runArtifacts.Contains(outputPath);
            bool created = false;
            try
            {
                using (FileStream output = new FileStream(
                    outputPath,
                    replacing ? FileMode.Create : FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None))
                {
                    created = !replacing;
                    using (StreamWriter writer = new StreamWriter(
                        output,
                        new UTF8Encoding(true)))
                    {
                        writer.Write(content);
                    }
                }
            }
            catch
            {
                try
                {
                    if (created && File.Exists(outputPath))
                    {
                        File.Delete(outputPath);
                    }
                }
                catch
                {
                }
                throw;
            }
            runArtifacts.Add(outputPath);
            return outputPath;
        }

        private void WriteDiffReportError(Exception error)
        {
            try
            {
                WriteLog(
                    "ERROR",
                    "diff report: " + error.ToString());
            }
            catch
            {
            }
        }

        private static void ValidateOutputTimestamp(string value)
        {
            DateTime parsed;
            if (string.IsNullOrEmpty(value) ||
                value.Length != 15 ||
                !DateTime.TryParseExact(
                    value,
                    "yyyyMMdd_HHmmss",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.None,
                    out parsed))
            {
                throw new HostActionException(
                    "E-BUILD-01",
                    "The build output timestamp is invalid.");
            }
        }

        private string GetModuleTypeLabel(VbaModuleKind kind)
        {
            switch (kind)
            {
                case VbaModuleKind.Document:
                    return LoadAssetText(
                        "module-type-document.txt");
                case VbaModuleKind.Form:
                    return LoadAssetText(
                        "module-type-form.txt");
                case VbaModuleKind.Standard:
                    return LoadAssetText(
                        "module-type-standard.txt");
                case VbaModuleKind.Class:
                    return LoadAssetText(
                        "module-type-class.txt");
                default:
                    throw new InvalidDataException(
                        "Unknown VBA module type.");
            }
        }

        private string LoadAssetText(string fileName)
        {
            string path = Path.Combine(
                baseDir,
                "assets",
                "messages",
                fileName);
            string value = File.ReadAllText(
                path,
                Encoding.UTF8).Trim();
            if (value.Length == 0)
            {
                throw new InvalidDataException(
                    "An application text asset is empty: " +
                    fileName);
            }
            return value;
        }

        private static string GetModuleType(VbaModuleKind kind)
        {
            switch (kind)
            {
                case VbaModuleKind.Document:
                    return "document";
                case VbaModuleKind.Form:
                    return "form";
                case VbaModuleKind.Standard:
                    return "standard";
                case VbaModuleKind.Class:
                    return "class";
                default:
                    throw new InvalidDataException(
                        "Unknown VBA module type.");
            }
        }

        private static int CountLines(string code)
        {
            if (string.IsNullOrEmpty(code))
            {
                return 0;
            }

            int count = 1;
            int index;
            for (index = 0; index < code.Length; index++)
            {
                if (code[index] == '\r')
                {
                    count++;
                    if (index + 1 < code.Length &&
                        code[index + 1] == '\n')
                    {
                        index++;
                    }
                }
                else if (code[index] == '\n')
                {
                    count++;
                }
            }

            char last = code[code.Length - 1];
            if (last == '\r' || last == '\n')
            {
                count--;
            }
            return count;
        }

        private static Dictionary<string, object> CreateBuildData(
            BookBuildResult build)
        {
            List<Dictionary<string, object>> results =
                new List<Dictionary<string, object>>();
            int index;
            for (index = 0; index < build.Results.Count; index++)
            {
                ModuleBuildResult source = build.Results[index];
                Dictionary<string, object> item =
                    new Dictionary<string, object>();
                item.Add("name", source.Name);
                item.Add("result", source.Result);
                item.Add("message", source.Message);
                results.Add(item);
            }

            Dictionary<string, object> data =
                new Dictionary<string, object>();
            data.Add("outputPath", build.OutputPath);
            data.Add("results", results);
            return data;
        }
    }
}
