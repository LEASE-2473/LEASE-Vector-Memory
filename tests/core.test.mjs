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

function loadManagerClasses() {
  const sandbox = { window: {}, console, DEFAULT_TABLES: [] };
  vm.createContext(sandbox);
  vm.runInContext(`globalThis.S = ${extractBlock(indexSource, 'class S ')}; globalThis.M = ${extractBlock(indexSource, 'class M ')}`, sandbox);
  return { Sheet: sandbox.S, Manager: sandbox.M };
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

test('切换表结构保留已删除高编号之后的 nextRowId', () => {
  const { Sheet, Manager } = loadManagerClasses();
  const manager = new Manager();
  const sheet = new Sheet('主线剧情', ['事件']);
  for (let i = 1; i <= 10; i++) sheet.ins({ 0: `事件${i}` });
  for (let i = 2; i <= 10; i++) sheet.del(`R${i}`);
  assert.equal(sheet.nextRowId, 11);
  manager.s = [sheet];

  manager.initTables([{ n: '主线剧情', c: ['事件', '#备注'] }], true);

  assert.equal(manager.s[0].nextRowId, 11);
  assert.equal(manager.s[0].ins({ 0: '切换方案后的新事件' }), 'R11');
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

test('已填写结束时间的主线行仍允许连续事件延长', () => {
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
  const result = sandbox.exe([{ t: 'update', ti: 0, ri: 'R1', d: { 1: '22:50', 2: '[车内]双方继续落实谈判结果' } }]);
  assert.equal(result.success, true);
  assert.equal(sheet.r[0][1], '22:50');
  assert.match(sheet.r[0][2], /\[礼宾室\]谈判结束.*\[车内\]双方继续落实谈判结果/);
  assert.equal(saves, 1);
});

test('同一批可以连续更新同一主线 R 行', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#开始时间', '#结束时间', '事件概要']);
  sheet.ins({ 0: '20:00', 2: '[礼宾室]谈判进行中' });
  let saves = 0;
  sandbox.m = { get: index => index === 0 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const result = sandbox.exe([
    { t: 'update', ti: 0, ri: 'R1', d: { 1: '22:35', 2: '[礼宾室]谈判结束' } },
    { t: 'update', ti: 0, ri: 'R1', d: { 1: '22:50', 2: '[车内]继续落实谈判结果' } }
  ]);
  assert.equal(result.success, true);
  assert.equal(sheet.r[0][1], '22:50');
  assert.match(sheet.r[0][2], /谈判进行中.*谈判结束.*继续落实谈判结果/);
  assert.equal(saves, 1);
});

test('主线同一事件弧允许 updateRow 记录多个地点', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#开始时间', '#结束时间', '事件概要']);
  sheet.ins({ 0: '20:00', 2: '[礼宾室]谈判进行中' });
  let saves = 0;
  sandbox.m = { get: index => index === 0 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const result = sandbox.exe([{ t: 'update', ti: 0, ri: 'R1', d: { 2: '[车内]继续讨论并落实同一谈判目标' } }]);
  assert.equal(result.success, true);
  assert.match(sheet.r[0][2], /\[礼宾室\].*\[车内\]/);
  assert.equal(saves, 1);
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

test('空表错误 update 缺少主键时拒绝创建幽灵行', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('角色信息', ['#角色名', '#身份', '#性格', '#身体状态', '#当前目标']);
  let saves = 0;
  sandbox.m = { get: index => index === 2 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);

  const result = sandbox.exe([{ t: 'update', ti: 2, ri: 'R1', d: { 3: '疲惫', 4: '完成契约' } }]);

  assert.equal(result.success, false);
  assert.match(result.conflicts.join('；'), /缺少第0列主键/);
  assert.equal(sheet.r.length, 0);
  assert.equal(saves, 0);
});

test('角色信息按角色名纠正模型猜错的 R 编号', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('角色信息', ['#角色名', '#身份', '#身体状态']);
  sheet.ins({ 0: '俞晚晴', 1: '历史系助教', 2: '正常' });
  let saves = 0;
  sandbox.m = { get: index => index === 2 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);

  const result = sandbox.exe([{ t: 'update', ti: 2, ri: 'R2', d: { 0: '俞晚晴', 2: '疲惫' } }]);

  assert.equal(result.success, true);
  assert.equal(sheet.r.length, 1);
  assert.equal(sheet.r[0].__lvm.id, 'R1');
  assert.equal(sheet.r[0][2], '疲惫');
  assert.equal(saves, 1);
});

test('角色信息唯一空主键行可由带角色名的错误 R 更新修复', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('角色信息', ['#角色名', '#身份', '#身体状态', '#当前目标']);
  sheet.ins({ 2: '保持学术理性', 3: '履行情人契约' });
  let saves = 0;
  sandbox.m = { get: index => index === 2 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);

  const result = sandbox.exe([{ t: 'update', ti: 2, ri: 'R2', d: { 0: '俞晚晴', 1: '历史系助教' } }]);

  assert.equal(result.success, true);
  assert.equal(sheet.r.length, 1);
  assert.equal(sheet.r[0].__lvm.id, 'R1');
  assert.equal(sheet.r[0][0], '俞晚晴');
  assert.equal(sheet.r[0][1], '历史系助教');
});

test('角色信息新角色误用未来 R 时按主键安全转为新增', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('角色信息', ['#角色名', '#身份']);
  sheet.ins({ 0: '洛川', 1: '黑塔建立者' });
  let saves = 0;
  sandbox.m = { get: index => index === 2 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);

  const result = sandbox.exe([{ t: 'update', ti: 2, ri: 'R2', d: { 0: '俞晚晴', 1: '历史系助教' } }]);

  assert.equal(result.success, true);
  assert.equal(sheet.r.length, 2);
  assert.equal(sheet.r[1].__lvm.id, 'R2');
  assert.equal(sheet.r[1][0], '俞晚晴');
  assert.equal(saves, 1);
});

test('空表事务按顺序执行 insert 后 update，且校验不修改原命令', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['#开始时间', '#结束时间', '事件概要']);
  let saves = 0;
  sandbox.m = { get: index => index === 0 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const commands = [
    { t: 'insert', ti: 0, ri: null, d: { 0: '10:00', 2: '[礼宾室]谈判开始' } },
    { t: 'update', ti: 0, ri: 'R1', d: { 1: '10:30', 2: '[礼宾室]谈判结束' } }
  ];
  const original = structuredClone(commands);

  assert.equal(sandbox.exe(commands, { validateOnly: true }).success, true);
  assert.deepEqual(commands, original);
  assert.equal(sandbox.exe(commands).success, true);
  assert.equal(sheet.r.length, 1);
  assert.equal(sheet.r[0].__lvm.id, 'R1');
  assert.equal(sheet.r[0][1], '10:30');
  assert.match(sheet.r[0][2], /谈判开始.*谈判结束/);
  assert.equal(saves, 1);
});

