// ==========================================
// FILE: Server_Main.js
// NHIỆM VỤ: Khởi tạo Web App & Cấu trúc gốc
// ==========================================

function doGet(e) {
  if (e && e.parameter && e.parameter.action) {
    return doPost(e);
  }
  const tmp = HtmlService.createTemplateFromFile('Index');
  try {
    const m = (new Date().getMonth() + 1).toString();
    const y = new Date().getFullYear().toString();
    let initialData = "null";
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      const cacheKey = "APP_DATA_V18_" + m + "_" + y;
      let cached = cache.get(cacheKey) || cache.get("APP_DATA_GLOBAL_LATEST_V18");
      if (cached && cached.length < 90000) {
        initialData = cached;
      }
    }
    tmp.initialDataJson = JSON.stringify(initialData);
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
      
      // Tab 1 (Wallets & Cards)
      "getWalletsFromSheet": function(d, a) { return getWalletsFromSheet(a[0] || d.month, a[1] || d.year); },
      "saveWalletToSheet": function(d, a) { return saveWalletToSheet(a[0] || d); },
      "deleteWalletFromSheet": function(d, a) { return deleteWalletFromSheet(a[0] || d.id || d); },
      "processWalletTransfer": function(d, a) { return processWalletTransfer(a[0] || d); },
      "processCreditCardSettlement": function(d, a) { return processCreditCardSettlement(a[0] || d); },
      "getWalletTransactionHistory": function(d, a) { return getWalletTransactionHistory(a[0] || d.walletName); },
      "adjustWalletBalance": function(d, a) { return adjustWalletBalance(a[0] || d); },
      "updateFamilyTransactionById": function(d, a) { return updateFamilyTransactionById(a[0] || d); },
      "t1_isValidCardPassword": function(d, a) { return t1_isValidCardPassword(a[0] || d); },
      "setCardCustomPassword": function(d, a) { return setCardCustomPassword(a[0] || d); },
      "verifyCardPassword": function(d, a) { return verifyCardPassword(a[0] || d); },

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
      "updateBatchWarehouseStatus": function(d, a) { return updateBatchWarehouseStatus(a[0] || d); },
      "transferWarehouseBatch": function(d, a) { return transferWarehouseBatch(a[0] || d); },
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



// Dummy functions removed to avoid scope conflict with Server_Tab3.js and Server_Tab4.js

/**
 * XOÁ CACHE KHI CÓ THAY ĐỔI DỮ LIỆU (MUTATION)
 */
function clearAppDataCache(month, year) {
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      const keys = [];
      const appVersions = ["", "V6_", "V11_", "V15_", "V16_", "V17_", "V18_"];
      const bizVersions = ["", "v5_", "v15_", "v16_", "v17_"];
      const months = ["ALL", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
      const years = ["ALL", "2024", "2025", "2026", "2027"];

      appVersions.forEach(v => {
        months.forEach(m => {
          years.forEach(y => {
            keys.push("APP_DATA_" + v + m + "_" + y);
          });
        });
      });
      bizVersions.forEach(v => {
        months.forEach(m => {
          years.forEach(y => {
            keys.push("biz_data_" + v + m + "_" + y);
          });
        });
      });
      keys.push("APP_DATA_GLOBAL_LATEST", "APP_DATA_GLOBAL_LATEST_V16", "APP_DATA_GLOBAL_LATEST_V17", "tab5_data_v1");

      if (typeof cache.removeAll === 'function') {
        for (let i = 0; i < keys.length; i += 100) {
          cache.removeAll(keys.slice(i, i + 100));
        }
      } else {
        keys.forEach(k => cache.remove(k));
      }
    }
  } catch(e) {}
}

/**
 * UNIFIED INITIAL APP LOAD RPC - OPTIMIZED FOR REAL-TIME DATA & FAST PERFORMANCE
 */
function getAppData(month, year, ssTarget, forceRefresh) {
  const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
  const isAllYear = (!year || year === "ALL" || String(year).toUpperCase() === "ALL");
  const m = isAllMonth ? "ALL" : month;
  const y = isAllYear ? "ALL" : year;
  const cacheKey = "APP_DATA_V18_" + m + "_" + y;

  if (forceRefresh) {
    clearAppDataCache(m, y);
  }

  try {
    if (!forceRefresh && typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
      const cache = CacheService.getScriptCache();
      const cached = cache.get(cacheKey);
      if (cached && cached.length < 90000) {
        return JSON.parse(cached);
      }
    }
  } catch(e) {}

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();

    // 1. Wallets & Pending Pre-orders
    let wallets = [];
    let pendingPreOrders = [];
    let orderCounts = null;
    if (typeof getWalletsFromSheet === 'function') {
      const wRes = getWalletsFromSheet(m, y, ss);
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

    // 5. Tab 3 Business Data
    let tab3 = null;
    if (typeof getBusinessData === 'function') {
      const t3Res = getBusinessData(m, y, ss, forceRefresh);
      if (t3Res && t3Res.success) tab3 = t3Res;
    }

    // 6. Tab 5 Cooldown Data
    let tab5 = null;
    if (typeof getTab5Data === 'function') {
      const t5Res = getTab5Data(ss);
      if (t5Res && t5Res.success) tab5 = t5Res;
    }

    // 7. Tab 4 Debt Data
    let tab4 = null;
    try {
      if (typeof getTab4Data === 'function') {
        tab4 = getTab4Data(m, y, ss, forceRefresh);
      }
    } catch (e) {
      Logger.log("Error loading tab4: " + e.toString());
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
      quickFixed: quickFixed
    };

    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
        const cache = CacheService.getScriptCache();
        const jsonStr = JSON.stringify(result);
        if (jsonStr.length < 90000) {
          cache.put(cacheKey, jsonStr, 600); // 600 Seconds (10 minutes) TTL
          cache.put("APP_DATA_GLOBAL_LATEST_V18", jsonStr, 600);
        }
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
    const pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("MuaHang");
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

    // 2. Standardize Sheet Sales (BanHang) & Fix SO- IDs
    const sSheet = ss.getSheetByName("Sales") || ss.getSheetByName("BanHang");
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

    // 3. Standardize Sheet Business (KinhDoanh) & Fix BO- IDs
    const bSheet = ss.getSheetByName("Business") || ss.getSheetByName("KinhDoanh");
    if (bSheet && bSheet.getLastRow() >= 2) {
      const lastColB = Math.max(bSheet.getLastColumn(), 7);
      const bRange = bSheet.getRange(2, 1, bSheet.getLastRow() - 1, lastColB);
      const bData = bRange.getValues();
      let bChanged = false;

      for (let i = 0; i < bData.length; i++) {
        const row = bData[i];
        const rawId = String(row[0] || "").trim();
        const stdId = formatStandardID(rawId, "BO-");
        if (rawId && stdId !== rawId) {
          row[0] = stdId;
          bChanged = true;
          updatedCountB++;
        }
      }

      if (bChanged) {
        bRange.setValues(bData);
      }
    }

    // 4. Standardize Sheet Family (11 columns)
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

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return {
      success: true,
      message: `✅ Đã chuẩn hóa toàn bộ database và Mã ID (Business BO-: ${updatedCountB}, Purchase PO-: ${updatedCountP}, Sales SO-: ${updatedCountS}, Family: ${updatedCountF}, Debt: ${updatedCountD})!`
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi chuẩn hóa database: " + err.toString() };
  }
}
