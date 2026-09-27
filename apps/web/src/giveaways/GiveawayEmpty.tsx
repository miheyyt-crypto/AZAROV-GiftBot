import type { ReactNode } from "react";
import { GiveawayGiftIcon } from "./giveaway-icons.js";

export function GiveawayEmpty({
  kind,
  action,
}: {
  kind: "active" | "completed" | "error";
  action?: ReactNode;
}) {
  const copy =
    kind === "active"
      ? {
          title: "Нет активных розыгрышей",
          text: "Загляните в завершённые или следите за анонсами.",
        }
      : kind === "completed"
        ? {
            title: "Нет завершённых розыгрышей",
            text: "Когда розыгрыши закончатся, они появятся здесь.",
          }
        : {
            title: "Не удалось загрузить",
            text: "Проверьте соединение и попробуйте ещё раз.",
          };

  return (
    <div className="giveaway-empty">
      <div className="giveaway-empty__icon">
        <GiveawayGiftIcon size={30} />
      </div>
      <p className="giveaway-empty__title">{copy.title}</p>
      <p className="giveaway-empty__text">{copy.text}</p>
      {action}
    </div>
  );
}
