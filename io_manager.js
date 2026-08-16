/** LEASE Vector Memory - v2 表格导入、导出与旧版显式迁移 */
(function () {
    'use strict';
    const LVM = window.LeaseVectorMemory = window.LeaseVectorMemory || {};

    class IOManager {
        exportData(sheets, filename, format = 'json') {
            const payload = { product: 'LEASE Vector Memory', schemaVersion: 2, pluginId: 'lease_vector_memory', exportedAt: new Date().toISOString(), sheets: sheets.map(sheet => sheet.json()) };
            const text = format === 'txt' ? this.toText(payload.sheets) : JSON.stringify(payload, null, 2);
            const extension = format === 'txt' ? '.txt' : '.json';
            const blob = new Blob([text], { type: format === 'txt' ? 'text/plain' : 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = String(filename).replace(/\.(json|txt)$/i, '') + extension;
            link.click();
            URL.revokeObjectURL(link.href);
        }

        toText(sheets) {
            return sheets.map((sheet, tableIndex) => {
                const lines = [`=== ${sheet.n} (表索引: ${tableIndex}) ===`];
                (sheet.r || []).forEach((stored, rowIndex) => {
                    const cells = Array.isArray(stored?.cells) ? stored.cells : stored;
                    const meta = stored?.meta || {};
                    const pairs = (sheet.c || []).map((column, columnIndex) => {
                        const value = String(cells?.[columnIndex] || '').replace(/\n/g, '\\n').replace(/\|/g, '{{PIPE}}');
                        return value ? `${column}: ${value}` : '';
                    }).filter(Boolean);
                    lines.push(`[${meta.id || `R${rowIndex + 1}`}] ${pairs.join(' | ')}`);
                });
                return lines.join('\n');
            }).join('\n\n');
        }

        parseText(text) {
            const sheets = [];
            let current = null;
            String(text).split(/\r?\n/).forEach(line => {
                const header = line.match(/^===\s*(.+?)\s*\(表索引:\s*(\d+)\)\s*===$/);
                if (header) {
                    current = { n: header[1].trim(), c: [], r: [] };
                    sheets[Number(header[2])] = current;
                    return;
                }
                if (!current) return;
                const rowMatch = line.match(/^\[(R\d+|\d+)\]\s*(.*)$/i);
                if (!rowMatch) return;
                const values = new Map();
                rowMatch[2].split('|').forEach(pair => {
                    const splitAt = pair.indexOf(':');
                    if (splitAt < 0) return;
                    const key = pair.slice(0, splitAt).trim();
                    const value = pair.slice(splitAt + 1).trim().replace(/\\n/g, '\n').replace(/\{\{PIPE\}\}/g, '|');
                    if (!current.c.includes(key)) current.c.push(key);
                    values.set(key, value);
                });
                const cells = current.c.map(column => values.get(column) || '');
                current.r.push({ cells, meta: { id: /^R/i.test(rowMatch[1]) ? rowMatch[1].toUpperCase() : undefined } });
            });
            return { schemaVersion: 2, sheets: sheets.filter(Boolean) };
        }

        async handleImport(file) {
            const content = await file.text();
            const trimmed = content.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(content);
            if (trimmed.includes('表索引')) return this.parseText(content);
            throw new Error('无法识别的导入格式');
        }

        normalizeSheets(data) {
            const raw = Array.isArray(data) ? data : (data?.sheets || data?.s || data?.d);
            if (!Array.isArray(raw)) throw new Error('文件中没有表格数组');
            let ignoredSummary = false;
            const details = raw.filter(sheet => {
                const isSummary = /记忆总结|总结表|summary/i.test(String(sheet?.n || ''));
                if (isSummary) ignoredSummary = true;
                return !isSummary;
            }).slice(0, 8);
            return { details, ignoredSummary };
        }

        async applyImport(data) {
            try {
                const m = LVM.m;
                const { details, ignoredSummary } = this.normalizeSheets(data);
                const definitions = m.all().map(sheet => ({ n: sheet.n, c: [...sheet.c] }));
                m.initTables(definitions, false);
                let rows = 0;
                for (let index = 0; index < Math.min(7, details.length); index++) {
                    const source = details[index];
                    const target = m.get(index);
                    if (!source || !target) continue;
                    if (Array.isArray(source.c) && source.c.length) target.c = [...source.c];
                    target.from(source);
                    target.r.forEach(row => {
                        const meta = target._ensureMeta(row).__lvm;
                        meta.cold = false;
                        meta.locked = false;
                        meta.sources = Array.isArray(meta.sources) ? meta.sources : [];
                    });
                    rows += target.r.length;
                }
                const manualSource = details.find(sheet => String(sheet?.n || '') === '手工记忆');
                if (manualSource) {
                    m.get(7).from(manualSource);
                    rows += m.get(7).r.length;
                }
                m.save(true, true);
                LVM.rebuildColdIndexCache?.();
                const policyResult = await LVM.reconcileColdRows?.();
                return { success: true, tables: details.length, rows, ignoredSummary, policyResult };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        showExportUI() {
            const m = LVM.m;
            const html = `<div style="display:grid;gap:10px;"><p style="margin:0;opacity:.75;">v2 备份包含稳定 R 编号、来源、冷热与锁定元数据，不包含旧总结链数据。</p><button id="lvm-export-json">导出完整 JSON（推荐）</button><button id="lvm-export-txt">导出可读 TXT</button></div>`;
            LVM.pop('📥 导出 LEASE Vector Memory', html, true);
            $('#lvm-export-json').off('click').on('click', () => this.exportData(m.all(), `lease_vector_memory_${m.gid()}_${Date.now()}`, 'json'));
            $('#lvm-export-txt').off('click').on('click', () => this.exportData(m.all(), `lease_vector_memory_${m.gid()}_${Date.now()}`, 'txt'));
        }
    }

    LVM.IOManager = new IOManager();
})();
