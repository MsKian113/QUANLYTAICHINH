// ==========================================
// 1. CẤU TRÚC GIAO DIỆN & HÀM TIỆN ÍCH
// ==========================================


// Hàm hỗ trợ nhúng file HTML con vào file Index
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "";
  if (action === "syncToVercel") {
    const res = syncKianDataToVercel();
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput("Kian Sync Service Active");
}

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
    const pSheet = ss.getSheetByName("Purchase");
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
                         (nameClean.includes("rakuten") && !nameClean.includes("rakub") && !nameClean.includes("rakuten bank")) || 
                         nameClean.includes("jcb") || nameClean.includes("master") || 
                         nameClean.includes("trả sau") || nameClean.startsWith("c-") || nameClean.startsWith("c_") || 
                         nameClean.includes("bic chi") || 
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

/**
 * HÀM ĐỒNG BỘ BỔ SỘ CÁC ĐƠN PRE-ORDER LỊCH SỬ TỪ PURCHASE & FAMILY VÀO WALLETLEDGER
 * Hiển thị trực tiếp ở menu dropdown của file Code.gs trong Apps Script Editor
 */
function runSyncHistoricalPreOrders() {
  return syncMissingHistoricalPreOrdersToLedger();
}

/**
 * TRIGGER TỰ ĐỘNG PHÁT HIỆN THAY ĐỔI TRỰC TIẾP TRÊN GOOGLE SHEETS (ĐẶC BIỆT LÀ SHEET WALLETLEDGER)
 * Tự động xóa cache cũ, cập nhật chữ ký WalletLedger và tăng DATA_VERSION để Web App tự refresh dữ liệu.
 */
function onEdit(e) {
  try {
    const sheet = e && e.range && typeof e.range.getSheet === 'function' ? e.range.getSheet() : null;
    const sheetName = sheet && typeof sheet.getName === 'function' ? String(sheet.getName() || "").trim() : "";

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof clearAllWalletStatementCaches === 'function') {
      try { clearAllWalletStatementCaches(); } catch (err) {}
    }
    if (typeof incrementDataVersion === 'function') {
      try { incrementDataVersion(); } catch (err) {}
    }
    if ((!sheetName || sheetName === "WalletLedger") && typeof checkAndSyncWalletLedgerChanges === 'function') {
      const ss = (e && e.source) || (sheet && typeof sheet.getParent === 'function' ? sheet.getParent() : null);
      try { checkAndSyncWalletLedgerChanges(ss, true); } catch (err) {}
    }
  } catch (err) {}
}

/**
 * TẠO MENU TRÊN GOOGLE SHEETS CỦA KIAN ĐỂ ĐẨY DỮ LIỆU SANG VERCEL
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🚀 Vercel Cloud')
      .addItem('📋 Chỉ đẩy Categories & Mẫu Thu Chi sang Vercel (db-kian)', 'syncKianCategoriesToVercel')
      .addItem('⚡ Đẩy toàn bộ dữ liệu sang Vercel (db-kian)', 'syncKianDataToVercel')
      .addToUi();
  } catch (err) {}
}

function extractCategoriesFromSheet(ss) {
  const categories = [];
  const catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc");
  if (catSheet && catSheet.getLastRow() >= 2) {
    const data = catSheet.getRange(2, 1, catSheet.getLastRow() - 1, Math.max(catSheet.getLastColumn(), 10)).getValues();
    data.forEach(r => {
      if (r[0]) categories.push({ type: 'PARTNER', name: String(r[0]).trim() });
      const tpl = String(r[1] || '').replace(/\s+/g, ' ').trim();
      const mapHu = String(r[2] || '').replace(/\s+/g, ' ').trim();
      const mapSrc = String(r[3] || '').replace(/\s+/g, ' ').trim();
      if (tpl && !['Nội dung', 'Nội dung mẫu', 'Tên Mẫu', 'Mẫu Nội Dung Thu Chi'].includes(tpl)) {
        categories.push({
          type: 'TEMPLATE',
          name: tpl,
          content_template: tpl,
          auto_hu_name: mapHu,
          auto_wallet_name: mapSrc
        });
      }
      if (r[5]) categories.push({ type: 'WAREHOUSE', name: String(r[5]).trim() });
      if (r[6]) categories.push({ type: 'ACCOUNT', name: String(r[6]).trim() });
      if (r[7]) categories.push({ type: 'SHOP', name: String(r[7]).trim() });
    });
  }
  return categories;
}

/**
 * CHỈ ĐẨY TAB CATEGORIES (ĐỐI TÁC, MẪU THU CHI, KHO, TK, CỬA HÀNG) SANG VERCEL (KHÔNG GHI ĐÈ GIAO DỊCH)
 */
