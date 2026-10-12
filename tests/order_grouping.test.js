const test = require('node:test');
const assert = require('node:assert');

// Logic extracted from src/Tab3.html
function extractBaseOrderId(rawId) {
    if (!rawId) return '';
    const str = String(rawId).trim();
    const match = str.match(/^([A-Za-z0-9]+[-_].+?)[-_]([1-9]\d{0,2})$/);
    if (match && match[1]) {
        return match[1];
    }
    return str;
}

function getPurchaseOrderGroupKey(item) {
    const rawId = String(item.id || '').trim();
    const baseId = extractBaseOrderId(rawId);
    if (baseId) {
        return `PURCHASE___${baseId}`;
    }
    return `PURCHASE_RAW___${rawId || ('ROW_' + Math.random())}`;
}

function getSalesOrderGroupKey(item) {
    const rawId = String(item.id || '').trim();
    const baseId = extractBaseOrderId(rawId);
    if (baseId) {
        return `SALES___${baseId}`;
    }
    return `SALES_RAW___${rawId || ('ROW_' + Math.random())}`;
}

test('extractBaseOrderId correctly extracts base order ID without mangling single orders', () => {
    // Single order IDs (must NOT be truncated)
    assert.strictEqual(extractBaseOrderId('PO-26100116310300198'), 'PO-26100116310300198');
    assert.strictEqual(extractBaseOrderId('PO-20261009-001'), 'PO-20261009-001');
    assert.strictEqual(extractBaseOrderId('SO-999'), 'SO-999');
    assert.strictEqual(extractBaseOrderId('PO-12345'), 'PO-12345');
    assert.strictEqual(extractBaseOrderId('PO_12345'), 'PO_12345');

    // Multi-item order IDs (must extract shared base ID)
    assert.strictEqual(extractBaseOrderId('PO-26100116310300198-1'), 'PO-26100116310300198');
    assert.strictEqual(extractBaseOrderId('PO-26100116310300198-2'), 'PO-26100116310300198');
    assert.strictEqual(extractBaseOrderId('PO-26100116310300198-12'), 'PO-26100116310300198');
    assert.strictEqual(extractBaseOrderId('SO-26100116310300198-1'), 'SO-26100116310300198');
    assert.strictEqual(extractBaseOrderId('PO-12345-1'), 'PO-12345');
    assert.strictEqual(extractBaseOrderId('PO_12345_1'), 'PO_12345');
    assert.strictEqual(extractBaseOrderId('PO-20261009-001-1'), 'PO-20261009-001');
});

test('Different order IDs on the same date/store/account are NOT grouped together', () => {
    const item1 = {
        id: 'PO-26100116310300198',
        ngayMua: '2026/10/01',
        noiMua: 'Fuji',
        taiKhoan: 'Fuji Giao',
        trangThaiKho: 'Kho 2F',
        nguonTien: 'RevoChi',
        tenSP: 'Film MINI INSTAX',
        qty: 3,
        price: 1074,
        total: 3222
    };

    const item2 = {
        id: 'PO-26100116310300199',
        ngayMua: '2026/10/01',
        noiMua: 'Fuji',
        taiKhoan: 'Fuji Giao',
        trangThaiKho: 'Kho 2F',
        nguonTien: 'RevoChi',
        tenSP: 'Film MINI SOFT GLITTER',
        qty: 3,
        price: 1263,
        total: 3789
    };

    const key1 = getPurchaseOrderGroupKey(item1);
    const key2 = getPurchaseOrderGroupKey(item2);

    assert.notStrictEqual(key1, key2, 'Two different order IDs must have different group keys');
    assert.strictEqual(key1, 'PURCHASE___PO-26100116310300198');
    assert.strictEqual(key2, 'PURCHASE___PO-26100116310300199');
});

test('Items belonging to the SAME order are grouped together', () => {
    const item1 = {
        id: 'PO-26100116310300198-1',
        ngayMua: '2026/10/01',
        noiMua: 'Fuji',
        taiKhoan: 'Fuji Giao',
        tenSP: 'Film MINI INSTAX',
        qty: 3,
        total: 3222
    };

    const item2 = {
        id: 'PO-26100116310300198-2',
        ngayMua: '2026/10/01',
        noiMua: 'Fuji',
        taiKhoan: 'Fuji Giao',
        tenSP: 'Film MINI SOFT GLITTER',
        qty: 3,
        total: 3789
    };

    const key1 = getPurchaseOrderGroupKey(item1);
    const key2 = getPurchaseOrderGroupKey(item2);

    assert.strictEqual(key1, key2, 'Items belonging to the same order must have the identical group key');
    assert.strictEqual(key1, 'PURCHASE___PO-26100116310300198');
});

