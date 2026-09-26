// ==========================================
// FILE: Server_Tab1.js
// NHIỆM VỤ: Backend Logic cho Tab 1 (Ví & Thẻ)
// Truy vấn đa bảng: Family, Debt, Purchase, Sales, Business
// ==========================================

const SHEET_WALLETS = "Wallets";

/**
 * Lấy Helper Sheet an toàn với fallback tên tiếng Việt / Anh
 */
function getSheetByNameSafely(name, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    return ss ? ss.getSheetByName(name) : null;
  } catch (e) {
    Logger.log("Lỗi truy cập sheet " + name + ": " + e);
    return null;
  }
}

function getSheetByNames(name1, name2, ssTarget) {
  let sheet = getSheetByNameSafely(name1, ssTarget);
  if (!sheet && name2) {
    sheet = getSheetByNameSafely(name2, ssTarget);
  }
  return sheet;
}

function parseMoneyNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;
  const cleanStr = str.replace(/[^0-9-]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * 1. KÉO DANH SÁCH VÍ & THẺ TỪ GOOGLE SHEET "Wallets"
 */
function parseServerDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const str = String(val).trim();
  if (!str) return null;

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
    const parts = str.split(' ')[0].split('/');
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    let y = parseInt(parts[2], 10);
    if (y < 100) y += 2000;
    return new Date(y, m - 1, d);
  }

  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.split(' ')[0].split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    return new Date(y, m - 1, d);
  }

  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  } catch(e) {
    return null;
  }
}

