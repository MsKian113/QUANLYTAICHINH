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
function getWalletsFromSheet(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_WALLETS) : null;
    if (!sheet || sheet.getLastRow() < 2) {
      return {
        success: true,
        wallets: [
          { id: "W001", name: "Thẻ Rakuten (VISA)", type: "CREDIT", credit_limit: 500000, closing_date: 15, due_date: 27, current_balance: -50000, initial_balance: 0, total_increase: 0, total_decrease: 50000 },
          { id: "W002", name: "Thẻ Ufj (ATM)", type: "DEBIT", credit_limit: 0, closing_date: "", due_date: "", current_balance: 800000, initial_balance: 800000, total_increase: 0, total_decrease: 0 },
          { id: "W003", name: "Ví Tiền Mặt", type: "DEBIT", credit_limit: 0, closing_date: "", due_date: "", current_balance: 500000, initial_balance: 500000, total_increase: 0, total_decrease: 0 }
        ]
      };
    }

    const familyMap = {};
    const familySheet = getSheetByNames("Family", "ThuChi", ss);
    if (familySheet && familySheet.getLastRow() >= 2) {
      const fData = familySheet.getRange(2, 1, familySheet.getLastRow() - 1, 9).getValues();
      fData.forEach(function(row) {
        const loai = String(row[2] || "").trim().toLowerCase();
        const amt = parseMoneyNumber(row[5]);
        const walletName = String(row[6] || "").trim().toLowerCase();
        if (walletName && amt > 0) {
          if (!familyMap[walletName]) {
            familyMap[walletName] = { inc: 0, dec: 0 };
          }
          if (loai === "thu" || loai === "thu nhập" || loai.includes("tất toán") || loai.includes("thanh toán")) {
            familyMap[walletName].inc += amt;
          } else {
            familyMap[walletName].dec += amt;
          }
        }
      });
    }

    const lastCol = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 11) || 11;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(lastCol, 11)).getValues();
    const wallets = [];

    data.forEach(function(r) {
      const id = String(r[0] || "").trim();
      if (!id) return;

      const wName = String(r[1] || "").trim();
      const wNameLower = wName.toLowerCase();
      const initialBal = parseMoneyNumber(r[6]);

      let inc = parseMoneyNumber(r[7]);
      let dec = parseMoneyNumber(r[8]);

      if (familyMap[wNameLower]) {
        if (inc === 0) inc = familyMap[wNameLower].inc;
        if (dec === 0) dec = familyMap[wNameLower].dec;
      }

      let currentBal = initialBal + inc - Math.abs(dec);

      // 11-column schema: A: ID, B: Tên, C: Phân loại, D: Hạn mức, E: Chốt, F: Đáo hạn, G: Ban đầu, H: Tăng, I: Giảm, J: Hiện tại, K: Ví nguồn
      if (r.length >= 10 && (r[9] !== "" && r[9] !== null && r[9] !== undefined)) {
        currentBal = parseMoneyNumber(r[9]);
      }

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
    });

    return {
      success: true,
      wallets: wallets
    };
  } catch (err) {
    Logger.log("Lỗi getWalletsFromSheet: " + err.toString());
    return { success: false, message: err.toString(), wallets: [] };
  }
}

/**
 * 2. LƯU HOẶC CẬP NHẬT VÍ/THẺ
 */
