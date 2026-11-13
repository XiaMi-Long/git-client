//! 为 portable-pty 的项目脚本提供进程树管理及 Windows 启动屏障。
//! 任务停止、结束或应用退出时回收脚本派生的进程，避免 Node 构建进程遗留。
//! @changeLog 2026-11-13: Created. 为项目命令提供与弹窗生命周期一致的进程清理。
//! @changeLog 2026-11-13: Updated. 接入 PTY 子进程，并在 Windows Job 登记后才启动包管理器。
//! @changeLog 2026-11-13: Updated. 修正 CMD 的盘符工作目录和启动等待参数。
//! @changeLog 2026-11-13: Updated. 使用原生目录分隔符拼接 CMD 路径，修复启动命令行解析失败。

use std::io;
use portable_pty::{Child, CommandBuilder};
use std::path::Path;

/// 构造项目脚本进程。Windows 的批处理入口先等待输入，避免派生进程逃离 Job。
pub fn script_command(executable: &Path, script: &str, root: &Path) -> io::Result<CommandBuilder> {
    #[cfg(windows)]
    {
        use std::path::{Component, PathBuf, Prefix};

        // 1. canonicalize 返回的扩展盘符路径会被 CMD 当成 UNC，启动时恢复普通盘符格式。
        // 只转换命令的工作目录，外部任务注册表继续使用规范化路径，保证项目互斥不变。
        let mut directory = root.to_path_buf();
        if let Some(Component::Prefix(prefix)) = root.components().next() {
            if let Prefix::VerbatimDisk(drive) = prefix.kind() {
                directory = PathBuf::from(format!("{}:\\", char::from(drive)));
                directory.extend(root.components().skip(2));
            }
        }

        // 2. 在 Job 登记后才放行包管理器，隐藏启动提示，并显式启用 set /p 所需的命令扩展。
        // cmd 的参数通过环境变量传入，禁止打破双引号边界的名称；不使用二次展开的 call。
        if script.contains(['"', '\r', '\n', '\0']) {
            return Err(io::ErrorKind::InvalidInput.into());
        }
        let shell = std::env::var_os("SystemRoot")
            // portable-pty 会把没有空格的程序路径原样放入命令行，混入 /cmd.exe 会影响 CMD 解析。
            .map(|root| PathBuf::from(root).join("System32").join("cmd.exe"))
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;
        let mut command = CommandBuilder::new(shell);
        command.cwd(directory);
        command.args(["/d", "/e:on", "/q", "/s", "/v:off", "/c",
            "set /p GITTRAIL_READY=.>nul & %GITTRAIL_RUNNER% run %GITTRAIL_SCRIPT%"]);
        command.env("GITTRAIL_RUNNER", format!("\"{}\"", executable.display()));
        command.env("GITTRAIL_SCRIPT", format!("\"{script}\""));
        Ok(command)
    }
    #[cfg(not(windows))]
    {
        let mut command = CommandBuilder::new(executable);
        command.cwd(root);
        command.args(["run", script]);
        Ok(command)
    }
}

/// Job 登记完成后放行 Windows 启动屏障，Unix 的进程组由 portable-pty 创建。
pub fn release_start(writer: &mut dyn io::Write) -> io::Result<()> {
    #[cfg(windows)]
    {
        writer.write_all(b"\r")?;
        writer.flush()?;
    }
    #[cfg(not(windows))]
    let _ = writer;
    Ok(())
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;

    /// Windows Job 的扩展限制字段，布局对应 JOBOBJECT_EXTENDED_LIMIT_INFORMATION。
    #[repr(C)]
    #[derive(Default)]
    struct BasicLimits {
        process_time: i64,
        job_time: i64,
        flags: u32,
        minimum_working_set: usize,
        maximum_working_set: usize,
        active_processes: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ExtendedLimits {
        basic: BasicLimits,
        io_counters: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process_memory: usize,
        peak_job_memory: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> isize;
        fn SetInformationJobObject(job: isize, class: i32, info: *const c_void, size: u32) -> i32;
        fn AssignProcessToJobObject(job: isize, process: isize) -> i32;
        fn TerminateJobObject(job: isize, exit_code: u32) -> i32;
        fn CloseHandle(handle: isize) -> i32;
    }

    /// 提前失败和正常退出时都释放 Job 句柄。
    struct NativeHandle(isize);

    impl Drop for NativeHandle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0); }
        }
    }

    /// 最后一个持有者释放句柄时，系统会终止 Job 中残留的子进程。
    pub struct ProcessTree(NativeHandle);

    impl ProcessTree {
        /// 将新进程加入独立 Job，之后创建的子进程继承该 Job。
        pub fn attach(child: &dyn Child) -> io::Result<Self> {
            const EXTENDED_LIMIT_INFORMATION: i32 = 9;
            const KILL_ON_JOB_CLOSE: u32 = 0x2000;
            let process = child.as_raw_handle().ok_or_else(io::Error::last_os_error)?;
            // 所有指针只在本次原生调用期间使用，返回的 Job 句柄由 ProcessTree 独占管理。
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job == 0 {
                return Err(io::Error::last_os_error());
            }
            let tree = Self(NativeHandle(job));
            let mut limits = ExtendedLimits::default();
            limits.basic.flags = KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    EXTENDED_LIMIT_INFORMATION,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of::<ExtendedLimits>() as u32,
                )
            };
            if configured == 0 {
                return Err(io::Error::last_os_error());
            }
            let assigned = unsafe { AssignProcessToJobObject(job, process as isize) };
            if assigned == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(tree)
        }

        /// 终止此任务及其子进程，调用方继续等待退出和日志管道排空。
        pub fn terminate(&self) -> io::Result<()> {
            if unsafe { TerminateJobObject(self.0.0, 1) } == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
    }

}

#[cfg(unix)]
mod platform {
    use super::*;

    extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }

    /// 独立进程组的组长 PID，不使用应用自己的进程组。
    pub struct ProcessTree(i32);

    impl ProcessTree {
        /// 保存新任务的进程组 ID。
        pub fn attach(child: &dyn Child) -> io::Result<Self> {
            child.process_id().map(|pid| Self(pid as i32)).ok_or_else(io::Error::last_os_error)
        }

        /// 终止整个任务组。进程已经退出时视为完成清理。
        pub fn terminate(&self) -> io::Result<()> {
            let result = unsafe { kill(-self.0, 9) };
            let error = io::Error::last_os_error();
            if result != 0 && error.raw_os_error() != Some(3) {
                return Err(error);
            }
            Ok(())
        }
    }

    impl Drop for ProcessTree {
        fn drop(&mut self) {
            let _ = self.terminate();
        }
    }
}

pub use platform::ProcessTree;