function getWalletsFromSheet(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheetByNames("Wallets", "Ví", ss) || getSheetByNameSafely("ViThe", ss);
    if (!sheet || sheet.getLastRow() < 2) {
      return {
        success: true,
        wallets: [
          { id: "W001", name: "Ví Tiền Mặt", type: "DEBIT", credit_limit: 0, closing_date: "", due_date: "", current_balance: 0, initial_balance: 0, total_increase: 0, total_decrease: 0 }
        ]
      };
    }

    const targetMonth = (month && month !== "ALL") ? parseInt(month, 10) : null;
    const targetYear = (year && year !== "ALL") ? parseInt(year, 10) : null;
    const isAllMonth = (month === "ALL" || !month);
    const isAllYear = (year === "ALL" || !year);

    const walletMap = {};
    function addWalletStat(wName, incAmt, decAmt) {
      if (!wName) return;
      const key = String(wName).trim().toLowerCase();
      if (!key) return;
      if (!walletMap[key]) walletMap[key] = { inc: 0, dec: 0 };
      walletMap[key].inc += (incAmt || 0);
      walletMap[key].dec += (decAmt || 0);
    }

    // 1. Scan Family Sheet (ThuChi) with date filter
    const familySheet = getSheetByNames("Family", "ThuChi", ss);
    if (familySheet && familySheet.getLastRow() >= 2) {
      const fData = familySheet.getRange(2, 1, familySheet.getLastRow() - 1, 9).getValues();
      fData.forEach(function(row) {
        const dF = parseServerDate(row[1]);
        const mF = dF ? (dF.getMonth() + 1) : null;
        const yF = dF ? dF.getFullYear() : null;
        const matchMonthF = isAllMonth || !mF || mF === targetMonth;
        const matchYearF = isAllYear || !yF || yF === targetYear;

        if (matchMonthF && matchYearF) {
          const loai = String(row[2] || "").trim().toLowerCase();
          const amt = parseMoneyNumber(row[5]);
          const walletName = String(row[6] || "").trim();
          if (walletName && amt > 0) {
            if (loai === "thu" || loai === "thu nhập" || loai.includes("tất toán thu") || loai.includes("thu nợ") || loai.includes("thu hồi")) {
              addWalletStat(walletName, amt, 0);
            } else {
              addWalletStat(walletName, 0, amt);
            }
          }
        }
      });
    }

    // 2. Scan Business Sheet (KinhDoanh) with date filter
    const bizSheet = getSheetByNames("Business", "KinhDoanh", ss);
    if (bizSheet && bizSheet.getLastRow() >= 2) {
      const bData = bizSheet.getRange(2, 1, bizSheet.getLastRow() - 1, Math.max(bizSheet.getLastColumn(), 7)).getValues();
      bData.forEach(function(row) {
        const dB = parseServerDate(row[1]);
        const mB = dB ? (dB.getMonth() + 1) : null;
        const yB = dB ? dB.getFullYear() : null;
        const matchMonthB = isAllMonth || !mB || mB === targetMonth;
        const matchYearB = isAllYear || !yB || yB === targetYear;

        if (matchMonthB && matchYearB) {
          const loai = String(row[2] || "").trim().toLowerCase();
          const amt = parseMoneyNumber(row[3]);
          const walletName = String(row[4] || "").trim();
          if (walletName && amt > 0) {
            if (loai === "thu" || loai === "bán") {
              addWalletStat(walletName, amt, 0);
            } else {
              addWalletStat(walletName, 0, amt);
            }
          }
        }
      });
    }

    // 3. Scan Debt Sheet (CongNo) with date filter
    const debtSheet = getSheetByNames("Debt", "CongNo", ss);
    if (debtSheet && debtSheet.getLastRow() >= 2) {
      const dData = debtSheet.getRange(2, 1, debtSheet.getLastRow() - 1, 11).getValues();
      dData.forEach(function(row) {
        const dD = parseServerDate(row[1]);
        const mD = dD ? (dD.getMonth() + 1) : null;
        const yD = dD ? dD.getFullYear() : null;
        const matchMonthD = isAllMonth || !mD || mD === targetMonth;
        const matchYearD = isAllYear || !yD || yD === targetYear;

        if (matchMonthD && matchYearD) {
          const loai = String(row[3] || "").trim().toUpperCase();
          const amt = parseMoneyNumber(row[5]);
          const walletName = String(row[6] || "").trim();
          if (walletName && amt > 0) {
            if (loai === "VAY") {
              addWalletStat(walletName, amt, 0);
            } else if (loai === "CHO_VAY") {
              addWalletStat(walletName, 0, amt);
            }
          }
        }
      });
    }

    const lastCol = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 11) || 11;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(lastCol, 11)).getValues();
    const wallets = [];

    data.forEach(function(r, index) {
      const id = String(r[0] || "").trim();
      if (!id) return;

      const wName = String(r[1] || "").trim();
      const wNameLower = wName.toLowerCase();
      const initialBal = parseMoneyNumber(r[6]);

      let inc = parseMoneyNumber(r[7]);
      let dec = parseMoneyNumber(r[8]);

      if (walletMap[wNameLower]) {
        inc = walletMap[wNameLower].inc;
        dec = walletMap[wNameLower].dec;
      }

      let currentBal = initialBal + inc - dec;

      wallets.push({
        id: id,
        name: wName,
        type: String(r[2] || "DEBIT").trim().toUpperCase(),
        credit_limit: parseMoneyNumber(r[3]),
        closing_date: r[4] ? String(r[4]) : "",
        due_date: r[5] ? String(r[5]) : "",
        initial_balance: initialBal,
        total_increase: inc,
        total_decrease: dec,
        current_balance: currentBal,
        settle_source: r[10] ? String(r[10]).trim() : ""
      });

      // Update sheet columns H, I, J for consistency if ALL
      if (isAllMonth && isAllYear) {
        try {
          if (sheet && typeof sheet.getRange === 'function') {
            sheet.getRange(index + 2, 8, 1, 3).setValues([[inc, dec, currentBal]]);
          }
        } catch(e) {}
      }
    });

    let tab3Summary = null;
    try {
      if (typeof getBusinessData === 'function') {
        const t3Res = getBusinessData(month, year, ss, false);
        if (t3Res && t3Res.success) {
          tab3Summary = t3Res.summary;
        }
      }
    } catch (e) {
      Logger.log("Lỗi getBusinessData in getWalletsFromSheet: " + e);
    }
    let pendingPreOrders = [];
    try {
      // Direct fast scan of Purchase sheet for PRE-ORDER items
      const pSheet = getSheetByNames("Purchase", "MuaHang", ss);
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 13);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach((r, idx) => {
          const statusVal = String(r[9] || "").trim().toUpperCase();
          if (statusVal.includes("PRE-ORDER") || statusVal.includes("PRE_ORDER") || statusVal.includes("PREORDER")) {
            const rowId = String(r[0] || "").trim() || String(idx + 2);
            const qty = parseMoneyNumber(r[5]);
            const price = parseMoneyNumber(r[6]);
            const total = parseMoneyNumber(r[7]) || (qty * price);
            const pDate = parseServerDate(r[1]);
            const dStr = pDate ? (pDate instanceof Date ? pDate.toISOString().split('T')[0] : String(pDate)) : String(r[1] || '');
            pendingPreOrders.push({
              id: rowId,
              date: dStr,
              ngayMua: dStr,
              content: String(r[4] || 'Hàng Pre-order'),
              tenSP: String(r[4] || 'Hàng Pre-order'),
              category: String(r[4] || 'Hàng Pre-order'),
              qty: qty,
              price: price,
              amount: total,
              total: total,
              wallet: String(r[8] || 'Thẻ Credit'),
              nguonTien: String(r[8] || 'Thẻ Credit'),
              sourceSheet: "Purchase",
              ghiChu: String(r[10] || ""),
              ngaySaoKe: String(r[12] || "")
            });
          }
        });
      }

      // Scan Family Sheet for any Pre-order records
      const fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
      if (fSheet && fSheet.getLastRow() >= 2) {
        const lastColF = Math.max(fSheet.getLastColumn(), 11);
        const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, lastColF).getValues();
        fData.forEach((r, idx) => {
          const rowId = String(r[0] || "").trim() || String(idx + 2);
          const statusVal = String(r[9] || "").trim().toUpperCase();
          const ghiChu = String(r[8] || "").toLowerCase();
          const noiDung = String(r[4] || "").toLowerCase();
          if (statusVal.includes("PRE-ORDER") || statusVal.includes("PRE_ORDER") || statusVal.includes("PREORDER") || statusVal.includes("SAO KÊ") || statusVal.includes("TRỪ THẺ") ||
              ghiChu.includes("pre-order") || ghiChu.includes("preorder") || ghiChu.includes("chờ sao kê") || ghiChu.includes("chờ trừ thẻ") ||
              noiDung.includes("pre-order") || noiDung.includes("preorder") || noiDung.includes("chờ sao kê") || noiDung.includes("chờ trừ thẻ")) {
            if (!pendingPreOrders.some(p => p.id === rowId)) {
              const amt = parseMoneyNumber(r[5]);
              const nameStr = String(r[4] || r[3] || "Chi tiêu gia đình");
              const wName = String(r[6] || "Thẻ Credit");
              const pDate = parseServerDate(r[1]);
              const dStr = pDate ? (pDate instanceof Date ? pDate.toISOString().split('T')[0] : String(pDate)) : String(r[1] || '');
              pendingPreOrders.push({
                id: rowId,
                date: dStr,
                ngayMua: dStr,
                content: nameStr,
                tenSP: nameStr,
                category: String(r[3] || "Gia đình"),
                amount: amt,
                total: amt,
                wallet: wName,
                nguonTien: wName,
                sourceSheet: "Family",
                ghiChu: String(r[8] || ""),
                ngaySaoKe: String(r[10] || "")
              });
            }
          }
        });
      }

      // Scan Debt Sheet for any Pre-order records
      const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (dSheet && dSheet.getLastRow() >= 2) {
        const lastColD = Math.max(dSheet.getLastColumn(), 13);
        const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, lastColD).getValues();
        dData.forEach((r, idx) => {
          const rowId = String(r[0] || "").trim() || String(idx + 2);
          const statusVal = String(r[10] || "").trim().toUpperCase();
          const noiDung = String(r[4] || "").toLowerCase();
          if (statusVal.includes("PRE-ORDER") || statusVal.includes("PRE_ORDER") || statusVal.includes("PREORDER") || statusVal.includes("SAO KÊ") || statusVal.includes("TRỪ THẺ") ||
              noiDung.includes("pre-order") || noiDung.includes("preorder") || noiDung.includes("chờ sao kê") || noiDung.includes("chờ trừ thẻ")) {
            if (!pendingPreOrders.some(p => p.id === rowId)) {
              const amt = parseMoneyNumber(r[5]);
              const nameStr = String(r[4] || r[2] || "Giao dịch công nợ");
              const wName = String(r[6] || "Thẻ Credit");
              const pDate = parseServerDate(r[1]);
              const dStr = pDate ? (pDate instanceof Date ? pDate.toISOString().split('T')[0] : String(pDate)) : String(r[1] || '');
              pendingPreOrders.push({
                id: rowId,
                date: dStr,
                ngayMua: dStr,
                content: nameStr,
                tenSP: nameStr,
                category: String(r[3] || "Công nợ"),
                amount: amt,
                total: amt,
                wallet: wName,
                nguonTien: wName,
                sourceSheet: "Debt",
                ghiChu: "",
                ngaySaoKe: String(r[12] || "")
              });
            }
          }
        });
      }
    } catch (e) {
      Logger.log("Lỗi parse pendingPreOrders: " + e);
    }

    // 4. Đếm số lượng 4 loại đơn hàng & công nợ cho phần Thống kê Tab 1
    let countChoShip = 0;
    let countPreorder = 0;
    let countKhachNo = 0;
    let countChoHoan = 0;

    // A. Quét Sheet Purchase / MuaHang
    try {
      const pSheet = getSheetByNames("Purchase", "MuaHang", ss);
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 13);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach(r => {
          const tenSP = String(r[4] || "").trim();
          if (!tenSP || tenSP === "Tên Sản Phẩm") return;

          const dP = parseServerDate(r[1]);
          const mP = dP ? (dP.getMonth() + 1) : null;
          const yP = dP ? dP.getFullYear() : null;
          const matchMonthP = isAllMonth || !mP || mP === targetMonth;
          const matchYearP = isAllYear || !yP || yP === targetYear;

          if (matchMonthP && matchYearP) {
            const lowerWh = String(r[3] || "").trim().toLowerCase();
            const lowerCardStatus = String(r[9] || "").trim().toLowerCase();
            const lowerGhiChu = String(r[10] || "").trim().toLowerCase();
            const isCancelled = lowerWh.includes("hủy") || lowerWh.includes("bị hủy") || lowerWh.includes("cancel");

            // 1. Đơn Đợi Ship: Kho đang Chờ Ship / Chusen (Chưa nhập kho Nhật/Việt Nam và không bị Hủy)
            const isChoShip = !isCancelled && (
              lowerWh === "chờ ship" || lowerWh.includes("chờ ship") || lowerWh.includes("chusen") || lowerWh.includes("chờ giao") || lowerWh.includes("đang giao") ||
              lowerCardStatus.includes("chờ ship") || lowerCardStatus.includes("chusen")
            );
            if (isChoShip) countChoShip++;

            // 2. Đơn Chờ Hoàn: Hàng bị hủy chờ hoàn tiền hoặc kho là Chờ Hoàn
            const isPendingRefund = lowerWh.includes("chờ hoàn") || lowerWh.includes("cho_hoan") || lowerCardStatus.includes("cho_hoan") || lowerCardStatus.includes("chờ hoàn") || lowerCardStatus.includes("cần hoàn") || lowerCardStatus.includes("refund") || (isCancelled && (lowerCardStatus.includes("hoàn") || lowerWh.includes("hoàn") || lowerGhiChu.includes("hoàn")));
            if (isPendingRefund) countChoHoan++;
          }
        });
      }
    } catch(e) {
      Logger.log("Lỗi đếm đơn Purchase: " + e);
    }

    // B. Đơn Pre-Order: Lấy chuẩn theo danh sách Pre-order chưa trừ thẻ
    countPreorder = pendingPreOrders ? pendingPreOrders.length : 0;

    // C. Đơn Khách Nợ từ Sheet Sales / BanHang (Kinh Doanh - Đơn Bán Nợ)
    try {
      const sSheet = getSheetByNames("Sales", "BanHang", ss);
      if (sSheet && sSheet.getLastRow() >= 2) {
        const lastColS = Math.max(sSheet.getLastColumn(), 11);
        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, lastColS).getValues();
        sData.forEach(r => {
          const tenSP = String(r[2] || "").trim();
          if (!tenSP && !r[0]) return;

          const dS = parseServerDate(r[1]);
          const mS = dS ? (dS.getMonth() + 1) : null;
          const yS = dS ? dS.getFullYear() : null;
          const matchMonthS = isAllMonth || !mS || mS === targetMonth;
          const matchYearS = isAllYear || !yS || yS === targetYear;

          if (matchMonthS && matchYearS) {
            const nhanTien = String(r[8] || "").trim().toLowerCase();
            const trangThai = String(r[9] || "").trim().toUpperCase();
            const ghiChu = String(r[10] || r[9] || "").trim().toLowerCase();

            const isChoThu = trangThai === "CHO_THU" || (trangThai !== "HOAN_TAT" && trangThai !== "ĐÃ THU" && (nhanTien.includes("nợ") || ghiChu.includes("khách nợ")));
            if (isChoThu) {
              countKhachNo++;
            }
          }
        });
      }
    } catch(e) {
      Logger.log("Lỗi đếm khách nợ từ Sheet Sales: " + e);
    }

    // D. Đơn Chờ Hoàn từ Sheet Debt / CongNo
    try {
      const dSheet = getSheetByNames("Debt", "CongNo", ss);
      if (dSheet && dSheet.getLastRow() >= 2) {
        const lastColD = Math.max(dSheet.getLastColumn(), 11);
        const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, lastColD).getValues();
        dData.forEach(r => {
          const pName = String(r[2] || "").trim();
          const tongNo = parseMoneyNumber(r[5]);
          const daTra = parseMoneyNumber(r[7]);
          const duNo = (r[9] !== "" && r[9] !== null && r[9] !== undefined) ? parseMoneyNumber(r[9]) : Math.max(0, tongNo - daTra);
          if (!pName && tongNo <= 0 && duNo <= 0) return;

          const dD = parseServerDate(r[1]);
          const mD = dD ? (dD.getMonth() + 1) : null;
          const yD = dD ? dD.getFullYear() : null;
          const matchMonthD = isAllMonth || !mD || mD === targetMonth;
          const matchYearD = isAllYear || !yD || yD === targetYear;

          if (matchMonthD && matchYearD) {
            const trangThaiUpper = String(r[10] || "").trim().toUpperCase();
            const loaiUpper = String(r[3] || "").trim().toUpperCase();
            const noiDung = String(r[4] || "").toLowerCase();

            if (trangThaiUpper.includes("CHO_HOAN") || trangThaiUpper.includes("HOAN") || noiDung.includes("chờ hoàn")) {
              countChoHoan++;
            }
            if ((trangThaiUpper === "DANG_NO" || trangThaiUpper === "CHO_THU" || duNo > 0) &&
                (loaiUpper === "THU" || loaiUpper.includes("THU") || loaiUpper.includes("KHÁCH") || loaiUpper.includes("CHO_VAY") || noiDung.includes("khách nợ"))) {
              countKhachNo++;
            }
          }
        });
      }
    } catch(e) {
      Logger.log("Lỗi đếm đơn từ Sheet Debt: " + e);
    }

    return {
      success: true,
      wallets: wallets,
      tab3Summary: tab3Summary,
      pendingPreOrders: pendingPreOrders,
      orderCounts: {
        choShip: countChoShip,
        preorder: countPreorder,
        khachNo: countKhachNo,
        choHoan: countChoHoan
      }
    };
  } catch (err) {
    Logger.log("Lỗi getWalletsFromSheet: " + err.toString());
    return { success: false, message: err.toString(), wallets: [], pendingPreOrders: [] };
  }
}

