// ==========================================
// FILE: Server_Main.js
// NHIỆM VỤ: Khởi tạo Web App & Cấu trúc gốc
// ==========================================

function doGet(e) {
  // Direct trigger migration endpoint via GET: ?action=migrateCards or ?action=migrateEncryptExistingCards
  if (e && e.parameter && (e.parameter.action === 'migrateCards' || e.parameter.action === 'migrateEncryptExistingCards')) {
    const res = typeof migrateEncryptExistingCards === 'function' ? migrateEncryptExistingCards() : { success: false, message: "Không tìm thấy hàm migrateEncryptExistingCards" };
    try {
      const props = typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties ? PropertiesService.getScriptProperties() : null;
      if (props) props.setProperty("CARDS_MIGRATED_V1", "true");
    } catch(pe) {}
    const appUrl = (typeof ScriptApp !== 'undefined' && ScriptApp.getService) ? ScriptApp.getService().getUrl() : "#";
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Mã Hóa Dữ Liệu Thẻ</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box;} .card{background:#1e293b;padding:36px 28px;border-radius:20px;box-shadow:0 20px 40px rgba(0,0,0,0.5);text-align:center;max-width:440px;width:100%;border:1px solid #334155;} .icon{font-size:48px;margin-bottom:12px;} h2{color:#10b981;margin:0 0 12px 0;font-size:20px;font-weight:800;} p{color:#94a3b8;font-size:13.5px;line-height:1.6;margin:0 0 24px 0;} code{background:#0f172a;padding:3px 8px;border-radius:6px;color:#38bdf8;font-size:12px;font-family:monospace;} .btn{display:inline-block;padding:12px 24px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:12px;font-weight:bold;font-size:13px;box-shadow:0 4px 12px rgba(59,130,246,0.4);}</style></head><body><div class="card"><div class="icon">🛡️</div><h2>' + (res.success ? 'Đã Mã Hóa Dữ Liệu Sheet Thành Công!' : 'Có Lỗi Xảy Ra') + '</h2><p>' + (res.success ? ('Hệ thống đã quét và mã hóa an toàn <b>' + (res.count || 0) + '</b> thẻ trên Google Sheet Database sang định dạng <code>ENC:v1:...</code>.<br><br>👉 Bạn có thể quay lại tab Google Sheet và bấm <b>F5 (Tải lại trang)</b> để kiểm tra!') : res.message) + '</p><a href="' + appUrl + '" class="btn">🚀 Mở Ứng Dụng Quản Lý</a></div></body></html>';
    return HtmlService.createHtmlOutput(html);
  }

  // Tự động kiểm tra và mã hóa trong lần tải đầu nếu chưa gắn cờ CARDS_MIGRATED_V1
  try {
    const props = typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties ? PropertiesService.getScriptProperties() : null;
    if (props && props.getProperty("CARDS_MIGRATED_V1") !== "true") {
      if (typeof migrateEncryptExistingCards === 'function') {
        migrateEncryptExistingCards();
        props.setProperty("CARDS_MIGRATED_V1", "true");
      }
    }
  } catch (migOnceErr) {}

  if (e && e.parameter && e.parameter.action) {
    return doPost(e);
  }
  const tmp = HtmlService.createTemplateFromFile('Index');
  try {
    const m = (new Date().getMonth() + 1).toString();
    const y = new Date().getFullYear().toString();
    let initialDataStr = null;

    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cacheKey = "APP_DATA_V29_" + m + "_" + y;
      initialDataStr = getCachedAppDataStr(cacheKey);
    }

    // On cache miss, do NOT block HTTP response with 60s synchronous getAppData.
    // Return HTML immediately (<0.3s) and let client JS fetch fresh data asynchronously.
    tmp.initialDataJson = initialDataStr ? initialDataStr : JSON.stringify("null");
  } catch (err) {
    tmp.initialDataJson = JSON.stringify("null");
  }
  return tmp
    .evaluate()
    .setTitle('Quản Lý Tài Chính')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/**
 * UNIVERSAL REST API ENDPOINT FOR EXTERNAL CLIENTS (GITHUB PAGES, FETCH API)
 */
