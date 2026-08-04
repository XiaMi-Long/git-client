# 发布与自动更新指南

本项目通过 **GitHub Releases + tauri-plugin-updater** 实现分发与自动更新，无需自建服务器。

## 原理

```
发版：npm run tauri build
  → 产物：git-client_x.x.x_x64-setup.exe（安装包）
         git-client_x.x.x_x64-setup.exe.sig（签名，私钥生成）
         latest.json（更新清单：版本号 + 下载地址 + 签名）
  → 上传到 GitHub Releases

用户端：启动 5 秒后静默检查 / 设置-关于-检查更新
  → 请求 latest.json → 比对版本 → 下载安装包 → 公钥验签 → 静默安装 → 重启
```

## 签名密钥（重要！）

- **私钥**：`E:/私人项目/.tauri-key/git-client.key`（**勿提交到仓库，已 gitignore 在项目外**）
- **公钥**：已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`
- ⚠️ **请加密备份 `.tauri-key` 整个文件夹**（如压缩后存网盘）
  - 私钥丢失 → 无法再签名新版本 → 已装应用无法自动更新（需重装）
  - 私钥泄露 → 他人可伪造更新（谨慎保管）

## 每次发版流程

```bash
# 1. 升级版本号（三处保持一致）：
#    src-tauri/tauri.conf.json → "version": "0.2.0"
#    src-tauri/Cargo.toml      → version = "0.2.0"
#    src/components/layout/SettingsDialog.vue 关于页版本号

# 2. 构建（需要私钥环境变量，Windows PowerShell）：
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "E:\私人项目\.tauri-key\git-client.key"
npm run tauri build

# 3. 产物在 src-tauri/target/release/bundle/nsis/ 下：
#    git-client_0.2.0_x64-setup.exe
#    git-client_0.2.0_x64-setup.exe.sig
#    latest.json（在同一目录或根目录，随版本生成）

# 4. 发布到 GitHub Releases（网页操作）：
#    仓库 → Releases → Draft a new release
#    Tag: v0.2.0
#    上传 3 个文件：setup.exe、.sig、latest.json
#    发布后用户即可收到更新
```

### 更新清单说明

`latest.json` 内容示例：

```json
{
  "version": "0.2.0",
  "notes": "",
  "pub_date": "2026-08-04T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "（.sig 文件内容）",
      "url": "https://github.com/XiaMi-Long/git-client/releases/download/v0.2.0/git-client_0.2.0_x64-setup.exe"
    }
  }
}
```

> `latest.json` 必须命名为 `latest.json` 并作为 Release 资产上传，因为应用内置的 endpoint 是
> `https://github.com/XiaMi-Long/git-client/releases/latest/download/latest.json`

## 测试更新

1. 先发布 v0.1.0（当前版本）作为基线
2. 改版本号到 0.2.0，构建发布
3. 已安装 v0.1.0 的机器启动 → 5 秒后提示"发现新版本"→ 重启生效
4. 或：设置 → 关于 → 检查更新

## 常见问题

| 问题 | 处理 |
|---|---|
| 检查更新报"签名验证失败" | 公钥不匹配：确认 tauri.conf.json pubkey 与签名私钥是同一对 |
| 下载超时（国内网络） | GitHub Releases 直连慢；可将 `endpoints` 换成 jsDelivr 代理或 Gitee Releases |
| 更新后应用无变化 | 确认 latest.json 的 version 高于当前安装版本 |
| 私钥密码 | 当前私钥无密码；若重设密码，构建需 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