test('空表事务新增后删除的 R 行不能在同批被再次更新', () => {
  const { Sheet, sandbox } = loadSheetClass();
  const sheet = new Sheet('主线剧情', ['事件概要']);
  let saves = 0;
  sandbox.m = { get: index => index === 0 ? sheet : null, save: () => saves++ };
  sandbox.window.LeaseVectorMemory = {};
  sandbox.globalThis = sandbox;
  const exeStart = indexSource.indexOf('function exe(');
  const exeEnd = indexSource.indexOf('\n    function extractPhoneSignal', exeStart);
  vm.runInContext(`globalThis.exe = ${indexSource.slice(exeStart, exeEnd).trim()}`, sandbox);
  const commands = [
    { t: 'insert', ti: 0, ri: null, d: { 0: '临时事件' } },
    { t: 'delete', ti: 0, ri: 'R1', d: {} },
    { t: 'update', ti: 0, ri: 'R1', d: { 0: '不应复活' } }
  ];

  const result = sandbox.exe(commands);

  assert.equal(result.success, false);
  assert.match(result.conflicts.join('；'), /R1不存在/);
  assert.equal(sheet.r.length, 0);
  assert.equal(sheet.nextRowId, 1);
  assert.equal(saves, 0);
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

test('快照回档清空阶段也统一重置稳定行计数器', () => {
  const restoreStart = indexSource.indexOf('function restoreSnapshot(');
  const restoreEnd = indexSource.indexOf('\n    function cleanOldSnapshots', restoreStart);
  const restoreSource = indexSource.slice(restoreStart, restoreEnd);

  assert.match(restoreSource, /slice\(0, -1\)\.forEach\(sheet => sheet\.clear\(\)\)/);
  assert.doesNotMatch(restoreSource, /sheet\.r\s*=\s*\[\]/);
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
  assert.match(indexSource, /<h4>🤖 批量填表 API 配置<\/h4>/);
  assert.doesNotMatch(indexSource, /<h4>🤖 AI 总结配置<\/h4>/);
});

test('运行源码不再包含不可达的旧总结界面与永久关闭分支', () => {
  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const removedRuntimeMarkers = [
    'if (false)',
    'renderBookUI',
    '_lvm_openTableSelector',
    'lvm_c_auto_sum',
    'getVectorSummaryTakeoverStatus',
    'gai-summary-pop',
    'g-book-view',
    'lvm_sum_open_table_selector',
    'gg-sum-table-selector-overlay'
  ];
  for (const marker of removedRuntimeMarkers) {
    assert.doesNotMatch(indexSource + '\n' + css, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(indexSource, /REMOVED_LEGACY_CONFIG_KEYS[\s\S]*?'autoSummary'[\s\S]*?'autoVectorizeSummary'/);
  assert.match(indexSource, /delete API_CONFIG\.summarySource;[\s\S]*?delete API_CONFIG\.lastSummaryIndex;/);
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
  const themeSource = indexSource.slice(themeStart, themeEnd);
  assert.match(themeSource, /const stickyColumnBg = isDark \? '#24272d' : '#f6f8fc'/);
  assert.match(themeSource, /setProperty\('--g-sticky-bg', stickyColumnBg\)/);
  assert.match(themeSource, /background: \$\{stickyColumnBg\} !important/);
  assert.doesNotMatch(themeSource, /book_surface/);
  assert.doesNotMatch(indexSource, /class="g-col-num" style="width:40px/);
});

test('主题样式错误不能阻断顶部入口初始化', () => {
  const initStart = indexSource.indexOf('async function ini()');
  const initEnd = indexSource.indexOf('\n    function ', initStart + 1);
  const initSource = indexSource.slice(initStart, initEnd);
  assert.match(initSource, /try \{\s*thm\(\);\s*\} catch \(e\) \{/);
  assert.match(initSource, /主题应用失败，已跳过主题以继续初始化/);
  assert.ok(initSource.indexOf("id: 'lvm-top-wrapper'") > initSource.indexOf('thm();'));
  assert.ok(initSource.indexOf("id: 'lvm-top-btn'") > initSource.indexOf('thm();'));
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

test('默认追溯提示词使用实测向量分块版且兼容旧自定义方案', () => {
  const baselineMatch = promptSource.match(/const LEASE_BACKFILL_PROMPT_BASELINE = decodeBuiltinPrompt\(\[(.*?)\]\.join\(''\)\);/s);
  assert.ok(baselineMatch);
  const baselineChunks = vm.runInNewContext('[' + baselineMatch[1] + ']');
  const baselinePrompt = Buffer.from(baselineChunks.join(''), 'base64').toString('utf8').trim();
  assert.equal(createHash('sha256').update(baselinePrompt).digest('hex'), '6009ac3eb9b89f4cb14f4f51399e79a194866ca027696933be7857da81b50f31');
  assert.match(promptSource, /PROMPT_VERSION\s*=\s*8\.0/);
  assert.match(promptSource, /const LEASE_BACKFILL_PROMPT = migrateLeaseBackfillPrompt\(LEASE_BACKFILL_PROMPT_BASELINE\)/);
  assert.match(promptSource, /用户实测并复审的“LEASE vectorprompt\.md”是默认追溯提示词正文/);
  assert.match(baselinePrompt, /历史记录填表指南（向量化精细记忆版 v2）/);
  assert.match(baselinePrompt, /从待处理消息的第一条读到最后一条/);
  assert.match(baselinePrompt, /统一剧情时间轴/);
  assert.match(baselinePrompt, /去重判断严格以【当前表格状态】为准/);
  assert.match(baselinePrompt, /前情提要只用于辅助理解，不作为跳过记录的依据/);
  assert.match(baselinePrompt, /同一连续事件（或连续微转场行动链）正在进行中且未完结/);
  assert.match(baselinePrompt, /连贯微转场容许/);
  assert.match(baselinePrompt, /连续跨零点容许/);
  assert.match(baselinePrompt, /约 250~450 字（硬上限约 800 字）/);
  assert.match(baselinePrompt, /按自然阶段（如：谈判阶段 -> 筹划阶段 -> 执行收尾）拆为多个 R 行/);
  assert.match(baselinePrompt, /脱离世界书也能完全看懂发生了什么/);
  assert.match(baselinePrompt, /约定填写当天 `23:59` 作为标准完结时间戳/);
  assert.match(baselinePrompt, /支线名保持稳定，但按独立行动与阶段里程碑[\s\S]*?新建行/);
  assert.match(baselinePrompt, /表7 手工记忆/);
  assert.match(baselinePrompt, /严禁使用 R0 或数字下标/);
  assert.doesNotMatch(promptSource, /Next Stable Row ID:/);
  assert.match(promptSource, /【主线事件向量分块补充协议·最高优先级·v7\.9】/);
  assert.match(backfillSource, /MAIN_PLOT_COHERENCE_RULE/);
  assert.match(backfillSource, /历史记录填表指南（向量化精细记忆版 v2）/);
  assert.match(backfillSource, /连续微转场和无中断跨零点不拆行/);
  assert.doesNotMatch(indexSource, /已有结束时间，主线事件已封存|发生地点切换.*必须另起一行|closedMainRows/);

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
  assert.notEqual(runtimePrompt, baselinePrompt);
  assert.match(runtimePrompt, /历史记录填表指南（向量化精细记忆版 v2）/);
  assert.match(runtimePrompt, /从待处理消息的第一条读到最后一条/);
  assert.match(runtimePrompt, /【统一剧情时间轴】/);
  assert.match(runtimePrompt, /表7 手工记忆/);
  assert.doesNotMatch(runtimePrompt, /表7 记忆总结/);
  assert.doesNotMatch(runtimePrompt, /【主线事件向量分块补充协议·最高优先级·v7\.9】/);
  assert.match(runtimePrompt, /【实体表新增与更新协议·最高优先级·v8\.0】/);
  assert.match(runtimePrompt, /不存在就必须 insertRow/);
  assert.match(runtimePrompt, /角色信息无论新增或更新都必须在指令中携带第0列角色名/);
  assert.match(runtimePrompt, /按主键新增或更新（存在 updateRow，不存在 insertRow）/);
  assert.match(runtimePrompt, /示例5A：首次记录新角色/);
  assert.match(runtimePrompt, /insertRow\(2, \{0: "前晚晴"/);
  assert.match(runtimePrompt, /示例5B：更新已有角色档案与状态/);
  assert.match(runtimePrompt, /updateRow\(2, "R1", \{0: "前晚晴"/);
  assert.doesNotMatch(runtimePrompt, /实体档案表[^\n]*严格【全局唯一 \(updateRow\)】/);
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
  const scripts = [{ getAttribute: name => name === 'src' ? '/scripts/extensions/third-party/LEASE-Vector-Memory/index.js?v=4.2.6' : null }];
  const sandbox = {
    document: { currentScript: null, getElementsByTagName: tag => tag === 'script' ? scripts : [] },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(`globalThis.getExtensionPath = ${getPathSource}`, sandbox);
  assert.equal(sandbox.getExtensionPath(), '/scripts/extensions/third-party/LEASE-Vector-Memory');
});

test('自动隐藏实现存在并只隐藏保留范围之前的普通对话', async () => {
  const sandbox = {
    window: { LeaseVectorMemory: {} },
    C: { masterSwitch: true, contextLimit: true, contextLimitCount: 2 },
    console,
    $: () => ({ length: 0, attr() {} })
  };
  let saveCount = 0;
  const ctx = {
    chat: [
      { role: 'system', content: 'preset' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: 'injected', isGaigaiData: true },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' }
    ],
    async saveChat() { saveCount++; }
  };
  sandbox.m = { ctx: () => ctx };
  vm.createContext(sandbox);
  vm.runInContext(`
    ${extractBlock(indexSource, 'function getHiddenMessageIndices(')}
    ${extractBlock(indexSource, 'async function silentHideMessages(')}
    ${extractBlock(indexSource, 'async function applyContextLimitHiding(')}
    globalThis.applyContextLimitHiding = applyContextLimitHiding;
  `, sandbox);

  const result = await sandbox.applyContextLimitHiding();
  assert.equal(result.hidden, 2);
  assert.equal(ctx.chat[1].is_system, true);
  assert.equal(ctx.chat[2].is_system, true);
  assert.equal(ctx.chat[4].is_system, undefined);
  assert.equal(ctx.chat[5].is_system, undefined);
  assert.equal(saveCount, 1);
  assert.match(indexSource, /window\.LeaseVectorMemory\.applyContextLimitHiding = applyContextLimitHiding/);
});

test('热表格默认注入到 Start a new Chat system 之前', () => {
  const getInjectionPositionSource = extractBlock(indexSource, 'function getInjectionPosition(');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`globalThis.getInjectionPosition = ${getInjectionPositionSource}`, sandbox);

  const chat = [
    { role: 'system', content: 'preset' },
    { role: 'system', content: '[Start a new Chat]' },
    { role: 'user', content: 'old user' },
    { role: 'assistant', content: 'old assistant' },
    { role: 'user', content: 'current user' }
  ];
  assert.equal(sandbox.getInjectionPosition(0, chat), 1);
  assert.equal(sandbox.getInjectionPosition(2, chat), 1);
  assert.equal(sandbox.getInjectionPosition(0, chat.slice(0, 2)), 1);
  assert.equal(sandbox.getInjectionPosition(0, [
    { role: 'user', parts: [{ text: 'preset' }] },
    { role: 'user', parts: [{ text: '[Start a new Chat]' }] },
    { role: 'user', parts: [{ text: 'current user' }] }
  ]), 1);
  assert.match(indexSource, /const position = getInjectionPosition\(C\.tableDepth, ev\.chat\)/);
});

test('热表格和冷向量默认都位于 Start a new Chat system 之前', () => {
  const sandbox = { console, C: { tableDepth: 0 } };
  vm.createContext(sandbox);
  vm.runInContext(`
    ${extractBlock(indexSource, 'function getInjectionPosition(')}
    ${extractBlock(indexSource, 'function createVectorInjectionMeta(')}
    ${extractBlock(indexSource, 'function requestBodyContainsVectorMarker(')}
    ${extractBlock(indexSource, 'function requestBodyContainsVectorText(')}
    ${extractBlock(indexSource, 'function detectPrimaryRequestArray(')}
    ${extractBlock(indexSource, 'function injectVectorIntoRequestBody(')}
    globalThis.injectVectorIntoRequestBody = injectVectorIntoRequestBody;
  `, sandbox);

  const body = {
    messages: [
      { role: 'system', content: 'preset' },
      { role: 'system', content: '【当前热记忆】', isGaigaiData: true },
      { role: 'system', content: '[Start a new Chat]' },
      { role: 'user', content: 'current user' }
    ]
  };
  const result = sandbox.injectVectorIntoRequestBody(body, '召回的冷记忆');
  assert.equal(result.injected, true);
  assert.equal(result.meta.mode, 'array_insert');
  assert.equal(result.meta.merged, false);
  assert.equal(body.messages.length, 5);
  assert.equal(body.messages[1].isGaigaiData, true);
  assert.equal(body.messages[2].isGaigaiVector, true);
  assert.match(body.messages[2].content, /召回的冷记忆/);
  assert.match(body.messages[3].content, /\[Start a new Chat\]/);
});

test('最终请求会把世界书前的提前注入记忆重新归位到 Start a new Chat 前', () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`
    ${extractBlock(indexSource, 'function detectPrimaryRequestArray(')}
    ${extractBlock(indexSource, 'function normalizeStandaloneMemoryPosition(')}
    globalThis.normalizeStandaloneMemoryPosition = normalizeStandaloneMemoryPosition;
  `, sandbox);

  const body = {
    messages: [
      { role: 'system', content: '预设第一条' },
      { role: 'system', name: 'SYSTEM(热记忆-主线剧情)', content: '热表', isGaigaiData: true },
      { role: 'system', content: '冷向量', isGaigaiVector: true },
      { role: 'system', content: '世界书内容' },
      { role: 'system', content: '[Start a new Chat]' },
      { role: 'user', content: '当前消息' }
    ]
  };
  body.messages[2].content = '【系统检索到的历史记忆片段】\n\n冷向量';
  const result = sandbox.normalizeStandaloneMemoryPosition(body);
  assert.equal(result.moved, 2);
  assert.equal(body.messages[1].content, '世界书内容');
  assert.equal(body.messages[2].isGaigaiData, true);
  assert.equal(body.messages[3].isGaigaiVector, true);
  assert.match(body.messages[4].content, /\[Start a new Chat\]/);
  assert.ok((indexSource.match(/normalizeStandaloneMemoryPosition\(/g) || []).length >= 5);
});
