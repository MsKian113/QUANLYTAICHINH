// ==========================================
// FILE: Server_Tab4.js
// NHIỆM VỤ: Backend Logic cho Tab 4 (Công Nợ - Debt)
// Schema Sheet Debt: A: ID | B: Ngày Ghi Nợ | C: Tên Đối Tượng | D: Loại Nợ | E: Nội dung | F: Tổng Tiền Nợ | G: Nguồn | H: Đã Thanh Toán | I: Ngày thanh toán | J: Dư Nợ Còn Lại | K: Trạng Thái
// ==========================================

const SHEET_DEBT = "Debt";

/**
 * Helper parse số tiền an toàn
 */
function parseDebtMoney(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;
  const cleanStr = str.replace(/[^0-9-]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

function formatDebtDateServer(val) {
  if (!val) {
    const d = new Date();
    return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d, "Asia/Tokyo", "dd/MM/yyyy") : String(d.getDate()).padStart(2, '0') + "/" + String(d.getMonth() + 1).padStart(2, '0') + "/" + d.getFullYear();
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(val, "Asia/Tokyo", "dd/MM/yyyy") : String(val.getDate()).padStart(2, '0') + "/" + String(val.getMonth() + 1).padStart(2, '0') + "/" + val.getFullYear();
  }
  const str = String(val).trim();
  if (!str) return "";

  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
    const parts = str.split(' ')[0].split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${d}/${m}/${y}`;
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.split(' ')[0].split('-');
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d, "Asia/Tokyo", "dd/MM/yyyy") : String(d.getDate()).padStart(2, '0') + "/" + String(d.getMonth() + 1).padStart(2, '0') + "/" + d.getFullYear();
    }
  } catch(e) {}

  return str;
}

/**
 * 1. LẤY DỮ LIỆU CÔNG NỢ & DANH SÁCH ĐỐI TÁC GỢI Ý
 */
function getTab4Data(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? (ss.getSheetByName(SHEET_DEBT) || ss.getSheetByName("CongNo")) : null;

    let debts = [];
    let partners = [];

    // Lấy danh sách tên đối tác gợi ý từ Sheet Categories (Cột A hoặc H)
    const catSheet = ss ? (ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc")) : null;
    if (catSheet && catSheet.getLastRow() >= 2) {
      const cData = catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 1).getValues();
      cData.forEach(r => {
        const pName = String(r[0] || "").trim();
        if (pName && !partners.includes(pName)) {
          partners.push(pName);
        }
      });
    }

    if (sheet && sheet.getLastRow() >= 2) {
      const lastCol = Math.max(sheet.getLastColumn(), 11);
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

      data.forEach((r, idx) => {
        const id = String(r[0] || "").trim();
        if (!id) return;

        const pName = String(r[2] || "").trim();
        if (pName && !partners.includes(pName)) {
          partners.push(pName);
        }

        const tongNo = parseDebtMoney(r[5]);
        const daTra = parseDebtMoney(r[7]);
        let duNo = r[9] !== "" && r[9] !== null && r[9] !== undefined ? parseDebtMoney(r[9]) : Math.max(0, tongNo - daTra);
        let trangThai = String(r[10] || "").trim().toUpperCase();
        if (!trangThai) {
          trangThai = duNo <= 0 ? "HOAN_TAT" : "DANG_NO";
        }

        let ngayGhiNo = formatDebtDateServer(r[1]);
        let ngayThanhToan = formatDebtDateServer(r[8]);

        debts.push({
          row: idx + 2,
          id: id,
          ngay: ngayGhiNo,
          ten: pName,
          loai: String(r[3] || "THU").trim().toUpperCase(),
          noidung: String(r[4] || "").trim(),
          tongNo: tongNo,
          nguon: String(r[6] || "").trim(),
          daTra: daTra,
          ngayTra: ngayThanhToan,
          duNo: duNo,
          trangThai: trangThai
        });
      });
    }

    let totalReceivables = 0; // Ai nợ mình (Thu)
    let totalPayables = 0;    // Mình nợ ai (Trả)

    debts.forEach(d => {
      if (d.trangThai === "DANG_NO" || d.duNo > 0) {
        if (d.loai === "THU" || d.loai === "CHO_VAY") {
          totalReceivables += d.duNo;
        } else {
          totalPayables += d.duNo;
        }
      }
    });

    const netBalance = totalReceivables - totalPayables;

    return {
      success: true,
      summary: {
        net: netBalance,
        receivables: totalReceivables,
        payables: totalPayables
      },
      debts: debts,
      partners: partners
    };
  } catch (err) {
    Logger.log("Lỗi getTab4Data: " + err.toString());
    return {
      success: false,
      message: err.toString(),
      summary: { net: 0, receivables: 0, payables: 0 },
      debts: [],
      partners: []
    };
  }
}

/**
 * 2. LƯU THÊM MỚI HOẶC SỬA BẢN GHI CÔNG NỢ
 */
function saveDebtTransaction(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss ? (ss.getSheetByName(SHEET_DEBT) || ss.getSheetByName("CongNo")) : null;

    if (!sheet && ss) {
      sheet = ss.insertSheet(SHEET_DEBT);
      sheet.appendRow([
        "ID", "Ngày Ghi Nợ", "Tên Đối Tượng", "Loại Nợ", "Nội dung",
        "Tổng Tiền Nợ", "Nguồn", "Đã Thanh Toán", "Ngày thanh toán",
        "Dư Nợ Còn Lại", "Trạng Thái"
      ]);
    }

    if (!payload.ten || !payload.sotien || payload.sotien <= 0) {
      return { success: false, message: "❌ Vui lòng nhập tên đối tượng và số tiền nợ hợp lệ!" };
    }

    const lastRow = sheet.getLastRow();
    let rowIndex = -1;
    if (payload.id && lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(payload.id).trim()) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    const id = payload.id || ("CN" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
    const ngay = payload.ngay || (typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd") : new Date().toISOString().split('T')[0]);
    const loai = String(payload.loai || "THU").toUpperCase();
    const tongNo = Number(payload.sotien) || 0;
    const daTra = Number(payload.daTra || 0);
    const duNo = Math.max(0, tongNo - daTra);
    const trangThai = duNo <= 0 ? "HOAN_TAT" : "DANG_NO";

    const rowData = [
      id,
      ngay,
      payload.ten,
      loai,
      payload.noidung || "",
      tongNo,
      payload.nguon || "",
      daTra,
      payload.ngayTra || "",
      duNo,
      trangThai
    ];

    if (rowIndex === -1) {
      sheet.appendRow(rowData);
    } else {
      sheet.getRange(rowIndex, 1, 1, 11).setValues([rowData]);
    }

    return { success: true, message: "✅ Đã lưu khoản công nợ thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi saveDebtTransaction: " + err.toString() };
  }
}

/**
 * 3. THU HỒI / THANH TOÁN CÔNG NỢ (THU LẺ / TRẢ LẺ HOẶC HÀNG LOẠT)
 */
function settleDebtPayment(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? (ss.getSheetByName(SHEET_DEBT) || ss.getSheetByName("CongNo")) : null;

    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, message: "❌ Không tìm thấy dữ liệu Sheet Debt." };
    }

    const ids = Array.isArray(payload.ids) ? payload.ids : [payload.id];
    const amountToPayTotal = Number(payload.amount) || 0;
    const dateToPay = payload.date || (typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd") : new Date().toISOString().split('T')[0]);
    const sourceWallet = payload.sourceWallet || "";

    if (ids.length === 0 || amountToPayTotal <= 0) {
      return { success: false, message: "❌ Vui lòng chọn khoản nợ và nhập số tiền thanh toán!" };
    }

    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();

    let remainingPayment = amountToPayTotal;
    let updatedCount = 0;
    let targetType = "THU";
    let targetNames = [];
    let targetIds = [];

    for (let i = 0; i < data.length; i++) {
      if (remainingPayment <= 0) break;
      const rowId = String(data[i][0] || "").trim();

      if (ids.includes(rowId)) {
        const rowIndex = i + 2;
        targetType = String(data[i][3] || "THU").toUpperCase();
        const pName = String(data[i][2] || "").trim();
        if (pName && !targetNames.includes(pName)) targetNames.push(pName);
        targetIds.push(rowId);

        const tongNo = parseDebtMoney(data[i][5]);
        let daTraCurrent = parseDebtMoney(data[i][7]);
        let duNoCurrent = parseDebtMoney(data[i][9]);
        if (duNoCurrent <= 0 && data[i][9] === "") duNoCurrent = Math.max(0, tongNo - daTraCurrent);

        const payThisRow = Math.min(remainingPayment, duNoCurrent);
        const newDaTra = daTraCurrent + payThisRow;
        const newDuNo = Math.max(0, tongNo - newDaTra);
        const newTrangThai = newDuNo <= 0 ? "HOAN_TAT" : "DANG_NO";

        sheet.getRange(rowIndex, 8, 1, 4).setValues([[newDaTra, dateToPay, newDuNo, newTrangThai]]);

        remainingPayment -= payThisRow;
        updatedCount++;
      }
    }

    // Cập nhật ví tiền và ghi log vào Sheet Family
    if (sourceWallet && typeof updateWalletBalanceHelper === 'function') {
      const walletChange = targetType === "THU" ? amountToPayTotal : -amountToPayTotal;
      updateWalletBalanceHelper(sourceWallet, walletChange);
    }

    const familySheet = ss ? (ss.getSheetByName("Family") || ss.getSheetByName("ThuChi")) : null;
    if (familySheet) {
      const maGD = "CN" + Date.now().toString().slice(-6);
      const isThu = targetType === "THU";
      const loaiStr = isThu ? "Thu" : "Chi";
      const huStr = isThu ? "----Thu nhập" : "Thiết yếu";
      const partnerStr = targetNames.length > 0 ? targetNames.join(", ") : (payload.name || "Đối tác");
      const debtIdStr = targetIds.join(", ");
      const noiDungStr = (isThu ? "Thu hồi nợ: " : "Thanh toán nợ: ") + partnerStr + " [" + debtIdStr + "]";
      const ghiChuStr = "Mã công nợ liên kết: " + debtIdStr;
      familySheet.appendRow([maGD, dateToPay, loaiStr, huStr, noiDungStr, amountToPayTotal, sourceWallet, "", ghiChuStr]);
    }

    return {
      success: true,
      message: `✅ Đã ghi nhận ${targetType === 'THU' ? 'thu nợ' : 'trả nợ'} thành công ${amountToPayTotal.toLocaleString()} ¥!`
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi settleDebtPayment: " + err.toString() };
  }
}

/**
 * 4. XÓA BẢN GHI CÔNG NỢ
 */
function deleteDebtRecord(id) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? (ss.getSheetByName(SHEET_DEBT) || ss.getSheetByName("CongNo")) : null;

    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, message: "❌ Không tìm thấy Sheet Debt." };
    }

    const lastRow = sheet.getLastRow();
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(id).trim()) {
        sheet.deleteRow(i + 2);
        return { success: true, message: "✅ Đã xóa bản ghi công nợ thành công!" };
      }
    }

    return { success: false, message: "❌ Không tìm thấy ID công nợ để xóa!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi deleteDebtRecord: " + err.toString() };
  }
}