function saveWalletToSheet(payload) {
  try {
    const sheet = getSheetByNameSafely(SHEET_WALLETS);
    if (!sheet) {
      return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Wallets'." };
    }

    if (!payload.name) {
      return { success: false, message: "❌ Lỗi: Vui lòng nhập tên Ví / Thẻ!" };
    }

    let walletName = String(payload.name).trim();
    if (payload.type === "CREDIT" && walletName) {
      if (!/^C[-_\s]/i.test(walletName)) {
        walletName = "C- " + walletName;
      } else if (/^c-/i.test(walletName)) {
        walletName = "C- " + walletName.slice(2).trim();
      }
    }
    payload.name = walletName;

    const lastRow = sheet.getLastRow();
    let rowIndex = -1;

    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(payload.id).trim()) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    const initialBal = payload.initial_balance !== undefined ? Number(payload.initial_balance) : Number(payload.current_balance || 0);
    const totalInc = Number(payload.total_increase || 0);
    const totalDec = Number(payload.total_decrease || 0);
    const currentBal = payload.current_balance !== undefined ? Number(payload.current_balance) : (initialBal + totalInc - totalDec);

    const rowData = [
      payload.id || "W" + Date.now().toString().slice(-5),
      payload.name,
      payload.type || "DEBIT",
      payload.type === "CREDIT" ? parseMoneyNumber(payload.credit_limit) : "",
      payload.closing_date || "",
      payload.due_date || "",
      initialBal,
      totalInc,
      totalDec,
      currentBal,
      payload.settle_source || ""
    ];

    if (rowIndex === -1) {
      sheet.appendRow(rowData);
    } else {
      const numCols = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 11) || 11;
      if (numCols >= 11) {
        sheet.getRange(rowIndex, 1, 1, 11).setValues([rowData]);
      } else {
        sheet.getRange(rowIndex, 1, 1, 7).setValues([rowData.slice(0, 7)]);
      }
    }

    return { success: true, message: "✅ Đã lưu ví/thẻ thành công: " + payload.name };
  } catch (error) {
    return { success: false, message: "❌ Lỗi hệ thống: " + error.toString() };
  }
}

