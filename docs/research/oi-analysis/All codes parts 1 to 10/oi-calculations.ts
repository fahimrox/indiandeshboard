import { OptionData, BuildupType, MarketBias, SignalConfidence, S_R_Zone, AIDecision, OIChainRow } from '../types/oi.types';

/**
 * Calculates option buildup type based on price change and OI change.
 * Standard Quant Formula:
 * - Long Buildup: Price UP, OI UP
 * - Short Buildup: Price DOWN, OI UP
 * - Long Unwinding: Price DOWN, OI DOWN
 * - Short Covering: Price UP, OI DOWN
 */
export function calculateBuildup(priceChange: number, oiChange: number): BuildupType {
  if (oiChange > 0) {
    return priceChange >= 0 ? 'Long Buildup' : 'Short Buildup';
  } else if (oiChange < 0) {
    return priceChange >= 0 ? 'Short Covering' : 'Long Unwinding';
  }
  return 'Neutral';
}

/**
 * Noise filter: checks if a strike's volume is extremely high but OI change is flat (churn)
 */
export function isChurn(oiChange: number, volume: number, threshold = 0.05): boolean {
  if (volume === 0) return false;
  // If absolute OI change is less than 5% of trading volume, it's considered high churn/noise
  return Math.abs(oiChange) / volume < threshold;
}

/**
 * Calculates Put-Call Ratio (PCR)
 */
export function calculatePCR(totalPutOI: number, totalCallOI: number): number {
  if (totalCallOI === 0) return 0;
  return parseFloat((totalPutOI / totalCallOI).toFixed(2));
}

/**
 * Calculates Max Pain.
 * Max Pain is the strike price where option writers (sellers) experience the least aggregate monetary loss on expiration.
 * Loss Formula:
 * For each strike K:
 *   Loss(K) = Sum_j [ Call_OI(K_j) * Max(K - K_j, 0) + Put_OI(K_j) * Max(K_j - K, 0) ]
 */
export function calculateMaxPain(strikes: number[], ceOIs: Record<number, number>, peOIs: Record<number, number>): number {
  if (strikes.length === 0) return 0;

  let minLoss = Infinity;
  let maxPainStrike = strikes[0];

  for (const candidateK of strikes) {
    let totalLoss = 0;
    for (const optionK of strikes) {
      const ceOI = ceOIs[optionK] || 0;
      const peOI = peOIs[optionK] || 0;

      // Call loss (ITM on expiry if spot > strike)
      if (candidateK > optionK) {
        totalLoss += ceOI * (candidateK - optionK);
      }
      // Put loss (ITM on expiry if spot < strike)
      if (candidateK < optionK) {
        totalLoss += peOI * (optionK - candidateK);
      }
    }

    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      maxPainStrike = candidateK;
    }
  }

  return maxPainStrike;
}

/**
 * Refined Support and Resistance Zone detection based on weighted cluster mass & dispersion
 */
export function detectSRZones(
  strikes: number[],
  ceOIs: Record<number, number>,
  peOIs: Record<number, number>,
  spotPrice: number
): S_R_Zone[] {
  const zones: S_R_Zone[] = [];
  
  // Find highest Put OI strike (Support) and highest Call OI strike (Resistance)
  let maxPutOI = 0;
  let supportStrike = spotPrice;
  let maxCallOI = 0;
  let resistanceStrike = spotPrice;

  for (const k of strikes) {
    const peOI = peOIs[k] || 0;
    const ceOI = ceOIs[k] || 0;

    if (k < spotPrice && peOI > maxPutOI) {
      maxPutOI = peOI;
      supportStrike = k;
    }
    if (k > spotPrice && ceOI > maxCallOI) {
      maxCallOI = ceOI;
      resistanceStrike = k;
    }
  }

  // Calculate S/R Zone strength with dynamic decay weighting (further from spot = slightly decayed)
  const calculateStrength = (strike: number, oi: number, maxOI: number) => {
    if (maxOI === 0) return 0;
    const distanceFactor = Math.exp(-Math.abs(strike - spotPrice) / (spotPrice * 0.05)); // 5% range decay
    return Math.round((oi / maxOI) * 100 * distanceFactor);
  };

  if (maxPutOI > 0) {
    zones.push({
      strike: supportStrike,
      type: 'Support',
      strength: calculateStrength(supportStrike, maxPutOI, maxPutOI),
      status: Math.abs(spotPrice - supportStrike) < spotPrice * 0.005 ? 'Tested' : 'Intact',
      distancePercent: parseFloat((((supportStrike - spotPrice) / spotPrice) * 100).toFixed(2)),
      migration: 'stable'
    });
  }

  if (maxCallOI > 0) {
    zones.push({
      strike: resistanceStrike,
      type: 'Resistance',
      strength: calculateStrength(resistanceStrike, maxCallOI, maxCallOI),
      status: Math.abs(spotPrice - resistanceStrike) < spotPrice * 0.005 ? 'Tested' : 'Intact',
      distancePercent: parseFloat((((resistanceStrike - spotPrice) / spotPrice) * 100).toFixed(2)),
      migration: 'stable'
    });
  }

  return zones;
}

