using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
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

    public sealed class HostServices
    {
        private static readonly object LogLock = new object();

        private readonly Window owner;
        private readonly string baseDir;
        private readonly HashSet<string> runArtifacts;
        private string attachedBookPath;
        // The VBA as it stood when the request was prepared. The build
        // refuses to write an answer that was based on older code.
        private string attachedSourceSignature;
        private string runFolderPath;

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

        public Dictionary<string, object> GetAppInfo()
        {
            List<Dictionary<string, object>> presets =
                new List<Dictionary<string, object>>();
            string presetRoot = Path.Combine(baseDir, "presets");
            if (Directory.Exists(presetRoot))
            {
                string[] files = Directory.GetFiles(
                    presetRoot,
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
                        Path.GetFileName(files[index]));

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

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("version", "beta 1.1.1-audit.1");
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
                "Excel macro workbooks (*.xlsm;*.xlam;*.xlsb;*.xls)" +
                "|*.xlsm;*.xlam;*.xlsb;*.xls|All files (*.*)|*.*";
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

            attachedBookPath = fullPath;
            attachedSourceSignature =
                BookIO.CreateSourceSignature(project);
            runFolderPath = string.Empty;
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
                doubt ? "sourceDoubt"
                    : !project.HasReadWarnings ? "clean" : "structureOnly");
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

        public Dictionary<string, object> ReadRequestTemplate()
        {
            string path = Path.Combine(
                baseDir,
                "templates",
                "request-template.txt");
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

        // Every run gets one folder next to the workbook:
        // <book folder>\MacroStudio\<book base>_<timestamp>        // The request, the code file, the rebuilt workbook and the
        // diff report all land there.
        public Dictionary<string, object> WriteRequestFiles(
            string outputTimestamp,
            string request,
            string code)
        {
            if (request == null || code == null)
            {
                throw new HostActionException(
                    "E-GEN-01",
                    "The request or code content is missing.");
            }
            ValidateOutputTimestamp(outputTimestamp);

            string sourcePath = RequireAttachedBook("E-GEN-01");
            string folder = null;
            string requestPath = null;
            string codePath = null;
            bool requestCreated = false;
            bool requestFilesCreated = false;
            try
            {
                // Preparing a request starts a new run, so it never
                // reuses the folder of the previous one, and nothing an
                // earlier run wrote counts as this run's own output.
                folder = CreateRunFolder(sourcePath, outputTimestamp, true);
                requestPath = Path.Combine(folder, "request.md");
                codePath = Path.Combine(folder, "source-code.md");
                WriteTextFile(requestPath, request);
                requestCreated = true;
                WriteTextFile(codePath, code);
                requestFilesCreated = true;
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
            finally
            {
                if (!requestFilesCreated)
                {
                    try
                    {
                        if (requestCreated) File.Delete(requestPath);
                        if (folder != null) Directory.Delete(folder, false);
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }

            runFolderPath = folder;
            runArtifacts.Clear();
            runArtifacts.Add(requestPath);
            runArtifacts.Add(codePath);
            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("folderPath", folder);
            result.Add("requestPath", requestPath);
            result.Add("codePath", codePath);
            return result;
        }

        public Dictionary<string, object> ReadClipboard()
        {
            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("text", Clipboard.GetText());
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

            try
            {
                Clipboard.SetText(text);
            }
            catch (Exception ex)
            {
                throw new HostActionException(
                    "E-GEN-03",
                    "The clipboard could not be updated.",
                    null,
                    ex);
            }

            Dictionary<string, object> result =
                new Dictionary<string, object>();
            result.Add("copied", true);
            return result;
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
                folder = CreateRunFolder(sourcePath, outputTimestamp, false);
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

        // One folder per run, created next to the workbook and reused
        // for every artifact of that run.
        private string CreateRunFolder(
            string sourcePath,
            string timestamp,
            bool newRun)
        {
            string directory = Path.GetDirectoryName(sourcePath);
            string name = Path.GetFileNameWithoutExtension(sourcePath);
            // Keep long workbook names from exceeding the component limit.
            // The random suffix, not the visible label, supplies uniqueness.
            if (name.Length > 48)
            {
                name = name.Substring(0, 48);
                if (char.IsHighSurrogate(name[name.Length - 1]))
                    name = name.Substring(0, name.Length - 1);
            }
            string root = Path.Combine(directory, "MacroStudio");
            string folder = Path.Combine(
                root,
                name + "_" + timestamp + "_" +
                    Guid.NewGuid().ToString("N").Substring(0, 12));

            // The folder is fixed when the request is written, so
            // every later output of the same run joins it.
            if (!newRun && !string.IsNullOrEmpty(runFolderPath))
            {
                if (!Directory.Exists(runFolderPath))
                {
                    throw new IOException("The run folder was moved or deleted.");
                }
                return runFolderPath;
            }
            Directory.CreateDirectory(folder);
            return folder;
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
            string fallback = MakeDefaultFileName(sourcePath,
                "-Modified-" + TodayStamp() + extension);

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
            string fallback = MakeDefaultFileName(sourcePath,
                "-Diff-Report-" + TodayStamp() + ".html");

            return ResolveRunFileName(diffName, ".html", fallback);
        }

        private static string MakeDefaultFileName(string sourcePath, string suffix)
        {
            string stem = Path.GetFileNameWithoutExtension(sourcePath);
            int limit = Math.Max(0, 120 - suffix.Length);
            if (stem.Length > limit)
            {
                stem = stem.Substring(0, limit);
                if (stem.Length > 0 && char.IsHighSurrogate(stem[stem.Length - 1]))
                {
                    stem = stem.Substring(0, stem.Length - 1);
                }
            }
            return stem + suffix;
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
                candidate = fallback;
            }
            if (candidate.Length > 120 ||
                candidate.IndexOfAny(
                    Path.GetInvalidFileNameChars()) >= 0 ||
                candidate.EndsWith(".", StringComparison.Ordinal) ||
                System.Text.RegularExpressions.Regex.IsMatch(candidate,
                    @"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(\.|$)",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase |
                    System.Text.RegularExpressions.RegexOptions.CultureInvariant) ||
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
            WriteAtomicText(path, content, false);
        }

        private static void WriteAtomicText(string path, string content, bool replace)
        {
            string temporary = OutputFiles.TemporaryPath(path);
            bool created = false;
            try
            {
                using (FileStream output = new FileStream(temporary,
                    FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    created = true;
                    using (StreamWriter writer = new StreamWriter(
                        output, new UTF8Encoding(true)))
                    {
                        writer.Write(content);
                    }
                }
                OutputFiles.Publish(temporary, path, replace);
                created = false;
            }
            finally
            {
                if (created)
                {
                    try { File.Delete(temporary); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
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
            WriteAtomicText(outputPath, content, runArtifacts.Contains(outputPath));
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
            // The output no longer carries the signature the source had.
            // Only the screen can tell the reader to sign it again.
            data.Add("signatureRemoved", build.SignatureRemoved);
            data.Add("results", results);
            return data;
        }
    }
}
