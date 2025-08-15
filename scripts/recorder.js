// Lightweight recorder injected into the page context.
// It records real network requests (XHR and Fetch) and skips those directly mocked by rules.
(function () {
  try {
    const MAX_BODY = 200000; // Limit response body length stored
    const MAX_REQ = 100000;  // Limit request body length stored

    const stringifySafe = (v) => {
      try { return typeof v === 'string' ? v : JSON.stringify(v); } catch (_e) { return ''; }
    };
    const normalizeUrl = (url) => {
      try { return new URL(url, location.href).href; } catch (_e) { return url; }
    };
    const sortJsonString = (str) => {
      if (!str) return '';
      try {
        const sortObjectKeysAndArray = (obj) => {
          if (Array.isArray(obj)) return obj.map(sortObjectKeysAndArray).sort((a, b) => {
            if (typeof a === 'number' && typeof b === 'number') return a - b;
            if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
            if (typeof a === 'number') return -1;
            if (typeof b === 'number') return 1;
            return 0;
          });
          if (obj && typeof obj === 'object') {
            const res = {}; const keys = Object.keys(obj).sort();
            for (const k of keys) res[k] = sortObjectKeysAndArray(obj[k]);
            return res;
          }
          return obj;
        };
        const v = sortObjectKeysAndArray(JSON.parse(str));
        return JSON.stringify(v);
      } catch (_e) { return ''; }
    };
    const isJSONContentType = (ct) => !!(ct && typeof ct === 'string' && ct.includes('application/json'));
    const checkRequestBody = (method, actualBody, targetBody) => {
      if (!targetBody) return true;
      if (!['POST', 'PUT'].includes((method || '').toUpperCase())) return true;
      return sortJsonString(actualBody) === sortJsonString(targetBody);
    };
    const pageDomainMatches = (pageDomain) => {
      if (!pageDomain) return true;
      const origin = location.origin;
      return pageDomain.split(/,|，|;|；/).some(d => d && d.trim().startsWith(origin));
    };
    const shouldSkipByRules = (url, method, body) => {
      try {
        const cfg = window.__overrideAJAX__ || {};
        // 当全局开关关闭时，直接跳过记录（保持原有行为）
        if (!cfg.mockPluginSwitchOn) return true;
        // 应用用户设置的域名与 URL 过滤：若不符合，则跳过记录
        const set = (cfg.__recorderSettings || {});
        // 域名过滤
        if (set.domains && Array.isArray(set.domains) && set.domains.length > 0) {
          try {
            const u = new URL(url, location.href);
            const host = u.hostname;
            const ok = set.domains.some(d => {
              const dd = String(d || '').trim(); if (!dd) return false;
              if (/^https?:\/\//i.test(dd)) { try { return new URL(dd).hostname === host; } catch (_e) { return false; } }
              return host === dd || host.endsWith('.' + dd);
            });
            if (!ok) return true; // 不在域名白名单
          } catch (_e) { /* 非法 URL 则不通过 */ return true; }
        }
        // URL 过滤
        if (set.urls && Array.isArray(set.urls) && set.urls.length > 0) {
          const abs = normalizeUrl(url);
          const pass = set.urls.some(rule => {
            try {
              const t = rule && rule.type; const v = rule && rule.value;
              if (!v) return false;
              if (t === 'contains') return abs.indexOf(v) > -1;
              if (t === 'path') {
                const u = new URL(abs, location.href); const path = u.pathname + (u.search || '');
                return path === v || path.startsWith(v.endsWith('/') ? v : v + (v.includes('?') ? '' : ''));
              }
              if (t === 'regexp') { const re = new RegExp(String(v).replace(/^\/|\/$/g, ''), 'i'); return re.test(abs); }
              return false;
            } catch (_e) { return false; }
          });
          if (!pass) return true; // 不符合 URL 过滤
        }
        const groups = cfg.mockPluginRules || [];
        const list = [];
        for (const g of groups) {
          if (!pageDomainMatches(g.pageDomain)) continue;
          const arr = Array.isArray(g.apiArr) ? g.apiArr : [];
          for (const it of arr) {
            if (!it || !it.isOpen) continue;
            if (!['normal', 'swagger'].includes(it.mockWay)) continue; // only direct mock types skip
            if ((it.method || '').toUpperCase() !== (method || '').toUpperCase()) continue;
            list.push(it);
          }
        }
        const absUrl = normalizeUrl(url);
        for (const r of list) {
          const filterType = r.filterType || 'contains';
          const apiUrl = r.apiUrl || '';
          let matched = false;
          if (filterType === 'contains') matched = absUrl.indexOf(apiUrl) > -1;
          else if (filterType === 'equals') matched = ((absUrl && absUrl.startsWith('http') ? absUrl : location.origin + absUrl) === apiUrl) || (absUrl === apiUrl);
          else if (filterType === 'regexp') {
            try { const re = new RegExp(apiUrl.replace(/^\/|\/$/g, ''), 'i'); matched = re.test(absUrl); } catch (_e) { matched = false; }
          }
          if (matched && checkRequestBody(method, body, r.requestBody)) return true;
        }
      } catch (_e) { }
      return false;
    };

    // XHR Recorder
    (function () {
      const OriginalXHR = window.XMLHttpRequest;
      if (!OriginalXHR) return;
      function WrappedXHR() {
        const xhr = new OriginalXHR();
        try {
          const _record = { method: '', url: '', body: '' };
          const _open = xhr.open;
          xhr.open = function (method, url) { _record.method = method; _record.url = url; return _open.apply(xhr, arguments); };
          const _send = xhr.send;
          xhr.send = function (body) {
            try { _record.body = stringifySafe(body); } catch (_e) { }
            try {
              xhr.addEventListener('loadend', function () {
                try {
                  const url = normalizeUrl(_record.url);
                  const host = (() => { try { return new URL(url).hostname; } catch (_e) { return location.hostname; } })();
                  const method = _record.method || '';
                  const reqBody = typeof _record.body === 'string' ? _record.body : stringifySafe(_record.body);
                  if (shouldSkipByRules(url, method, reqBody)) return;
                  let respText = '';
                  try {
                    if (!xhr.responseType || xhr.responseType === '' || xhr.responseType === 'text') respText = xhr.responseText || '';
                    else if (xhr.response && (isJSONContentType(xhr.getResponseHeader && xhr.getResponseHeader('content-type')) || xhr.responseType === 'json')) respText = stringifySafe(xhr.response);
                  } catch (_e) { }
                  const record = {
                    domain: host,
                    url: url,
                    method: method.toUpperCase(),
                    requestBody: reqBody ? (reqBody.length > MAX_REQ ? reqBody.slice(0, MAX_REQ) : reqBody) : '',
                    requestHeaders: xhr.requestHeaders || {},
                    status: (function () { try { return xhr.status || 200; } catch (_e) { return 200; } })(),
                    responseHeaders: (function () { try { return xhr.getAllResponseHeaders ? xhr.getAllResponseHeaders() : ''; } catch (_e) { return ''; } })(),
                    responseBody: respText ? (respText.length > MAX_BODY ? respText.slice(0, MAX_BODY) : respText) : '',
                    contentType: (function () { try { return xhr.getResponseHeader ? xhr.getResponseHeader('content-type') || '' : ''; } catch (_e) { return ''; } })(),
                    createdAt: Date.now()
                  };
                  window.postMessage({ type: 'mockPluginIntercepter', to: 'content', key: 'requestRecord', value: record }, '*');
                } catch (_e) { }
              }, false);
            } catch (_e) { }
            return _send.apply(xhr, arguments);
          };
          const _setRequestHeader = xhr.setRequestHeader;
          xhr.requestHeaders = {};
          xhr.setRequestHeader = function (k, v) { try { xhr.requestHeaders[k] = v; } catch (_e) { } return _setRequestHeader.apply(xhr, arguments); };
        } catch (_e) { }
        return xhr;
      }
      WrappedXHR.prototype = OriginalXHR.prototype;
      // Copy static props
      try { Object.getOwnPropertyNames(OriginalXHR).forEach(k => { try { WrappedXHR[k] = OriginalXHR[k]; } catch (_e) { } }); } catch (_e) { }
      window.XMLHttpRequest = WrappedXHR;
    })();

    // Fetch Recorder
    (function () {
      const OriginalFetch = window.fetch;
      if (!OriginalFetch) return;
      window.fetch = function (input, init) {
        try {
          const req = input instanceof Request ? input : new Request(input, init || {});
          const url = normalizeUrl(req.url);
          const host = (() => { try { return new URL(url).hostname; } catch (_e) { return location.hostname; } })();
          const method = (req.method || (init && init.method) || 'GET').toUpperCase();
          const body = (init && init.body) || undefined;
          const bodyStr = stringifySafe(body);
          if (shouldSkipByRules(url, method, bodyStr)) return OriginalFetch(input, init);
          return OriginalFetch(input, init).then(function (resp) {
            try {
              const clone = resp.clone();
              const ct = resp.headers && resp.headers.get ? (resp.headers.get('content-type') || '') : '';
              clone.text().then(function (text) {
                try {
                  const record = {
                    domain: host,
                    url: url,
                    method: method,
                    requestBody: bodyStr ? (bodyStr.length > MAX_REQ ? bodyStr.slice(0, MAX_REQ) : bodyStr) : '',
                    requestHeaders: {},
                    status: resp.status || 200,
                    responseHeaders: '',
                    responseBody: text ? (text.length > MAX_BODY ? text.slice(0, MAX_BODY) : text) : '',
                    contentType: ct,
                    createdAt: Date.now()
                  };
                  window.postMessage({ type: 'mockPluginIntercepter', to: 'content', key: 'requestRecord', value: record }, '*');
                } catch (_e) { }
              }).catch(function (_e) { });
            } catch (_e) { }
            return resp;
          });
        } catch (_e) { return OriginalFetch(input, init); }
      };
    })();
  } catch (_e) { }
})();


