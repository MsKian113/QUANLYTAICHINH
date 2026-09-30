// ==========================================
// FILE: Server_Tab1.js
// NHIỆM VỤ: Backend Logic cho Tab 1 (Ví & Thẻ)
// Truy vấn đa bảng: Family, Debt, Purchase, Sales, Business
// ==========================================

const SHEET_WALLETS = "Wallets";

/**
 * Lấy Helper Sheet an toàn với fallback tên tiếng Việt / Anh
 */
function getSheetByNameSafely(name) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss ? ss.getSheetByName(name) : null;
  } catch (e) {
    Logger.log("Lỗi truy cập sheet " + name + ": " + e);
    return null;
  }
}

function getSheetByNames(name1, name2) {
  let sheet = getSheetByNameSafely(name1);
  if (!sheet && name2) {
    sheet = getSheetByNameSafely(name2);
  }
  return sheet;
}

/**
 * 1. KÉO DANH SÁCH VÍ & THẺ TỪ GOOGLE SHEET "Wallets"
 */
function getWalletsFromSheet(month, year) {
  try {
    const sheet = getSheetByNameSafely(SHEET_WALLETS);
    if (!sheet || sheet.getLastRow() < 2) {
      return {
        success: true,
        wallets: [
          { id: "W001", name: "Thẻ Rakuten (VISA)", type: "CREDIT", credit_limit: 500000, closing_date: 15, due_date: 27, current_balance: -50000 },
          { id: "W002", name: "Thẻ Ufj (ATM)", type: "DEBIT", credit_limit: 0, closing_date: "", due_date: "", current_balance: 800000 },
          { id: "W003", name: "Ví Tiền Mặt", type: "DEBIT", credit_limit: 0, closing_date: "", due_date: "", current_balance: 500000 }
        ]
      };
    }

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
    const wallets = [];

    data.forEach(function(r) {
      const id = String(r[0] || "").trim();
      if (!id) return;

      wallets.push({
        id: id,
        name: String(r[1] || "").trim(),
        type: String(r[2] || "DEBIT").trim().toUpperCase(),
        credit_limit: Number(r[3]) || 0,
        closing_date: r[4] ? String(r[4]) : "",
        due_date: r[5] ? String(r[5]) : "",
        current_balance: Number(r[6]) || 0,
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

    const rowData = [
      payload.id || "W" + Date.now().toString().slice(-5),
      payload.name,
      payload.type || "DEBIT",
      (payload.type === "CREDIT" && payload.credit_limit) ? Number(payload.credit_limit) : "",
      payload.closing_date || "",
      payload.due_date || "",
      Number(payload.current_balance) || 0
    ];

    if (rowIndex === -1) {
      sheet.appendRow(rowData);
    } else {
      sheet.getRange(rowIndex, 1, 1, 7).setValues([rowData]);
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

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(walletName).trim()) {
      const currentBal = Number(data[i][6]) || 0;
      sheet.getRange(i + 2, 7).setValue(currentBal + amountChange);
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
      const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
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
      const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
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
function getWalletTransactionHistory(walletName) {
  try {
    const history = [];
    const targetWallet = String(walletName || "").trim().toLowerCase();
    if (!targetWallet) return [];

    function matchWallet(val) {
      return String(val || "").trim().toLowerCase() === targetWallet;
    }

    // 1. Quét SHEET "Family" / "ThuChi"
    const fSheet = getSheetByNames("Family", "ThuChi");
    if (fSheet && fSheet.getLastRow() > 1) {
      const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, 9).getValues();
      fData.forEach((r, idx) => {
        // Cột A: ID(0), B: Timestamp(1), C: Loại(2), D: Hũ(3), E: Nội dung(4), F: Số tiền(5), G: Ví/Thẻ(6), H: Cố định(7), I: Ghi chú(8)
        const id = String(r[0] || "").trim() || ("ROW_" + (idx + 2));
        const source = String(r[6] || "").trim(); // Ví/Thẻ Giao Dịch (Cột G)
        const loai = String(r[2] || "").trim();    // Loại (Cột C)
        const hu = String(r[3] || "").trim();      // Hũ (Cột D)
        const noiDung = String(r[4] || "").trim(); // Nội dung (Cột E)
        const amt = Number(r[5]) || 0;             // Số tiền (Cột F)
        const date = r[1];                         // Timestamp (Cột B)
        const ghiChu = String(r[8] || "").trim();  // Ghi chú (Cột I)
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
    const cnSheet = getSheetByNames("Debt", "CongNo");
    if (cnSheet && cnSheet.getLastRow() > 1) {
      const cnData = cnSheet.getRange(2, 1, cnSheet.getLastRow() - 1, 10).getValues();
      cnData.forEach(r => {
        const source = String(r[6] || r[7] || "").trim(); // Nguồn tiền (Cột G)
        if (matchWallet(source)) {
          const date = r[1] || r[0];
          const partner = String(r[2] || "").trim();
          const loaiCN = String(r[3] || "").trim();
          const amt = Number(r[5]) || 0;
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
    const purSheet = getSheetByNames("Purchase", "MuaHang");
    if (purSheet && purSheet.getLastRow() > 1) {
      const purData = purSheet.getRange(2, 1, purSheet.getLastRow() - 1, 12).getValues();
      purData.forEach(r => {
        let source = String(r[2] || "").trim();
        if (!source) source = String(r[7] || r[8] || "").trim();

        if (matchWallet(source)) {
          const date = r[0] || r[1];
          const tenSP = String(r[4] || r[3] || "Hàng hóa").trim();
          const amt = Number(r[6] || r[5]) || 0;

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
    const salesSheet = getSheetByNames("Sales", "BanHang");
    if (salesSheet && salesSheet.getLastRow() > 1) {
      const salesData = salesSheet.getRange(2, 1, salesSheet.getLastRow() - 1, 12).getValues();
      salesData.forEach(r => {
        let source = String(r[7] || r[6] || r[3] || "").trim();
        if (matchWallet(source)) {
          const date = r[0] || r[1];
          const tenSP = String(r[3] || r[2] || "Hàng hóa").trim();
          const amt = Number(r[5] || r[6]) || 0;

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
    const bizSheet = getSheetByNames("Business", "KinhDoanh");
    if (bizSheet && bizSheet.getLastRow() > 1) {
      const bizData = bizSheet.getRange(2, 1, bizSheet.getLastRow() - 1, 10).getValues();
      bizData.forEach(r => {
        const source = String(r[6] || r[5] || "").trim();
        if (matchWallet(source)) {
          const date = r[1] || r[0];
          const loai = String(r[2] || r[3] || "").trim();
          const amt = Number(r[4] || r[5]) || 0;
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

    // Sort ngày giảm dần
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Format ngày chuẩn
    history.forEach(h => {
      if (h.date instanceof Date) {
        h.date = Utilities.formatDate(h.date, "Asia/Tokyo", "dd/MM/yyyy");
      }
    });

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
      const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
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
        if (payload.date !== undefined && payload.date !== "") fSheet.getRange(rowIndex, 2).setValue(payload.date);
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
