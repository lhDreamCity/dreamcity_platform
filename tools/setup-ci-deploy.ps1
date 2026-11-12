# 梦之城平台 · GitHub Actions 部署通道一次性初始化
#
# 跑法（普通 PowerShell，不是 Claude Code 里）：
#   powershell -ExecutionPolicy Bypass -File D:\dreamcity_platform\tools\setup-ci-deploy.ps1
#
# 为什么必须人来做：
#   私钥、口令这类东西不该经过会记录它们的工具 —— 密钥只在这一台机器上生成一次，
#   口令由服务器自己生成、脚本不读回内容。
#
# 这个脚本做四件事（都可重复跑，已做的会自动跳过）：
#   1. 把 deploy/ci-deploy.sh 放到服务器上并加执行权限
#   2. 生成 CI 专用部署密钥（只读身份），并写进服务器的 authorized_keys（带 forced command）
#   3. 给服务器的 .env 补 ADMIN_PASSWORD（由服务器随机生成，不经过本机）
#   4. 把 4 项 GitHub Secrets 填好
#
# 跑完之后：往 GitHub 推一次提交 → CI 绿 → Deploy 自动把新版本送上线。

$ErrorActionPreference = 'Stop'

$Server    = 'tencent'
$ServerIp  = '193.112.18.222'
$ServerUser = 'ubuntu'
$RepoRoot  = Split-Path -Parent $PSScriptRoot
$DeployScript = Join-Path $RepoRoot 'deploy\ci-deploy.sh'
$KeyPath   = Join-Path $env:USERPROFILE '.ssh\id_ed25519_deploy_ci'
$PubPath   = "$KeyPath.pub"

