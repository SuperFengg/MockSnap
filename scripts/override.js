/**
 * Chrome Extension - Request Override Script
 * 完全反编译版本 - 拦截和模拟网页中的 XMLHttpRequest 和 fetch 请求
 * 
 * 功能说明：
 * 1. 拦截页面中的所有 XMLHttpRequest 和 fetch 请求
 * 2. 根据用户定义的规则进行请求匹配
 * 3. 支持多种 Mock 方式：normal、swagger、modifyRequestBody 等
 * 4. 提供可视化的底部提醒功能
 * 5. 支持延迟响应、状态码自定义等高级功能
 */

(() => {
  "use strict";

  // ==================== 工具函数区域 ====================

  /**
   * 数组转换工具函数
   * @param {ArrayLike} arr - 类数组对象
   * @param {number} len - 长度限制
   * @returns {Array} 转换后的数组
   */
  function arrayLikeToArray(arr, len) {
    if (len == null || len > arr.length) {
      len = arr.length;
    }
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = arr[i];
    }
    return result;
  }

  /**
   * 获取对象类型的工具函数
   * @param {*} obj - 要检测的对象
   * @returns {string} 对象类型
   */
  function getObjectType(obj) {
    const typeofSymbol = typeof Symbol;
    const typeofSymbolIterator = typeof Symbol.iterator;

    if (typeofSymbol === "function" && typeofSymbolIterator === "symbol") {
      return function (o) { return typeof o; };
    } else {
      return function (o) {
        return o && typeofSymbol === "function" &&
          o.constructor === Symbol && o !== Symbol.prototype
          ? "symbol"
          : typeof o;
      };
    }
  }

  const getType = getObjectType();

  // ==================== 底部提醒功能 ====================

  let currentReminderElement = null;

  /**
   * 显示底部提醒消息
   * @param {string} message - 提醒消息
   * @param {number} duration - 显示时长（毫秒）
   * @param {string} mockData - Mock数据（用于控制台输出）
   */
  function showBottomReminder(message, duration = 3000, mockData) {
    try {
      let debugObj = null;
      if (mockData) {
        try { debugObj = JSON.parse(mockData); } catch (_e) { debugObj = mockData; }
        console.log(`%c${message}\n`, "background-color: yellow;color: red", debugObj);
      }
      if (!window.__overrideAJAX__ || !window.__overrideAJAX__.bottomReminder) return;
      if (currentReminderElement) currentReminderElement.style.opacity = 0;
      const reminderDiv = createReminderElement(message);
      document.body.appendChild(reminderDiv);
      currentReminderElement = reminderDiv;
      setupReminderEvents(reminderDiv, duration);
    } catch (_e) { }
  }

  /**
   * 创建提醒元素
   * @param {string} message - 提醒消息
   * @returns {HTMLElement} 提醒元素
   */
  function createReminderElement(message) {
    const div = document.createElement("div");

    // 设置样式
    Object.assign(div.style, {
      position: "fixed",
      bottom: "8px",
      right: "16px",
      padding: "8px 16px",
      backgroundColor: "rgba(51, 51, 51, 0.8)",
      color: "#fff",
      borderRadius: "4px",
      opacity: "1",
      fontSize: "14px",
      maxWidth: "80vw",
      wordBreak: "break-all",
      transition: "opacity 0.3s ease-out",
      zIndex: "9999"
    });

    div.textContent = message;
    return div;
  }

  /**
   * 设置提醒元素的事件监听
   * @param {HTMLElement} element - 提醒元素
   * @param {number} duration - 显示时长
   */
  function setupReminderEvents(element, duration) {
    let hideTimeout;

    const hideReminder = () => {
      if (element) {
        element.style.opacity = 0;
        setTimeout(() => {
          currentReminderElement = null;
          element.remove();
        }, 300); // 等待透明度动画完成
      }
    };

    // 鼠标悬停暂停隐藏
    element.addEventListener("mouseenter", () => {
      clearTimeout(hideTimeout);
    });

    element.addEventListener("mouseleave", () => {
      hideTimeout = setTimeout(hideReminder, duration);
    });

    // 设置自动隐藏
    hideTimeout = setTimeout(hideReminder, duration);
  }

  // ==================== 数据处理工具 ====================

  /**
   * 深度排序对象或数组
   * @param {*} obj - 要排序的对象
   * @returns {*} 排序后的对象
   */
  function deepSortObject(obj) {
    if (Array.isArray(obj)) {
      return obj.map(deepSortObject).sort((a, b) => {
        const typeA = typeof a;
        const typeB = typeof b;

        if (typeA === "number" && typeB === "number") return a - b;
        if (typeA === "string" && typeB === "string") return a.localeCompare(b);
        if (typeA === "number") return -1;
        if (typeB === "number") return 1;
        return 0;
      });
    }

    if (obj !== null && getType(obj) === "object") {
      const result = {};
      const sortedKeys = Object.keys(obj).sort();

      for (const key of sortedKeys) {
        result[key] = deepSortObject(obj[key]);
      }
      return result;
    }

    return obj;
  }

  /**
   * 标准化JSON字符串（用于比较）
   * @param {string} jsonString - JSON字符串
   * @returns {string} 标准化后的JSON字符串
   */
  function normalizeJSONString(jsonString) {
    if (!jsonString) return "";

    try {
      const parsed = deepSortObject(JSON.parse(jsonString));
      return JSON.stringify(parsed);
    } catch (error) {
      return "";
    }
  }

  /**
   * 检查对象是否为Promise
   * @param {*} obj - 要检查的对象
   * @returns {boolean} 是否为Promise
   */
  function isPromiseLike(obj) {
    return !!(obj &&
      (getType(obj) === "object" || typeof obj === "function") &&
      typeof obj.then === "function");
  }

  /**
   * 安全解析JSON字符串
   * @param {string} str - 要解析的字符串
   * @returns {*} 解析结果或原字符串
   */
  function safeParseJSON(str) {
    if (typeof str !== "string") return str;

    try {
      return JSON.parse(str);
    } catch (error) {
      return str;
    }
  }

  /**
   * 检查Content-Type是否为JSON
   * @param {string} contentType - Content-Type头部值
   * @returns {boolean} 是否为JSON类型
   */
  function isJSONContentType(contentType) {
    return !!(contentType && contentType.includes("application/json"));
  }

  /**
   * 检查请求体是否匹配规则
   * @param {string} method - HTTP方法
   * @param {string} requestBody - 实际请求体
   * @param {string} ruleBody - 规则中的请求体
   * @returns {boolean} 是否匹配
   */
  function isRequestBodyMatching(method, requestBody, ruleBody) {
    // 如果规则没有指定请求体，或者不是POST/PUT请求，则认为匹配
    if (!ruleBody || !["POST", "PUT"].includes(method)) {
      return true;
    }

    // 比较标准化后的JSON字符串
    return normalizeJSONString(requestBody) === normalizeJSONString(ruleBody);
  }

  // ==================== Mock方式枚举 ====================

  const MockMethods = {
    normal: "normal",
    swagger: "swagger",
    redirect: "redirect",
    modifyHeaders: "modifyHeaders",
    modifyRequestBody: "modifyRequestBody"
  };

  // ==================== 异步处理工具 ====================

  /**
   * 将生成器函数转换为异步函数
   * @param {GeneratorFunction} fn - 生成器函数
   * @returns {Function} 异步函数
   */
  function asyncToGenerator(fn) {
    return function () {
      const self = this;
      const args = arguments;

      return new Promise((resolve, reject) => {
        const generator = fn.apply(self, args);

        function step(key, arg) {
          try {
            const info = generator[key](arg);
            const value = info.value;

            if (info.done) {
              resolve(value);
            } else {
              Promise.resolve(value).then(
                result => step("next", result),
                error => step("throw", error)
              );
            }
          } catch (error) {
            reject(error);
          }
        }

        step("next");
      });
    };
  }

  /**
   * 对象合并工具（类似Object.assign但支持嵌套）
   * @param {Object} target - 目标对象
   * @param {...Object} sources - 源对象
   * @returns {Object} 合并后的对象
   */
  function mergeObjects(target, ...sources) {
    for (const source of sources) {
      if (source != null) {
        const keys = Object.keys(source);

        // 处理Symbol属性
        if (typeof Object.getOwnPropertySymbols === 'function') {
          const symbols = Object.getOwnPropertySymbols(source).filter(sym => {
            return Object.getOwnPropertyDescriptor(source, sym).enumerable;
          });
          keys.push(...symbols);
        }

        // 复制属性
        keys.forEach(key => {
          defineObjectProperty(target, key, source[key]);
        });
      }
    }
    return target;
  }

  /**
   * 定义对象属性
   * @param {Object} obj - 目标对象
   * @param {string|Symbol} key - 属性键
   * @param {*} value - 属性值
   * @returns {Object} 目标对象
   */
  function defineObjectProperty(obj, key, value) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }

  // ==================== 规则匹配逻辑 ====================

  /**
   * 检查页面域名是否匹配
   * @param {string} pageDomain - 规则中的页面域名配置
   * @returns {boolean} 是否匹配当前页面
   */
  function isPageDomainMatching(pageDomain) {
    if (!pageDomain) return true;

    const currentOrigin = location.origin;
    const domains = pageDomain.split(/[,，;；]/);

    return domains.some(domain => domain.trim().startsWith(currentOrigin));
  }

  /**
   * 根据过滤类型检查URL是否匹配
   * @param {string} requestUrl - 请求URL
   * @param {string} ruleUrl - 规则URL
   * @param {string} filterType - 过滤类型
   * @returns {boolean} 是否匹配
   */
  function isUrlMatching(requestUrl, ruleUrl, filterType) {
    switch (filterType) {
      case "contains":
        return requestUrl.indexOf(ruleUrl) > -1;

      case "equals":
        const fullUrl = /^https?:\/\//.test(requestUrl)
          ? requestUrl
          : `${location.origin}${requestUrl}`;
        return fullUrl === ruleUrl;

      case "regexp":
        try {
          const pattern = ruleUrl.replace(/^\/|\/$/g, "");
          return new RegExp(pattern, "i").test(requestUrl);
        } catch (error) {
          console.warn("Invalid regex pattern:", ruleUrl, error);
          return false;
        }

      default:
        return false;
    }
  }

  /**
   * 查找匹配的Mock规则
   * @param {string} url - 请求URL
   * @param {string} method - HTTP方法
   * @param {string} requestBody - 请求体
   * @returns {Object} 匹配的规则对象，如果没有匹配则返回空对象
   */
  function findMatchingMockRule(url, method, requestBody) {
    // 检查Mock功能是否启用
    if (!window.__overrideAJAX__.mockPluginSwitchOn) {
      return {};
    }

    // 获取所有启用的API规则
    const enabledRules = window.__overrideAJAX__.mockPluginRules.reduce((accumulator, ruleGroup) => {
      // 过滤出启用的API
      const enabledApis = ruleGroup.apiArr.filter(api =>
        api.isOpen &&
        [MockMethods.normal, MockMethods.swagger, MockMethods.modifyRequestBody].includes(api.mockWay)
      );

      // 为每个API添加页面域名信息
      const apisWithDomain = enabledApis.map(api =>
        mergeObjects({}, api, { pageDomain: ruleGroup.pageDomain })
      );

      return accumulator.concat(apisWithDomain);
    }, []);

    // 查找第一个匹配的规则
    const matchedRule = enabledRules.find(rule => {
      const {
        filterType = "contains",
        apiUrl,
        method: ruleMethod,
        pageDomain,
        requestBody: ruleRequestBody,
        mockWay
      } = rule;

      // 1. 检查HTTP方法
      if (String(method || '').toUpperCase() !== String(ruleMethod || '').toUpperCase()) return false;

      // 2. 检查页面域名
      if (!isPageDomainMatching(pageDomain)) return false;

      // 3. 检查URL匹配
      if (!isUrlMatching(url, apiUrl, filterType)) return false;

      // 4. 检查请求体匹配（特定情况下）
      if (mockWay === MockMethods.modifyRequestBody) {
        return true; // 修改请求体模式不需要检查请求体匹配
      }

      return isRequestBodyMatching(method, requestBody, ruleRequestBody);
    });

    return matchedRule || {};
  }

  // ==================== XMLHttpRequest 拦截处理 ====================

  /**
   * XMLHttpRequest状态变化处理函数
   */
  const handleXMLHttpRequestStateChange = asyncToGenerator(function* () {
    // 只处理HEADERS_RECEIVED和DONE状态
    if (this.readyState !== this.HEADERS_RECEIVED && this.readyState !== this.DONE) {
      return;
    }

    const matchedRule = findMatchingMockRule(this.requestURL, this.method, this.requestData);
    let { mockResponseData, mockWay } = matchedRule;

    if (!mockResponseData) return;

    const responseType = this.responseType;
    const contentType = this.getResponseHeader("content-type");

    // 处理HEADERS_RECEIVED状态
    if (this.readyState === this.HEADERS_RECEIVED) {
      const statusCode = this.status || 200;
      const statusText = this.statusText;

      // 重新定义status和statusText属性
      Object.defineProperty(this, "status", {
        get: () => statusCode
      });

      Object.defineProperty(this, "statusText", {
        get: () => statusText
      });
    }

    // 处理DONE状态
    if (this.readyState === this.DONE) {
      // 避免重复定义只读属性导致的 Cannot redefine property 错误
      if (this.__mockResponseApplied) return;
      // 等待Promise类型的mock数据
      if (isPromiseLike(mockResponseData)) {
        mockResponseData = yield mockResponseData;
      }

      // 特殊情况处理
      const isNonStandardResponseType = responseType && !["json", "text"].includes(responseType);
      const shouldKeepOriginalResponse = [MockMethods.modifyRequestBody, MockMethods.modifyHeaders].includes(mockWay);

      if (isNonStandardResponseType || shouldKeepOriginalResponse) {
        mockResponseData = this.response;
      }

      // JSON响应处理
      if (!isNonStandardResponseType &&
        getType(mockResponseData) === "object" &&
        !(mockResponseData instanceof Blob) &&
        (responseType === "json" || isJSONContentType(contentType))) {
        mockResponseData = JSON.stringify(mockResponseData);
      }

      // 重新定义response属性
      Object.defineProperty(this, "response", {
        get: () => {
          if (responseType === "json") {
            return getType(mockResponseData) === "object"
              ? mockResponseData
              : safeParseJSON(mockResponseData);
          }
          return mockResponseData;
        }
      });

      // 重新定义responseText属性
      if (responseType === "" || responseType === "text") {
        Object.defineProperty(this, "responseText", {
          get: () => mockResponseData
        });
      }

      // 标记已应用，后续 readystatechange 再次触发时不再重复定义属性
      this.__mockResponseApplied = true;
    }
  });

  // ==================== Fetch 拦截处理（在初始化函数中绑定原始 fetch） ====================

  // ==================== 主要拦截逻辑 ====================

  /**
   * 初始化请求拦截功能
   * @param {string} namespace - 全局命名空间
   */
  function initializeRequestInterception(namespace) {
    // 初始化全局配置对象
    window[namespace] = window[namespace] || {};
    window[namespace].mockPluginSwitchOn = true;
    window[namespace].mockPluginRules = [];
    window[namespace].bottomReminder = true;

    // 保存原始构造函数和方法
    const OriginalXMLHttpRequest = XMLHttpRequest;
    const originalFetch = fetch;

    // ==================== XMLHttpRequest 拦截 ====================

    /**
     * 拦截的XMLHttpRequest构造函数
     */
    function InterceptedXMLHttpRequest() {
      const xhr = new OriginalXMLHttpRequest();
      xhr.addEventListener("readystatechange", handleXMLHttpRequestStateChange.bind(xhr), false);
      return xhr;
    }

    // 继承原型和静态属性
    InterceptedXMLHttpRequest.prototype = OriginalXMLHttpRequest.prototype;
    Object.entries(OriginalXMLHttpRequest).forEach(([key, value]) => {
      InterceptedXMLHttpRequest[key] = value;
    });

    // 重写open方法
    const originalOpen = OriginalXMLHttpRequest.prototype.open;
    InterceptedXMLHttpRequest.prototype.open = function (method, url, ...args) {
      this.method = method;
      this.requestURL = url;
      return originalOpen.apply(this, [method, url, ...args]);
    };

    // 重写send方法
    const originalSend = OriginalXMLHttpRequest.prototype.send;
    InterceptedXMLHttpRequest.prototype.send = function (data) {
      const matchedRule = findMatchingMockRule(this.requestURL, this.method, data);
      const { mockResponseData, delay, statusCode, mockWay } = matchedRule;

      this.requestData = data;

      const isModifyRequestBodyMode = [MockMethods.modifyRequestBody].includes(mockWay);

      // 处理修改请求体或无mock数据的情况
      if (!mockResponseData || isModifyRequestBodyMode) {
        let modifiedData = data;

        try {
          if (isModifyRequestBodyMode) {
            const originalBodyObj = JSON.parse(data || "{}");
            const mockBodyObj = JSON.parse(mockResponseData || "{}");
            modifiedData = JSON.stringify(mergeObjects({}, originalBodyObj, mockBodyObj));
          }
        } catch (error) {
          console.warn("Error modifying request body:", error);
        }

        // 仅在“修改请求体”模式下提示；无命中规则时不提示
        if (isModifyRequestBodyMode) {
          showBottomReminder(
            `Mock Plugin：The request body for URL: ${this.requestURL} was modified.`,
            3000,
            mockResponseData
          );
        }

        return originalSend.apply(this, isModifyRequestBodyMode ? [modifiedData] : arguments);
      }

      // 处理完全mock的情况
      showBottomReminder(
        `Mock Plugin：${this.method} ${this.requestURL} is Mocking`,
        3000,
        mockResponseData
      );

      // 设置mock状态
      Object.defineProperty(this, "readyState", { get: () => (this.DONE || 4) });
      Object.defineProperty(this, "status", { get: () => statusCode || 200 });

      // 先设置响应内容，再分发事件（以便监听器能读取到响应）
      handleXMLHttpRequestStateChange.bind(this)();

      const dispatch = (type) => { try { this.dispatchEvent(new Event(type)); } catch (_e) { /* noop */ } };
      const triggerEvents = () => {
        // readystatechange(DONE) → load → loadend
        if (this.onreadystatechange) this.onreadystatechange();
        dispatch('readystatechange');
        if (this.onload) this.onload();
        dispatch('load');
        if (this.onloadend) this.onloadend();
        dispatch('loadend');
      };

      if (delay) setTimeout(triggerEvents, delay); else triggerEvents();
    };

    // 重写setRequestHeader方法
    const originalSetRequestHeader = OriginalXMLHttpRequest.prototype.setRequestHeader;
    InterceptedXMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      this.requestHeaders = this.requestHeaders || {};
      this.requestHeaders[name] = value;
      return originalSetRequestHeader.apply(this, arguments);
    };

    // 重写getResponseHeader方法
    const originalGetResponseHeader = OriginalXMLHttpRequest.prototype.getResponseHeader;
    InterceptedXMLHttpRequest.prototype.getResponseHeader = function (name) {
      if (findMatchingMockRule(this.requestURL, this.method, this.requestData) &&
        name && name.toLowerCase() === "content-type") {
        return "application/json;charset=UTF-8";
      }
      return originalGetResponseHeader.apply(this, arguments);
    };

    // ==================== 替换全局对象 ====================

    // 绑定 fetch 拦截（此处可拿到 originalFetch 引用）
    window.XMLHttpRequest = InterceptedXMLHttpRequest;
    window.fetch = async function (input, init = {}) {
      const originalRequest = (body) => originalFetch(input, mergeObjects({}, init, { body }));
      const request = input instanceof Request ? input.clone() : new Request(input.toString(), init);
      const matchedRule = findMatchingMockRule(request.url, request.method, init.body);
      const { mockResponseData, delay, statusCode, mockWay } = matchedRule;
      if (!mockResponseData || [MockMethods.modifyRequestBody].includes(mockWay)) {
        try {
          let modifiedBody = init.body;
          if ([MockMethods.modifyRequestBody].includes(mockWay)) {
            try {
              const originalBodyObj = JSON.parse(init.body || "{}");
              const mockBodyObj = JSON.parse(mockResponseData || "{}");
              modifiedBody = JSON.stringify(mergeObjects({}, originalBodyObj, mockBodyObj));
            } catch (_e) { }
            // 仅修改请求体模式下提示；无命中规则时不提示
            showBottomReminder(`Mock Plugin：The request body for URL: ${request.url} was modified.`, 3000, mockResponseData);
          }
          return await originalRequest(modifiedBody);
        } catch (_e) {
          return originalRequest(init.body);
        }
      }
      let finalMockData = mockResponseData;
      if (isPromiseLike(mockResponseData)) finalMockData = await mockResponseData;
      if (delay) await new Promise(res => setTimeout(res, delay));
      showBottomReminder(`Mock Plugin：${request.method} ${request.url} is Mocking`, 3000, finalMockData);
      return new Response(new Blob([finalMockData]), { status: statusCode || 200, statusText: "" });
    };

    // ==================== 消息监听 ====================

    window.addEventListener("message", (event) => {
      const { data } = event;

      // 处理来自扩展的配置消息
      if (data.type === "mockPluginIntercepter" && data.to === "pageScript") {
        window[namespace][data.key] = data.value;
        if (data.key === '__recorderSettings') {
          window.__overrideAJAX__ = window.__overrideAJAX__ || {};
          window.__overrideAJAX__.__recorderSettings = data.value || {};
        }
      }

      // 如果插件被关闭，恢复原始函数
      if (!window[namespace].mockPluginSwitchOn) {
        const restoreTimeout = setTimeout(() => {
          window.XMLHttpRequest = OriginalXMLHttpRequest;
          window.fetch = originalFetch;
          clearTimeout(restoreTimeout);
        }, 5000);
      }
    });
  }

  // ==================== 初始化 ====================

  // 启动请求拦截功能
  initializeRequestInterception("__overrideAJAX__");

})();
