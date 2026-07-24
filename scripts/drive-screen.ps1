# drive-screen.ps1 — the driving helper for slice 2 of JARVIS's "hands".
#
# One persistent process per approved session: core/screen-driver.js spawns it
# with -File and a fixed path, feeds it newline-delimited JSON on stdin, and
# reads one JSON line per request from stdout. Nothing the user says is ever on
# the command line; text-to-type arrives inside a JSON field.
#
# This helper owns ATOMICITY, not policy. The denylists and the allowlist live
# in core/screen-guard.js (Node) and are evaluated before any command is sent
# here. What this file guarantees is that the thing Node approved is still the
# thing being acted on: immediately before every Invoke/SetValue it re-checks
# that the desktop is unlocked, the same process is still in the foreground,
# the element is the same one (same RuntimeId, same Name), still enabled and
# on-screen, and the owning process is not elevated. Any mismatch is a clean
# structured error — never a guess, never a retry.
#
# It clicks nothing by coordinate. Every action is a UI Automation pattern on a
# named element: InvokePattern (buttons/menu items), SelectionItemPattern
# (Explorer items), ValuePattern (text fields). If an element doesn't offer a
# safe pattern the answer is "not-invokable", not synthetic input.

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8

try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
} catch {
    [Console]::Error.WriteLine("UI Automation is not available: " + $_.Exception.Message)
    exit 1
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Drive {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr hObject);
    [DllImport("advapi32.dll")] public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);
    [DllImport("advapi32.dll")] public static extern bool GetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, IntPtr TokenInformation, uint TokenInformationLength, out uint ReturnLength);
    [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthority(IntPtr pSid, uint nSubAuthority);
    [DllImport("advapi32.dll")] public static extern IntPtr GetSidSubAuthorityCount(IntPtr pSid);
}
"@

$auto = [System.Windows.Automation.AutomationElement]

# --- Session state -----------------------------------------------------------
# Opaque handles ("refs") map to live AutomationElements plus the identity we
# saw at resolve time. Refs are never reused across steps by the caller.
$script:refs = @{}
$script:refCounter = 0

# --- Environment checks ------------------------------------------------------

# The secure/locked desktop cannot be automated and must never be retried into.
function Test-DesktopLocked {
    # DESKTOP_READOBJECTS = 0x0001
    $desktop = [Win32Drive]::OpenInputDesktop(0, $false, 0x0001)
    if ($desktop -eq [IntPtr]::Zero) { return $true }
    [void][Win32Drive]::CloseDesktop($desktop)
    return $false
}