function saveWalletToSheet(payload) {
  try {
    const sheet = getSheetByNameSafely(SHEET_WALLETS);
    if (!sheet) {
      return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Wallets'." };
    }

    if (!payload.name) {
      return { success: false, message: "❌ Lỗi: Vui lòng nhập tên Ví / Thẻ!" };
    }

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

    const allSheets = ss.getSheets();
    const sheetMap = {};
    allSheets.forEach(s => {
      sheetMap[s.getName().toLowerCase()] = s;
    });

    function getSheetFromMap(...names) {
      for (let n of names) {
        const key = n.toLowerCase();
        if (sheetMap[key]) return sheetMap[key];
      }
      return null;
    }

    function matchWallet(val) {
      return String(val || "").trim().toLowerCase() === targetWallet;
    }

    // 1. Quét SHEET "Family" / "ThuChi"
    const fSheet = getSheetFromMap("Family", "ThuChi");
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

        // Nhận chuyển khoản nội bộ
        if (
          (hu.indexOf("CK Nội Bộ") > -1 || hu.indexOf("Chuyển Ví") > -1 || noiDung.indexOf("Chuyển tiền:") > -1) &&
          (noiDung.indexOf("-> " + String(walletName).trim()) > -1 || ghiChu.indexOf("-> " + String(walletName).trim()) > -1) &&
          !matchWallet(source)
        ) {
          history.push({
            id: id,
            rawNote: rawNote,
            date: date,
            module: "Chuyển Ví",
            type: "+",
            amount: amt,
            note: noiDung || ghiChu
          });
        }

        // Nhận tất toán thẻ
        if (
          (hu.indexOf("Tất toán thẻ") > -1 || noiDung.indexOf("Tất toán thẻ:") > -1) &&
          (noiDung.indexOf("Tất toán thẻ: " + String(walletName).trim()) > -1 || noiDung.indexOf(String(walletName).trim()) > -1) &&
          !matchWallet(source)
        ) {
          history.push({
            id: id,
            rawNote: rawNote,
            date: date,
            module: "Tất toán Thẻ",
            type: "+",
            amount: amt,
            note: noiDung || ghiChu
          });
        }
      });
    }

    // 2. Quét SHEET "Debt" / "CongNo"
    const cnSheet = getSheetFromMap("Debt", "CongNo");
    if (cnSheet && cnSheet.getLastRow() > 1) {
      const cnData = cnSheet.getRange(2, 1, cnSheet.getLastRow() - 1, 10).getValues();
      cnData.forEach(r => {
        const source = String(r[6] || r[7] || "").trim();
        if (matchWallet(source)) {
          const date = r[1] || r[0];
          const partner = String(r[2] || "").trim();
          const loaiCN = String(r[3] || "").trim();
          const amt = parseMoneyNumber(r[5]);
          const note = String(r[4] || r[7] || "").trim();
          
          const isOut = (loaiCN === "Cho vay" || loaiCN === "Trả nợ");
          history.push({
            date: date,
            module: "Công Nợ",
            type: isOut ? "-" : "+",
            amount: amt,
            note: loaiCN + (partner ? (" - " + partner) : "") + (note ? (" (" + note + ")") : "")
          });
        }
      });
    }

    // 3. Quét SHEET "Purchase" / "MuaHang"
    const purSheet = getSheetFromMap("Purchase", "MuaHang");
    if (purSheet && purSheet.getLastRow() > 1) {
      const purData = purSheet.getRange(2, 1, purSheet.getLastRow() - 1, 12).getValues();
      purData.forEach(r => {
        let source = String(r[2] || "").trim();
        if (!source) source = String(r[7] || r[8] || "").trim();

        if (matchWallet(source)) {
          const date = r[0] || r[1];
          const tenSP = String(r[4] || r[3] || "Hàng hóa").trim();
          const amt = parseMoneyNumber(r[6] || r[5]);

          history.push({
            date: date,
            module: "Mua Hàng",
            type: "-",
            amount: amt,
            note: "Nhập hàng: " + tenSP
          });
        }
      });
    }

    // 4. Quét SHEET "Sales" / "BanHang"
    const salesSheet = getSheetFromMap("Sales", "BanHang");
    if (salesSheet && salesSheet.getLastRow() > 1) {
      const salesData = salesSheet.getRange(2, 1, salesSheet.getLastRow() - 1, 12).getValues();
      salesData.forEach(r => {
        let source = String(r[7] || r[6] || r[3] || "").trim();
        if (matchWallet(source)) {
          const date = r[0] || r[1];
          const tenSP = String(r[3] || r[2] || "Hàng hóa").trim();
          const amt = parseMoneyNumber(r[5] || r[6]);

          history.push({
            date: date,
            module: "Bán Hàng",
            type: "+",
            amount: amt,
            note: "Bán hàng: " + tenSP
          });
        }
      });
    }

    // 5. Quét SHEET "Business" / "KinhDoanh"
    const bizSheet = getSheetFromMap("Business", "KinhDoanh");
    if (bizSheet && bizSheet.getLastRow() > 1) {
      const bizData = bizSheet.getRange(2, 1, bizSheet.getLastRow() - 1, 10).getValues();
      bizData.forEach(r => {
        const source = String(r[6] || r[5] || "").trim();
        if (matchWallet(source)) {
          const date = r[1] || r[0];
          const loai = String(r[2] || r[3] || "").trim();
          const amt = parseMoneyNumber(r[4] || r[5]);
          const note = String(r[5] || r[6] || r[3] || "").trim();

          const isChi = (loai.toUpperCase() === "CHI" || loai.toUpperCase() === "KHOẢN CHI");
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
    Logger.log("Lỗi getWalletTransactionHistory multi-sheet: " + err.toString());
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
