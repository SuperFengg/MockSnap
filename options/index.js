/*
  原生 Mock 规则配置页逻辑（不依赖 React/AntD）
  - 分组（tabs）管理
  - 规则增删改/开关/拖拽顺序（简化：此处暂不实现拖拽）
  - 导入/导出
  - 全局 Mock 开关
  - 搜索过滤
  - 与 chrome.storage.local 读写兼容：mockPluginRules / mockPluginSwitchOn
*/
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const byId = id => document.getElementById(id);

  const STORAGE_RULES = 'mockPluginRules';
  const STORAGE_SWITCH = 'mockPluginSwitchOn';

  let rules = []; // [{label, apiDocKey, pageDomain, apiArr:[...]}]
  let activeKey = '';
  let keyword = '';
  let selectedKeys = new Set(); // 行勾选（批量删除）

  const Modal = window.Modal = {
    open: id => { byId(id).style.display = 'flex'; try { document.body.style.overflow = 'hidden'; } catch (_e) { } },
    close: id => { byId(id).style.display = 'none'; try { document.body.style.overflow = ''; } catch (_e) { } }
  };

  function uuid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)); }
  async function ensureUniqueApiKeys() {
    let changed = false;
    const seen = new Set();
    (rules || []).forEach(g => {
      g.apiArr = (g.apiArr || []).map(r => {
        let k = r.apiKey;
        if (!k || seen.has(k)) { k = uuid(); changed = true; }
        seen.add(k);
        return { ...r, apiKey: k };
      });
    });
    if (changed) { await writeStorage({ [STORAGE_RULES]: rules }); }
  }
  function readStorage(keys) { return new Promise(res => { chrome.storage && chrome.storage.local.get(keys, data => res(data || {})); }); }
  function writeStorage(obj) { return new Promise(res => { chrome.storage && chrome.storage.local.set(obj, () => res()); }); }

  async function init() {
    const data = await readStorage([STORAGE_RULES, STORAGE_SWITCH]);
    rules = Array.isArray(data[STORAGE_RULES]) ? data[STORAGE_RULES] : [];
    if (!rules.length) {
      const key = uuid();
      rules = [{ label: 'Default', apiDocKey: key, pageDomain: '', apiDocUrl: '', apiArr: [], dataWrapper: '', requestHeaders: '' }];
      activeKey = key;
      await writeStorage({ [STORAGE_RULES]: rules });
    } else {
      activeKey = rules[0].apiDocKey;
    }
    // 修复历史数据中重复/缺失的 apiKey，避免选择样式错乱
    await ensureUniqueApiKeys();
    byId('globalSwitch').checked = !!data[STORAGE_SWITCH];
    // 去除主题逻辑
    renderTabs();
    renderTable();
    bindEvents();
    // 统一处理关闭按钮（避免内联事件）
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-close]');
      if (el) { const id = el.getAttribute('data-close'); Modal.close(id); }
    });
    // 监听存储变化：在记录页新增规则后自动更新当前页（无刷新）
    try {
      chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.mockPluginRules) {
          const newRules = changes.mockPluginRules.newValue || [];
          const prev = activeKey;
          rules = Array.isArray(newRules) ? newRules : [];
          if (!rules.find(g => g.apiDocKey === prev)) {
            activeKey = (rules[0] && rules[0].apiDocKey) || '';
          }
          renderTabs();
          renderTable();
        }
        if (changes.mockPluginSwitchOn) {
          const v = !!changes.mockPluginSwitchOn.newValue;
          const sw = byId('globalSwitch'); if (sw) sw.checked = v;
        }
      });
    } catch (_e) { }
  }

  function renderTabs() {
    const tabs = byId('tabs');
    tabs.innerHTML = rules.map(g => {
      const count = (g.apiArr || []).length;
      return `<div class="tab-item ${g.apiDocKey === activeKey ? 'active' : ''}" data-k="${g.apiDocKey}">${g.label}<span class="tab-badge" data-count="${count}">${count}</span><span class="close" data-close="${g.apiDocKey}">×</span></div>`;
    }).join('');
    $$('.tab-item', tabs).forEach(el => {
      el.addEventListener('click', _e => {
        const k = el.getAttribute('data-k');
        if (k) { activeKey = k; selectedKeys.clear(); renderTabs(); renderTable(); }
      });
    });
    // 关闭分组
    $$('[data-close]', tabs).forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); const k = el.getAttribute('data-close'); deleteGroup(k); });
    });
  }

  function getActiveGroup() { return rules.find(g => g.apiDocKey === activeKey) || rules[0]; }

  function filterList(list) { if (!keyword) return list; const k = keyword.toLowerCase(); return list.filter(r => (r.apiUrl || '').toLowerCase().includes(k) || (r.apiName || '').toLowerCase().includes(k)); }

  function renderTable() {
    const tbody = byId('ruleTbody');
    const g = getActiveGroup();
    const list = filterList(g.apiArr || []);
    // 更新 group-actions 右侧计数，与请求记录页一致
    const tip = byId('countTip');
    if (tip) tip.textContent = `共 ${list.length} 条`;
    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty">
            <div class="icon">🗂️</div>
            <div class="desc">当前分组暂无规则</div>
            <div class="actions">
              <button id="emptyAdd" class="btn primary">添加规则</button>
              <button id="emptyImport" class="btn ghost">导入配置</button>
            </div>
          </td>
        </tr>`;
      const add = byId('emptyAdd'); const imp = byId('emptyImport');
      add && add.addEventListener('click', () => openRule());
      imp && imp.addEventListener('click', () => byId('importFile').click());
      updateHeaderSelectState();
      return;
    }
    tbody.innerHTML = list.map(it => rowHtml(it)).join('');
    // 绑定开关/按钮
    $$('.row-enable').forEach(el => {
      el.addEventListener('change', () => { updateRule(el.dataset.key, { isOpen: el.checked }); });
    });
    $$('.btn-edit').forEach(el => {
      el.addEventListener('click', () => openRule(el.dataset.key));
    });
    $$('.btn-del').forEach(el => {
      el.addEventListener('click', () => deleteRule(el.dataset.key));
    });
    $$('.btn-clone').forEach(el => {
      el.addEventListener('click', () => cloneRule(el.dataset.key));
    });
    // 行选择（批量删除，完全由 JS 控制 .selected）
    $$('.row-select').forEach(el => {
      const sync = () => {
        const key = el.dataset.key;
        const checked = el.checked || selectedKeys.has(key);
        if (checked) selectedKeys.add(key); else selectedKeys.delete(key);
        updateRowSelectedClass(key, checked);
        updateHeaderSelectState();
      };
      el.addEventListener('change', sync);
      // 初始同步
      el.checked = selectedKeys.has(el.dataset.key);
      sync();
    });
    // 单行点击整行复选
    $$('#ruleTbody tr').forEach(tr => {
      tr.addEventListener('click', (e) => {
        const cb = tr.querySelector('.row-select');
        if (!cb) return;
        // 避免点击按钮、开关标签、行内勾选框时被行点击二次切换
        if (e.target.closest('button') || e.target.closest('label') || e.target.closest('.row-select')) return;
        cb.checked = !cb.checked; const k = cb.dataset.key; if (cb.checked) selectedKeys.add(k); else selectedKeys.delete(k); updateRowSelectedClass(k, cb.checked); updateHeaderSelectState();
      });
    });
    // 初次渲染确保选中样式同步（兜底）
    list.forEach(it => { const on = selectedKeys.has(it.apiKey); updateRowSelectedClass(it.apiKey, on); });
    updateHeaderSelectState();
  }

  function rowHtml(it) {
    const delay = it.delay ? `${it.delay}ms` : '无延迟';
    const wayText = ({ normal: 'Modify API Response', swagger: 'Modify API Response', redirect: 'Redirect', modifyHeaders: 'Modify Headers', modifyRequestBody: 'Modify Request Body' })[it.mockWay] || it.mockWay;
    return `<tr class="row-add">
      <td><input type="checkbox" class="row-select checkbox" data-key="${it.apiKey}" title="勾选以进行批量删除" /></td>
      <td><label class="switch"><input class="row-enable" data-key="${it.apiKey}" type="checkbox" ${it.isOpen ? 'checked' : ''} /><span class="slider"></span></label></td>
      <td><span class="pill">${wayText}</span></td>
      <td><span class="pill">${(it.method || '').toUpperCase()}</span></td>
      <td>${it.apiName || '--'}</td>
      <td class="muted">${it.apiUrl || ''}</td>
      <td>${it.filterType || 'contains'}</td>
      <td>${delay}</td>
      <td class="op">
        <button class="btn btn-edit" data-key="${it.apiKey}">编辑</button>
        <button class="btn" data-key="${it.apiKey} btn-clone">克隆</button>
        <button class="btn danger btn-del" data-key="${it.apiKey}">删除</button>
      </td>
    </tr>`;
  }

  function bindEvents() {
    byId('globalSwitch').addEventListener('change', async (e) => {
      await writeStorage({ [STORAGE_SWITCH]: e.target.checked });
      chrome.runtime && chrome.runtime.sendMessage && chrome.runtime.sendMessage(chrome.runtime.id, { type: 'overrideAJAX', key: 'mockPluginSwitchOn', value: e.target.checked });
    });
    byId('search').addEventListener('input', e => { keyword = e.target.value.trim(); renderTable(); });
    byId('btnAddGroup').addEventListener('click', () => openGroup(true));
    byId('btnAddRule').addEventListener('click', () => openRule());
    byId('btnEditGroup').addEventListener('click', () => openGroup());
    byId('btnSaveGroup').addEventListener('click', saveGroup);
    byId('btnSaveRule').addEventListener('click', saveRule);
    byId('btnExport').addEventListener('click', onExport);
    byId('importFile').addEventListener('change', onImport);
    // 移除主题切换逻辑
    const header = byId('headerEnable');
    header && header.addEventListener('change', (e) => { toggleAll(e.target.checked); });
    const headerState = byId('headerEnableState'); if (headerState) headerState.textContent = '--';
    const headerSelect = byId('headerSelect');
    headerSelect && headerSelect.addEventListener('change', (e) => { // 勾选全选/全不选
      const g = getActiveGroup(); const list = filterList(g.apiArr || []);
      if (e.target.checked) { selectedKeys = new Set(list.map(x => x.apiKey)); }
      else { selectedKeys.clear(); }
      renderTable();
    });
    // 批量删除按钮（根据选中数显示/隐藏）。在工具栏右侧容器存在时插入
    injectBatchDeleteButton(false);
    injectMoveButton(false);
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#btnBatchDelete'); if (!btn) return;
      if (selectedKeys.size === 0) { alert('请先勾选要删除的规则'); return; }
      if (!confirm('确定要删除选中的规则吗？')) return;
      const g = getActiveGroup(); g.apiArr = (g.apiArr || []).filter(x => !selectedKeys.has(x.apiKey)); selectedKeys.clear(); persist(true).then(() => { renderTable(); });
    });
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('#btnMoveTo'); if (!btn) return;
      if (selectedKeys.size === 0) { alert('请先勾选要移动的规则'); return; }
      await openMoveDialog();
    });
  }

  function openGroup(isCreate) {
    const t = document.getElementById('groupTitle'); if (t) t.textContent = isCreate ? '新增分组' : '编辑分组';
    const g = isCreate ? { label: '', pageDomain: '', apiDocUrl: '', dataWrapper: '', requestHeaders: '' } : getActiveGroup();
    byId('groupMask').dataset.create = isCreate ? '1' : '';
    byId('g_label').value = g.label || '';
    byId('g_domain').value = g.pageDomain || '';
    byId('g_doc').value = g.apiDocUrl || '';
    byId('g_wrapper').value = g.dataWrapper || '';
    byId('g_headers').value = g.requestHeaders || '';
    Modal.open('groupMask');
  }
  async function saveGroup() {
    const isCreate = !!(byId('groupMask').dataset.create);
    const obj = {
      label: byId('g_label').value.trim() || 'Default',
      pageDomain: (byId('g_domain').value || '').trim(),
      apiDocUrl: (byId('g_doc').value || '').trim(),
      dataWrapper: safeJson(byId('g_wrapper').value),
      requestHeaders: safeCompactJson(byId('g_headers').value)
    };
    if (isCreate) {
      const key = uuid();
      rules = rules.concat([{ label: obj.label, apiDocKey: key, pageDomain: obj.pageDomain, apiDocUrl: obj.apiDocUrl, apiArr: [], dataWrapper: obj.dataWrapper, requestHeaders: obj.requestHeaders }]);
      activeKey = key;
    } else {
      const g = getActiveGroup();
      g.label = obj.label; g.pageDomain = obj.pageDomain; g.apiDocUrl = obj.apiDocUrl; g.dataWrapper = obj.dataWrapper; g.requestHeaders = obj.requestHeaders;
    }
    await persist();
    Modal.close('groupMask');
    renderTabs(); renderTable();
  }

  function openRule(apiKey) {
    const g = getActiveGroup();
    const it = (g.apiArr || []).find(x => x.apiKey === apiKey) || {
      apiKey: uuid(), isOpen: true, mockWay: 'normal', filterType: 'contains', method: 'GET', delay: 0, statusCode: 200,
      apiUrl: '', apiName: '', requestBody: '', mockResponseData: '', redirectURL: ''
    };
    byId('ruleTitle').textContent = apiKey ? '编辑-Modify API Response' : '添加-Modify API Response';
    byId('r_filter').value = it.filterType || 'contains';
    byId('r_method').value = (it.method || 'GET').toUpperCase();
    byId('r_status').value = it.statusCode || 200;
    byId('r_delay').value = it.delay || 0;
    byId('r_url').value = it.apiUrl || '';
    byId('r_name').value = it.apiName || '';
    byId('r_way').value = it.mockWay || 'normal';
    byId('r_body').value = it.requestBody || '';
    byId('r_resp').value = formatJson(it.mockResponseData || '');
    byId('r_redirect').value = it.redirectURL || '';
    byId('ruleMask').dataset.editKey = apiKey || '';
    Modal.open('ruleMask');
  }

  async function saveRule() {
    const editKey = byId('ruleMask').dataset.editKey;
    const g = getActiveGroup();
    const obj = {
      apiKey: editKey || uuid(), isOpen: true,
      mockWay: byId('r_way').value,
      filterType: byId('r_filter').value,
      method: byId('r_method').value,
      statusCode: parseInt(byId('r_status').value || '200', 10),
      delay: parseInt(byId('r_delay').value || '0', 10),
      apiUrl: (byId('r_url').value || '').trim(),
      apiName: (byId('r_name').value || '').trim(),
      requestBody: safeCompactJson(byId('r_body').value),
      mockResponseData: formatJson(safeJson(byId('r_resp').value)),
      redirectURL: (byId('r_redirect').value || '').trim()
    };
    if (editKey) {
      g.apiArr = (g.apiArr || []).map(x => x.apiKey === editKey ? { ...x, ...obj } : x);
    } else {
      g.apiArr = [obj].concat(g.apiArr || []);
    }
    await persist();
    Modal.close('ruleMask');
    renderTable();
    pulseActiveTabBadge();
  }

  async function updateRule(apiKey, patch) {
    const g = getActiveGroup();
    g.apiArr = (g.apiArr || []).map(x => x.apiKey === apiKey ? { ...x, ...patch } : x);
    await persist(true);
    renderTable();
  }
  async function deleteRule(apiKey) {
    const g = getActiveGroup();
    const tr = $(`#ruleTbody tr [data-key="${apiKey}"]`)?.closest('tr');
    if (tr) { tr.classList.remove('row-add'); tr.classList.add('row-remove'); await new Promise(r => setTimeout(r, 180)); }
    g.apiArr = (g.apiArr || []).filter(x => x.apiKey !== apiKey);
    await persist(true);
    renderTable();
    pulseActiveTabBadge();
  }
  async function cloneRule(apiKey) {
    const g = getActiveGroup();
    const it = (g.apiArr || []).find(x => x.apiKey === apiKey); if (!it) return;
    const cloned = { ...it, apiKey: uuid(), apiName: (it.apiName || '') + " (clone)" };
    g.apiArr = [cloned].concat(g.apiArr || []);
    await persist(true); renderTable(); pulseActiveTabBadge();
  }
  async function deleteGroup(key) {
    rules = rules.filter(g => g.apiDocKey !== key);
    if (!rules.length) { const k = uuid(); rules = [{ label: 'Default', apiDocKey: k, pageDomain: '', apiArr: [] }]; activeKey = k; }
    else if (activeKey === key) { activeKey = rules[0].apiDocKey; }
    await persist(); renderTabs(); renderTable();
  }

  async function onExport() {
    const a = document.createElement('a');
    const blob = new Blob([JSON.stringify(rules)], { type: 'application/json' });
    a.href = URL.createObjectURL(blob); a.download = `mockConfig-${new Date().toLocaleString().replace(/[/:\s]/g, '-')}.json`; a.click();
    URL.revokeObjectURL(a.href);
  }
  async function onImport(e) {
    const file = e.target.files[0]; if (!file) return; const text = await file.text();
    try { const data = JSON.parse(text); if (Array.isArray(data)) { rules = data; activeKey = rules[0].apiDocKey; await persist(); renderTabs(); renderTable(); pulseActiveTabBadge(true); } }
    catch (_e) { alert('导入失败，请检查数据源是否正确！'); }
    e.target.value = '';
  }

  async function persist(_silent) {
    await writeStorage({ [STORAGE_RULES]: rules });
    // 通知 background 更新 declarativeNetRequest 规则
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(chrome.runtime.id, { type: 'overrideAJAX', key: 'mockPluginRules', value: rules });
    }
  }

  async function toggleAll(on) { const g = getActiveGroup(); g.apiArr = (g.apiArr || []).map(x => ({ ...x, isOpen: on })); await persist(true); renderTable(); }

  function updateRowSelectedClass(key, on) {
    const nodes = $$(`#ruleTbody tr [data-key="${key}"]`);
    if (!nodes || nodes.length === 0) return;
    nodes.forEach(node => {
      const tr = node.closest('tr');
      if (!tr) return;
      if (on) tr.classList.add('selected'); else tr.classList.remove('selected');
    });
  }

  function updateHeaderSelectState() {
    const g = getActiveGroup(); const list = filterList(g.apiArr || []);
    const header = byId('headerEnable'); const label = byId('headerEnableState'); const hSel = byId('headerSelect');
    // 开关三态：全开/半开/全关
    const openCount = list.filter(x => x.isOpen).length;
    if (header) { header.checked = (openCount > 0 && openCount === list.length); header.indeterminate = (openCount > 0 && openCount < list.length); }
    // 勾选三态：全选/半选/不选
    const selCount = selectedKeys.size;
    if (hSel) { hSel.checked = (selCount > 0 && selCount === list.length); hSel.indeterminate = (selCount > 0 && selCount < list.length); }
    // 右侧文案同步显示（复用同一位置）
    let text = '--'; if (selCount === 0) text = '未选中'; else if (selCount < list.length) text = `部分选中 (${selCount})`; else text = `全部选中 (${selCount})`;
    if (label) label.textContent = text;
    injectBatchDeleteButton(selCount > 0);
    injectMoveButton(selCount > 0);
  }

  // Tab 数量徽标脉冲动画（与记录页一致的动效体验）
  function pulseActiveTabBadge(force) {
    const tabs = byId('tabs'); if (!tabs) return;
    const active = tabs.querySelector('.tab.active .badge'); if (!active) return;
    if (force) { active.classList.add('pulse'); setTimeout(() => active.classList.remove('pulse'), 220); return; }
    active.classList.add('pulse');
    setTimeout(() => { active.classList.remove('pulse'); }, 220);
  }

  function injectBatchDeleteButton(show) {
    let btn = document.getElementById('btnBatchDelete');
    if (!btn) {
      const actions = document.querySelector('.group-actions');
      if (!actions) return;
      btn = document.createElement('button');
      btn.id = 'btnBatchDelete';
      btn.className = 'btn danger';
      btn.textContent = '批量删除';
      // 放到“共 N 条”之前，若不存在则追加到末尾
      const countTip = document.getElementById('countTip');
      if (countTip && countTip.parentNode === actions) {
        actions.insertBefore(btn, countTip);
      } else {
        actions.appendChild(btn);
      }
    }
    btn.style.display = show ? 'inline-flex' : 'none';
  }

  function injectMoveButton(show) {
    let btn = document.getElementById('btnMoveTo');
    if (!btn) {
      const actions = document.querySelector('.group-actions'); if (!actions) return;
      btn = document.createElement('button'); btn.id = 'btnMoveTo'; btn.className = 'btn'; btn.textContent = '移动规则至';
      const countTip = document.getElementById('countTip');
      if (countTip && countTip.parentNode === actions) { actions.insertBefore(btn, countTip); } else { actions.appendChild(btn); }
    }
    btn.style.display = show ? 'inline-flex' : 'none';
  }

  async function openMoveDialog() {
    const selCount = selectedKeys.size; if (selCount === 0) return;
    const select = document.getElementById('moveGroupSelect'); if (!select) return;
    // 填充分组列表
    select.innerHTML = rules.map(g => `<option value="${g.apiDocKey}">${g.label || '未命名'}</option>`).join('');
    Modal.open('moveMask');
    const ok = document.getElementById('btnMoveOk');
    const handler = async () => {
      const target = select.value; if (!target) { Modal.close('moveMask'); return; }
      const from = getActiveGroup(); const to = rules.find(g => g.apiDocKey === target) || from;
      if (!to || !from) { Modal.close('moveMask'); return; }
      const moving = (from.apiArr || []).filter(x => selectedKeys.has(x.apiKey));
      from.apiArr = (from.apiArr || []).filter(x => !selectedKeys.has(x.apiKey));
      to.apiArr = moving.concat(to.apiArr || []);
      selectedKeys.clear();
      await persist(true);
      Modal.close('moveMask');
      // 若目标分组与当前不同，切换至目标分组
      if (to.apiDocKey !== activeKey) { activeKey = to.apiDocKey; renderTabs(); }
      renderTable();
      pulseActiveTabBadge(true);
      ok.removeEventListener('click', handler);
    };
    ok.addEventListener('click', handler);
  }

  // 注意：下方旧实现已移除，避免覆盖当前的注入逻辑

  function safeJson(str) { if (!str) return ''; try { return JSON.stringify(JSON.parse(str)); } catch (_e) { return str; } }
  function safeCompactJson(str) { if (!str) return ''; try { return JSON.stringify(JSON.parse(str)); } catch (_e) { return ''; } }
  function formatJson(str) { if (!str) return ''; try { return JSON.stringify(JSON.parse(str), null, 2); } catch (_e) { return str; } }

  init();
})();