function syncKianCategoriesToVercel() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}
  if (!ss) {
    try {
      ss = SpreadsheetApp.openById("1BqVjW1-C3VjLQK-wx2JvKgLAsSELd_j2wfWm73bpw04");
    } catch (err) {}
  }
  if (!ss) return { success: false, message: "Không tìm thấy Spreadsheet của Kian" };

  const categories = extractCategoriesFromSheet(ss);
  const payload = {
    secret: "kian_migrate_2026",
    tenant: "kian",
    data: { categories: categories }
  };

  const response = UrlFetchApp.fetch("https://qlytaichinh.vercel.app/api/import", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const resJson = JSON.parse(response.getContentText());
  Logger.log("Vercel Categories Import Result: " + JSON.stringify(resJson));
  try {
    SpreadsheetApp.getUi().alert("Kết quả đồng bộ Categories & Mẫu Thu Chi:\n" + JSON.stringify(resJson, null, 2));
  } catch (e) {}
  return resJson;
}

/**
 * HÀM ĐẨY TOÀN BỘ DỮ LIỆU KIAN TỪ GOOGLE SPREADSHEET SANG VERCEL DATABASE (db-kian)
 */
function syncKianDataToVercel() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}
  if (!ss) {
    try {
      ss = SpreadsheetApp.openById("1BqVjW1-C3VjLQK-wx2JvKgLAsSELd_j2wfWm73bpw04");
    } catch (err) {}
  }
  if (!ss) return { success: false, message: "Không tìm thấy Spreadsheet của Kian" };

  // Helper format ngày chuẩn YYYY-MM-DD
  function toDateStr(val) {
    if (!val) return "";
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return "";
      const y = val.getFullYear();
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const d = String(val.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(val).trim();
  }

  function fmtField(val) {
    if (val === null || val === undefined) return "";
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return "";
      const day = String(val.getDate()).padStart(2, '0');
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const y = val.getFullYear();
      return `${day}/${m}/${y}`;
    }
    return String(val).trim();
  }

  function fmtExp(val) {
    if (val === null || val === undefined) return "";
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return "";
      const m = String(val.getMonth() + 1).padStart(2, '0');
      const y = String(val.getFullYear()).slice(-2);
      return m + "/" + y;
    }
    return String(val).trim();
  }

  function decryptField(val) {
    if (!val) return "";
    const s = String(val).trim();
    if (typeof decryptCardField === 'function') {
      try {
        return decryptCardField(s);
      } catch(e) {
        return s;
      }
    }
    return s;
  }

  // 1. Wallets
  const wallets = [];
  const wSheet = ss.getSheetByName("DANH_SACH_VI") || ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
  if (wSheet && wSheet.getLastRow() >= 2) {
    const lastCol = Math.max(wSheet.getLastColumn(), 25);
    const data = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, lastCol).getValues();
    data.forEach((r, index) => {
      const rowNum = index + 2;
      const name = String(r[1] || '').trim();
      if (name) {
        const isCredit = String(r[2] || 'DEBIT').trim().toUpperCase() === 'CREDIT' || name.startsWith('C-');
        const limit = Number(r[3] || 0);
        const initBal = Number(r[6] || 0);
        const inc = Number(r[7] || 0);
        const dec = Number(r[8] || 0);
        const preorder = Number(r[9] || 0);
        const curBal = Number(r[10] || 0);

        // Tính nợ (debt) cho thẻ tín dụng
        let debt = 0;
        if (isCredit) {
          if (dec > 0 || inc > 0) {
            debt = Math.max(0, dec - inc);
          } else if (curBal < 0) {
            debt = Math.abs(curBal);
          } else if (initBal < 0) {
            debt = Math.abs(initBal);
          } else {
            debt = 0;
          }
        }

        // Với thẻ tín dụng: current_balance là Khả Dụng (KD) = Limit - Debt - Preorder
        // Với thẻ ghi nợ/tiền mặt: current_balance là Số dư thực tế trong tài khoản
        const finalBalance = isCredit
          ? (limit > 0 ? Math.max(0, limit - debt - preorder) : curBal)
          : (curBal !== 0 ? curBal : (initBal + inc - dec));

        const closingDate = fmtField(r[4]);
        const dueDate = fmtField(r[5]);
        const settleSource = String(r[11] || '').trim();

        const cardNum = decryptField(fmtField(r[14]));
        const cardExp = decryptField(fmtExp(r[15]));
        const cardCvv = decryptField(fmtField(r[16]));

        let stmtFileH = "";
        let stmtPasteH = "";
        if (r.length >= 22 && r[21]) {
          const pV = (typeof parseWalletTemplateCell === 'function') ? parseWalletTemplateCell(r[21]) : null;
          if (pV && Array.isArray(pV.headers)) stmtFileH = pV.headers.join(', ');
          else if (typeof r[21] === 'string') stmtFileH = r[21];
        }
        if (r.length >= 23 && r[22]) {
          const pW = (typeof parseWalletTemplateCell === 'function') ? parseWalletTemplateCell(r[22]) : null;
          if (pW && Array.isArray(pW.headers)) stmtPasteH = pW.headers.join(', ');
          else if (typeof r[22] === 'string') stmtPasteH = r[22];
        }

        wallets.push({
          id: String(r[0] || ('w_' + Date.now() + '_' + index)),
          name: name,
          type: isCredit ? 'CREDIT' : 'DEBIT',
          credit_limit: isCredit ? limit : 0,
          current_balance: finalBalance,
          debt: debt,
          preorder: preorder,
          initial_balance: initBal,
          total_increase: inc,
          total_decrease: dec,
          status: String(r[13] || 'ACTIVE'),
          closing_date: closingDate,
          due_date: dueDate,
          settle_source: settleSource,
          card_number: cardNum,
          card_exp: cardExp,
          card_cvv: cardCvv,
          stmt_file_headers: stmtFileH,
          stmt_paste_headers: stmtPasteH
        });
      }

      // THẺ ẢO (Cột R..U: idx 17, 18, 19, 20)
      const rawVName = fmtField(r[17]);
      const rawVNum  = fmtField(r[18]);
      const rawVExp  = fmtExp(r[19]);
      const rawVCvv  = fmtField(r[20]);

      const vCardName = decryptField(rawVName);
      const vCardNum  = decryptField(rawVNum);
      const vCardExp  = decryptField(rawVExp);
      const vCardCvv  = decryptField(rawVCvv);

      if (vCardName || vCardNum || vCardExp || vCardCvv) {
        wallets.push({
          id: "VC_" + rowNum,
          name: vCardName || ("Thẻ Ảo R" + rowNum),
          type: "VIRTUAL",
          credit_limit: 0,
          current_balance: 0,
          debt: 0,
          preorder: 0,
          initial_balance: 0,
          total_increase: 0,
          total_decrease: 0,
          status: "ACTIVE",
          closing_date: "",
          due_date: "",
          settle_source: "",
          card_number: vCardNum || "",
          card_exp: vCardExp || "",
          card_cvv: vCardCvv || "",
          stmt_file_headers: "",
          stmt_paste_headers: ""
        });
      }
    });
  }

  // 2. Family
  const family = [];
  const fSheet = ss.getSheetByName("Family");
  if (fSheet && fSheet.getLastRow() >= 2) {
    const data = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, Math.max(fSheet.getLastColumn(), 10)).getValues();
    data.forEach(r => {
      if (r[0]) {
        family.push({
          id: String(r[0]),
          date: toDateStr(r[1]),
          type: String(r[2] || ''),
          hu: String(r[3] || ''),
          content: String(r[4] || ''),
          amount: Number(r[5] || 0),
          wallet_name: String(r[6] || ''),
          is_fixed: r[7] === "Có" || r[7] === true,
          note: String(r[8] || ''),
          status: String(r[9] || 'ACTIVE')
        });
      }
    });
  }

  // 3. Orders (Purchase)
  // Schema: A: ID | B: Ngày Mua | C: Nơi Mua | D: Kho | E: Tên SP | F: SL | G: Giá | H: Tổng | I: Nguồn Tiền | J: Trạng Thái Thẻ | K: Ghi Chú | L: Tồn Kho | R: OrderStatus | S: IsDeleted
  const orders = [];
  const pSheet = ss.getSheetByName("Purchase");
  if (pSheet && pSheet.getLastRow() >= 2) {
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 19)).getValues();
    data.forEach(r => {
      if (r[0] || r[4]) {
        const qty = Number(r[5] || 0);
        const price = Number(r[6] || 0);
        const total = Number(r[7] || 0) || (qty * price);
        orders.push({
          id: String(r[0]),
          date: toDateStr(r[1]),
          shop: String(r[2] || ''),
          warehouse: String(r[3] || ''),
          product_name: String(r[4] || ''),
          quantity: qty,
          unit_price: price,
          total_amount: total,
          inventory_remaining: Number(r[11] || 0),
          wallet_name: String(r[8] || ''),
          status: String(r[9] || ''),
          note: String(r[10] || ''),
          account: String(r[13] || ''),
          order_status: String(r[17] || 'HOAN_TAT'),
          is_deleted: r[18] === true || String(r[18]).trim().toUpperCase() === 'TRUE'
        });
      }
    });
  }

  // 4. Debts
  // Schema: A: ID | B: Ngày Ghi Nợ | C: Tên Đối Tượng | D: Loại Nợ | E: Nội dung | F: Tổng Tiền Nợ | G: Nguồn | H: Đã TT | I: Ngày TT | J: Dư Nợ Còn Lại | K: Trạng Thái
  const debts = [];
  const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("Debts");
  if (dSheet && dSheet.getLastRow() >= 2) {
    const data = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, Math.max(dSheet.getLastColumn(), 11)).getValues();
    data.forEach(r => {
      if (r[0] || r[2]) {
        debts.push({
          id: String(r[0] || ('d_' + Date.now())),
          date: toDateStr(r[1]),
          name: String(r[2] || ''),
          type: String(r[3] || ''),
          content: String(r[4] || ''),
          amount: Number(r[5] || 0),
          wallet_name: String(r[6] || ''),
          remaining_debt: Number(r[9] || 0),
          status: String(r[10] || 'ACTIVE'),
          note: String(r[8] || '')
        });
      }
    });
  }

  // 5. Categories (A: Đối tác, B: Mẫu Nội Dung Thu Chi, C: Tự động Map Hũ, D: Tự động Map Nguồn, F: Kho, G: Tài khoản, H: Cửa hàng)
  const categories = extractCategoriesFromSheet(ss);

  // 6. Sales
  const sales = [];
  const sSheet = ss.getSheetByName("Sales") || ss.getSheetByName("BanHang");
  if (sSheet && sSheet.getLastRow() >= 2) {
    const data = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, Math.max(sSheet.getLastColumn(), 15)).getValues();
    data.forEach(r => {
      if (r[0] || r[2]) {
        const qty = Number(r[4] || 0);
        const price = Number(r[5] || 0);
        const total = Number(r[6] || 0) || (qty * price);
        sales.push({
          id: String(r[0] || ('s_' + Date.now())),
          date: toDateStr(r[1]),
          product_name: String(r[2] || ''),
          warehouse: String(r[3] || ''),
          quantity: qty,
          unit_price: price,
          total_amount: total,
          wallet_name: String(r[8] || ''),
          status: String(r[9] || 'HOAN_TAT'),
          note: String(r[10] || ''),
          cogs: Number(r[11] || 0),
          order_status: String(r[13] || 'HOAN_TAT'),
          is_deleted: r[14] === true || String(r[14]).trim().toUpperCase() === 'TRUE'
        });
      }
    });
  }

  // 7. Split Families (Tab 7)
  const split_families = [];
  const sfSheet = ss.getSheetByName("SplitFamilies");
  if (sfSheet && sfSheet.getLastRow() >= 2) {
    const data = sfSheet.getRange(2, 1, sfSheet.getLastRow() - 1, Math.max(sfSheet.getLastColumn(), 8)).getValues();
    data.forEach((r, idx) => {
      const famId = String(r[0] || '').trim();
      const famName = String(r[1] || '').trim();
      const memId = String(r[2] || ('MEB-' + idx)).trim();
      const memName = String(r[3] || '').trim();
      if (!famId && !famName && !memName) return;
      split_families.push({
        id: (famId || 'FAM') + '_' + memId,
        family_id: famId,
        family_name: famName,
        member_id: memId,
        member_name: memName,
        member_type: String(r[4] || 'ADULT').toUpperCase(),
        weight: Number(r[5]) || 1.0,
        is_me: r[6] === true || String(r[6]).toLowerCase() === 'true',
        is_rep: r[7] === true || String(r[7]).toLowerCase() === 'true',
        sort_order: idx
      });
    });
  }

  // 8. Split Groups (Tab 7)
  const split_groups = [];
  const sgSheet = ss.getSheetByName("SplitGroups");
  if (sgSheet && sgSheet.getLastRow() >= 2) {
    const data = sgSheet.getRange(2, 1, sgSheet.getLastRow() - 1, Math.max(sgSheet.getLastColumn(), 15)).getValues();
    const grpMap = {};
    data.forEach(r => {
      const id = String(r[0] || '').trim();
      if (!id) return;
      const col6Str = String(r[6] || '').trim();
      if (col6Str.startsWith('[') || col6Str.startsWith('{')) {
        let mems = [];
        try { mems = JSON.parse(col6Str); } catch(e) {}
        if (!grpMap[id]) {
          grpMap[id] = {
            id: id,
            name: String(r[1] || id).trim(),
            currency: String(r[2] || 'JPY').trim(),
            created_at: toDateStr(r[3]),
            note: String(r[4] || '').trim(),
            status: String(r[5] || 'OPEN').trim().toUpperCase(),
            category: String(r[7] || 'TRIP').trim().toUpperCase(),
            members: mems
          };
        }
        return;
      }
      if (!grpMap[id]) {
        grpMap[id] = {
          id: id,
          name: String(r[2] || id).trim(),
          category: String(r[1] || 'TRIP').trim().toUpperCase(),
          currency: String(r[3] || 'JPY').trim(),
          status: String(r[4] || 'OPEN').trim().toUpperCase(),
          created_at: toDateStr(r[5]),
          note: '',
          members: []
        };
      }
      const memName = String(r[8] || '').trim();
      if (memName) {
        grpMap[id].members.push({
          id: String(r[7] || r[6] || ('m_' + grpMap[id].members.length)).trim(),
          groupMemberId: String(r[6] || '').trim(),
          name: memName,
          familyId: String(r[9] || '').trim(),
          family: String(r[10] || '').trim(),
          type: String(r[11] || 'ADULT').toUpperCase(),
          weight: Number(r[12]) || 1.0,
          sortOrder: Number(r[13]) || 99,
          status: String(r[14] || 'ACTIVE').toUpperCase()
        });
      }
    });
    Object.values(grpMap).forEach(g => split_groups.push(g));
  }

  // 9. Split Expenses (Tab 7)
  const split_expenses = [];
  const seSheet = ss.getSheetByName("SplitExpenses");
  if (seSheet && seSheet.getLastRow() >= 2) {
    const data = seSheet.getRange(2, 1, seSheet.getLastRow() - 1, Math.max(seSheet.getLastColumn(), 16)).getValues();
    const expMap = {};
    data.forEach(r => {
      const id = String(r[0] || '').trim();
      const gId = String(r[1] || '').trim();
      if (!id) return;
      const col8Str = String(r[8] || '').trim();
      if (col8Str.startsWith('[') || col8Str.startsWith('{')) {
        let parts = [];
        try { parts = JSON.parse(col8Str); } catch(e) {}
        let stls = [];
        try { if (r[9]) stls = JSON.parse(r[9]); } catch(e) {}
        if (!expMap[id]) {
          expMap[id] = {
            id: id,
            group_id: gId,
            date: toDateStr(r[2]),
            description: String(r[3] || '').trim(),
            amount: Number(r[4]) || 0,
            payer_id: String(r[5] || '').trim(),
            wallet_name: String(r[6] || '').trim(),
            split_type: String(r[7] || 'WEIGHT').trim().toUpperCase(),
            round_unit: 1,
            status: 'ACTIVE',
            participants: parts,
            settlements: stls
          };
        }
        return;
      }
      if (!expMap[id]) {
        expMap[id] = {
          id: id,
          group_id: gId,
          date: toDateStr(r[2]),
          description: String(r[3] || '').trim(),
          amount: Number(r[4]) || 0,
          payer_id: String(r[5] || '').trim(),
          payer_name: String(r[6] || '').trim(),
          wallet_name: String(r[7] || '').trim(),
          split_type: String(r[8] || 'WEIGHT').trim().toUpperCase(),
          round_unit: Number(r[9]) || 1,
          status: String(r[15] || 'ACTIVE').trim().toUpperCase(),
          participants: [],
          settlements: []
        };
      }
      const splitMemberName = String(r[11] || '').trim();
      if (splitMemberName) {
        expMap[id].participants.push({
          memberId: String(r[10] || '').trim(),
          memberName: splitMemberName,
          inputValue: Number(r[12]) || 0,
          calculatedAmount: Number(r[13]) || 0,
          note: String(r[14] || '').trim()
        });
      }
    });
    Object.values(expMap).forEach(e => split_expenses.push(e));
  }

  // 10. Supplies (Tab 8)
  const supplies = [];
  const supSheet = ss.getSheetByName("Supplies") || ss.getSheetByName("HoaMyPham") || ss.getSheetByName("DoDung");
  if (supSheet && supSheet.getLastRow() >= 2) {
    const data = supSheet.getRange(2, 1, supSheet.getLastRow() - 1, Math.max(supSheet.getLastColumn(), 4)).getValues();
    data.forEach((r, idx) => {
      const name = String(r[0] || '').trim();
      if (!name || name === "Tên món") return;
      supplies.push({
        name: name,
        category: String(r[1] || 'Khác').trim() || 'Khác',
        current_qty: Number(r[2]) || 0,
        min_qty: Number(r[3]) || 0,
        sort_order: idx + 1
      });
    });
  }

  // 11. Wallet Ledger (Sổ Cái)
  const ledger = [];
  const lSheet = ss.getSheetByName("WalletLedger");
  if (lSheet && lSheet.getLastRow() >= 2) {
    const data = lSheet.getRange(2, 1, lSheet.getLastRow() - 1, Math.max(lSheet.getLastColumn(), 16)).getValues();
    data.forEach((r, idx) => {
      const id = String(r[0] || ('LEDG_' + (idx + 2))).trim();
      const wName = String(r[2] || '').trim();
      if (!wName) return;
      ledger.push({
        id: id,
        wallet_id: String(r[1] || '').trim(),
        wallet_name: wName,
        transaction_date: toDateStr(r[3]),
        amount: Number(r[4]) || 0,
        direction: String(r[5] || '').trim(),
        effect_type: String(r[6] || '').trim(),
        source_module: String(r[7] || '').trim(),
        order_id: String(r[8] || '').trim(),
        event_type: String(r[9] || '').trim(),
        idempotency_key: String(r[10] || '').trim(),
        status: String(r[11] || 'POSTED').trim(),
        note: String(r[12] || '').trim(),
        statement_date: toDateStr(r[14]),
        checkpoint_ref: String(r[15] || '').trim()
      });
    });
  }

  // 12. Wallet Checkpoints
  const checkpoints = [];
  const cpSheet = ss.getSheetByName("WalletCheckpoints") || ss.getSheetByName("ChotSo");
  if (cpSheet && cpSheet.getLastRow() >= 2) {
    const data = cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, Math.max(cpSheet.getLastColumn(), 6)).getValues();
    data.forEach(r => {
      const wName = String(r[2] || r[1] || '').trim();
      if (!wName) return;
      checkpoints.push({
        wallet_name: wName,
        checkpoint_date: toDateStr(r[3]),
        checkpoint_balance: Number(r[4]) || 0
      });
    });
  }

  // 13. Bank Reconciliations
  const reconciliations = [];
  const recSheet = ss.getSheetByName("BankReconciliations");
  if (recSheet && recSheet.getLastRow() >= 2) {
    const data = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, Math.max(recSheet.getLastColumn(), 13)).getValues();
    data.forEach(r => {
      const bId = String(r[0] || '').trim();
      if (!bId) return;
      reconciliations.push({
        batch_id: bId,
        wallet_name: String(r[1] || '').trim(),
        reconciled_at: toDateStr(r[2]),
        reconciled_by: String(r[3] || 'User').trim(),
        bank_signature: String(r[4] || '').trim(),
        app_tx_id: String(r[5] || '').trim(),
        match_type: String(r[6] || 'EXACT').trim(),
        status: String(r[7] || 'MATCHED').trim(),
        bank_date: toDateStr(r[8]),
        bank_amount: Number(r[9]) || 0,
        app_date: toDateStr(r[10]),
        app_amount: Number(r[11]) || 0,
        notes: String(r[12] || '').trim()
      });
    });
  }

  // 14. Stock Transfers
  const stock_transfers = [];
  const ckSheet = ss.getSheetByName("STOCK_TRANSFER") || ss.getSheetByName("ChuyenKho");
  if (ckSheet && ckSheet.getLastRow() >= 2) {
    const data = ckSheet.getRange(2, 1, ckSheet.getLastRow() - 1, Math.max(ckSheet.getLastColumn(), 9)).getValues();
    data.forEach(r => {
      const id = String(r[0] || '').trim();
      if (!id) return;
      stock_transfers.push({
        id: id,
        transfer_date: toDateStr(r[1]),
        order_id: String(r[2] || '').trim(),
        product_name: String(r[3] || '').trim(),
        from_warehouse: String(r[4] || '').trim(),
        to_warehouse: String(r[5] || '').trim(),
        quantity: Number(r[6]) || 1,
        created_by: String(r[7] || 'Admin').trim(),
        note: String(r[8] || '').trim()
      });
    });
  }

  // 15. Jars
  const jars = [];
  const jarSheet = ss.getSheetByName("JAR") || ss.getSheetByName("Jar") || ss.getSheetByName("jar");
  if (jarSheet && jarSheet.getLastRow() >= 2) {
    const lastCol = jarSheet.getLastColumn();
    const lastRow = jarSheet.getLastRow();
    const allData = jarSheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = allData[1] || allData[0] || [];
    for (let c = 1; c < headers.length; c++) {
      const mVal = parseInt(headers[c], 10);
      if (mVal >= 1 && mVal <= 12) {
        let investAmt = 60000;
        let pctThietyeu = 55, pctTietkiem = 10, pctGiaoduc = 10, pctGiaitri = 10, pctChodi = 5;
        for (let r = 0; r < allData.length; r++) {
          const label = String(allData[r][0] || '').toLowerCase();
          const cell = allData[r][c];
          let val = Number(cell);
          if (!isNaN(val) && val > 0) {
            if (val <= 1) val = Math.round(val * 100);
            if (label.includes('thiết yếu')) pctThietyeu = val;
            else if (label.includes('tiết kiệm')) pctTietkiem = val;
            else if (label.includes('giáo dục')) pctGiaoduc = val;
            else if (label.includes('giải trí')) pctGiaitri = val;
            else if (label.includes('cho đi')) pctChodi = val;
            else if (label.includes('đầu tư')) investAmt = Number(cell) || 60000;
          }
        }
        jars.push({
          month: mVal,
          year: new Date().getFullYear(),
          invest_amount: investAmt,
          pct_thietyeu: pctThietyeu,
          pct_tietkiem: pctTietkiem,
          pct_giaoduc: pctGiaoduc,
          pct_giaitri: pctGiaitri,
          pct_chodi: pctChodi
        });
      }
    }
  }

  const payload = {
    secret: "kian_migrate_2026",
    tenant: "kian",
    data: {
      wallets: wallets,
      family: family,
      orders: orders,
      debts: debts,
      categories: categories,
      sales: sales,
      split_families: split_families,
      split_groups: split_groups,
      split_expenses: split_expenses,
      supplies: supplies,
      ledger: ledger,
      checkpoints: checkpoints,
      reconciliations: reconciliations,
      stock_transfers: stock_transfers,
      jars: jars
    }
  };

  const response = UrlFetchApp.fetch("https://qlytaichinh.vercel.app/api/import", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const resJson = JSON.parse(response.getContentText());
  Logger.log("Vercel Import Result: " + JSON.stringify(resJson));
  try {
    SpreadsheetApp.getUi().alert("Kết quả đẩy dữ liệu sang Vercel:\n" + JSON.stringify(resJson, null, 2));
  } catch(e) {}
  return resJson;
}