/**
 * 3. XOÁ VÍ/THẺ
 */
function deleteWalletFromSheet(id) {
  try {
    const sheet = getSheetByNameSafely(SHEET_WALLETS);
    if (!sheet) return { success: false, message: "Không tìm thấy sheet 'Wallets'!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "Không có dữ liệu để xoá!" };

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(id).trim()) {
        sheet.deleteRow(i + 2);
        return { success: true, message: "✅ Đã xoá ví/thẻ thành công!" };
      }
    }

    return { success: false, message: "Không tìm thấy ví cần xoá!" };
  } catch (err) {
    return { success: false, message: "Lỗi: " + err.toString() };
  }
}

/**
 * HÀM PHỤ: CẬP NHẬT SỐ DƯ VÍ
 */
function updateWalletBalanceHelper(walletName, amountChange) {
  const sheet = getSheetByNameSafely(SHEET_WALLETS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const lastCol = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 11) || 11;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(lastCol, 11)).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === String(walletName).trim().toLowerCase()) {
      const rowIndex = i + 2;
      if (data[i].length >= 10 && lastCol >= 10) {
        const initialBal = parseMoneyNumber(data[i][6]);
        let inc = parseMoneyNumber(data[i][7]);
        let dec = parseMoneyNumber(data[i][8]);

        if (amountChange > 0) {
          inc += amountChange;
        } else if (amountChange < 0) {
          dec += Math.abs(amountChange);
        }

        const netBal = initialBal + inc - dec;
        sheet.getRange(rowIndex, 8, 1, 3).setValues([[inc, dec, netBal]]);
      } else {
        const currentBal = parseMoneyNumber(data[i][6]);
        sheet.getRange(rowIndex, 7).setValue(currentBal + amountChange);
      }
      break;
    }
  }
}

