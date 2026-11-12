# 梦之城平台 · GitHub 全流程（CI + 部署）

> 这份文档写给「换到 GitHub 之后怎么跑起来」。
> 代码仓库里的 `.github/workflows/ci.yml` 和 `deploy.yml` 已经就位，
> 本文只讲**需要人操作的那几步**。

---

## 0. 先记住一个硬事实（决定了整套架构）

2026-11-11 实测：

| 从哪连 | github.com | gitee.com |
|---|---|---|
| 本机 | HTTPS 200（慢，约 7 秒） | — |
| 服务器 193.112.18.222 | **20 秒超时，status=000** | 200，1.6 秒 |

**服务器拉不动 GitHub。** 所以部署不能是「服务器 git pull」，
只能是**反过来**：GitHub Actions 把代码包推到服务器，服务器只负责接收和解压重建。

```
  你 ──git push──▶ GitHub
                    │
                    ├─ CI：verify（类型+单测+硬约束）
                    └─ 冒烟：49 项端到端（Postgres + Redis service container）
                    │
                    └─ Deploy：git archive → ssh → 服务器 ci-deploy.sh
                                              └─ docker compose up -d --build
```

---

## 1. 一次性准备（GitHub 侧）

### 1.1 新建私有仓库

在 GitHub 上 New repository：

- 名称：`dreamcity_platform`
- 可见性：**Private**
- **不要**勾选 README / .gitignore / license（本地已经有 git 历史了）

### 1.2 本机给 GitHub 单独备一把密钥

不用 Gitee 那把（`id_ed25519_gitee`），分开才好单独吊销：

```powershell
ssh-keygen -t ed25519 -C "dreamcity-github" -f "$env:USERPROFILE\.ssh\id_ed25519_github" -N '""'
```

> PowerShell 里 `-N '""'` 表示空口令。生成后会有 `id_ed25519_github` 和 `.pub` 两个文件。

把 `.pub` 的内容贴到 GitHub → **Settings → SSH and GPG keys → New SSH key**
（Authentication key），标题写 `dreamcity-local`。

### 1.3 本机 ssh config 加一段

编辑 `C:\Users\admin\.ssh\config`，追加：

```
Host github.com
    HostName github.com
    User git
    Port 22
    IdentityFile ~/.ssh/id_ed25519_github
    IdentitiesOnly yes
```

验证（应该看到 `Hi <你的用户名>!`）：

```powershell
ssh -T git@github.com
```

### 1.4 加远端并首次推送

```powershell
$env:PATH = "$env:LOCALAPPDATA\Programs\Git\cmd;" + $env:PATH
git -C D:\dreamcity_platform remote add github git@github.com:<你的用户名>/dreamcity_platform.git
git -C D:\dreamcity_platform push -u github main
```

> 这条 `push` 必须你自己跑 —— 工具侧会被 *Data Exfiltration* 拦，这是对的。
> 推的是 4 个提交：初始版本 → 后台隐藏入口 → 3D 插件 → 忽略 .claude/

---

## 2. CI 自动跑（push 上去就自动生效，不用配置）

`.github/workflows/ci.yml` 两个 job：

1. **verify** —— `npm run verify`：typecheck + 55 个单测 + 16 项硬约束检查
2. **smoke** —— `node tools/smoke-test.mjs`（49 项端到端）
   - Postgres 16 + Redis 7 用 GitHub 官方的 service container 起
   - 跑的是**生产同样的 pg 驱动**，不是本地 PGlite
   - 后台占位账号当讲师用（`ci-admin@dreamcity.internal`）

仓库是私有的，Actions 用内置 `GITHUB_TOKEN` 拉代码，不需要额外授权。
私有仓库免费额度 2000 分钟/月，这个项目每次 CI 约 3–5 分钟。

---

## 3. 部署通道（服务器侧一次性设置）

### 3.1 把部署脚本放到服务器

仓库里有 `deploy/ci-deploy.sh`，传到服务器并给执行权限：

```powershell
scp "D:\dreamcity_platform\deploy\ci-deploy.sh" tencent:/home/ubuntu/ci-deploy.sh
ssh tencent "chmod +x /home/ubuntu/ci-deploy.sh"
```

### 3.2 生成一把**只能部署**的受限密钥

在**本机**生成（私钥进 GitHub Secrets，公钥进服务器）：

```powershell
ssh-keygen -t ed25519 -C "dreamcity-ci-deploy" -f "$env:USERPROFILE\.ssh\id_ed25519_deploy_ci" -N '""'
```

