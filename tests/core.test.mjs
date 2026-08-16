import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const lifecycleSource = fs.readFileSync(new URL('../memory_lifecycle.js', import.meta.url), 'utf8');
const vectorSource = fs.readFileSync(new URL('../vector_manager.js', import.meta.url), 'utf8');
const backfillSource = fs.readFileSync(new URL('../backfill_manager.js', import.meta.url), 'utf8');
const promptSource = fs.readFileSync(new URL('../prompt_manager.js', import.meta.url), 'utf8');

function extractBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const signatureEnd = marker.startsWith('function ') ? source.indexOf(')', start) : start;
  const brace = source.indexOf('{', signatureEnd);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${marker}`);
}

function loadSheetClass(context = {}) {
  const sandbox = { window: {}, console, ...context };
  vm.createContext(sandbox);
  vm.runInContext(`globalThis.Sheet = ${extractBlock(indexSource, 'class S ')}`, sandbox);
  return { Sheet: sandbox.Sheet, sandbox };
}

test('稳定 R 编号删除、移动和 v2 往返后不漂移', () => {
  const { Sheet } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#日期', '事件']);
  for (let i = 1; i <= 10; i++) sheet.ins({ 1: `事件${i}` });
  assert.equal(sheet.r[9].__lvm.id, 'R10');
  sheet.del('R3');
  sheet.move(sheet.indexOfId('R4'), 1);
  assert.equal(sheet.indexOfId('R10') >= 0, true);
  assert.equal(sheet.r[sheet.indexOfId('R10')][1], '事件10');
  const saved = JSON.parse(JSON.stringify(sheet.json()));
  const restored = new Sheet('主线剧情', ['#日期', '事件']);
  restored.from(saved);
  assert.equal(restored.r[restored.indexOfId('R10')][1], '事件10');
  assert.equal(restored.ins({ 1: '新事件' }), 'R11');
});

test('批量可见文本排除冷行、锁定行和手工记忆', () => {
  const { Sheet } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['事件']);
  sheet.ins({ 0: '可写热行' });
  sheet.ins({ 0: '绿色冷行' });
  sheet.ins({ 0: '锁定热行' });
  sheet.r[1].__lvm.cold = true;
  sheet.r[2].__lvm.locked = true;
  const backfill = sheet.txt(0, 'backfill');
  assert.match(backfill, /可写热行/);
  assert.doesNotMatch(backfill, /绿色冷行|锁定热行/);
  assert.match(sheet.txt(0, 'story'), /可写热行|锁定热行/);
  assert.doesNotMatch(sheet.txt(0, 'story'), /绿色冷行/);
  const manual = new Sheet('手工记忆', ['#标题', '内容', '#标签']);
  manual.ins({ 0: '标题', 1: '只给日常剧情' });
  assert.equal(manual.txt(7, 'backfill'), '');
  assert.match(manual.txt(7, 'story'), /只给日常剧情/);
});

test('指向冷行的命令使整批事务零写入', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['事件']);
  sheet.ins({ 0: '旧事件' });
  sheet.r[0].__lvm.cold = true;
  let saves = 0;
  sandbox.m = { get: index => index === 0 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const result = sandbox.exe([
    { t: 'insert', ti: 0, ri: null, d: { 0: '不应写入' } },
    { t: 'update', ti: 0, ri: 'R1', d: { 0: '冲突' } }
  ]);
  assert.equal(result.success, false);
  assert.equal(sheet.r.length, 1);
  assert.equal(sheet.r[0][0], '旧事件');
  assert.equal(saves, 0);
});

test('已填写结束时间的主线行拒绝继续更新', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#开始时间', '#结束时间', '事件概要']);
  sheet.ins({ 0: '20:00', 1: '22:35', 2: '[礼宾室]谈判结束' });
  let saves = 0;
  sandbox.m = { get: index => index === 0 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const result = sandbox.exe([{ t: 'update', ti: 0, ri: 'R1', d: { 2: '[车内]继续新事件' } }]);
  assert.equal(result.success, false);
  assert.match(result.conflicts.join('；'), /已有结束时间.*已封存/);
  assert.equal(sheet.r[0][2], '[礼宾室]谈判结束');
  assert.equal(saves, 0);
});

test('同一批先封存主线再更新同一 R 行时整批拒绝', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#开始时间', '#结束时间', '事件概要']);
  sheet.ins({ 0: '20:00', 2: '[礼宾室]谈判进行中' });
  sandbox.m = { get: index => index === 0 ? sheet : null, save() { throw new Error('冲突事务不应保存'); } };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const result = sandbox.exe([
    { t: 'update', ti: 0, ri: 'R1', d: { 1: '22:35', 2: '[礼宾室]谈判结束' } },
    { t: 'update', ti: 0, ri: 'R1', d: { 2: '[车内]开始另一事件' } }
  ]);
  assert.equal(result.success, false);
  assert.equal(sheet.r[0][1] || '', '');
  assert.equal(sheet.r[0][2], '[礼宾室]谈判进行中');
});

test('主线 updateRow 引入新地点时拒绝并要求另起一行', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#开始时间', '#结束时间', '事件概要']);
  sheet.ins({ 0: '20:00', 2: '[礼宾室]谈判进行中' });
  sandbox.m = { get: index => index === 0 ? sheet : null, save() { throw new Error('地点冲突事务不应保存'); } };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const result = sandbox.exe([{ t: 'update', ti: 0, ri: 'R1', d: { 2: '[车内]开始讨论下一目标' } }]);
  assert.equal(result.success, false);
  assert.match(result.conflicts.join('；'), /发生地点切换.*必须另起一行/);
  assert.equal(sheet.r[0][2], '[礼宾室]谈判进行中');
});

test('追加列忽略重复片段并吸收模型回传的完整新版', () => {
  const { Sheet } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#开始时间', '#结束时间', '事件概要']);
  sheet.ins({ 2: '[礼宾室]谈判开始' });
  sheet.upd('R1', { 2: '[礼宾室]谈判开始' });
  assert.equal(sheet.r[0][2], '[礼宾室]谈判开始');
  sheet.upd('R1', { 2: '[礼宾室]谈判开始；[礼宾室]双方交换条件' });
  assert.equal(sheet.r[0][2], '[礼宾室]谈判开始；[礼宾室]双方交换条件');
});

test('空表初始化时将任意误用的未来 R 编号安全转换为新增', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('角色状态', ['#角色名', '#状态']);
  let saves = 0;
  sandbox.m = { get: index => index === 2 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  sheet.nextRowId = 5;
  const result = sandbox.exe([{ t: 'update', ti: 2, ri: 'R5', d: { 0: '洛川', 1: '正常' } }]);
  assert.equal(result.success, true);
  assert.equal(sheet.r.length, 1);
  assert.equal(sheet.r[0].__lvm.id, 'R5');
  assert.equal(sheet.r[0][0], '洛川');
  assert.equal(saves, 1);
});

test('明确清表同时重置稳定行编号，普通删除仍不复用编号', () => {
  const { Sheet } = loadSheetClass();
  const sheet = new Sheet('角色状态', ['#角色名']);
  sheet.ins({ 0: '洛川' });
  sheet.ins({ 0: '俞晚晴' });
  sheet.del('R2');
  assert.equal(sheet.nextRowId, 3);
  sheet.clear();
  assert.equal(sheet.r.length, 0);
  assert.equal(sheet.nextRowId, 1);
  sheet.ins({ 0: '重新初始化' });
  assert.equal(sheet.r[0].__lvm.id, 'R1');
});

test('非空表指向不存在的未来 R 编号仍整批拒绝', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('角色状态', ['#角色名', '#状态']);
  sheet.ins({ 0: '洛川', 1: '正常' });
  let saves = 0;
  sandbox.m = { get: index => index === 2 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const result = sandbox.exe([{ t: 'update', ti: 2, ri: 'R5', d: { 1: '受伤' } }]);
  assert.equal(result.success, false);
  assert.match(result.conflicts.join('；'), /表2 R5不存在/);
  assert.equal(sheet.r[0][1], '正常');
  assert.equal(saves, 0);
});

function lifecycleHarness({ failEmbedding = false } = {}) {
  const { Sheet } = loadSheetClass();
  const sheets = [new Sheet('主线剧情', ['事件']), new Sheet('支线剧情', ['事件']), ...Array.from({ length: 5 }, (_, i) => new Sheet(`表${i + 2}`, ['内容'])), new Sheet('手工记忆', ['#标题', '内容', '#标签'])];
  for (let i = 1; i <= 10; i++) sheets[0].ins({ 0: `事件${i}` });
  const library = {};
  const LVM = {
    m: { all: () => sheets, get: i => sheets[i], gid: () => 'chat-A', save() {} },
    config_obj: { vectorEnabled: true, coldPolicies: Object.fromEntries(sheets.map((_, i) => [i, { enabled: i < 2, keep: 3 }])) },
    esc: String,
    VM: {
      isDataLoaded: true,
      library,
      saveLibrary() {},
      getActiveBooks: () => [],
      setActiveBooks() {},
      async vectorizeBook(bookId) {
        const book = library[bookId];
        if (failEmbedding) return { success: false, errors: book.chunks.length, lastError: 'mock failure' };
        book.chunks.forEach((_, i) => { book.vectorized[i] = true; book.vectors[i] = [i + 1]; });
        return { success: true, errors: 0 };
      }
    }
  };
  const jq = () => ({ length: 0 });
  const sandbox = { window: { LeaseVectorMemory: LVM }, console, setTimeout: () => 0, clearTimeout() {}, $: jq };
  vm.createContext(sandbox);
  vm.runInContext(lifecycleSource, sandbox);
  return { LVM, sheets };
}

test('十行主线 X=3 时仅 R1-R7 成功转冷', async () => {
  const { LVM, sheets } = lifecycleHarness();
  const result = await LVM.reconcileColdRows();
  assert.equal(result.success, true);
  assert.equal(sheets[0].r.map(row => row.__lvm.cold).join(','), 'true,true,true,true,true,true,true,false,false,false');
});

test('Embedding 失败的候选行保持白色', async () => {
  const { LVM, sheets } = lifecycleHarness({ failEmbedding: true });
  const result = await LVM.reconcileColdRows();
  assert.equal(result.success, false);
  assert.equal(sheets[0].r.some(row => row.__lvm.cold), false);
});

test('向量总开关关闭时自动降冷跳过且所有行保持白色', async () => {
  const { LVM, sheets } = lifecycleHarness();
  LVM.config_obj.vectorEnabled = false;
  const result = await LVM.reconcileColdRows();
  assert.equal(result.skipped, '向量功能已关闭');
  assert.equal(sheets[0].r.some(row => row.__lvm.cold), false);
});

test('行向量文本不包含稳定 R 编号和来源楼层', () => {
  const { LVM, sheets } = lifecycleHarness();
  sheets[0].r[0].__lvm.cold = true;
  sheets[0].r[0].__lvm.sources = [{ start: 0, end: 30 }];
  const text = LVM.collectColdEntries()[0].text;
  assert.equal(text, '[主线剧情]\n事件：事件1');
  assert.doesNotMatch(text, /R1|来源|0-30/);
});

test('身份、存储和数据库命名空间完全隔离', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const allSource = fs.readdirSync(new URL('..', import.meta.url)).filter(name => name.endsWith('.js')).map(name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')).join('\n');
  assert.equal(manifest.id, 'lease_vector_memory');
  assert.match(allSource, /LEASE_Vector_Memory_Database/);
  assert.doesNotMatch(allSource, /extension_settings\.st_memory_table|chatMetadata\.gaigai|Memory_Vector_Database/);
});

test('向量记忆 UI 合并冷热与 API，并精简主表操作', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(lifecycleSource, /冷热与 API/);
  assert.match(lifecycleSource, /知识书管理/);
  assert.doesNotMatch(lifecycleSource, /当前聊天记忆库/);
  assert.match(indexSource, /id="gai-btn-memory-state"/);
  assert.match(indexSource, /状态 \/ 操作/);
  assert.match(indexSource, /class="g-col-source"/);
  assert.doesNotMatch(indexSource, /class="lvm-row-order"/);
  assert.match(css, /\.g-ops-wrap[\s\S]*?opacity:\s*1\s*!important/);
  assert.match(vectorSource, /const books = Object\.entries\(this\.library\)/);
});

test('来源区间固定列具有明确裁剪宽度和不透明主题背景', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.g-col-source\s*\{[\s\S]*?clip-path:\s*inset\(0\)\s*!important/);
  assert.match(css, /\.g-tbl-wrap th\.g-col-source,\s*\.g-tbl-wrap td\.g-col-source\s*\{\s*position:\s*sticky\s*!important/);
  assert.match(css, /\.g-col-source\s*\{[\s\S]*?width:\s*var\(--lvm-source-width,\s*64px\)\s*!important/);
  assert.match(css, /\.lvm-row-source\s*\{[\s\S]*?width:\s*calc\(var\(--lvm-source-width,\s*64px\) - 10px\)\s*!important[\s\S]*?text-overflow:\s*ellipsis\s*!important/);
  assert.match(indexSource, /SOURCE_COL_WIDTH_KEY\s*=\s*'__lvm_source_width__'/);
  assert.match(indexSource, /title="拖拽调整来源列宽"/);
  assert.match(indexSource, /setProperty\('--lvm-source-width', newWidth \+ 'px'\)/);
  assert.match(css, /background:\s*var\(--g-sticky-bg,\s*#f6f8fc\)\s*!important/);
  const themeStart = indexSource.indexOf('function thm()');
  const themeEnd = indexSource.indexOf('\n    function ', themeStart + 1);
  assert.match(indexSource.slice(themeStart, themeEnd), /setProperty\('--g-sticky-bg'/);
  assert.doesNotMatch(indexSource, /class="g-col-num" style="width:40px/);
});

test('自动降冷面板不可被 API 配置压缩并提供响应式布局', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(lifecycleSource, /class="lvm-policy-list"/);
  assert.match(lifecycleSource, /class="lvm-policy-row"/);
  assert.match(css, /\.lvm-policy-panel\s*\{[\s\S]*?flex:\s*0 0 auto\s*!important[\s\S]*?height:\s*auto\s*!important[\s\S]*?overflow:\s*visible\s*!important/);
  assert.match(css, /\.lvm-policy-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*?\.lvm-policy-list\s*\{\s*grid-template-columns:\s*1fr/);
});

test('清表入口不依赖已删除的总结管理器并同步冷记忆索引', () => {
  const start = indexSource.indexOf("$('#gai-btn-cleanup')");
  const end = indexSource.indexOf("$('#gai-btn-theme')", start);
  const cleanup = indexSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(cleanup, /m\.sm|lastSummaryIndex/);
  assert.match(cleanup, /syncColdMemoryAfterCleanup/);
  assert.equal((cleanup.match(/await syncColdMemoryAfterCleanup\(\)/g) || []).length, 4);
  assert.match(indexSource, /clear\(\)\s*\{[\s\S]*?this\.r\s*=\s*\[\];[\s\S]*?this\.nextRowId\s*=\s*1;/);
  assert.doesNotMatch(cleanup, /slice\(0, -1\)\.forEach\(s => s\.clear\(\)\);\s*clearSummarizedMarks\(\)/);
});

test('追溯请求强制按事件分行并废止同日追加旧规则', () => {
  const baselineMatch = promptSource.match(/const LEASE_BACKFILL_PROMPT_BASELINE = decodeBuiltinPrompt\(\[(.*?)\]\.join\(''\)\);/s);
  assert.ok(baselineMatch);
  const baselineChunks = vm.runInNewContext('[' + baselineMatch[1] + ']');
  const baselinePrompt = Buffer.from(baselineChunks.join(''), 'base64').toString('utf8').trim();
  assert.equal(createHash('sha256').update(baselinePrompt).digest('hex'), 'cf6505f811785cb037ce260e7ead26b59c30fb0d4c76d7569def0db9044c0d7d');
  assert.match(promptSource, /PROMPT_VERSION\s*=\s*7\.5/);
  assert.match(promptSource, /const LEASE_BACKFILL_PROMPT = migrateLeaseBackfillPrompt\(LEASE_BACKFILL_PROMPT_BASELINE\)/);
  assert.match(promptSource, /用户长期实测的“新版-backfillPrompt\.txt”是唯一正文基线/);
  assert.match(baselinePrompt, /从待处理消息的第一条读到最后一条/);
  assert.match(baselinePrompt, /统一剧情时间轴/);
  assert.match(baselinePrompt, /一名角色只能有一行/);
  assert.match(promptSource, /表7 手工记忆/);
  assert.match(promptSource, /R0 和数字数组下标都不是合法行号/);
  assert.doesNotMatch(promptSource, /Next Stable Row ID:/);
  assert.match(promptSource, /【主线事件分行协议·最高优先级】/);
  assert.match(promptSource, /任何第1列“结束时间”非空的主线行都已经封存/);
  assert.match(promptSource, /“同一天必须 updateRow”.*旧规则全部作废/);
  assert.match(backfillSource, /MAIN_PLOT_SEGMENTATION_RULE/);
  assert.match(backfillSource, /地点切换、目标切换、明显转场/);

  const promptStore = new Map();
  const promptWindow = { LeaseVectorMemory: { config_obj: {}, DEFAULT_TABLES: [] } };
  vm.runInNewContext(promptSource, {
    window: promptWindow,
    localStorage: {
      getItem: key => promptStore.get(key) || null,
      setItem: (key, value) => promptStore.set(key, String(value)),
      removeItem: key => promptStore.delete(key)
    },
    atob,
    TextDecoder,
    Uint8Array,
    structuredClone,
    setTimeout: () => 0,
    console: { log() {}, warn() {}, error() {} }
  });
  const runtimePrompt = promptWindow.LeaseVectorMemory.PromptManager.DEFAULT_BACKFILL_PROMPT;
  assert.match(runtimePrompt, /从待处理消息的第一条读到最后一条/);
  assert.match(runtimePrompt, /【统一剧情时间轴】/);
  assert.match(runtimePrompt, /表7 手工记忆/);
  assert.doesNotMatch(runtimePrompt, /表7 记忆总结/);
  assert.doesNotMatch(runtimePrompt, /(?:updateRow|deleteRow)\(\d+,\s*\d+/);
});

test('GitHub 安装目录能够完成依赖定位并创建独立顶部入口', () => {
  assert.match(indexSource, /LEASE-Vector-Memory\(\?:-main\)\?/);
  assert.match(indexSource, /id:\s*'lvm-top-wrapper'/);
  assert.match(indexSource, /id:\s*'lvm-top-btn'/);
  assert.match(indexSource, /#top-settings-holder/);
  assert.doesNotMatch(indexSource, /\$\('#gaigai-wrapper'\)\.remove/);
  assert.match(indexSource, /LEASE-2473\/LEASE-Vector-Memory/);
});

test('动态路径定位可识别 SillyTavern 克隆出的 LEASE-Vector-Memory 目录', () => {
  const getPathSource = extractBlock(indexSource, 'function getExtensionPath(');
  const scripts = [{ getAttribute: name => name === 'src' ? '/scripts/extensions/third-party/LEASE-Vector-Memory/index.js?v=4.2.5' : null }];
  const sandbox = {
    document: { currentScript: null, getElementsByTagName: tag => tag === 'script' ? scripts : [] },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(`globalThis.getExtensionPath = ${getPathSource}`, sandbox);
  assert.equal(sandbox.getExtensionPath(), '/scripts/extensions/third-party/LEASE-Vector-Memory');
});