function Step($msg) { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "✓ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

# ── 0. 找到 gh（GitHub CLI）────────────────────────────────
function Get-Gh {
    $cmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $local = Join-Path $env:USERPROFILE '.claude\tools\gh\bin\bin\gh.exe'
    if (Test-Path $local) { return $local }
    Die "找不到 gh。装一个：winget install GitHub.cli -e"
}

$gh = Get-Gh
Step "用 gh：$gh"

# ── 1. gh 登录状态 ─────────────────────────────────────────
# 注意：gh 未登录时把提示写到 stderr，PS 5.1 下在 ErrorActionPreference=Stop
# 里会抛 NativeCommandError，所以这段单独把错误偏好放宽。
$prevPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$authOut = (& $gh auth status 2>&1 | Out-String)
$ErrorActionPreference = $prevPref
if ($authOut -match 'Logged in') {
    Ok "gh 已登录"
} else {
    Step "gh 需要登录（一次性，会给你一个验证码，在浏览器里确认）"
    & $gh auth login --hostname github.com --git-protocol ssh --web
    if ($LASTEXITCODE -ne 0) { Die "gh auth login 失败" }
    Ok "gh 登录完成"
}

# ── 2. 部署脚本上服务器 ─────────────────────────────────────
Step "把 ci-deploy.sh 放到服务器"
scp -o ConnectTimeout=20 $DeployScript "${Server}:/home/ubuntu/ci-deploy.sh"
if ($LASTEXITCODE -ne 0) { Die "scp 失败（脚本没上去，后面的 forced command 就是死的）" }
ssh -o ConnectTimeout=20 $Server "chmod +x /home/ubuntu/ci-deploy.sh && ls -l /home/ubuntu/ci-deploy.sh"
Ok "ci-deploy.sh 就位"

# ── 3. CI 专用部署密钥 ─────────────────────────────────────
Step "准备 CI 专用部署密钥"
if (-not (Test-Path $KeyPath)) {
    ssh-keygen -t ed25519 -C "dreamcity-ci-deploy" -f $KeyPath -N '""'
    if ($LASTEXITCODE -ne 0) { Die "ssh-keygen 失败" }
    Ok "新生成 $KeyPath"
} else {
    Ok "密钥已存在，复用"
}

if (-not (Test-Path $PubPath)) { Die "找不到公钥 $PubPath" }
$pubKey = (Get-Content $PubPath -Raw).Trim()
if ($pubKey -notmatch 'ssh-ed25519') { Die "公钥内容不对" }

# authorized_keys 里挂 forced command：
#   这把钥匙只能干「接收代码包并部署」这一件事，跑不了别的命令。
#   options 要写在密钥类型前面。
$forcedLine = 'command="/home/ubuntu/ci-deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty ' + $pubKey

Step "把公钥写进服务器 authorized_keys（先备份）"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($forcedLine + "`n"))
$remote = @"
set -e
cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak.`$(date +%s)
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo '$b64' | base64 -d >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
grep -c 'dreamcity-ci' ~/.ssh/authorized_keys
"@
ssh -o ConnectTimeout=20 $Server $remote
Ok "authorized_keys 已写入（备份在 authorized_keys.bak.<时间戳>）"

# ── 4. 服务器 .env 补 ADMIN_PASSWORD ───────────────────────
Step "检查服务器 .env 的 ADMIN_PASSWORD"
$check = ssh -o ConnectTimeout=20 $Server 'grep -c "^ADMIN_PASSWORD=" /home/ubuntu/dreamcity-platform/.env'
if ($check -match '^\s*1\s*$') {
    Ok "已存在，不动"
} else {
    Warn "没有，正在由服务器自己生成一个（不经过本机）"
    ssh -o ConnectTimeout=20 $Server 'cd /home/ubuntu/dreamcity-platform && printf "ADMIN_PASSWORD=%s\n" "$(head -c 48 /dev/urandom | base64 | tr -dc "A-Za-z0-9" | head -c 24)" >> .env && grep -c "^ADMIN_PASSWORD=" .env'
    Ok "已写入（值在服务器 .env 里，用下面这条命令查看）"
}

# ── 5. GitHub Secrets ──────────────────────────────────────
Step "填 GitHub Secrets"
$repo = 'lhDreamCity/dreamcity_platform'

# 主机密钥：从本机 known_hosts 里取 ed25519 那行（别用 ssh-keyscan）
$knownHosts = Join-Path $env:USERPROFILE '.ssh\known_hosts'
$kh = ''
if (Test-Path $knownHosts) {
    $kh = (ssh-keygen -F $ServerIp -f $knownHosts 2>$null |
           Where-Object { $_ -match 'ssh-ed25519' } | Select-Object -First 1)
}
if (-not $kh) {
    Warn "本机 known_hosts 里没找到 $ServerIp 的 ed25519 主机密钥"
    Warn "先跑一次 `ssh $Server`（或者 `ssh-keyscan -t ed25519 $ServerIp` 手动核对指纹），再重跑本脚本"
    Die "缺 DEPLOY_KNOWN_HOSTS，不继续"
}
$kh = $kh.Trim()

& $gh secret set DEPLOY_SSH_KEY -R $repo --body (Get-Content $KeyPath -Raw)
if ($LASTEXITCODE -ne 0) { Die "DEPLOY_SSH_KEY 没设上" }
& $gh secret set DEPLOY_HOST -R $repo --body $ServerIp
& $gh secret set DEPLOY_USER -R $repo --body $ServerUser
& $gh secret set DEPLOY_KNOWN_HOSTS -R $repo --body $kh
Ok "4 项 Secret 都填好了"

# ── 6. 收尾 ─────────────────────────────────────────────────
Write-Host "`n────────────────────────────────────────"
Ok "初始化完成"
Write-Host "下一步："
Write-Host "  1. 往 GitHub 推一次提交（CI 绿了 Deploy 会自动跑）"
Write-Host "  2. 后台登录口令（如果要自己拿来看）："
Write-Host "       ssh $Server `"grep ADMIN_PASSWORD /home/ubuntu/dreamcity-platform/.env`""
Write-Host "  3. 正式讲师账号（生产密码只在你自己的终端里出现一次）："
Write-Host "       ssh $Server `"cd /home/ubuntu/dreamcity-platform && npm run create:teacher`""
Write-Host "────────────────────────────────────────"
