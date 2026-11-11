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

`.env` 不在仓库里，永远由服务器自己保管。部署脚本每次都会检查它还在不在。
要补的是后台占位账号的口令（现在是开发默认值 `123456`）：

```bash
ssh tencent "cd /home/ubuntu/dreamcity-platform && grep -q ADMIN_PASSWORD .env || echo 'ADMIN_PASSWORD=<你自己的口令>' >> .env"
```

> 用 `>>` 不用 `>` —— 那个文件里还有数据库、Redis、JWT 密钥。

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

## 6. 风险与退路

**GitHub-hosted runner 在美国，SSH 到国内服务器可能不稳。**
如果第一次部署卡在连不上服务器（超时/连接重置），退路有两条：

1. **把 runner 换近一点**：私有仓库可以买 GitHub 的新加坡/东京 larger runner（要付费）
2. **保留 Gitee 作为拉取源**：GitHub 只当 CI 与代码真源，Actions 通过 Gitee 镜像或
   一次 `git push gitee main` 把提交同步过去，服务器 `git pull` —— 这条路服务器实测 1.6 秒就通

除此之外 Gitee 远端可以留着当备份，不需要删。
