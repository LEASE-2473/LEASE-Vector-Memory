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
        if (!active.includes(bookId)) vm.setActiveBooks([...active, bookId]);

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

    function coldRowsHtml() {
        const rows = collectColdEntries();
        if (!rows.length) return '<div style="padding:20px;text-align:center;opacity:.65;">暂无绿色冷记忆</div>';
        return rows.map(entry => `
            <div class="lvm-cold-card" data-entry="${entry.entryId}" style="padding:10px;border:1px solid rgba(127,127,127,.25);border-radius:7px;margin-bottom:8px;">
                <div style="display:flex;gap:8px;align-items:center;"><strong>${LVM.esc(entry.tableName)} · ${entry.rowId}</strong><span style="font-size:10px;opacity:.6;">${LVM.esc(sourceText({ sources: entry.sources }))}</span><button class="lvm-restore-hot" data-ti="${entry.tableIndex}" data-id="${entry.rowId}" style="margin-left:auto;">恢复白色</button></div>
                <div style="font-size:11px;white-space:pre-wrap;margin-top:6px;opacity:.85;">${LVM.esc(entry.text)}</div>
            </div>`).join('');
    }

    function policyHtml() {
        return (LVM.m?.all?.() || []).map((sheet, tableIndex) => {
            const policy = LVM.config_obj.coldPolicies?.[tableIndex] || { enabled: tableIndex < 2, keep: 3 };
            return `<label style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:5px 0;"><span>${LVM.esc(sheet.n)}</span><input class="lvm-policy-on" data-ti="${tableIndex}" type="checkbox" ${policy.enabled ? 'checked' : ''}><input class="lvm-policy-keep" data-ti="${tableIndex}" type="number" min="1" value="${policy.keep}" style="width:56px;"></label>`;
        }).join('');
    }

    function showVectorMemoryUI() {
        const html = `
            <div style="display:flex;gap:8px;margin-bottom:10px;"><button id="lvm-tab-cold" style="flex:1;">🟢 冷记忆库</button><button id="lvm-tab-books" style="flex:1;">📚 外部知识书</button></div>
            <div style="display:grid;grid-template-columns:minmax(220px,32%) 1fr;gap:12px;min-height:55vh;">
                <div style="padding:10px;border:1px solid rgba(127,127,127,.25);border-radius:8px;overflow:auto;"><h4>逐表自动降冷</h4>${policyHtml()}<button id="lvm-apply-policies" style="width:100%;margin-top:8px;">立即按各表 X 整理</button><div style="font-size:10px;opacity:.65;margin-top:8px;">绿色只在向量成功后生效；锁定行不参与自动降冷。</div></div>
                <div style="overflow:auto;"><div style="display:flex;gap:8px;margin-bottom:8px;"><input id="lvm-cold-search" placeholder="搜索表名、R编号或内容" style="flex:1;"><button id="lvm-retry-cold">重试同步</button></div><div id="lvm-cold-list">${coldRowsHtml()}</div></div>
            </div>`;
        LVM.pop('💠 向量记忆区', html, true);

        $('#lvm-tab-books').off('click').on('click', () => LVM.VM?.showUI?.());
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
        $('.lvm-restore-hot').off('click').on('click', async function () {
            await setRowCold(Number($(this).data('ti')), String($(this).data('id')), false);
            showVectorMemoryUI();
        });
        $('#lvm-cold-search').off('input').on('input', function () {
            const query = String($(this).val() || '').toLowerCase();
            $('.lvm-cold-card').each(function () { $(this).toggle(!query || $(this).text().toLowerCase().includes(query)); });
        });
    }

    Object.assign(LVM, {
        collectColdEntries,
        rebuildColdIndexCache,
        syncColdBook,
        setRowCold,
        setRowLocked,
        reconcileColdRows,
        queueColdReconcile,
        showVectorMemoryUI,
        getColdBookId
    });

    console.log('✅ [MemoryLifecycle] 行级冷热生命周期已加载');
    setTimeout(() => {
        rebuildColdIndexCache();
        syncColdBook(false).catch(error => console.warn('⚠️ [冷记忆库] 启动同步失败:', error));
    }, 1000);
})();
