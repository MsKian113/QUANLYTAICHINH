// ==========================================
// FILE: Server_Tab2.js
// NHIỆM VỤ: Xử lý toàn bộ Backend/Logic của Tab 2 (Thu Chi & Quản Lý Hũ)
// ==========================================

const SHEET_FAMILY = "Family";
const SHEET_CATEGORIES = "Categories";
const SHEET_JAR = "Jar";
const SHEET_WALLETS_T2 = "Wallets";

/**
 * 1. LẤY DỮ LIỆU BAN ĐẦU (CATEGORIES & WALLETS SUGGESTIONS)
 */
function getInitialData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
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
    let wallets = ["Ví Tiền Mặt", "Thẻ Rakuten", "Thẻ Ufj", "Thẻ SMBC", "PayPay"];

    if (ss) {
      // Đọc Categories
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES);
      if (catSheet && catSheet.getLastRow() >= 3) {
        const catData = catSheet.getRange(3, 8, catSheet.getLastRow() - 2, 3).getValues();
        const customCats = [];
        catData.forEach(r => {
          const name = String(r[0] || "").trim();
          const jar = String(r[1] || "").trim();
          const source = String(r[2] || "").trim();
          if (name) {
            customCats.push({ name: name, jar: jar, source: source });
          }
        });
        if (customCats.length > 0) categories = customCats;
      }

      // Đọc Wallets
      const walletSheet = ss.getSheetByName(SHEET_WALLETS_T2);
      if (walletSheet && walletSheet.getLastRow() >= 2) {
        const wData = walletSheet.getRange(2, 2, walletSheet.getLastRow() - 1, 1).getValues();
        const customWallets = [];
        wData.forEach(r => {
          const name = String(r[0] || "").trim();
          if (name) customWallets.push(name);
        });
        if (customWallets.length > 0) wallets = customWallets;
      }
    }

    return {
      success: true,
      categories: categories,
      wallets: wallets
    };
  } catch (err) {
    return {
      success: true,
      categories: [
        { name: "Đổ xăng Eneos", jar: "Thiết yếu", source: "Thẻ Rakuten" },
        { name: "Đi siêu thị Aeon", jar: "Thiết yếu", source: "Ví Tiền Mặt" }
      ],
      wallets: ["Ví Tiền Mặt", "Thẻ Rakuten", "Thẻ Ufj", "Thẻ SMBC", "PayPay"]
    };
  }
}

/**
 * 2. LƯU GIAO DỊCH MỚI
 */
function saveFamilyTransaction(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss ? ss.getSheetByName(SHEET_FAMILY) : null;

    if (!sheet && ss) {
      sheet = ss.insertSheet(SHEET_FAMILY);
      sheet.appendRow(["ID", "Timestamp", "Loại", "Hũ", "Nội dung", "Số tiền", "Ví/Thẻ Giao Dịch", "Là Khoản Cố Định?", "Ghi chú"]);
    }

    const timestamp = formData.ngay || (typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd") : new Date().toISOString().split('T')[0]);
    const newId = "TC" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

    let loai = String(formData.loai || "CHI").toUpperCase() === "THU" ? "Thu" : "Chi";
    let hu = String(formData.hu || "").trim();
    if (loai === "Thu" && (!hu || hu === "Thu Chi" || hu === "Khác")) {
      hu = "----Thu nhập";
    }

    const rowData = [
      newId,
      timestamp,
      loai,
      hu,
      formData.noidung || "",
      Number(formData.sotien) || 0,
      formData.nguontien || "",
      formData.codinh ? "Có" : "",
      formData.ghichu || ""
    ];

    if (sheet) {
      sheet.appendRow(rowData);
    }

    // Nếu chọn lưu mẫu hoặc khoản cố định -> ghi sang Categories nếu sheet tồn tại
    if (ss && (formData.codinh || formData.mau)) {
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES);
      if (catSheet) {
        if (formData.codinh) {
          catSheet.appendRow(["", "", 1, loai, hu, formData.noidung, formData.nguontien]);
        }
        if (formData.mau) {
          catSheet.appendRow(["", "", "", "", "", "", "", formData.noidung, hu, formData.nguontien]);
        }
      }
    }

    return { success: true, message: "✅ Đã lưu giao dịch thành công!" };
  } catch (error) {
    return { success: false, message: "❌ Lỗi hệ thống: " + error.toString() };
  }
}

/**
 * 3. CẬP NHẬT GIAO DỊCH
 */
