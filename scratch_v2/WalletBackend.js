// ============================================================
// FILE: WalletsBackend.gs - CRUD TRÊN SHEET "Wallets"
// Cột: A=ID | B=Tên | C=Phân loại | D=Hạn mức tín dụng
//      E=Ngày chốt sao kê | F=Ngày đáo hạn | G=Số dư hiện tại
// ============================================================

function getWalletsFromSheet() {
  var sheet = getSheet("Wallets");
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  var result = [];

  data.forEach(function(r) {
    var id = String(r[0] || "").trim();
    if (!id) return; // bỏ dòng trống

    result.push({
      id: id,
      name: r[1],
      type: String(r[2] || "").trim(),
      credit_limit: r[3],
      closing_date: r[4],
      due_date: r[5],
      current_balance: r[6]
    });
  });

  return result;
}

function saveWalletToSheet(payload) {
  var sheet = getSheet("Wallets");
  if (!sheet) throw new Error("Không tìm thấy sheet 'Wallets'!");

  if (!payload.name) throw new Error("Vui lòng nhập tên ví!");

  var lastRow = sheet.getLastRow();
  var rowIndex = -1;

  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(payload.id).trim()) {
        rowIndex = i + 2;
        break;
      }
    }
  }

  var rowData = [
    payload.id,
    payload.name,
    payload.type,
    (payload.credit_limit !== null && payload.credit_limit !== undefined) ? payload.credit_limit : "",
    payload.closing_date || "",
    payload.due_date || "",
    payload.current_balance
  ];

  if (rowIndex === -1) {
    sheet.appendRow(rowData);          // Ví mới -> thêm dòng
  } else {
    sheet.getRange(rowIndex, 1, 1, 7).setValues([rowData]); // Ví cũ -> ghi đè đúng dòng
  }

  return "✅ Đã lưu ví: " + payload.name;
}

function deleteWalletFromSheet(id) {
  var sheet = getSheet("Wallets");
  if (!sheet) throw new Error("Không tìm thấy sheet 'Wallets'!");

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("Không có dữ liệu để xoá!");

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) {
      sheet.deleteRow(i + 2);
      return "✅ Đã xoá ví!";
    }
  }

  throw new Error("Không tìm thấy ví cần xoá!");
}