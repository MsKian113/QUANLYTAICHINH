// ==========================================
// FILE: Server_Tab2.js
// NHIỆM VỤ: Xử lý toàn bộ Backend/Logic của Tab 2 (Thu Chi & Quản Lý Hũ)
// ==========================================

const SHEET_FAMILY = "Family";
const SHEET_CATEGORIES = "Categories";
const SHEET_JAR = "JAR";
const SHEET_WALLETS_T2 = "Wallets";

function getFamilySheetHelper(ssTarget) {
  const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  let sheet = ss.getSheetByName(SHEET_FAMILY) || ss.getSheetByName("ThuChi") || ss.getSheetByName("FAMILY") || ss.getSheetByName("THUCHI");
  if (!sheet && ss) {
    sheet = ss.insertSheet(SHEET_FAMILY);
    sheet.appendRow(["ID", "Timestamp", "Loại", "Hũ", "Nội dung", "Số tiền", "Ví/Thẻ Giao Dịch", "Là Khoản Cố Định?", "Ghi chú", "Trạng thái", "Ngày sao kê"]);
  }
  return sheet;
}

function formatToDDMMYYYY(val) {
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
 * 1. LẤY DỮ LIỆU BAN ĐẦU (CATEGORIES & WALLETS SUGGESTIONS)
 */
function getInitialData(ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    let categories = [
      { name: "Đổ xăng Eneos", jar: "Thiết yếu", source: "Thẻ Rakuten" },
      { name: "Đi siêu thị Aeon", jar: "Thiết yếu", source: "Ví Tiền Mặt" },
      { name: "Tiền nhà Leo", jar: "Thiết yếu", source: "Thẻ Ufj" },
      { name: "Đóng tiền mạng", jar: "Thiết yếu", source: "Thẻ Rakuten" },
      { name: "Nhận lương tháng", jar: "Tiết kiệm", source: "Thẻ Ufj" },
      { name: "Mua đồ Donki", jar: "Giải trí", source: "Ví Tiền Mặt" },
      { name: "Ăn nhà hàng", jar: "Giải trí", source: "Thẻ Rakuten" },
      { name: "Cà phê Starbucks", jar: "Giải trí", source: "PayPay" }
    ];
    let wRes = typeof getWalletsFromSheet === 'function' ? getWalletsFromSheet(null, null, ss) : null;
    let rawW = (wRes && Array.isArray(wRes.wallets)) ? wRes.wallets : (Array.isArray(wRes) ? wRes : []);
    let wallets = rawW.map(w => typeof w === 'object' ? (w.name || w.ten || '') : String(w));

    let accounts = ["Joshin KA", "Joshin Chi", "Joshin Giao", "Edion Ka", "Edion Chi", "Yodo KA", "Yodo Chi", "Yodo Chít", "Yodo 602", "Yodo 303", "Yodo Trinh", "Yodo Giao"];

    if (ss) {
      // 1. Đọc sheet "Categories" (Cột B: Mẫu Nội Dung, Cột C: Map Hũ, Cột D: Map Nguồn, Cột K / Cột G: Danh sách Tài khoản)
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES) || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const lastRow = catSheet.getLastRow();
        const lastCol = Math.max(catSheet.getLastColumn(), 11);
        const catData = catSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        const customCats = [];
        const customAccounts = [];
        catData.forEach(r => {
          // Ưu tiên Cột B (index 1: Mẫu Nội dung), Cột C (index 2: Hũ mẫu), Cột D (index 3: Ví/Nguồn mẫu)
          let name = String(r[1] || "").trim();
          let jar = String(r[2] || "").trim();
          let source = String(r[3] || "").trim();
          
          // Fallback legacy columns (Cột H index 7, Cột I index 8, Cột J index 9, Cột D index 3)
          if (!name) name = String(r[7] || r[3] || r[0] || "").trim();
          if (!jar) jar = String(r[8] || r[4] || r[1] || "").trim();
          if (!source) source = String(r[9] || r[5] || r[2] || "").trim();
          
          if (name && !["Nội dung", "Nội dung mẫu", "Tên Mẫu", "Mẫu Nội Dung Thu Chi"].includes(name)) {
            customCats.push({ name: name, jar: jar, source: source });
          }

          // Tài khoản mua từ Cột K (index 10) hoặc Cột G (index 6)
          const accK = String(r[10] || "").trim();
          const accG = String(r[6] || "").trim();
          [accK, accG].forEach(acc => {
            if (acc && !["Tài khoản mua", "Tài khoản", "Tài khoản đặt hàng", "TK Mua", "Danh sách Tài khoản", "Tài Khoản Đặt Hàng"].includes(acc) && !customAccounts.includes(acc)) {
              customAccounts.push(acc);
            }
          });
        });
        if (customCats.length > 0) categories = customCats;
        if (customAccounts.length > 0) accounts = customAccounts;
      }

      // 2. Đọc sheet "Wallets" (Cột B: Tên Ví/Thẻ Giao Dịch, fallback Cột A)
      const walletSheet = ss.getSheetByName(SHEET_WALLETS_T2) || ss.getSheetByName("Ví") || ss.getSheetByName("Wallets");
      if (walletSheet && walletSheet.getLastRow() >= 2) {
        const lastRow = walletSheet.getLastRow();
        const wData = walletSheet.getRange(2, 1, lastRow - 1, 3).getValues();
        const customWallets = [];
        wData.forEach(r => {
          let name = String(r[1] || "").trim();
          const ignoredHeaders = ["Tên Ví", "Tên Ví / Thẻ", "Tên ví", "ID", "Tên Ví/Thẻ Giao Dịch", "Tên Ví / Thẻ Giao Dịch"];
          if (name && !ignoredHeaders.includes(name) && !customWallets.includes(name)) {
            customWallets.push(name);
          }
        });
        if (customWallets.length > 0) wallets = customWallets;
      }
    }

    return {
      success: true,
      categories: categories,
      wallets: wallets,
      accounts: accounts
    };
  } catch (err) {
    return {
      success: true,
      categories: [
        { name: "Đổ xăng Eneos", jar: "Thiết yếu", source: "Thẻ Rakuten" },
        { name: "Đi siêu thị Aeon", jar: "Thiết yếu", source: "Ví Tiền Mặt" }
      ],
      wallets: (typeof getWalletsFromSheet === 'function' && getWalletsFromSheet().wallets) ? getWalletsFromSheet().wallets.map(w => w.name) : []
    };
  }
}

