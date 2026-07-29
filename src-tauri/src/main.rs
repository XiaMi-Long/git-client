// 防止 Windows 控制台窗口弹出
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    git_client_lib::run()
}
