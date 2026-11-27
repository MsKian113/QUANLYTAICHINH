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
  if (!str || str === 'undefined' || str === 'null' || str === 'Invalid Date') return "";

  // dd/MM/yyyy or dd-MM-yyyy or d/M/yyyy
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(str)) {
    const sep = str.includes('/') ? '/' : '-';
    const parts = str.split(' ')[0].split(sep);
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = "20" + y;
    return `${d}/${m}/${y}`;
  }

  // dd/MM or d/M (không có năm -> tự động lấy năm hiện tại)
  if (/^\d{1,2}[\/\-]\d{1,2}$/.test(str)) {
    const sep = str.includes('/') ? '/' : '-';
    const parts = str.split(sep);
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = new Date().getFullYear();
    return `${d}/${m}/${y}`;
  }

  // yyyy-MM-dd or yyyy/MM/dd
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(str)) {
    const sep = str.includes('-') ? '-' : '/';
    const parts = str.split(' ')[0].split(sep);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  try {
    const cleanedStr = str.replace(/\s*\([^)]*\)$/, '');
    const d = new Date(cleanedStr);
    if (!isNaN(d.getTime())) {
      return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d, "Asia/Tokyo", "dd/MM/yyyy") : String(d.getDate()).padStart(2, '0') + "/" + String(d.getMonth() + 1).padStart(2, '0') + "/" + d.getFullYear();
    }
  } catch(e) {}

  return str;
}

/**
 * Helper chuẩn hóa chuỗi loại bỏ dấu tiếng Việt để so sánh tên sheet và header bảng
 */
function removeVietnameseAccentsServer(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
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
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, message: "Không thể mở bảng tính: " + ssTarget, debts: [], allDebts: [], partners: [] };
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
        const yr = new Date().getFullYear();
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
        let expectedDuNo = tongNo > 0 ? Math.max(0, tongNo - daTra) : 0;
        let sheetDuNo = parseDebtMoney(r[9]);
        let duNo = (sheetDuNo > 0) ? sheetDuNo : expectedDuNo;

        let rawStatusStr = String(r[10] || "").trim().toUpperCase();
        const isLocked = (rawStatusStr === "DA_CHOT" || rawStatusStr === "CHOT_SO" || rawStatusStr === "LOCKED" || rawStatusStr.includes("ĐÃ CHỐT") || rawStatusStr.includes("DA CHOT"));
        const isExplicitDone = (rawStatusStr === "HOAN_TAT" || rawStatusStr === "DA_TRA" || rawStatusStr === "DONE" || 
          rawStatusStr.includes("HOÀN TẤT") || rawStatusStr.includes("ĐÃ TRẢ") || rawStatusStr.includes("ĐÃ THANH TOÁN") || rawStatusStr.includes("ĐÃ TT") ||
          rawStatusStr.includes("DA TRA") || rawStatusStr.includes("HOAN TAT") || rawStatusStr.includes("DA THANH TOAN"));
        
        let trangThaiDuNo = "DANG_NO";
        if (isExplicitDone || (tongNo > 0 && daTra >= tongNo) || (tongNo > 0 && sheetDuNo === 0 && daTra > 0)) {
          trangThaiDuNo = "DA_TRA";
          duNo = 0;
        } else if (isLocked) {
          trangThaiDuNo = "DA_CHOT";
        } else {
          trangThaiDuNo = "DANG_NO";
          if (duNo <= 0 && tongNo > 0) {
            duNo = expectedDuNo > 0 ? expectedDuNo : tongNo;
          }
        }

        let trangThaiThe = String(r[11] || "").trim().toUpperCase();
        if (!trangThaiThe) {
          const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(r[6], ss) : false;
          trangThaiThe = isCredit ? "PRE-ORDER" : "HOAN_TAT";
        }

        let ngayGhiNo = formatDebtDateServer(r[1]);
        let ngayThanhToan = formatDebtDateServer(r[8]);

