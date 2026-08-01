$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-TestSource {
    $names = @(
        '04_HostServices.cs',
        '05_Ole2.cs',
        '06_VbaCompression.cs',
        '07_VbaProject.cs',
        '08_BookIO.cs',
        '09_BookInventory.cs'
    )
    $productSource = ($names | ForEach-Object {
        $path = Join-Path (Join-Path $PSScriptRoot '..\src') $_
        [IO.File]::ReadAllText(
            (Resolve-Path -LiteralPath $path),
            [Text.Encoding]::UTF8)
    }) -join "`n"
    $probeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;

namespace MacroStudio.Tests
{
    public sealed class ClipboardRetryObservation
    {
        public int Calls;
        public int Waits;
        public int WaitMilliseconds;
        public int ReportCalls;
        public int ReportedRetries;
        public bool ReportedSuccess;
        public int OwnerChecks;
        public int OwnerSamples;
        public string LastOwner = string.Empty;
        public string ErrorCode = string.Empty;
        public int InnerHResult;
    }

    public static class ClipboardRetryProbe
    {
        private const int BusyHResult = unchecked((int)0x800401D0);
        private const int OtherHResult = unchecked((int)0x80004005);

        public static int RealRetryCount;
        public static readonly List<string> RealOwners =
            new List<string>();

        public static ClipboardRetryObservation BusyThenSuccess(
            int busyFailures,
            string errorCode)
        {
            return Observe(busyFailures, false, BusyHResult, errorCode);
        }

        public static ClipboardRetryObservation AlwaysBusy(
            string errorCode)
        {
            return Observe(0, true, BusyHResult, errorCode);
        }

        public static ClipboardRetryObservation OtherFailure(
            string errorCode)
        {
            return Observe(0, true, OtherHResult, errorCode);
        }

        public static IDataObject CaptureClipboard()
        {
            IDataObject data = null;
            ClipboardRetry.Execute(
                "E-TEST",
                "The test clipboard could not be captured.",
                delegate()
                {
                    data = MaterializeClipboard(
                        Clipboard.GetDataObject());
                },
                Thread.Sleep,
                ClipboardRetry.InspectOpenClipboardOwner,
                ReportRealRetry);
            return data;
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

        public static void RestoreClipboard(IDataObject data)
        {
            ClipboardRetry.Execute(
                "E-TEST",
                "The test clipboard could not be restored.",
                delegate()
                {
                    if (data == null)
                    {
                        Clipboard.Clear();
                    }
                    else
                    {
                        Clipboard.SetDataObject(data, true);
                    }
                },
                Thread.Sleep,
                ClipboardRetry.InspectOpenClipboardOwner,
                ReportRealRetry);
        }

        private static ClipboardRetryObservation Observe(
            int busyFailures,
            bool alwaysFail,
            int hresult,
            string errorCode)
        {
            ClipboardRetryObservation observation =
                new ClipboardRetryObservation();
            try
            {
                ClipboardRetry.Execute(
                    errorCode,
                    "Injected clipboard failure.",
                    delegate()
                    {
                        observation.Calls++;
                        if (alwaysFail ||
                            observation.Calls <= busyFailures)
                        {
                            throw new COMException(
                                "Injected clipboard failure.",
                                hresult);
                        }
                    },
                    delegate(int milliseconds)
                    {
                        observation.Waits++;
                        observation.WaitMilliseconds += milliseconds;
                    },
                    delegate()
                    {
                        observation.OwnerChecks++;
                        return "test-owner pid=123";
                    },
                    delegate(
                        int retryCount,
                        bool succeeded,
                        IList<string> owners)
                    {
                        observation.ReportCalls++;
                        observation.ReportedRetries = retryCount;
                        observation.ReportedSuccess = succeeded;
                        observation.OwnerSamples = owners.Count;
                        if (owners.Count > 0)
                        {
                            observation.LastOwner =
                                owners[owners.Count - 1];
                        }
                    });
            }
            catch (HostActionException ex)
            {
                observation.ErrorCode = ex.ErrorCode;
                if (ex.InnerException != null)
                {
                    observation.InnerHResult = ex.InnerException.HResult;
                }
            }
            return observation;
        }

        private static void ReportRealRetry(
            int retryCount,
            bool succeeded,
            IList<string> owners)
        {
            RealRetryCount += retryCount;
            RealOwners.AddRange(owners);
        }
    }
}
'@
    $combined = $productSource + "`n" + $probeSource
    $usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
    $usings = [regex]::Matches($combined, $usingPattern) |
        ForEach-Object { $_.Value.Trim() } |
        Sort-Object -Unique
    $body = $combined -replace $usingPattern, ''
    return ($usings -join "`n") + "`n`n" + $body
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Xaml
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$references = @(
    [System.Windows.Window].Assembly.Location
    [System.Windows.UIElement].Assembly.Location
    [System.Windows.DependencyObject].Assembly.Location
    [System.Xaml.XamlReader].Assembly.Location
    'System.IO.Compression',
    'System.IO.Compression.FileSystem'
)
Add-Type -TypeDefinition (Get-TestSource) `
    -ReferencedAssemblies $references `
    -Language CSharp

$success = [MacroStudio.Tests.ClipboardRetryProbe]::BusyThenSuccess(
    3,
    'E-GEN-03')
Assert-True (
    $success.Calls -eq 4 -and
    $success.Waits -eq 3 -and
    $success.WaitMilliseconds -eq 150 -and
    $success.OwnerChecks -eq 3 -and
    $success.OwnerSamples -eq 3 -and
    $success.LastOwner -eq 'test-owner pid=123') `
    'A transient busy clipboard must retry three times, 50ms each.'
Assert-True (
    [string]::IsNullOrEmpty($success.ErrorCode) -and
    $success.ReportCalls -eq 1 -and
    $success.ReportedRetries -eq 3 -and
    $success.ReportedSuccess) `
    'A recovered clipboard operation must report its successful retries.'

$lastAttempt = [MacroStudio.Tests.ClipboardRetryProbe]::BusyThenSuccess(
    9,
    'E-GEN-03')
Assert-True (
    $lastAttempt.Calls -eq 10 -and
    $lastAttempt.Waits -eq 9 -and
    $lastAttempt.WaitMilliseconds -eq 450 -and
    $lastAttempt.OwnerChecks -eq 9 -and
    $lastAttempt.OwnerSamples -eq 9 -and
    [string]::IsNullOrEmpty($lastAttempt.ErrorCode)) `
    'The tenth call must be allowed after exactly nine waits (450ms).'

@(
    @('E-GEN-03', 'write'),
    @('E-GEN-04', 'read')
) | ForEach-Object {
    $failure = [MacroStudio.Tests.ClipboardRetryProbe]::AlwaysBusy($_[0])
    Assert-True (
        $failure.Calls -eq 10 -and
        $failure.Waits -eq 9 -and
        $failure.WaitMilliseconds -eq 450 -and
        $failure.OwnerChecks -eq 10 -and
        $failure.OwnerSamples -eq 10) `
        ("The {0} path did not stop after ten calls." -f $_[1])
    Assert-True (
        $failure.ErrorCode -eq $_[0] -and
        $failure.ReportCalls -eq 1 -and
        $failure.ReportedRetries -eq 9 -and
        -not $failure.ReportedSuccess) `
        ("The {0} failure lost its error code or retry result." -f $_[1])
}

$other = [MacroStudio.Tests.ClipboardRetryProbe]::OtherFailure('E-GEN-04')
Assert-True (
    $other.Calls -eq 1 -and
    $other.Waits -eq 0 -and
    $other.OwnerChecks -eq 0 -and
    $other.OwnerSamples -eq 0 -and
    $other.ErrorCode -eq 'E-GEN-04' -and
    $other.InnerHResult -eq [int]0x80004005) `
    'An HRESULT other than CLIPBRD_E_CANT_OPEN must fail immediately.'

$hostSourceText = [IO.File]::ReadAllText(
    (Resolve-Path (Join-Path $PSScriptRoot '..\src\04_HostServices.cs')),
    [Text.Encoding]::UTF8)
Assert-True ($hostSourceText.IndexOf('GetWindowText') -lt 0) `
    'Clipboard diagnostics must never read or log a window title.'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$service = New-Object MacroStudio.HostServices($null, $repoRoot)
$captured = $false
$original = $null
$operationFailure = $null
$restoreFailure = $null
$cleanupRestored = $false
try {
    $original = [MacroStudio.Tests.ClipboardRetryProbe]::CaptureClipboard()
    $captured = $true
    $probe = "MacroStudio bounded clipboard retry`r`n"
    [void]$service.WriteClipboard($probe)
    $read = $service.ReadClipboard()
    Assert-True ($read['text'] -ceq $probe) `
        'The real clipboard round trip changed the text.'
} catch {
    $operationFailure = $_
} finally {
    if ($captured) {
        try {
            [MacroStudio.Tests.ClipboardRetryProbe]::RestoreClipboard($original)
            $cleanupRestored = $true
        } catch {
            $restoreFailure = $_
            # A product-bound restore failure must still fail this test. Cleanup
            # gets separate bounded attempts so the diagnostic itself does not
            # leave the user's clipboard replaced by its probe text.
            foreach ($cleanupAttempt in 1..10) {
                Start-Sleep -Milliseconds 250
                try {
                    [MacroStudio.Tests.ClipboardRetryProbe]::RestoreClipboard(
                        $original)
                    $cleanupRestored = $true
                    break
                } catch {
                    # Keep trying cleanup; the first bounded failure remains the
                    # test result even if a later cleanup attempt succeeds.
                }
            }
        }
    }
}

$ownerSummary = [string]::Join(
    ', ',
    [MacroStudio.Tests.ClipboardRetryProbe]::RealOwners)
if ($restoreFailure) {
    throw (
        'The product-bounded clipboard restore failed. cleanupRestored={0}; ' +
        'owners={1}; failure={2}' -f
        $cleanupRestored,
        $ownerSummary,
        $restoreFailure.Exception.Message)
}
if ($operationFailure) {
    throw (
        'The real clipboard round trip failed. cleanupRestored={0}; ' +
        'owners={1}; failure={2}' -f
        $cleanupRestored,
        $ownerSummary,
        $operationFailure.Exception.Message)
}

Write-Output 'test-clipboard-retry: PASS'
Write-Output (
    'deterministic calls=4/10, waits=3/9, bounded=450ms, realRetries=' +
    [MacroStudio.Tests.ClipboardRetryProbe]::RealRetryCount)
