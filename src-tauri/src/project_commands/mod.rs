//! 读取前端项目脚本，管理命令进程及本次应用会话中的最近一次日志。
//! 通过 Tauri Channel 传输 PTY 输出，终端输入、尺寸及停止操作按项目和任务隔离。
//! @changeLog 2026-11-13: Created. 接入项目命令、持续输出和 dist 目录入口。
//! @changeLog 2026-11-13: Updated. 保留运行中命令的标准输入，支持按任务发送一行文本。
//! @changeLog 2026-11-13: Updated. 使用 portable-pty 和终端数据流替换普通进程管道。
//! @changeLog 2026-11-13: Updated. 支持在项目根目录执行手动输入的命令行。
//! @changeLog 2026-11-14: Updated. 终端里的 Ctrl+C 结算为用户停止，并给停止、关闭和日志排空等待设上限。

mod process_tree;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_shell::ShellExt;
use tokio::sync::watch;

use process_tree::ProcessTree;

/// 日志读取按块传输，避免没有换行的进度输出一直滞留在缓冲区。
const OUTPUT_CHUNK_BYTES: usize = 8192;
// ConPTY 的行列使用有符号短整数，前后端均限制到有效的正数范围。
const MAX_TERMINAL_DIMENSION: u16 = 32767;
// Ctrl+C 之后进程在这段时间内退出，就认定这次退出由用户中断引起。
const INTERRUPT_GRACE: Duration = Duration::from_secs(10);
// 终端里的 Ctrl+C 就是一个 ETX 字节，和 Enter、方向键一样按原始字节传递。
const CTRL_C: u8 = 0x03;
// 关闭 ConPTY 和排空日志都可能卡在系统管道上，任务结算不能无限等待。
const TERMINAL_SETTLE_TIMEOUT: Duration = Duration::from_secs(3);
// 停止请求必须有上限，否则界面会永远停在“停止中”。
const STOP_TIMEOUT: Duration = Duration::from_secs(15);
const MANIFEST_ERROR: &str = "package.json 读取失败";
const MANAGER_ERROR: &str = "未找到所选包管理器";
const STOP_TIMEOUT_ERROR: &str = "等待命令退出超时";

/// 支持从项目声明或锁文件识别的脚本运行器。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl PackageManager {
    /// 返回运行器的可执行名称。
    fn name(self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::Pnpm => "pnpm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
        }
    }
}

/// package.json 中的原始脚本，不在应用中自行解释脚本内容。
#[derive(Clone, Serialize)]
pub struct ProjectScript {
    name: String,
    command: String,
}

/// 弹窗加载结果，dist 信息独立于 package.json 是否有效。
#[derive(Serialize)]
pub struct ProjectCommandInfo {
    scripts: Vec<ProjectScript>,
    manager: Option<PackageManager>,
    manifest_status: &'static str,
    detail: Option<String>,
    dist_exists: bool,
}

/// 最近一次执行快照，结束后仍保留输出供本次应用会话重新查看。
#[derive(Clone, Serialize)]
pub struct ProjectTaskSnapshot {
    task_id: u64,
    project_path: String,
    script: String,
    command: String,
    status: &'static str,
    exit_code: Option<i32>,
    output: String,
    revision: u64,
}

/// 有序传输增量输出和最终状态，序号用于排除快照已包含的输出。
#[derive(Serialize)]
pub struct TerminalEvent {
    task_id: u64,
    revision: u64,
    output: String,
    status: &'static str,
    exit_code: Option<i32>,
}

/// 终端资源与注册表分别加锁，阻塞输入或 ConPTY 关闭不能占用任务状态锁。
#[derive(Clone)]
struct TerminalIo {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

/// 运行中才持有进程树，完成信号供停止命令等待日志排空和退出状态写回。
struct ProjectTask {
    snapshot: ProjectTaskSnapshot,
    tree: Option<Arc<ProcessTree>>,
    terminal: Option<TerminalIo>,
    channel: Option<Channel<TerminalEvent>>,
    completion: watch::Sender<bool>,
    stop_requested: bool,
    /// 终端里按下 Ctrl+C 的时间，用于把用户中断和命令自身失败区分开。
    interrupt_at: Option<Instant>,
}

#[derive(Default)]
struct TaskRegistry {
    tasks: HashMap<PathBuf, ProjectTask>,
    next_id: u64,
    shutting_down: bool,
}

/// 应用级任务状态，弹窗销毁只解除订阅，日志在应用退出时释放。
#[derive(Clone, Default)]
pub struct ProjectCommandsState(Arc<Mutex<TaskRegistry>>);

impl ProjectCommandsState {
    /// 应用退出时同步终止仍在运行的任务，阻止再启动新命令。
    pub fn shutdown(&self) {
        if let Ok(mut registry) = self.0.lock() {
            registry.shutting_down = true;
            for task in registry.tasks.values_mut() {
                if let Some(tree) = &task.tree {
                    let _ = tree.terminate();
                    task.stop_requested = true;
                }
            }
        }
    }

