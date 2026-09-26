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

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
    const parts = str.split(' ')[0].split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = "20" + y;
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
function getDebtSheet(ss) {
  if (!ss) return null;
  const candidateNames = ["Công Nợ", "Công nợ", "CongNo", "Debt", "CÔNG NỢ"];
  for (let name of candidateNames) {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 0) return sh;
  }
  return ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
}

function getTab4Data(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getDebtSheet(ss);

    let debts = [];
    let allDebts = [];
    let partners = [];

    // Lấy danh sách tên đối tác gợi ý từ Sheet Categories (Cột chứa Danh sách Khách / Đối tác)
    const catSheet = ss ? (ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc")) : null;
    if (catSheet && catSheet.getLastRow() >= 1) {
      const lastCol = Math.min(catSheet.getLastColumn(), 15);
      const cData = catSheet.getRange(1, 1, catSheet.getLastRow(), lastCol).getValues();
      let partnerColIdx = 0; // Mặc định Cột A (index 0)
      if (cData.length > 0) {
        const headers = cData[0].map(h => String(h || "").trim().toLowerCase());
        const foundIdx = headers.findIndex(h => h.includes("đối tác") || h.includes("khách") || h.includes("partner"));
        if (foundIdx !== -1) partnerColIdx = foundIdx;
      }
      const startRow = (cData.length > 1) ? 1 : 0;
      for (let r = startRow; r < cData.length; r++) {
        const pName = String(cData[r][partnerColIdx] || "").trim();
        if (pName && !["danh sách khách / đối tác", "khách / đối tác", "đối tác", "khách hàng", "tên đối tác", "partner", "tên khách"].includes(pName.toLowerCase()) && !partners.includes(pName)) {
          partners.push(pName);
        }
      }
    }

    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const isAllYear = (!year || year === "ALL" || String(year).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = isAllYear ? null : parseInt(year, 10);

    const parseServerDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
      const str = String(val).trim();
      if (!str) return null;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
        const p = str.split(' ')[0].split('/');
        let yr = parseInt(p[2], 10);
        if (yr < 100) yr += 2000;
        return new Date(yr, parseInt(p[1], 10) - 1, parseInt(p[0], 10));
      }
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
        const p = str.split(' ')[0].split('-');
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    };

    if (sheet && sheet.getLastRow() >= 2) {
      const lastCol = Math.max(sheet.getLastColumn(), 13);
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getDisplayValues();

      data.forEach((r, idx) => {
        let id = String(r[0] || "").trim();
        const pName = String(r[2] || "").trim();
        const tongNo = parseDebtMoney(r[5]);

        // Handle manually entered debts without ID
        if (!id) {
          if (!pName && tongNo <= 0) return; // Skip completely empty rows
          id = "MANUAL_" + idx;
        }

        if (pName && !partners.includes(pName)) {
          partners.push(pName);
        }

        const daTra = parseDebtMoney(r[7]);
        let duNo = r[9] !== "" && r[9] !== null && r[9] !== undefined ? parseDebtMoney(r[9]) : Math.max(0, tongNo - daTra);
        let trangThaiDuNo = String(r[10] || "").trim().toUpperCase();
        if (!trangThaiDuNo || trangThaiDuNo === "CHO_THANH_TOAN" || trangThaiDuNo === "HOAN_TAT" || trangThaiDuNo === "DANG_NO") {
          trangThaiDuNo = duNo <= 0 ? "DA_TRA" : "DANG_NO";
        }
        let trangThaiThe = String(r[11] || "").trim().toUpperCase();
        if (!trangThaiThe) {
          const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(r[6], ss) : false;
          trangThaiThe = isCredit ? "PRE-ORDER" : "HOAN_TAT";
        }

        let ngayGhiNo = formatDebtDateServer(r[1]);
        let ngayThanhToan = formatDebtDateServer(r[8]);

        try {
          if (typeof r[1] === 'string' && /^\d{4}-\d{1,2}-\d{1,2}/.test(r[1].trim())) {
            sheet.getRange(idx + 2, 2).setValue(ngayGhiNo);
          }
          if (typeof r[8] === 'string' && /^\d{4}-\d{1,2}-\d{1,2}/.test(r[8].trim())) {
            sheet.getRange(idx + 2, 9).setValue(ngayThanhToan);
          }
        } catch(e) {}

        let rawLoai = String(r[3] || "").trim().toUpperCase();
        if (!rawLoai) {
          const textCheck = (pName + " " + String(r[4] || "")).toLowerCase();
          if (textCheck.includes("cho vay") || textCheck.includes("khách nợ") || textCheck.includes("thu nợ") || textCheck.includes("cần thu")) {
            rawLoai = "THU";
          } else {
            rawLoai = "TRA";
          }
        }

        let rawNguon = String(r[6] || "").trim();
        if (rawNguon === "CHO_VAY" || rawNguon === "VAY" || rawNguon === "Chốt nợ Chuyến đi") {
          rawNguon = "";
        }

        const debtObj = {
          row: idx + 2,
          id: id,
          ngay: ngayGhiNo,
          ten: pName,
          loai: rawLoai,
          noidung: String(r[4] || "").trim(),
          tongNo: tongNo,
          nguon: rawNguon,
          daTra: daTra,
          ngayTra: ngayThanhToan,
          duNo: duNo,
          trangThai: trangThaiDuNo,
          trangThaiDuNo: trangThaiDuNo,
          trangThaiThe: trangThaiThe,
          ngaySaoKe: String(r[12] || "").trim()
        };

        allDebts.push(debtObj);

        let dateForFilter = parseServerDate(r[8] || r[1]);
        const m = dateForFilter ? (dateForFilter.getMonth() + 1) : null;
        const y = dateForFilter ? dateForFilter.getFullYear() : null;

        const matchMonth = isAllMonth || !m || m === targetMonth;
        const matchYear = isAllYear || !y || y === targetYear;

        if (matchMonth && matchYear) {
          debts.push(debtObj);
        }
      });
    }

    const sortFn = (a, b) => {
      const parseDate = (val) => {
        if (!val) return 0;
        if (val instanceof Date) return isNaN(val.getTime()) ? 0 : val.getTime();
        const str = String(val).trim();
        if (!str) return 0;
        if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
          const p = str.split(' ')[0].split('-');
          return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getTime() || 0;
        }
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
          const p = str.split(' ')[0].split('/');
          let y = parseInt(p[2], 10);
          if (y < 100) y += 2000;
          return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime() || 0;
        }
        const d = new Date(str);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      const diff = parseDate(b.ngayTra || b.ngay) - parseDate(a.ngayTra || a.ngay);
      if (diff !== 0) return diff;
      return (b.row || 0) - (a.row || 0);
    };

    debts.sort(sortFn);
    allDebts.sort(sortFn);

    let totalReceivables = 0; // Ai nợ mình (Thu)
    let totalPayables = 0;    // Mình nợ ai (Trả)

    allDebts.forEach(d => {
      if (d.trangThai === "DANG_NO" || d.duNo > 0) {
        const lUp = String(d.loai || "").toUpperCase();
        const tUp = (String(d.ten || "") + " " + String(d.noidung || "")).toUpperCase();
        const isReceivable = (
          lUp === "THU" ||
          lUp === "CHO_VAY" ||
          lUp.includes("THU") ||
          lUp.includes("KHÁCH") ||
          lUp.includes("CHO VAY") ||
          lUp.includes("CẦN THU") ||
          tUp.includes("CHO VAY") ||
          tUp.includes("KHÁCH NỢ") ||
          tUp.includes("CẦN THU")
        );

        if (isReceivable) {
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
      allDebts: allDebts,
      partners: partners
    };
  } catch (err) {
    Logger.log("Lỗi getTab4Data: " + err.toString());
    return {
      success: false,
      message: err.toString(),
      summary: { net: 0, receivables: 0, payables: 0 },
      debts: [],
      allDebts: [],
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
        "ID", "Ngày Ghi Nợ", "Tên Đối Tượng", "Loại Nợ", "Nội Dung",
        "Tổng Tiền Nợ", "Nguồn", "Đã Thanh Toán", "Ngày thanh toán",
        "Dư Nợ Còn Lại", "Trạng Thái dư nợ", "Trạng thái thẻ", "Ngày sao kê"
      ]);
    }

    const tenRaw = String(payload.ten || "").trim();
    const tongNo = Number(payload.sotien) || 0;
    let nguon = String(payload.nguon || "").trim();
    let loai = String(payload.loai || "").toUpperCase();

    if (nguon === "CHO_VAY" || nguon === "VAY" || nguon === "Chốt nợ Chuyến đi") {
      if (!loai || loai === "THU") loai = (nguon === "CHO_VAY") ? "THU" : "TRA";
      nguon = "";
    }
    if (!loai) loai = "THU";

    if (!tenRaw || tongNo <= 0) {
      return { success: false, message: "❌ Vui lòng nhập đầy đủ tên đối tượng và số tiền nợ (> 0)!" };
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

    const ngay = formatDebtDateServer(payload.ngay);
    const ngayTra = payload.ngayTra ? formatDebtDateServer(payload.ngayTra) : "";
    const daTra = Number(payload.daTra || 0);
    const duNo = Math.max(0, tongNo - daTra);
    const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(nguon, ss) : false;
    const trangThaiDuNo = duNo <= 0 ? "DA_TRA" : "DANG_NO";
    const trangThaiThe = payload.trangThaiThe || (isCredit ? "PRE-ORDER" : "HOAN_TAT");
    const ngaySaoKe = payload.ngaySaoKe || (trangThaiThe === "HOAN_TAT" ? ngay : "");

    // Cập nhật bản ghi đơn lẻ khi đang chỉnh sửa (có ID khớp trong Sheet)
    if (rowIndex !== -1) {
      const id = payload.id;
      const rowData = [
        id, ngay, tenRaw, loai, payload.noidung || "",
        tongNo, payload.nguon || "", daTra, ngayTra,
        duNo, trangThaiDuNo, trangThaiThe, ngaySaoKe
      ];
      sheet.getRange(rowIndex, 1, 1, 13).setValues([rowData]);

      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      return { success: true, message: "✅ Đã cập nhật công nợ thành công!" };
    }

    // Trường hợp truyền ID cụ thể khi tạo mới (ví dụ từ API/Test)
    if (payload.id) {
      const rowData = [
        payload.id, ngay, tenRaw, loai, payload.noidung || "",
        tongNo, payload.nguon || "", daTra, ngayTra,
        duNo, trangThaiDuNo, trangThaiThe, ngaySaoKe
      ];
      sheet.appendRow(rowData);
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      return { success: true, message: "✅ Đã lưu khoản công nợ thành công!" };
    }

    // Tách danh sách nhiều tên đối tượng (cách nhau dấu phẩy, chấm phẩy, hoặc xuống dòng)
    const names = tenRaw.split(/[,;\n]+/).map(n => n.trim()).filter(n => n.length > 0);
    if (names.length === 0) {
      return { success: false, message: "❌ Vui lòng nhập tên đối tượng hợp lệ!" };
    }

    const rowsToAppend = [];
    names.forEach((name, idx) => {
      const newId = "CN" + Date.now().toString().slice(-6) + String(idx).padStart(2, "0") + Math.floor(10 + Math.random() * 90);
      rowsToAppend.push([
        newId, ngay, name, loai, payload.noidung || "",
        tongNo, payload.nguon || "", daTra, ngayTra,
        duNo, trangThaiDuNo, trangThaiThe, ngaySaoKe
      ]);
    });

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, 13).setValues(rowsToAppend);

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    if (names.length === 1) {
      return { success: true, message: "✅ Đã ghi nhận khoản công nợ cho: " + names[0] };
    } else {
      return { success: true, message: "✅ Đã tạo thành công " + names.length + " khoản nợ riêng biệt cho: " + names.join(", ") };
    }
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
    const dateToPay = formatDebtDateServer(payload.date);
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
        const newTrangThai = newDuNo <= 0 ? "DA_TRA" : "DANG_NO";

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
      const noiDungStr = "[Tất toán công nợ] " + (isThu ? "Thu nợ: " : "Thanh toán nợ: ") + partnerStr + " [" + debtIdStr + "]";
      const ghiChuStr = "[Tất toán công nợ] Mã công nợ liên kết: " + debtIdStr;
      familySheet.appendRow([maGD, dateToPay, loaiStr, huStr, noiDungStr, amountToPayTotal, sourceWallet, "", ghiChuStr, "HOAN_TAT"]);
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
 * 3b. TẤT TOÁN BÙ TRỪ CÔNG NỢ (TÙY CHỌN CÁC ĐƠN THU VÀ TRẢ)
 */
function settleSelectedNetDebtPayment(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? (ss.getSheetByName(SHEET_DEBT) || ss.getSheetByName("CongNo")) : null;

    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, message: "❌ Không tìm thấy dữ liệu Sheet Debt." };
    }

    const thuIds = Array.isArray(payload.thuIds) ? payload.thuIds : [];
    const traIds = Array.isArray(payload.traIds) ? payload.traIds : [];
    const dateToPay = formatDebtDateServer(payload.date);
    const sourceWallet = payload.sourceWallet || "";
    const partnerName = (payload.partnerName || "Đối tác").trim();

    if (thuIds.length === 0 && traIds.length === 0) {
      return { success: false, message: "❌ Vui lòng chọn ít nhất 1 khoản nợ để tất toán bù trừ!" };
    }

    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();

    let sumThu = 0;
    let sumTra = 0;
    let updatedThuCount = 0;
    let updatedTraCount = 0;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndex = i + 2;

      if (thuIds.includes(rowId)) {
        const tongNo = parseDebtMoney(data[i][5]);
        let daTraCurrent = parseDebtMoney(data[i][7]);
        let duNoCurrent = parseDebtMoney(data[i][9]);
        if (duNoCurrent <= 0 && data[i][9] === "") duNoCurrent = Math.max(0, tongNo - daTraCurrent);

        sumThu += duNoCurrent;
        sheet.getRange(rowIndex, 8, 1, 4).setValues([[tongNo, dateToPay, 0, "DA_TRA"]]);
        updatedThuCount++;
      } else if (traIds.includes(rowId)) {
        const tongNo = parseDebtMoney(data[i][5]);
        let daTraCurrent = parseDebtMoney(data[i][7]);
        let duNoCurrent = parseDebtMoney(data[i][9]);
        if (duNoCurrent <= 0 && data[i][9] === "") duNoCurrent = Math.max(0, tongNo - daTraCurrent);

        sumTra += duNoCurrent;
        sheet.getRange(rowIndex, 8, 1, 4).setValues([[tongNo, dateToPay, 0, "DA_TRA"]]);
        updatedTraCount++;
      }
    }

    const netAmount = sumThu - sumTra;

    if (netAmount !== 0 && sourceWallet && typeof updateWalletBalanceHelper === 'function') {
      updateWalletBalanceHelper(sourceWallet, netAmount);
    }

    if (netAmount !== 0 && sourceWallet) {
      const familySheet = ss ? (ss.getSheetByName("Family") || ss.getSheetByName("ThuChi")) : null;
      if (familySheet) {
        const maGD = "CNBT" + Date.now().toString().slice(-6);
        const isNetThu = netAmount > 0;
        const absAmount = Math.abs(netAmount);
        const loaiStr = isNetThu ? "Thu" : "Chi";
        const huStr = isNetThu ? "----Thu nhập" : "Thiết yếu";
        const allDebtIds = [...thuIds, ...traIds].join(", ");
        const noiDungStr = "[Tất toán công nợ] " + (isNetThu ? "Thu nợ bù trừ: " : "Trả nợ bù trừ: ") + partnerName + " [" + allDebtIds + "]";
        const ghiChuStr = "[Tất toán công nợ] Tất toán bù trừ " + updatedThuCount + " đơn thu, " + updatedTraCount + " đơn trả";
        familySheet.appendRow([maGD, dateToPay, loaiStr, huStr, noiDungStr, absAmount, sourceWallet, "", ghiChuStr]);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    let msg = `✅ Đã tất toán bù trừ thành công! (${updatedThuCount} đơn thu, ${updatedTraCount} đơn trả).`;
    if (netAmount > 0) {
      msg += ` Thu ròng ${netAmount.toLocaleString()} ¥ vào ${sourceWallet || 'ví'}.`;
    } else if (netAmount < 0) {
      msg += ` Trả ròng ${Math.abs(netAmount).toLocaleString()} ¥ từ ${sourceWallet || 'ví'}.`;
    } else {
      msg += ` Bù trừ vừa đủ 0 ¥, không phát sinh dòng tiền.`;
    }

    return {
      success: true,
      message: msg,
      netAmount: netAmount
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi settleSelectedNetDebtPayment: " + err.toString() };
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
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();

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
