// MemOS Integration for SillyTavern
// 使用 inject API 注入记忆到 prompt

jQuery(async () => {
    "use strict"

    // --- 从 window.parent 获取全局API（与auto-summary一致）---
    const parentWin = typeof window.parent !== "undefined" ? window.parent : window
    const SillyTavern = parentWin.SillyTavern
    const TavernHelper = parentWin.TavernHelper
    const jQuery = parentWin.jQuery
    const toastr = parentWin.toastr
    const executeSlashCommand = parentWin.executeSlashCommand

    // --- 扩展配置 ---
    const extensionName = "memos"
    const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`
    const DEBUG_MODE = true

    // ===================================================================================
    // 0. 更新器模块
    // ===================================================================================
    const Updater = {
        gitRepoOwner: '1830488003',
        gitRepoName: 'memos',
        currentVersion: '1.0.0',
        latestVersion: '0.0.0',

        async fetchRawFileFromGitHub(filePath) {
            const url = `https://raw.githubusercontent.com/${this.gitRepoOwner}/${this.gitRepoName}/main/${filePath}`;
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch ${filePath} from GitHub: ${response.statusText}`,
                );
            }
            return response.text();
        },

        parseVersion(content) {
            try {
                return JSON.parse(content).version || '0.0.0';
            } catch (error) {
                console.error(`[${extensionName}] Failed to parse version:`, error);
                return '0.0.0';
            }
        },

        compareVersions(v1, v2) {
            const parts1 = v1.split('.').map(Number);
            const parts2 = v2.split('.').map(Number);
            for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
                const p1 = parts1[i] || 0;
                const p2 = parts2[i] || 0;
                if (p1 > p2) return 1;
                if (p1 < p2) return -1;
            }
            return 0;
        },

        async performUpdate() {
            // 确保 SillyTavern 已初始化
            if (!SillyTavern || !SillyTavern.getContext) {
                console.error(`[${extensionName}] SillyTavern 未初始化`);
                toastr.error('系统未就绪，请稍后重试');
                return;
            }
            
            const context = SillyTavern.getContext();
            if (!context || !context.common) {
                console.error(`[${extensionName}] SillyTavern.getContext() 返回无效`);
                toastr.error('系统未就绪，请稍后重试');
                return;
            }
            
            const { getRequestHeaders } = context.common;
            toastr.info('正在开始更新...');
            console.log(`[${extensionName}] 开始更新`);
            
            try {
                // 直接调用更新 API，不传递 global 参数让后端自动判断
                const response = await fetch('/api/extensions/update', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        extensionName: extensionName,
                    }),
                });
                
                const result = await response.text();
                console.log(`[${extensionName}] 更新API响应状态:`, response.status);
                console.log(`[${extensionName}] 更新API响应内容:`, result);
                
                // 尝试解析JSON响应
                let resultObj;
                try {
                    resultObj = JSON.parse(result);
                    console.log(`[${extensionName}] 解析后的响应:`, resultObj);
                } catch {
                    resultObj = { message: result };
                }
                
                if (!response.ok) {
                    throw new Error(resultObj.message || `HTTP ${response.status}: ${result}`);
                }

                // 检查响应内容判断是否成功
                const isSuccess = response.ok && (
                    resultObj.ok === true || 
                    resultObj.success === true ||
                    (typeof resultObj === 'string' && resultObj.includes('success'))
                );
                
                if (isSuccess || response.status === 200) {
                    toastr.success('更新成功！正在刷新页面...');
                    console.log(`[${extensionName}] 更新成功，准备刷新页面`);
                    // 强制刷新，不等待
                    setTimeout(() => {
                        console.log(`[${extensionName}] 执行页面刷新`);
                        window.location.reload(true);
                    }, 1000);
                } else {
                    throw new Error(resultObj.message || resultObj.error || '更新失败');
                }
            } catch (error) {
                console.error(`[${extensionName}] 更新失败:`, error);
                toastr.error(`更新失败: ${error.message}`);
            }
        },

        async showUpdateConfirmDialog() {
            if (
                await SillyTavern.callGenericPopup(
                    `发现新版本 ${this.latestVersion}！您想现在更新吗？`,
                    SillyTavern.GENERIC_POPUP_TYPES.confirm,
                    {
                        okButton: '立即更新',
                        cancelButton: '稍后',
                    },
                )
            ) {
                await this.performUpdate();
            }
        },

        async checkForUpdates(isManual = false) {
            const $checkButton = jQuery('#memos-check-update');
            const $updateGuide = jQuery('#memos-update-guide');
            const $newVersionDisplay = jQuery('#memos-new-version-display');
            const $updateIndicator = jQuery('.update-indicator');

            if (isManual) {
                $checkButton
                    .prop('disabled', true)
                    .html('<i class="fas fa-spinner fa-spin"></i> 检查中...');
            }
            try {
                const localManifestText = await (
                    await fetch(
                        `/${extensionFolderPath}/manifest.json?t=${Date.now()}`,
                    )
                ).text();
                this.currentVersion = this.parseVersion(localManifestText);
                jQuery('#memos-current-version').text(this.currentVersion);

                const remoteManifestText =
                    await this.fetchRawFileFromGitHub('manifest.json');
                this.latestVersion = this.parseVersion(remoteManifestText);

                if (
                    this.compareVersions(
                        this.latestVersion,
                        this.currentVersion,
                    ) > 0
                ) {
                    $updateIndicator.show();
                    // 显示手动更新指南
                    $newVersionDisplay.text(this.latestVersion);
                    $updateGuide.show();
                    
                    if (isManual)
                        toastr.warning(
                            `发现新版本 ${this.latestVersion}！请查看下方手动更新步骤。`,
                        );
                } else {
                    $updateIndicator.hide();
                    $updateGuide.hide();
                    if (isManual) toastr.info('您当前已是最新版本。');
                }
            } catch (error) {
                if (isManual) toastr.error(`检查更新失败: ${error.message}`);
            } finally {
                if (
                    isManual &&
                    this.compareVersions(
                        this.latestVersion,
                        this.currentVersion,
                    ) <= 0
                ) {
                    $checkButton
                        .prop('disabled', false)
                        .html(
                            '<i class="fa-solid fa-cloud-arrow-down"></i> 检查更新',
                        );
                }
            }
        },
    };
    // 存储键
    const STORAGE_KEY_API_CONFIG = "memos_api_config"
    const STORAGE_KEY_SETTINGS = "memos_settings"
    const STORAGE_KEY_BUTTON_POS = "memos-button-position"

    // 默认配置
    const DEFAULT_CONFIG = {
        apiEndpoint: "https://memos.memtensor.cn/api/openmem/v1",
        apiKey: ""
    }

    const DEFAULT_SETTINGS = {
        enabled: true,
        autoSave: true,
        autoRetrieve: true,
        retrieveCount: 5,
        relativityThreshold: 0.5
    }

    // 全局变量
    let memosConfig = { ...DEFAULT_CONFIG }
    let memosSettings = { ...DEFAULT_SETTINGS }
    let lastSaveTime = null
    let lastRetrieveTime = null  // 上次检索时间（用于统计显示）
    let lastAddTime = null       // 上次添加时间（用于统计显示）
    let totalMemories = 0
    let sessionsSaved = 0
    let totalRetrieves = 0      // 总检索次数
    let currentInjectionId = "memos_memory_injection"
    let lastUserMessageId = -1
    let isGenerating = false
    let isInjectingMemory = false  // 标记是否正在注入记忆

    // 已保存消息的记录（用于去重）- 使用消息唯一ID
    let savedMessageIds = new Set()
    const STORAGE_KEY_SAVED_MESSAGES = "memos_saved_message_ids"
    const STORAGE_KEY_SAVED_MESSAGES_VERSION = "memos_saved_version"  // 用于清理旧数据
    const SAVED_VERSION = "2.0"  // 版本号，用于判断是否需要清理旧数据

    // 生成消息唯一ID
    // 优先使用楼层索引（全局索引），而不是消息自带的ID，避免重复
    // 记录上次保存时间和检索时间（用于控制间隔）
    let lastSaveTimeForInterval = 0  // 上次保存时间（毫秒）
    let lastRetrieveTimeForInterval = 0  // 上次检索时间（毫秒）
    
    // 等待指定毫秒
    async function waitForInterval(minInterval) {
        const now = Date.now()
        const elapsed = now - lastSaveTimeForInterval
        if (elapsed < minInterval) {
            const waitTime = minInterval - elapsed
            logDebug(`等待 ${waitTime}ms 以满足间隔要求...`)
            await new Promise(resolve => setTimeout(resolve, waitTime))
        }
        lastSaveTimeForInterval = Date.now()
    }
    
    async function generateMessageId(msg, index) {
        // 始终使用楼层索引作为主要标识（附加角色卡名和聊天文件名以区分不同聊天）
        const charName = getCharName() || "unknown_char"
        const chatFile = await getChatFileName() || "unknown_chat"
        
        // 使用全局索引 idx_ 作为唯一标识，这是最可靠的
        return `char_${charName}_chat_${chatFile}_idx_${index}`
    }

    // 获取角色卡名字（用于区分不同角色卡的数据存储）
    function getCharName() {
        try {
            const parentWin = typeof window.parent !== "undefined" ? window.parent : window
            const chars = parentWin.characters
            const thisChId = parentWin.this_chid
            
            if (chars && Array.isArray(chars) && thisChId !== undefined && thisChId !== null && chars[thisChId] && chars[thisChId].name) {
                return chars[thisChId].name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
            }
        } catch (e) {
            logDebug("获取角色卡名失败:", e)
        }
        return null
    }

    // 获取聊天文件名（用于区分同一角色卡的不同聊天）
    let cachedChatFileName = null
    async function getChatFileName() {
        if (cachedChatFileName) return cachedChatFileName
        
        // 检查 API 可用性
        if (typeof TavernHelper !== "undefined" && typeof TavernHelper.triggerSlash === "function") {
            try {
                const chatNameFromCommand = await TavernHelper.triggerSlash("/getchatname")
                if (chatNameFromCommand && typeof chatNameFromCommand === "string" && chatNameFromCommand.trim()) {
                    cachedChatFileName = cleanChatName(chatNameFromCommand.trim())
                    logDebug(`获取到聊天文件名: ${cachedChatFileName}`)
                    return cachedChatFileName
                }
            } catch (error) {
                logDebug("获取聊天文件名失败:", error)
            }
        }
        
        // 备用：使用时间戳
        const fallback = `chat_${Date.now()}`
        cachedChatFileName = fallback
        return fallback
    }

    // 获取当前聊天的唯一标识（用于存储key）
    let currentChatUniqueId = null
    async function getCurrentChatUniqueId() {
        const charName = getCharName() || "unknown_char"
        const chatFile = await getChatFileName() || "unknown_chat"
        const newId = `${charName}_${chatFile}`
        
        // 如果聊天ID变了，清理缓存
        if (currentChatUniqueId && currentChatUniqueId !== newId) {
            logDebug(`聊天切换: ${currentChatUniqueId} -> ${newId}，清理缓存`)
            cachedChatFileName = null  // 清理聊天文件名缓存
        }
        
        currentChatUniqueId = newId
        return currentChatUniqueId
    }

    // 加载已保存的消息ID列表（从localStorage）
    function loadSavedMessageIds() {
        try {
            // 检查版本，如果版本不匹配则清理旧数据
            const savedVersion = localStorage.getItem(STORAGE_KEY_SAVED_MESSAGES_VERSION)
            if (savedVersion !== SAVED_VERSION) {
                logDebug(`版本不匹配(${savedVersion} -> ${SAVED_VERSION})，清理旧数据`)
                localStorage.removeItem(STORAGE_KEY_SAVED_MESSAGES)
                localStorage.setItem(STORAGE_KEY_SAVED_MESSAGES_VERSION, SAVED_VERSION)
                return
            }

            const saved = localStorage.getItem(STORAGE_KEY_SAVED_MESSAGES)
            if (saved) {
                const parsed = JSON.parse(saved)
                if (Array.isArray(parsed)) {
                    savedMessageIds = new Set(parsed)
                    logDebug(`已加载 ${savedMessageIds.size} 条已保存的消息ID`)
                }
            }
        } catch (e) {
            logError("加载已保存消息ID失败:", e)
            savedMessageIds = new Set()
        }
    }

    // 保存已处理的消息ID到localStorage
    function persistSavedMessageIds() {
        try {
            // 限制保存的数量，防止localStorage过大
            const MAX_SAVED = 1000
            const array = Array.from(savedMessageIds)
            
            if (array.length > MAX_SAVED) {
                // 只保留最新的MAX_SAVED条
                const trimmed = array.slice(-MAX_SAVED)
                savedMessageIds = new Set(trimmed)
                logDebug(`消息ID列表已裁剪，保留最新 ${MAX_SAVED} 条`)
            }
            
            localStorage.setItem(STORAGE_KEY_SAVED_MESSAGES, JSON.stringify(Array.from(savedMessageIds)))
            localStorage.setItem(STORAGE_KEY_SAVED_MESSAGES_VERSION, SAVED_VERSION)
        } catch (e) {
            logError("保存消息ID失败:", e)
        }
    }

    // 清除已保存消息记录
    function clearSavedMessageRecords() {
        savedMessageIds = new Set()
        persistSavedMessageIds()
        logDebug("已清除所有已保存消息记录")
    }

    // 检查消息是否已保存
    function isMessageSaved(msgId) {
        return savedMessageIds.has(msgId)
    }

    // 标记消息已保存
    function markMessageSaved(msgId) {
        savedMessageIds.add(msgId)
        // 每添加10条保存一次
        if (savedMessageIds.size % 10 === 0) {
            persistSavedMessageIds()
        }
    }

    // 调试日志
    function logDebug(...args) {
        if (DEBUG_MODE) console.log(`[${extensionName}]`, ...args)
    }

    function logError(...args) {
        console.error(`[${extensionName}]`, ...args)
    }

    function showToastr(type, message) {
        if (typeof toastr !== "undefined") {
            toastr[type](message, "MemOS")
        }
    }

    // === 注册事件监听器：监听消息发送事件 ===
    function registerEventListeners() {
        // 通过 window.parent 获取 eventSource
        const parentWin = window.parent
        const eventSource = parentWin.eventSource
        const eventTypes = parentWin.event_types

        if (!eventSource || !eventTypes) {
            logDebug("eventSource 或 eventTypes 不可用")
            return
        }

        // 监听 MESSAGE_SENT 事件 - 用户发送消息时触发（仅用于检索记忆，不用于保存）
        // 保存由轮询统一处理，避免重复
        eventSource.on(eventTypes.MESSAGE_SENT, async (messageIndex) => {
            logDebug(`MESSAGE_SENT 事件触发, 消息索引: ${messageIndex}`)
            
            // 如果正在注入记忆或生成中，跳过
            if (isInjectingMemory || isGenerating) {
                logDebug("跳过：正在注入记忆或生成中")
                return
            }

            // 如果尚未初始化完成，跳过（防止打开角色卡时误触发）
            if (!isInitialized) {
                logDebug("跳过：初始化尚未完成")
                return
            }

            // 获取刚发送的消息
            try {
                const messages = await TavernHelper.getChatMessages("0-last", { include_swipes: false })
                if (!messages || messages.length === 0) return

                const lastMsg = messages[messages.length - 1]
                const content = lastMsg.message || lastMsg.content || lastMsg.mes || ""
                const isUser = lastMsg.is_user === true || lastMsg.role === "user"

                // 确认是用户发言
                if (!isUser || !content || !content.trim()) {
                    logDebug("最后一条消息不是用户消息或内容为空，跳过检索")
                    return
                }

                logDebug(`MESSAGE_SENT：用户消息 "${content.substring(0, 30)}..."`)

                // 检查API配置
                if (!memosConfig.apiKey) {
                    logDebug("跳过：API未配置")
                    return
                }

                // 检查检索间隔（10秒）
                const now = Date.now()
                const retrieveElapsed = now - lastRetrieveTimeForInterval
                if (retrieveElapsed < 10000) {
                    logDebug(`检索间隔未满10秒(${retrieveElapsed}ms)，跳过检索`)
                    return
                }

                logDebug("MESSAGE_SENT：检索记忆...")
                isInjectingMemory = true
                lastRetrieveTimeForInterval = now

                // 先停止生成（如果有正在生成的对话）
                try {
                    const parentWin = window.parent
                    // 使用酒馆API停止生成
                    if (parentWin.SillyTavern && typeof parentWin.SillyTavern.stopGeneration === "function") {
                        const stopped = parentWin.SillyTavern.stopGeneration()
                        logDebug(`停止生成: ${stopped ? "成功" : "无需停止或已停止"}`)
                    }
                    // 备用：使用 /stop 命令
                    if (parentWin.TavernHelper && typeof parentWin.TavernHelper.triggerSlash === "function") {
                        try {
                            await parentWin.TavernHelper.triggerSlash("/stop")
                            logDebug("已发送 /stop 命令")
                        } catch (e) {
                            logDebug("/stop 命令执行失败:", e)
                        }
                    }
                    // 等待停止生效
                    await new Promise(resolve => setTimeout(resolve, 500))
                } catch (e) {
                    logDebug("停止生成失败:", e)
                }

                // 检索记忆
                const result = await searchMemory(content, memosSettings.retrieveCount)
                logDebug("检索结果:", result)

                if (result && (result.memories.length > 0 || (result.preferences && result.preferences.length > 0))) {
                    // 注入记忆 - 使用 /inject 命令注入到prompt
                    await injectMemoryToPrompt(result.memories, result.preferences)
                    logDebug("记忆注入成功")
                    showToastr("info", `已注入 ${result.memories.length} 条记忆`)
                    
                    // 注入完成后，等待1秒让消息楼层稳定，然后触发生成
                    setTimeout(async () => {
                        logDebug("记忆注入完成，触发生成...")
                        try {
                            const parentWin = window.parent
                            const sendBtn = parentWin.document?.querySelector('#send_but, #gen_button')
                                || document.querySelector('#send_but, #gen_button')
                            if (sendBtn) {
                                sendBtn.click()
                                logDebug("已点击生成按钮")
                            } else if (typeof parentWin.sendTextareaMessage === "function") {
                                parentWin.sendTextareaMessage()
                            }
                        } catch (e) {
                            logError("触发生成失败:", e)
                        }
                    }, 1000)
                } else {
                    logDebug("未检索到相关记忆，仍触发生成...")
                    setTimeout(async () => {
                        try {
                            const parentWin = window.parent
                            const sendBtn = parentWin.document?.querySelector('#send_but, #gen_button')
                                || document.querySelector('#send_but, #gen_button')
                            if (sendBtn) {
                                sendBtn.click()
                            } else if (typeof parentWin.sendTextareaMessage === "function") {
                                parentWin.sendTextareaMessage()
                            }
                        } catch (e) {
                            logError("触发生成失败:", e)
                        }
                    }, 1000)
                }

                isInjectingMemory = false
            } catch (e) {
                logError("MESSAGE_SENT 处理失败:", e)
                isInjectingMemory = false
            }
        })

        // 监听 GENERATION_STARTED 事件
        eventSource.on(eventTypes.GENERATION_STARTED, (type, params, isDryRun) => {
            logDebug(`GENERATION_STARTED 事件触发, dryRun: ${isDryRun}`)
            isGenerating = !isDryRun
        })

        // 监听 GENERATION_ENDED 事件
        eventSource.on(eventTypes.GENERATION_ENDED, (type, params) => {
            logDebug("GENERATION_ENDED 事件触发")
            isGenerating = false
        })

        // 监听 GENERATION_STOPPED 事件
        eventSource.on(eventTypes.GENERATION_STOPPED, () => {
            logDebug("GENERATION_STOPPED 事件触发")
            isGenerating = false
        })

        // 拦截发送按钮：在发送前先注入记忆
        interceptSendButton()

        logDebug("事件监听器注册完成")
    }

    // 拦截发送按钮：在用户点击发送时，先检索并注入记忆，再触发发送
    function interceptSendButton() {
        try {
            // 找到发送按钮和输入框
            const sendButton = document.querySelector('#send_buttons .send-button, #send_button, button[aria-label="Send"]')
            const textarea = document.getElementById('send_textarea')

            if (!sendButton || !textarea) {
                logDebug("未找到发送按钮或输入框")
                return
            }

            // 监听输入框的 keydown 事件（回车发送）
            textarea.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isDefaultPrevented()) {
                    const text = textarea.value.trim()
                    if (!text) return

                    // 检查是否需要检索记忆
                    if (!memosConfig.apiKey) {
                        logDebug("API未配置，跳过记忆检索")
                        return
                    }

                    // 检查是否已有记忆正在处理（防止重复）
                    if (isInjectingMemory) {
                        logDebug("正在注入记忆中，跳过")
                        return
                    }

                    logDebug("拦截发送，检索记忆...")

                    // 阻止默认发送行为
                    e.preventDefault()

                    // 检索记忆
                    isInjectingMemory = true
                    try {
                        const result = await searchMemory(text, memosSettings.retrieveCount)
                        
                        if (result && (result.memories.length > 0 || (result.preferences && result.preferences.length > 0))) {
                            // 先注入记忆到prompt
                            await injectMemoryToPrompt(result.memories, result.preferences)
                            logDebug("记忆已注入到prompt")
                            showToastr("info", `已注入 ${result.memories.length} 条记忆`)
                        }
                    } catch (e) {
                        logError("记忆检索失败:", e)
                    }

                    isInjectingMemory = false

                    // 清空输入框
                    textarea.value = ''
                    textarea.dispatchEvent(new Event('input', { bubbles: true }))

                    // 直接调用 sendTextareaMessage 函数触发发送
                    const parentWin = window.parent
                    if (typeof parentWin.sendTextareaMessage === "function") {
                        parentWin.sendTextareaMessage()
                    } else {
                        sendButton.click()
                    }
                    logDebug("已触发消息发送")
                }
            })

            // 也拦截发送按钮的点击事件
            sendButton.addEventListener('click', async (e) => {
                const text = textarea.value.trim()
                if (!text) return

                // 检查是否需要检索记忆
                if (!memosConfig.apiKey) {
                    return
                }

                if (isInjectingMemory) {
                    logDebug("正在注入记忆中，跳过点击")
                    e.preventDefault()
                    e.stopPropagation()
                    return
                }

                logDebug("拦截按钮点击，检索记忆...")

                // 阻止默认行为
                e.preventDefault()
                e.stopPropagation()

                // 检索记忆
                isInjectingMemory = true
                try {
                    const result = await searchMemory(text, memosSettings.retrieveCount)
                    
                    if (result && (result.memories.length > 0 || (result.preferences && result.preferences.length > 0))) {
                        await injectMemoryToPrompt(result.memories, result.preferences)
                        logDebug("记忆已注入到prompt")
                        showToastr("info", `已注入 ${result.memories.length} 条记忆`)
                    }
                } catch (e) {
                    logError("记忆检索失败:", e)
                }

                isInjectingMemory = false

                // 清空输入框
                textarea.value = ''
                textarea.dispatchEvent(new Event('input', { bubbles: true }))

                // 直接调用 sendTextareaMessage 函数触发发送（而不是模拟点击按钮）
                const parentWin = window.parent
                if (typeof parentWin.sendTextareaMessage === "function") {
                    parentWin.sendTextareaMessage()
                } else {
                    // 备用方案：模拟点击按钮
                    sendButton.click()
                }
                logDebug("已触发消息发送")
            }, true)  // 使用捕获阶段确保先执行

            logDebug("发送按钮拦截已设置")
        } catch (e) {
            logError("设置发送按钮拦截失败:", e)
        }
    }

    // 加载设置
    function loadSettings() {
        try {
            const savedConfig = localStorage.getItem(STORAGE_KEY_API_CONFIG)
            if (savedConfig) {
                memosConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) }
            }
            const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS)
            if (savedSettings) {
                memosSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) }
            }
        } catch (e) {
            logError("加载设置失败:", e)
        }
    }

    // 保存设置
    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY_API_CONFIG, JSON.stringify(memosConfig))
            localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(memosSettings))
        } catch (e) {
            logError("保存设置失败:", e)
        }
    }

    // 清理聊天文件名
    function cleanChatName(fileName) {
        if (!fileName || typeof fileName !== "string") {
            return "unknown_chat_source"
        }
        let cleanedName = fileName
        // 处理路径分隔符
        if (fileName.includes("/") || fileName.includes("\\")) {
            const parts = fileName.split(/[\\\/]/)
            cleanedName = parts[parts.length - 1] // 取最后一部分（文件名）
        }
        // 去掉扩展名
        return cleanedName.replace(/\.jsonl$/, "").replace(/\.json$/, "")
    }

    // 获取当前用户ID - 使用 /getchatname 命令获取聊天文件名
    // 延迟5秒获取，确保 SillyTavern 初始化完成
    async function getCurrentUserId() {
        // 使用缓存
        if (getCurrentUserId.cached) {
            return getCurrentUserId.cached
        }
        
        // 延迟5秒确保初始化完成
        await new Promise(resolve => setTimeout(resolve, 5000))
        
        let newChatFileIdentifier = "st_default"
        
        // 检查 API 可用性
        if (typeof TavernHelper !== "undefined" && typeof TavernHelper.triggerSlash === "function") {
            try {
                const chatNameFromCommand = await TavernHelper.triggerSlash("/getchatname")
                
                logDebug("/getchatname 返回:", chatNameFromCommand, "类型:", typeof chatNameFromCommand)
                
                // 验证返回值有效性
                if (
                    chatNameFromCommand &&
                    typeof chatNameFromCommand === "string" &&
                    chatNameFromCommand.trim() !== "" &&
                    chatNameFromCommand.trim() !== "null" &&
                    chatNameFromCommand.trim() !== "undefined"
                ) {
                    // 清理文件名得到最终标识符
                    const cleaned = cleanChatName(chatNameFromCommand.trim())
                    newChatFileIdentifier = "st_" + cleaned
                    logDebug("用户ID（清理后）:", newChatFileIdentifier)
                    getCurrentUserId.cached = newChatFileIdentifier
                    return newChatFileIdentifier
                } else {
                    logDebug("/getchatname 返回为空或无效值")
                }
            } catch (error) {
                logError("Error calling /getchatname via triggerSlash:", error)
            }
        } else {
            logDebug("TavernHelper.triggerSlash 不可用")
        }
        
        // 备用方案：从 characters 数组获取
        try {
            const parentWin = typeof window.parent !== "undefined" ? window.parent : window
            const chars = parentWin.characters
            const thisChId = parentWin.this_chid
            
            if (chars && Array.isArray(chars) && thisChId !== undefined && thisChId !== null && chars[thisChId] && chars[thisChId].name) {
                const charName = chars[thisChId].name
                newChatFileIdentifier = "st_" + charName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")
                logDebug("用户ID（characters备用）:", newChatFileIdentifier)
                getCurrentUserId.cached = newChatFileIdentifier
                return newChatFileIdentifier
            }
        } catch (e) {
            logError("获取角色名失败:", e)
        }
        
        getCurrentUserId.cached = newChatFileIdentifier
        return newChatFileIdentifier
    }

    // 获取当前角色名
    function getCurrentCharName() {
        try {
            const context = SillyTavern.getContext ? SillyTavern.getContext() : null
            if (context && context.name2) return context.name2
            return "default_conversation"
        } catch (e) {
            return "default_conversation"
        }
    }

    // 调用MemOS API
    async function callMemOSApi(endpoint, data) {
        if (!memosConfig.apiEndpoint || !memosConfig.apiKey) {
            throw new Error("MemOS API未配置")
        }

        const url = `${memosConfig.apiEndpoint.replace(/\/$/, "")}${endpoint}`
        logDebug(`API调用: POST ${url}`)

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Token ${memosConfig.apiKey}`,
            },
            body: JSON.stringify(data),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        const result = await response.json()
        if (result.code !== 0) {
            throw new Error(result.message || result.msg || "API错误")
        }

        return result.data
    }

    // 搜索记忆
    async function searchMemory(query, topK = 5) {
        if (!query || !query.trim()) {
            logDebug("查询内容为空")
            return null
        }

        try {
            const userId = await getCurrentUserId() || `st_user_${Date.now()}`
            const conversationId = getCurrentCharName() || "default_conversation"
            
            const data = {
                query: query.trim(),
                user_id: userId,
                conversation_id: conversationId
            }
            
            logDebug("搜索请求:", JSON.stringify(data))

            const result = await callMemOSApi("/search/memory", data)
            
            // 官方返回格式: memory_detail_list, preference_detail_list
            const memoryDetailList = result.memory_detail_list || []
            const preferenceDetailList = result.preference_detail_list || []
            
            totalMemories = result.total || 0

            // 过滤相关性 < 0.5
            const memories = memoryDetailList.filter(m => 
                (m.relativity || m.score || m.relevance || 0) >= memosSettings.relativityThreshold
            )
            const preferences = preferenceDetailList.filter(p =>
                (p.score || p.relevance || 0) >= memosSettings.relativityThreshold
            )

            // 提取 memory_value 和 preference
            const formattedMemories = memories.map(m => ({
                content: m.memory_value || m.content || m.memory || "",
                score: m.relativity || m.score || 0
            }))
            const formattedPreferences = preferences.map(p => ({
                content: p.preference || p.content || "",
                score: p.score || 0
            }))

            logDebug(`搜索到 ${formattedMemories.length} 条记忆`)
            
            // 更新检索时间和计数
            lastRetrieveTime = Date.now()
            totalRetrieves++
            
            return { 
                memories: formattedMemories, 
                preferences: formattedPreferences, 
                total: result.total || 0 
            }
        } catch (e) {
            logError("搜索失败:", e)
            return null
        }
    }

    // 添加消息到MemOS
    async function addMessage(role, content, metadata = {}) {
        if (!content || !content.trim()) {
            logDebug("内容为空，跳过")
            return null
        }

        try {
            const userId = await getCurrentUserId() || `st_user_${Date.now()}`
            const conversationId = getCurrentCharName() || "default_conversation"
            
            const data = {
                messages: [{
                    role: role,
                    content: content.trim()
                }],
                user_id: userId,
                conversation_id: conversationId
            }
            
            logDebug("添加消息请求:", JSON.stringify(data))

            const result = await callMemOSApi("/add/message", data)
            // 更新保存时间（用于统计显示）
            lastAddTime = Date.now()
            return result
        } catch (e) {
            logError("添加消息失败:", e)
            return null
        }
    }

    // 获取所有记忆
    async function getAllMessages(limit = 50, offset = 0) {
        try {
            const userId = await getCurrentUserId() || `st_user_${Date.now()}`
            const conversationId = getCurrentCharName() || "default_conversation"
            
            const data = {
                user_id: userId,
                conversation_id: conversationId,
                message_limit_number: limit
            }
            
            logDebug("获取消息请求:", JSON.stringify(data))
            
            return await callMemOSApi("/get/message", data)
        } catch (e) {
            logError("获取消息失败:", e)
            return null
        }
    }

    // 格式化注入上下文
    function formatInjectionContext(memories, preferences) {
        let context = "[MemOS 记忆上下文]\n"
        
        if (memories && memories.length > 0) {
            context += "相关记忆:\n"
            memories.forEach((m, i) => {
                const content = m.content || m.memory || m.text || ""
                const score = (m.score || m.relevance || 0).toFixed(2)
                context += `${i + 1}. [相关度:${score}] ${content}\n`
            })
        }

        if (preferences && preferences.length > 0) {
            context += "\n用户偏好:\n"
            preferences.forEach((p, i) => {
                const content = p.content || p.preference || p.text || ""
                context += `${i + 1}. ${content}\n`
            })
        }

        context += "[/MemOS 记忆上下文]"
        return context
    }

    // === 核心：使用 inject API 注入记忆 ===
    async function injectMemoryToPrompt(memories, preferences) {
        if (!memosSettings.enabled || !memosSettings.autoRetrieve) {
            logDebug("自动检索未启用")
            return false
        }

        const context = formatInjectionContext(memories, preferences)
        if (!context || context.length < 50) {
            logDebug("没有足够的记忆内容")
            return false
        }

        try {
            // 通过 window.parent 获取 API
            const parentWin = window.parent
            const TavernHelper = parentWin.TavernHelper

            // 使用 TavernHelper.createChatMessages() 注入记忆（会产生单独消息楼层）
            if (TavernHelper && typeof TavernHelper.createChatMessages === "function") {
                logDebug("使用 TavernHelper.createChatMessages 注入...")
                await TavernHelper.createChatMessages(
                    [
                        {
                            role: 'system',
                            name: 'MemOS记忆',
                            message: context,
                            is_hidden: false,
                        },
                    ],
                    { refresh: 'affected' },
                )
                logDebug("记忆注入成功 (TavernHelper.createChatMessages)")
                return true
            }

            logError("没有可用的注入方法")
            return false
        } catch (e) {
            logError("注入失败:", e)
            return false
        }
    }

    // 移除注入
    async function removeInjection() {
        try {
            const parentWin = window.parent
            const executeSlashCommand = parentWin.executeSlashCommand
            if (typeof executeSlashCommand === "function") {
                executeSlashCommand(`/flushinject ${currentInjectionId}`)
                logDebug("注入已移除")
                return true
            }
            return false
        } catch (e) {
            logError("移除注入失败:", e)
            return false
        }
    }

    // 保存当前聊天
    async function saveCurrentChat() {
        try {
            const messages = await TavernHelper.getChatMessages("0-last")
            if (!messages || messages.length === 0) {
                showToastr("warning", "没有消息可保存")
                return
            }

            let savedCount = 0
            const recentMessages = messages.slice(-4)
            for (const msg of recentMessages) {
                const role = msg.role || (msg.is_user ? "user" : "assistant")
                const content = msg.message || msg.content || msg.mes || ""
                if (content && content.trim()) {
                    await addMessage(role, content.trim())
                    savedCount++
                }
            }

            lastSaveTime = new Date()
            sessionsSaved++
            showToastr("success", `已保存 ${savedCount} 条消息`)
            updateStatsDisplay()
        } catch (e) {
            logError("保存失败:", e)
            showToastr("error", `保存失败: ${e.message}`)
        }
    }

    // 手动保存
    async function manualSave() {
        const content = jQuery("#memos-manual-content").val() || ""
        if (!content || !content.trim()) {
            showToastr("warning", "请输入内容")
            return
        }

        try {
            await addMessage("user", content.trim())
            showToastr("success", "已保存")
            jQuery("#memos-manual-content").val("")
            updateStatsDisplay()
        } catch (e) {
            showToastr("error", `保存失败: ${e.message}`)
        }
    }

    // 搜索记忆
    async function searchMemories() {
        const query = jQuery("#memos-search-query").val() || ""
        if (!query || !query.trim()) {
            showToastr("warning", "请输入关键词")
            return
        }

        try {
            const result = await searchMemory(query.trim(), memosSettings.retrieveCount)
            if (result) {
                const preview = formatInjectionContext(result.memories, result.preferences)
                jQuery("#memos-injection-preview").val(preview)
                showToastr("success", `找到 ${result.memories.length} 条记忆`)
            } else {
                showToastr("info", "未找到相关记忆")
            }
        } catch (e) {
            showToastr("error", `搜索失败: ${e.message}`)
        }
    }

    // 显示所有记忆
    async function showAllMemories() {
        try {
            const result = await getAllMessages(50, 0)
            if (result && result.messages) {
                let preview = "所有记忆:\n"
                result.messages.forEach((m, i) => {
                    const content = m.content || m.message || ""
                    preview += `${i + 1}. [${m.role || 'unknown'}] ${content}\n`
                })
                jQuery("#memos-injection-preview").val(preview)
                showToastr("success", `加载了 ${result.messages.length} 条记忆`)
            } else {
                showToastr("info", "暂无记忆")
            }
        } catch (e) {
            showToastr("error", `加载失败: ${e.message}`)
        }
    }

    // 刷新注入
    async function refreshInjection() {
        try {
            const messages = await TavernHelper.getChatMessages("0-last")
            const lastUserMsg = messages ? messages.filter(m => m.role === "user" || m.is_user).pop() : null

            if (lastUserMsg) {
                const content = lastUserMsg.message || lastUserMsg.content || lastUserMsg.mes || ""
                const result = await searchMemory(content, memosSettings.retrieveCount)
                if (result && (result.memories.length > 0 || (result.preferences && result.preferences.length > 0))) {
                    const context = formatInjectionContext(result.memories, result.preferences)
                    jQuery("#memos-injection-preview").val(context)
                    // 自动注入
                    await injectMemoryToPrompt(result.memories, result.preferences)
                    showToastr("success", "记忆已注入到prompt")
                } else {
                    showToastr("info", "未找到相关记忆")
                }
            }
        } catch (e) {
            logError("刷新失败:", e)
            showToastr("error", `刷新失败: ${e.message}`)
        }
    }

    // 清空注入
    async function clearInjection() {
        await removeInjection()
        jQuery("#memos-injection-preview").val("")
        showToastr("info", "已清空注入")
    }

    // 测试连接
    async function testConnection() {
        if (!memosConfig.apiKey) {
            showToastr("warning", "请输入API Key")
            return
        }

        try {
            updateApiStatus("测试中...", null)
            
            const testUserId = `test_user_${Date.now()}`
            const testUrl = `${memosConfig.apiEndpoint.replace(/\/$/, "")}/search/memory`
            const response = await fetch(testUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Token ${memosConfig.apiKey}`,
                },
                body: JSON.stringify({
                    query: "test",
                    user_id: testUserId,
                    conversation_id: testUserId
                }),
            })

            if (response.ok) {
                const result = await response.json()
                if (result.code === 0) {
                    updateApiStatus("连接成功", true)
                    showToastr("success", "API连接成功！")
                } else {
                    updateApiStatus(`错误: ${result.code} - ${result.message}`, false)
                    showToastr("error", `API错误: ${result.code} - ${result.message}`)
                }
            } else {
                const errText = await response.text()
                updateApiStatus(`HTTP ${response.status}`, false)
                showToastr("error", `连接失败: HTTP ${response.status}`)
                logError("测试连接失败:", errText)
            }
        } catch (e) {
            updateApiStatus("连接失败", false)
            showToastr("error", `连接失败: ${e.message}`)
            logError("测试连接异常:", e)
        }
    }

    // 更新API状态
    function updateApiStatus(status, success) {
        const $status = jQuery("#memos-api-status")
        $status.text(status)
        $status.removeClass("success error")
        if (success === true) $status.addClass("success")
        else if (success === false) $status.addClass("error")
    }

    // 更新统计
    function updateStatsDisplay() {
        jQuery("#memos-total-memories").text(totalMemories)
        jQuery("#memos-sessions-saved").text(savedMessageIds.size)
        jQuery("#memos-retrieves-count").text(totalRetrieves)
        jQuery("#memos-last-retrieve").text(lastRetrieveTime ? formatTime(lastRetrieveTime) : "从未")
        jQuery("#memos-last-save").text(lastAddTime ? formatTime(lastAddTime) : "从未")
    }
    
    // 格式化时间
    function formatTime(timestamp) {
        const date = new Date(timestamp)
        const now = new Date()
        const diff = now - date
        
        // 1分钟内
        if (diff < 60000) {
            return "刚刚"
        }
        // 1小时内
        if (diff < 3600000) {
            const mins = Math.floor(diff / 60000)
            return `${mins}分钟前`
        }
        // 24小时内
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000)
            return `${hours}小时前`
        }
        // 超过24小时显示完整时间
        return date.toLocaleString()
    }

    // === 事件监听：监控用户消息并自动注入 ===
    let isInitializing = false  // 标记是否正在初始化
    let isInitialized = false   // 标记初始化是否完成

    function setupAutoInjection() {
        let lastMessageId = null
        let checkInterval = null

        logDebug("启动自动注入轮询...")

        // 记录已处理的消息索引，防止重复处理（仅用于运行时去重）
        let processedMessageIndices = new Set()

        // 酒馆API的 getLastMessageId 返回从0开始的索引，不是消息数量
        // 例如：有6条消息时，返回5（第6条消息的索引）
        // 所以使用返回值时需要+1来得到正确的消息数量
        function getMessageCount() {
            const rawIndex = TavernHelper.getLastMessageId()
            return rawIndex + 1  // +1 将索引转换为消息数量
        }

        async function checkForNewMessage() {
            try {
                // 如果正在初始化中，跳过本次轮询
                if (isInitializing) {
                    logDebug("正在初始化中，跳过轮询")
                    return
                }

                // 使用 getLastMessageId 获取消息数量（返回值是从0开始的楼层索引）
                if (!TavernHelper.getLastMessageId) {
                    logDebug("getLastMessageId 不可用")
                    return
                }

                const currentCount = getMessageCount()  // 获取修正后的消息数量（+1）
                const rawIndex = TavernHelper.getLastMessageId()  // 保留原始索引用于日志

                // 首次运行，初始化
                if (lastMessageId === null && !isInitialized) {
                    isInitializing = true
                    logDebug(`初始化: 消息数 = ${currentCount}`)
                    
                    // 获取当前聊天文件名（用于生成消息ID）
                    await getChatFileName()
                    
                    const initMessages = await TavernHelper.getChatMessages(
                        `0-${currentCount - 1}`,
                        { include_swipes: false }
                    )
                    
                    if (initMessages) {
                        let savedCount = 0
                        let skipCount = 0
                        
                        for (let idx = 0; idx < initMessages.length; idx++) {
                            const msg = initMessages[idx]
                            const globalIndex = idx
                            const msgId = await generateMessageId(msg, globalIndex)
                            
                            // 只添加到运行时去重集合
                            processedMessageIndices.add(globalIndex)
                            
                            const content = msg.message || msg.content || msg.mes || ""
                            const isUser = msg.is_user === true || msg.role === "user"
                            
                            if (!content || !content.trim()) {
                                continue
                            }
                            
                            // 只跳过 MemOS 记忆注入楼层（包含 "[MemOS 记忆上下文]" 的消息）
                            if (content.includes("[MemOS 记忆上下文]") || content.includes("MemOS 记忆上下文")) {
                                logDebug(`跳过注入记忆楼层 #${globalIndex}`)
                                markMessageSaved(msgId)  // 标记为已保存
                                skipCount++
                                continue
                            }
                            
                            // 检查API配置
                            if (!memosConfig.apiKey) {
                                logDebug(`跳过 #${globalIndex}：API未配置`)
                                continue
                            }
                            
                            // 保存消息（不管是否已保存过，都重新保存）
                            const role = isUser ? "user" : "assistant"
                            logDebug(`初始化保存: #${globalIndex} (${role}) - ${content.substring(0, 50)}...`)
                            
                            try {
                                const result = await addMessage(role, content.trim(), {})
                                if (result) {
                                    logDebug(`初始化保存成功 #${globalIndex}`)
                                } else {
                                    logDebug(`初始化保存失败或被拦截 #${globalIndex}`)
                                }
                                markMessageSaved(msgId)
                                savedCount++
                                
                                // 每保存1条等待一下，避免请求过快（初始化批量保存）
                                // API可能有限流，每条之间加3秒延迟
                                await new Promise(resolve => setTimeout(resolve, 3000))
                            } catch (e) {
                                logError(`初始化保存失败 #${globalIndex}:`, e)
                            }
                        }
                        
                        logDebug(`初始化完成: 已保存 ${savedCount} 条，跳过 ${skipCount} 条（注入记忆楼层），总计 ${processedMessageIndices.size} 条`)
                    }
                    
                    lastMessageId = currentCount
                    isInitialized = true
                    isInitializing = false
                    return
                }

                // 初始化完成后，设置 lastMessageId
                if (lastMessageId === null && isInitialized) {
                    lastMessageId = currentCount
                    return
                }

                // 检测聊天是否切换了（消息数量突然变少）
                if (lastMessageId > currentCount) {
                    logDebug(`聊天切换检测: ${lastMessageId} -> ${currentCount}，重置状态`)
                    // 重置状态，重新初始化
                    isInitialized = false
                    isInitializing = false
                    lastMessageId = null
                    // 清空已处理消息索引
                    processedMessageIndices = new Set()
                    return
                }

                // 检测到新消息
                if (currentCount > lastMessageId) {
                    logDebug(`检测到新消息: ${lastMessageId} -> ${currentCount}`)
                    
                    // 获取新增的消息
                    const messages = await TavernHelper.getChatMessages(
                        `${lastMessageId}-${currentCount - 1}`,
                        { include_swipes: false }
                    )
                    
                    if (!messages || messages.length === 0) {
                        logDebug("没有获取到新消息")
                        lastMessageId = currentCount
                        return
                    }

                    logDebug(`获取到 ${messages.length} 条新消息`)

                    // 逐条处理新消息
                    for (let i = 0; i < messages.length; i++) {
                        const msg = messages[i]
                        const globalIndex = lastMessageId + i
                        const msgId = await generateMessageId(msg, globalIndex)
                        
                        // 检查是否已处理过（运行时去重）
                        if (processedMessageIndices.has(globalIndex)) {
                            logDebug(`消息 #${globalIndex} 已处理，跳过`)
                            continue
                        }
                        
                        const content = msg.message || msg.content || msg.mes || ""
                        const isUser = msg.is_user === true || msg.role === "user"
                        
                        logDebug(`处理消息 #${globalIndex} (ID: ${msgId}): ${content.substring(0, 30)}... is_user: ${isUser}, role: ${msg.role}`)
                        
                        if (!content || !content.trim()) {
                            processedMessageIndices.add(globalIndex)
                            continue
                        }
                        
                        // 跳过 MemOS 记忆注入楼层（包含 "[MemOS 记忆上下文]" 的消息）
                        if (content.includes("[MemOS 记忆上下文]") || content.includes("MemOS 记忆上下文")) {
                            logDebug("跳过 MemOS 记忆注入楼层，不触发检索或保存")
                            processedMessageIndices.add(globalIndex)
                            markMessageSaved(msgId)  // 也标记为已保存
                            continue
                        }

                        // 检查API配置
                        if (!memosConfig.apiKey) {
                            processedMessageIndices.add(globalIndex)
                            lastMessageId = currentCount
                            continue
                        }

                        // === 用户消息：保存到 MemOS + 检索记忆并注入 ===
                        if (isUser && msg.role === "user") {
                            // 检查是否已保存过（持久化去重）
                            if (isMessageSaved(msgId)) {
                                logDebug(`用户消息 #${globalIndex} 已保存过，跳过`)
                            } else {
                                // 等待3秒间隔
                                await waitForInterval(3000)
                                // 保存用户消息到 MemOS
                                logDebug("用户消息，保存到 MemOS...")
                                try {
                                    await addMessage("user", content.trim())
                                    markMessageSaved(msgId)
                                    logDebug("用户消息已保存到 MemOS")
                                } catch (e) {
                                    logError("保存用户消息失败:", e)
                                }
                            }
                            
                            // 检查检索间隔（10秒）
                            const now = Date.now()
                            const retrieveElapsed = now - lastRetrieveTimeForInterval
                            
                            // 用户消息已确认是 isUser && msg.role === "user"，直接检查间隔即可
                            if (retrieveElapsed < 10000) {
                                logDebug(`检索间隔未满10秒(${retrieveElapsed}ms)，跳过检索`)
                            } else {
                                lastRetrieveTimeForInterval = now
                                // 检索记忆并注入
                                logDebug("用户消息，检索记忆...")
                                
                                // 先停止生成（如果有正在生成的对话）
                                try {
                                    const parentWin = window.parent
                                    // 使用酒馆API停止生成
                                    if (parentWin.SillyTavern && typeof parentWin.SillyTavern.stopGeneration === "function") {
                                        const stopped = parentWin.SillyTavern.stopGeneration()
                                        logDebug(`停止生成: ${stopped ? "成功" : "无需停止或已停止"}`)
                                    }
                                    // 备用：使用 /stop 命令
                                    if (parentWin.TavernHelper && typeof parentWin.TavernHelper.triggerSlash === "function") {
                                        try {
                                            await parentWin.TavernHelper.triggerSlash("/stop")
                                            logDebug("已发送 /stop 命令")
                                        } catch (e) {
                                            logDebug("/stop 命令执行失败:", e)
                                        }
                                    }
                                    // 等待停止生效
                                    await new Promise(resolve => setTimeout(resolve, 500))
                                } catch (e) {
                                    logDebug("停止生成失败:", e)
                                }
                                
                                try {
                                    const result = await searchMemory(content, memosSettings.retrieveCount)
                                    logDebug("检索结果:", result)
                                    
                                    if (result && (result.memories.length > 0 || (result.preferences && result.preferences.length > 0))) {
                                        await injectMemoryToPrompt(result.memories, result.preferences)
                                        logDebug("记忆注入成功")
                                        showToastr("info", `已注入 ${result.memories.length} 条记忆`)
                                        
                                        // 注入完成后，等待1秒让消息楼层稳定，然后触发生成
                                        setTimeout(async () => {
                                            logDebug("记忆注入完成，触发生成...")
                                            try {
                                                const parentWin = window.parent
                                                // 尝试触发生成
                                                const sendBtn = parentWin.document?.querySelector('#send_but, #gen_button')
                                                    || document.querySelector('#send_but, #gen_button')
                                                if (sendBtn) {
                                                    sendBtn.click()
                                                    logDebug("已点击生成按钮")
                                                } else {
                                                    logError("未找到生成按钮，尝试 sendTextareaMessage")
                                                    if (typeof parentWin.sendTextareaMessage === "function") {
                                                        parentWin.sendTextareaMessage()
                                                    }
                                                }
                                            } catch (e) {
                                                logError("触发生成失败:", e)
                                            }
                                        }, 1000)
                                    } else {
                                        // 即使没有检索到记忆，也要触发生成（用于训练新记忆）
                                        logDebug("未检索到相关记忆，仍触发生成（用于训练记忆）")
                                        setTimeout(async () => {
                                            try {
                                                const parentWin = window.parent
                                                const sendBtn = parentWin.document?.querySelector('#send_but, #gen_button')
                                                    || document.querySelector('#send_but, #gen_button')
                                                if (sendBtn) {
                                                    sendBtn.click()
                                                    logDebug("已点击生成按钮（无记忆模式）")
                                                } else if (typeof parentWin.sendTextareaMessage === "function") {
                                                    parentWin.sendTextareaMessage()
                                                }
                                            } catch (e) {
                                                logError("触发生成失败:", e)
                                            }
                                        }, 1000)
                                    }
                                } catch (e) {
                                    logError("检索失败:", e)
                                    // 检索失败时也触发生成
                                    logDebug("检索失败，触发生成...")
                                    setTimeout(async () => {
                                        try {
                                            const parentWin = window.parent
                                            const sendBtn = parentWin.document?.querySelector('#send_but, #gen_button')
                                                || document.querySelector('#send_but, #gen_button')
                                            if (sendBtn) {
                                                sendBtn.click()
                                            } else if (typeof parentWin.sendTextareaMessage === "function") {
                                                parentWin.sendTextareaMessage()
                                            }
                                        } catch (err) {
                                            logError("触发生成失败:", err)
                                        }
                                    }, 1000)
                                }
                            }
                        }
                        
                        // === AI/Assistant 消息：自动保存 ===
                        const isNotUser = msg.role !== "user" && msg.is_user !== true
                        
                        // 跳过 MemOS 记忆注入楼层
                        if (content.includes("[MemOS 记忆上下文]") || content.includes("MemOS 记忆上下文")) {
                            logDebug("跳过 MemOS 记忆注入楼层的AI消息保存")
                            processedMessageIndices.add(globalIndex)
                            markMessageSaved(msgId)  // 也标记为已保存
                        } else if (isNotUser && content && content.trim() && msg.role !== "system") {
                            // 检查是否已保存过（持久化去重）
                            if (isMessageSaved(msgId)) {
                                logDebug(`AI消息 #${globalIndex} 已保存过，跳过`)
                            } else {
                                logDebug("AI回复，保存消息到 MemOS...")
                                try {
                                    await addMessage("assistant", content.trim())
                                    markMessageSaved(msgId)
                                    logDebug("AI消息已保存到 MemOS")
                                } catch (e) {
                                    logError("保存失败:", e)
                                }
                            }
                        }
                        
                        // 标记为已处理
                        processedMessageIndices.add(globalIndex)
                    }

                    lastMessageId = currentCount
                }
            } catch (e) {
                logError("轮询检查失败:", e)
            }
        }

        // 启动轮询（每2秒）
        checkInterval = setInterval(checkForNewMessage, 2000)
        logDebug("自动注入轮询已启动，每2秒检查一次")
        
        // 立即执行一次
        setTimeout(checkForNewMessage, 1000)
    }

    // 绑定设置面板事件
    function bindSettingsEvents() {
        // 测试连接
        jQuery("#memos-test-connection").on("click", testConnection)

        // 保存配置
        jQuery("#memos-save-config").on("click", function() {
            memosConfig.apiEndpoint = jQuery("#memos-api-endpoint").val().trim()
            memosConfig.apiKey = jQuery("#memos-api-key").val().trim()
            saveSettings()
            showToastr("success", "配置已保存")
        })

        // 清除配置
        jQuery("#memos-clear-config").on("click", function() {
            memosConfig = { ...DEFAULT_CONFIG }
            loadSettingsToUI()
            localStorage.removeItem(STORAGE_KEY_API_CONFIG)
            showToastr("info", "配置已清除")
        })

        // 开关
        jQuery("#memos-enabled").on("change", function() {
            memosSettings.enabled = jQuery(this).is(":checked")
            saveSettings()
        })

        jQuery("#memos-auto-save").on("change", function() {
            memosSettings.autoSave = jQuery(this).is(":checked")
            saveSettings()
        })

        jQuery("#memos-auto-retrieve").on("change", function() {
            memosSettings.autoRetrieve = jQuery(this).is(":checked")
            saveSettings()
        })

        jQuery("#memos-retrieve-count").on("change", function() {
            memosSettings.retrieveCount = parseInt(jQuery(this).val()) || 5
            saveSettings()
        })

        jQuery("#memos-relativity-threshold").on("change", function() {
            memosSettings.relativityThreshold = parseFloat(jQuery(this).val()) || 0.5
            saveSettings()
        })

        // 按钮
        jQuery("#memos-manual-save").on("click", manualSave)
        jQuery("#memos-save-current-chat").on("click", saveCurrentChat)
        jQuery("#memos-search").on("click", searchMemories)
        jQuery("#memos-get-all").on("click", showAllMemories)
        jQuery("#memos-refresh-injection").on("click", refreshInjection)
        jQuery("#memos-clear-injection").on("click", clearInjection)

        logDebug("设置面板事件绑定完成")
    }

    // 加载设置到UI
    function loadSettingsToUI() {
        jQuery("#memos-api-endpoint").val(memosConfig.apiEndpoint)
        jQuery("#memos-api-key").val(memosConfig.apiKey)
        jQuery("#memos-enabled").prop("checked", memosSettings.enabled)
        jQuery("#memos-auto-save").prop("checked", memosSettings.autoSave)
        jQuery("#memos-auto-retrieve").prop("checked", memosSettings.autoRetrieve)
        jQuery("#memos-retrieve-count").val(memosSettings.retrieveCount)
        jQuery("#memos-relativity-threshold").val(memosSettings.relativityThreshold || 0.5)
    }

    // 初始化
    async function init() {
        logDebug("MemOS插件初始化...")
        logDebug("jQuery:", typeof jQuery !== "undefined" ? "可用" : "不可用")
        logDebug("SillyTavern:", typeof SillyTavern !== "undefined" ? "可用" : "不可用")
        logDebug("TavernHelper:", typeof TavernHelper !== "undefined" ? "可用" : "不可用")
        logDebug("toastr:", typeof toastr !== "undefined" ? "可用" : "不可用")

        if (typeof jQuery === "undefined" || typeof SillyTavern === "undefined" || typeof TavernHelper === "undefined") {
            logError("核心API不可用")
            return
        }

        // 1. 动态加载 settings.html 到扩展菜单容器
        try {
            const settingsHtml = await jQuery.get(`${extensionFolderPath}/settings.html`);
            jQuery('#extensions_settings2').append(settingsHtml);
            logDebug("settings.html 已加载到扩展菜单");
        } catch (error) {
            logError("加载 settings.html 失败:", error);
            toastr.error("MemOS 设置页面加载失败");
            return;
        }

        // 2. 绑定 inline-drawer 的展开/折叠事件
        jQuery('.extension_settings[data-extension-name="memos"]')
            .find('.inline-drawer-toggle')
            .on('click', function () {
                jQuery(this).closest('.inline-drawer').toggleClass('open');
            });

        // 先保存一次默认配置，确保localStorage有数据
        if (!localStorage.getItem(STORAGE_KEY_API_CONFIG)) {
            logDebug("首次运行，初始化默认配置")
            saveSettings()
        }
        
        loadSettings()
        loadSettingsToUI()
        updateStatsDisplay()
        logDebug("当前配置:", JSON.stringify(memosConfig))
        logDebug("当前设置:", JSON.stringify(memosSettings))
        
        // 异步获取用户ID
        const userId = await getCurrentUserId()
        logDebug("当前用户ID（角色卡）:", userId)
        
        // 加载已保存的消息ID记录（用于去重）
        loadSavedMessageIds()
        logDebug(`已加载 ${savedMessageIds.size} 条已保存消息记录`)
        
        setupAutoInjection()
        registerEventListeners()  // 注册事件监听器
        bindSettingsEvents()  // 绑定设置面板事件

        // 更新器事件绑定
        jQuery('#memos-check-update').on('click', () => Updater.checkForUpdates(true))
        jQuery('#memos-update-now').on('click', () => Updater.performUpdate())

        // 自动静默检查更新（5秒后执行）
        setTimeout(() => {
            Updater.checkForUpdates(false).catch(e => logDebug('自动检查更新失败:', e))
        }, 5000)

        logDebug("MemOS插件初始化完成")
        if (typeof toastr !== "undefined") {
            showToastr("success", "MemOS插件已加载，轮询已启动")
        }
    }

    // 延迟启动，确保其他插件已初始化
    setTimeout(async () => {
        await init()
    }, 2000)
})
