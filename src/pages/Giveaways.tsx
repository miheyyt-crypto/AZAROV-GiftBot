import { GiveawaysSection } from '@/components/GiveawaysSection'

export function Giveaways() {
  return (
    <div className="ui-page">
      <GiveawaysSection initialTab="completed" showAllLink={false} />
    </div>
  )
}