function doPost(e) {
  try {
    let payload = {};
    if (e && e.parameter && e.parameter.payload) {
      try {
        payload = JSON.parse(e.parameter.payload);
      } catch (err) {
        payload = e.parameter;
      }
    } else if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (err) {
        payload = e.parameter || {};
      }
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = String(payload.action || (e && e.parameter ? e.parameter.action : "") || "").trim();
    const data = payload.data !== undefined ? payload.data : payload;
    const args = Array.isArray(payload.args) ? payload.args : (payload.data !== undefined ? [payload.data] : []);
    let result = { success: false, message: "Action không hợp lệ: " + action };

    const ACTION_ROUTERS = {
      // Global & Preload
      "getAppData": function(d, a) { return getAppData(a[0] || d.month, a[1] || d.year, null, d.forceRefresh); },
      "getInitialData": function(d, a) { return typeof getInitialData === 'function' ? getInitialData() : {}; },
      "getAppVersion": function(d, a) { return { success: true, version: getAppVersion() }; },
      "runNightlyLedgerAudit": function(d, a) { return typeof runNightlyLedgerAudit === 'function' ? runNightlyLedgerAudit() : { success: false }; },
      "syncLedgerFromHistory": function(d, a) { return typeof syncLedgerFromHistory === 'function' ? syncLedgerFromHistory(a[0] !== undefined ? a[0] : d.dryRun, a[1] || d.cutoverDate) : { success: false }; },
      
      // Tab 1 (Wallets & Cards)
      "getWalletsFromSheet": function(d, a) { return getWalletsFromSheet(a[0] || d.month, a[1] || d.year); },
      "saveWalletToSheet": function(d, a) { return saveWalletToSheet(a[0] || d); },
      "deleteWalletFromSheet": function(d, a) { return deleteWalletFromSheet(a[0] || d.id || d); },
      "processWalletTransfer": function(d, a) { return processWalletTransfer(a[0] || d); },
      "processCreditCardSettlement": function(d, a) { return processCreditCardSettlement(a[0] || d); },
      "getWalletTransactionHistory": function(d, a) { return getWalletTransactionHistory(a[0] || d.walletName); },
      "adjustWalletBalance": function(d, a) { return adjustWalletBalance(a[0] || d); },
      "checkpointWalletBalance": function(d, a) { return checkpointWalletBalance(a[0] || d); },
      "rebuildWalletBalance": function(d, a) { return rebuildWalletBalance(a[0] || d.walletId || d.id || d); },
      "rebuildAllWallets": function(d, a) { return rebuildAllWallets(); },
      "recordFinancialEvent": function(d, a) { return recordFinancialEvent(a[0] || d); },
      "updateFamilyTransactionById": function(d, a) { return updateFamilyTransactionById(a[0] || d); },
      "t1_isValidCardPassword": function(d, a) { return t1_isValidCardPassword(a[0] || d); },
      "setCardCustomPassword": function(d, a) { return setCardCustomPassword(a[0] || d); },
      "verifyCardPassword": function(d, a) { return verifyCardPassword(a[0] || d); },
      "saveCardSecurityDetails": function(d, a) { return typeof saveCardSecurityDetails === 'function' ? saveCardSecurityDetails(a[0] || d) : { success: false, message: "Không tìm thấy hàm saveCardSecurityDetails" }; },
      "migrateEncryptExistingCards": function(d, a) { return typeof migrateEncryptExistingCards === 'function' ? migrateEncryptExistingCards() : { success: false }; },

      // Tab 2 (Family Expenses)
      "getTab2Data": function(d, a) { return getTab2Data(a[0] || d.month, a[1] || d.year); },
      "saveFamilyTransaction": function(d, a) { return saveFamilyTransaction(a[0] || d); },
      "deleteFamilyTransaction": function(d, a) { return deleteTransaction(a[0] || d.id || d); },
      "deleteTransaction": function(d, a) { return deleteTransaction(a[0] || d.id || d); },
      "saveBatchQuickFixedAmounts": function(d, a) { return typeof saveBatchQuickFixedAmounts === 'function' ? saveBatchQuickFixedAmounts(a[0] || d) : { success: false }; },
      "processJarTransfer": function(d, a) { return typeof processJarTransfer === 'function' ? processJarTransfer(a[0] || d) : { success: false }; },

      // Tab 3 (Business & Inventory)
      "getBusinessData": function(d, a) { return getBusinessData(a[0] || d.month, a[1] || d.year, null, d.forceRefresh); },
      "savePurchaseOrder": function(d, a) { return savePurchaseOrder(a[0] || d); },
      "saveSalesOrder": function(d, a) { return saveSalesOrder(a[0] || d); },
      "updatePurchaseItemDetail": function(d, a) {
        if (a.length >= 11) {
          return updatePurchaseItemDetail(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10]);
        }
        return updatePurchaseItemDetail(
          d.itemId, d.newWh, d.newQty, d.newPrice,
          d.newGhiChu, d.newNoiMua, d.newTenSP,
          d.newNgayMua, d.newNguonTien, d.newCardStatus, d.newTaiKhoan
        );
      },
      "confirmPreOrderPayment": function(d, a) { return confirmPreOrderPayment(a[0] || d.rowId || d.itemId, a[1] || d.customDate); },
      "cancelPreOrderOrder": function(d, a) { return cancelPreOrderOrder(a[0] || d.rowId || d.itemId); },
      "confirmRefundOrderPayment": function(d, a) { return confirmRefundOrderPayment(a[0] || d.itemId || d.rowId, a[1] || d.targetWallet); },
      "updateWarehouseStatus": function(d, a) {
        var tId = (a && a.length > 0 && a[0] !== undefined) ? a[0] : (d ? (d.targetId || d.orderId || d.id || d.itemId || d) : null);
        var nWh = (a && a.length > 1 && a[1] !== undefined) ? a[1] : (d ? (d.newStatus || d.targetWh || d.toWarehouse || d.status) : null);
        var rsn = (a && a.length > 2) ? a[2] : (d ? d.reason : "");
        return updateWarehouseStatus(tId, nWh, rsn);
      },
      "updateBatchWarehouseStatus": function(d, a) {
        var itemsP = (a && a.length > 0 && a[0] !== undefined) ? a[0] : (d ? (d.itemIds || d.items || d) : null);
        var targetWhP = (a && a.length > 1 && a[1] !== undefined) ? a[1] : (d ? (d.newStatus || d.targetWh || d.toWarehouse || d.status) : null);
        return updateBatchWarehouseStatus(itemsP, targetWhP);
      },
      "transferWarehouseBatch": function(d, a) {
        var spP = (a && a.length > 0 && a[0] !== undefined) ? a[0] : (d ? (d.spName || d.productName || d) : null);
        var fromP = (a && a.length > 1 && a[1] !== undefined) ? a[1] : (d ? (d.fromWarehouse || d.fromWh) : "ALL");
        var toP = (a && a.length > 2 && a[2] !== undefined) ? a[2] : (d ? (d.toWarehouse || d.toWh || d.targetWh) : null);
        return transferWarehouseBatch(spP, fromP, toP);
      },
      "confirmBatchDebtSalesPayment": function(d, a) { return confirmBatchDebtSalesPayment(a[0] || d); },

      // Tab 4 (Debts)
      "getTab4Data": function(d, a) { return getTab4Data(a[0] || d.month, a[1] || d.year); },
      "saveDebtTransaction": function(d, a) { return saveDebtTransaction(a[0] || d); },
      "settleDebtPayment": function(d, a) { return settleDebtPayment(a[0] || d); },
      "settleSelectedNetDebtPayment": function(d, a) { return settleSelectedNetDebtPayment(a[0] || d); },
      "deleteDebtRecord": function(d, a) { return deleteDebtRecord(a[0] || d.id || d); },

      // Tab 5 (Cooldowns & Stores)
      "getTab5Data": function(d, a) { return getTab5Data(); },
      "savePurchaseLimitRecord": function(d, a) { return savePurchaseLimitRecord(a[0] || d); },
      "updatePurchaseLimitStatus": function(d, a) { return updatePurchaseLimitStatus(a[0] || d.rowId, a[1] || d.newStatus); },
      "deletePurchaseLimitRecord": function(d, a) { return deletePurchaseLimitRecord(a[0] || d.rowId); },
      "addTab5Account": function(d, a) { return addTab5Account(a[0] || d.accountName || d); },
      "saveStoreCooldownSettings": function(d, a) { return saveStoreCooldownSettings(a[0] || d.storeName, a[1] || d.days); },
      "getStoreCooldownSettings": function(d, a) { return getStoreCooldownSettings(); },

      // Tab 7 (Split Bills & Trips)
      "getSplitGroups": function(d, a) { return typeof getSplitGroups === 'function' ? getSplitGroups() : []; },
      "getSplitMembers": function(d, a) { return typeof getSplitMembers === 'function' ? getSplitMembers() : []; },
      "getSplitFamilies": function(d, a) { return typeof getSplitFamilies === 'function' ? getSplitFamilies() : []; },
      "getPresetFamilies": function(d, a) { return typeof getPresetFamilies === 'function' ? getPresetFamilies() : []; },
      "saveSplitGroup": function(d, a) { return typeof saveSplitGroup === 'function' ? saveSplitGroup(a[0] || d) : { success: false }; },
      "deleteSplitGroup": function(d, a) { return typeof deleteSplitGroup === 'function' ? deleteSplitGroup(a[0] || d.groupId || d) : { success: false }; },
      "saveSplitExpense": function(d, a) { return typeof saveSplitExpense === 'function' ? saveSplitExpense(a[0] || d) : { success: false }; },
      "deleteSplitExpense": function(d, a) { return typeof deleteSplitExpense === 'function' ? deleteSplitExpense(a[0] || d) : { success: false }; },
      "finalizeTripAndExportDebts": function(d, a) { return typeof finalizeTripAndExportDebts === 'function' ? finalizeTripAndExportDebts(a[0] || d.groupId || d, a[1] || d.exportOptions) : { success: false }; },
      "getTab7FullGroupData": function(d, a) { return typeof getTab7FullGroupData === 'function' ? getTab7FullGroupData(a[0] || d.groupId || d) : { success: false }; },
      "saveSplitFamilyMember": function(d, a) { return typeof saveSplitFamilyMember === 'function' ? saveSplitFamilyMember(a[0] || d) : { success: false }; },
      "saveSplitFamilyBatch": function(d, a) { return typeof saveSplitFamilyBatch === 'function' ? saveSplitFamilyBatch(a[0] || d) : { success: false }; },
      "deleteSplitFamilyMember": function(d, a) { return typeof deleteSplitFamilyMember === 'function' ? deleteSplitFamilyMember(a[0] || d) : { success: false }; },
      "deleteSplitFamilyEntirely": function(d, a) { return typeof deleteSplitFamilyEntirely === 'function' ? deleteSplitFamilyEntirely(a[0] || d) : { success: false }; },
      "reopenSplitGroup": function(d, a) { return typeof reopenSplitGroup === 'function' ? reopenSplitGroup(a[0] || d) : { success: false }; },
      "t7_settleDebtPayment": function(d, a) { return typeof t7_settleDebtPayment === 'function' ? t7_settleDebtPayment(a[0] || d.debtId, a[1] || d.walletName) : { success: false }; }
    };

    if (ACTION_ROUTERS[action]) {
      result = ACTION_ROUTERS[action](data, args);
    } else {
      try {
        const fn = (0, eval)(action);
        if (typeof fn === 'function') {
          result = fn.apply(null, args);
        }
      } catch (eEval) {}
    }

    const callback = payload.callback || (e && e.parameter ? e.parameter.callback : null);
    if (callback) {
      const jsonpStr = String(callback) + "(" + JSON.stringify(result) + ");";
      if (typeof ContentService !== 'undefined' && ContentService.createTextOutput) {
        return ContentService.createTextOutput(jsonpStr)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return jsonpStr;
    }

    if (typeof ContentService !== 'undefined' && ContentService.createTextOutput) {
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return result;
  } catch (err) {
    const errRes = { success: false, message: "❌ Lỗi Server GAS: " + err.toString() };
    const callback = (e && e.parameter ? e.parameter.callback : null);
    if (callback) {
      const jsonpErrStr = String(callback) + "(" + JSON.stringify(errRes) + ");";
      if (typeof ContentService !== 'undefined' && ContentService.createTextOutput) {
        return ContentService.createTextOutput(jsonpErrStr)
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
    }
    if (typeof ContentService !== 'undefined' && ContentService.createTextOutput) {
      return ContentService.createTextOutput(JSON.stringify(errRes))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return errRes;
  }
}

/**
 * 1. THỰC THI CHUẨN VỚI SCRIPT LOCK AN TOÀN
 * Tách biệt rõ ràng giữa lỗi không lấy được khóa (SYSTEM_BUSY - retryable)
 * và lỗi nghiệp vụ nội bộ (INTERNAL_ERROR - không retry mù quáng).
 */
function executeWithLock(lockTimeoutMs, actionCallback) {
  const lock = (typeof LockService !== 'undefined' && LockService.getScriptLock) ? LockService.getScriptLock() : null;
  let locked = false;

  if (lock) {
    try {
      lock.waitLock(lockTimeoutMs || 15000);
      locked = true;
    } catch (lockErr) {
      return {
        success: false,
        retryable: true,
        code: "SYSTEM_BUSY",
        message: "⏳ Máy chủ đang bận xử lý giao dịch khác, ứng dụng đang tự động thử lại..."
      };
    }
  }

  try {
    return actionCallback();
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi executeWithLock: " + err);
    return {
      success: false,
      retryable: false,
      code: "INTERNAL_ERROR",
      message: "❌ Lỗi hệ thống: " + (err && err.message ? err.message : err.toString())
    };
  } finally {
    if (locked && lock) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}

/**
 * 2. QUẢN LÝ PHIÊN BẢN DỮ LIỆU NGUYÊN TỬ (ATOMIC DATA VERSION COUNTER)
 */
function getAppVersion() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const val = PropertiesService.getScriptProperties().getProperty("DATA_VERSION");
      return val ? parseInt(val, 10) : 1;
    }
  } catch(e) {}
  return 1;
}

function incrementDataVersion() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      const current = parseInt(props.getProperty("DATA_VERSION") || "1", 10);
      const next = current + 1;
      props.setProperty("DATA_VERSION", String(next));
      return next;
    }
  } catch(e) {}
  return 1;
}

