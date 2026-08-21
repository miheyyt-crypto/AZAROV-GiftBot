import { ShopCoinIcon, ShopOfferCard, ShopPriceButton } from '@/components/ShopOfferCard'
import { formatBalance } from '@/lib/balance'
import { productCardTheme } from '@/lib/shop-card-theme'
import type { ShopProduct } from '@/types/shop'

interface ProductCardProps {
  product: ShopProduct
  onBuy: (product: ShopProduct) => void
}

export function ProductCard({ product, onBuy }: ProductCardProps) {
  const theme = productCardTheme[product.category]

  return (
    <ShopOfferCard
      theme={theme}
      image={product.image}
      imageClassName={product.imageClassName}
      title={product.name}
      onClick={() => onBuy(product)}
      badge={
        !product.available ? (
          <span className="absolute left-2.5 top-2.5 z-[2] text-[11px] font-medium text-white/75">
            нет
          </span>
        ) : undefined
      }
      footer={
        <ShopPriceButton buttonClass={theme.button}>
          <ShopCoinIcon />
          {formatBalance(product.price)}
        </ShopPriceButton>
      }
    />
  )
}
