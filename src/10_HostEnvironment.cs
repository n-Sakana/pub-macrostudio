using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace MacroStudio
{
    // What can be observed about the machine MacroStudio is running on
    // right now. This is not a property of the workbook and must never be
    // presented as one: a workbook opened on another terminal will meet
    // another runtime. Nothing here starts Excel or touches COM; every
    // value is read from the registry and the process, read-only, and
    // anything that cannot be read stays unknown rather than guessed.
    public sealed class HostRuntimeFacts
    {
        public const string Unknown = "unknown";

        public string OsArchitecture;
        public string ProcessArchitecture;
        public string OfficeVersion;
        public string OfficeBitness;
        public string OfficeChannel;
        public List<string> Notes;

        public HostRuntimeFacts()
        {
            OsArchitecture = Unknown;
            ProcessArchitecture = Unknown;
            OfficeVersion = Unknown;
            OfficeBitness = Unknown;
            OfficeChannel = Unknown;
            Notes = new List<string>();
        }

        public bool OfficeKnown
        {
            get
            {
                return !string.Equals(
                    OfficeVersion,
                    Unknown,
                    StringComparison.Ordinal) ||
                    !string.Equals(
                        OfficeBitness,
                        Unknown,
                        StringComparison.Ordinal);
            }
        }
    }

    // Where the facts come from. The reader never touches the registry
    // itself, so a test can hand it a table and get the same answers.
    public abstract class HostFactSource
    {
        public abstract bool Is64BitOperatingSystem { get; }

        public abstract bool Is64BitProcess { get; }

        public abstract string GetEnvironmentVariable(string name);

        // path is relative to HKEY_LOCAL_MACHINE. Returns null when the
        // key or the value is absent, or when it cannot be read.
        public abstract string ReadLocalMachineString(
            string path,
            string valueName);

        public abstract string[] ReadLocalMachineSubKeyNames(string path);
    }

    public sealed class TableHostFactSource : HostFactSource
    {
        public bool Is64BitOs;
        public bool Is64BitProc;
        public Dictionary<string, string> Environment;
        public Dictionary<string, string> Values;
        public Dictionary<string, string[]> SubKeys;

        public TableHostFactSource()
        {
            Environment = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
            Values = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
            SubKeys = new Dictionary<string, string[]>(
                StringComparer.OrdinalIgnoreCase);
        }

        public override bool Is64BitOperatingSystem
        {
            get { return Is64BitOs; }
        }

        public override bool Is64BitProcess
        {
            get { return Is64BitProc; }
        }

        public override string GetEnvironmentVariable(string name)
        {
            string value;
            return Environment.TryGetValue(name, out value) ? value : null;
        }

        public override string ReadLocalMachineString(
            string path,
            string valueName)
        {
            string value;
            return Values.TryGetValue(path + "|" + valueName, out value)
                ? value
                : null;
        }

        public override string[] ReadLocalMachineSubKeyNames(string path)
        {
            string[] value;
            return SubKeys.TryGetValue(path, out value)
                ? value
                : new string[0];
        }
    }

    public sealed class RegistryHostFactSource : HostFactSource
    {
        public override bool Is64BitOperatingSystem
        {
            get { return Environment.Is64BitOperatingSystem; }
        }

        public override bool Is64BitProcess
        {
            get { return Environment.Is64BitProcess; }
        }

        public override string GetEnvironmentVariable(string name)
        {
            return Environment.GetEnvironmentVariable(name);
        }

        // Opened without write access and closed immediately. A 32-bit
        // process is pointed at the 64-bit view on purpose, so a tool
        // built for one word size still reports the machine's Office.
        public override string ReadLocalMachineString(
            string path,
            string valueName)
        {
            object value = ReadValue(RegistryView.Registry64, path, valueName);

            if (value == null)
            {
                value = ReadValue(RegistryView.Registry32, path, valueName);
            }
            return value == null
                ? null
                : Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        public override string[] ReadLocalMachineSubKeyNames(string path)
        {
            string[] names = ReadSubKeyNames(RegistryView.Registry64, path);

            if (names.Length == 0)
            {
                names = ReadSubKeyNames(RegistryView.Registry32, path);
            }
            return names;
        }

        private static object ReadValue(
            RegistryView view,
            string path,
            string valueName)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(
                    RegistryHive.LocalMachine,
                    view))
                using (RegistryKey key = baseKey.OpenSubKey(path, false))
                {
                    return key == null ? null : key.GetValue(valueName);
                }
            }
            catch (System.Security.SecurityException)
            {
                return null;
            }
            catch (UnauthorizedAccessException)
            {
                return null;
            }
            catch (System.IO.IOException)
            {
                return null;
            }
        }

        private static string[] ReadSubKeyNames(
            RegistryView view,
            string path)
        {
            try
            {
                using (RegistryKey baseKey = RegistryKey.OpenBaseKey(
                    RegistryHive.LocalMachine,
                    view))
                using (RegistryKey key = baseKey.OpenSubKey(path, false))
                {
                    return key == null ? new string[0] : key.GetSubKeyNames();
                }
            }
            catch (System.Security.SecurityException)
            {
                return new string[0];
            }
            catch (UnauthorizedAccessException)
            {
                return new string[0];
            }
            catch (System.IO.IOException)
            {
                return new string[0];
            }
        }
    }

    public static class HostRuntimeReader
    {
        private const string ClickToRun =
            @"SOFTWARE\Microsoft\Office\ClickToRun\Configuration";
        private const string OfficeRoot = @"SOFTWARE\Microsoft\Office";

        private static readonly Regex VersionKey =
            new Regex(@"^\d+\.\d+$", RegexOptions.CultureInvariant);

        public static HostRuntimeFacts Read(HostFactSource source)
        {
            HostRuntimeFacts facts = new HostRuntimeFacts();

            if (source == null)
            {
                facts.Notes.Add(
                    "実行環境を読み取る経路がありません。人が確認してください。");
                return facts;
            }
            ReadArchitecture(source, facts);
            ReadOffice(source, facts);
            if (!facts.OfficeKnown)
            {
                facts.Notes.Add(
                    "インストール済み Excel の版とビット数を読み取れませんでした。" +
                    "人が確認してください。");
            }
            return facts;
        }

        private static void ReadArchitecture(
            HostFactSource source,
            HostRuntimeFacts facts)
        {
            string declared = source.GetEnvironmentVariable(
                "PROCESSOR_ARCHITECTURE");
            string wow = source.GetEnvironmentVariable(
                "PROCESSOR_ARCHITEW6432");

            facts.ProcessArchitecture = source.Is64BitProcess ? "x64" : "x86";
            if (!string.IsNullOrEmpty(wow))
            {
                facts.OsArchitecture = Normalize(wow);
            }
            else if (!string.IsNullOrEmpty(declared))
            {
                facts.OsArchitecture = Normalize(declared);
            }
            else
            {
                facts.OsArchitecture = source.Is64BitOperatingSystem
                    ? "x64"
                    : "x86";
            }
        }

        private static string Normalize(string architecture)
        {
            string value = architecture.Trim().ToUpperInvariant();

            if (value == "AMD64" || value == "X64" || value == "IA64")
            {
                return "x64";
            }
            if (value == "X86")
            {
                return "x86";
            }
            if (value == "ARM64")
            {
                return "arm64";
            }
            return HostRuntimeFacts.Unknown;
        }

        // Click-to-Run first, because that is what a current Office
        // reports itself as. The per-version keys are the fallback for an
        // installer-based Office.
        private static void ReadOffice(
            HostFactSource source,
            HostRuntimeFacts facts)
        {
            string platform = source.ReadLocalMachineString(
                ClickToRun,
                "Platform");
            string version = source.ReadLocalMachineString(
                ClickToRun,
                "ClientVersionToReport");
            string channel = source.ReadLocalMachineString(
                ClickToRun,
                "UpdateChannel");

            if (!string.IsNullOrEmpty(platform))
            {
                facts.OfficeBitness = Normalize(platform);
            }
            if (!string.IsNullOrEmpty(version))
            {
                facts.OfficeVersion = version.Trim();
            }
            // A channel is a URL. Only whether one is configured is
            // recorded; the address itself is the owner's.
            facts.OfficeChannel = string.IsNullOrEmpty(channel)
                ? HostRuntimeFacts.Unknown
                : "設定あり";
            if (facts.OfficeKnown)
            {
                return;
            }
            ReadInstalledOffice(source, facts);
        }

        private static void ReadInstalledOffice(
            HostFactSource source,
            HostRuntimeFacts facts)
        {
            string[] names = source.ReadLocalMachineSubKeyNames(OfficeRoot);
            string best = null;
            int index;

            for (index = 0; index < names.Length; index++)
            {
                string name = names[index];
                string path;

                if (!VersionKey.IsMatch(name))
                {
                    continue;
                }
                path = OfficeRoot + @"\" + name + @"\Excel\InstallRoot";
                if (source.ReadLocalMachineString(path, "Path") == null)
                {
                    continue;
                }
                if (best == null || CompareVersions(name, best) > 0)
                {
                    best = name;
                }
            }
            if (best == null)
            {
                return;
            }
            facts.OfficeVersion = best;
            // The installer-based layout records the word size next to
            // the shared Office bits, not next to Excel.
            facts.OfficeBitness = Normalize(
                source.ReadLocalMachineString(
                    OfficeRoot + @"\" + best + @"\Outlook",
                    "Bitness") ?? "");
        }

        private static int CompareVersions(string left, string right)
        {
            string[] a = left.Split('.');
            string[] b = right.Split('.');
            int index;

            for (index = 0; index < a.Length && index < b.Length; index++)
            {
                int x = ParseInt(a[index]);
                int y = ParseInt(b[index]);

                if (x != y)
                {
                    return x < y ? -1 : 1;
                }
            }
            return 0;
        }

        private static int ParseInt(string value)
        {
            int parsed;
            return int.TryParse(
                value,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out parsed)
                ? parsed
                : 0;
        }
    }
}
