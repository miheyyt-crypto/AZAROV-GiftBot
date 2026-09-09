import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { STREAK_FREEZE_PRODUCT_ID } from './constants.mjs'
import {
  countAvailableStreakFreezes,
  ensureStreakFreezeInventoryMigration,
  listAvailableStreakFreezeItems,
  migrateLegacyStreakFreezeOrdersOnStore,
} from './inventory.mjs'
import { getInventory } from './profile.mjs'
import {
  approveShopOrder,
  approveShopOrderOnStore,
  cancelOrder,
  purchaseProduct,
  rejectShopOrder,
  rejectShopOrderOnStore,
} from './shop.mjs'
import {
  buildShopModerationKeyboard,
  clearPendingShopRejectReasons,
  handleShopModerationCallback,
  parseShopModerationCallback,
} from './shop-admin.mjs'
import { createEmptyStore, withStore } from './store.mjs'
import { createUser } from './users.mjs'

function withTempStore(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'azarov-shop-inv-'))
  const previous = process.env.AZAROV_STORE_DIR
  process.env.AZAROV_STORE_DIR = dir
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.AZAROV_STORE_DIR
    else process.env.AZAROV_STORE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

function fundUser(store, id, balance = 50_000) {
  const user = createUser(store, { id, first_name: 'U', username: `u${id}` })
  user.balance = balance
  return user
}

test('parseShopModerationCallback and keyboard', () => {
  assert.deepEqual(parseShopModerationCallback('shop:approve:A1B2C3'), {
    action: 'approve',
    orderId: 'A1B2C3',
  })
  assert.deepEqual(parseShopModerationCallback('shop:reject:ZZ99'), {
    action: 'reject',
    orderId: 'ZZ99',
  })
  assert.equal(parseShopModerationCallback('shop:approve:../x'), null)
  assert.equal(parseShopModerationCallback('vellur:approve:abc'), null)
  const kb = buildShopModerationKeyboard('ABC123')
  assert.equal(kb.inline_keyboard[0][0].callback_data, 'shop:approve:ABC123')
  assert.equal(kb.inline_keyboard[0][1].callback_data, 'shop:reject:ABC123')
})

test('purchase → pending; pending freeze not available', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 801)
      return true
    })
    const bought = purchaseProduct(801, STREAK_FREEZE_PRODUCT_ID, 'req-freeze-801')
    assert.equal(bought.success, true)
    assert.equal(bought.created, true)
    assert.equal(bought.order.status, 'pending')

    withStore((store) => {
      assert.equal(countAvailableStreakFreezes(store, 801), 0)
      assert.equal(listAvailableStreakFreezeItems(store, 801).length, 0)
      return true
    })

    const inv = getInventory(801)
    assert.equal(inv.items.length, 0)
  })
})

test('admin approve freeze → completed + one inventory item', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 802)
      return true
    })
    const bought = purchaseProduct(802, STREAK_FREEZE_PRODUCT_ID, 'req-freeze-802')
    const orderId = bought.order.orderId

    const approved = approveShopOrder(orderId, 'admin-key', 'approve-802')
    assert.equal(approved.success, true)
    assert.equal(approved.order.status, 'completed')
    assert.equal(approved.inventoryItem?.type, STREAK_FREEZE_PRODUCT_ID)
    assert.equal(approved.inventoryItem?.status, 'available')

    withStore((store) => {
      assert.equal(countAvailableStreakFreezes(store, 802), 1)
      assert.equal(Object.keys(store.inventory).length, 1)
      return true
    })

    const again = approveShopOrder(orderId, 'admin-key', 'approve-802-b')
    assert.equal(again.success, true)
    assert.equal(again.alreadyProcessed, true)

    withStore((store) => {
      assert.equal(countAvailableStreakFreezes(store, 802), 1)
      assert.equal(Object.keys(store.inventory).length, 1)
      const user = store.users['802']
      assert.equal(user.balance, 50_000 - 1000)
      return true
    })

    const inv = getInventory(802)
    assert.equal(inv.items.length, 1)
    assert.equal(inv.items[0].type, STREAK_FREEZE_PRODUCT_ID)
    assert.equal(inv.items[0].status, 'available')
    assert.equal(inv.items[0].quantity, 1)
  })
})

