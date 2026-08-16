/**
 * LEASE Vector Memory - 行级冷热生命周期与冷记忆主界面
 */
(function () {
    'use strict';

    const LVM = window.LeaseVectorMemory = window.LeaseVectorMemory || {};
    let reconcileTimer = null;

    function hash(value) {
        const text = String(value || 'default');
        let result = 2166136261;
        for (let index = 0; index < text.length; index++) {
            result ^= text.charCodeAt(index);
            result = Math.imul(result, 16777619);
        }
        return (result >>> 0).toString(36);
    }

    function getSessionId() {
        return LVM.m?.gid?.() || 'default';
    }

    function getColdBookId() {
        return `lvm_cold_${hash(getSessionId())}`;
    }

    function ensureMeta(sheet, row) {
        return sheet._ensureMeta(row).__lvm;
    }

    function sourceText(meta) {
        return (meta.sources || []).map(range => `${range.start}-${range.end}`).join('、') || '手工/迁移';
    }

    function serializeRow(tableIndex, sheet, row) {
        const meta = ensureMeta(sheet, row);
        const fields = sheet.c.map((column, columnIndex) => {
            const name = String(column || `列${columnIndex}`).replace(/^#/, '');
            const value = row[columnIndex] == null ? '' : String(row[columnIndex]).trim();
            return value ? `${name}：${value}` : '';
        }).filter(Boolean);
        return `[${sheet.n}] [${meta.id}]\n${fields.join('\n')}\n来源楼层：${sourceText(meta)}`;
    }

    function collectColdEntries() {
        const entries = [];
        (LVM.m?.all?.() || []).forEach((sheet, tableIndex) => {
            sheet.r.forEach(row => {
                const meta = ensureMeta(sheet, row);
                if (!meta.cold) return;
                entries.push({
                    entryId: `${tableIndex}:${meta.id}`,
                    tableIndex,
                    tableName: sheet.n,
                    rowId: meta.id,
                    sources: meta.sources,
                    text: serializeRow(tableIndex, sheet, row)
                });
            });
        });
        return entries;
    }

    function rebuildColdIndexCache() {
        const cold = {};
        (LVM.m?.all?.() || []).forEach((sheet, tableIndex) => {
            sheet.r.forEach((row, rowIndex) => {
                if (!ensureMeta(sheet, row).cold) return;
                if (!cold[tableIndex]) cold[tableIndex] = [];
                cold[tableIndex].push(rowIndex);
            });
        });
        LVM.summarizedRows = cold;
        return cold;
    }

    async function syncColdBook(autoVectorize = false) {
        const vm = LVM.VM;
        if (!vm || !vm.isDataLoaded) return { success: false, error: '向量库尚未加载' };

        const bookId = getColdBookId();
        const entries = collectColdEntries();
        const existed = Boolean(vm.library[bookId]);
        const oldBook = vm.library[bookId] || {};
        const cache = Object.assign({}, oldBook.cache || {});
        (oldBook.entries || []).forEach((entry, index) => {
            if (oldBook.vectorized?.[index] && oldBook.vectors?.[index]) {
                cache[entry.entryId] = { text: entry.text, vector: oldBook.vectors[index] };
            }
        });

        const vectors = [];
        const vectorized = [];
        entries.forEach(entry => {
            const cached = cache[entry.entryId];
            if (cached && cached.text === entry.text && Array.isArray(cached.vector)) {
                vectors.push(cached.vector);
                vectorized.push(true);
            } else {
                vectors.push(null);
                vectorized.push(false);
            }
        });

        vm.library[bookId] = {
            name: '《冷记忆库》',
            type: 'cold_memory',
            system: true,
            sessionId: getSessionId(),
            entries,
            chunks: entries.map(entry => entry.text),
            vectors,
            vectorized,
            cache,
            createTime: oldBook.createTime || Date.now()
        };
        vm.saveLibrary();

        const active = vm.getActiveBooks();
        // 首次建立当前聊天冷记忆书时默认启用；用户在“知识书管理”中关闭后尊重该选择。
        if (!existed && !active.includes(bookId)) vm.setActiveBooks([...active, bookId]);

        if (autoVectorize && vectorized.includes(false)) {
            const result = await vm.vectorizeBook(bookId);
            if (!result?.success || (result.errors || 0) > 0) {
                return { success: false, bookId, entries, result, error: result?.lastError || '部分冷行向量化失败' };
            }
        }
        return { success: true, bookId, entries, book: vm.library[bookId] };
    }

    function findRow(tableIndex, rowId) {
        const sheet = LVM.m?.get?.(tableIndex);
        if (!sheet) return null;
        const rowIndex = sheet.indexOfId(rowId);
        if (rowIndex < 0) return null;
        return { sheet, row: sheet.r[rowIndex], rowIndex, meta: ensureMeta(sheet, sheet.r[rowIndex]) };
    }

    async function setRowCold(tableIndex, rowId, cold) {
        const found = findRow(tableIndex, rowId);
        if (!found) return { success: false, error: `${rowId} 不存在` };
        if (cold && !LVM.config_obj?.vectorEnabled) return { success: false, error: '向量功能已关闭；关闭时所有表格行都保持白色并直接注入' };
        if (cold && found.meta.locked) return { success: false, error: `${rowId} 是锁定热行，请先取消锁定` };

        if (!cold) {
            found.meta.cold = false;
            rebuildColdIndexCache();
            await syncColdBook(false);
            LVM.m.save(false, true);
            return { success: true, cold: false };
        }

        found.meta.cold = true;
        rebuildColdIndexCache();
        const result = await syncColdBook(true);
        const book = LVM.VM?.library?.[result.bookId || getColdBookId()];
        const entryIndex = book?.entries?.findIndex(entry => entry.entryId === `${tableIndex}:${rowId}`) ?? -1;
        const ready = result.success && entryIndex >= 0 && book.vectorized?.[entryIndex] && book.vectors?.[entryIndex];
        if (!ready) {
            found.meta.cold = false;
            rebuildColdIndexCache();
            await syncColdBook(false);
            LVM.m.save(false, true);
            return { success: false, error: result.error || `${rowId} 向量化失败，已保持白色` };
        }

        LVM.m.save(false, true);
        return { success: true, cold: true };
    }

    async function setRowLocked(tableIndex, rowId, locked) {
        const found = findRow(tableIndex, rowId);
        if (!found) return { success: false, error: `${rowId} 不存在` };
        found.meta.locked = locked === true;
        if (found.meta.locked && found.meta.cold) {
            found.meta.cold = false;
            rebuildColdIndexCache();
            await syncColdBook(false);
        }
        LVM.m.save(false, true);
        return { success: true, locked: found.meta.locked };
    }

    async function reconcileColdRows() {
        const config = LVM.config_obj || {};
        if (!config.vectorEnabled) return { success: true, changed: 0, failed: 0, skipped: '向量功能已关闭' };
        const changed = [];
        const tables = LVM.m?.all?.() || [];
        for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
            const policy = config.coldPolicies?.[tableIndex];
            if (!policy?.enabled) continue;
            const sheet = tables[tableIndex];
            const eligible = sheet.r.filter(row => !ensureMeta(sheet, row).locked);
            const keep = Math.max(1, Number.parseInt(policy.keep, 10) || 3);
            const candidates = eligible.slice(0, Math.max(0, eligible.length - keep));
            for (const row of candidates) {
                const meta = ensureMeta(sheet, row);
                if (!meta.cold) {
                    meta.cold = true;
                    changed.push({ tableIndex, rowId: meta.id });
                }
            }
        }

        if (changed.length === 0) {
            rebuildColdIndexCache();
            return { success: true, changed: 0 };
        }

        rebuildColdIndexCache();
        const result = await syncColdBook(true);
        const book = LVM.VM?.library?.[result.bookId || getColdBookId()];
        let successCount = 0;
        changed.forEach(item => {
            const entryIndex = book?.entries?.findIndex(entry => entry.entryId === `${item.tableIndex}:${item.rowId}`) ?? -1;
            const ready = entryIndex >= 0 && book.vectorized?.[entryIndex] && book.vectors?.[entryIndex];
            const found = findRow(item.tableIndex, item.rowId);
            if (ready) successCount++;
            else if (found) found.meta.cold = false;
        });

        rebuildColdIndexCache();
        if (successCount !== changed.length) await syncColdBook(false);
        LVM.m.save(false, true);
        if (typeof LVM.updateCurrentSnapshot === 'function') LVM.updateCurrentSnapshot();
        if ($('#gai-main-pop').length && typeof LVM.shw === 'function') LVM.shw();
        return { success: successCount === changed.length, changed: successCount, failed: changed.length - successCount };
    }

    function queueColdReconcile() {
        if (reconcileTimer) clearTimeout(reconcileTimer);
        reconcileTimer = setTimeout(() => reconcileColdRows().catch(error => {
            console.error('❌ [冷热整理] 执行失败:', error);
        }), 250);
    }

    async function restoreAllColdRows() {
        let restored = 0;
        (LVM.m?.all?.() || []).forEach(sheet => {
            sheet.r.forEach(row => {
                const meta = ensureMeta(sheet, row);
                if (meta.cold) {
                    meta.cold = false;
                    restored++;
                }
            });
        });
        rebuildColdIndexCache();
        await syncColdBook(false);
        LVM.m?.save?.(false, true);
        return { success: true, restored };
    }

    function currentRowsHtml() {
        const cards = [];
        (LVM.m?.all?.() || []).forEach((sheet, tableIndex) => {
            sheet.r.forEach(row => {
                const meta = ensureMeta(sheet, row);
                const status = meta.locked ? 'locked' : (meta.cold ? 'cold' : 'hot');
                const statusText = meta.locked ? '🔒 锁定热行' : (meta.cold ? '🟢 冷记忆' : '⚪ 热记忆');
                const preview = serializeRow(tableIndex, sheet, row);
                cards.push(`
                    <div class="lvm-memory-card lvm-memory-${status}" data-status="${status}" data-search="${LVM.esc(`${sheet.n} ${meta.id} ${preview}`.toLowerCase())}">
                        <div class="lvm-memory-card-head">
                            <strong>${LVM.esc(sheet.n)} · ${meta.id}</strong>
                            <span class="lvm-memory-status">${statusText}</span>
                            <span class="lvm-memory-source">来源 ${LVM.esc(sourceText(meta))}</span>
                        </div>
                        <div class="lvm-memory-preview">${LVM.esc(preview)}</div>
                        <div class="lvm-memory-actions">
                            <button class="lvm-row-cold" data-ti="${tableIndex}" data-id="${meta.id}" data-cold="${meta.cold}" ${meta.locked ? 'disabled title="请先取消锁定"' : ''}>${meta.cold ? '恢复为白色热行' : '向量化并转为绿色冷行'}</button>
                            <button class="lvm-row-lock" data-ti="${tableIndex}" data-id="${meta.id}" data-locked="${meta.locked}">${meta.locked ? '取消锁定' : '锁定为热行'}</button>
                        </div>
                    </div>`);
            });
        });
        return cards.join('') || '<div class="lvm-memory-empty">当前聊天八张表均无数据。新增或导入表格行后，可在这里管理冷热与锁定。</div>';
    }

    function policyHtml() {
        return (LVM.m?.all?.() || []).map((sheet, tableIndex) => {
            const policy = LVM.config_obj.coldPolicies?.[tableIndex] || { enabled: tableIndex < 2, keep: 3 };
            return `<label style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:5px 0;"><span>${LVM.esc(sheet.n)}</span><input class="lvm-policy-on" data-ti="${tableIndex}" type="checkbox" ${policy.enabled ? 'checked' : ''}><input class="lvm-policy-keep" data-ti="${tableIndex}" type="number" min="1" value="${policy.keep}" style="width:56px;"></label>`;
        }).join('');
    }

    function vectorTabs(active) {
        return `<div class="lvm-vector-tabs">
            <button class="${active === 'memory' ? 'active' : ''}" id="lvm-tab-memory">🧠 当前聊天记忆库</button>
            <button class="${active === 'api' ? 'active' : ''}" id="lvm-tab-api">🔌 API 设置</button>
            <button class="${active === 'books' ? 'active' : ''}" id="lvm-tab-books">📚 知识书管理</button>
        </div>`;
    }

    function showVectorMemoryUI() {
        const html = `
            ${vectorTabs('memory')}
            <div class="lvm-current-memory-layout">
                <div class="lvm-policy-panel"><h4>逐表自动降冷</h4>${policyHtml()}<button id="lvm-apply-policies" style="width:100%;margin-top:8px;">立即按各表 X 整理</button><div class="lvm-help-note">关闭某表的自动降冷后，该表白行继续按原记忆表格方式直接注入。绿色只在 Embedding 成功后生效；锁定行不参与自动降冷。</div></div>
                <div class="lvm-current-memory-list"><div class="lvm-memory-toolbar"><input id="lvm-memory-search" placeholder="搜索表名、R 编号或内容"><select id="lvm-memory-filter"><option value="all">全部状态</option><option value="hot">⚪ 热记忆</option><option value="cold">🟢 冷记忆</option><option value="locked">🔒 锁定热行</option></select><button id="lvm-retry-cold">重试冷记忆向量</button></div><div id="lvm-memory-list">${currentRowsHtml()}</div></div>
            </div>`;
        LVM.pop('💠 向量记忆区', html, true);

        $('#lvm-tab-api').off('click').on('click', () => LVM.VM?.showUI?.('api'));
        $('#lvm-tab-books').off('click').on('click', () => LVM.VM?.showUI?.('books'));
        $('#lvm-apply-policies').off('click').on('click', async () => {
            $('.lvm-policy-on').each(function () {
                const ti = Number($(this).data('ti'));
                LVM.config_obj.coldPolicies[ti] = LVM.config_obj.coldPolicies[ti] || {};
                LVM.config_obj.coldPolicies[ti].enabled = $(this).is(':checked');
            });
            $('.lvm-policy-keep').each(function () {
                const ti = Number($(this).data('ti'));
                LVM.config_obj.coldPolicies[ti] = LVM.config_obj.coldPolicies[ti] || {};
                LVM.config_obj.coldPolicies[ti].keep = Math.max(1, Number.parseInt($(this).val(), 10) || 3);
            });
            localStorage.setItem('lvm_config', JSON.stringify(LVM.config_obj));
            const result = await reconcileColdRows();
            if (typeof toastr !== 'undefined') toastr[result.success ? 'success' : 'warning'](`转冷 ${result.changed || 0} 行，失败 ${result.failed || 0} 行`, '冷热整理');
            showVectorMemoryUI();
        });
        $('#lvm-retry-cold').off('click').on('click', async () => { await syncColdBook(true); showVectorMemoryUI(); });
        $('.lvm-row-cold').off('click').on('click', async function () {
            const cold = String($(this).data('cold')) === 'true';
            const result = await setRowCold(Number($(this).data('ti')), String($(this).data('id')), !cold);
            if (!result.success) await (LVM.customAlert || alert)(`转冷失败，行仍保持白色：${result.error}`, '向量化失败');
            showVectorMemoryUI();
        });
        $('.lvm-row-lock').off('click').on('click', async function () {
            const locked = String($(this).data('locked')) === 'true';
            await setRowLocked(Number($(this).data('ti')), String($(this).data('id')), !locked);
            showVectorMemoryUI();
        });
        const applyFilter = () => {
            const query = String($('#lvm-memory-search').val() || '').toLowerCase();
            const status = String($('#lvm-memory-filter').val() || 'all');
            $('.lvm-memory-card').each(function () {
                const matchText = !query || String($(this).data('search') || '').includes(query);
                const matchStatus = status === 'all' || String($(this).data('status')) === status;
                $(this).toggle(matchText && matchStatus);
            });
        };
        $('#lvm-memory-search').off('input').on('input', applyFilter);
        $('#lvm-memory-filter').off('change').on('change', applyFilter);
    }

    Object.assign(LVM, {
        collectColdEntries,
        rebuildColdIndexCache,
        syncColdBook,
        setRowCold,
        setRowLocked,
        reconcileColdRows,
        queueColdReconcile,
        restoreAllColdRows,
        showVectorMemoryUI,
        vectorTabs,
        getColdBookId
    });

    console.log('✅ [MemoryLifecycle] 行级冷热生命周期已加载');
    setTimeout(() => {
        rebuildColdIndexCache();
        syncColdBook(false).catch(error => console.warn('⚠️ [冷记忆库] 启动同步失败:', error));
    }, 1000);
})();
