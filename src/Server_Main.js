// ==========================================
// FILE: Server_Main.js
// NHIỆM VỤ: Khởi tạo Web App & Cấu trúc gốc
// ==========================================

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'syncToVercel') {
    const res = typeof syncKianDataToVercel === 'function' ? syncKianDataToVercel() : { success: false, message: "Không tìm thấy hàm syncKianDataToVercel" };
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

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
      initialDataStr = getCachedAppDataStr("APP_DATA_GLOBAL_LATEST_V34") ||
                       getCachedAppDataStr("APP_DATA_V34_ALL_ALL") ||
                       getCachedAppDataStr("APP_DATA_V34_" + m + "_" + y);
      if (!initialDataStr) {
        try {
          initialDataStr = CacheService.getScriptCache().get("TAB1_ESSENTIAL_CACHE_V3") ||
                           CacheService.getScriptCache().get("TAB1_ESSENTIAL_CACHE_LATEST");
        } catch(ce) {}
      }
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
 * UNIVERSAL REST API ENDPOINT FOR WEB CLIENTS & FETCH API
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
      // Multi-tenant Auth
      "loginUser": function(d, a) { return typeof loginUser === 'function' ? loginUser(a[0] || d.username, a[1] || d.password) : { success: false, message: "Hàm loginUser chưa sẵn sàng" }; },
      "changeUserPassword": function(d, a) { return typeof changeUserPassword === 'function' ? changeUserPassword(a[0] || d.username, a[1] || d.oldPassword, a[2] || d.newPassword) : { success: false, message: "Hàm changeUserPassword chưa sẵn sàng" }; },

      // Global & Preload
      "getAppData": function(d, a) { return getAppData(a[0] || d.month, a[1] || d.year, a[2] || d.ssTarget || d.spreadsheetId || null, d.forceRefresh); },
      "getTab1EssentialData": function(d, a) { return typeof getTab1EssentialData === 'function' ? getTab1EssentialData(d.forceRefresh, a[1] || d.ssTarget || d.spreadsheetId || null) : {}; },
      "getInitialData": function(d, a) { return typeof getInitialData === 'function' ? getInitialData(a[0] || (d ? (d.ssTarget || d.spreadsheetId || d.token || d.sessionToken) : null)) : {}; },
      "getAppVersion": function(d, a) {
        const checkChanges = Boolean((a && a[0] === true) || (d && d.checkSheetChanges));
        const vRes = getAppVersion(checkChanges);
        return (typeof vRes === 'object' && vRes !== null) ? vRes : { success: true, version: vRes };
      },
      "runNightlyLedgerAudit": function(d, a) { return typeof runNightlyLedgerAudit === 'function' ? runNightlyLedgerAudit() : { success: false }; },
      "syncLedgerFromHistory": function(d, a) { return typeof syncLedgerFromHistory === 'function' ? syncLedgerFromHistory(a[0] !== undefined ? a[0] : d.dryRun, a[1] || d.cutoverDate) : { success: false }; },
      
      // Tab 1 (Wallets & Cards)
      "getFinancialTrendStats": function(d, a) { return getFinancialTrendStats(a[0] !== undefined ? a[0] : (d ? (d.monthsCount || d.cycle) : 3), a[1] !== undefined ? a[1] : (d ? d.anchorMonth : null), a[2] !== undefined ? a[2] : (d ? d.anchorYear : null), a[3] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "getWalletsFromSheet": function(d, a) { return getWalletsFromSheet(a[0] || d.month, a[1] || d.year, a[2] || d.ssTarget || d.spreadsheetId || null); },
      "saveWalletToSheet": function(d, a) { return saveWalletToSheet(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "deleteWalletFromSheet": function(d, a) { return deleteWalletFromSheet(a[0] || d.id || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "hideCardOrWallet": function(d, a) { return hideCardOrWallet(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "restoreCardOrWallet": function(d, a) { return restoreCardOrWallet(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "processWalletTransfer": function(d, a) { return processWalletTransfer(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "processCreditCardSettlement": function(d, a) { return processCreditCardSettlement(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "getWalletTransactionHistory": function(d, a) { return getWalletTransactionHistory(a[0] || d.walletName, a[1] !== undefined ? a[1] : d.forceRefresh, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "adjustWalletBalance": function(d, a) { return adjustWalletBalance(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "checkpointWalletBalance": function(d, a) { return checkpointWalletBalance(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "rebuildWalletBalance": function(d, a) { return rebuildWalletBalance(a[0] || (d ? (d.walletId || d.id || d) : null), a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "rebuildWalletBalances": function(d, a) { return typeof rebuildWalletBalances === 'function' ? rebuildWalletBalances(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : (typeof rebuildAllWallets === 'function' ? rebuildAllWallets(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }); },
      "rebuildAllWallets": function(d, a) { return typeof rebuildWalletBalances === 'function' ? rebuildWalletBalances(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : rebuildAllWallets(); },
      "recordFinancialEvent": function(d, a) { return recordFinancialEvent(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "updateFamilyTransactionById": function(d, a) { return updateFamilyTransactionById(a[0] || d); },
      "t1_isValidCardPassword": function(d, a) { return t1_isValidCardPassword(a[0] || (d ? (d.password || d) : d), a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "setCardCustomPassword": function(d, a) { return setCardCustomPassword(a[0] || d); },
      "verifyCardPassword": function(d, a) { return verifyCardPassword(a[0] || (d ? d.password : d), a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "changeCardPassword": function(d, a) { return changeCardPassword(a[0] || d, a[1]); },
      "getInitialSetupCategories": function(d, a) { return typeof getInitialSetupCategories === 'function' ? getInitialSetupCategories(a[0] || (d ? (d.ssTarget || d.spreadsheetId || d.token || d.sessionToken) : null)) : { success: false }; },
      "saveInitialSetupCategory": function(d, a) { return typeof saveInitialSetupCategory === 'function' ? saveInitialSetupCategory(a[0] || (d ? d.type : null), a[1] || (d ? d.action : null), a[2] || (d ? d.value : null), a[3] || (d ? d.oldValue : null), a[4] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "saveCardSecurityDetails": function(d, a) { return typeof saveCardSecurityDetails === 'function' ? saveCardSecurityDetails(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false, message: "Không tìm thấy hàm saveCardSecurityDetails" }; },
      "migrateEncryptExistingCards": function(d, a) { return typeof migrateEncryptExistingCards === 'function' ? migrateEncryptExistingCards(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },

      // Tab 2 (Family Expenses)
      "getTab2Data": function(d, a) { return getTab2Data(a[0] || d.month, a[1] || d.year, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "saveFamilyTransaction": function(d, a) { return saveFamilyTransaction(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "deleteFamilyTransaction": function(d, a) { return deleteTransaction(a[0] || d.id || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "deleteTransaction": function(d, a) { return deleteTransaction(a[0] || d.id || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "saveBatchQuickFixedAmounts": function(d, a) { return typeof saveBatchQuickFixedAmounts === 'function' ? saveBatchQuickFixedAmounts(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "getQuickFixedItems": function(d, a) { return typeof getQuickFixedItems === 'function' ? getQuickFixedItems(a[0] || d.month, a[1] || d.year, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false, items: [] }; },
      "processJarTransfer": function(d, a) { return typeof processJarTransfer === 'function' ? processJarTransfer(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },

      // Tab 3 (Business & Inventory)
      "getBusinessData": function(d, a) { return getBusinessData(a[0] || d.month, a[1] || d.year, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null), d.forceRefresh); },
      "savePurchaseOrder": function(d, a) { return savePurchaseOrder(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "saveSalesOrder": function(d, a) { return saveSalesOrder(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "cancelPurchaseOrder": function(d, a) { return typeof cancelPurchaseOrder === 'function' ? cancelPurchaseOrder(a[0] || d, a[1], a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false, message: "Hàm cancelPurchaseOrder chưa sẵn sàng" }; },
      "cancelSalesOrder": function(d, a) { return typeof cancelSalesOrder === 'function' ? cancelSalesOrder(a[0] || d, a[1], a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false, message: "Hàm cancelSalesOrder chưa sẵn sàng" }; },
      "deletePurchaseOrder": function(d, a) { return typeof deletePurchaseOrder === 'function' ? deletePurchaseOrder(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false, message: "Hàm deletePurchaseOrder chưa sẵn sàng" }; },
      "deleteSalesOrder": function(d, a) { return typeof deleteSalesOrder === 'function' ? deleteSalesOrder(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false, message: "Hàm deleteSalesOrder chưa sẵn sàng" }; },
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
      "revertPreOrderPayment": function(d, a) { return revertPreOrderPayment(a[0] || d.targetIds || d.rowId || d.itemId); },
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
      "confirmBatchDebtSalesPayment": function(d, a) { return confirmBatchDebtSalesPayment(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },

      // Tab 4 (Debts)
      "getTab4Data": function(d, a) { return getTab4Data(a[0] || d.month, a[1] || d.year, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "saveDebtTransaction": function(d, a) { return saveDebtTransaction(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "settleDebtPayment": function(d, a) { return settleDebtPayment(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "settleSelectedNetDebtPayment": function(d, a) { return settleSelectedNetDebtPayment(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "deleteDebtRecord": function(d, a) { return deleteDebtRecord(a[0] || d.id || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },

      // Tab 5 (Cooldowns & Stores)
      "getTab5Data": function(d, a) { return getTab5Data(a && a.length > 0 ? a[0] : (d ? d.forceRefresh : false), a && a.length > 1 ? a[1] : (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "savePurchaseLimitRecord": function(d, a) { return savePurchaseLimitRecord(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "updatePurchaseLimitStatus": function(d, a) { return updatePurchaseLimitStatus(a[0] || d.rowId, a[1] || d.newStatus, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "deletePurchaseLimitRecord": function(d, a) { return deletePurchaseLimitRecord(a[0] || d.rowId, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "addTab5Account": function(d, a) { return addTab5Account(a[0] || d.accountName || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "saveStoreCooldownSettings": function(d, a) { return saveStoreCooldownSettings(a[0] || d.storeName, a[1] || d.days, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },
      "getStoreCooldownSettings": function(d, a) { return getStoreCooldownSettings(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)); },

      // Tab 7 (Split Bills & Trips)
      "getSplitGroups": function(d, a) { return typeof getSplitGroups === 'function' ? getSplitGroups(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : []; },
      "getSplitMembers": function(d, a) { return typeof getSplitMembers === 'function' ? getSplitMembers(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : []; },
      "getSplitFamilies": function(d, a) { return typeof getSplitFamilies === 'function' ? getSplitFamilies(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : []; },
      "getPresetFamilies": function(d, a) { return typeof getPresetFamilies === 'function' ? getPresetFamilies(a[0] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : []; },
      "saveSplitGroup": function(d, a) { return typeof saveSplitGroup === 'function' ? saveSplitGroup(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "deleteSplitGroup": function(d, a) { return typeof deleteSplitGroup === 'function' ? deleteSplitGroup(a[0] || d.groupId || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "saveSplitExpense": function(d, a) { return typeof saveSplitExpense === 'function' ? saveSplitExpense(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "deleteSplitExpense": function(d, a) { return typeof deleteSplitExpense === 'function' ? deleteSplitExpense(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "finalizeTripAndExportDebts": function(d, a) { return typeof finalizeTripAndExportDebts === 'function' ? finalizeTripAndExportDebts(a[0] || d.groupId || d, a[1] || d.exportOptions, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "getTab7FullGroupData": function(d, a) { return typeof getTab7FullGroupData === 'function' ? getTab7FullGroupData(a[0] || d.groupId || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "saveSplitFamilyMember": function(d, a) { return typeof saveSplitFamilyMember === 'function' ? saveSplitFamilyMember(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "saveSplitFamilyBatch": function(d, a) { return typeof saveSplitFamilyBatch === 'function' ? saveSplitFamilyBatch(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "deleteSplitFamilyMember": function(d, a) { return typeof deleteSplitFamilyMember === 'function' ? deleteSplitFamilyMember(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "deleteSplitFamilyEntirely": function(d, a) { return typeof deleteSplitFamilyEntirely === 'function' ? deleteSplitFamilyEntirely(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "reopenSplitGroup": function(d, a) { return typeof reopenSplitGroup === 'function' ? reopenSplitGroup(a[0] || d, a[1] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },
      "t7_settleDebtPayment": function(d, a) { return typeof t7_settleDebtPayment === 'function' ? t7_settleDebtPayment(a[0] || d.debtId, a[1] || d.walletName, a[2] || (d ? (d.ssTarget || d.spreadsheetId) : null)) : { success: false }; },

      // Tab 8 (Supplies & Checklist)
      "getSuppliesData": function(d, a) { return typeof getSuppliesData === 'function' ? getSuppliesData(a[0] !== undefined ? a[0] : d.forceRefresh, a[1] || d.ssTarget || d.spreadsheetId || null) : []; },
      "updateSupplyQuantity": function(d, a) { return typeof updateSupplyQuantity === 'function' ? updateSupplyQuantity(a[0] || d.rowIndex, a[1] || d.delta, a[2] || d.ssTarget || d.spreadsheetId || null) : { success: false }; },
      "addSupplyItem": function(d, a) { return typeof addSupplyItem === 'function' ? addSupplyItem(a[0] || d.name, a[1] || d.group, a[2] || d.current, a[3] || d.min, a[4] || d.ssTarget || d.spreadsheetId || null) : { success: false }; },
      "getExistingCategories": function(d, a) { return typeof getExistingCategories === 'function' ? getExistingCategories(a[0] || d.ssTarget || d.spreadsheetId || null) : []; },
      "deleteSupplyItem": function(d, a) { return typeof deleteSupplyItem === 'function' ? deleteSupplyItem(a[0] || d.rowIndex, a[1] || d.ssTarget || d.spreadsheetId || null) : { success: false }; },
      "updateSupplyItemDetails": function(d, a) { return typeof updateSupplyItemDetails === 'function' ? updateSupplyItemDetails(a[0] || d.rowIndex, a[1] || d.name, a[2] || d.group, a[3] || d.current, a[4] || d.min, a[5] || d.ssTarget || d.spreadsheetId || null) : { success: false }; },
      "reorderSuppliesSheet": function(d, a) { return typeof reorderSuppliesSheet === 'function' ? reorderSuppliesSheet(a[0] || d.newOrderedList, a[1] || d.ssTarget || d.spreadsheetId || null) : { success: false }; }
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
 * 1. THỰC THI CHUẨN VỚI SCRIPT LOCK AN TOÀN & KIỂM TRA REQUEST ID BÊN TRONG KHÓA
 * Hỗ trợ 2 cú pháp:
 *   - executeWithLock(token, requestId, fn): Kiểm tra RequestLog bên trong khóa, chạy fn, ghi nhận RequestLog SAU KHI ghi xong.
 *   - executeWithLock(lockTimeoutMs, actionCallback): Tương thích ngược cho các luồng nội bộ.
 */
function executeWithLock(arg1, arg2, arg3) {
  // Cú pháp 1: executeWithLock(token, requestId, fn)
  if (typeof arg3 === 'function') {
    const token = arg1;
    const requestId = arg2;
    const fn = arg3;

    const lock = (typeof LockService !== 'undefined' && LockService.getScriptLock) ? LockService.getScriptLock() : null;
    let locked = false;

    if (lock) {
      try {
        if (typeof lock.tryLock === 'function') {
          if (!lock.tryLock(15000)) {
            return {
              success: false,
              retryable: true,
              code: "SYSTEM_BUSY",
              message: "Hệ thống đang bận, vui lòng thử lại"
            };
          }
          locked = true;
        } else {
          lock.waitLock(15000);
          locked = true;
        }
      } catch(lockErr) {
        return {
          success: false,
          retryable: true,
          code: "SYSTEM_BUSY",
          message: "Hệ thống đang bận, vui lòng thử lại"
        };
      }
    }

    try {
      const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(token) : (token && typeof token === 'object' ? token : null);
      if (!ss) {
        return {
          success: false,
          connectionError: true,
          code: "CONNECTION_ERROR",
          message: "❌ Lỗi kết nối dữ liệu: Không thể kết nối cơ sở dữ liệu bảng tính cá nhân. Vui lòng kiểm tra quyền chia sẻ file hoặc đăng nhập lại."
        };
      }
      if (requestId && ss) {
        const done = findRequest(ss, requestId); // tra sheet RequestLog bên trong khóa
        if (done) return done.result;            // đã xử lý rồi, trả kết quả cũ
      }
      const result = fn(ss);
      if (requestId && ss) {
        saveRequest(ss, requestId, result);      // ghi nhận SAU khi ghi xong bên trong khóa
      }
      return result;
    } catch(err) {
      if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi executeWithLock: " + err);
      const errMsg = (err && err.message ? err.message : err.toString());
      const isConn = errMsg.includes("Không thể mở") || errMsg.includes("quyền truy cập") || errMsg.includes("Phiên hết hạn") || errMsg.includes("Spreadsheet");
      return {
        success: false,
        retryable: false,
        connectionError: isConn,
        code: isConn ? "CONNECTION_ERROR" : "INTERNAL_ERROR",
        message: isConn ? ("❌ Lỗi kết nối dữ liệu: " + errMsg) : ("❌ Lỗi: " + errMsg)
      };
    } finally {
      if (locked && lock) {
        try { lock.releaseLock(); } catch(e) {}
      }
    }
  }

  // Cú pháp 2: executeWithLock(lockTimeoutMs, actionCallback)
  const lockTimeoutMs = typeof arg1 === 'number' ? arg1 : 15000;
  const actionCallback = typeof arg2 === 'function' ? arg2 : (typeof arg1 === 'function' ? arg1 : null);
  if (!actionCallback) return { success: false, message: "Thiếu action callback" };

  const lock = (typeof LockService !== 'undefined' && LockService.getScriptLock) ? LockService.getScriptLock() : null;
  let locked = false;

  if (lock) {
    try {
      if (typeof lock.tryLock === 'function') {
        if (!lock.tryLock(lockTimeoutMs)) {
          return {
            success: false,
            retryable: true,
            code: "SYSTEM_BUSY",
            message: "⏳ Máy chủ đang bận xử lý giao dịch khác, ứng dụng đang tự động thử lại..."
          };
        }
        locked = true;
      } else {
        lock.waitLock(lockTimeoutMs);
        locked = true;
      }
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
    const errMsg = (err && err.message ? err.message : err.toString());
    const isConn = errMsg.includes("Không thể mở") || errMsg.includes("quyền truy cập") || errMsg.includes("Phiên hết hạn") || errMsg.includes("Spreadsheet");
    return {
      success: false,
      retryable: false,
      connectionError: isConn,
      code: isConn ? "CONNECTION_ERROR" : "INTERNAL_ERROR",
      message: isConn ? ("❌ Lỗi kết nối dữ liệu: " + errMsg) : ("❌ Lỗi: " + errMsg)
    };
  } finally {
    if (locked && lock) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}

/**
 * 2. QUẢN LÝ PHIÊN BẢN DỮ LIỆU NGUYÊN TỬ & PHÁT HIỆN THAY ĐỔI TRỰC TIẾP TRÊN SHEET WALLETLEDGER
 */
var _MEM_DATA_VERSION = 1;
var _MEM_WALLET_LEDGER_SIG = "";

function computeWalletLedgerSignature(ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss || typeof ss.getSheetByName !== 'function') return "";
    const lSheet = ss.getSheetByName("WalletLedger");
    if (!lSheet) return "EMPTY_0";
    const lastRow = lSheet.getLastRow();
    if (lastRow < 2) return "EMPTY_1";
    const lastCol = Math.min(Math.max(lSheet.getLastColumn(), 16), 16);
    const data = lSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      const rowStr = `${r[0]}|${r[1]}|${r[2]}|${r[3]}|${r[4]}|${r[5]}|${r[6]}|${r[7]}|${r[8]}|${r[9]}|${r[11]}|${r[12]}|${r[15]}`;
      for (let c = 0; c < rowStr.length; c++) {
        hash ^= rowStr.charCodeAt(c);
        hash = Math.imul(hash, 16777619);
      }
    }
    return `R${lastRow}_H${(hash >>> 0).toString(16)}`;
  } catch (e) {
    return "";
  }
}

function getStoredWalletLedgerSignature() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const v = PropertiesService.getScriptProperties().getProperty("WALLET_LEDGER_SIG");
      if (v) return v;
    }
  } catch (e) {}
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const c = CacheService.getScriptCache().get("WALLET_LEDGER_SIG");
      if (c) return c;
    }
  } catch (e) {}
  return _MEM_WALLET_LEDGER_SIG || "";
}

function setStoredWalletLedgerSignature(sig) {
  _MEM_WALLET_LEDGER_SIG = String(sig || "");
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      PropertiesService.getScriptProperties().setProperty("WALLET_LEDGER_SIG", _MEM_WALLET_LEDGER_SIG);
    }
  } catch (e) {}
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      CacheService.getScriptCache().put("WALLET_LEDGER_SIG", _MEM_WALLET_LEDGER_SIG, 21600);
    }
  } catch (e) {}
}

function checkAndSyncWalletLedgerChanges(ssTarget, updateOnly) {
  try {
    const currentSig = computeWalletLedgerSignature(ssTarget);
    if (!currentSig) return { changed: false, signature: "" };

    const prevSig = getStoredWalletLedgerSignature();
    if (!prevSig) {
      setStoredWalletLedgerSignature(currentSig);
      return { changed: false, signature: currentSig };
    }

    if (prevSig !== currentSig) {
      setStoredWalletLedgerSignature(currentSig);
      if (!updateOnly) {
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        if (typeof clearAllWalletStatementCaches === 'function') {
          try { clearAllWalletStatementCaches(); } catch (e) {}
        }
        incrementDataVersion();
      }
      return { changed: true, signature: currentSig };
    }

    return { changed: false, signature: currentSig };
  } catch (e) {
    return { changed: false, signature: "" };
  }
}

function getAppVersion(checkSheetChanges, ssTarget) {
  let ledgerChanged = false;
  let sig = "";
  if (checkSheetChanges) {
    const syncRes = checkAndSyncWalletLedgerChanges(ssTarget, false);
    ledgerChanged = Boolean(syncRes && syncRes.changed);
    sig = syncRes ? (syncRes.signature || "") : "";
  }

  let ver = _MEM_DATA_VERSION || 1;
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const val = PropertiesService.getScriptProperties().getProperty("DATA_VERSION");
      if (val) {
        ver = parseInt(val, 10) || 1;
        _MEM_DATA_VERSION = ver;
      }
    }
  } catch(e) {}

  if (checkSheetChanges) {
    return {
      success: true,
      version: ver,
      ledgerChanged: ledgerChanged,
      signature: sig
    };
  }
  return ver;
}

function incrementDataVersion() {
  _MEM_DATA_VERSION = (_MEM_DATA_VERSION || 1) + 1;
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      const current = parseInt(props.getProperty("DATA_VERSION") || String(_MEM_DATA_VERSION - 1), 10);
      const next = Math.max(current + 1, _MEM_DATA_VERSION);
      _MEM_DATA_VERSION = next;
      props.setProperty("DATA_VERSION", String(next));
      return next;
    }
  } catch(e) {}
  return _MEM_DATA_VERSION;
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
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
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
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
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
 * Tra cứu RequestId từ sheet RequestLog (hoặc ProcessedRequests) của file người dùng
 */
function findRequest(ssTarget, requestId) {
  if (!requestId) return null;
  const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
  if (!ss || typeof ss.getSheetByName !== 'function') return null;

  const targetReqId = String(requestId).trim().toLowerCase();
  const sheet = ss.getSheetByName("RequestLog") || ss.getSheetByName(SHEET_PROCESSED_REQUESTS);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const lastRow = sheet.getLastRow();
  const startRow = Math.max(2, lastRow - 500);
  const numRows = lastRow - startRow + 1;
  const lastCol = Math.min(Math.max(sheet.getLastColumn(), 3), 5);
  const data = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  for (let i = data.length - 1; i >= 0; i--) {
    const rReqId = String(data[i][0] || "").trim().toLowerCase();
    if (rReqId === targetReqId) {
      const resColIdx = (data[i].length >= 5 && data[i][4]) ? 4 : (data[i].length >= 3 ? 2 : 1);
      const resJsonStr = String(data[i][resColIdx] || "");
      let resData = null;
      try {
        if (resJsonStr) resData = JSON.parse(resJsonStr);
      } catch(e) {
        resData = resJsonStr;
      }
      return {
        requestId: data[i][0],
        result: resData
      };
    }
  }
  return null;
}

/**
 * Ghi nhận RequestId vào sheet RequestLog trong file của người dùng SAU KHI ghi xong
 * Tự động xóa các dòng cũ hơn 7 ngày
 */
function saveRequest(ssTarget, requestId, result) {
  if (!requestId) return;
  const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
  if (!ss || typeof ss.getSheetByName !== 'function') return;

  const reqStr = String(requestId).trim();
  const resStr = result !== undefined ? (typeof result === 'object' ? JSON.stringify(result) : String(result)) : "";
  const nowIso = new Date().toISOString();

  let sheet = ss.getSheetByName("RequestLog") || ss.getSheetByName(SHEET_PROCESSED_REQUESTS);
  if (!sheet && typeof ss.insertSheet === 'function') {
    sheet = ss.insertSheet("RequestLog");
    sheet.getRange(1, 1, 1, 3).setValues([["RequestId", "CreatedAt", "ResultJson"]]);
    sheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#f1f5f9");
  }

  if (sheet) {
    const lastCol = sheet.getLastColumn();
    if (lastCol >= 5) {
      sheet.appendRow([reqStr, "DONE", nowIso, nowIso, resStr]);
    } else {
      sheet.appendRow([reqStr, nowIso, resStr]);
    }
    pruneRequestLogOlderThan7Days(sheet);
  }
}

/**
 * Xóa các dòng nhật ký yêu cầu cũ hơn 7 ngày
 */
function pruneRequestLogOlderThan7Days(sheet) {
  if (!sheet || sheet.getLastRow() <= 2) return 0;
  try {
    const lastRow = sheet.getLastRow();
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 ngày
    const dateColIdx = (sheet.getLastColumn() >= 5) ? 3 : 2;
    const dates = sheet.getRange(2, dateColIdx, lastRow - 1, 1).getValues();

    let deleteCount = 0;
    for (let i = 0; i < dates.length; i++) {
      const val = dates[i][0];
      if (val) {
        const time = new Date(val).getTime();
        if (time && time < cutoffTime) {
          deleteCount++;
        } else {
          break; // Đã sắp xếp theo thời gian tăng dần
        }
      }
    }

    if (deleteCount > 0) {
      sheet.deleteRows(2, deleteCount);
      return deleteCount;
    }
  } catch(e) {}
  return 0;
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
      cache.put(cacheKey, jsonStr, ttl);
      cache.put(cacheKey + "_cnt", "1", ttl);
      cache.put(cacheKey + "_c0", jsonStr, ttl);
      return true;
    }

    const chunksCount = Math.ceil(jsonStr.length / chunkSize);
    cache.put(cacheKey + "_cnt", String(chunksCount), ttl);

    for (let i = 0; i < chunksCount; i++) {
      const chunkStr = jsonStr.substring(i * chunkSize, (i + 1) * chunkSize);
      cache.put(cacheKey + "_c" + i, chunkStr, ttl);
    }
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
function clearAppDataCache(month, year, ssTarget) {
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      const tenantSuffix = (ssTarget && typeof ssTarget === 'string') ? ("_" + ssTarget.slice(-8)) : "";
      const baseKeys = [];
      const appVersions = ["V32_", "V30_", ""];
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
            if (tenantSuffix) baseKeys.push("APP_DATA_" + v + m + "_" + y + tenantSuffix);
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
      baseKeys.push("APP_DATA_GLOBAL_LATEST", "APP_DATA_GLOBAL_LATEST_V30", "APP_DATA_GLOBAL_LATEST_V32", "APP_DATA_GLOBAL_LATEST_V33", "APP_DATA_GLOBAL_LATEST_V34", "tab5_data_v1", "tab5_data_v7", "tab5_data_v8", "tab8_supplies_data_v1", "TAB3_SUMMARY", "TAB4_SUMMARY", "TAB1_ESSENTIAL_CACHE_V3", "TAB1_ESSENTIAL_CACHE_V2");

      // Xóa triệt để toàn bộ cache Statement Sổ phụ (WALLET_STMT_*)
      if (typeof clearAllWalletStatementCaches === 'function') {
        try { clearAllWalletStatementCaches(); } catch(e) {}
      }

      const allKeys = [];
      baseKeys.forEach(k => {
        allKeys.push(k);
        allKeys.push(k + "_cnt");
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
  const tenantSuffix = (ssTarget && typeof ssTarget === 'string') ? ("_" + ssTarget.slice(-8)) : "";
  const cacheKey = "APP_DATA_V32_" + m + "_" + y + tenantSuffix;

  if (forceRefresh) {
    clearAppDataCache(m, y);
  }

  try {
    if (!forceRefresh && typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cachedStr = getCachedAppDataStr(cacheKey);
      if (cachedStr) {
        return JSON.parse(cachedStr);
      }
    }
  } catch(e) {}

  try {
    return withSheetRetry(function() {
      const ss = (typeof resolveSpreadsheet === 'function') 
        ? resolveSpreadsheet(ssTarget) 
        : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
      if (!ss || typeof ss.getSheetByName !== 'function') {
        return { 
          success: false, 
          connectionError: true, 
          message: "❌ Lỗi kết nối dữ liệu: Không thể mở bảng tính cá nhân (" + (typeof ssTarget === 'string' ? ssTarget : "ID không hợp lệ") + "). Vui lòng đảm bảo bảng tính đã được chia sẻ quyền Chỉnh sửa (Editor) với hệ thống.",
          wallets: [],
          categories: [],
          accounts: [],
          virtualCards: [],
          pendingPreOrders: [],
          tab2: { summary: { net: 0, income: 0, expense: 0 }, transactions: [], jars: [] },
          tab3: { summary: { sales: 0, cogs: 0, stockValue: 0 }, products: [], allProducts: [], preOrders: [], inventory: [], debtSales: [], sources: [], purchasePlaces: [], accounts: [] },
          tab4: { summary: { totalReceivable: 0, totalPayable: 0, netDebt: 0 }, debts: [], allDebts: [], partners: [] }
        };
      }

      // 1. Wallets & Pending Pre-orders (Always "All" for global cumulative balance & pending counts)
      let wallets = [];
      let virtualCards = [];
      let pendingPreOrders = [];
      let orderCounts = null;
      try {
        if (typeof getWalletsFromSheet === 'function') {
          const wRes = getWalletsFromSheet("All", "All", ss, false);
          if (wRes) {
            if (wRes.wallets) wallets = wRes.wallets;
            if (wRes.virtualCards) virtualCards = wRes.virtualCards;
            if (wRes.pendingPreOrders) pendingPreOrders = wRes.pendingPreOrders;
            if (wRes.orderCounts) orderCounts = wRes.orderCounts;
          }
        }
      } catch (eW) {
        if (typeof Logger !== 'undefined') Logger.log("Error loading wallets in getAppData: " + eW);
      }

      // 2. Categories / Initial Data
      let categories = [];
      let accounts = [];
      try {
        if (typeof getInitialData === 'function') {
          const catRes = getInitialData(ss);
          if (catRes && catRes.categories) categories = catRes.categories;
          if (catRes && catRes.accounts) accounts = catRes.accounts;
        }
      } catch (eC) {
        if (typeof Logger !== 'undefined') Logger.log("Error loading categories in getAppData: " + eC);
      }

      // 3. Tab 2 Data (ONLY module filtered strictly by current month/year when "All" is selected)
      let tab2 = { summary: { net: 0, income: 0, expense: 0 }, transactions: [], jars: [] };
      try {
        if (typeof getTab2Data === 'function') {
          const curM = (new Date().getMonth() + 1).toString();
          const curY = new Date().getFullYear().toString();
          const t2M = isAllMonth ? curM : m;
          const t2Y = isAllYear ? curY : y;
          let t2Res = getTab2Data(t2M, t2Y, ss);
          if (isAllMonth && (!t2Res || !t2Res.transactions || t2Res.transactions.length === 0)) {
            const t2AllRes = getTab2Data("ALL", t2Y, ss);
            if (t2AllRes && t2AllRes.transactions && t2AllRes.transactions.length > 0) {
              t2Res = t2AllRes;
            }
          }
          if (t2Res) tab2 = t2Res;
        }
      } catch (eT2) {
        if (typeof Logger !== 'undefined') Logger.log("Error loading tab2 in getAppData: " + eT2);
      }

      // 4. Quick Fixed Items (Always "All")
      let quickFixed = [];
      try {
        if (typeof getQuickFixedItems === 'function') {
          const qRes = getQuickFixedItems("All", "All", ss);
          if (qRes && qRes.items) quickFixed = qRes.items;
        }
      } catch (eQ) {
        if (typeof Logger !== 'undefined') Logger.log("Error loading quickFixed in getAppData: " + eQ);
      }

      // 5. Tab 3 Business Data (Filtered by month/year for sales & cogs summary; all-time for stock)
      let tab3 = null;
      try {
        if (typeof getBusinessData === 'function') {
          const t3Res = getBusinessData(m, y, ss, forceRefresh);
          if (t3Res && t3Res.success) tab3 = t3Res;
        }
      } catch (eT3) {
        if (typeof Logger !== 'undefined') Logger.log("Error loading tab3 in getAppData: " + eT3);
      }

      // 6. Tab 5 Cooldown Data (Always ALL)
      let tab5 = null;
      try {
        if (typeof getTab5Data === 'function') {
          const t5Res = getTab5Data(ss);
          if (t5Res && t5Res.success) tab5 = t5Res;
        }
      } catch (eT5) {
        if (typeof Logger !== 'undefined') Logger.log("Error loading tab5 in getAppData: " + eT5);
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
      try {
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
      } catch (eOrder) {
        if (typeof Logger !== 'undefined') Logger.log("Error calculating orderCounts in getAppData: " + eOrder);
      }

      let statsTrend3M = null;
      try {
        if (typeof getFinancialTrendStats === 'function') {
          statsTrend3M = getFinancialTrendStats(3, null, null, ss);
        }
      } catch (eTr) {}

      // G. Kiểm tra nhắc nhở tất toán thẻ tín dụng (GAS)
      // Tự động dời ngày tất toán sang ngày làm việc tiếp theo nếu rơi vào Thứ 7, CN hoặc Ngày Lễ Nhật Bản
      let settlementReminders = [];
      try {
        function getRawNationalHolidayName(year, month, day) {
          if (month === 1 && day === 1) return '元日';
          if (month === 2 && day === 11) return '建国記念の日';
          if (month === 2 && day === 23) return '天皇誕生日';
          if (month === 4 && day === 29) return '昭和の日';
          if (month === 5 && day === 3) return '憲法記念日';
          if (month === 5 && day === 4) return 'みどりの日';
          if (month === 5 && day === 5) return 'こどもの日';
          if (month === 8 && day === 11) return '山の日';
          if (month === 11 && day === 3) return '文化の日';
          if (month === 11 && day === 23) return '勤労感謝の日';

          var dt = new Date(year, month - 1, day);
          var dow = dt.getDay();
          var weekNum = Math.floor((day - 1) / 7) + 1;
          if (dow === 1) {
            if (month === 1 && weekNum === 2) return '成人の日';
            if (month === 7 && weekNum === 3) return '海の日';
            if (month === 9 && weekNum === 3) return '敬老の日';
            if (month === 10 && weekNum === 2) return 'スポーツの日';
          }

          var vernalEquinoxDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
          var autumnEquinoxDay = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
          if (month === 3 && day === vernalEquinoxDay) return '春分の日';
          if (month === 9 && day === autumnEquinoxDay) return '秋分の日';
          return null;
        }

        function isJapaneseBankHoliday(year, month, day) {
          if ((month === 12 && day === 31) || (month === 1 && (day === 2 || day === 3))) return true;
          if (getRawNationalHolidayName(year, month, day)) return true;

          var dt = new Date(year, month - 1, day);
          var dow = dt.getDay();
          if (dow >= 1 && dow <= 5) {
            var checkDate = new Date(year, month - 1, day - 1);
            while (getRawNationalHolidayName(checkDate.getFullYear(), checkDate.getMonth() + 1, checkDate.getDate())) {
              if (checkDate.getDay() === 0) return true;
              checkDate = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate() - 1);
            }
          }

          var prevDate = new Date(year, month - 1, day - 1);
          var nextDate = new Date(year, month - 1, day + 1);
          if (getRawNationalHolidayName(prevDate.getFullYear(), prevDate.getMonth() + 1, prevDate.getDate()) &&
              getRawNationalHolidayName(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate())) {
            return true;
          }
          return false;
        }

        function getNextJapaneseBusinessDay(year, month, day) {
          var dt = new Date(year, month - 1, day);
          while (true) {
            var y = dt.getFullYear();
            var m = dt.getMonth() + 1;
            var d = dt.getDate();
            var dow = dt.getDay();
            if (dow === 0 || dow === 6 || isJapaneseBankHoliday(y, m, d)) {
              dt.setDate(dt.getDate() + 1);
            } else {
              break;
            }
          }
          return dt;
        }

        const nowObj = new Date();
        const curDay = nowObj.getDate();
        const curMonth = nowObj.getMonth() + 1;
        const curYear = nowObj.getFullYear();
        const curMonthStr = curYear + "-" + (curMonth < 10 ? "0" + curMonth : curMonth);
        const todayDateOnly = new Date(curYear, curMonth - 1, curDay);
        const familyRows = (tab2 && tab2.transactions) ? tab2.transactions : [];

        const creditWallets = (wallets || []).filter(function(w) {
          return w.type === 'CREDIT' || String(w.name || '').toLowerCase().indexOf('c-') === 0;
        });

        creditWallets.forEach(function(w) {
          const debt = Number(w.debt || 0);
          const nominalDueDay = parseInt(w.due_date, 10) || null;
          const closingDay = parseInt(w.closing_date, 10) || null;
          const wNameLow = String(w.name || '').trim().toLowerCase();

          const settleTxs = familyRows.filter(function(f) {
            const c = String(f.noidung || f.content || '').toLowerCase();
            const n = String(f.ghichu || f.note || '').toLowerCase();
            return (c.indexOf('tất toán') !== -1 || c.indexOf('tat toan') !== -1 || n.indexOf('tất toán') !== -1 || n.indexOf('tat toan') !== -1) &&
                   (c.indexOf(wNameLow) !== -1 || n.indexOf(wNameLow) !== -1 || String(f.nguontien || f.wallet_name || '').toLowerCase() === wNameLow);
          });

          const lastSettle = settleTxs[0] || null;
          const lastSettleDate = lastSettle ? String(lastSettle.ngay || lastSettle.date || '').split('T')[0] : null;
          const hasSettleThisMonth = lastSettleDate ? (lastSettleDate.indexOf(curMonthStr) === 0) : false;

          // Tính ngày tất toán thực tế theo lịch làm việc ngân hàng Nhật
          let effectiveDueDay = nominalDueDay;
          let effectiveDueMonth = curMonth;
          let isShifted = false;
          let effectiveDateOnly = null;
          let diffDays = null;
          let dueDebt = debt;

          // 1. Kiểm tra chu kỳ nợ cụ thể từ sổ cái (cardCycleDebts)
          const thisCardCycles = (cardCycleDebts || []).filter(function(cd) {
            const cName = String(cd.wallet_name || '').toLowerCase();
            return (cName === wNameLow || cName.indexOf(wNameLow) !== -1 || wNameLow.indexOf(cName) !== -1) && Number(cd.cycle_amount) > 0;
          });

          let specificCycleFound = false;
          if (thisCardCycles.length > 0) {
            thisCardCycles.sort(function(a, b) { return String(a.statement_date).localeCompare(String(b.statement_date)); });
            const earliest = thisCardCycles[0];
            const p = String(earliest.statement_date).split(/[-/]/);
            if (p.length >= 2) {
              const cYear = parseInt(p[0], 10);
              const cMonth = parseInt(p[1], 10);
              dueDebt = Number(earliest.cycle_amount);
              specificCycleFound = true;
              if (nominalDueDay) {
                const cycleDueDt = getNextJapaneseBusinessDay(cYear, cMonth, nominalDueDay);
                effectiveDateOnly = new Date(cycleDueDt.getFullYear(), cycleDueDt.getMonth(), cycleDueDt.getDate());
                effectiveDueDay = cycleDueDt.getDate();
                effectiveDueMonth = cycleDueDt.getMonth() + 1;
                isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== cMonth);
                diffDays = Math.round((effectiveDateOnly - todayDateOnly) / (1000 * 60 * 60 * 24));
              }
            }
          }

          if (!specificCycleFound && nominalDueDay) {
            // Ngày đến hạn của tháng trước (tính dời T7/CN/Lễ Nhật)
            const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
            const prevYear = curMonth === 1 ? curYear - 1 : curYear;
            const prevDueDt = getNextJapaneseBusinessDay(prevYear, prevMonth, nominalDueDay);
            const prevDueDateOnly = new Date(prevYear, prevDueDt.getMonth(), prevDueDt.getDate());

            // Ngày đến hạn của tháng này (tính dời T7/CN/Lễ Nhật)
            const curDueDt = getNextJapaneseBusinessDay(curYear, curMonth, nominalDueDay);
            const curDueDateOnly = new Date(curYear, curDueDt.getMonth(), curDueDt.getDate());

            // Kiểm tra xem kỳ trước đã tất toán chưa
            let prevCycleSettled = false;
            if (lastSettleDate) {
              const lastD = new Date(lastSettleDate);
              if (lastSettleDate.indexOf(curMonthStr) === 0) {
                prevCycleSettled = true;
              } else {
                const minSettleDateForPrev = new Date(prevYear, prevMonth - 1, Math.max(1, nominalDueDay - 15));
                if (lastD >= minSettleDateForPrev) {
                  prevCycleSettled = true;
                }
              }
            }

            // Xác định ngày hạn áp dụng cho dư nợ hiện tại:
            // 1) Nếu hôm nay đã qua hạn tháng này và chưa tất toán tháng này
            if (curDueDateOnly < todayDateOnly && !hasSettleThisMonth) {
              effectiveDateOnly = curDueDateOnly;
              effectiveDueDay = curDueDt.getDate();
              effectiveDueMonth = curDueDt.getMonth() + 1;
              isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== curMonth);
            }
            // 2) Nếu kỳ trước chưa tất toán và hôm nay đã quá hạn kỳ trước (Hạn là ngày của tháng trước!)
            else if (!prevCycleSettled && prevDueDateOnly < todayDateOnly) {
              effectiveDateOnly = prevDueDateOnly;
              effectiveDueDay = prevDueDt.getDate();
              effectiveDueMonth = prevDueDt.getMonth() + 1;
              isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== prevMonth);
            }
            // 3) Kỳ trước đã tất toán, hướng tới hạn của tháng này
            else {
              effectiveDateOnly = curDueDateOnly;
              effectiveDueDay = curDueDt.getDate();
              effectiveDueMonth = curDueDt.getMonth() + 1;
              isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== curMonth);
            }

            diffDays = Math.round((effectiveDateOnly - todayDateOnly) / (1000 * 60 * 60 * 24));
          }

          let status = 'NO_DEBT';
          let urgency = 'NONE';
          let badge = '✅ Đã tất toán';
          let badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
          let message = 'Không có dư nợ cần tất toán';
          let isUrgent = false;

          if (debt > 0) {
            if (hasSettleThisMonth) {
              status = 'SETTLED_THIS_MONTH';
              badge = '✅ Đã tất toán kỳ này';
              badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
              message = 'Đã có bút toán tất toán ngày ' + lastSettleDate + ' (Dư nợ phát sinh mới: ' + debt.toLocaleString() + ' ¥)';
            } else if (!nominalDueDay) {
              status = 'NO_DUE_DATE';
              urgency = 'MEDIUM';
              badge = '⚠️ Chưa cài ngày TT';
              badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';
              message = 'Dư nợ: ' + debt.toLocaleString() + ' ¥ (Chưa cài ngày tất toán)';
            } else if (diffDays < 0) {
              const overdueDays = Math.abs(diffDays);
              status = 'OVERDUE';
              urgency = 'CRITICAL';
              isUrgent = true;
              badge = '🚨 Quá hạn ' + overdueDays + ' ngày (Hạn: ' + effectiveDueDay + '/' + effectiveDueMonth + ')';
              badgeClass = 'bg-rose-100 text-rose-800 border border-rose-300 font-black animate-pulse';
              message = 'Đã quá hạn tất toán ' + overdueDays + ' ngày (Hạn: ngày ' + effectiveDueDay + '/' + effectiveDueMonth + (isShifted ? ' dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ' : '') + ')';
            } else if (diffDays === 0) {
              status = 'DUE_TODAY';
              urgency = 'HIGH';
              isUrgent = true;
              badge = '⚠️ Đến hạn hôm nay (' + effectiveDueDay + '/' + effectiveDueMonth + ')';
              badgeClass = 'bg-rose-500 text-white font-black animate-pulse';
              message = 'Hôm nay đến hạn tất toán (Hạn: ngày ' + effectiveDueDay + '/' + effectiveDueMonth + (isShifted ? ' dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ' : '') + ')';
            } else if (diffDays <= 5) {
              status = 'DUE_SOON';
              urgency = 'MEDIUM';
              isUrgent = true;
              badge = '⏳ Sắp đến hạn (' + diffDays + ' ngày)';
              badgeClass = 'bg-amber-100 text-amber-900 border border-amber-300 font-bold';
              message = 'Sắp đến hạn tất toán còn ' + diffDays + ' ngày (Hạn: ngày ' + effectiveDueDay + '/' + effectiveDueMonth + (isShifted ? ' dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ' : '') + ')';
            } else {
              status = 'UPCOMING';
              urgency = 'LOW';
              badge = '📅 Hạn: ngày ' + effectiveDueDay + '/' + effectiveDueMonth;
              badgeClass = 'bg-blue-50 text-blue-700 border border-blue-200';
              message = 'Đến hạn ngày ' + effectiveDueDay + '/' + effectiveDueMonth + (isShifted ? ' (dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ)' : '') + ' (còn ' + diffDays + ' ngày)';
            }
          }

          settlementReminders.push({
            id: w.id,
            name: w.name,
            debt: debt,
            dueDebt: Number(w.dueDebt || debt),
            due_date: w.due_date,
            nominalDueDay: nominalDueDay,
            dueDay: effectiveDueDay,
            effectiveDueMonth: effectiveDueMonth,
            isShifted: isShifted,
            closingDay: closingDay,
            diffDays: diffDays,
            lastSettleDate: lastSettleDate,
            hasSettleThisMonth: hasSettleThisMonth,
            status: status,
            urgency: urgency,
            isUrgent: isUrgent,
            badge: badge,
            badgeClass: badgeClass,
            message: message,
            settleSource: w.settle_source || null
          });
        });
      } catch (eRem) {}

      const result = {
        success: true,
        dataVersion: getAppVersion(),
        settlementReminders: settlementReminders,
        wallets: wallets,
        virtualCards: virtualCards,
        pendingPreOrders: pendingPreOrders,
        orderCounts: orderCounts,
        statsTrend: statsTrend3M,
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
        if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
          if (tab3 && tab3.summary) {
            try { CacheService.getScriptCache().put("TAB3_SUMMARY" + tenantSuffix, JSON.stringify(tab3.summary), 600); } catch(e){}
          }
          if (tab4 && tab4.summary) {
            try { CacheService.getScriptCache().put("TAB4_SUMMARY" + tenantSuffix, JSON.stringify(tab4.summary), 600); } catch(e){}
          }
          const jsonStr = JSON.stringify(result);
          setCachedAppDataStr(cacheKey, jsonStr, 21600);
          if (!ssTarget) setCachedAppDataStr("APP_DATA_GLOBAL_LATEST_V34", jsonStr, 21600);
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
 * TẢI NHANH ƯU TIÊN TAB 1 (NGÂN HÀNG & SỐ DƯ VÍ) - SIÊU TỐC (<1.2s)
 * Đọc bảng Wallets (với WalletLedger) + Categories/Accounts + Tóm tắt công nợ/kinh doanh
 */
function getTab1EssentialData(forceRefresh, ssTarget) {
  try {
    const tenantSuffix = (ssTarget && typeof ssTarget === 'string') ? ("_" + ssTarget.slice(-8)) : "";
    const cacheKey = "TAB1_ESSENTIAL_CACHE_V3" + tenantSuffix;
    if (!forceRefresh && typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
      try {
        const cached = CacheService.getScriptCache().get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch(e) {}
    }

    const ss = (typeof resolveSpreadsheet === 'function') 
      ? resolveSpreadsheet(ssTarget) 
      : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss || typeof ss.getSheetByName !== 'function') {
      return { 
        success: false, 
        connectionError: true, 
        message: "❌ Lỗi kết nối dữ liệu: Không thể mở bảng tính (" + (typeof ssTarget === 'string' ? ssTarget : "") + "). Vui lòng đảm bảo bảng tính cá nhân đã được chia sẻ với hệ thống.",
        wallets: [],
        categories: [],
        accounts: [],
        pendingPreOrders: []
      };
    }
    let wallets = [];
    let pendingPreOrders = [];
    let orderCounts = null;

    if (typeof getWalletsFromSheet === 'function') {
      const wRes = getWalletsFromSheet("All", "All", ss, false);
      if (wRes) {
        if (wRes.wallets) wallets = wRes.wallets;
        if (wRes.pendingPreOrders) pendingPreOrders = wRes.pendingPreOrders;
        if (wRes.orderCounts) orderCounts = wRes.orderCounts;
      }
    }

    let categories = [];
    let accounts = [];
    if (typeof getInitialData === 'function') {
      const catRes = getInitialData(ss);
      if (catRes && catRes.categories) categories = catRes.categories;
      if (catRes && catRes.accounts) accounts = catRes.accounts;
    }

    // Nạp nhanh tóm tắt Tab 3 & Tab 4 từ CacheService nếu có (chỉ cho Master hoặc theo tenant)
    let tab3Summary = null;
    let tab4Summary = null;
    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        if (!ssTarget) {
          const c3 = CacheService.getScriptCache().get("TAB3_SUMMARY");
          if (c3) tab3Summary = JSON.parse(c3);
          const c4 = CacheService.getScriptCache().get("TAB4_SUMMARY");
          if (c4) tab4Summary = JSON.parse(c4);
        } else if (tenantSuffix) {
          const c3 = CacheService.getScriptCache().get("TAB3_SUMMARY" + tenantSuffix);
          if (c3) tab3Summary = JSON.parse(c3);
          const c4 = CacheService.getScriptCache().get("TAB4_SUMMARY" + tenantSuffix);
          if (c4) tab4Summary = JSON.parse(c4);
        }
      }
    } catch(e) {}

    // Bỏ qua gọi getTab4Data nặng - đã có bộ quét nhanh siêu tốc trực tiếp ở dưới

    if (!tab4Summary) {
      try {
        const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
        if (dSheet && dSheet.getLastRow() >= 2) {
          const lastColD = Math.max(dSheet.getLastColumn(), 11);
          const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, lastColD).getValues();
          let sumThu = 0;
          let sumTra = 0;
          for (let i = 0; i < dData.length; i++) {
            const row = dData[i];
            const tongNo = typeof parseBizMoney === 'function' ? parseBizMoney(row[5]) : (Number(row[5]) || 0);
            const daTra = typeof parseBizMoney === 'function' ? parseBizMoney(row[7]) : (Number(row[7]) || 0);
            const sheetDuNo = typeof parseBizMoney === 'function' ? parseBizMoney(row[9]) : (Number(row[9]) || 0);
            let expectedDuNo = tongNo > 0 ? Math.max(0, tongNo - daTra) : 0;
            let duNo = (sheetDuNo > 0) ? sheetDuNo : expectedDuNo;

            const rawStatusStr = String(row[10] || "").trim().toUpperCase();
            const isExplicitDone = (rawStatusStr === "HOAN_TAT" || rawStatusStr === "DA_TRA" || rawStatusStr === "DONE" || 
              rawStatusStr.includes("HOÀN TẤT") || rawStatusStr.includes("ĐÃ TRẢ") || rawStatusStr.includes("ĐÃ THANH TOÁN") || rawStatusStr.includes("ĐÃ TT") ||
              rawStatusStr.includes("DA TRA") || rawStatusStr.includes("HOAN TAT") || rawStatusStr.includes("DA THANH TOAN"));

            let trangThaiDuNo = "DANG_NO";
            if (isExplicitDone || (tongNo > 0 && daTra >= tongNo) || (tongNo > 0 && sheetDuNo === 0 && daTra > 0)) {
              trangThaiDuNo = "HOAN_TAT";
              duNo = 0;
            } else if (duNo <= 0 && tongNo > 0) {
              duNo = expectedDuNo > 0 ? expectedDuNo : tongNo;
            }

            if (trangThaiDuNo === "DANG_NO" && duNo > 0) {
              let loai = String(row[3] || "").trim().toUpperCase();
              const pName = String(row[2] || "").trim();
              const noiDung = String(row[4] || "").trim();
              if (!loai) {
                const textCheck = (pName + " " + noiDung).toLowerCase();
                loai = (textCheck.includes("cho vay") || textCheck.includes("khách nợ") || textCheck.includes("thu nợ") || textCheck.includes("cần thu")) ? "THU" : "TRA";
              }
              const isReceivable = (
                loai === "THU" || loai === "CHO_VAY" ||
                loai.includes("THU") || loai.includes("KHÁCH") || loai.includes("CHO VAY") || loai.includes("CẦN THU") ||
                (pName + " " + noiDung).toUpperCase().includes("KHÁCH NỢ") ||
                (pName + " " + noiDung).toUpperCase().includes("CHO VAY")
              );
              if (isReceivable) sumThu += duNo;
              else sumTra += duNo;
            }
          }
          tab4Summary = { receivables: sumThu, payables: sumTra, net: sumThu - sumTra };
        }
      } catch(dErr) {}
    }

    const result = {
      success: true,
      isEssential: true,
      dataVersion: getAppVersion(),
      wallets: wallets,
      pendingPreOrders: pendingPreOrders,
      orderCounts: orderCounts,
      categories: categories,
      accounts: accounts,
      tab3Summary: tab3Summary,
      tab4Summary: tab4Summary
    };

    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
      try {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
        CacheService.getScriptCache().put("TAB1_ESSENTIAL_CACHE_LATEST", JSON.stringify(result), 21600);
      } catch(ce) {}
    }

    return result;
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

/**
 * LẤY DỮ LIỆU BIỂU ĐỒ XU HƯỚNG TÀI CHÍNH & KINH DOANH (3T, 6T, 12T)
 * - Mặc định chu kỳ 3 tháng gần nhất lấy tháng hiện tại làm mốc
 * - Biểu đồ 1: Thu Chi & Tiết Kiệm (Gia đình): Thu (cột), Chi (cột), Tiết kiệm (đường)
 * - Biểu đồ 2: Kinh Doanh: Doanh thu (cột), Giá vốn (cột), Lợi nhuận gộp (đường)
 */
function getFinancialTrendStats(monthsCount, anchorMonth, anchorYear, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') 
      ? resolveSpreadsheet(ssTarget) 
      : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss || typeof ss.getSheetByName !== 'function') {
      return { 
        success: false, 
        connectionError: true, 
        message: "❌ Lỗi kết nối dữ liệu: Không thể mở bảng tính (" + (typeof ssTarget === 'string' ? ssTarget : "") + "). Vui lòng đảm bảo bảng tính cá nhân đã được chia sẻ với hệ thống.",
        wallets: [],
        categories: [],
        accounts: [],
        pendingPreOrders: []
      };
    }
    const count = parseInt(monthsCount, 10) || 3;
    const validCount = (count === 6 || count === 12) ? count : 3;

    const now = new Date();
    const aMonth = (anchorMonth !== undefined && anchorMonth !== null && anchorMonth !== '') ? parseInt(anchorMonth, 10) : (now.getMonth() + 1);
    const aYear = (anchorYear !== undefined && anchorYear !== null && anchorYear !== '') ? parseInt(anchorYear, 10) : now.getFullYear();

    const parseTrendDate = function(val) {
      if (!val) return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
      const str = String(val).trim();
      if (!str || str === 'undefined' || str === 'null' || str === 'Invalid Date') return null;
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(str)) {
        const sep = str.includes('/') ? '/' : '-';
        const p = str.split(' ')[0].split(sep);
        let yr = parseInt(p[2], 10);
        if (yr < 100) yr += 2000;
        return new Date(yr, parseInt(p[1], 10) - 1, parseInt(p[0], 10));
      }
      if (/^\d{1,2}[\/\-]\d{1,2}$/.test(str)) {
        const sep = str.includes('/') ? '/' : '-';
        const p = str.split(sep);
        const yr = aYear || now.getFullYear();
        return new Date(yr, parseInt(p[1], 10) - 1, parseInt(p[0], 10));
      }
      if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(str)) {
        const sep = str.includes('-') ? '-' : '/';
        const p = str.split(' ')[0].split(sep);
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    };

    const parseTrendMoney = function(val) {
      if (val === undefined || val === null || val === '') return 0;
      if (typeof val === 'number') return isNaN(val) ? 0 : val;
      const clean = String(val).replace(/[¥,$\s]/g, '');
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    };

    // Chuẩn bị các mốc tháng
    const buckets = [];
    const bucketMap = {};
    for (let i = validCount - 1; i >= 0; i--) {
      const d = new Date(aYear, aMonth - 1 - i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const key = y + '-' + (m < 10 ? '0' + m : m);
      const label = 'T' + m;
      const bucket = {
        key: key,
        year: y,
        month: m,
        label: label,
        income: 0,
        expense: 0,
        revenue: 0,
        cogs: 0
      };
      buckets.push(bucket);
      bucketMap[key] = bucket;
    }

    // 1. Đọc dữ liệu Gia đình (Family / ThuChi)
    if (ss) {
      const fSheet = ss.getSheetByName ? (ss.getSheetByName("Family") || ss.getSheetByName("ThuChi") || ss.getSheetByName("FAMILY")) : null;
      if (fSheet && fSheet.getLastRow() >= 2) {
        const lastRow = fSheet.getLastRow();
        const maxCols = fSheet.getMaxColumns ? fSheet.getMaxColumns() : fSheet.getLastColumn();
        const lastCol = Math.min(Math.max(fSheet.getLastColumn(), 10), maxCols);
        const data = fSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const d = parseTrendDate(row[1]);
          if (!d || isNaN(d.getTime())) continue;

          const m = d.getMonth() + 1;
          const y = d.getFullYear();
          const key = y + '-' + (m < 10 ? '0' + m : m);
          if (!bucketMap[key]) continue;

          const loai = String(row[2] || "").trim().toLowerCase();
          const hu = String(row[3] || "").trim().toLowerCase();
          const noidungStr = String(row[4] || "").trim();
          const noidungLower = noidungStr.toLowerCase();
          const sotien = parseTrendMoney(row[5]);
          const ghichuStr = String(row[8] || "").trim();
          const ghichuLower = ghichuStr.toLowerCase();
          const statusVal = String(row[9] || "").trim().toUpperCase();

          const isPreOrder = (statusVal === "PRE-ORDER" || statusVal.includes("PRE") ||
                              noidungLower.includes("pre-order") || ghichuLower.includes("pre-order"));
          if (isPreOrder) continue;

          const isTagExcluded = noidungStr.includes("[Ứng hộ nhóm]") || noidungStr.includes("[Tất toán công nợ]") ||
                                noidungStr.includes("[Thu nợ]") || noidungStr.includes("[Trả nợ]") ||
                                ghichuStr.includes("[Ứng hộ nhóm]") || ghichuStr.includes("[Tất toán công nợ]") ||
                                ghichuStr.includes("[Thu nợ]") || ghichuStr.includes("[Trả nợ]") ||
                                noidungLower.includes("ứng cho nhóm") || noidungLower.includes("ứng hộ nhóm") ||
                                ghichuLower.includes("ứng cho nhóm") || ghichuLower.includes("ứng hộ nhóm") ||
                                hu.includes("ứng cho nhóm") || hu.includes("ứng hộ nhóm") ||
                                hu.includes("ck nội bộ") || hu.includes("công nợ") || hu.includes("tất toán thẻ") ||
                                noidungStr.includes("Chuyển tiền:") || noidungStr.includes("Tất toán thẻ:");
          if (isTagExcluded) continue;

          const isThu = (loai === "thu" || loai === "khoản thu" || loai === "thu nhập");
          if (isThu) {
            bucketMap[key].income += sotien;
          } else {
            bucketMap[key].expense += sotien;
          }
        }
      }

      // 2. Đọc dữ liệu Kinh doanh (Sales)
      const sSheet = ss.getSheetByName ? (ss.getSheetByName("Sales") || ss.getSheetByName("SALES")) : null;
      if (sSheet && sSheet.getLastRow() >= 2) {
        const lastRowS = sSheet.getLastRow();
        const maxColsS = sSheet.getMaxColumns ? sSheet.getMaxColumns() : sSheet.getLastColumn();
        const lastColS = Math.min(Math.max(sSheet.getLastColumn(), 15), maxColsS);
        const rawHeaders = (sSheet.getRange(1, 1, 1, lastColS).getValues()[0] || []);
        const headers = [];
        for (let c = 0; c < lastColS; c++) headers.push(String(rawHeaders[c] || "").trim().toLowerCase());

        let colDateIdx = headers.findIndex(h => h.includes("ngày"));
        let colQtyIdx = headers.findIndex(h => h.includes("số lượng") || h === "sl" || h.includes("xuất"));
        let colPriceIdx = headers.findIndex(h => (h.includes("giá") || h.includes("đơn giá")) && !h.includes("tổng"));
        let colTotalIdx = headers.findIndex(h => h.includes("tổng tiền") || h.includes("thành tiền"));
        let colStatusIdx = headers.findIndex(h => h.includes("trạng thái") || h.includes("thanh toán") || h.includes("tình trạng"));
        let colNoteIdx = headers.findIndex(h => h.includes("ghi chú") || h.includes("note"));
        let colCogsIdx = headers.findIndex(h => h.includes("giá vốn") || h.includes("cogs") || h.includes("tiền vốn"));
        let colOrderStatusIdx = headers.findIndex(h => h.includes("trạng thái đơn") || h.includes("tt đơn") || h === "trạng thái đơn");
        let colDeletedIdx = headers.findIndex(h => h.includes("xóa mềm") || h.includes("deleted") || h === "xóa mềm");

        if (colDateIdx === -1) colDateIdx = 1;
        if (colQtyIdx === -1) colQtyIdx = 4;
        if (colPriceIdx === -1) colPriceIdx = 5;
        if (colTotalIdx === -1) colTotalIdx = 6;
        if (colStatusIdx === -1) colStatusIdx = 9;
        if (colNoteIdx === -1) colNoteIdx = 10;
        if (colCogsIdx === -1) colCogsIdx = 11;
        if (colOrderStatusIdx === -1) colOrderStatusIdx = 13;
        if (colDeletedIdx === -1) colDeletedIdx = 14;

        const sData = sSheet.getRange(2, 1, lastRowS - 1, lastColS).getValues();
        for (let i = 0; i < sData.length; i++) {
          const r = sData[i];
          const isSaleDeleted = (r[colDeletedIdx] === true || String(r[colDeletedIdx]).trim().toUpperCase() === "TRUE");
          if (isSaleDeleted) continue;

          const rawOrderStatus = String(r[colOrderStatusIdx] || "").trim().toUpperCase();
          const trangThai = String(r[colStatusIdx] || "").trim();
          const ghiChu = String(r[colNoteIdx] || "").trim();
          const isSaleCancelled = (rawOrderStatus === "DA_HUY") || (rawOrderStatus === "DA_HOAN") ||
                                  trangThai === "DA_HUY" || trangThai === "ĐÃ HỦY" ||
                                  ghiChu.toLowerCase().includes("[đã hủy");
          if (isSaleCancelled) continue;

          const d = parseTrendDate(r[colDateIdx]);
          if (!d || isNaN(d.getTime())) continue;

          const m = d.getMonth() + 1;
          const y = d.getFullYear();
          const key = y + '-' + (m < 10 ? '0' + m : m);
          if (!bucketMap[key]) continue;

          const qty = parseTrendMoney(r[colQtyIdx]);
          const price = parseTrendMoney(r[colPriceIdx]);
          const total = parseTrendMoney(r[colTotalIdx]) || (qty * price);

          let cogsVal = (colCogsIdx !== -1 && colCogsIdx < r.length) ? parseTrendMoney(r[colCogsIdx]) : 0;
          if (cogsVal === 0 && price > 0) {
            cogsVal = Math.round(total * 0.8);
          }

          bucketMap[key].revenue += total;
          bucketMap[key].cogs += cogsVal;
        }
      }
    }

    // Định dạng dữ liệu trả về cho client biểu đồ
    const labels = [];
    const income = [];
    const expense = [];
    const savings = [];
    const revenue = [];
    const cogs = [];
    const profit = [];
    let totalIncome = 0, totalExpense = 0, totalSavings = 0;
    let totalRevenue = 0, totalCogs = 0, totalProfit = 0;

    buckets.forEach(function(b) {
      labels.push(b.label);
      const inc = Math.round(b.income);
      const exp = Math.round(b.expense);
      const sav = Math.round(b.income - b.expense);
      income.push(inc);
      expense.push(exp);
      savings.push(sav);
      totalIncome += inc;
      totalExpense += exp;
      totalSavings += sav;

      const rev = Math.round(b.revenue);
      const cg = Math.round(b.cogs);
      const prof = Math.round(b.revenue - b.cogs);
      revenue.push(rev);
      cogs.push(cg);
      profit.push(prof);
      totalRevenue += rev;
      totalCogs += cg;
      totalProfit += prof;
    });

    return {
      success: true,
      cycle: validCount,
      labels: labels,
      family: {
        income: income,
        expense: expense,
        savings: savings,
        totalIncome: totalIncome,
        totalExpense: totalExpense,
        totalSavings: totalSavings
      },
      business: {
        revenue: revenue,
        cogs: cogs,
        profit: profit,
        totalRevenue: totalRevenue,
        totalCogs: totalCogs,
        totalProfit: totalProfit
      }
    };
  } catch (err) {
    return {
      success: false,
      message: err.toString(),
      cycle: monthsCount || 3,
      labels: [],
      family: { income: [], expense: [], savings: [], totalIncome: 0, totalExpense: 0, totalSavings: 0 },
      business: { revenue: [], cogs: [], profit: [], totalRevenue: 0, totalCogs: 0, totalProfit: 0 }
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
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
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


/**
 * Đọc danh mục thiết lập ban đầu từ Sheet Categories
 * Cột A (index 0): FamilyName (Thành viên gia đình)
 * Cột F (index 5): Danh sách Kho hàng
 * Cột G (index 6) / K (index 10): Danh sách Tài khoản / Cửa hàng
 */
/**
 * Tự động phân tích và tạo Field Mapping JSON từ danh sách tiêu đề cột (Ngày, Thu, Chi, Diễn giải, Số dư, Memo)
 */
function autoGenerateFieldMapping(headers) {
  if (!Array.isArray(headers) || headers.length === 0) return {};
  const mapping = {};
  headers.forEach(h => {
    const cleanH = String(h || '').toLowerCase().trim();
    if (!cleanH) return;
    // 1. Ngày
    if ((cleanH.includes('取引日') || cleanH.includes('利用日') || cleanH.includes('日付') || cleanH.includes('年月日') || cleanH === 'date') && !cleanH.includes('期間')) {
      if (!mapping.date) mapping.date = h;
    }
    // 2. Chi (Debit)
    if (!cleanH.includes('入出金') && (cleanH.includes('お支払') || cleanH.includes('支払い') || cleanH.includes('お引出し') || cleanH.includes('出金') || cleanH === '引出' || cleanH.includes('支払') || cleanH.includes('請求額') || cleanH.includes('利用金額') || cleanH.includes('利用額')) && !cleanH.includes('方法') && !cleanH.includes('区分') && !cleanH.includes('日')) {
      if (!mapping.debit) mapping.debit = h;
    }
    // 3. Thu (Credit)
    if (!cleanH.includes('入出金') && (cleanH.includes('お預り') || cleanH.includes('お預かり') || cleanH.includes('預かり') || cleanH.includes('預り') || cleanH.includes('お預入れ') || cleanH.includes('入金') || cleanH.includes('預入') || cleanH.includes('振込入金') || cleanH.includes('払戻') || cleanH.includes('credit'))) {
      if (!mapping.credit) mapping.credit = h;
    }
    // 4. Số tiền chung (Amount)
    if (cleanH.includes('入出金') || ((cleanH.includes('金額') || cleanH.includes('amount') || cleanH === '額') && !cleanH.includes('支払') && !cleanH.includes('預') && !cleanH.includes('手数料') && !cleanH.includes('残高'))) {
      if (!mapping.amount && !mapping.debit) mapping.amount = h;
    }
    // 5. Diễn giải & Diễn giải phụ
    if (cleanH === '摘要内容' || cleanH.includes('摘要内容')) {
      mapping.description2 = h;
    } else if (cleanH.includes('摘要') || cleanH.includes('取扱内容') || cleanH.includes('利用店名') || cleanH.includes('内容') || cleanH.includes('加盟店') || cleanH.includes('desc')) {
      if (!mapping.description) mapping.description = h;
    }
    // 6. Memo
    if (cleanH === 'メモ' || cleanH === 'memo' || cleanH.includes('備考')) {
      if (!mapping.memo) mapping.memo = h;
    }
    // 7. Số dư (Balance)
    if (cleanH.includes('残高') || cleanH.includes('balance') || cleanH.includes('差引残高')) {
      if (!mapping.balance) mapping.balance = h;
    }
  });
  return mapping;
}

/**
 * Phân tích ô lưu mẫu sao kê trên sheet Wallets (hỗ trợ cả JSON object, mảng JSON, hoặc chuỗi phân tách)
 */
function parseWalletTemplateCell(cellVal) {
  if (!cellVal) return null;
  if (typeof cellVal === 'object') {
    if (Array.isArray(cellVal)) {
      return { headers: cellVal, mapping: autoGenerateFieldMapping(cellVal) };
    }
    if (cellVal.headers && Array.isArray(cellVal.headers)) return cellVal;
    if (cellVal.date || cellVal.amount || cellVal.debit) {
      return { headers: Object.values(cellVal), mapping: cellVal };
    }
    return cellVal;
  }
  const str = String(cellVal).trim();
  if (!str) return null;
  if (str.startsWith('{') || str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return { headers: parsed, mapping: autoGenerateFieldMapping(parsed) };
      }
      if (parsed && typeof parsed === 'object') {
        if (parsed.headers && Array.isArray(parsed.headers)) {
          return {
            headers: parsed.headers,
            mapping: parsed.mapping || autoGenerateFieldMapping(parsed.headers)
          };
        }
        if (parsed.date || parsed.amount || parsed.debit) {
          return { headers: Object.values(parsed), mapping: parsed };
        }
        return parsed;
      }
    } catch(e) {}
  }
  let delim = ',';
  if (str.includes('\t')) delim = '\t';
  else if (str.includes(';') && !str.includes(',')) delim = ';';
  const headers = str.split(delim).map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  if (headers.length > 0) {
    return {
      headers: headers,
      mapping: autoGenerateFieldMapping(headers)
    };
  }
  return null;
}

/**
 * Lấy toàn bộ danh sách mẫu sao kê các ngân hàng strictly từ sheet Wallets (Cột V & W)
 */
function getAllBankStatementTemplates(ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return [];

    const templates = [];
    const seenWalletTypes = new Set();

    // Quét strictly từ sheet Wallets (Cột V: Mẫu File, Cột W: Mẫu Dán)
    const wSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
    if (wSheet && wSheet.getLastRow() >= 2) {
      const lastR = wSheet.getLastRow();
      const lastC = Math.max(wSheet.getLastColumn ? wSheet.getLastColumn() : 23, 23);
      if (lastC >= 22) {
        const wData = wSheet.getRange(2, 1, lastR - 1, lastC).getValues();
        for (let r = 0; r < wData.length; r++) {
          const row = wData[r];
          const wId = String(row[0] || "").trim();
          const wName = String(row[1] || "").trim();
          if (!wName) continue;
          const wType = String(row[2] || "DEBIT").trim();
          const wLimit = row[3] || "";
          const wSettle = (row.length >= 12 ? row[11] : "") || "";

          const rawColV = row.length >= 22 ? row[21] : null;
          const rawColW = row.length >= 23 ? row[22] : null;
          const parsedV = parseWalletTemplateCell(rawColV);
          const parsedW = parseWalletTemplateCell(rawColW);

          // Trường hợp Col V là Headers mảng và Col W là Mapping
          if (parsedV && Array.isArray(parsedV.headers) && parsedW && parsedW.mapping && (!parsedW.headers || parsedW.headers.length === 0)) {
            templates.push({
              rowIndex: r + 2,
              walletId: wId,
              walletName: wName,
              walletType: wType,
              limit: wLimit,
              settleSource: wSettle,
              rawWalletCell: wName + " [File]",
              templateType: 'FILE',
              headers: parsedV.headers,
              headersText: parsedV.headers.join(', '),
              mapping: parsedW.mapping,
              sourceSheet: 'Wallets'
            });
            seenWalletTypes.add(wName.toLowerCase() + '_FILE');
            continue;
          }

          if (parsedV && parsedV.headers && parsedV.headers.length > 0) {
            templates.push({
              rowIndex: r + 2,
              walletId: wId,
              walletName: wName,
              walletType: wType,
              limit: wLimit,
              settleSource: wSettle,
              rawWalletCell: wName + " [File]",
              templateType: 'FILE',
              headers: parsedV.headers,
              headersText: parsedV.headers.join(', '),
              mapping: parsedV.mapping || autoGenerateFieldMapping(parsedV.headers),
              sourceSheet: 'Wallets'
            });
            seenWalletTypes.add(wName.toLowerCase() + '_FILE');
          }

          if (parsedW && parsedW.headers && parsedW.headers.length > 0) {
            templates.push({
              rowIndex: r + 2,
              walletId: wId,
              walletName: wName,
              walletType: wType,
              limit: wLimit,
              settleSource: wSettle,
              rawWalletCell: wName + " [Dán]",
              templateType: 'PASTE',
              headers: parsedW.headers,
              headersText: parsedW.headers.join(', '),
              mapping: parsedW.mapping || autoGenerateFieldMapping(parsedW.headers),
              sourceSheet: 'Wallets'
            });
            seenWalletTypes.add(wName.toLowerCase() + '_PASTE');
          }
        }
      }
    }

    return templates;
  } catch(err) {
    return [];
  }
}


var SYSTEM_CARD_SECRET_KEY = "AgY_FiNaNcIaL_v2_SeCuRe_KeY_2026";

function getSystemCardSecretKey() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      if (props) {
        let key = props.getProperty("CARD_SECRET_KEY");
        if (!key) {
          key = SYSTEM_CARD_SECRET_KEY;
          props.setProperty("CARD_SECRET_KEY", key);
        }
        return key;
      }
    }
  } catch(e) {}
  return SYSTEM_CARD_SECRET_KEY;
}

function getHmacSha256(key, message) {
  if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
    const raw = Utilities.computeHmacSha256Signature(message, key, Utilities.Charset.UTF_8);
    let hex = "";
    for (let i = 0; i < raw.length; i++) {
      let b = raw[i];
      if (b < 0) b += 256;
      let s = b.toString(16);
      if (s.length === 1) s = "0" + s;
      hex += s;
    }
    return hex;
  }
  let hash = 0;
  for (let i = 0; i < (message || "").length; i++) {
    hash = ((hash << 5) - hash) + message.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

function utf8BytesToStr(bytes) {
  if (typeof Utilities !== 'undefined' && Utilities.newBlob) {
    try {
      return Utilities.newBlob(bytes).getDataAsString("UTF-8");
    } catch(e) {}
  }
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

function decryptCardField(cipherText, secretKey) {
  if (!cipherText || typeof cipherText !== 'string') return "";
  const trimmed = cipherText.trim();
  if (!trimmed.startsWith("ENC:v1:")) {
    return trimmed;
  }
  const parts = trimmed.split(":");
  if (parts.length !== 5) return "";
  const salt = parts[2];
  const cipherHex = parts[3];
  const tag = parts[4];
  const key = secretKey || getSystemCardSecretKey();
  const expectedTag = getHmacSha256(key, salt + ":" + cipherHex).slice(0, 16);
  if (tag !== expectedTag) {
    return "";
  }
  const byteLen = cipherHex.length / 2;
  let keyStreamHex = "";
  let counter = 0;
  while (keyStreamHex.length < byteLen * 2) {
    keyStreamHex += getHmacSha256(key, salt + ":ks:" + counter);
    counter++;
  }
  const plainBytes = [];
  for (let i = 0; i < cipherHex.length; i += 2) {
    const cByte = parseInt(cipherHex.substr(i, 2), 16);
    const ksByte = parseInt(keyStreamHex.substr(i, 2), 16);
    plainBytes.push(cByte ^ ksByte);
  }
  return utf8BytesToStr(plainBytes);
}

function isCategoryHidden(str) {
  if (!str) return false;
  const s = String(str).trim().toUpperCase();
  return s.startsWith("[HIDDEN]") || s.startsWith("[ĐÃ ẨN]") || s.startsWith("[AN]") || s.startsWith("_HIDDEN_");
}

/**
 * Kiểm tra xem danh mục hoặc thẻ đã tồn tại trong database chưa theo đúng quy định:
 * - Đối tác (FAMILY): sheet 'Debt' Cột C (Tên Đối Tượng)
 * - Kho (WAREHOUSE): sheet 'Purchase' Cột D (Trạng Thái Kho / Tên Kho)
 * - Tài khoản (ACCOUNT): sheet 'Purchase' Cột N (Tài khoản mua)
 * - Thẻ (WALLET): sheet 'WalletLedger' Cột C (WalletName) hoặc Cột B (WalletID)
 */
function checkIfCategoryIsUsed(ss, type, val) {
  if (!ss || !val) return false;
  const target = String(val).trim().toLowerCase();
  if (!target) return false;

  try {
    const normType = String(type || '').toUpperCase();

    // 1. Đối tác -> Sheet Debt Cột C (index 2: Tên Đối Tượng)
    if (normType === 'FAMILY' || normType === 'DOITAC' || normType === 'PARTNER') {
      const debtSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (debtSheet && debtSheet.getLastRow() >= 2) {
        const lastR = debtSheet.getLastRow();
        const dataC = debtSheet.getRange(2, 3, lastR - 1, 1).getValues();
        for (let r = 0; r < dataC.length; r++) {
          const cellStr = String(dataC[r][0] || "").trim().toLowerCase();
          if (cellStr && (cellStr === target || cellStr.includes(target))) {
            return true;
          }
        }
      }
      return false;
    }

    // 2. Kho hàng -> Sheet Purchase Cột D (index 3: Kho / Trạng Thái Kho)
    if (normType === 'WAREHOUSE' || normType === 'KHO') {
      const pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("DonHang") || ss.getSheetByName("Đơn Hàng") || ss.getSheetByName("Orders");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastR = pSheet.getLastRow();
        const maxCols = pSheet.getLastColumn ? pSheet.getLastColumn() : 4;
        const colIdx = 4; // Cột D (index 4 trong Sheet 1-based)
        if (maxCols >= colIdx) {
          const dataD = pSheet.getRange(2, colIdx, lastR - 1, 1).getValues();
          for (let r = 0; r < dataD.length; r++) {
            const cellStr = String(dataD[r][0] || "").trim().toLowerCase();
            if (cellStr && (cellStr === target || cellStr.includes(target))) {
              return true;
            }
          }
        }
      }
      return false;
    }

    // 3. Tài khoản đặt hàng -> Sheet Purchase Cột N (index 13: Tài khoản mua)
    if (normType === 'ACCOUNT' || normType === 'TK') {
      const pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("DonHang") || ss.getSheetByName("Đơn Hàng") || ss.getSheetByName("Orders");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastR = pSheet.getLastRow();
        const maxCols = pSheet.getLastColumn ? pSheet.getLastColumn() : 14;
        const colIdx = 14; // Cột N (index 14 trong Sheet 1-based)
        if (maxCols >= colIdx) {
          const dataN = pSheet.getRange(2, colIdx, lastR - 1, 1).getValues();
          for (let r = 0; r < dataN.length; r++) {
            const cellStr = String(dataN[r][0] || "").trim().toLowerCase();
            if (cellStr && (cellStr === target || cellStr.includes(target))) {
              return true;
            }
          }
        }
      }
      return false;
    }

    // 4. Thẻ / Ví -> Sheet WalletLedger Cột C (WalletName) hoặc Cột B (WalletID)
    if (normType === 'WALLET' || normType === 'CARD') {
      const lSheet = ss.getSheetByName("WalletLedger") || ss.getSheetByName("SoCaiVi");
      if (lSheet && lSheet.getLastRow() >= 2) {
        const lastR = lSheet.getLastRow();
        const dataBC = lSheet.getRange(2, 2, lastR - 1, 2).getValues();
        for (let r = 0; r < dataBC.length; r++) {
          const wId = String(dataBC[r][0] || "").trim().toLowerCase();
          const wName = String(dataBC[r][1] || "").trim().toLowerCase();
          if ((wId && wId === target) || (wName && wName === target)) {
            return true;
          }
        }
      }
      return false;
    }
  } catch(e) {
    return true;
  }
  return false;
}

function getInitialSetupCategories(ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, connectionError: true, message: "❌ Lỗi kết nối dữ liệu: Không thể mở bảng tính cá nhân.", familyMembers: [], warehouses: [], accounts: [], shops: [], statementTemplates: [] };
    const catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("Catagories") || ss.getSheetByName("DanhMuc");
    if (!catSheet) {
      return { success: true, familyMembers: [], warehouses: [], accounts: [], shops: [], statementTemplates: [] };
    }
    const lastRow = catSheet.getLastRow();
    if (lastRow < 2) {
      return { success: true, familyMembers: [], warehouses: [], accounts: [], shops: [], statementTemplates: [] };
    }
    const maxCol = Math.max(catSheet.getLastColumn(), 11);
    const data = catSheet.getRange(2, 1, lastRow - 1, maxCol).getValues();
    const headerRow = (lastRow >= 1) ? (catSheet.getRange(1, 1, 1, maxCol).getValues()[0] || []) : [];

    let famColIdx = 0;  // Mặc định Cột A (index 0): Đối tác / FamilyName
    let whColIdx = 5;   // Mặc định Cột F (index 5): Kho
    let accColIdx = 6;  // Mặc định Cột G (index 6): Tài khoản
    let shopColIdx = 7; // Mặc định Cột H (index 7): Cửa hàng

    headerRow.forEach((h, idx) => {
      const title = String(h || "").trim().toLowerCase();
      if (title === "kho" || title.includes("tên kho") || title.includes("danh sách kho")) {
        whColIdx = idx;
      } else if (title.includes("đối tác") || title.includes("khách") || title.includes("partner") || title.includes("family")) {
        famColIdx = idx;
      } else if (title.includes("tài khoản") || title.includes("tk đặt hàng")) {
        accColIdx = idx;
      } else if (title.includes("cửa hàng") || title.includes("shop")) {
        shopColIdx = idx;
      }
    });

    const familySet = new Set();
    const whSet = new Set();
    const accSet = new Set();
    const shopSet = new Set();

    const hiddenFamilySet = new Set();
    const hiddenWhSet = new Set();
    const hiddenAccSet = new Set();
    const hiddenShopSet = new Set();

    const ignoredFamily = ["Tên", "Thành viên", "FamilyName", "Khách / Đối tác", "Nơi mua", "Ví", "Ví/Thẻ", "Mẫu Nội Dung Thu Chi", "Đối tác", "Danh sách khách / đối tác", "Partner", "Kho", "Tên Kho"];
    const ignoredWh = ["Kho", "Trạng Thái Kho", "Danh sách Kho", "Tên Kho", "KHO", "Danh sách kho", "Trạng thái kho"];
    const ignoredAcc = ["Tài khoản mua", "Tài khoản", "Tài khoản đặt hàng", "TK Mua", "Danh sách Tài khoản", "Tài Khoản Đặt Hàng", "Tài Khoản", "Danh sách tài khoản", "TK Phụ"];
    const ignoredShop = ["Cửa hàng", "Shop", "Tên Shop", "Tên Cửa Hàng", "Danh sách Cửa Hàng", "Danh sách shop", "Mẫu Cũ"];

    data.forEach(r => {
      // 1. Đối tác (Cột A)
      const fam = String(r[famColIdx] || "").trim();
      if (fam && !ignoredFamily.includes(fam)) {
        if (isCategoryHidden(fam)) {
          const clean = fam.replace(/^\[(HIDDEN|ĐÃ ẨN|AN|_HIDDEN_)\]\s*/i, '').trim();
          if (clean) hiddenFamilySet.add(clean);
        } else {
          familySet.add(fam);
        }
      }

      // 2. Kho hàng (Cột F hoặc whColIdx) - Giữ nguyên toàn bộ từ F2 đến cuối dòng
      const wh = String(r[whColIdx] || "").trim();
      if (wh && !ignoredWh.includes(wh)) {
        if (isCategoryHidden(wh)) {
          const clean = wh.replace(/^\[(HIDDEN|ĐÃ ẨN|AN|_HIDDEN_)\]\s*/i, '').trim();
          if (clean) hiddenWhSet.add(clean);
        } else {
          whSet.add(wh);
        }
      }

      // 3. Tài khoản (Cột G) - CHỈ ĐỌC CỘT G (accColIdx), TUYỆT ĐỐI KHÔNG ĐỌC CỘT K (r[10]) ĐỂ TRÁNH LẪN TIÊU ĐỀ SAO KÊ
      const accG = String(r[accColIdx] || "").trim();
      if (accG && !ignoredAcc.includes(accG)) {
        if (isCategoryHidden(accG)) {
          const clean = accG.replace(/^\[(HIDDEN|ĐÃ ẨN|AN|_HIDDEN_)\]\s*/i, '').trim();
          if (clean) hiddenAccSet.add(clean);
        } else {
          accSet.add(accG);
        }
      }

      // 4. Cửa hàng (Cột H) - CHỈ ĐỌC CỘT H (shopColIdx)
      const shopH = String(r[shopColIdx] || "").trim();
      if (shopH && !ignoredShop.includes(shopH)) {
        if (isCategoryHidden(shopH)) {
          const clean = shopH.replace(/^\[(HIDDEN|ĐÃ ẨN|AN|_HIDDEN_)\]\s*/i, '').trim();
          if (clean) hiddenShopSet.add(clean);
        } else {
          shopSet.add(shopH);
        }
      }
    });

    // Nếu whSet trống nhưng Col A có dữ liệu và người dùng đặt Kho ở Col A
    if (whSet.size === 0) {
      data.forEach(r => {
        const valA = String(r[0] || "").trim();
        if (valA && !ignoredWh.includes(valA) && !ignoredFamily.includes(valA) && !isCategoryHidden(valA)) {
          whSet.add(valA);
        }
      });
    }

    // Chỉ dự phòng bổ sung tên shop từ danh sách tài khoản Col G NẾU Cột H hoàn toàn chưa có dữ liệu
    if (shopSet.size === 0) {
      accSet.forEach(acc => {
        const str = String(acc).trim();
        const shopPart = str.includes(' - ') ? str.split(' - ')[0].trim() : str.split(' ')[0].trim();
        if (shopPart && shopPart.length >= 2 && !ignoredShop.includes(shopPart) && !ignoredAcc.includes(shopPart)) {
          shopSet.add(shopPart);
        }
      });
    }

    const statementTemplates = getAllBankStatementTemplates(ss);

    // Bổ sung toàn bộ danh sách ví/thẻ từ sheet Wallets để quản lý thẻ & mẫu sao kê đồng bộ
    const walletsList = [];
    const virtualCardsList = [];
    const wSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
    if (wSheet && wSheet.getLastRow() >= 2) {
      const lastR = wSheet.getLastRow();
      const lastC = Math.max(wSheet.getLastColumn ? wSheet.getLastColumn() : 23, 23);
      const range = wSheet.getRange(2, 1, lastR - 1, lastC);
      const wData = range.getValues();
      const wDisplay = (typeof range.getDisplayValues === 'function') ? range.getDisplayValues() : wData;

      for (let r = 0; r < wData.length; r++) {
        const row = wData[r];
        const dispRow = wDisplay[r] || row;
        const wId = String(row[0] || '').trim();
        const wName = String(row[1] || '').trim();
        const wType = String(row[2] || 'DEBIT').trim();
        const wLimit = row[3] || '';
        const wClosing = row[4] || '';
        const wDue = row[5] || '';
        const wInit = (typeof parseMoneyNumber === 'function') ? parseMoneyNumber(row[6]) : (Number(row[6]) || 0);
        const wInc = (typeof parseMoneyNumber === 'function') ? parseMoneyNumber(row[7]) : (Number(row[7]) || 0);
        const wDec = (typeof parseMoneyNumber === 'function') ? parseMoneyNumber(row[8]) : (Number(row[8]) || 0);
        const wCur = (typeof parseMoneyNumber === 'function') ? parseMoneyNumber(row[10]) : (Number(row[10]) || 0);
        const calcCur = (wInc !== 0 || wDec !== 0) ? (wInit + wInc - wDec) : (wCur !== 0 ? wCur : wInit);
        const wSettle = (row.length >= 12 ? row[11] : '') || '';
        const rawColV = row.length >= 22 ? row[21] : null;
        const rawColW = row.length >= 23 ? row[22] : null;
        const parsedV = parseWalletTemplateCell(rawColV);
        const parsedW = parseWalletTemplateCell(rawColW);

        // THẺ CHÍNH: Load số thẻ chính duy nhất từ Cột O (15, index 14)
        let cardLast4 = "";
        let maskedNum = "";
        try {
          if (row.length >= 15) {
            const dispVal = String(dispRow[14] || "").trim();
            const rawVal = String(row[14] || "").trim();
            const valToCheck = dispVal || rawVal;
            if (valToCheck) {
              const dec = valToCheck.startsWith("ENC:v1:") ? decryptCardField(valToCheck) : valToCheck;
              const cleanDigits = String(dec || '').replace(/\D/g, '');
              if (cleanDigits.length >= 4 && cleanDigits.length <= 19) {
                cardLast4 = cleanDigits.slice(-4);
                maskedNum = "•••• •••• •••• " + cardLast4;
              }
            }
          }
        } catch(eN) {}

        // THẺ ẢO (REVOCHI): Cột R (18, index 17), S (19, index 18), T (20, index 19), U (21, index 20)
        let vCardName = "";
        let vCardNum = "";
        let vCardLast4 = "";
        let vMaskedNum = "";
        let vCardExp = "";
        let vCardCvv = "";
        try {
          if (row.length >= 18) {
            const rawVName = String(dispRow[17] || row[17] || "").trim();
            vCardName = rawVName.startsWith("ENC:v1:") ? decryptCardField(rawVName) : rawVName;
          }
          if (row.length >= 19) {
            const rawVNum = String(dispRow[18] || row[18] || "").trim();
            const decVNum = rawVNum.startsWith("ENC:v1:") ? decryptCardField(rawVNum) : rawVNum;
            vCardNum = decVNum;
            const cleanVDigits = String(decVNum || '').replace(/\D/g, '');
            if (cleanVDigits.length >= 4) {
              vCardLast4 = cleanVDigits.slice(-4);
              vMaskedNum = "•••• •••• •••• " + vCardLast4;
            } else if (cleanVDigits.length > 0) {
              vCardLast4 = cleanVDigits;
              vMaskedNum = cleanVDigits;
            }
          }
          if (row.length >= 20) {
            const rawVExp = String(dispRow[19] || row[19] || "").trim();
            vCardExp = rawVExp.startsWith("ENC:v1:") ? decryptCardField(rawVExp) : rawVExp;
          }
          if (row.length >= 21) {
            const rawVCvv = String(dispRow[20] || row[20] || "").trim();
            vCardCvv = rawVCvv.startsWith("ENC:v1:") ? decryptCardField(rawVCvv) : rawVCvv;
          }
        } catch(eV) {}

        const colNStatus = (row.length >= 14 && row[13] !== undefined) ? String(row[13] || "").trim().toUpperCase() : "";
        const isCardDeleted = (colNStatus === "DELETED" || colNStatus === "HIDDEN" || colNStatus === "XOA" || colNStatus === "ĐÃ XÓA");

        if (wName) {
          walletsList.push({
            id: wId,
            name: wName,
            type: wType,
            limit: wLimit,
            credit_limit: wLimit,
            closing_date: wClosing,
            due_date: wDue,
            initial_balance: wInit,
            current_balance: calcCur,
            balance: calcCur,
            settle_source: wSettle,
            settleSource: wSettle,
            last4: cardLast4,
            masked_number: maskedNum,
            fileTemplate: parsedV,
            pasteTemplate: parsedW,
            is_hidden: isCardDeleted,
            is_deleted: isCardDeleted,
            status: isCardDeleted ? colNStatus : ''
          });
        }

        // Bổ sung Thẻ Ảo từ R2 đến cuối (Cột R..U, hoàn toàn độc lập với Cột B)
        if (vCardName || vCardNum || vCardLast4 || vCardExp || vCardCvv) {
          virtualCardsList.push({
            id: "VC_" + (r + 2),
            row: r + 2,
            name: vCardName || ("Thẻ Ảo R" + (r + 2)),
            last4: vCardLast4,
            masked_number: vMaskedNum || (vCardLast4 ? ("•••• •••• •••• " + vCardLast4) : (vCardNum || "")),
            cardNumber: vMaskedNum || vCardNum || "",
            cardExp: vCardExp || "",
            cardCvv: vCardCvv || "",
            isVirtual: true,
            type: "VIRTUAL"
          });
        }
      }
    }

    // Thu thập danh sách mục đã có dữ kiện (để ẩn nút xoá hẳn)
    const usedPartnersSet = new Set();
    const usedAccountsSet = new Set();
    const usedWarehousesSet = new Set();
    const usedWalletsSet = new Set();

    try {
      // 1. Debt (Cột C: Tên Đối Tượng)
      const debtSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (debtSheet && debtSheet.getLastRow() >= 2) {
        const dVals = debtSheet.getRange(2, 3, debtSheet.getLastRow() - 1, 1).getValues();
        dVals.forEach(r => {
          const s = String(r[0] || '').trim().toLowerCase();
          if (s) usedPartnersSet.add(s);
        });
      }

      // 2. Purchase (Cột D: Kho, Cột N: Tài khoản)
      const pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("DonHang") || ss.getSheetByName("Đơn Hàng") || ss.getSheetByName("Orders");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastPR = pSheet.getLastRow();
        const maxPC = Math.max(pSheet.getLastColumn(), 14);
        const pVals = pSheet.getRange(2, 1, lastPR - 1, maxPC).getValues();
        pVals.forEach(r => {
          const wh = String(r[3] || '').trim().toLowerCase(); // Col D
          const acc = String(r[13] || '').trim().toLowerCase(); // Col N
          const w = String(r[8] || '').trim().toLowerCase(); // Col I (ví)
          if (wh) usedWarehousesSet.add(wh);
          if (acc) usedAccountsSet.add(acc);
          if (w) usedWalletsSet.add(w);
        });
      }

      // 3. WalletLedger (Cột B: ID, Cột C: Tên Ví)
      const lSheet = ss.getSheetByName("WalletLedger") || ss.getSheetByName("SoCaiVi");
      if (lSheet && lSheet.getLastRow() >= 2) {
        const lVals = lSheet.getRange(2, 2, lSheet.getLastRow() - 1, 2).getValues();
        lVals.forEach(r => {
          const wId = String(r[0] || '').trim().toLowerCase();
          const wName = String(r[1] || '').trim().toLowerCase();
          if (wId) usedWalletsSet.add(wId);
          if (wName) usedWalletsSet.add(wName);
        });
      }
    } catch(e) {}

    return {
      success: true,
      familyMembers: Array.from(familySet),
      warehouses: Array.from(whSet),
      accounts: Array.from(accSet),
      shops: Array.from(shopSet),
      hiddenFamilyMembers: Array.from(hiddenFamilySet),
      hiddenWarehouses: Array.from(hiddenWhSet),
      hiddenAccounts: Array.from(hiddenAccSet),
      hiddenShops: Array.from(hiddenShopSet),
      usedItems: {
        partners: Array.from(usedPartnersSet),
        accounts: Array.from(usedAccountsSet),
        warehouses: Array.from(usedWarehousesSet),
        wallets: Array.from(usedWalletsSet)
      },
      statementTemplates: statementTemplates,
      wallets: walletsList,
      virtualCards: virtualCardsList
    };
  } catch(err) {
    return { success: false, message: "❌ Lỗi đọc thiết lập ban đầu: " + err.toString() };
  }
}

/**
 * Thêm / Sửa / Xóa danh mục thiết lập ban đầu trên Sheet Categories
 * type: 'FAMILY' (Cột A) | 'WAREHOUSE' (Cột F/A) | 'ACCOUNT' (Cột G) | 'SHOP' (Cột H) | 'STATEMENT' (Cột J..)
 * action: 'ADD' | 'UPDATE' | 'DELETE'
 */
function saveInitialSetupCategory(type, action, value, oldValue, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };
    let catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("Catagories") || ss.getSheetByName("DanhMuc");
    if (!catSheet) {
      catSheet = ss.insertSheet("Categories");
      catSheet.getRange(1, 1, 1, 11).setValues([["FamilyName", "Mẫu Nội Dung", "Hũ Mẫu", "Ví Mẫu", "Ghi Chú", "Kho", "Tài Khoản Đặt Hàng", "Cửa Hàng", "Hũ Cũ", "Ví Cũ", "TK Phụ"]]);
    }
    const maxCol = Math.max(catSheet.getLastColumn ? catSheet.getLastColumn() : 11, 11);
    const headerRow = catSheet.getLastRow() >= 1 ? (catSheet.getRange(1, 1, 1, maxCol).getValues()[0] || []) : [];

    let famCol = 1;  // Col A
    let whCol = 6;   // Col F
    let accCol = 7;  // Col G
    let shopCol = 8; // Col H

    headerRow.forEach((h, idx) => {
      const title = String(h || "").trim().toLowerCase();
      if (title === "kho" || title.includes("tên kho") || title.includes("danh sách kho")) {
        whCol = idx + 1;
      } else if (title.includes("đối tác") || title.includes("khách") || title.includes("partner") || title.includes("family")) {
        famCol = idx + 1;
      } else if (title.includes("tài khoản") || title.includes("tk đặt hàng")) {
        accCol = idx + 1;
      } else if (title.includes("cửa hàng") || title.includes("shop")) {
        shopCol = idx + 1;
      }
    });

    if (type === 'STATEMENT' || type === 'BANK_TEMPLATE' || type === 'WALLET') {
      const parseHeaders = (rawHeaders) => {
        if (!rawHeaders) return [];
        if (Array.isArray(rawHeaders)) {
          return rawHeaders.map(h => String(h).trim()).filter(Boolean);
        }
        let delim = ',';
        if (rawHeaders.includes('\t')) delim = '\t';
        else if (rawHeaders.includes(';') && !rawHeaders.includes(',')) delim = ';';
        return String(rawHeaders).split(delim).map(h => h.trim().replace(/^"|"$/g, '')).filter(Boolean);
      };

      const formatTemplateCellJson = (rawHeaders, customMapping) => {
        const headers = parseHeaders(rawHeaders);
        if (!headers || headers.length === 0) return "";
        const mapping = (customMapping && typeof customMapping === 'object' && Object.keys(customMapping).length > 0)
          ? customMapping
          : autoGenerateFieldMapping(headers);
        return JSON.stringify({
          headers: headers,
          mapping: mapping
        });
      };

      const deleteLegacyTemplateRowsFromCategories = (targetWallet, tmplType, rawCell) => {
        try {
          const lastR = Math.max(catSheet.getLastRow(), 1);
          if (lastR < 1) return;
          const lastC = Math.max(catSheet.getLastColumn ? catSheet.getLastColumn() : 20, 20);
          const numCols = Math.max(lastC - 9, 15);
          const colJ = catSheet.getRange(1, 10, lastR, 1).getValues();

          const normRaw = String(rawCell || '').trim().toLowerCase();
          const normTarget = String(targetWallet || '').trim().toLowerCase();

          for (let r = 0; r < colJ.length; r++) {
            const cell = String(colJ[r][0] || '').trim();
            const normCell = cell.toLowerCase();
            const cleanCell = normCell.replace(/\[(file|dán|paste)\]/i, '').trim();
            const cellType = /\[(dán|paste)\]/i.test(cell) ? 'PASTE' : 'FILE';

            let shouldDel = false;
            if (normRaw && normCell === normRaw) shouldDel = true;
            else if (tmplType && normTarget && cleanCell === normTarget && cellType === tmplType) shouldDel = true;
            else if (!tmplType && normTarget && (cleanCell === normTarget || normCell === normTarget)) shouldDel = true;

            if (shouldDel) {
              const clearVals = [new Array(numCols).fill("")];
              catSheet.getRange(r + 1, 10, 1, numCols).setValues(clearVals);
            }
          }
        } catch(e) {}
      };

      let parsed = (typeof value === 'object' && value !== null) ? value : {};
      if (typeof value === 'string') {
        try { parsed = JSON.parse(value); } catch(e) { parsed = { walletName: value }; }
      }

      let walletName = String(parsed.walletName || parsed.wallet || value || '').trim();
      const oldWalletName = String(parsed.oldWalletName || oldValue || '').trim();
      const rawWalletCell = String(parsed.rawWalletCell || parsed.oldRawWalletCell || '').trim();
      walletName = walletName.replace(/\[(file|dán|paste)\]/i, '').trim();

      // Đảm bảo Sheet Wallets có ít nhất 23 cột (Col V = 22, Col W = 23)
      const wSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
      let walletRowIdx = -1;

      if (wSheet) {
        const curMaxCols = wSheet.getMaxColumns ? wSheet.getMaxColumns() : 23;
        if (curMaxCols < 23 && typeof wSheet.insertColumnsAfter === 'function') {
          try { wSheet.insertColumnsAfter(curMaxCols, 23 - curMaxCols); } catch(e) {}
        }

        // Cập nhật tiêu đề hàng 1 của sheet Wallets nếu thiếu: Col V = Mẫu Sao Kê (File), Col W = Mẫu Sao Kê (Dán)
        try {
          const hRange = wSheet.getRange(1, 22, 1, 2);
          const curH = hRange.getDisplayValues()[0];
          if (!curH[0] || !curH[1]) {
            hRange.setValues([["Mẫu Sao Kê (File)", "Mẫu Sao Kê (Dán)"]]);
          }
        } catch(hErr) {}

        const lastWRow = wSheet.getLastRow();
        if (lastWRow >= 2) {
          const wData = wSheet.getRange(2, 1, lastWRow - 1, 2).getValues();
          const normTarget = walletName.toLowerCase();
          for (let r = 0; r < wData.length; r++) {
            const rId = String(wData[r][0] || '').trim().toLowerCase();
            const rName = String(wData[r][1] || '').trim().toLowerCase();
            if (rName === normTarget || rId === normTarget) {
              walletRowIdx = r + 2;
              break;
            }
          }
          if (walletRowIdx === -1) {
            const canonTarget = normTarget.replace(/^c[\s\-_:]*/, '');
            for (let r = 0; r < wData.length; r++) {
              const rName = String(wData[r][1] || '').trim().toLowerCase().replace(/^c[\s\-_:]*/, '');
              if (rName === canonTarget) {
                walletRowIdx = r + 2;
                break;
              }
            }
          }
        }
        if (walletRowIdx === -1 && action !== 'DELETE' && walletName) {
          const newWId = "W" + Date.now().toString().slice(-4);
          const isCred = /^c[\s\-_:]*/i.test(walletName);
          const newRow = [newWId, walletName, (isCred ? 'CREDIT' : 'DEBIT'), 0, "", "", 0, 0, 0, 0, 0, "", ""];
          while (newRow.length < 23) newRow.push("");
          wSheet.appendRow(newRow);
          walletRowIdx = wSheet.getLastRow();
        }
      }

      if (action === 'DELETE') {
        const delType = parsed.templateType || (/\[(dán|paste)\]/i.test(rawWalletCell) ? 'PASTE' : (/\[(file)\]/i.test(rawWalletCell) ? 'FILE' : null));
        if (wSheet && walletRowIdx >= 2) {
          if (delType === 'FILE') {
            wSheet.getRange(walletRowIdx, 22).setValue("");
          } else if (delType === 'PASTE') {
            wSheet.getRange(walletRowIdx, 23).setValue("");
          } else {
            wSheet.getRange(walletRowIdx, 22, 1, 2).setValues([["", ""]]);
          }
        }
        deleteLegacyTemplateRowsFromCategories(walletName, delType, rawWalletCell);
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        return {
          success: true,
          message: `✅ Đã xóa mẫu sao kê của ví "${walletName || rawWalletCell}"!`,
          data: getInitialSetupCategories(ss)
        };
      }

      const hasFileHeaders = parsed.fileHeaders !== undefined && parsed.fileHeaders !== null;
      const hasPasteHeaders = parsed.pasteHeaders !== undefined && parsed.pasteHeaders !== null;

      if (hasFileHeaders || hasPasteHeaders) {
        if (!walletName) return { success: false, message: "⚠️ Vui lòng nhập hoặc chọn Tên Ví / Ngân Hàng!" };
        const fileH = parseHeaders(parsed.fileHeaders);
        const pasteH = parseHeaders(parsed.pasteHeaders);

        if (fileH.length === 0 && pasteH.length === 0) {
          return { success: false, message: "⚠️ Vui lòng nhập ít nhất một mẫu tiêu đề sao kê (Mẫu File hoặc Mẫu Dán)!" };
        }

        if (wSheet && walletRowIdx >= 2) {
          if (parsed.walletType) {
            wSheet.getRange(walletRowIdx, 3).setValue(parsed.walletType);
          }
          if (parsed.limit !== undefined && parsed.limit !== null && parsed.limit !== "") {
            wSheet.getRange(walletRowIdx, 4).setValue(parsed.limit);
          }
          if (parsed.settleSource !== undefined && parsed.settleSource !== null) {
            wSheet.getRange(walletRowIdx, 12).setValue(parsed.settleSource);
          }
          if (hasFileHeaders) {
            const fileVal = formatTemplateCellJson(fileH, parsed.fileMapping);
            wSheet.getRange(walletRowIdx, 22).setValue(fileVal);
          }
          if (hasPasteHeaders) {
            const pasteVal = formatTemplateCellJson(pasteH, parsed.pasteMapping);
            wSheet.getRange(walletRowIdx, 23).setValue(pasteVal);
          }
        }

        if (oldWalletName && oldWalletName.toLowerCase() !== walletName.toLowerCase()) {
          deleteLegacyTemplateRowsFromCategories(oldWalletName, null, null);
        }
        deleteLegacyTemplateRowsFromCategories(walletName, null, null);

        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        return {
          success: true,
          message: `✅ Đã lưu mẫu sao kê vào sheet Wallets (Cột V & W) cho ví "${walletName}"!`,
          data: getInitialSetupCategories(ss)
        };
      }

      // Single template format (backwards-compatible)
      const tmplType = (parsed.templateType === 'PASTE' || /\[(dán|paste)\]/i.test(rawWalletCell)) ? 'PASTE' : 'FILE';
      const singleHeaders = parseHeaders(parsed.headers || parsed.headerText);

      if (!walletName) return { success: false, message: "⚠️ Vui lòng nhập hoặc chọn Tên Ví / Ngân Hàng!" };
      if (singleHeaders.length === 0) return { success: false, message: "⚠️ Vui lòng nhập dòng tiêu đề các cột trong sao kê!" };

      if (wSheet && walletRowIdx >= 2) {
        const singleVal = formatTemplateCellJson(singleHeaders, parsed.mapping);
        if (tmplType === 'PASTE') {
          wSheet.getRange(walletRowIdx, 23).setValue(singleVal);
        } else {
          wSheet.getRange(walletRowIdx, 22).setValue(singleVal);
        }
      }

      deleteLegacyTemplateRowsFromCategories(walletName, tmplType, rawWalletCell);
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      return {
        success: true,
        message: `✅ Đã lưu ${tmplType === 'PASTE' ? 'Mẫu Dán (Cột W)' : 'Mẫu File (Cột V)'} vào sheet Wallets cho ví "${walletName}" (${singleHeaders.length} cột)!`,
        data: getInitialSetupCategories(ss)
      };
    }

    // Handle FAMILY (Col A), WAREHOUSE (Col F/A), ACCOUNT (Col G), SHOP (Col H)
    let targetCol = famCol; // Mặc định Cột A: Đối tác / FamilyName
    if (type === 'WAREHOUSE') targetCol = whCol; // Cột F / A: Kho
    else if (type === 'ACCOUNT') targetCol = accCol; // Cột G: Tài khoản
    else if (type === 'SHOP') targetCol = shopCol; // Cột H: Cửa hàng

    let val = '';
    let shopPart = '';
    let nickPart = '';

    if (typeof value === 'object' && value !== null) {
      if (type === 'ACCOUNT') {
        shopPart = String(value.shop || value.store || '').trim();
        nickPart = String(value.name || value.nick || value.accountName || '').trim();
        if (shopPart && nickPart) {
          val = `${shopPart} ${nickPart}`; // Format: Tên cửa hàng (khoảng trắng) tên tk
        } else {
          val = shopPart || nickPart;
        }
      } else {
        val = String(value.name || value.value || '').trim();
      }
    } else {
      val = String(value || "").trim();
      if (type === 'ACCOUNT' && val) {
        if (val.includes(' - ')) {
          shopPart = val.split(' - ')[0].trim();
        } else if (val.includes(' ')) {
          shopPart = val.split(' ')[0].trim();
        }
      }
    }

    const oldVal = String(oldValue || "").trim();
    const lastRow = Math.max(catSheet.getLastRow(), 1);

    if (lastRow >= 2) {
      const colVals = catSheet.getRange(2, targetCol, lastRow - 1, 1).getValues();

      if (action === 'DELETE' || action === 'HARD_DELETE' || action === 'PERMANENT_DELETE') {
        const targetToDelete = (val || oldVal).toLowerCase();
        let wasDeleted = false;
        let isUsed = false;
        for (let i = 0; i < colVals.length; i++) {
          const rawCell = String(colVals[i][0] || "").trim();
          const cleanCell = rawCell.replace(/^\[(HIDDEN|ĐÃ ẨN|AN|_HIDDEN_)\]\s*/i, '').trim();
          if (cleanCell.toLowerCase() === targetToDelete || rawCell.toLowerCase() === targetToDelete) {
            isUsed = checkIfCategoryIsUsed(ss, type, cleanCell || rawCell);
            if (action === 'HARD_DELETE' || action === 'PERMANENT_DELETE') {
              if (isUsed) {
                return {
                  success: false,
                  message: `⚠️ Không thể xoá hẳn danh mục "${val || oldVal}" vì đã có dữ liệu phát sinh trong sổ sách. Danh mục được giữ ở trạng thái ẩn để bảo toàn lịch sử!`,
                  data: getInitialSetupCategories(ss)
                };
              }
              catSheet.getRange(i + 2, targetCol).setValue("");
            } else {
              if (!isUsed) {
                catSheet.getRange(i + 2, targetCol).setValue("");
              } else {
                catSheet.getRange(i + 2, targetCol).setValue("[HIDDEN] " + (cleanCell || rawCell));
              }
            }
            wasDeleted = true;
            break;
          }
        }
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        const fresh = getInitialSetupCategories(ss);
        return {
          success: true,
          message: (action === 'HARD_DELETE' || action === 'PERMANENT_DELETE')
            ? `✅ Đã xóa vĩnh viễn danh mục "${val || oldVal}"!`
            : (isUsed
              ? `✅ Danh mục "${val || oldVal}" đã từng phát sinh dữ liệu nên đã được ẩn khỏi danh sách gợi ý!`
              : `✅ Đã xóa danh mục "${val || oldVal}" thành công!`),
          data: fresh
        };
      } else if (action === 'RESTORE') {
        const targetToRestore = (val || oldVal).toLowerCase();
        let restored = false;
        for (let i = 0; i < colVals.length; i++) {
          const rawCell = String(colVals[i][0] || "").trim();
          const cleanCell = rawCell.replace(/^\[(HIDDEN|ĐÃ ẨN|AN|_HIDDEN_)\]\s*/i, '').trim();
          if (cleanCell.toLowerCase() === targetToRestore || rawCell.toLowerCase() === targetToRestore) {
            catSheet.getRange(i + 2, targetCol).setValue(cleanCell || val);
            restored = true;
            break;
          }
        }
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        const fresh = getInitialSetupCategories(ss);
        return {
          success: true,
          message: restored
            ? `✅ Đã phục hồi danh mục "${val || oldVal}" thành công!`
            : `⚠️ Không tìm thấy mục "${val || oldVal}" để phục hồi!`,
          data: fresh
        };
      } else if (action === 'UPDATE') {
        let updated = false;
        for (let i = 0; i < colVals.length; i++) {
          if (String(colVals[i][0] || "").trim().toLowerCase() === oldVal.toLowerCase()) {
            catSheet.getRange(i + 2, targetCol).setValue(val);
            updated = true;
            break;
          }
        }
        if (!updated) {
          let emptyRow = -1;
          for (let i = 0; i < colVals.length; i++) {
            if (!String(colVals[i][0] || "").trim()) {
              emptyRow = i + 2;
              break;
            }
          }
          if (emptyRow > 0) catSheet.getRange(emptyRow, targetCol).setValue(val);
          else catSheet.getRange(lastRow + 1, targetCol).setValue(val);
        }
      } else if (action === 'ADD') {
        if (!val) return { success: false, message: "⚠️ Giá trị thêm mới không được để trống!" };
        const normVal = val.toLowerCase();
        let hiddenRow = -1;
        for (let i = 0; i < colVals.length; i++) {
          const cellStr = String(colVals[i][0] || "").trim();
          if (cellStr.toLowerCase() === normVal) {
            return { success: false, message: `⚠️ "${val}" đã tồn tại trong danh sách!` };
          }
          if (isCategoryHidden(cellStr) && cellStr.replace(/^\[(HIDDEN|ĐÃ ẨN|AN|_HIDDEN_)\]\s*/i, '').trim().toLowerCase() === normVal) {
            hiddenRow = i + 2;
          }
        }
        if (hiddenRow > 0) {
          catSheet.getRange(hiddenRow, targetCol).setValue(val);
        } else {
          let emptyRow = -1;
          for (let i = 0; i < colVals.length; i++) {
            if (!String(colVals[i][0] || "").trim()) {
              emptyRow = i + 2;
              break;
            }
          }
          if (emptyRow > 0) catSheet.getRange(emptyRow, targetCol).setValue(val);
          else catSheet.getRange(lastRow + 1, targetCol).setValue(val);
        }
      }
    } else {
      if (action === 'ADD' && val) {
        catSheet.getRange(2, targetCol).setValue(val);
      }
    }

    // Khi thêm mới tài khoản (ACCOUNT), nếu có tên cửa hàng và chưa có trong Cột H (shopCol), tự động thêm shop vào Cột H
    if (type === 'ACCOUNT' && action === 'ADD' && shopPart) {
      try {
        const curLastR = Math.max(catSheet.getLastRow(), 1);
        const shopVals = curLastR >= 2 ? catSheet.getRange(2, shopCol, curLastR - 1, 1).getValues() : [];
        const normShop = shopPart.toLowerCase();
        let shopExists = false;
        let emptyShopRow = -1;
        for (let i = 0; i < shopVals.length; i++) {
          const s = String(shopVals[i][0] || '').trim();
          if (s.toLowerCase() === normShop) {
            shopExists = true;
            break;
          }
          if (!s && emptyShopRow === -1) {
            emptyShopRow = i + 2;
          }
        }
        if (!shopExists) {
          if (emptyShopRow > 0) catSheet.getRange(emptyShopRow, shopCol).setValue(shopPart);
          else catSheet.getRange(curLastR + 1, shopCol).setValue(shopPart);
        }
      } catch(eShop) {}
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const fresh = getInitialSetupCategories(ss);
    return {
      success: true,
      message: `✅ Đã cập nhật danh mục thành công!`,
      data: fresh
    };
  } catch(err) {
    return { success: false, message: "❌ Lỗi cập nhật thiết lập: " + err.toString() };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    autoGenerateFieldMapping,
    parseWalletTemplateCell,
    getInitialSetupCategories,
    getAllBankStatementTemplates,
    saveInitialSetupCategory,
    executeWithLock,
    getAppVersion,
    incrementDataVersion,
    computeWalletLedgerSignature,
    checkAndSyncWalletLedgerChanges,
    getProcessedRequest,
    recordProcessedRequest,
    autoPruneProcessedRequests,
    findRequest,
    saveRequest,
    pruneRequestLogOlderThan7Days,
    clearAppDataCache,
    clearAllWalletStatementCaches: typeof clearAllWalletStatementCaches === 'function' ? clearAllWalletStatementCaches : function() {},
    getCachedAppDataStr,
    setCachedAppDataStr,
    getAppData,
    getFinancialTrendStats
  };
}

