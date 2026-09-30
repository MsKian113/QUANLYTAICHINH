
// ==========================================
// FILE: Server_Tab2.gs (CHỈ CHẠY TRÊN SERVER)
// ==========================================

function saveFamilyTransaction(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    if (!sheet) return { success: false, message: "Lỗi: Không tìm thấy sheet 'Family'." };
    
    const timestamp = new Date();
    const newId = "TC" + timestamp.getTime().toString().slice(-5); 
    
    let dateVal = formData.ngay;
    if (!dateVal) dateVal = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    const rowData = [
      newId, timestamp, dateVal, formData.loai, formData.hu, 
      formData.noidung, Number(formData.sotien), formData.nguontien, 
      formData.codinh ? "Có" : "", formData.ghichu || ""
    ];
    
    // Ghi trực tiếp vào dòng cuối (Nhanh hơn appendRow rất nhiều)
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    
    return { success: true, message: "✅ Đã lưu thành công!" };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}
// HÀM SERVER: LẤY BÁO CÁO DƯ RÒNG VÀ DANH SÁCH CHI TIẾT THU - CHI
function getTab2Data(month, year) {
  try {
    const cacheKey = "TAB2_CACHE_" + String(year) + "_" + String(month);
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(cacheKey);
    
    // 🚀 NẾU ĐÃ CÓ TRONG CACHE SERVER -> TRẢ VỀ NGAY TRONG 0.1s MÀ KHÔNG CẦN ĐỌC SHEET!
    if (cachedData) {
      return JSON.parse(cachedData);
    }
    
    // NẾU CHƯA CÓ CACHE -> ĐỌC SHEET VÀ TÍNH TOÁN
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    if (!sheet) throw new Error("Không tìm thấy sheet Family");
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, summary: { net: 0, income: 0, expense: 0 }, transactions: [] };
    }
    
    const data = sheet.getRange(1, 1, lastRow, 9).getValues();
    let totalIncome = 0;
    let totalExpense = 0;
    const transactions = [];
    
    const targetMonth = (month === "ALL" || !month) ? null : parseInt(month);
    const targetYear = parseInt(year) || new Date().getFullYear();
    const timeZone = Session.getScriptTimeZone();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rawDate = row[2];
      if (!rawDate) continue;
      
      let rowMonth, rowYear, dateObj;
      if (rawDate instanceof Date) {
        rowMonth = rawDate.getMonth() + 1;
        rowYear = rawDate.getFullYear();
        dateObj = rawDate;
      } else {
        const strDate = rawDate.toString();
        const parts = strDate.split("-");
        if (parts.length >= 3) {
          rowYear = parseInt(parts[0]);
          rowMonth = parseInt(parts[1]);
        } else {
          dateObj = new Date(rawDate);
          rowMonth = dateObj.getMonth() + 1;
          rowYear = dateObj.getFullYear();
        }
      }
      
      if (rowYear === targetYear && (targetMonth === null || rowMonth === targetMonth)) {
        const type = row[3] ? row[3].toString().toUpperCase().trim() : "";
        const amount = Number(row[6]) || 0;
        
        if (!dateObj) dateObj = new Date(rawDate);
        const dateStr = (dateObj instanceof Date && !isNaN(dateObj.getTime())) 
          ? Utilities.formatDate(dateObj, timeZone, "dd/MM") 
          : "";
        
        const txItem = {
          id: row[0] ? row[0].toString() : "",
          rawTime: dateObj ? dateObj.getTime() : 0,
          date: dateStr,
          type: type,
          hu: row[4] ? row[4].toString() : "",
          noidung: row[5] ? row[5].toString() : "",
          sotien: amount,
          nguontien: row[7] ? row[7].toString() : ""
        };
        
        if (type === "THU") {
          totalIncome += amount;
          transactions.push(txItem);
        } else if (type === "CHI") {
          totalExpense += amount;
          transactions.push(txItem);
        }
      }
    }
    
    transactions.sort((a, b) => b.rawTime - a.rawTime);
    
    const finalResult = {
      success: true,
      summary: { net: totalIncome - totalExpense, income: totalIncome, expense: totalExpense },
      transactions: transactions
    };
    
    // 🚀 LƯU KẾT QUẢ VÀO CACHE TỒN TẠI TRONG 10 PHÚT
    try { cache.put(cacheKey, JSON.stringify(finalResult), 600); } catch (e) {}
    
    return finalResult;
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}
// XÓA CACHE KHI CÓ GIAO DỊCH MỚI
function clearTab2Cache() {
  try {
    const cache = CacheService.getScriptCache();
    const keys = [];
    for (let m = 1; m <= 12; m++) {
      keys.push("TAB2_CACHE_2025_" + m);
      keys.push("TAB2_CACHE_2026_" + m);
      keys.push("TAB2_CACHE_2026_ALL");
    }
    cache.removeAll(keys);
  } catch (e) {}
}
// ĐỒNG THỜI GỌI clearTab2Cache() TRONG HÀM saveFamilyTransaction
function saveFamilyTransaction(formData) {
  try {
    clearTab2Cache(); // 🚀 Xóa cache cũ để nạp số liệu mới
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    if (!sheet) return { success: false, message: "Lỗi: Không tìm thấy sheet 'Family'." };
    
    const timestamp = new Date();
    const newId = "TC" + timestamp.getTime().toString().slice(-5); 
    let dateVal = formData.ngay || Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    const rowData = [newId, timestamp, dateVal, formData.loai, formData.hu, formData.noidung, Number(formData.sotien), formData.nguontien, formData.codinh ? "Có" : "", formData.ghichu || ""];
    
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    
    return { success: true, message: "✅ Đã lưu thành công!" };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}
// ==========================================
// THÊM MỚI
// ==========================================
// Lấy nội dung  tự điền Hũ - nguồn tiền

  function getInitialData() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      
      // 1. ĐỌC SHEET CATEGORIES (Cột D: Nội dung, E: Hũ, F: Nguồn mặc định)
      let catSheet = ss.getSheetByName("Categories");
      if (!catSheet) {
        const sheets = ss.getSheets();
        for (let i = 0; i < sheets.length; i++) {
          const n = sheets[i].getName().trim().toLowerCase();
          if (n.includes("cat") || n.includes("danh mục")) { catSheet = sheets[i]; break; }
        }
      }
      
      let categories = [];
      if (catSheet) {
        let data = catSheet.getRange("D2:F").getValues();
        for (let i = 0; i < data.length; i++) {
          const name = data[i][0] ? data[i][0].toString().trim() : "";
          const jar = data[i][1] ? data[i][1].toString().trim() : "";
          const source = data[i][2] ? data[i][2].toString().trim() : "";
          if (name) categories.push({ name: name, jar: jar, source: source });
        }
      }
      
      // 2. ĐỌC SHEET WALLETS (Cột B: Danh sách tất cả Nguồn tiền)
      let wallSheet = ss.getSheetByName("Wallets");
      if (!wallSheet) {
        const sheets = ss.getSheets();
        for (let i = 0; i < sheets.length; i++) {
          const n = sheets[i].getName().trim().toLowerCase();
          if (n.includes("wallet") || n.includes("ví") || n.includes("vi")) { wallSheet = sheets[i]; break; }
        }
      }
      
      let wallets = [];
      if (wallSheet) {
        let wData = wallSheet.getRange("B2:B").getValues();
        for (let i = 0; i < wData.length; i++) {
          const wName = wData[i][0] ? wData[i][0].toString().trim() : "";
          if (wName) wallets.push(wName);
        }
      }
      
      return { success: true, categories: categories, wallets: wallets };
    } catch (error) {
      return { success: false, message: error.toString() };
    }
}
// ==========================================
// ĐÓNG TIỀN CỐ ĐỊNH
// ==========================================
// 1. HÀM BACKEND: LẤY DANH SÁCH KHOẢN CỐ ĐỊNH VÀ TRẠNG THÁI ĐÓNG TRONG THÁNG
function getQuickFixedData(month, year) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    if (!sheet) throw new Error("Không tìm thấy sheet Family");
    
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: true, list: [] };
    
    const data = sheet.getRange(1, 1, lastRow, 9).getValues();
    const targetMonth = parseInt(month) || (new Date().getMonth() + 1);
    const targetYear = parseInt(year) || new Date().getFullYear();
    
    const fixedTemplatesMap = {};
    const paidNamesInMonth = new Set();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const isFixed = row[8] === "Có" || row[8] === true;
      const noidung = row[5] ? row[5].toString().trim() : "";
      const rawDate = row[2];
      
      if (!noidung) continue;
      
      let d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      const rMonth = d.getMonth() + 1;
      const rYear = d.getFullYear();
      
      // Lưu lại mẫu khoản cố định
      if (isFixed) {
        if (!fixedTemplatesMap[noidung]) {
          fixedTemplatesMap[noidung] = {
            noidung: noidung,
            sotien: Number(row[6]) || 0,
            hu: row[4] ? row[4].toString() : "",
            nguontien: row[7] ? row[7].toString() : ""
          };
        }
      }
      
      // Kiểm tra xem tháng này đã đóng chưa
      if (rYear === targetYear && rMonth === targetMonth && isFixed) {
        paidNamesInMonth.add(noidung);
      }
    }
    
    const resultList = Object.values(fixedTemplatesMap).map(item => ({
      ...item,
      paid: paidNamesInMonth.has(item.noidung)
    }));
    
    return { success: true, list: resultList };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}