/**
 * 2. LƯU GIAO DỊCH MỚI
 */
function saveFamilyTransaction(formData, ssTarget) {
  try {
    const ss = ssTarget || (formData && formData.ssTarget) || SpreadsheetApp.getActiveSpreadsheet();
    let sheet = getFamilySheetHelper(ss);

    const timestamp = formatToDDMMYYYY(formData.ngay);
    const newId = "TC" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

    let loai = String(formData.loai || "CHI").toUpperCase() === "THU" ? "Thu" : "Chi";
    let hu = String(formData.hu || "").trim();
    if (loai === "Thu" && (!hu || hu === "Thu Chi" || hu === "Khác")) {
      hu = "----Thu nhập";
    }

    const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(formData.nguontien, ss) : false;
    const statusVal = formData.status || (isCredit ? "PRE-ORDER" : "HOAN_TAT");
    const ngaySaoKe = statusVal === "HOAN_TAT" ? timestamp : "";

    const rowData = [
      newId,
      timestamp,
      loai,
      hu,
      formData.noidung || "",
      Number(formData.sotien) || 0,
      formData.nguontien || "",
      formData.codinh ? "Có" : "",
      formData.ghichu || "",
      statusVal,
      ngaySaoKe
    ];

    if (sheet) {
      sheet.appendRow(rowData);
    }

    // Direct update to Wallets sheet balance
    const amt = Number(formData.sotien) || 0;
    const isThu = String(formData.loai || "CHI").toUpperCase() === "THU";
    const changeAmt = isThu ? amt : -amt;
    if (typeof updateWalletBalanceHelper === 'function' && formData.nguontien) {
      updateWalletBalanceHelper(formData.nguontien, changeAmt);
    }

    // Nếu chọn Lưu Mẫu (formData.mau) -> ghi thông tin mẫu gợi ý sang Categories (Cột B: Mẫu Nội Dung, Cột C: Tự Động Map Hũ, Cột D: Tự Động Map Nguồn)
    if (ss && formData.mau) {
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES) || ss.getSheetByName("DanhMuc");
      if (catSheet) {
        const noiDungStr = String(formData.noidung || "").trim();
        let exists = false;
        if (catSheet.getLastRow() >= 2) {
          const existingVals = catSheet.getRange(2, 2, catSheet.getLastRow() - 1, 1).getValues();
          exists = existingVals.some(r => String(r[0] || "").trim().toLowerCase() === noiDungStr.toLowerCase());
        }
        if (!exists && noiDungStr) {
          catSheet.appendRow(["", noiDungStr, hu, formData.nguontien || "", "", ""]);
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã lưu giao dịch thành công!" };
  } catch (error) {
    return { success: false, message: "❌ Lỗi hệ thống: " + error.toString() };
  }
}

/**
 * 3. CẬP NHẬT GIAO DỊCH
 */
function updateFamilyTransaction(formData, ssTarget) {
  try {
    const ss = ssTarget || (formData && formData.ssTarget) || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getFamilySheetHelper(ss);
    if (!sheet) return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Family'." };

    const targetId = String(formData.id || formData.row || "").trim();
    if (!targetId) return { success: false, message: "❌ Lỗi: Không tìm thấy ID giao dịch!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "❌ Lỗi: Không có dữ liệu." };

    const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndex = i + 2;

      const isMatch = (rowId === targetId) || 
                      (targetId === String(rowIndex)) || 
                      (targetId.toUpperCase() === ("ROW_" + rowIndex)) ||
                      (targetId.replace(/^ROW_/i, '') === String(rowIndex));

      if (isMatch) {
        const oldLoai = String(data[i][2] || "").trim().toUpperCase();
        const oldAmt = Number(data[i][5]) || 0;
        const oldSource = String(data[i][6] || "").trim();
        const oldChange = (oldLoai === "THU" || oldLoai === "KHOẢN THU") ? oldAmt : -oldAmt;

        // Revert old transaction balance
        if (typeof updateWalletBalanceHelper === 'function' && oldSource) {
          updateWalletBalanceHelper(oldSource, -oldChange);
        }

        let loai = String(formData.loai || "CHI").toUpperCase() === "THU" ? "Thu" : "Chi";
        let hu = String(formData.hu || "").trim();
        if (loai === "Thu" && (!hu || hu === "Thu Chi" || hu === "Khác")) {
          hu = "----Thu nhập";
        }

        const curDate = data[i][1];
        const curDesc = data[i][4];
        const curAmt = data[i][5];
        const curSource = data[i][6];
        const curFixed = data[i][7];
        const curNote = data[i][8];
        const curStatus = data[i][9];

        const newDateVal = formData.ngay !== undefined ? formatToDDMMYYYY(formData.ngay) : curDate;
        const newDescVal = formData.noidung !== undefined ? formData.noidung : curDesc;
        const newAmtVal = formData.sotien !== undefined ? (Number(formData.sotien) || 0) : curAmt;
        const newSourceVal = formData.nguontien !== undefined ? formData.nguontien : curSource;
        const newFixedVal = formData.codinh !== undefined ? (formData.codinh ? "Có" : "") : curFixed;
        const newNoteVal = formData.ghichu !== undefined ? formData.ghichu : curNote;
        const newStatusVal = formData.status !== undefined ? formData.status : curStatus;

        sheet.getRange(rowIndex, 2, 1, 9).setValues([[
          newDateVal,
          loai,
          hu,
          newDescVal,
          newAmtVal,
          newSourceVal,
          newFixedVal,
          newNoteVal,
          newStatusVal
        ]]);

        // Apply new transaction balance
        const newAmt = formData.sotien !== undefined ? (Number(formData.sotien) || 0) : oldAmt;
        const newLoaiStr = formData.loai !== undefined ? String(formData.loai).toUpperCase() : oldLoai;
        const newIsThu = (newLoaiStr === "THU" || newLoaiStr === "KHOẢN THU");
        const newSource = formData.nguontien !== undefined ? String(formData.nguontien).trim() : oldSource;
        const newChange = newIsThu ? newAmt : -newAmt;

        if (typeof updateWalletBalanceHelper === 'function' && newSource) {
          updateWalletBalanceHelper(newSource, newChange);
        }

        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        return { success: true, message: "✅ Đã cập nhật giao dịch thành công!" };
      }
    }

    return { success: false, message: "❌ Không tìm thấy giao dịch ID: " + targetId };
  } catch (error) {
    return { success: false, message: "❌ Lỗi: " + error.toString() };
  }
}

/**
 * 4. XOÁ GIAO DỊCH
 */
function deleteTransaction(rowId, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getFamilySheetHelper(ss);
    if (!sheet) return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Family'." };

    const targetId = String(rowId || "").trim();
    if (!targetId) return { success: false, message: "❌ Mã giao dịch không hợp lệ!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "Không có dữ liệu để xóa!" };

    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    for (let i = 0; i < data.length; i++) {
      const id = String(data[i][0] || "").trim();
      const rowIndex = i + 2;

      const isMatch = (id === targetId) || 
                      (targetId === String(rowIndex)) || 
                      (targetId.toUpperCase() === ("ROW_" + rowIndex)) ||
                      (targetId.replace(/^ROW_/i, '') === String(rowIndex));

      if (isMatch) {
        const oldLoai = String(data[i][2] || "").trim().toUpperCase();
        const oldAmt = Number(data[i][5]) || 0;
        const oldSource = String(data[i][6] || "").trim();
        const oldChange = (oldLoai === "THU" || oldLoai === "KHOẢN THU") ? oldAmt : -oldAmt;

        // Revert transaction balance from wallet
        if (typeof updateWalletBalanceHelper === 'function' && oldSource) {
          updateWalletBalanceHelper(oldSource, -oldChange);
        }

        sheet.deleteRow(rowIndex);
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        return { success: true, message: "✅ Đã xóa giao dịch thành công!" };
      }
    }

    return { success: false, message: "❌ Không tìm thấy giao dịch để xóa!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 5. KÉO DỮ LIỆU TAB 2 (DASHBOARD SUMMARIES, LIST TRANSACTIONS & JARS)
 */
function getTab2Data(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getFamilySheetHelper(ss);

    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const isAllYear = (!year || year === "ALL" || String(year).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = isAllYear ? null : parseInt(year, 10);

    let totalIncome = 0;
    let totalExpense = 0;
    let prevMonthIncome = 0;
    const filteredTx = [];

    const jarNames = ["Đầu tư", "Thiết yếu", "Tiết kiệm", "Giáo dục", "Giải trí", "Cho đi"];
    const jarSpentMap = {};
    jarNames.forEach(j => { jarSpentMap[j] = 0; });

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
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        let rowDate = row[1];
        let d = parseServerDate(rowDate);

        const loai = String(row[2] || "").trim();
        const sotien = Number(row[5]) || 0;
        const hu = String(row[3] || "").trim();

        const m = d ? (d.getMonth() + 1) : null;
        const y = d ? d.getFullYear() : null;

        // Tính thu nhập tháng trước để chia hũ
        const prevM = targetMonth === 1 ? 12 : (targetMonth ? targetMonth - 1 : null);
        const prevY = targetMonth === 1 ? (targetYear ? targetYear - 1 : new Date().getFullYear() - 1) : targetYear;
        if (prevM && y === prevY && m === prevM && loai === "Thu") {
          prevMonthIncome += sotien;
        }

        // Lọc giao dịch tháng/năm hiện tại
        const matchYear = (isAllYear || !targetYear || !y || y === targetYear);
        const matchMonth = (isAllMonth || !targetMonth || !m || m === targetMonth);

        if (matchYear && matchMonth) {
          const loaiLower = loai.toLowerCase();
          const noidungStr = String(row[4] || "").trim();
          const ghichuStr = String(row[8] || "").trim();
          const isTagExcluded = noidungStr.includes("[Ứng hộ nhóm]") || noidungStr.includes("[Tất toán công nợ]") ||
                                ghichuStr.includes("[Ứng hộ nhóm]") || ghichuStr.includes("[Tất toán công nợ]");

          const isThu = (loaiLower === "thu" || loaiLower === "khoản thu" || loaiLower === "thu nhập");

          if (!isTagExcluded) {
            if (isThu) {
              totalIncome += sotien;
            } else {
              totalExpense += sotien;

              // Cộng dồn chi tiêu từng hũ
              jarNames.forEach(jName => {
                if (hu.toLowerCase().includes(jName.toLowerCase())) {
                  jarSpentMap[jName] += sotien;
                }
              });
            }
          }

          let dateStr = rowDate;
          if (d && !isNaN(d.getTime())) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            dateStr = `${yyyy}-${mm}-${dd}`;
          }

          filteredTx.push({
            id: row[0] || ("ROW_" + (i + 2)),
            ngay: dateStr,
            loai: loai,
            hu: hu,
            noidung: row[4],
            sotien: sotien,
            nguontien: row[6],
            codinh: row[7] === "Có" || row[7] === true,
            mau: false,
            ghichu: row[8] || ""
          });
        }
      }
    }

    filteredTx.sort((a, b) => {
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
      const diff = parseDate(b.ngay) - parseDate(a.ngay);
      if (diff !== 0) return diff;
      const rowA = parseInt(String(a.id || 0).replace(/\D/g, ''), 10) || 0;
      const rowB = parseInt(String(b.id || 0).replace(/\D/g, ''), 10) || 0;
      return rowB - rowA;
    });

    // Compute previous month income for splitting jars (no arbitrary fallback if 0)
    const jarConfig = getSavedJarConfigInternal(month, year, prevMonthIncome, ss);
    const remainIncome = Math.max(0, prevMonthIncome - jarConfig.investAmount);

    const jarPctMap = {
      "Đầu tư": 0,
      "Thiết yếu": jarConfig.percentages.thietyeu || 55,
      "Tiết kiệm": jarConfig.percentages.tietkiem || 10,
      "Giáo dục": jarConfig.percentages.giaoduc || 10,
      "Giải trí": jarConfig.percentages.giaitri || 10,
      "Cho đi": jarConfig.percentages.chodi || 5
    };

    const jars = jarNames.map(name => {
      let budget = 0;
      if (name === "Đầu tư") {
        budget = jarConfig.investAmount;
      } else {
        budget = Math.floor((remainIncome * (jarPctMap[name] || 0)) / 100);
      }
      const spent = jarSpentMap[name] || 0;
      const remain = budget - spent;
      const carry = remain;

      return {
        name: name,
        budget: budget,
        spent: spent,
        remain: remain,
        carry: carry
      };
    });

    const net = totalIncome - totalExpense;
    return {
      success: true,
      summary: {
        net: net,
        income: totalIncome,
        expense: totalExpense,
        prevMonthIncome: prevMonthIncome,
        netBalance: net,
        totalIncome: totalIncome,
        totalExpense: totalExpense
      },
      transactions: filteredTx,
      jars: jars
    };
  } catch (err) {
    return {
      success: true,
      summary: { net: 0, income: 0, expense: 0, prevMonthIncome: 0, netBalance: 0, totalIncome: 0, totalExpense: 0 },
      transactions: [],
      jars: []
    };
  }
}

/**
 * 6. ĐỌC CẤU HÌNH TỶ LỆ HŨ TỪ SHEET "JAR"
 */
function getSavedJarConfigInternal(month, year, prevIncome, ssTarget) {
  const defaultResult = {
    prevMonthIncome: (prevIncome !== undefined && prevIncome !== null) ? prevIncome : 0,
    investAmount: 60000,
    percentages: {
      thietyeu: 55,
      tietkiem: 10,
      giaoduc: 10,
      giaitri: 10,
      chodi: 5
    }
  };

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return defaultResult;

    const sheet = ss.getSheetByName("JAR") || ss.getSheetByName("Jar") || ss.getSheetByName("jar");
    if (!sheet || sheet.getLastRow() < 2) return defaultResult;

    const targetM = month && month !== "ALL" ? parseInt(month, 10) : (new Date().getMonth() + 1);
    const lastCol = sheet.getLastColumn();
    if (lastCol < 2) return defaultResult;

    const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    let monthColIndex = -1;

    for (let c = 0; c < headers.length; c++) {
      if (parseInt(headers[c], 10) === targetM) {
        monthColIndex = c + 1;
        break;
      }
    }

    if (monthColIndex === -1) return defaultResult;

    const lastRow = sheet.getLastRow();
    const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
    const colMonth = sheet.getRange(1, monthColIndex, lastRow, 1).getValues();

    const keyMap = {
      'thiết yếu': 'thietyeu',
      'tiết kiệm': 'tietkiem',
      'giáo dục': 'giaoduc',
      'giải trí': 'giaitri',
      'cho đi': 'chodi'
    };

    for (let r = 0; r < colA.length; r++) {
      const cellVal = String(colA[r][0] || '').trim().toLowerCase();

      for (let key in keyMap) {
        if (cellVal.includes(key)) {
          if (r + 1 < colMonth.length) {
            let val = Number(colMonth[r + 1][0]);
            if (!isNaN(val) && val > 0) {
              if (val <= 1) val = Math.round(val * 100);
              defaultResult.percentages[keyMap[key]] = val;
            }
          }
        }
      }

      if (cellVal.includes('đầu tư')) {
        // Dùng Ngân sách Đầu tư là Dòng 35 (dòng sau dòng tỷ lệ: r + 2 trong 0-indexed)
        if (r + 2 < colMonth.length) {
          let valRaw = colMonth[r + 2][0];
          let val = Number(valRaw);
          if (valRaw !== "" && !isNaN(val) && val >= 0) {
            defaultResult.investAmount = val;
          }
        } else if (r + 1 < colMonth.length) {
          let valRaw = colMonth[r + 1][0];
          let val = Number(valRaw);
          if (valRaw !== "" && !isNaN(val) && val >= 0) {
            defaultResult.investAmount = val;
          }
        }
      }
    }
  } catch (e) {
    if (typeof Logger !== 'undefined') Logger.log("Lỗi getSavedJarConfigInternal: " + e.toString());
  }

  return defaultResult;
}

function getSavedJarConfig(month, year) {
  try {
    const tab2Data = getTab2Data(month, year);
    const prevInc = (tab2Data && tab2Data.summary && tab2Data.summary.prevMonthIncome !== undefined) ? tab2Data.summary.prevMonthIncome : 0;
    const config = getSavedJarConfigInternal(month, year, prevInc);
    return {
      success: true,
      data: config
    };
  } catch (err) {
    return {
      success: true,
      data: {
        prevMonthIncome: 0,
        investAmount: 60000,
        percentages: { thietyeu: 55, tietkiem: 10, giaoduc: 10, giaitri: 10, chodi: 5 }
      }
    };
  }
}

/**
 * 7. LƯU CẤU HÌNH TỶ LỆ HŨ VÀO SHEET "JAR"
 */
function saveJarConfig(configData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    let sheet = ss.getSheetByName("JAR") || ss.getSheetByName("Jar") || ss.getSheetByName("jar");
    if (!sheet) {
      sheet = ss.insertSheet("JAR");
      sheet.appendRow(["HŨ CHI TIÊU", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      sheet.appendRow(["Tháng", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      sheet.appendRow(["Thiết yếu"]);
      sheet.appendRow(["Tỷ lệ %"]);
      sheet.appendRow(["Tiết kiệm"]);
      sheet.appendRow(["Tỷ lệ %"]);
      sheet.appendRow(["Giáo dục"]);
      sheet.appendRow(["Tỷ lệ %"]);
      sheet.appendRow(["Giải trí"]);
      sheet.appendRow(["Tỷ lệ %"]);
      sheet.appendRow(["Cho đi"]);
      sheet.appendRow(["Tỷ lệ %"]);
      sheet.appendRow(["Đầu tư"]);
      sheet.appendRow(["Tỷ lệ %"]);
      sheet.appendRow(["Ngân sách"]);
    }

    const targetMonth = parseInt(configData.month, 10) || (new Date().getMonth() + 1);
    const lastCol = Math.max(13, sheet.getLastColumn());
    const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];

    let monthColIndex = -1;
    for (let c = 0; c < headers.length; c++) {
      if (parseInt(headers[c], 10) === targetMonth) {
        monthColIndex = c + 1;
        break;
      }
    }

    if (monthColIndex === -1) {
      monthColIndex = targetMonth + 1;
    }

    const jarMap = [
      { name: 'thiết yếu', pct: Number(configData.thietyeu) || 0 },
      { name: 'tiết kiệm', pct: Number(configData.tietkiem) || 0 },
      { name: 'giáo dục', pct: Number(configData.giaoduc) || 0 },
      { name: 'giải trí', pct: Number(configData.giaitri) || 0 },
      { name: 'cho đi', pct: Number(configData.chodi) || 0 },
      { name: 'đầu tư', invest: Number(configData.invest) || 0 }
    ];

    const lastRow = sheet.getLastRow();
    const colA = sheet.getRange(1, 1, lastRow, 1).getValues();

    jarMap.forEach(item => {
      for (let r = 0; r < colA.length; r++) {
        const cellVal = String(colA[r][0] || '').trim().toLowerCase();
        if (cellVal.includes(item.name)) {
          if (item.name === 'đầu tư') {
            // Ghi ngân sách đầu tư vào dòng ngân sách (r + 3 1-indexed, Dòng 35)
            sheet.getRange(r + 3, monthColIndex).setValue(item.invest);
          } else {
            // Ghi tỷ lệ % vào dòng tỷ lệ (r + 2 1-indexed)
            sheet.getRange(r + 2, monthColIndex).setValue(item.pct / 100);
          }
          break;
        }
      }
    });

    return { success: true, message: "✅ Đã lưu cấu hình tỷ lệ hũ xuống sheet 'JAR' thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

function getJarDataForWeb() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? (ss.getSheetByName("JAR") || ss.getSheetByName("Jar")) : null;
    if (!sheet) {
      return { success: false, message: "Không tìm thấy sheet JAR" };
    }
    const data = sheet.getDataRange().getValues();
    return { success: true, data: data };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 8. LẤY DANH SÁCH KHOẢN CỐ ĐỊNH TỪ GIAO DỊCH CỐ ĐỊNH THÁNG TRƯỚC (SHEET FAMILY)
 */
function getQuickFixedItems(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? (new Date().getMonth() + 1) : parseInt(month, 10);
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

    // Tính tháng trước và năm trước
    let prevMonth = targetMonth - 1;
    let prevYear = targetYear;
    if (prevMonth < 1) {
      prevMonth = 12;
      prevYear = targetYear - 1;
    }

    const mStr = String(targetMonth).padStart(2, '0');
    const yStr = String(targetYear);

    const paidCurrentMonthSet = new Set();
    const prevMonthFixedMap = new Map();

    const fSheet = ss ? (ss.getSheetByName(SHEET_FAMILY) || ss.getSheetByName("ThuChi")) : null;
    if (fSheet && fSheet.getLastRow() >= 2) {
      const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, 10).getValues();

      for (let i = 0; i < fData.length; i++) {
        const r = fData[i];
        let rowDate = r[1];
        let d = null;
        if (rowDate instanceof Date) {
          d = rowDate;
        } else if (typeof rowDate === 'string' && rowDate.trim()) {
          const cleanDateStr = rowDate.trim().replace(' ', 'T');
          d = new Date(cleanDateStr);
          if (isNaN(d.getTime())) {
            if (rowDate.includes('/')) {
              const parts = rowDate.split(' ')[0].split('/');
              if (parts.length === 3) {
                if (parts[0].length === 4) d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                else d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
              }
            } else if (rowDate.includes('-')) {
              const parts = rowDate.split(' ')[0].split('-');
              if (parts.length === 3) {
                if (parts[0].length === 4) d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                else d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
              }
            }
          }
        }

        if (d && !isNaN(d.getTime())) {
          const m = d.getMonth() + 1;
          const y = d.getFullYear();
          const noidung = String(r[4] || "").trim();
          const noidungLower = noidung.toLowerCase();
          const amt = Number(r[5]) || 0;
          const hu = String(r[3] || "").trim();
          const nguontien = String(r[6] || "").trim();
          const isFixed = String(r[7] || "").trim() === "Có" || r[7] === true || r[7] === 1;

          // 1. Quét các khoản ĐÃ ĐÓNG trong tháng hiện tại (month/year)
          if (m === targetMonth && y === targetYear) {
            if (noidungLower && amt > 0) {
              paidCurrentMonthSet.add(noidungLower);
            }
          }

          // 2. Quét các khoản CỐ ĐỊNH (cột H = "Có") của THÁNG TRƯỚC (prevMonth/prevYear)
          if (m === prevMonth && y === prevYear) {
            if (isFixed && noidungLower) {
              if (!prevMonthFixedMap.has(noidungLower)) {
                prevMonthFixedMap.set(noidungLower, {
                  noidung: noidung,
                  hu: hu || "Thiết yếu",
                  nguontien: nguontien,
                  prevAmount: amt,
                  loai: String(r[2] || "Chi").trim()
                });
              }
            }
          }
        }
      }
    }

    const candidateItems = Array.from(prevMonthFixedMap.values());

    // Nếu tháng trước chưa có khoản cố định nào, bổ sung thêm các danh mục cố định từ "Categories"
    if (candidateItems.length === 0 && ss) {
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES) || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const catData = catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 8).getValues();
        catData.forEach(r => {
          const isFixed = String(r[2] || "").trim() === "Có" || r[2] === 1 || r[2] === true || String(r[7] || "").trim() === "Có" || r[7] === true;
          const noidung = String(r[3] || "").trim();
          const hu = String(r[4] || "").trim();
          const nguontien = String(r[5] || "").trim();
          const amt = Number(r[6]) || 0;

          if (isFixed && noidung) {
            if (!candidateItems.some(it => it.noidung.toLowerCase() === noidung.toLowerCase())) {
              candidateItems.push({
                noidung: noidung,
                hu: hu || "Thiết yếu",
                nguontien: nguontien,
                prevAmount: amt,
                loai: "Chi"
              });
            }
          }
        });
      }
    }

    // Lọc ra các khoản chưa được đóng trong tháng này
    const quickFixedItems = candidateItems.filter(it => !paidCurrentMonthSet.has(it.noidung.toLowerCase())).map(it => ({ ...it, sotien: 0 }));

    return {
      success: true,
      items: quickFixedItems
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString(), items: [] };
  }
}

/**
 * 9. ĐÓNG TIỀN NHANH HÀNG LOẠT DÀNH CHO KHOẢN CỐ ĐỊNH
 */
function saveBatchQuickFixedAmounts(items, ssTarget) {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: "❌ Dữ liệu không hợp lệ." };
    }

    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    let sheet = getFamilySheetHelper(ss);

    items.forEach(it => {
      const amt = Number(it.newAmount || it.sotien);
      if (amt && amt > 0) {
        const timestamp = formatToDDMMYYYY(it.newDate || it.ngay);
        const newId = "TC" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);
        const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(it.newSource || it.nguontien, ss) : false;
        const statusVal = isCredit ? "PRE-ORDER" : "HOAN_TAT";
        const rowData = [
          newId,
          timestamp,
          it.loai || "Chi",
          it.hu || "Thiết yếu",
          it.noiDung || it.noidung || "Khoản cố định",
          amt,
          it.newSource || it.nguontien || "",
          "Có",
          "Khoản cố định hàng tháng",
          statusVal
        ];
        if (sheet) sheet.appendRow(rowData);
      }
    });

    return { success: true, message: "✅ Đã lưu đóng tiền khoản cố định thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 10. CHUYỂN TIỀN GIỮA 2 HŨ
 */
function transferJarAmount(data, ssTarget) {
  return processJarTransfer(data, ssTarget);
}

function processJarTransfer(data, ssTarget) {
  try {
    const fromJar = String(data.fromJar || "").trim();
    const toJar = String(data.toJar || "").trim();
    const amount = Number(data.amount) || 0;

    if (!fromJar || !toJar || amount <= 0) {
      return { success: false, message: "❌ Vui lòng nhập từ hũ, đến hũ và số tiền > 0." };
    }
    if (fromJar === toJar) {
      return { success: false, message: "❌ Hũ từ và Hũ đến không được trùng nhau!" };
    }

    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    let sheet = getFamilySheetHelper(ss);

    const now = formatToDDMMYYYY(new Date());
    const id1 = "TFJ" + Date.now().toString().slice(-6) + "1";
    const id2 = "TFJ" + Date.now().toString().slice(-6) + "2";

    const rowChi = [id1, now, "Chi", fromJar, "Điều chỉnh Hũ -> " + toJar, amount, "Nội bộ", "", "Chuyển hũ (Trừ)", "HOAN_TAT"];
    const rowThu = [id2, now, "Thu", toJar, "Điều chỉnh Hũ từ " + fromJar, amount, "Nội bộ", "", "Chuyển hũ (Cộng)", "HOAN_TAT"];

    if (sheet) {
      sheet.appendRow(rowChi);
      sheet.appendRow(rowThu);
    }

    return {
      success: true,
      message: `✅ Đã chuyển ${amount.toLocaleString()} ¥ từ hũ ${fromJar} sang hũ ${toJar}`
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 11. TỰ ĐỘNG NẠP CÔNG THỨC CHUẨN XUỐNG SHEET "JAR" (THÁNG 1 - THÁNG 12)
 */
function setupJarSheetFormulas() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    let sheet = ss.getSheetByName("JAR") || ss.getSheetByName("Jar") || ss.getSheetByName("jar");
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet JAR!" };

    const colLetters = ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];

    colLetters.forEach((col, idx) => {
      const prevCol = idx === 0 ? null : colLetters[idx - 1];

      // Dòng 5, 11, 17, 23, 29: Ngân sách
      const fNganSachTy = `=(IFERROR(SUMIFS(Family!$F$2:$F$10000; Family!$C$2:$C$10000; "Thu"; Family!$B$2:$B$10000; ">="&DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); 0)); 250000) - ${col}35) * ${col}4`;
      const fNganSachTk = `=(IFERROR(SUMIFS(Family!$F$2:$F$10000; Family!$C$2:$C$10000; "Thu"; Family!$B$2:$B$10000; ">="&DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); 0)); 250000) - ${col}35) * ${col}10`;
      const fNganSachGd = `=(IFERROR(SUMIFS(Family!$F$2:$F$10000; Family!$C$2:$C$10000; "Thu"; Family!$B$2:$B$10000; ">="&DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); 0)); 250000) - ${col}35) * ${col}16`;
      const fNganSachGt = `=(IFERROR(SUMIFS(Family!$F$2:$F$10000; Family!$C$2:$C$10000; "Thu"; Family!$B$2:$B$10000; ">="&DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); 0)); 250000) - ${col}35) * ${col}22`;
      const fNganSachCd = `=(IFERROR(SUMIFS(Family!$F$2:$F$10000; Family!$C$2:$C$10000; "Thu"; Family!$B$2:$B$10000; ">="&DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(IF(${col}$2=1; 2025; 2026); IF(${col}$2=1; 12; ${col}$2-1); 1); 0)); 250000) - ${col}35) * ${col}28`;

      // Dòng 6, 12, 18, 24, 30, 36: Đã chi
      const fDaChiTy = `=SUMIFS(Family!$F$2:$F$10000; Family!$D$2:$D$10000; "Thiết yếu"; Family!$C$2:$C$10000; "Chi"; Family!$B$2:$B$10000; ">="&DATE(2026; ${col}$2; 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(2026; ${col}$2; 1); 0))`;
      const fDaChiTk = `=SUMIFS(Family!$F$2:$F$10000; Family!$D$2:$D$10000; "Tiết kiệm"; Family!$C$2:$C$10000; "Chi"; Family!$B$2:$B$10000; ">="&DATE(2026; ${col}$2; 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(2026; ${col}$2; 1); 0))`;
      const fDaChiGd = `=SUMIFS(Family!$F$2:$F$10000; Family!$D$2:$D$10000; "Giáo dục"; Family!$C$2:$C$10000; "Chi"; Family!$B$2:$B$10000; ">="&DATE(2026; ${col}$2; 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(2026; ${col}$2; 1); 0))`;
      const fDaChiGt = `=SUMIFS(Family!$F$2:$F$10000; Family!$D$2:$D$10000; "Giải trí"; Family!$C$2:$C$10000; "Chi"; Family!$B$2:$B$10000; ">="&DATE(2026; ${col}$2; 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(2026; ${col}$2; 1); 0))`;
      const fDaChiCd = `=SUMIFS(Family!$F$2:$F$10000; Family!$D$2:$D$10000; "Cho đi"; Family!$C$2:$C$10000; "Chi"; Family!$B$2:$B$10000; ">="&DATE(2026; ${col}$2; 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(2026; ${col}$2; 1); 0))`;
      const fDaChiDt = `=SUMIFS(Family!$F$2:$F$10000; Family!$D$2:$D$10000; "Đầu tư"; Family!$C$2:$C$10000; "Chi"; Family!$B$2:$B$10000; ">="&DATE(2026; ${col}$2; 1); Family!$B$2:$B$10000; "<="&EOMONTH(DATE(2026; ${col}$2; 1); 0))`;

      // Dòng 7, 13, 19, 25, 31, 37: Số dư
      const fSoDuTy = `=${col}5-${col}6`;
      const fSoDuTk = `=${col}11-${col}12`;
      const fSoDuGd = `=${col}17-${col}18`;
      const fSoDuGt = `=${col}23-${col}24`;
      const fSoDuCd = `=${col}29-${col}30`;
      const fSoDuDt = `=${col}35-${col}36`;

      // Dòng 8, 14, 20, 26, 32, 38: Lũy kế
      const fLuyKeTy = prevCol ? `=${prevCol}8+${col}7` : `=${col}7`;
      const fLuyKeTk = prevCol ? `=${prevCol}14+${col}13` : `=${col}13`;
      const fLuyKeGd = prevCol ? `=${prevCol}20+${col}19` : `=${col}19`;
      const fLuyKeGt = prevCol ? `=${prevCol}26+${col}25` : `=${col}25`;
      const fLuyKeCd = prevCol ? `=${prevCol}32+${col}31` : `=${col}31`;
      const fLuyKeDt = prevCol ? `=${prevCol}38+${col}37` : `=${col}37`;

      const cIndex = idx + 3;
      sheet.getRange(5, cIndex).setFormula(fNganSachTy);
      sheet.getRange(6, cIndex).setFormula(fDaChiTy);
      sheet.getRange(7, cIndex).setFormula(fSoDuTy);
      sheet.getRange(8, cIndex).setFormula(fLuyKeTy);

      sheet.getRange(11, cIndex).setFormula(fNganSachTk);
      sheet.getRange(12, cIndex).setFormula(fDaChiTk);
      sheet.getRange(13, cIndex).setFormula(fSoDuTk);
      sheet.getRange(14, cIndex).setFormula(fLuyKeTk);

      sheet.getRange(17, cIndex).setFormula(fNganSachGd);
      sheet.getRange(18, cIndex).setFormula(fDaChiGd);
      sheet.getRange(19, cIndex).setFormula(fSoDuGd);
      sheet.getRange(20, cIndex).setFormula(fLuyKeGd);

      sheet.getRange(23, cIndex).setFormula(fNganSachGt);
      sheet.getRange(24, cIndex).setFormula(fDaChiGt);
      sheet.getRange(25, cIndex).setFormula(fSoDuGt);
      sheet.getRange(26, cIndex).setFormula(fLuyKeGt);

      sheet.getRange(29, cIndex).setFormula(fNganSachCd);
      sheet.getRange(30, cIndex).setFormula(fDaChiCd);
      sheet.getRange(31, cIndex).setFormula(fSoDuCd);
      sheet.getRange(32, cIndex).setFormula(fLuyKeCd);

      sheet.getRange(36, cIndex).setFormula(fDaChiDt);
      sheet.getRange(37, cIndex).setFormula(fSoDuDt);
      sheet.getRange(38, cIndex).setFormula(fLuyKeDt);
    });

    return { success: true, message: "✅ Đã nạp tự động toàn bộ công thức chuẩn vào Sheet JAR thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi nạp công thức: " + err.toString() };
  }
}