/**
 * 3. HỆ THỐNG IDEMPOTENCY THEO REQUEST ID (FAST CACHE + SHEET BACKED)
 */
var SHEET_PROCESSED_REQUESTS = "ProcessedRequests";

function getProcessedRequest(requestId, ssTarget) {
  if (!requestId) return null;
  const key = "REQ_" + String(requestId).trim();

  // 1. Kiểm tra CacheService siêu tốc
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cached = CacheService.getScriptCache().get(key);
      if (cached) {
        return JSON.parse(cached);
      }
    }
  } catch(e) {}

  // 2. Fallback kiểm tra Sheet ProcessedRequests bền vững
  try {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return null;
    const sheet = ss.getSheetByName(SHEET_PROCESSED_REQUESTS);
    if (!sheet || sheet.getLastRow() < 2) return null;

    const lastRow = sheet.getLastRow();
    const startRow = Math.max(2, lastRow - 500);
    const numRows = lastRow - startRow + 1;
    const data = sheet.getRange(startRow, 1, numRows, 5).getValues();

    const targetReqId = String(requestId).trim().toLowerCase();
    for (let i = data.length - 1; i >= 0; i--) {
      const rReqId = String(data[i][0] || "").trim().toLowerCase();
      if (rReqId === targetReqId) {
        const status = String(data[i][1] || "DONE").trim().toUpperCase();
        const resJsonStr = String(data[i][4] || "");
        let resData = null;
        try { if (resJsonStr) resData = JSON.parse(resJsonStr); } catch(eParse) {}
        return {
          requestId: data[i][0],
          status: status,
          createdAt: data[i][2],
          result: resData
        };
      }
    }
  } catch(e) {}

  return null;
}

