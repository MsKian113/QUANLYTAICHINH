// ============================================================
// FILE: DebtBackend.gs - XỬ LÝ LOGIC CÔNG NỢ
// ============================================================

const SHEET_DEBT = "CongNo";

// 1. LẤY DANH SÁCH ĐỐI TÁC CÔNG NỢ (TỪ CỘT A SHEET CATEGORIES)
function getDebtPartners() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Categories");
    if (!sheet) return [];
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    
    // Cột A, bắt đầu từ dòng 2
    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    return data.flat().map(x => String(x).trim()).filter(x => x);
  } catch (err) {
    Logger.log("Lỗi getDebtPartners: " + err);
    return [];
  }
}

// 2. LẤY TỔNG QUAN CÔNG NỢ (TỔNG CHO VAY, TỔNG ĐI VAY & SỐ DƯ TỪNG NGƯỜI)
function getDebtOverview() {
  try {
    const sheet = getSheet(SHEET_DEBT);
    if (!sheet) return { tongChoVay: 0, tongDiVay: 0, partners: [] };
    
    const data = sheet.getDataRange().getValues();
    const partnersMap = {};
    let tongChoVay = 0;
    let tongDiVay = 0;

    // Bỏ qua dòng tiêu đề
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      const name = String(r[2]).trim();
      const type = String(r[3]).trim();
      const amt = Number(r[5]) || 0;

      if (!name) continue;
      if (!partnersMap[name]) partnersMap[name] = { name: name, balance: 0 };

      // Qui ước balance: Dương (+) là Họ nợ mình, Âm (-) là Mình nợ họ
      if (type === "Cho vay") { tongChoVay += amt; partnersMap[name].balance += amt; }
      else if (type === "Thu nợ") { tongChoVay -= amt; partnersMap[name].balance -= amt; }
      else if (type === "Đi vay") { tongDiVay += amt; partnersMap[name].balance -= amt; }
      else if (type === "Trả nợ") { tongDiVay -= amt; partnersMap[name].balance += amt; }
    }

    const pList = Object.keys(partnersMap)
                        .map(k => partnersMap[k])
                        .filter(p => p.balance !== 0); // Chỉ lấy những ai chưa thanh toán hết

    return { 
      tongChoVay: tongChoVay, 
      tongDiVay: tongDiVay, 
      partners: pList 
    };
  } catch (err) {
    Logger.log("Lỗi getDebtOverview: " + err);
    return { tongChoVay: 0, tongDiVay: 0, partners: [] };
  }
}

// 3. LẤY CHI TIẾT CÔNG NỢ CỦA 1 NGƯỜI (CÁC MÓN NỢ VÀ LỊCH SỬ)
function getDebtDetails(partnerName) {
  try {
    const sheet = getSheet(SHEET_DEBT);
    if (!sheet) return { activeItems: [], history: [] };
    
    const data = sheet.getDataRange().getValues();
    const itemsMap = {};
    const history = [];

    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (String(r[2]).trim() === partnerName) {
        const type = String(r[3]).trim();
        const itemName = String(r[4]).trim() || "Không tên";
        const amt = Number(r[5]) || 0;
        const rawDate = r[1];
        let dateStr = "";
        
        // Format ngày an toàn
        if (rawDate instanceof Date) {
          dateStr = Utilities.formatDate(rawDate, "Asia/Tokyo", "dd/MM/yyyy HH:mm");
        } else {
          dateStr = String(rawDate);
        }

        // Lưu vào lịch sử
        history.push({
          id: r[0],
          date: dateStr,
          type: type,
          itemName: itemName,
          amt: amt,
          source: r[6],
          note: r[7]
        });

        if (!itemsMap[itemName]) {
          itemsMap[itemName] = { name: itemName, borrowed: 0, lent: 0, paid: 0, collected: 0, balance: 0 };
        }

        // Cập nhật số dư món nợ
        if (type === "Cho vay") { itemsMap[itemName].lent += amt; itemsMap[itemName].balance += amt; }
        else if (type === "Thu nợ") { itemsMap[itemName].collected += amt; itemsMap[itemName].balance -= amt; }
        else if (type === "Đi vay") { itemsMap[itemName].borrowed += amt; itemsMap[itemName].balance -= amt; }
        else if (type === "Trả nợ") { itemsMap[itemName].paid += amt; itemsMap[itemName].balance += amt; }
      }
    }

    // Chỉ lấy các món nợ chưa tất toán (balance != 0)
    const activeItems = Object.keys(itemsMap)
                              .map(k => itemsMap[k])
                              .filter(item => item.balance !== 0);

    return { 
      activeItems: activeItems, 
      history: history.reverse() // Xếp lịch sử mới nhất lên trên
    };
  } catch (err) {
    Logger.log("Lỗi getDebtDetails: " + err);
    return { activeItems: [], history: [] };
  }
}

// 4. LƯU GIAO DỊCH CÔNG NỢ MỚI
function saveDebtTransaction(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_DEBT);
    
    // Tự động tạo Sheet CongNo nếu chưa tồn tại
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_DEBT);
      sheet.appendRow(["Mã GD", "Ngày", "Tên Đối Tác", "Loại", "Tên Món Nợ", "Số Tiền", "Nguồn Tiền", "Ghi Chú"]);
      sheet.getRange("A1:H1").setFontWeight("bold").setBackground("#f3f4f6");
      sheet.setFrozenRows(1);
    }

    const now = new Date();
    const maGD = "CN-" + Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMdd-HHmmss");
    const ngay = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");

    sheet.appendRow([
      maGD,
      ngay,
      data.doiTac.trim(),
      data.loai.trim(),
      data.tenMonNo.trim(),
      Number(data.soTien),
      data.nguonTien.trim(),
      data.ghiChu.trim()
    ]);

    return "✅ Đã lưu giao dịch công nợ thành công!";
  } catch (error) {
    Logger.log("Lỗi saveDebtTransaction: " + error);
    throw new Error(error.message);
  }
}