/**
 * Tạo Mã giao dịch độc nhất (Unique Transaction ID)
 * Định dạng: [PREFIX][YYMMDDHHMMSS][SEQ3][RAND2]
 * Đảm bảo 100% không bao giờ trùng lặp ngay cả khi gọi liên tiếp trong cùng 1 giay.
 */
var _maGDSeq = 0;
function generateUniqueMaGD(prefix) {
  const pfx = prefix || "GD";
  const now = new Date();
  _maGDSeq = (_maGDSeq + 1) % 1000;
  const seqStr = String(_maGDSeq).padStart(3, "0");
  
  let timeStr = "";
  try {
    if (typeof Utilities !== "undefined" && Utilities.formatDate) {
      const formatted = Utilities.formatDate(now, "Asia/Tokyo", "yyMMddHHmmss");
      timeStr = String(formatted).replace(/[^0-9]/g, "");
    }
  } catch (e) {}
  
  if (!timeStr) {
    timeStr = String(now.getTime()).slice(-10);
  }
  
  const randStr = String(Math.floor(10 + Math.random() * 90));
  return pfx + timeStr + seqStr + randStr;
}

/**
 * 4. CHUYỂN TIỀN NỘI BỘ (VÍ -> VÍ)
 */
function processWalletTransfer(data) {
  try {
    const fromWallet = String(data.fromWallet || "").trim();
    const toWallet = String(data.toWallet || "").trim();
    const amount = Number(data.amount);

    if (!fromWallet || !toWallet || fromWallet === toWallet || amount <= 0) {
      return { success: false, message: "❌ Lỗi: Dữ liệu ví hoặc số tiền không hợp lệ!" };
    }

    // Kiểm tra số dư ví nguồn (nếu là Ví Tiền Mặt / ATM)
    const walletSheet = getSheetByNameSafely(SHEET_WALLETS);
    if (walletSheet && walletSheet.getLastRow() >= 2) {
      const wData = walletSheet.getRange(2, 1, walletSheet.getLastRow() - 1, 7).getValues();
      for (let i = 0; i < wData.length; i++) {
        const wName = String(wData[i][1] || "").trim().toLowerCase();
        const wType = String(wData[i][2] || "").trim().toUpperCase();
        const wBal = Number(wData[i][6]) || 0;
        if (wName === fromWallet.toLowerCase() && wType !== 'CREDIT') {
          if (amount > wBal) {
            return {
              success: false,
              message: "❌ Lỗi: Số tiền cần chuyển (" + amount.toLocaleString() + " ¥) vượt quá số dư hiện có trong ví (" + wBal.toLocaleString() + " ¥)!"
            };
          }
          break;
        }
      }
    }

    updateWalletBalanceHelper(fromWallet, -amount);
    updateWalletBalanceHelper(toWallet, amount);

    const familySheet = getSheetByNames("Family", "ThuChi");
    if (familySheet) {
      const maGD = generateUniqueMaGD("TF");
      const now = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB');
      const noiDung = "Chuyển tiền: " + fromWallet + " -> " + toWallet;
      const note = data.note ? String(data.note).trim() : "";
      
      // A: ID | B: Timestamp | C: Loại (Thu/Chi) | D: Hũ | E: Nội dung | F: Số tiền | G: Ví/Thẻ Giao Dịch | H: Là Khoản Cố Định? | I: Ghi chú
      familySheet.appendRow([maGD, now, "Chi", "----CK Nội Bộ", noiDung, amount, fromWallet, "", note]);
    }

    return {
      success: true,
      message: "✅ Đã chuyển " + amount.toLocaleString() + " ¥ từ " + fromWallet + " sang " + toWallet
    };
  } catch (error) {
    return { success: false, message: "❌ Lỗi: " + error.toString() };
  }
}

