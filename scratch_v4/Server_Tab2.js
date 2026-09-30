// ==========================================
// FILE: Server_Tab2.js
// NHIỆM VỤ: Xử lý toàn bộ Backend/Logic của Tab 2 (Thu Chi)
// ==========================================

/**
 * LƯU GIAO DỊCH MỚI
 * Gọi từ Frontend khi người dùng bấm "Lưu Giao Dịch" trong Modal
 */
function saveFamilyTransaction(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Family");
    
    if (!sheet) {
      return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Family'." };
    }
    
    const timestamp = new Date();
    const newId = "TC" + timestamp.getTime().toString().slice(-6); 
    
    // Khớp thứ tự Cột A->J của sheet Family
    const rowData = [
      newId,                    // A: ID
      timestamp,                // B: Timestamp
      formData.ngay,            // C: Ngày GD
      formData.loai,            // D: Loại (Thu/Chi)
      formData.hu,              // E: Hũ
      formData.noidung,         // F: Nội Dung
      Number(formData.sotien),  // G: Số Tiền
      formData.nguontien,       // H: Nguồn
      formData.codinh ? "Có" : "", // I: Cố Định
      formData.ghichu           // J: Ghi Chú
    ];
    
    sheet.appendRow(rowData);
    return { success: true, message: "✅ Đã lưu giao dịch thành công!" };
    
  } catch (error) {
    return { success: false, message: "❌ Lỗi hệ thống: " + error.toString() };
  }
}

/**
 * KÉO DỮ LIỆU ĐỂ HIỂN THỊ LÊN TAB 2
 * Hàm này sẽ được gọi khi Tab 2 load để lấy list giao dịch và số dư theo Tháng & Năm
 */
function getTab2Data(month, year) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return {
        success: true,
        summary: { net: 0, income: 0, expense: 0, netBalance: 0, totalIncome: 0, totalExpense: 0 },
        transactions: [],
        jars: []
      };
    }
    
    const sheet = ss.getSheetByName("Family");
    if (!sheet) {
      return {
        success: true,
        summary: { net: 0, income: 0, expense: 0, netBalance: 0, totalIncome: 0, totalExpense: 0 },
        transactions: [],
        jars: []
      };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return {
        success: true,
        summary: { net: 0, income: 0, expense: 0, netBalance: 0, totalIncome: 0, totalExpense: 0 },
        transactions: [],
        jars: []
      };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    let totalIncome = 0;
    let totalExpense = 0;
    const filteredTx = [];

    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      let rowDate = row[2];
      
      let d = null;
      if (rowDate instanceof Date) {
        d = rowDate;
      } else if (typeof rowDate === 'string' && rowDate.includes('/')) {
        const parts = rowDate.split('/');
        if (parts.length === 3) {
          d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        }
      }

      if (d) {
        const m = d.getMonth() + 1;
        const y = d.getFullYear();

        const matchYear = (!targetYear || y === targetYear);
        const matchMonth = (isAllMonth || m === targetMonth);

        if (matchYear && matchMonth) {
          const loai = String(row[3] || "").trim();
          const sotien = Number(row[6]) || 0;

          if (loai === "Thu") totalIncome += sotien;
          else if (loai === "Chi") totalExpense += sotien;

          filteredTx.push({
            id: row[0],
            ngay: rowDate,
            loai: loai,
            hu: row[4],
            noidung: row[5],
            sotien: sotien,
            nguontien: row[7]
          });
        }
      }
    }

    const net = totalIncome - totalExpense;
    return {
      success: true,
      summary: {
        net: net,
        income: totalIncome,
        expense: totalExpense,
        netBalance: net,
        totalIncome: totalIncome,
        totalExpense: totalExpense
      },
      transactions: filteredTx,
      jars: []
    };
  } catch (err) {
    return {
      success: true,
      summary: { net: 0, income: 0, expense: 0, netBalance: 0, totalIncome: 0, totalExpense: 0 },
      transactions: [],
      jars: []
    };
  }
}