把公钥加到服务器的 `~/.ssh/authorized_keys`，**带 forced command**，
这样这把密钥除了「送代码包并部署」什么都干不了：

```bash
command="/home/ubuntu/ci-deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... dreamcity-ci
```

（`AAAA...` 换成 `id_ed25519_deploy_ci.pub` 的完整内容。）

> 加之前先备份：`ssh tencent "cp ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak"`

### 3.3 填 GitHub Secrets

仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| 名字 | 内容 |
|---|---|
| `DEPLOY_SSH_KEY` | `id_ed25519_deploy_ci` 的**私钥**全文（含 `-----BEGIN OPENSSH PRIVATE KEY-----` 头尾） |
| `DEPLOY_HOST` | `193.112.18.222` |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_KNOWN_HOSTS` | 见下 |

`DEPLOY_KNOWN_HOSTS` 用服务器钉死的主机密钥（从本机 known_hosts 抄的，
CI 里不用 `ssh-keyscan`——第一次连接才可信的东西不能当凭据）：

```
193.112.18.222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKuUNZB8nXnmaVYb7V80N3QPgkLq/0pNw/PqvNV/wsWs
```

### 3.4 服务器 .env 补一条

`.env` 不在仓库里，永远由服务器自己保管。部署脚本每次都会检查它还在不在，
还会检查 `POSTGRES_PASSWORD` / `REDIS_PASSWORD` / `JWT_SECRET` / `ADMIN_PASSWORD`
这四项在不在 —— 缺了就当场中止，不给「悄悄用默认值」的机会。

要补的是后台占位账号的口令（现在是开发默认值 `123456`）：

```bash
ssh tencent "cd /home/ubuntu/dreamcity-platform && grep -q ADMIN_PASSWORD .env || echo 'ADMIN_PASSWORD=<你自己的口令>' >> .env"
```

> 用 `>>` 不用 `>` —— 那个文件里还有数据库、Redis、JWT 密钥。

⚠ **2026-11-12 起这条变成硬要求**：`deploy/docker-compose.yml` 里
`ADMIN_PASSWORD` 写成了必填项（`${ADMIN_PASSWORD:?…}`），而且显式传进容器。
原因是不传的话容器里读不到主机上的 `.env`，`env.ts` 会退回 `admin / 123456` ——
那等于给后台留了一把公开钥匙。缺口令时部署会直接失败，这是故意的。

口令可以让服务器自己生成，本机不经手：

```bash
ssh tencent "cd /home/ubuntu/dreamcity-platform && printf 'ADMIN_PASSWORD=%s\n' \"\$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)\" >> .env"
```

### 3.5 或者：一键脚本（推荐）

上面 3.1–3.4 全都是重复劳动，已经收进一个脚本：

```powershell
powershell -ExecutionPolicy Bypass -File D:\dreamcity_platform\tools\setup-ci-deploy.ps1
```

它做四件事，都可重复跑：部署脚本上服务器 → 生成 CI 专用密钥并写 authorized_keys
（带 forced command）→ 服务器补 `ADMIN_PASSWORD` → 填 4 项 GitHub Secrets。
私钥只在本机生成一次，口令由服务器自己生成、脚本不读回内容。

**必须在普通 PowerShell 里跑**（不要在 Claude Code 里跑）—— 那里的权限护栏会拦密钥操作。

---

## 4. 第一次部署与验收

1. GitHub 上 Actions → **Deploy** → Run workflow（手动触发）
2. 看日志：`发送代码包 → 解压 → docker compose up -d --build → 健康检查`
3. 验收：
   - `curl https://platform.lhdreamcity.com/api/health` 返回 `{"ok":true,...}`
   - 落地页**只有**家长和学生两个入口，没有讲师入口
   - `/console` 能用正式讲师账号登进去
   - 插件库 4 个（柠檬摊、提示词 quests、变量实验室 2D、3D）

### 建正式讲师账号（仍然只能你亲自跑）

口令不该经过任何会记录它的工具：

```bash
ssh tencent "cd /home/ubuntu/dreamcity-platform && npm run create:teacher --email <邮箱> --name <姓名>"
```

---

## 5. 之后每次上线

```
改代码 → git commit → git push github main
   → CI 自动跑（verify + 冒烟）
   → 全绿才自动部署（Deploy 等 CI 的 workflow_run）
```

想在部署前人工确认，把 `.github/workflows/deploy.yml` 里的
`on: workflow_run` 段删掉，只留 `workflow_dispatch`（手动触发部署）。

### 回滚

