# cc-lark

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-blue.svg)](https://nodejs.org/)

Feishu/Lark MCP Server for Claude Code. Based on [openclaw-lark](https://github.com/larksuite/openclaw-lark).

基于 [openclaw-lark](https://github.com/larksuite/openclaw-lark) 的 Claude Code MCP Server，让 Claude Code 能够操作飞书/Lark。

## 功能特性

- 🔐 **OAuth 授权**: 设备流授权，安全获取用户令牌
- 💬 **即时通讯**: 读取和发送群聊、单聊消息
- 📄 **文档操作**: 创建、读取、更新飞书文档
- 📊 **多维表格**: 表格、字段、记录的增删改查
- 📅 **日历**: 日历和事件管理
- ✅ **任务**: 任务和任务列表管理
- 📁 **云盘**: 文件操作
- 📚 **Wiki**: 知识库空间管理
- 📋 **表格**: 电子表格操作
- 🔍 **搜索**: 文档搜索

## 安装

```bash
npm install cc-lark
```

## 快速开始

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 `App ID` 和 `App Secret`
4. 配置所需权限（参考下方权限配置）

### 2. 配置环境变量

```bash
export FEISHU_APP_ID="cli_xxxxxxxxxxxx"
export FEISHU_APP_SECRET="xxxxxxxxxxxxxxxxxxxx"
```

### 3. 在 Claude Code 中使用

添加到 Claude Code 配置 (`~/.config/claude-code/mcp.json`):

```json
{
  "mcpServers": {
    "feishu": {
      "command": "npx",
      "args": ["cc-lark"]
    }
  }
}
```

### 4. 授权

首次使用时，Claude Code 会提示你进行飞书授权。按照提示访问授权链接完成授权即可。

## 可用工具

### IM 消息

| 工具 | 描述 |
|------|------|
| `feishu_im_send_message` | 发送消息到会话 |
| `feishu_im_reply_message` | 回复消息 |
| `feishu_im_get_messages` | 获取会话消息 |
| `feishu_im_get_thread_messages` | 获取话题消息 |
| `feishu_im_search_messages` | 搜索消息 |
| `feishu_im_fetch_resource` | 获取消息资源（图片、文件等） |

### 文档

| 工具 | 描述 |
|------|------|
| `feishu_create_doc` | 创建文档 |
| `feishu_fetch_doc` | 获取文档内容 |
| `feishu_update_doc` | 更新文档 |

### 多维表格

| 工具 | 描述 |
|------|------|
| `feishu_bitable_app` | 多维表格应用操作 |
| `feishu_bitable_table` | 数据表操作 |
| `feishu_bitable_record` | 记录操作 |
| `feishu_bitable_field` | 字段操作 |

### 日历

| 工具 | 描述 |
|------|------|
| `feishu_calendar` | 日历操作 |
| `feishu_calendar_event` | 日历事件操作 |

### 任务

| 工具 | 描述 |
|------|------|
| `feishu_task` | 任务操作 |
| `feishu_tasklist` | 任务列表操作 |

### 其他

| 工具 | 描述 |
|------|------|
| `feishu_drive_file` | 云盘文件操作 |
| `feishu_wiki_space` | 知识库空间操作 |
| `feishu_wiki_node_list` | 知识库节点列表 |
| `feishu_wiki_node_get` | 获取知识库节点 |
| `feishu_sheet` | 电子表格操作 |
| `feishu_doc_search` | 文档搜索 |
| `feishu_chat_search` | 会话搜索 |
| `feishu_chat_get` | 获取会话 |
| `feishu_chat_members` | 会话成员管理 |
| `feishu_get_user` | 获取用户信息 |
| `feishu_search_user` | 搜索用户 |
| `feishu_oauth` | OAuth 授权管理 |

## Skills 使用指南

cc-lark 包含以下 Skills 文档，帮助 Claude Code 更好地使用工具：

| Skill | 描述 |
|-------|------|
| `feishu-im-read` | IM 消息读取指南 |
| `feishu-create-doc` | 文档创建指南 |
| `feishu-fetch-doc` | 文档获取指南 |
| `feishu-update-doc` | 文档更新指南 |
| `feishu-bitable` | 多维表格操作指南 |
| `feishu-calendar` | 日历操作指南 |
| `feishu-task` | 任务操作指南 |
| `feishu-channel-rules` | 频道规则配置 |
| `feishu-troubleshoot` | 故障排查指南 |

## 权限配置

在飞书开放平台配置以下权限（根据需要选择）：

### IM 消息权限
- `im:message` - 获取与发送消息
- `im:message:readonly` - 获取消息（只读）
- `im:chat` - 获取群组信息
- `im:chat:readonly` - 获取群组信息（只读）

### 文档权限
- `docs:doc` - 文档操作
- `docs:doc:readonly` - 文档读取（只读）
- `drive:drive` - 云盘操作
- `drive:drive:readonly` - 云盘读取（只读）

### 多维表格权限
- `bitable:app` - 多维表格操作
- `bitable:app:readonly` - 多维表格读取（只读）

### 日历权限
- `calendar:calendar` - 日历操作
- `calendar:calendar:readonly` - 日历读取（只读）

### 任务权限
- `task:task` - 任务操作
- `task:task:readonly` - 任务读取（只读）

## 开发

### 构建项目

```bash
npm run build
```

### 运行测试

```bash
npm test
```

### 开发模式

```bash
npm run dev
```

## 上游同步

本项目自动同步 [openclaw-lark](https://github.com/larksuite/openclaw-lark) 的更新。

- 每日自动检测上游更新
- 有更新时自动创建 PR
- 请在合并前仔细审查变更

## 与 openclaw-lark 的差异

| 方面 | openclaw-lark | cc-lark |
|------|---------------|---------|
| 运行环境 | OpenClaw 平台 | 独立 MCP Server |
| 入口 | OpenClawPluginApi | MCP Server |
| 频道功能 | 完整频道插件 | 仅工具调用 |
| 消息接收 | WebSocket/Webhook | 无（仅主动调用） |
| 工具命名 | feishu_* | feishu_*（保持一致） |
| Skills | 完整 | 复用上游 |

## 许可证

MIT

## 致谢

本项目基于 [openclaw-lark](https://github.com/larksuite/openclaw-lark) 开发，感谢飞书团队的开源贡献。