function updateFamilyTransaction(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_FAMILY) : null;
    if (!sheet) return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Family'." };

    const targetId = String(formData.id || formData.row || "").trim();
    if (!targetId) return { success: false, message: "❌ Lỗi: Không tìm thấy ID giao dịch!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "❌ Lỗi: Không có dữ liệu." };

    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndex = i + 2;

      if (rowId === targetId || targetId === String(rowIndex)) {
        let loai = String(formData.loai || "CHI").toUpperCase() === "THU" ? "Thu" : "Chi";
        let hu = String(formData.hu || "").trim();
        if (loai === "Thu" && (!hu || hu === "Thu Chi" || hu === "Khác")) {
          hu = "----Thu nhập";
        }

        if (formData.ngay !== undefined) sheet.getRange(rowIndex, 2).setValue(formData.ngay);
        sheet.getRange(rowIndex, 3).setValue(loai);
        if (formData.hu !== undefined) sheet.getRange(rowIndex, 4).setValue(hu);
        if (formData.noidung !== undefined) sheet.getRange(rowIndex, 5).setValue(formData.noidung);
        if (formData.sotien !== undefined) sheet.getRange(rowIndex, 6).setValue(Number(formData.sotien) || 0);
        if (formData.nguontien !== undefined) sheet.getRange(rowIndex, 7).setValue(formData.nguontien);
        if (formData.codinh !== undefined) sheet.getRange(rowIndex, 8).setValue(formData.codinh ? "Có" : "");

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
function deleteTransaction(rowId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_FAMILY) : null;
    if (!sheet) return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Family'." };

    const targetId = String(rowId || "").trim();
    if (!targetId) return { success: false, message: "❌ Mã giao dịch không hợp lệ!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "Không có dữ liệu để xóa!" };

    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    for (let i = 0; i < data.length; i++) {
      const id = String(data[i][0] || "").trim();
      const rowIndex = i + 2;

      if (id === targetId || targetId === String(rowIndex)) {
        sheet.deleteRow(rowIndex);
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
function getTab2Data(month, year) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_FAMILY) : null;

    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

    let totalIncome = 0;
    let totalExpense = 0;
    let prevMonthIncome = 0;
    const filteredTx = [];

    const jarNames = ["Đầu tư", "Thiết yếu", "Tiết kiệm", "Giáo dục", "Giải trí", "Cho đi"];
    const jarSpentMap = {};
    jarNames.forEach(j => { jarSpentMap[j] = 0; });

    if (sheet && sheet.getLastRow() >= 2) {
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        let rowDate = row[1];
        let d = null;

        if (rowDate instanceof Date) {
          d = rowDate;
        } else if (typeof rowDate === 'string') {
          if (rowDate.includes('/')) {
            const parts = rowDate.split('/');
            if (parts.length === 3) {
              d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
            }
          } else if (rowDate.includes('-')) {
            d = new Date(rowDate);
          }
        }

        if (d && !isNaN(d.getTime())) {
          const m = d.getMonth() + 1;
          const y = d.getFullYear();

          const loai = String(row[2] || "").trim();
          const sotien = Number(row[5]) || 0;
          const hu = String(row[3] || "").trim();

          // Tính thu nhập tháng trước để chia hũ
          const prevM = targetMonth === 1 ? 12 : (targetMonth ? targetMonth - 1 : null);
          const prevY = targetMonth === 1 ? targetYear - 1 : targetYear;
          if (prevM && y === prevY && m === prevM && loai === "Thu") {
            prevMonthIncome += sotien;
          }

          // Lọc giao dịch tháng/năm hiện tại
          const matchYear = (!targetYear || y === targetYear);
          const matchMonth = (isAllMonth || m === targetMonth);

          if (matchYear && matchMonth) {
            if (loai === "Thu") totalIncome += sotien;
            else if (loai === "Chi") {
              totalExpense += sotien;

              // Cộng dồn chi tiêu từng hũ
              jarNames.forEach(jName => {
                if (hu.toLowerCase().includes(jName.toLowerCase())) {
                  jarSpentMap[jName] += sotien;
                }
              });
            }

            let dateStr = rowDate;
            if (d) {
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
    }

    if (prevMonthIncome === 0) {
      prevMonthIncome = totalIncome > 0 ? totalIncome : 250000;
    }

    // Default configuration: Invest = 0, percentages: Thiết yếu 55%, Tiết kiệm 10%, Giáo dục 10%, Giải trí 10%, Cho đi 5%
    const jarConfig = getSavedJarConfigInternal(month, year, prevMonthIncome);
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
      summary: { net: 0, income: 0, expense: 0, netBalance: 0, totalIncome: 0, totalExpense: 0 },
      transactions: [],
      jars: []
    };
  }
}

/**
 * 6. ĐỌC CẤU HÌNH TỶ LỆ HŨ
 */
function getSavedJarConfigInternal(month, year, prevIncome) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_JAR) : null;
    if (sheet && sheet.getLastRow() >= 2) {
      const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
      const targetM = parseInt(month, 10);
      let colIdx = -1;
      for (let c = 0; c < headers.length; c++) {
        if (parseInt(headers[c], 10) === targetM) {
          colIdx = c + 1;
          break;
        }
      }
    }
  } catch (e) {}

  return {
    prevMonthIncome: prevIncome || 250000,
    investAmount: 0,
    percentages: {
      thietyeu: 55,
      tietkiem: 10,
      giaoduc: 10,
      giaitri: 10,
      chodi: 5
    }
  };
}

function getSavedJarConfig(month, year) {
  try {
    const tab2Data = getTab2Data(month, year);
    const prevInc = tab2Data.summary ? tab2Data.summary.income : 250000;
    const config = getSavedJarConfigInternal(month, year, prevInc);
    return {
      success: true,
      data: config
    };
  } catch (err) {
    return {
      success: true,
      data: {
        prevMonthIncome: 250000,
        investAmount: 0,
        percentages: { thietyeu: 55, tietkiem: 10, giaoduc: 10, giaitri: 10, chodi: 5 }
      }
    };
  }
}

/**
 * 7. LƯU CẤU HÌNH TỶ LỆ HŨ
 */
function saveJarConfig(configData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss ? ss.getSheetByName(SHEET_JAR) : null;
    if (!sheet && ss) {
      sheet = ss.insertSheet(SHEET_JAR);
    }
    return { success: true, message: "✅ Đã lưu cấu hình tỷ lệ hũ thành công!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 8. LẤY DANH SÁCH KHOẢN CỐ ĐỊNH HÀNG THÁNG
 */
function getQuickFixedItems(month, year) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let items = [
      { noidung: "Tiền nhà Leo", ngay: "2026-09-27", nguontien: "Thẻ Ufj", sotien: 50000, hu: "Thiết yếu", loai: "Chi" },
      { noidung: "Đóng tiền mạng", ngay: "2026-09-15", nguontien: "Thẻ Rakuten", sotien: 4500, hu: "Thiết yếu", loai: "Chi" },
      { noidung: "Lương tháng", ngay: "2026-09-01", nguontien: "Thẻ Ufj", sotien: 250000, hu: "Tiết kiệm", loai: "Thu" }
    ];

    if (ss) {
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES);
      if (catSheet && catSheet.getLastRow() >= 3) {
        const catData = catSheet.getRange(3, 3, catSheet.getLastRow() - 2, 5).getValues();
        const loadedItems = [];
        catData.forEach(r => {
          const ngayVal = r[0];
          const loai = String(r[1] || "Chi").trim();
          const hu = String(r[2] || "").trim();
          const noidung = String(r[3] || "").trim();
          const nguontien = String(r[4] || "").trim();
          if (noidung) {
            const dayStr = String(ngayVal || 1).padStart(2, '0');
            const mStr = String(month || '09').padStart(2, '0');
            const yStr = String(year || '2026');
            loadedItems.push({
              noidung: noidung,
              ngay: `${yStr}-${mStr}-${dayStr}`,
              nguontien: nguontien,
              sotien: 0,
              hu: hu,
              loai: loai
            });
          }
        });
        if (loadedItems.length > 0) items = loadedItems;
      }
    }

    return {
      success: true,
      items: items
    };
  } catch (err) {
    return {
      success: true,
      items: [
        { noidung: "Tiền nhà Leo", ngay: "2026-09-27", nguontien: "Thẻ Ufj", sotien: 50000, hu: "Thiết yếu", loai: "Chi" }
      ]
    };
  }
}

