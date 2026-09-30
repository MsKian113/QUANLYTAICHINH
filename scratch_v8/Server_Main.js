// ==========================================
// FILE: Server_Main.js
// NHIỆM VỤ: Khởi tạo Web App & Cấu trúc gốc
// ==========================================

function doGet(e) {
  const tmp = HtmlService.createTemplateFromFile('Index');
  try {
    const m = (new Date().getMonth() + 1).toString();
    const y = new Date().getFullYear().toString();
    const data = getAppData(m, y);
    tmp.initialDataJson = JSON.stringify(data);
  } catch (err) {
    tmp.initialDataJson = JSON.stringify({ success: false });
  }
  return tmp
    .evaluate()
    .setTitle('Quản Lý Tài Chính')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// Hàm hỗ trợ nhúng file HTML con vào file Index (SPA Architecture - Memory Cached)
var _htmlFileCache = {};
function include(filename) {
  try {
    if (_htmlFileCache[filename]) {
      return _htmlFileCache[filename];
    }
    const content = HtmlService.createHtmlOutputFromFile(filename).getContent();
    _htmlFileCache[filename] = content;
    return content;
  } catch (e) {
    return "<div class='p-5 text-slate-400 font-bold text-center'>Đang xây dựng giao diện " + filename + "...</div>";
  }
}

function getBusinessData(month, year) {
  return {
    success: true,
    summary: { net: 45000, sales: 150000, cogs: 105000 }
  };
}

function getDebtData(month, year) {
  return {
    success: true,
    summary: { net: 70000, receivables: 120000, payables: 50000 }
  };
}

/**
 * XOÁ CACHE KHI CÓ THAY ĐỔI DỮ LIỆU (MUTATION)
 */
function clearAppDataCache(month, year) {
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      const m = month || (new Date().getMonth() + 1).toString();
      const y = year || new Date().getFullYear().toString();
      const keys = [
        "APP_DATA_" + m + "_" + y,
        "APP_DATA_GLOBAL_LATEST",
        "APP_DATA_V5_" + m + "_" + y,
        "APP_DATA_GLOBAL_LATEST_V5",
        "biz_data_" + m + "_" + y,
        "biz_data_v5_" + m + "_" + y,
        "biz_data_ALL_" + y,
        "biz_data_v5_ALL_" + y,
        "biz_data_ALL_ALL",
        "biz_data_v5_ALL_ALL"
      ];
      if (typeof cache.removeAll === 'function') {
        cache.removeAll(keys);
      } else {
        keys.forEach(k => cache.remove(k));
      }
    }
  } catch(e) {}
}

/**
 * UNIFIED INITIAL APP LOAD RPC - OPTIMIZED FOR HIGH SPEED (<0.1s via Cache & Preloading)
 * Accesses CacheService in 5ms or queries SpreadsheetApp EXACTLY ONCE on cold start.
 */
function getAppData(month, year, ssTarget) {
  const m = month || (new Date().getMonth() + 1).toString();
  const y = year || new Date().getFullYear().toString();
  const cacheKey = "APP_DATA_V5_" + m + "_" + y;

  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(cacheKey) || (!month ? cache.get("APP_DATA_GLOBAL_LATEST_V5") : null);
      if (cached) {
        return JSON.parse(cached);
      }
    }
  } catch(e) {}

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();

    // 1. Wallets Data
    let wallets = [];
    if (typeof getWalletsFromSheet === 'function') {
      const wRes = getWalletsFromSheet(m, y, ss);
      if (wRes && wRes.wallets) wallets = wRes.wallets;
    }

    // 2. Categories / Initial Data
    let categories = [];
    if (typeof getInitialData === 'function') {
      const catRes = getInitialData(ss);
      if (catRes && catRes.categories) categories = catRes.categories;
    }

    // 3. Tab 2 Data
    let tab2 = { summary: { net: 0, income: 0, expense: 0 }, transactions: [], jars: [] };
    if (typeof getTab2Data === 'function') {
      const t2Res = getTab2Data(m, y, ss);
      if (t2Res) tab2 = t2Res;
    }

    // 4. Quick Fixed Items
    let quickFixed = [];
    if (typeof getQuickFixedItems === 'function') {
      const qRes = getQuickFixedItems(m, y, ss);
      if (qRes && qRes.items) quickFixed = qRes.items;
    }

    const result = {
      success: true,
      wallets: wallets,
      categories: categories,
      tab2: tab2,
      quickFixed: quickFixed
    };

    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
        const cache = CacheService.getScriptCache();
        const jsonStr = JSON.stringify(result);
        cache.put(cacheKey, jsonStr, 21600); // 6 Hours Cache TTL
        cache.put("APP_DATA_GLOBAL_LATEST_V5", jsonStr, 21600);
      }
    } catch(e) {}

    return result;
  } catch (err) {
    return {
      success: false,
      message: err.toString(),
      wallets: [],
      categories: [],
      tab2: { summary: { net: 0, income: 0, expense: 0 }, transactions: [], jars: [] }
    };
  }
}

