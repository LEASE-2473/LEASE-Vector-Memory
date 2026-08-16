/**
 * ⚡ Gaigai记忆插件 - 导入导出管理模块
 *
 * 功能：处理数据的导入导出操作，支持JSON和TXT格式
 *
 * @version 1.5.6
 * @author Gaigai Team
 */

(function() {
    'use strict';

    class IOManager {
        constructor() {
            console.log('✅ [IOManager] 初始化完成');
        }

        /**
         * 导出数据
         * @param {Array} data - 表格数据数组
         * @param {string} filename - 文件名
         * @param {string} format - 导出格式 ('json' 或 'txt')
         */
        exportData(data, filename, format = 'json') {
            const V = window.Gaigai.V || 'v1.0.0';

            // ✅ FIX: Include summarizedRows in the export payload
            const exportData = {
                v: V,
                t: new Date().toISOString(),
                s: data.map(s => s.json()),
                summarized: window.Gaigai.summarizedRows || {} // Save hidden state
            };

            let content, mimeType, extension;

            if (format === 'txt') {
                // TXT格式：生成人类可读的文本
                content = this._generateHumanReadableTxt(exportData.s);
                mimeType = 'text/plain';
                extension = '.txt';
            } else {
                // JSON格式
                content = JSON.stringify(exportData, null, 2);
                mimeType = 'application/json';
                extension = '.json';
            }

            // 确保文件名有正确的扩展名
            const finalFilename = filename.replace(/\.(json|txt)$/, '') + extension;

            // 创建下载
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = finalFilename;
            a.click();
            URL.revokeObjectURL(url);

            console.log(`✅ [IOManager] 导出成功: ${finalFilename} (${format.toUpperCase()})`);
        }

        /**
         * 生成人类可读的TXT格式
         * @private
         * @param {Array} sheets - 表格数据数组
         * @returns {string} 格式化的文本
         */
        _generateHumanReadableTxt(sheets) {
            let output = '';
            // Get hidden state safely
            const summarizedRows = window.Gaigai.summarizedRows || {};

            sheets.forEach((sheet, tableIndex) => {
                const tableName = sheet.n || `表格${tableIndex}`;
                output += `${'='.repeat(50)}\n`;
                output += `=== ${tableName} (表索引: ${tableIndex}) ===\n`;
                output += `${'='.repeat(50)}\n\n`;

                if (!sheet.r || sheet.r.length === 0) {
                    output += '(此表格为空)\n\n';
                } else {
                    const columns = sheet.c || [];

                    sheet.r.forEach((row, rowIndex) => {
                        // Check if hidden
                        const isHidden = summarizedRows[tableIndex] && summarizedRows[tableIndex].includes(rowIndex);
                        const statusPrefix = isHidden ? '[已归档] ' : '';

                        output += `[${rowIndex}] ${statusPrefix}`;

                        const pairs = [];
                        columns.forEach((colName, colIndex) => {
                            let value = row[colIndex] || '';
                            if (value) {
                                // 🔴 Escape newlines and pipes to prevent parsing errors
                                value = String(value)
                                    .replace(/\n/g, '\\n')  // Replace actual newlines with literal \n
                                    .replace(/\|/g, '{{PIPE}}');  // Replace pipes with placeholder
                                pairs.push(`${colName}: ${value}`);
                            }
                        });

                        output += pairs.join(' | ');
                        output += '\n';
                    });

                    output += '\n';
                }

                output += '-'.repeat(50) + '\n\n';
            });

            return output;
        }

        /**
         * 解析人类可读的TXT格式 (State Machine 版本)
         * @param {string} text - TXT文本内容
         * @returns {Object} 解析后的数据对象
         */
        parseHumanReadableTxt(text) {
            const result = {
                v: window.Gaigai.V || 'v1.0.0',
                t: new Date().toISOString(),
                s: [],
                summarized: {}
            };

            // 状态变量
            let currentTableIndex = -1;
            let currentTableName = '';
            let currentColumnSet = new Set();
            let currentRowsRaw = []; // 存储 Map 对象的数组

            // 辅助函数：完成当前表格的处理
            const finalizeCurrentTable = () => {
                if (currentTableIndex === -1) return; // 没有表格需要完成

                // 将 Set 转换为数组（列顺序按首次出现顺序）
                let columns = Array.from(currentColumnSet);

                // 如果表格为空（没有数据行），尝试从内存推断（优雅降级）
                if (columns.length === 0) {
                    const m = window.Gaigai.m;
                    if (m && m.s && m.s[currentTableIndex] && m.s[currentTableIndex].c) {
                        columns = [...m.s[currentTableIndex].c];
                        console.log(`⚠️ [IOManager] 表${currentTableIndex} 无数据行，从内存推断列结构: [${columns.join(', ')}]`);
                    } else {
                        console.log(`⚠️ [IOManager] 表${currentTableIndex} 为空且无法推断列结构，使用空列表`);
                    }
                }

                // 根据推断的列顺序构建行数组
                const rows = [];
                currentRowsRaw.forEach((rowMap, rowIndex) => {
                    if (!rowMap) return;

                    const rowData = new Array(columns.length).fill('');
                    columns.forEach((colName, colIndex) => {
                        rowData[colIndex] = rowMap.get(colName) || ''; // 缺失的列填充空字符串
                    });

                    rows[rowIndex] = rowData;
                });

                // 存储表格
                result.s[currentTableIndex] = {
                    n: currentTableName,
                    c: columns,
                    r: rows.filter(r => r) // 过滤掉空行
                };

                console.log(`📋 [IOManager] 解析表${currentTableIndex} (${currentTableName}): ${columns.length}列, ${rows.filter(r => r).length}行`);
            };

            // 按行处理
            const lines = text.split('\n');

            for (const line of lines) {
                // 检查是否是表格头
                const headerMatch = line.match(/===\s*(.+?)\s*\(表索引:\s*(\d+)\)\s*===/);
                if (headerMatch) {
                    // 完成上一个表格的处理（如果有）
                    finalizeCurrentTable();

                    // 开始新表格
                    currentTableName = headerMatch[1].trim();
                    currentTableIndex = parseInt(headerMatch[2]);
                    currentColumnSet = new Set();
                    currentRowsRaw = [];

                    console.log(`🔍 [IOManager] 开始解析表${currentTableIndex}: ${currentTableName}`);
                    continue;
                }

                // 检查是否是数据行（仅在已进入表格状态时）
                if (currentTableIndex !== -1) {
                    const rowMatch = line.match(/^\s*\[(\d+)\]\s*(.+)$/);
                    if (rowMatch) {
                        const rowIndex = parseInt(rowMatch[1]);
                        let rowContent = rowMatch[2];
                        const isArchived = /^\[已归档\]\s*/.test(rowContent);
                        if (isArchived) {
                            rowContent = rowContent.replace(/^\[已归档\]\s*/, '');
                            if (!Array.isArray(result.summarized[currentTableIndex])) {
                                result.summarized[currentTableIndex] = [];
                            }
                            result.summarized[currentTableIndex].push(rowIndex);
                        }

                        // 解析键值对
                        const pairs = rowContent.split('|').map(p => p.trim());
                        const rowMap = new Map();

                        pairs.forEach(pair => {
                            const colonIndex = pair.indexOf(':');
                            if (colonIndex === -1) return;

                            const key = pair.substring(0, colonIndex).trim();
                            let value = pair.substring(colonIndex + 1).trim();

                            if (key) {
                                // 🔴 Unescape newlines and pipes during import
                                value = value
                                    .replace(/\\n/g, '\n')  // Replace literal \n with actual newlines
                                    .replace(/\{\{PIPE\}\}/g, '|');  // Replace placeholder with pipes
                                currentColumnSet.add(key); // 收集列名
                                rowMap.set(key, value);
                            }
                        });

                        currentRowsRaw[rowIndex] = rowMap;
                    }
                }
            }

            // 完成最后一个表格的处理
            finalizeCurrentTable();

            console.log(`✅ [IOManager] TXT解析完成，共 ${result.s.filter(s => s).length} 个表格`);
            return result;
        }

        /**
         * 处理文件导入
         * @param {File} file - 上传的文件对象
         * @returns {Promise<Object>} 解析后的数据对象
         */
        async handleImport(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();

                reader.onload = async (event) => {
                    try {
                        const content = event.target.result;

                        let data;

                        // 检测文件格式
                        const trimmed = content.trim();
                        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                            // JSON格式
                            data = JSON.parse(content);
                            console.log('📄 [IOManager] 检测到JSON格式');
                        } else if (trimmed.includes('===') && trimmed.includes('表索引')) {
                            // TXT格式
                            data = this.parseHumanReadableTxt(content);
                            console.log('📄 [IOManager] 检测到TXT格式');
                        } else {
                            throw new Error('无法识别的文件格式');
                        }

                        resolve(data);
                    } catch (err) {
                        reject(err);
                    }
                };

                reader.onerror = () => {
                    reject(new Error('文件读取失败'));
                };

                reader.readAsText(file);
            });
        }

        /**
         * 显示导出UI界面
         */
        showExportUI() {
            const m = window.Gaigai.m;
            const UI = window.Gaigai.ui;
            const V = window.Gaigai.V || 'v1.0.0';
            const customAlert = window.Gaigai.customAlert || alert;

            // 🔄 强制刷新 UI 配置（确保获取最新的主题设置）
            try {
                const savedUI = localStorage.getItem('gg_ui');
                if (savedUI) {
                    const parsed = JSON.parse(savedUI);
                    Object.assign(UI, parsed);
                }
            } catch (e) {
                console.warn('⚠️ [IOManager] 刷新 UI 配置失败:', e);
            }

            // 🌙 获取主题配置（重新读取以确保准确）
            const isDark = UI.darkMode;
            const themeColor = UI.c;
            const textColor = UI.tc;

            // 1. 创建遮罩层
            const $overlay = $('<div>', {
                id: 'gai-export-overlay',
                css: {
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 10000005,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px',
                    boxSizing: 'border-box'
                }
            });

            // 2. 创建小窗口容器
            const $box = $('<div>', {
                css: {
                    background: isDark ? '#1e1e1e' : '#fff',
                    color: textColor,
                    border: isDark ? '1px solid rgba(255,255,255,0.1)' : 'none',
                    width: '320px',
                    maxWidth: '90vw',
                    padding: '20px',
                    borderRadius: '12px',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    position: 'relative',
                    transform: 'scale(1)',
                    transition: 'all 0.2s'
                }
            });

            // 3. 标题
            const $title = $('<h3>', {
                text: '📥 导出备份',
                css: {
                    margin: '0 0 8px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    textAlign: 'center',
                    color: textColor
                }
            });

            // 4. 提示文字
            const $desc = $('<div>', {
                text: '请选择要导出的内容',
                css: {
                    fontSize: '12px',
                    color: textColor,
                    opacity: '0.8',
                    marginBottom: '8px',
                    textAlign: 'center'
                }
            });

            // 4.5. 格式选择复选框 (TXT 方便手机传输)
            const $formatContainer = $('<div>', {
                css: {
                    background: isDark ? 'rgba(255,255,255,0.05)' : '#f8f9fa',
                    padding: '10px',
                    borderRadius: '6px',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e0e0e0'
                }
            });

            const $formatCheckbox = $('<input>', {
                type: 'checkbox',
                id: 'export-txt-format',
                css: {
                    cursor: 'pointer',
                    width: '16px',
                    height: '16px'
                }
            });

            const $formatLabel = $('<label>', {
                for: 'export-txt-format',
                html: `📄 保存为 TXT 格式 <span style="font-size:11px;color:${textColor};opacity:0.6;">(方便手机传输)</span>`,
                css: {
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: textColor,
                    flex: 1,
                    userSelect: 'none'
                }
            });

            $formatContainer.append($formatCheckbox, $formatLabel);

            // 5. 按钮样式模板
            const btnStyle = {
                width: '100%',
                padding: '12px',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                color: UI.tc,
                fontWeight: '600',
                fontSize: '13px',
                transition: 'all 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            };

            // 6. 导出函数封装
            const performExport = (data, baseFilename) => {
                const useTxt = $formatCheckbox.is(':checked');
                const format = useTxt ? 'txt' : 'json';
                this.exportData(data, baseFilename, format);
                $overlay.remove();
            };

            // 7. 全部导出按钮
            const $btnAll = $('<button>', {
                html: '📦 全部导出 (含总结)',
                css: { ...btnStyle, background: UI.c }
            }).on('click', function () {
                performExport(m.all(), `memory_table_all_${m.gid()}_${Date.now()}`);
            }).hover(
                function () { $(this).css('filter', 'brightness(0.9)'); },
                function () { $(this).css('filter', 'brightness(1)'); }
            );

            // 8. 仅导出总结按钮
            const $btnSummary = $('<button>', {
                html: '📝 仅导出总结',
                css: { ...btnStyle, background: UI.c, opacity: '0.9' }
            }).on('click', function () {
                const summarySheet = m.get(m.s.length - 1); // 动态获取最后一个表格（总结表）
                if (!summarySheet || summarySheet.r.length === 0) {
                    customAlert('当前没有总结数据可导出', '提示');
                    return;
                }
                performExport([summarySheet], `memory_table_summary_${m.gid()}_${Date.now()}`);
            }).hover(
                function () { $(this).css('filter', 'brightness(0.9)'); },
                function () { $(this).css('filter', 'brightness(1)'); }
            );

            // 9. 仅导出详情按钮
            const $btnDetails = $('<button>', {
                html: '📊 仅导出详情 (不含总结)',
                css: { ...btnStyle, background: UI.c, opacity: '0.8' }
            }).on('click', function () {
                performExport(m.all().slice(0, -1), `memory_table_details_${m.gid()}_${Date.now()}`);
            }).hover(
                function () { $(this).css('filter', 'brightness(0.9)'); },
                function () { $(this).css('filter', 'brightness(1)'); }
            );

            // 10. 取消按钮
            const $btnCancel = $('<button>', {
                text: '取消',
                css: {
                    ...btnStyle,
                    background: 'transparent',
                    border: isDark ? '1px solid rgba(255,255,255,0.2)' : '1px solid ' + themeColor,
                    color: textColor,
                    marginTop: '8px',
                    opacity: '0.8'
                }
            }).on('click', function () {
                $overlay.remove();
            }).hover(
                function () { $(this).css({ 'filter': 'brightness(0.9)', 'opacity': '0.8' }); },
                function () { $(this).css({ 'filter': 'brightness(1)', 'opacity': '0.6' }); }
            );

            // 11. 提示信息
            const $tip = $('<div>', {
                html: `💡 提示：<br>
                • 全部导出：包含所有表格<br>
                • 仅导出总结：仅最后一个总结表<br>
                • 仅导出详情：所有数据表（不含总结表）`,
                css: {
                    padding: '10px',
                    background: 'rgba(33, 150, 243, 0.1)',
                    borderRadius: '6px',
                    fontSize: '10px',
                    color: '#1976d2',
                    lineHeight: '1.5',
                    marginTop: '4px'
                }
            });

            // 12. 组装窗口
            $box.append($title, $desc, $formatContainer, $btnAll, $btnSummary, $btnDetails, $btnCancel, $tip);
            $overlay.append($box);
            $('body').append($overlay);

            // 13. 绑定点击遮罩层关闭
            $overlay.on('click', function (e) {
                if (e.target === $overlay[0]) {
                    $overlay.remove();
                }
            });

            // 14. ESC键关闭
            $(document).on('keydown.exportOverlay', function (e) {
                if (e.key === 'Escape') {
                    $(document).off('keydown.exportOverlay');
                    $overlay.remove();
                }
            });
        }
    }

    // 挂载到 window.Gaigai
    window.Gaigai = window.Gaigai || {};
    window.Gaigai.IOManager = new IOManager();
    console.log('✅ [IOManager] 已挂载到 window.Gaigai.IOManager');
})();