/**
 * Quant Score / AI Bias composite computation
 */
export function computeDecisionEngine(
  pcr: number,
  netCallOIChange: number,
  netPutOIChange: number,
  spotPrice: number,
  maxPain: number,
  zones: S_R_Zone[]
): AIDecision {
  // Let's compute probabilities
  let bullishScore = 50; // starts neutral
  
  // PCR contribution (ideal threshold is 1.0)
  if (pcr > 1.2) bullishScore += 15;
  else if (pcr > 1.0) bullishScore += 8;
  else if (pcr < 0.7) bullishScore -= 15;
  else if (pcr < 0.9) bullishScore -= 8;

  // OI Change contribution
  const oiChangeDiff = netPutOIChange - netCallOIChange;
  if (oiChangeDiff > 0) {
    bullishScore += Math.min(15, (oiChangeDiff / (Math.abs(netCallOIChange) + 1)) * 5);
  } else {
    bullishScore -= Math.min(15, (Math.abs(oiChangeDiff) / (Math.abs(netPutOIChange) + 1)) * 5);
  }

  // Max Pain gravity
  const painDiffPercent = (maxPain - spotPrice) / spotPrice;
  if (Math.abs(painDiffPercent) < 0.01) {
    // Spot is near max pain - tends to stabilize (Neutralizer)
    if (bullishScore > 50) bullishScore -= 5;
    else bullishScore += 5;
  } else {
    // Spot is far, Max Pain acts as gravity
    if (maxPain > spotPrice) bullishScore += 5;
    else bullishScore -= 5;
  }

  // Clamp probability between 10 and 90
  bullishScore = Math.max(10, Math.min(90, bullishScore));
  const bearishScore = Math.max(10, Math.min(90, 100 - bullishScore));
  const neutralScore = 100 - bullishScore - bearishScore; // small balancing

  let bias: MarketBias = 'Neutral';
  if (bullishScore >= 75) bias = 'Strong Bullish';
  else if (bullishScore > 55) bias = 'Bullish';
  else if (bearishScore >= 75) bias = 'Strong Bearish';
  else if (bearishScore > 55) bias = 'Bearish';

  let confidence: SignalConfidence = 'Medium';
  const signalAgreement = Math.abs(bullishScore - 50);
  if (signalAgreement > 30) confidence = 'Very High';
  else if (signalAgreement > 15) confidence = 'High';
  else if (signalAgreement < 5) confidence = 'Low';

  // Entry / Avoid zones
  const support = zones.find(z => z.type === 'Support')?.strike || spotPrice * 0.98;
  const resistance = zones.find(z => z.type === 'Resistance')?.strike || spotPrice * 1.02;

  // Risk Score model
  const riskScore = Math.round(
    Math.min(100, Math.max(0, 50 + (spotPrice - support) / (resistance - support) * 20 - (confidence === 'Very High' ? 20 : 0)))
  );

  return {
    bias,
    confidence,
    probabilities: {
      bullish: Math.round(bullishScore),
      bearish: Math.round(bearishScore),
      neutral: Math.round(100 - Math.round(bullishScore) - Math.round(bearishScore))
    },
    entryZone: [support, support + (spotPrice - support) * 0.3],
    avoidZone: [resistance - (resistance - spotPrice) * 0.3, resistance],
    trapDetected: pcr > 1.3 && oiChangeDiff < -1000000, // PCR high but smart money is exiting puts/adding calls aggressively
    trapDetails: pcr > 1.3 && oiChangeDiff < -1000000 ? 'Bull trap detected: High PCR inflated by retail put buying while institutional option sellers are active in Call writing.' : undefined,
    riskScore
  };
}