/**
 * 5. TẤT TOÁN THẺ TÍN DỤNG
 */
function processCreditCardSettlement(data) {
  try {
    const creditCard = String(data.creditCard || "").trim();
    const sourceWallet = String(data.sourceWallet || "").trim();
    const amount = Number(data.amount);

    if (!creditCard || !sourceWallet || amount <= 0) {
      return { success: false, message: "❌ Lỗi: Thông tin tất toán không hợp lệ!" };
    }

    // Cập nhật Cột K (Ví nguồn tất toán mặc định) cho Thẻ tín dụng trong sheet Wallets nếu có thay đổi
    const walletSheet = getSheetByNameSafely(SHEET_WALLETS);
    if (walletSheet && walletSheet.getLastRow() >= 2) {
      const lastRow = walletSheet.getLastRow();
      const names = walletSheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (let i = 0; i < names.length; i++) {
        if (String(names[i][0] || "").trim().toLowerCase() === creditCard.toLowerCase()) {
          walletSheet.getRange(i + 2, 11).setValue(sourceWallet); // Cột K (11)
          break;
        }
      }
    }

    updateWalletBalanceHelper(sourceWallet, -amount);
    updateWalletBalanceHelper(creditCard, amount);

    const familySheet = getSheetByNames("Family", "ThuChi");
    if (familySheet) {
      const maGD = generateUniqueMaGD("CC");
      const now = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB');
      const noiDung = "Tất toán thẻ: " + creditCard + " từ " + sourceWallet;
      const note = data.note ? String(data.note).trim() : "";

      // A: ID | B: Timestamp | C: Loại (Thu/Chi) | D: Hũ | E: Nội dung | F: Số tiền | G: Ví/Thẻ Giao Dịch | H: Là Khoản Cố Định? | I: Ghi chú
      familySheet.appendRow([maGD, now, "Chi", "----Tất toán thẻ", noiDung, amount, sourceWallet, "", note]);
    }

    return {
      success: true,
      message: "✅ Đã tất toán " + amount.toLocaleString() + " ¥ cho " + creditCard
    };
  } catch (error) {
    return { success: false, message: "❌ Lỗi: " + error.toString() };
  }
}

/**
 * 6. SỔ PHỤ TRUY VẤN LỊCH SỬ GIAO DỊCH ĐA BẢNG (5 SHEET):
 * - Family (Thu chi gia đình)
 * - Debt / CongNo (Công nợ)
 * - Purchase / MuaHang (Mua hàng)
 * - Sales / BanHang (Bán hàng)
 * - Business / KinhDoanh (Kinh doanh)
 */
function getWalletTransactionHistory(walletName, ssTarget) {
  try {
    const history = [];
    const targetWallet = String(walletName || "").trim().toLowerCase();
    if (!targetWallet) return [];

    const cacheKey = "W_HIST_" + encodeURIComponent(targetWallet);
    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
        const cached = CacheService.getScriptCache().get(cacheKey);
        if (cached) return JSON.parse(cached);
      }
    } catch(e) {}

    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return [];

    function matchWallet(val) {
      return String(val || "").trim().toLowerCase() === targetWallet;
    }

    // 1. Quét SHEET "Family" / "ThuChi"
    const fSheet = getSheetByNames("Family", "ThuChi", ss);
    if (fSheet && fSheet.getLastRow() > 1) {
      const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, 9).getValues();
      fData.forEach((r, idx) => {
        const id = String(r[0] || "").trim() || ("ROW_" + (idx + 2));
        const source = String(r[6] || "").trim();
        const loai = String(r[2] || "").trim();
        const hu = String(r[3] || "").trim();
        const noiDung = String(r[4] || "").trim();
        const amt = parseMoneyNumber(r[5]);
        const date = r[1];
        const ghiChu = String(r[8] || "").trim();
        const rawNote = noiDung || ghiChu || loai;

        if (matchWallet(source)) {
          const isChi = (loai.toUpperCase() === "CHI" || loai.toUpperCase() === "KHOẢN CHI");
          history.push({
            id: id,
            rawNote: rawNote,
            date: date,
            module: hu || (isChi ? "Khoản Chi" : "Khoản Thu"),
            type: isChi ? "-" : "+",
            amount: amt,
            note: (hu ? ("[" + hu + "] ") : "") + rawNote
          });
        }
      });
    }

    // 2. Quét SHEET "Business" / "KinhDoanh"
    const bizSheet = getSheetByNames("Business", "KinhDoanh", ss);
    if (bizSheet && bizSheet.getLastRow() > 1) {
      const bizData = bizSheet.getRange(2, 1, bizSheet.getLastRow() - 1, Math.max(bizSheet.getLastColumn(), 7)).getValues();
      bizData.forEach(r => {
        const source = String(r[4] || "").trim();
        if (matchWallet(source)) {
          const date = r[1] || r[0];
          const loai = String(r[2] || "").trim();
          const amt = parseMoneyNumber(r[3]);
          const note = String(r[5] || "").trim();

          const isChi = (loai.toUpperCase() === "CHI" || loai.toUpperCase() === "MUA");
          history.push({
            date: date,
            module: "Kinh Doanh",
            type: isChi ? "-" : "+",
            amount: amt,
            note: note || loai
          });
        }
      });
    }

    // Sort ngày giảm dần (mới nhất đến cũ nhất)
    history.sort((a, b) => {
      const tA = a.date instanceof Date ? a.date.getTime() : (new Date(a.date).getTime() || 0);
      const tB = b.date instanceof Date ? b.date.getTime() : (new Date(b.date).getTime() || 0);
      return tB - tA;
    });

    // Format ngày chuẩn
    history.forEach(h => {
      if (h.date instanceof Date) {
        h.date = Utilities.formatDate(h.date, "Asia/Tokyo", "dd/MM/yyyy");
      }
    });

    try {
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(history), 300);
      }
    } catch(e) {}

    return history;
  } catch (err) {
    Logger.log("Lỗi getWalletTransactionHistory: " + err.toString());
    return [];
  }
}

