import { ChevronRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
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
  tabPerfMark,
  tabPerfResetImageStats,
  tabPerfShopImageSummary,
} from '@/lib/tab-perf'
import {
  hasCompletedWelvuraTask1,
  productRequiresWelvuraReferral,
} from '@/lib/welvura-referral'
import type { ProductCategory, ShopOrder, ShopProduct, ShopSection } from '@/types/shop'

/** Cases chunk + case images load only when user opens Cases tab. */
const CasesPage = lazy(() =>
  import('@/pages/CasesPage').then((m) => ({ default: m.CasesPage })),
)

function resolveShopSection(value: string | null): ShopSection {
  return value === 'cases' ? 'cases' : 'shop'
}

function CasesFallback() {
  return (
    <div className="grid grid-cols-2 gap-3.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[1.05] animate-pulse rounded-[20px] border border-white/8 bg-white/[0.04]"
        />
      ))}
    </div>
  )
}

function GamesBannerSkeleton() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3" aria-hidden>
      <div className="col-span-2 aspect-[2.08/1] animate-pulse rounded-[20px] bg-white/[0.04]" />
      <div className="aspect-square animate-pulse rounded-[20px] bg-white/[0.04]" />
      <div className="aspect-square animate-pulse rounded-[20px] bg-white/[0.04]" />
    </div>
  )
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
  /** Defer game banners so Shop chrome paints first; never blocks first paint. */
  const [showGameBanners, setShowGameBanners] = useState(false)

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

  useEffect(() => {
    tabPerfResetImageStats()
    tabPerfMark('shop first paint chrome')
    let cancelled = false
    let idleId: number | null = null
    const useRic = typeof window.requestIdleCallback === 'function'
    const revealBanners = () => {
      if (!cancelled) {
        setShowGameBanners(true)
        tabPerfMark('shop game banners reveal')
      }
    }
    if (useRic) {
      idleId = window.requestIdleCallback(revealBanners, { timeout: 900 })
    } else {
      idleId = window.setTimeout(revealBanners, 120) as unknown as number
    }
    const summaryTimer = window.setTimeout(() => {
      tabPerfShopImageSummary({ section })
    }, 2500)
    return () => {
      cancelled = true
      if (idleId != null) {
        if (useRic) {
          window.cancelIdleCallback?.(idleId)
        } else {
          window.clearTimeout(idleId)
        }
      }
      window.clearTimeout(summaryTimer)
    }
  }, [section])

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
        <Suspense fallback={<CasesFallback />}>
          <CasesPage />
        </Suspense>
      ) : (
        <>
          {showGameBanners ? (
            <GamesBannerGrid className="mb-4" eager={false} />
          ) : (
            <GamesBannerSkeleton />
          )}

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
            {visibleProducts.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                onBuy={handleBuy}
                imageEager={index < 2}
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
