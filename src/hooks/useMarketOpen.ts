import { useEffect, useState } from "react";
import { isMarketOpenIst, msUntilNextMarketOpenIst, getIstDate } from "@/lib/market-hours";

export function useMarketOpen(): boolean {
  const [open, setOpen] = useState(isMarketOpenIst);

  useEffect(() => {
    const check = () => setOpen(isMarketOpenIst());

    const now = getIstDate();
    const dayEnd = new Date(now);
    dayEnd.setHours(15, 30, 0, 0);

    let delay: number;
    if (isMarketOpenIst()) {
      delay = Math.max(2000, dayEnd.getTime() - now.getTime());
    } else {
      delay = Math.max(2000, msUntilNextMarketOpenIst() + 5000);
    }

    const timer = setTimeout(check, delay);
    const interval = setInterval(check, 300_000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  return open;
}
