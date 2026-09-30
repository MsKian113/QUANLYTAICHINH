// ============================================================
// FILE: FamilyBackend.gs - CÁC HÀM XỬ LÝ RIÊNG CHO MODULE FAMILY
// ============================================================

/**
 * 1. Lấy toàn bộ dữ liệu thu chi gia đình từ sheet Family
 */
function getFamilyData() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.FAMILY);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    // Vá ID còn thiếu cho các dòng nhập tay cũ
    for (var i = 0; i < data.length; i++) {
      if (!String(data[i][0] || "").trim()) {
        var newId = "TC" + Math.floor(10000 + Math.random() * 90000);
        data[i][0] = newId;
        sheet.getRange(i + 2, 1).setValue(newId);
      }
    }

    // Chuẩn hóa định dạng ngày tháng
    for (var j = 0; j < data.length; j++) {
      if (data[j][1] instanceof Date) {
        var d = data[j][1];
        data[j][1] = ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear();
      }
    }
    return data;
  } catch (e) { 
    return []; 
  }
}

/**
 * 2. Thêm 1 dòng giao dịch mới vào sheet Family (+ Mới)
 */
function addFamilyTransaction(rowArray) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.FAMILY);
  if (!sheet) throw new Error("Không tìm thấy sheet 'Family'");
  sheet.appendRow(rowArray);
  return "Success";
}

/**
 * 3. Cập nhật giao dịch lẻ theo ID (cột A)
 */
