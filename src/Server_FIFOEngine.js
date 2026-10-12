// ==========================================
// FILE: Server_FIFOEngine.js
// NHIỆM VỤ: Engine Phân Bổ Giá Vốn FIFO & Kiểm Toán Tồn Kho
// ==========================================

const SHEET_PURCHASE_FIFO = "Purchase";

/**
 * Kiểm tra tồn kho khả dụng trước khi xuất bán
 */
function validateFIFOAvailability(productName, quantity, warehouse, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const pSheet = ss.getSheetByName(SHEET_PURCHASE_FIFO);
    if (!pSheet || pSheet.getLastRow() < 2) {
      return { available: false, currentStock: 0, message: `Không có tồn kho cho sản phẩm: ${productName}` };
    }

    const lastRow = pSheet.getLastRow();
    const lastCol = Math.max(pSheet.getLastColumn(), 18);
    const pData = pSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const targetSp = String(productName || "").trim().toLowerCase();
    const targetWh = warehouse ? String(warehouse).trim().toLowerCase() : "";
    let totalAvailable = 0;

    for (let i = 0; i < pData.length; i++) {
      const tenSP = String(pData[i][4] || "").trim().toLowerCase();
      if (tenSP !== targetSp) continue;

      const rawWh = String(pData[i][3] || "").trim().toLowerCase();
      const khoHienTai = String(pData[i][13] || pData[i][3] || "").trim().toLowerCase();
      const statusWh = khoHienTai || rawWh;

      // Chỉ lấy hàng đã ở trong kho vật lý (Kho Nhật / Kho VN), bỏ qua Chờ Ship & Hủy
      if (statusWh.includes("hủy") || statusWh.includes("cancel") || statusWh.includes("chờ ship") || statusWh.includes("chusen")) {
        continue;
      }

      if (targetWh && targetWh !== "all" && !statusWh.includes(targetWh) && !rawWh.includes(targetWh)) {
        continue;
      }

      const tonColIdx = 11;
      let curTon = (pData[i][11] !== undefined && pData[i][11] !== null && pData[i][11] !== "") ? (parseBizMoney ? parseBizMoney(pData[i][11]) : Number(pData[i][11])) : (parseBizMoney ? parseBizMoney(pData[i][5]) : Number(pData[i][5] || 0));
      if (curTon > 0) totalAvailable += curTon;
    }

    const reqQty = parseBizMoney ? parseBizMoney(quantity) : Number(quantity);
    return {
      available: true,
      isPartial: (totalAvailable < reqQty),
      currentStock: totalAvailable,
      message: totalAvailable < reqQty ? `Tồn kho khả dụng: ${totalAvailable}/${reqQty}.` : "Đủ tồn kho."
    };

  } catch(err) {
    Logger.log("Lỗi validateFIFOAvailability: " + err.toString());
    return { available: false, currentStock: 0, message: err.toString() };
  }
}

/**
 * Thực hiện khấu trừ FIFO cho một đơn bán hàng và lưu vào SaleCostAllocations với LockService
 * @param {String} saleId Mã đơn bán hàng (SO-xxxxx)
 * @param {String} productName Tên sản phẩm
 * @param {Number} quantity Số lượng bán
 * @param {String} warehouse Kho xuất hàng
 * @param {String} saleDate Ngày bán
 * @param {Spreadsheet} ssTarget Spreadsheet instance
 * @returns {Object} { success: Boolean, totalCOGS: Number, allocations: Array, message: String }
 */
