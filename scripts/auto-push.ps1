param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("dev", "beta", "production")]
    [string]$TargetEnv,

    [string]$Message = "",

    [switch]$SkipPull,
    [switch]$SkipDeploy,
    [switch]$ForceDeploy,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$VpsHost = "root@198.186.130.112"

$EnvironmentConfig = @{
    dev = @{
        RemotePath = "/home/goliath/dev"
        DeployScript = "/home/goliath/deploy-dev.sh"
        Pm2Name = "goliath-dev"
    }
    beta = @{
        RemotePath = "/home/goliath/beta"
        DeployScript = "/home/goliath/deploy-beta.sh"
        Pm2Name = "goliath-beta"
    }
    production = @{
        RemotePath = "/home/goliath/production"
        DeployScript = "/home/goliath/deploy-production.sh"
        Pm2Name = "goliath-production"
    }
}

function Fail {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [int]$ExitCode = 1
    )

    Write-Host ""
    Write-Host "FAILED: $Message"
    exit $ExitCode
}

function Run-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host ">> $Label"
    & $Command

    if ($LASTEXITCODE -ne 0) {
        Fail -Message $Label -ExitCode $LASTEXITCODE
    }
}

function Get-GitSha {
    param([Parameter(Mandatory = $true)][string]$Reference)

    $output = @(git rev-parse $Reference)
    if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
        Fail -Message "Could not resolve Git reference: $Reference"
    }

    return ($output | Select-Object -Last 1).Trim()
}

function Get-VpsSha {
    param([Parameter(Mandatory = $true)][string]$RemotePath)

    $output = @(ssh $VpsHost "cd '$RemotePath' && git rev-parse HEAD")
    if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
        return ""
    }

    return ($output | Select-Object -Last 1).Trim()
}

function Get-Pm2Status {
    param([Parameter(Mandatory = $true)][string]$Pm2Name)

    $command = "pm2 describe '$Pm2Name' | grep -E 'status.*online' >/dev/null && echo online || echo offline"
    $output = @(ssh $VpsHost $command)

    if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
        return "unknown"
    }

    return ($output | Select-Object -Last 1).Trim()
}

Write-Host "========================================"
Write-Host "Goliath Sync and Deployment"
Write-Host "Target: $TargetEnv"
Write-Host "Dry Run: $DryRun"
Write-Host "========================================"

if (-not (Test-Path ".git")) {
    Fail -Message "Run this command from the Goliath repository root."
}

if (
    (Test-Path ".git\rebase-merge") -or
    (Test-Path ".git\rebase-apply") -or
    (Test-Path ".git\MERGE_HEAD") -or
    (Test-Path ".git\CHERRY_PICK_HEAD")
) {
    Fail -Message "A Git merge, rebase, or cherry-pick is already in progress."
}

Run-Step "Fetch GitHub branches" {
    git fetch origin
}

$currentBranch = (git branch --show-current).Trim()
$workingTreeChanges = @(git status --porcelain)

if ($currentBranch -ne $TargetEnv) {
    if ($workingTreeChanges.Count -gt 0) {
        Fail -Message "Local changes exist on '$currentBranch'. Commit or move them before switching to '$TargetEnv'."
    }

    Run-Step "Switch to $TargetEnv" {
        git switch $TargetEnv
    }
}
else {
    Write-Host ""
    Write-Host "Already on $TargetEnv."
}

$changes = @(git status --porcelain)

if ($changes.Count -gt 0) {
    Write-Host ""
    Write-Host "Changed files:"
    $changes | ForEach-Object { Write-Host "  $_" }

    if ($DryRun) {
        Write-Host ""
        Write-Host "Dry run complete. No files were changed, pushed, or deployed."
        exit 0
    }

    Run-Step "Stage local changes" {
        git add -A
    }

    $commitMessage = $Message.Trim()
    if ([string]::IsNullOrWhiteSpace($commitMessage)) {
        $commitMessage = "chore($TargetEnv): sync local changes"
    }

    Run-Step "Commit local changes" {
        git commit -m $commitMessage
    }
}
else {
    Write-Host ""
    Write-Host "No uncommitted local changes."
}

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry run complete."
    exit 0
}

if (-not $SkipPull) {
    Run-Step "Rebase onto origin/$TargetEnv" {
        git pull --rebase origin $TargetEnv
    }
}

Run-Step "Run Doctor" {
    npm run doctor
}

$localSha = Get-GitSha -Reference "HEAD"
$remoteSha = Get-GitSha -Reference "origin/$TargetEnv"

if ($localSha -ne $remoteSha) {
    Run-Step "Push $TargetEnv to GitHub" {
        git push origin $TargetEnv
    }
}
else {
    Write-Host ""
    Write-Host "GitHub is already up to date."
}

Run-Step "Refresh GitHub state" {
    git fetch origin
}

$finalLocalSha = Get-GitSha -Reference "HEAD"
$finalRemoteSha = Get-GitSha -Reference "origin/$TargetEnv"

if ($finalLocalSha -ne $finalRemoteSha) {
    Write-Host "Local:  $finalLocalSha"
    Write-Host "GitHub: $finalRemoteSha"
    Fail -Message "Local and GitHub commits do not match."
}

$vpsVerified = $false
$targetConfig = $EnvironmentConfig[$TargetEnv]

if (-not $SkipDeploy) {
    $vpsSha = Get-VpsSha -RemotePath $targetConfig.RemotePath
    $pm2Status = Get-Pm2Status -Pm2Name $targetConfig.Pm2Name
    $deploymentRequired = $ForceDeploy -or $vpsSha -ne $finalRemoteSha -or $pm2Status -ne "online"

    if ($deploymentRequired) {
        Write-Host ""
        Write-Host "Deployment required."
        Write-Host "GitHub SHA: $finalRemoteSha"
        Write-Host "VPS SHA:    $vpsSha"
        Write-Host "PM2 status: $pm2Status"

        Run-Step "Deploy $TargetEnv to VPS" {
            ssh $VpsHost "bash '$($targetConfig.DeployScript)'"
        }
    }
    else {
        Write-Host ""
        Write-Host "VPS already matches GitHub and PM2 is online."
    }

    $finalVpsSha = Get-VpsSha -RemotePath $targetConfig.RemotePath
    $finalPm2Status = Get-Pm2Status -Pm2Name $targetConfig.Pm2Name

    if ($finalVpsSha -ne $finalRemoteSha) {
        Write-Host "GitHub: $finalRemoteSha"
        Write-Host "VPS:    $finalVpsSha"
        Fail -Message "$TargetEnv VPS does not match GitHub."
    }

    if ($finalPm2Status -ne "online") {
        Fail -Message "$($targetConfig.Pm2Name) is '$finalPm2Status' instead of online."
    }

    $vpsVerified = $true
}

Write-Host ""
Write-Host "========================================"
Write-Host "SUCCESS"
Write-Host "Local $TargetEnv:  synchronized"
Write-Host "GitHub $TargetEnv: synchronized"
if ($vpsVerified) {
    Write-Host "VPS $TargetEnv:    synchronized and online"
}
Write-Host "Commit: $finalLocalSha"
Write-Host "========================================"
