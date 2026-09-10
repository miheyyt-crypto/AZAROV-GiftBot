import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { CoinBalance } from '@/components/BalanceCard'
import { GamesBannerGrid } from '@/components/GamesBannerGrid'
import { ProductCard } from '@/components/ProductCard'
import { PurchaseConfirmModal } from '@/components/PurchaseConfirmModal'
import { PurchaseSuccessModal } from '@/components/PurchaseSuccessModal'
import { ShopCategoryFilter } from '@/components/ShopCategoryFilter'
import { ShopSectionTabs } from '@/components/ShopSectionTabs'
import { WelvuraReferralRequiredModal } from '@/components/WelvuraReferralRequiredModal'
import { filterProducts, getProducts } from '@/data/products'
import { useBalance } from '@/hooks/useBalance'
import { useUserAccount } from '@/hooks/useUserAccount'
import { ROUTES } from '@/lib/constants'
import {
  hasCompletedWelvuraTask1,
  productRequiresWelvuraReferral,
} from '@/lib/welvura-referral'
import { CasesPage } from '@/pages/CasesPage'
import type { ProductCategory, ShopOrder, ShopProduct, ShopSection } from '@/types/shop'

function resolveShopSection(value: string | null): ShopSection {
  return value === 'cases' ? 'cases' : 'shop'
}

export function Shop() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { amount } = useBalance()
  const account = useUserAccount()
  const [section, setSection] = useState<ShopSection>(() =>
    resolveShopSection(searchParams.get('section')),
  )
  const [category, setCategory] = useState<ProductCategory | 'all'>('all')
  const [selectedProduct, setSelectedProduct] = useState<ShopProduct | null>(null)
  const [successOrder, setSuccessOrder] = useState<ShopOrder | null>(null)
  const [showReferralGate, setShowReferralGate] = useState(false)

  const products = useMemo(() => getProducts(), [])
  const visibleProducts = useMemo(
    () => filterProducts(products, category),
    [products, category],
  )

  function handleBuy(product: ShopProduct) {
    if (productRequiresWelvuraReferral(product) && !hasCompletedWelvuraTask1(account)) {
      setShowReferralGate(true)
      return
    }
    setSelectedProduct(product)
  }

  function handleSectionChange(next: ShopSection) {
    setSection(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'cases') {
      params.set('section', 'cases')
    } else {
      params.delete('section')
    }
    setSearchParams(params, { replace: true })
  }

  useEffect(() => {
    setSection(resolveShopSection(searchParams.get('section')))
  }, [searchParams])

  return (
    <div className="ui-page">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {section === 'cases' ? 'Кейсы' : 'Магазин'}
        </h1>
        <CoinBalance />
      </header>

      <div className="mb-4">
        <ShopSectionTabs active={section} onChange={handleSectionChange} />
      </div>

      {section === 'cases' ? (
        <CasesPage />
      ) : (
        <>
          <GamesBannerGrid className="mb-4" />

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
                onBuy={handleBuy}
              />
            ))}
          </div>
        </>
      )}

      {showReferralGate ? (
        <WelvuraReferralRequiredModal onClose={() => setShowReferralGate(false)} />
      ) : null}

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
