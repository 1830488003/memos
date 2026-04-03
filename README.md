# MemOS × SillyTavern 集成插件开发文档

## 概述

将 MemOS 记忆系统集成到 SillyTavern（酒馆），实现：
- 用户发送消息时自动检索相关记忆并注入
- AI 回复后自动保存对话内容
- 支持手动触发记忆检索与保存
- 初始化时自动批量上传历史聊天记录

---

## 使用方法

1. 打开 https://memos-dashboard-gray.openmem.net/cn/apikeys/ 网站
2. 点击"快速接入Cloud API"
3. 登录账号
4. 获取 API 密钥
5. 在酒馆中点击大脑图标 🧠
6. 填写 API 密钥并保存
7. 完成配置，开始使用！

---

## 技术架构

### 目录结构
```
memos/
├── index.js        # 主插件逻辑
├── settings.html   # 设置页面
├── settings.css   # 样式文件
└── manifest.json   # 插件清单
```

### 核心机制

#### 1. 轮询机制
由于 SillyTavern 事件系统不稳定，采用 `setInterval` 轮询检测新消息：
- 每 2 秒检查一次消息数量
- 使用 `processedMessageIndices` Set 防止重复处理（运行时去重）
- 使用 `isInitializing` / `isInitialized` 标志防止初始化和轮询同时执行

```javascript
let isInitializing = false
let isInitialized = false

if (isInitializing) {
    logDebug("正在初始化中，跳过轮询")
    return
}
```

#### 2. 消息保存机制

**初始化时批量保存历史消息：**
- 每条消息保存后等待 1 秒，避免限流
- 只跳过包含 `[MemOS 记忆上下文]` 的注入楼层
- 用户消息和 AI 消息都会保存

**轮询时保存新消息：**
- 用户消息：调用 `addMessage("user", content)`
- AI 消息：调用 `addMessage("assistant", content)`

#### 3. 消息去重机制

**持久化存储（localStorage）：**
- 消息 ID 格式：`char_角色名_chat_聊天名_idx_楼层索引`
- 不同角色卡、不同聊天的消息分开存储
- 切换聊天时自动清理缓存
- 最多保留 1000 条记录，超出时裁剪旧数据

```javascript
const STORAGE_KEY_SAVED_MESSAGES = "memos_saved_message_ids"
const SAVED_VERSION = "2.0"

function generateMessageId(msg, index) {
    const charName = getCharName() || "unknown_char"
    const chatFile = getChatFileName() || "unknown_chat"
    return `char_${charName}_chat_${chatFile}_idx_${index}`
}
```

**版本控制：**
- `SAVED_VERSION = "2.0"`
- 版本不匹配时自动清理旧数据

#### 4. 记忆检索 API
```javascript
POST https://memos.memtensor.cn/api/openmem/v1/search/memory
{
    query: "用户消息内容",
    user_id: "sillytavern_user_001",
    conversation_id: "会话ID"
}
```

#### 5. 记忆注入方式
使用 `TavernHelper.createChatMessages()` 注入（与 quest-system-extension 相同）

#### 6. 发送按钮触发
通过直接点击 `#send_but` 按钮触发生成

---

## 开发历程

### 阶段 1：基础集成
- 参照 auto-summary 插件重写 settings.html
- 实现 API 调用格式修复
- 修复 user_id 为空问题

### 阶段 2：轮询机制
- 轮询间隔从 100ms → 500ms → 1s → 2s
- 添加 processedMessageIndices 防重复
- 修复消息数量计算逻辑

### 阶段 3：触发方式
- 停止按钮：直接点击 `.mes_stop`
- 发送按钮：直接点击 `#send_but`
- 备用方案：模拟 Enter 键事件

### 阶段 4：问题修复
- 修复 system 消息被误判为用户消息的问题
- 修复 sendTextareaMessage 函数不可用问题
- 优化父窗口访问方式

### 阶段 5：历史消息批量上传
- 实现初始化时自动批量上传历史聊天记录
- 每条消息保存后等待 1 秒，避免限流
- 只跳过 `[MemOS 记忆上下文]` 注入楼层

### 阶段 6：消息去重优化
- 使用角色卡名和聊天名生成唯一消息 ID
- 不同聊天分开存储，防止跨聊天重复上传
- 切换聊天时自动清理缓存
- 添加版本控制，自动清理旧数据

### 阶段 7：用户消息和 AI 消息同时保存
- 初始化时用户消息和 AI 消息都保存
- 轮询时用户消息和 AI 消息都保存
- 只跳过注入记忆楼层

---

## 关键代码片段

### 检测用户消息并触发
```javascript
if (msg.role === "user") {
    // 1. 保存用户消息到 MemOS
    await addMessage("user", content.trim())
    
    // 2. 检索记忆
    const result = await searchMemory(query)
    
    // 3. 注入记忆
    await TavernHelper.createChatMessages(memoryContent)
    
    // 4. 触发发送（1.5秒后）
    setTimeout(() => {
        sendBtn?.click()
    }, 1500)
}
```

### 初始化批量保存历史消息
```javascript
// 首次运行，初始化
if (lastMessageId === null && !isInitialized) {
    isInitializing = true
    
    const initMessages = await TavernHelper.getChatMessages(`0-${currentCount - 1}`)
    
    for (let idx = 0; idx < initMessages.length; idx++) {
        const msg = initMessages[idx]
        const content = msg.message || msg.content || msg.mes || ""
        
        // 跳过注入记忆楼层
        if (content.includes("[MemOS 记忆上下文]")) {
            continue
        }
        
        // 使用 forceMode=true 跳过冷却检查
        await addMessage(role, content.trim(), {}, true)
        
        // 每条消息等待1秒
        await new Promise(resolve => setTimeout(resolve, 1000))
    }
    
    isInitialized = true
    isInitializing = false
}
```

### 消息去重检查
```javascript
// 检查是否已保存过（持久化去重）
if (isMessageSaved(msgId)) {
    logDebug(`消息 #${globalIndex} 已保存过，跳过`)
    continue
}

// 标记消息已保存
function markMessageSaved(msgId) {
    savedMessageIds.add(msgId)
    if (savedMessageIds.size % 10 === 0) {
        persistSavedMessageIds()
    }
}
```

---

## 配置信息

- API 端点：`https://memos.memtensor.cn/api/openmem/v1`
- 用户 ID：`sillytavern_user_001`
- 轮询间隔：2 秒
- 保存延迟：1 秒（初始化批量保存时）

---

## 参考资源

- SillyTavern 官方文档
- auto-summary 插件（轮询机制参考）
- quest-system-extension（注入方式参考）
- TavernHelper API 文档