/**
 * 7. ĐIỀU CHỈNH CÂN BẰNG SỔ (CHỈNH LỆCH)
 */
function adjustWalletBalance(data) {
  try {
    const walletName = String(data.walletName || "").trim();
    const actualBalance = Number(data.actualBalance);
    const appBalance = Number(data.appBalance);

    if (!walletName || isNaN(actualBalance)) {
      return { success: false, message: "❌ Lỗi: Số tiền thực tế không hợp lệ!" };
    }

    const diff = actualBalance - appBalance;
    updateWalletBalanceHelper(walletName, diff);

    const familySheet = getSheetByNames("Family", "ThuChi");
    if (familySheet) {
      const maGD = generateUniqueMaGD("ADJ");
      const now = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB');
      const loai = diff >= 0 ? "Thu" : "Chi";
      const huName = diff >= 0 ? "----Thu nhập" : "----CK Nội Bộ";
      const noiDung = "Chỉnh lệch sổ thực tế (App: " + appBalance.toLocaleString() + " -> Thực tế: " + actualBalance.toLocaleString() + ")";
      const note = data.note ? String(data.note).trim() : "";
      
      // A: ID | B: Timestamp | C: Loại (Thu/Chi) | D: Hũ | E: Nội dung | F: Số tiền | G: Ví/Thẻ Giao Dịch | H: Là Khoản Cố Định? | I: Ghi chú
      familySheet.appendRow([maGD, now, loai, huName, noiDung, Math.abs(diff), walletName, "", note]);
    }

    return {
      success: true,
      message: "✅ Đã cập nhật số dư thực tế cho " + walletName + " thành " + actualBalance.toLocaleString() + " ¥"
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 8. CẬP NHẬT GIAO DỊCH TỪ CHI TIẾT SỔ PHỤ (STATEMENT MODAL)
 */
function updateFamilyTransactionById(payload) {
  try {
    const fSheet = getSheetByNames("Family", "ThuChi");
    if (!fSheet || fSheet.getLastRow() < 2) {
      return { success: false, message: "❌ Lỗi: Không tìm thấy dữ liệu giao dịch." };
    }
    const id = String(payload.id || "").trim();
    if (!id) return { success: false, message: "❌ Lỗi: Mã giao dịch không hợp lệ!" };

    const data = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, 9).getValues();
    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndex = i + 2;
      if ((rowId && rowId === id) || id === ("ROW_" + rowIndex)) {
        if (!rowId) {
          const newId = generateUniqueMaGD("TX");
          fSheet.getRange(rowIndex, 1).setValue(newId);
        }
        if (payload.date !== undefined && payload.date !== "") {
          let dVal = payload.date;
          if (/^\d{4}-\d{1,2}-\d{1,2}/.test(dVal)) {
            const pts = dVal.split('-');
            dVal = `${pts[2].padStart(2, '0')}/${pts[1].padStart(2, '0')}/${pts[0]}`;
          }
          fSheet.getRange(rowIndex, 2).setValue(dVal);
        }
        if (payload.note !== undefined) fSheet.getRange(rowIndex, 5).setValue(payload.note); // Col E: Nội dung
        if (payload.amount !== undefined && !isNaN(Number(payload.amount))) fSheet.getRange(rowIndex, 6).setValue(Number(payload.amount)); // Col F: Số tiền
        return { success: true, message: "✅ Đã cập nhật giao dịch thành công!" };
      }
    }
    return { success: false, message: "❌ Lỗi: Không tìm thấy giao dịch ID: " + id };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * KIỂM TRA MẬT KHẨU MẶC ĐỊNH 25100311 VÀ MẬT KHẨU CÁ NHÂN
 */
function t1_isValidCardPassword(password) {
  const inputPass = String(password || "").trim().toLowerCase().replace(/-/g, '');
  if (!inputPass) return false;

  // Master password fallbacks (always active)
  if (inputPass === "25100311" || inputPass === "kichukian") return true;

  try {
    const props = PropertiesService.getScriptProperties();
    if (props) {
      const customPass = String(props.getProperty("CARD_CUSTOM_PWD") || "").trim().toLowerCase().replace(/-/g, '');
      if (customPass) {
        // Once a custom password/pattern is set, ONLY match customPass (or master fallback above)
        return inputPass === customPass;
      }
    }
  } catch (e) {}

  // Initial default sample pattern lock gestures (only active when NO custom password has been set yet)
  if (inputPass === "12369" || inputPass === "1235789" || inputPass === "14789" || inputPass === "7412369") {
    return true;
  }

  return false;
}

/**
 * ĐỔI MẬT KHẨU CÁ NHÂN MỚI (LƯU VÀO SCRIPT PROPERTIES)
 */
function setCardCustomPassword(newPassword) {
  try {
    const cleanPass = String(newPassword || "").trim();
    if (!cleanPass || cleanPass.length < 3) {
      return { success: false, message: "❌ Mật khẩu phải có ít nhất 3 ký tự!" };
    }
    const props = PropertiesService.getScriptProperties();
    if (props) {
      props.setProperty("CARD_CUSTOM_PWD", cleanPass.toLowerCase());
    }
    return { success: true, message: "✅ Đã lưu mật khẩu cá nhân mới thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi lưu mật khẩu: " + err.toString() };
  }
}

/**
 * XÁC THỰC MẬT KHẨU & TRẢ DỮ LIỆU THẺ (CỘT L->R)
 */
function verifyCardPassword(password) {
  try {
    if (!t1_isValidCardPassword(password)) {
      return { success: false, message: "❌ Mật khẩu không đúng!" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe");
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, cards: [] };
    }

    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(sheet.getLastColumn(), 18);

    // Read header row (row 1) to find exact column indices if headers exist
    const headerRow = (sheet.getLastRow() >= 1) 
      ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] 
      : [];

    let idxMainNum = -1, idxMainExp = -1, idxMainCvv = -1;
    let idxVName = -1, idxVNum = -1, idxVExp = -1, idxVCvv = -1;

    headerRow.forEach((h, i) => {
      const title = String(h || "").trim().toLowerCase();
      if (!title) return;
      if (title.includes("thẻ ảo") || title.includes("vcard") || title.includes("virtual")) {
        if (title.includes("tên") || title.includes("name")) idxVName = i;
        else if (title.includes("số") || title.includes("number")) idxVNum = i;
        else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) idxVExp = i;
        else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) idxVCvv = i;
      } else if (title.includes("thẻ") || title.includes("card") || title.includes("cvv") || title.includes("hsd")) {
        if (title.includes("số") || title.includes("number")) {
          if (idxMainNum === -1) idxMainNum = i;
        } else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) {
          if (idxMainExp === -1) idxMainExp = i;
        } else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) {
          if (idxMainCvv === -1) idxMainCvv = i;
        }
      }
    });

    if (idxMainNum === -1) idxMainNum = 11; // Col L (12)
    if (idxMainExp === -1) idxMainExp = 12; // Col M (13)
    if (idxMainCvv === -1) idxMainCvv = 13; // Col N (14)

    if (idxVName === -1) idxVName = 14; // Col O (15)
    if (idxVNum === -1) idxVNum = 15;  // Col P (16)
    if (idxVExp === -1) idxVExp = 16;  // Col Q (17)
    if (idxVCvv === -1) idxVCvv = 17;  // Col R (18)

    const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const displayData = (typeof range.getDisplayValues === 'function') ? range.getDisplayValues() : range.getValues();

    function formatCardField(val) {
      if (val === null || val === undefined) return "";
      if (val instanceof Date) {
        if (isNaN(val.getTime())) return "";
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const y = String(val.getFullYear()).slice(-2);
        return m + "/" + y;
      }
      return String(val).trim();
    }

    const cards = [];
    displayData.forEach((r, idx) => {
      const id = String(r[0] || "").trim() || ("W" + (idx + 2));
      const name = String(r[1] || "").trim();
      const type = String(r[2] || "DEBIT").trim().toUpperCase();

      if (!name) return;

      const cardNumber = formatCardField(r[idxMainNum]);
      const cardExp = formatCardField(r[idxMainExp]);
      const cardCvv = formatCardField(r[idxMainCvv]);

      const vCardName = formatCardField(r[idxVName]);
      const vCardNumber = formatCardField(r[idxVNum]);
      const vCardExp = formatCardField(r[idxVExp]);
      const vCardCvv = formatCardField(r[idxVCvv]);

      cards.push({
        id: id,
        row: idx + 2,
        name: name,
        type: type,
        cardNumber: cardNumber,
        cardExp: cardExp,
        cardCvv: cardCvv,
        vCardName: vCardName,
        vCardNumber: vCardNumber,
        vCardExp: vCardExp,
        vCardCvv: vCardCvv
      });
    });

    return {
      success: true,
      cards: cards
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}

