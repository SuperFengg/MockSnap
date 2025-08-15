(function () {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  // Scroll lock helpers for modal（仅阻止背后滚动，允许弹窗内滚动）
  const onScrollBlock = (e) => {
    try {
      const mask = modal; // #modal
      // 仅在遮罩显示时阻止，并允许在弹窗内部滚动
      if (!mask || mask.style.display !== 'flex') return;
      const panel = mask.querySelector('.modal');
      if (panel && panel.contains(e.target)) return; // 允许弹窗内部滚动
      e.preventDefault();
    } catch (_e) { }
  };
  const lockScroll = () => {
    try {
      document.body.style.overflow = 'hidden';
      document.addEventListener('wheel', onScrollBlock, { passive: false });
      document.addEventListener('touchmove', onScrollBlock, { passive: false });
    } catch (_e) { }
  };
  const unlockScroll = () => {
    try {
      document.body.style.overflow = '';
      document.removeEventListener('wheel', onScrollBlock, { passive: false });
      document.removeEventListener('touchmove', onScrollBlock, { passive: false });
    } catch (_e) { }
  };

  // 保证返回合法 JSON 字符串；若不是 JSON，则包一层字符串，避免后续 JSON.parse 报错
  const formatJSON = (str) => { try { return JSON.stringify(JSON.parse(str), null, 2); } catch (_e) { return JSON.stringify(str || ''); } };
  const escapeHtml = (s) => (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const deb = (fn, wait = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, a), wait); } };

  const loadAll = () => new Promise((resolve) => { chrome.storage.local.get(["requestRecordsByDomain", "mockPluginRules"], (res) => { resolve({ map: res.requestRecordsByDomain || {}, rules: res.mockPluginRules || [] }); }); });
  const saveAll = (data) => new Promise((resolve) => { chrome.storage.local.set(data, () => resolve()); });

  const root = $('#root');
  const tabs = $('#tabs');
  const modal = $('#modal');
  const drawerMask = (() => document.getElementById('drawerMask'))();
  const onBack = () => window.location.href = 'native.html';
  const onClearAll = async () => { await saveAll({ requestRecordsByDomain: {} }); render(); };
  const onSearch = deb(render, 200);

  function toRuleFromRecord(rec) {
    // 将完整 URL 转成不含域名的相对路径（pathname + search），以便适配多域名环境
    let relative = rec.url || '';
    try {
      const u = new URL(rec.url, location.href);
      relative = (u.pathname || '/') + (u.search || '');
    } catch (_e) {
      // 非法 URL 或已是相对路径：保留原值
    }
    return {
      apiUrl: relative,
      apiName: '',
      isOpen: true,
      method: rec.method || 'GET',
      delay: 0,
      statusCode: rec.status || 200,
      apiKey: Date.now().toString(),
      filterType: 'contains',
      arrLength: 3,
      arrDepth: 4,
      mockWay: 'normal',
      redirectURL: '',
      requestBody: rec.requestBody || '',
      mockResponseData: formatJSON(rec.responseBody || '')
    };
  }

  async function openChooseGroupDialog(rules) {
    return new Promise(resolve => {
      try {
        const mask = document.getElementById('chooseGroupMask');
        const sel = document.getElementById('chooseGroupSelect');
        if (!mask || !sel) return resolve(null);
        sel.innerHTML = (rules || []).map(g => `<option value="${g.apiDocKey}">${(g.label || '未命名')} (${(g.apiArr || []).length})</option>`).join('');
        const onClose = () => { mask.style.display = 'none'; document.body.style.overflow = ''; };
        document.getElementById('chooseGroupClose').onclick = () => { onClose(); resolve(null); };
        document.getElementById('chooseGroupCancel').onclick = () => { onClose(); resolve(null); };
        document.getElementById('chooseGroupOk').onclick = () => { const v = sel.value; onClose(); resolve(v || null); };
        mask.style.display = 'flex'; document.body.style.overflow = 'hidden';
      } catch (_e) { resolve(null); }
    });
  }

  async function addRulesFromSelection(domain, selectedKeys) {
    const { map, rules } = await loadAll();
    const recs = (map[domain] || []).filter((_, i) => selectedKeys.has(i));
    if (!recs.length) return;
    // 如果存在多个分组，让用户选择目标分组；否则沿用原逻辑（唯一分组）
    let targetIndex = -1;
    if (rules.length <= 0) {
      const now = Date.now().toString();
      rules.push({ label: 'Default', apiDocKey: now, pageDomain: '', apiDocUrl: '', apiArr: [], dataWrapper: '', requestHeaders: '' });
      targetIndex = rules.length - 1;
    } else if (rules.length === 1) {
      targetIndex = 0;
    } else {
      const chosen = await openChooseGroupDialog(rules);
      if (!chosen) return; // 取消
      targetIndex = rules.findIndex(g => g.apiDocKey === chosen);
      if (targetIndex < 0) targetIndex = 0;
    }
    const arr = rules[targetIndex].apiArr || [];
    for (const r of recs) { arr.unshift(toRuleFromRecord(r)); }
    rules[targetIndex].apiArr = arr;
    await saveAll({ mockPluginRules: rules });
    alert('已添加为 Mock 规则');
  }

  async function clearDomain(domain) {
    const { map } = await loadAll();
    delete map[domain];
    await saveAll({ requestRecordsByDomain: map });
    render();
  }

  async function deleteRecord(domain, originalIndex) {
    const { map } = await loadAll();
    const list = map[domain] || [];
    if (originalIndex >= 0 && originalIndex < list.length) {
      list.splice(originalIndex, 1);
      if (list.length > 0) {
        map[domain] = list;
      } else {
        delete map[domain];
      }
      await saveAll({ requestRecordsByDomain: map });
      render();
    }
  }

  function matchesSearch(rec, keyword) {
    if (!keyword) return true;
    const k = keyword.toLowerCase();
    return (rec.url || '').toLowerCase().includes(k)
      || (rec.method || '').toLowerCase().includes(k)
      || (rec.responseBody || '').toLowerCase().includes(k)
      || (rec.requestBody || '').toLowerCase().includes(k);
  }

  // 简易弹窗：在独立弹窗中分 Tab 显示请求体/响应体
  function openModal(title, requestBody, responseBody) {
    const html = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${escapeHtml(title || '数据查看')}</div>
          <div class="modal-close" id="modalClose">×</div>
        </div>
        <div class="modal-tabs">
          <div class="tab-item active" data-k="req">请求体</div>
          <div class="tab-item" data-k="res">响应体</div>
        </div>
        <div class="modal-body">
          <pre id="modalContent">${escapeHtml(formatJSON(requestBody || ''))}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn" id="closeBtn">关闭</button>
        </div>
      </div>`;
    modal.innerHTML = html; modal.style.display = 'flex'; lockScroll();
    const setTab = (k) => {
      const items = $$('.modal-tabs .tab-item', modal);
      items.forEach(it => it.classList.remove('active'));
      const target = $(`.modal-tabs .tab-item[data-k="${k}"]`, modal);
      target && target.classList.add('active');
      $('#modalContent', modal).textContent = (k === 'req') ? formatJSON(requestBody || '') : formatJSON(responseBody || '');
    };
    $$('.modal-tabs .tab-item', modal).forEach(it => { it.addEventListener('click', () => setTab(it.getAttribute('data-k'))); });
    const close = () => { modal.style.display = 'none'; unlockScroll(); };
    $('#modalClose', modal).addEventListener('click', close);
    $('#closeBtn', modal).addEventListener('click', close);
  }

  async function render() {
    const keyword = ($('#search').value || '').trim();
    const { map } = await loadAll();
    const domains = Object.keys(map).sort();
    if (!domains.length) {
      if (tabs) tabs.innerHTML = '';
      root.innerHTML = '<div class="muted" style="padding:24px;">暂无记录</div>';
      return;
    }

    // 构建 tabs
    if (tabs) {
      const activeKey = (tabs.getAttribute('data-active') || domains[0]);
      const badges = domains.map(d => (map[d] || []).length);
      tabs.innerHTML = domains.map((d, idx) => `<div class="tab-item ${d === activeKey ? 'active' : ''}" data-k="${d}">${d}<span class="tab-badge" data-count="${badges[idx]}">${badges[idx]}</span></div>`).join('');
      $$('.tab-item', tabs).forEach(it => { it.addEventListener('click', () => { tabs.setAttribute('data-active', it.getAttribute('data-k')); render(); }); });
    }
    const activeDomain = tabs ? (tabs.getAttribute('data-active') || domains[0]) : domains[0];
    const domain = domains.includes(activeDomain) ? activeDomain : domains[0];
    const list = (map[domain] || []).map((x, i) => Object.assign({ __idx: i }, x)).filter(x => matchesSearch(x, keyword));
    const rows = list.map(rec => {
      const time = new Date(rec.createdAt || Date.now()).toLocaleString();
      const meth = (rec.method || 'GET').toUpperCase();
      return `<tr>
          <td><input type="checkbox" class="checkbox item" data-domain="${domain}" data-idx="${rec.__idx}" /></td>
          <td><span class="badge ${meth}">${meth}</span></td>
          <td class="url">${escapeHtml(rec.url || '')}</td>
          <td class="muted">${escapeHtml(time)}</td>
          <td>
            <button class="btn" data-view="${rec.__idx}">查看</button>
            <button class="btn danger" data-del="${rec.__idx}">删除</button>
          </td>
        </tr>`;
    }).join('');
    root.innerHTML = `
      <div class="group-actions">
        <button class="btn primary to-mock" data-domain="${domain}">设为 Mock 规则</button>
        <button class="btn danger clear-domain" data-domain="${domain}">清空该域名</button>
        <button class="btn danger" id="btnBatchDeleteRecords" data-domain="${domain}" style="display:none;margin-left:8px;">批量删除</button>
        <span class="muted">共 ${list.length} 条</span>
      </div>
      <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-method"><input type="checkbox" class="checkbox select-all" data-domain="${domain}" /></th>
            <th class="col-method">方法</th>
            <th class="col-url">URL</th>
            <th class="col-time">时间</th>
            <th class="col-data">数据</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>`;

    // 选择框：全选/反选
    const headerSelect = $('#root .select-all');
    const updateHeaderSelectState = () => {
      const all = $$('#root .item').filter(b => b.getAttribute('data-domain') === domain);
      const total = all.length;
      const checked = all.filter(b => b.checked).length;
      if (headerSelect) {
        headerSelect.indeterminate = checked > 0 && checked < total;
        headerSelect.checked = total > 0 && checked === total;
      }
      const batchBtn = byId('btnBatchDeleteRecords');
      if (batchBtn) batchBtn.style.display = checked > 0 ? 'inline-flex' : 'none';
    };

    // 行悬浮与选中样式（选中任意一列的 checkbox 即高亮整行）
    $$('#root .item').forEach(box => {
      const tr = box.closest('tr');
      const sync = () => {
        if (box.checked) tr.classList.add('selected');
        else tr.classList.remove('selected');
      };
      box.addEventListener('change', () => {
        sync();
        updateHeaderSelectState();
      });
      sync();
    });

    if (headerSelect) {
      headerSelect.addEventListener('change', () => {
        const all = $$('#root .item').filter(b => b.getAttribute('data-domain') === domain);
        // 先设置所有勾选框状态，但不触发 change 事件
        all.forEach(box => {
          box.checked = headerSelect.checked;
        });
        // 手动更新行选中样式
        all.forEach(box => {
          const tr = box.closest('tr');
          if (box.checked) tr.classList.add('selected');
          else tr.classList.remove('selected');
        });
        // 最后更新表头状态
        updateHeaderSelectState();
      });
    }
    updateHeaderSelectState();

    // 批量删除已勾选记录
    const batchBtn = byId('btnBatchDeleteRecords');
    if (batchBtn) {
      batchBtn.addEventListener('click', async () => {
        const all = $$('#root .item').filter(b => b.getAttribute('data-domain') === domain);
        const idxs = all.filter(b => b.checked).map(b => parseInt(b.getAttribute('data-idx'), 10)).filter(Number.isFinite);
        if (idxs.length === 0) return;
        const ok = window.confirm(`确定要删除选中的 ${idxs.length} 条记录吗？`);
        if (!ok) return;
        // 批量删除：从大到小删除，避免索引偏移
        idxs.sort((a, b) => b - a);
        const { map } = await loadAll();
        const list = map[domain] || [];
        for (const i of idxs) { if (i >= 0 && i < list.length) list.splice(i, 1); }
        if (list.length > 0) map[domain] = list; else delete map[domain];
        await saveAll({ requestRecordsByDomain: map });
        render();
      });
    }

    // bind to mock
    $$('#root .to-mock').forEach(el => {
      el.addEventListener('click', async () => {
        const domain = el.getAttribute('data-domain');
        const selected = new Set();
        $$('#root .item').forEach(box => { if (box.checked && box.getAttribute('data-domain') === domain) selected.add(parseInt(box.getAttribute('data-idx'), 10)); });
        await addRulesFromSelection(domain, selected);
      });
    });
    // clear this domain
    $$('#root .clear-domain').forEach(el => {
      el.addEventListener('click', async () => { const domain = el.getAttribute('data-domain'); await clearDomain(domain); pulseActiveTabBadge(); });
    });

    // 查看数据（弹窗）
    $$('#root [data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-view'), 10);
        const rec = list.find(x => x.__idx === idx);
        if (!rec) return;
        openModal(`${rec.method} ${rec.url}`, rec.requestBody, rec.responseBody);
      });
    });
    // 删除单条记录
    $$('#root [data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.getAttribute('data-del'), 10);
        if (!Number.isFinite(idx)) return;
        const ok = window.confirm('确定要删除这条请求记录吗？');
        if (!ok) return;
        await deleteRecord(domain, idx);
      });
    });
    updateHeaderSelectState();
    pulseActiveTabBadge();
  }

  function pulseActiveTabBadge() {
    if (!tabs) return; const active = $('.tab-item.active .tab-badge', tabs); if (!active) return;
    active.classList.add('pulse'); setTimeout(() => active.classList.remove('pulse'), 220);
  }

  // events
  $('#btnBack').addEventListener('click', onBack);
  $('#btnClearAll').addEventListener('click', onClearAll);
  $('#search').addEventListener('input', onSearch);
  // open settings drawer
  const btnSettings = document.getElementById('btnSettings');
  if (btnSettings && drawerMask) {
    const addFilterRow = (val = '', type = 'contains') => {
      const wrap = document.getElementById('urlFilters');
      const row = document.createElement('div');
      row.style.display = 'flex'; row.style.gap = '6px'; row.style.marginBottom = '6px'; row.style.alignItems = 'center';
      row.innerHTML = `<select class="selType" style="height:32px;border:1px solid #d9d9d9;border-radius:6px;">
          <option value="contains">包含</option>
          <option value="path">路径匹配</option>
          <option value="regexp">正则匹配</option>
        </select>
        <input class="txtVal" style="flex:1;height:32px;border:1px solid #d9d9d9;border-radius:6px;padding:0 8px;" placeholder="/api/list 或正则 /users/\\d+" />
        <button class="btn danger btnDelRow">删除</button>`;
      wrap.appendChild(row);
      row.querySelector('.selType').value = type || 'contains';
      row.querySelector('.txtVal').value = val || '';
      row.querySelector('.btnDelRow').addEventListener('click', () => row.remove());
    };
    const openDrawer = async () => {
      // 读取已保存设置
      chrome.storage.local.get(['__recorderSettings'], (res) => {
        const set = res.__recorderSettings || {};
        (document.getElementById('setDomains') || {}).value = (set.domains || []).join('\n');
        const wrap = document.getElementById('urlFilters'); wrap.innerHTML = '';
        (set.urls || []).forEach(u => addFilterRow(u.value, u.type));
        drawerMask.style.display = 'flex';
        document.body.style.overflow = 'hidden';
      });
    };
    const closeDrawer = () => { drawerMask.style.display = 'none'; document.body.style.overflow = ''; };
    btnSettings.addEventListener('click', openDrawer);
    document.getElementById('drawerClose').addEventListener('click', closeDrawer);
    document.getElementById('drawerCancel').addEventListener('click', closeDrawer);
    document.getElementById('btnAddUrlFilter').addEventListener('click', () => addFilterRow());
    document.getElementById('drawerSave').addEventListener('click', () => {
      try {
        const domainsRaw = (document.getElementById('setDomains').value || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
        const urls = Array.from(document.querySelectorAll('#urlFilters > div')).map(row => ({
          type: row.querySelector('.selType').value,
          value: row.querySelector('.txtVal').value.trim()
        })).filter(x => x.value);
        const data = { domains: domainsRaw, urls };
        chrome.storage.local.set({ '__recorderSettings': data }, () => { closeDrawer(); });
      } catch (_e) { closeDrawer(); }
    });
  }
  // 移除主题切换逻辑

  render();
  // 自动刷新：监听存储变更
  try {
    chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.requestRecordsByDomain) {
        render();
      }
    });
  } catch (_e) { }
})();


