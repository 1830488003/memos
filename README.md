# MemOS × SillyTavern 集成插件开发文档

## 概述

将 MemOS 记忆系统集成到 SillyTavern（酒馆），实现：
- 用户发送消息时自动检索相关记忆并注入
- AI 回复后自动保存对话内容
- 支持手动触发记忆检索与保存
- 初始化时自动批量上传历史聊天记录
- 用户消息发送后自动停止当前生成 → 检索记忆 → 注入 → 触发生成
- 支持知识库（Knowledge Base）配置与混合检索
- 支持“保存记忆”开关：仅使用知识库/检索，不写入新记忆
- 支持“注入记忆类型”多选：可分别勾选长期记忆 / 偏好记忆 / 技能记忆
- 支持上传前置文本：保存记忆时可自动在消息前拼接自定义前缀
- 支持超长消息自动切段上传：超过 20000 字时按 15000 字分段并间隔 2 秒上传
- 支持总弹窗开关：可统一关闭本插件的 toast 提示与通用弹窗
- 支持启动 10 秒后自动检查更新，并按设置决定是否弹出更新提醒

---

## 使用方法

1. 打开 https://memos-dashboard-gray.openmem.net/cn/apikeys/ 网站
2. 点击"快速接入Cloud API"
3. 登录账号
4. 获取 API 密钥
5. 在酒馆中打开扩展菜单，找到 memos 插件
6. 填写 API 密钥并保存
7. 按需配置以下选项：
   - 是否启用“保存记忆”
   - 是否启用“自动检索记忆”
   - 勾选要注入的记忆类型（长期记忆 / 偏好记忆 / 技能记忆）
   - 配置需要参与检索的知识库 ID
8. 完成配置，开始使用！

---

## 工作流程

```
用户发送消息
    ↓
检测到用户消息 + 初始化已完成
    ↓
1. 停止当前生成 (SillyTavern.stopGeneration() 或 /stop 命令)
    ↓
2. 根据“保存记忆”开关决定是否写入 MemOS
    ↓
3. 检查检索间隔
    ↓
4. 检索相关记忆 + 已启用知识库
    ↓
5. 按勾选的记忆类型注入到 prompt (createChatMessages)
    ↓
6. 等待1秒让消息楼层稳定
    ↓
7. 点击 #send_but 触发生成
```

---

## 技术架构

### 目录结构
```
memos/
├── index.js        # 主插件逻辑
├── settings.html   # 设置页面
├── style.css      # 样式文件
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

#### 2. 消息计数修正
酒馆 API 的 `getLastMessageId()` 返回从0开始的索引，不是消息数量：
- 例如：有6条消息时，返回5（第6条消息的索引）
- 使用时需要+1来得到正确的消息数量

```javascript
function getMessageCount() {
    const rawIndex = TavernHelper.getLastMessageId()
    return rawIndex + 1  // +1 将索引转换为消息数量
}
```

#### 3. 检索触发条件
为防止打开角色卡时误触发检索，添加以下检查：
- 检查 `isInitialized`：只有初始化完成后才触发检索
- 检查检索间隔：冷却期内不重复检索
- 确认是用户消息：`is_user === true && role === "user"`
- 检索时会一并带上已启用的知识库 ID

```javascript
// 如果尚未初始化完成，跳过（防止打开角色卡时误触发）
if (!isInitialized) {
    logDebug("跳过：初始化尚未完成")
    return
}

// 检查检索间隔（10秒）
const now = Date.now()
const retrieveElapsed = now - lastRetrieveTimeForInterval
if (retrieveElapsed < 10000) {
    logDebug(`检索间隔未满10秒(${retrieveElapsed}ms)，跳过检索`)
    return
}
```

#### 4. 停止与触发生成
- 停止生成：使用 `SillyTavern.stopGeneration()` API，备用 `/stop` 命令
- 触发生成：点击 `#send_but` 按钮，备用 `sendTextareaMessage()` 函数

