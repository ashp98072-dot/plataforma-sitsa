#requires -Version 5.1
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('Prepare','Verify','Start','Stop','Credentials')][string]$Action,
 [string]$RepoRoot = 'C:\Users\Admin\Documents\novalvion-c3c15-qa'
)
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path -LiteralPath $RepoRoot).Path
$statePath = Join-Path $env:TEMP 'novalvion-c3c15-manual\acceptance-private'
$privateFile = Join-Path $statePath 'private.json'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

function Invoke-LabNode([string]$Script, [string[]]$NodeArgs, [string]$InputText) {
 $info = New-Object Diagnostics.ProcessStartInfo
 $info.FileName = $nodePath
 $parts = @((Join-Path $PSScriptRoot $Script)) + $NodeArgs
 if ($parts | Where-Object { $_ -match '["\r\n]' }) { throw 'Argumento de ruta invalido' }
 $info.Arguments = ($parts | ForEach-Object { '"' + $_ + '"' }) -join ' '
 $info.WorkingDirectory = $repoPath
 $info.UseShellExecute = $false
 $info.CreateNoWindow = $true
 $info.RedirectStandardInput = $true
 $info.RedirectStandardOutput = $true
 $info.RedirectStandardError = $true
 $process = New-Object Diagnostics.Process
 $process.StartInfo = $info
 [void]$process.Start()
 $stdout = $process.StandardOutput.ReadToEndAsync()
 $stderr = $process.StandardError.ReadToEndAsync()
 if ($InputText) { $process.StandardInput.Write($InputText) }
 $process.StandardInput.Close()
 $process.WaitForExit()
 if ($process.ExitCode -ne 0) { throw ('Operacion rechazada: ' + $stderr.Result.Trim()) }
 $stdout.Result
 $process.Dispose()
}

if ($Action -eq 'Prepare') {
 if (Test-Path -LiteralPath $privateFile) { throw 'Estado previo encontrado. No se reutiliza ni se borra.' }
 Invoke-LabNode 'private-directory.mjs' @($statePath) ''
 $secure = Read-Host 'Password local de c3c15_app (no se registra)' -AsSecureString
 $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $config = @{host='127.0.0.1';port=43306;database='c3c15_lab';user='c3c15_app';httpPort=4315;datadir=(Join-Path $env:TEMP 'novalvion-c3c15-manual\data');repo=$repoPath}
  $inputJson = @{config=$config;password=$password;stateDir=$statePath} | ConvertTo-Json -Depth 4 -Compress
  Invoke-LabNode 'initialize.mjs' @() $inputJson
 } finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $password = $null; $inputJson = $null; $secure.Dispose()
 }
} elseif ($Action -eq 'Credentials') {
 throw 'C15B_CREDENTIALS_CONSOLE_DISABLED'
} else {
 if (-not (Test-Path -LiteralPath $privateFile)) { throw 'Falta Prepare' }
 Invoke-LabNode 'control.mjs' @($Action.ToLowerInvariant(),$privateFile) ''
}