    /// 将输出追加到原任务。旧任务不能更新同项目后来启动的快照。
    fn append_output(&self, root: &Path, task_id: u64, text: &str) {
        if text.is_empty() {
            return;
        }
        // 锁内只维护任务快照，Channel 属于界面层，必须解锁后再发送，避免两边互相等待。
        let notification = if let Ok(mut registry) = self.0.lock() {
            let Some(task) = registry.tasks.get_mut(root) else {
                return;
            };
            if task.snapshot.task_id != task_id {
                return;
            }
            task.snapshot.output.push_str(text);
            task.snapshot.revision += 1;
            task.channel.clone().map(|channel| (channel, TerminalEvent {
                task_id, revision: task.snapshot.revision, output: text.to_string(),
                status: task.snapshot.status, exit_code: task.snapshot.exit_code,
            }))
        } else {
            return;
        };
        if let Some((channel, event)) = notification {
            let _ = channel.send(event);
        }
    }
}

/// 以真实目录隔离任务，避免同一路径的不同写法绕过同项目互斥。
fn project_root(path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err(MANIFEST_ERROR.into());
    }
    Ok(root)
}

/// 优先采用 packageManager 声明，其次采用唯一锁文件；有歧义时交给选择控件。
fn detect_manager(root: &Path, manifest: &serde_json::Value) -> Option<PackageManager> {
    let declared = manifest.get("packageManager").and_then(|item| item.as_str())
        .and_then(|declaration| declaration.split('@').next());
    let managers = [PackageManager::Npm, PackageManager::Pnpm, PackageManager::Yarn, PackageManager::Bun];
    if let Some(manager) = managers.iter().find(|manager| Some(manager.name()) == declared) {
        return Some(*manager);
    }
    let lock_files: &[(PackageManager, &[&str])] = &[
        (PackageManager::Npm, &["package-lock.json", "npm-shrinkwrap.json"]),
        (PackageManager::Pnpm, &["pnpm-lock.yaml"]),
        (PackageManager::Yarn, &["yarn.lock"]),
        (PackageManager::Bun, &["bun.lock", "bun.lockb"]),
    ];
    let matches: Vec<_> = lock_files.iter()
        .filter(|(_, files)| files.iter().any(|file| root.join(file).is_file()))
        .map(|(manager, _)| *manager).collect();
    if matches.len() == 1 { Some(matches[0]) } else { None }
}

/// 读取 scripts 和目录状态，缺失、空数据与文件错误分别返回给已确认的 UI 状态。
fn read_project_info(root: &Path) -> ProjectCommandInfo {
    let mut info = ProjectCommandInfo {
        scripts: Vec::new(), manager: None, manifest_status: "ready", detail: None,
        dist_exists: root.join("dist").is_dir(),
    };
    let content = match std::fs::read(root.join("package.json")) {
        Ok(content) => content,
        Err(error) => {
            info.manifest_status = if error.kind() == std::io::ErrorKind::NotFound { "missing" } else { "invalid" };
            info.detail = Some(error.to_string());
            return info;
        }
    };
    // 兼容 Windows 编辑器保存的 UTF-8 BOM，包管理器同样允许这种文件。
    let json_bytes = content.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&content);
    let manifest: serde_json::Value = match serde_json::from_slice(json_bytes) {
        Ok(manifest) => manifest,
        Err(error) => {
            info.manifest_status = "invalid";
            info.detail = Some(error.to_string());
            return info;
        }
    };
    info.manager = detect_manager(root, &manifest);
    if let Some(scripts) = manifest.get("scripts").and_then(|scripts| scripts.as_object()) {
        info.scripts = scripts.iter().filter_map(|(name, command)| {
            let command = command.as_str()?;
            if command.trim().is_empty() {
                return None;
            }
            Some(ProjectScript { name: name.clone(), command: command.to_string() })
        }).collect();
    }
    if info.scripts.is_empty() {
        info.manifest_status = "empty";
    }
    info
}