```javascript
// 停止生成1
if (parentWin.SillyTavern && typeof parentWin.SillyTavern.stopGeneration === "function") {
    const stopped = parentWin.SillyTavern.stopGeneration()
    logDebug(`停止生成: ${stopped ? "成功" : "无需停止或已停止"}`)
}
// 备用：使用 /stop 命令
if (parentWin.TavernHelper && typeof parentWin.TavernHelper.triggerSlash === "function") {
    await parentWin.TavernHelper.triggerSlash("/stop")
}

// 触发生成
const sendBtn = parentWin.document?.querySelector('#send_but')
    || document.querySelector('#send_but')
if (sendBtn) {
    sendBtn.click()
}
```

#### 5. 消息保存机制

**初始化时批量保存历史消息：**
- 每条消息保存后等待 3 秒，避免限流
- 只跳过包含 `[MemOS 记忆上下文]` 的注入楼层
- 用户消息和 AI 消息都会保存
- 若关闭“保存记忆”，则不会写入新记忆

**轮询时保存新消息：**
- 用户消息：调用 `addMessage("user", content)`
- AI 消息：调用 `addMessage("assistant", content)`
- `addMessage()` 内部会根据 `saveMemoryEnabled` 开关决定是否真正写入

**超长消息分段上传：**
- MemOS 单次上传存在字数上限，超过上限的消息会自动切段
- 当前策略：超过 20000 字时，按约 15000 字一段切割
- 优先在换行、句号、逗号、空格等位置断开，减少生硬截断
- 各段之间间隔 2 秒上传，避免请求过快

**上传前置文本：**
- 保存记忆时支持在正文前自动拼接“上传前置文本”
- 若设置页填写了自定义内容，则优先使用自定义内容
- 若未填写，则回退到代码中的默认前置文本

#### 6. 注入类型控制

- 新增 `injectionTypes` 配置，默认包含：`memory`、`preference`、`skill`
- 用户可在设置面板中单独勾选要注入的记忆类别
- 检索结果会分别处理长期记忆、偏好记忆、技能记忆
- 注入预览会只展示当前勾选的记忆类型

#### 7. 重复注入防护

- 如果检测到上一层已经是 `[MemOS 记忆上下文]` 记忆楼层，则当前消息不再重复注入
- 初始化结束后的“补检索”阶段，如果最后一层已经是记忆楼层，也会跳过重复注入
- 可避免刷新页面、重新初始化后对同一条用户消息重复注入记忆

#### 8. 环境切换检测

- 只将“楼层数 +1”视为正常用户发言
- 任何非 +1 的楼层变化，都视为环境切换（如切角色卡、切聊天记录、批量刷新）
- 一旦检测到环境切换，会重置 user_id 缓存、聊天文件名缓存、消息处理基线、检索冷却，并重新初始化
- 初始化过程中如果发现聊天文件名或消息数发生异常变化，也会立即中止当前流程并重置

#### 9. 消息去重机制

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
- 停止生成：使用 `SillyTavern.stopGeneration()` API 或 `/stop` 命令
- 发送按钮：点击 `#send_but`
- 备用方案：`sendTextareaMessage()` 函数

### 阶段 4：问题修复
- 修复 system 消息被误判为用户消息的问题
- 修复 sendTextareaMessage 函数不可用问题
- 优化父窗口访问方式

### 阶段 5：历史消息批量上传
- 实现初始化时自动批量上传历史聊天记录
- 每条消息保存后等待 3 秒，避免限流
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

### 阶段 8：检索触发条件优化
- 添加 `isInitialized` 检查，防止打开角色卡时误触发
- 简化"最后一条消息"比较逻辑，直接使用已确认的用户消息
- 添加检索间隔检查

### 阶段 9：消息计数修正
- 添加 `getMessageCount()` 函数修正计数
- 酒馆 API 返回从0开始的索引，需要+1得到消息数量