// 2. HÀM BACKEND: LƯU HÀNG LOẠT CÁC KHOẢN CỐ ĐỊNH ĐÃ CHỌN
function submitQuickFixedData(items) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    if (!sheet) throw new Error("Không tìm thấy sheet Family");
    
    const timestamp = new Date();
    const dateVal = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const newRows = [];
    
    items.forEach(item => {
      const newId = "TC" + timestamp.getTime().toString().slice(-5) + Math.floor(Math.random() * 90 + 10);
      newRows.push([
        newId, timestamp, dateVal, "Chi", item.hu || "Thiết yếu",
        item.noidung, Number(item.sotien), item.nguontien || "Ví",
        "Có", "Đóng tự động khoản cố định"
      ]);
    });
    
    if (newRows.length > 0) {
      const nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, newRows.length, newRows[0].length).setValues(newRows);
    }
    
    if (typeof clearTab2Cache === 'function') clearTab2Cache();
    
    return { success: true, message: `✅ Đã ghi nhận đóng ${newRows.length} khoản cố định!` };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}
// ==========================================
// QUẢN LÝ HŨ
// ==========================================

// Lấy thông tin hũ 
function getOnlyJars(month) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const jarSheet = ss.getSheetByName("JAR");
    if (!jarSheet) throw new Error("Không tìm thấy sheet JAR");
    
    let m = parseInt(month);
    if (isNaN(m)) m = new Date().getMonth() + 1;
    const monthIndex = m; 
    
    // Gom mảng siêu tốc
    const jarData = jarSheet.getRange(1, 1, 100, 15).getValues();
    
    const listJarNames = ["Đầu tư", "Thiết yếu", "Tiết kiệm", "Giáo dục", "Giải trí", "Cho đi"];
    const jarsData = [];
    
    listJarNames.forEach(name => {
        for (let i = 0; i < jarData.length; i++) {
            if (jarData[i][0] && jarData[i][0].toString().trim() === name) {
                
                // 1. Nhặt Tỷ lệ % từ mảng RAM (Dòng ngay dưới tên Hũ -> i + 1)
                let rawRate = jarData[i + 1] ? jarData[i + 1][monthIndex] : 0;
                
                // Chuyển đổi 0.7 thành 70 (giống hàm parsePercent)
                let rateVal = Number(rawRate) || 0;
                if (rateVal > 0 && rateVal <= 1) rateVal = Math.round(rateVal * 100);
                else rateVal = Math.round(rateVal);
                // 2. Nhét vào mảng gửi về cho giao diện (TUYỆT ĐỐI KHÔNG DÙNG getValue() ở đây)
                jarsData.push({
                    name: name,
                    rate: rateVal,  // <--- Đã thêm % tỷ lệ siêu tốc!
                    budget: Number(jarData[i + 2] ? jarData[i + 2][monthIndex] : 0) || 0,
                    spent:  Number(jarData[i + 3] ? jarData[i + 3][monthIndex] : 0) || 0,
                    remain: Number(jarData[i + 4] ? jarData[i + 4][monthIndex] : 0) || 0,
                    carry:  Number(jarData[i + 5] ? jarData[i + 5][monthIndex] : 0) || 0
                });
                break;
            }
        }
    });
    
    return { success: true, data: jarsData };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