/// 查找已安装的包管理器，使用完整路径调用，参数交给系统进程 API 处理。
fn manager_executable(manager: PackageManager) -> Option<PathBuf> {
    let search_path = std::env::var_os("PATH")?;
    #[cfg(windows)]
    let extensions = [".exe", ".cmd", ".bat"];
    #[cfg(not(windows))]
    let extensions = [""];
    for directory in std::env::split_paths(&search_path) {
        for extension in extensions {
            let executable = directory.join(format!("{}{extension}", manager.name()));
            if executable.is_file() {
                return Some(executable);
            }
        }
    }
    None
}

/// 启动已构造的 PTY 任务，脚本和手动命令共用互斥、快照、输出订阅和进程树清理。
fn start_task(
    state: &ProjectCommandsState,
    root: &Path,
    project_path: String,
    script: String,
    display_command: String,
    mut command: CommandBuilder,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
) -> Result<ProjectTaskSnapshot, String> {
    // 1. 头部命令区和终端内的交互输出使用同一种终端能力。
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let pair = native_pty_system().openpty(terminal_size(cols, rows))
        .map_err(|error| error.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|error| error.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|error| error.to_string())?;

    // 2. 检查和登记在同一个锁内完成，重复点击不能并行启动同项目的构建。
    let (child, snapshot, tree) = {
        let mut registry = state.0.lock().map_err(|error| error.to_string())?;
        let unavailable = registry.shutting_down || registry.tasks.get(root)
            .map_or(false, |task| task.snapshot.status == "running");
        if unavailable {
            return Err("执行中".into());
        }
        let mut child = pair.slave.spawn_command(command).map_err(|error| error.to_string())?;
        let tree = match ProcessTree::attach(child.as_ref()) {
            Ok(tree) => Arc::new(tree),
            Err(error) => {
                let _ = child.kill();
                return Err(error.to_string());
            }
        };
        if let Err(error) = process_tree::release_start(writer.as_mut()) {
            let _ = tree.terminate();
            return Err(error.to_string());
        }
        registry.next_id += 1;
        let snapshot = ProjectTaskSnapshot {
            task_id: registry.next_id, project_path, script, command: display_command,
            status: "running", exit_code: None, output: String::new(), revision: 0,
        };
        let (completion, _) = watch::channel(false);
        let terminal = TerminalIo {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
        };
        registry.tasks.insert(root.to_path_buf(), ProjectTask {
            snapshot: snapshot.clone(), tree: Some(tree.clone()), terminal: Some(terminal),
            channel: Some(on_event), completion, stop_requested: false, interrupt_at: None,
        });
        (child, snapshot, tree)
    };

    // 3. 释放父进程持有的 slave；PTY 读取和退出等待分别在阻塞线程执行。
    drop(pair.slave);
    let task_id = snapshot.task_id;
    let task_state = ProjectCommandsState::clone(state);
    let task_root = root.to_path_buf();
    tauri::async_runtime::spawn(async move {
        supervise_task(task_state, task_root, task_id, child, tree, reader).await;
    });
    Ok(snapshot)
}

/// 读取脚本及目录信息，打开弹窗本身不执行项目命令。
/// 读取文件不放在主线程执行，避免磁盘变慢时整个窗口没有响应。
#[tauri::command]
pub async fn project_get_command_info(path: String) -> Result<ProjectCommandInfo, String> {
    Ok(read_project_info(&project_root(&path)?))
}

/// 恢复当前应用会话中该项目最近一次输出，不重新启动命令。
/// 停止和关闭流程会先调用它，因此不能占用主线程等待状态锁。
#[tauri::command]
pub async fn project_get_command_task(
    path: String, state: State<'_, ProjectCommandsState>,
) -> Result<Option<ProjectTaskSnapshot>, String> {
    let root = project_root(&path)?;
    let registry = state.inner().0.lock().map_err(|error| error.to_string())?;
    Ok(registry.tasks.get(&root).map(|task| task.snapshot.clone()))
}