test('admin reject → rejected + idempotent refund', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 803)
      return true
    })
    const bought = purchaseProduct(803, 'stream-donate', 'req-donate-803', {
      donateNickname: 'Ник803',
      donateText: 'Привет со стрима',
    })
    const orderId = bought.order.orderId
    const balanceAfterPurchase = 50_000 - 1000

    withStore((store) => {
      assert.equal(store.users['803'].balance, balanceAfterPurchase)
      return true
    })

    const rejected = rejectShopOrder(orderId, 'admin-key', 'неверный ник', 'reject-803')
    assert.equal(rejected.success, true)
    assert.equal(rejected.order.status, 'rejected')
    assert.match(rejected.order.rejectionReason, /ник/)

    withStore((store) => {
      assert.equal(store.users['803'].balance, 50_000)
      assert.ok(store.coinTransactions[`shop:refund:${orderId}`])
      return true
    })

    const again = rejectShopOrder(orderId, 'admin-key', 'ещё раз', 'reject-803-b')
    assert.equal(again.success, true)
    assert.equal(again.alreadyProcessed, true)

    withStore((store) => {
      assert.equal(store.users['803'].balance, 50_000)
      assert.equal(countAvailableStreakFreezes(store, 803), 0)
      return true
    })
  })
})

test('approve vs reject race — only one wins', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 804, 250_000)
      return true
    })
    const bought = purchaseProduct(804, 'cash-5000', 'req-cash-804', {
      usdtAddress: 'TXeL2z1bnqSbdLVz1HR7oFVxrQVsoP2MTy',
    })
    const orderId = bought.order.orderId

    withStore((store) => {
      const a = approveShopOrderOnStore(store, orderId, 'admin-a', 'race-a')
      const b = rejectShopOrderOnStore(store, orderId, 'admin-b', 'late', 'race-b')
      assert.equal(a.success, true)
      assert.equal(a.order.status, 'completed')
      assert.equal(b.success, false)
      assert.equal(store.orders[orderId].status, 'completed')
      // No refund after approve
      assert.equal(store.users['804'].balance, 250_000 - 199999)
      return true
    })
  })
})

test('reject then approve — reject wins, approve fails', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 805, 100_000)
      return true
    })
    const bought = purchaseProduct(805, 'tg-premium-6m', 'req-prem-805', {
      telegramUsername: '@prem805',
    })
    const orderId = bought.order.orderId

    withStore((store) => {
      const r = rejectShopOrderOnStore(store, orderId, 'admin', 'нет', 'rej')
      const a = approveShopOrderOnStore(store, orderId, 'admin', 'ap')
      assert.equal(r.success, true)
      assert.equal(a.success, false)
      assert.equal(store.orders[orderId].status, 'rejected')
      assert.equal(store.users['805'].balance, 100_000)
      return true
    })
  })
})

test('user cancel → refund; cancelled cannot approve', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 806)
      return true
    })
    const bought = purchaseProduct(806, STREAK_FREEZE_PRODUCT_ID, 'req-cancel-806')
    const orderId = bought.order.orderId
    const cancelled = cancelOrder(806, orderId)
    assert.equal(cancelled.success, true)
    assert.equal(cancelled.order.status, 'cancelled')

    withStore((store) => {
      assert.equal(store.users['806'].balance, 50_000)
      return true
    })

    const approved = approveShopOrder(orderId, 'admin-key', 'approve-cancelled')
    assert.equal(approved.success, false)

    withStore((store) => {
      assert.equal(countAvailableStreakFreezes(store, 806), 0)
      return true
    })
  })
})

test('completed order cannot reject; rejected freeze not available', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 807)
      return true
    })
    const freeze = purchaseProduct(807, STREAK_FREEZE_PRODUCT_ID, 'req-807-f')
    approveShopOrder(freeze.order.orderId, 'admin', 'ap-807')
    const rejectCompleted = rejectShopOrder(freeze.order.orderId, 'admin', 'late', 'rj-807')
    assert.equal(rejectCompleted.success, false)

    const other = purchaseProduct(807, STREAK_FREEZE_PRODUCT_ID, 'req-807-f2')
    rejectShopOrder(other.order.orderId, 'admin', 'nope', 'rj-807-2')
    withStore((store) => {
      assert.equal(countAvailableStreakFreezes(store, 807), 1)
      return true
    })
  })
})