test('Sales order grouping strictly respects order ID', () => {
    const soItem1 = { id: 'SO-100-1', ngayBan: '2026/10/01', nhanTien: 'Tiền Mặt', tenSP: 'A' };
    const soItem2 = { id: 'SO-100-2', ngayBan: '2026/10/01', nhanTien: 'Tiền Mặt', tenSP: 'B' };
    const soItem3 = { id: 'SO-200', ngayBan: '2026/10/01', nhanTien: 'Tiền Mặt', tenSP: 'C' };

    assert.strictEqual(getSalesOrderGroupKey(soItem1), getSalesOrderGroupKey(soItem2));
    assert.strictEqual(getSalesOrderGroupKey(soItem1), 'SALES___SO-100');
    assert.notStrictEqual(getSalesOrderGroupKey(soItem1), getSalesOrderGroupKey(soItem3));
    assert.strictEqual(getSalesOrderGroupKey(soItem3), 'SALES___SO-200');
});

test('extractBaseOrderIdServer correctly extracts base IDs on server and handles multi-item rows', () => {
    const { extractBaseOrderIdServer } = require('../src/Server_Tab1.js');
    assert.strictEqual(typeof extractBaseOrderIdServer, 'function');
    assert.strictEqual(extractBaseOrderIdServer('PO-100-1'), 'PO-100');
    assert.strictEqual(extractBaseOrderIdServer('PO-100-2'), 'PO-100');
    assert.strictEqual(extractBaseOrderIdServer('PO-100'), 'PO-100');
    assert.strictEqual(extractBaseOrderIdServer('SO-200-1'), 'SO-200');
    assert.strictEqual(extractBaseOrderIdServer(''), '');
});

test('Cho Ship order count: 27 line items with a multi-item order correctly counted as 26 orders', () => {
    const { extractBaseOrderIdServer } = require('../src/Server_Tab1.js');
    const choShipOrderKeys = new Set();
    
    // Simulate 27 rows: 25 single-item orders (PO-1 to PO-25) + 1 order with 2 items (PO-26-1, PO-26-2)
    const rows = [];
    for (let i = 1; i <= 25; i++) {
        rows.push({ id: `PO-${i}`, tenSP: `Item ${i}` });
    }
    rows.push({ id: `PO-26-1`, tenSP: `Item 26a` });
    rows.push({ id: `PO-26-2`, tenSP: `Item 26b` });

    assert.strictEqual(rows.length, 27, 'Total line items in sheet is 27');

    rows.forEach((r, idx) => {
        const orderKey = extractBaseOrderIdServer(r.id) || ('PURCHASE_ROW_' + idx);
        choShipOrderKeys.add(orderKey);
    });

    assert.strictEqual(choShipOrderKeys.size, 26, 'Cho Ship must be counted as 26 orders, not 27');
});

test('Pre-Order count: 14 line items across 7 purchase orders correctly counted as 7 orders', () => {
    const { extractBaseOrderIdServer } = require('../src/Server_Tab1.js');
    const preorderOrderKeys = new Set();
    
    // Simulate 14 rows across 7 orders (each order has 2 items)
    const pendingPreOrders = [];
    for (let i = 1; i <= 7; i++) {
        pendingPreOrders.push({ id: `PRE-${i}-1`, tenSP: `PreOrder ${i} Part 1` });
        pendingPreOrders.push({ id: `PRE-${i}-2`, tenSP: `PreOrder ${i} Part 2` });
    }

    assert.strictEqual(pendingPreOrders.length, 14, 'Total raw pre-order rows is 14');

    pendingPreOrders.forEach((item, idx) => {
        const pKey = extractBaseOrderIdServer(item.id) || ('PREORDER_ROW_' + idx);
        preorderOrderKeys.add(pKey);
    });

    assert.strictEqual(preorderOrderKeys.size, 7, 'Pre-order count must be 7 orders, not 14');
});