Deploy 重新跑一次旧的提交即可：Actions 里选那个 commit → Run workflow。
数据库在独立 volume 里，回滚代码不动数据。

---

## 5.5 2026-11-12 · CI 连挂两次的根因（记下来别再踩）

第一次跑 CI，verify 全绿，冒烟 job 却**秒死**在 `npm run build`。两个坑叠在一起：

**坑一：`NODE_ENV=production` 让 `npm ci` 装不上 devDependencies。**
smoke job 原来在 job 级设了 `NODE_ENV: production`。npm 的 `omit` 默认值跟着它走 ——
`NODE_ENV=production` 时 `npm config get omit` 返回 `dev`，于是 `npm ci` 根本不装
devDependencies，vite / typescript / vitest 全都不在容器里，`npm run build` 立刻
`vite: not found`。verify job 没设这个变量，所以它是绿的 —— 看着像"随机挂"。

> 修法：`NODE_ENV=production` 只加在真正起后端的那一步上，job 级不要设。
> 自检：`NODE_ENV=production npm config get omit` → 应该输出 `dev`。

**坑二：冒烟测试依赖演示数据，CI 却种的是「无演示数据」的版本。**
`npm run seed:content` 实际是 `tsx src/seed.ts --no-demo` —— 不种演示学生
`stu_demo_xiaoyu`、不种演示家长 `13800000001`。而冒烟测试的 [3]–[8] 段全程依赖它们
（进班名单、三键采集、作品墙时间线、越权 404…），不种就是空跑。
生产库不要演示数据是对的，但 CI 是一次性容器，种了也带不走。

> 修法：CI 里用 `npm run seed`（含演示数据）。

**顺带修掉的两个部署隐患：**

- `deploy/docker-compose.yml` 没把 `ADMIN_*` 传进容器 → 容器退回 `admin / 123456`。
  现在改成显式传递，且 `ADMIN_PASSWORD` 是必填项，缺了部署直接失败。
- `deploy/ci-deploy.sh` 只检查 `.env` 在不在，不检查里面有没有必填项。
  现在会逐项检查并报出缺哪个。
- `ci.yml` 里「服务端日志（失败时）」那步在服务没起来时 `tail` 一个不存在的文件，
  自己也会失败、把真正的原因盖掉 —— 加了 `|| true`。

**关于日志权限**：Actions 的完整日志必须登录才能读（API 403），但
「每个 job / 每一步的成败结论」用匿名 API 就能读（仓库是公开的）：

```powershell
$h=@{'User-Agent'='ps'}
$run=(Invoke-RestMethod "https://api.github.com/repos/lhDreamCity/dreamcity_platform/actions/runs?per_page=3" -Headers $h).workflow_runs
$jobs=(Invoke-RestMethod "https://api.github.com/repos/lhDreamCity/dreamcity_platform/actions/runs/$($run[1].id)/jobs" -Headers $h).jobs
$jobs | ForEach-Object { "$($_.name) => $($_.conclusion)"; $_.steps | ForEach-Object { "   $($_.name) => $($_.conclusion)" } }
```

哪一步挂了、后面哪些被 skipped，看这个就够 —— 不用等日志。

---

## 6. 风险与退路

**GitHub-hosted runner 在美国，SSH 到国内服务器可能不稳。**
如果第一次部署卡在连不上服务器（超时/连接重置），退路有两条：

1. **把 runner 换近一点**：私有仓库可以买 GitHub 的新加坡/东京 larger runner（要付费）
2. **保留 Gitee 作为拉取源**：GitHub 只当 CI 与代码真源，Actions 通过 Gitee 镜像或
   一次 `git push gitee main` 把提交同步过去，服务器 `git pull` —— 这条路服务器实测 1.6 秒就通

> 2026-11-12 已把 `main` 推上 Gitee（`gitee.com:piloting-the-city-of-dreams/dreamcity_platform.git`），
> 镜像不再是空仓库，这条退路现在是通的。Gitee 还能给服务器提供一条**完全绕开 GitHub**
> 的部署路线：Actions 只负责验证，部署改成服务器自己 `git pull gitee` + 重建。

### 仓库可见性：现在是 public

`lhDreamCity/dreamcity_platform` 建的时候设成了 **Public**（2026-11-11），
所以匿名 API 就能读到 Actions 的状态与结论（完整日志仍然要登录）。
代码本身没有密钥，但里面写着生产域名、部署脚本与基础设施细节。

要改成 Private 的话：仓库 → Settings → General → Danger Zone → Change visibility。
注意改完以后上面那段「匿名读 job 结论」的脚本会 404，得配一个 token 才能读。