function getSavedJarConfig(month, year) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const familySheet = ss.getSheetByName("Family");
    let prevMonthIncome = 0;
    
    if (familySheet) {
        const fData = familySheet.getDataRange().getValues();
        prevMonthIncome = calculatePrevMonthIncome(fData, month, year); 
    }
    
    const jarSheet = ss.getSheetByName("JAR");
    if (!jarSheet) throw new Error("Không tìm thấy sheet JAR");
    
    let m = parseInt(month);
    if (isNaN(m)) m = new Date().getMonth() + 1;
    const monthIndex = m; 
    
    // MẸO SIÊU TỐC 3: Dùng mảng gom 1 lần cho chức năng mở Popup cấu hình
    const jarFullData = jarSheet.getDataRange().getValues();
    
    function getJarVal(name, offset) {
        for (let i = 0; i < jarFullData.length; i++) {
            if (jarFullData[i][0] && jarFullData[i][0].toString().trim() === name) {
                // Đọc từ RAM thay vì gọi .getValue()
                return jarFullData[i + offset] ? jarFullData[i + offset][monthIndex] : 0;
            }
        }
        return 0;
    }
    
    return { 
      success: true, 
      data: {
        prevMonthIncome: prevMonthIncome, 
        investAmount: getJarVal("Đầu tư", 2) || 0, // Đổi mặc định thành 0 thay vì 60000 tĩnh
        percentages: {
          thietyeu: parsePercent(getJarVal("Thiết yếu", 1)),
          tietkiem: parsePercent(getJarVal("Tiết kiệm", 1)),
          giaoduc:  parsePercent(getJarVal("Giáo dục", 1)),
          giaitri:  parsePercent(getJarVal("Giải trí", 1)),
          chodi:    parsePercent(getJarVal("Cho đi", 1))
        }
      } 
    };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// LƯU HŨ