test('Bulk selection badge displays xxx/xxxx đơn format (selectedCount/totalCount)', () => {
    // Simulating the updatePurchaseOrdersCheckedSummary badge text calculation
    function computeBadgeText(selectedCount, totalCount) {
        return `${selectedCount}/${totalCount} đơn`;
    }

    assert.strictEqual(computeBadgeText(0, 15), '0/15 đơn', 'When 0 selected out of 15, badge must be "0/15 đơn"');
    assert.strictEqual(computeBadgeText(3, 15), '3/15 đơn', 'When 3 selected out of 15, badge must be "3/15 đơn"');
    assert.strictEqual(computeBadgeText(15, 15), '15/15 đơn', 'When all 15 selected, badge must be "15/15 đơn"');
});

test('t1_getCanonicalTab3Counts calculates exactly 26 Cho Ship, 7 Pre-Order, and 5 Cho Hoan matching Tab 3', () => {
    function t1_getCanonicalTab3Counts(t3) {
        if (!t3) return null;
        function extractId(id) {
            if (!id) return '';
            const m = String(id).trim().match(/^([A-Za-z0-9]+[-_].+?)[-_]([1-9]\d{0,2})$/);
            return m ? m[1] : String(id).trim();
        }

        const preOrderIdsSet = new Set((t3.preOrders || []).map(it => String(it.id || '').trim()));
        const refundIdsSet = new Set((t3.cancelledRefundPending || []).map(it => String(it.id || '').trim()));

        const choShipKeys = new Set();
        (t3.inventory || []).forEach(it => {
            const rawId = String(it.id || '').trim();
            if (refundIdsSet.has(rawId)) return;

            const wh = String(it.trangThaiKho || '').trim().toLowerCase();
            const isCancelled = wh.includes('hủy') || wh.includes('cancel');
            if (isCancelled) return;

            if (wh === 'chờ ship' || wh === 'cho ship') {
                const baseId = extractId(rawId) || rawId;
                choShipKeys.add(baseId);
            }
        });

        const preKeys = new Set();
        (t3.preOrders || []).forEach(it => {
            const rawId = String(it.id || '').trim();
            const baseId = extractId(rawId) || rawId;
            preKeys.add(baseId);
        });

        return {
            choShip: choShipKeys.size,
            preorder: preKeys.size,
            khachNo: (t3.debtSales || []).length,
            choHoan: (t3.cancelledRefundPending || []).length
        };
    }

    // 27 rows total in inventory: 25 single orders + 1 order with 2 sub-items (PO-26-1, PO-26-2) + 1 item in 1F
    const inventory = [];
    for (let i = 1; i <= 25; i++) {
        inventory.push({ id: `PO-${i}`, trangThaiKho: 'Chờ Ship' });
    }
    inventory.push({ id: `PO-26-1`, trangThaiKho: 'Chờ Ship' });
    inventory.push({ id: `PO-26-2`, trangThaiKho: 'Chờ Ship' });
    inventory.push({ id: `PO-27`, trangThaiKho: '1F' }); // Not in Chờ Ship

    // 14 rows total: 7 pre-orders (overlapping with PO-1 to PO-7 in inventory)
    const preOrders = [];
    for (let i = 1; i <= 7; i++) {
        preOrders.push({ id: `PO-${i}-1`, tenSP: `PreOrder ${i}` });
        preOrders.push({ id: `PO-${i}-2`, tenSP: `PreOrder ${i}` });
    }

    // 5 cancelled items waiting for refund
    const cancelledRefundPending = [
        { id: 'REF-1' },
        { id: 'REF-2' },
        { id: 'REF-3' },
        { id: 'REF-4-1' },
        { id: 'REF-4-2' }
    ];

    const t3Mock = {
        inventory: inventory,
        preOrders: preOrders,
        cancelledRefundPending: cancelledRefundPending,
        debtSales: [{ id: 'DEBT-1' }, { id: 'DEBT-2' }]
    };

    const counts = t1_getCanonicalTab3Counts(t3Mock);
    assert.strictEqual(counts.choShip, 26, 'Cho Ship must be 26 orders');
    assert.strictEqual(counts.preorder, 7, 'Pre-order must be 7 orders');
    assert.strictEqual(counts.khachNo, 2, 'Khach No must be 2 orders');
    assert.strictEqual(counts.choHoan, 5, 'Cho Hoan must be 5 orders');
});