/// 在同一状态锁下恢复快照并接续运行中的终端输出，避免订阅窗口内丢失日志。
#[tauri::command]
pub async fn project_attach_command_terminal(
    path: String, on_event: Channel<TerminalEvent>, state: State<'_, ProjectCommandsState>,
) -> Result<Option<ProjectTaskSnapshot>, String> {
    let root = project_root(&path)?;
    let mut registry = state.inner().0.lock().map_err(|error| error.to_string())?;
    Ok(registry.tasks.get_mut(&root).map(|task| {
        // 订阅与快照在同一把锁内交接，前端按 revision 去重初始化期间的消息。
        if task.snapshot.status == "running" {
            task.channel = Some(on_event);
        }
        task.snapshot.clone()
    }))
}

/// 校验根目录脚本后启动一次执行，同项目运行中的任务由后端互斥保护。
#[tauri::command]
pub async fn project_run_command(
    path: String,
    script: String,
    manager: PackageManager,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
    state: State<'_, ProjectCommandsState>,
) -> Result<ProjectTaskSnapshot, String> {
    // 点击时重读文件，防止启动已经删除的脚本或使用界面中拼接的命令内容。
    let root = project_root(&path)?;
    let info = read_project_info(&root);
    if !info.scripts.iter().any(|entry| entry.name == script) {
        return Err(info.detail.unwrap_or_else(|| MANIFEST_ERROR.into()));
    }
    let executable = manager_executable(manager).ok_or(MANAGER_ERROR)?;
    let display_command = format!("{} run {script}", manager.name());
    let command = process_tree::script_command(&executable, &script, &root)
        .map_err(|error| error.to_string())?;
    start_task(
        state.inner(), &root, path, script, display_command,
        command, cols, rows, on_event,
    )
}

/// 在项目根目录执行用户手动输入的命令行，输出、停止和日志恢复沿用脚本任务。
#[tauri::command]
pub async fn project_run_shell_command(
    path: String,
    command: String,
    cols: u16,
    rows: u16,
    on_event: Channel<TerminalEvent>,
    state: State<'_, ProjectCommandsState>,
) -> Result<ProjectTaskSnapshot, String> {
    let command_line = command.trim();
    if command_line.is_empty() {
        return Err("请输入要执行的命令".into());
    }
    let root = project_root(&path)?;
    let builder = process_tree::shell_command(command_line, &root)
        .map_err(|error| error.to_string())?;
    start_task(
        state.inner(), &root, path, String::new(), command_line.to_string(),
        builder, cols, rows, on_event,
    )
}

/// 按原始字节语义传递终端键盘输入，保留 Enter、方向键和 Ctrl+C 等控制字符。
#[tauri::command]
pub async fn project_write_command_input(
    path: String,
    task_id: u64,
    text: String,
    state: State<'_, ProjectCommandsState>,
) -> Result<(), String> {
    // 写入线程只持有输入管道，不能因阻塞写入而延长 ConPTY 主端的生命周期。
    let writer = running_terminal(state.inner(), &path, task_id)?.writer;
    // Ctrl+C 由终端送进原任务，进程被杀死的退出码是包管理器自己的失败码，
    // 只有在这里记下中断意图，结束时才能按“用户停止”而不是“执行失败”结算。
    if text.as_bytes().contains(&CTRL_C) {
        mark_interrupt(state.inner(), &path, task_id);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut writer = writer.lock().map_err(|error| error.to_string())?;
        writer.write_all(text.as_bytes()).map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

/// 记录终端里按下的 Ctrl+C，后续输出和停止流程仍按原任务处理。
fn mark_interrupt(state: &ProjectCommandsState, path: &str, task_id: u64) {
    if let Ok(mut registry) = state.0.lock() {
        if let Some(task) = registry.tasks.values_mut().find(|task| {
            task.snapshot.task_id == task_id && task.snapshot.project_path == path
        }) {
            if task.snapshot.status == "running" && !task.stop_requested {
                task.interrupt_at = Some(Instant::now());
            }
        }
    }
}

/// 只取得原任务仍可操作的终端，旧请求不能写入或调整同项目的新任务。
fn running_terminal(state: &ProjectCommandsState, path: &str, task_id: u64) -> Result<TerminalIo, String> {
    let registry = state.0.lock().map_err(|error| error.to_string())?;
    let task = registry.tasks.values().find(|task| {
        task.snapshot.task_id == task_id && task.snapshot.project_path == path
    }).ok_or_else(|| std::io::Error::from(std::io::ErrorKind::BrokenPipe).to_string())?;
    let available = task.snapshot.status == "running" && !task.stop_requested;
    if !available {
        return Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe).to_string());
    }
    task.terminal.clone().ok_or_else(|| std::io::Error::from(std::io::ErrorKind::BrokenPipe).to_string())
}

