// ============================================================
// FILE: Code.gs - ĐIỀU HƯỚNG CHUNG VÀ TIỆN ÍCH HỆ THỐNG
// ============================================================

/**
 * Hàm khởi chạy ứng dụng web, trả về file giao diện khung chính Index.html
 */
function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
      .setTitle('Hệ thống Quản lý Tài chính & Kinh Doanh')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Hàm tiện ích dùng để nhúng các component HTML con vào file Index.html
 */
function include(filename) {
  try {
    if (!filename || typeof filename !== 'string') {
      return '';
    }
    var output = HtmlService.createHtmlOutputFromFile(filename);
    return output ? output.getContent() : '';
  } catch (e) {
    return '<!-- Lỗi tải file: ' + filename + ' -->';
  }
}

/**
 * Hàm hỗ trợ truy xuất đối tượng Sheet nhanh chóng theo tên
 */
function getSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  return sheet;
}

/**
 * Hàm đọc dữ liệu tổng quát từ Sheet dùng chung cho toàn hệ thống
 * @param {string} sheetName - Tên sheet cần đọc
 * @param {Array<number>} cols - Mảng số thứ tự cột cần lấy (ví dụ: [1, 2, 3])
 * @param {number} startRow - Dòng bắt đầu đọc dữ liệu
 * @param {Array<string>} headerRow - Tên các key tương ứng để trả về dạng Object
 */
function getDanhSachTuSheet(sheetName, cols, startRow, headerRow) {
  try {
    const sheet = getSheet(sheetName);
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < startRow) return [];

    const maxCol = Math.max(...cols);
    const data   = sheet.getRange(startRow, 1, lastRow - startRow + 1, maxCol).getValues();

    return data.map(row => {
      const obj = {};
      cols.forEach(col => {
        const key = headerRow ? headerRow[cols.indexOf(col)] : `col${col}`;
        obj[key]  = String(row[col - 1] || "").trim();
      });
      return obj;
    }).filter(obj => Object.values(obj).some(v => v !== ""));

  } catch (err) {
    Logger.log("getDanhSachTuSheet error: " + err);
    return [];
  }
}