function allocateSaleFIFOCost(saleId, productName, quantity, warehouse, saleDate, ssTarget) {
  let lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
    }
  } catch(e) {
    Logger.log("Warning: Không thể lấy Lock cho FIFO: " + e);
  }

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const pSheet = ss.getSheetByName(SHEET_PURCHASE_FIFO);
    if (!pSheet || pSheet.getLastRow() < 2) {
      return { success: false, totalCOGS: 0, allocations: [], message: "❌ Không tìm thấy Sheet Purchase." };
    }

    const lastRowP = pSheet.getLastRow();
    const lastColP = Math.max(pSheet.getLastColumn(), 18);
    const pRange = pSheet.getRange(2, 1, lastRowP - 1, lastColP);
    const pData = pRange.getValues();

    const targetSp = String(productName || "").trim().toLowerCase();
    const targetWh = warehouse ? String(warehouse).trim().toLowerCase() : "";
    let qtyNeeded = parseBizMoney ? parseBizMoney(quantity) : Number(quantity);

    let totalCOGS = 0;
    const allocations = [];
    const nowIso = new Date().toISOString();
    let pModified = false;

    // Quét các lô mua theo thứ tự hàng từ trên xuống (cũ nhất -> mới nhất)
    for (let i = 0; i < pData.length; i++) {
      if (qtyNeeded <= 0) break;

      const pId = String(pData[i][0] || "").trim() || `PO-ROW-${i + 2}`;
      const tenSP = String(pData[i][4] || "").trim().toLowerCase();
      if (tenSP !== targetSp) continue;

      const rawWh = String(pData[i][3] || "").trim().toLowerCase();
      const khoHienTai = String(pData[i][13] || pData[i][3] || "").trim().toLowerCase();
      const statusWh = khoHienTai || rawWh;

      // Bỏ qua hàng Chờ Ship, Chusen, hoặc đã Hủy
      if (statusWh.includes("hủy") || statusWh.includes("cancel") || statusWh.includes("chờ ship") || statusWh.includes("chusen")) {
        continue;
      }

      // Khớp kho nếu có yêu cầu
      if (targetWh && targetWh !== "all" && !statusWh.includes(targetWh) && !rawWh.includes(targetWh)) {
        continue;
      }

      // Cột tồn kho: Cột 12 (index 11) trong Sheet Purchase
      const tonColIdx = 11;
      let curTon = (pData[i][11] !== "" && pData[i][11] !== null && pData[i][11] !== undefined) ? parseBizMoney(pData[i][11]) : (parseBizMoney(pData[i][5]) || 0);

      if (curTon > 0) {
        const takeQty = Math.min(curTon, qtyNeeded);
        const unitCost = parseBizMoney ? parseBizMoney(pData[i][6]) : Number(pData[i][6] || 0);
        const lotCOGS = Math.round(takeQty * unitCost);

        curTon -= takeQty;
        qtyNeeded -= takeQty;
        totalCOGS += lotCOGS;

        pData[i][tonColIdx] = curTon;
        pModified = true;

        const allocId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("ALC-") : ("ALC-" + Date.now() + "-" + (allocations.length + 1));
        allocations.push([
          allocId,
          String(saleId).trim(),
          pId,
          String(productName).trim(),
          takeQty,
          unitCost,
          lotCOGS,
          "ACTIVE",
          nowIso,
          ""
        ]);
      }
    }

    // 1. Cập nhật tồn kho vào Sheet Purchase
    if (pModified) {
      pRange.setValues(pData);
    }

    return {
      success: true,
      totalCOGS: totalCOGS,
      unallocatedQty: qtyNeeded,
      allocations: allocations,
      message: `✅ Đã phân bổ FIFO thành công cho đơn ${saleId} (COGS = ${totalCOGS} ¥).`
    };

  } catch(err) {
    Logger.log("Lỗi allocateSaleFIFOCost: " + err.toString());
    return { success: false, totalCOGS: 0, allocations: [], message: "❌ Lỗi FIFO: " + err.toString() };
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}

/**
 * Đảo ngược / Rollback phân bổ FIFO khi sửa hoặc hủy đơn bán hàng
 * @param {String} saleId Mã đơn bán hàng cần rollback
 * @param {Spreadsheet} ssTarget Spreadsheet instance
 */
function rollbackSaleFIFOCost(saleId, ssTarget) {
  if (!saleId) return { success: false, message: "❌ Thiếu SaleID để rollback." };

  let lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
    }
  } catch(e) {}

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const aSheet = ss ? (ss.getSheetByName("SaleCostAllocations") || ss.getSheetByName("Allocations")) : null;
    if (!aSheet || aSheet.getLastRow() < 2) {
      return { success: true, message: "Không có bảng allocations để rollback." };
    }

    const aRange = aSheet.getRange(2, 1, aSheet.getLastRow() - 1, 10);
    const aData = aRange.getValues();
    const qtyToRestoreByPurchaseId = {}; // purchaseId -> totalQtyToRestore
    const nowIso = new Date().toISOString();
    let aModified = false;

    for (let i = 0; i < aData.length; i++) {
      const rowSaleId = String(aData[i][1] || "").trim();
      const status = String(aData[i][7] || "").trim().toUpperCase();

      if (rowSaleId === String(saleId).trim() && status === "ACTIVE") {
        const pId = String(aData[i][2] || "").trim();
        const qty = parseBizMoney ? parseBizMoney(aData[i][4]) : Number(aData[i][4] || 0);

        qtyToRestoreByPurchaseId[pId] = (qtyToRestoreByPurchaseId[pId] || 0) + qty;

        // Đổi trạng thái sang REVERSED
        aData[i][7] = "REVERSED";
        aData[i][9] = nowIso; // ReversedAt
        aModified = true;
      }
    }

    if (!aModified) {
      return { success: true, message: "Không tìm thấy allocation ACTIVE nào cần rollback." };
    }

    // Cập nhật trạng thái Allocation
    aRange.setValues(aData);

    // Hoàn trả tồn kho về Sheet Purchase
    const pSheet = ss.getSheetByName(SHEET_PURCHASE_FIFO);
    if (pSheet && pSheet.getLastRow() >= 2) {
      const pRange = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 18));
      const pData = pRange.getValues();
      let pModified = false;

      for (let i = 0; i < pData.length; i++) {
        const pId = String(pData[i][0] || "").trim() || `PO-ROW-${i + 2}`;
        if (qtyToRestoreByPurchaseId[pId]) {
          const restoreQty = qtyToRestoreByPurchaseId[pId];
          const tonColIdx = 11;
          let curTon = (pData[i][11] !== "" && pData[i][11] !== null && pData[i][11] !== undefined) ? parseBizMoney(pData[i][11]) : (parseBizMoney(pData[i][5]) || 0);

          pData[i][tonColIdx] = curTon + restoreQty;
          pModified = true;
          delete qtyToRestoreByPurchaseId[pId];
        }
      }

      if (pModified) {
        pRange.setValues(pData);
      }
    }

    return {
      success: true,
      message: `✅ Đã rollback toàn bộ FIFO và phục hồi tồn kho cho đơn bán: ${saleId}`
    };

  } catch(err) {
    Logger.log("Lỗi rollbackSaleFIFOCost: " + err.toString());
    return { success: false, message: "❌ Lỗi rollback FIFO: " + err.toString() };
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}