function saveJarConfig(configData) {
  try {
    const thietyeu = parseFloat(configData.thietyeu) || 0;
    const tietkiem = parseFloat(configData.tietkiem) || 0;
    const giaoduc = parseFloat(configData.giaoduc) || 0;
    const giaitri = parseFloat(configData.giaitri) || 0;
    const chodi = parseFloat(configData.chodi) || 0;
    const invest = parseFloat(configData.invest) || 0;
    
    // Chặn tổng = 100 (Không cộng invest)
    const totalPercentage = thietyeu + tietkiem + giaoduc + giaitri + chodi;
    if (Math.round(totalPercentage * 100) / 100 !== 100) {
      throw new Error(`Tổng phải là 100%. Hiện tại đang là ${totalPercentage}%.`);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const jarSheet = ss.getSheetByName("JAR");
    if (!jarSheet) throw new Error("Không tìm thấy sheet Jar");
    
    const monthCol = parseInt(configData.month) + 1; 
    const dataA = jarSheet.getRange("A:A").getValues();
    
    function setJarVal(name, offset, value) {
        for (let i = 0; i < dataA.length; i++) {
            if (dataA[i][0] && dataA[i][0].toString().trim() === name) {
                jarSheet.getRange(i + 1 + offset, monthCol).setValue(value);
                return;
            }
        }
    }

    setJarVal("Thiết yếu", 1, thietyeu / 100);
    setJarVal("Tiết kiệm", 1, tietkiem / 100);
    setJarVal("Giáo dục", 1, giaoduc / 100);
    setJarVal("Giải trí", 1, giaitri / 100);
    setJarVal("Cho đi", 1, chodi / 100);
    setJarVal("Đầu tư", 2, invest); 

    return { success: true, message: "✅ Đã lưu thành công!" };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

// CÁC HÀM PURE LOGIC HỖ TRỢ
function parsePercent(val) {
  let n = Number(val) || 0;
  if (n > 0 && n <= 1) return Math.round(n * 100); 
  return Math.round(n);
}

function calculatePrevMonthIncome(fData, currentMonth, currentYear) {
  let prevMonthIncome = 0;
  let m = parseInt(currentMonth);
  let y = parseInt(currentYear) || new Date().getFullYear();
  let prevM = m - 1; 
  let prevY = y;
  
  if (prevM === 0) { 
    prevM = 12; 
    prevY -= 1; 
  }
  
  for (let i = 1; i < fData.length; i++) {
    const dateVal = fData[i][2]; 
    if (!dateVal) continue;
    
    const dateObj = new Date(dateVal);
    if (dateObj.getMonth() + 1 === prevM && dateObj.getFullYear() === prevY) {
      const loai = fData[i][3] ? fData[i][3].toString().toUpperCase() : "";
      if (loai === "THU") {
        prevMonthIncome += (Number(fData[i][6]) || 0);
      }
    }
  }
  return prevMonthIncome;
}
// ==========================================
// CHUYỂN TIỀN HŨ
// ==========================================
// Nút xác nhận - lưu xuống database
function transferJarMoney(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    if (!sheet) throw new Error("Không tìm thấy sheet Family");
    
    const timestamp = new Date();
    const dateStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyy-MM-dd");
    
    // 1. Dòng CHI DƯƠNG (Rút tiền khỏi Hũ Gửi) -> Làm tăng "Đã chi" của Hũ Gửi
    const idChi = "TF" + timestamp.getTime().toString().slice(-5) + "C";
    const rowChi = [
      idChi, timestamp, dateStr, "CHI", payload.from, 
      `🔄 Chuyển tiền sang hũ ${payload.to}`, Number(payload.amount), 
      "Điều chỉnh nội bộ", "", ""
    ];
    
    // 2. Dòng CHI ÂM (Bơm tiền vào Hũ Nhận) -> Làm giảm "Đã chi" của Hũ Nhận
    const idAm = "TF" + timestamp.getTime().toString().slice(-5) + "A";
    const rowAm = [
      idAm, timestamp, dateStr, "CHI", payload.to, 
      `🔄 Nhận tiền từ hũ ${payload.from}`, -Number(payload.amount), 
      "Điều chỉnh nội bộ", "", ""
    ];
    
    // Ném 2 dòng vào Excel
    sheet.appendRow(rowChi);
    sheet.appendRow(rowAm);
    
    return { success: true };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}