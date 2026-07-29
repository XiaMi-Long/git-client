## ADDED Requirements

### Requirement: 暗色默认主题

系统 SHALL 默认使用暗色主题，所有色彩取自设计语言定义的暗色 token。

#### Scenario: 首次启动

- **WHEN** 用户首次启动应用
- **THEN** 界面为暗色主题

### Requirement: 亮色切换

系统 SHALL 支持切换到亮色主题，且主题选择持久化到本地配置。

#### Scenario: 切换亮色

- **WHEN** 用户切换到亮色
- **THEN** 界面即时切换为亮色 token，且下次启动保持亮色

### Requirement: 纯中文界面

系统 SHALL 全部界面文案使用简体中文，不引入 i18n 框架。

#### Scenario: 中文文案

- **WHEN** 用户使用应用
- **THEN** 所有按钮、菜单、状态提示均为简体中文