function autoPruneProcessedRequests(sheet, keepCount) {
  if (!sheet) return 0;
  try {
    const maxKeep = keepCount || 500;
    const lastRow = sheet.getLastRow();
    // Header is row 1, data starts at row 2
    if (lastRow > maxKeep + 100) {
      const deleteCount = lastRow - maxKeep - 1;
      if (deleteCount > 0) {
        sheet.deleteRows(2, deleteCount);
        return deleteCount;
      }
    }
  } catch(e) {}
  return 0;
}

function recordProcessedRequest(requestId, status, resultObj, ssTarget) {
  if (!requestId) return;
  const reqStr = String(requestId).trim();
  const resStr = resultObj ? JSON.stringify(resultObj) : "";
  const nowIso = new Date().toISOString();

  // 1. Lưu vào CacheService (TTL 6 giờ)
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      CacheService.getScriptCache().put("REQ_" + reqStr, JSON.stringify({
        requestId: reqStr,
        status: status,
        createdAt: nowIso,
        result: resultObj
      }), 21600);
    }
  } catch(e) {}

  // 2. Lưu vào Sheet ProcessedRequests
  try {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return;
    let sheet = ss.getSheetByName(SHEET_PROCESSED_REQUESTS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_PROCESSED_REQUESTS);
      sheet.getRange(1, 1, 1, 5).setValues([["RequestId", "Status", "CreatedAt", "UpdatedAt", "ResultJson"]]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f1f5f9");
    }
    sheet.appendRow([reqStr, status, nowIso, nowIso, resStr]);

    // 3. Tự động dọn dẹp (Rolling Window Auto-Clean):
    // Giữ lại 500 bản ghi mới nhất, khi số dòng vượt quá 600 dòng thì tự động cắt tỉa các dòng cũ nhất
    autoPruneProcessedRequests(sheet, 500);
  } catch(e) {}
}

