export function getIstDate(now = Date.now()) {
  const localOffsetMinutes = new Date(now).getTimezoneOffset();
  return new Date(now + (330 + localOffsetMinutes) * 60_000);
}

export function isMarketOpenIst(now = Date.now()) {
  const ist = getIstDate(now);
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
}

export function msUntilNextMarketOpenIst(now = Date.now()) {
  const ist = getIstDate(now);
  const next = new Date(ist);
  next.setHours(9, 15, 0, 0);
  if (isMarketOpenIst(now)) return 0;
  while (next.getDay() === 0 || next.getDay() === 6 || next.getTime() <= ist.getTime()) {
    next.setDate(next.getDate() + 1);
    next.setHours(9, 15, 0, 0);
  }
  return next.getTime() - ist.getTime();
}

export function marketStatusLabel(now = Date.now()) {
  return isMarketOpenIst(now) ? "LIVE" : "Market Closed";
}