### 阶段 10：知识库与注入控制
- 支持配置多个知识库并在检索时一起带上
- 新增“保存记忆”开关，可关闭新增记忆写入
- 新增“注入记忆类型”多选，可分别控制长期记忆 / 偏好记忆 / 技能记忆
- 搜索预览与手动刷新注入会同步显示技能记忆

### 阶段 11：环境切换与重复注入修复
- 修复打开角色卡/切换聊天时沿用旧 user_id、旧聊天文件名的问题
- 只允许楼层数 `+1` 视为正常用户发言，其余变化统一按环境切换处理
- 初始化完成后会补做一次最后用户消息检索，但若最后一层已是记忆楼层则跳过
- 修复“上一层是记忆楼层时仍重复注入”的问题

### 阶段 12：上传能力增强（最新）
- 新增“上传前置文本”配置项，支持用户自定义上传前缀
- 增加默认前置文本兜底机制
- 修复超长消息上传失败问题，支持自动切段并分批上传
- 新增总弹窗开关，并支持启动 10 秒后自动检查更新与新版弹窗提醒

---

## 关键代码片段

### 检测用户消息并触发检索
```javascript
if (isUser && msg.role === "user") {
    // 检查检索间隔（10秒）
    const now = Date.now()
    const retrieveElapsed = now - lastRetrieveTimeForInterval
    if (retrieveElapsed < 10000) {
        logDebug(`检索间隔未满10秒(${retrieveElapsed}ms)，跳过检索`)
    } else {
        lastRetrieveTimeForInterval = now
        
        // 1. 停止生成
        if (parentWin.SillyTavern && typeof parentWin.SillyTavern.stopGeneration === "function") {
            parentWin.SillyTavern.stopGeneration()
        }
        
        // 2. 检索记忆
        const result = await searchMemory(content, memosSettings.retrieveCount)
        
        // 3. 注入记忆
        if (result && result.memories.length > 0) {
            await injectMemoryToPrompt(result.memories, result.preferences)
        }
        
        // 4. 等待1秒后触发生成
        setTimeout(() => {
            const sendBtn = document.querySelector('#send_but')
            sendBtn?.click()
        }, 1000)
    }
}
```

### 消息计数修正
```javascript
function getMessageCount() {
    const rawIndex = TavernHelper.getLastMessageId()
    return rawIndex + 1  // +1 将索引转换为消息数量
}

// 使用
const currentCount = getMessageCount()
const messages = await TavernHelper.getChatMessages(`0-${currentCount - 1}`)
```

### 初始化批量保存历史消息
```javascript
// 首次运行，初始化
if (lastMessageId === null && !isInitialized) {
    isInitializing = true
    
    const currentCount = getMessageCount()
    const initMessages = await TavernHelper.getChatMessages(`0-${currentCount - 1}`)
    
    for (let idx = 0; idx < initMessages.length; idx++) {
        const msg = initMessages[idx]
        const content = msg.message || msg.content || msg.mes || ""
        
        // 跳过注入记忆楼层
        if (content.includes("[MemOS 记忆上下文]")) {
            continue
        }
        
        const role = isUser ? "user" : "assistant"
        await addMessage(role, content.trim())
        
        // 每条消息等待3秒
        await new Promise(resolve => setTimeout(resolve, 3000))
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
- 轮询间隔：2 秒
- 保存延迟：3 秒（初始化批量保存时）
- 检索间隔：10 秒
- 注入后等待：1 秒
- 去重存储：localStorage，最多 1000 条
- 超长消息切段：超过 20000 字时按约 15000 字切段
- 分段上传间隔：2 秒
- 自动更新检查：启动 10 秒后执行一次

---

## 参考资源

- SillyTavern 官方文档
- auto-summary 插件（轮询机制参考）
- quest-system-extension（注入方式参考）
- TavernHelper API 文档
- 酒馆指令.txt（/stop 命令、triggerSlash 函数）
