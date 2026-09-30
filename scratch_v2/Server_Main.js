// ==========================================
// FILE: Server_Main.gs
// NHIỆM VỤ: Khởi tạo Web App & Cấu trúc gốc
// ==========================================

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Quản Lý Tài Chính')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// Hàm hỗ trợ nhúng file HTML con vào file Index (Cấu trúc SPA)
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    return "<div class='p-5 text-slate-400 font-bold text-center'>Đang xây dựng giao diện " + filename + "...</div>";
  }
}