function updateFamilyTransactionById(txId, updatedData) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: "Hệ thống đang bận, vui lòng thử lại." };
  }

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.FAMILY);
    if (!sheet) return { success: false, message: "Sheet not found" };

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "No data" };

    var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(txId).trim()) {
        var rowIndex = i + 2;
        if (updatedData.date !== undefined) sheet.getRange(rowIndex, 2).setValue(updatedData.date);
        if (updatedData.amount !== undefined) sheet.getRange(rowIndex, 4).setValue(updatedData.amount);
        if (updatedData.source !== undefined) sheet.getRange(rowIndex, 5).setValue(updatedData.source);
        return { success: true, rowIndex: rowIndex };
      }
    }
    return { success: false, message: "ID not found: " + txId };
  } catch (err) {
    return { success: false, message: "Error: " + err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 4. Lưu nhanh khoản cố định (⚡ Nhanh): 
 * Cơ chế an toàn chống trùng 1 tháng/1 nội dung cố định duy nhất.
 * - Tìm thấy dòng khớp trong tháng -> Cập nhật (Update).
 * - Chưa có -> Thêm mới (Insert).
 */
function saveQuickFixedAmount(thang, nam, noiDung, updatedData) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: "Hệ thống đang bận, vui lòng thử lại sau." };
  }

  try {
    var famSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.FAMILY);
    if (!famSheet) return { success: false, message: "Sheet not found" };

    var lastRow = famSheet.getLastRow();
    var targetMonthStr = "/" + ("0" + thang).slice(-2) + "/" + nam;
    var data = lastRow >= 2 ? famSheet.getRange(2, 1, lastRow - 1, 8).getValues() : [];
    var targetNoiDung = String(noiDung || "").trim().toLowerCase();

    var foundIndex = -1;
    for (var i = 0; i < data.length; i++) {
      var rowDate = data[i][1];
      if (rowDate instanceof Date) {
        rowDate = ("0" + rowDate.getDate()).slice(-2) + "/" + ("0" + (rowDate.getMonth() + 1)).slice(-2) + "/" + rowDate.getFullYear();
      }
      var rowContent = String(data[i][6] || "").trim().toLowerCase();
      var rowNote = String(data[i][7] || "").trim();
      
      // Kiểm tra cùng tháng + cùng nội dung + có đánh dấu "Cố định"
      if (rowDate && String(rowDate).includes(targetMonthStr) && rowContent === targetNoiDung && rowNote.includes("Cố định")) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex >= 0) {
      var rowIndex = foundIndex + 2;
      var currentId = String(data[foundIndex][0] || "").trim();
      if (!currentId) {
        currentId = "TC" + Math.floor(10000 + Math.random() * 90000);
        famSheet.getRange(rowIndex, 1).setValue(currentId);
      }
      if (updatedData.date !== undefined) famSheet.getRange(rowIndex, 2).setValue(updatedData.date);
      if (updatedData.amount !== undefined) famSheet.getRange(rowIndex, 4).setValue(updatedData.amount);
      if (updatedData.source !== undefined) famSheet.getRange(rowIndex, 5).setValue(updatedData.source);
      return { success: true, id: currentId, mode: "update" };
    }

    // Nếu chưa tồn tại dòng nào trong tháng thì thêm mới an toàn
    var newId = "TC" + Math.floor(10000 + Math.random() * 90000);
    var dayStr = ("0" + (updatedData.day || 1)).slice(-2);
    var newRow = [
      newId,
      updatedData.date || (dayStr + targetMonthStr),
      updatedData.loai || "Chi",
      updatedData.amount || 0,
      updatedData.source || "",
      updatedData.hu || "",
      noiDung,
      "Khoản cố định hàng tháng"
    ];
    famSheet.appendRow(newRow);
    return { success: true, id: newId, mode: "insert" };
  } catch (err) {
    return { success: false, message: "Error: " + err.message };
  } finally {
    lock.releaseLock();
  }
}
function saveBatchQuickFixedAmounts(items) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { success: false, message: "Hệ thống đang bận xử lý yêu cầu khác, vui lòng thử lại sau." };
  }

  try {
    var famSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.FAMILY);
    if (!famSheet) return { success: false, message: "Sheet not found" };

    var lastRow = famSheet.getLastRow();
    var data = lastRow >= 2 ? famSheet.getRange(2, 1, lastRow - 1, 8).getValues() : [];

    // Duyệt qua từng item được gửi lên để xử lý cập nhật hoặc thêm mới
    items.forEach(function(it) {
      var thang = it.month;
      var nam = it.year;
      var noiDung = it.noiDung;
      var targetMonthStr = "/" + ("0" + thang).slice(-2) + "/" + nam;
      var targetNoiDung = String(noiDung || "").trim().toLowerCase();

      var foundIndex = -1;
      for (var i = 0; i < data.length; i++) {
        var rowDate = data[i][1];
        if (rowDate instanceof Date) {
          rowDate = ("0" + rowDate.getDate()).slice(-2) + "/" + ("0" + (rowDate.getMonth() + 1)).slice(-2) + "/" + rowDate.getFullYear();
        }
        var rowContent = String(data[i][6] || "").trim().toLowerCase();

        if (rowDate && String(rowDate).includes(targetMonthStr) && rowContent === targetNoiDung) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex >= 0) {
        // Đã tồn tại -> Cập nhật trực tiếp vào mảng dữ liệu bộ nhớ và trên sheet
        var rowIndex = foundIndex + 2;
        var currentId = String(data[foundIndex][0] || "").trim();
        if (!currentId) {
          currentId = "TC" + Math.floor(10000 + Math.random() * 90000);
          famSheet.getRange(rowIndex, 1).setValue(currentId);
        }
        if (it.newDate !== undefined) famSheet.getRange(rowIndex, 2).setValue(it.newDate);
        if (it.newAmount !== undefined) famSheet.getRange(rowIndex, 4).setValue(it.newAmount);
        if (it.newSource !== undefined) famSheet.getRange(rowIndex, 5).setValue(it.newSource);
        
        // Cập nhật lại mảng data cục bộ để các vòng lặp item tiếp theo trong batch nhận diện đúng nếu có trùng lặp
        data[foundIndex][1] = it.newDate;
        data[foundIndex][3] = it.newAmount;
        data[foundIndex][4] = it.newSource;
      } else {
        // Chưa tồn tại -> Thêm mới dòng vào sheet
        var newId = "TC" + Math.floor(10000 + Math.random() * 90000);
        var dayStr = ("0" + (it.day || 1)).slice(-2);
        var newRow = [
          newId,
          it.newDate || (dayStr + targetMonthStr),
          it.loai || "Chi",
          it.newAmount || 0,
          it.newSource || "",
          it.hu || "",
          noiDung,
          "Khoản cố định hàng tháng"
        ];
        famSheet.appendRow(newRow);
        
        // Push thêm vào mảng data cục bộ phòng hờ
        data.push(newRow);
      }
    });

    return { success: true };
  } catch (err) {
    return { success: false, message: "Error: " + err.message };
  } finally {
    lock.releaseLock();
  }
}
/**
 * Thêm giao dịch vào Family và tùy chọn lưu cấu hình sang Categories dựa theo checkbox
 */