/**
 * 9. LƯU HÀNG LOẠT KHOẢN CỐ ĐỊNH NHANH
 */
function saveBatchQuickFixedAmounts(items) {
  try {
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false, message: "❌ Dữ liệu không hợp lệ." };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss ? ss.getSheetByName(SHEET_FAMILY) : null;
    if (!sheet && ss) {
      sheet = ss.insertSheet(SHEET_FAMILY);
      sheet.appendRow(["ID", "Timestamp", "Loại", "Hũ", "Nội dung", "Số tiền", "Ví/Thẻ Giao Dịch", "Là Khoản Cố Định?", "Ghi chú"]);
    }

    items.forEach(it => {
      const amt = Number(it.newAmount || it.sotien);
      if (amt && amt > 0) {
        const timestamp = it.newDate || it.ngay || (typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd") : new Date().toISOString().split('T')[0]);
        const newId = "TC" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);
        const rowData = [
          newId,
          timestamp,
          it.loai || "Chi",
          it.hu || "Thiết yếu",
          it.noiDung || it.noidung || "Khoản cố định",
          amt,
          it.newSource || it.nguontien || "",
          "Có",
          "Khoản cố định hàng tháng"
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
function transferJarAmount(data) {
  return processJarTransfer(data);
}

function processJarTransfer(data) {
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

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss ? ss.getSheetByName(SHEET_FAMILY) : null;
    if (!sheet && ss) {
      sheet = ss.insertSheet(SHEET_FAMILY);
      sheet.appendRow(["ID", "Timestamp", "Loại", "Hũ", "Nội dung", "Số tiền", "Ví/Thẻ Giao Dịch", "Là Khoản Cố Định?", "Ghi chú"]);
    }

    const now = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd") : new Date().toISOString().split('T')[0];
    const id1 = "TFJ" + Date.now().toString().slice(-6) + "1";
    const id2 = "TFJ" + Date.now().toString().slice(-6) + "2";

    const rowChi = [id1, now, "Chi", fromJar, "Điều chỉnh Hũ -> " + toJar, amount, "Nội bộ", "", "Chuyển hũ (Trừ)"];
    const rowThu = [id2, now, "Thu", toJar, "Điều chỉnh Hũ từ " + fromJar, amount, "Nội bộ", "", "Chuyển hũ (Cộng)"];

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