# Real integrity via the process token, not the module-path heuristic the
# read-only slice used. Anything we cannot read is treated as elevated —
# fail closed: if Windows won't tell us, we won't touch it.
function Get-TokenIntegrity([int]$processId) {
    if ($processId -le 0) { return "unknown-elevated" }
    # PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    $process = [Win32Drive]::OpenProcess(0x1000, $false, $processId)
    if ($process -eq [IntPtr]::Zero) { return "unknown-elevated" }
    try {
        $token = [IntPtr]::Zero
        # TOKEN_QUERY = 0x0008
        if (-not [Win32Drive]::OpenProcessToken($process, 0x0008, [ref]$token)) { return "unknown-elevated" }
        try {
            # TokenIntegrityLevel = 25
            $length = 0
            [void][Win32Drive]::GetTokenInformation($token, 25, [IntPtr]::Zero, 0, [ref]$length)
            if ($length -eq 0) { return "unknown-elevated" }
            $buffer = [System.Runtime.InteropServices.Marshal]::AllocHGlobal([int]$length)
            try {
                if (-not [Win32Drive]::GetTokenInformation($token, 25, $buffer, $length, [ref]$length)) { return "unknown-elevated" }
                $sid = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($buffer)
                $countPtr = [Win32Drive]::GetSidSubAuthorityCount($sid)
                $count = [System.Runtime.InteropServices.Marshal]::ReadByte($countPtr)
                $ridPtr = [Win32Drive]::GetSidSubAuthority($sid, [uint32]($count - 1))
                $rid = [System.Runtime.InteropServices.Marshal]::ReadInt32($ridPtr)
                if ($rid -ge 0x4000) { return "system" }
                if ($rid -ge 0x3000) { return "high" }
                if ($rid -ge 0x2000) { return "medium" }
                return "low"
            } finally {
                [System.Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
            }
        } finally {
            [void][Win32Drive]::CloseHandle($token)
        }
    } finally {
        [void][Win32Drive]::CloseHandle($process)
    }
}

function Test-Elevated([string]$integrity) {
    return @("high", "system", "protected", "unknown-elevated") -contains $integrity
}

function Get-ProcessNameForPid([int]$processId) {
    try {
        $p = Get-Process -Id $processId -ErrorAction Stop
        return ($p.ProcessName + ".exe")
    } catch {
        return ""
    }
}

# --- Element helpers ---------------------------------------------------------

function Get-ForegroundElement {
    $hwnd = [Win32Drive]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    return $auto::FromHandle($hwnd)
}

function Get-ElementPatterns($element) {
    $patterns = New-Object System.Collections.Generic.List[string]
    foreach ($pair in @(
        @([System.Windows.Automation.InvokePattern]::Pattern, "invoke"),
        @([System.Windows.Automation.ValuePattern]::Pattern, "value"),
        @([System.Windows.Automation.SelectionItemPattern]::Pattern, "selectionItem"),
        @([System.Windows.Automation.TogglePattern]::Pattern, "toggle")
    )) {
        $dummy = $null
        if ($element.TryGetCurrentPattern($pair[0], [ref]$dummy)) { $patterns.Add($pair[1]) }
    }
    return $patterns
}

function Describe-Element($element, [string]$ref) {
    $isPwd = $false
    try { $isPwd = [bool]$element.Current.IsPassword } catch { $isPwd = $true } # unreadable = assume the worst
    return [pscustomobject]@{
        ref          = $ref
        name         = ("" + $element.Current.Name)
        control      = ($element.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
        automationId = ("" + $element.Current.AutomationId)
        isPassword   = $isPwd
        enabled      = [bool]$element.Current.IsEnabled
        offscreen    = [bool]$element.Current.IsOffscreen
        patterns     = (Get-ElementPatterns $element)
    }
}

function Store-Element($element) {
    $script:refCounter++
    $ref = "e" + $script:refCounter
    $script:refs[$ref] = @{
        element   = $element
        runtimeId = ($element.GetRuntimeId() -join ",")
        name      = ("" + $element.Current.Name)
        processId = [int]$element.Current.ProcessId
    }
    return $ref
}

# --- Commands ----------------------------------------------------------------

function Do-Snapshot {
    if (Test-DesktopLocked) { return @{ ok = $false; error = "desktop-locked" } }
    $fg = Get-ForegroundElement
    if ($fg -eq $null) { return @{ ok = $false; error = "not-found" } }
    $fgPid = [int]$fg.Current.ProcessId
    $integrity = Get-TokenIntegrity $fgPid
    return @{
        ok = $true
        foreground = [pscustomobject]@{
            title       = ("" + $fg.Current.Name)
            processName = (Get-ProcessNameForPid $fgPid)
            pid         = $fgPid
            integrity   = $integrity
        }
    }
}

# Resolve durable properties (automationId, or name+controlType) to elements
# inside the CURRENT foreground window only. The caller demands exactly one
# match; we report everything we found and let it refuse on 0 or 2+.
function Do-Resolve($target) {
    if (Test-DesktopLocked) { return @{ ok = $false; error = "desktop-locked" } }
    $fg = Get-ForegroundElement
    if ($fg -eq $null) { return @{ ok = $false; error = "not-found" } }

    $conditions = New-Object System.Collections.Generic.List[object]
    if ($target.automationId) {
        $conditions.Add((New-Object System.Windows.Automation.PropertyCondition($auto::AutomationIdProperty, [string]$target.automationId)))
    } elseif ($target.name) {
        $conditions.Add((New-Object System.Windows.Automation.PropertyCondition($auto::NameProperty, [string]$target.name, [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)))
    } else {
        return @{ ok = $false; error = "not-found" }
    }
    $condition = $conditions[0]

    $found = $fg.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    $matches = New-Object System.Collections.Generic.List[object]
    $wantedControl = ("" + $target.controlType).ToLowerInvariant()
    foreach ($element in $found) {
        if ($matches.Count -ge 8) { break }
        try {
            if ([bool]$element.Current.IsOffscreen) { continue }
            $ctype = ($element.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '').ToLowerInvariant()
            if ($wantedControl -and $ctype -ne $wantedControl) { continue }
            $ref = Store-Element $element
            $matches.Add((Describe-Element $element $ref))
        } catch { }
    }
    return @{ ok = $true; count = $matches.Count; matches = $matches }
}

# The atomic re-verification both actions share. Node approved a specific
# element in a specific window; if any part of that identity has drifted, the
# action does not happen.
function Confirm-ReadyToAct($entry, $expect) {
    if (Test-DesktopLocked) { return "desktop-locked" }

    $fg = Get-ForegroundElement
    if ($fg -eq $null) { return "focus-stolen" }
    $fgPid = [int]$fg.Current.ProcessId
    if ($expect.pid -and ([int]$expect.pid -ne $fgPid)) { return "focus-stolen" }

    if (Test-Elevated (Get-TokenIntegrity $fgPid)) { return "elevated" }

    $element = $entry.element
    try {
        $currentRuntime = ($element.GetRuntimeId() -join ",")
        if ($currentRuntime -ne $entry.runtimeId) { return "stale-element" }
        if (("" + $element.Current.Name) -ne $entry.name) { return "stale-element" }
        if (-not [bool]$element.Current.IsEnabled) { return "stale-element" }
        if ([bool]$element.Current.IsOffscreen) { return "stale-element" }
        if ([int]$element.Current.ProcessId -ne $fgPid) { return "focus-stolen" }
    } catch {
        return "stale-element"
    }
    return $null
}

function Do-Invoke($request) {
    $entry = $script:refs[("" + $request.ref)]
    if ($entry -eq $null) { return @{ ok = $false; error = "stale-element" } }
    $problem = Confirm-ReadyToAct $entry $request.expect
    if ($problem) { return @{ ok = $false; error = $problem } }

    $element = $entry.element
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
        } elseif ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
            $pattern.Select()
        } elseif ($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
            $pattern.Toggle()
        } else {
            return @{ ok = $false; error = "not-invokable" }
        }
    } catch {
        return @{ ok = $false; error = "stale-element" }
    }
    return @{
        ok = $true
        processName = (Get-ProcessNameForPid ([int]$entry.processId))
        pid = [int]$entry.processId
        windowTitle = ""
        durationMs = $sw.ElapsedMilliseconds
    }
}

