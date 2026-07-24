# read-screen.ps1 — JARVIS's read-only view of the screen (slice 1 of "hands").
#
# Walks the Windows UI Automation tree of the foreground window and lists the
# other open windows, then prints ONE JSON object to stdout. It reads only:
# it never moves the mouse, presses a key, or changes anything. It takes no
# arguments from the caller, so there is nothing here for a spoken command to
# influence — core/screen-reader.js runs it with -File and a fixed path.
#
# What it deliberately does NOT collect: the text typed into any field. Element
# "Name" in UI Automation is a control's label (e.g. "Save"), not its contents.
# Password fields are flagged (isPassword) so the reader can say one is present,
# but their label is dropped again in screen-guard.redactElements as a backstop.

param(
    [int]$MaxElements = 150,
    [int]$MaxNodes = 800,
    [int]$MaxOtherWindows = 12,
    [int]$BudgetMs = 8000
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

function Fail($message) {
    [Console]::Error.WriteLine($message)
    exit 1
}

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
} catch {
    Fail("UI Automation is not available: " + $_.Exception.Message)
}

# GetForegroundWindow lets us start at the window the user is actually looking
# at rather than guessing from the (unordered) desktop children.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Fg {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$auto = [System.Windows.Automation.AutomationElement]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

# Best-effort integrity read. A window owned by an elevated (higher-integrity)
# process denies a normal process access to its module path; we use that as the
# signal. Unknown is reported as "unknown" and treated by the guard as ordinary
# for reads — a real elevated-window guard lands with the clicking slice.
function Get-IntegrityForPid([int]$processId) {
    try {
        $p = Get-Process -Id $processId -ErrorAction Stop
        try {
            $null = $p.Path
            return "Medium"
        } catch {
            return "High"
        }
    } catch {
        return "unknown"
    }
}

function Get-ProcessNameForPid([int]$processId) {
    try {
        $p = Get-Process -Id $processId -ErrorAction Stop
        return ($p.ProcessName + ".exe")
    } catch {
        return ""
    }
}

function Read-Elements($rootElement, [int]$maxElements, [int]$maxNodes, [int]$budgetMs) {
    $elements = New-Object System.Collections.Generic.List[object]
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $queue = New-Object System.Collections.Generic.Queue[object]
    $queue.Enqueue($rootElement)
    $visited = 0
    while ($queue.Count -gt 0 -and $visited -lt $maxNodes -and $elements.Count -lt $maxElements) {
        if ($sw.ElapsedMilliseconds -gt $budgetMs) { break }
        $node = $queue.Dequeue()
        $visited++
        try {
            $child = $walker.GetFirstChild($node)
            while ($child -ne $null -and $queue.Count -lt ($maxNodes * 2)) {
                $queue.Enqueue($child)
                try {
                    $name = $child.Current.Name
                    $ctype = $child.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''
                    $isPwd = $false
                    try { $isPwd = [bool]$child.Current.IsPassword } catch { $isPwd = $false }
                    $enabled = $true
                    try { $enabled = [bool]$child.Current.IsEnabled } catch { $enabled = $true }
                    $offscreen = $false
                    try { $offscreen = [bool]$child.Current.IsOffscreen } catch { $offscreen = $false }
                    if ((-not $offscreen) -and ($isPwd -or ($name -and $name.Trim().Length -gt 0))) {
                        $elements.Add([pscustomobject]@{
                            name       = ("" + $name)
                            control    = $ctype
                            isPassword = $isPwd
                            enabled    = $enabled
                        })
                    }
                } catch { }
                if ($elements.Count -ge $maxElements) { break }
                $child = $walker.GetNextSibling($child)
            }
        } catch { }
    }
    return $elements
}

# ---- Foreground window -----------------------------------------------------
$foreground = $null
try {
    $hwnd = [Win32Fg]::GetForegroundWindow()
    if ($hwnd -ne [IntPtr]::Zero) {
        $fgEl = $auto::FromHandle($hwnd)
        if ($fgEl -ne $null) {
            $fgPid = 0
            try { $fgPid = [int]$fgEl.Current.ProcessId } catch { $fgPid = 0 }
            $elements = Read-Elements $fgEl $MaxElements $MaxNodes $BudgetMs
            $foreground = [pscustomobject]@{
                title       = ("" + $fgEl.Current.Name)
                processName = (Get-ProcessNameForPid $fgPid)
                pid         = $fgPid
                integrity   = (Get-IntegrityForPid $fgPid)
                elements    = $elements
            }
        }
    }
} catch { }

# ---- Other top-level windows ----------------------------------------------
$others = New-Object System.Collections.Generic.List[object]
try {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window)
    $windows = $auto::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    foreach ($w in $windows) {
        if ($others.Count -ge $MaxOtherWindows) { break }
        try {
            $wName = "" + $w.Current.Name
            $wPid = 0
            try { $wPid = [int]$w.Current.ProcessId } catch { $wPid = 0 }
            if ($foreground -ne $null -and $wPid -eq $foreground.pid -and $wName -eq $foreground.title) { continue }
            if ([string]::IsNullOrWhiteSpace($wName)) { continue }
            $others.Add([pscustomobject]@{
                title       = $wName
                processName = (Get-ProcessNameForPid $wPid)
                pid         = $wPid
                integrity   = (Get-IntegrityForPid $wPid)
            })
        } catch { }
    }
} catch { }

$result = [pscustomobject]@{
    ok           = $true
    foreground   = $foreground
    otherWindows = $others
}

# Depth 6 is comfortably past our nested pscustomobjects; Compress keeps it to a
# single line for the parser. Everything else has gone to stderr or been caught.
$result | ConvertTo-Json -Depth 6 -Compress