/**
 * HIGH-PERFORMANCE CHUNKED CACHE ENGINE
 * Supports unlimited JSON payload sizes via 80KB multi-key chunking
 */
function setCachedAppDataStr(cacheKey, jsonStr, ttlSeconds) {
  if (!jsonStr || typeof CacheService === 'undefined' || !CacheService.getScriptCache) return false;
  try {
    const cache = CacheService.getScriptCache();
    const ttl = ttlSeconds || 600; // 10 minutes TTL
    const chunkSize = 80000; // 80KB per chunk (under 100KB GAS limit)

    if (jsonStr.length <= chunkSize) {
      const putObj = {};
      putObj[cacheKey] = jsonStr;
      putObj[cacheKey + "_cnt"] = "1";
      putObj[cacheKey + "_c0"] = jsonStr;
      cache.putAll(putObj, ttl);
      return true;
    }

    const chunksCount = Math.ceil(jsonStr.length / chunkSize);
    const putObj = {};
    putObj[cacheKey + "_cnt"] = String(chunksCount);

    for (let i = 0; i < chunksCount; i++) {
      const chunkStr = jsonStr.substring(i * chunkSize, (i + 1) * chunkSize);
      putObj[cacheKey + "_c" + i] = chunkStr;
    }

    cache.putAll(putObj, ttl);
    return true;
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Error in setCachedAppDataStr: " + err.toString());
    return false;
  }
}

function getCachedAppDataStr(cacheKey) {
  if (!cacheKey || typeof CacheService === 'undefined' || !CacheService.getScriptCache) return null;
  try {
    const cache = CacheService.getScriptCache();
    const cntStr = cache.get(cacheKey + "_cnt");

    if (!cntStr) {
      const single = cache.get(cacheKey);
      return single || null;
    }

    const cnt = parseInt(cntStr, 10);
    if (isNaN(cnt) || cnt <= 0) return null;

    if (cnt === 1) {
      const single = cache.get(cacheKey) || cache.get(cacheKey + "_c0");
      return single || null;
    }

    const keysToFetch = [];
    for (let i = 0; i < cnt; i++) {
      keysToFetch.push(cacheKey + "_c" + i);
    }

    const map = cache.getAll(keysToFetch);
    const parts = [];
    for (let i = 0; i < cnt; i++) {
      const part = map[cacheKey + "_c" + i];
      if (!part) return null; // Incomplete chunk -> cache miss
      parts.push(part);
    }

    return parts.join("");
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Error in getCachedAppDataStr: " + err.toString());
    return null;
  }
}

/**
 * XOÁ CACHE KHI CÓ THAY ĐỔI DỮ LIỆU (MUTATION) - TỐI ƯU SIÊU TỐC
 */
function clearAppDataCache(month, year) {
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      const baseKeys = [];
      const appVersions = ["V29_", "V28_", "V27_", "V26_", "V25_", "V18_", ""];
      const bizVersions = ["v17_"];

      const targetMonths = (month && month !== "ALL" && month !== "All")
        ? [String(month), "ALL"]
        : ["ALL", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
      
      const currentYear = new Date().getFullYear();
      const targetYears = (year && year !== "ALL" && year !== "All")
        ? [String(year), "ALL"]
        : ["ALL", String(currentYear - 1), String(currentYear), String(currentYear + 1)];

      appVersions.forEach(v => {
        targetMonths.forEach(m => {
          targetYears.forEach(y => {
            baseKeys.push("APP_DATA_" + v + m + "_" + y);
          });
        });
      });
      bizVersions.forEach(v => {
        targetMonths.forEach(m => {
          targetYears.forEach(y => {
            baseKeys.push("biz_data_" + v + m + "_" + y);
          });
        });
      });
      baseKeys.push("APP_DATA_GLOBAL_LATEST", "APP_DATA_GLOBAL_LATEST_V18", "APP_DATA_GLOBAL_LATEST_V25", "APP_DATA_GLOBAL_LATEST_V26", "APP_DATA_GLOBAL_LATEST_V28", "APP_DATA_GLOBAL_LATEST_V29", "tab5_data_v1");

      const allKeys = [];
      baseKeys.forEach(k => {
        allKeys.push(k);
        allKeys.push(k + "_cnt");
        for (let c = 0; c < 3; c++) {
          allKeys.push(k + "_c" + c);
        }
      });

      if (typeof cache.removeAll === 'function') {
        for (let i = 0; i < allKeys.length; i += 100) {
          cache.removeAll(allKeys.slice(i, i + 100));
        }
      } else {
        allKeys.forEach(k => cache.remove(k));
      }
    }
  } catch(e) {}
}

/**
 * THỰC HIỆN THAO TÁC GOOGLE SHEETS VỚI CƠ CHẾ TỰ ĐỘNG THỬ LẠI KHI BỊ XUNG ĐỘT CONCURRENCY
 */