function Do-SetValue($request) {
    $entry = $script:refs[("" + $request.ref)]
    if ($entry -eq $null) { return @{ ok = $false; error = "stale-element" } }
    $problem = Confirm-ReadyToAct $entry $request.expect
    if ($problem) { return @{ ok = $false; error = $problem } }

    $element = $entry.element
    # Belt to Node's suspenders: a password field never gets a value from us,
    # whatever the caller believed at plan time.
    $isPwd = $true
    try { $isPwd = [bool]$element.Current.IsPassword } catch { $isPwd = $true }
    if ($isPwd) { return @{ ok = $false; error = "not-invokable" } }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $pattern = $null
        if (-not $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            return @{ ok = $false; error = "not-invokable" }
        }
        if ($pattern.Current.IsReadOnly) { return @{ ok = $false; error = "not-invokable" } }
        $pattern.SetValue(("" + $request.text))
    } catch {
        return @{ ok = $false; error = "stale-element" }
    }
    return @{
        ok = $true
        processName = (Get-ProcessNameForPid ([int]$entry.processId))
        pid = [int]$entry.processId
        durationMs = $sw.ElapsedMilliseconds
    }
}

function Do-FocusWindow($target) {
    if (Test-DesktopLocked) { return @{ ok = $false; error = "desktop-locked" } }
    $wanted = ("" + $target.app).ToLowerInvariant() -replace '\.exe$', ''
    if (-not $wanted) { return @{ ok = $false; error = "not-found" } }

    $condition = New-Object System.Windows.Automation.PropertyCondition($auto::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
    $windows = $auto::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    $matched = $null
    foreach ($window in $windows) {
        try {
            $wPid = [int]$window.Current.ProcessId
            $name = (Get-ProcessNameForPid $wPid).ToLowerInvariant() -replace '\.exe$', ''
            if ($name -ne $wanted) { continue }
            if ($target.titleContains -and (("" + $window.Current.Name) -notlike ("*" + $target.titleContains + "*"))) { continue }
            if (Test-Elevated (Get-TokenIntegrity $wPid)) { continue }
            $matched = $window
            break
        } catch { }
    }
    if ($matched -eq $null) { return @{ ok = $false; error = "not-found" } }
    try {
        $hwnd = [IntPtr]$matched.Current.NativeWindowHandle
        if ($hwnd -ne [IntPtr]::Zero) { [void][Win32Drive]::SetForegroundWindow($hwnd) }
        else { $matched.SetFocus() }
    } catch {
        return @{ ok = $false; error = "not-invokable" }
    }
    Start-Sleep -Milliseconds 150
    return @{ ok = $true; pid = [int]$matched.Current.ProcessId; processName = (Get-ProcessNameForPid ([int]$matched.Current.ProcessId)) }
}

# --- Main loop ---------------------------------------------------------------

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($line -eq $null) { break }
    $line = $line.Trim()
    if (-not $line) { continue }

    $request = $null
    try { $request = $line | ConvertFrom-Json } catch {
        [Console]::Out.WriteLine((@{ ok = $false; error = "bad-request" } | ConvertTo-Json -Compress))
        continue
    }

    $response = $null
    try {
        switch ("" + $request.cmd) {
            "ping"        { $response = @{ ok = $true; pong = $true } }
            "snapshot"    { $response = Do-Snapshot }
            "resolve"     { $response = Do-Resolve $request.target }
            "invoke"      { $response = Do-Invoke $request }
            "setValue"    { $response = Do-SetValue $request }
            "focusWindow" { $response = Do-FocusWindow $request.target }
            "quit"        { $response = @{ ok = $true; bye = $true } }
            default       { $response = @{ ok = $false; error = "bad-request" } }
        }
    } catch {
        $response = @{ ok = $false; error = "driver-failed"; detail = $_.Exception.Message }
    }

    $response.id = $request.id
    [Console]::Out.WriteLine(($response | ConvertTo-Json -Depth 6 -Compress))
    if (("" + $request.cmd) -eq "quit") { break }
}
