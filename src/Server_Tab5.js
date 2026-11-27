function normalizeTab5Store(cuaHang) {
  if (!cuaHang) return "Cửa Hàng Mặc Định";
  const stLower = String(cuaHang).trim().toLowerCase();
  if (stLower.includes("yodo") || stLower.includes("yodobashi")) {
    return "Yodo";
  }
  if (stLower.includes("joshin")) return "Joshin";
  if (stLower.includes("edion")) return "Edion";
  if (stLower.includes("fuji")) return "Fuji";
  if (stLower.includes("amazon") || stLower.includes("amz")) return "Amazon";
  return String(cuaHang).trim();
}

function removeAccentsTab5(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeTab5AccountName(name) {
  if (!name) return "";
  let str = String(name).trim();
  str = str.replace(/^tk\s*/i, "");
  str = str.replace(/\.+$/, "").trim(); // Xóa dấu chấm lửng ở đuôi (ví dụ: Vema.. -> Vema)
  const lower = removeAccentsTab5(str).toLowerCase();
  if (lower === "fuji vema" || lower === "fuji vemaybay" || lower === "fuji ve may bay") {
    return "Fuji Vemaybay";
  }
  if (lower === "vema" || lower === "vemaybay" || lower === "ve may bay") {
    return "Vemaybay";
  }
  return str;
}

function getAccountCleanKey(accName, storeName) {
  let str = normalizeTab5AccountName(accName);
  if (!str) return "";
  let lower = removeAccentsTab5(str).toLowerCase();
  let stLower = removeAccentsTab5(storeName || "").toLowerCase();
  if (stLower && !lower.includes("joshin") && !lower.includes("yodo") && !lower.includes("edion") && !lower.includes("fuji") && !lower.includes("amazon")) {
    str = storeName + " " + str;
    lower = removeAccentsTab5(str).toLowerCase();
  }
  let cleanKey = lower.replace(/[\s\-_]/g, "");
  if (cleanKey.endsWith("chitis")) cleanKey = cleanKey.replace("chitis", "chit");
  if (cleanKey === "fujivema" || cleanKey === "fujivemaybay") cleanKey = "fujivemaybay";
  if (cleanKey === "vema" || cleanKey === "vemaybay") cleanKey = "vemaybay";
  return cleanKey;
}

// ==========================================
// FILE: Server_Tab5.js
// NHIỆM VỤ: Quản Lý Lịch Mua Hàng, Giới Hạn Tài Khoản & Cooldown Đặt Hàng (Dựa trên Sheet Purchase)
// ==========================================

function parseTab5Date(dateStr) {
  if (!dateStr && dateStr !== 0) return null;
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : new Date(dateStr.getTime());
  const str = String(dateStr).trim();
  if (!str) return null;
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const parts = str.split('-');
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const matchDMY = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (matchDMY) {
    const d = new Date(parseInt(matchDMY[3], 10), parseInt(matchDMY[2], 10) - 1, parseInt(matchDMY[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateTab5Standard(d) {
  if (!d || isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateTab5Display(d) {
  if (!d || isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}`;
}

function getProductCategory(tenSP, storeName) {
  if (!tenSP) return "Khác";
  const clean = removeAccentsTab5(String(tenSP)).trim().toLowerCase();

  const isWhite = clean === "film mini instax" || clean.includes("trang") || clean.includes("white") || clean.includes("monochrome");

  return isWhite ? "Film MINI Trắng" : "Film MINI Màu";
}

function isFilmProduct(productName) {
  if (!productName) return false;
  const clean = removeAccentsTab5(String(productName)).trim().toLowerCase();
  return clean.startsWith("film") || clean.includes("instax") || clean.includes("fujifilm") || clean.includes("polaroid");
}

function getStoreCooldownSettings() {
  const defaultSettings = {
    "Fuji": 30,
    "Yodo": 13,
    "Joshin": 30
  };
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      const raw = props.getProperty("STORE_COOLDOWN_SETTINGS");
      if (raw) {
        const parsed = JSON.parse(raw);
        return Object.assign({}, defaultSettings, parsed);
      }
    }
  } catch (e) {}
  return defaultSettings;
}

function saveStoreCooldownSettings(newSettings) {
  try {
    if (!newSettings || typeof newSettings !== 'object') {
      return { success: false, message: "❌ Dữ liệu cấu hình không hợp lệ!" };
    }
    const current = getStoreCooldownSettings();
    for (const key in newSettings) {
      const num = parseInt(newSettings[key], 10);
      if (!isNaN(num) && num >= 0) {
        current[key] = num;
      }
    }
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      PropertiesService.getScriptProperties().setProperty("STORE_COOLDOWN_SETTINGS", JSON.stringify(current));
    }
    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, message: "✅ Đã lưu số ngày Cooldown theo cửa hàng thành công!", settings: current };
  } catch (err) {
    return { success: false, message: "❌ Lỗi lưu cấu hình: " + err.toString() };
  }
}

function getDefaultCooldownDays(storeName, productName) {
  if (productName && !isFilmProduct(productName)) return 0;
  if (!storeName) return 0;
  const settings = getStoreCooldownSettings();
  const clean = String(storeName).toLowerCase();
  for (const storeKey in settings) {
    if (clean.includes(storeKey.toLowerCase())) {
      return settings[storeKey];
    }
  }
  return 0;
}

function isRealAccountName(name) {
  if (!name) return false;
  const str = String(name).trim();
  if (!str) return false;
  const lower = removeAccentsTab5(str).toLowerCase();

  const ignoredHeaders = ["tai khoan mua", "tài khoản mua", "tai khoan", "tài khoản", "tai khoan dat hang", "tài khoản đặt hàng", "tk mua", "danh sach tai khoan", "danh sách tài khoản", "tk mac dinh", "tk mặc định"];
  if (ignoredHeaders.includes(lower)) return false;

  const ignoredStatuses = ["cho ship", "chờ ship", "chusen", "huy", "hủy", "pre-order", "preorder", "da_huy", "ket_thuc", "kết thúc", "dang_cho", "đang chờ", "thanh_cong", "thành công", "tk mac dinh", "tk mặc định"];
  if (ignoredStatuses.includes(lower)) return false;

  if (lower.startsWith("fuji ") || lower.startsWith("yodo ") || lower.startsWith("joshin ")) {
    // Tài khoản có tiền tố tiệm cooldown
    return true;
  }

  const ignoredWarehouses = ["kho 1f", "kho 2f", "kho 3f", "ton kho", "tồn kho", "an uong", "ăn uống", "tieu dung", "tiêu dùng", "gia dinh", "gia đình"];
  if (ignoredWarehouses.includes(lower)) return false;

  const parts = str.split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    const knownStoresRepeated = ["7net", "aeon", "anhyo", "bandai", "doratsuya", "iris", "itoyo", "jfa", "jump", "nike", "rakuten", "tiem", "tiệm"];
    if (knownStoresRepeated.includes(removeAccentsTab5(parts[0]).toLowerCase())) {
      return false;
    }
  }

  const nonCooldownStores = ["7net", "aeon", "bandai", "doratsuya", "edion", "amazon", "amz", "bicamera", "pokecenta", "family", "iris", "itoyo", "jfa", "jump", "nike", "rakuten", "tiem", "tiệm"];
  if (nonCooldownStores.includes(lower)) return false;

  return true;
}

function getTab5Data(param1, param2) {
  // param1 có thể là forceRefresh (boolean) hoặc ssTarget (Spreadsheet Object)
  let forceRefresh = false;
  let ssTarget = null;
  if (typeof param1 === 'boolean') {
    forceRefresh = param1;
    ssTarget = param2 || null;
  } else if (param1 && typeof param1 === 'object' && typeof param1.getSheetByName === 'function') {
    ssTarget = param1;
    forceRefresh = !!param2;
  } else {
    forceRefresh = Boolean(param1 || param2);
  }

  const cacheKey = "tab5_data_v7";
  if (!forceRefresh && !ssTarget && typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch(e) {}
  }

  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, error: "Không tìm thấy Spreadsheet!", accounts: [], stores: [] };
    const accountsSet = new Set();
    const storesSet = new Set(["Fuji", "Yodo", "Joshin"]);

    // Đọc danh sách Tài Khoản mua CHỈ từ Sheet Categories Cột G (Column 7, index 6)
    if (ss) {
      const catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const lastRow = catSheet.getLastRow();
        const maxCols = typeof catSheet.getMaxColumns === 'function' ? catSheet.getMaxColumns() : Math.max(catSheet.getLastColumn(), 11);
        const lastCol = Math.min(Math.max(catSheet.getLastColumn(), 1), maxCols);
        const catData = catSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        catData.forEach(r => {
          const accG = String(r[6] || "").trim(); // Column G (Index 6)
          if (accG && isRealAccountName(accG)) {
            accountsSet.add(accG);
          }
        });
      }
    }

    const items = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. ĐỌC TRỰC TIẾP TỪ SHEET PURCHASE 17 CỘT (ƯU TIÊN HÀNG ĐẦU)
    const pSheet = ss ? ss.getSheetByName("Purchase") : null;
    if (pSheet && pSheet.getLastRow() >= 2) {
      // Đảm bảo số cột an toàn, không vượt quá maxColumns của sheet
      const maxCols = typeof pSheet.getMaxColumns === 'function' ? pSheet.getMaxColumns() : Math.max(pSheet.getLastColumn(), 17);
      if (maxCols < 17 && typeof pSheet.insertColumnsAfter === 'function') {
        try {
          pSheet.insertColumnsAfter(maxCols, 17 - maxCols);
        } catch(eCol) {}
      }
      const safeMaxCol = Math.max(maxCols, 17);
      const readCol = Math.min(safeMaxCol, Math.max(pSheet.getLastColumn(), 17));
      const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, readCol).getValues();

      pData.forEach(row => {
        if (!row || !row[0]) return;
        const tenSP = String(row[4] || "").trim();
        if (!tenSP || tenSP === "Tên Sản Phẩm") return;

        // Tài khoản mua ở Cột 14 (index 13), tự động fallback Nơi Mua / Nguồn Tiền nếu trống
        let rawTk = String(row[13] || "").trim();
        if (!rawTk) {
          const noiMua = String(row[2] || "").trim();
          const nguonTien = String(row[8] || "").trim();
          rawTk = noiMua || nguonTien || "";
        }

        const id = String(row[0]).trim();
        const ngayMuaDate = parseTab5Date(row[1]) || new Date();
        ngayMuaDate.setHours(0, 0, 0, 0);
        const ngayMua = formatDateTab5Standard(ngayMuaDate);
        const cuaHangRaw = String(row[2] || "").trim() || "Cửa Hàng Mặc Định";
        const cuaHang = normalizeTab5Store(cuaHangRaw);
        const stLower = cuaHang.toLowerCase();
        
        // Tự động ghép tên tiệm + tên tài khoản nếu chưa có tên tiệm
        let taiKhoan = rawTk;
        const lowerTk = rawTk.toLowerCase();
        if (cuaHang && !lowerTk.includes("joshin") && !lowerTk.includes("yodo") && !lowerTk.includes("edion") && !lowerTk.includes("fuji") && !lowerTk.includes("amazon")) {
          taiKhoan = cuaHang + " " + rawTk;
        }

        const rawTrangThaiKho = removeAccentsTab5(String(row[3] || "")).trim().toLowerCase();
        const rawTrangThaiColQ = String(row[16] || "").trim().toUpperCase();
        const ghiChu = String(row[10] || "").trim();
        const isCancelled = rawTrangThaiKho.includes("huy") || rawTrangThaiKho.includes("cancel") || rawTrangThaiColQ === "DA_HUY" || rawTrangThaiColQ === "HUY";

        const isFilm = isFilmProduct(tenSP);
        let cooldownDays = 0;
        if (isFilm) {
          if (isCancelled) {
            cooldownDays = 7;
          } else {
            cooldownDays = parseInt(row[14], 10) || getDefaultCooldownDays(cuaHang, tenSP);
          }
        }
        
        let parsedKhaDung = parseTab5Date(row[15]);
        let ngayKhaDungDate;
        if (!isFilm) {
          ngayKhaDungDate = new Date(ngayMuaDate.getTime());
        } else if (isCancelled) {
          // Đối với đơn Film bị hủy: Ngày khả dụng = Ngày Hủy + 7 ngày
          const matchHuyDate = ghiChu.match(/\[Hủy:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\]/i);
          let baseCancelDate = matchHuyDate ? (parseTab5Date(matchHuyDate[1]) || ngayMuaDate) : null;
          
          if (parsedKhaDung && row[14] == 7) {
            ngayKhaDungDate = parsedKhaDung;
          } else if (baseCancelDate) {
            ngayKhaDungDate = new Date(baseCancelDate.getTime());
            ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + 7);
          } else {
            ngayKhaDungDate = new Date(ngayMuaDate.getTime());
            ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + 7);
          }
        } else if (parsedKhaDung) {
          ngayKhaDungDate = parsedKhaDung;
        } else {
          ngayKhaDungDate = new Date(ngayMuaDate.getTime());
          ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
        }
        ngayKhaDungDate.setHours(0, 0, 0, 0);
        const ngayKhaDung = formatDateTab5Standard(ngayKhaDungDate);

        let trangThai = "KET_THUC";
        if (isFilm && ngayKhaDungDate.getTime() > today.getTime()) {
          trangThai = "DANG_CHO";
        } else {
          trangThai = "KET_THUC";
        }
        const price = Number(row[6]) || 0;

        accountsSet.add(taiKhoan);
        storesSet.add(cuaHang);

        items.push({
          id: id,
          ngayMua: ngayMua,
          ngayMuaDate: ngayMuaDate,
          ngayMuaDisplay: formatDateTab5Display(ngayMuaDate),
          taiKhoan: taiKhoan,
          cuaHang: cuaHang,
          tenSanPham: tenSP,
          category: getProductCategory(tenSP, cuaHang),
          cooldownDays: cooldownDays,
          ngayKhaDung: ngayKhaDung,
          ngayKhaDungDate: ngayKhaDungDate,
          ngayKhaDungDisplay: formatDateTab5Display(ngayKhaDungDate),
          trangThai: trangThai,
          rawTrangThaiKho: rawTrangThaiKho,
          rawTrangThaiColQ: rawTrangThaiColQ,
          maDonTab3: id,
          ghiChu: ghiChu,
          price: price
        });
      });
    }

    // Sắp xếp items mới nhất lên đầu chuẩn xác theo timestamp
    items.sort((a, b) => (b.ngayMuaDate ? b.ngayMuaDate.getTime() : 0) - (a.ngayMuaDate ? a.ngayMuaDate.getTime() : 0));

    // Tính toán Ma Trận Cooldown (Store -> Account Status & Last Purchase)
    const accounts = Array.from(accountsSet);
    const storeMap = {};

    accounts.forEach(acc => {
      const trimmed = String(acc).trim();
      if (!trimmed || !isRealAccountName(trimmed)) return;

      let clean = trimmed.replace(/^tk\s*/i, "").trim();
      let lower = removeAccentsTab5(clean).toLowerCase();

      let targetStores = [];
      let subName = "";

      if (lower.includes("fuji")) {
        targetStores = ["Fuji"];
        subName = clean.replace(/(yodobashi|yodo|joshin|edion|fuji|amazon|amz|bicamera|pokecenta|family)[\s\-_:]*/gi, "").trim();
      } else if (lower.includes("joshin")) {
        targetStores = ["Joshin"];
        subName = clean.replace(/(yodobashi|yodo|joshin|edion|fuji|amazon|amz|bicamera|pokecenta|family)[\s\-_:]*/gi, "").trim();
      } else if (lower.includes("yodo") || lower.includes("yodobashi")) {
        targetStores = ["Yodo"];
        subName = clean.replace(/(yodobashi|yodo|joshin|edion|fuji|amazon|amz|bicamera|pokecenta|family)[\s\-_:]*/gi, "").trim();
      } else if (lower.includes("edion") || lower.includes("amazon") || lower.includes("amz") || lower.includes("bicamera") || lower.includes("pokecenta") || lower.includes("family")) {
        // Cửa hàng khác không có Cooldown -> Bỏ qua không hiển thị ở Tab 5
        return;
      } else {
        // Tài khoản không có tiền tố cửa hàng (ví dụ: KA, Chi, 602, Giao) -> dùng chung cho các tiệm Cooldown
        targetStores = ["Fuji", "Yodo", "Joshin"];
        subName = clean;
      }

      targetStores.forEach(storeName => {
        let shortName = normalizeTab5AccountName(subName);
        if (!shortName || shortName.toLowerCase() === storeName.toLowerCase() || shortName.toLowerCase() === "tk mặc định" || shortName.toLowerCase() === "tk mac dinh") {
          return;
        }

        let fullName = shortName.toLowerCase().startsWith(storeName.toLowerCase()) ? shortName : (storeName + " " + shortName);
        fullName = normalizeTab5AccountName(fullName);

        if (!storeMap[storeName]) {
          storeMap[storeName] = [];
        }

        const cleanKey = getAccountCleanKey(fullName, storeName);
        if (!storeMap[storeName].some(item => getAccountCleanKey(item.fullName, storeName) === cleanKey)) {
          storeMap[storeName].push({
            fullName: fullName,
            shortName: shortName,
            store: storeName
          });
        }
      });
    });

    const matrix = [];
    const allowedStores = ["Fuji", "Yodo", "Joshin"];

    allowedStores.forEach(store => {
      const accList = storeMap[store] || [];
      if (accList.length === 0) return;
      const storeStatusList = [];

      accList.forEach(accObj => {
        const account = accObj.fullName;
        const shortName = accObj.shortName;
        const targetAccKey = getAccountCleanKey(account, store);

        // Lấy tất cả các đơn mua của tài khoản này ở cửa hàng này
        const accountOrders = items.filter(it => {
          const itemAccKey = getAccountCleanKey(it.taiKhoan, it.cuaHang);
          return itemAccKey === targetAccKey;
        });

        // Group các đơn theo danh mục (Film MINI Trắng & Film MINI Màu)
        const categoryOrdersMap = {};
        accountOrders.forEach(ord => {
          if (!isFilmProduct(ord.tenSanPham)) return;
          const cat = ord.category || getProductCategory(ord.tenSanPham, store);
          if (!categoryOrdersMap[cat]) categoryOrdersMap[cat] = [];
          categoryOrdersMap[cat].push(ord);
        });

        // Xác định thứ tự các danh mục: Danh mục đã mua được xếp trước, các danh mục còn lại bổ sung sau
        const purchasedCats = Object.keys(categoryOrdersMap);
        const allCatsToProcess = [];
        purchasedCats.forEach(cat => {
          if (!allCatsToProcess.includes(cat)) allCatsToProcess.push(cat);
        });
        ["Film MINI Trắng", "Film MINI Màu"].forEach(cat => {
          if (!allCatsToProcess.includes(cat)) allCatsToProcess.push(cat);
        });

        allCatsToProcess.forEach(cat => {
          const catOrders = categoryOrdersMap[cat] || [];
          if (catOrders.length === 0) {
            // Chưa từng mua danh mục này
            storeStatusList.push({
              account: account,
              shortName: shortName,
              category: cat,
              isCooldown: false,
              daysLeft: 0,
              nextAvailableDate: "",
              lastPurchaseDate: "Chưa từng mua",
              lastProduct: "",
              lastPrice: 0
            });
          } else {
            // Sắp xếp các đơn của danh mục này theo ngày mua mới nhất
            catOrders.sort((a, b) => (b.ngayMuaDate ? b.ngayMuaDate.getTime() : 0) - (a.ngayMuaDate ? a.ngayMuaDate.getTime() : 0));
            const lastOrder = catOrders[0];

            // Tìm xem có đơn nào hợp lệ đang còn trong thời gian Cooldown không (bao gồm cả đơn Film HỦY đang trong 7 ngày cooldown)
            const activeCdOrders = catOrders.filter(ord => {
              const kd = ord.ngayKhaDungDate || parseTab5Date(ord.ngayKhaDung);
              return kd && kd.getTime() > today.getTime() && ord.rawTrangThaiColQ !== "KET_THUC";
            });

            // Sắp xếp theo ngày khả dụng xa nhất (ngày được phép mua tiếp theo)
            let isCooldown = false;
            let daysLeft = 0;
            let nextAvailableDate = "";

            if (activeCdOrders.length > 0) {
              activeCdOrders.sort((a, b) => (b.ngayKhaDungDate ? b.ngayKhaDungDate.getTime() : 0) - (a.ngayKhaDungDate ? a.ngayKhaDungDate.getTime() : 0));
              const latestCdOrder = activeCdOrders[0];
              const kdDate = latestCdOrder.ngayKhaDungDate || parseTab5Date(latestCdOrder.ngayKhaDung);
              if (kdDate && kdDate.getTime() > today.getTime()) {
                isCooldown = true;
                const diffTime = kdDate.getTime() - today.getTime();
                daysLeft = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));
                nextAvailableDate = latestCdOrder.ngayKhaDungDisplay || formatDateTab5Display(kdDate);
              }
            }

            // Tiệm Yodo: Film Màu KHÔNG tính cooldown
            if (store === "Yodo" && cat.includes("Màu")) {
              isCooldown = false;
              daysLeft = 0;
            }

            storeStatusList.push({
              account: account,
              shortName: shortName,
              category: cat,
              isCooldown: isCooldown,
              daysLeft: daysLeft,
              nextAvailableDate: nextAvailableDate,
              lastPurchaseDate: lastOrder.ngayMuaDisplay,
              lastProduct: lastOrder.tenSanPham,
              lastPrice: lastOrder.price || 0
            });
          }
        });
      });

      if (storeStatusList.length > 0) {
        matrix.push({
          store: store,
          accountsStatus: storeStatusList
        });
      }
    });

    const result = {
      success: true,
      items: items,
      matrix: matrix,
      accounts: accounts,
      stores: Object.keys(storeMap),
      storeCooldowns: getStoreCooldownSettings()
    };

    if (!ssTarget && typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      try {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 300);
      } catch(e) {}
    }

    return result;
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function savePurchaseLimitRecord(formData, ssTarget) {
  try {
    const rawSs = ssTarget || (formData && formData.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, error: "Không tìm thấy Spreadsheet!" };

    let pSheet = ss.getSheetByName("Purchase");
    if (!pSheet) {
      pSheet = ss.insertSheet("Purchase");
    }

    const baseId = formData.id || ((typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("PO-") : ("PO-" + Date.now().toString().slice(-6)));
    const ngayMuaDate = parseTab5Date(formData.ngayMua || new Date());
    const ngayMua = formatDateTab5Standard(ngayMuaDate);
    const taiKhoan = String(formData.taiKhoan || "").trim();
    const cuaHang = String(formData.cuaHang || "").trim() || "Cửa Hàng Mặc Định";
    const cooldownDays = String(cuaHang).toLowerCase().includes("yodo") ? 13 : (parseInt(formData.cooldownDays, 10) || 30);

    const ngayKhaDungDate = new Date(ngayMuaDate.getTime());
    ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
    const ngayKhaDung = formatDateTab5Standard(ngayKhaDungDate);

    const trangThai = String(formData.trangThai || "THANH_CONG").trim().toUpperCase();
    const maDonTab3 = String(formData.maDonTab3 || baseId).trim();
    const ghiChu = String(formData.ghiChu || "").trim();

    const rawItems = Array.isArray(formData.items) && formData.items.length > 0
      ? formData.items
      : [{
          tenSP: formData.tenSanPham || "",
          qty: Number(formData.soLuong) || 1,
          price: formData.giaMua || 0
        }];

    const items = rawItems.map(it => {
      let priceNum = 0;
      const priceStr = String(it.price || it.giaMua || 0).trim();
      if (priceStr.startsWith('=')) {
        try { priceNum = eval(priceStr.substring(1)); } catch(e) { priceNum = Number(priceStr) || 0; }
      } else if (priceStr.includes('/')) {
        try { priceNum = eval(priceStr); } catch(e) { priceNum = Number(priceStr) || 0; }
      } else {
        priceNum = Number(priceStr) || 0;
      }
      return {
        tenSP: String(it.tenSP || it.tenSanPham || "").trim(),
        qty: Number(it.qty || it.soLuong) || 1,
        price: Math.round(priceNum)
      };
    }).filter(it => it.tenSP !== "");

    if (items.length === 0) {
      return { success: false, error: "Không có sản phẩm hợp lệ để lưu!" };
    }

    const lastColP = Math.max(pSheet.getLastColumn(), 17);
    const pData = pSheet.getLastRow() >= 2 ? pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues() : [];

    const rowsToAdd = [];
    items.forEach((it, idx) => {
      const itemId = items.length > 1 ? `${baseId}-${idx + 1}` : baseId;
      const itemTotal = it.qty * it.price;

      let foundRowIndex = -1;
      for (let i = 0; i < pData.length; i++) {
        if (String(pData[i][0]).trim() === itemId || (maDonTab3 && String(pData[i][12]).trim() === maDonTab3)) {
          foundRowIndex = i + 2;
          break;
        }
      }

      const rowData = [
        itemId,              // 1: ID
        ngayMua,             // 2: Ngày Mua
        cuaHang,             // 3: Nơi mua
        "Chờ Ship",          // 4: Trạng Thái Kho
        it.tenSP,            // 5: Tên Sản Phẩm
        it.qty,              // 6: Số Lượng
        it.price,            // 7: Giá Mua (1 cái)
        itemTotal,           // 8: Tổng Tiền
        "Ví Tiền Mặt",       // 9: Nguồn Tiền Mua
        "HOAN_TAT",          // 10: Trạng thái thẻ
        ghiChu,              // 11: Note
        0,                   // 12: Tồn kho
        ngayMua,             // 13: Ngày Sao kê / SubID
        taiKhoan,            // 14: Thông tin tài khoản mua
        cooldownDays,        // 15: SoNgayCooldown
        ngayKhaDung,         // 16: NgayKhaDung
        trangThai            // 17: TrangThai (THANH_CONG)
      ];

      if (foundRowIndex > 0) {
        pSheet.getRange(foundRowIndex, 1, 1, 17).setValues([rowData]);
      } else {
        rowsToAdd.push(rowData);
      }
    });

    if (rowsToAdd.length > 0) {
      pSheet.getRange(pSheet.getLastRow() + 1, 1, rowsToAdd.length, 17).setValues(rowsToAdd);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, id: baseId, count: items.length };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function updatePurchaseLimitStatus(id, newStatus, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    const targetStatus = String(newStatus || "DA_HUY").trim().toUpperCase();
    let updated = false;

    // Cập nhật trực tiếp Cột Q (Col 17) trong Sheet Purchase
    if (ss) {
      const pSheet = ss.getSheetByName("Purchase");
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 17);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        for (let i = 0; i < pData.length; i++) {
          const rowId = String(pData[i][0] || "").trim();
          const subId = String(pData[i][12] || "").trim();
          if (rowId === id || (id && (subId === id || rowId.includes(id)))) {
            pData[i][16] = targetStatus; // Cột Q: TrangThai
            if (targetStatus === "DA_HUY") {
              pData[i][3] = "Hủy"; // Cột D: Trạng Thái Kho
              pData[i][9] = "CHO_HOAN_TIEN"; // Cột J: Trạng thái thẻ
              pData[i][11] = 0; // Cột L: Tồn kho = 0

              const tenSP = String(pData[i][4] || "");
              const isFilm = isFilmProduct(tenSP);
              if (isFilm) {
                const cancelDate = new Date();
                cancelDate.setHours(0, 0, 0, 0);

                const kdDate = new Date(cancelDate.getTime());
                kdDate.setDate(kdDate.getDate() + 7);
                kdDate.setHours(0, 0, 0, 0);

                pData[i][14] = 7; // Cột O (Col 15): SoNgayCooldown = 7
                pData[i][15] = formatDateTab5Standard(kdDate); // Cột P (Col 16): NgayKhaDung = NgayHuy + 7 (dd/MM/yyyy)
                pData[i][16] = "DANG_CHO"; // Cột Q (Col 17): TrangThai = DANG_CHO
              } else {
                pData[i][16] = "KET_THUC";
              }
            } else if (targetStatus === "THANH_CONG") {
              pData[i][3] = "Chờ Ship"; // Cột D: Trạng Thái Kho
              pData[i][9] = "HOAN_TAT"; // Cột J: Trạng thái thẻ
              pData[i][11] = ""; // Cột L: Tồn kho để trống khi Chờ Ship
            }
            updated = true;
          }
        }
        if (updated) {
          pSheet.getRange(2, 1, pData.length, lastColP).setValues(pData);
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, id: id, newStatus: targetStatus };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function deletePurchaseLimitRecord(id, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, error: "Không tìm thấy Spreadsheet!" };
    const sheet = ss.getSheetByName("Purchase");
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: "Không tìm thấy sheet Purchase!" };

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const subId = String(data[i][12] || "").trim();
      if (rowId === id || subId === id) {
        sheet.deleteRow(i + 1);
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        return { success: true, id: id };
      }
    }
    return { success: false, error: "Không tìm thấy mã bản ghi: " + id };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * THÊM TÀI KHOẢN MỚI VÀO SHEET CATEGORIES CỘT G (COLUMN 7)
 */
function addTab5Account(storeName, accountName, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, error: "Không tìm thấy Spreadsheet!" };

    const catSheet = ss.getSheetByName("Categories") || ss.getSheetByName("DanhMuc");
    if (!catSheet) return { success: false, error: "Không tìm thấy sheet Categories!" };

    const store = String(storeName || "").trim();
    const acc = String(accountName || "").trim();

    if (!store || !acc) {
      return { success: false, error: "Tên Tiệm và Tên Tài Khoản không được để trống!" };
    }

    let fullAccount = acc;
    const lowerAcc = removeAccentsTab5(acc).toLowerCase();
    const knownStores = ["joshin", "yodo", "yodobashi", "edion", "fuji", "amazon", "amz"];
    const hasKnownStore = knownStores.some(s => lowerAcc.includes(s));

    if (!hasKnownStore) {
      fullAccount = store + " " + acc;
    }

    // Tìm dòng trống tiếp theo trong Cột G (Column 7) của Sheet Categories
    const lastRowSheet = Math.max(catSheet.getLastRow(), 1);
    const gValues = catSheet.getRange(1, 7, lastRowSheet, 1).getValues();
    let lastRowG = 0;
    for (let i = gValues.length - 1; i >= 0; i--) {
      if (gValues[i][0] && String(gValues[i][0]).trim() !== "") {
        lastRowG = i + 1;
        break;
      }
    }
    const targetRowG = lastRowG > 0 ? (lastRowG + 1) : 2;
    catSheet.getRange(targetRowG, 7).setValue(fullAccount);

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    return { success: true, account: fullAccount };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}