/// 将有效的终端行列同步给 PTY，让交互菜单及构建进度随弹窗尺寸重新布局。
#[tauri::command]
pub async fn project_resize_command_terminal(
    path: String, task_id: u64, cols: u16, rows: u16, state: State<'_, ProjectCommandsState>,
) -> Result<(), String> {
    let terminal = running_terminal(state.inner(), &path, task_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let master = terminal.master.lock().map_err(|error| error.to_string())?;
        master.resize(terminal_size(cols, rows)).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

/// 对来自显示层的行列做原生接口边界保护。
fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(1, MAX_TERMINAL_DIMENSION), rows: rows.clamp(1, MAX_TERMINAL_DIMENSION),
        pixel_width: 0, pixel_height: 0,
    }
}

/// 停止指定任务，等到退出结果和剩余日志全部收齐后返回。
#[tauri::command]
pub async fn project_stop_command(
    path: String, task_id: u64, state: State<'_, ProjectCommandsState>,
) -> Result<Option<ProjectTaskSnapshot>, String> {
    let mut completion = {
        let mut registry = state.inner().0.lock().map_err(|error| error.to_string())?;
        // 目录在构建中可能被移走或删除，停止任务不能依赖文件系统仍能解析此路径。
        let Some(task) = registry.tasks.values_mut().find(|task| {
            task.snapshot.task_id == task_id && task.snapshot.project_path == path
        }) else {
            return Ok(None);
        };
        // 旧弹窗的关闭请求不能终止后来新建的任务。
        if task.snapshot.status != "running" {
            return Ok(Some(task.snapshot.clone()));
        }
        if let Some(tree) = &task.tree {
            tree.terminate().map_err(|error| error.to_string())?;
            task.stop_requested = true;
        }
        task.completion.subscribe()
    };
    // 等退出和日志排空，但必须有上限：系统管道异常时界面不能永远停在“停止中”。
    let waited = tokio::time::timeout(STOP_TIMEOUT, async {
        loop {
            if *completion.borrow_and_update() {
                break;
            }
            completion.changed().await.map_err(|error| error.to_string())?;
        }
        Ok::<(), String>(())
    }).await;
    match waited {
        Ok(result) => result?,
        Err(_) => return Err(STOP_TIMEOUT_ERROR.into()),
    }
    let registry = state.inner().0.lock().map_err(|error| error.to_string())?;
    Ok(registry.tasks.values().find(|task| task.snapshot.task_id == task_id)
        .map(|task| task.snapshot.clone()))
}

/// 在系统文件管理器中打开固定 dist 子目录，打开前再次确认目录仍存在。
#[tauri::command]
pub async fn project_open_dist(path: String, app: AppHandle) -> Result<(), String> {
    let dist = project_root(&path)?.join("dist");
    if !dist.is_dir() {
        return Err(std::io::Error::from(std::io::ErrorKind::NotFound).to_string());
    }
    let directory = dist.to_string_lossy().into_owned();
    // Explorer 使用普通绝对路径，避免 canonicalize 的 Windows 扩展前缀被当成 URL。
    #[cfg(windows)]
    let directory = if let Some(network) = directory.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{network}")
    } else {
        directory.strip_prefix(r"\\?\").unwrap_or(&directory).to_string()
    };
    #[allow(deprecated)]
    app.shell().open(directory, None).map_err(|error| error.to_string())
}

