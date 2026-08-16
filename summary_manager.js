/**
 * LEASE Memory Context - 记忆表格总结模块
 *
 * 仅负责：选择记忆表格、调用总结模型、写入记忆总结、处理源行、同步向量。
 * 不包含实时填表、聊天总结、大总结、总结优化或世界书同步。
 */
(function () {
    'use strict';

    function cleanSummaryOutput(text) {
        if (!text) return '';
        let output = String(text).trim();

        if (output.includes('</think>')) {
            const raw = output;
            const cleaned = output
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/^[\s\S]*?<\/think>/i, '')
                .trim();
            output = cleaned || raw;
        }

        const formalStart = output.search(/(?:^|\n)\s*(?:【\s*(?:主线剧情|支线剧情|记忆总结|剧情总结|人物档案|人物关系|世界设定|物品追踪|约定)[^】]*】|\d{4}年\d{1,2}月\d{1,2}日[^\n]*\[)/);
        if (formalStart > 0) output = output.slice(formalStart).trim();
        return output;
    }

    function getDataTables() {
        const m = window.Gaigai.m;
        return m && Array.isArray(m.s) ? m.s.slice(0, -1) : [];
    }

    function getSelectedTableIndices() {
        const C = window.Gaigai.config_obj;
        const allIndices = getDataTables().map((_, index) => index);
        const saved = C.manualSummaryTargetTables;
        if (!Array.isArray(saved) || saved.length === 0) return allIndices;
        return saved.filter(index => allIndices.includes(index));
    }

    function getVisibleRowIndices(tableIndex, sheet) {
        const summarized = window.Gaigai.summarizedRows || {};
        const hidden = new Set(Array.isArray(summarized[tableIndex]) ? summarized[tableIndex] : []);
        return sheet.r.map((_, index) => index).filter(index => !hidden.has(index));
    }

    function captureSummarySources(tableIndices) {
        const m = window.Gaigai.m;
        return tableIndices
            .map(tableIndex => {
                const sheet = m.get(tableIndex);
                if (!sheet) return null;
                return {
                    tableIndex,
                    name: sheet.n || `表${tableIndex}`,
                    rowIndices: getVisibleRowIndices(tableIndex, sheet)
                };
            })
            .filter(source => source && source.rowIndices.length > 0);
    }

    function normalizeRowAction(value) {
        return ['keep', 'hide', 'delete'].includes(value) ? value : 'hide';
    }

    function remapHiddenRowsAfterDelete(hiddenRows, deletedRows) {
        const deleted = new Set(deletedRows);
        return hiddenRows
            .filter(index => !deleted.has(index))
            .map(index => index - deletedRows.filter(deletedIndex => deletedIndex < index).length);
    }

    async function applySourceRowAction(sources, action) {
        const normalizedAction = normalizeRowAction(action);
        if (normalizedAction === 'keep') return;

        const m = window.Gaigai.m;
        const summarized = window.Gaigai.summarizedRows || {};

        for (const source of sources) {
            const sheet = m.get(source.tableIndex);
            if (!sheet) continue;

            if (normalizedAction === 'hide') {
                for (const rowIndex of source.rowIndices) {
                    window.Gaigai.markAsSummarized(source.tableIndex, rowIndex);
                }
                continue;
            }

            const deletedRows = [...source.rowIndices].sort((a, b) => a - b);
            const oldHiddenRows = Array.isArray(summarized[source.tableIndex])
                ? [...summarized[source.tableIndex]]
                : [];
            sheet.delMultiple(deletedRows);
            summarized[source.tableIndex] = remapHiddenRowsAfterDelete(oldHiddenRows, deletedRows);
        }
    }

    function persistSummaryState() {
        const m = window.Gaigai.m;
        m.save(false, true);
        if (typeof window.Gaigai.updateCurrentSnapshot === 'function') {
            window.Gaigai.updateCurrentSnapshot();
        }
        if ($('#gai-main-pop').length > 0 && typeof window.Gaigai.shw === 'function') {
            window.Gaigai.shw();
        }
    }

    async function syncSummaryVectors() {
        const C = window.Gaigai.config_obj;
        if (!C.autoVectorizeSummary) return { skipped: true };
        if (!window.Gaigai.VM || typeof window.Gaigai.VM.syncSummaryToBook !== 'function') {
            throw new Error('向量模块尚未加载');
        }
        return window.Gaigai.VM.syncSummaryToBook(true);
    }

    function archiveSummaryRowsAfterVectorization() {
        const m = window.Gaigai.m;
        const summaryTableIndex = Array.isArray(m?.s) ? m.s.length - 1 : -1;
        const summarySheet = summaryTableIndex >= 0 ? m.get(summaryTableIndex) : null;
        if (!summarySheet || !Array.isArray(summarySheet.r) || summarySheet.r.length === 0) return 0;

        const summarized = window.Gaigai.summarizedRows || {};
        const archived = new Set(Array.isArray(summarized[summaryTableIndex]) ? summarized[summaryTableIndex] : []);
        let archivedCount = 0;
        summarySheet.r.forEach((_, rowIndex) => {
            if (archived.has(rowIndex)) return;
            window.Gaigai.markAsSummarized(summaryTableIndex, rowIndex);
            archivedCount++;
        });
        return archivedCount;
    }

    function openTableSelector() {
        if (document.getElementById('gg-sum-table-selector-overlay')) return;

        const C = window.Gaigai.config_obj;
        const tables = getDataTables();
        const selected = new Set(getSelectedTableIndices());
        const overlay = $('<div>', { id: 'gg-sum-table-selector-overlay' });
        document.body.appendChild(overlay[0]);
        overlay[0].setAttribute('style', `
            position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;
            width:100vw!important;height:100dvh!important;background:rgba(0,0,0,.5)!important;
            z-index:2147483647!important;display:flex!important;align-items:center!important;
            justify-content:center!important;overflow-y:auto!important;padding:10px!important;
            margin:0!important;border:none!important;transform:none!important;
        `.replace(/\s+/g, ' ').trim());

        const modal = $('<div>').addClass('gg-custom-modal');
        const cards = tables.map((sheet, index) => {
            const name = window.Gaigai.esc(sheet.n || `表${index}`);
            const rowCount = Array.isArray(sheet.r) ? sheet.r.length : 0;
            return `
                <div class="gg-choice-card" title="${name}">
                    <input type="checkbox" class="gg_sum_table_checkbox_modal" data-table-index="${index}" ${selected.has(index) ? 'checked' : ''}>
                    <span class="gg-choice-name">${name}</span>
                    <span class="gg-choice-badge" style="opacity:.7;">${rowCount}行</span>
                </div>`;
        }).join('');
        modal.html(`
            <span id="gg_sum_modal_close_btn" style="position:absolute;right:20px;top:20px;cursor:pointer;font-size:24px;line-height:1;opacity:.7;">&times;</span>
            <h3 style="margin:0 0 15px 0;">🎯 选择表格</h3>
            <div style="margin-bottom:15px;">
                <div style="display:flex;gap:8px;margin-bottom:10px;">
                    <button type="button" id="gg_sum_modal_select_all" style="flex:1;padding:8px;border-radius:4px;cursor:pointer;font-size:11px;">全选</button>
                    <button type="button" id="gg_sum_modal_deselect_all" style="flex:1;padding:8px;border-radius:4px;cursor:pointer;font-size:11px;">全不选</button>
                </div>
                <div class="gg-choice-grid" style="max-height:min(400px,50vh);overflow-y:auto;">${cards}</div>
            </div>
            <div style="display:flex;gap:10px;">
                <button type="button" id="gg_sum_modal_cancel" style="flex:1;padding:10px;border-radius:4px;cursor:pointer;font-size:12px;">取消</button>
                <button type="button" id="gg_sum_modal_save" style="flex:1;padding:10px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">确定保存</button>
            </div>`);
        overlay.append(modal);

        const close = () => {
            $(document).off('keydown.gg_sum_modal');
            overlay.remove();
        };
        $('#gg_sum_modal_close_btn, #gg_sum_modal_cancel').on('click', close);
        $('#gg_sum_modal_select_all').on('click', () => $('.gg_sum_table_checkbox_modal').prop('checked', true));
        $('#gg_sum_modal_deselect_all').on('click', () => $('.gg_sum_table_checkbox_modal').prop('checked', false));
        $('.gg-choice-card').on('click', function (event) {
            if ($(event.target).is('input')) return;
            const checkbox = $(this).find('input');
            checkbox.prop('checked', !checkbox.prop('checked'));
        });
        $('#gg_sum_modal_save').on('click', () => {
            C.manualSummaryTargetTables = $('.gg_sum_table_checkbox_modal:checked').map(function () {
                return Number($(this).data('table-index'));
            }).get();
            localStorage.setItem('gg_config', JSON.stringify(C));
            persistSummaryState();
            const selectedCount = C.manualSummaryTargetTables.length;
            $('#gg_sum_table_selector_text').text(`🎯 已选择 ${selectedCount} 个表格 (点击修改)`);
            if (typeof toastr !== 'undefined') toastr.success(`已选择 ${selectedCount} 个表格`, '保存成功', { timeOut: 2000 });
            close();
            window.Gaigai.SummaryManager.showUI();
        });
        overlay.on('click', event => {
            if (event.target === overlay[0]) close();
        });
        $(document).off('keydown.gg_sum_modal').on('keydown.gg_sum_modal', event => {
            if (event.key === 'Escape') close();
        });
    }

    window._gg_openSumTableSelector = function (event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        openTableSelector();
    };

    function getHiddenMessageIndices(ctx) {
        const hiddenIndices = new Set();
        if (!Array.isArray(ctx?.chat)) return hiddenIndices;
        ctx.chat.forEach((msg, index) => {
            if (msg?.is_system === true) hiddenIndices.add(index);
        });
        return hiddenIndices;
    }

    async function silentHideMessages(ctx, messageIndices) {
        if (!ctx || !Array.isArray(ctx.chat) || !Array.isArray(messageIndices) || messageIndices.length === 0) {
            return { hidden: 0 };
        }

        let hidden = 0;
        messageIndices.forEach(index => {
            if (!ctx.chat[index]) return;
            ctx.chat[index].is_system = true;
            const $message = $(`#chat .mes[mesid="${index}"]`);
            if ($message.length) $message.attr('is_system', 'true');
            hidden++;
        });

        if (hidden > 0 && typeof ctx.saveChat === 'function') {
            await ctx.saveChat();
        }
        return { hidden };
    }

    async function applyContextLimitHiding() {
        const C = window.Gaigai.config_obj;
        if (!C?.masterSwitch || !C.contextLimit) return { hidden: 0, reason: 'disabled' };

        const keepFloors = Math.max(1, Number.parseInt(C.contextLimitCount, 10) || 30);
        const ctx = window.Gaigai.m?.ctx();
        if (!Array.isArray(ctx?.chat) || ctx.chat.length === 0) {
            return { hidden: 0, reason: 'no-chat' };
        }

        const dialogueIndices = [];
        ctx.chat.forEach((msg, index) => {
            if (!msg || msg.role === 'system' || msg.isGaigaiPrompt || msg.isGaigaiData) return;
            dialogueIndices.push(index);
        });
        if (dialogueIndices.length <= keepFloors) {
            return { hidden: 0, reason: 'within-limit', total: dialogueIndices.length, keep: keepFloors };
        }

        const alreadyHidden = getHiddenMessageIndices(ctx);
        const hideCount = dialogueIndices.length - keepFloors;
        const shouldHide = dialogueIndices
            .slice(0, hideCount)
            .filter(index => !alreadyHidden.has(index));
        const result = await silentHideMessages(ctx, shouldHide);
        console.log(`✂️ [保留N层] 对话共 ${dialogueIndices.length} 层，保留最近 ${keepFloors} 层，本次新增隐藏 ${result.hidden} 层`);
        return { ...result, total: dialogueIndices.length, keep: keepFloors };
    }

    window.Gaigai.applyContextLimitHiding = applyContextLimitHiding;

    class SummaryManager {
        constructor() {
            console.log('✅ [SummaryManager] 轻量表格总结模块初始化完成');
        }

        showUI() {
            const UI = window.Gaigai.ui;
            const C = window.Gaigai.config_obj;
            const API_CONFIG = window.Gaigai.config;
            const m = window.Gaigai.m;
            const ctx = m.ctx();
            const totalCount = Array.isArray(ctx?.chat) ? ctx.chat.length : 0;
            const summaryPointer = Math.max(0, Math.min(totalCount, Number.parseInt(API_CONFIG.lastSummaryIndex, 10) || 0));
            const tables = getDataTables();
            const selected = getSelectedTableIndices();
            const selectionText = selected.length
                ? `🎯 已选择 ${selected.length} 个表格 (点击修改)`
                : '⚠️ 未选择表格 (点击修改)';

            const html = `
                <div class="g-p" style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
                    <div style="background:rgba(255,193,7,.1);border-radius:6px;padding:12px;margin-bottom:12px;border:1px solid rgba(255,193,7,.3);flex-shrink:0;color:${UI.tc};">
                        <div style="font-size:12px;font-weight:600;margin-bottom:10px;border-bottom:1px dashed rgba(0,0,0,.1);padding-bottom:8px;">
                            ⚙️ 自动总结模式：<span style="font-weight:normal;color:#ff9800;">📊 仅表格</span>
                        </div>
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:11px;">
                            <span style="font-weight:bold;white-space:nowrap;">📍 表格总结指针:</span>
                            <div style="display:flex;align-items:center;gap:5px;flex:1;">
                                <input type="number" id="gg_edit_sum_pointer" value="${summaryPointer}" min="0" max="${totalCount}" style="width:100%;min-width:50px;text-align:center;padding:4px;border-radius:4px;border:1px solid rgba(0,0,0,.2);font-size:11px;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                                <span style="white-space:nowrap;">/ ${totalCount} 层</span>
                            </div>
                            <button id="gg_save_sum_pointer_btn" style="padding:4px 12px;background:#ff9800;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;white-space:nowrap;flex-shrink:0;">修正</button>
                        </div>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
                            <span style="font-size:9px;opacity:.6;">💡 指针会自动保存，切换角色时恢复</span>
                            <a href="javascript:void(0)" id="gg_open_config_link" style="color:#ff9800;text-decoration:underline;cursor:pointer;font-size:11px;white-space:nowrap;">修改配置</a>
                        </div>
                    </div>
                    <div style="background:transparent;border-radius:8px;padding:12px;border:1px solid rgba(76,175,80,.7);margin-bottom:12px;flex-shrink:0;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <h4 style="margin:0;color:${UI.tc};">📊 表格总结</h4>
                        </div>
                        <div style="font-size:11px;color:${UI.tc};opacity:.8;margin-bottom:10px;">
                            💡 对当前<strong>未总结</strong>的表格内容（白色行）进行AI总结
                        </div>
                        <div style="background:rgba(255,255,255,.05);border-radius:6px;padding:10px;margin-bottom:10px;border:1px solid rgba(255,255,255,.1);">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                <label style="font-size:11px;font-weight:600;color:${UI.tc};">🎯 选择要总结的表格：</label>
                            </div>
                            <button type="button" id="gg_sum_open_table_selector" style="width:100%;padding:12px;background:${UI.c};color:${UI.tc};border:1px solid rgba(0,0,0,.1);border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">
                                <span style="pointer-events:none;" id="gg_sum_table_selector_text">${selectionText}</span>
                            </button>
                            <div style="font-size:9px;color:${UI.tc};opacity:.6;margin-top:6px;">💡 默认全选所有表格，可手动勾选需要参与总结的表格</div>
                        </div>
                        <button id="gg_sum_table-snap" style="width:100%;padding:10px;background:${window.Gaigai.isTableSummaryRunning ? '#999' : '#4caf50'};color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:13px;box-shadow:0 2px 5px rgba(0,0,0,.15);opacity:${window.Gaigai.isTableSummaryRunning ? '.7' : '1'};" ${window.Gaigai.isTableSummaryRunning ? 'disabled' : ''}>
                            ${window.Gaigai.isTableSummaryRunning ? '⏳ 正在执行... (后台运行中)' : '🚀 开始表格总结'}
                        </button>
                        <div id="gg_summary_status" style="text-align:center;margin-top:8px;font-size:11px;color:${UI.tc};opacity:.8;min-height:16px;"></div>
                    </div>
                </div>`;

            window.Gaigai.pop('🤖 总结控制台', html, true);
            this._bindUIEvents(totalCount);
        }

        _bindUIEvents(totalCount) {
            const C = window.Gaigai.config_obj;
            const API_CONFIG = window.Gaigai.config;
            const m = window.Gaigai.m;
            $('#gg_save_sum_pointer_btn').off('click').on('click', async function () {
                const requested = Number.parseInt($('#gg_edit_sum_pointer').val(), 10);
                const corrected = Math.max(0, Math.min(totalCount, Number.isFinite(requested) ? requested : 0));
                API_CONFIG.lastSummaryIndex = corrected;
                API_CONFIG.summarySource = 'table';
                $('#gg_edit_sum_pointer').val(corrected);
                localStorage.setItem('gg_api', JSON.stringify(API_CONFIG));
                await m.save(false, true);
                await window.Gaigai.customAlert(`表格总结指针已修正为 ${corrected} / ${totalCount} 层。`, '进度已保存');
            });
            $('#gg_open_config_link').off('click').on('click', function (event) {
                event.preventDefault();
                if (typeof window.Gaigai.navTo === 'function' && typeof window.Gaigai.shcf === 'function') {
                    window.Gaigai.navTo('配置', window.Gaigai.shcf);
                }
            });
            $('#gg_sum_open_table_selector').off('click').on('click', openTableSelector);
            $('#gg_sum_table-snap').off('click').on('click', async () => {
                const selected = getSelectedTableIndices();
                if (!selected.length) {
                    await window.Gaigai.customAlert('请至少选择一个有内容的记忆表格。', '提示');
                    return;
                }
                const action = normalizeRowAction(C.summaryRowAction);
                const silent = C.autoSummarySilent === true;
                window.Gaigai.isTableSummaryRunning = true;
                $('#gg_sum_table-snap').text('⏳ AI正在阅读...').prop('disabled', true).css('opacity', .7);
                try {
                    await this.callAIForSummary(null, null, 'table', silent, false, false, selected, false, false, action);
                } finally {
                    window.Gaigai.isTableSummaryRunning = false;
                    $('#gg_sum_table-snap').text('🚀 开始表格总结').prop('disabled', false).css('opacity', 1);
                }
            });
        }

        async callAIForSummary(_forceStart = null, _forceEnd = null, _forcedMode = 'table', isSilent = false, _isBatch = false, _skipSave = false, targetTableIndices = null, _skipWorldInfoSync = false, _useRawRange = false, rowAction = null) {
            const loadConfig = window.Gaigai.loadConfig || (() => Promise.resolve());
            await loadConfig();

            const m = window.Gaigai.m;
            const C = window.Gaigai.config_obj;
            const API_CONFIG = window.Gaigai.config;
            const initialSessionId = m.gid();
            m.load();

            const selected = Array.isArray(targetTableIndices) && targetTableIndices.length > 0
                ? targetTableIndices
                : (Array.isArray(C.autoSummaryTargetTables) && C.autoSummaryTargetTables.length > 0
                    ? C.autoSummaryTargetTables
                    : getSelectedTableIndices());
            const sources = captureSummarySources(selected);
            if (!sources.length) {
                if (!isSilent) await window.Gaigai.customAlert('所选表格没有可总结的白色行。', '无新内容');
                return { success: false, error: '没有可总结的表格行' };
            }

            const ctx = m.ctx() || {};
            const promptManager = window.Gaigai.PromptManager;
            const rawPrompt = promptManager?.get('summaryPromptTable') || '请总结以下记忆表格。';
            const targetPrompt = promptManager?.resolveVariables
                ? promptManager.resolveVariables(rawPrompt, ctx)
                : rawPrompt;
            const nsfwPrompt = promptManager?.get('nsfwPrompt') || '';
            const messages = [];
            if (nsfwPrompt.trim()) {
                messages.push({
                    role: 'system',
                    content: promptManager?.resolveVariables ? promptManager.resolveVariables(nsfwPrompt, ctx) : nsfwPrompt
                });
            }
            for (const source of sources) {
                const sheet = m.get(source.tableIndex);
                messages.push({
                    role: 'system',
                    name: `SYSTEM (${source.name})`,
                    content: `【待总结的表格 - ${source.name}】\n${sheet.txt(source.tableIndex)}`,
                    isGaigaiData: true
                });
            }
            messages.push({ role: 'user', content: targetPrompt });

            window.Gaigai.lastRequestData = {
                chat: JSON.parse(JSON.stringify(messages)),
                timestamp: Date.now(),
                model: API_CONFIG.model || 'Unknown'
            };
            window.isSummarizing = true;

            let result;
            try {
                result = API_CONFIG.useIndependentAPI
                    ? await window.Gaigai.tools.callIndependentAPI(messages)
                    : await window.Gaigai.tools.callTavernAPI(messages);
            } catch (error) {
                window.isSummarizing = false;
                console.error('❌ [表格总结] API 请求失败:', error);
                if (!isSilent) await window.Gaigai.customAlert(`API 请求失败：${error.message}`, '总结失败');
                return { success: false, error: error.message };
            }

            if (m.gid() !== initialSessionId) {
                window.isSummarizing = false;
                return { success: false, error: '会话已切换，取消写入' };
            }
            if (!result?.success || !result.summary) {
                window.isSummarizing = false;
                if (!isSilent) await window.Gaigai.customAlert('总结模型没有返回有效正文。', '总结失败');
                return { success: false, error: result?.error || '总结为空' };
            }

            const summary = cleanSummaryOutput(result.summary);
            if (summary.length < 10) {
                window.isSummarizing = false;
                if (!isSilent) await window.Gaigai.customAlert('总结内容过短，未写入。', '总结失败');
                return { success: false, error: '总结内容过短' };
            }

            const normalizedAction = normalizeRowAction(rowAction || C.summaryRowAction);
            let finalSummary = summary;
            let note = '';
            let finalAction = normalizedAction;
            if (!isSilent) {
                const preview = await this.showSummaryPreview(summary);
                if (!preview) {
                    window.isSummarizing = false;
                    return { success: false, error: '用户取消保存' };
                }
                if (preview.regenerate) {
                    window.isSummarizing = false;
                    return this.callAIForSummary(
                        _forceStart,
                        _forceEnd,
                        _forcedMode,
                        false,
                        _isBatch,
                        _skipSave,
                        selected,
                        _skipWorldInfoSync,
                        _useRawRange,
                        normalizedAction
                    );
                }
                finalSummary = preview.summary;
                note = preview.note;
            }

            m.sm.save(finalSummary, note);
            if (!isSilent) {
                finalAction = await this.showSourceRowActionDialog(normalizedAction);
            }
            await applySourceRowAction(sources, finalAction);
            persistSummaryState();

            try {
                const vectorResult = await syncSummaryVectors();
                if (vectorResult && vectorResult.success === false) {
                    throw new Error(vectorResult.error || '向量同步失败');
                }
                if (C.autoVectorizeSummary && vectorResult?.success === true) {
                    const archivedCount = archiveSummaryRowsAfterVectorization();
                    if (archivedCount > 0) {
                        persistSummaryState();
                        console.log(`⚡ [自动向量化] 已归档隐藏记忆总结表 ${archivedCount} 行`);
                    }
                }
            } catch (error) {
                console.error('❌ [表格总结] 总结已保存，但向量同步失败:', error);
                if (typeof toastr !== 'undefined') toastr.warning(error.message, '总结已保存，向量化失败');
            }

            window.isSummarizing = false;
            if (typeof toastr !== 'undefined') toastr.success('记忆表格总结已保存', '总结完成');
            return { success: true, summary: finalSummary, rowAction: finalAction };
        }

        showSummaryPreview(summaryText) {
            return new Promise(resolve => {
                const UI = window.Gaigai.ui;
                const m = window.Gaigai.m;
                const initialSessionId = m.gid();
                const content = `
                    <div class="g-p" style="display:flex;flex-direction:column;height:100%;min-height:0;">
                        <h4 style="margin:0 0 8px 0;">📝 记忆总结预览</h4>
                        <p style="opacity:.8;font-size:11px;margin:0 0 10px 0;flex-shrink:0;">
                            ✅ 已生成总结建议<br>
                            💡 您可以直接编辑润色内容，满意后点击保存
                        </p>
                        <textarea id="gg_summary_editor" style="flex:1;width:100%;min-height:0;padding:10px;border-radius:4px;font-size:12px;font-family:inherit;resize:none;line-height:1.8;margin-bottom:10px;">${window.Gaigai.esc(summaryText)}</textarea>
                        <div style="margin-bottom:10px;flex-shrink:0;">
                            <label for="gg_summary_note" style="display:block;font-size:12px;opacity:.8;margin-bottom:4px;">📌 备注：</label>
                            <input type="text" id="gg_summary_note" placeholder="可选，不进入向量" style="width:100%;padding:8px;border-radius:4px;font-size:12px;">
                        </div>
                        <div style="display:flex;gap:10px;flex-shrink:0;">
                            <button id="gg_cancel_summary" style="padding:8px 16px;background:#6c757d;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;flex:1;">🚫 放弃</button>
                            <button id="gg_regen_summary" style="padding:8px 16px;background:#17a2b8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;flex:1;">🔄 重新生成</button>
                            <button id="gg_save_summary" style="padding:8px 16px;background:#28a745;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;flex:2;font-weight:bold;">✅ 保存总结</button>
                        </div>
                    </div>`;

                $('#gai-summary-pop').remove();
                const overlay = $('<div>', { id: 'gai-summary-pop', class: 'g-ov', css: { zIndex: 10000010 } });
                const panel = $('<div>', {
                    class: 'g-w',
                    css: { width: '700px', maxWidth: '92vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }
                });
                const header = $('<div>', { class: 'g-hd', css: { flexShrink: 0 } });
                header.append(`<h3 style="color:${UI.tc};flex:1;">📝 记忆总结</h3>`);
                const close = $('<button>', {
                    class: 'g-x', text: '×',
                    css: { background: 'none', border: 'none', color: UI.tc, cursor: 'pointer', fontSize: '22px' }
                });
                const body = $('<div>', {
                    class: 'g-bd', html: content,
                    css: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '10px' }
                });

                const cleanup = result => {
                    overlay.remove();
                    resolve(result);
                };
                close.on('click', () => cleanup(null));
                header.append(close);
                panel.append(header, body);
                overlay.append(panel);
                $('body').append(overlay);

                $('#gg_cancel_summary').on('click', () => cleanup(null));
                $('#gg_regen_summary').on('click', () => cleanup({ regenerate: true }));
                $('#gg_save_summary').on('click', async () => {
                    const summary = String($('#gg_summary_editor').val() || '').trim();
                    if (!summary) {
                        await window.Gaigai.customAlert('总结内容不能为空', '提示');
                        return;
                    }
                    if (!initialSessionId || m.gid() !== initialSessionId) {
                        await window.Gaigai.customAlert('检测到会话已经切换，已取消保存。请在当前会话重新执行总结。', '安全拦截');
                        return;
                    }
                    cleanup({
                        summary,
                        note: String($('#gg_summary_note').val() || '').trim()
                    });
                });
                setTimeout(() => $('#gg_summary_editor').trigger('focus'), 100);
            });
        }

        showSourceRowActionDialog(defaultAction = 'hide') {
            return new Promise(resolve => {
                const UI = window.Gaigai.ui;
                const isDark = !!UI.darkMode;
                const textColor = UI.tc;
                const dialogId = `summary-action-${Date.now()}`;
                const overlay = $('<div>', {
                    id: dialogId,
                    css: {
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        width: '100vw', height: '100dvh',
                        background: 'rgba(0,0,0,.6)', zIndex: 10000020,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 'max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom))'
                    }
                });
                const box = $('<div>', {
                    class: 'summary-action-box',
                    css: {
                        background: isDark ? '#1e1e1e' : '#fff', color: textColor,
                        border: isDark ? '1px solid rgba(255,255,255,.1)' : 'none',
                        borderRadius: '12px', padding: '24px',
                        boxShadow: '0 10px 40px rgba(0,0,0,.4)',
                        width: '90%', maxWidth: '420px', maxHeight: '100%', overflow: 'auto',
                        display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'center'
                    }
                });
                box.append('<div style="font-size:18px;margin-bottom:8px;color:var(--g-tc);">🎉 总结已保存！</div>');
                box.append('<div style="font-size:13px;opacity:.8;margin-bottom:12px;color:var(--g-tc);">请选择如何处理<strong>原始表格数据</strong>：</div>');

                const buttonContainer = $('<div>').css({ display: 'flex', gap: '10px', width: '100%', flexWrap: 'wrap' });
                const buttonStyle = {
                    flex: 1, minWidth: 0, padding: '12px 8px', borderRadius: '8px',
                    cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
                    transition: 'all .2s', textAlign: 'center', lineHeight: 1.4,
                    border: 'none', outline: 'none'
                };
                const finish = action => {
                    overlay.remove();
                    resolve(normalizeRowAction(action));
                };
                const deleteButton = $('<button>', {
                    class: 'summary-action-btn summary-action-delete',
                    html: '🗑️ 删除源行<br><span style="font-size:10px;font-weight:normal;opacity:.8;color:inherit;">(从源表移除)</span>',
                    css: {
                        ...buttonStyle,
                        background: isDark ? 'rgba(220,53,69,.2)' : 'rgba(220,53,69,.1)',
                        color: textColor, border: `1px solid ${isDark ? '#ff6b6b' : '#dc3545'}`
                    }
                }).on('click', () => finish('delete'));
                const hideButton = $('<button>', {
                    class: 'summary-action-btn summary-action-hide',
                    html: '🙈 仅隐藏<br><span style="font-size:10px;font-weight:normal;opacity:.8;color:inherit;">(标记已处理)</span>',
                    css: {
                        ...buttonStyle,
                        background: isDark ? 'rgba(40,167,69,.2)' : 'rgba(40,167,69,.1)',
                        color: textColor, border: `1px solid ${isDark ? '#51cf66' : '#28a745'}`
                    }
                }).on('click', () => finish('hide'));
                const keepButton = $('<button>', {
                    class: 'summary-action-btn summary-action-keep',
                    html: '👁️ 保留<br><span style="font-size:10px;font-weight:normal;opacity:.8;color:inherit;">(不做修改)</span>',
                    css: {
                        ...buttonStyle,
                        background: isDark ? 'rgba(108,117,125,.2)' : 'rgba(108,117,125,.1)',
                        color: textColor, border: `1px solid ${isDark ? 'rgba(108,117,125,.5)' : '#6c757d'}`
                    }
                }).on('click', () => finish('keep'));

                buttonContainer.append(deleteButton, hideButton, keepButton);
                box.append(buttonContainer);
                overlay.append(box);
                $('body').append(overlay);

                const preferred = normalizeRowAction(defaultAction);
                box.find(`.summary-action-${preferred}`).trigger('focus');
            });
        }
    }

    window.Gaigai.SummaryManager = new SummaryManager();
    console.log('✅ [SummaryManager] 已挂载到 window.Gaigai.SummaryManager');
})();
