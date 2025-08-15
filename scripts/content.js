const script = document.createElement("script");
script.setAttribute("type", "text/javascript");
script.setAttribute("src", chrome.runtime.getURL("scripts/override.js"));
document.documentElement.appendChild(script);

const updateRules = () => {
  try {
    chrome.storage.local.get(
      ["mockPluginSwitchOn", "mockPluginRules", "bottomReminder", "__recorderSettings"],
      (e) => {
        if (e.hasOwnProperty("mockPluginSwitchOn"))
          postMessage({ type: "mockPluginIntercepter", to: "pageScript", key: "mockPluginSwitchOn", value: e.mockPluginSwitchOn });
        if (e.hasOwnProperty("mockPluginRules"))
          postMessage({ type: "mockPluginIntercepter", to: "pageScript", key: "mockPluginRules", value: e.mockPluginRules });
        if (e.hasOwnProperty("bottomReminder"))
          postMessage({ type: "mockPluginIntercepter", to: "pageScript", key: "bottomReminder", value: e.bottomReminder });
        if (e.hasOwnProperty("__recorderSettings"))
          postMessage({ type: "mockPluginIntercepter", to: "pageScript", key: "__recorderSettings", value: e.__recorderSettings });
      }
    );
  } catch (e) {
    console.log("e:--------updateRules---------", e);
  }
};
script.addEventListener("load", updateRules);
// Inject recorder after override script is loaded
script.addEventListener("load", (() => { try { const r = document.createElement("script"); r.setAttribute("type", "text/javascript"), r.setAttribute("src", chrome.runtime.getURL("scripts/recorder.js")), document.documentElement.appendChild(r) } catch (e) { } }));
let isPageActive = true;
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible") {
    if (!isPageActive) {
      isPageActive = true;
      setTimeout(updateRules, 0);
    }
  } else {
    isPageActive = false;
  }
});

chrome.runtime.onMessage.addListener((e) => {
  if (e.type === "mockPluginIntercepter" && e.to === "content") {
    postMessage({ ...e, to: "pageScript" });
  }
});

// Propagate storage updates to pageScript (recorder settings, etc.)
try {
  chrome.storage && chrome.storage.onChanged && chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.__recorderSettings) {
      postMessage({ type: "mockPluginIntercepter", to: "pageScript", key: "__recorderSettings", value: changes.__recorderSettings.newValue });
    }
  });
} catch (e) { }

// Bridge messages from pageScript to extension background
window.addEventListener("message", function (evt) {
  try {
    const data = evt?.data || {};
    if (data && data.type === "mockPluginIntercepter" && data.to === "content") {
      if (data.key === "requestRecord" && data.value) {
        chrome.runtime.sendMessage({ type: "mockPluginIntercepter", to: "background", key: "requestRecord", value: data.value });
      }
    }
  } catch (err) {
    /* noop */
  }
});