// Batch read only - no synchronous single-cell writes during query

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
          isLocked: isLocked,
          trangThaiThe: trangThaiThe,
          ngaySaoKe: String(r[12] || "").trim()
        };

        allDebts.push(debtObj);

        let dateForFilter = parseServerDate(r[8] || r[1]);
        const m = dateForFilter ? (dateForFilter.getMonth() + 1) : null;
        const y = dateForFilter ? dateForFilter.getFullYear() : null;

        const matchMonth = isAllMonth || !m || m === targetMonth;
        const matchYear = isAllYear || !y || y === targetYear;
        const isActiveUnpaid = (trangThaiDuNo !== "HOAN_TAT" && trangThaiDuNo !== "DA_TRA");

        if (isActiveUnpaid || (matchMonth && matchYear)) {
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
        if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
          const p = str.split(' ')[0].split('/');
          let y = parseInt(p[2], 10);
          if (y < 100) y += 2000;
          return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10)).getTime() || 0;
        }
        if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
          const p = str.split(' ')[0].split('-');
          return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getTime() || 0;
        }
        const d = new Date(str);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      };
      const aIsDone = (a.trangThai === 'HOAN_TAT' || a.trangThai === 'DA_TRA');
      const bIsDone = (b.trangThai === 'HOAN_TAT' || b.trangThai === 'DA_TRA');
      const dateA = aIsDone ? (a.ngayTra || a.ngay) : (a.ngay || a.ngayTra);
      const dateB = bIsDone ? (b.ngayTra || b.ngay) : (b.ngay || b.ngayTra);
      const diff = parseDate(dateB) - parseDate(dateA);
      if (diff !== 0) return diff;
      return (b.row || 0) - (a.row || 0);
    };

    debts.sort(sortFn);
    allDebts.sort(sortFn);

    let totalReceivables = 0; // Ai nợ mình (Thu)
    let totalPayables = 0;    // Mình nợ ai (Trả)

    allDebts.forEach(d => {
      const isDone = (d.trangThai === "HOAN_TAT" || d.trangThai === "DA_TRA" || d.trangThai === "DONE");
      if (!isDone && d.duNo > 0) {
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
function saveDebtTransaction(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (payload && payload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const requestId = payload ? (payload.requestId || payload.clientRequestId) : null;

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    let sheet = getDebtSheet(ss);

    if (!sheet && ss) {
      sheet = ss.insertSheet(SHEET_DEBT);
      sheet.appendRow([
        "ID", "Ngày Ghi Nợ", "Tên Đối Tượng", "Loại Nợ", "Nội Dung",
        "Tổng Tiền Nợ", "Nguồn", "Đã Thanh Toán", "Ngày thanh toán",
        "Dư Nợ Còn Lại", "Trạng Thái dư nợ", "Trạng thái thẻ", "Ngày sao kê"
      ]);
    }

    const tenRaw = String(payload.ten || payload.doituong || payload.tenDoiTuong || "").trim();
    const tongNo = Number(payload.sotien || payload.amount || payload.tongNo) || 0;
    let nguon = String(payload.nguon || payload.nguontien || payload.viNguon || "").trim();
    let loai = String(payload.loai || "").toUpperCase();

    if (nguon === "CHO_VAY" || nguon === "VAY" || nguon === "Chốt nợ Chuyến đi") {
      if (!loai || loai === "THU") loai = (nguon === "CHO_VAY") ? "THU" : "TRA";
      nguon = "";
    }
    if (!loai) loai = "THU";

    if (!tenRaw || tongNo <= 0) {
      return { success: false, message: "❌ Vui lòng nhập đầy đủ tên đối tượng và số tiền nợ (> 0)!" };
    }

    const lastRow = sheet ? sheet.getLastRow() : 0;
    let rowIndex = -1;
    if (payload.id && lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      const targetId = String(payload.id).trim();
      for (let i = 0; i < ids.length; i++) {
        const curId = String(ids[i][0] || "").trim();
        const rowNum = i + 2;
        const isMatch = (curId && curId.toLowerCase() === targetId.toLowerCase()) ||
                        (targetId === "MANUAL_" + i) ||
                        (targetId === "ROW_" + rowNum) ||
                        (targetId === String(rowNum)) ||
                        (Number(targetId) === rowNum);
        if (isMatch) {
          rowIndex = rowNum;
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

    const updatedWallets = [];

    // Cập nhật bản ghi đơn lẻ khi đang chỉnh sửa (có ID khớp trong Sheet)
    if (rowIndex !== -1) {
      const fullRow = sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), 11)).getValues()[0];
      const curStatus = String((fullRow && fullRow[10]) || "").trim().toUpperCase();
      if (curStatus === "DA_CHOT" || curStatus === "CHOT_SO" || curStatus === "LOCKED" || curStatus.includes("ĐÃ CHỐT") || curStatus.includes("DA CHOT")) {
        return { success: false, message: "🔒 Khoản nợ này đã được chốt đối soát, không được phép chỉnh sửa để bảo toàn dữ liệu sổ sách!" };
      }
      const id = payload.id;
      const rowData = [
        id, ngay, tenRaw, loai, payload.noidung || "",
        tongNo, payload.nguon || "", daTra, ngayTra,
        duNo, trangThaiDuNo, trangThaiThe, ngaySaoKe
      ];
      sheet.getRange(rowIndex, 1, 1, 13).setValues([rowData]);

      // Đồng bộ WalletLedger khi sửa công nợ
      if (typeof replaceFinancialEvents === 'function' && id) {
        const ledgerEvents = [];
        const isThu = (loai === "THU" || loai === "CHO_VAY");
        const noiDungRaw = String(payload.noidung || "").trim();
        const noiDungSuffix = noiDungRaw ? ` (${noiDungRaw})` : "";
        if (isThu) {
          if (payload.nguon) {
            const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(payload.nguon, ss) : false;
            ledgerEvents.push({
              walletName: payload.nguon,
              date: ngay,
              amount: tongNo,
              direction: isCredit ? "INCREASE" : "OUT",
              effectType: isCredit ? "CARD_DEBT" : "CASH",
              sourceModule: "Debt",
              sourceId: id,
              eventType: "LEND_MONEY",
              note: `[Cho vay] ${tenRaw}${noiDungSuffix}`
            });
          }
        } else {
          if (payload.nguon) {
            ledgerEvents.push({
              walletName: payload.nguon,
              date: ngay,
              amount: tongNo,
              direction: "IN",
              effectType: "CASH",
              sourceModule: "Debt",
              sourceId: id,
              eventType: "BORROW_MONEY",
              note: `[Đi mượn] ${tenRaw}${noiDungSuffix}`
            });
          }
        }
        if (ledgerEvents.length > 0) {
          replaceFinancialEvents(id, ledgerEvents, "Sửa bản ghi nợ", ss);
        } else {
          reverseFinancialEvents(id, "Sửa bản ghi nợ không qua ví", ss);
        }
      }

      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
      const res = {
        success: true,
        message: "✅ Đã cập nhật công nợ thành công!",
        savedItem: { id: id, ngay: ngay, ten: tenRaw, loai: loai, sotien: tongNo, duNo: duNo },
        updatedWallets: updatedWallets,
        dataVersion: nextVersion
      };
      if (requestId && typeof recordProcessedRequest === 'function') {
        recordProcessedRequest(requestId, "DONE", res, ss);
      }
      return res;
    }

    // Trường hợp truyền ID cụ thể khi tạo mới (ví dụ từ API/Test)
    if (payload.id) {
      const rowData = [
        payload.id, ngay, tenRaw, loai, payload.noidung || "",
        tongNo, payload.nguon || "", daTra, ngayTra,
        duNo, trangThaiDuNo, trangThaiThe, ngaySaoKe
      ];
      if (sheet) sheet.appendRow(rowData);
      if (nguon && typeof updateWalletBalanceHelper === 'function') {
        const delta = (loai === "THU") ? -tongNo : tongNo;
        const wInfo = updateWalletBalanceHelper(nguon, delta, ss);
        if (wInfo) updatedWallets.push(wInfo);
      }
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
      const res = {
        success: true,
        message: "✅ Đã lưu khoản công nợ thành công!",
        savedItem: { id: payload.id, ngay: ngay, ten: tenRaw, loai: loai, sotien: tongNo, duNo: duNo },
        updatedWallets: updatedWallets,
        dataVersion: nextVersion
      };
      if (requestId && typeof recordProcessedRequest === 'function') {
        recordProcessedRequest(requestId, "DONE", res, ss);
      }
      return res;
    }

    // Tách danh sách nhiều tên đối tượng
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

    if (sheet) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rowsToAppend.length, 13).setValues(rowsToAppend);
    }

    if (nguon && typeof updateWalletBalanceHelper === 'function') {
      const delta = (loai === "THU") ? -(tongNo * names.length) : (tongNo * names.length);
      const wInfo = updateWalletBalanceHelper(nguon, delta, ss);
      if (wInfo) updatedWallets.push(wInfo);
    }

    // Ghi nhận sự kiện vào WalletLedger
    if (typeof postFinancialEvents === 'function') {
      const isInherited = String(payload.noidung || "").includes("TRIP_") || String(payload.noidung || "").includes("GRP_") || String(payload.id || "").startsWith("TRIP_") || payload.isInherited === true || Boolean(payload.groupId) || Boolean(payload.batchId) || payload.expenseSource === "TAB7_TRICOUNT";
      const ledgerEvents = [];
      const noiDungRaw = String(payload.noidung || "").trim();
      const noiDungSuffix = noiDungRaw ? ` (${noiDungRaw})` : "";

      names.forEach((name, idx) => {
        const rowId = rowsToAppend[idx][0];
        if (loai === "THU" || loai === "CHO_VAY") {
          // Cho vay / Cho mượn
          if (!isInherited && nguon) {
            ledgerEvents.push({
              walletName: nguon,
              date: ngay,
              amount: tongNo,
              direction: "OUT",
              effectType: "CASH",
              sourceModule: "Debt",
              sourceId: rowId,
              eventType: "LEND_MONEY",
              note: `[Cho vay] ${name}${noiDungSuffix}`
            });
          }
        } else {
          // Đi vay / Đi mượn
          if (!isInherited && nguon) {
            ledgerEvents.push({
              walletName: nguon,
              date: ngay,
              amount: tongNo,
              direction: "IN",
              effectType: "CASH",
              sourceModule: "Debt",
              sourceId: rowId,
              eventType: "BORROW_MONEY",
              note: `[Đi mượn] ${name}${noiDungSuffix}`
            });
          }
        }
      });

      if (ledgerEvents.length > 0) {
        postFinancialEvents(ledgerEvents, ss);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    const msg = (names.length === 1)
      ? "✅ Đã ghi nhận khoản công nợ cho: " + names[0]
      : "✅ Đã tạo thành công " + names.length + " khoản nợ riêng biệt cho: " + names.join(", ");

    const res = {
      success: true,
      message: msg,
      savedItem: { id: rowsToAppend[0][0], ngay: ngay, names: names, totalAmount: tongNo * names.length },
      updatedWallets: updatedWallets,
      dataVersion: nextVersion
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 3. THU HỒI / THANH TOÁN CÔNG NỢ (THU LẺ / TRẢ LẺ HOẶC HÀNG LOẠT)
 */
/**
 * 3. THU HỒI / THANH TOÁN CÔNG NỢ (THU LẺ / TRẢ LẺ HOẶC HÀNG LOẠT)
 */
function settleDebtPayment(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (payload && payload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const requestId = payload ? (payload.requestId || payload.clientRequestId) : null;

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const sheet = getDebtSheet(ss);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, message: "❌ Không tìm thấy dữ liệu Sheet Debt." };
    }

    const rawIds = Array.isArray(payload.ids) ? payload.ids : [payload.id || payload.debtId];
    const ids = rawIds.filter(id => id !== undefined && id !== null && String(id).trim() !== "");
    const amountToPayTotal = Number(payload.amount || payload.amountPaid) || 0;
    const dateToPay = formatDebtDateServer(payload.date || payload.settleDate);
    const sourceWallet = payload.sourceWallet || payload.settleWallet || "";
    const requestedType = payload.type ? String(payload.type).trim().toUpperCase() : "";

    if (ids.length === 0 || amountToPayTotal <= 0) {
      return { success: false, message: "❌ Vui lòng chọn khoản nợ và nhập số tiền thanh toán!" };
    }

    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 11)).getValues();

    // Helper kiểm tra xem dòng thứ i trong bảng data có thuộc danh sách ids được chọn hay không
    function isRowMatch(i, rowId) {
      const cleanRowId = String(rowId || "").trim();
      const rowNum = i + 2;
      for (let k = 0; k < ids.length; k++) {
        const target = String(ids[k] || "").trim();
        if (!target) continue;
        if (cleanRowId && target.toLowerCase() === cleanRowId.toLowerCase()) return true;
        if (target === "MANUAL_" + i) return true;
        if (target === "ROW_" + rowNum || target === String(rowNum) || Number(target) === rowNum) return true;
      }
      return false;
    }

    // Helper nhận diện dòng nợ là Phải Thu (THU) hay Phải Trả (TRA)
    function isRowThu(loaiStr, tenStr, noiDungStr) {
      const l = String(loaiStr || "").trim().toUpperCase();
      if (l === "THU" || l === "CHO_VAY") return true;
      if (l === "TRA" || l === "VAY") return false;
      const combined = (String(tenStr || "") + " " + String(noiDungStr || "")).toLowerCase();
      if (combined.includes("cho vay") || combined.includes("khách nợ") || combined.includes("thu nợ") || combined.includes("cần thu")) return true;
      return false;
    }

    const matchedRows = [];
    let sumMatchedThu = 0;
    let sumMatchedTra = 0;
    let sumMatchedDuNo = 0;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      if (isRowMatch(i, rowId)) {
        const rowIndex = i + 2;
        const pName = String(data[i][2] || "").trim();
        const loaiRow = String(data[i][3] || "").trim().toUpperCase();
        const noiDung = String(data[i][4] || "").trim();
        const tongNo = parseDebtMoney(data[i][5]);
        const daTraCurrent = parseDebtMoney(data[i][7]);
        let duNoCurrent = parseDebtMoney(data[i][9]);
        if (duNoCurrent <= 0) duNoCurrent = Math.max(0, tongNo - daTraCurrent);
        if (duNoCurrent <= 0 && tongNo > 0 && daTraCurrent < tongNo) duNoCurrent = tongNo - daTraCurrent;

        const isThu = isRowThu(loaiRow, pName, noiDung);
        if (isThu) {
          sumMatchedThu += duNoCurrent > 0 ? duNoCurrent : tongNo;
        } else {
          sumMatchedTra += duNoCurrent > 0 ? duNoCurrent : tongNo;
        }
        sumMatchedDuNo += duNoCurrent;

        matchedRows.push({
          dataIndex: i,
          rowIndex: rowIndex,
          rowId: rowId,
          pName: pName,
          loai: loaiRow,
          isThu: isThu,
          tongNo: tongNo,
          daTraCurrent: daTraCurrent,
          duNoCurrent: duNoCurrent
        });
      }
    }

    if (matchedRows.length === 0) {
      return { success: false, message: "❌ Không tìm thấy bản ghi nợ tương ứng trong Sheet Debt!" };
    }

    // Xác định chiều giao dịch chính (targetType: THU hay TRA)
    let targetType = "THU";
    if (requestedType === "TRA" || requestedType === "VAY" || requestedType.includes("TRA")) {
      targetType = "TRA";
    } else if (requestedType === "THU" || requestedType === "CHO_VAY" || requestedType.includes("THU")) {
      targetType = "THU";
    } else {
      // Tự động phân định theo tổng số dư nợ của các dòng được chọn:
      // Nếu tổng TRA > tổng THU (Quậy đang nợ đối tác nhiều hơn) -> TRA (Quậy trả nợ -> Dòng tiền OUT)
      if (sumMatchedTra > sumMatchedThu) {
        targetType = "TRA";
      } else {
        targetType = "THU";
      }
    }

    let remainingPayment = amountToPayTotal;
    const isFullSettlement = (amountToPayTotal >= sumMatchedDuNo && sumMatchedDuNo > 0);
    const hasBothDirections = sumMatchedThu > 0 && sumMatchedTra > 0;
    const isExactNetSettlement = hasBothDirections && (amountToPayTotal === Math.abs(sumMatchedThu - sumMatchedTra));

    const targetNames = [];
    const targetIds = [];
    let updatedCount = 0;

    for (let k = 0; k < matchedRows.length; k++) {
      const item = matchedRows[k];
      const rowIndex = item.rowIndex;
      let rowId = item.rowId;

      if (item.pName && !targetNames.includes(item.pName)) targetNames.push(item.pName);

      // Nếu dòng chưa có ID trong Cột A, tự động cấp mã ID mới
      if (!rowId) {
        rowId = "CN" + Date.now().toString().slice(-6) + String(k).padStart(2, "0");
        sheet.getRange(rowIndex, 1).setValue(rowId);
      }
      targetIds.push(rowId);

      let payThisRow = 0;
      if (isFullSettlement || isExactNetSettlement) {
        payThisRow = item.duNoCurrent > 0 ? item.duNoCurrent : item.tongNo;
      } else {
        if (remainingPayment <= 0) {
          payThisRow = 0;
        } else {
          payThisRow = Math.min(remainingPayment, item.duNoCurrent > 0 ? item.duNoCurrent : item.tongNo);
          remainingPayment -= payThisRow;
        }
      }

      if (payThisRow > 0 || isFullSettlement || isExactNetSettlement) {
        const newDaTra = item.daTraCurrent + payThisRow;
        const newDuNo = Math.max(0, item.tongNo - newDaTra);
        const newTrangThai = newDuNo <= 0 ? "DA_TRA" : "DANG_NO";

        // Cập nhật Cột 8 (Đã Thanh Toán), Cột 9 (Ngày thanh toán), Cột 10 (Dư Nợ Còn Lại), Cột 11 (Trạng Thái)
        sheet.getRange(rowIndex, 8, 1, 4).setValues([[newDaTra, dateToPay, newDuNo, newTrangThai]]);
        updatedCount++;
      }
    }

    const updatedWallets = [];
    const isThu = targetType === "THU"; // THU: Tiền vào ví (+), TRA: Quậy trả nợ tiền ra (-)

    // Cập nhật ví tiền và ghi log vào Sheet Family
    if (sourceWallet && typeof updateWalletBalanceHelper === 'function') {
      const walletChange = isThu ? amountToPayTotal : -amountToPayTotal;
      const wInfo = updateWalletBalanceHelper(sourceWallet, walletChange, ss);
      if (wInfo) updatedWallets.push(wInfo);
    }

    const familySheet = ss ? (ss.getSheetByName("Family") || ss.getSheetByName("ThuChi")) : null;
    if (familySheet) {
      const maGD = "CN" + Date.now().toString().slice(-6);
      const loaiStr = isThu ? "Thu" : "Chi";
      const huStr = "CÔNG NỢ";
      const partnerStr = targetNames.length > 0 ? targetNames.join(", ") : (payload.name || "Đối tác");
      const debtIdStr = targetIds.join(", ");
      const noiDungStr = (isThu ? "[Thu nợ] " : "[Trả nợ] ") + partnerStr + " [" + debtIdStr + "]";
      const ghiChuStr = (isThu ? "[Thu nợ] " : "[Trả nợ] ") + "Mã công nợ liên kết: " + debtIdStr;
      familySheet.appendRow([maGD, dateToPay, loaiStr, huStr, noiDungStr, amountToPayTotal, sourceWallet, "", ghiChuStr, "HOAN_TAT"]);
    }

    // Ghi nhận sự kiện vào WalletLedger
    if (typeof postFinancialEvents === 'function' && sourceWallet && amountToPayTotal > 0) {
      const partnerStr = targetNames.length > 0 ? targetNames[0] : (payload.name || "Đối tác");
      const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(sourceWallet, ss) : false;
      const paymentEvents = [];

      if (isThu) {
        // Thu nợ (Tiền vào ví hoặc giảm nợ thẻ credit) -> IN / DECREASE
        paymentEvents.push({
          walletName: sourceWallet,
          date: dateToPay,
          amount: amountToPayTotal,
          direction: isCredit ? "DECREASE" : "IN",
          effectType: isCredit ? "CARD_DEBT" : "CASH",
          sourceModule: "Debt",
          sourceId: targetIds.join("_"),
          paymentId: "SETTLE_" + Date.now(),
          eventType: "COLLECT_LOAN",
          note: `[Thu nợ] ${partnerStr}`
        });
      } else {
        // Trả nợ (Quậy đang nợ -> Tiền ra khỏi ví hoặc tăng nợ thẻ credit) -> OUT / INCREASE
        paymentEvents.push({
          walletName: sourceWallet,
          date: dateToPay,
          amount: amountToPayTotal,
          direction: isCredit ? "INCREASE" : "OUT",
          effectType: isCredit ? "CARD_DEBT" : "CASH",
          sourceModule: "Debt",
          sourceId: targetIds.join("_"),
          paymentId: "SETTLE_" + Date.now(),
          eventType: "REPAY_LOAN",
          note: `[Trả nợ] ${partnerStr}`
        });
      }

      postFinancialEvents(paymentEvents, ss);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    const res = {
      success: true,
      message: `✅ Đã ghi nhận ${targetType === 'THU' ? 'thu nợ' : 'trả nợ'} thành công ${amountToPayTotal.toLocaleString()} ¥!`,
      updatedCount: updatedCount,
      targetType: targetType,
      updatedWallets: updatedWallets,
      dataVersion: nextVersion
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 3b. TẤT TOÁN BÙ TRỪ CÔNG NỢ (TÙY CHỌN CÁC ĐƠN THU VÀ TRẢ)
 */
function settleSelectedNetDebtPayment(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (payload && payload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const requestId = payload ? (payload.requestId || payload.clientRequestId) : null;

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const sheet = getDebtSheet(ss);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, message: "❌ Không tìm thấy dữ liệu Sheet Debt." };
    }

    const thuIds = Array.isArray(payload.thuIds) ? payload.thuIds : [];
    const traIds = Array.isArray(payload.traIds) ? payload.traIds : [];
    const dateToPay = formatDebtDateServer(payload.date || payload.settleDate);
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
    const updatedWallets = [];

    if (netAmount !== 0 && sourceWallet && typeof updateWalletBalanceHelper === 'function') {
      const wInfo = updateWalletBalanceHelper(sourceWallet, netAmount, ss);
      if (wInfo) updatedWallets.push(wInfo);
    }

    if (netAmount !== 0 && sourceWallet) {
      const familySheet = ss ? (ss.getSheetByName("Family") || ss.getSheetByName("ThuChi")) : null;
      if (familySheet) {
        const maGD = "CNBT" + Date.now().toString().slice(-6);
        const isNetThu = netAmount > 0;
        const absAmount = Math.abs(netAmount);
        const loaiStr = isNetThu ? "Thu" : "Chi";
        const huStr = "CÔNG NỢ";
        const allDebtIds = [...thuIds, ...traIds].join(", ");
        const noiDungStr = (isNetThu ? "[Thu nợ] Bù trừ: " : "[Trả nợ] Bù trừ: ") + partnerName + " [" + allDebtIds + "]";
        const ghiChuStr = (isNetThu ? "[Thu nợ] " : "[Trả nợ] ") + "Tất toán bù trừ " + updatedThuCount + " đơn thu, " + updatedTraCount + " đơn trả";
        familySheet.appendRow([maGD, dateToPay, loaiStr, huStr, noiDungStr, absAmount, sourceWallet, "", ghiChuStr, "HOAN_TAT"]);
      }

      // Ghi nhận sự kiện vào WalletLedger
      if (typeof postFinancialEvents === 'function') {
        const isNetThu = netAmount > 0;
        const absAmount = Math.abs(netAmount);
        const allDebtIds = [...thuIds, ...traIds].join("_");
        const paymentEvents = [];

        if (isNetThu) {
          paymentEvents.push({
            walletName: sourceWallet,
            date: dateToPay,
            amount: absAmount,
            direction: "IN",
            effectType: "CASH",
            sourceModule: "Debt",
            sourceId: allDebtIds,
            paymentId: "SETTLE_NET_" + Date.now(),
            eventType: "COLLECT_LOAN",
            note: `Thu hồi nợ bù trừ: ${partnerName}`
          });
        } else {
          paymentEvents.push({
            walletName: sourceWallet,
            date: dateToPay,
            amount: absAmount,
            direction: "OUT",
            effectType: "CASH",
            sourceModule: "Debt",
            sourceId: allDebtIds,
            paymentId: "SETTLE_NET_" + Date.now(),
            eventType: "REPAY_LOAN",
            note: `Trả nợ bù trừ: ${partnerName}`
          });
        }

        postFinancialEvents(paymentEvents, ss);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let msg = `✅ Đã tất toán bù trừ thành công! (${updatedThuCount} đơn thu, ${updatedTraCount} đơn trả).`;
    if (netAmount > 0) {
      msg += ` Thu ròng ${netAmount.toLocaleString()} ¥ vào ${sourceWallet || 'ví'}.`;
    } else if (netAmount < 0) {
      msg += ` Trả ròng ${Math.abs(netAmount).toLocaleString()} ¥ từ ${sourceWallet || 'ví'}.`;
    } else {
      msg += ` Bù trừ vừa đủ 0 ¥, không phát sinh dòng tiền.`;
    }

    const res = {
      success: true,
      message: msg,
      netAmount: netAmount,
      updatedWallets: updatedWallets,
      dataVersion: nextVersion
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 4. XÓA BẢN GHI CÔNG NỢ
 */
function deleteDebtRecord(idOrPayload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (idOrPayload && idOrPayload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const id = (typeof idOrPayload === 'object' && idOrPayload !== null) ? String(idOrPayload.id || "").trim() : String(idOrPayload || "").trim();
    const requestId = (typeof idOrPayload === 'object' && idOrPayload !== null) ? (idOrPayload.requestId || idOrPayload.clientRequestId) : null;

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const sheet = getDebtSheet(ss);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, message: "❌ Không tìm thấy Sheet Debt." };
    }

    const lastRow = sheet.getLastRow();
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();

    for (let i = 0; i < ids.length; i++) {
      const curId = String(ids[i][0] || "").trim();
      const rowNum = i + 2;
      const isMatch = (curId && curId.toLowerCase() === id.toLowerCase()) ||
                      (id === "MANUAL_" + i) ||
                      (id === "ROW_" + rowNum) ||
                      (id === String(rowNum)) ||
                      (Number(id) === rowNum);
      if (isMatch) {
        // Kiểm tra xem khoản nợ này đã được chốt đối soát chưa
        const fullRow = sheet.getRange(rowNum, 1, 1, Math.max(sheet.getLastColumn(), 11)).getValues()[0];
        const curStatus = String((fullRow && fullRow[10]) || "").trim().toUpperCase();
        const curDaTra = Number((fullRow && fullRow[7]) || 0);
        const curDuNo = Number((fullRow && fullRow[9]) || 0);
        if (curStatus === "DA_CHOT" || curStatus === "CHOT_SO" || curStatus === "LOCKED" || curStatus.includes("ĐÃ CHỐT") || curStatus.includes("DA CHOT")) {
          return { success: false, message: "🔒 Khoản nợ này đã được chốt đối soát, không được phép xóa để bảo toàn dữ liệu sổ sách!" };
        }
        if (curDuNo <= 0 || curDaTra > 0 || curStatus.includes("THANH_TOAN") || curStatus.includes("DA_TRA")) {
          return { success: false, message: "⚠️ Khoản nợ đã được thanh toán hoặc đã phát sinh giao dịch trả nợ, không thể xóa!" };
        }

        // Đảo sự kiện trong WalletLedger
        if (typeof reverseFinancialEvents === 'function' && id) {
          reverseFinancialEvents(id, "Xóa bản ghi nợ", ss);
        }

        sheet.deleteRow(i + 2);
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

        const res = {
          success: true,
          message: "✅ Đã xóa bản ghi công nợ thành công!",
          deletedId: id,
          dataVersion: nextVersion
        };

        if (requestId && typeof recordProcessedRequest === 'function') {
          recordProcessedRequest(requestId, "DONE", res, ss);
        }

        return res;
      }
    }

    return { success: false, message: "❌ Không tìm thấy ID công nợ để xóa!" };
  });
}

/**
 * 5. CHỐT & KHÓA BẢN GHI CÔNG NỢ (KHÔNG CHO PHÉP SỬA/XÓA)
 */
function lockDebtsBatch(idsOrPayload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (idsOrPayload && idsOrPayload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const sheet = getDebtSheet(ss);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: false, message: "❌ Không tìm thấy Sheet Debt." };
    }

    const rawIds = Array.isArray(idsOrPayload) ? idsOrPayload : ((idsOrPayload && idsOrPayload.ids) ? idsOrPayload.ids : [idsOrPayload]);
    const ids = rawIds.filter(id => id !== undefined && id !== null && String(id).trim() !== "");
    if (ids.length === 0) {
      return { success: false, message: "❌ Vui lòng chọn ít nhất 1 khoản nợ để chốt!" };
    }

    const lastRow = sheet.getLastRow();
    const data = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), 11)).getValues();
    let lockedCount = 0;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowNum = i + 2;
      let matched = false;
      for (let k = 0; k < ids.length; k++) {
        const target = String(ids[k] || "").trim();
        if ((rowId && target.toLowerCase() === rowId.toLowerCase()) || target === "MANUAL_" + i || target === "ROW_" + rowNum || Number(target) === rowNum) {
          matched = true;
          break;
        }
      }
      if (matched) {
        sheet.getRange(rowNum, 11).setValue("DA_CHOT");
        lockedCount++;
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
    return {
      success: true,
      message: `🔒 Đã chốt và khóa an toàn ${lockedCount} khoản công nợ! (Không thể sửa/xóa)`,
      lockedCount: lockedCount,
      dataVersion: nextVersion
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getDebtSheet,
    formatDebtDateServer,
    parseDebtMoney,
    getTab4Data,
    saveDebtTransaction,
    settleDebtPayment,
    settleSelectedNetDebtPayment,
    deleteDebtRecord,
    lockDebtsBatch
  };
}

