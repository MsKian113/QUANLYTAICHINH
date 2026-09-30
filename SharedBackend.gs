// ============================================================
// FILE: SharedBackend.gs - CÁC HÀM DÙNG CHUNG TOÀN HỆ THỐNG
// ============================================================

// Khai báo tập trung tên các Sheet để dễ quản lý và thay đổi
const SHEET_CONFIG = {
  WALLETS:    "Wallets",    // Sheet chứa danh sách Ví & Thẻ
  CATEGORIES: "Categories", // Sheet chứa danh sách Hũ (Jar) / Danh mục
  FAMILY:     "Family"      // Sheet chứa lịch sử thu chi gia đình
};

/**
 * Lấy danh sách tên các ví/nguồn tiền dùng chung
 * Nguồn: Sheet "Wallets" (Cột B, từ dòng 2 trở xuống)
 */
function getWalletNamesList() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.WALLETS);
    if (!sheet) return [];

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    // Cột 2 (Cột B) là tên ví, bắt đầu từ dòng 2
    var data = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    
    var walletNames = [];
    data.forEach(function(row) {
      var name = String(row[0] || "").trim();
      if (name !== "") {
        walletNames.push(name);
      }
    });

    return walletNames;
  } catch (err) {
    Logger.log("Lỗi lấy danh sách tên ví: " + err.toString());
    return [];
  }
}

/**
 * Lấy danh sách tên các hũ (Jar) dùng chung
 * Nguồn: Sheet "Categories" (Cột B, từ dòng 3 trở xuống)
 */
function getDanhSachHuCategories() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.CATEGORIES);
    if (!sheet) return [];
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return [];
    
    // Cột 2 (Cột B) là tên hũ, bắt đầu từ dòng 3
    var data = sheet.getRange(3, 2, lastRow - 2, 1).getValues();
    
    var danhSachHu = [];
    data.forEach(function(row) {
      var huName = String(row[0] || "").trim();
      if (huName !== "") {
        danhSachHu.push(huName);
      }
    });
    
    return danhSachHu;
  } catch (err) {
    Logger.log("Lỗi lấy danh sách hũ: " + err.toString());
    return [];
  }
}
/**
 * Lấy danh sách Nội dung mẫu dùng chung
 * Nguồn: Sheet "Categories" (Ví dụ: Cột I hoặc cột nội dung bạn muốn, từ dòng 3 trở xuống)
 */
function getDanhSachNoiDungMau() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.CATEGORIES);
    if (!sheet) return [];
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return [];
    
    // Đọc từ dòng 3, cột 8 (Cột H), lấy toàn bộ dòng còn lại, 3 cột (H, I, J)
    var data = sheet.getRange(3, 8, lastRow - 2, 3).getValues();
    
    var noiDungMauList = [];
    data.forEach(function(row) {
      var noiDung    = String(row[0] || "").trim(); // Cột H: Nội dung
      var hu         = String(row[1] || "").trim(); // Cột I: Hũ
      var phuongThuc = String(row[2] || "").trim(); // Cột J: Nguồn tiền
      
      if (noiDung !== "" || hu !== "") {
        noiDungMauList.push({
          noiDung: noiDung,       // Dùng để tìm kiếm và hiển thị
          hu: hu,                 // Tự động điền vào ô Hũ
          phuongThuc: phuongThuc  // Tự động điền vào ô Nguồn tiền
        });
      }
    });
    
    return noiDungMauList;
  } catch (err) {
    Logger.log("Lỗi lấy danh sách nội dung mẫu H-J: " + err.toString());
    return [];
  }
}
// ============================================================
// HÀM ĐỌC CÁC KHOẢN CỐ ĐỊNH HÀNG THÁNG TỪ SHEET "Categories" (Cột C đến G)
// Cấu trúc: C = Ngày, D = Loại, E = Hũ, F = Nội dung, G = Phương thức
// ============================================================
function getFixedTransactions() {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.CATEGORIES);
    if (!sheet) return [];
    
    var lastRow = sheet.getLastRow();
    if (lastRow < 3) return [];
    
    // Đọc từ dòng 3, cột 3 (Cột C), lấy toàn bộ dòng còn lại, 5 cột (C, D, E, F, G)
    var data = sheet.getRange(3, 3, lastRow - 2, 5).getValues();
    
    var fixedList = [];
    data.forEach(function(row) {
      var ngay       = row[0]; // Cột C: Ngày (có thể là số ngày hoặc chuỗi)
      var loai       = String(row[1] || "").trim(); // Cột D: Loại (Thu/Chi)
      var hu         = String(row[2] || "").trim(); // Cột E: Hũ
      var noiDung    = String(row[3] || "").trim(); // Cột F: Nội dung
      var phuongThuc = String(row[4] || "").trim(); // Cột G: Phương thức
      
      if (noiDung !== "") {
        fixedList.push({
          ngay: ngay,
          loai: loai || "Chi",
          hu: hu,
          noiDung: noiDung,
          phuongThuc: phuongThuc
        });
      }
    });
    
    return fixedList;
  } catch (err) {
    Logger.log("Lỗi lấy danh sách khoản cố định: " + err.toString());
    return [];
  }
}
