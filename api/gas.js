import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

const SYSTEM_CARD_SECRET_KEY = process.env.CARD_SECRET_KEY || "AgY_FiNaNcIaL_v2_SeCuRe_KeY_2026";

function getCardHmacSha256(key, message) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}
function getRandomCardSalt(len = 16) {
  return crypto.randomBytes(len / 2).toString('hex');
}
function encryptCardField(plainText, secretKey = SYSTEM_CARD_SECRET_KEY) {
  if (plainText === null || plainText === undefined || String(plainText).trim() === "") return "";
  const str = String(plainText).trim();
  if (str.startsWith("ENC:v1:")) return str;

  const key = secretKey;
  const salt = getRandomCardSalt(16);
  const utf8Bytes = Buffer.from(str, 'utf8');

  let keyStreamHex = "";
  let counter = 0;
  while (keyStreamHex.length < utf8Bytes.length * 2) {
    keyStreamHex += getCardHmacSha256(key, salt + ":ks:" + counter);
    counter++;
  }

  const cipherBytes = Buffer.alloc(utf8Bytes.length);
  for (let i = 0; i < utf8Bytes.length; i++) {
    const ksByte = parseInt(keyStreamHex.substr(i * 2, 2), 16);
    cipherBytes[i] = utf8Bytes[i] ^ ksByte;
  }
  const cipherHex = cipherBytes.toString('hex');
  const tag = getCardHmacSha256(key, salt + ":" + cipherHex).slice(0, 16);
  return `ENC:v1:${salt}:${cipherHex}:${tag}`;
}

function decryptCardField(cipherText, secretKey = SYSTEM_CARD_SECRET_KEY) {
  if (cipherText === null || cipherText === undefined || String(cipherText).trim() === "") return "";
  const str = String(cipherText).trim();
  if (!str.startsWith("ENC:v1:")) return str;

  const parts = str.split(":");
  if (parts.length < 5) return "";
  const salt = parts[2];
  const cipherHex = parts[3];
  const tag = parts[4];

  const key = secretKey;
  const expectedTag = getCardHmacSha256(key, salt + ":" + cipherHex).slice(0, 16);
  if (tag !== expectedTag) return "";

  let keyStreamHex = "";
  let counter = 0;
  const cipherBytes = Buffer.from(cipherHex, 'hex');
  while (keyStreamHex.length < cipherBytes.length * 2) {
    keyStreamHex += getCardHmacSha256(key, salt + ":ks:" + counter);
    counter++;
  }

  const plainBytes = Buffer.alloc(cipherBytes.length);
  for (let i = 0; i < cipherBytes.length; i++) {
    const ksByte = parseInt(keyStreamHex.substr(i * 2, 2), 16);
    plainBytes[i] = cipherBytes[i] ^ ksByte;
  }
  return plainBytes.toString('utf8');
}

function extractCardLast4(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.startsWith('ENC:v1:')) {
    const dec = decryptCardField(str);
    return dec ? dec.replace(/\D/g, '').slice(-4) : '';
  }
  return str.replace(/\D/g, '').slice(-4);
}

function isMaskedCardPlaceholder(val) {
  return val !== null && val !== undefined && /[•*]/.test(String(val));
}

function formatMaskedVirtualCards(walletRows) {
  return (walletRows || [])
    .filter(w => !w.is_deleted && !w.is_hidden && String(w.status || '').toUpperCase() !== 'DELETED' && String(w.type || '').toUpperCase() === 'VIRTUAL')
    .map((w, idx) => {
      const vLast4 = extractCardLast4(w.card_number);
      return {
        id: w.id,
        row: idx + 2,
        name: w.name,
        vCardName: w.name,
        cardNumber: vLast4 ? ('•••• •••• •••• ' + vLast4) : '',
        vCardNumber: vLast4 ? ('•••• •••• •••• ' + vLast4) : '',
        cardExp: vLast4 ? '••/••' : '',
        vCardExp: vLast4 ? '••/••' : '',
        cardCvv: vLast4 ? '•••' : '',
        vCardCvv: vLast4 ? '•••' : '',
        last4: vLast4,
        isVirtual: true,
        type: 'VIRTUAL',
        status: w.status || 'ACTIVE',
        is_hidden: false,
        is_deleted: false
      };
    });
}

// Master Data connection (Registry lives in Admin DB)
function getMasterDb() {
  const url = process.env.KIAN_DATABASE_URL;
  if (!url) throw new Error('Master Database URL (KIAN_DATABASE_URL) is not configured');
  return neon(url);
}

// Target User Database connection
function getTargetDb(databaseTarget) {
  let targetUrl = '';
  if (databaseTarget === 'STIEN_DATABASE_URL' || String(databaseTarget || '').toLowerCase().includes('stien')) {
    targetUrl = process.env.STIEN_DATABASE_URL;
  } else {
    targetUrl = process.env.KIAN_DATABASE_URL;
  }
  if (!targetUrl) throw new Error(`Target Database URL not found for: ${databaseTarget}`);
  return neon(targetUrl);
}

// Token helper: encodes user_id + database_target + timestamp
function createSessionToken(user) {
  const payload = {
    userId: user.user_id,
    username: user.username,
    dbTarget: user.database_target,
    role: user.role,
    time: Date.now()
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function parseSessionToken(token) {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64').toString('utf8');
    return JSON.parse(raw);
  } catch(e) {
    const isStien = token.includes('stien') || token.includes('tien');
    return {
      userId: isStien ? 'usr_stien' : 'usr_kian',
      username: isStien ? 'stien' : 'kian',
      dbTarget: isStien ? 'STIEN_DATABASE_URL' : 'KIAN_DATABASE_URL',
      role: isStien ? 'USER' : 'ADMIN'
    };
  }
}

async function verifyAdminAccess(session, masterSql) {
  if (!session || !session.username) return null;
  const rows = await masterSql`
    SELECT user_id, username, role, status
    FROM master_users
    WHERE LOWER(username) = ${String(session.username).trim().toLowerCase()}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const u = rows[0];
  if (u.status !== 'ACTIVE') return null;
  const isAdm = String(u.role || '').toUpperCase() === 'ADMIN' || String(u.username || '').toLowerCase() === 'kian';
  return isAdm ? u : null;
}

function normalizeIsoDate(dStr) {
  if (!dStr) return null;
  if (dStr instanceof Date) {
    if (isNaN(dStr.getTime())) return null;
    return `${dStr.getFullYear()}-${String(dStr.getMonth() + 1).padStart(2, '0')}-${String(dStr.getDate()).padStart(2, '0')}`;
  }
  const str = String(dStr).trim().split('T')[0];
  const p = str.split(/[-/]/);
  if (p.length === 2) {
    if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-01`;
    return `${p[1]}-${p[0].padStart(2, '0')}-01`;
  }
  if (p.length >= 3) {
    if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
  }
  return str;
}

function extractBaseOrderId(id) {
  if (!id) return '';
  const str = String(id).trim();
  const m = str.match(/^((?:PO|SO|[A-Za-z0-9]+)-\d+)-(\d{1,3})$/);
  if (m) return m[1];
  return str;
}

const _walletSchemaEnsuredDbs = new Set();

function parseWalletRef(walletRef, preferredType = '') {
  if (walletRef && typeof walletRef === 'object' && !Array.isArray(walletRef)) {
    return {
      walletId: String(walletRef.walletId || walletRef.wallet_id || walletRef.id || '').trim(),
      walletName: String(walletRef.walletName || walletRef.wallet_name || walletRef.name || '').trim(),
      preferredType: String(preferredType || walletRef.walletType || walletRef.type || '').trim().toUpperCase()
    };
  }
  return {
    walletId: '',
    walletName: String(walletRef || '').trim(),
    preferredType: String(preferredType || '').trim().toUpperCase()
  };
}

async function ensureWalletIdSchema(sql, dbKey) {
  const key = String(dbKey || 'DEFAULT');
  if (_walletSchemaEnsuredDbs.has(key)) return;
  _walletSchemaEnsuredDbs.add(key);
  try {
    await Promise.all([
      sql`ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE family_transactions ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE family_transactions ADD COLUMN IF NOT EXISTS payment_group_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS payment_group_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS statement_date TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS payment_group_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS recurring_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS recurring_period TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE bank_reconciliations ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE wallet_checkpoints ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS settle_source_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE split_expenses ADD COLUMN IF NOT EXISTS wallet_id TEXT DEFAULT ''`.catch(() => {}),
      sql`CREATE TABLE IF NOT EXISTS recurring_debts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        partner_id TEXT DEFAULT '',
        type TEXT NOT NULL DEFAULT 'TRA',
        amount NUMERIC DEFAULT 0,
        day_of_month INT DEFAULT 1,
        content TEXT DEFAULT '',
        wallet_id TEXT DEFAULT '',
        wallet_name TEXT DEFAULT '',
        is_active BOOLEAN DEFAULT true,
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`.catch(() => {}),
      sql`CREATE TABLE IF NOT EXISTS temp_transactions (
        id TEXT PRIMARY KEY,
        wallet_id TEXT DEFAULT '',
        wallet_name TEXT DEFAULT '',
        date TEXT DEFAULT '',
        ymd TEXT DEFAULT '',
        amount NUMERIC DEFAULT 0,
        type TEXT DEFAULT '-',
        note TEXT DEFAULT '',
        sig TEXT DEFAULT '',
        status TEXT DEFAULT 'PENDING',
        target_module TEXT DEFAULT '',
        target_id TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      )`.catch(() => {})
    ]);

    const allW = await sql`SELECT id, name, type, settle_source, settle_source_id, is_deleted FROM wallets`;
    if (allW && allW.length > 0) {
      const validIds = new Set(allW.map(w => String(w.id || '').trim().toLowerCase()).filter(Boolean));
      const walletById = new Map(allW.map(w => [String(w.id || '').trim(), w]));
      const byExactName = new Map();
      allW.forEach(w => {
        const low = String(w.name || '').trim().toLowerCase();
        if (!low) return;
        if (!byExactName.has(low)) byExactName.set(low, []);
        byExactName.get(low).push(w);
      });

      const pickUnique = (cands, preferCredit = null) => {
        if (!cands || cands.length === 0) return null;
        let pool = cands;
        if (preferCredit !== null) {
          const typed = pool.filter(w => (String(w.type || '').toUpperCase() === 'CREDIT') === preferCredit);
          if (typed.length > 0) pool = typed;
        }
        const active = pool.filter(w => !w.is_deleted);
        if (active.length === 1) return active[0];
        if (pool.length === 1) return pool[0];
        return null;
      };

      const validIdArr = Array.from(validIds);
      for (const [lowName, cands] of byExactName.entries()) {
        const uniq = pickUnique(cands);
        if (uniq) {
          const wId = String(uniq.id);
          const wIdLow = wId.toLowerCase();
          await Promise.all([
            sql`UPDATE business_orders SET wallet_id = ${wId}, wallet_name = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) IN (${lowName}, ${wIdLow})`.catch(() => {}),
            sql`UPDATE sales_orders SET wallet_id = ${wId}, wallet_name = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) IN (${lowName}, ${wIdLow})`.catch(() => {}),
            sql`UPDATE family_transactions SET wallet_id = ${wId}, wallet_name = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) IN (${lowName}, ${wIdLow})`.catch(() => {}),
            sql`UPDATE debts SET wallet_id = ${wId}, wallet_name = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) IN (${lowName}, ${wIdLow})`.catch(() => {}),
            sql`UPDATE bank_reconciliations SET wallet_id = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${lowName}`.catch(() => {}),
            sql`UPDATE wallet_checkpoints SET wallet_id = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${lowName}`.catch(() => {}),
            sql`UPDATE temp_transactions SET wallet_id = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${lowName}`.catch(() => {}),
            sql`UPDATE split_expenses SET wallet_id = ${wId} WHERE COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${lowName}`.catch(() => {}),
            sql`UPDATE wallet_ledger SET wallet_id = ${wId} WHERE (LOWER(TRIM(COALESCE(wallet_id, ''))) = ${lowName} OR (COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${lowName}))`.catch(() => {})
          ]);
        } else {
          const cred = pickUnique(cands, true);
          const deb = pickUnique(cands, false);
          if (cred && validIdArr.length > 0) {
            await sql`UPDATE wallet_ledger SET wallet_id = ${String(cred.id)} WHERE UPPER(COALESCE(effect_type, '')) IN ('CARD_DEBT', 'PREORDER_HOLD') AND (LOWER(TRIM(COALESCE(wallet_id, ''))) = ${lowName} OR LOWER(TRIM(COALESCE(wallet_name, ''))) = ${lowName}) AND NOT (LOWER(TRIM(COALESCE(wallet_id, ''))) = ANY(${validIdArr}))`.catch(() => {});
          }
          if (deb && validIdArr.length > 0) {
            await sql`UPDATE wallet_ledger SET wallet_id = ${String(deb.id)} WHERE UPPER(COALESCE(effect_type, '')) = 'CASH' AND (LOWER(TRIM(COALESCE(wallet_id, ''))) = ${lowName} OR LOWER(TRIM(COALESCE(wallet_name, ''))) = ${lowName}) AND NOT (LOWER(TRIM(COALESCE(wallet_id, ''))) = ANY(${validIdArr}))`.catch(() => {});
          }
        }
      }

      // Đảm bảo business_orders, sales_orders, debts, family_transactions luôn lưu ID ví ở cột wallet_name nếu đã có wallet_id
      await Promise.all([
        sql`UPDATE business_orders SET wallet_name = wallet_id WHERE COALESCE(TRIM(wallet_id), '') != '' AND COALESCE(wallet_name, '') != wallet_id`.catch(() => {}),
        sql`UPDATE sales_orders SET wallet_name = wallet_id WHERE COALESCE(TRIM(wallet_id), '') != '' AND COALESCE(wallet_name, '') != wallet_id`.catch(() => {}),
        sql`UPDATE debts SET wallet_name = wallet_id WHERE COALESCE(TRIM(wallet_id), '') != '' AND COALESCE(wallet_name, '') != wallet_id`.catch(() => {}),
        sql`UPDATE family_transactions SET wallet_name = wallet_id WHERE COALESCE(TRIM(wallet_id), '') != '' AND COALESCE(wallet_name, '') != wallet_id`.catch(() => {})
      ]);

      // Sync settle_source_id <-> settle_source trên bảng wallets
      for (const w of allW) {
        const curSettleId = String(w.settle_source_id || '').trim();
        const curSettleName = String(w.settle_source || '').trim();
        if (curSettleId && walletById.has(curSettleId)) {
          const srcW = walletById.get(curSettleId);
          if (srcW && curSettleName !== String(srcW.name || '').trim()) {
            await sql`UPDATE wallets SET settle_source = ${srcW.name} WHERE id = ${w.id}`.catch(() => {});
          }
        } else if (!curSettleId && curSettleName) {
          const cands = byExactName.get(curSettleName.toLowerCase()) || [];
          const uniqSrc = pickUnique(cands, false) || pickUnique(cands);
          if (uniqSrc) {
            await sql`UPDATE wallets SET settle_source_id = ${String(uniqSrc.id)}, settle_source = ${uniqSrc.name} WHERE id = ${w.id}`.catch(() => {});
          }
        }
      }
    }

    // Đồng bộ ID danh mục (warehouse_id, shop_id, account_id, partner_id, hu_id, auto_hu_id, auto_wallet_id) & đồng bộ tên nếu danh mục vừa được đổi tên
    await ensureCategoryIdSchema(sql);

    // Đồng bộ lại cột wallets.preorder cho các thẻ CREDIT theo đúng các đơn Pre-order thực tế đang mở (khắc phục giá trị mồ côi)
    await syncCreditWalletPreorders(sql);
  } catch (e) {
    console.error('ensureWalletIdSchema error:', e);
  }
}

function normalizeTextNoAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isWarehousePreOrderName(wh) {
  const norm = normalizeTextNoAccents(wh);
  return norm.includes('dat truoc') || norm.includes('preorder') || norm.includes('pre-order');
}

function isWarehousePendingName(wh) {
  const norm = normalizeTextNoAccents(wh);
  return norm.includes('cho ship') || norm.includes('chusen') || norm.includes('chyusen');
}

function isWarehouseCancelledName(wh) {
  const norm = normalizeTextNoAccents(wh);
  return norm === 'huy' || norm.includes(' huy') || norm.includes('huy ') || norm.includes('cancel');
}

const SYSTEM_WAREHOUSE_STATUS_ROLES = new Set(['CHO_SHIP', 'DAT_TRUOC', 'CHUSEN', 'HUY']);

function getWarehouseRole(catOrName) {
  if (catOrName && typeof catOrName === 'object') {
    const idUpper = String(catOrName.id || '').trim().toUpperCase();
    if (SYSTEM_WAREHOUSE_STATUS_ROLES.has(idUpper)) return idUpper;
    const typeUpper = String(catOrName.type || '').trim().toUpperCase();
    if (typeUpper === 'WAREHOUSE') return 'KHO_NHA';
    catOrName = catOrName.name || '';
  }
  const rawUpper = String(catOrName || '').trim().toUpperCase();
  if (SYSTEM_WAREHOUSE_STATUS_ROLES.has(rawUpper)) return rawUpper;
  const norm = normalizeTextNoAccents(catOrName);
  if (!norm) return '';
  if (norm.includes('dat truoc') || norm.includes('preorder') || norm.includes('pre-order')) return 'DAT_TRUOC';
  if (norm.includes('cho ship')) return 'CHO_SHIP';
  if (norm.includes('chusen') || norm.includes('chyusen')) return 'CHUSEN';
  if (norm.includes('kho nha') || norm.includes('kho ')) return 'KHO_NHA';
  if (norm === 'huy' || norm.includes('cancel')) return 'HUY';
  return '';
}

function isSystemWarehouseStatus(catOrName) {
  return SYSTEM_WAREHOUSE_STATUS_ROLES.has(getWarehouseRole(catOrName));
}

const CATEGORY_ID_PREFIX = {
  WAREHOUSE: 'KHO',
  PARTNER: 'DT',
  FAMILY: 'DT',
  ACCOUNT: 'TK',
  HU: 'HU',
  HU_CHITIEU: 'HU',
  HU_THUNHAP: 'HU',
  HU_KHAC: 'HU',
  SHOP: 'CH',
  TEMPLATE: 'MAU',
  SUPPLIER: 'NCC',
  CARD: 'THE'
};

function normalizeCategoryId(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s || s === 'null' || s === 'undefined' || s === '0') return null;
  return s;
}

function generateCategoryId(type) {
  const norm = String(type || '').trim().toUpperCase();
  const prefix = CATEGORY_ID_PREFIX[norm] || 'CAT';
  const tsPart = Date.now().toString(36).toUpperCase().slice(-5);
  const randPart = Math.floor(100 + Math.random() * 900).toString();
  return `${prefix}${tsPart}${randPart}`;
}

function buildCategoryByIdMap(catRows) {
  const m = new Map();
  (catRows || []).forEach(c => {
    const cleanId = normalizeCategoryId(c && c.id);
    if (cleanId) {
      m.set(cleanId, c);
    }
  });
  return m;
}

function resolveCategoryByIdOrName(catRows, types, { id = null, name = '' } = {}) {
  const allowedTypes = Array.isArray(types) ? types.map(t => String(t).toUpperCase()) : [String(types).toUpperCase()];
  const pool = (catRows || []).filter(c => allowedTypes.includes(String(c.type || '').toUpperCase()));
  const cleanId = normalizeCategoryId(id);
  if (cleanId) {
    const byId = pool.find(c => normalizeCategoryId(c.id) === cleanId);
    if (byId) return byId;
  }
  const rawName = String(name || '').trim();
  if (!rawName) return null;
  const low = rawName.toLowerCase();
  const exact = pool.find(c => String(c.name || '').trim().toLowerCase() === low);
  if (exact) return exact;
  const norm = normalizeTextNoAccents(rawName);
  const folded = pool.find(c => normalizeTextNoAccents(c.name) === norm);
  if (folded) return folded;
  if (norm === 'chusen' || norm === 'chyusen') {
    return pool.find(c => {
      const cn = normalizeTextNoAccents(c.name);
      return cn === 'chusen' || cn === 'chyusen';
    }) || null;
  }
  return null;
}

function resolveWarehouseCategory(catRows, { warehouseId = null, warehouseName = '', fallbackRole = '' } = {}) {
  const whPool = (catRows || []).filter(c => ['WAREHOUSE', 'WAREHOUSE_STATUS'].includes(String(c.type || '').toUpperCase()));
  const direct = resolveCategoryByIdOrName(whPool, ['WAREHOUSE', 'WAREHOUSE_STATUS'], { id: warehouseId, name: warehouseName });
  if (direct) return direct;
  const roleToFind = fallbackRole || getWarehouseRole(warehouseName);
  if (roleToFind) {
    const byRole = whPool.find(c => !c.is_hidden && getWarehouseRole(c) === roleToFind)
      || whPool.find(c => getWarehouseRole(c) === roleToFind);
    if (byRole) return byRole;
  }
  return null;
}

const ALL_HU_TYPES = ['HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU'];
const SYSTEM_HU_TYPES = new Set(['HU_THUNHAP', 'HU_KHAC']);
const DEFAULT_EXPENSE_JARS = ['Đầu tư', 'Thiết yếu', 'Tiết kiệm', 'Giáo dục', 'Giải trí', 'Cho đi'];
const SYSTEM_JARS = ['THU NHẬP', 'CK NỘI BỘ', 'CÔNG NỢ', 'Ứng cho nhóm', 'Tất toán thẻ', 'Khác'];
const ALL_DEFAULT_JARS = [...DEFAULT_EXPENSE_JARS, ...SYSTEM_JARS];

const DEFAULT_JAR_CONFIG = {
  investAmount: 60000,
  giaoducAmount: 0,
  pct: { thietyeu: 60, tietkiem: 15, giaoduc: 10, giaitri: 10, chodi: 5 }
};

function resolveJarConfigForMonthHelper(jarConfigs, year, month) {
  const rows = Array.isArray(jarConfigs) ? jarConfigs : [];
  if (rows.length === 0) {
    return { investAmount: DEFAULT_JAR_CONFIG.investAmount, giaoducAmount: DEFAULT_JAR_CONFIG.giaoducAmount, pct: { ...DEFAULT_JAR_CONFIG.pct } };
  }
  const exact = rows.find(r => Number(r.year) === Number(year) && Number(r.month) === Number(month));
  const sameYear = rows.filter(r => Number(r.year) === Number(year)).sort((a, b) => Number(b.month) - Number(a.month))[0];
  const fallback = rows.slice().sort((a, b) => (Number(b.year) * 100 + Number(b.month)) - (Number(a.year) * 100 + Number(a.month)))[0];
  const row = exact || sameYear || fallback;
  if (!row) {
    return { investAmount: DEFAULT_JAR_CONFIG.investAmount, giaoducAmount: DEFAULT_JAR_CONFIG.giaoducAmount, pct: { ...DEFAULT_JAR_CONFIG.pct } };
  }
  const rawCfg = (row.raw_config && typeof row.raw_config === 'object') ? row.raw_config : {};
  const gdAmt = row.giaoduc_amount !== null && row.giaoduc_amount !== undefined
    ? Number(row.giaoduc_amount)
    : (rawCfg.giaoduc_amount !== undefined ? Number(rawCfg.giaoduc_amount) : DEFAULT_JAR_CONFIG.giaoducAmount);
  return {
    investAmount: row.invest_amount !== null && row.invest_amount !== undefined ? Number(row.invest_amount) : DEFAULT_JAR_CONFIG.investAmount,
    giaoducAmount: Math.max(0, Math.round(Number(gdAmt || 0))),
    pct: {
      thietyeu: Number(row.pct_thietyeu ?? DEFAULT_JAR_CONFIG.pct.thietyeu),
      tietkiem: Number(row.pct_tietkiem ?? DEFAULT_JAR_CONFIG.pct.tietkiem),
      giaoduc: Number(row.pct_giaoduc ?? DEFAULT_JAR_CONFIG.pct.giaoduc),
      giaitri: Number(row.pct_giaitri ?? DEFAULT_JAR_CONFIG.pct.giaitri),
      chodi: Number(row.pct_chodi ?? DEFAULT_JAR_CONFIG.pct.chodi)
    }
  };
}

function getJarPctByNameHelper(cfg, normJarName) {
  if (normJarName === 'thiet yeu') return Number(cfg.pct.thietyeu || 0);
  if (normJarName === 'tiet kiem') return Number(cfg.pct.tietkiem || 0);
  if (normJarName === 'giao duc') return Number(cfg.pct.giaoduc || 0);
  if (normJarName === 'giai tri') return Number(cfg.pct.giaitri || 0);
  if (normJarName === 'cho di') return Number(cfg.pct.chodi || 0);
  return 0;
}

const SIX_JAR_SLOTS = [
  { key: 'invest', defaultName: 'Đầu tư', icon: '📈', aliases: ['dau tu', 'tu do tai chinh', 'tdtc', 'invest'] },
  { key: 'thietyeu', defaultName: 'Thiết yếu', icon: '🏠', aliases: ['thiet yeu', 'sinh hoat', 'sieu thi', 'nec'] },
  { key: 'tietkiem', defaultName: 'Tiết kiệm', icon: '💰', aliases: ['tiet kiem', 'tiet kiem dai han', 'ltss'] },
  { key: 'giaoduc', defaultName: 'Giáo dục', icon: '📚', aliases: ['giao duc', 'hoc tap', 'educ'] },
  { key: 'giaitri', defaultName: 'Giải trí', icon: '☕', aliases: ['giai tri', 'huong thu', 'play'] },
  { key: 'chodi', defaultName: 'Cho đi', icon: '❤️', aliases: ['cho di', 'tu thien', 'give'] }
];

function extractNumericCategoryRank(idStr) {
  const s = String(idStr || '').trim();
  const m = s.match(/^[A-Z]+(\d+)$/i);
  if (m) return parseInt(m[1], 10);
  return Number.MAX_SAFE_INTEGER;
}

function resolveSixJarSlotMapping(catRows) {
  const expenseJars = (Array.isArray(catRows) ? catRows : [])
    .filter(c => {
      if (!c || c.is_hidden) return false;
      const t = String(c.type || '').trim().toUpperCase();
      if (t !== 'HU_CHITIEU' && t !== 'HU') return false;
      const nm = String(c.name || '').trim();
      if (!nm) return false;
      const norm = normalizeTextNoAccents(nm);
      if (SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === norm)) return false;
      if (['thu nhap', 'ck noi bo', 'cong no', 'ung cho nhom', 'tat toan the', 'khac'].includes(norm)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const ra = extractNumericCategoryRank(a.id);
      const rb = extractNumericCategoryRank(b.id);
      if (ra !== rb) return ra - rb;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

  const usedIds = new Set();
  const usedNorms = new Set();
  const assigned = new Map();

  const pickCat = (slot, cat) => {
    const cid = normalizeCategoryId(cat.id);
    const nm = String(cat.name || '').trim();
    const norm = normalizeTextNoAccents(nm);
    if (cid) usedIds.add(cid);
    if (norm) usedNorms.add(norm);
    assigned.set(slot.key, {
      key: slot.key,
      id: cid,
      name: nm,
      icon: slot.icon
    });
  };

  const isUnused = (c) => {
    const cid = normalizeCategoryId(c.id);
    const norm = normalizeTextNoAccents(c.name);
    if (cid && usedIds.has(cid)) return false;
    if (norm && usedNorms.has(norm)) return false;
    return true;
  };

  // Pass 1a: exact normalized alias match
  SIX_JAR_SLOTS.forEach(slot => {
    if (assigned.has(slot.key)) return;
    const exactMatch = expenseJars.find(c => {
      if (!isUnused(c)) return false;
      const norm = normalizeTextNoAccents(c.name);
      return slot.aliases.includes(norm);
    });
    if (exactMatch) pickCat(slot, exactMatch);
  });

  // Pass 1b: substring alias match
  SIX_JAR_SLOTS.forEach(slot => {
    if (assigned.has(slot.key)) return;
    const subMatch = expenseJars.find(c => {
      if (!isUnused(c)) return false;
      const norm = normalizeTextNoAccents(c.name);
      return slot.aliases.some(a => norm.includes(a));
    });
    if (subMatch) pickCat(slot, subMatch);
  });

  // Pass 2: positional fallback for completely custom renames
  SIX_JAR_SLOTS.forEach((slot, idx) => {
    if (assigned.has(slot.key)) return;
    const posCandidate = (idx < expenseJars.length && isUnused(expenseJars[idx]))
      ? expenseJars[idx]
      : expenseJars.find(c => isUnused(c));
    if (posCandidate) pickCat(slot, posCandidate);
  });

  // Pass 3: default fallback
  const slots = {};
  const labels = {};
  const byId = new Map();
  const byNameNorm = new Map();
  const ordered = [];

  SIX_JAR_SLOTS.forEach(slot => {
    const res = assigned.get(slot.key) || {
      key: slot.key,
      id: null,
      name: slot.defaultName,
      icon: slot.icon
    };
    slots[slot.key] = res;
    labels[slot.key] = res.name;
    if (res.id) byId.set(res.id, slot.key);
    const norm = normalizeTextNoAccents(res.name);
    if (norm) byNameNorm.set(norm, slot.key);
    ordered.push(res);
  });

  return { slots, labels, byId, byNameNorm, ordered };
}

function resolveJarSlotKeyHelper(jarName, jarId, slotMap) {
  const cleanId = normalizeCategoryId(jarId);
  if (cleanId && slotMap && slotMap.byId && slotMap.byId.has(cleanId)) {
    return slotMap.byId.get(cleanId);
  }
  const norm = normalizeTextNoAccents(jarName);
  if (norm && slotMap && slotMap.byNameNorm && slotMap.byNameNorm.has(norm)) {
    return slotMap.byNameNorm.get(norm);
  }
  if (norm) {
    for (const slot of SIX_JAR_SLOTS) {
      if (slot.aliases.some(a => norm === a || norm.includes(a))) {
        return slot.key;
      }
    }
  }
  return '';
}

function parseFamilyDateYmHelper(dStr) {
  if (!dStr) return null;
  const str = String(dStr).trim();
  const p = str.split('T')[0].split(/[-/]/);
  if (p.length >= 3) {
    if (p[0].length === 4) {
      const y = parseInt(p[0], 10);
      const m = parseInt(p[1], 10);
      return (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) ? { year: y, month: m } : null;
    }
    const y = parseInt(p[2], 10);
    const m = parseInt(p[1], 10);
    return (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) ? { year: y, month: m } : null;
  }
  return null;
}

function isExcludedJarFamilyTxHelper(contentStr, noteStr) {
  return contentStr.includes('[Ứng hộ nhóm]') || contentStr.includes('[Tất toán') ||
    contentStr.includes('[Thu nợ]') || contentStr.includes('[Trả nợ]') ||
    noteStr.includes('[Ứng hộ nhóm]') || noteStr.includes('[Tất toán') ||
    contentStr.includes('Chuyển tiền:') || contentStr.includes('Tất toán thẻ:') ||
    contentStr.includes('Chỉnh lệch sổ thực tế') || contentStr.includes('Chốt số dư chênh lệch');
}

function isIncomeJarCategoryHelper(resolvedHu, fHuId, thuNhapCatId) {
  const normHu = normalizeTextNoAccents(resolvedHu);
  if (normHu === 'thu nhap') return true;
  if (thuNhapCatId && fHuId && normalizeCategoryId(fHuId) === normalizeCategoryId(thuNhapCatId)) return true;
  return false;
}

/**
 * Compute monthly and cumulative ("lũy kế") jar balances:
 * - Fixed investment amount (`invest_amount`, default 60,000) is deducted from previous month's income.
 * - Remaining income is split across the 5 percentage jars (`pct_*`).
 * - `remain` is the selected period's remaining balance (`budget - spent`).
 * - `carry` is the cumulative balance (`sum(budget - spent)`) from the earliest month through the selected period.
 */
function computeJarSummaryHelper({
  familyRows,
  jarConfigs,
  jarNames,
  jarCatByNameLow,
  allCatByIdMap,
  targetMonth,
  targetYear,
  isAllMonth,
  isAllYear
}) {
  let thuNhapCatId = '';
  if (allCatByIdMap) {
    for (const [cid, c] of allCatByIdMap.entries()) {
      if (normalizeTextNoAccents(c && c.name) === 'thu nhap') {
        thuNhapCatId = cid;
        break;
      }
    }
  }
  const slotMap = resolveSixJarSlotMapping(allCatByIdMap ? Array.from(allCatByIdMap.values()) : []);

  const monthBuckets = new Map();
  const ensureBucket = (ymKey) => {
    if (!monthBuckets.has(ymKey)) {
      monthBuckets.set(ymKey, { income: 0, spent: {}, transferIn: {} });
    }
    return monthBuckets.get(ymKey);
  };

  let minKey = null;
  let maxKey = null;

  (familyRows || []).forEach(f => {
    const dt = parseFamilyDateYmHelper(f.date);
    if (!dt) return;
    const ymKey = dt.year * 100 + dt.month;
    if (minKey === null || ymKey < minKey) minKey = ymKey;
    if (maxKey === null || ymKey > maxKey) maxKey = ymKey;

    const contentStr = String(f.content || '');
    const noteStr = String(f.note || '');
    if (isExcludedJarFamilyTxHelper(contentStr, noteStr)) return;

    const amt = Number(f.amount || 0);
    const loai = String(f.type || '').trim().toLowerCase() === 'thu' ? 'Thu' : 'Chi';
    const fHuId = normalizeCategoryId(f.hu_id);
    const fHuCat = fHuId ? allCatByIdMap.get(fHuId) : null;
    const resolvedHu = fHuCat ? fHuCat.name : (f.hu || '');
    const bucket = ensureBucket(ymKey);

    const isJarTransferIn = loai === 'Thu' && (
      contentStr.startsWith('Điều chỉnh Hũ từ ') ||
      noteStr.includes('Chuyển hũ (Cộng)')
    );

    if (isJarTransferIn) {
      jarNames.forEach(jName => {
        const jCat = jarCatByNameLow.get(normalizeTextNoAccents(jName));
        const matchById = jCat && fHuId && normalizeCategoryId(fHuId) === normalizeCategoryId(jCat.id);
        if (matchById || String(resolvedHu).toLowerCase().includes(jName.toLowerCase())) {
          bucket.transferIn[jName] = (bucket.transferIn[jName] || 0) + amt;
        }
      });
    } else if (loai === 'Thu') {
      if (isIncomeJarCategoryHelper(resolvedHu, fHuId, thuNhapCatId)) {
        bucket.income += amt;
      }
    } else {
      jarNames.forEach(jName => {
        const jCat = jarCatByNameLow.get(normalizeTextNoAccents(jName));
        const matchById = jCat && fHuId && normalizeCategoryId(fHuId) === normalizeCategoryId(jCat.id);
        if (matchById || String(resolvedHu).toLowerCase().includes(jName.toLowerCase())) {
          bucket.spent[jName] = (bucket.spent[jName] || 0) + amt;
        }
      });
    }
  });

  const runningCarry = {};
  const selectedBudget = {};
  const selectedSpent = {};
  const selectedCarry = {};
  jarNames.forEach(j => {
    const norm = normalizeTextNoAccents(j);
    const jCat = jarCatByNameLow ? jarCatByNameLow.get(norm) : null;
    const initBal = Number(jCat?.initial_balance || 0);
    runningCarry[j] = initBal;
    selectedBudget[j] = 0;
    selectedSpent[j] = 0;
  });

  if (minKey !== null) {
    let endKey = maxKey;
    if (!isAllYear && !isAllMonth && targetYear && targetMonth) {
      endKey = targetYear * 100 + targetMonth;
    } else if (!isAllYear && targetYear) {
      endKey = Math.min(targetYear * 100 + 12, Math.max(minKey, maxKey));
    }

    let curY = Math.floor(minKey / 100);
    let curM = minKey % 100;
    while (curY * 100 + curM <= endKey) {
      const ymKey = curY * 100 + curM;
      const prevY = curM === 1 ? curY - 1 : curY;
      const prevM = curM === 1 ? 12 : curM - 1;
      const prevBucket = monthBuckets.get(prevY * 100 + prevM);
      const prevIncome = prevBucket ? prevBucket.income : 0;
      const curBucket = monthBuckets.get(ymKey);
      const cfg = resolveJarConfigForMonthHelper(jarConfigs, curY, curM);
      const totalFixedDeduction = Number(cfg.investAmount || 0) + Number(cfg.giaoducAmount || 0);
      const remainToSplit = Math.max(0, prevIncome - totalFixedDeduction);

      const isSelected = (isAllYear || curY === targetYear) && (isAllMonth || curM === targetMonth);

      jarNames.forEach(jName => {
        const norm = normalizeTextNoAccents(jName);
        const jCat = jarCatByNameLow ? jarCatByNameLow.get(norm) : null;
        const slotKey = resolveJarSlotKeyHelper(jName, jCat ? jCat.id : null, slotMap);
        let baseBudget = 0;
        if (prevIncome > 0) {
          if (slotKey === 'invest' || norm === 'dau tu') {
            baseBudget = cfg.investAmount;
          } else if (slotKey === 'giaoduc' || norm === 'giao duc') {
            const pctVal = Number((cfg.pct && cfg.pct.giaoduc) ?? getJarPctByNameHelper(cfg, norm) ?? 0);
            baseBudget = Math.round(Number(cfg.giaoducAmount || 0) + ((remainToSplit * pctVal) / 100));
          } else if (slotKey && cfg.pct && cfg.pct[slotKey] !== undefined) {
            baseBudget = Math.round((remainToSplit * Number(cfg.pct[slotKey] || 0)) / 100);
          } else {
            baseBudget = Math.round((remainToSplit * getJarPctByNameHelper(cfg, norm)) / 100);
          }
        }
        const transferIn = curBucket ? (curBucket.transferIn[jName] || 0) : 0;
        const spent = curBucket ? (curBucket.spent[jName] || 0) : 0;
        const monthBudget = baseBudget + transferIn;
        const monthRemain = monthBudget - spent;

        runningCarry[jName] += monthRemain;
        if (isSelected) {
          selectedBudget[jName] += monthBudget;
          selectedSpent[jName] += spent;
          selectedCarry[jName] = runningCarry[jName];
        }
      });

      curM += 1;
      if (curM > 12) {
        curM = 1;
        curY += 1;
      }
    }
  }

  let prevMonthIncome = 0;
  if (!isAllYear && !isAllMonth && targetYear && targetMonth) {
    const pY = targetMonth === 1 ? targetYear - 1 : targetYear;
    const pM = targetMonth === 1 ? 12 : targetMonth - 1;
    prevMonthIncome = monthBuckets.get(pY * 100 + pM)?.income || 0;
  }

  const jars = jarNames.map(name => {
    const jCat = jarCatByNameLow.get(normalizeTextNoAccents(name));
    const slotKey = resolveJarSlotKeyHelper(name, jCat ? jCat.id : null, slotMap);
    const budget = selectedBudget[name] || 0;
    const spent = selectedSpent[name] || 0;
    const remain = budget - spent;
    const carry = selectedCarry[name] !== undefined ? selectedCarry[name] : (runningCarry[name] || 0);
    const initial_balance = Number(jCat?.initial_balance || 0);
    const is_locked = Boolean(jCat?.is_locked);
    return {
      id: jCat ? String(jCat.id) : null,
      slotKey,
      name,
      budget,
      spent,
      remain,
      carry,
      initial_balance,
      is_locked
    };
  });

  return { jars, prevMonthIncome };
}
const CATEGORY_TYPE_LABELS = {
  WAREHOUSE: 'Kho',
  WAREHOUSE_STATUS: 'Trạng thái',
  PARTNER: 'Đối tác',
  FAMILY: 'Đối tác',
  ACCOUNT: 'Tài khoản',
  HU: 'Hũ',
  HU_CHITIEU: 'Hũ Chi Tiêu',
  HU_THUNHAP: 'Hũ Thu Nhập',
  HU_KHAC: 'Hũ Khác',
  SHOP: 'Cửa hàng',
  TEMPLATE: 'Mẫu Thu Chi',
  SUPPLIER: 'Nhà cung cấp'
};

function normalizeHuLookupName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const stripped = s.replace(/^-+/, '').trim();
  const norm = normalizeTextNoAccents(stripped);
  if (norm === 'thu nhap') return 'THU NHẬP';
  if (norm === 'ck noi bo') return 'CK NỘI BỘ';
  if (norm === 'cong no') return 'CÔNG NỢ';
  if (norm === 'tat toan the') return 'Tất toán thẻ';
  if (norm === 'ung cho nhom' || norm === 'ung ho nhom') return 'Ứng cho nhóm';
  if (norm === 'thiet yeu') return 'Thiết yếu';
  if (norm === 'dau tu') return 'Đầu tư';
  if (norm === 'tiet kiem') return 'Tiết kiệm';
  if (norm === 'giao duc') return 'Giáo dục';
  if (norm === 'giai tri') return 'Giải trí';
  if (norm === 'cho di') return 'Cho đi';
  if (norm === 'khac') return 'Khác';
  return stripped || s;
}

function resolveHuCategory(catRows, { huId = null, huName = '' } = {}) {
  const huPool = (catRows || []).filter(c => ALL_HU_TYPES.includes(String(c.type || '').toUpperCase()));
  const direct = resolveCategoryByIdOrName(huPool, ALL_HU_TYPES, { id: huId, name: huName });
  if (direct) return direct;
  const canonical = normalizeHuLookupName(huName);
  if (canonical) {
    return resolveCategoryByIdOrName(huPool, ALL_HU_TYPES, { name: canonical });
  }
  return null;
}

function computeCreditCardDebtBreakdowns(allWallets, familyRows, orderRows, debtRows = []) {
  const mapById = new Map();
  const mapByName = new Map();
  const creditWallets = (allWallets || []).filter(w => String(w.type || '').toUpperCase() === 'CREDIT');
  creditWallets.forEach(w => {
    const entry = {
      cardId: String(w.id || '').trim(),
      cardName: String(w.name || '').trim(),
      totalFamilyAmt: 0,
      totalBusinessAmt: 0,
      byCycle: {},
      famAmountsSet: new Set(),
      bizAmountsSet: new Set()
    };
    if (entry.cardId) mapById.set(entry.cardId, entry);
    if (entry.cardName) mapByName.set(entry.cardName.toLowerCase(), entry);
  });

  (familyRows || []).forEach(f => {
    const loai = String(f.type || '').trim().toLowerCase();
    if (loai === 'thu') return;
    const st = String(f.status || '').toUpperCase();
    if (st.includes('PRE') || st === 'DA_HUY' || st === 'DELETED' || st === 'CANCELLED') return;
    const contentStr = String(f.content || '').trim();
    if (contentStr.toLowerCase().includes('tất toán thẻ') || String(f.id || '').startsWith('SETL_') || contentStr.toLowerCase().includes('chốt số dư') || contentStr.toLowerCase().includes('chênh lệch')) return;
    const wId = String(f.wallet_id || '').trim();
    const wNameLow = String(f.wallet_name || '').trim().toLowerCase();
    const entry = (wId && mapById.get(wId)) || (wNameLow && mapByName.get(wNameLow)) || null;
    if (!entry) return;
    const amt = Math.round(Number(f.amount || 0));
    if (amt <= 0) return;
    entry.totalFamilyAmt += amt;
    entry.famAmountsSet.add(amt);
    const ym = String(f.statement_date || f.date || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) {
      if (!entry.byCycle[ym]) entry.byCycle[ym] = { familyAmt: 0, businessAmt: 0 };
      entry.byCycle[ym].familyAmt += amt;
    }
  });

  (orderRows || []).forEach(b => {
    if (b.is_deleted) return;
    const st = String(b.status || '').toUpperCase();
    const ost = String(b.order_status || '').toUpperCase();
    if (st.includes('PRE') || ['DA_HUY', 'DA_HOAN_TIEN', 'CHO_HOAN'].includes(st) || ['DA_HUY', 'DA_HOAN_TIEN'].includes(ost)) return;
    const wId = String(b.wallet_id || '').trim();
    const wNameLow = String(b.wallet_name || '').trim().toLowerCase();
    const entry = (wId && mapById.get(wId)) || (wNameLow && mapByName.get(wNameLow)) || null;
    if (!entry) return;
    const amt = Math.round(Number(b.total_amount || 0));
    if (amt <= 0) return;
    entry.totalBusinessAmt += amt;
    entry.bizAmountsSet.add(amt);
    const ym = String(b.statement_date || b.date || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) {
      if (!entry.byCycle[ym]) entry.byCycle[ym] = { familyAmt: 0, businessAmt: 0 };
      entry.byCycle[ym].businessAmt += amt;
    }
  });

  (debtRows || []).forEach(d => {
    const st = String(d.status || '').toUpperCase();
    if (st === 'DA_TRA' || st === 'DELETED' || st === 'CANCELLED') return;
    const loai = String(d.type || '').toUpperCase();
    if (loai !== 'THU') return;
    const wId = String(d.wallet_id || '').trim();
    const wNameLow = String(d.wallet_name || '').trim().toLowerCase();
    const entry = (wId && mapById.get(wId)) || (wNameLow && mapByName.get(wNameLow)) || null;
    if (!entry) return;
    const amt = Math.round(Number(d.remaining_debt || d.amount || 0));
    if (amt <= 0) return;
    entry.totalFamilyAmt += amt;
    entry.famAmountsSet.add(amt);
    const ym = String(d.statement_date || d.date || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) {
      if (!entry.byCycle[ym]) entry.byCycle[ym] = { familyAmt: 0, businessAmt: 0 };
      entry.byCycle[ym].familyAmt += amt;
    }
  });

  return { mapById, mapByName };
}

function computeCardSettlementBreakdownForTx(f, breakdownMaps) {
  if (!f || !breakdownMaps) return null;
  const fId = String(f.id || '').trim();
  const contentStr = String(f.content || '').trim();
  const noteStr = String(f.note || '').trim();
  const isSettle = fId.startsWith('SETL_') || contentStr.toLowerCase().includes('tất toán thẻ');
  if (!isSettle) return null;

  const A = Math.round(Number(f.amount || 0));
  const idMatch = noteStr.match(/\[ID:([^\]]+)\]/i);
  let entry = idMatch ? breakdownMaps.mapById.get(idMatch[1].trim()) : null;
  if (!entry) {
    const m = contentStr.match(/Tất toán thẻ:\s*(.+?)(?:\s+từ\s+.+)?$/i);
    if (m) {
      const cNameLow = m[1].trim().toLowerCase();
      entry = breakdownMaps.mapByName.get(cNameLow) || null;
    }
  }

  const dYm = String(f.statement_date || f.date || '').trim().slice(0, 7);

  // 1. Ưu tiên đọc từ tag [GD:xxx|KD:yyy] nếu đã lưu khi tất toán
  const savedSplit = noteStr.match(/\[GD:(\d+)\|KD:(\d+)\]/i);
  if (savedSplit) {
    return {
      cardId: entry ? entry.cardId : (idMatch ? idMatch[1].trim() : ''),
      cardName: entry ? entry.cardName : '',
      familyAmt: Number(savedSplit[1] || 0),
      businessAmt: Number(savedSplit[2] || 0),
      cycleMonth: dYm
    };
  }

  if (!entry) return null;

  const sumFamAll = entry.totalFamilyAmt;
  const sumBizAll = entry.totalBusinessAmt;
  const cycle = entry.byCycle[dYm] || { familyAmt: 0, businessAmt: 0 };
  const famInCycle = cycle.familyAmt;
  const bizInCycle = cycle.businessAmt;

  let familyAmt = 0;
  let businessAmt = 0;

  if (sumFamAll === 0 && sumBizAll > 0) {
    businessAmt = A;
    familyAmt = 0;
  } else if (sumBizAll === 0 && sumFamAll > 0) {
    familyAmt = A;
    businessAmt = 0;
  } else if (entry.famAmountsSet.has(A) && !entry.bizAmountsSet.has(A)) {
    familyAmt = A;
    businessAmt = 0;
  } else if (entry.bizAmountsSet.has(A) && !entry.famAmountsSet.has(A)) {
    businessAmt = A;
    familyAmt = 0;
  } else if (Math.abs((famInCycle + bizInCycle) - A) <= 50 && (famInCycle + bizInCycle) > 0) {
    familyAmt = Math.round(famInCycle);
    businessAmt = Math.round(bizInCycle);
  } else if (bizInCycle > 0 && bizInCycle <= A) {
    businessAmt = Math.round(bizInCycle);
    familyAmt = Math.max(0, A - businessAmt);
  } else {
    businessAmt = Math.min(A, Math.round(sumBizAll));
    familyAmt = Math.max(0, A - businessAmt);
  }

  return {
    cardId: entry.cardId,
    cardName: entry.cardName,
    familyAmt,
    businessAmt,
    cycleMonth: dYm
  };
}

async function fetchTxEvaluationsMap(sql, isKian) {
  if (!isKian) return new Map();
  try {
    const rows = await sql`SELECT tx_id, eval_level FROM tx_spend_evaluations`;
    const map = new Map();
    (rows || []).forEach(r => {
      if (r.tx_id && r.eval_level) map.set(String(r.tx_id).trim(), String(r.eval_level).trim().toUpperCase());
    });
    return map;
  } catch (e) {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS tx_spend_evaluations (
          tx_id TEXT PRIMARY KEY,
          eval_level TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `;
    } catch (e2) {}
    return new Map();
  }
}

function autoClassifySpendLevelServer(f, resolvedHu, manualEvalMap) {
  if (!f) return { evalLevel: '', evalIsManual: false };
  const txId = String(f.id || '').trim();
  const loai = String(f.type || '').trim().toLowerCase();
  if (loai === 'thu' || loai === 'khoản thu' || loai === 'thu nhập') {
    return { evalLevel: '', evalIsManual: false };
  }
  const contentStr = String(f.content || '').trim();
  const noteStr = String(f.note || '').trim();
  const huStr = String(resolvedHu || f.hu || '').trim();
  const huNorm = normalizeTextNoAccents(huStr);
  const combinedNorm = normalizeTextNoAccents(contentStr + ' ' + noteStr);

  // Loại trừ giao dịch hệ thống (Tất toán thẻ, CK nội bộ, Chốt số dư, Ứng nhóm, Công nợ)
  if (
    txId.startsWith('SETL_') ||
    txId.startsWith('TRF_') ||
    contentStr.includes('[Ứng hộ nhóm]') ||
    contentStr.includes('[Tất toán') ||
    contentStr.includes('Chuyển tiền:') ||
    contentStr.includes('Tất toán thẻ:') ||
    contentStr.includes('Chốt số dư') ||
    huNorm.includes('ck noi bo') ||
    huNorm.includes('tat toan the') ||
    huNorm.includes('cong no') ||
    huNorm.includes('ung cho nhom')
  ) {
    return { evalLevel: '', evalIsManual: false };
  }

  if (manualEvalMap && txId && manualEvalMap.has(txId)) {
    return { evalLevel: manualEvalMap.get(txId), evalIsManual: true };
  }

  // 1. Chỉ đánh dấu KHÔNG CẦN THIẾT nếu có từ khóa rõ ràng
  if (/(lang phi|boc dong|mua nham|khong dung|phat |impulse|qua tay)/.test(combinedNorm)) {
    return { evalLevel: 'UNNECESSARY', evalIsManual: false };
  }

  // 2. Nhóm CÓ THỂ TIẾT CHẾ (Ăn ngoài, ăn chơi, cafe, combini, quần áo, mua sắm giải trí...)
  if (/(an ngoai|an choi|nha hang|goodspoon|cafe|ca phe|tra sua|starbucks|combini|konbini|lawson|familymart|7-11|quan ao|giay |sandal|my pham|kem chong nang|shopping|mua sam|game|xem phim|du lich|nhau |bia )/.test(combinedNorm)) {
    return { evalLevel: 'MODERATE', evalIsManual: false };
  }

  // 3. Nhóm CẦN THIẾT (Thực phẩm siêu thị nấu ăn, nhà ở, điện nước, khám bệnh, thuốc, giáo dục, đầu tư, tiết kiệm, cho đi, cố định)
  if (
    Boolean(f.is_fixed) ||
    /(sieu thi|di cho|thuc pham|gao |rau |thit |nau an|nha o|tien nha|dien |nuoc |gas |mang |internet|wifi|dt |dien thoai|suc khoe|kham benh|thuoc |benh vien|y te|vitamin|hoc |sach |nisa|dau tu|tiet kiem|gui ve vn|cho di|bieu |etc |xang |tau xe|bao hiem|thue )/.test(combinedNorm) ||
    ['dau tu', 'tiet kiem', 'giao duc', 'cho di'].includes(huNorm)
  ) {
    return { evalLevel: 'ESSENTIAL', evalIsManual: false };
  }

  // Nếu thuộc hũ Giải trí và có tên cụ thể -> Có thể tiết chế
  if (huNorm === 'giai tri' && contentStr.length >= 3) {
    return { evalLevel: 'MODERATE', evalIsManual: false };
  }

  // Nếu thuộc hũ Thiết yếu và có tên cụ thể -> Cần thiết
  if (huNorm === 'thiet yeu' && contentStr.length >= 4 && !/(khac|chi tieu)/.test(combinedNorm)) {
    return { evalLevel: 'ESSENTIAL', evalIsManual: false };
  }

  // 4. Còn lại chưa rõ thông tin -> Chưa phân loại
  return { evalLevel: 'UNCLASSIFIED', evalIsManual: false };
}

function extractSubCategoryFromContent(contentStr, jarName) {
  const s = String(contentStr || '').trim();
  if (!s) return jarName || 'Khác';
  if (s.includes(' - ')) {
    const parts = s.split(' - ').map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2) {
      if (/^2A/i.test(parts[0])) return `${parts[0]} - ${parts[1]}`;
      return `${parts[0]} - ${parts[1]}`;
    }
  }
  if (s.includes(' : ')) {
    return s.split(' : ')[0].trim();
  }
  const n = normalizeTextNoAccents(s);
  if (n.includes('sieu thi') || n.includes('di cho')) return 'Sinh hoạt - Siêu thị';
  if (n.includes('kham benh') || n.includes('thuoc') || n.includes('suc khoe')) return 'Sức khoẻ - Y tế';
  if (n.includes('nha o') || n.includes('tien nha') || n.includes('dien') || n.includes('nuoc') || n.includes('gas')) return 'Nhà ở - Điện nước';
  if (n.includes('nisa')) return 'Đầu tư NISA';
  if (n.includes('an choi') || n.includes('an ngoai') || n.includes('nha hang')) return 'Ăn ngoài & Giải trí';
  if (n.includes('quan ao') || n.includes('giay') || n.includes('sandal')) return 'Mua sắm quần áo/giày dép';
  return s.length > 26 ? s.slice(0, 26) + '…' : s;
}

function buildKianFinancialIntelligencePayload({
  familyRows,
  jarConfigs,
  jars,
  allCatByIdMap,
  txEvalMap,
  targetMonth,
  targetYear
}) {
  const now = new Date();
  const m = targetMonth || (now.getMonth() + 1);
  const y = targetYear || now.getFullYear();
  const prevM = m === 1 ? 12 : (m - 1);
  const prevY = m === 1 ? (y - 1) : y;

  const isCurrentRealMonth = (y === now.getFullYear() && m === (now.getMonth() + 1));
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysElapsed = isCurrentRealMonth ? Math.min(daysInMonth, Math.max(1, now.getDate())) : daysInMonth;
  const timeElapsedPct = Math.round((daysElapsed / daysInMonth) * 100);

  const slotMap = resolveSixJarSlotMapping(allCatByIdMap ? Array.from(allCatByIdMap.values()) : []);
  const nameInvest = slotMap.slots.invest.name;
  const nameThietYeu = slotMap.slots.thietyeu.name;
  const nameTietKiem = slotMap.slots.tietkiem.name;
  const nameGiaoDuc = slotMap.slots.giaoduc.name;
  const nameGiaiTri = slotMap.slots.giaitri.name;
  const nameChoDi = slotMap.slots.chodi.name;
  const canonicalSixJars = slotMap.ordered.map(s => s.name);
  const consumptionJarNames = [nameThietYeu, nameGiaoDuc, nameGiaiTri, nameChoDi];
  const consumptionJarsNorm = new Set(consumptionJarNames.map(n => normalizeTextNoAccents(n)));
  const jarIcons = {};
  slotMap.ordered.forEach(s => { jarIcons[s.name] = s.icon; });

  const parseYmd = (dStr) => {
    const str = String(dStr || '').trim().split('T')[0];
    const p = str.split(/[-/]/);
    if (p.length >= 3) {
      if (p[0].length === 4) {
        return { year: parseInt(p[0], 10), month: parseInt(p[1], 10), day: parseInt(p[2], 10) };
      }
      return { year: parseInt(p[2], 10), month: parseInt(p[1], 10), day: parseInt(p[0], 10) };
    }
    return null;
  };

  const isSystemExcludedRow = (f, resolvedHu) => {
    const idStr = String(f.id || '').trim();
    const contentStr = String(f.content || '').trim();
    const noteStr = String(f.note || '').trim();
    const huNorm = normalizeTextNoAccents(resolvedHu || f.hu || '');
    const st = String(f.status || '').toUpperCase();
    if (st.includes('PRE') || st === 'DA_HUY' || st === 'DELETED' || st === 'CANCELLED') return true;
    if (
      idStr.startsWith('SETL_') ||
      idStr.startsWith('TRF_') ||
      contentStr.includes('[Ứng hộ nhóm]') ||
      contentStr.includes('[Tất toán') ||
      contentStr.includes('[Thu nợ]') ||
      contentStr.includes('[Trả nợ]') ||
      noteStr.includes('[Ứng hộ nhóm]') ||
      noteStr.includes('[Tất toán') ||
      contentStr.includes('Chuyển tiền:') ||
      contentStr.includes('Tất toán thẻ:') ||
      contentStr.includes('Chốt số dư') ||
      contentStr.startsWith('Điều chỉnh Hũ từ ') ||
      noteStr.includes('Chuyển hũ (Cộng)') ||
      huNorm.includes('ck noi bo') ||
      huNorm.includes('tat toan the') ||
      huNorm.includes('cong no') ||
      huNorm.includes('ung cho nhom')
    ) {
      return true;
    }
    return false;
  };

  const matchCanonicalJar = (resolvedHu, fHuId) => {
    const cleanId = normalizeCategoryId(fHuId);
    if (cleanId && slotMap.byId && slotMap.byId.has(cleanId)) {
      const sKey = slotMap.byId.get(cleanId);
      if (sKey && slotMap.slots[sKey]) return slotMap.slots[sKey].name;
    }
    const norm = normalizeTextNoAccents(resolvedHu);
    if (norm && slotMap.byNameNorm && slotMap.byNameNorm.has(norm)) {
      const sKey = slotMap.byNameNorm.get(norm);
      if (sKey && slotMap.slots[sKey]) return slotMap.slots[sKey].name;
    }
    for (const jName of canonicalSixJars) {
      if (norm && norm.includes(normalizeTextNoAccents(jName))) return jName;
    }
    return null;
  };

  // Tổng hợp theo từng Hũ cho tháng hiện tại (m/y) và tháng trước (prevM/prevY)
  const jarStatsMap = {};
  canonicalSixJars.forEach(jName => {
    const foundJar = (jars || []).find(j => normalizeTextNoAccents(j.name) === normalizeTextNoAccents(jName));
    jarStatsMap[jName] = {
      name: jName,
      icon: jarIcons[jName] || '🍯',
      budget: foundJar ? Math.round(Number(foundJar.budget || 0)) : 0,
      spent: 0,
      remain: foundJar ? Math.round(Number(foundJar.remain || 0)) : 0,
      carry: foundJar && foundJar.carry !== undefined ? Math.round(Number(foundJar.carry || 0)) : 0,
      prevSamePeriodSpent: 0,
      prevFullMonthSpent: 0,
      txCount: 0,
      prevTxCount: 0,
      evalBreakdown: { ESSENTIAL: 0, MODERATE: 0, UNNECESSARY: 0, UNCLASSIFIED: 0 },
      categoriesMap: {},
      prevCategoriesMap: {},
      transactions: []
    };
  });

  const evalSummary = {
    ESSENTIAL: 0,
    MODERATE: 0,
    UNNECESSARY: 0,
    UNCLASSIFIED: 0,
    totalClassifiedExpense: 0
  };

  let curMonthIncome = 0;
  let prevMonthIncome = 0;
  let investProfitInPeriod = 0;

  // Chuỗi 6 tháng gần nhất cho biểu đồ xu hướng
  const monthlySeriesMap = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const my = d.getFullYear();
    const mm = d.getMonth() + 1;
    const key = `${my}-${String(mm).padStart(2, '0')}`;
    monthlySeriesMap[key] = {
      ym: key,
      label: `T${mm}/${String(my).slice(-2)}`,
      month: mm,
      year: my,
      income: 0,
      consumptionSpend: 0,
      savings: 0,
      investment: 0,
      byJar: Object.fromEntries(canonicalSixJars.map(jn => [jn, 0]))
    };
  }

  (familyRows || []).forEach(f => {
    const dt = parseYmd(f.date);
    if (!dt) return;
    const fHuId = normalizeCategoryId(f.hu_id);
    const fHuCat = fHuId && allCatByIdMap ? allCatByIdMap.get(fHuId) : null;
    const resolvedHu = fHuCat ? fHuCat.name : String(f.hu || '').trim();
    if (isSystemExcludedRow(f, resolvedHu)) return;

    const amt = Math.round(Number(f.amount || 0));
    if (amt <= 0) return;
    const loai = String(f.type || '').trim().toLowerCase();
    const isThu = (loai === 'thu' || loai === 'khoản thu' || loai === 'thu nhập');
    const ymKey = `${dt.year}-${String(dt.month).padStart(2, '0')}`;
    const cJar = matchCanonicalJar(resolvedHu, fHuId);
    const huNorm = normalizeTextNoAccents(resolvedHu);

    if (monthlySeriesMap[ymKey]) {
      const ms = monthlySeriesMap[ymKey];
      if (isThu) {
        if (huNorm === 'thu nhap' || normalizeTextNoAccents(f.content).includes('luong') || normalizeTextNoAccents(f.content).includes('thu nhap')) {
          ms.income += amt;
        }
      } else if (cJar) {
        ms.byJar[cJar] = (ms.byJar[cJar] || 0) + amt;
        if (cJar === nameTietKiem) ms.savings += amt;
        else if (cJar === nameInvest) ms.investment += amt;
        else ms.consumptionSpend += amt;
      }
    }

    if (dt.year === y && dt.month === m) {
      if (isThu) {
        if (huNorm === 'thu nhap' || normalizeTextNoAccents(f.content).includes('luong') || normalizeTextNoAccents(f.content).includes('thu nhap')) {
          curMonthIncome += amt;
        }
        if (cJar === nameInvest || normalizeTextNoAccents(f.content).includes('lai dau tu') || normalizeTextNoAccents(f.content).includes('co tuc')) {
          investProfitInPeriod += amt;
        }
      } else {
        const { evalLevel, evalIsManual } = autoClassifySpendLevelServer(f, resolvedHu, txEvalMap);
        if (evalLevel && evalSummary[evalLevel] !== undefined) {
          evalSummary[evalLevel] += amt;
          evalSummary.totalClassifiedExpense += amt;
        }
        if (cJar && jarStatsMap[cJar]) {
          const js = jarStatsMap[cJar];
          js.spent += amt;
          js.txCount += 1;
          if (evalLevel && js.evalBreakdown[evalLevel] !== undefined) {
            js.evalBreakdown[evalLevel] += amt;
          }
          const subCat = extractSubCategoryFromContent(f.content, cJar);
          if (!js.categoriesMap[subCat]) {
            js.categoriesMap[subCat] = { name: subCat, amount: 0, count: 0 };
          }
          js.categoriesMap[subCat].amount += amt;
          js.categoriesMap[subCat].count += 1;
          js.transactions.push({
            id: f.id,
            date: f.date,
            day: dt.day,
            content: f.content || '',
            amount: amt,
            subCat,
            evalLevel: evalLevel || 'UNCLASSIFIED',
            evalIsManual
          });
        }
      }
    } else if (dt.year === prevY && dt.month === prevM) {
      if (isThu) {
        if (huNorm === 'thu nhap' || normalizeTextNoAccents(f.content).includes('luong') || normalizeTextNoAccents(f.content).includes('thu nhap')) {
          prevMonthIncome += amt;
        }
      } else if (cJar && jarStatsMap[cJar]) {
        const js = jarStatsMap[cJar];
        js.prevFullMonthSpent += amt;
        js.prevTxCount += 1;
        if (dt.day <= daysElapsed) {
          js.prevSamePeriodSpent += amt;
        }
        const subCat = extractSubCategoryFromContent(f.content, cJar);
        if (!js.prevCategoriesMap[subCat]) {
          js.prevCategoriesMap[subCat] = { name: subCat, amount: 0, count: 0, samePeriodAmount: 0 };
        }
        js.prevCategoriesMap[subCat].amount += amt;
        js.prevCategoriesMap[subCat].count += 1;
        if (dt.day <= daysElapsed) {
          js.prevCategoriesMap[subCat].samePeriodAmount += amt;
        }
      }
    }
  });

  // Hoàn thiện phân tích từng Hũ (Prompt 3)
  const jarAnalyses = {};
  const allSpikingCategories = [];

  canonicalSixJars.forEach(jName => {
    const js = jarStatsMap[jName];
    const foundJar = (jars || []).find(j => normalizeTextNoAccents(j.name) === normalizeTextNoAccents(jName));
    const budget = foundJar ? Math.round(Number(foundJar.budget || 0)) : js.budget;
    const spent = js.spent;
    const remain = budget - spent;
    const usedPct = budget > 0 ? Math.round((spent / budget) * 100) : (spent > 0 ? 100 : 0);
    const dailyBurnRate = daysElapsed > 0 ? Math.round(spent / daysElapsed) : 0;
    const isFixedJar = (jName === nameInvest || jName === nameTietKiem);
    const projectedMonthEndSpend = isFixedJar ? Math.max(spent, budget) : Math.round(dailyBurnRate * daysInMonth);
    const isOverPace = !isFixedJar && budget > 0 && (usedPct > timeElapsedPct + 12);
    const willExceedBudget = budget > 0 && (spent > budget || (!isFixedJar && projectedMonthEndSpend > budget * 1.05));

    // Danh mục chi tiêu trong Hũ
    const allSubKeys = new Set([...Object.keys(js.categoriesMap), ...Object.keys(js.prevCategoriesMap)]);
    const categories = [];
    const spikingCategories = [];
    allSubKeys.forEach(k => {
      const curObj = js.categoriesMap[k] || { name: k, amount: 0, count: 0 };
      const prevObj = js.prevCategoriesMap[k] || { name: k, amount: 0, count: 0, samePeriodAmount: 0 };
      const curAmt = curObj.amount;
      const prevCompareAmt = isCurrentRealMonth ? prevObj.samePeriodAmount : prevObj.amount;
      const diffAmt = curAmt - prevCompareAmt;
      const diffPct = prevCompareAmt > 0 ? Math.round((diffAmt / prevCompareAmt) * 100) : (curAmt > 0 ? 100 : 0);
      const pctOfJar = spent > 0 ? Math.round((curAmt / spent) * 100) : 0;
      const item = {
        name: k,
        jarName: jName,
        amount: curAmt,
        count: curObj.count,
        pctOfJar,
        prevAmount: prevCompareAmt,
        prevFullAmount: prevObj.amount,
        diffAmt,
        diffPct
      };
      if (curAmt > 0) categories.push(item);
      if (curAmt > 0 && prevCompareAmt > 0 && diffPct >= 25 && diffAmt >= 1000) {
        spikingCategories.push(item);
        allSpikingCategories.push(item);
      } else if (curAmt >= 5000 && prevCompareAmt === 0 && js.prevFullMonthSpent > 0) {
        spikingCategories.push(item);
        allSpikingCategories.push(item);
      }
    });
    categories.sort((a, b) => b.amount - a.amount);

    // Top 5 khoản chi lớn nhất
    const sortedTx = [...js.transactions].sort((a, b) => b.amount - a.amount);
    const top5Transactions = sortedTx.slice(0, 5);

    // Khoản chi bất thường (lớn hơn 2.2 lần trung bình của Hũ và >= 3,000 ¥)
    const avgTxAmt = js.txCount > 0 ? (spent / js.txCount) : 0;
    const abnormalTransactions = sortedTx.filter(t => js.txCount >= 3 && t.amount >= Math.max(3000, avgTxAmt * 2.2)).slice(0, 3);

    // So sánh cùng kỳ tháng trước
    const hasPrevData = js.prevFullMonthSpent > 0;
    const prevCompareVal = isCurrentRealMonth ? js.prevSamePeriodSpent : js.prevFullMonthSpent;
    const diffVsPrevAmt = spent - prevCompareVal;
    const diffVsPrevPct = prevCompareVal > 0 ? Math.round((diffVsPrevAmt / prevCompareVal) * 100) : null;

    // Đưa ra nhận xét thông minh có cơ sở rõ ràng
    const insights = [];
    if (spent === 0 && budget === 0) {
      insights.push({
        type: 'info',
        text: `Chưa có dữ liệu giao dịch hoặc ngân sách cho hũ ${jName} trong kỳ này.`,
        basis: `Số giao dịch: 0 • Ngân sách: 0 ¥`
      });
    } else {
      if (categories.length > 0) {
        const topCat = categories[0];
        insights.push({
          type: topCat.pctOfJar >= 60 ? 'warning' : 'info',
          text: `"${topCat.name}" đang chiếm tỷ trọng lớn nhất trong hũ ${jName} (${topCat.pctOfJar}%).`,
          basis: `Cơ sở: ${topCat.amount.toLocaleString()} ¥ / ${spent.toLocaleString()} ¥ (${topCat.count} lần giao dịch)`
        });
      }
      if (!hasPrevData) {
        insights.push({
          type: 'info',
          text: `Chưa đủ dữ liệu tháng ${prevM}/${prevY} của hũ ${jName} để so sánh xu hướng tăng/giảm.`,
          basis: `Tháng ${prevM}/${prevY} ghi nhận 0 ¥ trong hũ ${jName}`
        });
      } else if (diffVsPrevPct !== null) {
        const periodLabel = isCurrentRealMonth ? `${daysElapsed} ngày đầu tháng ${prevM}` : `tháng ${prevM}/${prevY}`;
        if (diffVsPrevPct > 15) {
          insights.push({
            type: 'warning',
            text: `Chi tiêu hũ ${jName} tăng ${diffVsPrevPct}% (+${diffVsPrevAmt.toLocaleString()} ¥) so với cùng kỳ ${periodLabel}.`,
            basis: `Kỳ này: ${spent.toLocaleString()} ¥ vs Cùng kỳ tháng trước: ${prevCompareVal.toLocaleString()} ¥`
          });
        } else if (diffVsPrevPct < -15) {
          insights.push({
            type: 'success',
            text: `Chi tiêu hũ ${jName} giảm ${Math.abs(diffVsPrevPct)}% (${diffVsPrevAmt.toLocaleString()} ¥) so với cùng kỳ ${periodLabel}.`,
            basis: `Kỳ này: ${spent.toLocaleString()} ¥ vs Cùng kỳ tháng trước: ${prevCompareVal.toLocaleString()} ¥`
          });
        } else {
          insights.push({
            type: 'success',
            text: `Mức chi hũ ${jName} đang duy trì ổn định so với cùng kỳ ${periodLabel}.`,
            basis: `Chênh lệch: ${diffVsPrevAmt >= 0 ? '+' : ''}${diffVsPrevAmt.toLocaleString()} ¥ (${diffVsPrevPct}%)`
          });
        }
      }
      if (budget > 0) {
        if (spent > budget) {
          insights.push({
            type: 'danger',
            text: `Cảnh báo: Hũ ${jName} đã vượt ngân sách ${(spent - budget).toLocaleString()} ¥ (${usedPct}%).`,
            basis: `Đã chi ${spent.toLocaleString()} ¥ / Ngân sách ${budget.toLocaleString()} ¥`
          });
        } else if (willExceedBudget && !isFixedJar) {
          insights.push({
            type: 'warning',
            text: `Tốc độ chi hiện tại (${dailyBurnRate.toLocaleString()} ¥/ngày) có nguy cơ vượt ngân sách vào cuối tháng.`,
            basis: `Đã dùng ${usedPct}% ngân sách trong ${timeElapsedPct}% thời gian tháng • Dự báo cuối tháng: ${projectedMonthEndSpend.toLocaleString()} ¥`
          });
        } else {
          insights.push({
            type: 'success',
            text: `Ngân sách hũ ${jName} vẫn còn dư ${remain.toLocaleString()} ¥, đảm bảo tốt cho thời gian còn lại.`,
            basis: `Đã dùng ${usedPct}% ngân sách (${spent.toLocaleString()} ¥ / ${budget.toLocaleString()} ¥)`
          });
        }
      }
    }

    jarAnalyses[jName] = {
      name: jName,
      icon: js.icon,
      budget,
      spent,
      remain,
      carry: js.carry,
      usedPct,
      txCount: js.txCount,
      daysElapsed,
      daysInMonth,
      timeElapsedPct,
      dailyBurnRate,
      projectedMonthEndSpend,
      isOverPace,
      willExceedBudget,
      hasPrevData,
      prevSamePeriodSpent: js.prevSamePeriodSpent,
      prevFullMonthSpent: js.prevFullMonthSpent,
      diffVsPrevAmt,
      diffVsPrevPct,
      evalBreakdown: js.evalBreakdown,
      categories,
      spikingCategories,
      top5Transactions,
      abnormalTransactions,
      insights
    };
  });

  // Prompt 4: Cố vấn tiết kiệm thông minh (Savings Advisor)
  const recommendations = [];
  // 1) Tìm các khoản CÓ THỂ TIẾT CHẾ / KHÔNG CẦN THIẾT có tổng chi đáng kể hoặc lặp lại nhiều lần
  const modGroups = {};
  canonicalSixJars.forEach(jName => {
    jarStatsMap[jName].transactions.forEach(t => {
      if (t.evalLevel === 'MODERATE' || t.evalLevel === 'UNNECESSARY') {
        const key = `${jName}::${t.subCat}`;
        if (!modGroups[key]) {
          modGroups[key] = { jarName: jName, subCat: t.subCat, amount: 0, count: 0, level: t.evalLevel };
        }
        modGroups[key].amount += t.amount;
        modGroups[key].count += 1;
      }
    });
  });

  Object.values(modGroups)
    .sort((a, b) => b.amount - a.amount)
    .forEach((g, idx) => {
      if (g.amount < 1000) return;
      const cutRatio = g.level === 'UNNECESSARY' ? 0.5 : (g.count >= 3 ? 0.3 : 0.2);
      const saveAmt = Math.round((g.amount * cutRatio) / 100) * 100 || Math.round(g.amount * cutRatio);
      const proposedAmt = Math.max(0, g.amount - saveAmt);
      recommendations.push({
        id: `REC_MOD_${idx + 1}`,
        priority: g.amount >= 5000 || g.level === 'UNNECESSARY' ? 'HIGH' : 'MEDIUM',
        type: g.count >= 2 ? 'FREQUENCY' : 'MODERATE',
        itemTitle: `${g.subCat} (Hũ ${g.jarName})`,
        jarName: g.jarName,
        currentAmount: g.amount,
        proposedAmount: proposedAmt,
        estimatedSavings: saveAmt,
        reason: g.count >= 2
          ? `Khoản này xuất hiện ${g.count} lần trong kỳ (nhóm ${g.level === 'UNNECESSARY' ? 'Không cần thiết' : 'Có thể tiết chế'}). Giảm bớt tần suất ~${Math.round(cutRatio * 100)}% giúp tối ưu ngân sách mà không ảnh hưởng nhu cầu thiết yếu.`
          : `Thuộc nhóm "${g.level === 'UNNECESSARY' ? 'Không cần thiết' : 'Có thể tiết chế'}" với mức chi ${g.amount.toLocaleString()} ¥. Cân nhắc giới hạn ở mức ${proposedAmt.toLocaleString()} ¥.`
      });
    });

  // 2) Phát hiện giao dịch trùng lặp (cùng nội dung & số tiền trong cùng tháng)
  const dupCheckMap = {};
  canonicalSixJars.forEach(jName => {
    jarStatsMap[jName].transactions.forEach(t => {
      const k = `${normalizeTextNoAccents(t.content)}_${t.amount}_${t.date}`;
      if (!dupCheckMap[k]) dupCheckMap[k] = [];
      dupCheckMap[k].push({ ...t, jarName: jName });
    });
  });
  Object.values(dupCheckMap).forEach((arr, idx) => {
    if (arr.length >= 2) {
      const sample = arr[0];
      const dupTotal = sample.amount * arr.length;
      recommendations.push({
        id: `REC_DUP_${idx + 1}`,
        priority: 'HIGH',
        type: 'DUPLICATE',
        itemTitle: `Kiểm tra trùng lặp: "${sample.content}"`,
        jarName: sample.jarName,
        currentAmount: dupTotal,
        proposedAmount: sample.amount,
        estimatedSavings: dupTotal - sample.amount,
        reason: `Phát hiện ${arr.length} giao dịch cùng ngày ${sample.date} với cùng số tiền ${sample.amount.toLocaleString()} ¥ trong hũ ${sample.jarName}. Hãy kiểm tra xem có nhập trùng hay không.`
      });
    }
  });

  // 3) Phát hiện danh mục tăng đột biến (không thuộc nhóm y tế/khám bệnh bắt buộc)
  allSpikingCategories.forEach((sc, idx) => {
    const nNorm = normalizeTextNoAccents(sc.name);
    if (nNorm.includes('kham benh') || nNorm.includes('suc khoe') || nNorm.includes('thuoc')) return;
    if (recommendations.some(r => r.itemTitle.includes(sc.name))) return;
    const targetAmt = Math.round((sc.prevAmount + sc.amount) / 2);
    const saveAmt = Math.max(0, sc.amount - targetAmt);
    if (saveAmt >= 500) {
      recommendations.push({
        id: `REC_SPIKE_${idx + 1}`,
        priority: sc.diffPct >= 50 ? 'HIGH' : 'MEDIUM',
        type: 'SPIKE',
        itemTitle: `${sc.name} (Hũ ${sc.jarName})`,
        jarName: sc.jarName,
        currentAmount: sc.amount,
        proposedAmount: targetAmt,
        estimatedSavings: saveAmt,
        reason: `Mức chi tăng +${sc.diffPct}% (+${sc.diffAmt.toLocaleString()} ¥) so với cùng kỳ tháng trước (${sc.prevAmount.toLocaleString()} ¥). Đưa về mức trung bình 2 tháng giúp tiết kiệm ${saveAmt.toLocaleString()} ¥.`
      });
    }
  });

  const totalEstimatedSavings = recommendations.reduce((s, r) => s + Number(r.estimatedSavings || 0), 0);
  const tietKiemJar = jarAnalyses[nameTietKiem] || { budget: 0, spent: 0, remain: 0 };
  const dauTuJar = jarAnalyses[nameInvest] || { budget: 0, spent: 0, remain: 0 };

  // Đề xuất ngân sách tháng tiếp theo dựa trên thực tế
  const nextMonth = m === 12 ? 1 : (m + 1);
  const nextYear = m === 12 ? (y + 1) : y;
  const curCfg = (jarConfigs || []).find(c => Number(c.month) === m && Number(c.year) === y)
    || (jarConfigs && jarConfigs.length > 0 ? jarConfigs[jarConfigs.length - 1] : null);
  const curPct = {
    invest: curCfg ? Math.round(Number(curCfg.invest_amount || 60000)) : 60000,
    thietyeu: curCfg ? Math.round(Number(curCfg.pct_thietyeu || 55)) : 55,
    tietkiem: curCfg ? Math.round(Number(curCfg.pct_tietkiem || 10)) : 10,
    giaoduc: curCfg ? Math.round(Number(curCfg.pct_giaoduc || 10)) : 10,
    giaitri: curCfg ? Math.round(Number(curCfg.pct_giaitri || 10)) : 10,
    chodi: curCfg ? Math.round(Number(curCfg.pct_chodi || 15)) : 15
  };

  const propPct = { ...curPct };
  let proposalReason = `Duy trì cơ cấu phân bổ chuẩn hiện tại vì hũ ${nameThietYeu} vẫn trong ngưỡng an toàn.`;
  if (jarAnalyses[nameGiaiTri] && jarAnalyses[nameGiaiTri].usedPct > 90 && propPct.giaitri >= 10) {
    propPct.giaitri = Math.max(5, propPct.giaitri - 2);
    propPct.tietkiem = propPct.tietkiem + 2;
    proposalReason = `Hũ ${nameGiaiTri} đang dùng ${jarAnalyses[nameGiaiTri].usedPct}% ngân sách; đề xuất chuyển 2% từ ${nameGiaiTri} sang ${nameTietKiem} (${propPct.tietkiem}%) để tăng tích lũy tháng ${nextMonth}/${nextYear}.`;
  } else if (jarAnalyses[nameThietYeu] && jarAnalyses[nameThietYeu].usedPct < 60 && propPct.thietyeu >= 60) {
    propPct.thietyeu = propPct.thietyeu - 5;
    propPct.tietkiem = propPct.tietkiem + 5;
    proposalReason = `Chi phí ${nameThietYeu} thực tế chỉ chiếm ${jarAnalyses[nameThietYeu].usedPct}% ngân sách; đề xuất chuyển 5% dư từ ${nameThietYeu} sang Hũ ${nameTietKiem} (${propPct.tietkiem}%) cho tháng ${nextMonth}/${nextYear}.`;
  }

  // Prompt 5: Dashboard phân tích tổng thể 6 Ví/Hũ
  const totalConsumptionSpend = consumptionJarNames.reduce((s, jn) => s + (jarAnalyses[jn]?.spent || 0), 0);
  const totalConsumptionBudget = consumptionJarNames.reduce((s, jn) => s + (jarAnalyses[jn]?.budget || 0), 0);
  const totalAllJarsBudget = canonicalSixJars.reduce((s, jn) => s + (jarAnalyses[jn]?.budget || 0), 0);
  const totalAllJarsOutflow = canonicalSixJars.reduce((s, jn) => s + (jarAnalyses[jn]?.spent || 0), 0);
  const totalBudgetRemaining = totalAllJarsBudget - totalAllJarsOutflow;

  // Tiền tiết kiệm thực tế: Ngân sách phân bổ vào Tiết kiệm + phần dư chưa tiêu của các hũ tiêu dùng
  const actualSavedInMonth = Math.max(0, tietKiemJar.budget) + Math.max(0, totalConsumptionBudget - totalConsumptionSpend);
  const investCapitalInMonth = Math.max(dauTuJar.spent, dauTuJar.budget);

  // 5 chỉ báo tự động (Auto Highlights)
  const consumptionJarList = consumptionJarNames.map(jn => jarAnalyses[jn]);
  const topSpendingJarObj = [...consumptionJarList].sort((a, b) => b.spent - a.spent)[0] || null;
  const fastestBurnJarObj = [...consumptionJarList].sort((a, b) => b.usedPct - a.usedPct)[0] || null;
  const atRiskJarList = consumptionJarList.filter(j => j.willExceedBudget || j.spent > j.budget);
  const fastestGrowingCatObj = [...allSpikingCategories].sort((a, b) => b.diffAmt - a.diffAmt)[0] || null;
  const baseIncomeForRate = curMonthIncome > 0 ? curMonthIncome : totalAllJarsBudget;
  const savingsRatePct = baseIncomeForRate > 0 ? Math.round(((tietKiemJar.budget + investCapitalInMonth) / baseIncomeForRate) * 100) : 0;

  return {
    period: { month: m, year: y, prevMonth: prevM, prevYear: prevY, daysElapsed, daysInMonth, timeElapsedPct, isCurrentRealMonth },
    evalSummary,
    jarAnalyses,
    savingsAdvisor: {
      recommendations,
      totalEstimatedSavings,
      actualSavedAmount: actualSavedInMonth,
      nextMonthProposal: {
        month: nextMonth,
        year: nextYear,
        current: curPct,
        proposed: propPct,
        jarLabels: slotMap.labels,
        reason: proposalReason
      }
    },
    dashboard6Jars: {
      metrics: {
        totalIncome: curMonthIncome,
        prevMonthIncomeForBudget: totalAllJarsBudget,
        totalConsumptionSpend,
        totalConsumptionBudget,
        totalAllJarsBudget,
        totalAllJarsOutflow,
        totalBudgetRemaining,
        totalSavingsBudget: tietKiemJar.budget,
        totalSavingsOutflow: tietKiemJar.spent,
        actualSavedInMonth,
        investCapital: investCapitalInMonth,
        investExecuted: dauTuJar.spent,
        investProfit: investProfitInPeriod,
        savingsRatePct
      },
      allocationRatios: canonicalSixJars.map(jn => {
        const ja = jarAnalyses[jn];
        return {
          name: jn,
          icon: ja.icon,
          budget: ja.budget,
          spent: ja.spent,
          remain: ja.remain,
          carry: ja.carry,
          usedPct: ja.usedPct,
          pctOfTotalBudget: totalAllJarsBudget > 0 ? Math.round((ja.budget / totalAllJarsBudget) * 100) : 0,
          pctOfTotalSpend: totalAllJarsOutflow > 0 ? Math.round((ja.spent / totalAllJarsOutflow) * 100) : 0
        };
      }),
      monthlySeries: Object.values(monthlySeriesMap),
      autoHighlights: {
        topSpendingJar: topSpendingJarObj && topSpendingJarObj.spent > 0
          ? { name: topSpendingJarObj.name, spent: topSpendingJarObj.spent, budget: topSpendingJarObj.budget, usedPct: topSpendingJarObj.usedPct }
          : null,
        fastestBurnJar: fastestBurnJarObj && fastestBurnJarObj.spent > 0
          ? { name: fastestBurnJarObj.name, usedPct: fastestBurnJarObj.usedPct, dailyBurnRate: fastestBurnJarObj.dailyBurnRate, timeElapsedPct }
          : null,
        atRiskJars: atRiskJarList.map(j => ({ name: j.name, spent: j.spent, budget: j.budget, usedPct: j.usedPct, projected: j.projectedMonthEndSpend })),
        fastestGrowingCategory: fastestGrowingCatObj || null,
        savingsCapacity: {
          plannedSavingsAndInvest: tietKiemJar.budget + dauTuJar.budget,
          unspentConsumptionBuffer: Math.max(0, totalConsumptionBudget - totalConsumptionSpend),
          savingsRatePct
        }
      }
    }
  };
}

async function ensureCategoryExistsByName(sql, catRows, catType, rawName) {
  const cleanName = String(rawName || '').trim();
  if (!cleanName) return null;
  const normType = String(catType || '').trim().toUpperCase();
  const lookupTypes = normType === 'PARTNER' ? ['PARTNER', 'FAMILY'] : (ALL_HU_TYPES.includes(normType) ? ALL_HU_TYPES : [normType]);
  let matched = ALL_HU_TYPES.includes(normType)
    ? resolveHuCategory(catRows, { huName: cleanName })
    : (normType === 'WAREHOUSE'
      ? resolveWarehouseCategory(catRows, { warehouseName: cleanName })
      : resolveCategoryByIdOrName(catRows, lookupTypes, { name: cleanName }));
  if (matched) return matched;

  const insertName = ALL_HU_TYPES.includes(normType) ? normalizeHuLookupName(cleanName) : cleanName;
  const insertType = ALL_HU_TYPES.includes(normType) ? (normalizeTextNoAccents(insertName) === 'thu nhap' ? 'HU_THUNHAP' : (SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(insertName)) ? 'HU_KHAC' : 'HU_CHITIEU')) : normType;
  try {
    const dbExisting = await sql`
      SELECT id, type, name, is_hidden FROM categories
      WHERE type = ANY(${lookupTypes}) AND LOWER(TRIM(name)) = ${insertName.toLowerCase()}
      LIMIT 1
    `;
    if (dbExisting && dbExisting[0]) {
      if (Array.isArray(catRows)) catRows.push(dbExisting[0]);
      return dbExisting[0];
    }
    const newId = generateCategoryId(normType);
    const inserted = await sql`
      INSERT INTO categories (id, type, name, is_hidden)
      VALUES (${newId}, ${insertType}, ${insertName}, false)
      RETURNING id, type, name, is_hidden
    `;
    if (inserted && inserted[0]) {
      if (Array.isArray(catRows)) catRows.push(inserted[0]);
      return inserted[0];
    }
  } catch (e) {}
  return null;
}

async function upsertFamilyTemplateCategory(sql, { content, huId = null, huName = '', walletId = '', walletName = '' }) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent) return null;
  try {
    const existing = await sql`
      SELECT id FROM family_templates
      WHERE LOWER(TRIM(COALESCE(content_template, ''))) = ${cleanContent.toLowerCase()}
      LIMIT 1
    `;
    const cleanHuId = normalizeCategoryId(huId);
    const cleanWId = String(walletId || '').trim() || null;
    const cleanWName = String(walletName || '').trim() || null;
    const cleanHuName = String(huName || '').trim() || null;
    if (existing.length > 0) {
      await sql`
        UPDATE family_templates
        SET is_hidden = false,
            content_template = ${cleanContent},
            auto_hu_id = COALESCE(${cleanHuId}, auto_hu_id),
            auto_hu_name = COALESCE(${cleanHuName}, auto_hu_name),
            auto_wallet_id = COALESCE(${cleanWId}, auto_wallet_id),
            auto_wallet_name = COALESCE(${cleanWName}, auto_wallet_name)
        WHERE id = ${existing[0].id}
      `;
      return existing[0].id;
    }
    const newTplId = generateCategoryId('TEMPLATE');
    const ins = await sql`
      INSERT INTO family_templates (id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden)
      VALUES (${newTplId}, ${cleanContent}, ${cleanHuId}, ${cleanHuName}, ${cleanWId}, ${cleanWName}, false)
      RETURNING id
    `;
    return ins[0]?.id || newTplId;
  } catch (e) {
    return null;
  }
}

function mapCategoryRowWithRefs(c, catByIdMap, walletByIdMap) {
  const autoHuId = normalizeCategoryId(c.auto_hu_id);
  const huObj = autoHuId && catByIdMap ? catByIdMap.get(autoHuId) : null;
  const resolvedHuName = huObj ? String(huObj.name || '').trim() : String(c.auto_hu_name || '').trim();

  const autoWalletId = String(c.auto_wallet_id || '').trim() || null;
  const walletObj = autoWalletId && walletByIdMap ? walletByIdMap.get(autoWalletId) : null;
  const resolvedWalletName = walletObj ? String(walletObj.name || '').trim() : String(c.auto_wallet_name || '').trim();

  const contentTemplate = String(c.content_template || (String(c.type || '').toUpperCase() === 'TEMPLATE' ? c.name : '') || '').trim();
  const rowType = c.type ? String(c.type).toUpperCase() : (contentTemplate ? 'TEMPLATE' : '');

  const isStatusType = rowType === 'WAREHOUSE_STATUS' || (rowType === 'WAREHOUSE' && SYSTEM_WAREHOUSE_STATUS_ROLES.has(String(c.id || '').trim().toUpperCase()));
  const warehouseRole = (rowType === 'WAREHOUSE' || rowType === 'WAREHOUSE_STATUS') ? (getWarehouseRole(c) || 'KHO_NHA') : null;

  return {
    id: normalizeCategoryId(c.id) || String(c.id || '').trim(),
    type: rowType,
    typeLabel: CATEGORY_TYPE_LABELS[rowType] || rowType,
    name: String(c.name || contentTemplate || '').trim(),
    role: warehouseRole,
    isSystemStatus: isStatusType,
    is_hidden: Boolean(c.is_hidden),
    is_locked: Boolean(c.is_locked),
    initial_balance: Number(c.initial_balance || 0),
    contentTemplate,
    autoHuId,
    autoHuName: resolvedHuName,
    jar: resolvedHuName,
    autoWalletId: autoWalletId || '',
    autoWalletName: resolvedWalletName,
    source: resolvedWalletName
  };
}

function mapTemplateCategoriesForClient(tplRows, catByIdMap, walletByIdMap) {
  return (tplRows || [])
    .filter(c => !c.is_hidden && String(c.content_template || c.name || '').trim() !== '')
    .map(c => {
      const m = mapCategoryRowWithRefs({ ...c, type: 'TEMPLATE', name: c.content_template || c.name }, catByIdMap, walletByIdMap);
      return {
        id: m.id,
        type: 'TEMPLATE',
        name: m.contentTemplate || m.name,
        contentTemplate: m.contentTemplate || m.name,
        autoHuId: m.autoHuId,
        jar: m.jar,
        autoWalletId: m.autoWalletId,
        source: m.source
      };
    });
}

async function fetchSetupUsedSets(sql) {
  const [
    usedDebtsRows, usedOrdersAccRows, usedOrdersShopRows, usedOrdersWhRows,
    usedSalesWhRows, usedTransferWhRows, usedFamilyHuRows, usedTemplateRows,
    usedWalletsLedger, usedWalletsOrders, usedWalletsDebts, usedWalletsFamily
  ] = await Promise.all([
    sql`SELECT DISTINCT LOWER(TRIM(name)) as name, partner_id as id FROM debts WHERE (name IS NOT NULL AND TRIM(name) != '') OR partner_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(account)) as acc, account_id as id FROM business_orders WHERE (account IS NOT NULL AND TRIM(account) != '') OR account_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(shop)) as shop, shop_id as id FROM business_orders WHERE (shop IS NOT NULL AND TRIM(shop) != '') OR shop_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(warehouse)) as wh, warehouse_id as id FROM business_orders WHERE (warehouse IS NOT NULL AND TRIM(warehouse) != '') OR warehouse_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(warehouse)) as wh, warehouse_id as id FROM sales_orders WHERE (warehouse IS NOT NULL AND TRIM(warehouse) != '') OR warehouse_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(from_warehouse)) as wh, from_warehouse_id as id FROM stock_transfers WHERE from_warehouse IS NOT NULL OR from_warehouse_id IS NOT NULL UNION SELECT DISTINCT LOWER(TRIM(to_warehouse)) as wh, to_warehouse_id as id FROM stock_transfers WHERE to_warehouse IS NOT NULL OR to_warehouse_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(hu)) as hu, hu_id as id FROM family_transactions WHERE (hu IS NOT NULL AND TRIM(hu) != '') OR hu_id IS NOT NULL`.catch(() => []),
    sql`SELECT DISTINCT auto_hu_id as id FROM family_templates WHERE auto_hu_id IS NOT NULL`.catch(() => []),
    sql`SELECT DISTINCT LOWER(TRIM(wallet_name)) as name, LOWER(TRIM(wallet_id)) as id FROM wallet_ledger WHERE wallet_name IS NOT NULL OR wallet_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(wallet_name)) as name, LOWER(TRIM(wallet_id)) as id FROM business_orders WHERE wallet_name IS NOT NULL OR wallet_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(wallet_name)) as name, LOWER(TRIM(wallet_id)) as id FROM debts WHERE wallet_name IS NOT NULL OR wallet_id IS NOT NULL`,
    sql`SELECT DISTINCT LOWER(TRIM(wallet_name)) as name, LOWER(TRIM(wallet_id)) as id FROM family_transactions WHERE wallet_name IS NOT NULL OR wallet_id IS NOT NULL`
  ]);

  const toUsedArr = (rows, key) => Array.from(new Set((rows || []).flatMap(r => [r[key], r.id != null ? String(r.id) : null]).filter(Boolean)));
  const usedWalletsSet = new Set();
  [usedWalletsLedger, usedWalletsOrders, usedWalletsDebts, usedWalletsFamily].forEach(arr => {
    (arr || []).forEach(r => { if (r.name) usedWalletsSet.add(r.name); if (r.id) usedWalletsSet.add(r.id); });
  });

  return {
    partners: toUsedArr(usedDebtsRows, 'name'),
    accounts: toUsedArr(usedOrdersAccRows, 'acc'),
    shops: toUsedArr(usedOrdersShopRows, 'shop'),
    warehouses: Array.from(new Set([...toUsedArr(usedOrdersWhRows, 'wh'), ...toUsedArr(usedSalesWhRows, 'wh'), ...toUsedArr(usedTransferWhRows, 'wh')])),
    hus: Array.from(new Set([...toUsedArr(usedFamilyHuRows, 'hu'), ...toUsedArr(usedTemplateRows, 'hu')])),
    wallets: Array.from(usedWalletsSet)
  };
}

function buildSetupCategoryResponsePayload(allCategories, allTemplates, allWallets, usedItems, isKian) {
  const catByIdMap = buildCategoryByIdMap(allCategories);
  const walletByIdMap = buildWalletByIdMap(allWallets);
  const mappedCats = (allCategories || []).map(c => mapCategoryRowWithRefs(c, catByIdMap, walletByIdMap));
  const mappedTpls = (allTemplates || []).map(t => mapCategoryRowWithRefs({ ...t, type: 'TEMPLATE', name: t.content_template || t.name }, catByIdMap, walletByIdMap));
  const activeCats = mappedCats.filter(c => !c.is_hidden);
  const hiddenCats = mappedCats.filter(c => c.is_hidden);
  const templateItems = mappedTpls.filter(t => !t.is_hidden);
  const hiddenTemplateItems = mappedTpls.filter(t => t.is_hidden);

  const byTypes = (list, types) => list.filter(c => types.includes(c.type));
  const partnerItems = byTypes(activeCats, ['PARTNER', 'FAMILY']);
  const warehouseItems = byTypes(activeCats, ['WAREHOUSE']).filter(c => !c.isSystemStatus);
  const accountItems = byTypes(activeCats, ['ACCOUNT']);
  const shopItems = byTypes(activeCats, ['SHOP']);
  const huItems = byTypes(activeCats, ['HU_CHITIEU', 'HU']).filter(c => !SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(c.name)));
  const huIncomeItems = byTypes(activeCats, ['HU_THUNHAP']);
  const huOtherItems = byTypes(activeCats, ['HU_KHAC']);

  const hiddenPartnerItems = byTypes(hiddenCats, ['PARTNER', 'FAMILY']);
  const hiddenWarehouseItems = byTypes(hiddenCats, ['WAREHOUSE']).filter(c => !c.isSystemStatus);
  const hiddenAccountItems = byTypes(hiddenCats, ['ACCOUNT']);
  const hiddenShopItems = byTypes(hiddenCats, ['SHOP']);
  const hiddenHuItems = byTypes(hiddenCats, ['HU_CHITIEU', 'HU']).filter(c => !SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(c.name)));

  const partners = partnerItems.map(c => c.name);
  const warehouses = warehouseItems.map(c => c.name);
  const accounts = accountItems.map(c => c.name);
  const shops = shopItems.map(c => c.name);
  const hus = huItems.map(c => c.name);
  const templates = templateItems.map(c => c.name);

  return {
    familyMembers: partners.length ? partners : (isKian ? ['Nam', 'Chi'] : ['Tiên']),
    warehouses: warehouses.length ? warehouses : ['Kho 1F', 'Kho 2F'],
    accounts,
    shops,
    hus,
    huGroups: { income: huIncomeItems.map(c => c.name), expense: huItems.map(c => c.name), other: huOtherItems.map(c => c.name) },
    templates,
    hiddenFamilyMembers: hiddenPartnerItems.map(c => c.name),
    hiddenWarehouses: hiddenWarehouseItems.map(c => c.name),
    hiddenAccounts: hiddenAccountItems.map(c => c.name),
    hiddenShops: hiddenShopItems.map(c => c.name),
    hiddenHus: hiddenHuItems.map(c => c.name),
    hiddenTemplates: hiddenTemplateItems.map(c => c.name),
    categoryItems: {
      partners: partnerItems,
      warehouses: warehouseItems,
      accounts: accountItems,
      shops: shopItems,
      hus: huItems,
      templates: templateItems,
      hiddenPartners: hiddenPartnerItems,
      hiddenWarehouses: hiddenWarehouseItems,
      hiddenAccounts: hiddenAccountItems,
      hiddenShops: hiddenShopItems,
      hiddenHus: hiddenHuItems,
      hiddenTemplates: hiddenTemplateItems
    },
    usedItems,
    statementTemplates: [],
    wallets: (allWallets || [])
      .filter(w => !w.is_deleted && !w.is_hidden && String(w.status || '').toUpperCase() !== 'DELETED' && String(w.type || '').toUpperCase() !== 'VIRTUAL')
      .map(w => ({ id: w.id, name: w.name, type: w.type })),
    virtualCards: formatMaskedVirtualCards(allWallets),
    categories: [...activeCats, ...templateItems]
  };
}

async function ensureCategoryIdSchema(sql) {
  try {
    await Promise.all([
      sql`
        CREATE TABLE IF NOT EXISTS family_templates (
          id TEXT PRIMARY KEY,
          content_template TEXT NOT NULL,
          auto_hu_id TEXT,
          auto_hu_name TEXT,
          auto_wallet_id TEXT,
          auto_wallet_name TEXT,
          is_hidden BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `.catch(() => {}),
      sql`ALTER TABLE family_transactions ADD COLUMN IF NOT EXISTS hu_id TEXT`.catch(() => {}),
      sql`ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS warehouse_id TEXT`.catch(() => {}),
      sql`ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS shop_id TEXT`.catch(() => {}),
      sql`ALTER TABLE business_orders ADD COLUMN IF NOT EXISTS account_id TEXT`.catch(() => {}),
      sql`ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS warehouse_id TEXT`.catch(() => {}),
      sql`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS from_warehouse_id TEXT`.catch(() => {}),
      sql`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS to_warehouse_id TEXT`.catch(() => {}),
      sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS partner_id TEXT`.catch(() => {}),
      sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS initial_balance BIGINT DEFAULT 0`.catch(() => {}),
      sql`ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false`.catch(() => {})
    ]);

    // Di chuyển dữ liệu TEMPLATE cũ (nếu còn nằm trong categories) sang bảng family_templates rồi dọn cột thừa khỏi categories
    const legacyTplCol = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'content_template'
      LIMIT 1
    `.catch(() => []);
    if (legacyTplCol && legacyTplCol.length > 0) {
      await sql`
        INSERT INTO family_templates (id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden)
        SELECT id, COALESCE(NULLIF(TRIM(content_template), ''), name), auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, COALESCE(is_hidden, false)
        FROM categories
        WHERE UPPER(type) = 'TEMPLATE' OR COALESCE(TRIM(content_template), '') != ''
        ON CONFLICT (id) DO NOTHING
      `.catch(() => {});
      await sql`DELETE FROM categories WHERE UPPER(type) = 'TEMPLATE'`.catch(() => {});
      await Promise.all([
        sql`ALTER TABLE categories DROP COLUMN IF EXISTS content_template`.catch(() => {}),
        sql`ALTER TABLE categories DROP COLUMN IF EXISTS auto_hu_id`.catch(() => {}),
        sql`ALTER TABLE categories DROP COLUMN IF EXISTS auto_hu_name`.catch(() => {}),
        sql`ALTER TABLE categories DROP COLUMN IF EXISTS auto_wallet_id`.catch(() => {}),
        sql`ALTER TABLE categories DROP COLUMN IF EXISTS auto_wallet_name`.catch(() => {}),
        sql`ALTER TABLE categories DROP COLUMN IF EXISTS role`.catch(() => {})
      ]);
    }

    let catRows = await sql`
      SELECT id, type, name, is_hidden
      FROM categories ORDER BY id ASC
    `.catch(() => []);
    if (!Array.isArray(catRows)) catRows = [];

    // Seed danh mục Hũ (HU) chuẩn nếu chưa có để mọi giao dịch Thu Chi đều gắn được hu_id
    for (const jarName of ALL_DEFAULT_JARS) {
      const exists = resolveHuCategory(catRows, { huName: jarName });
      if (!exists) {
        const newHuId = generateCategoryId('HU');
        const ins = await sql`
          INSERT INTO categories (id, type, name, is_hidden)
          VALUES (${newHuId}, 'HU', ${jarName}, false)
          RETURNING id, type, name, is_hidden
        `.catch(() => []);
        if (ins && ins[0]) catRows.push(ins[0]);
      }
    }

    if (catRows.length === 0) return;

    const allWallets = await sql`SELECT id, name, type, is_deleted FROM wallets`.catch(() => []);
    const walletByIdMap = buildWalletByIdMap(allWallets);
    const catByIdMap = buildCategoryByIdMap(catRows);

    const byType = (types) => catRows.filter(c => types.includes(String(c.type || '').toUpperCase()));
    const whCats = byType(['WAREHOUSE']);
    const shopCats = byType(['SHOP']);
    const accCats = byType(['ACCOUNT']);
    const partnerCats = byType(['PARTNER', 'FAMILY']);
    const huCats = byType(ALL_HU_TYPES);

    // 1. Sync ID/tên: Purchase (warehouse, account), Sales (warehouse), StockTransfer (from_warehouse, to_warehouse) luôn lưu ID; Family/Debt.name/Purchase.shop đồng bộ tên nếu cần
    for (const c of whCats) {
      await Promise.all([
        sql`UPDATE business_orders SET warehouse = ${c.id} WHERE warehouse_id = ${c.id} AND COALESCE(warehouse, '') != ${c.id}`.catch(() => {}),
        sql`UPDATE sales_orders SET warehouse = ${c.id} WHERE warehouse_id = ${c.id} AND COALESCE(warehouse, '') != ${c.id}`.catch(() => {}),
        sql`UPDATE stock_transfers SET from_warehouse = ${c.id} WHERE from_warehouse_id = ${c.id} AND COALESCE(from_warehouse, '') != ${c.id}`.catch(() => {}),
        sql`UPDATE stock_transfers SET to_warehouse = ${c.id} WHERE to_warehouse_id = ${c.id} AND COALESCE(to_warehouse, '') != ${c.id}`.catch(() => {})
      ]);
    }
    for (const c of shopCats) {
      await sql`UPDATE business_orders SET shop = ${c.name} WHERE shop_id = ${c.id} AND COALESCE(shop, '') != ${c.name}`.catch(() => {});
    }
    for (const c of accCats) {
      await sql`UPDATE business_orders SET account = ${c.id} WHERE account_id = ${c.id} AND COALESCE(account, '') != ${c.id}`.catch(() => {});
    }
    for (const c of partnerCats) {
      await sql`UPDATE debts SET name = ${c.id} WHERE partner_id = ${c.id} AND COALESCE(name, '') != ${c.id}`.catch(() => {});
    }
    for (const c of huCats) {
      await Promise.all([
        sql`UPDATE family_transactions SET hu = ${c.id} WHERE hu_id = ${c.id} AND COALESCE(hu, '') != ${c.id}`.catch(() => {}),
        sql`UPDATE family_templates SET auto_hu_name = ${c.name} WHERE auto_hu_id = ${c.id} AND COALESCE(auto_hu_name, '') != ${c.name}`.catch(() => {})
      ]);
    }
    for (const w of (allWallets || [])) {
      await sql`UPDATE family_templates SET auto_wallet_name = ${w.name} WHERE auto_wallet_id = ${String(w.id)} AND COALESCE(auto_wallet_name, '') != ${w.name}`.catch(() => {});
    }

    // 2. Backfill IDs cho các dòng chưa có *_id (cập nhật cả cột chính sang ID cho Purchase warehouse/account, Sales warehouse, StockTransfer from/to)
    const boDistinctWh = await sql`SELECT DISTINCT COALESCE(warehouse, '') AS wh FROM business_orders WHERE warehouse_id IS NULL AND COALESCE(TRIM(warehouse), '') != ''`.catch(() => []);
    for (const r of boDistinctWh) {
      const cat = resolveWarehouseCategory(whCats, { warehouseId: r.wh, warehouseName: r.wh });
      if (cat) {
        await sql`UPDATE business_orders SET warehouse_id = ${cat.id}, warehouse = ${cat.id} WHERE warehouse_id IS NULL AND warehouse = ${r.wh}`.catch(() => {});
      }
    }

    const soDistinctWh = await sql`SELECT DISTINCT COALESCE(warehouse, '') AS wh FROM sales_orders WHERE warehouse_id IS NULL AND COALESCE(TRIM(warehouse), '') != ''`.catch(() => []);
    for (const r of soDistinctWh) {
      const cat = resolveWarehouseCategory(whCats, { warehouseId: r.wh, warehouseName: r.wh });
      if (cat) {
        await sql`UPDATE sales_orders SET warehouse_id = ${cat.id}, warehouse = ${cat.id} WHERE warehouse_id IS NULL AND warehouse = ${r.wh}`.catch(() => {});
      }
    }

    const stDistinctFrom = await sql`SELECT DISTINCT COALESCE(from_warehouse, '') AS wh FROM stock_transfers WHERE from_warehouse_id IS NULL AND COALESCE(TRIM(from_warehouse), '') != ''`.catch(() => []);
    for (const r of stDistinctFrom) {
      const cat = resolveWarehouseCategory(whCats, { warehouseId: r.wh, warehouseName: r.wh });
      if (cat) {
        await sql`UPDATE stock_transfers SET from_warehouse_id = ${cat.id}, from_warehouse = ${cat.id} WHERE from_warehouse_id IS NULL AND from_warehouse = ${r.wh}`.catch(() => {});
      }
    }
    const stDistinctTo = await sql`SELECT DISTINCT COALESCE(to_warehouse, '') AS wh FROM stock_transfers WHERE to_warehouse_id IS NULL AND COALESCE(TRIM(to_warehouse), '') != ''`.catch(() => []);
    for (const r of stDistinctTo) {
      const cat = resolveWarehouseCategory(whCats, { warehouseId: r.wh, warehouseName: r.wh });
      if (cat) {
        await sql`UPDATE stock_transfers SET to_warehouse_id = ${cat.id}, to_warehouse = ${cat.id} WHERE to_warehouse_id IS NULL AND to_warehouse = ${r.wh}`.catch(() => {});
      }
    }

    if (shopCats.length > 0) {
      const boShops = await sql`SELECT DISTINCT COALESCE(shop, '') AS shop FROM business_orders WHERE shop_id IS NULL AND COALESCE(TRIM(shop), '') != ''`.catch(() => []);
      for (const r of boShops) {
        const cat = resolveCategoryByIdOrName(shopCats, ['SHOP'], { id: r.shop, name: r.shop });
        if (cat) await sql`UPDATE business_orders SET shop_id = ${cat.id}, shop = ${cat.name} WHERE shop_id IS NULL AND shop = ${r.shop}`.catch(() => {});
      }
    }
    if (accCats.length > 0) {
      const boAccs = await sql`SELECT DISTINCT COALESCE(account, '') AS acc FROM business_orders WHERE account_id IS NULL AND COALESCE(TRIM(account), '') != ''`.catch(() => []);
      for (const r of boAccs) {
        const cat = resolveCategoryByIdOrName(accCats, ['ACCOUNT'], { id: r.acc, name: r.acc });
        if (cat) await sql`UPDATE business_orders SET account_id = ${cat.id}, account = ${cat.id} WHERE account_id IS NULL AND account = ${r.acc}`.catch(() => {});
      }
    }
    if (partnerCats.length > 0) {
      const debtPartners = await sql`SELECT DISTINCT COALESCE(name, '') AS p FROM debts WHERE partner_id IS NULL AND COALESCE(TRIM(name), '') != ''`.catch(() => []);
      for (const r of debtPartners) {
        const cat = resolveCategoryByIdOrName(partnerCats, ['PARTNER', 'FAMILY'], { id: r.p, name: r.p });
        if (cat) await sql`UPDATE debts SET partner_id = ${cat.id}, name = ${cat.id} WHERE partner_id IS NULL AND name = ${r.p}`.catch(() => {});
      }
    }

    // Backfill family_transactions.hu_id từ categories(type='HU') và đồng bộ cột hu = ID hũ
    const famDistinctHu = await sql`SELECT DISTINCT COALESCE(hu, '') AS hu FROM family_transactions WHERE hu_id IS NULL AND COALESCE(TRIM(hu), '') != ''`.catch(() => []);
    for (const r of famDistinctHu) {
      const hCat = resolveHuCategory(huCats, { huId: r.hu, huName: r.hu });
      if (hCat) {
        await sql`UPDATE family_transactions SET hu_id = ${hCat.id}, hu = ${hCat.id} WHERE hu_id IS NULL AND hu = ${r.hu}`.catch(() => {});
      }
    }

    // Backfill auto_hu_id & auto_wallet_id trên bảng family_templates nếu có tên nhưng chưa có ID
    const tplRows = await sql`
      SELECT id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name
      FROM family_templates
    `.catch(() => []);
    for (const t of (tplRows || [])) {
      let nextHuId = t.auto_hu_id || null;
      let nextHuName = t.auto_hu_name || null;
      let nextWId = String(t.auto_wallet_id || '').trim() || null;
      let nextWName = t.auto_wallet_name || null;
      let dirty = false;

      if (!nextHuId && nextHuName) {
        const hCat = resolveHuCategory(huCats, { huName: nextHuName });
        if (hCat) { nextHuId = String(hCat.id); nextHuName = hCat.name; dirty = true; }
      } else if (nextHuId && catByIdMap.has(String(nextHuId).trim())) {
        const hNameLive = catByIdMap.get(String(nextHuId).trim()).name;
        if (nextHuName !== hNameLive) { nextHuName = hNameLive; dirty = true; }
      }

      if (!nextWId && nextWName) {
        const matchedW = (allWallets || []).find(w => String(w.name || '').trim().toLowerCase() === String(nextWName).trim().toLowerCase());
        if (matchedW) { nextWId = String(matchedW.id); nextWName = matchedW.name; dirty = true; }
      } else if (nextWId && walletByIdMap.has(nextWId)) {
        const wNameLive = walletByIdMap.get(nextWId).name;
        if (nextWName !== wNameLive) { nextWName = wNameLive; dirty = true; }
      }

      if (dirty) {
        await sql`
          UPDATE family_templates
          SET auto_hu_id = ${nextHuId}, auto_hu_name = ${nextHuName}, auto_wallet_id = ${nextWId}, auto_wallet_name = ${nextWName}
          WHERE id = ${t.id}
        `.catch(() => {});
      }
    }
  } catch (e) {
    console.error('ensureCategoryIdSchema error:', e);
  }
}

async function syncCreditWalletPreorders(sql, targetWalletIds = null) {
  try {
    const idFilter = Array.isArray(targetWalletIds)
      ? targetWalletIds.map(x => String(x || '').trim()).filter(Boolean)
      : (targetWalletIds ? [String(targetWalletIds).trim()].filter(Boolean) : null);

    const creditWallets = idFilter && idFilter.length > 0
      ? await sql`SELECT id, name, type, credit_limit, debt, preorder, current_balance, initial_balance FROM wallets WHERE UPPER(type) IN ('CREDIT', 'DEBIT', 'CASH') AND CAST(id AS TEXT) = ANY(${idFilter})`
      : await sql`SELECT id, name, type, credit_limit, debt, preorder, current_balance, initial_balance FROM wallets WHERE UPPER(type) IN ('CREDIT', 'DEBIT', 'CASH') AND is_deleted = false`;

    if (!creditWallets || creditWallets.length === 0) return;

    const [activePrePOs, pendingPreLedgers] = await Promise.all([
      sql`
        SELECT id, wallet_id, wallet_name, total_amount, payment_group_id
        FROM business_orders
        WHERE is_deleted = false
          AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
          AND UPPER(COALESCE(status, '')) LIKE '%PRE%'
      `.catch(() => []),
      sql`
        SELECT id, wallet_id, wallet_name, amount, order_id, payment_group_id
        FROM wallet_ledger
        WHERE UPPER(COALESCE(status, '')) = 'PENDING'
          AND UPPER(COALESCE(effect_type, '')) = 'PREORDER_HOLD'
      `.catch(() => [])
    ]);

    const poIdsSet = new Set((activePrePOs || []).map(p => String(p.id || '').trim()).filter(Boolean));
    const pgPreLedgersSet = new Set((pendingPreLedgers || []).map(l => String(l.payment_group_id || '').trim()).filter(Boolean));

    for (const cw of creditWallets) {
      const cwIdLow = String(cw.id || '').trim().toLowerCase();
      const cwNameLow = String(cw.name || '').trim().toLowerCase();
      let actualPre = 0;

      (activePrePOs || []).forEach(p => {
        const pPgId = String(p.payment_group_id || '').trim();
        if (pPgId && pgPreLedgersSet.has(pPgId)) return; // đã tính tổng nhóm trong pendingPreLedgers
        const pIdLow = String(p.wallet_id || '').trim().toLowerCase();
        const pNameLow = String(p.wallet_name || '').trim().toLowerCase();
        if ((pIdLow && pIdLow === cwIdLow) || (!pIdLow && pNameLow === cwNameLow)) {
          actualPre += Number(p.total_amount || 0);
        }
      });

      (pendingPreLedgers || []).forEach(l => {
        const oid = String(l.order_id || '').trim();
        if (oid && (poIdsSet.has(oid) || /^PO-/i.test(oid))) return; // đã tính từ business_orders
        const lIdLow = String(l.wallet_id || '').trim().toLowerCase();
        const lNameLow = String(l.wallet_name || '').trim().toLowerCase();
        if ((lIdLow && lIdLow === cwIdLow) || (!lIdLow && lNameLow === cwNameLow)) {
          actualPre += Number(l.amount || 0);
        }
      });

      actualPre = Math.max(0, Math.round(actualPre * 100) / 100);
      const oldPre = Math.round(Number(cw.preorder || 0) * 100) / 100;
      if (Math.abs(actualPre - oldPre) > 0.01) {
        if (String(cw.type || '').toUpperCase() !== 'CREDIT') {
          // Debit/Cash: chỉ đồng bộ cam kết đặt trước, không đụng số dư
          await sql`UPDATE wallets SET preorder = ${actualPre} WHERE id = ${cw.id}`;
          continue;
        }
        const limit = Number(cw.credit_limit || 0);
        const debt = Number(cw.debt || 0);
        const newBal = limit > 0 ? Math.max(0, limit - debt - actualPre) : Number(cw.current_balance || 0);
        await sql`UPDATE wallets SET preorder = ${actualPre}, current_balance = ${newBal} WHERE id = ${cw.id}`;
      }
    }
  } catch (e) {
    console.error('syncCreditWalletPreorders error:', e);
  }
}

async function findWalletByOrderName(sql, walletRef, preferredType = '') {
  const { walletId, walletName, preferredType: prefType } = parseWalletRef(walletRef, preferredType);
  if (walletId) {
    const byIdRows = await sql`
      SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder
      FROM wallets
      WHERE CAST(id AS TEXT) = ${walletId}
      LIMIT 1
    `;
    if (byIdRows.length > 0) return byIdRows[0];
  }
  const clean = walletName || walletId;
  if (!clean) return null;

  // Thử khớp trực tiếp nếu chuỗi truyền vào chính là ID ví
  const directIdRows = await sql`
    SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder
    FROM wallets
    WHERE LOWER(CAST(id AS TEXT)) = ${clean.toLowerCase()}
    LIMIT 1
  `;
  if (directIdRows.length > 0) return directIdRows[0];

  const cleanLow = clean.toLowerCase();
  const rows = await sql`
    SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder
    FROM wallets
    WHERE LOWER(TRIM(name)) = ${cleanLow}
    ORDER BY
      is_deleted ASC,
      CASE WHEN ${prefType !== ''} AND UPPER(type) = ${prefType} THEN 0 ELSE 1 END ASC,
      id ASC
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0] : null;
}

async function adjustWalletForPurchaseOrder(sql, walletRef, amount, isPreOrder, sign) {
  const amt = Number(amount || 0);
  const { walletId, walletName } = parseWalletRef(walletRef);
  if ((!walletId && !walletName) || amt <= 0) return null;
  const w = await findWalletByOrderName(sql, { walletId, walletName });
  if (!w) return null;

  const isCredit = String(w.type || '').toUpperCase() === 'CREDIT';
  if (isCredit) {
    const limit = Number(w.credit_limit || 0);
    let newPre = Number(w.preorder || 0);
    let newDebt = Number(w.debt || 0);
    if (isPreOrder) {
      newPre = Math.max(0, newPre + sign * amt);
    } else {
      newDebt = Math.max(0, newDebt + sign * amt);
    }
    const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
    await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
  } else if (isPreOrder) {
    // Debit/Cash đặt trước: chưa trừ tiền, chỉ ghi nhận cam kết vào cột preorder
    const newPre = Math.max(0, Number(w.preorder || 0) + sign * amt);
    await sql`UPDATE wallets SET preorder = ${newPre} WHERE id = ${w.id}`;
  } else {
    // sign = +1 (tạo/ghi nợ mua hàng -> trừ tiền ví), sign = -1 (hoàn/xóa -> cộng lại tiền ví)
    await sql`UPDATE wallets SET current_balance = COALESCE(current_balance, 0) - ${sign * amt} WHERE id = ${w.id}`;
  }
  return w;
}

function resolveWalletByIdOrName(walletRows, { id = '', name = '' } = {}) {
  if (!Array.isArray(walletRows) || walletRows.length === 0) return null;
  const rawId = String(id || '').trim();
  const rawName = String(name || '').trim();
  if (rawId) {
    const byId = walletRows.find(w => w && String(w.id || '').trim().toLowerCase() === rawId.toLowerCase());
    if (byId) return byId;
  }
  if (rawName) {
    const byDirectId = walletRows.find(w => w && String(w.id || '').trim().toLowerCase() === rawName.toLowerCase());
    if (byDirectId) return byDirectId;
    const byName = walletRows.find(w => w && !w.is_deleted && String(w.name || '').trim().toLowerCase() === rawName.toLowerCase())
      || walletRows.find(w => w && String(w.name || '').trim().toLowerCase() === rawName.toLowerCase());
    if (byName) return byName;
  }
  return null;
}

function computeSalesCancellationRestorations(poRows, restoreQty, { warehouseId = '', warehouseName = '', catByIdMap = null } = {}) {
  const targetQty = Math.max(0, Number(restoreQty || 0));
  if (targetQty <= 0 || !Array.isArray(poRows) || poRows.length === 0) {
    return { updates: [], unallocated: Math.round(targetQty * 100) / 100 };
  }

  const targetWhId = String(warehouseId || '').trim();
  const targetWhNorm = normalizeTextNoAccents(warehouseName || '');
  const excludedWhCodes = new Set(['DAT_TRUOC', 'CHO_SHIP', 'CHUSEN', 'HUY', 'CANCEL']);
  const cancelledStatuses = new Set(['DA_HUY', 'DA_HOAN_TIEN', 'CHO_HOAN']);

  const eligibleLots = [];
  for (const r of poRows) {
    if (!r || r.is_deleted) continue;
    const ordSt = String(r.order_status || '').trim().toUpperCase();
    const st = String(r.status || '').trim().toUpperCase();
    if (ordSt === 'DA_HUY' || ordSt === 'DA_HOAN_TIEN' || cancelledStatuses.has(st)) continue;

    const rawWhId = String(r.warehouse_id || '').trim();
    const rawWh = String(r.warehouse || '').trim();
    const rawKey = rawWhId || rawWh;
    if (!rawKey) continue;
    const rawKeyUp = rawKey.toUpperCase();
    if (excludedWhCodes.has(rawKeyUp)) continue;

    const mappedCat = catByIdMap && typeof catByIdMap.get === 'function'
      ? (catByIdMap.get(rawWhId) || catByIdMap.get(rawWh) || null)
      : null;
    if (mappedCat && String(mappedCat.type || '').trim().toUpperCase() === 'WAREHOUSE_STATUS') continue;

    const resolvedWh = String(r.resolved_warehouse || (mappedCat ? mappedCat.name : '') || rawWh || rawWhId).trim();
    const resolvedWhNorm = normalizeTextNoAccents(resolvedWh);
    if (
      isWarehousePendingName(resolvedWh) ||
      isWarehousePreOrderName(resolvedWh) ||
      isWarehouseCancelledName(resolvedWh) ||
      /\bhuy\b/.test(resolvedWhNorm)
    ) {
      continue;
    }

    const qty = Number(r.quantity || 0);
    if (qty <= 0) continue;
    const curRem = Number(r.inventory_remaining !== null && r.inventory_remaining !== undefined ? r.inventory_remaining : qty);
    const deficit = Math.max(0, Math.round((qty - curRem) * 100) / 100);
    if (deficit <= 0) continue;

    const sameWh =
      (targetWhId !== '' && (rawWhId === targetWhId || rawWh === targetWhId)) ||
      (targetWhNorm !== '' && (resolvedWhNorm === targetWhNorm || normalizeTextNoAccents(rawWh) === targetWhNorm));

    eligibleLots.push({
      id: r.id,
      date: String(r.date || ''),
      qty,
      curRem,
      deficit,
      sameWh
    });
  }

  eligibleLots.sort((a, b) => {
    if (a.sameWh !== b.sameWh) return a.sameWh ? -1 : 1;
    return String(b.date || '').localeCompare(String(a.date || '')) || String(b.id || '').localeCompare(String(a.id || ''));
  });

  let left = targetQty;
  const updates = [];
  for (const lot of eligibleLots) {
    if (left <= 0) break;
    const add = Math.min(lot.deficit, left);
    if (add <= 0) continue;
    const newRemaining = Math.min(lot.qty, Math.round((lot.curRem + add) * 100) / 100);
    const actualAdded = Math.round((newRemaining - lot.curRem) * 100) / 100;
    if (actualAdded <= 0) continue;
    left = Math.max(0, Math.round((left - actualAdded) * 100) / 100);
    updates.push({
      id: lot.id,
      oldRemaining: lot.curRem,
      newRemaining,
      added: actualAdded
    });
  }

  return {
    updates,
    unallocated: Math.max(0, Math.round(left * 100) / 100)
  };
}

function shouldReverseWalletOnPurchaseDeleteOrCancel(orderRow, activeLedgerRows = null) {
  const ordSt = String(orderRow?.order_status || '').trim().toUpperCase();
  const st = String(orderRow?.status || '').trim().toUpperCase();
  if (Boolean(orderRow?.is_deleted)) {
    return { shouldReverse: false, isPreOrder: false };
  }
  if (ordSt === 'DA_HOAN_TIEN' || st === 'DA_HOAN_TIEN' || st === 'DA_HUY') {
    return { shouldReverse: false, isPreOrder: false };
  }
  if (st === 'CHO_HOAN') {
    if (Array.isArray(activeLedgerRows)) {
      const liveRows = activeLedgerRows.filter(l => {
        const lSt = String(l?.status || '').trim().toUpperCase();
        return lSt === 'POSTED' || lSt === 'PENDING';
      });
      if (liveRows.some(l => String(l?.status || '').trim().toUpperCase() === 'PENDING' || String(l?.effect_type || '').trim().toUpperCase() === 'PREORDER_HOLD')) {
        return { shouldReverse: true, isPreOrder: true };
      }
      if (liveRows.some(l => String(l?.status || '').trim().toUpperCase() === 'POSTED')) {
        return { shouldReverse: true, isPreOrder: false };
      }
      return { shouldReverse: false, isPreOrder: false };
    }
    return { shouldReverse: true, isPreOrder: false };
  }
  if (ordSt === 'DA_HUY') {
    return { shouldReverse: false, isPreOrder: false };
  }
  return { shouldReverse: true, isPreOrder: st.includes('PRE') };
}

function validateOrderWalletRequirement({
  mode = 'PURCHASE',
  isExempt = false,
  isLoan = false,
  loanPartner = '',
  rawWalletId = '',
  rawWalletName = '',
  matchedWallet = null
} = {}) {
  const upperMode = String(mode || 'PURCHASE').toUpperCase();
  if (upperMode === 'SALES') {
    if (isExempt) return { valid: true };
    if (!String(rawWalletId || '').trim() && !String(rawWalletName || '').trim()) {
      return { valid: false, message: '⚠️ Vui lòng chọn Ví/Thẻ nhận tiền hoặc tick Khách Nợ!' };
    }
    if (!matchedWallet) {
      return { valid: false, message: `⚠️ Ví/Thẻ nhận tiền "${String(rawWalletName || rawWalletId).trim()}" không tồn tại trong hệ thống! Vui lòng chọn đúng ví/thẻ trong danh sách.` };
    }
    return { valid: true };
  }
  // PURCHASE
  if (isExempt) return { valid: true };
  if (isLoan) {
    if (!String(loanPartner || '').trim()) {
      return { valid: false, message: '⚠️ Vui lòng nhập tên đối tác cho mượn thẻ!' };
    }
    return { valid: true };
  }
  if (!String(rawWalletId || '').trim() && !String(rawWalletName || '').trim()) {
    return { valid: false, message: '⚠️ Vui lòng chọn Nguồn tiền mua (Ví/Thẻ), hoặc chọn Mượn thẻ / Tồn kho đầu kỳ!' };
  }
  if (!matchedWallet) {
    return { valid: false, message: `⚠️ Nguồn tiền "${String(rawWalletName || rawWalletId).trim()}" không tồn tại trong hệ thống! Vui lòng chọn đúng ví/thẻ trong danh sách gợi ý.` };
  }
  return { valid: true };
}

function normalizeWalletNameKey(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^c\s*[-_]\s*/i, 'c- ')
    .toLowerCase();
}

function findDuplicateWalletByName(walletRows, candidateName, excludeId = '') {
  const targetKey = normalizeWalletNameKey(candidateName);
  if (!targetKey) return null;
  const excl = String(excludeId || '').trim();
  for (const w of (walletRows || [])) {
    if (!w) continue;
    if (excl && String(w.id || '').trim() === excl) continue;
    if (normalizeWalletNameKey(w.name) === targetKey) {
      return w;
    }
  }
  return null;
}

function getPairedTransferTransactionId(txId) {
  const s = String(txId || '').trim();
  let m = s.match(/^TRF_(OUT|IN)_(.+)$/);
  if (m) return `TRF_${m[1] === 'OUT' ? 'IN' : 'OUT'}_${m[2]}`;
  m = s.match(/^JTF(1|2)_(.+)$/);
  if (m) return `JTF${m[1] === '1' ? '2' : '1'}_${m[2]}`;
  return null;
}

async function reconcilePurchaseItemEdit(sql, id, updates, batchContext = null) {
  let oldRow = (batchContext && batchContext.oldRowMap) ? batchContext.oldRowMap.get(String(id)) : null;
  if (!oldRow) {
    const existingRows = await sql`
      SELECT id, date, warehouse, warehouse_id, product_name, quantity, unit_price, total_amount, inventory_remaining,
             wallet_id, wallet_name, status, note, order_status, is_deleted, shop, shop_id, account, account_id, statement_date, payment_group_id
      FROM business_orders
      WHERE id = ${id}
      LIMIT 1
    `;
    if (existingRows.length === 0) return { changed: false, touchedWalletIds: [] };
    oldRow = existingRows[0];
  }

  const oldOrdSt = String(oldRow.order_status || '').toUpperCase();
  const oldStatusUpper = String(oldRow.status || '').toUpperCase();
  const isRowActive = !oldRow.is_deleted && !['DA_HUY', 'DA_HOAN_TIEN'].includes(oldOrdSt) && !['DA_HUY', 'DA_HOAN_TIEN'].includes(oldStatusUpper);

  const baseId = extractBaseOrderId(id) || id;
  const catRows = (batchContext && batchContext.catRows)
    ? batchContext.catRows
    : await sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => []);

  const qty = updates.qty !== null && updates.qty !== undefined ? updates.qty : Number(oldRow.quantity || 1);
  const price = updates.price !== null && updates.price !== undefined ? updates.price : Math.round(Number(oldRow.unit_price || 0));
  const newTotal = updates.totalAmt !== null && updates.totalAmt !== undefined ? updates.totalAmt : Math.round(qty * price);

  const rawWh = updates.hasWh ? updates.warehouse : (oldRow.warehouse || '');
  const rawWhId = updates.hasWhId ? updates.warehouse_id : (updates.hasWh ? null : oldRow.warehouse_id);
  const matchedWhCat = resolveWarehouseCategory(catRows, { warehouseId: rawWhId || rawWh, warehouseName: rawWh });
  const newWh = matchedWhCat ? matchedWhCat.name : rawWh;
  const newWhId = matchedWhCat ? String(matchedWhCat.id) : (normalizeCategoryId(rawWhId) || null);

  const newName = updates.hasName ? updates.product_name : (oldRow.product_name || '');

  const rawShop = updates.hasShop ? updates.shop : (oldRow.shop || '');
  const matchedShopCat = resolveCategoryByIdOrName(catRows, ['SHOP'], { id: updates.hasShop ? null : oldRow.shop_id, name: rawShop });
  const newShop = matchedShopCat ? matchedShopCat.name : rawShop;
  const newShopId = matchedShopCat ? String(matchedShopCat.id) : (updates.hasShop ? null : normalizeCategoryId(oldRow.shop_id));

  const rawAcc = updates.hasAcc ? updates.account : (oldRow.account || '');
  let matchedAccCat = resolveCategoryByIdOrName(catRows, ['ACCOUNT'], { id: (updates.hasAcc ? null : oldRow.account_id) || rawAcc, name: rawAcc });
  if (!matchedAccCat && rawAcc && !catRows.some(c => String(c.id) === String(rawAcc).trim())) {
    matchedAccCat = await ensureCategoryExistsByName(sql, catRows, 'ACCOUNT', rawAcc);
    if (matchedAccCat && Array.isArray(catRows) && !catRows.some(c => String(c.id) === String(matchedAccCat.id))) {
      catRows.push(matchedAccCat);
    }
  }
  const newAcc = matchedAccCat ? matchedAccCat.name : rawAcc;
  const newAccId = matchedAccCat ? String(matchedAccCat.id) : (updates.hasAcc ? null : normalizeCategoryId(oldRow.account_id));

  const newNote = updates.hasNote ? updates.note : (oldRow.note || '');
  const newDate = updates.normalizedDate !== null ? updates.normalizedDate : oldRow.date;
  const newStmtDate = updates.normalizedStmtDate !== null ? updates.normalizedStmtDate : oldRow.statement_date;
  const rawNewWalletId = updates.hasWalletId ? updates.wallet_id : (updates.hasWallet ? '' : (oldRow.wallet_id || ''));
  const rawNewWallet = updates.hasWallet ? updates.wallet_name : (oldRow.wallet_name || '');
  let newStatus = updates.hasStatus ? updates.status : (oldRow.status || 'HOAN_TAT');

  let resolvedNewWalletObj = null;
  if (batchContext && Array.isArray(batchContext.walletRows)) {
    resolvedNewWalletObj = resolveWalletByIdOrName(batchContext.walletRows, { id: rawNewWalletId, name: rawNewWallet });
  } else if (rawNewWalletId || rawNewWallet) {
    resolvedNewWalletObj = await findWalletByOrderName(sql, {
      walletId: rawNewWalletId,
      walletName: rawNewWallet
    });
  }
  const finalNewWalletId = resolvedNewWalletObj ? String(resolvedNewWalletObj.id) : String(rawNewWalletId || '');
  const finalNewWalletName = resolvedNewWalletObj ? resolvedNewWalletObj.name : rawNewWallet;
  const newIsCredit = resolvedNewWalletObj
    ? String(resolvedNewWalletObj.type || '').toUpperCase() === 'CREDIT'
    : (finalNewWalletName.toLowerCase().startsWith('c-') || finalNewWalletName.toLowerCase().startsWith('c_'));

  const oldWhResolvedCat = resolveWarehouseCategory(catRows, { warehouseId: oldRow.warehouse_id || oldRow.warehouse, warehouseName: oldRow.warehouse || '' });
  const oldWhResolvedName = oldWhResolvedCat ? oldWhResolvedCat.name : (oldRow.warehouse || '');
  const oldIsPre = oldStatusUpper.includes('PRE') || isWarehousePreOrderName(oldWhResolvedName);

  const newWhRole = getWarehouseRole(matchedWhCat || newWh);
  const newWhIsPhysical = Boolean(newWh) && !isWarehousePreOrderName(newWh) && !isWarehousePendingName(newWh) && !isWarehouseCancelledName(newWh);

  // Ví Debit/Cash cũng được phép Đặt trước (chưa trừ tiền cho tới khi xác nhận "Đã trừ thẻ")
  // Cho phép trường hợp: Hàng đã ship (Chờ Ship) hoặc đã về Kho vật lý (KHO NHA) nhưng thẻ vẫn đang chờ trừ tiền (PRE-ORDER)
  const newIsPre = String(newStatus || '').toUpperCase().includes('PRE') && Boolean(finalNewWalletId || finalNewWalletName);

  let finalNote = newNote;
  if (!newIsPre) {
    finalNote = String(finalNote || '')
      .replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '')
      .replace(/\[Pre-order\/Chờ sao kê\]/gi, '')
      .replace(/\[Pre-order\]/gi, '')
      .trim();
  }

  const oldWhRole = getWarehouseRole(oldWhResolvedCat || oldWhResolvedName);
  const oldWhWasPreArrival = oldWhRole === 'DAT_TRUOC' || oldWhRole === 'CHO_SHIP' || oldWhRole === 'CHUSEN' || oldWhRole === 'HUY' || isWarehousePreOrderName(oldWhResolvedName) || isWarehousePendingName(oldWhResolvedName) || isWarehouseCancelledName(oldWhResolvedName);
  const oldQtyNum = Number(oldRow.quantity || 1);
  let newRem = Number(oldRow.inventory_remaining !== null ? oldRow.inventory_remaining : oldQtyNum);
  if (isWarehousePreOrderName(newWh) || isWarehouseCancelledName(newWh)) {
    newRem = 0;
  } else if (oldWhWasPreArrival && (newWhIsPhysical || newWhRole === 'CHO_SHIP') && newRem === 0 && String(oldRow.order_status || '').toUpperCase() !== 'DA_HUY') {
    newRem = qty;
  } else if (qty !== oldQtyNum && newRem === oldQtyNum) {
    newRem = qty;
  }

  const oldTotal = Math.round(Number(oldRow.total_amount || 0));
  const targetWhVal = newWhId || newWh;

  // Kiểm tra nhanh nếu dòng hoàn toàn không có thay đổi gì thì bỏ qua (tránh chạy 200+ câu lệnh SQL khi lưu đơn 19 món)
  const isUnchanged =
    String(oldRow.warehouse || '') === String(targetWhVal || '') &&
    String(oldRow.warehouse_id || '') === String(newWhId || '') &&
    Number(oldRow.quantity || 0) === Number(qty) &&
    Math.round(Number(oldRow.unit_price || 0)) === Number(price) &&
    oldTotal === Number(newTotal) &&
    Number(oldRow.inventory_remaining || 0) === Number(newRem) &&
    String(oldRow.note || '') === String(finalNote || '') &&
    String(oldRow.shop || '') === String(newShop || '') &&
    String(oldRow.product_name || '') === String(newName || '') &&
    String(oldRow.date || '') === String(newDate || '') &&
    String(oldRow.statement_date || '') === String(newStmtDate || '') &&
    String(oldRow.wallet_id || '') === String(finalNewWalletId || '') &&
    String(oldRow.status || '') === String(newStatus || '') &&
    String(oldRow.account_id || '') === String(newAccId || '');

  if (isUnchanged) {
    return { changed: false, touchedWalletIds: [] };
  }

  if (!isRowActive) {
    return { changed: false, touchedWalletIds: [], error: '⚠️ Đơn mua đã hủy hoặc đã hoàn tiền không thể chỉnh sửa!' };
  }

  const isOpeningTarget = String(rawNewWallet || '').toUpperCase().includes('TỒN KHO');
  if ((updates.hasWallet || updates.hasWalletId) && !isOpeningTarget) {
    if ((rawNewWalletId || rawNewWallet) && !resolvedNewWalletObj) {
      return {
        changed: false,
        touchedWalletIds: [],
        error: `⚠️ Ví/Thẻ "${rawNewWallet || rawNewWalletId}" không tồn tại! Vui lòng chọn đúng ví/thẻ trong danh sách.`
      };
    }
    if (String(oldRow.wallet_id || '').trim() !== '' && !rawNewWalletId && !rawNewWallet) {
      return { changed: false, touchedWalletIds: [], error: '⚠️ Không thể để trống Nguồn tiền (Ví/Thẻ) của đơn mua!' };
    }
  }

  await sql`
    UPDATE business_orders SET
      warehouse = ${targetWhVal},
      warehouse_id = ${newWhId},
      quantity = ${qty},
      unit_price = ${price},
      total_amount = ${newTotal},
      inventory_remaining = ${newRem},
      note = ${finalNote},
      shop = ${newShop},
      shop_id = ${newShopId},
      product_name = ${newName},
      date = ${newDate},
      statement_date = ${newStmtDate},
      wallet_id = ${finalNewWalletId},
      wallet_name = ${finalNewWalletId || finalNewWalletName},
      status = ${newStatus},
      account = ${newAccId || ''},
      account_id = ${newAccId}
    WHERE id = ${id}
  `;

  // Reconcile ví chỉ khi có thay đổi ví, số tiền hoặc trạng thái Pre-order
  const walletOrAmtChanged =
    String(oldRow.wallet_id || '').trim().toLowerCase() !== String(finalNewWalletId || '').trim().toLowerCase() ||
    oldTotal !== newTotal ||
    Boolean(oldIsPre) !== Boolean(newIsPre);

  const touchedWalletIds = [];
  let resolvedOldWallet = null;
  if (isRowActive && walletOrAmtChanged) {
    resolvedOldWallet = await adjustWalletForPurchaseOrder(sql, { walletId: oldRow.wallet_id, walletName: oldRow.wallet_name }, oldTotal, oldIsPre, -1);
    const wNew = await adjustWalletForPurchaseOrder(sql, { walletId: finalNewWalletId, walletName: finalNewWalletName }, newTotal, newIsPre, +1);
    if (resolvedOldWallet?.id) touchedWalletIds.push(resolvedOldWallet.id);
    if (wNew?.id) touchedWalletIds.push(wNew.id);
  }

  const ledgerNeedsUpdate = walletOrAmtChanged ||
    String(oldRow.date || '') !== String(newDate || '') ||
    String(oldRow.statement_date || '') !== String(newStmtDate || '') ||
    String(oldRow.product_name || '') !== String(newName || '') ||
    oldIsPre !== newIsPre;

  if (ledgerNeedsUpdate) {
    const ledEvent = newIsPre ? 'PREORDER_HOLD' : 'PURCHASE_CHARGE';
    const ledEffect = newIsPre ? 'PREORDER_HOLD' : (newIsCredit ? 'CARD_DEBT' : 'CASH');
    const ledStatus = newIsPre ? 'PENDING' : 'POSTED';
    const ledWalletId = finalNewWalletId || finalNewWalletName;
    const ledDir = newIsCredit ? 'INCREASE' : 'OUT';
    const ledPrefix = newIsPre ? '[Pre] - ' : '[Mua hàng] - ';
    const ledNoteSingle = ledPrefix + (newName || newShop || 'Đơn mua');
    const oldPgId = String(oldRow.payment_group_id || '').trim();

    if (oldPgId) {
      const walletChangedForItem = String(oldRow.wallet_id || '').trim().toLowerCase() !== String(finalNewWalletId || '').trim().toLowerCase();
      const preChangedForItem = Boolean(oldIsPre) !== Boolean(newIsPre);
      if (walletChangedForItem || preChangedForItem) {
        const [sibFam, sibBiz] = await Promise.all([
          sql`SELECT id FROM family_transactions WHERE payment_group_id = ${oldPgId} AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY') LIMIT 1`.catch(() => []),
          sql`SELECT id FROM business_orders WHERE payment_group_id = ${oldPgId} AND id != ${id} AND is_deleted = false AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN') LIMIT 1`.catch(() => [])
        ]);
        const hasOtherSiblings = sibFam.length > 0 || sibBiz.length > 0;
        if (hasOtherSiblings) {
          await sql`UPDATE business_orders SET payment_group_id = '' WHERE id = ${id}`;
          if (isRowActive && (finalNewWalletId || finalNewWalletName) && newTotal > 0) {
            const ledId = 'LED-' + Date.now().toString().slice(-8) + 'E';
            await sql`
              INSERT INTO wallet_ledger (id, transaction_date, statement_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module)
              VALUES (${ledId}, ${newDate}, ${newStmtDate}, ${ledWalletId}, ${finalNewWalletName}, ${ledEvent}, ${ledEffect}, ${newTotal}, 0, ${ledNoteSingle}, ${id}, ${ledStatus}, ${ledDir}, 'Purchase')
            `;
          }
          await syncPaymentGroupLedger(sql, oldPgId);
        } else {
          await syncPaymentGroupLedger(sql, oldPgId, {
            walletId: finalNewWalletId,
            walletName: finalNewWalletName,
            isCredit: newIsCredit,
            date: newDate,
            statementDate: newStmtDate,
            isPreOrder: newIsPre
          });
        }
      } else {
        await syncPaymentGroupLedger(sql, oldPgId, {
          date: newDate,
          statementDate: newStmtDate
        });
      }
    } else {
      const itemLedRows = await sql`SELECT id FROM wallet_ledger WHERE order_id = ${id} OR id = ${id} LIMIT 1`;
      const baseLedRows = (itemLedRows.length === 0 && baseId && baseId !== id)
        ? await sql`SELECT id FROM wallet_ledger WHERE order_id = ${baseId} OR id = ${baseId} LIMIT 1`
        : [];
      if (itemLedRows.length > 0) {
        await sql`
          UPDATE wallet_ledger SET
            transaction_date = ${newDate},
            statement_date = ${newStmtDate},
            amount = ${newTotal},
            wallet_id = ${ledWalletId},
            wallet_name = ${finalNewWalletName},
            event_type = ${ledEvent},
            effect_type = ${ledEffect},
            status = ${ledStatus},
            direction = ${ledDir},
            note = ${ledNoteSingle}
          WHERE order_id = ${id} OR id = ${id}
        `;
      } else if (baseLedRows.length > 0) {
        const sibSumRows = await sql`
          SELECT COALESCE(SUM(total_amount), 0) as sum_amt
          FROM business_orders
          WHERE (id = ${baseId} OR id LIKE ${baseId + '-%'}) AND is_deleted = false
        `;
        const groupTotal = Math.round(Number(sibSumRows[0]?.sum_amt || newTotal));
        await sql`
          UPDATE wallet_ledger SET
            transaction_date = ${newDate},
            statement_date = ${newStmtDate},
            amount = ${groupTotal},
            wallet_id = ${ledWalletId},
            wallet_name = ${finalNewWalletName},
            event_type = ${ledEvent},
            effect_type = ${ledEffect},
            status = ${ledStatus},
            direction = ${ledDir},
            note = CASE
              WHEN ${newIsPre} THEN REGEXP_REPLACE(COALESCE(note, ''), '^\\[(?:Mua\\s*hàng|Pre(?:[-\\s]*order(?:\\s*Mua\\s*hàng)?)?)\\]\\s*-\\s*', '[Pre] - ', 'i')
              ELSE REGEXP_REPLACE(COALESCE(note, ''), '^\\[(?:Pre(?:[-\\s]*order(?:\\s*Mua\\s*hàng)?)?)\\]\\s*-\\s*', '[Mua hàng] - ', 'i')
            END
          WHERE order_id = ${baseId} OR id = ${baseId}
        `;
      } else if (isRowActive && (finalNewWalletId || finalNewWalletName) && newTotal > 0) {
        const ledId = 'LED-' + Date.now().toString().slice(-8) + 'E';
        await sql`
          INSERT INTO wallet_ledger (id, transaction_date, statement_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module)
          VALUES (${ledId}, ${newDate}, ${newStmtDate}, ${ledWalletId}, ${finalNewWalletName}, ${ledEvent}, ${ledEffect}, ${newTotal}, 0, ${ledNoteSingle}, ${id}, ${ledStatus}, ${ledDir}, 'Purchase')
        `;
      }
    }
  }

  if (!batchContext || !batchContext.skipSyncPreorders) {
    if (touchedWalletIds.length > 0) {
      await syncCreditWalletPreorders(sql, touchedWalletIds);
    }
  }
  return { changed: true, touchedWalletIds };
}

/**
 * Áp dụng hoặc hoàn tác (+1 / -1) biến động số dư ví cho giao dịch Thu/Chi gia đình.
 * Thẻ CREDIT ở trạng thái PRE-ORDER chỉ cộng/trừ cột preorder (giữ nguyên debt).
 */
async function applyFamilyWalletDelta(sql, { walletRow = null, walletId = '', walletName = '', amount = 0, isThu = false, isPre = false, sign = 1 }) {
  const amt = Number(amount || 0);
  if (amt <= 0) return { wallet: walletRow, isCredit: false, balanceAfter: Number(walletRow?.current_balance || 0) };
  const w = walletRow || ((walletId || walletName) ? await findWalletByOrderName(sql, { walletId, walletName }) : null);
  if (!w) return { wallet: null, isCredit: false, balanceAfter: 0 };

  const isCredit = String(w.type || '').toUpperCase() === 'CREDIT';
  if (isCredit) {
    const signedDelta = sign * (isThu ? -amt : amt);
    const debt = Number(w.debt || 0);
    const pre = Number(w.preorder || 0);
    const newPre = isPre ? Math.max(0, pre + signedDelta) : pre;
    const newDebt = isPre ? debt : Math.max(0, debt + signedDelta);
    const limit = Number(w.credit_limit || 0);
    const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : 0;
    await sql`UPDATE wallets SET debt = ${newDebt}, preorder = ${newPre}, current_balance = ${newBal} WHERE id = ${w.id}`;
    return { wallet: w, isCredit: true, balanceAfter: newBal };
  }

  const balDelta = sign * (isThu ? amt : -amt);
  const newBal = Number(w.current_balance || 0) + balDelta;
  await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${w.id}`;
  return { wallet: w, isCredit: false, balanceAfter: newBal };
}

async function upsertWalletLedgerEntry(sql, opts) {
  const walletId = String(opts?.walletId || '').trim();
  const walletName = String(opts?.walletName || '').trim();
  const ledgerWalletId = walletId || walletName;
  if (!ledgerWalletId) return null;

  const orderId = String(opts?.orderId || '').trim();
  const txDate = normalizeIsoDate(opts?.date) || new Date().toISOString().slice(0, 10);
  const stmtDate = opts?.statementDate !== undefined
    ? (opts.statementDate ? (normalizeIsoDate(opts.statementDate) || String(opts.statementDate).trim()) : '')
    : '';
  const eventType = String(opts?.eventType || 'LEDGER_ENTRY').trim();
  const effectType = String(opts?.effectType || 'CASH').trim();
  const amount = Math.max(0, Number(opts?.amount || 0));
  const balanceAfter = Number(opts?.balanceAfter || 0);
  const note = String(opts?.note || '').trim();
  const status = String(opts?.status || 'POSTED').trim();
  const direction = String(opts?.direction || 'OUT').trim();
  const sourceModule = String(opts?.sourceModule || 'System').trim();
  const checkpointRef = String(opts?.checkpointRef || '').trim();
  const matchByWallet = Boolean(opts?.matchByWallet);

  if (orderId) {
    const existing = matchByWallet
      ? await sql`
          SELECT id FROM wallet_ledger
          WHERE order_id = ${orderId}
            AND COALESCE(UPPER(status), '') NOT IN ('DELETED', 'CANCELLED', 'VOID', 'REVERSED')
            AND (LOWER(TRIM(COALESCE(wallet_id, ''))) = ${ledgerWalletId.toLowerCase()} OR LOWER(TRIM(COALESCE(wallet_name, ''))) = ${walletName.toLowerCase()})
          ORDER BY id DESC
          LIMIT 1
        `.catch(() => [])
      : await sql`
          SELECT id FROM wallet_ledger
          WHERE order_id = ${orderId}
            AND COALESCE(UPPER(status), '') NOT IN ('DELETED', 'CANCELLED', 'VOID', 'REVERSED')
          ORDER BY id DESC
          LIMIT 1
        `.catch(() => []);

    if (existing.length > 0) {
      await sql`
        UPDATE wallet_ledger SET
          transaction_date = ${txDate},
          statement_date = ${stmtDate},
          wallet_id = ${ledgerWalletId},
          wallet_name = ${walletName},
          event_type = ${eventType},
          effect_type = ${effectType},
          amount = ${amount},
          balance_after = ${balanceAfter},
          note = ${note},
          status = ${status},
          direction = ${direction},
          source_module = ${sourceModule}
        WHERE id = ${existing[0].id}
      `.catch(() => {});
      return existing[0].id;
    }
  }

  const ledId = String(opts?.id || ('LED-' + Date.now().toString().slice(-10) + Math.floor(Math.random() * 1000).toString().padStart(3, '0')));
  await sql`
    INSERT INTO wallet_ledger (id, transaction_date, statement_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module, checkpoint_ref)
    VALUES (${ledId}, ${txDate}, ${stmtDate}, ${ledgerWalletId}, ${walletName}, ${eventType}, ${effectType}, ${amount}, ${balanceAfter}, ${note}, ${orderId}, ${status}, ${direction}, ${sourceModule}, ${checkpointRef})
  `;
  return ledId;
}

function normalizeStatementDateIso(rawStmtDate) {
  const str = String(rawStmtDate || '').trim();
  if (!str) return '';
  const p = str.split('T')[0].split(/[-/]/);
  if (p.length === 2) {
    if (p[0].length === 4) return `${p[0]}-${String(p[1]).padStart(2, '0')}-01`;
    return `${p[1]}-${String(p[0]).padStart(2, '0')}-01`;
  }
  if (p.length >= 3) {
    if (p[0].length === 4) return `${p[0]}-${String(p[1]).padStart(2, '0')}-${String(p[2]).padStart(2, '0')}`;
    return `${p[2]}-${String(p[1]).padStart(2, '0')}-${String(p[0]).padStart(2, '0')}`;
  }
  return str;
}

function getCardDefaultPaymentStatementMonth(txDateStr, closingDateVal) {
  const dStr = /^\d{4}-\d{2}/.test(txDateStr) ? txDateStr : new Date().toISOString().slice(0, 10);
  const p = dStr.split('T')[0].split(/[-/]/);
  if (p.length < 3) return dStr.slice(0, 7);
  const y = parseInt(p[0], 10);
  const m = parseInt(p[1], 10);
  const d = parseInt(p[2], 10);
  const cut = parseInt(closingDateVal, 10) || 31;

  // Nếu cut >= 28 (chốt cuối tháng dương lịch, như Rakuten, Yodobashi):
  // Mọi chi tiêu trong tháng m chốt cuối tháng m, hạn thanh toán tháng m + 1.
  // Nếu cut < 28 (như Aeon chốt ngày 10):
  // - Nếu ngày d <= cut (ngày 1 đến 10): thuộc kỳ chốt ngày 10 tháng m -> hạn thanh toán tháng m + 1 (ngày 2 tháng sau).
  // - Nếu ngày d > cut (ngày 11 trở đi): thuộc kỳ chốt ngày 10 tháng m + 1 -> hạn thanh toán tháng m + 2 (ngày 2 tháng sau nữa).
  let payYear = y;
  let payMonth = m + 1;
  if (cut < 28 && d > cut) {
    payMonth += 1;
  }
  if (payMonth > 12) {
    payYear += Math.floor((payMonth - 1) / 12);
    payMonth = ((payMonth - 1) % 12) + 1;
  }
  return `${payYear}-${String(payMonth).padStart(2, '0')}`;
}

function validateMixedPaymentPayload(payload, matchedWallet) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, message: '⚠️ Dữ liệu hóa đơn hỗn hợp không hợp lệ!' };
  }
  if (!matchedWallet || matchedWallet.is_deleted) {
    return { valid: false, message: '⚠️ Vui lòng chọn đúng Thẻ hoặc Ví thanh toán trong danh sách!' };
  }
  const dateStr = normalizeIsoDate(payload.date || payload.ngay) || '';
  if (!dateStr) {
    return { valid: false, message: '⚠️ Vui lòng chọn Ngày thanh toán hợp lệ!' };
  }
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) {
    return { valid: false, message: '⚠️ Hóa đơn phải có ít nhất 1 dòng chi tiết!' };
  }

  const lines = [];
  let familyTotal = 0;
  let businessTotal = 0;
  let familyCount = 0;
  let businessCount = 0;

  for (let i = 0; i < rawItems.length; i++) {
    const line = rawItems[i] || {};
    const rawType = String(line.lineType || line.type || line.kind || '').trim().toUpperCase();
    let lineType = '';
    if (rawType === 'FAMILY' || rawType === 'GIA_DINH' || rawType === 'GD' || rawType === 'THU_CHI') {
      lineType = 'FAMILY';
    } else if (rawType === 'BUSINESS' || rawType === 'KINH_DOANH' || rawType === 'KD' || rawType === 'PURCHASE') {
      lineType = 'BUSINESS';
    } else {
      return { valid: false, message: `⚠️ Dòng #${i + 1} có loại giao dịch không hợp lệ (chỉ hỗ trợ Gia đình / Kinh doanh)!` };
    }

    if (lineType === 'FAMILY') {
      const content = String(line.content || line.productName || line.name || line.title || '').trim();
      const huId = normalizeCategoryId(line.huId ?? line.hu_id);
      const hu = String(line.hu || line.categoryName || line.jar || '').trim();
      if (!content) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (Gia đình): Vui lòng nhập Nội dung chi tiêu!` };
      }
      if (!hu && !huId) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (Gia đình): Vui lòng chọn Hũ chi tiêu!` };
      }
      const qtyRaw = line.qty !== undefined && line.qty !== null && line.qty !== '' ? Number(line.qty) : 1;
      const qty = (Number.isFinite(qtyRaw) && qtyRaw > 0) ? qtyRaw : 1;
      const unitPriceRaw = line.unitPrice !== undefined ? line.unitPrice : (line.price !== undefined ? line.price : line.amount);
      const unitPrice = Math.round(Number(unitPriceRaw || 0));
      const explicitAmt = (line.amount !== undefined && line.amount !== null && line.amount !== '')
        ? Math.round(Number(line.amount))
        : (line.total !== undefined && line.total !== null && line.total !== '' ? Math.round(Number(line.total)) : Math.round(qty * unitPrice));
      if (!Number.isFinite(explicitAmt) || explicitAmt <= 0) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (Gia đình - ${content}): Số tiền phải lớn hơn 0!` };
      }
      familyTotal += explicitAmt;
      familyCount += 1;
      lines.push({
        id: String(line.id || '').trim(),
        lineType: 'FAMILY',
        content,
        huId,
        hu,
        qty,
        unitPrice: unitPrice > 0 ? unitPrice : explicitAmt,
        amount: explicitAmt,
        note: String(line.note || '').trim(),
        isFixed: Boolean(line.isFixed || line.is_fixed)
      });
    } else {
      const productName = String(line.productName || line.product_name || line.tenSP || line.content || line.name || '').trim();
      const warehouseId = normalizeCategoryId(line.warehouseId ?? line.warehouse_id);
      const warehouse = String(line.warehouse || line.trangThaiKho || '').trim();
      if (!productName) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (Kinh doanh): Vui lòng nhập Tên hàng hóa!` };
      }
      if (!warehouse && !warehouseId) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (Kinh doanh - ${productName}): Vui lòng chọn Kho hàng!` };
      }
      const qty = Number(line.qty ?? line.quantity ?? 0);
      const unitPrice = Math.round(Number(line.unitPrice ?? line.unit_price ?? line.price ?? 0));
      if (!Number.isFinite(qty) || qty <= 0) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (${productName}): Số lượng phải lớn hơn 0!` };
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (${productName}): Đơn giá phải lớn hơn 0!` };
      }
      const computedAmt = Math.round(qty * unitPrice);
      if (!Number.isFinite(computedAmt) || computedAmt <= 0) {
        return { valid: false, message: `⚠️ Dòng #${i + 1} (${productName}): Thành tiền không hợp lệ!` };
      }
      const rawExplicit = (line.total !== undefined && line.total !== null && line.total !== '')
        ? line.total
        : (line.amount !== undefined && line.amount !== null && line.amount !== '' ? line.amount : null);
      if (rawExplicit !== null) {
        const expLine = Math.round(Number(rawExplicit));
        if (!Number.isFinite(expLine) || Math.abs(expLine - computedAmt) > 1) {
          return { valid: false, message: `⚠️ Dòng #${i + 1} (${productName}): Thành tiền không khớp Số lượng × Đơn giá!` };
        }
      }
      businessTotal += computedAmt;
      businessCount += 1;
      lines.push({
        id: String(line.id || '').trim(),
        lineType: 'BUSINESS',
        productName,
        warehouseId,
        warehouse,
        qty,
        unitPrice,
        amount: computedAmt,
        shop: String(line.shop || payload.shop || '').trim(),
        shopId: normalizeCategoryId(line.shopId ?? line.shop_id ?? payload.shopId),
        note: String(line.note || '').trim()
      });
    }
  }

  const grandTotal = familyTotal + businessTotal;
  if (!Number.isFinite(grandTotal) || grandTotal <= 0) {
    return { valid: false, message: '⚠️ Tổng thanh toán hóa đơn phải lớn hơn 0!' };
  }
  if (payload.expectedTotal !== undefined && payload.expectedTotal !== null && payload.expectedTotal !== '') {
    const expTotal = Math.round(Number(payload.expectedTotal));
    if (!Number.isFinite(expTotal) || Math.abs(grandTotal - expTotal) > 1) {
      return { valid: false, message: '⚠️ Tổng tiền thanh toán không khớp tổng các dòng chi tiết!' };
    }
  }

  return {
    valid: true,
    date: dateStr,
    grandTotal,
    familyTotal,
    businessTotal,
    familyCount,
    businessCount,
    lines
  };
}

function buildMixedPaymentLedgerNote(familyItems, businessItems, commonNote = '', isPreOrder = false) {
  const fam = Array.isArray(familyItems) ? familyItems : [];
  const biz = Array.isArray(businessItems) ? businessItems : [];
  const count = fam.length + biz.length;
  const noteTrim = String(commonNote || '').trim();
  const names = [
    ...fam.map(f => String(f.content || f.note || '').trim()),
    ...biz.map(b => String(b.product_name || b.tenSP || '').trim())
  ].filter(Boolean);
  const previewNames = names.slice(0, 2).join(', ') + (names.length > 2 ? ` (+${names.length - 2})` : '');

  if (fam.length > 0 && biz.length > 0) {
    const prePrefix = isPreOrder ? '[Pre] ' : '';
    const base = `${prePrefix}Hóa đơn hỗn hợp (${count} khoản)`;
    if (noteTrim) return `${base} · ${noteTrim}`;
    return previewNames ? `${base}: ${previewNames}` : base;
  }
  if (biz.length > 0) {
    const prefix = isPreOrder ? '[Pre] - ' : '[Mua hàng] - ';
    return prefix + (previewNames || noteTrim || 'Đơn mua');
  }
  const famPre = isPreOrder ? '[Pre] ' : '';
  return `${famPre}${previewNames || noteTrim || 'Chi tiêu'}`.trim();
}

function aggregateHistoryByPaymentGroup(historyItems) {
  const list = Array.isArray(historyItems) ? historyItems : [];
  if (list.length === 0) return [];
  const out = [];
  const groupIdxMap = new Map();

  for (const item of list) {
    if (!item) continue;
    const pgId = String(item.paymentGroupId || item.payment_group_id || '').trim();
    if (!pgId) {
      out.push(item);
      continue;
    }
    const groupKey = `${pgId}::${item.type || '-'}::${item.isPreorder ? 'PRE' : 'POST'}`;
    if (!groupIdxMap.has(groupKey)) {
      const cloned = {
        ...item,
        paymentGroupId: pgId,
        amount: Math.round(Number(item.amount || 0))
      };
      if (!Array.isArray(cloned.groupItems) || cloned.groupItems.length === 0) {
        cloned.groupItems = [{
          kind: item.sourceModule === 'Purchase' ? 'BUSINESS' : (item.sourceModule === 'Family' ? 'FAMILY' : 'ITEM'),
          id: item.sourceId || item.id,
          title: item.note || item.module || 'Khoản chi',
          amount: Math.round(Number(item.amount || 0))
        }];
      }
      groupIdxMap.set(groupKey, out.length);
      out.push(cloned);
    } else {
      const existing = out[groupIdxMap.get(groupKey)];
      const addAmt = Math.round(Number(item.amount || 0));
      existing.amount = Math.round(Number(existing.amount || 0)) + addAmt;
      existing.sourceModule = 'MixedPayment';
      existing.module = 'Hóa Đơn Hỗn Hợp';
      existing.groupItems = existing.groupItems || [];
      if (Array.isArray(item.groupItems) && item.groupItems.length > 0) {
        existing.groupItems.push(...item.groupItems);
      } else {
        existing.groupItems.push({
          kind: item.sourceModule === 'Purchase' ? 'BUSINESS' : (item.sourceModule === 'Family' ? 'FAMILY' : 'ITEM'),
          id: item.sourceId || item.id,
          title: item.note || item.module || 'Khoản chi',
          amount: addAmt
        });
      }
      const famItems = existing.groupItems.filter(g => g.kind === 'FAMILY');
      const bizItems = existing.groupItems.filter(g => g.kind === 'BUSINESS');
      const famTotal = famItems.reduce((s, g) => s + Math.round(Number(g.amount || 0)), 0);
      const bizTotal = bizItems.reduce((s, g) => s + Math.round(Number(g.amount || 0)), 0);
      existing.groupSummary = {
        count: existing.groupItems.length,
        familyCount: famItems.length,
        businessCount: bizItems.length,
        familyTotal: famTotal,
        businessTotal: bizTotal,
        total: existing.amount
      };
      existing.note = buildMixedPaymentLedgerNote(
        famItems.map(g => ({ content: g.title })),
        bizItems.map(g => ({ product_name: g.title })),
        '',
        Boolean(existing.isPreorder)
      );
    }
  }
  return out;
}

async function adjustWalletForAmountAndPreorder(sql, walletRef, amount, isPreOrder, sign) {
  const amt = Math.round(Math.abs(Number(amount || 0)));
  if (amt <= 0) return { wallet: null, isCredit: false, balanceAfter: 0 };
  const w = (walletRef && walletRef.id && walletRef.type !== undefined)
    ? walletRef
    : await findWalletByOrderName(sql, walletRef);
  if (!w) return { wallet: null, isCredit: false, balanceAfter: 0 };
  const isCredit = String(w.type || '').toUpperCase() === 'CREDIT';
  const delta = sign * amt;
  let balanceAfter = Number(w.current_balance || 0);
  if (isCredit) {
    const newPre = isPreOrder ? Math.max(0, Number(w.preorder || 0) + delta) : Number(w.preorder || 0);
    const newDebt = isPreOrder ? Number(w.debt || 0) : Math.max(0, Number(w.debt || 0) + delta);
    const limit = Number(w.credit_limit || 0);
    balanceAfter = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
    await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${balanceAfter} WHERE id = ${w.id}`;
  } else if (isPreOrder) {
    const newPre = Math.max(0, Number(w.preorder || 0) + delta);
    await sql`UPDATE wallets SET preorder = ${newPre} WHERE id = ${w.id}`;
  } else {
    balanceAfter = Number(w.current_balance || 0) - delta;
    await sql`UPDATE wallets SET current_balance = ${balanceAfter} WHERE id = ${w.id}`;
  }
  return { wallet: w, isCredit, balanceAfter };
}

async function syncPaymentGroupLedger(sql, paymentGroupId, opts = {}) {
  const pgId = String(paymentGroupId || '').trim();
  if (!pgId) return { deleted: false, total: 0, itemCount: 0, ledgerId: '' };

  const [famRows, bizRows, existingLedgers] = await Promise.all([
    sql`
      SELECT id, date, type, content, amount, wallet_id, wallet_name, note, status, statement_date
      FROM family_transactions
      WHERE payment_group_id = ${pgId}
        AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY')
      ORDER BY id ASC
    `.catch(() => []),
    sql`
      SELECT id, date, product_name, total_amount, wallet_id, wallet_name, status, order_status, note, statement_date
      FROM business_orders
      WHERE payment_group_id = ${pgId}
        AND is_deleted = false
        AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
        AND UPPER(COALESCE(status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
      ORDER BY id ASC
    `.catch(() => []),
    sql`
      SELECT id, transaction_date, statement_date, wallet_id, wallet_name, event_type, effect_type,
             amount, balance_after, note, order_id, status, direction, source_module
      FROM wallet_ledger
      WHERE payment_group_id = ${pgId} OR order_id = ${pgId}
      ORDER BY id ASC
    `.catch(() => [])
  ]);

  const activeLedgers = (existingLedgers || []).filter(l => !['CANCELLED', 'VOID', 'REVERSED', 'DELETED'].includes(String(l.status || '').toUpperCase()));
  const primaryLed = activeLedgers[0] || (existingLedgers && existingLedgers[0]) || null;

  const famSum = (famRows || []).reduce((s, r) => s + Math.round(Math.abs(Number(r.amount || 0))), 0);
  const bizSum = (bizRows || []).reduce((s, r) => s + Math.round(Math.abs(Number(r.total_amount || 0))), 0);
  const newTotal = famSum + bizSum;
  const itemCount = (famRows ? famRows.length : 0) + (bizRows ? bizRows.length : 0);

  if (itemCount === 0 || newTotal <= 0) {
    if (opts.hardDelete) {
      await sql`DELETE FROM wallet_ledger WHERE payment_group_id = ${pgId} OR order_id = ${pgId}`.catch(() => {});
    } else {
      const cancelSt = String(opts.cancelStatus || 'DELETED').trim().toUpperCase();
      await sql`
        UPDATE wallet_ledger
        SET status = ${cancelSt}, amount = 0
        WHERE payment_group_id = ${pgId} OR order_id = ${pgId}
      `.catch(() => {});
    }
    return { deleted: true, total: 0, itemCount: 0, ledgerId: primaryLed ? String(primaryLed.id) : '' };
  }

  const firstChild = (bizRows && bizRows[0]) || (famRows && famRows[0]) || null;
  const walletId = String(opts.walletId || primaryLed?.wallet_id || firstChild?.wallet_id || '').trim();
  const rawWalletName = String(opts.walletName || primaryLed?.wallet_name || firstChild?.wallet_name || '').trim();
  const wObj = (opts.isCredit === undefined || !opts.walletName) && (walletId || rawWalletName)
    ? await findWalletByOrderName(sql, { walletId, walletName: rawWalletName })
    : null;
  const resolvedWalletId = wObj ? String(wObj.id) : walletId;
  const walletName = opts.walletName ? String(opts.walletName).trim() : (wObj ? String(wObj.name || '').trim() : rawWalletName);
  let isCredit = opts.isCredit;
  if (isCredit === undefined) {
    isCredit = wObj
      ? String(wObj.type || '').toUpperCase() === 'CREDIT'
      : (primaryLed ? String(primaryLed.effect_type || '').toUpperCase() === 'CARD_DEBT' || ['INCREASE', 'DECREASE'].includes(String(primaryLed.direction || '').toUpperCase()) : false);
  }
  const ledgerWalletId = resolvedWalletId || walletName;

  const txDate = normalizeIsoDate(opts.date || firstChild?.date || primaryLed?.transaction_date) || new Date().toISOString().slice(0, 10);
  const stmtDate = opts.statementDate !== undefined
    ? normalizeStatementDateIso(opts.statementDate)
    : normalizeStatementDateIso(firstChild?.statement_date || primaryLed?.statement_date || '');

  let isPreOrder = opts.isPreOrder;
  if (isPreOrder === undefined) {
    const allPre = [...(famRows || []), ...(bizRows || [])].every(r => String(r.status || '').toUpperCase().includes('PRE'));
    isPreOrder = allPre;
  }

  let existingCommonNote = '';
  if (opts.commonNote !== undefined) {
    existingCommonNote = String(opts.commonNote || '').trim();
  } else if (primaryLed && primaryLed.note) {
    const mNote = String(primaryLed.note).match(/Hóa đơn hỗn hợp \(\d+ khoản\)\s*·\s*(.+)$/i);
    if (mNote && mNote[1]) existingCommonNote = mNote[1].trim();
  }

  const newNote = buildMixedPaymentLedgerNote(famRows, bizRows, existingCommonNote, Boolean(isPreOrder));
  const ledEvent = isPreOrder ? 'PREORDER_HOLD' : 'MIXED_PAYMENT';
  const ledEffect = isPreOrder ? 'PREORDER_HOLD' : (isCredit ? 'CARD_DEBT' : 'CASH');
  const ledStatus = isPreOrder ? 'PENDING' : 'POSTED';
  const ledDir = isCredit ? 'INCREASE' : 'OUT';

  if (primaryLed) {
    const balAfter = (opts.balanceAfter !== undefined) ? Number(opts.balanceAfter) : Number(primaryLed.balance_after || 0);
    await sql`
      UPDATE wallet_ledger SET
        transaction_date = ${txDate},
        statement_date = ${stmtDate},
        wallet_id = ${ledgerWalletId},
        wallet_name = ${walletName},
        event_type = ${ledEvent},
        effect_type = ${ledEffect},
        amount = ${newTotal},
        balance_after = ${balAfter},
        note = ${newNote},
        order_id = ${pgId},
        status = ${ledStatus},
        direction = ${ledDir},
        source_module = 'MixedPayment',
        payment_group_id = ${pgId}
      WHERE id = ${primaryLed.id}
    `;
    if (existingLedgers.length > 1) {
      const extraIds = existingLedgers.filter(l => String(l.id) !== String(primaryLed.id)).map(l => l.id);
      if (extraIds.length > 0) {
        await sql`DELETE FROM wallet_ledger WHERE id = ANY(${extraIds})`.catch(() => {});
      }
    }
    return { deleted: false, total: newTotal, itemCount, ledgerId: String(primaryLed.id) };
  }

  const ledId = 'LED-PG' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 100).toString().padStart(2, '0');
  const balAfter = Number(opts.balanceAfter || 0);
  await sql`
    INSERT INTO wallet_ledger (id, transaction_date, statement_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module, payment_group_id)
    VALUES (${ledId}, ${txDate}, ${stmtDate}, ${ledgerWalletId}, ${walletName}, ${ledEvent}, ${ledEffect}, ${newTotal}, ${balAfter}, ${newNote}, ${pgId}, ${ledStatus}, ${ledDir}, 'MixedPayment', ${pgId})
  `;
  return { deleted: false, total: newTotal, itemCount, ledgerId: ledId };
}

function classifySalesStockLot(row, catByIdMap = null) {
  if (!row || row.is_deleted) return 'IGNORED';
  const ordSt = String(row.order_status || '').trim().toUpperCase();
  const stStatus = String(row.status || '').trim().toUpperCase();
  if (
    ordSt === 'DA_HUY' ||
    ordSt === 'DA_HOAN_TIEN' ||
    stStatus === 'DA_HUY' ||
    stStatus === 'DA_HOAN_TIEN' ||
    stStatus === 'CHO_HOAN'
  ) {
    return 'CANCELLED';
  }

  const rawWhId = String(row.warehouse_id || '').trim();
  const rawWh = String(row.warehouse || '').trim();
  const rawKey = rawWhId || rawWh;
  if (!rawKey) return 'IGNORED';

  const mappedCat = (catByIdMap && typeof catByIdMap.get === 'function')
    ? (catByIdMap.get(rawWhId) || catByIdMap.get(rawWh) || null)
    : null;
  const resolvedWh = String(row.resolved_warehouse || (mappedCat ? mappedCat.name : '') || rawWh || rawWhId).trim();
  const rawKeyUp = rawKey.toUpperCase();
  const resolvedWhNorm = normalizeTextNoAccents(resolvedWh);

  if (['HUY', 'CANCEL'].includes(rawKeyUp) || isWarehouseCancelledName(resolvedWh) || /\bhuy\b/.test(resolvedWhNorm)) {
    return 'CANCELLED';
  }
  if (
    ['DAT_TRUOC', 'CHO_SHIP', 'CHUSEN'].includes(rawKeyUp) ||
    isWarehousePendingName(resolvedWh) ||
    isWarehousePreOrderName(resolvedWh) ||
    (mappedCat && String(mappedCat.type || '').trim().toUpperCase() === 'WAREHOUSE_STATUS')
  ) {
    return 'PENDING';
  }
  return 'PHYSICAL';
}

function validateSalesStockAvailability(items, stockRows, catByIdMap = null) {
  const requestedMap = new Map();
  (Array.isArray(items) ? items : []).forEach(it => {
    if (!it) return;
    const displayName = String(it.tenSP || it.product_name || '').trim();
    const rawQty = (it.qty !== undefined && it.qty !== null && it.qty !== '')
      ? it.qty
      : ((it.quantity !== undefined && it.quantity !== null && it.quantity !== '') ? it.quantity : 1);
    const reqQty = Number(rawQty);
    if (!displayName || !Number.isFinite(reqQty) || reqQty <= 0) return;
    const key = displayName.toLowerCase();
    const prev = requestedMap.get(key);
    if (prev) {
      prev.requestedQty += reqQty;
    } else {
      requestedMap.set(key, { displayName, requestedQty: reqQty });
    }
  });

  const physicalByKey = Object.create(null);
  const pendingByKey = Object.create(null);
  (Array.isArray(stockRows) ? stockRows : []).forEach(r => {
    if (!r) return;
    const key = String(r.product_name || '').trim().toLowerCase();
    if (!key) return;
    const lotClass = classifySalesStockLot(r, catByIdMap);
    if (lotClass === 'PHYSICAL') {
      physicalByKey[key] = (physicalByKey[key] || 0) + Math.max(0, Number(r.inventory_remaining || 0));
    } else if (lotClass === 'PENDING') {
      const remVal = Number(r.inventory_remaining || 0);
      const pendingQty = remVal > 0 ? remVal : Math.max(0, Number(r.quantity || 0));
      pendingByKey[key] = (pendingByKey[key] || 0) + pendingQty;
    }
  });

  for (const [key, reqInfo] of requestedMap.entries()) {
    const { displayName, requestedQty } = reqInfo;
    const physicalAvail = physicalByKey[key] || 0;
    const pendingAvail = pendingByKey[key] || 0;
    if (physicalAvail < requestedQty) {
      if (physicalAvail <= 0 && pendingAvail > 0) {
        return {
          valid: false,
          productName: displayName,
          physicalAvail,
          pendingAvail,
          requestedQty,
          message: `⚠️ "${displayName}" chưa về kho vật lý (hiện có ${pendingAvail} cái ở Chờ Ship / Đặt trước / Chusen). Vui lòng chuyển hàng vào kho vật lý trước khi xuất bán!`
        };
      }
      if (physicalAvail <= 0) {
        return {
          valid: false,
          productName: displayName,
          physicalAvail,
          pendingAvail,
          requestedQty,
          message: `❌ Mặt hàng "${displayName}" hiện không có tồn kho vật lý (Tồn: 0). Không thể xuất bán!`
        };
      }
      const pendingSuffix = pendingAvail > 0 ? ` (còn ${pendingAvail} cái đang ở Chờ Ship / Đặt trước chưa về kho)` : '';
      return {
        valid: false,
        productName: displayName,
        physicalAvail,
        pendingAvail,
        requestedQty,
        message: `❌ "${displayName}" chỉ còn ${physicalAvail} cái tồn kho vật lý (đang yêu cầu bán ${requestedQty} cái)${pendingSuffix}!`
      };
    }
  }
  return { valid: true };
}

async function checkWalletHasHistory(sql, targetId, targetName) {
  const idLow = String(targetId || '').trim().toLowerCase();
  const nameLow = String(targetName || '').trim().toLowerCase();
  if (!idLow && !nameLow) return false;
  const safeCount = (p) => p.catch(() => [{ count: 0 }]);
  const [ledgerCount, familyCount, orderCount, salesCount, debtCount] = await Promise.all([
    safeCount(sql`SELECT COUNT(*)::int as count FROM wallet_ledger WHERE (${idLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${idLow}) OR (COALESCE(TRIM(wallet_id), '') = '' AND ${nameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${nameLow})`),
    safeCount(sql`SELECT COUNT(*)::int as count FROM family_transactions WHERE (${idLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${idLow}) OR (COALESCE(TRIM(wallet_id), '') = '' AND ${nameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${nameLow})`),
    safeCount(sql`SELECT COUNT(*)::int as count FROM business_orders WHERE (${idLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${idLow}) OR (COALESCE(TRIM(wallet_id), '') = '' AND ${nameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${nameLow})`),
    safeCount(sql`SELECT COUNT(*)::int as count FROM sales_orders WHERE (${idLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${idLow}) OR (COALESCE(TRIM(wallet_id), '') = '' AND ${nameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${nameLow})`),
    safeCount(sql`SELECT COUNT(*)::int as count FROM debts WHERE (${idLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${idLow}) OR (COALESCE(TRIM(wallet_id), '') = '' AND ${nameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${nameLow})`)
  ]);
  return (
    (ledgerCount[0]?.count || 0) > 0 ||
    (familyCount[0]?.count || 0) > 0 ||
    (orderCount[0]?.count || 0) > 0 ||
    (salesCount[0]?.count || 0) > 0 ||
    (debtCount[0]?.count || 0) > 0
  );
}

async function getWalletsWithHistorySet(sql) {
  try {
    const rows = await sql`
      SELECT DISTINCT LOWER(TRIM(wallet_id)) as wkey FROM wallet_ledger WHERE wallet_id IS NOT NULL AND wallet_id != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_name)) as wkey FROM wallet_ledger WHERE COALESCE(TRIM(wallet_id), '') = '' AND wallet_name IS NOT NULL AND wallet_name != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_id)) as wkey FROM family_transactions WHERE wallet_id IS NOT NULL AND wallet_id != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_name)) as wkey FROM family_transactions WHERE COALESCE(TRIM(wallet_id), '') = '' AND wallet_name IS NOT NULL AND wallet_name != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_id)) as wkey FROM business_orders WHERE wallet_id IS NOT NULL AND wallet_id != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_name)) as wkey FROM business_orders WHERE COALESCE(TRIM(wallet_id), '') = '' AND wallet_name IS NOT NULL AND wallet_name != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_id)) as wkey FROM sales_orders WHERE wallet_id IS NOT NULL AND wallet_id != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_name)) as wkey FROM sales_orders WHERE COALESCE(TRIM(wallet_id), '') = '' AND wallet_name IS NOT NULL AND wallet_name != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_id)) as wkey FROM debts WHERE wallet_id IS NOT NULL AND wallet_id != ''
      UNION
      SELECT DISTINCT LOWER(TRIM(wallet_name)) as wkey FROM debts WHERE COALESCE(TRIM(wallet_id), '') = '' AND wallet_name IS NOT NULL AND wallet_name != ''
    `;
    return new Set(rows.map(r => r.wkey).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

function buildGroupedInventory(allOrders) {
  const invGroups = {};
  (allOrders || []).forEach(o => {
    const rem = Number(o.tonKho || 0);
    const origWh = String(o.trangThaiKho || '').trim() || 'Kho 2F';
    const cleanWh = origWh.toLowerCase();
    const pName = String(o.tenSP || '').trim();
    if (rem <= 0 || !pName) return;

    // Bỏ qua các sản phẩm chưa về kho hoặc không sẵn sàng bán: Chờ Ship, Đặt trước, Chusen, Hủy
    const isNotAvail = isWarehousePendingName(origWh)
      || isWarehousePreOrderName(origWh)
      || isWarehouseCancelledName(origWh)
      || o.orderStatus === 'DA_HUY';
    if (isNotAvail) return;

    const isPreCard = String(o.trangThaiThe || '').toLowerCase().includes('pre');

    const key = pName.toLowerCase();
    if (!invGroups[key]) {
      invGroups[key] = {
        tenSP: pName,
        warehousesMap: {},
        totalQty: 0,
        preOrderQty: 0,
        totalValue: 0,
        avgPrice: 0,
        purchasePlaces: [],
        itemIds: []
      };
    }
    const g = invGroups[key];
    g.totalQty += rem;
    if (isPreCard) g.preOrderQty += rem;
    g.totalValue += (rem * Number(o.price || 0));
    g.warehousesMap[origWh] = (g.warehousesMap[origWh] || 0) + rem;

    if (o.id && !g.itemIds.includes(o.id)) g.itemIds.push(o.id);
    const place = o.noiMua || o.shop || '';
    if (place && !g.purchasePlaces.includes(place)) g.purchasePlaces.push(place);
  });

  return Object.values(invGroups).map(g => {
    g.avgPrice = g.totalQty > 0 ? Math.round(g.totalValue / g.totalQty) : 0;
    const whList = Object.keys(g.warehousesMap).map(whKey => ({
      name: whKey,
      qty: g.warehousesMap[whKey]
    }));
    g.warehouses = whList;
    g.warehouse = whList.map(w => w.name).join(', ');
    delete g.warehousesMap;
    return g;
  });
}

function buildTab5Matrix(orderRows, catRows) {
  const allowedStores = ["Fuji", "Yodo", "Joshin"];
  const tab5CatById = buildCategoryByIdMap(catRows);
  const resTab5Cat = (cid, fallback) => {
    const cidClean = normalizeCategoryId(cid);
    const fbClean = String(fallback || '').trim();
    const obj = (cidClean && tab5CatById.get(cidClean)) || (fbClean && tab5CatById.get(fbClean)) || null;
    return obj ? String(obj.name || '').trim() : fbClean;
  };
  const accounts = (catRows || []).filter(c => c.type === 'ACCOUNT').map(c => c.name);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function getProductCategory(tenSP) {
    if (!tenSP) return "Film MINI Trắng";
    const clean = String(tenSP).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const isWhite = clean === "film mini instax" || clean.includes("trang") || clean.includes("white") || clean.includes("monochrome");
    return isWhite ? "Film MINI Trắng" : "Film MINI Màu";
  }

  const matrix = [];
  allowedStores.forEach(store => {
    const storeAccs = accounts.filter(acc => acc.toLowerCase().startsWith(store.toLowerCase()));
    if (storeAccs.length === 0) return;

    const accountsStatus = [];

    storeAccs.forEach(accName => {
      const shortName = accName.slice(store.length).trim();
      const accOrders = (orderRows || []).filter(o => {
        const oShop = resTab5Cat(o.shop_id, o.shop).toLowerCase() || resTab5Cat(o.warehouse_id, o.warehouse).toLowerCase();
        const oNote = String(o.note || '').toLowerCase();
        const oAcc = resTab5Cat(o.account_id, o.account).toLowerCase();
        const isStoreMatch = oShop.includes(store.toLowerCase()) || oNote.includes(store.toLowerCase()) || oAcc.includes(store.toLowerCase());
        const isAccMatch = oAcc.includes(accName.toLowerCase()) || oAcc.includes(shortName.toLowerCase()) || oNote.includes(accName.toLowerCase()) || oNote.includes(shortName.toLowerCase());
        return isStoreMatch && (isAccMatch || (!oAcc && !oNote.includes('joshin') && !oNote.includes('yodo') && !oNote.includes('fuji')));
      });

      // Tạo trạng thái cho cả 2 danh mục: Film MINI Trắng và Film MINI Màu
      ["Film MINI Trắng", "Film MINI Màu"].forEach(cat => {
        const isMau = cat.includes("Màu");
        const catOrders = accOrders.filter(o => {
          const pName = String(o.product_name || o.product || '');
          const isFilm = pName.toLowerCase().includes('film') || pName.toLowerCase().includes('instax');
          if (!isFilm && pName) return false;
          return getProductCategory(pName) === cat;
        });

        const lastOrder = catOrders[0] || (accOrders.length > 0 && !isMau ? accOrders[0] : null);

        let isCooldown = false;
        let daysLeft = 0;
        let nextAvailableDate = "";
        let lastPurchaseDate = lastOrder ? lastOrder.date : "Chưa từng mua";
        let lastProduct = lastOrder ? (lastOrder.product_name || lastOrder.product) : "";
        let lastPrice = lastOrder ? Number(lastOrder.unit_price || 0) : 0;

        // Tiệm Yodo: Film Màu KHÔNG tính cooldown
        const isYodoColor = store === "Yodo" && isMau;

        if (lastOrder && lastOrder.date && !isYodoColor) {
          const orderDate = new Date(lastOrder.date);
          orderDate.setHours(0, 0, 0, 0);
          const cooldownDays = store === "Yodo" ? 13 : 30;
          const availDate = new Date(orderDate.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
          if (availDate > today) {
            isCooldown = true;
            daysLeft = Math.ceil((availDate - today) / (1000 * 60 * 60 * 24));
            nextAvailableDate = availDate.toISOString().slice(0, 10);
          }
        }

        accountsStatus.push({
          account: accName,
          shortName: shortName || accName,
          category: cat,
          isCooldown: isCooldown,
          daysLeft: daysLeft,
          nextAvailableDate: nextAvailableDate,
          lastPurchaseDate: lastPurchaseDate,
          lastProduct: lastProduct,
          lastPrice: lastPrice
        });
      });
    });

    matrix.push({
      store: store,
      accountsStatus: accountsStatus
    });
  });

  return { matrix, accounts, stores: allowedStores };
}

async function computeFinancialTrendStats(sql, cycle = 3, anchorMonth = null, anchorYear = null) {
  const validCount = (cycle === 6 || cycle === 12) ? cycle : 3;
  const now = new Date();
  const aMonth = (anchorMonth !== null && anchorMonth !== undefined) ? parseInt(anchorMonth, 10) : (now.getMonth() + 1);
  const aYear = (anchorYear !== null && anchorYear !== undefined) ? parseInt(anchorYear, 10) : now.getFullYear();

  const buckets = [];
  const bucketMap = {};

  for (let i = validCount - 1; i >= 0; i--) {
    const d = new Date(aYear, aMonth - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    const key = y + '-' + (m < 10 ? '0' + m : m);
    const label = 'T' + m;
    const b = {
      key,
      year: y,
      month: m,
      label,
      income: 0,
      expense: 0,
      revenue: 0,
      cogs: 0
    };
    buckets.push(b);
    bucketMap[key] = b;
  }

  // 1. Thống kê thu chi gia đình
  let familyRows = [];
  let catRows = [];
  try {
    [familyRows, catRows] = await Promise.all([
      sql`SELECT date, type, amount, status, content, note, hu, hu_id FROM family_transactions`,
      sql`SELECT id, name, type FROM categories`.catch(() => [])
    ]);
  } catch (e) {
    familyRows = [];
    catRows = [];
  }

  const catById = new Map();
  let thuNhapCatId = '';
  (catRows || []).forEach(c => {
    const cid = normalizeCategoryId(c.id);
    if (cid) catById.set(cid, c);
    if (normalizeTextNoAccents(c.name) === 'thu nhap' && cid) thuNhapCatId = cid;
  });

  familyRows.forEach(row => {
    const dStr = String(row.date || '').slice(0, 10);
    const key = dStr.slice(0, 7);
    if (!bucketMap[key]) return;

    const statusVal = String(row.status || '').trim().toUpperCase();
    const content = String(row.content || '').trim();
    const note = String(row.note || '').trim();
    const fHuId = normalizeCategoryId(row.hu_id || row.hu);
    const fHuCat = fHuId ? catById.get(fHuId) : null;
    const resolvedHu = fHuCat ? String(fHuCat.name || '') : String(row.hu || '').trim();
    const huLow = resolvedHu.toLowerCase();
    const isPreOrder = statusVal === 'PRE-ORDER' || statusVal.includes('PRE') || content.toLowerCase().includes('pre-order') || note.toLowerCase().includes('pre-order');
    if (isPreOrder) return;

    const isTagExcluded = isExcludedJarFamilyTxHelper(content, note) ||
      content.startsWith('Điều chỉnh Hũ từ ') || note.includes('Chuyển hũ (Cộng)') ||
      huLow.includes('ck nội bộ') || huLow.includes('công nợ') || huLow.includes('tất toán thẻ');
    if (isTagExcluded) return;

    const amt = Number(row.amount || 0);
    const loai = String(row.type || '').trim().toLowerCase();
    const isThu = (loai === 'thu' || loai === 'khoản thu' || loai === 'thu nhập');
    if (isThu) {
      if (isIncomeJarCategoryHelper(resolvedHu, fHuId, thuNhapCatId)) {
        bucketMap[key].income += amt;
      }
    } else {
      bucketMap[key].expense += amt;
    }
  });

  // 2. Thống kê kinh doanh (Sales Orders)
  let salesRows = [];
  try {
    salesRows = await sql`
      SELECT date, total_amount, cogs, unit_price, quantity, order_status, status, is_deleted, note
      FROM sales_orders
      WHERE is_deleted = false
    `;
  } catch (e) {
    salesRows = [];
  }

  salesRows.forEach(row => {
    const rawOrderStatus = String(row.order_status || '').trim().toUpperCase();
    const trangThai = String(row.status || '').trim();
    const ghiChu = String(row.note || '').trim();
    const isCancelled = rawOrderStatus === 'DA_HUY' || rawOrderStatus === 'DA_HOAN' ||
      trangThai === 'DA_HUY' || trangThai === 'ĐÃ HỦY' || ghiChu.toLowerCase().includes('[đã hủy');
    if (isCancelled) return;

    const dStr = String(row.date || '').slice(0, 10);
    const key = dStr.slice(0, 7);
    if (!bucketMap[key]) return;

    const qty = Number(row.quantity || 1);
    const price = Number(row.unit_price || 0);
    const total = Number(row.total_amount || (qty * price));
    const cogsVal = Number(row.cogs || 0);

    bucketMap[key].revenue += total;
    bucketMap[key].cogs += cogsVal;
  });

  const labels = [];
  const income = [];
  const expense = [];
  const savings = [];
  const revenue = [];
  const cogs = [];
  const profit = [];
  let totalIncome = 0, totalExpense = 0, totalSavings = 0;
  let totalRevenue = 0, totalCogs = 0, totalProfit = 0;

  buckets.forEach(b => {
    labels.push(b.label);
    const inc = Math.round(b.income);
    const exp = Math.round(b.expense);
    const sav = inc - exp;
    income.push(inc);
    expense.push(exp);
    savings.push(sav);
    totalIncome += inc;
    totalExpense += exp;
    totalSavings += sav;

    const rev = Math.round(b.revenue);
    const cg = Math.round(b.cogs);
    const prof = rev - cg;
    revenue.push(rev);
    cogs.push(cg);
    profit.push(prof);
    totalRevenue += rev;
    totalCogs += cg;
    totalProfit += prof;
  });

  return {
    success: true,
    cycle: validCount,
    labels,
    family: {
      income,
      expense,
      savings,
      totalIncome,
      totalExpense,
      totalSavings
    },
    business: {
      revenue,
      cogs,
      profit,
      totalRevenue,
      totalCogs,
      totalProfit
    }
  };
}

function parseFamilyDateYmdHelper(dStr) {
  if (!dStr) return null;
  if (dStr instanceof Date || (typeof dStr === 'object' && Object.prototype.toString.call(dStr) === '[object Date]' && typeof dStr.getTime === 'function')) {
    if (isNaN(dStr.getTime())) return null;
    const y = dStr.getFullYear();
    const m = dStr.getMonth() + 1;
    const d = dStr.getDate();
    if (y < 2000 || y > 2100) return null;
    return {
      year: y,
      month: m,
      day: d,
      iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    };
  }
  const str = String(dStr).trim();
  const datePart = str.split('T')[0].split(/\s+/)[0];
  const p = datePart.split(/[-/]/);
  if (p.length < 3) return null;
  let y = NaN;
  let m = NaN;
  let d = NaN;
  if (p[0].length === 4) {
    y = parseInt(p[0], 10);
    m = parseInt(p[1], 10);
    d = parseInt(p[2], 10);
  } else if (p[2].length === 4) {
    y = parseInt(p[2], 10);
    m = parseInt(p[1], 10);
    d = parseInt(p[0], 10);
  }
  if (isNaN(y) || isNaN(m) || isNaN(d) || y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return null;
  }
  const checkDt = new Date(y, m - 1, d);
  if (checkDt.getFullYear() !== y || checkDt.getMonth() !== (m - 1) || checkDt.getDate() !== d) {
    return null;
  }
  return {
    year: y,
    month: m,
    day: d,
    iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  };
}

function buildFamilyExpenseCalendarData(familyRows, targetYear, targetMonth, catByIdMap = null, walletByIdMap = null) {
  const now = new Date();
  const parsedYear = parseInt(targetYear, 10);
  const parsedMonth = parseInt(targetMonth, 10);
  const year = (!isNaN(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100) ? parsedYear : now.getFullYear();
  const month = (!isNaN(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) ? parsedMonth : (now.getMonth() + 1);

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  let thuNhapCatId = '';
  if (catByIdMap && typeof catByIdMap.entries === 'function') {
    for (const [cid, c] of catByIdMap.entries()) {
      if (normalizeTextNoAccents(c && c.name) === 'thu nhap') {
        thuNhapCatId = cid;
        break;
      }
    }
  }

  const days = {};
  (familyRows || []).forEach(f => {
    if (!f) return;
    const dt = parseFamilyDateYmdHelper(f.date);
    if (!dt || dt.year !== year || dt.month !== month) return;

    const amt = Math.round(Number(f.amount || 0));
    if (!(amt > 0)) return;

    const loaiLow = String(f.type || '').trim().toLowerCase();
    if (loaiLow === 'thu' || loaiLow === 'khoản thu' || loaiLow === 'thu nhập') return;

    const statusUpper = String(f.status || 'ACTIVE').trim().toUpperCase();
    if (['DA_HUY', 'CANCELLED', 'DELETED', 'DA_XOA'].includes(statusUpper)) return;

    const idStr = String(f.id || '').trim();
    const idUpper = idStr.toUpperCase();
    if (idUpper.startsWith('TRF_') || idUpper.startsWith('SETL_') || idUpper.startsWith('JTF_')) return;

    const contentStr = String(f.content || '').trim();
    const noteStr = String(f.note || '').trim();
    if (isExcludedJarFamilyTxHelper(contentStr, noteStr)) return;
    if (
      contentStr.startsWith('Điều chỉnh Hũ từ ') ||
      contentStr.startsWith('Chuyển tiền hũ') ||
      noteStr.includes('Chuyển hũ (')
    ) {
      return;
    }

    const fHuId = normalizeCategoryId(f.hu_id || f.hu);
    const fHuCat = (fHuId && catByIdMap && typeof catByIdMap.get === 'function') ? catByIdMap.get(fHuId) : null;
    const resolvedHu = String(fHuCat ? (fHuCat.name || '') : (f.hu || '')).trim();
    if (isIncomeJarCategoryHelper(resolvedHu, fHuId, thuNhapCatId)) return;

    const huNorm = normalizeTextNoAccents(resolvedHu);
    if (['ck noi bo', 'cong no', 'tat toan the', 'ung cho nhom', 'thu nhap'].some(k => huNorm.includes(k))) {
      return;
    }

    const fWId = String(f.wallet_id || '').trim();
    const fWNameRaw = String(f.wallet_name || '').trim();
    const fWObj = (walletByIdMap && typeof walletByIdMap.get === 'function')
      ? ((fWId && walletByIdMap.get(fWId)) || (fWNameRaw && walletByIdMap.get(fWNameRaw)) || null)
      : null;
    const resolvedWallet = String(fWObj ? (fWObj.name || '') : fWNameRaw).trim();
    const resolvedWalletId = fWObj ? String(fWObj.id) : fWId;
    const isPreOrder = statusUpper.includes('PRE');

    if (!days[dt.iso]) {
      days[dt.iso] = {
        date: dt.iso,
        day: dt.day,
        total: 0,
        count: 0,
        items: []
      };
    }

    days[dt.iso].total += amt;
    days[dt.iso].count += 1;
    days[dt.iso].items.push({
      id: idStr,
      ngay: dt.iso,
      noidung: contentStr,
      sotien: amt,
      hu: resolvedHu,
      huId: fHuId || '',
      nguontien: resolvedWallet,
      walletId: resolvedWalletId,
      isFixed: Boolean(f.is_fixed),
      isPreOrder,
      status: f.status || 'ACTIVE',
      statementDate: String(f.statement_date || '').trim(),
      paymentGroupId: String(f.payment_group_id || '').trim(),
      note: noteStr
    });
  });

  let totalExpense = 0;
  let maxDayExpense = 0;
  let txCount = 0;
  const dayKeys = Object.keys(days);
  dayKeys.forEach(k => {
    const dObj = days[k];
    dObj.items.sort((a, b) => String(b.id || '').localeCompare(String(a.id || '')));
    totalExpense += dObj.total;
    if (dObj.total > maxDayExpense) maxDayExpense = dObj.total;
    txCount += dObj.count;
  });

  return {
    success: true,
    year,
    month,
    daysInMonth,
    firstDayOffset,
    totalExpense,
    maxDayExpense,
    activeDaysCount: dayKeys.length,
    txCount,
    days
  };
}

async function computeFamilyExpenseCalendar(sql, monthArg, yearArg) {
  const now = new Date();
  const parsedMonth = parseInt(monthArg, 10);
  const parsedYear = parseInt(yearArg, 10);
  const targetMonth = (!isNaN(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) ? parsedMonth : (now.getMonth() + 1);
  const targetYear = (!isNaN(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100) ? parsedYear : now.getFullYear();

  const [familyRows, catRows, walletRows] = await Promise.all([
    sql`
      SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date, payment_group_id
      FROM family_transactions
      ORDER BY date DESC, id DESC
    `.catch(() => []),
    sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories ORDER BY id ASC`.catch(() => []),
    sql`SELECT id, name, type FROM wallets`.catch(() => [])
  ]);

  const catByIdMap = buildCategoryByIdMap(catRows);
  const walletByIdMap = buildWalletByIdMap(walletRows);
  return buildFamilyExpenseCalendarData(familyRows, targetYear, targetMonth, catByIdMap, walletByIdMap);
}

async function ensureQuickFixedSkipsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS quick_fixed_skips (
      item_key TEXT NOT NULL,
      year INT NOT NULL,
      month INT NOT NULL,
      display_name TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (item_key, year, month)
    )
  `;
}

function parseQuickFixedActionArgs(args) {
  const first = args && args[0];
  const isObj = first !== null && typeof first === 'object' && !Array.isArray(first);
  const rawName = isObj
    ? (first.noiDung ?? first.noidung ?? first.displayName ?? first.content ?? '')
    : (first ?? '');
  const displayName = String(rawName || '').trim();
  const itemKey = displayName.toLowerCase();
  const rawMonth = isObj ? first.month : (args && args[1]);
  const rawYear = isObj ? first.year : (args && args[2]);
  const month = parseInt(rawMonth, 10);
  const year = parseInt(rawYear, 10);
  const hasValidPeriod = !isNaN(month) && month >= 1 && month <= 12 && !isNaN(year) && year >= 2000 && year <= 2100;
  return { displayName, itemKey, month, year, hasValidPeriod };
}

function buildQuickFixedItemsData(familyRows, skippedRows, targetYear, targetMonth, catRows = [], walletRows = []) {
  const quickCatById = buildCategoryByIdMap(catRows);
  const quickWalletById = buildWalletByIdMap(walletRows);
  const skippedKeySet = new Set(
    (skippedRows || [])
      .map(r => String((r && r.item_key) || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const fixedMap = new Map();
  const paidInMonth = new Set();

  for (const f of (familyRows || [])) {
    if (!f) continue;
    const content = String(f.content || '').trim();
    if (!content) continue;
    const statusUpper = String(f.status || 'ACTIVE').trim().toUpperCase();
    if (['DA_HUY', 'CANCELLED', 'DELETED', 'DA_XOA'].includes(statusUpper)) continue;

    const key = content.toLowerCase();
    const dt = parseFamilyDateYmdHelper(f.date);
    const amt = Math.round(Number(f.amount || 0));

    if (dt && dt.year === targetYear && dt.month === targetMonth && amt > 0) {
      paidInMonth.add(key);
    }

    if (Boolean(f.is_fixed) && !fixedMap.has(key)) {
      const fHuKey = normalizeCategoryId(f.hu_id);
      const huCat = (fHuKey && quickCatById.get(fHuKey)) || resolveHuCategory(catRows, { huId: f.hu_id, huName: f.hu });
      const resolvedHu = huCat ? huCat.name : (String(f.hu || 'Thiết yếu').trim() || 'Thiết yếu');
      const wObj = f.wallet_id ? quickWalletById.get(String(f.wallet_id).trim()) : null;
      const resolvedWallet = wObj ? wObj.name : String(f.wallet_name || '').trim();
      fixedMap.set(key, {
        noidung: content,
        loai: String(f.type || '').trim().toLowerCase() === 'thu' ? 'Thu' : 'Chi',
        huId: huCat ? String(huCat.id) : fHuKey,
        hu: resolvedHu,
        walletId: f.wallet_id ? String(f.wallet_id).trim() : '',
        nguon: resolvedWallet,
        nguontien: resolvedWallet,
        ngay: f.date || '',
        day: (dt && dt.day >= 1 && dt.day <= 31) ? dt.day : null,
        sotien: 0,
        prevAmount: amt > 0 ? amt : 0
      });
    }
  }

  const unpaidItems = [];
  const skippedItems = [];
  for (const [key, tpl] of fixedMap.entries()) {
    if (paidInMonth.has(key)) continue;
    if (skippedKeySet.has(key)) {
      skippedItems.push(tpl);
    } else {
      unpaidItems.push(tpl);
    }
  }
  unpaidItems.sort((a, b) => (a.day || 32) - (b.day || 32));
  skippedItems.sort((a, b) => (a.day || 32) - (b.day || 32));

  return {
    success: true,
    items: unpaidItems,
    skippedItems,
    totalFixedCount: fixedMap.size,
    month: targetMonth,
    year: targetYear
  };
}

const _kianGoalsTablesEnsured = new Set();

async function ensureKianGoalsTables(sql, dbKey = '') {
  if (dbKey && _kianGoalsTablesEnsured.has(dbKey)) return;
  const ignoreConcurrentDdl = (err) => {
    const code = String(err?.code || '');
    if (code !== '23505' && code !== '42P07') throw err;
  };
  await sql`
    CREATE TABLE IF NOT EXISTS kian_goals (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'fund',
      icon TEXT NOT NULL DEFAULT '🐷',
      name TEXT NOT NULL,
      target_yen BIGINT NOT NULL DEFAULT 0,
      initial_yen BIGINT NOT NULL DEFAULT 0,
      auto_tpl_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
      auto_start_ym TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      linked_jars JSONB NOT NULL DEFAULT '[]'::jsonb,
      db_debt_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      repeatable BOOLEAN NOT NULL DEFAULT false,
      completed_cycles INT NOT NULL DEFAULT 0,
      subtitle TEXT NOT NULL DEFAULT '',
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `.catch(ignoreConcurrentDdl);
  await sql`
    ALTER TABLE kian_goals ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false
  `.catch(ignoreConcurrentDdl);
  await sql`
    CREATE TABLE IF NOT EXISTS kian_goal_entries (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      amount BIGINT NOT NULL DEFAULT 0,
      source_jar_id TEXT NOT NULL DEFAULT 'EXTERNAL',
      source_jar_name TEXT NOT NULL DEFAULT '',
      deduct_from_jar BOOLEAN NOT NULL DEFAULT false,
      family_tx_id TEXT DEFAULT NULL,
      mode TEXT NOT NULL DEFAULT 'direct',
      wallet_id TEXT DEFAULT NULL,
      wallet_name TEXT DEFAULT NULL,
      db_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
      cycle_num INT NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `.catch(ignoreConcurrentDdl);
  if (dbKey) _kianGoalsTablesEnsured.add(dbKey);
}

function parseKianJsonArrayHelper(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function getCurrentYmJstHelper() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthsBetweenYmKianGoal(ymStart, ymEnd) {
  const s = String(ymStart || '').trim().slice(0, 7);
  const e = String(ymEnd || '').trim().slice(0, 7);
  const sp = s.split('-').map(Number);
  const ep = e.split('-').map(Number);
  if (sp.length < 2 || ep.length < 2 || !sp[0] || !sp[1] || !ep[0] || !ep[1]) return 1;
  return Math.max(1, (ep[0] - sp[0]) * 12 + (ep[1] - sp[1]));
}

function computeKianGoalStatsHelper(goalRow, entryRows = [], dbDebtByIdMap = new Map(), nowYm = '', familyRows = []) {
  const g = goalRow || {};
  const kind = String(g.kind || 'fund').toLowerCase() === 'debt' ? 'debt' : 'fund';
  const curCycle = Math.max(0, Math.round(Number(g.completed_cycles ?? g.completedCycles ?? 0)));
  const linkedJars = parseKianJsonArrayHelper(g.linked_jars ?? g.linkedJars)
    .map(x => String(x || '').trim())
    .filter(Boolean);
  const dbDebtIds = kind === 'debt'
    ? parseKianJsonArrayHelper(g.db_debt_ids ?? g.dbDebtIds).map(x => String(x || '').trim()).filter(Boolean)
    : [];
  const autoTplKeywords = parseKianJsonArrayHelper(g.auto_tpl_keywords ?? g.autoTplKeywords)
    .map(x => String(x || '').trim().toLowerCase())
    .filter(Boolean);
  const autoStartYm = String(g.auto_start_ym ?? g.autoStartYm ?? '').trim().slice(0, 7);
  const initialYen = Math.max(0, Math.round(Number(g.initial_yen ?? g.initialYen ?? 0)));
  const targetYen = Math.max(0, Math.round(Number(g.target_yen ?? g.targetYen ?? 0)));
  const startDate = String(g.start_date ?? g.startDate ?? '').trim();
  const endDate = String(g.end_date ?? g.endDate ?? '').trim();

  const cycleEntries = (Array.isArray(entryRows) ? entryRows : []).filter(e =>
    e && String(e.goal_id ?? e.goalId ?? '') === String(g.id || '') &&
    Math.max(0, Math.round(Number(e.cycle_num ?? e.cycleNum ?? 0))) === curCycle
  );

  let savedYen = initialYen;
  let piggyBalance = (kind === 'debt') ? initialYen : 0;
  let settledPaidYen = 0;

  // Tự động tính các giao dịch Chi trong family_transactions khớp từ khóa (chỉ tính từ autoStartYm trở đi)
  let autoTxTotal = 0;
  const autoMatchedTxItems = [];
  if (autoTplKeywords.length > 0 && Array.isArray(familyRows)) {
    familyRows.forEach(f => {
      if (!f) return;
      const loai = String(f.type || '').trim().toLowerCase();
      if (loai !== 'chi') return;
      const fDate = String(f.date || '').trim();
      const fYm = fDate.slice(0, 7);
      if (autoStartYm && fYm < autoStartYm) return;
      const cStr = String(f.content || '').toLowerCase();
      const nStr = String(f.note || '').toLowerCase();
      const matched = autoTplKeywords.some(kw => cStr.includes(kw) || nStr.includes(kw));
      if (matched) {
        const amt = Math.max(0, Math.round(Number(f.amount || 0)));
        autoTxTotal += amt;
        autoMatchedTxItems.push({
          id: String(f.id || ''),
          date: fDate,
          content: String(f.content || ''),
          amount: amt,
          hu: String(f.hu || '')
        });
      }
    });
  }

  savedYen += autoTxTotal;
  if (kind === 'debt') piggyBalance += autoTxTotal;
  else settledPaidYen += autoTxTotal;

  const history = cycleEntries.map(e => {
    const amt = Math.max(0, Math.round(Number(e.amount || 0)));
    const rawMode = String(e.mode || (kind === 'debt' ? 'piggy' : 'direct')).toLowerCase();
    const entryMode = kind === 'debt'
      ? (rawMode === 'direct' ? 'direct' : (rawMode === 'settle' ? 'settle' : 'piggy'))
      : 'direct';
    if (kind === 'debt') {
      if (entryMode === 'piggy') {
        savedYen += amt;
        piggyBalance += amt;
      } else if (entryMode === 'settle') {
        piggyBalance -= amt;
        settledPaidYen += amt;
      } else {
        savedYen += amt;
        settledPaidYen += amt;
      }
    } else {
      savedYen += amt;
      settledPaidYen += amt;
    }
    return {
      id: String(e.id || ''),
      goalId: String(e.goal_id ?? e.goalId ?? g.id ?? ''),
      date: String(e.entry_date ?? e.date ?? '').trim(),
      amount: amt,
      sourceJarId: String(e.source_jar_id ?? e.sourceJarId ?? 'EXTERNAL').trim() || 'EXTERNAL',
      sourceJarName: String(e.source_jar_name ?? e.sourceJarName ?? '').trim(),
      deductFromJar: Boolean(e.deduct_from_jar ?? e.deductFromJar),
      familyTxId: e.family_tx_id ?? e.familyTxId ?? null,
      mode: entryMode,
      walletId: e.wallet_id ?? e.walletId ?? null,
      walletName: e.wallet_name ?? e.walletName ?? null,
      dbAllocations: parseKianJsonArrayHelper(e.db_allocations ?? e.dbAllocations),
      note: String(e.note || '').trim()
    };
  });
  piggyBalance = Math.max(0, piggyBalance);

  const remainingYen = Math.max(0, targetYen - savedYen);
  const pct = targetYen > 0 ? Math.min(100, Math.round((savedYen / targetYen) * 100)) : 100;
  const curYm = /^\d{4}-\d{2}$/.test(String(nowYm || '')) ? nowYm : getCurrentYmJstHelper();
  const startYm = /^\d{4}-\d{2}/.test(startDate) ? startDate.slice(0, 7) : curYm;
  const endYm = /^\d{4}-\d{2}/.test(endDate) ? endDate.slice(0, 7) : curYm;
  const effStart = startYm > curYm ? startYm : curYm;
  const monthsLeft = monthsBetweenYmKianGoal(effStart, endYm);
  const monthlyNeedYen = remainingYen > 0 ? Math.ceil(remainingYen / monthsLeft) : 0;
  const isQueuedLater = startYm > curYm;

  const dbLinkedItems = [];
  let dbRemainingTotalYen = 0;
  if (kind === 'debt' && dbDebtIds.length > 0) {
    dbDebtIds.forEach(did => {
      const d = dbDebtByIdMap instanceof Map ? dbDebtByIdMap.get(did) : (dbDebtByIdMap && dbDebtByIdMap[did]);
      if (d) {
        const duNo = Math.max(0, Math.round(Number(d.duNo ?? d.remaining_debt ?? 0)));
        dbRemainingTotalYen += duNo;
        dbLinkedItems.push({
          id: String(d.id || did),
          ten: String(d.ten || d.name || '').trim(),
          noidung: String(d.noidung || d.content || '').trim(),
          tongNo: Math.max(0, Math.round(Number(d.tongNo ?? d.amount ?? 0))),
          daTra: Math.max(0, Math.round(Number(d.daTra ?? 0))),
          duNo,
          trangThai: String(d.trangThai || d.status || 'ACTIVE')
        });
      }
    });
  }

  return {
    id: String(g.id || ''),
    kind,
    icon: String(g.icon || (kind === 'debt' ? '💳' : '🐷')),
    name: String(g.name || '').trim(),
    subtitle: String(g.subtitle || '').trim(),
    targetYen,
    initialYen,
    autoTplKeywords,
    autoStartYm,
    startDate,
    endDate,
    linkedJars,
    dbDebtIds,
    repeatable: kind === 'fund' && Boolean(g.repeatable),
    is_locked: Boolean(g.is_locked ?? g.isLocked),
    isLocked: Boolean(g.is_locked ?? g.isLocked),
    completedCycles: curCycle,
    sortOrder: Number(g.sort_order ?? g.sortOrder ?? 0),
    stats: {
      targetYen,
      initialYen,
      autoTxTotal,
      autoMatchedTxItems,
      savedYen,
      piggyBalance,
      settledPaidYen,
      remainingYen,
      pct,
      monthsLeft,
      monthlyNeedYen,
      isQueuedLater,
      dbLinkedItems,
      dbRemainingTotalYen
    },
    history
  };
}

function allocateKianDebtPaymentHelper(payAmount, dbDebtIds = [], debtRowsById = new Map()) {
  let rem = Math.max(0, Math.round(Number(payAmount || 0)));
  const allocations = [];
  let totalAllocated = 0;
  for (const rawId of (Array.isArray(dbDebtIds) ? dbDebtIds : [])) {
    if (rem <= 0) break;
    const id = String(rawId || '').trim();
    if (!id) continue;
    const row = debtRowsById instanceof Map ? debtRowsById.get(id) : (debtRowsById && debtRowsById[id]);
    if (!row) continue;
    const curRem = Math.max(0, Math.round(Number(row.remaining_debt ?? row.duNo ?? 0)));
    if (curRem <= 0) continue;
    const paid = Math.min(rem, curRem);
    const newRemaining = Math.max(0, curRem - paid);
    const newStatus = newRemaining <= 0 ? 'DA_TRA' : 'DANG_NO';
    allocations.push({ debtId: id, paid, newRemaining, newStatus, prevRemaining: curRem });
    row.remaining_debt = newRemaining;
    if (row.duNo !== undefined) row.duNo = newRemaining;
    rem -= paid;
    totalAllocated += paid;
  }
  return { allocations, totalAllocated };
}

async function buildKianGoalsPayload(sql, { jars = [], debtRows = null, catByIdMap = null, wallets = null, familyRows = null, dbKey = '' } = {}) {
  await ensureKianGoalsTables(sql, dbKey);
  const [goalRows, entryRows, rawDebts, rawCats, rawWallets, rawFamRows, tplRows] = await Promise.all([
    sql`SELECT * FROM kian_goals ORDER BY sort_order ASC, created_at ASC`.catch(() => []),
    sql`SELECT * FROM kian_goal_entries ORDER BY entry_date DESC, created_at DESC`.catch(() => []),
    debtRows !== null
      ? Promise.resolve(debtRows)
      : sql`SELECT id, date, name, partner_id, content, amount, remaining_debt, type, status, note FROM debts ORDER BY id DESC`.catch(() => []),
    catByIdMap !== null
      ? Promise.resolve(null)
      : sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => []),
    wallets !== null
      ? Promise.resolve(wallets)
      : sql`SELECT id, name, type, current_balance FROM wallets WHERE COALESCE(is_hidden, false) = false AND COALESCE(is_deleted, false) = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL' ORDER BY id ASC`.catch(() => []),
    familyRows !== null
      ? Promise.resolve(familyRows)
      : sql`SELECT id, date, type, content, note, amount, hu_id, hu FROM family_transactions ORDER BY date DESC, id DESC`.catch(() => []),
    sql`SELECT id, content_template, auto_hu_id, auto_hu_name FROM family_templates WHERE is_hidden = false ORDER BY id ASC`.catch(() => [])
  ]);

  const resolvedCatMap = catByIdMap || buildCategoryByIdMap(rawCats || []);
  const linkedDbIdSet = new Set();
  (goalRows || []).forEach(g => {
    parseKianJsonArrayHelper(g.db_debt_ids).forEach(id => {
      const sid = String(id || '').trim();
      if (sid) linkedDbIdSet.add(sid);
    });
  });

  const dbDebtByIdMap = new Map();
  const dbDebts = [];
  (rawDebts || []).forEach(d => {
    if (!d) return;
    const loaiUp = String(d.type || '').trim().toUpperCase();
    if (loaiUp === 'THU') return;
    const idStr = String(d.id || '').trim();
    if (!idStr) return;
    const stUp = String(d.status || '').trim().toUpperCase();
    if (['DA_HUY', 'CANCELLED', 'DELETED'].includes(stUp) && !linkedDbIdSet.has(idStr)) return;
    const amt = Math.max(0, Math.round(Number(d.amount || 0)));
    const duNo = Math.max(0, Math.round(Number(d.remaining_debt || 0)));
    const dPartnerId = normalizeCategoryId(d.partner_id);
    const dPartnerCat = dPartnerId ? resolvedCatMap.get(dPartnerId) : null;
    const pName = String(dPartnerCat ? dPartnerCat.name : (d.name || '')).trim();
    const mapped = {
      id: idStr,
      ngay: String(d.date || ''),
      ten: pName || 'Không tên',
      noidung: String(d.content || '').trim(),
      tongNo: amt,
      daTra: Math.max(0, amt - duNo),
      duNo,
      trangThai: String(d.status || 'ACTIVE')
    };
    dbDebtByIdMap.set(idStr, mapped);
    if (duNo > 0 || linkedDbIdSet.has(idStr)) {
      dbDebts.push(mapped);
    }
  });

  const nowYm = getCurrentYmJstHelper();
  const goals = (goalRows || []).map(g => computeKianGoalStatsHelper(g, entryRows, dbDebtByIdMap, nowYm, rawFamRows || []));
  const lockedGoalsTotal = goals.reduce((sum, g) => sum + (g.is_locked ? Math.max(0, Number(g.stats?.savedYen || g.initialYen || 0)) : 0), 0);
  const simpleWallets = (rawWallets || [])
    .filter(w => w && !w.is_hidden && !w.is_deleted && String(w.type || '').toUpperCase() !== 'VIRTUAL')
    .map(w => ({
      id: String(w.id || ''),
      name: String(w.name || ''),
      type: String(w.type || 'DEBIT'),
      current_balance: Number(w.current_balance || 0)
    }));

  const templates = (tplRows || []).map(t => ({
    id: String(t.id || ''),
    name: String(t.content_template || '').trim(),
    huId: String(t.auto_hu_id || '').trim(),
    huName: String(t.auto_hu_name || '').trim()
  })).filter(t => t.name);

  return { goals, dbDebts, jars, wallets: simpleWallets, templates, lockedGoalsTotal };
}

async function fetchFreshKianGoalsResponse(sql, monthArg, yearArg, dbKey = '') {
  const now = new Date();
  const isAllMonth = String(monthArg || '').toUpperCase() === 'ALL';
  const isAllYear = String(yearArg || '').toUpperCase() === 'ALL';
  const parsedMonth = parseInt(monthArg, 10);
  const parsedYear = parseInt(yearArg, 10);
  const targetMonth = isAllMonth ? null : ((!isNaN(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) ? parsedMonth : (now.getMonth() + 1));
  const targetYear = isAllYear ? null : ((!isNaN(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100) ? parsedYear : now.getFullYear());

  const [familyRows, catRows, jarConfigs, debtRows, wallets] = await Promise.all([
    sql`SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status FROM family_transactions`.catch(() => []),
    sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories ORDER BY id ASC`.catch(() => []),
    sql`SELECT year, month, invest_amount, giaoduc_amount, pct_thietyeu, pct_tietkiem, pct_giaoduc, pct_giaitri, pct_chodi, raw_config FROM jar_configs ORDER BY year ASC, month ASC`.catch(() => []),
    sql`SELECT id, date, name, partner_id, content, amount, remaining_debt, type, status, note FROM debts ORDER BY id DESC`.catch(() => []),
    sql`SELECT id, name, type, current_balance FROM wallets WHERE COALESCE(is_hidden, false) = false AND COALESCE(is_deleted, false) = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL' ORDER BY id ASC`.catch(() => [])
  ]);

  const catByIdMap = buildCategoryByIdMap(catRows);
  const huCatsActive = (catRows || []).filter(c => ALL_HU_TYPES.includes(String(c.type || '').toUpperCase()) && !c.is_hidden);
  const expenseHuCats = huCatsActive.filter(c => !SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(c.name)));
  const jarNames = expenseHuCats.length > 0 ? expenseHuCats.map(c => c.name) : DEFAULT_EXPENSE_JARS;
  const jarCatByNameLow = new Map(huCatsActive.map(c => [normalizeTextNoAccents(c.name), c]));

  const jarSummary = computeJarSummaryHelper({
    familyRows,
    jarConfigs,
    jarNames,
    jarCatByNameLow,
    allCatByIdMap: catByIdMap,
    targetMonth,
    targetYear,
    isAllMonth,
    isAllYear
  });

  return await buildKianGoalsPayload(sql, {
    jars: jarSummary.jars,
    debtRows,
    catByIdMap,
    wallets,
    familyRows,
    dbKey
  });
}

async function applyKianDebtDbSettlement(sql, { goalName = '', dbDebtIds = [], amount = 0, walletId = '', walletName = '', dateStr = '', orderId = '' }) {
  const cleanIds = (Array.isArray(dbDebtIds) ? dbDebtIds : []).map(x => String(x || '').trim()).filter(Boolean);
  if (cleanIds.length === 0 || amount <= 0) {
    return { error: 'Mục tiêu chưa gắn khoản nợ DB hợp lệ hoặc số tiền <= 0!', allocations: [], totalAllocated: 0, wallet: null };
  }
  const debtRows = await sql`
    SELECT id, name, amount, remaining_debt, status, note
    FROM debts
    WHERE id = ANY(${cleanIds})
  `.catch(() => []);
  const debtById = new Map((debtRows || []).map(r => [String(r.id), { ...r }]));
  const { allocations, totalAllocated } = allocateKianDebtPaymentHelper(amount, cleanIds, debtById);
  if (totalAllocated <= 0 || allocations.length === 0) {
    return { error: 'Các khoản nợ DB gắn với mục tiêu này đều đã trả hết (dư nợ = ¥0)!', allocations: [], totalAllocated: 0, wallet: null };
  }

  for (const alloc of allocations) {
    const orig = debtById.get(alloc.debtId);
    const prevNote = String(orig?.note || '').trim();
    const newNote = prevNote ? `${prevNote}; TT mục tiêu ${dateStr}` : `TT mục tiêu ${dateStr}`;
    await sql`
      UPDATE debts
      SET remaining_debt = ${alloc.newRemaining}, status = ${alloc.newStatus}, note = ${newNote}
      WHERE id = ${alloc.debtId}
    `;
  }

  let settledWallet = null;
  if (walletId || walletName) {
    const wRes = await applyFamilyWalletDelta(sql, {
      walletId,
      walletName,
      amount: totalAllocated,
      isThu: false,
      isPre: false,
      sign: 1
    });
    if (wRes && wRes.wallet) {
      settledWallet = { id: String(wRes.wallet.id || ''), name: String(wRes.wallet.name || '') };
      await upsertWalletLedgerEntry(sql, {
        date: dateStr,
        walletId: settledWallet.id,
        walletName: settledWallet.name,
        eventType: 'REPAY_LOAN',
        effectType: wRes.isCredit ? 'CARD_DEBT' : 'CASH',
        amount: totalAllocated,
        balanceAfter: wRes.balanceAfter,
        note: `[Trả nợ mục tiêu] ${goalName || settledWallet.name}`.trim(),
        orderId: String(orderId || ''),
        status: 'POSTED',
        direction: wRes.isCredit ? 'INCREASE' : 'OUT',
        sourceModule: 'Debt'
      });
    }
  }

  return { error: null, allocations, totalAllocated, wallet: settledWallet };
}

async function reverseKianGoalEntryDbEffects(sql, entryRow) {
  if (!entryRow) return;
  const entryId = String(entryRow.id || '').trim();
  const familyTxId = String(entryRow.family_tx_id || '').trim();
  if (familyTxId) {
    await sql`DELETE FROM family_transactions WHERE id = ${familyTxId}`.catch(() => {});
  }

  const allocs = parseKianJsonArrayHelper(entryRow.db_allocations);
  let totalReversed = 0;
  for (const a of allocs) {
    const did = String(a?.debtId || '').trim();
    const paid = Math.max(0, Math.round(Number(a?.paid || 0)));
    if (!did || paid <= 0) continue;
    totalReversed += paid;
    const rows = await sql`SELECT id, amount, remaining_debt FROM debts WHERE id = ${did} LIMIT 1`.catch(() => []);
    if (rows && rows[0]) {
      const origAmt = Math.max(0, Math.round(Number(rows[0].amount || 0)));
      const curRem = Math.max(0, Math.round(Number(rows[0].remaining_debt || 0)));
      const nextRem = origAmt > 0 ? Math.min(origAmt, curRem + paid) : (curRem + paid);
      const nextStatus = nextRem > 0 ? 'DANG_NO' : 'DA_TRA';
      await sql`UPDATE debts SET remaining_debt = ${nextRem}, status = ${nextStatus} WHERE id = ${did}`.catch(() => {});
    }
  }

  const wId = String(entryRow.wallet_id || '').trim();
  const wName = String(entryRow.wallet_name || '').trim();
  if (totalReversed > 0 && (wId || wName)) {
    await applyFamilyWalletDelta(sql, {
      walletId: wId,
      walletName: wName,
      amount: totalReversed,
      isThu: false,
      isPre: false,
      sign: -1
    }).catch(() => {});
  }
  if (entryId) {
    await sql`UPDATE wallet_ledger SET status = 'DELETED' WHERE order_id = ${entryId}`.catch(() => {});
  }
}

function buildWalletTypeMap(walletRows) {
  const map = new Map();
  (walletRows || []).forEach(w => {
    const isCred = String(w.type || '').trim().toUpperCase() === 'CREDIT';
    const idKey = w.id !== undefined && w.id !== null ? ('id:' + String(w.id).trim().toLowerCase()) : '';
    if (idKey) map.set(idKey, isCred);
    const clean = String(w.name || '').trim().toLowerCase();
    if (!clean) return;
    if (!map.has(clean)) map.set(clean, isCred);
  });
  return map;
}

function buildWalletByIdMap(walletRows) {
  const map = new Map();
  (walletRows || []).forEach(w => {
    const wId = String(w.id || '').trim();
    if (wId) map.set(wId, w);
  });
  return map;
}

function isWalletNameCredit(walletName, walletTypeMap, walletId = '') {
  const idClean = String(walletId || '').trim().toLowerCase();
  if (idClean && walletTypeMap && walletTypeMap.has('id:' + idClean)) {
    return walletTypeMap.get('id:' + idClean);
  }
  const clean = String(walletName || '').trim().toLowerCase();
  if (!clean) return false;
  if (walletTypeMap && walletTypeMap.has(clean)) return walletTypeMap.get(clean);
  return clean.startsWith('c-') || clean.startsWith('c_');
}

function mapPurchaseOrderRow(o, walletTypeMap, walletByIdMap, catByIdMap = null, catRows = null) {
  const qty = Number(o.quantity || 0);
  const price = Math.round(Number(o.unit_price || 0));
  const total = Math.round(Number(o.total_amount || 0) || (qty * Number(o.unit_price || 0)));
  let rem = Number(o.inventory_remaining || 0);
  const pName = String(o.product_name || '').trim();

  let whId = normalizeCategoryId(o.warehouse_id)
    || ((o.warehouse && catByIdMap && catByIdMap.has(String(o.warehouse).trim())) ? String(o.warehouse).trim() : null);
  const whCatById = (whId && catByIdMap) ? catByIdMap.get(whId) : null;
  let wh = whCatById ? String(whCatById.name || '').trim() : String(o.warehouse || 'Kho Tokyo').trim();

  const shopId = normalizeCategoryId(o.shop_id)
    || ((o.shop && catByIdMap && catByIdMap.has(String(o.shop).trim())) ? String(o.shop).trim() : null);
  const shopCatById = (shopId && catByIdMap) ? catByIdMap.get(shopId) : null;
  const shopName = (shopCatById ? String(shopCatById.name || '').trim() : String(o.shop || '').trim()) || wh;

  const accountId = normalizeCategoryId(o.account_id)
    || ((o.account && catByIdMap && catByIdMap.has(String(o.account).trim())) ? String(o.account).trim() : null);
  const accCatById = (accountId && catByIdMap) ? catByIdMap.get(accountId) : null;
  const accountName = accCatById ? String(accCatById.name || '').trim() : String(o.account || '').trim();

  const rawWId = String(o.wallet_id || '').trim();
  const rawWName = String(o.wallet_name || '').trim();
  const walletObj = (rawWId && walletByIdMap && walletByIdMap.get(rawWId))
    || (rawWName && walletByIdMap && walletByIdMap.get(rawWName))
    || null;
  const walletId = walletObj ? String(walletObj.id) : rawWId;
  const walletName = walletObj ? String(walletObj.name || '').trim() : rawWName;
  const isCreditWallet = walletObj
    ? String(walletObj.type || '').trim().toUpperCase() === 'CREDIT'
    : isWalletNameCredit(walletName, walletTypeMap, walletId);
  const isDebitPaidWallet = Boolean(walletId || walletName) && !walletName.toUpperCase().includes('TỒN KHO') && !isCreditWallet;
  const cardStatus = String(o.status || 'HOAN_TAT').trim();
  const lowerRawStatus = cardStatus.toLowerCase();
  const ordStatus = String(o.order_status || 'HOAN_TAT').trim();
  let noteStr = String(o.note || '').trim();

  const isRefundedOrCancelledStatus = lowerRawStatus === 'da_hoan_tien' || lowerRawStatus.includes('da_hoan') || lowerRawStatus.includes('refunded') || lowerRawStatus === 'da_huy';
  const isCardDone = !isRefundedOrCancelledStatus && (lowerRawStatus.includes('hoan_tat') || lowerRawStatus.includes('da_tru') || lowerCardStatusDoneCheck(lowerRawStatus) || cardStatus === 'HOAN_TAT' || (isDebitPaidWallet && !lowerRawStatus.includes('pre')));
  if (isCardDone) {
    if (isWarehousePreOrderName(wh)) {
      const targetChoShip = catRows ? resolveWarehouseCategory(catRows, { fallbackRole: 'CHO_SHIP' }) : null;
      wh = targetChoShip ? targetChoShip.name : 'Chờ Ship';
      if (targetChoShip) whId = targetChoShip.id;
      if (rem === 0 && qty > 0 && ordStatus !== 'DA_HUY') rem = qty;
    }
    noteStr = noteStr.replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
  }

  return {
    id: o.id,
    ngayMua: o.date,
    statementDate: o.statement_date || '',
    statement_date: o.statement_date || '',
    noiMua: shopName,
    shop: shopName,
    shopId: shopId,
    warehouseId: whId,
    warehouse_id: whId,
    trangThaiKho: wh,
    tenSP: pName,
    qty: qty,
    price: price,
    total: total,
    walletId: walletId,
    wallet_id: walletId,
    nguonTien: walletName,
    isCreditWallet: isCreditWallet,
    trangThaiThe: isCardDone ? 'HOAN_TAT' : cardStatus,
    ghiChu: noteStr,
    tonKho: rem,
    orderStatus: ordStatus,
    taiKhoan: accountName,
    accountId: accountId,
    paymentGroupId: String(o.payment_group_id || '').trim(),
    payment_group_id: String(o.payment_group_id || '').trim(),
    isDeleted: Boolean(o.is_deleted)
  };
}

function lowerCardStatusDoneCheck(lowerRawStatus) {
  return lowerRawStatus.includes('đã trừ') || lowerRawStatus.includes('hoàn tất');
}

function isPurchasePreOrderPending(o) {
  const lowerCardStatus = String(o.trangThaiThe || '').toLowerCase();
  const isCardDone = lowerCardStatus.includes('hoan_tat') || lowerCardStatus.includes('da_tru') || lowerCardStatus.includes('đã trừ') || lowerCardStatus.includes('hoàn tất');
  const isCancelled = o.orderStatus === 'DA_HUY' || lowerCardStatus.includes('hủy') || lowerCardStatus.includes('cancel');
  if (isCardDone || isCancelled) return false;
  return (
    isWarehousePreOrderName(o.trangThaiKho || '') ||
    lowerCardStatus.includes('pre')
  );
}

async function fetchHiddenOrdersHelper(sql) {
  const [hiddenPOs, hiddenSOs, catRows, walletRows] = await Promise.all([
    sql`
      SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, shop, shop_id, account, account_id
      FROM business_orders
      WHERE is_deleted = true
      ORDER BY date DESC, id DESC
    `.catch(() => []),
    sql`
      SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, wallet_id, wallet_name, status, note, cogs, order_status
      FROM sales_orders
      WHERE is_deleted = true
      ORDER BY date DESC, id DESC
    `.catch(() => []),
    sql`SELECT id, type, name FROM categories`.catch(() => []),
    sql`SELECT id, name FROM wallets`.catch(() => [])
  ]);

  const hCatById = buildCategoryByIdMap(catRows);
  const hWalletById = buildWalletByIdMap(walletRows);
  const resHWh = (wid, fb) => {
    const k = normalizeCategoryId(wid) || normalizeCategoryId(fb);
    const c = k ? hCatById.get(k) : null;
    return c ? String(c.name || '').trim() : String(fb || '').trim();
  };
  const resHW = (wid, fb) => {
    const k = String(wid || '').trim() || String(fb || '').trim();
    const w = k ? hWalletById.get(k) : null;
    return w ? String(w.name || '').trim() : String(fb || '').trim();
  };

  const groupMap = {};
  const addRows = (rows, kind) => {
    (rows || []).forEach(r => {
      const baseId = extractBaseOrderId(r.id) || String(r.id || '');
      const key = `${kind}_${baseId}`;
      const qty = Number(r.quantity || 0);
      const amt = Math.round(Number(r.total_amount || 0) || (qty * Number(r.unit_price || 0)));
      if (!groupMap[key]) {
        groupMap[key] = {
          kind,
          baseId,
          id: baseId,
          date: r.date || '',
          productNames: [],
          totalQty: 0,
          totalAmount: 0,
          walletId: r.wallet_id || '',
          walletName: resHW(r.wallet_id, r.wallet_name),
          shop: resHWh(r.shop_id, r.shop),
          warehouse: resHWh(r.warehouse_id, r.warehouse),
          status: r.status || '',
          orderStatus: r.order_status || 'DA_HUY',
          note: r.note || '',
          itemsCount: 0
        };
      }
      const g = groupMap[key];
      const pName = String(r.product_name || '').trim();
      if (pName && !g.productNames.includes(pName)) g.productNames.push(pName);
      g.totalQty += qty;
      g.totalAmount += amt;
      g.itemsCount += 1;
    });
  };

  addRows(hiddenPOs, 'PURCHASE');
  addRows(hiddenSOs, 'SALES');

  return Object.values(groupMap).sort((a, b) => {
    const dCmp = String(b.date || '').localeCompare(String(a.date || ''));
    return dCmp !== 0 ? dCmp : String(b.baseId || '').localeCompare(String(a.baseId || ''));
  });
}

async function getBusinessDataHelper(sql, monthArg, yearArg) {
  const isExplicitAllMonth = (String(monthArg).toUpperCase() === 'ALL');
  const isExplicitAllYear = (String(yearArg).toUpperCase() === 'ALL');
  const now = new Date();
  const targetMonth = isExplicitAllMonth ? null : ((monthArg && monthArg !== 'All') ? parseInt(monthArg, 10) : (now.getMonth() + 1));
  const targetYear = isExplicitAllYear ? null : ((yearArg && yearArg !== 'All') ? parseInt(yearArg, 10) : now.getFullYear());
  const isAllMonth = isExplicitAllMonth;
  const isAllYear = isExplicitAllYear;

  const parseDateHelper = (dStr) => {
    if (!dStr) return null;
    const str = String(dStr).trim();
    const p = str.split('T')[0].split(/[-/]/);
    if (p.length >= 3) {
      if (p[0].length === 4) {
        return { year: parseInt(p[0], 10), month: parseInt(p[1], 10) };
      } else {
        return { year: parseInt(p[2], 10), month: parseInt(p[1], 10) };
      }
    }
    return null;
  };

  const [orderRows, salesRowsResult, allCatRows, walletRows] = await Promise.all([
    sql`
      SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, is_deleted, shop, shop_id, account, account_id, statement_date, payment_group_id
      FROM business_orders
      WHERE is_deleted = false
      ORDER BY date DESC, id DESC
    `,
    sql`
      SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, wallet_id, wallet_name, status, note, cogs, order_status, is_deleted
      FROM sales_orders
      WHERE is_deleted = false
      ORDER BY date DESC, id DESC
    `.catch(() => []),
    sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories ORDER BY id ASC`.catch(() => []),
    sql`SELECT id, name, type, is_deleted FROM wallets`.catch(() => [])
  ]);

  const salesRows = salesRowsResult || [];
  const catByIdMap = buildCategoryByIdMap(allCatRows);
  const catRows = (allCatRows || []).filter(c => !c.is_hidden);
  const walletTypeMap = buildWalletTypeMap(walletRows);
  const walletByIdMap = buildWalletByIdMap(walletRows);

  let totalSales = 0;
  let totalCogs = 0;
  const debtSales = [];

  const allSales = (salesRows || []).map(s => {
    const qty = Number(s.quantity || 0);
    const price = Math.round(Number(s.unit_price || 0));
    const total = Math.round(Number(s.total_amount || 0) || (qty * Number(s.unit_price || 0)));
    const cogs = Number(s.cogs || 0);
    const st = String(s.status || '').trim();
    const ordSt = String(s.order_status || 'HOAN_TAT').trim();
    const isCancelled = ordSt === 'DA_HUY' || st === 'DA_HUY' || st.toLowerCase().includes('hủy');

    const dt = parseDateHelper(s.date);
    const matchYear = isAllYear || !targetYear || (dt && dt.year === targetYear);
    const matchMonth = isAllMonth || !targetMonth || (dt && dt.month === targetMonth);

    if (!isCancelled && matchYear && matchMonth) {
      totalSales += total;
      totalCogs += cogs;
    }

    const sWhId = normalizeCategoryId(s.warehouse_id)
      || (s.warehouse && catByIdMap.has(String(s.warehouse).trim()) ? String(s.warehouse).trim() : null);
    const sWhCat = sWhId ? catByIdMap.get(sWhId) : null;
    const resolvedNoiTru = sWhCat ? sWhCat.name : s.warehouse;
    const rawSWId = String(s.wallet_id || '').trim();
    const rawSWName = String(s.wallet_name || '').trim();
    const sWObj = (rawSWId && walletByIdMap.get(rawSWId)) || (rawSWName && walletByIdMap.get(rawSWName)) || null;
    const sWIdStr = sWObj ? String(sWObj.id) : rawSWId;

    const sItem = {
      id: s.id,
      ngayBan: s.date,
      tenSP: s.product_name,
      warehouseId: sWhId,
      noiTru: resolvedNoiTru,
      qty: qty,
      price: price,
      total: total,
      walletId: sWIdStr,
      wallet_id: sWIdStr,
      nhanTien: sWObj ? sWObj.name : s.wallet_name,
      trangThai: st || 'HOAN_TAT',
      ghiChu: s.note || '',
      cogs: cogs,
      orderStatus: isCancelled ? 'DA_HUY' : ordSt,
      isCancelled: isCancelled
    };

    const isDebt = st.toUpperCase().includes('KHÁCH NỢ') || st.toUpperCase().includes('KHACH NO') || st.toUpperCase().includes('DEBT') || st.toUpperCase() === 'NO';
    if (isDebt && !isCancelled) {
      debtSales.push(sItem);
    }

    return sItem;
  });

  let totalStockValue = 0;
  const whSet = new Set(catRows.filter(c => c.type === 'WAREHOUSE' || c.type === 'WAREHOUSE_STATUS').map(c => c.name));
  const shopSet = new Set(catRows.filter(c => c.type === 'SHOP').map(c => c.name));
  const prodMap = {};

  const allOrders = orderRows.map(o => {
    const mapped = mapPurchaseOrderRow(o, walletTypeMap, walletByIdMap, catByIdMap, allCatRows);
    if (mapped.trangThaiKho) whSet.add(mapped.trangThaiKho);
    if (mapped.shop) shopSet.add(mapped.shop);
    if (mapped.tenSP) prodMap[mapped.tenSP] = (prodMap[mapped.tenSP] || 0) + mapped.tonKho;
    if (mapped.tonKho > 0 && !isWarehouseCancelledName(mapped.trangThaiKho)) {
      totalStockValue += (mapped.tonKho * mapped.price);
    }
    return mapped;
  });

  const preOrders = allOrders.filter(isPurchasePreOrderPending);

  const cancelledRefundPending = allOrders.filter(o => {
    if (o.isDeleted) return false;
    const lowerWh = String(o.trangThaiKho || '').toLowerCase();
    const lowerCardStatus = String(o.trangThaiThe || '').toLowerCase();
    const lowerOrderStatus = String(o.orderStatus || '').toLowerCase();
    const isCancelled = lowerWh.includes('hủy') || lowerWh.includes('cancel') || lowerCardStatus.includes('hủy') || lowerCardStatus.includes('cancel');
    const isRefunded =
      lowerCardStatus === 'da_hoan_tien' || lowerCardStatus.includes('da_hoan') || lowerCardStatus.includes('đã hoàn') || lowerCardStatus.includes('refunded') ||
      lowerOrderStatus === 'da_hoan_tien' || lowerOrderStatus.includes('da_hoan') || lowerOrderStatus.includes('đã hoàn') || lowerOrderStatus.includes('refunded');
    const isPending = (
      lowerCardStatus.includes('cho_hoan') ||
      lowerCardStatus.includes('chờ hoàn') ||
      lowerCardStatus.includes('cần hoàn') ||
      lowerCardStatus.includes('refund') ||
      lowerWh.includes('chờ hoàn') ||
      lowerWh.includes('cho_hoan') ||
      (isCancelled && !isRefunded)
    );
    return isPending && !isRefunded;
  });

  const inStockProducts = Object.keys(prodMap).map(name => ({
    tenSP: name,
    qty: prodMap[name]
  }));

  let allWallets = [];
  try {
    allWallets = await sql`
      SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status, is_hidden, is_deleted
      FROM wallets
      WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
      ORDER BY id ASC
    `;
  } catch (e) {
    allWallets = [];
  }

  const groupedInventory = buildGroupedInventory(allOrders);
  const tab5Data = buildTab5Matrix(orderRows, catRows);
  const hiddenOrders = await fetchHiddenOrdersHelper(sql).catch(() => []);

  return {
    success: true,
    summary: {
      sales: totalSales,
      cogs: totalCogs,
      net: totalSales - totalCogs,
      stockValue: totalStockValue
    },
    products: inStockProducts,
    allProducts: Array.from(new Set([...orderRows.map(o => o.product_name), ...catRows.filter(c => c.type === 'PRODUCT').map(c => c.name)])).filter(Boolean),
    preOrders: preOrders,
    allSales: allSales,
    cancelledRefundPending: cancelledRefundPending,
    hiddenOrders: hiddenOrders,
    debtSales: debtSales,
    inventory: allOrders,
    groupedInventory: groupedInventory,
    warehouses: Array.from(whSet),
    warehouseItems: catRows.filter(c => c.type === 'WAREHOUSE' || c.type === 'WAREHOUSE_STATUS').map(c => ({ id: c.id, type: c.type, name: c.name })),
    purchasePlaces: Array.from(shopSet),
    sources: allWallets.map(w => w.name),
    wallets: allWallets,
    suppliers: catRows.filter(c => c.type === 'SUPPLIER' || c.type === 'PARTNER' || c.type === 'FAMILY').map(c => c.name),
    partners: catRows.filter(c => c.type === 'PARTNER' || c.type === 'FAMILY').map(c => c.name),
    accounts: catRows.filter(c => c.type === 'ACCOUNT').map(c => c.name)
  };
}

function normalizeDateToYMD(dStr) {
  if (!dStr) return '';
  if (dStr instanceof Date) {
    if (isNaN(dStr.getTime())) return '';
    return `${dStr.getFullYear()}-${String(dStr.getMonth() + 1).padStart(2, '0')}-${String(dStr.getDate()).padStart(2, '0')}`;
  }
  const str = String(dStr).trim();
  if (!str) return '';
  const datePart = str.split('T')[0].trim();
  // YYYY/MM/DD or YYYY-MM-DD or YYYY年MM月DD日
  let m = datePart.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  m = datePart.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return '';
}

function formatYMDToDDMMYYYY(dStr) {
  if (!dStr) return '';
  if (dStr instanceof Date) {
    if (isNaN(dStr.getTime())) return '';
    return `${String(dStr.getDate()).padStart(2, '0')}/${String(dStr.getMonth() + 1).padStart(2, '0')}/${dStr.getFullYear()}`;
  }
  const ymd = normalizeDateToYMD(dStr);
  if (ymd) {
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
  }
  return String(dStr).trim();
}

function parseRecTs(dStr) {
  const ymd = normalizeDateToYMD(dStr);
  if (!ymd) return 0;
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function makeShortHash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (ch + i);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

function normalizeRecNote(str) {
  let s = String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Loại bỏ số dư ở đuôi, đơn vị tiền và gạch ngang giữ chỗ (vd: "円 14 490円 -", "14,490 -", "14490")
    .replace(/\s*(?:円|¥|￥)?\s*\d+(?:\s+\d+|\s*,\s*\d+)*\s*(?:円|¥|￥)?\s*[-ー―–—\s]*$/i, '')
    .replace(/\s*[-ー―–—円¥￥]+\s*$/g, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function computeRecSimilarity(s1, s2) {
  const a = normalizeRecNote(s1);
  const b = normalizeRecNote(s2);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const setA = new Set(a.split(' ').filter(w => w.length >= 2));
  const setB = new Set(b.split(' ').filter(w => w.length >= 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let hit = 0;
  setA.forEach(w => { if (setB.has(w)) hit++; });
  return hit / Math.max(setA.size, setB.size);
}

function parseBankStatementRawFallback(rawText) {
  const cleanText = String(rawText || '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\u2212\u2010\u2012\u2013\u2014\u2015\uFE63]/g, '-');
  const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  const hasExplicitNegative = /[-▲△]\s*\b\d{1,3}(?:,\d{3})+|\b\d{1,3}(?:,\d{3})+\s*[-▲△]|[-▲△]\s*\b\d+\s*(?:円|¥|￥)|\b\d+\s*(?:円|¥|￥)?\s*[-▲△]/.test(cleanText);

  for (const line of lines) {
    const normLine = line;
    const dateMatch = normLine.match(/(\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}日?|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
    const dateRaw = dateMatch ? dateMatch[1] : '';
    const ymd = normalizeDateToYMD(dateRaw);
    if (!ymd) continue;

    let remaining = normLine.replace(dateRaw, ' ');
    let amtToken = '';
    let numVal = 0;
    let type = '+';
    let rowBal = null;
    let note = '';

    // 1. Ưu tiên cấu trúc chuẩn cuối dòng có 2 số: [...Nội dung...] [Số tiền] [Số dư]
    const tailTwoNums = remaining.match(/(?:^|\s)([-+▲△¥￥]?\s*[\d,]+(?:\s*[円¥￥])?)\s+([¥￥]?\s*[\d,]+(?:\s*[円¥￥])?)\s*[-ー―–—\s]*$/);
    if (tailTwoNums) {
      amtToken = tailTwoNums[1].trim();
      const cleanedNum = String(amtToken).replace(/[\s,円¥￥▲△\-+]/g, '');
      numVal = Math.abs(Number(cleanedNum));
      if (!cleanedNum || isNaN(numVal) || numVal === 0) continue;
      type = /[-－▲△−–—―\u2212\u2010-\u2015]/.test(amtToken) ? '-' : '+';
      const rawBalStr = String(tailTwoNums[2] || '').replace(/[\s,円¥￥▲△]/g, '');
      const bVal = parseFloat(rawBalStr);
      if (!isNaN(bVal) && bVal > 0) rowBal = bVal;
      note = remaining.slice(0, tailTwoNums.index).trim();
    } else {
      // 2. Tìm số tiền giao dịch thông thường
      const amtMatch = remaining.match(/(?:^|\s)([-+▲△¥￥]?\s*\d{1,3}(?:,\d{3})+(?:円)?\s*[-+▲△]?)(?=\s|$)/)
        || remaining.match(/(?:^|\s)([-+▲△¥￥]?\s*\d+(?:円)?\s*[-+▲△]?)(?=\s|$)/)
        || remaining.match(/([-+▲△¥￥]?\s*[\d,]+(?:\s*[円¥￥])?\s*[-+▲△]?)/);
      if (!amtMatch) continue;
      amtToken = amtMatch[1] || amtMatch[0];
      const cleanedNum = String(amtToken).replace(/[\s,円¥￥▲△\-+]/g, '');
      numVal = Math.abs(Number(cleanedNum));
      if (!cleanedNum || isNaN(numVal) || numVal === 0) continue;

      type = /[-－▲△−–—―\u2212\u2010-\u2015]/.test(amtToken) ? '-' : '+';

      remaining = remaining.replace(amtMatch[0], ' ');
      // Trích xuất số dư cuối dòng nếu có (vd: "円 34 535円 –" hoặc "34,535円 -" hoặc "34535")
      const balMatch = remaining.match(/(?:円|¥|￥)?\s*(\d{1,3}(?:[\s,]\d{2,3})+|\d+)\s*(?:円|¥|￥)\s*[-ー―–—\s]*$/i)
        || remaining.match(/(?:^|\s)(?:円|¥|￥)?\s*(\d{1,3}(?:[\s,]\d{3})+|\d+)\s*[-ー―–—\s]*$/i);
      if (balMatch) {
        const rawNum = (balMatch[1] || balMatch[0]).replace(/[\s,]/g, '');
        const bVal = parseFloat(rawNum);
        if (!isNaN(bVal) && bVal > 0) {
          rowBal = bVal;
          remaining = remaining.slice(0, balMatch.index).trim();
        }
      }
      note = remaining.trim();
    }

    // Loại bỏ số dư đuôi dòng và ký tự placeholder khỏi note
    note = note
      .replace(/(?:\s+|^)(?:円|¥|￥)?\s*\d+(?:\s+\d+|\s*,\s*\d+)*\s*(?:円|¥|￥)?\s*[-ー―–—\s]*$/i, '')
      .replace(/\s*[-ー―–—円¥￥]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    entries.push({
      date: formatYMDToDDMMYYYY(ymd),
      ymd,
      amount: Math.round(numVal),
      type,
      note,
      balance: rowBal
    });
  }

  // Tinh chỉnh dấu theo biến động số dư lũy kế
  if (entries.length >= 2) {
    const isDesc = (entries[0].ymd >= entries[entries.length - 1].ymd);
    for (let k = 0; k < entries.length - 1; k++) {
      const cur = entries[k];
      const next = entries[k + 1];
      if (cur.balance !== null && cur.balance !== undefined && next.balance !== null && next.balance !== undefined) {
        const delta = isDesc ? (cur.balance - next.balance) : (next.balance - cur.balance);
        const target = isDesc ? cur : next;
        if (Math.abs(Math.abs(delta) - target.amount) <= 1) {
          if (delta < 0) target.type = '-';
          else if (delta > 0) target.type = '+';
        }
      }
    }
  }

  return entries;
}

async function attachWalletCheckpointMetaHelper(sql, walletList) {
  if (!Array.isArray(walletList) || walletList.length === 0) return walletList;
  try {
    const [cpRows, recRows] = await Promise.all([
      sql`SELECT id, wallet_id, wallet_name, checkpoint_date, checkpoint_balance FROM wallet_checkpoints ORDER BY id DESC`.catch(() => []),
      sql`SELECT wallet_id, wallet_name, MAX(COALESCE(NULLIF(TRIM(bank_date), ''), reconciled_at::text)) as last_rec_date FROM bank_reconciliations GROUP BY wallet_id, wallet_name`.catch(() => [])
    ]);
    const cpById = new Map();
    const cpByName = new Map();
    for (const c of (cpRows || [])) {
      const wid = String(c.wallet_id || '').trim().toLowerCase();
      const wname = String(c.wallet_name || '').trim().toLowerCase();
      if (wid && !cpById.has(wid)) cpById.set(wid, c);
      if (wname && !cpByName.has(wname)) cpByName.set(wname, c);
    }
    const recById = new Map();
    const recByName = new Map();
    for (const r of (recRows || [])) {
      const wid = String(r.wallet_id || '').trim().toLowerCase();
      const wname = String(r.wallet_name || '').trim().toLowerCase();
      const dt = formatYMDToDDMMYYYY(r.last_rec_date) || String(r.last_rec_date || '').slice(0, 10);
      if (wid && dt && !recById.has(wid)) recById.set(wid, dt);
      if (wname && dt && !recByName.has(wname)) recByName.set(wname, dt);
    }
    return walletList.map(w => {
      const wid = String(w.id || '').trim().toLowerCase();
      const wname = String(w.name || '').trim().toLowerCase();
      const cp = (wid && cpById.get(wid)) || (wname && cpByName.get(wname)) || null;
      const recDt = (wid && recById.get(wid)) || (wname && recByName.get(wname)) || '';
      return {
        ...w,
        checkpoint_date: cp ? (formatYMDToDDMMYYYY(cp.checkpoint_date) || String(cp.checkpoint_date || '')) : (w.checkpoint_date || ''),
        checkpoint_balance: cp ? Number(cp.checkpoint_balance || 0) : (w.checkpoint_balance ?? null),
        last_reconciled_date: recDt || (w.last_reconciled_date || '')
      };
    });
  } catch (e) {
    return walletList;
  }
}

async function fetchActiveWalletsList(sql) {
  const rows = await sql`
    SELECT id, name, type, current_balance, initial_balance, total_increase, total_decrease,
           credit_limit, debt, preorder, status, is_hidden, card_number, card_exp, card_cvv,
           closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers
    FROM wallets
    WHERE COALESCE(is_deleted, false) = false
      AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
    ORDER BY name ASC, id ASC
  `;
  const wById = buildWalletByIdMap(rows);
  const mapped = (rows || []).map(w => {
    const sId = String(w.settle_source_id || '').trim();
    const sName = (sId && wById.has(sId)) ? wById.get(sId).name : String(w.settle_source || '');
    return {
      id: String(w.id || ''),
      name: String(w.name || ''),
      type: String(w.type || 'DEBIT'),
      balance: Number(w.current_balance || 0),
      current_balance: Number(w.current_balance || 0),
      initial_balance: Number(w.initial_balance || 0),
      total_increase: Number(w.total_increase || 0),
      total_decrease: Number(w.total_decrease || 0),
      creditLimit: Number(w.credit_limit || 0),
      credit_limit: Number(w.credit_limit || 0),
      debt: Number(w.debt || 0),
      preorder: Number(w.preorder || 0),
      status: String(w.status || 'HOAT_DONG'),
      isHidden: Boolean(w.is_hidden),
      is_hidden: Boolean(w.is_hidden),
      cardNumber: w.card_number || '',
      cardExp: w.card_exp || '',
      cardCvv: w.card_cvv || '',
      stmtFileHeaders: w.stmt_file_headers || null,
      stmtPasteHeaders: w.stmt_paste_headers || null,
      closingDate: w.closing_date || '',
      dueDate: w.due_date || '',
      settle_source_id: sId,
      settleSourceId: sId,
      settle_source: sName,
      settleSource: sName,
      linked_email: w.linked_email || '',
      linkedEmail: w.linked_email || '',
      sender_filter: w.sender_filter || '',
      senderFilter: w.sender_filter || ''
    };
  });
  return attachWalletCheckpointMetaHelper(sql, mapped);
}

async function fetchWalletHistoryHelper(sql, targetWallet, walletNameFallback = '') {
  const walletName = String(targetWallet?.name || walletNameFallback || '').trim();
  const reqWalletId = String(targetWallet?.id || '').trim();
  if (!walletName && !reqWalletId) return [];

  const exactNameLow = walletName.toLowerCase();
  const exactIdLow = reqWalletId.toLowerCase();
  const isCredit = targetWallet
    ? String(targetWallet.type || '').toUpperCase() === 'CREDIT'
    : (exactNameLow.startsWith('c-') || exactNameLow.includes('credit'));

  let allWalletIdsArr = [];
  try {
    const wIdRows = await sql`SELECT id FROM wallets`;
    allWalletIdsArr = wIdRows.map(x => String(x.id || '').trim().toLowerCase()).filter(Boolean);
  } catch (e) {}

  let latestCp = null;
  try {
    const cpRows = await sql`
      SELECT id, wallet_id, wallet_name, checkpoint_date, checkpoint_balance
      FROM wallet_checkpoints
      WHERE (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
         OR (COALESCE(TRIM(wallet_id), '') = '' AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
      ORDER BY id DESC
      LIMIT 1
    `;
    if (cpRows && cpRows.length > 0) latestCp = cpRows[0];
  } catch (e) {}
  const latestCpDateStr = latestCp ? formatYMDToDDMMYYYY(latestCp.checkpoint_date) : '';
  const latestCpYmd = latestCp ? normalizeDateToYMD(latestCp.checkpoint_date) : '';
  const latestCpBal = latestCp ? Number(latestCp.checkpoint_balance || 0) : 0;

  // 1. Ưu tiên đọc từ wallet_ledger theo wallet_id
  let ledgerRows = [];
  try {
    ledgerRows = await sql`
      SELECT id, transaction_date, wallet_id, wallet_name, event_type, effect_type,
             amount, balance_after, note, order_id, status, direction, source_module, statement_date, checkpoint_ref, payment_group_id
      FROM wallet_ledger
      WHERE COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED')
        AND (
          (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
          OR (
            (COALESCE(TRIM(wallet_id), '') = '' OR NOT (LOWER(TRIM(COALESCE(wallet_id, ''))) = ANY(${allWalletIdsArr})))
            AND ${exactNameLow !== ''} AND (LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow} OR LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactNameLow})
          )
        )
      ORDER BY transaction_date DESC, id DESC
    `;
  } catch (e) {
    ledgerRows = [];
  }

  const history = [];
  const ledgerOrderIds = new Set();
  const ledgerPaymentGroupIds = new Set();

  if (ledgerRows.length > 0) {
    const hasStampedCpRef = ledgerRows.some(row => String(row.checkpoint_ref || '').trim() !== '');
    ledgerRows.forEach((r, i) => {
      const amt = Number(r.amount || 0);
      const dir = String(r.direction || '').trim().toUpperCase();
      const srcModule = String(r.source_module || '').trim();
      const evType = String(r.event_type || '').trim().toUpperCase();
      const oid = String(r.order_id || '').trim();
      const pgId = String(r.payment_group_id || '').trim() || (/^PG-/i.test(oid) ? oid : '');
      let typeSign = isCredit
        ? ((dir === 'DECREASE' || dir === 'IN' || dir === '+') ? '+' : '-')
        : ((dir === 'IN' || dir === 'INCREASE' || dir === '+') ? '+' : '-');
      // Guard legacy Purchase inserts that hardcoded direction='INCREASE' for DEBIT wallets
      if (!isCredit && srcModule === 'Purchase' && (evType === 'PURCHASE_CHARGE' || evType === 'PREORDER_HOLD')) {
        typeSign = '-';
      }

      let modDisplay = 'Sổ Cái';
      if (pgId || srcModule === 'MixedPayment') modDisplay = 'Hóa Đơn Hỗn Hợp';
      else if (srcModule === 'Family') modDisplay = (typeSign === '+' ? 'Thu Nhập' : 'Thu Chi');
      else if (srcModule === 'Purchase') modDisplay = 'Đơn Mua Hàng';
      else if (srcModule === 'Sales') modDisplay = 'Đơn Bán Hàng';
      else if (srcModule === 'Debt') modDisplay = 'Công Nợ';
      else if (srcModule === 'Wallets' || evType === 'CARD_SETTLE' || evType === 'CARD_PAYMENT') modDisplay = 'Tất Toán Thẻ';
      else if (srcModule === 'Transfer') modDisplay = 'Chuyển Khoản';
      else if (srcModule === 'TripSplit') modDisplay = 'Chia Tiền Nhóm';
      else if (srcModule === 'System' && evType === 'BALANCE_ADJUSTMENT') modDisplay = 'Điều Chỉnh Số Dư';

      const fmtDate = formatYMDToDDMMYYYY(r.transaction_date);
      const stmtDate = formatYMDToDDMMYYYY(r.statement_date) || fmtDate;
      const isPre = String(r.status || '').toUpperCase() === 'PENDING' || String(r.effect_type || '').toUpperCase() === 'PREORDER_HOLD' || (evType === 'PREORDER_HOLD' && String(r.status || '').toUpperCase() !== 'POSTED');
      let noteText = r.note || `[${modDisplay}] Giao dịch`;
      if (srcModule === 'Purchase') {
        if (!isPre && /^\[Pre(?:[-\s]*order(?:\s*Mua\s*hàng)?)?\]\s*-\s*/i.test(noteText)) {
          noteText = noteText.replace(/^\[Pre(?:[-\s]*order(?:\s*Mua\s*hàng)?)?\]\s*-\s*/i, '[Mua hàng] - ');
        } else if (isPre && /^\[Mua\s*hàng\]\s*-\s*/i.test(noteText)) {
          noteText = noteText.replace(/^\[Mua\s*hàng\]\s*-\s*/i, '[Pre] - ');
        }
      }
      const cpRef = String(r.checkpoint_ref || '').trim();
      if (oid) {
        ledgerOrderIds.add(oid);
        oid.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean).forEach(t => ledgerOrderIds.add(t));
      }
      if (pgId) {
        ledgerPaymentGroupIds.add(pgId);
      }

      const txYmd = isCredit
        ? normalizeDateToYMD(r.statement_date || r.transaction_date)
        : normalizeDateToYMD(r.transaction_date);
      const isAfterCp = !cpRef && (!latestCpYmd || !txYmd || (hasStampedCpRef ? txYmd >= latestCpYmd : txYmd > latestCpYmd));
      history.push({
        id: r.id || ('LEDG_' + i),
        date: fmtDate,
        ymd: normalizeDateToYMD(r.statement_date || r.transaction_date),
        useDate: fmtDate,
        statementDate: stmtDate,
        _ts: parseRecTs(r.transaction_date),
        module: modDisplay,
        type: typeSign,
        amount: amt,
        note: noteText,
        isPreorder: isPre,
        status: isPre ? 'PRE-ORDER' : 'HOAN_TAT',
        isAfterCp,
        cpRef,
        cpDateStr: cpRef ? latestCpDateStr : '',
        cpBalance: cpRef ? latestCpBal : 0,
        sourceId: oid,
        sourceModule: pgId ? 'MixedPayment' : srcModule,
        paymentGroupId: pgId
      });
    });
  }

  // 2. Luôn gộp thêm các giao dịch từ Family, Business Orders, Sales Orders, Debts chưa được ghi vào wallet_ledger
  const checkAfterCp = (dStr) => {
    if (!latestCpYmd) return true;
    const ymd = normalizeDateToYMD(dStr);
    return !ymd || ymd > latestCpYmd;
  };

  try {
    const famRows = await sql`
      SELECT id, date, type, content, amount, wallet_id, wallet_name, note, status, statement_date, payment_group_id
      FROM family_transactions
      WHERE COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY')
        AND (
          (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
          OR (
            (COALESCE(TRIM(wallet_id), '') = '' OR NOT (LOWER(TRIM(COALESCE(wallet_id, ''))) = ANY(${allWalletIdsArr})))
            AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow}
          )
        )
      ORDER BY date DESC
    `;
    famRows.forEach(f => {
      const fId = String(f.id || '').trim();
      const fPgId = String(f.payment_group_id || '').trim();
      if (fId && ledgerOrderIds.has(fId)) return;
      if (fPgId && ledgerPaymentGroupIds.has(fPgId)) return;
      if (/^CN\d+/i.test(fId)) {
        const bracketIds = Array.from(String(f.content || '').matchAll(/\[([A-Za-z0-9_-]+)\]/g)).map(m => m[1]);
        if (bracketIds.some(bId => ledgerOrderIds.has(bId))) return;
      }
      const amt = Number(f.amount || 0);
      const isThu = String(f.type || '').toLowerCase() === 'thu';
      const fmtDate = formatYMDToDDMMYYYY(f.date);
      const stmtDate = formatYMDToDDMMYYYY(f.statement_date) || fmtDate;
      const after = checkAfterCp(f.date);
      history.push({
        id: fId,
        date: fmtDate,
        ymd: normalizeDateToYMD(f.statement_date || f.date),
        useDate: fmtDate,
        statementDate: stmtDate,
        _ts: parseRecTs(f.date),
        module: isThu ? 'Thu Nhập' : 'Thu Chi',
        type: isThu ? '+' : '-',
        amount: amt,
        note: f.content || f.note || 'Giao dịch thu chi',
        isPreorder: String(f.status || '').toUpperCase().includes('PRE'),
        status: String(f.status || 'HOAN_TAT'),
        isAfterCp: after,
        cpRef: after ? '' : 'CP_DATE',
        cpDateStr: after ? '' : latestCpDateStr,
        cpBalance: after ? 0 : latestCpBal,
        sourceId: fId,
        sourceModule: 'Family',
        paymentGroupId: fPgId
      });
    });
  } catch (e) {}

  try {
    const poRows = await sql`
      SELECT id, date, product_name, total_amount, wallet_id, wallet_name, status, note, statement_date, payment_group_id
      FROM business_orders
      WHERE is_deleted = false
        AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
        AND (
          (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
          OR (
            (COALESCE(TRIM(wallet_id), '') = '' OR NOT (LOWER(TRIM(COALESCE(wallet_id, ''))) = ANY(${allWalletIdsArr})))
            AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow}
          )
        )
      ORDER BY date DESC
    `;
    poRows.forEach(o => {
      const oId = String(o.id || '').trim();
      const baseOId = extractBaseOrderId(oId);
      const oPgId = String(o.payment_group_id || '').trim();
      if ((oId && ledgerOrderIds.has(oId)) || (baseOId && ledgerOrderIds.has(baseOId))) return;
      if (oPgId && ledgerPaymentGroupIds.has(oPgId)) return;
      const amt = Number(o.total_amount || 0);
      const fmtDate = formatYMDToDDMMYYYY(o.date);
      const stmtDate = formatYMDToDDMMYYYY(o.statement_date) || fmtDate;
      const isPre = String(o.status || '').toUpperCase().includes('PRE') || String(o.note || '').toLowerCase().includes('pre');
      const after = checkAfterCp(o.date);
      history.push({
        id: oId,
        date: fmtDate,
        ymd: normalizeDateToYMD(o.statement_date || o.date),
        useDate: fmtDate,
        statementDate: stmtDate,
        _ts: parseRecTs(o.date),
        module: 'Đơn Mua Hàng',
        type: '-',
        amount: amt,
        note: o.product_name ? `${o.product_name}${o.note ? ' (' + o.note + ')' : ''}` : (o.note || 'Đơn mua hàng'),
        isPreorder: isPre,
        status: isPre ? 'PRE-ORDER' : 'HOAN_TAT',
        isAfterCp: after,
        cpRef: after ? '' : 'CP_DATE',
        cpDateStr: after ? '' : latestCpDateStr,
        cpBalance: after ? 0 : latestCpBal,
        sourceId: oId,
        sourceModule: 'Purchase',
        paymentGroupId: oPgId
      });
    });
  } catch (e) {}

  try {
    const soRows = await sql`
      SELECT id, date, product_name, total_amount, wallet_id, wallet_name, status, note
      FROM sales_orders
      WHERE is_deleted = false
        AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
        AND (
          (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
          OR (
            (COALESCE(TRIM(wallet_id), '') = '' OR NOT (LOWER(TRIM(COALESCE(wallet_id, ''))) = ANY(${allWalletIdsArr})))
            AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow}
          )
        )
      ORDER BY date DESC
    `;
    soRows.forEach(s => {
      const sId = String(s.id || '').trim();
      const baseSId = extractBaseOrderId(sId);
      if ((sId && ledgerOrderIds.has(sId)) || (baseSId && ledgerOrderIds.has(baseSId))) return;
      const amt = Number(s.total_amount || 0);
      const fmtDate = formatYMDToDDMMYYYY(s.date);
      const after = checkAfterCp(s.date);
      history.push({
        id: sId,
        date: fmtDate,
        ymd: normalizeDateToYMD(s.date),
        useDate: fmtDate,
        statementDate: fmtDate,
        _ts: parseRecTs(s.date),
        module: 'Đơn Bán Hàng',
        type: '+',
        amount: amt,
        note: `Bán: ${s.product_name || 'Hàng hóa'}`,
        isPreorder: false,
        status: s.status || 'HOAN_TAT',
        isAfterCp: after,
        cpRef: after ? '' : 'CP_DATE',
        cpDateStr: after ? '' : latestCpDateStr,
        cpBalance: after ? 0 : latestCpBal,
        sourceId: sId,
        sourceModule: 'Sales'
      });
    });
  } catch (e) {}

  try {
    const debtRows = await sql`
      SELECT id, date, name, type, content, amount, wallet_id, wallet_name, status, note
      FROM debts
      WHERE COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'DELETED', 'DA_HUY')
        AND (
          (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
          OR (
            (COALESCE(TRIM(wallet_id), '') = '' OR NOT (LOWER(TRIM(COALESCE(wallet_id, ''))) = ANY(${allWalletIdsArr})))
            AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow}
          )
        )
      ORDER BY date DESC
    `;
    debtRows.forEach(d => {
      const dId = String(d.id || '').trim();
      if (dId && ledgerOrderIds.has(dId)) return;
      const amt = Number(d.amount || 0);
      const isThu = String(d.type || '').toUpperCase() === 'THU';
      const fmtDate = formatYMDToDDMMYYYY(d.date);
      const after = checkAfterCp(d.date);
      history.push({
        id: dId,
        date: fmtDate,
        ymd: normalizeDateToYMD(d.date),
        useDate: fmtDate,
        statementDate: fmtDate,
        _ts: parseRecTs(d.date),
        module: 'Công Nợ',
        type: isThu ? '-' : '+',
        amount: amt,
        note: `${isThu ? '[Cho vay]' : '[Vay nợ]'} ${d.name || ''}${d.content ? ' - ' + d.content : ''}`.trim(),
        isPreorder: false,
        status: d.status || 'DANG_NO',
        isAfterCp: after,
        cpRef: after ? '' : 'CP_DATE',
        cpDateStr: after ? '' : latestCpDateStr,
        cpBalance: after ? 0 : latestCpBal,
        sourceId: dId,
        sourceModule: 'Debt'
      });
    });
  } catch (e) {}

  const finalHistory = aggregateHistoryByPaymentGroup(history);
  const pgIds = Array.from(new Set(finalHistory.map(h => String(h.paymentGroupId || '').trim()).filter(Boolean)));
  if (pgIds.length > 0) {
    try {
      const [grpFamRows, grpBizRows, grpCats] = await Promise.all([
        sql`
          SELECT id, payment_group_id, content, hu_id, hu, amount, note
          FROM family_transactions
          WHERE payment_group_id = ANY(${pgIds})
            AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY')
          ORDER BY id ASC
        `.catch(() => []),
        sql`
          SELECT id, payment_group_id, product_name, warehouse_id, warehouse, quantity, unit_price, total_amount, inventory_remaining, note
          FROM business_orders
          WHERE payment_group_id = ANY(${pgIds})
            AND is_deleted = false
            AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
            AND UPPER(COALESCE(status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
          ORDER BY id ASC
        `.catch(() => []),
        sql`SELECT id, type, name FROM categories`.catch(() => [])
      ]);
      const grpCatMap = buildCategoryByIdMap(grpCats || []);
      const famByPg = new Map();
      (grpFamRows || []).forEach(f => {
        const pg = String(f.payment_group_id || '').trim();
        if (!pg) return;
        const hId = normalizeCategoryId(f.hu_id || f.hu);
        const hObj = hId ? grpCatMap.get(hId) : null;
        const arr = famByPg.get(pg) || [];
        arr.push({
          kind: 'FAMILY',
          id: String(f.id || ''),
          title: String(f.content || f.note || 'Chi tiêu gia đình').trim(),
          categoryName: hObj ? String(hObj.name || '').trim() : String(f.hu || '').trim(),
          qty: 1,
          unitPrice: Math.round(Number(f.amount || 0)),
          amount: Math.round(Number(f.amount || 0))
        });
        famByPg.set(pg, arr);
      });
      const bizByPg = new Map();
      (grpBizRows || []).forEach(b => {
        const pg = String(b.payment_group_id || '').trim();
        if (!pg) return;
        const wId = normalizeCategoryId(b.warehouse_id || b.warehouse);
        const wObj = wId ? grpCatMap.get(wId) : null;
        const qty = Number(b.quantity || 1);
        const rem = Number(b.inventory_remaining ?? qty);
        const arr = bizByPg.get(pg) || [];
        arr.push({
          kind: 'BUSINESS',
          id: String(b.id || ''),
          title: String(b.product_name || 'Hàng hóa').trim(),
          categoryName: wObj ? String(wObj.name || '').trim() : String(b.warehouse || '').trim(),
          qty,
          unitPrice: Math.round(Number(b.unit_price || 0)),
          amount: Math.round(Number(b.total_amount || 0)),
          soldQty: Math.max(0, qty - rem)
        });
        bizByPg.set(pg, arr);
      });

      finalHistory.forEach(h => {
        const pg = String(h.paymentGroupId || '').trim();
        if (!pg) return;
        const fList = famByPg.get(pg) || [];
        const bList = bizByPg.get(pg) || [];
        const combined = [...fList, ...bList];
        if (combined.length > 0) {
          const familyTotal = fList.reduce((s, x) => s + x.amount, 0);
          const businessTotal = bList.reduce((s, x) => s + x.amount, 0);
          h.groupItems = combined;
          h.groupSummary = {
            count: combined.length,
            familyCount: fList.length,
            businessCount: bList.length,
            familyTotal,
            businessTotal,
            total: familyTotal + businessTotal
          };
          h.amount = familyTotal + businessTotal;
        }
      });
    } catch (e) {}
  }

  finalHistory.sort((a, b) => (b._ts || 0) - (a._ts || 0));
  finalHistory.forEach(h => delete h._ts);
  return finalHistory;
}

async function recordReconciledRowsHelper(sql, targetWallet, walletNameFallback, items, batchId, reconciledBy = 'App') {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const wId = String(targetWallet?.id || '').trim();
  const wName = String(targetWallet?.name || walletNameFallback || '').trim();
  const wIdLow = wId.toLowerCase();
  const wNameLow = wName.toLowerCase();

  let existingPairs = new Set();
  try {
    const existingRows = await sql`
      SELECT bank_signature, app_tx_id
      FROM bank_reconciliations
      WHERE (${wIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${wIdLow})
         OR (COALESCE(TRIM(wallet_id), '') = '' AND ${wNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${wNameLow})
    `;
    existingRows.forEach(r => {
      existingPairs.add(`${String(r.bank_signature || '').trim()}||${String(r.app_tx_id || '').trim()}`);
    });
  } catch (e) {}

  const nowIso = new Date().toISOString();
  let inserted = 0;

  for (const m of items) {
    if (!m) continue;
    const matchType = String(m.matchType || 'EXACT');
    const status = String(m.status || 'MATCHED');
    if (status === 'MATCHED_PREV_BATCH' || matchType === 'PREV_BATCH') continue;

    const bank = m.bank || {};
    const app = m.app || {};
    const bankYmd = normalizeDateToYMD(bank.ymd || bank.date);
    const bankAmt = Math.round(Math.abs(Number(bank.amount || 0)));
    const bankType = bank.type === '+' ? '+' : '-';
    const bankNote = String(bank.note || '');
    const bankSig = String(bank.sig || (bankYmd || bankAmt ? `${bankYmd}|${bankAmt}|${bankType}|${bankNote.slice(0, 60)}` : '')).trim();
    const appTxId = String(app.id || m.appTxId || '').trim();
    const pairKey = `${bankSig}||${appTxId}`;
    if (!bankSig && !appTxId) continue;
    if (existingPairs.has(pairKey)) continue;

    await sql`
      INSERT INTO bank_reconciliations (
        batch_id, wallet_id, wallet_name, reconciled_at, reconciled_by,
        bank_signature, app_tx_id, match_type, status,
        bank_date, bank_amount, app_date, app_amount, notes
      ) VALUES (
        ${String(batchId || ('REC_' + Date.now()))},
        ${wId},
        ${wName},
        ${nowIso},
        ${String(reconciledBy || 'App')},
        ${bankSig},
        ${appTxId},
        ${matchType},
        ${status},
        ${String(bank.date || formatYMDToDDMMYYYY(bankYmd) || '')},
        ${bankAmt},
        ${String(app.date || '')},
        ${Math.round(Math.abs(Number(app.amount || 0)))},
        ${String(m.notes || bankNote || app.note || '')}
      )
    `;
    existingPairs.add(pairKey);
    inserted++;

    if (bankSig) {
      const tmpStatus = (matchType === 'MANUAL_SKIP') ? 'IGNORED' : 'PROCESSED';
      await sql`
        UPDATE temp_transactions
        SET status = ${tmpStatus}
        WHERE sig = ${bankSig}
          AND (${wIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${wIdLow} OR LOWER(TRIM(COALESCE(wallet_name, ''))) = ${wNameLow})
          AND status = 'PENDING'
      `.catch(() => {});
    }
  }
  return inserted;
}

// ==========================================
// CÔNG NỢ ĐỊNH KỲ (RECURRING DEBTS)
// ==========================================

const _recurringSchemaEnsuredDbs = new Set();
async function ensureRecurringDebtsSchema(sql, dbKey) {
  const key = String(dbKey || 'DEFAULT');
  if (_recurringSchemaEnsuredDbs.has(key)) return;
  try {
    await Promise.all([
      sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS recurring_id TEXT DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE debts ADD COLUMN IF NOT EXISTS recurring_period TEXT DEFAULT ''`.catch(() => {}),
      sql`CREATE TABLE IF NOT EXISTS recurring_debts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        partner_id TEXT DEFAULT '',
        type TEXT NOT NULL DEFAULT 'TRA',
        amount NUMERIC DEFAULT 0,
        day_of_month INT DEFAULT 1,
        content TEXT DEFAULT '',
        wallet_id TEXT DEFAULT '',
        wallet_name TEXT DEFAULT '',
        is_active BOOLEAN DEFAULT true,
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`.catch(() => {})
    ]);
    _recurringSchemaEnsuredDbs.add(key);
  } catch (e) {
    console.error('ensureRecurringDebtsSchema error:', e);
  }
}

// -------------------------------------------------------------
// ĐỒNG BỘ EMAIL TỰ ĐỘNG (CHỈ DÀNH RIÊNG CHO KIAN - STIEN CÔ LẬP)
// -------------------------------------------------------------
const _kianEmailSyncEnsuredDbs = new Set();
async function ensureKianEmailSyncSchema(sql, dbKey) {
  const key = String(dbKey || 'DEFAULT');
  if (_kianEmailSyncEnsuredDbs.has(key)) return;
  // CÔ LẬP TUYỆT ĐỐI: STien không sử dụng tính năng này
  if (key.toLowerCase().includes('stien')) return;

  try {
    await Promise.all([
      sql`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS linked_email VARCHAR(255) DEFAULT ''`.catch(() => {}),
      sql`ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sender_filter VARCHAR(255) DEFAULT ''`.catch(() => {}),
      sql`CREATE TABLE IF NOT EXISTS kian_email_sync_logs (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        message_id TEXT,
        sender TEXT,
        recipient TEXT,
        subject TEXT,
        raw_body TEXT,
        tx_date DATE,
        merchant TEXT,
        amount NUMERIC,
        direction TEXT DEFAULT 'CHI',
        wallet_id TEXT,
        wallet_name TEXT,
        statement_month TEXT,
        status TEXT DEFAULT 'PENDING',
        linked_tx_id TEXT,
        linked_type TEXT,
        parsed_status TEXT,
        error_message TEXT
      )`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS message_id TEXT`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS tx_date DATE`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS merchant TEXT`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS direction TEXT DEFAULT 'CHI'`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS statement_month TEXT`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING'`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS linked_tx_id TEXT`.catch(() => {}),
      sql`ALTER TABLE kian_email_sync_logs ADD COLUMN IF NOT EXISTS linked_type TEXT`.catch(() => {}),
      sql`CREATE INDEX IF NOT EXISTS idx_kian_email_sync_status ON kian_email_sync_logs(status)`.catch(() => {}),
      sql`CREATE INDEX IF NOT EXISTS idx_kian_email_sync_msg_id ON kian_email_sync_logs(message_id)`.catch(() => {})
    ]);

    _kianEmailSyncEnsuredDbs.add(key);
  } catch (e) {
    console.error('ensureKianEmailSyncSchema error:', e);
  }
}

function parseRakutenEmailText(text) {
  if (!text || typeof text !== 'string') return [];
  const items = [];

  const isRefundOrIncome = /(?:取消|返金|返品|マイナス|入金|振込入金|還付)/i.test(text);

  // 1. Chuẩn hóa: Nếu text chứa HTML, thay <br>, </tr>, </td> bằng newline/tab
  let normalized = text
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');

  const lines = normalized.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Dạng 1: Key-value riêng từng dòng (速報版: 利用日: ... \n 利用先: ... \n 利用金額: ...)
  let curDate = '';
  let curMerchant = '';
  let curAmount = 0;
  let curStatementMonth = '';
  let curDirection = isRefundOrIncome ? 'THU' : 'CHI';
  let curOrderNum = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dM = line.match(/(?:利用日|ご利用日|お取引日|日付)[：:\s]+(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
    if (dM) {
      const p = dM[1].split(/[\/\-]/);
      curDate = `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
    }
    const mM = line.match(/(?:利用先|ご利用先|お取引内容|加盟店名)[：:\s]+(.+)/);
    if (mM) curMerchant = mM[1].trim();

    const aM = line.match(/(?:利用金額|ご利用金額|お支払金額)[：:\s]+([+-]?\s*[0-9,]+)\s*円?/);
    if (aM) {
      const rawAmt = aM[1].replace(/[\s,]/g, '');
      const parsed = parseInt(rawAmt, 10);
      if (!isNaN(parsed)) {
        if (parsed < 0 || aM[1].includes('-')) {
          curDirection = 'THU';
          curAmount = Math.abs(parsed);
        } else {
          curAmount = parsed;
        }
      }
    }

    const sM = line.match(/支払月[：:\s]*(\d{4})[\/\-年](\d{1,2})/);
    if (sM) curStatementMonth = `${sM[1]}-${sM[2].padStart(2, '0')}`;

    const oM = line.match(/(?:ORDER#?|注文番号|注文ID)[：:\s]*([A-Za-z0-9\-]+)/i);
    if (oM) curOrderNum = oM[1].trim();

    if (curDate && curAmount > 0) {
      items.push({
        date: curDate,
        merchant: curMerchant || 'Chi tiêu thẻ',
        amount: curAmount,
        statementMonth: curStatementMonth,
        direction: curDirection,
        orderNum: curOrderNum
      });
      curDate = '';
      curMerchant = '';
      curAmount = 0;
      curStatementMonth = '';
      curDirection = isRefundOrIncome ? 'THU' : 'CHI';
      curOrderNum = '';
    }
  }

  // Dạng 2: Bảng chi tiết dạng dòng ngang hoặc đa dòng (確定版 / 楽天プレミアムカードご利用内容)
  // Dòng 1: 2026/11/16 楽天証券投信積立０．５％～ 30,000 円
  // Hoặc tách thành nhiều dòng:
  // 2026/11/16
  // 楽天証券投信積立０．５％～
  // 30,000 円
  if (items.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const dateMatch = line.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
      if (!dateMatch) continue;

      const p = dateMatch[1].split(/[\/\-]/);
      const date = `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;

      // Trường hợp 2A: Ngày và số tiền nằm trên cùng 1 dòng
      const sameLineAmt = line.match(/([+-]?\s*[0-9,]+)\s*(?:円|¥)/);
      if (sameLineAmt && !line.includes('合計')) {
        const rawAmt = sameLineAmt[1].replace(/[\s,]/g, '');
        let amount = parseInt(rawAmt, 10);
        let direction = isRefundOrIncome ? 'THU' : 'CHI';
        if (amount < 0 || sameLineAmt[1].includes('-')) {
          direction = 'THU';
          amount = Math.abs(amount);
        }

        let merchant = line
          .replace(dateMatch[0], '')
          .replace(sameLineAmt[0], '')
          .replace(/\t/g, ' ')
          .replace(/[\|｜]/g, ' ')
          .trim();

        let statementMonth = '';
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
          const smMatch = lines[j].match(/支払月[：:\s]*(\d{4})[\/\-年](\d{1,2})/);
          if (smMatch) {
            statementMonth = `${smMatch[1]}-${smMatch[2].padStart(2, '0')}`;
            break;
          }
        }

        if (amount > 0) {
          items.push({ date, merchant: merchant || 'Chi tiêu thẻ', amount, statementMonth, direction });
          continue;
        }
      }

      // Trường hợp 2B: Ngày nằm ở 1 dòng, merchant ở dòng sau, số tiền ở dòng tiếp theo
      let merchant = '';
      let amount = 0;
      let statementMonth = '';
      let direction = isRefundOrIncome ? 'THU' : 'CHI';

      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const nextLine = lines[j];
        if (nextLine.includes('合計') || nextLine.match(/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/)) {
          break; // Đã sang hàng tiếp theo hoặc tổng kết
        }

        const amtMatch = nextLine.match(/([+-]?\s*[0-9,]+)\s*(?:円|¥)/);
        if (amtMatch && !amount) {
          const rawAmt = amtMatch[1].replace(/[\s,]/g, '');
          const parsed = parseInt(rawAmt, 10);
          if (!isNaN(parsed) && parsed > 0) {
            amount = parsed;
            if (amtMatch[1].includes('-')) direction = 'THU';
          }
        } else if (!merchant && !nextLine.includes('支払方法') && !nextLine.includes('支払月') && !nextLine.includes('利用者')) {
          merchant = nextLine.trim();
        }

        const smMatch = nextLine.match(/支払月[：:\s]*(\d{4})[\/\-年](\d{1,2})/);
        if (smMatch && !statementMonth) {
          statementMonth = `${smMatch[1]}-${smMatch[2].padStart(2, '0')}`;
        }
      }

      if (date && amount > 0) {
        items.push({ date, merchant: merchant || 'Chi tiêu thẻ', amount, statementMonth, direction });
      }
    }
  }

  return items;
}

async function seedDefaultRecurringDebtsHelper(sql) {
  try {
    await ensureRecurringDebtsSchema(sql).catch(() => {});
    const existing = await sql`SELECT COUNT(*)::int as count FROM recurring_debts`.catch(() => [{ count: 0 }]);
    if (existing && existing[0] && Number(existing[0].count) > 0) {
      return { success: true, count: Number(existing[0].count), message: 'Đã có mẫu định kỳ' };
    }
    const defaultItems = [
      {
        id: 'REC_TIEN_NUOC_1F',
        name: '1F',
        partner_id: '',
        type: 'TRA',
        amount: 0,
        day_of_month: 5,
        content: 'Tiền nước 1F',
        wallet_id: '',
        wallet_name: '',
        is_active: true,
        note: 'Trả tiền nước cho 1F hàng tháng'
      },
      {
        id: 'REC_QUY_NHA_21',
        name: 'Quỹ nhà 21',
        partner_id: '',
        type: 'TRA',
        amount: 0,
        day_of_month: 21,
        content: 'Trích quỹ nhà ngày 21',
        wallet_id: '',
        wallet_name: '',
        is_active: true,
        note: 'Trích quỹ nhà ngày 21 hàng tháng'
      },
      {
        id: 'REC_THU_TIEN_NHA_1F',
        name: '1F',
        partner_id: '',
        type: 'THU',
        amount: 0,
        day_of_month: 1,
        content: 'Thu tiền nhà 1F',
        wallet_id: '',
        wallet_name: '',
        is_active: true,
        note: 'Thu tiền nhà 1F hàng tháng'
      }
    ];

    for (const item of defaultItems) {
      await sql`
        INSERT INTO recurring_debts (id, name, partner_id, type, amount, day_of_month, content, wallet_id, wallet_name, is_active, note)
        VALUES (${item.id}, ${item.name}, ${item.partner_id}, ${item.type}, ${item.amount}, ${item.day_of_month}, ${item.content}, ${item.wallet_id}, ${item.wallet_name}, ${item.is_active}, ${item.note})
        ON CONFLICT (id) DO NOTHING
      `.catch(() => {});
    }
    return { success: true, count: defaultItems.length, message: 'Đã nạp 3 mẫu công nợ định kỳ mặc định' };
  } catch (err) {
    console.error('seedDefaultRecurringDebtsHelper error:', err);
    return { success: false, message: String(err && err.message) };
  }
}

async function getRecurringDebtsHelper(sql, monthArg, yearArg) {
  try {
    await seedDefaultRecurringDebtsHelper(sql).catch(() => {});

    const now = new Date();
    let m = Number(monthArg);
    let y = Number(yearArg);
    if (!m || isNaN(m) || m < 1 || m > 12) m = now.getMonth() + 1;
    if (!y || isNaN(y) || y < 2000 || y > 2100) y = now.getFullYear();
    const period = `${y}-${String(m).padStart(2, '0')}`;

    const [templates, allDebts, catRows, allWallets] = await Promise.all([
      sql`SELECT * FROM recurring_debts ORDER BY day_of_month ASC, id ASC`.catch(() => []),
      (async () => {
        try {
          return await sql`
            SELECT id, date, name, partner_id, content, amount, remaining_debt, type, wallet_id, wallet_name, status, note, recurring_id, recurring_period
            FROM debts
            ORDER BY date DESC, id DESC
          `;
        } catch (err) {
          return await sql`
            SELECT id, date, name, partner_id, content, amount, remaining_debt, type, wallet_id, wallet_name, status, note
            FROM debts
            ORDER BY date DESC, id DESC
          `.catch(() => []);
        }
      })(),
      sql`SELECT id, type, name FROM categories WHERE is_hidden = false ORDER BY id ASC`.catch(() => []),
      sql`SELECT id, name, type FROM wallets`.catch(() => [])
    ]);

    const appCatByIdMap = buildCategoryByIdMap(catRows);
    const allWalletByIdMap = buildWalletByIdMap(allWallets);

    const parseYmFromDate = (dStr) => {
      if (!dStr) return '';
      const s = String(dStr).trim().split('T')[0];
      const p = s.split(/[-/]/);
      if (p.length >= 2) {
        if (p[0].length === 4) return `${p[0]}-${String(parseInt(p[1], 10)).padStart(2, '0')}`;
        if (p.length >= 3 && p[2].length === 4) return `${p[2]}-${String(parseInt(p[1], 10)).padStart(2, '0')}`;
      }
      return '';
    };

    const debtByRecId = new Map();
    const debtByContentInPeriod = new Map();
    const prevAmountByRecId = new Map();
    const prevAmountByContent = new Map();

    for (const d of (allDebts || [])) {
      const rId = String(d.recurring_id || '').trim();
      const dPeriod = String(d.recurring_period || '').trim() || parseYmFromDate(d.date);
      const dContentKey = String(d.content || '').trim().toLowerCase();
      const dAmt = Math.round(Number(d.amount || 0));

      if (dPeriod === period) {
        if (rId && !debtByRecId.has(rId)) {
          debtByRecId.set(rId, d);
        }
        if (dContentKey && dAmt > 0 && !debtByContentInPeriod.has(dContentKey)) {
          debtByContentInPeriod.set(dContentKey, d);
        }
      }

      if (dAmt > 0) {
        if (rId && !prevAmountByRecId.has(rId)) {
          prevAmountByRecId.set(rId, dAmt);
        }
        if (dContentKey && !prevAmountByContent.has(dContentKey)) {
          prevAmountByContent.set(dContentKey, dAmt);
        }
      }
    }

    let pendingCount = 0;
    let totalEstimateThu = 0;
    let totalEstimateTra = 0;

    const items = templates.map(t => {
      const rId = String(t.id);
      const amt = Number(t.amount || 0);
      const day = Number(t.day_of_month || 1);
      const loai = String(t.type || 'TRA').toUpperCase() === 'THU' ? 'THU' : 'TRA';
      const isActive = (t.is_active !== false && String(t.is_active) !== 'false');
      const tContentKey = String(t.content || '').trim().toLowerCase();

      const pCat = t.partner_id ? appCatByIdMap.get(normalizeCategoryId(t.partner_id)) : null;
      const partnerName = pCat ? pCat.name : String(t.name || '').trim();

      const wObj = (t.wallet_id && allWalletByIdMap.get(String(t.wallet_id))) || (t.wallet_name && allWalletByIdMap.get(String(t.wallet_name))) || null;
      const walletId = wObj ? String(wObj.id) : (t.wallet_id || '');
      const walletName = wObj ? wObj.name : (t.wallet_name || '');

      const genDebt = debtByRecId.get(rId) || (tContentKey ? debtByContentInPeriod.get(tContentKey) : null) || null;
      const isGenerated = Boolean(genDebt);
      const isPaid = genDebt ? (String(genDebt.status || '').toUpperCase() === 'DA_TRA' || Number(genDebt.remaining_debt || 0) <= 0) : false;

      const prevAmount = prevAmountByRecId.get(rId)
        || (tContentKey ? prevAmountByContent.get(tContentKey) : 0)
        || (amt > 0 ? amt : 0);

      if (isActive) {
        const estAmt = genDebt ? Number(genDebt.amount || 0) : prevAmount;
        if (loai === 'THU') totalEstimateThu += estAmt;
        else totalEstimateTra += estAmt;

        if (!isGenerated || !isPaid) {
          pendingCount++;
        }
      }

      return {
        id: rId,
        name: partnerName,
        partner_id: t.partner_id || '',
        type: loai,
        amount: amt,
        prevAmount: prevAmount,
        day_of_month: day,
        content: t.content || '',
        wallet_id: walletId,
        wallet_name: walletName,
        is_active: isActive,
        note: t.note || '',
        period: period,
        is_generated: isGenerated,
        is_paid: isPaid,
        generatedDebt: genDebt ? {
          id: genDebt.id,
          date: genDebt.date,
          amount: Number(genDebt.amount || 0),
          remaining_debt: Number(genDebt.remaining_debt || 0),
          status: genDebt.status || 'DANG_NO',
          wallet_id: genDebt.wallet_id || '',
          wallet_name: genDebt.wallet_name || ''
        } : null
      };
    });

    return {
      success: true,
      period: period,
      month: m,
      year: y,
      items: items,
      pendingCount: pendingCount,
      totalEstimate: {
        thu: totalEstimateThu,
        tra: totalEstimateTra,
        net: totalEstimateThu - totalEstimateTra
      }
    };
  } catch (err) {
    console.error('getRecurringDebtsHelper error:', err);
    return { success: false, items: [], pendingCount: 0, message: String(err && err.message) };
  }
}

async function saveRecurringDebtHelper(sql, payload = {}) {
  try {
    const rawName = String(payload.name || payload.ten || '').trim();
    if (!rawName) {
      return { success: false, message: 'Vui lòng nhập tên đối tượng hoặc khoản nợ!' };
    }
    const type = String(payload.type || payload.loai || 'TRA').toUpperCase() === 'THU' ? 'THU' : 'TRA';
    const amount = Number(payload.amount ?? payload.sotien ?? 0);
    const day = Math.min(31, Math.max(1, Number(payload.day_of_month ?? payload.day ?? 1)));
    const content = String(payload.content ?? payload.noidung ?? '').trim();
    const rawWalletId = String(payload.wallet_id ?? payload.walletId ?? '').trim();
    const rawWalletName = String(payload.wallet_name ?? payload.nguon ?? '').trim();
    const resolvedW = (rawWalletId || rawWalletName) ? await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName }) : null;
    const walletId = resolvedW ? String(resolvedW.id) : rawWalletId;
    const walletName = resolvedW ? resolvedW.name : rawWalletName;
    const isActive = payload.is_active !== undefined ? (payload.is_active !== false && String(payload.is_active) !== 'false') : true;
    const note = String(payload.note ?? payload.ghichu ?? '').trim();
    const existingId = String(payload.id || '').trim();

    const catRows = await sql`SELECT id, type, name FROM categories WHERE type IN ('PARTNER', 'FAMILY') ORDER BY id ASC`.catch(() => []);
    let matchedPartner = resolveCategoryByIdOrName(catRows, ['PARTNER', 'FAMILY'], { id: payload.partner_id, name: rawName });
    if (!matchedPartner && rawName) {
      matchedPartner = await ensureCategoryExistsByName(sql, catRows, 'PARTNER', rawName).catch(() => null);
    }
    const finalPartnerName = matchedPartner ? matchedPartner.name : rawName;
    const finalPartnerId = matchedPartner ? String(matchedPartner.id) : (payload.partner_id || '');

    let savedId = existingId;
    if (existingId) {
      await sql`
        UPDATE recurring_debts SET
          name = ${finalPartnerName},
          partner_id = ${finalPartnerId},
          type = ${type},
          amount = ${amount},
          day_of_month = ${day},
          content = ${content},
          wallet_id = ${walletId},
          wallet_name = ${walletName},
          is_active = ${isActive},
          note = ${note},
          updated_at = NOW()
        WHERE id = ${existingId}
      `;
    } else {
      savedId = 'REC_' + Date.now().toString().slice(-6) + Math.floor(100 + Math.random() * 900);
      await sql`
        INSERT INTO recurring_debts (id, name, partner_id, type, amount, day_of_month, content, wallet_id, wallet_name, is_active, note)
        VALUES (${savedId}, ${finalPartnerName}, ${finalPartnerId}, ${type}, ${amount}, ${day}, ${content}, ${walletId}, ${walletName}, ${isActive}, ${note})
      `;
    }

    return {
      success: true,
      message: 'Đã lưu mẫu công nợ định kỳ thành công!',
      item: {
        id: savedId,
        name: finalPartnerName,
        partner_id: finalPartnerId,
        type: type,
        amount: amount,
        day_of_month: day,
        content: content,
        wallet_id: walletId,
        wallet_name: walletName,
        is_active: isActive,
        note: note
      }
    };
  } catch (err) {
    console.error('saveRecurringDebtHelper error:', err);
    return { success: false, message: String(err && err.message) };
  }
}

async function deleteRecurringDebtHelper(sql, id) {
  try {
    const rawId = String(id || '').trim();
    if (!rawId) return { success: false, message: 'Thiếu mã mẫu công nợ định kỳ!' };
    await sql`DELETE FROM recurring_debts WHERE id = ${rawId}`;
    return { success: true, message: 'Đã xóa mẫu công nợ định kỳ thành công!' };
  } catch (err) {
    console.error('deleteRecurringDebtHelper error:', err);
    return { success: false, message: String(err && err.message) };
  }
}

async function toggleRecurringDebtHelper(sql, id, isActive) {
  try {
    const rawId = String(id || '').trim();
    if (!rawId) return { success: false, message: 'Thiếu mã mẫu công nợ định kỳ!' };
    const boolActive = (isActive !== false && String(isActive) !== 'false');
    await sql`UPDATE recurring_debts SET is_active = ${boolActive}, updated_at = NOW() WHERE id = ${rawId}`;
    return { success: true, message: 'Đã cập nhật trạng thái hoạt động!' };
  } catch (err) {
    console.error('toggleRecurringDebtHelper error:', err);
    return { success: false, message: String(err && err.message) };
  }
}

async function generateRecurringDebtHelper(sql, payload = {}) {
  try {
    const recId = String(payload.recurring_id || payload.id || '').trim();
    if (!recId) return { success: false, message: 'Vui lòng chọn mẫu công nợ định kỳ cần ghi nhận!' };

    const rows = await sql`SELECT * FROM recurring_debts WHERE id = ${recId} LIMIT 1`;
    if (!rows || rows.length === 0) {
      return { success: false, message: 'Không tìm thấy mẫu công nợ định kỳ!' };
    }
    const t = rows[0];

    const now = new Date();
    let m = Number(payload.month);
    let y = Number(payload.year);
    if (!m || isNaN(m) || m < 1 || m > 12) m = now.getMonth() + 1;
    if (!y || isNaN(y) || y < 2000 || y > 2100) y = now.getFullYear();
    const period = `${y}-${String(m).padStart(2, '0')}`;

    const existingDebts = await sql`
      SELECT id, status, remaining_debt, amount
      FROM debts
      WHERE recurring_id = ${recId} AND (recurring_period = ${period} OR date LIKE ${period + '%'})
      LIMIT 1
    `;

    const autoSettle = Boolean(payload.autoSettle);
    const amount = Math.round(Number(payload.newAmount ?? payload.amount ?? payload.sotien ?? t.amount ?? 0));
    if (amount <= 0 && !payload.allowZero) {
      return { success: false, message: 'Vui lòng nhập số tiền (> 0 ¥) cho khoản công nợ định kỳ này!' };
    }

    const day = Math.min(31, Math.max(1, Number(payload.day_of_month || t.day_of_month || 1)));
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    const actualDay = Math.min(day, lastDayOfMonth);
    const customDate = (payload.newDate || payload.date) ? normalizeIsoDate(payload.newDate || payload.date) : '';
    const debtDate = customDate || `${period}-${String(actualDay).padStart(2, '0')}`;

    const hasExplicitSource = (payload.newSource !== undefined || payload.wallet_name !== undefined || payload.wallet_id !== undefined || payload.settleWalletId !== undefined || payload.settleWalletName !== undefined);
    const rawWId = hasExplicitSource
      ? String(payload.wallet_id || payload.settleWalletId || '').trim()
      : String(t.wallet_id || '').trim();
    const rawWName = hasExplicitSource
      ? String(payload.newSource ?? payload.wallet_name ?? payload.settleWalletName ?? '').trim()
      : String(t.wallet_name || '').trim();
    const resolvedW = (rawWId || rawWName) ? await findWalletByOrderName(sql, { walletId: rawWId, walletName: rawWName }) : null;
    const walletId = resolvedW ? String(resolvedW.id) : rawWId;
    const walletName = resolvedW ? resolvedW.name : rawWName;

    const loai = String(t.type || 'TRA').toUpperCase() === 'THU' ? 'THU' : 'TRA';
    const content = String(payload.content || t.content || '').trim() || (loai === 'THU' ? `Thu định kỳ ${period}` : `Chi trả định kỳ ${period}`);
    const note = String(payload.note || t.note || '').trim();

    const updatedWallets = [];

    // Nếu đã tồn tại bản ghi trong tháng
    if (existingDebts.length > 0) {
      const ex = existingDebts[0];
      if (!autoSettle) {
        return { success: false, message: `Khoản nợ định kỳ này đã được ghi nhận trước đó cho kỳ ${period} (Mã: ${ex.id})!` };
      }
      // Nếu yêu cầu thanh toán ngay mà đã có bản ghi nợ
      if (ex.status === 'DA_TRA' || Number(ex.remaining_debt || 0) <= 0) {
        return { success: true, message: `Khoản nợ này đã được thanh toán hoàn tất cho kỳ ${period}!`, debtId: ex.id };
      }
      // Thanh toán nợ hiện có
      const payAmt = Number(ex.remaining_debt || amount);
      await sql`
        UPDATE debts
        SET remaining_debt = 0, status = 'DA_TRA', note = COALESCE(note, '') || '; TT định kỳ ' || ${debtDate}
        WHERE id = ${ex.id}
      `;
      if (resolvedW && payAmt > 0) {
        const curBal = Number(resolvedW.current_balance || 0);
        const delta = (loai === 'THU') ? payAmt : -payAmt;
        const newBal = curBal + delta;
        await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${resolvedW.id}`;
        updatedWallets.push({ id: resolvedW.id, name: resolvedW.name, current_balance: newBal, balance: newBal });
        const isCreditSettle = String(resolvedW.type || '').toUpperCase() === 'CREDIT';
        await upsertWalletLedgerEntry(sql, {
          date: debtDate,
          walletId: String(resolvedW.id),
          walletName: resolvedW.name,
          eventType: loai === 'THU' ? 'COLLECT_LOAN' : 'REPAY_LOAN',
          effectType: isCreditSettle ? 'CARD_DEBT' : 'CASH',
          amount: payAmt,
          balanceAfter: newBal,
          note: `[Định kỳ ${period}] ${loai === 'THU' ? '[Thu nợ]' : '[Trả nợ]'} ${t.name}${content ? ' (' + content + ')' : ''}`,
          orderId: ex.id,
          status: 'POSTED',
          direction: loai === 'THU' ? (isCreditSettle ? 'DECREASE' : 'IN') : (isCreditSettle ? 'INCREASE' : 'OUT'),
          sourceModule: 'Debt'
        });
      }
      return {
        success: true,
        message: `Đã thanh toán khoản nợ định kỳ cho kỳ ${period}!`,
        debtId: ex.id,
        updatedWallets
      };
    }

    // Tạo bản ghi công nợ mới
    const newDebtId = 'CN_REC_' + y + String(m).padStart(2, '0') + '_' + Math.floor(1000 + Math.random() * 9000);
    const initialStatus = autoSettle ? 'DA_TRA' : 'DANG_NO';
    const remainingDebt = autoSettle ? 0 : amount;

    await sql`
      INSERT INTO debts (
        id, date, name, partner_id, type, content, amount, remaining_debt,
        wallet_id, wallet_name, status, note, recurring_id, recurring_period
      ) VALUES (
        ${newDebtId}, ${debtDate}, ${t.name}, ${t.partner_id || null}, ${loai}, ${content}, ${amount}, ${remainingDebt},
        ${walletId}, ${walletId || ''}, ${initialStatus}, ${note}, ${recId}, ${period}
      )
    `;

    // Cập nhật số dư ví nếu autoSettle hoặc ghi nợ có ví
    if (resolvedW && amount > 0) {
      const curBal = Number(resolvedW.current_balance || 0);
      let delta = 0;
      let evtType = '';
      let dir = '';
      const isCredit = String(resolvedW.type || '').toUpperCase() === 'CREDIT';

      if (autoSettle) {
        delta = (loai === 'THU') ? amount : -amount;
        evtType = (loai === 'THU') ? 'COLLECT_LOAN' : 'REPAY_LOAN';
        dir = (loai === 'THU') ? (isCredit ? 'DECREASE' : 'IN') : (isCredit ? 'INCREASE' : 'OUT');
      } else {
        delta = (loai === 'THU') ? -amount : amount;
        evtType = (loai === 'THU') ? 'LEND_MONEY' : 'BORROW_MONEY';
        dir = (loai === 'THU') ? (isCredit ? 'INCREASE' : 'OUT') : (isCredit ? 'DECREASE' : 'IN');
      }

      const newBal = curBal + delta;
      await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${resolvedW.id}`;
      updatedWallets.push({ id: resolvedW.id, name: resolvedW.name, current_balance: newBal, balance: newBal });

      const recDebtStmtDate = isCredit ? (getCardDefaultPaymentStatementMonth(debtDate, resolvedW.closing_date) + '-01') : '';
      await upsertWalletLedgerEntry(sql, {
        date: debtDate,
        statementDate: recDebtStmtDate,
        walletId: String(resolvedW.id),
        walletName: resolvedW.name,
        eventType: evtType,
        effectType: isCredit ? 'CARD_DEBT' : 'CASH',
        amount: amount,
        balanceAfter: newBal,
        note: `[Định kỳ ${period}] ${loai === 'THU' ? (autoSettle ? '[Thu nợ]' : '[Cho vay]') : (autoSettle ? '[Trả nợ]' : '[Đi vay]')} ${t.name}${content ? ' (' + content + ')' : ''}`,
        orderId: newDebtId,
        status: 'POSTED',
        direction: dir,
        sourceModule: 'Debt'
      });
    }

    return {
      success: true,
      message: autoSettle ? `Đã ghi nhận và thanh toán xong công nợ định kỳ kỳ ${period}!` : `Đã ghi nhận công nợ định kỳ vào sổ nợ kỳ ${period}!`,
      debtId: newDebtId,
      period: period,
      updatedWallets
    };
  } catch (err) {
    console.error('generateRecurringDebtHelper error:', err);
    return { success: false, message: String(err && err.message) };
  }
}

async function generateAllRecurringDebtsHelper(sql, monthArg, yearArg) {
  try {
    const now = new Date();
    let m = Number(monthArg);
    let y = Number(yearArg);
    if (!m || isNaN(m) || m < 1 || m > 12) m = now.getMonth() + 1;
    if (!y || isNaN(y) || y < 2000 || y > 2100) y = now.getFullYear();
    const period = `${y}-${String(m).padStart(2, '0')}`;

    const [activeTemplates, debtsInPeriod] = await Promise.all([
      sql`SELECT * FROM recurring_debts WHERE is_active = true ORDER BY day_of_month ASC, id ASC`.catch(() => []),
      sql`
        SELECT recurring_id FROM debts
        WHERE recurring_period = ${period} OR (COALESCE(recurring_id, '') != '' AND date LIKE ${period + '%'})
      `.catch(() => [])
    ]);

    const generatedRecIds = new Set(debtsInPeriod.map(d => String(d.recurring_id || '').trim()).filter(Boolean));
    const pendingTemplates = activeTemplates.filter(t => !generatedRecIds.has(String(t.id)));

    if (pendingTemplates.length === 0) {
      return {
        success: true,
        count: 0,
        period: period,
        message: `Tất cả các khoản nợ định kỳ đã được ghi nhận cho kỳ ${period}!`
      };
    }

    const lastDayOfMonth = new Date(y, m, 0).getDate();
    let count = 0;

    for (let i = 0; i < pendingTemplates.length; i++) {
      const t = pendingTemplates[i];
      const day = Math.min(31, Math.max(1, Number(t.day_of_month || 1)));
      const actualDay = Math.min(day, lastDayOfMonth);
      const debtDate = `${period}-${String(actualDay).padStart(2, '0')}`;
      const loai = String(t.type || 'TRA').toUpperCase() === 'THU' ? 'THU' : 'TRA';
      const amount = Number(t.amount || 0);
      const content = String(t.content || '').trim() || (loai === 'THU' ? `Thu định kỳ ${period}` : `Chi trả định kỳ ${period}`);
      const newDebtId = 'CN_REC_' + y + String(m).padStart(2, '0') + '_' + Math.floor(1000 + Math.random() * 9000) + '_' + (i + 1);

      await sql`
        INSERT INTO debts (
          id, date, name, partner_id, type, content, amount, remaining_debt,
          wallet_id, wallet_name, status, note, recurring_id, recurring_period
        ) VALUES (
          ${newDebtId}, ${debtDate}, ${t.name}, ${t.partner_id || null}, ${loai}, ${content}, ${amount}, ${amount},
          ${t.wallet_id || ''}, ${t.wallet_id || ''}, 'DANG_NO', ${t.note || ''}, ${t.id}, ${period}
        )
      `;
      count++;
    }

    return {
      success: true,
      count: count,
      period: period,
      message: `Đã tự động ghi nhận ${count} khoản công nợ định kỳ cho kỳ ${period}!`
    };
  } catch (err) {
    console.error('generateAllRecurringDebtsHelper error:', err);
    return { success: false, message: String(err && err.message) };
  }
}

async function saveBatchQuickRecurringDebtsHelper(sql, items = [], monthArg, yearArg, defaultAutoSettle = false) {
  try {
    const list = Array.isArray(items) ? items : [];
    let savedCount = 0;
    const allUpdatedWallets = [];
    const errors = [];

    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {};
      const amt = Math.round(Number(it.newAmount ?? it.amount ?? it.sotien ?? 0));
      if (amt <= 0) continue;

      const res = await generateRecurringDebtHelper(sql, {
        ...it,
        newAmount: amt,
        amount: amt,
        month: it.month || monthArg,
        year: it.year || yearArg,
        autoSettle: it.autoSettle !== undefined ? Boolean(it.autoSettle) : Boolean(defaultAutoSettle)
      });

      if (res && res.success) {
        savedCount++;
        if (Array.isArray(res.updatedWallets)) {
          allUpdatedWallets.push(...res.updatedWallets);
        }
      } else if (res && res.message) {
        errors.push(res.message);
      }
    }

    if (savedCount === 0) {
      return {
        success: false,
        message: errors.length > 0 ? errors[0] : 'Vui lòng nhập số tiền (> 0 ¥) cho ít nhất 1 khoản công nợ định kỳ!'
      };
    }

    return {
      success: true,
      count: savedCount,
      updatedWallets: allUpdatedWallets,
      message: defaultAutoSettle
        ? `✅ Đã ghi nhận và thanh toán thành công ${savedCount} khoản công nợ định kỳ!`
        : `✅ Đã ghi nhận vào sổ nợ ${savedCount} khoản công nợ định kỳ!`
    };
  } catch (err) {
    console.error('saveBatchQuickRecurringDebtsHelper error:', err);
    return { success: false, message: String(err && err.message) };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const body = req.body || {};
  let action = body.action;
  let args = body.args || [];

  // Hỗ trợ Direct Webhook (Cloudflare Email Worker, Google Apps Script, Zapier, Make, v.v.)
  if (!action && (body.rawEmail || body.emailText || body.text || body.body || body.from || body.sender || req.query.webhook === 'email')) {
    action = 'syncEmailTransactions';
    args = [body];
  }
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const session = parseSessionToken(token);

  try {
    const targetDbKey = session ? session.dbTarget : 'KIAN_DATABASE_URL';
    const isKian = !String(targetDbKey).toLowerCase().includes('stien');
    const sql = getTargetDb(targetDbKey);

    // Đảm bảo schema công nợ định kỳ và các cột mới trên debts luôn sẵn sàng
    await ensureRecurringDebtsSchema(sql, targetDbKey).catch(() => {});
    if (isKian) {
      await ensureKianEmailSyncSchema(sql, targetDbKey).catch(() => {});
    }

    switch (action) {
      case 'ping': {
        const masterSql = getMasterDb();
        const testRes = await masterSql`SELECT COUNT(*) as count FROM master_users`;
        return res.status(200).json({
          success: true,
          message: 'Pong from Vercel Master Router!',
          registeredUsers: Number(testRes[0].count)
        });
      }

      // 1. ĐĂNG NHẬP XÁC THỰC QUA MASTER DATA
      case 'loginUser':
      case 'authenticateUser': {
        const [username, password] = args;
        const u = String(username || '').trim().toLowerCase();
        const p = String(password || '').trim();

        if (!u || !p) {
          return res.status(200).json({ success: false, message: 'Vui lòng nhập Tên đăng nhập và Mật khẩu!' });
        }

        const masterSql = getMasterDb();
        const rows = await masterSql`
          SELECT user_id, username, password_hash, display_name, database_target, role, status, features
          FROM master_users 
          WHERE LOWER(username) = ${u}
          LIMIT 1
        `;

        if (rows.length === 0) {
          return res.status(200).json({ success: false, message: 'Tên đăng nhập không tồn tại trong hệ thống Master!' });
        }

        const user = rows[0];
        if (user.status !== 'ACTIVE') {
          return res.status(200).json({ success: false, message: 'Tài khoản này đang bị tạm khóa!' });
        }

        const pHash = hashPassword(p);
        const isMatch = (user.password_hash === p || user.password_hash === pHash);
        if (!isMatch) {
          return res.status(200).json({ success: false, message: 'Mật khẩu không chính xác!' });
        }

        try {
          await masterSql`UPDATE master_users SET last_login_at = NOW() WHERE user_id = ${user.user_id}`;
        } catch(e) {}

        const sessionToken = createSessionToken(user);

        return res.status(200).json({
          success: true,
          user: {
            id: user.user_id,
            username: user.username,
            name: user.display_name || user.username,
            role: user.role,
            features: user.features || 'ALL',
            spreadsheetId: user.database_target
          },
          token: sessionToken
        });
      }

      // 1B. ĐỒNG BỘ GIAO DỊCH TỰ ĐỘNG TỪ EMAIL (RAKUTEN CARD / NGÂN HÀNG - DÀNH CHO KIAN)
      case 'syncEmailTransactions': {
        const payload = args[0] || {};
        const apiKey = String(payload.apiKey || '').trim();
        if (apiKey !== 'KIAN_FIN_2026' && (!session || !session.username)) {
          return res.status(200).json({ success: false, message: 'API Key hoặc phiên làm việc không hợp lệ!' });
        }

        const rawText = String(payload.rawEmail || payload.emailText || payload.text || payload.body || '').trim();
        const fromAddr = String(payload.from || payload.sender || '').trim().toLowerCase();
        const toAddr = String(payload.to || payload.recipient || '').trim().toLowerCase();
        const subject = String(payload.subject || '').trim();

        // 1. Kiểm tra mã xác nhận chuyển tiếp của Gmail
        if (rawText && (rawText.includes('Confirmation code') || rawText.includes('Forwarding Confirmation') || rawText.includes('xác nhận chuyển tiếp') || subject.includes('Forwarding Confirmation'))) {
          const codeM = rawText.match(/(?:Confirmation code|Mã xác nhận)[：:\s]*([0-9]{8,12})/i) || rawText.match(/\b([0-9]{9,10})\b/);
          const confCode = codeM ? codeM[1] : '';
          if (confCode) {
            await sql`
              INSERT INTO kian_email_sync_logs (sender, recipient, subject, raw_body, parsed_status, error_message)
              VALUES (${fromAddr || 'Google'}, ${toAddr || ''}, ${subject || 'Gmail Confirmation'}, ${rawText.slice(0, 500)}, 'CONFIRMATION_CODE', ${confCode})
            `.catch(() => {});
            return res.status(200).json({
              success: true,
              isConfirmation: true,
              code: confCode,
              message: `Mã xác nhận chuyển tiếp Gmail của bạn là: ${confCode}`
            });
          }
        }

        let items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length === 0 && rawText) {
          items = parseRakutenEmailText(rawText);
        }

        if (items.length === 0) {
          // Lưu vào log với trạng thái PARSE_FAILED để người dùng thấy trên app và biết email chưa được bóc tách
          await sql`
            INSERT INTO kian_email_sync_logs (sender, recipient, subject, raw_body, parsed_status, error_message)
            VALUES (${fromAddr || 'Unknown'}, ${toAddr || ''}, ${subject || 'Email giao dịch'}, ${rawText.slice(0, 1000)}, 'PARSE_FAILED', 'Không tự động nhận diện được định dạng bảng hoặc mẫu giao dịch')
          `.catch(() => {});
          return res.status(200).json({
            success: false,
            message: 'Không tìm thấy thông tin giao dịch trong nội dung email này.',
            addedCount: 0,
            skippedCount: 0
          });
        }

        // 2. Xác định Ví / Thẻ mục tiêu dựa trên cài đặt email
        let rawCardName = String(payload.cardName || '').trim();
        let rawCardId = String(payload.cardId || '').trim();
        let cardW = null;

        if (rawCardId || rawCardName) {
          cardW = await findWalletByOrderName(sql, { walletId: rawCardId, walletName: rawCardName });
        }

        if (!cardW) {
          const allKianWallets = await sql`
            SELECT id, name, type, credit_limit, debt, preorder, closing_date, current_balance,
                   COALESCE(linked_email, '') as linked_email, COALESCE(sender_filter, '') as sender_filter
            FROM wallets
            WHERE is_deleted = false AND is_hidden = false
          `.catch(() => []);

          // Tìm theo sender_filter và linked_email
          const combinedBody = (rawText + ' ' + fromAddr + ' ' + toAddr + ' ' + subject).toLowerCase();
          
          for (const w of allKianWallets) {
            const sf = String(w.sender_filter || '').trim().toLowerCase();
            const le = String(w.linked_email || '').trim().toLowerCase();
            if (!sf) continue;

            const matchSender = fromAddr.includes(sf) || combinedBody.includes(sf);
            if (!matchSender) continue;

            if (le) {
              const emails = le.split(',').map(e => e.trim()).filter(Boolean);
              const matchOwner = emails.some(e => toAddr.includes(e) || combinedBody.includes(e));
              if (matchOwner) {
                cardW = w;
                break;
              }
            } else {
              cardW = w;
              break;
            }
          }

          // Fallback nhận diện thông minh theo chủ thẻ & ngân hàng
          if (!cardW) {
            const isChi = combinedBody.includes('pham ngoc chi') || combinedBody.includes('kichukuchu') || combinedBody.includes('nonhathanhtinh');
            if (combinedBody.includes('rakuten-card') || combinedBody.includes('楽天カード')) {
              cardW = allKianWallets.find(w => String(w.name).toLowerCase() === (isChi ? 'c- raku chi' : 'c- raku ka'));
            } else if (combinedBody.includes('rakuten-bank') || combinedBody.includes('楽天銀行')) {
              cardW = allKianWallets.find(w => String(w.name).toLowerCase() === (isChi ? 'rakub chi' : 'rakub ka'));
            } else if (combinedBody.includes('resonabank') || combinedBody.includes('りそな')) {
              cardW = allKianWallets.find(w => String(w.name).toLowerCase() === 'resona');
            } else if (combinedBody.includes('smbc')) {
              cardW = allKianWallets.find(w => String(w.name).toLowerCase() === 'smbc');
            }
          }
        }

        if (!cardW) {
          return res.status(200).json({
            success: false,
            message: `Không tìm thấy thẻ/ví tương ứng với email này. Vui lòng thiết lập "Email chủ thẻ" hoặc "Email ngân hàng" trong cài đặt thẻ!`
          });
        }

        const isCredit = (String(cardW.type || '').toUpperCase() === 'CREDIT');
        let addedCount = 0;
        let skippedCount = 0;
        let updatedCount = 0;

        for (const it of items) {
          const amt = Math.round(Number(it.amount || 0));
          const txDate = normalizeIsoDate(it.date) || new Date().toISOString().slice(0, 10);
          const merchant = String(it.merchant || ('Chi tiêu ' + cardW.name)).trim();
          const emailId = String(it.emailId || payload.messageId || it.orderNum || '').trim();
          const direction = String(it.direction || 'CHI').toUpperCase();
          const stmtMonth = String(it.statementMonth || '').trim();

          if (amt <= 0) continue;

          // 1. Kiểm tra chống trùng lặp qua message_id nếu có
          if (emailId) {
            const existingMsg = await sql`
              SELECT id, status FROM kian_email_sync_logs
              WHERE message_id = ${emailId}
              LIMIT 1
            `.catch(() => []);
            if (existingMsg.length > 0) {
              skippedCount++;
              continue;
            }
          }

          // 2. Kiểm tra nếu giao dịch đã được ghi sổ trước đó
          const existingLedger = await sql`
            SELECT id FROM wallet_ledger
            WHERE (wallet_id = ${String(cardW.id)} OR LOWER(wallet_name) = ${String(cardW.name).toLowerCase()})
              AND transaction_date = ${txDate}
              AND amount = ${amt}
              AND (note ILIKE ${'%' + merchant + '%'} OR (order_id IS NOT NULL AND order_id = ${'TC_EM_' + emailId}))
            LIMIT 1
          `.catch(() => []);

          if (existingLedger.length > 0) {
            skippedCount++;
            continue;
          }

          // 3. Kiểm tra xem đã có bản ghi PENDING (chờ duyệt) nào cùng ví, ngày, số tiền chưa (VD: Bản 速報版 và 正式版)
          const existingPending = await sql`
            SELECT id, merchant FROM kian_email_sync_logs
            WHERE status = 'PENDING'
              AND wallet_id = ${String(cardW.id)}
              AND tx_date = ${txDate}
              AND amount = ${amt}
            LIMIT 1
          `.catch(() => []);

          if (existingPending.length > 0) {
            const curP = existingPending[0];
            // Nếu bản ghi cũ chung chung (như 国内加盟店利用) mà bản mới có tên cụ thể hơn, cập nhật nội dung
            const oldM = String(curP.merchant || '').toLowerCase();
            const isOldGeneric = oldM.includes('加盟店') || oldM.includes('chi tiêu') || oldM.includes('thẻ');
            if (isOldGeneric && merchant && !merchant.includes('加盟店')) {
              await sql`
                UPDATE kian_email_sync_logs
                SET merchant = ${merchant},
                    statement_month = COALESCE(NULLIF(${stmtMonth}, ''), statement_month),
                    raw_body = ${rawText.slice(0, 1000)}
                WHERE id = ${curP.id}
              `.catch(() => {});
              updatedCount++;
            } else {
              skippedCount++;
            }
            continue;
          }

          // 4. Lưu vào hàng đợi Chờ Duyệt (Inbox)
          await sql`
            INSERT INTO kian_email_sync_logs (
              message_id, sender, recipient, subject, raw_body,
              tx_date, merchant, amount, direction,
              wallet_id, wallet_name, statement_month,
              status, parsed_status
            )
            VALUES (
              ${emailId || null}, ${fromAddr || 'Webhook/Paste'}, ${toAddr || ''}, ${subject || 'Giao dịch thẻ'}, ${rawText.slice(0, 1000)},
              ${txDate}, ${merchant}, ${amt}, ${direction},
              ${String(cardW.id)}, ${String(cardW.name)}, ${stmtMonth || null},
              'PENDING', 'SUCCESS'
            )
          `.catch(() => {});

          addedCount++;
        }

        // Lấy danh sách PENDING mới nhất trả về
        const pendingRows = await sql`
          SELECT id, TO_CHAR(tx_date, 'YYYY-MM-DD') as tx_date, merchant, amount, direction, wallet_id, wallet_name, statement_month, raw_body, created_at
          FROM kian_email_sync_logs
          WHERE status = 'PENDING'
          ORDER BY tx_date DESC, id DESC
          LIMIT 50
        `.catch(() => []);

        return res.status(200).json({
          success: true,
          message: `Đã đưa ${addedCount} giao dịch vào Hộp Thư Chờ Duyệt (Bỏ qua ${skippedCount} giao dịch trùng, Cập nhật ${updatedCount} giao dịch)!`,
          walletName: cardW.name,
          walletType: cardW.type,
          addedCount,
          skippedCount,
          updatedCount,
          pendingItems: pendingRows
        });
      }

      // 1B-2. LẤY DANH SÁCH EMAIL GIAO DỊCH CHỜ DUYỆT (KIAN ONLY)
      case 'getKianPendingEmailTransactions': {
        const uLower = session ? String(session.username || '').toLowerCase() : '';
        if (!isKian || uLower.includes('tien') || uLower.includes('stien')) {
          return res.status(200).json({
            success: true,
            items: []
          });
        }
        const rows = await sql`
          SELECT id, TO_CHAR(tx_date, 'YYYY-MM-DD') as tx_date, merchant, amount, direction, wallet_id, wallet_name, statement_month, raw_body, created_at
          FROM kian_email_sync_logs
          WHERE status = 'PENDING'
          ORDER BY tx_date DESC, id DESC
          LIMIT 50
        `.catch(() => []);
        return res.status(200).json({
          success: true,
          items: rows
        });
      }

      // 1B-3. CẬP NHẬT TRẠNG THÁI GIAO DỊCH EMAIL (PROCESSED / DISMISSED)
      case 'updateKianEmailLogStatus': {
        const uLower = session ? String(session.username || '').toLowerCase() : '';
        if (!isKian || uLower.includes('tien') || uLower.includes('stien')) {
          return res.status(200).json({ success: false, message: 'Tính năng chỉ dành cho Kian' });
        }
        const payload = args[0] || {};
        const logId = parseInt(payload.id || payload.logId, 10);
        const newStatus = String(payload.status || 'PROCESSED').toUpperCase();
        const linkedTxId = String(payload.linkedTxId || payload.txId || '').trim();
        const linkedType = String(payload.linkedType || payload.type || '').trim();

        if (!logId) {
          return res.status(200).json({ success: false, message: 'Thiếu ID bản ghi email!' });
        }

        await sql`
          UPDATE kian_email_sync_logs
          SET status = ${newStatus},
              linked_tx_id = ${linkedTxId || null},
              linked_type = ${linkedType || null}
          WHERE id = ${logId}
        `.catch(() => {});

        return res.status(200).json({
          success: true,
          message: 'Đã cập nhật trạng thái email thành công!'
        });
      }

      // 1B-4. BỎ QUA EMAIL GIAO DỊCH (DISMISS)
      case 'dismissKianEmailLog': {
        const payload = args[0] || {};
        const logId = parseInt(payload.id || payload.logId || args[0], 10);
        if (!logId) {
          return res.status(200).json({ success: false, message: 'Thiếu ID bản ghi email!' });
        }

        await sql`
          UPDATE kian_email_sync_logs
          SET status = 'DISMISSED'
          WHERE id = ${logId}
        `.catch(() => {});

        return res.status(200).json({
          success: true,
          message: 'Đã bỏ qua email thành công!'
        });
      }

      // 1C. LẤY MÃ XÁC NHẬN CHUYỂN TIẾP GMAIL MỚI NHẤT
      case 'getLatestEmailConfirmationCode': {
        const rows = await sql`
          SELECT error_message as code, created_at, sender, recipient
          FROM kian_email_sync_logs
          WHERE parsed_status = 'CONFIRMATION_CODE'
          ORDER BY id DESC
          LIMIT 1
        `.catch(() => []);
        return res.status(200).json({
          success: true,
          latestConfirmation: rows[0] || null
        });
      }

      // 2. ĐỔI MẬT KHẨU TẠI MASTER DATA
      case 'changeUserPassword': {
        const [username, oldPass, newPass] = args;
        const u = String(username || '').trim().toLowerCase();
        const oldP = String(oldPass || '').trim();
        const newP = String(newPass || '').trim();

        if (!newP || newP.length < 4) {
          return res.status(200).json({ success: false, message: 'Mật khẩu mới phải có ít nhất 4 ký tự!' });
        }

        const masterSql = getMasterDb();
        const rows = await masterSql`SELECT user_id, password_hash FROM master_users WHERE LOWER(username) = ${u} LIMIT 1`;
        if (rows.length === 0) {
          return res.status(200).json({ success: false, message: 'Tài khoản không tồn tại!' });
        }

        const user = rows[0];
        const oldHash = hashPassword(oldP);
        if (user.password_hash !== oldP && user.password_hash !== oldHash) {
          return res.status(200).json({ success: false, message: 'Mật khẩu cũ không đúng!' });
        }

        const newHash = hashPassword(newP);
        await masterSql`UPDATE master_users SET password_hash = ${newHash} WHERE user_id = ${user.user_id}`;
        return res.status(200).json({ success: true, message: 'Đổi mật khẩu thành công!' });
      }

      // 2B. QUẢN LÝ NGƯỜI DÙNG (CHỈ ADMIN)
      case 'adminGetUsers': {
        const masterSql = getMasterDb();
        const adminUser = await verifyAdminAccess(session, masterSql);
        if (!adminUser) {
          return res.status(403).json({ success: false, message: 'Bạn không có quyền Admin để xem danh sách người dùng!' });
        }
        const rows = await masterSql`
          SELECT user_id, username, display_name, database_target, role, status, features, created_at, last_login_at
          FROM master_users
          ORDER BY id ASC
        `;
        return res.status(200).json({ success: true, users: rows });
      }

      case 'adminCreateUser': {
        const masterSql = getMasterDb();
        const adminUser = await verifyAdminAccess(session, masterSql);
        if (!adminUser) {
          return res.status(403).json({ success: false, message: 'Chỉ tài khoản Admin mới được thêm người dùng!' });
        }

        const payload = args[0] || {};
        const username = String(payload.username || '').trim().toLowerCase();
        const displayName = String(payload.displayName || payload.display_name || username).trim();
        const password = String(payload.password || '').trim();
        const role = String(payload.role || 'USER').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
        const status = String(payload.status || 'ACTIVE').trim().toUpperCase() === 'LOCKED' ? 'LOCKED' : 'ACTIVE';
        const dbTarget = String(payload.databaseTarget || payload.database_target || 'KIAN_DATABASE_URL').trim() || 'KIAN_DATABASE_URL';
        const features = String(payload.features || 'ALL').trim() || 'ALL';

        if (!/^[a-z0-9_.-]{2,40}$/.test(username)) {
          return res.status(200).json({ success: false, message: 'Tên đăng nhập phải từ 2-40 ký tự (chữ thường, số, _, ., - không dấu/khoảng trắng)!' });
        }
        if (!password || password.length < 4) {
          return res.status(200).json({ success: false, message: 'Mật khẩu phải có ít nhất 4 ký tự!' });
        }

        const exists = await masterSql`SELECT user_id FROM master_users WHERE LOWER(username) = ${username} LIMIT 1`;
        if (exists.length > 0) {
          return res.status(200).json({ success: false, message: `Tên đăng nhập "${username}" đã tồn tại!` });
        }

        const newUserId = 'usr_' + username.replace(/[^a-z0-9]/g, '') + '_' + Date.now().toString().slice(-4);
        const pwHash = hashPassword(password);

        await masterSql`
          INSERT INTO master_users (user_id, username, password_hash, display_name, database_target, role, status, features)
          VALUES (${newUserId}, ${username}, ${pwHash}, ${displayName}, ${dbTarget}, ${role}, ${status}, ${features})
        `;

        const users = await masterSql`
          SELECT user_id, username, display_name, database_target, role, status, features, created_at, last_login_at
          FROM master_users ORDER BY id ASC
        `;
        return res.status(200).json({ success: true, message: `Đã tạo tài khoản "${username}" thành công!`, users });
      }

      case 'adminUpdateUser': {
        const masterSql = getMasterDb();
        const adminUser = await verifyAdminAccess(session, masterSql);
        if (!adminUser) {
          return res.status(403).json({ success: false, message: 'Chỉ tài khoản Admin mới được sửa người dùng!' });
        }

        const payload = args[0] || {};
        const userId = String(payload.userId || payload.user_id || '').trim();
        if (!userId) {
          return res.status(200).json({ success: false, message: 'Thiếu mã người dùng!' });
        }

        const existing = await masterSql`SELECT user_id, username, role, status FROM master_users WHERE user_id = ${userId} LIMIT 1`;
        if (existing.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy người dùng!' });
        }

        const targetUser = existing[0];
        const isPrimaryAdmin = String(targetUser.username || '').toLowerCase() === 'kian' || targetUser.user_id === adminUser.user_id;

        const displayName = String(payload.displayName || payload.display_name || targetUser.username).trim();
        let role = String(payload.role || 'USER').trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
        let status = String(payload.status || 'ACTIVE').trim().toUpperCase() === 'LOCKED' ? 'LOCKED' : 'ACTIVE';
        const dbTarget = String(payload.databaseTarget || payload.database_target || 'KIAN_DATABASE_URL').trim() || 'KIAN_DATABASE_URL';
        const features = String(payload.features || 'ALL').trim() || 'ALL';

        if (isPrimaryAdmin) {
          role = 'ADMIN';
          status = 'ACTIVE';
        }

        await masterSql`
          UPDATE master_users
          SET display_name = ${displayName},
              role = ${role},
              status = ${status},
              database_target = ${dbTarget},
              features = ${features}
          WHERE user_id = ${userId}
        `;

        const users = await masterSql`
          SELECT user_id, username, display_name, database_target, role, status, features, created_at, last_login_at
          FROM master_users ORDER BY id ASC
        `;
        return res.status(200).json({ success: true, message: `Đã cập nhật tài khoản "${targetUser.username}"!`, users });
      }

      case 'adminDeleteUser': {
        const masterSql = getMasterDb();
        const adminUser = await verifyAdminAccess(session, masterSql);
        if (!adminUser) {
          return res.status(403).json({ success: false, message: 'Chỉ tài khoản Admin mới được xóa người dùng!' });
        }

        const userId = String(args[0] || '').trim();
        if (!userId) {
          return res.status(200).json({ success: false, message: 'Thiếu mã người dùng!' });
        }

        const existing = await masterSql`SELECT user_id, username FROM master_users WHERE user_id = ${userId} LIMIT 1`;
        if (existing.length === 0) {
          return res.status(200).json({ success: false, message: 'Tài khoản không tồn tại!' });
        }
        const target = existing[0];
        if (String(target.username || '').toLowerCase() === 'kian' || target.user_id === adminUser.user_id) {
          return res.status(200).json({ success: false, message: 'Không thể xóa tài khoản Admin gốc hoặc tài khoản đang đăng nhập!' });
        }

        await masterSql`DELETE FROM master_users WHERE user_id = ${userId}`;
        const users = await masterSql`
          SELECT user_id, username, display_name, database_target, role, status, features, created_at, last_login_at
          FROM master_users ORDER BY id ASC
        `;
        return res.status(200).json({ success: true, message: `Đã xóa tài khoản "${target.username}"!`, users });
      }

      // 3. LẤY TOÀN BỘ DỮ LIỆU TỪ DATABASE RIÊNG CỦA NGƯỜI DÙNG (AppData)
      case 'getAppData':
      case 'getInitialData':
      case 'getTab1EssentialData': {
        // Chạy song song tất cả các truy vấn DB độc lập để tối ưu hóa thời gian phản hồi (chỉ mất ~300ms thay vì tuần tự 2-3s)
        const [
          allWallets,
          categories,
          familyTemplates,
          familyRows,
          orderRows,
          salesRowsResult,
          debtRows,
          cardCycleDebtsResult,
          hiddenOrders,
          jarConfigs,
          historySet,
          statsTrend,
          recurringData
        ] = await Promise.all([
          isKian ? sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv, is_hidden, is_deleted,
                   COALESCE(linked_email, '') as linked_email, COALESCE(sender_filter, '') as sender_filter
            FROM wallets 
            ORDER BY id ASC
          ` : sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv, is_hidden, is_deleted
            FROM wallets 
            ORDER BY id ASC
          `,
          sql`
            SELECT id, type, name, is_hidden, initial_balance, is_locked
            FROM categories 
            WHERE is_hidden = false
            ORDER BY id ASC
          `,
          sql`
            SELECT id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden
            FROM family_templates
            WHERE is_hidden = false
            ORDER BY id ASC
          `.catch(() => []),
          sql`
            SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date, payment_group_id
            FROM family_transactions
            ORDER BY date DESC, id DESC
          `,
          sql`
            SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, is_deleted, shop, shop_id, account, account_id, statement_date, payment_group_id
            FROM business_orders
            WHERE is_deleted = false
            ORDER BY date DESC, id DESC
          `,
          sql`
            SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, wallet_id, wallet_name, status, note, cogs, order_status, is_deleted
            FROM sales_orders
            WHERE is_deleted = false
            ORDER BY date DESC, id DESC
          `.catch(() => []),
          (async () => {
            try {
              return await sql`
                SELECT id, date, name, partner_id, content, amount, remaining_debt, type, wallet_id, wallet_name, status, note, recurring_id, recurring_period
                FROM debts
                ORDER BY id DESC
              `;
            } catch (err) {
              try {
                return await sql`
                  SELECT id, date, name, partner_id, content, amount, remaining_debt, type, wallet_id, wallet_name, status, note
                  FROM debts
                  ORDER BY id DESC
                `;
              } catch (e2) {
                return [];
              }
            }
          })(),
          sql`
            SELECT wallet_id, wallet_name, statement_date, SUM(amount::numeric) as cycle_amount
            FROM wallet_ledger
            WHERE ((effect_type = 'CARD_DEBT' AND direction = 'INCREASE') OR (effect_type = 'CASH' AND direction = 'OUT'))
              AND status = 'POSTED'
              AND statement_date IS NOT NULL AND statement_date != ''
            GROUP BY wallet_id, wallet_name, statement_date
          `.catch(() => []),
          fetchHiddenOrdersHelper(sql).catch(() => []),
          sql`SELECT year, month, invest_amount, giaoduc_amount, pct_thietyeu, pct_tietkiem, pct_giaoduc, pct_giaitri, pct_chodi, raw_config FROM jar_configs ORDER BY year ASC, month ASC`.catch(() => []),
          getWalletsWithHistorySet(sql).catch(() => new Set()),
          computeFinancialTrendStats(sql, 3).catch(() => []),
          getRecurringDebtsHelper(sql).catch(() => ({ items: [], pendingCount: 0, period: '' }))
        ]);

        const allWalletTypeMap = buildWalletTypeMap(allWallets);
        const allWalletByIdMap = buildWalletByIdMap(allWallets);
        const allCatByIdMap = buildCategoryByIdMap(categories);

        const wallets = allWallets.filter(w => !w.is_hidden && w.status !== 'DELETED' && !w.is_deleted);
        const hiddenWallets = allWallets.filter(w => w.is_hidden || w.status === 'DELETED' || w.is_deleted);
        const salesRows = salesRowsResult || [];
        const cardCycleDebts = cardCycleDebtsResult || [];

        const parseDateHelper = (dStr) => {
          if (!dStr) return null;
          const str = String(dStr).trim();
          const p = str.split('T')[0].split(/[-/]/);
          if (p.length >= 3) {
            if (p[0].length === 4) { // YYYY-MM-DD
              return { year: parseInt(p[0], 10), month: parseInt(p[1], 10) };
            } else { // DD-MM-YYYY
              return { year: parseInt(p[2], 10), month: parseInt(p[1], 10) };
            }
          }
          return null;
        };

        const [monthArg, yearArg] = args || [];
        const isAllMonth = (!monthArg || monthArg === "ALL" || String(monthArg).toUpperCase() === "ALL" || monthArg === "All");
        const isAllYear = (!yearArg || yearArg === "ALL" || String(yearArg).toUpperCase() === "ALL" || yearArg === "All");
        const now = new Date();
        const targetMonth = isAllMonth ? null : parseInt(monthArg, 10);
        const targetYear = isAllYear ? null : parseInt(yearArg, 10);

        const huCatsActive = (categories || []).filter(c => ALL_HU_TYPES.includes(String(c.type || '').toUpperCase()) && !c.is_hidden);
        const expenseHuCats = huCatsActive.filter(c => !SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(c.name)));
        const jarNames = expenseHuCats.length > 0 ? expenseHuCats.map(c => c.name) : DEFAULT_EXPENSE_JARS;
        const jarCatByNameLow = new Map(huCatsActive.map(c => [normalizeTextNoAccents(c.name), c]));
        const jarSpent = {};
        jarNames.forEach(j => { jarSpent[j] = 0; });

        let totalIncome = 0;
        let totalExpense = 0;
        let tab2Tx = [];
        const tab2Preorders = [];
        const cardBreakdownMaps = computeCreditCardDebtBreakdowns(allWallets, familyRows, orderRows, debtRows);
        const appTxEvalMap = await fetchTxEvaluationsMap(sql, isKian);

        const resolveFamilyRowItem = (f) => {
          const amt = Number(f.amount || 0);
          const loai = String(f.type || '').trim().toLowerCase() === 'thu' ? 'Thu' : 'Chi';
          const fHuId = normalizeCategoryId(f.hu_id);
          const fHuCat = fHuId ? allCatByIdMap.get(fHuId) : null;
          const resolvedHu = fHuCat ? fHuCat.name : (f.hu || '');
          const fWId = String(f.wallet_id || '').trim();
          const fWObj = fWId ? allWalletByIdMap.get(fWId) : null;
          const resolvedWalletName = fWObj ? fWObj.name : (f.wallet_name || '');
          const settlementBreakdown = computeCardSettlementBreakdownForTx(f, cardBreakdownMaps);
          const evalInfo = isKian ? autoClassifySpendLevelServer(f, resolvedHu, appTxEvalMap) : { evalLevel: '', evalIsManual: false };
          return {
            amt,
            loai,
            resolvedHu,
            txItem: {
              id: f.id,
              ngay: f.date,
              loai: loai,
              huId: fHuId,
              hu_id: fHuId,
              hu: resolvedHu,
              noidung: f.content || '',
              sotien: amt,
              walletId: fWId,
              wallet_id: fWId,
              nguontien: resolvedWalletName,
              codinh: Boolean(f.is_fixed),
              ghichu: f.note || '',
              status: f.status || 'ACTIVE',
              statementDate: f.statement_date || '',
              statement_date: f.statement_date || '',
              paymentGroupId: String(f.payment_group_id || '').trim(),
              payment_group_id: String(f.payment_group_id || '').trim(),
              settlementBreakdown: settlementBreakdown || null,
              evalLevel: evalInfo.evalLevel || '',
              evalIsManual: Boolean(evalInfo.evalIsManual)
            }
          };
        };

        familyRows.forEach(f => {
          const { amt, loai, resolvedHu, txItem } = resolveFamilyRowItem(f);
          const fStUp = String(f.status || 'ACTIVE').trim().toUpperCase();
          if (fStUp.includes('PRE') && !['DA_HUY', 'CANCELLED', 'VOID'].includes(fStUp)) {
            tab2Preorders.push(txItem);
          }
          const dt = parseDateHelper(f.date);

          // Lọc theo Tháng & Năm người dùng chọn (nếu ALL thì lấy hết, nếu không chỉ định thì lấy tháng hiện tại)
          const matchYear = isAllYear || (targetYear ? (dt && dt.year === targetYear) : (dt && dt.year === now.getFullYear()));
          const matchMonth = isAllMonth || (targetMonth ? (dt && dt.month === targetMonth) : (dt && dt.month === (now.getMonth() + 1)));

          if (matchYear && matchMonth) {
            tab2Tx.push(txItem);
            const contentStr = String(f.content || '');
            const noteStr = String(f.note || '');
            const huStr = String(resolvedHu || '');
            const isTagExcluded = String(f.id || '').startsWith('JTF_GOAL_') ||
                                  contentStr.includes("[Ứng hộ nhóm]") || contentStr.includes("[Tất toán") || contentStr.includes("[Thu nợ]") || contentStr.includes("[Trả nợ]") ||
                                  noteStr.includes("[Ứng hộ nhóm]") || noteStr.includes("[Tất toán") ||
                                  contentStr.includes("Chuyển tiền:") || contentStr.includes("Tất toán thẻ:");
            if (!isTagExcluded) {
              if (loai === 'Thu') totalIncome += amt;
              else {
                totalExpense += amt;
                jarNames.forEach(jName => {
                  const jCat = jarCatByNameLow.get(normalizeTextNoAccents(jName));
                  const matchById = jCat && txItem.huId && normalizeCategoryId(txItem.huId) === normalizeCategoryId(jCat.id);
                  if (matchById || huStr.toLowerCase().includes(jName.toLowerCase())) {
                    jarSpent[jName] += amt;
                  }
                });
              }
            }
          }
        });

        // Nếu tháng đang chọn chưa có giao dịch và không có bộ lọc cụ thể, fallback lấy toàn bộ để không bị trống
        if (tab2Tx.length === 0 && familyRows.length > 0 && !targetMonth && !targetYear) {
          familyRows.forEach(f => {
            const { amt, loai, resolvedHu, txItem } = resolveFamilyRowItem(f);
            if (loai === 'Thu') totalIncome += amt;
            else {
              totalExpense += amt;
              jarNames.forEach(jName => {
                const jCat = jarCatByNameLow.get(normalizeTextNoAccents(jName));
                const matchById = jCat && txItem.huId && normalizeCategoryId(txItem.huId) === normalizeCategoryId(jCat.id);
                if (matchById || resolvedHu.toLowerCase().includes(jName.toLowerCase())) {
                  jarSpent[jName] += amt;
                }
              });
            }
            tab2Tx.push(txItem);
          });
        }

        const jarSummary = computeJarSummaryHelper({
          familyRows,
          jarConfigs,
          jarNames,
          jarCatByNameLow,
          allCatByIdMap,
          targetMonth: isAllMonth ? null : (targetMonth || (now.getMonth() + 1)),
          targetYear: isAllYear ? null : (targetYear || now.getFullYear()),
          isAllMonth,
          isAllYear
        });
        const jars = jarSummary.jars;
        const kianGoals = isKian
          ? await buildKianGoalsPayload(sql, {
              jars,
              debtRows,
              catByIdMap: allCatByIdMap,
              wallets,
              dbKey: targetDbKey
            }).catch(err => {
              console.error('buildKianGoalsPayload getAppData error:', err);
              return null;
            })
          : null;

        // D. Orders / Purchases (Tab 3)
        let totalSales = 0;
        let totalCogs = 0;
        const debtSales = [];

        const allSales = (salesRows || []).map(s => {
          const qty = Number(s.quantity || 0);
          const price = Math.round(Number(s.unit_price || 0));
          const total = Math.round(Number(s.total_amount || 0) || (qty * Number(s.unit_price || 0)));
          const cogs = Number(s.cogs || 0);
          const st = String(s.status || '').trim();
          const ordSt = String(s.order_status || 'HOAN_TAT').trim();
          const isCancelled = ordSt === 'DA_HUY' || st === 'DA_HUY' || st.toLowerCase().includes('hủy');

          // Tính Lợi Nhuận Gộp Tháng Này cho dashboard Tab 3
          const dt = parseDateHelper(s.date);
          const matchYear = isAllYear || (targetYear ? (dt && dt.year === targetYear) : (dt && dt.year === now.getFullYear()));
          const matchMonth = isAllMonth || (targetMonth ? (dt && dt.month === targetMonth) : (dt && dt.month === (now.getMonth() + 1)));
          if (!isCancelled && matchYear && matchMonth) {
            totalSales += total;
            totalCogs += cogs;
          }

          const sWhId = normalizeCategoryId(s.warehouse_id)
            || (s.warehouse && allCatByIdMap.has(String(s.warehouse).trim()) ? String(s.warehouse).trim() : null);
          const sWhCat = sWhId ? allCatByIdMap.get(sWhId) : null;
          const rawSWId = String(s.wallet_id || '').trim();
          const rawSWName = String(s.wallet_name || '').trim();
          const sWObj = (rawSWId && allWalletByIdMap.get(rawSWId)) || (rawSWName && allWalletByIdMap.get(rawSWName)) || null;
          const sWIdStr = sWObj ? String(sWObj.id) : rawSWId;
          const sItem = {
            id: s.id,
            ngayBan: s.date,
            tenSP: s.product_name,
            warehouseId: sWhId,
            noiTru: sWhCat ? sWhCat.name : s.warehouse,
            qty: qty,
            price: price,
            total: total,
            walletId: sWIdStr,
            wallet_id: sWIdStr,
            nhanTien: sWObj ? sWObj.name : s.wallet_name,
            trangThai: st || 'HOAN_TAT',
            ghiChu: s.note || '',
            cogs: cogs,
            orderStatus: isCancelled ? 'DA_HUY' : ordSt,
            isCancelled: isCancelled
          };

          const isDebt = st.toUpperCase().includes('KHÁCH NỢ') || st.toUpperCase().includes('KHACH NO') || st.toUpperCase().includes('DEBT') || st.toUpperCase() === 'NO';
          if (isDebt && !isCancelled) {
            debtSales.push(sItem);
          }

          return sItem;
        });

        let totalStockValue = 0;
        let catRows = categories || [];
        if (!catRows || catRows.length === 0) {
          try {
            catRows = await sql`SELECT id, type, name, is_hidden FROM categories WHERE is_hidden = false ORDER BY id ASC`;
          } catch(e) {}
        }
        const appCatByIdMap = buildCategoryByIdMap(catRows);
        const whSet = new Set(catRows.filter(c => c.type === 'WAREHOUSE' || c.type === 'WAREHOUSE_STATUS').map(c => c.name));
        const shopSet = new Set(catRows.filter(c => c.type === 'SHOP').map(c => c.name));
        const prodMap = {};

        const allOrders = orderRows.map(o => {
          const mapped = mapPurchaseOrderRow(o, allWalletTypeMap, allWalletByIdMap, appCatByIdMap, catRows);
          if (mapped.trangThaiKho) whSet.add(mapped.trangThaiKho);
          if (mapped.shop) shopSet.add(mapped.shop);
          if (mapped.tenSP) prodMap[mapped.tenSP] = (prodMap[mapped.tenSP] || 0) + mapped.tonKho;
          if (mapped.tonKho > 0 && !isWarehouseCancelledName(mapped.trangThaiKho)) {
            totalStockValue += (mapped.tonKho * mapped.price);
          }
          return mapped;
        });

        const preOrders = allOrders.filter(isPurchasePreOrderPending);

        const cancelledRefundPending = allOrders.filter(o => {
          if (o.isDeleted) return false;
          const lowerWh = String(o.trangThaiKho || '').toLowerCase();
          const lowerCardStatus = String(o.trangThaiThe || '').toLowerCase();
          const lowerOrderStatus = String(o.orderStatus || '').toLowerCase();
          const isCancelled = lowerWh.includes('hủy') || lowerWh.includes('cancel') || lowerCardStatus.includes('hủy') || lowerCardStatus.includes('cancel');
          const isRefunded =
            lowerCardStatus === 'da_hoan_tien' || lowerCardStatus.includes('da_hoan') || lowerCardStatus.includes('đã hoàn') || lowerCardStatus.includes('refunded') ||
            lowerOrderStatus === 'da_hoan_tien' || lowerOrderStatus.includes('da_hoan') || lowerOrderStatus.includes('đã hoàn') || lowerOrderStatus.includes('refunded');
          const isPending = (
            lowerCardStatus.includes('cho_hoan') ||
            lowerCardStatus.includes('chờ hoàn') ||
            lowerCardStatus.includes('cần hoàn') ||
            lowerCardStatus.includes('refund') ||
            lowerWh.includes('chờ hoàn') ||
            lowerWh.includes('cho_hoan') ||
            (isCancelled && !isRefunded)
          );
          return isPending && !isRefunded;
        });

        const inStockProducts = Object.keys(prodMap).map(name => ({
          tenSP: name,
          qty: prodMap[name]
        }));

        const groupedInventory = buildGroupedInventory(allOrders);
        const tab5Data = buildTab5Matrix(orderRows, catRows || []);

        // E. Debts (Tab 4)
        let totalReceivable = 0;
        let totalPayable = 0;
        const partnerSet = new Set(catRows.filter(c => c.type === 'PARTNER' || c.type === 'FAMILY').map(c => c.name));

        const debts = (debtRows || []).map(d => {
          const amt = Number(d.amount || 0);
          const duNo = Number(d.remaining_debt || 0);
          const daTra = amt - duNo;
          const loai = String(d.type || '').toUpperCase() === 'THU' ? 'THU' : 'TRA';
          const dPartnerId = normalizeCategoryId(d.partner_id);
          const dPartnerCat = dPartnerId ? appCatByIdMap.get(dPartnerId) : null;
          const pName = String(dPartnerCat ? dPartnerCat.name : (d.name || '')).trim();
          const rawDWId = String(d.wallet_id || '').trim();
          const rawDWName = String(d.wallet_name || '').trim();
          const dWObj = (rawDWId && allWalletByIdMap.get(rawDWId)) || (rawDWName && allWalletByIdMap.get(rawDWName)) || null;
          const dWId = dWObj ? String(dWObj.id) : rawDWId;
          const dWName = dWObj ? dWObj.name : rawDWName;
          if (pName) partnerSet.add(pName);

          if (duNo > 0) {
            if (loai === 'THU') totalReceivable += duNo;
            else totalPayable += duNo;
          }

          return {
            id: d.id,
            ngay: d.date,
            partnerId: dPartnerId,
            partner_id: dPartnerId,
            ten: pName,
            loai: loai,
            noidung: d.content || '',
            tongNo: amt,
            daTra: daTra,
            duNo: duNo,
            walletId: dWId,
            wallet_id: dWId,
            nguon: dWName,
            trangThai: d.status || 'ACTIVE',
            trangThaiDuNo: d.status || 'ACTIVE',
            ghichu: d.note || '',
            recurring_id: d.recurring_id || '',
            recurring_period: d.recurring_period || ''
          };
        });

        // F. Order Counts cho Tab 1 (Chuẩn hóa gom nhóm theo Base Order ID như Tab 3)
        const extractBaseOrderId = (id) => {
          if (!id) return '';
          const m = String(id).trim().match(/^([A-Za-z0-9]+[-_].+?)[-_]([1-9]\d{0,2})$/);
          return m ? m[1] : String(id).trim();
        };

        const preOrderIdsSet = new Set((preOrders || []).map(it => String(it.id || '').trim()));
        const refundIdsSet = new Set((cancelledRefundPending || []).map(it => String(it.id || '').trim()));

        const choShipKeys = new Set();
        (allOrders || []).forEach(it => {
          const rawId = String(it.id || '').trim();
          if (refundIdsSet.has(rawId)) return;
          if (preOrderIdsSet.has(rawId)) return;

          const wh = String(it.trangThaiKho || '').trim();
          if (isWarehouseCancelledName(wh)) return;

          if (isWarehousePendingName(wh)) {
            const baseId = extractBaseOrderId(rawId) || rawId;
            choShipKeys.add(baseId);
          }
        });

        const preKeys = new Set();
        (preOrders || []).forEach(it => {
          const rawId = String(it.id || '').trim();
          const baseId = extractBaseOrderId(rawId) || rawId;
          preKeys.add(baseId);
        });

        const choShipCount = choShipKeys.size;
        const preorderCount = preKeys.size;
        const khachNoCount = (debtSales || []).length;
        const choHoanCount = (cancelledRefundPending || []).length;

        // G. Kiểm tra nhắc nhở tất toán thẻ tín dụng (Credit Card Settlement Reminders)
        // Áp dụng quy tắc ngân hàng Nhật Bản: Nếu ngày tất toán rơi vào Thứ 7, CN hoặc Ngày Lễ (祝日) -> Tự động dời sang ngày làm việc tiếp theo
        const getRawNationalHolidayName = (year, month, day) => {
          if (month === 1 && day === 1) return '元日';
          if (month === 2 && day === 11) return '建国記念の日';
          if (month === 2 && day === 23) return '天皇誕生日';
          if (month === 4 && day === 29) return '昭和の日';
          if (month === 5 && day === 3) return '憲法記念日';
          if (month === 5 && day === 4) return 'みどりの日';
          if (month === 5 && day === 5) return 'こどもの日';
          if (month === 8 && day === 11) return '山の日';
          if (month === 11 && day === 3) return '文化の日';
          if (month === 11 && day === 23) return '勤労感謝の日';

          const dt = new Date(year, month - 1, day);
          const dow = dt.getDay();
          const weekNum = Math.floor((day - 1) / 7) + 1;
          if (dow === 1) {
            if (month === 1 && weekNum === 2) return '成人の日';
            if (month === 7 && weekNum === 3) return '海の日';
            if (month === 9 && weekNum === 3) return '敬老の日';
            if (month === 10 && weekNum === 2) return 'スポーツの日';
          }

          const vernalEquinoxDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
          const autumnEquinoxDay = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
          if (month === 3 && day === vernalEquinoxDay) return '春分の日';
          if (month === 9 && day === autumnEquinoxDay) return '秋分の日';
          return null;
        };

        const isJapaneseBankHoliday = (year, month, day) => {
          if ((month === 12 && day === 31) || (month === 1 && (day === 2 || day === 3))) return true;
          if (getRawNationalHolidayName(year, month, day)) return true;

          const dt = new Date(year, month - 1, day);
          const dow = dt.getDay();
          if (dow >= 1 && dow <= 5) {
            let checkDate = new Date(year, month - 1, day - 1);
            while (getRawNationalHolidayName(checkDate.getFullYear(), checkDate.getMonth() + 1, checkDate.getDate())) {
              if (checkDate.getDay() === 0) return true;
              checkDate = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate() - 1);
            }
          }

          const prevDate = new Date(year, month - 1, day - 1);
          const nextDate = new Date(year, month - 1, day + 1);
          if (getRawNationalHolidayName(prevDate.getFullYear(), prevDate.getMonth() + 1, prevDate.getDate()) &&
              getRawNationalHolidayName(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate())) {
            return true;
          }
          return false;
        };

        const getNextJapaneseBusinessDay = (year, month, day) => {
          let dt = new Date(year, month - 1, day);
          while (true) {
            const y = dt.getFullYear();
            const m = dt.getMonth() + 1;
            const d = dt.getDate();
            const dow = dt.getDay();
            if (dow === 0 || dow === 6 || isJapaneseBankHoliday(y, m, d)) {
              dt.setDate(dt.getDate() + 1);
            } else {
              break;
            }
          }
          return dt;
        };

        const nowObj = new Date();
        const curDay = nowObj.getDate();
        const curMonth = nowObj.getMonth() + 1;
        const curYear = nowObj.getFullYear();
        const curMonthStr = `${curYear}-${String(curMonth).padStart(2, '0')}`;
        const todayDateOnly = new Date(curYear, curMonth - 1, curDay);

        const settlementReminders = [];
        const creditWallets = wallets.filter(w => {
          const t = String(w.type || '').trim().toUpperCase();
          return t ? (t === 'CREDIT') : String(w.name || '').toLowerCase().startsWith('c-');
        });

        creditWallets.forEach(w => {
          const debt = Number(w.debt || 0);
          const nominalDueDay = parseInt(w.due_date, 10) || null;
          const closingDay = parseInt(w.closing_date, 10) || null;
          const wIdLow = String(w.id || '').trim().toLowerCase();
          const wNameLow = String(w.name || '').trim().toLowerCase();

          // Tìm các bút toán tất toán liên quan đến thẻ này (ưu tiên theo ID ví)
          const settleTxs = familyRows.filter(f => {
            const c = String(f.content || '').toLowerCase();
            const n = String(f.note || '').toLowerCase();
            const isSettle = c.includes('tất toán') || c.includes('tat toan') || n.includes('tất toán') || n.includes('tat toan');
            if (!isSettle) return false;
            const fwId = String(f.wallet_id || '').trim().toLowerCase();
            const fwName = String(f.wallet_name || '').trim().toLowerCase();
            return (wIdLow && (fwId === wIdLow || n.includes('[id:' + wIdLow + ']'))) ||
                   c.includes(wNameLow) || n.includes(wNameLow) || (!fwId && fwName === wNameLow);
          });

          const lastSettle = settleTxs[0] || null;
          const lastSettleDate = lastSettle ? String(lastSettle.date || '').split('T')[0] : null;
          const hasSettleThisMonth = lastSettleDate ? lastSettleDate.startsWith(curMonthStr) : false;

          // Tính ngày tất toán thực tế theo lịch làm việc ngân hàng Nhật
          let effectiveDueDay = nominalDueDay;
          let effectiveDueMonth = curMonth;
          let isShifted = false;
          let effectiveDateOnly = null;
          let diffDays = null;
          let dueDebt = debt;

          // Helper chuẩn hóa statement_date về 'YYYY-MM'
          const toStmtMonthKey = (raw) => {
            const s = String(raw || '').trim();
            if (!s) return '';
            const p = s.split('T')[0].split(/[-/]/);
            if (p.length >= 2) {
              if (p[0].length === 4) return `${p[0]}-${String(parseInt(p[1], 10)).padStart(2, '0')}`;
              if (p.length >= 3 && p[2].length === 4) return `${p[2]}-${String(parseInt(p[1], 10)).padStart(2, '0')}`;
            }
            return '';
          };

          // 1. Kiểm tra chu kỳ nợ cụ thể từ sổ cái (wallet_ledger) & bổ sung từ family_transactions nếu có statement_date (ưu tiên wallet_id!)
          const cycleMap = new Map();
          (cardCycleDebts || []).forEach(cd => {
            const cId = String(cd.wallet_id || '').trim().toLowerCase();
            const cName = String(cd.wallet_name || '').trim().toLowerCase();
            const matchById = Boolean(cId && wIdLow && cId === wIdLow);
            const matchByLegacyName = !cId && cName === wNameLow;
            if ((matchById || matchByLegacyName) && Number(cd.cycle_amount) > 0) {
              const mk = toStmtMonthKey(cd.statement_date);
              if (mk) cycleMap.set(mk, (cycleMap.get(mk) || 0) + Number(cd.cycle_amount));
            }
          });

          // Bổ sung các khoản từ familyRows có statement_date nếu chưa có trong ledger
          familyRows.forEach(f => {
            const fwId = String(f.wallet_id || '').trim().toLowerCase();
            const fw = String(f.wallet_name || '').trim().toLowerCase();
            const loai = String(f.type || '').trim().toLowerCase();
            if (loai === 'thu' || !f.statement_date) return;
            const matchById = Boolean(fwId && wIdLow && fwId === wIdLow);
            const matchByLegacyName = !fwId && fw === wNameLow;
            if (!matchById && !matchByLegacyName) return;
            const c = String(f.content || '').toLowerCase();
            const n = String(f.note || '').toLowerCase();
            if (c.includes('tất toán') || c.includes('tat toan') || n.includes('tất toán') || n.includes('tat toan')) return;
            // Nếu ledger chưa có chu kỳ này thì nạp từ familyRows
            const mk = toStmtMonthKey(f.statement_date);
            const amt = Number(f.amount || 0);
            if (mk && amt > 0 && !cycleMap.has(mk)) {
              cycleMap.set(mk, (cycleMap.get(mk) || 0) + amt);
            }
          });

          const thisCardCycles = Array.from(cycleMap.entries())
            .filter(([, amt]) => amt > 0)
            .map(([mk, amt]) => ({ statement_date: mk, cycle_amount: amt }))
            .sort((a, b) => a.statement_date.localeCompare(b.statement_date));

          let specificCycleFound = false;
          let hasPrevCycleDebt = false;
          if (thisCardCycles.length > 0) {
            const earliest = thisCardCycles[0];
            const p = String(earliest.statement_date).split('-');
            if (p.length >= 2) {
              const cYear = parseInt(p[0], 10);
              const cMonth = parseInt(p[1], 10);
              dueDebt = Number(earliest.cycle_amount);
              specificCycleFound = true;
              hasPrevCycleDebt = (cYear < curYear) || (cYear === curYear && cMonth < curMonth);
              if (nominalDueDay) {
                const cycleDueDt = getNextJapaneseBusinessDay(cYear, cMonth, nominalDueDay);
                effectiveDateOnly = new Date(cycleDueDt.getFullYear(), cycleDueDt.getMonth(), cycleDueDt.getDate());
                effectiveDueDay = cycleDueDt.getDate();
                effectiveDueMonth = cycleDueDt.getMonth() + 1;
                isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== cMonth);
                diffDays = Math.round((effectiveDateOnly - todayDateOnly) / (1000 * 60 * 60 * 24));
              }
            }
          }

          // 2. Nếu không tìm thấy chu kỳ cụ thể, dùng logic suy đoán theo ngày tất toán gần nhất
          if (!specificCycleFound && nominalDueDay) {
            // Ngày đến hạn của tháng trước (tính dời T7/CN/Lễ Nhật)
            const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
            const prevYear = curMonth === 1 ? curYear - 1 : curYear;
            const prevDueDt = getNextJapaneseBusinessDay(prevYear, prevMonth, nominalDueDay);
            const prevDueDateOnly = new Date(prevYear, prevDueDt.getMonth(), prevDueDt.getDate());

            // Ngày đến hạn của tháng này (tính dời T7/CN/Lễ Nhật)
            const curDueDt = getNextJapaneseBusinessDay(curYear, curMonth, nominalDueDay);
            const curDueDateOnly = new Date(curYear, curDueDt.getMonth(), curDueDt.getDate());

            // Kiểm tra xem kỳ trước đã tất toán chưa
            let prevCycleSettled = false;
            if (lastSettleDate) {
              const lastD = new Date(lastSettleDate);
              if (lastSettleDate.startsWith(curMonthStr)) {
                prevCycleSettled = true;
              } else {
                const minSettleDateForPrev = new Date(prevYear, prevMonth - 1, Math.max(1, nominalDueDay - 15));
                if (lastD >= minSettleDateForPrev) {
                  prevCycleSettled = true;
                }
              }
            }

            // Chỉ coi là nợ quá hạn kỳ trước nếu thẻ đã có lịch sử tất toán trước đó mà kỳ gần nhất chưa tất toán
            // (Thẻ mới tạo chưa có lịch sử tất toán sẽ hướng tới hạn của kỳ hiện tại, tránh báo quá hạn nhầm)
            hasPrevCycleDebt = Boolean(lastSettleDate) && !prevCycleSettled && debt > 0;

            // Ngày đến hạn của tháng sau (tính dời T7/CN/Lễ Nhật)
            const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
            const nextYear = curMonth === 12 ? curYear + 1 : curYear;
            const nextDueDt = getNextJapaneseBusinessDay(nextYear, nextMonth, nominalDueDay);
            const nextDueDateOnly = new Date(nextYear, nextDueDt.getMonth(), nextDueDt.getDate());

            // Xác định ngày hạn áp dụng cho dư nợ hiện tại:
            // 1) Nếu hôm nay đã qua hạn tháng này (curDueDateOnly < todayDateOnly):
            if (curDueDateOnly < todayDateOnly) {
              if (hasSettleThisMonth) {
                // Đã tất toán tháng này -> dư nợ mới phát sinh hướng tới hạn tháng sau
                effectiveDateOnly = nextDueDateOnly;
                effectiveDueDay = nextDueDt.getDate();
                effectiveDueMonth = nextDueDt.getMonth() + 1;
                isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== nextMonth);
              } else if (hasPrevCycleDebt) {
                // Có nợ quá hạn thật sự từ kỳ trước
                effectiveDateOnly = curDueDateOnly;
                effectiveDueDay = curDueDt.getDate();
                effectiveDueMonth = curDueDt.getMonth() + 1;
                isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== curMonth);
              } else if (closingDay && curDay >= closingDay && (nominalDueDay <= closingDay || nominalDueDay <= 5)) {
                // Thẻ có ngày chốt trước ngày thanh toán tháng sau (ví dụ Aeon chốt ngày 10, trả ngày 2 tháng sau):
                // Hôm nay đã qua ngày chốt tháng này (ví dụ 26/11 >= 10/11), hạn 2/11 là của kỳ 10/10 trước đó.
                // Dư nợ hiện tại thuộc kỳ chốt 10/11 sẽ đến hạn vào ngày 2 tháng sau (2/12)!
                effectiveDateOnly = nextDueDateOnly;
                effectiveDueDay = nextDueDt.getDate();
                effectiveDueMonth = nextDueDt.getMonth() + 1;
                isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== nextMonth);
              } else {
                effectiveDateOnly = curDueDateOnly;
                effectiveDueDay = curDueDt.getDate();
                effectiveDueMonth = curDueDt.getMonth() + 1;
                isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== curMonth);
              }
            }
            // 2) Nếu kỳ trước chưa tất toán và hôm nay đã quá hạn kỳ trước (Hạn là ngày của tháng trước!)
            else if (!prevCycleSettled && prevDueDateOnly < todayDateOnly && hasPrevCycleDebt) {
              effectiveDateOnly = prevDueDateOnly;
              effectiveDueDay = prevDueDt.getDate();
              effectiveDueMonth = prevDueDt.getMonth() + 1;
              isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== prevMonth);
            }
            // 3) Kỳ trước đã tất toán (hoặc thẻ mới chưa có lịch sử tất toán), hướng tới hạn của tháng này
            else {
              effectiveDateOnly = curDueDateOnly;
              effectiveDueDay = curDueDt.getDate();
              effectiveDueMonth = curDueDt.getMonth() + 1;
              isShifted = (effectiveDueDay !== nominalDueDay || effectiveDueMonth !== curMonth);
            }

            diffDays = Math.round((effectiveDateOnly - todayDateOnly) / (1000 * 60 * 60 * 24));
          }

          let status = 'NO_DEBT';
          let urgency = 'NONE';
          let badge = '✅ Đã tất toán';
          let badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
          let message = 'Không có dư nợ cần tất toán';
          let isUrgent = false;

          if (debt > 0) {
            if (hasSettleThisMonth) {
              status = 'SETTLED_THIS_MONTH';
              badge = '✅ Đã tất toán kỳ này';
              badgeClass = 'bg-emerald-100 text-emerald-800 border border-emerald-200';
              message = `Đã có bút toán tất toán ngày ${lastSettleDate} (Dư nợ phát sinh mới: ${debt.toLocaleString()} ¥)`;
            } else if (!nominalDueDay) {
              status = 'NO_DUE_DATE';
              urgency = 'MEDIUM';
              badge = '⚠️ Chưa cài ngày TT';
              badgeClass = 'bg-amber-100 text-amber-800 border border-amber-200';
              message = `Dư nợ: ${debt.toLocaleString()} ¥ (Chưa cài ngày tất toán)`;
            } else if (diffDays < 0) {
              const overdueDays = Math.abs(diffDays);
              status = 'OVERDUE';
              urgency = 'CRITICAL';
              isUrgent = true;
              badge = `🚨 Quá ${overdueDays} ngày`;
              badgeClass = 'bg-rose-100 text-rose-800 border border-rose-300 font-black animate-pulse';
              message = `Đã quá hạn tất toán ${overdueDays} ngày (Hạn: ngày ${effectiveDueDay}/${effectiveDueMonth}${isShifted ? ' dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ' : ''}, Nợ kỳ này: ${dueDebt.toLocaleString()} ¥)`;
            } else if (diffDays === 0) {
              status = 'DUE_TODAY';
              urgency = 'HIGH';
              isUrgent = true;
              badge = `⚠️ Hôm nay`;
              badgeClass = 'bg-rose-500 text-white font-black animate-pulse';
              message = `Hôm nay đến hạn tất toán (Hạn: ngày ${effectiveDueDay}/${effectiveDueMonth}${isShifted ? ' dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ' : ''}, Nợ kỳ này: ${dueDebt.toLocaleString()} ¥)`;
            } else if (diffDays <= 5) {
              status = 'DUE_SOON';
              urgency = 'MEDIUM';
              isUrgent = true;
              badge = `⏳ Còn ${diffDays} ngày`;
              badgeClass = 'bg-amber-100 text-amber-900 border border-amber-300 font-bold';
              message = `Sắp đến hạn tất toán còn ${diffDays} ngày (Hạn: ngày ${effectiveDueDay}/${effectiveDueMonth}${isShifted ? ' dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ' : ''}, Nợ kỳ này: ${dueDebt.toLocaleString()} ¥)`;
            } else {
              status = 'UPCOMING';
              urgency = 'LOW';
              badge = `📅 ${effectiveDueDay}/${effectiveDueMonth}`;
              badgeClass = 'bg-blue-50 text-blue-700 border border-blue-200';
              message = `Đến hạn ngày ${effectiveDueDay}/${effectiveDueMonth}${isShifted ? ' (dời từ ngày ' + nominalDueDay + ' do T7/CN/Lễ)' : ''} (còn ${diffDays} ngày, Nợ kỳ này: ${dueDebt.toLocaleString()} ¥)`;
            }
          }

          settlementReminders.push({
            id: w.id,
            name: w.name,
            debt: debt,
            dueDebt: dueDebt,
            due_date: w.due_date,
            nominalDueDay: nominalDueDay,
            dueDay: effectiveDueDay,
            effectiveDueMonth: effectiveDueMonth,
            isShifted: isShifted,
            closingDay: closingDay,
            diffDays: diffDays,
            lastSettleDate: lastSettleDate,
            hasSettleThisMonth: hasSettleThisMonth,
            hasPrevCycleDebt: hasPrevCycleDebt,
            status: status,
            urgency: urgency,
            isUrgent: isUrgent,
            badge: badge,
            badgeClass: badgeClass,
            message: message,
            settleSourceId: String(w.settle_source_id || '').trim(),
            settleSource: (String(w.settle_source_id || '').trim() && allWalletByIdMap.get(String(w.settle_source_id || '').trim()))
              ? allWalletByIdMap.get(String(w.settle_source_id || '').trim()).name
              : (w.settle_source || null)
          });
        });

        const reminderMap = new Map();
        settlementReminders.forEach(r => reminderMap.set(String(r.name).toLowerCase(), r));

        const resolveSettleSrc = (w) => {
          const sId = String(w.settle_source_id || '').trim();
          const sName = (sId && allWalletByIdMap.get(sId)) ? allWalletByIdMap.get(sId).name : (w.settle_source || null);
          return { sId, sName };
        };

        const mappedWalletsWithMeta = await attachWalletCheckpointMetaHelper(sql, wallets.filter(w => w.type !== 'VIRTUAL').map(w => {
            const wLast4 = extractCardLast4(w.card_number);
            const wHasHistory = historySet.has(String(w.id || '').trim().toLowerCase()) ||
                                historySet.has(String(w.name || '').trim().toLowerCase()) ||
                                Number(w.debt || 0) > 0 ||
                                Number(w.preorder || 0) > 0;
            const { sId, sName } = resolveSettleSrc(w);
            return {
              id: w.id,
              name: w.name,
              type: w.type || 'DEBIT',
              hasHistory: wHasHistory,
              current_balance: Number(w.current_balance || 0),
              initial_balance: Number(w.initial_balance || 0),
              credit_limit: Number(w.credit_limit || 0),
              debt: Number(w.debt || 0),
              preorder: Number(w.preorder || 0),
              status: w.status || 'ACTIVE',
              closing_date: w.closing_date || null,
              due_date: w.due_date || null,
              settle_source_id: sId || null,
              settleSourceId: sId || null,
              settle_source: sName,
              settleSource: sName,
              stmtFileHeaders: w.stmt_file_headers || null,
              stmtPasteHeaders: w.stmt_paste_headers || null,
              cardNumber: wLast4 ? ('•••• •••• •••• ' + wLast4) : '',
              cardExp: wLast4 ? '••/••' : '',
              cardCvv: wLast4 ? '•••' : '',
              last4: wLast4,
              settlementReminder: reminderMap.get(String(w.name || '').toLowerCase()) || null,
              hasPrevCycleDebt: Boolean(reminderMap.get(String(w.name || '').toLowerCase())?.hasPrevCycleDebt),
              dueDebt: (reminderMap.get(String(w.name || '').toLowerCase())?.dueDebt) || Number(w.debt || 0),
              debtBreakdown: (() => {
                const bd = cardBreakdownMaps.mapById.get(String(w.id || '').trim()) || cardBreakdownMaps.mapByName.get(String(w.name || '').trim().toLowerCase());
                return bd ? { totalFamilyAmt: bd.totalFamilyAmt, totalBusinessAmt: bd.totalBusinessAmt, byCycle: bd.byCycle } : null;
              })(),
              is_hidden: false,
              is_deleted: false,
              linked_email: w.linked_email || '',
              linkedEmail: w.linked_email || '',
              sender_filter: w.sender_filter || '',
              senderFilter: w.sender_filter || ''
            };
          }));

        return res.status(200).json({
          success: true,
          databaseTarget: targetDbKey,
          settlementReminders: settlementReminders,
          wallets: mappedWalletsWithMeta,
          hiddenWallets: hiddenWallets.map(w => {
            const wLast4 = extractCardLast4(w.card_number);
            const { sId, sName } = resolveSettleSrc(w);
            return {
              id: w.id,
              name: w.name,
              type: w.type || 'DEBIT',
              current_balance: Number(w.current_balance || 0),
              initial_balance: Number(w.initial_balance || 0),
              credit_limit: Number(w.credit_limit || 0),
              debt: Number(w.debt || 0),
              preorder: Number(w.preorder || 0),
              status: 'DELETED',
              closing_date: w.closing_date || null,
              due_date: w.due_date || null,
              settle_source_id: sId || null,
              settleSourceId: sId || null,
              settle_source: sName,
              settleSource: sName,
              stmtFileHeaders: w.stmt_file_headers || null,
              stmtPasteHeaders: w.stmt_paste_headers || null,
              cardNumber: wLast4 ? ('•••• •••• •••• ' + wLast4) : '',
              cardExp: wLast4 ? '••/••' : '',
              cardCvv: wLast4 ? '•••' : '',
              last4: wLast4,
              is_hidden: true,
              is_deleted: true,
              isVirtual: (w.type === 'VIRTUAL')
            };
          }),
          categories: mapTemplateCategoriesForClient(familyTemplates, appCatByIdMap, allWalletByIdMap),
          allCategories: catRows.map(c => mapCategoryRowWithRefs(c, appCatByIdMap, allWalletByIdMap)),
          accounts: catRows.filter(c => c.type === 'ACCOUNT').map(c => c.name),
          virtualCards: formatMaskedVirtualCards(wallets),
          lockedFundsTotal: kianGoals ? (kianGoals.goals || []).reduce((sum, g) => sum + (g.is_locked ? Math.max(0, Number(g.stats?.savedYen || g.initialYen || 0)) : 0), 0) : 0,
          lockedJarsTotal: kianGoals ? (kianGoals.goals || []).reduce((sum, g) => sum + (g.is_locked ? Math.max(0, Number(g.stats?.savedYen || g.initialYen || 0)) : 0), 0) : 0,
          tab2: {
            success: true,
            isKian: isKian,
            kianGoals: isKian ? kianGoals : null,
            transactions: tab2Tx,
            preorders: tab2Preorders,
            jars: jars,
            lockedFundsTotal: kianGoals ? (kianGoals.goals || []).reduce((sum, g) => sum + (g.is_locked ? Math.max(0, Number(g.stats?.savedYen || g.initialYen || 0)) : 0), 0) : 0,
            lockedJarsTotal: kianGoals ? (kianGoals.goals || []).reduce((sum, g) => sum + (g.is_locked ? Math.max(0, Number(g.stats?.savedYen || g.initialYen || 0)) : 0), 0) : 0,
            kianIntelligence: isKian ? buildKianFinancialIntelligencePayload({
              familyRows,
              jarConfigs,
              jars,
              allCatByIdMap,
              txEvalMap: appTxEvalMap,
              targetMonth: isAllMonth ? (now.getMonth() + 1) : (targetMonth || (now.getMonth() + 1)),
              targetYear: isAllYear ? now.getFullYear() : (targetYear || now.getFullYear())
            }) : null,
            summary: {
              net: totalIncome - totalExpense,
              income: totalIncome,
              expense: totalExpense,
              totalIncome: totalIncome,
              totalExpense: totalExpense,
              netBalance: totalIncome - totalExpense,
              prevMonthIncome: jarSummary.prevMonthIncome
            }
          },
          tab3: {
            success: true,
            summary: {
              sales: totalSales,
              cogs: totalCogs,
              net: totalSales - totalCogs,
              stockValue: totalStockValue
            },
            products: inStockProducts,
            allProducts: Array.from(new Set([...orderRows.map(o => o.product_name), ...catRows.filter(c => c.type === 'PRODUCT').map(c => c.name)])).filter(Boolean),
            preOrders: preOrders,
            allSales: allSales,
            cancelledRefundPending: cancelledRefundPending,
            hiddenOrders: hiddenOrders || [],
            debtSales: debtSales,
            inventory: allOrders,
            groupedInventory: groupedInventory,
            warehouses: Array.from(whSet),
            warehouseItems: catRows.filter(c => c.type === 'WAREHOUSE' || c.type === 'WAREHOUSE_STATUS').map(c => ({ id: c.id, type: c.type, name: c.name })),
            purchasePlaces: Array.from(shopSet),
            sources: wallets.filter(w => w.type !== 'VIRTUAL').map(w => w.name),
            wallets: wallets.filter(w => w.type !== 'VIRTUAL'),
            suppliers: catRows.filter(c => c.type === 'SUPPLIER' || c.type === 'PARTNER' || c.type === 'FAMILY').map(c => c.name),
            partners: catRows.filter(c => c.type === 'PARTNER' || c.type === 'FAMILY').map(c => c.name),
            accounts: catRows.filter(c => c.type === 'ACCOUNT').map(c => c.name)
          },
          tab4: {
            success: true,
            isKian: isKian,
            summary: {
              net: totalReceivable - totalPayable,
              netDebt: totalReceivable - totalPayable,
              receivables: totalReceivable,
              payables: totalPayable,
              totalReceivable: totalReceivable,
              totalPayable: totalPayable
            },
            debts: debts,
            allDebts: debts,
            partners: Array.from(partnerSet),
            recurringDebts: recurringData ? (recurringData.items || []) : [],
            recurringPendingCount: recurringData ? (recurringData.pendingCount || 0) : 0,
            recurringPeriod: recurringData ? (recurringData.period || '') : ''
          },
          tab5: {
            summary: {},
            matrix: tab5Data.matrix,
            accounts: tab5Data.accounts,
            stores: tab5Data.stores,
            limits: []
          },
          orderCounts: {
            choShip: choShipCount,
            preorder: preorderCount,
            khachNo: khachNoCount,
            choHoan: choHoanCount
          },
          statsTrend: statsTrend,
          pendingPreOrders: [
            ...preOrders.map(p => ({
              id: p.id,
              tenSP: p.tenSP,
              content: p.tenSP,
              wallet: p.nguonTien,
              nguonTien: p.nguonTien,
              walletId: p.walletId,
              amount: p.total,
              total: p.total,
              note: p.ghiChu,
              date: p.ngayMua,
              ngayMua: p.ngayMua,
              trangThaiKho: p.trangThaiKho,
              source: 'Purchase'
            })),
            ...tab2Preorders.map(f => ({
              id: f.id,
              content: f.noidung,
              tenSP: f.noidung,
              wallet: f.nguontien,
              nguonTien: f.nguontien,
              walletId: f.walletId,
              amount: f.sotien,
              total: f.sotien,
              note: f.ghichu,
              date: f.ngay,
              ngay: f.ngay,
              source: 'Family'
            }))
          ]
        });
      }

      // 4. LẤY DỮ LIỆU TAB 2 (Thu Chi Gia Đình)
      case 'getTab2Data': {
        const [monthArg, yearArg] = args || [];
        const isAllMonth = (!monthArg || monthArg === "ALL" || String(monthArg).toUpperCase() === "ALL" || monthArg === "All");
        const isAllYear = (!yearArg || yearArg === "ALL" || String(yearArg).toUpperCase() === "ALL" || yearArg === "All");
        const targetMonth = isAllMonth ? null : parseInt(monthArg, 10);
        const targetYear = isAllYear ? null : parseInt(yearArg, 10);

        const [familyRows, t2Cats, t2Tpls, t2Wallets, t2JarConfigs, t2Orders, t2TxEvalMap, t2DebtRows] = await Promise.all([
          sql`
            SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date, payment_group_id
            FROM family_transactions
            ORDER BY date DESC, id DESC
          `,
          sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories ORDER BY id ASC`.catch(() => []),
          sql`SELECT id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden FROM family_templates WHERE is_hidden = false ORDER BY id ASC`.catch(() => []),
          sql`SELECT id, name, type, current_balance, is_hidden, is_deleted FROM wallets`.catch(() => []),
          sql`SELECT year, month, invest_amount, giaoduc_amount, pct_thietyeu, pct_tietkiem, pct_giaoduc, pct_giaitri, pct_chodi, raw_config FROM jar_configs ORDER BY year ASC, month ASC`.catch(() => []),
          sql`SELECT id, date, statement_date, total_amount, wallet_id, wallet_name, status, order_status, is_deleted, payment_group_id FROM business_orders WHERE is_deleted = false`.catch(() => []),
          fetchTxEvaluationsMap(sql, isKian),
          isKian
            ? sql`SELECT id, date, name, partner_id, content, amount, remaining_debt, type, status, note FROM debts ORDER BY id DESC`.catch(() => [])
            : Promise.resolve([])
        ]);

        const t2CatById = buildCategoryByIdMap(t2Cats);
        const t2WalletById = buildWalletByIdMap(t2Wallets);
        const t2CardBreakdownMaps = computeCreditCardDebtBreakdowns(t2Wallets, familyRows, t2Orders, t2DebtRows);

        const parseDateHelper = (dStr) => {
          if (!dStr) return null;
          const str = String(dStr).trim();
          const p = str.split('T')[0].split(/[-/]/);
          if (p.length >= 3) {
            if (p[0].length === 4) { // YYYY-MM-DD
              return { year: parseInt(p[0], 10), month: parseInt(p[1], 10) };
            } else { // DD-MM-YYYY
              return { year: parseInt(p[2], 10), month: parseInt(p[1], 10) };
            }
          }
          return null;
        };

        let totalIncome = 0;
        let totalExpense = 0;
        const huCatsActive = (t2Cats || []).filter(c => ALL_HU_TYPES.includes(String(c.type || '').toUpperCase()) && !c.is_hidden);
        const expenseHuCats = huCatsActive.filter(c => !SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(c.name)));
        const jarNames = expenseHuCats.length > 0 ? expenseHuCats.map(c => c.name) : DEFAULT_EXPENSE_JARS;
        const jarCatByNameLow = new Map(huCatsActive.map(c => [normalizeTextNoAccents(c.name), c]));
        const jarSpent = {};
        jarNames.forEach(j => { jarSpent[j] = 0; });

        const txList = [];
        const preorders = [];

        familyRows.forEach(f => {
          const amt = Number(f.amount || 0);
          const loai = String(f.type || '').trim().toLowerCase() === 'thu' ? 'Thu' : 'Chi';
          const dt = parseDateHelper(f.date);
          const st = String(f.status || 'ACTIVE').toUpperCase();
          const isPre = st.includes('PRE');
          const fHuId = normalizeCategoryId(f.hu_id);
          const fHuCat = fHuId ? t2CatById.get(fHuId) : null;
          const resolvedHu = fHuCat ? fHuCat.name : (f.hu || '');
          const fWId = String(f.wallet_id || '').trim();
          const fWObj = fWId ? t2WalletById.get(fWId) : null;
          const resolvedWallet = fWObj ? fWObj.name : (f.wallet_name || '');

          const settlementBreakdown = computeCardSettlementBreakdownForTx(f, t2CardBreakdownMaps);
          const evalInfo = isKian ? autoClassifySpendLevelServer(f, resolvedHu, t2TxEvalMap) : { evalLevel: '', evalIsManual: false };

          const txItem = {
            id: f.id,
            ngay: f.date,
            loai: loai,
            huId: fHuId,
            hu_id: fHuId,
            hu: resolvedHu,
            noidung: f.content || '',
            sotien: amt,
            walletId: fWId,
            wallet_id: fWId,
            nguontien: resolvedWallet,
            codinh: Boolean(f.is_fixed),
            ghichu: f.note || '',
            status: f.status || 'ACTIVE',
            statementDate: f.statement_date || '',
            statement_date: f.statement_date || '',
            paymentGroupId: String(f.payment_group_id || '').trim(),
            payment_group_id: String(f.payment_group_id || '').trim(),
            settlementBreakdown: settlementBreakdown || null,
            evalLevel: evalInfo.evalLevel || '',
            evalIsManual: Boolean(evalInfo.evalIsManual)
          };

          if (isPre) preorders.push(txItem);

          // Lọc theo Tháng & Năm
          const matchYear = isAllYear || !targetYear || (dt && dt.year === targetYear);
          const matchMonth = isAllMonth || !targetMonth || (dt && dt.month === targetMonth);

          if (matchYear && matchMonth) {
            txList.push(txItem);

            const contentStr = String(f.content || '');
            const noteStr = String(f.note || '');
            const huStr = String(resolvedHu || '');
            const isTagExcluded = String(f.id || '').startsWith('JTF_GOAL_') ||
                                  contentStr.includes("[Ứng hộ nhóm]") || contentStr.includes("[Tất toán") || contentStr.includes("[Thu nợ]") || contentStr.includes("[Trả nợ]") ||
                                  noteStr.includes("[Ứng hộ nhóm]") || noteStr.includes("[Tất toán") ||
                                  contentStr.includes("Chuyển tiền:") || contentStr.includes("Tất toán thẻ:");

            if (!isTagExcluded) {
              if (loai === 'Thu') {
                totalIncome += amt;
              } else {
                totalExpense += amt;
                jarNames.forEach(jName => {
                  const jCat = jarCatByNameLow.get(normalizeTextNoAccents(jName));
                  const matchById = jCat && fHuId && normalizeCategoryId(fHuId) === normalizeCategoryId(jCat.id);
                  if (matchById || huStr.toLowerCase().includes(jName.toLowerCase())) {
                    jarSpent[jName] += amt;
                  }
                });
              }
            }
          }
        });

        const t2Now = new Date();
        const jarSummary = computeJarSummaryHelper({
          familyRows,
          jarConfigs: t2JarConfigs,
          jarNames,
          jarCatByNameLow,
          allCatByIdMap: t2CatById,
          targetMonth: isAllMonth ? null : (targetMonth || (t2Now.getMonth() + 1)),
          targetYear: isAllYear ? null : (targetYear || t2Now.getFullYear()),
          isAllMonth,
          isAllYear
        });
        const jars = jarSummary.jars;
        const kianGoals = isKian
          ? await buildKianGoalsPayload(sql, {
              jars,
              debtRows: t2DebtRows,
              catByIdMap: t2CatById,
              wallets: t2Wallets,
              dbKey: targetDbKey
            }).catch(err => {
              console.error('buildKianGoalsPayload getTab2Data error:', err);
              return null;
            })
          : null;

        return res.status(200).json({
          success: true,
          isKian: isKian,
          kianGoals: isKian ? kianGoals : null,
          transactions: txList,
          preorders: preorders,
          jars: jars,
          lockedFundsTotal: kianGoals ? (kianGoals.goals || []).reduce((sum, g) => sum + (g.is_locked ? Math.max(0, Number(g.stats?.savedYen || g.initialYen || 0)) : 0), 0) : 0,
          lockedJarsTotal: kianGoals ? (kianGoals.goals || []).reduce((sum, g) => sum + (g.is_locked ? Math.max(0, Number(g.stats?.savedYen || g.initialYen || 0)) : 0), 0) : 0,
          kianIntelligence: isKian ? buildKianFinancialIntelligencePayload({
            familyRows,
            jarConfigs: t2JarConfigs,
            jars,
            allCatByIdMap: t2CatById,
            txEvalMap: t2TxEvalMap,
            targetMonth: isAllMonth ? (t2Now.getMonth() + 1) : (targetMonth || (t2Now.getMonth() + 1)),
            targetYear: isAllYear ? t2Now.getFullYear() : (targetYear || t2Now.getFullYear())
          }) : null,
          categories: mapTemplateCategoriesForClient(t2Tpls, t2CatById, t2WalletById),
          summary: {
            net: totalIncome - totalExpense,
            income: totalIncome,
            expense: totalExpense,
            totalIncome: totalIncome,
            totalExpense: totalExpense,
            netBalance: totalIncome - totalExpense,
            prevMonthIncome: jarSummary.prevMonthIncome
          }
        });
      }

      case 'saveTxSpendEvaluation': {
        if (!isKian) {
          return res.status(200).json({ success: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian' });
        }
        const [txIdArg, evalLevelArg] = args || [];
        const txId = String(txIdArg || '').trim();
        const evalLevel = String(evalLevelArg || '').trim().toUpperCase();
        if (!txId || !['ESSENTIAL', 'MODERATE', 'UNNECESSARY', 'UNCLASSIFIED'].includes(evalLevel)) {
          return res.status(200).json({ success: false, message: 'Dữ liệu phân loại không hợp lệ' });
        }
        await sql`
          CREATE TABLE IF NOT EXISTS tx_spend_evaluations (
            tx_id TEXT PRIMARY KEY,
            eval_level TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `.catch(() => {});
        await sql`
          INSERT INTO tx_spend_evaluations (tx_id, eval_level, updated_at)
          VALUES (${txId}, ${evalLevel}, NOW())
          ON CONFLICT (tx_id) DO UPDATE SET
            eval_level = EXCLUDED.eval_level,
            updated_at = NOW()
        `;
        return res.status(200).json({ success: true, txId, evalLevel });
      }

      // 5. LẤY DỮ LIỆU TAB 3 (Kinh Doanh)
      case 'getBusinessData':
      case 'getTab3Data': {
        const [monthArg, yearArg] = args || [];
        const data = await getBusinessDataHelper(sql, monthArg, yearArg);
        return res.status(200).json(data);
      }

      // 6. LẤY DỮ LIỆU TAB 4 (Công Nợ)
      case 'getTab4Data': {
        const [monthArg, yearArg] = args;
        const [debtRows, catRows, allWallets, recurringData] = await Promise.all([
          (async () => {
            try {
              return await sql`
                SELECT id, date, name, partner_id, content, amount, remaining_debt, type, wallet_id, wallet_name, status, note, recurring_id, recurring_period
                FROM debts
                ORDER BY id DESC
              `;
            } catch (err) {
              try {
                return await sql`
                  SELECT id, date, name, partner_id, content, amount, remaining_debt, type, wallet_id, wallet_name, status, note
                  FROM debts
                  ORDER BY id DESC
                `;
              } catch (e2) {
                return [];
              }
            }
          })(),
          sql`SELECT id, type, name, is_hidden FROM categories WHERE is_hidden = false ORDER BY id ASC`.catch(() => []),
          sql`SELECT id, name, type FROM wallets`.catch(() => []),
          getRecurringDebtsHelper(sql, monthArg, yearArg).catch(() => ({ items: [], pendingCount: 0, period: '' }))
        ]);

        const appCatByIdMap = buildCategoryByIdMap(catRows);
        const allWalletByIdMap = buildWalletByIdMap(allWallets);
        let totalReceivable = 0;
        let totalPayable = 0;
        const partnerSet = new Set((catRows || []).filter(c => c.type === 'PARTNER' || c.type === 'FAMILY').map(c => c.name));

        const debts = (debtRows || []).map(d => {
          const amt = Number(d.amount || 0);
          const duNo = Number(d.remaining_debt || 0);
          const daTra = amt - duNo;
          const loai = String(d.type || '').toUpperCase() === 'THU' ? 'THU' : 'TRA';
          const dPartnerId = normalizeCategoryId(d.partner_id);
          const dPartnerCat = dPartnerId ? appCatByIdMap.get(dPartnerId) : null;
          const pName = String(dPartnerCat ? dPartnerCat.name : (d.name || '')).trim();
          const rawDWId = String(d.wallet_id || '').trim();
          const rawDWName = String(d.wallet_name || '').trim();
          const dWObj = (rawDWId && allWalletByIdMap.get(rawDWId)) || (rawDWName && allWalletByIdMap.get(rawDWName)) || null;
          const dWId = dWObj ? String(dWObj.id) : rawDWId;
          const dWName = dWObj ? dWObj.name : rawDWName;
          if (pName) partnerSet.add(pName);

          if (duNo > 0) {
            if (loai === 'THU') totalReceivable += duNo;
            else totalPayable += duNo;
          }

          return {
            id: d.id,
            ngay: d.date,
            partnerId: dPartnerId,
            partner_id: dPartnerId,
            ten: pName,
            loai: loai,
            noidung: d.content || '',
            tongNo: amt,
            daTra: daTra,
            duNo: duNo,
            walletId: dWId,
            wallet_id: dWId,
            nguon: dWName,
            trangThai: d.status || 'ACTIVE',
            trangThaiDuNo: d.status || 'ACTIVE',
            ghichu: d.note || '',
            recurring_id: d.recurring_id || '',
            recurring_period: d.recurring_period || ''
          };
        });

        return res.status(200).json({
          success: true,
          isKian: isKian,
          summary: {
            net: totalReceivable - totalPayable,
            netDebt: totalReceivable - totalPayable,
            receivables: totalReceivable,
            payables: totalPayable,
            totalReceivable: totalReceivable,
            totalPayable: totalPayable
          },
          debts: debts,
          allDebts: debts,
          partners: Array.from(partnerSet),
          recurringDebts: recurringData ? (recurringData.items || []) : [],
          recurringPendingCount: recurringData ? (recurringData.pendingCount || 0) : 0,
          recurringPeriod: recurringData ? (recurringData.period || '') : ''
        });
      }

      // 7. BẢO MẬT XEM MẬT KHẨU THẺ (XÁC THỰC BẰNG MẬT KHẨU TÀI KHOẢN ĐĂNG NHẬP)
      case 't1_isValidCardPassword':
      case 'verifyCardPassword': {
        const [enteredPassword, tenantTarget, explicitUsername] = args;
        const p = String(enteredPassword || '').trim();
        let u = String(explicitUsername || (session && session.username) || '').trim().toLowerCase();
        if (!u) u = isKian ? 'kian' : 'tien';

        const masterSql = getMasterDb();
        let isValid = false;

        if (p) {
          const pHash = hashPassword(p);
          // 1. Kiểm tra tài khoản hiện tại
          const rows = await masterSql`
            SELECT user_id, username, password_hash 
            FROM master_users 
            WHERE LOWER(username) = ${u}
            LIMIT 1
          `;
          if (rows.length > 0) {
            const user = rows[0];
            isValid = (user.password_hash === p || user.password_hash === pHash);
          }

          // 2. Fallback: Nếu chưa khớp, kiểm tra toàn bộ user ACTIVE trong master_users
          if (!isValid) {
            const allUsers = await masterSql`SELECT username, password_hash FROM master_users WHERE status = 'ACTIVE'`;
            for (const user of allUsers) {
              if (user.password_hash === p || user.password_hash === pHash) {
                isValid = true;
                break;
              }
            }
          }
        }

        let cards = [];
        let virtualCards = [];
        if (isValid) {
          const [allWallets, historySet] = await Promise.all([
            sql`
              SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                     closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
                     card_number, card_exp, card_cvv, is_hidden, is_deleted
              FROM wallets
              ORDER BY id ASC
            `,
            getWalletsWithHistorySet(sql)
          ]);
          const cardWalletById = buildWalletByIdMap(allWallets);
          cards = allWallets.filter(w => String(w.type || '').toUpperCase() !== 'VIRTUAL').map((w, idx) => {
            const resolvedSettleName = (w.settle_source_id && cardWalletById.get(String(w.settle_source_id).trim()))
              ? cardWalletById.get(String(w.settle_source_id).trim()).name
              : (w.settle_source || '');
            const decNum = decryptCardField(w.card_number);
            const decExp = decryptCardField(w.card_exp);
            const decCvv = decryptCardField(w.card_cvv);
            const wLast4 = decNum ? decNum.replace(/\D/g, '').slice(-4) : extractCardLast4(w.card_number);
            return {
              id: w.id,
              row: idx + 2,
              name: w.name,
              type: w.type || 'DEBIT',
              hasHistory: historySet.has(String(w.id || '').trim().toLowerCase()) ||
                          historySet.has(String(w.name || '').trim().toLowerCase()) ||
                          Number(w.debt || 0) > 0 ||
                          Number(w.preorder || 0) > 0,
              credit_limit: Number(w.credit_limit || 0),
              limit: Number(w.credit_limit || 0),
              current_balance: Number(w.current_balance || 0),
              initial_balance: Number(w.initial_balance || 0),
              closing_date: w.closing_date || '',
              due_date: w.due_date || '',
              settle_source_id: w.settle_source_id || '',
              settleSourceId: w.settle_source_id || '',
              settle_source: resolvedSettleName,
              settleSource: resolvedSettleName,
              stmtFileHeaders: w.stmt_file_headers || null,
              stmtPasteHeaders: w.stmt_paste_headers || null,
              cardNumber: decNum || '',
              cardExp: decExp || '',
              cardCvv: decCvv || '',
              last4: wLast4,
              isVirtual: false,
              is_hidden: Boolean(w.is_hidden || w.status === 'DELETED' || w.is_deleted),
              is_deleted: Boolean(w.is_hidden || w.status === 'DELETED' || w.is_deleted)
            };
          });

          virtualCards = allWallets.filter(w => String(w.type || '').toUpperCase() === 'VIRTUAL').map((w, idx) => {
            const decNum = decryptCardField(w.card_number);
            const decExp = decryptCardField(w.card_exp);
            const decCvv = decryptCardField(w.card_cvv);
            const vLast4 = decNum ? decNum.replace(/\D/g, '').slice(-4) : extractCardLast4(w.card_number);
            return {
              id: w.id,
              row: idx + 2,
              name: w.name,
              vCardName: w.name,
              cardNumber: decNum || '',
              vCardNumber: decNum || '',
              cardExp: decExp || '',
              vCardExp: decExp || '',
              cardCvv: decCvv || '',
              vCardCvv: decCvv || '',
              last4: vLast4,
              isVirtual: true,
              type: 'VIRTUAL',
              status: w.status || 'ACTIVE',
              is_hidden: Boolean(w.is_hidden || w.status === 'DELETED' || w.is_deleted),
              is_deleted: Boolean(w.is_hidden || w.status === 'DELETED' || w.is_deleted)
            };
          });
        }

        return res.status(200).json({
          success: isValid,
          isValid: isValid,
          message: isValid ? 'Mật khẩu chính xác!' : 'Mật khẩu tài khoản đăng nhập không chính xác!',
          cards: cards,
          virtualCards: virtualCards
        });
      }

      // 8. PHIÊN BẢN ỨNG DỤNG
      case 'getAppVersion': {
        return res.status(200).json({ success: true, version: 'V32.8.2-CLOUD-NEON' });
      }

      // 9. DANH MỤC THIẾT LẬP BAN ĐẦU
      case 'getInitialSetupCategories': {
        const [allCategories, allTemplates, allWallets, usedItems] = await Promise.all([
          sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`,
          sql`SELECT id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden FROM family_templates ORDER BY id ASC`.catch(() => []),
          sql`SELECT id, name, type, card_number, card_exp, card_cvv, status, is_hidden, is_deleted FROM wallets ORDER BY id ASC`.catch(() => []),
          fetchSetupUsedSets(sql)
        ]);
        const payload = buildSetupCategoryResponsePayload(allCategories, allTemplates, allWallets, usedItems, isKian);
        return res.status(200).json({
          success: true,
          ...payload
        });
      }

      // 10. THỐNG KÊ XU HƯỚNG TÀI CHÍNH 3T, 6T, 12T
      case 'getFinancialTrendStats': {
        const cycle = parseInt((args && args[0]) || 3, 10);
        const aMonth = (args && args[1]) ? parseInt(args[1], 10) : null;
        const aYear = (args && args[2]) ? parseInt(args[2], 10) : null;
        const result = await computeFinancialTrendStats(sql, cycle, aMonth, aYear);
        return res.status(200).json(result);
      }

      // 10b. BÁO CÁO LỊCH CHI TIÊU GIA ĐÌNH THEO THÁNG
      case 'getFamilyExpenseCalendar': {
        const monthArg = (args && args[0] !== undefined && args[0] !== null && args[0] !== '') ? parseInt(args[0], 10) : null;
        const yearArg = (args && args[1] !== undefined && args[1] !== null && args[1] !== '') ? parseInt(args[1], 10) : null;
        const result = await computeFamilyExpenseCalendar(sql, monthArg, yearArg);
        return res.status(200).json(result);
      }

      // 11. THÊM GIAO DỊCH THU CHI (Tab 2)
      case 'saveFamilyTransaction': {
        const formData = args[0] || {};
        const id = String(formData.id || ('FAM_' + Date.now()));
        const date = String(formData.date || formData.ngay || new Date().toISOString().slice(0, 10));
        const type = String(formData.type || formData.loai || 'Chi').trim();
        const rawHuId = formData.huId ?? formData.hu_id ?? null;
        const rawHuName = String(formData.hu || 'Thiết yếu').trim();
        const huCats = await sql`SELECT id, type, name, is_hidden FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') ORDER BY id ASC`.catch(() => []);
        let resolvedHuCat = resolveHuCategory(huCats, { huId: rawHuId, huName: rawHuName });
        if (!resolvedHuCat && rawHuName) {
          resolvedHuCat = await ensureCategoryExistsByName(sql, huCats, 'HU', rawHuName);
        }
        const huId = resolvedHuCat ? String(resolvedHuCat.id) : null;
        const hu = resolvedHuCat ? String(resolvedHuCat.name) : rawHuName;
        const content = String(formData.content || formData.noidung || '').trim();
        const amount = Number(formData.amount || formData.sotien || 0);
        const rawWalletId = String(formData.walletId || formData.wallet_id || '').trim();
        const rawWalletName = String(formData.wallet_name || formData.nguontien || '').trim();
        const resolvedWallet = await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName });
        const walletId = resolvedWallet ? String(resolvedWallet.id) : rawWalletId;
        const walletName = resolvedWallet ? String(resolvedWallet.name) : rawWalletName;
        const isFixed = Boolean(formData.is_fixed || formData.codinh);
        const isTemplate = Boolean(formData.mau);
        const note = String(formData.note || formData.ghichu || '').trim();
        const status = String(formData.status || 'ACTIVE').trim();

        const rawStmtDate = String(formData.statement_date || formData.statementDate || formData.ngaySaoKe || '').trim();
        let statementDate = '';
        if (rawStmtDate) {
          const sp = rawStmtDate.split('T')[0].split(/[-/]/);
          if (sp.length === 2) {
            statementDate = (sp[0].length === 4) ? `${sp[0]}-${sp[1].padStart(2, '0')}-01` : `${sp[1]}-${sp[0].padStart(2, '0')}-01`;
          } else if (sp.length >= 3) {
            statementDate = (sp[0].length === 4) ? `${sp[0]}-${sp[1].padStart(2, '0')}-${sp[2].padStart(2, '0')}` : `${sp[2]}-${sp[1].padStart(2, '0')}-${sp[0].padStart(2, '0')}`;
          } else {
            statementDate = rawStmtDate;
          }
        }

        await sql`
          INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date)
          VALUES (${id}, ${date}, ${type}, ${huId}, ${huId || hu}, ${content}, ${amount}, ${walletId}, ${walletId || walletName}, ${isFixed}, ${note}, ${status}, ${statementDate || null})
          ON CONFLICT (id) DO UPDATE SET
            date = EXCLUDED.date,
            type = EXCLUDED.type,
            hu_id = EXCLUDED.hu_id,
            hu = EXCLUDED.hu,
            content = EXCLUDED.content,
            amount = EXCLUDED.amount,
            wallet_id = EXCLUDED.wallet_id,
            wallet_name = EXCLUDED.wallet_name,
            is_fixed = EXCLUDED.is_fixed,
            note = EXCLUDED.note,
            status = EXCLUDED.status,
            statement_date = COALESCE(EXCLUDED.statement_date, family_transactions.statement_date)
        `;

        if (isTemplate && content) {
          await upsertFamilyTemplateCategory(sql, { content, huId, huName: hu, walletId, walletName });
        }

        const isThu = type.toLowerCase() === 'thu';
        const isPreFam = String(status || '').toUpperCase().includes('PRE');
        const famDeltaRes = await applyFamilyWalletDelta(sql, {
          walletRow: resolvedWallet,
          walletId,
          walletName,
          amount,
          isThu,
          isPre: isPreFam,
          sign: 1
        });
        const famBalAfter = famDeltaRes.balanceAfter;
        const isCreditFam = famDeltaRes.isCredit;

        if ((walletId || walletName) && amount > 0) {
          const famLedNote = (content || note)
            ? `${content}${note && note !== content ? ' (' + note + ')' : ''}`
            : (isThu ? 'Thu nhập' : 'Chi tiêu');
          await upsertWalletLedgerEntry(sql, {
            date,
            statementDate: statementDate || '',
            walletId,
            walletName,
            eventType: isThu ? 'FAMILY_INCOME' : 'FAMILY_EXPENSE',
            effectType: isPreFam ? 'PREORDER_HOLD' : (isCreditFam ? 'CARD_DEBT' : 'CASH'),
            amount,
            balanceAfter: famBalAfter,
            note: famLedNote,
            orderId: id,
            status: isPreFam ? 'PENDING' : 'POSTED',
            direction: isThu ? (isCreditFam ? 'DECREASE' : 'IN') : (isCreditFam ? 'INCREASE' : 'OUT'),
            sourceModule: 'Family'
          });
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        const savedItem = {
          id: id,
          row: id,
          ngay: date,
          loai: type,
          huId: huId,
          hu_id: huId,
          hu: hu,
          noidung: content,
          sotien: amount,
          walletId: walletId,
          wallet_id: walletId,
          nguon: walletName,
          nguontien: walletName,
          codinh: isFixed,
          ghichu: note,
          status: status,
          statementDate: statementDate || '',
          statement_date: statementDate || ''
        };

        return res.status(200).json({
          success: true,
          message: 'Đã lưu giao dịch vào database Vercel!',
          id,
          savedItem,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 11A-2. LẤY CHI TIẾT 1 GIAO DỊCH THU CHI THEO ID (KỂ CẢ THÁNG KHÁC)
      case 'getFamilyTransactionById': {
        let targetId = String((args && args[0]) || '').trim();
        if (!targetId) return res.status(200).json({ success: false, message: 'Mã giao dịch không hợp lệ' });

        // Nếu targetId là ID sổ cái (LED-...), tìm order_id gốc trong wallet_ledger
        if (targetId.startsWith('LED-')) {
          const ledRows = await sql`SELECT order_id FROM wallet_ledger WHERE id = ${targetId} LIMIT 1`.catch(() => []);
          if (ledRows && ledRows.length > 0 && ledRows[0].order_id) {
            targetId = String(ledRows[0].order_id).trim();
          }
        }

        const [rows, cats, wals] = await Promise.all([
          sql`SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date, payment_group_id FROM family_transactions WHERE id = ${targetId} LIMIT 1`,
          sql`SELECT id, name, type FROM categories`,
          sql`SELECT id, name, type FROM wallets`
        ]);
        if (!rows || rows.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy giao dịch thu chi #' + targetId });
        }
        const f = rows[0];
        const catMap = buildCategoryByIdMap(cats || []);
        const walMap = buildWalletByIdMap(wals || []);
        const huId = normalizeCategoryId(f.hu_id || f.hu);
        const huObj = huId ? catMap.get(huId) : null;
        const wId = String(f.wallet_id || '').trim();
        const wNameRaw = String(f.wallet_name || '').trim();
        const wObj = (wId && walMap.get(wId)) || (wNameRaw && walMap.get(wNameRaw)) || null;
        return res.status(200).json({
          success: true,
          tx: {
            rowId: f.id,
            id: f.id,
            ngay: f.date || '',
            loai: String(f.type || '').toUpperCase() === 'THU' ? 'THU' : 'CHI',
            hu: huObj ? huObj.name : (f.hu || ''),
            noidung: f.content || '',
            sotien: Number(f.amount || 0),
            nguon: wObj ? wObj.name : wNameRaw,
            walletId: wObj ? String(wObj.id) : wId,
            isFixed: Boolean(f.is_fixed),
            isTemplate: false,
            isPreOrder: String(f.status || '').toUpperCase().includes('PRE'),
            statementDate: f.statement_date || '',
            paymentGroupId: String(f.payment_group_id || '').trim()
          }
        });
      }

      // 11B. CẬP NHẬT GIAO DỊCH THU CHI / SỔ CÁI / SAO KÊ CHI TIẾT (Tab 2 & Tab 1)
      case 'updateFamilyTransaction':
      case 'updateFamilyTransactionById': {
        const formData = (typeof args[0] === 'object' && args[0] !== null) ? args[0] : (args[1] || {});
        const explicitId = typeof args[0] === 'string' ? args[0] : '';
        const targetId = String(explicitId || formData.id || formData.row || '').trim();
        if (!targetId) return res.status(200).json({ success: false, message: 'Mã giao dịch không hợp lệ' });

        const date = String(formData.date || formData.ngay || new Date().toISOString().slice(0, 10));
        const type = String(formData.type || formData.loai || 'Chi').trim();
        const hu = String(formData.hu || 'Thiết yếu').trim();
        const content = String(formData.content || formData.noidung || '').trim();
        const amount = Number(formData.amount || formData.sotien || 0);
        const rawEditWalletId = String(formData.walletId || formData.wallet_id || '').trim();
        const rawEditWalletName = String(formData.wallet_name || formData.nguontien || '').trim();
        const resolvedEditWallet = (rawEditWalletId || rawEditWalletName)
          ? await findWalletByOrderName(sql, { walletId: rawEditWalletId, walletName: rawEditWalletName })
          : null;
        const walletId = resolvedEditWallet ? String(resolvedEditWallet.id) : rawEditWalletId;
        const walletName = resolvedEditWallet ? String(resolvedEditWallet.name) : rawEditWalletName;
        const isFixed = Boolean(formData.is_fixed || formData.codinh);
        const note = String(formData.note !== undefined ? formData.note : (formData.ghichu !== undefined ? formData.ghichu : '')).trim();
        const status = String(formData.status || 'ACTIVE').trim();

        // Chuẩn hóa Kỳ sao kê (statementDate / statement_date)
        const rawStmtDate = formData.statementDate !== undefined ? formData.statementDate : (formData.statement_date !== undefined ? formData.statement_date : (formData.ngaySaoKe !== undefined ? formData.ngaySaoKe : null));
        let isoStatementDate = null;
        if (rawStmtDate !== null) {
          const str = String(rawStmtDate).trim();
          if (str) {
            const p = str.split('T')[0].split(/[-/]/);
            if (p.length === 2) {
              if (p[0].length === 4) isoStatementDate = `${p[0]}-${p[1].padStart(2, '0')}-01`;
              else isoStatementDate = `${p[1]}-${p[0].padStart(2, '0')}-01`;
            } else if (p.length >= 3) {
              if (p[0].length === 4) isoStatementDate = `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
              else isoStatementDate = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
            } else {
              isoStatementDate = str;
            }
          } else {
            isoStatementDate = '';
          }
        }

        // 1. Kiểm tra và cập nhật wallet_ledger (Sổ Cái / Chi tiết thẻ)
        let ledgerUpdated = false;
        try {
          const ledRows = await sql`
            SELECT id, order_id, wallet_id, wallet_name, transaction_date, amount, note, statement_date, source_module, effect_type, event_type, direction, payment_group_id
            FROM wallet_ledger
            WHERE id = ${targetId} OR order_id = ${targetId}
            LIMIT 1
          `;
          if (ledRows.length > 0) {
            const led = ledRows[0];
            const ledPgId = String(led.payment_group_id || '').trim();
            const newStmt = isoStatementDate !== null ? isoStatementDate : (led.statement_date || '');
            const newDate = (formData.date || formData.ngay) ? date : led.transaction_date;
            const newNote = (formData.note !== undefined || formData.ghichu !== undefined) ? note : led.note;
            const newAmt = ledPgId
              ? Number(led.amount || 0)
              : ((!isNaN(amount) && amount > 0) ? amount : Number(led.amount || 0));

            const oldLedAmt = Number(led.amount || 0);
            const amtDiff = ledPgId ? 0 : (newAmt - oldLedAmt);

            if (ledPgId) {
              await Promise.all([
                sql`
                  UPDATE business_orders SET
                    statement_date = ${newStmt},
                    date = ${newDate}
                  WHERE payment_group_id = ${ledPgId} AND is_deleted = false
                `.catch(() => {}),
                sql`
                  UPDATE family_transactions SET
                    statement_date = ${newStmt},
                    date = ${newDate}
                  WHERE payment_group_id = ${ledPgId}
                `.catch(() => {})
              ]);
              await syncPaymentGroupLedger(sql, ledPgId, {
                date: newDate,
                statementDate: newStmt,
                commonNote: (formData.note !== undefined || formData.ghichu !== undefined) ? note : undefined
              });
              ledgerUpdated = true;
            } else {
              await sql`
                UPDATE wallet_ledger SET
                  transaction_date = ${newDate},
                  amount = ${newAmt},
                  note = ${newNote},
                  statement_date = ${newStmt}
                WHERE id = ${led.id}
              `;
              ledgerUpdated = true;

              // Đồng bộ biến động số dư / nợ ví khi chỉnh sửa số tiền trên Sổ cái:
              if (amtDiff !== 0) {
                const evType = String(led.event_type || '').toUpperCase();
                const effType = String(led.effect_type || '').toUpperCase();
                const ledWId = String(led.wallet_id || '').trim();
                const ledWName = String(led.wallet_name || '').trim();

                // A. Tất toán thẻ tín dụng (CARD_SETTLE):
                if (evType === 'CARD_SETTLE') {
                  await sql`
                    UPDATE wallets
                    SET debt = GREATEST(0, debt - ${amtDiff})
                    WHERE (${ledWId ? sql`id = ${ledWId}` : sql`1=0`} OR LOWER(TRIM(name)) = LOWER(TRIM(${ledWName})))
                  `;
                  if (led.order_id) {
                    const pairedRows = await sql`
                      SELECT id, wallet_id, wallet_name, amount
                      FROM wallet_ledger
                      WHERE order_id = ${led.order_id} AND id != ${led.id}
                      LIMIT 1
                    `.catch(() => []);
                    if (pairedRows.length > 0) {
                      const p = pairedRows[0];
                      await sql`UPDATE wallet_ledger SET amount = ${newAmt}, transaction_date = ${newDate} WHERE id = ${p.id}`;
                      await sql`
                        UPDATE wallets
                        SET current_balance = current_balance - ${amtDiff}
                        WHERE (${p.wallet_id ? sql`id = ${p.wallet_id}` : sql`1=0`} OR LOWER(TRIM(name)) = LOWER(TRIM(${p.wallet_name})))
                      `;
                    }
                    await sql`UPDATE family_transactions SET amount = ${newAmt}, date = ${newDate} WHERE id = ${led.order_id}`.catch(() => {});
                  }
                } else if (effType === 'CARD_DEBT') {
                  const dir = String(led.direction || '').toUpperCase();
                  const sign = (dir === 'DECREASE' || dir === 'OUT' || dir === '+') ? -1 : 1;
                  const debtDelta = sign * amtDiff;
                  await sql`
                    UPDATE wallets
                    SET debt = GREATEST(0, debt + ${debtDelta})
                    WHERE (${ledWId ? sql`id = ${ledWId}` : sql`1=0`} OR LOWER(TRIM(name)) = LOWER(TRIM(${ledWName})))
                  `;
                } else if (effType === 'PREORDER_HOLD') {
                  const dir = String(led.direction || '').toUpperCase();
                  const sign = (dir === 'DECREASE' || dir === 'OUT' || dir === '+') ? -1 : 1;
                  const preDelta = sign * amtDiff;
                  await sql`
                    UPDATE wallets
                    SET preorder = GREATEST(0, preorder + ${preDelta})
                    WHERE (${ledWId ? sql`id = ${ledWId}` : sql`1=0`} OR LOWER(TRIM(name)) = LOWER(TRIM(${ledWName})))
                  `;
                }
              }

              // Nếu liên kết với Đơn mua/bán hàng (business_orders)
              if (led.order_id) {
                await sql`
                  UPDATE business_orders SET
                    statement_date = ${newStmt},
                    date = ${newDate}
                  WHERE id = ${led.order_id} OR id LIKE ${led.order_id + '-%'}
                `;
              }

              // Nếu liên kết với family_transactions
              await sql`
                UPDATE family_transactions SET
                  statement_date = ${newStmt},
                  date = ${newDate},
                  note = ${newNote},
                  amount = CASE WHEN ${!isNaN(amount) && amount > 0} THEN ${newAmt} ELSE amount END
                WHERE id = ${targetId} OR id = ${led.order_id || ''}
              `;

              // Nếu liên kết với debts
              await sql`
                UPDATE debts SET
                  date = ${newDate}
                WHERE id = ${targetId} OR id = ${led.order_id || ''}
              `.catch(() => {});
            }
          }
        } catch(e) {
          console.error('Update wallet_ledger error:', e);
        }

        // 2. Kiểm tra nếu targetId là business_orders (đơn hàng)
        try {
          const boRows = await sql`
            SELECT id, date, statement_date
            FROM business_orders
            WHERE id = ${targetId} OR id LIKE ${targetId + '-%'}
            LIMIT 1
          `;
          if (boRows.length > 0) {
            const stmtToSet = isoStatementDate !== null ? isoStatementDate : boRows[0].statement_date;
            await sql`
              UPDATE business_orders SET
                date = ${date},
                statement_date = ${stmtToSet}
              WHERE id = ${targetId} OR id LIKE ${targetId + '-%'}
            `;
            await sql`
              UPDATE wallet_ledger SET
                transaction_date = ${date},
                statement_date = ${stmtToSet}
              WHERE id = ${targetId} OR order_id = ${targetId} OR order_id LIKE ${targetId + '-%'}
            `;
          }
        } catch(e) {
          console.error('Update business_orders error:', e);
        }

        // 3. Hoàn lại số dư cũ và cập nhật family_transactions (Thu Chi gia đình)
        const [prevTx, huCatsEdit] = await Promise.all([
          sql`
            SELECT id, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date, payment_group_id
            FROM family_transactions
            WHERE id = ${targetId}
            LIMIT 1
          `,
          sql`SELECT id, type, name, is_hidden FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') ORDER BY id ASC`.catch(() => [])
        ]);
        let resolvedEditHuId = normalizeCategoryId(formData.huId ?? formData.hu_id);
        let resolvedEditHuName = hu;
        if (prevTx.length > 0) {
          const oldRow = prevTx[0];
          const oldAmt = Number(oldRow.amount || 0);
          const oldWId = String(oldRow.wallet_id || '').trim();
          const oldWName = String(oldRow.wallet_name || '').trim();
          const oldIsThu = String(oldRow.type || '').toLowerCase() === 'thu';
          const oldIsPre = String(oldRow.status || '').toUpperCase().includes('PRE');
          const targetWId = walletId || oldWId;
          const targetWName = walletName || oldWName;
          const isWalletChanged = targetWId && oldWId ? (targetWId !== oldWId) : (oldWName !== targetWName);

          const effectiveType = (formData.type !== undefined || formData.loai !== undefined) ? type : String(oldRow.type || type).trim();
          const rawEffectiveHu = (formData.hu !== undefined) ? hu : String(oldRow.hu || hu).trim();
          let huCatObj = resolveHuCategory(huCatsEdit, {
            huId: (formData.huId ?? formData.hu_id) ?? (formData.hu === undefined ? oldRow.hu_id : null),
            huName: rawEffectiveHu
          });
          if (!huCatObj && rawEffectiveHu) {
            huCatObj = await ensureCategoryExistsByName(sql, huCatsEdit, 'HU', rawEffectiveHu);
          }
          const effectiveHuId = huCatObj ? String(huCatObj.id) : normalizeCategoryId(oldRow.hu_id);
          const effectiveHu = huCatObj ? String(huCatObj.name) : rawEffectiveHu;
          resolvedEditHuId = effectiveHuId;
          resolvedEditHuName = effectiveHu;
          const effectiveContent = (formData.content !== undefined || formData.noidung !== undefined) ? content : String(oldRow.content || content).trim();
          const effectiveIsFixed = (formData.is_fixed !== undefined || formData.codinh !== undefined) ? isFixed : Boolean(oldRow.is_fixed);
          const effectiveNote = (formData.note !== undefined || formData.ghichu !== undefined) ? note : String(oldRow.note || '').trim();
          const effectiveStatus = (formData.status !== undefined) ? status : String(oldRow.status || status).trim();
          const finalAmt = amount > 0 ? amount : oldAmt;
          const newIsThu = effectiveType.toLowerCase() === 'thu';
          const newIsPre = effectiveStatus.toUpperCase().includes('PRE');
          const needsBalanceRecompute = isWalletChanged || (finalAmt !== oldAmt) || (oldIsThu !== newIsThu) || (oldIsPre !== newIsPre);

          if ((oldWId || oldWName) && oldAmt > 0 && needsBalanceRecompute) {
            await applyFamilyWalletDelta(sql, {
              walletId: oldWId,
              walletName: oldWName,
              amount: oldAmt,
              isThu: oldIsThu,
              isPre: oldIsPre,
              sign: -1
            });
          }

          const stmtToSet = isoStatementDate !== null ? isoStatementDate : oldRow.statement_date;
          await sql`
            UPDATE family_transactions SET
              date = ${date},
              type = ${effectiveType},
              hu_id = ${effectiveHuId},
              hu = ${effectiveHuId || effectiveHu},
              content = ${effectiveContent},
              amount = ${finalAmt},
              wallet_id = ${targetWId},
              wallet_name = ${targetWId || targetWName},
              is_fixed = ${effectiveIsFixed},
              note = ${effectiveNote},
              status = ${effectiveStatus},
              statement_date = ${stmtToSet}
            WHERE id = ${targetId}
          `;

          if (Boolean(formData.mau) && effectiveContent) {
            await upsertFamilyTemplateCategory(sql, { content: effectiveContent, huId: effectiveHuId, huName: effectiveHu, walletId: targetWId, walletName: targetWName });
          }

          let appliedRes = null;
          if ((targetWId || targetWName) && finalAmt > 0 && needsBalanceRecompute) {
            appliedRes = await applyFamilyWalletDelta(sql, {
              walletId: targetWId,
              walletName: targetWName,
              amount: finalAmt,
              isThu: newIsThu,
              isPre: newIsPre,
              sign: 1
            });
          }

          const oldPgId = String(oldRow.payment_group_id || '').trim();
          if (oldPgId) {
            const groupBreakChanged = isWalletChanged || (oldIsPre !== newIsPre) || (oldIsThu !== newIsThu);
            if (groupBreakChanged) {
              const [sibFam, sibBiz] = await Promise.all([
                sql`SELECT id FROM family_transactions WHERE payment_group_id = ${oldPgId} AND id != ${targetId} AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY') LIMIT 1`.catch(() => []),
                sql`SELECT id FROM business_orders WHERE payment_group_id = ${oldPgId} AND is_deleted = false AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN') LIMIT 1`.catch(() => [])
              ]);
              if (sibFam.length > 0 || sibBiz.length > 0) {
                await sql`UPDATE family_transactions SET payment_group_id = '' WHERE id = ${targetId}`;
                if ((targetWId || targetWName) && finalAmt > 0) {
                  const nwObj = appliedRes?.wallet || await findWalletByOrderName(sql, { walletId: targetWId, walletName: targetWName });
                  const isCreditEdit = appliedRes ? appliedRes.isCredit : (nwObj ? String(nwObj.type).toUpperCase() === 'CREDIT' : false);
                  const balAfterEdit = appliedRes ? appliedRes.balanceAfter : (nwObj ? Number(nwObj.current_balance || 0) : 0);
                  const editLedNote = (effectiveContent || effectiveNote)
                    ? `${effectiveContent}${effectiveNote && effectiveNote !== effectiveContent ? ' (' + effectiveNote + ')' : ''}`
                    : (newIsThu ? 'Thu nhập' : 'Chi tiêu');
                  await upsertWalletLedgerEntry(sql, {
                    date,
                    statementDate: stmtToSet || '',
                    walletId: nwObj ? String(nwObj.id) : targetWId,
                    walletName: nwObj ? String(nwObj.name) : targetWName,
                    eventType: newIsThu ? 'FAMILY_INCOME' : 'FAMILY_EXPENSE',
                    effectType: newIsPre ? 'PREORDER_HOLD' : (isCreditEdit ? 'CARD_DEBT' : 'CASH'),
                    amount: finalAmt,
                    balanceAfter: balAfterEdit,
                    note: editLedNote,
                    orderId: targetId,
                    status: newIsPre ? 'PENDING' : 'POSTED',
                    direction: newIsThu ? (isCreditEdit ? 'DECREASE' : 'IN') : (isCreditEdit ? 'INCREASE' : 'OUT'),
                    sourceModule: 'Family'
                  });
                }
                await syncPaymentGroupLedger(sql, oldPgId);
              } else {
                const nwObj = appliedRes?.wallet || await findWalletByOrderName(sql, { walletId: targetWId, walletName: targetWName });
                const isCreditEdit = appliedRes ? appliedRes.isCredit : (nwObj ? String(nwObj.type).toUpperCase() === 'CREDIT' : false);
                await syncPaymentGroupLedger(sql, oldPgId, {
                  walletId: nwObj ? String(nwObj.id) : targetWId,
                  walletName: nwObj ? String(nwObj.name) : targetWName,
                  isCredit: isCreditEdit,
                  date,
                  statementDate: stmtToSet || '',
                  isPreOrder: newIsPre
                });
              }
            } else {
              await syncPaymentGroupLedger(sql, oldPgId, {
                date,
                statementDate: stmtToSet || ''
              });
            }
          } else if ((!ledgerUpdated || needsBalanceRecompute) && (targetWId || targetWName) && finalAmt > 0) {
            const nwObj = appliedRes?.wallet || await findWalletByOrderName(sql, { walletId: targetWId, walletName: targetWName });
            const isCreditEdit = appliedRes ? appliedRes.isCredit : (nwObj ? String(nwObj.type).toUpperCase() === 'CREDIT' : false);
            const balAfterEdit = appliedRes ? appliedRes.balanceAfter : (nwObj ? Number(nwObj.current_balance || 0) : 0);
            const editLedNote = (effectiveContent || effectiveNote)
              ? `${effectiveContent}${effectiveNote && effectiveNote !== effectiveContent ? ' (' + effectiveNote + ')' : ''}`
              : (newIsThu ? 'Thu nhập' : 'Chi tiêu');
            await upsertWalletLedgerEntry(sql, {
              date,
              statementDate: stmtToSet || '',
              walletId: nwObj ? String(nwObj.id) : targetWId,
              walletName: nwObj ? String(nwObj.name) : targetWName,
              eventType: newIsThu ? 'FAMILY_INCOME' : 'FAMILY_EXPENSE',
              effectType: newIsPre ? 'PREORDER_HOLD' : (isCreditEdit ? 'CARD_DEBT' : 'CASH'),
              amount: finalAmt,
              balanceAfter: balAfterEdit,
              note: editLedNote,
              orderId: targetId,
              status: newIsPre ? 'PENDING' : 'POSTED',
              direction: newIsThu ? (isCreditEdit ? 'DECREASE' : 'IN') : (isCreditEdit ? 'INCREASE' : 'OUT'),
              sourceModule: 'Family'
            });
          }
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        const savedItem = {
          id: targetId,
          row: targetId,
          ngay: date,
          loai: type,
          huId: resolvedEditHuId,
          hu_id: resolvedEditHuId,
          hu: resolvedEditHuName,
          noidung: content,
          sotien: amount,
          walletId: walletId,
          wallet_id: walletId,
          nguon: walletName,
          nguontien: walletName,
          codinh: isFixed,
          ghichu: note,
          status: status,
          statementDate: isoStatementDate || ''
        };

        return res.status(200).json({
          success: true,
          message: 'Đã cập nhật giao dịch thành công!',
          id: targetId,
          savedItem,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 12. XÓA GIAO DỊCH THU CHI (Tab 2)
      case 'deleteFamilyTransaction':
      case 'deleteTransaction': {
        const raw = args[0] || (req.body && (req.body.id || req.body.rowId || req.body.row));
        const id = String((typeof raw === 'object' && raw !== null) ? (raw.id || raw.rowId || raw.row || '') : (raw || '')).trim();
        if (!id) return res.status(200).json({ success: false, message: 'Mã giao dịch không hợp lệ' });

        const pairedId = getPairedTransferTransactionId(id);
        const targetIds = pairedId ? [id, pairedId] : [id];
        const txRows = await sql`
          SELECT id, type, amount, wallet_id, wallet_name, status, note, content, payment_group_id
          FROM family_transactions
          WHERE id = ANY(${targetIds})
        `;
        const affectedFamPgIds = [];
        for (const row of txRows) {
          const rowId = String(row.id || '').trim();
          const rowPgId = String(row.payment_group_id || '').trim();
          const amount = Number(row.amount || 0);
          const walletId = String(row.wallet_id || '').trim();
          const walletName = String(row.wallet_name || '').trim();
          const isThu = String(row.type || '').toLowerCase() === 'thu';
          const isPre = String(row.status || '').toUpperCase().includes('PRE');

          // Kiểm tra nếu là Tất toán thẻ (SETL_...): phục hồi dư nợ cho thẻ tín dụng
          const isSettleTx = rowId.startsWith('SETL_') ||
                             String(row.content || '').toLowerCase().includes('tất toán thẻ') ||
                             String(row.note || '').toLowerCase().includes('tất toán thẻ');
          if (isSettleTx) {
            const setlCardLed = await sql`
              SELECT wallet_id, wallet_name, amount
              FROM wallet_ledger
              WHERE (order_id = ${rowId} OR id = ${rowId}) AND event_type = 'CARD_SETTLE'
              LIMIT 1
            `.catch(() => []);
            if (setlCardLed.length > 0) {
              const sc = setlCardLed[0];
              const setlAmt = Number(sc.amount || amount || 0);
              await sql`
                UPDATE wallets
                SET debt = debt + ${setlAmt}
                WHERE (${sc.wallet_id ? sql`id = ${sc.wallet_id}` : sql`1=0`} OR LOWER(TRIM(name)) = LOWER(TRIM(${sc.wallet_name})))
              `;
            }
          }

          if ((walletId || walletName) && amount > 0) {
            await applyFamilyWalletDelta(sql, {
              walletId,
              walletName,
              amount,
              isThu,
              isPre,
              sign: -1
            });
          }

          await sql`DELETE FROM family_transactions WHERE id = ${rowId}`;
          if (rowPgId) {
            affectedFamPgIds.push(rowPgId);
          } else {
            await sql`UPDATE wallet_ledger SET status = 'DELETED' WHERE order_id = ${rowId} OR id = ${rowId}`.catch(() => {});
          }
        }
        for (const pgId of Array.from(new Set(affectedFamPgIds))) {
          await syncPaymentGroupLedger(sql, pgId);
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        return res.status(200).json({
          success: true,
          message: 'Đã xóa giao dịch khỏi database Vercel!',
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 13. LƯU ĐƠN MUA HÀNG (Tab 3)
      case 'savePurchaseOrder': {
        const formData = args[0] || {};
        const baseId = String(formData.id || ('PO-' + Date.now().toString().slice(-10)));
        const date = String(formData.date || formData.ngayMua || formData.ngay || new Date().toISOString().slice(0, 10));
        const rawWalletId = String(formData.walletId || formData.wallet_id || '').trim();
        const rawWalletName = String(formData.wallet_name || formData.nguonTien || '').trim();
        const rawShop = String(formData.shop || formData.noiMua || '').trim();
        const rawAccount = String(formData.taiKhoan || formData.taiKhoanMua || '').trim();
        const isOpeningStock = Boolean(formData.isOpeningStock || rawWalletName.toUpperCase().includes('TỒN KHO'));
        const isMuonThe = Boolean(formData.isMuonThe);
        const doiTacMuon = String(formData.doiTacMuon || '').trim();

        const poCatRows = await sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => []);
        let matchedShopCat = resolveCategoryByIdOrName(poCatRows, ['SHOP'], { id: formData.shopId, name: rawShop });
        if (!matchedShopCat && rawShop) {
          matchedShopCat = await ensureCategoryExistsByName(sql, poCatRows, 'SHOP', rawShop);
        }
        let matchedAccCat = resolveCategoryByIdOrName(poCatRows, ['ACCOUNT'], { id: formData.accountId, name: rawAccount });
        if (!matchedAccCat && rawAccount) {
          matchedAccCat = await ensureCategoryExistsByName(sql, poCatRows, 'ACCOUNT', rawAccount);
        }
        const shop = matchedShopCat ? matchedShopCat.name : rawShop;
        const shopId = matchedShopCat ? String(matchedShopCat.id) : normalizeCategoryId(formData.shopId);
        const account = matchedAccCat ? matchedAccCat.name : rawAccount;
        const accountId = matchedAccCat ? String(matchedAccCat.id) : normalizeCategoryId(formData.accountId);

        // Xác định ví theo ID trước (fallback tên nếu chưa có ID) trước khi xét Pre-order
        const matchedWallet = (!isOpeningStock && (rawWalletId || rawWalletName))
          ? await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName })
          : null;
        const poWalletCheck = validateOrderWalletRequirement({
          mode: 'PURCHASE',
          isExempt: isOpeningStock,
          isLoan: isMuonThe,
          loanPartner: doiTacMuon,
          rawWalletId,
          rawWalletName,
          matchedWallet
        });
        if (!poWalletCheck.valid) {
          return res.status(200).json({ success: false, message: poWalletCheck.message });
        }
        const walletId = matchedWallet ? String(matchedWallet.id) : rawWalletId;
        const walletName = matchedWallet ? String(matchedWallet.name) : rawWalletName;
        const isCreditWallet = matchedWallet
          ? String(matchedWallet.type || '').trim().toUpperCase() === 'CREDIT'
          : (walletName.toLowerCase().startsWith('c-') || walletName.toLowerCase().startsWith('c_'));
        // Cả thẻ Credit lẫn Debit/Cash đều có thể Đặt trước (Debit đặt trước: chưa trừ tiền cho tới khi xác nhận)
        const canHoldPreOrder = (walletId || walletName) ? true : isMuonThe;

        const requestedWhName = String(formData.warehouse || formData.trangThaiKho || '').trim();
        const requestedWhId = formData.warehouseId || formData.warehouse_id || null;
        const matchedReqWh = resolveWarehouseCategory(poCatRows, { warehouseId: requestedWhId, warehouseName: requestedWhName });
        const effectiveReqWhName = matchedReqWh ? matchedReqWh.name : requestedWhName;

        const requestedDatTruoc = Boolean(formData.isPreOrder) || isWarehousePreOrderName(effectiveReqWhName);
        const isPreOrder = (isOpeningStock || !canHoldPreOrder)
          ? false
          : requestedDatTruoc;
        const status = isPreOrder ? 'PRE-ORDER' : 'HOAN_TAT';

        const defaultRole = isPreOrder ? 'DAT_TRUOC' : (isOpeningStock ? 'KHO_NHA' : 'CHO_SHIP');
        const hasExplicitNonPreWh = Boolean(matchedReqWh && getWarehouseRole(matchedReqWh) !== 'DAT_TRUOC')
          || Boolean(effectiveReqWhName && !isWarehousePreOrderName(effectiveReqWhName));
        let resolvedWhCat = (isPreOrder && !hasExplicitNonPreWh)
          ? resolveWarehouseCategory(poCatRows, { fallbackRole: 'DAT_TRUOC' })
          : (matchedReqWh || resolveWarehouseCategory(poCatRows, { warehouseName: effectiveReqWhName, fallbackRole: defaultRole }));

        let defaultWh = resolvedWhCat
          ? resolvedWhCat.name
          : ((isPreOrder && !hasExplicitNonPreWh) ? 'Đặt trước' : (effectiveReqWhName || (isOpeningStock ? 'Kho Nhà' : 'Chờ Ship')));
        const warehouseId = resolvedWhCat ? String(resolvedWhCat.id) : ((isPreOrder && !hasExplicitNonPreWh) ? 'DAT_TRUOC' : normalizeCategoryId(requestedWhId));

        const items = (Array.isArray(formData.items) && formData.items.length > 0)
          ? formData.items
          : [{
              tenSP: formData.product_name || formData.tenSP || '',
              qty: Number(formData.quantity || formData.qty || 1),
              price: Number(formData.unit_price || formData.price || 0),
              total: Number(formData.total_amount || formData.total || (Number(formData.quantity || formData.qty || 1) * Number(formData.unit_price || formData.price || 0))),
              ghiChu: formData.note || formData.ghiChu || ''
            }];

        let totalOrderAmount = 0;
        const itemNames = [];

        for (let idx = 0; idx < items.length; idx++) {
          const it = items[idx];
          const itemId = items.length > 1 ? `${baseId}-${idx + 1}` : baseId;
          const pName = String(it.tenSP || it.product_name || '').trim();
          if (pName) itemNames.push(pName);
          const qty = Number(it.qty || it.quantity || 1);
          const price = Math.round(Number(it.price || it.unit_price || 0));
          const total = Math.round(Number(it.total || it.total_amount || (qty * price)));
          totalOrderAmount += total;
          let note = String(it.ghiChu || it.note || formData.ghiChuOrder || '').trim();
          if (isPreOrder && !note.toLowerCase().includes('pre-order') && !note.toLowerCase().includes('preorder')) {
            note = note ? `[Pre-order] ${note}` : '[Pre-order]';
          }
          const isWhUnarrivedPreOrCancel = isWarehousePreOrderName(defaultWh) || isWarehouseCancelledName(defaultWh);
          const rem = isOpeningStock ? qty : (isWhUnarrivedPreOrCancel ? 0 : qty);

          await sql`
            INSERT INTO business_orders (id, date, warehouse, warehouse_id, product_name, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, shop, shop_id, account, account_id, is_deleted)
            VALUES (${itemId}, ${date}, ${warehouseId || defaultWh}, ${warehouseId}, ${pName}, ${qty}, ${price}, ${total}, ${rem}, ${walletId}, ${walletId || ''}, ${status}, ${note}, 'HOAN_TAT', ${shop}, ${shopId}, ${accountId || ''}, ${accountId}, false)
            ON CONFLICT (id) DO UPDATE SET
              date = EXCLUDED.date,
              warehouse = EXCLUDED.warehouse,
              warehouse_id = EXCLUDED.warehouse_id,
              product_name = EXCLUDED.product_name,
              quantity = EXCLUDED.quantity,
              unit_price = EXCLUDED.unit_price,
              total_amount = EXCLUDED.total_amount,
              inventory_remaining = EXCLUDED.inventory_remaining,
              wallet_id = EXCLUDED.wallet_id,
              wallet_name = EXCLUDED.wallet_name,
              status = EXCLUDED.status,
              note = EXCLUDED.note,
              order_status = EXCLUDED.order_status,
              shop = EXCLUDED.shop,
              shop_id = EXCLUDED.shop_id,
              account = EXCLUDED.account,
              account_id = EXCLUDED.account_id,
              is_deleted = false
          `;
        }

        // Cập nhật số dư ví & ghi nhận Sổ Cái cho đơn mua thường hoặc đặt trước
        if ((walletId || walletName) && totalOrderAmount > 0 && !isOpeningStock) {
          if (matchedWallet) {
            const w = matchedWallet;
            const isCredit = String(w.type).toUpperCase() === 'CREDIT';
            let poBalAfter = 0;
            if (isCredit) {
              const newPre = isPreOrder ? (Number(w.preorder || 0) + totalOrderAmount) : Number(w.preorder || 0);
              const newDebt = isPreOrder ? Number(w.debt || 0) : (Number(w.debt || 0) + totalOrderAmount);
              const limit = Number(w.credit_limit || 0);
              const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : 0;
              poBalAfter = newBal;
              await sql`UPDATE wallets SET debt = ${newDebt}, preorder = ${newPre}, current_balance = ${newBal} WHERE id = ${w.id}`;
            } else if (isPreOrder) {
              // Debit/Cash đặt trước: giữ nguyên số dư, chỉ ghi nhận cam kết
              poBalAfter = Number(w.current_balance || 0);
              await sql`UPDATE wallets SET preorder = ${Number(w.preorder || 0) + totalOrderAmount} WHERE id = ${w.id}`;
            } else {
              const newBal = Number(w.current_balance || 0) - totalOrderAmount;
              poBalAfter = newBal;
              await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${w.id}`;
            }

            const autoOrderStmtDate = isCredit ? (getCardDefaultPaymentStatementMonth(date, w.closing_date) + '-01') : '';
            if (autoOrderStmtDate) {
              await sql`UPDATE business_orders SET statement_date = ${autoOrderStmtDate} WHERE id LIKE ${baseId + '%'}`.catch(() => {});
            }

            if (!isPreOrder) {
              const ledId = 'LED-' + Date.now().toString().slice(-8) + 'P';
              const pNamesStr = itemNames.slice(0, 3).join(', ') + (itemNames.length > 3 ? ` (+${itemNames.length - 3})` : '');
              await sql`
                INSERT INTO wallet_ledger (id, transaction_date, statement_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module)
                VALUES (${ledId}, ${date}, ${autoOrderStmtDate || ''}, ${String(w.id)}, ${w.name}, 'PURCHASE_CHARGE', ${isCredit ? 'CARD_DEBT' : 'CASH'}, ${totalOrderAmount}, ${poBalAfter}, ${'[Mua hàng] - ' + (pNamesStr || shop || 'Đơn mua')}, ${baseId}, 'POSTED', ${isCredit ? 'INCREASE' : 'OUT'}, 'Purchase')
              `;
            } else {
              const ledId = 'LED-' + Date.now().toString().slice(-8) + 'P';
              const pNamesStr = itemNames.slice(0, 3).join(', ') + (itemNames.length > 3 ? ` (+${itemNames.length - 3})` : '');
              await sql`
                INSERT INTO wallet_ledger (id, transaction_date, statement_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module)
                VALUES (${ledId}, ${date}, ${autoOrderStmtDate || ''}, ${String(w.id)}, ${w.name}, 'PREORDER_HOLD', 'PREORDER_HOLD', ${totalOrderAmount}, ${poBalAfter}, ${'[Pre] - ' + (pNamesStr || shop || 'Đơn mua')}, ${baseId}, 'PENDING', ${isCredit ? 'INCREASE' : 'OUT'}, 'Purchase')
              `;
            }
          }
        }

        // Mượn thẻ đối tác -> ghi nhận công nợ phải trả (TRA)
        if (isMuonThe && doiTacMuon && totalOrderAmount > 0) {
          const debtId = 'DEBT-' + Date.now().toString().slice(-8);
          let matchedLoanPartner = resolveCategoryByIdOrName(poCatRows, ['PARTNER', 'FAMILY'], { name: doiTacMuon });
          if (!matchedLoanPartner) {
            matchedLoanPartner = await ensureCategoryExistsByName(sql, poCatRows, 'PARTNER', doiTacMuon);
          }
          const loanPartnerId = matchedLoanPartner ? String(matchedLoanPartner.id) : null;
          const loanPartnerName = matchedLoanPartner ? matchedLoanPartner.name : doiTacMuon;
          await sql`
            INSERT INTO debts (id, date, name, partner_id, content, amount, remaining_debt, type, wallet_id, wallet_name, status, note)
            VALUES (${debtId}, ${date}, ${loanPartnerId || loanPartnerName}, ${loanPartnerId}, ${'Mượn thẻ mua hàng đơn ' + baseId}, ${totalOrderAmount}, ${totalOrderAmount}, 'TRA', '', '', 'ACTIVE', ${shop || 'Mượn thẻ'})
          `;
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        return res.status(200).json({
          success: true,
          message: 'Đã lưu đơn mua vào database Vercel!',
          id: baseId,
          orderId: baseId,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 14. LƯU ĐƠN BÁN HÀNG (Tab 3)
      case 'saveSalesOrder': {
        const formData = args[0] || {};
        const baseId = String(formData.id || ('SO-' + Date.now().toString().slice(-10)));
        const date = String(formData.date || formData.ngay || formData.ngayBan || new Date().toISOString().slice(0, 10));
        const rawWalletId = String(formData.walletId || formData.wallet_id || '').trim();
        const rawWalletName = String(formData.wallet_name || formData.nhanTien || formData.nhanTienVao || '').trim();
        const isKhachNo = Boolean(formData.isKhachNo || String(formData.status || '').toLowerCase().includes('khách nợ') || String(formData.status || '').toLowerCase().includes('khach no'));
        const resolvedSalesW = (!isKhachNo && (rawWalletId || rawWalletName))
          ? await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName })
          : null;
        const soWalletCheck = validateOrderWalletRequirement({
          mode: 'SALES',
          isExempt: isKhachNo,
          rawWalletId,
          rawWalletName,
          matchedWallet: resolvedSalesW
        });
        if (!soWalletCheck.valid) {
          return res.status(200).json({ success: false, message: soWalletCheck.message });
        }
        const walletId = resolvedSalesW ? String(resolvedSalesW.id) : rawWalletId;
        const walletName = resolvedSalesW ? String(resolvedSalesW.name) : rawWalletName;
        const status = isKhachNo ? 'Khách nợ' : 'HOAN_TAT';
        const soCatRows = await sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => []);
        const soCatByIdMap = buildCategoryByIdMap(soCatRows);
        const defaultWhRaw = String(formData.warehouse || formData.noiTru || '').trim();
        const resolvedDefSoWh = resolveWarehouseCategory(soCatRows, { warehouseId: formData.warehouseId, warehouseName: defaultWhRaw || 'Kho Nhà' });
        const defaultWh = resolvedDefSoWh ? resolvedDefSoWh.name : (defaultWhRaw || 'Kho Tokyo');
        const orderStatus = 'HOAN_TAT';

        const items = (Array.isArray(formData.items) && formData.items.length > 0)
          ? formData.items
          : [{
              tenSP: formData.product_name || formData.tenSP || '',
              qty: Number(formData.quantity || formData.qty || 1),
              price: Number(formData.unit_price || formData.price || 0),
              total: Number(formData.total_amount || formData.total || (Number(formData.quantity || formData.qty || 1) * Number(formData.unit_price || formData.price || 0))),
              ghiChu: formData.note || formData.ghiChu || ''
            }];

        const uniqueProductNamesLower = Array.from(new Set(
          items.map(it => String(it.tenSP || it.product_name || '').trim().toLowerCase()).filter(Boolean)
        ));
        if (uniqueProductNamesLower.length > 0) {
          const preCheckStockRows = await sql`
            SELECT id, product_name, quantity, unit_price, inventory_remaining, warehouse, warehouse_id, status, order_status, is_deleted
            FROM business_orders
            WHERE LOWER(TRIM(product_name)) = ANY(${uniqueProductNamesLower}) AND is_deleted = false
          `;
          const stockCheck = validateSalesStockAvailability(items, preCheckStockRows, soCatByIdMap);
          if (!stockCheck.valid) {
            return res.status(200).json({ success: false, message: stockCheck.message });
          }
        }

        let grandTotal = 0;
        let grandCogs = 0;
        const itemNames = [];

        for (let idx = 0; idx < items.length; idx++) {
          const it = items[idx];
          const itemId = items.length > 1 ? `${baseId}-${idx + 1}` : baseId;
          const pName = String(it.tenSP || it.product_name || '').trim();
          if (pName) itemNames.push(pName);
          const qty = Number(it.qty || it.quantity || 1);
          const price = Math.round(Number(it.price || it.unit_price || 0));
          const total = Math.round(Number(it.total || it.total_amount || (qty * price)));
          grandTotal += total;
          const note = String(it.ghiChu || it.note || formData.note || '').trim();
          const itemWhRaw = String(it.warehouse || it.noiTru || defaultWh).trim();
          const resolvedItemSoWh = resolveWarehouseCategory(soCatRows, { warehouseId: it.warehouseId || formData.warehouseId, warehouseName: itemWhRaw });
          const itemWh = resolvedItemSoWh ? resolvedItemSoWh.name : itemWhRaw;
          const itemWhId = resolvedItemSoWh ? String(resolvedItemSoWh.id) : normalizeCategoryId(it.warehouseId || formData.warehouseId);

          // Tính giá vốn (COGS) & trừ tồn kho FIFO từ business_orders (ưu tiên đúng kho xuất bán và chỉ lấy hàng thực tế trong kho vật lý)
          let itemCogs = 0;
          let qtyToDeduct = qty;
          try {
            const allStockRows = await sql`
              SELECT id, unit_price, inventory_remaining, warehouse, warehouse_id, status, order_status
              FROM business_orders
              WHERE LOWER(TRIM(product_name)) = ${pName.toLowerCase()} AND inventory_remaining > 0 AND is_deleted = false
              ORDER BY date ASC, id ASC
            `;
            const physicalStockRows = (allStockRows || []).filter(st => {
              if (String(st.order_status || '').toUpperCase() === 'DA_HUY') return false;
              const stStatus = String(st.status || '').toUpperCase();
              if (stStatus === 'DA_HUY' || stStatus === 'DA_HOAN_TIEN' || stStatus === 'CHO_HOAN') return false;
              if (classifySalesStockLot(st, soCatByIdMap) !== 'PHYSICAL') return false;
              const wRaw = String(st.warehouse_id || st.warehouse || '').trim();
              if (!wRaw) return false;
              const wUp = wRaw.toUpperCase();
              if (['DAT_TRUOC', 'CHO_SHIP', 'CHUSEN', 'HUY', 'CANCEL'].includes(wUp)) return false;
              if (isWarehousePendingName(wRaw) || isWarehousePreOrderName(wRaw) || isWarehouseCancelledName(wRaw)) return false;
              return true;
            });
            // Ưu tiên lô hàng nằm đúng kho được chọn khi xuất bán trước, sau đó mới tới các kho vật lý khác
            const sortedStockRows = physicalStockRows.sort((a, b) => {
              const aMatch = (itemWhId && (String(a.warehouse_id || '') === itemWhId || String(a.warehouse || '') === itemWhId)) || (itemWh && String(a.warehouse || '').toLowerCase() === itemWh.toLowerCase());
              const bMatch = (itemWhId && (String(b.warehouse_id || '') === itemWhId || String(b.warehouse || '') === itemWhId)) || (itemWh && String(b.warehouse || '').toLowerCase() === itemWh.toLowerCase());
              if (aMatch && !bMatch) return -1;
              if (!aMatch && bMatch) return 1;
              return 0;
            });
            for (const st of sortedStockRows) {
              if (qtyToDeduct <= 0) break;
              const rem = Number(st.inventory_remaining || 0);
              const uPrice = Number(st.unit_price || 0);
              const deduct = Math.min(rem, qtyToDeduct);
              itemCogs += deduct * uPrice;
              qtyToDeduct -= deduct;
              await sql`UPDATE business_orders SET inventory_remaining = ${rem - deduct} WHERE id = ${st.id}`;
            }
          } catch(e) {
            console.error('Deduct inventory error:', e);
          }
          grandCogs += itemCogs;

          await sql`
            INSERT INTO sales_orders (id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, wallet_id, wallet_name, status, note, cogs, order_status, is_deleted)
            VALUES (${itemId}, ${date}, ${pName}, ${itemWhId || itemWh}, ${itemWhId}, ${qty}, ${price}, ${total}, ${walletId}, ${walletId || ''}, ${status}, ${note}, ${itemCogs}, ${orderStatus}, false)
            ON CONFLICT (id) DO UPDATE SET
              date = EXCLUDED.date,
              product_name = EXCLUDED.product_name,
              warehouse = EXCLUDED.warehouse,
              warehouse_id = EXCLUDED.warehouse_id,
              quantity = EXCLUDED.quantity,
              unit_price = EXCLUDED.unit_price,
              total_amount = EXCLUDED.total_amount,
              wallet_id = EXCLUDED.wallet_id,
              wallet_name = EXCLUDED.wallet_name,
              status = EXCLUDED.status,
              note = EXCLUDED.note,
              cogs = EXCLUDED.cogs,
              order_status = EXCLUDED.order_status,
              is_deleted = false
          `;
        }

        // Nếu thu tiền vào ví (không phải khách nợ) và có số tiền bán
        if (!isKhachNo && (walletId || walletName) && grandTotal > 0 && resolvedSalesW) {
          const w = resolvedSalesW;
          const isCredit = String(w.type).toUpperCase() === 'CREDIT';
          if (isCredit) {
            const newDebt = Math.max(0, Number(w.debt || 0) - grandTotal);
            const limit = Number(w.credit_limit || 0);
            const pre = Number(w.preorder || 0);
            const newBal = limit > 0 ? Math.max(0, limit - newDebt - pre) : 0;
            await sql`UPDATE wallets SET debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
          } else {
            const newBal = Number(w.current_balance || 0) + grandTotal;
            await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${w.id}`;
          }

          const ledId = 'LED-' + Date.now().toString().slice(-8) + 'S';
          const itemNamesStr = itemNames.slice(0, 3).join(', ') + (itemNames.length > 3 ? ` (+${itemNames.length - 3})` : '');
          await sql`
            INSERT INTO wallet_ledger (id, transaction_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module)
            VALUES (${ledId}, ${date}, ${String(w.id)}, ${w.name}, 'SALES_REVENUE', ${isCredit ? 'CARD_DEBT' : 'CASH'}, ${grandTotal}, 0, ${'[Bán hàng] ' + (itemNamesStr || 'Đơn bán')}, ${baseId}, 'POSTED', ${isCredit ? 'DECREASE' : 'INCREASE'}, 'Sales')
          `;
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        return res.status(200).json({
          success: true,
          message: 'Đã xuất bán đơn hàng thành công!',
          id: baseId,
          orderId: baseId,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 15. HỦY / XÓA ĐƠN MUA (Tab 3)
      case 'cancelPurchaseOrder':
      case 'deletePurchaseOrder': {
        const raw = args[0] || (req.body && (req.body.id || req.body.rowId || req.body.row));
        const id = String((typeof raw === 'object' && raw !== null) ? (raw.id || raw.rowId || raw.row || '') : (raw || '')).trim();
        if (!id) return res.status(200).json({ success: false, message: 'Mã đơn không hợp lệ' });

        const isDeleteAction = action === 'deletePurchaseOrder' || Boolean(typeof raw === 'object' && raw !== null && raw.hardDelete);
        const baseId = extractBaseOrderId(id) || id;
        const matchPattern = baseId + '-%';

        // Tìm tất cả dòng thuộc đơn mua (hỗ trợ cả mã gốc PO-xxxx lẫn mã con PO-xxxx-1, PO-xxxx-2)
        const ords = await sql`
          SELECT id, wallet_id, wallet_name, total_amount, status, order_status, is_deleted, payment_group_id
          FROM business_orders
          WHERE id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}
        `;
        if (ords.length === 0) {
          return res.status(200).json({ success: false, message: `Không tìm thấy đơn mua: ${id}` });
        }

        const affectedPgIds = Array.from(new Set(ords.map(o => String(o.payment_group_id || '').trim()).filter(Boolean)));

        // Kiểm tra ledger đang hiệu lực (POSTED/PENDING) trước khi hoàn ví (phòng trường hợp đơn chuyển kho Hủy -> status = CHO_HOAN, order_status = DA_HUY nhưng chưa hoàn tiền)
        const activeOrderLedgers = await sql`
          SELECT id, order_id, payment_group_id, status, effect_type
          FROM wallet_ledger
          WHERE (order_id = ${id} OR id = ${id} OR order_id = ${baseId} OR id = ${baseId} OR order_id LIKE ${matchPattern} OR (${affectedPgIds.length > 0} AND payment_group_id = ANY(${affectedPgIds})))
            AND UPPER(COALESCE(status, '')) IN ('POSTED', 'PENDING')
        `.catch(() => []);

        // Hoàn lại tiền/nợ vào ví cho các dòng chưa bị hủy hoặc hoàn tiền trước đó
        const touchedWalletIds = [];
        for (const o of ords) {
          const oPgId = String(o.payment_group_id || '').trim();
          const rowLedgers = (activeOrderLedgers || []).filter(l => {
            const lid = String(l.order_id || l.id || '').trim();
            const lPgId = String(l.payment_group_id || '').trim();
            return lid === String(o.id) || lid === baseId || (oPgId && lPgId === oPgId);
          });
          const revDecision = shouldReverseWalletOnPurchaseDeleteOrCancel(o, rowLedgers);
          if (!revDecision.shouldReverse) continue;
          const isPreToReverse = revDecision.isPreOrder;
          const amt = Number(o.total_amount || 0);
          const wId = String(o.wallet_id || '').trim();
          const wName = String(o.wallet_name || '').trim();
          if ((wId || wName) && amt > 0) {
            const w = await findWalletByOrderName(sql, { walletId: wId, walletName: wName });
            if (w) {
              touchedWalletIds.push(w.id);
              const isCredit = String(w.type || '').toUpperCase() === 'CREDIT';
              if (isCredit) {
                const limit = Number(w.credit_limit || 0);
                let newPre = Number(w.preorder || 0);
                let newDebt = Number(w.debt || 0);
                if (isPreToReverse) {
                  newPre = Math.max(0, newPre - amt);
                } else {
                  newDebt = Math.max(0, newDebt - amt);
                }
                const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
                await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
              } else if (isPreToReverse) {
                // Debit/Cash đặt trước chưa trừ tiền: chỉ gỡ cam kết, không hoàn tiền
                await sql`UPDATE wallets SET preorder = ${Math.max(0, Number(w.preorder || 0) - amt)} WHERE id = ${w.id}`;
              } else {
                await sql`UPDATE wallets SET current_balance = COALESCE(current_balance, 0) + ${amt} WHERE id = ${w.id}`;
              }
            }
          }
        }

        if (isDeleteAction) {
          await sql`DELETE FROM debts WHERE content = ${'Mượn thẻ mua hàng đơn ' + baseId}`;
          await sql`DELETE FROM wallet_ledger WHERE (order_id = ${id} OR id = ${id} OR order_id = ${baseId} OR id = ${baseId} OR order_id LIKE ${matchPattern}) AND COALESCE(payment_group_id, '') = ''`;
          await sql`DELETE FROM business_orders WHERE id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}`;
        } else {
          await sql`
            UPDATE business_orders
            SET order_status = 'DA_HUY',
                status = CASE WHEN UPPER(COALESCE(status, '')) = 'CHO_HOAN' THEN 'DA_HUY' ELSE status END,
                inventory_remaining = 0
            WHERE id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}
          `;
          await sql`UPDATE wallet_ledger SET status = 'CANCELLED' WHERE (order_id = ${id} OR id = ${id} OR order_id = ${baseId} OR id = ${baseId} OR order_id LIKE ${matchPattern}) AND COALESCE(payment_group_id, '') = ''`;
        }
        for (const pgId of affectedPgIds) {
          await syncPaymentGroupLedger(sql, pgId, {
            hardDelete: isDeleteAction,
            cancelStatus: isDeleteAction ? 'DELETED' : 'CANCELLED'
          });
        }
        if (touchedWalletIds.length > 0) {
          await syncCreditWalletPreorders(sql, touchedWalletIds);
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;
        const freshData = await getBusinessDataHelper(sql);

        return res.status(200).json({
          success: true,
          message: isDeleteAction ? `Đã xóa đơn mua #${baseId} khỏi database!` : `Đã hủy đơn mua #${baseId} thành công!`,
          deletedId: baseId,
          freshData,
          wallets: updatedWallets,
          updatedWallets
        });
      }

      // 15B. CẬP NHẬT CHI TIẾT ĐƠN MUA HÀNG (Tab 3)
      case 'updatePurchaseItemDetail': {
        const [itemId, newWh, newQty, newPrice, newGhiChu, newNoiMua, newTenSP, newNgayMua, newNguonTien, newCardStatus, newTaiKhoan, rawStmtDate, newWalletId, newWhId] = args;
        const id = String(itemId || '').trim();
        if (id) {
          const qty = (newQty !== undefined && newQty !== null && newQty !== '') ? Number(newQty) : null;
          const price = (newPrice !== undefined && newPrice !== null && newPrice !== '') ? Math.round(Number(newPrice)) : null;
          const totalAmt = (qty !== null && price !== null) ? Math.round(qty * price) : null;

          const normalizedDate = normalizeIsoDate(newNgayMua);
          let normalizedStmtDate = null;
          if (rawStmtDate && /^\d{2,4}[-/]\d{1,2}/.test(String(rawStmtDate).trim())) {
            const sStr = String(rawStmtDate).trim();
            normalizedStmtDate = /^\d{4}-\d{2}$/.test(sStr) ? `${sStr}-01` : normalizeIsoDate(sStr);
          }

          const singleEditRes = await reconcilePurchaseItemEdit(sql, id, {
            qty,
            price,
            totalAmt,
            hasWhId: newWhId !== undefined && newWhId !== null && String(newWhId).trim() !== '',
            warehouse_id: newWhId,
            hasWh: newWh !== undefined && newWh !== null && String(newWh).trim() !== '',
            warehouse: String(newWh || '').trim(),
            hasName: newTenSP !== undefined && newTenSP !== null && String(newTenSP).trim() !== '',
            product_name: String(newTenSP || '').trim(),
            hasShop: newNoiMua !== undefined && newNoiMua !== null && String(newNoiMua).trim() !== '',
            shop: String(newNoiMua || '').trim(),
            hasAcc: newTaiKhoan !== undefined && newTaiKhoan !== null && String(newTaiKhoan).trim() !== '',
            account: String(newTaiKhoan || '').trim(),
            hasWalletId: newWalletId !== undefined && newWalletId !== null && String(newWalletId).trim() !== '',
            wallet_id: String(newWalletId || '').trim(),
            hasWallet: newNguonTien !== undefined && newNguonTien !== null && String(newNguonTien).trim() !== '',
            wallet_name: String(newNguonTien || '').trim(),
            hasStatus: newCardStatus !== undefined && newCardStatus !== null && String(newCardStatus).trim() !== '',
            status: String(newCardStatus || '').trim(),
            hasNote: newGhiChu !== undefined && newGhiChu !== null,
            note: String(newGhiChu ?? ''),
            normalizedDate,
            normalizedStmtDate
          });
          if (singleEditRes && singleEditRes.error) {
            return res.status(200).json({ success: false, message: singleEditRes.error });
          }
        }
        const [freshData, updatedWallets] = await Promise.all([
          getBusinessDataHelper(sql),
          sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv
            FROM wallets WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL' ORDER BY id ASC
          `
        ]);
        return res.status(200).json({ success: true, message: 'Đã cập nhật chi tiết đơn mua thành công!', freshData, wallets: updatedWallets, updatedWallets });
      }

      // 15C. LƯU CHỈNH SỬA HÀNG LOẠT ĐƠN MUA (Tab 3)
      case 'saveBatchPurchaseOrderEdit': {
        const payload = args[0] || {};
        const items = payload.items || [];
        const targetIds = items.map(it => String(it.id || '').trim()).filter(Boolean);

        const [existingOrders, catRows, walletRows] = await Promise.all([
          targetIds.length > 0
            ? sql`
                SELECT id, date, warehouse, warehouse_id, product_name, quantity, unit_price, total_amount, inventory_remaining,
                       wallet_id, wallet_name, status, note, order_status, is_deleted, shop, shop_id, account, account_id, statement_date, payment_group_id
                FROM business_orders
                WHERE id = ANY(${targetIds})
              `.catch(() => [])
            : [],
          sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories ORDER BY id ASC`.catch(() => []),
          sql`SELECT id, name, type, is_deleted FROM wallets ORDER BY id ASC`.catch(() => [])
        ]);

        const oldRowMap = new Map((existingOrders || []).map(r => [String(r.id), r]));
        const batchContext = { oldRowMap, catRows, walletRows, skipSyncPreorders: true };
        const allTouchedWalletIds = [];
        const editErrors = [];

        for (const item of items) {
          const id = String(item.id || '').trim();
          if (!id) continue;
          const qty = (item.qty !== undefined && item.qty !== null && item.qty !== '') ? Number(item.qty) : null;
          const price = (item.price !== undefined && item.price !== null && item.price !== '') ? Math.round(Number(item.price)) : null;
          const totalAmt = (qty !== null && price !== null) ? Math.round(qty * price) : null;

          const normalizedDate = normalizeIsoDate(item.ngayMua || item.date);
          let normalizedStmtDate = null;
          const rawStmt = item.statementDate || item.statement_date || item.ngaySaoKe;
          if (rawStmt) {
            const sStr = String(rawStmt).trim();
            normalizedStmtDate = /^\d{4}-\d{2}$/.test(sStr) ? `${sStr}-01` : normalizeIsoDate(sStr);
          }

          const editRes = await reconcilePurchaseItemEdit(sql, id, {
            qty,
            price,
            totalAmt,
            hasWhId: (item.warehouseId || item.warehouse_id) !== undefined && (item.warehouseId || item.warehouse_id) !== null && String(item.warehouseId || item.warehouse_id || '').trim() !== '',
            warehouse_id: item.warehouseId || item.warehouse_id || null,
            hasWh: item.trangThaiKho !== undefined && item.trangThaiKho !== null && String(item.trangThaiKho).trim() !== '',
            warehouse: String(item.trangThaiKho || '').trim(),
            hasName: item.tenSP !== undefined && item.tenSP !== null && String(item.tenSP).trim() !== '',
            product_name: String(item.tenSP || '').trim(),
            hasShop: item.noiMua !== undefined && item.noiMua !== null && String(item.noiMua).trim() !== '',
            shop: String(item.noiMua || '').trim(),
            hasAcc: item.taiKhoan !== undefined && item.taiKhoan !== null && String(item.taiKhoan).trim() !== '',
            account: String(item.taiKhoan || '').trim(),
            hasWalletId: (item.walletId || item.wallet_id) !== undefined && (item.walletId || item.wallet_id) !== null && String(item.walletId || item.wallet_id || '').trim() !== '',
            wallet_id: String(item.walletId || item.wallet_id || '').trim(),
            hasWallet: item.nguonTien !== undefined && item.nguonTien !== null && String(item.nguonTien).trim() !== '',
            wallet_name: String(item.nguonTien || '').trim(),
            hasStatus: item.trangThaiThe !== undefined && item.trangThaiThe !== null && String(item.trangThaiThe).trim() !== '',
            status: String(item.trangThaiThe || '').trim(),
            hasNote: item.ghiChu !== undefined && item.ghiChu !== null,
            note: String(item.ghiChu ?? ''),
            normalizedDate,
            normalizedStmtDate
          }, batchContext);

          if (editRes && editRes.error) {
            editErrors.push(editRes.error);
          }
          if (editRes && Array.isArray(editRes.touchedWalletIds)) {
            allTouchedWalletIds.push(...editRes.touchedWalletIds);
          }
        }

        if (allTouchedWalletIds.length > 0) {
          await syncCreditWalletPreorders(sql, allTouchedWalletIds).catch(() => {});
        }
        if (editErrors.length > 0) {
          return res.status(200).json({ success: false, message: editErrors[0] });
        }

        const [freshData, updatedWallets] = await Promise.all([
          getBusinessDataHelper(sql),
          sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv
            FROM wallets WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL' ORDER BY id ASC
          `
        ]);
        return res.status(200).json({ success: true, message: 'Đã lưu chỉnh sửa đơn mua thành công vào cơ sở dữ liệu!', freshData, wallets: updatedWallets, updatedWallets });
      }

      // 15D. CẬP NHẬT KHO HÀNG (Tab 3)
      case 'updateWarehouseStatus':
      case 'updateBatchWarehouseStatus': {
        const rawItems = Array.isArray(args[0]) ? args[0] : [args[0]];
        const rawTargetWh = args[1];
        const targetWhObj = (typeof rawTargetWh === 'object' && rawTargetWh !== null) ? rawTargetWh : { name: String(rawTargetWh || '').trim() };
        const targetWh = String(targetWhObj.name || targetWhObj.warehouse || '').trim();
        const targetWhIdArg = targetWhObj.id || targetWhObj.warehouseId || null;
        if (!targetWh && !targetWhIdArg) return res.status(200).json({ success: false, message: 'Kho đích không hợp lệ' });

        const whCats = await sql`SELECT id, type, name, is_hidden FROM categories WHERE type IN ('WAREHOUSE', 'WAREHOUSE_STATUS') ORDER BY id ASC`.catch(() => []);
        const isCancel = (targetWh === 'CANCEL' || targetWh === 'BỊ HỦY' || targetWh === 'BỊ HỦY - CHỜ HOÀN' || targetWh === 'Hủy' || isWarehouseCancelledName(targetWh));
        const resolvedWhCat = resolveWarehouseCategory(whCats, {
          warehouseId: targetWhIdArg,
          warehouseName: isCancel ? 'Hủy' : targetWh,
          fallbackRole: isCancel ? 'HUY' : ''
        });
        const finalWh = resolvedWhCat ? resolvedWhCat.name : (isCancel ? 'Hủy' : targetWh);
        const finalWhId = resolvedWhCat ? String(resolvedWhCat.id) : normalizeCategoryId(targetWhIdArg);
        const pendingRoles = new Set(['DAT_TRUOC', 'CHO_SHIP', 'CHUSEN', 'HUY']);
        const pendingWhIds = (whCats || []).filter(c => pendingRoles.has(getWarehouseRole(c))).map(c => String(c.id));
        const targetRole = getWarehouseRole(resolvedWhCat || finalWh);
        const targetIsPendingOrCancel = isCancel || pendingRoles.has(targetRole);

        const targetIds = rawItems.flatMap(it => {
          if (typeof it === 'object' && it !== null) {
            return String(it.id || it.itemId || '').trim();
          }
          return String(it || '').trim();
        }).filter(Boolean);

        if (targetIds.length === 0) return res.status(200).json({ success: false, message: 'Chưa chọn đơn hàng nào' });

        const touchedWalletIds = [];
        const opts = args[2];
        const explicitSettlePre = (opts === true) || (typeof opts === 'object' && opts !== null && opts.settlePreOrder === true);
        const shouldSettlePreOrder = !isCancel && targetRole !== 'DAT_TRUOC' && explicitSettlePre;

        for (const tId of targetIds) {
          const targetRows = await sql`
            SELECT id, warehouse, warehouse_id, quantity, inventory_remaining, order_status
            FROM business_orders
            WHERE (id = ${tId} OR id LIKE ${tId + '-%'}) AND is_deleted = false
          `.catch(() => []);
          const soldBlocked = (targetRows || []).some(r => {
            const rWhId = String(r.warehouse_id || '').trim();
            const rWh = String(r.warehouse || '').trim();
            const rWhCat = (whCats || []).find(c => String(c.id) === rWhId || String(c.id) === rWh);
            const rWhName = rWhCat ? String(rWhCat.name || '') : (rWh || rWhId);
            const rRole = getWarehouseRole(rWhCat || rWhName);
            const isPhys = Boolean(rWhName) && !pendingRoles.has(rRole) && !isWarehousePendingName(rWhName) && !isWarehousePreOrderName(rWhName) && !isWarehouseCancelledName(rWhName);
            if (!isPhys) return false;
            const q = Number(r.quantity || 0);
            const rem = Number(r.inventory_remaining !== null && r.inventory_remaining !== undefined ? r.inventory_remaining : q);
            return q > 0 && rem < q && (isCancel || rem <= 0);
          });
          if (soldBlocked) {
            return res.status(200).json({
              success: false,
              message: '⚠️ Đơn mua đã xuất bán không thể chuyển kho hoặc hủy! Nếu nhập nhầm ví/thẻ, hãy mở chi tiết đơn để sửa Nguồn tiền.'
            });
          }
          if (isCancel) {
            const cancelRows = await sql`SELECT id, payment_group_id FROM business_orders WHERE id = ${tId} OR id LIKE ${tId + '-%'}`.catch(() => []);
            await sql`
              UPDATE business_orders
              SET warehouse = ${finalWhId || finalWh},
                  warehouse_id = ${finalWhId},
                  status = 'CHO_HOAN',
                  order_status = 'DA_HUY',
                  inventory_remaining = 0
              WHERE id = ${tId} OR id LIKE ${tId + '-%'}
            `;
            for (const cr of cancelRows) {
              const cPgId = String(cr.payment_group_id || '').trim();
              if (cPgId) await syncPaymentGroupLedger(sql, cPgId, { cancelStatus: 'CANCELLED' }).catch(() => {});
            }
          } else {
            if (shouldSettlePreOrder) {
              const preRows = await sql`
                SELECT id, wallet_id, wallet_name, total_amount, status, order_status, is_deleted, payment_group_id, product_name, date, statement_date
                FROM business_orders
                WHERE (id = ${tId} OR id LIKE ${tId + '-%'})
                  AND is_deleted = false
                  AND UPPER(COALESCE(status, '')) LIKE '%PRE%'
              `.catch(() => []);

              for (const pr of preRows) {
                const amt = Math.round(Number(pr.total_amount || 0));
                if ((pr.wallet_id || pr.wallet_name) && amt > 0) {
                  const wOld = await adjustWalletForPurchaseOrder(sql, { walletId: pr.wallet_id, walletName: pr.wallet_name }, amt, true, -1);
                  const wNew = await adjustWalletForPurchaseOrder(sql, { walletId: pr.wallet_id, walletName: pr.wallet_name }, amt, false, +1);
                  if (wOld?.id) touchedWalletIds.push(wOld.id);
                  if (wNew?.id) touchedWalletIds.push(wNew.id);
                }
                const prPgId = String(pr.payment_group_id || '').trim();
                if (!prPgId) {
                  const basePrId = extractBaseOrderId(pr.id) || pr.id;
                  await sql`
                    UPDATE wallet_ledger
                    SET status = 'POSTED',
                        event_type = CASE WHEN event_type = 'PREORDER_HOLD' THEN 'PURCHASE_CHARGE' ELSE event_type END,
                        effect_type = CASE
                          WHEN COALESCE(direction, '') IN ('INCREASE', 'DECREASE')
                            OR EXISTS (SELECT 1 FROM wallets w WHERE w.id = wallet_ledger.wallet_id AND UPPER(w.type) = 'CREDIT')
                          THEN 'CARD_DEBT'
                          ELSE 'CASH'
                        END,
                        note = REGEXP_REPLACE(COALESCE(note, ''), '^\\[(?:Pre(?:[-\\s]*order(?:\\s*Mua\\s*hàng)?)?)\\]\\s*-\\s*', '[Mua hàng] - ', 'i')
                    WHERE order_id = ${pr.id} OR id = ${pr.id} OR order_id = ${basePrId}
                  `.catch(() => {});
                }
              }
            }

            await sql`
              UPDATE business_orders
              SET warehouse = ${finalWhId || finalWh},
                  warehouse_id = ${finalWhId},
                  status = CASE
                    WHEN ${shouldSettlePreOrder} AND UPPER(COALESCE(status, '')) LIKE '%PRE%' THEN 'HOAN_TAT'
                    ELSE status
                  END,
                  note = CASE
                    WHEN ${shouldSettlePreOrder} AND UPPER(COALESCE(status, '')) LIKE '%PRE%'
                    THEN TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(note, ''), '\\[Pre-order/Chờ trừ thẻ\\]', '', 'gi'), '\\[Pre-order/Chờ sao kê\\]', '', 'gi'), '\\[Pre-order\\]', '', 'gi'))
                    ELSE note
                  END,
                  inventory_remaining = CASE
                    WHEN ${targetRole === 'DAT_TRUOC'} THEN 0
                    WHEN ${!targetIsPendingOrCancel} AND COALESCE(inventory_remaining, 0) = 0 AND (
                      UPPER(COALESCE(status, '')) LIKE '%PRE%' OR
                      (${pendingWhIds.length > 0} AND COALESCE(warehouse_id, '') = ANY(${pendingWhIds})) OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%đặt trước%' OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%dat truoc%' OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%preorder%' OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%pre-order%' OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%chờ ship%' OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%cho ship%' OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%chusen%' OR
                      LOWER(COALESCE(warehouse, '')) LIKE '%chyusen%'
                    ) THEN quantity
                    ELSE inventory_remaining
                  END
              WHERE id = ${tId} OR id LIKE ${tId + '-%'}
            `;

            if (shouldSettlePreOrder) {
              const settledPgRows = await sql`
                SELECT DISTINCT payment_group_id
                FROM business_orders
                WHERE (id = ${tId} OR id LIKE ${tId + '-%'}) AND COALESCE(payment_group_id, '') != ''
              `.catch(() => []);
              for (const sp of settledPgRows) {
                const pgId = String(sp.payment_group_id || '').trim();
                if (!pgId) continue;
                const [remPreFam, remPreBiz] = await Promise.all([
                  sql`SELECT id FROM family_transactions WHERE payment_group_id = ${pgId} AND UPPER(COALESCE(status, '')) LIKE '%PRE%' LIMIT 1`.catch(() => []),
                  sql`SELECT id FROM business_orders WHERE payment_group_id = ${pgId} AND is_deleted = false AND UPPER(COALESCE(status, '')) LIKE '%PRE%' LIMIT 1`.catch(() => [])
                ]);
                if (remPreFam.length === 0 && remPreBiz.length === 0) {
                  await syncPaymentGroupLedger(sql, pgId, { isPreOrder: false });
                } else {
                  const detachedRows = await sql`SELECT id, date, statement_date, product_name, total_amount, wallet_id, wallet_name FROM business_orders WHERE (id = ${tId} OR id LIKE ${tId + '-%'}) AND payment_group_id = ${pgId}`.catch(() => []);
                  for (const dr of detachedRows) {
                    await sql`UPDATE business_orders SET payment_group_id = '' WHERE id = ${dr.id}`;
                    const wObj = await findWalletByOrderName(sql, { walletId: dr.wallet_id, walletName: dr.wallet_name });
                    const isCr = wObj ? String(wObj.type || '').toUpperCase() === 'CREDIT' : false;
                    await upsertWalletLedgerEntry(sql, {
                      date: dr.date,
                      statementDate: dr.statement_date || '',
                      walletId: wObj ? String(wObj.id) : dr.wallet_id,
                      walletName: wObj ? wObj.name : dr.wallet_name,
                      eventType: 'PURCHASE_CHARGE',
                      effectType: isCr ? 'CARD_DEBT' : 'CASH',
                      amount: Number(dr.total_amount || 0),
                      balanceAfter: wObj ? Number(wObj.current_balance || 0) : 0,
                      note: '[Mua hàng] - ' + (dr.product_name || 'Đơn mua'),
                      orderId: dr.id,
                      status: 'POSTED',
                      direction: isCr ? 'INCREASE' : 'OUT',
                      sourceModule: 'Purchase'
                    });
                  }
                  await syncPaymentGroupLedger(sql, pgId);
                }
              }
            }
          }
        }

        if (touchedWalletIds.length > 0) {
          await syncCreditWalletPreorders(sql, touchedWalletIds).catch(() => {});
        }

        const [freshData, updatedWallets] = await Promise.all([
          getBusinessDataHelper(sql).catch(() => null),
          sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv
            FROM wallets WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL' ORDER BY id ASC
          `.catch(() => [])
        ]);

        return res.status(200).json({
          success: true,
          message: `Đã cập nhật kho sang "${finalWh}" cho ${targetIds.length} mục thành công!`,
          freshData,
          wallets: updatedWallets,
          updatedWallets
        });
      }

      // 15E. XÁC NHẬN THANH TOÁN PHÁT SINH PRE-ORDER (Tab 2 & Tab 3)
      case 'confirmPreOrderPayment':
      case 'confirmBatchPreOrdersPayment': {
        const rawIds = (Array.isArray(args[0]) ? args[0] : [args[0]])
          .flatMap(id => (typeof id === 'object' && id !== null ? (id.id || '') : String(id || '')).split(','))
          .map(s => s.trim())
          .filter(Boolean);
        const customDate = String(args[1] || new Date().toISOString().slice(0, 10));
        const whCats = await sql`SELECT id, type, name, is_hidden FROM categories WHERE type IN ('WAREHOUSE', 'WAREHOUSE_STATUS') ORDER BY id ASC`.catch(() => []);
        const choShipCat = resolveWarehouseCategory(whCats, { fallbackRole: 'CHO_SHIP' });
        const targetChoShipName = choShipCat ? choShipCat.name : 'Chờ Ship';
        const targetChoShipId = choShipCat ? String(choShipCat.id) : null;
        const preOrderWhIds = (whCats || []).filter(c => getWarehouseRole(c) === 'DAT_TRUOC').map(c => String(c.id));
        const touchedCredIds = [];
        for (const id of rawIds) {
          if (!id) continue;
          let resolvedPgId = /^PG-/i.test(id) ? id : '';
          if (!resolvedPgId && /^LED-/i.test(id)) {
            const ledLookup = await sql`SELECT payment_group_id, order_id FROM wallet_ledger WHERE id = ${id} LIMIT 1`.catch(() => []);
            if (ledLookup.length > 0 && ledLookup[0].payment_group_id) {
              resolvedPgId = String(ledLookup[0].payment_group_id).trim();
            }
          }

          if (resolvedPgId) {
            const [ordRows, famRows] = await Promise.all([
              sql`SELECT id, wallet_id, wallet_name, total_amount, status, order_status, is_deleted FROM business_orders WHERE payment_group_id = ${resolvedPgId}`,
              sql`SELECT id, wallet_id, wallet_name, amount, type, status FROM family_transactions WHERE payment_group_id = ${resolvedPgId}`
            ]);
            await sql`
              UPDATE business_orders
              SET status = 'HOAN_TAT',
                  order_status = 'HOAN_TAT',
                  warehouse_id = CASE
                    WHEN (${preOrderWhIds.length > 0} AND COALESCE(warehouse_id, '') = ANY(${preOrderWhIds}))
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%đặt trước%'
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%dat truoc%'
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%preorder%'
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%pre-order%'
                    THEN COALESCE(${targetChoShipId}, warehouse_id)
                    ELSE warehouse_id
                  END,
                  warehouse = CASE
                    WHEN (${preOrderWhIds.length > 0} AND COALESCE(warehouse_id, '') = ANY(${preOrderWhIds}))
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%đặt trước%'
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%dat truoc%'
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%preorder%'
                      OR LOWER(COALESCE(warehouse, '')) LIKE '%pre-order%'
                    THEN COALESCE(${targetChoShipId || targetChoShipName}, warehouse)
                    ELSE warehouse
                  END,
                  note = TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(note, ''), '\\[Pre-order/Chờ trừ thẻ\\]', '', 'gi'), '\\[Pre-order/Chờ sao kê\\]', '', 'gi'), '\\[Pre-order\\]', '', 'gi')),
                  statement_date = ${customDate}
              WHERE payment_group_id = ${resolvedPgId} AND is_deleted = false
            `;
            await sql`
              UPDATE family_transactions
              SET status = 'HOAN_TAT',
                  statement_date = ${customDate}
              WHERE payment_group_id = ${resolvedPgId}
            `;

            for (const ord of ordRows) {
              const ordSt = String(ord.order_status || '').toUpperCase();
              if (ord.is_deleted || ordSt === 'DA_HUY' || ordSt === 'DA_HOAN_TIEN') continue;
              if (!String(ord.status || '').toUpperCase().includes('PRE')) continue;
              const amt = Number(ord.total_amount || 0);
              if ((ord.wallet_id || ord.wallet_name) && amt > 0) {
                const w = await findWalletByOrderName(sql, { walletId: ord.wallet_id, walletName: ord.wallet_name }, 'CREDIT');
                if (w && String(w.type || '').toUpperCase() === 'CREDIT') {
                  touchedCredIds.push(w.id);
                  const newPre = Math.max(0, Number(w.preorder || 0) - amt);
                  const newDebt = Number(w.debt || 0) + amt;
                  const limit = Number(w.credit_limit || 0);
                  const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
                  await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
                } else if (w) {
                  touchedCredIds.push(w.id);
                  await sql`UPDATE wallets SET preorder = ${Math.max(0, Number(w.preorder || 0) - amt)}, current_balance = ${Number(w.current_balance || 0) - amt} WHERE id = ${w.id}`;
                }
              }
            }
            for (const fam of famRows) {
              const famSt = String(fam.status || '').toUpperCase();
              if (!famSt.includes('PRE') || famSt === 'DA_HUY') continue;
              const amt = Number(fam.amount || 0);
              const isThu = String(fam.type || '').toLowerCase() === 'thu';
              if ((fam.wallet_id || fam.wallet_name) && amt > 0) {
                const w = await findWalletByOrderName(sql, { walletId: fam.wallet_id, walletName: fam.wallet_name }, 'CREDIT');
                if (w && String(w.type || '').toUpperCase() === 'CREDIT') {
                  touchedCredIds.push(w.id);
                  const newPre = Math.max(0, Number(w.preorder || 0) - amt);
                  const newDebt = isThu ? Math.max(0, Number(w.debt || 0) - amt) : (Number(w.debt || 0) + amt);
                  const limit = Number(w.credit_limit || 0);
                  const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
                  await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
                } else if (w) {
                  touchedCredIds.push(w.id);
                  const balSign = isThu ? 1 : -1;
                  await sql`UPDATE wallets SET preorder = ${Math.max(0, Number(w.preorder || 0) - amt)}, current_balance = ${Number(w.current_balance || 0) + balSign * amt} WHERE id = ${w.id}`;
                }
              }
            }
            await syncPaymentGroupLedger(sql, resolvedPgId, { isPreOrder: false, statementDate: customDate });
            continue;
          }

          const ordRows = await sql`SELECT id, wallet_id, wallet_name, total_amount, status, order_status, is_deleted, payment_group_id, product_name, date FROM business_orders WHERE id = ${id} OR id LIKE ${id + '-%'}`;
          const famRows = await sql`SELECT id, wallet_id, wallet_name, amount, type, status, payment_group_id, content, date FROM family_transactions WHERE id = ${id} OR id LIKE ${id + '-%'}`;
          const childPgIds = Array.from(new Set([
            ...ordRows.map(r => String(r.payment_group_id || '').trim()),
            ...famRows.map(r => String(r.payment_group_id || '').trim())
          ].filter(Boolean)));

          await sql`
            UPDATE business_orders
            SET status = 'HOAN_TAT',
                order_status = 'HOAN_TAT',
                warehouse_id = CASE
                  WHEN (${preOrderWhIds.length > 0} AND COALESCE(warehouse_id, '') = ANY(${preOrderWhIds}))
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%đặt trước%'
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%dat truoc%'
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%preorder%'
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%pre-order%'
                  THEN COALESCE(${targetChoShipId}, warehouse_id)
                  ELSE warehouse_id
                END,
                warehouse = CASE
                  WHEN (${preOrderWhIds.length > 0} AND COALESCE(warehouse_id, '') = ANY(${preOrderWhIds}))
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%đặt trước%'
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%dat truoc%'
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%preorder%'
                    OR LOWER(COALESCE(warehouse, '')) LIKE '%pre-order%'
                  THEN COALESCE(${targetChoShipId || targetChoShipName}, warehouse)
                  ELSE warehouse
                END,
                note = TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(note, ''), '\\[Pre-order/Chờ trừ thẻ\\]', '', 'gi'), '\\[Pre-order/Chờ sao kê\\]', '', 'gi'), '\\[Pre-order\\]', '', 'gi')),
                statement_date = ${customDate}
            WHERE id = ${id} OR id LIKE ${id + '-%'}
          `;
          await sql`
            UPDATE family_transactions
            SET status = 'HOAN_TAT',
                statement_date = ${customDate}
            WHERE id = ${id} OR id LIKE ${id + '-%'}
          `;

          if (childPgIds.length === 0) {
            const baseOrdId = extractBaseOrderId(id) || id;
            await sql`
              UPDATE wallet_ledger
              SET status = 'POSTED',
                  event_type = CASE WHEN event_type = 'PREORDER_HOLD' THEN 'PURCHASE_CHARGE' ELSE event_type END,
                  effect_type = CASE
                    WHEN COALESCE(direction, '') IN ('INCREASE', 'DECREASE')
                      OR EXISTS (SELECT 1 FROM wallets w WHERE w.id = wallet_ledger.wallet_id AND UPPER(w.type) = 'CREDIT')
                    THEN 'CARD_DEBT'
                    ELSE 'CASH'
                  END,
                  statement_date = ${customDate},
                  note = REGEXP_REPLACE(COALESCE(note, ''), '^\\[(?:Pre(?:[-\\s]*order(?:\\s*Mua\\s*hàng)?)?)\\]\\s*-\\s*', '[Mua hàng] - ', 'i')
              WHERE order_id = ${id} OR id = ${id} OR order_id = ${baseOrdId} OR order_id LIKE ${id + '-%'}
            `;
          }

          // Chuyển số dư preorder -> debt trên thẻ tín dụng cho các dòng trước đó ở trạng thái PRE-ORDER
          for (const ord of ordRows) {
            const ordSt = String(ord.order_status || '').toUpperCase();
            if (ord.is_deleted || ordSt === 'DA_HUY' || ordSt === 'DA_HOAN_TIEN') continue;
            if (!String(ord.status || '').toUpperCase().includes('PRE')) continue;
            const wId = String(ord.wallet_id || '').trim();
            const wName = String(ord.wallet_name || '').trim();
            const amt = Number(ord.total_amount || 0);
            if ((wId || wName) && amt > 0) {
              const w = await findWalletByOrderName(sql, { walletId: wId, walletName: wName }, 'CREDIT');
              if (w && String(w.type || '').toUpperCase() === 'CREDIT') {
                touchedCredIds.push(w.id);
                const newPre = Math.max(0, Number(w.preorder || 0) - amt);
                const newDebt = Number(w.debt || 0) + amt;
                const limit = Number(w.credit_limit || 0);
                const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
                await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
              } else if (w) {
                // Debit/Cash: đến lúc "Đã trừ thẻ" mới thực sự trừ tiền, đồng thời gỡ cam kết
                touchedCredIds.push(w.id);
                const newPreD = Math.max(0, Number(w.preorder || 0) - amt);
                const newBalD = Number(w.current_balance || 0) - amt;
                await sql`UPDATE wallets SET preorder = ${newPreD}, current_balance = ${newBalD} WHERE id = ${w.id}`;
              }
            }
          }
          for (const fam of famRows) {
            const famSt = String(fam.status || '').toUpperCase();
            if (!famSt.includes('PRE') || famSt === 'DA_HUY') continue;
            const wId = String(fam.wallet_id || '').trim();
            const wName = String(fam.wallet_name || '').trim();
            const amt = Number(fam.amount || 0);
            const isThu = String(fam.type || '').toLowerCase() === 'thu';
            if ((wId || wName) && amt > 0) {
              const w = await findWalletByOrderName(sql, { walletId: wId, walletName: wName }, 'CREDIT');
              if (w && String(w.type || '').toUpperCase() === 'CREDIT') {
                touchedCredIds.push(w.id);
                const newPre = Math.max(0, Number(w.preorder || 0) - amt);
                const newDebt = isThu ? Math.max(0, Number(w.debt || 0) - amt) : (Number(w.debt || 0) + amt);
                const limit = Number(w.credit_limit || 0);
                const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
                await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
              } else if (w) {
                touchedCredIds.push(w.id);
                const balSign = isThu ? 1 : -1;
                await sql`UPDATE wallets SET preorder = ${Math.max(0, Number(w.preorder || 0) - amt)}, current_balance = ${Number(w.current_balance || 0) + balSign * amt} WHERE id = ${w.id}`;
              }
            }
          }

          for (const pgId of childPgIds) {
            const [remPreFam, remPreBiz] = await Promise.all([
              sql`SELECT id FROM family_transactions WHERE payment_group_id = ${pgId} AND UPPER(COALESCE(status, '')) LIKE '%PRE%' LIMIT 1`.catch(() => []),
              sql`SELECT id FROM business_orders WHERE payment_group_id = ${pgId} AND is_deleted = false AND UPPER(COALESCE(status, '')) LIKE '%PRE%' LIMIT 1`.catch(() => [])
            ]);
            if (remPreFam.length === 0 && remPreBiz.length === 0) {
              await syncPaymentGroupLedger(sql, pgId, { isPreOrder: false, statementDate: customDate });
            } else {
              for (const ord of ordRows) {
                if (String(ord.payment_group_id || '').trim() !== pgId) continue;
                await sql`UPDATE business_orders SET payment_group_id = '' WHERE id = ${ord.id}`;
                const wObj = await findWalletByOrderName(sql, { walletId: ord.wallet_id, walletName: ord.wallet_name });
                const isCr = wObj ? String(wObj.type || '').toUpperCase() === 'CREDIT' : false;
                await upsertWalletLedgerEntry(sql, {
                  date: ord.date || customDate,
                  statementDate: customDate,
                  walletId: wObj ? String(wObj.id) : ord.wallet_id,
                  walletName: wObj ? wObj.name : ord.wallet_name,
                  eventType: 'PURCHASE_CHARGE',
                  effectType: isCr ? 'CARD_DEBT' : 'CASH',
                  amount: Number(ord.total_amount || 0),
                  balanceAfter: wObj ? Number(wObj.current_balance || 0) : 0,
                  note: '[Mua hàng] - ' + (ord.product_name || 'Đơn mua'),
                  orderId: ord.id,
                  status: 'POSTED',
                  direction: isCr ? 'INCREASE' : 'OUT',
                  sourceModule: 'Purchase'
                });
              }
              for (const fam of famRows) {
                if (String(fam.payment_group_id || '').trim() !== pgId) continue;
                await sql`UPDATE family_transactions SET payment_group_id = '' WHERE id = ${fam.id}`;
                const wObj = await findWalletByOrderName(sql, { walletId: fam.wallet_id, walletName: fam.wallet_name });
                const isCr = wObj ? String(wObj.type || '').toUpperCase() === 'CREDIT' : false;
                const isThu = String(fam.type || '').toLowerCase() === 'thu';
                await upsertWalletLedgerEntry(sql, {
                  date: fam.date || customDate,
                  statementDate: customDate,
                  walletId: wObj ? String(wObj.id) : fam.wallet_id,
                  walletName: wObj ? wObj.name : fam.wallet_name,
                  eventType: isThu ? 'FAMILY_INCOME' : 'FAMILY_EXPENSE',
                  effectType: isCr ? 'CARD_DEBT' : 'CASH',
                  amount: Number(fam.amount || 0),
                  balanceAfter: wObj ? Number(wObj.current_balance || 0) : 0,
                  note: fam.content || 'Chi tiêu',
                  orderId: fam.id,
                  status: 'POSTED',
                  direction: isThu ? (isCr ? 'DECREASE' : 'IN') : (isCr ? 'INCREASE' : 'OUT'),
                  sourceModule: 'Family'
                });
              }
              await syncPaymentGroupLedger(sql, pgId);
            }
          }
        }
        if (touchedCredIds.length > 0) await syncCreditWalletPreorders(sql, touchedCredIds);
        return res.status(200).json({ success: true, message: 'Đã xác nhận thanh toán phát sinh thành công!' });
      }

      case 'cancelPreOrderOrder':
      case 'cancelBatchPreOrders': {
        const rawIds = (Array.isArray(args[0]) ? args[0] : [args[0]])
          .flatMap(id => (typeof id === 'object' && id !== null ? (id.id || '') : String(id || '')).split(','))
          .map(s => s.trim())
          .filter(Boolean);
        const touchedCredIds = [];
        for (const id of rawIds) {
          if (!id) continue;
          const ordRows = await sql`SELECT id, wallet_id, wallet_name, total_amount, is_deleted, order_status, payment_group_id FROM business_orders WHERE id = ${id} OR id LIKE ${id + '-%'} OR payment_group_id = ${id}`;
          const famRows = await sql`SELECT id, wallet_id, wallet_name, amount, type, status, payment_group_id FROM family_transactions WHERE id = ${id} OR id LIKE ${id + '-%'} OR payment_group_id = ${id}`;
          const cancelPgIds = Array.from(new Set([
            ...(/^PG-/i.test(id) ? [id] : []),
            ...ordRows.map(r => String(r.payment_group_id || '').trim()),
            ...famRows.map(r => String(r.payment_group_id || '').trim())
          ].filter(Boolean)));
          await sql`
            UPDATE business_orders
            SET order_status = 'DA_HUY',
                is_deleted = true,
                inventory_remaining = 0
            WHERE id = ${id} OR id LIKE ${id + '-%'} OR payment_group_id = ${id}
          `;
          if (famRows.length > 0) {
            await sql`DELETE FROM family_transactions WHERE id = ${id} OR id LIKE ${id + '-%'} OR payment_group_id = ${id}`;
          }
          await sql`
            UPDATE wallet_ledger
            SET status = 'VOID'
            WHERE (order_id = ${id} OR id = ${id} OR order_id LIKE ${id + '-%'})
              AND COALESCE(payment_group_id, '') = ''
          `;
          for (const pgId of cancelPgIds) {
            await syncPaymentGroupLedger(sql, pgId, { cancelStatus: 'VOID' });
          }
          for (const ord of ordRows) {
            const ordSt = String(ord.order_status || '').toUpperCase();
            if (ord.is_deleted || ordSt === 'DA_HUY' || ordSt === 'DA_HOAN_TIEN') continue;
            const amt = Number(ord.total_amount || 0);
            if (amt > 0 && (ord.wallet_id || ord.wallet_name)) {
              const w = await findWalletByOrderName(sql, { walletId: ord.wallet_id, walletName: ord.wallet_name }, 'CREDIT');
              if (w) {
                touchedCredIds.push(w.id);
                if (String(w.type || '').toUpperCase() === 'CREDIT') {
                  const newPre = Math.max(0, Number(w.preorder || 0) - amt);
                  const limit = Number(w.credit_limit || 0);
                  const newBal = limit > 0 ? Math.max(0, limit - Number(w.debt || 0) - newPre) : Number(w.current_balance || 0);
                  await sql`UPDATE wallets SET preorder = ${newPre}, current_balance = ${newBal} WHERE id = ${w.id}`;
                } else {
                  // Debit/Cash đặt trước: chưa trừ tiền nên chỉ gỡ cam kết
                  await sql`UPDATE wallets SET preorder = ${Math.max(0, Number(w.preorder || 0) - amt)} WHERE id = ${w.id}`;
                }
              }
            }
          }
          for (const fam of famRows) {
            const famSt = String(fam.status || '').toUpperCase();
            if (famSt === 'DA_HUY') continue;
            const resDelta = await applyFamilyWalletDelta(sql, {
              walletId: fam.wallet_id,
              walletName: fam.wallet_name,
              amount: Number(fam.amount || 0),
              isThu: String(fam.type || '').toLowerCase() === 'thu',
              isPre: famSt.includes('PRE'),
              sign: -1
            });
            if (resDelta.isCredit && resDelta.wallet) touchedCredIds.push(resDelta.wallet.id);
          }
        }
        if (touchedCredIds.length > 0) await syncCreditWalletPreorders(sql, touchedCredIds);
        return res.status(200).json({ success: true, message: 'Đã hủy đơn pre-order thành công!' });
      }

      // 15F. XÁC NHẬN THU TIỀN ĐƠN KHÁCH NỢ (Tab 3)
      case 'confirmBatchDebtSalesPayment': {
        const [itemIds, walletName, dateStr, walletIdArg] = args;
        const ids = Array.isArray(itemIds) ? itemIds : [itemIds];
        const rawWName = String(walletName || 'Tiền mặt').trim();
        const rawWId = String(walletIdArg || '').trim();
        const w = (rawWId || rawWName) ? await findWalletByOrderName(sql, { walletId: rawWId, walletName: rawWName }) : null;
        const wId = w ? String(w.id) : rawWId;
        const wName = w ? String(w.name) : rawWName;
        const date = String(dateStr || new Date().toISOString().slice(0, 10));

        let totalRecv = 0;
        for (const rawId of ids) {
          const id = String(rawId || '').trim();
          if (!id) continue;
          const sRows = await sql`SELECT id, total_amount FROM sales_orders WHERE id = ${id} LIMIT 1`;
          if (sRows.length > 0) {
            totalRecv += Number(sRows[0].total_amount || 0);
            await sql`UPDATE sales_orders SET status = 'HOAN_TAT', wallet_id = ${wId}, wallet_name = ${wName}, date = ${date} WHERE id = ${id}`;
          }
        }

        if (w && totalRecv > 0) {
          const newBal = Number(w.current_balance || 0) + totalRecv;
          await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${w.id}`;
          await upsertWalletLedgerEntry(sql, {
            date,
            walletId: String(w.id),
            walletName: String(w.name),
            eventType: 'CUSTOMER_COLLECT',
            effectType: 'CASH',
            amount: totalRecv,
            balanceAfter: newBal,
            note: `Thu tiền đơn khách nợ (${ids.length} đơn)`,
            orderId: ids.join(', '),
            status: 'POSTED',
            direction: 'IN',
            sourceModule: 'Sales'
          });
        }

        return res.status(200).json({ success: true, message: 'Đã thu tiền đơn khách nợ thành công!' });
      }

      // 15G. XÁC NHẬN HOÀN TIỀN ĐƠN HÀNG (Tab 3)
      case 'confirmRefundOrderPayment':
      case 'confirmBatchRefundOrders': {
        const rawIds = (Array.isArray(args[0]) ? args[0] : [args[0]])
          .flatMap(id => (typeof id === 'object' && id !== null ? (id.id || '') : String(id || '')).split(','))
          .map(s => s.trim())
          .filter(Boolean);
        const targetWallet = String(args[1] || '').trim();
        const customDate = String(args[2] || new Date().toISOString().slice(0, 10));
        const targetWalletId = String(args[3] || '').trim();

        if (rawIds.length === 0) return res.status(200).json({ success: false, message: 'Chưa chọn mã đơn hoàn tiền' });
        if (!targetWallet && !targetWalletId) return res.status(200).json({ success: false, message: 'Chưa chọn ví nhận hoàn tiền' });

        const wallet = await findWalletByOrderName(sql, { walletId: targetWalletId, walletName: targetWallet });
        if (!wallet) return res.status(200).json({ success: false, message: `Ví "${targetWallet || targetWalletId}" không tồn tại` });
        const isCredit = String(wallet.type || '').toUpperCase() === 'CREDIT';

        let totalRefunded = 0;
        let count = 0;

        for (const id of rawIds) {
          const ordRows = await sql`SELECT id, total_amount, quantity, unit_price, note, status, order_status FROM business_orders WHERE id = ${id} OR id LIKE ${id + '-%'}`;
          for (const ord of ordRows) {
            const st = String(ord.status || '').trim().toUpperCase();
            const ordSt = String(ord.order_status || '').trim().toUpperCase();
            if (st === 'DA_HOAN_TIEN' || ordSt === 'DA_HOAN_TIEN' || st === 'ĐÃ HOÀN TIỀN' || ordSt === 'ĐÃ HOÀN TIỀN') {
              continue;
            }
            const amt = Number(ord.total_amount || (Number(ord.quantity || 0) * Number(ord.unit_price || 0)));
            totalRefunded += amt;
            count++;

            const newNote = (String(ord.note || '') + ` [DA_HOAN_TIEN - Ngày: ${customDate} - Ví: ${targetWallet}]`).trim();
            await sql`
              UPDATE business_orders
              SET status = 'DA_HOAN_TIEN',
                  order_status = 'DA_HOAN_TIEN',
                  warehouse = 'Hủy',
                  inventory_remaining = 0,
                  note = ${newNote}
              WHERE id = ${ord.id}
            `;

            // Cập nhật ledger cũ thành REFUNDED nếu có
            await sql`UPDATE wallet_ledger SET status = 'REFUNDED' WHERE order_id = ${ord.id}`;
          }
        }

        if (count === 0) {
          return res.status(200).json({ success: false, message: 'Các đơn hàng này đã được hoàn tiền trước đó rồi!' });
        }

        // Cập nhật số dư ví nhận hoàn tiền
        if (totalRefunded > 0) {
          if (isCredit) {
            await sql`UPDATE wallets SET debt = GREATEST(0, COALESCE(debt, 0) - ${totalRefunded}) WHERE id = ${wallet.id}`;
          } else {
            await sql`UPDATE wallets SET current_balance = COALESCE(current_balance, 0) + ${totalRefunded} WHERE id = ${wallet.id}`;
          }

          // Ghi nhận vào sổ cái wallet_ledger
          const ledId = 'LED-' + Date.now().toString().slice(-14) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
          await sql`
            INSERT INTO wallet_ledger (id, transaction_date, wallet_id, wallet_name, event_type, effect_type, amount, balance_after, note, order_id, status, direction, source_module)
            VALUES (
              ${ledId},
              ${customDate},
              ${String(wallet.id)},
              ${wallet.name},
              ${isCredit ? 'REFUND_CARD_DEBT' : 'REFUND_CASH'},
              ${isCredit ? 'CARD_DEBT' : 'CASH'},
              ${totalRefunded},
              0,
              ${`[Hoàn tiền] Cho ${count} đơn hàng: ${rawIds.join(', ')}`},
              ${rawIds[0]},
              'POSTED',
              ${isCredit ? 'DECREASE' : 'INCREASE'},
              'Purchase'
            )
          `;
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        return res.status(200).json({
          success: true,
          message: `Đã xác nhận hoàn ${totalRefunded.toLocaleString('vi-VN')} đ cho ${count} đơn hàng về "${targetWallet}"!`,
          count,
          totalRefunded,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 16. HỦY / XÓA ĐƠN BÁN (Tab 3)
      case 'cancelSalesOrder':
      case 'deleteSalesOrder': {
        const raw = args[0] || (req.body && (req.body.id || req.body.rowId || req.body.row));
        const id = String((typeof raw === 'object' && raw !== null) ? (raw.id || raw.rowId || raw.row || '') : (raw || '')).trim();
        const reason = String((typeof raw === 'object' && raw !== null) ? (raw.reason || '') : (args[1] || '')).trim();
        const isDeleteAction = action === 'deleteSalesOrder' || Boolean(typeof raw === 'object' && raw !== null && raw.hardDelete);
        if (!id) return res.status(200).json({ success: false, message: 'Mã đơn không hợp lệ' });
        const baseId = extractBaseOrderId(id) || id;
        const matchPattern = baseId + '-%';

        // 1. Tìm tất cả dòng đơn bán (cả mã gốc SO-xxxx lẫn mã con SO-xxxx-1...)
        const matchedSales = await sql`
          SELECT id, product_name, warehouse, warehouse_id, quantity, total_amount, wallet_id, wallet_name, status, order_status, is_deleted
          FROM sales_orders
          WHERE id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}
        `;

        if (matchedSales.length === 0) {
          return res.status(200).json({ success: false, message: `Không tìm thấy đơn bán: ${id}` });
        }

        const isRowCancelled = (it) => {
          const ordSt = String(it.order_status || '').toUpperCase();
          const st = String(it.status || '').toUpperCase();
          return Boolean(it.is_deleted) || ['DA_HUY', 'DA_HOAN_TIEN'].includes(ordSt) || ['DA_HUY', 'DA_HOAN_TIEN'].includes(st);
        };
        const allCancelled = matchedSales.every(isRowCancelled);
        if (allCancelled && !isDeleteAction) {
          return res.status(200).json({ success: false, message: `Đơn bán #${baseId} đã ở trạng thái hủy trước đó.` });
        }

        const whCatRows = await sql`
          SELECT id, type, name FROM categories WHERE type IN ('WAREHOUSE', 'WAREHOUSE_STATUS')
        `.catch(() => []);
        const whCatByIdMap = buildCategoryByIdMap(whCatRows);

        // 2. Trả lại kho cho các dòng chưa bị hủy (phân bổ reverse-FIFO, không bao giờ vượt quá quantity từng lô)
        for (const it of matchedSales) {
          if (isRowCancelled(it)) continue;
          const qty = Number(it.quantity || 0);
          const pName = String(it.product_name || '').trim();
          if (qty > 0 && pName) {
            const poRows = await sql`
              SELECT id, date, inventory_remaining, quantity, warehouse, warehouse_id, status, order_status, is_deleted
              FROM business_orders
              WHERE LOWER(TRIM(product_name)) = ${pName.toLowerCase()}
                AND is_deleted = false
                AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
              ORDER BY date DESC, id DESC
            `;
            const targetWhId = String(it.warehouse_id || '').trim();
            const targetWhCat = (targetWhId && whCatByIdMap.get(targetWhId)) || (it.warehouse && whCatByIdMap.get(String(it.warehouse).trim())) || null;
            const targetWhName = targetWhCat ? String(targetWhCat.name || '').trim() : String(it.warehouse || '').trim();
            const { updates } = computeSalesCancellationRestorations(poRows, qty, {
              warehouseId: targetWhId || (targetWhCat ? String(targetWhCat.id) : ''),
              warehouseName: targetWhName,
              catByIdMap: whCatByIdMap
            });
            for (const upd of updates) {
              await sql`UPDATE business_orders SET inventory_remaining = ${upd.newRemaining} WHERE id = ${upd.id}`;
            }
          }
        }

        // 3. Hoàn tác tiền đã thu vào ví cho các dòng chưa bị hủy (nếu không phải khách nợ)
        let activeSalesAmt = 0;
        matchedSales.forEach(it => {
          if (!isRowCancelled(it)) activeSalesAmt += Number(it.total_amount || 0);
        });
        const first = matchedSales[0] || {};
        const nhanTienId = String(first.wallet_id || '').trim();
        const nhanTienVao = String(first.wallet_name || '').trim();
        const firstStatusLower = String(first.status || '').toLowerCase();
        const isKhachNo = nhanTienVao.toLowerCase() === 'khách nợ' || nhanTienVao.toLowerCase() === 'khach no' || firstStatusLower.includes('khách nợ') || firstStatusLower.includes('khach no') || firstStatusLower.includes('cho_thu');

        if (!isKhachNo && (nhanTienId || nhanTienVao) && activeSalesAmt > 0) {
          const w = await findWalletByOrderName(sql, { walletId: nhanTienId, walletName: nhanTienVao });
          if (w) {
            const isCredit = String(w.type || '').toUpperCase() === 'CREDIT';
            if (isCredit) {
              const limit = Number(w.credit_limit || 0);
              const pre = Number(w.preorder || 0);
              const newDebt = Number(w.debt || 0) + activeSalesAmt;
              const newBal = limit > 0 ? Math.max(0, limit - newDebt - pre) : Number(w.current_balance || 0);
              await sql`UPDATE wallets SET debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
            } else {
              await sql`UPDATE wallets SET current_balance = COALESCE(current_balance, 0) - ${activeSalesAmt} WHERE id = ${w.id}`;
            }
          }
        }

        // 4. Xóa khỏi database hoặc đánh dấu hủy trên sổ cái & bảng đơn bán
        if (isDeleteAction) {
          await sql`DELETE FROM wallet_ledger WHERE order_id = ${id} OR id = ${id} OR order_id = ${baseId} OR id = ${baseId} OR order_id LIKE ${matchPattern}`;
          await sql`DELETE FROM sales_orders WHERE id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}`;
        } else {
          await sql`UPDATE wallet_ledger SET status = 'CANCELLED' WHERE order_id = ${id} OR id = ${id} OR order_id = ${baseId} OR id = ${baseId} OR order_id LIKE ${matchPattern}`;
          await sql`UPDATE sales_orders SET order_status = 'DA_HUY' WHERE id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}`;
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;
        const freshData = await getBusinessDataHelper(sql);

        return res.status(200).json({
          success: true,
          message: isDeleteAction ? `Đã xóa đơn bán #${baseId} khỏi database!` : `Đã hủy đơn bán #${baseId} thành công!`,
          deletedId: baseId,
          freshData,
          wallets: updatedWallets,
          updatedWallets
        });
      }

      // 16B. KHÔI PHỤC ĐƠN ĐÃ ẨN (is_deleted = true -> false)
      case 'restoreHiddenOrder': {
        const raw = args[0] || (req.body && req.body) || {};
        const id = String(raw.id || raw.baseId || '').trim();
        const kind = String(raw.kind || 'PURCHASE').toUpperCase() === 'SALES' ? 'SALES' : 'PURCHASE';
        if (!id) return res.status(200).json({ success: false, message: 'Mã đơn không hợp lệ' });
        const baseId = extractBaseOrderId(id) || id;
        const matchPattern = baseId + '-%';

        // Kiểm tra ledger trước đó có bị CANCELLED (tức là trước kia đã hoàn ví khi ẩn) hay không
        const cancelledLedger = await sql`
          SELECT id, status, effect_type
          FROM wallet_ledger
          WHERE (order_id = ${id} OR id = ${id} OR order_id = ${baseId} OR id = ${baseId} OR order_id LIKE ${matchPattern})
            AND status = 'CANCELLED'
        `;
        const hadReversedWallet = cancelledLedger.length > 0;

        if (kind === 'PURCHASE') {
          const rows = await sql`
            SELECT id, product_name, quantity, total_amount, wallet_id, wallet_name, status, warehouse, payment_group_id
            FROM business_orders
            WHERE (id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}) AND is_deleted = true
          `;
          if (rows.length === 0) {
            return res.status(200).json({ success: false, message: `Không tìm thấy đơn mua đang ẩn: #${baseId}` });
          }

          const restoredPgIds = Array.from(new Set(rows.map(r => String(r.payment_group_id || '').trim()).filter(Boolean)));
          let hadCancelledPgLedger = false;
          if (!hadReversedWallet && restoredPgIds.length > 0) {
            const pgCancelled = await sql`
              SELECT id FROM wallet_ledger WHERE payment_group_id = ANY(${restoredPgIds}) AND status IN ('CANCELLED', 'DELETED', 'VOID') LIMIT 1
            `.catch(() => []);
            hadCancelledPgLedger = pgCancelled.length > 0;
          }
          const shouldReChargeWallet = hadReversedWallet || hadCancelledPgLedger;

          const touchedPOIds = [];
          for (const r of rows) {
            const qty = Number(r.quantity || 0);
            const isPre = String(r.status || '').toUpperCase().includes('PRE');
            const restoredRem = isPre ? 0 : qty;
            await sql`
              UPDATE business_orders
              SET is_deleted = false,
                  order_status = 'HOAN_TAT',
                  inventory_remaining = ${restoredRem}
              WHERE id = ${r.id}
            `;

            if (shouldReChargeWallet) {
              const amt = Number(r.total_amount || 0);
              const w = await findWalletByOrderName(sql, { walletId: r.wallet_id, walletName: r.wallet_name });
              if (w && amt > 0) {
                touchedPOIds.push(w.id);
                const isCredit = String(w.type || '').toUpperCase() === 'CREDIT';
                if (isCredit) {
                  const limit = Number(w.credit_limit || 0);
                  const newPre = isPre ? (Number(w.preorder || 0) + amt) : Number(w.preorder || 0);
                  const newDebt = isPre ? Number(w.debt || 0) : (Number(w.debt || 0) + amt);
                  const newBal = limit > 0 ? Math.max(0, limit - newDebt - newPre) : Number(w.current_balance || 0);
                  await sql`UPDATE wallets SET preorder = ${newPre}, debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
                } else {
                  await sql`UPDATE wallets SET current_balance = COALESCE(current_balance, 0) - ${amt} WHERE id = ${w.id}`;
                }
              }
            }
          }
          for (const pgId of restoredPgIds) {
            await syncPaymentGroupLedger(sql, pgId);
          }
          if (touchedPOIds.length > 0) await syncCreditWalletPreorders(sql, touchedPOIds);
        } else {
          const rows = await sql`
            SELECT id, product_name, quantity, total_amount, wallet_id, wallet_name, status
            FROM sales_orders
            WHERE (id = ${id} OR id = ${baseId} OR id LIKE ${matchPattern}) AND is_deleted = true
          `;
          if (rows.length === 0) {
            return res.status(200).json({ success: false, message: `Không tìm thấy đơn bán đang ẩn: #${baseId}` });
          }

          let activeAmt = 0;
          for (const r of rows) {
            const qty = Number(r.quantity || 0);
            const pName = String(r.product_name || '').trim();
            activeAmt += Number(r.total_amount || 0);
            await sql`
              UPDATE sales_orders
              SET is_deleted = false,
                  order_status = 'HOAN_TAT'
              WHERE id = ${r.id}
            `;
            // Trừ lại tồn kho FIFO nếu trước đó đã hoàn khi ẩn (chỉ lấy hàng thực tế trong kho vật lý)
            if (qty > 0 && pName && hadReversedWallet) {
              let left = qty;
              const stockRows = await sql`
                SELECT id, inventory_remaining, warehouse, warehouse_id, status
                FROM business_orders
                WHERE LOWER(TRIM(product_name)) = ${pName.toLowerCase()}
                  AND inventory_remaining > 0
                  AND is_deleted = false
                  AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
                ORDER BY date ASC, id ASC
              `;
              const physStockRows = (stockRows || []).filter(st => {
                const stUp = String(st.status || '').toUpperCase();
                if (stUp === 'DA_HUY' || stUp === 'DA_HOAN_TIEN' || stUp === 'CHO_HOAN') return false;
                const wRaw = String(st.warehouse_id || st.warehouse || '').trim();
                if (!wRaw) return false;
                if (['DAT_TRUOC', 'CHO_SHIP', 'CHUSEN', 'HUY', 'CANCEL'].includes(wRaw.toUpperCase())) return false;
                if (isWarehousePendingName(wRaw) || isWarehousePreOrderName(wRaw) || isWarehouseCancelledName(wRaw)) return false;
                return true;
              });
              for (const st of physStockRows) {
                if (left <= 0) break;
                const rem = Number(st.inventory_remaining || 0);
                const d = Math.min(rem, left);
                left -= d;
                await sql`UPDATE business_orders SET inventory_remaining = ${rem - d} WHERE id = ${st.id}`;
              }
            }
          }

          const first = rows[0] || {};
          const wId = String(first.wallet_id || '').trim();
          const wName = String(first.wallet_name || '').trim();
          const stLow = String(first.status || '').toLowerCase();
          const isKhachNo = wName.toLowerCase() === 'khách nợ' || wName.toLowerCase() === 'khach no' || stLow.includes('khách nợ') || stLow.includes('khach no') || stLow.includes('cho_thu');
          if (hadReversedWallet && !isKhachNo && (wId || wName) && activeAmt > 0) {
            const w = await findWalletByOrderName(sql, { walletId: wId, walletName: wName });
            if (w) {
              const isCredit = String(w.type || '').toUpperCase() === 'CREDIT';
              if (isCredit) {
                const limit = Number(w.credit_limit || 0);
                const pre = Number(w.preorder || 0);
                const newDebt = Math.max(0, Number(w.debt || 0) - activeAmt);
                const newBal = limit > 0 ? Math.max(0, limit - newDebt - pre) : Number(w.current_balance || 0);
                await sql`UPDATE wallets SET debt = ${newDebt}, current_balance = ${newBal} WHERE id = ${w.id}`;
              } else {
                await sql`UPDATE wallets SET current_balance = COALESCE(current_balance, 0) + ${activeAmt} WHERE id = ${w.id}`;
              }
            }
          }
        }

        await sql`
          UPDATE wallet_ledger
          SET status = CASE WHEN effect_type = 'PREORDER_HOLD' THEN 'PENDING' ELSE 'POSTED' END
          WHERE (order_id = ${id} OR id = ${id} OR order_id = ${baseId} OR id = ${baseId} OR order_id LIKE ${matchPattern})
            AND status IN ('CANCELLED', 'VOID')
        `;

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;
        const freshData = await getBusinessDataHelper(sql);

        return res.status(200).json({
          success: true,
          message: `Đã khôi phục đơn #${baseId}!`,
          freshData,
          wallets: updatedWallets,
          updatedWallets
        });
      }

      // 17. LƯU CÔNG NỢ (Tab 4)
      case 'saveDebtTransaction':
      case 'addDebtTransaction': {
        const formData = args[0] || {};
        const tenRaw = String(formData.ten || formData.name || formData.doituong || '').trim();
        const loaiRaw = String(formData.loai || formData.type || 'THU').toUpperCase();
        const loai = (loaiRaw === 'CHO_VAY' || loaiRaw === 'THU') ? 'THU' : 'TRA';
        const date = String(formData.ngay || formData.date || new Date().toISOString().slice(0, 10));
        const content = String(formData.noidung || formData.content || '').trim();
        const amount = Number(formData.sotien || formData.amount || formData.tongNo || 0);
        const rawWalletId = String(formData.walletId || formData.wallet_id || '').trim();
        const rawWalletName = String(formData.nguon || formData.wallet_name || '').trim();
        const resolvedDebtW = (rawWalletId || rawWalletName)
          ? await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName })
          : null;
        const walletId = resolvedDebtW ? String(resolvedDebtW.id) : rawWalletId;
        const walletName = resolvedDebtW ? String(resolvedDebtW.name) : rawWalletName;
        const note = String(formData.ghichu || formData.note || '').trim();
        const existingId = String(formData.id || '').trim();

        if (!tenRaw || amount <= 0) {
          return res.status(200).json({ success: false, message: 'Vui lòng nhập đầy đủ tên đối tượng và số tiền nợ (> 0)!' });
        }

        const updatedWallets = [];
        let savedId = existingId;
        const debtCatRows = await sql`SELECT id, type, name FROM categories WHERE type IN ('PARTNER', 'FAMILY') ORDER BY id ASC`.catch(() => []);

        if (existingId) {
          const remainingDebt = Number(formData.duNo ?? formData.remaining_debt ?? amount);
          const status = String(formData.trangThai || formData.status || (remainingDebt <= 0 ? 'DA_TRA' : 'DANG_NO')).trim();
          let matchedPartner = resolveCategoryByIdOrName(debtCatRows, ['PARTNER', 'FAMILY'], { id: formData.partnerId, name: tenRaw });
          if (!matchedPartner && tenRaw) {
            matchedPartner = await ensureCategoryExistsByName(sql, debtCatRows, 'PARTNER', tenRaw);
          }
          const finalPartnerName = matchedPartner ? matchedPartner.name : tenRaw;
          const finalPartnerId = matchedPartner ? String(matchedPartner.id) : normalizeCategoryId(formData.partnerId);
          await sql`
            UPDATE debts SET
              date = ${date},
              name = ${finalPartnerName},
              partner_id = COALESCE(${finalPartnerId}, partner_id),
              type = ${loai},
              content = ${content},
              amount = ${amount},
              remaining_debt = ${remainingDebt},
              wallet_id = ${walletId},
              wallet_name = ${walletId || ''},
              status = ${status},
              note = ${note}
            WHERE id = ${existingId}
          `;
          savedId = existingId;
          if (walletId || walletName) {
            const isCreditDebt = resolvedDebtW ? String(resolvedDebtW.type).toUpperCase() === 'CREDIT' : false;
            const debtStmtDate = isCreditDebt ? (getCardDefaultPaymentStatementMonth(date, resolvedDebtW.closing_date) + '-01') : '';
            await upsertWalletLedgerEntry(sql, {
              date,
              statementDate: debtStmtDate,
              walletId,
              walletName,
              eventType: loai === 'THU' ? 'LEND_MONEY' : 'BORROW_MONEY',
              effectType: isCreditDebt ? 'CARD_DEBT' : 'CASH',
              amount,
              balanceAfter: resolvedDebtW ? Number(resolvedDebtW.current_balance || 0) : 0,
              note: `${loai === 'THU' ? '[Cho vay]' : '[Đi vay]'} ${finalPartnerName}${content ? ' (' + content + ')' : ''}`,
              orderId: existingId,
              status: 'POSTED',
              direction: loai === 'THU' ? (isCreditDebt ? 'INCREASE' : 'OUT') : (isCreditDebt ? 'DECREASE' : 'IN'),
              sourceModule: 'Debt'
            });
          }
        } else {
          const names = tenRaw.split(/[,;\n]+/).map(n => n.trim()).filter(n => n.length > 0);
          const createdDebtItems = [];
          for (let i = 0; i < names.length; i++) {
            const rawPName = names[i];
            let matchedP = resolveCategoryByIdOrName(debtCatRows, ['PARTNER', 'FAMILY'], { name: rawPName });
            if (!matchedP && rawPName) {
              matchedP = await ensureCategoryExistsByName(sql, debtCatRows, 'PARTNER', rawPName);
            }
            const pName = matchedP ? matchedP.name : rawPName;
            const pId = matchedP ? String(matchedP.id) : null;
            const newId = 'CN' + Date.now().toString().slice(-6) + String(i).padStart(2, '0') + Math.floor(10 + Math.random() * 90);
            savedId = newId;
            await sql`
              INSERT INTO debts (id, date, name, partner_id, type, content, amount, remaining_debt, wallet_id, wallet_name, status, note)
              VALUES (${newId}, ${date}, ${pId || pName}, ${pId}, ${loai}, ${content}, ${amount}, ${amount}, ${walletId}, ${walletId || ''}, 'DANG_NO', ${note})
            `;
            createdDebtItems.push({ newId, pName });
          }

          let debtBalAfter = resolvedDebtW ? Number(resolvedDebtW.current_balance || 0) : 0;
          if (resolvedDebtW && amount > 0) {
            const curBal = Number(resolvedDebtW.current_balance || 0);
            const delta = (loai === 'THU') ? -(amount * names.length) : (amount * names.length);
            debtBalAfter = curBal + delta;
            await sql`UPDATE wallets SET current_balance = ${debtBalAfter} WHERE id = ${resolvedDebtW.id}`;
            updatedWallets.push({ id: resolvedDebtW.id, name: resolvedDebtW.name, current_balance: debtBalAfter, balance: debtBalAfter });
          }

          if (resolvedDebtW && amount > 0) {
            const isCreditDebt = String(resolvedDebtW.type).toUpperCase() === 'CREDIT';
            const debtStmtDate = isCreditDebt ? (getCardDefaultPaymentStatementMonth(date, resolvedDebtW.closing_date) + '-01') : '';
            for (const di of createdDebtItems) {
              await upsertWalletLedgerEntry(sql, {
                date,
                statementDate: debtStmtDate,
                walletId,
                walletName,
                eventType: loai === 'THU' ? 'LEND_MONEY' : 'BORROW_MONEY',
                effectType: isCreditDebt ? 'CARD_DEBT' : 'CASH',
                amount,
                balanceAfter: debtBalAfter,
                note: `${loai === 'THU' ? '[Cho vay]' : '[Đi vay]'} ${di.pName}${content ? ' (' + content + ')' : ''}`,
                orderId: di.newId,
                status: 'POSTED',
                direction: loai === 'THU' ? (isCreditDebt ? 'INCREASE' : 'OUT') : (isCreditDebt ? 'DECREASE' : 'IN'),
                sourceModule: 'Debt'
              });
            }
          }
        }

        if (formData.is_recurring) {
          const recDay = Number(formData.recurring_day || formData.day_of_month || (date ? parseInt(date.slice(8, 10), 10) : 1)) || 1;
          const savedRec = await saveRecurringDebtHelper(sql, {
            name: tenRaw,
            partner_id: formData.partnerId,
            type: loai,
            amount: 0,
            day_of_month: recDay,
            content: content,
            wallet_id: walletId,
            wallet_name: walletName,
            is_active: true,
            note: note
          }).catch(() => null);
          if (savedRec && savedRec.item && savedRec.item.id && savedId) {
            const recPeriod = String(date || '').slice(0, 7);
            await sql`
              UPDATE debts
              SET recurring_id = ${savedRec.item.id}, recurring_period = ${recPeriod}
              WHERE id = ${savedId}
            `.catch(() => {});
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Đã lưu khoản công nợ thành công!',
          savedItem: { id: savedId, ngay: date, ten: tenRaw, loai: loai, sotien: amount, duNo: amount },
          updatedWallets: updatedWallets
        });
      }

      // 18. THANH TOÁN / THU HỒI CÔNG NỢ (Tab 4)
      case 'settleDebtPayment':
      case 'settleSelectedNetDebtPayment': {
        const payload = args[0] || {};
        const rawIds = payload.ids || payload.id || payload.debtId || [];
        const ids = (Array.isArray(rawIds) ? rawIds : [rawIds]).map(x => String(x || '').trim()).filter(Boolean);
        const payAmountTotal = Number(payload.amount || payload.soTien || payload.amountPaid || 0);
        const rawWalletId = String(payload.sourceWalletId || payload.walletId || payload.wallet_id || '').trim();
        const walletName = String(payload.sourceWallet || payload.settleWallet || payload.wallet_name || payload.nguon || '').trim();
        const dateToPay = String(payload.date || payload.settleDate || new Date().toISOString().slice(0, 10));
        const requestedType = String(payload.type || '').toUpperCase();

        if (ids.length === 0 || payAmountTotal <= 0) {
          return res.status(200).json({ success: false, message: 'Vui lòng chọn khoản nợ và nhập số tiền thanh toán (> 0)!' });
        }

        const debts = await sql`
          SELECT id, name, type, amount, remaining_debt, wallet_name, status, note
          FROM debts
          WHERE id = ANY(${ids})
        `;

        if (debts.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy bản ghi công nợ tương ứng!' });
        }

        let remainingPay = payAmountTotal;
        const targetType = (requestedType === 'TRA' || requestedType === 'VAY') ? 'TRA' : 'THU';

        for (const d of debts) {
          const curRemaining = Number(d.remaining_debt || 0);
          if (curRemaining <= 0) continue;

          const payThis = Math.min(remainingPay, curRemaining);
          const newRemaining = Math.max(0, curRemaining - payThis);
          const newStatus = newRemaining <= 0 ? 'DA_TRA' : 'DANG_NO';
          const newNote = d.note ? (d.note + '; TT ngày ' + dateToPay) : ('TT ngày ' + dateToPay);

          await sql`
            UPDATE debts 
            SET remaining_debt = ${newRemaining}, status = ${newStatus}, note = ${newNote}
            WHERE id = ${d.id}
          `;

          remainingPay -= payThis;
          if (remainingPay <= 0) break;
        }

        const updatedWallets = [];
        if ((rawWalletId || walletName) && payAmountTotal > 0) {
          const w = await findWalletByOrderName(sql, { walletId: rawWalletId, walletName });
          if (w) {
            const curBal = Number(w.current_balance || 0);
            const isThu = (targetType === 'THU');
            const isCreditSettle = String(w.type || '').toUpperCase() === 'CREDIT';
            const newBal = isThu ? (curBal + payAmountTotal) : (curBal - payAmountTotal);
            await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${w.id}`;
            updatedWallets.push({ id: w.id, name: w.name, current_balance: newBal, balance: newBal });
            const debtNames = Array.from(new Set(debts.map(d => String(d.name || '').trim()).filter(Boolean))).join(', ');
            await upsertWalletLedgerEntry(sql, {
              date: dateToPay,
              walletId: String(w.id),
              walletName: String(w.name),
              eventType: isThu ? 'COLLECT_LOAN' : 'REPAY_LOAN',
              effectType: isCreditSettle ? 'CARD_DEBT' : 'CASH',
              amount: payAmountTotal,
              balanceAfter: newBal,
              note: `${isThu ? '[Thu nợ]' : '[Trả nợ]'} ${debtNames || ids.join(', ')}`.trim(),
              orderId: ids.join(', '),
              status: 'POSTED',
              direction: isThu ? (isCreditSettle ? 'DECREASE' : 'IN') : (isCreditSettle ? 'INCREASE' : 'OUT'),
              sourceModule: 'Debt'
            });
          }
        }

        return res.status(200).json({
          success: true,
          message: 'Đã gạch nợ thành công!',
          updatedWallets: updatedWallets
        });
      }

      // 18B. KHÓA CÔNG NỢ HÀNG LOẠT (Tab 4)
      case 'lockDebtsBatch': {
        const idsOrPayload = args[0] || [];
        const rawIds = Array.isArray(idsOrPayload) ? idsOrPayload : ((idsOrPayload && idsOrPayload.ids) ? idsOrPayload.ids : [idsOrPayload]);
        for (const rawId of rawIds) {
          const id = String(rawId || '').trim();
          if (!id) continue;
          await sql`UPDATE debts SET status = 'LOCKED' WHERE id = ${id}`;
        }
        return res.status(200).json({ success: true, message: 'Đã chốt & khóa bản ghi công nợ thành công!' });
      }

      // 19. XÓA CÔNG NỢ (Tab 4)
      case 'deleteDebtRecord':
      case 'deleteDebt': {
        const raw = args[0] || (req.body && (req.body.id || req.body.rowId || req.body.row));
        const id = String((typeof raw === 'object' && raw !== null) ? (raw.id || raw.rowId || raw.row || '') : (raw || '')).trim();
        if (id) {
          await sql`DELETE FROM debts WHERE id = ${id}`;
          await sql`UPDATE wallet_ledger SET status = 'DELETED' WHERE order_id = ${id} OR id = ${id}`.catch(() => {});
        }
        return res.status(200).json({ success: true, message: 'Đã xóa công nợ khỏi database Vercel!' });
      }

      // 19A. CÔNG NỢ ĐỊNH KỲ (Tab 4)
      case 'getRecurringDebts': {
        const [monthArg, yearArg] = args;
        const resData = await getRecurringDebtsHelper(sql, monthArg, yearArg);
        return res.status(200).json(resData);
      }

      case 'saveRecurringDebt': {
        const payload = args[0] || (req.body && (req.body.payload || req.body)) || {};
        const resData = await saveRecurringDebtHelper(sql, payload);
        return res.status(200).json(resData);
      }

      case 'deleteRecurringDebt': {
        const raw = args[0] || (req.body && (req.body.id || req.body.recurring_id));
        const id = String((typeof raw === 'object' && raw !== null) ? (raw.id || raw.recurring_id || '') : (raw || '')).trim();
        const resData = await deleteRecurringDebtHelper(sql, id);
        return res.status(200).json(resData);
      }

      case 'toggleRecurringDebt': {
        const [id, isActive] = args;
        const resData = await toggleRecurringDebtHelper(sql, id, isActive);
        return res.status(200).json(resData);
      }

      case 'generateRecurringDebt': {
        const payload = args[0] || (req.body && (req.body.payload || req.body)) || {};
        const resData = await generateRecurringDebtHelper(sql, payload);
        return res.status(200).json(resData);
      }

      case 'generateAllRecurringDebts': {
        const [monthArg, yearArg] = args;
        const resData = await generateAllRecurringDebtsHelper(sql, monthArg, yearArg);
        return res.status(200).json(resData);
      }

      case 'saveBatchQuickRecurringDebts': {
        const [itemsArg, monthArg, yearArg, autoSettleArg] = args;
        const resData = await saveBatchQuickRecurringDebtsHelper(sql, itemsArg, monthArg, yearArg, autoSettleArg);
        return res.status(200).json(resData);
      }

      case 'seedDefaultRecurringDebts': {
        const resData = await seedDefaultRecurringDebtsHelper(sql);
        return res.status(200).json(resData);
      }

      // 18D. MỤC TIÊU QUỸ & GÓP TRẢ NỢ ĐA HŨ (Tab 2 Subtab Quỹ · Trả nợ - CHỈ KIAN)
      case 'getKianGoalsData': {
        if (!isKian) {
          return res.status(200).json({
            success: false,
            isKian: false,
            message: 'Tính năng Quỹ & Góp trả nợ chỉ áp dụng cho tài khoản Kian!'
          });
        }
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const mArg = payload.month ?? (typeof args?.[0] !== 'object' ? args?.[0] : undefined);
        const yArg = payload.year ?? args?.[1];
        const fresh = await fetchFreshKianGoalsResponse(sql, mArg, yArg, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          ...fresh
        });
      }

      case 'saveKianGoal': {
        if (!isKian) {
          return res.status(200).json({ success: false, isKian: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian!' });
        }
        await ensureKianGoalsTables(sql, targetDbKey);
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const name = String(payload.name || '').trim();
        if (!name) {
          return res.status(200).json({ success: false, message: 'Vui lòng nhập tên Quỹ hoặc Khoản trả nợ!' });
        }
        const kind = String(payload.kind || 'fund').toLowerCase() === 'debt' ? 'debt' : 'fund';
        const icon = String(payload.icon || (kind === 'debt' ? '💳' : '🐷')).trim() || (kind === 'debt' ? '💳' : '🐷');
        const subtitle = String(payload.subtitle || '').trim();
        const startDate = String(payload.startDate || '').trim();
        const endDate = String(payload.endDate || '').trim();
        const linkedJars = Array.isArray(payload.linkedJars)
          ? payload.linkedJars.map(x => String(x || '').trim()).filter(Boolean)
          : [];
        const dbDebtIds = kind === 'debt' && Array.isArray(payload.dbDebtIds)
          ? payload.dbDebtIds.map(x => String(x || '').trim()).filter(Boolean)
          : [];
        const repeatable = kind === 'fund' && Boolean(payload.repeatable);
        const initialYen = Math.max(0, Math.round(Number(payload.initialYen || 0)));
        const autoTplKeywords = Array.isArray(payload.autoTplKeywords)
          ? payload.autoTplKeywords.map(x => String(x || '').trim().toLowerCase()).filter(Boolean)
          : [];
        const autoStartYm = String(payload.autoStartYm || '').trim().slice(0, 7);

        let targetYen = Math.max(0, Math.round(Number(payload.targetYen || 0)));
        if (kind === 'debt' && dbDebtIds.length > 0 && (targetYen <= 0 || payload.syncTargetFromDb)) {
          const pickedDebts = await sql`SELECT id, remaining_debt FROM debts WHERE id = ANY(${dbDebtIds})`.catch(() => []);
          const sumDbRem = (pickedDebts || []).reduce((s, r) => s + Math.max(0, Math.round(Number(r.remaining_debt || 0))), 0);
          if (sumDbRem > 0) targetYen = sumDbRem;
        }
        if (targetYen <= 0) {
          return res.status(200).json({ success: false, message: 'Số tiền mục tiêu phải lớn hơn 0!' });
        }

        const existingId = String(payload.id || '').trim();
        const linkedJarsJson = JSON.stringify(linkedJars);
        const dbDebtIdsJson = JSON.stringify(dbDebtIds);
        const autoTplKeywordsJson = JSON.stringify(autoTplKeywords);
        const isLocked = Boolean(payload.isLocked ?? payload.is_locked);
        let savedId = existingId;

        if (existingId) {
          const updated = await sql`
            UPDATE kian_goals
            SET kind = ${kind},
                icon = ${icon},
                name = ${name},
                subtitle = ${subtitle},
                target_yen = ${targetYen},
                initial_yen = ${initialYen},
                auto_tpl_keywords = ${autoTplKeywordsJson}::jsonb,
                auto_start_ym = ${autoStartYm},
                start_date = ${startDate},
                end_date = ${endDate},
                linked_jars = ${linkedJarsJson}::jsonb,
                db_debt_ids = ${dbDebtIdsJson}::jsonb,
                repeatable = ${repeatable},
                is_locked = ${isLocked},
                updated_at = NOW()
            WHERE id = ${existingId}
            RETURNING id
          `;
          if (!updated || updated.length === 0) {
            return res.status(200).json({ success: false, message: 'Không tìm thấy mục tiêu để cập nhật!' });
          }
        } else {
          savedId = (kind === 'debt' ? 'KG_DEBT_' : 'KG_FUND_') + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          const maxRows = await sql`SELECT COALESCE(MAX(sort_order), 0)::int AS max_ord FROM kian_goals`.catch(() => []);
          const nextOrd = Number(maxRows?.[0]?.max_ord || 0) + 1;
          await sql`
            INSERT INTO kian_goals (
              id, kind, icon, name, target_yen, initial_yen, auto_tpl_keywords, auto_start_ym, start_date, end_date,
              linked_jars, db_debt_ids, repeatable, is_locked, completed_cycles, subtitle, sort_order, created_at, updated_at
            )
            VALUES (
              ${savedId}, ${kind}, ${icon}, ${name}, ${targetYen}, ${initialYen}, ${autoTplKeywordsJson}::jsonb, ${autoStartYm}, ${startDate}, ${endDate},
              ${linkedJarsJson}::jsonb, ${dbDebtIdsJson}::jsonb, ${repeatable}, ${isLocked}, 0, ${subtitle}, ${nextOrd}, NOW(), NOW()
            )
          `;
        }

        const fresh = await fetchFreshKianGoalsResponse(sql, payload.month, payload.year, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          goalId: savedId,
          message: existingId ? '✅ Đã cập nhật mục tiêu!' : '✅ Đã tạo mục tiêu mới!',
          ...fresh
        });
      }

      case 'deleteKianGoal': {
        if (!isKian) {
          return res.status(200).json({ success: false, isKian: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian!' });
        }
        await ensureKianGoalsTables(sql, targetDbKey);
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const goalId = String(payload.id || payload.goalId || (typeof args?.[0] === 'string' ? args[0] : '')).trim();
        if (!goalId) {
          return res.status(200).json({ success: false, message: 'Thiếu ID mục tiêu cần xóa!' });
        }
        const entries = await sql`SELECT * FROM kian_goal_entries WHERE goal_id = ${goalId} ORDER BY created_at DESC`.catch(() => []);
        for (const eRow of entries) {
          await reverseKianGoalEntryDbEffects(sql, eRow);
        }
        await sql`DELETE FROM kian_goal_entries WHERE goal_id = ${goalId}`;
        await sql`DELETE FROM kian_goals WHERE id = ${goalId}`;
        const fresh = await fetchFreshKianGoalsResponse(sql, payload.month, payload.year, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          message: '✅ Đã xóa mục tiêu!',
          ...fresh
        });
      }

      case 'addKianGoalEntry': {
        if (!isKian) {
          return res.status(200).json({ success: false, isKian: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian!' });
        }
        await ensureKianGoalsTables(sql, targetDbKey);
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const goalId = String(payload.goalId || '').trim();
        const rawAmt = Math.max(0, Math.round(Number(payload.amount || 0)));
        if (!goalId || rawAmt <= 0) {
          return res.status(200).json({ success: false, message: 'Vui lòng chọn mục tiêu và nhập số tiền > 0!' });
        }
        const gRows = await sql`SELECT * FROM kian_goals WHERE id = ${goalId} LIMIT 1`;
        if (!gRows || gRows.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy mục tiêu!' });
        }
        const goal = gRows[0];
        const kind = String(goal.kind || 'fund').toLowerCase() === 'debt' ? 'debt' : 'fund';
        const curCycle = Math.max(0, Math.round(Number(goal.completed_cycles || 0)));
        const entryMode = kind === 'debt'
          ? (String(payload.mode || 'piggy').toLowerCase() === 'direct' ? 'direct' : 'piggy')
          : 'direct';
        const entryDate = String(payload.date || '').trim() || new Date().toISOString().slice(0, 10);
        const note = String(payload.note || '').trim();
        const sourceJarIdRaw = String(payload.sourceJarId || 'EXTERNAL').trim() || 'EXTERNAL';
        const sourceJarNameRaw = String(payload.sourceJarName || '').trim();
        const deductFromJar = Boolean(payload.deductFromJar) && sourceJarIdRaw !== 'EXTERNAL';
        const entryId = 'KGE_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

        let effectiveAmt = rawAmt;
        let dbAllocations = [];
        let settledWalletId = null;
        let settledWalletName = null;

        if (kind === 'debt' && entryMode === 'direct') {
          const dbDebtIds = parseKianJsonArrayHelper(goal.db_debt_ids).map(x => String(x || '').trim()).filter(Boolean);
          const wId = String(payload.walletId || '').trim();
          const wName = String(payload.walletName || '').trim();
          const settleRes = await applyKianDebtDbSettlement(sql, {
            goalName: goal.name,
            dbDebtIds,
            amount: rawAmt,
            walletId: wId,
            walletName: wName,
            dateStr: entryDate,
            orderId: entryId
          });
          if (settleRes.error) {
            return res.status(200).json({ success: false, message: settleRes.error });
          }
          effectiveAmt = settleRes.totalAllocated;
          dbAllocations = settleRes.allocations;
          if (settleRes.wallet) {
            settledWalletId = settleRes.wallet.id;
            settledWalletName = settleRes.wallet.name;
          } else {
            settledWalletId = wId || null;
            settledWalletName = wName || null;
          }
        }

        let resolvedJarId = sourceJarIdRaw;
        let resolvedJarName = sourceJarNameRaw || (sourceJarIdRaw === 'EXTERNAL' ? 'Thu nhập / Tiền ngoài' : sourceJarIdRaw);
        let familyTxId = null;

        if (deductFromJar) {
          const catRows = await sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => []);
          const huCat = resolveHuCategory(catRows, { huId: sourceJarIdRaw, huName: sourceJarNameRaw });
          resolvedJarId = huCat ? String(huCat.id) : (normalizeCategoryId(sourceJarIdRaw) || sourceJarIdRaw);
          resolvedJarName = huCat ? String(huCat.name) : resolvedJarName;
          familyTxId = 'JTF_GOAL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
          const txContent = `${kind === 'debt' ? 'Góp trả nợ -> ' : 'Góp quỹ -> '}${goal.name}`;
          await sql`
            INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status)
            VALUES (${familyTxId}, ${entryDate}, 'Chi', ${resolvedJarId}, ${resolvedJarName}, ${txContent}, ${effectiveAmt}, NULL, 'Hũ -> Mục tiêu', false, ${note || 'Góp mục tiêu'}, 'HOAN_TAT')
          `;
        }

        await sql`
          INSERT INTO kian_goal_entries (
            id, goal_id, entry_date, amount, source_jar_id, source_jar_name,
            deduct_from_jar, family_tx_id, mode, wallet_id, wallet_name, db_allocations, cycle_num, note, created_at
          )
          VALUES (
            ${entryId}, ${goalId}, ${entryDate}, ${effectiveAmt}, ${resolvedJarId}, ${resolvedJarName},
            ${deductFromJar}, ${familyTxId}, ${entryMode}, ${settledWalletId}, ${settledWalletName},
            ${JSON.stringify(dbAllocations)}::jsonb, ${curCycle}, ${note}, NOW()
          )
        `;

        const fresh = await fetchFreshKianGoalsResponse(sql, payload.month, payload.year, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          entryId,
          message: (kind === 'debt' && entryMode === 'direct')
            ? `✅ Đã trả nợ DB ${effectiveAmt.toLocaleString('ja-JP')} ¥!`
            : `✅ Đã góp ${effectiveAmt.toLocaleString('ja-JP')} ¥!`,
          ...fresh
        });
      }

      case 'addKianGoalBatchEntries': {
        if (!isKian) {
          return res.status(200).json({ success: false, isKian: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian!' });
        }
        await ensureKianGoalsTables(sql, targetDbKey);
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const items = Array.isArray(payload.items) ? payload.items : [];
        const validItems = items
          .map(it => ({ goalId: String(it?.goalId || '').trim(), amount: Math.max(0, Math.round(Number(it?.amount || 0))) }))
          .filter(it => it.goalId && it.amount > 0);
        if (validItems.length === 0) {
          return res.status(200).json({ success: false, message: 'Vui lòng nhập ít nhất 1 mục tiêu với số tiền > 0!' });
        }

        const sourceJarIdRaw = String(payload.sourceJarId || '').trim();
        const sourceJarNameRaw = String(payload.sourceJarName || '').trim();
        if (!sourceJarIdRaw && !sourceJarNameRaw) {
          return res.status(200).json({ success: false, message: 'Thiếu thông tin Hũ nguồn!' });
        }
        const deductFromJar = payload.deductFromJar !== false;
        const entryDate = String(payload.date || '').trim() || new Date().toISOString().slice(0, 10);
        const note = String(payload.note || '').trim();

        const catRows = await sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => []);
        const huCat = resolveHuCategory(catRows, { huId: sourceJarIdRaw, huName: sourceJarNameRaw });
        const resolvedJarId = huCat ? String(huCat.id) : (normalizeCategoryId(sourceJarIdRaw) || sourceJarIdRaw || sourceJarNameRaw);
        const resolvedJarName = huCat ? String(huCat.name) : (sourceJarNameRaw || resolvedJarId);

        const gIds = validItems.map(i => i.goalId);
        const goalRows = await sql`SELECT * FROM kian_goals WHERE id = ANY(${gIds})`;
        const goalById = new Map((goalRows || []).map(g => [String(g.id), g]));

        let countInserted = 0;
        let totalSum = 0;
        for (const it of validItems) {
          const goal = goalById.get(it.goalId);
          if (!goal) continue;
          const kind = String(goal.kind || 'fund').toLowerCase() === 'debt' ? 'debt' : 'fund';
          const curCycle = Math.max(0, Math.round(Number(goal.completed_cycles || 0)));
          const entryMode = kind === 'debt' ? 'piggy' : 'direct';
          const entryId = 'KGE_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + countInserted;
          let familyTxId = null;

          if (deductFromJar) {
            familyTxId = 'JTF_GOAL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5) + '_' + countInserted;
            const txContent = `${kind === 'debt' ? 'Góp trả nợ -> ' : 'Góp quỹ -> '}${goal.name}`;
            await sql`
              INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status)
              VALUES (${familyTxId}, ${entryDate}, 'Chi', ${resolvedJarId}, ${resolvedJarName}, ${txContent}, ${it.amount}, NULL, 'Hũ -> Mục tiêu', false, ${note || 'Góp từ Hũ'}, 'HOAN_TAT')
            `;
          }

          await sql`
            INSERT INTO kian_goal_entries (
              id, goal_id, entry_date, amount, source_jar_id, source_jar_name,
              deduct_from_jar, family_tx_id, mode, wallet_id, wallet_name, db_allocations, cycle_num, note, created_at
            )
            VALUES (
              ${entryId}, ${it.goalId}, ${entryDate}, ${it.amount}, ${resolvedJarId}, ${resolvedJarName},
              ${deductFromJar}, ${familyTxId}, ${entryMode}, NULL, NULL, '[]'::jsonb, ${curCycle}, ${note}, NOW()
            )
          `;
          countInserted += 1;
          totalSum += it.amount;
        }

        if (countInserted === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy mục tiêu hợp lệ để góp!' });
        }

        const fresh = await fetchFreshKianGoalsResponse(sql, payload.month, payload.year, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          message: `✅ Đã phân bổ ${totalSum.toLocaleString('ja-JP')} ¥ từ ${resolvedJarName} vào ${countInserted} mục tiêu!`,
          ...fresh
        });
      }

      case 'settleKianDebtPiggy': {
        if (!isKian) {
          return res.status(200).json({ success: false, isKian: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian!' });
        }
        await ensureKianGoalsTables(sql, targetDbKey);
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const goalId = String(payload.goalId || '').trim();
        if (!goalId) {
          return res.status(200).json({ success: false, message: 'Thiếu ID khoản trả nợ!' });
        }
        const [gRows, eRows] = await Promise.all([
          sql`SELECT * FROM kian_goals WHERE id = ${goalId} LIMIT 1`,
          sql`SELECT * FROM kian_goal_entries WHERE goal_id = ${goalId}`
        ]);
        if (!gRows || gRows.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy khoản trả nợ!' });
        }
        const goal = gRows[0];
        if (String(goal.kind || '').toLowerCase() !== 'debt') {
          return res.status(200).json({ success: false, message: 'Chốt trả DB chỉ áp dụng cho mục tiêu Góp trả nợ!' });
        }
        const statsObj = computeKianGoalStatsHelper(goal, eRows || [], new Map(), getCurrentYmJstHelper());
        const curPiggy = Math.max(0, Math.round(Number(statsObj?.stats?.piggyBalance || 0)));
        if (curPiggy <= 0) {
          return res.status(200).json({ success: false, message: 'Số dư Ống heo đang bằng ¥0!' });
        }
        const reqAmt = Math.min(curPiggy, Math.max(0, Math.round(Number(payload.amount || curPiggy))));
        if (reqAmt <= 0) {
          return res.status(200).json({ success: false, message: 'Số tiền chốt trả phải > 0!' });
        }

        const dbDebtIds = parseKianJsonArrayHelper(goal.db_debt_ids).map(x => String(x || '').trim()).filter(Boolean);
        const entryDate = String(payload.date || '').trim() || new Date().toISOString().slice(0, 10);
        const entryId = 'KGE_SETL_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const wId = String(payload.walletId || '').trim();
        const wName = String(payload.walletName || '').trim();
        const note = String(payload.note || '').trim() || 'Chốt trả từ Ống heo vào công nợ DB';

        const settleRes = await applyKianDebtDbSettlement(sql, {
          goalName: goal.name,
          dbDebtIds,
          amount: reqAmt,
          walletId: wId,
          walletName: wName,
          dateStr: entryDate,
          orderId: entryId
        });
        if (settleRes.error) {
          return res.status(200).json({ success: false, message: settleRes.error });
        }

        const curCycle = Math.max(0, Math.round(Number(goal.completed_cycles || 0)));
        await sql`
          INSERT INTO kian_goal_entries (
            id, goal_id, entry_date, amount, source_jar_id, source_jar_name,
            deduct_from_jar, family_tx_id, mode, wallet_id, wallet_name, db_allocations, cycle_num, note, created_at
          )
          VALUES (
            ${entryId}, ${goalId}, ${entryDate}, ${settleRes.totalAllocated}, 'PIGGY', '🐷 Ống heo',
            false, NULL, 'settle', ${settleRes.wallet?.id || wId || null}, ${settleRes.wallet?.name || wName || null},
            ${JSON.stringify(settleRes.allocations)}::jsonb, ${curCycle}, ${note}, NOW()
          )
        `;

        const fresh = await fetchFreshKianGoalsResponse(sql, payload.month, payload.year, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          entryId,
          settledAmount: settleRes.totalAllocated,
          message: `✅ Đã chốt trả ${settleRes.totalAllocated.toLocaleString('ja-JP')} ¥ và trừ công nợ DB!`,
          ...fresh
        });
      }

      case 'deleteKianGoalEntry': {
        if (!isKian) {
          return res.status(200).json({ success: false, isKian: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian!' });
        }
        await ensureKianGoalsTables(sql, targetDbKey);
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const entryId = String(payload.entryId || payload.id || (typeof args?.[0] === 'string' ? args[0] : '')).trim();
        if (!entryId) {
          return res.status(200).json({ success: false, message: 'Thiếu ID bút toán cần xóa!' });
        }
        const rows = await sql`SELECT * FROM kian_goal_entries WHERE id = ${entryId} LIMIT 1`;
        if (!rows || rows.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy bút toán!' });
        }
        const eRow = rows[0];
        if (String(eRow.mode || '').toLowerCase() === 'piggy') {
          const [gRows, siblingRows] = await Promise.all([
            sql`SELECT * FROM kian_goals WHERE id = ${eRow.goal_id} LIMIT 1`,
            sql`SELECT * FROM kian_goal_entries WHERE goal_id = ${eRow.goal_id}`
          ]);
          if (gRows && gRows[0]) {
            const st = computeKianGoalStatsHelper(gRows[0], siblingRows || [], new Map(), getCurrentYmJstHelper());
            const curPiggy = Math.max(0, Math.round(Number(st?.stats?.piggyBalance || 0)));
            if (curPiggy < Number(eRow.amount || 0)) {
              return res.status(200).json({
                success: false,
                message: 'Khoản này đã chốt trả vào nợ DB. Hãy hoàn tác phiếu Chốt trả DB trước!'
              });
            }
          }
        }

        await reverseKianGoalEntryDbEffects(sql, eRow);
        await sql`DELETE FROM kian_goal_entries WHERE id = ${entryId}`;

        const fresh = await fetchFreshKianGoalsResponse(sql, payload.month, payload.year, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          message: '✅ Đã xóa & hoàn tác bút toán!',
          ...fresh
        });
      }

      case 'completeKianGoalCycle': {
        if (!isKian) {
          return res.status(200).json({ success: false, isKian: false, message: 'Tính năng chỉ áp dụng cho tài khoản Kian!' });
        }
        await ensureKianGoalsTables(sql, targetDbKey);
        const payload = (args && args[0] && typeof args[0] === 'object') ? args[0] : {};
        const goalId = String(payload.goalId || payload.id || (typeof args?.[0] === 'string' ? args[0] : '')).trim();
        if (!goalId) {
          return res.status(200).json({ success: false, message: 'Thiếu ID quỹ!' });
        }
        const rows = await sql`SELECT * FROM kian_goals WHERE id = ${goalId} LIMIT 1`;
        if (!rows || rows.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy quỹ!' });
        }
        if (String(rows[0].kind || '').toLowerCase() !== 'fund' || !rows[0].repeatable) {
          return res.status(200).json({ success: false, message: 'Chỉ quỹ có đánh dấu Quỹ lặp chu kỳ mới mở vòng mới được!' });
        }
        await sql`
          UPDATE kian_goals
          SET completed_cycles = COALESCE(completed_cycles, 0) + 1, updated_at = NOW()
          WHERE id = ${goalId}
        `;
        const fresh = await fetchFreshKianGoalsResponse(sql, payload.month, payload.year, targetDbKey);
        return res.status(200).json({
          success: true,
          isKian: true,
          message: '🎉 Đã chốt chu kỳ và mở vòng mới về ¥0!',
          ...fresh
        });
      }

      // 19B. ĐỐI SOÁT & GIAO DỊCH TẠM
      case 'resolveTempTransaction': {
        const payload = args[0] || {};
        const tempId = String(payload.tempId || payload.id || '').trim();
        const act = String(payload.action || 'IGNORE').toUpperCase();
        const targetMod = String(payload.targetModule || '').trim();
        const targetId = String(payload.targetId || '').trim();

        let tempRow = null;
        if (tempId) {
          try {
            const rows = await sql`SELECT * FROM temp_transactions WHERE id = ${tempId} LIMIT 1`;
            if (rows.length > 0) tempRow = rows[0];
          } catch (e) {}
        }

        const wRef = {
          walletId: payload.walletId || payload.wallet_id || (tempRow && tempRow.wallet_id) || '',
          walletName: payload.walletName || (tempRow && tempRow.wallet_name) || ''
        };
        const w = (wRef.walletId || wRef.walletName) ? await findWalletByOrderName(sql, wRef) : null;

        const nextStatus = act === 'IGNORE' ? 'IGNORED' : 'PROCESSED';
        if (tempId && tempRow) {
          await sql`
            UPDATE temp_transactions
            SET status = ${nextStatus},
                target_module = CASE WHEN ${targetMod !== ''} THEN ${targetMod} ELSE target_module END,
                target_id = CASE WHEN ${targetId !== ''} THEN ${targetId} ELSE target_id END
            WHERE id = ${tempId}
          `.catch(() => {});
        }

        const itemDate = payload.date || (tempRow && tempRow.date) || '';
        const itemYmd = normalizeDateToYMD(payload.ymd || (tempRow && tempRow.ymd) || itemDate);
        const itemAmt = Math.round(Math.abs(Number(payload.amount ?? (tempRow && tempRow.amount) ?? 0)));
        const itemType = (payload.type || (tempRow && tempRow.type)) === '+' ? '+' : '-';
        const itemNote = String(payload.note || (tempRow && tempRow.note) || '').trim();
        const itemSig = String(payload.bankSignature || payload.sig || (tempRow && tempRow.sig) || (itemYmd ? `${itemYmd}|${itemAmt}|${itemType}|${itemNote.slice(0, 60)}` : '')).trim();

        if (w || wRef.walletName) {
          await recordReconciledRowsHelper(sql, w, wRef.walletName, [{
            matchType: act === 'IGNORE' ? 'MANUAL_SKIP' : 'CREATE_FROM_TEMP',
            status: 'MATCHED',
            bank: { date: itemDate, ymd: itemYmd, amount: itemAmt, type: itemType, note: itemNote, sig: itemSig },
            app: {
              id: act === 'IGNORE' ? 'SKIP_MATCHED' : (targetId || 'CREATE_FROM_TEMP'),
              date: itemDate,
              amount: itemAmt,
              note: act === 'IGNORE' ? '(Khớp đối soát - Bỏ qua)' : (itemNote || targetMod)
            },
            notes: act === 'IGNORE' ? 'Bỏ qua giao dịch sao kê' : `Tạo từ sao kê (${targetMod})`
          }], 'TMP_' + Date.now(), 'User');
        }

        return res.status(200).json({ success: true, tempId, action: act, message: 'Đã xử lý đối soát giao dịch tạm!' });
      }

      // 19B. LẤY DANH SÁCH KHOẢN CỐ ĐỊNH NHANH CHƯA ĐÓNG TRONG THÁNG (Tab 2)
      case 'getQuickFixedItems': {
        const [monthArg, yearArg] = args || [];
        const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
        const isAllMonth = (!monthArg || String(monthArg).toUpperCase() === 'ALL');
        const isAllYear = (!yearArg || String(yearArg).toUpperCase() === 'ALL');
        const targetMonth = isAllMonth ? (jstNow.getUTCMonth() + 1) : (parseInt(monthArg, 10) || (jstNow.getUTCMonth() + 1));
        const targetYear = isAllYear ? jstNow.getUTCFullYear() : (parseInt(yearArg, 10) || jstNow.getUTCFullYear());

        const [familyRows, quickCatRows, quickWallets, skippedRows] = await Promise.all([
          sql`
            SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status
            FROM family_transactions
            ORDER BY date DESC, id DESC
          `,
          sql`SELECT id, type, name FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') ORDER BY id ASC`.catch(() => []),
          sql`SELECT id, name FROM wallets ORDER BY id ASC`.catch(() => []),
          sql`SELECT item_key, display_name FROM quick_fixed_skips WHERE year = ${targetYear} AND month = ${targetMonth}`.catch(() => [])
        ]);

        return res.status(200).json(
          buildQuickFixedItemsData(familyRows, skippedRows, targetYear, targetMonth, quickCatRows, quickWallets)
        );
      }

      // 19C. LƯU CHI PHÍ CỐ ĐỊNH NHANH (Tab 2)
      case 'saveBatchQuickFixedAmounts': {
        const items = Array.isArray(args[0]) ? args[0] : [];
        let savedCount = 0;

        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx] || {};
          const amt = Math.round(Number(item.newAmount ?? item.amount ?? item.sotien ?? 0));
          if (amt <= 0) continue;

          if (!item.noiDung && !item.noidung && item.id) {
            const existingFixId = String(item.id).trim();
            await sql`UPDATE family_transactions SET amount = ${amt} WHERE id = ${existingFixId}`;
            await sql`UPDATE wallet_ledger SET amount = ${amt} WHERE order_id = ${existingFixId} OR id = ${existingFixId}`.catch(() => {});
            savedCount++;
            continue;
          }

          const id = 'FAM_' + Date.now() + '_' + idx;
          const date = normalizeIsoDate(item.newDate || item.date) || new Date().toISOString().slice(0, 10);
          const type = String(item.loai || item.type || 'Chi').trim();
          const isThu = type.toLowerCase() === 'thu';
          const hu = String(item.hu || 'Thiết yếu').trim();
          const content = String(item.noiDung || item.noidung || item.content || 'Khoản cố định').trim();
          const rawWalletId = String(item.walletId || item.wallet_id || '').trim();
          const rawWalletName = String(item.newSource || item.nguonTien || item.nguon || item.wallet_name || '').trim();

          const matchedWallet = (rawWalletId || rawWalletName)
            ? await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName })
            : null;
          const walletId = matchedWallet ? String(matchedWallet.id) : rawWalletId;
          const walletName = matchedWallet ? String(matchedWallet.name) : rawWalletName;
          const isCredit = matchedWallet ? String(matchedWallet.type).toUpperCase() === 'CREDIT' : false;
          const status = (!isThu && isCredit) ? 'PRE-ORDER' : 'HOAN_TAT';

          const fixHuRows = await sql`SELECT id, type, name FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') ORDER BY id ASC`.catch(() => []);
          const matchedFixHu = resolveHuCategory(fixHuRows, { huName: hu }) || (hu ? await ensureCategoryExistsByName(sql, fixHuRows, 'HU', hu) : null);
          const fixHuId = matchedFixHu ? String(matchedFixHu.id) : null;

          await sql`
            INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date)
            VALUES (${id}, ${date}, ${type}, ${fixHuId}, ${fixHuId || hu}, ${content}, ${amt}, ${walletId}, ${walletId || walletName}, true, '', ${status}, ${null})
          `;

          const fixDeltaRes = await applyFamilyWalletDelta(sql, {
            walletRow: matchedWallet,
            walletId,
            walletName,
            amount: amt,
            isThu,
            isPre: status === 'PRE-ORDER',
            sign: 1
          });
          const fixBalAfter = fixDeltaRes.balanceAfter;

          if (walletId || walletName) {
            const isPreFix = status === 'PRE-ORDER';
            await upsertWalletLedgerEntry(sql, {
              date,
              walletId,
              walletName,
              eventType: isThu ? 'FAMILY_INCOME' : 'FAMILY_EXPENSE',
              effectType: isPreFix ? 'PREORDER_HOLD' : (isCredit ? 'CARD_DEBT' : 'CASH'),
              amount: amt,
              balanceAfter: fixBalAfter,
              note: content,
              orderId: id,
              status: isPreFix ? 'PENDING' : 'POSTED',
              direction: isThu ? (isCredit ? 'DECREASE' : 'IN') : (isCredit ? 'INCREASE' : 'OUT'),
              sourceModule: 'Family'
            });
          }

          savedCount++;
        }

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        return res.status(200).json({
          success: true,
          message: savedCount > 0 ? `✅ Đã đóng ${savedCount} khoản cố định thành công!` : 'Không có khoản nào được lưu.',
          savedCount,
          wallets: updatedWallets,
          updatedWallets
        });
      }

      // 19C-1. BỎ QUA KHOẢN CỐ ĐỊNH TRONG KỲ THÁNG NÀY (THÁNG SAU TỰ HIỆN LẠI)
      case 'skipQuickFixedForMonth': {
        const { displayName, itemKey, month, year, hasValidPeriod } = parseQuickFixedActionArgs(args);
        if (!itemKey || !hasValidPeriod) {
          return res.status(200).json({ success: false, message: 'Thiếu tên khoản cố định hoặc kỳ tháng/năm hợp lệ!' });
        }
        await ensureQuickFixedSkipsTable(sql);
        await sql`
          INSERT INTO quick_fixed_skips (item_key, year, month, display_name)
          VALUES (${itemKey}, ${year}, ${month}, ${displayName})
          ON CONFLICT (item_key, year, month) DO UPDATE SET display_name = EXCLUDED.display_name
        `;
        return res.status(200).json({
          success: true,
          itemKey,
          month,
          year,
          message: `Đã bỏ qua "${displayName}" cho tháng ${month}/${year} (tháng sau tự hiện lại)`
        });
      }

      // 19C-2. KHÔI PHỤC LẠI KHOẢN CỐ ĐỊNH ĐÃ BỎ QUA TRONG THÁNG
      case 'unskipQuickFixedForMonth': {
        const { displayName, itemKey, month, year, hasValidPeriod } = parseQuickFixedActionArgs(args);
        if (!itemKey || !hasValidPeriod) {
          return res.status(200).json({ success: false, message: 'Thiếu tên khoản cố định hoặc kỳ tháng/năm hợp lệ!' });
        }
        await ensureQuickFixedSkipsTable(sql);
        await sql`DELETE FROM quick_fixed_skips WHERE item_key = ${itemKey} AND year = ${year} AND month = ${month}`;
        return res.status(200).json({
          success: true,
          itemKey,
          month,
          year,
          message: `Đã hiện lại "${displayName}" cho tháng ${month}/${year}`
        });
      }

      // 19C-3. NGỪNG NHẮC CỐ ĐỊNH VĨNH VIỄN (GIỮ NGUYÊN LỊCH SỬ GIAO DỊCH CŨ)
      case 'disableQuickFixedItem': {
        const { displayName, itemKey } = parseQuickFixedActionArgs(args);
        if (!itemKey) {
          return res.status(200).json({ success: false, message: 'Thiếu tên khoản cố định!' });
        }
        await sql`UPDATE family_transactions SET is_fixed = false WHERE LOWER(TRIM(content)) = ${itemKey} AND is_fixed = true`;
        await sql`DELETE FROM quick_fixed_skips WHERE item_key = ${itemKey}`.catch(() => {});
        return res.status(200).json({
          success: true,
          itemKey,
          message: `Đã tắt nhắc cố định cho "${displayName}" (lịch sử giao dịch cũ vẫn giữ nguyên)`
        });
      }

      // 19D. THIẾT LẬP COOLDOWN & GIỚI HẠN MUA (Tab 5)
      case 'saveStoreCooldownSettings': {
        return res.status(200).json({ success: true, message: 'Đã lưu thiết lập cooldown!' });
      }

      case 'updatePurchaseLimitStatus': {
        const [id, newStatus] = args;
        if (id && newStatus) {
          await sql`UPDATE business_orders SET status = ${String(newStatus).trim()} WHERE id = ${String(id).trim()}`;
        }
        return res.status(200).json({ success: true, message: 'Đã cập nhật trạng thái giới hạn mua!' });
      }

      case 'addTab5Account': {
        const [storeName, accountName] = args;
        const s = String(storeName || '').trim();
        const a = String(accountName || '').trim();
        if (s && a) {
          const fullName = a.startsWith(s) ? a : (s + ' ' + a);
          const newAccId = generateCategoryId('ACCOUNT');
          await sql`INSERT INTO categories (id, type, name, is_hidden) VALUES (${newAccId}, 'ACCOUNT', ${fullName}, false)`;
        }
        return res.status(200).json({ success: true, message: 'Đã thêm tài khoản mua hàng thành công!' });
      }

      // 20. LƯU DANH MỤC THIẾT LẬP BAN ĐẦU (Tab 1)
      case 'saveInitialSetupCategory':
      case 'addCategory': {
        let typeRaw = '';
        let action = 'ADD';
        let valRaw = '';
        let oldValRaw = '';
        let catIdRaw = null;
        let metaObj = {};

        if (typeof args[0] === 'object' && args[0] !== null) {
          typeRaw = String(args[0].type || '').trim().toUpperCase();
          action = String(args[0].action || 'ADD').trim().toUpperCase();
          valRaw = args[0].value ?? args[0].name ?? '';
          oldValRaw = args[0].oldValue ?? args[0].oldName ?? '';
          catIdRaw = args[0].id ?? null;
          metaObj = args[0];
        } else {
          typeRaw = String(args[0] || '').trim().toUpperCase();
          action = String(args[1] || 'ADD').trim().toUpperCase();
          valRaw = args[2] ?? '';
          oldValRaw = args[3] ?? '';
        }

        let catType = typeRaw;
        if (catType === 'FAMILY') catType = 'PARTNER';
        if (catType === 'JAR' || catType === 'HU_CHITIEU') catType = 'HU';

        let name = '';
        if (typeof valRaw === 'object' && valRaw !== null) {
          if (valRaw.id !== undefined && valRaw.id !== null) catIdRaw = valRaw.id;
          if (!oldValRaw && (valRaw.oldName || valRaw.oldValue)) oldValRaw = valRaw.oldName || valRaw.oldValue;
          metaObj = { ...metaObj, ...valRaw };
          if (catType === 'ACCOUNT') {
            const s = String(valRaw.shop || valRaw.store || '').trim();
            const n = String(valRaw.name || valRaw.nick || valRaw.accountName || '').trim();
            name = (s && n) ? (n.startsWith(s) ? n : `${s} ${n}`) : (n || s);
          } else {
            name = String(valRaw.contentTemplate || valRaw.content_template || valRaw.name || valRaw.value || '').trim();
          }
        } else {
          name = String(valRaw || '').trim();
        }
        const oldName = String(oldValRaw || '').trim();
        const catId = normalizeCategoryId(catIdRaw);

        const VALID_SETUP_TYPES = ['PARTNER', 'WAREHOUSE', 'ACCOUNT', 'SHOP', 'SUPPLIER', 'HU', 'TEMPLATE'];
        if ((name || catId) && VALID_SETUP_TYPES.includes(catType)) {
          // Chuẩn bị auto-mapping cho TEMPLATE (Hũ ID & Nguồn/Ví ID)
          let tplContent = '';
          let resolvedAutoHuId = null;
          let resolvedAutoHuName = null;
          let resolvedAutoWalletId = null;
          let resolvedAutoWalletName = null;

          if (catType === 'TEMPLATE') {
            tplContent = String(metaObj.contentTemplate || metaObj.content_template || name || '').trim();
            if (tplContent && !name) name = tplContent;
            const rawHuId = metaObj.autoHuId ?? metaObj.auto_hu_id ?? null;
            const rawHuName = String(metaObj.autoHuName ?? metaObj.auto_hu_name ?? metaObj.jar ?? '').trim();
            const rawWId = String(metaObj.autoWalletId ?? metaObj.auto_wallet_id ?? '').trim();
            const rawWName = String(metaObj.autoWalletName ?? metaObj.auto_wallet_name ?? metaObj.source ?? '').trim();

            if ((rawHuId !== null && String(rawHuId).trim() !== '') || rawHuName) {
              const huRows = await sql`SELECT id, type, name, is_hidden FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') ORDER BY id ASC`.catch(() => []);
              const matchedHu = resolveHuCategory(huRows, { huId: rawHuId, huName: rawHuName })
                || (rawHuName ? await ensureCategoryExistsByName(sql, huRows, 'HU', rawHuName) : null);
              if (matchedHu) {
                resolvedAutoHuId = String(matchedHu.id);
                resolvedAutoHuName = String(matchedHu.name || '').trim();
              } else if (rawHuName) {
                resolvedAutoHuName = rawHuName;
              }
            }
            if (rawWId || rawWName) {
              const matchedW = await findWalletByOrderName(sql, { walletId: rawWId, walletName: rawWName });
              if (matchedW) {
                resolvedAutoWalletId = String(matchedW.id);
                resolvedAutoWalletName = String(matchedW.name || '').trim();
              } else if (rawWName) {
                resolvedAutoWalletName = rawWName;
              }
            }
          }

          if (action === 'RENAME' || action === 'UPDATE' || action === 'EDIT') {
            if (!name) {
              return res.status(200).json({ success: false, message: 'Tên mới không được để trống!' });
            }
            if (catType === 'TEMPLATE') {
              let targetTpl = null;
              if (catId) {
                const found = await sql`SELECT id, content_template FROM family_templates WHERE id = ${catId} LIMIT 1`;
                targetTpl = found[0] || null;
              }
              if (!targetTpl && oldName) {
                const found = await sql`
                  SELECT id, content_template FROM family_templates
                  WHERE LOWER(TRIM(content_template)) = ${oldName.toLowerCase()}
                  LIMIT 1
                `;
                targetTpl = found[0] || null;
              }
              if (!targetTpl) {
                return res.status(200).json({ success: false, message: `Không tìm thấy mẫu cần cập nhật!` });
              }
              const actualId = targetTpl.id;
              const dupRows = await sql`
                SELECT id FROM family_templates
                WHERE id != ${actualId} AND LOWER(TRIM(content_template)) = ${name.toLowerCase()}
                LIMIT 1
              `;
              if (dupRows.length > 0) {
                return res.status(200).json({ success: false, message: `⚠️ Mẫu "${name}" đã tồn tại trong danh sách!` });
              }
              await sql`
                UPDATE family_templates
                SET content_template = ${tplContent || name},
                    auto_hu_id = ${resolvedAutoHuId},
                    auto_hu_name = ${resolvedAutoHuName},
                    auto_wallet_id = ${resolvedAutoWalletId},
                    auto_wallet_name = ${resolvedAutoWalletName}
                WHERE id = ${actualId}
              `;
            } else {
              let targetRow = null;
              if (catId) {
                const found = await sql`SELECT id, type, name FROM categories WHERE id = ${catId} LIMIT 1`;
                targetRow = found[0] || null;
              }
              if (!targetRow && oldName) {
                const found = await sql`
                  SELECT id, type, name FROM categories
                  WHERE (type = ${catType} OR (type = 'FAMILY' AND ${catType} = 'PARTNER') OR (${catType} = 'HU' AND type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU'))) AND LOWER(TRIM(name)) = ${oldName.toLowerCase()}
                  LIMIT 1
                `;
                targetRow = found[0] || null;
              }
              if (!targetRow) {
                return res.status(200).json({ success: false, message: `Không tìm thấy danh mục cần đổi tên!` });
              }
              if (catType === 'HU' && SYSTEM_HU_TYPES.has(String(targetRow.type || '').toUpperCase())) {
                return res.status(200).json({ success: false, message: `🔒 "${targetRow.name}" là Hũ cố định trên hệ thống, không thể đổi tên!` });
              }
              if (catType === 'WAREHOUSE' && isSystemWarehouseStatus(targetRow)) {
                return res.status(200).json({ success: false, message: `🔒 "${targetRow.name}" là trạng thái cố định trên hệ thống (${getWarehouseRole(targetRow)}), không thể đổi tên!` });
              }
              const actualId = targetRow.id;
              const prevName = String(targetRow.name || oldName || '').trim();
              const prevLow = prevName.toLowerCase();

              const dupRows = await sql`
                SELECT id FROM categories
                WHERE id != ${actualId} AND (type = ${catType} OR (type = 'FAMILY' AND ${catType} = 'PARTNER')) AND LOWER(TRIM(name)) = ${name.toLowerCase()}
                LIMIT 1
              `;
              if (dupRows.length > 0) {
                return res.status(200).json({ success: false, message: `⚠️ Tên "${name}" đã tồn tại trong danh sách!` });
              }

              const isLockedVal = metaObj.isLocked !== undefined ? Boolean(metaObj.isLocked) : (metaObj.is_locked !== undefined ? Boolean(metaObj.is_locked) : null);
              if (isLockedVal !== null) {
                await sql`UPDATE categories SET name = ${name}, is_locked = ${isLockedVal} WHERE id = ${actualId}`;
              } else {
                await sql`UPDATE categories SET name = ${name} WHERE id = ${actualId}`;
              }

              if (catType === 'WAREHOUSE') {
                await Promise.all([
                  sql`UPDATE business_orders SET warehouse = ${actualId}, warehouse_id = ${actualId} WHERE warehouse_id = ${actualId} OR LOWER(TRIM(COALESCE(warehouse, ''))) = ${prevLow}`,
                  sql`UPDATE sales_orders SET warehouse = ${actualId}, warehouse_id = ${actualId} WHERE warehouse_id = ${actualId} OR LOWER(TRIM(COALESCE(warehouse, ''))) = ${prevLow}`,
                  sql`UPDATE stock_transfers SET from_warehouse = ${actualId}, from_warehouse_id = ${actualId} WHERE from_warehouse_id = ${actualId} OR LOWER(TRIM(COALESCE(from_warehouse, ''))) = ${prevLow}`,
                  sql`UPDATE stock_transfers SET to_warehouse = ${actualId}, to_warehouse_id = ${actualId} WHERE to_warehouse_id = ${actualId} OR LOWER(TRIM(COALESCE(to_warehouse, ''))) = ${prevLow}`
                ]);
              } else if (catType === 'ACCOUNT') {
                await sql`UPDATE business_orders SET account = ${actualId}, account_id = ${actualId} WHERE account_id = ${actualId} OR LOWER(TRIM(COALESCE(account, ''))) = ${prevLow}`;
              } else if (catType === 'SHOP') {
                await sql`UPDATE business_orders SET shop = ${name}, shop_id = ${actualId} WHERE shop_id = ${actualId} OR LOWER(TRIM(COALESCE(shop, ''))) = ${prevLow}`;
              } else if (catType === 'PARTNER') {
                await sql`UPDATE debts SET name = ${actualId}, partner_id = ${actualId} WHERE partner_id = ${actualId} OR LOWER(TRIM(COALESCE(name, ''))) = ${prevLow}`;
              } else if (catType === 'HU') {
                await Promise.all([
                  sql`UPDATE family_transactions SET hu = ${actualId}, hu_id = ${actualId} WHERE hu_id = ${actualId} OR LOWER(TRIM(COALESCE(hu, ''))) = ${prevLow}`,
                  sql`UPDATE family_templates SET auto_hu_name = ${name} WHERE auto_hu_id = ${actualId}`
                ]);
              }
            }
          } else if (action === 'DELETE') {
            if (catType === 'HU') {
              const targetHuRows = catId
                ? await sql`SELECT id, type, name FROM categories WHERE id = ${catId} LIMIT 1`
                : await sql`SELECT id, type, name FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') AND LOWER(name) = ${name.toLowerCase()} LIMIT 1`;
              if (targetHuRows[0] && SYSTEM_HU_TYPES.has(String(targetHuRows[0].type || '').toUpperCase())) {
                return res.status(200).json({ success: false, message: `🔒 "${targetHuRows[0].name}" là Hũ cố định trên hệ thống, không thể xoá!` });
              }
            }
            if (catType === 'WAREHOUSE') {
              const targetWhRows = catId
                ? await sql`SELECT id, name FROM categories WHERE id = ${catId} LIMIT 1`
                : await sql`SELECT id, name FROM categories WHERE type IN ('WAREHOUSE', 'WAREHOUSE_STATUS') AND LOWER(name) = ${name.toLowerCase()} LIMIT 1`;
              if (targetWhRows[0] && isSystemWarehouseStatus(targetWhRows[0])) {
                return res.status(200).json({ success: false, message: `🔒 "${targetWhRows[0].name}" là trạng thái cố định trên hệ thống (${getWarehouseRole(targetWhRows[0])}), không thể xoá!` });
              }
            }
            if (catType === 'TEMPLATE') {
              if (catId) {
                await sql`UPDATE family_templates SET is_hidden = true WHERE id = ${catId}`;
              } else {
                await sql`UPDATE family_templates SET is_hidden = true WHERE LOWER(TRIM(content_template)) = ${name.toLowerCase()}`;
              }
            } else if (catId) {
              await sql`UPDATE categories SET is_hidden = true WHERE id = ${catId}`;
            } else {
              await sql`
                UPDATE categories 
                SET is_hidden = true 
                WHERE (type = ${catType} OR (type = 'FAMILY' AND ${catType} = 'PARTNER')) AND LOWER(name) = ${name.toLowerCase()}
              `;
            }
          } else if (action === 'HARD_DELETE' || action === 'PERMANENT_DELETE') {
            const nameLow = name.toLowerCase();
            let resolvedCatId = catId;
            if (!resolvedCatId && name) {
              const found = await sql`
                SELECT id FROM categories
                WHERE (type = ${catType} OR (type = 'FAMILY' AND ${catType} = 'PARTNER')) AND LOWER(name) = ${nameLow}
                LIMIT 1
              `;
              resolvedCatId = found[0]?.id || null;
            }
            let isUsed = false;
            let usedReason = '';

            if (catType === 'PARTNER') {
              const debts = resolvedCatId
                ? await sql`SELECT COUNT(*)::int as count FROM debts WHERE partner_id = ${resolvedCatId} OR LOWER(name) = ${nameLow}`
                : await sql`SELECT COUNT(*)::int as count FROM debts WHERE LOWER(name) = ${nameLow}`;
              if ((debts[0]?.count || 0) > 0) {
                isUsed = true;
                usedReason = `đã có ${debts[0].count} khoản ghi nhận trong sổ công nợ`;
              }
            } else if (catType === 'ACCOUNT') {
              const orders = resolvedCatId
                ? await sql`SELECT COUNT(*)::int as count FROM business_orders WHERE account_id = ${resolvedCatId} OR LOWER(account) = ${nameLow} OR LOWER(shop) = ${nameLow}`
                : await sql`SELECT COUNT(*)::int as count FROM business_orders WHERE LOWER(account) = ${nameLow} OR LOWER(shop) = ${nameLow}`;
              if ((orders[0]?.count || 0) > 0) {
                isUsed = true;
                usedReason = `đã có ${orders[0].count} đơn hàng sử dụng tài khoản này`;
              }
            } else if (catType === 'WAREHOUSE') {
              const targetWhRows = resolvedCatId
                ? await sql`SELECT id, name FROM categories WHERE id = ${resolvedCatId} LIMIT 1`
                : await sql`SELECT id, name FROM categories WHERE type IN ('WAREHOUSE', 'WAREHOUSE_STATUS') AND LOWER(name) = ${nameLow} LIMIT 1`;
              if (targetWhRows[0] && isSystemWarehouseStatus(targetWhRows[0])) {
                return res.status(200).json({ success: false, message: `🔒 "${targetWhRows[0].name}" là trạng thái cố định trên hệ thống (${getWarehouseRole(targetWhRows[0])}), không thể xoá!` });
              }
              const [orders, sales, transfers] = await Promise.all([
                resolvedCatId
                  ? sql`SELECT COUNT(*)::int as count FROM business_orders WHERE warehouse_id = ${resolvedCatId} OR LOWER(warehouse) = ${nameLow}`
                  : sql`SELECT COUNT(*)::int as count FROM business_orders WHERE LOWER(warehouse) = ${nameLow}`,
                resolvedCatId
                  ? sql`SELECT COUNT(*)::int as count FROM sales_orders WHERE warehouse_id = ${resolvedCatId} OR LOWER(warehouse) = ${nameLow}`
                  : sql`SELECT COUNT(*)::int as count FROM sales_orders WHERE LOWER(warehouse) = ${nameLow}`,
                resolvedCatId
                  ? sql`SELECT COUNT(*)::int as count FROM stock_transfers WHERE from_warehouse_id = ${resolvedCatId} OR to_warehouse_id = ${resolvedCatId} OR LOWER(from_warehouse) = ${nameLow} OR LOWER(to_warehouse) = ${nameLow}`
                  : sql`SELECT COUNT(*)::int as count FROM stock_transfers WHERE LOWER(from_warehouse) = ${nameLow} OR LOWER(to_warehouse) = ${nameLow}`
              ]);
              const whCount = (orders[0]?.count || 0) + (sales[0]?.count || 0) + (transfers[0]?.count || 0);
              if (whCount > 0) {
                isUsed = true;
                usedReason = `đã có ${whCount} bản ghi nhập/xuất/điều chuyển kho`;
              }
            } else if (catType === 'SHOP') {
              const orders = resolvedCatId
                ? await sql`SELECT COUNT(*)::int as count FROM business_orders WHERE shop_id = ${resolvedCatId} OR LOWER(shop) = ${nameLow}`
                : await sql`SELECT COUNT(*)::int as count FROM business_orders WHERE LOWER(shop) = ${nameLow}`;
              if ((orders[0]?.count || 0) > 0) {
                isUsed = true;
                usedReason = `đã có ${orders[0].count} đơn hàng tại cửa hàng này`;
              }
            } else if (catType === 'HU') {
              const targetHuRows = resolvedCatId
                ? await sql`SELECT id, type, name FROM categories WHERE id = ${resolvedCatId} LIMIT 1`
                : await sql`SELECT id, type, name FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') AND LOWER(name) = ${nameLow} LIMIT 1`;
              if (targetHuRows[0] && SYSTEM_HU_TYPES.has(String(targetHuRows[0].type || '').toUpperCase())) {
                return res.status(200).json({ success: false, message: `🔒 "${targetHuRows[0].name}" là Hũ cố định trên hệ thống, không thể xoá!` });
              }
              const [txs, tpls] = await Promise.all([
                resolvedCatId
                  ? sql`SELECT COUNT(*)::int as count FROM family_transactions WHERE hu_id = ${resolvedCatId} OR LOWER(TRIM(COALESCE(hu, ''))) = ${nameLow}`
                  : sql`SELECT COUNT(*)::int as count FROM family_transactions WHERE LOWER(TRIM(COALESCE(hu, ''))) = ${nameLow}`,
                resolvedCatId
                  ? sql`SELECT COUNT(*)::int as count FROM family_templates WHERE auto_hu_id = ${resolvedCatId}`
                  : Promise.resolve([{ count: 0 }])
              ]);
              const huCount = (txs[0]?.count || 0) + (tpls[0]?.count || 0);
              if (huCount > 0) {
                isUsed = true;
                usedReason = `đã có ${txs[0]?.count || 0} giao dịch thu chi và ${tpls[0]?.count || 0} mẫu đang dùng hũ này`;
              }
            }

            if (isUsed) {
              return res.status(200).json({
                success: false,
                message: `⚠️ Không thể xoá hẳn danh mục "${name}" vì ${usedReason}. Mục này sẽ được giữ trong danh sách đã xoá/ẩn để bảo toàn dữ liệu lịch sử!`
              });
            }

            if (catType === 'TEMPLATE') {
              if (resolvedCatId) {
                await sql`DELETE FROM family_templates WHERE id = ${resolvedCatId}`;
              } else {
                await sql`DELETE FROM family_templates WHERE LOWER(TRIM(content_template)) = ${name.toLowerCase()}`;
              }
            } else if (resolvedCatId) {
              await sql`DELETE FROM categories WHERE id = ${resolvedCatId}`;
            } else {
              await sql`
                DELETE FROM categories 
                WHERE (type = ${catType} OR (type = 'FAMILY' AND ${catType} = 'PARTNER')) AND LOWER(name) = ${name.toLowerCase()}
              `;
            }
          } else if (action === 'RESTORE') {
            if (catType === 'TEMPLATE') {
              if (catId) {
                await sql`UPDATE family_templates SET is_hidden = false WHERE id = ${catId}`;
              } else {
                await sql`UPDATE family_templates SET is_hidden = false WHERE LOWER(TRIM(content_template)) = ${name.toLowerCase()}`;
              }
            } else if (catId) {
              await sql`UPDATE categories SET is_hidden = false WHERE id = ${catId}`;
            } else {
              await sql`
                UPDATE categories 
                SET is_hidden = false 
                WHERE (type = ${catType} OR (type = 'FAMILY' AND ${catType} = 'PARTNER')) AND LOWER(name) = ${name.toLowerCase()}
              `;
            }
          } else {
            // ADD
            if (catType === 'TEMPLATE') {
              const existingTpl = await sql`
                SELECT id, is_hidden FROM family_templates
                WHERE LOWER(TRIM(COALESCE(content_template, ''))) = ${name.toLowerCase()}
                LIMIT 1
              `;
              if (existingTpl.length > 0) {
                await sql`
                  UPDATE family_templates
                  SET is_hidden = false,
                      content_template = ${tplContent || name},
                      auto_hu_id = ${resolvedAutoHuId},
                      auto_hu_name = ${resolvedAutoHuName},
                      auto_wallet_id = ${resolvedAutoWalletId},
                      auto_wallet_name = ${resolvedAutoWalletName}
                  WHERE id = ${existingTpl[0].id}
                `;
              } else {
                const newTplId = generateCategoryId('TEMPLATE');
                await sql`
                  INSERT INTO family_templates (id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden)
                  VALUES (${newTplId}, ${tplContent || name}, ${resolvedAutoHuId}, ${resolvedAutoHuName}, ${resolvedAutoWalletId}, ${resolvedAutoWalletName}, false)
                `;
              }
            } else {
              const existing = await sql`
                SELECT id, type, is_hidden 
                FROM categories 
                WHERE (type = ${catType} OR (type = 'FAMILY' AND ${catType} = 'PARTNER') OR (${catType} = 'HU' AND type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU'))) AND LOWER(name) = ${name.toLowerCase()}
                LIMIT 1
              `;
              if (existing.length > 0) {
                await sql`UPDATE categories SET is_hidden = false WHERE id = ${existing[0].id}`;
              } else {
                if ((catType === 'WAREHOUSE' || catType === 'WAREHOUSE_STATUS') && isSystemWarehouseStatus(name)) {
                  return res.status(200).json({ success: false, message: `🔒 Trạng thái "${name}" được cố định trên hệ thống, chỉ có thể thêm Kho hàng mới!` });
                }
                if (catType === 'HU' && SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(name))) {
                  return res.status(200).json({ success: false, message: `🔒 "${name}" là Hũ cố định trên hệ thống, chỉ có thể thêm Hũ Chi Tiêu mới!` });
                }
                const newCatId = generateCategoryId(catType);
                const actualCatType = catType === 'HU' ? 'HU_CHITIEU' : catType;
                const isLockedVal = Boolean(metaObj.isLocked || metaObj.is_locked);
                await sql`INSERT INTO categories (id, type, name, is_hidden, is_locked) VALUES (${newCatId}, ${actualCatType}, ${name}, false, ${isLockedVal})`;
              }
            }
          }
        }

        const [allCategories, allTemplates, allWallets, usedItems] = await Promise.all([
          sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories ORDER BY id ASC`,
          sql`SELECT id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden FROM family_templates ORDER BY id ASC`.catch(() => []),
          sql`SELECT id, name, type, card_number, card_exp, card_cvv, status, is_hidden, is_deleted FROM wallets ORDER BY id ASC`,
          fetchSetupUsedSets(sql)
        ]);

        const okMsg = (action === 'RENAME' || action === 'UPDATE' || action === 'EDIT')
          ? `✅ Đã cập nhật "${name}" & đồng bộ toàn bộ dữ liệu cũ!`
          : (action === 'HARD_DELETE' || action === 'PERMANENT_DELETE'
            ? `Đã xoá vĩnh viễn "${name}" thành công!`
            : (action === 'DELETE' ? `Đã xóa "${name}" thành công!` : (action === 'RESTORE' ? `Đã phục hồi "${name}" thành công!` : `Đã thêm "${name}" thành công!`)));

        return res.status(200).json({
          success: true,
          message: okMsg,
          data: buildSetupCategoryResponsePayload(allCategories, allTemplates, allWallets, usedItems, isKian)
        });
      }

      // 21. BẢO MẬT VÀ LƯU CHI TIẾT THẺ / VÍ (Tab 1)
      case 'saveWalletToSheet':
      case 'saveWallet':
      case 'saveCardSecurityDetails': {
        const payload = args[0] || {};
        const {
          id, name, type, limit, closingDate, dueDate, settleSource,
          cardNumber, cardExp, cardCvv, stmtFileHeaders, stmtPasteHeaders,
          balance, initialBalance, initial_balance, isVirtual, vCardName, vCardNumber, vCardExp, vCardCvv
        } = payload;

        if (isVirtual) {
          const vName = String(vCardName || name || '').trim().replace(/\s+/g, ' ');
          if (!vName) {
            return res.status(200).json({ success: false, message: '⚠️ Vui lòng nhập Tên Thẻ Ảo!' });
          }
          const rawVNum = vCardNumber !== undefined ? vCardNumber : cardNumber;
          const rawVExp = vCardExp !== undefined ? vCardExp : cardExp;
          const rawVCvv = vCardCvv !== undefined ? vCardCvv : cardCvv;
          const vNumUpd = isMaskedCardPlaceholder(rawVNum)
            ? undefined
            : ((rawVNum !== undefined && rawVNum !== null && String(rawVNum).trim() !== '') ? encryptCardField(rawVNum) : (rawVNum === '' ? '' : undefined));
          const vExpUpd = isMaskedCardPlaceholder(rawVExp)
            ? undefined
            : ((rawVExp !== undefined && rawVExp !== null && String(rawVExp).trim() !== '') ? encryptCardField(rawVExp) : (rawVExp === '' ? '' : undefined));
          const vCvvUpd = isMaskedCardPlaceholder(rawVCvv)
            ? undefined
            : ((rawVCvv !== undefined && rawVCvv !== null && String(rawVCvv).trim() !== '') ? encryptCardField(rawVCvv) : (rawVCvv === '' ? '' : undefined));

          let existing = [];
          if (id && !payload.isAdd) {
            existing = await sql`SELECT id FROM wallets WHERE id = ${String(id)} LIMIT 1`;
          }

          const allWalletRows = await sql`SELECT id, name, type, is_deleted, is_hidden, status FROM wallets`;
          const dupVirtual = findDuplicateWalletByName(allWalletRows, vName, existing[0]?.id || '');
          if (dupVirtual) {
            const isHiddenDup = Boolean(dupVirtual.is_deleted || dupVirtual.is_hidden || String(dupVirtual.status || '').toUpperCase() === 'DELETED');
            return res.status(200).json({
              success: false,
              message: isHiddenDup
                ? `⚠️ Tên thẻ "${vName}" trùng với thẻ/ví đã ẩn ("${dupVirtual.name}")! Vui lòng khôi phục thẻ cũ hoặc đặt tên khác.`
                : `⚠️ Tên thẻ "${vName}" đã tồn tại ("${dupVirtual.name}")! Mỗi thẻ/ví phải có tên duy nhất.`
            });
          }

          let savedVId = id || '';
          if (existing.length > 0) {
            savedVId = existing[0].id;
            await sql`
              UPDATE wallets 
              SET name = ${vName},
                  card_number = CASE WHEN ${vNumUpd !== undefined} THEN ${vNumUpd ?? null} ELSE card_number END,
                  card_exp = CASE WHEN ${vExpUpd !== undefined} THEN ${vExpUpd ?? null} ELSE card_exp END,
                  card_cvv = CASE WHEN ${vCvvUpd !== undefined} THEN ${vCvvUpd ?? null} ELSE card_cvv END,
                  type = 'VIRTUAL',
                  is_deleted = false,
                  is_hidden = false,
                  status = 'ACTIVE',
                  updated_at = NOW()
              WHERE id = ${savedVId}
            `;
          } else {
            const idTaken = id && allWalletRows.some(w => String(w.id || '').trim() === String(id).trim());
            savedVId = (id && !idTaken) ? String(id).trim() : ('VC_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
            await sql`
              INSERT INTO wallets (
                id, name, type, card_number, card_exp, card_cvv,
                current_balance, credit_limit, debt, preorder, status, is_deleted, is_hidden, created_at, updated_at
              ) VALUES (
                ${savedVId}, ${vName}, 'VIRTUAL', ${vNumUpd || ''}, ${vExpUpd || ''}, ${vCvvUpd || ''},
                0, 0, 0, 0, 'ACTIVE', false, false, NOW(), NOW()
              )
            `;
          }

          const allActiveRows = await sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv, is_deleted, is_hidden
            FROM wallets 
            WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(status), '') <> 'DELETED'
            ORDER BY id ASC
          `;
          const updatedWallets = allActiveRows.filter(w => String(w.type || '').toUpperCase() !== 'VIRTUAL');
          const updatedVirtualCards = formatMaskedVirtualCards(allActiveRows);
          const savedCard = updatedVirtualCards.find(c => String(c.id) === String(savedVId)) || null;

          return res.status(200).json({
            success: true,
            message: 'Đã lưu thông tin thẻ ảo thành công!',
            card: savedCard || { id: savedVId, name: vName, isVirtual: true, type: 'VIRTUAL' },
            wallets: updatedWallets,
            updatedWallets: updatedWallets,
            virtualCards: updatedVirtualCards
          });
        }

        let wName = String(name || '').trim().replace(/\s+/g, ' ');
        if (!wName) {
          return res.status(200).json({ success: false, message: 'Vui lòng nhập Tên Thẻ / Ví!' });
        }

        let existing = [];
        if (id && !payload.isAdd) {
          existing = await sql`SELECT id, name, type, debt, preorder FROM wallets WHERE id = ${String(id)} LIMIT 1`;
        }

        const requestedType = String(type || 'DEBIT').trim().toUpperCase() === 'CREDIT' ? 'CREDIT' : 'DEBIT';

        let wType = requestedType;
        if (existing.length > 0) {
          const cur = existing[0];
          const existingType = String(cur.type || '').trim().toUpperCase();
          const hasHistory = (await checkWalletHasHistory(sql, cur.id, cur.name)) ||
                             Number(cur.debt || 0) > 0 ||
                             Number(cur.preorder || 0) > 0;
          // Chỉ khóa loại (Credit <-> Debit) khi ví/thẻ đã phát sinh giao dịch; nếu chưa có giao dịch vẫn cho phép sửa loại
          wType = (hasHistory && existingType) ? existingType : requestedType;
        }

        // Chuẩn hóa tiền tố C- theo đúng phân loại: CREDIT tự động thêm C- nếu chưa có, DEBIT gỡ bỏ C-
        if (wType === 'CREDIT') {
          if (!/^c\s*[-_]/i.test(wName)) {
            wName = 'C- ' + wName;
          } else {
            wName = wName.replace(/^c\s*[-_]\s*/i, 'C- ').replace(/\s+/g, ' ').trim();
          }
        } else {
          wName = (wName.replace(/^c\s*[-_]\s*/i, '').trim() || wName).replace(/\s+/g, ' ');
        }

        const allWalletRows = await sql`SELECT id, name, type, is_deleted, is_hidden, status FROM wallets`;
        const dupMain = findDuplicateWalletByName(allWalletRows, wName, existing[0]?.id || '');
        if (dupMain) {
          const isHiddenDup = Boolean(dupMain.is_deleted || dupMain.is_hidden || String(dupMain.status || '').toUpperCase() === 'DELETED');
          return res.status(200).json({
            success: false,
            message: isHiddenDup
              ? `⚠️ Tên thẻ/ví "${wName}" trùng với thẻ/ví đã ẩn ("${dupMain.name}")! Vui lòng khôi phục thẻ cũ hoặc đặt tên khác.`
              : `⚠️ Tên thẻ/ví "${wName}" đã tồn tại ("${dupMain.name}")! Mỗi thẻ/ví phải có tên duy nhất.`
          });
        }

        const isCreditType = (wType === 'CREDIT');
        const wLimit = isCreditType ? Number(limit || payload.credit_limit || 0) : 0;
        const wCut = isCreditType && (closingDate || payload.closing_date) ? String(closingDate || payload.closing_date) : null;
        const wDue = isCreditType && (dueDate || payload.due_date) ? String(dueDate || payload.due_date) : null;
        const rawSettleId = isCreditType ? String(payload.settleSourceId || payload.settle_source_id || '').trim() : '';
        const rawSettleName = isCreditType && (settleSource || payload.settle_source) ? String(settleSource || payload.settle_source).trim() : '';
        const matchedSettleW = isCreditType && (rawSettleId || rawSettleName)
          ? await findWalletByOrderName(sql, { walletId: rawSettleId, walletName: rawSettleName })
          : null;
        const wSettleId = isCreditType ? (matchedSettleW ? String(matchedSettleW.id) : (rawSettleId || null)) : null;
        const wSettle = isCreditType ? (matchedSettleW ? String(matchedSettleW.name) : (rawSettleName || null)) : null;
        const wFileH = (stmtFileHeaders || payload.stmt_file_headers) ? String(stmtFileHeaders || payload.stmt_file_headers) : null;
        const wPasteH = (stmtPasteHeaders || payload.stmt_paste_headers) ? String(stmtPasteHeaders || payload.stmt_paste_headers) : null;

        const encCardNumber = isMaskedCardPlaceholder(cardNumber)
          ? undefined
          : ((cardNumber !== undefined && cardNumber !== null && cardNumber !== '') ? encryptCardField(cardNumber) : (cardNumber === '' ? '' : undefined));
        const encCardExp = isMaskedCardPlaceholder(cardExp)
          ? undefined
          : ((cardExp !== undefined && cardExp !== null && cardExp !== '') ? encryptCardField(cardExp) : (cardExp === '' ? '' : undefined));
        const encCardCvv = isMaskedCardPlaceholder(cardCvv)
          ? undefined
          : ((cardCvv !== undefined && cardCvv !== null && cardCvv !== '') ? encryptCardField(cardCvv) : (cardCvv === '' ? '' : undefined));

        const rawInitBal = initialBalance !== undefined ? initialBalance : (payload.initial_balance !== undefined ? payload.initial_balance : initial_balance);
        const hasInitBal = rawInitBal !== undefined && rawInitBal !== null && rawInitBal !== '' && !isNaN(Number(rawInitBal));
        if (!isCreditType && hasInitBal && Number(rawInitBal) < 0) {
          return res.status(200).json({ success: false, message: '⚠️ Thẻ Debit / Tiền mặt không được phép có số dư ban đầu âm!' });
        }
        const initBalNum = hasInitBal ? (!isCreditType ? Math.max(0, Number(rawInitBal)) : Number(rawInitBal)) : null;
        const rawCurBal = (balance !== undefined && balance !== '') ? balance : ((payload.current_balance !== undefined && payload.current_balance !== '') ? payload.current_balance : undefined);
        const hasCurBal = rawCurBal !== undefined && rawCurBal !== null && rawCurBal !== '' && !isNaN(Number(rawCurBal));
        if (!isCreditType && hasCurBal && Number(rawCurBal) < 0) {
          return res.status(200).json({ success: false, message: '⚠️ Thẻ Debit / Tiền mặt không được phép có số dư hiện tại âm!' });
        }
        const curBal = hasCurBal ? (!isCreditType ? Math.max(0, Number(rawCurBal)) : Number(rawCurBal)) : 0;

        const wLinkedEmail = isKian ? String(payload.linkedEmail || payload.linked_email || '').trim() : '';
        const wSenderFilter = isKian ? String(payload.senderFilter || payload.sender_filter || '').trim() : '';

        let savedId = id;
        if (existing.length > 0) {
          savedId = existing[0].id;
          const prevName = String(existing[0].name || '').trim();
          await sql`
            UPDATE wallets 
            SET name = ${wName},
                type = ${wType},
                credit_limit = ${wLimit},
                closing_date = ${wCut},
                due_date = ${wDue},
                settle_source = ${wSettle},
                settle_source_id = ${wSettleId},
                stmt_file_headers = ${wFileH},
                stmt_paste_headers = ${wPasteH},
                card_number = CASE WHEN ${encCardNumber !== undefined} THEN ${encCardNumber ?? null} ELSE card_number END,
                card_exp = CASE WHEN ${encCardExp !== undefined} THEN ${encCardExp ?? null} ELSE card_exp END,
                card_cvv = CASE WHEN ${encCardCvv !== undefined} THEN ${encCardCvv ?? null} ELSE card_cvv END,
                initial_balance = CASE WHEN ${hasInitBal && !isCreditType} THEN ${initBalNum} ELSE initial_balance END,
                current_balance = CASE WHEN ${hasCurBal && !isCreditType} THEN ${curBal} ELSE current_balance END,
                is_deleted = false,
                is_hidden = false,
                status = 'ACTIVE',
                updated_at = NOW()
            WHERE id = ${existing[0].id}
          `;
          if (isKian) {
            await sql`
              UPDATE wallets
              SET linked_email = ${wLinkedEmail},
                  sender_filter = ${wSenderFilter}
              WHERE id = ${existing[0].id}
            `.catch(() => {});
          }
          if (prevName && prevName !== wName) {
            const sIdStr = String(savedId);
            await Promise.all([
              sql`UPDATE family_transactions SET wallet_name = ${sIdStr} WHERE wallet_id = ${sIdStr} AND COALESCE(wallet_name, '') != ${sIdStr}`.catch(() => {}),
              sql`UPDATE business_orders SET wallet_name = ${sIdStr} WHERE wallet_id = ${sIdStr} AND COALESCE(wallet_name, '') != ${sIdStr}`.catch(() => {}),
              sql`UPDATE sales_orders SET wallet_name = ${sIdStr} WHERE wallet_id = ${sIdStr} AND COALESCE(wallet_name, '') != ${sIdStr}`.catch(() => {}),
              sql`UPDATE debts SET wallet_name = ${sIdStr} WHERE wallet_id = ${sIdStr} AND COALESCE(wallet_name, '') != ${sIdStr}`.catch(() => {}),
              sql`UPDATE wallet_ledger SET wallet_name = ${wName} WHERE wallet_id = ${sIdStr}`.catch(() => {}),
              sql`UPDATE bank_reconciliations SET wallet_name = ${wName} WHERE wallet_id = ${sIdStr}`.catch(() => {}),
              sql`UPDATE wallet_checkpoints SET wallet_name = ${wName} WHERE wallet_id = ${sIdStr}`.catch(() => {}),
              sql`UPDATE temp_transactions SET wallet_name = ${wName} WHERE wallet_id = ${sIdStr}`.catch(() => {}),
              sql`UPDATE split_expenses SET wallet_name = ${wName} WHERE wallet_id = ${sIdStr}`.catch(() => {}),
              sql`UPDATE wallets SET settle_source = ${wName} WHERE settle_source_id = ${sIdStr}`.catch(() => {}),
              sql`UPDATE family_templates SET auto_wallet_name = ${wName} WHERE auto_wallet_id = ${sIdStr}`.catch(() => {})
            ]);
          }
        } else {
          const idTaken = id && allWalletRows.some(w => String(w.id || '').trim() === String(id).trim());
          const newId = (id && !idTaken) ? String(id).trim() : ('W_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
          savedId = newId;
          const finalInitBal = (!isCreditType) ? (hasInitBal ? initBalNum : (hasCurBal ? curBal : 0)) : 0;
          const finalCurBal = (!isCreditType) ? (hasCurBal ? curBal : (hasInitBal ? initBalNum : 0)) : 0;
          await sql`
            INSERT INTO wallets (
              id, name, type, credit_limit, initial_balance, current_balance, debt, preorder,
              closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
              card_number, card_exp, card_cvv, status, is_deleted, is_hidden, created_at, updated_at
            ) VALUES (
              ${newId}, ${wName}, ${wType}, ${wLimit}, ${finalInitBal}, ${finalCurBal}, 0, 0,
              ${wCut}, ${wDue}, ${wSettle}, ${wSettleId}, ${wFileH}, ${wPasteH},
              ${encCardNumber || null}, ${encCardExp || null}, ${encCardCvv || null}, 'ACTIVE', false, false, NOW(), NOW()
            )
          `;
          if (isKian) {
            await sql`
              UPDATE wallets
              SET linked_email = ${wLinkedEmail},
                  sender_filter = ${wSenderFilter}
              WHERE id = ${newId}
            `.catch(() => {});
          }
        }

        const [rawUpdatedWallets, historySetAfter] = await Promise.all([
          isKian ? sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv, is_deleted, is_hidden,
                   COALESCE(linked_email, '') as linked_email, COALESCE(sender_filter, '') as sender_filter
            FROM wallets 
            ORDER BY id ASC
          ` : sql`
            SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                   closing_date, due_date, settle_source, settle_source_id, stmt_file_headers, stmt_paste_headers,
                   card_number, card_exp, card_cvv, is_deleted, is_hidden
            FROM wallets 
            ORDER BY id ASC
          `,
          getWalletsWithHistorySet(sql)
        ]);
        const updatedWalletById = buildWalletByIdMap(rawUpdatedWallets);
        const updatedWallets = rawUpdatedWallets
          .filter(w => !w.is_deleted && !w.is_hidden)
          .map(w => {
            const resolvedSettle = (w.settle_source_id && updatedWalletById.get(String(w.settle_source_id).trim()))
              ? updatedWalletById.get(String(w.settle_source_id).trim()).name
              : (w.settle_source || '');
            return {
              ...w,
              settle_source: resolvedSettle,
              settleSource: resolvedSettle,
              settleSourceId: w.settle_source_id || '',
              hasHistory: historySetAfter.has(String(w.id || '').trim().toLowerCase()) ||
                          historySetAfter.has(String(w.name || '').trim().toLowerCase()) ||
                          Number(w.debt || 0) > 0 ||
                          Number(w.preorder || 0) > 0
            };
          });

        return res.status(200).json({
          success: true,
          message: 'Đã lưu thông tin thẻ/ví thành công!',
          id: savedId,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 21B. XÓA VÀ ẨN THẺ / VÍ (Tab 1)
      case 'deleteWalletFromSheet':
      case 'deleteWallet':
      case 'hideCardOrWallet': {
        const payload = args[0] || {};
        const targetId = String((typeof payload === 'object' && payload !== null) ? (payload.id || '') : (payload || '')).trim();
        const targetName = String((typeof payload === 'object' && payload !== null) ? (payload.name || '') : '').trim();

        if (!targetId && !targetName) {
          return res.status(400).json({ success: false, message: 'Thiếu thông tin thẻ/ví cần xử lý!' });
        }

        const nameLow = targetName.toLowerCase();
        const hasHistory = await checkWalletHasHistory(sql, targetId, targetName);

        let actionDone = '';
        if (hasHistory) {
          if (payload.isHardDelete) {
            return res.status(200).json({
              success: false,
              message: `⚠️ Thẻ "${targetName || targetId}" đã có lịch sử giao dịch nên không thể xoá hẳn (chỉ được ẩn để bảo toàn sổ sách)!`
            });
          }
          // Thẻ có lịch sử -> Ẩn thẻ (chuyển sang mục thẻ ẩn để bảo toàn sổ sách)
          if (targetId) {
            await sql`
              UPDATE wallets 
              SET is_deleted = true, is_hidden = true, status = 'DELETED', updated_at = NOW() 
              WHERE id = ${targetId}
            `;
          } else {
            await sql`
              UPDATE wallets 
              SET is_deleted = true, is_hidden = true, status = 'DELETED', updated_at = NOW() 
              WHERE LOWER(name) = ${nameLow}
            `;
          }
          actionDone = 'hidden';
        } else {
          // Thẻ chưa từng có giao dịch -> Xóa hoàn toàn khỏi database
          if (targetId) {
            await sql`DELETE FROM wallets WHERE id = ${targetId}`;
          } else {
            await sql`DELETE FROM wallets WHERE LOWER(name) = ${nameLow}`;
          }
          actionDone = 'deleted';
        }

        const allActiveAfterHide = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv, is_deleted, is_hidden
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(status), '') <> 'DELETED'
          ORDER BY id ASC
        `;
        const updatedWallets = allActiveAfterHide.filter(w => String(w.type || '').toUpperCase() !== 'VIRTUAL');
        const updatedVirtualCards = formatMaskedVirtualCards(allActiveAfterHide);

        return res.status(200).json({
          success: true,
          hasHistory: hasHistory,
          action: actionDone,
          message: hasHistory 
            ? `Thẻ "${targetName || targetId}" đã có lịch sử giao dịch nên đã được ẩn khỏi danh sách chính và chuyển sang mục thẻ ẩn.`
            : `Đã xóa hoàn toàn thẻ "${targetName || targetId}" khỏi hệ thống!`,
          wallets: updatedWallets,
          updatedWallets: updatedWallets,
          virtualCards: updatedVirtualCards
        });
      }

      // 21C. PHỤC HỒI THẺ / VÍ ĐÃ XÓA (Tab 1)
      case 'restoreCardOrWallet':
      case 'restoreWallet': {
        const payload = args[0] || {};
        const targetId = String((typeof payload === 'object' && payload !== null) ? (payload.id || '') : (payload || '')).trim();
        const targetName = String((typeof payload === 'object' && payload !== null) ? (payload.name || '') : '').trim();

        const targetRows = targetId
          ? await sql`SELECT id, name FROM wallets WHERE id = ${targetId} LIMIT 1`
          : (targetName ? await sql`SELECT id, name FROM wallets WHERE LOWER(name) = ${targetName.toLowerCase()} LIMIT 1` : []);
        const targetRow = targetRows[0] || null;
        if (targetRow) {
          const activeRows = await sql`
            SELECT id, name FROM wallets
            WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(status), '') <> 'DELETED'
          `;
          if (findDuplicateWalletByName(activeRows, targetRow.name, targetRow.id)) {
            return res.status(200).json({
              success: false,
              message: `⚠️ Không thể khôi phục "${targetRow.name}" vì đang có thẻ/ví khác trùng tên!`
            });
          }
        }

        if (targetId) {
          await sql`
            UPDATE wallets 
            SET is_deleted = false, is_hidden = false, status = 'ACTIVE', updated_at = NOW() 
            WHERE id = ${targetId}
          `;
        } else if (targetName) {
          await sql`
            UPDATE wallets 
            SET is_deleted = false, is_hidden = false, status = 'ACTIVE', updated_at = NOW() 
            WHERE LOWER(name) = ${targetName.toLowerCase()}
          `;
        }

        const allActiveAfterRestore = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv, is_deleted, is_hidden
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(status), '') <> 'DELETED'
          ORDER BY id ASC
        `;
        const updatedWallets = allActiveAfterRestore.filter(w => String(w.type || '').toUpperCase() !== 'VIRTUAL');
        const updatedVirtualCards = formatMaskedVirtualCards(allActiveAfterRestore);

        return res.status(200).json({
          success: true,
          message: 'Đã phục hồi ví/thẻ thành công!',
          wallets: updatedWallets,
          updatedWallets: updatedWallets,
          virtualCards: updatedVirtualCards
        });
      }

      // 21D. CHUYỂN TIỀN NỘI BỘ GIỮA CÁC VÍ (Tab 1)
      case 'processWalletTransfer': {
        const payload = args[0] || {};
        const fromWalletId = String(payload.fromWalletId || payload.from_wallet_id || '').trim();
        const toWalletId = String(payload.toWalletId || payload.to_wallet_id || '').trim();
        const rawFrom = String(payload.fromWallet || '').trim();
        const rawTo = String(payload.toWallet || '').trim();
        const amount = Number(payload.amount || 0);
        const date = String(payload.date || new Date().toISOString().slice(0, 10));
        const note = String(payload.note || '').trim();

        const isSameWallet = (fromWalletId && toWalletId) ? (fromWalletId === toWalletId) : (rawFrom && rawFrom === rawTo);
        if ((!fromWalletId && !rawFrom) || (!toWalletId && !rawTo) || isSameWallet || amount <= 0) {
          return res.status(200).json({ success: false, message: 'Dữ liệu chuyển tiền không hợp lệ!' });
        }

        const srcW = await findWalletByOrderName(sql, { walletId: fromWalletId, walletName: rawFrom });
        const destW = await findWalletByOrderName(sql, { walletId: toWalletId, walletName: rawTo });
        const fromWallet = srcW ? String(srcW.name) : rawFrom;
        const toWallet = destW ? String(destW.name) : rawTo;
        const fromIdFinal = srcW ? String(srcW.id) : fromWalletId;
        const toIdFinal = destW ? String(destW.id) : toWalletId;

        let srcNewBal = 0;
        if (srcW) {
          srcNewBal = Number(srcW.current_balance || 0) - amount;
          await sql`UPDATE wallets SET current_balance = ${srcNewBal} WHERE id = ${srcW.id}`;
        }

        let destNewBal = 0;
        if (destW) {
          destNewBal = Number(destW.current_balance || 0) + amount;
          await sql`UPDATE wallets SET current_balance = ${destNewBal} WHERE id = ${destW.id}`;
        }

        // 3. Ghi log giao dịch vào family_transactions & wallet_ledger (Sổ Cái)
        const trTs = Date.now();
        const trId1 = 'TRF_OUT_' + trTs;
        const trId2 = 'TRF_IN_' + trTs;
        const trHuRows = await sql`SELECT id, type, name FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') ORDER BY id ASC`.catch(() => []);
        const matchedTrHu = resolveHuCategory(trHuRows, { huName: 'CK NỘI BỘ' }) || await ensureCategoryExistsByName(sql, trHuRows, 'HU', 'CK NỘI BỘ');
        const trHuId = matchedTrHu ? String(matchedTrHu.id) : null;
        await sql`
          INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status)
          VALUES 
            (${trId1}, ${date}, 'Chi', ${trHuId}, ${trHuId || 'Chuyển tiền'}, ${`Chuyển tiền sang ${toWallet}`}, ${amount}, ${fromIdFinal}, ${fromIdFinal || fromWallet}, false, ${note}, 'ACTIVE'),
            (${trId2}, ${date}, 'Thu', ${trHuId}, ${trHuId || 'Chuyển tiền'}, ${`Nhận tiền từ ${fromWallet}`}, ${amount}, ${toIdFinal}, ${toIdFinal || toWallet}, false, ${note}, 'ACTIVE')
        `;
        await upsertWalletLedgerEntry(sql, {
          date,
          walletId: fromIdFinal,
          walletName: fromWallet,
          eventType: 'TRANSFER_OUT',
          effectType: 'CASH',
          amount,
          balanceAfter: srcNewBal,
          note: `Chuyển tiền: ${fromWallet} -> ${toWallet}${note ? ' (' + note + ')' : ''}`,
          orderId: trId1,
          status: 'POSTED',
          direction: 'OUT',
          sourceModule: 'Transfer'
        });
        await upsertWalletLedgerEntry(sql, {
          date,
          walletId: toIdFinal,
          walletName: toWallet,
          eventType: 'TRANSFER_IN',
          effectType: 'CASH',
          amount,
          balanceAfter: destNewBal,
          note: `Nhận chuyển tiền từ: ${fromWallet}${note ? ' (' + note + ')' : ''}`,
          orderId: trId2,
          status: 'POSTED',
          direction: 'IN',
          sourceModule: 'Transfer'
        });

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        return res.status(200).json({
          success: true,
          message: `Đã chuyển ${amount.toLocaleString()} ¥ từ ${fromWallet} sang ${toWallet}!`,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 21E. TẤT TOÁN THẺ TÍN DỤNG (Tab 1)
      case 'processCreditCardSettlement': {
        const payload = args[0] || {};
        const creditCardId = String(payload.creditCardId || payload.cardId || '').trim();
        const sourceWalletId = String(payload.sourceWalletId || payload.walletId || '').trim();
        const rawCreditCard = String(payload.creditCard || payload.creditCardName || '').trim();
        const rawSourceWallet = String(payload.sourceWallet || payload.sourceWalletName || '').trim();
        const amount = Number(payload.amount || 0);
        const date = String(payload.date || new Date().toISOString().slice(0, 10));
        const note = String(payload.note || '').trim();

        if ((!creditCardId && !rawCreditCard) || (!sourceWalletId && !rawSourceWallet) || amount <= 0) {
          return res.status(200).json({ success: false, message: 'Dữ liệu tất toán thẻ không hợp lệ!' });
        }

        const srcW = await findWalletByOrderName(sql, { walletId: sourceWalletId, walletName: rawSourceWallet }, 'DEBIT');
        const cardW = await findWalletByOrderName(sql, { walletId: creditCardId, walletName: rawCreditCard }, 'CREDIT');
        const sourceWallet = srcW ? String(srcW.name) : rawSourceWallet;
        const creditCard = cardW ? String(cardW.name) : rawCreditCard;

        // 1. Trừ tiền ví nguồn (debit)
        let srcSetlBal = 0;
        if (srcW) {
          srcSetlBal = Number(srcW.current_balance || 0) - amount;
          await sql`UPDATE wallets SET current_balance = ${srcSetlBal} WHERE id = ${srcW.id}`;
        }

        // 2. Giảm dư nợ thẻ tín dụng
        let cardSetlBal = 0;
        if (cardW) {
          const newDebt = Math.max(0, Number(cardW.debt || 0) - amount);
          const limit = Number(cardW.credit_limit || 0);
          const pre = Number(cardW.preorder || 0);
          cardSetlBal = limit > 0 ? Math.max(0, limit - newDebt - pre) : 0;
          await sql`UPDATE wallets SET debt = ${newDebt}, current_balance = ${cardSetlBal} WHERE id = ${cardW.id}`;
        }

        // 3. Ghi log giao dịch tất toán vào family_transactions & wallet_ledger (Sổ Cái)
        const setlId = 'SETL_' + Date.now();
        let splitTag = '';
        if (payload.familyAmt !== undefined && payload.businessAmt !== undefined) {
          splitTag = `[GD:${Math.round(Number(payload.familyAmt || 0))}|KD:${Math.round(Number(payload.businessAmt || 0))}]`;
        }
        const setlNoteParts = [];
        if (note) setlNoteParts.push(note);
        if (cardW) setlNoteParts.push(`[ID:${cardW.id}]`);
        if (splitTag) setlNoteParts.push(splitTag);
        const setlNote = setlNoteParts.join(' ').trim();
        const setlHuRows = await sql`SELECT id, type, name FROM categories WHERE type IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') ORDER BY id ASC`.catch(() => []);
        const matchedSetlHu = resolveHuCategory(setlHuRows, { huName: 'Tất toán thẻ' }) || resolveHuCategory(setlHuRows, { huName: 'Thiết yếu' });
        const setlHuId = matchedSetlHu ? String(matchedSetlHu.id) : null;
        const srcWIdStr = srcW ? String(srcW.id) : sourceWalletId;
        await sql`
          INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status)
          VALUES (${setlId}, ${date}, 'Chi', ${setlHuId}, ${setlHuId || 'Thiết yếu'}, ${`Tất toán thẻ: ${creditCard}`}, ${amount}, ${srcWIdStr}, ${srcWIdStr || sourceWallet}, false, ${setlNote}, 'ACTIVE')
        `;
        await upsertWalletLedgerEntry(sql, {
          date,
          walletId: srcW ? String(srcW.id) : sourceWalletId,
          walletName: sourceWallet,
          eventType: 'CARD_PAYMENT',
          effectType: 'CASH',
          amount,
          balanceAfter: srcSetlBal,
          note: `Tất toán thẻ: ${creditCard} từ ${sourceWallet}${note ? ' (' + note + ')' : ''}`,
          orderId: setlId,
          status: 'POSTED',
          direction: 'OUT',
          sourceModule: 'Transfer',
          matchByWallet: true
        });
        await upsertWalletLedgerEntry(sql, {
          date,
          statementDate: payload.statementDate || (cardW ? (getCardDefaultPaymentStatementMonth(date, cardW.closing_date) + '-01') : ''),
          walletId: cardW ? String(cardW.id) : creditCardId,
          walletName: creditCard,
          eventType: 'CARD_SETTLE',
          effectType: 'CARD_DEBT',
          amount,
          balanceAfter: cardSetlBal,
          note: `Tất toán thẻ từ ${sourceWallet}${note ? ' (' + note + ')' : ''}`,
          orderId: setlId,
          status: 'POSTED',
          direction: 'DECREASE',
          sourceModule: 'Wallets',
          matchByWallet: true
        });

        const updatedWallets = await sql`
          SELECT id, name, type, current_balance, initial_balance, credit_limit, debt, preorder, status,
                 closing_date, due_date, settle_source, stmt_file_headers, stmt_paste_headers,
                 card_number, card_exp, card_cvv
          FROM wallets 
          WHERE is_deleted = false AND is_hidden = false AND COALESCE(UPPER(type), '') <> 'VIRTUAL'
          ORDER BY id ASC
        `;

        return res.status(200).json({
          success: true,
          message: `Đã tất toán ${amount.toLocaleString()} ¥ cho ${creditCard} từ ${sourceWallet}!`,
          wallets: updatedWallets,
          updatedWallets: updatedWallets
        });
      }

      // 22. ĐIỀU CHỈNH / CHỐT SỐ DƯ VÍ (Tab 1)
      case 'adjustWalletBalance':
      case 'updateWalletBalance': {
        const payload = args[0] || {};
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const newBal = Number(payload.newBalance ?? payload.actualBalance ?? payload.currentBalance ?? payload.balance ?? payload.current_balance ?? 0);
        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        if (w) {
          const oldBal = Number(w.current_balance || 0);
          const delta = Math.round((newBal - oldBal) * 100) / 100;
          const isCreditAdj = String(w.type || '').toUpperCase() === 'CREDIT';
          if (isCreditAdj) {
            const limit = Number(w.credit_limit || 0);
            const pre = Number(w.preorder || 0);
            const newDebt = Math.max(0, newBal);
            const newAvailable = limit > 0 ? Math.max(0, limit - newDebt - pre) : 0;
            await sql`UPDATE wallets SET debt = ${newDebt}, current_balance = ${newAvailable} WHERE id = ${w.id}`;
          } else {
            await sql`UPDATE wallets SET current_balance = ${newBal} WHERE id = ${w.id}`;
          }
          if (Math.abs(delta) > 0) {
            await upsertWalletLedgerEntry(sql, {
              date: payload.date || new Date().toISOString().slice(0, 10),
              walletId: String(w.id),
              walletName: String(w.name),
              eventType: 'BALANCE_ADJUSTMENT',
              effectType: isCreditAdj ? 'CARD_DEBT' : 'CASH',
              amount: Math.abs(delta),
              balanceAfter: newBal,
              note: String(payload.note || 'Chốt số dư chênh lệch').trim(),
              orderId: 'ADJ_' + Date.now(),
              status: 'POSTED',
              direction: isCreditAdj ? (delta > 0 ? 'DECREASE' : 'INCREASE') : (delta > 0 ? 'IN' : 'OUT'),
              sourceModule: 'System'
            });
          }
        }
        return res.status(200).json({ success: true, newBalance: newBal, message: 'Đã cập nhật số dư ví & ghi sổ cái trên database Vercel!' });
      }

      case 'checkpointWalletBalance': {
        const payload = args[0] || {};
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        if (!w && !wName) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy ví cần chốt sao kê!' });
        }

        const resolvedId = String(w?.id || wId || '').trim();
        const resolvedName = String(w?.name || wName || '').trim();
        const hasExplicitBal = payload.actualBalance !== undefined || payload.currentBalance !== undefined || payload.newBalance !== undefined || payload.balance !== undefined;
        const cpBal = hasExplicitBal
          ? Number(payload.actualBalance ?? payload.currentBalance ?? payload.newBalance ?? payload.balance ?? 0)
          : Number(w?.current_balance || 0);

        const cpYmd = normalizeDateToYMD(payload.checkpointDate || new Date()) || new Date().toISOString().slice(0, 10);
        const cpDateStr = formatYMDToDDMMYYYY(cpYmd);
        const cpRef = 'CP_' + cpYmd.replace(/-/g, '') + '_' + String(Date.now()).slice(-4);

        const exactIdLowCp = resolvedId.toLowerCase();
        const exactNameLowCp = resolvedName.toLowerCase();
        await sql`
          DELETE FROM wallet_checkpoints
          WHERE checkpoint_date = ${cpYmd}
            AND (
              (${exactIdLowCp !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLowCp})
              OR (${exactNameLowCp !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLowCp})
            )
        `.catch(() => {});

        await sql`
          INSERT INTO wallet_checkpoints (wallet_id, wallet_name, checkpoint_date, checkpoint_balance)
          VALUES (${resolvedId}, ${resolvedName}, ${cpYmd}, ${cpBal})
        `.catch(() => {});

        // Đánh dấu checkpoint_ref cho các dòng sổ cái trước hoặc bằng ngày chốt
        try {
          const exactIdLow = resolvedId.toLowerCase();
          const exactNameLow = resolvedName.toLowerCase();
          const unstamped = await sql`
            SELECT id, transaction_date
            FROM wallet_ledger
            WHERE COALESCE(TRIM(checkpoint_ref), '') = ''
              AND (
                (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
                OR (COALESCE(TRIM(wallet_id), '') = '' AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
              )
          `;
          const idsToStamp = (unstamped || [])
            .filter(r => {
              const ymd = normalizeDateToYMD(r.transaction_date);
              return !ymd || ymd <= cpYmd;
            })
            .map(r => String(r.id))
            .filter(Boolean);
          if (idsToStamp.length > 0) {
            await sql`UPDATE wallet_ledger SET checkpoint_ref = ${cpRef} WHERE id = ANY(${idsToStamp})`;
          }
        } catch (e) {}

        // Tính lại current_balance = mốc chốt + các giao dịch sau ngày chốt (chưa đóng dấu checkpoint_ref)
        if (w && hasExplicitBal) {
          let finalBal = cpBal;
          const isCreditW = String(w.type || '').toUpperCase() === 'CREDIT';
          try {
            const exactIdLow = resolvedId.toLowerCase();
            const exactNameLow = resolvedName.toLowerCase();
            const postCpRows = await sql`
              SELECT amount, direction, source_module, event_type
              FROM wallet_ledger
              WHERE COALESCE(TRIM(checkpoint_ref), '') = ''
                AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED')
                AND (
                  (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
                  OR (COALESCE(TRIM(wallet_id), '') = '' AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
                )
            `;
            for (const r of (postCpRows || [])) {
              const amt = Number(r.amount || 0);
              const dir = String(r.direction || '').trim().toUpperCase();
              const srcMod = String(r.source_module || '').trim();
              const evType = String(r.event_type || '').trim().toUpperCase();
              let isAdd = isCreditW
                ? (dir === 'INCREASE' || dir === 'OUT' || dir === '-')
                : (dir === 'IN' || dir === 'INCREASE' || dir === '+');
              if (!isCreditW && srcMod === 'Purchase' && (evType === 'PURCHASE_CHARGE' || evType === 'PREORDER_HOLD')) {
                isAdd = false;
              }
              finalBal += isAdd ? amt : -amt;
            }
          } catch (e) {}
          if (isCreditW) {
            const limit = Number(w.credit_limit || 0);
            const pre = Number(w.preorder || 0);
            const newDebt = Math.max(0, finalBal);
            const newAvailable = limit > 0 ? Math.max(0, limit - newDebt - pre) : 0;
            await sql`UPDATE wallets SET debt = ${newDebt}, current_balance = ${newAvailable} WHERE id = ${w.id}`;
          } else {
            await sql`UPDATE wallets SET current_balance = ${finalBal} WHERE id = ${w.id}`;
          }
        }

        if (Array.isArray(payload.recMatched) && payload.recMatched.length > 0) {
          await recordReconciledRowsHelper(sql, w, resolvedName, payload.recMatched, cpRef, 'Checkpoint');
        }

        const updatedWallets = await fetchActiveWalletsList(sql);
        return res.status(200).json({
          success: true,
          cpRef,
          checkpointDate: cpDateStr,
          checkpointBalance: cpBal,
          updatedWallets,
          wallets: updatedWallets,
          message: `Đã chốt sao kê kỳ ${cpDateStr} thành công!`
        });
      }

      case 'undoWalletCheckpoint': {
        const payload = args[0] || {};
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        if (!w && !wName) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy ví cần hủy chốt sao kê!' });
        }

        const resolvedId = String(w?.id || wId || '').trim();
        const resolvedName = String(w?.name || wName || '').trim();
        const exactIdLow = resolvedId.toLowerCase();
        const exactNameLow = resolvedName.toLowerCase();

        // 1. Tìm mốc chốt cần hủy (ưu tiên theo checkpointId truyền vào hoặc mốc mới nhất của ví)
        let cpToDelete = null;
        if (payload.checkpointId) {
          const rows = await sql`
            SELECT id, wallet_id, wallet_name, checkpoint_date, checkpoint_balance
            FROM wallet_checkpoints
            WHERE id = ${payload.checkpointId}
            LIMIT 1
          `;
          if (rows && rows.length > 0) cpToDelete = rows[0];
        }
        if (!cpToDelete) {
          const rows = await sql`
            SELECT id, wallet_id, wallet_name, checkpoint_date, checkpoint_balance
            FROM wallet_checkpoints
            WHERE (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
               OR (${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
            ORDER BY checkpoint_date DESC, id DESC
            LIMIT 1
          `;
          if (rows && rows.length > 0) cpToDelete = rows[0];
        }

        if (!cpToDelete) {
          return res.status(200).json({ success: false, message: 'Ví này hiện không có mốc chốt sao kê nào để hủy!' });
        }

        const deletedCpYmd = normalizeDateToYMD(cpToDelete.checkpoint_date);
        const deletedCpRefPrefix = 'CP_' + deletedCpYmd.replace(/-/g, '');

        // 2. Tìm mốc chốt liền trước đó (nếu có)
        const prevCpRows = await sql`
          SELECT id, wallet_id, wallet_name, checkpoint_date, checkpoint_balance
          FROM wallet_checkpoints
          WHERE id != ${cpToDelete.id}
            AND (
              (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
              OR (${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
            )
          ORDER BY checkpoint_date DESC, id DESC
          LIMIT 1
        `;
        const prevCp = (prevCpRows && prevCpRows.length > 0) ? prevCpRows[0] : null;

        // 3. Xóa mốc chốt này khỏi bảng wallet_checkpoints
        await sql`DELETE FROM wallet_checkpoints WHERE id = ${cpToDelete.id}`;

        // 4. Xóa checkpoint_ref trên wallet_ledger cho các giao dịch thuộc mốc chốt vừa hủy
        if (prevCp) {
          const prevCpYmd = normalizeDateToYMD(prevCp.checkpoint_date);
          await sql`
            UPDATE wallet_ledger
            SET checkpoint_ref = NULL
            WHERE (
              (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
              OR (COALESCE(TRIM(wallet_id), '') = '' AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
            )
            AND (
              transaction_date > ${prevCpYmd}
              OR COALESCE(checkpoint_ref, '') LIKE ${deletedCpRefPrefix + '%'}
            )
          `;
        } else {
          await sql`
            UPDATE wallet_ledger
            SET checkpoint_ref = NULL
            WHERE (
              (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
              OR (COALESCE(TRIM(wallet_id), '') = '' AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
            )
          `;
        }

        // 5. Khôi phục / tính lại current_balance cho ví
        if (w) {
          let baseBal = prevCp ? Number(prevCp.checkpoint_balance || 0) : Number(w.initial_balance || 0);
          const isCreditW = String(w.type || '').toUpperCase() === 'CREDIT';
          try {
            const postRows = await sql`
              SELECT amount, direction, source_module, event_type
              FROM wallet_ledger
              WHERE COALESCE(TRIM(checkpoint_ref), '') = ''
                AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED')
                AND (
                  (${exactIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${exactIdLow})
                  OR (COALESCE(TRIM(wallet_id), '') = '' AND ${exactNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${exactNameLow})
                )
            `;
            for (const r of (postRows || [])) {
              const amt = Number(r.amount || 0);
              const dir = String(r.direction || '').trim().toUpperCase();
              const srcMod = String(r.source_module || '').trim();
              const evType = String(r.event_type || '').trim().toUpperCase();
              let isAdd = isCreditW
                ? (dir === 'INCREASE' || dir === 'OUT' || dir === '-')
                : (dir === 'IN' || dir === 'INCREASE' || dir === '+');
              if (!isCreditW && srcMod === 'Purchase' && (evType === 'PURCHASE_CHARGE' || evType === 'PREORDER_HOLD')) {
                isAdd = false;
              }
              baseBal += isAdd ? amt : -amt;
            }
          } catch (e) {}
          if (isCreditW) {
            const limit = Number(w.credit_limit || 0);
            const pre = Number(w.preorder || 0);
            const newDebt = Math.max(0, baseBal);
            const newAvailable = limit > 0 ? Math.max(0, limit - newDebt - pre) : 0;
            await sql`UPDATE wallets SET debt = ${newDebt}, current_balance = ${newAvailable} WHERE id = ${w.id}`;
          } else {
            await sql`UPDATE wallets SET current_balance = ${baseBal} WHERE id = ${w.id}`;
          }
        }

        const updatedWallets = await fetchActiveWalletsList(sql);
        return res.status(200).json({
          success: true,
          deletedCheckpointDate: formatYMDToDDMMYYYY(cpToDelete.checkpoint_date),
          deletedCheckpointBalance: cpToDelete.checkpoint_balance,
          restoredCheckpointDate: prevCp ? formatYMDToDDMMYYYY(prevCp.checkpoint_date) : null,
          restoredCheckpointBalance: prevCp ? prevCp.checkpoint_balance : null,
          updatedWallets,
          wallets: updatedWallets,
          message: `Đã hủy mốc chốt sao kê ngày ${formatYMDToDDMMYYYY(cpToDelete.checkpoint_date)} và khôi phục số dư ví thành công!`
        });
      }

      // 22B. LỊCH SỬ GIAO DỊCH THẺ / VÍ (SỔ CÁI & SAO KÊ CHI TIẾT)
      case 'getWalletTransactionHistory': {
        const [rawWalletName, , explicitWalletId] = args || [];
        const walletArgObj = (rawWalletName && typeof rawWalletName === 'object') ? rawWalletName : null;
        const walletName = String(walletArgObj ? (walletArgObj.walletName || walletArgObj.name || '') : (rawWalletName || '')).trim();
        const reqWalletId = String(explicitWalletId || (walletArgObj ? (walletArgObj.walletId || walletArgObj.id || '') : '')).trim();
        if (!walletName && !reqWalletId) return res.status(200).json([]);

        const targetWallet = await findWalletByOrderName(sql, { walletId: reqWalletId, walletName });
        const history = await fetchWalletHistoryHelper(sql, targetWallet, walletName);
        return res.status(200).json(history);
      }

      // 22. LẤY DỮ LIỆU TAB 5 (Lịch Mua & Cooldown)
      case 'getTab5Data': {
        const [orderRows, catRows] = await Promise.all([
          sql`
            SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, is_deleted, shop, shop_id, account, account_id
            FROM business_orders
            WHERE is_deleted = false
            ORDER BY date DESC
          `,
          sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => [])
        ]);
        const tab5CatById = buildCategoryByIdMap(catRows);
        const resolveTab5Cat = (cid, fallback) => {
          const cleanCid = normalizeCategoryId(cid);
          const cleanFb = String(fallback || '').trim();
          const obj = (cleanCid && tab5CatById.get(cleanCid)) || (cleanFb && tab5CatById.get(cleanFb)) || null;
          return obj ? String(obj.name || '').trim() : cleanFb;
        };
        const resolvedOrderRows = orderRows.map(o => ({
          ...o,
          shop: resolveTab5Cat(o.shop_id, o.shop),
          account: resolveTab5Cat(o.account_id, o.account),
          warehouse: resolveTab5Cat(o.warehouse_id, o.warehouse)
        }));
        const tab5Data = buildTab5Matrix(resolvedOrderRows, catRows.filter(c => !c.is_hidden));
        return res.status(200).json({
          success: true,
          matrix: tab5Data.matrix,
          accounts: tab5Data.accounts,
          stores: tab5Data.stores,
          storeCooldowns: { Fuji: 30, Yodo: 13, Joshin: 30 },
          items: resolvedOrderRows.map(o => ({
            id: o.id,
            tenSanPham: o.product_name,
            cuaHang: o.shop || o.warehouse,
            shopId: normalizeCategoryId(o.shop_id),
            ngayMua: o.date,
            ngayMuaDisplay: o.date,
            taiKhoan: o.account || o.note || o.warehouse || '',
            accountId: normalizeCategoryId(o.account_id) || normalizeCategoryId(o.account),
            price: Math.round(Number(o.unit_price || 0)),
            quantity: Number(o.quantity || 1)
          }))
        });
      }

      // ==========================================
      // TAB 7: CHIA TIỀN NHÓM & DU LỊCH (SPLIT BILL)
      // ==========================================
      case 'getSplitFamilies': {
        const rows = await sql`
          SELECT id, family_id, family_name, member_id, member_name, member_type, weight, is_me, is_rep, sort_order
          FROM split_families
          ORDER BY sort_order ASC, id ASC
        `;
        const famMap = {};
        const rawMembers = rows.map(r => ({
          family_id: r.family_id,
          family_name: r.family_name,
          member_id: r.member_id,
          member_name: r.member_name,
          member_type: r.member_type,
          weight: Number(r.weight || 1),
          isMe: Boolean(r.is_me),
          isRep: Boolean(r.is_rep),
          sortOrder: Number(r.sort_order || 0)
        }));

        rows.forEach(r => {
          const fId = r.family_id || 'FAM-1';
          if (!famMap[fId]) {
            famMap[fId] = {
              family_id: fId,
              family_name: r.family_name || 'Gia đình',
              isMe: Boolean(r.is_me),
              members: []
            };
          }
          famMap[fId].members.push({
            member_id: r.member_id,
            member_name: r.member_name,
            member_type: r.member_type,
            weight: Number(r.weight || 1),
            isRep: Boolean(r.is_rep)
          });
        });

        return res.status(200).json({
          success: true,
          families: Object.values(famMap),
          rawMembers: rawMembers
        });
      }

      case 'saveSplitFamilyBatch': {
        const payload = args[0] || {};
        const famName = String(payload.familyName || '').trim();
        const famId = String(payload.familyId || ('FAM-' + (famName ? famName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : Date.now()))).trim();
        const members = Array.isArray(payload.members) ? payload.members : [];
        const isMe = Boolean(payload.isMe || payload.isme);

        await sql`DELETE FROM split_families WHERE family_id = ${famId} OR LOWER(family_name) = ${famName.toLowerCase()}`;

        for (let i = 0; i < members.length; i++) {
          const m = members[i];
          const mId = String(m.memberId || m.member_id || ('MEB-' + Date.now() + i)).trim();
          const mName = String(m.name || m.memberName || m.member_name || '').trim();
          if (!mName) continue;
          const mType = String(m.type || m.memberType || 'ADULT').toUpperCase();
          const w = Number(m.weight) || (mType === 'CHILD' ? 0.5 : (mType === 'BABY' ? 0 : 1.0));
          const isRep = Boolean(m.isRep || m.is_rep || i === 0);
          const rowId = famId + '_' + mId;

          await sql`
            INSERT INTO split_families (id, family_id, family_name, member_id, member_name, member_type, weight, is_me, is_rep, sort_order)
            VALUES (${rowId}, ${famId}, ${famName}, ${mId}, ${mName}, ${mType}, ${w}, ${isMe}, ${isRep}, ${i})
          `;
        }

        return res.status(200).json({ success: true, message: 'Đã lưu thiết lập gia đình thành công!' });
      }

      case 'deleteSplitFamilyEntirely': {
        const famName = String(args[0] || '').trim();
        if (famName) {
          await sql`DELETE FROM split_families WHERE LOWER(family_name) = ${famName.toLowerCase()} OR family_id = ${famName}`;
        }
        return res.status(200).json({ success: true, message: 'Đã xóa nhóm gia đình!' });
      }

      case 'getSplitGroups': {
        const rows = await sql`
          SELECT id, name, category, currency, status, created_at, note, members
          FROM split_groups
          ORDER BY created_at DESC, id DESC
        `;
        const groups = rows.map(r => ({
          id: r.id,
          name: r.name,
          category: r.category || 'TRIP',
          currency: r.currency || 'JPY',
          status: r.status || 'OPEN',
          created_at: r.created_at || '',
          note: r.note || '',
          members: Array.isArray(r.members) ? r.members : []
        }));
        return res.status(200).json({ success: true, groups: groups });
      }

      case 'saveSplitGroup': {
        const g = args[0] || {};
        const gId = String(g.id || ('GRP-' + Date.now())).trim();
        const gName = String(g.name || 'Chuyến đi mới').trim();
        const cat = String(g.category || g.groupType || 'TRIP').toUpperCase();
        const curr = String(g.currency || 'JPY').trim();
        const st = String(g.status || 'OPEN').toUpperCase();
        const dt = String(g.created_at || g.createdAt || new Date().toISOString().slice(0, 10));
        const note = String(g.note || '');
        const membersJson = JSON.stringify(g.members || []);

        await sql`
          INSERT INTO split_groups (id, name, category, currency, status, created_at, note, members)
          VALUES (${gId}, ${gName}, ${cat}, ${curr}, ${st}, ${dt}, ${note}, ${membersJson}::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            currency = EXCLUDED.currency,
            status = EXCLUDED.status,
            created_at = EXCLUDED.created_at,
            note = EXCLUDED.note,
            members = EXCLUDED.members,
            updated_at = CURRENT_TIMESTAMP
        `;
        const savedGroup = {
          id: gId,
          name: gName,
          category: cat,
          currency: curr,
          status: st,
          created_at: dt,
          note: note,
          members: Array.isArray(g.members) ? g.members : []
        };
        return res.status(200).json({ success: true, groupId: gId, group: savedGroup, message: 'Đã lưu chuyến đi thành công!' });
      }

      case 'reopenSplitGroup': {
        const gId = String(args[0] || '').trim();
        if (gId) {
          await sql`UPDATE split_groups SET status = 'OPEN', updated_at = CURRENT_TIMESTAMP WHERE id = ${gId}`;
          return res.status(200).json({ success: true, message: 'Đã mở lại chuyến đi!' });
        }
        return res.status(200).json({ success: false, message: 'Mã nhóm không hợp lệ' });
      }

      case 'finalizeTripAndExportDebts': {
        const gId = String(args[0] || '').trim();
        if (gId) {
          await sql`UPDATE split_groups SET status = 'FINALIZED', updated_at = CURRENT_TIMESTAMP WHERE id = ${gId}`;
          return res.status(200).json({ success: true, message: 'Đã chốt công nợ chuyến đi thành công!' });
        }
        return res.status(200).json({ success: false, message: 'Mã nhóm không hợp lệ' });
      }

      case 'deleteSplitGroup': {
        const gId = String(args[0] || '').trim();
        if (gId) {
          await sql`DELETE FROM split_groups WHERE id = ${gId}`;
          await sql`DELETE FROM split_expenses WHERE group_id = ${gId}`;
        }
        return res.status(200).json({ success: true, message: 'Đã xóa nhóm chia tiền thành công!' });
      }

      case 'getSplitExpenses': {
        const gId = String(args[0] || '').trim();
        const [rows, splitWallets] = await Promise.all([
          gId
            ? sql`
                SELECT id, group_id, date, description, amount, payer_id, payer_name, wallet_id, wallet_name, split_type, round_unit, status, participants, settlements
                FROM split_expenses
                WHERE group_id = ${gId} AND status != 'DELETED'
                ORDER BY date DESC, id DESC
              `
            : sql`
                SELECT id, group_id, date, description, amount, payer_id, payer_name, wallet_id, wallet_name, split_type, round_unit, status, participants, settlements
                FROM split_expenses
                WHERE status != 'DELETED'
                ORDER BY date DESC, id DESC
              `,
          sql`SELECT id, name FROM wallets`.catch(() => [])
        ]);
        const splitWById = buildWalletByIdMap(splitWallets);
        const expenses = rows.map(r => {
          const wObj = r.wallet_id ? splitWById.get(String(r.wallet_id).trim()) : null;
          return {
            id: r.id,
            groupId: r.group_id,
            date: r.date,
            description: r.description,
            amount: Number(r.amount || 0),
            payerId: r.payer_id,
            payerName: r.payer_name,
            walletId: r.wallet_id || '',
            walletName: wObj ? wObj.name : r.wallet_name,
            splitType: r.split_type,
            roundUnit: Number(r.round_unit || 1),
            status: r.status,
            participants: Array.isArray(r.participants) ? r.participants : [],
            settlements: Array.isArray(r.settlements) ? r.settlements : []
          };
        });
        return res.status(200).json({ success: true, expenses: expenses });
      }

      case 'saveSplitExpense': {
        const exp = args[0] || {};
        const expId = String(exp.id || ('EXP-' + Date.now())).trim();
        const gId = String(exp.groupId || exp.group_id || '').trim();
        const dt = String(exp.date || new Date().toISOString().slice(0, 10));
        const desc = String(exp.description || '').trim();
        const amt = Number(exp.amount || 0);
        const payerId = String(exp.payerId || exp.payer_id || '').trim();
        const payerName = String(exp.payerName || exp.payer_name || exp.payerFamily || exp.payer_family || '').trim();
        const rawWId = String(exp.walletId || exp.wallet_id || '').trim();
        const rawWName = String(exp.walletName || exp.wallet_name || '').trim();
        const matchedSplitW = (rawWId || rawWName)
          ? await findWalletByOrderName(sql, { walletId: rawWId, walletName: rawWName })
          : null;
        const wId = matchedSplitW ? String(matchedSplitW.id) : rawWId;
        const wName = matchedSplitW ? String(matchedSplitW.name) : rawWName;
        const sType = String(exp.splitType || exp.split_type || 'WEIGHT').toUpperCase();
        const rUnit = Number(exp.roundUnit || exp.round_unit || 1);
        const st = String(exp.status || 'ACTIVE').toUpperCase();
        const partsJson = JSON.stringify(exp.participants || []);
        const stlJson = JSON.stringify(exp.settlements || []);

        await sql`
          INSERT INTO split_expenses (id, group_id, date, description, amount, payer_id, payer_name, wallet_id, wallet_name, split_type, round_unit, status, participants, settlements)
          VALUES (${expId}, ${gId}, ${dt}, ${desc}, ${amt}, ${payerId}, ${payerName}, ${wId}, ${wName}, ${sType}, ${rUnit}, ${st}, ${partsJson}::jsonb, ${stlJson}::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            group_id = EXCLUDED.group_id,
            date = EXCLUDED.date,
            description = EXCLUDED.description,
            amount = EXCLUDED.amount,
            payer_id = EXCLUDED.payer_id,
            payer_name = EXCLUDED.payer_name,
            wallet_id = EXCLUDED.wallet_id,
            wallet_name = EXCLUDED.wallet_name,
            split_type = EXCLUDED.split_type,
            round_unit = EXCLUDED.round_unit,
            status = EXCLUDED.status,
            participants = EXCLUDED.participants,
            settlements = EXCLUDED.settlements
        `;
        return res.status(200).json({ success: true, expenseId: expId, message: 'Đã lưu chi phí thành công!' });
      }

      case 'deleteSplitExpense': {
        const expId = String(args[0] || '').trim();
        if (expId) {
          await sql`DELETE FROM split_expenses WHERE id = ${expId}`;
        }
        return res.status(200).json({ success: true, message: 'Đã xóa chi phí!' });
      }

      case 'getTab7FullGroupData': {
        const gId = String(args[0] || '').trim();
        const [grpRows, splitWallets] = await Promise.all([
          sql`SELECT * FROM split_groups WHERE id = ${gId}`,
          sql`SELECT id, name FROM wallets`.catch(() => [])
        ]);
        const splitWById = buildWalletByIdMap(splitWallets);
        const grp = grpRows[0] || null;
        let expenses = [];
        if (gId) {
          const expRows = await sql`
            SELECT * FROM split_expenses WHERE group_id = ${gId} AND status != 'DELETED' ORDER BY date DESC, id DESC
          `;
          expenses = expRows.map(r => {
            const wObj = r.wallet_id ? splitWById.get(String(r.wallet_id).trim()) : null;
            return {
              id: r.id,
              groupId: r.group_id,
              date: r.date,
              description: r.description,
              amount: Number(r.amount || 0),
              payerId: r.payer_id,
              payerName: r.payer_name,
              walletId: r.wallet_id || '',
              walletName: wObj ? wObj.name : r.wallet_name,
              splitType: r.split_type,
              roundUnit: Number(r.round_unit || 1),
              status: r.status,
              participants: Array.isArray(r.participants) ? r.participants : [],
              settlements: Array.isArray(r.settlements) ? r.settlements : []
            };
          });
        }
        return res.status(200).json({
          success: true,
          group: grp,
          expenses: expenses
        });
      }

      // ==========================================
      // TAB 8: NHU YẾU PHẨM & ĐỒ DÙNG (SUPPLIES)
      // ==========================================
      case 'getSuppliesData': {
        const rows = await sql`
          SELECT id, name, category, current_qty, min_qty, sort_order
          FROM supplies
          ORDER BY sort_order ASC, id ASC
        `;
        const supplies = rows.map((r) => ({
          rowIndex: r.id,
          id: r.id,
          name: r.name,
          group: r.category || 'Khác',
          current: Number(r.current_qty || 0),
          min: Number(r.min_qty || 0)
        }));
        return res.status(200).json(supplies);
      }

      case 'updateSupplyQuantity': {
        const rowIndex = parseInt(args[0], 10);
        const delta = Number(args[1] || 0);
        if (!isNaN(rowIndex)) {
          const rows = await sql`
            UPDATE supplies
            SET current_qty = GREATEST(0, current_qty + ${delta}), updated_at = CURRENT_TIMESTAMP
            WHERE id = ${rowIndex}
            RETURNING current_qty
          `;
          const newVal = rows[0] ? Number(rows[0].current_qty) : 0;
          return res.status(200).json({ success: true, newVal: newVal });
        }
        return res.status(200).json({ success: false, message: 'Dòng không hợp lệ' });
      }

      case 'addSupplyItem': {
        const arg0 = args[0];
        const isObj = (arg0 && typeof arg0 === 'object');
        const name = String(isObj ? (arg0.name || '') : (args[0] || '')).trim();
        const group = String(isObj ? (arg0.group || arg0.category || 'Khác') : (args[1] || 'Khác')).trim();
        const current = Number(isObj ? (arg0.stock || arg0.current || arg0.current_qty || 0) : (args[2] || 0));
        const min = Number(isObj ? (arg0.min || arg0.min_qty || 0) : (args[3] || 0));
        if (name) {
          const inserted = await sql`
            INSERT INTO supplies (name, category, current_qty, min_qty)
            VALUES (${name}, ${group}, ${current}, ${min})
            RETURNING id, name
          `;
          return res.status(200).json({ success: true, id: inserted[0]?.id, message: 'Đã thêm đồ dùng thành công!' });
        }
        return res.status(200).json({ success: false, message: 'Tên đồ dùng không được để trống!' });
      }

      case 'reorderSuppliesSheet': {
        const newOrderedList = args[0] || [];
        if (Array.isArray(newOrderedList) && newOrderedList.length > 0) {
          for (let i = 0; i < newOrderedList.length; i++) {
            const it = newOrderedList[i];
            const rId = parseInt(it.rowIndex || it.id, 10);
            if (!isNaN(rId)) {
              await sql`UPDATE supplies SET sort_order = ${i} WHERE id = ${rId}`.catch(() => {});
            } else if (it.name) {
              await sql`UPDATE supplies SET sort_order = ${i} WHERE name = ${String(it.name).trim()}`.catch(() => {});
            }
          }
        }
        return res.status(200).json({ success: true, message: 'Đã cập nhật thứ tự đồ dùng!' });
      }

      case 'deleteSupplyItem': {
        const rowIndex = parseInt(args[0], 10);
        if (!isNaN(rowIndex)) {
          await sql`DELETE FROM supplies WHERE id = ${rowIndex}`;
          return res.status(200).json({ success: true, message: 'Đã xóa đồ dùng!' });
        }
        return res.status(200).json({ success: false, message: 'ID không hợp lệ' });
      }

      case 'updateSupplyItemDetails': {
        const arg0 = args[0];
        const isObj = (arg0 && typeof arg0 === 'object');
        const rowIndex = parseInt(isObj ? (arg0.rowIndex || arg0.id) : args[0], 10);
        const name = String(isObj ? (arg0.name || '') : (args[1] || '')).trim();
        const group = String(isObj ? (arg0.group || arg0.category || 'Khác') : (args[2] || 'Khác')).trim();
        const current = Number(isObj ? (arg0.stock || arg0.current || arg0.current_qty || 0) : (args[3] || 0));
        const min = Number(isObj ? (arg0.min || arg0.min_qty || 0) : (args[4] || 0));
        if (!isNaN(rowIndex) && name) {
          await sql`
            UPDATE supplies
            SET name = ${name}, category = ${group}, current_qty = ${current}, min_qty = ${min}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ${rowIndex}
          `;
          return res.status(200).json({ success: true, message: 'Đã cập nhật đồ dùng!' });
        }
        return res.status(200).json({ success: false, message: 'Dữ liệu không hợp lệ' });
      }

      case 'getExistingCategories': {
        const rows = await sql`SELECT DISTINCT category FROM supplies WHERE category != '' ORDER BY category ASC`;
        return res.status(200).json(rows.map(r => r.category));
      }

      case 'exportFullDatabase': {
        if (!session) {
          return res.status(401).json({ success: false, message: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại!' });
        }

        const safeQuery = async (fn) => {
          try { return await fn(); } catch (e) { return []; }
        };

        const [
          walletsRows,
          ordersRows,
          salesRows,
          familyRows,
          debtRows,
          ledgerRows,
          transferRows,
          catRows,
          tplRows,
          supplyRows,
          jarRows,
          checkpointRows,
          reconRows,
          splitFamRows,
          splitGrpRows,
          splitExpRows,
          tempTxRows,
          cardSecRows,
          userRows,
          masterUserRows
        ] = await Promise.all([
          safeQuery(() => sql`SELECT id, name, type, credit_limit, closing_date, due_date, initial_balance, total_increase, total_decrease, preorder, current_balance, settle_source, settle_source_id, debt, status, card_number, card_exp, card_cvv, stmt_file_headers, stmt_paste_headers, is_hidden, is_deleted FROM wallets ORDER BY id ASC`),
          safeQuery(() => sql`SELECT id, date, shop, shop_id, warehouse, warehouse_id, product_name, quantity, unit_price, total_amount, wallet_id, wallet_name, status, note, inventory_remaining, account, account_id, statement_date, cogs, order_status, is_deleted FROM business_orders ORDER BY date DESC, id DESC`),
          safeQuery(() => sql`SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, wallet_id, wallet_name, status, note, cogs, order_status, is_deleted FROM sales_orders ORDER BY date DESC, id DESC`),
          safeQuery(() => sql`SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date FROM family_transactions ORDER BY date DESC, id DESC`),
          safeQuery(() => sql`SELECT id, date, name, partner_id, type, content, amount, wallet_id, wallet_name, note, remaining_debt, status FROM debts ORDER BY date DESC, id DESC`),
          safeQuery(() => sql`SELECT id, wallet_id, wallet_name, transaction_date, amount, direction, effect_type, source_module, order_id, event_type, idempotency_key, status, note, statement_date, checkpoint_ref, balance_after FROM wallet_ledger ORDER BY transaction_date DESC, id DESC`),
          safeQuery(() => sql`SELECT id, transfer_date, order_id, product_name, from_warehouse, from_warehouse_id, to_warehouse, to_warehouse_id, quantity, created_by, note FROM stock_transfers ORDER BY transfer_date DESC, id DESC`),
          safeQuery(() => sql`SELECT id, type, name, is_hidden FROM categories ORDER BY type ASC, id ASC`),
          safeQuery(() => sql`SELECT id, content_template, auto_hu_id, auto_hu_name, auto_wallet_id, auto_wallet_name, is_hidden FROM family_templates ORDER BY id ASC`),
          safeQuery(() => sql`SELECT id, name, category, current_qty, min_qty FROM supplies ORDER BY sort_order ASC, id ASC`),
          safeQuery(() => sql`SELECT year, month, invest_amount, giaoduc_amount, pct_thietyeu, pct_tietkiem, pct_giaoduc, pct_giaitri, pct_chodi, raw_config FROM jar_configs ORDER BY year DESC, month ASC`),
          safeQuery(() => sql`SELECT id, wallet_id, wallet_name, checkpoint_date, checkpoint_balance FROM wallet_checkpoints ORDER BY checkpoint_date DESC, id DESC`),
          safeQuery(() => sql`SELECT batch_id, wallet_id, wallet_name, reconciled_at, reconciled_by, bank_signature, app_tx_id, match_type, status, bank_date, bank_amount, app_date, app_amount, notes FROM bank_reconciliations ORDER BY reconciled_at DESC, id DESC`),
          safeQuery(() => sql`SELECT family_id, family_name, member_id, member_name, member_type, weight, is_me, is_rep FROM split_families ORDER BY sort_order ASC, id ASC`),
          safeQuery(() => sql`SELECT id, name, category, currency, status, created_at, note, members FROM split_groups ORDER BY created_at DESC`),
          safeQuery(() => sql`SELECT id, group_id, date, description, amount, payer_id, payer_name, wallet_id, wallet_name, split_type, round_unit, status, participants, settlements FROM split_expenses ORDER BY date DESC, id DESC`),
          safeQuery(() => sql`SELECT id, wallet_id, wallet_name, date, ymd, amount, type, note, sig, status, target_module, target_id, created_at FROM temp_transactions ORDER BY created_at DESC, id DESC`),
          safeQuery(() => sql`SELECT id, card_name, card_number_masked, card_type, bank_name, statement_date, payment_due_date, created_at FROM card_security ORDER BY id ASC`),
          safeQuery(() => sql`SELECT id, username, display_name, role, created_at FROM users ORDER BY id ASC`),
          safeQuery(() => sql`SELECT id, user_id, username, display_name, database_target, role, status, features, created_at, last_login_at FROM master_users ORDER BY id ASC`)
        ]);

        const toNum = (v) => (v === null || v === undefined || v === '') ? 0 : Number(v);
        const toStr = (v) => (v === null || v === undefined) ? '' : String(v);
        const expCatById = buildCategoryByIdMap(catRows);
        const expWalletById = buildWalletByIdMap(walletsRows);
        const resolveExpCat = (cid, fallback) => {
          const cleanCid = normalizeCategoryId(cid);
          const cleanFb = String(fallback || '').trim();
          const obj = (cleanCid && expCatById.get(cleanCid)) || (cleanFb && expCatById.get(cleanFb)) || null;
          return obj ? toStr(obj.name) : toStr(fallback);
        };
        const resolveExpWallet = (wid, fallback) => {
          const cleanWid = String(wid || '').trim();
          const cleanFb = String(fallback || '').trim();
          const obj = (cleanWid && expWalletById.get(cleanWid)) || (cleanFb && expWalletById.get(cleanFb)) || null;
          return obj ? toStr(obj.name) : toStr(fallback);
        };

        const sheets = {
          Wallets: walletsRows.map(w => ({
            'ID': toStr(w.id),
            'Tên Ví / Thẻ': toStr(w.name),
            'Loại': toStr(w.type),
            'Hạn Mức': toNum(w.credit_limit),
            'Ngày Chốt': toStr(w.closing_date),
            'Hạn Thanh Toán': toStr(w.due_date),
            'Số Dư Ban Đầu': toNum(w.initial_balance),
            'Tổng Tăng': toNum(w.total_increase),
            'Tổng Giảm': toNum(w.total_decrease),
            'Pre-order': toNum(w.preorder),
            'Số Dư / Khả Dụng': toNum(w.current_balance),
            'Nguồn Tất Toán': resolveExpWallet(w.settle_source_id, w.settle_source),
            'Nợ Hiện Tại': toNum(w.debt),
            'Trạng Thái': toStr(w.status),
            'Số Thẻ': toStr(w.card_number),
            'HSD': toStr(w.card_exp),
            'CVV': toStr(w.card_cvv),
            'CSV Headers': toStr(w.stmt_file_headers),
            'Paste Headers': toStr(w.stmt_paste_headers),
            'Ẩn': w.is_hidden ? 'TRUE' : 'FALSE',
            'Đã Xóa': w.is_deleted ? 'TRUE' : 'FALSE'
          })),
          Purchase: ordersRows.map(o => ({
            'ID': toStr(o.id),
            'Ngày Mua': toStr(o.date),
            'Nơi Mua': resolveExpCat(o.shop_id, o.shop),
            'Kho': toStr(o.warehouse_id || o.warehouse),
            'Tên SP': toStr(o.product_name),
            'Số Lượng': toNum(o.quantity),
            'Đơn Giá': toNum(o.unit_price),
            'Thành Tiền': toNum(o.total_amount),
            'Nguồn Tiền': toStr(o.wallet_id || o.wallet_name),
            'Trạng Thái Thẻ': toStr(o.status),
            'Ghi Chú': toStr(o.note),
            'Tồn Kho': toNum(o.inventory_remaining),
            'Tài Khoản': toStr(o.account_id || o.account),
            'Ngày Sao Kê': toStr(o.statement_date),
            'Giá Vốn': toNum(o.cogs),
            'Trạng Thái Đơn': toStr(o.order_status),
            'Đã Xóa': o.is_deleted ? 'TRUE' : 'FALSE'
          })),
          Sales: salesRows.map(s => ({
            'ID': toStr(s.id),
            'Ngày Bán': toStr(s.date),
            'Tên SP': toStr(s.product_name),
            'Kho Trừ': toStr(s.warehouse_id || s.warehouse),
            'Số Lượng': toNum(s.quantity),
            'Giá Bán': toNum(s.unit_price),
            'Tổng Tiền': toNum(s.total_amount),
            'Nhận Tiền': toStr(s.wallet_id || s.wallet_name),
            'Trạng Thái': toStr(s.status),
            'Ghi Chú': toStr(s.note),
            'Giá Vốn (COGS)': toNum(s.cogs),
            'Trạng Thái Đơn': toStr(s.order_status),
            'Đã Xóa': s.is_deleted ? 'TRUE' : 'FALSE'
          })),
          Family: familyRows.map(f => ({
            'ID': toStr(f.id),
            'Ngày': toStr(f.date),
            'Loại': toStr(f.type),
            'Hũ': toStr(f.hu_id || f.hu),
            'Nội Dung': toStr(f.content),
            'Số Tiền': toNum(f.amount),
            'Nguồn Tiền / Ví': toStr(f.wallet_id || f.wallet_name),
            'Cố Định': f.is_fixed ? 'Có' : 'Không',
            'Ghi Chú': toStr(f.note),
            'Trạng Thái': toStr(f.status),
            'Ngày Sao Kê': toStr(f.statement_date)
          })),
          Debt: debtRows.map(d => ({
            'ID': toStr(d.id),
            'Ngày Ghi Nợ': toStr(d.date),
            'Tên Đối Tượng': toStr(d.partner_id || d.name),
            'Loại Nợ': toStr(d.type),
            'Nội Dung': toStr(d.content),
            'Tổng Tiền Nợ': toNum(d.amount),
            'Nguồn': toStr(d.wallet_id || d.wallet_name),
            'Ghi Chú': toStr(d.note),
            'Dư Nợ Còn Lại': toNum(d.remaining_debt),
            'Trạng Thái': toStr(d.status)
          })),
          WalletLedger: ledgerRows.map(l => ({
            'ID': toStr(l.id),
            'Wallet ID': toStr(l.wallet_id),
            'Tên Ví': resolveExpWallet(l.wallet_id, l.wallet_name),
            'Ngày GD': toStr(l.transaction_date),
            'Số Tiền': toNum(l.amount),
            'Hướng': toStr(l.direction),
            'Loại Tác Động': toStr(l.effect_type),
            'Nguồn Module': toStr(l.source_module),
            'Mã Đơn': toStr(l.order_id),
            'Loại Sự Kiện': toStr(l.event_type),
            'Idempotency Key': toStr(l.idempotency_key),
            'Trạng Thái': toStr(l.status),
            'Ghi Chú': toStr(l.note),
            'Ngày Sao Kê': toStr(l.statement_date),
            'Checkpoint Ref': toStr(l.checkpoint_ref),
            'Số Dư Sau': toNum(l.balance_after)
          })),
          STOCK_TRANSFER: transferRows.map(t => ({
            'ID': toStr(t.id),
            'Ngày Chuyển': toStr(t.transfer_date),
            'Mã Đơn': toStr(t.order_id),
            'Tên SP': toStr(t.product_name),
            'Từ Kho': toStr(t.from_warehouse_id || t.from_warehouse),
            'Đến Kho': toStr(t.to_warehouse_id || t.to_warehouse),
            'Số Lượng': toNum(t.quantity),
            'Người Tạo': toStr(t.created_by),
            'Ghi Chú': toStr(t.note)
          })),
          Categories: catRows.map(c => {
            const m = mapCategoryRowWithRefs(c, expCatById, expWalletById);
            return {
              'ID': toStr(c.id),
              'Loại': m.typeLabel || toStr(c.type),
              'Tên chi tiết': toStr(c.name),
              'Ẩn': c.is_hidden ? 'TRUE' : 'FALSE'
            };
          }),
          Templates: (tplRows || []).map(t => {
            const m = mapCategoryRowWithRefs({ ...t, type: 'TEMPLATE', name: t.content_template }, expCatById, expWalletById);
            return {
              'ID': toStr(t.id),
              'Mẫu Nội Dung Thu Chi': toStr(m.contentTemplate || t.content_template),
              'Tự động Map Hũ': toStr(m.autoHuName),
              'Tự động Map Nguồn': toStr(m.autoWalletName),
              'Ẩn': t.is_hidden ? 'TRUE' : 'FALSE'
            };
          }),
          Supplies: supplyRows.map(s => ({
            'ID': toNum(s.id),
            'Tên Món': toStr(s.name),
            'Phân Loại': toStr(s.category),
            'SL Hiện Tại': toNum(s.current_qty),
            'Mức Tối Thiểu': toNum(s.min_qty)
          })),
          JAR: (() => {
            const huCatsActive = (catRows || []).filter(c => ALL_HU_TYPES.includes(String(c.type || '').toUpperCase()) && !c.is_hidden);
            const expenseHuCats = huCatsActive.filter(c => !SYSTEM_JARS.some(sj => normalizeTextNoAccents(sj) === normalizeTextNoAccents(c.name)));
            const jarNames = expenseHuCats.length > 0 ? expenseHuCats.map(c => c.name) : DEFAULT_EXPENSE_JARS;
            const jarCatByNameLow = new Map(huCatsActive.map(c => [normalizeTextNoAccents(c.name), c]));
            const yearsSet = new Set(jarRows.map(j => Number(j.year)).filter(Boolean));
            if (yearsSet.size === 0) yearsSet.add(new Date().getFullYear());
            const out = [];
            Array.from(yearsSet).sort((a, b) => b - a).forEach(yr => {
              const summary = computeJarSummaryHelper({
                familyRows: familyRows,
                jarConfigs: jarRows,
                jarNames,
                jarCatByNameLow,
                allCatByIdMap: expCatById,
                targetMonth: null,
                targetYear: yr,
                isAllMonth: true,
                isAllYear: false
              });
              const carryByName = new Map(summary.jars.map(j => [j.name, j.carry]));
              jarNames.forEach(name => {
                const jCat = jarCatByNameLow.get(normalizeTextNoAccents(name));
                const norm = normalizeTextNoAccents(name);
                const row = {
                  'ID': jCat ? toStr(jCat.id) : '',
                  'Tên hũ': toStr(name),
                  'Năm': yr
                };
                for (let m = 1; m <= 12; m++) {
                  const cfg = resolveJarConfigForMonthHelper(jarRows, yr, m);
                  row[`Tháng ${m}`] = norm === 'dau tu' ? cfg.investAmount : getJarPctByNameHelper(cfg, norm);
                }
                row['Tồn lũy kế'] = carryByName.get(name) || 0;
                out.push(row);
              });
            });
            return out;
          })(),
          JarConfigs: jarRows.map(j => ({
            'Năm': toNum(j.year),
            'Tháng': toNum(j.month),
            'Đầu Tư': toNum(j.invest_amount),
            'Thiết Yếu (%)': toNum(j.pct_thietyeu),
            'Tiết Kiệm (%)': toNum(j.pct_tietkiem),
            'Giáo Dục (%)': toNum(j.pct_giaoduc),
            'Giải Trí (%)': toNum(j.pct_giaitri),
            'Cho Đi (%)': toNum(j.pct_chodi)
          })),
          WalletCheckpoints: checkpointRows.map(cp => ({
            'ID': toNum(cp.id),
            'Tên Ví': resolveExpWallet(cp.wallet_id, cp.wallet_name),
            'Ngày Chốt': toStr(cp.checkpoint_date),
            'Số Dư Chốt': toNum(cp.checkpoint_balance)
          })),
          BankReconciliations: reconRows.map(r => ({
            'Batch ID': toStr(r.batch_id),
            'Tên Ví': resolveExpWallet(r.wallet_id, r.wallet_name),
            'Ngày ĐS': toStr(r.reconciled_at),
            'Người ĐS': toStr(r.reconciled_by),
            'Chữ Ký NH': toStr(r.bank_signature),
            'App Tx ID': toStr(r.app_tx_id),
            'Kiểu Khớp': toStr(r.match_type),
            'Trạng Thái': toStr(r.status),
            'Ngày NH': toStr(r.bank_date),
            'Tiền NH': toNum(r.bank_amount),
            'Ngày App': toStr(r.app_date),
            'Tiền App': toNum(r.app_amount),
            'Ghi Chú': toStr(r.notes)
          })),
          SplitFamilies: splitFamRows.map(sf => ({
            'Family ID': toStr(sf.family_id),
            'Tên Gia Đình': toStr(sf.family_name),
            'Member ID': toStr(sf.member_id),
            'Thành Viên': toStr(sf.member_name),
            'Loại': toStr(sf.member_type),
            'Hệ Số': toNum(sf.weight),
            'Là Tôi': sf.is_me ? 'TRUE' : 'FALSE',
            'Đại Diện': sf.is_rep ? 'TRUE' : 'FALSE'
          })),
          SplitGroups: splitGrpRows.map(sg => ({
            'ID': toStr(sg.id),
            'Tên Nhóm': toStr(sg.name),
            'Phân Loại': toStr(sg.category),
            'Tiền Tệ': toStr(sg.currency),
            'Trạng Thái': toStr(sg.status),
            'Ngày Tạo': toStr(sg.created_at),
            'Ghi Chú': toStr(sg.note),
            'Thành Viên (JSON)': typeof sg.members === 'string' ? sg.members : JSON.stringify(sg.members || [])
          })),
          SplitExpenses: splitExpRows.map(se => ({
            'ID': toStr(se.id),
            'Group ID': toStr(se.group_id),
            'Ngày': toStr(se.date),
            'Nội Dung': toStr(se.description),
            'Số Tiền': toNum(se.amount),
            'Payer ID': toStr(se.payer_id),
            'Người Trả': toStr(se.payer_name),
            'Ví': resolveExpWallet(se.wallet_id, se.wallet_name),
            'Kiểu Chia': toStr(se.split_type),
            'Làm Tròn': toNum(se.round_unit),
            'Trạng Thái': toStr(se.status),
            'Người Tham Gia (JSON)': typeof se.participants === 'string' ? se.participants : JSON.stringify(se.participants || []),
            'Thanh Toán (JSON)': typeof se.settlements === 'string' ? se.settlements : JSON.stringify(se.settlements || [])
          })),
          TempTransactions: tempTxRows.map(t => ({
            'ID': toStr(t.id),
            'Ví': resolveExpWallet(t.wallet_id, t.wallet_name),
            'Ngày': toStr(t.date),
            'YMD': toStr(t.ymd),
            'Số Tiền': toNum(t.amount),
            'Loại': toStr(t.type),
            'Nội Dung': toStr(t.note),
            'Chữ Ký': toStr(t.sig),
            'Trạng Thái': toStr(t.status),
            'Module Đích': toStr(t.target_module),
            'ID Đích': toStr(t.target_id),
            'Ngày Tạo': toStr(t.created_at)
          })),
          CardSecurity: cardSecRows.map(c => ({
            'ID': toNum(c.id),
            'Tên Thẻ': toStr(c.card_name),
            'Số Thẻ (Che)': toStr(c.card_number_masked),
            'Loại Thẻ': toStr(c.card_type),
            'Ngân Hàng': toStr(c.bank_name),
            'Ngày Chốt': toNum(c.statement_date),
            'Ngày Thanh Toán': toNum(c.payment_due_date),
            'Ngày Tạo': toStr(c.created_at)
          })),
          Users: userRows.map(u => ({
            'ID': toNum(u.id),
            'Username': toStr(u.username),
            'Tên Hiển Thị': toStr(u.display_name),
            'Vai Trò': toStr(u.role),
            'Ngày Tạo': toStr(u.created_at)
          })),
          ...(masterUserRows.length > 0 ? {
            MasterUsers: masterUserRows.map(mu => ({
              'ID': toNum(mu.id),
              'User ID': toStr(mu.user_id),
              'Username': toStr(mu.username),
              'Tên Hiển Thị': toStr(mu.display_name),
              'Database': toStr(mu.database_target),
              'Vai Trò': toStr(mu.role),
              'Trạng Thái': toStr(mu.status),
              'Features': typeof mu.features === 'string' ? mu.features : JSON.stringify(mu.features || {}),
              'Ngày Tạo': toStr(mu.created_at),
              'Đăng Nhập Cuối': toStr(mu.last_login_at)
            }))
          } : {})
        };

        return res.status(200).json({
          success: true,
          tenant: isKian ? 'kian' : 'stien',
          exportedAt: new Date().toISOString(),
          sheets
        });
      }

      // 29. ĐỐI SOÁT SAO KÊ NGÂN HÀNG / THẺ TÍN DỤNG
      case 'reconcileBankStatement': {
        const payload = (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) ? args[0] : {
          walletName: args[0],
          entries: args[1],
          rawText: args[2],
          statementClosingBalance: args[3]
        };
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        if (!w) {
          return res.status(200).json({
            success: false,
            message: `Không tìm thấy ví "${wName || wId}" trong hệ thống!`
          });
        }

        const resolvedId = String(w.id).trim();
        const resolvedName = String(w.name).trim();
        const wIdLow = resolvedId.toLowerCase();
        const wNameLow = resolvedName.toLowerCase();

        const rawEntriesList = Array.isArray(payload.bankEntries)
          ? payload.bankEntries
          : (Array.isArray(payload.entries) ? payload.entries : null);
        const rawEntries = (rawEntriesList && rawEntriesList.length > 0)
          ? rawEntriesList
          : parseBankStatementRawFallback(payload.rawText || '');

        const occMap = new Map();
        const parsedBankEntries = (rawEntries || []).map((e, idx) => {
          const ymd = normalizeDateToYMD(e.ymd || e.date);
          const fmtDate = formatYMDToDDMMYYYY(ymd) || String(e.date || '');
          const amt = Math.round(Math.abs(Number(e.amount || 0)));
          const type = e.type === '+' ? '+' : '-';
          const note = String(e.note || '').trim();
          const bal = (e.balance !== undefined && e.balance !== null && String(e.balance).trim() !== '' && !isNaN(Number(e.balance)))
            ? Number(e.balance)
            : null;
          const baseSig = `${ymd}|${amt}|${type}|${note.slice(0, 60)}`;
          const occ = occMap.get(baseSig) || 0;
          occMap.set(baseSig, occ + 1);
          const sig = e.sig || (occ === 0 ? baseSig : `${baseSig}#${occ + 1}`);
          return { index: idx, date: fmtDate, ymd, amount: amt, type, note, balance: bal, sig, baseSig, tempId: '' };
        }).filter(b => b.amount > 0);

        // Nạp mốc chốt sao kê gần nhất của ví để tự động loại các dòng trước/tại mốc chốt
        let latestCp = null;
        try {
          const cpRows = await sql`
            SELECT id, checkpoint_date, checkpoint_balance
            FROM wallet_checkpoints
            WHERE LOWER(TRIM(COALESCE(wallet_id, ''))) = ${wIdLow}
               OR (COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${wNameLow})
            ORDER BY id DESC
            LIMIT 1
          `;
          if (cpRows && cpRows.length > 0) latestCp = cpRows[0];
        } catch (e) {}

        const cpYmd = latestCp ? normalizeDateToYMD(latestCp.checkpoint_date) : '';
        const cpBal = (latestCp && latestCp.checkpoint_balance !== null && latestCp.checkpoint_balance !== undefined && !isNaN(Number(latestCp.checkpoint_balance)))
          ? Number(latestCp.checkpoint_balance)
          : null;

        let bankEntries = parsedBankEntries;
        let skippedBeforeCheckpointCount = 0;
        if (cpYmd && parsedBankEntries.length > 0) {
          const datedEntries = parsedBankEntries.filter(b => Boolean(b.ymd));
          const isDescending = datedEntries.length >= 2
            ? (datedEntries[0].ymd > datedEntries[datedEntries.length - 1].ymd)
            : false;

          let anchorIdx = -1;
          if (cpBal !== null) {
            anchorIdx = parsedBankEntries.findIndex(b =>
              b.ymd === cpYmd && b.balance !== null && Math.round(b.balance) === Math.round(cpBal)
            );
          }

          if (anchorIdx >= 0) {
            bankEntries = parsedBankEntries.filter((_, idx) =>
              isDescending ? (idx < anchorIdx) : (idx > anchorIdx)
            );
          } else {
            bankEntries = parsedBankEntries.filter(b => !b.ymd || b.ymd > cpYmd);
          }
          skippedBeforeCheckpointCount = parsedBankEntries.length - bankEntries.length;
        }

        // Nạp lịch sử đã đối soát của ví từ PostgreSQL
        const recSigCounts = new Map();
        const recNormSigList = [];
        const reconciledAppIds = new Set();
        try {
          const recRows = await sql`
            SELECT id, bank_signature, app_tx_id, bank_date, bank_amount, notes
            FROM bank_reconciliations
            WHERE LOWER(TRIM(COALESCE(wallet_id, ''))) = ${wIdLow}
               OR (COALESCE(TRIM(wallet_id), '') = '' AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${wNameLow})
          `;
          for (const r of recRows) {
            const bSig = String(r.bank_signature || '').trim();
            if (bSig) {
              recSigCounts.set(bSig, (recSigCounts.get(bSig) || 0) + 1);
              const p = bSig.split('|');
              if (p.length >= 4) {
                recNormSigList.push({
                  id: r.id,
                  rawSig: bSig,
                  ymd: p[0],
                  amount: Math.round(Math.abs(Number(p[1]) || 0)),
                  type: p[2] === '+' ? '+' : '-',
                  noteClean: normalizeRecNote(p.slice(3).join('|')),
                  appTxId: r.app_tx_id,
                  used: false
                });
              }
            }
            const appIdsRaw = String(r.app_tx_id || '').trim();
            if (appIdsRaw) {
              appIdsRaw.split(',').forEach(part => {
                const pid = part.trim();
                if (pid && !['SKIP_MATCHED', 'CREATE_FROM_TEMP', 'AUTO_SKIP'].includes(pid)) {
                  reconciledAppIds.add(pid);
                }
              });
            }
          }
        } catch (e) {}

        // Phân loại các dòng đã từng khớp trước đó vs chưa khớp (kết hợp nhận diện thông minh)
        const DAY_MS = 86400000;
        const alreadyReconciled = [];
        const unreconciledBank = [];
        for (const b of bankEntries) {
          let consumed = false;
          if ((recSigCounts.get(b.sig) || 0) > 0) {
            recSigCounts.set(b.sig, recSigCounts.get(b.sig) - 1);
            consumed = true;
          } else if (b.baseSig !== b.sig && (recSigCounts.get(b.baseSig) || 0) > 0) {
            recSigCounts.set(b.baseSig, recSigCounts.get(b.baseSig) - 1);
            consumed = true;
          }

          if (!consumed) {
            const foundRec = recNormSigList.find(r => {
              if (r.used) return false;
              if (r.amount !== b.amount) return false;
              if (r.type !== b.type) return false;
              // Khớp chính xác ngày + số tiền + loại (+/-): Tự động nhận là đã đối soát, không cần nội dung khớp!
              if (r.ymd === b.ymd) return true;
              // Lệch 1 ngày do múi giờ JST/UTC nhưng cùng số tiền & loại
              const rTs = parseRecTs(r.ymd);
              const bTs = parseRecTs(b.ymd || b.date);
              if (rTs && bTs && Math.abs(rTs - bTs) <= DAY_MS) return true;
              return false;
            });
            if (foundRec) {
              foundRec.used = true;
              consumed = true;
            }
          }

          if (consumed) {
            alreadyReconciled.push({
              date: b.date,
              ymd: b.ymd,
              amount: b.amount,
              type: b.type,
              note: b.note,
              sig: b.sig
            });
          } else {
            unreconciledBank.push(b);
          }
        }

        // Lấy danh sách giao dịch trên App chưa checkpoint & chưa đối soát
        const fullHistory = await fetchWalletHistoryHelper(sql, w, resolvedName);
        const appItems = (fullHistory || [])
          .filter(h => {
            if (!h.isAfterCp) return false;
            const hid = String(h.id || '').trim();
            const sid = String(h.sourceId || '').trim();
            const hPgId = String(h.paymentGroupId || '').trim();
            if (hid && reconciledAppIds.has(hid)) return false;
            if (sid && reconciledAppIds.has(sid)) return false;
            if (hPgId && reconciledAppIds.has(hPgId)) return false;
            return Math.round(Math.abs(Number(h.amount || 0))) > 0;
          })
          .map(h => {
            const ymd = normalizeDateToYMD(h.date || h.statementDate);
            const stmtYmd = normalizeDateToYMD(h.statementDate || h.date);
            return {
              id: String(h.id || ''),
              date: h.date || formatYMDToDDMMYYYY(ymd),
              ymd: ymd || stmtYmd,
              _ts1: parseRecTs(ymd),
              _ts2: parseRecTs(stmtYmd),
              amount: Math.round(Math.abs(Number(h.amount || 0))),
              type: h.type === '+' ? '+' : '-',
              note: String(h.note || ''),
              module: String(h.module || 'Sổ Cái'),
              isPreorder: Boolean(h.isPreorder),
              paymentGroupId: String(h.paymentGroupId || ''),
              sourceModule: String(h.sourceModule || ''),
              sourceId: String(h.sourceId || ''),
              groupItems: Array.isArray(h.groupItems) ? h.groupItems : null,
              groupSummary: h.groupSummary || null
            };
          });

        // Khớp tự động 1-1: chỉ cần cùng loại (+/-), khớp số tiền (lệch <= 1 yên) và ngày tháng khớp (lệch tối đa 7 ngày), KHÔNG CẦN NỘI DUNG PHẢI KHỚP!
        const candidates = [];
        unreconciledBank.forEach((b, bIdx) => {
          const bTs = parseRecTs(b.ymd || b.date);
          const bNoteClean = normalizeRecNote(b.note);
          appItems.forEach((a, aIdx) => {
            if (b.type !== a.type) return;
            if (Math.abs(b.amount - a.amount) > 1) return;
            let dayDiff = 999;
            if (bTs && a._ts1) dayDiff = Math.min(dayDiff, Math.abs(Math.round((bTs - a._ts1) / DAY_MS)));
            if (bTs && a._ts2) dayDiff = Math.min(dayDiff, Math.abs(Math.round((bTs - a._ts2) / DAY_MS)));
            if (!bTs || (!a._ts1 && !a._ts2)) dayDiff = 0;

            // Cho phép lệch tối đa 7 ngày (hoặc 14 ngày nếu có trùng từ khóa)
            const aNoteClean = normalizeRecNote(a.note);
            const sim = computeRecSimilarity(b.note, a.note);
            const hasSub = (bNoteClean && aNoteClean && (bNoteClean.includes(aNoteClean) || aNoteClean.includes(bNoteClean)));
            const maxDays = (hasSub || sim >= 0.2) ? 14 : 7;
            if (dayDiff > maxDays) return;

            // Điểm số chính tính theo ngày (cùng ngày = 3000 điểm), trùng nội dung chỉ là điểm cộng nhỏ
            const score = (30 - dayDiff) * 100 + (hasSub ? 50 : (sim * 30));
            candidates.push({ bIdx, aIdx, dayDiff, score });
          });
        });
        candidates.sort((x, y) => y.score - x.score);

        const matchedBankIdx = new Set();
        const matchedAppIdx = new Set();
        const matched = [];
        for (const c of candidates) {
          if (matchedBankIdx.has(c.bIdx) || matchedAppIdx.has(c.aIdx)) continue;
          matchedBankIdx.add(c.bIdx);
          matchedAppIdx.add(c.aIdx);
          const b = unreconciledBank[c.bIdx];
          const a = appItems[c.aIdx];
          matched.push({
            matchType: c.dayDiff === 0 ? 'EXACT' : 'FUZZY_DATE',
            status: 'MATCHED',
            bank: { date: b.date, ymd: b.ymd, amount: b.amount, type: b.type, note: b.note, sig: b.sig },
            app: {
              id: a.id,
              date: a.date,
              ymd: a.ymd,
              amount: a.amount,
              type: a.type,
              note: a.note,
              module: a.module,
              isPreorder: a.isPreorder,
              paymentGroupId: a.paymentGroupId || '',
              sourceModule: a.sourceModule || '',
              sourceId: a.sourceId || '',
              groupItems: a.groupItems || null,
              groupSummary: a.groupSummary || null
            }
          });
        }

        const rawMissingInApp = unreconciledBank.filter((_, idx) => !matchedBankIdx.has(idx));

        // Tự động triệt tiêu các cặp mua hàng (-) và hoàn tiền (+) cùng số tiền & cùng nội dung trong vòng 14 ngày
        const offsetCandidates = [];
        for (let i = 0; i < rawMissingInApp.length; i++) {
          const outTx = rawMissingInApp[i];
          if (outTx.type !== '-') continue;
          const outTs = parseRecTs(outTx.ymd || outTx.date);
          for (let j = 0; j < rawMissingInApp.length; j++) {
            if (i === j) continue;
            const inTx = rawMissingInApp[j];
            if (inTx.type !== '+') continue;
            if (outTx.amount !== inTx.amount) continue;
            const inTs = parseRecTs(inTx.ymd || inTx.date);
            const dayDiff = (outTs && inTs) ? Math.abs(Math.round((inTs - outTs) / DAY_MS)) : 0;
            if (dayDiff > 14) continue;
            const sim = computeRecSimilarity(outTx.note, inTx.note);
            if (sim < 0.4) continue;
            offsetCandidates.push({ i, j, dayDiff, score: sim * 100 - dayDiff });
          }
        }
        offsetCandidates.sort((a, b) => b.score - a.score);
        const autoOffsetIdx = new Set();
        let autoOffsetPairsCount = 0;
        for (const c of offsetCandidates) {
          if (autoOffsetIdx.has(c.i) || autoOffsetIdx.has(c.j)) continue;
          autoOffsetIdx.add(c.i);
          autoOffsetIdx.add(c.j);
          autoOffsetPairsCount++;
          [rawMissingInApp[c.i], rawMissingInApp[c.j]].forEach(b => {
            alreadyReconciled.push({
              date: b.date,
              ymd: b.ymd,
              amount: b.amount,
              type: b.type,
              note: `[Hoàn/Huỷ bù trừ] ${b.note}`,
              sig: b.sig
            });
          });
        }
        const missingInAppCandidates = rawMissingInApp.filter((_, idx) => !autoOffsetIdx.has(idx));
        const missingInBank = appItems
          .filter((_, idx) => !matchedAppIdx.has(idx))
          .map(a => ({
            id: a.id,
            date: a.date,
            ymd: a.ymd,
            amount: a.amount,
            type: a.type,
            note: a.note,
            module: a.module,
            isPreorder: a.isPreorder,
            paymentGroupId: a.paymentGroupId || '',
            sourceModule: a.sourceModule || '',
            sourceId: a.sourceId || '',
            groupItems: a.groupItems || null,
            groupSummary: a.groupSummary || null
          }));

        // Lưu các dòng thiếu trên App vào bảng temp_transactions để hỗ trợ Bỏ qua / Tạo giao dịch nhanh
        const tempStatusById = new Map();
        const candidateTempIds = missingInAppCandidates.map(b => 'TMP_' + makeShortHash(`${resolvedId}|${b.sig}`));
        if (candidateTempIds.length > 0) {
          try {
            const existingTemps = await sql`SELECT id, status FROM temp_transactions WHERE id = ANY(${candidateTempIds})`;
            existingTemps.forEach(t => tempStatusById.set(String(t.id), String(t.status || 'PENDING').toUpperCase()));
          } catch (e) {}
        }

        const missingInApp = [];
        for (let i = 0; i < missingInAppCandidates.length; i++) {
          const b = missingInAppCandidates[i];
          const tempId = candidateTempIds[i];
          const curStatus = tempStatusById.get(tempId);
          if (curStatus === 'IGNORED' || curStatus === 'PROCESSED') {
            alreadyReconciled.push({
              date: b.date,
              ymd: b.ymd,
              amount: b.amount,
              type: b.type,
              note: b.note,
              sig: b.sig
            });
            continue;
          }
          if (!curStatus) {
            await sql`
              INSERT INTO temp_transactions (id, wallet_id, wallet_name, date, ymd, amount, type, note, sig, status)
              VALUES (${tempId}, ${resolvedId}, ${resolvedName}, ${b.date}, ${b.ymd}, ${b.amount}, ${b.type}, ${b.note}, ${b.sig}, 'PENDING')
              ON CONFLICT (id) DO NOTHING
            `.catch(() => {});
          }
          missingInApp.push({
            tempId,
            id: tempId,
            date: b.date,
            ymd: b.ymd,
            amount: b.amount,
            type: b.type,
            note: b.note,
            sig: b.sig
          });
        }

        const rawStmtBal = (payload.closingBalance !== undefined && payload.closingBalance !== null && String(payload.closingBalance).trim() !== '')
          ? payload.closingBalance
          : ((payload.bankBalance !== undefined && payload.bankBalance !== null && String(payload.bankBalance).trim() !== '')
            ? payload.bankBalance
            : payload.statementClosingBalance);
        const hasStmtBal = rawStmtBal !== undefined && rawStmtBal !== null && String(rawStmtBal).trim() !== '' && !isNaN(Number(rawStmtBal));
        let stmtBal = hasStmtBal ? Number(rawStmtBal) : null;

        // Nếu frontend không gửi số dư, tự động tìm số dư của dòng sao kê mới nhất trong parsedBankEntries
        if (stmtBal === null && Array.isArray(parsedBankEntries) && parsedBankEntries.length > 0) {
          const entriesWithBal = parsedBankEntries.filter(b => b.balance !== null && !isNaN(b.balance));
          if (entriesWithBal.length > 0) {
            const sortedByDate = [...entriesWithBal].sort((a, b) => {
              const aYmd = a.ymd || '';
              const bYmd = b.ymd || '';
              if (aYmd !== bYmd) return bYmd.localeCompare(aYmd);
              return a.index - b.index;
            });
            stmtBal = sortedByDate[0].balance;
          }
        }

        // Kiểm tra dự phòng nếu số dư vẫn còn dính trong trường note của dòng sao kê
        if (stmtBal === null && Array.isArray(parsedBankEntries) && parsedBankEntries.length > 0) {
          for (const b of parsedBankEntries) {
            if (b.note) {
              const m = b.note.match(/(?:円|¥|￥)?\s*(\d{1,3}(?:[\s,]\d{2,3})+|\d+)\s*(?:円|¥|￥)\s*[-ー―–—\s]*$/i)
                || b.note.match(/(?:^|\s)(?:円|¥|￥)?\s*(\d{1,3}(?:[\s,]\d{3})+|\d+)\s*[-ー―–—\s]*$/i);
              if (m) {
                const bVal = parseFloat(m[1].replace(/[\s,]/g, ''));
                if (!isNaN(bVal) && bVal > 0) {
                  stmtBal = bVal;
                  break;
                }
              }
            }
          }
        }

        // Dự phòng cuối cùng: cộng dồn từ checkpoint cũ
        if (stmtBal === null && cpBal !== null) {
          const isCreditWallet = String(w.type || '').toUpperCase() === 'CREDIT';
          let computedBal = cpBal;
          for (const b of bankEntries) {
            const delta = isCreditWallet
              ? (b.type === '-' ? b.amount : -b.amount)
              : (b.type === '+' ? b.amount : -b.amount);
            computedBal += delta;
          }
          stmtBal = computedBal;
        }

        return res.status(200).json({
          success: true,
          walletId: resolvedId,
          walletName: resolvedName,
          appBalance: Number(w.current_balance || 0),
          bankBalance: stmtBal,
          checkpointInfo: cpYmd ? {
            date: formatYMDToDDMMYYYY(cpYmd),
            ymd: cpYmd,
            balance: cpBal,
            skippedCount: skippedBeforeCheckpointCount
          } : null,
          matched,
          alreadyReconciled,
          missingInApp,
          missingInBank,
          summary: {
            matchedCount: matched.length,
            alreadyReconciledCount: alreadyReconciled.length,
            missingInAppCount: missingInApp.length,
            missingInBankCount: missingInBank.length,
            autoOffsetPairsCount,
            skippedBeforeCheckpointCount,
            totalBankEntries: bankEntries.length,
            totalAppEntries: appItems.length
          }
        });
      }

      case 'confirmReconcileBatch': {
        const payload = args[0] || {};
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const matched = Array.isArray(payload.matched) ? payload.matched : [];
        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        if (!w && !wName) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy ví cần lưu đối soát!' });
        }
        const batchId = String(payload.batchId || ('REC_' + Date.now())).trim();
        const savedCount = await recordReconciledRowsHelper(sql, w, wName, matched, batchId, String(payload.reconciledBy || 'User'));
        const updatedWallets = await fetchActiveWalletsList(sql);
        return res.status(200).json({
          success: true,
          batchId,
          savedCount,
          addedCount: savedCount,
          wallets: updatedWallets,
          updatedWallets,
          message: `Đã lưu ${savedCount} giao dịch vào lịch sử đối soát!`
        });
      }

      case 'unmatchReconciledTransaction': {
        const payload = args[0] || {};
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const appTxId = String(payload.appTxId || '').trim();
        const bankSig = String(payload.bankSignature || '').trim();
        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        const wIdLow = String(w?.id || wId || '').trim().toLowerCase();
        const wNameLow = String(w?.name || wName || '').trim().toLowerCase();
        const useAppId = appTxId && !['SKIP_MATCHED', 'CREATE_FROM_TEMP', 'AUTO_SKIP'].includes(appTxId);

        if (useAppId || bankSig) {
          await sql`
            DELETE FROM bank_reconciliations
            WHERE (
              (${wIdLow === '' && wNameLow === ''})
              OR (${wIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${wIdLow})
              OR (COALESCE(TRIM(wallet_id), '') = '' AND ${wNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${wNameLow})
            )
            AND (
              (${useAppId} AND app_tx_id = ${appTxId})
              OR (${bankSig !== ''} AND bank_signature = ${bankSig})
            )
          `;
          if (bankSig) {
            await sql`
              UPDATE temp_transactions
              SET status = 'PENDING'
              WHERE sig = ${bankSig}
                AND (${wIdLow === ''} OR LOWER(TRIM(COALESCE(wallet_id, ''))) = ${wIdLow} OR LOWER(TRIM(COALESCE(wallet_name, ''))) = ${wNameLow})
            `.catch(() => {});
          }
        }
        return res.status(200).json({ success: true, message: '✅ Đã hủy khớp giao dịch!' });
      }

      case 'rollbackReconcileBatch': {
        const payload = args[0] || {};
        const batchId = String(payload.batchId || args[0] || '').trim();
        if (batchId) {
          await sql`DELETE FROM bank_reconciliations WHERE batch_id = ${batchId}`;
        }
        return res.status(200).json({ success: true, batchId, message: 'Đã hoàn tác đợt đối soát!' });
      }

      case 'manualMatchTransactions': {
        const payload = args[0] || {};
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const bankItems = Array.isArray(payload.bankItems) && payload.bankItems.length > 0
          ? payload.bankItems
          : (payload.bankItem ? [payload.bankItem] : []);
        const appItemIds = Array.isArray(payload.appItemIds) ? payload.appItemIds.map(x => String(x || '').trim()).filter(Boolean) : [];
        const appNotes = Array.isArray(payload.appNotes) ? payload.appNotes : [];

        if (bankItems.length === 0 || appItemIds.length === 0) {
          return res.status(200).json({ success: false, message: 'Thiếu dữ liệu giao dịch để ghép khớp!' });
        }

        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        const batchId = 'MAN_' + Date.now();
        const joinedAppIds = appItemIds.join(',');
        const totalBankAmt = bankItems.reduce((s, b) => s + Math.round(Math.abs(Number(b.amount || 0))), 0);
        const firstBank = bankItems[0] || {};
        const combinedBankNote = bankItems.map(b => `${b.note || 'Sao kê'} (${Math.round(Math.abs(Number(b.amount || 0))).toLocaleString()} ¥)`).join(' + ');
        const combinedAppNote = appNotes.join(' + ');

        const rowsToSave = bankItems.map((b, idx) => ({
          matchType: 'COMBINED',
          status: 'MATCHED',
          bank: {
            date: b.date || '',
            ymd: b.ymd || normalizeDateToYMD(b.date),
            amount: Math.round(Math.abs(Number(b.amount || 0))),
            type: b.type === '+' ? '+' : '-',
            note: b.note || '',
            sig: b.sig || `${normalizeDateToYMD(b.ymd || b.date)}|${Math.round(Math.abs(Number(b.amount || 0)))}|${b.type === '+' ? '+' : '-'}|${String(b.note || '').slice(0, 60)}`
          },
          app: {
            id: idx === 0 ? joinedAppIds : `${joinedAppIds}#${idx + 1}`,
            date: firstBank.date || '',
            amount: totalBankAmt,
            note: combinedAppNote
          },
          notes: `Ghép thủ công: ${combinedAppNote}`
        }));

        await recordReconciledRowsHelper(sql, w, wName, rowsToSave, batchId, 'Manual');

        return res.status(200).json({
          success: true,
          message: '✅ Đã ghép khớp gộp thành công!',
          matched: {
            matchType: 'COMBINED',
            status: 'MATCHED',
            bank: {
              date: firstBank.date || '',
              ymd: firstBank.ymd || normalizeDateToYMD(firstBank.date),
              amount: totalBankAmt,
              type: firstBank.type === '+' ? '+' : '-',
              note: combinedBankNote,
              sig: firstBank.sig || ''
            },
            app: {
              id: joinedAppIds,
              date: firstBank.date || '',
              amount: totalBankAmt,
              type: firstBank.type === '+' ? '+' : '-',
              note: combinedAppNote,
              module: 'Ghép thủ công'
            }
          }
        });
      }

      case 'skipAppTransaction': {
        const payload = args[0] || {};
        const wId = String(payload.walletId || payload.wallet_id || payload.id || '').trim();
        const wName = String(payload.walletName || payload.name || '').trim();
        const appId = String(payload.appId || '').trim();
        if (!appId) {
          return res.status(200).json({ success: false, message: 'Thiếu ID giao dịch App!' });
        }
        const w = (wId || wName) ? await findWalletByOrderName(sql, { walletId: wId, walletName: wName }) : null;
        await recordReconciledRowsHelper(sql, w, wName, [{
          matchType: 'APP_SKIP',
          status: 'MATCHED',
          bank: { date: '', ymd: '', amount: 0, type: '-', note: '(Bỏ qua giao dịch App)', sig: '' },
          app: {
            id: appId,
            date: String(payload.date || ''),
            amount: Math.round(Math.abs(Number(payload.amount || 0))),
            note: String(payload.note || '')
          },
          notes: 'Bỏ qua giao dịch trên App'
        }], 'ASKIP_' + Date.now(), 'User');

        return res.status(200).json({ success: true, message: '✅ Đã bỏ qua giao dịch trên App!' });
      }

      case 'getTempTransactions': {
        const arg0 = args[0];
        const statusFilter = args[1] ? String(args[1]).trim().toUpperCase() : '';
        const wRef = (arg0 && typeof arg0 === 'object') ? arg0 : { walletName: String(arg0 || '') };
        const explicitId = String(args[2] || wRef.walletId || wRef.id || '').trim();
        const wName = String(wRef.walletName || wRef.name || '').trim();
        const w = (explicitId || wName) ? await findWalletByOrderName(sql, { walletId: explicitId, walletName: wName }) : null;
        const wIdLow = String(w?.id || explicitId || '').trim().toLowerCase();
        const wNameLow = String(w?.name || wName || '').trim().toLowerCase();

        let rows = [];
        try {
          rows = await sql`
            SELECT id, wallet_id, wallet_name, date, ymd, amount, type, note, sig, status, target_module, target_id
            FROM temp_transactions
            WHERE (
              (${wIdLow === '' && wNameLow === ''})
              OR (${wIdLow !== ''} AND LOWER(TRIM(COALESCE(wallet_id, ''))) = ${wIdLow})
              OR (COALESCE(TRIM(wallet_id), '') = '' AND ${wNameLow !== ''} AND LOWER(TRIM(COALESCE(wallet_name, ''))) = ${wNameLow})
            )
            AND (${statusFilter === ''} OR UPPER(COALESCE(status, '')) = ${statusFilter})
            ORDER BY created_at DESC, ymd DESC, id ASC
          `;
        } catch (e) {
          rows = [];
        }

        const list = (rows || []).map(r => ({
          id: String(r.id),
          tempId: String(r.id),
          walletId: String(r.wallet_id || ''),
          walletName: String(r.wallet_name || ''),
          date: String(r.date || ''),
          ymd: String(r.ymd || ''),
          amount: Number(r.amount || 0),
          type: String(r.type || '-'),
          note: String(r.note || ''),
          sig: String(r.sig || ''),
          status: String(r.status || 'PENDING'),
          targetModule: String(r.target_module || ''),
          targetId: String(r.target_id || '')
        }));
        return res.status(200).json(list);
      }

      case 'batchIgnoreTempTransactions': {
        const arg0 = args[0];
        const tempIds = Array.isArray(arg0) ? arg0.map(x => String(x || '').trim()).filter(Boolean)
          : (Array.isArray(arg0?.tempIds) ? arg0.tempIds.map(x => String(x || '').trim()).filter(Boolean) : []);
        const extraItems = (!Array.isArray(arg0) && Array.isArray(arg0?.items)) ? arg0.items : [];
        const extraById = new Map(extraItems.map(it => [String(it.tempId || it.id || '').trim(), it]));

        let count = 0;
        if (tempIds.length > 0) {
          let rows = [];
          try {
            rows = await sql`SELECT * FROM temp_transactions WHERE id = ANY(${tempIds})`;
            await sql`UPDATE temp_transactions SET status = 'IGNORED' WHERE id = ANY(${tempIds})`;
          } catch (e) {}

          const rowsById = new Map((rows || []).map(r => [String(r.id), r]));
          const byWallet = new Map();

          for (const tid of tempIds) {
            const r = rowsById.get(tid);
            const ex = extraById.get(tid);
            const wId = String((r && r.wallet_id) || (ex && ex.walletId) || arg0?.walletId || '').trim();
            const wName = String((r && r.wallet_name) || (ex && ex.walletName) || arg0?.walletName || '').trim();
            const key = wId || wName;
            if (!key) continue;
            if (!byWallet.has(key)) byWallet.set(key, { wId, wName, matches: [] });
            const itemDate = (r && r.date) || (ex && ex.date) || '';
            const itemYmd = (r && r.ymd) || (ex && ex.ymd) || normalizeDateToYMD(itemDate);
            const itemAmt = Math.round(Math.abs(Number((r && r.amount) ?? (ex && ex.amount) ?? 0)));
            const itemType = ((r && r.type) || (ex && ex.type)) === '+' ? '+' : '-';
            const itemNote = String((r && r.note) || (ex && ex.note) || '');
            const itemSig = String((r && r.sig) || (ex && ex.sig) || `${itemYmd}|${itemAmt}|${itemType}|${itemNote.slice(0, 60)}`);
            byWallet.get(key).matches.push({
              matchType: 'MANUAL_SKIP',
              status: 'MATCHED',
              bank: { date: itemDate, ymd: itemYmd, amount: itemAmt, type: itemType, note: itemNote, sig: itemSig },
              app: { id: 'SKIP_MATCHED', date: itemDate, amount: itemAmt, note: '(Khớp đối soát - Bỏ qua)' },
              notes: 'Bỏ qua hàng loạt'
            });
            count++;
          }

          for (const grp of byWallet.values()) {
            const w = await findWalletByOrderName(sql, { walletId: grp.wId, walletName: grp.wName });
            await recordReconciledRowsHelper(sql, w, grp.wName, grp.matches, 'BSKIP_' + Date.now(), 'User');
          }
        }
        return res.status(200).json({ success: true, count, message: `Đã bỏ qua ${count} giao dịch!` });
      }

      case 'getSavedJarConfig': {
        const [monthArg, yearArg] = args || [];
        const now = new Date();
        const m = (!monthArg || String(monthArg).toUpperCase() === 'ALL') ? (now.getMonth() + 1) : parseInt(monthArg, 10);
        const y = (!yearArg || String(yearArg).toUpperCase() === 'ALL') ? now.getFullYear() : parseInt(yearArg, 10);
        const [jarConfigs, famRows, catRows] = await Promise.all([
          sql`SELECT year, month, invest_amount, giaoduc_amount, pct_thietyeu, pct_tietkiem, pct_giaoduc, pct_giaitri, pct_chodi, raw_config FROM jar_configs ORDER BY year ASC, month ASC`.catch(() => []),
          sql`SELECT date, type, content, note, hu, hu_id, amount FROM family_transactions`.catch(() => []),
          sql`SELECT id, name, type, is_hidden, initial_balance FROM categories ORDER BY id ASC`.catch(() => [])
        ]);
        const catById = new Map();
        let thuNhapCatId = '';
        (catRows || []).forEach(c => {
          const cid = normalizeCategoryId(c.id);
          if (cid) catById.set(cid, c);
          if (normalizeTextNoAccents(c.name) === 'thu nhap' && cid) thuNhapCatId = cid;
        });
        const slotMap = resolveSixJarSlotMapping(catRows);
        const cfg = resolveJarConfigForMonthHelper(jarConfigs, y, m);
        const pY = m === 1 ? y - 1 : y;
        const pM = m === 1 ? 12 : m - 1;
        let prevMonthIncome = 0;
        (famRows || []).forEach(f => {
          const dt = parseFamilyDateYmHelper(f.date);
          if (!dt || dt.year !== pY || dt.month !== pM) return;
          if (String(f.type || '').trim().toLowerCase() !== 'thu') return;
          const cStr = String(f.content || '');
          const nStr = String(f.note || '');
          if (isExcludedJarFamilyTxHelper(cStr, nStr)) return;
          if (cStr.startsWith('Điều chỉnh Hũ từ ') || nStr.includes('Chuyển hũ (Cộng)')) return;
          const fHuId = normalizeCategoryId(f.hu_id);
          const fHuCat = fHuId ? catById.get(fHuId) : null;
          const resolvedHu = fHuCat ? fHuCat.name : (f.hu || '');
          if (!isIncomeJarCategoryHelper(resolvedHu, fHuId, thuNhapCatId)) return;
          prevMonthIncome += Number(f.amount || 0);
        });
        const initialBalances = {};
        const lockedMap = {};
        slotMap.ordered.forEach(s => {
          const c = s.id ? catById.get(s.id) : null;
          initialBalances[s.key] = Number(c?.initial_balance || 0);
          lockedMap[s.key] = Boolean(c?.is_locked);
        });
        return res.status(200).json({
          success: true,
          data: {
            isKian,
            month: m,
            year: y,
            prevMonthIncome,
            investAmount: cfg.investAmount,
            giaoducAmount: cfg.giaoducAmount || 0,
            percentages: cfg.pct,
            jarLabels: slotMap.labels,
            initialBalances,
            lockedMap,
            lockedJars: lockedMap,
            jarSlots: slotMap.ordered.map(s => {
              const c = s.id ? catById.get(s.id) : null;
              return {
                key: s.key,
                id: s.id || null,
                name: s.name,
                icon: s.icon,
                initial_balance: Number(c?.initial_balance || 0),
                is_locked: Boolean(c?.is_locked)
              };
            })
          }
        });
      }

      case 'saveJarConfig': {
        const cfgData = (args && args[0]) || {};
        const now = new Date();
        const m = (!cfgData.month || String(cfgData.month).toUpperCase() === 'ALL') ? (now.getMonth() + 1) : parseInt(cfgData.month, 10);
        const y = (!cfgData.year || String(cfgData.year).toUpperCase() === 'ALL') ? now.getFullYear() : parseInt(cfgData.year, 10);
        const invest = Number(cfgData.invest ?? 60000);
        const giaoducAmt = Math.max(0, Math.round(Number(cfgData.giaoducAmount ?? cfgData.giaoducFixed ?? 0)));
        const pTy = Number(cfgData.thietyeu || 0);
        const pTk = Number(cfgData.tietkiem || 0);
        const pGd = Number(cfgData.giaoduc || 0);
        const pGt = Number(cfgData.giaitri || 0);
        const pCd = Number(cfgData.chodi || 0);
        if (Math.round(pTy + pTk + pGd + pGt + pCd) !== 100) {
          return res.status(200).json({ success: false, message: 'Tổng tỉ lệ 5 hũ phải đúng 100%!' });
        }
        const existing = await sql`SELECT id FROM jar_configs WHERE month = ${m} AND year = ${y} LIMIT 1`;
        if (existing.length > 0) {
          await sql`
            UPDATE jar_configs
            SET invest_amount = ${invest},
                giaoduc_amount = ${giaoducAmt},
                pct_thietyeu = ${pTy},
                pct_tietkiem = ${pTk},
                pct_giaoduc = ${pGd},
                pct_giaitri = ${pGt},
                pct_chodi = ${pCd},
                updated_at = NOW()
            WHERE id = ${existing[0].id}
          `;
        } else {
          await sql`
            INSERT INTO jar_configs (month, year, invest_amount, giaoduc_amount, pct_thietyeu, pct_tietkiem, pct_giaoduc, pct_giaitri, pct_chodi, updated_at)
            VALUES (${m}, ${y}, ${invest}, ${giaoducAmt}, ${pTy}, ${pTk}, ${pGd}, ${pGt}, ${pCd}, NOW())
          `;
        }

        if (cfgData.initialBalances && typeof cfgData.initialBalances === 'object') {
          const catRows = await sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories WHERE UPPER(type) IN ('HU_CHITIEU', 'HU')`;
          const slotMap = resolveSixJarSlotMapping(catRows);
          for (const [key, val] of Object.entries(cfgData.initialBalances)) {
            const numVal = Math.round(Number(val) || 0);
            const foundSlot = slotMap.ordered.find(s => s.key === key);
            const targetId = foundSlot ? foundSlot.id : key;
            await sql`
              UPDATE categories
              SET initial_balance = ${numVal}
              WHERE (id = ${targetId} OR id = ${key} OR LOWER(TRIM(name)) = LOWER(TRIM(${key})))
                AND UPPER(type) IN ('HU_CHITIEU', 'HU')
            `.catch(() => {});
          }
        }

        if ((cfgData.lockedJars || cfgData.lockedMap) && typeof (cfgData.lockedJars || cfgData.lockedMap) === 'object') {
          const lockPayload = cfgData.lockedJars || cfgData.lockedMap;
          const catRows = await sql`SELECT id, type, name, is_hidden, initial_balance, is_locked FROM categories WHERE UPPER(type) IN ('HU_CHITIEU', 'HU')`;
          const slotMap = resolveSixJarSlotMapping(catRows);
          for (const [key, val] of Object.entries(lockPayload)) {
            const isLockedBool = Boolean(val);
            const foundSlot = slotMap.ordered.find(s => s.key === key);
            const targetId = foundSlot ? foundSlot.id : key;
            await sql`
              UPDATE categories
              SET is_locked = ${isLockedBool}
              WHERE (id = ${targetId} OR id = ${key} OR LOWER(TRIM(name)) = LOWER(TRIM(${key})))
                AND UPPER(type) IN ('HU_CHITIEU', 'HU')
            `.catch(() => {});
          }
        }
        return res.status(200).json({ success: true, message: '✅ Đã lưu cấu hình tỷ lệ hũ vào Database!' });
      }

      case 'transferJarAmount':
      case 'processJarTransfer': {
        const tf = (args && args[0]) || {};
        const fromJar = String(tf.fromJar || '').trim();
        const toJar = String(tf.toJar || '').trim();
        const amount = Number(tf.amount || 0);
        if (!fromJar || !toJar || amount <= 0) {
          return res.status(200).json({ success: false, message: 'Vui lòng chọn hũ đi, hũ đến và số tiền > 0!' });
        }
        if (normalizeTextNoAccents(fromJar) === normalizeTextNoAccents(toJar)) {
          return res.status(200).json({ success: false, message: 'Hũ đi và Hũ đến không được trùng nhau!' });
        }
        const huCats = await sql`SELECT id, name FROM categories WHERE UPPER(type) IN ('HU_CHITIEU', 'HU_THUNHAP', 'HU_KHAC', 'HU') AND is_hidden = false`;
        const findHuId = (name) => {
          const norm = normalizeTextNoAccents(name);
          const found = huCats.find(c => normalizeTextNoAccents(c.name) === norm);
          return found ? String(found.id) : null;
        };
        const fromHuId = findHuId(fromJar);
        const toHuId = findHuId(toJar);
        const todayStr = new Date().toISOString().slice(0, 10);
        const ts = Date.now();
        await sql`
          INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status)
          VALUES
            (${'JTF1_' + ts}, ${todayStr}, 'Chi', ${fromHuId}, ${fromJar}, ${'Điều chỉnh Hũ -> ' + toJar}, ${amount}, NULL, 'Nội bộ', false, 'Chuyển hũ (Trừ)', 'HOAN_TAT'),
            (${'JTF2_' + ts}, ${todayStr}, 'Thu', ${toHuId}, ${toJar}, ${'Điều chỉnh Hũ từ ' + fromJar}, ${amount}, NULL, 'Nội bộ', false, 'Chuyển hũ (Cộng)', 'HOAN_TAT')
        `;
        return res.status(200).json({ success: true, message: `✅ Đã chuyển ${amount.toLocaleString()} từ hũ ${fromJar} sang hũ ${toJar}` });
      }

      // 25. THANH TOÁN HỖN HỢP (MIXED PAYMENT: GIA ĐÌNH + KINH DOANH CHUNG 1 HÓA ĐƠN / 1 BÚT TOÁN THẺ)
      case 'saveMixedPayment': {
        const payload = args[0] || {};
        const rawWalletId = String(payload.walletId || payload.wallet_id || '').trim();
        const rawWalletName = String(payload.walletName || payload.wallet_name || payload.nguontien || payload.nguonTien || '').trim();
        const matchedWallet = (rawWalletId || rawWalletName)
          ? await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName })
          : null;

        const v = validateMixedPaymentPayload(payload, matchedWallet);
        if (!v.valid) {
          return res.status(200).json({ success: false, message: v.message });
        }

        const isoDate = v.date;
        const rawGivenStmt = payload.statementDate || payload.statement_date || payload.ngaySaoKe || '';
        const isCredit = String(matchedWallet.type || '').toUpperCase() === 'CREDIT';
        let isoStmtDate = normalizeStatementDateIso(rawGivenStmt);
        if (!isoStmtDate && isCredit) {
          isoStmtDate = getCardDefaultPaymentStatementMonth(isoDate, matchedWallet.closing_date) + '-01';
        }
        const commonNote = String(payload.note || payload.ghiChu || '').trim();
        const isPreOrder = Boolean(payload.isPreOrder || payload.is_preorder);
        const wIdStr = String(matchedWallet.id);
        const wNameStr = String(matchedWallet.name);

        const catRows = await sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => []);
        const tsNum = Date.now();
        const tsShort = tsNum.toString().slice(-10);
        const pgId = 'PG-' + tsNum + '-' + Math.floor(1000 + Math.random() * 9000);

        const famLines = v.lines.filter(l => l.lineType === 'FAMILY');
        const bizLines = v.lines.filter(l => l.lineType === 'BUSINESS');

        for (let i = 0; i < famLines.length; i++) {
          const line = famLines[i];
          let resolvedHu = resolveHuCategory(catRows, { huId: line.huId, huName: line.hu });
          if (!resolvedHu && line.hu) {
            resolvedHu = await ensureCategoryExistsByName(sql, catRows, 'HU', line.hu);
          }
          const huId = resolvedHu ? String(resolvedHu.id) : (line.huId || null);
          const huName = resolvedHu ? String(resolvedHu.name) : line.hu;
          const famId = `FAM_${tsNum}_${i + 1}`;
          const famStatus = isPreOrder ? 'PRE-ORDER' : 'ACTIVE';
          const famNote = line.note || commonNote;
          await sql`
            INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date, payment_group_id)
            VALUES (${famId}, ${isoDate}, 'Chi', ${huId}, ${huId || huName}, ${line.content}, ${line.amount}, ${wIdStr}, ${wIdStr}, ${Boolean(line.isFixed)}, ${famNote}, ${famStatus}, ${isoStmtDate || null}, ${pgId})
          `;
        }

        const poBaseId = `PO-PG${tsShort}`;
        for (let j = 0; j < bizLines.length; j++) {
          const line = bizLines[j];
          const itemId = bizLines.length > 1 ? `${poBaseId}-${j + 1}` : poBaseId;
          const defaultRole = isPreOrder ? 'DAT_TRUOC' : 'CHO_SHIP';
          const matchedWh = resolveWarehouseCategory(catRows, { warehouseId: line.warehouseId, warehouseName: line.warehouse, fallbackRole: defaultRole });
          const whId = matchedWh ? String(matchedWh.id) : (line.warehouseId || null);
          const whName = matchedWh ? String(matchedWh.name) : line.warehouse;
          const isWhPreOrCancel = isWarehousePreOrderName(whName) || isWarehouseCancelledName(whName);
          const rem = isWhPreOrCancel ? 0 : line.qty;
          const rawShop = String(line.shop || '').trim();
          let matchedShop = rawShop ? resolveCategoryByIdOrName(catRows, ['SHOP'], { id: line.shopId, name: rawShop }) : null;
          if (!matchedShop && rawShop) {
            matchedShop = await ensureCategoryExistsByName(sql, catRows, 'SHOP', rawShop);
          }
          const shopName = matchedShop ? matchedShop.name : rawShop;
          const shopId = matchedShop ? String(matchedShop.id) : (line.shopId || null);
          let itemNote = line.note || commonNote;
          if (isPreOrder && !itemNote.toLowerCase().includes('pre')) {
            itemNote = itemNote ? `[Pre-order] ${itemNote}` : '[Pre-order]';
          }
          const bizStatus = isPreOrder ? 'PRE-ORDER' : 'HOAN_TAT';

          await sql`
            INSERT INTO business_orders (id, date, warehouse, warehouse_id, product_name, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, shop, shop_id, account, account_id, statement_date, payment_group_id, is_deleted)
            VALUES (${itemId}, ${isoDate}, ${whId || whName}, ${whId}, ${line.productName}, ${line.qty}, ${line.unitPrice}, ${line.amount}, ${rem}, ${wIdStr}, ${wIdStr}, ${bizStatus}, ${itemNote}, 'HOAN_TAT', ${shopName}, ${shopId}, '', ${null}, ${isoStmtDate || ''}, ${pgId}, false)
          `;
        }

        // Điều chỉnh số dư thẻ/ví ĐÚNG MỘT LẦN cho tổng thanh toán
        const wDelta = await adjustWalletForAmountAndPreorder(sql, matchedWallet, v.grandTotal, isPreOrder, +1);
        const ledSync = await syncPaymentGroupLedger(sql, pgId, {
          walletId: wIdStr,
          walletName: wNameStr,
          isCredit,
          date: isoDate,
          statementDate: isoStmtDate,
          isPreOrder,
          commonNote,
          balanceAfter: wDelta.balanceAfter
        });
        if (isPreOrder) {
          await syncCreditWalletPreorders(sql, [matchedWallet.id]).catch(() => {});
        }

        const updatedWallets = await fetchActiveWalletsList(sql);
        return res.status(200).json({
          success: true,
          message: `✅ Đã lưu hóa đơn hỗn hợp (${v.lines.length} khoản · ${v.grandTotal.toLocaleString()} ¥) thành 1 bút toán trên ${wNameStr}!`,
          paymentGroupId: pgId,
          ledgerId: ledSync.ledgerId,
          grandTotal: v.grandTotal,
          familyTotal: v.familyTotal,
          businessTotal: v.businessTotal,
          familyCount: v.familyCount,
          businessCount: v.businessCount,
          wallets: updatedWallets,
          updatedWallets
        });
      }

      case 'getPaymentGroupDetail': {
        const pgId = String((args && args[0]) || '').trim();
        if (!pgId) {
          return res.status(200).json({ success: false, message: 'Mã nhóm thanh toán không hợp lệ!' });
        }

        const [famRows, bizRows, ledRows, catRows, walletRows] = await Promise.all([
          sql`
            SELECT id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date
            FROM family_transactions
            WHERE payment_group_id = ${pgId}
              AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY')
            ORDER BY id ASC
          `.catch(() => []),
          sql`
            SELECT id, date, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, shop, shop_id, statement_date
            FROM business_orders
            WHERE payment_group_id = ${pgId}
              AND is_deleted = false
              AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
              AND UPPER(COALESCE(status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
            ORDER BY id ASC
          `.catch(() => []),
          sql`
            SELECT id, transaction_date, statement_date, wallet_id, wallet_name, amount, note, status, effect_type
            FROM wallet_ledger
            WHERE (payment_group_id = ${pgId} OR order_id = ${pgId})
              AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED')
            ORDER BY id DESC
            LIMIT 1
          `.catch(() => []),
          sql`SELECT id, type, name FROM categories`.catch(() => []),
          sql`SELECT id, name, type FROM wallets`.catch(() => [])
        ]);

        if (famRows.length === 0 && bizRows.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy chi tiết hóa đơn hỗn hợp #' + pgId });
        }

        const catMap = buildCategoryByIdMap(catRows || []);
        const walMap = buildWalletByIdMap(walletRows || []);
        const led = ledRows[0] || null;
        const firstChild = bizRows[0] || famRows[0];
        const rawWId = String(led?.wallet_id || firstChild?.wallet_id || '').trim();
        const rawWName = String(led?.wallet_name || firstChild?.wallet_name || '').trim();
        const wObj = (rawWId && walMap.get(rawWId)) || (rawWName && walMap.get(rawWName)) || null;

        let commonNote = '';
        if (led && led.note) {
          const m = String(led.note).match(/Hóa đơn hỗn hợp \(\d+ khoản\)\s*·\s*(.+)$/i);
          if (m && m[1]) commonNote = m[1].trim();
        }
        if (!commonNote) {
          commonNote = String(firstChild?.note || '').replace(/\[Pre-order(?:\/[^\]]+)?\]/gi, '').trim();
        }

        const familyItems = famRows.map(f => {
          const hId = normalizeCategoryId(f.hu_id || f.hu);
          const hObj = hId ? catMap.get(hId) : null;
          return {
            id: String(f.id),
            lineType: 'FAMILY',
            content: String(f.content || ''),
            huId: hId || '',
            hu: hObj ? String(hObj.name || '') : String(f.hu || ''),
            qty: 1,
            unitPrice: Math.round(Number(f.amount || 0)),
            amount: Math.round(Number(f.amount || 0)),
            note: String(f.note || ''),
            isFixed: Boolean(f.is_fixed)
          };
        });

        let hasSoldBusinessItem = false;
        const businessItems = bizRows.map(b => {
          const whId = normalizeCategoryId(b.warehouse_id || b.warehouse);
          const whObj = whId ? catMap.get(whId) : null;
          const whName = whObj ? String(whObj.name || '') : String(b.warehouse || '');
          const sId = normalizeCategoryId(b.shop_id || b.shop);
          const sObj = sId ? catMap.get(sId) : null;
          const qty = Number(b.quantity || 1);
          const rem = Number(b.inventory_remaining ?? qty);
          const isPreOrCancelWh = isWarehousePreOrderName(whName) || isWarehousePendingName(whName) || isWarehouseCancelledName(whName);
          const soldQty = (!isPreOrCancelWh && rem < qty) ? Math.max(0, qty - rem) : 0;
          if (soldQty > 0) hasSoldBusinessItem = true;
          return {
            id: String(b.id),
            lineType: 'BUSINESS',
            productName: String(b.product_name || ''),
            warehouseId: whId || '',
            warehouse: whName,
            qty,
            unitPrice: Math.round(Number(b.unit_price || 0)),
            amount: Math.round(Number(b.total_amount || 0)),
            inventoryRemaining: rem,
            soldQty,
            shop: sObj ? String(sObj.name || '') : String(b.shop || ''),
            shopId: sId || '',
            note: String(b.note || '')
          };
        });

        const familyTotal = familyItems.reduce((s, x) => s + x.amount, 0);
        const businessTotal = businessItems.reduce((s, x) => s + x.amount, 0);
        const grandTotal = familyTotal + businessTotal;
        const allPre = [...famRows, ...bizRows].every(r => String(r.status || '').toUpperCase().includes('PRE'));

        return res.status(200).json({
          success: true,
          group: {
            paymentGroupId: pgId,
            ledgerId: led ? String(led.id) : '',
            date: normalizeIsoDate(led?.transaction_date || firstChild?.date) || '',
            statementDate: normalizeStatementDateIso(led?.statement_date || firstChild?.statement_date || ''),
            walletId: wObj ? String(wObj.id) : rawWId,
            walletName: wObj ? String(wObj.name) : rawWName,
            walletType: wObj ? String(wObj.type || '') : '',
            isCredit: wObj ? String(wObj.type || '').toUpperCase() === 'CREDIT' : false,
            isPreOrder: allPre,
            note: commonNote,
            ledgerNote: led ? String(led.note || '') : '',
            grandTotal,
            familyTotal,
            businessTotal,
            hasSoldBusinessItem,
            familyItems,
            businessItems
          }
        });
      }

      case 'updateMixedPayment': {
        const payload = args[0] || {};
        const pgId = String(payload.paymentGroupId || payload.payment_group_id || payload.id || '').trim();
        if (!pgId) {
          return res.status(200).json({ success: false, message: 'Mã hóa đơn hỗn hợp không hợp lệ!' });
        }

        const rawWalletId = String(payload.walletId || payload.wallet_id || '').trim();
        const rawWalletName = String(payload.walletName || payload.wallet_name || payload.nguontien || payload.nguonTien || '').trim();
        const matchedWallet = (rawWalletId || rawWalletName)
          ? await findWalletByOrderName(sql, { walletId: rawWalletId, walletName: rawWalletName })
          : null;

        const v = validateMixedPaymentPayload(payload, matchedWallet);
        if (!v.valid) {
          return res.status(200).json({ success: false, message: v.message });
        }

        const [oldFamRows, oldBizRows, catRows] = await Promise.all([
          sql`
            SELECT id, amount, wallet_id, wallet_name, status, content, hu_id, hu
            FROM family_transactions
            WHERE payment_group_id = ${pgId}
              AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY')
          `.catch(() => []),
          sql`
            SELECT id, product_name, warehouse, warehouse_id, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, order_status, is_deleted
            FROM business_orders
            WHERE payment_group_id = ${pgId}
              AND is_deleted = false
              AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
              AND UPPER(COALESCE(status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
          `.catch(() => []),
          sql`SELECT id, type, name, is_hidden FROM categories ORDER BY id ASC`.catch(() => [])
        ]);

        if (oldFamRows.length === 0 && oldBizRows.length === 0) {
          return res.status(200).json({ success: false, message: 'Không tìm thấy hóa đơn hỗn hợp #' + pgId });
        }

        const catMap = buildCategoryByIdMap(catRows || []);
        const newBizById = new Map(v.lines.filter(l => l.lineType === 'BUSINESS' && l.id).map(l => [l.id, l]));
        const newFamById = new Map(v.lines.filter(l => l.lineType === 'FAMILY' && l.id).map(l => [l.id, l]));

        // Kiểm tra ràng buộc hàng đã xuất bán không thể xóa hoặc đổi tên/SL/giá/kho
        const oldSoldById = new Map();
        for (const ob of oldBizRows) {
          const whObj = (ob.warehouse_id && catMap.get(String(ob.warehouse_id))) || (ob.warehouse && catMap.get(String(ob.warehouse)));
          const whName = whObj ? String(whObj.name || '') : String(ob.warehouse || '');
          const isPreOrCancelWh = isWarehousePreOrderName(whName) || isWarehousePendingName(whName) || isWarehouseCancelledName(whName);
          const qty = Number(ob.quantity || 0);
          const rem = Number(ob.inventory_remaining ?? qty);
          const soldQty = (!isPreOrCancelWh && rem < qty) ? Math.max(0, qty - rem) : 0;
          oldSoldById.set(String(ob.id), soldQty);
          if (soldQty > 0) {
            const nextLine = newBizById.get(String(ob.id));
            if (!nextLine) {
              return res.status(200).json({ success: false, message: `⚠️ Sản phẩm "${ob.product_name}" đã xuất bán (${soldQty}/${qty}), không thể xóa khỏi hóa đơn!` });
            }
            const nextWhCat = resolveWarehouseCategory(catRows, { warehouseId: nextLine.warehouseId, warehouseName: nextLine.warehouse });
            const nextWhId = nextWhCat ? String(nextWhCat.id) : String(nextLine.warehouseId || '');
            const oldWhId = String(ob.warehouse_id || (whObj ? whObj.id : '') || '');
            if (
              String(ob.product_name || '').trim() !== nextLine.productName ||
              Number(ob.quantity || 0) !== nextLine.qty ||
              Math.round(Number(ob.unit_price || 0)) !== nextLine.unitPrice ||
              (oldWhId && nextWhId && oldWhId !== nextWhId)
            ) {
              return res.status(200).json({ success: false, message: `⚠️ Sản phẩm "${ob.product_name}" đã xuất bán — chỉ có thể sửa Ngày/Thẻ/Kỳ sao kê hoặc các dòng khác, không thể sửa Tên/SL/Giá/Kho của món đã bán!` });
            }
          }
        }

        // Hoàn tác số dư ví cũ theo từng nhóm (wallet + isPre) ĐÚNG MỘT LẦN
        const touchedWalletIds = [];
        const oldBuckets = new Map();
        const addOldBucket = (wId, wName, isPre, amt) => {
          const a = Math.round(Number(amt || 0));
          if (a <= 0 || (!wId && !wName)) return;
          const k = `${String(wId || '').trim().toLowerCase()}||${String(wName || '').trim().toLowerCase()}||${isPre ? '1' : '0'}`;
          const prev = oldBuckets.get(k) || { wId: String(wId || '').trim(), wName: String(wName || '').trim(), isPre: Boolean(isPre), amt: 0 };
          prev.amt += a;
          oldBuckets.set(k, prev);
        };
        oldFamRows.forEach(f => addOldBucket(f.wallet_id, f.wallet_name, String(f.status || '').toUpperCase().includes('PRE'), f.amount));
        oldBizRows.forEach(b => addOldBucket(b.wallet_id, b.wallet_name, String(b.status || '').toUpperCase().includes('PRE'), b.total_amount));
        for (const bk of oldBuckets.values()) {
          const wOld = await adjustWalletForAmountAndPreorder(sql, { walletId: bk.wId, walletName: bk.wName }, bk.amt, bk.isPre, -1);
          if (wOld?.wallet?.id) touchedWalletIds.push(wOld.wallet.id);
        }

        // Cập nhật, xóa, thêm các dòng chi tiết
        const isoDate = v.date;
        const isoStmtDate = normalizeStatementDateIso(payload.statementDate || payload.statement_date || payload.ngaySaoKe || '');
        const commonNote = String(payload.note || payload.ghiChu || '').trim();
        const newIsPre = Boolean(payload.isPreOrder || payload.is_preorder);
        const wIdStr = String(matchedWallet.id);

        const removedFamIds = oldFamRows.map(r => String(r.id)).filter(fid => !newFamById.has(fid));
        if (removedFamIds.length > 0) {
          await sql`DELETE FROM family_transactions WHERE id = ANY(${removedFamIds}) AND payment_group_id = ${pgId}`;
        }
        const removedBizIds = oldBizRows.map(r => String(r.id)).filter(bid => !newBizById.has(bid));
        if (removedBizIds.length > 0) {
          await sql`DELETE FROM business_orders WHERE id = ANY(${removedBizIds}) AND payment_group_id = ${pgId}`;
        }

        const tsNow = Date.now();
        const famStatus = newIsPre ? 'PRE-ORDER' : 'ACTIVE';
        const bizStatus = newIsPre ? 'PRE-ORDER' : 'HOAN_TAT';

        let addIdx = 0;
        for (const line of v.lines) {
          addIdx++;
          if (line.lineType === 'FAMILY') {
            let resolvedHu = resolveHuCategory(catRows, { huId: line.huId, huName: line.hu });
            if (!resolvedHu && line.hu) resolvedHu = await ensureCategoryExistsByName(sql, catRows, 'HU', line.hu);
            const huId = resolvedHu ? String(resolvedHu.id) : (line.huId || null);
            const huName = resolvedHu ? String(resolvedHu.name) : line.hu;
            const famNote = line.note || commonNote;
            const isExisting = line.id && oldFamRows.some(r => String(r.id) === line.id);
            if (isExisting) {
              await sql`
                UPDATE family_transactions SET
                  date = ${isoDate}, type = 'Chi', hu_id = ${huId}, hu = ${huId || huName},
                  content = ${line.content}, amount = ${line.amount}, wallet_id = ${wIdStr}, wallet_name = ${wIdStr},
                  is_fixed = ${Boolean(line.isFixed)}, note = ${famNote}, status = ${famStatus}, statement_date = ${isoStmtDate || null}
                WHERE id = ${line.id} AND payment_group_id = ${pgId}
              `;
            } else {
              const newFamId = `FAM_${tsNow}_${addIdx}`;
              await sql`
                INSERT INTO family_transactions (id, date, type, hu_id, hu, content, amount, wallet_id, wallet_name, is_fixed, note, status, statement_date, payment_group_id)
                VALUES (${newFamId}, ${isoDate}, 'Chi', ${huId}, ${huId || huName}, ${line.content}, ${line.amount}, ${wIdStr}, ${wIdStr}, ${Boolean(line.isFixed)}, ${famNote}, ${famStatus}, ${isoStmtDate || null}, ${pgId})
              `;
            }
          } else {
            const defaultRole = newIsPre ? 'DAT_TRUOC' : 'CHO_SHIP';
            const matchedWh = resolveWarehouseCategory(catRows, { warehouseId: line.warehouseId, warehouseName: line.warehouse, fallbackRole: defaultRole });
            const whId = matchedWh ? String(matchedWh.id) : (line.warehouseId || null);
            const whName = matchedWh ? String(matchedWh.name) : line.warehouse;
            const isWhPreOrCancel = isWarehousePreOrderName(whName) || isWarehouseCancelledName(whName);
            const rawShop = String(line.shop || '').trim();
            let matchedShop = rawShop ? resolveCategoryByIdOrName(catRows, ['SHOP'], { id: line.shopId, name: rawShop }) : null;
            if (!matchedShop && rawShop) matchedShop = await ensureCategoryExistsByName(sql, catRows, 'SHOP', rawShop);
            const shopName = matchedShop ? matchedShop.name : rawShop;
            const shopId = matchedShop ? String(matchedShop.id) : (line.shopId || null);
            let itemNote = line.note || commonNote;
            if (newIsPre && !itemNote.toLowerCase().includes('pre')) {
              itemNote = itemNote ? `[Pre-order] ${itemNote}` : '[Pre-order]';
            }
            const oldBiz = line.id ? oldBizRows.find(r => String(r.id) === line.id) : null;
            if (oldBiz) {
              const soldQty = oldSoldById.get(String(oldBiz.id)) || 0;
              const newRem = isWhPreOrCancel ? 0 : Math.max(0, line.qty - soldQty);
              await sql`
                UPDATE business_orders SET
                  date = ${isoDate}, warehouse = ${whId || whName}, warehouse_id = ${whId},
                  product_name = ${line.productName}, quantity = ${line.qty}, unit_price = ${line.unitPrice},
                  total_amount = ${line.amount}, inventory_remaining = ${newRem}, wallet_id = ${wIdStr}, wallet_name = ${wIdStr},
                  status = ${bizStatus}, note = ${itemNote}, order_status = 'HOAN_TAT', shop = ${shopName}, shop_id = ${shopId}, statement_date = ${isoStmtDate || ''}
                WHERE id = ${oldBiz.id} AND payment_group_id = ${pgId}
              `;
            } else {
              const newBizId = `PO-PG${tsNow.toString().slice(-8)}-${addIdx}`;
              const rem = isWhPreOrCancel ? 0 : line.qty;
              await sql`
                INSERT INTO business_orders (id, date, warehouse, warehouse_id, product_name, quantity, unit_price, total_amount, inventory_remaining, wallet_id, wallet_name, status, note, order_status, shop, shop_id, account, account_id, statement_date, payment_group_id, is_deleted)
                VALUES (${newBizId}, ${isoDate}, ${whId || whName}, ${whId}, ${line.productName}, ${line.qty}, ${line.unitPrice}, ${line.amount}, ${rem}, ${wIdStr}, ${wIdStr}, ${bizStatus}, ${itemNote}, 'HOAN_TAT', ${shopName}, ${shopId}, '', ${null}, ${isoStmtDate || ''}, ${pgId}, false)
              `;
            }
          }
        }

        // Tải lại số dư ví mới nhất sau khi hoàn tác trước khi trừ số tổng mới
        const freshTargetWallet = await findWalletByOrderName(sql, { walletId: matchedWallet.id, walletName: matchedWallet.name });
        const wNewDelta = await adjustWalletForAmountAndPreorder(sql, freshTargetWallet || matchedWallet, v.grandTotal, newIsPre, +1);
        if (wNewDelta?.wallet?.id) touchedWalletIds.push(wNewDelta.wallet.id);

        await syncPaymentGroupLedger(sql, pgId, {
          walletId: wIdStr,
          walletName: String(matchedWallet.name),
          isCredit: String(matchedWallet.type || '').toUpperCase() === 'CREDIT',
          date: isoDate,
          statementDate: isoStmtDate,
          isPreOrder: newIsPre,
          commonNote,
          balanceAfter: wNewDelta.balanceAfter
        });
        if (touchedWalletIds.length > 0) {
          await syncCreditWalletPreorders(sql, touchedWalletIds).catch(() => {});
        }

        const updatedWallets = await fetchActiveWalletsList(sql);
        return res.status(200).json({
          success: true,
          message: `✅ Đã cập nhật hóa đơn hỗn hợp (${v.lines.length} khoản · ${v.grandTotal.toLocaleString()} ¥)!`,
          paymentGroupId: pgId,
          grandTotal: v.grandTotal,
          wallets: updatedWallets,
          updatedWallets
        });
      }

      case 'deleteMixedPayment': {
        const pgId = String((args && args[0]) || '').trim();
        if (!pgId) {
          return res.status(200).json({ success: false, message: 'Mã hóa đơn hỗn hợp không hợp lệ!' });
        }

        const [famRows, bizRows, catRows] = await Promise.all([
          sql`
            SELECT id, amount, wallet_id, wallet_name, status
            FROM family_transactions
            WHERE payment_group_id = ${pgId}
              AND COALESCE(UPPER(status), '') NOT IN ('CANCELLED', 'VOID', 'REVERSED', 'DELETED', 'DA_HUY')
          `.catch(() => []),
          sql`
            SELECT id, product_name, warehouse, warehouse_id, quantity, total_amount, inventory_remaining, wallet_id, wallet_name, status, order_status, is_deleted
            FROM business_orders
            WHERE payment_group_id = ${pgId}
              AND is_deleted = false
              AND UPPER(COALESCE(order_status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
              AND UPPER(COALESCE(status, '')) NOT IN ('DA_HUY', 'DA_HOAN_TIEN')
          `.catch(() => []),
          sql`SELECT id, type, name FROM categories`.catch(() => [])
        ]);

        if (famRows.length === 0 && bizRows.length === 0) {
          await syncPaymentGroupLedger(sql, pgId, { hardDelete: false, cancelStatus: 'DELETED' });
          const updatedWallets = await fetchActiveWalletsList(sql);
          return res.status(200).json({ success: true, message: 'Đã xóa hóa đơn hỗn hợp!', wallets: updatedWallets, updatedWallets });
        }

        const catMap = buildCategoryByIdMap(catRows || []);
        for (const b of bizRows) {
          const whObj = (b.warehouse_id && catMap.get(String(b.warehouse_id))) || (b.warehouse && catMap.get(String(b.warehouse)));
          const whName = whObj ? String(whObj.name || '') : String(b.warehouse || '');
          const isPreOrCancelWh = isWarehousePreOrderName(whName) || isWarehousePendingName(whName) || isWarehouseCancelledName(whName);
          const qty = Number(b.quantity || 0);
          const rem = Number(b.inventory_remaining ?? qty);
          if (!isPreOrCancelWh && rem < qty) {
            return res.status(200).json({
              success: false,
              message: `⚠️ Sản phẩm "${b.product_name}" trong hóa đơn đã xuất bán (${qty - rem}/${qty}), không thể xóa toàn bộ hóa đơn hỗn hợp!`
            });
          }
        }

        const touchedWalletIds = [];
        const buckets = new Map();
        const addBucket = (wId, wName, isPre, amt) => {
          const a = Math.round(Number(amt || 0));
          if (a <= 0 || (!wId && !wName)) return;
          const k = `${String(wId || '').trim().toLowerCase()}||${String(wName || '').trim().toLowerCase()}||${isPre ? '1' : '0'}`;
          const prev = buckets.get(k) || { wId: String(wId || '').trim(), wName: String(wName || '').trim(), isPre: Boolean(isPre), amt: 0 };
          prev.amt += a;
          buckets.set(k, prev);
        };
        famRows.forEach(f => addBucket(f.wallet_id, f.wallet_name, String(f.status || '').toUpperCase().includes('PRE'), f.amount));
        bizRows.forEach(b => addBucket(b.wallet_id, b.wallet_name, String(b.status || '').toUpperCase().includes('PRE'), b.total_amount));

        for (const bk of buckets.values()) {
          const resRev = await adjustWalletForAmountAndPreorder(sql, { walletId: bk.wId, walletName: bk.wName }, bk.amt, bk.isPre, -1);
          if (resRev?.wallet?.id) touchedWalletIds.push(resRev.wallet.id);
        }

        await Promise.all([
          sql`DELETE FROM family_transactions WHERE payment_group_id = ${pgId}`,
          sql`DELETE FROM business_orders WHERE payment_group_id = ${pgId}`,
          sql`UPDATE wallet_ledger SET status = 'DELETED', amount = 0 WHERE payment_group_id = ${pgId} OR order_id = ${pgId}`.catch(() => {})
        ]);

        if (touchedWalletIds.length > 0) {
          await syncCreditWalletPreorders(sql, touchedWalletIds).catch(() => {});
        }

        const updatedWallets = await fetchActiveWalletsList(sql);
        return res.status(200).json({
          success: true,
          message: '✅ Đã xóa toàn bộ hóa đơn hỗn hợp và hoàn số dư thẻ/ví thành công!',
          wallets: updatedWallets,
          updatedWallets
        });
      }

      default:
        return res.status(200).json({
          success: true,
          action: action,
          message: 'Action completed successfully'
        });
    }
  } catch (err) {
    console.error('Master API Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