function withSheetRetry(operationFn, maxRetries) {
  const retries = maxRetries || 3;
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return operationFn();
    } catch (err) {
      lastErr = err;
      const errStr = String(err || "");
      if (
        errStr.includes("Spreadsheets") ||
        errStr.includes("Lock") ||
        errStr.includes("Service error") ||
        errStr.includes("concurrent") ||
        errStr.includes("simultaneous") ||
        errStr.includes("quá nhiều")
      ) {
        if (typeof Utilities !== 'undefined' && Utilities.sleep) {
          Utilities.sleep(200 * (attempt + 1));
        }
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

/**
 * UNIFIED INITIAL APP LOAD RPC - OPTIMIZED FOR REAL-TIME DATA & FAST PERFORMANCE
 */
function getAppData(month, year, ssTarget, forceRefresh) {
  const isAllMonth = (!month || month === "All" || String(month).toUpperCase() === "ALL");
  const isAllYear = (!year || year === "All" || String(year).toUpperCase() === "ALL");
  const m = isAllMonth ? "ALL" : String(month).trim();
  const y = isAllYear ? "ALL" : String(year).trim();
  const cacheKey = "APP_DATA_V29_" + m + "_" + y;

  if (forceRefresh) {
    clearAppDataCache(m, y);
  }

  try {
    if (!forceRefresh && typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
      const cachedStr = getCachedAppDataStr(cacheKey);
      if (cachedStr) {
        return JSON.parse(cachedStr);
      }
    }
  } catch(e) {}

  try {
    return withSheetRetry(function() {
      const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();

      // 1. Wallets & Pending Pre-orders (Always "All" for global cumulative balance & pending counts)
      let wallets = [];
      let pendingPreOrders = [];
      let orderCounts = null;
      if (typeof getWalletsFromSheet === 'function') {
        const wRes = getWalletsFromSheet("All", "All", ss);
        if (wRes) {
          if (wRes.wallets) wallets = wRes.wallets;
          if (wRes.pendingPreOrders) pendingPreOrders = wRes.pendingPreOrders;
          if (wRes.orderCounts) orderCounts = wRes.orderCounts;
        }
      }

      // 2. Categories / Initial Data
      let categories = [];
      let accounts = [];
      if (typeof getInitialData === 'function') {
        const catRes = getInitialData(ss);
        if (catRes && catRes.categories) categories = catRes.categories;
        if (catRes && catRes.accounts) accounts = catRes.accounts;
      }

      // 3. Tab 2 Data (ONLY module filtered strictly by current month/year when "All" is selected)
      let tab2 = { summary: { net: 0, income: 0, expense: 0 }, transactions: [], jars: [] };
      if (typeof getTab2Data === 'function') {
        const curM = (new Date().getMonth() + 1).toString();
        const curY = new Date().getFullYear().toString();
        const t2M = isAllMonth ? curM : m;
        const t2Y = isAllYear ? curY : y;
        const t2Res = getTab2Data(t2M, t2Y, ss);
        if (t2Res) tab2 = t2Res;
      }

      // 4. Quick Fixed Items (Always "All")
      let quickFixed = [];
      if (typeof getQuickFixedItems === 'function') {
        const qRes = getQuickFixedItems("All", "All", ss);
        if (qRes && qRes.items) quickFixed = qRes.items;
      }

      // 5. Tab 3 Business Data (Filtered by month/year for sales & cogs summary; all-time for stock)
      let tab3 = null;
      if (typeof getBusinessData === 'function') {
        const t3Res = getBusinessData(m, y, ss, forceRefresh);
        if (t3Res && t3Res.success) tab3 = t3Res;
      }

      // 6. Tab 5 Cooldown Data (Always ALL)
      let tab5 = null;
      if (typeof getTab5Data === 'function') {
        const t5Res = getTab5Data(ss);
        if (t5Res && t5Res.success) tab5 = t5Res;
      }

      // 7. Tab 4 Debt Data (Active debts always included, completed filtered by month/year)
      let tab4 = null;
      try {
        if (typeof getTab4Data === 'function') {
          tab4 = getTab4Data(m, y, ss, forceRefresh);
        }
      } catch (e) {
        Logger.log("Error loading tab4: " + e.toString());
      }

      // 8. Tab 7 Split Families & Groups Data
      let splitFamilies = [];
      let splitGroups = [];
      let rawFamilyMembers = [];
      try {
        if (typeof getSplitFamilies === 'function') {
          const famRes = getSplitFamilies(ss);
          if (famRes && famRes.families) {
            splitFamilies = famRes.families;
            if (famRes.rawMembers) rawFamilyMembers = famRes.rawMembers;
          } else if (Array.isArray(famRes)) {
            splitFamilies = famRes;
          }
        }
        if (typeof getSplitGroups === 'function') {
          const grpRes = getSplitGroups(ss);
          if (grpRes && grpRes.groups) {
            splitGroups = grpRes.groups;
          } else if (Array.isArray(grpRes)) {
            splitGroups = grpRes;
          }
        }
      } catch (e) {
        Logger.log("Error loading Tab 7 in getAppData: " + e.toString());
      }

      // Canonical calculation of orderCounts directly from tab3 data (Gom theo mã đơn hàng gốc)
      if (tab3) {
        const preOrderIdsSet = new Set((tab3.preOrders || []).map(it => String(it.id || '').trim()));
        const refundIdsSet = new Set((tab3.cancelledRefundPending || []).map(it => String(it.id || '').trim()));

        const choShipKeys = new Set();
        (tab3.inventory || []).forEach(it => {
          const rawId = String(it.id || '').trim();
          if (refundIdsSet.has(rawId)) return;

          const wh = String(it.trangThaiKho || '').trim().toLowerCase();
          const isCancelled = wh.includes('hủy') || wh.includes('cancel');
          if (isCancelled) return;

          if (wh === 'chờ ship' || wh === 'cho ship') {
            const match = rawId.match(/^([A-Za-z0-9]+[-_].+?)[-_]([1-9]\d{0,2})$/);
            const baseId = (match && match[1]) ? match[1] : rawId;
            choShipKeys.add(baseId || rawId);
          }
        });

        const preKeys = new Set();
        (tab3.preOrders || []).forEach(it => {
          const rawId = String(it.id || '').trim();
          const match = rawId.match(/^([A-Za-z0-9]+[-_].+?)[-_]([1-9]\d{0,2})$/);
          const baseId = (match && match[1]) ? match[1] : rawId;
          preKeys.add(baseId || rawId);
        });

        orderCounts = {
          choShip: choShipKeys.size,
          preorder: preKeys.size,
          khachNo: (tab3.debtSales || []).length,
          choHoan: (tab3.cancelledRefundPending || []).length
        };
      }

      const result = {
        success: true,
        wallets: wallets,
        pendingPreOrders: pendingPreOrders,
        orderCounts: orderCounts,
        categories: categories,
        accounts: accounts,
        tab2: tab2,
        tab3: tab3,
        tab4: tab4,
        tab5: tab5,
        splitFamilies: splitFamilies,
        rawFamilyMembers: rawFamilyMembers,
        splitGroups: splitGroups,
        quickFixed: quickFixed
      };

      try {
        if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
          const jsonStr = JSON.stringify(result);
          setCachedAppDataStr(cacheKey, jsonStr, 600);
          setCachedAppDataStr("APP_DATA_GLOBAL_LATEST_V29", jsonStr, 600);
        }
      } catch(e) {}

      return result;
    });
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

/**
 * TIỆN ÍCH CHUẨN HÓA TRẠNG THÁI TOÀN BỘ DATABASE GOOGLE SHEETS
 * Quy hoạch dữ liệu lịch sử khớp 100% bộ 7 Trạng Thái chuẩn:
 * 1. PRE-ORDER
 * 2. ĐÃ SAO KÊ
 * 3. HOAN_TAT
 * 4. CHO_THANH_TOAN
 * 5. BỊ HỦY
 * 6. BỊ HỦY - CHỜ HOÀN
 * 7. ĐÃ HOÀN TIỀN
 */
function formatStandardID(rawId, expectedPrefix) {
  if (!rawId) return rawId;
  const str = String(rawId).trim();
  if (!str) return str;
  if (str.startsWith(expectedPrefix)) return str;

  if (expectedPrefix === "BO-") {
    if (/^BO/i.test(str)) return "BO-" + str.replace(/^BO-?/i, "");
    if (/^(BIZ_|SO_PAY_|PO_CONF_|BD|RF_PAY_)/i.test(str)) {
      return "BO-" + str.replace(/^(BIZ_|SO_PAY_|PO_CONF_|BD|RF_PAY_)/i, "");
    }
  }

  if (expectedPrefix === "PO-") {
    if (/^PO/i.test(str)) return "PO-" + str.replace(/^PO-?/i, "");
    if (/^DT/i.test(str)) return "PO-" + str.replace(/^DT-?/i, "");
    if (/^(PUR_LM_|PUR_|LM)/i.test(str)) {
      return "PO-" + str.replace(/^(PUR_LM_|PUR_|LM)/i, "");
    }
  }

  if (expectedPrefix === "SO-") {
    if (/^SO/i.test(str)) return "SO-" + str.replace(/^SO-?/i, "");
    if (/^DT/i.test(str)) return "SO-" + str.replace(/^DT-?/i, "");
    if (/^(SALES_|SL_)/i.test(str)) {
      return "SO-" + str.replace(/^(SALES_|SL_)/i, "");
    }
  }

  return str;
}

function standardizeAllSheetStatuses(ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    let updatedCountP = 0;
    let updatedCountF = 0;
    let updatedCountD = 0;
    let updatedCountB = 0;
    let updatedCountS = 0;

    // 1. Standardize Sheet Purchase (17 columns) & Fix PO- IDs
    const pSheet = ss.getSheetByName("Purchase");
    if (pSheet && pSheet.getLastRow() >= 2) {
      const lastColP = Math.max(pSheet.getLastColumn(), 17);
      const pRange = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP);
      const pData = pRange.getValues();
      let pChanged = false;

      for (let i = 0; i < pData.length; i++) {
        const row = pData[i];

        // Chuẩn hóa ID Cột A sang PO-
        const rawId = String(row[0] || "").trim();
        const stdId = formatStandardID(rawId, "PO-");
        if (rawId && stdId !== rawId) {
          row[0] = stdId;
          pChanged = true;
        }

        const wh = String(row[3] || "").trim();
        const lowerWh = wh.toLowerCase();
        const nguonTien = String(row[8] || "").trim();
        const cardStatus = String(row[9] || "").trim();
        const lowerCardStatus = cardStatus.toLowerCase();
        const ghiChu = String(row[10] || "").trim();
        const lowerGhiChu = ghiChu.toLowerCase();
        const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(nguonTien, ss) : false;

        let targetStatus = cardStatus;

        if (lowerWh.includes("hủy") || lowerWh.includes("bị hủy") || lowerWh.includes("cancel")) {
          if (lowerWh.includes("hoàn") || lowerCardStatus.includes("hoàn")) {
            targetStatus = "ĐÃ HOÀN TIỀN";
          } else if (lowerWh.includes("chờ hoàn")) {
            targetStatus = "Hủy";
          } else {
            targetStatus = "Hủy";
          }
        } else if (!isCredit) {
          targetStatus = "HOAN_TAT";
        } else if (
          lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") ||
          lowerCardStatus.includes("pre_order") || lowerCardStatus.includes("sao kê") ||
          lowerCardStatus.includes("chờ trừ") || lowerGhiChu.includes("pre-order") ||
          lowerGhiChu.includes("preorder") || lowerGhiChu.includes("chờ sao kê") ||
          lowerGhiChu.includes("chờ trừ thẻ") || (isCredit && (lowerWh === "chờ ship" || lowerWh.includes("chờ ship") || lowerWh.includes("chusen")))
        ) {
          if (lowerCardStatus.includes("đã sao kê") || lowerCardStatus.includes("đã trừ thẻ")) {
            targetStatus = "HOAN_TAT";
          } else {
            targetStatus = "PRE-ORDER";
          }
        } else if (!targetStatus) {
          targetStatus = "HOAN_TAT";
        } else if (targetStatus !== "ĐÃ SAO KÊ" && targetStatus !== "PRE-ORDER" && targetStatus !== "BỊ HỦY" && targetStatus !== "Hủy" && targetStatus !== "ĐÃ HOÀN TIỀN") {
          targetStatus = "HOAN_TAT";
        }

        if (row[9] !== targetStatus) {
          row[9] = targetStatus;
          pChanged = true;
          updatedCountP++;
        }
      }

      if (pChanged) {
        pRange.setValues(pData);
      }
    }

    // 2. Standardize Sheet Sales & Fix SO- IDs
    const sSheet = ss.getSheetByName("Sales");
    if (sSheet && sSheet.getLastRow() >= 2) {
      const lastColS = Math.max(sSheet.getLastColumn(), 11);
      const sRange = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, lastColS);
      const sData = sRange.getValues();
      let sChanged = false;

      for (let i = 0; i < sData.length; i++) {
        const row = sData[i];
        const rawId = String(row[0] || "").trim();
        const stdId = formatStandardID(rawId, "SO-");
        if (rawId && stdId !== rawId) {
          row[0] = stdId;
          sChanged = true;
          updatedCountS++;
        }
      }

      if (sChanged) {
        sRange.setValues(sData);
      }
    }

    // 3. Standardize Sheet Family (11 columns)
    const fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
    if (fSheet && fSheet.getLastRow() >= 2) {
      const lastColF = Math.max(fSheet.getLastColumn(), 11);
      const fRange = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, lastColF);
      const fData = fRange.getValues();
      let fChanged = false;

      for (let i = 0; i < fData.length; i++) {
        const row = fData[i];
        const statusVal = String(row[9] || "").trim();
        const lowerStatus = statusVal.toLowerCase();
        const ghiChu = String(row[8] || "").toLowerCase();
        const noiDung = String(row[4] || "").toLowerCase();

        let targetStatus = statusVal;
        if (
          lowerStatus.includes("pre-order") || lowerStatus.includes("preorder") || lowerStatus.includes("sao kê") ||
          ghiChu.includes("pre-order") || ghiChu.includes("preorder") || ghiChu.includes("chờ sao kê") ||
          noiDung.includes("pre-order") || noiDung.includes("preorder") || noiDung.includes("chờ sao kê")
        ) {
          targetStatus = (lowerStatus.includes("đã sao kê") || lowerStatus.includes("hoan_tat")) ? "HOAN_TAT" : "PRE-ORDER";
        } else if (!targetStatus || (targetStatus !== "PRE-ORDER" && targetStatus !== "ĐÃ SAO KÊ")) {
          targetStatus = "HOAN_TAT";
        }

        if (row[9] !== targetStatus) {
          row[9] = targetStatus;
          fChanged = true;
          updatedCountF++;
        }
      }

      if (fChanged) {
        fRange.setValues(fData);
      }
    }

    // 5. Standardize Sheet Debt (13 columns: Col K = Trạng Thái dư nợ, Col L = Trạng thái thẻ, Col M = Ngày sao kê)
    const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
    if (dSheet && dSheet.getLastRow() >= 2) {
      const lastColD = Math.max(dSheet.getLastColumn(), 13);
      const dRange = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, lastColD);
      const dData = dRange.getValues();
      let dChanged = false;

      for (let i = 0; i < dData.length; i++) {
        const row = dData[i];
        const statusVal = String(row[10] || "").trim();
        const duNo = Number(row[9]) || 0;

        let targetStatus = duNo > 0 ? "DANG_NO" : "DA_TRA";

        if (row[10] !== targetStatus) {
          row[10] = targetStatus;
          dChanged = true;
          updatedCountD++;
        }
      }

      if (dChanged) {
        dRange.setValues(dData);
      }
    }

    // 6. Standardize Sheet SplitFamilies
    if (typeof standardizeSplitFamiliesSheet === 'function') {
      standardizeSplitFamiliesSheet(ss);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return {
      success: true,
      message: `✅ Đã chuẩn hóa toàn bộ database và Mã ID (Purchase PO-: ${updatedCountP}, Sales SO-: ${updatedCountS}, Family: ${updatedCountF}, Debt: ${updatedCountD}, SplitFamilies: OK)!`
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi chuẩn hóa database: " + err.toString() };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    executeWithLock,
    getAppVersion,
    incrementDataVersion,
    getProcessedRequest,
    recordProcessedRequest,
    autoPruneProcessedRequests,
    clearAppDataCache,
    getCachedAppDataStr,
    setCachedAppDataStr,
    getAppData
  };
}

