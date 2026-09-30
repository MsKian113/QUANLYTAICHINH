// ==========================================
// 1. KHỞI TẠO WEB APP & CẤU TRÚC GIAO DIỆN
// ==========================================
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Quản Lý Tài Chính')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// Hàm hỗ trợ nhúng file HTML con vào file Index
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    return "<div class='p-5 text-slate-400 font-bold'>Đang xây dựng giao diện " + filename + "...</div>";
  }
}

// ==========================================
// 2. BACKEND TAB 2: LƯU GIAO DỊCH VÀO SHEET "Family"
// ==========================================
function saveFamilyTransaction(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    
    if (!sheet) {
      return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Family' trong Database." };
    }
    
    const timestamp = new Date();
    // Tạo ID ngẫu nhiên theo thời gian thực (VD: TC162451)
    const newId = "TC" + timestamp.getTime().toString().slice(-6); 
    
    // Đẩy mảng dữ liệu vào đúng cấu trúc Cột A->J của bạn
    const rowData = [
      newId,                    // A: ID
      timestamp,                // B: Timestamp
      formData.ngay,            // C: Ngày GD
      formData.loai,            // D: Loại (Thu/Chi)
      formData.hu,              // E: Hũ
      formData.noidung,         // F: Nội Dung
      Number(formData.sotien),  // G: Số Tiền
      formData.nguontien,       // H: Ví/Thẻ Giao Dịch
      formData.codinh ? "Có" : "", // I: Là Khoản Cố Định?
      formData.ghichu           // J: Ghi Chú
    ];
    
    sheet.appendRow(rowData);
    return { success: true, message: "✅ Đã lưu giao dịch thành công!" };
    
  } catch (error) {
    return { success: false, message: "❌ Lỗi hệ thống: " + error.toString() };
  }
}
