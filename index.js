// MemOS Integration for SillyTavern
// 使用 inject API 注入记忆到 prompt
// 依赖 TavernHelper API (JS-Slash-Runner)

jQuery(async () => {
    "use strict"

    // --- 扩展配置 ---
    const extensionName = 'memos';
    const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
    const DEBUG_MODE = true;

    // --- 全局变量 ---
    let tavernHelperApi = null;

    // --- 延迟函数 ---
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));

    // ===================================================================================
    // 1. TavernHelper API 封装 (依赖 JS-Slash-Runner)
    // ===================================================================================

    /**
     * 轮询等待 TavernHelper API 可用
     * @returns {Promise<object>} TavernHelper 对象
     */
    async function waitForTavernHelper(retries = 10, interval = 300) {
        for (let i = 0; i < retries; i++) {
            if (
                window.TavernHelper &&
                typeof window.TavernHelper.getChatMessages === 'function' &&
                typeof window.TavernHelper.triggerSlash === 'function'
            ) {
                console.log(`[${extensionName}] TavernHelper API is available.`);
                return window.TavernHelper;
            }
            await delay(interval);
        }
        throw new Error(
            `TavernHelper API is not available. Please ensure JS-Slash-Runner extension is installed and enabled.`,
        );
    }

    // ===================================================================================
    // 2. TavernHelper 封装函数
    // ===================================================================================

    /**
     * 获取聊天消息
     * @param {string} range - 消息范围，如 "0-last"
     * @param {object} options - 选项
     * @returns {Promise<Array>} 消息数组
     */
    async function getChatMessagesSafe(range, options = {}) {
        if (!tavernHelperApi) {
            tavernHelperApi = await waitForTavernHelper();
        }
        return await tavernHelperApi.getChatMessages(range, options);
    }

    /**
     * 执行 slash 命令
     * @param {string} command - slash 命令
     * @returns {Promise<string>} 命令结果
     */
    async function triggerSlashSafe(command) {
        if (!tavernHelperApi) {
            tavernHelperApi = await waitForTavernHelper();
        }
        return await tavernHelperApi.triggerSlash(command);
    }

    /**
     * 获取 SillyTavern 上下文
     */
    function getSillyTavernContext() {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
            return window.SillyTavern.getContext();
        }
        return null;
    }

    /**
     * 显示 toast 通知
     */
    function showToastr(type, message) {
        if (typeof window.toastr !== 'undefined') {
            window.toastr[type](message, 'MemOS');
        }
    }

    // --- 调试日志 ---
    function logDebug(...args) {
        if (DEBUG_MODE) console.log(`[${extensionName}]`, ...args);
    }

    function logError(...args) {
        console.error(`[${extensionName}]`, ...args);
    }

    // ===================================================================================
    // 3. 更新器模块
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
            const context = getSillyTavernContext();
            if (!context || !context.common) {
                console.error(`[${extensionName}] SillyTavern.getContext() 返回无效`);
                showToastr('error', '系统未就绪，请稍后重试');
                return;
            }
            
            const { getRequestHeaders } = context.common;
            showToastr('info', '正在开始更新...');
            console.log(`[${extensionName}] 开始更新`);
            
            try {
                const response = await fetch('/api/extensions/update', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        extensionName: extensionName,
                    }),
                });
                
                const result = await response.text();
                console.log(`[${extensionName}] 更新API响应状态`, response.status);
                console.log(`[${extensionName}] 更新API响应内容:`, result);
                
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

                const isSuccess = response.ok && (
                    resultObj.ok === true || 
                    resultObj.success === true ||
                    (typeof resultObj === 'string' && resultObj.includes('success'))
                );
                
                if (isSuccess || response.status === 200) {
                    showToastr('success', '更新成功！正在刷新页面...');
                    console.log(`[${extensionName}] 更新成功，准备刷新页面`);
                    setTimeout(() => {
                        console.log(`[${extensionName}] 执行页面刷新`);
                        window.location.reload(true);
                    }, 1000);
                } else {
                    throw new Error(resultObj.message || resultObj.error || '更新失败');
                }
            } catch (error) {
                console.error(`[${extensionName}] 更新失败:`, error);
                showToastr('error', `更新失败: ${error.message}`);
            }
        },

        async showUpdateConfirmDialog() {
            if (
                await window.SillyTavern.callGenericPopup(
                    `发现新版本${this.latestVersion}！您想现在更新吗？`,
                    window.SillyTavern.GENERIC_POPUP_TYPES.confirm,
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
                    $newVersionDisplay.text(this.latestVersion);
                    $updateGuide.show();
                    
                    if (isManual)
                        showToastr(
                            'warning',
                            `发现新版本${this.latestVersion}！请查看下方手动更新步骤。`,
                        );
                } else {
                    $updateIndicator.hide();
                    $updateGuide.hide();
                    if (isManual) showToastr('info', '您当前已是最新版本。');
                }
            } catch (error) {
                if (isManual) showToastr('error', `检查更新失败: ${error.message}`);
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

    // ===================================================================================
    // 4. 存储和配置
    // ===================================================================================

    const STORAGE_KEY_API_CONFIG = "memos_api_config";
    const STORAGE_KEY_SETTINGS = "memos_settings";
    const STORAGE_KEY_SAVED_MESSAGES = "memos_saved_message_ids";
    const STORAGE_KEY_SAVED_MESSAGES_VERSION = "memos_saved_version";
    const SAVED_VERSION = "2.0";

    const DEFAULT_CONFIG = {
        apiEndpoint: "https://memos.memtensor.cn/api/openmem/v1",
        apiKey: ""
    };

    const DEFAULT_SETTINGS = {
        enabled: true,
        autoSave: true,
        autoRetrieve: true,
        retrieveCount: 5,
        relativityThreshold: 0.5
    };

    // 全局变量
    let memosConfig = { ...DEFAULT_CONFIG };
    let memosSettings = { ...DEFAULT_SETTINGS };
    let lastSaveTime = null;
    let lastRetrieveTime = null;
    let lastAddTime = null;
    let totalMemories = 0;
    let sessionsSaved = 0;
    let totalRetrieves = 0;
    let currentInjectionId = "memos_memory_injection";
    let isGenerating = false;
    let isInjectingMemory = false;
    let savedMessageIds = new Set();
    let lastSaveTimeForInterval = 0;
    let lastRetrieveTimeForInterval = 0;
    let cachedChatFileName = null;

    // ===================================================================================
    // 5. 聊天文件名处理
    // ===================================================================================

    function getChatFileNameSync() {
        return cachedChatFileName;
    }

    function initSyncCaches() {
        cachedChatFileName = null;
        logDebug(`initSyncCaches: 缓存已清理`);
    }

    async function getChatFileName() {
        if (cachedChatFileName) return cachedChatFileName;
        
        try {
            const chatName = await triggerSlashSafe("/getchatname");
            if (chatName && typeof chatName === "string" && chatName.trim() && 
                chatName.trim() !== "null" && chatName.trim() !== "undefined") {
                cachedChatFileName = chatName.trim();
                logDebug(`获取到聊天文件名: ${cachedChatFileName}`);
                return cachedChatFileName;
            }
        } catch (error) {
            logDebug("获取聊天文件名失败:", error);
        }
        
        const fallback = `chat_${Date.now()}`;
        cachedChatFileName = fallback;
        return fallback;
    }

    async function delayGetChatFileName() {
        logDebug("延迟5秒后获取聊天文件名...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        const chatName = await getChatFileName();
        logDebug(`延迟获取到的聊天文件名: ${chatName}`);
        return chatName;
    }

    let chatFileNameRefreshInterval = null;

    async function startChatFileNameRefresh() {
        await delayGetChatFileName();
        
        chatFileNameRefreshInterval = setInterval(async () => {
            logDebug("定时刷新聊天文件名...");
            cachedChatFileName = null;
            await getChatFileName();
            logDebug(`刷新后的聊天文件名: ${cachedChatFileName}`);
        }, 30000);
        
        logDebug("聊天文件名定时刷新已启动（每30秒）");
    }

    function stopChatFileNameRefresh() {
        if (chatFileNameRefreshInterval) {
            clearInterval(chatFileNameRefreshInterval);
            chatFileNameRefreshInterval = null;
            logDebug("聊天文件名定时刷新已停止");
        }
    }

    async function generateMessageId(msg, index) {
        const chatFile = getChatFileNameSync() || "unknown_chat";
        return `${chatFile}_idx_${index}`;
    }

    function getCharNameSync() {
        try {
            const chars = window.SillyTavern?.characters;
            const thisChId = window.SillyTavern?.characterId;
            
            logDebug(`getCharNameSync: chars=${!!chars}, thisChId=${thisChId}`);
            
            if (chars && Array.isArray(chars) && thisChId !== undefined && 
                thisChId !== null && chars[thisChId] && chars[thisChId].name) {
                const name = chars[thisChId].name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
                logDebug(`getCharNameSync 成功: ${name}`);
                return name;
            }
            
            if (chars && Array.isArray(chars)) {
                for (let i = 0; i < chars.length; i++) {
                    if (chars[i] && chars[i].name) {
                        logDebug(`getCharNameSync 备用(${i}): ${chars[i].name}`);
                        return chars[i].name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
                    }
                }
            }
        } catch (e) {
            logDebug("获取角色卡名失败:", e);
        }
        logDebug("getCharNameSync 返回 null");
        return null;
    }

    // ===================================================================================
    // 6. 消息ID管理
    // ===================================================================================

    function loadSavedMessageIds() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_SAVED_MESSAGES);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    savedMessageIds = new Set(parsed);
                    logDebug(`已加载${savedMessageIds.size} 条已保存的消息ID`);
                }
            } else {
                logDebug("没有已保存的消息ID记录");
            }
        } catch (e) {
            logError("加载已保存消息ID失败:", e);
            savedMessageIds = new Set();
        }
    }

    function persistSavedMessageIds() {
        try {
            const MAX_SAVED = 1000;
            const array = Array.from(savedMessageIds);
            
            if (array.length > MAX_SAVED) {
                const trimmed = array.slice(-MAX_SAVED);
                savedMessageIds = new Set(trimmed);
                logDebug(`消息ID列表已裁剪，保留最新${MAX_SAVED} 条`);
            }
            
            localStorage.setItem(STORAGE_KEY_SAVED_MESSAGES, JSON.stringify(Array.from(savedMessageIds)));
            localStorage.setItem(STORAGE_KEY_SAVED_MESSAGES_VERSION, SAVED_VERSION);
        } catch (e) {
            logError("保存消息ID失败:", e);
        }
    }

    function clearSavedMessageRecords() {
        savedMessageIds = new Set();
        persistSavedMessageIds();
        logDebug("已清除所有已保存消息记录");
    }

    function isMessageSaved(msgId) {
        return savedMessageIds.has(msgId);
    }

    function markMessageSaved(msgId) {
        savedMessageIds.add(msgId);
        persistSavedMessageIds();
    }

    // ===================================================================================
    // 7. MemOS API 调用
    // ===================================================================================

    async function callMemOSApi(endpoint, data) {
        if (!memosConfig.apiEndpoint || !memosConfig.apiKey) {
            throw new Error("MemOS API未配置");
        }

        const url = `${memosConfig.apiEndpoint.replace(/\/$/, "")}${endpoint}`;
        logDebug(`API调用: POST ${url}`);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Token ${memosConfig.apiKey}`,
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        if (result.code !== 0) {
            throw new Error(result.message || result.msg || "API错误");
        }

        return result.data;
    }

    async function searchMemory(query, topK = 5) {
        if (!query || !query.trim()) {
            logDebug("查询内容为空");
            return null;
        }

        try {
            const userId = await getCurrentUserId() || `st_user_${Date.now()}`;
            const conversationId = getCurrentCharName() || "default_conversation";
            
            const data = {
                query: query.trim(),
                user_id: userId,
                conversation_id: conversationId
            };
            
            logDebug("搜索请求:", JSON.stringify(data));

            const result = await callMemOSApi("/search/memory", data);
            
            const memoryDetailList = result.memory_detail_list || [];
            const preferenceDetailList = result.preference_detail_list || [];
            
            totalMemories = result.total || 0;

            const memories = memoryDetailList.filter(m => 
                (m.relativity || m.score || m.relevance || 0) >= memosSettings.relativityThreshold
            );
            const preferences = preferenceDetailList.filter(p =>
                (p.score || p.relevance || 0) >= memosSettings.relativityThreshold
            );

            const formattedMemories = memories.map(m => ({
                content: m.memory_value || m.content || m.memory || "",
                score: m.relativity || m.score || 0
            }));
            const formattedPreferences = preferences.map(p => ({
                content: p.preference || p.content || "",
                score: p.score || 0
            }));

            logDebug(`搜索到${formattedMemories.length} 条记忆`);
            
            lastRetrieveTime = Date.now();
            totalRetrieves++;
            
            return { 
                memories: formattedMemories, 
                preferences: formattedPreferences, 
                total: result.total || 0 
            };
        } catch (e) {
            logError("搜索失败:", e);
            return null;
        }
    }

    async function addMessage(role, content, metadata = {}) {
        if (!content || !content.trim()) {
            logDebug("内容为空，跳过");
            return null;
        }

        try {
            const userId = await getCurrentUserId() || `st_user_${Date.now()}`;
            const conversationId = getCurrentCharName() || "default_conversation";
            
            const data = {
                messages: [{
                    role: role,
                    content: content.trim()
                }],
                user_id: userId,
                conversation_id: conversationId
            };
            
            logDebug("添加消息请求:", JSON.stringify(data));

            const result = await callMemOSApi("/add/message", data);
            lastAddTime = Date.now();
            return result;
        } catch (e) {
            logError("添加消息失败:", e);
            return null;
        }
    }

    async function getAllMessages(limit = 50, offset = 0) {
        try {
            const userId = await getCurrentUserId() || `st_user_${Date.now()}`;
            const conversationId = getCurrentCharName() || "default_conversation";
            
            const data = {
                user_id: userId,
                conversation_id: conversationId,
                message_limit_number: limit
            };
            
            logDebug("获取消息请求:", JSON.stringify(data));
            
            return await callMemOSApi("/get/message", data);
        } catch (e) {
            logError("获取消息失败:", e);
            return null;
        }
    }

    // ===================================================================================
    // 8. 设置管理
    // ===================================================================================

    function loadSettings() {
        try {
            const savedConfig = localStorage.getItem(STORAGE_KEY_API_CONFIG);
            if (savedConfig) {
                memosConfig = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
            }
            const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
            if (savedSettings) {
                memosSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
            }
        } catch (e) {
            logError("加载设置失败:", e);
        }
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY_API_CONFIG, JSON.stringify(memosConfig));
            localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(memosSettings));
        } catch (e) {
            logError("保存设置失败:", e);
        }
    }

    function loadSettingsToUI() {
        jQuery("#memos-api-endpoint").val(memosConfig.apiEndpoint);
        jQuery("#memos-api-key").val(memosConfig.apiKey);
        jQuery("#memos-enabled").prop("checked", memosSettings.enabled);
        jQuery("#memos-auto-save").prop("checked", memosSettings.autoSave);
        jQuery("#memos-auto-retrieve").prop("checked", memosSettings.autoRetrieve);
        jQuery("#memos-retrieve-count").val(memosSettings.retrieveCount);
        jQuery("#memos-relativity-threshold").val(memosSettings.relativityThreshold || 0.5);
    }

    // ===================================================================================
    // 9. 用户ID和角色名
    // ===================================================================================

    async function getCurrentUserId() {
        if (getCurrentUserId.cached) {
            return getCurrentUserId.cached;
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        let newChatFileIdentifier = "st_default";
        
        try {
            const chatNameFromCommand = await triggerSlashSafe("/getchatname");
            
            logDebug("/getchatname 返回:", chatNameFromCommand, "类型:", typeof chatNameFromCommand);
            
            if (chatNameFromCommand && typeof chatNameFromCommand === "string" &&
                chatNameFromCommand.trim() !== "" &&
                chatNameFromCommand.trim() !== "null" &&
                chatNameFromCommand.trim() !== "undefined") {
                const cleaned = cleanChatName(chatNameFromCommand.trim());
                newChatFileIdentifier = "st_" + cleaned;
                logDebug("用户ID（清理后）:", newChatFileIdentifier);
                getCurrentUserId.cached = newChatFileIdentifier;
                return newChatFileIdentifier;
            } else {
                logDebug("/getchatname 返回为空或无效");
            }
        } catch (error) {
            logError("Error calling /getchatname via triggerSlash:", error);
        }
        
        try {
            const chars = window.SillyTavern?.characters;
            const thisChId = window.SillyTavern?.characterId;
            
            if (chars && Array.isArray(chars) && thisChId !== undefined && 
                thisChId !== null && chars[thisChId] && chars[thisChId].name) {
                const charName = chars[thisChId].name;
                newChatFileIdentifier = "st_" + charName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
                logDebug("用户ID（characters备用）:", newChatFileIdentifier);
                getCurrentUserId.cached = newChatFileIdentifier;
                return newChatFileIdentifier;
            }
        } catch (e) {
            logError("获取角色名失败:", e);
        }
        
        getCurrentUserId.cached = newChatFileIdentifier;
        return newChatFileIdentifier;
    }

    function cleanChatName(fileName) {
        if (!fileName || typeof fileName !== "string") {
            return "unknown_chat_source";
        }
        let cleanedName = fileName;
        if (fileName.includes("/") || fileName.includes("\\")) {
            const parts = fileName.split(/[\\\/]/);
            cleanedName = parts[parts.length - 1];
        }
        return cleanedName.replace(/\.jsonl$/, "").replace(/\.json$/, "");
    }

    function getCurrentCharName() {
        try {
            const context = getSillyTavernContext();
            if (context && context.name2) return context.name2;
            return "default_conversation";
        } catch (e) {
            return "default_conversation";
        }
    }

    // ===================================================================================
    // 10. 记忆注入
    // ===================================================================================

    function formatInjectionContext(memories, preferences) {
        let context = "[MemOS 记忆上下文]\n";
        
        if (memories && memories.length > 0) {
            context += "相关记忆:\n";
            memories.forEach((m, i) => {
                const content = m.content || m.memory || m.text || "";
                const score = (m.score || m.relevance || 0).toFixed(2);
                context += `${i + 1}. [相关性: ${score}] ${content}\n`;
            });
        }

        if (preferences && preferences.length > 0) {
            context += "\n用户偏好:\n";
            preferences.forEach((p, i) => {
                const content = p.content || p.preference || p.text || "";
                context += `${i + 1}. ${content}\n`;
            });
        }

        context += "[/MemOS 记忆上下文]";
        return context;
    }

    async function injectMemoryToPrompt(memories, preferences) {
        if (!memosSettings.enabled || !memosSettings.autoRetrieve) {
            logDebug("自动检索未启用");
            return false;
        }

        const context = formatInjectionContext(memories, preferences);
        if (!context || context.length < 50) {
            logDebug("没有足够的记忆内容");
            return false;
        }

        try {
            if (tavernHelperApi && typeof tavernHelperApi.createChatMessages === "function") {
                logDebug("使用 TavernHelper.createChatMessages 注入...");
                await tavernHelperApi.createChatMessages(
                    [
                        {
                            role: 'system',
                            name: 'MemOS记忆',
                            message: context,
                            is_hidden: false,
                        },
                    ],
                    { refresh: 'affected' },
                );
                logDebug("记忆注入成功 (TavernHelper.createChatMessages)");
                return true;
            }

            logError("没有可用的注入方法");
            return false;
        } catch (e) {
            logError("注入失败:", e);
            return false;
        }
    }

    async function removeInjection() {
        try {
            await triggerSlashSafe(`/flushinject ${currentInjectionId}`);
            logDebug("注入已移除");
            return true;
        } catch (e) {
            logError("移除注入失败:", e);
            return false;
        }
    }

    // ===================================================================================
    // 11. 自动注入轮询
    // ===================================================================================

    let isInitializing = false;
    let isInitialized = false;

    async function waitForInterval(minInterval) {
        const now = Date.now();
        const elapsed = now - lastSaveTimeForInterval;
        if (elapsed < minInterval) {
            const waitTime = minInterval - elapsed;
            logDebug(`等待 ${waitTime}ms 以满足间隔要求...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        lastSaveTimeForInterval = Date.now();
    }

    function setupAutoInjection() {
        let lastMessageId = null;
        let checkInterval = null;
        let processedMessageIndices = new Set();

        logDebug("启动自动注入轮询...");

        function getMessageCount() {
            if (!tavernHelperApi || typeof tavernHelperApi.getLastMessageId !== 'function') {
                return 0;
            }
            const rawIndex = tavernHelperApi.getLastMessageId();
            return rawIndex + 1;
        }

        async function checkForNewMessage() {
            try {
                if (isInitializing) {
                    logDebug("正在初始化中，跳过轮询");
                    return;
                }

                if (!tavernHelperApi || typeof tavernHelperApi.getLastMessageId !== 'function') {
                    logDebug("getLastMessageId 不可用");
                    return;
                }

                const currentCount = getMessageCount();
                const rawIndex = tavernHelperApi.getLastMessageId();

                if (lastMessageId === null && !isInitialized) {
                    isInitializing = true;
                    logDebug(`初始化: 消息数= ${currentCount}`);
                    
                    initSyncCaches();
                    
                    logDebug("等待5秒后获取聊天文件名...");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    const chatFile = await getChatFileName();
                    logDebug(`初始化时获取到的聊天文件名: ${chatFile}`);
                    
                    const initMessages = await getChatMessagesSafe(
                        `0-${currentCount - 1}`,
                        { include_swipes: false }
                    );
                    
                    if (initMessages) {
                        let savedCount = 0;
                        let skipCount = 0;
                        
                        for (let idx = 0; idx < initMessages.length; idx++) {
                            const msg = initMessages[idx];
                            const globalIndex = idx;
                            const msgId = await generateMessageId(msg, globalIndex);
                            
                            processedMessageIndices.add(globalIndex);
                            
                            const content = msg.message || msg.content || msg.mes || "";
                            const isUser = msg.is_user === true || msg.role === "user";
                            
                            if (!content || !content.trim()) {
                                continue;
                            }
                            
                            if (content.includes("[MemOS 记忆上下文]") || content.includes("MemOS 记忆上下文）")) {
                                logDebug(`跳过注入记忆楼层 #${globalIndex}`);
                                markMessageSaved(msgId);
                                skipCount++;
                                continue;
                            }
                            
                            if (isMessageSaved(msgId)) {
                                logDebug(`#${globalIndex} 已保存，跳过`);
                                continue;
                            }
                            
                            if (!memosConfig.apiKey) {
                                logDebug(`跳过 #${globalIndex}：API未配置`);
                                continue;
                            }
                            
                            const role = isUser ? "user" : "assistant";
                                logDebug(`#${globalIndex} 初始化保存 (${role})`);
                            
                            try {
                                const result = await addMessage(role, content.trim(), {});
                                if (result) {
                                logDebug(`#${globalIndex} 保存成功`);
                                } else {
                                    logDebug(`#${globalIndex} 保存失败`);
                                }
                                markMessageSaved(msgId);
                                savedCount++;
                                
                                await new Promise(resolve => setTimeout(resolve, 3000));
                            } catch (e) {
                                logError(`初始化保存失败#${globalIndex}:`, e);
                            }
                        }
                        
                        logDebug(`初始化完成: 保存${savedCount}条, 跳过${skipCount}条`);
                    }
                    
                    lastMessageId = currentCount;
                    isInitialized = true;
                    isInitializing = false;
                    return;
                }

                if (lastMessageId === null && isInitialized) {
                    lastMessageId = currentCount;
                    return;
                }

                if (lastMessageId > currentCount) {
                    logDebug(`聊天切换检测: ${lastMessageId} -> ${currentCount}，重置状态`);
                    isInitialized = false;
                    isInitializing = false;
                    lastMessageId = null;
                    processedMessageIndices = new Set();
                    return;
                }

                if (currentCount > lastMessageId) {
                    logDebug(`检测到新消息: ${lastMessageId} -> ${currentCount}`);
                    
                    const messages = await getChatMessagesSafe(
                        `${lastMessageId}-${currentCount - 1}`,
                        { include_swipes: false }
                    );
                    
                    if (!messages || messages.length === 0) {
                        logDebug("没有获取到新消息");
                        lastMessageId = currentCount;
                        return;
                    }

                    logDebug(`获取到${messages.length} 条新消息`);

                    for (let i = 0; i < messages.length; i++) {
                        const msg = messages[i];
                        const globalIndex = lastMessageId + i;
                        const msgId = await generateMessageId(msg, globalIndex);
                        
                        if (processedMessageIndices.has(globalIndex)) {
                            logDebug(`消息 #${globalIndex} 已处理，跳过`);
                            continue;
                        }
                        
                        const content = msg.message || msg.content || msg.mes || "";
                        const isUser = msg.is_user === true || msg.role === "user";
                        
                        logDebug(`#${globalIndex} 处理中`);
                        
                        if (!content || !content.trim()) {
                            processedMessageIndices.add(globalIndex);
                            continue;
                        }
                        
                        if (content.includes("[MemOS 记忆上下文]") || content.includes("MemOS 记忆上下文）")) {
                            logDebug("跳过 MemOS 记忆注入楼层，不触发检索或保存");
                            processedMessageIndices.add(globalIndex);
                            markMessageSaved(msgId);
                            continue;
                        }

                        if (!memosConfig.apiKey) {
                            processedMessageIndices.add(globalIndex);
                            lastMessageId = currentCount;
                            continue;
                        }

                        if (isUser && msg.role === "user") {
                            if (isMessageSaved(msgId)) {
                                logDebug(`#${globalIndex} 已保存，跳过`);
                            } else {
                                await waitForInterval(2000);
                                logDebug(`#${globalIndex} 保存用户消息`);
                                try {
                                    await addMessage("user", content.trim());
                                    markMessageSaved(msgId);
                                } catch (e) {
                                    logError("保存用户消息失败:", e);
                                }
                            }
                            
                            const now = Date.now();
                            const retrieveElapsed = now - lastRetrieveTimeForInterval;
                            
                            if (retrieveElapsed < 30000) {
                                logDebug(`#${globalIndex} 检索冷却中`);
                            } else {
                                lastRetrieveTimeForInterval = now;
                                logDebug(`#${globalIndex} 检索记忆...`);
                                
                                try {
                                    if (window.SillyTavern && typeof window.SillyTavern.stopGeneration === "function") {
                                        window.SillyTavern.stopGeneration();
                                    }
                                    
                                    await triggerSlashSafe("/stop");
                                    await new Promise(resolve => setTimeout(resolve, 500));
                                } catch (e) {
                                    logDebug("停止生成失败:", e);
                                }
                                
                                try {
                                    const result = await searchMemory(content, memosSettings.retrieveCount);
                                    logDebug(`#${globalIndex} 检索到${result?.memories?.length || 0}条记忆`);
                                    
                                    if (result && (result.memories.length > 0 || (result.preferences && result.preferences.length > 0))) {
                                        await injectMemoryToPrompt(result.memories, result.preferences);
                                        showToastr("info", `已注入${result.memories.length} 条记忆`);
                                    }
                                    
                                    setTimeout(async () => {
                                        try {
                                            const sendBtn = document.querySelector('#send_but, #gen_button');
                                            if (sendBtn) sendBtn.click();
                                            else if (typeof window.sendTextareaMessage === "function") window.sendTextareaMessage();
                                        } catch (e) {
                                            logError("触发生成失败:", e);
                                        }
                                    }, 1000);
                                } catch (e) {
                                    logError("检索失败:", e);
                                }
                            }
                        }
                        
                        const isNotUser = msg.role !== "user" && msg.is_user !== true;
                        
                        if (content.includes("[MemOS 记忆上下文]") || content.includes("MemOS 记忆上下文）")) {
                            logDebug("跳过 MemOS 记忆注入楼层的AI消息保存");
                            processedMessageIndices.add(globalIndex);
                            markMessageSaved(msgId);
                        } else if (isNotUser && content && content.trim() && msg.role !== "system") {
                            if (isMessageSaved(msgId)) {
                                logDebug(`#${globalIndex} 已保存，跳过`);
                            } else {
                                logDebug(`#${globalIndex} 保存AI消息`);
                                try {
                                    await addMessage("assistant", content.trim());
                                    markMessageSaved(msgId);
                                } catch (e) {
                                    logError("保存失败:", e);
                                }
                            }
                        }
                        
                        processedMessageIndices.add(globalIndex);
                    }

                    lastMessageId = currentCount;
                }
            } catch (e) {
                logError("轮询检查失败:", e);
            }
        }

        checkInterval = setInterval(checkForNewMessage, 2000);
        logDebug("自动注入轮询已启动，每2秒检查一次");
        
        startChatFileNameRefresh();
        
        setTimeout(checkForNewMessage, 1000);
    }

    // ===================================================================================
    // 12. 事件监听
    // ===================================================================================

    function registerEventListeners() {
        const eventSource = window.eventSource;
        const eventTypes = window.event_types;

        if (!eventSource || !eventTypes) {
            logDebug("eventSource 或 eventTypes 不可用，跳过事件监听器注册");
            return;
        }

        eventSource.on(eventTypes.GENERATION_STARTED, (type, params, isDryRun) => {
            logDebug(`GENERATION_STARTED 事件触发, dryRun: ${isDryRun}`);
            isGenerating = !isDryRun;
        });

        eventSource.on(eventTypes.GENERATION_ENDED, () => {
            logDebug("GENERATION_ENDED 事件触发");
            isGenerating = false;
        });

        eventSource.on(eventTypes.GENERATION_STOPPED, () => {
            logDebug("GENERATION_STOPPED 事件触发");
            isGenerating = false;
        });

        logDebug("事件监听器注册完成");
    }

    // ===================================================================================
    // 13. UI 操作
    // ===================================================================================

    async function saveCurrentChat() {
        try {
            const messages = await getChatMessagesSafe("0-last");
            if (!messages || messages.length === 0) {
                showToastr("warning", "没有消息可保存");
                return;
            }

            let savedCount = 0;
            const recentMessages = messages.slice(-4);
            for (const msg of recentMessages) {
                const role = msg.role || (msg.is_user ? "user" : "assistant");
                const content = msg.message || msg.content || msg.mes || "";
                if (content && content.trim()) {
                    await addMessage(role, content.trim());
                    savedCount++;
                }
            }

            lastSaveTime = new Date();
            sessionsSaved++;
            showToastr("success", `已保存${savedCount} 条消息`);
            updateStatsDisplay();
        } catch (e) {
            logError("保存失败:", e);
            showToastr("error", `保存失败: ${e.message}`);
        }
    }

    async function manualSave() {
        const content = jQuery("#memos-manual-content").val() || "";
        if (!content || !content.trim()) {
            showToastr("warning", "请输入内容");
            return;
        }

        try {
            await addMessage("user", content.trim());
            showToastr("success", "已保存");
            jQuery("#memos-manual-content").val("");
            updateStatsDisplay();
        } catch (e) {
            showToastr("error", `保存失败: ${e.message}`);
        }
    }

    async function searchMemories() {
        const query = jQuery("#memos-search-query").val() || "";
        if (!query || !query.trim()) {
            showToastr("warning", "请输入关键词");
            return;
        }

        try {
            const result = await searchMemory(query.trim(), memosSettings.retrieveCount);
            if (result) {
                const preview = formatInjectionContext(result.memories, result.preferences);
                jQuery("#memos-injection-preview").val(preview);
                showToastr("success", `找到 ${result.memories.length} 条记忆`);
            } else {
                showToastr("info", "未找到相关记忆");
            }
        } catch (e) {
            showToastr("error", `搜索失败: ${e.message}`);
        }
    }

    async function showAllMemories() {
        try {
            const result = await getAllMessages(50, 0);
            if (result && result.messages) {
                let preview = "所有记忆:\n";
                result.messages.forEach((m, i) => {
                    const content = m.content || m.message || "";
                    preview += `${i + 1}. [${m.role || 'unknown'}] ${content}\n`;
                });
                jQuery("#memos-injection-preview").val(preview);
                showToastr("success", `加载了${result.messages.length} 条记忆`);
            } else {
                showToastr("info", "暂无记忆");
            }
        } catch (e) {
            showToastr("error", `加载失败: ${e.message}`);
        }
    }

    async function refreshInjection() {
        try {
            const messages = await getChatMessagesSafe("0-last");
            const lastUserMsg = messages ? messages.filter(m => m.role === "user" || m.is_user).pop() : null;

            if (lastUserMsg) {
                const content = lastUserMsg.message || lastUserMsg.content || lastUserMsg.mes || "";
                const result = await searchMemory(content, memosSettings.retrieveCount);
                if (result && (result.memories.length > 0 || (result.preferences && result.preferences.length > 0))) {
                    const context = formatInjectionContext(result.memories, result.preferences);
                    jQuery("#memos-injection-preview").val(context);
                    await injectMemoryToPrompt(result.memories, result.preferences);
                    showToastr("success", "记忆已注入到prompt");
                } else {
                    showToastr("info", "未找到相关记忆");
                }
            }
        } catch (e) {
            logError("刷新失败:", e);
            showToastr("error", `刷新失败: ${e.message}`);
        }
    }

    async function clearInjection() {
        await removeInjection();
        jQuery("#memos-injection-preview").val("");
        showToastr("info", "已清空注入");
    }

    async function testConnection() {
        if (!memosConfig.apiKey) {
            showToastr("warning", "请输入API Key");
            return;
        }

        try {
            updateApiStatus("测试中...", null);
            
            const testUserId = `test_user_${Date.now()}`;
            const testUrl = `${memosConfig.apiEndpoint.replace(/\/$/, "")}/search/memory`;
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
            });

            if (response.ok) {
                const result = await response.json();
                if (result.code === 0) {
                    updateApiStatus("连接成功", true);
                    showToastr("success", "API连接成功！");
                } else {
                    updateApiStatus(`错误: ${result.code} - ${result.message}`, false);
                    showToastr("error", `API错误: ${result.code} - ${result.message}`);
                }
            } else {
                const errText = await response.text();
                updateApiStatus(`HTTP ${response.status}`, false);
                showToastr("error", `连接失败: HTTP ${response.status}`);
                logError("测试连接失败:", errText);
            }
        } catch (e) {
            updateApiStatus("连接失败", false);
            showToastr("error", `连接失败: ${e.message}`);
            logError("测试连接异常:", e);
        }
    }

    function updateApiStatus(status, success) {
        const $status = jQuery("#memos-api-status");
        $status.text(status);
        $status.removeClass("success error");
        if (success === true) $status.addClass("success");
        else if (success === false) $status.addClass("error");
    }

    function updateStatsDisplay() {
        jQuery("#memos-sessions-saved").text(savedMessageIds.size);
        jQuery("#memos-retrieves-count").text(totalRetrieves);
        jQuery("#memos-last-retrieve").text(lastRetrieveTime ? formatTime(lastRetrieveTime) : "从未");
        jQuery("#memos-last-save").text(lastAddTime ? formatTime(lastAddTime) : "从未");
    }
    
    // 定期更新统计显示（每5秒）
    function startStatsUpdater() {
        setInterval(() => {
            updateStatsDisplay();
        }, 5000);
    }
    
    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) {
            return "刚刚";
        }
        if (diff < 3600000) {
            const mins = Math.floor(diff / 60000);
            return `${mins}分钟前`;
        }
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `${hours}小时前`;
        }
        return date.toLocaleString();
    }

    // ===================================================================================
    // 14. 设置面板事件
    // ===================================================================================

    function bindSettingsEvents() {
        jQuery("#memos-test-connection").on("click", testConnection);

        jQuery("#memos-save-config").on("click", function() {
            memosConfig.apiEndpoint = jQuery("#memos-api-endpoint").val().trim();
            memosConfig.apiKey = jQuery("#memos-api-key").val().trim();
            saveSettings();
            showToastr("success", "配置已保存");
        });

        jQuery("#memos-clear-config").on("click", function() {
            memosConfig = { ...DEFAULT_CONFIG };
            loadSettingsToUI();
            localStorage.removeItem(STORAGE_KEY_API_CONFIG);
            showToastr("info", "配置已清除");
        });

        jQuery("#memos-enabled").on("change", function() {
            memosSettings.enabled = jQuery(this).is(":checked");
            saveSettings();
        });

        jQuery("#memos-auto-save").on("change", function() {
            memosSettings.autoSave = jQuery(this).is(":checked");
            saveSettings();
        });

        jQuery("#memos-auto-retrieve").on("change", function() {
            memosSettings.autoRetrieve = jQuery(this).is(":checked");
            saveSettings();
        });

        jQuery("#memos-retrieve-count").on("change", function() {
            memosSettings.retrieveCount = parseInt(jQuery(this).val()) || 5;
            saveSettings();
        });

        jQuery("#memos-relativity-threshold").on("change", function() {
            memosSettings.relativityThreshold = parseFloat(jQuery(this).val()) || 0.5;
            saveSettings();
        });

        jQuery("#memos-manual-save").on("click", manualSave);
        jQuery("#memos-search").on("click", searchMemories);
        jQuery("#memos-refresh-injection").on("click", refreshInjection);
        jQuery("#memos-clear-injection").on("click", clearInjection);

        jQuery('#memos-check-update').on('click', () => Updater.checkForUpdates(true));

        logDebug("设置面板事件绑定完成");
    }

    // ===================================================================================
    // 15. 主初始化函数 - 注入到酒馆扩展容器
    // ===================================================================================

    async function init() {
        logDebug("MemOS插件初始化...");

        logDebug("jQuery:", typeof jQuery !== "undefined" ? "可用" : "不可用");
        logDebug("SillyTavern:", typeof window.SillyTavern !== "undefined" ? "可用" : "不可用");
        logDebug("toastr:", typeof window.toastr !== "undefined" ? "可用" : "不可用");

        // 等待 TavernHelper API 就绪
        try {
            tavernHelperApi = await waitForTavernHelper();
            logDebug("TavernHelper API 已就绪");
        } catch (error) {
            logError("TavernHelper API 不可用:", error.message);
            showToastr('error', 'MemOS 需要 JS-Slash-Runner 扩展，请先安装并启用该扩展');
            return;
        }

        // 等待酒馆扩展容器就绪
        let attempts = 0;
        const maxAttempts = 30;
        while (!document.getElementById('extensions_settings2') && attempts < maxAttempts) {
            await delay(100);
            attempts++;
        }

        if (!document.getElementById('extensions_settings2')) {
            logError("酒馆扩展容器 #extensions_settings2 未找到");
            // 继续初始化，只是无法显示设置面板
        }

        // 加载settings.html到扩展容器
        try {
            const settingsHtmlPath = `${extensionFolderPath}/settings.html`;
            logDebug(`加载设置HTML: ${settingsHtmlPath}`);
            const html = await jQuery.get(settingsHtmlPath);
            jQuery('#extensions_settings2').append(html);
            logDebug("settings.html 已注入到扩展容器");
        } catch (error) {
            logError("加载 settings.html 失败:", error);
        }

        // 初始化配置
        if (!localStorage.getItem(STORAGE_KEY_API_CONFIG)) {
            logDebug("首次运行，初始化默认配置");
            saveSettings();
        }
        
        loadSettings();
        loadSettingsToUI();
        updateStatsDisplay();
        logDebug("当前配置:", JSON.stringify(memosConfig));
        logDebug("当前设置:", JSON.stringify(memosSettings));
        
        loadSavedMessageIds();
        logDebug(`已加载${savedMessageIds.size} 条已保存消息记录`);
        
        // 启动高级功能
        logDebug("核心API就绪，启动高级功能...");
        
        getCurrentUserId().then(userId => {
            logDebug("当前用户ID（角色卡）:", userId);
        }).catch(e => {
            logDebug("获取用户ID失败:", e);
        });
        
        setupAutoInjection();
        registerEventListeners();
        bindSettingsEvents();
        startStatsUpdater(); // 启动统计信息定时更新

        // 自动静默检查更新（5秒后执行）
        setTimeout(() => {
            Updater.checkForUpdates(false).catch(e => logDebug('自动检查更新失败:', e));
        }, 5000);

        logDebug("MemOS插件完整初始化完成");
        showToastr("success", "MemOS插件已加载，轮询已启动");
    }

    // ===================================================================================
    // 17. 启动
    // ===================================================================================

    logDebug("MemOS插件启动，等待 TavernHelper API...");
    
    setTimeout(async () => {
        try {
            await init();
        } catch (error) {
            console.error(`[${extensionName}] 初始化过程出错:`, error);
            showToastr('error', `MemOS初始化失败: ${error.message}`);
        }
    }, 1000);
});