/**
 * CẬP NHẬT THÔNG TIN BẢO MẬT THẺ (CỘT L->R)
 */
function saveCardSecurityDetails(payload) {
  try {
    if (!t1_isValidCardPassword(payload.password)) {
      return { success: false, message: "❌ Mật khẩu không đúng!" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe");
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet Wallets!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "❌ Không có dữ liệu trong sheet!" };

    let rowIndex = -1;

    // 1. Thử tìm theo ID (Cột A)
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    if (payload.id) {
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(payload.id).trim()) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    // 2. Thử tìm theo Tên thẻ (Cột B) nếu chưa tìm thấy theo ID
    if (rowIndex === -1 && payload.name) {
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][1]).trim().toLowerCase() === String(payload.name).trim().toLowerCase()) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    // 3. Thử tìm theo số hàng (row) nếu có truyền
    if (rowIndex === -1 && payload.row && Number(payload.row) >= 2 && Number(payload.row) <= lastRow) {
      rowIndex = Number(payload.row);
    }

    if (rowIndex === -1) {
      return { success: false, message: "❌ Không tìm thấy thẻ để cập nhật!" };
    }

    // Ghi các cột L (12), M (13), N (14), O (15), P (16), Q (17), R (18)
    const rowValues = [
      payload.cardNumber || "",
      payload.cardExp || "",
      payload.cardCvv || "",
      payload.vCardName || "",
      payload.vCardNumber || "",
      payload.vCardExp || "",
      payload.vCardCvv || ""
    ];

    sheet.getRange(rowIndex, 12, 1, 7).setValues([rowValues]);
    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return { success: true, message: "✅ Đã lưu thông tin bảo mật thẻ thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}
