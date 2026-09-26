// ==========================================
// 1. CẤU TRÚC GIAO DIỆN & HÀM TIỆN ÍCH
// ==========================================


// Hàm hỗ trợ nhúng file HTML con vào file Index
function include(filename) {
  try {
    return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
  } catch (e) {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  }
}


/**
 * HÀM CHUẨN HÓA TOÀN BỘ DATABASE THEO BỘ 7 TRẠNG THÁI CHUẨN
 * Hiển thị ngay ở menu thả xuống mặc định của Apps Script (Code.gs)
 */
function standardizeAllSheetStatuses() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    let updatedCountP = 0;
    let updatedCountF = 0;
    let updatedCountD = 0;

    // 1. Standardize Sheet Purchase (13 columns)
    const pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("MuaHang");
    if (pSheet && pSheet.getLastRow() >= 2) {
      const lastColP = Math.max(pSheet.getLastColumn(), 13);
      const pRange = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP);
      const pData = pRange.getValues();
      let pChanged = false;

      for (let i = 0; i < pData.length; i++) {
        const row = pData[i];
        const wh = String(row[3] || "").trim();
        const lowerWh = wh.toLowerCase();
        const nguonTien = String(row[8] || "").trim();
        const cardStatus = String(row[9] || "").trim();
        const lowerCardStatus = cardStatus.toLowerCase();
        const ghiChu = String(row[10] || "").trim();
        const lowerGhiChu = ghiChu.toLowerCase();

        const nameClean = nguonTien.toLowerCase();
        const isCredit = nameClean.includes("credit") || nameClean.includes("tín dụng") || nameClean.includes("thẻ visa") || 
                         nameClean.includes("rakuten") || nameClean.includes("jcb") || nameClean.includes("master") || 
                         nameClean.includes("trả sau") || nameClean.startsWith("c-") || nameClean.startsWith("c_") || 
                         nameClean.includes("rakub") || nameClean.includes("bic chi") || 
                         nameClean.includes("amazon chi");

        let targetStatus = cardStatus;

        if (lowerWh.includes("hủy") || lowerWh.includes("bị hủy") || lowerWh.includes("cancel")) {
          if (lowerWh.includes("hoàn") || lowerCardStatus.includes("hoàn")) {
            targetStatus = "ĐÃ HOÀN TIỀN";
          } else if (lowerWh.includes("chờ hoàn")) {
            targetStatus = "Hủy";
          } else {
            targetStatus = "Hủy";
          }
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

    // 2. Standardize Sheet Family (11 columns)
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

    // 3. Standardize Sheet Debt (13 columns: Col K = Trạng Thái dư nợ, Col L = Trạng thái thẻ, Col M = Ngày sao kê)
    const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
    if (dSheet && dSheet.getLastRow() >= 2) {
      const lastColD = Math.max(dSheet.getLastColumn(), 13);
      const dRange = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, lastColD);
      const dData = dRange.getValues();
      let dChanged = false;

      for (let i = 0; i < dData.length; i++) {
        const row = dData[i];
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

    return {
      success: true,
      message: `✅ Đã chuẩn hóa toàn bộ database theo 7 trạng thái chuẩn (Purchase: ${updatedCountP}, Family: ${updatedCountF}, Debt: ${updatedCountD})!`
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi chuẩn hóa database: " + err.toString() };
  }
}
