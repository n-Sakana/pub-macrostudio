using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;

namespace MacroStudio
{
    // Invoked by Test-Windows.ps1. All outputs stay in an owned temporary
    // directory. Excel/VBA is never executed by these tests.
    public static class CoreRegression
    {
        private static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
        }
        private static bool Equal(byte[] left, byte[] right)
        {
            if (left.Length != right.Length) return false;
            for (int i = 0; i < left.Length; i++) if (left[i] != right[i]) return false;
            return true;
        }
        private static byte[] Bytes(ZipArchiveEntry entry)
        {
            using (Stream input = entry.Open())
            using (MemoryStream output = new MemoryStream())
            {
                input.CopyTo(output);
                return output.ToArray();
            }
        }
        private static void SameNonVbaEntries(string original, string modified, string vbaEntry)
        {
            using (ZipArchive left = ZipFile.OpenRead(original))
            using (ZipArchive right = ZipFile.OpenRead(modified))
            {
                Require(left.Entries.Count == right.Entries.Count, "ZIP entry count changed.");
                foreach (ZipArchiveEntry entry in left.Entries)
                {
                    // VbaEntryName holds ZipArchiveEntry.Name (the file name),
                    // while FullName carries the path: "vbaProject.bin" against
                    // "xl/vbaProject.bin". Compare on Name so the VBA part is
                    // actually skipped (verified on Windows 2026-09-08).
                    if (entry.Name == vbaEntry) continue;
                    ZipArchiveEntry other = right.GetEntry(entry.FullName);
                    Require(other != null && Equal(Bytes(entry), Bytes(other)),
                        "Non-VBA ZIP entry changed: " + entry.FullName);
                }
            }
        }
        private static void Built(BookBuildResult result)
        {
            Require(result.Success, result.ErrorCode + ": " + result.Message);
        }
        private static void Case(string name, Action action, List<string> failures)
        {
            try { action(); Console.WriteLine("[PASS] " + name); }
            catch (Exception e)
            {
                failures.Add(name + ": " + e.Message);
                Console.WriteLine("[FAIL] " + name + "\n" + e.ToString());
            }
        }
        public static void Run(string root)
        {
            string temp = Path.Combine(Path.GetTempPath(), "MacroStudio-audit-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            Console.WriteLine("Test output: " + temp);
            List<string> failures = new List<string>();
            string sample = Path.Combine(root, "sample-book", "sample_win32_sleep.xlsm");
            string source = Path.Combine(temp, "source.xlsm");
            File.Copy(sample, source, false);
            byte[] original = File.ReadAllBytes(sample);
            VbaProjectData project = BookIO.ReadProject(source);
            Require(project.Modules.Count > 0 && !project.HasSourceDoubt(), "The sample must be readable without source doubt.");
            VbaModule module = project.Modules.Find(delegate(VbaModule m) { return m.Kind == VbaModuleKind.Standard; });
            Require(module != null, "Sample has no standard module.");
            string signature = BookIO.CreateSourceSignature(project);
            Dictionary<string, string> empty = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            Dictionary<string, string> changes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            changes.Add(module.Name, module.FullCode + "\r\n' MacroStudio audit comment\r\n");
            List<VbaModuleAddition> noAdditions = new List<VbaModuleAddition>();
            Case("compression boundaries: random and repeated data", delegate()
            {
                int[] lengths = {0, 1, 2, 3, 15, 255, 4095, 4096, 4097, 8192, 16384};
                Random random = new Random(20260908);
                foreach (int length in lengths)
                {
                    byte[] input = new byte[length]; random.NextBytes(input);
                    Require(Equal(input, VbaCompression.Decompress(VbaCompression.Compress(input))), "Random length " + length);
                    for (int i = 0; i < length; i++) input[i] = 65;
                    Require(Equal(input, VbaCompression.Decompress(VbaCompression.Compress(input))), "Repeated length " + length);
                }
                bool rejected = false;
                try { VbaCompression.Decompress(new byte[] {1, 0}); } catch (InvalidDataException) { rejected = true; }
                Require(rejected, "Truncated compressed data accepted.");
            }, failures);
            Case("signature covers hidden attributes and metadata", delegate()
            {
                string full = module.FullCode;
                try { module.FullCode = "' changed attributes\r\n" + full; Require(signature != BookIO.CreateSourceSignature(project), "Attribute signature unchanged."); }
                finally { module.FullCode = full; }
                int codePage = project.CodePage;
                try { project.CodePage = codePage + 1; Require(signature != BookIO.CreateSourceSignature(project), "Codepage signature unchanged."); }
                finally { project.CodePage = codePage; }
                string metadata = project.ProjectText;
                try { project.ProjectText += "\r\nAudit=1"; Require(signature != BookIO.CreateSourceSignature(project), "Metadata signature unchanged."); }
                finally { project.ProjectText = metadata; }
                Require(signature == BookIO.CreateSourceSignature(project), "Signature is not repeatable.");
            }, failures);
            Case("no-change rebuild preserves sources and invalidates the cache", delegate()
            {
                string dest = Path.Combine(temp, "no-change.xlsm");
                Built(BookIO.BuildCopy(source, dest, empty, noAdditions, signature, false));
                // The VBA bytes are expected to differ even here: MS-OVBA 2.3.4.1
                // requires Version 0xFFFF on write, so every build drops the
                // compiled cache. Comparing raw project bytes would assert the
                // opposite of the spec. What must survive is the source code and
                // the project metadata.
                VbaProjectData after = BookIO.ReadProject(dest);
                Require(after.Modules.Count == project.Modules.Count, "Module count changed in a no-op build.");
                foreach (VbaModule sourceModule in project.Modules)
                {
                    VbaModule copiedModule = after.Modules.Find(delegate(VbaModule m) { return m.Name == sourceModule.Name; });
                    Require(copiedModule != null, "Module disappeared in a no-op build: " + sourceModule.Name);
                    Require(copiedModule.FullCode == sourceModule.FullCode, "Module source changed in a no-op build: " + sourceModule.Name);
                }
                Require(after.CodePage == project.CodePage, "Codepage changed in a no-op build.");
                SameNonVbaEntries(source, dest, project.VbaEntryName);
            }, failures);
            Case("changed source round-trip and invalidated execution cache", delegate()
            {
                string dest = Path.Combine(temp, "changed.xlsm");
                Built(BookIO.BuildCopy(source, dest, changes, noAdditions, signature, false));
                VbaProjectData after = BookIO.ReadProject(dest);
                Require(after.Modules.Find(delegate(VbaModule m) { return m.Name == module.Name; }).FullCode.Contains("MacroStudio audit comment"), "Changed source missing.");
                Require(Equal(after.Ole2.ReadStream(VbaProjectWriter.GetPerformanceCacheEntry(after)), new byte[] {0xCC, 0x61, 0xFF, 0xFF, 0, 0, 0}), "Execution cache is not invalidated.");
                SameNonVbaEntries(source, dest, project.VbaEntryName);
            }, failures);
            Case("new standard module round-trip", delegate()
            {
                string dest = Path.Combine(temp, "added.xlsm");
                List<VbaModuleAddition> additions = new List<VbaModuleAddition>();
                additions.Add(new VbaModuleAddition("AuditAdded", "Option Explicit\r\n"));
                Built(BookIO.BuildCopy(source, dest, empty, additions, signature, false));
                VbaProjectData after = BookIO.ReadProject(dest);
                Require(after.Modules.Count == project.Modules.Count + 1, "Added module count mismatch.");
                Require(after.Modules.Exists(delegate(VbaModule m) { return m.Name == "AuditAdded"; }), "New module missing.");
                SameNonVbaEntries(source, dest, project.VbaEntryName);
            }, failures);
            Case("stale source signature is rejected without an output", delegate()
            {
                string dest = Path.Combine(temp, "stale.xlsm");
                BookBuildResult result = BookIO.BuildCopy(source, dest, changes, noAdditions, signature + "invalid", false);
                Require(!result.Success && result.ErrorCode == "E-BUILD-04", "Stale signature accepted.");
                Require(!File.Exists(dest), "Failed build left an output.");
            }, failures);
            Case("existing output and predictable legacy temp names are preserved", delegate()
            {
                string dest = Path.Combine(temp, "existing.xlsm");
                File.WriteAllText(dest, "unrelated file");
                File.WriteAllText(dest + ".previous", "previous sentinel");
                File.WriteAllText(dest + ".rebuild", "rebuild sentinel");
                Require(!BookIO.BuildCopy(source, dest, changes, noAdditions, signature, false).Success, "Existing file overwritten without permission.");
                Require(File.ReadAllText(dest) == "unrelated file", "Existing file lost.");
                Built(BookIO.BuildCopy(source, dest, changes, noAdditions, signature, true));
                Require(File.ReadAllText(dest + ".previous") == "previous sentinel", "Unrelated .previous deleted.");
                Require(File.ReadAllText(dest + ".rebuild") == "rebuild sentinel", "Unrelated .rebuild deleted.");
                byte[] saved = File.ReadAllBytes(dest);
                Dictionary<string, string> invalid = new Dictionary<string, string>(); invalid.Add("NonexistentAuditModule", "bad");
                Require(!BookIO.BuildCopy(source, dest, invalid, noAdditions, signature, true).Success, "Invalid module accepted.");
                Require(Equal(saved, File.ReadAllBytes(dest)), "Failed retry destroyed successful output.");
            }, failures);
            Case("atomic publisher refuses accidental overwrite", delegate()
            {
                string dest = Path.Combine(temp, "atomic.txt");
                string staging = OutputFiles.TemporaryPath(dest);
                File.WriteAllText(dest, "old"); File.WriteAllText(staging, "new");
                bool rejected = false;
                try { OutputFiles.Publish(staging, dest, false); } catch (IOException) { rejected = true; }
                Require(rejected && File.ReadAllText(dest) == "old", "Exclusive publication overwrote a file.");
                OutputFiles.Publish(staging, dest, true);
                Require(File.ReadAllText(dest) == "new" && !File.Exists(staging), "Replacement failed.");
            }, failures);
            Case("requests with the same timestamp have distinct, complete folders", delegate()
            {
                HostServices host = new HostServices(null, root); host.AttachBook(source);
                Dictionary<string, object> one = host.WriteRequestFiles("20260908_120000", "request1", "code1");
                Dictionary<string, object> two = host.WriteRequestFiles("20260908_120000", "request2", "code2");
                Require((string)one["folderPath"] != (string)two["folderPath"], "Same-second request collision.");
                Require(File.ReadAllText((string)one["requestPath"]) == "request1", "Earlier request overwritten.");
                Require(File.ReadAllText((string)one["codePath"]) == "code1", "Earlier source overwritten.");
                Require(File.ReadAllText((string)two["requestPath"]) == "request2", "New request incomplete.");
                Require(File.ReadAllText((string)two["codePath"]) == "code2", "New source incomplete.");
            }, failures);
            Case("Windows names rejected and legal embedded dots accepted", delegate()
            {
                MethodInfo resolve = typeof(HostServices).GetMethod("ResolveRunFileName", BindingFlags.NonPublic | BindingFlags.Static);
                string[] invalid = {"CON.xlsm", "NUL.backup.xlsm", "LPT1.xlsm", "x\u0001.xlsm", "../out.xlsm", "wrong.xlsx"};
                foreach (string name in invalid)
                {
                    bool rejected = false;
                    try { resolve.Invoke(null, new object[] {name, ".xlsm", "safe.xlsm"}); }
                    catch (TargetInvocationException e) { if (e.InnerException is HostActionException) rejected = true; else throw; }
                    Require(rejected, "Invalid name accepted: " + name);
                }
                Require((string)resolve.Invoke(null, new object[] {"report..xlsm", ".xlsm", "safe.xlsm"}) == "report..xlsm", "Legal dots rejected.");
                MethodInfo make = typeof(HostServices).GetMethod("MakeDefaultFileName", BindingFlags.NonPublic | BindingFlags.Static);
                string result = (string)make.Invoke(null, new object[] {new string('a', 180) + ".xlsm", "-Modified-20260908.xlsm"});
                Require(result.Length <= 120 && result.EndsWith("-Modified-20260908.xlsm"), "Long default filename invalid.");
            }, failures);
            Case("fallback encoding refuses unrepresentable characters", delegate()
            {
                int codePage = project.CodePage; Encoding encoding = project.Encoding;
                bool rejected = false;
                try
                {
                    project.CodePage = int.MaxValue; project.Encoding = Encoding.ASCII;
                    try { VbaProjectWriter.CreateModuleStream(project, module, module.AttributeHeader + "' \u65e5\u672c\u8a9e\r\n"); }
                    catch (EncoderFallbackException) { rejected = true; }
                }
                finally { project.CodePage = codePage; project.Encoding = encoding; }
                Require(rejected, "Unrepresentable text was silently replaced.");
            }, failures);
            Case("original sample and source copy remain unchanged", delegate()
            {
                Require(Equal(original, File.ReadAllBytes(sample)), "Packaged sample changed.");
                Require(Equal(original, File.ReadAllBytes(source)), "Source copy changed.");
            }, failures);
            if (failures.Count > 0)
                throw new Exception(failures.Count + " test groups failed. Outputs retained at " + temp + "\n" + string.Join("\n", failures.ToArray()));
            Directory.Delete(temp, true);
            Console.WriteLine("All 12 Windows/core test groups passed. Excel execution was not tested.");
        }
    }
}
