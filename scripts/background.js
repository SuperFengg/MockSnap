chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  chrome.storage.local.set({ currentTab: JSON.stringify(tab) });
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options.html"));
  }
});

const updateIcon = (on) => {
  try {
    chrome.action.setBadgeText({ text: on ? "ON" : "OFF" });
    chrome.action.setBadgeBackgroundColor({ color: on ? "#52c41a" : "#bfbfbf" });
  } catch (_e) { }
};

const updateDynamicRules = (groups) => {
  chrome.declarativeNetRequest.getDynamicRules((existing) => {
    chrome.declarativeNetRequest.updateDynamicRules(
      { removeRuleIds: existing.map((r) => r.id) },
      () => {
        if (!groups || !groups.length) return;
        let rules = [];
        groups.forEach((g) => {
          // Redirect rules
          rules = rules.concat(
            g.apiArr
              .filter((it) => it.isOpen && it.mockWay === "redirect")
              .map((it, idx) => ({
                id: idx + 1 + Math.ceil(Math.random() * 1000),
                priority: 3,
                action: { type: "redirect", redirect: { url: it.redirectURL } },
                condition: { urlFilter: it.apiUrl, resourceTypes: ["xmlhttprequest"] },
              }))
          );
          // Modify headers rules
          rules = rules.concat(
            g.apiArr
              .filter((it) => it.isOpen && it.mockWay === "modifyHeaders")
              .map((it, idx) => {
                let headers = [];
                try {
                  const obj = JSON.parse(it.mockResponseData);
                  Object.keys(obj).forEach((k) => {
                    headers.push({ header: k, operation: "set", value: obj[k] + "" });
                  });
                } catch (_e) {
                  headers = [];
                }
                return {
                  id: idx + 1 + Math.ceil(Math.random() * 1000),
                  priority: 2,
                  action: { type: "modifyHeaders", requestHeaders: headers },
                  condition: { urlFilter: it.apiUrl || undefined, resourceTypes: ["xmlhttprequest"] },
                };
              })
          );
        });
        chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules }, () => {
          chrome.runtime.lastError; // noop consume
        });
      }
    );
  });
};

chrome.runtime.onMessage.addListener((msg) => {
  const { type, key, value } = msg;
  if (type === "overrideAJAX") {
    switch (key) {
      case "mockPluginSwitchOn":
        updateIcon(value);
        if (value) {
          chrome.storage.local.get(["mockPluginRules"], (res) => {
            updateDynamicRules(res.mockPluginRules);
          });
        } else {
          updateDynamicRules([]);
        }
        break;
      case "mockPluginRules":
        chrome.storage.local.get(["mockPluginSwitchOn"], (res) => {
          if (res.mockPluginSwitchOn) updateDynamicRules(value);
        });
        break;
      default:
        break;
    }
  }

  if (type === "mockPluginIntercepter" && msg.to === "background" && key === "requestRecord" && value) {
    try {
      const record = value;
      const domain = record.domain || "general";
      chrome.storage.local.get(["requestRecordsByDomain"], (res) => {
        const map = res.requestRecordsByDomain || {};
        const list = map[domain] || [];
        const now = Date.now();
        // keep last 24h window for dedupe set
        const filtered = list.filter((x) => now - (x.createdAt || 0) < 1000 * 60 * 60 * 24);
        const exists = filtered.find(
          (x) => x.url === record.url && x.method === record.method && (x.requestBody || "") === (record.requestBody || "")
        );
        if (!exists) {
          filtered.unshift(record);
          const MAX_PER_DOMAIN = 200;
          if (filtered.length > MAX_PER_DOMAIN) filtered.length = MAX_PER_DOMAIN;
        }
        map[domain] = filtered;
        chrome.storage.local.set({ requestRecordsByDomain: map });
      });
    } catch (_err) { }
  }
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.storage.local.set({ mockPluginSwitchOn: true });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(["mockPluginSwitchOn", "mockPluginRules"], (res) => {
    updateIcon(!!res.mockPluginSwitchOn);
    updateDynamicRules(res.mockPluginSwitchOn ? res.mockPluginRules : []);
  });
});

// sanitize existing mock rules so that mockResponseData is always valid JSON string
try {
  const sanitizeMockRules = (rules) => {
    let changed = false;
    try {
      const arr = (Array.isArray(rules) ? rules : []).map((g) => {
        const apiArr = (Array.isArray(g.apiArr) ? g.apiArr : []).map((it) => {
          if (it && it.mockWay !== "redirect") {
            const s = it.mockResponseData;
            if (typeof s !== "string") {
              changed = true;
              return Object.assign({}, it, { mockResponseData: JSON.stringify(s ?? "") });
            }
            try {
              JSON.parse(s);
            } catch (_e) {
              changed = true;
              return Object.assign({}, it, { mockResponseData: JSON.stringify(s || "") });
            }
          }
          return it;
        });
        return Object.assign({}, g, { apiArr });
      });
      return { changed, rules: arr };
    } catch (_e) {
      return { changed: false, rules: rules || [] };
    }
  };

  chrome.storage.local.get(["mockPluginRules"], (res) => {
    const s = sanitizeMockRules(res.mockPluginRules || []);
    if (s.changed) chrome.storage.local.set({ mockPluginRules: s.rules });
  });
} catch (_e) { }