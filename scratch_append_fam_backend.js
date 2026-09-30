function processJarTransfer(data) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: "Hệ thống bận, vui lòng thử lại sau." };
  }
  try {
    var famSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG.FAMILY);
    if (!famSheet) return { success: false, message: "Sheet not found" };

    var fromJar = data.fromJar;
    var toJar = data.toJar;
    var amount = Number(data.amount);
    var note = data.note || "Điều chỉnh ngân sách Hũ";

    if (!fromJar || !toJar || amount <= 0) {
        return { success: false, message: "Dữ liệu không hợp lệ" };
    }

    var now = Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy");
    
    // Tạo mã GD
    var id1 = "TFJ" + Math.floor(10000 + Math.random() * 90000);
    var id2 = "TFJ" + Math.floor(10000 + Math.random() * 90000);

    // Dòng 1: Chi (Trừ ở Hũ Từ)
    var rowChi = [id1, now, "Điều chỉnh Hũ", amount, "Nội bộ", fromJar, note + " (Trừ)"];
    
    // Dòng 2: Thu (Cộng vào Hũ Đến)
    var rowThu = [id2, now, "Điều chỉnh Hũ", amount, "Nội bộ", toJar, note + " (Cộng)"];

    famSheet.appendRow(rowChi);
    famSheet.appendRow(rowThu);

    return { success: true, message: "Đã chuyển " + amount.toLocaleString() + " ¥ từ " + fromJar + " sang " + toJar };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}
