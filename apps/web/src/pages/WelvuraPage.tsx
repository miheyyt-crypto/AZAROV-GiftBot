import { PageHeader } from "../components/PageHeader.js";
import { WelvuraChainView } from "../tasks/WelvuraChainView.js";

/** Deep-link page; Tasks also opens the same chain in a bottom sheet. */
export function WelvuraPage({
  token,
  skipRemote = false,
}: {
  token: string;
  skipRemote?: boolean;
}) {
  return (
    <div className="stack">
      <PageHeader title="Welvura" backHref="#/tasks" />
      <WelvuraChainView token={token} skipRemote={skipRemote} />
    </div>
  );
}

export default WelvuraPage;
