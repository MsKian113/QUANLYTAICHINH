// ==========================================
// FILE: Server_Main.js
// NHIỆM VỤ: Khởi tạo Web App & Cấu trúc gốc
// ==========================================

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Quản Lý Tài Chính')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

// Hàm hỗ trợ nhúng file HTML con vào file Index (SPA Architecture)
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    return "<div class='p-5 text-slate-400 font-bold text-center'>Đang xây dựng giao diện " + filename + "...</div>";
  }
}

// Fallback handlers cho lọc ngày tháng ở các Tab
function getWalletsFromSheet(month, year) {
  return { success: true, wallets: [] };
}

function getBusinessData(month, year) {
  return {
    success: true,
    summary: { net: 45000, sales: 150000, cogs: 105000 }
  };
}

function getDebtData(month, year) {
  return {
    success: true,
    summary: { net: 70000, receivables: 120000, payables: 50000 }
  };
}