function addFamilyTransactionWithOptions(rowArray, options) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var famSheet = ss.getSheetByName(SHEET_CONFIG.FAMILY);
  if (!famSheet) throw new Error("Không tìm thấy sheet 'Family'");
  
  // 1. Ghi giao dịch vào sheet Family
  famSheet.appendRow(rowArray);

  var catSheet = ss.getSheetByName(SHEET_CONFIG.CATEGORIES);
  if (!catSheet) return "Success";

  var dateStr = rowArray[1]; // Định dạng DD/MM/YYYY
  var ngayVal = 1;
  if (dateStr && typeof dateStr === 'string' && dateStr.includes('/')) {
    ngayVal = parseInt(dateStr.split('/')[0], 10) || 1;
  }
  var loai = rowArray[2];        // Thu / Chi
  var source = rowArray[4];      // Phương thức / Nguồn tiền
  var hu = rowArray[5];          // Hũ
  var noiDung = rowArray[6];     // Nội dung

  // Hàm phụ trợ tìm dòng trống thực tế của một cột cụ thể (bắt đầu từ dòng 3)
  function getNextEmptyRowInColumn(sheet, colIndex) {
    var maxRow = sheet.getLastRow();
    if (maxRow < 3) return 3;
    var values = sheet.getRange(3, colIndex, maxRow - 2, 1).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      if (String(values[i][0] || "").trim() !== "") {
        return i + 3 + 1; // Dòng có dữ liệu cuối cùng + 1
      }
    }
    return 3;
  }

  // 2. Nếu check lưu thành khoản cố định hàng tháng -> Ghi vào Cột C đến G (Cột 3 đến 7)
  if (options && options.isFixed) {
    var nextRowC = getNextEmptyRowInColumn(catSheet, 3);
    catSheet.getRange(nextRowC, 3).setValue(ngayVal);       // Cột C: Ngày
    catSheet.getRange(nextRowC, 4).setValue(loai);         // Cột D: Loại
    catSheet.getRange(nextRowC, 5).setValue(hu);           // Cột E: Hũ
    catSheet.getRange(nextRowC, 6).setValue(noiDung);      // Cột F: Nội dung
    catSheet.getRange(nextRowC, 7).setValue(source);       // Cột G: Phương thức
  }

  // 3. Nếu check lưu thành nội dung mẫu gợi ý -> Ghi vào Cột H đến J (Cột 8 đến 10)
  if (options && options.isTemplate) {
    var nextRowH = getNextEmptyRowInColumn(catSheet, 8);
    catSheet.getRange(nextRowH, 8).setValue(noiDung);    // Cột H: Nội dung
    catSheet.getRange(nextRowH, 9).setValue(hu);         // Cột I: Hũ
    catSheet.getRange(nextRowH, 10).setValue(source);    // Cột J: Phương thức
  }

  return "Success";
}

// Hàm đọc dữ liệu từ sheet JAR trả về cho web
function getJarDataForWeb() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("JAR");
  if (!sheet) {
    return { success: false, message: "Không tìm thấy sheet JAR" };
  }

  const data = sheet.getDataRange().getValues();
  return { success: true, data: data };
}

// Hàm nhận cấu hình % từ web ghi đè vào đúng cột tháng trong sheet JAR (Đã tối ưu chuẩn xác tọa độ)
function saveMonthlyJarConfig(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName("JAR");
    if (!sheet) {
      return { success: false, message: "Không tìm thấy sheet JAR." };
    }

    const targetMonth = parseInt(data.month, 10);
    const configs = data.configs; // Mảng cấu hình: [{jarName: 'Thiết yếu', percent: 60}, ...]

    // 1. Tìm cột tương ứng với tháng (Cột 2 là Tháng 1, Cột 3 là Tháng 2,...)
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];
    let monthColIndex = -1;
    
    for (let i = 0; i < headers.length; i++) {
      if (parseInt(headers[i], 10) === targetMonth) {
        monthColIndex = i + 1; // Index cột trong sheet (bắt đầu từ 1)
        break;
      }
    }

    if (monthColIndex === -1) {
      return { success: false, message: `Không tìm thấy cột cho tháng ${targetMonth} trên sheet JAR.` };
    }

    // 2. Lấy toàn bộ dữ liệu cột A để quét tìm tên hũ
    const lastRow = sheet.getLastRow();
    const columnAValues = sheet.getRange(1, 1, lastRow, 1).getValues();

    // 3. Duyệt qua từng cấu hình hũ do web gửi lên và cập nhật vào ô % tương ứng
    configs.forEach(cfg => {
      const searchName = cfg.jarName.trim().toLowerCase();
      
      for (let r = 0; r < columnAValues.length; r++) {
        const cellValue = String(columnAValues[r][0] || '').trim().toLowerCase();
        
        // Kiểm tra nếu dòng này chứa tên hũ (ví dụ khớp với "🏠 thiết yếu")
        if (cellValue.includes(searchName)) {
          if (searchName !== 'đầu tư') {
            // Dòng chứa tỷ lệ % nằm ngay bên dưới dòng tiêu đề hũ (r + 2 vì r tính từ 0 và dòng tiêu đề là r+1, dòng % là r+2)
            const targetRow = r + 2;
            sheet.getRange(targetRow, monthColIndex).setValue(cfg.percent / 100);
          }
          break;
        }
      }
    });

    return { success: true, message: "Đã lưu cấu hình % xuống database thành công!" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}