test('manual products approve without inventory', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 808, 200_000)
      return true
    })
    const bought = purchaseProduct(808, 'kick-vip-forever', 'req-vip-808', {
      kickUsername: 'vip808',
    })
    const approved = approveShopOrder(bought.order.orderId, 'admin', 'ap-vip')
    assert.equal(approved.success, true)
    assert.equal(approved.order.status, 'completed')
    assert.equal(approved.inventoryItem, null)
    withStore((store) => {
      assert.equal(Object.keys(store.inventory || {}).length, 0)
      return true
    })
  })
})

test('non-admin shop callback denied', async () => {
  clearPendingShopRejectReasons()
  process.env.ADMIN_TELEGRAM_IDS = '424242'
  let answered = null
  const handled = await handleShopModerationCallback({
    from: { id: 1 },
    callbackQuery: {
      id: 'cb-deny-shop',
      data: 'shop:approve:ABCDEF',
      message: { chat: { id: 1 }, message_id: 1 },
    },
    answerCbQuery: async (text, opts) => {
      answered = { text, opts }
    },
    reply: async () => {},
  })
  assert.equal(handled, true)
  assert.match(String(answered?.text || ''), /прав/i)
  assert.equal(answered?.opts?.show_alert, true)
  delete process.env.ADMIN_TELEGRAM_IDS
})

test('migration: old pending freeze → inventory; rerun no duplicate', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 809)
      const createdAt = new Date().toISOString()
      store.orders.LEGACY1 = {
        orderId: 'LEGACY1',
        userId: 809,
        productId: STREAK_FREEZE_PRODUCT_ID,
        productName: 'Заморозка стрика',
        price: 1000,
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        metadata: {},
      }
      store.users['809'].orderIds = ['LEGACY1']
      store.orders.LEGACYX = {
        orderId: 'LEGACYX',
        userId: 809,
        productId: STREAK_FREEZE_PRODUCT_ID,
        productName: 'Заморозка стрика',
        price: 1000,
        status: 'cancelled',
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        metadata: {},
      }
      // Simulate pre-v5 store with legacy pending freezes.
      delete store.events['migration:streak-freeze-inventory-v1']
      store.version = 4
      return true
    })

    withStore((store) => {
      // loadStore migrateStore upgrades v4 → migrates pending freezes
      assert.equal(store.orders.LEGACY1.status, 'completed')
      assert.equal(store.inventory['sf:LEGACY1'].status, 'available')
      assert.equal(store.orders.LEGACYX.status, 'cancelled')
      assert.equal(store.inventory['sf:LEGACYX'], undefined)
      assert.equal(countAvailableStreakFreezes(store, 809), 1)
      assert.equal(Number(store.version) >= 5, true)
      assert.equal(store.events['migration:streak-freeze-inventory-v1']?.done, true)

      const second = ensureStreakFreezeInventoryMigration(store)
      assert.equal(second.alreadyDone, true)
      assert.equal(Object.keys(store.inventory).length, 1)
      return true
    })

    withStore((store) => {
      migrateLegacyStreakFreezeOrdersOnStore(store)
      assert.equal(Object.keys(store.inventory).length, 1)
      return true
    })
  })
})

test('inventory API stacks available freezes as quantity', () => {
  withTempStore(() => {
    withStore((store) => {
      fundUser(store, 811)
      return true
    })
    const a = purchaseProduct(811, STREAK_FREEZE_PRODUCT_ID, 'req-stack-a')
    const b = purchaseProduct(811, STREAK_FREEZE_PRODUCT_ID, 'req-stack-b')
    approveShopOrder(a.order.orderId, 'admin', 'ap-stack-a')
    approveShopOrder(b.order.orderId, 'admin', 'ap-stack-b')

    const inv = getInventory(811)
    assert.equal(inv.items.length, 1)
    assert.equal(inv.items[0].type, STREAK_FREEZE_PRODUCT_ID)
    assert.equal(inv.items[0].quantity, 2)
    assert.equal(inv.items[0].name, 'Заморозка стрика')
  })
})

test('pending freeze order does not count even if migration not run yet (inventory empty)', () => {
  const store = createEmptyStore()
  fundUser(store, 810)
  store.orders.P1 = {
    orderId: 'P1',
    userId: 810,
    productId: STREAK_FREEZE_PRODUCT_ID,
    productName: 'Заморозка стрика',
    price: 1000,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    metadata: {},
  }
  assert.equal(countAvailableStreakFreezes(store, 810), 0)
})