/// 收齐进程及输出流后再宣布完成，进程结束也清理其派生的后台子进程。
async fn supervise_task(
    state: ProjectCommandsState, root: PathBuf, task_id: u64,
    mut child: Box<dyn Child + Send + Sync>, tree: Arc<ProcessTree>, reader: Box<dyn Read + Send>,
) {
    let output_state = state.clone();
    let output_root = root.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        capture_output(reader, &output_state, &output_root, task_id);
    });
    let result = tauri::async_runtime::spawn_blocking(move || child.wait()).await
        .map_err(|error| error.to_string()).and_then(|result| result.map_err(|error| error.to_string()));
    if let Err(error) = tree.terminate() {
        state.append_output(&root, task_id, &format!("\r\n{error}\r\n"));
    }

    // 1. 主端必须先移出注册表再在锁外关闭；关闭控制台和排空输出都可能阻塞在系统管道上，
    //    两者各自设上限，任务状态不能依赖它们是否顺利结束。
    let terminal = state.0.lock().ok().and_then(|mut registry| {
        registry.tasks.get_mut(&root).filter(|task| task.snapshot.task_id == task_id)
            .and_then(|task| task.terminal.take())
    });
    let closed = tokio::time::timeout(
        TERMINAL_SETTLE_TIMEOUT, tauri::async_runtime::spawn_blocking(move || drop(terminal)),
    ).await;
    if closed.is_err() {
        state.append_output(&root, task_id, "\r\n关闭终端超时，剩余日志可能不完整。\r\n");
    }
    if tokio::time::timeout(TERMINAL_SETTLE_TIMEOUT, output).await.is_err() {
        state.append_output(&root, task_id, "\r\n读取剩余日志超时。\r\n");
    }
    if let Err(error) = &result {
        state.append_output(&root, task_id, &format!("\r\n{error}\r\n"));
    }

    // 2. 退出码、最终状态和完成信号在同一次状态锁里写回，停止请求随后能拿到最终快照。
    let notification = {
        let Ok(mut registry) = state.0.lock() else {
            return;
        };
        let Some(task) = registry.tasks.get_mut(&root) else {
            return;
        };
        if task.snapshot.task_id != task_id {
            return;
        }
        let succeeded = result.as_ref().map_or(false, |status| status.success());
        let status = task_outcome(task, succeeded);
        task.snapshot.exit_code = result.as_ref().ok().map(|status| status.exit_code() as i32);
        task.snapshot.status = status;
        task.snapshot.revision += 1;
        task.tree = None;
        // 先唤醒等待停止的请求，再把最终状态交给界面层，两者都不占用任务锁。
        task.completion.send_replace(true);
        task.channel.take().map(|channel| (channel, TerminalEvent {
            task_id, revision: task.snapshot.revision, output: String::new(),
            status: task.snapshot.status, exit_code: task.snapshot.exit_code,
        }))
    };
    if let Some((channel, event)) = notification {
        let _ = channel.send(event);
    }
}

/// 用户中断或主动停止都结算为“已停止”，其余按退出码区分成功和失败。
fn task_outcome(task: &ProjectTask, succeeded: bool) -> &'static str {
    // Ctrl+C 只对紧跟着结束的进程生效，避免中断后继续跑很久的命令被误判成用户停止。
    let interrupted = task.interrupt_at.map_or(false, |at| at.elapsed() <= INTERRUPT_GRACE);
    if task.stop_requested || interrupted {
        "stopped"
    } else if succeeded {
        "succeeded"
    } else {
        "failed"
    }
}

/// 逐块解码 UTF-8，保留跨读取边界的半个中文字符，防止日志出现错误替换字符。
fn capture_output(mut stream: Box<dyn Read + Send>, state: &ProjectCommandsState, root: &Path, task_id: u64) {
    let mut buffer = [0u8; OUTPUT_CHUNK_BYTES];
    let mut pending = Vec::new();
    loop {
        let length = match stream.read(&mut buffer) {
            Ok(length) => length,
            Err(error) => {
                // 调整终端大小可能中断阻塞读取，此时重试而不是提前结束日志流。
                if error.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                // Unix PTY 在从端关闭时可返回 EIO，此时已完成正常输出读取。
                #[cfg(unix)]
                if error.raw_os_error() == Some(5) {
                    break;
                }
                state.append_output(root, task_id, &format!("\r\n{error}\r\n"));
                break;
            }
        };
        if length == 0 {
            break;
        }
        pending.extend_from_slice(&buffer[..length]);
        let incomplete = std::str::from_utf8(&pending).err()
            .filter(|error| error.error_len().is_none()).map(|error| error.valid_up_to());
        let decoded_length = incomplete.unwrap_or(pending.len());
        let text = String::from_utf8_lossy(&pending[..decoded_length]);
        state.append_output(root, task_id, &text);
        pending.drain(..decoded_length);
    }
    state.append_output(root, task_id, &String::from_utf8_lossy(&pending));
}
