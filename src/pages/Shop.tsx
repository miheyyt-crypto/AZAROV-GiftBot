import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CoinBalance } from '@/components/BalanceCard'
import { ProductCard } from '@/components/ProductCard'
import { PurchaseConfirmModal } from '@/components/PurchaseConfirmModal'
import { PurchaseSuccessModal } from '@/components/PurchaseSuccessModal'
import { ShopCategoryFilter } from '@/components/ShopCategoryFilter'
import { ShopSectionTabs } from '@/components/ShopSectionTabs'
import { filterProducts, getProducts } from '@/data/products'
import { useBalance } from '@/hooks/useBalance'
import { ROUTES } from '@/lib/constants'
import { CasesPage } from '@/pages/CasesPage'
import type { ProductCategory, ShopOrder, ShopProduct, ShopSection } from '@/types/shop'

export function Shop() {
  const navigate = useNavigate()
  const { amount } = useBalance()
  const [section, setSection] = useState<ShopSection>('shop')
  const [category, setCategory] = useState<ProductCategory | 'all'>('all')
  const [selectedProduct, setSelectedProduct] = useState<ShopProduct | null>(null)
  const [successOrder, setSuccessOrder] = useState<ShopOrder | null>(null)

  const products = useMemo(() => getProducts(), [])
  const visibleProducts = useMemo(
    () => filterProducts(products, category),
    [products, category],
  )

  return (
    <div className="ui-page">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {section === 'cases' ? 'Кейсы' : 'Магазин'}
        </h1>
        <CoinBalance />
      </header>

      <div className="mb-4">
        <ShopSectionTabs active={section} onChange={setSection} />
      </div>

      {section === 'cases' ? (
        <CasesPage />
      ) : (
        <>
          <button
            type="button"
            onClick={() => navigate(ROUTES.mines)}
            className="mb-4 flex min-h-[72px] w-full items-center justify-between overflow-hidden rounded-[20px] border border-[rgb(139_61_255/35%)] bg-[linear-gradient(110deg,#1a1230_0%,#12101c_55%,#0e1620_100%)] px-4 py-3.5 text-left shadow-[0_0_24px_rgb(139_61_255/15%)] transition active:scale-[0.99]"
          >
            <span className="min-w-0">
              <span className="block text-base font-bold text-white">💣 Mines</span>
              <span className="mt-0.5 block text-xs text-[#9b96ab]">
                Мини-игра на монеты · ставка от 100
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-neon-purple" />
          </button>

          <button
            type="button"
            onClick={() => navigate(ROUTES.orders)}
            className="ui-card mb-4 flex min-h-12 w-full items-center justify-between px-4 py-3.5 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              Мои заказы
            </span>
            <ChevronRight size={18} className="text-muted" />
          </button>

          <div className="mb-4">
            <ShopCategoryFilter active={category} onChange={setCategory} />
          </div>

          <div className="grid grid-cols-2 items-stretch gap-3.5">
            {visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onBuy={setSelectedProduct}
              />
            ))}
          </div>
        </>
      )}

      {selectedProduct && !successOrder && (
        <PurchaseConfirmModal
          product={selectedProduct}
          balance={amount}
          onClose={() => setSelectedProduct(null)}
          onSuccess={(order) => {
            setSelectedProduct(null)
            setSuccessOrder(order)
          }}
        />
      )}

      {successOrder && (
        <PurchaseSuccessModal
          order={successOrder}
          onClose={() => setSuccessOrder(null)}
          onOpenOrders={() => {
            setSuccessOrder(null)
            navigate(ROUTES.orders)
          }}
        />
      )}
    </div>
  )
}
